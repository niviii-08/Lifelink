/* ==========================================================================
   LifeLink — Database Setup & Seed Script
   --------------------------------------------------------------------------
   Creates a normalized SQLite schema (19 tables) and loads REALISTIC BUT
   100% FICTIONAL development/demo data.

   ⚠️  DEMO DATA DISCLAIMER
   Every hospital, blood bank, donor, patient, and camp below is invented
   for local development and testing. None of it refers to real people,
   real medical records, or real institutions — organization names were
   deliberately chosen to NOT match real hospital/blood-bank brands.
   Do not use this data for anything other than local development.

   Uses Node's built-in `node:sqlite` module (DatabaseSync) — no native
   compilation required, works on any Node >= 22.5.
   ========================================================================== */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'lifelink.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

console.log('==========================================================');
console.log(' LifeLink DB Setup — building schema + DEMO/DEV seed data');
console.log(' (fictional data only — not real patients or institutions)');
console.log('==========================================================');

/* --------------------------------------------------------------------------
   1. SCHEMA
   -------------------------------------------------------------------------- */

db.exec(`
DROP TABLE IF EXISTS synthetic_demand_history;
DROP TABLE IF EXISTS ai_predictions;
DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS notification_deliveries;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS camp_registrations;
DROP TABLE IF EXISTS donations;
DROP TABLE IF EXISTS camp_ingestion_runs;
DROP TABLE IF EXISTS camps;
DROP TABLE IF EXISTS donor_matches;
DROP TABLE IF EXISTS emergency_status_history;
DROP TABLE IF EXISTS emergencies;
DROP TABLE IF EXISTS blood_inventory;
DROP TABLE IF EXISTS blood_bank_profiles;
DROP TABLE IF EXISTS hospital_profiles;
DROP TABLE IF EXISTS donor_profiles;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS blood_compatibility;
DROP TABLE IF EXISTS blood_groups;
DROP TABLE IF EXISTS locations;
`);

