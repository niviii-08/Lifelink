const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const notifications = require('../services/notifications');

const {
  getTypeMeta,
  resolveUrgency,
  isDuplicateRecent,
  notify,
  notifyMany,
  listPreferences,
  setPreference,
  getPreference,
  queueDelivery,
  computeBackoffMinutes,
  processDeliveryQueue,
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  LOCKED_CATEGORIES
} = notifications;

/* ---------------------------------------------------------------------- */
/* Minimal in-memory schema — just enough of the real tables for the      */
/* notification service to operate against, mirroring setup_db.js.       */
/* ---------------------------------------------------------------------- */

const buildTestDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      telegram_chat_id TEXT
    );
    CREATE TABLE notifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT,
      type         TEXT,
      category     TEXT DEFAULT 'account',
      title        TEXT,
      message      TEXT,
      urgency      TEXT DEFAULT 'Normal',
      channel      TEXT DEFAULT 'in_app',
      related_type TEXT,
      related_id   TEXT,
      read_at      TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE notification_preferences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      category   TEXT NOT NULL,
      in_app     INTEGER DEFAULT 1,
      telegram   INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, category)
    );
    CREATE TABLE notification_deliveries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER NOT NULL,
      channel         TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      attempts        INTEGER DEFAULT 0,
      last_error      TEXT,
      next_retry_at   TEXT DEFAULT (datetime('now')),
      sent_at         TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare('INSERT INTO users (id, telegram_chat_id) VALUES (?, ?)').run('donor1', '999888777');
  db.prepare('INSERT INTO users (id, telegram_chat_id) VALUES (?, ?)').run('donor2', null);
  return db;
};

/* ---------------------------------------------------------------------- */
/* Type registry                                                          */
/* ---------------------------------------------------------------------- */

test('getTypeMeta: known type returns its registered category/urgency', () => {
  const meta = getTypeMeta('emergency_request');
  assert.equal(meta.category, 'emergency');
  assert.equal(meta.defaultUrgency, 'Critical');
});

test('getTypeMeta: unknown type falls back to a safe default instead of throwing', () => {
  const meta = getTypeMeta('totally_made_up_type');
  assert.equal(meta.category, 'account');
  assert.equal(meta.defaultUrgency, 'Normal');
});

test('resolveUrgency: explicit override wins when it is a valid level', () => {
  assert.equal(resolveUrgency('camp_reminder', 'Critical'), 'Critical');
});

test('resolveUrgency: invalid override is ignored, falls back to the type default', () => {
  assert.equal(resolveUrgency('camp_reminder', 'NotARealLevel'), 'Normal');
});

test('every required event from the notification spec is registered', () => {
  const required = [
    'emergency_request', 'donor_match', 'donor_accepted', 'donor_declined',
    'request_fulfilled', 'appointment_reminder', 'camp_reminder',
    'blood_shortage_alert', 'inventory_warning'
  ];
  required.forEach((type) => {
    assert.ok(notifications.NOTIFICATION_TYPES[type], `missing type registration: ${type}`);
  });
});

/* ---------------------------------------------------------------------- */
/* Preferences                                                            */
/* ---------------------------------------------------------------------- */

test('listPreferences: defaults to everything on when nothing configured', () => {
  const db = buildTestDb();
  const prefs = listPreferences(db, 'donor1');
  assert.equal(prefs.length, notifications.CATEGORIES.length);
  prefs.forEach((p) => {
    assert.equal(p.inApp, true);
    assert.equal(p.telegram, true);
  });
});

test('setPreference: user can turn off reminders entirely', () => {
  const db = buildTestDb();
  const result = setPreference(db, 'donor1', 'reminders', { inApp: false, telegram: false });
  assert.equal(result.inApp, false);
  assert.equal(result.telegram, false);
  const pref = getPreference(db, 'donor1', 'reminders');
  assert.equal(pref.inApp, false);
});

test('setPreference: locked categories (emergency, account) cannot have in-app disabled', () => {
  const db = buildTestDb();
  LOCKED_CATEGORIES.forEach((category) => {
    const result = setPreference(db, 'donor1', category, { inApp: false, telegram: false });
    assert.equal(result.inApp, true, `${category} in-app should stay on`);
    assert.equal(result.telegram, false, `${category} telegram should still be toggleable`);
  });
});

test('setPreference: rejects an unknown category', () => {
  const db = buildTestDb();
  assert.throws(() => setPreference(db, 'donor1', 'not_a_category', { inApp: false }));
});

/* ---------------------------------------------------------------------- */
/* notify() — in-app creation, preferences, anti-spam                     */
/* ---------------------------------------------------------------------- */

