import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useRouting } from '../../context/RoutingContext';
import { api } from '../../api';
import type { DonorDashboardData } from '../../api';
import { useEventStream } from '../../utils/sse';
import { Sparkline, MetricSkeleton, CardSkeleton, EmptyState } from '../../components/MiniCharts';

const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const DonorDashboard: React.FC = () => {
  const { user, updateUserContext } = useAuth();
  const { showToast } = useToast();
  const { navigateTo } = useRouting();

  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'profile' | 'settings'>('overview');
  const [data, setData] = useState<DonorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Profile edit
  const [profileName, setProfileName] = useState('');
  const [profileLoc, setProfileLoc] = useState('');
  const [profilePhone, setProfilePhone] = useState('');

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfileLoc(user.location);
      setProfilePhone(user.phone || '');
    }
  }, [user?.id]);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([api.getDonorDashboard(), api.getUnreadCount(user.id)])
      .then(([d, counts]) => { setData(d); setUnreadCount(counts.total); setUrgentCount(counts.urgent); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useEventStream('emergency:created', load);
  useEventStream('emergency:status', load);

  if (!user) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Please Sign In</h3>
        <button className="btn btn-red" style={{ marginTop: '1rem' }} onClick={() => navigateTo('auth')}>Go to Login</button>
      </div>
    </div>
  );

  const { stats, recentDonations, upcomingAppointments, campRegistrations, compatibleEmergencies, nearbyCamps } = data || {
    stats: { totalDonations: 0, xp: 0, rank: null, totalDonors: 0, livesImpact: 0, daysSinceLast: null, isEligible: true, daysUntilEligible: 0, lastDonationDate: null },
    recentDonations: [], upcomingAppointments: [], campRegistrations: [], compatibleEmergencies: [], nearbyCamps: []
  };

  const level = Math.floor((user.xp || 0) / 300) + 1;
  const xpInLevel = (user.xp || 0) % 300;
  const isRareType = ['O-', 'AB-', 'B-'].includes(user.bloodType);
  const isLifesaver = (user.donations || 0) >= 5;
  const eligibilityPct = stats.isEligible ? 100 : Math.round((stats.daysSinceLast! / 90) * 100);

  const handleToggleAvailability = async () => {
    const next = user.status === 'Active' ? 'Busy' : 'Active';
    try {
      await updateUserContext({ status: next });
      showToast('success', next === 'Active' ? '🟢 Available' : '⚪ Busy', `Status updated to ${next}`);
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const handleRespond = async (emergencyId: string, response: 'accept' | 'decline') => {
    setRespondingId(emergencyId);
    try {
      await api.respondToEmergency(emergencyId, user.id, response);
      showToast(response === 'accept' ? 'success' : 'info',
        response === 'accept' ? '✅ Accepted!' : 'Declined',
        response === 'accept' ? 'Thank you! The hospital will be notified.' : 'Got it — no worries.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Error', err.message); }
    finally { setRespondingId(null); }
  };

  const handleSaveProfile = async () => {
    if (!profileName.trim() || !profileLoc.trim()) {
      showToast('warning', '⚠️ Missing Info', 'Name and location are required.'); return;
    }
    try {
      await updateUserContext({ pendingUpdate: { name: profileName, location: profileLoc, bloodType: user.bloodType } });
      if (profilePhone !== (user.phone || '')) await updateUserContext({ phone: profilePhone });
      showToast('info', '📝 Submitted for Review', 'Profile changes sent to admin for verification.');
      setActiveTab('overview');
    } catch (err: any) { showToast('warning', '⚠️ Save Failed', err.message); }
  };

  // Sparkline from recent donations by month (last 6)
  const monthCounts = (() => {
    const now = new Date(); const counts: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now); d.setMonth(d.getMonth() - i);
      const m = d.toISOString().slice(0, 7);
      counts.push(recentDonations.filter(x => (x.donationDate || x.time || '').startsWith(m)).length);
    }
    return counts;
  })();

  const pendingActions = [
    ...(compatibleEmergencies.length > 0 ? [`${compatibleEmergencies.length} emergency request${compatibleEmergencies.length > 1 ? 's' : ''} need${compatibleEmergencies.length === 1 ? 's' : ''} your ${user.bloodType} blood`] : []),
    ...(!stats.isEligible ? [] : upcomingAppointments.length === 0 && campRegistrations.length === 0 ? ['No upcoming appointments — book a donation slot'] : []),
    ...(user.status !== 'Active' ? [`Your status is ${user.status} — set to Available to receive requests`] : []),
  ];

  const sidebarNav = [
    { key: 'overview', icon: '🏠', label: 'Dashboard' },
    { key: 'history', icon: '📋', label: 'Donation History' },
    { key: 'profile', icon: '👤', label: 'My Profile' },
    { key: 'settings', icon: '⚙️', label: 'Settings' },
  ] as const;

  return (
    <div className="page active" id="donor-dash">
      <div className="dash-layout">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sb-title">Donor Portal</div>
          {sidebarNav.map(({ key, icon, label }) => (
            <div key={key} className={`si ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>
              <span>{icon}</span> {label}
            </div>
          ))}
          <div className="si" onClick={() => navigateTo('notifications' as any)}>
            <span>🔔</span> Notifications
            {unreadCount > 0 && (
              <span style={{ background: urgentCount > 0 ? '#b91c1c' : 'var(--red)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>
                {unreadCount}
              </span>
            )}
          </div>
          <div className="si" onClick={() => navigateTo('emergency' as any)}><span>🚨</span> Emergencies</div>
          <div className="si" onClick={() => navigateTo('camps' as any)}><span>⛺</span> Find Camps</div>

          {/* Availability toggle */}
          <div style={{ margin: '1.5rem 1.25rem 0', borderTop: '1px solid var(--gr4)', paddingTop: '1rem' }}>
            <div style={{ fontSize: '10px', color: 'var(--gr2)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Availability</div>
            <button
              className={`btn btn-sm btn-full ${user.status === 'Active' ? 'btn-red' : 'btn-outline'}`}
              onClick={handleToggleAvailability}
            >
              {user.status === 'Active' ? '🟢 Available' : '⚪ Set Available'}
            </button>
          </div>

          {/* XP / Level */}
          <div style={{ margin: '1rem 1.25rem 0', padding: '0.75rem', background: 'var(--gr3)', borderRadius: 'var(--r2)' }}>
            <div style={{ fontSize: '11px', color: 'var(--gr)', marginBottom: '4px' }}>Level {level} • {user.xp} XP</div>
            <div style={{ height: '6px', background: 'var(--gr4)', borderRadius: '3px' }}>
              <div style={{ width: `${Math.min(100, (xpInLevel / 300) * 100)}%`, height: '100%', background: 'var(--red)', borderRadius: '3px', transition: 'width 0.5s' }} />
            </div>
            <div style={{ fontSize: '10px', color: 'var(--gr2)', marginTop: '3px' }}>{300 - xpInLevel} XP to Level {level + 1}</div>
          </div>
        </div>

        {/* Main content */}
        <div className="dash-main">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <div className="dash-header">
                <div>
                  <div className="dash-title">Welcome back, {user.name.split(' ')[0]} 👋</div>
                  <div className="dash-sub">
                    <span className="badge" style={{ background: 'var(--pk)', color: 'var(--red)', marginRight: '6px' }}>{user.bloodType}</span>
                    {user.location} · {isRareType && <span className="badge b-urg" style={{ marginLeft: '4px' }}>Rare Type 💎</span>}
                    {isLifesaver && <span className="badge b-ok" style={{ marginLeft: '4px' }}>Lifesaver ❤️</span>}
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => navigateTo('passport' as any)}>🪪 My Passport</button>
              </div>

              {/* Pending actions banner */}
              {pendingActions.length > 0 && (
                <div style={{ background: '#fff3cd', border: '1px solid #f59e0b', borderRadius: 'var(--r2)', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '13px' }}>
                  <strong>Action needed:</strong>
                  <ul style={{ margin: '4px 0 0 1rem', paddingLeft: '0' }}>
                    {pendingActions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              {/* KPI cards */}
              {loading ? <MetricSkeleton cols={4} /> : (
                <div className="mrow">
                  <div className="mc">
                    <div className="mc-lbl">Total Donations</div>
                    <div className="mc-val">{stats.totalDonations}</div>
                    <div className="mc-ch up">≈ {stats.livesImpact} lives impacted</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Eligibility</div>
                    <div className="mc-val" style={{ color: stats.isEligible ? 'var(--green)' : 'var(--or)', fontSize: '1.1rem' }}>
                      {stats.isEligible ? '✅ Ready Now' : `${stats.daysUntilEligible}d left`}
                    </div>
                    {!stats.isEligible && (
                      <div style={{ height: '4px', background: 'var(--gr4)', borderRadius: '2px', marginTop: '6px' }}>
                        <div style={{ width: `${eligibilityPct}%`, height: '100%', background: 'var(--or)', borderRadius: '2px' }} />
                      </div>
                    )}
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>Last: {fmtDate(stats.lastDonationDate)}</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Leaderboard Rank</div>
                    <div className="mc-val">#{stats.rank ?? '—'}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>of {stats.totalDonors} donors</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">XP Points</div>
                    <div className="mc-val">{user.xp.toLocaleString()}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>Level {level}</div>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>

                {/* Donation activity sparkline */}
                <div className="card">
                  <div className="card-title">Donation Activity (6 months)</div>
                  {loading ? <CardSkeleton lines={2} /> : (
                    monthCounts.every(v => v === 0) ? (
                      <EmptyState icon="🩸" title="No donations yet" body="Complete your first donation to see activity here." />
                    ) : (
                      <>
                        <Sparkline values={monthCounts} height={50} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--gr)', marginTop: '4px' }}>
                          {['6mo', '5mo', '4mo', '3mo', '2mo', 'Now'].map(l => <span key={l}>{l}</span>)}
                        </div>
                      </>
                    )
                  )}
                </div>

                {/* Badges */}
                <div className="card">
                  <div className="card-title">Achievements</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { emoji: '🩸', label: 'First Drop', unlocked: (user.donations || 0) >= 1 },
                      { emoji: '❤️', label: 'Lifesaver', unlocked: isLifesaver },
                      { emoji: '💎', label: 'Rare Type', unlocked: isRareType },
                      { emoji: '🌟', label: 'Top 100', unlocked: stats.rank !== null && stats.rank <= 100 },
                      { emoji: '🦸', label: 'Hero x3', unlocked: (user.donations || 0) >= 3 },
                      { emoji: '🔥', label: 'Dedicated', unlocked: (user.donations || 0) >= 10 },
                    ].map((b) => (
                      <div key={b.label} style={{ textAlign: 'center', padding: '0.5rem', borderRadius: 'var(--r2)', background: b.unlocked ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : 'var(--gr3)', border: b.unlocked ? '1.5px solid #f59e0b' : undefined, opacity: b.unlocked ? 1 : 0.55 }}>
                        <div style={{ fontSize: '1.4rem' }}>{b.emoji}</div>
                        <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', color: b.unlocked ? '#92400e' : 'var(--gr)' }}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Emergency requests they can respond to */}
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="card-title" style={{ margin: 0 }}>🚨 Emergency Requests — {user.bloodType} Compatible</div>
                  <button className="btn btn-outline btn-sm" onClick={() => navigateTo('emergency' as any)}>View all</button>
                </div>
                {loading ? <CardSkeleton /> : compatibleEmergencies.length === 0 ? (
                  <EmptyState icon="✅" title="No active requests" body="No compatible emergency requests right now." />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Hospital</th><th>Blood</th><th>Units</th><th>Urgency</th><th>Ward</th><th>Action</th></tr></thead>
                    <tbody>
                      {compatibleEmergencies.map(e => (
                        <tr key={e.id}>
                          <td>{e.hospital}</td>
                          <td><span className="badge b-crit">{e.bloodType}</span></td>
                          <td>{e.units}</td>
                          <td><span className={`badge ${e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-gray'}`}>{e.urgency}</span></td>
                          <td>{e.ward || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn btn-red btn-sm" disabled={respondingId === e.id} onClick={() => handleRespond(e.id, 'accept')}>
                                {respondingId === e.id ? '…' : 'Accept'}
                              </button>
                              <button className="btn btn-outline btn-sm" disabled={respondingId === e.id} onClick={() => handleRespond(e.id, 'decline')}>
                                Decline
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Upcoming appointments */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '1.25rem' }}>
                <div className="card">
                  <div className="card-title">📆 Upcoming Appointments</div>
                  {loading ? <CardSkeleton /> : upcomingAppointments.length === 0 ? (
                    <EmptyState icon="📅" title="No appointments" body="Book a slot at a camp or hospital." action={
                      <button className="btn btn-red btn-sm" onClick={() => navigateTo('camps' as any)}>Browse camps</button>
                    } />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {upcomingAppointments.map(a => (
                        <div key={a.id} style={{ padding: '10px', background: 'var(--gr3)', borderRadius: 'var(--r2)', fontSize: '12px' }}>
                          <strong>{a.camp_title || a.hospital_name || 'LifeLink'}</strong>
                          <div style={{ color: 'var(--gr)', marginTop: '2px' }}>{fmtDate(a.scheduled_date)}{a.slot ? ` · ${a.slot}` : ''}</div>
                          <span className={`badge ${a.status === 'Confirmed' ? 'b-ok' : 'b-blue'}`} style={{ marginTop: '4px', display: 'inline-block' }}>{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Nearby camps */}
                <div className="card">
                  <div className="card-title">⛺ Recommended Camps</div>
                  {loading ? <CardSkeleton /> : nearbyCamps.length === 0 ? (
                    <EmptyState icon="⛺" title="No upcoming camps" body="Check back later for new donation camp listings." />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {nearbyCamps.map(c => (
                        <div key={c.id} style={{ padding: '10px', background: 'var(--gr3)', borderRadius: 'var(--r2)', fontSize: '12px' }}>
                          <strong>{c.title}</strong>
                          <div style={{ color: 'var(--gr)', marginTop: '2px' }}>{fmtDate(c.date)} · {c.location}</div>
                          <div style={{ marginTop: '4px', color: 'var(--gr)' }}>{c.registered}/{c.limit} registered</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── HISTORY ── */}
          {activeTab === 'history' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Donation History</div><div className="dash-sub">All your recorded donation sessions</div></div>
              </div>
              <div className="card">
                {loading ? <CardSkeleton lines={5} /> : recentDonations.length === 0 ? (
                  <EmptyState icon="🩸" title="No donations yet" body="Your donation history will appear here after your first donation." action={
                    <button className="btn btn-red btn-sm" onClick={() => navigateTo('camps' as any)}>Find a camp</button>
                  } />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Date</th><th>Location</th><th>Channel</th><th>Blood Type</th><th>Status</th></tr></thead>
                    <tbody>
                      {recentDonations.map(d => (
                        <tr key={d.id}>
                          <td>{fmtDate(d.donationDate || d.time)}</td>
                          <td>{d.hospital}</td>
                          <td><span className="badge b-gray" style={{ textTransform: 'capitalize' }}>{d.channel}</span></td>
                          <td><span className="badge b-crit">{d.bloodType}</span></td>
                          <td><span className={`badge ${d.status === 'Completed' ? 'b-ok' : 'b-blue'}`}>{d.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* ── PROFILE ── */}
          {activeTab === 'profile' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">My Profile</div><div className="dash-sub">Profile updates go to admin for verification</div></div>
              </div>
              <div className="card" style={{ maxWidth: '550px' }}>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" value={profileName} onChange={e => setProfileName(e.target.value)} />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Blood Type</label>
                    <input className="form-input" value={user.bloodType} disabled />
                    <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '4px' }}>Locked — verified status</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input className="form-input" value={profileLoc} onChange={e => setProfileLoc(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile</label>
                  <input className="form-input" placeholder="+91 90000 12345" value={profilePhone} onChange={e => setProfilePhone(e.target.value)} />
                </div>
                <button className="btn btn-red" onClick={handleSaveProfile}>Save Profile</button>
              </div>
            </>
          )}

          {/* ── SETTINGS ── */}
          {activeTab === 'settings' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Notifications & Privacy</div></div>
              </div>
              <div className="card" style={{ maxWidth: '550px' }}>
                <p style={{ fontSize: '13px', color: 'var(--gr)', marginBottom: '1rem' }}>
                  Manage how LifeLink contacts you — per category, including Telegram delivery.
                </p>
                <button className="btn btn-red" onClick={() => navigateTo('notification-preferences' as any)}>
                  ⚙️ Open Notification Preferences
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
export default DonorDashboard;