db.exec(`
/* ---- 6. Blood groups (lookup) ---- */
CREATE TABLE blood_groups (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT UNIQUE NOT NULL
);

/* Donor group -> recipient groups it can safely give to */
CREATE TABLE blood_compatibility (
  donor_group_id     INTEGER NOT NULL REFERENCES blood_groups(id) ON DELETE CASCADE,
  recipient_group_id INTEGER NOT NULL REFERENCES blood_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (donor_group_id, recipient_group_id)
);

/* ---- 16. Locations (reusable geo entity) ---- */
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  address    TEXT,
  city       TEXT DEFAULT 'Coimbatore',
  lat        REAL,
  lng        REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_locations_geo ON locations(lat, lng);

/* ---- 1. Users (core identity / auth) ---- */
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  role                TEXT NOT NULL CHECK(role IN ('Donor','Patient','Hospital','Blood Bank','Admin')),
  password_hash       TEXT NOT NULL,
  telegram_chat_id    TEXT,
  passport_id         TEXT UNIQUE,
  status              TEXT DEFAULT 'Active',
  is_new_registration INTEGER DEFAULT 0,
  pending_update      TEXT,
  total_donations     INTEGER DEFAULT 0,
  xp                  INTEGER DEFAULT 0,
  location_id         INTEGER REFERENCES locations(id),
  lat                 REAL,
  lng                 REAL,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_telegram ON users(telegram_chat_id);
CREATE INDEX idx_users_status ON users(status);

/* ---- 2. Donors (role-specific profile) ---- */
CREATE TABLE donor_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blood_group_id      INTEGER NOT NULL REFERENCES blood_groups(id),
  availability_status TEXT DEFAULT 'Active',   -- Active, On Duty, Inactive
  last_donation_date  TEXT,
  next_eligible_date  TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_donor_blood_group ON donor_profiles(blood_group_id);
CREATE INDEX idx_donor_availability ON donor_profiles(availability_status);

/* ---- 3. Hospitals (role-specific profile) ---- */
CREATE TABLE hospital_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  license_number      TEXT,
  accreditation_doc   TEXT,
  location_id         INTEGER REFERENCES locations(id),
  quota_used          INTEGER DEFAULT 0,
  quota_limit         INTEGER DEFAULT 0,
  active_emergencies  INTEGER DEFAULT 0,
  verification_status TEXT DEFAULT 'Pending Verification',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_hospital_verification ON hospital_profiles(verification_status);

/* ---- 4. Blood banks (role-specific profile) ---- */
CREATE TABLE blood_bank_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  license_number      TEXT,
  location_id         INTEGER REFERENCES locations(id),
  api_status          TEXT DEFAULT 'Setup Required',
  active_transfers    INTEGER DEFAULT 0,
  verification_status TEXT DEFAULT 'Pending Verification',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

/* ---- 5. Blood inventory (per bank, per group — replaces JSON blob) ---- */
CREATE TABLE blood_inventory (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  blood_bank_id  TEXT NOT NULL REFERENCES blood_bank_profiles(user_id) ON DELETE CASCADE,
  blood_group_id INTEGER NOT NULL REFERENCES blood_groups(id),
  units          INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(blood_bank_id, blood_group_id)
);
CREATE INDEX idx_inventory_bank ON blood_inventory(blood_bank_id);
CREATE INDEX idx_inventory_group ON blood_inventory(blood_group_id);

/* ---- 7. Emergency blood requests ---- */
CREATE TABLE emergencies (
  id             TEXT PRIMARY KEY,
  patient_name   TEXT,
  blood_group_id INTEGER NOT NULL REFERENCES blood_groups(id),
  hospital_id    TEXT REFERENCES hospital_profiles(user_id),
  hospital_name  TEXT,
  lat REAL, lng REAL,
  units_needed   INTEGER,
  urgency        TEXT CHECK(urgency IN ('Critical','Urgent','Normal')),
  ward           TEXT,
  -- Status workflow: Pending -> Searching -> Donors Notified -> Donor Responded
  --                  -> Blood Reserved -> Fulfilled
  --                  (Cancelled / Expired are terminal from any non-terminal state)
  status         TEXT DEFAULT 'Pending',
  alerts_sent    INTEGER DEFAULT 0,
  expires_at     TEXT,   -- countdown deadline; auto-expired by the background sweep if unresolved
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_emergencies_status ON emergencies(status);
CREATE INDEX idx_emergencies_blood_group ON emergencies(blood_group_id);
CREATE INDEX idx_emergencies_hospital ON emergencies(hospital_id);
CREATE INDEX idx_emergencies_expires ON emergencies(expires_at);

/* ---- 8. Donor matching results (persisted AI/rule-based suggestions) ---- */
CREATE TABLE donor_matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  emergency_id        TEXT REFERENCES emergencies(id) ON DELETE CASCADE,
  donor_id            TEXT REFERENCES users(id) ON DELETE CASCADE,
  compatibility_score REAL,
  distance_km         REAL,
  reliability_score   REAL,
  response_score      REAL,
  -- Suggested -> Notified -> Accepted | Declined -> (Accepted only) Reserved -> Donated
  status              TEXT DEFAULT 'Suggested',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_matches_emergency ON donor_matches(emergency_id);
CREATE INDEX idx_matches_donor ON donor_matches(donor_id);

/* ---- Emergency status audit trail — every workflow transition, who/what caused it ---- */
CREATE TABLE emergency_status_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  emergency_id   TEXT REFERENCES emergencies(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_id       TEXT,   -- user id, or NULL for system-driven transitions
  actor_label    TEXT,   -- 'system', 'hospital', 'donor', 'admin' — display-friendly
  note           TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_emergency_history_emergency ON emergency_status_history(emergency_id);

/* ---- 11. Donation camps (normalized — supports manual entry, official APIs, and permitted scraping) ---- */
CREATE TABLE camps (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  organizer_id     TEXT REFERENCES users(id),      -- set when organized by a registered LifeLink account
  organizer_name   TEXT,                            -- free-text organizer name (used when ingested externally)
  location_id      INTEGER REFERENCES locations(id),
  location_label   TEXT,
  venue            TEXT,                            -- specific venue/address text
  city             TEXT,
  state            TEXT,
  lat              REAL,
  lng              REAL,
  camp_date        TEXT,
  start_time       TEXT,                            -- e.g. '09:00 AM'
  end_time         TEXT,                            -- e.g. '04:00 PM'
  contact_phone    TEXT,
  contact_email    TEXT,
  registration_url TEXT,                            -- external registration link, if publicly listed
  capacity         INTEGER,
  registered_count INTEGER DEFAULT 0,
  approved         INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'Under Review', -- Under Review, Scheduled, In Progress, Completed, Rejected
  -- Data provenance — every camp knows where it came from and is never
  -- auto-verified just because it was ingested from an external source.
  source           TEXT DEFAULT 'manual',       -- manual | official_api | web_import
  source_name      TEXT,                        -- human-readable source label, e.g. "Sample Regional Health API"
  source_url       TEXT,                        -- the specific page/endpoint this record came from
  source_last_updated TEXT,                     -- when the SOURCE says this record was last updated
  verification_status TEXT DEFAULT 'Unverified', -- Unverified | Verified | Flagged
  verified_by      TEXT REFERENCES users(id),
  verified_at      TEXT,
  dedupe_key       TEXT,                        -- normalized (title+date+city) fingerprint used by the ingestion pipeline
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_camps_status ON camps(status);
CREATE INDEX idx_camps_date ON camps(camp_date);
CREATE INDEX idx_camps_city ON camps(city);
CREATE INDEX idx_camps_source ON camps(source, verification_status);
CREATE UNIQUE INDEX idx_camps_dedupe ON camps(dedupe_key);

/* ---- Ingestion run audit log — one row per pipeline execution (Fetch -> ... -> Store) ---- */
CREATE TABLE camp_ingestion_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL,           -- manual | official_api | web_import
  source_name    TEXT,
  triggered_by   TEXT REFERENCES users(id),
  status         TEXT DEFAULT 'Running',  -- Running, Completed, Failed
  fetched_count  INTEGER DEFAULT 0,
  valid_count    INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  invalid_count  INTEGER DEFAULT 0,
  inserted_count INTEGER DEFAULT 0,
  error_message  TEXT,
  log            TEXT,                    -- JSON array of step-by-step notes for transparency
  started_at     TEXT DEFAULT (datetime('now')),
  finished_at    TEXT
);
CREATE INDEX idx_ingestion_runs_source ON camp_ingestion_runs(source);

/* ---- 9 & 10. Donations (row-per-donation IS the donation history) ---- */
CREATE TABLE donations (
  id             TEXT PRIMARY KEY,
  donor_id       TEXT REFERENCES users(id),
  blood_group_id INTEGER REFERENCES blood_groups(id),
  hospital_id    TEXT REFERENCES hospital_profiles(user_id),
  blood_bank_id  TEXT REFERENCES blood_bank_profiles(user_id),
  emergency_id   TEXT REFERENCES emergencies(id),
  camp_id        TEXT REFERENCES camps(id),
  units          INTEGER DEFAULT 1,
  status         TEXT DEFAULT 'Scheduled',
  donation_date  TEXT,
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_donations_donor ON donations(donor_id);
CREATE INDEX idx_donations_status ON donations(status);
CREATE INDEX idx_donations_date ON donations(donation_date);

/* ---- 12. Camp registrations ---- */
CREATE TABLE camp_registrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  camp_id         TEXT REFERENCES camps(id) ON DELETE CASCADE,
  donor_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  verification_id TEXT,
  slot            TEXT,
  status          TEXT DEFAULT 'Registered', -- Registered, Attended, No-show, Cancelled
  reminded_at     TEXT,   -- set once a camp_reminder notification has gone out, so the sweep never repeats it
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(camp_id, donor_id)
);
CREATE INDEX idx_campreg_donor ON camp_registrations(donor_id);
CREATE INDEX idx_campreg_camp ON camp_registrations(camp_id);
CREATE INDEX idx_campreg_reminded ON camp_registrations(reminded_at);

/* ---- 13. Appointments (general — camp visit, hospital visit, blood-bank visit) ---- */
CREATE TABLE appointments (
  id             TEXT PRIMARY KEY,
  donor_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  camp_id        TEXT REFERENCES camps(id),
  hospital_id    TEXT REFERENCES hospital_profiles(user_id),
  blood_bank_id  TEXT REFERENCES blood_bank_profiles(user_id),
  scheduled_date TEXT,
  slot           TEXT,
  status         TEXT DEFAULT 'Scheduled', -- Scheduled, Confirmed, Completed, Cancelled, No-show
  reminded_at    TEXT,   -- set once an appointment_reminder notification has gone out, so the sweep never repeats it
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_appt_donor ON appointments(donor_id);
CREATE INDEX idx_appt_date ON appointments(scheduled_date);
CREATE INDEX idx_appt_reminded ON appointments(reminded_at);

/* ---- 14. Blood transfers (between blood banks / hospitals) ---- */
CREATE TABLE transfers (
  id             TEXT PRIMARY KEY,
  requesting_id  TEXT REFERENCES users(id),
  supplying_id   TEXT REFERENCES users(id),
  blood_group_id INTEGER REFERENCES blood_groups(id),
  units          INTEGER,
  status         TEXT DEFAULT 'Pending', -- Pending, Approved, Declined
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_transfers_requesting ON transfers(requesting_id);
CREATE INDEX idx_transfers_supplying ON transfers(supplying_id);

/* ---- 15. Notifications (in-app record — the source of truth for read/unread + history) ----
   External delivery (Telegram today, email/SMS/push later) is tracked separately in
   notification_deliveries so a failed/retrying external send never affects what the
   user sees in-app. See services/notifications.js for the full type registry. */
CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT,                 -- emergency_request, donor_match, donor_accepted, donor_declined,
                                      -- donor_reserved, request_fulfilled, donation_thanks, appointment_reminder,
                                      -- camp_reminder, camp_update, blood_shortage_alert, inventory_warning,
                                      -- transfer_update, otp, system
  category     TEXT DEFAULT 'account', -- emergency, request_status, reminders, inventory, account (drives preferences)
  title        TEXT,
  message      TEXT,
  urgency      TEXT DEFAULT 'Normal', -- Critical, Urgent, Normal, Info — lets the UI clearly separate urgent alerts
  channel      TEXT DEFAULT 'in_app', -- in_app is always written; external channels live in notification_deliveries
  related_type TEXT,
  related_id   TEXT,
  read_at      TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_urgency ON notifications(user_id, urgency);
CREATE INDEX idx_notifications_category ON notifications(category);

/* ---- Per-user, per-category notification preferences ----
   A missing row means "use the default" (everything on). Categories in
   LOCKED_CATEGORIES (see services/notifications.js) always deliver in-app
   regardless of this table — life-safety and account-security alerts are
   never fully silenced, only their external delivery is user-controllable. */
CREATE TABLE notification_preferences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL, -- emergency, request_status, reminders, inventory, account
  in_app     INTEGER DEFAULT 1,
  telegram   INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, category)
);
CREATE INDEX idx_notif_prefs_user ON notification_preferences(user_id);

/* ---- External delivery queue + retry log (Telegram today; email/SMS/push are additive later) ----
   One row per (notification, channel) delivery attempt series. The background sweep in
   server.js retries 'pending'/'retrying' rows whose next_retry_at has passed, with
   exponential backoff, up to MAX_ATTEMPTS, before marking the row 'failed'. */
CREATE TABLE notification_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,          -- telegram (email/sms/push can be added without a schema change)
  status          TEXT DEFAULT 'pending', -- pending, retrying, sent, failed
  attempts        INTEGER DEFAULT 0,
  last_error      TEXT,
  next_retry_at   TEXT DEFAULT (datetime('now')),
  sent_at         TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_deliveries_due ON notification_deliveries(status, next_retry_at);
CREATE INDEX idx_notif_deliveries_notification ON notification_deliveries(notification_id);

/* ---- 17. Analytics events (generic event log for dashboards) ---- */
CREATE TABLE analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,   -- search, emergency_created, donation_completed, login, ...
  user_id     TEXT REFERENCES users(id),
  entity_type TEXT,
  entity_id   TEXT,
  metadata    TEXT,            -- JSON
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_analytics_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_created ON analytics_events(created_at);

/* ---- 18. AI prediction data (clearly-labeled heuristic model outputs) ---- */
CREATE TABLE ai_predictions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_type TEXT,   -- donor_match, demand_forecast, no_show_risk
  subject_type    TEXT,   -- emergency, camp, donor
  subject_id      TEXT,
  score           REAL,
  features        TEXT,   -- JSON of inputs used to derive the score
  model_version   TEXT DEFAULT 'rule-based-v1',
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_predictions_subject ON ai_predictions(subject_type, subject_id);

/* ---- SYNTHETIC demand history — for demand-forecasting development ONLY ----
   The real emergencies/donations tables do not contain enough historical
   data (only a handful of days, one city) for meaningful blood-group x
   location x day-of-week forecasting. This table holds generated, clearly
   fictional daily request-volume history so the forecasting pipeline has
   something realistic to learn from during development. It is never
   presented to users as real historical fact — every row is flagged
   is_synthetic = 1, and every API response derived from it says so. */
CREATE TABLE synthetic_demand_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date    TEXT NOT NULL,
  day_of_week    INTEGER NOT NULL,   -- 0=Sunday .. 6=Saturday
  month          INTEGER NOT NULL,   -- 1-12
  blood_group_id INTEGER NOT NULL REFERENCES blood_groups(id),
  city           TEXT NOT NULL,
  request_count  INTEGER NOT NULL,   -- synthetic emergency-request count that day
  units_requested INTEGER NOT NULL,  -- synthetic total units requested that day
  is_synthetic   INTEGER NOT NULL DEFAULT 1,
  generator_version TEXT DEFAULT 'synthetic-gen-v1',
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_synthetic_demand_date ON synthetic_demand_history(record_date);
CREATE INDEX idx_synthetic_demand_group_city ON synthetic_demand_history(blood_group_id, city);

/* ---- OTP codes (Telegram-based verification, signup + login 2FA) ---- */
CREATE TABLE otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT,
  purpose    TEXT,
  code       TEXT,
  attempts   INTEGER DEFAULT 0,
  expires_at INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_otp_chat_purpose ON otp_codes(chat_id, purpose);
`);

