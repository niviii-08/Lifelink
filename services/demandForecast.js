/* ==========================================================================
   LifeLink Blood Demand Forecasting Service
   --------------------------------------------------------------------------
   ⚠️  IMPORTANT — READ BEFORE USING THESE NUMBERS FOR ANYTHING REAL
   This is a RECOMMENDATION / ESTIMATION tool, not a medical or clinical
   forecasting system. Predictions are statistical estimates derived from
   historical request patterns — they are not validated against real-world
   clinical outcomes and must never be treated as medical advice or a
   guarantee of future demand. A qualified professional should always make
   the final call on blood-supply decisions.

   The training data behind these forecasts is currently SYNTHETIC (see
   setup_db.js's synthetic_demand_history generator) because the live
   application does not yet have enough real historical data for meaningful
   forecasting. Every prediction response is labeled with `dataSource` so
   callers always know whether they're looking at synthetic-trained output.

   Design notes:
   - `forecastSeries()` is a pure function: given a plain array of daily
     counts (with day-of-week and date), it returns a prediction + a
     confidence estimate. No DB, no I/O — fully unit-testable, and this is
     the file to touch when you want to swap in a better model later
     (bump MODEL_STRATEGY when you do).
   - `runForecast()` is the I/O layer: it pulls historical rows (synthetic
     today, blendable with real data once enough accumulates) and the
     REAL current blood_inventory stock, then calls forecastSeries() and
     classifies shortage risk from the (real stock) vs (predicted demand)
     comparison.
   ========================================================================== */

const MODEL_STRATEGY = 'weighted-moving-average-v1'; // simple & explainable, by design — see task constraints

const RISK_THRESHOLDS_DAYS = { critical: 3, high: 7, medium: 14 }; // days-of-supply-remaining cutoffs

/* ---------------------------------------------------------------------- */
/* Pure forecasting math                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Weighted moving average over the trailing `lookbackDays`, with more
 * recent days weighted higher (linear decay), then adjusted by an observed
 * day-of-week seasonality index computed from the same history. This is
 * intentionally simple and explainable rather than a black-box model.
 *
 * @param {{ date: string, dayOfWeek: number, count: number }[]} series Ascending by date.
 * @param {{ horizonDays?: number, lookbackDays?: number, targetDayOfWeek?: number }} options
 * @returns {{ predictedDailyAvg: number, predictedTotal: number, confidencePct: number, dataPointsUsed: number, method: string }}
 */
const forecastSeries = (series, options = {}) => {
  const { horizonDays = 7, lookbackDays = 90, targetDayOfWeek = null } = options;

  if (!series || series.length === 0) {
    return { predictedDailyAvg: 0, predictedTotal: 0, confidencePct: 0, dataPointsUsed: 0, method: MODEL_STRATEGY };
  }

  const recent = series.slice(-lookbackDays);

  // Weighted moving average: linearly increasing weight toward the most recent day
  let weightedSum = 0;
  let weightTotal = 0;
  recent.forEach((row, idx) => {
    const weight = idx + 1; // oldest = 1, newest = recent.length
    weightedSum += row.count * weight;
    weightTotal += weight;
  });
  const baseDailyAvg = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Day-of-week seasonality index: ratio of that weekday's average to the overall average
  let seasonalMultiplier = 1;
  if (targetDayOfWeek !== null && recent.length >= 14) {
    const overallAvg = recent.reduce((s, r) => s + r.count, 0) / recent.length;
    const sameDay = recent.filter((r) => r.dayOfWeek === targetDayOfWeek);
    if (sameDay.length >= 2 && overallAvg > 0) {
      const sameDayAvg = sameDay.reduce((s, r) => s + r.count, 0) / sameDay.length;
      seasonalMultiplier = sameDayAvg / overallAvg;
      // Keep seasonality from swinging the estimate too wildly on thin data
      seasonalMultiplier = Math.max(0.5, Math.min(1.8, seasonalMultiplier));
    }
  }

  const predictedDailyAvg = baseDailyAvg * seasonalMultiplier;
  const predictedTotal = Math.round(predictedDailyAvg * horizonDays);

  // Confidence heuristic (NOT a statistical prediction interval): rewards more
  // history and penalizes high relative variance in the recent series.
  const mean = recent.reduce((s, r) => s + r.count, 0) / recent.length;
  const variance = recent.reduce((s, r) => s + (r.count - mean) ** 2, 0) / recent.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;
  const volatilityScore = Math.max(0, 1 - Math.min(1, coefficientOfVariation / 1.5)); // 0..1, higher = steadier
  const dataVolumeScore = Math.min(1, recent.length / lookbackDays); // 0..1, higher = more history
  const confidencePct = Math.round((0.6 * volatilityScore + 0.4 * dataVolumeScore) * 100);

  return {
    predictedDailyAvg: Math.round(predictedDailyAvg * 100) / 100,
    predictedTotal,
    confidencePct,
    dataPointsUsed: recent.length,
    method: MODEL_STRATEGY
  };
};

/**
 * Classifies shortage risk from real current stock vs. predicted demand.
 * Fully explainable: risk is just "how many days of supply is this stock
 * good for, at the predicted daily consumption rate".
 */
