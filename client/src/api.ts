export interface User {
  id: string;
  name: string;
  role: 'Donor' | 'Patient' | 'Hospital' | 'Blood Bank' | 'Admin';
  bloodType: string;
  location: string;
  status: string;
  passportId: string;
  donations: number;
  xp: number;
  isNewRegistration: boolean;
  pendingUpdate: { name: string; location: string; bloodType: string } | null;
  activeCampRegistration: { campTitle: string; verificationId: string; date: string; slot: string } | null;
  licenseNumber?: string;
  accreditationDoc?: string;
  lat?: number | null;
  lng?: number | null;
  telegramChatId?: string | null;
  firebaseUid?: string;
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
}

export type EmergencyStatus =
  | 'Pending' | 'Searching' | 'Donors Notified' | 'Donor Responded'
  | 'Blood Reserved' | 'Fulfilled' | 'Cancelled' | 'Expired';

export interface Emergency {
  id: string;
  patientName: string;
  bloodType: string;
  hospital: string;
  hospitalId?: string | null;
  lat: number;
  lng: number;
  units: number;
  urgency: 'Critical' | 'Urgent' | 'Normal';
  ward: string;
  time: string;
  status: EmergencyStatus | string;
  alerts: number;
  expiresAt?: string | null;
  updatedAt?: string;
}

export interface EmergencyHistoryEntry {
  id: number;
  emergency_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_label: string;
  note: string | null;
  created_at: string;
}

export interface Camp {
  id: string;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location: string;
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  organizer?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  registrationUrl?: string | null;
  registered: number;
  limit: number;
  approved: boolean;
  status: string;
  lat?: number | null;
  lng?: number | null;
  source: 'manual' | 'official_api' | 'web_import';
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceLastUpdated?: string | null;
  verificationStatus: 'Unverified' | 'Verified' | 'Flagged';
  verifiedAt?: string | null;
  updatedAt?: string;
}

export interface CampIngestionRun {
  id: number;
  source: string;
  source_name: string;
  triggered_by: string | null;
  status: 'Running' | 'Completed' | 'Failed';
  fetched_count: number;
  valid_count: number;
  duplicate_count: number;
  invalid_count: number;
  inserted_count: number;
  error_message: string | null;
  log: string[];
  started_at: string;
  finished_at: string | null;
}

export interface RecentDonation {
  id: string;
  donor: string;
  bloodType: string;
  hospital: string;
  time: string;
  status: string;
  details: string;
}

export interface Hospital {
  id: string;
  name: string;
  location: string;
  activeEmergencies: number;
  quotaUsed: number;
  quotaLimit: number;
  status: string;
  lat?: number | null;
  lng?: number | null;
}

export interface BloodBank {
  id: string;
  name: string;
  address: string;
  stock: number;
  activeTransfers: number;
  apiStatus: string;
  stockBreakdown: Record<string, number>;
  lat?: number | null;
  lng?: number | null;
}

export interface Transfer {
  id: string;
  requestingId: string;
  supplyingId: string;
  bloodType: string;
  units: number;
  status: 'Pending' | 'Approved' | 'Declined';
  time: string;
}

export interface Donation {
  id: string;
  donor: string;
  donorId: string | null;
  bloodType: string;
  hospital: string;
  time: string;
  status: string;
  details: string;
  donationDate: string | null;
  channel: 'camp' | 'blood_bank' | 'hospital' | 'unknown';
}

export type NotificationUrgency = 'Critical' | 'Urgent' | 'Normal' | 'Info';
export type NotificationCategory = 'emergency' | 'request_status' | 'reminders' | 'inventory' | 'account';