console.log('✓ Schema created (24 tables, indexes applied).');

/* --------------------------------------------------------------------------
   2. SEED DATA — fictional, for local development only
   -------------------------------------------------------------------------- */

const bcrypt = require('bcryptjs');
const hash = (pw) => bcrypt.hashSync(pw, 8);

/* --------------------------------------------------------------------------
   Deterministic PRNG (mulberry32) — same SEED always produces the same
   dataset, so `npm run setup` is a repeatable, one-command reset.
   -------------------------------------------------------------------------- */
const SEED = 20260731;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const weightedPick = (weightMap) => {
  const entries = Object.entries(weightMap);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
};
const daysAgo = (n) => `-${n} days`;
const minsAgo = (n) => `-${n} minutes`;
// For columns bound directly as a plain '?' parameter (not wrapped in datetime('now', ?)
// SQL in the VALUES clause) — those need an actual computed timestamp string, not a SQL fragment.
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

console.log('==========================================================');
console.log(' LifeLink DEMO DATASET GENERATOR');
console.log(' 100% fictional data — deterministic seed: ' + SEED);
console.log(' Re-run `npm run setup` any time for a full, repeatable reset.');
console.log('==========================================================');

// ---- Blood groups + compatibility ----
const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const insertGroup = db.prepare('INSERT INTO blood_groups (type) VALUES (?)');
const groupId = {};
bloodTypes.forEach((t) => {
  const info = insertGroup.run(t);
  groupId[t] = Number(info.lastInsertRowid);
});

const compatibility = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+']
};
const insertCompat = db.prepare('INSERT INTO blood_compatibility (donor_group_id, recipient_group_id) VALUES (?, ?)');
Object.entries(compatibility).forEach(([donor, recipients]) => {
  recipients.forEach((r) => insertCompat.run(groupId[donor], groupId[r]));
});
console.log(`✓ ${bloodTypes.length} blood groups + compatibility matrix.`);

// Realistic-ish ABO/Rh population weighting (approximate, for demo variety only)
const bloodTypeWeights = { 'O+': 37, 'A+': 23, 'B+': 25, 'AB+': 7, 'O-': 3, 'A-': 2, 'B-': 2, 'AB-': 1 };

// ---- Locations: Coimbatore-area localities (fictional address labels, real-ish geography for map demo) ----
const localityDefs = [
  ['Race Course', 11.0020, 76.9730], ['RS Puram', 11.0110, 76.9450], ['Coimbatore Center', 11.0040, 76.9600],
  ['Peelamedu', 11.0290, 77.0050], ['Gandhipuram', 11.0220, 76.9690], ['Pappanaickenpalayam', 11.0160, 76.9790],
  ['Saravanampatti', 11.0700, 77.0050], ['City Center', 11.0168, 76.9558], ['Vadavalli', 11.0180, 76.9130],
  ['Ganapathy', 11.0370, 76.9660], ['Singanallur', 11.0010, 77.0270], ['Ukkadam', 10.9880, 76.9560],
  ['Sundarapuram', 10.9770, 76.9660], ['Ramanathapuram', 10.9950, 76.9800], ['Kuniyamuthur', 10.9720, 76.9520]
];
const insertLocation = db.prepare('INSERT INTO locations (label, address, city, lat, lng) VALUES (?, ?, ?, ?, ?)');
const locId = {};
const jitter = () => (rand() - 0.5) * 0.01;
localityDefs.forEach(([label, lat, lng]) => {
  const info = insertLocation.run(label, `${label} area`, 'Coimbatore', lat, lng);
  locId[label] = Number(info.lastInsertRowid);
});
const localityNames = localityDefs.map((d) => d[0]);
console.log(`✓ ${localityDefs.length} locations across Coimbatore.`);

// ---- Fictional name pools (generic common Indian first/last names — not real individuals) ----
const firstNames = [
  'Arjun', 'Priya', 'Rahul', 'Karthik', 'Sandhya', 'Manoj', 'Ishwarya', 'Divya', 'Srinivasan', 'Aisha',
  'Vignesh', 'Mary', 'Amit', 'Deepa', 'Suresh', 'Kavya', 'Naveen', 'Lakshmi', 'Ravi', 'Meena',
  'Ganesh', 'Anitha', 'Prakash', 'Swathi', 'Vijay', 'Nisha', 'Senthil', 'Pooja', 'Mohan', 'Radhika',
  'Dinesh', 'Shanthi', 'Rajesh', 'Vidya', 'Kumar', 'Geetha', 'Anand', 'Sowmya', 'Balaji', 'Ramya',
  'Sathish', 'Vani', 'Gopal', 'Preethi', 'Muthu', 'Kalpana', 'Ashok', 'Bhavani', 'Elango', 'Yamuna'
];
const lastNames = [
  'Kumar', 'Sundaram', 'Menon', 'Raja', 'Devi', 'Nair', 'Ramasamy', 'Balaji', 'DSouza', 'Sharma',
  'Iyer', 'Pillai', 'Reddy', 'Naidu', 'Chettiar', 'Gounder', 'Rajan', 'Krishnan', 'Murthy', 'Subramaniam',
  'Venkatesh', 'Rangan', 'Selvam', 'Mani', 'Balasubramanian', 'Natarajan', 'Sivakumar', 'Raman', 'Gupta', 'Begum'
];
const usedNames = new Set();
const generateName = () => {
  let name;
  do {
    name = `${pick(firstNames)} ${pick(lastNames)}`;
  } while (usedNames.has(name));
  usedNames.add(name);
  return name;
};


/* --------------------------------------------------------------------------
   DONORS — ~65 fictional donors with weighted blood types, varied donation
   history, realistic activity levels, and partial Telegram linkage (so
   emergency-notification fanout has a realistic subset of reachable donors).
   -------------------------------------------------------------------------- */
