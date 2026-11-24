// Meteor showers. Peaks are computed from the IMO solar-longitude of maximum,
// so dates are correct every year. Radiant altitude and moonlight are evaluated
// for the user's location to estimate realistic hourly rates.
import { esc, fmtDateYear, fmtTime, relDays, toDate, DEG, DAY, HOUR, icsLink, compass } from '../util.js';
import { A, observer, makeStarProjector, sunAlt, bodyHorizon } from '../astro.js';

// [name, solar longitude of peak, ZHR, radiant RA°, radiant Dec°, speed km/s, days before, days after, parent body]
export const SHOWERS = [
  ['Quadrantids', 283.15, 80, 230, 49, 41, 7, 12, '2003 EH1'],
  ['α-Centaurids', 319.2, 6, 210, -59, 56, 11, 7, 'unknown'],
  ['Lyrids', 32.32, 18, 271, 34, 49, 8, 8, 'Comet Thatcher'],
  ['η-Aquariids', 45.5, 50, 338, -1, 66, 17, 22, 'Comet 1P/Halley'],
  ['Southern δ-Aquariids', 127, 25, 340, -16, 41, 18, 24, 'Comet 96P/Machholz'],
  ['α-Capricornids', 127, 5, 307, -10, 23, 27, 16, 'Comet 169P/NEAT'],
  ['Perseids', 140.0, 100, 48, 58, 59, 26, 12, 'Comet 109P/Swift–Tuttle'],
  ['Draconids', 195.4, 10, 262, 54, 20, 3, 2, 'Comet 21P/Giacobini–Zinner'],
  ['Southern Taurids', 197, 5, 32, 9, 27, 30, 40, 'Comet 2P/Encke'],
  ['Orionids', 208, 20, 95, 16, 66, 19, 17, 'Comet 1P/Halley'],
  ['Northern Taurids', 230, 5, 58, 22, 29, 23, 28, 'Comet 2P/Encke'],
  ['Leonids', 235.27, 15, 152, 22, 71, 11, 13, 'Comet 55P/Tempel–Tuttle'],
  ['Geminids', 262.2, 150, 112, 33, 35, 10, 6, 'Asteroid 3200 Phaethon'],
  ['Ursids', 270.7, 10, 217, 76, 33, 5, 4, 'Comet 8P/Tuttle'],
].map(([name, lambda, zhr, ra, dec, v, before, after, parent]) => ({ name, lambda, zhr, ra, dec, v, before, after, parent }));

/** Evaluate the best moment around the peak for this location. */
function evaluate(s, peak, loc) {
  const obs = observer(loc);
  let best = null;
  for (let t = +peak - 14 * HOUR; t <= +peak + 14 * HOUR; t += 20 * 60e3) {
    const d = new Date(t);
    if (sunAlt(d, obs) > -12) continue;
    const proj = makeStarProjector(d, loc.lat, loc.lon);
    const rad = proj(s.ra, s.dec);
    if (rad.alt < 5) continue;
    const moon = bodyHorizon(A().Body.Moon, d, obs);
    const frac = A().Illumination(A().Body.Moon, d).phase_fraction;
    const moonPenalty = moon.alt > 0 ? 1.6 * frac : 0;
    const lm = 6.2 - moonPenalty; // limiting magnitude
    const rate = s.zhr * Math.sin(rad.alt * DEG) * Math.pow(2.2, lm - 6.5) * Math.exp(-Math.abs(t - peak) / (1.5 * DAY));
    if (!best || rate > best.rate) best = { t: d, rate, radAlt: rad.alt, radAz: rad.az, moonUp: moon.alt > 0, moonFrac: frac };
  }
  return best;
}