export interface Notification {
  id: number;
  user_id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  message: string;
  urgency: NotificationUrgency;
  channel: string;
  related_type: string | null;
  related_id: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationPreference {
  category: NotificationCategory;
  label: string;
  locked: boolean; // true = in-app delivery can't be turned off (life-safety / account-security)
  inApp: boolean;
  telegram: boolean;
}

export interface UnreadCount {
  total: number;
  urgent: number;
}

export interface Appointment {
  id: string;
  donor_id: string;
  camp_id: string | null;
  hospital_id: string | null;
  blood_bank_id: string | null;
  scheduled_date: string;
  slot: string | null;
  status: string;
}

export interface CampRegistration {
  id: number;
  camp_id: string;
  donor_id: string;
  verification_id: string;
  slot: string | null;
  status: string;
  camp_title: string;
  camp_date: string;
}

export interface DonorMatch {
  id: number;
  emergency_id: string;
  donor_id: string;
  compatibility_score: number;
  distance_km: number;
  reliability_score: number;
  response_score: number;
  status: string;
}

export interface BloodGroup {
  id: number;
  type: string;
}

export interface BloodAvailabilityResult {
  id: number;
  bloodBankId: string;
  bloodBankName: string;
  bloodGroup: string;
  availableUnits: number;
  availabilityStatus: 'Adequate' | 'Low Stock' | 'Critical' | 'Out of Stock';
  location: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceKm: number | null;
  lastUpdated: string;
  apiStatus: string;
  verificationStatus: string;
  contactPhone: string | null;
}

export interface DonorSearchResult {
  id: string;
  displayName: string;
  bloodGroup: string;
  location: string;
  distanceKm: number | null;
  status: string;
  donationCount: number;
  approxLat?: number | null;
  approxLng?: number | null;
}

export interface SearchPagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LocationOption {
  id: number;
  label: string;
  city: string;
  lat: number;
  lng: number;
}

export interface MatchFactor {
  weight: number;
  score: number;
  reason: string;
  eligible?: boolean;
}

export interface DonorMatchResult {
  donorId: string;
  displayName: string;
  matchScore: number;
  eligible: boolean;
  distanceKm: number | null;
  location: string;
  availabilityStatus: string;
  lastDonationDate: string | null;
  donationCount: number;
  factors: {
    compatibility: MatchFactor;
    distance: MatchFactor;
    availability: MatchFactor;
    eligibility: MatchFactor;
    history: MatchFactor;
    responseRate: MatchFactor;
  };
}

export type MatchingWeights = Partial<{
  compatibility: number;
  distance: number;
  availability: number;
  eligibility: number;
  history: number;
  responseRate: number;
}>;

export interface RankDonorsResponse {
  results: DonorMatchResult[];
  strategy: string;
  weights: Required<MatchingWeights>;
  effectiveRadiusKm: number;
  totalCandidates?: number;
  eligibleCandidates?: number;
}

export interface AnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  bloodGroup?: string;
  city?: string;
  hospitalId?: string;
  bloodBankId?: string;
}

export interface AnalyticsSummaryMetrics {
  totalDonors: number;
  activeDonors: number;
  totalDonations: number;
  successfulDonations: number;
  emergencyRequests: number;
  fulfilledRequests: number;
  unfulfilledRequests: number;
  avgResponseTimeMinutes: number | null;
  totalBloodUnits: number;
  bloodGroupsInShortage: number;
  totalCamps: number;
  campRegistrations: number;
}

export interface AnalyticsDashboard {
  summary: AnalyticsSummaryMetrics;
  monthlyDonationTrends: { month: string; total: number; completed: number }[];
  bloodGroupDemand: { bloodGroup: string; requestCount: number; unitsRequested: number }[];
  bloodGroupAvailability: { bloodGroup: string; unitsAvailable: number; status: string }[];
  emergencyTrends: { week: string; weekStart: string; critical: number; urgent: number; normal: number; total: number }[];
  donationSuccessRate: { byStatus: { status: string; count: number }[]; total: number; completed: number; successRate: number };
  shortagePressureTrend: { shortageGroups: string[]; trend: { week: string; weekStart: string; bloodGroup: string; requestCount: number }[] };
  geographicDistribution: { city: string; donorCount: number; hospitalCount: number; bloodBankCount: number }[];
  hospitalDemand: { hospitalId: string; hospitalName: string; city: string; requestCount: number; unitsRequested: number; fulfilledCount: number; fulfillmentRate: number }[];
  bloodBankInventory: { bloodBankId: string; name: string; city: string; apiStatus: string; totalUnits: number; breakdown: { type: string; units: number }[]; shortageTypes: string[] }[];
  donorEngagement: {
    totalDonors: number;
    donationBuckets: { bucket: string; count: number }[];
    avgDonationsPerDonor: number;
    telegramLinkedPct: number;
    responseStats: { accepted: number; declined: number; awaitingResponse: number };
  };
  filtersApplied: AnalyticsFilters;
  generatedAt: string;
}