const classifyShortageRisk = (currentStock, predictedDailyAvg) => {
  if (predictedDailyAvg <= 0) {
    return { risk: currentStock > 0 ? 'Low' : 'Unknown', daysOfSupply: null, reason: 'No meaningful predicted demand to compare against current stock.' };
  }
  const daysOfSupply = currentStock / predictedDailyAvg;
  let risk;
  if (daysOfSupply <= RISK_THRESHOLDS_DAYS.critical) risk = 'Critical';
  else if (daysOfSupply <= RISK_THRESHOLDS_DAYS.high) risk = 'High';
  else if (daysOfSupply <= RISK_THRESHOLDS_DAYS.medium) risk = 'Medium';
  else risk = 'Low';
  return {
    risk,
    daysOfSupply: Math.round(daysOfSupply * 10) / 10,
    reason: `At the predicted rate of ${predictedDailyAvg.toFixed(1)} units/day, current stock covers ~${Math.round(daysOfSupply * 10) / 10} day(s).`
  };
};

/* ---------------------------------------------------------------------- */
/* I/O layer                                                              */
/* ---------------------------------------------------------------------- */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ bloodGroup?: string, city?: string, horizonDays?: number, groupIdByType: object }} params
 * @returns Forecast rows, one per blood group (optionally scoped to a city), each with
 *          real current stock, predicted demand, shortage risk, and confidence.
 */
const forecastBloodGroupDemand = (db, params) => {
  const { bloodGroup, city, horizonDays = 7, groupIdByType } = params;
  const bloodTypes = bloodGroup ? [bloodGroup] : Object.keys(groupIdByType);
  const today = new Date();
  const targetDayOfWeek = (today.getDay() + 1) % 7; // forecasting for "tomorrow" as the representative target day

  return bloodTypes.map((type) => {
    let sql = `
      SELECT record_date as date, day_of_week as dayOfWeek, SUM(units_requested) as count
      FROM synthetic_demand_history WHERE blood_group_id = ?`;
    const sqlParams = [groupIdByType[type]];
    if (city) { sql += ' AND city = ?'; sqlParams.push(city); }
    sql += ' GROUP BY record_date, day_of_week ORDER BY record_date ASC';
    const series = db.prepare(sql).all(...sqlParams);

    const forecast = forecastSeries(series, { horizonDays, lookbackDays: 90, targetDayOfWeek });

    // REAL current stock — never synthetic. Optionally scoped to a specific city's banks.
    let stockSql = `
      SELECT COALESCE(SUM(bi.units), 0) as stock FROM blood_inventory bi
      JOIN blood_groups bg ON bg.id = bi.blood_group_id
      JOIN blood_bank_profiles bbp ON bbp.user_id = bi.blood_bank_id
      LEFT JOIN locations loc ON loc.id = bbp.location_id
      WHERE bg.type = ?`;
    const stockParams = [type];
    if (city && !city.includes('synthetic demo city')) { stockSql += ' AND loc.city = ?'; stockParams.push(city); }
    const currentStock = db.prepare(stockSql).get(...stockParams).stock;

    const shortage = classifyShortageRisk(currentStock, forecast.predictedDailyAvg);

    return {
      bloodGroup: type,
      currentStock,
      predictedDemandNextPeriod: forecast.predictedTotal,
      predictedDailyAvg: forecast.predictedDailyAvg,
      horizonDays,
      shortageRisk: shortage.risk,
      daysOfSupply: shortage.daysOfSupply,
      riskReason: shortage.reason,
      confidencePct: forecast.confidencePct,
      dataPointsUsed: forecast.dataPointsUsed,
      method: forecast.method,
      dataSource: 'synthetic' // see file header — flip to 'real' once enough real history accumulates
    };
  });
};

/**
 * High-risk locations: for each city in the synthetic history, forecast
 * total demand and compare to that city's real blood banks' stock (where
 * the city corresponds to a real service area — synthetic-only demo cities
 * fall back to a platform-wide stock comparison, clearly flagged).
 */
const forecastHighRiskLocations = (db, params) => {
  const { horizonDays = 7, groupIdByType } = params;
  const cities = db.prepare('SELECT DISTINCT city FROM synthetic_demand_history ORDER BY city').all().map((r) => r.city);

  return cities.map((city) => {
    const perGroup = forecastBloodGroupDemand(db, { city, horizonDays, groupIdByType });
    const riskWeight = { Critical: 3, High: 2, Medium: 1, Low: 0, Unknown: 0 };
    const riskScore = perGroup.reduce((s, g) => s + (riskWeight[g.shortageRisk] || 0), 0);
    const worst = [...perGroup].sort((a, b) => (riskWeight[b.shortageRisk] || 0) - (riskWeight[a.shortageRisk] || 0))[0];
    const isRealServiceArea = !city.includes('synthetic demo city');
    return {
      city,
      isRealServiceArea,
      riskScore,
      totalPredictedDemand: perGroup.reduce((s, g) => s + g.predictedDemandNextPeriod, 0),
      mostAtRiskBloodGroup: worst ? worst.bloodGroup : null,
      mostAtRiskLevel: worst ? worst.shortageRisk : null,
      groupsInShortage: perGroup.filter((g) => g.shortageRisk === 'Critical' || g.shortageRisk === 'High').map((g) => g.bloodGroup)
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
};

module.exports = {
  MODEL_STRATEGY,
  RISK_THRESHOLDS_DAYS,
  forecastSeries,
  classifyShortageRisk,
  forecastBloodGroupDemand,
  forecastHighRiskLocations
};
