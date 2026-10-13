import React, { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { api, type Camp } from '../api';
import { LeafletMap } from '../components/LeafletMap';
import { useGeolocation, getDistanceKm, formatDistance } from '../utils/geo';

const slotsData = [
  { value: "09:00 AM - 11:00 AM", label: "🌅 09:00 AM - 11:00 AM (Morning)" },
  { value: "11:00 AM - 01:00 PM", label: "☀️ 11:00 AM - 01:00 PM (Midday)" },
  { value: "02:00 PM - 04:00 PM", label: "🌤️ 02:00 PM - 04:00 PM (Afternoon)" },
  { value: "04:00 PM - 06:00 PM", label: "🌆 04:00 PM - 06:00 PM (Evening)" }
];

const SOURCE_LABELS: Record<string, { label: string; badge: string }> = {
  manual: { label: 'LifeLink Direct Entry', badge: 'b-ok' },
  official_api: { label: 'Official API Import', badge: 'b-blue' },
  web_import: { label: 'Public Web Listing', badge: 'b-urg' }
};

const VERIFICATION_META: Record<string, { icon: string; badge: string }> = {
  Verified: { icon: '✓', badge: 'b-ok' },
  Unverified: { icon: '?', badge: 'b-gray' },
  Flagged: { icon: '⚠', badge: 'b-crit' }
};

export const Camps: React.FC = () => {
  const { showToast } = useToast();
  const { user, isLoggedIn, refreshUser, usersList } = useAuth();
  const { effectiveCoords, isUsingFallback } = useGeolocation();

  const [camps, setCamps] = useState<Camp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('All Cities');
  const [dateFilter, setDateFilter] = useState<'upcoming' | 'week' | 'month' | 'all'>('upcoming');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  // "Organize a Camp" — real submission form
  const [showOrganizeForm, setShowOrganizeForm] = useState(false);
  const [newCamp, setNewCamp] = useState({ title: '', organizer: '', venue: '', city: 'Coimbatore', date: '', capacity: '50', contactPhone: '', contactEmail: '' });
  const [submittingCamp, setSubmittingCamp] = useState(false);

  // Camp registration slot modal state
  const [registeringCamp, setRegisteringCamp] = useState<Camp | null>(null);
  const [selectedCampSlot, setSelectedCampSlot] = useState('');

  // Appointment Calendar state
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Hardcoded appointment slots layout matching design
  const appointmentSlots = [
    { time: '9:00 AM', taken: true },
    { time: '9:30 AM', taken: true },
    { time: '10:00 AM', taken: false },
    { time: '10:30 AM', taken: false },
    { time: '11:00 AM', taken: true },
    { time: '11:30 AM', taken: false },
    { time: '2:00 PM', taken: false },
    { time: '2:30 PM', taken: false },
    { time: '3:00 PM', taken: true },
    { time: '3:30 PM', taken: false },
    { time: '4:00 PM', taken: false },
    { time: '4:30 PM', taken: true }
  ];

  const fetchCamps = () => {
    api.getCamps()
      .then(setCamps)
      .catch(console.error);
  };

  useEffect(() => {
    fetchCamps();
  }, []);

  const handleOrganizeCamp = () => {
    setShowOrganizeForm(true);
  };

  const handleSubmitNewCamp = async () => {
    if (!newCamp.title.trim() || !newCamp.date || !newCamp.venue.trim()) {
      showToast('warning', '⚠️ Missing details', 'Please fill in at least a title, venue, and date.');
      return;
    }
    setSubmittingCamp(true);
    try {
      await api.createCamp({
        id: 'camp-manual-' + Date.now(),
        title: newCamp.title.trim(),
        organizer: newCamp.organizer.trim() || undefined,
        venue: newCamp.venue.trim(),
        location: newCamp.venue.trim(),
        city: newCamp.city.trim() || 'Coimbatore',
        date: newCamp.date,
        limit: parseInt(newCamp.capacity, 10) || 50,
        registered: 0,
        approved: false,
        status: 'Under Review',
        contactPhone: newCamp.contactPhone.trim() || undefined,
        contactEmail: newCamp.contactEmail.trim() || undefined
      } as Partial<Camp>);
      showToast('success', '🏕 Camp Submitted', 'Your camp has been submitted for admin review before it appears publicly.');
      setShowOrganizeForm(false);
      setNewCamp({ title: '', organizer: '', venue: '', city: 'Coimbatore', date: '', capacity: '50', contactPhone: '', contactEmail: '' });
      fetchCamps();
    } catch (err: any) {
      showToast('warning', '⚠️ Could not submit', err.message || 'Please try again.');
    } finally {
      setSubmittingCamp(false);
    }
  };

  // Open slot selection for a specific mobile camp
  const handleRegisterCampClick = (camp: Camp) => {
    if (camp.registered >= camp.limit) {
      showToast('warning', '⚠️ Camp Full', `Sorry, "${camp.title}" has reached its registration limit.`);
      return;
    }
    setRegisteringCamp(camp);
    
    // Choose first available slot by default
    const slotLimit = Math.max(1, Math.ceil(camp.limit / 4));
    const firstAvailable = slotsData.find(slot => {
      const count = usersList.filter(u => {
        const reg = u.activeCampRegistration;
        return reg && reg.campTitle === camp.title && reg.slot === slot.value;
      }).length;
      return count < slotLimit;
    });
    setSelectedCampSlot(firstAvailable ? firstAvailable.value : slotsData[0].value);
  };

  const handleConfirmCampRegistration = async () => {
    if (!registeringCamp || !selectedCampSlot) return;

    const camp = registeringCamp;
    const slotLimit = Math.max(1, Math.ceil(camp.limit / 4));
    const count = usersList.filter(u => {
      const reg = u.activeCampRegistration;
      return reg && reg.campTitle === camp.title && reg.slot === selectedCampSlot;
    }).length;

    if (count >= slotLimit) {
      showToast('warning', '⚠️ Slot Full', `Sorry, this time slot has reached its limit of ${slotLimit} donors.`);
      return;
    }

    const verificationId = 'CAMP-REG-' + Math.floor(100000 + Math.random() * 900000);
    const campRegistration = {
      campTitle: camp.title,
      verificationId: verificationId,
      date: camp.date,
      slot: selectedCampSlot
    };

    try {
      // 1. Update camp registration count
      await api.updateCamp(camp.id, { registered: camp.registered + 1 });
      
      // 2. Save active registration to user profile if logged in
      if (isLoggedIn && user) {
        await api.updateUser(user.id, { activeCampRegistration: campRegistration });
        await refreshUser();
      }

      showToast('success', '✅ Registered!', `You're registered for "${camp.title}".`);
      showToast('info', '🪪 QR Pass Generated', `Show Pass ID ${verificationId} at the camp entrance.`);
      
      setRegisteringCamp(null);
      fetchCamps();
    } catch (err: any) {
      showToast('warning', '⚠️ Error', err.message || 'Could not register for camp.');
    }
  };

  // General appointment calendar booking
  const handleConfirmAppointment = () => {
    if (!selectedDate) {
      showToast('warning', '⚠️ Select a Date', 'Please choose a date from the calendar first.');
      return;
    }
    if (!selectedSlot) {
      showToast('warning', '⚠️ Select a Time', 'Please choose a time slot.');
      return;
    }
    showToast(
      'success',
      '📅 Appointment Booked!',
      `Your donation appointment is confirmed for July ${selectedDate} at ${selectedSlot}. Reminder set!`
    );
  };

  // Real filters: text search, real distinct cities from the data, and real date-range logic
  const realCities = Array.from(new Set(camps.map((c) => c.city).filter((c): c is string => !!c))).sort();

  const isWithinDateFilter = (campDateStr: string) => {
    const campDate = new Date(campDateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (dateFilter === 'all') return true;
    if (campDate < now) return false; // upcoming/week/month all imply future camps
    if (dateFilter === 'upcoming') return true;
    if (dateFilter === 'week') {
      const weekOut = new Date(now.getTime() + 7 * 86400000);
      return campDate <= weekOut;
    }
    if (dateFilter === 'month') {
      const monthOut = new Date(now.getTime() + 31 * 86400000);
      return campDate <= monthOut;
    }
    return true;
  };

  const filteredCamps = camps
    .filter((c) => {
      if (!c.approved) return false;
      if (c.status === 'Rejected') return false;
      if (selectedCity !== 'All Cities' && c.city !== selectedCity) return false;
      if (!isWithinDateFilter(c.date)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const haystack = `${c.title} ${c.venue || ''} ${c.organizer || ''} ${c.location}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="page active" id="camps">
      <div className="section-sm">
        <div className="dash-header">
          <div>
            <div className="dash-title">Donation Camps & Drives</div>
            <div className="dash-sub">Find and register for blood donation camps near you — sourced from LifeLink organizers, official APIs, and public listings</div>
          </div>
          <button className="btn btn-red" onClick={handleOrganizeCamp}>+ Organize a Camp</button>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-input"
            style={{ maxWidth: '220px' }}
            placeholder="🔍 Search camps, venues, organizers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="form-input"
            style={{ maxWidth: '160px' }}
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
          >
            <option>All Cities</option>
            {realCities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <select
            className="form-input"
            style={{ maxWidth: '160px' }}
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
          >
            <option value="upcoming">All Upcoming</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">Include Past Camps</option>
          </select>
          <div style={{ display: 'flex', marginLeft: 'auto', border: '1.5px solid var(--gr4)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
            <button
              className="btn btn-sm"
              style={{ background: viewMode === 'list' ? 'var(--red)' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--tx)', borderRadius: 0 }}
              onClick={() => setViewMode('list')}
            >
              📋 List
            </button>
            <button
              className="btn btn-sm"
              style={{ background: viewMode === 'map' ? 'var(--red)' : 'transparent', color: viewMode === 'map' ? '#fff' : 'var(--tx)', borderRadius: 0 }}
              onClick={() => setViewMode('map')}
            >
              🗺️ Map
            </button>
          </div>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--gr)', marginBottom: '1rem' }}>
          {filteredCamps.length} camp{filteredCamps.length === 1 ? '' : 's'} found
        </div>

        {viewMode === 'map' ? (
          <div style={{ marginBottom: '2rem' }}>
            <LeafletMap
              emergencies={[]}
              camps={filteredCamps}
              filters={{ donors: false, hospitals: false, bloodBanks: false, emergencies: false, camps: true }}
              userLocation={effectiveCoords}
              activeDirections={null}
            />
            <div style={{ fontSize: '11px', color: 'var(--gr)', marginTop: '6px' }}>
              {isUsingFallback ? 'Showing central Coimbatore as reference — enable location for distances.' : 'Using your live location.'}
            </div>
          </div>
        ) : (
        /* Dynamic Camps List */
        <div id="camps-list-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
          {filteredCamps.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--gr)', gridColumn: '1/-1' }}>
              No camps match your filters. Try widening the date range or clearing the search.
            </div>
          ) : (
            filteredCamps.map((c) => {
              const isFull = c.registered >= c.limit;
              const progressPct = Math.min(100, Math.round((c.registered / c.limit) * 100));
              const dist = c.lat != null && c.lng != null ? formatDistance(getDistanceKm(effectiveCoords, { lat: c.lat, lng: c.lng })) : null;
              const sourceMeta = SOURCE_LABELS[c.source] || SOURCE_LABELS.manual;
              const verifMeta = VERIFICATION_META[c.verificationStatus] || VERIFICATION_META.Unverified;

              return (
                <div key={c.id} className="card camp-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', marginBottom: '.4rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--red)' }}>{c.title}</div>
                      <span className={`badge ${verifMeta.badge}`} style={{ fontSize: '10px', whiteSpace: 'nowrap' }} title={`Verification status: ${c.verificationStatus}`}>
                        {verifMeta.icon} {c.verificationStatus}
                      </span>
                    </div>
                    {c.organizer && <div style={{ fontSize: '0.8rem', color: 'var(--gr)', marginBottom: '.3rem' }}>by {c.organizer}</div>}
                    <div style={{ fontSize: '0.9rem', color: 'var(--gr)', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      📅 <span>{c.date}{c.startTime ? ` · ${c.startTime}${c.endTime ? ` - ${c.endTime}` : ''}` : ''}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--gr)', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      📍 <span>{c.venue || c.location}{dist ? ` · ${dist} away` : ''}</span>
                    </div>
                    <div style={{ marginBottom: '.7rem' }}>
                      <span className={`badge ${sourceMeta.badge}`} style={{ fontSize: '10px' }} title={c.sourceUrl || undefined}>
                        Source: {sourceMeta.label}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                      <span>Registration Progress</span>
                      <span>{c.registered} / {c.limit}</span>
                    </div>
                    <div style={{ backgroundColor: 'var(--gr4)', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
                      <div style={{ width: `${progressPct}%`, height: '100%', background: 'linear-gradient(90deg, var(--red), #f87171)', borderRadius: '4px' }} />
                    </div>
                    {c.registrationUrl ? (
                      <a
                        href={c.registrationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-red btn-full"
                        style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}
                      >
                        🔗 Register on Organizer's Site
                      </a>
                    ) : (
                      <button
                        className="btn btn-red btn-full"
                        onClick={() => handleRegisterCampClick(c)}
                        disabled={isFull}
                      >
                        {isFull ? '🔒 Full' : 'Register Now'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* Appointment booking */}
        <div style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem' }}>📅 Book a Donation Appointment</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          
          {/* Calendar Card */}
          <div className="card">
            <div className="card-title">Select Date — July 2026</div>
            <div className="cal-grid">
              <div className="cal-day">Su</div><div className="cal-day">Mo</div><div className="cal-day">Tu</div>
              <div className="cal-day">We</div><div className="cal-day">Th</div><div className="cal-day">Fr</div>
              <div className="cal-day">Sa</div>
              
              {/* Row 1 */}
              <div className="cal-cell empty" />
              <div className="cal-cell empty" />
              <div className="cal-cell empty" />
              <div className={`cal-cell avail ${selectedDate === '1' ? 'selected' : ''}`} onClick={() => setSelectedDate('1')}>1</div>
              <div className={`cal-cell today ${selectedDate === '2' ? 'selected' : ''}`} onClick={() => setSelectedDate('2')}>2</div>
              <div className={`cal-cell avail ${selectedDate === '3' ? 'selected' : ''}`} onClick={() => setSelectedDate('3')}>3</div>
              <div className={`cal-cell avail ${selectedDate === '4' ? 'selected' : ''}`} onClick={() => setSelectedDate('4')}>4</div>
              
              {/* Row 2 */}
              <div className={`cal-cell avail ${selectedDate === '5' ? 'selected' : ''}`} onClick={() => setSelectedDate('5')}>5</div>
              <div className={`cal-cell avail ${selectedDate === '6' ? 'selected' : ''}`} onClick={() => setSelectedDate('6')}>6</div>
              <div className="cal-cell booked">7</div>
              <div className="cal-cell booked">8</div>
              <div className={`cal-cell avail ${selectedDate === '9' ? 'selected' : ''}`} onClick={() => setSelectedDate('9')}>9</div>
              <div className={`cal-cell avail ${selectedDate === '10' ? 'selected' : ''}`} onClick={() => setSelectedDate('10')}>10</div>
              <div className={`cal-cell avail ${selectedDate === '11' ? 'selected' : ''}`} onClick={() => setSelectedDate('11')}>11</div>
              
              {/* Row 3 */}
              <div className="cal-cell booked">12</div>
              <div className={`cal-cell avail ${selectedDate === '13' ? 'selected' : ''}`} onClick={() => setSelectedDate('13')}>13</div>
              <div className={`cal-cell avail ${selectedDate === '14' ? 'selected' : ''}`} onClick={() => setSelectedDate('14')}>14</div>
              <div className={`cal-cell avail ${selectedDate === '15' ? 'selected' : ''}`} onClick={() => setSelectedDate('15')}>15</div>
              <div className={`cal-cell avail ${selectedDate === '16' ? 'selected' : ''}`} onClick={() => setSelectedDate('16')}>16</div>
              <div className="cal-cell booked">17</div>
              <div className={`cal-cell avail ${selectedDate === '18' ? 'selected' : ''}`} onClick={() => setSelectedDate('18')}>18</div>

              {/* Row 4 */}
              <div className={`cal-cell avail ${selectedDate === '19' ? 'selected' : ''}`} onClick={() => setSelectedDate('19')}>19</div>
              <div className={`cal-cell avail ${selectedDate === '20' ? 'selected' : ''}`} onClick={() => setSelectedDate('20')}>20</div>
              <div className={`cal-cell avail ${selectedDate === '21' ? 'selected' : ''}`} onClick={() => setSelectedDate('21')}>21</div>
              <div className="cal-cell booked">22</div>
              <div className={`cal-cell avail ${selectedDate === '23' ? 'selected' : ''}`} onClick={() => setSelectedDate('23')}>23</div>
              <div className={`cal-cell avail ${selectedDate === '24' ? 'selected' : ''}`} onClick={() => setSelectedDate('24')}>24</div>
              <div className={`cal-cell avail ${selectedDate === '25' ? 'selected' : ''}`} onClick={() => setSelectedDate('25')}>25</div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#d1fae5' }} />
                Available
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#fee2e2' }} />
                Booked
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: 'var(--red)' }} />
                Today
              </div>
            </div>
          </div>

          {/* Time Slots Card */}
          <div className="card">
            <div className="card-title" id="slot-title">
              {selectedDate ? `Select Slot — July ${selectedDate}` : 'Select a date to see time slots'}
            </div>
            <div className="slot-grid">
              {appointmentSlots.map((slot, index) => {
                const isSelected = selectedSlot === slot.time;
                return (
                  <div 
                    key={index} 
                    className={`slot ${slot.taken ? 'taken' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (!slot.taken) setSelectedSlot(slot.time);
                    }}
                  >
                    {slot.time}
                  </div>
                );
              })}
            </div>
            <button className="btn btn-red btn-full" style={{ marginTop: '1rem' }} onClick={handleConfirmAppointment}>
              ✅ Confirm Appointment
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE CAMP SLOT SELECTION MODAL */}
      {registeringCamp && (
        <div className="modal-bg open" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ maxWidth: '400px', padding: '2rem', borderTop: '5px solid var(--red)' }}>
            <button className="modal-close" onClick={() => setRegisteringCamp(null)}>✕</button>
            <div className="modal-title" style={{ color: 'var(--red)', fontSize: '1.3rem' }}>Schedule Donation Slot</div>
            <div className="modal-sub" style={{ marginBottom: '1.5rem' }}>
              Select your preferred slot for <strong>{registeringCamp.title}</strong> (Max {Math.max(1, Math.ceil(registeringCamp.limit / 4))} per slot)
            </div>
            
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--tx)', display: 'block', marginBottom: '.5rem' }}>Date of Donation</label>
              <div style={{ background: 'var(--gr4)', padding: '.8rem', borderRadius: 'var(--r)', border: '1px solid var(--gr3)', fontWeight: 600, color: 'var(--tx)' }}>
                📅 {registeringCamp.date}
              </div>
            </div>
            
            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--tx)', display: 'block', marginBottom: '.5rem' }}>Select Time Slot</label>
              <select 
                id="donation-time-slot" 
                className="form-input" 
                style={{ width: '100%', padding: '.8rem', borderRadius: 'var(--r)', border: '1px solid var(--gr3)' }}
                value={selectedCampSlot}
                onChange={(e) => setSelectedCampSlot(e.target.value)}
              >
                {slotsData.map((slot) => {
                  const slotLimit = Math.max(1, Math.ceil(registeringCamp.limit / 4));
                  const count = usersList.filter(u => {
                    const reg = u.activeCampRegistration;
                    return reg && reg.campTitle === registeringCamp.title && reg.slot === slot.value;
                  }).length;
                  const isFull = count >= slotLimit;
                  const spotsLeft = slotLimit - count;

                  return (
                    <option key={slot.value} value={slot.value} disabled={isFull}>
                      {slot.label} {isFull ? '[FULL]' : `(${spotsLeft} spots left)`}
                    </option>
                  );
                })}
              </select>
            </div>
            
            <button className="btn btn-red btn-full" onClick={handleConfirmCampRegistration}>
              Confirm Booking
            </button>
          </div>
        </div>
      )}

      {showOrganizeForm && (
        <div className="modal-bg open" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ maxWidth: '460px', padding: '2rem', borderTop: '5px solid var(--red)' }}>
            <button className="modal-close" onClick={() => setShowOrganizeForm(false)}>✕</button>
            <div className="modal-title" style={{ color: 'var(--red)', fontSize: '1.3rem' }}>🏕 Organize a Camp</div>
            <div className="modal-sub" style={{ marginBottom: '1.25rem' }}>
              Submit your camp for review — it will appear publicly once approved by an admin, marked as a LifeLink direct entry.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input className="form-input" placeholder="Camp title *" value={newCamp.title} onChange={(e) => setNewCamp({ ...newCamp, title: e.target.value })} />
              <input className="form-input" placeholder="Organizer name" value={newCamp.organizer} onChange={(e) => setNewCamp({ ...newCamp, organizer: e.target.value })} />
              <input className="form-input" placeholder="Venue / address *" value={newCamp.venue} onChange={(e) => setNewCamp({ ...newCamp, venue: e.target.value })} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" placeholder="City" value={newCamp.city} onChange={(e) => setNewCamp({ ...newCamp, city: e.target.value })} />
                <input className="form-input" type="date" value={newCamp.date} onChange={(e) => setNewCamp({ ...newCamp, date: e.target.value })} />
              </div>
              <input className="form-input" type="number" min={1} placeholder="Expected capacity" value={newCamp.capacity} onChange={(e) => setNewCamp({ ...newCamp, capacity: e.target.value })} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" placeholder="Contact phone (optional)" value={newCamp.contactPhone} onChange={(e) => setNewCamp({ ...newCamp, contactPhone: e.target.value })} />
                <input className="form-input" placeholder="Contact email (optional)" value={newCamp.contactEmail} onChange={(e) => setNewCamp({ ...newCamp, contactEmail: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button className="btn btn-gray btn-full" onClick={() => setShowOrganizeForm(false)}>Cancel</button>
                <button className="btn btn-red btn-full" onClick={handleSubmitNewCamp} disabled={submittingCamp}>
                  {submittingCamp ? 'Submitting…' : 'Submit for Review'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Camps;
