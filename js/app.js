/* ============================================================
   LIFELINK — MAIN JAVASCRIPT
   ============================================================ */

/* ---- ROUTER ---- */
let isLoggedIn = false;
let currentUserId = null;

let emergenciesData = [];
let usersData = [];
let recentDonationsData = [];
let hospitalsData = [];
let bloodBanksData = [];
let campsData = [];
let transfersData = [];

async function syncAllData() {
  try {
    const [usersRes, emergRes, campsRes, donationsRes, hospRes, bbRes, transfersRes] = await Promise.all([
      fetch('/api/users').then(r => r.json()),
      fetch('/api/emergencies').then(r => r.json()),
      fetch('/api/camps').then(r => r.json()),
      fetch('/api/recent_donations').then(r => r.json()),
      fetch('/api/hospitals').then(r => r.json()),
      fetch('/api/blood_banks').then(r => r.json()),
      fetch('/api/transfers').then(r => r.json())
    ]);

    usersData = usersRes;
    emergenciesData = emergRes;
    mapLocations.emergencies = emergenciesData;
    campsData = campsRes;
    recentDonationsData = donationsRes;
    hospitalsData = hospRes;
    bloodBanksData = bbRes;
    transfersData = transfersRes;

    refreshAllEmergencyViews();
    renderAdminUsers();
    renderRecentDonations();
    renderAdminHospitals();
    renderAdminBloodBanks();
    renderAdminCamps();
    renderCampsList();
    renderLeaderboard();
    renderBloodPassport();
    renderDonorPortalProfile();
    renderHospitalPortalProfile();
    renderBloodBankPortalProfile();
    renderTransfersList();
    updateAuthNavbar();
  } catch (err) {
    console.error("Error syncing data from database:", err);
  }
}

// Function to save session to localStorage
function saveSession() {
  if (isLoggedIn && currentUserId) {
    localStorage.setItem('lifelink_session', JSON.stringify({
      isLoggedIn: isLoggedIn,
      currentUserId: currentUserId,
      lastActivity: Date.now()
    }));
  } else {
    localStorage.removeItem('lifelink_session');
  }
}

// Function to update last activity timestamp
function updateLastActivity() {
  const saved = localStorage.getItem('lifelink_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      session.lastActivity = Date.now();
      localStorage.setItem('lifelink_session', JSON.stringify(session));
    } catch (e) {
      console.error("Error updating last activity", e);
    }
  }
}

// Function to check session expiration
function checkSessionExpiration() {
  if (!isLoggedIn) return false;
  const saved = localStorage.getItem('lifelink_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      const INACTIVITY_LIMIT = 8 * 60 * 60 * 1000; // 8 hours in ms
      if (Date.now() - session.lastActivity > INACTIVITY_LIMIT) {
        isLoggedIn = false;
        currentUserId = null;
        localStorage.removeItem('lifelink_session');
        updateAuthNavbar();
        showPage('home');
        toast('warning', '🔒 Session Expired', 'You have been logged out due to inactivity.');
        return true;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return false;
}

let lastActivityUpdate = 0;
function handleUserActivity() {
  if (!isLoggedIn) return;
  if (checkSessionExpiration()) return;
  const now = Date.now();
  if (now - lastActivityUpdate > 10000) { // 10s throttle
    lastActivityUpdate = now;
    updateLastActivity();
  }
}

// Load session on startup
function loadSession() {
  const saved = localStorage.getItem('lifelink_session');
  if (saved) {
    try {
      const session = JSON.parse(saved);
      const INACTIVITY_LIMIT = 8 * 60 * 60 * 1000; // 8 hours in ms
      if (Date.now() - session.lastActivity > INACTIVITY_LIMIT) {
        localStorage.removeItem('lifelink_session');
        isLoggedIn = false;
        currentUserId = null;
        window.sessionExpiredOnLoad = true;
      } else {
        isLoggedIn = session.isLoggedIn;
        currentUserId = session.currentUserId;
        // update last activity immediately
        const sessionToSave = { ...session, lastActivity: Date.now() };
        localStorage.setItem('lifelink_session', JSON.stringify(sessionToSave));
      }
    } catch (e) {
      console.error("Error loading session", e);
      localStorage.removeItem('lifelink_session');
    }
  }
}

loadSession();

function showPage(id) {
  const rolePages = {
    'donor-dash': 'Donor',
    'hospital': 'Hospital',
    'bloodbank': 'Blood Bank',
    'dashboard': 'Admin'
  };

  if (rolePages[id]) {
    if (!isLoggedIn || !currentUserId) {
      toast('warning', '🔒 Access Denied', 'Please sign in to access this page.');
      id = 'auth';
    } else {
      const user = usersData.find(u => u.id === currentUserId);
      if (!user || user.role !== rolePages[id]) {
        toast('warning', '🔒 Access Denied', `${rolePages[id]} privileges required.`);
        if (user) {
          id = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
        } else {
          id = 'home';
        }
      }
    }
  }

  // Redirect to dashboard if logged in user tries to visit auth page
  if (id === 'auth' && isLoggedIn && currentUserId) {
    const user = usersData.find(u => u.id === currentUserId);
    if (user) {
      const targetPage = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
      id = targetPage;
    }
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active-link'));
  const pg = document.getElementById(id);
  if (pg) { pg.classList.add('active'); window.scrollTo(0,0); }
  const lnk = document.querySelector(`.nav-links a[data-page="${id}"]`);
  if (lnk) lnk.classList.add('active-link');
  // close mobile menu if open
  const mm = document.getElementById('mobile-menu');
  if (mm) mm.classList.remove('open');

  if (id === 'map') {
    setTimeout(initMap, 100);
  }

  if (id === 'leaderboard') {
    renderLeaderboard();
  } else if (id === 'camps') {
    renderCampsList();
  } else if (id === 'passport') {
    renderBloodPassport();
  }

  // Reset portal default views when entering them
  if (id === 'donor-dash') {
    const defaultTab = document.querySelector('#donor-dash .sidebar .si');
    if (defaultTab) donorNav(defaultTab, 'overview');
  } else if (id === 'hospital') {
    const defaultTab = document.querySelector('#hospital .sidebar .si');
    if (defaultTab) hospitalNav(defaultTab, 'overview');
  } else if (id === 'bloodbank') {
    const defaultTab = document.querySelector('#bloodbank .sidebar .si');
    if (defaultTab) bloodbankNav(defaultTab, 'overview');
  } else if (id === 'dashboard') {
    const defaultTab = document.querySelector('#dashboard .sidebar .si');
    if (defaultTab) adminNav(defaultTab, 'overview');
  }
}

function toggleMobileMenu() {
  const mm = document.getElementById('mobile-menu');
  if (!mm) return;
  mm.classList.toggle('open');
}

function updateAuthNavbar() {
  const container = document.getElementById('nav-auth-container');
  const mobileLi = document.getElementById('mobile-menu-auth-li');
  const navAdminLi = document.getElementById('nav-admin-li');
  const mobileAdminLi = document.getElementById('mobile-admin-li');
  const footerAdminLink = document.getElementById('footer-admin-link');
  
  if (!container) return;
  
  let isAdmin = false;
  
  if (isLoggedIn && currentUserId) {
    const user = usersData.find(u => u.id === currentUserId);
    if (user) {
      const targetPage = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
      isAdmin = (user.role === 'Admin');
      
      // Update desktop nav
      container.innerHTML = `
        <button class="btn btn-outline" onclick="showPage('${targetPage}')">👤 Dashboard</button>
        <button class="btn btn-gray" onclick="logout()" style="padding: 9px 12px">Sign Out</button>
      `;
      
      // Update mobile menu
      if (mobileLi) {
        mobileLi.innerHTML = `
          <a onclick="showPage('${targetPage}')" href="#" style="color: var(--red); font-weight: 700">👤 Dashboard</a>
          <a onclick="logout()" href="#" style="margin-top: 8px; font-size: 0.95rem; color: var(--gr)">Sign Out</a>
        `;
      }
    }
  } else {
    // Logged out state
    container.innerHTML = `<button class="btn btn-outline" onclick="showPage('auth')">Sign In / Register</button>`;
    if (mobileLi) {
      mobileLi.innerHTML = `<a onclick="showPage('auth')" href="#">Sign In / Register</a>`;
    }
  }

  // Toggle visibility of Admin links
  if (navAdminLi) navAdminLi.style.display = isAdmin ? 'block' : 'none';
  if (mobileAdminLi) mobileAdminLi.style.display = isAdmin ? 'block' : 'none';
  if (footerAdminLink) footerAdminLink.style.display = isAdmin ? 'inline-block' : 'none';
}

function logout() {
  isLoggedIn = false;
  currentUserId = null;
  saveSession();
  toast('info', '👋 Signed Out', 'You have been signed out successfully.');
  updateAuthNavbar();
  showPage('home');
}

function loginSimulation() {
  const name = prompt("Enter Name to Login (e.g. 'Arjun Kumar', 'Apollo Hospitals', 'City Blood Bank'):", "Arjun Kumar");
  if (!name) return;
  const user = usersData.find(u => u.name.toLowerCase() === name.toLowerCase()) || usersData.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (user) {
    isLoggedIn = true;
    currentUserId = user.id;
    saveSession();
    toast('success', '👋 Welcome Back!', `Successfully logged in as ${user.name} (${user.role})`);
    updateAuthNavbar();
    
    // Redirect to respective dashboard
    const targetPage = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
    showPage(targetPage);
    renderDonorPortalProfile();
    renderHospitalPortalProfile();
    renderBloodBankPortalProfile();
    renderBloodPassport();
  } else {
    toast('warning', '👤 User Not Found', `No registered account found for "${name}".`);
  }
}

function switchAuthTab(tab) {
  const regForm = document.getElementById('auth-register-form');
  const signinForm = document.getElementById('auth-signin-form');
  const tabs = document.querySelectorAll('.auth-tab');
  if (!tabs || tabs.length < 2) return;
  
  if (tab === 'register') {
    if (regForm) regForm.style.display = 'block';
    if (signinForm) signinForm.style.display = 'none';
    tabs[0].classList.add('active');
    tabs[0].style.borderBottom = '3px solid var(--red)';
    tabs[0].style.color = 'var(--tx)';
    tabs[1].classList.remove('active');
    tabs[1].style.borderBottom = 'none';
    tabs[1].style.color = 'var(--gr)';
  } else {
    if (regForm) regForm.style.display = 'none';
    if (signinForm) signinForm.style.display = 'block';
    tabs[0].classList.remove('active');
    tabs[0].style.borderBottom = 'none';
    tabs[0].style.color = 'var(--gr)';
    tabs[1].classList.add('active');
    tabs[1].style.borderBottom = '3px solid var(--red)';
    tabs[1].style.color = 'var(--tx)';
  }
}

function submitSignin() {
  const nameOrEmail = document.getElementById('signin-name')?.value.trim();
  const password = document.getElementById('signin-password')?.value;
  if (!nameOrEmail || !password) {
    toast('warning', '⚠️ Missing Info', 'Please enter your name or email, and password.');
    return;
  }

  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: nameOrEmail, password })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error("Invalid credentials");
    }
    return res.json();
  })
  .then(user => {
    isLoggedIn = true;
    currentUserId = user.id;
    saveSession();
    toast('success', '👋 Welcome Back!', `Successfully logged in as ${user.name} (${user.role})`);
    updateAuthNavbar();
    
    const targetPage = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
    showPage(targetPage);
    renderDonorPortalProfile();
    renderHospitalPortalProfile();
    renderBloodBankPortalProfile();
    renderBloodPassport();
    
    // Clear inputs
    const nameInput = document.getElementById('signin-name');
    const pwdInput = document.getElementById('signin-password');
    if (nameInput) nameInput.value = '';
    if (pwdInput) pwdInput.value = '';
  })
  .catch(err => {
    toast('warning', '👤 Login Failed', 'Invalid username, email, or password.');
  });
}

/* ---- TOAST ---- */
let toastQ = [];
function toast(type, title, msg) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const icons = { emergency:'🚨', success:'✅', info:'ℹ️', warning:'⚠️' };
  const cls   = { emergency:'ti-emerg', success:'ti-ok', info:'ti-info', warning:'ti-warn' };
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-icon ${cls[type]||'ti-info'}">${icons[type]||'🔔'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('hiding'); setTimeout(()=>t.remove(),320); }, 4200);
}

/* ---- AUTO NOTIFICATIONS ---- */
const autoNotifs = [
  ['emergency','🚨 Critical Request','A- blood needed at City General Hospital'],
  ['info','💉 Donor Reminder','3 donors in your area became newly eligible today'],
  ['success','✅ AI Match Found','Perfect O+ match located for pending request'],
  ['emergency','🚨 Urgent Request','B- blood needed at Apollo — 3.8 km away'],
  ['info','🏆 Leaderboard Update','Arjun Kumar just earned the Emergency Hero badge'],
  ['warning','⚠️ Low Stock Alert','O- stock critically low across 2 blood banks'],
];
let notifIdx = 0;
function fireNotif() {
  const n = autoNotifs[notifIdx % autoNotifs.length];
  toast(n[0], n[1], n[2]);
  notifIdx++;
  setTimeout(fireNotif, 9000 + Math.random() * 7000);
}
setTimeout(fireNotif, 3000);

