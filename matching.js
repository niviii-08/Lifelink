/* ==========================================================================
   LifeLink Donor Matching Service
   --------------------------------------------------------------------------
   This is a RECOMMENDATION / RANKING engine, not a medical decision system.
   It suggests donors a hospital or coordinator might contact — it does not
   determine medical eligibility on its own, does not diagnose, and does not
   replace a clinical screening step at the point of donation.

   Design notes (why it's built this way):
   - `scoreDonor()` is a pure function: given plain-data inputs, it returns a
     score and a human-readable explanation for every factor. No DB, no I/O.
     That's what makes it unit-testable in isolation and swappable later —
     a future ML-based ranker only needs to implement the same
     (donor, context, weights) -> { matchScore, factors, eligible } contract
     to drop in as a replacement (see MATCHING_STRATEGY below).
   - `rankDonorsForRequest()` is the I/O layer: it queries the database for
     candidates and calls scoreDonor() on each one. Swapping the scoring
     strategy never requires touching this function's SQL.
   - Weights live in ONE place (DEFAULT_WEIGHTS) instead of being hardcoded
     inline across pages/components, and can be overridden per-request.
   ========================================================================== */

const MATCHING_STRATEGY = 'rule-based-v2'; // bump this if/when an ML strategy replaces scoreDonor()

// Relative importance of each factor. Must be positive numbers; they are
// normalized by their own sum, so they don't need to add up to 1 or 100.
const DEFAULT_WEIGHTS = Object.freeze({
  compatibility: 0.30,  // exact blood-type match vs. cross-compatible
  distance: 0.20,       // how close the donor is to the request
  availability: 0.15,   // donor's self-reported availability status
  eligibility: 0.15,    // medical readiness under the 90-day rule (gate + recency bonus)
  history: 0.10,        // track record of completed donations
  responseRate: 0.10    // historical accept-rate when previously notified
});

// Urgency only ever affects SEARCH PARAMETERS (like radius) — never the
// medical eligibility gate. Bypassing the 90-day donation-interval rule for
// urgency would be unsafe, so it is intentionally not configurable here.
const URGENCY_SEARCH_PROFILES = Object.freeze({
  Critical: { radiusBoostKm: 15 },
  Urgent: { radiusBoostKm: 5 },
  Normal: { radiusBoostKm: 0 }
});

const MIN_DAYS_BETWEEN_DONATIONS = 90;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* ---------------------------------------------------------------------- */
/* Per-factor scoring — each returns { score: 0..1, reason: string }      */
/* ---------------------------------------------------------------------- */

const scoreCompatibility = (exactTypeMatch) => {
  if (exactTypeMatch) return { score: 1, reason: 'Exact blood-type match' };
  return { score: 0.85, reason: 'Cross-compatible blood type (not an exact match, but medically compatible)' };
};

const scoreDistance = (distanceKm, effectiveRadiusKm) => {
  if (distanceKm === null || distanceKm === undefined) {
    return { score: 0.5, reason: 'Distance unknown — neutral score applied' };
  }
  const ratio = clamp01(1 - distanceKm / Math.max(1, effectiveRadiusKm));
  const label = distanceKm < 2 ? 'Very close by' : distanceKm < effectiveRadiusKm * 0.5 ? 'Reasonably close' : 'Within search radius, but farther out';
  return { score: ratio, reason: `${label} (~${distanceKm.toFixed(1)} km away)` };
};

const scoreAvailability = (availabilityStatus) => {
  if (availabilityStatus === 'Active') return { score: 1, reason: 'Marked Active and reachable' };
  if (availabilityStatus === 'On Duty') return { score: 0.55, reason: 'Marked On Duty — may be mid-process elsewhere' };
  return { score: 0, reason: `Not currently available (${availabilityStatus || 'Inactive'})` };
};

