// Weather & observing conditions: Open-Meteo forecast + air quality, 7Timer! seeing,
// and official NWS alerts (US). Also generates the warning banner.
import { esc, fmtTime, fmtHour, fmtWeekday, fmtDate, barChart, clamp, DAY, HOUR, levelClass } from '../util.js';
import { A } from '../astro.js';

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Rain showers', '🌦️'], 81: ['Rain showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Severe thunderstorm with hail', '⛈️'],
};
export const wmo = (c) => WMO[c] || ['—', '❔'];

// ---- unit helpers ----------------------------------------------------------
export const temp = (c, units) => (c == null ? '—' : units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`);
export const speed = (k, units) => (k == null ? '—' : units === 'imperial' ? `${Math.round(k / 1.609)} mph` : `${Math.round(k)} km/h`);
const dist = (m, units) => (m == null ? '—' : units === 'imperial' ? `${(m / 1609).toFixed(m < 16090 ? 1 : 0)} mi` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** Convert Open-Meteo hourly arrays to row objects. */
export function hourlyRows(w, air) {
  if (!w?.hourly?.time) return [];
  const h = w.hourly;
  const airIdx = new Map();
  if (air?.hourly?.time) air.hourly.time.forEach((t, i) => airIdx.set(t, i));
  return h.time.map((t, i) => {
    const ai = airIdx.get(t);
    return {
      t: new Date(t * 1000),
      temp: h.temperature_2m?.[i], feels: h.apparent_temperature?.[i], rh: h.relative_humidity_2m?.[i], dew: h.dew_point_2m?.[i],
      pop: h.precipitation_probability?.[i] ?? 0, precip: h.precipitation?.[i] ?? 0, code: h.weather_code?.[i],
      cloud: h.cloud_cover?.[i], low: h.cloud_cover_low?.[i], mid: h.cloud_cover_mid?.[i], high: h.cloud_cover_high?.[i],
      vis: h.visibility?.[i], wind: h.wind_speed_10m?.[i], gust: h.wind_gusts_10m?.[i], isDay: h.is_day?.[i],
      aod: ai != null ? air.hourly.aerosol_optical_depth?.[ai] : null,
      aqi: ai != null ? air.hourly.us_aqi?.[ai] : null,
      dust: ai != null ? air.hourly.dust?.[ai] : null,
    };
  });
}

/** Sky-clarity score 0–100 for one hour. */
export function clarity(r) {
  if (!r || r.cloud == null) return null;
  // Low cloud blocks the most sky; thin high cirrus still lets bright objects through.
  const eff = clamp(Math.max(r.cloud * 0.85, (r.low ?? 0) + (r.mid ?? 0) * 0.7 + (r.high ?? 0) * 0.35), 0, 100);
  let s = 1 - eff / 100;
  s *= 1 - 0.85 * clamp((r.pop ?? 0) / 100, 0, 1);
  if (r.vis != null) s *= r.vis < 1000 ? 0.15 : r.vis < 5000 ? 0.55 : r.vis < 10000 ? 0.85 : 1;
  if (r.aod != null) s *= r.aod > 0.8 ? 0.55 : r.aod > 0.4 ? 0.75 : r.aod > 0.25 ? 0.9 : 1;
  return Math.round(clamp(s, 0, 1) * 100);
}

export const scoreLabel = (s) => (s == null ? ['n/a', 'info'] : s >= 80 ? ['Excellent', 'good'] : s >= 60 ? ['Good', 'good'] : s >= 40 ? ['Fair', 'ok'] : s >= 20 ? ['Poor', 'warn'] : ['Bad', 'bad']);
const scoreColor = (s) => (s == null ? 'var(--muted)' : s >= 60 ? 'var(--good)' : s >= 40 ? 'var(--ok)' : s >= 20 ? 'var(--warn)' : 'var(--bad)');

/** Rows that fall inside tonight's window (sunset → sunrise, or the next 12 h). */
export function tonightRows(ctx) {
  const all = hourlyRows(ctx.data.weather?.value, ctx.data.air?.value);
  const n = ctx.night;
  let from = n.winStart, to = n.winEnd;
  if (!n.sunset || to - from > 20 * HOUR) { from = ctx.now; to = new Date(+ctx.now + 12 * HOUR); }
  const start = Math.max(+from, +ctx.now - HOUR);
  return all.filter((r) => +r.t >= start - HOUR && +r.t <= +to);
}

export function tonightSummary(ctx) {
  const rows = tonightRows(ctx);
  if (!rows.length) return null;
  const scores = rows.map(clarity).filter((x) => x != null);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  let best = null;
  rows.forEach((r) => { const s = clarity(r); if (s != null && (!best || s > best.s)) best = { s, t: r.t }; });
  return { rows, avg, best, avgCloud: Math.round(rows.reduce((a, r) => a + (r.cloud ?? 0), 0) / rows.length) };
}

/** Warnings for the banner + card. level: bad | warn | info */
export function weatherWarnings(ctx) {
  const out = [];
  const units = ctx.units;
  const rows = tonightRows(ctx);
  const cur = ctx.data.weather?.value?.current;
  const nws = ctx.data.nws?.value || [];
  for (const a of nws) {
    const lvl = /extreme|severe/i.test(a.severity) ? 'bad' : 'warn';
    out.push({ level: lvl, icon: '🚨', title: a.event, text: a.headline || '', source: a.sender || 'National Weather Service' });
  }
  if (!rows.length) return out;
  const max = (k) => Math.max(...rows.map((r) => r[k] ?? -Infinity));
  const min = (k) => Math.min(...rows.map((r) => r[k] ?? Infinity));
  const avgCloud = rows.reduce((a, r) => a + (r.cloud ?? 0), 0) / rows.length;
  const codes = rows.map((r) => r.code);
  const when = (pred) => { const r = rows.find(pred); return r ? ` from about ${fmtTime(r.t)}` : ''; };

  if (codes.some((c) => c >= 95)) out.push({ level: 'bad', icon: '⛈️', title: 'Thunderstorms forecast', text: `Lightning risk tonight${when((r) => r.code >= 95)}. Stay indoors and keep away from exposed sites and metal tripods.` });
  if (max('gust') >= 60) out.push({ level: 'bad', icon: '💨', title: 'Dangerous wind gusts', text: `Gusts up to ${speed(max('gust'), units)}. Telescopes can topple; avoid exposed ridges and forests.` });
  else if (max('gust') >= 40) out.push({ level: 'warn', icon: '💨', title: 'Windy', text: `Gusts up to ${speed(max('gust'), units)}. Expect shaky views in a telescope; weigh down your tripod.` });
  if (max('pop') >= 60) {
    const snowy = codes.some((c) => (c >= 71 && c <= 77) || c === 85 || c === 86);
    out.push({ level: 'warn', icon: snowy ? '🌨️' : '🌧️', title: snowy ? 'Snow likely' : 'Rain likely', text: `Up to ${Math.round(max('pop'))}% chance of precipitation tonight${when((r) => r.pop >= 60)}. Protect your gear.` });
  }
  if (codes.some((c) => c === 66 || c === 67 || c === 56 || c === 57 || c === 48)) out.push({ level: 'bad', icon: '🧊', title: 'Freezing precipitation or fog', text: 'Icy roads and paths are likely. Take care driving to dark-sky sites.' });
  if (avgCloud >= 80) out.push({ level: 'warn', icon: '☁️', title: 'Mostly cloudy tonight', text: `Average cloud cover is ${Math.round(avgCloud)}%. Most events won't be visible. Check the 7-night outlook for a better night.` });
  if (min('vis') < 1000) out.push({ level: 'warn', icon: '🌫️', title: 'Fog', text: `Visibility drops to ${dist(min('vis'), units)}.` });
  const dewRisk = rows.some((r) => r.temp != null && r.dew != null && r.temp - r.dew < 2 && r.rh >= 90);
  if (dewRisk) out.push({ level: 'info', icon: '💧', title: 'Dew or frost on optics', text: 'Air near saturation. Use dew heaters or shields and keep lens caps on between sessions.' });
  const coldest = Math.min(...rows.map((r) => r.feels ?? r.temp ?? Infinity));
  if (coldest <= -20) out.push({ level: 'bad', icon: '🥶', title: 'Extreme cold', text: `Feels like ${temp(coldest, units)}. Frostbite can set in within minutes. Limit time outdoors and dress in layers.` });
  else if (coldest <= -5) out.push({ level: 'warn', icon: '🧣', title: 'Cold night', text: `Feels like ${temp(coldest, units)}. Wear layers, a hat and gloves, and keep spare batteries warm.` });
  const maxAod = Math.max(...rows.map((r) => r.aod ?? 0));
  const maxAqi = Math.max(...rows.map((r) => r.aqi ?? 0));
  if (maxAod > 0.5 || maxAqi > 150) out.push({ level: 'warn', icon: '🔥', title: 'Smoke, dust or haze', text: `Aerosol optical depth ${maxAod.toFixed(2)}${maxAqi ? `, US AQI ${Math.round(maxAqi)}` : ''}. The sky will look washed out and faint stars will disappear.` });
  if (cur && cur.temperature_2m >= 35) out.push({ level: 'warn', icon: '🌡️', title: 'Heat', text: `It is ${temp(cur.temperature_2m, units)} now. Stay hydrated while you wait for dark.` });
  return out;
}

