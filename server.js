require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const bcrypt = require('bcryptjs');
const BCRYPT_COST = 12; // raised from the previous 8 — still fast enough for interactive login, meaningfully harder to brute-force offline if the DB is ever exfiltrated
const { DatabaseSync } = require('node:sqlite');
const { sendTelegramMessage, generateOtpCode, startTelegramPolling } = require('./telegram');
const { sendEmail } = require('./mailer');
const { rankDonorsForRequest, DEFAULT_WEIGHTS, MATCHING_STRATEGY } = require('./matching');
const notificationService = require('./services/notifications');
const { getActorFromRequest, admin } = require('./firebase_auth');
const { rateLimit } = require('./rateLimit');
const { ensureAuditTable, makeAuditLogger } = require('./audit');

const app = express();
const PORT = process.env.PORT || 8000;

// Trust the first proxy hop (needed for correct req.ip behind a load balancer / reverse
// proxy) only when explicitly enabled — left off by default so rate limiting can't be
// trivially bypassed by a spoofed X-Forwarded-For header on an untrusted network.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

const db = new DatabaseSync(path.join(__dirname, 'lifelink.db'));
db.exec('PRAGMA foreign_keys = ON;');
console.log('Connected to the SQLite database (node:sqlite).');
ensureAuditTable(db);
const auditLog = makeAuditLogger(db);


const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8001';
app.use(['/api/nlp', '/api/chat', '/api/rag'], createProxyMiddleware({
  target: PYTHON_API_URL,
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      console.error('[Proxy Error]', err.message);
      res.status(502).json({ error: 'AI Microservice is currently unavailable.' });
    }
  }
}));

app.use(express.json());


// ---- Baseline security headers (dependency-free) ----
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'client/dist')));

