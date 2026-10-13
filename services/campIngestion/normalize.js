/* ==========================================================================
   Camp record normalization
   --------------------------------------------------------------------------
   Every adapter (manual entry, official API, permitted web import) returns
   raw records in whatever shape that source uses. This is the single place
   that maps ANY of those shapes into LifeLink's normalized Camp model, so
   downstream validation/dedup/storage never has to know or care where a
   record came from.
   ========================================================================== */

const normalizeDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const cleanString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * @param {object} raw A single raw record from an adapter (arbitrary shape).
 * @param {{ source: string, sourceName: string, defaultSourceUrl?: string|null }} sourceMeta
 * @returns Normalized camp fields, ready for validation.
 */
const normalizeCampRecord = (raw, sourceMeta) => ({
  title: cleanString(raw.title || raw.name || raw.campTitle),
  organizerName: cleanString(raw.organizer || raw.organizerName || raw.organiser),
  venue: cleanString(raw.venue || raw.address || raw.location),
  city: cleanString(raw.city),
  state: cleanString(raw.state || raw.province),
  lat: toNumberOrNull(raw.lat ?? raw.latitude),
  lng: toNumberOrNull(raw.lng ?? raw.longitude),
  campDate: normalizeDate(raw.date || raw.campDate || raw.eventDate),
  startTime: cleanString(raw.startTime || raw.start_time),
  endTime: cleanString(raw.endTime || raw.end_time),
  contactPhone: cleanString(raw.contactPhone || raw.phone),
  contactEmail: cleanString(raw.contactEmail || raw.email),
  registrationUrl: cleanString(raw.registrationUrl || raw.registerUrl || raw.url),
  capacity: (() => {
    const n = toNumberOrNull(raw.capacity ?? raw.expectedDonors);
    return n !== null ? Math.round(n) : null;
  })(),
  source: sourceMeta.source,
  sourceName: sourceMeta.sourceName,
  sourceUrl: cleanString(raw.sourceUrl) || sourceMeta.defaultSourceUrl || null,
  sourceLastUpdated: cleanString(raw.lastUpdated || raw.updatedAt) || null
});

module.exports = { normalizeCampRecord, normalizeDate, toNumberOrNull, cleanString };