/* ---- COUNTER ANIMATION ---- */
function animateCount(el, target, suffix='') {
  let val = 0;
  const step = Math.max(1, Math.ceil(target / 70));
  const timer = setInterval(() => {
    val = Math.min(val + step, target);
    el.textContent = val.toLocaleString() + suffix;
    if (val >= target) clearInterval(timer);
  }, 22);
}
function startCounters() {
  const els = document.querySelectorAll('[data-count]');
  els.forEach(el => {
    const target = parseInt(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    animateCount(el, target, suffix);
  });
}

/* ---- CHATBOT ---- */
function toggleChat() {
  const w = document.getElementById('chat-window');
  if (w) w.classList.toggle('open');
}
const botDB = {
  eligible: 'You can donate if you are 18–65 years old, weigh over 50 kg, and have not donated in the last 90 days. No fever or recent tattoos.',
  process: 'The donation takes ~45 minutes total: registration (10 min), health screening (10 min), actual donation (10 min), and rest (15 min). Safe and simple!',
  bank: 'Nearby blood banks: City Blood Bank (2.1 km, open 8AM–8PM) and Red Cross Center (3.8 km, open 9AM–6PM). Both are verified.',
  emergency: 'For an emergency, click the SOS button at the top-right or visit the Emergency page. Your request will be broadcast to all nearby eligible donors instantly.',
  default: 'I can help with eligibility, nearby blood banks, the donation process, and emergencies. What would you like to know?'
};
function quickReply(msg) {
  document.getElementById('chat-input').value = msg;
  sendChat();
}
function sendChat() {
  const inp = document.getElementById('chat-input');
  const msgs = document.getElementById('chat-msgs');
  const msg = inp.value.trim();
  if (!msg) return;
  msgs.innerHTML += `<div class="msg msg-user">${msg}</div>`;
  inp.value = '';
  msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => {
    const lc = msg.toLowerCase();
    let reply = botDB.default;
    if (lc.match(/eligib|can i donate|qualify/)) reply = botDB.eligible;
    else if (lc.match(/process|how|work|step/)) reply = botDB.process;
    else if (lc.match(/bank|near|find|locat/)) reply = botDB.bank;
    else if (lc.match(/emerg|urgent|sos|critical/)) reply = botDB.emergency;
    msgs.innerHTML += `<div class="msg msg-bot">${reply}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  }, 700);
}

/* ---- EMERGENCY RESPOND ---- */
function respondEmergency(bloodType, hospital) {
  toast('success', '✅ Response Confirmed!', `You responded to ${bloodType} request at ${hospital}. They will contact you within 5 minutes.`);
}

/* ---- LEAFLET MAP & DATA ---- */
let map = null;
let donorLayerGroup = null;
let hospitalLayerGroup = null;
let bloodBankLayerGroup = null;
let emergencyLayerGroup = null;
let routeLine = null;

/* ---- EMERGENCIES UNIFIED DATA STATE ---- */
// emergenciesData is initialized dynamically from the SQLite database

const mapLocations = {
  donors: [
    { name: 'Arjun Kumar', type: 'O+', lat: 11.0080, lng: 76.9650, info: 'O+ · Available · 1.8 km away · Last active 2h ago' },
    { name: 'Priya Sundaram', type: 'A+', lat: 11.0280, lng: 76.9500, info: 'A+ · Available · 2.4 km away · Last active 30m ago' },
    { name: 'Rahul Menon', type: 'B+', lat: 11.0350, lng: 76.9750, info: 'B+ · Available · 3.1 km away · Last active 5h ago' },
    { name: 'Deepa Raj', type: 'AB-', lat: 11.0450, lng: 76.9850, info: 'AB- · Available · 4.2 km away · Last active 1d ago' },
    { name: 'Vijay Natarajan', type: 'O-', lat: 10.9900, lng: 76.9420, info: 'O- · Available · 3.8 km away · Last active 3h ago' },
    { name: 'Meena Lakshmi', type: 'A-', lat: 11.0500, lng: 76.9400, info: 'A- · Available · 4.9 km away · Last active 6h ago' }
  ],
  emergencies: emergenciesData,
  hospitals: [
    { name: 'Apollo Hospitals', desc: 'RS Puram · Open 24/7 · Has B+ in stock', lat: 11.0110, lng: 76.9450 },
    { name: 'KMCH Medical Center', desc: 'Peelamedu · Open 24/7 · Needs O+', lat: 11.0250, lng: 77.0100 },
    { name: 'City General Hospital', desc: 'Coimbatore City Center · Critical A- request', lat: 10.9990, lng: 76.9630 },
    { name: 'GKNM Hospital', desc: 'Pappanaickenpalayam · Critical O- request', lat: 11.0160, lng: 76.9790 }
  ],
  bloodBanks: [
    { name: 'City Blood Bank', desc: 'Race Course · 8AM–8PM · 12 types available', lat: 11.0020, lng: 76.9730 },
    { name: 'Red Cross Center', desc: 'Gandhipuram · 9AM–6PM · 8 types available', lat: 11.0220, lng: 76.9690 }
  ]
};

function initMap() {
  if (typeof L === 'undefined') {
    const container = document.getElementById('map-area');
    if (container) {
      container.innerHTML = '<div style="color:var(--red);padding:2rem;text-align:center;font-weight:700">⚠️ Live Map is currently unavailable (Leaflet failed to load)</div>';
    }
    return;
  }
  const container = document.getElementById('map-area');
  if (!container) return;

  if (map) {
    map.invalidateSize();
    return;
  }

  // Initialize Map centered on Coimbatore
  map = L.map('map-area', {
    zoomControl: true,
    minZoom: 10,
    maxZoom: 18
  }).setView([11.0168, 76.9558], 13);

  // Add CartoDB Dark Matter tile layer for a highly premium dark aesthetic
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Create Leaflet layer groups
  donorLayerGroup = L.layerGroup().addTo(map);
  hospitalLayerGroup = L.layerGroup().addTo(map);
  bloodBankLayerGroup = L.layerGroup().addTo(map);
  emergencyLayerGroup = L.layerGroup().addTo(map);

  // Styling helpers
  const markerStyle = (fillColor) => ({
    radius: 7,
    fillColor: fillColor,
    color: '#ffffff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.95
  });

  // User indicator (blue circle with white border)
  L.circleMarker([11.0168, 76.9558], {
    radius: 9,
    fillColor: '#3b82f6',
    color: '#ffffff',
    weight: 3,
    opacity: 1,
    fillOpacity: 0.95
  }).addTo(map).bindPopup('<strong>📍 Your Location</strong><br>Coimbatore City Center');

  // Load Donors
  mapLocations.donors.forEach(d => {
    const m = L.circleMarker([d.lat, d.lng], markerStyle('#e74c3c'))
      .addTo(donorLayerGroup)
      .bindPopup(`<strong>👤 ${d.name} (${d.type})</strong><br>${d.info}`);
    
    m.on('click', () => {
      toast('success', `👤 ${d.name}`, d.info);
    });
  });

  // Load Emergencies (Pulse markers)
  updateMapEmergencyMarkers();

  // Load Hospitals
  mapLocations.hospitals.forEach(h => {
    const m = L.circleMarker([h.lat, h.lng], {
      ...markerStyle('#3b82f6'),
      radius: 9
    })
      .addTo(hospitalLayerGroup)
      .bindPopup(`<strong>🏥 ${h.name}</strong><br>${h.desc}`);
    
    m.on('click', () => {
      toast('info', `🏥 ${h.name}`, h.desc);
    });
  });

  // Load Blood Banks
  mapLocations.bloodBanks.forEach(b => {
    const m = L.circleMarker([b.lat, b.lng], {
      ...markerStyle('#10b981'),
      radius: 8
    })
      .addTo(bloodBankLayerGroup)
      .bindPopup(`<strong>🩸 ${b.name}</strong><br>${b.desc}`);
    
    m.on('click', () => {
      toast('info', `🩸 ${b.name}`, b.desc);
    });
  });

  // Render initial list of emergencies in the sidebar
  renderMapEmergencyList();

  // Invalidate size once after loading to render tiles correctly
  setTimeout(() => map.invalidateSize(), 200);
}

/* ---- MAP SIDEBAR TABS & LISTS ---- */
function switchMapTab(tab) {
  const reqBtn = document.getElementById('tab-btn-requests');
  const dirBtn = document.getElementById('tab-btn-directions');
  const reqTab = document.getElementById('map-tab-requests');
  const dirTab = document.getElementById('map-tab-directions');

  if (tab === 'requests') {
    reqBtn.classList.add('active');
    dirBtn.classList.remove('active');
    reqTab.style.display = 'flex';
    dirTab.style.display = 'none';
  } else {
    reqBtn.classList.remove('active');
    dirBtn.classList.add('active');
    reqTab.style.display = 'none';
    dirTab.style.display = 'flex';
  }
}

function renderMapEmergencyList() {
  const container = document.getElementById('map-tab-requests');
  if (!container) return;

  container.innerHTML = '';
  const start = [11.0168, 76.9558];

  emergenciesData.forEach(e => {
    // Calculate distance safely
    let dist = '0.0';
    if (typeof L !== 'undefined') {
      dist = (L.latLng(start).distanceTo(L.latLng([e.lat, e.lng])) / 1000).toFixed(1);
    } else {
      const dLat = start[0] - e.lat;
      const dLng = start[1] - e.lng;
      dist = (Math.sqrt(dLat * dLat + dLng * dLng) * 111.0).toFixed(1);
    }
    
    const card = document.createElement('div');
    card.className = `sidebar-req-card ${e.urgency.toLowerCase()}`;
    card.id = `sidebar-req-${e.id}`;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <span class="badge b-crit" style="font-size:11px;padding:2px 8px">${e.bloodType}</span>
        <span class="badge ${e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok'}">${e.urgency}</span>
      </div>
      <div style="font-weight:800;font-size:13px;color:var(--tx)">${e.patientName}</div>
      <div style="font-size:11px;color:var(--gr);margin-top:2px">🏥 ${e.hospital} · ${e.ward}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;border-top:1px solid rgba(0,0,0,.04);padding-top:8px">
        <span style="font-size:11px;font-weight:700;color:var(--gr)">📍 ${dist} km away</span>
        <button class="btn btn-red btn-sm" style="padding:4px 10px;font-size:11px" onclick="event.stopPropagation(); showDirections(${e.lat}, ${e.lng}, '${e.hospital} (${e.patientName})', '${e.id}')">Route Me 🛣️</button>
      </div>
    `;
    
    card.addEventListener('click', () => {
      if (map) {
        map.setView([e.lat, e.lng], 16);
        toast('info', `📍 Center on ${e.patientName}`, `${e.hospital} · ${e.ward}`);
      }
    });
    
    container.appendChild(card);
  });
}

function viewOnMap(lat, lng, name, desc) {
  if (typeof L === 'undefined') {
    toast('warning', '⚠️ Map Unavailable', 'The live map did not load correctly.');
    return;
  }
  showPage('map');
  setTimeout(() => {
    if (!map) {
      initMap();
    }
    if (map) {
      // Clear route line if viewing another single entity
      if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
      }
      map.setView([lat, lng], 15);
      toast('info', `📍 Center on ${name}`, desc);
    }
  }, 200);
}

function getCompassDirection(start, end) {
  const latDiff = end[0] - start[0];
  const lngDiff = end[1] - start[1];
  let dir = '';
  if (latDiff > 0.003) dir += 'North';
  else if (latDiff < -0.003) dir += 'South';
  if (lngDiff > 0.003) dir += dir ? 'east' : 'East';
  else if (lngDiff < -0.003) dir += dir ? 'west' : 'West';
  return dir || 'ahead';
}

function showDirections(destLat, destLng, destName, emergencyId) {
  if (typeof L === 'undefined') {
    toast('warning', '⚠️ Navigation Unavailable', 'Routing is disabled because the map library did not load.');
    return;
  }
  showPage('map');
  setTimeout(() => {
    if (!map) {
      initMap();
    }
    if (map) {
      // Remove previous route if any
      if (routeLine) {
        map.removeLayer(routeLine);
      }

      // Mark clicked card as active in sidebar
      document.querySelectorAll('.sidebar-req-card').forEach(c => c.classList.remove('active'));
      if (emergencyId) {
        const c = document.getElementById(`sidebar-req-${emergencyId}`);
        if (c) c.classList.add('active');
      }

      const start = [11.0168, 76.9558];
      const end = [destLat, destLng];

      // Build turn-by-turn list container and panels
      const emptyState = document.getElementById('nav-empty-state');
      const routeInfo = document.getElementById('nav-route-info');
      const destEl = document.getElementById('nav-dest-name');
      const distEl = document.getElementById('nav-distance');
      const durEl = document.getElementById('nav-duration');
      const stepsList = document.getElementById('nav-steps-list');
      const googleMapsBtn = document.getElementById('google-maps-btn');

      // Setup Google Maps routing link
      if (googleMapsBtn) {
        googleMapsBtn.href = `https://www.google.com/maps/dir/?api=1&origin=${start[0]},${start[1]}&destination=${destLat},${destLng}&travelmode=driving`;
      }

      // Switch view to Turn-by-Turn tab
      switchMapTab('directions');

      // Formulate OSRM API driving route URL with turn steps enabled
      const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;

      // Visual temporary indicator
      toast('info', '🗺️ Routing Engine', `Calculating driving route to ${destName}...`);

      fetch(url)
        .then(response => response.json())
        .then(data => {
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const drivingDist = (route.distance / 1000).toFixed(1);
            const drivingDuration = Math.round(route.duration / 60);

            // Draw road-snapped GeoJSON polyline path
            routeLine = L.geoJSON(route.geometry, {
              style: {
                color: '#e74c3c',
                weight: 5,
                dashArray: '8, 8',
                opacity: 0.85
              }
            }).addTo(map);

            // Fit map view bounds around the road route path
            map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

            // Display dynamic interactive road navigation popup
            L.popup()
              .setLatLng(end)
              .setContent(`<strong>🛣️ Actual Driving Route to ${destName}</strong><br>Distance: <strong>${drivingDist} km</strong><br>Duration: <strong>${drivingDuration} mins</strong><br><span style="color:var(--red);font-weight:700">Hospital is alerted. Drive safely! 🚗</span>`)
              .openOn(map);

            // Update Turn-by-Turn Sidebar UI
            if (emptyState) emptyState.style.display = 'none';
            if (routeInfo) routeInfo.style.display = 'flex';
            if (destEl) destEl.textContent = destName;
            if (distEl) distEl.textContent = `${drivingDist} km`;
            if (durEl) durEl.textContent = `${drivingDuration} mins`;

            // Parse and render step directions
            if (stepsList) {
              stepsList.innerHTML = '';
              if (route.legs && route.legs[0] && route.legs[0].steps) {
                route.legs[0].steps.forEach((step, idx) => {
                  let instruction = step.maneuver.instruction;
                  const type = step.maneuver.type;
                  const mod = step.maneuver.modifier;
                  const name = step.name;

                  if (!instruction) {
                    if (type === 'depart') {
                      instruction = `Depart on ${name || 'street'}`;
                    } else if (type === 'arrive') {
                      instruction = `Arrive at destination: ${destName}`;
                    } else if (type === 'turn') {
                      instruction = `Turn ${mod || ''} onto ${name || 'street'}`;
                    } else if (type === 'merge') {
                      instruction = `Merge onto ${name || 'street'}`;
                    } else if (type === 'continue') {
                      instruction = `Continue on ${name || 'street'}`;
                    } else {
                      instruction = `Head ${mod || ''} on ${name || 'street'}`;
                    }
                  }

                  let distText = step.distance > 0 ? `${step.distance.toFixed(0)} m` : '';
                  let icon = '➡️';

                  if (type === 'depart') icon = '🟢';
                  else if (type === 'arrive') icon = '🏁';
                  else if (mod && mod.includes('left')) icon = '⬅️';
                  else if (mod && mod.includes('right')) icon = '➡️';
                  else if (mod && mod.includes('straight')) icon = '⬆️';

                  const stepEl = document.createElement('div');
                  stepEl.className = 'step-item';
                  stepEl.innerHTML = `
                    <div class="step-icon">${icon}</div>
                    <div class="step-content">
                      <div style="font-weight: 600; text-transform: capitalize;">${instruction}</div>
                      ${distText ? `<div class="step-meta">For ${distText}</div>` : ''}
                    </div>
                  `;
                  stepsList.appendChild(stepEl);
                });
              }
            }

            toast('success', `🗺️ Driving Route Ready`, `Street routing: ${drivingDist} km (${drivingDuration} mins driving time).`);
          } else {
            throw new Error('OSRM Route not Ok');
          }
        })
        .catch(err => {
          console.warn('OSRM routing engine failed or timed out. Falling back to geodesic path:', err);
          
          // Graceful fallback to geodesic line
          routeLine = L.polyline([start, end], {
            color: '#e74c3c',
            weight: 4,
            dashArray: '8, 8',
            opacity: 0.8
          }).addTo(map);

          map.fitBounds(L.latLngBounds([start, end]), { padding: [50, 50] });

          const geodeticDist = (L.latLng(start).distanceTo(L.latLng(end)) / 1000).toFixed(1);
          const geodeticDuration = Math.round(geodeticDist * 2.5); // Estimate 2.5 minutes per km in standard city driving

          L.popup()
            .setLatLng(end)
            .setContent(`<strong>🚨 Geodesic Route to ${destName}</strong><br>Direct Distance: ${geodeticDist} km<br><span style="color:var(--red);font-weight:700">Fallback routing enabled. Drive safely!</span>`)
            .openOn(map);

          // Update Turn-by-Turn Sidebar UI withFallback directions
          if (emptyState) emptyState.style.display = 'none';
          if (routeInfo) routeInfo.style.display = 'flex';
          if (destEl) destEl.textContent = destName;
          if (distEl) distEl.textContent = `${geodeticDist} km (direct)`;
          if (durEl) durEl.textContent = `${geodeticDuration} mins`;

          // Generate beautiful geodesic mockup steps
          if (stepsList) {
            stepsList.innerHTML = '';
            const compass = getCompassDirection(start, end);
            
            const steps = [
              { icon: '🟢', text: 'Depart from your current location at Coimbatore City Center.', meta: `Head ${compass}` },
              { icon: '⬆️', text: `Drive straight in the direction of ${destName} following the straight-line corridor.`, meta: `Distance: ${geodeticDist} km` },
              { icon: '🏁', text: `Arrive safely at ${destName}. Emergency staff are on alert!`, meta: 'Alert sent successfully' }
            ];

            steps.forEach(s => {
              const stepEl = document.createElement('div');
              stepEl.className = 'step-item';
              stepEl.innerHTML = `
                <div class="step-icon">${s.icon}</div>
                <div class="step-content">
                  <div>${s.text}</div>
                  <div class="step-meta">${s.meta}</div>
                </div>
              `;
              stepsList.appendChild(stepEl);
            });
          }

          toast('warning', `🗺️ Route (Fallback)`, `Straight-line distance: ${geodeticDist} km.`);
        });
    }
  }, 200);
}

