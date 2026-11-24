// Twilight, darkness window, golden/blue hour, Milky Way core and seasonal sky phenomena.
import { esc, fmtTime, fmtDateYear, fmtDuration, relDays, compass, toDate, DAY, HOUR, localParts } from '../util.js';
import { A, observer, makeStarProjector, moonFreeDark, sunAlt, moonAlt } from '../astro.js';

const GC = { ra: 266.42, dec: -29.0 }; // Galactic centre (Sgr A*)

function milkyWayCore(loc, night) {
  if (!night.dark) return null;
  let best = null, first = null, last = null;
  for (let t = +night.dark[0]; t <= +night.dark[1]; t += 10 * 60e3) {
    const d = new Date(t);
    const p = makeStarProjector(d, loc.lat, loc.lon)(GC.ra, GC.dec);
    if (p.alt > 10) { if (!first) first = d; last = d; }
    if (!best || p.alt > best.alt) best = { ...p, t: d };
  }
  return { best, first, last };
}

function seasonalNotes(loc, now) {
  const { month } = localParts(now);
  const north = loc.lat >= 0;
  const absLat = Math.abs(loc.lat);
  const notes = [];
  const m = north ? month : ((month + 5) % 12) + 1; // mirror seasons for the south
  if ([2, 3, 4].includes(m)) notes.push(['🔺', 'Zodiacal light (evenings)', 'A faint cone of light rises from the western horizon about 90 minutes after sunset. You need very dark skies and no Moon.']);
  if ([9, 10, 11].includes(m)) notes.push(['🔺', 'Zodiacal light (mornings)', 'Look east about 2 hours before dawn for a faint, tilted pyramid of light.']);
  if (absLat >= 45 && absLat <= 65 && ((north && [5, 6, 7, 8].includes(month)) || (!north && [11, 12, 1, 2].includes(month)))) notes.push(['☁️', 'Noctilucent clouds season', `Glowing electric-blue clouds can appear low in the ${north ? 'north' : 'south'} 1–2 hours after sunset or before sunrise.`]);
  if (absLat >= 50) notes.push(['🌌', 'Aurora latitude', 'You are at a latitude where aurora can appear during moderate storms. Check the aurora card.']);
  notes.push(['🌠', 'Sporadic meteors', 'Even with no shower active, 5–10 random meteors an hour streak across a dark sky. Rates are higher after midnight.']);
  if ([3, 9].includes(month)) notes.push(['🧲', 'Equinox aurora boost', 'Geomagnetic activity tends to peak around the equinoxes (the Russell–McPherron effect).']);
  return notes;
}

function seasonsAhead(now) {
  const y = localParts(now).year;
  const out = [];
  for (const yr of [y, y + 1]) {
    const s = A().Seasons(yr);
    out.push(['March equinox', toDate(s.mar_equinox)], ['June solstice', toDate(s.jun_solstice)], ['September equinox', toDate(s.sep_equinox)], ['December solstice', toDate(s.dec_solstice)]);
  }
  return out.filter(([, t]) => t > now).slice(0, 4);
}

