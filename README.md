# 🩸 LifeLink — Blood Donation Platform

LifeLink is a full-stack demo platform that connects blood donors, patients,
hospitals, and blood banks: emergency blood requests, donor search and
matching, donation camp discovery, live maps, notifications, and
role-specific dashboards with analytics and demand forecasting.

This repository contains **two separate applications**, and it's important
to know which one you're looking at:

| | Status | Stack | Where |
|---|---|---|---|
| **React + Node app** | ✅ Actively developed. This is "the app." | React 19 + TypeScript + Vite frontend, Express + SQLite backend | `client/`, `server.js`, `services/` |
| **Static HTML/JS app** | 🗄️ Legacy prototype, kept for reference only, not maintained | Vanilla HTML/CSS/JS, no backend, no persistence | `index.html`, `css/`, `js/` |

Everything below (setup, architecture, data, testing) describes the
**React + Node app**, since that's the real, working product. The legacy
static prototype still opens directly in a browser with no build step if
you want to look at it, but it has no server, no database, and every
"action" in it is a client-side toast with no persistence — don't treat it
as a second working system.

---

## 1. Project overview

A patient or hospital posts an **emergency blood request**. LifeLink ranks
nearby, blood-type-compatible, available donors and can alert the top
matches over Telegram. Donors can also browse open requests, find blood
banks with live stock, discover donation camps, track their own donation
history via a digital "Blood Passport," and see a leaderboard. Hospitals,
blood banks, and admins get dashboards with real analytics computed from
the database, plus an experimental demand-forecasting view.

## 2. Features

- **Authentication** — password login, Telegram-based two-factor OTP for
  sign-in and sign-up, server-issued signed session tokens (not trusted
  client headers), role-based access control (Donor / Patient / Hospital /
  Blood Bank / Admin).
- **Emergency requests** — post, respond to, reserve against, fulfill, or
  cancel a request, with a full status-change audit history.
- **Blood search** — filter blood banks/hospitals by blood type, city, and
  distance; live inventory levels.
- **Donor matching** — rule-based ranking engine (compatibility, distance,
  availability, recency, reliability) with a human-readable explanation for
  every score.
- **Live map** — Leaflet map of donors, hospitals, blood banks, camps, and
  active emergencies, with routing.
- **Donation camps** — organizer-submitted camps plus an ingestion pipeline
  that can pull camps from external sources (see §9), all shown with clear
  verification status.
- **Notifications** — in-app + Telegram delivery, retry/backoff queue,
  per-user notification preferences.
- **Analytics dashboards** — real, live-queried metrics (not mocked), with
  role-appropriate scope (a hospital sees its own numbers; Admin sees the
  platform).
- **Demand forecasting** — a simple, explainable weighted-moving-average
  model over historical daily demand, with a shortage-risk classification
  per blood group/location. See §8 and §12 for what data it's trained on.
- **Blood Passport** — a donor's digital ID with QR code and donation
  history.
- **Leaderboard** — XP-based donor rankings.

## 3. Technology stack

**Frontend** (`client/`)
- React 19 + TypeScript, built with Vite 8
- React Router is installed but page routing is handled by a small custom
  `RoutingContext` (single-page, no URL-per-page routing yet)
- Leaflet + `react-leaflet`-style usage via a custom `LeafletMap` component
  for maps
- Recharts for charts, `qrcode` for the Blood Passport QR
- Plain CSS with CSS custom properties (design tokens) in `index.css` — no
  CSS framework
- `oxlint` for linting

**Backend** (root)
- Node.js (`>=22.5.0`) + Express
- `node:sqlite` (Node's built-in SQLite driver — currently an experimental
  Node API, hence the `ExperimentalWarning` you'll see at startup; this is
  expected and does not indicate a bug)
- `bcryptjs` for password hashing (cost factor 12)
- Hand-rolled HMAC-signed session tokens (`auth.js`) — no external auth
  library
- A small dependency-free token-bucket rate limiter (`rateLimit.js`)
- Telegram Bot API for OTP delivery and alerts (`telegram.js`), with a
  console-logging dev-mode fallback when no bot token is configured

**No external database, queue, or cache service is required.** SQLite is a
single file (`lifelink.db`) — there's nothing to provision.

## 4. Architecture

```
┌─────────────────────┐        HTTPS / JSON         ┌──────────────────────┐
│  client/ (Vite/React)│ ───────────────────────────▶│  server.js (Express) │
│  - pages/, components│ ◀─────────────────────────── │  - REST endpoints    │
│  - api.ts (fetch      │        + SSE stream          │  - auth.js (sessions)│
│    wrapper)            │  /api/events/stream         │  - rateLimit.js      │
└─────────────────────┘                              │  - audit.js          │
                                                        │  - matching.js       │
                                                        │  - telegram.js       │
                                                        └──────────┬───────────┘
                                                                   │
                                       ┌───────────────────────────┼───────────────────────────┐
                                       ▼                           ▼                           ▼
                             services/analytics.js       services/notifications.js  services/demandForecast.js
                             services/campIngestion/*                                (weighted moving average)
                                       │
                                       ▼
                              lifelink.db (SQLite, node:sqlite)
```

