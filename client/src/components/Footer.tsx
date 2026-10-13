import React from 'react';
import { useRouting, type Page } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

export const Footer: React.FC = () => {
  const { navigateTo } = useRouting();
  const { showToast } = useToast();
  const { isLoggedIn, user } = useAuth();

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

  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <h3>🩸 LifeLink</h3>
          <p>
            Connecting blood donors with patients in real-time. Every drop counts.
            Be the hero someone needs today.
          </p>
          <button
            className="btn-emergency"
            style={{ marginTop: '1rem', fontSize: '13px', padding: '10px 20px' }}
            onClick={handleSOS}
          >
            🚨 Emergency SOS
          </button>
        </div>

        <div className="footer-col">
          <h4>Platform</h4>
          <a onClick={() => navigateTo('home')}>Home</a>
          <a onClick={() => navigateTo('emergency')}>Emergency</a>
          <a onClick={() => navigateTo('find-blood')}>Find Blood</a>
          <a onClick={() => navigateTo('map')}>Live Map</a>
          <a onClick={() => navigateTo('ai-match')}>AI Matching</a>
        </div>

        <div className="footer-col">
          <h4>Dashboards</h4>
          {isLoggedIn ? (
            <a onClick={() => navigateTo(getDashboardPage())}>My Portal</a>
          ) : (
            <a onClick={() => navigateTo('auth')}>Donor Portal</a>
          )}
          {isLoggedIn && user?.role === 'Admin' && (
            <a onClick={() => navigateTo('dashboard')}>Admin Panel</a>
          )}
          <a onClick={() => navigateTo('auth')}>Hospital Dashboard</a>
          <a onClick={() => navigateTo('auth')}>Blood Bank Portal</a>
        </div>

        <div className="footer-col">
          <h4>More</h4>
          <a onClick={() => navigateTo('camps')}>Donation Camps</a>
          <a onClick={() => navigateTo('leaderboard')}>Leaderboard</a>
          <a onClick={() => navigateTo('notifications') as any}>Notifications</a>
          <a onClick={() => navigateTo('passport')}>Blood Passport</a>
          <a onClick={() => navigateTo('auth')}>Sign Up / Login</a>
        </div>
      </div>
      <div className="footer-bottom">
        © 2026 LifeLink Technologies Pvt. Ltd. • Saving lives, one drop at a time 🩸
      </div>
    </footer>
  );
};
