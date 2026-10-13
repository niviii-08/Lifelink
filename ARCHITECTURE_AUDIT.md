# ARCHITECTURE_AUDIT.md

## 1. Current Architecture
LifeLink is currently structured as a monolithic client-server application. 
- **Frontend**: A React 19 single-page application built with Vite and TypeScript, residing in the `client/` directory. It uses a custom routing context, Recharts for charts, and Leaflet for map visualizations.
- **Backend**: An Express.js Node application (`server.js`) serving REST APIs and a Server-Sent Events (SSE) stream for real-time notifications.
- **Database**: A single SQLite database (`lifelink.db`) utilizing the built-in `node:sqlite` module. Data schemas are defined in `setup_db.js`.
- **Hosting / Execution**: In production mode, the Express server statically serves the built React client. Development is done concurrently.

## 2. Existing Functionality
The platform offers the following core features:
- **Authentication**: Custom JWT-like HMAC-signed session tokens and Telegram-based OTP.
- **Emergency Requests**: Creating and tracking critical blood requests.
- **Dashboards**: Role-specific views (Donor, Hospital, Blood Bank, Admin).
- **Matching & Search**: Finding nearby blood banks or donors based on blood compatibility and location.
- **Analytics & Forecasting**: Moving-average demand forecasting and aggregate statistics.
- **Notifications**: In-app SSE notifications and Telegram alerts.

## 3. Current Data Flow
- Clients fetch data or submit actions via HTTPS REST API calls (`/api/...`).
- API routes in `server.js` execute raw SQL queries against the local SQLite database.
- Real-time updates (like emergency status changes) are pushed to the client using a single-direction SSE stream (`/api/events/stream`).
- Complex business logic (like analytics aggregations or camp deduplication) is handled by separate service files in `services/`.

## 4. Current Database Tables
The application maintains a highly normalized relational schema with 24 tables, the core ones being:
- `users`: Core identity and auth, roles.
- `donor_profiles`, `hospital_profiles`, `blood_bank_profiles`: Role-specific metadata.
- `blood_groups`, `blood_compatibility`: Lookups for blood properties.
- `locations`: Reusable geospatial entities.
- `blood_inventory`: Live tracking of units per blood bank.
- `emergencies`, `emergency_status_history`: Tracking blood requests.
- `donor_matches`: Persisted results of the matching algorithm.
- `camps`, `camp_registrations`, `appointments`, `transfers`, `donations`: Operational records.
- `notifications`, `notification_preferences`, `notification_deliveries`: Communication tracking.
- `analytics_events`, `synthetic_demand_history`, `audit_log`: System monitoring and forecasting.

## 5. Current AI Functionality
The system's current "AI" features are explicitly hardcoded or rule-based, not machine learning:
- **Chatbot**: Found in `components/Chatbot.tsx`, it uses simple regex and keyword matching to return 4 hardcoded string responses.
- **Donor Matching**: Implemented in `matching.js`, it uses a deterministic scoring system (compatibility, distance, availability) to rank donors.
- **Demand Forecasting**: Found in `demandForecast.js`, it performs a simple weighted moving average over historical data. 
There are currently no LLMs, embeddings, or neural networks in the architecture.

## 6. Components That Should Be Preserved
- **Frontend UI & Workflows**: The overall Vite/React frontend application, layouts, pages, maps (Leaflet), and charts (Recharts) must be preserved.
- **Core Domain Logic**: Rule-based donor matching (`matching.js`) must be maintained since medical compatibility is deterministic. 
- **Roles & Permissions**: The concepts of Donor, Patient, Hospital, Blood Bank, and Admin workflows.

## 7. Components That Need Replacement
- **Database**: SQLite and `setup_db.js` must be entirely replaced by Firebase (Firestore, Auth, Storage).
- **Authentication System**: Custom HMAC sessions and manual bcrypt password hashing should be replaced by Firebase Auth.
- **Backend Architecture**: The Express backend will be replaced by a Python/FastAPI backend to easily integrate NLP, PyTorch, and RAG pipelines.
- **Chatbot UI/Logic**: The dummy hardcoded chatbot needs to be fully replaced by an LLM-driven UI showing intents, entities, confidence, and generated answers.

## 8. Components That Need Refactoring
- **API Communication**: The frontend `api.ts` module needs to be refactored to point to the new Python/FastAPI endpoints and handle Firebase Auth tokens instead of custom cookies/headers.
- **Emergency Creation Flow**: Needs to integrate the new NLP semantic parsing approach before falling back to manual entry.
- **Data Repositories**: Data access layers in the backend must be rewritten using the Firebase Admin SDK.
- **Real-time Updates**: The custom SSE implementation might need to be refactored to use Firestore's native real-time listeners.