- In development, `npm run dev` runs the Vite dev server (client) and
  Express (`server.js`) concurrently, with the client calling the API
  directly.
- In production (`npm run build` then `npm start`), Express serves the
  built static client from `client/dist` **and** the API from the same
  origin/port — no separate frontend host or CORS config needed.
- Real-time-ish updates (new notifications, emergency status changes) use
  a Server-Sent Events stream (`GET /api/events/stream`), not WebSockets.

## 5. Database

SQLite, 24 tables, schema + demo data both created by `setup_db.js`. Key
tables: `users`, `blood_groups`, `blood_group_compatibility`, `locations`,
`donor_profiles`, `hospital_profiles`, `blood_bank_profiles`,
`blood_inventory`, `emergencies`, `emergency_status_history`, `camps`,
`camp_ingestion_runs`, `camp_registrations`, `donations`, `appointments`,
`transfers`, `notifications`, `notification_deliveries`,
`notification_preferences`, `otp_codes`, `analytics_events`,
`donor_match_suggestions`, `synthetic_demand_history`, `audit_log`.

Foreign keys are enforced (`PRAGMA foreign_keys = ON`). There is no ORM —
queries are hand-written prepared statements throughout `server.js` and
`services/*.js`.

## 6. API structure

REST, JSON in/out, `Authorization: Bearer <token>` on every authenticated
request (token minted at login/OTP-verify by `auth.js`; a user's role is
always re-read from the database on each request, never trusted from the
token itself, so a role change or suspension takes effect immediately).

Grouped by area:

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `/login/request-otp`, `/login/verify-otp`, `/otp/send`, `/otp/verify` |
| Users | `GET/POST /api/users`, `PUT /api/users/:id` |
| Emergencies | `GET/POST /api/emergencies`, `/:id/respond`, `/:id/reserve`, `/:id/fulfill`, `/:id/cancel`, `PUT/DELETE /:id`, `GET /:id/history` |
| Camps | `GET/POST /api/camps`, `PUT /:id`, `PUT /:id/verify`, `POST /ingest`, `GET /ingestion/runs`, `GET/POST /api/camp_registrations` |
| Blood search | `GET /api/search/blood-availability`, `GET /api/search/donors` |
| Hospitals / blood banks | `GET/POST/PUT /api/hospitals`, `GET/PUT /api/blood_banks` |
| Donations / transfers / appointments | `GET /api/donations`, `GET/POST/PUT /api/transfers`, `GET/POST/PUT /api/appointments` |
| Notifications | `GET/POST/PUT /api/notifications`, `/read-all`, `/unread-count`, `/:id/deliveries`, `GET/PUT /api/notification-preferences` |
| Matching | `GET/POST /api/donor_matches`, `POST /api/matching/rank-donors`, `GET /api/matching/weights` |
| Analytics | `GET/POST /api/analytics/events`, `GET /api/analytics/summary`, `/dashboard`, `/filter-options` (Admin/scoped-role only) |
| Dashboards | `GET /api/dashboard/donor`, `/hospital`, `/bloodbank`, `/admin` |
| Forecast | `GET /api/forecast/demand`, `/high-risk-locations`, `/history` (Admin only) |
| Live updates | `GET /api/events/stream` (SSE) |

Errors are consistent JSON (`{ "error": "..." }`) with an appropriate HTTP
status (400 validation, 401 auth, 403 role, 404 not found, 429 rate
limited, 5xx server error) — the frontend's `api.ts` surfaces these as
per-page error states rather than generic failures.

## 7. AI / ML features — what's actually "AI" here

Be precise about this, because it's easy to oversell:

- **Donor matching (`matching.js`)** is a **rule-based scoring engine**,
  not a trained model. It's explicitly named `rule-based-v2` in code and
  documented as swappable for a real ML ranker later. Every score comes
  with a human-readable breakdown of the factors that produced it
  (compatibility, distance, availability, recency, reliability).
- **Demand forecasting (`services/demandForecast.js`)** is a **weighted
  moving average with day-of-week seasonality** — deliberately simple and
  explainable rather than a black-box model, per its own doc comments. It
  is explicitly labeled in code as `weighted-moving-average-v1` and every
  API response includes a `dataSource` field.
- Neither system uses a neural network, an LLM, or any third-party AI
  API. "AI Match" in the UI refers to the automated ranking behavior, not
  to a machine-learning model.
- The chatbot (`components/Chatbot.tsx`) is a small rule/keyword-based FAQ
  responder, not an LLM integration.

