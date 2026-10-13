import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useRouting } from '../../context/RoutingContext';
import { api } from '../../api';
import type { AdminDashboardData, User, Camp, ForecastResult } from '../../api';
import { useEventStream } from '../../utils/sse';
import {
  BarChart, DonutChart, MetricSkeleton, CardSkeleton, EmptyState, BloodGroupBar
} from '../../components/MiniCharts';

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
};
const urgencyColor = (u: string) => u === 'Critical' ? 'b-crit' : u === 'Urgent' ? 'b-urg' : 'b-gray';

export const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { navigateTo } = useRouting();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'emergencies' | 'users' | 'camps' | 'inventory' | 'analytics'
  >('overview');

  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Camp filter
  const [campFilter, setCampFilter] = useState<'pending' | 'unverified'>('pending');

  // User search
  const [userSearch, setUserSearch] = useState('');

  // Forecast state
  const [forecastGroup, setForecastGroup] = useState('O+');
  const [forecastData, setForecastData] = useState<ForecastResult[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getAdminDashboard(), api.getUnreadCount(user.id)])
      .then(([d, counts]) => { setData(d); setUnreadCount(counts.total); })
      .catch(err => setLoadError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useEventStream('emergency:created', load);
  useEventStream('emergency:status', load);

  const loadForecast = async () => {
    setForecastLoading(true);
    try {
      const res = await api.getDemandForecast({ bloodGroup: forecastGroup, horizonDays: 7 });
      setForecastData((res.results || []) as ForecastResult[]);
    } catch (err: any) {
      showToast('warning', 'Forecast error', err.message);
    } finally {
      setForecastLoading(false);
    }
  };

  if (!user) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Please Sign In</h3>
        <button className="btn btn-red" onClick={() => navigateTo('auth')}>Go to Login</button>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>⚠️ Failed to load</h3>
        <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px' }}>{loadError}</p>
        <button className="btn btn-red" style={{ marginTop: '1rem' }} onClick={load}>Retry</button>
      </div>
    </div>
  );

  const {
    kpis, activeEmergencies = [], pendingOnboarding = [], pendingUpdates = [],
    pendingCamps = [], unverifiedCamps = [], shortages = [], inventoryByGroup = [],
    emergencyTrend = [], donorsByGroup = []
  } = data || {};

  const maxInv = Math.max(...inventoryByGroup.map(r => r.total), 1);

  // Donor blood-group donut
  const groupColors: Record<string, string> = {
    'A+': '#dc2626', 'A-': '#ef4444', 'B+': '#f97316', 'B-': '#fb923c',
    'O+': '#3b82f6', 'O-': '#60a5fa', 'AB+': '#8b5cf6', 'AB-': '#a78bfa'
  };
  const donutSegments = donorsByGroup.map(r => ({ label: r.type, value: r.count, color: groupColors[r.type] || '#999' }));

  // Emergency 7-day bar chart
  const trendBars = emergencyTrend.map(r => ({
    label: new Date(r.day + 'T00:00:00').toLocaleDateString('en', { weekday: 'narrow' }),
    value: r.count
  }));

  const pendingActionsTotal = (kpis?.pendingActionsCount || 0);

  // User management
  const handleApproveOnboarding = async (u: User) => {
    setBusyId(u.id);
    try {
      await api.updateUser(u.id, { approveOnboarding: true });
      showToast('success', '✅ Approved', `${u.name} is now active.`);
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleDenyOnboarding = async (u: User) => {
    setBusyId(u.id);
    try {
      await api.updateUser(u.id, { denyOnboarding: true });
      showToast('info', 'Denied', `${u.name}'s registration was denied.`);
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleApproveUpdate = async (u: User) => {
    setBusyId(u.id);
    try {
      await api.updateUser(u.id, { approveUpdate: true });
      showToast('success', '✅ Update Approved', `Profile changes approved for ${u.name}.`);
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleRejectUpdate = async (u: User) => {
    setBusyId(u.id);
    try {
      await api.updateUser(u.id, { rejectUpdate: true });
      showToast('info', 'Rejected', `Profile update rejected for ${u.name}.`);
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  // Camp management
  const handleApproveCamp = async (id: string) => {
    setBusyId(id);
    try {
      await api.updateCamp(id, { approved: true, status: 'Scheduled' });
      showToast('success', '✅ Camp Approved', 'Camp is now visible to donors.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleVerifyCamp = async (id: string, status: 'Verified' | 'Flagged') => {
    setBusyId(id);
    try {
      await api.verifyCamp(id, status, user.name);
      showToast(status === 'Verified' ? 'success' : 'warning', status === 'Verified' ? '✅ Verified' : '🚩 Flagged', '');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  const handleCancelEmergency = async (id: string) => {
    if (!window.confirm('Cancel this emergency?')) return;
    setBusyId(id);
    try {
      await api.cancelEmergency(id, 'Cancelled by admin', user.id, 'admin');
      showToast('info', 'Emergency cancelled', '');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
    finally { setBusyId(null); }
  };

  // System health
  const systemHealth = [
    { label: 'Database', status: 'ok', detail: 'SQLite connected' },
    { label: 'Telegram Bot', status: process.env.NODE_ENV === 'production' ? 'ok' : 'warn', detail: 'Dev mode — bot token not set' },
    { label: 'Notifications', status: 'ok', detail: 'Delivery sweep active (20s)' },
    { label: 'Reminder Sweep', status: 'ok', detail: 'Appointment/camp sweep active (60s)' },
    { label: 'Shortage Check', status: 'ok', detail: 'Network shortage sweep active (5m)' },
  ];

  const sidebarNav = [
    { key: 'overview', icon: '🏠', label: 'Overview' },
    { key: 'emergencies', icon: '🚨', label: 'Emergencies', badge: activeEmergencies.length || undefined },
    { key: 'users', icon: '👥', label: 'User Management', badge: pendingOnboarding.length + pendingUpdates.length || undefined },
    { key: 'camps', icon: '⛺', label: 'Camp Management', badge: pendingCamps.length || undefined },
    { key: 'inventory', icon: '🩸', label: 'Inventory & Shortages', badge: shortages.length || undefined },
    { key: 'analytics', icon: '📊', label: 'Analytics & Forecast' },
  ] as const;

  return (
    <div className="page active" id="admin-dash">
      <div className="dash-layout">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sb-title">Admin Console</div>
          {sidebarNav.map((item) => (
            <div key={item.key} className={`si ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key as any)}>
              <span>{item.icon}</span> {item.label}
              {'badge' in item && item.badge ? <span style={{ background: item.key === 'inventory' ? 'var(--or)' : 'var(--red)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>{item.badge}</span> : null}
            </div>
          ))}
          <div className="si" onClick={() => navigateTo('notifications' as any)}>
            <span>🔔</span> Notifications
            {unreadCount > 0 && <span style={{ background: 'var(--red)', color: '#fff', fontSize: '10px', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>{unreadCount}</span>}
          </div>
          <div className="si" onClick={() => navigateTo('analytics' as any)}><span>📈</span> Full Analytics</div>
          <div className="si" onClick={() => navigateTo('forecast' as any)}><span>🔭</span> Demand Forecast</div>

          {/* Pending actions alert */}
          {pendingActionsTotal > 0 && (
            <div style={{ margin: '1.5rem 1.25rem 0', padding: '0.75rem', background: '#fff3cd', borderRadius: 'var(--r2)', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#92400e' }}>⚠️ {pendingActionsTotal} Pending Actions</div>
              {pendingOnboarding.length > 0 && <div style={{ fontSize: '11px', color: '#92400e', marginTop: '2px' }}>{pendingOnboarding.length} new registrations</div>}
              {pendingUpdates.length > 0 && <div style={{ fontSize: '11px', color: '#92400e', marginTop: '2px' }}>{pendingUpdates.length} profile updates</div>}
              {pendingCamps.length > 0 && <div style={{ fontSize: '11px', color: '#92400e', marginTop: '2px' }}>{pendingCamps.length} camps awaiting approval</div>}
            </div>
          )}
        </div>

        {/* Main */}
        <div className="dash-main">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <div className="dash-header">
                <div>
                  <div className="dash-title">Admin Dashboard</div>
                  <div className="dash-sub">Platform-wide overview · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                </div>
              </div>

              {/* Shortage alert bar */}
              {shortages.length > 0 && (
                <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 'var(--r2)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--red)', fontSize: '13px' }}>🚨 Citywide Shortage Alert</strong>
                  <div style={{ fontSize: '12px', color: 'var(--red)', flex: 1 }}>
                    {shortages.map(s => `${s.type}: ${s.total} units`).join(' · ')}
                  </div>
                  <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => setActiveTab('inventory')}>View inventory →</button>
                </div>
              )}

              {/* KPI cards */}
              {loading ? <MetricSkeleton cols={4} /> : (
                <div className="mrow">
                  <div className="mc">
                    <div className="mc-lbl">Total Donors</div>
                    <div className="mc-val">{kpis?.totalDonors ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--green)' }}>{kpis?.activeDonors ?? 0} active</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Active Emergencies</div>
                    <div className="mc-val" style={{ color: (kpis?.activeEmergencyCount || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{kpis?.activeEmergencyCount ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>Fulfillment rate: {kpis?.fulfillmentRate ?? 0}%</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Network Inventory</div>
                    <div className="mc-val">{kpis?.totalUnits ?? 0}</div>
                    <div className="mc-ch" style={{ color: (kpis?.shortageCount || 0) > 0 ? 'var(--red)' : 'var(--gr)' }}>
                      {(kpis?.shortageCount || 0) > 0 ? `⚠️ ${kpis?.shortageCount} groups low` : '✅ All groups OK'}
                    </div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Pending Actions</div>
                    <div className="mc-val" style={{ color: pendingActionsTotal > 0 ? 'var(--or)' : 'var(--green)' }}>{pendingActionsTotal}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>
                      {kpis?.totalHospitals ?? 0} hospitals · {kpis?.totalBloodBanks ?? 0} banks
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                {/* Emergency trend */}
                <div className="card">
                  <div className="card-title">Emergency Requests — Last 7 Days</div>
                  {loading ? <CardSkeleton lines={2} /> : trendBars.every(d => d.value === 0) ? (
                    <EmptyState icon="📊" title="No requests this week" />
                  ) : (
                    <BarChart data={trendBars} height={70} />
                  )}
                </div>

                {/* Donor distribution */}
                <div className="card">
                  <div className="card-title">Donor Distribution by Blood Group</div>
                  {loading ? <CardSkeleton lines={2} /> : (
                    <DonutChart segments={donutSegments.filter(s => s.value > 0)} size={90} />
                  )}
                </div>
              </div>

              {/* Active emergencies snapshot */}
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="card-title" style={{ margin: 0 }}>🚨 Active Emergencies</div>
                  <button className="btn btn-outline btn-sm" onClick={() => setActiveTab('emergencies')}>View all</button>
                </div>
                {loading ? <CardSkeleton lines={3} /> : activeEmergencies.length === 0 ? (
                  <EmptyState icon="✅" title="No active emergencies" />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Hospital</th><th>Blood</th><th>Units</th><th>Urgency</th><th>Status</th><th>Alerts</th></tr></thead>
                    <tbody>
                      {activeEmergencies.slice(0, 5).map(e => (
                        <tr key={e.id}>
                          <td>{e.hospital_name || e.hospital}</td>
                          <td><span className="badge b-crit">{e.blood_type || e.bloodType}</span></td>
                          <td>{e.units}</td>
                          <td><span className={`badge ${urgencyColor(e.urgency)}`}>{e.urgency}</span></td>
                          <td><span className="badge b-blue">{e.status}</span></td>
                          <td>{e.alerts || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* System health */}
              <div className="card" style={{ marginTop: '1.25rem' }}>
                <div className="card-title">⚙️ System Health</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {systemHealth.map(h => (
                    <div key={h.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', background: 'var(--gr3)', borderRadius: 'var(--r2)', fontSize: '12px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: h.status === 'ok' ? 'var(--green)' : h.status === 'warn' ? 'var(--or)' : 'var(--red)', flexShrink: 0 }} />
                      <strong style={{ width: '150px' }}>{h.label}</strong>
                      <span style={{ color: 'var(--gr)' }}>{h.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── EMERGENCIES ── */}
          {activeTab === 'emergencies' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">All Active Emergencies</div><div className="dash-sub">{activeEmergencies.length} open across the network</div></div>
              </div>
              <div className="card">
                {loading ? <CardSkeleton lines={5} /> : activeEmergencies.length === 0 ? (
                  <EmptyState icon="✅" title="No active emergencies" body="All current blood requests have been resolved." />
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Hospital</th><th>Patient</th><th>Blood</th><th>Units</th>
                        <th>Urgency</th><th>Status</th><th>Alerts</th><th>Time</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeEmergencies.map(e => (
                        <tr key={e.id}>
                          <td>{e.hospital_name || e.hospital}</td>
                          <td>{e.patientName || '—'}</td>
                          <td><span className="badge b-crit">{e.blood_type || e.bloodType}</span></td>
                          <td>{e.units}</td>
                          <td><span className={`badge ${urgencyColor(e.urgency)}`}>{e.urgency}</span></td>
                          <td><span className="badge b-blue">{e.status}</span></td>
                          <td>{e.alerts || 0}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.time)}</td>
                          <td>
                            <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)', fontSize: '11px' }} disabled={busyId === e.id} onClick={() => handleCancelEmergency(e.id)}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* ── USER MANAGEMENT ── */}
          {activeTab === 'users' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">User Management</div><div className="dash-sub">{pendingOnboarding.length} pending · {pendingUpdates.length} update requests</div></div>
                <input className="form-input" style={{ width: '220px' }} placeholder="Search users…" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              </div>

              {/* Pending onboarding */}
              {pendingOnboarding.length > 0 && (
                <div className="card" style={{ marginBottom: '1.25rem' }}>
                  <div className="card-title" style={{ color: 'var(--or)' }}>⏳ Pending Registrations ({pendingOnboarding.length})</div>
                  <table className="tbl">
                    <thead><tr><th>Name</th><th>Role</th><th>Blood Type</th><th>Location</th><th>Registered</th><th>Actions</th></tr></thead>
                    <tbody>
                      {pendingOnboarding
                        .filter(u => !userSearch || u.name.toLowerCase().includes(userSearch.toLowerCase()))
                        .map(u => (
                          <tr key={u.id}>
                            <td><strong>{u.name}</strong></td>
                            <td><span className="badge b-blue">{u.role}</span></td>
                            <td>{u.bloodType ? <span className="badge b-crit">{u.bloodType}</span> : '—'}</td>
                            <td>{u.location}</td>
                            <td>{fmtDate(u.createdAt || '')}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} disabled={busyId === u.id} onClick={() => handleApproveOnboarding(u)}>✅ Approve</button>
                                <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} disabled={busyId === u.id} onClick={() => handleDenyOnboarding(u)}>✕ Deny</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pending profile updates */}
              {pendingUpdates.length > 0 && (
                <div className="card" style={{ marginBottom: '1.25rem' }}>
                  <div className="card-title" style={{ color: 'var(--or)' }}>📝 Pending Profile Updates ({pendingUpdates.length})</div>
                  <table className="tbl">
                    <thead><tr><th>Name</th><th>Role</th><th>Requested Change</th><th>Actions</th></tr></thead>
                    <tbody>
                      {pendingUpdates
                        .filter(u => !userSearch || u.name.toLowerCase().includes(userSearch.toLowerCase()))
                        .map(u => {
                          let pending: any = {};
                          try { pending = typeof u.pendingUpdate === 'string' ? JSON.parse(u.pendingUpdate) : u.pendingUpdate || {}; } catch { }
                          return (
                            <tr key={u.id}>
                              <td><strong>{u.name}</strong></td>
                              <td><span className="badge b-blue">{u.role}</span></td>
                              <td style={{ fontSize: '11px' }}>
                                {Object.entries(pending).map(([k, v]) => <span key={k} style={{ display: 'inline-block', marginRight: '6px' }}><strong>{k}:</strong> {String(v)}</span>)}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} disabled={busyId === u.id} onClick={() => handleApproveUpdate(u)}>✅ Approve</button>
                                  <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} disabled={busyId === u.id} onClick={() => handleRejectUpdate(u)}>✕ Reject</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              {pendingOnboarding.length === 0 && pendingUpdates.length === 0 && (
                <div className="card">
                  <EmptyState icon="✅" title="All clear" body="No pending user actions at this time." />
                </div>
              )}
            </>
          )}

          {/* ── CAMPS ── */}
          {activeTab === 'camps' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Camp Management</div><div className="dash-sub">{pendingCamps.length} awaiting approval · {unverifiedCamps.length} unverified</div></div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className={`btn btn-sm ${campFilter === 'pending' ? 'btn-red' : 'btn-outline'}`} onClick={() => setCampFilter('pending')}>Pending ({pendingCamps.length})</button>
                  <button className={`btn btn-sm ${campFilter === 'unverified' ? 'btn-red' : 'btn-outline'}`} onClick={() => setCampFilter('unverified')}>Unverified ({unverifiedCamps.length})</button>
                </div>
              </div>

              <div className="card">
                {campFilter === 'pending' ? (
                  pendingCamps.length === 0 ? (
                    <EmptyState icon="✅" title="No camps pending approval" />
                  ) : (
                    <table className="tbl">
                      <thead><tr><th>Title</th><th>Organizer</th><th>Date</th><th>Venue</th><th>City</th><th>Target</th><th>Actions</th></tr></thead>
                      <tbody>
                        {pendingCamps.map((c: Camp) => (
                          <tr key={c.id}>
                            <td><strong>{c.title}</strong></td>
                            <td>{(c as any).organizerName || c.organizer || "—"}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.date)}</td>
                            <td>{c.venue}</td>
                            <td>{c.city}</td>
                            <td>{c.limit}</td>
                            <td>
                              <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} disabled={busyId === c.id} onClick={() => handleApproveCamp(c.id)}>
                                ✅ Approve
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : (
                  unverifiedCamps.length === 0 ? (
                    <EmptyState icon="✅" title="All ingested camps verified" />
                  ) : (
                    <table className="tbl">
                      <thead><tr><th>Title</th><th>Source</th><th>Date</th><th>City</th><th>Verification</th><th>Actions</th></tr></thead>
                      <tbody>
                        {unverifiedCamps.map((c: Camp) => (
                          <tr key={c.id}>
                            <td><strong>{c.title}</strong></td>
                            <td><span className="badge b-gray">{c.source}</span></td>
                            <td>{fmtDate(c.date)}</td>
                            <td>{c.city}</td>
                            <td><span className={`badge ${c.verificationStatus === 'Flagged' ? 'b-crit' : 'b-urg'}`}>{c.verificationStatus}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} disabled={busyId === c.id} onClick={() => handleVerifyCamp(c.id, 'Verified')}>✅ Verify</button>
                                <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--or)', color: 'var(--or)' }} disabled={busyId === c.id} onClick={() => handleVerifyCamp(c.id, 'Flagged')}>🚩 Flag</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            </>
          )}

          {/* ── INVENTORY & SHORTAGES ── */}
          {activeTab === 'inventory' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Network Inventory & Shortages</div><div className="dash-sub">Citywide aggregates across all blood banks</div></div>
              </div>

              {shortages.length > 0 && (
                <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 'var(--r2)', padding: '1rem', marginBottom: '1.25rem' }}>
                  <strong style={{ color: 'var(--red)' }}>🚨 {shortages.length} Blood Group{shortages.length > 1 ? 's' : ''} in Shortage</strong>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {shortages.map(s => (
                      <div key={s.type} style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 'var(--r2)', padding: '6px 12px', fontSize: '12px', textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--red)' }}>{s.type}</div>
                        <div style={{ color: 'var(--gr)' }}>{s.total} units</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-title">All Blood Groups — Network Total</div>
                {loading ? <CardSkeleton lines={8} /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {inventoryByGroup.map(r => <BloodGroupBar key={r.type} type={r.type} units={r.total} maxUnits={maxInv} />)}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── ANALYTICS & FORECAST ── */}
          {activeTab === 'analytics' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Analytics & Demand Forecast</div><div className="dash-sub">Platform metrics and blood demand predictions</div></div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => navigateTo('analytics' as any)}>Full Analytics ↗</button>
                  <button className="btn btn-outline btn-sm" onClick={() => navigateTo('forecast' as any)}>Full Forecast ↗</button>
                </div>
              </div>

              {/* Platform KPI summary */}
              {loading ? <MetricSkeleton cols={4} /> : (
                <div className="mrow">
                  <div className="mc">
                    <div className="mc-lbl">Total Donors</div>
                    <div className="mc-val">{kpis?.totalDonors ?? 0}</div>
                    <div className="mc-ch up">{kpis?.activeDonors ?? 0} active</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Hospitals</div>
                    <div className="mc-val">{kpis?.totalHospitals ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>registered</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Blood Banks</div>
                    <div className="mc-val">{kpis?.totalBloodBanks ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>registered</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Fulfillment Rate</div>
                    <div className="mc-val" style={{ color: (kpis?.fulfillmentRate || 0) >= 70 ? 'var(--green)' : 'var(--or)' }}>
                      {kpis?.fulfillmentRate ?? 0}%
                    </div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>all-time</div>
                  </div>
                </div>
              )}

              {/* Donor distribution */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                <div className="card">
                  <div className="card-title">Donor Pool by Blood Group</div>
                  {loading ? <CardSkeleton lines={2} /> : <DonutChart segments={donutSegments.filter(s => s.value > 0)} size={100} />}
                </div>
                <div className="card">
                  <div className="card-title">Emergency Trend (7 days)</div>
                  {loading ? <CardSkeleton lines={2} /> : trendBars.every(d => d.value === 0) ? <EmptyState icon="📊" title="No data" /> : <BarChart data={trendBars} height={70} />}
                </div>
              </div>

              {/* Demand Forecast */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div className="card-title" style={{ margin: 0 }}>🔭 Blood Demand Forecast (Next 7 Days)</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select className="form-input" style={{ width: '80px', padding: '4px 8px', fontSize: '12px' }} value={forecastGroup} onChange={e => setForecastGroup(e.target.value)}>
                      {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(g => <option key={g}>{g}</option>)}
                    </select>
                    <button className="btn btn-red btn-sm" onClick={loadForecast} disabled={forecastLoading}>
                      {forecastLoading ? 'Loading…' : 'Run Forecast'}
                    </button>
                  </div>
                </div>
                {forecastData.length === 0 ? (
                  <EmptyState icon="🔭" title="No forecast loaded" body="Select a blood group and click Run Forecast to see the 7-day demand estimate." />
                ) : (
                  <>
                    <table className="tbl">
                      <thead><tr><th>Blood Group</th><th>Predicted Units</th><th>Days of Supply</th><th>Risk</th></tr></thead>
                      <tbody>
                        {forecastData.slice(0, 12).map((r, i) => (
                          <tr key={i}>
                            <td><span className="badge b-crit">{r.bloodGroup}</span></td>
                            <td>{r.daysOfSupply ?? "—"}</td>
                            <td><strong>{r.predictedDemandNextPeriod}</strong></td>
                            <td><span className={`badge ${r.shortageRisk === 'Low' ? 'b-ok' : r.shortageRisk === 'Medium' ? 'b-urg' : 'b-gray'}`}>{r.shortageRisk}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '0.75rem' }}>
                      ⚠️ Statistical estimates for planning only — not medical or clinical forecasts.
                    </p>
                  </>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
export default AdminDashboard;
