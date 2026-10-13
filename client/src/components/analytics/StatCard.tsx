import React from 'react';

interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  caption?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  loading?: boolean;
}

const TONE_COLORS: Record<string, string> = {
  default: 'var(--tx)',
  good: 'var(--green)',
  warn: 'var(--or)',
  bad: 'var(--red)'
};

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, caption, tone = 'default', loading }) => (
  <div className="mc" style={{ minWidth: 0 }}>
    <div className="mc-lbl" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span aria-hidden="true">{icon}</span> {label}
    </div>
    <div className="mc-val" style={{ color: TONE_COLORS[tone], opacity: loading ? 0.4 : 1 }}>
      {loading ? '—' : value}
    </div>
    {caption && <div className="mc-ch neu">{caption}</div>}
  </div>
);