/* ---- MAP FILTER ---- */
function filterMap(btn) {
  document.querySelectorAll('.mf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filter = btn.textContent.trim();
  
  if (!map) {
    toast('info', '🗺️ Map Updated', `Showing: ${filter}`);
    return;
  }
  
  if (filter === 'All') {
    map.addLayer(donorLayerGroup);
    map.addLayer(hospitalLayerGroup);
    map.addLayer(bloodBankLayerGroup);
    map.addLayer(emergencyLayerGroup);
  } else if (filter === 'Emergencies') {
    map.removeLayer(donorLayerGroup);
    map.removeLayer(hospitalLayerGroup);
    map.removeLayer(bloodBankLayerGroup);
    map.addLayer(emergencyLayerGroup);
  } else if (filter === 'Donors') {
    map.addLayer(donorLayerGroup);
    map.removeLayer(hospitalLayerGroup);
    map.removeLayer(bloodBankLayerGroup);
    map.removeLayer(emergencyLayerGroup);
  } else if (filter === 'Hospitals') {
    map.removeLayer(donorLayerGroup);
    map.addLayer(hospitalLayerGroup);
    map.removeLayer(bloodBankLayerGroup);
    map.removeLayer(emergencyLayerGroup);
  } else if (filter === 'Blood Banks') {
    map.removeLayer(donorLayerGroup);
    map.removeLayer(hospitalLayerGroup);
    map.addLayer(bloodBankLayerGroup);
    map.removeLayer(emergencyLayerGroup);
  }
  
  toast('info', '🗺️ Map Updated', `Showing: ${filter}`);
}

/* ---- CALENDAR ---- */
function selectDate(el, day) {
  document.querySelectorAll('.cal-cell.selected').forEach(c => {
    c.classList.remove('selected');
    c.classList.add('avail');
  });
  el.classList.remove('avail');
  el.classList.add('selected');
  const title = document.getElementById('slot-title');
  if (title) title.textContent = `Available time slots — July ${day}`;
}

function selectSlot(el) {
  if (el.classList.contains('taken')) return;
  document.querySelectorAll('.slot.selected').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

/* ---- APPOINTMENT BOOKING ---- */
function bookAppointment() {
  const selDate = document.querySelector('.cal-cell.selected');
  const selSlot = document.querySelector('.slot.selected');
  if (!selDate) { toast('warning', '📅 Select a Date', 'Please choose a date from the calendar first.'); return; }
  if (!selSlot) { toast('warning', '⏰ Select a Time', 'Please choose a time slot.'); return; }
  toast('success', '✅ Appointment Booked!', `Your donation appointment is confirmed for July ${selDate.textContent} at ${selSlot.textContent}. Reminder set!`);
}

/* ---- ROLE SELECT (AUTH) ---- */
function selectRole(el) {
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  
  const roleName = el.querySelector('.role-name').textContent.trim();
  const fnameLabel = document.getElementById('signup-fname-label');
  const fnameInput = document.getElementById('signup-fname');
  const lnameContainer = document.getElementById('signup-lname-container');
  const bloodContainer = document.getElementById('signup-blood-container');
  const licenseContainer = document.getElementById('signup-license-container');
  const docContainer = document.getElementById('signup-doc-container');
  
  if (!fnameLabel || !fnameInput) return;
  
  if (roleName === 'Donor' || roleName === 'Patient / Family') {
    fnameLabel.textContent = 'First Name';
    fnameInput.placeholder = 'Arjun';
    if (lnameContainer) lnameContainer.style.display = 'block';
    if (bloodContainer) bloodContainer.style.display = 'block';
    if (licenseContainer) licenseContainer.style.display = 'none';
    if (docContainer) docContainer.style.display = 'none';
  } else if (roleName === 'Hospital') {
    fnameLabel.textContent = 'Hospital Name';
    fnameInput.placeholder = 'KG Hospital & PG Inst.';
    if (lnameContainer) lnameContainer.style.display = 'none';
    if (bloodContainer) bloodContainer.style.display = 'none';
    if (licenseContainer) licenseContainer.style.display = 'block';
    if (docContainer) docContainer.style.display = 'block';
  } else if (roleName === 'Blood Bank') {
    fnameLabel.textContent = 'Blood Bank Name';
    fnameInput.placeholder = 'Kovai Donor Club & Bank';
    if (lnameContainer) lnameContainer.style.display = 'none';
    if (bloodContainer) bloodContainer.style.display = 'none';
    if (licenseContainer) licenseContainer.style.display = 'block';
    if (docContainer) docContainer.style.display = 'block';
  }
}

function handleSignupFileChange(input) {
  const label = document.getElementById('signup-file-label');
  if (label && input.files && input.files[0]) {
    label.innerHTML = `📄 <strong style="color:var(--tx)">${input.files[0].name}</strong> uploaded successfully.`;
  }
}

function showSlotSelectionModal(camp) {
  const modalBg = document.createElement('div');
  modalBg.className = 'modal-bg open';
  modalBg.id = 'camp-slot-modal';
  modalBg.style.zIndex = '9999';
  
  // Calculate slot limit (e.g. limit divided by 4 slots)
  const slotLimit = Math.max(1, Math.ceil(camp.limit / 4));
  
  // Define slots
  const slots = [
    { value: "09:00 AM - 11:00 AM", label: "🌅 09:00 AM - 11:00 AM (Morning)" },
    { value: "11:00 AM - 01:00 PM", label: "☀️ 11:00 AM - 01:00 PM (Midday)" },
    { value: "02:00 PM - 04:00 PM", label: "🌤️ 02:00 PM - 04:00 PM (Afternoon)" },
    { value: "04:00 PM - 06:00 PM", label: "🌆 04:00 PM - 06:00 PM (Evening)" }
  ];
  
  // Build dropdown options dynamically checking slot capacity
  let optionsHtml = '';
  slots.forEach(slot => {
    // Count active registrations in this slot for this camp
    const count = usersData.filter(u => {
      const reg = u.activeCampRegistration;
      return reg && reg.campTitle === camp.title && reg.slot === slot.value;
    }).length;
    
    const isFull = count >= slotLimit;
    const isDisabled = isFull ? 'disabled' : '';
    const statusText = isFull ? '[FULL]' : `(${slotLimit - count} spots left)`;
    
    optionsHtml += `
      <option value="${slot.value}" ${isDisabled}>
        ${slot.label} ${statusText}
      </option>
    `;
  });
  
  modalBg.innerHTML = `
    <div class="modal" style="max-width:400px; padding:2rem; border-top: 5px solid var(--red)">
      <button class="modal-close" onclick="document.getElementById('camp-slot-modal').remove()">×</button>
      <div class="modal-title" style="color:var(--red); font-size:1.3rem">Schedule Donation Slot</div>
      <div class="modal-sub" style="margin-bottom:1.5rem">Select your preferred slot for <strong>${camp.title}</strong> (Max ${slotLimit} per slot)</div>
      
      <div class="form-group" style="margin-bottom:1.25rem">
        <label style="font-size:12px; font-weight:700; color:var(--tx); display:block; margin-bottom:.5rem">Date of Donation</label>
        <div style="background:var(--gr4); padding:.8rem; border-radius:var(--r); border:1px solid var(--gr3); font-weight:600; color:var(--tx)">
          📅 ${camp.date}
        </div>
      </div>
      
      <div class="form-group" style="margin-bottom:2rem">
        <label style="font-size:12px; font-weight:700; color:var(--tx); display:block; margin-bottom:.5rem">Select Time Slot</label>
        <select id="donation-time-slot" class="form-input" style="width:100%; padding:.8rem; border-radius:var(--r); border:1px solid var(--gr3)">
          ${optionsHtml}
        </select>
      </div>
      
      <button class="btn btn-red btn-full" onclick="confirmCampRegistration('${camp.id}', document.getElementById('donation-time-slot').value)">Confirm Booking</button>
    </div>
  `;
  document.body.appendChild(modalBg);
}

function confirmCampRegistration(campId, selectedSlot) {
  const camp = campsData.find(c => c.id === campId);
  if (!camp) return;
  
  // Calculate slot limit and verify slot space
  const slotLimit = Math.max(1, Math.ceil(camp.limit / 4));
  const count = usersData.filter(u => {
    const reg = u.activeCampRegistration;
    return reg && reg.campTitle === camp.title && reg.slot === selectedSlot;
  }).length;
  
  if (count >= slotLimit) {
    toast('warning', '⚠️ Slot Full', `Sorry, this time slot has reached its limit of ${slotLimit} donors.`);
    return;
  }
  
  const slotModal = document.getElementById('camp-slot-modal');
  if (slotModal) slotModal.remove();

  const verificationId = 'CAMP-REG-' + Math.floor(100000 + Math.random() * 900000);
  
  const campRegistration = {
    campTitle: camp.title,
    verificationId: verificationId,
    date: camp.date,
    slot: selectedSlot
  };
  
  fetch(`/api/camps/${camp.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registered: camp.registered + 1 })
  })
  .then(() => {
    if (isLoggedIn && currentUserId) {
      return fetch(`/api/users/${currentUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeCampRegistration: campRegistration })
      });
    }
  })
  .then(() => {
    toast('success', '✅ Registered!', `You're registered for "${camp.title}".`);
    showCampRegistrationSuccess(camp.title, camp.date, selectedSlot, verificationId);
    syncAllData();
  })
  .catch(err => {
    console.error("Error registering camp:", err);
    toast('warning', '⚠️ Error', 'Could not register for camp.');
  });
}

