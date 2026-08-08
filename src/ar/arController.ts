import * as Sentry from '@sentry/react';
import * as THREE from 'three';

import type { EclipseView } from '../astro';
import { HeadingTracker, requestDeviceOrientationPermission, type DeviceOrientationLike } from '../sensors';
import { createBrowserEngineLoader, type EngineWindowLike } from './engineLoader';
import { createEngineSession, type EngineApiLike, type EngineSessionApi, type EngineTrackingStatus } from './engineSession';
import {
  cameraForwardAzimuthDeg,
  northAlignYawOffsetDeg,
  offscreenSunIndicator,
} from './math';
import {
  createSkyOverlay,
  placeSkySun,
  setupSkyOverlay,
  MIN_SUN_DISPLAY_DEG,
  type SkyOverlay,
} from './scene';

const AR_START_TIMEOUT_MS = 30_000;
const AR_LOG_PREFIX = '[eclipse-checker:ar]';
/**
 * iOS reports `webkitCompassAccuracy` in degrees of error. Above this limit the
 * heading is unreliable (the magnetometer is re-calibrating — typically right
 * after the app returns from being backgrounded), so the fix is not trusted.
 */
export const COMPASS_ACCURACY_LIMIT_DEG = 15;
/**
 * Accuracy readings are surfaced to the UI at this cadence so the calibration
 * bar feels live without re-rendering React at the deviceorientation rate.
 */
const ACCURACY_EMIT_INTERVAL_MS = 250;
/**
 * iOS reports poor `webkitCompassAccuracy` while the magnetometer re-calibrates
 * (right after granting permission, after an app switch, or under magnetic
 * interference). If accuracy never settles, don't leave the AR view stuck
 * unaligned: after this grace period a provisional heading is used (and
 * upgraded the moment a good reading arrives).
 */
const CALIBRATION_GRACE_MS = 5000;

export type CompassState = 'requesting' | 'waiting' | 'provisional' | 'aligned' | 'denied';

