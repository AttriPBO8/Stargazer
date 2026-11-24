// Upcoming rocket launches (The Space Devs Launch Library 2, free tier).
import { esc, fmtDateTime, relDays, distanceKm, icsLink } from '../util.js';
import { observer, sunAlt } from '../astro.js';

export function launchList(ctx) {
  const list = ctx.data.launches?.value || [];
  const obs = observer(ctx.loc);
  return list.filter((l) => +l.net > +ctx.now - 3600e3).map((l) => {
    const km = isNaN(l.lat) ? null : distanceKm(ctx.loc.lat, ctx.loc.lon, l.lat, l.lon);
    const sa = sunAlt(l.net, obs);
    const twilight = sa < -4 && sa > -18;
    return { ...l, km, visible: km != null && km < 900 && sa < -4, jellyfish: km != null && km < 1500 && twilight };
  });
}

export default {
  id: 'launches',
  title: 'Rocket Launches',
  icon: '🚀',
  needs: ['launches'],
  highlight(ctx) {
    const list = launchList(ctx);
    const vis = list.find((l) => l.visible || l.jellyfish);
    if (vis) return { level: 'good', text: `Launch may be visible: ${vis.name.split('|')[0].trim()}`, sub: `${fmtDateTime(vis.net)} · ${Math.round(vis.km)} km away` };
    if (list[0]) return { level: 'info', text: `Next launch: ${list[0].name.split('|')[0].trim()}`, sub: relDays(list[0].net, ctx.now) };
    return null;
  },
  render(el, ctx) {
    const st = ctx.data.launches;
    if (!st || st.status === 'loading') return (el.innerHTML = '<div class="skeleton">Loading launch schedule…</div>');
    if (st.status === 'error') return (el.innerHTML = `<p class="err">Launch schedule unavailable (${esc(st.error)}). The free API allows 15 requests an hour, so please try later.</p>`);
    const list = launchList(ctx);
    el.innerHTML = `<ul class="list launches">${list.slice(0, 10).map((l) => `
      <li class="${l.visible || l.jellyfish ? 'row-hl' : ''}"><span>${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : '🚀'}<span><b>${esc(l.name)}</b>
        <br><small class="muted">${esc(l.provider)} · ${esc(l.location || l.pad)}${l.km != null ? ` · ${Math.round(l.km).toLocaleString()} km from you` : ''}</small>
        ${l.visible ? '<br><em class="tag tag-good">May be visible from your location</em>' : ''}${l.jellyfish ? ' <em class="tag tag-super">Twilight launch: possible "jellyfish" plume</em>' : ''}
        ${l.status ? `<br><small>Status: ${esc(l.status)}${l.orbit ? ` · Orbit: ${esc(l.orbit)}` : ''}</small>` : ''}</span></span>
        <span class="nowrap">${fmtDateTime(l.net)}<br><small class="muted">${relDays(l.net, ctx.now)}</small> <a class="ics" download="launch.ics" href="${icsLink(l.name, l.net, 30, l.mission)}">📅</a></span></li>`).join('')}</ul>
      <p class="muted small">Data: The Space Devs Launch Library 2 (free tier). Launch times often slip, so confirm on launch day.</p>`;
  },
};
