/* ==========================================================================
   LifeLink — Centralized Notification Service
   --------------------------------------------------------------------------
   Single place that owns:
     1. The notification "type registry" (what each event means, its default
        urgency, which category it belongs to, whether it can be muted, and
        whether it is eligible for external/Telegram delivery).
     2. Per-user preferences, by category (in-app / Telegram toggles).
     3. Anti-spam de-duplication (don't re-notify the same user about the
        same thing within a short window).
     4. Writing the in-app notification row (read/unread state, history).
     5. Queuing + retrying external (Telegram today; email/SMS/push later)
        deliveries with exponential backoff, fully decoupled from in-app
        notifications so a failed Telegram send never blocks or removes the
        in-app copy.

   Every function here takes `db` explicitly (same style as
   services/campIngestion/pipeline.js) so it's easy to unit test with an
   in-memory DatabaseSync and easy to reuse from server.js, background
   sweeps, and scripts.

   ADDING A NEW CHANNEL LATER (email / SMS / push):
     1. Add the channel name to `CHANNELS` below.
     2. Add a `telegramEligible`-style flag (e.g. `emailEligible`) to the
        types that should use it, or generalize `channels: ['telegram']`
        per type if you prefer.
     3. Add a case for that channel inside `processDeliveryQueue()` that
        knows how to actually send it and report { ok, error }.
     No changes are needed to notify(), preferences, or the DB schema shape
     — notification_deliveries is already channel-agnostic.
   ========================================================================== */

const CHANNELS = ['telegram']; // in_app is not a "delivery" — it's the notifications row itself

/* --------------------------------------------------------------------------
   1. Notification type registry
   -------------------------------------------------------------------------- */

const URGENCY_LEVELS = ['Critical', 'Urgent', 'Normal', 'Info'];

const CATEGORIES = ['emergency', 'request_status', 'reminders', 'inventory', 'account'];

const CATEGORY_LABELS = {
  emergency: 'Emergency alerts (blood requests & donor matches)',
  request_status: 'Request status updates (accepted / declined / fulfilled)',
  reminders: 'Appointment & camp reminders',
  inventory: 'Inventory & shortage alerts',
  account: 'Account & security'
};

// Categories where the in-app copy can never be turned off — these are life-safety
// or account-security critical. Telegram delivery for these is still user-controllable.
const LOCKED_CATEGORIES = ['emergency', 'account'];

// type -> metadata. `dedupeWindowMinutes: 0` means never suppress (still only ever
// fired once per real event by the caller, but no time-based anti-spam window).
const NOTIFICATION_TYPES = {
  // ---- Emergency ----
  emergency_request: {
    category: 'emergency', label: 'Emergency blood request', defaultUrgency: 'Critical',
    telegramEligible: true, dedupeWindowMinutes: 30
  },
  donor_match: {
    category: 'emergency', label: 'Compatible donor match', defaultUrgency: 'Urgent',
    telegramEligible: true, dedupeWindowMinutes: 60
  },

  // ---- Request status ----
  donor_accepted: {
    category: 'request_status', label: 'Donor accepts request', defaultUrgency: 'Urgent',
    telegramEligible: false, dedupeWindowMinutes: 0
  },
  donor_declined: {
    category: 'request_status', label: 'Donor declines request', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 0
  },
  donor_reserved: {
    category: 'request_status', label: 'You have been selected', defaultUrgency: 'Urgent',
    telegramEligible: true, dedupeWindowMinutes: 0
  },
  request_fulfilled: {
    category: 'request_status', label: 'Blood request fulfilled', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 0
  },
  donation_thanks: {
    category: 'request_status', label: 'Thank-you for donating', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 0
  },

  // ---- Reminders ----
  appointment_reminder: {
    category: 'reminders', label: 'Appointment reminder', defaultUrgency: 'Normal',
    telegramEligible: true, dedupeWindowMinutes: 12 * 60
  },
  camp_reminder: {
    category: 'reminders', label: 'Donation camp reminder', defaultUrgency: 'Normal',
    telegramEligible: true, dedupeWindowMinutes: 12 * 60
  },
  camp_update: {
    category: 'reminders', label: 'Camp registration update', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 0
  },

  // ---- Inventory ----
  blood_shortage_alert: {
    category: 'inventory', label: 'Blood shortage alert', defaultUrgency: 'Urgent',
    telegramEligible: true, dedupeWindowMinutes: 6 * 60
  },
  inventory_warning: {
    category: 'inventory', label: 'Blood inventory warning', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 6 * 60
  },
  transfer_update: {
    category: 'inventory', label: 'Transfer update', defaultUrgency: 'Normal',
    telegramEligible: false, dedupeWindowMinutes: 0
  },

  // ---- Account ----
  otp: {
    category: 'account', label: 'Security code', defaultUrgency: 'Normal',
    telegramEligible: true, dedupeWindowMinutes: 0
  },
  system: {
    category: 'account', label: 'System notice', defaultUrgency: 'Info',
    telegramEligible: false, dedupeWindowMinutes: 0
  }
};

