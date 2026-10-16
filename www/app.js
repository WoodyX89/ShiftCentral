// Shared ShiftCentral logic
const SUPABASE_URL = 'https://qmjtmlrcomfdpxwbkzyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtanRtbHJjb21mZHB4d2JrenlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3ODM3MDcsImV4cCI6MjEwMzM1OTcwN30.-xZcoBLJxHM0BpyQc_pUcyq9XDNTZWkkIAEGTQlcpJc';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ROLE_LABEL = { owner: 'Admin', admin: 'Admin', supervisor: 'SS/LH', member: 'Operator' };
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Detect mobile app (Capacitor) vs regular browser
const isApp = !!(window.Capacitor || /capacitor/i.test(navigator.userAgent) || location.protocol === 'capacitor:');
const isMobile = isApp || window.matchMedia('(max-width: 700px)').matches;
document.body.classList.add(isApp ? 'is-app' : 'is-web');
if (isMobile) document.body.classList.add('is-mobile');

async function loadNavbar(active) {
  const slot = document.getElementById('navbar');
  if (!slot) return;
  try {
    const res = await fetch('navbar.html');
    slot.innerHTML = await res.text();
  } catch {
    slot.innerHTML = `<div class="user-bar"><span id="nav-user">Signed in</span><button type="button" id="nav-logout" class="secondary">Log out</button></div>`;
  }
  slot.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === active) a.classList.add('active');
  });
  const session = await getSession();
  const userEl = document.getElementById('nav-user');
  if (userEl) userEl.textContent = 'Logged in as: ' + (session?.user?.email || '…');
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    sb.auth.signOut().then(() => location.href = 'index.html');
  });
  document.getElementById('menu-btn')?.addEventListener('click', () => {
    document.getElementById('top-nav')?.classList.toggle('open');
  });
  loadNotifications();
}

async function loadNotifications() {
  const btn = document.getElementById('nav-notes');
  const badge = document.getElementById('note-badge');
  const panel = document.getElementById('note-panel');
  if (!btn || !panel) return;
  const session = await getSession();
  if (!session) return;
  const memberships = await loadMemberships();
  const saved = getSavedOrg();
  const current = memberships.find(m => m.org_id === saved) || memberships[0];
  if (!current || !canSchedule(current.role)) { btn.hidden = true; return; }
  const { data: ops } = await sb.from('operators').select('name, email, role').eq('org_id', current.org_id);
  const meEmail = (session.user.email || '').toLowerCase();
  const me = (ops || []).find(o => (o.email||'').toLowerCase() === meEmail);
  const isLead = me ? ['supervisor', 'admin'].includes(me.role) : canSchedule(current.role);
  const seenKey = 'sc_seen_vac_' + current.org_id;
  const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]'));
  let notes = [];
  if (isLead) {
    const { data } = await sb.from('vacation_requests').select('id, name, start_date, end_date, status').eq('org_id', current.org_id).eq('status', 'requested').order('created_at', { ascending: false });
    notes = (data || []).map(n => ({ ...n, kind: 'request' }));
  } else if (me?.name) {
    const { data } = await sb.from('vacation_requests').select('id, name, start_date, end_date, status').eq('org_id', current.org_id).ilike('name', me.name).in('status', ['approved', 'denied']);
    notes = (data || []).filter(n => !seen.has(n.id)).map(n => ({ ...n, kind: 'result' }));
  }
  if (!notes.length && !isLead) { btn.hidden = true; return; }
  btn.hidden = false;
  badge.hidden = notes.length === 0;
  badge.textContent = notes.length;
  panel.innerHTML = notes.length ? notes.map(n => n.kind === 'request' ? `
    <div class="note-item">
      <strong>${n.name}</strong>
      <span>${n.start_date} → ${n.end_date}</span>
      <button type="button" class="secondary note-ok" data-id="${n.id}">Approve</button>
    </div>` : `
    <div class="note-item">
      <strong>Vacation ${n.status}</strong>
      <span>${n.start_date} → ${n.end_date}</span>
      <button type="button" class="secondary note-seen" data-id="${n.id}">Dismiss</button>
    </div>`).join('') : '<p class="note-empty">No vacation requests.</p>';
  btn.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  };
  panel.querySelectorAll('.note-ok').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const { data: approved, error } = await sb.from('vacation_requests').update({ status: 'approved' }).eq('id', b.dataset.id).select('id');
    if (error || !approved?.length) { banner(false, error ? explainError(error) : 'No permission'); return; }
    banner(true, 'Vacation approved');
    loadNotifications();
  });
  panel.querySelectorAll('.note-seen').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    seen.add(b.dataset.id);
    localStorage.setItem(seenKey, JSON.stringify([...seen]));
    loadNotifications();
  });
  if (!window.__scNoteClose) {
    window.__scNoteClose = true;
    document.addEventListener('click', () => {
      const box = document.getElementById('note-panel');
      if (box) box.hidden = true;
    });
  }
}



function iso(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function canSchedule(role) { return ['owner','admin','supervisor'].includes(role); }

function explainError(error) {
  if (!error) return '';
  const msg = (error.message || String(error));
  const code = error.code || '';
  if (/permission|rls|row-level|not allowed|42501|PGRST301|JWT|policy/i.test(msg + ' ' + code)) return 'No permission';
  return msg;
}
function banner(ok, text) {
  let el = document.getElementById('sc-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sc-banner';
    document.body.prepend(el);
  }
  el.className = ok ? 'ok' : 'bad';
  el.textContent = text;
  el.hidden = false;
  el.style.cssText = 'display:block;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;min-width:240px;max-width:92vw;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:600;text-align:center;box-shadow:0 12px 30px rgba(15,23,42,.18);' + (ok
    ? 'background:#ecfdf3;color:#067647;border:1px solid #abefc6;'
    : 'background:#fef3f2;color:#b42318;border:1px solid #fecdca;');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; el.style.display = 'none'; }, 4500);
}


async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function loadMemberships() {
  const { data: rows, error } = await sb.from('org_members').select('org_id, role').order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows?.length) return [];
  const ids = [...new Set(rows.map(r => r.org_id))];
  const { data: orgs, error: e2 } = await sb.from('organizations').select('id, name, slug, city').in('id', ids);
  if (e2) throw e2;
  return rows.map(r => ({ ...r, organizations: (orgs||[]).find(o => o.id === r.org_id) || { id: r.org_id, name: 'Plant' } }));
}

function getSavedOrg() { return localStorage.getItem('shiftcentral_org_id'); }
function setSavedOrg(id) { localStorage.setItem('shiftcentral_org_id', id); }

async function requireAuth() {
  const session = await getSession();
  if (!session) { location.href = 'index.html'; return null; }
  return session;
}

async function requirePlant() {
  const session = await requireAuth();
  if (!session) return null;
  const memberships = await loadMemberships();
  const saved = getSavedOrg();
  const current = memberships.find(m => m.org_id === saved) || memberships[0];
  if (!current) { location.href = 'index.html'; return null; }
  setSavedOrg(current.org_id);
  return { session, memberships, current };
}

function navHtml() { return ''; }

