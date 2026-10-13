/* ==========================================================================
   LifeLink Analytics Service
   --------------------------------------------------------------------------
   Every function here runs a real query against the live database — nothing
   in this file is hardcoded or simulated. Functions are organized so each
   one answers exactly one question and can be reused/tested independently.

   Filters (all optional):
     dateFrom, dateTo   ISO date strings (inclusive), applied to the
                        relevant date column per metric (donation_date,
                        emergency created_at, camp_date, etc.)
     bloodGroup         e.g. 'O+' — applied wherever the metric has a blood
                        group dimension
     city               matches donors/hospitals/blood banks/camps by city
     hospitalId         restricts to a specific hospital
     bloodBankId        restricts to a specific blood bank

   Not every filter is meaningful for every metric (e.g. "blood bank" has
   no effect on "total registered donors") — each function only applies the
   filters that apply to the table(s) it queries.
   ========================================================================== */

const SHORTAGE_THRESHOLDS = { outOfStock: 0, critical: 10, low: 25 };

const classifyStock = (units) => {
  if (units <= SHORTAGE_THRESHOLDS.outOfStock) return 'Out of Stock';
  if (units <= SHORTAGE_THRESHOLDS.critical) return 'Critical';
  if (units <= SHORTAGE_THRESHOLDS.low) return 'Low';
  return 'Adequate';
};

// Builds a "column BETWEEN ? AND ?" style clause, only including the parts
// that were actually provided, so callers can pass a filters object straight
// through without every query needing its own presence checks.
const dateRangeClause = (column, dateFrom, dateTo) => {
  const clauses = [];
  const params = [];
  if (dateFrom) { clauses.push(`${column} >= ?`); params.push(dateFrom); }
  if (dateTo) { clauses.push(`${column} <= ?`); params.push(dateTo + ' 23:59:59'); }
  return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
};

/* ---------------------------------------------------------------------- */
/* 1. Summary metrics                                                     */
/* ---------------------------------------------------------------------- */

