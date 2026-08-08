import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import * as THREE from 'three';

import type { EclipseView } from '../astro';
import {
  createEngineSession,
  type EngineApiLike,
  type EngineSessionApi,
} from '../ar/engineSession';
import { createBrowserEngineLoader, type EngineWindowLike } from '../ar/engineLoader';
import { northAlignYawOffsetDeg, offscreenSunIndicator, smoothHeadingDeg } from '../ar/math';
import { createSkyOverlay, placeSkySun, MIN_SUN_DISPLAY_DEG, type SkyOverlay } from '../ar/scene';
import {
  HeadingTracker,
  requestDeviceOrientationPermission,
  type DeviceOrientationLike,
} from '../sensors';

const XR_ENGINE_LICENSE_URL = 'https://github.com/8thwall/engine/blob/main/LICENSE';
const AR_START_TIMEOUT_MS = 30_000;
const AR_LOG_PREFIX = '[eclipse-checker:ar]';
/** Heading events fire at display rate; sample the debug log. */
const HEADING_LOG_INTERVAL_MS = 1000;
/**
 * iOS reports `webkitCompassAccuracy` in degrees of error. Above this limit the
 * heading is unreliable (the magnetometer is re-calibrating — typically right
 * after the app returns from being backgrounded), so the fix is not trusted.
 */
const COMPASS_ACCURACY_LIMIT_DEG = 15;

function accuracyOk(accuracyDeg: number | null): boolean {
  // Android reports no accuracy, so nothing to gate on.
  return accuracyDeg === null || accuracyDeg <= COMPASS_ACCURACY_LIMIT_DEG;
}

type CompassState = 'requesting' | 'waiting' | 'aligned' | 'denied';

function compassMessage(state: CompassState): string {
  switch (state) {
    case 'aligned':
      return 'Compass aligned';
    case 'requesting':
      return 'Requesting compass access…';
    case 'denied':
      return 'Compass permission denied — the AR view is not north-aligned';
    default:
      return 'Point your phone north to align the compass';
  }
}

export interface ARViewProps {
  view: EclipseView;
  onExit: () => void;
  /** Whether deviceorientation permission was granted (requested by the AR-entry gesture). */
  headingAuthorized?: boolean;
  /** Injectable engine loader (defaults to the browser lazy loader). */
  loadEngine?: () => Promise<unknown>;
  /** Injectable session factory (defaults to the XR8 three.js session). */
  createSession?: (engine: EngineApiLike, canvas: HTMLCanvasElement) => EngineSessionApi;
  /** Injectable heading source (defaults to `window`). */
  headingSource?: DeviceOrientationLike;
}

interface SkyCameraLike {
  quaternion: { x: number; y: number; z: number; w: number };
}

function engineWindow(): EngineWindowLike {
  return window as unknown as EngineWindowLike;
}

