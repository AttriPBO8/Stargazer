// Dark-sky spots nearby: parks, reserves, viewpoints, observatories and campgrounds
// from OpenStreetMap (Overpass API), ranked for stargazing.
//
// Sky darkness is *estimated* with a simple light-pollution model (Walker's law):
// every town/city adds  population / distance^2.5  of sky glow. The total is mapped
// onto the Bortle scale. Elevation comes from Open-Meteo and tonight's cloud cover
// at each site from the Open-Meteo forecast. All free and key-less.
/* global L */
import { esc, fmtTime, compass, clamp, distanceKm, bearing, store, DAY, levelClass } from '../util.js';
import { overpass, elevations } from '../data.js';

const PARK_RE = 'State Park|Provincial Park|Country Park|Regional Park|National|Conservation|Wilderness|Forest|Reserve|Preserve|Dark Sky|Recreation Area|Heath|Moor|Dunes|Beach|Mountain';
const BORTLE = ['', 'Excellent dark sky', 'Truly dark sky', 'Rural sky', 'Rural / suburban transition', 'Suburban sky', 'Bright suburban sky', 'Suburban / urban transition', 'City sky', 'Inner-city sky'];
export const bortleColor = (b) => (b <= 2 ? '#3ddc97' : b <= 3 ? '#8fd65a' : b <= 4 ? '#e8d36a' : b <= 5 ? '#ffab5a' : b <= 6 ? '#ff8a5c' : '#ff6b7a');

function classify(t) {
  const name = t.name || '';
  if (t.man_made === 'observatory') return { kind: 'Observatory', icon: '🔭', w: 1.0 };
  if (/dark.?sky/i.test(name) || t.dark_sky || t['dark_sky:designation']) return { kind: 'Dark Sky Place', icon: '🌌', w: 1.0 };
  if (t.boundary === 'national_park') return { kind: 'National park', icon: '🏞️', w: 0.9 };
  if (t.tourism === 'viewpoint') return { kind: 'Viewpoint', icon: '⛰️', w: name ? 0.85 : 0.6 };
  if (t.tourism === 'camp_site') return { kind: 'Campground', icon: '⛺', w: 0.65 };
  if (t.leisure === 'nature_reserve') return { kind: 'Nature reserve', icon: '🌲', w: 0.7 };
  if (t.boundary === 'protected_area') return { kind: 'Protected area', icon: '🌿', w: 0.65 };
  return { kind: 'Park', icon: '🌳', w: 0.55 };
}

function lightPollution(lat, lon, towns) {
  let lp = 0;
  for (const t of towns) {
    const d = Math.max(distanceKm(lat, lon, t.lat, t.lon), 0.012 * Math.sqrt(t.pop), 1);
    lp += t.pop / d ** 2.5;
  }
  return clamp(1.5 + 2.1 * Math.log10(lp + 0.3), 1, 9);
}

