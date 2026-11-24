// Solar & lunar eclipses with local visibility, computed by Astronomy Engine.
import { esc, fmtDateYear, fmtTime, relDays, toDate, icsLink, DAY } from '../util.js';
import { A, observer, moonAlt } from '../astro.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const memo = new Map();

export function lunarEclipses(loc, now, count = 6) {
  const obs = observer(loc);
  const out = [];
  let e = A().SearchLunarEclipse(new Date(+now - DAY));
  for (let i = 0; i < count; i++) {
    const peak = toDate(e.peak);
    const semi = e.sd_partial || e.sd_penum;
    const start = new Date(+peak - semi * 60e3), end = new Date(+peak + semi * 60e3);
    const alts = [start, peak, end].map((t) => moonAlt(t, obs));
    const vis = alts[1] > 0 && alts[0] > 0 && alts[2] > 0 ? 'Fully visible' : alts.some((a) => a > 0) ? 'Partly visible' : 'Not visible here';
    out.push({ type: 'lunar', kind: e.kind, peak, start, end, totalMin: e.sd_total * 2, partialMin: e.sd_partial * 2, obscuration: e.obscuration, vis, visible: vis !== 'Not visible here', moonAltPeak: alts[1] });
    e = A().NextLunarEclipse(e.peak);
  }
  return out;
}

export function solarEclipses(loc, now, count = 6) {
  const obs = observer(loc);
  const global = [];
  let g = A().SearchGlobalSolarEclipse(new Date(+now - DAY));
  for (let i = 0; i < count; i++) {
    global.push({ type: 'solar', kind: g.kind, peak: toDate(g.peak), lat: g.latitude, lon: g.longitude });
    g = A().NextGlobalSolarEclipse(g.peak);
  }
  const local = [];
  let l = A().SearchLocalSolarEclipse(new Date(+now - DAY), obs);
  for (let i = 0; i < 12 && local.length < 3; i++) {
    const alts = [l.partial_begin, l.peak, l.partial_end].map((x) => x.altitude);
    if (alts.some((a) => a > 0)) {
      local.push({ type: 'solar', kind: l.kind, peak: toDate(l.peak.time), start: toDate(l.partial_begin.time), end: toDate(l.partial_end.time), obscuration: l.obscuration, sunAlt: l.peak.altitude, partlyBelow: alts.some((a) => a <= 0) });
    }
    l = A().NextLocalSolarEclipse(l.peak.time, obs);
  }
  return { global, local };
}

export function eclipseData(loc, now) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${Math.floor(+now / DAY)}`;
  if (!memo.has(key)) { memo.clear(); memo.set(key, { lunar: lunarEclipses(loc, now), solar: solarEclipses(loc, now) }); }
  return memo.get(key);
}

export default {
  id: 'eclipses',
  title: 'Eclipses',
  icon: '🌘',
  needs: [],
  highlight(ctx) {
    const { lunar, solar } = eclipseData(ctx.loc, ctx.now);
    const cands = [...lunar.filter((e) => e.visible).map((e) => ({ ...e, label: `${cap(e.kind)} lunar eclipse` })), ...solar.local.map((e) => ({ ...e, label: `${Math.round(e.obscuration * 100)}% solar eclipse` }))].filter((e) => e.peak > ctx.now - DAY).sort((a, b) => a.peak - b.peak);
    const n = cands[0];
    return n ? { level: +n.peak - +ctx.now < 30 * DAY ? 'good' : 'info', text: `Next visible eclipse: ${n.label}`, sub: `${fmtDateYear(n.peak)} (${relDays(n.peak, ctx.now)})` } : null;
  },
  render(el, ctx) {
    const { lunar, solar } = eclipseData(ctx.loc, ctx.now);
    el.innerHTML = `
      <h4>Lunar eclipses</h4>
      <ul class="list">${lunar.map((e) => `<li class="${e.visible ? '' : 'dim'}"><span>🌕 <b>${cap(e.kind)} lunar eclipse</b> · <em class="tag ${e.visible ? 'tag-good' : ''}">${e.vis}</em><br>
        <small class="muted">${e.kind === 'total' ? `Totality ${Math.round(e.totalMin)} min · ` : ''}${e.partialMin ? `Partial phase ${Math.round(e.partialMin)} min · ` : ''}Peak ${fmtTime(e.peak)} (Moon ${Math.round(e.moonAltPeak)}° ${e.moonAltPeak > 0 ? 'up' : 'below horizon'})</small></span>
        <span class="nowrap">${fmtDateYear(e.peak)}<br><small class="muted">${relDays(e.peak, ctx.now)}</small> ${e.visible ? `<a class="ics" download="eclipse.ics" href="${icsLink(`${cap(e.kind)} lunar eclipse`, e.start, (e.end - e.start) / 60000)}">📅</a>` : ''}</span></li>`).join('')}</ul>

      <h4>Solar eclipses visible from your location</h4>
      ${solar.local.length ? `<ul class="list">${solar.local.map((e) => `<li><span>☀️ <b>${cap(e.kind)} solar eclipse</b> · ${Math.round(e.obscuration * 100)}% of the Sun covered<br>
        <small class="muted">${fmtTime(e.start)} – ${fmtTime(e.end)}, peak ${fmtTime(e.peak)} with the Sun ${Math.round(e.sunAlt)}° up${e.partlyBelow ? ' (Sun below the horizon for part of it)' : ''}</small></span>
        <span class="nowrap">${fmtDateYear(e.peak)}<br><small class="muted">${relDays(e.peak, ctx.now)}</small> <a class="ics" download="eclipse.ics" href="${icsLink(`Solar eclipse (${Math.round(e.obscuration * 100)}%)`, e.start, (e.end - e.start) / 60000, 'Use certified ISO 12312-2 eclipse glasses.')}">📅</a></span></li>`).join('')}</ul>` : '<p class="muted">No solar eclipses visible from here in the coming decades of search range.</p>'}

      <h4>Next solar eclipses worldwide</h4>
      <ul class="list">${solar.global.map((e) => `<li><span>🌍 <b>${cap(e.kind)}</b>${e.lat != null && !isNaN(e.lat) ? ` <small class="muted">greatest eclipse near ${e.lat.toFixed(0)}°, ${e.lon.toFixed(0)}°</small>` : ''}</span><span>${fmtDateYear(e.peak)}</span></li>`).join('')}</ul>
      <p class="warn-inline">⚠️ Never look at the Sun without certified ISO 12312-2 eclipse glasses or a proper solar filter. Sunglasses are not safe.</p>`;
  },
};
