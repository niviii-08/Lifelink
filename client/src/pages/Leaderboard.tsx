import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, type User } from '../api';

export const Leaderboard: React.FC = () => {
  const { user } = useAuth();
  const [donors, setDonors] = useState<User[]>([]);

  useEffect(() => {
    api.getUsers()
      .then((users) => {
        const filteredDonors = users.filter((u) => u.role === 'Donor');
        filteredDonors.forEach((d) => {
          if (d.donations === undefined) d.donations = 0;
          if (d.xp === undefined) d.xp = d.donations * 200;
        });
        // Sort by XP desc
        filteredDonors.sort((a, b) => b.xp - a.xp);
        setDonors(filteredDonors);
      })
      .catch(console.error);
  }, []);

  const getInitials = (n: string) => {
    return n ? n.split(' ').map((x) => x[0]).join('').substring(0, 2).toUpperCase() : '';
  };

  const first = donors[0];
  const second = donors[1];
  const third = donors[2];

  return (
    <div className="page active" id="leaderboard">
      <div className="section-sm" style={{ maxWidth: '700px' }}>
        <div className="dash-title" style={{ marginBottom: '.4rem' }}>🏆 Donor Leaderboard</div>
        <div className="dash-sub" style={{ marginBottom: '1.5rem' }}>Top donors ranked by XP, donations & emergency responses</div>

        {/* Dynamic Podium (Top 3) */}
        <div id="leaderboard-podium" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '10px', marginBottom: '1.75rem', alignItems: 'flex-end' }}>
          
          {/* Second Place */}
          {second ? (
            <div 
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '1.25rem 0.75rem',
                borderTop: '4px solid #94a3b8',
                height: '150px',
                textAlign: 'center',
                justifyContent: 'center',
                position: 'relative',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                ...(user && second.id === user.id ? { border: '1px solid var(--red)', borderTop: '4px solid #94a3b8', background: 'var(--pk)' } : {})
              }}
            >
              <div style={{ position: 'absolute', top: '-15px', background: '#94a3b8', color: '#fff', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px', border: '2px solid #fff' }}>
                2
              </div>
              <div className="lb-av" style={{ background: 'linear-gradient(135deg, #cbd5e1, #94a3b8)', marginBottom: '8px' }}>
                {getInitials(second.name)}
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {second.name} {user && second.id === user.id && <span className="badge b-ok" style={{ fontSize: '8px', padding: '1px 4px' }}>You</span>}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--red)', fontWeight: 800, marginTop: '2px' }}>
                {second.donations} Donations
              </div>
              <div style={{ fontSize: '10px', color: 'var(--gr)', fontWeight: 600 }}>
                {second.xp} XP
              </div>
            </div>
          ) : <div />}

          {/* First Place */}
          {first ? (
            <div 
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '1.25rem 0.75rem',
                borderTop: '5px solid #fbbf24',
                height: '180px',
                textAlign: 'center',
                justifyContent: 'center',
                position: 'relative',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                transform: 'translateY(-10px)',
                ...(user && first.id === user.id ? { border: '1px solid var(--red)', borderTop: '5px solid #fbbf24', background: 'var(--pk)' } : {})
              }}
            >
              <div style={{ position: 'absolute', top: '-22px', fontSize: '24px' }}>👑</div>
              <div style={{ position: 'absolute', top: '-15px', background: '#fbbf24', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '13px', border: '2px solid #fff' }}>
                1
              </div>
              <div className="lb-av" style={{ background: 'linear-gradient(135deg, #fef08a, #fbbf24)', marginBottom: '8px', width: '44px', height: '44px', fontSize: '14px', border: '2px solid #fde047' }}>
                {getInitials(first.name)}
              </div>
              <div style={{ fontWeight: 800, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {first.name} {user && first.id === user.id && <span className="badge b-ok" style={{ fontSize: '8px', padding: '1px 4px' }}>You</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--red)', fontWeight: 900, marginTop: '2px' }}>
                {first.donations} Donations
              </div>
              <div style={{ fontSize: '11px', color: 'var(--gr)', fontWeight: 700 }}>
                {first.xp} XP
              </div>
            </div>
          ) : <div />}

          {/* Third Place */}
          {third ? (
            <div 
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '1.25rem 0.75rem',
                borderTop: '4px solid #b45309',
                height: '140px',
                textAlign: 'center',
                justifyContent: 'center',
                position: 'relative',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                ...(user && third.id === user.id ? { border: '1px solid var(--red)', borderTop: '4px solid #b45309', background: 'var(--pk)' } : {})
              }}
            >
              <div style={{ position: 'absolute', top: '-15px', background: '#b45309', color: '#fff', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '12px', border: '2px solid #fff' }}>
                3
              </div>
              <div className="lb-av" style={{ background: 'linear-gradient(135deg, #d97706, #b45309)', marginBottom: '8px' }}>
                {getInitials(third.name)}
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {third.name} {user && third.id === user.id && <span className="badge b-ok" style={{ fontSize: '8px', padding: '1px 4px' }}>You</span>}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--red)', fontWeight: 800, marginTop: '2px' }}>
                {third.donations} Donations
              </div>
              <div style={{ fontSize: '10px', color: 'var(--gr)', fontWeight: 600 }}>
                {third.xp} XP
              </div>
            </div>
          ) : <div />}
        </div>

        {/* List of all ranks */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: '1.25rem' }}>All Rankings</div>
          <div id="leaderboard-tbody" style={{ display: 'flex', flexDirection: 'column' }}>
            {donors.map((donor, idx) => {
              const rank = idx + 1;
              const progressPct = Math.min(100, Math.round((donor.xp / 4000) * 100));
              const initials = getInitials(donor.name);
              const isCurrentUser = user && donor.id === user.id;

              return (
                <div 
                  key={donor.id}
                  className="lb-row"
                  style={isCurrentUser ? {
                    background: 'var(--pk)',
                    borderRadius: '8px',
                    padding: '10px',
                    margin: '4px -10px',
                    border: '1px dashed var(--red)'
                  } : {}}
                >
                  <div className={`lb-rank ${rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : ''}`}>
                    {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
                  </div>
                  <div className="lb-av" style={{ background: 'linear-gradient(135deg, var(--rl), var(--rd))' }}>
                    {initials}
                  </div>
                  <div className="lb-info">
                    <div className="lb-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{donor.name}</span>
                      {isCurrentUser && <span className="badge b-ok" style={{ fontSize: '9px', padding: '2px 6px' }}>You</span>}
                    </div>
                    <div className="lb-sub">
                      Level {Math.floor(donor.xp / 300) || 1} · {donor.donations} donations · {donor.location}
                    </div>
                    <div className="xp-bar">
                      <div className="xp-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '60px' }}>
                    <strong style={{ color: 'var(--red)', fontSize: '14px' }}>{donor.xp}</strong>
                    <div style={{ fontSize: '9px', color: 'var(--gr)', fontWeight: 700 }}>XP</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
export default Leaderboard;
