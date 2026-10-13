/* ==========================================
   SESSION TOKEN SIGNING / VERIFICATION
   ------------------------------------------
   Replaces the previous "trust whatever X-Actor-Id header the client sends"
   scheme, which let anyone impersonate any user (including Admins) just by
   guessing/enumerating a user id — there was no proof the caller had ever
   authenticated as that user.

   Tokens are short opaque strings the SERVER creates (at login / OTP
   verification) and the client can only carry, not construct. Every
   protected request must present it via `Authorization: Bearer <token>`.

   Design: HMAC-SHA256 signed payload, base64url encoded. No external JWT
   dependency needed — this is intentionally small and easy to audit.
   Payload: { sub: userId, iat, exp }. The token never carries the user's
   role — role is always re-read from the database on every request so a
   role change (e.g. suspension) takes effect immediately instead of only
   after the token expires.
   ========================================== */

const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET environment variable is required in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Dev/test fallback so the app still runs locally without extra setup —
  // but every restart invalidates existing sessions, and this must never
  // be relied on outside local development.
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[auth] WARNING: SESSION_SECRET is not set. Using an ephemeral random secret for this ' +
    'process only — all sessions will be invalidated on restart. Set SESSION_SECRET in your ' +
    'environment before deploying to production.'
  );
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (payload) => {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  return `${body}.${mac}`;
};

/** Create a signed session token for a user id. */
const createSessionToken = (userId) => {
  const now = Date.now();
  return sign({ sub: userId, iat: now, exp: now + SESSION_TTL_MS });
};

/**
 * Verify a session token. Returns the userId (string) if valid, or null if
 * missing, malformed, tampered with, or expired. Uses a constant-time
 * comparison for the signature to avoid timing side-channels.
 */
const verifySessionToken = (token) => {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expectedMac = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;
  return payload.sub;
};

module.exports = { createSessionToken, verifySessionToken, SESSION_TTL_MS };
