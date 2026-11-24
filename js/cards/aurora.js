// Aurora (northern & southern lights) using NOAA SWPC data.
import { esc, fmtTime, fmtDateTime, fmtHour, fmtWeekday, barChart, norm360, clamp, levelClass, HOUR } from '../util.js';
import { geomagneticLat } from '../astro.js';
import { tonightSummary } from './weather.js';

const gScale = (kp) => (kp >= 9 ? 'G5 Extreme' : kp >= 8 ? 'G4 Severe' : kp >= 7 ? 'G3 Strong' : kp >= 6 ? 'G2 Moderate' : kp >= 5 ? 'G1 Minor' : kp >= 4 ? 'Active' : 'Quiet');
const kpColor = (kp) => (kp >= 7 ? 'var(--bad)' : kp >= 5 ? 'var(--warn)' : kp >= 4 ? 'var(--ok)' : 'var(--good-dim)');

/** Rough Kp needed for aurora to appear low on the poleward horizon. */
export function kpNeeded(lat, lon) {
  const m = Math.abs(geomagneticLat(lat, lon));
  return clamp(Math.round(((65 - m) / 2) * 10) / 10, 0, 9.5);
}

export function auroraAssessment(ctx) {
  const { lat, lon } = ctx.loc;
  const ov = ctx.data.ovation?.value;
  const kpf = ctx.data.kp?.value || [];
  const need = kpNeeded(lat, lon);
  let local = null, horizon = null;
  if (ov) {
    const L = (la, lo) => ov.grid.get(`${Math.round(norm360(lo)) % 360},${Math.round(la)}`) ?? 0;
    local = L(lat, lon);
    horizon = local;
    const dir = lat >= 0 ? 1 : -1;
    // Aurora high in the sky 400–900 km poleward is visible on your horizon.
    for (let k = 1; k <= 8; k++) for (let d = -3; d <= 3; d++) horizon = Math.max(horizon, L(lat + dir * k, lon + d) * (k <= 4 ? 1 : 0.7));
  }
  const upcoming = kpf.filter((r) => +r.t >= +ctx.now - 3 * HOUR);
  const tonight = upcoming.filter((r) => +r.t <= +ctx.night.winEnd);
  const maxTonight = tonight.length ? Math.max(...tonight.map((r) => r.kp)) : null;
  const max3d = upcoming.length ? upcoming.reduce((b, r) => (r.kp > b.kp ? r : b), upcoming[0]) : null;

  let score = 0; // 0 very low … 3 high
  if (local != null) {
    if (local >= 30 || horizon >= 50) score = 3;
    else if (local >= 10 || horizon >= 20) score = 2;
    else if (horizon >= 5) score = 1;
  }
  if (maxTonight != null) {
    if (maxTonight >= need + 1.5) score = Math.max(score, 3);
    else if (maxTonight >= need) score = Math.max(score, 2);
    else if (maxTonight >= need - 1) score = Math.max(score, 1);
  }
  const labels = [['Very low', 'bad'], ['Low', 'warn'], ['Moderate', 'ok'], ['High', 'good']];
  const [label, level] = labels[score];
  return { local, horizon, need, maxTonight, max3d, score, label, level, mlat: geomagneticLat(lat, lon) };
}

