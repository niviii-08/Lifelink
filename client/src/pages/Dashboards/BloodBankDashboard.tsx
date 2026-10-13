import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useRouting } from '../../context/RoutingContext';
import { api } from '../../api';
import type { BloodBankDashboardData } from '../../api';
import { BloodGroupBar, Sparkline, MetricSkeleton, CardSkeleton, EmptyState } from '../../components/MiniCharts';

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];

export const BloodBankDashboard: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { navigateTo } = useRouting();

  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'transfers' | 'donations'>('overview');
  const [data, setData] = useState<BloodBankDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);

  // Stock adjust form
  const [adjustGroup, setAdjustGroup] = useState('A+');
  const [adjustDelta, setAdjustDelta] = useState('10');

  // Transfer request form
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [txType, setTxType] = useState('O-');
  const [txUnits, setTxUnits] = useState('5');
  const [txTarget, setTxTarget] = useState('');
  const [allBanks, setAllBanks] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getBloodBankDashboard(), api.getUnreadCount(user.id), api.getBloodBanks()])
      .then(([d, counts, banks]) => {
        setData(d);
        setUnreadCount(counts.total);
        setUrgentCount(counts.urgent);
        const others = banks.filter(b => b.id !== user.id);
        setAllBanks(banks);
        if (!txTarget && others.length > 0) setTxTarget(others[0].id);
      })
      .catch(err => setLoadError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  if (!user) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>Please Sign In</h3>
        <button className="btn btn-red" onClick={() => navigateTo('auth')}>Go to Login</button>
      </div>
    </div>
  );

  if (loading && !data) return (
    <div className="page active">
      <div className="section-sm" style={{ textAlign: 'center', padding: '3rem', color: 'var(--gr)' }}>
        Loading blood bank dashboard…
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

  const { kpis, inventory = [], lowStockTypes = [], criticalTypes = [], myTransfers = [], pendingIncoming = [], recentDonations = [], notifications = [], intakeTrend = [] } = data || {};

  const maxUnits = Math.max(...inventory.map(r => r.units), 1);
  const trendValues = intakeTrend.map(r => r.count);

  const handleUpdateStock = async () => {
    const delta = parseInt(adjustDelta);
    if (isNaN(delta)) { showToast('warning', 'Invalid value', 'Enter a number.'); return; }
    const current = inventory.find(r => r.type === adjustGroup);
    const newVal = Math.max(0, (current?.units || 0) + delta);
    try {
      const breakdown: Record<string, number> = {};
      inventory.forEach(r => { breakdown[r.type] = r.units; });
      breakdown[adjustGroup] = newVal;
      await api.updateBloodBank(user.id, { stock: Object.values(breakdown).reduce((a, b) => a + b, 0), stockBreakdown: breakdown });
      showToast('success', '✅ Stock Updated', `${adjustGroup}: ${delta > 0 ? '+' : ''}${delta} units → ${newVal} total`);
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const handleApproveTransfer = async (id: string) => {
    try {
      await api.approveTransfer(id, user.id);
      showToast('success', '✅ Approved', 'Transfer approved and stock adjusted.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const handleDeclineTransfer = async (id: string) => {
    try {
      await api.declineTransfer(id, user.id);
      showToast('info', 'Declined', 'Transfer request declined.');
      load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const handleRequestTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const units = parseInt(txUnits);
    if (!txType || isNaN(units) || units <= 0 || !txTarget) { showToast('warning', '⚠️ Missing info', 'Fill all fields.'); return; }
    try {
      await api.createTransfer({ requestingId: user.id, supplyingId: txTarget, bloodType: txType, units });
      showToast('success', '🚚 Transfer Requested', `Requested ${units} units of ${txType}.`);
      setIsTransferOpen(false); load();
    } catch (err: any) { showToast('warning', '⚠️ Failed', err.message); }
  };

  const sidebarNav = [
    { key: 'overview', icon: '🏠', label: 'Overview' },
    { key: 'inventory', icon: '🩸', label: 'Inventory' },
    { key: 'transfers', icon: '🔄', label: 'Transfers', badge: pendingIncoming.length || undefined },
    { key: 'donations', icon: '📋', label: 'Donations' },
  ] as const;

  return (
    <div className="page active" id="bloodbank-dash">
      <div className="dash-layout">
        <div className="sidebar">
          <div className="sb-title">Blood Bank Portal</div>
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

          {/* Low stock alert sidebar box */}
          {(lowStockTypes.length > 0 || criticalTypes.length > 0) && (
            <div style={{ margin: '1.5rem 1.25rem 0', padding: '0.75rem', background: criticalTypes.length > 0 ? '#fee2e2' : '#fef3c7', borderRadius: 'var(--r2)', border: `1px solid ${criticalTypes.length > 0 ? '#fca5a5' : '#fde68a'}` }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: criticalTypes.length > 0 ? 'var(--red)' : '#92400e', marginBottom: '4px' }}>
                {criticalTypes.length > 0 ? '🚨 Out of Stock' : '⚠️ Low Stock'}
              </div>
              {[...criticalTypes, ...lowStockTypes.filter(t => !criticalTypes.includes(t))].map(t => (
                <span key={t} className="badge b-crit" style={{ marginRight: '4px', marginBottom: '2px', display: 'inline-block' }}>{t}</span>
              ))}
            </div>
          )}
        </div>

        <div className="dash-main">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <div className="dash-header">
                <div>
                  <div className="dash-title">Blood Bank Dashboard</div>
                  <div className="dash-sub">{user.name}</div>
                </div>
                <button className="btn btn-red btn-sm" onClick={() => setIsTransferOpen(true)}>+ Request Transfer</button>
              </div>

              {/* Notification alerts */}
              {notifications.length > 0 && (
                <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {notifications.map(n => (
                    <div key={n.id} style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 'var(--r2)', padding: '0.75rem', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>⚠️ <strong>{n.title}</strong>: {n.message}</span>
                      <button className="btn btn-outline btn-sm" onClick={() => api.markNotificationRead(n.id).then(load)}>✓</button>
                    </div>
                  ))}
                </div>
              )}

              {/* KPI row */}
              {loading ? <MetricSkeleton cols={4} /> : (
                <div className="mrow">
                  <div className="mc">
                    <div className="mc-lbl">Total Units</div>
                    <div className="mc-val">{kpis?.totalUnits ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>across {inventory.length} groups</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Low / Critical</div>
                    <div className="mc-val" style={{ color: (kpis?.criticalCount || 0) > 0 ? 'var(--red)' : (kpis?.lowStockCount || 0) > 0 ? 'var(--or)' : 'var(--green)' }}>
                      {kpis?.lowStockCount ?? 0} / {kpis?.criticalCount ?? 0}
                    </div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>types needing attention</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Pending Transfers In</div>
                    <div className="mc-val" style={{ color: (kpis?.pendingIncomingTransfers || 0) > 0 ? 'var(--or)' : 'var(--tx)' }}>{kpis?.pendingIncomingTransfers ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>require your approval</div>
                  </div>
                  <div className="mc">
                    <div className="mc-lbl">Completed Transfers</div>
                    <div className="mc-val">{kpis?.completedTransfers ?? 0}</div>
                    <div className="mc-ch" style={{ color: 'var(--gr)' }}>approved all time</div>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                {/* Inventory overview mini */}
                <div className="card">
                  <div className="card-title">Inventory at a Glance</div>
                  {loading ? <CardSkeleton lines={4} /> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {inventory.map(r => <BloodGroupBar key={r.type} type={r.type} units={r.units} maxUnits={maxUnits} />)}
                    </div>
                  )}
                </div>

                {/* Intake trend */}
                <div className="card">
                  <div className="card-title">Donation Intake Trend (6 months)</div>
                  {loading ? <CardSkeleton lines={2} /> : trendValues.length < 2 || trendValues.every(v => v === 0) ? (
                    <EmptyState icon="📊" title="No intake data yet" body="Donation intake by month will appear here." />
                  ) : (
                    <>
                      <Sparkline values={trendValues} height={60} color="var(--green)" />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--gr)', marginTop: '4px' }}>
                        {intakeTrend.map(r => <span key={r.month}>{r.month.slice(5)}</span>)}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pending incoming transfers */}
              {pendingIncoming.length > 0 && (
                <div className="card" style={{ marginTop: '1.25rem' }}>
                  <div className="card-title" style={{ color: 'var(--or)' }}>⏳ Pending Transfer Requests ({pendingIncoming.length})</div>
                  <table className="tbl">
                    <thead><tr><th>From</th><th>Blood</th><th>Units</th><th>Date</th><th>Actions</th></tr></thead>
                    <tbody>
                      {pendingIncoming.map(t => (
                        <tr key={t.id}>
                          <td>{t.requesting_name || t.requestingId}</td>
                          <td><span className="badge b-crit">{t.blood_type || t.bloodType}</span></td>
                          <td>{t.units}</td>
                          <td>{fmtDate(t.time)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => handleApproveTransfer(t.id)}>Approve</button>
                              <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => handleDeclineTransfer(t.id)}>Decline</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── INVENTORY ── */}
          {activeTab === 'inventory' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Inventory Management</div><div className="dash-sub">Adjust units per blood group</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div className="card">
                  <div className="card-title">Current Stock Levels</div>
                  {loading ? <CardSkeleton lines={8} /> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {inventory.map(r => <BloodGroupBar key={r.type} type={r.type} units={r.units} maxUnits={maxUnits} />)}
                    </div>
                  )}
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--gr3)', borderRadius: 'var(--r2)', fontSize: '12px' }}>
                    <strong>Total: {kpis?.totalUnits ?? 0} units</strong>
                    {(lowStockTypes.length > 0) && <div style={{ color: 'var(--or)', marginTop: '4px' }}>⚠️ Low stock: {lowStockTypes.join(', ')}</div>}
                    {(criticalTypes.length > 0) && <div style={{ color: 'var(--red)', marginTop: '4px' }}>🚨 Out of stock: {criticalTypes.join(', ')}</div>}
                  </div>
                </div>
                <div className="card">
                  <div className="card-title">Adjust Stock</div>
                  <div className="form-group">
                    <label className="form-label">Blood Group</label>
                    <select className="form-input" value={adjustGroup} onChange={e => setAdjustGroup(e.target.value)}>
                      {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Change (+ add / − remove)</label>
                    <input className="form-input" type="number" value={adjustDelta} onChange={e => setAdjustDelta(e.target.value)} placeholder="e.g. 10 or -5" />
                    <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '4px' }}>
                      Current: {inventory.find(r => r.type === adjustGroup)?.units ?? 0} units
                    </div>
                  </div>
                  <button className="btn btn-red btn-full" onClick={handleUpdateStock}>Update Stock</button>
                </div>
              </div>
            </>
          )}

          {/* ── TRANSFERS ── */}
          {activeTab === 'transfers' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Transfers</div><div className="dash-sub">Incoming and outgoing blood transfer requests</div></div>
                <button className="btn btn-red btn-sm" onClick={() => setIsTransferOpen(true)}>+ Request Transfer</button>
              </div>
              <div className="card">
                {myTransfers.length === 0 ? <EmptyState icon="🔄" title="No transfers yet" body="Transfer requests appear here once created." /> : (
                  <table className="tbl">
                    <thead><tr><th>Blood</th><th>Units</th><th>Facility</th><th>Direction</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {myTransfers.map(t => {
                        const isRequesting = t.requestingId === user.id;
                        const partner = isRequesting ? t.supplying_name : t.requesting_name;
                        return (
                          <tr key={t.id}>
                            <td><span className="badge b-crit">{t.blood_type || t.bloodType}</span></td>
                            <td>{t.units}</td>
                            <td>{partner || '—'}</td>
                            <td><span className={`badge ${isRequesting ? 'b-blue' : 'b-urg'}`}>{isRequesting ? 'Outgoing' : 'Incoming'}</span></td>
                            <td>{fmtDate(t.time)}</td>
                            <td><span className={`badge ${t.status === 'Approved' ? 'b-ok' : t.status === 'Declined' ? 'b-gray' : 'b-urg'}`}>{t.status}</span></td>
                            <td>
                              {!isRequesting && t.status === 'Pending' && (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => handleApproveTransfer(t.id)}>Approve</button>
                                  <button className="btn btn-outline btn-sm" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => handleDeclineTransfer(t.id)}>Decline</button>
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
            </>
          )}

          {/* ── DONATIONS ── */}
          {activeTab === 'donations' && (
            <>
              <div className="dash-header">
                <div><div className="dash-title">Recent Donations</div><div className="dash-sub">Donations processed at this blood bank</div></div>
              </div>
              <div className="card">
                {loading ? <CardSkeleton lines={5} /> : recentDonations.length === 0 ? (
                  <EmptyState icon="🩸" title="No donations recorded" body="Donations processed directly through this blood bank appear here." />
                ) : (
                  <table className="tbl">
                    <thead><tr><th>Donor</th><th>Blood</th><th>Date</th><th>Status</th></tr></thead>
                    <tbody>
                      {recentDonations.map(d => (
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

        </div>
      </div>

      {/* Transfer request modal */}
      {isTransferOpen && (
        <div className="modal-bg open" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ maxWidth: '420px' }}>
            <button className="modal-close" onClick={() => setIsTransferOpen(false)}>✕</button>
            <div className="modal-title">🚚 Request Stock Transfer</div>
            <div className="modal-sub">Request units from another LifeLink blood bank</div>
            <form onSubmit={handleRequestTransfer}>
              <div className="form-group">
                <label className="form-label">Blood Group Needed</label>
                <select className="form-input" value={txType} onChange={e => setTxType(e.target.value)}>
                  {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Units Requested</label>
                <input className="form-input" type="number" min="1" value={txUnits} onChange={e => setTxUnits(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Supplying Bank</label>
                <select className="form-input" value={txTarget} onChange={e => setTxTarget(e.target.value)}>
                  {allBanks.filter(b => b.id !== user.id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-red btn-full">Submit Transfer Request</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default BloodBankDashboard;
