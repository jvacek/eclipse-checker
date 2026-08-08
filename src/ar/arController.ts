import * as Sentry from '@sentry/react';
import * as THREE from 'three';

import type { EclipseView } from '../astro';
import { HeadingTracker, requestDeviceOrientationPermission, type DeviceOrientationLike } from '../sensors';
import { createBrowserEngineLoader, type EngineWindowLike } from './engineLoader';
import { createEngineSession, type EngineApiLike, type EngineSessionApi } from './engineSession';
import { northAlignYawOffsetDeg, offscreenSunIndicator } from './math';
import {
  createSkyOverlay,
  placeSkySun,
  MIN_SUN_DISPLAY_DEG,
  type SkyOverlay,
} from './scene';

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

export type CompassState = 'requesting' | 'waiting' | 'aligned' | 'denied';

export interface ARControllerCallbacks {
  /** Fired once the session is live, or when startup failed. */
  onStatus: (status: 'active' | 'error') => void;
  /** Human-readable start error. */
  onError: (message: string) => void;
  /** Compass alignment transitions (first fix, recalibrate, permission denied). */
  onCompass: (state: CompassState) => void;
}

export interface ARControllerOptions {
  view: EclipseView;
  canvas: HTMLCanvasElement;
  /** Parent element the canvas should live under; restored here on teardown. */
  section: HTMLElement | null;
  /** Off-screen arrow DOM elements, written directly in the rAF tick. */
  arrow: HTMLElement | null;
  glyph: SVGSVGElement | null;
  callbacks: ARControllerCallbacks;
  /** Injectable heading source (defaults to `window`). */
  headingSource?: DeviceOrientationLike;
  /** Injectable engine loader (defaults to the browser lazy loader). */
  loadEngine?: () => Promise<unknown>;
  /** Injectable session factory (defaults to the XR8 three.js session). */
  createSession?: (engine: EngineApiLike, canvas: HTMLCanvasElement) => EngineSessionApi;
}

