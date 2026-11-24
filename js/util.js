// Shared helpers: formatting, caching, fetching, math.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const norm360 = (x) => ((x % 360) + 360) % 360;
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

/** Escape text for safe insertion into innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Convert an Astronomy Engine AstroTime (or Date / ms) to a JS Date. */
export function toDate(t) {
  if (!t) return null;
  if (t instanceof Date) return t;
  if (typeof t === 'number') return new Date(t);
  if (t.date) return t.date;
  return new Date(t);
}

// ---- Time formatting in the *location's* time zone -------------------------
let currentTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function setTimeZone(tz) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    currentTZ = tz;
  } catch {
    /* keep browser zone */
  }
}
export const getTimeZone = () => currentTZ;

const fmtCache = new Map();
function fmt(opts) {
  const key = currentTZ + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(undefined, { timeZone: currentTZ, ...opts }));
  return fmtCache.get(key);
}
export const fmtTime = (d) => (d ? fmt({ hour: 'numeric', minute: '2-digit' }).format(toDate(d)) : '—');
export const fmtDate = (d) => (d ? fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(toDate(d)) : '—');
export const fmtDateYear = (d) => (d ? fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(toDate(d)) : '—');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—');
export const fmtHour = (d) => fmt({ hour: 'numeric' }).format(toDate(d));
export const fmtWeekday = (d) => fmt({ weekday: 'short' }).format(toDate(d));

/** Calendar parts (year, month, day, hour) of a date in the location's time zone. */
export function localParts(d) {
  const parts = fmt({ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(toDate(d));
  const o = {};
  for (const p of parts) if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
}

export function relDays(d, now = new Date()) {
  const ms = toDate(d) - now;
  const days = Math.round(ms / DAY);
  if (Math.abs(ms) < 12 * HOUR) {
    const h = Math.round(ms / HOUR);
    if (h === 0) return 'now';
    return h > 0 ? `in ${h} h` : `${-h} h ago`;
  }
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function fmtDuration(ms) {
  if (ms <= 0) return '0 min';
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export const compass = (az) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(norm360(az) / 22.5) % 16];

// ---- Storage (wrapped: may be unavailable in private mode) -----------------
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('stargazer:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('stargazer:' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

/**
 * fetch JSON with a timeout and an optional localStorage cache (ttl in ms).
 * Cached copies are also used as a fallback when the network request fails.
 */
export async function fetchJSON(url, { ttl = 0, timeout = 15000, text = false } = {}) {
  const key = 'cache:' + url;
  const cached = ttl ? store.get(key) : null;
  if (cached && Date.now() - cached.t < ttl) return cached.v;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = text ? await res.text() : await res.json();
    if (ttl) store.set(key, { t: Date.now(), v });
    return v;
  } catch (err) {
    if (cached) return cached.v; // stale but better than nothing
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Simple level → css class mapping used across cards. */
export const levelClass = (lvl) => ({ good: 'lvl-good', ok: 'lvl-ok', warn: 'lvl-warn', bad: 'lvl-bad', info: 'lvl-info' }[lvl] || 'lvl-info');

/** Build a downloadable .ics calendar entry. */
export function icsLink(title, start, durationMin = 60, description = '') {
  const s = toDate(start);
  const e = new Date(s.getTime() + durationMin * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const clean = (t) => String(t).replace(/[\r\n]+/g, ' ').replace(/([,;])/g, '\\$1');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stargazer//EN',
    'BEGIN:VEVENT',
    `UID:${f(s)}-${Math.random().toString(36).slice(2)}@stargazer`,
    `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(s)}`,
    `DTEND:${f(e)}`,
    `SUMMARY:${clean(title)}`,
    `DESCRIPTION:${clean(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

/** Responsive HTML bar chart. values: (number|null)[]; returns html string. */
export function barChart(values, { max = 100, height = 64, colorFn = () => 'var(--accent)', labels = [], title = '', unit = '' } = {}) {
  const step = Math.max(1, Math.ceil(values.length / 8));
  const bars = values
    .map((v, i) => {
      const pct = v == null ? 0 : (clamp(v, 0, max) / max) * 100;
      const tip = `${labels[i] ?? ''}: ${v == null ? 'n/a' : Math.round(v) + unit}`;
      return `<div class="bar" title="${esc(tip)}"><i style="height:${Math.max(pct, v ? 2 : 0)}%;background:${colorFn(v, i)}"></i></div>`;
    })
    .join('');
  const ticks = values.map((_, i) => `<span>${i % step === 0 ? esc(labels[i] ?? '') : ''}</span>`).join('');
  return `<div class="bars" role="img" aria-label="${esc(title)}" style="height:${height}px">${bars}</div><div class="bar-ticks">${ticks}</div>`;
}