const DEFAULT_TYPE_META = {
  category: 'account', label: 'Notification', defaultUrgency: 'Normal',
  telegramEligible: false, dedupeWindowMinutes: 0
};

const getTypeMeta = (type) => NOTIFICATION_TYPES[type] || DEFAULT_TYPE_META;

const isLockedCategory = (category) => LOCKED_CATEGORIES.includes(category);

const resolveUrgency = (type, override) => {
  if (override && URGENCY_LEVELS.includes(override)) return override;
  return getTypeMeta(type).defaultUrgency;
};

/* --------------------------------------------------------------------------
   2. Preferences (per user, per category)
   -------------------------------------------------------------------------- */

const getPreference = (db, userId, category) => {
  const row = db
    .prepare('SELECT in_app, telegram FROM notification_preferences WHERE user_id = ? AND category = ?')
    .get(userId, category);
  if (!row) return { inApp: true, telegram: true };
  return { inApp: !!row.in_app, telegram: !!row.telegram };
};

// Full preference set for a user, across every category, filling in defaults
// for any category the user has never explicitly configured.
const listPreferences = (db, userId) => {
  const rows = db.prepare('SELECT category, in_app, telegram FROM notification_preferences WHERE user_id = ?').all(userId);
  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      label: CATEGORY_LABELS[category],
      locked: isLockedCategory(category), // in-app cannot be disabled for locked categories
      inApp: row ? !!row.in_app : true,
      telegram: row ? !!row.telegram : true
    };
  });
};

const setPreference = (db, userId, category, { inApp, telegram } = {}) => {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Unknown notification category: ${category}`);
  }
  // Locked categories can never have their in-app delivery switched off — that's the
  // whole point of "clearly distinguish urgent messages" for life-safety notifications.
  const inAppVal = isLockedCategory(category) ? 1 : (inApp === false ? 0 : 1);
  const telegramVal = telegram === false ? 0 : 1;
  const existing = db.prepare('SELECT 1 FROM notification_preferences WHERE user_id = ? AND category = ?').get(userId, category);
  if (existing) {
    db.prepare(
      `UPDATE notification_preferences SET in_app = ?, telegram = ?, updated_at = datetime('now') WHERE user_id = ? AND category = ?`
    ).run(inAppVal, telegramVal, userId, category);
  } else {
    db.prepare(
      `INSERT INTO notification_preferences (user_id, category, in_app, telegram) VALUES (?, ?, ?, ?)`
    ).run(userId, category, inAppVal, telegramVal);
  }
  return { category, inApp: !!inAppVal, telegram: !!telegramVal, locked: isLockedCategory(category) };
};

/* --------------------------------------------------------------------------
   3. Anti-spam de-duplication
   -------------------------------------------------------------------------- */

// True if this exact (user, type, related entity) combo already got a
// notification within the type's configured window — so we don't spam.
const isDuplicateRecent = (db, { userId, type, relatedType, relatedId, windowMinutes }) => {
  if (!windowMinutes) return false;
  const row = db
    .prepare(
      `SELECT id FROM notifications
       WHERE user_id = ? AND type = ?
         AND IFNULL(related_type, '') = IFNULL(?, '')
         AND IFNULL(related_id, '') = IFNULL(?, '')
         AND created_at >= datetime('now', ?)
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, type, relatedType || null, relatedId || null, `-${windowMinutes} minutes`);
  return !!row;
};