If you plan to swap either system for real ML, the code is already
structured for it: `scoreDonor()` and `forecastSeries()` are pure
functions with documented input/output contracts specifically so a model
can be dropped in without touching the surrounding I/O code.

## 8. Data sources — real vs. demo vs. synthetic vs. scraped vs. AI-generated

This matters a lot for a healthcare-adjacent app, so here's the exact
breakdown. **Nothing in this repository is real patient, donor, or
institutional data.**

| Data | What it is | Where it comes from |
|---|---|---|
| Donors, hospitals, blood banks, emergencies, camps, donations, notifications, etc. | **100% fictional demo/seed data**, deterministically generated | `setup_db.js`, seeded with a fixed seed (`20260731`) so re-running `npm run setup` gives the same dataset every time |
| Daily blood-demand history used to train the forecast | **Synthetic**, explicitly flagged | `synthetic_demand_history` table, `is_synthetic=1` on every row, generated by `setup_db.js` (23,360 rows across 4 cities × 730 days) |
| Forecast predictions | **Model output derived from the synthetic data above** — not a real-world prediction | `services/demandForecast.js`; every response includes `dataSource` so you always know what it was trained on |
| Donor-match scores | **Computed at request time from the (demo) data in the DB**, not pre-generated or hardcoded | `matching.js` |
| Sample ingested camps | **Fixture data representing what an external source *would* return** — not a live scrape of a real website | `services/campIngestion/adapters/sample*Adapter.js` + `fixtures/*.json`, clearly named "sample" throughout, seeded with `sourceName` like *"Sample Regional Health API (demo fixture)"* |
| Coimbatore locations/coordinates used for seed data | Real place names, used only as plausible-looking labels for fictional records | `setup_db.js` |

No component in this repo claims fictional/synthetic data is real. Every
generator and forecasting file has doc comments saying so explicitly (see
`setup_db.js` and `services/demandForecast.js` headers), and API responses
from the forecast endpoints carry a `dataSource` field for the same reason.

## 9. Web scraping methodology

The camp-ingestion pipeline (`services/campIngestion/`) is built to support
pulling donation camps from external sources, but ships with **fixture
adapters only** — it does not scrape any live site out of the box.

- **Architecture**: `Fetch → Parse → Validate → Deduplicate → Normalize →
  Store`, run through a single orchestrator (`pipeline.js`) for every
  source, with every run logged step-by-step to `camp_ingestion_runs` so
  ingestion is auditable.
- **robots.txt compliance is enforced in code** (`robotsCompliance.js`): a
  real, tested implementation of the robots.txt exclusion protocol
  (`User-agent` groups, `Allow`/`Disallow`, longest-match-wins), gating any
  web-import adapter before it fetches a page. The bot identifies itself
  honestly via a descriptive `User-Agent` string with a contact link.
- **This is necessary but not sufficient**: the code comments are explicit
  that robots.txt alone doesn't grant legal permission to scrape a site — a
  human must separately confirm a target's Terms of Service permit
  automated collection, and that no personal/medical data is being
  collected, before any real (non-fixture) web source is enabled.
- **Every ingested camp record is stored as `verification_status =
  'Unverified'`** — there is no code path that lets an ingested record skip
  this. A human must explicitly verify a camp (`PUT /api/camps/:id/verify`)
  before it's presented as confirmed.
- **What's included today**: `adapters/sampleApiAdapter.js` and
  `adapters/sampleScrapeAdapter.js` read from local JSON fixtures
  (`fixtures/sample-official-api-response.json`,
  `fixtures/sample-scrape-source.json`) so the full pipeline (including
  dedup and normalization) is exercisable and testable without depending on
  or hitting any real external website.

If you want to point this at a real source, you'd write a new adapter
following the same `fetchFn` contract as the samples, route it through
`robotsCompliance.js`, and do the legal/ToS check described above first.

## 10. How to run locally

Requires **Node.js ≥ 22.5.0** (for built-in `node:sqlite`).

```bash
git clone <this-repo>
cd lifelink

# 1. Install root (server) dependencies
npm install

# 2. Install client dependencies
npm install --prefix client

# 3. Configure environment (see §11)
cp .env.example .env
# then edit .env — at minimum, set a SESSION_SECRET (see below)

# 4. Create the database and seed demo data (see §12)
npm run setup

# 5. Run both the API server and the Vite dev client together
npm run dev
```

- Client (Vite dev server): http://localhost:5173
- API (Express): http://localhost:8000

For a production-style single-process run instead:
```bash
npm run build     # builds client/dist
npm start         # Express serves the API AND the built client on one port
```

Run the automated test suite (backend service/unit tests):
```bash
npm test
```

## 11. Environment variables

Defined in `.env.example` — copy it to `.env` and fill in real values
(never commit the actual `.env`):