/** Group hours into nights (20:00 → 04:00 local) for a 7-night outlook. */
function nightOutlook(ctx) {
  const w = ctx.data.weather?.value;
  if (!w?.hourly) return [];
  const off = (w.utc_offset_seconds || 0) * 1000;
  const rows = hourlyRows(w, ctx.data.air?.value);
  const nights = new Map();
  for (const r of rows) {
    const local = new Date(+r.t + off);
    const h = local.getUTCHours();
    if (h >= 20 || h <= 4) {
      const eve = new Date(+local - (h <= 4 ? DAY : 0));
      const key = eve.toISOString().slice(0, 10);
      if (!nights.has(key)) nights.set(key, { key, date: new Date(+r.t - (h <= 4 ? DAY : 0)), rows: [] });
      nights.get(key).rows.push(r);
    }
  }
  return [...nights.values()]
    .filter((n) => n.rows.length >= 5)
    .slice(0, 7)
    .map((n) => {
      const s = n.rows.map(clarity).filter((x) => x != null);
      const score = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
      const mid = n.rows[Math.floor(n.rows.length / 2)].t;
      const moon = A().Illumination(A().Body.Moon, mid).phase_fraction;
      return { ...n, score, cloud: Math.round(n.rows.reduce((a, r) => a + (r.cloud ?? 0), 0) / n.rows.length), pop: Math.max(...n.rows.map((r) => r.pop ?? 0)), moon };
    });
}

