import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting, type Page } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';

export const Navbar: React.FC = () => {
  const { user, isLoggedIn, logout } = useAuth();
  const { page, navigateTo } = useRouting();
  const { showToast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);

  useEffect(() => {
    if (!isLoggedIn || !user) {
      setUnreadCount(0);
      setUrgentCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      api
        .getUnreadCount(user.id)
        .then((counts) => { if (!cancelled) { setUnreadCount(counts.total); setUrgentCount(counts.urgent); } })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLoggedIn, user?.id, page]);

  const handleSOS = () => {
    showToast(
      'emergency',
      '🚨 Opening Emergency Request',
      'Fill in the patient details and we\'ll alert matching donors and blood banks in real time.'
    );
    navigateTo('emergency');
  };

  const getDashboardPage = (): Page => {
    if (!user) return 'auth';
    switch (user.role) {
      case 'Admin': return 'dashboard';
      case 'Donor': return 'donor-dash';
      case 'Hospital': return 'hospital';
      case 'Blood Bank': return 'bloodbank';
      default: return 'home';
    }
  };

  const handleNav = (target: Page, e?: React.MouseEvent) => {
    // These are styled as nav links but aren't real hrefs — prevent the
    // default '#' jump so the page doesn't scroll-to-top / push a stray
    // history entry on every click.
    e?.preventDefault();
    navigateTo(target);
    setMobileMenuOpen(false);
  };

  return (
    <>
      <nav className="nav" aria-label="Main">
        <div
          className="nav-logo"
          onClick={(e) => handleNav('home', e)}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNav('home'); } }}
        >
          <div className="logo-drop" aria-hidden="true"><span>L</span></div>
          LifeLink
          <span className="pulse-dot" aria-hidden="true"></span>
        </div>
        
        <ul className="nav-links">
          {isLoggedIn && (
            <>
              <li>
                <a 
                  className={page === 'home' ? 'active-link' : ''}
                  aria-current={page === 'home' ? 'page' : undefined} 
                  onClick={(e) => handleNav('home', e)} 
                  href="#"
                >
                  Home
                </a>
              </li>
              <li>
                <a 
                  className={page === 'emergency' ? 'active-link' : ''}
                  aria-current={page === 'emergency' ? 'page' : undefined} 
                  onClick={(e) => handleNav('emergency', e)} 
                  href="#"
                >
                  Emergency
                </a>
              </li>
              <li>
                <a 
                  className={page === 'find-blood' ? 'active-link' : ''}
                  aria-current={page === 'find-blood' ? 'page' : undefined} 
                  onClick={(e) => handleNav('find-blood', e)} 
                  href="#"
                >
                  Find Blood
                </a>
              </li>
              <li>
                <a 
                  className={page === 'map' ? 'active-link' : ''}
                  aria-current={page === 'map' ? 'page' : undefined} 
                  onClick={(e) => handleNav('map', e)} 
                  href="#"
                >
                  Live Map
                </a>
              </li>
              <li>
                <a 
                  className={page === 'ai-match' ? 'active-link' : ''}
                  aria-current={page === 'ai-match' ? 'page' : undefined} 
                  onClick={(e) => handleNav('ai-match', e)} 
                  href="#"
                >
                  AI Match
                </a>
              </li>
              <li>
                <a 
                  className={page === 'camps' ? 'active-link' : ''}
                  aria-current={page === 'camps' ? 'page' : undefined} 
                  onClick={(e) => handleNav('camps', e)} 
                  href="#"
                >
                  Camps
                </a>
              </li>
              <li>
                <a 
                  className={page === 'leaderboard' ? 'active-link' : ''}
                  aria-current={page === 'leaderboard' ? 'page' : undefined} 
                  onClick={(e) => handleNav('leaderboard', e)} 
                  href="#"
                >
                  Leaderboard
                </a>
              </li>
              {(user?.role === 'Admin' || user?.role === 'Hospital' || user?.role === 'Blood Bank') && (
                <li>
                  <a
                    className={page === 'analytics' ? 'active-link' : ''}
                  aria-current={page === 'analytics' ? 'page' : undefined}
                    onClick={(e) => handleNav('analytics', e)}
                    href="#"
                  >
                    Analytics
                  </a>
                </li>
              )}
              {user?.role === 'Admin' && (
                <li>
                  <a
                    className={page === 'forecast' ? 'active-link' : ''}
                  aria-current={page === 'forecast' ? 'page' : undefined}
                    onClick={(e) => handleNav('forecast', e)}
                    href="#"
                  >
                    Forecast
                  </a>
                </li>
              )}
              {user?.role === 'Admin' && (
                <li>
                  <a 
                    className={page === 'dashboard' ? 'active-link' : ''}
                  aria-current={page === 'dashboard' ? 'page' : undefined} 
                    onClick={(e) => handleNav('dashboard', e)} 
                    href="#"
                  >
                    Admin
                  </a>
                </li>
              )}
            </>
          )}
        </ul>

        <div className="nav-actions">
          <div id="nav-auth-container" style={{ display: 'inline-flex', gap: '10px' }}>
            {isLoggedIn ? (
              <>
                <button 
                  className="btn btn-outline" 
                  onClick={() => handleNav(getDashboardPage())}
                >
                  My Portal ({user?.role})
                </button>
                <button 
                  className="btn btn-gray btn-sm" 
                  onClick={() => { logout(); navigateTo('home'); }}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button className="btn btn-outline" onClick={(e) => handleNav('auth', e)}>
                Sign In / Register
              </button>
            )}
          </div>
          {isLoggedIn && (
            <button
              className="btn btn-outline btn-sm"
              onClick={(e) => handleNav('notifications', e)}
              style={{ position: 'relative' }}
              title="Notifications"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <span aria-hidden="true">🔔</span>
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: '-6px', right: '-6px', background: urgentCount > 0 ? '#b91c1c' : 'var(--red)', color: '#fff',
                    borderRadius: '999px', fontSize: '10px', fontWeight: 800, minWidth: '18px', height: '18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    animation: urgentCount > 0 ? 'pulse-urgent 1.4s ease-in-out infinite' : undefined
                  }}
                  title={urgentCount > 0 ? `${urgentCount} urgent` : undefined}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
          <button className="btn btn-red" onClick={handleSOS} aria-label="Report an emergency blood request">🚨 SOS</button>
          <button 
            id="menu-toggle-btn" 
            className="btn btn-gray btn-sm" 
            onClick={() => setMobileMenuOpen(true)} 
            style={{ display: 'none', fontSize: '18px', padding: '6px 10px' }}
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <div id="mobile-menu" className={`mobile-menu-overlay ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="mobile-menu-drawer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', borderBottom: '1px solid var(--gr4)', backgroundColor: '#fff' }}>
            <div className="nav-logo" onClick={(e) => handleNav('home', e)}>
              <div className="logo-drop"><span>L</span></div>
              LifeLink
            </div>
            <button onClick={() => setMobileMenuOpen(false)} style={{ background: 'none', border: 'none', fontSize: '24px', color: 'var(--gr)', cursor: 'pointer' }} aria-label="Close menu">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <ul className="mobile-menu-links">
            {isLoggedIn && (
              <>
                <li><a className={page === 'home' ? 'active-link' : ''}
                  aria-current={page === 'home' ? 'page' : undefined} onClick={(e) => handleNav('home', e)} href="#">Home</a></li>
                <li><a className={page === 'emergency' ? 'active-link' : ''}
                  aria-current={page === 'emergency' ? 'page' : undefined} onClick={(e) => handleNav('emergency', e)} href="#">Emergency</a></li>
                <li><a className={page === 'find-blood' ? 'active-link' : ''}
                  aria-current={page === 'find-blood' ? 'page' : undefined} onClick={(e) => handleNav('find-blood', e)} href="#">Find Blood</a></li>
                <li><a className={page === 'map' ? 'active-link' : ''}
                  aria-current={page === 'map' ? 'page' : undefined} onClick={(e) => handleNav('map', e)} href="#">Live Map</a></li>
                <li><a className={page === 'ai-match' ? 'active-link' : ''}
                  aria-current={page === 'ai-match' ? 'page' : undefined} onClick={(e) => handleNav('ai-match', e)} href="#">AI Match</a></li>
                <li><a className={page === 'camps' ? 'active-link' : ''}
                  aria-current={page === 'camps' ? 'page' : undefined} onClick={(e) => handleNav('camps', e)} href="#">Camps</a></li>
                <li><a className={page === 'leaderboard' ? 'active-link' : ''}
                  aria-current={page === 'leaderboard' ? 'page' : undefined} onClick={(e) => handleNav('leaderboard', e)} href="#">Leaderboard</a></li>
                <li><a className={page === 'notifications' ? 'active-link' : ''}
                  aria-current={page === 'notifications' ? 'page' : undefined} onClick={(e) => handleNav('notifications', e)} href="#">Notifications {unreadCount > 0 ? `(${unreadCount})` : ''}</a></li>
                <li><a className={page === 'notification-preferences' ? 'active-link' : ''}
                  aria-current={page === 'notification-preferences' ? 'page' : undefined} onClick={(e) => handleNav('notification-preferences', e)} href="#">Notification Settings</a></li>
                {(user?.role === 'Admin' || user?.role === 'Hospital' || user?.role === 'Blood Bank') && (
                  <li><a className={page === 'analytics' ? 'active-link' : ''}
                  aria-current={page === 'analytics' ? 'page' : undefined} onClick={(e) => handleNav('analytics', e)} href="#">Analytics</a></li>
                )}
                {user?.role === 'Admin' && (
                  <li><a className={page === 'forecast' ? 'active-link' : ''}
                  aria-current={page === 'forecast' ? 'page' : undefined} onClick={(e) => handleNav('forecast', e)} href="#">Forecast</a></li>
                )}
                {user?.role === 'Admin' && (
                  <li><a className={page === 'dashboard' ? 'active-link' : ''}
                  aria-current={page === 'dashboard' ? 'page' : undefined} onClick={(e) => handleNav('dashboard', e)} href="#">Admin</a></li>
                )}
              </>
            )}
            {isLoggedIn ? (
              <>
                <li><a onClick={(e) => handleNav(getDashboardPage(), e)} href="#">My Portal ({user?.role})</a></li>
                <li><a onClick={(e) => { e.preventDefault(); logout(); navigateTo('home'); setMobileMenuOpen(false); }} href="#">Sign Out</a></li>
              </>
            ) : (
              <li><a onClick={(e) => handleNav('auth', e)} href="#">Sign In / Register</a></li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
};