function showCampRegistrationSuccess(campTitle, date, slot, verificationId) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&color=991b1b&data=${verificationId}`;
  
  const modalBg = document.createElement('div');
  modalBg.className = 'modal-bg open';
  modalBg.id = 'camp-success-modal';
  modalBg.style.zIndex = '9999';
  
  modalBg.innerHTML = `
    <div class="modal" style="max-width:400px; text-align:center; padding:2rem; border-top: 5px solid var(--red)">
      <div style="font-size:3rem; margin-bottom:0.5rem">🎉</div>
      <div class="modal-title" style="color:var(--red); font-size:1.4rem; margin-bottom:0.25rem">Registration Confirmed!</div>
      <div class="modal-sub" style="margin-bottom:1.25rem">Your appointment is booked for <strong>${campTitle}</strong></div>
      
      <div style="display:flex; justify-content:center; margin-bottom:1.25rem">
        <div style="background:#fff; padding:10px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.08); border:1px solid var(--gr3)">
          <img src="${qrUrl}" alt="QR Code" style="width:140px; height:140px; display:block" />
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:1.25rem; text-align:left">
        <div style="background:var(--gr4); padding:.75rem; border-radius:var(--r); border:1px solid var(--gr3)">
          <div style="font-size:9px; text-transform:uppercase; color:var(--gr)">Date</div>
          <div style="font-size:12px; font-weight:700; color:var(--tx)">📅 ${date}</div>
        </div>
        <div style="background:var(--gr4); padding:.75rem; border-radius:var(--r); border:1px solid var(--gr3)">
          <div style="font-size:9px; text-transform:uppercase; color:var(--gr)">Time Slot</div>
          <div style="font-size:12px; font-weight:700; color:var(--tx)">⏱️ ${slot}</div>
        </div>
      </div>
      
      <div style="background:var(--gr4); padding:1rem; border-radius:var(--r); border:1px dashed var(--gr2); margin-bottom:1.25rem">
        <div style="font-size:10px; text-transform:uppercase; color:var(--gr); font-weight:700; letter-spacing:1px; margin-bottom:.25rem">Verification ID</div>
        <div style="font-size:1.5rem; font-weight:900; color:var(--tx); letter-spacing:2px; font-family:monospace">${verificationId}</div>
      </div>
      
      <div style="font-size:11px; color:var(--gr); line-height:1.4; margin-bottom:1.25rem">Show this QR code or Verification ID at the reception counter of the donation camp.</div>
      
      <button class="btn btn-red btn-full" onclick="document.getElementById('camp-success-modal').remove()">Done</button>
    </div>
  `;
  document.body.appendChild(modalBg);
}

/* ---- REGISTER CAMP ---- */
function registerCamp(campIdOrName) {
  const camp = campsData.find(c => c.id === campIdOrName) || campsData.find(c => c.title === campIdOrName);
  if (!camp) return;
  if (camp.registered >= camp.limit) {
    toast('warning', '⚠️ Camp Full', `Sorry, "${camp.title}" has reached its registration limit.`);
    return;
  }
  
  showSlotSelectionModal(camp);
}

function renderCampsList() {
  const container = document.getElementById('camps-list-container');
  if (!container) return;
  container.innerHTML = '';
  
  const approvedCamps = campsData.filter(c => c.approved);
  if (approvedCamps.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:2rem;color:var(--gr);grid-column:1/-1">No active donation camps scheduled. Check back later!</div>`;
    return;
  }
  
  approvedCamps.forEach(c => {
    const card = document.createElement('div');
    card.className = 'card camp-card';
    card.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%';
    
    const isFull = c.registered >= c.limit;
    const progressPct = Math.min(100, Math.round((c.registered / c.limit) * 100));
    
    card.innerHTML = `
      <div>
        <div style="font-weight:700; font-size:1.1rem; margin-bottom:0.5rem; color:var(--red)">${c.title}</div>
        <div style="font-size:0.9rem; color:var(--gr); margin-bottom:0.4rem; display:flex; align-items:center; gap:6px">
          📅 <span>${c.date}</span>
        </div>
        <div style="font-size:0.9rem; color:var(--gr); margin-bottom:1rem; display:flex; align-items:center; gap:6px">
          📍 <span>${c.location}</span>
        </div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:600; margin-bottom:0.4rem">
          <span>Registration Progress</span>
          <span>${c.registered} / ${c.limit}</span>
        </div>
        <div style="background:var(--gr4); height:8px; border-radius:4px; overflow:hidden; margin-bottom:1rem">
          <div style="width:${progressPct}%; height:100%; background:linear-gradient(90deg, var(--red), #f87171); border-radius:4px"></div>
        </div>
        <button class="btn btn-red btn-full" onclick="registerCamp('${c.id}')" ${isFull ? 'disabled' : ''}>
          ${isFull ? '🔒 Full' : 'Register Now'}
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function filterCampsList() {
  const selects = document.querySelectorAll('#camps select.form-input');
  if (selects.length < 2) return;
  const city = selects[0].value;
  const timeframe = selects[1].value;
  
  toast('info', '🔍 Searching Camps', `Filtering camps for ${city} - ${timeframe}`);
  
  const container = document.getElementById('camps-list-container');
  if (!container) return;
  
  const approvedCamps = campsData.filter(c => {
    if (!c.approved) return false;
    if (city !== 'All Cities') {
      return c.location.toLowerCase().includes(city.toLowerCase());
    }
    return true;
  });
  
  container.innerHTML = '';
  if (approvedCamps.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:2rem;color:var(--gr);grid-column:1/-1">No active donation camps scheduled for the selected criteria.</div>`;
    return;
  }
  
  approvedCamps.forEach(c => {
    const card = document.createElement('div');
    card.className = 'card camp-card';
    card.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%';
    
    const isFull = c.registered >= c.limit;
    const progressPct = Math.min(100, Math.round((c.registered / c.limit) * 100));
    
    card.innerHTML = `
      <div>
        <div style="font-weight:700; font-size:1.1rem; margin-bottom:0.5rem; color:var(--red)">${c.title}</div>
        <div style="font-size:0.9rem; color:var(--gr); margin-bottom:0.4rem; display:flex; align-items:center; gap:6px">
          📅 <span>${c.date}</span>
        </div>
        <div style="font-size:0.9rem; color:var(--gr); margin-bottom:1rem; display:flex; align-items:center; gap:6px">
          📍 <span>${c.location}</span>
        </div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:600; margin-bottom:0.4rem">
          <span>Registration Progress</span>
          <span>${c.registered} / ${c.limit}</span>
        </div>
        <div style="background:var(--gr4); height:8px; border-radius:4px; overflow:hidden; margin-bottom:1rem">
          <div style="width:${progressPct}%; height:100%; background:linear-gradient(90deg, var(--red), #f87171); border-radius:4px"></div>
        </div>
        <button class="btn btn-red btn-full" onclick="registerCamp('${c.id}')" ${isFull ? 'disabled' : ''}>
          ${isFull ? '🔒 Full' : 'Register Now'}
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderLeaderboard() {
  const podiumContainer = document.getElementById('leaderboard-podium');
  const tbodyContainer = document.getElementById('leaderboard-tbody');
  if (!podiumContainer || !tbodyContainer) return;
  
  const donors = usersData.filter(u => u.role === 'Donor');
  donors.forEach(d => {
    if (d.donations === undefined) d.donations = 0;
    if (d.xp === undefined) d.xp = d.donations * 200;
  });
  
  // Sort by XP desc
  donors.sort((a, b) => b.xp - a.xp);
  
  // Render podium (top 3)
  podiumContainer.innerHTML = '';
  const first = donors[0];
  const second = donors[1];
  const third = donors[2];
  
  const getInitials = (n) => n ? n.split(' ').map(x => x[0]).join('').toUpperCase() : '';
  
  if (second) {
    const isCurrentUser = second.id === currentUserId;
    const secondEl = document.createElement('div');
    secondEl.className = 'card';
    secondEl.style.cssText = `display:flex; flex-direction:column; align-items:center; padding:1.25rem 0.75rem; border-top: 4px solid #94a3b8; height:150px; text-align:center; justify-content:center; position:relative; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); ${isCurrentUser ? 'border: 1px solid var(--red); border-top: 4px solid #94a3b8; background: var(--pk)' : ''}`;
    secondEl.innerHTML = `
      <div style="position:absolute; top:-15px; background:#94a3b8; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px; border:2px solid #fff">2</div>
      <div class="lb-av" style="background:linear-gradient(135deg, #cbd5e1, #94a3b8); margin-bottom:8px">${getInitials(second.name)}</div>
      <div style="font-weight:700; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%">${second.name} ${isCurrentUser ? '<span class="badge b-ok" style="font-size:8px; padding:1px 4px">You</span>' : ''}</div>
      <div style="font-size:11px; color:var(--red); font-weight:800; margin-top:2px">${second.donations} Donations</div>
      <div style="font-size:10px; color:var(--gr); font-weight:600">${second.xp} XP</div>
    `;
    podiumContainer.appendChild(secondEl);
  } else {
    podiumContainer.appendChild(document.createElement('div'));
  }
  
  if (first) {
    const isCurrentUser = first.id === currentUserId;
    const firstEl = document.createElement('div');
    firstEl.className = 'card';
    firstEl.style.cssText = `display:flex; flex-direction:column; align-items:center; padding:1.25rem 0.75rem; border-top: 5px solid #fbbf24; height:180px; text-align:center; justify-content:center; position:relative; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); transform: translateY(-10px); ${isCurrentUser ? 'border: 1px solid var(--red); border-top: 5px solid #fbbf24; background: var(--pk)' : ''}`;
    firstEl.innerHTML = `
      <div style="position:absolute; top:-22px; font-size:24px">👑</div>
      <div style="position:absolute; top:-15px; background:#fbbf24; color:#fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; border:2px solid #fff">1</div>
      <div class="lb-av" style="background:linear-gradient(135deg, #fef08a, #fbbf24); margin-bottom:8px; width:44px; height:44px; font-size:14px; border: 2px solid #fde047">${getInitials(first.name)}</div>
      <div style="font-weight:800; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%">${first.name} ${isCurrentUser ? '<span class="badge b-ok" style="font-size:8px; padding:1px 4px">You</span>' : ''}</div>
      <div style="font-size:12px; color:var(--red); font-weight:900; margin-top:2px">${first.donations} Donations</div>
      <div style="font-size:11px; color:var(--gr); font-weight:700">${first.xp} XP</div>
    `;
    podiumContainer.appendChild(firstEl);
  } else {
    podiumContainer.appendChild(document.createElement('div'));
  }
  
  if (third) {
    const isCurrentUser = third.id === currentUserId;
    const thirdEl = document.createElement('div');
    thirdEl.className = 'card';
    thirdEl.style.cssText = `display:flex; flex-direction:column; align-items:center; padding:1.25rem 0.75rem; border-top: 4px solid #b45309; height:140px; text-align:center; justify-content:center; position:relative; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); ${isCurrentUser ? 'border: 1px solid var(--red); border-top: 4px solid #b45309; background: var(--pk)' : ''}`;
    thirdEl.innerHTML = `
      <div style="position:absolute; top:-15px; background:#b45309; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:12px; border:2px solid #fff">3</div>
      <div class="lb-av" style="background:linear-gradient(135deg, #d97706, #b45309); margin-bottom:8px">${getInitials(third.name)}</div>
      <div style="font-weight:700; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%">${third.name} ${isCurrentUser ? '<span class="badge b-ok" style="font-size:8px; padding:1px 4px">You</span>' : ''}</div>
      <div style="font-size:11px; color:var(--red); font-weight:800; margin-top:2px">${third.donations} Donations</div>
      <div style="font-size:10px; color:var(--gr); font-weight:600">${third.xp} XP</div>
    `;
    podiumContainer.appendChild(thirdEl);
  } else {
    podiumContainer.appendChild(document.createElement('div'));
  }
  
  // Render list of remaining donors
  tbodyContainer.innerHTML = '';
  donors.forEach((donor, idx) => {
    const rank = idx + 1;
    const progressPct = Math.min(100, Math.round((donor.xp / 4000) * 100));
    const initials = getInitials(donor.name);
    const isCurrentUser = donor.id === currentUserId;
    
    const row = document.createElement('div');
    row.className = 'lb-row';
    if (isCurrentUser) {
      row.style.cssText = 'background:var(--pk); border-radius:8px; padding:10px; margin: 4px -10px; border: 1px dashed var(--red)';
    }
    
    row.innerHTML = `
      <div class="lb-rank ${rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : ''}">
        ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
      </div>
      <div class="lb-av" style="background: linear-gradient(135deg, var(--rl), var(--rd))">${initials}</div>
      <div class="lb-info">
        <div class="lb-name" style="display:flex; align-items:center; gap:8px">
          <span>${donor.name}</span>
          ${isCurrentUser ? '<span class="badge b-ok" style="font-size:9px; padding:2px 6px">You</span>' : ''}
        </div>
        <div class="lb-sub">Level ${Math.floor(donor.xp / 300) || 1} · ${donor.donations} donations · ${donor.location}</div>
        <div class="xp-bar">
          <div class="xp-fill" style="width: ${progressPct}%"></div>
        </div>
      </div>
      <div style="text-align:right; min-width:60px">
        <strong style="color:var(--red); font-size:14px">${donor.xp}</strong>
        <div style="font-size:9px; color:var(--gr); font-weight:700">XP</div>
      </div>
    `;
    tbodyContainer.appendChild(row);
  });
}

function isBloodCompatible(donorType, requestedType) {
  if (!requestedType) return true; 
  if (donorType === requestedType) return true;
  
  const rules = {
    'O-': ['O-'],
    'O+': ['O+', 'O-'],
    'A-': ['A-', 'O-'],
    'A+': ['A+', 'A-', 'O+', 'O-'],
    'B-': ['B-', 'O-'],
    'B+': ['B+', 'B-', 'O+', 'O-'],
    'AB-': ['AB-', 'A-', 'B-', 'O-'],
    'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
  };
  
  return rules[requestedType] ? rules[requestedType].includes(donorType) : false;
}

function renderBloodPassport() {
  const page = document.getElementById('passport');
  if (!page || !isLoggedIn || !currentUserId) return;
  
  const user = usersData.find(u => u.id === currentUserId);
  if (!user || user.role !== 'Donor') return;
  
  const av = page.querySelector('.pp-av');
  const name = page.querySelector('.pp-name');
  const idText = page.querySelector('.pp-id');
  const badgesContainer = page.querySelector('.pp-hdr div > div'); 
  
  if (av) av.textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
  if (name) name.textContent = user.name;
  if (idText) idText.textContent = `Donor ID: ${user.passportId}`;
  
  if (badgesContainer) {
    const level = Math.floor(user.xp / 300) || 1;
    badgesContainer.innerHTML = `
      <span style="background:rgba(231,76,60,.3);color:#fca5a5;font-size:10px;padding:3px 10px;border-radius:12px;font-weight:700">✅ Verified Donor</span>
      <span style="background:rgba(16,185,129,.2);color:#6ee7b7;font-size:10px;padding:3px 10px;border-radius:12px;font-weight:700">Elite Level ${level}</span>
    `;
  }
  
  const fields = page.querySelectorAll('.pp-val');
  if (fields.length >= 6) {
    fields[0].textContent = user.bloodType;
    fields[1].textContent = user.donations;
    fields[2].textContent = user.donations * 3;
    fields[3].textContent = 'Feb 24, 2026';
    fields[4].textContent = 'Today ✓';
    fields[5].textContent = user.xp.toLocaleString();
  }
  
  const tbody = page.querySelector('.tbl tbody');
  if (tbody) {
    tbody.innerHTML = '';
    const count = user.donations;
    const historyData = [
      { date: 'Feb 24, 2026', hosp: 'Apollo Hospital' },
      { date: 'Nov 25, 2025', hosp: 'City General Hospital' },
      { date: 'Aug 26, 2025', hosp: 'KMCH Medical Center' },
      { date: 'May 10, 2025', hosp: 'Red Cross Center' },
      { date: 'Jan 15, 2025', hosp: 'GKNM Hospital' }
    ];
    
    for (let i = 0; i < Math.min(count, historyData.length); i++) {
      const rec = historyData[i];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700">${count - i}</td>
        <td>${rec.date}</td>
        <td>${rec.hosp}</td>
        <td style="font-weight:800;color:var(--red)">${user.bloodType}</td>
        <td><span class="badge b-ok">Completed</span></td>
      `;
      tbody.appendChild(tr);
    }
    
    if (count === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gr);padding:1rem">No donation history recorded yet. Start saving lives today!</td></tr>`;
    }
  }
}

function runFindBloodSearch() {
  const type = document.getElementById('search-blood')?.value || '';
  const city = document.getElementById('search-city')?.value || 'Coimbatore';
  const radius = parseFloat(document.getElementById('search-radius')?.value) || 999;
  const source = document.getElementById('search-source')?.value || 'All Sources';
  
  const section = document.getElementById('search-results-section');
  const container = document.getElementById('search-results-container');
  if (!section || !container) return;
  
  container.innerHTML = '';
  section.style.display = 'block';
  
  let resultsCount = 0;
  
  // 1. Search Blood Banks
  if (source === 'All Sources' || source === 'Blood Banks Only') {
    bloodBanksData.forEach(bb => {
      const matchCity = bb.address.toLowerCase().includes(city.toLowerCase()) || city === 'Coimbatore';
      if (!matchCity) return;
      
      let availableUnits = 0;
      if (type) {
        availableUnits = bb.stockBreakdown[type] || 0;
      } else {
        availableUnits = bb.stock;
      }
      
      if (availableUnits <= 0) return;
      
      const distMap = { bb1: 2.1, bb2: 3.8, bb3: 5.2 };
      const dist = distMap[bb.id] || 4.5;
      if (dist > radius) return;
      
      resultsCount++;
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap;border-left:4px solid var(--green)';
      card.innerHTML = `
        <div style="width:48px;height:48px;background:var(--pk);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏥</div>
        <div style="flex:1">
          <div style="font-weight:700;display:flex;align-items:center;gap:8px">
            <span>${bb.name}</span>
            <span class="badge b-ok" style="font-size:9px">Blood Bank</span>
          </div>
          <div style="font-size:13px;color:var(--gr)">📍 ${bb.address} · <strong>${dist} km</strong> away</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            <span class="badge b-crit" style="background:#fee2e2;color:#b91c1c;font-weight:800">${type ? `${availableUnits} units of ${type}` : `${availableUnits} units total`} available</span>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="showDirections(11.0020, 76.9730, '${bb.name}')">Map Directions</button>
          <button class="btn btn-red btn-sm" onclick="toast('info','📞 Calling...','Connecting to ${bb.name}')">Call Now</button>
        </div>
      `;
      container.appendChild(card);
    });
  }
  
  // 2. Search Donors
  if (source === 'All Sources' || source === 'Donors Only') {
    const donors = usersData.filter(u => u.role === 'Donor' && u.status !== 'Pending Onboarding' && !u.isNewRegistration);
    donors.forEach(donor => {
      if (!isBloodCompatible(donor.bloodType, type)) return;
      
      const matchCity = donor.location.toLowerCase().includes(city.toLowerCase()) || city === 'Coimbatore';
      if (!matchCity) return;
      
      const distMap = { u1: 1.8, u2: 2.4, u5: 3.1, u6: 1.2, u7: 2.7, u8: 3.5, u9: 4.3 };
      const dist = distMap[donor.id] || (Math.random() * 4 + 1).toFixed(1);
      if (dist > radius) return;
      
      resultsCount++;
      const initials = donor.name.split(' ').map(n => n[0]).join('').toUpperCase();
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap;border-left:4px solid var(--rl)';
      card.innerHTML = `
        <div style="width:48px;height:48px;background:linear-gradient(135deg,var(--rl),var(--rd));color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;flex-shrink:0">${initials}</div>
        <div style="flex:1">
          <div style="font-weight:700;display:flex;align-items:center;gap:8px">
            <span>${donor.name}</span>
            <span class="badge b-crit" style="font-size:10px">${donor.bloodType} Donor</span>
            <span class="badge b-blue" style="font-size:9px">${donor.status}</span>
          </div>
          <div style="font-size:13px;color:var(--gr)">📍 Coimbatore · <strong>${dist} km</strong> away · Verified ID: ${donor.passportId}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="contactDonor('${donor.name}')">📲 Contact Donor</button>
        </div>
      `;
      container.appendChild(card);
    });
  }
  
  if (resultsCount === 0) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:2rem;color:var(--gr)">No matching compatible donors or blood banks found near Coimbatore. Consider expanding your search radius.</div>`;
    toast('warning', '🔍 No Matches', `No matches found for compatible ${type || 'Any Type'} blood.`);
  } else {
    toast('success', '🔍 Search Complete', `Found ${resultsCount} matching sources near Coimbatore.`);
  }
  
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearFindBloodSearch() {
  const section = document.getElementById('search-results-section');
  const container = document.getElementById('search-results-container');
  if (section) section.style.display = 'none';
  if (container) container.innerHTML = '';
  
  const selectBlood = document.getElementById('search-blood');
  if (selectBlood) selectBlood.value = '';
}

function selectAndSearchBlood(type) {
  const select = document.getElementById('search-blood');
  if (select) select.value = type;
  showPage('find-blood');
  runFindBloodSearch();
}


/* ---- SIGN UP FORM ---- */
function submitSignup() {
  const email = document.getElementById('signup-email')?.value;
  const phone = document.getElementById('signup-phone')?.value;
  const name  = document.getElementById('signup-fname')?.value;
  if (!name || !email || !phone) {
    toast('warning', '⚠️ Missing Info', 'Please fill in all required fields.');
    return;
  }
  toast('success', '📱 OTP Sent!', `A 6-digit OTP was sent to ${phone}. Enter it to verify your account.`);
  setTimeout(() => showOTPModal(), 1500);
}
function showOTPModal() {
  const m = document.getElementById('otp-modal');
  if (m) m.classList.add('open');
}
function verifyOTP() {
  const otp = document.getElementById('otp-input')?.value;
  if (otp && otp.length === 6 && /^\d+$/.test(otp)) {
    closeModal('otp-modal');
    
    // Get form registration values
    const selectedRoleCard = document.querySelector('.role-card.sel');
    let role = selectedRoleCard ? selectedRoleCard.querySelector('.role-name').textContent.trim() : 'Donor';
    if (role === 'Patient / Family') role = 'Donor';
    
    const firstName = document.getElementById('signup-fname')?.value || 'New';
    let fullName = firstName.trim();
    if (role === 'Donor') {
      const lastName = document.getElementById('signup-lname')?.value || '';
      fullName = `${firstName} ${lastName}`.trim();
    }
    
    const bloodSelect = document.getElementById('signup-blood');
    const blood = bloodSelect ? bloodSelect.value : 'O+';
    
    const cityInput = document.getElementById('signup-city');
    const city = cityInput ? cityInput.value : 'Coimbatore';
    
    const passwordInput = document.getElementById('signup-password');
    const passwordVal = passwordInput ? passwordInput.value : 'password123';
    
    const licenseInput = document.getElementById('signup-license');
    const licenseVal = licenseInput ? licenseInput.value : '';
    
    const fileInput = document.getElementById('signup-file-input');
    const docVal = (fileInput && fileInput.files && fileInput.files[0]) ? fileInput.files[0].name : '';
    
    const newUser = {
      name: fullName,
      role: role,
      bloodType: role === 'Donor' ? (blood || 'O+') : 'Multiple',
      location: city || 'Coimbatore',
      status: 'Pending Verification',
      isNewRegistration: true,
      password: passwordVal,
      licenseNumber: licenseVal,
      accreditationDoc: docVal
    };
    
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    })
    .then(res => res.json())
    .then(savedUser => {
      isLoggedIn = true;
      currentUserId = savedUser.id;
      saveSession();
      syncAllData().then(() => {
        toast('success', '🎉 Welcome to LifeLink!', 'Your account has been created successfully. Redirecting to your dashboard...');
        const targetPage = role === 'Donor' ? 'donor-dash' : role === 'Hospital' ? 'hospital' : 'bloodbank';
        setTimeout(() => {
          showPage(targetPage);
        }, 2000);
      });
    })
    .catch(err => {
      console.error("Error creating user:", err);
      toast('warning', '⚠️ Error', 'Could not complete registration.');
    });
  } else {
    toast('warning', '❌ Invalid OTP', 'Please enter the 6-digit OTP sent to your phone.');
  }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

/* ---- AI MATCH ---- */
function runAIMatch() {
  const bloodType = document.getElementById('ai-blood')?.value;
  const urgency   = document.getElementById('ai-urgency')?.value;
  if (!bloodType || !urgency) {
    toast('warning', '⚠️ Fill Details', 'Please select blood type and urgency level.');
    return;
  }
  
  toast('info', '🧠 AI Matching...', `Finding best ${bloodType} donors. Processing donor profiles...`);
  
  const resultsContainer = document.getElementById('match-results');
  if (!resultsContainer) return;
  
  resultsContainer.style.opacity = '0.4';
  
  setTimeout(() => {
    resultsContainer.style.opacity = '1';
    resultsContainer.innerHTML = '';
    
    // Blood compatibility map (recipient -> compatible donors)
    const compatibilityRules = {
      'A+': ['A+', 'A-', 'O+', 'O-'],
      'A-': ['A-', 'O-'],
      'B+': ['B+', 'B-', 'O+', 'O-'],
      'B-': ['B-', 'O-'],
      'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      'AB-': ['AB-', 'A-', 'B-', 'O-'],
      'O+': ['O+', 'O-'],
      'O-': ['O-']
    };
    
    const compatibleGroups = compatibilityRules[bloodType] || [];
    
    // Filter active/verified donors in usersData
    const donors = usersData.filter(u => 
      u.role === 'Donor' && 
      u.bloodType === bloodType &&
      u.status !== 'Pending Onboarding' &&
      !u.isNewRegistration
    );
    
    if (donors.length === 0) {
      resultsContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: var(--dark2); border-radius: var(--r); border: 1.5px dashed var(--gr4);">
          <div style="font-size: 2.5rem; margin-bottom: 1rem;">🔍</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: #fff; margin-bottom: 0.5rem;">No Compatible Donors Found</div>
          <div style="font-size: 13px; color: var(--gr); max-width: 320px; margin: 0 auto;">There are no registered donors matching the compatibility requirements for ${bloodType} in Coimbatore at the moment.</div>
        </div>
      `;
      toast('warning', '⚠️ No Matches Found', `No active compatible donors found for ${bloodType}.`);
      return;
    }
    
    // Map to cards with computed scores and sort by compatibility & reliability
    const mapped = donors.map((d, index) => {
      // Compatibility Score
      const compatibility = d.bloodType === bloodType ? 100 : 95;
      // Reliability score based on donations
      const reliability = Math.min(98, 70 + (d.donations || 0) * 2);
      // Mock emergency response score
      const emergencyResponse = 75 + Math.floor(((d.xp || 0) % 23) + 2);
      // Mock distance from donor profile info or location
      const distance = (1.1 + (index * 0.9) + ((d.donations || 0) % 3) * 0.4).toFixed(1);
      // Last active text
      const lastActive = index === 0 ? '2h ago' : index === 1 ? '30m ago' : '1d ago';
      
      return {
        donor: d,
        compatibility,
        reliability,
        emergencyResponse,
        distance,
        lastActive
      };
    });
    
    // Sort: Compatibility first, then reliability, then emergency response desc
    mapped.sort((a, b) => b.compatibility - a.compatibility || b.reliability - a.reliability || b.emergencyResponse - a.emergencyResponse);
    
    mapped.forEach((item, index) => {
      const d = item.donor;
      const initials = d.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const rankLabel = index === 0 ? '#1 Best Match' : `#${index + 1} Match`;
      
      const card = document.createElement('div');
      card.className = 'match-card';
      
      // Select avatar color gradient based on rank/index
      let avBg = 'linear-gradient(135deg, var(--red), #b91c1c)';
      if (index === 1) avBg = 'linear-gradient(135deg, var(--bl), #1d4ed8)';
      if (index >= 2) avBg = 'linear-gradient(135deg, var(--green), #047857)';
      
      card.innerHTML = `
        <span class="match-rank">${rankLabel}</span>
        <div class="match-av" style="background: ${avBg}">${initials}</div>
        <div class="match-name">${d.name}</div>
        <div class="match-blood">${d.bloodType}</div>
        <div class="score-row"><span>Compatibility</span><span style="font-weight:700">${item.compatibility}%</span></div>
        <div class="score-bar"><div class="score-fill" style="width:${item.compatibility}%;background:var(--green)"></div></div>
        <div class="score-row"><span>Reliability Score</span><span style="font-weight:700">${item.reliability}%</span></div>
        <div class="score-bar"><div class="score-fill" style="width:${item.reliability}%;background:var(--bl)"></div></div>
        <div class="score-row"><span>Emergency Response</span><span style="font-weight:700">${item.emergencyResponse}%</span></div>
        <div class="score-bar"><div class="score-fill" style="width:${item.emergencyResponse}%;background:var(--or)"></div></div>
        <div style="font-size:12px;color:var(--gr);margin-top:8px">📍 ${item.distance} km · Last active ${item.lastActive}</div>
        <button class="btn btn-red btn-full" style="margin-top:12px" onclick="contactDonor('${d.name}')">📱 Contact Donor</button>
      `;
      resultsContainer.appendChild(card);
    });
    
    toast('success', '✅ Matching Complete', `AI matched ${mapped.length} top donors for ${bloodType} (${urgency} urgency).`);
  }, 1800);
}
function contactDonor(name) {
  toast('success', '📱 Request Sent!', `${name} has been notified. Expected response within 8 minutes.`);
}

/* ---- HOSPITAL & EMERGENCY ACTIONS ---- */
function createEmergencyRequest() {
  const m = document.getElementById('emerg-modal');
  if (m) m.classList.add('open');
}

