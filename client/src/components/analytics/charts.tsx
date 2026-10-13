import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';

// A single, consistent categorical palette used across every multi-series chart
export const CHART_COLORS = ['#c0392b', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

export const STATUS_COLORS: Record<string, string> = {
  'Adequate': '#10b981',
  'Low': '#f59e0b',
  'Critical': '#ef4444',
  'Out of Stock': '#7f1d1d',
  'Completed': '#10b981',
  'Cancelled': '#94a3b8',
  'Scheduled': '#3b82f6',
  'In Progress': '#f59e0b'
};

const axisStyle = { fontSize: 11, fill: '#64748b' };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' };

/* -------------------------------------------------------------------- */
/* Simple single-series bar chart (e.g. blood group demand)             */
/* -------------------------------------------------------------------- */
interface SimpleBarChartProps {
  data: Record<string, any>[];
  xKey: string;
  yKey: string;
  color?: string;
  colorByKey?: Record<string, string>; // optional per-bar coloring, e.g. by shortage status
  yLabel?: string;
  horizontal?: boolean;
}
export const SimpleBarChart: React.FC<SimpleBarChartProps> = ({ data, xKey, yKey, color = CHART_COLORS[0], colorByKey, yLabel, horizontal }) => (
  <ResponsiveContainer width="100%" height={260}>
    <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      {horizontal ? (
        <>
          <XAxis type="number" tick={axisStyle} />
          <YAxis type="category" dataKey={xKey} tick={axisStyle} width={110} />
        </>
      ) : (
        <>
          <XAxis dataKey={xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } } : undefined} />
        </>
      )}
      <Tooltip contentStyle={tooltipStyle} />
      <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
        {colorByKey && data.map((entry, idx) => <Cell key={idx} fill={colorByKey[entry[xKey]] || color} />)}
        {!colorByKey && <Cell fill={color} />}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

/* -------------------------------------------------------------------- */
/* Grouped multi-series bar chart (e.g. emergency trends by urgency)    */
/* -------------------------------------------------------------------- */
interface GroupedBarChartProps {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
}
export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({ data, xKey, series }) => (
  <ResponsiveContainer width="100%" height={280}>
    <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      <XAxis dataKey={xKey} tick={axisStyle} />
      <YAxis tick={axisStyle} />
      <Tooltip contentStyle={tooltipStyle} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />
      ))}
    </BarChart>
  </ResponsiveContainer>
);

/* -------------------------------------------------------------------- */
/* Line chart (e.g. monthly donation trends)                            */
/* -------------------------------------------------------------------- */
interface TrendLineChartProps {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
}
export const TrendLineChart: React.FC<TrendLineChartProps> = ({ data, xKey, series }) => (
  <ResponsiveContainer width="100%" height={280}>
    <LineChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      <XAxis dataKey={xKey} tick={axisStyle} />
      <YAxis tick={axisStyle} />
      <Tooltip contentStyle={tooltipStyle} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
      {series.map((s, i) => (
        <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
      ))}
    </LineChart>
  </ResponsiveContainer>
);

/* -------------------------------------------------------------------- */
/* Stacked area chart (e.g. shortage-pressure trend)                    */
/* -------------------------------------------------------------------- */
interface StackedAreaChartProps {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
}
export const StackedAreaChart: React.FC<StackedAreaChartProps> = ({ data, xKey, series }) => (
  <ResponsiveContainer width="100%" height={260}>
    <AreaChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      <XAxis dataKey={xKey} tick={axisStyle} />
      <YAxis tick={axisStyle} />
      <Tooltip contentStyle={tooltipStyle} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {series.map((s, i) => (
        <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="1" stroke={s.color || CHART_COLORS[i % CHART_COLORS.length]} fill={s.color || CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.4} />
      ))}
    </AreaChart>
  </ResponsiveContainer>
);

/* -------------------------------------------------------------------- */
/* Donut chart (e.g. donation success rate)                             */
/* -------------------------------------------------------------------- */
interface DonutChartProps {
  data: { name: string; value: number; color?: string }[];
  centerLabel?: string;
}
export const DonutChart: React.FC<DonutChartProps> = ({ data, centerLabel }) => (
  <div style={{ position: 'relative' }}>
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
          {data.map((d, i) => <Cell key={d.name} fill={d.color || STATUS_COLORS[d.name] || CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
    {centerLabel && (
      <div style={{ position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{centerLabel}</div>
      </div>
    )}
  </div>
);