// Local plant scratch data (overtime / vacation / messages)
function loadPlant(orgId, key, fallback = []) {
  try {
    const raw = localStorage.getItem(`sc:${orgId}:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function savePlant(orgId, key, value) {
  try {
    localStorage.setItem(`sc:${orgId}:${key}`, JSON.stringify(value));
  } catch (e) {
    console.warn('savePlant failed', e);
  }
}


async function loadPatterns(orgId) {
  const { data, error } = await sb.from('rotation_patterns').select('id, name, sequence').eq('org_id', orgId).order('name');
  if (error) throw error;
  return data || [];
}

// Rotations live in rotation_patterns
async function loadApplied(orgId) {
  const { data } = await sb.from('rotation_patterns').select('name, sequence, start_date, days').eq('org_id', orgId);
  const out = {};
  (data || []).forEach(r => {
    let start = r.start_date;
    if (typeof start === 'string' && start.includes('T')) start = start.slice(0, 10);
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) start = iso(new Date());
    out[r.name] = { sequence: r.sequence, start, days: r.days || 365 };
  });
  return out;
}
async function saveRotation(orgId, name, sequence, start, days) {
  const del = await sb.from('rotation_patterns').delete().eq('org_id', orgId).eq('name', name);
  if (del.error) return del.error;
  const ins = await sb.from('rotation_patterns').insert({ org_id: orgId, name, sequence, start_date: start, days });
  return ins.error;
}

function expandSequence(seq, startDate, count) {
  const clean = (seq||'').toUpperCase().replace(/[^DN-]/g,'');
  if (!clean) return [];
  // Normalize start to YYYY-MM-DD. Handles null, empty, full ISO, or invalid values.
  let startStr = startDate;
  if (typeof startStr === 'string') {
    startStr = startStr.slice(0, 10);
  }
  let start = startStr ? new Date(startStr + 'T12:00:00') : null;
  if (!start || isNaN(start.getTime())) {
    // Fallback so a bad/missing start_date never crashes the schedule
    start = new Date();
    start.setHours(12, 0, 0, 0);
  }
  const out = [];
  const days = Math.max(0, Number(count) || 0);
  for (let i = 0; i < days; i++) {
    const t = clean[i % clean.length];
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = iso(d);
    if (!dateStr) continue;
    out.push({ date: dateStr, type: t === 'D' ? 'day' : t === 'N' ? 'night' : 'off', token: t });
  }
  return out;
}

// ---- Login page ----

async function initLanding() {
  const session = await getSession();
  if (session) { location.href = 'home.html'; return; }
  document.getElementById('app').innerHTML = `
    <div class="landing">
      <img src="logo.png" class="landing-logo" alt="ShiftCentral" />
      <h1>ShiftCentral</h1>
      <p class="landing-sub">Crew schedules, overtime, vacation, and plant chat — in one place.</p>
      <a class="btn" href="login.html">Sign in</a>
      <a class="btn secondary" href="login.html?mode=signup">Create account</a>
      <a class="btn secondary" href="login.html?mode=plant">Sign your plant up</a>
      <p class="auth-links"><a href="login.html?mode=forgot">Forgot password</a></p>
    </div>
  `;
}

async function initHome() {
  loadNavbar('home');
  const session = await requireAuth();
  if (!session) return;
  await acceptPendingInvites();
  const memberships = await loadMemberships();
  const app = document.getElementById('app');
  if (!memberships.length) {
    app.innerHTML = `
      <p class="role">${session.user.email}</p>
      <h1>Sign your plant up</h1>
      <div class="panel">
        <label>Plant name</label>
        <input id="plant-name" placeholder="Plant name" />
        <button id="create">Create plant</button>
        <p id="msg" class="error"></p>
      </div>
      <button class="secondary" id="out">Sign out</button>
    `;
    document.getElementById('create').onclick = async () => {
      const name = document.getElementById('plant-name').value.trim();
      const { error } = await sb.rpc('create_plant', { plant_name: name });
      if (error) { document.getElementById('msg').textContent = error.message; return; }
      const ms = await loadMemberships();
      if (ms.length) { setSavedOrg(ms[ms.length-1].org_id); location.href = 'home.html'; }
    };
    document.getElementById('out').onclick = () => sb.auth.signOut().then(() => location.href = 'index.html');
    return;
  }
  const saved = getSavedOrg();
  const current = memberships.find(m => m.org_id === saved) || memberships[0];
  setSavedOrg(current.org_id);
  const name = current.organizations?.name || 'Your plant';
  const cards = memberships.length > 1 ? memberships.map(m => `
    <button class="plant-card" data-org="${m.org_id}">${m.organizations?.name||'Plant'} · ${ROLE_LABEL[m.role]||m.role}</button>
  `).join('') : '';
  app.innerHTML = `
    <p class="role">${ROLE_LABEL[current.role]} · ${name}</p>
    <h1>${name}</h1>
    <p class="landing-sub" style="text-align:left">Welcome back. Jump into the plant.</p>
    <a class="btn" href="schedule.html">Schedule</a>
    <a class="btn secondary" href="overtime.html">Overtime</a>
    <a class="btn secondary" href="messages.html">Messages</a>
    ${canSchedule(current.role) ? '<a class="btn secondary" href="settings.html">Settings</a>' : ''}
    ${cards ? `<div class="panel"><h2>Switch plant</h2>${cards}</div>` : ''}
    <button class="secondary" id="out">Sign out</button>
  `;
  document.querySelectorAll('.plant-card').forEach(btn => {
    btn.onclick = () => { setSavedOrg(btn.dataset.org); location.href = 'home.html'; };
  });
  document.getElementById('out').onclick = () => sb.auth.signOut().then(() => location.href = 'index.html');
}

async function initAuth() {
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  let mode = params.get('mode') || 'signin';
  const session = await getSession();
  if (session) { location.href = 'home.html'; return; }

  function render() {
    const title = mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : mode === 'plant' ? 'Sign your plant up' : 'Sign in';
    app.innerHTML = `
      <a href="index.html" class="back">← ShiftCentral</a>
      <div class="landing" style="padding-top:12px">
        <img src="logo.png" class="landing-logo" alt="" />
        <h1>${title}</h1>
      </div>
      <div class="panel">
        <label>Email</label>
        <input id="email" type="email" autocomplete="email" />
        ${mode === 'forgot' ? '' : `<label>Password</label><input id="password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" />`}
        <button id="go">${mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'plant' ? 'Continue' : 'Sign in'}</button>
        <p id="msg" class="error"></p>
        <p class="auth-links">
          ${mode !== 'signin' ? '<a href="login.html">Sign in</a>' : ''}
          ${mode !== 'signup' ? '<a href="login.html?mode=signup">Create account</a>' : ''}
          ${mode !== 'forgot' ? '<a href="login.html?mode=forgot">Forgot password</a>' : ''}
        </p>
      </div>
    `;
    document.getElementById('go').onclick = async () => {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password')?.value || '';
      const msg = document.getElementById('msg');
      msg.className = 'error';
      if (!email) { msg.textContent = 'Enter your email'; return; }
      if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login.html' });
        msg.className = error ? 'error' : 'notice';
        msg.textContent = error ? error.message : 'Reset link sent. Check your email.';
        return;
      }
      if (!password) { msg.textContent = 'Enter a password'; return; }
      if (mode === 'signup') {
        const { error } = await sb.auth.signUp({ email, password });
        msg.className = error ? 'error' : 'notice';
        msg.textContent = error ? error.message : 'Account created. Check your email to confirm, then sign in.';
        return;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { msg.textContent = error.message; return; }
      await acceptPendingInvites();
      location.href = 'home.html';
    };
  }
  render();
}

async function acceptPendingInvites() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return;
  const { data: invites } = await sb.from('invites').select('id').is('accepted_at', null).ilike('email', user.email);
  for (const inv of invites || []) {
    await sb.rpc('accept_invite', { invite_id: inv.id });
  }
}


async function initLogin() {
  loadNavbar('');
  const app = document.getElementById('app');
  const session = await getSession();
  if (session) {
    const memberships = await loadMemberships();
    renderPlantPicker(app, session, memberships);
  } else {
    renderLogin(app);
  }
  sb.auth.onAuthStateChange(async (event, sess) => {
    if (!sess) renderLogin(app);
    else {
      const memberships = await loadMemberships();
      renderPlantPicker(app, sess, memberships);
    }
  });
}

function renderLogin(app) {
  app.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <img src="logo.png" class="landing-logo" alt="" />
      <div><p class="role" style="margin:0">ShiftCentral</p><h1 style="margin:0">Sign in</h1></div>
    </div>
    <div class="panel">
      <label>Email</label><input id="email" type="email" />
      <label>Password</label><input id="password" type="password" />
      <button id="signin">Sign in</button>
      <button class="secondary" id="signup">Create account</button>
    </div>
    <p id="msg" class="error"></p>
  `;
  document.getElementById('signin').onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });
    if (error) document.getElementById('msg').textContent = error.message;
  };
  document.getElementById('signup').onclick = async () => {
    const { error } = await sb.auth.signUp({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });
    document.getElementById('msg').textContent = error ? error.message : 'Check your email to confirm, then sign in.';
  };
}

function renderPlantPicker(app, session, memberships) {
  if (!memberships.length) {
    app.innerHTML = `
      <p class="role">${session.user.email}</p>
      <h1>Create your plant</h1>
      <div class="panel">
        <input id="plant-name" placeholder="Plant name" />
        <button id="create">Create plant</button>
      </div>
      <p id="msg" class="error"></p>
      <button class="secondary" id="out">Sign out</button>
    `;
    document.getElementById('create').onclick = async () => {
      const name = document.getElementById('plant-name').value.trim();
      const { error } = await sb.rpc('create_plant', { plant_name: name });
      if (error) { document.getElementById('msg').textContent = error.message; return; }
      const ms = await loadMemberships();
      if (ms.length) { setSavedOrg(ms[ms.length-1].org_id); location.href = 'home.html'; }
    };
    document.getElementById('out').onclick = () => sb.auth.signOut();
    return;
  }
  const cards = memberships.map(m => `
    <button class="plant-card" data-org="${m.org_id}">
      <strong>${m.organizations?.name||'Plant'}</strong><br>
      <span class="role">${ROLE_LABEL[m.role]||m.role}</span>
    </button>
  `).join('');
  app.innerHTML = `
    <p class="role">${session.user.email}</p>
    <h1>Your plants</h1>
    ${cards}
    <button class="secondary" id="out">Sign out</button>
  `;
  document.querySelectorAll('.plant-card').forEach(btn => {
    btn.onclick = () => { setSavedOrg(btn.dataset.org); location.href = 'home.html'; };
  });
  document.getElementById('out').onclick = () => sb.auth.signOut();
}