test('notify: creates an in-app row with the type\'s default urgency', () => {
  const db = buildTestDb();
  const result = notify(db, {
    userId: 'donor1', type: 'donor_match', title: 'A+ needed', message: 'Nearby hospital needs A+ blood.',
    relatedType: 'emergency', relatedId: 'e1'
  });
  assert.equal(result.skipped, false);
  assert.equal(result.urgency, 'Urgent');
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.notificationId);
  assert.equal(row.user_id, 'donor1');
  assert.equal(row.category, 'emergency');
});

test('notify: queues a Telegram delivery when the user has a linked chat and telegram pref is on', () => {
  const db = buildTestDb();
  const result = notify(db, { userId: 'donor1', type: 'donor_match', title: 'Title', message: 'Msg', relatedId: 'e2' });
  assert.equal(result.telegramQueued, true);
  const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE notification_id = ?').get(result.notificationId);
  assert.equal(delivery.channel, 'telegram');
  assert.equal(delivery.status, 'pending');
});

test('notify: does not queue Telegram delivery when user has no linked chat', () => {
  const db = buildTestDb();
  const result = notify(db, { userId: 'donor2', type: 'donor_match', title: 'Title', message: 'Msg', relatedId: 'e3' });
  assert.equal(result.telegramQueued, false);
  const count = db.prepare('SELECT COUNT(*) as c FROM notification_deliveries').get().c;
  assert.equal(count, 0);
});

test('notify: respects a muted category and skips creating the notification', () => {
  const db = buildTestDb();
  setPreference(db, 'donor1', 'reminders', { inApp: false });
  const result = notify(db, { userId: 'donor1', type: 'camp_reminder', title: 'Camp tomorrow', message: 'Reminder' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'muted-by-preference');
});

test('notify: locked category always delivers in-app even if a stray preference row says otherwise', () => {
  const db = buildTestDb();
  // Directly force a bad row bypassing setPreference's guard, to prove notify() itself enforces the lock.
  db.prepare('INSERT INTO notification_preferences (user_id, category, in_app, telegram) VALUES (?, ?, 0, 1)').run('donor1', 'emergency');
  const result = notify(db, { userId: 'donor1', type: 'emergency_request', title: 'Critical need', message: 'Please help' });
  assert.equal(result.skipped, false);
});

test('notify: anti-spam suppresses a duplicate within the dedupe window for the same related entity', () => {
  const db = buildTestDb();
  const first = notify(db, { userId: 'donor1', type: 'camp_reminder', title: 'Reminder', message: 'Camp soon', relatedType: 'camp', relatedId: 'c1' });
  const second = notify(db, { userId: 'donor1', type: 'camp_reminder', title: 'Reminder', message: 'Camp soon', relatedType: 'camp', relatedId: 'c1' });
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'duplicate-suppressed');
});

test('notify: anti-spam does NOT suppress the same type for a different related entity', () => {
  const db = buildTestDb();
  const first = notify(db, { userId: 'donor1', type: 'camp_reminder', title: 'Reminder', message: 'Camp A', relatedType: 'camp', relatedId: 'c1' });
  const second = notify(db, { userId: 'donor1', type: 'camp_reminder', title: 'Reminder', message: 'Camp B', relatedType: 'camp', relatedId: 'c2' });
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, false);
});

test('notify: types with no dedupe window (e.g. donor_accepted) can fire repeatedly for the same entity', () => {
  const db = buildTestDb();
  const first = notify(db, { userId: 'donor1', type: 'donor_accepted', title: 'Accepted', message: 'msg', relatedId: 'e1' });
  const second = notify(db, { userId: 'donor1', type: 'donor_accepted', title: 'Accepted again', message: 'msg2', relatedId: 'e1' });
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, false);
});

test('notifyMany: fans a notification out to multiple users', () => {
  const db = buildTestDb();
  db.prepare('INSERT INTO users (id, telegram_chat_id) VALUES (?, ?)').run('donor3', null);
  const results = notifyMany(db, ['donor1', 'donor2', 'donor3'], { type: 'donor_match', title: 'T', message: 'M', relatedId: 'e9' });
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => !r.skipped));
});

/* ---------------------------------------------------------------------- */
/* Read / unread + history                                                */
/* ---------------------------------------------------------------------- */

test('listNotifications + getUnreadCount + markRead + markAllRead work end to end', () => {
  const db = buildTestDb();
  const a = notify(db, { userId: 'donor1', type: 'donor_match', title: 'T1', message: 'M1', urgency: 'Critical', relatedId: 'e1' });
  const b = notify(db, { userId: 'donor1', type: 'camp_update', title: 'T2', message: 'M2', relatedId: 'c1' });

  assert.equal(listNotifications(db, 'donor1').length, 2);
  let unread = getUnreadCount(db, 'donor1');
  assert.equal(unread.total, 2);
  assert.equal(unread.urgent, 1); // only the Critical one

  markRead(db, a.notificationId);
  unread = getUnreadCount(db, 'donor1');
  assert.equal(unread.total, 1);
  assert.equal(unread.urgent, 0);

  markAllRead(db, 'donor1');
  unread = getUnreadCount(db, 'donor1');
  assert.equal(unread.total, 0);

  const onlyUnread = listNotifications(db, 'donor1', { unreadOnly: true });
  assert.equal(onlyUnread.length, 0);
  void b;
});

