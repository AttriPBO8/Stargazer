// Unified calendar of upcoming sky events, filterable by category and priority.
import { esc, fmtDateYear, fmtTime, relDays, toDate, DAY, icsLink, store, HOUR } from '../util.js';
import { A } from '../astro.js';
import { lunarPhases, specialTags } from './moon.js';
import { eclipseData } from './eclipses.js';
import { showerList } from './meteors.js';
import { planetEvents } from './planets.js';
import { allPasses } from './satellites.js';
import { launchList } from './launches.js';

export const CATEGORIES = {
  moon: ['🌕', 'Moon'], eclipses: ['🌘', 'Eclipses'], meteors: ['☄️', 'Meteors'], planets: ['🪐', 'Planets'],
  aurora: ['🌌', 'Aurora'], satellites: ['🛰️', 'ISS'], darkness: ['🌍', 'Seasons'], launches: ['🚀', 'Launches'],
};

export function allEvents(ctx, days = 365) {
  const now = ctx.now, end = +now + days * DAY;
  const ev = [];
  for (const p of lunarPhases(now, Math.ceil(days / 30) + 1)) {
    if (p.t < now || +p.t > end || (p.quarter !== 0 && p.quarter !== 2)) continue;
    const tags = specialTags(p).map((t) => t[0]);
    ev.push({ t: p.t, cat: 'moon', icon: p.quarter === 2 ? '🌕' : '🌑', title: `${tags.length ? tags.join(' + ') + ' – ' : ''}${p.trad || p.name}`, detail: p.quarter === 2 ? 'Full Moon. Bright skies all night.' : 'New Moon. The darkest skies of the month, best for deep-sky viewing.', level: tags.length ? 'good' : 'info' });
  }
  const ecl = eclipseData(ctx.loc, now);
  for (const e of ecl.lunar) if (+e.peak > +now && +e.peak < end) ev.push({ t: e.peak, cat: 'eclipses', icon: '🌘', title: `${e.kind[0].toUpperCase() + e.kind.slice(1)} lunar eclipse`, detail: e.vis, level: e.visible ? 'good' : 'info', dim: !e.visible });
  for (const e of ecl.solar.local) if (+e.peak > +now && +e.peak < end) ev.push({ t: e.peak, cat: 'eclipses', icon: '☀️', title: `Solar eclipse, ${Math.round(e.obscuration * 100)}% covered here`, detail: 'Use certified eclipse glasses.', level: 'good' });
  for (const s of showerList(ctx.loc, now)) if (+s.peak > +now - DAY && +s.peak < end) ev.push({ t: s.peak, cat: 'meteors', icon: '☄️', title: `${s.name} peak`, detail: s.visible ? `~${Math.max(1, Math.round(s.best.rate))} meteors/hr from your location` : 'Radiant too low from your location', level: s.visible && s.best.rate >= 15 ? 'good' : 'info', dim: !s.visible });
  for (const e of planetEvents(now, days)) if (+e.t < end && !e.minor) ev.push(e);
  const y = new Date(now).getUTCFullYear();
  for (const yr of [y, y + 1]) {
    const s = A().Seasons(yr);
    for (const [k, t] of [['March equinox', s.mar_equinox], ['June solstice', s.jun_solstice], ['September equinox', s.sep_equinox], ['December solstice', s.dec_solstice]]) {
      const d = toDate(t);
      if (d > now && +d < end) ev.push({ t: d, cat: 'darkness', icon: '🌍', title: k, detail: ctx.loc.lat >= 0 ? '' : 'The seasons are reversed in the Southern Hemisphere.', level: 'info' });
    }
  }
  try {
    let ap = A().SearchPlanetApsis(A().Body.Earth, now);
    for (let i = 0; i < 2; i++) {
      const d = toDate(ap.time);
      if (+d < end) ev.push({ t: d, cat: 'darkness', icon: '🌍', title: `Earth at ${ap.kind === 0 ? 'perihelion (closest to the Sun)' : 'aphelion (farthest from the Sun)'}`, detail: `${ap.dist_au.toFixed(4)} AU`, level: 'info' });
      ap = A().NextPlanetApsis(A().Body.Earth, ap);
    }
  } catch { /* ignore */ }
  for (const r of ctx.data.kp?.value || []) {
    if (r.kp >= 5 && +r.t > +now && /pred/i.test(r.kind)) {
      if (!ev.some((e) => e.cat === 'aurora' && Math.abs(e.t - r.t) < 12 * HOUR)) ev.push({ t: r.t, cat: 'aurora', icon: '🌌', title: `Geomagnetic storm forecast (Kp ${r.kp.toFixed(1)})`, detail: 'Aurora may reach lower latitudes than usual.', level: 'good' });
    }
  }
  for (const s of allPasses(ctx) || []) for (const p of s.passes.filter((p) => p.max.el >= 30).slice(0, 3)) ev.push({ t: p.start.t, cat: 'satellites', icon: '🛰️', title: `${s.name} bright pass (max ${Math.round(p.max.el)}°)`, detail: `Appears at ${fmtTime(p.start.t)}`, level: 'ok' });
  for (const l of launchList(ctx).filter((l) => l.visible || l.jellyfish)) ev.push({ t: l.net, cat: 'launches', icon: '🚀', title: `Launch possibly visible: ${l.name}`, detail: `${Math.round(l.km)} km away`, level: 'good' });
  return ev.filter((e) => +e.t > +now - 6 * HOUR).sort((a, b) => a.t - b.t);
}

