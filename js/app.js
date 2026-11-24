// Stargazer: main controller. Handles location, preferences and priority ordering,
// data loading, the warning banner and rendering the cards.
import { esc, store, fetchJSON, setTimeZone, getTimeZone, fmtTime, fmtDateTime, levelClass, DAY, HOUR, relDays } from './util.js';
import { nightInfo } from './astro.js';
import * as api from './data.js';
import weather, { weatherWarnings } from './cards/weather.js';
import aurora, { auroraAssessment } from './cards/aurora.js';
import moon, { lunarPhases, specialTags } from './cards/moon.js';
import planets from './cards/planets.js';
import meteors, { showerList } from './cards/meteors.js';
import eclipses, { eclipseData } from './cards/eclipses.js';
import satellites, { allPasses } from './cards/satellites.js';
import darkness from './cards/darkness.js';
import events from './cards/events.js';
import sky from './cards/sky.js';
import launches from './cards/launches.js';
import spots, { findSpots } from './cards/spots.js';

const CARDS = [sky, weather, aurora, moon, planets, meteors, eclipses, satellites, darkness, spots, events, launches];
const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const WIDE = new Set(['sky', 'weather', 'events', 'spots']);
const DEFAULT_LOC = { lat: 51.4779, lon: -0.0015, name: 'Royal Observatory, Greenwich, UK', tz: 'Europe/London', elevation: 46, country: 'GB', isDefault: true };

// ------------------------------------------------------------------ state
const ctx = {
  loc: store.get('location') || null,
  now: new Date(),
  units: store.get('units', /^en-US$/.test(navigator.language) ? 'imperial' : 'metric'),
  prefs: normalizePrefs(store.get('prefs')),
  data: {},
  catalog: {},
  night: null,
  gen: 0, // bumps on every location change so late responses are ignored
  get tz() { return getTimeZone(); },
};

function normalizePrefs(p) {
  const ids = CARDS.map((c) => c.id);
  p = p || { order: ids, priority: [], hidden: [] };
  p.order = [...p.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !p.order.includes(id))];
  p.priority = (p.priority || []).filter((id) => ids.includes(id));
  p.hidden = (p.hidden || []).filter((id) => ids.includes(id));
  p.collapsed = p.collapsed || [];
  return p;
}
const savePrefs = () => store.set('prefs', ctx.prefs);

// ------------------------------------------------------------------ DOM refs
const $ = (s, r = document) => r.querySelector(s);
const pgrid = $('#pgrid'), rgrid = $('#rgrid');

