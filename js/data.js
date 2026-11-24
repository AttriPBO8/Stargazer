// All external data sources. Every one is free and needs no API key.
//
//  • Open-Meteo forecast + air quality + geocoding  (open-meteo.com, CC BY 4.0)
//  • 7Timer! astronomical forecast (seeing / transparency)   (7timer.info)
//  • NOAA SWPC: OVATION aurora model, Kp index, solar wind, alerts (public domain)
//  • US National Weather Service alerts (api.weather.gov, US only, public domain)
//  • BigDataCloud client-side reverse geocoding (free tier, no key)
//  • CelesTrak / tle.ivanstanojevic.me / wheretheiss.at for satellite TLEs
//  • The Space Devs Launch Library 2 (free tier, 15 requests/hour → cached 1 h)
import { fetchJSON, HOUR } from './util.js';

const MIN = 60e3;

// ---------------------------------------------------------------- Location
export async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const j = await fetchJSON(url, { ttl: 24 * HOUR });
  return (j.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    short: r.name,
    tz: r.timezone,
    elevation: r.elevation || 0,
    country: r.country_code,
  }));
}

export async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const j = await fetchJSON(url, { ttl: 7 * 24 * HOUR });
  const place = j.city || j.locality || j.principalSubdivision || '';
  return { name: [place, j.principalSubdivision !== place ? j.principalSubdivision : '', j.countryName].filter(Boolean).join(', '), country: j.countryCode };
}

// ---------------------------------------------------------------- Weather
export async function weather(loc) {
  const hourly = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
    'precipitation_probability', 'precipitation', 'weather_code',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'visibility', 'wind_speed_10m', 'wind_gusts_10m', 'is_day',
  ].join(',');
  const current = 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,precipitation,is_day';
  const daily = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=${hourly}&current=${current}&daily=${daily}&timezone=auto&timeformat=unixtime&forecast_days=7`;
  return fetchJSON(url, { ttl: 20 * MIN });
}

export async function airQuality(loc) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&hourly=aerosol_optical_depth,dust,pm2_5,us_aqi&timezone=auto&timeformat=unixtime&forecast_days=4`;
  return fetchJSON(url, { ttl: 60 * MIN });
}

/** 7Timer! ASTRO product: cloud, seeing and transparency in 3-hour steps for 3 days. */
export async function sevenTimer(loc) {
  const url = `https://www.7timer.info/bin/astro.php?lon=${loc.lon.toFixed(2)}&lat=${loc.lat.toFixed(2)}&ac=0&unit=metric&output=json&tzshift=0`;
  const j = await fetchJSON(url, { ttl: 90 * MIN, timeout: 20000 });
  const m = String(j.init).match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error('bad 7timer init');
  const init = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]);
  return (j.dataseries || []).map((d) => ({
    t: new Date(init + d.timepoint * HOUR),
    cloud: d.cloudcover, // 1 (0-6%) … 9 (94-100%)
    seeing: d.seeing, // 1 (<0.5") … 8 (>2.5")
    transparency: d.transparency, // 1 (best) … 8 (worst)
    liftedIndex: d.lifted_index,
  }));
}