/* ---------------------------------------------------------------------- */
/* Delivery queue + retry with exponential backoff                        */
/* ---------------------------------------------------------------------- */

test('computeBackoffMinutes: escalates with attempts and caps at the last configured step', () => {
  assert.equal(computeBackoffMinutes(0), 1);
  assert.equal(computeBackoffMinutes(1), 5);
  assert.equal(computeBackoffMinutes(2), 15);
  assert.equal(computeBackoffMinutes(3), 60);
  assert.equal(computeBackoffMinutes(4), 240);
  assert.equal(computeBackoffMinutes(99), 240); // never goes out of bounds
});

test('processDeliveryQueue: marks a delivery sent on success', async () => {
  const db = buildTestDb();
  const { notificationId } = notify(db, { userId: 'donor1', type: 'donor_match', title: 'T', message: 'M', relatedId: 'e1' });
  const sendTelegramMessage = async () => ({ ok: true });
  const result = await processDeliveryQueue(db, { sendTelegramMessage });
  assert.equal(result.sent, 1);
  const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE notification_id = ?').get(notificationId);
  assert.equal(delivery.status, 'sent');
  assert.ok(delivery.sent_at);
});

test('processDeliveryQueue: schedules a retry with backoff on failure, does not mark failed yet', async () => {
  const db = buildTestDb();
  notify(db, { userId: 'donor1', type: 'donor_match', title: 'T', message: 'M', relatedId: 'e1' });
  const sendTelegramMessage = async () => ({ ok: false, error: 'Telegram API down' });
  const result = await processDeliveryQueue(db, { sendTelegramMessage });
  assert.equal(result.retried, 1);
  assert.equal(result.failed, 0);
  const delivery = db.prepare('SELECT * FROM notification_deliveries').get();
  assert.equal(delivery.status, 'retrying');
  assert.equal(delivery.attempts, 1);
  assert.equal(delivery.last_error, 'Telegram API down');
});

test('processDeliveryQueue: gives up and marks failed after MAX_ATTEMPTS', async () => {
  const db = buildTestDb();
  notify(db, { userId: 'donor1', type: 'donor_match', title: 'T', message: 'M', relatedId: 'e1' });
  const sendTelegramMessage = async () => ({ ok: false, error: 'Telegram API down' });

  for (let i = 0; i < notifications.MAX_ATTEMPTS; i++) {
    // Force the row to be due immediately regardless of backoff, to drive it through all attempts in this test.
    db.prepare("UPDATE notification_deliveries SET next_retry_at = datetime('now', '-1 minute')").run();
    // eslint-disable-next-line no-await-in-loop
    await processDeliveryQueue(db, { sendTelegramMessage });
  }
  const delivery = db.prepare('SELECT * FROM notification_deliveries').get();
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.attempts, notifications.MAX_ATTEMPTS);
});

test('processDeliveryQueue: a delivery with no linked Telegram chat is failed immediately, not retried', async () => {
  const db = buildTestDb();
  // donor2 has no telegram_chat_id, but force-queue a delivery anyway to simulate the chat being unlinked after queuing.
  const { notificationId } = notify(db, { userId: 'donor2', type: 'system', title: 'T', message: 'M' });
  queueDelivery(db, { notificationId, channel: 'telegram' });
  const sendTelegramMessage = async () => ({ ok: true }); // should never be called
  let called = false;
  const result = await processDeliveryQueue(db, { sendTelegramMessage: async (...args) => { called = true; return sendTelegramMessage(...args); } });
  assert.equal(called, false);
  assert.equal(result.failed, 1);
  const delivery = db.prepare('SELECT * FROM notification_deliveries').get();
  assert.equal(delivery.status, 'failed');
});

test('processDeliveryQueue: a failed/sent in-app notification is never affected by delivery outcome', async () => {
  const db = buildTestDb();
  const { notificationId } = notify(db, { userId: 'donor1', type: 'donor_match', title: 'T', message: 'M', relatedId: 'e1' });
  await processDeliveryQueue(db, { sendTelegramMessage: async () => ({ ok: false, error: 'boom' }) });
  const notifRow = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId);
  assert.equal(notifRow.read_at, null); // still there, still unread, untouched by delivery failure
});