export default {
  id: 'events',
  title: 'Upcoming Sky Events',
  icon: '📅',
  needs: ['kp', 'tle', 'launches'],
  highlight(ctx) {
    const ev = allEvents(ctx, 30).filter((e) => e.level === 'good' && !e.dim);
    return ev[0] ? { level: 'good', text: `${ev[0].icon} ${ev[0].title}`, sub: relDays(ev[0].t, ctx.now) } : null;
  },
  render(el, ctx) {
    const f = store.get('eventFilter', { range: 90, priorityOnly: false, off: [] });
    const pri = new Set(ctx.prefs.priority);
    const ev = allEvents(ctx, f.range).filter((e) => !f.off.includes(e.cat) && (!f.priorityOnly || pri.has(e.cat)));
    el.innerHTML = `
      <div class="filters">
        ${Object.entries(CATEGORIES).map(([k, [i, n]]) => `<button class="chip ${f.off.includes(k) ? '' : 'on'}" data-cat="${k}" aria-pressed="${!f.off.includes(k)}">${i} ${n}${pri.has(k) ? ' ★' : ''}</button>`).join('')}
        <label class="chip-check"><input type="checkbox" data-prio ${f.priorityOnly ? 'checked' : ''}> ★ Priorities only</label>
        <select data-range aria-label="Time range">${[30, 90, 365].map((d) => `<option value="${d}" ${f.range === d ? 'selected' : ''}>Next ${d} days</option>`).join('')}</select>
      </div>
      ${ev.length ? `<ol class="timeline">${ev.map((e) => `<li class="${pri.has(e.cat) ? 'pri' : ''} ${e.dim ? 'dim' : ''} lvl-${e.level}">
        <time>${fmtDateYear(e.t)}<small>${fmtTime(e.t)} · ${relDays(e.t, ctx.now)}</small></time>
        <div><b>${e.icon} ${esc(e.title)}</b>${pri.has(e.cat) ? ' <span class="star-mini" title="In your priorities">★</span>' : ''}${e.detail ? `<br><small class="muted">${esc(e.detail)}</small>` : ''}</div>
        <a class="ics" download="event.ics" href="${icsLink(e.title, e.t, 60, e.detail)}" title="Add to calendar">📅</a></li>`).join('')}</ol>` : '<p class="muted">No events match these filters.</p>'}`;
    const save = (nf) => { store.set('eventFilter', nf); this.render(el, ctx); };
    el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.cat;
      save({ ...f, off: f.off.includes(k) ? f.off.filter((x) => x !== k) : [...f.off, k] });
    }));
    el.querySelector('[data-prio]').addEventListener('change', (e) => save({ ...f, priorityOnly: e.target.checked }));
    el.querySelector('[data-range]').addEventListener('change', (e) => save({ ...f, range: +e.target.value }));
  },
};