const memo = new Map();
export function showerList(loc, now) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${Math.floor(+now / DAY)}`;
  if (memo.has(key)) return memo.get(key);
  const list = SHOWERS.map((s) => {
    let peak = toDate(A().SearchSunLongitude(s.lambda, new Date(+now - (s.after + 1) * DAY), 370));
    if (+peak + s.after * DAY < +now) peak = toDate(A().SearchSunLongitude(s.lambda, new Date(+peak + 5 * DAY), 370));
    const start = new Date(+peak - s.before * DAY);
    const end = new Date(+peak + s.after * DAY);
    const active = +now >= +start && +now <= +end;
    const e = evaluate(s, peak, loc);
    const moonFrac = A().Illumination(A().Body.Moon, peak).phase_fraction;
    return { ...s, peak, start, end, active, best: e, moonFrac, visible: !!e && e.radAlt > 10 };
  }).sort((a, b) => a.peak - b.peak);
  memo.clear();
  memo.set(key, list);
  return list;
}

const rating = (r) => (r >= 40 ? '★★★' : r >= 15 ? '★★☆' : r >= 4 ? '★☆☆' : '☆☆☆');

export default {
  id: 'meteors',
  title: 'Meteor Showers',
  icon: '☄️',
  needs: [],
  highlight(ctx) {
    const list = showerList(ctx.loc, ctx.now).filter((s) => s.visible);
    const act = list.find((s) => s.active);
    const next = act || list[0];
    if (!next) return null;
    return { level: next.best?.rate >= 15 ? 'good' : 'ok', text: `${next.name} ${next.active ? 'active now' : 'peak ' + relDays(next.peak, ctx.now)}`, sub: `Up to ~${Math.round(next.best?.rate || 0)}/hr from here` };
  },
  render(el, ctx) {
    const list = showerList(ctx.loc, ctx.now);
    const active = list.filter((s) => s.active);
    el.innerHTML = `
      ${active.length ? `<div class="active-showers">${active.map((s) => `<div class="tip">🌠 <b>${s.name}</b> are active now (${fmtDateYear(s.start)} – ${fmtDateYear(s.end)}). Peak ${fmtDateYear(s.peak)}, ${relDays(s.peak, ctx.now)}.${s.visible ? ` Best viewing about ${fmtTime(s.best.t)} on the peak night, radiant ${Math.round(s.best.radAlt)}° high in the ${compass(s.best.radAz)}.` : ' The radiant stays low or below the horizon from your location.'}</div>`).join('')}</div>` : ''}
      <div class="table-scroll"><table class="list-table meteors">
        <thead><tr><th>Shower</th><th>Peak</th><th>Est. rate here</th><th>Moon</th><th>Best time</th><th></th></tr></thead>
        <tbody>${list.map((s) => `<tr class="${s.active ? 'row-hl' : ''} ${s.visible ? '' : 'dim'}">
          <td><b>${esc(s.name)}</b><br><small class="muted">ZHR ${s.zhr} · ${s.v} km/s · ${esc(s.parent)}</small></td>
          <td>${fmtDateYear(s.peak)}<br><small class="muted">${relDays(s.peak, ctx.now)}</small></td>
          <td>${s.visible ? `<span class="stars" title="rating">${rating(s.best.rate)}</span><br><small>~${Math.max(1, Math.round(s.best.rate))}/hr</small>` : '<small>Radiant too low</small>'}</td>
          <td>${s.moonFrac < 0.25 ? '🌑' : s.moonFrac < 0.6 ? '🌓' : '🌕'} ${Math.round(s.moonFrac * 100)}%${s.best?.moonUp && s.moonFrac > 0.4 ? '<br><small class="lvl-warn">moon interferes</small>' : ''}</td>
          <td>${s.visible ? `${fmtTime(s.best.t)}<br><small class="muted">look ${compass(s.best.radAz)}, ${Math.round(s.best.radAlt)}° up</small>` : '—'}</td>
          <td><a class="ics" download="${s.name}.ics" href="${icsLink(`${s.name} meteor shower peak`, s.best?.t || s.peak, 180, `Peak of the ${s.name}. Look ${s.best ? compass(s.best.radAz) : ''}.`)}" title="Add to calendar">📅</a></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">ZHR is the ideal rate with the radiant overhead under perfect skies. The estimate here accounts for radiant height at your location and moonlight. Lie back, let your eyes adapt for 20 minutes, and watch the whole sky, not just the radiant.</p>`;
  },
};
