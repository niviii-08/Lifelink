# LifeLink Security & Production-Readiness Audit

Audit performed on the full stack (Express/SQLite backend, React client). All fixes are
applied directly in this codebase. 93/93 existing backend unit tests pass unmodified; the
client TypeScript build is clean; every fix below was additionally verified against a
live running instance (see "Verification" at the end).

## 1. Issues found

### Critical

| # | Issue | Where |
|---|-------|-------|
| 1 | **Authentication bypass** — the server trusted a raw, client-editable `X-Actor-Id` / `X-Actor-Role` header with no proof of authentication. Anyone could impersonate any user, including Admin, by setting the header or editing `localStorage`. | `server.js` (global) |
| 2 | **Full PII leak** — `GET /api/users` returned every user's exact `lat/lng`, phone number, and Telegram chat ID to any unauthenticated caller. The client even fetched this list on page load, before login. | `server.js` |
| 3 | **Hardcoded default credential** — `POST /api/hospitals` was fully unauthenticated and created a "Verified" Hospital account using a hardcoded password (`changeme123`) baked into the source. | `server.js` |
| 4 | **Auth check silently skipped when unauthenticated** — `PUT /api/users/:id`'s ownership check only ran when an actor object existed; a `null` (unauthenticated) actor bypassed it entirely, letting anyone edit any user's record with no login. | `server.js` |
| 5 | **IDOR across most write/read endpoints** — notifications, appointments, donation history, camp registrations, hospital/blood-bank profile edits, and the whole emergency reserve/fulfill/cancel/respond workflow all trusted a client-supplied ID with no ownership check. | `server.js` (many routes) |
| 6 | **Self-service privilege escalation** — a Donor could set their own `donations`/`xp` fields via the generic profile-update endpoint. | `server.js` |
| 7 | **No rate limiting** — login, OTP request/verify, and registration were all unlimited, i.e. brute-forceable. | `server.js` |

### Moderate

| # | Issue | Where |
|---|-------|-------|
| 8 | ~66 routes returned raw `err.message` to the client on unexpected errors, risking leakage of internal/driver error text. | `server.js` |
| 9 | No security response headers, no `.env`/`.gitignore` hygiene. | project root |
| 10 | bcrypt cost factor was 8 (low for password hashing). | `server.js`, `setup_db.js` |
| 11 | User-supplied strings (names) were interpolated unescaped into Telegram messages sent with `parse_mode: HTML`, allowing HTML/link injection into an otherwise-trusted bot message. | `server.js` |
| 12 | `findUserByLogin` matched usernames by substring, risking login resolving to the wrong account. | `server.js` |
| 13 | `GET /api/recent_donations`, `GET /api/donor_matches` leaked real donor names / donor-emergency links to anyone unauthenticated. | `server.js` |

### Reviewed, no issue found

