/* ==========================================================================
   Manual entry adapter
   --------------------------------------------------------------------------
   The simplest possible adapter: a hospital, camp organizer, or admin
   submits one camp through the UI form, and this wraps it into the same
   { records, sourceUrl } shape every other adapter returns — so it goes
   through the exact same validate -> dedupe -> normalize -> store pipeline
   as an API or web import, just with source = 'manual'.
   ========================================================================== */

const SOURCE_NAME = 'LifeLink Direct Entry';

const fetchManualEntry = async (submittedRecord) => ({
  records: [submittedRecord],
  sourceUrl: null
});

module.exports = { fetchManualEntry, SOURCE_NAME };
