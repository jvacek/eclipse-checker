# AGENTS.md

Build agent guide for eclipse-checker — an open-source, browser-only webapp showing an AR view of the next solar eclipse at its peak from the user's GPS/compass position. Full architecture and roadmap: `PLAN.md` (read it first).

## Quickstart

- `npm install` — install deps (Node 22 via `.nvmrc`)
- `npm run dev` — Vite dev server
- `npm test` — Vitest (all astronomy logic is tested against real NASA/timeanddate values)
- `npm run typecheck` — `tsc --noEmit` (strict)
- `npm run lint` — ESLint flat config
- `npm run format` — Prettier
- `npm run build` — production build to `dist/`

## Structure

- `src/astro/` — pure astronomy/math module, **no DOM, no React**. All astronomy logic lives here so it's unit-testable.
  - `eclipse.ts` — `EclipseCalculator.forLocation` / `forEclipseDate` (finds the eclipse, computes times, magnitude, obscuration, sun/moon altitude, PA, totality window)
  - `coordinates.ts` — topocentric horizontal coordinates, angular radii
  - `geometry.ts` — separation, position angle, circle-overlap fraction (pure math)
  - `constants.ts`, `types.ts`, `index.ts`
- `src/sensors/` — browser sensor adapters behind small interfaces (unit-tested with fakes, no real browser needed). **Only geolocation + 2D-map heading live here; the AR camera/orientation is owned by the 8th Wall engine**:
  - `permission.ts` — `requestPermission(requestor)` state machine → `PermissionOutcome<'granted'|'denied', reason, fallbackAvailable>`; `PermissionError`
  - `geolocation.ts` — `createGeolocationRequestor` resolves `navigator.geolocation` **lazily at request time** (so tests can stub `navigator.geolocation` after import)
  - `deviceOrientation.ts` — `compassHeading(alpha, screenAngle, absolute)`, `HeadingTracker`, `createOrientationRequestor` (2D sky map only)
- `src/ar/` — AR layer. `engineSession.ts` wraps the vendored 8th Wall engine (`XR8`): installs `XR8.Threejs.pipelineModule()` + `XR8.XrController`/`GlTextureRenderer`, exposes the engine's **main reality scene** (the overlay renders over the full camera feed, so real occluders visibly hide the sun disc), rejects `start()` on engine errors (the engine routes session failures to each module's `onException`), owns teardown. `engineLoader.ts` lazily injects the engine scripts on first AR entry (`xrloaded`). `scene.ts`/`crescentShader.ts` build the eclipse overlay into that scene. `math.ts` (quaternion/heading helpers) is **reference only** for the 2D map; the AR overlay is north-aligned via `northAlignYawOffsetDeg(cameraQuat, compassHeading)`. `ARView.tsx` pre-flights for a camera, maps raw engine errors to friendly guidance, and adds `XRExtras.FullWindowCanvas.pipelineModule()` so the camera feed fills the viewport (`.ar-view` is CSS-fixed to the full screen).
- `vite-external.ts` — plugin that serves the 8th Wall engine + xrextras from `node_modules/@8thwall/` during dev and copies them into `dist/external/` on build, so the engine is never loaded from a third-party CDN at runtime. URL paths (`/external/xr/xr.js`, `/external/xrextras/xrextras.js`) are defined in `src/ar/engineLoader.ts`. The engine resolves chunks + `resources/` relative to its own script URL. The semantics sky-segmentation model is currently **unused** (we render a full overlay — no `LayersController`), and face-tracking assets (`xr-face.js`, `face-*.tflite`) ship in the npm package but are only fetched by the engine if `XR8.FaceController` is installed, which we never use. Reference implementations: `8thwall/aframe-sky-effects-example` (sky scene) and `8thwall/threejs-world-effects-example` (three.js pipeline).
- `src/lib/` — pure helpers: `shareUrl.ts` (deep-link `?lat=&lon=&height=&eclipseDate=&kind=` parse/build), `coords.ts` (DMS parse/format), `skyMap.ts` (azimuth/altitude → canvas fraction)
- `src/hooks/` — `usePermission` (drives landing button), `useHeading` (optional compass heading for the sky map; null → north-up)
- `src/ui/` — React: `Landing`, `ManualForm` (decimal or DMS; `role="alert"` on errors), `Results` (panel + share), `SkyMap` (canvas 2D, **no 3D/three.js yet**), `Status`
- `src/App.tsx` — Phase 1 state machine: `landing → locating → results | manual | error`; deep-links straight to results from share params; updates URL via `history.replaceState` on results
- `tests/` — Vitest specs; `tests/fixtures/2026-08-12-nasa.json` holds NASA/timeanddate reference values (with provenance and tolerances). Component tests (`tests/ui/app.test.tsx`) run in jsdom (`// @vitest-environment jsdom`), everything else in node.