/** Official US weather alerts. Rejects outside the US (the API returns 4xx). */
export async function nwsAlerts(loc) {
  const url = `https://api.weather.gov/alerts/active?point=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
  const j = await fetchJSON(url, { ttl: 10 * MIN });
  return (j.features || []).map((f) => f.properties).map((p) => ({
    event: p.event,
    headline: p.headline,
    severity: p.severity,
    description: p.description,
    instruction: p.instruction,
    expires: p.expires || p.ends,
    sender: p.senderName,
  }));
}

// ---------------------------------------------------------------- Space weather (NOAA SWPC)
const SWPC = 'https://services.swpc.noaa.gov';

/** SWPC products come either as [header, ...rows] arrays or arrays of objects. */
function rows(json) {
  if (!Array.isArray(json) || !json.length) return [];
  if (Array.isArray(json[0])) {
    const [head, ...rest] = json;
    return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  return json;
}
const swpcTime = (s) => new Date(String(s).replace(' ', 'T').replace(/(\.\d+)?Z?$/, 'Z'));

export async function ovation() {
  const j = await fetchJSON(`${SWPC}/json/ovation_aurora_latest.json`, { ttl: 10 * MIN, timeout: 25000 });
  // coordinates: [lon 0..359, lat -90..90, probability %]
  const grid = new Map();
  for (const [lon, lat, p] of j.coordinates || []) grid.set(`${Math.round(lon)},${Math.round(lat)}`, p);
  return { observed: j['Observation Time'], forecast: j['Forecast Time'], grid };
}

export async function kpForecast() {
  const j = await fetchJSON(`${SWPC}/products/noaa-planetary-k-index-forecast.json`, { ttl: 30 * MIN });
  return rows(j)
    .map((r) => ({ t: swpcTime(r.time_tag), kp: parseFloat(r.kp ?? r.Kp), kind: r.observed || r.kind || '', scale: r.noaa_scale || null }))
    .filter((r) => !isNaN(r.kp) && !isNaN(r.t));
}

export async function kpNow() {
  const j = await fetchJSON(`${SWPC}/json/planetary_k_index_1m.json`, { ttl: 5 * MIN });
  const r = rows(j).filter((x) => x.estimated_kp != null || x.kp_index != null);
  const last = r[r.length - 1];
  return last ? { t: swpcTime(last.time_tag), kp: parseFloat(last.estimated_kp ?? last.kp_index) } : null;
}

export async function solarWind() {
  const [mag, plasma] = await Promise.all([
    fetchJSON(`${SWPC}/products/solar-wind/mag-2-hour.json`, { ttl: 5 * MIN }).then(rows).catch(() => []),
    fetchJSON(`${SWPC}/products/solar-wind/plasma-2-hour.json`, { ttl: 5 * MIN }).then(rows).catch(() => []),
  ]);
  const lastOf = (arr, key) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] != null && arr[i][key] !== '') return { v: parseFloat(arr[i][key]), t: swpcTime(arr[i].time_tag) };
    return null;
  };
  return { bz: lastOf(mag, 'bz_gsm'), bt: lastOf(mag, 'bt'), speed: lastOf(plasma, 'speed'), density: lastOf(plasma, 'density') };
}

export async function swpcAlerts() {
  const j = await fetchJSON(`${SWPC}/products/alerts.json`, { ttl: 15 * MIN });
  return (Array.isArray(j) ? j : [])
    .map((a) => ({ id: a.product_id, t: swpcTime(a.issue_datetime), message: a.message || '' }))
    .filter((a) => Date.now() - a.t < 3 * 24 * HOUR)
    .sort((a, b) => b.t - a.t);
}

// ---------------------------------------------------------------- Satellites
export const SATELLITES = [
  { id: 25544, name: 'ISS', full: 'International Space Station', stdMag: -1.8 },
  { id: 48274, name: 'Tiangong', full: 'Tiangong (Chinese Space Station)', stdMag: -0.8 },
  { id: 20580, name: 'Hubble', full: 'Hubble Space Telescope', stdMag: 2.2 },
];

export async function tle(noradId) {
  const sources = [
    async () => {
      const t = await fetchJSON(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`, { ttl: 12 * HOUR, text: true });
      const l = t.trim().split(/\r?\n/).map((s) => s.trim());
      const i = l.findIndex((s) => s.startsWith('1 '));
      if (i < 0 || !l[i + 1]?.startsWith('2 ')) throw new Error('bad TLE');
      return [l[i], l[i + 1]];
    },
    async () => {
      const j = await fetchJSON(`https://tle.ivanstanojevic.me/api/tle/${noradId}`, { ttl: 12 * HOUR });
      return [j.line1, j.line2];
    },
    async () => {
      if (noradId !== 25544) throw new Error('n/a');
      const j = await fetchJSON(`https://api.wheretheiss.at/v1/satellites/25544/tles`, { ttl: 12 * HOUR });
      return [j.line1, j.line2];
    },
  ];
  let lastErr;
  for (const s of sources) {
    try {
      const r = await s();
      if (r[0] && r[1]) return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No TLE source reachable');
}

// ---------------------------------------------------------------- Rocket launches
export async function launches() {
  const urls = [
    'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=12&mode=normal',
    'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=normal',
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const j = await fetchJSON(u, { ttl: HOUR });
      return (j.results || []).map((l) => ({
        name: l.name,
        net: new Date(l.net),
        status: l.status?.abbrev || l.status?.name || '',
        provider: l.launch_service_provider?.name || '',
        rocket: l.rocket?.configuration?.full_name || l.rocket?.configuration?.name || '',
        mission: l.mission?.description || '',
        orbit: l.mission?.orbit?.abbrev || '',
        pad: l.pad?.name || '',
        location: l.pad?.location?.name || '',
        lat: parseFloat(l.pad?.latitude),
        lon: parseFloat(l.pad?.longitude),
        image: typeof l.image === 'string' ? l.image : l.image?.thumbnail_url || l.image?.image_url || '',
        webcast: l.webcast_live,
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- Dark-sky spots (OpenStreetMap)
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Run an Overpass QL query, trying public mirrors in turn. */
export async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      return await fetchJSON(url, { body: 'data=' + encodeURIComponent(query), timeout: 60000 });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

/** Elevation (m) for up to 100 points per request (Open-Meteo, Copernicus DEM). */
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${chunk.map((p) => p.lon.toFixed(4)).join(',')}`;
    const j = await fetchJSON(url, { ttl: 30 * 24 * HOUR });
    out.push(...(j.elevation || chunk.map(() => null)));
  }
  return out;
}

/** Hourly cloud cover for several sites in one request. Returns one row array per site. */
export async function multiCloud(points) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${points.map((p) => p.lon.toFixed(3)).join(',')}&hourly=cloud_cover,precipitation_probability&timeformat=unixtime&forecast_days=3`;
  const j = await fetchJSON(url, { ttl: 30 * MIN });
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((r) => (r.hourly?.time || []).map((t, i) => ({ t: new Date(t * 1000), cloud: r.hourly.cloud_cover?.[i], pop: r.hourly.precipitation_probability?.[i] })));
}
