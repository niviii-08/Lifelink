/* ==========================================================================
   Rate limiting
   --------------------------------------------------------------------------
   A minimal delay-based limiter: awaiting throttle() before each outbound
   request guarantees at least `minDelayMs` between requests to the same
   source. Deliberately simple — this isn't trying to be a general-purpose
   scheduler, just a guardrail against accidentally hammering a public site.
   ========================================================================== */

const createRateLimiter = ({ minDelayMs = 2000 } = {}) => {
  let lastRequestAt = 0;
  return async function throttle() {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + minDelayMs - now);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  };
};

module.exports = { createRateLimiter };
