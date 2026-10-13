import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';
import type { Notification, NotificationUrgency } from '../api';
import { useEventStream } from '../utils/sse';

const typeIcon = (type: string) => {
  switch (type) {
    case 'emergency_request': return '🚨';
    case 'donor_match': return '🩸';
    case 'donor_accepted': return '🙋';
    case 'donor_declined': return '🙅';
    case 'donor_reserved': return '📦';
    case 'request_fulfilled': return '✅';
    case 'donation_thanks': return '❤️';
    case 'appointment_reminder': return '📆';
    case 'camp_reminder': return '⛺';
    case 'camp_update': return '📅';
    case 'blood_shortage_alert': return '📉';
    case 'inventory_warning': return '⚠️';
    case 'transfer_update': return '🔄';
    case 'otp': return '🔐';
    default: return '🔔';
  }
};

// Urgency drives the badge shown next to a notification, so Critical/Urgent alerts are
// always visually distinct from routine ones — never rely on icon or copy alone for that.
const urgencyBadgeClass = (urgency: NotificationUrgency) => {
  if (urgency === 'Critical') return 'b-crit';
  if (urgency === 'Urgent') return 'b-urg';
  return 'b-gray';
};

const timeAgo = (iso: string) => {
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export const Notifications: React.FC = () => {
  const { user, isLoggedIn } = useAuth();
  const { navigateTo } = useRouting();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('all');
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [actionedIds, setActionedIds] = useState<Set<number>>(new Set());

  const load = () => {
    if (!user) return;
    setLoading(true);
    api
      .getNotifications(user.id)
      .then(setNotifications)
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Real-time: refresh when the workflow might have generated a new notification for this user
  useEventStream('emergency:matches', () => load());
  useEventStream('emergency:status', () => load());
  useEventStream('notification:new', () => load());

  const handleRespondToMatch = async (n: Notification, response: 'accept' | 'decline') => {
    if (!user || !n.related_id) return;
    setRespondingId(n.id);
    try {
      await api.respondToEmergency(n.related_id, user.id, response);
      setActionedIds((prev) => new Set(prev).add(n.id));
      showToast(
        response === 'accept' ? 'success' : 'info',
        response === 'accept' ? '✅ You accepted!' : 'Declined',
        response === 'accept' ? 'The hospital can now see your response. Thank you!' : 'No problem — thanks for letting us know.'
      );
      if (!n.read) handleMarkRead(n.id);
    } catch (err: any) {
      showToast('warning', '⚠️ Could not respond', err.message || 'This request may no longer be open.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleMarkRead = async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.markNotificationRead(id);
    } catch {
      load();
    }
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api.markAllNotificationsRead(user.id);
    } catch {
      load();
    }
  };

  if (!isLoggedIn || !user) {
    return (
      <div className="page active">
        <div className="section-sm" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Please Sign In</h3>
          <p style={{ color: 'var(--gr)', fontSize: '13px', marginTop: '8px' }}>
            Sign in to view your notifications.
          </p>
          <button className="btn btn-red" style={{ marginTop: '1.25rem' }} onClick={() => navigateTo('auth')}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const urgentCount = notifications.filter((n) => !n.read && (n.urgency === 'Critical' || n.urgency === 'Urgent')).length;
  const visible =
    filter === 'unread' ? notifications.filter((n) => !n.read) :
    filter === 'urgent' ? notifications.filter((n) => n.urgency === 'Critical' || n.urgency === 'Urgent') :
    notifications;

  return (
    <div className="page active">
      <div className="section-sm" style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div className="dash-header">
          <div>
            <div className="dash-title">🔔 Notifications</div>
            <div className="dash-sub">
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You\'re all caught up'}
              {urgentCount > 0 ? ` · ${urgentCount} urgent` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${filter === 'all' ? 'btn-red' : 'btn-outline'}`} onClick={() => setFilter('all')}>
              All
            </button>
            <button className={`btn btn-sm ${filter === 'unread' ? 'btn-red' : 'btn-outline'}`} onClick={() => setFilter('unread')}>
              Unread
            </button>
            <button className={`btn btn-sm ${filter === 'urgent' ? 'btn-red' : 'btn-outline'}`} onClick={() => setFilter('urgent')}>
              Urgent
            </button>
            {unreadCount > 0 && (
              <button className="btn btn-gray btn-sm" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
            <button className="btn btn-gray btn-sm" onClick={() => navigateTo('notification-preferences')} title="Notification preferences">
              ⚙️ Preferences
            </button>
          </div>
        </div>

        <div className="card">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>Loading notifications…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--gr)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
              {filter === 'unread' ? 'No unread notifications.' : filter === 'urgent' ? 'No urgent notifications.' : 'No notifications yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {visible.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && handleMarkRead(n.id)}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    padding: '1rem',
                    borderRadius: 'var(--r2)',
                    background: n.read ? 'transparent' : 'var(--gr3)',
                    cursor: n.read ? 'default' : 'pointer',
                    borderBottom: '1px solid var(--gr4)',
                    borderLeft: n.urgency === 'Critical' ? '3px solid #b91c1c' : n.urgency === 'Urgent' ? '3px solid #92400e' : '3px solid transparent'
                  }}
                >
                  <div style={{ fontSize: '1.4rem', flexShrink: 0 }}>{typeIcon(n.type)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--tx)' }}>{n.title}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--gr)', whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--gr)', marginTop: '4px' }}>{n.message}</p>
                    {n.type === 'donor_match' && user?.role === 'Donor' && !actionedIds.has(n.id) && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }} onClick={(evt) => evt.stopPropagation()}>
                        <button
                          className="btn btn-red btn-sm"
                          disabled={respondingId === n.id}
                          onClick={() => handleRespondToMatch(n, 'accept')}
                        >
                          {respondingId === n.id ? '…' : '✅ Accept'}
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={respondingId === n.id}
                          onClick={() => handleRespondToMatch(n, 'decline')}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                    {n.type === 'donor_match' && actionedIds.has(n.id) && (
                      <span className="badge b-ok" style={{ marginTop: '6px', display: 'inline-block' }}>Response sent</span>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                      {(n.urgency === 'Critical' || n.urgency === 'Urgent') && (
                        <span className={`badge ${urgencyBadgeClass(n.urgency)}`}>{n.urgency}</span>
                      )}
                      {!n.read && <span className="badge b-blue">New</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Notifications;