- **SQL injection**: every query in the codebase uses parameterized `db.prepare(...).run/get/all(...)` — none of the ~150+ queries build SQL via string interpolation of request data. Confirmed by grepping for `${...req.(body|query|params)}` patterns inside SQL strings — zero matches.
- **XSS**: no unsafe `dangerouslySetInnerHTML` usage except a locally-generated QR-code SVG (not user input).
- **Secrets in frontend / hardcoded API keys**: none found. The Telegram bot token already correctly used `process.env.TELEGRAM_BOT_TOKEN`.
- **Donor location privacy**: `GET /api/search/donors` and `POST /api/matching/rank-donors` already had a well-built privacy design — masked display names and only *approximate* (deterministically jittered) coordinates were ever sent to the client, never the real stored `lat/lng`. This intent existed already; it was just undermined by the wide-open `/api/users` endpoint (fixed, see #2).
- **False medical/clinical claims**: none found. The AI Match and Forecast pages already carried accurate disclaimers ("not medical advice", "not validated clinical forecasts").

## 2–3. Fixes applied

### New files
- **`auth.js`** — HMAC-SHA256 signed session tokens (`createSessionToken` / `verifySessionToken`). Tokens are only ever minted by the server at successful login/OTP verification, carry no role claim (role is always re-read from the DB on each request), and expire after 12 hours. Requires `SESSION_SECRET` in production; falls back to a warned, ephemeral dev secret locally.
- **`rateLimit.js`** — dependency-free fixed-window in-memory rate limiter, applied to login, OTP send/verify, registration, emergency creation, camp submission, and analytics event logging.
- **`audit.js`** — a new `audit_logs` table + logger, recording login success/failure, onboarding decisions, profile-update approvals, donation-credit adjustments, emergency fulfillment/cancellation, and manual admin overrides.

### `server.js`
- Replaced the header-trust middleware with real Bearer-token verification (`getActorFromRequest`, `requireAuth`, `requireRole(...)`, `requireSelfOrAdmin`).
- Fixed the `PUT /api/users/:id` auth-skip bug (#4) by requiring `requireAuth` up front.
- `POST /api/hospitals` now requires Admin and generates a random one-time temp password instead of a hardcoded one (#3).
- Restricted `donations`/`xp` self-editing to Admin/Hospital/Blood Bank actors (#6).
- Added ownership checks to: hospital/blood-bank profile edits, transfer approval (only the *supplying* bank), emergency respond/reserve/fulfill/cancel (donor-self / owning-hospital only), notifications, appointments, donation history, camp registrations.
- Sanitized `buildUserResponse` — private fields (`phone`, `telegramChatId`, exact `lat`/`lng`) are now only attached for the account owner or an Admin; every other caller (including anonymous) gets `null` for these fields.
- Added `sendError()` — logs full error detail server-side, but only returns short, pre-existing business-validation messages to the client (e.g. "Insufficient stock…"); anything that looks like a raw driver/runtime exception is replaced with a generic message (#8).
- Added baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`) (#9).
- Raised bcrypt cost factor from 8 → 12 for new password hashes (#10).
- Added an `escapeHtml()` helper and applied it to all user-supplied strings going into Telegram `parse_mode: HTML` messages (#11).
- Tightened `findUserByLogin` to exact-match only, dropping the previous substring fallback (#12).
- Restricted `GET/POST /api/recent_donations` and `GET/POST /api/donor_matches` to Admin/Hospital/Blood Bank actors (#13).
- Added a Hospital-identity spoofing guard on emergency creation: an authenticated Hospital actor can no longer file a request under a different hospital's name.

### Deliberately left open (by design, not oversight)
Two endpoints remain unauthenticated after careful review of actual client behavior, because they are genuinely public-by-design features, not bugs:
- **`POST /api/emergencies`** (report an emergency) — the "Report Emergency" button has no login gate in the UI; patients/families without an account need to be able to raise an urgent request, similar to calling for help. Left open, but rate-limited and spoofing-protected.
- **`POST /api/camps`** (organize a camp) — same reasoning; submissions land as "Unverified / Under Review" and require Admin approval before going live. Left open, rate-limited.

Restricting either of these to logged-in users only would be a straightforward follow-up if you'd prefer that tradeoff — flagging it explicitly rather than making that call silently.

### Client (`client/src/api.ts`, `client/src/context/AuthContext.tsx`)
- Replaced the old `X-Actor-Id`/`X-Actor-Role` headers with `setApiActor(token)` + an `authedFetch()` wrapper that attaches `Authorization: Bearer <token>` to every request (reads included, since several GET routes now require auth too).
- `AuthContext` now stores the session token (from login/OTP-verify) in state + `localStorage`, restores it on page load *before* the initial user-list fetch, and clears it on logout.
- No UI/UX changes — the login flow, dashboards, and all existing pages behave identically from the user's perspective.

### Project hygiene
- Added `.env.example` documenting `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `PORT`, `NODE_ENV`, `TRUST_PROXY`.
- Added `.gitignore` covering `.env`, `node_modules/`, build output, and the local `*.db` file (which contains seeded demo PII and should never be committed).

## 4. Testing

- **Backend unit tests**: `node --test tests/**/*.test.js` → 93/93 pass, unmodified (these cover `matching.js` and `services/notifications.js` in isolation).
- **Client build**: `npm run build` (tsc -b && vite build) → clean, no TypeScript errors from the `api.ts`/`AuthContext.tsx` refactor.
- **Live smoke testing** against a running instance with the real seed data confirmed:
  - Old-style header impersonation (`X-Actor-Id`/`X-Actor-Role`) → `401`.
  - A valid Donor token cannot reach the Admin dashboard → `403`.
  - Unauthenticated `PUT /api/users/:id` → `401` (previously succeeded — this was bug #4).
  - A Donor editing another Donor's record → `403`; editing their own name → `200`.
  - A Donor attempting to inflate their own `donations`/`xp` → `403`.
  - Hammering `POST /api/auth/login` 12x in a minute → the 11th+ request returns `429`.
  - Full emergency lifecycle end-to-end with real accounts: Hospital creates request → system auto-matches compatible donors → donor accepts → hospital reserves → hospital fulfills → a real donation record is created and both parties are notified. All at each authenticated step with ownership enforced (a second hospital account could not cancel the first hospital's request — `403`).
  - Hospital-identity spoofing attempt (filing a request under a different hospital's name while authenticated as Hospital A) → correctly overridden to the authenticated hospital's real name.
  - `GET /api/users` unauthenticated → `phone`/`lat`/`lng`/`telegramChatId` all `null`; the same user's own login response includes their real data; an Admin's `GET /api/users` includes everyone's real data.
  - `audit_logs` table correctly recorded login successes/failures and the emergency fulfillment event from the test run above.

One bug introduced during the fix itself was caught by this live testing (not left in): `getActorFromRequest`'s DB query initially didn't select `name`, which broke the hospital-spoofing-prevention check with a 500 error. Fixed and re-verified.