// Returns eligibility gate + recency-based readiness score. This encodes the
// standard ~90-day minimum interval between whole-blood donations.
const scoreEligibility = (daysSinceLastDonation) => {
  if (daysSinceLastDonation === null || daysSinceLastDonation === undefined) {
    return { score: 1, eligible: true, reason: 'No prior donation on record — eligible now' };
  }
  if (daysSinceLastDonation < MIN_DAYS_BETWEEN_DONATIONS) {
    const daysLeft = MIN_DAYS_BETWEEN_DONATIONS - daysSinceLastDonation;
    return { score: 0, eligible: false, reason: `Not yet eligible — donated ${daysSinceLastDonation}d ago, ${daysLeft}d remaining until eligible again` };
  }
  // Eligible; slightly reward having had more recovery time, capped so being
  // "very overdue" doesn't count as strictly better than a comfortable margin.
  const readiness = clamp01((daysSinceLastDonation - MIN_DAYS_BETWEEN_DONATIONS) / 30);
  return { score: 0.7 + 0.3 * readiness, eligible: true, reason: `Eligible — ${daysSinceLastDonation}d since last donation` };
};

const scoreHistory = (totalDonations) => {
  const n = totalDonations || 0;
  if (n === 0) return { score: 0.3, reason: 'No completed donations on record yet' };
  return { score: clamp01(n / 10), reason: `${n} completed donation${n === 1 ? '' : 's'} on record` };
};

const scoreResponseRate = (acceptedCount, declinedCount) => {
  const total = acceptedCount + declinedCount;
  if (total === 0) return { score: 0.75, reason: 'No response history yet — neutral estimate applied' };
  const rate = acceptedCount / total;
  return { score: rate, reason: `Accepted ${acceptedCount} of ${total} past request${total === 1 ? '' : 's'} (${Math.round(rate * 100)}%)` };
};

/* ---------------------------------------------------------------------- */
/* Pure combiner — this is the extension point for a future ML strategy.  */
/* ---------------------------------------------------------------------- */

/**
 * @param {object} donor Plain data about the candidate, no DB objects:
 *   { exactTypeMatch, distanceKm, availabilityStatus, daysSinceLastDonation, totalDonations, acceptedCount, declinedCount }
 * @param {object} context { effectiveRadiusKm }
 * @param {object} weights Same shape as DEFAULT_WEIGHTS (or a subset — missing keys fall back to defaults)
 * @returns {{ matchScore: number, eligible: boolean, factors: object }}
 */
const scoreDonor = (donor, context, weights = DEFAULT_WEIGHTS) => {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const factors = {
    compatibility: { weight: w.compatibility, ...scoreCompatibility(donor.exactTypeMatch) },
    distance: { weight: w.distance, ...scoreDistance(donor.distanceKm, context.effectiveRadiusKm) },
    availability: { weight: w.availability, ...scoreAvailability(donor.availabilityStatus) },
    eligibility: { weight: w.eligibility, ...scoreEligibility(donor.daysSinceLastDonation) },
    history: { weight: w.history, ...scoreHistory(donor.totalDonations) },
    responseRate: { weight: w.responseRate, ...scoreResponseRate(donor.acceptedCount || 0, donor.declinedCount || 0) }
  };

  const eligible = factors.eligibility.eligible && factors.availability.score > 0;

  const totalWeight = Object.values(factors).reduce((s, f) => s + f.weight, 0) || 1;
  const weightedSum = Object.values(factors).reduce((s, f) => s + f.weight * f.score, 0);
  const matchScore = eligible ? Math.round((weightedSum / totalWeight) * 100) : 0;

  return { matchScore, eligible, factors };
};

/* ---------------------------------------------------------------------- */
/* I/O layer — queries real data, then delegates scoring to scoreDonor()  */
/* ---------------------------------------------------------------------- */

