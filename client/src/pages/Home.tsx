import React, { useEffect, useState } from 'react';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { api, type Emergency, type AnalyticsSummary, type BloodBank } from '../api';
import { useGeolocation, getDistanceKm, formatDistance } from '../utils/geo';

export const Home: React.FC = () => {
  const { navigateTo } = useRouting();
  const { showToast } = useToast();
  const { isLoggedIn } = useAuth();
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [bloodBanks, setBloodBanks] = useState<BloodBank[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const { effectiveCoords, isUsingFallback, requestLocation } = useGeolocation();

  useEffect(() => {
    requestLocation(); // best-effort; falls back to Coimbatore city center silently if denied
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.getEmergencies()
      .then((data) => {
        const sorted = [...data]
          .sort((a, b) => {
            const order = { 'Critical': 1, 'Urgent': 2, 'Normal': 3 };
            return order[a.urgency] - order[b.urgency];
          })
          .slice(0, 3);
        setEmergencies(sorted);
      })
      .catch((err) => console.error("Error fetching emergencies:", err));

    setStatsLoading(true);
    Promise.all([api.getAnalyticsSummary(), api.getBloodBanks()])
      .then(([s, b]) => { setSummary(s); setBloodBanks(b); })
      .catch((err) => console.error('Error fetching platform stats:', err))
      .finally(() => setStatsLoading(false));
  }, []);

  const handleRespond = (bloodType: string, hospital: string) => {
    showToast(
      'success',
      '✅ Response Confirmed!',
      `You responded to ${bloodType} request at ${hospital}. They will contact you within 5 minutes.`
    );
  };

  const handleSearchBlood = (bloodType: string) => {
    navigateTo('find-blood', { searchBloodType: bloodType });
  };

  // Real aggregate inventory across every verified blood bank (replaces hardcoded per-type numbers)
  const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  const totalStock: Record<string, number> = {};
  bloodTypes.forEach((t) => {
    totalStock[t] = bloodBanks.reduce((sum, b) => sum + (b.stockBreakdown[t] || 0), 0);
  });
  const maxStock = Math.max(1, ...Object.values(totalStock));
  const stockLabel = (units: number) => {
    if (units === 0) return { cls: 'bcrit', bar: 'p-r' };
    if (units <= 10) return { cls: 'bcrit', bar: 'p-r' };
    if (units <= 25) return { cls: 'blow', bar: 'p-o' };
    return { cls: 'bav', bar: 'p-g' };
  };
  const bloodMeta: Record<string, string> = {
    'A+': 'Most common', 'A-': 'Rare type', 'B+': 'Common', 'B-': 'Uncommon',
    'O+': 'Universal donor', 'O-': 'Universal compatible', 'AB+': 'Universal recipient', 'AB-': 'Rarest type'
  };

  return (
    <div className="page active" id="home">
      {/* HERO */}
      <div className="hero" style={{ display: 'flex', gap: '2rem' }}>
        <div className="hero-circles">
          <div className="hcircle hc1" />
          <div className="hcircle hc2" />
          <div className="hcircle hc3" />
        </div>
        <div className="hero-content">
          <div className="hero-badge">🩸 Live Emergency Network Active</div>
          <h1>Every Drop<br />Saves <span>A Life</span></h1>
          <p>
            LifeLink connects blood donors with patients in real-time. Join a growing
            network of heroes ready to save lives. Be the reason someone gets a tomorrow.
          </p>
          <div className="hero-btns">
            <button className="btn-emergency" onClick={() => navigateTo('emergency')}>
              🚨 Emergency Request
            </button>
            <button className="btn btn-dark btn-lg" onClick={() => navigateTo('auth')}>
              {isLoggedIn ? '💉 Go to Portal' : '💉 Become a Donor'}
            </button>
          </div>
          <div className="hero-stats">
            <div>
              <div className="hstat-num">{statsLoading ? '—' : summary?.completedDonations ?? 0}</div>
              <div className="hstat-lbl">Donations Completed</div>
            </div>
            <div>
              <div className="hstat-num">{statsLoading ? '—' : summary?.totalDonors ?? 0}</div>
              <div className="hstat-lbl">Registered Donors</div>
            </div>
            <div>
              <div className="hstat-num">{statsLoading ? '—' : summary?.totalHospitals ?? 0}</div>
              <div className="hstat-lbl">Hospitals</div>
            </div>
            <div>
              <div className="hstat-num">{statsLoading ? '—' : summary?.totalBloodBanks ?? 0}</div>
              <div className="hstat-lbl">Blood Banks</div>
            </div>
          </div>
        </div>
        <div className="hero-right">
          <div className="blood-drop">
            <div className="bd-ring" />
            <div className="bd-shape" />
            <div className="bd-text">
              <div className="bd-type">O+</div>
              <div className="bd-sub">Universal Donor</div>
            </div>
          </div>
        </div>
      </div>

      {/* STATS STRIP */}
      <div className="stats-strip">
        <div>
          <div className="ss-num">{statsLoading ? '—' : summary?.totalDonations ?? 0}</div>
          <div className="ss-lbl">Donations Logged</div>
        </div>
        <div>
          <div className="ss-num">{statsLoading ? '—' : summary?.activeEmergencies ?? 0}</div>
          <div className="ss-lbl">Active Requests</div>
        </div>
        <div>
          <div className="ss-num">{statsLoading ? '—' : summary?.totalCamps ?? 0}</div>
          <div className="ss-lbl">Donation Camps</div>
        </div>
        <div>
          <div className="ss-num">{statsLoading ? '—' : summary?.eventsLast7Days ?? 0}</div>
          <div className="ss-lbl">Platform Events (7d)</div>
        </div>
      </div>

      {/* ACTIVE EMERGENCIES TEASER */}
      <div style={{ background: 'linear-gradient(135deg,#fff5f5,var(--pk))', borderTop: '4px solid var(--red)', padding: '3rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{
            background: 'linear-gradient(135deg,var(--rl),var(--rd))',
            borderRadius: 'var(--r)',
            padding: '1.5rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '2rem',
            color: '#fff',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: 'rgba(255,255,255,.18)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px'
              }}>
                🚨
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                  {emergencies.length} Critical Emergencies Active Near You
                </div>
                <div style={{ fontSize: '13px', opacity: 0.85 }}>
                  Your response can save a life in the next few minutes
                </div>
              </div>
            </div>
            <button
              className="btn"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: '1.5px solid rgba(255,255,255,.3)' }}
              onClick={() => navigateTo('emergency')}
            >
              View All Requests →
            </button>
          </div>
          <div id="home-emergencies-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem' }}>
            {emergencies.map((e) => {
              const cardClass = e.urgency.toLowerCase();
              const badgeClass = e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok';
              const dotIcon = e.urgency === 'Critical' ? '🔴' : e.urgency === 'Urgent' ? '🟡' : '🟢';
              const dist = e.lat && e.lng
                ? formatDistance(getDistanceKm(effectiveCoords, { lat: e.lat, lng: e.lng }))
                : null;

              return (
                <div key={e.id} className={`emerg-card ${cardClass}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--red)' }}>{e.bloodType}</div>
                    <span className={`badge ${badgeClass}`}>{dotIcon} {e.urgency}</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>{e.hospital}</div>
                  <div style={{ fontSize: '12px', color: 'var(--gr)', marginBottom: '10px' }}>
                    📍 Coimbatore{dist ? `, ${dist} away` : ''}{isUsingFallback ? ' (approx.)' : ''}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', color: 'var(--gr)' }}>Need <strong>{e.units} units</strong> urgently</div>
                    <button className="btn btn-red btn-sm" onClick={() => handleRespond(e.bloodType, e.hospital)}>Respond</button>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gr2)', marginTop: '8px' }}>⏱ Posted {e.time}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* BLOOD AVAILABILITY */}
      <div className="section">
        <div className="section-title">Blood <span className="accent">Availability</span></div>
        <div className="section-sub">Real-time inventory across verified blood banks in your city</div>
        <div className="blood-grid">
          {statsLoading ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>Loading live inventory…</div>
          ) : bloodBanks.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>No blood bank inventory data available yet.</div>
          ) : (
            bloodTypes.map((t) => {
              const units = totalStock[t];
              const meta = stockLabel(units);
              const pct = Math.round((units / maxStock) * 100);
              return (
                <div className="blood-card" key={t} onClick={() => handleSearchBlood(t)}>
                  <div className="bt">{t}</div>
                  <div className="bc">{bloodMeta[t]}</div>
                  <div className={`bcount ${meta.cls}`}>{units} unit{units === 1 ? '' : 's'}</div>
                  <div className="pbar"><div className={`pbar-f ${meta.bar}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div style={{ background: 'var(--gr3)', padding: '4rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div className="section-title" style={{ textAlign: 'center' }}>How <span className="accent">LifeLink</span> Works</div>
          <div className="section-sub" style={{ textAlign: 'center' }}>Simple. Fast. Life-saving.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1.5rem', marginTop: '2rem' }}>
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📝</div>
              <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>1. Register</div>
              <div style={{ fontSize: '13px', color: 'var(--gr)' }}>Sign up as a donor, patient, hospital, or blood bank in under 2 minutes.</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🧠</div>
              <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>2. AI Matching</div>
              <div style={{ fontSize: '13px', color: 'var(--gr)' }}>Our AI instantly matches donors with patients based on blood type, location, and eligibility.</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔔</div>
              <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>3. Get Notified</div>
              <div style={{ fontSize: '13px', color: 'var(--gr)' }}>Receive real-time alerts for emergencies, scheduled camps, and eligibility reminders.</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💉</div>
              <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>4. Donate &amp; Save</div>
              <div style={{ fontSize: '13px', color: 'var(--gr)' }}>Respond to requests, donate blood, earn badges, and track your impact in real-time.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default Home;