/** Query OSM and score candidate sites. Cached for 3 days per location/radius. */
export async function findSpots(loc, radiusKm) {
  const cacheKey = `spots:v1:${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${radiusKm}`;
  const cached = store.get(cacheKey);
  if (cached && Date.now() - cached.t < 3 * DAY) return cached.v;

  const a = `(around:${radiusKm * 1000},${loc.lat.toFixed(4)},${loc.lon.toFixed(4)})`;
  const a2 = `(around:${(radiusKm + 80) * 1000},${loc.lat.toFixed(4)},${loc.lon.toFixed(4)})`;
  const q = `[out:json][timeout:60];
(
  nwr["boundary"="national_park"]${a};
  nwr["leisure"="nature_reserve"]["name"]${a};
  nwr["boundary"="protected_area"]["name"]${a};
  nwr["leisure"="park"]["name"~"${PARK_RE}",i]${a};
  nwr["name"~"dark.?sky",i]${a};
  nwr["man_made"="observatory"]${a};
  node["tourism"="viewpoint"]${a};
  nwr["tourism"="camp_site"]["name"]${a};
)->.s;
node.s; out body 800;
(way.s; relation.s;); out tags bb 800;
node["place"~"^(city|town)$"]${a2};
out body;`;
  const j = await overpass(q);
  const els = j.elements || [];
  const towns = [];
  const raw = [];
  for (const e of els) {
    const t = e.tags || {};
    if ((t.place === 'city' || t.place === 'town') && e.type === 'node') {
      const pop = parseInt(String(t.population || '').replace(/[^\d]/g, ''), 10) || (t.place === 'city' ? 150000 : 15000);
      towns.push({ lat: e.lat, lon: e.lon, pop, name: t.name });
      continue;
    }
    if (/^(private|no)$/.test(t.access || '')) continue;
    let lat = e.lat, lon = e.lon, area = 0;
    if (e.bounds) {
      const b = e.bounds;
      lat = (b.minlat + b.maxlat) / 2;
      lon = (b.minlon + b.maxlon) / 2;
      area = Math.abs(b.maxlat - b.minlat) * 111 * Math.abs(b.maxlon - b.minlon) * 111 * Math.cos(lat * Math.PI / 180) * 0.6;
    } else if (e.center) ({ lat, lon } = e.center);
    if (lat == null || lon == null) continue;
    const c = classify(t);
    if (['Park', 'Nature reserve', 'Protected area'].includes(c.kind) && e.bounds && area < 0.3) continue; // too small to escape lights
    raw.push({
      id: `${e.type}/${e.id}`, name: t.name || (c.kind === 'Viewpoint' ? 'Unnamed viewpoint' : c.kind), named: !!t.name, ...c, lat, lon, area,
      ele: parseFloat(t.ele) || null, hours: t.opening_hours || '', fee: t.fee || '', website: t.website || t['contact:website'] || '', desc: t.description || '',
    });
  }
  // De-duplicate: the same park often appears as a protected area *and* a reserve.
  const sites = [];
  for (const s of raw.sort((x, y) => y.w - x.w || y.area - x.area)) {
    const dup = sites.find((o) => o.named && s.named && o.name.toLowerCase() === s.name.toLowerCase() && distanceKm(o.lat, o.lon, s.lat, s.lon) < 15);
    if (dup) { dup.area = Math.max(dup.area, s.area); continue; }
    if (!s.named && sites.some((o) => distanceKm(o.lat, o.lon, s.lat, s.lon) < 1)) continue;
    sites.push(s);
  }
  for (const s of sites) {
    s.dist = distanceKm(loc.lat, loc.lon, s.lat, s.lon);
    s.dir = compass(bearing(loc.lat, loc.lon, s.lat, s.lon));
    s.bortle = lightPollution(s.lat, s.lon, towns);
    s.darkness = (9 - s.bortle) / 8;
    s.proximity = clamp(1 - s.dist / radiusKm, 0, 1);
    s.size = s.kind === 'Viewpoint' || s.kind === 'Observatory' ? 0.6 : clamp(Math.log10(s.area + 1) / 2, 0, 1);
    s.pre = 0.5 * s.darkness + 0.2 * s.w + 0.15 * s.proximity + 0.15 * s.size;
  }
  const top = sites.sort((x, y) => y.pre - x.pre).slice(0, 60);
  const userBortle = lightPollution(loc.lat, loc.lon, towns);
  let userEle = loc.elevation || 0;
  try {
    const el = await elevations([loc, ...top]);
    userEle = el[0] ?? userEle;
    top.forEach((s, i) => { s.ele = el[i + 1] ?? s.ele; });
  } catch { /* elevation is a bonus */ }
  for (const s of top) {
    const rise = s.ele != null ? clamp((s.ele - userEle) / 800, 0, 1) : 0;
    s.elevBonus = rise;
    s.score = Math.round(100 * (0.45 * s.darkness + 0.2 * s.w + 0.15 * s.proximity + 0.1 * s.size + 0.1 * rise));
  }
  const result = {
    sites: top.sort((x, y) => y.score - x.score).slice(0, 40),
    userBortle, userEle, radiusKm, found: sites.length, towns: towns.length,
  };
  store.set(cacheKey, { t: Date.now(), v: result });
  return result;
}

/** Average cloud cover at each site during tonight's dark hours. */
function cloudTonight(rows, night) {
  if (!rows?.length) return null;
  const from = night.dark ? night.dark[0] : night.winStart;
  const to = night.dark ? night.dark[1] : night.winEnd;
  const sel = rows.filter((r) => r.t >= from - 1800e3 && r.t <= +to + 1800e3 && r.cloud != null);
  if (!sel.length) return null;
  return { cloud: Math.round(sel.reduce((a, r) => a + r.cloud, 0) / sel.length), pop: Math.max(...sel.map((r) => r.pop ?? 0)) };
}

let mapInst = null;