// ------------------------------------------------------------------ rendering
function cardShell(card) {
  const pri = ctx.prefs.priority.includes(card.id);
  const idx = ctx.prefs.priority.indexOf(card.id);
  const collapsed = ctx.prefs.collapsed.includes(card.id);
  const sec = document.createElement('section');
  sec.className = `card ${WIDE.has(card.id) ? 'wide' : ''} ${pri ? 'is-priority' : ''} ${collapsed ? 'collapsed' : ''}`;
  sec.id = `card-${card.id}`;
  sec.dataset.id = card.id;
  sec.innerHTML = `
    <header class="card-head">
      <h3><span class="card-icon" aria-hidden="true">${card.icon}</span>${esc(card.title)}${pri ? `<span class="pri-badge" title="Priority #${idx + 1}">★ ${idx + 1}</span>` : ''}</h3>
      <div class="card-actions">
        ${pri ? `<button class="icon-btn" data-act="up" title="Move up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button><button class="icon-btn" data-act="down" title="Move down" aria-label="Move down" ${idx === ctx.prefs.priority.length - 1 ? 'disabled' : ''}>▼</button>` : ''}
        <button class="icon-btn star ${pri ? 'on' : ''}" data-act="star" title="${pri ? 'Remove from priorities' : 'Add to priorities (moves to top)'}" aria-pressed="${pri}">${pri ? '★' : '☆'}</button>
        <button class="icon-btn" data-act="collapse" title="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>
        <button class="icon-btn" data-act="hide" title="Hide this card" aria-label="Hide">✕</button>
      </div>
    </header>
    <div class="card-body"></div>`;
  sec.querySelector('.card-actions').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'star') togglePriority(card.id);
    if (act === 'hide') { ctx.prefs.hidden.push(card.id); ctx.prefs.priority = ctx.prefs.priority.filter((x) => x !== card.id); savePrefs(); layout(); toast(`${card.title} hidden. Restore it from Customize.`); }
    if (act === 'collapse') {
      const c = ctx.prefs.collapsed;
      ctx.prefs.collapsed = c.includes(card.id) ? c.filter((x) => x !== card.id) : [...c, card.id];
      savePrefs(); layout();
    }
    if (act === 'up' || act === 'down') movePriority(card.id, act === 'up' ? -1 : 1);
  });
  return sec;
}

function renderCard(id) {
  const sec = document.getElementById(`card-${id}`);
  if (!sec || sec.classList.contains('collapsed') || !ctx.night) return;
  const body = sec.querySelector('.card-body');
  try {
    BY_ID[id].render(body, ctx);
  } catch (err) {
    console.error(id, err);
    body.innerHTML = `<p class="err">Something went wrong rendering this section: ${esc(err.message)}</p>`;
  }
}

function layout() {
  const { priority, order, hidden } = ctx.prefs;
  pgrid.innerHTML = '';
  rgrid.innerHTML = '';
  for (const id of priority) if (!hidden.includes(id)) pgrid.appendChild(cardShell(BY_ID[id]));
  for (const id of order) if (!priority.includes(id) && !hidden.includes(id)) rgrid.appendChild(cardShell(BY_ID[id]));
  $('#priority-zone').classList.toggle('empty', priority.filter((id) => !hidden.includes(id)).length === 0);
  $('#rest-title').textContent = priority.length ? 'More sky events' : 'Sky events';
  for (const id of [...priority, ...order]) renderCard(id);
  renderHighlights();
  renderBanner();
}

function togglePriority(id) {
  const p = ctx.prefs.priority;
  ctx.prefs.priority = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
  savePrefs();
  layout();
  if (ctx.prefs.priority.includes(id)) document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function movePriority(id, dir) {
  const p = ctx.prefs.priority;
  const i = p.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.length) return;
  [p[i], p[j]] = [p[j], p[i]];
  savePrefs();
  layout();
}

function renderHighlights() {
  const el = $('#highlights');
  if (!ctx.night) return;
  const ids = ctx.prefs.priority.length ? ctx.prefs.priority.filter((id) => !ctx.prefs.hidden.includes(id)) : ['weather', 'moon', 'planets', 'aurora', 'meteors', 'satellites'];
  const items = [];
  for (const id of ids) {
    try {
      const h = BY_ID[id].highlight?.(ctx);
      if (h) items.push({ id, ...h });
    } catch (e) { console.warn('highlight', id, e); }
  }
  el.innerHTML = `
    <div class="hl-head"><h2>${ctx.prefs.priority.length ? '★ Your priorities at a glance' : 'Tonight at a glance'}</h2>
      ${ctx.prefs.priority.length ? '' : '<span class="muted small">Tip: tap ☆ on any section, or use <b>Customize</b>, to pin the events you care about to the top.</span>'}</div>
    <div class="hl-row">${items.map((h) => `<a class="hl ${levelClass(h.level)}" href="#card-${h.id}"><span class="hl-icon">${BY_ID[h.id].icon}</span><span><b>${esc(h.text)}</b>${h.sub ? `<small>${esc(h.sub)}</small>` : ''}</span></a>`).join('')}</div>`;
}

/** Banner = weather warnings + "good news" alerts for the user's priority events. */
function renderBanner() {
  const el = $('#banner');
  if (!ctx.night) return;
  const out = [];
  try { out.push(...weatherWarnings(ctx).filter((w) => w.level !== 'info')); } catch (e) { console.warn(e); }
  const pri = new Set(ctx.prefs.priority.length ? ctx.prefs.priority : ['aurora', 'eclipses', 'meteors', 'moon']);
  try {
    if (pri.has('aurora') && (ctx.data.ovation?.value || ctx.data.kp?.value)) {
      const a = auroraAssessment(ctx);
      if (a.score >= 2) out.push({ level: 'good', icon: '🌌', title: `Aurora alert: ${a.label} chance tonight`, text: `Forecast Kp ${a.maxTonight?.toFixed(1)} (you need about ${a.need}). Look ${ctx.loc.lat >= 0 ? 'north' : 'south'} after dark.` });
    }
    if (pri.has('meteors')) {
      const s = showerList(ctx.loc, ctx.now).find((x) => x.visible && Math.abs(x.peak - ctx.now) < 2 * DAY && x.best?.rate >= 8);
      if (s) out.push({ level: 'good', icon: '☄️', title: `${s.name} meteor shower peaks ${relDays(s.peak, ctx.now)}`, text: `Up to ~${Math.round(s.best.rate)} per hour from your location. Best around ${fmtTime(s.best.t)}.` });
    }
    if (pri.has('eclipses')) {
      const { lunar, solar } = eclipseData(ctx.loc, ctx.now);
      const e = [...lunar.filter((x) => x.visible), ...solar.local].find((x) => x.peak > ctx.now - 6 * HOUR && x.peak - ctx.now < 3 * DAY);
      if (e) out.push({ level: 'good', icon: '🌘', title: `${e.type === 'lunar' ? 'Lunar' : 'Solar'} eclipse ${relDays(e.peak, ctx.now)}`, text: `Peak at ${fmtDateTime(e.peak)}.${e.type === 'solar' ? ' Use certified eclipse glasses.' : ''}` });
    }
    if (pri.has('moon')) {
      const p = lunarPhases(ctx.now, 1).find((x) => x.t > ctx.now && x.t - ctx.now < 2 * DAY && specialTags(x).length);
      if (p) out.push({ level: 'good', icon: '🌕', title: `${specialTags(p).map((t) => t[0]).join(' + ')} ${relDays(p.t, ctx.now)}`, text: `${p.trad || p.name} at ${fmtDateTime(p.t)}.` });
    }
    if (pri.has('satellites')) {
      const iss = (allPasses(ctx) || []).find((s) => s.id === 25544);
      const p = iss?.passes.find((x) => x.max.el >= 40 && x.start.t - ctx.now < 24 * HOUR);
      if (p) out.push({ level: 'good', icon: '🛰️', title: `Bright ISS pass ${relDays(p.start.t, ctx.now)}`, text: `${fmtTime(p.start.t)}, reaching ${Math.round(p.max.el)}° high.` });
    }
  } catch (e) { console.warn('banner', e); }
  el.innerHTML = out.map((w) => `<div class="banner-item ${levelClass(w.level)}"><span class="b-icon">${w.icon}</span><div><b>${esc(w.title)}</b> <span>${esc(w.text)}</span>${w.source ? ` <small class="muted">(${esc(w.source)})</small>` : ''}</div></div>`).join('');
}

// ------------------------------------------------------------------ data loading
function setData(key, promise) {
  const gen = ctx.gen;
  ctx.data[key] = { status: 'loading' };
  rerenderFor(key);
  return promise.then(
    (value) => { if (gen === ctx.gen) ctx.data[key] = { status: 'ok', value }; },
    (err) => { console.warn(key, err); if (gen === ctx.gen) ctx.data[key] = { status: 'error', error: err?.name === 'AbortError' ? 'timed out' : err?.message || 'failed' }; },
  ).then(() => { if (gen === ctx.gen) rerenderFor(key); });
}

// Data that is only fetched when a card asks for it (e.g. when it scrolls into view).
const LAZY = {
  spots: () => findSpots(ctx.loc, store.get('spotRadius', 60)),
  spotsWx: () => api.multiCloud([ctx.loc, ...(ctx.data.spots?.value?.sites || []).slice(0, 12)]),
};
ctx.load = (key, force = false) => {
  if (!LAZY[key] || (!force && ctx.data[key])) return;
  setData(key, LAZY[key]());
};

let rerenderQueued = new Set();
let rerenderTimer = null;
function rerenderFor(key) {
  for (const c of CARDS) if (c.needs.includes(key)) rerenderQueued.add(c.id);
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    const ids = [...rerenderQueued];
    rerenderQueued = new Set();
    ids.forEach(renderCard);
    renderHighlights();
    renderBanner();
  }, 60);
}

function inUS(loc) {
  if (loc.country) return loc.country === 'US';
  return loc.lat > 18 && loc.lat < 72 && loc.lon > -180 && loc.lon < -64;
}

function loadData() {
  const loc = ctx.loc;
  setData('weather', api.weather(loc).then((w) => {
    if (w.timezone && !loc.tz) {
      loc.tz = w.timezone;
      store.set('location', loc);
      const url = new URL(location.href); url.searchParams.set('tz', loc.tz); history.replaceState(null, '', url);
      if (w.timezone !== getTimeZone()) { setTimeZone(w.timezone); refreshAll(); }
    }
    return w;
  }));
  setData('air', api.airQuality(loc));
  setData('seven', api.sevenTimer(loc));
  if (inUS(loc)) setData('nws', api.nwsAlerts(loc)); else ctx.data.nws = null;
  setData('ovation', api.ovation());
  setData('kp', api.kpForecast());
  setData('kpNow', api.kpNow());
  setData('wind', api.solarWind());
  setData('alerts', api.swpcAlerts());
  setData('tle', Promise.allSettled(api.SATELLITES.map((s) => api.tle(s.id))).then((res) => {
    const out = {};
    res.forEach((r, i) => { if (r.status === 'fulfilled') out[api.SATELLITES[i].id] = r.value; });
    if (!Object.keys(out).length) throw new Error(res[0].reason?.message || 'no TLE source reachable');
    return out;
  }));
  setData('launches', api.launches());
}

async function loadCatalog() {
  const files = ['stars', 'starnames', 'constellations', 'messier', 'milkyway'];
  const res = await Promise.allSettled(files.map((f) => fetchJSON(`data/${f}.json`)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') ctx.catalog[files[i]] = r.value; });
  rerenderFor('catalog');
}

// ------------------------------------------------------------------ location
function setLocation(loc, { persist = true } = {}) {
  ctx.loc = loc;
  if (persist) store.set('location', loc);
  setTimeZone(loc.tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const url = new URL(location.href);
  url.searchParams.set('lat', loc.lat.toFixed(4));
  url.searchParams.set('lon', loc.lon.toFixed(4));
  url.searchParams.set('name', loc.name);
  if (loc.tz) url.searchParams.set('tz', loc.tz); else url.searchParams.delete('tz');
  history.replaceState(null, '', url);
  ctx.gen++;
  ctx.data = {};
  refreshAll();
  loadData();
}

function refreshAll() {
  ctx.now = new Date();
  ctx.night = nightInfo(ctx.loc, ctx.now);
  renderLocLine();
  layout();
}

function renderLocLine() {
  const l = ctx.loc;
  $('#locline').innerHTML = `📍 <b>${esc(l.name)}</b> <span class="muted">${l.lat.toFixed(3)}°, ${l.lon.toFixed(3)}° · ${esc(getTimeZone())} · local time ${fmtTime(ctx.now)}</span>
    ${l.isDefault ? ' <em class="tag tag-warn">Default location: use 📍 or search to set yours</em>' : ''}`;
}

function useGeolocation() {
  if (!navigator.geolocation) return toast('Geolocation is not supported by this browser.');
  const btn = $('#locBtn');
  btn.disabled = true;
  btn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon, altitude } = pos.coords;
      let name = `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, country;
      try { const r = await api.reverseGeocode(lat, lon); if (r.name) name = r.name; country = r.country; } catch { /* keep coords */ }
      setLocation({ lat, lon, name, elevation: altitude || 0, country, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      btn.disabled = false; btn.textContent = '📍 My location';
    },
    (err) => {
      btn.disabled = false; btn.textContent = '📍 My location';
      toast(`Couldn't get your location (${err.message}). Search for a place instead.`);
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60e3 },
  );
}