| Variable | Required? | Purpose |
|---|---|---|
| `SESSION_SECRET` | Required in production | HMAC secret used to sign session tokens. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. If unset, the app falls back to an ephemeral random secret for local dev only (all sessions invalidate on every restart); it refuses to start with this fallback if `NODE_ENV=production`. |
| `TELEGRAM_BOT_TOKEN` | Optional | Enables real OTP/alert delivery via Telegram. If unset, the app runs in **dev mode**: OTP codes are logged to the server console and echoed back in the API response (`devCode`) instead of being sent, so the full auth flow still works without a real bot. |
| `PORT` | Optional | Express port. Defaults to `8000`. |
| `NODE_ENV` | Optional | Set to `production` to enforce production-only checks (e.g. requiring `SESSION_SECRET`). |
| `TRUST_PROXY` | Optional | Set to `true` only if running behind a trusted reverse proxy that sets `X-Forwarded-For` correctly. Leave unset/`false` on a directly-exposed server — trusting it from untrusted clients would allow rate-limit bypass. |

## 12. How to seed demo data

```bash
npm run setup
```

This runs `setup_db.js`, which:
1. Creates the schema (24 tables + indexes) if it doesn't exist.
2. Generates a full **fictional, deterministic** demo dataset (fixed seed
   `20260731`, so it's identical every time you re-run it): donors,
   hospitals, blood banks with varied inventory, an admin account,
   emergency requests with status history, donation camps (including two
   sample-ingested, unverified ones), registrations, donation records,
   appointments, transfers, notifications, analytics events, donor-match
   suggestions, and synthetic daily demand history for forecasting.

**This is destructive/full-reset by design** — re-running it any time gives
you a clean, consistent demo state. It prints a demo login on completion
(pattern: `<firstname>123`, e.g. the first seeded donor / `admin123` for
the seeded Admin account) — check the console output after running it for
the exact current values, since the specific first donor is deterministic
but not hardcoded in this doc.

## 13. How to run analytics

Analytics are computed live from the database — there's no separate batch
job to run. Once the server is running and you're logged in as a role with
access (Admin sees platform-wide; Hospital/Blood Bank see their own scope):

- `GET /api/analytics/summary` and `GET /api/analytics/dashboard` — power
  the in-app **Analytics** page (`client/src/pages/Analytics.tsx`), with
  optional filters (`dateFrom`, `dateTo`, `bloodGroup`, `city`,
  `hospitalId`, `bloodBankId`).
- `services/analytics.js` functions are also directly unit-tested — see
  `tests/analytics.test.js` — if you want to exercise the metric logic
  without going through HTTP.

## 14. How to run the ML/forecasting pipeline

Also computed on demand, not a scheduled/offline job:

- `GET /api/forecast/demand` — per blood-group/location prediction (Admin
  only).
- `GET /api/forecast/high-risk-locations` — locations whose predicted
  demand vs. current stock crosses a shortage-risk threshold.
- `GET /api/forecast/history` — the historical series a prediction was
  based on, for charting.

To exercise the forecasting math directly (no server/DB needed):
```bash
node --test tests/demandForecast.test.js
```
`services/demandForecast.js` exports `forecastSeries()` as a pure function
if you want to experiment with it in a script or REPL — see its doc
comments for the exact input/output shape.

## 15. Authentication details

Real, two-factor, Telegram-based login — not a placeholder:

1. Every account links a Telegram **Chat ID** (obtained by messaging the
   configured bot with `/start`), verified via `/api/auth/otp/verify`
   before the account is created.
2. On sign-in, after password verification, a fresh OTP is sent to the
   linked Telegram chat (`/api/auth/login/request-otp` →
   `/api/auth/login/verify-otp`) — a true second factor, not a signup-only
   formality.
3. Critical/urgent emergency posts trigger an instant Telegram alert to
   donors with a matching blood type and a linked chat.
4. Without `TELEGRAM_BOT_TOKEN` set, the whole flow still works in **dev
   mode** — codes are printed to the server console instead of sent.

### Role-based access

Only the public pages (Home, Emergency board, Find Blood, Live Map, AI
Match, Camps, Leaderboard) are open to everyone. The Donor, Hospital, Blood
Bank, and Admin dashboards, the Blood Passport, Notifications, and
Analytics/Forecast pages are gated — an unauthenticated visitor is
redirected to sign in first, and every server-side route re-checks the
caller's role from the database (not from any client-supplied header) on
every request.

## 16. Testing this repo yourself

```bash
npm test                          # 93 backend unit/service tests (Node's built-in test runner)
npx tsc -b --pretty               # from client/ — TypeScript typecheck
npx oxlint                        # from client/ — lint
npx vite build                    # from client/ — production build
```

All four currently pass cleanly with no errors on a clean checkout.
