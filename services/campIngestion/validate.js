/* ==========================================================================
   Camp record validation
   --------------------------------------------------------------------------
   Runs on every record from every source (manual, API, or web import) before
   it's eligible for storage. A record that fails validation is rejected and
   logged — it never reaches the database, regardless of source.
   ========================================================================== */

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FUTURE_YEARS = 2;
const MAX_PAST_DAYS_FOR_NEW_INGEST = 365; // ingested records describing events over a year in the past are almost certainly stale/garbage

const validateCampRecord = (camp) => {
  const errors = [];

  if (!camp.title || camp.title.length < 3) {
    errors.push('Title is missing or too short');
  } else if (camp.title.length > 200) {
    errors.push('Title is unreasonably long (possible parsing error)');
  }

  if (!camp.campDate) {
    errors.push('Camp date is missing or unparseable');
  } else {
    const date = new Date(camp.campDate);
    const now = new Date();
    const maxFuture = new Date();
    maxFuture.setFullYear(now.getFullYear() + MAX_FUTURE_YEARS);
    const minPast = new Date(now.getTime() - MAX_PAST_DAYS_FOR_NEW_INGEST * 86400000);
    if (date > maxFuture) errors.push(`Camp date is implausibly far in the future (>${MAX_FUTURE_YEARS}y)`);
    if (date < minPast) errors.push('Camp date is more than a year in the past');
  }

  if (camp.lat !== null && (camp.lat < -90 || camp.lat > 90)) {
    errors.push('Latitude out of valid range (-90..90)');
  }
  if (camp.lng !== null && (camp.lng < -180 || camp.lng > 180)) {
    errors.push('Longitude out of valid range (-180..180)');
  }
  // If one coordinate is present, both should be — a lone value is usually a parsing error
  if ((camp.lat === null) !== (camp.lng === null)) {
    errors.push('Latitude/longitude must both be present or both be absent');
  }

  if (camp.registrationUrl && !URL_PATTERN.test(camp.registrationUrl)) {
    errors.push('Registration URL is not a valid http(s) URL');
  }
  if (camp.sourceUrl && !URL_PATTERN.test(camp.sourceUrl)) {
    errors.push('Source URL is not a valid http(s) URL');
  }
  if (camp.contactEmail && !EMAIL_PATTERN.test(camp.contactEmail)) {
    errors.push('Contact email is not a valid email address');
  }
  if (camp.capacity !== null && (!Number.isFinite(camp.capacity) || camp.capacity <= 0 || camp.capacity > 100000)) {
    errors.push('Capacity must be a positive, plausible number');
  }
  if (!camp.source) {
    errors.push('Missing source attribution (internal error — every record must declare its source)');
  }

  return { valid: errors.length === 0, errors };
};

module.exports = { validateCampRecord, URL_PATTERN, EMAIL_PATTERN };
