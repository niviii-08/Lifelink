/* ==========================================================================
   Camp deduplication
   --------------------------------------------------------------------------
   Different sources (or repeated ingestion runs of the same source) can
   describe the same real-world camp. We fingerprint on a normalized
   (title + date + city) combination — good enough to catch the common case
   of "the same camp listed twice" without needing exact string equality,
   while staying simple and explainable rather than a fuzzy-matching black box.
   ========================================================================== */

const slugify = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const computeDedupeKey = (title, campDate, city) =>
  `${slugify(title)}|${campDate || ''}|${slugify(city)}`;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dedupeKey
 * @returns The existing camp row if a duplicate is found, else undefined.
 */
const findDuplicate = (db, dedupeKey) =>
  db.prepare('SELECT id, title, source, verification_status FROM camps WHERE dedupe_key = ?').get(dedupeKey);

module.exports = { computeDedupeKey, findDuplicate, slugify };