/* --------------------------------------------------------------------------
   4. Core notify()
   -------------------------------------------------------------------------- */

/**
 * Create (or suppress) a notification for one user, honoring their
 * preferences and the type's anti-spam window, then queue any eligible
 * external delivery (e.g. Telegram) for the background delivery sweep.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.type            One of NOTIFICATION_TYPES' keys (unknown types fall back to 'system'-like defaults).
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.relatedType]
 * @param {string} [opts.relatedId]
 * @param {string} [opts.urgency]       Overrides the type's default urgency (must be one of URGENCY_LEVELS).
 * @returns {{ skipped: true, reason: string } | { skipped: false, notificationId: number, urgency: string, category: string, telegramQueued: boolean }}
 */
const notify = (db, opts) => {
  const { userId, type, title, message, relatedType = null, relatedId = null, urgency = null } = opts;
  if (!userId || !type || !title || !message) {
    throw new Error('notify() requires userId, type, title, and message');
  }

  const meta = getTypeMeta(type);
  const finalUrgency = resolveUrgency(type, urgency);

  if (isDuplicateRecent(db, { userId, type, relatedType, relatedId, windowMinutes: meta.dedupeWindowMinutes })) {
    return { skipped: true, reason: 'duplicate-suppressed' };
  }

  const prefs = getPreference(db, userId, meta.category);
  // Locked categories always deliver in-app regardless of stored preference.
  const inAppAllowed = isLockedCategory(meta.category) ? true : prefs.inApp;
  if (!inAppAllowed) {
    return { skipped: true, reason: 'muted-by-preference' };
  }

  const result = db
    .prepare(
      `INSERT INTO notifications (user_id, type, category, title, message, channel, related_type, related_id, urgency)
       VALUES (?, ?, ?, ?, ?, 'in_app', ?, ?, ?)`
    )
    .run(userId, type, meta.category, title, message, relatedType, relatedId, finalUrgency);
  const notificationId = Number(result.lastInsertRowid);

  let telegramQueued = false;
  if (meta.telegramEligible && prefs.telegram) {
    const user = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(userId);
    if (user && user.telegram_chat_id) {
      queueDelivery(db, { notificationId, channel: 'telegram' });
      telegramQueued = true;
    }
  }

  return { skipped: false, notificationId, urgency: finalUrgency, category: meta.category, telegramQueued };
};

/** Convenience for fanning the same event out to many users (e.g. all matched donors). */
const notifyMany = (db, userIds, opts) => userIds.map((userId) => notify(db, { ...opts, userId }));

/* --------------------------------------------------------------------------
   5. External delivery queue + retry (Telegram today; email/SMS/push later)
   -------------------------------------------------------------------------- */

const MAX_ATTEMPTS = 5;
// Backoff schedule indexed by attempt count so far: 1min, 5min, 15min, 1hr, 4hr.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

const computeBackoffMinutes = (attemptsSoFar) => BACKOFF_MINUTES[Math.min(attemptsSoFar, BACKOFF_MINUTES.length - 1)];

