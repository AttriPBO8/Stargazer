// Visible passes of the ISS, Tiangong and Hubble, computed in the browser with
// satellite.js (SGP4) from free TLE data. A pass is "visible" when the satellite
// is sunlit while your sky is dark.
/* global satellite */
import { esc, fmtTime, fmtDate, relDays, compass, DEG, RAD, DAY, icsLink, distanceKm } from '../util.js';
import { A, observer, sunAlt } from '../astro.js';
import { SATELLITES } from '../data.js';

const AU = 149597870.7, RE = 6371;

function sunlit(posKm, d) {
  const s = A().GeoVector(A().Body.Sun, d, false);
  const len = Math.hypot(s.x, s.y, s.z);
  const u = [s.x / len, s.y / len, s.z / len];
  const dot = posKm.x * u[0] + posKm.y * u[1] + posKm.z * u[2];
  if (dot > 0) return true;
  const perp = Math.hypot(posKm.x - dot * u[0], posKm.y - dot * u[1], posKm.z - dot * u[2]);
  return perp > RE;
}

export function computePasses(lines, loc, now, days = 5, stdMag = 0) {
  const sl = window.satellite;
  const rec = sl.twoline2satrec(lines[0], lines[1]);
  const gd = { longitude: loc.lon * DEG, latitude: loc.lat * DEG, height: (loc.elevation || 0) / 1000 };
  const obs = observer(loc);
  const passes = [];
  let cur = null;
  const step = 20e3;
  for (let t = +now; t < +now + days * DAY; t += step) {
    const d = new Date(t);
    const pv = sl.propagate(rec, d);
    if (!pv || !pv.position) continue;
    const gmst = sl.gstime(d);
    const look = sl.ecfToLookAngles(gd, sl.eciToEcf(pv.position, gmst));
    const el = look.elevation * RAD;
    if (el > 10) {
      if (!cur) cur = { samples: [] };
      const vis = sunAlt(d, obs) < -6 && sunlit(pv.position, d);
      const mag = stdMag + 5 * Math.log10(look.rangeSat / 1000);
      cur.samples.push({ t: d, el, az: look.azimuth * RAD, vis, mag });
    } else if (cur) {
      const vs = cur.samples.filter((s) => s.vis);
      if (vs.length >= 3) {
        const max = vs.reduce((a, b) => (b.el > a.el ? b : a));
        passes.push({ start: vs[0], max, end: vs[vs.length - 1], mag: Math.min(...vs.map((s) => s.mag)), duration: vs[vs.length - 1].t - vs[0].t });
      }
      cur = null;
    }
  }
  // current ground position
  const pv = sl.propagate(rec, now);
  let sub = null;
  if (pv?.position) {
    const g = sl.eciToGeodetic(pv.position, sl.gstime(now));
    sub = { lat: sl.degreesLat(g.latitude), lon: sl.degreesLong(g.longitude), height: g.height };
  }
  return { passes, sub };
}

const memo = new Map();
export function allPasses(ctx) {
  const tles = ctx.data.tle?.value;
  if (!tles) return null;
  const key = `${ctx.loc.lat},${ctx.loc.lon},${Math.floor(+ctx.now / 300e3)}`;
  if (memo.has(key)) return memo.get(key);
  const out = SATELLITES.filter((s) => tles[s.id]).map((s) => ({ ...s, ...computePasses(tles[s.id], ctx.loc, ctx.now, 5, s.stdMag) }));
  memo.clear();
  memo.set(key, out);
  return out;
}

export default {
  id: 'satellites',
  title: 'ISS & Bright Satellites',
  icon: '🛰️',
  needs: ['tle'],
  highlight(ctx) {
    const all = allPasses(ctx);
    if (!all) return null;
    const iss = all.find((s) => s.id === 25544);
    const p = iss?.passes[0];
    if (!p) return { level: 'info', text: 'No visible ISS passes in the next 5 days', sub: '' };
    return { level: p.max.el > 40 ? 'good' : 'ok', text: `ISS pass ${fmtDate(p.start.t)} ${fmtTime(p.start.t)}`, sub: `Max ${Math.round(p.max.el)}°, ${compass(p.start.az)} → ${compass(p.end.az)}` };
  },
  render(el, ctx) {
    const st = ctx.data.tle;
    if (!st || st.status === 'loading') return (el.innerHTML = '<div class="skeleton">Fetching orbital elements…</div>');
    if (st.status === 'error') return (el.innerHTML = `<p class="err">Couldn't load satellite orbit data (${esc(st.error)}).</p>`);
    const all = allPasses(ctx) || [];
    el.innerHTML = all.map((s) => `
      <h4>${esc(s.full)}${s.sub ? ` <small class="muted">now over ${s.sub.lat.toFixed(1)}°, ${s.sub.lon.toFixed(1)}° · ${Math.round(distanceKm(ctx.loc.lat, ctx.loc.lon, s.sub.lat, s.sub.lon)).toLocaleString()} km away</small>` : ''}</h4>
      ${s.passes.length ? `<div class="table-scroll"><table class="list-table">
        <thead><tr><th>Date</th><th>Appears</th><th>Highest</th><th>Disappears</th><th>Brightness</th><th></th></tr></thead>
        <tbody>${s.passes.slice(0, 6).map((p) => `<tr class="${p.max.el > 40 ? 'row-hl' : ''}">
          <td>${fmtDate(p.start.t)}<br><small class="muted">${relDays(p.start.t, ctx.now)}</small></td>
          <td>${fmtTime(p.start.t)}<br><small>${compass(p.start.az)} · ${Math.round(p.start.el)}°</small></td>
          <td>${fmtTime(p.max.t)}<br><small>${compass(p.max.az)} · <b>${Math.round(p.max.el)}°</b></small></td>
          <td>${fmtTime(p.end.t)}<br><small>${compass(p.end.az)} · ${Math.round(p.end.el)}°</small></td>
          <td>~mag ${p.mag.toFixed(1)}<br><small class="muted">${Math.round(p.duration / 60000)} min</small></td>
          <td><a class="ics" download="pass.ics" href="${icsLink(`${s.name} pass – look ${compass(p.start.az)}`, p.start.t, Math.max(2, Math.round(p.duration / 60000)), `Rises in the ${compass(p.start.az)}, max ${Math.round(p.max.el)}° in the ${compass(p.max.az)}`)}">📅</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No visible passes in the next 5 days.</p>'}`).join('') +
      '<p class="muted small">Satellites look like steady, fast-moving stars and do not blink. They can fade out suddenly as they enter Earth\'s shadow. Orbits come from free TLE data (CelesTrak) and are propagated on your device. Times can shift by a minute or so after a reboost.</p>';
  },
};