// ---- Schedule page (interactive calendar) ----
async function initSchedule() {
  loadNavbar('schedule');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const orgId = ctx.current.org_id;
  const applied = await loadApplied(orgId);
  const crews = Object.keys(applied).sort((a, b) => a.localeCompare(b));
  const operators = await loadOperators(orgId);
  const meEmail = (ctx.session.user.email || '').toLowerCase();
  const meOp = operators.find(o => (o.email||'').toLowerCase() === meEmail)
    || operators.find(o => meEmail && (o.name||'').toLowerCase() && meEmail.includes((o.name||'').toLowerCase()));
  const myCrewOps = meOp?.crew ? operators.filter(o => o.crew === meOp.crew) : (meOp ? [meOp] : []);
  const canEdit = meOp ? ['supervisor', 'admin'].includes(meOp.role) : canSchedule(ctx.current.role);
  const canBook = canEdit;
  const areas = await loadAreas(orgId);
  const quals = await loadQuals(orgId);
  let dayAreas = await loadAssignments(orgId);
  const { data: vacRows } = await sb.from('vacation_requests').select('id, name, start_date, end_date, status').eq('org_id', orgId).eq('status', 'approved');
  const vacations = (vacRows || []).map(v => ({ id: v.id, name: v.name, start: v.start_date, end: v.end_date, status: v.status }));
  let selected = crews[0] || null;
  let selectedDates = new Set([iso(new Date())]);
  let viewDate = new Date();
  let dragging = false;
  let sheet = null; // null | menu | vacation | edit

  function crewOnDate(name, date) {
    const data = applied[name];
    if (!data) return null;
    const expanded = expandSequence(data.sequence, data.start, data.days);
    return expanded.find(x => x.date === date) || null;
  }

  function sortedDates() { return [...selectedDates].sort(); }
  function areaName(id) {
    if (!id || id === 'float') return 'Float';
    return areas.find(a => a.id === id)?.name || '—';
  }
  function vacationsOn(date) {
    return vacations.filter(v => v.start && v.end && v.start <= date && date <= v.end);
  }
  function onVacation(op, dateList) {
    return dateList.some(date => vacationsOn(date).some(v => (v.name||'').toLowerCase() === (op.name||'').toLowerCase()));
  }
  function qualifiedFor(op, areaId) {
    return (quals[op.id] || []).includes(areaId);
  }
  function workingCrews(date) {
    return crews.filter(name => {
      const hit = crewOnDate(name, date);
      return hit && hit.token !== '-';
    });
  }

  function render() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const dates = sortedDates();
    const primary = dates[0] || iso(new Date());

    let cells = WEEKDAYS.map(w => `<div class="cal-head">${w}</div>`).join('');
    for (let i = 0; i < startPad; i++) cells += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = iso(new Date(year, month, d));
      let dayCrew = '';
      let nightCrew = '';
      for (const name of Object.keys(applied)) {
        const hit = crewOnDate(name, date);
        if (!hit) continue;
        if (hit.token === 'D') dayCrew = name.replace(/^Crew\s+/i, '');
        else if (hit.token === 'N') nightCrew = name.replace(/^Crew\s+/i, '');
      }
      const crewLabel = (dayCrew || nightCrew) ? `${dayCrew||'–'}/${nightCrew||'–'}` : '';
      const sel = selectedDates.has(date) ? ' selected' : '';
      const today = date === iso(new Date()) ? ' today' : '';
      const vac = vacationsOn(date);
      const vacCls = vac.length ? ' has-vac' : '';
      const vacBadge = vac.length ? `<span class="vac-dot" title="${vac.length} on vacation"></span>` : '';
      cells += `<div class="cal-day${sel}${today}${vacCls}" data-date="${date}"><span class="n">${d}</span><span class="crews">${crewLabel}</span>${vacBadge}</div>`;
    }

    const crewBtns = crews.map(c => `<button type="button" class="crew-tab${c===selected?' active':''}" data-c="${c}">${c}</button>`).join('') || '<span style="color:#94a3b8;font-size:12px">No crew rotations yet</span>';

    const hit = selected ? crewOnDate(selected, primary) : null;
    const shiftLabel = hit ? (hit.token === 'D' ? 'Day' : hit.token === 'N' ? 'Night' : 'Off') : '—';
    const onCrew = operators.filter(op => selected && (op.crew === selected || ('Crew ' + op.crew) === selected || op.crew === selected.replace(/^Crew\s+/i, '')));
    const rangeLabel = dates.length > 1 ? `${dates.length} days selected` : primary;

    // who is already in each role on the primary day
    const areaIds = new Set(areas.map(a => a.id));
    const assigned = {};
    operators.forEach(op => {
      const areaId = dayAreas[primary + '|' + op.id];
      if (areaId && areaIds.has(areaId)) assigned[areaId] = op.id;
    });
    const used = new Set(Object.values(assigned));
    const floaters = onCrew.filter(op => !onVacation(op, dates) && !used.has(op.id));

    const otherCrew = operators.filter(op => !onCrew.some(x => x.id === op.id));
    const roleRows = areas.map(a => {
      const current = assigned[a.id] || '';
      const isOt = current && otherCrew.some(op => op.id === current);
      const available = onCrew.filter(op => !onVacation(op, dates) && qualifiedFor(op, a.id) && (op.id === current || !used.has(op.id)));
      const opts = ['<option value="">—</option>']
        .concat(available.map(op => `<option value="${op.id}" ${current===op.id?'selected':''}>${op.name}</option>`))
        .concat([`<option value="ot" ${isOt?'selected':''}>Overtime</option>`])
        .join('');
      const otOpts = otherCrew.filter(op => !onVacation(op, dates) && qualifiedFor(op, a.id)).map(op => `<option value="${op.id}" ${current===op.id?'selected':''}>${op.name} · Crew ${op.crew}</option>`).join('');
      return `
        <div class="person-card">
          <div class="person-name">${a.name}</div>
          <select class="role-pick" data-area="${a.id}" ${canEdit?'':'disabled'}>${opts}</select>
          <select class="ot-pick" data-area="${a.id}" style="margin-top:6px;${isOt?'':'display:none'}" ${canEdit?'':'disabled'}>
            <option value="">Select OT operator…</option>
            ${otOpts}
          </select>
        </div>
      `;
    }).join('');
    const floatList = floaters.map(op => `<span class="chip">${op.name}</span>`).join(' ') || '<span style="color:#94a3b8;font-size:13px">None</span>';
    const readOnlyRoster = workingCrews(primary).map(name => {
      const hit = crewOnDate(name, primary);
      const shift = hit?.token === 'D' ? 'Day' : hit?.token === 'N' ? 'Night' : 'Off';
      const crewOps = operators.filter(op => op.crew === name || ('Crew ' + op.crew) === name || op.crew === name.replace(/^Crew\s+/i, ''));
      const rows = crewOps.map(op => {
        const onVac = vacationsOn(primary).some(v => (v.name||'').toLowerCase() === (op.name||'').toLowerCase());
        const area = onVac ? 'Vacation' : areaName(dayAreas[primary + '|' + op.id]);
        return `<div class="row"><span>${op.name}</span><span class="chip${onVac?' vac':''}">${area}</span></div>`;
      }).join('') || '<p style="color:#94a3b8;font-size:13px">No operators on this crew.</p>';
      return `<div class="person-card"><div class="person-name">${name} · ${shift}</div>${rows}</div>`;
    }).join('') || '<p style="color:#94a3b8;font-size:13px">No crews scheduled this day.</p>';

    const people = canEdit ? (onCrew.length ? `
      ${roleRows || '<p style="color:#94a3b8;font-size:13px">Add areas in Settings first.</p>'}
      <div class="person-card">
        <div class="person-name">Float</div>
        <div class="person-meta">Leftover operators</div>
        <div id="float-list">${floatList}</div>
      </div>
      <button id="save-roles">Save to selected days</button>
    ` : '<p style="color:#94a3b8;font-size:13px;margin:8px 0">No operators on this crew.</p>') : readOnlyRoster;

    const dayVac = vacationsOn(primary);
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
    const monthVac = vacations
      .filter(v => v.start <= monthEnd && v.end >= monthStart)
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
    function dayCount(v) {
      const a = new Date(v.start + 'T12:00:00');
      const b = new Date(v.end + 'T12:00:00');
      return Math.round((b - a) / 86400000) + 1;
    }
    const vacCards = monthVac.map(v => {
      const active = dayVac.some(x => x.id === v.id);
      return `
        <div class="vac-card${active?' active':''}">
          <div class="vac-top">
            <strong>${v.name}</strong>
            <span class="chip vac">${dayCount(v)} day${dayCount(v)===1?'':'s'}</span>
          </div>
          <div class="vac-dates">${v.start} → ${v.end}</div>
          ${active ? '<div class="vac-now">Off on the selected day</div>' : ''}
        </div>`;
    }).join('') || '<p style="color:#94a3b8;font-size:13px">No approved vacation this month.</p>';
    const vacPanel = dayVac.length ? dayVac.map(v => `
      <div class="vac-card active">
        <div class="vac-top"><strong>${v.name}</strong><span class="chip vac">Off</span></div>
        <div class="vac-dates">${v.start} → ${v.end}</div>
      </div>
    `).join('') : '<p style="color:#94a3b8;font-size:13px">No one is on vacation this day.</p>';
    const upcoming = vacCards;

    const dateLabel = dates.length > 1 ? `${dates[0]} → ${dates[dates.length-1]}` : primary;
    const hint = `<p class="hint">Click a day or drag a set.</p>`;
    const viewBody = `<h2 style="margin-top:0">Working this day</h2>${readOnlyRoster}`;
    const sheetHtml = !sheet ? '' : sheet === 'menu' ? `
      <div class="modal-back" id="sheet-back">
        <div class="modal sheet">
          <p class="role">${dateLabel}</p>
          <h2>What do you want to do?</h2>
          <button type="button" class="sheet-option" id="opt-view">
            <strong>View schedule</strong>
            <span>See who is working and where</span>
          </button>
          <button type="button" class="sheet-option" id="opt-vac">
            <strong>${canBook ? 'Book vacation' : 'Request vacation'}</strong>
            <span>${canBook ? 'Put a crew operator on vacation' : 'Request the selected days'}</span>
          </button>
          ${canEdit ? `<button type="button" class="sheet-option" id="opt-edit">
            <strong>Edit schedule</strong>
            <span>Set areas for ${selected || 'the crew'}</span>
          </button>` : ''}
          <button type="button" class="secondary" id="sheet-close">Close</button>
        </div>
      </div>` : sheet === 'vacation' ? `
      <div class="modal-back" id="sheet-back">
        <div class="modal sheet">
          <p class="role">${canBook ? 'Book vacation' : 'Request vacation'}</p>
          <h2>${dateLabel}</h2>
          ${canBook ? `
            <label>Operator</label>
            <select id="vac-name">
              ${myCrewOps.map(o => `<option value="${o.name}" ${o.id===meOp?.id?'selected':''}>${o.name}</option>`).join('') || '<option value="">No operators on your crew</option>'}
            </select>
          ` : `
            <label>Operator</label>
            <input id="vac-name" value="${meOp?.name || ''}" readonly />
          `}
          <label>Start</label>
          <input id="vac-start" type="date" value="${dates[0] || primary}" />
          <label>End</label>
          <input id="vac-end" type="date" value="${dates[dates.length-1] || primary}" />
          <button id="vac-submit">${canBook ? 'Add to vacation' : 'Submit request'}</button>
          <button type="button" class="secondary" id="sheet-back-btn">Back</button>
        </div>
      </div>` : sheet === 'view' ? `
      <div class="modal-back" id="sheet-back">
        <div class="modal sheet">
          <p class="role">View schedule</p>
          <h2>${dateLabel}</h2>
          ${viewBody}
          <button type="button" class="secondary" id="sheet-back-btn">Back</button>
        </div>
      </div>` : `
      <div class="modal-back" id="sheet-back">
        <div class="modal sheet">
          <p class="role">Edit schedule</p>
          <h2>${dateLabel}</h2>
          <label>Crew</label>
          <select id="edit-crew-pick">${crews.map(c => `<option ${c===selected?'selected':''}>${c}</option>`).join('')}</select>
          ${people}
          <button type="button" class="secondary" id="sheet-back-btn">Back</button>
        </div>
      </div>`;

    app.innerHTML = `
      <p class="role">${ROLE_LABEL[ctx.current.role]} · ${ctx.current.organizations?.name||''}</p>
      <h1>Schedule</h1>
      ${hint}

      <div class="cal-nav">
        <button type="button" class="cal-nav-btn" id="prev" aria-label="Previous month">‹</button>
        <strong class="cal-title">${viewDate.toLocaleString('default',{month:'long',year:'numeric'})}</strong>
        <button type="button" class="cal-nav-btn" id="next" aria-label="Next month">›</button>
      </div>
      <div class="cal cal-large" id="cal">${cells}</div>
      <div class="vac-board">
        <h2>On vacation · ${viewDate.toLocaleString('default',{month:'long'})}</h2>
        <div class="vac-list">${vacCards}</div>
      </div>
      ${sheetHtml}
    `;

    document.getElementById('prev').onclick = () => { viewDate.setMonth(viewDate.getMonth()-1); render(); };
    document.getElementById('next').onclick = () => { viewDate.setMonth(viewDate.getMonth()+1); render(); };
    document.querySelectorAll('.crew-tab[data-c]').forEach(b => b.onclick = () => { selected = b.dataset.c; render(); });

    const cal = document.getElementById('cal');
    let dragStart = null;
    let moved = false;
    const paint = () => {
      cal.querySelectorAll('.cal-day[data-date]').forEach(el => {
        el.classList.toggle('selected', selectedDates.has(el.dataset.date));
      });
    };
    cal.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        dragStart = el.dataset.date;
        selectedDates = new Set([dragStart]);
        paint();
        e.preventDefault();
      });
      el.addEventListener('mouseenter', (e) => {
        if (!dragging || e.buttons !== 1) return;
        if (el.dataset.date !== dragStart) moved = true;
        selectedDates.add(el.dataset.date);
        paint();
      });
    });
    if (!window.__scMouseUp) {
      window.__scMouseUp = true;
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        if (!moved && dragStart) selectedDates = new Set([dragStart]);
        dragStart = null;
        sheet = 'menu';
        render();
      });
    }

    document.getElementById('sheet-close')?.addEventListener('click', () => { sheet = null; render(); });
    document.getElementById('sheet-back')?.addEventListener('click', (e) => {
      if (e.target.id === 'sheet-back') { sheet = null; render(); }
    });
    document.getElementById('sheet-back-btn')?.addEventListener('click', () => { sheet = 'menu'; render(); });
    document.getElementById('opt-view')?.addEventListener('click', () => { sheet = 'view'; render(); });
    document.getElementById('opt-vac')?.addEventListener('click', () => { sheet = 'vacation'; render(); });
    document.getElementById('edit-crew-pick')?.addEventListener('change', (e) => { selected = e.target.value; render(); });
    document.getElementById('opt-edit')?.addEventListener('click', () => {
      if (!canEdit) { banner(false, 'No permission'); return; }
      sheet = 'edit';
      render();
    });
    document.getElementById('vac-submit')?.addEventListener('click', async () => {
      const name = (document.getElementById('vac-name').value || '').trim();
      const start = document.getElementById('vac-start').value;
      const end = document.getElementById('vac-end').value;
      if (!canBook && (!meOp || name !== meOp.name)) { banner(false, 'No permission'); return; }
      if (canBook && !myCrewOps.some(o => o.name === name)) { banner(false, 'No permission'); return; }
      if (!name || !start || !end) { banner(false, 'Enter a name and dates'); return; }
      const status = canBook ? 'approved' : 'requested';
      const { data: row, error } = await sb.from('vacation_requests').insert({
        org_id: orgId, name, start_date: start, end_date: end, status, created_by: ctx.session.user.id
      }).select('id').single();
      if (error) { banner(false, 'Vacation not saved: ' + explainError(error)); return; }
      if (status === 'approved') vacations.push({ id: row.id, name, start, end, status });
      banner(true, status === 'approved' ? 'Vacation booked' : 'Vacation requested');
      sheet = null;
      render();
    });
    function refreshAreaPicks() {
      const picks = {};
      document.querySelectorAll('.role-pick').forEach(sel => {
        const ot = sel.parentElement.querySelector('.ot-pick');
        if (ot) ot.style.display = sel.value === 'ot' ? '' : 'none';
        if (sel.value && sel.value !== 'ot') picks[sel.dataset.area] = sel.value;
        else if (sel.value === 'ot' && ot?.value) picks[sel.dataset.area] = ot.value;
      });
      const taken = new Set(Object.values(picks));
      document.querySelectorAll('.role-pick').forEach(sel => {
        const mine = sel.value && sel.value !== 'ot' ? sel.value : '';
        const available = onCrew.filter(op => !onVacation(op, dates) && qualifiedFor(op, sel.dataset.area) && (op.id === mine || !taken.has(op.id)));
        const opts = ['<option value="">—</option>']
          .concat(available.map(op => `<option value="${op.id}" ${mine===op.id?'selected':''}>${op.name}</option>`))
          .concat([`<option value="ot" ${sel.value==='ot'?'selected':''}>Overtime</option>`]);
        sel.innerHTML = opts.join('');
      });
      const left = onCrew.filter(op => !onVacation(op, dates) && !taken.has(op.id));
      const box = document.getElementById('float-list');
      if (box) box.innerHTML = left.map(op => `<span class="chip">${op.name}</span>`).join(' ') || '<span style="color:#94a3b8;font-size:13px">None</span>';
    }
    document.querySelectorAll('.role-pick, .ot-pick').forEach(sel => {
      sel.onchange = refreshAreaPicks;
    });
    refreshAreaPicks();
    document.getElementById('save-roles')?.addEventListener('click', async () => {
      try {
      const picks = {};
      document.querySelectorAll('.role-pick').forEach(sel => {
        const area = sel.dataset.area;
        if (sel.value === 'ot') {
          const ot = sel.parentElement.querySelector('.ot-pick');
          if (ot && ot.value) picks[ot.value] = area;
        } else if (sel.value) {
          picks[sel.value] = area;
        }
      });
      for (const date of sortedDates()) {
        operators.forEach(op => {
          const key = date + '|' + op.id;
          if (picks[op.id]) dayAreas[key] = picks[op.id];
          else if (onCrew.some(x => x.id === op.id)) dayAreas[key] = 'float';
        });
      }
      const error = await saveAssignments(orgId, dayAreas, sortedDates(), operators.map(o => o.id));
      if (error) { banner(false, 'Areas not saved: ' + explainError(error)); return; }
      const otPicks = [];
      document.querySelectorAll('.role-pick').forEach(sel => {
        if (sel.value !== 'ot') return;
        const ot = sel.parentElement.querySelector('.ot-pick');
        if (!ot?.value) return;
        const op = operators.find(o => o.id === ot.value);
        if (op) otPicks.push({ name: op.name, area: areas.find(a => a.id === sel.dataset.area)?.name || 'Area' });
      });
      if (otPicks.length) {
        const datesToSave = sortedDates();
        const { data: existing } = await sb.from('overtime_entries').select('operator_name, work_date').eq('org_id', orgId).in('work_date', datesToSave);
        const have = new Set((existing || []).map(r => (r.operator_name||'').toLowerCase() + '|' + r.work_date));
        const rows = [];
        for (const date of datesToSave) {
          for (const pick of otPicks) {
            const key = pick.name.toLowerCase() + '|' + date;
            if (have.has(key)) continue;
            rows.push({
              org_id: orgId,
              user_id: ctx.session.user.id,
              operator_name: pick.name,
              work_date: date,
              hours: 12,
              note: 'Schedule OT · ' + pick.area,
              reason: 'Schedule OT · ' + pick.area
            });
          }
        }
        if (rows.length) {
          const otRes = await sb.from('overtime_entries').insert(rows);
          if (otRes.error) { banner(false, 'Areas saved, overtime not updated: ' + explainError(otRes.error)); }
          else banner(true, 'Areas saved · overtime updated');
        } else banner(true, 'Areas saved');
      } else banner(true, 'Areas saved');
      sheet = null;
      render();
      } catch (e) { banner(false, 'Areas not saved: ' + explainError(e)); }
    });
  }
  render();
}

