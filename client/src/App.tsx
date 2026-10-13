import React, { useEffect, useRef, Suspense, lazy } from 'react';
import { ToastProvider } from './context/ToastContext';
import { RoutingProvider, useRouting, type Page } from './context/RoutingContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { Navbar } from './components/Navbar';
import { Chatbot } from './components/Chatbot';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';

// Pages are code-split by route: each page (and its dependencies, e.g. the
// Leaflet map or Recharts bundles) only downloads when the user actually
// navigates there, instead of all being bundled into one ~1MB chunk that
// every visitor pays for on first load.
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const EmergencyBoard = lazy(() => import('./pages/Emergency').then((m) => ({ default: m.EmergencyBoard })));
const FindBlood = lazy(() => import('./pages/FindBlood').then((m) => ({ default: m.FindBlood })));
const LiveMap = lazy(() => import('./pages/LiveMap').then((m) => ({ default: m.LiveMap })));
const AIMatch = lazy(() => import('./pages/AIMatch').then((m) => ({ default: m.AIMatch })));
const Camps = lazy(() => import('./pages/Camps').then((m) => ({ default: m.Camps })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Passport = lazy(() => import('./pages/Passport').then((m) => ({ default: m.Passport })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })));
const NotificationPreferences = lazy(() => import('./pages/NotificationPreferences').then((m) => ({ default: m.NotificationPreferences })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Forecast = lazy(() => import('./pages/Forecast').then((m) => ({ default: m.Forecast })));
const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })));

// Dashboards
const AdminDashboard = lazy(() => import('./pages/Dashboards/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const DonorDashboard = lazy(() => import('./pages/Dashboards/DonorDashboard').then((m) => ({ default: m.DonorDashboard })));
const HospitalDashboard = lazy(() => import('./pages/Dashboards/HospitalDashboard').then((m) => ({ default: m.HospitalDashboard })));
const BloodBankDashboard = lazy(() => import('./pages/Dashboards/BloodBankDashboard').then((m) => ({ default: m.BloodBankDashboard })));

const PageLoading: React.FC = () => (
  <div
    role="status"
    aria-label="Loading page"
    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}
  >
    <div
      aria-hidden="true"
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '3px solid var(--gr4)',
        borderTopColor: 'var(--red)',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  </div>
);

// Pages that show personal account data - only unlocked after sign in / registration.
// Everything else (Home, Emergency board, Find Blood, Live Map, AI Match, Camps,
// Leaderboard) stays public so LifeLink still functions as a general resource.
const PRIVATE_PAGES: Page[] = ['donor-dash', 'hospital', 'bloodbank', 'dashboard', 'passport', 'notifications', 'notification-preferences', 'analytics', 'forecast'];

const AppContent: React.FC = () => {
  const { page, navigateTo } = useRouting();
  const { isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const warnedRef = useRef<Page | null>(null);

  const isGated = PRIVATE_PAGES.includes(page) && !isLoggedIn;

  useEffect(() => {
    if (isGated && warnedRef.current !== page) {
      warnedRef.current = page;
      showToast('warning', '🔒 Members Only', 'Sign in or register to unlock your personal dashboard.');
      navigateTo('auth');
    }
    if (!isGated) warnedRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, isLoggedIn]);

  const renderPage = () => {
    if (isGated) return <Auth />;

    switch (page) {
      case 'home':
        return <Home />;
      case 'emergency':
        return <EmergencyBoard />;
      case 'find-blood':
        return <FindBlood />;
      case 'map':
        return <LiveMap />;
      case 'ai-match':
        return <AIMatch />;
      case 'camps':
        return <Camps />;
      case 'leaderboard':
        return <Leaderboard />;
      case 'passport':
        return <Passport />;
      case 'notifications':
        return <Notifications />;
      case 'notification-preferences':
        return <NotificationPreferences />;
      case 'analytics':
        return <Analytics />;
      case 'forecast':
        return <Forecast />;
      case 'auth':
        return <Auth />;
      case 'donor-dash':
        return <DonorDashboard />;
      case 'hospital':
        return <HospitalDashboard />;
      case 'bloodbank':
        return <BloodBankDashboard />;
      case 'dashboard':
        return <AdminDashboard />;
      default:
        return <Home />;
    }
  };

  return (
    <div className="app-container">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Navbar />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense fallback={<PageLoading />}>
            {renderPage()}
          </Suspense>
        </ErrorBoundary>
      </main>
      <Chatbot />
      <Footer />
    </div>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <RoutingProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </RoutingProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
