// Planets: tonight's visibility plus oppositions, elongations and conjunctions.
import { esc, fmtTime, fmtDateYear, relDays, compass, toDate, DAY, HOUR, icsLink } from '../util.js';
import { A, observer, bodyHorizon, sunAlt } from '../astro.js';

export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const ICON = { Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '⛢', Neptune: '♆', Moon: '☾' };
const NOTE = {
  Mercury: 'Elusive. It only shows low in twilight near its greatest elongation.',
  Venus: 'The brightest planet. Binoculars show its phase.',
  Mars: 'Reddish. Look for surface detail near opposition.',
  Jupiter: 'Binoculars show its four Galilean moons.',
  Saturn: 'A small telescope shows its rings.',
  Uranus: 'Needs binoculars and a finder chart.',
  Neptune: 'Needs a telescope.',
};

/** Tonight's visibility for each planet (sun below −6°). */
const tonightMemo = new Map();
export function planetsTonight(loc, night, now) {
  const k = `${loc.lat},${loc.lon},${+night.winStart},${Math.floor(+now / 600e3)}`;
  if (!tonightMemo.has(k)) { tonightMemo.clear(); tonightMemo.set(k, computeTonight(loc, night, now)); }
  return tonightMemo.get(k);
}
function computeTonight(loc, night, now) {
  const obs = observer(loc);
  const from = night.civil.dusk || night.winStart;
  const to = night.civil.dawn || night.winEnd;
  return PLANETS.map((name) => {
    const body = A().Body[name];
    const illum = A().Illumination(body, now);
    const elong = A().Elongation(body, now);
    const eq = A().Equator(body, now, obs, true, true);
    let best = null, firstUp = null, lastUp = null;
    for (let t = +from; t <= +to; t += 15 * 60e3) {
      const d = new Date(t);
      const h = bodyHorizon(body, d, obs);
      if (h.alt > 8 && sunAlt(d, obs) < -6) {
        if (!firstUp) firstUp = d;
        lastUp = d;
        if (!best || h.alt > best.alt) best = { alt: h.alt, az: h.az, t: d };
      }
    }
    const nakedEye = illum.mag < 5.5;
    let when = 'Not visible tonight';
    if (best) {
      const span = lastUp - firstUp;
      const mid = new Date((+from + +to) / 2);
      if (span > (to - from) * 0.75) when = 'Visible most of the night';
      else if (lastUp <= mid) when = 'Evening sky';
      else if (firstUp >= mid) when = 'Morning sky';
      else when = 'Late evening to early morning';
    } else if (elong.elongation < 15) when = 'Too close to the Sun';
    const now_h = bodyHorizon(body, now, obs);
    return {
      name, icon: ICON[name], mag: illum.mag, elong: elong.elongation, visibility: elong.visibility,
      con: A().Constellation(eq.ra, eq.dec).name, best, firstUp, lastUp, when, nakedEye, note: NOTE[name], altNow: now_h.alt, azNow: now_h.az,
      rise: toDate(A().SearchRiseSet(body, obs, +1, now, 1)), set: toDate(A().SearchRiseSet(body, obs, -1, now, 1)),
    };
  });
}

const memo = new Map();
/** Planet events for the next `days` days (cached per day). */
export function planetEvents(now, days = 365) {
  const key = `${Math.floor(+now / DAY)}:${days}`;
  if (memo.has(key)) return memo.get(key);
  const end = +now + days * DAY;
  const out = [];
  // Oppositions
  for (const name of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    try {
      const t = toDate(A().SearchRelativeLongitude(A().Body[name], 0, now));
      if (+t < end) out.push({ t, cat: 'planets', icon: ICON[name], title: `${name} at opposition`, detail: `${name} is opposite the Sun: closest, brightest and up all night (mag ${A().Illumination(A().Body[name], t).mag.toFixed(1)}).`, level: 'good' });
    } catch { /* ignore */ }
  }
  // Greatest elongations for inferior planets
  for (const name of ['Mercury', 'Venus']) {
    let t0 = now;
    for (let i = 0; i < 8; i++) {
      try {
        const e = A().SearchMaxElongation(A().Body[name], t0);
        const t = toDate(e.time);
        if (+t > end) break;
        out.push({ t, cat: 'planets', icon: ICON[name], title: `${name} at greatest ${e.visibility} elongation`, detail: `${e.elongation.toFixed(1)}° from the Sun. The best time to spot ${name} in the ${e.visibility} twilight sky.`, level: 'ok' });
        t0 = new Date(+t + 10 * DAY);
      } catch { break; }
    }
  }
  out.push(...conjunctions(now, Math.min(days, 200)));
  out.sort((a, b) => a.t - b.t);
  memo.set(key, out);
  return out;
}