const seeingTxt = ['', 'Excellent (<0.5″)', 'Excellent (0.5–0.75″)', 'Good (0.75–1″)', 'Good (1–1.25″)', 'Average (1.25–1.5″)', 'Below avg (1.5–2″)', 'Poor (2–2.5″)', 'Bad (>2.5″)'];
const transpTxt = ['', 'Superb', 'Excellent', 'Very good', 'Good', 'Average', 'Below avg', 'Poor', 'Bad'];

export default {
  id: 'weather',
  title: 'Weather & Sky Conditions',
  icon: '🌦️',
  needs: ['weather', 'air', 'seven', 'nws'],
  highlight(ctx) {
    const s = tonightSummary(ctx);
    if (!s) return null;
    const [label, lvl] = scoreLabel(s.avg);
    return { level: lvl, text: `${label} skies tonight: ${s.avgCloud}% cloud`, sub: s.best ? `Best around ${fmtTime(s.best.t)}` : '' };
  },
  render(el, ctx) {
    const st = ctx.data.weather;
    if (!st || st.status === 'loading') return (el.innerHTML = '<div class="skeleton">Loading forecast from Open-Meteo…</div>');
    if (st.status === 'error') return (el.innerHTML = `<p class="err">Couldn't load the weather forecast (${esc(st.error)}). Astronomy data below is still accurate.</p>`);
    const w = st.value;
    const units = ctx.units;
    const cur = w.current || {};
    const sum = tonightSummary(ctx);
    const warnings = weatherWarnings(ctx);
    const [label, lvl] = scoreLabel(sum?.avg);
    const rows = sum?.rows || [];
    const outlook = nightOutlook(ctx);
    const bestNight = outlook.reduce((b, n) => (!b || n.score - n.moon * 15 > b.score - b.moon * 15 ? n : b), null);
    const seven = (ctx.data.seven?.value || []).filter((d) => +d.t >= +ctx.now - 3 * HOUR && +d.t <= +ctx.night.winEnd + HOUR);
    const [cw, ci] = wmo(cur.weather_code);

    el.innerHTML = `
      <div class="wx-top">
        <div class="score-ring ${levelClass(lvl)}" style="--p:${sum?.avg ?? 0}">
          <div><b>${sum?.avg ?? '—'}</b><small>/100</small></div>
        </div>
        <div>
          <div class="kicker">Tonight's sky clarity</div>
          <div class="big ${levelClass(lvl)}">${label}</div>
          <div class="muted">${sum ? `Avg cloud ${sum.avgCloud}%${sum.best ? ` · clearest around <b>${fmtTime(sum.best.t)}</b>` : ''}` : ''}</div>
        </div>
        <div class="wx-now">
          <div class="kicker">Right now</div>
          <div class="big">${ci} ${temp(cur.temperature_2m, units)}</div>
          <div class="muted">${esc(cw)} · cloud ${cur.cloud_cover ?? '—'}% · wind ${speed(cur.wind_speed_10m, units)}</div>
        </div>
      </div>

      ${warnings.length ? `<ul class="warn-list">${warnings.map((x) => `<li class="${levelClass(x.level)}"><span>${x.icon}</span><div><b>${esc(x.title)}</b><br><small>${esc(x.text)}</small></div></li>`).join('')}</ul>` : '<p class="ok-note">✅ No weather warnings for tonight.</p>'}

      ${rows.length ? `
      <h4>Hour by hour tonight</h4>
      <div class="chart-label">Sky clarity score</div>
      ${barChart(rows.map(clarity), { labels: rows.map((r) => fmtHour(r.t)), colorFn: scoreColor, title: 'Clarity by hour' })}
      <div class="table-scroll"><table class="hourly">
        <thead><tr><th>Time</th><th></th><th>Cloud<br><small>low/mid/high</small></th><th>Precip</th><th>Temp</th><th>Wind/gust</th><th>Humidity</th><th>Visibility</th><th>Haze (AOD)</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${fmtTime(r.t)}</td><td title="${esc(wmo(r.code)[0])}">${wmo(r.code)[1]}</td>
          <td><b>${r.cloud ?? '—'}%</b> <small class="muted">${r.low ?? '–'}/${r.mid ?? '–'}/${r.high ?? '–'}</small></td>
          <td>${r.pop ?? 0}%</td><td>${temp(r.temp, units)}</td><td>${speed(r.wind, units)} / ${speed(r.gust, units)}</td>
          <td>${r.rh ?? '—'}%</td><td>${dist(r.vis, units)}</td><td>${r.aod != null ? r.aod.toFixed(2) : '—'}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}

      ${seven.length ? `
      <h4>Seeing & transparency <small class="muted">(7Timer! astro model)</small></h4>
      <div class="chips">${seven.map((d) => `<div class="chip-block"><b>${fmtTime(d.t)}</b><span>Seeing: ${seeingTxt[d.seeing] || '—'}</span><span>Transparency: ${transpTxt[d.transparency] || '—'}</span></div>`).join('')}</div>
      <p class="muted small">"Seeing" is atmospheric steadiness, which matters for planets and double stars. "Transparency" is how clear the air is, which matters for faint galaxies and the Milky Way.</p>` : ''}

      ${outlook.length ? `
      <h4>7-night outlook</h4>
      <div class="outlook">${outlook.map((n) => `<div class="night ${n === bestNight ? 'best' : ''}" title="Cloud ${n.cloud}%, precip ${n.pop}%, Moon ${Math.round(n.moon * 100)}% lit">
          <div>${fmtWeekday(n.date)}</div><small>${fmtDate(n.date).replace(/^\w+,?\s*/, '')}</small>
          <div class="dot" style="background:${scoreColor(n.score)}">${n.score}</div>
          <small>☁ ${n.cloud}%</small><small>🌙 ${Math.round(n.moon * 100)}%</small>
          ${n === bestNight ? '<em>Best</em>' : ''}</div>`).join('')}</div>` : ''}
      <p class="advisory-inline">⚠️ Conditions can change quickly. Check your local weather service for the latest updates before planning family activities.</p>
      <p class="muted small">Forecast: Open-Meteo${ctx.data.air?.value ? ' + air-quality model' : ''}${seven.length ? ', 7Timer!' : ''}${ctx.data.nws?.value ? ', US National Weather Service alerts' : ''}. Times shown in the location's time zone.</p>`;
  },
};