function submitEmergencyRequest() {
  const name = document.getElementById('emerg-name')?.value || ('Patient ' + (emergenciesData.length + 1));
  const bt = document.getElementById('emerg-blood')?.value;
  const units = document.getElementById('emerg-units')?.value;
  const urg = document.getElementById('emerg-urg')?.value;
  const hospital = document.getElementById('emerg-loc')?.value || 'City General Hospital';
  
  if (!bt || !units || !urg) {
    toast('warning', '⚠️ Fill all fields', 'Please complete the emergency request form.');
    return;
  }
  
  closeModal('emerg-modal');
  
  const newId = 'e' + (emergenciesData.length + 1);
  const newReq = {
    id: newId,
    patientName: name,
    bloodType: bt,
    hospital: hospital,
    lat: 11.0168 + (Math.random() - 0.5) * 0.03,
    lng: 76.9558 + (Math.random() - 0.5) * 0.03,
    units: parseInt(units),
    urgency: urg,
    ward: 'Emergency Ward',
    time: 'Just now',
    status: 'Pending',
    alerts: Math.floor(Math.random() * 15) + 5
  };
  
  fetch('/api/emergencies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newReq)
  })
  .then(() => {
    toast('emergency', '🚨 Request Broadcast!', `${units} units of ${bt} needed (${urg}). Notifying all nearby donors now!`);
    
    // Clear inputs
    const nameInput = document.getElementById('emerg-name');
    const bloodSelect = document.getElementById('emerg-blood');
    const unitsInput = document.getElementById('emerg-units');
    const urgSelect = document.getElementById('emerg-urg');
    const locInput = document.getElementById('emerg-loc');
    
    if (nameInput) nameInput.value = '';
    if (bloodSelect) bloodSelect.value = '';
    if (unitsInput) unitsInput.value = '';
    if (urgSelect) urgSelect.value = '';
    if (locInput) locInput.value = '';
    
    syncAllData();
  })
  .catch(err => {
    console.error("Error creating emergency request:", err);
    toast('warning', '⚠️ Error', 'Could not create emergency request.');
  });
}

function refreshAllEmergencyViews() {
  renderAdminEmergencies();
  renderEmergencyCards();
  renderHomeEmergencyTeasers();
  renderMapEmergencyList();
  updateMapEmergencyMarkers();
}

