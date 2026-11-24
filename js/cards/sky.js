// Interactive all-sky chart + list of constellations well placed tonight.
// Star & constellation data: d3-celestial (BSD-3-Clause), from the HYG / IAU catalogues.
import { esc, fmtTime, fmtDateTime, compass, DEG, HOUR, store, clamp } from '../util.js';
import { A, observer, bodyHorizon, makeStarProjector } from '../astro.js';
import { showerList } from './meteors.js';

const ZODIAC = new Set(['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Oph', 'Sgr', 'Cap', 'Aqr', 'Psc']);
const LOOK_FOR = {
  Ori: 'Three-star belt, red Betelgeuse, blue Rigel, and the Orion Nebula (M42) in the sword.',
  UMa: 'The Big Dipper. Follow its pointer stars to Polaris.',
  UMi: 'Polaris, the North Star, at the tip of the Little Dipper handle.',
  Cas: 'A bright W or M shape opposite the Big Dipper.',
  Cyg: 'The Northern Cross, lying along the Milky Way. Its brightest star is Deneb.',
  Lyr: 'Brilliant Vega, and the Ring Nebula (M57) for telescopes.',
  Aql: 'Altair. With Vega and Deneb it forms the Summer Triangle.',
  Sco: 'A curving scorpion with red Antares at its heart.',
  Sgr: 'The "Teapot", pointing at the Milky Way core.',
  Leo: 'A backwards question mark (the Sickle) with Regulus at its base.',
  Tau: 'Orange Aldebaran, the V-shaped Hyades and the Pleiades (M45).',
  Gem: 'The twin stars Castor and Pollux.',
  CMa: 'Sirius, the brightest star in the night sky.',
  Cru: 'The Southern Cross, a compact kite of four bright stars.',
  Cen: 'α Centauri, the nearest star system to the Sun, and the globular cluster ω Centauri.',
  Car: 'Canopus, the second-brightest star, and the Carina Nebula.',
  And: 'The Andromeda Galaxy (M31), visible to the naked eye from dark sites.',
  Peg: 'The Great Square of Pegasus.',
  Boo: 'Orange Arcturus. "Arc to Arcturus" from the Dipper\'s handle.',
  Vir: 'Spica, and a rich field of galaxies for telescopes.',
  Aur: 'Capella, a bright yellow star, and three open clusters.',
  Per: 'The Double Cluster, and Algol, the "Demon Star" that varies in brightness.',
  Her: 'The Keystone asterism and the great globular cluster M13.',
  CrA: 'A small, elegant arc of stars below Sagittarius.',
  Tuc: 'The Small Magellanic Cloud and globular cluster 47 Tucanae.',
  Dor: 'The Large Magellanic Cloud and the Tarantula Nebula.',
  Oph: 'A large constellation that the Sun crosses, although it is not in the traditional zodiac.',
};

function bvColor(bv) {
  const t = clamp((bv + 0.3) / 2.0, 0, 1);
  const stops = [[155, 180, 255], [202, 216, 255], [255, 255, 255], [255, 244, 222], [255, 210, 161], [255, 180, 120]];
  const p = t * (stops.length - 1), i = Math.floor(p), f = p - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}

function skyBg(sunAlt) {
  if (sunAlt > 0) return ['#3d6fb6', '#8fb8e8'];
  if (sunAlt > -6) return ['#1c2f5a', '#4a5f8f'];
  if (sunAlt > -12) return ['#0e1a38', '#243461'];
  if (sunAlt > -18) return ['#070d22', '#141d3d'];
  return ['#03050f', '#0a1024'];
}

let state = null; // persisted per page

function opts() {
  return { lines: true, names: true, stars: true, planets: true, dso: false, mw: true, grid: false, radiants: true, rot: 0, ...store.get('skyOpts', {}) };
}

