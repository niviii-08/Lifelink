import React, { useEffect, useState } from 'react';
import { useRouting } from '../context/RoutingContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { api, type Emergency } from '../api';
import { useGeolocation, getDistanceKm, formatDistance } from '../utils/geo';
import { useEventStream } from '../utils/sse';

export const STATUS_META: Record<string, { color: string; badge: string; icon: string }> = {
  'Pending': { color: 'var(--gr)', badge: 'b-gray', icon: '⏳' },
  'Searching': { color: '#3b82f6', badge: 'b-blue', icon: '🔎' },
  'Donors Notified': { color: '#f59e0b', badge: 'b-urg', icon: '📣' },
  'Donor Responded': { color: '#8b5cf6', badge: 'b-pu', icon: '🙋' },
  'Blood Reserved': { color: '#10b981', badge: 'b-ok', icon: '📦' },
  'Fulfilled': { color: '#10b981', badge: 'b-ok', icon: '✅' },
  'Cancelled': { color: 'var(--gr)', badge: 'b-gray', icon: '✕' },
  'Expired': { color: 'var(--red)', badge: 'b-crit', icon: '⌛' }
};

export const formatCountdown = (expiresAt?: string | null): { label: string; expired: boolean } | null => {
  if (!expiresAt) return null;
  const target = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return { label: 'Expired', expired: true };
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return { label: `${hrs}h ${mins % 60}m left`, expired: false };
  return { label: `${mins}m left`, expired: false };
};