// Minimal HTML-escaping for any user-supplied string interpolated into a Telegram
// message sent with parse_mode: 'HTML' — without this, a crafted name/hospital/ward
// value could inject markup (e.g. a phishing <a href>) into an otherwise-trusted bot message.
const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ==========================================
   AUTHENTICATION / AUTHORIZATION MIDDLEWARE
   ------------------------------------------
   Real, server-issued session tokens (see auth.js) replace the previous
   scheme, which trusted a raw client-supplied X-Actor-Id header with no
   proof of authentication — anyone could impersonate any user, including
   Admins, just by sending a known/guessable user id.

   The client now sends `Authorization: Bearer <token>` on every request
   once logged in. The token is only ever minted by the server, at
   successful login / OTP verification (see /api/auth/* below), and is
   verified here on every request. The actor's role is always re-read from
   the database (never trusted from the token or any header), so a
   suspension or role change takes effect on the very next request.
   ========================================== */



const requireRole = (...roles) => async (req, res, next) => {
  const actor = await getActorFromRequest(req, db);
  if (!actor) return res.status(401).json({ error: 'Authentication required.' });
  if (!roles.includes(actor.role)) {
    return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}.` });
  }
  req.actor = actor;
  next();
};

// Any authenticated user, regardless of role.
const requireAuth = async (req, res, next) => {
  const actor = await getActorFromRequest(req, db);
  if (!actor) return res.status(401).json({ error: 'Authentication required.' });
  req.actor = actor;
  next();
};

// Convenience shorthand guards
const requireAdmin = requireRole('Admin');
const requireHospital = requireRole('Hospital', 'Admin');
const requireBloodBank = requireRole('Blood Bank', 'Admin');
const requireDonor = requireRole('Donor', 'Admin');

// A non-admin actor may only act on their own record. Use after requireHospital /
// requireBloodBank / requireAuth for routes with a :id param that must match the actor,
// closing the "any hospital can edit any other hospital's profile" class of IDOR.
const requireSelfOrAdmin = (req, res, next) => {
  if (req.actor.role === 'Admin') return next();
  if (req.actor.id !== req.params.id) {
    return res.status(403).json({ error: 'You can only modify your own account.' });
  }
  next();
};

// Generic error responder: always logs full detail server-side. For the client-facing
// message, deliberate validation/business errors thrown by route logic (e.g. "Cannot
// move an emergency from X to Y", "Insufficient stock of O+") are short and safe to
// show as-is — but a raw driver/runtime exception (SQLite constraint text, stack
// fragments, file paths) is masked with a generic message so internals never leak.
const UNSAFE_ERROR_PATTERN = /sqlite|ENOENT|EACCES|undefined is not|is not a function|cannot read propert|at Object\.|at Module\.|\.js:\d+/i;
const isSafeClientMessage = (msg) => typeof msg === 'string' && msg.length > 0 && msg.length < 200 && !UNSAFE_ERROR_PATTERN.test(msg);
const sendError = (res, err, status = 500) => {
  console.error(err);
  const message = isSafeClientMessage(err?.message) ? err.message : 'Internal server error. Please try again.';
  res.status(status).json({ error: message });
};

/* ==========================================
   REAL-TIME EVENTS (Server-Sent Events)
   ------------------------------------------
   No WebSocket library exists in this project yet, and SSE is the most
   suitable fit for the current architecture: it's plain HTTP (works
   through the existing Express server and the Vite dev proxy with zero
   extra dependencies or ports), one-way server->client push is exactly
   what the emergency workflow needs, and the browser's native
   EventSource API handles reconnection automatically.
   ========================================== */

const sseClients = new Set();

app.get('/api/events/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* client gone, cleaned up on close */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

const broadcastEvent = (type, payload) => {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((client) => {
    try { client.write(message); } catch { sseClients.delete(client); }
  });
};

/* ==========================================
   NOTIFICATION SERVICE WIRING
   ------------------------------------------
   Thin bindings over services/notifications.js so every route in this file
   creates notifications through one consistent path: type registry lookup ->
   preference check -> anti-spam dedupe -> in-app row -> (optional) queued
   external delivery. See services/notifications.js for the full design.
   ========================================== */

// Create one in-app notification, respecting preferences + anti-spam. Also fires a
// best-effort immediate delivery-queue pass so a queued Telegram alert goes out right
// away when possible; the periodic sweep below is what guarantees retries otherwise.
const notify = (opts) => {
  const result = notificationService.notify(db, opts);
  if (!result.skipped) {
    broadcastEvent('notification:new', { userId: opts.userId, notificationId: result.notificationId, type: opts.type, urgency: result.urgency });
    if (result.telegramQueued) {
      notificationService.processDeliveryQueue(db, { sendTelegramMessage, limit: 5 }).catch(() => {});
    }
  }
  return result;
};

const notifyMany = (userIds, opts) => userIds.map((userId) => notify({ ...opts, userId }));

// Background sweep: retries any pending/retrying external deliveries (Telegram today)
// whose backoff window has elapsed. Runs independently of in-app notifications, which
// are already durable the moment notify() returns.
setInterval(() => {
  notificationService.processDeliveryQueue(db, { sendTelegramMessage, limit: 50 }).catch((err) => {
    console.error('[notifications] delivery sweep error:', err.message);
  });
}, 20000);

/* ==========================================
   LOOKUP HELPERS (blood groups, locations)
   ========================================== */

const bloodGroupRows = db.prepare('SELECT id, type FROM blood_groups').all();
const groupIdByType = {};
const typeByGroupId = {};
bloodGroupRows.forEach((r) => {
  groupIdByType[r.type] = r.id;
  typeByGroupId[r.id] = r.type;
});

const findOrCreateLocation = (label, lat, lng) => {
  if (!label) label = 'Coimbatore';
  const existing = db.prepare('SELECT id FROM locations WHERE label = ?').get(label);
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO locations (label, address, city, lat, lng) VALUES (?, ?, ?, ?, ?)')
    .run(label, label, 'Coimbatore', lat ?? null, lng ?? null);
  return Number(info.lastInsertRowid);
};

const locationLabel = (locationId) => {
  if (!locationId) return 'Coimbatore';
  const row = db.prepare('SELECT label FROM locations WHERE id = ?').get(locationId);
  return row ? row.label : 'Coimbatore';
};

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/* ==========================================
   USERS API  (reconstructs the legacy flat shape the client expects,
   on top of the normalized users / donor_profiles / hospital_profiles /
   blood_bank_profiles / camp_registrations tables)
   ========================================== */

const buildUserResponse = (u) => {
  let bloodType = 'Multiple';
  if (u.role === 'Donor') {
    const dp = db.prepare('SELECT blood_group_id FROM donor_profiles WHERE user_id = ?').get(u.id);
    if (dp) bloodType = typeByGroupId[dp.blood_group_id] || 'O+';
  }

  let activeCampRegistration = null;
  if (u.role === 'Donor') {
    const reg = db
      .prepare(
        `SELECT cr.verification_id, cr.slot, c.title, c.camp_date
         FROM camp_registrations cr JOIN camps c ON c.id = cr.camp_id
         WHERE cr.donor_id = ? AND cr.status = 'Registered'
         ORDER BY cr.id DESC LIMIT 1`
      )
      .get(u.id);
    if (reg) {
      activeCampRegistration = {
        campTitle: reg.title,
        verificationId: reg.verification_id,
        date: reg.camp_date,
        slot: reg.slot
      };
    }
  }

  return {
    id: u.id,
    name: u.name,
    role: u.role,
    bloodType,
    location: locationLabel(u.location_id),
    status: u.status,
    passportId: u.passport_id,
    donations: u.total_donations,
    xp: u.xp,
    isNewRegistration: !!u.is_new_registration,
    pendingUpdate: u.pending_update ? JSON.parse(u.pending_update) : null,
    activeCampRegistration,
    // Precise coordinates, phone number, and Telegram chat id are private contact/
    // location details — only ever attached below for the account owner or an Admin.
    lat: null,
    lng: null,
    telegramChatId: null,
    phone: null
  };
};

// Attaches the private fields (exact lat/lng, phone, Telegram chat id) that
// buildUserResponse() otherwise nulls out, but only when the viewer is allowed to see
// them: the account owner themself, or an Admin. Every other caller — including
// anonymous/unauthenticated requests — gets the public-safe shape only.
const withPrivateFieldsIfAuthorized = (publicUser, rawUser, viewerActor) => {
  const isSelf = viewerActor && viewerActor.id === rawUser.id;
  const isAdmin = viewerActor && viewerActor.role === 'Admin';
  if (!isSelf && !isAdmin) return publicUser;
  return { ...publicUser, lat: rawUser.lat, lng: rawUser.lng, telegramChatId: rawUser.telegram_chat_id, phone: rawUser.phone };
};

app.get('/api/users', (req, res) => {
  try {
    const viewer = getActorFromRequest(req); // optional — anonymous browsing is allowed, but gets sanitized rows
    const rows = db.prepare('SELECT * FROM users').all();
    res.json(rows.map((u) => withPrivateFieldsIfAuthorized(buildUserResponse(u), u, viewer)));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/users', rateLimit('register', 20, 3600000), (req, res) => {
  try {
    const { name, role, bloodType, location, status, isNewRegistration, password, lat, lng, telegramChatId, licenseNumber, accreditationDoc, phone } = req.body;

    // telegramChatId is no longer required with Firebase Auth
    if (!name || !role) {
      return res.status(400).json({ error: 'name and role are required.' });
    }

    const prefix = role === 'Donor' ? 'LL' : role === 'Hospital' ? 'HP' : 'BB';
    const passportId = `${prefix}-2026-CBE-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalStatus = status || (role === 'Donor' ? 'Active' : 'Verified');
    const newReg = isNewRegistration ? 1 : 0;
    const initialXP = role === 'Donor' ? 0 : role === 'Blood Bank' ? 10000 : 5000;
    const initialDonations = role === 'Donor' ? 0 : role === 'Blood Bank' ? 240 : 45;
    
    // With Firebase Auth, we expect the frontend to pass the generated Firebase UID as 'firebaseUid'
    const id = req.body.firebaseUid || 'u' + Date.now();
    const passwordHash = 'FIREBASE_AUTH_MANAGED'; 
    const locationId = findOrCreateLocation(location, lat ?? null, lng ?? null);

    db.prepare(
      `INSERT INTO users (id, name, email, phone, role, password_hash, telegram_chat_id, passport_id,
                           status, is_new_registration, total_donations, xp, location_id, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, null, phone || null, role, passwordHash, telegramChatId, passportId, finalStatus, newReg, initialDonations, initialXP, locationId, lat ?? null, lng ?? null);

    if (role === 'Donor') {
      const groupId = groupIdByType[bloodType] || groupIdByType['O+'];
      db.prepare(
        `INSERT INTO donor_profiles (user_id, blood_group_id, availability_status) VALUES (?, ?, ?)`
      ).run(id, groupId, finalStatus);
    } else if (role === 'Hospital') {
      db.prepare(
        `INSERT INTO hospital_profiles (user_id, license_number, accreditation_doc, location_id, verification_status)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, licenseNumber || null, accreditationDoc || null, locationId, finalStatus === 'Verified' ? 'Verified Partner' : 'Pending Verification');
    } else if (role === 'Blood Bank') {
      db.prepare(
        `INSERT INTO blood_bank_profiles (user_id, license_number, location_id, verification_status)
         VALUES (?, ?, ?, ?)`
      ).run(id, licenseNumber || null, locationId, finalStatus === 'Verified' ? 'Verified Partner' : 'Pending Verification');
      // Start with an empty inventory row per blood group so totals compute cleanly
      Object.values(groupIdByType).forEach((gId) => {
        db.prepare('INSERT OR IGNORE INTO blood_inventory (blood_bank_id, blood_group_id, units) VALUES (?, ?, 0)').run(id, gId);
      });
    }

    sendTelegramMessage(
      telegramChatId,
      `🎉 Welcome to <b>LifeLink</b>, ${escapeHtml(name)}!\n\nYour account (${escapeHtml(role)}) has been created. You'll receive sign-in OTPs and, if relevant, emergency blood alerts right here.`
    );

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json(withPrivateFieldsIfAuthorized(buildUserResponse(created), created, { id: created.id, role: created.role }));
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/users/:id', requireAuth, (req, res) => {
  try {
    const actor = req.actor;
    const { id } = req.params;
    const {
      name, location, bloodType, status, donations, xp, isNewRegistration, pendingUpdate,
      approveUpdate, rejectUpdate, approveOnboarding, denyOnboarding, activeCampRegistration,
      lat, lng, telegramChatId, phone
    } = req.body;

    // Admin-only operations: onboarding decisions and profile-update approvals
    const isAdminOp = approveOnboarding || denyOnboarding || approveUpdate || rejectUpdate;
    if (isAdminOp) {
      if (actor.role !== 'Admin') {
        return res.status(403).json({ error: 'Admin role required for this operation.' });
      }
    } else if (actor.id !== id && actor.role !== 'Admin') {
      // A non-admin can only update their own account
      return res.status(403).json({ error: 'You can only modify your own account.' });
    }

    if (approveOnboarding) {
      db.prepare('UPDATE users SET is_new_registration = 0, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status || 'Active', id);
      auditLog({ actorId: actor.id, actorRole: actor.role, action: 'onboarding_approved', targetType: 'user', targetId: id });
      return res.json({ success: true });
    }
    if (denyOnboarding) {
      auditLog({ actorId: actor.id, actorRole: actor.role, action: 'onboarding_denied', targetType: 'user', targetId: id });
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return res.json({ success: true });
    }
    if (pendingUpdate !== undefined) {
      db.prepare('UPDATE users SET pending_update = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(pendingUpdate ? JSON.stringify(pendingUpdate) : null, 'Pending Verification', id);
      return res.json({ success: true });
    }
    if (approveUpdate) {
      const row = db.prepare('SELECT pending_update FROM users WHERE id = ?').get(id);
      if (!row || !row.pending_update) return res.status(400).json({ error: 'No pending update found' });
      const pending = JSON.parse(row.pending_update);
      const locationId = findOrCreateLocation(pending.location, null, null);
      db.prepare('UPDATE users SET name = ?, location_id = ?, status = ?, pending_update = NULL, updated_at = datetime(\'now\') WHERE id = ?')
        .run(pending.name, locationId, status || 'Active', id);
      if (pending.bloodType) {
        const groupIdVal = groupIdByType[pending.bloodType];
        if (groupIdVal) {
          db.prepare('UPDATE donor_profiles SET blood_group_id = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(groupIdVal, id);
        }
      }
      auditLog({ actorId: actor.id, actorRole: actor.role, action: 'profile_update_approved', targetType: 'user', targetId: id });
      return res.json({ success: true });
    }
    if (rejectUpdate) {
      db.prepare('UPDATE users SET pending_update = NULL, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status || 'Active', id);
      auditLog({ actorId: actor.id, actorRole: actor.role, action: 'profile_update_rejected', targetType: 'user', targetId: id });
      return res.json({ success: true });
    }

    // General field update
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (location !== undefined) { fields.push('location_id = ?'); params.push(findOrCreateLocation(location, lat ?? null, lng ?? null)); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    // donations / xp are earned server-side (donation completion, emergency fulfillment,
    // hospital "approve draw" flow) — never accepted as a raw self-edit from a Donor.
    // Only an Admin, or the Hospital/Blood Bank actor recording the draw, may set them.
    const canSetEarnedFields = actor && (actor.role === 'Admin' || actor.role === 'Hospital' || actor.role === 'Blood Bank');
    if (donations !== undefined) {
      if (!canSetEarnedFields) return res.status(403).json({ error: 'Only an Admin, Hospital, or Blood Bank can record donations.' });
      fields.push('total_donations = ?'); params.push(donations);
    }
    if (xp !== undefined) {
      if (!canSetEarnedFields) return res.status(403).json({ error: 'Only an Admin, Hospital, or Blood Bank can adjust XP.' });
      fields.push('xp = ?'); params.push(xp);
    }
    if (isNewRegistration !== undefined) { fields.push('is_new_registration = ?'); params.push(isNewRegistration ? 1 : 0); }
    if (lat !== undefined) { fields.push('lat = ?'); params.push(lat); }
    if (lng !== undefined) { fields.push('lng = ?'); params.push(lng); }
    if (telegramChatId !== undefined) { fields.push('telegram_chat_id = ?'); params.push(telegramChatId); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      if (donations !== undefined || xp !== undefined) {
        auditLog({ actorId: actor?.id, actorRole: actor?.role, action: 'donation_credit_adjusted', targetType: 'user', targetId: id, detail: { donations, xp } });
      }
    }

    if (bloodType !== undefined && groupIdByType[bloodType]) {
      db.prepare('UPDATE donor_profiles SET blood_group_id = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(groupIdByType[bloodType], id);
    }

    if (activeCampRegistration !== undefined) {
      if (activeCampRegistration === null) {
        db.prepare("UPDATE camp_registrations SET status = 'Cancelled' WHERE donor_id = ? AND status = 'Registered'").run(id);
      }
      // (Creation of new registrations is handled via POST /api/camp_registrations)
    }

    if (fields.length === 0 && bloodType === undefined && activeCampRegistration === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   AUTH (password check via bcrypt + Telegram OTP 2FA)
   ========================================== */

// Exact-match lookup only (by display name or the derived pseudo-email). The previous
// version also matched on substring (`.includes`), which meant e.g. logging in as "Bob"
// could resolve to a different account named "Bobby" purely because the DB happened to
// return them first — a correctness/account-confusion risk, not just a UX quirk.
const findUserByLogin = (username) => {
  const nameLower = username.toLowerCase().trim();
  const rows = db.prepare('SELECT * FROM users').all();
  return rows.find((u) => {
    const emailSim = u.name.toLowerCase().replace(/\s+/g, '') + '@email.com';
    return u.name.toLowerCase() === nameLower || emailSim === nameLower;
  });
};

app.post('/api/auth/login', rateLimit('login', 10, 60000), (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = findUserByLogin(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      auditLog({ action: 'login_failed', targetType: 'user', targetId: user?.id ?? null, detail: { username }, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = createSessionToken(user.id);
    auditLog({ actorId: user.id, actorRole: user.role, action: 'login_success', targetType: 'user', targetId: user.id, ip: req.ip });
    res.json({ ...withPrivateFieldsIfAuthorized(buildUserResponse(user), user, { id: user.id, role: user.role }), token });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/login/request-otp', rateLimit('login', 10, 60000), (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = findUserByLogin(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      auditLog({ action: 'login_failed', targetType: 'user', targetId: user?.id ?? null, detail: { username }, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (!user.telegram_chat_id) {
      return res.status(400).json({ error: 'No Telegram account is linked to this profile. Please contact support to re-link Telegram.' });
    }

    const code = generateOtpCode();
    const expiresAt = Date.now() + OTP_TTL_MS;
    db.prepare("DELETE FROM otp_codes WHERE chat_id = ? AND purpose = 'login'").run(user.telegram_chat_id);
    db.prepare("INSERT INTO otp_codes (chat_id, purpose, code, attempts, expires_at) VALUES (?, 'login', ?, 0, ?)").run(user.telegram_chat_id, code, expiresAt);

    sendTelegramMessage(
      user.telegram_chat_id,
      `🔐 <b>LifeLink sign-in code</b>\n\nSomeone is signing in to your account (${escapeHtml(user.name)}). Your one-time code is:\n\n<b>${code}</b>\n\nIf this wasn't you, ignore this message and consider changing your password.`
    ).then((result) => {
      if (!result.ok) {
        return res.status(502).json({ error: 'Could not deliver OTP via Telegram. Please try again shortly.' });
      }
      const masked = user.telegram_chat_id.length > 4 ? `••••${user.telegram_chat_id.slice(-4)}` : '••••';
      res.json({ otpRequired: true, userId: user.id, maskedChat: masked, dev: !!result.dev, devCode: result.dev ? code : undefined });
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/login/verify-otp', rateLimit('otp-verify', 15, 60000), (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'userId and code are required' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || !user.telegram_chat_id) return res.status(400).json({ error: 'Invalid session. Please sign in again.' });

    const row = db.prepare("SELECT * FROM otp_codes WHERE chat_id = ? AND purpose = 'login' ORDER BY id DESC LIMIT 1").get(user.telegram_chat_id);
    if (!row) return res.status(400).json({ error: 'No OTP was requested. Please sign in again.' });
    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
      return res.status(400).json({ error: 'This OTP has expired. Please sign in again.' });
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please sign in again.' });
    }
    if (row.code !== String(code).trim()) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      auditLog({ actorId: user.id, actorRole: user.role, action: 'login_otp_failed', targetType: 'user', targetId: user.id, ip: req.ip });
      return res.status(401).json({ error: 'Incorrect OTP. Please try again.' });
    }
    db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
    const token = createSessionToken(user.id);
    auditLog({ actorId: user.id, actorRole: user.role, action: 'login_success', targetType: 'user', targetId: user.id, ip: req.ip });
    res.json({ ...withPrivateFieldsIfAuthorized(buildUserResponse(user), user, { id: user.id, role: user.role }), token });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/otp/send', rateLimit('otp-send', 10, 60000), async (req, res) => {
  try {
    const { chatId, purpose } = req.body;
    if (!chatId || !purpose) return res.status(400).json({ error: 'chatId and purpose are required' });

    const code = generateOtpCode();
    const expiresAt = Date.now() + OTP_TTL_MS;
    db.prepare('DELETE FROM otp_codes WHERE chat_id = ? AND purpose = ?').run(chatId, purpose);
    db.prepare('INSERT INTO otp_codes (chat_id, purpose, code, attempts, expires_at) VALUES (?, ?, ?, 0, ?)').run(chatId, purpose, code, expiresAt);

    const label = purpose === 'login' ? 'sign in to' : 'verify your Telegram link for';
    const result = await sendTelegramMessage(
      chatId,
      `🩸 <b>LifeLink verification code</b>\n\nUse this code to ${label} your account:\n\n<b>${code}</b>\n\nThis code expires in 5 minutes. Never share it with anyone.`
    );
    if (!result.ok) {
      return res.status(502).json({ error: 'Could not deliver OTP via Telegram. Double-check the Chat ID and that the bot has been started.' });
    }
    res.json({ sent: true, dev: !!result.dev, devCode: result.dev ? code : undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// Used during signup (before any account/session exists), so this must stay
// unauthenticated — but it's a brute-forceable OTP check, so it gets a strict rate limit
// on top of the existing per-code attempts cap.
app.post('/api/auth/otp/verify', rateLimit('otp-verify', 15, 60000), (req, res) => {
  try {
    const { chatId, code, purpose } = req.body;
    if (!chatId || !code || !purpose) return res.status(400).json({ error: 'chatId, code and purpose are required' });
    const row = db.prepare('SELECT * FROM otp_codes WHERE chat_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(chatId, purpose);
    if (!row) return res.status(400).json({ error: 'No OTP was requested for this chat. Please request a new code.' });
    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
      return res.status(400).json({ error: 'This OTP has expired. Please request a new code.' });
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (row.code !== String(code).trim()) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      return res.status(401).json({ error: 'Incorrect OTP. Please try again.' });
    }
    db.prepare('DELETE FROM otp_codes WHERE id = ?').run(row.id);
    res.json({ verified: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   EMERGENCIES API
   ========================================== */

const buildEmergencyResponse = (e) => ({
  id: e.id,
  patientName: e.patient_name,
  bloodType: typeByGroupId[e.blood_group_id],
  hospital: e.hospital_name,
  hospitalId: e.hospital_id,
  lat: e.lat,
  lng: e.lng,
  units: e.units_needed,
  urgency: e.urgency,
  ward: e.ward,
  time: e.created_at,
  status: e.status,
  alerts: e.alerts_sent,
  expiresAt: e.expires_at,
  updatedAt: e.updated_at
});

// ---- Emergency workflow state machine ----
// Pending -> Searching -> Donors Notified -> Donor Responded -> Blood Reserved -> Fulfilled
// Cancelled / Expired are reachable as a terminal state from any non-terminal state.
const EMERGENCY_TRANSITIONS = {
  'Pending': ['Searching', 'Cancelled', 'Expired'],
  'Searching': ['Donors Notified', 'Cancelled', 'Expired'],
  'Donors Notified': ['Donor Responded', 'Cancelled', 'Expired'],
  'Donor Responded': ['Blood Reserved', 'Donors Notified', 'Cancelled', 'Expired'],
  'Blood Reserved': ['Fulfilled', 'Cancelled', 'Expired'],
  'Fulfilled': [],
  'Cancelled': [],
  'Expired': []
};
const EXPIRY_MINUTES_BY_URGENCY = { 'Critical': 30, 'Urgent': 90, 'Normal': 240 };

const transitionEmergency = (id, toStatus, { actorId = null, actorLabel = 'system', note = null, force = false } = {}) => {
  const current = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
  if (!current) throw new Error('Emergency not found');
  const allowed = EMERGENCY_TRANSITIONS[current.status] || [];
  if (!force && !allowed.includes(toStatus)) {
    throw new Error(`Cannot move an emergency from "${current.status}" to "${toStatus}"`);
  }
  db.prepare("UPDATE emergencies SET status = ?, updated_at = datetime('now') WHERE id = ?").run(toStatus, id);
  db.prepare(
    `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, actor_id, actor_label, note) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, current.status, toStatus, actorId, actorLabel, note);
  const updated = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
  const response = buildEmergencyResponse(updated);
  broadcastEvent('emergency:status', { emergency: response, from: current.status, to: toStatus, note });
  return updated;
};

// Real compatibility-aware donor matching (reuses the same blood_compatibility table
// as AI Match / Find Blood) — not just an exact blood-type filter.
const findCompatibleDonors = (recipientBloodType, limit = 8) => {
  const compatibleDonorGroupIds = db
    .prepare('SELECT donor_group_id FROM blood_compatibility WHERE recipient_group_id = ?')
    .all(groupIdByType[recipientBloodType])
    .map((r) => r.donor_group_id);
  if (compatibleDonorGroupIds.length === 0) return [];
  const placeholders = compatibleDonorGroupIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT u.id, u.name, u.telegram_chat_id, u.total_donations, dp.blood_group_id
       FROM users u JOIN donor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'Donor' AND u.status = 'Active' AND dp.blood_group_id IN (${placeholders})
       ORDER BY u.total_donations DESC`
    )
    .all(...compatibleDonorGroupIds)
    .slice(0, limit);
};

app.get('/api/emergencies', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM emergencies ORDER BY created_at DESC').all();
    res.json(rows.map(buildEmergencyResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/emergencies/:id/history', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM emergency_status_history WHERE emergency_id = ? ORDER BY created_at ASC, id ASC')
      .all(req.params.id);
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

// Emergency creation is intentionally reachable by any visitor (patients/families raising
// an urgent request don't necessarily have a Hospital account) — so this stays unauthenticated
// by design, but gets a strict rate limit since it fans out to notifications + DB writes.
app.post('/api/emergencies', rateLimit('emergency-create', 20, 60000), (req, res) => {
  try {
    const { id, patientName, bloodType, hospital, lat, lng, units, urgency, ward } = req.body;
    if (!patientName || !bloodType || !hospital || !units || !urgency) {
      return res.status(400).json({ error: 'patientName, bloodType, hospital, units and urgency are required.' });
    }
    // If the caller is authenticated as a Hospital, don't let them file the request under a
    // different hospital's name (identity spoofing) — otherwise trust the free-text hospital
    // field, since anonymous/community-reported requests don't have an account to bind to.
    const actor = getActorFromRequest(req);
    const effectiveHospital = actor && actor.role === 'Hospital' ? actor.name : hospital;
    const groupIdVal = groupIdByType[bloodType];
    if (!groupIdVal) return res.status(400).json({ error: `Unknown blood type: ${bloodType}` });

    const hospRow = actor && actor.role === 'Hospital'
      ? { id: actor.id }
      : db.prepare('SELECT u.id FROM users u WHERE u.role = \'Hospital\' AND u.name = ?').get(effectiveHospital);
    const expiryMinutes = EXPIRY_MINUTES_BY_URGENCY[urgency] || 120;
    const expiresAtStr = new Date(Date.now() + expiryMinutes * 60000).toISOString().slice(0, 19).replace('T', ' ');

    // 1. Request saved to database (status: Pending)
    db.prepare(
      `INSERT INTO emergencies (id, patient_name, blood_group_id, hospital_id, hospital_name, lat, lng, units_needed, urgency, ward, status, alerts_sent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0, ?)`
    ).run(id, patientName, groupIdVal, hospRow ? hospRow.id : null, effectiveHospital, lat, lng, units, urgency, ward, expiresAtStr);

    db.prepare('INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?)')
      .run('emergency_created', 'emergency', id, JSON.stringify({ bloodType, urgency }));

    const created = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
    broadcastEvent('emergency:created', { emergency: buildEmergencyResponse(created) });
    db.prepare(
      `INSERT INTO emergency_status_history (emergency_id, from_status, to_status, actor_id, actor_label, note) VALUES (?, NULL, 'Pending', ?, 'hospital', 'Emergency request created')`
    ).run(id, hospRow ? hospRow.id : null);

    // 2. System identifies compatible donors/blood sources -> Searching
    transitionEmergency(id, 'Searching', { actorLabel: 'system', note: 'Identifying compatible donors and blood sources' });
    const candidates = findCompatibleDonors(bloodType, 8);

    const insertMatch = db.prepare(
      `INSERT INTO donor_matches (emergency_id, donor_id, compatibility_score, distance_km, reliability_score, response_score, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Suggested')`
    );
    candidates.forEach((d) => {
      const compatScore = d.blood_group_id === groupIdVal ? 100 : 80;
      const reliability = Math.min(99, 60 + d.total_donations * 2);
      insertMatch.run(id, d.id, compatScore, null, reliability, 75);
    });
    db.prepare(
      `INSERT INTO ai_predictions (prediction_type, subject_type, subject_id, score, features, model_version) VALUES ('donor_match', 'emergency', ?, 0.9, ?, 'rule-based-v1')`
    ).run(id, JSON.stringify({ note: 'Rule-based heuristic score, not a trained model.', candidateCount: candidates.length }));

    // 3. Matching process starts -> Donors Notified (only if we actually found candidates)
    if (candidates.length > 0) {
      transitionEmergency(id, 'Donors Notified', { actorLabel: 'system', note: `Notifying ${candidates.length} compatible donor(s)` });
      db.prepare("UPDATE donor_matches SET status = 'Notified', updated_at = datetime('now') WHERE emergency_id = ?").run(id);
      db.prepare("UPDATE emergencies SET alerts_sent = ? WHERE id = ?").run(candidates.length, id);

      candidates.forEach((d) => {
        notify({
          userId: d.id,
          type: 'donor_match',
          title: `${urgency} ${bloodType} request nearby`,
          message: `${effectiveHospital} needs ${units} unit(s) of ${bloodType} for an emergency (${urgency}). Ward: ${ward}. Can you help?`,
          urgency: urgency === 'Critical' ? 'Critical' : urgency === 'Urgent' ? 'Urgent' : 'Normal',
          relatedType: 'emergency',
          relatedId: id
        });
      });
      broadcastEvent('emergency:matches', { emergencyId: id, matchedDonorCount: candidates.length });
    }

    // Notify stakeholders (Admins + Blood Banks) about the emergency request itself, so
    // supply-side staff see it without waiting on the donor-matching outcome. Only for
    // Critical/Urgent requests — a Normal-urgency request doesn't need to interrupt everyone.
    if (urgency === 'Critical' || urgency === 'Urgent') {
      const stakeholders = db.prepare("SELECT id FROM users WHERE role IN ('Admin', 'Blood Bank') AND status = 'Active'").all();
      notifyMany(stakeholders.map((s) => s.id), {
        type: 'emergency_request',
        title: `${urgency} blood request: ${bloodType} at ${effectiveHospital}`,
        message: `${effectiveHospital} needs ${units} unit(s) of ${bloodType} (${urgency}). Ward: ${ward}.`,
        urgency: urgency === 'Critical' ? 'Critical' : 'Urgent',
        relatedType: 'emergency',
        relatedId: id
      });
    }

    const finalEmergency = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
    res.json({ success: true, emergency: buildEmergencyResponse(finalEmergency), matchedDonors: candidates.length });
  } catch (err) {
    sendError(res, err);
  }
});

// Donor accepts or declines a match notification
// Donor accepts or declines a match notification
app.post('/api/emergencies/:id/respond', requireDonor, (req, res) => {
  try {
    const { id } = req.params;
    const { donorId, response } = req.body;
    if (!donorId || !['accept', 'decline'].includes(response)) {
      return res.status(400).json({ error: 'donorId and response ("accept" | "decline") are required' });
    }
    // A donor may only respond on their own behalf — without this check, any authenticated
    // donor could accept/decline a match notification that was actually sent to someone else.
    if (req.actor.role !== 'Admin' && req.actor.id !== donorId) {
      return res.status(403).json({ error: 'You can only respond on your own behalf.' });
    }
    const match = db
      .prepare("SELECT * FROM donor_matches WHERE emergency_id = ? AND donor_id = ? AND status = 'Notified' ORDER BY id DESC LIMIT 1")
      .get(id, donorId);
    if (!match) return res.status(400).json({ error: 'No pending notification found for this donor on this request.' });

    const emergency = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
    if (!emergency) return res.status(404).json({ error: 'Emergency not found' });

    const newMatchStatus = response === 'accept' ? 'Accepted' : 'Declined';
    db.prepare("UPDATE donor_matches SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newMatchStatus, match.id);

    const donor = db.prepare('SELECT name FROM users WHERE id = ?').get(donorId);

    if (response === 'accept' && emergency.status === 'Donors Notified') {
      transitionEmergency(id, 'Donor Responded', { actorId: donorId, actorLabel: 'donor', note: `${donor?.name || 'A donor'} accepted the request` });
      if (emergency.hospital_id) {
        notify({
          userId: emergency.hospital_id,
          type: 'donor_accepted',
          title: 'A donor has responded!',
          message: `${donor?.name || 'A donor'} has accepted your ${typeByGroupId[emergency.blood_group_id]} request. Review and reserve in your dashboard.`,
          urgency: 'Urgent',
          relatedType: 'emergency',
          relatedId: id
        });
      }
    } else if (response === 'decline' && emergency.hospital_id) {
      notify({
        userId: emergency.hospital_id,
        type: 'donor_declined',
        title: 'A donor declined',
        message: `${donor?.name || 'A donor'} is unable to help with your ${typeByGroupId[emergency.blood_group_id]} request. We'll keep notifying other compatible donors.`,
        relatedType: 'emergency',
        relatedId: id
      });
    }

    broadcastEvent('emergency:match-response', { emergencyId: id, donorId, response, matchId: match.id });
    res.json({ success: true, matchStatus: newMatchStatus });
  } catch (err) {
    sendError(res, err);
  }
});

// Hospital reserves blood from a specific donor who accepted
app.post('/api/emergencies/:id/reserve', requireHospital, (req, res) => {
  try {
    const { id } = req.params;
    const { donorId } = req.body;
    const actorId = req.actor.id;
    if (!donorId) return res.status(400).json({ error: 'donorId is required' });
    const emergencyForOwnerCheck = db.prepare('SELECT hospital_id FROM emergencies WHERE id = ?').get(id);
    if (!emergencyForOwnerCheck) return res.status(404).json({ error: 'Emergency not found' });
    if (req.actor.role !== 'Admin' && emergencyForOwnerCheck.hospital_id !== req.actor.id) {
      return res.status(403).json({ error: 'You can only manage requests filed by your own hospital.' });
    }
    const match = db
      .prepare("SELECT * FROM donor_matches WHERE emergency_id = ? AND donor_id = ? AND status = 'Accepted' ORDER BY id DESC LIMIT 1")
      .get(id, donorId);
    if (!match) return res.status(400).json({ error: 'This donor has not accepted a match for this request yet.' });

    db.prepare("UPDATE donor_matches SET status = 'Reserved', updated_at = datetime('now') WHERE id = ?").run(match.id);
    transitionEmergency(id, 'Blood Reserved', { actorId: actorId || null, actorLabel: 'hospital', note: 'Blood reserved from an accepted donor' });

    notify({
      userId: donorId,
      type: 'donor_reserved',
      title: 'You have been selected!',
      message: 'The hospital has reserved your donation. Please proceed to the location to donate.',
      relatedType: 'emergency',
      relatedId: id
    });

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Hospital marks the request fulfilled once the donation is collected — creates a real donation record
app.post('/api/emergencies/:id/fulfill', requireHospital, (req, res) => {
  try {
    const { id } = req.params;
    const actorId = req.actor.id;
    const emergency = db.prepare('SELECT * FROM emergencies WHERE id = ?').get(id);
    if (!emergency) return res.status(404).json({ error: 'Emergency not found' });
    if (req.actor.role !== 'Admin' && emergency.hospital_id !== req.actor.id) {
      return res.status(403).json({ error: 'You can only manage requests filed by your own hospital.' });
    }

    const reservedMatch = db.prepare("SELECT * FROM donor_matches WHERE emergency_id = ? AND status = 'Reserved' ORDER BY id DESC LIMIT 1").get(id);

    db.exec('BEGIN');
    try {
      if (reservedMatch) {
        const donationId = 'dn' + Date.now();
        db.prepare(
          `INSERT INTO donations (id, donor_id, blood_group_id, hospital_id, emergency_id, units, status, donation_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, 'Completed', date('now'), 'Emergency-response donation, collected on-site.')`
        ).run(donationId, reservedMatch.donor_id, emergency.blood_group_id, emergency.hospital_id, id, emergency.units_needed);
        db.prepare("UPDATE users SET total_donations = total_donations + 1, xp = xp + 220, updated_at = datetime('now') WHERE id = ?").run(reservedMatch.donor_id);
        db.prepare("UPDATE donor_matches SET status = 'Donated', updated_at = datetime('now') WHERE id = ?").run(reservedMatch.id);
        if (emergency.hospital_id) {
          db.prepare("UPDATE hospital_profiles SET quota_used = quota_used + ?, updated_at = datetime('now') WHERE user_id = ?").run(emergency.units_needed, emergency.hospital_id);
        }
        notify({
          userId: reservedMatch.donor_id,
          type: 'donation_thanks',
          title: 'Thank you for saving a life! ❤️',
          message: 'Your donation has been recorded and the emergency request is now fulfilled.',
          relatedType: 'emergency',
          relatedId: id
        });
        if (emergency.hospital_id) {
          notify({
            userId: emergency.hospital_id,
            type: 'request_fulfilled',
            title: 'Blood request fulfilled',
            message: `Your ${typeByGroupId[emergency.blood_group_id]} request for ${emergency.patient_name || 'the patient'} has been fulfilled and the donation recorded.`,
            relatedType: 'emergency',
            relatedId: id
          });
        }
      }
      transitionEmergency(id, 'Fulfilled', { actorId: actorId || null, actorLabel: 'hospital', note: 'Blood collected — request fulfilled', force: !reservedMatch });
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    auditLog({ actorId: req.actor.id, actorRole: req.actor.role, action: 'emergency_fulfilled', targetType: 'emergency', targetId: id, detail: { donationCreated: !!reservedMatch, donorId: reservedMatch?.donor_id } });
    res.json({ success: true, donationCreated: !!reservedMatch });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/emergencies/:id/cancel', requireHospital, (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const emergency = db.prepare('SELECT hospital_id FROM emergencies WHERE id = ?').get(id);
    if (!emergency) return res.status(404).json({ error: 'Emergency not found' });
    if (req.actor.role !== 'Admin' && emergency.hospital_id !== req.actor.id) {
      return res.status(403).json({ error: 'You can only manage requests filed by your own hospital.' });
    }
    transitionEmergency(id, 'Cancelled', { actorId: req.actor.id, actorLabel: req.actor.role === 'Admin' ? 'admin' : 'hospital', note: reason || 'Cancelled', force: true });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Legacy/admin path: force a raw status/urgency/alert update through the audited state
// machine. Restricted to Admins — this bypasses normal workflow transition rules, so it
// must not be reachable by an arbitrary hospital or donor.
app.put('/api/emergencies/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, alerts, urgency } = req.body;

    if (alerts !== undefined || urgency !== undefined) {
      const fields = [];
      const params = [];
      if (alerts !== undefined) { fields.push('alerts_sent = ?'); params.push(alerts); }
      if (urgency !== undefined) { fields.push('urgency = ?'); params.push(urgency); }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        params.push(id);
        db.prepare(`UPDATE emergencies SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      }
    }

    if (status !== undefined) {
      transitionEmergency(id, status, { actorId: req.actor.id, actorLabel: 'admin', note: 'Manual status update', force: true });
    }
    auditLog({ actorId: req.actor.id, actorRole: req.actor.role, action: 'emergency_manual_update', targetType: 'emergency', targetId: id, detail: { status, alerts, urgency } });

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/emergencies/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM emergencies WHERE id = ?').run(req.params.id);
    auditLog({ actorId: req.actor.id, actorRole: req.actor.role, action: 'emergency_deleted', targetType: 'emergency', targetId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Background sweep: auto-expire unresolved requests past their countdown deadline
setInterval(() => {
  try {
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const overdue = db
      .prepare(`SELECT id FROM emergencies WHERE expires_at IS NOT NULL AND expires_at <= ? AND status NOT IN ('Fulfilled','Cancelled','Expired')`)
      .all(nowStr);
    overdue.forEach((row) => {
      try {
        transitionEmergency(row.id, 'Expired', { actorLabel: 'system', note: 'Auto-expired: no resolution within the allotted time window', force: true });
      } catch { /* ignore individual failures, next sweep will retry */ }
    });
  } catch { /* swallow sweep errors so the interval keeps running */ }
}, 30000);

// Background sweep: appointment + donation camp reminders. Each row is reminded exactly
// once (reminded_at is set immediately after a successful notify() call) so re-running the
// sweep on the same data — or having it overlap in-flight — never double-sends. Notifications
// fire for anything happening within the next 48 hours that hasn't been reminded yet.
const REMINDER_LOOKAHEAD = "'+2 days'";
setInterval(() => {
  try {
    const dueAppointments = db
      .prepare(
        `SELECT * FROM appointments
         WHERE reminded_at IS NULL AND status IN ('Scheduled', 'Confirmed')
           AND date(scheduled_date) BETWEEN date('now') AND date('now', ${REMINDER_LOOKAHEAD})`
      )
      .all();
    dueAppointments.forEach((appt) => {
      const venue = appt.hospital_id
        ? db.prepare('SELECT name FROM users WHERE id = ?').get(appt.hospital_id)?.name
        : appt.blood_bank_id
        ? db.prepare('SELECT name FROM users WHERE id = ?').get(appt.blood_bank_id)?.name
        : appt.camp_id
        ? db.prepare('SELECT title FROM camps WHERE id = ?').get(appt.camp_id)?.title
        : 'LifeLink';
      const result = notify({
        userId: appt.donor_id,
        type: 'appointment_reminder',
        title: 'Upcoming donation appointment',
        message: `You have a donation appointment at ${venue || 'LifeLink'} on ${appt.scheduled_date}${appt.slot ? ` (${appt.slot})` : ''}. See you there!`,
        relatedType: 'appointment',
        relatedId: appt.id
      });
      if (!result.skipped) {
        db.prepare("UPDATE appointments SET reminded_at = datetime('now') WHERE id = ?").run(appt.id);
      }
    });

    const dueCampRegs = db
      .prepare(
        `SELECT cr.*, c.title as camp_title, c.camp_date, c.venue
         FROM camp_registrations cr JOIN camps c ON c.id = cr.camp_id
         WHERE cr.reminded_at IS NULL AND cr.status = 'Registered'
           AND date(c.camp_date) BETWEEN date('now') AND date('now', ${REMINDER_LOOKAHEAD})`
      )
      .all();
    dueCampRegs.forEach((reg) => {
      const result = notify({
        userId: reg.donor_id,
        type: 'camp_reminder',
        title: 'Donation camp coming up',
        message: `"${reg.camp_title}" is coming up on ${reg.camp_date} at ${reg.venue || 'the venue'}${reg.slot ? ` — your slot: ${reg.slot}` : ''}. We hope to see you there!`,
        relatedType: 'camp',
        relatedId: reg.camp_id
      });
      if (!result.skipped) {
        db.prepare("UPDATE camp_registrations SET reminded_at = datetime('now') WHERE camp_id = ? AND donor_id = ?").run(reg.camp_id, reg.donor_id);
      }
    });
  } catch (err) {
    console.error('[notifications] reminder sweep error:', err.message);
  }
}, 60000);

// Background sweep: network-wide blood shortage alerts. Checks total units per blood group
// across every blood bank; if the citywide total falls at/below the shortage threshold,
// notifies Admins + Hospitals so supply-side decisions can be made proactively. Deduped by
// the 'blood_shortage_alert' type's dedupeWindowMinutes so this can run frequently without
// re-alerting the same shortage every cycle.
const SHORTAGE_THRESHOLD_UNITS = 30;
setInterval(() => {
  try {
    const totals = db
      .prepare(
        `SELECT bg.type as blood_group, COALESCE(SUM(bi.units), 0) as total_units
         FROM blood_groups bg LEFT JOIN blood_inventory bi ON bi.blood_group_id = bg.id
         GROUP BY bg.id`
      )
      .all();
    const short = totals.filter((t) => t.total_units <= SHORTAGE_THRESHOLD_UNITS);
    if (short.length === 0) return;

    const stakeholders = db.prepare("SELECT id FROM users WHERE role IN ('Admin', 'Hospital') AND status = 'Active'").all();
    short.forEach((t) => {
      notifyMany(stakeholders.map((s) => s.id), {
        type: 'blood_shortage_alert',
        title: `Citywide shortage: ${t.blood_group}`,
        message: `Total ${t.blood_group} stock across all LifeLink blood banks is down to ${t.total_units} unit(s) — at or below the shortage threshold. Consider prioritizing donor outreach for this group.`,
        relatedType: 'blood_group',
        relatedId: t.blood_group
      });
    });
  } catch (err) {
    console.error('[notifications] shortage sweep error:', err.message);
  }
}, 5 * 60000);

/* ==========================================
   CAMPS + CAMP REGISTRATIONS API
   ========================================== */

const buildCampResponse = (c) => ({
  id: c.id,
  title: c.title,
  date: c.camp_date,
  startTime: c.start_time,
  endTime: c.end_time,
  location: c.location_label,
  venue: c.venue,
  city: c.city,
  state: c.state,
  organizer: c.organizer_name,
  contactPhone: c.contact_phone,
  contactEmail: c.contact_email,
  registrationUrl: c.registration_url,
  registered: c.registered_count,
  limit: c.capacity,
  approved: !!c.approved,
  status: c.status,
  lat: c.lat ?? c.loc_lat ?? null,
  lng: c.lng ?? c.loc_lng ?? null,
  source: c.source,
  sourceName: c.source_name,
  sourceUrl: c.source_url,
  sourceLastUpdated: c.source_last_updated,
  verificationStatus: c.verification_status,
  verifiedAt: c.verified_at,
  updatedAt: c.updated_at
});

app.get('/api/camps', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.*, loc.lat as loc_lat, loc.lng as loc_lng
      FROM camps c
      LEFT JOIN locations loc ON loc.id = c.location_id
      ORDER BY c.camp_date
    `).all();
    res.json(rows.map(buildCampResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/camps/:id', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT c.*, loc.lat as loc_lat, loc.lng as loc_lng
      FROM camps c LEFT JOIN locations loc ON loc.id = c.location_id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camp not found' });
    res.json(buildCampResponse(row));
  } catch (err) {
    sendError(res, err);
  }
});

// Directly hand-submitted camps (existing "Organize a Camp" flow). This stays a distinct,
// simple endpoint from the multi-source ingestion pipeline below — an authenticated
// submission through LifeLink's own form is inherently a first-party manual entry.
// Community camp submissions are open to any visitor (organizers don't need an account) —
// new submissions land as Unverified/Under Review until an Admin approves them via
// PUT /api/camps/:id, so this intentionally stays unauthenticated, just rate-limited.
app.post('/api/camps', rateLimit('camp-create', 20, 3600000), (req, res) => {
  try {
    const { id, title, date, location, registered, limit, approved, status, organizer, venue, city, state, contactPhone, contactEmail, registrationUrl } = req.body;
    const locationId = location ? findOrCreateLocation(location, null, null) : null;
    db.prepare(
      `INSERT INTO camps (
         id, title, organizer_name, location_id, location_label, venue, city, state, camp_date,
         contact_phone, contact_email, registration_url, capacity, registered_count, approved, status,
         source, source_name, verification_status, dedupe_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'LifeLink Direct Entry', 'Unverified', ?)`
    ).run(
      id, title, organizer || null, locationId, location, venue || location, city || 'Coimbatore', state || 'Tamil Nadu', date,
      contactPhone || null, contactEmail || null, registrationUrl || null, limit, registered || 0, approved ? 1 : 0, status || 'Under Review',
      `manual-${id}`
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/camps/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { approved, registered, status } = req.body;
    const fields = [];
    const params = [];
    if (approved !== undefined) { fields.push('approved = ?'); params.push(approved ? 1 : 0); }
    if (registered !== undefined) { fields.push('registered_count = ?'); params.push(registered); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    // Approving a manually-submitted camp through LifeLink's own review flow is treated as
    // verification — approving an *ingested* camp is not (that always requires the explicit
    // /verify endpoint below), since first-party review and external-source review are different things.
    if (approved) {
      const existing = db.prepare('SELECT source FROM camps WHERE id = ?').get(id);
      if (existing && existing.source === 'manual') fields.push("verification_status = 'Verified'");
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE camps SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Explicit human verification step. This is the ONLY place verification_status can become
// 'Verified' for an ingested (official_api / web_import) camp — the ingestion pipeline
// itself never sets anything but 'Unverified'.
app.put('/api/camps/:id/verify', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus, verifiedBy } = req.body;
    if (!['Verified', 'Flagged', 'Unverified'].includes(verificationStatus)) {
      return res.status(400).json({ error: 'verificationStatus must be Verified, Flagged, or Unverified' });
    }
    db.prepare(
      `UPDATE camps SET verification_status = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(verificationStatus, verifiedBy || null, id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   CAMP DATA INGESTION API
   ------------------------------------------
   Public Source -> Fetch -> Parse -> Validate -> Deduplicate -> Normalize -> Store
   See services/campIngestion/ for the pipeline implementation. Every run is
   logged to camp_ingestion_runs regardless of source or outcome.
   ========================================== */

const { runIngestion } = require('./services/campIngestion/pipeline');
const { fetchOfficialApiCamps, SOURCE_NAME: API_SOURCE_NAME } = require('./services/campIngestion/adapters/sampleApiAdapter');
const { fetchScrapedCamps, SOURCE_NAME: SCRAPE_SOURCE_NAME } = require('./services/campIngestion/adapters/sampleScrapeAdapter');

const campLocationLookup = (city) => {
  if (!city) return null;
  const row = db.prepare('SELECT id FROM locations WHERE label = ? OR city = ? LIMIT 1').get(city, city);
  return row ? row.id : null;
};

app.post('/api/camps/ingest', requireAdmin, async (req, res) => {
  try {
    const { source, triggeredBy } = req.body;
    let fetchFn, sourceName;
    if (source === 'official_api') { fetchFn = fetchOfficialApiCamps; sourceName = API_SOURCE_NAME; }
    else if (source === 'web_import') { fetchFn = fetchScrapedCamps; sourceName = SCRAPE_SOURCE_NAME; }
    else return res.status(400).json({ error: 'source must be "official_api" or "web_import"' });

    const result = await runIngestion(db, { source, sourceName, fetchFn, triggeredBy: triggeredBy || null, locationLookup: campLocationLookup });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/camps/ingestion/runs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM camp_ingestion_runs ORDER BY started_at DESC LIMIT 20').all();
    res.json(rows.map((r) => ({ ...r, log: r.log ? JSON.parse(r.log) : [] })));
  } catch (err) {
    sendError(res, err);
  }
});

// New: camp registrations (backs Passport / DonorDashboard "activeCampRegistration")
app.get('/api/camp_registrations', requireAuth, (req, res) => {
  try {
    const { camp_id } = req.query;
    // Non-admins can only see their own registrations — listing all registrants for a
    // camp by camp_id alone would otherwise expose other donors' identities/registration
    // status to any logged-in user.
    const donor_id = req.actor.role === 'Admin' ? req.query.donor_id : req.actor.id;
    let sql = `SELECT cr.*, c.title as camp_title, c.camp_date FROM camp_registrations cr JOIN camps c ON c.id = cr.camp_id WHERE 1=1`;
    const params = [];
    if (donor_id) { sql += ' AND cr.donor_id = ?'; params.push(donor_id); }
    if (camp_id) { sql += ' AND cr.camp_id = ?'; params.push(camp_id); }
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/camp_registrations', requireAuth, (req, res) => {
  try {
    const { campId, donorId, slot } = req.body;
    if (!campId || !donorId) return res.status(400).json({ error: 'campId and donorId are required' });
    if (req.actor.role !== 'Admin' && req.actor.id !== donorId) {
      return res.status(403).json({ error: 'You can only register yourself for a camp.' });
    }
    const verificationId = 'CR-' + Date.now();
    db.prepare(
      `INSERT INTO camp_registrations (camp_id, donor_id, verification_id, slot, status) VALUES (?, ?, ?, ?, 'Registered')`
    ).run(campId, donorId, verificationId, slot || null);
    db.prepare('UPDATE camps SET registered_count = registered_count + 1 WHERE id = ?').run(campId);

    const camp = db.prepare('SELECT title, camp_date FROM camps WHERE id = ?').get(campId);
    if (camp) {
      notify({
        userId: donorId,
        type: 'camp_update',
        title: 'Camp registration confirmed',
        message: `Your slot at "${camp.title}" on ${camp.camp_date} is confirmed. Verification ID: ${verificationId}.`,
        relatedType: 'camp',
        relatedId: campId
      });
    }

    res.json({ success: true, verificationId });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   DONATIONS API (also serves as "donation history")
   ========================================== */

const buildDonationResponse = (d) => {
  let channel = 'unknown';
  if (d.camp_id) channel = 'camp';
  else if (d.blood_bank_id) channel = 'blood_bank';
  else if (d.hospital_id) channel = 'hospital';
  return {
    id: d.id,
    donor: d.donor_name,
    donorId: d.donor_id,
    bloodType: typeByGroupId[d.blood_group_id],
    hospital: d.hospital_name || d.blood_bank_name || d.camp_title || 'LifeLink',
    time: d.created_at,
    status: d.status,
    details: d.notes,
    donationDate: d.donation_date,
    channel
  };
};

const donationJoinSql = `
  SELECT d.*, du.name as donor_name, hu.name as hospital_name, bu.name as blood_bank_name, c.title as camp_title
  FROM donations d
  LEFT JOIN users du ON du.id = d.donor_id
  LEFT JOIN users hu ON hu.id = d.hospital_id
  LEFT JOIN users bu ON bu.id = d.blood_bank_id
  LEFT JOIN camps c ON c.id = d.camp_id
`;

// Legacy endpoint name kept for the existing frontend (Hospital dashboard "recent activity" feed).
// Includes real donor names — restricted to privileged roles who need it operationally
// (donor privacy: a named individual's donation history/location should never be public).
app.get('/api/recent_donations', requireRole('Admin', 'Hospital', 'Blood Bank'), (req, res) => {
  try {
    const rows = db.prepare(donationJoinSql + ' ORDER BY d.created_at DESC LIMIT 20').all();
    res.json(rows.map(buildDonationResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/recent_donations', requireRole('Admin', 'Hospital', 'Blood Bank'), (req, res) => {
  try {
    const { id, donor, bloodType, hospital, status, details } = req.body;
    const groupIdVal = groupIdByType[bloodType] || null;
    const donorRow = db.prepare('SELECT id FROM users WHERE name = ? AND role = \'Donor\'').get(donor);
    const hospRow = db.prepare('SELECT id FROM users WHERE name = ? AND role = \'Hospital\'').get(hospital);
    db.prepare(
      `INSERT INTO donations (id, donor_id, blood_group_id, hospital_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, donorRow ? donorRow.id : null, groupIdVal, hospRow ? hospRow.id : null, status || 'Scheduled', details || null);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Donation history is sensitive (health-adjacent) data — only the donor themself, or an
// Admin/Hospital/Blood Bank (who need it for verification/quota purposes), may view it,
// and a non-privileged actor can only ever see their own.
app.get('/api/donations', requireAuth, (req, res) => {
  try {
    const privileged = ['Admin', 'Hospital', 'Blood Bank'].includes(req.actor.role);
    const donor_id = privileged ? (req.query.donor_id || null) : req.actor.id;
    let sql = donationJoinSql;
    const params = [];
    if (donor_id) { sql += ' WHERE d.donor_id = ?'; params.push(donor_id); }
    else if (!privileged) {
      return res.json([]);
    }
    sql += ' ORDER BY d.created_at DESC';
    res.json(db.prepare(sql).all(...params).map(buildDonationResponse));
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   HOSPITALS API
   ========================================== */

const buildHospitalResponse = (h) => ({
  id: h.user_id,
  name: h.name,
  location: locationLabel(h.location_id),
  activeEmergencies: h.active_emergencies,
  quotaUsed: h.quota_used,
  quotaLimit: h.quota_limit,
  status: h.verification_status,
  lat: h.lat,
  lng: h.lng
});

const hospitalJoinSql = `SELECT hp.*, u.name as name, u.lat as lat, u.lng as lng FROM hospital_profiles hp JOIN users u ON u.id = hp.user_id`;

app.get('/api/hospitals', (req, res) => {
  try {
    res.json(db.prepare(hospitalJoinSql).all().map(buildHospitalResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/hospitals', requireAdmin, (req, res) => {
  try {
    const { id, name, location, activeEmergencies, quotaUsed, quotaLimit, status } = req.body;
    const locationId = findOrCreateLocation(location, null, null);
    // Random one-time temporary password (never a hardcoded/guessable default) — the
    // created account has no way to sign in via Telegram OTP until an Admin shares this
    // and the hospital sets its own password, since this endpoint predates self-serve signup.
    const tempPassword = require('crypto').randomBytes(9).toString('base64url');
    const passwordHash = bcrypt.hashSync(tempPassword, BCRYPT_COST);
    db.prepare(
      `INSERT INTO users (id, name, role, password_hash, passport_id, status, location_id) VALUES (?, ?, 'Hospital', ?, ?, 'Verified', ?)`
    ).run(id, name, passwordHash, `HP-2026-CBE-${Math.floor(1000 + Math.random() * 9000)}`, locationId);
    db.prepare(
      `INSERT INTO hospital_profiles (user_id, location_id, quota_used, quota_limit, active_emergencies, verification_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, locationId, quotaUsed || 0, quotaLimit || 0, activeEmergencies || 0, status || 'Pending Verification');
    auditLog({ actorId: req.actor.id, actorRole: req.actor.role, action: 'hospital_account_created', targetType: 'user', targetId: id });
    res.json({ success: true, tempPassword });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/hospitals/:id', requireHospital, requireSelfOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { activeEmergencies, quotaUsed, quotaLimit, status } = req.body;
    const fields = [];
    const params = [];
    if (activeEmergencies !== undefined) { fields.push('active_emergencies = ?'); params.push(activeEmergencies); }
    if (quotaUsed !== undefined) { fields.push('quota_used = ?'); params.push(quotaUsed); }
    if (quotaLimit !== undefined) { fields.push('quota_limit = ?'); params.push(quotaLimit); }
    if (status !== undefined) { fields.push('verification_status = ?'); params.push(status); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE hospital_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...params);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   BLOOD BANKS API (stockBreakdown reconstructed from blood_inventory rows)
   ========================================== */

const buildBloodBankResponse = (b) => {
  const invRows = db
    .prepare('SELECT bg.type, bi.units FROM blood_inventory bi JOIN blood_groups bg ON bg.id = bi.blood_group_id WHERE bi.blood_bank_id = ?')
    .all(b.user_id);
  const stockBreakdown = {};
  let total = 0;
  invRows.forEach((r) => { stockBreakdown[r.type] = r.units; total += r.units; });
  return {
    id: b.user_id,
    name: b.name,
    address: b.address || locationLabel(b.location_id),
    stock: total,
    activeTransfers: b.active_transfers,
    apiStatus: b.api_status,
    stockBreakdown,
    lat: b.lat,
    lng: b.lng
  };
};

const bankJoinSql = `SELECT bp.*, u.name as name, u.lat as lat, u.lng as lng FROM blood_bank_profiles bp JOIN users u ON u.id = bp.user_id`;

// Per-bank inventory_warning: fires when a bank's own stock for one blood group drops to
// Critical (<=10 units) or Out of Stock. Deduped by inventory_warning's dedupeWindowMinutes
// (6h) so repeated small stock adjustments don't spam the bank with the same warning.
const INVENTORY_WARNING_THRESHOLD = 10;
const checkLowStockAndNotify = (bloodBankId, bloodType, units) => {
  if (units > INVENTORY_WARNING_THRESHOLD) return;
  notify({
    userId: bloodBankId,
    type: 'inventory_warning',
    title: `Low stock: ${bloodType}`,
    message: units <= 0
      ? `${bloodType} is now out of stock at your blood bank. Consider reaching out to donors or requesting a transfer.`
      : `${bloodType} stock is critically low (${units} unit(s) remaining). Consider reaching out to donors or requesting a transfer.`,
    relatedType: 'blood_inventory',
    relatedId: `${bloodBankId}:${bloodType}`
  });
};

app.get('/api/blood_banks', (req, res) => {
  try {
    res.json(db.prepare(bankJoinSql).all().map(buildBloodBankResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/blood_banks/:id', requireBloodBank, requireSelfOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { activeTransfers, apiStatus, stockBreakdown } = req.body;
    const fields = [];
    const params = [];
    if (activeTransfers !== undefined) { fields.push('active_transfers = ?'); params.push(activeTransfers); }
    if (apiStatus !== undefined) { fields.push('api_status = ?'); params.push(apiStatus); }
    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE blood_bank_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...params);
    }
    if (stockBreakdown !== undefined) {
      Object.entries(stockBreakdown).forEach(([type, units]) => {
        const groupIdVal = groupIdByType[type];
        if (!groupIdVal) return;
        db.prepare(
          `INSERT INTO blood_inventory (blood_bank_id, blood_group_id, units, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(blood_bank_id, blood_group_id) DO UPDATE SET units = excluded.units, updated_at = datetime('now')`
        ).run(id, groupIdVal, units);
        checkLowStockAndNotify(id, type, units);
      });
    }
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   BLOOD AVAILABILITY SEARCH API
   ------------------------------------------
   The core "Find Blood" engine. Real SQL-level filtering on blood group,
   specific blood bank, and stock-availability tier; distance/radius and
   final sort/pagination are computed server-side (SQLite has no built-in
   trig functions for a WHERE-clause haversine, so geo filtering happens
   in this route handler rather than in the browser — the client never
   sees or filters the unfiltered dataset).
   ========================================== */

const availabilityStatus = (units) => {
  if (units <= 0) return 'Out of Stock';
  if (units <= 10) return 'Critical';
  if (units <= 25) return 'Low Stock';
  return 'Adequate';
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Deterministic pseudo-random offset (~100-450m) derived from an entity's own id,
// NOT from their real coordinates. Used so donor map markers show an approximate,
// stable "general area" position instead of a precise real-world location — the
// exact stored lat/lng is never sent to the client for donor map plotting.
const approximateCoords = (seedId, centerLat, centerLng) => {
  if (centerLat == null || centerLng == null) return { lat: null, lng: null };
  let hash = 0;
  for (let i = 0; i < seedId.length; i++) hash = (hash * 31 + seedId.charCodeAt(i)) >>> 0;
  const angle = (hash % 360) * (Math.PI / 180);
  const distanceDeg = (0.001 + ((hash >>> 8) % 350) / 100000); // ~110m-450m
  return {
    lat: Math.round((centerLat + distanceDeg * Math.cos(angle)) * 1e6) / 1e6,
    lng: Math.round((centerLng + distanceDeg * Math.sin(angle)) * 1e6) / 1e6
  };
};

app.get('/api/search/blood-availability', (req, res) => {
  try {
    const {
      bloodGroup, bloodBankId, availability, lat, lng, radiusKm,
      sortBy = 'distance', sortDir = 'asc', page = '1', pageSize = '8'
    } = req.query;

    // ---- Real SQL-level filtering (blood group, specific bank) ----
    let sql = `
      SELECT bi.id as inventory_id, bi.blood_bank_id, bi.units, bi.updated_at, bg.type as blood_group,
             u.name as bank_name, u.lat, u.lng, u.phone, u.status as account_status,
             bbp.api_status, bbp.verification_status, loc.label as location_label, loc.address
      FROM blood_inventory bi
      JOIN blood_groups bg ON bg.id = bi.blood_group_id
      JOIN blood_bank_profiles bbp ON bbp.user_id = bi.blood_bank_id
      JOIN users u ON u.id = bbp.user_id
      LEFT JOIN locations loc ON loc.id = bbp.location_id
      WHERE u.status != 'Suspended'
    `;
    const params = [];
    if (bloodGroup) { sql += ' AND bg.type = ?'; params.push(bloodGroup); }
    if (bloodBankId) { sql += ' AND bi.blood_bank_id = ?'; params.push(bloodBankId); }
    sql += ' ORDER BY bg.type ASC';

    let rows = db.prepare(sql).all(...params);

    // ---- Derived availability tier (still a real, deterministic function of DB data) ----
    rows = rows.map((r) => ({ ...r, availabilityTier: availabilityStatus(r.units) }));
    if (availability && availability !== 'Any') {
      rows = rows.filter((r) => r.availabilityTier === availability);
    }

    // ---- Distance / radius (server-side geo, since SQLite lacks trig in SQL) ----
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    rows = rows.map((r) => ({
      ...r,
      distanceKm: userLat != null && userLng != null ? haversineKm(userLat, userLng, r.lat, r.lng) : null
    }));
    const radius = radiusKm ? parseFloat(radiusKm) : null;
    if (radius && userLat != null) {
      rows = rows.filter((r) => r.distanceKm !== null && r.distanceKm <= radius);
    }

    // ---- Sort ----
    const dir = sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      let av, bv;
      if (sortBy === 'units') { av = a.units; bv = b.units; }
      else if (sortBy === 'updated') { av = a.updated_at; bv = b.updated_at; }
      else if (sortBy === 'bank') { av = a.bank_name; bv = b.bank_name; }
      else { av = a.distanceKm ?? Infinity; bv = b.distanceKm ?? Infinity; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    // ---- Pagination ----
    const total = rows.length;
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 8));
    const totalPages = Math.max(1, Math.ceil(total / size));
    const paged = rows.slice((pg - 1) * size, pg * size);

    res.json({
      results: paged.map((r) => ({
        id: r.inventory_id,
        bloodBankId: r.blood_bank_id,
        bloodBankName: r.bank_name,
        bloodGroup: r.blood_group,
        availableUnits: r.units,
        availabilityStatus: r.availabilityTier,
        location: r.location_label || 'Coimbatore',
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        distanceKm: r.distanceKm,
        lastUpdated: r.updated_at,
        apiStatus: r.api_status,
        verificationStatus: r.verification_status,
        contactPhone: r.phone
      })),
      pagination: { total, page: pg, pageSize: size, totalPages }
    });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   DONOR SEARCH API (privacy-safe — never exposes full identity,
   passport ID, phone, or exact coordinates to the searching public)
   ========================================== */

app.get('/api/search/donors', (req, res) => {
  try {
    const {
      bloodGroup, lat, lng, radiusKm, availableOnly = 'true',
      sortBy = 'distance', page = '1', pageSize = '6'
    } = req.query;

    let sql = `
      SELECT u.id, u.name, u.status, u.lat, u.lng, u.total_donations, loc.label as location_label,
             loc.lat as loc_lat, loc.lng as loc_lng, bg.type as blood_group
      FROM users u
      JOIN donor_profiles dp ON dp.user_id = u.id
      JOIN blood_groups bg ON bg.id = dp.blood_group_id
      LEFT JOIN locations loc ON loc.id = u.location_id
      WHERE u.role = 'Donor' AND u.is_new_registration = 0
    `;
    const params = [];
    if (availableOnly === 'true') { sql += " AND u.status = 'Active'"; }
    sql += ' ORDER BY u.total_donations DESC';
    let rows = db.prepare(sql).all(...params);

    if (bloodGroup) {
      const compatibleDonorGroups = db
        .prepare('SELECT bg.type FROM blood_compatibility bc JOIN blood_groups bg ON bg.id = bc.donor_group_id WHERE bc.recipient_group_id = ?')
        .all(groupIdByType[bloodGroup])
        .map((r) => r.type);
      rows = rows.filter((r) => compatibleDonorGroups.includes(r.blood_group));
    }

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    rows = rows.map((r) => ({ ...r, distanceKm: userLat != null && userLng != null ? haversineKm(userLat, userLng, r.lat, r.lng) : null }));
    const radius = radiusKm ? parseFloat(radiusKm) : null;
    if (radius && userLat != null) rows = rows.filter((r) => r.distanceKm !== null && r.distanceKm <= radius);

    if (sortBy === 'donations') rows.sort((a, b) => b.total_donations - a.total_donations);
    else rows.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

    const total = rows.length;
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(30, Math.max(1, parseInt(pageSize, 10) || 6));
    const totalPages = Math.max(1, Math.ceil(total / size));
    const paged = rows.slice((pg - 1) * size, pg * size);

    // Mask identity: first name + last-initial only, no passport ID, no phone, no exact coordinates
    const maskName = (fullName) => {
      const parts = fullName.trim().split(/\s+/);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] + '.' : '';
      return lastInitial ? `${first} ${lastInitial}` : first;
    };

    res.json({
      results: paged.map((r) => {
        const approx = approximateCoords(r.id, r.loc_lat, r.loc_lng);
        return {
          id: r.id,
          displayName: maskName(r.name),
          bloodGroup: r.blood_group,
          location: r.location_label || 'Coimbatore',
          distanceKm: r.distanceKm,
          status: r.status,
          donationCount: r.total_donations,
          approxLat: approx.lat,
          approxLng: approx.lng
        };
      }),
      pagination: { total, page: pg, pageSize: size, totalPages }
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Lightweight lookup for populating location filter dropdowns
app.get('/api/locations', (req, res) => {
  try {
    res.json(db.prepare('SELECT id, label, city, lat, lng FROM locations ORDER BY label').all());
  } catch (err) {
    sendError(res, err);
  }
});
/* ==========================================
   TRANSFERS API (adjusts real blood_inventory rows, wrapped in a transaction)
   ========================================== */

const buildTransferResponse = (t) => ({
  id: t.id,
  requestingId: t.requesting_id,
  supplyingId: t.supplying_id,
  bloodType: typeByGroupId[t.blood_group_id],
  units: t.units,
  status: t.status,
  time: t.created_at
});

app.get('/api/transfers', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM transfers ORDER BY created_at DESC').all().map(buildTransferResponse));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/transfers', requireAuth, (req, res) => {
  try {
    const { requestingId, supplyingId, bloodType, units } = req.body;
    // The requesting party must be the authenticated actor themself (or an Admin filing on
    // someone's behalf) — otherwise any account could file a transfer request that appears
    // to originate from a different hospital/blood bank.
    if (req.actor.role !== 'Admin' && req.actor.id !== requestingId) {
      return res.status(403).json({ error: 'You can only request transfers for your own account.' });
    }
    const groupIdVal = groupIdByType[bloodType];
    if (!groupIdVal) return res.status(400).json({ error: `Unknown blood type: ${bloodType}` });
    const id = 't' + Date.now();
    db.prepare(
      `INSERT INTO transfers (id, requesting_id, supplying_id, blood_group_id, units, status) VALUES (?, ?, ?, ?, ?, 'Pending')`
    ).run(id, requestingId, supplyingId, groupIdVal, parseInt(units, 10));
    res.json(buildTransferResponse(db.prepare('SELECT * FROM transfers WHERE id = ?').get(id)));
  } catch (err) {
    sendError(res, err);
  }
});

// Only the supplying blood bank (the one giving up stock) — or an Admin — may
// approve/decline a transfer. Previously any authenticated Blood Bank could approve or
// decline a transfer meant for a different bank, silently moving that bank's inventory.
app.put('/api/transfers/:id', requireBloodBank, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const transferForOwnerCheck = db.prepare('SELECT supplying_id FROM transfers WHERE id = ?').get(id);
    if (!transferForOwnerCheck) return res.status(404).json({ error: 'Transfer request not found' });
    if (req.actor.role !== 'Admin' && transferForOwnerCheck.supplying_id !== req.actor.id) {
      return res.status(403).json({ error: 'Only the supplying blood bank can respond to this transfer request.' });
    }

    if (status === 'Declined') {
      db.prepare("UPDATE transfers SET status = 'Declined', updated_at = datetime('now') WHERE id = ?").run(id);
      const declinedTransfer = db.prepare('SELECT * FROM transfers WHERE id = ?').get(id);
      if (declinedTransfer) {
        notify({
          userId: declinedTransfer.requesting_id,
          type: 'transfer_update',
          title: 'Transfer declined',
          message: `Your ${typeByGroupId[declinedTransfer.blood_group_id]} transfer request was declined due to insufficient supplier stock.`,
          relatedType: 'transfer',
          relatedId: id
        });
      }
      return res.json({ success: true });
    }

    const transfer = db.prepare('SELECT * FROM transfers WHERE id = ?').get(id);
    if (!transfer) return res.status(404).json({ error: 'Transfer request not found' });
    if (transfer.status !== 'Pending') return res.status(400).json({ error: 'Transfer is already processed' });

    const { requesting_id: requestingId, supplying_id: supplyingId, blood_group_id: groupIdVal, units } = transfer;

    const supplierInv = db.prepare('SELECT units FROM blood_inventory WHERE blood_bank_id = ? AND blood_group_id = ?').get(supplyingId, groupIdVal);
    const currentUnits = supplierInv ? supplierInv.units : 0;
    if (currentUnits < units) {
      return res.status(400).json({ error: `Insufficient stock of ${typeByGroupId[groupIdVal]} in supplying blood bank (Available: ${currentUnits})` });
    }

    // Run the whole stock adjustment as one atomic transaction
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO blood_inventory (blood_bank_id, blood_group_id, units, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(blood_bank_id, blood_group_id) DO UPDATE SET units = units - ?, updated_at = datetime('now')`
      ).run(supplyingId, groupIdVal, currentUnits - units, units);

      const reqUser = db.prepare('SELECT role FROM users WHERE id = ?').get(requestingId);
      if (reqUser && reqUser.role === 'Blood Bank') {
        const reqInv = db.prepare('SELECT units FROM blood_inventory WHERE blood_bank_id = ? AND blood_group_id = ?').get(requestingId, groupIdVal);
        const newUnits = (reqInv ? reqInv.units : 0) + units;
        db.prepare(
          `INSERT INTO blood_inventory (blood_bank_id, blood_group_id, units, updated_at) VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(blood_bank_id, blood_group_id) DO UPDATE SET units = excluded.units, updated_at = datetime('now')`
        ).run(requestingId, groupIdVal, newUnits);
      } else if (reqUser && reqUser.role === 'Hospital') {
        db.prepare("UPDATE hospital_profiles SET quota_used = quota_used + ?, updated_at = datetime('now') WHERE user_id = ?").run(units, requestingId);
      }

      db.prepare("UPDATE transfers SET status = 'Approved', updated_at = datetime('now') WHERE id = ?").run(id);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Post-commit: low-stock check for the supplier (their stock just went down) + a status
    // notice to whoever requested the transfer. Neither needs to be inside the transaction.
    checkLowStockAndNotify(supplyingId, typeByGroupId[groupIdVal], currentUnits - units);
    notify({
      userId: requestingId,
      type: 'transfer_update',
      title: 'Transfer approved',
      message: `Your ${typeByGroupId[groupIdVal]} transfer request (${units} unit(s)) has been approved and stock has been updated.`,
      relatedType: 'transfer',
      relatedId: id
    });

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   APPOINTMENTS API (general — camp / hospital / blood-bank visits)
   ========================================== */

app.get('/api/appointments', requireAuth, (req, res) => {
  try {
    const { donor_id } = req.query;
    // Non-admins may only list their own appointments — a donor_id supplied in the query
    // string was previously trusted with no ownership check (IDOR).
    const effectiveDonorId = req.actor.role === 'Admin' ? donor_id : req.actor.id;
    let sql = 'SELECT * FROM appointments';
    const params = [];
    if (effectiveDonorId) { sql += ' WHERE donor_id = ?'; params.push(effectiveDonorId); }
    else if (req.actor.role !== 'Admin') {
      // Non-admin, non-donor actor with no donor_id filter — nothing they're entitled to see.
      return res.json([]);
    }
    sql += ' ORDER BY scheduled_date';
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/appointments', requireAuth, (req, res) => {
  try {
    const { donorId, campId, hospitalId, bloodBankId, scheduledDate, slot } = req.body;
    if (req.actor.role !== 'Admin' && req.actor.id !== donorId) {
      return res.status(403).json({ error: 'You can only book appointments for yourself.' });
    }
    const id = 'ap' + Date.now();
    db.prepare(
      `INSERT INTO appointments (id, donor_id, camp_id, hospital_id, blood_bank_id, scheduled_date, slot, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Scheduled')`
    ).run(id, donorId, campId || null, hospitalId || null, bloodBankId || null, scheduledDate, slot || null);
    res.json({ success: true, id });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/appointments/:id', requireAuth, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const appt = db.prepare('SELECT donor_id, hospital_id, blood_bank_id FROM appointments WHERE id = ?').get(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    const isOwnerParty = req.actor.id === appt.donor_id || req.actor.id === appt.hospital_id || req.actor.id === appt.blood_bank_id;
    if (req.actor.role !== 'Admin' && !isOwnerParty) {
      return res.status(403).json({ error: 'You can only update your own appointments.' });
    }
    db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   NOTIFICATIONS API
   ------------------------------------------
   In-app notifications go through services/notifications.js for every write
   path (preferences + anti-spam are enforced there, not per-route). This
   section is intentionally thin — it's the HTTP surface, not the logic.

   Every route below requires auth and enforces that a non-admin actor can
   only read/act on their own notifications — user_id was previously taken
   from the query/body with no ownership check, letting any caller read
   (or mark read) any other user's private notification feed.
   ========================================== */

app.get('/api/notifications', requireAuth, (req, res) => {
  try {
    const { unread_only } = req.query;
    const user_id = req.actor.role === 'Admin' && req.query.user_id ? req.query.user_id : req.actor.id;
    res.json(notificationService.listNotifications(db, user_id, { unreadOnly: unread_only === 'true' }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/notifications/unread-count', requireAuth, (req, res) => {
  try {
    const user_id = req.actor.role === 'Admin' && req.query.user_id ? req.query.user_id : req.actor.id;
    res.json(notificationService.getUnreadCount(db, user_id));
  } catch (err) {
    sendError(res, err);
  }
});

// Manual/system notification creation (e.g. admin broadcasts). Still goes through the
// full notify() pipeline, so preferences and anti-spam apply even here.
app.post('/api/notifications', requireAdmin, (req, res) => {
  try {
    const { userId, type, title, message, relatedType, relatedId, urgency } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ error: 'userId, title, and message are required' });
    const result = notify({ userId, type: type || 'system', title, message, relatedType: relatedType || null, relatedId: relatedId || null, urgency: urgency || null });
    res.json({ success: !result.skipped, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/notifications/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT user_id FROM notifications WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    if (req.actor.role !== 'Admin' && row.user_id !== req.actor.id) {
      return res.status(403).json({ error: 'You can only mark your own notifications as read.' });
    }
    notificationService.markRead(db, req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/notifications/read-all', requireAuth, (req, res) => {
  try {
    const userId = req.actor.role === 'Admin' && req.body.userId ? req.body.userId : req.actor.id;
    notificationService.markAllRead(db, userId);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ---- Notification preferences ---- */

app.get('/api/notification-preferences', requireAuth, (req, res) => {
  try {
    const user_id = req.actor.role === 'Admin' && req.query.user_id ? req.query.user_id : req.actor.id;
    res.json(notificationService.listPreferences(db, user_id));
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/notification-preferences', requireAuth, (req, res) => {
  try {
    const { category, inApp, telegram } = req.body;
    const userId = req.actor.role === 'Admin' && req.body.userId ? req.body.userId : req.actor.id;
    if (!category) return res.status(400).json({ error: 'category is required' });
    const updated = notificationService.setPreference(db, userId, category, { inApp, telegram });
    res.json({ success: true, ...updated });
  } catch (err) {
    sendError(res, err, 400);
  }
});

/* ---- Delivery status (admin/debug view into the external-delivery retry queue) ---- */

app.get('/api/notifications/:id/deliveries', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY id ASC').all(req.params.id);
    res.json(rows);
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   DONOR MATCHES API (persists AI Match results)
   ========================================== */

// Reveals which specific donors were matched to a given emergency — restricted to
// operational roles rather than public, since it links a donor identity to a hospital's
// emergency request.
app.get('/api/donor_matches', requireHospital, (req, res) => {
  try {
    const { emergency_id } = req.query;
    let sql = 'SELECT * FROM donor_matches';
    const params = [];
    if (emergency_id) { sql += ' WHERE emergency_id = ?'; params.push(emergency_id); }
    sql += ' ORDER BY compatibility_score DESC, reliability_score DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/donor_matches', requireHospital, (req, res) => {
  try {
    const { emergencyId, matches } = req.body; // matches: [{ donorId, compatibilityScore, distanceKm, reliabilityScore, responseScore }]
    if (!Array.isArray(matches)) return res.status(400).json({ error: 'matches must be an array' });
    const insert = db.prepare(
      `INSERT INTO donor_matches (emergency_id, donor_id, compatibility_score, distance_km, reliability_score, response_score)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    matches.forEach((m) => {
      insert.run(emergencyId || null, m.donorId, m.compatibilityScore, m.distanceKm, m.reliabilityScore, m.responseScore);
    });
    // Also log a heuristic AI prediction record for auditability
    db.prepare(
      `INSERT INTO ai_predictions (prediction_type, subject_type, subject_id, score, features, model_version)
       VALUES ('donor_match', 'emergency', ?, ?, ?, 'rule-based-v1')`
    ).run(emergencyId || null, matches[0]?.compatibilityScore ?? null, JSON.stringify({ matchCount: matches.length }));
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   DONOR MATCHING / RANKING SERVICE
   ------------------------------------------
   This is a RECOMMENDATION engine — it suggests donors worth contacting,
   it does not make a medical decision and does not replace clinical
   screening at the point of donation. See matching.js for the scoring
   logic and its documentation.
   ========================================== */

app.post('/api/matching/rank-donors', (req, res) => {
  try {
    const { bloodType, urgency, lat, lng, radiusKm, limit, weights, emergencyId, persist } = req.body;
    if (!bloodType) return res.status(400).json({ error: 'bloodType is required' });

    const result = rankDonorsForRequest(db, {
      requestedBloodType: bloodType,
      urgency: urgency || 'Normal',
      lat: lat ?? null,
      lng: lng ?? null,
      radiusKm: radiusKm ?? 15,
      limit: limit ?? 10,
      weights: weights || {},
      groupIdByType
    });

    // Persist this ranking run for audit history / future model comparison — opt-in via `persist`,
    // since the AI Match page also supports a "preview only" mode that doesn't want to write rows.
    if (persist !== false) {
      const insertMatch = db.prepare(
        `INSERT INTO donor_matches (emergency_id, donor_id, compatibility_score, distance_km, reliability_score, response_score, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Suggested')`
      );
      result.results.forEach((r) => {
        insertMatch.run(
          emergencyId || null,
          r.donorId,
          r.factors.compatibility.score * 100,
          r.distanceKm,
          r.factors.history.score * 100,
          r.factors.responseRate.score * 100
        );
      });
      db.prepare(
        `INSERT INTO ai_predictions (prediction_type, subject_type, subject_id, score, features, model_version)
         VALUES ('donor_match', 'emergency', ?, ?, ?, ?)`
      ).run(
        emergencyId || null,
        result.results[0]?.matchScore != null ? result.results[0].matchScore / 100 : null,
        JSON.stringify({ bloodType, urgency, matchCount: result.results.length, weightsUsed: result.weights }),
        MATCHING_STRATEGY
      );
      db.prepare('INSERT INTO analytics_events (event_type, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?)')
        .run('ai_match_run', 'blood_type', bloodType, JSON.stringify({ urgency, radiusKm, matchCount: result.results.length }));
    }

    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/matching/weights', (req, res) => {
  res.json({ weights: DEFAULT_WEIGHTS, strategy: MATCHING_STRATEGY });
});

/* ==========================================
   BLOOD GROUPS (lookup) + ANALYTICS
   ========================================== */

app.get('/api/blood_groups', (req, res) => {
  try {
    res.json(db.prepare('SELECT id, type FROM blood_groups ORDER BY type').all());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/analytics/events', requireAdmin, (req, res) => {
  try {
    const { event_type, limit } = req.query;
    let sql = 'SELECT * FROM analytics_events';
    const params = [];
    if (event_type) { sql += ' WHERE event_type = ?'; params.push(event_type); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.min(parseInt(limit, 10) || 20, 100));
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })));
  } catch (err) {
    sendError(res, err);
  }
});

// Lightweight client-side telemetry (page views, UI interactions) — legitimately fires
// before login, so stays unauthenticated, just rate-limited against log-flooding abuse.
app.post('/api/analytics/events', rateLimit('analytics-event', 120, 60000), (req, res) => {
  try {
    const { eventType, userId, entityType, entityId, metadata } = req.body;
    if (!eventType) return res.status(400).json({ error: 'eventType is required' });
    db.prepare(
      `INSERT INTO analytics_events (event_type, user_id, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)`
    ).run(eventType, userId || null, entityType || null, entityId || null, metadata ? JSON.stringify(metadata) : null);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/analytics/summary', requireAdmin, (req, res) => {
  try {
    const totals = {
      totalUsers: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      totalDonors: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'Donor'").get().c,
      totalHospitals: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'Hospital'").get().c,
      totalBloodBanks: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'Blood Bank'").get().c,
      totalDonations: db.prepare('SELECT COUNT(*) c FROM donations').get().c,
      completedDonations: db.prepare("SELECT COUNT(*) c FROM donations WHERE status = 'Completed'").get().c,
      activeEmergencies: db.prepare("SELECT COUNT(*) c FROM emergencies WHERE status IN ('Pending','In Progress')").get().c,
      totalCamps: db.prepare('SELECT COUNT(*) c FROM camps').get().c,
      eventsLast7Days: db.prepare("SELECT COUNT(*) c FROM analytics_events WHERE created_at >= datetime('now', '-7 days')").get().c
    };
    res.json(totals);
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   COMPREHENSIVE ANALYTICS DASHBOARD
   ------------------------------------------
   Everything here is computed live from services/analytics.js — no
   hardcoded numbers. This is additive: it does not touch or replace
   /api/analytics/summary above, which the existing Admin Dashboard
   overview cards and Home page already depend on.
   ========================================== */

const analyticsService = require('./services/analytics');

app.get('/api/analytics/dashboard', requireAdmin, (req, res) => {
  try {
    const { dateFrom, dateTo, bloodGroup, city, hospitalId, bloodBankId } = req.query;
    const filters = {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      bloodGroup: bloodGroup || undefined,
      city: city || undefined,
      hospitalId: hospitalId || undefined,
      bloodBankId: bloodBankId || undefined
    };
    res.json(analyticsService.getFullDashboard(db, filters));
  } catch (err) {
    sendError(res, err);
  }
});

// Populates filter dropdowns with real, current values (not hardcoded lists)
app.get('/api/analytics/filter-options', requireAdmin, (req, res) => {
  try {
    const bloodGroups = db.prepare('SELECT type FROM blood_groups ORDER BY type').all().map((r) => r.type);
    const cities = db.prepare(`
      SELECT DISTINCT city FROM locations WHERE city IS NOT NULL
      UNION SELECT DISTINCT city FROM camps WHERE city IS NOT NULL
      ORDER BY city
    `).all().map((r) => r.city);
    const hospitals = db.prepare(`
      SELECT u.id, u.name FROM hospital_profiles hp JOIN users u ON u.id = hp.user_id ORDER BY u.name
    `).all();
    const bloodBanks = db.prepare(`
      SELECT u.id, u.name FROM blood_bank_profiles bbp JOIN users u ON u.id = bbp.user_id ORDER BY u.name
    `).all();
    res.json({ bloodGroups, cities, hospitals, bloodBanks });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   ROLE-SCOPED DASHBOARD KPI ENDPOINTS
   ------------------------------------------
   Single endpoint per role that returns everything the dashboard overview
   needs in one round-trip. Gated by role so callers can't cross-read data.
   ========================================== */

app.get('/api/dashboard/donor', requireDonor, (req, res) => {
  try {
    const actorId = req.actor.id;
    const donor = db.prepare('SELECT * FROM users WHERE id = ?').get(actorId);
    if (!donor) return res.status(404).json({ error: 'Donor not found' });

    const donationsRaw = db.prepare(donationJoinSql + ' WHERE d.donor_id = ? ORDER BY d.donation_date DESC').all(actorId);
    const donations = donationsRaw.map(buildDonationResponse);
    const completedDonations = donations.filter(d => d.status === 'Completed');
    const lastDonationDate = completedDonations[0]?.donationDate || null;
    const daysSinceLast = lastDonationDate
      ? Math.floor((Date.now() - new Date(lastDonationDate).getTime()) / 86400000)
      : null;

    const upcomingAppointments = db.prepare(
      "SELECT a.*, c.title as camp_title, c.venue as camp_venue, u.name as hospital_name FROM appointments a LEFT JOIN camps c ON c.id = a.camp_id LEFT JOIN users u ON u.id = a.hospital_id WHERE a.donor_id = ? AND a.status IN ('Scheduled','Confirmed') AND date(a.scheduled_date) >= date('now') ORDER BY a.scheduled_date ASC LIMIT 5"
    ).all(actorId);

    const campRegistrations = db.prepare(
      "SELECT cr.*, c.title, c.camp_date, c.venue, c.city FROM camp_registrations cr JOIN camps c ON c.id = cr.camp_id WHERE cr.donor_id = ? AND cr.status = 'Registered' AND date(c.camp_date) >= date('now') ORDER BY c.camp_date ASC LIMIT 5"
    ).all(actorId);

    // Open emergencies compatible with this donor's blood group (for actionable tasks)
    const dpRow = db.prepare('SELECT blood_group_id FROM donor_profiles WHERE user_id = ?').get(actorId);
    const compatibleEmergenciesRaw = dpRow ? db.prepare(
      `SELECT e.*, u.name as hospital_name, bg.type as blood_type FROM emergencies e
       LEFT JOIN users u ON u.id = e.hospital_id
       LEFT JOIN blood_groups bg ON bg.id = e.blood_group_id
       WHERE e.status IN ('Donors Notified','Searching','Pending')
         AND e.blood_group_id IN (SELECT recipient_group_id FROM blood_compatibility WHERE donor_group_id = ?)
       ORDER BY CASE e.urgency WHEN 'Critical' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END, e.created_at DESC LIMIT 5`
    ).all(dpRow.blood_group_id) : [];
    // Shape to match Emergency frontend interface
    const compatibleEmergencies = compatibleEmergenciesRaw.map(e => ({
      id: e.id, patientName: e.patient_name, bloodType: e.blood_type, hospital: e.hospital_name || e.hospital || '',
      units: e.units_needed || e.units, urgency: e.urgency, ward: e.ward, time: e.created_at,
      status: e.status, alerts: e.alerts_sent || 0, lat: e.lat, lng: e.lng
    }));

    // Donor rank
    const allDonors = db.prepare("SELECT id, xp FROM users WHERE role='Donor' ORDER BY xp DESC").all();
    const rankIdx = allDonors.findIndex(d => d.id === actorId);

    // Lives impact: each unit can save up to 3 patients
    const livesImpact = completedDonations.length * 3;

    const nearbyCampsRaw = db.prepare(
      "SELECT * FROM camps WHERE status = 'Scheduled' AND approved = 1 AND date(camp_date) >= date('now') ORDER BY camp_date ASC LIMIT 4"
    ).all();
    const nearbyCamps = nearbyCampsRaw.map(c => ({ ...c, date: c.camp_date, location: c.location_label || c.city || '' }));

    res.json({
      stats: {
        totalDonations: completedDonations.length,
        xp: donor.xp,
        rank: rankIdx >= 0 ? rankIdx + 1 : null,
        totalDonors: allDonors.length,
        livesImpact,
        daysSinceLast,
        isEligible: daysSinceLast === null || daysSinceLast >= 90,
        daysUntilEligible: daysSinceLast !== null ? Math.max(0, 90 - daysSinceLast) : 0,
        lastDonationDate
      },
      recentDonations: donations.slice(0, 5),
      upcomingAppointments,
      campRegistrations,
      compatibleEmergencies,
      nearbyCamps
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/dashboard/hospital', requireHospital, (req, res) => {
  try {
    const actorId = req.actor.id;

    const myEmergencies = db.prepare(
      "SELECT e.*, bg.type as blood_type_label FROM emergencies e LEFT JOIN blood_groups bg ON bg.id = e.blood_group_id WHERE e.hospital_id = ? ORDER BY CASE e.status WHEN 'Pending' THEN 0 WHEN 'Searching' THEN 1 WHEN 'Donors Notified' THEN 2 WHEN 'Donor Responded' THEN 3 WHEN 'Blood Reserved' THEN 4 ELSE 5 END, e.created_at DESC LIMIT 25"
    ).all(actorId);

    const active = myEmergencies.filter(e => !['Fulfilled','Cancelled','Expired'].includes(e.status));
    const fulfilled = myEmergencies.filter(e => e.status === 'Fulfilled');

    // Accepted donor matches awaiting reserve action
    const awaitingReserve = db.prepare(
      "SELECT dm.*, e.blood_group_id, bg.type as blood_type, u.name as donor_name, u.location_id FROM donor_matches dm JOIN emergencies e ON e.id = dm.emergency_id JOIN blood_groups bg ON bg.id = e.blood_group_id JOIN users u ON u.id = dm.donor_id WHERE e.hospital_id = ? AND dm.status = 'Accepted' ORDER BY dm.compatibility_score DESC LIMIT 10"
    ).all(actorId);

    // Aggregate blood availability from blood banks
    const inventory = db.prepare(
      "SELECT bg.type, COALESCE(SUM(bi.units), 0) as total FROM blood_groups bg LEFT JOIN blood_inventory bi ON bi.blood_group_id = bg.id GROUP BY bg.id ORDER BY bg.id"
    ).all();

    // Recent verified donations at this hospital
    const recentDonationsRaw = db.prepare(
      donationJoinSql + ' WHERE d.hospital_id = ? ORDER BY d.created_at DESC LIMIT 10'
    ).all(actorId);
    const recentDonations = recentDonationsRaw.map(buildDonationResponse);

    // Month-over-month request counts
    const thisMonth = db.prepare("SELECT COUNT(*) c FROM emergencies WHERE hospital_id = ? AND created_at >= date('now','start of month')").get(actorId).c;
    const lastMonth = db.prepare("SELECT COUNT(*) c FROM emergencies WHERE hospital_id = ? AND created_at >= date('now','start of month','-1 month') AND created_at < date('now','start of month')").get(actorId).c;

    res.json({
      kpis: {
        activeRequests: active.length,
        fulfilledTotal: fulfilled.length,
        thisMonthRequests: thisMonth,
        lastMonthRequests: lastMonth,
        awaitingReserveCount: awaitingReserve.length,
        avgFulfillmentMinutes: (() => {
          const durations = fulfilled.map(e => {
            const c = new Date(e.created_at || e.time).getTime();
            const u = new Date(e.updated_at || e.time).getTime();
            return u - c;
          }).filter(ms => ms > 0);
          if (!durations.length) return null;
          return Math.round(durations.reduce((a,b)=>a+b,0)/durations.length/60000);
        })()
      },
      myEmergencies,
      awaitingReserve,
      inventory,
      recentDonations
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/dashboard/bloodbank', requireBloodBank, (req, res) => {
  try {
    const actorId = req.actor.id;

    const bankProfile = db.prepare('SELECT * FROM blood_bank_profiles WHERE user_id = ?').get(actorId);
    if (!bankProfile) return res.status(404).json({ error: 'Blood bank profile not found' });

    const inventory = db.prepare(
      "SELECT bg.type, COALESCE(bi.units, 0) as units FROM blood_groups bg LEFT JOIN blood_inventory bi ON bi.blood_group_id = bg.id AND bi.blood_bank_id = ? ORDER BY bg.id"
    ).all(actorId);

    const totalUnits = inventory.reduce((s, r) => s + r.units, 0);
    const lowStockTypes = inventory.filter(r => r.units <= 10).map(r => r.type);
    const criticalTypes = inventory.filter(r => r.units === 0).map(r => r.type);

    const myTransfers = db.prepare(
      "SELECT t.*, bg.type as blood_type, ru.name as requesting_name, su.name as supplying_name FROM transfers t JOIN blood_groups bg ON bg.id = t.blood_group_id JOIN users ru ON ru.id = t.requesting_id JOIN users su ON su.id = t.supplying_id WHERE t.requesting_id = ? OR t.supplying_id = ? ORDER BY t.created_at DESC LIMIT 20"
    ).all(actorId, actorId);

    const pendingIncoming = myTransfers.filter(t => t.supplying_id === actorId && t.status === 'Pending');
    const recentDonationsRaw = db.prepare(
      donationJoinSql + ' WHERE d.blood_bank_id = ? ORDER BY d.created_at DESC LIMIT 10'
    ).all(actorId);
    const recentDonations = recentDonationsRaw.map(buildDonationResponse);

    // Shortage notifications for this bank
    const notifications = db.prepare(
      "SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL AND category IN ('inventory') ORDER BY created_at DESC LIMIT 5"
    ).all(actorId);

    // Monthly intake trend (last 6 months)
    const intakeTrend = db.prepare(
      "SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM donations WHERE blood_bank_id = ? AND created_at >= date('now','-6 months') GROUP BY month ORDER BY month ASC"
    ).all(actorId);

    res.json({
      kpis: {
        totalUnits,
        lowStockCount: lowStockTypes.length,
        criticalCount: criticalTypes.length,
        pendingIncomingTransfers: pendingIncoming.length,
        completedTransfers: myTransfers.filter(t => t.status === 'Approved').length,
        totalDonationsProcessed: recentDonations.length
      },
      inventory,
      lowStockTypes,
      criticalTypes,
      myTransfers,
      pendingIncoming,
      recentDonations,
      notifications,
      intakeTrend
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/dashboard/admin', requireAdmin, (req, res) => {
  try {
    const donors = db.prepare("SELECT * FROM users WHERE role = 'Donor'").all();
    const hospitals = db.prepare("SELECT * FROM users WHERE role = 'Hospital'").all();
    const bloodBanks = db.prepare("SELECT * FROM users WHERE role = 'Blood Bank'").all();

    const activeEmergencies = db.prepare(
      "SELECT e.*, bg.type as blood_type, u.name as hospital_name FROM emergencies e LEFT JOIN blood_groups bg ON bg.id = e.blood_group_id LEFT JOIN users u ON u.id = e.hospital_id WHERE e.status NOT IN ('Fulfilled','Cancelled','Expired') ORDER BY CASE e.urgency WHEN 'Critical' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END, e.created_at DESC LIMIT 20"
    ).all();
    const allEmergencies = db.prepare("SELECT * FROM emergencies").all();

    const pendingOnboarding = db.prepare("SELECT * FROM users WHERE is_new_registration = 1").all();
    const pendingUpdates = db.prepare("SELECT * FROM users WHERE pending_update IS NOT NULL").all();
    const pendingCamps = db.prepare("SELECT * FROM camps WHERE approved = 0 AND status = 'Pending Approval'").all();
    const unverifiedCamps = db.prepare("SELECT * FROM camps WHERE source != 'manual' AND verification_status IN ('Unverified','Flagged')").all();

    const inventoryByGroup = db.prepare(
      "SELECT bg.type, COALESCE(SUM(bi.units),0) as total FROM blood_groups bg LEFT JOIN blood_inventory bi ON bi.blood_group_id = bg.id GROUP BY bg.id ORDER BY bg.id"
    ).all();
    const shortages = inventoryByGroup.filter(r => r.total <= 30);

    const recentEmergencies = allEmergencies.slice(0, 10);
    const fulfilled = allEmergencies.filter(e => e.status === 'Fulfilled');
    const fulfillmentRate = allEmergencies.length > 0
      ? Math.round((fulfilled.length / allEmergencies.length) * 100)
      : 0;

    // 7-day emergency trend (count per day)
    const emergencyTrend = db.prepare(
      "SELECT date(created_at) as day, COUNT(*) as count FROM emergencies WHERE created_at >= date('now','-7 days') GROUP BY day ORDER BY day ASC"
    ).all();

    // Blood group donor distribution
    const donorsByGroup = db.prepare(
      "SELECT bg.type, COUNT(dp.user_id) as count FROM blood_groups bg LEFT JOIN donor_profiles dp ON dp.blood_group_id = bg.id GROUP BY bg.id ORDER BY bg.id"
    ).all();

    res.json({
      kpis: {
        totalDonors: donors.length,
        activeDonors: donors.filter(d => d.status === 'Active').length,
        totalHospitals: hospitals.length,
        totalBloodBanks: bloodBanks.length,
        activeEmergencyCount: activeEmergencies.length,
        fulfillmentRate,
        pendingActionsCount: pendingOnboarding.length + pendingUpdates.length + pendingCamps.length,
        shortageCount: shortages.length,
        totalUnits: inventoryByGroup.reduce((s, r) => s + r.total, 0)
      },
      activeEmergencies,
      pendingOnboarding,
      pendingUpdates,
      pendingCamps,
      unverifiedCamps,
      shortages,
      inventoryByGroup,
      emergencyTrend,
      donorsByGroup
    });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   BLOOD DEMAND FORECASTING (ESTIMATES — NOT MEDICAL ADVICE)
   ------------------------------------------
   See services/demandForecast.js for the full explanation. Short version:
   this is a simple, explainable statistical estimate for planning
   purposes, currently trained on a clearly-labeled SYNTHETIC historical
   dataset (services/demandForecast.js + setup_db.js's
   synthetic_demand_history generator) because the live app doesn't yet
   have enough real history. Every response says so explicitly via
   `dataSource` / `disclaimer` fields — never strip those out.
   ========================================== */

const demandForecastService = require('./services/demandForecast');

const FORECAST_DISCLAIMER =
  'This is a statistical estimate for planning purposes only — not a medical or clinical forecast, and not a guarantee of future demand. ' +
  'Currently trained on a clearly-labeled SYNTHETIC historical dataset (see setup_db.js) because live application history is not yet sufficient for meaningful forecasting.';

app.get('/api/forecast/demand', requireAdmin, (req, res) => {
  try {
    const { bloodGroup, city, horizonDays } = req.query;
    const results = demandForecastService.forecastBloodGroupDemand(db, {
      bloodGroup: bloodGroup || undefined,
      city: city || undefined,
      horizonDays: horizonDays ? parseInt(horizonDays, 10) : 7,
      groupIdByType
    });
    res.json({ results, disclaimer: FORECAST_DISCLAIMER, generatedAt: new Date().toISOString() });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/forecast/high-risk-locations', requireAdmin, (req, res) => {
  try {
    const { horizonDays } = req.query;
    const results = demandForecastService.forecastHighRiskLocations(db, {
      horizonDays: horizonDays ? parseInt(horizonDays, 10) : 7,
      groupIdByType
    });
    res.json({ results, disclaimer: FORECAST_DISCLAIMER, generatedAt: new Date().toISOString() });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/forecast/history', requireAdmin, (req, res) => {
  try {
    const { bloodGroup, city, days } = req.query;
    if (!bloodGroup) return res.status(400).json({ error: 'bloodGroup is required' });
    const lookback = days ? parseInt(days, 10) : 90;
    let sql = `
      SELECT record_date as date, day_of_week as dayOfWeek, SUM(units_requested) as units, SUM(request_count) as requests
      FROM synthetic_demand_history WHERE blood_group_id = ?`;
    const params = [groupIdByType[bloodGroup]];
    if (city) { sql += ' AND city = ?'; params.push(city); }
    sql += ' GROUP BY record_date ORDER BY record_date DESC LIMIT ?';
    params.push(lookback);
    const rows = db.prepare(sql).all(...params).reverse();
    res.json({ history: rows, isSynthetic: true, disclaimer: FORECAST_DISCLAIMER });
  } catch (err) {
    sendError(res, err);
  }
});

/* ==========================================
   TELEGRAM POLLING + SPA FALLBACK
   ========================================== */

startTelegramPolling();

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
