# ✦ Stargazer: your night-sky dashboard

Stargazer shows what's happening in the sky above **your** location: constellations, aurora (northern and southern lights), the Moon and lunar events, eclipses, meteor showers, planets, ISS passes and rocket launches. It also gives weather warnings so you know whether you'll actually be able to see any of it.

It is a static web app (plain HTML, CSS and JavaScript, with no build step and no backend). It uses **only free data sources with no API keys**, and most of the astronomy is computed in your browser.

**Live app:** https://attripbo8.github.io/Stargazer/

---

## Features

| Section | What you get |
|---|---|
| ✨ **Sky Map & Constellations** | An interactive all-sky chart for your location: about 5,000 stars, constellation lines and names, planets, Moon, Milky Way, Messier objects and active meteor radiants. Includes a time slider with play, rotation, and hover/tap labels. Below the chart is a list of the best constellations tonight, with what to look for. |
| 🌦️ **Weather & Sky Conditions** | A "sky clarity" score for tonight, an hour-by-hour table (low/mid/high cloud, rain, wind, humidity, visibility, smoke/haze), seeing and transparency, and a 7-night outlook that picks the best night. |
| ⚠️ **Weather warnings** | Thunderstorms, strong gusts, rain/snow, freezing fog, extreme cold, dew on optics, wildfire smoke/dust, heavy cloud, plus official **US National Weather Service** alerts. Shown in a banner at the top of the page. |
| 🌌 **Aurora** | NOAA OVATION probability overhead and on your horizon, a 3-day Kp forecast, live solar wind (Bz, speed, density), the Kp needed at your geomagnetic latitude, SWPC alerts, and the official NOAA aurora map. Works for both hemispheres. |
| 🌕 **Moon & Lunar Events** | A rendered phase, illumination, age, rise/set and distance. Next phases, every full moon of the coming year with its traditional name (including the Harvest Moon), **supermoons, micromoons, Blue Moons and Black Moons**, and perigee/apogee. |
| 🌘 **Eclipses** | Lunar eclipses with local visibility (full, partial or not visible), solar eclipses visible from your location with % coverage, and upcoming solar eclipses worldwide. |
| ☄️ **Meteor Showers** | 14 annual showers. Peak dates come from IMO solar longitudes, so they are accurate every year. Each shows an estimated rate from your location (radiant height and moonlight), the best time and which way to look. |
| 🪐 **Planets** | Tonight's visibility, best time, altitude, direction, magnitude and constellation. Also oppositions, greatest elongations, conjunctions and planet parades. |
| 🛰️ **ISS & Bright Satellites** | Visible passes of the ISS, Tiangong and Hubble for the next 5 days (start/peak/end direction, height, brightness), computed with SGP4 and an Earth-shadow check. |
| 🌃 **Twilight, Darkness & Milky Way** | Golden/blue hour; civil, nautical and astronomical twilight; dark hours and moon-free dark hours; Milky Way core visibility; seasonal phenomena; equinoxes and solstices. |
| 📅 **Upcoming Sky Events** | One combined, filterable timeline of everything above, with a **"Priorities only"** filter. |
| 🚀 **Rocket Launches** | Upcoming launches worldwide, flagged when one may be visible from you, including twilight "jellyfish" plumes. |

### Prioritise what you care about
* Tap **☆** on any section, or use **★ Customize**, to make it a priority. Priority sections move to the **top of the page** in the order you choose (drag, or use ▲▼).
* The **"at a glance"** strip at the top summarises your priority events.
* The alert banner adds good-news alerts for your priorities, for example *"Aurora alert: High chance tonight"*, *"Geminids peak tomorrow"*, *"Bright ISS pass tonight"* or *"Supermoon tomorrow"*.
* You can hide or collapse sections. Preferences are saved in your browser.

### Extras
* 📅 Add any event to your calendar (.ics download).
* 🔴 **Red night-vision mode** to keep your eyes dark-adapted.
* °C/km ↔ °F/mi units, and light/dark themes.
* 🔗 Shareable links (`?lat=…&lon=…&name=…`). All times are shown in the location's own time zone.
* Location by GPS, city search, or typing `lat, lon`.

---

## Free data sources

| Data | Source | Key? |
|---|---|---|
| Weather forecast, air quality (aerosols/smoke), geocoding | [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) | No |
| Seeing and transparency | [7Timer!](https://www.7timer.info/) | No |
| Official weather alerts (US) | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | No |
| Aurora model, Kp index, solar wind, alerts, aurora map | [NOAA SWPC](https://www.swpc.noaa.gov/) | No |
| Satellite orbits (TLE) | [CelesTrak](https://celestrak.org/), with fallbacks to [tle.ivanstanojevic.me](https://tle.ivanstanojevic.me/) and [wheretheiss.at](https://wheretheiss.at/) | No |
| Rocket launches | [The Space Devs Launch Library 2](https://thespacedevs.com/llapi) (free tier, cached for 1 h) | No |
| Reverse geocoding | [BigDataCloud](https://www.bigdatacloud.com/) client-side API | No |
| Sun, Moon, planets, eclipses, twilight | [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT, bundled in `vendor/`) | — |
| Satellite propagation | [satellite.js](https://github.com/shashwatak/satellite-js) (MIT, bundled in `vendor/`) | — |
| Stars, constellations, Milky Way, Messier | [d3-celestial](https://github.com/ofrohn/d3-celestial) data (BSD-3-Clause), compacted in `data/` | — |

Network responses are cached in `localStorage` and reused if a source is temporarily down. If any one source fails, only its own section is affected.

---

## Other events worth adding

Already included: aurora, constellations, Moon phases, supermoons/blue moons/black moons, lunar and solar eclipses, meteor showers, planets (oppositions, elongations, conjunctions, planet parades), ISS/Tiangong/Hubble passes, rocket launches, Milky Way core, twilight/golden hour, zodiacal light, noctilucent cloud season, equinoxes/solstices, Earth perihelion/aphelion and geomagnetic storm forecasts.

Ideas for the future:
* **Comets** currently visible (e.g. from the [Minor Planet Center](https://minorplanetcenter.net/) or JPL Small-Body Database)
* **Lunar occultations** of bright stars and planets
* **Starlink "trains"** shortly after launch
* **Iridium-like flares** and other bright satellite passes
* **Variable stars**, such as Algol minima
* **Sunspots and solar flares** (NOAA SWPC X-ray flux) for solar observers
* **Light-pollution (Bortle) estimate** for the chosen location
* **Push notifications** for priority events (Web Push / PWA)

---

## Run locally

The app uses ES modules and `fetch`, so it must be served over HTTP (opening the file directly won't work):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

It's a static site. GitHub Pages (Settings → Pages → deploy from `main`, root), Netlify, Cloudflare Pages or any web server will work.

## Project layout

```
index.html            page shell
css/styles.css        styles (dark / light / red night-vision)
js/app.js             state, priorities, layout, data loading, banner
js/data.js            all external API calls
js/astro.js           night window, twilight, Moon helpers
js/util.js            formatting, caching, charts, .ics
js/cards/*.js         one module per dashboard section
data/*.json           star catalogue, constellations, Milky Way, Messier
vendor/               Astronomy Engine + satellite.js
```

Forecasts and visibility estimates are guides only. Always check local conditions, and never look at the Sun without certified eclipse protection.