export const EmergencyBoard: React.FC = () => {
  const { navigateTo } = useRouting();
  const { showToast } = useToast();
  const { user, isLoggedIn } = useAuth();
  const { effectiveCoords } = useGeolocation();
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [filter, setFilter] = useState<'All' | 'Critical' | 'Urgent' | 'Normal'>('All');
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [, forceTick] = useState(0); // re-render every 30s so countdowns stay live
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [units, setUnits] = useState('');
  const [urgency, setUrgency] = useState('');
  const [hospital, setHospital] = useState('');
  const [notes, setNotes] = useState('');

  const fetchEmergencies = () => {
    api.getEmergencies()
      .then(setEmergencies)
      .catch((err) => console.error("Error loading emergencies:", err));
  };

  useEffect(() => {
    fetchEmergencies();
  }, []);

  const { routeState } = useRouting();
  
  useEffect(() => {
    if (routeState?.autoFill) {
      setIsModalOpen(true);
      const data = routeState.autoFill;
      if (data.blood_group && data.blood_group !== 'Unknown') setBloodType(data.blood_group);
      if (data.quantity && data.quantity !== 'Unknown') setUnits(data.quantity.toString());
      if (data.hospital && data.hospital !== 'Unknown') setHospital(data.hospital);
      if (data.urgency && data.urgency !== 'Unknown') setUrgency(data.urgency);
    }
  }, [routeState]);

  // Live countdown re-render tick
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Real-time updates: new requests, status transitions, and match/notification fanout
  // all arrive over Server-Sent Events, so the board updates without a page refresh.
  useEventStream('emergency:created', (data) => {
    setEmergencies((prev) => (prev.some((e) => e.id === data.emergency.id) ? prev : [data.emergency, ...prev]));
  });
  useEventStream('emergency:status', (data) => {
    setEmergencies((prev) => prev.map((e) => (e.id === data.emergency.id ? data.emergency : e)));
    if (data.to === 'Fulfilled') {
      showToast('success', '✅ Request Fulfilled', `${data.emergency.patientName}'s ${data.emergency.bloodType} request has been fulfilled.`);
    } else if (data.to === 'Expired') {
      showToast('warning', '⌛ Request Expired', `${data.emergency.patientName}'s request expired without being resolved in time.`);
    }
  });
  useEventStream('emergency:matches', (data) => {
    setEmergencies((prev) => prev.map((e) => (e.id === data.emergencyId ? { ...e, alerts: data.matchedDonorCount } : e)));
  });

  const handleRespond = async (e: Emergency) => {
    if (!isLoggedIn || !user) {
      showToast('warning', '🔒 Sign in required', 'Please sign in as a donor to respond to emergency requests.');
      navigateTo('auth');
      return;
    }
    if (user.role !== 'Donor') {
      showToast('warning', 'Donors only', 'Only registered donor accounts can respond to donate.');
      return;
    }
    setRespondingId(e.id);
    try {
      await api.respondToEmergency(e.id, user.id, 'accept');
      showToast(
        'success',
        '✅ Response Confirmed!',
        `You accepted the ${e.bloodType} request at ${e.hospital}. They can see your response now.`
      );
      fetchEmergencies();
    } catch (err: any) {
      showToast('warning', '❌ Could not respond', err.message || 'You may not have an active notification for this request.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleCall = (hosp: string) => {
    showToast('info', '📞 Calling...', `Connecting to ${hosp}`);
  };

  const handleDirections = (e: Emergency) => {
    navigateTo('map', { 
      directions: { 
        lat: e.lat, 
        lng: e.lng, 
        hospital: e.hospital, 
        patientName: e.patientName,
        id: e.id
      } 
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bloodType || !units || !urgency) {
      showToast('warning', '⚠️ Fill all fields', 'Please complete the emergency request form.');
      return;
    }

    const finalName = patientName.trim() || `Patient ${emergencies.length + 1}`;
    const finalHospital = hospital.trim() || 'City General Hospital';
    const newId = 'e' + Date.now();

    const newReq: Emergency = {
      id: newId,
      patientName: finalName,
      bloodType,
      hospital: finalHospital,
      lat: 11.0168 + (Math.random() - 0.5) * 0.03,
      lng: 76.9558 + (Math.random() - 0.5) * 0.03,
      units: parseInt(units),
      urgency: urgency as any,
      ward: notes.trim() || 'Emergency Ward',
      time: 'Just now',
      status: 'Pending', // server drives the real status through the workflow immediately after creation
      alerts: 0
    };

    try {
      const result = await api.createEmergency(newReq);
      showToast(
        'emergency',
        '🚨 Request Broadcast!',
        result.matchedDonors > 0
          ? `${units} units of ${bloodType} needed (${urgency}). ${result.matchedDonors} compatible donor(s) notified instantly!`
          : `${units} units of ${bloodType} needed (${urgency}). No compatible donors are currently available — we'll keep searching.`
      );
      
      // Reset form
      setPatientName('');
      setBloodType('');
      setUnits('');
      setUrgency('');
      setHospital('');
      setNotes('');
      setIsModalOpen(false);

      // Refresh list
      fetchEmergencies();
    } catch (err: any) {
      showToast('warning', '❌ Request Failed', err.message || 'Could not broadcast request');
    }
  };

  const getDistance = (e: Emergency) => formatDistance(getDistanceKm(effectiveCoords, { lat: e.lat, lng: e.lng }));

  const filteredEmergencies = emergencies.filter((e) => {
    if (filter === 'All') return true;
    return e.urgency === filter;
  });

  const allCount = emergencies.length;
  const critCount = emergencies.filter((e) => e.urgency === 'Critical').length;
  const urgCount = emergencies.filter((e) => e.urgency === 'Urgent').length;
  const normCount = emergencies.filter((e) => e.urgency === 'Normal').length;

  return (
    <div className="page active" id="emergency">
      <div className="section-sm">
        <div className="dash-header">
          <div>
            <div className="dash-title">🚨 Emergency Blood Requests</div>
            <div className="dash-sub">Real-time board - sorted by urgency. Your response can save a life.</div>
          </div>
          <button className="btn btn-red" onClick={() => setIsModalOpen(true)}>
            + New Emergency Request
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button 
            className={`mf-btn ${filter === 'All' ? 'active' : ''}`}
            onClick={() => setFilter('All')}
          >
            All ({allCount})
          </button>
          <button 
            className={`mf-btn ${filter === 'Critical' ? 'active' : ''}`}
            onClick={() => setFilter('Critical')}
          >
            🔴 Critical ({critCount})
          </button>
          <button 
            className={`mf-btn ${filter === 'Urgent' ? 'active' : ''}`}
            onClick={() => setFilter('Urgent')}
          >
            🟡 Urgent ({urgCount})
          </button>
          <button 
            className={`mf-btn ${filter === 'Normal' ? 'active' : ''}`}
            onClick={() => setFilter('Normal')}
          >
            🟢 Normal ({normCount})
          </button>
        </div>

        {/* Cards list */}
        <div id="page-emergencies-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredEmergencies.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)' }}>
              No active emergency requests found for this filter.
            </div>
          ) : (
            filteredEmergencies.map((e) => {
              const cardClass = e.urgency.toLowerCase();
              const badgeClass = e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok';
              const dotIcon = e.urgency === 'Critical' ? '🔴' : e.urgency === 'Urgent' ? '🟡' : '🟢';
              const dist = getDistance(e);
              const statusMeta = STATUS_META[e.status] || STATUS_META['Pending'];
              const countdown = formatCountdown(e.expiresAt);
              const isTerminal = ['Fulfilled', 'Cancelled', 'Expired'].includes(e.status);
              const canRespond = e.status === 'Donors Notified';

              return (
                <div key={e.id} className={`emerg-card ${cardClass}`} style={{ padding: '1.5rem', opacity: isTerminal ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--red)' }}>{e.bloodType}</div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span className={`badge ${badgeClass}`} style={{ fontSize: '11px', padding: '4px 12px' }}>
                          {dotIcon} {e.urgency}
                        </span>
                        <span className={`badge ${statusMeta.badge}`} style={{ fontSize: '11px', padding: '4px 12px' }}>
                          {statusMeta.icon} {e.status}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: 'var(--gr)' }}>⏱ {e.time} · {e.alerts} donors notified</div>
                      {countdown && !isTerminal && (
                        <div style={{ fontSize: '11px', fontWeight: 700, color: countdown.expired ? 'var(--red)' : 'var(--or)', marginTop: '2px' }}>
                          ⌛ {countdown.label}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--gr)', textTransform: 'uppercase', fontWeight: 600 }}>Hospital</div>
                      <div style={{ fontWeight: 700 }}>{e.hospital}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--gr)', textTransform: 'uppercase', fontWeight: 600 }}>Location</div>
                      <div style={{ fontWeight: 700 }}>📍 Coimbatore · {dist}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--gr)', textTransform: 'uppercase', fontWeight: 600 }}>Units Needed</div>
                      <div style={{ fontWeight: 700, color: 'var(--red)' }}>{e.units} units</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--gr)', textTransform: 'uppercase', fontWeight: 600 }}>Ward</div>
                      <div style={{ fontWeight: 700 }}>{e.ward}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {isTerminal ? (
                      <span style={{ fontSize: '12px', color: 'var(--gr)', fontStyle: 'italic' }}>
                        This request is {e.status.toLowerCase()} — no further action needed.
                      </span>
                    ) : (
                      <button
                        className="btn btn-red"
                        disabled={!canRespond || respondingId === e.id}
                        onClick={() => handleRespond(e)}
                        title={!canRespond ? 'This request is not currently open for donor responses' : undefined}
                      >
                        {respondingId === e.id ? 'Responding…' : '✅ I Can Donate'}
                      </button>
                    )}
                    <button className="btn btn-outline" onClick={() => handleCall(e.hospital)}>
                      📞 Call Hospital
                    </button>
                    <button className="btn btn-gray" onClick={() => handleDirections(e)}>
                      🗺️ Directions
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* EMERGENCY REQUEST MODAL */}
      <div className={`modal-bg ${isModalOpen ? 'open' : ''}`}>
        <div className="modal">
          <button className="modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
          <div className="modal-title">🚨 Create Emergency Request</div>
          <div className="modal-sub">Broadcast an urgent blood request to all nearby donors instantly</div>
          
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px dashed #cbd5e1' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#3b82f6', marginBottom: '8px', textTransform: 'uppercase' }}>✨ AI Smart Autofill</div>
            <textarea 
              className="form-input" 
              placeholder="e.g. 'I urgently need 2 units of O positive blood at Apollo Hospital in Coimbatore for Sanjay Kumar'"
              rows={2}
              id="ai-prompt-input"
              style={{ fontSize: '13px', resize: 'none' }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const val = (e.target as HTMLTextAreaElement).value;
                  if (!val.trim()) return;
                  try {
                    const res = await api.parseNLPRequest(val);
                    if (res.blood_group) setBloodType(res.blood_group);
                    if (res.quantity) setUnits(res.quantity.toString());
                    if (res.hospital) setHospital(res.hospital);
                    if (res.urgency && res.urgency !== "Normal") setUrgency(res.urgency);
                    showToast('success', '✨ Auto-filled', 'AI successfully parsed your request!');
                  } catch (err) {
                    showToast('warning', '❌ Parsing failed', 'Could not parse text.');
                  }
                }
              }}
            />
            <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '8px' }}>Press <b>Enter</b> to automatically fill the form below.</div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Patient Name</label>
              <input 
                className="form-input" 
                placeholder="e.g. Sanjay Kumar" 
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Blood Type Needed</label>
                <select 
                  className="form-input" 
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value)}
                >
                  <option value="">Select type</option>
                  <option>A+</option><option>A-</option>
                  <option>B+</option><option>B-</option>
                  <option>O+</option><option>O-</option>
                  <option>AB+</option><option>AB-</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Units Needed</label>
                <input 
                  className="form-input" 
                  type="number" 
                  min="1" 
                  max="20" 
                  placeholder="e.g. 3" 
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Urgency Level</label>
              <select 
                className="form-input" 
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
              >
                <option value="">Select urgency</option>
                <option>Critical</option>
                <option>Urgent</option>
                <option>Normal</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Hospital / Location</label>
              <input 
                className="form-input" 
                placeholder="Apollo Hospital, RS Puram, Coimbatore" 
                value={hospital}
                onChange={(e) => setHospital(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Additional Notes</label>
              <textarea 
                className="form-input" 
                rows={2} 
                placeholder="Patient details, ward number, contact person..." 
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-emergency btn-full" style={{ justifyContent: 'center' }}>
              🚨 Broadcast Emergency Request
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
export default EmergencyBoard;