// ---- Rotation page ----
async function initRotation() {
  loadNavbar('rotation');
  const ctx = await requirePlant();
  if (!ctx) return;
  if (!canSchedule(ctx.current.role)) {
    document.getElementById('app').innerHTML = `<p>Only Admin and SS/LH can set rotations.</p>`;
    return;
  }
  const app = document.getElementById('app');
  let applied = await loadApplied(ctx.current.org_id);
  let editing = null; // crew name being edited, or null for new
  let cycleDays = 16;
  let sequence = '-'.repeat(cycleDays);
  let crewName = 'Crew A';
  let startDate = iso(new Date());
  let populateDays = 365;

  function loadIntoForm(name) {
    const data = applied[name];
    if (!data) return;
    editing = name;
    crewName = name;
    sequence = data.sequence || '-';
    cycleDays = sequence.length || 16;
    startDate = data.start || iso(new Date());
    populateDays = data.days || 365;
  }

  function render() {
    let daysHtml = '';
    for (let i = 0; i < cycleDays; i++) {
      const v = sequence[i] || '-';
      const label = v==='D'?'Day':v==='N'?'Night':'Off';
      daysHtml += `<div class="cal-day ${v}" data-i="${i}"><span class="n">${i+1}</span><span style="font-size:10px">${label}</span></div>`;
    }

    const list = Object.keys(applied).sort((a, b) => a.localeCompare(b)).map(name => `
      <div class="row">
        <span>${name}</span>
        <span>
          <button type="button" class="secondary edit-rot" data-name="${name}" style="width:auto;padding:4px 8px;font-size:12px">Edit</button>
          <button type="button" class="secondary del-rot" data-name="${name}" style="width:auto;padding:4px 8px;font-size:12px">Delete</button>
        </span>
      </div>
    `).join('') || '<p style="color:#94a3b8;font-size:13px">No rotations yet.</p>';

    app.innerHTML = `
      <p class="role">${ROLE_LABEL[ctx.current.role]}</p>
      <h1>Crew rotation</h1>
      <div class="panel">
        <h2>Existing rotations</h2>
        ${list}
        <button class="secondary" id="new-rot">New rotation</button>
      </div>
      <div class="panel">
        <h2>${editing ? 'Edit ' + editing : 'New rotation'}</h2>
        <label>Crew name</label>
        <input id="crew-name" value="${crewName}" />
        <label>Rotation length (days)</label>
        <input id="cycle-days" type="number" min="1" max="84" value="${cycleDays}" />
        <button class="secondary" id="populate">Populate days</button>
        <label>Start date</label>
        <input id="start-date" type="date" value="${startDate}" />
        <label>Days to populate</label>
        <input id="populate-days" type="number" min="7" max="400" value="${populateDays}" />
        <div class="cal" id="edit-cal">${daysHtml}</div>
        <button id="apply">${editing ? 'Update rotation' : 'Apply rotation to schedule'}</button>
        <p id="msg" class="notice"></p>
      </div>
      
    `;

    document.getElementById('new-rot').onclick = () => {
      editing = null;
      crewName = 'Crew A';
      cycleDays = 16;
      sequence = '-'.repeat(16);
      startDate = iso(new Date());
      populateDays = 365;
      render();
    };

    document.querySelectorAll('.edit-rot').forEach(btn => {
      btn.onclick = () => { loadIntoForm(btn.dataset.name); render(); };
    });

    document.querySelectorAll('.del-rot').forEach(btn => {
      btn.onclick = async () => {
        const name = btn.dataset.name;
        if (!confirm('Delete rotation for ' + name + '?')) return;
        const { error } = await sb.from('rotation_patterns').delete().eq('org_id', ctx.current.org_id).eq('name', name);
        if (error) { banner(false, 'Rotation not deleted: ' + explainError(error)); return; }
        delete applied[name];
        if (editing === name) editing = null;
        banner(true, 'Rotation deleted');
        render();
      };
    });

    document.getElementById('populate').onclick = () => {
      cycleDays = Math.max(1, Math.min(84, +document.getElementById('cycle-days').value || 16));
      crewName = document.getElementById('crew-name').value.trim() || 'Crew A';
      startDate = document.getElementById('start-date').value || startDate;
      populateDays = Math.max(7, Math.min(400, +document.getElementById('populate-days').value || 365));
      sequence = (sequence + '-'.repeat(cycleDays)).slice(0, cycleDays);
      render();
    };

    document.querySelectorAll('#edit-cal .cal-day').forEach(el => {
      el.onclick = () => {
        const i = +el.dataset.i;
        const order = ['-','D','N'];
        const cur = sequence[i] || '-';
        const next = order[(order.indexOf(cur)+1)%3];
        const arr = sequence.split('');
        arr[i] = next;
        sequence = arr.join('');
        render();
      };
    });

    document.getElementById('apply').onclick = async () => {
      const newName = document.getElementById('crew-name').value.trim() || 'Crew A';
      startDate = document.getElementById('start-date').value;
      populateDays = +document.getElementById('populate-days').value || 365;
      // if renaming, remove old
      if (editing && editing !== newName) {
        delete applied[editing];
        await sb.from('rotation_patterns').delete().eq('org_id', ctx.current.org_id).eq('name', editing);
      }
      const error = await saveRotation(ctx.current.org_id, newName, sequence, startDate, populateDays);
      if (error) { banner(false, 'Rotation not saved: ' + explainError(error)); return; }
      applied[newName] = { sequence, start: startDate, days: populateDays };
      editing = newName;
      crewName = newName;
      banner(true, 'Rotation saved');
      render();
    };
  }
  render();
}