const getSummaryMetrics = (db, filters = {}) => {
  const { dateFrom, dateTo, bloodGroup, city, hospitalId, bloodBankId } = filters;

  const totalDonors = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'Donor'").get().c;
  const activeDonors = db
    .prepare(
      `SELECT COUNT(*) c FROM users u JOIN donor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'Donor' AND dp.availability_status IN ('Active', 'On Duty')`
    )
    .get().c;

  // Donations
  const donDate = dateRangeClause('d.donation_date', dateFrom, dateTo);
  let donSql = `SELECT d.status, COUNT(*) c FROM donations d JOIN blood_groups bg ON bg.id = d.blood_group_id WHERE 1=1${donDate.clause}`;
  const donParams = [...donDate.params];
  if (bloodGroup) { donSql += ' AND bg.type = ?'; donParams.push(bloodGroup); }
  donSql += ' GROUP BY d.status';
  const donationsByStatus = db.prepare(donSql).all(...donParams);
  const totalDonations = donationsByStatus.reduce((s, r) => s + r.c, 0);
  const successfulDonations = donationsByStatus.find((r) => r.status === 'Completed')?.c || 0;

  // Emergencies
  const emgDate = dateRangeClause('e.created_at', dateFrom, dateTo);
  let emgSql = `SELECT e.status, COUNT(*) c FROM emergencies e JOIN blood_groups bg ON bg.id = e.blood_group_id WHERE 1=1${emgDate.clause}`;
  const emgParams = [...emgDate.params];
  if (bloodGroup) { emgSql += ' AND bg.type = ?'; emgParams.push(bloodGroup); }
  if (hospitalId) { emgSql += ' AND e.hospital_id = ?'; emgParams.push(hospitalId); }
  emgSql += ' GROUP BY e.status';
  const emergenciesByStatus = db.prepare(emgSql).all(...emgParams);
  const emergencyRequests = emergenciesByStatus.reduce((s, r) => s + r.c, 0);
  const fulfilledRequests = emergenciesByStatus.find((r) => r.status === 'Fulfilled')?.c || 0;
  const unfulfilledRequests = emergenciesByStatus
    .filter((r) => ['Cancelled', 'Expired'].includes(r.status))
    .reduce((s, r) => s + r.c, 0);

  // Average response time (created -> Fulfilled), in minutes, real durations from real timestamps
  let respSql = `SELECT e.created_at, e.updated_at FROM emergencies e JOIN blood_groups bg ON bg.id = e.blood_group_id WHERE e.status = 'Fulfilled'${emgDate.clause}`;
  const respParams = [...emgDate.params];
  if (bloodGroup) { respSql += ' AND bg.type = ?'; respParams.push(bloodGroup); }
  if (hospitalId) { respSql += ' AND e.hospital_id = ?'; respParams.push(hospitalId); }
  const fulfilledRows = db.prepare(respSql).all(...respParams);
  const durationsMin = fulfilledRows
    .map((r) => (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 60000)
    .filter((m) => Number.isFinite(m) && m >= 0);
  const avgResponseTimeMinutes = durationsMin.length
    ? Math.round(durationsMin.reduce((s, m) => s + m, 0) / durationsMin.length)
    : null;

  // Blood inventory
  let invSql = `
    SELECT bg.type, SUM(bi.units) units FROM blood_inventory bi
    JOIN blood_groups bg ON bg.id = bi.blood_group_id
    JOIN blood_bank_profiles bbp ON bbp.user_id = bi.blood_bank_id
    LEFT JOIN locations loc ON loc.id = bbp.location_id
    WHERE 1=1`;
  const invParams = [];
  if (bloodGroup) { invSql += ' AND bg.type = ?'; invParams.push(bloodGroup); }
  if (bloodBankId) { invSql += ' AND bi.blood_bank_id = ?'; invParams.push(bloodBankId); }
  if (city) { invSql += ' AND loc.city = ?'; invParams.push(city); }
  invSql += ' GROUP BY bg.type';
  const inventoryByGroup = db.prepare(invSql).all(...invParams);
  const totalBloodUnits = inventoryByGroup.reduce((s, r) => s + (r.units || 0), 0);
  const shortageGroups = inventoryByGroup.filter((r) => classifyStock(r.units) === 'Critical' || classifyStock(r.units) === 'Out of Stock').length;

  // Camps
  const campDate = dateRangeClause('c.camp_date', dateFrom, dateTo);
  let campSql = `SELECT COUNT(*) c, COALESCE(SUM(c.registered_count),0) regs FROM camps c WHERE c.status != 'Rejected'${campDate.clause}`;
  const campParams = [...campDate.params];
  if (city) { campSql += ' AND c.city = ?'; campParams.push(city); }
  const campRow = db.prepare(campSql).get(...campParams);

  return {
    totalDonors,
    activeDonors,
    totalDonations,
    successfulDonations,
    emergencyRequests,
    fulfilledRequests,
    unfulfilledRequests,
    avgResponseTimeMinutes,
    totalBloodUnits,
    bloodGroupsInShortage: shortageGroups,
    totalCamps: campRow.c,
    campRegistrations: campRow.regs
  };
};

/* ---------------------------------------------------------------------- */
/* 2. Monthly donation trends                                             */
/* ---------------------------------------------------------------------- */

const getMonthlyDonationTrends = (db, filters = {}) => {
  const { dateFrom, dateTo, bloodGroup } = filters;
  const range = dateRangeClause('d.donation_date', dateFrom, dateTo);
  let sql = `
    SELECT strftime('%Y-%m', d.donation_date) as month, COUNT(*) as total,
           SUM(CASE WHEN d.status = 'Completed' THEN 1 ELSE 0 END) as completed
    FROM donations d JOIN blood_groups bg ON bg.id = d.blood_group_id
    WHERE d.donation_date IS NOT NULL${range.clause}`;
  const params = [...range.params];
  if (bloodGroup) { sql += ' AND bg.type = ?'; params.push(bloodGroup); }
  sql += ' GROUP BY month ORDER BY month ASC';
  return db.prepare(sql).all(...params);
};

/* ---------------------------------------------------------------------- */
/* 3 & 4. Blood group demand & availability                               */
/* ---------------------------------------------------------------------- */

const getBloodGroupDemand = (db, filters = {}) => {
  const { dateFrom, dateTo, city, hospitalId } = filters;
  const range = dateRangeClause('e.created_at', dateFrom, dateTo);
  let sql = `
    SELECT bg.type as bloodGroup, COUNT(*) as requestCount, COALESCE(SUM(e.units_needed),0) as unitsRequested
    FROM emergencies e JOIN blood_groups bg ON bg.id = e.blood_group_id
    WHERE 1=1${range.clause}`;
  const params = [...range.params];
  if (hospitalId) { sql += ' AND e.hospital_id = ?'; params.push(hospitalId); }
  if (city) {
    sql += ` AND e.hospital_id IN (SELECT hp.user_id FROM hospital_profiles hp LEFT JOIN locations loc ON loc.id = hp.location_id WHERE loc.city = ?)`;
    params.push(city);
  }
  sql += ' GROUP BY bg.type ORDER BY requestCount DESC';
  return db.prepare(sql).all(...params);
};

const getBloodGroupAvailability = (db, filters = {}) => {
  const { city, bloodBankId } = filters;
  let sql = `
    SELECT bg.type as bloodGroup, SUM(bi.units) as unitsAvailable
    FROM blood_inventory bi
    JOIN blood_groups bg ON bg.id = bi.blood_group_id
    JOIN blood_bank_profiles bbp ON bbp.user_id = bi.blood_bank_id
    LEFT JOIN locations loc ON loc.id = bbp.location_id
    WHERE 1=1`;
  const params = [];
  if (bloodBankId) { sql += ' AND bi.blood_bank_id = ?'; params.push(bloodBankId); }
  if (city) { sql += ' AND loc.city = ?'; params.push(city); }
  sql += ' GROUP BY bg.type ORDER BY bg.type';
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, status: classifyStock(r.unitsAvailable) }));
};

