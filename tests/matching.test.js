const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_WEIGHTS,
  MIN_DAYS_BETWEEN_DONATIONS,
  scoreCompatibility,
  scoreDistance,
  scoreAvailability,
  scoreEligibility,
  scoreHistory,
  scoreResponseRate,
  scoreDonor,
  maskName
} = require('../matching');

/* ---------------------------------------------------------------------- */
/* Per-factor scoring functions                                           */
/* ---------------------------------------------------------------------- */

test('scoreCompatibility: exact type match scores higher than cross-compatible', () => {
  const exact = scoreCompatibility(true);
  const cross = scoreCompatibility(false);
  assert.equal(exact.score, 1);
  assert.ok(cross.score < exact.score && cross.score > 0);
});

test('scoreDistance: closer donors score higher, monotonically', () => {
  const near = scoreDistance(1, 15);
  const mid = scoreDistance(7, 15);
  const far = scoreDistance(14, 15);
  assert.ok(near.score > mid.score);
  assert.ok(mid.score > far.score);
});

test('scoreDistance: unknown distance gets a neutral score, not zero', () => {
  const unknown = scoreDistance(null, 15);
  assert.equal(unknown.score, 0.5);
});

test('scoreDistance: never goes negative for donors beyond the radius', () => {
  const wayFar = scoreDistance(500, 15);
  assert.ok(wayFar.score >= 0);
});

test('scoreAvailability: Active > On Duty > Inactive', () => {
  const active = scoreAvailability('Active');
  const onDuty = scoreAvailability('On Duty');
  const inactive = scoreAvailability('Inactive');
  assert.equal(active.score, 1);
  assert.ok(onDuty.score > 0 && onDuty.score < active.score);
  assert.equal(inactive.score, 0);
});

test('scoreEligibility: never donated before is immediately eligible', () => {
  const result = scoreEligibility(null);
  assert.equal(result.eligible, true);
  assert.equal(result.score, 1);
});

test('scoreEligibility: donor within the 90-day window is NOT eligible', () => {
  const result = scoreEligibility(45);
  assert.equal(result.eligible, false);
  assert.equal(result.score, 0);
  assert.match(result.reason, /45d ago/);
});

test('scoreEligibility: exactly at the boundary is eligible', () => {
  const result = scoreEligibility(MIN_DAYS_BETWEEN_DONATIONS);
  assert.equal(result.eligible, true);
});

test('scoreEligibility: eligible donors get a small recency bonus that caps out', () => {
  const justEligible = scoreEligibility(90);
  const wellRested = scoreEligibility(120);
  const veryOverdue = scoreEligibility(400);
  assert.ok(wellRested.score > justEligible.score);
  assert.equal(wellRested.score, veryOverdue.score); // caps at +30 days, doesn't reward being overdue forever
});

test('scoreHistory: more completed donations scores higher, caps at 10', () => {
  const none = scoreHistory(0);
  const some = scoreHistory(5);
  const many = scoreHistory(10);
  const evenMore = scoreHistory(50);
  assert.ok(some.score > none.score);
  assert.ok(many.score > some.score);
  assert.equal(many.score, 1);
  assert.equal(evenMore.score, 1); // capped, not unbounded
});

test('scoreResponseRate: no history yields a neutral, clearly-labeled estimate', () => {
  const result = scoreResponseRate(0, 0);
  assert.equal(result.score, 0.75);
  assert.match(result.reason, /No response history/i);
});

test('scoreResponseRate: reflects real accept ratio', () => {
  const goodDonor = scoreResponseRate(9, 1);
  const flakyDonor = scoreResponseRate(1, 9);
  assert.equal(goodDonor.score, 0.9);
  assert.equal(flakyDonor.score, 0.1);
  assert.ok(goodDonor.score > flakyDonor.score);
});

/* ---------------------------------------------------------------------- */
/* Combined scoreDonor()                                                  */
/* ---------------------------------------------------------------------- */

const baseDonor = {
  exactTypeMatch: true,
  distanceKm: 2,
  availabilityStatus: 'Active',
  daysSinceLastDonation: null,
  totalDonations: 5,
  acceptedCount: 4,
  declinedCount: 1
};
const baseContext = { effectiveRadiusKm: 15 };