export interface AnalyticsFilterOptions {
  bloodGroups: string[];
  cities: string[];
  hospitals: { id: string; name: string }[];
  bloodBanks: { id: string; name: string }[];
}

export interface ForecastResult {
  bloodGroup: string;
  currentStock: number;
  predictedDemandNextPeriod: number;
  predictedDailyAvg: number;
  horizonDays: number;
  shortageRisk: 'Low' | 'Medium' | 'High' | 'Critical' | 'Unknown';
  daysOfSupply: number | null;
  riskReason: string;
  confidencePct: number;
  dataPointsUsed: number;
  method: string;
  dataSource: 'synthetic' | 'real';
}

export interface HighRiskLocation {
  city: string;
  isRealServiceArea: boolean;
  riskScore: number;
  totalPredictedDemand: number;
  mostAtRiskBloodGroup: string | null;
  mostAtRiskLevel: string | null;
  groupsInShortage: string[];
}

export interface ForecastHistoryPoint {
  date: string;
  dayOfWeek: number;
  units: number;
  requests: number;
}

export interface AnalyticsEvent {
  id: number;
  event_type: string;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: any;
  created_at: string;
}
export interface AnalyticsSummary {
  totalUsers: number;
  totalDonors: number;
  totalHospitals: number;
  totalBloodBanks: number;
  totalDonations: number;
  completedDonations: number;
  activeEmergencies: number;
  totalCamps: number;
  eventsLast7Days: number;
}

const handleResponse = async (res: Response) => {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
};

// Session token, set by AuthContext after a successful login/OTP verification. Sent as
// `Authorization: Bearer <token>` on every request (see the fetch wrapper below) — this
// replaces the previous scheme of sending a raw, client-editable actor id/role header,
// which the server trusted with no proof of authentication.
let _sessionToken: string | null = null;
export const setApiActor = (token: string | null) => {
  _sessionToken = token;
};
const authHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ..._sessionToken ? { Authorization: `Bearer ${_sessionToken}` } : {},
});

// A thin wrapper around the global fetch that always attaches the current session's
// Authorization header (when present), for both reads and writes — many GET endpoints
// now require auth too (e.g. a user's own notifications/appointments/donation history).
// Falls back to plain fetch semantics otherwise; callers can still override headers.
const authedFetch = (url: string, options: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });

// Dashboard KPI types
export interface DonorDashboardData {
  stats: { totalDonations: number; xp: number; rank: number | null; totalDonors: number; livesImpact: number; daysSinceLast: number | null; isEligible: boolean; daysUntilEligible: number; lastDonationDate: string | null };
  recentDonations: Donation[];
  upcomingAppointments: Array<Appointment & { camp_title?: string; camp_venue?: string; hospital_name?: string }>;
  campRegistrations: CampRegistration[];
  compatibleEmergencies: Emergency[];
  nearbyCamps: Camp[];
}
export interface HospitalDashboardData {
  kpis: { activeRequests: number; fulfilledTotal: number; thisMonthRequests: number; lastMonthRequests: number; awaitingReserveCount: number; avgFulfillmentMinutes: number | null };
  myEmergencies: Array<Emergency & { blood_type_label?: string }>;
  awaitingReserve: Array<DonorMatch & { blood_type?: string; donor_name?: string }>;
  inventory: Array<{ type: string; total: number }>;
  recentDonations: Donation[];
}
export interface BloodBankDashboardData {
  kpis: { totalUnits: number; lowStockCount: number; criticalCount: number; pendingIncomingTransfers: number; completedTransfers: number; totalDonationsProcessed: number };
  inventory: Array<{ type: string; units: number }>;
  lowStockTypes: string[];
  criticalTypes: string[];
  myTransfers: Array<Transfer & { blood_type?: string; requesting_name?: string; supplying_name?: string }>;
  pendingIncoming: Array<Transfer & { blood_type?: string; requesting_name?: string }>;
  recentDonations: Donation[];
  notifications: Notification[];
  intakeTrend: Array<{ month: string; count: number }>;
}
export interface AdminDashboardData {
  kpis: { totalDonors: number; activeDonors: number; totalHospitals: number; totalBloodBanks: number; activeEmergencyCount: number; fulfillmentRate: number; pendingActionsCount: number; shortageCount: number; totalUnits: number };
  activeEmergencies: Array<Emergency & { blood_type?: string; hospital_name?: string }>;
  pendingOnboarding: User[];
  pendingUpdates: User[];
  pendingCamps: Camp[];
  unverifiedCamps: Camp[];
  shortages: Array<{ type: string; total: number }>;
  inventoryByGroup: Array<{ type: string; total: number }>;
  emergencyTrend: Array<{ day: string; count: number }>;
  donorsByGroup: Array<{ type: string; count: number }>;
}

