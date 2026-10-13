/* ==========================================================================
   Sample official API adapter
   --------------------------------------------------------------------------
   DEMONSTRATION ADAPTER.

   In production this function would perform a real HTTP GET (with an API
   key or auth header, whatever the provider requires) against a government
   or NGO's published blood-camp API — official sources are always preferred
   over web scraping when they exist. No such live, credentialed endpoint is
   configured in this environment, so this reads a local fixture file that
   mirrors the exact response shape a real integration would return. That
   keeps the rest of the pipeline (parse/validate/dedupe/normalize/store)
   fully exercisable end-to-end, and means switching to a live source later
   only requires replacing the body of fetchOfficialApiCamps() below —
   nothing else in the ingestion pipeline needs to change.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const SOURCE_NAME = 'Sample Regional Health API (demo fixture)';
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'sample-official-api-response.json');

const fetchOfficialApiCamps = async () => {
  // --- Replace this block with a real fetch() call once a live endpoint is configured ---
  // Example of what that would look like:
  //   const res = await fetch(process.env.HEALTH_API_URL, { headers: { Authorization: `Bearer ${process.env.HEALTH_API_KEY}` } });
  //   const data = await res.json();
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
  // --- end replaceable block ---

  return { records: data.camps || [], sourceUrl: data.meta?.sourceUrl || null };
};

module.exports = { fetchOfficialApiCamps, SOURCE_NAME };