export default {
  id: 'aurora',
  title: 'Aurora (Northern & Southern Lights)',
  icon: '🌌',
  needs: ['ovation', 'kp', 'kpNow', 'wind', 'alerts', 'weather'],
  highlight(ctx) {
    if (!ctx.data.ovation?.value && !ctx.data.kp?.value) return null;
    const a = auroraAssessment(ctx);
    return { level: a.level, text: `Aurora chance: ${a.label}`, sub: `Kp ${a.maxTonight?.toFixed(1) ?? '—'} tonight; Kp ${a.need} needed here` };
  },
  render(el, ctx) {
    const loading = ['ovation', 'kp'].every((k) => !ctx.data[k] || ctx.data[k].status === 'loading');
    if (loading) return (el.innerHTML = '<div class="skeleton">Loading NOAA space-weather data…</div>');
    const failed = ['ovation', 'kp'].every((k) => ctx.data[k]?.status === 'error');
    if (failed) return (el.innerHTML = `<p class="err">NOAA SWPC is unreachable right now (${esc(ctx.data.kp?.error)}). Try again in a few minutes.</p>`);

    const a = auroraAssessment(ctx);
    const south = ctx.loc.lat < 0;
    const kpNow = ctx.data.kpNow?.value;
    const wind = ctx.data.wind?.value || {};
    const wx = tonightSummary(ctx);
    const kpf = (ctx.data.kp?.value || []).filter((r) => +r.t >= +ctx.now - 3 * HOUR).slice(0, 24);
    const alerts = (ctx.data.alerts?.value || []).filter((x) => /geomagnetic|k-index|aurora|CME|storm/i.test(x.message)).slice(0, 4);
    const dark = ctx.night.dark;
    const blockers = [];
    if (wx && wx.avgCloud >= 70) blockers.push(`clouds (${wx.avgCloud}%)`);
    if (!dark) blockers.push('no full darkness tonight');
    const bz = wind.bz?.v, sp = wind.speed?.v;

    el.innerHTML = `
      <div class="aurora-top">
        <div class="gauge ${levelClass(a.level)}">
          <div class="kicker">Chance to see aurora</div>
          <div class="big">${a.label}</div>
          ${blockers.length ? `<div class="muted small">⚠️ Limited by ${blockers.join(' and ')}</div>` : ''}
        </div>
        <div class="stats">
          <div><span>Overhead probability</span><b>${a.local != null ? a.local + '%' : '—'}</b></div>
          <div><span>On the ${south ? 'southern' : 'northern'} horizon</span><b>${a.horizon != null ? Math.round(a.horizon) + '%' : '—'}</b></div>
          <div><span>Kp now</span><b style="color:${kpColor(kpNow?.kp ?? 0)}">${kpNow ? kpNow.kp.toFixed(1) : '—'}</b></div>
          <div><span>Max Kp tonight</span><b style="color:${kpColor(a.maxTonight ?? 0)}">${a.maxTonight?.toFixed(1) ?? '—'}</b></div>
          <div><span>Kp needed here</span><b>≈ ${a.need}</b></div>
          <div><span>Geomagnetic latitude</span><b>${a.mlat.toFixed(1)}°</b></div>
        </div>
      </div>

      ${kpf.length ? `<h4>Kp index forecast (3-hour blocks)</h4>
        ${barChart(kpf.map((r) => r.kp), { max: 9, labels: kpf.map((r) => `${fmtWeekday(r.t)} ${fmtHour(r.t)}`), colorFn: kpColor, title: 'Kp forecast' })}
        <p class="muted small">Peak in next 3 days: <b>Kp ${a.max3d?.kp.toFixed(1)}</b> (${gScale(a.max3d?.kp ?? 0)}) at ${fmtDateTime(a.max3d?.t)}. Aurora may reach your horizon at around Kp ${a.need} or higher.</p>` : ''}

      <div class="two-col">
        <div>
          <h4>Solar wind (live)</h4>
          <ul class="kv">
            <li><span>Bz (north–south field)</span><b class="${bz != null && bz <= -5 ? 'lvl-good' : ''}">${bz != null ? bz.toFixed(1) + ' nT' : '—'}</b></li>
            <li><span>Speed</span><b class="${sp >= 500 ? 'lvl-good' : ''}">${sp != null ? Math.round(sp) + ' km/s' : '—'}</b></li>
            <li><span>Density</span><b>${wind.density?.v != null ? wind.density.v.toFixed(1) + ' p/cm³' : '—'}</b></li>
          </ul>
          <p class="muted small">A strongly negative (southward) Bz and speeds above 500 km/s help aurora develop. Changes reach Earth in roughly 30–60 minutes.</p>
          <h4>Tips</h4>
          <ul class="tips">
            <li>Face <b>${south ? 'south' : 'north'}</b> and get away from city lights.</li>
            <li>The best window is usually 22:00–02:00 local time${dark ? `. Darkness tonight runs ${fmtTime(dark[0])}–${fmtTime(dark[1])}` : ''}.</li>
            <li>Phone cameras in night mode often show aurora that your eyes can't see.</li>
          </ul>
        </div>
        <figure class="ovation">
          <img loading="lazy" src="https://services.swpc.noaa.gov/images/animations/ovation/${south ? 'south' : 'north'}/latest.jpg" alt="NOAA OVATION aurora forecast map for the ${south ? 'southern' : 'northern'} hemisphere">
          <figcaption>NOAA OVATION 30–90 minute forecast${ctx.data.ovation?.value?.forecast ? ` (valid ${fmtTime(new Date(ctx.data.ovation.value.forecast))})` : ''}</figcaption>
        </figure>
      </div>

      ${alerts.length ? `<h4>Recent SWPC alerts</h4><ul class="alerts">${alerts.map((x) => `<li><small>${fmtDateTime(x.t)}</small><div>${esc(x.message.split(/\r?\n/).filter((l) => /^(ALERT|WATCH|WARNING|SUMMARY|EXTENDED WARNING|CANCEL)/i.test(l)).slice(0, 1).join('') || x.message.split(/\r?\n/).find((l) => l.trim().length > 20) || x.id)}</div></li>`).join('')}</ul>` : ''}
      <p class="muted small">Data: NOAA Space Weather Prediction Center (OVATION model, planetary K-index, DSCOVR/ACE solar wind). "Kp needed" is a rough guide based on a dipole model of Earth's magnetic field.</p>`;
  },
};