/* ---------------------------------------------------------------------- */
/* 5. Emergency request trends (weekly, by urgency)                       */
/* ---------------------------------------------------------------------- */

const getEmergencyTrends = (db, filters = {}) => {
  const { dateFrom, dateTo, bloodGroup, hospitalId, city } = filters;
  const range = dateRangeClause('e.created_at', dateFrom, dateTo);
  let sql = `
    SELECT strftime('%Y-%W', e.created_at) as week,
           MIN(date(e.created_at)) as weekStart,
           SUM(CASE WHEN e.urgency = 'Critical' THEN 1 ELSE 0 END) as critical,
           SUM(CASE WHEN e.urgency = 'Urgent' THEN 1 ELSE 0 END) as urgent,
           SUM(CASE WHEN e.urgency = 'Normal' THEN 1 ELSE 0 END) as normal,
           COUNT(*) as total
    FROM emergencies e JOIN blood_groups bg ON bg.id = e.blood_group_id
    WHERE 1=1${range.clause}`;
  const params = [...range.params];
  if (bloodGroup) { sql += ' AND bg.type = ?'; params.push(bloodGroup); }
  if (hospitalId) { sql += ' AND e.hospital_id = ?'; params.push(hospitalId); }
  if (city) {
    sql += ` AND e.hospital_id IN (SELECT hp.user_id FROM hospital_profiles hp LEFT JOIN locations loc ON loc.id = hp.location_id WHERE loc.city = ?)`;
    params.push(city);
  }
  sql += ' GROUP BY week ORDER BY week ASC';
  return db.prepare(sql).all(...params);
};

/* ---------------------------------------------------------------------- */
/* 6. Donation success rate                                               */
/* ---------------------------------------------------------------------- */

const getDonationSuccessRate = (db, filters = {}) => {
  const { dateFrom, dateTo, bloodGroup } = filters;
  const range = dateRangeClause('d.donation_date', dateFrom, dateTo);
  let sql = `
    SELECT d.status, COUNT(*) as count FROM donations d JOIN blood_groups bg ON bg.id = d.blood_group_id
    WHERE 1=1${range.clause}`;
  const params = [...range.params];
  if (bloodGroup) { sql += ' AND bg.type = ?'; params.push(bloodGroup); }
  sql += ' GROUP BY d.status';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const completed = rows.find((r) => r.status === 'Completed')?.count || 0;
  return {
    byStatus: rows,
    total,
    completed,
    successRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0
  };
};

/* ---------------------------------------------------------------------- */
/* 7. Shortage-pressure trend                                             */
/* ---------------------------------------------------------------------- */
// NOTE: blood_inventory only stores current stock, not historical snapshots,
// so a true "stock over time" trend isn't available from real data. Instead
// this shows real weekly emergency-demand volume for blood groups that are
// CURRENTLY in short supply — a genuine, honestly-labeled proxy signal for
// where shortage pressure is building, rather than a fabricated stock history.
const getShortagePressureTrend = (db, filters = {}) => {
  const availability = getBloodGroupAvailability(db, filters);
  const shortGroups = availability.filter((a) => a.status === 'Critical' || a.status === 'Out of Stock').map((a) => a.bloodGroup);
  if (shortGroups.length === 0) return { shortageGroups: [], trend: [] };

  const { dateFrom, dateTo } = filters;
  const range = dateRangeClause('e.created_at', dateFrom, dateTo);
  const placeholders = shortGroups.map(() => '?').join(',');
  const sql = `
    SELECT strftime('%Y-%W', e.created_at) as week, MIN(date(e.created_at)) as weekStart, bg.type as bloodGroup, COUNT(*) as requestCount
    FROM emergencies e JOIN blood_groups bg ON bg.id = e.blood_group_id
    WHERE bg.type IN (${placeholders})${range.clause}
    GROUP BY week, bg.type ORDER BY week ASC`;
  const rows = db.prepare(sql).all(...shortGroups, ...range.params);
  return { shortageGroups: shortGroups, trend: rows };
};