function defaultHeadingSource(): DeviceOrientationLike {
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

/**
 * The engine's `Threejs` pipeline module instantiates its renderer from a
 * global `window.THREE` namespace; expose the app's three.js module to it before
 * the camera pipeline starts.
 */
function ensureGlobalThree(): void {
  (window as unknown as { THREE: typeof THREE }).THREE = THREE;
}

/**
 * Pre-flight camera check so we can fail fast with a clear message instead of
 * waiting on the engine to report that no session could start. When the API is
 * missing or errors, assume the engine will sort it out (returns true).
 */
async function hasCamera(win: Window): Promise<boolean> {
  const media = win.navigator?.mediaDevices;
  if (typeof media?.enumerateDevices !== 'function') {
    return true;
  }
  try {
    const devices = await media.enumerateDevices();
    return devices.some((device) => device.kind === 'videoinput');
  } catch {
    return true;
  }
}

/** Translates raw engine errors into guidance a user can act on. */
function friendlyError(message: string): string {
  if (/no valid session manager/i.test(message)) {
    return "AR isn't supported on this device or browser. Try on a phone with a camera and motion sensors.";
  }
  if (/timed out/i.test(message)) {
    return 'AR took too long to start. Try again.';
  }
  if (/camera|getusermedia|video input/i.test(message)) {
    return 'No camera was found, or camera access was denied. AR needs the camera.';
  }
  return message;
}

export function ARView({
  view,
  onExit,
  headingAuthorized = true,
  loadEngine,
  createSession,
  headingSource,
}: ARViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<SVGSVGElement>(null);
  const onExitRef = useRef(onExit);
  const headingDegRef = useRef<number | null>(null);
  const sessionRef = useRef<EngineSessionApi | null>(null);

  const [status, setStatus] = useState<'starting' | 'active' | 'error' | 'exiting'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [safetyVisible, setSafetyVisible] = useState(true);
  const [compass, setCompass] = useState<CompassState>(headingAuthorized ? 'waiting' : 'denied');
  const compassRef = useRef<CompassState>(compass);

  /** setCompass + a console breadcrumb so state transitions are visible while debugging. */
  const updateCompass = (next: CompassState) => {
    if (compassRef.current !== next) {
      console.info(AR_LOG_PREFIX, `compass state: ${compassRef.current} -> ${next}`);
      compassRef.current = next;
    }
    setCompass(next);
  };

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const section = sectionRef.current;

    const source = headingSource ?? defaultHeadingSource();
    const loader = loadEngine ?? createBrowserEngineLoader(engineWindow());
    const sessionFactory = createSession ?? defaultSessionFactory;
    const params = {
      azimuthDeg: view.sunAzimuthPeakDeg,
      altitudeDeg: view.sunAltitudePeakDeg,
      rSunDeg: view.rSunDeg,
      rMoonDeg: view.rMoonDeg,
      separationDeg: view.separationDeg,
      positionAngleDeg: view.moonPositionAngleDeg,
      obscuration: view.obscuration,
      yawOffsetDeg: 0,
    };

    let disposed = false;
    let session: EngineSessionApi | null = null;
    let overlay: SkyOverlay | null = null;
    let sceneCamera: SkyCameraLike | null = null;
    let raf = 0;
    let stopHeading: (() => void) | null = null;
    const heading = new HeadingTracker(source);

    // An app switch stops deviceorientation events while backgrounded. When the
    // app comes back the magnetometer is usually mid-recalibration, so the
    // first fix can be off. Drop the smoothed fix and snap to a fresh,
    // accuracy-gated reading instead of EMA-blending a stale bias in.
    const onResume = () => {
      if (document.visibilityState === 'visible' && headingDegRef.current !== null) {
        console.info(AR_LOG_PREFIX, 'app foregrounded; re-anchoring compass');
        headingDegRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onResume);

    const run = async () => {
      try {
        if (!(await hasCamera(window))) {
          throw new Error('No camera was found. AR needs the camera.');
        }
        const engine = (await loader()) as EngineApiLike;
        if (disposed) {
          return;
        }
        session = sessionFactory(engine, canvas);
        sessionRef.current = session;
        ensureGlobalThree();
        const xrScene = await withTimeout(session.start(), AR_START_TIMEOUT_MS);
        if (disposed) {
          return;
        }
        overlay = createSkyOverlay(xrScene.scene as THREE.Scene);
        sceneCamera = xrScene.camera as SkyCameraLike;

        let lastHeadingLogAt = 0;
        stopHeading = heading.start(({ headingDeg, absolute, accuracyDeg }) => {
          const now = Date.now();
          if (absolute && headingDeg !== null && accuracyOk(accuracyDeg)) {
            if (headingDegRef.current === null) {
              console.info(
                AR_LOG_PREFIX,
                `heading fix acquired: ${headingDeg.toFixed(1)}° (accuracy ${String(accuracyDeg)})`,
              );
            } else if (now - lastHeadingLogAt >= HEADING_LOG_INTERVAL_MS) {
              console.debug(
                AR_LOG_PREFIX,
                `heading fix: ${headingDeg.toFixed(1)}° (accuracy ${String(accuracyDeg)})`,
              );
            }
            lastHeadingLogAt = now;
            // Smooth magnetometer jitter so the sun doesn't jump around while
            // the compass ring (world-anchored) stays put.
            headingDegRef.current = smoothHeadingDeg(headingDegRef.current, headingDeg);
            updateCompass('aligned');
          } else if (now - lastHeadingLogAt >= HEADING_LOG_INTERVAL_MS) {
            lastHeadingLogAt = now;
            console.debug(
              AR_LOG_PREFIX,
              `ignoring heading event (absolute=${String(absolute)}, headingDeg=${String(
                headingDeg,
              )}, accuracy=${String(accuracyDeg)})`,
            );
          }
        });

        const tick = () => {
          if (overlay !== null && sceneCamera !== null) {
            if (headingDegRef.current !== null) {
              params.yawOffsetDeg = northAlignYawOffsetDeg(
                [
                  sceneCamera.quaternion.x,
                  sceneCamera.quaternion.y,
                  sceneCamera.quaternion.z,
                  sceneCamera.quaternion.w,
                ],
                headingDegRef.current,
              );
            }
            placeSkySun(overlay, params);
            overlay.sun.quaternion.set(
              sceneCamera.quaternion.x,
              sceneCamera.quaternion.y,
              sceneCamera.quaternion.z,
              sceneCamera.quaternion.w,
            );

            const arrow = arrowRef.current;
            const glyph = glyphRef.current;
            const cam = sceneCamera as Partial<THREE.PerspectiveCamera>;
            const fov = typeof cam.fov === 'number' && cam.fov > 0 ? cam.fov : 60;
            const aspect = typeof cam.aspect === 'number' && cam.aspect > 0 ? cam.aspect : 1;
            if (arrow !== null && glyph !== null) {
              const indicator = offscreenSunIndicator(
                [
                  sceneCamera.quaternion.x,
                  sceneCamera.quaternion.y,
                  sceneCamera.quaternion.z,
                  sceneCamera.quaternion.w,
                ],
                overlay.sun.position,
                fov,
                aspect,
                0.12,
                Math.max(params.rSunDeg, MIN_SUN_DISPLAY_DEG),
              );
              if (indicator === null) {
                arrow.hidden = true;
              } else {
                arrow.hidden = false;
                arrow.style.left = `${(indicator.x * 100).toFixed(2)}%`;
                arrow.style.top = `${(indicator.y * 100).toFixed(2)}%`;
                glyph.style.transform = `rotate(${indicator.angleDeg.toFixed(1)}deg)`;
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        setStatus('active');
      } catch (err) {
        if (!disposed) {
          Sentry.captureException(err, {
            tags: { ar: 'start' },
          });
          setStatus('error');
          setError(friendlyError(err instanceof Error ? err.message : String(err)));
        }
      }
    };
    void run();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onResume);
      cancelAnimationFrame(raf);
      stopHeading?.();
      overlay?.dispose();
      session?.stop();
      // XRExtras' FullWindowCanvas module moves the canvas into document.body on
      // attach and never moves it back on detach. Restore it under the section so
      // unmount doesn't leave a frozen last AR frame pinned over the results view.
      if (canvas !== null && section !== null && canvas.parentElement !== section) {
        section.appendChild(canvas);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recalibrate = async () => {
    // Drop the current compass fix so the next frame re-anchors to a fresh
    // heading. Re-surface the (usually already-granted) orientation permission;
    // on iOS this must run inside the button's user gesture.
    headingDegRef.current = null;
    updateCompass('requesting');
    console.info(AR_LOG_PREFIX, 'recalibrate: cleared heading fix, re-requesting permission');
    const granted = await requestDeviceOrientationPermission(
      engineWindow() as unknown as DeviceOrientationLike,
    );
    console.info(AR_LOG_PREFIX, `recalibrate: permission ${granted ? 'granted' : 'denied'}`);
    updateCompass(granted ? 'waiting' : 'denied');
  };

  const restoreCanvas = () => {
    // XRExtras' FullWindowCanvas module moves the canvas into document.body on
    // attach and never moves it back on detach. Restore it under the section so
    // React unmounts it with the component instead of leaving a frozen last AR
    // frame pinned over the results view.
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (canvas !== null && section !== null && canvas.parentElement !== section) {
      section.appendChild(canvas);
    }
  };

  const exitAR = () => {
    // Stop the engine and paint a black cover, then leave on the next frame so
    // the last rendered AR frame never flashes over the results view.
    setStatus('exiting');
    sessionRef.current?.stop();
    restoreCanvas();
    requestAnimationFrame(() => onExitRef.current());
  };

  return (
    <section ref={sectionRef} className="ar-view" data-status={status}>
      <canvas ref={canvasRef} className="ar-canvas" />

      <div ref={arrowRef} className="ar-sun-arrow" hidden aria-hidden="true">
        <svg ref={glyphRef} viewBox="0 0 24 24">
          <path d="M12 2 L20 16 L12 12 L4 16 Z" fill="currentColor" />
        </svg>
        <span>Sun</span>
      </div>

      {status === 'starting' && <p className="ar-status">Starting AR…</p>}

      {status === 'error' && (
        <div className="ar-error" role="alert">
          <p>{error ?? 'AR is unavailable in this browser.'}</p>
          <button type="button" className="primary" onClick={() => { restoreCanvas(); onExitRef.current(); }}>
            Back to results
          </button>
        </div>
      )}

      {status === 'active' && (
        <p className="ar-compass" data-state={compass}>
          {compassMessage(compass)}
        </p>
      )}

      {status === 'exiting' && <div className="ar-exit-cover" aria-hidden="true" />}

      <div className="ar-safety">
        {safetyVisible && (
          <div className="ar-safety-info">
            <button
              type="button"
              className="ar-safety-dismiss"
              aria-label="Hide safety and license info"
              onClick={() => setSafetyVisible(false)}
            >
              ×
            </button>
            <p>
              Safety: never look at the Sun through any lens or AR overlay. The overlay is a
              simulation — view the eclipse only with certified solar filters.
            </p>
            <p className="ar-attribution">
              AR powered by the 8th Wall engine (Niantic Spatial). See the{' '}
              <a href={XR_ENGINE_LICENSE_URL} target="_blank" rel="noreferrer">
                XR Engine License Agreement
              </a>
              .
            </p>
          </div>
        )}
        {status === 'active' && compass !== 'aligned' && (
          <button type="button" className="secondary" onClick={recalibrate}>
            Recalibrate compass
          </button>
        )}
        <button type="button" className="primary" onClick={exitAR}>
          Exit AR
        </button>
      </div>
    </section>
  );
}

function defaultSessionFactory(engine: EngineApiLike, canvas: HTMLCanvasElement): EngineSessionApi {
  return createEngineSession({
    engine,
    canvas,
    extraModules: fullWindowCanvasModules(window),
  });
}

/**
 * The engine letterboxes the camera feed to a centered sub-rectangle of the
 * canvas by default; XRExtras' FullWindowCanvas module resizes the canvas to
 * fill the window (cover-cropping the feed) and re-runs on resize/orientation
 * changes. Loaded lazily because it lives in the xrextras bundle.
 */
function fullWindowCanvasModules(win: Window): unknown[] {
  const xrextras = (
    win as unknown as {
      XRExtras?: { FullWindowCanvas?: { pipelineModule?: () => unknown } };
    }
  ).XRExtras;
  const module = xrextras?.FullWindowCanvas?.pipelineModule?.();
  return module === undefined ? [] : [module];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}
