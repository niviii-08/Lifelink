/* ==========================================================================
   Camp ingestion pipeline
   --------------------------------------------------------------------------
   The single orchestrator every source (manual, official API, web import)
   flows through:

       Public Source -> Fetch -> Parse -> Validate -> Deduplicate
                      -> Normalize -> Store -> (Display is the API/UI layer)

   Every run — regardless of source — is recorded in camp_ingestion_runs with
   a step-by-step log, so ingestion is auditable rather than a black box.
   Records that are ingested (not directly hand-submitted through the
   existing "Organize a Camp" form) ALWAYS start life as verification_status
   = 'Unverified'. There is no code path in this file that sets anything
   else — verifying a camp is a separate, explicit human action
   (see PUT /api/camps/:id/verify in server.js).
   ========================================================================== */

const { normalizeCampRecord } = require('./normalize');
const { validateCampRecord } = require('./validate');
const { computeDedupeKey, findDuplicate } = require('./dedupe');

const finishRun = (db, runId, status, counts, log, errorMessage) => {
  db.prepare(
    `UPDATE camp_ingestion_runs
     SET status = ?, fetched_count = ?, valid_count = ?, duplicate_count = ?, invalid_count = ?, inserted_count = ?,
         error_message = ?, log = ?, finished_at = datetime('now')
     WHERE id = ?`
  ).run(status, counts.fetched, counts.valid, counts.duplicate, counts.invalid, counts.inserted, errorMessage, JSON.stringify(log), runId);
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} opts
 * @param {'manual'|'official_api'|'web_import'} opts.source
 * @param {string} opts.sourceName Human-readable label shown in the UI for attribution.
 * @param {() => Promise<{records: object[], sourceUrl?: string|null, blocked?: boolean, reason?: string}>} opts.fetchFn
 * @param {string|null} [opts.triggeredBy] User id of whoever kicked off this run (null for scheduled/system runs).
 * @param {(city: string|null) => number|null} [opts.locationLookup] Resolves a city name to a known locations.id, if any.
 * @param {string} [opts.defaultCity]
 * @param {string} [opts.defaultState]
 */
const runIngestion = async (db, opts) => {
  const {
    source, sourceName, fetchFn, triggeredBy = null,
    locationLookup = () => null, defaultCity = 'Coimbatore', defaultState = 'Tamil Nadu'
  } = opts;

  const log = [`Ingestion run started for source="${source}" (${sourceName})`];
  const runId = Number(
    db.prepare(`INSERT INTO camp_ingestion_runs (source, source_name, triggered_by, status, log) VALUES (?, ?, ?, 'Running', ?)`)
      .run(source, sourceName, triggeredBy, JSON.stringify(log)).lastInsertRowid
  );

  // ---- 1. Fetch ----
  let fetched = [];
  let fetchedSourceUrl = null;
  try {
    log.push('Step: Fetch');
    const fetchResult = await fetchFn();
    if (fetchResult.blocked) {
      log.push(`BLOCKED before fetch could complete: ${fetchResult.reason}`);
      finishRun(db, runId, 'Failed', { fetched: 0, valid: 0, duplicate: 0, invalid: 0, inserted: 0 }, log, fetchResult.reason);
      return { runId, status: 'Failed', reason: fetchResult.reason, insertedCamps: [] };
    }
    fetched = fetchResult.records || [];
    fetchedSourceUrl = fetchResult.sourceUrl || null;
    log.push(`Fetched ${fetched.length} raw record(s) from ${sourceName}.`);
  } catch (err) {
    log.push(`FETCH ERROR: ${err.message}`);
    finishRun(db, runId, 'Failed', { fetched: 0, valid: 0, duplicate: 0, invalid: 0, inserted: 0 }, log, err.message);
    return { runId, status: 'Failed', reason: err.message, insertedCamps: [] };
  }

  // ---- 2-6. Parse/Normalize -> Validate -> Deduplicate -> Store ----
  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  const insertedCamps = [];

  const insertStmt = db.prepare(
    `INSERT INTO camps (
       id, title, organizer_id, organizer_name, location_id, location_label, venue, city, state, lat, lng,
       camp_date, start_time, end_time, contact_phone, contact_email, registration_url,
       capacity, registered_count, approved, status,
       source, source_name, source_url, source_last_updated, verification_status, verified_by, verified_at,
       dedupe_key
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'Scheduled', ?, ?, ?, ?, 'Unverified', NULL, NULL, ?)`
  );

  fetched.forEach((raw, idx) => {
    log.push(`Step: Parse/Normalize record #${idx + 1}`);
    const normalized = normalizeCampRecord(raw, { source, sourceName, defaultSourceUrl: fetchedSourceUrl });
    if (!normalized.city) normalized.city = defaultCity;
    if (!normalized.state) normalized.state = defaultState;

    log.push(`Step: Validate record #${idx + 1} ("${normalized.title || 'untitled'}")`);
    const { valid, errors } = validateCampRecord(normalized);
    if (!valid) {
      invalidCount++;
      log.push(`INVALID — rejected: ${errors.join('; ')}`);
      return;
    }
    validCount++;

    log.push(`Step: Deduplicate record #${idx + 1}`);
    const dedupeKey = computeDedupeKey(normalized.title, normalized.campDate, normalized.city);
    const existing = findDuplicate(db, dedupeKey);
    if (existing) {
      duplicateCount++;
      log.push(`DUPLICATE — matches existing camp ${existing.id} ("${existing.title}", source=${existing.source}) — skipped`);
      return;
    }

    log.push(`Step: Store record #${idx + 1}`);
    const locationId = locationLookup(normalized.city);
    const id = `camp-${source}-${Date.now()}-${idx}`;
    insertStmt.run(
      id, normalized.title, normalized.organizerName, locationId, normalized.venue || normalized.city, normalized.venue,
      normalized.city, normalized.state, normalized.lat, normalized.lng,
      normalized.campDate, normalized.startTime, normalized.endTime, normalized.contactPhone, normalized.contactEmail, normalized.registrationUrl,
      normalized.capacity,
      source, sourceName, normalized.sourceUrl, normalized.sourceLastUpdated,
      dedupeKey
    );
    insertedCamps.push({ id, title: normalized.title });
    log.push(`STORED as ${id} — verification_status=Unverified (requires human review)`);
  });

  const counts = { fetched: fetched.length, valid: validCount, duplicate: duplicateCount, invalid: invalidCount, inserted: insertedCamps.length };
  log.push(`Ingestion run complete: ${JSON.stringify(counts)}`);
  finishRun(db, runId, 'Completed', counts, log, null);

  return { runId, status: 'Completed', ...counts, insertedCamps, log };
};

module.exports = { runIngestion };
