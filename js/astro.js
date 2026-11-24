// Astronomy core built on Astronomy Engine (MIT, vendored in /vendor).
// Everything here is computed locally in the browser — no API needed.
/* global Astronomy */
import { DEG, RAD, DAY, HOUR, toDate, norm360 } from './util.js';

export const A = () => window.Astronomy;

export function observer(loc) {
  return new (A().Observer)(loc.lat, loc.lon, loc.elevation || 0);
}

/** Altitude/azimuth of a solar-system body. */
export function bodyHorizon(body, date, obs) {
  const eq = A().Equator(body, date, obs, true, true);
  const hor = A().Horizon(date, obs, eq.ra, eq.dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth, ra: eq.ra, dec: eq.dec, dist: eq.dist };
}

export const sunAlt = (date, obs) => bodyHorizon(A().Body.Sun, date, obs).alt;
export const moonAlt = (date, obs) => bodyHorizon(A().Body.Moon, date, obs).alt;

/**
 * Fast J2000 RA/Dec (degrees) → alt/az (degrees) for many stars at once.
 * Precession is ignored (<0.4° today) which is plenty for a sky chart.
 */
export function makeStarProjector(date, lat, lon) {
  const lst = norm360(A().SiderealTime(date) * 15 + lon) * DEG;
  const sinPhi = Math.sin(lat * DEG);
  const cosPhi = Math.cos(lat * DEG);
  return (raDeg, decDeg) => {
    const H = lst - raDeg * DEG;
    const d = decDeg * DEG;
    const sinD = Math.sin(d), cosD = Math.cos(d), cosH = Math.cos(H);
    const sinAlt = sinPhi * sinD + cosPhi * cosD * cosH;
    const alt = Math.asin(sinAlt);
    const az = Math.atan2(-cosD * Math.sin(H), sinD * cosPhi - cosD * cosH * sinPhi);
    return { alt: alt * RAD, az: norm360(az * RAD) };
  };
}

function search(fn) {
  try {
    const t = fn();
    return t ? toDate(t) : null;
  } catch {
    return null;
  }
}

/**
 * Work out "tonight": the current night if the Sun is already down,
 * otherwise the coming night. Returns sunset/sunrise and all twilight stages.
 */
export function nightInfo(loc, now = new Date(), _ahead = false) {
  const obs = observer(loc);
  const S = A().Body.Sun;
  const altNow = sunAlt(now, obs);
  let start, end;
  // Already in morning twilight? Then "tonight" means the coming night.
  if (!_ahead && altNow < -0.833 && altNow > -12 && sunAlt(new Date(+now + 10 * 60e3), obs) > altNow) {
    const sr = search(() => A().SearchRiseSet(S, obs, +1, now, 1));
    if (sr) return { ...nightInfo(loc, new Date(+sr + 60e3), true), planningAhead: true };
  }
  if (altNow < -0.833) {
    // Night in progress: find the sunset before now and the sunrise after.
    start = search(() => A().SearchRiseSet(S, obs, -1, new Date(now - DAY), 1));
    if (start && start > now) start = null;
    end = search(() => A().SearchRiseSet(S, obs, +1, now, 1));
  } else {
    start = search(() => A().SearchRiseSet(S, obs, -1, now, 1.5));
    end = start ? search(() => A().SearchRiseSet(S, obs, +1, start, 1.5)) : null;
  }
  const polar = !start || !end;
  // Polar day/night fall-backs keep the rest of the app working.
  const winStart = start || (altNow < -0.833 ? new Date(now - 6 * HOUR) : now);
  const winEnd = end || new Date(winStart.getTime() + DAY);

  const stage = (alt) => ({
    dusk: search(() => A().SearchAltitude(S, obs, -1, winStart, 1, alt)),
    dawn: search(() => A().SearchAltitude(S, obs, +1, winStart, 1.5, alt)),
  });
  const civil = stage(-6), nautical = stage(-12), astro = stage(-18);
  // Discard dawns that belong to a different night.
  for (const s of [civil, nautical, astro]) {
    if (s.dusk && s.dusk > winEnd) s.dusk = null;
    if (s.dawn && (s.dawn > winEnd || (s.dusk && s.dawn < s.dusk))) s.dawn = null;
  }
  const midSun = sunAlt(new Date((winStart.getTime() + winEnd.getTime()) / 2), obs);
  let dark = null, darkKind = 'astronomical';
  if (astro.dusk && astro.dawn) dark = [astro.dusk, astro.dawn];
  else if (midSun < -18) dark = [astro.dusk || winStart, astro.dawn || winEnd];
  else if (nautical.dusk && nautical.dawn) { dark = [nautical.dusk, nautical.dawn]; darkKind = 'nautical'; }
  else if (civil.dusk && civil.dawn) { dark = [civil.dusk, civil.dawn]; darkKind = 'civil'; }

  let polarKind = null;
  if (polar) polarKind = altNow > 0 ? 'midnight-sun' : 'polar-night';

  return { obs, sunset: start, sunrise: end, winStart, winEnd, civil, nautical, astro, dark, darkKind, polar, polarKind, inProgress: altNow < -0.833 };
}