const haversineKm = (lat1, lng1, lat2, lng2) => {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const maskName = (fullName) => {
  const parts = (fullName || '').trim().split(/\s+/);
  const first = parts[0] || 'Donor';
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1][0]}.` : '';
  return lastInitial ? `${first} ${lastInitial}` : first;
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ requestedBloodType: string, urgency?: 'Critical'|'Urgent'|'Normal', lat?: number, lng?: number,
 *           radiusKm?: number, limit?: number, weights?: object, groupIdByType: object }} params
 */
const rankDonorsForRequest = (db, params) => {
  const {
    requestedBloodType, urgency = 'Normal', lat = null, lng = null,
    radiusKm = 15, limit = 10, weights = {}, groupIdByType
  } = params;

  const recipientGroupId = groupIdByType[requestedBloodType];
  if (!recipientGroupId) {
    return { results: [], strategy: MATCHING_STRATEGY, weights: { ...DEFAULT_WEIGHTS, ...weights }, effectiveRadiusKm: radiusKm };
  }

  const effectiveRadiusKm = radiusKm + (URGENCY_SEARCH_PROFILES[urgency]?.radiusBoostKm || 0);

  // Compatible donor blood groups for this recipient type (real compatibility table, not a duplicated JS map)
  const compatibleGroupIds = db
    .prepare('SELECT donor_group_id, (donor_group_id = ?) as is_exact FROM blood_compatibility WHERE recipient_group_id = ?')
    .all(recipientGroupId, recipientGroupId);
  if (compatibleGroupIds.length === 0) {
    return { results: [], strategy: MATCHING_STRATEGY, weights: { ...DEFAULT_WEIGHTS, ...weights }, effectiveRadiusKm };
  }
  const exactSet = new Set(compatibleGroupIds.filter((r) => r.is_exact).map((r) => r.donor_group_id));
  const placeholders = compatibleGroupIds.map(() => '?').join(',');

  const candidates = db
    .prepare(
      `SELECT u.id, u.name, u.lat, u.lng, u.total_donations,
              dp.blood_group_id, dp.availability_status, dp.last_donation_date, loc.label as location_label
       FROM users u
       JOIN donor_profiles dp ON dp.user_id = u.id
       LEFT JOIN locations loc ON loc.id = u.location_id
       WHERE u.role = 'Donor' AND u.is_new_registration = 0 AND dp.blood_group_id IN (${placeholders})`
    )
    .all(...compatibleGroupIds.map((r) => r.donor_group_id));

  const responseStatsStmt = db.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('Accepted','Reserved','Donated') THEN 1 ELSE 0 END) as accepted,
       SUM(CASE WHEN status = 'Declined' THEN 1 ELSE 0 END) as declined
     FROM donor_matches WHERE donor_id = ?`
  );

  const now = Date.now();
  const scored = candidates.map((c) => {
    const distanceKm = lat != null && lng != null ? haversineKm(lat, lng, c.lat, c.lng) : null;
    const daysSinceLastDonation = c.last_donation_date
      ? Math.floor((now - new Date(c.last_donation_date).getTime()) / 86400000)
      : null;
    const stats = responseStatsStmt.get(c.id) || { accepted: 0, declined: 0 };

    const donorInput = {
      exactTypeMatch: exactSet.has(c.blood_group_id),
      distanceKm,
      availabilityStatus: c.availability_status,
      daysSinceLastDonation,
      totalDonations: c.total_donations,
      acceptedCount: stats.accepted || 0,
      declinedCount: stats.declined || 0
    };

    const { matchScore, eligible, factors } = scoreDonor(donorInput, { effectiveRadiusKm }, weights);

    return {
      donorId: c.id,
      displayName: maskName(c.name),
      matchScore,
      eligible,
      distanceKm,
      location: c.location_label || 'Coimbatore',
      availabilityStatus: c.availability_status,
      lastDonationDate: c.last_donation_date,
      donationCount: c.total_donations,
      factors
    };
  });

  const inRadius = scored.filter((s) => s.eligible && (s.distanceKm === null || s.distanceKm <= effectiveRadiusKm));
  inRadius.sort((a, b) => b.matchScore - a.matchScore);

  return {
    results: inRadius.slice(0, limit),
    strategy: MATCHING_STRATEGY,
    weights: { ...DEFAULT_WEIGHTS, ...weights },
    effectiveRadiusKm,
    totalCandidates: candidates.length,
    eligibleCandidates: inRadius.length
  };
};

module.exports = {
  MATCHING_STRATEGY,
  DEFAULT_WEIGHTS,
  URGENCY_SEARCH_PROFILES,
  MIN_DAYS_BETWEEN_DONATIONS,
  scoreCompatibility,
  scoreDistance,
  scoreAvailability,
  scoreEligibility,
  scoreHistory,
  scoreResponseRate,
  scoreDonor,
  rankDonorsForRequest,
  maskName,
  haversineKm
};