/* ---------------------------------------------------------------------- */
/* 8. Geographic distribution                                             */
/* ---------------------------------------------------------------------- */

const getGeographicDistribution = (db, filters = {}) => {
  const { bloodGroup } = filters;
  let donorSql = `
    SELECT COALESCE(loc.city, 'Unknown') as city, COUNT(*) as donorCount
    FROM users u LEFT JOIN locations loc ON loc.id = u.location_id
    LEFT JOIN donor_profiles dp ON dp.user_id = u.id
    WHERE u.role = 'Donor'`;
  const donorParams = [];
  if (bloodGroup) {
    donorSql += ' AND dp.blood_group_id = (SELECT id FROM blood_groups WHERE type = ?)';
    donorParams.push(bloodGroup);
  }
  donorSql += ' GROUP BY city ORDER BY donorCount DESC';
  const donorsByCity = db.prepare(donorSql).all(...donorParams);

  const hospitalsByCity = db.prepare(`
    SELECT COALESCE(loc.city, 'Unknown') as city, COUNT(*) as hospitalCount
    FROM hospital_profiles hp LEFT JOIN locations loc ON loc.id = hp.location_id
    GROUP BY city ORDER BY hospitalCount DESC
  `).all();

  const banksByCity = db.prepare(`
    SELECT COALESCE(loc.city, 'Unknown') as city, COUNT(*) as bloodBankCount
    FROM blood_bank_profiles bbp LEFT JOIN locations loc ON loc.id = bbp.location_id
    GROUP BY city ORDER BY bloodBankCount DESC
  `).all();

  const cities = Array.from(new Set([
    ...donorsByCity.map((r) => r.city),
    ...hospitalsByCity.map((r) => r.city),
    ...banksByCity.map((r) => r.city)
  ]));

  return cities.map((city) => ({
    city,
    donorCount: donorsByCity.find((r) => r.city === city)?.donorCount || 0,
    hospitalCount: hospitalsByCity.find((r) => r.city === city)?.hospitalCount || 0,
    bloodBankCount: banksByCity.find((r) => r.city === city)?.bloodBankCount || 0
  })).sort((a, b) => b.donorCount - a.donorCount);
};

/* ---------------------------------------------------------------------- */
/* 9. Hospital demand                                                     */
/* ---------------------------------------------------------------------- */

const getHospitalDemand = (db, filters = {}) => {
  const { dateFrom, dateTo, bloodGroup } = filters;
  const range = dateRangeClause('e.created_at', dateFrom, dateTo);
  let sql = `
    SELECT u.id as hospitalId, u.name as hospitalName, COALESCE(loc.city, 'Unknown') as city,
           COUNT(*) as requestCount, COALESCE(SUM(e.units_needed),0) as unitsRequested,
           SUM(CASE WHEN e.status = 'Fulfilled' THEN 1 ELSE 0 END) as fulfilledCount
    FROM emergencies e
    JOIN hospital_profiles hp ON hp.user_id = e.hospital_id
    JOIN users u ON u.id = hp.user_id
    LEFT JOIN locations loc ON loc.id = hp.location_id
    JOIN blood_groups bg ON bg.id = e.blood_group_id
    WHERE 1=1${range.clause}`;
  const params = [...range.params];
  if (bloodGroup) { sql += ' AND bg.type = ?'; params.push(bloodGroup); }
  sql += ' GROUP BY u.id ORDER BY requestCount DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({ ...r, fulfillmentRate: r.requestCount > 0 ? Math.round((r.fulfilledCount / r.requestCount) * 100) : 0 }));
};

/* ---------------------------------------------------------------------- */
/* 10. Blood bank inventory summary                                       */
/* ---------------------------------------------------------------------- */