test('scoreDonor: an ideal candidate scores near the top of the range', () => {
  const { matchScore, eligible } = scoreDonor(baseDonor, baseContext);
  assert.equal(eligible, true);
  assert.ok(matchScore >= 85, `expected a high score, got ${matchScore}`);
  assert.ok(matchScore <= 100);
});

test('scoreDonor: match score is always within [0, 100]', () => {
  const worst = scoreDonor(
    { exactTypeMatch: false, distanceKm: 1000, availabilityStatus: 'Inactive', daysSinceLastDonation: 1, totalDonations: 0, acceptedCount: 0, declinedCount: 10 },
    baseContext
  );
  assert.ok(worst.matchScore >= 0 && worst.matchScore <= 100);

  const best = scoreDonor(
    { exactTypeMatch: true, distanceKm: 0, availabilityStatus: 'Active', daysSinceLastDonation: 120, totalDonations: 50, acceptedCount: 20, declinedCount: 0 },
    baseContext
  );
  assert.ok(best.matchScore >= 0 && best.matchScore <= 100);
});

test('scoreDonor: ineligible donors (recent donation) are gated to score 0 regardless of other factors', () => {
  const perfectExceptRecentDonation = { ...baseDonor, daysSinceLastDonation: 10 };
  const { matchScore, eligible } = scoreDonor(perfectExceptRecentDonation, baseContext);
  assert.equal(eligible, false);
  assert.equal(matchScore, 0);
});

test('scoreDonor: Inactive donors are gated out even if everything else is ideal', () => {
  const inactiveDonor = { ...baseDonor, availabilityStatus: 'Inactive' };
  const { eligible, matchScore } = scoreDonor(inactiveDonor, baseContext);
  assert.equal(eligible, false);
  assert.equal(matchScore, 0);
});

test('scoreDonor: returns a factor breakdown covering every weighted category', () => {
  const { factors } = scoreDonor(baseDonor, baseContext);
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    assert.ok(key in factors, `missing factor: ${key}`);
    assert.ok(typeof factors[key].score === 'number');
    assert.ok(typeof factors[key].reason === 'string' && factors[key].reason.length > 0);
  }
});

test('scoreDonor: weights are configurable and actually change the outcome', () => {
  // Donor A: far away but great compatibility/history. Donor B: very close, weaker history.
  const donorA = { ...baseDonor, distanceKm: 14, totalDonations: 10, acceptedCount: 10, declinedCount: 0 };
  const donorB = { ...baseDonor, distanceKm: 0.5, totalDonations: 0, acceptedCount: 0, declinedCount: 0 };

  const distanceHeavyWeights = { ...DEFAULT_WEIGHTS, distance: 5, history: 0.01, responseRate: 0.01 };
  const historyHeavyWeights = { ...DEFAULT_WEIGHTS, distance: 0.01, history: 5, responseRate: 5 };

  const underDistanceWeighting = {
    a: scoreDonor(donorA, baseContext, distanceHeavyWeights).matchScore,
    b: scoreDonor(donorB, baseContext, distanceHeavyWeights).matchScore
  };
  const underHistoryWeighting = {
    a: scoreDonor(donorA, baseContext, historyHeavyWeights).matchScore,
    b: scoreDonor(donorB, baseContext, historyHeavyWeights).matchScore
  };

  assert.ok(underDistanceWeighting.b > underDistanceWeighting.a, 'closer donor should win when distance is heavily weighted');
  assert.ok(underHistoryWeighting.a > underHistoryWeighting.b, 'donor with more history/response track record should win when those are heavily weighted');
});

test('scoreDonor: missing weight keys fall back to defaults rather than crashing', () => {
  const { matchScore } = scoreDonor(baseDonor, baseContext, { compatibility: 0.9 });
  assert.ok(matchScore >= 0 && matchScore <= 100);
});

/* ---------------------------------------------------------------------- */
/* Privacy helper                                                         */
/* ---------------------------------------------------------------------- */

test('maskName: reduces a full name to first name + last initial', () => {
  assert.equal(maskName('Arjun Kumar'), 'Arjun K.');
  assert.equal(maskName('Priya'), 'Priya');
  assert.equal(maskName(''), 'Donor');
});
