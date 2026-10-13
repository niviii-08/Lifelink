import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';
import type { BloodAvailabilityResult, DonorSearchResult, SearchPagination, LocationOption, Hospital, BloodBank } from '../api';
import { useGeolocation, formatDistance } from '../utils/geo';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RADIUS_OPTIONS = [
  { label: 'Any distance', value: '' },
  { label: 'Within 5 km', value: '5' },
  { label: 'Within 10 km', value: '10' },
  { label: 'Within 20 km', value: '20' },
  { label: 'Within 50 km', value: '50' }
];

const statusBadgeClass = (status: string) => {
  if (status === 'Critical' || status === 'Out of Stock') return 'b-crit';
  if (status === 'Low Stock') return 'b-urg';
  return 'b-ok';
};
const statusBarColor = (status: string) => {
  if (status === 'Critical' || status === 'Out of Stock') return 'var(--red)';
  if (status === 'Low Stock') return 'var(--or)';
  return 'var(--green)';
};

const timeAgo = (iso: string) => {
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export const FindBlood: React.FC = () => {
  const { user, isLoggedIn } = useAuth();
  const { routeState, navigateTo } = useRouting();
  const { showToast } = useToast();
  const { effectiveCoords, isUsingFallback, status: geoStatus, requestLocation } = useGeolocation();
  const [anchor, setAnchor] = useState<{ kind: 'hospital' | 'location'; id: string; label: string; lat: number; lng: number } | null>(null);
  const anchorCoords = anchor ? { lat: anchor.lat, lng: anchor.lng } : effectiveCoords;

  // ---- Filters ----
  const [bloodGroup, setBloodGroup] = useState('');
  const [bloodBankId, setBloodBankId] = useState('');
  const [availability, setAvailability] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [urgency, setUrgency] = useState<'Normal' | 'Urgent' | 'Critical'>('Normal');
  const [sortBy, setSortBy] = useState<'distance' | 'units' | 'updated' | 'bank'>('distance');
  const [page, setPage] = useState(1);
  const pageSize = 6;

  // ---- Reference data for filter dropdowns ----
  const [bloodBankOptions, setBloodBankOptions] = useState<BloodBank[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  // ---- Primary search: blood bank availability ----
  const [results, setResults] = useState<BloodAvailabilityResult[]>([]);
  const [pagination, setPagination] = useState<SearchPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Secondary search: nearby compatible donors ----
  const [donorResults, setDonorResults] = useState<DonorSearchResult[]>([]);
  const [donorPagination, setDonorPagination] = useState<SearchPagination | null>(null);
  const [donorPage, setDonorPage] = useState(1);
  const [donorLoading, setDonorLoading] = useState(false);
  const [donorError, setDonorError] = useState<string | null>(null);
  const [showDonors, setShowDonors] = useState(false);

  useEffect(() => {
    api.getBloodBanks().then(setBloodBankOptions).catch(() => setBloodBankOptions([]));
    api.getLocations().then(setLocations).catch(() => setLocations([]));
    api.getHospitals().then(setHospitals).catch(() => setHospitals([]));
  }, []);

  useEffect(() => {
    if (routeState && routeState.searchBloodType) {
      setBloodGroup(routeState.searchBloodType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .searchBloodAvailability({
        bloodGroup: bloodGroup || undefined,
        bloodBankId: bloodBankId || undefined,
        availability: availability || undefined,
        lat: anchorCoords.lat,
        lng: anchorCoords.lng,
        radiusKm: radiusKm ? parseFloat(radiusKm) : undefined,
        sortBy,
        page,
        pageSize
      })
      .then((data) => {
        setResults(data.results);
        setPagination(data.pagination);
      })
      .catch((err) => setError(err.message || 'Could not load blood availability right now.'))
      .finally(() => setLoading(false));
  }, [bloodGroup, bloodBankId, availability, radiusKm, sortBy, page, anchorCoords.lat, anchorCoords.lng]);

  useEffect(() => {
    const t = setTimeout(runSearch, 250); // small debounce so filter changes feel instant but don't spam requests
    return () => clearTimeout(t);
  }, [runSearch]);

  // Reset to page 1 whenever a filter (not page itself) changes
  useEffect(() => {
    setPage(1);
  }, [bloodGroup, bloodBankId, availability, radiusKm, sortBy]);

  const runDonorSearch = useCallback(() => {
    setDonorLoading(true);
    setDonorError(null);
    api
      .searchDonors({
        bloodGroup: bloodGroup || undefined,
        lat: anchorCoords.lat,
        lng: anchorCoords.lng,
        radiusKm: radiusKm ? parseFloat(radiusKm) : undefined,
        sortBy: 'distance',
        page: donorPage,
        pageSize: 6
      })
      .then((data) => {
        setDonorResults(data.results);
        setDonorPagination(data.pagination);
      })
      .catch((err) => setDonorError(err.message || 'Could not load nearby donors right now.'))
      .finally(() => setDonorLoading(false));
  }, [bloodGroup, radiusKm, donorPage, anchorCoords.lat, anchorCoords.lng]);

  useEffect(() => {
    if (showDonors) runDonorSearch();
  }, [showDonors, runDonorSearch]);

  useEffect(() => { setDonorPage(1); }, [bloodGroup, radiusKm]);

  const handleUseMyLocation = () => {
    setAnchor(null);
    requestLocation();
    showToast('info', '📍 Locating…', 'Requesting your device location to sort results by distance.');
  };

  const handleAnchorToHospital = (hospitalId: string) => {
    if (!hospitalId) { setAnchor((a) => (a?.kind === 'hospital' ? null : a)); return; }
    const h = hospitals.find((x) => x.id === hospitalId);
    if (!h || h.lat == null || h.lng == null) {
      showToast('warning', 'No location on file', 'This hospital has no coordinates saved yet.');
      return;
    }
    setAnchor({ kind: 'hospital', id: h.id, label: h.name, lat: h.lat, lng: h.lng });
    showToast('info', '📍 Anchored to hospital', `Distances now shown relative to ${h.name}.`);
  };

  const handleAnchorToLocation = (locationId: string) => {
    if (!locationId) { setAnchor((a) => (a?.kind === 'location' ? null : a)); return; }
    const loc = locations.find((x) => String(x.id) === locationId);
    if (!loc) return;
    setAnchor({ kind: 'location', id: String(loc.id), label: loc.label, lat: loc.lat, lng: loc.lng });
    showToast('info', '📍 Location set', `Distances now shown relative to ${loc.label}.`);
  };

  const handleContactBank = (r: BloodAvailabilityResult) => {
    if (r.contactPhone) {
      window.location.href = `tel:${r.contactPhone.replace(/\s+/g, '')}`;
    } else {
      showToast('warning', 'No contact number on file', 'Try viewing this bank on the map instead.');
    }
  };

  const handleViewOnMap = (r: BloodAvailabilityResult) => {
    navigateTo('map', { directions: { lat: r.lat, lng: r.lng, hospital: r.bloodBankName, patientName: `${r.bloodGroup} blood availability visit` } });
  };

  const handleRequestTransfer = async (r: BloodAvailabilityResult) => {
    if (!isLoggedIn || !user || (user.role !== 'Hospital' && user.role !== 'Blood Bank')) {
      showToast('warning', '🔒 Sign in required', 'Only registered hospitals and blood banks can request transfers.');
      return;
    }
    try {
      await api.createTransfer({ requestingId: user.id, supplyingId: r.bloodBankId, bloodType: r.bloodGroup, units: Math.min(5, r.availableUnits) });
      showToast('success', '📦 Transfer Requested', `Requested ${r.bloodGroup} units from ${r.bloodBankName}. Track it in your dashboard.`);
    } catch (err: any) {
      showToast('warning', '⚠️ Request Failed', err.message || 'Could not create transfer request');
    }
  };

  const handleContactDonor = async (d: DonorSearchResult) => {
    try {
      await api.createNotification({
        userId: d.id,
        type: 'emergency_alert',
        title: `Someone nearby needs ${d.bloodGroup} blood`,
        message: `A LifeLink user found you through Find Blood and hopes you're available to help. Open the app to respond.`,
        relatedType: 'find_blood_contact'
      });
      showToast('success', '📲 Notified', `${d.displayName} has been notified through LifeLink. They'll see it in their notifications.`);
    } catch (err: any) {
      showToast('warning', '⚠️ Could not notify', err.message || 'Please try again.');
    }
  };

  const clearFilters = () => {
    setBloodGroup(''); setBloodBankId(''); setAvailability(''); setRadiusKm(''); setSortBy('distance'); setAnchor(null);
  };

  const activeFilterCount = [bloodGroup, bloodBankId, availability, radiusKm].filter(Boolean).length;

  return (
    <div className="page active" id="find-blood">
      <div className="section-sm">
        <div className="section-title">🔍 Find Blood</div>
        <div className="section-sub">
          Live availability across every registered blood bank in Coimbatore — search, filter, and act in real time.
        </div>

        {/* URGENCY QUICK-SELECT */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {(['Normal', 'Urgent', 'Critical'] as const).map((u) => (
            <button
              key={u}
              className={`btn btn-sm ${urgency === u ? 'btn-red' : 'btn-outline'}`}
              onClick={() => {
                setUrgency(u);
                if (u === 'Critical' && !radiusKm) setRadiusKm('20'); // widen search automatically for critical need
              }}
            >
              {u === 'Critical' ? '🚨' : u === 'Urgent' ? '⚡' : '🩸'} {u}
            </button>
          ))}
          {urgency === 'Critical' && (
            <span style={{ fontSize: '12px', color: 'var(--gr)', alignSelf: 'center' }}>
              Radius widened automatically — every second counts.
            </span>
          )}
        </div>

        {/* FILTER PANEL */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div className="form-group">
              <label className="form-label">Blood Group</label>
              <select className="form-input" value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
                <option value="">Any group</option>
                {BLOOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Blood Bank</label>
              <select className="form-input" value={bloodBankId} onChange={(e) => setBloodBankId(e.target.value)}>
                <option value="">All blood banks</option>
                {bloodBankOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <select className="form-input" value={anchor?.kind === 'location' ? anchor.id : ''} onChange={(e) => handleAnchorToLocation(e.target.value)}>
                <option value="">My current area</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Distance / Radius</label>
              <select className="form-input" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)}>
                {RADIUS_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Availability</label>
              <select className="form-input" value={availability} onChange={(e) => setAvailability(e.target.value)}>
                <option value="">Any availability</option>
                <option value="Adequate">Adequate</option>
                <option value="Low Stock">Low Stock</option>
                <option value="Critical">Critical</option>
                <option value="Out of Stock">Out of Stock</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Sort By</label>
              <select className="form-input" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="distance">Nearest First</option>
                <option value="units">Most Units First</option>
                <option value="updated">Recently Updated</option>
                <option value="bank">Blood Bank Name</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Near a Hospital</label>
              <select className="form-input" value={anchor?.kind === 'hospital' ? anchor.id : ''} onChange={(e) => handleAnchorToHospital(e.target.value)}>
                <option value="">— Optional —</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={handleUseMyLocation}>
                📍 {geoStatus === 'locating' ? 'Locating…' : 'Use My Location'}
              </button>
              {isUsingFallback && !anchor && (
                <span style={{ fontSize: '11px', color: 'var(--gr)' }}>Showing distances from central Coimbatore (location not shared)</span>
              )}
              {!isUsingFallback && !anchor && <span style={{ fontSize: '11px', color: 'var(--green)' }}>✓ Using your live location</span>}
              {anchor && <span style={{ fontSize: '11px', color: 'var(--red)' }}>📍 Anchored to {anchor.label}</span>}
            </div>
            {activeFilterCount > 0 && (
              <button className="btn btn-gray btn-sm" onClick={clearFilters}>✕ Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}</button>
            )}
          </div>
        </div>

        {/* RESULTS */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="card" style={{ minHeight: '150px', opacity: 0.5 }}>
                <div style={{ height: '14px', width: '60%', background: 'var(--gr4)', borderRadius: '4px', marginBottom: '10px' }} />
                <div style={{ height: '10px', width: '40%', background: 'var(--gr4)', borderRadius: '4px', marginBottom: '16px' }} />
                <div style={{ height: '8px', width: '100%', background: 'var(--gr4)', borderRadius: '4px' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>⚠️</div>
            <h3>Couldn't load blood availability</h3>
            <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '6px' }}>{error}</p>
            <button className="btn btn-red" style={{ marginTop: '1rem' }} onClick={runSearch}>Retry</button>
          </div>
        ) : results.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>🩸</div>
            <h3>No matching blood availability found</h3>
            <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '6px', maxWidth: '420px', margin: '6px auto 0' }}>
              Try widening your search radius, choosing a different blood group, or clearing the availability filter.
            </p>
            {activeFilterCount > 0 && <button className="btn btn-outline" style={{ marginTop: '1rem' }} onClick={clearFilters}>Clear Filters</button>}
          </div>
        ) : (
          <>
            <div style={{ fontSize: '12px', color: 'var(--gr)', marginBottom: '10px' }}>
              {pagination?.total} result{pagination?.total === 1 ? '' : 's'} found
              {radiusKm ? ` within ${radiusKm} km` : ''}{bloodGroup ? ` for ${bloodGroup}` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {results.map((r) => (
                <div key={r.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--red)' }}>{r.bloodGroup}</div>
                      <div style={{ fontSize: '13px', fontWeight: 700 }}>{r.bloodBankName}</div>
                    </div>
                    <span className={`badge ${statusBadgeClass(r.availabilityStatus)}`}>{r.availabilityStatus}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gr)', marginBottom: '8px' }}>
                    📍 {r.location}{r.distanceKm !== null ? ` · ${formatDistance(r.distanceKm)} away` : ''}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--gr)' }}>Available Units</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{r.availableUnits}</span>
                  </div>
                  <div className="pbar"><div className="pbar-f" style={{ width: `${Math.min(100, r.availableUnits)}%`, background: statusBarColor(r.availabilityStatus) }} /></div>
                  <div style={{ fontSize: '11px', color: 'var(--gr2)', marginTop: '8px' }}>
                    🕐 Updated {timeAgo(r.lastUpdated)} · {r.apiStatus}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                    <button className="btn btn-red btn-sm" style={{ flex: 1 }} onClick={() => handleContactBank(r)}>📞 Call Bank</button>
                    <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => handleViewOnMap(r)}>🗺️ Map</button>
                    {(user?.role === 'Hospital' || user?.role === 'Blood Bank') && (
                      <button className="btn btn-gray btn-sm btn-full" onClick={() => handleRequestTransfer(r)}>📦 Request Transfer</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* PAGINATION */}
            {pagination && pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginTop: '1.5rem' }}>
                <button className="btn btn-gray btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
                <span style={{ fontSize: '12px', color: 'var(--gr)' }}>Page {pagination.page} of {pagination.totalPages}</span>
                <button className="btn btn-gray btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}

        {/* SECONDARY: NEARBY COMPATIBLE DONORS */}
        <div style={{ marginTop: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <div className="card-title" style={{ fontSize: '16px', margin: 0 }}>🧑‍🤝‍🧑 Nearby Compatible Donors</div>
              <div style={{ fontSize: '12px', color: 'var(--gr)', marginTop: '2px' }}>
                Privacy-protected — donor identity is masked; contacting them sends a real in-app notification, no personal details are shared.
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setShowDonors((s) => !s)}>
              {showDonors ? 'Hide' : 'Show Donors'}
            </button>
          </div>

          {showDonors && (
            donorLoading ? (
              <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>Loading nearby donors…</div>
            ) : donorError ? (
              <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ color: 'var(--gr)', fontSize: '13px' }}>{donorError}</p>
                <button className="btn btn-red btn-sm" style={{ marginTop: '10px' }} onClick={runDonorSearch}>Retry</button>
              </div>
            ) : donorResults.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>
                No compatible active donors found for this search. Try widening the radius or changing the blood group.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                  {donorResults.map((d) => (
                    <div key={d.id} className="card" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '13px' }}>{d.displayName}</strong>
                        <span className="badge b-crit" style={{ fontWeight: 800 }}>{d.bloodGroup}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '4px' }}>
                        📍 {d.location}{d.distanceKm !== null ? ` · ${formatDistance(d.distanceKm)}` : ''}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '2px' }}>{d.donationCount} lifetime donation{d.donationCount === 1 ? '' : 's'}</div>
                      <button className="btn btn-red btn-sm btn-full" style={{ marginTop: '10px' }} onClick={() => handleContactDonor(d)}>📲 Notify Donor</button>
                    </div>
                  ))}
                </div>
                {donorPagination && donorPagination.totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginTop: '1rem' }}>
                    <button className="btn btn-gray btn-sm" disabled={donorPage <= 1} onClick={() => setDonorPage((p) => Math.max(1, p - 1))}>← Prev</button>
                    <span style={{ fontSize: '12px', color: 'var(--gr)' }}>Page {donorPagination.page} of {donorPagination.totalPages}</span>
                    <button className="btn btn-gray btn-sm" disabled={donorPage >= donorPagination.totalPages} onClick={() => setDonorPage((p) => p + 1)}>Next →</button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};
export default FindBlood;
