import React from 'react';

/* ------------------------------------------------------------------
   Reusable tiny SVG charts used across all four role dashboards.
   All are intentionally simple: no external chart library, no
   animation, just clean SVG that matches the LifeLink visual system.
   ------------------------------------------------------------------ */

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  maxValue?: number;
  showLabels?: boolean;
}

export const BarChart: React.FC<BarChartProps> = ({ data, height = 80, maxValue, showLabels = true }) => {
  if (!data.length) return null;
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);
  const barW = Math.floor(100 / data.length);
  return (
    <svg viewBox={`0 0 100 ${height + (showLabels ? 18 : 0)}`} width="100%" style={{ overflow: 'visible' }} aria-hidden>
      {data.map((d, i) => {
        const barH = max > 0 ? Math.max(2, (d.value / max) * height) : 2;
        const x = i * barW + barW * 0.12;
        const w = barW * 0.76;
        return (
          <g key={i}>
            <rect
              x={x} y={height - barH} width={w} height={barH}
              rx="2" fill={d.color || 'var(--red)'} opacity={0.85}
            />
            {showLabels && (
              <text x={x + w / 2} y={height + 13} textAnchor="middle" fontSize="5" fill="var(--gr)">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

interface SparklineProps {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}

export const Sparkline: React.FC<SparklineProps> = ({ values, color = 'var(--red)', height = 40, fill = true }) => {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 100;
  const step = w / (values.length - 1);
  const toY = (v: number) => height - ((v - min) / range) * (height - 4) - 2;
  const points = values.map((v, i) => `${i * step},${toY(v)}`);
  const pathD = `M${points.join(' L')}`;
  const fillD = `${pathD} L${(values.length - 1) * step},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" style={{ overflow: 'visible' }} aria-hidden>
      {fill && <path d={fillD} fill={color} opacity={0.12} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

interface DonutProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  showLegend?: boolean;
}

export const DonutChart: React.FC<DonutProps> = ({ segments, size = 80, showLegend = true }) => {
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const r = 30;
  const cx = 40;
  const cy = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 80 80" width={size} height={size} style={{ flexShrink: 0 }} aria-hidden>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--gr4)" strokeWidth="10" />
        {segments.map((seg, i) => {
          const dash = (seg.value / total) * circumference;
          const gap = circumference - dash;
          const el = (
            <circle
              key={i} cx={cx} cy={cy} r={r}
              fill="none" stroke={seg.color} strokeWidth="10"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          );
          offset += dash;
          return el;
        })}
        <circle cx={cx} cy={cy} r={22} fill="#fff" />
      </svg>
      {showLegend && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {segments.map((seg) => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--gr)' }}>{seg.label}</span>
              <strong style={{ color: 'var(--tx)', marginLeft: 'auto' }}>{Math.round((seg.value / total) * 100)}%</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface BloodGroupBarProps {
  type: string;
  units: number;
  maxUnits: number;
}

export const BloodGroupBar: React.FC<BloodGroupBarProps> = ({ type, units, maxUnits }) => {
  const pct = maxUnits > 0 ? Math.min(100, (units / maxUnits) * 100) : 0;
  const color = units === 0 ? 'var(--red)' : units <= 10 ? '#f59e0b' : 'var(--green)';
  const label = units === 0 ? 'Out' : units <= 10 ? 'Low' : units <= 30 ? 'OK' : 'Good';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
      <span style={{ width: '28px', fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>{type}</span>
      <div style={{ flex: 1, height: '8px', background: 'var(--gr4)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ width: '24px', textAlign: 'right', color: 'var(--gr)', fontSize: '11px' }}>{units}</span>
      <span style={{ width: '28px', fontSize: '10px', color, fontWeight: 700 }}>{label}</span>
    </div>
  );
};

// Skeleton loader for metric cards
export const MetricSkeleton: React.FC<{ cols?: number }> = ({ cols = 4 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '1rem', marginBottom: '1.25rem' }}>
    {Array.from({ length: cols }).map((_, i) => (
      <div key={i} style={{ background: '#fff', borderRadius: 'var(--r)', border: '1.5px solid var(--gr4)', padding: '1.1rem' }}>
        <div style={{ height: '10px', background: 'var(--gr4)', borderRadius: '4px', width: '60%', marginBottom: '10px' }} />
        <div style={{ height: '24px', background: 'var(--gr4)', borderRadius: '4px', width: '40%' }} />
      </div>
    ))}
  </div>
);

export const CardSkeleton: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <div style={{ background: '#fff', borderRadius: 'var(--r)', border: '1.5px solid var(--gr4)', padding: '1.25rem' }}>
    {Array.from({ length: lines }).map((_, i) => (
      <div key={i} style={{ height: '12px', background: 'var(--gr4)', borderRadius: '4px', marginBottom: '10px', width: i === lines - 1 ? '60%' : '100%' }} />
    ))}
  </div>
);

export const EmptyState: React.FC<{ icon?: string; title: string; body?: string; action?: React.ReactNode }> = ({ icon = '📭', title, body, action }) => (
  <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--gr)' }}>
    <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>{icon}</div>
    <strong style={{ display: 'block', fontSize: '14px', color: 'var(--tx)', marginBottom: '4px' }}>{title}</strong>
    {body && <p style={{ fontSize: '12px', maxWidth: '320px', margin: '0 auto 1rem' }}>{body}</p>}
    {action}
  </div>
);