function draw(canvas, ctx, t) {
  const cat = ctx.catalog;
  const o = opts();
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (!size || size < 80) return []; // not laid out yet (collapsed or hidden)
  canvas.width = canvas.height = Math.round(size * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2, cy = size / 2, R = size / 2 - 22;
  const s = size / 600;
  const rot = o.rot;
  const P = (alt, az) => {
    const z = (90 - Math.max(alt, -75)) * DEG;
    const r = R * Math.tan(z / 2);
    const a = (az - rot) * DEG;
    return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const obs = observer(ctx.loc);
  const proj = makeStarProjector(t, ctx.loc.lat, ctx.loc.lon);
  const sun = bodyHorizon(A().Body.Sun, t, obs);
  const hits = [];

  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.clip();
  const [c1, c2] = skyBg(sun.alt);
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const night = sun.alt < -6;
  const dayFade = night ? 1 : clamp((-sun.alt + 2) / 8, 0.12, 1);

  // Milky Way
  if (o.mw && cat.milkyway && night) {
    for (const f of cat.milkyway) {
      g.fillStyle = f.id === 'ol1' ? 'rgba(170,185,230,0.07)' : 'rgba(190,205,240,0.07)';
      for (const poly of f.polys) {
        g.beginPath();
        for (const ring of poly) {
          ring.forEach(([ra, dec], i) => { const h = proj(ra, dec); const [x, y] = P(h.alt, h.az); i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.closePath();
        }
        g.fill('evenodd');
      }
    }
  }
  // Alt-az grid
  if (o.grid) {
    g.strokeStyle = 'rgba(120,160,255,0.15)'; g.lineWidth = 1;
    for (const alt of [30, 60]) { const [x, y] = P(alt, rot); g.beginPath(); g.arc(cx, cy, Math.hypot(x - cx, y - cy), 0, 2 * Math.PI); g.stroke(); }
    for (let az = 0; az < 360; az += 45) { const [x, y] = P(0, az); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
  }
  // Constellation lines
  if (o.lines && cat.constellations) {
    g.strokeStyle = `rgba(120,170,255,${0.35 * dayFade})`; g.lineWidth = 1;
    for (const lines of Object.values(cat.constellations.lines)) {
      for (const line of lines) {
        g.beginPath();
        let prev = null;
        for (const [ra, dec] of line) {
          const h = proj(ra, dec);
          const pt = P(h.alt, h.az);
          if (prev && (h.alt > -15 || prev.alt > -15)) { g.moveTo(prev.pt[0], prev.pt[1]); g.lineTo(pt[0], pt[1]); }
          prev = { pt, alt: h.alt };
        }
        g.stroke();
      }
    }
  }
  // Deep-sky (Messier)
  if (o.dso && cat.messier && night) {
    g.strokeStyle = 'rgba(140,255,200,0.6)'; g.fillStyle = 'rgba(140,255,200,0.8)'; g.font = `${10 * Math.max(s, 0.8)}px system-ui`;
    for (const m of cat.messier) {
      const h = proj(m.ra, m.dec);
      if (h.alt < 0) continue;
      const [x, y] = P(h.alt, h.az);
      g.beginPath(); g.arc(x, y, 3 * Math.max(s, 0.8), 0, 2 * Math.PI); g.stroke();
      if (m.mag < 7) g.fillText(m.id, x + 5, y - 4);
      hits.push({ x, y, label: `${m.id}${m.alt ? ' – ' + m.alt : ''} (${m.type}, mag ${m.mag})`, alt: h.alt, az: h.az });
    }
  }
  // Stars
  if (cat.stars) {
    const lim = night ? 6 : sun.alt > 0 ? -1 : 3;
    for (const st of cat.stars) {
      const [ra, dec, mag, bv, hip] = st;
      if (mag > lim) break; // sorted by magnitude
      const h = proj(ra, dec);
      if (h.alt < -2) continue;
      const [x, y] = P(h.alt, h.az);
      const r = Math.max(0.5, (6.4 - mag) * 0.62) * Math.max(s, 0.7);
      g.fillStyle = bvColor(bv);
      g.globalAlpha = clamp(0.35 + (6.5 - mag) / 6, 0.35, 1) * dayFade;
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill();
      const nm = cat.starnames?.[hip];
      if (nm && mag < 3.5) hits.push({ x, y, label: `${nm.n} (mag ${mag.toFixed(1)})`, alt: h.alt, az: h.az });
      if (o.stars && nm && mag < 1.6) { g.globalAlpha = 0.85 * dayFade; g.fillStyle = '#d8e2ff'; g.font = `${10.5 * Math.max(s, 0.85)}px system-ui`; g.fillText(nm.n, x + r + 3, y + 3); }
    }
    g.globalAlpha = 1;
  }
  // Constellation names
  if (o.names && cat.constellations) {
    g.fillStyle = `rgba(150,190,255,${0.75 * dayFade})`; g.font = `${11 * Math.max(s, 0.85)}px system-ui`; g.textAlign = 'center';
    for (const c of cat.constellations.list) {
      const h = proj(c.ra, c.dec);
      if (h.alt < 4) continue;
      const [x, y] = P(h.alt, h.az);
      if (c.rank <= 2 || s > 0.9) g.fillText(c.name.toUpperCase(), x, y);
      hits.push({ x, y, label: `Constellation: ${c.name}`, alt: h.alt, az: h.az, weak: true });
    }
    g.textAlign = 'left';
  }
  // Active meteor radiants
  if (o.radiants) {
    g.fillStyle = '#ffd36e'; g.font = `${12 * Math.max(s, 0.85)}px system-ui`;
    for (const sh of showerList(ctx.loc, ctx.now).filter((x) => x.active)) {
      const h = proj(sh.ra, sh.dec);
      if (h.alt < 0) continue;
      const [x, y] = P(h.alt, h.az);
      g.fillText('✳', x - 5, y + 4); g.fillText(sh.name, x + 8, y + 4);
      hits.push({ x, y, label: `${sh.name} radiant (active)`, alt: h.alt, az: h.az });
    }
  }
  // Planets, Moon and Sun
  if (o.planets) {
    const bodies = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon', 'Sun'];
    for (const name of bodies) {
      const h = bodyHorizon(A().Body[name], t, obs);
      if (h.alt < -1) continue;
      const [x, y] = P(h.alt, h.az);
      const col = { Mercury: '#c9b8a6', Venus: '#fff4c7', Mars: '#ff8a5c', Jupiter: '#f2d6a2', Saturn: '#e9d48b', Uranus: '#a7f0f0', Neptune: '#8fb0ff', Moon: '#f5f1dc', Sun: '#ffdd55' }[name];
      const rad = (name === 'Moon' || name === 'Sun' ? 8 : name === 'Venus' || name === 'Jupiter' ? 4.5 : 3.5) * Math.max(s, 0.85);
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8;
      g.beginPath(); g.arc(x, y, rad, 0, 2 * Math.PI); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = col; g.font = `bold ${11 * Math.max(s, 0.85)}px system-ui`;
      g.fillText(name, x + rad + 3, y - 3);
      hits.push({ x, y, label: `${name}: ${h.alt.toFixed(0)}° up, ${compass(h.az)}`, alt: h.alt, az: h.az, strong: true });
    }
  }
  g.restore();
  // Horizon ring + cardinal points
  g.strokeStyle = 'rgba(160,190,255,0.5)'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.stroke();
  g.fillStyle = '#9fb3e8'; g.font = `bold ${13 * Math.max(s, 0.85)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [lab, az] of [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]]) {
    const a = (az - rot) * DEG;
    const rr = R + 12;
    g.globalAlpha = lab.length === 1 ? 1 : 0.55;
    g.fillText(lab, cx - rr * Math.sin(a), cy - rr * Math.cos(a));
  }
  g.globalAlpha = 1; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  return hits;
}

export function constellationsTonight(ctx) {
  const cat = ctx.catalog;
  if (!cat.constellations) return [];
  const n = ctx.night;
  const from = n.dark ? n.dark[0] : n.civil.dusk || n.winStart;
  const to = n.dark ? n.dark[1] : n.civil.dawn || n.winEnd;
  const start = Math.max(+from, +ctx.now);
  const times = [];
  for (let t = start; t <= +to; t += HOUR) times.push(new Date(t));
  if (!times.length) times.push(ctx.now);
  const projs = times.map((t) => makeStarProjector(t, ctx.loc.lat, ctx.loc.lon));
  const brightest = {};
  for (const [ra, dec, mag, , hip] of cat.stars || []) {
    const nm = cat.starnames?.[hip];
    if (nm && (!brightest[nm.c] || mag < brightest[nm.c].mag)) brightest[nm.c] = { name: nm.n, mag };
  }
  return cat.constellations.list.map((c) => {
    let best = null;
    projs.forEach((p, i) => { const h = p(c.ra, c.dec); if (!best || h.alt > best.alt) best = { ...h, t: times[i] }; });
    const circumpolar = Math.abs(c.dec) > 90 - Math.abs(ctx.loc.lat) && Math.sign(c.dec) === Math.sign(ctx.loc.lat);
    return { ...c, best, circumpolar, zodiac: ZODIAC.has(c.id), star: brightest[c.id], look: LOOK_FOR[c.id] };
  }).filter((c) => c.best.alt > 25).sort((a, b) => (a.rank - b.rank) || (b.best.alt - a.best.alt));
}

export default {
  id: 'sky',
  title: 'Sky Map & Constellations',
  icon: '✨',
  needs: ['catalog'],
  highlight(ctx) {
    const list = constellationsTonight(ctx).filter((c) => c.rank === 1);
    if (!list.length) return null;
    return { level: 'info', text: `${list.length} major constellations up tonight`, sub: list.slice(0, 3).map((c) => c.name).join(', ') };
  },
  render(el, ctx) {
    if (!ctx.catalog.stars) return (el.innerHTML = '<div class="skeleton">Loading star catalogue…</div>');
    const o = opts();
    const list = constellationsTonight(ctx);
    // During daytime/twilight, open the chart at tonight's darkness instead of "now".
    const locKey = `${ctx.loc.lat},${ctx.loc.lon}`;
    if (!state || state.locKey !== locKey) {
      const sunNow = bodyHorizon(A().Body.Sun, ctx.now, observer(ctx.loc)).alt;
      const startDark = ctx.night.dark?.[0];
      const off = sunNow > -12 && startDark && startDark > ctx.now ? Math.round((startDark - ctx.now) / 600e3) * 10 + 60 : 0;
      state = { offset: off, locKey };
    }
    const maxOff = Math.max(14 * 60, Math.ceil((state.offset + 8 * 60) / 10) * 10);
    const featured = list.filter((c) => c.look).slice(0, 8);
    const others = list.filter((c) => !featured.includes(c));
    el.innerHTML = `
      <div class="sky-wrap">
        <div class="sky-canvas-wrap"><canvas class="sky-canvas" role="img" aria-label="All-sky chart for your location"></canvas><div class="sky-tip" hidden></div></div>
        <div class="sky-controls">
          <label class="time-label">Time: <b data-tlabel></b></label>
          <input type="range" min="-120" max="${maxOff}" step="10" value="${state.offset}" data-time aria-label="Time offset">
          <div class="btn-row"><button class="btn small" data-now>Now</button><button class="btn small" data-jump="22">10 PM</button><button class="btn small" data-jump="2">2 AM</button><button class="btn small" data-play>▶ Play</button></div>
          <div class="toggles">
            ${[['lines', 'Constellation lines'], ['names', 'Constellation names'], ['stars', 'Star names'], ['planets', 'Planets & Moon'], ['mw', 'Milky Way'], ['dso', 'Messier objects'], ['radiants', 'Meteor radiants'], ['grid', 'Alt/Az grid']].map(([k, l]) => `<label><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}> ${l}</label>`).join('')}
          </div>
          <label>Top of chart: <select data-rot>${[['0', 'North'], ['90', 'East'], ['180', 'South'], ['270', 'West']].map(([v, l]) => `<option value="${v}" ${o.rot == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="muted small">Hold the chart overhead with the top toward the chosen direction. Hover or tap for names.</p>
        </div>
      </div>
      <h4>Best constellations tonight</h4>
      <div class="con-grid">${featured.map((c) => `<div class="con-card ${c.zodiac ? 'zod' : ''}"><b>${esc(c.name)}</b>${c.zodiac ? ' <em class="tag">Zodiac</em>' : ''}${c.circumpolar ? ' <em class="tag">Circumpolar</em>' : ''}
        <small>Highest ${Math.round(c.best.alt)}° in the ${compass(c.best.az)} around ${fmtTime(c.best.t)}</small>
        <p>${esc(c.look)}</p>${c.star ? `<small class="muted">Brightest named star: ${esc(c.star.name)} (mag ${c.star.mag.toFixed(1)})</small>` : ''}</div>`).join('')}</div>
      ${others.length ? `<details><summary>${others.length} more constellations above 25° tonight</summary><div class="chips">${others.map((c) => `<span class="chip" title="Highest ${Math.round(c.best.alt)}° ${compass(c.best.az)} at ${fmtTime(c.best.t)}">${esc(c.name)}${c.zodiac ? ' ♈' : ''}</span>`).join('')}</div></details>` : ''}`;

    const canvas = el.querySelector('canvas');
    const tip = el.querySelector('.sky-tip');
    const slider = el.querySelector('[data-time]');
    const tlabel = el.querySelector('[data-tlabel]');
    let hits = [];
    const redraw = () => {
      state = { offset: +slider.value, locKey };
      const t = new Date(+ctx.now + state.offset * 60e3);
      tlabel.textContent = fmtDateTime(t);
      hits = draw(canvas, ctx, t);
    };
    requestAnimationFrame(redraw);
    slider.addEventListener('input', redraw);
    el.querySelector('[data-now]').addEventListener('click', () => { slider.value = 0; redraw(); });
    el.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      // find next occurrence of that local hour
      const target = +b.dataset.jump;
      for (let m = 0; m <= 24 * 60; m += 10) {
        const d = new Date(+ctx.now + m * 60e3);
        const hh = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: ctx.tz }).format(d);
        if (hh === target) { slider.value = Math.min(m, +slider.max); break; }
      }
      redraw();
    }));
    let timer = null;
    el.querySelector('[data-play]').addEventListener('click', (e) => {
      if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶ Play'; return; }
      e.target.textContent = '⏸ Pause';
      timer = setInterval(() => {
        if (!canvas.isConnected) return clearInterval(timer);
        slider.value = +slider.value >= +slider.max ? slider.min : +slider.value + 10;
        redraw();
      }, 120);
    });
    el.querySelectorAll('[data-opt]').forEach((cb) => cb.addEventListener('change', () => { store.set('skyOpts', { ...opts(), [cb.dataset.opt]: cb.checked }); redraw(); }));
    el.querySelector('[data-rot]').addEventListener('change', (e) => { store.set('skyOpts', { ...opts(), rot: +e.target.value }); redraw(); });
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      const p = ev.touches ? ev.touches[0] : ev;
      const x = p.clientX - r.left, y = p.clientY - r.top;
      let best = null, bd = 18 * 18;
      for (const h of hits) {
        const d = (h.x - x) ** 2 + (h.y - y) ** 2 * 1 + (h.weak ? 150 : 0) - (h.strong ? 120 : 0);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) {
        tip.hidden = false;
        tip.textContent = `${best.label} · alt ${Math.round(best.alt)}°, az ${Math.round(best.az)}°`;
        tip.style.left = `${clamp(best.x + 12, 0, r.width - 180)}px`;
        tip.style.top = `${clamp(best.y + 12, 0, r.height - 30)}px`;
      } else tip.hidden = true;
    };
    canvas.addEventListener('mousemove', pick);
    canvas.addEventListener('click', pick);
    canvas.addEventListener('mouseleave', () => (tip.hidden = true));
    let lastW = canvas.clientWidth;
    new ResizeObserver(() => { if (canvas.clientWidth !== lastW) { lastW = canvas.clientWidth; redraw(); } }).observe(canvas);
  },
};