export interface ARController {
  /** Loads the engine, starts the camera pipeline and renders the overlay. */
  start(): Promise<void>;
  /** Idempotent teardown: stops the session, disposes the overlay, restores the canvas. */
  stop(): void;
  /** Drops the captured yaw offset and re-requests the compass permission. */
  recalibrate(): Promise<boolean>;
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

function accuracyOk(accuracyDeg: number | null): boolean {
  // Android reports no accuracy, so nothing to gate on.
  return accuracyDeg === null || accuracyDeg <= COMPASS_ACCURACY_LIMIT_DEG;
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

/**
 * The engine's `Threejs` pipeline module instantiates its renderer from a
 * global `window.THREE` namespace; expose the app's three.js module to it before
 * the camera pipeline starts.
 */
function ensureGlobalThree(): void {
  (window as unknown as { THREE: typeof THREE }).THREE = THREE;
}

/**
 * XRExtras' FullWindowCanvas module moves the canvas into document.body on
 * attach and never moves it back on detach. Restore it under its section so
 * teardown doesn't leave a frozen last AR frame pinned over the results view.
 */
function restoreCanvas(canvas: HTMLCanvasElement, section: HTMLElement | null): void {
  if (section !== null && canvas.parentElement !== section) {
    section.appendChild(canvas);
  }
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

function defaultSessionFactory(engine: EngineApiLike, canvas: HTMLCanvasElement): EngineSessionApi {
  return createEngineSession({
    engine,
    canvas,
    extraModules: fullWindowCanvasModules(window),
  });
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

/**
 * Imperative owner of the AR session: loads the engine, starts the camera
 * pipeline, drives the rAF render loop, captures the compass yaw offset, and
 * tears everything down idempotently. React only renders status; all
 * imperative side effects live here so the component is a thin shell and the
 * lifecycle is unit-testable without a browser.
 */
export function createARController(options: ARControllerOptions): ARController {
  const {
    view,
    canvas,
    section,
    arrow,
    glyph,
    callbacks,
    headingSource,
    loadEngine,
    createSession,
  } = options;

  const source = headingSource ?? defaultHeadingSource();
  const loader = loadEngine ?? createBrowserEngineLoader(engineWindow());
  const sessionFactory = createSession ?? defaultSessionFactory;
  const heading = new HeadingTracker(source);

  let stopped = false;
  let session: EngineSessionApi | null = null;
  let overlay: SkyOverlay | null = null;
  let sceneCamera: SkyCameraLike | null = null;
  let raf = 0;
  let stopHeading: (() => void) | null = null;
  let yawOffsetDeg: number | null = null;

  const params = {
    azimuthDeg: view.sunAzimuthPeakDeg,
    altitudeDeg: view.sunAltitudePeakDeg,
    latitudeDeg: view.observer.lat,
    rSunDeg: view.rSunDeg,
    rMoonDeg: view.rMoonDeg,
    separationDeg: view.separationDeg,
    positionAngleDeg: view.moonPositionAngleDeg,
    obscuration: view.obscuration,
    yawOffsetDeg: 0,
  };

  // An app switch stops deviceorientation events while backgrounded. When the
  // app comes back the magnetometer is usually mid-recalibration, so the first
  // fix can be off. Drop the yaw offset so the next accurate heading
  // re-establishes it from a fresh camera orientation.
  const onResume = () => {
    if (document.visibilityState === 'visible' && yawOffsetDeg !== null) {
      console.info(AR_LOG_PREFIX, 'app foregrounded; re-anchoring compass');
      yawOffsetDeg = null;
    }
  };

  const tick = () => {
    if (overlay !== null && sceneCamera !== null) {
      params.yawOffsetDeg = yawOffsetDeg ?? 0;
      placeSkySun(overlay, params);

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

  const start = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    document.addEventListener('visibilitychange', onResume);
    try {
      if (!(await hasCamera(window))) {
        throw new Error('No camera was found. AR needs the camera.');
      }
      const engine = (await loader()) as EngineApiLike;
      if (stopped) {
        return;
      }
      session = sessionFactory(engine, canvas);
      ensureGlobalThree();
      const xrScene = await withTimeout(session.start(), AR_START_TIMEOUT_MS);
      if (stopped) {
        return;
      }
      overlay = createSkyOverlay(xrScene.scene as THREE.Scene);
      sceneCamera = xrScene.camera as SkyCameraLike;

      let lastHeadingLogAt = 0;
      stopHeading = heading.start(({ headingDeg, absolute, accuracyDeg }) => {
        const now = Date.now();
        if (absolute && headingDeg !== null && accuracyOk(accuracyDeg)) {
          // The engine world frame is fixed for the session, so the offset
          // between compass north and that frame is a constant — capture it
          // once per fix (first fix, foreground re-anchor, or explicit
          // recalibrate) and hold it, instead of re-deriving it per frame
          // where magnetometer noise would shake the sun.
          if (yawOffsetDeg === null && sceneCamera !== null) {
            yawOffsetDeg = northAlignYawOffsetDeg(
              [
                sceneCamera.quaternion.x,
                sceneCamera.quaternion.y,
                sceneCamera.quaternion.z,
                sceneCamera.quaternion.w,
              ],
              headingDeg,
            );
            console.info(
              AR_LOG_PREFIX,
              `heading fix acquired: ${headingDeg.toFixed(1)}° (accuracy ${String(accuracyDeg)})`,
            );
          }
          callbacks.onCompass('aligned');
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

      raf = requestAnimationFrame(tick);
      callbacks.onStatus('active');
    } catch (err) {
      if (!stopped) {
        // Tear the camera/session down so the error screen doesn't sit on top
        // of a still-running camera stream (battery + privacy). Idempotent.
        try {
          session?.stop();
        } catch {
          // Teardown is best-effort; never mask the user-facing error.
        }
        Sentry.captureException(err, {
          tags: { ar: 'start' },
        });
        callbacks.onStatus('error');
        callbacks.onError(friendlyError(err instanceof Error ? err.message : String(err)));
      }
    }
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    document.removeEventListener('visibilitychange', onResume);
    cancelAnimationFrame(raf);
    stopHeading?.();
    overlay?.dispose();
    session?.stop();
    restoreCanvas(canvas, section);
  };

  const recalibrate = async (): Promise<boolean> => {
    // Drop the captured yaw offset so the next accurate heading re-anchors to a
    // fresh reading. Re-surface the (usually already-granted) orientation
    // permission; on iOS this must run inside the button's user gesture.
    yawOffsetDeg = null;
    callbacks.onCompass('requesting');
    console.info(AR_LOG_PREFIX, 'recalibrate: cleared yaw offset, re-requesting permission');
    const granted = await requestDeviceOrientationPermission(
      engineWindow() as unknown as DeviceOrientationLike,
    );
    console.info(AR_LOG_PREFIX, `recalibrate: permission ${granted ? 'granted' : 'denied'}`);
    callbacks.onCompass(granted ? 'waiting' : 'denied');
    return granted;
  };

  return { start, stop, recalibrate };
}
