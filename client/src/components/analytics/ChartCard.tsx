import React from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyMessage?: string;
  height?: number;
  children: React.ReactNode;
  /** Accessible description of what the chart shows, for screen readers. */
  ariaLabel: string;
}

/**
 * Every analytics visualization on the dashboard renders through this
 * wrapper so loading/empty/error handling is consistent and only written
 * once. `children` should be the actual chart, only rendered once data is
 * confirmed present.
 */
export const ChartCard: React.FC<ChartCardProps> = ({
  title, subtitle, loading, error, onRetry, isEmpty, emptyMessage, height = 280, children, ariaLabel
}) => {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '.75rem' }}>
        <div className="card-title" style={{ margin: 0 }}>{title}</div>
        {subtitle && <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '2px' }}>{subtitle}</div>}
      </div>

      <div style={{ minHeight: height, display: 'flex', alignItems: loading || error || isEmpty ? 'center' : 'stretch', justifyContent: 'center' }}>
        {loading ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', padding: '1rem' }} aria-busy="true" aria-live="polite">
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ height: '14px', width: `${90 - i * 15}%`, background: 'var(--gr4)', borderRadius: '4px', opacity: 0.6 }} />
            ))}
            <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '8px' }}>Loading…</div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', color: 'var(--gr)', padding: '1rem' }} role="alert">
            <div style={{ fontSize: '1.5rem', marginBottom: '.4rem' }}>⚠️</div>
            <div style={{ fontSize: '12.5px', marginBottom: '.6rem' }}>{error}</div>
            {onRetry && <button className="btn btn-outline btn-sm" onClick={onRetry}>Retry</button>}
          </div>
        ) : isEmpty ? (
          <div style={{ textAlign: 'center', color: 'var(--gr)', padding: '1rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '.4rem' }}>📭</div>
            <div style={{ fontSize: '12.5px' }}>{emptyMessage || 'No data available for the selected filters.'}</div>
          </div>
        ) : (
          <div role="img" aria-label={ariaLabel} style={{ width: '100%' }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
