const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCampRecord } = require('../services/campIngestion/normalize');
const { validateCampRecord } = require('../services/campIngestion/validate');
const { computeDedupeKey, slugify } = require('../services/campIngestion/dedupe');
const { parseRobotsTxt, isPathAllowed } = require('../services/campIngestion/robotsCompliance');

/* ---------------------------------------------------------------------- */
/* normalize                                                              */
/* ---------------------------------------------------------------------- */

test('normalizeCampRecord: maps common field name variants onto the standard shape', () => {
  const raw = { name: 'Test Camp', organizer: 'Test Org', address: '123 Main St', city: 'Coimbatore', date: '2026-09-01', phone: '9999999999' };
  const normalized = normalizeCampRecord(raw, { source: 'web_import', sourceName: 'Test Source' });
  assert.equal(normalized.title, 'Test Camp');
  assert.equal(normalized.organizerName, 'Test Org');
  assert.equal(normalized.venue, '123 Main St');
  assert.equal(normalized.city, 'Coimbatore');
  assert.equal(normalized.campDate, '2026-09-01');
  assert.equal(normalized.contactPhone, '9999999999');
  assert.equal(normalized.source, 'web_import');
});

test('normalizeCampRecord: invalid dates normalize to null rather than throwing', () => {
  const normalized = normalizeCampRecord({ title: 'X', date: 'not-a-real-date' }, { source: 'manual', sourceName: 'Test' });
  assert.equal(normalized.campDate, null);
});

test('normalizeCampRecord: missing optional fields become null, not undefined or empty string', () => {
  const normalized = normalizeCampRecord({ title: 'Bare Camp', date: '2026-09-01' }, { source: 'manual', sourceName: 'Test' });
  assert.equal(normalized.contactEmail, null);
  assert.equal(normalized.registrationUrl, null);
  assert.equal(normalized.lat, null);
});

test('normalizeCampRecord: whitespace-only strings are treated as missing', () => {
  const normalized = normalizeCampRecord({ title: '   ', date: '2026-09-01' }, { source: 'manual', sourceName: 'Test' });
  assert.equal(normalized.title, null);
});

/* ---------------------------------------------------------------------- */
/* validate                                                                */
/* ---------------------------------------------------------------------- */

const validCamp = () => ({
  title: 'Community Blood Drive', campDate: '2026-09-15', lat: 11.0, lng: 77.0,
  registrationUrl: 'https://example.org/register', sourceUrl: 'https://example.org/camps/1',
  contactEmail: 'contact@example.org', capacity: 100, source: 'web_import'
});

test('validateCampRecord: a well-formed record passes', () => {
  const { valid, errors } = validateCampRecord(validCamp());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validateCampRecord: rejects missing title', () => {
  const { valid, errors } = validateCampRecord({ ...validCamp(), title: null });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /title/i.test(e)));
});

test('validateCampRecord: rejects missing/unparseable date', () => {
  const { valid, errors } = validateCampRecord({ ...validCamp(), campDate: null });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /date/i.test(e)));
});

test('validateCampRecord: rejects out-of-range latitude/longitude', () => {
  const bad = validateCampRecord({ ...validCamp(), lat: 200 });
  assert.equal(bad.valid, false);
  const bad2 = validateCampRecord({ ...validCamp(), lng: -200 });
  assert.equal(bad2.valid, false);
});

test('validateCampRecord: rejects a lone coordinate (lat without lng)', () => {
  const { valid, errors } = validateCampRecord({ ...validCamp(), lat: 11.0, lng: null });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /both/i.test(e)));
});

test('validateCampRecord: rejects malformed registration URL', () => {
  const { valid } = validateCampRecord({ ...validCamp(), registrationUrl: 'not-a-url' });
  assert.equal(valid, false);
});

test('validateCampRecord: rejects malformed contact email', () => {
  const { valid } = validateCampRecord({ ...validCamp(), contactEmail: 'not-an-email' });
  assert.equal(valid, false);
});

test('validateCampRecord: rejects records with no source attribution', () => {
  const { valid, errors } = validateCampRecord({ ...validCamp(), source: null });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /source/i.test(e)));
});

test('validateCampRecord: rejects implausibly far future dates', () => {
  const { valid } = validateCampRecord({ ...validCamp(), campDate: '2099-01-01' });
  assert.equal(valid, false);
});

test('validateCampRecord: null lat/lng together (neither present) is fine', () => {
  const { valid } = validateCampRecord({ ...validCamp(), lat: null, lng: null });
  assert.equal(valid, true);
});

/* ---------------------------------------------------------------------- */
/* dedupe                                                                  */
/* ---------------------------------------------------------------------- */

test('computeDedupeKey: identical title/date/city produce the same key', () => {
  const a = computeDedupeKey('Community Blood Drive', '2026-09-15', 'Coimbatore');
  const b = computeDedupeKey('Community Blood Drive', '2026-09-15', 'Coimbatore');
  assert.equal(a, b);
});

test('computeDedupeKey: is case- and punctuation-insensitive', () => {
  const a = computeDedupeKey('Community Blood Drive!', '2026-09-15', 'Coimbatore');
  const b = computeDedupeKey('  community blood drive  ', '2026-09-15', 'coimbatore');
  assert.equal(a, b);
});

test('computeDedupeKey: different dates produce different keys', () => {
  const a = computeDedupeKey('Community Blood Drive', '2026-09-15', 'Coimbatore');
  const b = computeDedupeKey('Community Blood Drive', '2026-09-16', 'Coimbatore');
  assert.notEqual(a, b);
});

test('slugify: strips non-alphanumeric characters', () => {
  assert.equal(slugify("Rotary Club's Mega-Camp #1"), 'rotaryclubsmegacamp1');
});

/* ---------------------------------------------------------------------- */
/* robots.txt compliance                                                  */
/* ---------------------------------------------------------------------- */

const SAMPLE_ROBOTS = `
User-agent: *
Disallow: /admin/
Disallow: /account/
Allow: /listings/
`;

test('parseRobotsTxt: extracts Disallow/Allow rules per user-agent group', () => {
  const groups = parseRobotsTxt(SAMPLE_ROBOTS);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].agents, ['*']);
  assert.ok(groups[0].disallow.includes('/admin/'));
  assert.ok(groups[0].allow.includes('/listings/'));
});

test('isPathAllowed: blocks a disallowed path', () => {
  const groups = parseRobotsTxt(SAMPLE_ROBOTS);
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/admin/dashboard'), false);
});

test('isPathAllowed: permits a path with no matching rule', () => {
  const groups = parseRobotsTxt(SAMPLE_ROBOTS);
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/public/page'), true);
});

test('isPathAllowed: an explicit Allow overrides a shorter Disallow (longest match wins)', () => {
  const groups = parseRobotsTxt(`
User-agent: *
Disallow: /
Allow: /listings/
`);
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/listings/camp-1'), true);
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/other-page'), false);
});

test('isPathAllowed: empty robots.txt (no groups) defaults to allowed', () => {
  const groups = parseRobotsTxt('');
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/anything'), true);
});

test('isPathAllowed: a specific user-agent group takes precedence over wildcard', () => {
  const groups = parseRobotsTxt(`
User-agent: *
Allow: /

User-agent: lifelinkcampbot
Disallow: /
`);
  assert.equal(isPathAllowed(groups, 'LifeLinkCampBot/1.0', '/anything'), false);
});
