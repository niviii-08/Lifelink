const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyStock, dateRangeClause } = require('../services/analytics');

/* ---------------------------------------------------------------------- */
/* classifyStock                                                          */
/* ---------------------------------------------------------------------- */

test('classifyStock: zero units is Out of Stock', () => {
  assert.equal(classifyStock(0), 'Out of Stock');
});

test('classifyStock: 1-10 units is Critical', () => {
  assert.equal(classifyStock(1), 'Critical');
  assert.equal(classifyStock(10), 'Critical');
});

test('classifyStock: 11-25 units is Low', () => {
  assert.equal(classifyStock(11), 'Low');
  assert.equal(classifyStock(25), 'Low');
});

test('classifyStock: 26+ units is Adequate', () => {
  assert.equal(classifyStock(26), 'Adequate');
  assert.equal(classifyStock(1000), 'Adequate');
});

test('classifyStock: boundaries are monotonic (never classifies more stock as worse)', () => {
  const order = ['Out of Stock', 'Critical', 'Low', 'Adequate'];
  let lastRank = -1;
  for (let units = 0; units <= 40; units++) {
    const rank = order.indexOf(classifyStock(units));
    assert.ok(rank >= lastRank, `units=${units} regressed in severity`);
    lastRank = rank;
  }
});

/* ---------------------------------------------------------------------- */
/* dateRangeClause                                                        */
/* ---------------------------------------------------------------------- */

test('dateRangeClause: no dates produces an empty clause and no params', () => {
  const { clause, params } = dateRangeClause('d.donation_date', undefined, undefined);
  assert.equal(clause, '');
  assert.deepEqual(params, []);
});

test('dateRangeClause: only dateFrom produces a single >= condition', () => {
  const { clause, params } = dateRangeClause('d.donation_date', '2026-01-01', undefined);
  assert.match(clause, /d\.donation_date >= \?/);
  assert.deepEqual(params, ['2026-01-01']);
});

test('dateRangeClause: only dateTo produces a single <= condition with end-of-day time', () => {
  const { clause, params } = dateRangeClause('d.donation_date', undefined, '2026-01-31');
  assert.match(clause, /d\.donation_date <= \?/);
  assert.deepEqual(params, ['2026-01-31 23:59:59']);
});

test('dateRangeClause: both dates produce two AND-ed conditions', () => {
  const { clause, params } = dateRangeClause('e.created_at', '2026-01-01', '2026-01-31');
  assert.match(clause, /AND e\.created_at >= \? AND e\.created_at <= \?/);
  assert.deepEqual(params, ['2026-01-01', '2026-01-31 23:59:59']);
});

test('dateRangeClause: clause is safely embeddable (starts with AND, no dangling WHERE)', () => {
  const { clause } = dateRangeClause('x', '2026-01-01', '2026-01-31');
  const sql = `SELECT 1 WHERE 1=1${clause}`;
  assert.ok(sql.includes('WHERE 1=1 AND'));
});
