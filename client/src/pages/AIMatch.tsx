import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { api, type DonorMatchResult, type MatchingWeights } from '../api';
import { useGeolocation, formatDistance } from '../utils/geo';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const FACTOR_LABELS: Record<keyof DonorMatchResult['factors'], { label: string; color: string }> = {
  compatibility: { label: 'Blood Compatibility', color: 'var(--green)' },
  distance: { label: 'Distance', color: 'var(--bl)' },
  availability: { label: 'Availability', color: 'var(--or)' },
  eligibility: { label: 'Donation Eligibility', color: '#8b5cf6' },
  history: { label: 'Donation History', color: '#f59e0b' },
  responseRate: { label: 'Response Rate', color: '#ec4899' }
};

const formatLastDonation = (iso: string | null) => {
  if (!iso) return 'No prior donations on record';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `Last donated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

export const AIMatch: React.FC = () => {
  const { showToast } = useToast();
  const { effectiveCoords, isUsingFallback } = useGeolocation();

  const [bloodType, setBloodType] = useState('O+');
  const [urgency, setUrgency] = useState<'Critical' | 'Urgent' | 'Normal'>('Critical');
  const [radiusKm, setRadiusKm] = useState(15);

  const [defaultWeights, setDefaultWeights] = useState<Required<MatchingWeights> | null>(null);
  const [customWeights, setCustomWeights] = useState<MatchingWeights>({});
  const [weightsOpen, setWeightsOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [matchedDonors, setMatchedDonors] = useState<DonorMatchResult[]>([]);
  const [meta, setMeta] = useState<{ totalCandidates?: number; eligibleCandidates?: number; effectiveRadiusKm?: number } | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.getMatchingWeights().then((r) => { setDefaultWeights(r.weights); setCustomWeights(r.weights); }).catch(() => {});
  }, []);

  const handleWeightChange = (key: keyof MatchingWeights, value: number) => {
    setCustomWeights((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetWeights = () => {
    if (defaultWeights) setCustomWeights(defaultWeights);
  };

  const handleFindMatches = async () => {
    if (!bloodType || !urgency) {
      showToast('warning', '⚠️ Fill Details', 'Please select blood type and urgency level.');
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    try {
      const result = await api.rankDonors({
        bloodType,
        urgency,
        lat: effectiveCoords.lat,
        lng: effectiveCoords.lng,
        radiusKm,
        limit: 10,
        weights: customWeights
      });
      setMatchedDonors(result.results);
      setMeta({ totalCandidates: result.totalCandidates, eligibleCandidates: result.eligibleCandidates, effectiveRadiusKm: result.effectiveRadiusKm });

      if (result.results.length === 0) {
        showToast('warning', '⚠️ No Matches Found', `No eligible compatible donors found for ${bloodType} within ${result.effectiveRadiusKm} km.`);
      } else {
        showToast('success', '✅ Matching Complete', `Found ${result.results.length} recommended donor(s) for ${bloodType} (${urgency} priority).`);
      }
    } catch (err: any) {
      showToast('warning', '❌ Matching Failed', err.message || 'Could not run donor matching right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleContact = (donor: DonorMatchResult) => {
    api
      .createNotification({
        userId: donor.donorId,
        type: 'emergency_alert',
        title: `A patient needs your ${bloodType} blood`,
        message: `You were recommended via LifeLink's donor matching for a ${urgency.toLowerCase()}-priority request. Please open the app to respond if you're able to help.`,
        relatedType: 'ai_match'
      })
      .catch(() => {});
    showToast('success', '📲 Request Sent!', `${donor.displayName} has been notified.`);
  };

  return (
    <div className="page active" id="ai-match">
      <div className="section-sm">
        <div className="dash-title" style={{ marginBottom: '.4rem' }}>Donor <span className="accent">Matching & Ranking</span></div>
        <div className="dash-sub" style={{ marginBottom: '.5rem' }}>
          A transparent, rule-based recommendation engine — ranks compatible, eligible donors by a clearly-explained score
        </div>
        <div style={{
          fontSize: '12px', color: '#94a3b8', background: 'rgba(148,163,184,.1)', border: '1px solid rgba(148,163,184,.2)',
          borderRadius: 'var(--r2)', padding: '10px 14px', marginBottom: '1.5rem', maxWidth: '720px'
        }}>
          ℹ️ This tool <strong>recommends</strong> donors worth contacting based on compatibility, distance, availability,
          eligibility, history, and response rate. It does not make medical decisions and does not replace clinical
          screening at the point of donation — a qualified professional always makes the final call.
        </div>

        <div className="ai-dark">
          <h3>🔎 Donor Recommendation Search</h3>
          <p>Enter the patient's blood group and priority — matches are ranked by a fully explainable score, not a black box.</p>
          <div className="ai-inputs">
            <div>
              <label className="form-label" style={{ color: '#94a3b8' }}>Blood Type Needed</label>
              <select className="ai-sel" value={bloodType} onChange={(e) => setBloodType(e.target.value)}>
                {BLOOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ color: '#94a3b8' }}>Priority Level</label>
              <select className="ai-sel" value={urgency} onChange={(e) => setUrgency(e.target.value as any)}>
                <option value="Critical">Critical</option>
                <option value="Urgent">Urgent</option>
                <option value="Normal">Normal</option>
              </select>
            </div>
            <div>
              <label className="form-label" style={{ color: '#94a3b8' }}>Search Radius</label>
              <select className="ai-sel" value={radiusKm} onChange={(e) => setRadiusKm(parseInt(e.target.value))}>
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={15}>15 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', marginBottom: '10px' }}>
            {isUsingFallback ? '📍 Using central Coimbatore as the search origin (location not shared)' : '📍 Using your live location as the search origin'}
            {urgency === 'Critical' && ' · Critical priority automatically widens the effective radius by 15 km'}
          </div>

          <button className="btn btn-outline btn-sm" style={{ marginBottom: '12px' }} onClick={() => setWeightsOpen((o) => !o)}>
            ⚙️ {weightsOpen ? 'Hide' : 'Customize'} Scoring Weights
          </button>

          {weightsOpen && defaultWeights && (
            <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 'var(--r2)', padding: '14px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
                Adjust how much each factor counts toward the final score. Weights don't need to add up to any fixed total — they're normalized automatically.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                {(Object.keys(defaultWeights) as (keyof MatchingWeights)[]).map((key) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#cbd5e1' }}>
                      <span>{FACTOR_LABELS[key].label}</span>
                      <span>{(customWeights[key] ?? defaultWeights[key]).toFixed(2)}</span>
                    </div>
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={customWeights[key] ?? defaultWeights[key]}
                      onChange={(e) => handleWeightChange(key, parseFloat(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                ))}
              </div>
              <button className="btn btn-gray btn-sm" style={{ marginTop: '10px' }} onClick={handleResetWeights}>Reset to defaults</button>
            </div>
          )}

          <button className="btn btn-red" onClick={handleFindMatches} disabled={isLoading}>
            {isLoading ? 'Searching…' : '🔎 Find Best Matches →'}
          </button>
        </div>

        {hasSearched && !isLoading && meta && (
          <div style={{ fontSize: '12px', color: 'var(--gr)', margin: '1rem 0' }}>
            {meta.totalCandidates ?? 0} compatible donor{(meta.totalCandidates ?? 0) === 1 ? '' : 's'} found ·{' '}
            {meta.eligibleCandidates ?? 0} currently eligible · searched within {meta.effectiveRadiusKm} km
          </div>
        )}

        {/* Results */}
        <div
          id="match-results"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.25rem',
            transition: 'opacity .3s',
            opacity: isLoading ? 0.4 : 1,
            marginTop: '1rem'
          }}
        >
          {hasSearched && !isLoading && matchedDonors.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', background: 'var(--dark2)', borderRadius: 'var(--r)', border: '1.5px dashed var(--gr4)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔍</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', marginBottom: '0.5rem' }}>No Eligible Donors Found</div>
              <div style={{ fontSize: '13px', color: 'var(--gr)', maxWidth: '360px', margin: '0 auto' }}>
                No compatible, currently-eligible donors were found for {bloodType} within {meta?.effectiveRadiusKm ?? radiusKm} km.
                Try widening the search radius.
              </div>
            </div>
          )}

          {!isLoading && matchedDonors.map((item, index) => {
            const initials = item.displayName.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
            const rankLabel = index === 0 ? '#1 Best Match' : `#${index + 1} Match`;
            const isExpanded = expandedId === item.donorId;

            let avBg = 'linear-gradient(135deg, var(--red), #b91c1c)';
            if (index === 1) avBg = 'linear-gradient(135deg, var(--bl), #1d4ed8)';
            if (index >= 2) avBg = 'linear-gradient(135deg, var(--green), #047857)';

            return (
              <div key={item.donorId} className="match-card">
                <span className="match-rank">{rankLabel}</span>
                <div className="match-av" style={{ background: avBg }}>{initials}</div>
                <div className="match-name">{item.displayName}</div>
                <div className="match-blood">{bloodType}</div>

                <div className="score-row">
                  <span style={{ fontWeight: 700 }}>Match Score</span>
                  <span style={{ fontWeight: 800, fontSize: '15px' }}>{item.matchScore}%</span>
                </div>
                <div className="score-bar">
                  <div className="score-fill" style={{ width: `${item.matchScore}%`, background: 'var(--green)' }} />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--gr)', marginTop: '10px', lineHeight: 1.6 }}>
                  📍 {item.distanceKm !== null ? `${formatDistance(item.distanceKm)} away` : `${item.location} (distance unknown)`}<br />
                  🟢 {item.availabilityStatus}<br />
                  🩸 {formatLastDonation(item.lastDonationDate)}<br />
                  📋 {item.donationCount} lifetime donation{item.donationCount === 1 ? '' : 's'}
                </div>

                <button
                  className="btn btn-outline btn-sm btn-full"
                  style={{ marginTop: '10px' }}
                  onClick={() => setExpandedId(isExpanded ? null : item.donorId)}
                >
                  {isExpanded ? '▲ Hide score breakdown' : '▼ Why this score?'}
                </button>

                {isExpanded && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(Object.keys(item.factors) as (keyof DonorMatchResult['factors'])[]).map((key) => {
                      const f = item.factors[key];
                      const factorMeta = FACTOR_LABELS[key];
                      return (
                        <div key={key}>
                          <div className="score-row" style={{ fontSize: '11px' }}>
                            <span>{factorMeta.label} <span style={{ opacity: 0.6 }}>(weight {f.weight.toFixed(2)})</span></span>
                            <span style={{ fontWeight: 700 }}>{Math.round(f.score * 100)}%</span>
                          </div>
                          <div className="score-bar" style={{ height: '5px' }}>
                            <div className="score-fill" style={{ width: `${f.score * 100}%`, background: factorMeta.color }} />
                          </div>
                          <div style={{ fontSize: '10.5px', color: 'var(--gr)', marginTop: '2px' }}>{f.reason}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button className="btn btn-red btn-full" style={{ marginTop: '12px' }} onClick={() => handleContact(item)}>
                  📱 Contact Donor
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
export default AIMatch;
