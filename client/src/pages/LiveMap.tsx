import React, { useEffect, useState, useCallback } from 'react';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api, type Emergency, type Hospital, type BloodBank, type Camp, type DonorSearchResult, type BloodAvailabilityResult } from '../api';
import { LeafletMap, type SelectedMarker } from '../components/LeafletMap';
import { useGeolocation, getDistanceKm, formatDistance } from '../utils/geo';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RADIUS_OPTIONS = [
  { label: '5 km', value: '5' },
  { label: '10 km', value: '10' },
  { label: '20 km', value: '20' },
  { label: '50 km', value: '50' },
  { label: 'Any distance', value: '' }
];

type Tab = 'requests' | 'nearby' | 'bloodsearch' | 'directions';

export const LiveMap: React.FC = () => {
  const { routeState } = useRouting();
  const { showToast } = useToast();

  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [bloodBanks, setBloodBanks] = useState<BloodBank[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('requests');

  const { effectiveCoords, isUsingFallback, status: geoStatus, error: geoError, requestLocation } = useGeolocation();

  // ---- Radius control (shared by "Nearby" tab + privacy-safe donor fetch) ----
  const [radiusKm, setRadiusKm] = useState('10');

  // ---- Privacy-safe donors (approximate coordinates only, from the server) ----
  const [donors, setDonors] = useState<DonorSearchResult[]>([]);
  const [donorsLoading, setDonorsLoading] = useState(false);

  // ---- Blood-group availability search (reuses the Find Blood engine, integrated with the map) ----
  const [searchBloodGroup, setSearchBloodGroup] = useState('');
  const [bloodResults, setBloodResults] = useState<BloodAvailabilityResult[]>([]);
  const [bloodLoading, setBloodLoading] = useState(false);
  const [bloodError, setBloodError] = useState<string | null>(null);

  const [activeDirections, setActiveDirections] = useState<{
    destLat: number;
    destLng: number;
    destName: string;
    emergencyId: string;
  } | null>(null);

  const [routeInfo, setRouteInfo] = useState<{
    distance: string;
    duration: string;
    steps: string[];
  } | null>(null);

  const [selectedMarker, setSelectedMarker] = useState<SelectedMarker>(null);

  // Map markers filters state
  const [mapFilters, setMapFilters] = useState({
    donors: true,
    hospitals: true,
    bloodBanks: true,
    emergencies: true,
    camps: true
  });
  const [activeFilterName, setActiveFilterName] = useState<'All' | 'Emergencies' | 'Donors' | 'Hospitals' | 'Blood Banks' | 'Camps'>('All');

  useEffect(() => {
    api.getEmergencies().then(setEmergencies).catch(console.error);
    api.getHospitals().then(setHospitals).catch(console.error);
    api.getBloodBanks().then(setBloodBanks).catch(console.error);
    api.getCamps().then(setCamps).catch(console.error);
  }, []);

  // Privacy-safe donor fetch: only ever uses the dedicated donor-search endpoint
  // (approximate coordinates + masked names), never raw /api/users coordinates.
  const loadDonors = useCallback(() => {
    setDonorsLoading(true);
    api
      .searchDonors({
        lat: effectiveCoords.lat,
        lng: effectiveCoords.lng,
        radiusKm: radiusKm ? parseFloat(radiusKm) : undefined,
        availableOnly: true,
        sortBy: 'distance',
        pageSize: 30
      })
      .then((data) => setDonors(data.results))
      .catch(() => setDonors([]))
      .finally(() => setDonorsLoading(false));
  }, [effectiveCoords.lat, effectiveCoords.lng, radiusKm]);

  useEffect(() => {
    const t = setTimeout(loadDonors, 200);
    return () => clearTimeout(t);
  }, [loadDonors]);

  // Blood-group availability search, sorted by real proximity, feeding both the list and the map highlight
  const runBloodSearch = useCallback(() => {
    if (!searchBloodGroup) { setBloodResults([]); return; }
    setBloodLoading(true);
    setBloodError(null);
    api
      .searchBloodAvailability({
        bloodGroup: searchBloodGroup,
        lat: effectiveCoords.lat,
        lng: effectiveCoords.lng,
        radiusKm: radiusKm ? parseFloat(radiusKm) : undefined,
        sortBy: 'distance',
        pageSize: 20
      })
      .then((data) => setBloodResults(data.results))
      .catch((err) => setBloodError(err.message || 'Could not search blood availability right now.'))
      .finally(() => setBloodLoading(false));
  }, [searchBloodGroup, effectiveCoords.lat, effectiveCoords.lng, radiusKm]);

  useEffect(() => {
    const t = setTimeout(runBloodSearch, 200);
    return () => clearTimeout(t);
  }, [runBloodSearch]);

  // Pre-load directions if navigated from another page via routeState
  useEffect(() => {
    if (routeState && routeState.directions) {
      const dir = routeState.directions;
      setActiveDirections({
        destLat: dir.lat,
        destLng: dir.lng,
        destName: dir.hospital,
        emergencyId: dir.id || ''
      });
      setActiveTab('directions');
    }
  }, [routeState]);

  const handleSelectEmergency = (emerg: Emergency) => {
    setSelectedMarker({ type: 'emergency', id: emerg.id });
    showToast('info', `📍 Centered on ${emerg.patientName}`, `${emerg.hospital} · ${emerg.ward}`);
  };

  const handleRouteMe = (e: Emergency) => {
    setActiveDirections({
      destLat: e.lat,
      destLng: e.lng,
      destName: `${e.hospital} (${e.patientName})`,
      emergencyId: e.id
    });
    setActiveTab('directions');
  };

  const handleFilterClick = (filterType: 'All' | 'Emergencies' | 'Donors' | 'Hospitals' | 'Blood Banks' | 'Camps') => {
    setActiveFilterName(filterType);
    if (filterType === 'All') {
      setMapFilters({ donors: true, hospitals: true, bloodBanks: true, emergencies: true, camps: true });
    } else {
      setMapFilters({
        donors: filterType === 'Donors',
        hospitals: filterType === 'Hospitals',
        bloodBanks: filterType === 'Blood Banks',
        emergencies: filterType === 'Emergencies',
        camps: filterType === 'Camps'
      });
    }
  };

  const googleMapsUrl = activeDirections
    ? `https://www.google.com/maps/dir/?api=1&origin=${effectiveCoords.lat},${effectiveCoords.lng}&destination=${activeDirections.destLat},${activeDirections.destLng}&travelmode=driving`
    : '#';

  // ---- Nearby lists: real distance-sorted, radius-filtered (client-side over small, already-real datasets) ----
  const radiusNum = radiusKm ? parseFloat(radiusKm) : null;
  const nearbyHospitals = hospitals
    .filter((h) => h.lat != null && h.lng != null)
    .map((h) => ({ ...h, distanceKm: getDistanceKm(effectiveCoords, { lat: h.lat as number, lng: h.lng as number }) }))
    .filter((h) => radiusNum === null || h.distanceKm <= radiusNum)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyBanks = bloodBanks
    .filter((b) => b.lat != null && b.lng != null)
    .map((b) => ({ ...b, distanceKm: getDistanceKm(effectiveCoords, { lat: b.lat as number, lng: b.lng as number }) }))
    .filter((b) => radiusNum === null || b.distanceKm <= radiusNum)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyCamps = camps
    .filter((c) => c.lat != null && c.lng != null && c.status !== 'Under Review' && c.status !== 'Rejected')
    .map((c) => ({ ...c, distanceKm: getDistanceKm(effectiveCoords, { lat: c.lat as number, lng: c.lng as number }) }))
    .filter((c) => radiusNum === null || c.distanceKm <= radiusNum)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const highlightedBankIds = bloodResults.map((r) => r.bloodBankId);

  const geoBanner = () => {
    if (geoStatus === 'denied') {
      return { icon: '🚫', text: 'Location permission denied — showing distances from central Coimbatore instead.', tone: 'warn' as const };
    }
    if (geoStatus === 'unsupported') {
      return { icon: '⚠️', text: "Your browser doesn't support geolocation — showing distances from central Coimbatore.", tone: 'warn' as const };
    }
    if (geoStatus === 'error') {
      return { icon: '⚠️', text: `Couldn't determine your location${geoError ? ` (${geoError})` : ''} — showing distances from central Coimbatore.`, tone: 'warn' as const };
    }
    return null;
  };
  const banner = geoBanner();

  return (
    <div className="page active" id="map">
      <div className="section-sm">
        <div className="dash-header">
          <div>
            <div className="dash-title">Live <span className="accent">Donor Map</span></div>
            <div className="dash-sub">Real-time locations of hospitals, blood banks, donation camps, and patients in need</div>
          </div>
          <button className="btn btn-red" onClick={requestLocation} disabled={geoStatus === 'locating'}>
            📍 {geoStatus === 'locating' ? 'Locating…' : geoStatus === 'success' ? 'Location Active' : 'Use My Location'}
          </button>
        </div>

        {banner && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', background: '#fef3c7', border: '1px solid #f59e0b',
            borderRadius: 'var(--r2)', padding: '10px 14px', marginBottom: '1rem', fontSize: '12.5px', color: '#92400e'
          }}>
            <span>{banner.icon}</span>
            <span>{banner.text}</span>
            <button className="btn btn-sm" style={{ marginLeft: 'auto', background: '#92400e', color: '#fff' }} onClick={requestLocation}>Retry</button>
          </div>
        )}

        <div className="map-container">
          {/* Left Sidebar: Interactivity and Turn-by-Turn */}
          <div className="map-sidebar">
            {/* Sidebar Tabs */}
            <div style={{ display: 'flex', borderBottom: '1.5px solid var(--gr4)', paddingBottom: '.5rem', gap: '6px', position: 'sticky', top: 0, backgroundColor: '#fff', zIndex: 5, flexWrap: 'wrap' }}>
              <button className={`map-tab-btn ${activeTab === 'requests' ? 'active' : ''}`} onClick={() => setActiveTab('requests')}>🚨 Emergencies</button>
              <button className={`map-tab-btn ${activeTab === 'nearby' ? 'active' : ''}`} onClick={() => setActiveTab('nearby')}>📍 Nearby</button>
              <button className={`map-tab-btn ${activeTab === 'bloodsearch' ? 'active' : ''}`} onClick={() => setActiveTab('bloodsearch')}>🩸 Blood Search</button>
              <button className={`map-tab-btn ${activeTab === 'directions' ? 'active' : ''}`} onClick={() => setActiveTab('directions')}>Road Guide 🛣️</button>
            </div>

            {/* Radius control — shared across Nearby & Blood Search tabs */}
            {(activeTab === 'nearby' || activeTab === 'bloodsearch') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                <label style={{ fontSize: '11px', color: 'var(--gr)', fontWeight: 700 }}>Radius:</label>
                <select className="form-input" style={{ padding: '6px 8px', fontSize: '12px' }} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)}>
                  {RADIUS_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            )}

            {/* Tab: Emergencies */}
            {activeTab === 'requests' && (
              <div id="map-tab-requests" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                {emergencies.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--gr)', fontSize: '12px' }}>No active emergency requests right now.</div>
                ) : (
                  [...emergencies]
                    .sort((a, b) => getDistanceKm(effectiveCoords, { lat: a.lat, lng: a.lng }) - getDistanceKm(effectiveCoords, { lat: b.lat, lng: b.lng }))
                    .map((e) => {
                      const dist = formatDistance(getDistanceKm(effectiveCoords, { lat: e.lat, lng: e.lng }));
                      const isCardActive = selectedMarker?.type === 'emergency' && selectedMarker.id === e.id;
                      return (
                        <div
                          key={e.id}
                          id={`sidebar-req-${e.id}`}
                          className={`sidebar-req-card ${e.urgency.toLowerCase()} ${isCardActive ? 'active' : ''}`}
                          onClick={() => handleSelectEmergency(e)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                            <span className="badge b-crit" style={{ fontSize: '11px', padding: '2px 8px' }}>{e.bloodType}</span>
                            <span className={`badge ${e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok'}`}>{e.urgency}</span>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--tx)' }}>{e.patientName}</div>
                          <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '2px' }}>🏥 {e.hospital} · {e.ward}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', borderTop: '1px solid rgba(0,0,0,.04)', paddingTop: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)' }}>📍 {dist} away</span>
                            <button className="btn btn-red btn-sm" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={(evt) => { evt.stopPropagation(); handleRouteMe(e); }}>
                              Route Me 🛣️
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}

            {/* Tab: Nearby (hospitals, blood banks, camps, donors) */}
            {activeTab === 'nearby' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)', textTransform: 'uppercase', marginBottom: '6px' }}>🏥 Hospitals ({nearbyHospitals.length})</div>
                  {nearbyHospitals.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>None within this radius — try widening it.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {nearbyHospitals.map((h) => (
                        <div key={h.id} className="nearby-mini-card" onClick={() => setSelectedMarker({ type: 'hospital', id: h.id })} style={miniCardStyle(selectedMarker?.type === 'hospital' && selectedMarker.id === h.id)}>
                          <strong style={{ fontSize: '12px' }}>{h.name}</strong>
                          <span style={{ fontSize: '11px', color: 'var(--gr)' }}>{formatDistance(h.distanceKm)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)', textTransform: 'uppercase', marginBottom: '6px' }}>🩸 Blood Banks ({nearbyBanks.length})</div>
                  {nearbyBanks.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>None within this radius — try widening it.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {nearbyBanks.map((b) => (
                        <div key={b.id} className="nearby-mini-card" onClick={() => setSelectedMarker({ type: 'bloodBank', id: b.id })} style={miniCardStyle(selectedMarker?.type === 'bloodBank' && selectedMarker.id === b.id)}>
                          <strong style={{ fontSize: '12px' }}>{b.name}</strong>
                          <span style={{ fontSize: '11px', color: 'var(--gr)' }}>{formatDistance(b.distanceKm)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)', textTransform: 'uppercase', marginBottom: '6px' }}>🏕️ Donation Camps ({nearbyCamps.length})</div>
                  {nearbyCamps.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>None within this radius — try widening it.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {nearbyCamps.map((c) => (
                        <div key={c.id} className="nearby-mini-card" onClick={() => setSelectedMarker({ type: 'camp', id: c.id })} style={miniCardStyle(selectedMarker?.type === 'camp' && selectedMarker.id === c.id)}>
                          <strong style={{ fontSize: '12px' }}>{c.title}</strong>
                          <span style={{ fontSize: '11px', color: 'var(--gr)' }}>{formatDistance(c.distanceKm)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    🧑‍🤝‍🧑 Eligible Donors ({donors.length}) <span style={{ fontWeight: 400, textTransform: 'none' }}>· approx. area only</span>
                  </div>
                  {donorsLoading ? (
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>Loading nearby donors…</div>
                  ) : donors.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>No active donors within this radius — try widening it.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {donors.slice(0, 10).map((d) => (
                        <div key={d.id} className="nearby-mini-card" onClick={() => setSelectedMarker({ type: 'donor', id: d.id })} style={miniCardStyle(selectedMarker?.type === 'donor' && selectedMarker.id === d.id)}>
                          <strong style={{ fontSize: '12px' }}>{d.displayName} <span style={{ color: 'var(--red)' }}>({d.bloodGroup})</span></strong>
                          <span style={{ fontSize: '11px', color: 'var(--gr)' }}>{d.distanceKm !== null ? formatDistance(d.distanceKm) : d.location}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab: Blood-group availability search, map-integrated */}
            {activeTab === 'bloodsearch' && (
              <div style={{ marginTop: '10px' }}>
                <select className="form-input" value={searchBloodGroup} onChange={(e) => setSearchBloodGroup(e.target.value)} style={{ marginBottom: '10px' }}>
                  <option value="">Select a blood group to search…</option>
                  {BLOOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>

                {!searchBloodGroup ? (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--gr)', fontSize: '12px' }}>
                    Pick a blood group above to find and highlight matching blood banks on the map, sorted by distance.
                  </div>
                ) : bloodLoading ? (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--gr)', fontSize: '12px' }}>Searching…</div>
                ) : bloodError ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                    <p style={{ fontSize: '12px', color: 'var(--gr)' }}>{bloodError}</p>
                    <button className="btn btn-red btn-sm" style={{ marginTop: '8px' }} onClick={runBloodSearch}>Retry</button>
                  </div>
                ) : bloodResults.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: 'var(--gr)', fontSize: '12px' }}>
                    No {searchBloodGroup} availability found within this radius. Try widening the radius.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {bloodResults.map((r) => {
                      const isActive = selectedMarker?.type === 'bloodBank' && selectedMarker.id === r.bloodBankId;
                      return (
                        <div key={r.id} className="nearby-mini-card" onClick={() => setSelectedMarker({ type: 'bloodBank', id: r.bloodBankId })} style={{ ...miniCardStyle(isActive), flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong style={{ fontSize: '12px' }}>{r.bloodBankName}</strong>
                            <span className={`badge ${r.availabilityStatus === 'Critical' || r.availabilityStatus === 'Out of Stock' ? 'b-crit' : r.availabilityStatus === 'Low Stock' ? 'b-urg' : 'b-ok'}`} style={{ fontSize: '10px' }}>{r.availabilityStatus}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--gr)' }}>
                            <span>{r.availableUnits} units available</span>
                            <span>{r.distanceKm !== null ? formatDistance(r.distanceKm) : ''}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Route Guide */}
            {activeTab === 'directions' && (
              <div id="map-tab-directions" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                {!activeDirections ? (
                  <div id="nav-empty-state" style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--gr)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>🧭</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--tx)' }}>No Active Route</div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      Select an emergency request from the list or click a marker on the map to start navigation guidance.
                    </div>
                  </div>
                ) : (
                  <div id="nav-route-info" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{
                      background: 'var(--pk)',
                      borderRadius: 'var(--r2)',
                      padding: '14px',
                      borderLeft: '4px solid var(--red)',
                      borderRight: '1px solid var(--pk2)',
                      borderTop: '1px solid var(--pk2)',
                      borderBottom: '1px solid var(--pk2)'
                    }}>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--red)', fontWeight: 700, letterSpacing: '.5px' }}>Active Guidance To</div>
                      <div id="nav-dest-name" style={{ fontSize: '15px', fontWeight: 800, color: 'var(--tx)', marginTop: '2px' }}>{activeDirections.destName}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px', color: 'var(--gr)', borderTop: '1.5px solid rgba(192,57,43,.08)', paddingTop: '8px' }}>
                        <div>🛣️ Distance: <strong style={{ color: 'var(--tx)' }}>{routeInfo?.distance}</strong></div>
                        <div>⏱️ Est. Time: <strong style={{ color: 'var(--tx)' }}>{routeInfo?.duration}</strong></div>
                      </div>
                    </div>

                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gr)', textTransform: 'uppercase', letterSpacing: '.4px', marginTop: '4px' }}>Turn-by-Turn Directions</div>
                    <div id="nav-steps-list" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--gr4)', borderRadius: 'var(--r2)', backgroundColor: '#fff', maxHeight: '220px', overflowY: 'auto' }}>
                      {routeInfo?.steps.map((step, idx) => (
                        <div key={idx} className="step-item" style={{ padding: '8px 12px', borderBottom: '1px solid var(--gr4)', fontSize: '12px' }}>
                          <span style={{ marginRight: '8px' }}>➡️</span>
                          {step}
                        </div>
                      ))}
                    </div>

                    <a
                      id="google-maps-btn"
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-red btn-full"
                      style={{ fontSize: '12px', padding: '10px', justifyContent: 'center', textDecoration: 'none', fontWeight: 700 }}
                    >
                      📲 Open in Google Maps GPS
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Map Frame */}
          <div className="map-wrap" style={{ position: 'relative' }}>
            <LeafletMap
              emergencies={emergencies}
              donors={donors}
              hospitals={hospitals}
              bloodBanks={bloodBanks}
              camps={camps}
              highlightedBankIds={highlightedBankIds}
              userLocation={effectiveCoords}
              radiusKm={(activeTab === 'nearby' || activeTab === 'bloodsearch') ? radiusNum : null}
              filters={mapFilters}
              activeDirections={activeDirections}
              selectedMarker={selectedMarker}
              onSelectEmergency={handleSelectEmergency}
              onSelectMarker={setSelectedMarker}
              onRouteGenerated={setRouteInfo}
            />

            {/* Info Box overlay */}
            <div className="map-info-box" style={{ zIndex: 400, pointerEvents: 'none' }}>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>📍 {isUsingFallback ? 'Coimbatore (approx.)' : 'Your Location'}</div>
              <div style={{ fontSize: '11px', color: 'var(--gr)' }}>
                {donors.length} donors · {emergencies.length} emergencies · {bloodBanks.length} blood banks · {camps.length} camps
              </div>
            </div>

            {/* Legend overlay */}
            <div className="map-legend" style={{ zIndex: 400, pointerEvents: 'none' }}>
              <div className="ml-item"><div className="map-dot dot-donor" style={{ position: 'static', flexShrink: 0 }} />Donor (approx.)</div>
              <div className="ml-item"><div className="map-dot dot-emerg" style={{ position: 'static', flexShrink: 0 }} />Patient (In Need)</div>
              <div className="ml-item"><div className="map-dot dot-hosp" style={{ position: 'static', flexShrink: 0 }} />Hospital</div>
              <div className="ml-item"><div className="map-dot dot-bank" style={{ position: 'static', flexShrink: 0 }} />Blood Bank</div>
              <div className="ml-item"><div className="map-dot" style={{ position: 'static', flexShrink: 0, background: '#a855f7' }} />Camp</div>
            </div>

            {/* Bottom filters bar */}
            <div className="map-filters">
              <button className={`mf-btn ${activeFilterName === 'All' ? 'active' : ''}`} onClick={() => handleFilterClick('All')}>All</button>
              <button className={`mf-btn ${activeFilterName === 'Emergencies' ? 'active' : ''}`} onClick={() => handleFilterClick('Emergencies')}>Emergencies</button>
              <button className={`mf-btn ${activeFilterName === 'Donors' ? 'active' : ''}`} onClick={() => handleFilterClick('Donors')}>Donors</button>
              <button className={`mf-btn ${activeFilterName === 'Hospitals' ? 'active' : ''}`} onClick={() => handleFilterClick('Hospitals')}>Hospitals</button>
              <button className={`mf-btn ${activeFilterName === 'Blood Banks' ? 'active' : ''}`} onClick={() => handleFilterClick('Blood Banks')}>Blood Banks</button>
              <button className={`mf-btn ${activeFilterName === 'Camps' ? 'active' : ''}`} onClick={() => handleFilterClick('Camps')}>Camps</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const miniCardStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  borderRadius: 'var(--r2)',
  border: active ? '1.5px solid var(--red)' : '1px solid var(--gr4)',
  background: active ? 'var(--pk)' : '#fff',
  cursor: 'pointer'
});

export default LiveMap;