function renderAdminEmergencies() {
  const tbody = document.getElementById('admin-emergencies-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  emergenciesData.forEach(e => {
    const tr = document.createElement('tr');
    tr.id = `admin-row-${e.id}`;
    
    let urgencyBadge = '';
    if (e.urgency === 'Critical') urgencyBadge = `<span class="badge b-crit">Critical</span>`;
    else if (e.urgency === 'Urgent') urgencyBadge = `<span class="badge b-urg">Urgent</span>`;
    else urgencyBadge = `<span class="badge b-ok">Normal</span>`;
    
    let statusBadge = '';
    if (e.status === 'Pending') statusBadge = `<span class="badge b-crit pulse-badge">Pending</span>`;
    else if (e.status === 'Escalated') statusBadge = `<span class="badge b-crit" style="background:#dc2626;animation:pulsate 1.5s infinite">🚨 Escalated</span>`;
    else if (e.status === 'In Progress') statusBadge = `<span class="badge b-blue">In Progress</span>`;
    else statusBadge = `<span class="badge b-ok">Fulfilled</span>`;
    
    let actionButtons = '';
    if (e.status === 'Pending') {
      actionButtons = `
        <div style="display:flex;gap:6px">
          <button class="btn btn-red btn-sm" onclick="escalateAdminRequest('${e.id}')">🚨 Escalate</button>
          <button class="btn btn-gray btn-sm" onclick="openAdminLogs('${e.id}')">Logs</button>
        </div>`;
    } else if (e.status === 'Escalated') {
      actionButtons = `
        <div style="display:flex;gap:6px">
          <button class="btn btn-gray btn-sm" disabled style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;cursor:not-allowed">Escalated ✓</button>
          <button class="btn btn-gray btn-sm" onclick="openAdminLogs('${e.id}')">Logs</button>
        </div>`;
    } else if (e.status === 'In Progress') {
      actionButtons = `
        <div style="display:flex;gap:6px">
          <button class="btn btn-gray btn-sm" onclick="openAdminLogs('${e.id}')">Logs</button>
          <button class="btn btn-red btn-sm" style="background:var(--green);border-color:var(--green);box-shadow:none" onclick="fulfillAdminRequest('${e.id}')">Fulfill</button>
        </div>`;
    } else if (e.status === 'Fulfilled') {
      actionButtons = `<button class="btn btn-gray btn-sm" style="background:#e2e8f0;color:#475569" onclick="archiveAdminRequest('${e.id}')">Archive</button>`;
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:600">${e.patientName}</div></td>
      <td style="font-weight:800;color:var(--red)">${e.bloodType}</td>
      <td>${e.hospital.replace(' Hospital', '').replace(' Hospitals', '').replace(' Medical Center', '')}</td>
      <td>${urgencyBadge}</td>
      <td>${e.units}</td>
      <td>${e.alerts} Donors</td>
      <td>${statusBadge}</td>
      <td>${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderEmergencyCards(filterUrgency = 'All') {
  const container = document.getElementById('page-emergencies-container');
  if (!container) return;
  container.innerHTML = '';
  
  const filtered = emergenciesData.filter(e => {
    if (filterUrgency === 'All') return true;
    return e.urgency === filterUrgency;
  });
  
  // Update tabs counts dynamically
  const filterDiv = container.previousElementSibling;
  if (filterDiv) {
    const buttons = filterDiv.querySelectorAll('.mf-btn');
    if (buttons.length === 4) {
      const allCount = emergenciesData.length;
      const critCount = emergenciesData.filter(e => e.urgency === 'Critical').length;
      const urgCount = emergenciesData.filter(e => e.urgency === 'Urgent').length;
      const normCount = emergenciesData.filter(e => e.urgency === 'Normal').length;
      
      buttons[0].innerHTML = `All (${allCount})`;
      buttons[1].innerHTML = `🔴 Critical (${critCount})`;
      buttons[2].innerHTML = `🟡 Urgent (${urgCount})`;
      buttons[3].innerHTML = `🟢 Normal (${normCount})`;
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:2rem;color:var(--gr)">No active emergency requests found for this filter.</div>`;
    return;
  }

  filtered.forEach(e => {
    let cardClass = e.urgency.toLowerCase();
    let badgeClass = e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok';
    let dotIcon = e.urgency === 'Critical' ? '🔴' : e.urgency === 'Urgent' ? '🟡' : '🟢';
    
    const distMap = { e1: '2.1 km', e2: '4.3 km', e3: '3.8 km', e4: '5.2 km' };
    const dist = distMap[e.id] || '3.2 km';
    
    const div = document.createElement('div');
    div.className = `emerg-card ${cardClass}`;
    div.style.padding = '1.5rem';
    
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="font-size:2.2rem;font-weight:900;color:var(--red)">${e.bloodType}</div>
          <div><span class="badge ${badgeClass}" style="font-size:11px;padding:4px 12px">${dotIcon} ${e.urgency}</span></div>
        </div>
        <div style="font-size:12px;color:var(--gr)">⏱ ${e.time} · ${e.alerts} donors notified</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1rem">
        <div><div style="font-size:10px;color:var(--gr);text-transform:uppercase;font-weight:600">Hospital</div><div style="font-weight:700">${e.hospital}</div></div>
        <div><div style="font-size:10px;color:var(--gr);text-transform:uppercase;font-weight:600">Location</div><div style="font-weight:700">📍 Coimbatore · ${dist}</div></div>
        <div><div style="font-size:10px;color:var(--gr);text-transform:uppercase;font-weight:600">Units Needed</div><div style="font-weight:700;color:var(--red)">${e.units} units</div></div>
        <div><div style="font-size:10px;color:var(--gr);text-transform:uppercase;font-weight:600">Ward</div><div style="font-weight:700">${e.ward}</div></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-red" onclick="respondEmergency('${e.bloodType}','${e.hospital}')">✅ I Can Donate</button>
        <button class="btn btn-outline" onclick="toast('info','📞 Calling...','Connecting to ${e.hospital}')">📞 Call Hospital</button>
        <button class="btn btn-gray" onclick="showDirections(${e.lat}, ${e.lng}, '${e.hospital}')">🗺️ Directions</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderHomeEmergencyTeasers() {
  const container = document.getElementById('home-emergencies-container');
  if (!container) return;
  container.innerHTML = '';
  
  const sorted = [...emergenciesData]
    .sort((a, b) => {
      const order = { 'Critical': 1, 'Urgent': 2, 'Normal': 3 };
      return order[a.urgency] - order[b.urgency];
    })
    .slice(0, 3);
    
  const teaserTitleEl = container.previousElementSibling?.querySelector('div[style*="font-size:1rem"]');
  if (teaserTitleEl) {
    teaserTitleEl.textContent = `${sorted.length} Critical Emergencies Active Near You`;
  }

  sorted.forEach(e => {
    let cardClass = e.urgency.toLowerCase();
    let badgeClass = e.urgency === 'Critical' ? 'b-crit' : e.urgency === 'Urgent' ? 'b-urg' : 'b-ok';
    let dotIcon = e.urgency === 'Critical' ? '🔴' : e.urgency === 'Urgent' ? '🟡' : '🟢';
    
    const distMap = { e1: '2.1 km', e2: '4.3 km', e3: '3.8 km', e4: '5.2 km' };
    const dist = distMap[e.id] || '3.2 km';
    
    const div = document.createElement('div');
    div.className = `emerg-card ${cardClass}`;
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="font-size:1.6rem;font-weight:900;color:var(--red)">${e.bloodType}</div>
        <span class="badge ${badgeClass}">${dotIcon} ${e.urgency}</span>
      </div>
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">${e.hospital}</div>
      <div style="font-size:12px;color:var(--gr);margin-bottom:10px">📍 Coimbatore, ${dist} away</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:12px;color:var(--gr)">Need <strong>${e.units} units</strong> urgently</div>
        <button class="btn btn-red btn-sm" onclick="respondEmergency('${e.bloodType}','${e.hospital}')">Respond</button>
      </div>
      <div style="font-size:11px;color:var(--gr2);margin-top:8px">⏱ Posted ${e.time}</div>
    `;
    container.appendChild(div);
  });
}

function filterEmergencies(btn, urgency) {
  document.querySelectorAll('#emergency .mf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderEmergencyCards(urgency);
}

function escalateAdminRequest(id) {
  const req = emergenciesData.find(e => e.id === id);
  if (!req) return;
  
  fetch(`/api/emergencies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Escalated', alerts: req.alerts + 15 })
  })
  .then(() => {
    toast('emergency', '🚨 Request Escalated', `Urgent alert broadcasted for ${req.bloodType} at ${req.hospital}.`);
    syncAllData();
  })
  .catch(err => console.error("Error escalating request:", err));
}

function openAdminLogs(id) {
  const req = emergenciesData.find(e => e.id === id);
  if (!req) return;
  
  const modal = document.getElementById('admin-logs-modal');
  const subtitle = document.getElementById('admin-logs-subtitle');
  const tbody = document.getElementById('admin-logs-tbody');
  
  if (!modal || !tbody) return;
  
  subtitle.innerHTML = `Real-time matched donor alerts for patient <strong>${req.patientName} (${req.bloodType})</strong>`;
  tbody.innerHTML = '';
  
  const matchedDonors = [
    { name: 'Arjun Kumar', type: 'O+', dist: '1.8 km', status: 'Accepted ✅', color: 'var(--green)', showDispatch: true },
    { name: 'Rahul Menon', type: 'B+', dist: '3.1 km', status: 'Pending Response ⏳', color: 'var(--or)', showDispatch: false },
    { name: 'Vijay Natarajan', type: 'O-', dist: '3.8 km', status: 'Declined (Unavailable) ❌', color: 'var(--gr)', showDispatch: false },
    { name: 'Priya Sundaram', type: 'A+', dist: '2.4 km', status: 'Notified 📲', color: 'var(--bl)', showDispatch: true }
  ];
  
  matchedDonors.forEach(d => {
    const tr = document.createElement('tr');
    
    let actionHtml = '';
    if (d.showDispatch && (req.status === 'Pending' || req.status === 'Escalated')) {
      actionHtml = `<button class="btn btn-red btn-sm" style="padding:2px 8px;font-size:11px" onclick="dispatchAdminDonor('${req.id}', '${d.name}')">Dispatch</button>`;
    } else if (req.status === 'In Progress' || req.status === 'Fulfilled') {
      actionHtml = `<span style="font-size:11px;color:var(--gr)">N/A</span>`;
    } else {
      actionHtml = `<span style="font-size:11px;color:var(--gr2)">Awaiting</span>`;
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:600">${d.name}</div></td>
      <td style="font-weight:800;color:var(--red)">${d.type}</td>
      <td>📍 ${d.dist}</td>
      <td><span style="font-weight:700;color:${d.color}">${d.status}</span></td>
      <td>${actionHtml}</td>
    `;
    tbody.appendChild(tr);
  });
  
  modal.classList.add('open');
}

function dispatchAdminDonor(reqId, donorName) {
  const req = emergenciesData.find(e => e.id === reqId);
  if (!req) return;
  
  fetch(`/api/emergencies/${reqId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'In Progress' })
  })
  .then(() => {
    closeModal('admin-logs-modal');
    toast('success', '✅ Dispatch Confirmed!', `${donorName} has been dispatched to ${req.hospital}. Hospital notified.`);
    syncAllData();
  })
  .catch(err => console.error("Error dispatching donor:", err));
}

function fulfillAdminRequest(id) {
  const req = emergenciesData.find(e => e.id === id);
  if (!req) return;
  
  fetch(`/api/emergencies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Fulfilled' })
  })
  .then(() => {
    toast('success', '🎉 Request Fulfilled!', `Patient request for ${req.patientName} (${req.bloodType}) is successfully completed.`);
    syncAllData();
  })
  .catch(err => console.error("Error fulfilling request:", err));
}

function archiveAdminRequest(id) {
  const req = emergenciesData.find(e => e.id === id);
  if (!req) return;
  
  const row = document.getElementById(`admin-row-${id}`);
  if (row) {
    row.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    row.style.opacity = '0';
    row.style.transform = 'translateX(20px)';
  }
  
  setTimeout(() => {
    fetch(`/api/emergencies/${id}`, {
      method: 'DELETE'
    })
    .then(() => {
      toast('success', '📋 Archiving Completed', `Archived request for ${req.patientName}.`);
      syncAllData();
    })
    .catch(err => console.error("Error archiving request:", err));
  }, 400);
}

function updateMapEmergencyMarkers() {
  if (typeof L === 'undefined') return;
  if (!map || !emergencyLayerGroup) return;
  emergencyLayerGroup.clearLayers();
  
  emergenciesData.forEach(e => {
    const divIcon = L.divIcon({
      className: `map-dot dot-emerg ${e.urgency.toLowerCase()}`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    
    const m = L.marker([e.lat, e.lng], { icon: divIcon })
      .addTo(emergencyLayerGroup)
      .bindPopup(`<strong>🚨 PATIENT: ${e.patientName} (${e.bloodType})</strong><br>Location: ${e.hospital}<br>Ward: ${e.ward}<br>Urgency: <strong>${e.urgency}</strong><br>Status: <strong>${e.status}</strong>`);
    
    m.on('click', () => {
      toast('emergency', `🚨 Critical Request: ${e.bloodType}`, `Patient ${e.patientName} needs ${e.units} units urgently at ${e.hospital}.`);
      showDirections(e.lat, e.lng, `${e.hospital} (${e.patientName})`);
    });
  });
}

/* ---- BLOOD BANK ACTIONS ---- */
function broadcastExpiry() {
  toast('info', '📢 Alert Broadcast', 'Expiry alerts sent to 23 nearby hospitals and blood banks.');
}
function addDonation() {
  toast('success', '📥 Donation Recorded', 'New donation batch added to inventory successfully.');
}
function requestTransfer() {
  const modal = document.getElementById('transfer-request-modal');
  if (!modal) return;

  const select = document.getElementById('tr-supplier-select');
  if (select) {
    select.innerHTML = '';
    // Load other blood banks from usersData (role === 'Blood Bank' and id !== currentUserId)
    const otherBanks = usersData.filter(u => u.role === 'Blood Bank' && u.id !== currentUserId);
    otherBanks.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      select.appendChild(opt);
    });

    if (otherBanks.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No other blood banks available';
      select.appendChild(opt);
    }
  }

  modal.classList.add('open');
}

function submitTransferRequest() {
  const supplyingId = document.getElementById('tr-supplier-select')?.value;
  const bloodType = document.getElementById('tr-blood-select')?.value;
  const units = parseInt(document.getElementById('tr-units-input')?.value);

  if (!supplyingId) {
    toast('warning', '⚠️ Missing Supplier', 'Please select a target supplier facility.');
    return;
  }
  if (isNaN(units) || units <= 0) {
    toast('warning', '⚠️ Invalid Quantity', 'Please specify a positive number of units.');
    return;
  }

  fetch('/api/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestingId: currentUserId,
      supplyingId,
      bloodType,
      units
    })
  })
  .then(res => res.json())
  .then(() => {
    closeModal('transfer-request-modal');
    toast('success', '🔄 Request Placed', `Transfer request for ${units} units of ${bloodType} submitted.`);
    syncAllData();
  })
  .catch(err => {
    console.error("Error creating transfer request:", err);
    toast('warning', '⚠️ Error', 'Could not create transfer request.');
  });
}

function processTransfer(transferId, action) {
  fetch(`/api/transfers/${transferId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: action })
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(data => { throw new Error(data.error || "Transaction error"); });
    }
    return res.json();
  })
  .then(() => {
    toast(action === 'Approved' ? 'success' : 'info', `🔄 Request ${action}`, `Transfer request has been marked ${action}.`);
    syncAllData();
  })
  .catch(err => {
    console.error("Error processing transfer:", err);
    toast('warning', '⚠️ Transaction Failed', err.message || 'Could not complete stock transfer.');
  });
}

function renderTransfersList() {
  const tbody = document.getElementById('bb-transfers-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const relevant = transfersData.filter(t => t.requestingId === currentUserId || t.supplyingId === currentUserId);

  if (relevant.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gr);padding:1.5rem">No active or recent transfers found.</td></tr>`;
    return;
  }

  relevant.forEach(t => {
    const requester = usersData.find(u => u.id === t.requestingId);
    const supplier = usersData.find(u => u.id === t.supplyingId);
    const reqName = requester ? requester.name : 'Unknown';
    const supName = supplier ? supplier.name : 'Unknown';

    const isRequesting = t.requestingId === currentUserId;
    const directionHtml = isRequesting 
      ? `<span class="badge b-ok" style="font-size:10px">IN (Requesting)</span>`
      : `<span class="badge b-crit" style="font-size:10px">OUT (Supplying)</span>`;

    const facilityName = isRequesting ? supName : reqName;

    let statusBadge = '';
    if (t.status === 'Pending') {
      statusBadge = `<span class="badge b-urg">Pending Approval</span>`;
    } else if (t.status === 'Approved') {
      statusBadge = `<span class="badge b-ok">Approved / Completed</span>`;
    } else {
      statusBadge = `<span class="badge b-crit">Declined</span>`;
    }

    let actionsHtml = '';
    if (t.status === 'Pending') {
      if (!isRequesting) {
        actionsHtml = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-red btn-sm" style="padding:2px 8px;font-size:11px" onclick="processTransfer('${t.id}', 'Approved')">Approve</button>
            <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px" onclick="processTransfer('${t.id}', 'Declined')">Decline</button>
          </div>
        `;
      } else {
        actionsHtml = `<span style="font-size:11px;color:var(--gr)">Awaiting Supplier</span>`;
      }
    } else {
      actionsHtml = `<span style="font-size:11px;color:var(--gr2)">Completed</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:800;color:var(--red)">${t.bloodType}</td>
      <td style="font-weight:700">${t.units} units</td>
      <td>${facilityName}</td>
      <td>${directionHtml}</td>
      <td>${t.time}</td>
      <td>${statusBadge}</td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportReport() {
  toast('info', '📋 Generating Report', 'Inventory report is being prepared. Download will start shortly.');
}

/* ---- DONOR ACTIONS ---- */
function toggleAvailability(btn) {
  const isOn = btn.dataset.on === 'true';
  const nextStatus = isOn ? 'Inactive' : 'Active';
  
  fetch(`/api/users/${currentUserId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: nextStatus })
  })
  .then(() => {
    btn.dataset.on = !isOn;
    btn.textContent = isOn ? '🔴 Unavailable' : '🟢 Available';
    btn.style.background = isOn ? '#fee2e2' : '#d1fae5';
    btn.style.color = isOn ? '#b91c1c' : '#065f46';
    btn.style.borderColor = isOn ? '#fca5a5' : '#6ee7b7';
    toast(isOn ? 'warning' : 'success', isOn ? '🔴 Marked Unavailable' : '🟢 Now Available', isOn ? 'You won\'t receive donation requests.' : 'You can now receive emergency requests!');
    syncAllData();
  })
  .catch(err => console.error("Error toggling availability:", err));
}

/* ---- SHARE PASSPORT ---- */
function sharePassport() {
  toast('success', '📲 Link Copied!', 'Your donor passport verification link has been copied to clipboard.');
}

/* ---- MARK NOTIFS READ ---- */
function markAllRead() {
  document.querySelectorAll('.ni-dot').forEach(d => d.style.opacity='0');
  toast('success', '✅ All Read', 'All notifications have been marked as read.');
}

/* ---- QR BOX RENDER ---- */
function renderQR() {
  const box = document.getElementById('qr-box');
  if (!box) return;
  const pat = [1,1,1,1,1,1,0,1,1,0,1,1,1,0,1,1,1,0,0,0,1,1,1,1,1];
  pat.forEach(v => {
    const px = document.createElement('div');
    px.className = 'qr-px';
    px.style.cssText = `background:${v?'#1a1a2e':'#fff'};border-radius:1px`;
    box.appendChild(px);
  });
}

/* ---- SOS BUTTON ---- */
function triggerSOS() {
  toast('emergency', '🚨 SOS ACTIVATED!', 'Emergency broadcast sent to 47 nearby donors. Response expected within 8 minutes.');
}

/* ---- ADMIN SIDEBAR NAV ---- */
function adminNav(el, subpageId) {
  const pageParent = el.closest('.page');
  if (!pageParent) return;

  pageParent.querySelectorAll('.si').forEach(s => s.classList.remove('active'));
  el.classList.add('active');

  if (subpageId) {
    pageParent.querySelectorAll('.admin-subpage').forEach(sp => {
      sp.style.display = 'none';
      sp.classList.remove('active');
    });
    const activeSub = pageParent.querySelector(`#admin-${subpageId}`);
    if (activeSub) {
      activeSub.style.display = 'block';
      activeSub.classList.add('active');
    }
  }
}

function donorNav(el, subpageId) {
  const pageParent = el.closest('.page');
  if (!pageParent) return;

  pageParent.querySelectorAll('.si').forEach(s => s.classList.remove('active'));
  el.classList.add('active');

  if (subpageId) {
    pageParent.querySelectorAll('.donor-subpage').forEach(sp => {
      sp.style.display = 'none';
      sp.classList.remove('active');
    });
    const activeSub = pageParent.querySelector(`#donor-${subpageId}`);
    if (activeSub) {
      activeSub.style.display = 'block';
      activeSub.classList.add('active');
    }
  }
}

function hospitalNav(el, subpageId) {
  const pageParent = el.closest('.page');
  if (!pageParent) return;

  pageParent.querySelectorAll('.si').forEach(s => s.classList.remove('active'));
  el.classList.add('active');

  if (subpageId) {
    pageParent.querySelectorAll('.hospital-subpage').forEach(sp => {
      sp.style.display = 'none';
      sp.classList.remove('active');
    });
    const activeSub = pageParent.querySelector(`#hospital-${subpageId}`);
    if (activeSub) {
      activeSub.style.display = 'block';
      activeSub.classList.add('active');
    }
  }
}

function bloodbankNav(el, subpageId) {
  const pageParent = el.closest('.page');
  if (!pageParent) return;

  pageParent.querySelectorAll('.si').forEach(s => s.classList.remove('active'));
  el.classList.add('active');

  if (subpageId) {
    pageParent.querySelectorAll('.bloodbank-subpage').forEach(sp => {
      sp.style.display = 'none';
      sp.classList.remove('active');
    });
    const activeSub = pageParent.querySelector(`#bloodbank-${subpageId}`);
    if (activeSub) {
      activeSub.style.display = 'block';
      activeSub.classList.add('active');
    }
  }
}

/* ---- ADMIN EXTRA ACTIONS ---- */
function sendAdminAlert() {
  const type = document.getElementById('admin-alert-type')?.value || 'info';
  const aud = document.getElementById('admin-alert-audience')?.value || 'All Donors';
  const msg = document.getElementById('admin-alert-msg')?.value || '';
  if (!msg.trim()) {
    toast('warning', '⚠️ Empty Message', 'Please enter a message for the alert.');
    return;
  }
  toast(type === 'SOS Broadcast' ? 'emergency' : type === 'Stock Warning' ? 'warning' : 'success', '🚀 Alert Broadcasted!', `Sent alert to ${aud}.`);
  
  const tbody = document.getElementById('admin-alert-history');
  if (tbody) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="badge ${type.includes('SOS')?'b-crit':type.includes('Stock')?'b-urg':'b-ok'}">${type}</span></td><td>${aud}</td><td>${msg}</td><td>Just now</td><td><span class="badge b-ok">Sent</span></td>`;
    tbody.insertBefore(tr, tbody.firstChild);
  }
  const msgInput = document.getElementById('admin-alert-msg');
  if (msgInput) msgInput.value = '';
}

function saveAdminSettings() {
  toast('success', '⚙️ Settings Saved', 'Admin dashboard configuration has been updated successfully.');
}

// Old escalateAdminRequest placeholder removed to use dynamic ID-based escalation.

// usersData is initialized dynamically from the SQLite database

function renderAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  usersData.forEach(u => {
    const tr = document.createElement('tr');
    tr.id = `admin-user-row-${u.id}`;
    
    let roleBadge = '';
    if (u.role === 'Donor') roleBadge = `<span class="badge b-urg">Donor</span>`;
    else if (u.role === 'Hospital') roleBadge = `<span class="badge b-crit">Hospital</span>`;
    else if (u.role === 'Blood Bank') roleBadge = `<span class="badge b-blue">Blood Bank</span>`;
    else roleBadge = `<span class="badge" style="background:#8b5cf6;color:#fff;font-weight:700">Admin</span>`;
    
    let statusBadge = '';
    if (u.isNewRegistration) {
      statusBadge = `<span class="badge" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:700">Pending Onboarding</span>`;
    } else if (u.pendingUpdate) {
      statusBadge = `<span class="badge" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:700">Pending Verification</span>`;
    } else {
      if (u.status === 'Active') statusBadge = `<span class="badge b-ok">Active</span>`;
      else if (u.status === 'Verified') statusBadge = `<span class="badge b-ok">Verified</span>`;
      else if (u.status === 'On Duty') statusBadge = `<span class="badge b-blue">On Duty</span>`;
      else statusBadge = `<span class="badge b-crit">Pending</span>`;
    }
    
    let actionBtn = '';
    if (u.role === 'Donor') {
      if (u.isNewRegistration) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="viewPassportCard('${u.id}')">View IP</button>
            <button class="btn btn-sm" onclick="openAdminOnboardingVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Account</button>
          </div>`;
      } else if (u.pendingUpdate) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="viewPassportCard('${u.id}')">View IP</button>
            <button class="btn btn-sm" onclick="openAdminVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Edit</button>
          </div>`;
      } else {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="viewPassportCard('${u.id}')">View IP</button>
          </div>`;
      }
    } else if (u.role === 'Blood Bank') {
      if (u.isNewRegistration) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="auditAdminBloodBank('${u.id}')">Audit</button>
            <button class="btn btn-sm" onclick="openAdminOnboardingVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Account</button>
          </div>`;
      } else if (u.pendingUpdate) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="auditAdminBloodBank('${u.id}')">Audit</button>
            <button class="btn btn-sm" onclick="openAdminVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Edit</button>
          </div>`;
      } else {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="auditAdminBloodBank('${u.id}')">Audit</button>
          </div>`;
      }
    } else if (u.role === 'Hospital') {
      if (u.isNewRegistration) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="manageAdminHospital('${u.id}')">Manage</button>
            <button class="btn btn-sm" onclick="openAdminOnboardingVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Account</button>
          </div>`;
      } else if (u.pendingUpdate) {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="manageAdminHospital('${u.id}')">Manage</button>
            <button class="btn btn-sm" onclick="openAdminVerification('${u.id}')" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-weight:600">Verify Edit</button>
          </div>`;
      } else {
        actionBtn = `
          <div style="display:flex;gap:6px">
            <button class="btn btn-gray btn-sm" onclick="manageAdminHospital('${u.id}')">Manage</button>
          </div>`;
      }
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:600">${u.name}</div></td>
      <td>${roleBadge}</td>
      <td style="font-weight:800;color:var(--red)">${u.bloodType}</td>
      <td>${u.location}</td>
      <td>${statusBadge}</td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

function viewPassportCard(id) {
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  
  const modal = document.getElementById('passport-modal');
  if (!modal) return;
  
  const avatar = document.getElementById('pp-avatar');
  const name = document.getElementById('pp-name');
  const ppId = document.getElementById('pp-id');
  const blood = document.getElementById('pp-blood');
  const donations = document.getElementById('pp-donations');
  const status = document.getElementById('pp-status');
  
  if (avatar) avatar.textContent = u.name.split(' ').map(n => n[0]).join('').toUpperCase();
  if (name) name.textContent = u.name;
  if (ppId) ppId.textContent = u.passportId;
  if (blood) blood.textContent = u.bloodType;
  if (donations) donations.textContent = u.donations;
  
  if (status) {
    status.textContent = `${u.status} ${u.role}`;
    status.className = 'pp-val';
    status.style.color = u.status === 'Active' || u.status === 'Verified' ? '#4ade80' : u.status === 'On Duty' ? '#60a5fa' : '#fca5a5';
  }
  
  const qrBox = document.getElementById('pp-qr');
  if (qrBox) {
    qrBox.innerHTML = '';
    const pat = [1,0,1,1,1,1,0,0,1,0,1,1,0,1,0,0,1,1,1,0,1,0,1,0,1];
    pat.forEach(v => {
      const px = document.createElement('div');
      px.className = 'qr-px';
      px.style.cssText = `background:${v ? '#1a1a2e' : '#fff'};border-radius:1px`;
      qrBox.appendChild(px);
    });
  }
  
  modal.classList.add('open');
}

function addAdminUser() {
  const modal = document.getElementById('admin-user-modal');
  if (!modal) return;
  
  document.getElementById('admin-user-modal-title').textContent = '👥 Add New User';
  document.getElementById('admin-user-modal-subtitle').textContent = 'Register a new system account with permissions';
  document.getElementById('admin-user-id').value = '';
  document.getElementById('admin-user-name-input').value = '';
  document.getElementById('admin-user-role-input').value = 'Donor';
  document.getElementById('admin-user-blood-input').value = 'O+';
  document.getElementById('admin-user-location-input').value = '';
  document.getElementById('admin-user-status-input').value = 'Active';
  
  modal.classList.add('open');
}

/* ---- SELF-PROFILE CUSTOM VERIFICATION WORKFLOW ---- */

function renderDonorPortalProfile() {
  const u = usersData.find(usr => usr.id === currentUserId && usr.role === 'Donor') || usersData.find(usr => usr.id === 'u1');
  if (!u) return;
  
  const nameEl = document.querySelector('#donor-dash div[style*="font-size:1.2rem"]');
  if (nameEl) {
    nameEl.innerHTML = `${u.name} ${u.pendingUpdate ? '<span class="badge b-urg" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-size:10px;margin-left:8px;vertical-align:middle">Pending Verification</span>' : ''}`;
  }
  
  const inputName = document.getElementById('donor-profile-name');
  const inputLoc = document.getElementById('donor-profile-loc');
  const selectBlood = document.getElementById('donor-profile-blood');
  if (inputName) inputName.value = u.name;
  if (inputLoc) inputLoc.value = u.location;
  if (selectBlood) selectBlood.value = u.bloodType;
  
  const locationEl = document.querySelector('#donor-dash div[style*="Elite Donor"]');
  if (locationEl) {
    locationEl.textContent = `🏅 Elite Donor · Level 12 · ${u.location}`;
  }
  
  const bloodTypeEl = document.querySelector('#donor-dash div[style*="font-size:2.5rem"]');
  if (bloodTypeEl) {
    bloodTypeEl.textContent = u.bloodType;
  }
  
  const statusEl = document.querySelector('#donor-dash div[style*="Eligible to donate"]');
  if (statusEl) {
    if (u.status === 'Pending Verification') {
      statusEl.innerHTML = `⏳ Profile updates pending verification`;
      statusEl.style.color = 'var(--or)';
    } else {
      statusEl.innerHTML = `✅ Eligible to donate now`;
      statusEl.style.color = 'var(--green)';
    }
  }
  
  // Onboarding security lock
  const mainEl = document.querySelector('#donor-dash .dash-main');
  if (mainEl) {
    const oldBanner = document.getElementById('donor-lock-banner');
    if (oldBanner) oldBanner.remove();
    
    const bookBtn = document.querySelector('#donor-dash button[onclick*="camps"]');
    
    if (u.isNewRegistration) {
      const banner = document.createElement('div');
      banner.id = 'donor-lock-banner';
      banner.style.cssText = `background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:var(--r);padding:1.25rem;border:1.5px solid #fcd34d;margin-bottom:1.25rem`;
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:.4rem">
          <span style="font-size:20px">⏳</span>
          <div style="font-size:14px;font-weight:700;color:#d97706">Account Onboarding Verification Pending</div>
        </div>
        <div style="font-size:1.4rem;font-weight:800;color:#d97706">Awaiting Admin Approval</div>
        <div style="font-size:12px;color:#b45309;line-height:1.5">Welcome to LifeLink! To protect patient safety, all newly registered donor profiles are audited by the platform administrator before allowing blood donation booking or emergency participation.</div>
      `;
      mainEl.prepend(banner);
      
      if (bookBtn) {
        bookBtn.disabled = true;
        bookBtn.style.opacity = '0.5';
        bookBtn.style.cursor = 'not-allowed';
        bookBtn.textContent = '🔒 Bookings Locked (Pending Verification)';
      }
    } else {
      if (bookBtn) {
        bookBtn.disabled = false;
        bookBtn.style.opacity = '1';
        bookBtn.style.cursor = 'pointer';
        bookBtn.textContent = '📅 Book Appointment Now';
      }
    }
  }
}

function renderHospitalPortalProfile() {
  const u = usersData.find(usr => usr.id === currentUserId && usr.role === 'Hospital') || usersData.find(usr => usr.id === 'u4');
  if (!u) return;
  
  const titleEl = document.querySelector('#hospital .dash-title');
  if (titleEl) {
    titleEl.innerHTML = `${u.name} — Command Center ${u.pendingUpdate ? '<span class="badge b-urg" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-size:10px;margin-left:8px;vertical-align:middle">Pending Verification</span>' : ''}`;
  }
  
  // Onboarding security lock
  const mainEl = document.querySelector('#hospital .dash-main');
  if (mainEl) {
    const oldBanner = document.getElementById('hospital-lock-banner');
    if (oldBanner) oldBanner.remove();
    
    const emergBtn = document.querySelector('#hospital button[onclick*="EmergencyRequest"]');
    
    if (u.isNewRegistration) {
      const banner = document.createElement('div');
      banner.id = 'hospital-lock-banner';
      banner.style.cssText = `background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:var(--r);padding:1.25rem;border:1.5px solid #fcd34d;margin-bottom:1.25rem`;
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:.4rem">
          <span style="font-size:20px">⏳</span>
          <div style="font-size:14px;font-weight:700;color:#d97706">Hospital Verification Pending</div>
        </div>
        <div style="font-size:1.4rem;font-weight:800;color:#d97706">Awaiting Account Activation</div>
        <div style="font-size:12px;color:#b45309;line-height:1.5">Your hospital account was successfully created! To comply with medical safety regulations, new partner healthcare facilities must be verified by platform supervisors before broadcasting emergency requests or editing inventories.</div>
      `;
      mainEl.prepend(banner);
      
      if (emergBtn) {
        emergBtn.disabled = true;
        emergBtn.style.opacity = '0.5';
        emergBtn.style.cursor = 'not-allowed';
        emergBtn.textContent = '🔒 Emergency Request Locked';
      }
    } else {
      if (emergBtn) {
        emergBtn.disabled = false;
        emergBtn.style.opacity = '1';
        emergBtn.style.cursor = 'pointer';
        emergBtn.textContent = '🚨 + Emergency Request';
      }
    }
  }
}

function renderBloodBankPortalProfile() {
  const u = usersData.find(usr => usr.id === currentUserId && usr.role === 'Blood Bank') || usersData.find(usr => usr.id === 'u3');
  if (!u) return;
  
  const titleEl = document.querySelector('#bloodbank .dash-title');
  if (titleEl) {
    titleEl.innerHTML = `${u.name} — Coimbatore ${u.pendingUpdate ? '<span class="badge b-urg" style="background:#fef3c7;color:#d97706;border:1.5px solid #fcd34d;font-size:10px;margin-left:8px;vertical-align:middle">Pending Verification</span>' : ''}`;
  }

  // Find matching blood bank entity from bloodBanksData
  const bb = bloodBanksData.find(b => b.name === u.name) || bloodBanksData.find(b => b.id === 'bb1');
  if (bb) {
    // Find metric card with label "Total Units" and update it
    document.querySelectorAll('#bloodbank .mc').forEach(card => {
      const lbl = card.querySelector('.mc-lbl');
      const val = card.querySelector('.mc-val');
      if (lbl && lbl.textContent.trim() === 'Total Units' && val) {
        val.textContent = `${bb.stock} Units`;
      }
    });

    const renderList = (containerId) => {
      const listEl = document.getElementById(containerId);
      if (!listEl) return;
      listEl.innerHTML = '';
      
      const groups = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];
      groups.forEach(g => {
        const units = bb.stockBreakdown[g] || 0;
        const pct = Math.min(100, Math.round((units / 150) * 100));
        const color = units < 5 ? 'var(--red)' : units < 20 ? 'var(--or)' : 'var(--green)';
        
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
        div.innerHTML = `
          <div style="font-size:13px;font-weight:700;color:var(--red);min-width:34px">${g}</div>
          <div style="flex:1;background:var(--gr4);height:14px;border-radius:7px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:7px;transition:width .4s"></div>
          </div>
          <span style="font-size:12px;font-weight:700;min-width:36px;text-align:right">${units}u</span>
        `;
        listEl.appendChild(div);
      });
    };
    
    renderList('bb-stock-levels-list');
    renderList('bb-stock-levels-list-inventory');
  }
  
  // Onboarding security lock
  const mainEl = document.querySelector('#bloodbank .dash-main');
  if (mainEl) {
    const oldBanner = document.getElementById('bloodbank-lock-banner');
    if (oldBanner) oldBanner.remove();
    
    const addBtn = document.querySelector('#bloodbank button[onclick*="inventory"]');
    
    if (u.isNewRegistration) {
      const banner = document.createElement('div');
      banner.id = 'bloodbank-lock-banner';
      banner.style.cssText = `background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:var(--r);padding:1.25rem;border:1.5px solid #fcd34d;margin-bottom:1.25rem`;
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:.4rem">
          <span style="font-size:20px">⏳</span>
          <div style="font-size:14px;font-weight:700;color:#d97706">Blood Bank Onboarding Audit</div>
        </div>
        <div style="font-size:1.4rem;font-weight:800;color:#d97706">Account Awaiting Verification</div>
        <div style="font-size:12px;color:#b45309;line-height:1.5">Your blood bank onboarding application is under review. Our administrators are auditing storage equipment and accreditation credentials. Full system actions are locked until approved.</div>
      `;
      mainEl.prepend(banner);
      
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.style.opacity = '0.5';
        addBtn.style.cursor = 'not-allowed';
        addBtn.textContent = '🔒 Add Donation Locked';
      }
    } else {
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.style.opacity = '1';
        addBtn.style.cursor = 'pointer';
        addBtn.textContent = '+ Adjust Stock';
      }
    }
  }
}

function openProfileRequestModal(userId) {
  const u = usersData.find(usr => usr.id === userId);
  if (!u) return;
  
  const modal = document.getElementById('profile-edit-modal');
  if (!modal) return;
  
  document.getElementById('pe-user-id').value = u.id;
  document.getElementById('pe-name-input').value = u.name;
  document.getElementById('pe-location-input').value = u.location;
  
  const bloodContainer = document.getElementById('pe-blood-group-container');
  if (u.role === 'Donor') {
    bloodContainer.style.display = 'block';
    document.getElementById('pe-blood-input').value = u.bloodType;
  } else {
    bloodContainer.style.display = 'none';
    document.getElementById('pe-blood-input').value = 'Multiple';
  }
  
  modal.classList.add('open');
}

function submitProfileRequest() {
  const id = document.getElementById('pe-user-id').value;
  const name = document.getElementById('pe-name-input').value;
  const loc = document.getElementById('pe-location-input').value;
  const blood = document.getElementById('pe-blood-input').value;
  
  if (!name.trim() || !loc.trim()) {
    toast('warning', '⚠️ Missing Information', 'Please complete all profile details.');
    return;
  }
  
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  
  const pendingUpdateObj = {
    name: name.trim(),
    location: loc.trim(),
    bloodType: u.role === 'Donor' ? blood : 'Multiple'
  };
  
  fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingUpdate: pendingUpdateObj })
  })
  .then(() => {
    closeModal('profile-edit-modal');
    toast('warning', '⏳ Verification Requested', 'Your updates have been submitted to the Admin for auditing.');
    syncAllData();
  })
  .catch(err => console.error("Error submitting profile request:", err));
}

function openAdminVerification(userId) {
  const u = usersData.find(usr => usr.id === userId);
  if (!u || !u.pendingUpdate) return;
  
  const modal = document.getElementById('admin-verification-modal');
  if (!modal) return;
  
  document.getElementById('av-user-id').value = u.id;
  document.getElementById('av-subtitle').textContent = `Audit profile changes requested by ${u.name}`;
  
  document.getElementById('av-name-before').textContent = u.name;
  document.getElementById('av-location-before').textContent = u.location;
  document.getElementById('av-blood-before').textContent = u.bloodType;
  
  document.getElementById('av-name-after').textContent = u.pendingUpdate.name;
  document.getElementById('av-location-after').textContent = u.pendingUpdate.location;
  document.getElementById('av-blood-after').textContent = u.pendingUpdate.bloodType;
  
  modal.classList.add('open');
}

function approveProfileRequest() {
  const id = document.getElementById('av-user-id').value;
  const u = usersData.find(usr => usr.id === id);
  if (!u || !u.pendingUpdate) return;
  
  const updatedStatus = u.role === 'Donor' ? 'Active' : 'Verified';
  const updatedName = u.pendingUpdate.name;
  
  fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approveUpdate: true, status: updatedStatus })
  })
  .then(() => {
    closeModal('admin-verification-modal');
    toast('success', '✅ Changes Verified & Approved', `Profile updates for "${updatedName}" are now live.`);
    syncAllData();
  })
  .catch(err => console.error("Error approving profile request:", err));
}

function rejectProfileRequest() {
  const id = document.getElementById('av-user-id').value;
  const u = usersData.find(usr => usr.id === id);
  if (!u || !u.pendingUpdate) return;
  
  const updatedStatus = u.role === 'Donor' ? 'Active' : 'Verified';
  
  fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejectUpdate: true, status: updatedStatus })
  })
  .then(() => {
    closeModal('admin-verification-modal');
    toast('info', '❌ Changes Rejected', `Profile changes requested by "${u.name}" were discarded.`);
    syncAllData();
  })
  .catch(err => console.error("Error rejecting profile request:", err));
}

function openAdminOnboardingVerification(userId) {
  const u = usersData.find(usr => usr.id === userId);
  if (!u) return;
  
  const modal = document.getElementById('admin-onboarding-modal');
  if (!modal) return;
  
  document.getElementById('ao-user-id').value = u.id;
  document.getElementById('ao-role').textContent = u.role;
  document.getElementById('ao-name').textContent = u.name;
  document.getElementById('ao-location').textContent = u.location;
  document.getElementById('ao-passport').textContent = u.passportId;
  
  const bloodContainer = document.getElementById('ao-blood-container');
  const licenseContainer = document.getElementById('ao-license-container');
  const docContainer = document.getElementById('ao-doc-container');
  const docLink = document.getElementById('ao-doc-link');
  
  if (u.role === 'Donor') {
    if (bloodContainer) bloodContainer.style.display = 'block';
    document.getElementById('ao-blood').textContent = u.bloodType;
    if (licenseContainer) licenseContainer.style.display = 'none';
    if (docContainer) docContainer.style.display = 'none';
  } else {
    if (bloodContainer) bloodContainer.style.display = 'none';
    
    // Show license details
    if (licenseContainer) {
      licenseContainer.style.display = 'block';
      document.getElementById('ao-license').textContent = u.licenseNumber || `${u.role === 'Hospital' ? 'HOSP' : 'BB'}-2026-CBE-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    
    if (docContainer && docLink) {
      docContainer.style.display = 'block';
      const fileName = u.accreditationDoc || `${u.name.toLowerCase().replace(/\s+/g, '_')}_license_cert.pdf`;
      docLink.textContent = `📄 ${fileName}`;
      // Set link to trigger mock alert
      docLink.href = 'javascript:void(0)';
      docLink.onclick = () => {
        alert(`🛡️ SECURITY AUDIT SYSTEM:\n\nReviewing Verification Certificate: "${fileName}"\nAccreditation: Verified Genuine ✅\nSignature Authority: Medical Council of India`);
      };
    }
  }
  
  modal.classList.add('open');
}

function approveOnboardingRequest() {
  const id = document.getElementById('ao-user-id').value;
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  
  const targetStatus = u.role === 'Donor' ? 'Active' : 'Verified';
  
  fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approveOnboarding: true, status: targetStatus })
  })
  .then(() => {
    if (u.role === 'Hospital') {
      const exists = hospitalsData.some(h => h.name === u.name);
      if (!exists) {
        const newHosp = {
          id: 'h' + (hospitalsData.length + 1),
          name: u.name,
          location: u.location,
          activeEmergencies: 0,
          quotaUsed: 0,
          quotaLimit: 80,
          status: 'Verified Partner'
        };
        return fetch('/api/hospitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newHosp)
        });
      }
    }
  })
  .then(() => {
    closeModal('admin-onboarding-modal');
    toast('success', '🎉 Registration Verified & Approved', `Account for "${u.name}" has been fully activated!`);
    syncAllData();
  })
  .catch(err => console.error("Error approving onboarding request:", err));
}

function denyOnboardingRequest() {
  const id = document.getElementById('ao-user-id').value;
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  
  fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ denyOnboarding: true })
  })
  .then(() => {
    closeModal('admin-onboarding-modal');
    toast('info', '❌ Registration Denied', `Onboarding application for "${u.name}" has been rejected and discarded.`);
    syncAllData();
  })
  .catch(err => console.error("Error denying onboarding request:", err));
}

