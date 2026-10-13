import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';
import type { NotificationPreference } from '../api';

const categoryIcon = (category: string) => {
  switch (category) {
    case 'emergency': return '🚨';
    case 'request_status': return '🩸';
    case 'reminders': return '📆';
    case 'inventory': return '📦';
    case 'account': return '🔐';
    default: return '🔔';
  }
};

// A small labelled on/off switch, styled with the app's existing badge/button primitives
// rather than introducing a new component library dependency for one control.
const Toggle: React.FC<{ checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    aria-pressed={checked}
    style={{
      width: '42px',
      height: '24px',
      borderRadius: '999px',
      border: 'none',
      position: 'relative',
      background: checked ? 'var(--red, #dc2626)' : 'var(--gr4)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      flexShrink: 0,
      transition: 'background 0.15s ease'
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: '2px',
        left: checked ? '20px' : '2px',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.15s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
      }}
    />
  </button>
);

export const NotificationPreferences: React.FC = () => {
  const { user, isLoggedIn } = useAuth();
  const { navigateTo } = useRouting();
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api
      .getNotificationPreferences(user.id)
      .then(setPrefs)
      .catch(() => setPrefs([]))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const updatePref = async (category: NotificationPreference['category'], field: 'inApp' | 'telegram', value: boolean) => {
    if (!user) return;
    const current = prefs.find((p) => p.category === category);
    if (!current) return;
    // Optimistic update
    setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, [field]: value } : p)));
    setSavingCategory(category);
    try {
      const updated = await api.setNotificationPreference({
        userId: user.id,
        category,
        inApp: field === 'inApp' ? value : current.inApp,
        telegram: field === 'telegram' ? value : current.telegram
      });
      setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, ...updated } : p)));
    } catch (err: any) {
      showToast('warning', 'Could not save', err.message || 'Please try again.');
      setPrefs((prev) => prev.map((p) => (p.category === category ? current : p)));
    } finally {
      setSavingCategory(null);
    }
  };

  if (!isLoggedIn || !user) {
    return (
      <div className="page active">
        <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Please Sign In</h3>
          <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px' }}>
            Sign in to manage your notification preferences.
          </p>
          <button className="btn btn-red" style={{ marginTop: '1.25rem' }} onClick={() => navigateTo('auth')}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page active">
      <div className="section-sm" style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div className="dash-header">
          <div>
            <div className="dash-title">⚙️ Notification Preferences</div>
            <div className="dash-sub">Choose how LifeLink reaches you — per category, in-app and Telegram.</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => navigateTo('notifications')}>
            ← Back to notifications
          </button>
        </div>

        <div className="card">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>Loading preferences…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {prefs.map((p) => (
                <div
                  key={p.category}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '1rem',
                    borderBottom: '1px solid var(--gr4)',
                    opacity: savingCategory === p.category ? 0.7 : 1
                  }}
                >
                  <div style={{ fontSize: '1.4rem', flexShrink: 0 }}>{categoryIcon(p.category)}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '13px', color: 'var(--tx)' }}>{p.label}</strong>
                    {p.locked && (
                      <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '2px' }}>
                        In-app alerts for this category can't be turned off — it covers life-safety or account-security notices. You can still turn off Telegram delivery.
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <Toggle checked={p.inApp} disabled={p.locked} onChange={(v) => updatePref(p.category, 'inApp', v)} />
                    <span style={{ fontSize: '10px', color: 'var(--gr)' }}>In-app</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <Toggle checked={p.telegram} onChange={(v) => updatePref(p.category, 'telegram', v)} />
                    <span style={{ fontSize: '10px', color: 'var(--gr)' }}>Telegram</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: '12px', color: 'var(--gr)', marginTop: '1rem', textAlign: 'center' }}>
          Telegram delivery requires a linked Telegram account. More delivery channels (email, SMS, push) are coming soon.
        </p>
      </div>
    </div>
  );
};
export default NotificationPreferences;