export default {
  id: 'darkness',
  title: 'Twilight, Darkness & Milky Way',
  icon: '🌃',
  needs: [],
  highlight(ctx) {
    const n = ctx.night;
    if (!n.dark) return { level: 'warn', text: 'No true darkness tonight', sub: n.polarKind === 'midnight-sun' ? 'Midnight sun' : 'Twilight all night' };
    const mf = moonFreeDark(ctx.loc, n);
    return { level: mf.ms > 3 * HOUR ? 'good' : mf.ms > HOUR ? 'ok' : 'warn', text: `Dark ${fmtTime(n.dark[0])} – ${fmtTime(n.dark[1])}`, sub: `${fmtDuration(mf.ms)} moon-free` };
  },
  render(el, ctx) {
    const n = ctx.night;
    const obs = observer(ctx.loc);
    const mf = moonFreeDark(ctx.loc, n);
    const mw = milkyWayCore(ctx.loc, n);
    const golden = (() => {
      if (!n.sunset) return null;
      const g = A().SearchAltitude(A().Body.Sun, obs, -1, new Date(+n.sunset - 3 * HOUR), 1, 6);
      return g ? toDate(g) : null;
    })();
    const blueEnd = n.civil.dusk;
    // Timeline segments between sunset and sunrise
    const span = [n.winStart, n.winEnd];
    const seg = [];
    if (n.sunset && n.sunrise) {
      const total = n.winEnd - n.winStart;
      for (let t = +n.winStart; t < +n.winEnd; t += 10 * 60e3) {
        const a = sunAlt(new Date(t), obs);
        const mUp = moonAlt(new Date(t), obs) > 0;
        const col = a > -6 ? 'var(--tw-civil)' : a > -12 ? 'var(--tw-naut)' : a > -18 ? 'var(--tw-astro)' : 'var(--tw-dark)';
        seg.push(`<i style="width:${(10 * 60e3 / total) * 100}%;background:${col}" class="${mUp ? 'moonup' : ''}"></i>`);
      }
    }
    const rows = [
      ['🌇 Golden hour begins', golden], ['🌅 Sunset', n.sunset], ['🔵 Civil dusk (blue hour ends)', blueEnd], ['⚓ Nautical dusk', n.nautical.dusk],
      ['🌑 Astronomical dusk (dark)', n.astro.dusk], ['🌄 Astronomical dawn', n.astro.dawn], ['⚓ Nautical dawn', n.nautical.dawn], ['🔵 Civil dawn', n.civil.dawn], ['☀️ Sunrise', n.sunrise],
    ];

    el.innerHTML = `
      ${n.polar ? `<p class="tip">${n.polarKind === 'midnight-sun' ? '☀️ <b>Midnight sun:</b> the Sun does not set today at this latitude.' : '🌑 <b>Polar night:</b> the Sun does not rise today. Long hours of darkness are good for aurora.'}</p>` : ''}
      ${!n.dark ? '<p class="tip">The Sun never gets more than 18° below the horizon tonight, so the sky stays in twilight. Bright stars and planets are still visible.</p>' : ''}
      ${seg.length ? `<div class="night-bar" aria-label="Twilight timeline">${seg.join('')}</div>
        <div class="night-bar-labels"><span>${fmtTime(span[0])}</span><span>Night timeline (◌ = Moon up)</span><span>${fmtTime(span[1])}</span></div>
        <div class="legend"><span><i style="background:var(--tw-civil)"></i>Civil</span><span><i style="background:var(--tw-naut)"></i>Nautical</span><span><i style="background:var(--tw-astro)"></i>Astronomical</span><span><i style="background:var(--tw-dark)"></i>Full dark</span><span><i class="moonup-swatch"></i>Moon up</span></div>` : ''}
      <div class="two-col">
        <ul class="kv">${rows.map(([k, v]) => `<li><span>${k}</span><b>${fmtTime(v)}</b></li>`).join('')}</ul>
        <div>
          <div class="stat-box"><span>Dark sky (${n.darkKind})</span><b>${n.dark ? fmtDuration(n.dark[1] - n.dark[0]) : '—'}</b></div>
          <div class="stat-box"><span>Dark and moon-free</span><b>${fmtDuration(mf.ms)}</b>${mf.from ? `<small>${fmtTime(mf.from)} – ${fmtTime(mf.to)}</small>` : ''}</div>
          <div class="stat-box"><span>Milky Way core</span>${mw?.first ? `<b>Visible</b><small>${fmtTime(mw.first)} – ${fmtTime(mw.last)}, highest ${Math.round(mw.best.alt)}° in the ${compass(mw.best.az)}</small>` : `<b>Not tonight</b><small>${mw?.best ? `It stays below 10° during darkness (max ${Math.round(mw.best.alt)}°). Best season: ${ctx.loc.lat >= 0 ? 'April–September' : 'February–October'}.` : 'No full darkness.'}</small>`}</div>
        </div>
      </div>
      <h4>Seasonal sky phenomena</h4>
      <ul class="list">${seasonalNotes(ctx.loc, ctx.now).map(([i, t, d]) => `<li><span>${i} <b>${esc(t)}</b><br><small class="muted">${esc(d)}</small></span></li>`).join('')}</ul>
      <h4>Equinoxes & solstices</h4>
      <ul class="list">${seasonsAhead(ctx.now).map(([k, t]) => `<li><span>${k}</span><span>${fmtDateYear(t)} <small class="muted">${relDays(t, ctx.now)}</small></span></li>`).join('')}</ul>
      <p class="muted small">Light pollution matters as much as weather. Find a darker site near you on the free <a href="https://www.lightpollutionmap.info/#zoom=8&lat=${ctx.loc.lat.toFixed(3)}&lon=${ctx.loc.lon.toFixed(3)}" target="_blank" rel="noopener">Light Pollution Map</a>.</p>`;
  },
};