function editAdminUser(id) {
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  
  const modal = document.getElementById('admin-user-modal');
  if (!modal) return;
  
  document.getElementById('admin-user-modal-title').textContent = '✏️ Edit User Account';
  document.getElementById('admin-user-modal-subtitle').textContent = 'Modify register configurations and account details';
  document.getElementById('admin-user-id').value = u.id;
  document.getElementById('admin-user-name-input').value = u.name;
  document.getElementById('admin-user-role-input').value = u.role;
  document.getElementById('admin-user-blood-input').value = u.bloodType;
  document.getElementById('admin-user-location-input').value = u.location;
  document.getElementById('admin-user-status-input').value = u.status;
  
  modal.classList.add('open');
}

function submitAdminUser() {
  const id = document.getElementById('admin-user-id').value;
  const name = document.getElementById('admin-user-name-input').value;
  const role = document.getElementById('admin-user-role-input').value;
  const blood = document.getElementById('admin-user-blood-input').value;
  const loc = document.getElementById('admin-user-location-input').value;
  const status = document.getElementById('admin-user-status-input').value;
  
  if (!name.trim() || !loc.trim()) {
    toast('warning', '⚠️ Missing Information', 'Please complete the user profile fields.');
    return;
  }
  
  closeModal('admin-user-modal');
  
  if (id) {
    fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, bloodType: blood, location: loc, status })
    })
    .then(() => {
      toast('success', '👤 Account Updated', `Configurations for ${name} saved successfully.`);
      syncAllData();
    })
    .catch(err => console.error("Error updating user:", err));
  } else {
    const newUsr = {
      name: name,
      role: role,
      bloodType: blood,
      location: loc,
      status: status
    };
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUsr)
    })
    .then(() => {
      toast('success', '👥 User Created!', `${name} successfully registered as ${role}.`);
      syncAllData();
    })
    .catch(err => console.error("Error creating user:", err));
  }
}

function auditAdminBloodBank(id) {
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  const bb = bloodBanksData.find(b => b.name === u.name);
  if (bb) {
    auditBloodBankStocks(bb.id);
  } else {
    toast('info', '🩸 Blood Bank Audit', `${u.name}: ${u.donations} Units in stock. API connection active & verified.`);
  }
}

function manageAdminHospital(id) {
  const u = usersData.find(usr => usr.id === id);
  if (!u) return;
  const h = hospitalsData.find(hos => hos.name === u.name);
  if (h) {
    auditHospitalQuota(h.id);
  } else {
    toast('success', '🏥 Hospital Quota', `${u.name}: ${u.location} · Quota active. Hospital verified under perfect compliance.`);
  }
}

/* ---- RECENT DONATION ACTIVITY ---- */
// recentDonationsData is initialized dynamically from the SQLite database

