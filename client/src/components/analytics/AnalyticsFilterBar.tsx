import React from 'react';
import type { AnalyticsFilters, AnalyticsFilterOptions } from '../../api';

interface AnalyticsFilterBarProps {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  options: AnalyticsFilterOptions | null;
  onReset: () => void;
}

export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({ filters, onChange, options, onReset }) => {
  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...filters, ...patch });
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
        <div className="form-group">
          <label className="form-label">From</label>
          <input type="date" className="form-input" value={filters.dateFrom || ''} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input type="date" className="form-input" value={filters.dateTo || ''} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
        </div>
        <div className="form-group">
          <label className="form-label">Blood Group</label>
          <select className="form-input" value={filters.bloodGroup || ''} onChange={(e) => set({ bloodGroup: e.target.value || undefined })}>
            <option value="">All groups</option>
            {options?.bloodGroups.map((bg) => <option key={bg} value={bg}>{bg}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">City</label>
          <select className="form-input" value={filters.city || ''} onChange={(e) => set({ city: e.target.value || undefined })}>
            <option value="">All cities</option>
            {options?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Hospital</label>
          <select className="form-input" value={filters.hospitalId || ''} onChange={(e) => set({ hospitalId: e.target.value || undefined })}>
            <option value="">All hospitals</option>
            {options?.hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Blood Bank</label>
          <select className="form-input" value={filters.bloodBankId || ''} onChange={(e) => set({ bloodBankId: e.target.value || undefined })}>
            <option value="">All blood banks</option>
            {options?.bloodBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      {activeCount > 0 && (
        <div style={{ marginTop: '10px' }}>
          <button className="btn btn-gray btn-sm" onClick={onReset}>✕ Clear {activeCount} filter{activeCount > 1 ? 's' : ''}</button>
        </div>
      )}
    </div>
  );
};