export default {
  id: 'spots',
  title: 'Dark-Sky Spots Nearby',
  icon: '🏞️',
  needs: ['spots', 'spotsWx'],
  highlight(ctx) {
    const v = ctx.data.spots?.value;
    const s = v?.sites?.[0];
    if (!s) return null;
    const d = ctx.units === 'imperial' ? `${Math.round(s.dist / 1.609)} mi` : `${Math.round(s.dist)} km`;
    return { level: s.bortle <= 4 ? 'good' : 'ok', text: `Best spot: ${s.name}`, sub: `~Bortle ${Math.round(s.bortle)}, ${d} ${s.dir}` };
  },
  render(el, ctx) {
    const radius = store.get('spotRadius', 60);
    const sort = store.get('spotSort', 'best');
    const st = ctx.data.spots;
    const controls = `<div class="spots-controls">
        <label>Search within <select data-radius>${[25, 40, 60, 100, 150].map((r) => `<option value="${r}" ${r === radius ? 'selected' : ''}>${r} km</option>`).join('')}</select></label>
        <label>Sort by <select data-sort>${[['best', 'Best overall'], ['tonight', 'Best tonight (clouds)'], ['dark', 'Darkest sky'], ['close', 'Closest']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>`;
    const wire = () => {
      el.querySelector('[data-radius]')?.addEventListener('change', (e) => { store.set('spotRadius', +e.target.value); ctx.data.spotsWx = null; ctx.load('spots', true); });
      el.querySelector('[data-sort]')?.addEventListener('change', (e) => { store.set('spotSort', e.target.value); this.render(el, ctx); });
    };

    if (!st) {
      // Only query OpenStreetMap once the section is actually on screen.
      el.innerHTML = `${controls}<div class="skeleton">Scroll here to search OpenStreetMap for dark-sky spots… <button class="btn small" data-go>Search now</button></div>`;
      wire();
      el.querySelector('[data-go]').addEventListener('click', () => ctx.load('spots'));
      const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { io.disconnect(); ctx.load('spots'); } }, { rootMargin: '200px' });
      io.observe(el);
      return;
    }
    if (st.status === 'loading') { el.innerHTML = `${controls}<div class="skeleton">Searching OpenStreetMap for parks, reserves, viewpoints and observatories within ${radius} km…</div>`; wire(); return; }
    if (st.status === 'error') {
      el.innerHTML = `${controls}<p class="err">Couldn't reach the OpenStreetMap Overpass service (${esc(st.error)}). It's a free community server and can be busy, so try again in a minute or use a smaller radius.</p><button class="btn small" data-retry>Retry</button>`;
      wire();
      el.querySelector('[data-retry]').addEventListener('click', () => ctx.load('spots', true));
      return;
    }
    const v = st.value;
    if (!v.sites.length) { el.innerHTML = `${controls}<p class="muted">No parks or viewpoints were found within ${v.radiusKm} km. Try a larger radius.</p>`; wire(); return; }

    // Tonight's clouds at the top sites
    if (!ctx.data.spotsWx) ctx.load('spotsWx');
    const wx = ctx.data.spotsWx?.value;
    const userWx = wx ? cloudTonight(wx[0], ctx.night) : null;
    v.sites.forEach((s, i) => { s.wx = wx && i < 12 ? cloudTonight(wx[i + 1], ctx.night) : null; });

    const sites = [...v.sites];
    const tonightScore = (s) => (s.wx ? s.score * (1 - 0.8 * s.wx.cloud / 100) * (1 - 0.5 * (s.wx.pop || 0) / 100) : s.score * 0.4);
    if (sort === 'dark') sites.sort((a, b) => a.bortle - b.bortle);
    else if (sort === 'close') sites.sort((a, b) => a.dist - b.dist);
    else if (sort === 'tonight') sites.sort((a, b) => tonightScore(b) - tonightScore(a));
    const shown = sites.slice(0, 15);
    const best = shown[0];
    const ub = Math.round(v.userBortle);
    const darker = v.sites.filter((s) => s.bortle <= v.userBortle - 1.5).length;
    const imp = ctx.units === 'imperial';
    const dist = (km) => (imp ? `${Math.round(km / 1.609)} mi` : `${Math.round(km)} km`);
    const elev = (m) => (imp ? `${Math.round(m * 3.281).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);
    const dl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;

    el.innerHTML = `${controls}
      <p class="tip">📍 Your location's sky is roughly <b style="color:${bortleColor(ub)}">Bortle ${ub}</b> (${BORTLE[ub]})${userWx ? `, with ${userWx.cloud}% cloud expected tonight` : ''}.
        ${darker ? `<b>${darker}</b> of the spots below have noticeably darker skies.` : 'There are no much darker spots within this radius. Try a larger one.'}
        ${best ? ` Top pick${sort === 'tonight' ? ' for tonight' : ''}: <b>${esc(best.name)}</b>, ${dist(best.dist)} ${best.dir}.` : ''}</p>
      <div class="spots-layout">
        <div class="spots-map" aria-label="Map of stargazing spots"></div>
        <ol class="spots">${shown.map((s, i) => `
          <li data-i="${i}">
            <span class="rank" style="background:${bortleColor(s.bortle)}">${i + 1}</span>
            <div class="spot-main">
              <div class="spot-title"><b>${s.icon} ${esc(s.name)}</b> <em class="tag">${s.kind}</em></div>
              <div class="spot-meta">
                <span>${dist(s.dist)} ${s.dir} · ~${Math.max(5, Math.round((s.dist * 1.35) / 65 * 60 / 5) * 5)} min drive</span>
                <span style="color:${bortleColor(s.bortle)}">● ~Bortle ${Math.round(s.bortle)}: ${BORTLE[Math.round(s.bortle)]}</span>
                ${s.ele != null ? `<span>⛰ ${elev(s.ele)}${s.elevBonus > 0.15 ? ' (above the haze)' : ''}</span>` : ''}
                ${s.wx ? `<span class="${levelClass(s.wx.cloud < 30 ? 'good' : s.wx.cloud < 60 ? 'ok' : 'warn')}">☁ ${s.wx.cloud}% cloud tonight${s.wx.pop >= 40 ? `, ${s.wx.pop}% rain` : ''}</span>` : ''}
                <span class="muted">Score ${s.score}/100</span>
              </div>
              ${s.hours || s.fee ? `<div class="small muted">${s.hours ? `🕒 ${esc(s.hours)}` : ''}${s.fee ? ` · Fee: ${esc(s.fee)}` : ''}</div>` : ''}
              <div class="spot-links"><a href="${dl(s)}" target="_blank" rel="noopener">🧭 Directions</a><a href="https://www.openstreetmap.org/${s.id}" target="_blank" rel="noopener">🗺 OpenStreetMap</a><a href="https://www.lightpollutionmap.info/#zoom=10&lat=${s.lat.toFixed(4)}&lon=${s.lon.toFixed(4)}" target="_blank" rel="noopener">💡 Light pollution</a>${s.website ? `<a href="${esc(s.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ''}<button class="link-btn" data-fly="${i}">📍 Show on map</button></div>
            </div>
          </li>`).join('')}</ol>
      </div>
      <div class="legend">${[1, 3, 4, 5, 6, 7].map((b) => `<span><i style="background:${bortleColor(b)}"></i>Bortle ${b === 1 ? '1–2' : b === 7 ? '7–9' : b}</span>`).join('')}</div>
      <p class="muted small">⚠️ Many parks close at dusk. Check the opening hours and night-access rules, and ask about astronomy permits. Tell someone where you're going, bring a red torch, and watch for wildlife. Sky darkness is an estimate based on the population and distance of nearby towns, so verify it on the light-pollution map. Places come from © OpenStreetMap contributors (${v.found} candidates, ${v.towns} towns modelled).</p>`;
    wire();

    // ---- map
    if (mapInst) { mapInst.remove(); mapInst = null; }
    const mapEl = el.querySelector('.spots-map');
    if (!window.L) { mapEl.innerHTML = '<p class="muted">Map library unavailable.</p>'; return; }
    mapInst = L.map(mapEl, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(mapInst);
    L.circleMarker([ctx.loc.lat, ctx.loc.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#7aa2ff', fillOpacity: 1 }).addTo(mapInst).bindTooltip('You are here');
    const markers = shown.map((s, i) => L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: 'spot-pin', html: `<span style="background:${bortleColor(s.bortle)}">${i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      title: s.name,
    }).addTo(mapInst).bindPopup(`<b>${esc(s.name)}</b><br>${s.kind} · ~Bortle ${Math.round(s.bortle)}<br>${dist(s.dist)} ${s.dir}${s.wx ? ` · ☁ ${s.wx.cloud}% tonight` : ''}<br><a href="${dl(s)}" target="_blank" rel="noopener">Directions</a>`));
    const pts = [[ctx.loc.lat, ctx.loc.lon], ...shown.map((s) => [s.lat, s.lon])];
    mapInst.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 11 });
    setTimeout(() => mapInst?.invalidateSize(), 50);
    el.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.fly;
      mapInst.flyTo([shown[i].lat, shown[i].lon], 12, { duration: 0.8 });
      markers[i].openPopup();
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  },
};