const insertUser = db.prepare(`
  INSERT INTO users (id, name, email, phone, role, password_hash, telegram_chat_id, passport_id,
                      status, is_new_registration, total_donations, xp, location_id, lat, lng)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertDonorProfile = db.prepare(`
  INSERT INTO donor_profiles (user_id, blood_group_id, availability_status, last_donation_date, next_eligible_date)
  VALUES (?, ?, ?, ?, ?)
`);
const insertHospitalProfile = db.prepare(`
  INSERT INTO hospital_profiles (user_id, license_number, accreditation_doc, location_id,
                                  quota_used, quota_limit, active_emergencies, verification_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertBankProfile = db.prepare(`
  INSERT INTO blood_bank_profiles (user_id, license_number, location_id, api_status, active_transfers, verification_status)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertInventory = db.prepare('INSERT INTO blood_inventory (blood_bank_id, blood_group_id, units) VALUES (?, ?, ?)');

const DONOR_COUNT = 65;
const donors = []; // { id, name, bloodType, loc, lat, lng, donations, xp, status, lastDonation, telegram, phone }
const donorStatuses = { 'Active': 82, 'On Duty': 8, 'Inactive': 10 };

for (let i = 0; i < DONOR_COUNT; i++) {
  const id = `d${1000 + i}`;
  const name = generateName();
  const bloodType = weightedPick(bloodTypeWeights);
  const loc = pick(localityNames);
  const [, baseLat, baseLng] = localityDefs.find((d) => d[0] === loc);
  // Donation activity: skewed so most donors have 0-4, some 5-12, a few "hero" donors 15-30
  const activityRoll = rand();
  const donationCount = activityRoll < 0.35 ? randInt(0, 2)
    : activityRoll < 0.7 ? randInt(3, 6)
    : activityRoll < 0.92 ? randInt(7, 11)
    : randInt(12, 16);
  const xp = donationCount * randInt(180, 220) + randInt(0, 150);
  const status = weightedPick(donorStatuses);
  const hasTelegram = rand() < 0.55; // ~55% linked, so notification demos show a realistic mixed audience
  const daysSinceLast = donationCount > 0 ? randInt(5, 260) : null;
  const lastDonation = daysSinceLast !== null
    ? new Date(Date.now() - daysSinceLast * 86400000).toISOString().slice(0, 10)
    : null;
  const nextEligible = lastDonation
    ? new Date(new Date(lastDonation).getTime() + 90 * 86400000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const phone = `+91 90${String(10000 + i).padStart(6, '0')}`.slice(0, 16);

  donors.push({ id, name, bloodType, loc, lat: baseLat + jitter(), lng: baseLng + jitter(), donations: donationCount, xp, status, lastDonation, telegram: hasTelegram, phone });
}

donors.forEach((d, i) => {
  insertUser.run(
    d.id, d.name, `${d.name.toLowerCase().replace(/\s+/g, '')}@example.test`, d.phone, 'Donor',
    hash(d.name.split(' ')[0].toLowerCase() + '123'), d.telegram ? `demo-chat-${1000 + i}` : null,
    `LL-DEMO-CBE-${1000 + i}`, d.status, i < 3 ? 1 : 0, d.donations, d.xp, locId[d.loc], d.lat, d.lng
  );
  insertDonorProfile.run(d.id, groupId[d.bloodType], d.status, d.lastDonation, null);
});
// A handful of brand-new signups still pending onboarding approval (demo of Admin approval queue)
console.log(`✓ ${donors.length} donors (weighted blood types, realistic activity spread, ${donors.filter((d) => d.telegram).length} Telegram-linked).`);

/* --------------------------------------------------------------------------
   HOSPITALS — fictional facility names, NOT real hospital brands.
   -------------------------------------------------------------------------- */
const hospitalDefs = [
  { name: 'Sunrise Multispecialty Hospital', loc: 'RS Puram', verif: 'Verified Partner', limit: 30 },
  { name: 'Coimbatore City General Hospital', loc: 'Coimbatore Center', verif: 'Verified Partner', limit: 40 },
  { name: 'Lakeview Multispecialty Hospital', loc: 'Pappanaickenpalayam', verif: 'Verified Partner', limit: 25 },
  { name: 'Riverside Medical Center', loc: 'Peelamedu', verif: 'Verified Partner', limit: 50 },
  { name: 'Northgate Hospital & Research Institute', loc: 'Coimbatore Center', verif: 'Pending Verification', limit: 0 },
  { name: 'Greenfield Community Hospital', loc: 'Vadavalli', verif: 'Verified Partner', limit: 20 },
  { name: 'Harborview Trauma & Emergency Center', loc: 'Singanallur', verif: 'Verified Partner', limit: 35 },
  { name: 'Meadowbrook Women & Children Hospital', loc: 'Ganapathy', verif: 'Verified Partner', limit: 18 }
];
const hospitals = [];
hospitalDefs.forEach((h, i) => {
  const id = `h${2000 + i}`;
  const [, lat, lng] = localityDefs.find((d) => d[0] === h.loc);
  const used = h.limit > 0 ? randInt(Math.floor(h.limit * 0.2), Math.floor(h.limit * 0.85)) : 0;
  hospitals.push({ id, ...h, lat, lng, used });
  insertUser.run(
    id, h.name, `contact@${id}.example.test`, `+91 90${String(20000 + i).padStart(6, '0')}`.slice(0, 16), 'Hospital',
    hash(h.name.split(' ')[0].toLowerCase() + '123'), null,
    `HP-DEMO-CBE-${900 + i}`, h.verif === 'Verified Partner' ? 'Verified' : 'Pending Verification',
    0, randInt(20, 80), randInt(3000, 8000), locId[h.loc], lat, lng
  );
  insertHospitalProfile.run(id, `LIC-HOSP-${900 + i}`, null, locId[h.loc], used, h.limit, 0, h.verif);
});
console.log(`✓ ${hospitals.length} hospitals.`);

/* --------------------------------------------------------------------------
   BLOOD BANKS — fictional names, varied stock levels (deliberately includes
   some low/critical stock so shortage alerts, AI Match, and Find Blood have
   something real to demonstrate).
   -------------------------------------------------------------------------- */
const bankDefs = [
  { name: 'City Blood Bank', loc: 'Race Course', api: 'Connected (Active)' },
  { name: 'Unity Blood Bank', loc: 'Gandhipuram', api: 'Connected (Active)' },
  { name: 'Hopewell Donor Club & Blood Bank', loc: 'Peelamedu', api: 'Setup Required' },
  { name: 'Northside Regional Blood Center', loc: 'Saravanampatti', api: 'Connected (Active)' },
  { name: 'Riverbank Community Blood Bank', loc: 'Ukkadam', api: 'Connected (Active)' }
];
const banks = [];
bankDefs.forEach((b, i) => {
  const id = `b3000${i}`;
  const [, lat, lng] = localityDefs.find((d) => d[0] === b.loc);
  // Deliberately vary stock profile per bank: one well-stocked, one moderate, one low overall, etc.
  const profile = i % 3;
  const stock = {};
  bloodTypes.forEach((t) => {
    const base = profile === 0 ? randInt(35, 95) : profile === 1 ? randInt(10, 45) : randInt(0, 18);
    // Rare types (AB-, B-, A-, O-) run lower everywhere, like real blood banks
    const rarityFactor = ['AB-', 'B-', 'A-', 'O-'].includes(t) ? 0.35 : 1;
    stock[t] = Math.round(base * rarityFactor);
  });
  banks.push({ id, ...b, lat, lng, stock });
  const totalDonations = Object.values(stock).reduce((a, c) => a + c, 0);
  insertUser.run(
    id, b.name, `contact@${id}.example.test`, `+91 90${String(30000 + i).padStart(6, '0')}`.slice(0, 16), 'Blood Bank',
    hash(b.name.split(' ')[0].toLowerCase() + '123'), null,
    `BB-DEMO-CBE-${800 + i}`, 'Verified', 0, totalDonations, randInt(8000, 15000), locId[b.loc], lat, lng
  );
  insertBankProfile.run(id, `LIC-BANK-${800 + i}`, locId[b.loc], b.api, 0, 'Verified Partner');
  bloodTypes.forEach((t) => insertInventory.run(id, groupId[t], stock[t]));
});
console.log(`✓ ${banks.length} blood banks with varied (incl. some low/critical) inventory.`);

// Admin
insertUser.run(
  'admin1', 'Platform Admin', 'admin@example.test', '+91 9000000000', 'Admin',
  hash('admin123'), null, 'AD-DEMO-CBE-9999', 'Active', 0, 0, 0, locId['City Center'], 11.0168, 76.9558
);
console.log('✓ 1 admin account.');


/* --------------------------------------------------------------------------
   EMERGENCIES — spread over the last ~10 days, mixed urgency/status, tied
   to real hospitals so hospital dashboards show genuine linked requests.
   -------------------------------------------------------------------------- */
const insertEmergency = db.prepare(`
  INSERT INTO emergencies (id, patient_name, blood_group_id, hospital_id, hospital_name, lat, lng,
                            units_needed, urgency, ward, status, alerts_sent, expires_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))
`);
const insertEmergencyHistory = db.prepare(`
  INSERT INTO emergency_status_history (emergency_id, from_status, to_status, actor_id, actor_label, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
const patientLabels = ['Patient A', 'Patient B', 'Patient C', 'Patient D', 'Patient E', 'Patient F', 'Patient G', 'Patient H', 'Patient I (Infant)', 'Patient J', 'Patient K', 'Patient L', 'Patient M', 'Patient N', 'Patient O'];
const wards = ['ICU Ward 1', 'ICU Ward 2', 'Emergency Dept.', 'Surgery OT', 'Maternity Ward', 'Pediatric ICU', 'Trauma Center', 'General Ward'];
const urgencyWeights = { 'Critical': 30, 'Urgent': 40, 'Normal': 30 };
// Minutes-to-expiry by urgency, mirroring the real workflow's countdown logic
const expiryMinutesByUrgency = { 'Critical': 30, 'Urgent': 90, 'Normal': 240 };
// Ordered, non-branching "happy path" progression used to seed realistic audit trails
const WORKFLOW_ORDER = ['Pending', 'Searching', 'Donors Notified', 'Donor Responded', 'Blood Reserved', 'Fulfilled'];
const emergencies = [];
const EMERGENCY_COUNT = 20;
for (let i = 0; i < EMERGENCY_COUNT; i++) {
  const id = `e${5000 + i}`;
  const hosp = pick(hospitals.filter((h) => h.verif === 'Verified Partner'));
  const bt = weightedPick(bloodTypeWeights);
  const urgency = weightedPick(urgencyWeights);
  // Weighted age tiers so fresh/live requests are well represented alongside resolved history
  const ageTier = weightedPick({ 'fresh': 25, 'recent': 30, 'today': 20, 'thisWeek': 20, 'older': 5 });
  const ageMinutes = ageTier === 'fresh' ? randInt(2, 45)
    : ageTier === 'recent' ? randInt(45, 240)
    : ageTier === 'today' ? randInt(240, 1440)
    : ageTier === 'thisWeek' ? randInt(1440, 10080)
    : randInt(10080, 14400);
  // Older requests are more likely resolved; very recent ones more likely still early in the workflow
  let status;
  if (ageMinutes < 60) status = weightedPick({ 'Pending': 30, 'Searching': 25, 'Donors Notified': 30, 'Donor Responded': 15 });
  else if (ageMinutes < 1440) status = weightedPick({ 'Donors Notified': 20, 'Donor Responded': 20, 'Blood Reserved': 15, 'Fulfilled': 30, 'Cancelled': 5, 'Expired': 10 });
  else status = weightedPick({ 'Fulfilled': 65, 'Cancelled': 15, 'Expired': 20 });
  const resolvedAfterMinutes = ['Fulfilled', 'Cancelled', 'Expired'].includes(status) ? randInt(8, Math.min(ageMinutes, 240)) : 0;
  const updatedAgeMinutes = Math.max(1, ageMinutes - resolvedAfterMinutes);
  const expiryMin = expiryMinutesByUrgency[urgency];
  const e = {
    id, patient: pick(patientLabels), bt, hosp, urgency, status,
    ward: pick(wards), units: randInt(1, 6), alerts: randInt(2, 28), ageMinutes, updatedAgeMinutes
  };
  emergencies.push(e);
  const createdAtMs = Date.now() - ageMinutes * 60000;
  const expiresAtMs = createdAtMs + expiryMin * 60000;
  const expiresAtStr = new Date(expiresAtMs).toISOString().slice(0, 19).replace('T', ' ');
  insertEmergency.run(
    id, e.patient, groupId[bt], hosp.id, hosp.name, hosp.lat + jitter(), hosp.lng + jitter(),
    e.units, urgency, e.ward, status, e.alerts, expiresAtStr,
    minsAgo(ageMinutes), minsAgo(updatedAgeMinutes)
  );

  // Seed a realistic audit trail: walk the happy-path states up to (and sometimes past, for
  // Cancelled/Expired) the current status, spacing timestamps between creation and now.
  const reachedIndex = WORKFLOW_ORDER.indexOf(status);
  const trailStatuses = reachedIndex >= 0 ? WORKFLOW_ORDER.slice(0, reachedIndex + 1) : ['Pending'];
  let prevStatus = null;
  trailStatuses.forEach((s, idx) => {
    const stepAge = Math.round(ageMinutes - ((ageMinutes - updatedAgeMinutes) * (idx / Math.max(1, trailStatuses.length - 1))));
    const actorLabel = s === 'Pending' ? 'hospital' : s === 'Donor Responded' ? 'donor' : s === 'Blood Reserved' || s === 'Fulfilled' ? 'hospital' : 'system';
    insertEmergencyHistory.run(id, prevStatus, s, null, actorLabel, `Seeded workflow step: ${s}`, minsAgo(Math.max(0, stepAge)));
    prevStatus = s;
  });
  if (status === 'Cancelled' || status === 'Expired') {
    insertEmergencyHistory.run(id, trailStatuses[trailStatuses.length - 1] || 'Pending', status, null, status === 'Cancelled' ? 'hospital' : 'system', `Seeded terminal state: ${status}`, minsAgo(updatedAgeMinutes));
  }
}
console.log(`✓ ${emergencies.length} emergency requests (mixed urgency/status, spread over ~10 days).`);
console.log(`✓ Seeded emergency status audit history for realistic timelines.`);

/* --------------------------------------------------------------------------
   CAMPS — mix of past (Completed), current/near-future (Scheduled/In
   Progress), and pending-approval camps.
   -------------------------------------------------------------------------- */
const makeDedupeKey = (title, campDate, city) =>
  `${(title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${campDate || ''}|${(city || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

const insertCamp = db.prepare(`
  INSERT INTO camps (id, title, organizer_id, organizer_name, location_id, location_label, venue, city, state, lat, lng,
                      camp_date, start_time, end_time, contact_phone, contact_email, registration_url,
                      capacity, registered_count, approved, status,
                      source, source_name, source_url, source_last_updated, verification_status, verified_by, verified_at,
                      dedupe_key, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
const campDefs = [
  { title: 'World Blood Donor Day Camp', loc: 'City Center', label: 'City Hall, Coimbatore', dayOffset: -45, cap: 100, organizer: 'LifeLink Coimbatore Chapter' },
  { title: 'Sunrise Hospital Donation Drive', loc: 'RS Puram', label: 'Sunrise Hospital Campus, RS Puram', dayOffset: -20, cap: 50, organizer: 'Sunrise Multispecialty Hospital' },
  { title: 'Greenfield College Youth Drive', loc: 'Peelamedu', label: 'Greenfield College, Peelamedu', dayOffset: 5, cap: 200, organizer: 'Greenfield College NSS Unit' },
  { title: 'Nexora Technologies Corporate Camp', loc: 'Saravanampatti', label: 'Nexora Technologies, Saravanampatti', dayOffset: -5, cap: 300, organizer: 'Nexora Technologies CSR Team' },
  { title: 'Riverside Arts College Camp', loc: 'Coimbatore Center', label: 'Riverside Arts College Campus', dayOffset: 18, cap: 150, organizer: 'Riverside Arts College' },
  { title: 'Vadavalli Community Health Fair', loc: 'Vadavalli', label: 'Vadavalli Community Hall', dayOffset: 12, cap: 80, organizer: 'Vadavalli Residents Welfare Association' },
  { title: 'Meadowbrook Hospital Mothers\' Day Drive', loc: 'Ganapathy', label: 'Meadowbrook Hospital Grounds', dayOffset: -60, cap: 60, organizer: 'Meadowbrook Women & Children Hospital' },
  { title: 'Harborview First Responders Drive', loc: 'Singanallur', label: 'Harborview Trauma Center', dayOffset: 2, cap: 90, organizer: 'Harborview Trauma & Emergency Center' },
  { title: 'Singanallur Rotary Club Camp', loc: 'Singanallur', label: 'Rotary Club Hall, Singanallur', dayOffset: 30, cap: 70, organizer: 'Rotary Club of Singanallur' },
  { title: 'Ukkadam Youth Federation Drive', loc: 'Ukkadam', label: 'Ukkadam Community Grounds', dayOffset: 40, cap: 65, organizer: 'Ukkadam Youth Federation' }
];
const camps = [];
campDefs.forEach((c, i) => {
  const id = `camp${100 + i}`;
  const isPast = c.dayOffset < 0;
  const isPendingApproval = i === campDefs.length - 1; // last one still under review
  const registered = isPendingApproval ? 0 : randInt(Math.floor(c.cap * 0.1), Math.floor(c.cap * 0.9));
  const status = isPendingApproval ? 'Under Review' : isPast ? 'Completed' : Math.abs(c.dayOffset) <= 3 ? 'In Progress' : 'Scheduled';
  const campDate = new Date(Date.now() + c.dayOffset * 86400000).toISOString().slice(0, 10);
  const [, locLat, locLng] = localityDefs.find((d) => d[0] === c.loc);
  camps.push({ id, ...c, registered, status, campDate, isPast, city: 'Coimbatore' });
  // These are directly admin-entered camps: source is 'manual' and, since a human
  // (the admin account) created them first-hand, they're marked Verified from the start —
  // unlike ingested records below, which always start Unverified regardless of source.
  insertCamp.run(
    id, c.title, 'admin1', c.organizer, locId[c.loc], c.label, c.label, 'Coimbatore', 'Tamil Nadu', locLat, locLng,
    campDate, '09:00 AM', '04:00 PM', null, null, null,
    c.cap, registered, isPendingApproval ? 0 : 1, status,
    'manual', 'LifeLink Direct Entry', null, null, isPendingApproval ? 'Unverified' : 'Verified', isPendingApproval ? null : 'admin1', isPendingApproval ? null : nowStr(),
    makeDedupeKey(c.title, campDate, 'Coimbatore'), daysAgo(randInt(3, 90))
  );
});
console.log(`✓ ${camps.length} donation camps (past/current/upcoming/pending-approval mix, source=manual).`);

// ---- A couple of sample INGESTED camps, demonstrating the ingestion pipeline's output shape.
// These start life as 'Unverified' regardless of source, exactly like a real ingestion run would
// produce — an admin must explicitly review and verify them (see /api/camps/:id/verify).
const ingestedCampDefs = [
  {
    id: 'camp-ing-001', title: 'Regional Health Dept. Mega Camp', organizer: 'Tamil Nadu State Health Department (sample)',
    loc: 'Gandhipuram', venue: 'District Collectorate Grounds, Gandhipuram', dayOffset: 25, cap: 250,
    source: 'official_api', sourceName: 'Sample Regional Health API (demo fixture)', sourceUrl: 'https://example-health-dept.gov.in/api/camps/sample-001',
    contactPhone: '+91 80000 12345', contactEmail: 'camps@example-health-dept.gov.in', regUrl: 'https://example-health-dept.gov.in/register/sample-001'
  },
  {
    id: 'camp-ing-002', title: 'City Rotary Blood Drive (Web Listing)', organizer: 'Rotary Club Coimbatore Central (sample)',
    loc: 'Peelamedu', venue: 'Rotary Bhavan, Peelamedu', dayOffset: 33, cap: 120,
    source: 'web_import', sourceName: 'Sample Community Events Listing (demo fixture)', sourceUrl: 'https://example-events.org/listings/sample-camp-002',
    contactPhone: null, contactEmail: null, regUrl: 'https://example-events.org/listings/sample-camp-002'
  }
];
ingestedCampDefs.forEach((c) => {
  const [, locLat, locLng] = localityDefs.find((d) => d[0] === c.loc);
  const campDate = new Date(Date.now() + c.dayOffset * 86400000).toISOString().slice(0, 10);
  insertCamp.run(
    c.id, c.title, null, c.organizer, locId[c.loc], c.venue, c.venue, 'Coimbatore', 'Tamil Nadu', locLat, locLng,
    campDate, '10:00 AM', '05:00 PM', c.contactPhone, c.contactEmail, c.regUrl,
    c.cap, 0, 1, 'Scheduled',
    c.source, c.sourceName, c.sourceUrl, daysAgo(randInt(1, 5)), 'Unverified', null, null,
    makeDedupeKey(c.title, campDate, 'Coimbatore'), daysAgo(randInt(1, 5))
  );
});
console.log(`✓ ${ingestedCampDefs.length} sample ingested camps (official_api / web_import, both Unverified).`);

/* --------------------------------------------------------------------------
   CAMP REGISTRATIONS — connect real donors to real camps.
   -------------------------------------------------------------------------- */
const insertCampReg = db.prepare(`
  INSERT INTO camp_registrations (camp_id, donor_id, verification_id, slot, status, created_at)
  VALUES (?, ?, ?, ?, ?, datetime('now', ?))
`);
const slotOptions = ['9:00 AM - 9:30 AM', '10:00 AM - 10:30 AM', '11:00 AM - 11:30 AM', '2:00 PM - 2:30 PM', '3:00 PM - 3:30 PM', '4:00 PM - 4:30 PM'];
let campRegCount = 0;
camps.filter((c) => c.status !== 'Under Review').forEach((c) => {
  const regCount = Math.min(c.registered, 8); // seed a representative sample, not every single registrant
  const regDonors = shuffle(donors).slice(0, regCount);
  regDonors.forEach((d, idx) => {
    const status = c.isPast ? weightedPick({ 'Attended': 75, 'No-show': 15, 'Cancelled': 10 }) : 'Registered';
    try {
      insertCampReg.run(c.id, d.id, `CR-DEMO-${String(campRegCount + 1).padStart(4, '0')}`, pick(slotOptions), status, daysAgo(randInt(1, 60)));
      campRegCount++;
    } catch (e) { /* unique constraint on rare duplicate donor/camp pick — skip */ }
  });
});
console.log(`✓ ${campRegCount} camp registrations linking real donors to real camps.`);


/* --------------------------------------------------------------------------
   DONATIONS — generates EXACTLY as many completed rows per donor as their
   `total_donations` counter says, with historical dates counting back from
   their real `last_donation_date`, so profile stats and donation history
   are always consistent with each other (no more "12 donations" donors
   with only 2 history rows). Plus a handful of upcoming/in-progress rows
   for dashboard variety that don't inflate the completed counter.
   -------------------------------------------------------------------------- */
const insertDonation = db.prepare(`
  INSERT INTO donations (id, donor_id, blood_group_id, hospital_id, blood_bank_id, emergency_id, camp_id,
                          units, status, donation_date, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
const completionNotes = [
  'Regular voluntary donation. 450ml drawn. Vitals normal.',
  'Apheresis platelet donation. Vitals normal.',
  'Voluntary campaign contribution. 350ml drawn.',
  'Whole-blood draw completed without complications.',
  'Routine donation, donor reported feeling well post-draw.'
];
let donationRowCount = 0;
donors.forEach((d) => {
  if (d.donations === 0) return;
  // Work backward from the donor's real last_donation_date
  let cursorDate = new Date(d.lastDonation);
  for (let k = 0; k < d.donations; k++) {
    const id = `dn${10000 + donationRowCount}`;
    const dateStr = cursorDate.toISOString().slice(0, 10);
    const daysFromNow = Math.round((Date.now() - cursorDate.getTime()) / 86400000);
    const channelRoll = rand();
    let hospId = null, bankId = null, campId = null;
    if (channelRoll < 0.45) hospId = pick(hospitals.filter((h) => h.verif === 'Verified Partner')).id;
    else if (channelRoll < 0.75) bankId = pick(banks).id;
    else campId = pick(camps.filter((c) => c.isPast)).id;

    insertDonation.run(
      id, d.id, groupId[d.bloodType], hospId, bankId, null, campId,
      1, 'Completed', dateStr, pick(completionNotes), daysAgo(Math.max(daysFromNow, 0))
    );
    donationRowCount++;
    cursorDate = new Date(cursorDate.getTime() - randInt(90, 150) * 86400000);
  }
});

// A handful of upcoming/in-progress donations for live-state demo variety (not counted in totals)
const upcomingDonors = shuffle(donors).slice(0, 8);
upcomingDonors.forEach((d, idx) => {
  const id = `dn${10000 + donationRowCount}`;
  const status = idx < 3 ? 'In Progress' : 'Scheduled';
  const hospId = pick(hospitals.filter((h) => h.verif === 'Verified Partner')).id;
  insertDonation.run(
    id, d.id, groupId[d.bloodType], hospId, null, null, null,
    1, status, status === 'Scheduled' ? new Date(Date.now() + randInt(1, 14) * 86400000).toISOString().slice(0, 10) : null,
    status === 'In Progress' ? 'Pre-donation checks cleared, draw underway.' : 'Appointment booked, awaiting donor arrival.',
    minsAgo(randInt(5, 600))
  );
  donationRowCount++;
});
console.log(`✓ ${donationRowCount} donation records (exactly matching each donor's real donation count, plus live-state samples).`);

/* --------------------------------------------------------------------------
   APPOINTMENTS — mix of camp-linked and direct hospital/bank visits.
   -------------------------------------------------------------------------- */
const insertAppt = db.prepare(`
  INSERT INTO appointments (id, donor_id, camp_id, hospital_id, blood_bank_id, scheduled_date, slot, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
let apptCount = 0;
const apptDonors = shuffle(donors).slice(0, 18);
apptDonors.forEach((d) => {
  const id = `ap${20000 + apptCount}`;
  const viaCamp = rand() < 0.5 && camps.some((c) => !c.isPast && c.status !== 'Under Review');
  const futureDays = randInt(1, 25);
  const scheduledDate = new Date(Date.now() + futureDays * 86400000).toISOString().slice(0, 10);
  if (viaCamp) {
    const camp = pick(camps.filter((c) => !c.isPast && c.status !== 'Under Review'));
    insertAppt.run(id, d.id, camp.id, null, null, camp.campDate, pick(slotOptions), 'Scheduled', daysAgo(randInt(1, 10)));
  } else {
    const hosp = pick(hospitals.filter((h) => h.verif === 'Verified Partner'));
    insertAppt.run(id, d.id, null, hosp.id, null, scheduledDate, pick(slotOptions), weightedPick({ 'Scheduled': 80, 'Confirmed': 20 }), daysAgo(randInt(1, 10)));
  }
  apptCount++;
});
console.log(`✓ ${apptCount} appointments (camp visits + direct hospital bookings).`);

/* --------------------------------------------------------------------------
   TRANSFERS — historical inter-facility blood movements.
   -------------------------------------------------------------------------- */
const insertTransfer = db.prepare(`
  INSERT INTO transfers (id, requesting_id, supplying_id, blood_group_id, units, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))
`);
let transferCount = 0;
const allFacilities = [...hospitals.filter((h) => h.verif === 'Verified Partner'), ...banks];
for (let i = 0; i < 16; i++) {
  const supplier = pick(banks);
  let requester = pick(allFacilities);
  while (requester.id === supplier.id) requester = pick(allFacilities);
  const status = weightedPick({ 'Approved': 65, 'Pending': 25, 'Declined': 10 });
  const ageHours = randInt(1, 240);
  const resolvedAfterHours = status !== 'Pending' ? randInt(1, Math.min(ageHours, 48)) : 0;
  const id = `t${40000 + i}`;
  insertTransfer.run(
    id, requester.id, supplier.id, groupId[weightedPick(bloodTypeWeights)], randInt(1, 8), status,
    `-${ageHours} hours`, `-${Math.max(1, ageHours - resolvedAfterHours)} hours`
  );
  transferCount++;
}
console.log(`✓ ${transferCount} blood transfers between banks/hospitals (mixed statuses).`);


/* --------------------------------------------------------------------------
   NOTIFICATIONS — mirrors real fanout logic: emergency alerts go to
   Telegram-linked donors with a matching blood group; camp updates go to
   real registrants; a few system/transfer notices round it out.
   -------------------------------------------------------------------------- */
const insertNotif = db.prepare(`
  INSERT INTO notifications (user_id, type, category, title, message, urgency, channel, related_type, related_id, read_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
let notifCount = 0;

// Emergency alerts -> matching, Telegram-linked donors (sample a few emergencies to avoid an explosion of rows)
const recentEmergencies = emergencies.filter((e) => e.ageMinutes < 2880).slice(0, 8);
recentEmergencies.forEach((e) => {
  const matchingDonors = donors.filter((d) => d.bloodType === e.bt && d.telegram);
  matchingDonors.slice(0, 6).forEach((d) => {
    const isRead = rand() < 0.4;
    insertNotif.run(
      d.id, 'donor_match', 'emergency', `${e.urgency} ${e.bt} request nearby`,
      `${e.hosp.name} needs ${e.units} unit(s) of ${e.bt} for an emergency (${e.urgency}). Ward: ${e.ward}. Can you help?`,
      e.urgency === 'Critical' ? 'Critical' : e.urgency === 'Urgent' ? 'Urgent' : 'Normal',
      'in_app', 'emergency', e.id, isRead ? nowStr() : null, minsAgo(e.ageMinutes - randInt(0, 2))
    );
    notifCount++;
  });
});

// Camp registration confirmations -> real registrants (re-query what we just inserted)
const campRegRows = db.prepare('SELECT donor_id, camp_id, verification_id FROM camp_registrations LIMIT 25').all();
campRegRows.forEach((r) => {
  const camp = camps.find((c) => c.id === r.camp_id);
  if (!camp) return;
  const isRead = rand() < 0.6;
  insertNotif.run(
    r.donor_id, 'camp_update', 'reminders', 'Camp registration confirmed',
    `Your slot at "${camp.title}" on ${camp.campDate} is confirmed. Verification ID: ${r.verification_id}.`,
    'Normal', 'in_app', 'camp', camp.id, isRead ? nowStr() : null, daysAgo(randInt(1, 30))
  );
  notifCount++;
});

// Transfer status notices -> facility accounts, for approved/declined transfers
const transferRows = db.prepare('SELECT id, requesting_id, blood_group_id, status FROM transfers WHERE status != ?').all('Pending');
transferRows.slice(0, 10).forEach((t) => {
  const btype = bloodTypes.find((bt) => groupId[bt] === t.blood_group_id);
  insertNotif.run(
    t.requesting_id, 'transfer_update', 'inventory',
    t.status === 'Approved' ? 'Transfer approved' : 'Transfer declined',
    t.status === 'Approved'
      ? `Your ${btype} transfer request has been approved and stock has been updated.`
      : `Your ${btype} transfer request was declined due to insufficient supplier stock.`,
    'Normal', 'in_app', 'transfer', t.id, rand() < 0.5 ? nowStr() : null, daysAgo(randInt(1, 12))
  );
  notifCount++;
});
console.log(`✓ ${notifCount} notifications (emergency alerts, camp confirmations, transfer updates).`);

/* --------------------------------------------------------------------------
   ANALYTICS EVENTS — sample platform activity log for Admin analytics tab.
   -------------------------------------------------------------------------- */
const insertEvent = db.prepare(`
  INSERT INTO analytics_events (event_type, user_id, entity_type, entity_id, metadata, created_at)
  VALUES (?, ?, ?, ?, ?, datetime('now', ?))
`);
let eventCount = 0;
emergencies.slice(0, 10).forEach((e) => {
  insertEvent.run('emergency_created', e.hosp.id, 'emergency', e.id, JSON.stringify({ bloodType: e.bt, urgency: e.urgency }), minsAgo(e.ageMinutes));
  eventCount++;
});
shuffle(donors).slice(0, 15).forEach((d) => {
  insertEvent.run('donation_completed', d.id, 'donor', d.id, JSON.stringify({ bloodType: d.bloodType }), daysAgo(randInt(1, 60)));
  eventCount++;
});
shuffle(donors).slice(0, 10).forEach((d) => {
  insertEvent.run('search_performed', d.id, 'search', null, JSON.stringify({ bloodType: d.bloodType, radiusKm: pick([5, 10, 15, 20]) }), daysAgo(randInt(1, 20)));
  eventCount++;
});
for (let i = 0; i < 4; i++) {
  insertEvent.run('ai_match_run', 'admin1', 'blood_type', pick(bloodTypes), JSON.stringify({ urgency: pick(['Critical', 'Urgent', 'Normal']) }), daysAgo(randInt(1, 15)));
  eventCount++;
}
for (let i = 0; i < 3; i++) {
  insertEvent.run('admin_broadcast', null, 'broadcast', null, JSON.stringify({ type: pick(['Stock Warning', 'SOS Broadcast', 'Camp Appeal']), audience: 'All Registered Donors (Coimbatore)', message: 'Sample historical broadcast for demo purposes.' }), daysAgo(randInt(2, 25)));
  eventCount++;
}
console.log(`✓ ${eventCount} analytics events.`);

/* --------------------------------------------------------------------------
   AI PREDICTIONS — sample heuristic donor-match runs (clearly rule-based,
   not a trained model) tied to real emergencies and donors.
   -------------------------------------------------------------------------- */
const insertMatch = db.prepare(`
  INSERT INTO donor_matches (emergency_id, donor_id, compatibility_score, distance_km, reliability_score, response_score, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
const insertPrediction = db.prepare(`
  INSERT INTO ai_predictions (prediction_type, subject_type, subject_id, score, features, model_version, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
`);
let matchCount = 0;
const NON_TERMINAL = ['Pending', 'Searching', 'Donors Notified', 'Donor Responded', 'Blood Reserved'];
emergencies.filter((e) => NON_TERMINAL.includes(e.status) || e.status === 'Fulfilled').slice(0, 10).forEach((e) => {
  const candidates = donors.filter((d) => d.bloodType === e.bt || compatibility[d.bloodType]?.includes(e.bt));
  const picked = shuffle(candidates).slice(0, 4);
  picked.forEach((d, idx) => {
    const compatScore = d.bloodType === e.bt ? 100 : 80;
    const distanceKm = Math.round(rand() * 12 * 10) / 10;
    const reliability = Math.min(99, 60 + d.donations * 2 + randInt(0, 10));
    const response = randInt(55, 98);
    // Match status reflects how far the parent emergency has progressed
    let matchStatus = 'Suggested';
    if (e.status === 'Donors Notified') matchStatus = 'Notified';
    else if (e.status === 'Donor Responded') matchStatus = idx === 0 ? 'Accepted' : weightedPick({ Notified: 40, Declined: 60 });
    else if (e.status === 'Blood Reserved') matchStatus = idx === 0 ? 'Reserved' : weightedPick({ Notified: 30, Declined: 70 });
    else if (e.status === 'Fulfilled') matchStatus = idx === 0 ? 'Donated' : weightedPick({ Notified: 20, Declined: 80 });
    insertMatch.run(e.id, d.id, compatScore, distanceKm, reliability, response, matchStatus, minsAgo(Math.max(1, e.updatedAgeMinutes)));
    matchCount++;
  });
  insertPrediction.run(
    'donor_match', 'emergency', e.id, 0.9,
    JSON.stringify({ note: 'Rule-based heuristic score, not a trained model.', candidateCount: candidates.length }),
    'rule-based-v1', minsAgo(Math.max(1, e.updatedAgeMinutes))
  );
});
console.log(`✓ ${matchCount} donor-match suggestions + AI prediction audit records.`);

/* --------------------------------------------------------------------------
   SYNTHETIC DEMAND HISTORY — for blood-demand forecasting DEVELOPMENT ONLY.

   The real emergencies/donations tables above do not contain enough history
   for meaningful forecasting (checked: ~20 emergencies across 5 distinct
   days, all in one city). This generates ~2 years of clearly-fictional daily
   request-volume data across a few cities, with realistic day-of-week and
   seasonal patterns, purely so the forecasting pipeline has something to
   learn from during development. Every row is flagged is_synthetic=1 and
   every API response built from this table says so explicitly — this is
   NOT real historical fact and must never be presented as one.
   -------------------------------------------------------------------------- */
const insertSynthetic = db.prepare(`
  INSERT INTO synthetic_demand_history (record_date, day_of_week, month, blood_group_id, city, request_count, units_requested, is_synthetic, generator_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'synthetic-gen-v1')
`);
// Coimbatore is the real service city; the others exist ONLY in this synthetic
// table to give the forecasting demo a meaningful "high-risk locations" signal
// to rank — LifeLink has no real users/hospitals/banks in these other cities.
const forecastCities = [
  { city: 'Coimbatore', populationFactor: 1.0 },
  { city: 'Chennai (synthetic demo city)', populationFactor: 1.8 },
  { city: 'Madurai (synthetic demo city)', populationFactor: 0.9 },
  { city: 'Salem (synthetic demo city)', populationFactor: 0.6 }
];
const SYNTHETIC_DAYS = 730; // ~2 years
const today0 = new Date();
today0.setHours(0, 0, 0, 0);

db.exec('BEGIN');
let syntheticRowCount = 0;
for (let dayOffset = SYNTHETIC_DAYS; dayOffset >= 1; dayOffset--) {
  const d = new Date(today0.getTime() - dayOffset * 86400000);
  const dateStr = d.toISOString().slice(0, 10);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const month = d.getMonth() + 1;
  const yearsAgo = dayOffset / 365;

  // Weekends skew slightly higher (more road-accident/trauma-related requests)
  const dowFactor = (dow === 0 || dow === 6) ? 1.25 : 1.0;
  // Mild seasonal bump around Nov-Jan (festival/travel season), dip in Jun
  const seasonalFactor = [1.15, 1.05, 1.0, 0.95, 0.9, 0.85, 0.95, 1.0, 1.05, 1.1, 1.2, 1.2][month - 1];
  // Slight long-run growth as the platform's synthetic "history" progresses toward present day
  const growthFactor = 1 + (1 - yearsAgo / 2) * 0.15;
  // Rare spike days (simulating a mass-casualty event or local outbreak), ~1.5% of days
  const spikeFactor = rand() < 0.015 ? 2.5 + rand() * 2 : 1.0;

  forecastCities.forEach(({ city, populationFactor }) => {
    bloodTypes.forEach((type) => {
      const bloodRate = bloodTypeWeights[type] / 100; // relative prevalence, reused from donor generation above
      const baseDailyRequests = 0.35 * populationFactor * bloodRate * 8; // tuned so totals look plausible for a city-scale service
      const expected = baseDailyRequests * dowFactor * seasonalFactor * growthFactor * spikeFactor;
      // Small integer counts -> approximate a Poisson-like draw with bounded random rounding rather than
      // a literal Poisson sampler, since we don't want an extra dependency for a "keep it simple" model.
      const noise = 0.6 + rand() * 0.8;
      const requestCount = Math.max(0, Math.round(expected * noise));
      const unitsRequested = requestCount === 0 ? 0 : requestCount * randInt(1, 3);

      // Always insert one row per (date, city, blood group) — including zero-request
      // days — so the historical series has true daily granularity. Skipping zero
      // days would silently bias the moving average upward and starve rarer blood
      // types (which are legitimately 0 most days) of any real data points.
      insertSynthetic.run(dateStr, dow, month, groupId[type], city, requestCount, unitsRequested);
      syntheticRowCount++;
    });
  });
}
db.exec('COMMIT');
console.log(`✓ ${syntheticRowCount} synthetic daily demand records generated across ${forecastCities.length} cities × ${SYNTHETIC_DAYS} days (development/forecasting use only — clearly flagged is_synthetic=1).`);

console.log('==========================================================');
console.log(' ✓ Demo dataset generation complete.');
console.log(` Database file: ${DB_PATH}`);
console.log(' Demo login example — username: "' + donors[0].name + '", password: "' + donors[0].name.split(' ')[0].toLowerCase() + '123"');
console.log(' All seed accounts use pattern <firstname>123 — see this file for the full list logic.');
console.log(' Run `npm run setup` again any time for a full, repeatable reset.');
console.log('==========================================================');

db.close();