## Conventions (critical)

- `astronomy-engine` (the only astronomy lib) uses **snake_case** return fields: `partial_begin`, `partial_end`, `total_begin`, `total_end`, `peak`. `EclipseKind` values: `'partial'` | `'annular'` | `'total'`. `obscuration` IS provided for partial eclipses (e.g. Madrid 0.9997).
- **`AstroTime.ut` is DAYS since J2000, not seconds.** J2000 → unix seconds offset = `J2000_UNIX_OFFSET_SECONDS = 946728000` (defined in `eclipse.ts`). Any time arithmetic must convert explicitly — the original codebase had three unit bugs from treating `.ut` as seconds.
- Correct positional astronomy chain (do NOT shortcut): `Equator(body, time, observer, true, true)` → topocentric RA/Dec of-date + `dist` in AU, then `Horizon(time, observer, ra, dec, refraction)` where refraction is `'normal'`/`undefined` for observed values or `null` for geometric.
- Topocentric angular radius: `asin(r / dist)` with r in AU (sun 0.00465047 AU, moon 0.00259264 AU). `getAngularRadiusDeg` handles this.
- `astronomy-engine` has no `./package.json` export; `FlexibleDateTime` accepts `AstroTime | Date | number` (NOT strings).
- Always pass an explicit `refDate` (deterministic tests) — never rely on `Date.now()`.
- Known quirk: `SearchLocalSolarEclipse` from mid-eclipse returns null begin/end — `forEclipseDate` searches from `refDate − PRE_ECLIPSE_SEARCH_LEAD_DAYS` (1.5 days; eclipses are ≥2 weeks apart).
- Position angle formula (Meeus ch. 54) — denominator terms are NOT interchangeable:
  `atan2(cos δs·sin(αm−αs), sin δm·cos δs − cos δm·sin δs·cos(αm−αs))`
- Fixture comparison: times are converted to local time with explicit tz; tolerances are peak ±2 min, altitude ±1.5°, magnitude/obscuration ±0.02; Madrid's published end excludes the geometric tail (sun below horizon) → `partialEndToleranceMin: 10`.
- Sensor adapters are plain objects taking injected fakes (`GeolocationLike`, `DeviceOrientationLike`); never access `navigator`/`window` in `astro/`, and resolve them lazily in `sensors/` so tests stay deterministic.
- Engine-layer code (`engineLoader.ts`, `engineSession.ts`) takes injected fakes (`EngineApiLike`, `BrowserDom`); only `engineLoader.ts` touches `window.XR8`/the `xrloaded` event. The AR overlay's north alignment is `northAlignYawOffsetDeg` applied to the engine sky camera quaternion + compass heading.
- Component tests: jsdom file directive + vitest `globals: true` (RTL auto-cleanup needs it); stub `navigator.geolocation` via `Object.defineProperty` and assert on async results with `findBy*`.

## Testing

`npm test` must stay green. Fixture-driven tests assert against `2026-08-12-nasa.json` (Reykjavík total, Madrid deep partial, London partial, Sydney null — next eclipse there is 2028-07-22). When adding a calculation, add a fixture entry + assertion rather than testing in `App.tsx`.

## Hard constraints (see PLAN.md)

- 100% open-source/free; browser-only; no backend; no App Clips; no paid services (Needle Go, Variant Launch excluded). 8th Wall was open-sourced in March 2026; we use its engine for the AR layer.
- AR runs on the **self-hosted 8th Wall engine** — `@8thwall/engine-binary` installed from npm into `node_modules/`, served locally by `vite-external.ts` at `/external/xr/`, never loaded from their CDN at runtime. It is a **binary with a proprietary license** (free for commercial/noncommercial use; no modifying/reverse-engineering the engine; no paid product whose value derives from it; **attribution required** — keep Niantic Spatial notices + a link to the XR Engine License Agreement in the app). `xrextras` is MIT.
- No runtime third-party APIs (ephemeris is computed locally via astronomy-engine).