const getBloodBankInventory = (db, filters = {}) => {
  const { city, bloodBankId } = filters;
  let bankSql = `
    SELECT u.id, u.name, COALESCE(loc.city, 'Unknown') as city, bbp.api_status
    FROM blood_bank_profiles bbp JOIN users u ON u.id = bbp.user_id
    LEFT JOIN locations loc ON loc.id = bbp.location_id
    WHERE 1=1`;
  const bankParams = [];
  if (bloodBankId) { bankSql += ' AND u.id = ?'; bankParams.push(bloodBankId); }
  if (city) { bankSql += ' AND loc.city = ?'; bankParams.push(city); }
  const banks = db.prepare(bankSql).all(...bankParams);

  const invStmt = db.prepare(`
    SELECT bg.type, bi.units FROM blood_inventory bi JOIN blood_groups bg ON bg.id = bi.blood_group_id WHERE bi.blood_bank_id = ?
  `);
  return banks.map((b) => {
    const inv = invStmt.all(b.id);
    const totalUnits = inv.reduce((s, r) => s + r.units, 0);
    const shortageTypes = inv.filter((r) => classifyStock(r.units) === 'Critical' || classifyStock(r.units) === 'Out of Stock').map((r) => r.type);
    return { bloodBankId: b.id, name: b.name, city: b.city, apiStatus: b.api_status, totalUnits, breakdown: inv, shortageTypes };
  });
};

/* ---------------------------------------------------------------------- */
/* 11. Donor engagement                                                   */
/* ---------------------------------------------------------------------- */

const getDonorEngagement = (db, filters = {}) => {
  const { bloodGroup, city } = filters;
  let sql = `
    SELECT u.total_donations, u.xp, u.telegram_chat_id, COALESCE(loc.city,'Unknown') as city
    FROM users u LEFT JOIN donor_profiles dp ON dp.user_id = u.id LEFT JOIN locations loc ON loc.id = u.location_id
    WHERE u.role = 'Donor'`;
  const params = [];
  if (bloodGroup) {
    sql += ' AND dp.blood_group_id = (SELECT id FROM blood_groups WHERE type = ?)';
    params.push(bloodGroup);
  }
  if (city) { sql += ' AND loc.city = ?'; params.push(city); }
  const donors = db.prepare(sql).all(...params);

  const buckets = { '0': 0, '1-2': 0, '3-5': 0, '6-10': 0, '10+': 0 };
  donors.forEach((d) => {
    const n = d.total_donations || 0;
    if (n === 0) buckets['0']++;
    else if (n <= 2) buckets['1-2']++;
    else if (n <= 5) buckets['3-5']++;
    else if (n <= 10) buckets['6-10']++;
    else buckets['10+']++;
  });

  const telegramLinked = donors.filter((d) => d.telegram_chat_id).length;
  const totalDonations = donors.reduce((s, d) => s + (d.total_donations || 0), 0);

  // Real response-rate signal, from actual donor_matches outcomes
  const responseRow = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('Accepted','Reserved','Donated') THEN 1 ELSE 0 END) as accepted,
      SUM(CASE WHEN status = 'Declined' THEN 1 ELSE 0 END) as declined,
      SUM(CASE WHEN status = 'Notified' THEN 1 ELSE 0 END) as awaitingResponse
    FROM donor_matches
  `).get();

  return {
    totalDonors: donors.length,
    donationBuckets: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
    avgDonationsPerDonor: donors.length > 0 ? Math.round((totalDonations / donors.length) * 10) / 10 : 0,
    telegramLinkedPct: donors.length > 0 ? Math.round((telegramLinked / donors.length) * 100) : 0,
    responseStats: {
      accepted: responseRow.accepted || 0,
      declined: responseRow.declined || 0,
      awaitingResponse: responseRow.awaitingResponse || 0
    }
  };
};

/* ---------------------------------------------------------------------- */
/* Aggregator                                                             */
/* ---------------------------------------------------------------------- */

const getFullDashboard = (db, filters = {}) => ({
  summary: getSummaryMetrics(db, filters),
  monthlyDonationTrends: getMonthlyDonationTrends(db, filters),
  bloodGroupDemand: getBloodGroupDemand(db, filters),
  bloodGroupAvailability: getBloodGroupAvailability(db, filters),
  emergencyTrends: getEmergencyTrends(db, filters),
  donationSuccessRate: getDonationSuccessRate(db, filters),
  shortagePressureTrend: getShortagePressureTrend(db, filters),
  geographicDistribution: getGeographicDistribution(db, filters),
  hospitalDemand: getHospitalDemand(db, filters),
  bloodBankInventory: getBloodBankInventory(db, filters),
  donorEngagement: getDonorEngagement(db, filters),
  filtersApplied: filters,
  generatedAt: new Date().toISOString()
});

module.exports = {
  classifyStock,
  dateRangeClause,
  getSummaryMetrics,
  getMonthlyDonationTrends,
  getBloodGroupDemand,
  getBloodGroupAvailability,
  getEmergencyTrends,
  getDonationSuccessRate,
  getShortagePressureTrend,
  getGeographicDistribution,
  getHospitalDemand,
  getBloodBankInventory,
  getDonorEngagement,
  getFullDashboard
};