function setupSearch() {
  const form = $('#search'), input = $('#searchInput'), list = $('#suggest');
  let timer, results = [];
  const show = (items) => {
    results = items;
    list.innerHTML = items.map((r, i) => `<li role="option" data-i="${i}" tabindex="-1">${esc(r.name)} <small class="muted">${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></li>`).join('');
    list.hidden = !items.length;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) return show([{ lat: +coord[1], lon: +coord[2], name: `${(+coord[1]).toFixed(3)}°, ${(+coord[2]).toFixed(3)}°` }]);
    if (q.length < 2) return show([]);
    timer = setTimeout(() => api.geocode(q).then(show).catch(() => show([])), 300);
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    pick(results[+li.dataset.i]);
  });
  const pick = (r) => { if (!r) return; input.value = ''; show([]); setLocation(r); };
  form.addEventListener('submit', (e) => { e.preventDefault(); if (results[0]) pick(results[0]); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') show([]); });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) list.hidden = true; });
}

// ------------------------------------------------------------------ customize dialog
function openCustomize() {
  const dlg = $('#customize');
  const draw = () => {
    const { priority, order, hidden } = ctx.prefs;
    const ordered = [...priority, ...order.filter((id) => !priority.includes(id))];
    $('#cust-list').innerHTML = ordered.map((id) => {
      const c = BY_ID[id];
      const pi = priority.indexOf(id);
      return `<li draggable="true" data-id="${id}" class="${pi >= 0 ? 'pri' : ''} ${hidden.includes(id) ? 'hid' : ''}">
        <span class="drag" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
        <span class="c-name">${c.icon} ${esc(c.title)}</span>
        <label title="Pin to top"><input type="checkbox" data-k="pri" ${pi >= 0 ? 'checked' : ''}> ★ Priority${pi >= 0 ? ` #${pi + 1}` : ''}</label>
        <label><input type="checkbox" data-k="show" ${hidden.includes(id) ? '' : 'checked'}> Show</label>
        <span class="mv"><button type="button" class="icon-btn" data-mv="-1" aria-label="Move up">▲</button><button type="button" class="icon-btn" data-mv="1" aria-label="Move down">▼</button></span>
      </li>`;
    }).join('');
  };
  const list = $('#cust-list');
  list.onchange = (e) => {
    const id = e.target.closest('li').dataset.id;
    const p = ctx.prefs;
    if (e.target.dataset.k === 'pri') p.priority = e.target.checked ? [...p.priority, id] : p.priority.filter((x) => x !== id);
    if (e.target.dataset.k === 'show') p.hidden = e.target.checked ? p.hidden.filter((x) => x !== id) : [...p.hidden, id];
    savePrefs(); draw(); layout();
  };
  const move = (id, dir) => {
    const p = ctx.prefs;
    const arr = p.priority.includes(id) ? p.priority : p.order;
    const i = arr.indexOf(id);
    let j = i + dir;
    if (arr === p.order) { while (j >= 0 && j < arr.length && p.priority.includes(arr[j])) j += dir; }
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    savePrefs(); draw(); layout();
  };
  list.onclick = (e) => { const b = e.target.closest('[data-mv]'); if (b) move(b.closest('li').dataset.id, +b.dataset.mv); };
  // Drag & drop: dropping into the priority block makes the item a priority at that position.
  let dragId = null;
  list.ondragstart = (e) => { dragId = e.target.closest('li')?.dataset.id; e.dataTransfer.effectAllowed = 'move'; };
  list.ondragover = (e) => { e.preventDefault(); list.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); e.target.closest('li')?.classList.add('over'); };
  list.ondrop = (e) => {
    e.preventDefault();
    const target = e.target.closest('li')?.dataset.id;
    if (!dragId || !target || dragId === target) return;
    const p = ctx.prefs;
    if (p.priority.includes(target)) {
      p.priority = p.priority.filter((x) => x !== dragId);
      p.priority.splice(p.priority.indexOf(target), 0, dragId);
    } else {
      p.priority = p.priority.filter((x) => x !== dragId);
      p.order = p.order.filter((x) => x !== dragId);
      p.order.splice(p.order.indexOf(target), 0, dragId);
    }
    savePrefs(); draw(); layout();
  };
  $('#cust-reset').onclick = () => { ctx.prefs = normalizePrefs(null); savePrefs(); draw(); layout(); };
  draw();
  dlg.showModal();
}

// ------------------------------------------------------------------ misc UI
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4500);
}

function setupToolbar() {
  $('#locBtn').addEventListener('click', useGeolocation);
  $('#custBtn').addEventListener('click', openCustomize);
  $('#cust-close').addEventListener('click', () => $('#customize').close());
  const unitsBtn = $('#unitsBtn');
  const showUnits = () => (unitsBtn.textContent = ctx.units === 'metric' ? '°C · km' : '°F · mi');
  showUnits();
  unitsBtn.addEventListener('click', () => { ctx.units = ctx.units === 'metric' ? 'imperial' : 'metric'; store.set('units', ctx.units); showUnits(); layout(); });
  const red = store.get('redMode', false);
  document.documentElement.classList.toggle('red-mode', red);
  $('#redBtn').setAttribute('aria-pressed', red);
  $('#redBtn').addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('red-mode');
    document.documentElement.classList.toggle('red-mode', on);
    $('#redBtn').setAttribute('aria-pressed', on);
    store.set('redMode', on);
  });
  $('#shareBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied. It opens Stargazer at this location.'); } catch { toast(location.href); }
  });
  $('#refreshBtn').addEventListener('click', () => { refreshAll(); loadData(); toast('Refreshing data…'); });
}

// ------------------------------------------------------------------ boot
function waitForLibs() {
  return new Promise((resolve) => {
    const ok = () => window.Astronomy && window.satellite;
    if (ok()) return resolve();
    const i = setInterval(() => { if (ok()) { clearInterval(i); resolve(); } }, 30);
  });
}

async function boot() {
  await waitForLibs();
  setupToolbar();
  setupSearch();
  loadCatalog();
  const q = new URLSearchParams(location.search);
  if (q.has('lat') && q.has('lon') && !isNaN(+q.get('lat')) && !isNaN(+q.get('lon'))) {
    const lat = +q.get('lat'), lon = +q.get('lon');
    const same = ctx.loc && Math.abs(ctx.loc.lat - lat) < 1e-3 && Math.abs(ctx.loc.lon - lon) < 1e-3;
    setLocation(same ? ctx.loc : { lat, lon, name: q.get('name') || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, tz: q.get('tz') || undefined });
  } else if (ctx.loc) {
    setLocation(ctx.loc);
  } else {
    setLocation(DEFAULT_LOC, { persist: false });
    useGeolocation();
  }
  // Keep things fresh: recompute astronomy every 5 min, refetch network data every 15 min.
  setInterval(refreshAll, 5 * 60e3);
  setInterval(loadData, 15 * 60e3);
  setInterval(renderLocLine, 30e3);
}

boot();
