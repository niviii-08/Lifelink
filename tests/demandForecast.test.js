const test = require('node:test');
const assert = require('node:assert/strict');
const { forecastSeries, classifyShortageRisk, RISK_THRESHOLDS_DAYS } = require('../services/demandForecast');

/* ---------------------------------------------------------------------- */
/* forecastSeries                                                         */
/* ---------------------------------------------------------------------- */

const flatSeries = (days, value) =>
  Array.from({ length: days }, (_, i) => ({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, dayOfWeek: i % 7, count: value }));

test('forecastSeries: empty series returns a zeroed, zero-confidence result rather than crashing', () => {
  const result = forecastSeries([]);
  assert.equal(result.predictedTotal, 0);
  assert.equal(result.confidencePct, 0);
  assert.equal(result.dataPointsUsed, 0);
});

test('forecastSeries: a perfectly flat series predicts close to that flat value', () => {
  const series = flatSeries(90, 10);
  const result = forecastSeries(series, { horizonDays: 7 });
  assert.ok(Math.abs(result.predictedDailyAvg - 10) < 0.5, `expected ~10, got ${result.predictedDailyAvg}`);
  assert.equal(result.predictedTotal, Math.round(result.predictedDailyAvg * 7));
});

test('forecastSeries: recent values are weighted more heavily than older ones', () => {
  // First half low, second half high — weighted average should sit above the simple mean
  const series = [
    ...flatSeries(45, 2),
    ...flatSeries(45, 10)
  ];
  const result = forecastSeries(series, { horizonDays: 1, lookbackDays: 90 });
  const simpleMean = 6; // (2*45 + 10*45) / 90
  assert.ok(result.predictedDailyAvg > simpleMean, `weighted avg (${result.predictedDailyAvg}) should exceed simple mean (${simpleMean}) since recent days are higher`);
});

test('forecastSeries: steadier (low-variance) series yields higher confidence than a volatile one', () => {
  const steady = flatSeries(90, 5);
  const volatile = Array.from({ length: 90 }, (_, i) => ({ date: `d${i}`, dayOfWeek: i % 7, count: i % 2 === 0 ? 0 : 20 }));
  const steadyResult = forecastSeries(steady);
  const volatileResult = forecastSeries(volatile);
  assert.ok(steadyResult.confidencePct > volatileResult.confidencePct);
});

test('forecastSeries: more historical data yields higher confidence than very little data (all else equal)', () => {
  const short = flatSeries(5, 5);
  const long = flatSeries(90, 5);
  const shortResult = forecastSeries(short, { lookbackDays: 90 });
  const longResult = forecastSeries(long, { lookbackDays: 90 });
  assert.ok(longResult.confidencePct > shortResult.confidencePct);
});

test('forecastSeries: day-of-week seasonality boosts the prediction for a consistently high day', () => {
  // Day-of-week 6 (Saturday) is always 3x the other days
  const series = Array.from({ length: 90 }, (_, i) => {
    const dow = i % 7;
    return { date: `d${i}`, dayOfWeek: dow, count: dow === 6 ? 15 : 5 };
  });
  const forSaturday = forecastSeries(series, { horizonDays: 1, targetDayOfWeek: 6 });
  const forTuesday = forecastSeries(series, { horizonDays: 1, targetDayOfWeek: 2 });
  assert.ok(forSaturday.predictedDailyAvg > forTuesday.predictedDailyAvg, 'Saturday-targeted forecast should be higher than Tuesday-targeted forecast');
});

test('forecastSeries: confidence is always within [0, 100]', () => {
  const wild = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, dayOfWeek: i % 7, count: Math.random() > 0.5 ? 0 : 1000 }));
  const result = forecastSeries(wild);
  assert.ok(result.confidencePct >= 0 && result.confidencePct <= 100);
});

test('forecastSeries: reports the model method for transparency', () => {
  const result = forecastSeries(flatSeries(10, 1));
  assert.equal(typeof result.method, 'string');
  assert.ok(result.method.length > 0);
});

/* ---------------------------------------------------------------------- */
/* classifyShortageRisk                                                   */
/* ---------------------------------------------------------------------- */

test('classifyShortageRisk: zero predicted demand with some stock is Low risk, not a divide-by-zero crash', () => {
  const result = classifyShortageRisk(50, 0);
  assert.equal(result.risk, 'Low');
  assert.equal(result.daysOfSupply, null);
});

test('classifyShortageRisk: zero stock and zero demand is Unknown, not falsely "safe"', () => {
  const result = classifyShortageRisk(0, 0);
  assert.equal(result.risk, 'Unknown');
});

test('classifyShortageRisk: at/under the critical-day threshold is Critical', () => {
  const result = classifyShortageRisk(RISK_THRESHOLDS_DAYS.critical * 10, 10); // exactly at threshold days
  assert.equal(result.risk, 'Critical');
});

test('classifyShortageRisk: comfortably above the medium threshold is Low', () => {
  const result = classifyShortageRisk(1000, 1);
  assert.equal(result.risk, 'Low');
});

test('classifyShortageRisk: risk severity increases monotonically as days-of-supply decreases', () => {
  const order = ['Low', 'Medium', 'High', 'Critical'];
  const daysSupplyValues = [30, 10, 5, 1];
  const risks = daysSupplyValues.map((days) => classifyShortageRisk(days * 10, 10).risk);
  const ranks = risks.map((r) => order.indexOf(r));
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], `risk should not decrease in severity as supply shrinks: ${risks}`);
  }
});

test('classifyShortageRisk: reason string explains the calculation in plain language', () => {
  const result = classifyShortageRisk(70, 10);
  assert.match(result.reason, /predicted rate/i);
  assert.match(result.reason, /7/); // 70/10 = 7 days
});