export const api = {
  // Users APIs
  getUsers: (): Promise<User[]> => 
    authedFetch('/api/users').then(handleResponse),
  
  createUser: (userData: Partial<User> & { password?: string }): Promise<User> =>
    authedFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    }).then(handleResponse),
  
  login: (username: string, password: string): Promise<User & { token: string }> =>
    authedFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(handleResponse),

  // Telegram + Email OTP APIs
  sendOtp: (chatId: string, purpose: 'signup' | 'login', email?: string): Promise<{ sent: boolean; dev?: boolean; devCode?: string }> =>
    authedFetch('/api/auth/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, purpose, email }),
    }).then(handleResponse),

  verifyOtp: (chatId: string, code: string, purpose: 'signup' | 'login'): Promise<{ verified: boolean }> =>
    authedFetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, code, purpose }),
    }).then(handleResponse),

  loginRequestOtp: (username: string, password: string): Promise<{ otpRequired: boolean; userId: string; maskedChat: string; dev?: boolean; devCode?: string }> =>
    authedFetch('/api/auth/login/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(handleResponse),

  loginVerifyOtp: (userId: string, code: string): Promise<User & { token: string }> =>
    authedFetch('/api/auth/login/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, code }),
    }).then(handleResponse),

  updateUser: (id: string, updateData: any): Promise<{ success: boolean }> =>
    authedFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(updateData),
    }).then(handleResponse),

  // Emergencies APIs
  getEmergencies: (): Promise<Emergency[]> =>
    authedFetch('/api/emergencies').then(handleResponse),

  // NLP Pipeline
  parseNLPRequest: (text: string): Promise<any> =>
    fetch('/api/nlp/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(handleResponse),

  getEmergencyHistory: (id: string): Promise<EmergencyHistoryEntry[]> =>
    authedFetch(`/api/emergencies/${id}/history`).then(handleResponse),

  createEmergency: (emerg: Emergency): Promise<{ success: boolean; emergency: Emergency; matchedDonors: number }> =>
    authedFetch('/api/emergencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emerg),
    }).then(handleResponse),

  updateEmergency: (id: string, update: { status?: string; alerts?: number; urgency?: string; actorId?: string; actorLabel?: string }): Promise<{ success: boolean }> =>
    authedFetch(`/api/emergencies/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(update),
    }).then(handleResponse),

  deleteEmergency: (id: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/emergencies/${id}`, {
      method: 'DELETE',
    }).then(handleResponse),

  respondToEmergency: (id: string, donorId: string, response: 'accept' | 'decline'): Promise<{ success: boolean; matchStatus: string }> =>
    authedFetch(`/api/emergencies/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donorId, response }),
    }).then(handleResponse),

  reserveEmergencyDonor: (id: string, donorId: string, actorId?: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/emergencies/${id}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donorId, actorId }),
    }).then(handleResponse),

  fulfillEmergency: (id: string, actorId?: string): Promise<{ success: boolean; donationCreated: boolean }> =>
    authedFetch(`/api/emergencies/${id}/fulfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId }),
    }).then(handleResponse),

  cancelEmergency: (id: string, reason?: string, actorId?: string, actorLabel?: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/emergencies/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, actorId, actorLabel }),
    }).then(handleResponse),

  // Camps APIs
  getCamps: (): Promise<Camp[]> =>
    authedFetch('/api/camps').then(handleResponse),

  createCamp: (camp: Partial<Camp>): Promise<{ success: boolean }> =>
    authedFetch('/api/camps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(camp),
    }).then(handleResponse),

  updateCamp: (id: string, update: { approved?: boolean; registered?: number; status?: string }): Promise<{ success: boolean }> =>
    authedFetch(`/api/camps/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(update),
    }).then(handleResponse),

  verifyCamp: (id: string, verificationStatus: 'Verified' | 'Flagged' | 'Unverified', verifiedBy?: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/camps/${id}/verify`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ verificationStatus, verifiedBy }),
    }).then(handleResponse),

  ingestCamps: (source: 'official_api' | 'web_import', triggeredBy?: string): Promise<{
    runId: number; status: string; fetched?: number; valid?: number; duplicate?: number; invalid?: number; inserted?: number;
    insertedCamps?: { id: string; title: string }[]; log?: string[]; reason?: string;
  }> =>
    authedFetch('/api/camps/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, triggeredBy }),
    }).then(handleResponse),

  getIngestionRuns: (): Promise<CampIngestionRun[]> =>
    authedFetch('/api/camps/ingestion/runs').then(handleResponse),

  // Recent Donations APIs
  getRecentDonations: (): Promise<RecentDonation[]> =>
    authedFetch('/api/recent_donations').then(handleResponse),

  createRecentDonation: (donation: RecentDonation): Promise<{ success: boolean }> =>
    authedFetch('/api/recent_donations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donation),
    }).then(handleResponse),

  // Hospitals APIs
  getHospitals: (): Promise<Hospital[]> =>
    authedFetch('/api/hospitals').then(handleResponse),

  createHospital: (hosp: Hospital): Promise<{ success: boolean }> =>
    authedFetch('/api/hospitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hosp),
    }).then(handleResponse),

  updateHospital: (id: string, update: { activeEmergencies?: number; quotaUsed?: number; quotaLimit?: number; status?: string }): Promise<{ success: boolean }> =>
    authedFetch(`/api/hospitals/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(update),
    }).then(handleResponse),

  // Blood Banks APIs
  getBloodBanks: (): Promise<BloodBank[]> =>
    authedFetch('/api/blood_banks').then(handleResponse),

  updateBloodBank: (id: string, update: { stock?: number; activeTransfers?: number; apiStatus?: string; stockBreakdown?: Record<string, number> }): Promise<{ success: boolean }> =>
    authedFetch(`/api/blood_banks/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(update),
    }).then(handleResponse),

  // Transfers APIs
  getTransfers: (): Promise<Transfer[]> =>
    authedFetch('/api/transfers').then(handleResponse),

  createTransfer: (transfer: { requestingId: string; supplyingId: string; bloodType: string; units: number }): Promise<Transfer> =>
    authedFetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transfer),
    }).then(handleResponse),

  updateTransfer: (id: string, update: { status: 'Approved' | 'Declined' }): Promise<{ success: boolean }> =>
    authedFetch(`/api/transfers/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(update),
    }).then(handleResponse),

  approveTransfer: (id: string, actorId?: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/transfers/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'Approved', actorId }),
    }).then(handleResponse),

  declineTransfer: (id: string, actorId?: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/transfers/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'Declined', actorId }),
    }).then(handleResponse),

  // Donations APIs (real donation history — replaces any hardcoded history)
  getDonations: (donorId?: string): Promise<Donation[]> =>
    authedFetch(`/api/donations${donorId ? `?donor_id=${donorId}` : ''}`).then(handleResponse),

  // Notifications APIs
  getNotifications: (userId: string, opts?: { unreadOnly?: boolean }): Promise<Notification[]> =>
    authedFetch(`/api/notifications?user_id=${userId}${opts?.unreadOnly ? '&unread_only=true' : ''}`).then(handleResponse),

  getUnreadCount: (userId: string): Promise<UnreadCount> =>
    authedFetch(`/api/notifications/unread-count?user_id=${userId}`).then(handleResponse),

  createNotification: (n: { userId: string; type?: string; title: string; message: string; relatedType?: string; relatedId?: string; urgency?: NotificationUrgency }): Promise<{ success: boolean }> =>
    authedFetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n),
    }).then(handleResponse),

  markNotificationRead: (id: number): Promise<{ success: boolean }> =>
    authedFetch(`/api/notifications/${id}`, { method: 'PUT' }).then(handleResponse),

  markAllNotificationsRead: (userId: string): Promise<{ success: boolean }> =>
    authedFetch('/api/notifications/read-all', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ userId }),
    }).then(handleResponse),

  // Notification preferences APIs
  getNotificationPreferences: (userId: string): Promise<NotificationPreference[]> =>
    authedFetch(`/api/notification-preferences?user_id=${userId}`).then(handleResponse),

  setNotificationPreference: (p: { userId: string; category: NotificationCategory; inApp?: boolean; telegram?: boolean }): Promise<NotificationPreference> =>
    authedFetch('/api/notification-preferences', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(p),
    }).then(handleResponse),

  // Appointments APIs
  getAppointments: (donorId?: string): Promise<Appointment[]> =>
    authedFetch(`/api/appointments${donorId ? `?donor_id=${donorId}` : ''}`).then(handleResponse),

  createAppointment: (a: { donorId: string; campId?: string; hospitalId?: string; bloodBankId?: string; scheduledDate: string; slot?: string }): Promise<{ success: boolean; id: string }> =>
    authedFetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    }).then(handleResponse),

  updateAppointment: (id: string, status: string): Promise<{ success: boolean }> =>
    authedFetch(`/api/appointments/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    }).then(handleResponse),

  // Camp Registrations APIs
  getCampRegistrations: (params: { donorId?: string; campId?: string } = {}): Promise<CampRegistration[]> => {
    const q = new URLSearchParams();
    if (params.donorId) q.set('donor_id', params.donorId);
    if (params.campId) q.set('camp_id', params.campId);
    const qs = q.toString();
    return authedFetch(`/api/camp_registrations${qs ? `?${qs}` : ''}`).then(handleResponse);
  },

  registerForCamp: (campId: string, donorId: string, slot?: string): Promise<{ success: boolean; verificationId: string }> =>
    authedFetch('/api/camp_registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campId, donorId, slot }),
    }).then(handleResponse),

  // Donor Matches APIs (persists AI Match results for audit/history)
  getDonorMatches: (emergencyId?: string): Promise<DonorMatch[]> =>
    authedFetch(`/api/donor_matches${emergencyId ? `?emergency_id=${emergencyId}` : ''}`).then(handleResponse),

  submitDonorMatches: (emergencyId: string | null, matches: Array<{ donorId: string; compatibilityScore: number; distanceKm: number; reliabilityScore: number; responseScore: number }>): Promise<{ success: boolean }> =>
    authedFetch('/api/donor_matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergencyId, matches }),
    }).then(handleResponse),

  // Blood Groups lookup
  getBloodGroups: (): Promise<BloodGroup[]> =>
    authedFetch('/api/blood_groups').then(handleResponse),

  // Analytics APIs
  logAnalyticsEvent: (e: { eventType: string; userId?: string; entityType?: string; entityId?: string; metadata?: any }): Promise<{ success: boolean }> =>
    authedFetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e),
    }).then(handleResponse),

  getAnalyticsSummary: (): Promise<AnalyticsSummary> =>
    authedFetch('/api/analytics/summary').then(handleResponse),

  getAnalyticsEvents: (eventType?: string, limit?: number): Promise<AnalyticsEvent[]> => {
    const q = new URLSearchParams();
    if (eventType) q.set('event_type', eventType);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return authedFetch(`/api/analytics/events${qs ? `?${qs}` : ''}`).then(handleResponse);
  },

  // ---- Find Blood: real, server-filtered/sorted/paginated search ----
  searchBloodAvailability: (params: {
    bloodGroup?: string; bloodBankId?: string; availability?: string;
    lat?: number; lng?: number; radiusKm?: number;
    sortBy?: 'distance' | 'units' | 'updated' | 'bank'; sortDir?: 'asc' | 'desc';
    page?: number; pageSize?: number;
  }): Promise<{ results: BloodAvailabilityResult[]; pagination: SearchPagination }> => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
    return authedFetch(`/api/search/blood-availability?${q.toString()}`).then(handleResponse);
  },

  searchDonors: (params: {
    bloodGroup?: string; lat?: number; lng?: number; radiusKm?: number;
    availableOnly?: boolean; sortBy?: 'distance' | 'donations'; page?: number; pageSize?: number;
  }): Promise<{ results: DonorSearchResult[]; pagination: SearchPagination }> => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
    return authedFetch(`/api/search/donors?${q.toString()}`).then(handleResponse);
  },

  getLocations: (): Promise<LocationOption[]> =>
    authedFetch('/api/locations').then(handleResponse),

  // ---- Explainable donor matching / ranking service ----
  rankDonors: (params: {
    bloodType: string; urgency?: 'Critical' | 'Urgent' | 'Normal'; lat?: number; lng?: number;
    radiusKm?: number; limit?: number; weights?: MatchingWeights; emergencyId?: string; persist?: boolean;
  }): Promise<RankDonorsResponse> =>
    authedFetch('/api/matching/rank-donors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then(handleResponse),

  getMatchingWeights: (): Promise<{ weights: Required<MatchingWeights>; strategy: string }> =>
    authedFetch('/api/matching/weights').then(handleResponse),

  // ---- Comprehensive analytics dashboard ----
  getAnalyticsDashboard: (filters: AnalyticsFilters = {}): Promise<AnalyticsDashboard> => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
    const qs = q.toString();
    return authedFetch(`/api/analytics/dashboard${qs ? `?${qs}` : ''}`).then(handleResponse);
  },

  getAnalyticsFilterOptions: (): Promise<AnalyticsFilterOptions> =>
    authedFetch('/api/analytics/filter-options').then(handleResponse),

  // ---- Blood demand forecasting (estimates — not medical advice; see disclaimer field) ----
  getDemandForecast: (params: { bloodGroup?: string; city?: string; horizonDays?: number } = {}): Promise<{ results: ForecastResult[]; disclaimer: string; generatedAt: string }> => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) q.set(k, String(v)); });
    const qs = q.toString();
    return authedFetch(`/api/forecast/demand${qs ? `?${qs}` : ''}`).then(handleResponse);
  },

  getHighRiskLocations: (horizonDays?: number): Promise<{ results: HighRiskLocation[]; disclaimer: string; generatedAt: string }> =>
    authedFetch(`/api/forecast/high-risk-locations${horizonDays ? `?horizonDays=${horizonDays}` : ''}`).then(handleResponse),

  getForecastHistory: (bloodGroup: string, city?: string, days?: number): Promise<{ history: ForecastHistoryPoint[]; isSynthetic: boolean; disclaimer: string }> => {
    const q = new URLSearchParams({ bloodGroup });
    if (city) q.set('city', city);
    if (days) q.set('days', String(days));
    return authedFetch(`/api/forecast/history?${q.toString()}`, { headers: authHeaders() }).then(handleResponse);
  },

  // ---- Role-scoped dashboard KPI endpoints ----
  getDonorDashboard: (): Promise<DonorDashboardData> =>
    authedFetch('/api/dashboard/donor', { headers: authHeaders() }).then(handleResponse),

  getHospitalDashboard: (): Promise<HospitalDashboardData> =>
    authedFetch('/api/dashboard/hospital', { headers: authHeaders() }).then(handleResponse),

  getBloodBankDashboard: (): Promise<BloodBankDashboardData> =>
    authedFetch('/api/dashboard/bloodbank', { headers: authHeaders() }).then(handleResponse),

  getAdminDashboard: (): Promise<AdminDashboardData> =>
    authedFetch('/api/dashboard/admin', { headers: authHeaders() }).then(handleResponse),
};