const queueDelivery = (db, { notificationId, channel }) => {
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown delivery channel: ${channel}`);
  db.prepare(
    `INSERT INTO notification_deliveries (notification_id, channel, status, attempts, next_retry_at) VALUES (?, ?, 'pending', 0, datetime('now'))`
  ).run(notificationId, channel);
};

const urgencyPrefix = (urgency) => {
  if (urgency === 'Critical') return '🚨 URGENT — ';
  if (urgency === 'Urgent') return '⚠️ ';
  return '';
};

/**
 * Processes due (pending / retrying, next_retry_at <= now) external deliveries.
 * Never touches the in-app notification row — a failed/retrying Telegram send
 * has zero effect on what the user sees in their in-app notification list.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} opts
 * @param {(chatId: string, text: string) => Promise<{ok: boolean, error?: string}>} opts.sendTelegramMessage
 * @param {number} [opts.limit]
 */
const processDeliveryQueue = async (db, { sendTelegramMessage, limit = 25 }) => {
  const due = db
    .prepare(
      `SELECT nd.*, n.user_id, n.title, n.message, n.urgency, n.type
       FROM notification_deliveries nd
       JOIN notifications n ON n.id = nd.notification_id
       WHERE nd.status IN ('pending', 'retrying') AND nd.next_retry_at <= datetime('now')
       ORDER BY nd.id ASC LIMIT ?`
    )
    .all(limit);

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    if (row.channel !== 'telegram') continue; // only channel implemented today

    const user = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(row.user_id);
    const chatId = user && user.telegram_chat_id;

    if (!chatId) {
      db.prepare(
        `UPDATE notification_deliveries SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`
      ).run('No linked Telegram chat for this user', row.id);
      failed++;
      continue;
    }

    const text = `${urgencyPrefix(row.urgency)}<b>${row.title}</b>\n\n${row.message}`;
    let result;
    try {
      result = await sendTelegramMessage(chatId, text);
    } catch (err) {
      result = { ok: false, error: err.message };
    }

    if (result && result.ok) {
      db.prepare(
        `UPDATE notification_deliveries SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(row.id);
      sent++;
    } else {
      const attempts = row.attempts + 1;
      const errorMsg = (result && result.error) || 'Unknown delivery error';
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare(
          `UPDATE notification_deliveries SET status = 'failed', attempts = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(attempts, errorMsg, row.id);
        failed++;
      } else {
        const waitMinutes = computeBackoffMinutes(attempts);
        db.prepare(
          `UPDATE notification_deliveries SET status = 'retrying', attempts = ?, last_error = ?, next_retry_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`
        ).run(attempts, errorMsg, `+${waitMinutes} minutes`, row.id);
        retried++;
      }
    }
  }

  return { processed: due.length, sent, failed, retried };
};

/* --------------------------------------------------------------------------
   6. In-app read/unread + history helpers
   -------------------------------------------------------------------------- */

const listNotifications = (db, userId, { unreadOnly = false } = {}) => {
  const sql = unreadOnly
    ? 'SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC'
    : 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC';
  return db.prepare(sql).all(userId).map((n) => ({ ...n, read: !!n.read_at }));
};

const getUnreadCount = (db, userId) => {
  const row = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId);
  const urgentRow = db
    .prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL AND urgency IN ('Critical','Urgent')`)
    .get(userId);
  return { total: row.c, urgent: urgentRow.c };
};

const markRead = (db, id) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`).run(id);
};

const markAllRead = (db, userId) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(userId);
};

module.exports = {
  // registry
  NOTIFICATION_TYPES,
  CATEGORIES,
  CATEGORY_LABELS,
  URGENCY_LEVELS,
  LOCKED_CATEGORIES,
  getTypeMeta,
  isLockedCategory,
  resolveUrgency,
  // preferences
  getPreference,
  listPreferences,
  setPreference,
  // anti-spam
  isDuplicateRecent,
  // core
  notify,
  notifyMany,
  // delivery queue
  queueDelivery,
  computeBackoffMinutes,
  processDeliveryQueue,
  urgencyPrefix,
  MAX_ATTEMPTS,
  BACKOFF_MINUTES,
  // read state / history
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead
};