// ---- Admin page ----
async function initAdmin() {
  loadNavbar('admin');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const { data: rows } = await sb.from('org_members').select('user_id, role').eq('org_id', ctx.current.org_id);
  const ids = (rows||[]).map(r => r.user_id);
  let profiles = [];
  if (ids.length) {
    const { data } = await sb.from('profiles').select('id, email, full_name').in('id', ids);
    profiles = data || [];
  }
  const map = Object.fromEntries(profiles.map(p => [p.id, p]));
  const list = (rows||[]).map(r => {
    const p = map[r.user_id];
    return `<div class="row"><span>${p?.full_name || p?.email || r.user_id.slice(0,8)}</span><span class="chip">${ROLE_LABEL[r.role]||r.role}</span></div>`;
  }).join('') || '<p>No members</p>';
  app.innerHTML = `
    <p class="role">${ROLE_LABEL[ctx.current.role]}</p>
    <h1>${ctx.current.organizations?.name||'Plant'}</h1>
    <div class="panel"><h2>Members</h2>${list}</div>
    <button class="secondary" id="out">Sign out</button>
    
  `;
  document.getElementById('out').onclick = () => sb.auth.signOut().then(() => location.href = 'index.html');
}

// ---- Plant settings store (operators, crews, areas, qualifications) ----
async function loadOperators(orgId) {
  const { data } = await sb.from('operators').select('id, name, email, crew, role').eq('org_id', orgId).order('name');
  return data || [];
}

async function loadMemberIndex(orgId) {
  const { data: rows } = await sb.from('org_members').select('user_id, role').eq('org_id', orgId);
  const ids = (rows || []).map(r => r.user_id);
  let profiles = [];
  if (ids.length) {
    const { data } = await sb.from('profiles').select('id, email').in('id', ids);
    profiles = data || [];
  }
  const byEmail = {};
  profiles.forEach(p => { if (p.email) byEmail[p.email.toLowerCase()] = p.id; });
  const byUser = Object.fromEntries((rows || []).map(r => [r.user_id, r.role]));
  return { byEmail, byUser };
}

