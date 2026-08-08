# eclipse-checker — Technical Planning Document

Planning document for the implementing agent. Greenfield repo (`/Users/jvacek/Developer/eclipse-checker`, empty git repo).

## 1. Overview

A mobile-first webapp that shows an AR view of the next solar eclipse at its peak, relevant to the user's position:

1. Gets the user's location (GPS lat/lon, elevation) and heading (compass/gyro)
2. Computes the **next solar eclipse visible from that location**: peak time, eclipse kind, magnitude (fraction of diameter) and obscuration (fraction of area), Sun altitude + azimuth at peak, and the Moon's position angle on the solar disc (for crescent rendering)
3. Shows an **AR overlay** indicating where in the sky the Sun will be at peak eclipse, with the crescent shape and a horizon guide
4. Answers "will I have a good view?" — Sun elevation above horizon, direction relative to device heading, and (future) cloud cover

Context: the 2026-08-12 total eclipse is imminent; the app is generic (works for any eclipse at any location) but **validated against NASA data for 2026-08-12** as its primary fixture.

## 2. Constraints (locked)

- **Fully open source & free**, runs in the browser, no backend, no paid services
- **In-page AR** — no App Clips, no redirects, no app stores (rules out Needle Go, Variant Launch)
- Mobile-first (Android Chrome + iOS Safari), works on desktop too
- Easy to maintain: math isolated from UI, everything validated against NASA data
- No runtime third-party network services (IP-based geolocation fallback deliberately excluded from v1). The 8th Wall engine is **vendored/self-hosted** in-repo — never loaded from their CDN at runtime.
- **AR via the self-hosted 8th Wall engine** (`@8thwall/engine-binary`). Chosen because DIY `deviceorientation` heading on iOS is unreliable (roll gets coupled into alpha), and 8th Wall's **sky segmentation** makes the eclipse discs blend against the real sky instead of buildings. The engine is a **binary with a proprietary license** (free for commercial + noncommercial use; but no modification/reverse-engineering of the engine, no paid product whose value derives from it, and **attribution required** — keep Niantic Spatial notices + a link to the XR Engine License Agreement). Accepted deviation for the AR layer only; all other code stays MIT.

## 3. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Type safety for astronomy math |
| Build tool | Vite | Fast, standard, trivial static deploy |
| UI framework | React 18 | Large ecosystem; canvas stays outside React via refs |
| 3D rendering | Three.js | Scene/camera/renderer hosted by the 8th Wall engine's three.js pipeline module; AR overlay stays an imperative module, out of React lifecycle |
| Astronomy core | astronomy-engine (npm `astronomy`, cosinekitty) | Pure client-side ephemeris; local eclipse search, topocentric coordinates, refraction |
| Testing | Vitest | Math module is the critical surface |
| Lint/format | ESLint + Prettier | — |
| CI | GitHub Actions | typecheck → lint → test → build |
| Hosting | Static host (Netlify/Cloudflare Pages/GitHub Pages) | HTTPS mandatory for geolocation/camera/sensors (secure context) |