function conjunctions(now, days) {
  const bodies = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
  const Bd = A().Body;
  const stepH = 3;
  const times = [];
  for (let t = +now; t < +now + days * DAY; t += stepH * HOUR) times.push(t);
  // Geocentric vectors for every body at every step, computed once.
  const vecs = Object.fromEntries(bodies.map((b) => [b, times.map((t) => A().GeoVector(Bd[b], new Date(t), true))]));
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const moon = a === 'Moon';
      const stride = moon ? 1 : 8; // planets move slowly: daily sampling is plenty
      const thresh = moon ? 3 : 2;
      const series = [];
      for (let k = 0; k < times.length; k += stride) series.push([times[k], A().AngleBetween(vecs[a][k], vecs[b][k])]);
      for (let k = 1; k < series.length - 1; k++) {
        const [t, s] = series[k];
        if (s < thresh && s <= series[k - 1][1] && s <= series[k + 1][1]) {
          let bestT = t, bestS = s;
          const span = stride * stepH;
          for (let u = t - span * HOUR; u <= t + span * HOUR; u += HOUR) {
            const v = A().AngleBetween(A().GeoVector(Bd[a], new Date(u), true), A().GeoVector(Bd[b], new Date(u), true));
            if (v < bestS) { bestS = v; bestT = u; }
          }
          const d = new Date(bestT);
          const sunSep = Math.min(A().AngleFromSun(Bd[b], d), moon ? 999 : A().AngleFromSun(Bd[a], d));
          if (sunSep < 15) continue; // lost in the Sun's glare
          const great = bestS < 1;
          out.push({
            t: d, cat: 'planets', icon: '✨', title: `${moon ? 'Moon' : a} ${great ? 'very close to' : 'near'} ${b}`,
            detail: `${bestS.toFixed(1)}° apart${moon ? ". Your fist at arm's length is about 10°" : '. A beautiful pairing in binoculars'}.`, level: great ? 'good' : 'ok', minor: moon && !great,
          });
        }
      }
    }
  }
  return out;
}

export default {
  id: 'planets',
  title: 'Planets',
  icon: '🪐',
  needs: [],
  highlight(ctx) {
    const list = planetsTonight(ctx.loc, ctx.night, ctx.now).filter((p) => p.best && p.nakedEye);
    if (!list.length) return { level: 'info', text: 'No bright planets up tonight', sub: '' };
    return { level: list.length >= 4 ? 'good' : 'ok', text: `${list.length >= 4 ? 'Planet parade: ' : ''}${list.map((p) => p.name).join(', ')} visible tonight`, sub: list[0] ? `${list[0].name} best at ${fmtTime(list[0].best.t)}` : '' };
  },
  render(el, ctx) {
    const list = planetsTonight(ctx.loc, ctx.night, ctx.now);
    const visible = list.filter((p) => p.best && p.nakedEye);
    const events = planetEvents(ctx.now, 365).filter((e) => !e.minor).slice(0, 14);
    el.innerHTML = `
      ${visible.length >= 4 ? `<p class="tip">🎉 <b>Planet parade!</b> ${visible.length} naked-eye planets are visible tonight: ${visible.map((p) => p.name).join(', ')}.</p>` : ''}
      <div class="table-scroll"><table class="list-table planets">
        <thead><tr><th>Planet</th><th>Tonight</th><th>Best view</th><th>Mag</th><th>Constellation</th><th>Rise / Set</th></tr></thead>
        <tbody>${list.map((p) => `<tr class="${p.best ? '' : 'dim'}">
          <td><span class="pl-icon">${p.icon}</span> <b>${p.name}</b><br><small class="muted">${esc(p.note)}</small></td>
          <td>${p.best ? '✅' : '—'} ${esc(p.when)}${p.best && !p.nakedEye ? ' <small>(optics needed)</small>' : ''}</td>
          <td>${p.best ? `${fmtTime(p.best.t)}<br><small>${p.best.alt.toFixed(0)}° high, ${compass(p.best.az)}</small>` : '—'}</td>
          <td>${p.mag.toFixed(1)}</td><td>${esc(p.con)}</td>
          <td><small>↑ ${fmtTime(p.rise)}<br>↓ ${fmtTime(p.set)}</small></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Magnitude: lower is brighter. Your eyes reach about mag 6 under dark skies, but only about 3–4 in a city.</p>
      <h4>Upcoming planetary events</h4>
      <ul class="list">${events.map((e) => `<li><span>${e.icon} <b>${esc(e.title)}</b><br><small class="muted">${esc(e.detail)}</small></span><span class="nowrap">${fmtDateYear(e.t)}<br><small class="muted">${relDays(e.t, ctx.now)}</small> <a class="ics" download="event.ics" href="${icsLink(e.title, e.t, 60, e.detail)}" title="Add to calendar">📅</a></span></li>`).join('')}</ul>`;
  },
};
