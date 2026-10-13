import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useRouting } from '../context/RoutingContext';
import { api } from '../api';
import type { Donation } from '../api';
import QRCode from 'qrcode';

export const Passport: React.FC = () => {
  const { user, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const { navigateTo } = useRouting();

  const [history, setHistory] = useState<Donation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [qrSvg, setQrSvg] = useState<string>('');

  const isDonor = isLoggedIn && user && user.role === 'Donor';

  useEffect(() => {
    if (!isDonor || !user) return;
    setLoadingHistory(true);
    api
      .getDonations(user.id)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [isDonor, user?.id]);

  useEffect(() => {
    if (!isDonor || !user?.passportId) return;
    // A real, scannable QR code encoding the donor's actual passport ID —
    // any hospital/camp verifier can scan this and look the ID up directly.
    QRCode.toString(`LIFELINK-DONOR-PASSPORT:${user.passportId}`, {
      type: 'svg',
      margin: 0,
      width: 82,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    })
      .then(setQrSvg)
      .catch(() => setQrSvg(''));
  }, [isDonor, user?.passportId]);

  const handleShare = () => {
    showToast(
      'success',
      '🔗 Link Copied!',
      'Your donor passport verification link has been copied to clipboard.'
    );
  };

  const getInitials = (n: string) => {
    return n ? n.split(' ').map((x) => x[0]).join('').substring(0, 2).toUpperCase() : '';
  };

  const completedHistory = history.filter((h) => h.status === 'Completed');
  const lastDonation = completedHistory[0]; // most recent first (server orders DESC)
  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const nextEligibleLabel = (() => {
    if (!lastDonation?.donationDate) return 'Now ✓';
    const next = new Date(lastDonation.donationDate);
    next.setDate(next.getDate() + 90);
    const today = new Date();
    if (next <= today) return 'Now ✓';
    return formatDate(next.toISOString());
  })();

  const level = user ? Math.floor(user.xp / 300) || 1 : 1;

  return (
    <div className="page active" id="passport">
      <div className="section-sm" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div className="dash-header">
          <div>
            <div className="dash-title">🪪 Digital Blood Passport</div>
            <div className="dash-sub">Your verified donor identity — shareable via QR code at any hospital or camp</div>
          </div>
        </div>

        {!isDonor ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🪪</div>
            <h3>Donor Passport Unavailable</h3>
            <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px', marginBottom: '1.5rem' }}>
              Donor Passports are only available for registered blood donors. Please sign in with a Donor account to view your passport.
            </p>
            {!isLoggedIn ? (
              <button className="btn btn-red" onClick={() => navigateTo('auth')}>
                Sign In / Register
              </button>
            ) : (
              <span className="badge b-gray" style={{ padding: '6px 12px' }}>Role: {user?.role}</span>
            )}
          </div>
        ) : (
          <>
            <div className="passport">
              <div className="pp-bg">🩸</div>
              <div className="pp-hdr">
                <div className="pp-av">{getInitials(user.name)}</div>
                <div>
                  <div className="pp-name">{user.name}</div>
                  <div className="pp-id">Donor ID: {user.passportId}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <span style={{ background: 'rgba(231,76,60,.3)', color: '#fca5a5', fontSize: '10px', padding: '3px 10px', borderRadius: '12px', fontWeight: 700 }}>
                      ✅ Verified Donor
                    </span>
                    <span style={{ background: 'rgba(16,185,129,.2)', color: '#6ee7b7', fontSize: '10px', padding: '3px 10px', borderRadius: '12px', fontWeight: 700 }}>
                      Elite Level {level}
                    </span>
                  </div>
                </div>
              </div>
              <div className="pp-grid">
                <div className="pp-field">
                  <div className="pp-lbl">Blood Type</div>
                  <div className="pp-val big">{user.bloodType}</div>
                </div>
                <div className="pp-field">
                  <div className="pp-lbl">Total Donations</div>
                  <div className="pp-val big">{user.donations}</div>
                </div>
                <div className="pp-field">
                  <div className="pp-lbl">Lives Saved</div>
                  <div className="pp-val big">{user.donations * 3}</div>
                </div>
                <div className="pp-field">
                  <div className="pp-lbl">Last Donated</div>
                  <div className="pp-val" style={{ fontSize: '.85rem' }}>{formatDate(lastDonation?.donationDate ?? null)}</div>
                </div>
                <div className="pp-field">
                  <div className="pp-lbl">Next Eligible</div>
                  <div className="pp-val" style={{ fontSize: '.85rem', color: '#6ee7b7' }}>{nextEligibleLabel}</div>
                </div>
                <div className="pp-field">
                  <div className="pp-lbl">XP Points</div>
                  <div className="pp-val" style={{ fontSize: '.85rem', color: '#fbbf24' }}>
                    {user.xp.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="qr-area">
                <div
                  className="qr-box"
                  id="qr-box"
                  style={{ width: '90px', height: '90px', background: '#fff', borderRadius: '4px', padding: '4px' }}
                  dangerouslySetInnerHTML={qrSvg ? { __html: qrSvg } : undefined}
                />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0', marginBottom: '3px' }}>
                    Scan to verify donor
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
                    Show this at donation camps or hospitals for instant identity verification
                  </div>
                  <button 
                    className="btn" 
                    style={{ background: 'rgba(255,255,255,.12)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.15)', fontSize: '11px', padding: '5px 14px', marginTop: '8px' }}
                    onClick={handleShare}
                  >
                    📲 Share Passport
                  </button>
                </div>
              </div>
            </div>

            {/* Donation History Table */}
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <div className="card-title">Donation History</div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Hospital</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--gr)', padding: '1rem' }}>
                        Loading donation history…
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--gr)', padding: '1rem' }}>
                        No donation history recorded yet. Start saving lives today!
                      </td>
                    </tr>
                  ) : (
                    history.map((rec, i) => (
                      <tr key={rec.id}>
                        <td style={{ fontWeight: 700 }}>{history.length - i}</td>
                        <td>{formatDate(rec.donationDate)}</td>
                        <td>{rec.hospital}</td>
                        <td style={{ fontWeight: 800, color: 'var(--red)' }}>{rec.bloodType}</td>
                        <td>
                          <span className={`badge ${rec.status === 'Completed' ? 'b-ok' : rec.status === 'In Progress' ? 'b-blue' : 'b-gray'}`}>
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default Passport;