No backend, no state-management library, no CSS framework requirement (plain CSS modules or Tailwind — implementer's choice, keep minimal). PWA manifest optional (phase 3); app-shell service worker in Phase 2.

## 4. Eclipse data & calculation strategy

**Primary: compute at runtime from ephemeris** via astronomy-engine — works for any eclipse, any location, offline. No shipped eclipse data, no runtime API calls.

**NASA Besselian elements used only as test fixtures** (public domain, attribution required: "Eclipse Predictions by Fred Espenak, NASA's GSFC"). Sources:
- Per-eclipse polynomial Besselian elements: `https://eclipse.gsfc.nasa.gov/SEsearch/SEdata.php?Ecl=20260812`
- Five Millennium Canon dataset in JSON/CSV (11,898 eclipses, ~1.2 MB): `https://github.com/gmiller123456/FiveMillenniumCanonOfSolarEclipses-Besselian-Elements`
- Meeus *Astronomical Algorithms* ch. 54 (Besselian method) reference: `https://www.celestialprogramming.com/MeeusEclipseExamples/`
- NASA city tables (science.nasa.gov/eclipses) and timeanddate.com per-city pages — used for the fixture expected values (see `tests/fixtures/2026-08-12-nasa.json`, already populated with real values)

A Besselian-element engine (Meeus ch. 54) is explicitly **not** in scope for v1 — optional phase-3 precision upgrade (path-edge fidelity ~2 km vs NASA) only if users need central-line-crossing precision.

## 5. Calculation module spec (`src/astro/`)

Pure functions, no DOM/sensor access → fully unit-testable.

```
EclipseCalculator.forLocation({ lat, lon, heightMeters }, refDate = now)
  1. observer = new Observer(lat, lon, heightMeters)
  2. info = SearchLocalSolarEclipse(refDate, observer)        // next visible eclipse
  3. if none found within 10-year horizon → return null       // see "Search horizon"
  4. peakTime = info.peak.time
  5. sun = getTopocentricHorizontal(Body.Sun, peakTime, observer)
  6. moon = getTopocentricHorizontal(Body.Moon, peakTime, observer)
     // azimuth/altitude via Equator → Horizon chain (see coordinates.ts); also dist
  7. magnitude = (rSun + rMoon - sep) / (2 * rSun)            // fraction of solar diameter
  8. obscuration = info.obscuration                           // fraction of area (from library)
  9. positionAngle PA of Moon on Sun disc at peakTime          // crescent orientation
  10. also compute sunAzAlt at partialBegin / partialEnd for animation bounds
  11. convert peakTime → local timezone display strings (Intl API)
  returns: EclipseView | null
```

**Search horizon:** `SearchLocalSolarEclipse` returns the first eclipse after `startTime` without a natural limit; the app defines a **10-year window** (a given location can wait 6–7 years between partials). Expose `daysUntil` so the UI can say "next in 2 years". Return `null` if nothing within 10 years.

### `src/astro/coordinates.ts` — thin wrapper around astronomy-engine

- `getTopocentricHorizontal(body, time, observer, refraction): { azimuth, altitude, distance, ra, dec }`
  - `Equator(body, time, observer, /*ofdate*/ true, /*aberration*/ true)` → topocentric RA/Dec of-date + `dist` (AU)
  - `Horizon(time, observer, ra, dec, refraction)` → azimuth (0–360° from North) + altitude
  - `refraction: 'normal' | 'none'`, default `'normal'`; at low altitudes `'normal'` adds ~0.5° — matters for the "above horizon" verdict. Note NASA/geometry comparisons use `'none'`; fixture tolerance (±1.5° altitude) covers either.
- `getAngularRadius(body, distanceAu): number` (radians)
  - `r = asin(R_body / (dist_au * AU))` with `R_sun = 6.957e8 m`, `R_moon = 1.7374e6 m`, `AU = 1.495978707e11 m`
- `getPositionAngle(sunRA, sunDec, moonRA, moonDec): number` (radians)
  - Standard formula at Sun's center from celestial north; RA/Dec MUST be in the same frame — use of-date topocentric output from `Equator(ofdate: true)` for both bodies
  - `PA = atan2( cos δs · sin(αm − αs), sin δm · cos δs − cos δm · sin δs · cos(αm − αs) )` (Meeus ch. 54; denominator terms NOT interchangeable — verified against the due-north → PA 0 case and the equator east → 90° case in geometry tests)
- Angular separation: standard great-circle formula between both topocentric positions at `peakTime`

### `EclipseView` interface (`src/astro/types.ts`)

```ts
type EclipseKind = 'Partial' | 'Annular' | 'Total';

interface EclipseEventLocal { utc: string; local: string; sunAltitudeDeg: number; sunAzimuthDeg: number; }

interface EclipseView {
  kind: EclipseKind;
  eclipseDateIso: string;            // YYYY-MM-DD (UTC date of the eclipse)
  timezone: string;                  // IANA, from Intl.DateTimeFormat().resolvedOptions().timeZone
  daysUntil: number;
  times: { begin: EclipseEventLocal; peak: EclipseEventLocal; end: EclipseEventLocal };
  magnitude: number | null;          // fraction of solar diameter (null for total? no: >= 1 for total)
  obscuration: number;               // fraction of solar area (0..1)
  sunAltitudePeakDeg: number;        // geometric or refracted per refraction flag
  sunAzimuthPeakDeg: number;         // compass degrees
  moonPositionAngleDeg: number;      // PA at peak, deg from celestial north
  observer: { lat: number; lon: number; heightMeters: number };
}
```

Notes: for total/annular eclipses `magnitude >= 1` is valid (1.002 for Reykjavík 2026). Format all local display strings via `Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })` — the library returns UTC; never hand-format timezone offsets.

**Derived UX outputs**: "will the Sun be visible?" (altitude > 0° with refraction `'normal'`), "how dark will it get?" (obscuration %), crescent orientation for rendering.

## 6. AR session architecture

The AR session is provided by the **self-hosted 8th Wall engine** (as of March 2026 the engine framework is open source at `github.com/8thwall/8thwall`; the hosted platform is retired). Its camera pipeline handles iOS Safari, Android WebXR, and desktop uniformly, and its fused orientation fixes the iOS heading drift that sank the DIY approach.

```
AR layer
 ├─ Vendored engine: external/xr/  — xr.js + resources/ copied from
 │   @8thwall/engine-binary@1 (npm), committed to the repo, served locally.
 │   Loaded via <script src="./external/xr/xr.js"> — never jsdelivr at runtime.
 ├─ xrextras (MIT)                 — loading overlay / permission UX helpers
 └─ Engine modules via XR8.addCameraPipelineModules([...]):
       camera feed + fused orientation + XR8.Threejs.pipelineModule()
       (scene/camera/renderer) + layers module (sky segmentation mask)
```

- **Eclipse overlay** = a three.js scene attached to the **sky segmentation layer** (`xrlayers`-style; content is masked to real sky pixels). Sun/moon azimuth + altitude come from our `src/astro` at the scrubbed time; crescent rendering via three.js `ShaderMaterial` (same math as §8).
- **Reference implementations:** `8thwall/aframe-sky-effects-example` (sky scene + segmentation, A-Frame) and `8thwall/threejs-world-effects-example` (three.js pipeline wiring). Both run with `git lfs pull` + `npm install` + `npm run serve` and load the prebuilt engine from `@8thwall/engine-binary` — that confirmed the "easy path" works (webpack serve returns 200 in <1 s).
- **North alignment:** the engine fuses `webkitCompassHeading` (absolute). Keep a "recalibrate" affordance. The old hand-rolled quaternion math in `src/ar/math.ts` stays only as reference for the 2D sky map.
- **Fallback when AR is unavailable** (sensors/camera denied, desktop): non-AR **2D sky map** (compass rose + elevation grid) — unchanged.
- **MIT-engine escape hatch:** if the binary license ever becomes a blocker, build the MIT engine source (`github.com/8thwall/8thwall` — includes Sky Segmentation, no SLAM) with `bazel build --config=wasmreleasesimd //reality/app/xr/js:bundle` (needs Bazel 7 + numpy on the host) and serve it identically. SLAM is not needed for a sky-pointing use case.

## 7. Sensors & permissions (`src/sensors/`)

| Sensor | API | Notes |
|---|---|---|
| Location | `navigator.geolocation` `enableHighAccuracy: true`; `coords.altitude` for elevation | GPS altitude is coarse (±10–50 m) — acceptable; show "location accuracy" readout. Requires HTTPS. |
| Heading (2D-map fallback only) | `DeviceOrientationEvent` — iOS: `alpha` w/ `webkitCompassHeading`; Android: `alpha` (absolute) | Only needed for the desktop/2D sky map. In AR the 8th Wall engine fuses heading itself (solves the iOS roll-into-alpha drift). |
| AR session | 8th Wall engine (`external/xr/xr.js` + `xrextras`) | Owns camera, orientation, sky segmentation, and their permission prompts on iOS + Android. |

**`src/sensors/permission.ts` — unified permission state machine** (single source of truth, drives the UI):

```
PermissionState = 'idle' | 'prompting' | 'granted' | 'denied'
getLocationPermission(): Promise<PermissionResult>   // idle → prompting → granted | denied
PermissionResult = { state: PermissionState; reason?: 'unsupported' | 'user-denied' | 'error'; fallbackAvailable: boolean }
```

Location permission + manual lat/lon entry stay ours. Camera/orientation prompts are owned by the engine (`xrextras` loading/landing overlay); the state machine doesn't duplicate them.

**Geolocation denial fallback:** manual lat/lon entry form (with degree/minute/second and decimal support). IP-based geolocation fallback is **deferred** — it requires a third-party runtime API (e.g., ipapi.co) and is excluded per the no-runtime-dependency constraint.

All sensor access behind small adapters with a mocked interface for tests.

## 8. AR rendering (`src/ar/`)

- Scene: sun disc + crescent mesh, translucent horizon plane, altitude grid, N/E/S/W bearing ticks, marker at (sunAzimuth, sunAltitude) labeled with peak time. Rendered by the engine's three.js renderer into the sky segmentation layer (real sky pixels only).
- Crescent via a three.js `ShaderMaterial` — pixel inside Sun disc and inside Moon disc (offset by separation ρ along PA) → darkened; recompute Sun/Moon positions per frame from interpolated time → live scrubber from partialBegin ↔ peak ↔ partialEnd. The math ported from the DIY `src/ar/math.ts` (kept as reference / for the 2D map).
- Engine lifecycle is imperative and **outside React**: a small `src/ar/engineSession.ts` wraps `XR8` (start camera pipeline, install pipeline modules, teardown) behind the `ARSessionProvider`-style interface; the React `ARView` mounts it via ref.
- **Orientation changes:** the engine resizes/reprojects; our app only re-reads `screen.orientation.angle` for any in-scene text/DOM overlays.
- **Safety UX (non-negotiable):** prominent disclaimer — never look at the Sun through any lens/AR overlay; the overlay is a simulation; view the eclipse only with certified solar filters.

## 9. UX flow

1. Landing: "Find my location" (geolocation) → explicit states: `idle → locating → computing → results | error` (skeleton while computing; the math is <50 ms but sensor permission UX dominates). On denial → manual lat/lon entry. On unsupported → 2D sky map.
2. Results panel: next eclipse info, times (local, `timezoneName: 'short'`), magnitude/obscuration %, Sun altitude + azimuth, view-quality verdict (above horizon / direction / "next in N days")
3. "View in AR" → load engine (`xrextras` loading overlay + permission prompts) → AR overlay with sky segmentation + scrubber to preview any moment
4. Share: URL with `?lat=&lon=&height=&eclipseDate=&kind=` — on load, parse params, pin `eclipseDate` as the search anchor so the same eclipse is found, and deep-link straight to results

## 10. Project structure

```
eclipse-checker/
├── src/
│   ├── astro/          # pure math: eclipse.ts, coordinates.ts, geometry.ts, types.ts (NO DOM)
│   ├── sensors/        # geolocation.ts, deviceOrientation.ts (2D-map heading), permission.ts (state machine)
│   ├── ar/             # engineSession.ts (XR8 wrapper), scene.ts, crescentShader.ts, horizonGuide.ts, math.ts (reference)
│   ├── ui/             # React: Landing, Results, ARView, SkyMap, Status
│   ├── data/           # NASA fixture JSON (provenance-annotated)
│   ├── main.tsx        # entry point
│   └── App.tsx         # root component
├── external/
│   ├── xr/             # vendored engine: xr.js + resources/ (from @8thwall/engine-binary@1, committed)
│   └── xrextras/       # vendored xrextras (MIT) loading overlay
├── tests/
│   ├── astro/          # unit tests
│   └── fixtures/       # 2026-08-12-nasa.json (populated, see §11)
├── public/
└── vite.config.ts
```

## 11. Testing & validation strategy

- **Critical:** `tests/fixtures/2026-08-12-nasa.json` — already populated with real published values for 2026-08-12:
  - **Reykjavík** (total): 16:47–18:47 GMT, peak 17:48, magnitude 1.002, obscuration ~100%, Sun altitude ~25.1°
  - **Madrid** (deep partial): 19:36–21:16 CEST, peak 20:32, magnitude 0.999, obscuration ~99.97%, Sun altitude ~7°
  - **London** (partial): 18:17–20:06 BST, peak 19:13, obscuration 91% (magnitude not published — assert times + obscuration only)
  - **Sydney** (negative case): no eclipse visible → `expected: null` (tests the null path)
  - Tolerances: peak time ±2 min, Sun altitude ±1.5°, magnitude ±0.02, obscuration ±0.02. (Refraction-aware: compute with `'none'` for comparison, or leave tolerance as-is.)
  - Moon position angle: add per-city PA from NASA's per-eclipse local-circumstances tables when the implementing agent extracts them; not currently asserted.
- Golden-fixture regression tests for `geometry.ts` against Meeus ch. 54 worked examples (celestialprogramming.com)
- Component tests (React Testing Library) with mocked sensors; sensor adapters behind interfaces so nothing browser-specific leaks into `astro/`
- Permission state machine unit tests (all 4 states × each sensor)
- E2E (optional, later): Playwright with mocked geolocation/deviceorientation

## 12. Tooling, CI, hosting

- GitHub Actions: `typecheck && lint && vitest run && vite build` on PR
- Deploy: Netlify/Cloudflare Pages from `main` (static, HTTPS, zero config)
- `.nvmrc` + pinned deps; ESLint flat config + Prettier

## 13. Roadmap

- **Phase 0 — Scaffold & math core:** Vite+React+TS+Three+astronomy-engine; implement `astro/` (eclipse.ts, coordinates.ts, geometry.ts, types.ts); NASA fixture tests green (Madrid/Reykjavík/London/Sydney cases). (Everything here is desktop-verifiable.)
- **Phase 1 — Results & 2D sky map:** location (with manual-entry fallback) → eclipse results panel + compass/elevation map; share links; loading/error states; permission state machine.
- **Phase 2 — AR (8th Wall engine):** vendor `@8thwall/engine-binary` + `xrextras` into `external/`; `engineSession.ts` wrapper (start pipeline, `XR8.Threejs.pipelineModule()`, layers/sky segmentation, teardown); eclipse overlay scene + crescent shader + horizon guide + scrubber; "recalibrate" affordance; app-shell service worker (offline cache).
- **Phase 3 — Polish/future:** weather via Open-Meteo (free, no key) for cloud-cover "good view" scoring; Besselian-element precision mode; PWA (manifest + install); i18n.

## 14. Assumptions

- Generic eclipse support (any eclipse, any location); 2026-08-12 used as the validation fixture
- Weather/cloud-cover scoring is phase 3
- AR uses the self-hosted 8th Wall engine binary (attribution required; no paid products built on it) — see §2/§6
- IP-based geolocation fallback excluded for v1 (no runtime third-party services)
