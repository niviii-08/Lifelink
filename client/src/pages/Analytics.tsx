import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting } from '../context/RoutingContext';
import { api } from '../api';
import type { AnalyticsDashboard, AnalyticsFilters, AnalyticsFilterOptions } from '../api';
import { StatCard } from '../components/analytics/StatCard';
import { ChartCard } from '../components/analytics/ChartCard';
import { AnalyticsFilterBar } from '../components/analytics/AnalyticsFilterBar';
import { SimpleBarChart, GroupedBarChart, TrendLineChart, StackedAreaChart, DonutChart, STATUS_COLORS } from '../components/analytics/charts';

const pivotShortageTrend = (trend: { week: string; weekStart: string; bloodGroup: string; requestCount: number }[]) => {
  const byWeek: Record<string, any> = {};
  trend.forEach((t) => {
    if (!byWeek[t.week]) byWeek[t.week] = { week: t.weekStart };
    byWeek[t.week][t.bloodGroup] = t.requestCount;
  });
  return Object.values(byWeek).sort((a: any, b: any) => a.week.localeCompare(b.week));
};

export const Analytics: React.FC = () => {
  const { user } = useAuth();
  const { navigateTo } = useRouting();

  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [filterOptions, setFilterOptions] = useState<AnalyticsFilterOptions | null>(null);
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAnalyticsFilterOptions().then(setFilterOptions).catch(() => setFilterOptions(null));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAnalyticsDashboard(filters)
      .then(setDashboard)
      .catch((err) => setError(err.message || 'Could not load analytics right now.'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!user || (user.role !== 'Admin' && user.role !== 'Hospital' && user.role !== 'Blood Bank')) {
    return (
      <div className="page active">
        <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>🔒 Restricted</h3>
          <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px' }}>
            The platform analytics dashboard is available to Admin, Hospital, and Blood Bank accounts.
          </p>
          <button className="btn btn-red" style={{ marginTop: '1.25rem' }} onClick={() => navigateTo('home')}>Back to Home</button>
        </div>
      </div>
    );
  }

  const s = dashboard?.summary;
  const shortageTrendData = dashboard ? pivotShortageTrend(dashboard.shortagePressureTrend.trend) : [];
  const shortageSeries = (dashboard?.shortagePressureTrend.shortageGroups || []).map((g) => ({ key: g, label: g }));

  return (
    <div className="page active">
      <div className="section-sm">
        <div className="dash-header">
          <div>
            <div className="dash-title">📊 Platform <span className="accent">Analytics</span></div>
            <div className="dash-sub">Every number below is computed live from the database for the selected filters — nothing here is hardcoded.</div>
          </div>
        </div>

        <AnalyticsFilterBar filters={filters} onChange={setFilters} options={filterOptions} onReset={() => setFilters({})} />

        {error && !loading && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>⚠️</div>
            <p style={{ color: 'var(--gr)', fontSize: '13px' }}>{error}</p>
            <button className="btn btn-red btn-sm" style={{ marginTop: '10px' }} onClick={load}>Retry</button>
          </div>
        )}

        {/* Summary metrics */}
        <div className="mrow" style={{ flexWrap: 'wrap' }}>
          <StatCard icon="🩸" label="Total Donors" value={s?.totalDonors ?? '—'} loading={loading} />
          <StatCard icon="✅" label="Active Donors" value={s?.activeDonors ?? '—'} loading={loading} tone="good" />
          <StatCard icon="💉" label="Total Donations" value={s?.totalDonations ?? '—'} loading={loading} />
          <StatCard icon="🏆" label="Successful Donations" value={s?.successfulDonations ?? '—'} loading={loading} tone="good" />
          <StatCard icon="🚨" label="Emergency Requests" value={s?.emergencyRequests ?? '—'} loading={loading} />
          <StatCard icon="✔️" label="Fulfilled Requests" value={s?.fulfilledRequests ?? '—'} loading={loading} tone="good" />
          <StatCard icon="✕" label="Unfulfilled Requests" value={s?.unfulfilledRequests ?? '—'} loading={loading} tone={s && s.unfulfilledRequests > 0 ? 'warn' : 'default'} />
          <StatCard
            icon="⏱️"
            label="Avg. Response Time"
            value={s?.avgResponseTimeMinutes != null ? `${s.avgResponseTimeMinutes}m` : 'No data'}
            loading={loading}
          />
          <StatCard icon="🏦" label="Blood Inventory (units)" value={s?.totalBloodUnits ?? '—'} loading={loading} />
          <StatCard
            icon="⚠️"
            label="Groups In Shortage"
            value={s?.bloodGroupsInShortage ?? '—'}
            loading={loading}
            tone={s && s.bloodGroupsInShortage > 0 ? 'bad' : 'good'}
          />
          <StatCard icon="🏕️" label="Donation Camps" value={s?.totalCamps ?? '—'} loading={loading} />
          <StatCard icon="📝" label="Camp Registrations" value={s?.campRegistrations ?? '—'} loading={loading} />
        </div>

        {/* Charts grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>

          <ChartCard
            title="1. Monthly Donation Trends"
            subtitle="Total vs. completed donations per month"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.monthlyDonationTrends.length ?? 0) === 0}
            ariaLabel="Line chart of total and completed donations by month"
          >
            {dashboard && (
              <TrendLineChart
                data={dashboard.monthlyDonationTrends}
                xKey="month"
                series={[{ key: 'total', label: 'Total' }, { key: 'completed', label: 'Completed' }]}
              />
            )}
          </ChartCard>

          <ChartCard
            title="2. Blood Group Demand"
            subtitle="Emergency requests by blood group"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.bloodGroupDemand.length ?? 0) === 0}
            ariaLabel="Bar chart of emergency request counts per blood group"
          >
            {dashboard && <SimpleBarChart data={dashboard.bloodGroupDemand} xKey="bloodGroup" yKey="requestCount" color="#c0392b" />}
          </ChartCard>

          <ChartCard
            title="3. Blood Group Availability"
            subtitle="Current units in stock, colored by shortage status"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.bloodGroupAvailability.length ?? 0) === 0}
            ariaLabel="Bar chart of available blood units per blood group, colored by shortage status"
          >
            {dashboard && (
              <SimpleBarChart
                data={dashboard.bloodGroupAvailability}
                xKey="bloodGroup"
                yKey="unitsAvailable"
                colorByKey={Object.fromEntries(dashboard.bloodGroupAvailability.map((g) => [g.bloodGroup, STATUS_COLORS[g.status]]))}
              />
            )}
          </ChartCard>

          <ChartCard
            title="4. Emergency Request Trends"
            subtitle="Weekly requests by urgency level"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.emergencyTrends.length ?? 0) === 0}
            ariaLabel="Grouped bar chart of weekly emergency requests split by urgency"
          >
            {dashboard && (
              <GroupedBarChart
                data={dashboard.emergencyTrends}
                xKey="weekStart"
                series={[
                  { key: 'critical', label: 'Critical', color: '#ef4444' },
                  { key: 'urgent', label: 'Urgent', color: '#f59e0b' },
                  { key: 'normal', label: 'Normal', color: '#3b82f6' }
                ]}
              />
            )}
          </ChartCard>

          <ChartCard
            title="5. Donation Success Rate"
            subtitle={dashboard ? `${dashboard.donationSuccessRate.successRate}% of donations completed` : undefined}
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.donationSuccessRate.total ?? 0) === 0}
            ariaLabel="Donut chart of donation outcomes by status"
          >
            {dashboard && (
              <DonutChart
                data={dashboard.donationSuccessRate.byStatus.map((r) => ({ name: r.status, value: r.count }))}
                centerLabel={`${dashboard.donationSuccessRate.successRate}%`}
              />
            )}
          </ChartCard>

          <ChartCard
            title="6. Blood Shortage Pressure Trend"
            subtitle="Weekly emergency demand for blood groups currently in short supply (no historical stock data exists, so this is a real demand-pressure proxy, not a stock-level history)"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && shortageSeries.length === 0}
            emptyMessage="No blood groups are currently in shortage for the selected filters — nothing to show."
            ariaLabel="Stacked area chart of weekly emergency demand for currently short blood groups"
          >
            {dashboard && shortageSeries.length > 0 && (
              <StackedAreaChart data={shortageTrendData} xKey="week" series={shortageSeries} />
            )}
          </ChartCard>

          <ChartCard
            title="7. Geographic Distribution"
            subtitle="Donors, hospitals, and blood banks by city"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.geographicDistribution.length ?? 0) === 0}
            ariaLabel="Grouped bar chart of donor, hospital, and blood bank counts by city"
          >
            {dashboard && (
              <GroupedBarChart
                data={dashboard.geographicDistribution}
                xKey="city"
                series={[
                  { key: 'donorCount', label: 'Donors', color: '#c0392b' },
                  { key: 'hospitalCount', label: 'Hospitals', color: '#3b82f6' },
                  { key: 'bloodBankCount', label: 'Blood Banks', color: '#10b981' }
                ]}
              />
            )}
          </ChartCard>

          <ChartCard
            title="8. Hospital Demand"
            subtitle="Top hospitals by emergency request volume"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.hospitalDemand.length ?? 0) === 0}
            ariaLabel="Horizontal bar chart of top hospitals by number of emergency requests"
            height={Math.max(280, (dashboard?.hospitalDemand.slice(0, 8).length || 0) * 34)}
          >
            {dashboard && <SimpleBarChart data={dashboard.hospitalDemand.slice(0, 8)} xKey="hospitalName" yKey="requestCount" color="#8b5cf6" horizontal />}
          </ChartCard>

          <ChartCard
            title="9. Blood Bank Inventory"
            subtitle="Total units currently held per blood bank"
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.bloodBankInventory.length ?? 0) === 0}
            ariaLabel="Bar chart of total blood units held by each blood bank"
          >
            {dashboard && (
              <SimpleBarChart
                data={dashboard.bloodBankInventory}
                xKey="name"
                yKey="totalUnits"
                colorByKey={Object.fromEntries(dashboard.bloodBankInventory.map((b) => [b.name, b.shortageTypes.length > 0 ? '#ef4444' : '#10b981']))}
              />
            )}
          </ChartCard>

          <ChartCard
            title="10. Donor Engagement"
            subtitle={dashboard ? `Avg. ${dashboard.donorEngagement.avgDonationsPerDonor} donations/donor · ${dashboard.donorEngagement.telegramLinkedPct}% reachable via Telegram` : undefined}
            loading={loading}
            error={loading ? null : error}
            onRetry={load}
            isEmpty={!loading && (dashboard?.donorEngagement.totalDonors ?? 0) === 0}
            ariaLabel="Bar chart of donor counts grouped by number of lifetime donations"
          >
            {dashboard && <SimpleBarChart data={dashboard.donorEngagement.donationBuckets} xKey="bucket" yKey="count" color="#f59e0b" />}
          </ChartCard>

        </div>

        {dashboard && (
          <div style={{ fontSize: '11px', color: 'var(--gr)', textAlign: 'center', marginTop: '1.5rem' }}>
            Generated {new Date(dashboard.generatedAt).toLocaleString()} · all figures computed live from the LifeLink database
          </div>
        )}
      </div>
    </div>
  );
};
export default Analytics;
