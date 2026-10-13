import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useRouting } from '../../context/RoutingContext';
import { api } from '../../api';
import type { HospitalDashboardData, User } from '../../api';
import { useEventStream } from '../../utils/sse';
import { BloodGroupBar, MetricSkeleton, CardSkeleton, EmptyState, BarChart } from '../../components/MiniCharts';
import { STATUS_META } from '../Emergency';

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const urgencyColor = (u: string) => u === 'Critical' ? 'b-crit' : u === 'Urgent' ? 'b-urg' : 'b-gray';

export const HospitalDashboard: React.FC = () => {
  const { user, usersList } = useAuth();
  const { showToast } = useToast();
  const { navigateTo } = useRouting();

  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'inventory' | 'verify'>('overview');
  const [data, setData] = useState<HospitalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);

  // Passport verify
  const [passportInput, setPassportInput] = useState('');
  const [verifiedDonor, setVerifiedDonor] = useState<User | null>(null);
  const [isCampMatch, setIsCampMatch] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([api.getHospitalDashboard(), api.getUnreadCount(user.id)])
      .then(([d, counts]) => { setData(d); setUnreadCount(counts.total); setUrgentCount(counts.urgent); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useEventStream('emergency:created', load);
  useEventStream('emergency:status', load);
  useEventStream('emergency:match-response', (ev) => {
    if (ev.response === 'accept') showToast('success', '🙋 Donor responded!', 'Someone accepted your emergency request.');
    load();
  });

  if (!user) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Please Sign In</h3>
        <button className="btn btn-red" onClick={() => navigateTo('auth')}>Go to Login</button>
      </div>
    </div>
  );

  const { kpis, myEmergencies = [], awaitingReserve = [], inventory = [], recentDonations = [] } = data || {};
  const NON_TERMINAL = ['Pending', 'Searching', 'Donors Notified', 'Donor Responded', 'Blood Reserved'];
  const activeReqs = myEmergencies.filter(e => NON_TERMINAL.includes(e.status));
  const historyReqs = myEmergencies.filter(e => !NON_TERMINAL.includes(e.status));

  const maxInventory = Math.max(...inventory.map(r => r.total), 1);

  // Bar chart: last 7 days of requests trend (derive from myEmergencies)
  const trendData = (() => {
    const days: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ label: d.toLocaleDateString('en', { weekday: 'narrow' }), value: myEmergencies.filter(e => (e.time || '').startsWith(key)).length });
    }
    return days;
  })();

  const handleReserve = async (emergencyId: string, donorId: string) => {
    setBusyId(emergencyId + donorId);
    try {
      await api.reserveEmergencyDonor(emergencyId, donorId, user.id);
      showToast('success', '📦 Reserved', 'Donor reserved. Ask them to come in for donation.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleFulfill = async (emergencyId: string) => {
    setBusyId(emergencyId);
    try {
      await api.fulfillEmergency(emergencyId, user.id);
      showToast('success', '✅ Fulfilled', 'Emergency request marked as fulfilled.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleCancel = async (emergencyId: string) => {
    if (!window.confirm('Cancel this request?')) return;
    setBusyId(emergencyId);
    try {
      await api.cancelEmergency(emergencyId, 'Cancelled by hospital', user.id, 'hospital');
      showToast('info', 'Request cancelled', '');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleVerifyPassport = () => {
    const pid = passportInput.trim().toLowerCase();
    const matched = usersList.find(u => u.passportId?.toLowerCase() === pid || u.activeCampRegistration?.verificationId?.toLowerCase() === pid);
    if (matched) {
      setVerifiedDonor(matched);
      setIsCampMatch(!!matched.activeCampRegistration?.verificationId && matched.activeCampRegistration.verificationId.toLowerCase() === pid);
      showToast('success', '✅ Verified', `Donor: ${matched.name}`);
    } else {
      setVerifiedDonor(null); setIsCampMatch(false);
      showToast('warning', '❌ Not found', `No passport matched: "${passportInput}"`);
    }
  };

  const handleApproveDraw = async () => {
    if (!verifiedDonor) return;
    try {
      const payload: any = { donations: (verifiedDonor.donations || 0) + 1, xp: (verifiedDonor.xp || 0) + 200 };
      if (isCampMatch) payload.activeCampRegistration = null;
      await api.updateUser(verifiedDonor.id, payload);
      showToast('success', '🩸 Draw Approved', `Donation recorded for ${verifiedDonor.name}.`);
      setVerifiedDonor(null); setPassportInput(''); load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const sidebarNav = [
    { key: 'overview', icon: '🏠', label: 'Overview' },
    { key: 'requests', icon: '🚨', label: 'Blood Requests', badge: activeReqs.length || undefined },
    { key: 'inventory', icon: '🩸', label: 'Blood Availability' },
    { key: 'verify', icon: '🪪', label: 'Verify Donors' },
  ] as const;

  return (
    <div className="page active" id="hospital-dash">
      <div className="dash-layout">
        <div className="sidebar">
          <div className="sb-title">Hospital Portal</div>
          {sidebarNav.map(({ key, icon, label, ...rest }) => (
            <div key={key} className={`si ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key as any)}>
              <span>{icon}</span> {label}
              {(rest as any).badge ? <span style={{ background: 'var(--red)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>{(rest as any).badge}</span> : null}
            </div>
          ))}
          <div className="si" onClick={() => navigateTo('notifications' as any)}>
            <span>🔔</span> Notifications
            {unreadCount > 0 && <span style={{ background: urgentCount > 0 ? '#b91c1c' : 'var(--red)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>{unreadCount}</span>}
          </div>
          <div className="si" onClick={() => navigateTo('ai-match' as any)}><span>🧠</span> AI Matching</div>
          <div className="si" onClick={() => navigateTo('emergency' as any)}><span>🗺</span> Emergency Map</div>
        </div>

        <div className="dash-main">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <div className="dash-header">
                <div>
                  <div className="dash-title">Hospital Dashboard</div>
                  <div className="dash-sub">{user.name} · {user.location}</div>
                </div>
                <button className="btn btn-red btn-sm" onClick={() => navigateTo('emergency' as any)}>+ New Request</button>
              </div>

              {/* KPI row */}
              {loading ? <MetricSkeleton cols={4} /> : (
                <div className="mrow">
                  <div className="mc">
                    <div className="mc-lbl">Active Requests</div>
                    <div className="mc-val" style={{ color: (kpis?.activeRequests || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{kpis?.activeRequests ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>{kpis?.awaitingReserveCount || 0} awaiting reserve</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Fulfilled (All Time)</div>
                    <div className="mc-val">{kpis?.fulfilledTotal ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>This month: {kpis?.thisMonthRequests ?? 0}</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Avg. Fulfillment Time</div>
                    <div className="mc-val" style={{ fontSize: '1.1rem' }}>{kpis?.avgFulfillmentMinutes != null ? `${kpis.avgFulfillmentMinutes}m` : '—'}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>median to fulfil</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">vs Last Month</div>
                    <div className="mc-val" style={{ fontSize: '1.1rem', color: (kpis?.thisMonthRequests || 0) > (kpis?.lastMonthRequests || 0) ? 'var(--red)' : 'var(--green)' }}>
                      {kpis?.thisMonthRequests || 0} / {kpis?.lastMonthRequests || 0}
                    </div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>this / last month</div>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                {/* 7-day trend */}
                <div className="card">
                  <div className="card-title">Requests — Last 7 Days</div>
                  {loading ? <CardSkeleton lines={2} /> : (
                    trendData.every(d => d.value === 0) ? <EmptyState icon="📊" title="No requests this week" /> : <BarChart data={trendData} height={60} />
                  )}
                </div>

                {/* Donors awaiting reserve */}
                <div className="card">
                  <div className="card-title" style={{ color: awaitingReserve.length > 0 ? 'var(--red)' : undefined }}>
                    🙋 Donors Ready to Reserve ({awaitingReserve.length})
                  </div>
                  {loading ? <CardSkeleton /> : awaitingReserve.length === 0 ? (
                    <EmptyState icon="⏳" title="No pending responses" body="Donors who accept your requests appear here." />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {awaitingReserve.slice(0, 4).map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--gr3)', borderRadius: 'var(--r2)', fontSize: '12px' }}>
                          <div>
                            <strong>{m.donor_name || `Donor ${m.donor_id}`}</strong>
                            <span className="badge b-crit" style={{ marginLeft: '6px' }}>{m.blood_type}</span>
                          </div>
                          <button className="btn btn-red btn-sm" disabled={busyId === m.emergency_id + m.donor_id} onClick={() => handleReserve(m.emergency_id, m.donor_id)}>
                            📦 Reserve
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent activity */}
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div className="card-title">Recent Donation Activity</div>
                {loading ? <CardSkeleton lines={3} /> : recentDonations.length === 0 ? (
                  <EmptyState icon="📋" title="No donations recorded" body="Donations you approve via passport verification appear here." />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Donor</th><th>Blood Type</th><th>Date</th><th>Status</th></tr></thead>
                    <tbody>
                      {recentDonations.slice(0, 6).map(d => (
                        <tr key={d.id}>
                          <td>{d.donor}</td>
                          <td><span className="badge b-crit">{d.bloodType}</span></td>
                          <td>{fmtDate(d.time)}</td>
                          <td><span className={`badge ${d.status === 'Completed' ? 'b-ok' : 'b-blue'}`}>{d.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* ── REQUESTS ── */}
          {activeTab === 'requests' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Blood Requests</div><div className="dash-sub">{activeReqs.length} active · {historyReqs.length} historical</div></div>
                <button className="btn btn-red btn-sm" onClick={() => navigateTo('emergency' as any)}>+ New Request</button>
              </div>

              {/* Active */}
              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <div className="card-title">Active Requests</div>
                {loading ? <CardSkeleton lines={3} /> : activeReqs.length === 0 ? (
                  <EmptyState icon="✅" title="No active requests" body="Create a new emergency request when you need blood." action={
                    <button className="btn btn-red btn-sm" onClick={() => navigateTo('emergency' as any)}>Create request</button>
                  } />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Patient</th><th>Blood</th><th>Units</th><th>Urgency</th><th>Status</th><th>Alerts</th><th>Actions</th></tr></thead>
                    <tbody>
                      {activeReqs.map(e => {
                        const sm = STATUS_META[e.status as keyof typeof STATUS_META];
                        const busy = busyId === e.id;
                        return (
                          <tr key={e.id}>
                            <td>{e.patientName || '—'}</td>
                            <td><span className="badge b-crit">{e.blood_type_label || e.bloodType}</span></td>
                            <td>{e.units}</td>
                            <td><span className={`badge ${urgencyColor(e.urgency)}`}>{e.urgency}</span></td>
                            <td><span className={`badge ${sm?.badge || 'b-gray'}`}>{sm?.icon} {e.status}</span></td>
                            <td>{e.alerts || 0}</td>
                            <td>
                              {e.status === 'Donor Responded' && awaitingReserve.filter(m => m.emergency_id === e.id).map(m => (
                                <button key={m.id} className="btn btn-red btn-sm" disabled={busy} onClick={() => handleReserve(e.id, m.donor_id)}>📦 Reserve</button>
                              ))}
                              {e.status === 'Blood Reserved' && (
                                <button className="btn btn-red btn-sm" disabled={busy} onClick={() => handleFulfill(e.id)}>✅ Fulfill</button>
                              )}
                              {!['Donor Responded','Blood Reserved'].includes(e.status) && (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button className="btn btn-gray btn-sm" onClick={() => navigateTo('ai-match' as any)}>🧠 Match</button>
                                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleCancel(e.id)}>✕</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* History */}
              <div className="card">
                <div className="card-title">Request History</div>
                {historyReqs.length === 0 ? <p style={{ fontSize: '13px', color: 'var(--gr)' }}>No completed or cancelled requests yet.</p> : (
                  <table className="tbl">
                    <thead><tr><th>Patient</th><th>Blood</th><th>Units</th><th>Urgency</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody>
                      {historyReqs.slice(0, 10).map(e => (
                        <tr key={e.id}>
                          <td>{e.patientName || '—'}</td>
                          <td><span className="badge b-crit">{e.blood_type_label || e.bloodType}</span></td>
                          <td>{e.units}</td>
                          <td><span className={`badge ${urgencyColor(e.urgency)}`}>{e.urgency}</span></td>
                          <td><span className={`badge ${e.status === 'Fulfilled' ? 'b-ok' : 'b-gray'}`}>{e.status}</span></td>
                          <td>{fmtDate(e.time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* ── INVENTORY ── */}
          {activeTab === 'inventory' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Blood Availability</div><div className="dash-sub">Network-wide stock across all LifeLink blood banks</div></div>
              </div>
              <div className="card">
                {loading ? <CardSkeleton lines={8} /> : inventory.length === 0 ? (
                  <EmptyState icon="📦" title="No inventory data" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {inventory.map(r => (
                      <BloodGroupBar key={r.type} type={r.type} units={r.total} maxUnits={maxInventory} />
                    ))}
                  </div>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--gr)', marginTop: '0.75rem' }}>
                Inventory shown is the citywide total across all partnered blood banks. Contact a blood bank directly to initiate a transfer.
              </p>
            </>
          )}

          {/* ── VERIFY ── */}
          {activeTab === 'verify' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Verify Donor Passport</div><div className="dash-sub">Confirm donor identity before drawing blood</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div className="card">
                  <div className="card-title">🪪 Audit Donor ID</div>
                  <div className="form-group">
                    <label className="form-label">Digital Passport ID or Camp Verification ID</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input className="form-input" placeholder="e.g. LL-DEMO-CBE-1000" value={passportInput} onChange={e => setPassportInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleVerifyPassport()} />
                      <button className="btn btn-red" onClick={handleVerifyPassport}>Verify</button>
                    </div>
                  </div>
                  {verifiedDonor && (
                    <div style={{ background: 'var(--gr3)', padding: '1rem', borderRadius: 'var(--r2)', marginTop: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                          {verifiedDonor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <strong>{verifiedDonor.name}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--gr)' }}>{verifiedDonor.passportId}</div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                        <div><strong>Blood:</strong> <span style={{ color: 'var(--red)', fontWeight: 800 }}>{verifiedDonor.bloodType}</span></div>
                        <div><strong>Status:</strong> <span className="badge b-ok">{verifiedDonor.status}</span></div>
                        <div><strong>Donations:</strong> {verifiedDonor.donations}</div>
                        <div><strong>Location:</strong> {verifiedDonor.location}</div>
                      </div>
                      {isCampMatch && verifiedDonor.activeCampRegistration && (
                        <div style={{ background: '#fff5f5', padding: '0.75rem', borderRadius: 'var(--r)', border: '1px solid var(--red)', marginTop: '8px' }}>
                          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--red)', marginBottom: '4px' }}>🗓 ACTIVE CAMP APPOINTMENT</div>
                          <div style={{ fontSize: '12px', fontWeight: 700 }}>{verifiedDonor.activeCampRegistration.campTitle}</div>
                          <div style={{ fontSize: '11px', color: 'var(--gr)' }}>Slot: {verifiedDonor.activeCampRegistration.slot} · {verifiedDonor.activeCampRegistration.date}</div>
                        </div>
                      )}
                      <button className="btn btn-red btn-sm btn-full" style={{ marginTop: '12px' }} onClick={handleApproveDraw}>
                        {isCampMatch ? '✅ Confirm Check-In & Draw' : '✅ Approve Donation Draw'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="card">
                  <div className="card-title">Recent Verifications</div>
                  {recentDonations.length === 0 ? <EmptyState icon="📋" title="No verifications yet" /> : (
                    <table className="tbl" style={{ fontSize: '12px' }}>
                      <thead><tr><th>Donor</th><th>Blood</th><th>Date</th><th>Status</th></tr></thead>
                      <tbody>
                        {recentDonations.slice(0, 6).map(d => (
                          <tr key={d.id}>
                            <td>{d.donor}</td>
                            <td><span className="badge b-crit">{d.bloodType}</span></td>
                            <td>{fmtDate(d.time)}</td>
                            <td><span className={`badge ${d.status === 'Completed' ? 'b-ok' : 'b-blue'}`}>{d.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
export default HospitalDashboard;
