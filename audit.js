/* ==========================================
   AUDIT LOGGING
   ------------------------------------------
   Durable, append-only record of sensitive actions (auth events, role/
   verification decisions, data access to another user's records, donation
   approvals, etc.) — separate from the user-facing `notifications` table
   and from `emergency_status_history` (which already covers the emergency
   state machine in detail).
   ========================================== */

const ensureAuditTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);`);
};

/**
 * Record an audit event. Never throws — audit logging must not be able to
 * break the request it's observing.
 */
const makeAuditLogger = (db) => (event) => {
  try {
    db.prepare(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.actorId ?? null,
      event.actorRole ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.detail !== undefined ? JSON.stringify(event.detail) : null,
      event.ip ?? null
    );
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
  }
};

module.exports = { ensureAuditTable, makeAuditLogger };
