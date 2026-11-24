// Moon phase, rise/set, upcoming phases, supermoons, blue/black moons — all computed locally.
import { esc, fmtTime, fmtDate, fmtDateTime, fmtDateYear, relDays, localParts, toDate, DEG, DAY, icsLink } from '../util.js';
import { A, moonInfo, phaseEmoji } from '../astro.js';

const NAMES = ['Wolf Moon', 'Snow Moon', 'Worm Moon', 'Pink Moon', 'Flower Moon', 'Strawberry Moon', 'Buck Moon', 'Sturgeon Moon', 'Corn Moon', "Hunter's Moon", 'Beaver Moon', 'Cold Moon'];
const QUARTERS = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'];

export const moonDistanceKm = (t) => A().GeoMoon(toDate(t)).Length() * 149597870.7;

/** List of lunar phases for roughly the next `months` months, with special-moon tags. */
export function lunarPhases(now, months = 13) {
  const out = [];
  let mq = A().SearchMoonQuarter(new Date(now - 2 * DAY));
  const end = +now + months * 30.6 * DAY;
  while (toDate(mq.time) < end) {
    out.push({ quarter: mq.quarter, name: QUARTERS[mq.quarter], t: toDate(mq.time) });
    mq = A().NextMoonQuarter(mq);
  }
  // Harvest Moon = full moon nearest the autumn equinox (Sept north / March south).
  const fulls = out.filter((p) => p.quarter === 2);
  const news = out.filter((p) => p.quarter === 0);
  const byMonth = (arr) => {
    const m = new Map();
    for (const p of arr) {
      const { year, month } = localParts(p.t);
      const k = `${year}-${month}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  };
  for (const list of byMonth(fulls).values()) if (list.length > 1) list[1].blue = true;
  for (const list of byMonth(news).values()) if (list.length > 1) list[1].black = true;
  for (const p of fulls) {
    const { month } = localParts(p.t);
    p.trad = NAMES[month - 1];
    p.distKm = moonDistanceKm(p.t);
    p.super = p.distKm < 362000;
    p.micro = p.distKm > 405000;
  }
  return out;
}

function tagHarvest(fulls, southern) {
  const years = new Set(fulls.map((f) => f.t.getUTCFullYear()));
  for (const y of years) {
    const s = A().Seasons(y);
    const eq = toDate(southern ? s.mar_equinox : s.sep_equinox);
    let best = null;
    for (const f of fulls) if (Math.abs(f.t - eq) < 40 * DAY && (!best || Math.abs(f.t - eq) < Math.abs(best.t - eq))) best = f;
    if (best) best.trad = 'Harvest Moon';
  }
}

export function specialTags(p) {
  const t = [];
  if (p.super) t.push(['Supermoon', 'tag-super']);
  if (p.micro) t.push(['Micromoon', 'tag-micro']);
  if (p.blue) t.push(['Blue Moon', 'tag-blue']);
  if (p.black) t.push(['Black Moon', 'tag-black']);
  return t;
}

/** Draw the Moon's phase onto a canvas. */
export function drawMoon(canvas, phaseAngle, southern = false) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 120;
  canvas.width = canvas.height = size * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const r = size / 2 - 3, cx = size / 2, cy = size / 2;
  if (southern) { g.translate(size, 0); g.scale(-1, 1); }
  g.fillStyle = '#1b2033';
  g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill();
  const p = ((phaseAngle % 360) + 360) % 360;
  const waxing = p < 180;
  const c = Math.cos(p * DEG);
  const crescent = c > 0;
  const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#fffbe9');
  grad.addColorStop(1, '#d9d2b8');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
  g.ellipse(cx, cy, Math.max(0.01, r * Math.abs(c)), r, 0, Math.PI / 2, -Math.PI / 2, waxing === crescent);
  g.fill();
  // a few soft maria for texture
  g.globalAlpha = 0.05;
  g.fillStyle = '#000';
  for (const [x, y, s] of [[-0.25, -0.2, 0.22], [0.15, -0.3, 0.16], [0.2, 0.15, 0.2], [-0.1, 0.3, 0.12]]) {
    g.beginPath(); g.arc(cx + x * r, cy + y * r, s * r, 0, 2 * Math.PI); g.fill();
  }
  g.globalAlpha = 1;
}

export default {
  id: 'moon',
  title: 'Moon & Lunar Events',
  icon: '🌕',
  needs: [],
  highlight(ctx) {
    const m = moonInfo(ctx.loc, ctx.now);
    const next = lunarPhases(ctx.now, 1).find((p) => p.quarter === 2 && p.t > ctx.now);
    const tags = next ? specialTags(next).map((t) => t[0]).join(', ') : '';
    return { level: 'info', text: `${phaseEmoji(m.phaseAngle)} ${m.name}, ${Math.round(m.fraction * 100)}% lit`, sub: next ? `Full Moon ${relDays(next.t, ctx.now)}${tags ? ` (${tags})` : ''}` : '' };
  },
  render(el, ctx) {
    const now = ctx.now;
    const m = moonInfo(ctx.loc, now);
    const south = ctx.loc.lat < 0;
    const phases = lunarPhases(now, 13);
    const fulls = phases.filter((p) => p.quarter === 2);
    tagHarvest(fulls, south);
    const upcoming = phases.filter((p) => p.t > now).slice(0, 4);
    const nextFull = fulls.find((p) => p.t > now);
    const special = phases.filter((p) => p.t > now && specialTags(p).length);
    const perigee = A().SearchLunarApsis(now);
    const apsides = [perigee, A().NextLunarApsis(perigee)].map((x) => ({ kind: x.kind === 0 ? 'Perigee (closest)' : 'Apogee (farthest)', t: toDate(x.time), km: x.dist_km }));
    const tips = m.fraction > 0.85
      ? 'The bright Moon washes out faint stars, meteors and the Milky Way tonight. Use it for lunar viewing or photographing moonlit landscapes.'
      : m.fraction < 0.25
        ? 'A thin or absent Moon means dark skies. Good for deep-sky objects, meteors and the Milky Way.'
        : `Look along the terminator (the line between light and shadow) for craters in sharp relief. Binoculars are enough.`;

    el.innerHTML = `
      <div class="moon-top">
        <canvas class="moon-disc" aria-label="Moon phase illustration"></canvas>
        <div>
          <div class="big">${m.name}</div>
          <div class="muted">${Math.round(m.fraction * 100)}% illuminated · ${m.ageDays != null ? m.ageDays.toFixed(1) + ' days old' : ''} · in ${esc(m.constellation)}</div>
          <ul class="kv compact">
            <li><span>Moonrise</span><b>${fmtDateTime(m.rise)}</b></li>
            <li><span>Moonset</span><b>${fmtDateTime(m.set)}</b></li>
            <li><span>Altitude now</span><b>${m.alt.toFixed(0)}° ${m.alt < 0 ? '(below horizon)' : ''}</b></li>
            <li><span>Distance</span><b>${Math.round(m.distKm).toLocaleString()} km</b></li>
          </ul>
        </div>
      </div>
      <p class="tip">💡 ${tips}</p>

      <h4>Next phases</h4>
      <div class="phase-row">${upcoming.map((p) => `<div class="phase"><span class="emoji">${['🌑', '🌓', '🌕', '🌗'][p.quarter]}</span><b>${p.name}</b><small>${fmtDateTime(p.t)}</small><small class="muted">${relDays(p.t, now)}</small></div>`).join('')}</div>

      ${special.length ? `<h4>Special moons ahead</h4><ul class="list">${special.slice(0, 6).map((p) => `<li><span>${p.quarter === 2 ? '🌕' : '🌑'} <b>${specialTags(p).map(([t, c]) => `<em class="tag ${c}">${t}</em>`).join(' ')}</b> ${p.trad ? esc(p.trad) : esc(p.name)}</span><span>${fmtDateYear(p.t)} <a class="ics" download="moon.ics" href="${icsLink(`${specialTags(p).map((t) => t[0]).join(' ')} – ${p.trad || p.name}`, p.t, 60)}" title="Add to calendar">📅</a></span></li>`).join('')}</ul>` : ''}

      <h4>Full moons in the next year</h4>
      <div class="table-scroll"><table class="list-table">
        <thead><tr><th>Date</th><th>Name${south ? '<sup>*</sup>' : ''}</th><th>Distance</th><th></th></tr></thead>
        <tbody>${fulls.filter((p) => p.t > now - DAY).slice(0, 13).map((p) => `<tr class="${p === nextFull ? 'row-hl' : ''}"><td>${fmtDateYear(p.t)} <small class="muted">${fmtTime(p.t)}</small></td><td>${esc(p.trad)}</td><td>${Math.round(p.distKm).toLocaleString()} km</td><td>${specialTags(p).map(([t, c]) => `<em class="tag ${c}">${t}</em>`).join(' ')}</td></tr>`).join('')}</tbody>
      </table></div>
      ${south ? '<p class="muted small">* Traditional names come from Northern Hemisphere folklore, so the seasons they describe are reversed for you.</p>' : ''}

      <h4>Perigee & apogee</h4>
      <ul class="list">${apsides.map((x) => `<li><span>${x.kind}</span><span>${fmtDateYear(x.t)} · ${Math.round(x.km).toLocaleString()} km</span></li>`).join('')}</ul>
      <p class="muted small">Supermoon here means a full moon closer than 362,000 km. A Blue Moon is the second full moon in a calendar month, and a Black Moon is the second new moon in a month. All values are computed on your device with Astronomy Engine.</p>`;
    requestAnimationFrame(() => drawMoon(el.querySelector('.moon-disc'), m.phaseAngle, south));
  },
};