function renderRecentDonations() {
  const tbody = document.getElementById('admin-overview-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  recentDonationsData.forEach(rd => {
    const tr = document.createElement('tr');
    let badgeClass = rd.status === 'Completed' ? 'b-ok' : rd.status === 'In Progress' ? 'b-urg' : 'b-blue';
    tr.innerHTML = `
      <td><div style="font-weight:600">${rd.donor}</div></td>
      <td style="font-weight:800;color:var(--red)">${rd.bloodType}</td>
      <td>${rd.hospital}</td>
      <td>${rd.time}</td>
      <td><span class="badge ${badgeClass}">${rd.status}</span></td>
      <td><button class="btn btn-gray btn-sm" onclick="viewDonationRecord('${rd.id}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function refreshDonationActivity() {
  toast('info', '🔄 Refreshed', 'Activity feed updated with live telemetry.');
  renderRecentDonations();
}

function viewDonationRecord(id) {
  const rd = recentDonationsData.find(r => r.id === id);
  if (!rd) return;
  
  const modal = document.getElementById('donation-record-modal');
  if (!modal) return;
  
  document.getElementById('dr-id').textContent = `RECORD #${rd.id.toUpperCase()}-${Math.floor(1000 + Math.random()*9000)}`;
  document.getElementById('dr-donor').textContent = rd.donor;
  document.getElementById('dr-blood').textContent = rd.bloodType;
  document.getElementById('dr-hospital').textContent = rd.hospital;
  
  const statusBadge = document.getElementById('dr-status');
  statusBadge.textContent = rd.status;
  statusBadge.className = `badge ${rd.status === 'Completed' ? 'b-ok' : rd.status === 'In Progress' ? 'b-urg' : 'b-blue'}`;
  
  document.getElementById('dr-details').textContent = rd.details;
  
  modal.classList.add('open');
}

/* ---- HOSPITALS MANAGEMENT ---- */
// hospitalsData is initialized dynamically from the SQLite database

let selectedHospitalId = null;

function renderAdminHospitals() {
  const tbody = document.getElementById('admin-hospitals-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  hospitalsData.forEach(h => {
    const tr = document.createElement('tr');
    const isPending = h.status === 'Pending Verification';
    const badgeClass = isPending ? 'b-crit' : 'b-ok';
    const quotaDisplay = h.quotaLimit > 0 ? `${h.quotaUsed} / ${h.quotaLimit} Units used` : '0 / 0 Units';
    
    let actions = '';
    if (isPending) {
      actions = `<button class="btn btn-red btn-sm" onclick="approveHospitalPartner('${h.id}')">Verify Portal</button>`;
    } else {
      const quotaWarning = h.quotaUsed >= h.quotaLimit;
      const btnText = quotaWarning ? 'Increase Quota' : 'Audit Quota';
      actions = `
        <div style="display:flex;gap:6px">
          <button class="btn btn-gray btn-sm" onclick="auditHospitalQuota('${h.id}')">${btnText}</button>
        </div>`;
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:700">${h.name}</div></td>
      <td>${h.location}</td>
      <td>${h.activeEmergencies} Request${h.activeEmergencies === 1 ? '' : 's'}</td>
      <td>${quotaDisplay}</td>
      <td><span class="badge ${badgeClass}">${h.status}</span></td>
      <td>${actions}</td>
    `;
    tbody.appendChild(tr);
  });
}

function verifyNewHospitalPartner() {
  const modal = document.getElementById('hospital-partner-modal');
  if (!modal) return;
  
  document.getElementById('hp-name-input').value = '';
  document.getElementById('hp-location-input').value = '';
  document.getElementById('hp-quota-input').value = '30';
  
  modal.classList.add('open');
}

function submitHospitalPartner() {
  const name = document.getElementById('hp-name-input').value;
  const loc = document.getElementById('hp-location-input').value;
  const quota = parseInt(document.getElementById('hp-quota-input').value) || 30;
  
  if (!name.trim() || !loc.trim()) {
    toast('warning', '⚠️ Missing Details', 'Please enter hospital partner credentials.');
    return;
  }
  
  closeModal('hospital-partner-modal');
  
  const newId = 'h' + (hospitalsData.length + 1);
  hospitalsData.push({
    id: newId,
    name: name,
    location: loc,
    activeEmergencies: 0,
    quotaUsed: 0,
    quotaLimit: quota,
    status: 'Verified Partner'
  });
  
  usersData.push({
    id: 'u_h_' + newId,
    name: name,
    role: 'Hospital',
    bloodType: 'Multiple',
    location: loc,
    status: 'Verified',
    passportId: `HP-2026-CBE-${Math.floor(1000 + Math.random()*9000)}`,
    donations: 0
  });
  
  renderAdminHospitals();
  renderAdminUsers();
  toast('success', '🏥 Partner Approved', `${name} successfully onboarded as Verified Partner.`);
}

function approveHospitalPartner(id) {
  const h = hospitalsData.find(hos => hos.id === id);
  if (!h) return;
  
  h.status = 'Verified Partner';
  h.quotaLimit = 30;
  h.quotaUsed = 0;
  
  const u = usersData.find(usr => usr.name === h.name);
  if (u) {
    u.status = 'Verified';
  } else {
    usersData.push({
      id: 'u_h_' + h.id,
      name: h.name,
      role: 'Hospital',
      bloodType: 'Multiple',
      location: h.location,
      status: 'Verified',
      passportId: `HP-2026-CBE-${Math.floor(1000 + Math.random()*9000)}`,
      donations: 0
    });
  }
  
  renderAdminHospitals();
  renderAdminUsers();
  toast('success', '✅ Hospital Approved!', `${h.name} approved for instant blood appeals.`);
}

function auditHospitalQuota(id) {
  const h = hospitalsData.find(hos => hos.id === id);
  if (!h) return;
  
  selectedHospitalId = id;
  const modal = document.getElementById('hospital-quota-modal');
  if (!modal) return;
  
  document.getElementById('hq-name').textContent = `🏥 ${h.name}`;
  document.getElementById('hq-location').textContent = `Location: ${h.location}`;
  document.getElementById('hq-quota-text').textContent = `${h.quotaUsed} / ${h.quotaLimit} Units used`;
  
  const pct = h.quotaLimit > 0 ? Math.round((h.quotaUsed / h.quotaLimit) * 100) : 0;
  document.getElementById('hq-percent').textContent = `${pct}% Used`;
  
  const bar = document.getElementById('hq-bar');
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.className = pct >= 100 ? 'pbar-f p-r' : pct >= 75 ? 'pbar-f p-o' : 'pbar-f p-g';
  }
  
  document.getElementById('hq-emerg').textContent = h.activeEmergencies;
  
  const statusBadge = document.getElementById('hq-status');
  statusBadge.textContent = h.status;
  statusBadge.className = `badge ${h.status === 'Verified Partner' ? 'b-ok' : 'b-crit'}`;
  
  modal.classList.add('open');
}

function promptIncreaseQuota() {
  if (!selectedHospitalId) return;
  const h = hospitalsData.find(hos => hos.id === selectedHospitalId);
  if (!h) return;
  
  const newLimitStr = prompt(`Enter new monthly quota limit for ${h.name} (current: ${h.quotaLimit} units):`, h.quotaLimit + 10);
  if (newLimitStr === null) return;
  
  const newLimit = parseInt(newLimitStr);
  if (isNaN(newLimit) || newLimit <= 0) {
    toast('warning', '⚠️ Invalid Value', 'Please enter a valid quota positive limit number.');
    return;
  }
  
  h.quotaLimit = newLimit;
  closeModal('hospital-quota-modal');
  renderAdminHospitals();
  toast('success', '🛡️ Quota Limit Increased', `${h.name} quota updated to ${newLimit} monthly units successfully.`);
}

/* ---- BLOOD BANK REGISTRY STATE & LOGIC ---- */
// bloodBanksData is initialized dynamically from the SQLite database

function renderAdminBloodBanks() {
  const tbody = document.getElementById('admin-bloodbanks-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  bloodBanksData.forEach(bb => {
    const tr = document.createElement('tr');
    const isSetup = bb.apiStatus === 'Setup Required';
    const badgeClass = isSetup ? 'b-crit' : 'b-ok';
    
    let actions = '';
    if (isSetup) {
      actions = `<button class="btn btn-red btn-sm" onclick="configureBloodBankAPI('${bb.id}')">Configure API</button>`;
    } else {
      actions = `<button class="btn btn-gray btn-sm" onclick="auditBloodBankStocks('${bb.id}')">Audit Stocks</button>`;
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:700">${bb.name}</div></td>
      <td>📍 ${bb.address}</td>
      <td style="font-weight:800;color:var(--red)">${bb.stock} Units</td>
      <td>${bb.activeTransfers} in progress</td>
      <td><span class="badge ${badgeClass}">${bb.apiStatus}</span></td>
      <td>${actions}</td>
    `;
    tbody.appendChild(tr);
  });
}

function syncAdminRegistries() {
  toast('info', '🔄 API Synchronization In Progress', 'Refreshing telemetry interfaces and pulling current stock balances...');
  setTimeout(() => {
    bloodBanksData.forEach(bb => {
      if (bb.apiStatus === 'Connected (Active)') {
        bb.stock += Math.floor(Math.random() * 9) - 4;
        Object.keys(bb.stockBreakdown).forEach(g => {
          bb.stockBreakdown[g] += Math.floor(Math.random() * 3) - 1;
          if (bb.stockBreakdown[g] < 0) bb.stockBreakdown[g] = 0;
        });
      }
    });
    renderAdminBloodBanks();
    toast('success', '🚀 Connection Active & Sync Complete', 'Successfully synchronized Kovai, Red Cross, and City inventories.');
  }, 1000);
}

function configureBloodBankAPI(id) {
  const bb = bloodBanksData.find(b => b.id === id);
  if (!bb) return;
  
  const token = prompt(`Enter secure API Link Endpoint for ${bb.name}:`, `https://api.kovai-bloodconnect.org/v1/telemetry`);
  if (token === null) return;
  
  bb.apiStatus = 'Connected (Active)';
  bb.stock = 125;
  bb.activeTransfers = 0;
  bb.stockBreakdown = { 'O+': 45, 'A+': 32, 'B+': 28, 'AB+': 8, 'O-': 5, 'A-': 4, 'B-': 2, 'AB-': 1 };
  
  const u = usersData.find(usr => usr.name === bb.name);
  if (u) {
    u.status = 'Verified';
    u.donations = 125;
  }
  
  renderAdminBloodBanks();
  renderAdminUsers();
  toast('success', '🚀 Connection Configured', `Kovai Donor API successfully synchronized and linked to main system.`);
}

function auditBloodBankStocks(id) {
  const bb = bloodBanksData.find(b => b.id === id);
  if (!bb) return;
  
  const modal = document.getElementById('bloodbank-audit-modal');
  if (!modal) return;
  
  document.getElementById('bba-name').textContent = `🩸 ${bb.name}`;
  document.getElementById('bba-address').textContent = `📍 ${bb.address}`;
  document.getElementById('bba-transfers').textContent = `${bb.activeTransfers} active transfer${bb.activeTransfers === 1 ? '' : 's'}`;
  
  const grid = document.getElementById('bba-grid');
  grid.innerHTML = '';
  
  const groups = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];
  groups.forEach(g => {
    const qty = bb.stockBreakdown[g] || 0;
    const isCritical = qty < 5;
    const itemCard = document.createElement('div');
    itemCard.className = 'card';
    itemCard.style.cssText = `padding:8px;text-align:center;border-top:3px solid ${isCritical ? 'var(--red)' : 'var(--green)'}`;
    itemCard.innerHTML = `
      <div style="font-weight:800;color:var(--red);font-size:16px">${g}</div>
      <strong style="font-size:1.15rem;display:block;margin:4px 0">${qty}</strong>
      <div style="font-size:9px;color:var(--gr)">${isCritical ? '⚠️ Critical' : '✓ Good'}</div>
    `;
    grid.appendChild(itemCard);
  });
  
  modal.classList.add('open');
}

/* ---- DRIVE & CAMPS STATE & LOGIC ---- */
// campsData is initialized dynamically from the SQLite database

function renderAdminCamps() {
  const tbody = document.getElementById('admin-camps-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  campsData.forEach(c => {
    const tr = document.createElement('tr');
    
    let permBadge = '';
    let statusBadge = '';
    let actionBtn = '';
    
    if (c.approved) {
      permBadge = `<span class="badge b-ok">Approved</span>`;
      statusBadge = `<span class="badge ${c.status === 'In Progress' ? 'b-crit' : 'b-blue'}">${c.status}</span>`;
      actionBtn = `<span style="font-size:12px;color:var(--gr)">Active Campaign</span>`;
    } else {
      permBadge = `<span class="badge b-crit">Under Review</span>`;
      statusBadge = `<span class="badge b-urg">Pending</span>`;
      actionBtn = `<button class="btn btn-red btn-sm" onclick="approveCampDrive('${c.id}')">Approve Camp</button>`;
    }
    
    tr.innerHTML = `
      <td><div style="font-weight:700">${c.title}</div></td>
      <td>${c.date}</td>
      <td>${c.location}</td>
      <td><strong>${c.registered} / ${c.limit}</strong> Donors</td>
      <td>${permBadge}</td>
      <td><div style="display:flex;align-items:center;gap:8px">${statusBadge} ${actionBtn}</div></td>
    `;
    tbody.appendChild(tr);
  });
}

function addAdminCamp() {
  const modal = document.getElementById('camp-modal');
  if (!modal) return;
  
  document.getElementById('camp-title-input').value = '';
  document.getElementById('camp-date-input').value = '2026-06-25';
  document.getElementById('camp-location-input').value = '';
  document.getElementById('camp-limit-input').value = '150';
  
  modal.classList.add('open');
}

function submitCampDrive() {
  const title = document.getElementById('camp-title-input').value;
  const dateStr = document.getElementById('camp-date-input').value;
  const loc = document.getElementById('camp-location-input').value;
  const limit = parseInt(document.getElementById('camp-limit-input').value) || 150;
  
  if (!title.trim() || !loc.trim() || !dateStr) {
    toast('warning', '⚠️ Missing Details', 'Please complete camp configuration fields.');
    return;
  }
  
  const d = new Date(dateStr);
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = d.toLocaleDateString('en-US', options);
  
  closeModal('camp-modal');
  
  const newId = 'c' + (campsData.length + 1);
  campsData.push({
    id: newId,
    title: title,
    date: formattedDate,
    location: loc,
    registered: 0,
    limit: limit,
    approved: false,
    status: 'Under Review'
  });
  
  renderAdminCamps();
  toast('success', '🏕️ Camp Drive Proposed', `"${title}" has been submitted for platform administrative review.`);
}

function approveCampDrive(id) {
  const c = campsData.find(cmp => cmp.id === id);
  if (!c) return;
  
  fetch(`/api/camps/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: true, status: 'Scheduled' })
  })
  .then(() => {
    toast('success', '✅ Camp Approved!', `Volunteer list for ${c.title} is now publicly active.`);
    syncAllData();
  })
  .catch(err => console.error("Error approving camp drive:", err));
}

function saveDonorProfile() {
  const name = document.getElementById('donor-profile-name')?.value;
  const loc = document.getElementById('donor-profile-loc')?.value;
  
  if (!name || !loc) {
    toast('warning', '⚠️ Missing Info', 'Please provide a name and location.');
    return;
  }
  
  fetch(`/api/users/${currentUserId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location: loc })
  })
  .then(() => {
    toast('success', '👤 Profile Saved', 'Your profile details have been saved.');
    syncAllData();
  })
  .catch(err => console.error("Error saving donor profile:", err));
}

function verifyDonorPassport() {
  const pid = document.getElementById('verify-passport-id-input')?.value.trim();
  const resCard = document.getElementById('verify-result-card');
  if (!pid || !resCard) return;
  
  const user = usersData.find(u => {
    if (u.passportId && u.passportId.toLowerCase() === pid.toLowerCase()) return true;
    if (u.activeCampRegistration) {
      const reg = u.activeCampRegistration;
      if (reg && reg.verificationId && reg.verificationId.toLowerCase() === pid.toLowerCase()) return true;
    }
    return false;
  });

  if (user) {
    resCard.style.display = 'block';
    
    // Check if matched via camp registration
    let appointmentHtml = '';
    const reg = user.activeCampRegistration;
    if (reg && reg.verificationId && reg.verificationId.toLowerCase() === pid.toLowerCase()) {
      appointmentHtml = `
        <div style="background:#fff5f5; padding:.75rem; border-radius:var(--r); border:1px solid var(--red); grid-column:span 2; margin-top:8px">
          <div style="font-size:10px; font-weight:800; color:var(--red); text-transform:uppercase; margin-bottom:4px">📅 Active Camp Appointment Found</div>
          <div style="font-size:12px; font-weight:700; color:var(--tx)">${reg.campTitle}</div>
          <div style="font-size:11px; color:var(--gr); margin-top:2px">Slot: <strong>${reg.slot}</strong> on ${reg.date}</div>
        </div>
      `;
    }

    resCard.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--red);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${user.name.split(' ').map(n=>n[0]).join('')}</div>
        <div>
          <strong style="font-size:14px;color:var(--tx)">${user.name}</strong>
          <div style="font-size:11px;color:var(--gr)">ID: ${user.passportId}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-top:10px">
        <div><strong>Blood Type:</strong> <span style="color:var(--red);font-weight:800">${user.bloodType}</span></div>
        <div><strong>Status:</strong> <span class="badge b-ok">${user.status}</span></div>
        <div><strong>Donations:</strong> ${user.donations}</div>
        <div><strong>Location:</strong> ${user.location}</div>
        ${appointmentHtml}
      </div>
      <button class="btn btn-red btn-sm btn-full" style="margin-top:12px" onclick="approveDonationDraw('${user.id}', '${reg && reg.verificationId ? reg.verificationId : ''}')">
        ${appointmentHtml ? 'Confirm Check-In & Draw Blood' : 'Approve Donation Draw'}
      </button>
    `;
    toast('success', '✅ Passport Verified', `Donor "${user.name}" profile loaded successfully.`);
  } else {
    resCard.style.display = 'none';
    toast('warning', '❌ Passport Not Found', `No registered passport or camp ID matched: "${pid}".`);
  }
}

function approveDonationDraw(userId, verificationId) {
  const user = usersData.find(u => u.id === userId);
  if (!user) return;
  
  const payload = { 
    donations: user.donations + 1, 
    xp: (user.xp || 0) + 200 
  };
  
  if (verificationId) {
    payload.activeCampRegistration = null;
  }
  
  fetch(`/api/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(() => {
    const newDonation = {
      id: 'rd' + (recentDonationsData.length + 1),
      donor: user.name,
      bloodType: user.bloodType,
      hospital: 'Apollo Hospital',
      time: 'Just now',
      status: 'Completed',
      details: 'Voluntary whole blood draw completed. Vitals checked and verified.'
    };
    
    return fetch('/api/recent_donations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDonation)
    });
  })
  .then(() => {
    toast('success', '✅ Draw Completed', `Successfully recorded 1 unit draw for ${user.name}. +200 XP awarded!`);
    syncAllData().then(() => {
      const pidInput = document.getElementById('verify-passport-id-input');
      if (pidInput) pidInput.value = verificationId || user.passportId;
      verifyDonorPassport();
    });
  })
  .catch(err => console.error("Error approving donation draw:", err));
}

function updateBloodBankStock() {
  const group = document.getElementById('bb-stock-group-select')?.value;
  const count = parseInt(document.getElementById('bb-stock-count-input')?.value);
  if (!group || isNaN(count)) {
    toast('warning', '⚠️ Missing Data', 'Select blood group and valid count.');
    return;
  }
  
  const bb = bloodBanksData.find(b => b.id === 'bb1');
  if (bb) {
    bb.stockBreakdown[group] = Math.max(0, (bb.stockBreakdown[group] || 0) + count);
    const updatedStock = Object.values(bb.stockBreakdown).reduce((a, b) => a + b, 0);
    
    fetch('/api/blood_banks/bb1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: updatedStock, stockBreakdown: bb.stockBreakdown })
    })
    .then(() => {
      toast('success', '📥 Stock Updated', `Blood group ${group} adjusted by ${count > 0 ? '+' : ''}${count} units.`);
      syncAllData();
    })
    .catch(err => console.error("Error updating stock:", err));
  }
}

/* ---- INIT ---- */
window.addEventListener('DOMContentLoaded', () => {
  // Check if session expired on startup
  if (window.sessionExpiredOnLoad) {
    toast('warning', '🔒 Session Expired', 'You have been logged out due to inactivity.');
    window.sessionExpiredOnLoad = false;
  }

  // Set up inactivity listeners
  ['click', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, handleUserActivity, { passive: true });
  });

  // Check session expiration periodically
  setInterval(checkSessionExpiration, 60000);

  startCounters();
  renderQR();
  
  syncAllData().then(() => {
    // Set first page active
    if (isLoggedIn && currentUserId) {
      const user = usersData.find(u => u.id === currentUserId);
      if (user) {
        const targetPage = user.role === 'Donor' ? 'donor-dash' : user.role === 'Hospital' ? 'hospital' : user.role === 'Blood Bank' ? 'bloodbank' : 'dashboard';
        showPage(targetPage);
      } else {
        showPage('home');
      }
    } else {
      if (!document.querySelector('.page.active')) showPage('home');
    }
  });
});
