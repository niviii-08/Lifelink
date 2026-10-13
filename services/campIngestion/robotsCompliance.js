/* ==========================================================================
   robots.txt compliance
   --------------------------------------------------------------------------
   Before any web-import adapter fetches a page, it must pass this gate.
   The parsing/matching logic here is pure and real (no fixtures involved —
   it correctly implements the robots.txt exclusion protocol subset that
   matters for this use case: User-agent groups, Disallow, Allow, with
   longest-match-wins precedence). Only `fetchRobotsTxt` performs network
   I/O; everything else is a pure function you can unit test directly.

   IMPORTANT: this checks robots.txt, which is a necessary but not
   sufficient compliance step. Before enabling any real (non-fixture) web
   source, a human must also confirm the target's Terms of Service permit
   automated collection and that no personal/medical data is being
   collected — robots.txt alone does not grant legal permission.
   ========================================================================== */

const https = require('https');
const http = require('http');

// Identifies this bot honestly and gives site owners a way to reach us —
// required by responsible-crawling norms, not just a nicety.
const USER_AGENT = 'LifeLinkCampBot/1.0 (+https://lifelink.example/about/bot; contact=devs@lifelink.example)';
const FETCH_TIMEOUT_MS = 8000;

const fetchRobotsTxt = (originUrl) =>
  new Promise((resolve) => {
    let robotsUrl;
    try {
      robotsUrl = new URL('/robots.txt', originUrl).toString();
    } catch {
      resolve(null);
      return;
    }
    const client = robotsUrl.startsWith('https') ? https : http;
    const req = client.get(robotsUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

/**
 * Parses robots.txt text into groups of { agents: string[], disallow: string[], allow: string[] }.
 * Pure function — no I/O.
 */
const parseRobotsTxt = (text) => {
  const groups = [];
  let current = null;
  let sawRuleSinceLastAgent = true; // forces a new group to start on the first User-agent line

  (text || '').split(/\r?\n/).forEach((lineRaw) => {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) return;
    const sepIdx = line.indexOf(':');
    if (sepIdx === -1) return;
    const key = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();

    if (key === 'user-agent') {
      if (!current || sawRuleSinceLastAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
        sawRuleSinceLastAgent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'disallow' && current) {
      current.disallow.push(value);
      sawRuleSinceLastAgent = true;
    } else if (key === 'allow' && current) {
      current.allow.push(value);
      sawRuleSinceLastAgent = true;
    }
  });
  return groups;
};

/**
 * Longest-match-wins path check against parsed robots.txt groups.
 * Pure function — no I/O.
 */
const isPathAllowed = (groups, userAgent, path) => {
  const ua = userAgent.toLowerCase();
  const applicable = groups.filter((g) => g.agents.includes('*') || g.agents.some((a) => a && ua.includes(a)));
  const specific = applicable.filter((g) => !g.agents.includes('*'));
  const relevant = specific.length ? specific : applicable;
  if (relevant.length === 0) return true; // no applicable robots.txt guidance => default allow

  let matched = null; // { type: 'allow' | 'disallow', length }
  relevant.forEach((g) => {
    g.disallow.forEach((rule) => {
      if (rule === '') return; // an empty Disallow value means "allow everything"
      if (path.startsWith(rule) && (!matched || rule.length > matched.length)) {
        matched = { type: 'disallow', length: rule.length };
      }
    });
    g.allow.forEach((rule) => {
      if (path.startsWith(rule) && (!matched || rule.length > matched.length)) {
        matched = { type: 'allow', length: rule.length };
      }
    });
  });
  return !matched || matched.type === 'allow';
};

/**
 * Full permission check for a specific URL: fetch + parse + evaluate.
 * Fails CLOSED — if robots.txt can't be retrieved at all, permission is denied
 * rather than assumed, since silence is not consent.
 */
const checkPermission = async (targetUrl) => {
  const url = new URL(targetUrl);
  const robotsText = await fetchRobotsTxt(url.origin);
  if (robotsText === null) {
    return { allowed: false, reason: 'robots.txt could not be fetched — defaulting to disallow', userAgent: USER_AGENT };
  }
  const groups = parseRobotsTxt(robotsText);
  const allowed = isPathAllowed(groups, USER_AGENT, url.pathname);
  return { allowed, reason: allowed ? 'Permitted by robots.txt' : 'Disallowed by robots.txt', userAgent: USER_AGENT };
};

module.exports = { USER_AGENT, fetchRobotsTxt, parseRobotsTxt, isPathAllowed, checkPermission };