async function loadAreas(orgId) {
  const { data } = await sb.from('areas').select('id, name').eq('org_id', orgId).order('name');
  return data || [];
}
async function loadQuals(orgId) {
  const ops = await loadOperators(orgId);
  const ids = ops.map(o => o.id);
  if (!ids.length) return {};
  const { data } = await sb.from('operator_quals').select('operator_id, area_id').in('operator_id', ids);
  const out = {};
  (data || []).forEach(q => { (out[q.operator_id] ||= []).push(q.area_id); });
  return out;
}
async function loadAssignments(orgId) {
  const { data } = await sb.from('assignments').select('work_date, operator_id, area_id, is_float').eq('org_id', orgId);
  const out = {};
  (data || []).forEach(a => { out[a.work_date + '|' + a.operator_id] = a.is_float ? 'float' : a.area_id; });
  return out;
}
async function saveAssignments(orgId, dayAreas, dates, operatorIds) {
  for (const date of dates) {
    for (const opId of operatorIds) {
      const key = date + '|' + opId;
      const val = dayAreas[key];
      if (!val) continue;
      const row = {
        org_id: orgId,
        work_date: date,
        operator_id: opId,
        area_id: val === 'float' ? null : val,
        is_float: val === 'float'
      };
      const { error } = await sb.from('assignments').upsert(row, { onConflict: 'org_id,work_date,operator_id' });
      if (error) return error;
    }
  }
  return null;
}

