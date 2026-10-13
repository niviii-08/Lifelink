/* ==========================================
   LIGHTWEIGHT RATE LIMITING
   ------------------------------------------
   Fixed-window in-memory limiter, keyed by (bucket name + IP). No external
   dependency — this is a single Express instance with no shared state
   backend today, so an in-memory window is sufficient and avoids adding
   infra requirements. If the app ever runs multiple instances behind a
   load balancer, swap this for a shared store (e.g. Redis) — the exported
   shape makes that a one-file change.
   ========================================== */

const buckets = new Map(); // key -> { count, resetAt }

const clientIp = (req) => req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

/**
 * @param {string} name  Logical bucket name (e.g. 'login', 'otp', 'emergency-create')
 * @param {number} max   Max requests allowed per window
 * @param {number} windowMs  Window size in ms
 */
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > max) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }
  next();
};

// Periodic cleanup so the map doesn't grow unbounded over a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.resetAt) buckets.delete(key);
  }
}, 5 * 60000).unref?.();

module.exports = { rateLimit };
