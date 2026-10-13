import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting } from '../context/RoutingContext';
import { api } from '../api';
import type { ForecastResult, HighRiskLocation, ForecastHistoryPoint } from '../api';
import { ChartCard } from '../components/analytics/ChartCard';
import { StatCard } from '../components/analytics/StatCard';
import { SimpleBarChart, TrendLineChart } from '../components/analytics/charts';

const RISK_META: Record<string, { badge: string; color: string }> = {
  Low: { badge: 'b-ok', color: '#10b981' },
  Medium: { badge: 'b-urg', color: '#f59e0b' },
  High: { badge: 'b-crit', color: '#ef4444' },
  Critical: { badge: 'b-crit', color: '#7f1d1d' },
  Unknown: { badge: 'b-gray', color: '#94a3b8' }
};

export const Forecast: React.FC = () => {
  const { user } = useAuth();
  const { navigateTo } = useRouting();

  const [horizonDays, setHorizonDays] = useState(7);
  const [cityFilter, setCityFilter] = useState('');
  const [results, setResults] = useState<ForecastResult[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [locations, setLocations] = useState<HighRiskLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [history, setHistory] = useState<ForecastHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadForecast = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getDemandForecast({ city: cityFilter || undefined, horizonDays })
      .then((data) => { setResults(data.results); setDisclaimer(data.disclaimer); })
      .catch((err) => setError(err.message || 'Could not load the forecast right now.'))
      .finally(() => setLoading(false));
  }, [cityFilter, horizonDays]);

  const loadLocations = useCallback(() => {
    setLocationsLoading(true);
    api.getHighRiskLocations(horizonDays).then((data) => setLocations(data.results)).catch(() => setLocations([])).finally(() => setLocationsLoading(false));
  }, [horizonDays]);

  useEffect(() => { loadForecast(); }, [loadForecast]);
  useEffect(() => { loadLocations(); }, [loadLocations]);

  useEffect(() => {
    if (!selectedGroup) { setHistory([]); return; }
    setHistoryLoading(true);
    api.getForecastHistory(selectedGroup, cityFilter || undefined, 90).then((d) => setHistory(d.history)).catch(() => setHistory([])).finally(() => setHistoryLoading(false));
  }, [selectedGroup, cityFilter]);

  if (!user || user.role !== 'Admin') {
    return (
      <div className="page active">
        <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>🔒 Restricted</h3>
          <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px' }}>
            Blood demand forecasting is available to Admin accounts only.
          </p>
          <button className="btn btn-red" style={{ marginTop: '1.25rem' }} onClick={() => navigateTo('home')}>Back to Home</button>
        </div>
      </div>
    );
  }

  const criticalOrHigh = results.filter((r) => r.shortageRisk === 'Critical' || r.shortageRisk === 'High').length;
  const avgConfidence = results.length ? Math.round(results.reduce((s, r) => s + r.confidencePct, 0) / results.length) : 0;
  const cities = Array.from(new Set(locations.map((l) => l.city)));

  const chartHistoryData = history.map((h) => ({ date: h.date.slice(5), units: h.units }));

  return (
    <div className="page active">
      <div className="section-sm">
        <div className="dash-header">
          <div>
            <div className="dash-title">🔮 Blood Demand <span className="accent">Forecasting</span></div>
            <div className="dash-sub">Simple, explainable demand estimates to support planning — not a diagnostic or medical tool.</div>
          </div>
        </div>

        {/* Prominent, unmissable disclaimer */}
        <div style={{
          display: 'flex', gap: '10px', background: '#fef3c7', border: '1.5px solid #f59e0b',
          borderRadius: 'var(--r2)', padding: '14px 16px', marginBottom: '1.25rem', fontSize: '12.5px', color: '#92400e'
        }}>
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <div>
            <strong>These are statistical estimates, not medical advice.</strong> {disclaimer || 'Predictions are for operational planning only and are not validated clinical forecasts.'}
            {' '}A qualified professional should always make final blood-supply decisions.
          </div>
        </div>

        {/* Controls */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group">
              <label className="form-label">Forecast Horizon</label>
              <select className="form-input" value={horizonDays} onChange={(e) => setHorizonDays(parseInt(e.target.value, 10))}>
                <option value={7}>Next 7 days</option>
                <option value={14}>Next 14 days</option>
                <option value={30}>Next 30 days</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">City</label>
              <select className="form-input" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                <option value="">All cities (blended)</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="mrow" style={{ marginBottom: '1.5rem' }}>
          <StatCard icon="🩸" label="Blood Groups Tracked" value={results.length || '—'} loading={loading} />
          <StatCard icon="⚠️" label="High/Critical Risk Groups" value={criticalOrHigh} loading={loading} tone={criticalOrHigh > 0 ? 'bad' : 'good'} />
          <StatCard icon="📊" label="Avg. Model Confidence" value={`${avgConfidence}%`} loading={loading} />
          <StatCard icon="🧪" label="Data Source" value="Synthetic" loading={loading} tone="warn" caption="Dev/demo history — see disclaimer" />
        </div>

        {/* Main forecast table */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title">Blood Group Demand Forecast</div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>Loading forecast…</div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: 'var(--gr)', fontSize: '13px' }}>{error}</p>
              <button className="btn btn-red btn-sm" style={{ marginTop: '10px' }} onClick={loadForecast}>Retry</button>
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>No forecast data available for this selection.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Blood Group</th><th>Current Stock</th><th>Predicted Demand ({horizonDays}d)</th>
                    <th>Days of Supply</th><th>Shortage Risk</th><th>Confidence</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const meta = RISK_META[r.shortageRisk] || RISK_META.Unknown;
                    return (
                      <tr key={r.bloodGroup} style={{ cursor: 'pointer' }} onClick={() => setSelectedGroup(r.bloodGroup)}>
                        <td style={{ fontWeight: 800, color: 'var(--red)' }}>{r.bloodGroup}</td>
                        <td>{r.currentStock} units</td>
                        <td title={`~${r.predictedDailyAvg}/day`}>{r.predictedDemandNextPeriod} units</td>
                        <td>{r.daysOfSupply !== null ? `${r.daysOfSupply}d` : '—'}</td>
                        <td><span className={`badge ${meta.badge}`} title={r.riskReason}>{r.shortageRisk}</span></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '50px', height: '6px', background: 'var(--gr4)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${r.confidencePct}%`, height: '100%', background: r.confidencePct >= 70 ? '#10b981' : r.confidencePct >= 40 ? '#f59e0b' : '#ef4444' }} />
                            </div>
                            <span style={{ fontSize: '11px' }}>{r.confidencePct}%</span>
                          </div>
                        </td>
                        <td><button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedGroup(r.bloodGroup); }}>📈 Trend</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: '10.5px', color: 'var(--gr)', marginTop: '8px' }}>
                Method: {results[0]?.method} · Data source: {results[0]?.dataSource} (see disclaimer above) · Click a row to view its historical trend.
              </div>
            </div>
          )}
        </div>

        {/* Trend chart for selected blood group */}
        {selectedGroup && (
          <ChartCard
            title={`Historical Demand Trend — ${selectedGroup}`}
            subtitle="Last 90 days of (synthetic) daily unit requests used to derive the forecast above"
            loading={historyLoading}
            isEmpty={!historyLoading && chartHistoryData.length === 0}
            ariaLabel={`Line chart of historical daily blood unit requests for ${selectedGroup}`}
            height={260}
          >
            <TrendLineChart data={chartHistoryData} xKey="date" series={[{ key: 'units', label: `${selectedGroup} units requested/day` }]} />
          </ChartCard>
        )}

        {/* High-risk locations */}
        <div style={{ marginTop: '1.5rem' }}>
          <ChartCard
            title="High-Risk Locations"
            subtitle="Cities ranked by combined shortage-risk score across all blood groups (higher = more concerning). Cities marked 'synthetic demo' have no real LifeLink presence — see disclaimer."
            loading={locationsLoading}
            isEmpty={!locationsLoading && locations.length === 0}
            ariaLabel="Bar chart ranking cities by blood shortage risk score"
          >
            <SimpleBarChart
              data={locations}
              xKey="city"
              yKey="riskScore"
              colorByKey={Object.fromEntries(locations.map((l) => [l.city, l.riskScore > 3 ? '#ef4444' : l.riskScore > 0 ? '#f59e0b' : '#10b981']))}
              horizontal
            />
          </ChartCard>
          {locations.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <table className="tbl">
                <thead><tr><th>City</th><th>Real Service Area?</th><th>Most At-Risk Group</th><th>Groups in Shortage</th></tr></thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.city}>
                      <td>{l.city}</td>
                      <td>{l.isRealServiceArea ? <span className="badge b-ok">Yes</span> : <span className="badge b-gray">Synthetic demo only</span>}</td>
                      <td>{l.mostAtRiskBloodGroup ? <span className={`badge ${(RISK_META[l.mostAtRiskLevel || ''] || RISK_META.Unknown).badge}`}>{l.mostAtRiskBloodGroup} ({l.mostAtRiskLevel})</span> : '—'}</td>
                      <td>{l.groupsInShortage.length > 0 ? l.groupsInShortage.join(', ') : 'None'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Forecast;