async function initSettings() {
  loadNavbar('settings');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const orgId = ctx.current.org_id;
  const canEdit = canSchedule(ctx.current.role);
  const isAdmin = ['owner', 'admin'].includes(ctx.current.role);
  let memberIndex = await loadMemberIndex(orgId);

  let operators = await loadOperators(orgId);
  let areas = await loadAreas(orgId);
  let quals = await loadQuals(orgId);
  let applied = await loadApplied(orgId);
  const crews = Object.keys(applied).sort((a, b) => a.localeCompare(b));
  let section = 'rotations';
  let crewFilter = 'all';
  let opSearch = '';
  let editingOp = null;
  let addingOp = false;

  function render() {
    const rotBtn = canEdit ? `<a href="rotation.html" class="secondary" style="display:block;text-align:center;padding:11px;border-radius:10px;text-decoration:none;border:1px solid var(--line);margin-top:8px">Edit crew rotations</a>` : '';

    const q = opSearch.trim().toLowerCase();
    const filtered = operators.filter(op => {
      if (crewFilter !== 'all' && op.crew !== crewFilter) return false;
      if (q && !(op.name||'').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const opRows = filtered.map(op => `
      <div class="row op-row" data-id="${op.id}" style="cursor:pointer">
        <span>${op.name}<br><span style="color:#94a3b8;font-size:12px">${op.email||'No email'} · Crew ${op.crew||'—'} · ${ROLE_LABEL[op.role]||'Operator'}</span></span>
        <span class="chip">Edit</span>
      </div>
    `).join('') || '<p style="color:#94a3b8;font-size:13px">No operators match.</p>';
    const edit = editingOp ? (() => {
      const op = operators.find(o => o.id === editingOp);
      if (!op) return '';
      return `
        <div class="modal-back" id="modal-back">
          <div class="modal">
            <h2>Edit ${op.name}</h2>
            <label>Name</label>
            <input id="edit-name" value="${op.name||''}" />
            <label>Email</label>
            <input id="edit-email" type="email" value="${op.email||''}" />
            <label>Crew</label>
            <select id="edit-crew">${crews.map(c => `<option ${op.crew===c?'selected':''}>${c}</option>`).join('')}</select>
            ${isAdmin ? `<label>Role</label>
            <select id="edit-role">
              <option value="member" ${(op.role||'member')==='member'?'selected':''}>Operator</option>
              <option value="supervisor" ${op.role==='supervisor'?'selected':''}>SS/LH</option>
              <option value="admin" ${op.role==='admin'?'selected':''}>Admin</option>
            </select>` : ''}
            <label>Qualifications</label>
            <label class="check-line"><input type="checkbox" id="qual-all" /> All areas</label>
            <div class="qual-grid">
              ${areas.map(a => `<label class="check-line"><input type="checkbox" class="qual-edit" data-area="${a.id}" ${(quals[op.id]||[]).includes(a.id)?'checked':''} /> ${a.name}</label>`).join('') || '<span style="color:#94a3b8;font-size:13px">Add areas first.</span>'}
            </div>
            <button id="save-op">Save</button>
            <button type="button" class="secondary" id="del-op">Remove</button>
            <button type="button" class="secondary" id="close-op">Close</button>
          </div>
        </div>`;
    })() : '';

    const areaRows = areas.map(a => `
      <div class="row">
        <span>${a.name}</span>
        <button type="button" class="secondary del-area" data-id="${a.id}" style="width:auto;padding:6px 8px;font-size:12px">Delete</button>
      </div>
    `).join('') || '<p style="color:#94a3b8;font-size:13px">No areas yet.</p>';

    let qualHtml = '';
    if (operators.length && areas.length) {
      qualHtml = operators.map(op => {
        const checked = new Set(quals[op.id] || []);
        const boxes = areas.map(a => `
          <label style="font-size:12px;margin-right:10px;display:inline-flex;align-items:center;gap:4px">
            <input type="checkbox" class="qual" data-op="${op.id}" data-area="${a.id}" ${checked.has(a.id)?'checked':''} />
            ${a.name}
          </label>
        `).join('');
        return `<div class="row" style="align-items:flex-start"><span>${op.name}</span><span>${boxes}</span></div>`;
      }).join('');
    } else {
      qualHtml = '<p style="color:#94a3b8;font-size:13px">Add operators and areas first.</p>';
    }

    const tabs = [
      ['rotations', 'Rotations'],
      ['operators', 'Operators'],
      ...(canEdit ? [['invite','Invite'], ['areas','Areas']] : [])
    ];
    const tabBtns = tabs.map(([id, label]) => `<button type="button" class="crew-tab${section===id?' active':''}" data-sec="${id}">${label}</button>`).join('');

    const rotations = `
      <div class="panel">
        <h2>Rotations</h2>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 8px">Build and edit crew rotations.</p>
        ${rotBtn || '<p>Operators cannot edit rotations.</p>'}
      </div>`;
    const invite = `
      <div class="panel">
        <h2>Invite to plant</h2>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 8px">Invite by email. They join this plant when they sign up or sign in.</p>
        <label>Email</label>
        <input id="invite-email" type="email" placeholder="name@plant.com" />
        <label>Role</label>
        <select id="invite-role">
          <option value="member">Operator</option>
          <option value="supervisor">SS/LH</option>
          <option value="admin">Admin</option>
        </select>
        <button id="send-invite">Send invite</button>
        <p id="invite-msg" class="notice"></p>
        <div id="invite-list"></div>
      </div>`;
    const addModal = addingOp ? `
      <div class="modal-back">
        <div class="modal">
          <h2>Add operator</h2>
          <label>Name</label>
          <input id="new-op" placeholder="Operator name" />
          <label>Email</label>
          <input id="new-op-email" type="email" placeholder="Email" />
          <label>Crew</label>
          <select id="new-op-crew">${crews.map(c=>`<option>${c}</option>`).join('') || '<option>Crew A</option>'}</select>
          <button id="add-op">Add</button>
          <button type="button" class="secondary" id="close-add">Cancel</button>
        </div>
      </div>` : '';
    const ops = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">Operators</h2>
          ${canEdit ? '<button type="button" id="open-add" class="icon-btn" title="Add operator" style="width:36px">+</button>' : ''}
        </div>
        <input id="op-search" placeholder="Search name" value="${opSearch}" />
        <div class="crew-tabs">
          ${['all', ...crews].map(c => `<button type="button" class="crew-tab${crewFilter===c?' active':''}" data-crew="${c}">${c==='all'?'All':c}</button>`).join('')}
        </div>
        ${opRows}
      </div>
      ${addModal}
      ${edit}`;
    const areasPanel = `
      <div class="panel">
        <h2>Areas</h2>
        ${areaRows}
        <input id="new-area" placeholder="Area name (e.g. Reformer)" />
        <button id="add-area">Add area</button>
      </div>`;
    const qualsPanel = `
      <div class="panel">
        <h2>Qualifications</h2>
        <p style="font-size:12px;color:#94a3b8">Check the areas each operator is qualified to work.</p>
        ${qualHtml}
      </div>`;
    const body = { rotations, invite, operators: ops, areas: areasPanel, quals: qualsPanel }[section] || rotations;

    app.innerHTML = `
      <p class="role">${ROLE_LABEL[ctx.current.role]} · ${ctx.current.organizations?.name||''}</p>
      <h1>Settings</h1>
      <div class="crew-tabs">${tabBtns}</div>
      ${body}
    `;
    document.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { section = b.dataset.sec; render(); });

    document.getElementById('send-invite')?.addEventListener('click', async () => {
      const email = document.getElementById('invite-email').value.trim();
      const role = document.getElementById('invite-role').value;
      const msg = document.getElementById('invite-msg');
      if (!email) { msg.textContent = 'Enter an email'; msg.className = 'error'; return; }
      const { error } = await sb.from('invites').insert({
        org_id: orgId,
        email,
        role,
        invited_by: ctx.session.user.id
      });
      msg.className = error ? 'error' : 'notice';
      msg.textContent = error ? error.message : 'Invite saved for ' + email;
      banner(!error, error ? ('Invite not sent: ' + explainError(error)) : 'Invite saved');
      if (!error) loadInvites();
    });
    async function loadInvites() {
      const box = document.getElementById('invite-list');
      if (!box) return;
      const { data } = await sb.from('invites').select('email, role, accepted_at, created_at').eq('org_id', orgId).order('created_at', { ascending: false });
      box.innerHTML = (data||[]).map(i => `<div class="row"><span>${i.email}</span><span class="chip">${i.accepted_at ? 'joined' : ROLE_LABEL[i.role]||i.role}</span></div>`).join('');
    }
    loadInvites();

    document.getElementById('open-add')?.addEventListener('click', () => { addingOp = true; render(); });
    document.getElementById('close-add')?.addEventListener('click', () => { addingOp = false; render(); });
    document.getElementById('op-search')?.addEventListener('input', (e) => {
      opSearch = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const box = document.getElementById('op-search');
      if (box) { box.focus(); box.setSelectionRange(pos, pos); }
    });
    document.querySelectorAll('[data-crew]').forEach(b => b.onclick = () => { crewFilter = b.dataset.crew; render(); });
    document.querySelectorAll('.op-row').forEach(row => row.onclick = () => {
      if (!isAdmin) { banner(false, 'No permission'); return; }
      editingOp = row.dataset.id;
      render();
    });
    document.getElementById('close-op')?.addEventListener('click', () => { editingOp = null; render(); });
    const allBox = document.getElementById('qual-all');
    const qualBoxes = [...document.querySelectorAll('.qual-edit')];
    if (allBox) {
      allBox.checked = qualBoxes.length > 0 && qualBoxes.every(cb => cb.checked);
      allBox.onchange = () => { qualBoxes.forEach(cb => { cb.checked = allBox.checked; }); };
      qualBoxes.forEach(cb => cb.onchange = () => { allBox.checked = qualBoxes.every(x => x.checked); });
    }
    document.getElementById('save-op')?.addEventListener('click', async () => {
      if (!isAdmin) { banner(false, 'No permission'); return; }
      const op = operators.find(o => o.id === editingOp);
      if (!op) return;
      const name = document.getElementById('edit-name').value.trim() || op.name;
      const email = document.getElementById('edit-email').value.trim();
      const crew = document.getElementById('edit-crew').value;
      const role = isAdmin ? (document.getElementById('edit-role')?.value || op.role || 'member') : (op.role || 'member');
      const { data: saved, error } = await sb.from('operators').update({ name, email, crew, role }).eq('id', op.id).select('id');
      if (error) { banner(false, 'Operator not saved: ' + explainError(error)); return; }
      if (!saved?.length) { banner(false, 'No permission'); return; }
      const wanted = new Set([...document.querySelectorAll('.qual-edit')].filter(cb => cb.checked).map(cb => cb.dataset.area));
      const current = new Set(quals[op.id] || []);
      for (const area of wanted) {
        if (!current.has(area)) {
          const res = await sb.from('operator_quals').insert({ operator_id: op.id, area_id: area });
          if (res.error) { banner(false, 'Qualification not saved: ' + explainError(res.error)); return; }
        }
      }
      for (const area of current) {
        if (!wanted.has(area)) {
          const res = await sb.from('operator_quals').delete().eq('operator_id', op.id).eq('area_id', area);
          if (res.error) { banner(false, 'Qualification not saved: ' + explainError(res.error)); return; }
        }
      }
      quals = await loadQuals(orgId);
      if (isAdmin && email) {
        const userId = memberIndex.byEmail[email.toLowerCase()];
        if (userId && memberIndex.byUser[userId] !== 'owner') {
          const { error: roleErr } = await sb.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId);
          if (roleErr) { banner(false, 'Role not updated: ' + explainError(roleErr)); }
          else memberIndex = await loadMemberIndex(orgId);
        }
      }
      editingOp = null;
      operators = await loadOperators(orgId);
      banner(true, 'Operator saved');
      render();
    });
    document.getElementById('del-op')?.addEventListener('click', async () => {
      if (!isAdmin) { banner(false, 'No permission'); return; }
      const { data: removed, error } = await sb.from('operators').delete().eq('id', editingOp).select('id');
      if (error) { banner(false, 'Operator not removed: ' + explainError(error)); return; }
      if (!removed?.length) { banner(false, 'No permission'); return; }
      editingOp = null;
      operators = await loadOperators(orgId);
      quals = await loadQuals(orgId);
      banner(true, 'Operator removed');
      render();
    });
    document.getElementById('add-op')?.addEventListener('click', async () => {
      const name = document.getElementById('new-op').value.trim();
      const email = document.getElementById('new-op-email').value.trim();
      const crew = document.getElementById('new-op-crew').value;
      if (!name) return;
      const { error } = await sb.from('operators').insert({ org_id: orgId, name, email, crew });
      if (error) { banner(false, 'Operator not added: ' + explainError(error)); return; }
      operators = await loadOperators(orgId);
      addingOp = false;
      if (email) {
        const inv = await sb.from('invites').insert({ org_id: orgId, email, role: 'member', invited_by: ctx.session.user.id });
        if (inv.error) banner(false, 'Operator added, invite failed: ' + explainError(inv.error));
        else banner(true, 'Operator added');
      } else banner(true, 'Operator added');
      render();
    });
    document.querySelectorAll('.del-op').forEach(btn => {
      btn.onclick = () => {
        operators = operators.filter(o => o.id !== btn.dataset.id);
        delete quals[btn.dataset.id];
        savePlant(orgId, 'operators', operators);
        savePlant(orgId, 'quals', quals);
        render();
      };
    });
    document.querySelectorAll('.op-crew').forEach(sel => {
      sel.onchange = () => {
        const op = operators.find(o => o.id === sel.dataset.id);
        if (op) op.crew = sel.value;
        savePlant(orgId, 'operators', operators);
      };
    });
    document.getElementById('add-area')?.addEventListener('click', async () => {
      const name = document.getElementById('new-area').value.trim();
      if (!name) return;
      const { error } = await sb.from('areas').insert({ org_id: orgId, name });
      if (error) { banner(false, 'Area not added: ' + explainError(error)); return; }
      areas = await loadAreas(orgId);
      banner(true, 'Area added');
      render();
    });
    document.querySelectorAll('.del-area').forEach(btn => {
      btn.onclick = async () => {
        const { error } = await sb.from('areas').delete().eq('id', btn.dataset.id);
        if (error) { banner(false, 'Area not removed: ' + explainError(error)); return; }
        areas = await loadAreas(orgId);
        quals = await loadQuals(orgId);
        banner(true, 'Area removed');
        render();
      };
    });
    document.querySelectorAll('.qual').forEach(cb => {
      cb.onchange = async () => {
        const op = cb.dataset.op;
        const area = cb.dataset.area;
        const res = cb.checked
          ? await sb.from('operator_quals').insert({ operator_id: op, area_id: area })
          : await sb.from('operator_quals').delete().eq('operator_id', op).eq('area_id', area);
        if (res.error) { banner(false, 'Qualification not saved: ' + explainError(res.error)); cb.checked = !cb.checked; return; }
        quals = await loadQuals(orgId);
        banner(true, 'Qualification saved');
      };
    });
  }
  render();
}

// ---- Overtime ----
async function initOvertime() {
  loadNavbar('overtime');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const orgId = ctx.current.org_id;
  const canEdit = canSchedule(ctx.current.role);
  const operators = await loadOperators(orgId);
  const { data, error } = await sb.from('overtime_entries').select('id, operator_name, work_date, hours, note, reason').eq('org_id', orgId).order('work_date', { ascending: false });
  if (error) banner(false, 'Overtime not loaded: ' + explainError(error));
  let entries = (data || []).map(r => ({ id: r.id, name: r.operator_name || 'Operator', date: r.work_date, hours: +r.hours || 0, note: r.note || r.reason || '' }));
  let year = new Date().getFullYear();

  function crewOf(name) {
    const op = operators.find(o => (o.name||'').toLowerCase() === (name||'').toLowerCase());
    return op?.crew || 'Unassigned';
  }

  function render() {
    const yearEntries = entries.filter(e => (e.date||'').startsWith(String(year)));
    const crews = [...new Set(operators.map(o => o.crew).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    if (yearEntries.some(e => crewOf(e.name) === 'Unassigned')) crews.push('Unassigned');
    const grand = yearEntries.reduce((s, e) => s + e.hours, 0);
    const sheets = crews.map(crew => {
      const names = crew === 'Unassigned'
        ? [...new Set(yearEntries.filter(e => crewOf(e.name) === 'Unassigned').map(e => e.name))]
        : operators.filter(o => o.crew === crew).map(o => o.name);
      const rows = names.map(name => {
        const mine = yearEntries.filter(e => e.name.toLowerCase() === name.toLowerCase());
        const hours = mine.reduce((s, e) => s + e.hours, 0);
        return { name, hours, count: mine.length };
      }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
      const crewTotal = rows.reduce((s, r) => s + r.hours, 0);
      const body = rows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${r.count}</td>
          <td class="num">${r.hours.toFixed(1)}</td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:#94a3b8">No operators</td></tr>';
      return `
        <div class="panel ot-sheet">
          <div class="vac-top">
            <h2 style="margin:0">${crew}</h2>
            <span class="chip">${crewTotal.toFixed(1)}h</span>
          </div>
          <table class="ot-table">
            <thead><tr><th>Operator</th><th>Entries</th><th>Hours</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
    }).join('') || '<p style="color:#94a3b8">No crews yet.</p>';
    const names = operators.map(o => `<option>${o.name}</option>`).join('');
    const recent = yearEntries.slice(0, 8).map(e => `
      <div class="row">
        <span>${e.date} · ${e.name}<br><span style="color:#94a3b8;font-size:12px">${crewOf(e.name)}${e.note ? ' · ' + e.note : ''}</span></span>
        <span>${e.hours}h ${canEdit ? `<button type="button" class="secondary del-ot" data-id="${e.id}" style="width:auto;padding:4px 8px;font-size:12px">×</button>` : ''}</span>
      </div>`).join('') || '<p style="color:#94a3b8;font-size:13px">No entries this year.</p>';
    app.innerHTML = `
      <p class="role">${ctx.current.organizations?.name||''}</p>
      <h1>Overtime</h1>
      <div class="cal-nav">
        <button type="button" class="cal-nav-btn" id="ot-prev" aria-label="Previous year">‹</button>
        <strong class="cal-title">${year}</strong>
        <button type="button" class="cal-nav-btn" id="ot-next" aria-label="Next year">›</button>
      </div>
      <p class="hint">Plant total ${grand.toFixed(1)}h</p>
      ${sheets}
      <div class="panel">
        <h2 style="margin-top:0">Recent</h2>
        ${recent}
      </div>
    `;
    document.getElementById('ot-prev').onclick = () => { year -= 1; render(); };
    document.getElementById('ot-next').onclick = () => { year += 1; render(); };
    document.querySelectorAll('.del-ot').forEach(b => b.onclick = async () => {
      if (!canEdit) { banner(false, 'No permission'); return; }
      const { error } = await sb.from('overtime_entries').delete().eq('id', b.dataset.id);
      if (error) { banner(false, 'Overtime not removed: ' + explainError(error)); return; }
      entries = entries.filter(e => e.id !== b.dataset.id);
      banner(true, 'Overtime removed');
      render();
    });
  }
  render();
}

// ---- Vacation ----
async function initVacation() {
  loadNavbar('vacation');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const orgId = ctx.current.org_id;
  const canEdit = canSchedule(ctx.current.role);
  const operators = await loadOperators(orgId);
  const { data, error } = await sb.from('vacation_requests').select('id, name, start_date, end_date, status').eq('org_id', orgId).order('start_date');
  if (error) banner(false, 'Vacation not loaded: ' + explainError(error));
  let entries = (data || []).map(v => ({ id: v.id, name: v.name, start: v.start_date, end: v.end_date, status: v.status }));

  function render() {
    const rows = entries.slice().sort((a,b)=>a.start.localeCompare(b.start)).map(e => `
      <div class="row">
        <span>${e.name}<br><span style="color:#94a3b8;font-size:12px">${e.start} → ${e.end} · ${e.status}</span></span>
        <span>
          ${canEdit && e.status==='requested' ? `<button type="button" class="secondary ok-vac" data-id="${e.id}" style="width:auto;padding:4px 8px;font-size:12px">Approve</button>` : ''}
          <button type="button" class="secondary del-vac" data-id="${e.id}" style="width:auto;padding:4px 8px;font-size:12px">×</button>
        </span>
      </div>
    `).join('') || '<p style="color:#94a3b8;font-size:13px">No vacation requests.</p>';
    const names = operators.map(o => `<option>${o.name}</option>`).join('');
    app.innerHTML = `
      <p class="role">${ctx.current.organizations?.name||''}</p>
      <h1>Vacation</h1>
      <div class="panel">
        <h2 style="margin-top:0">Request</h2>
        <label>Operator</label>
        <input id="v-name" list="v-names" placeholder="Name" />
        <datalist id="v-names">${names}</datalist>
        <label>Start</label>
        <input id="v-start" type="date" value="${iso(new Date())}" />
        <label>End</label>
        <input id="v-end" type="date" value="${iso(new Date())}" />
        <button id="add-v">Request vacation</button>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Requests</h2>
        ${rows}
      </div>
    `;
    document.getElementById('add-v').onclick = async () => {
      const name = document.getElementById('v-name').value.trim();
      const start = document.getElementById('v-start').value;
      const end = document.getElementById('v-end').value;
      if (!name || !start || !end) return;
      const { data: row, error } = await sb.from('vacation_requests').insert({
        org_id: orgId, name, start_date: start, end_date: end, status: 'requested', created_by: ctx.session.user.id
      }).select('id').single();
      if (error) { banner(false, 'Vacation not saved: ' + explainError(error)); return; }
      entries.push({ id: row.id, name, start, end, status: 'requested' });
      banner(true, 'Vacation saved');
      render();
    };
    document.querySelectorAll('.ok-vac').forEach(b => b.onclick = async () => {
      if (!canEdit) { banner(false, 'No permission'); return; }
      const { data: approved, error } = await sb.from('vacation_requests').update({ status: 'approved' }).eq('id', b.dataset.id).select('id');
      if (error) { banner(false, 'Vacation not approved: ' + explainError(error)); return; }
      if (!approved?.length) { banner(false, 'No permission'); return; }
      const e = entries.find(x => x.id === b.dataset.id);
      if (e) e.status = 'approved';
      banner(true, 'Vacation approved');
      render();
    });
    document.querySelectorAll('.del-vac').forEach(b => b.onclick = async () => {
      const { error } = await sb.from('vacation_requests').delete().eq('id', b.dataset.id);
      if (error) { banner(false, 'Vacation not removed: ' + explainError(error)); return; }
      entries = entries.filter(e => e.id !== b.dataset.id);
      banner(true, 'Vacation removed');
      render();
    });
  }
  render();
}

// ---- Messages ----
async function initMessages() {
  loadNavbar('messages');
  const ctx = await requirePlant();
  if (!ctx) return;
  const app = document.getElementById('app');
  const orgId = ctx.current.org_id;
  const session = ctx.session;
  const operators = await loadOperators(orgId);
  const me = session.user.email || 'me';
  const myCrews = [...new Set(operators.filter(o =>
    (o.name||'').toLowerCase() === me.toLowerCase() ||
    (o.email||'').toLowerCase() === me.toLowerCase() ||
    (session.user.email||'').toLowerCase().includes((o.name||'').toLowerCase())
  ).map(o => o.crew).filter(Boolean))];
  const { data, error } = await sb.from('plant_messages').select('id, channel, author_name, body, created_at, author_id').eq('org_id', orgId).order('created_at');
  if (error) banner(false, 'Messages not loaded: ' + explainError(error));
  let messages = (data || []).map(m => ({ id: m.id, channel: m.channel, author: m.author_name || 'Operator', text: m.body, at: m.created_at, mine: m.author_id === session.user.id }));
  let channel = 'main';

  function canPost(ch) {
    if (ch === 'main') return true;
    if (!ch.startsWith('crew:')) return false;
    return myCrews.includes(ch.slice(5));
  }

  function render() {
    const tabs = ['main', ...myCrews.map(c => 'crew:'+c)];
    const tabBtns = tabs.map(t => {
      const label = t === 'main' ? 'All' : 'Crew ' + t.slice(5);
      return `<button type="button" class="crew-tab${t===channel?' active':''}" data-ch="${t}">${label}</button>`;
    }).join('');
    const allowed = canPost(channel);
    const list = messages.filter(m => m.channel === channel).map(m => `
      <div class="msg ${m.mine?'mine':''}">
        <div class="msg-meta">${m.author} · ${new Date(m.at).toLocaleString()}</div>
        <div class="msg-body">${m.text}</div>
      </div>
    `).join('') || '<p style="color:#94a3b8;font-size:13px">No messages yet.</p>';
    app.innerHTML = `
      <p class="role">${ctx.current.organizations?.name||''}</p>
      <h1>Messages</h1>
      <div class="crew-tabs">${tabBtns}</div>
      <div class="panel chat-panel">
        ${allowed ? list : '<p>You can only post in All and your own crew.</p>'}
      </div>
      ${allowed ? `
        <div class="panel" style="display:flex;gap:8px;align-items:center">
          <input id="msg-text" placeholder="Message…" style="margin:0" />
          <button id="send" style="width:auto;margin:0;padding:10px 16px">Send</button>
        </div>
      ` : ''}
    `;
    document.querySelectorAll('.crew-tab').forEach(b => b.onclick = () => { channel = b.dataset.ch; render(); });
    const send = document.getElementById('send');
    if (send) {
      const go = async () => {
        if (!canPost(channel)) { banner(false, 'No permission'); return; }
        const text = document.getElementById('msg-text').value.trim();
        if (!text) return;
        const { data: row, error } = await sb.from('plant_messages').insert({
          org_id: orgId,
          channel,
          author_id: session.user.id,
          author_name: me,
          body: text
        }).select('id, created_at').single();
        if (error) { banner(false, 'Message not sent: ' + explainError(error)); return; }
        messages.push({ id: row.id, channel, author: me, text, at: row.created_at, mine: true });
        banner(true, 'Message sent');
        render();
      };
      send.onclick = go;
      document.getElementById('msg-text').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
  }
  render();
}