export interface ARControllerCallbacks {
  /** Fired once the session is live, or when startup failed. */
  onStatus: (status: 'active' | 'error') => void;
  /** Human-readable start error. */
  onError: (message: string) => void;
  /** Compass alignment transitions (first fix, recalibrate, permission denied). */
  onCompass: (state: CompassState) => void;
  /** Throttled live `webkitCompassAccuracy` feed for the calibration UI. */
  onAccuracy?: (accuracyDeg: number | null) => void;
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
  createSession?: (
    engine: EngineApiLike,
    canvas: HTMLCanvasElement,
    hooks?: { onTrackingStatus?: (tracking: EngineTrackingStatus) => void },
  ) => EngineSessionApi;
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

function defaultSessionFactory(
  engine: EngineApiLike,
  canvas: HTMLCanvasElement,
  hooks?: { onTrackingStatus?: (tracking: EngineTrackingStatus) => void },
): EngineSessionApi {
  return createEngineSession({
    engine,
    canvas,
    extraModules: fullWindowCanvasModules(window),
    onTrackingStatus: hooks?.onTrackingStatus,
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
  /** True when the fix came from a poor-accuracy reading (see CALIBRATION_GRACE_MS). */
  let yawOffsetProvisional = false;
  /** When the current calibration attempt stops waiting for good accuracy. */
  let calibrationDeadlineAt = Date.now() + CALIBRATION_GRACE_MS;
  let calibrationTimer = 0;
  /**
   * The engine's world-tracking state. The engine establishes an arbitrary
   * world frame at session start; the compass offset is only trustworthy once
   * tracking is `NORMAL` (the SLAM frame has settled) and must be re-anchored
   * whenever the engine re-initializes that frame.
   */
  let trackingStatus: EngineTrackingStatus | null = null;

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

  /** Snapshots the engine-world→compass-north rotation from the current camera. */
  const captureOffset = (headingDeg: number, accuracyDeg: number | null, provisional: boolean): void => {
    if (sceneCamera === null) {
      return;
    }
    const quat: [number, number, number, number] = [
      sceneCamera.quaternion.x,
      sceneCamera.quaternion.y,
      sceneCamera.quaternion.z,
      sceneCamera.quaternion.w,
    ];
    const forwardAz = cameraForwardAzimuthDeg(quat);
    yawOffsetDeg = northAlignYawOffsetDeg(quat, headingDeg);
    yawOffsetProvisional = provisional;
    console.info(
      AR_LOG_PREFIX,
      `heading fix ${provisional ? '(provisional) ' : ''}acquired: ${headingDeg.toFixed(1)}° (accuracy ${String(
        accuracyDeg,
      )})`,
    );
    console.debug(AR_LOG_PREFIX, 'north offset', {
      compassHeadingDeg: headingDeg,
      cameraForwardAzimuthDeg: forwardAz,
      yawOffsetDeg,
      provisional,
      trackingStatus,
      quaternion: { x: quat[0], y: quat[1], z: quat[2], w: quat[3] },
    });
  };

  /**
   * Warnings when the calibration grace period elapses without a fix: either
   * accuracy never settled (provisional fix handles that elsewhere) or no
   * absolute events arrived at all (permission likely blocked).
   */
  const armCalibrationTimer = (): void => {
    window.clearTimeout(calibrationTimer);
    calibrationTimer = window.setTimeout(() => {
      if (yawOffsetDeg === null) {
        console.warn(
          AR_LOG_PREFIX,
          `no usable compass heading within ${CALIBRATION_GRACE_MS} ms; deviceorientation events may not be arriving (motion & orientation permission blocked?) — tap Recalibrate compass`,
        );
      }
    }, CALIBRATION_GRACE_MS);
  };

  const resetCalibration = (): void => {
    yawOffsetDeg = null;
    yawOffsetProvisional = false;
    calibrationDeadlineAt = Date.now() + CALIBRATION_GRACE_MS;
    armCalibrationTimer();
  };

  // An app switch stops deviceorientation events while backgrounded. When the
  // app comes back the magnetometer is usually mid-recalibration, so the first
  // fix can be off. Drop the yaw offset so the next heading re-establishes it
  // from a fresh camera orientation (with a fresh grace period).
  const onResume = () => {
    if (document.visibilityState === 'visible' && yawOffsetDeg !== null) {
      console.info(AR_LOG_PREFIX, 'app foregrounded; re-anchoring compass');
      resetCalibration();
    }
  };

  /**
   * The engine's world frame is established arbitrarily at session start and can
   * be re-anchored when tracking is lost and re-acquired. The compass offset is
   * captured against that frame, so a frame change makes it stale: when the
   * engine reports NORMAL tracking right after non-NORMAL (i.e. the frame was
   * (re)established), drop the captured offset and re-anchor on the next
   * accurate heading.
   */
  const onTrackingStatus = (next: EngineTrackingStatus): void => {
    const prev = trackingStatus;
    trackingStatus = next;
    console.info(
      AR_LOG_PREFIX,
      `world tracking: ${next.status}${next.reason !== 'UNSPECIFIED' ? ` (${next.reason})` : ''}${
        prev !== null && prev.status !== next.status ? ` (was ${prev.status})` : ''
      }`,
    );
    if (prev !== null && next.status === 'NORMAL' && prev.status !== 'NORMAL' && yawOffsetDeg !== null) {
      console.warn(
        AR_LOG_PREFIX,
        'engine re-established its world frame; captured compass offset is stale — dropping and re-anchoring on the next accurate heading',
      );
      resetCalibration();
      callbacks.onCompass('waiting');
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
      session = sessionFactory(engine, canvas, { onTrackingStatus });
      ensureGlobalThree();
      const xrScene = await withTimeout(session.start(), AR_START_TIMEOUT_MS);
      if (stopped) {
        return;
      }
      overlay = createSkyOverlay(xrScene.scene as THREE.Scene);
      sceneCamera = xrScene.camera as SkyCameraLike;
      // The eclipse geometry (scale, disc shape, obscuration) is session-constant;
      // apply it once so the rAF tick only rotates/positions the overlay.
      setupSkyOverlay(overlay, params);

      let lastAccuracyEmitAt = 0;
      resetCalibration();
      stopHeading = heading.start(({ headingDeg, absolute, accuracyDeg }) => {
        const now = Date.now();
        // Surface the live accuracy to the UI even before a usable heading
        // exists (e.g. right after permission grant when webkitCompassAccuracy
        // is still ~20–50°), throttled so the calibration bar doesn't re-render
        // React at the deviceorientation rate.
        if (
          callbacks.onAccuracy !== undefined &&
          accuracyDeg !== null &&
          now - lastAccuracyEmitAt >= ACCURACY_EMIT_INTERVAL_MS
        ) {
          lastAccuracyEmitAt = now;
          callbacks.onAccuracy(accuracyDeg);
        }
        if (!absolute || headingDeg === null) {
          return;
        }

        const accurate = accuracyOk(accuracyDeg);
        const graceElapsed = now >= calibrationDeadlineAt;
        // The engine's world frame (and therefore the camera quaternion) is not
        // meaningful until world tracking settles to NORMAL. Capturing the
        // compass offset against an initializing frame freezes a wrong north
        // for the whole session.
        const trackingSettled =
          trackingStatus === null || trackingStatus.status === 'NORMAL';

        if (yawOffsetDeg === null) {
          if (accurate && trackingSettled) {
            // The engine world frame is fixed for the session, so the offset
            // between compass north and that frame is a constant — capture it
            // once per fix (first fix, foreground re-anchor, or explicit
            // recalibrate) and hold it, instead of re-deriving it per frame
            // where magnetometer noise would shake the sun.
            captureOffset(headingDeg, accuracyDeg, false);
            callbacks.onCompass('aligned');
          } else if (accurate && !trackingSettled) {
            // Heading is accurate but the engine hasn't finished establishing
            // its world frame. Wait rather than trust a provisional quaternion.
          } else if (graceElapsed) {
            // Accuracy never settled within the grace period (stubborn
            // magnetometer / interference). Fall back to a provisional fix so
            // the AR view is not stuck unaligned; it is upgraded the moment an
            // accurate reading arrives.
            captureOffset(headingDeg, accuracyDeg, true);
            callbacks.onCompass('provisional');
            console.warn(
              AR_LOG_PREFIX,
              `compass accuracy still poor after ${CALIBRATION_GRACE_MS} ms (${String(
                accuracyDeg,
              )}°); using a provisional heading — move the phone in a figure-8 or tap Recalibrate`,
            );
          }
        } else if (yawOffsetProvisional && accurate) {
          // A good reading arrived; upgrade the provisional fix to a trusted one.
          // (Deliberately not gated on trackingSettled: the provisional offset
          // was already captured against the current frame, so an accurate
          // reading is strictly better — and the re-anchor path handles frame
          // changes. Gating here would strand the user in 'provisional' forever
          // when SLAM never reports NORMAL, e.g. pointing at a featureless sky.)
          captureOffset(headingDeg, accuracyDeg, false);
          callbacks.onCompass('aligned');
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
    window.clearTimeout(calibrationTimer);
    stopHeading?.();
    overlay?.dispose();
    session?.stop();
    restoreCanvas(canvas, section);
  };

  const recalibrate = async (): Promise<boolean> => {
    // Drop the captured yaw offset so the next heading re-anchors to a fresh
    // reading (with a fresh grace period). Re-surface the (usually
    // already-granted) orientation permission; on iOS this must run inside the
    // button's user gesture. Note iOS only shows the prompt once per site —
    // after a grant it resolves 'granted' without re-prompting, so recalibration
    // succeeds on the next accurate reading rather than a new dialog.
    resetCalibration();
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