/** Moon info for a time + location. */
export function moonInfo(loc, date = new Date()) {
  const obs = observer(loc);
  const M = A().Body.Moon;
  const phaseAngle = A().MoonPhase(date); // 0 new, 90 first q, 180 full, 270 last q
  const illum = A().Illumination(M, date);
  const hor = bodyHorizon(M, date, obs);
  const rise = search(() => A().SearchRiseSet(M, obs, +1, new Date(date - 2 * HOUR), 1.2));
  const set = search(() => A().SearchRiseSet(M, obs, -1, new Date(date - 2 * HOUR), 1.2));
  const distKm = hor.dist * 149597870.7;
  const lastNew = search(() => A().SearchMoonPhase(0, new Date(date - 30 * DAY), 30));
  const ageDays = lastNew ? (date - lastNew) / DAY : null;
  return {
    phaseAngle,
    fraction: illum.phase_fraction,
    mag: illum.mag,
    alt: hor.alt,
    az: hor.az,
    distKm,
    rise,
    set,
    ageDays,
    name: phaseName(phaseAngle),
    waxing: phaseAngle < 180,
    constellation: A().Constellation(hor.ra, hor.dec).name,
  };
}

export function phaseName(angle) {
  const a = norm360(angle);
  if (a < 6 || a >= 354) return 'New Moon';
  if (a < 84) return 'Waxing Crescent';
  if (a < 96) return 'First Quarter';
  if (a < 174) return 'Waxing Gibbous';
  if (a < 186) return 'Full Moon';
  if (a < 264) return 'Waning Gibbous';
  if (a < 276) return 'Last Quarter';
  return 'Waning Crescent';
}

export function phaseEmoji(angle) {
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  return icons[Math.round(norm360(angle) / 45) % 8];
}

/** Sample a function at regular steps through a window. */
export function sample(from, to, stepMin, fn) {
  const out = [];
  for (let t = toDate(from).getTime(); t <= toDate(to).getTime(); t += stepMin * 60000) out.push(fn(new Date(t)));
  return out;
}

/** Minutes of truly dark sky (sun < -18°, moon below horizon or a thin crescent). */
export function moonFreeDark(loc, night) {
  if (!night.dark) return { ms: 0, from: null, to: null };
  const obs = observer(loc);
  const step = 10;
  let ms = 0, from = null, to = null;
  sample(night.dark[0], night.dark[1], step, (d) => {
    const m = moonAlt(d, obs);
    const frac = A().Illumination(A().Body.Moon, d).phase_fraction;
    if (m < -0.5 || frac < 0.08) {
      ms += step * 60000;
      if (!from) from = d;
      to = d;
    }
  });
  return { ms, from, to };
}

/** Approximate geomagnetic latitude using a centred dipole (pole ~80.7°N, 72.7°W). */
export function geomagneticLat(lat, lon) {
  const pLat = 80.7 * DEG, pLon = -72.7 * DEG;
  const la = lat * DEG, lo = lon * DEG;
  const s = Math.sin(la) * Math.sin(pLat) + Math.cos(la) * Math.cos(pLat) * Math.cos(lo - pLon);
  return Math.asin(s) * RAD;
}
