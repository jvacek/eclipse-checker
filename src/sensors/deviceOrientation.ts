import { PermissionError, type PermissionRequestor } from './permission';

const LOG_PREFIX = '[eclipse-checker:heading]';
/** deviceorientation events fire at display rate; sample the debug log. */
const EVENT_LOG_INTERVAL_MS = 1000;

export interface HeadingData {
  headingDeg: number | null;
  absolute: boolean;
  /**
   * iOS `webkitCompassAccuracy` in degrees of error; null when the platform
   * does not report it (e.g. Android). Degrades while the magnetometer
   * re-calibrates — notably right after the app returns from another app.
   */
  accuracyDeg: number | null;
}

export interface DeviceOrientationEventLike {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number | null;
  webkitCompassAccuracy?: number | null;
}

export interface DeviceOrientationLike {
  requestPermission?: () => Promise<string>;
  addEventListener(
    type: 'deviceorientation',
    listener: (event: DeviceOrientationEventLike) => void,
  ): void;
  removeEventListener(
    type: 'deviceorientation',
    listener: (event: DeviceOrientationEventLike) => void,
  ): void;
}

export function compassHeading(
  alphaDeg: number,
  screenAngleDeg = 0,
  absolute = true,
): number | null {
  if (!absolute || !Number.isFinite(alphaDeg)) {
    return null;
  }
  return normalizeDeg(360 - (alphaDeg + screenAngleDeg));
}

function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

type OrientationPermissionApi = () => Promise<string>;

/**
 * Resolves the iOS permission prompt for a source. iOS exposes it as a static
 * on the `DeviceOrientationEvent` constructor — NOT on `window` — so fall back
 * to a lazy global lookup when the source has none. Resolved at request time so
 * tests can stub the global after import.
 */
function permissionApiFor(source: DeviceOrientationLike): OrientationPermissionApi | undefined {
  if (typeof source.requestPermission === 'function') {
    return source.requestPermission.bind(source);
  }
  const ctor = (
    globalThis as {
      DeviceOrientationEvent?: { requestPermission?: OrientationPermissionApi };
    }
  ).DeviceOrientationEvent;
  if (ctor === undefined || typeof ctor.requestPermission !== 'function') {
    return undefined;
  }
  return ctor.requestPermission.bind(ctor);
}

/**
 * Requests the iOS `DeviceOrientationEvent` permission (a no-op that resolves
 * true on platforms where `requestPermission` is not required). Returns whether
 * compass events are authorized. On iOS this must be called from a user gesture.
 */
export async function requestDeviceOrientationPermission(
  source: DeviceOrientationLike = window,
): Promise<boolean> {
  const api = permissionApiFor(source);
  if (api === undefined) {
    console.debug(LOG_PREFIX, 'no permission API found; assuming compass access is allowed');
    return true;
  }
  try {
    const result = await api();
    console.debug(LOG_PREFIX, `permission request resolved "${result}"`);
    return result === 'granted';
  } catch (err) {
    console.debug(LOG_PREFIX, 'permission request threw', err);
    return false;
  }
}

export function createOrientationRequestor(
  source: DeviceOrientationLike = window,
): PermissionRequestor<void> {
  return {
    fallbackAvailable: false,
    isSupported: () => source !== undefined,
    request: async () => {
      const api = permissionApiFor(source);
      if (api === undefined) {
        return;
      }
      const result = await api();
      if (result !== 'granted') {
        throw new PermissionError('user-denied');
      }
    },
  };
}

export class HeadingTracker {
  constructor(
    private readonly source: DeviceOrientationLike,
    private readonly screenAngle: () => number = () => 0,
  ) {}

  start(onHeading: (heading: HeadingData) => void): () => void {
    let lastLogAt = 0;
    const listener = (event: DeviceOrientationEventLike) => {
      const accuracyDeg =
        typeof event.webkitCompassAccuracy === 'number' ? event.webkitCompassAccuracy : null;
      let heading: HeadingData;
      let source: 'webkitCompassHeading' | 'alpha' | 'none';
      const webkitHeading = event.webkitCompassHeading;
      if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
        // webkitCompassHeading is earth-referenced (degrees clockwise from
        // north), i.e. it IS an absolute heading. iOS always reports
        // event.absolute === false on deviceorientation events, so the flag
        // must not gate this value.
        source = 'webkitCompassHeading';
        heading = { headingDeg: normalizeDeg(webkitHeading), absolute: true, accuracyDeg };
      } else if (typeof event.alpha === 'number') {
        source = 'alpha';
        heading = {
          headingDeg: compassHeading(event.alpha, this.screenAngle(), event.absolute),
          absolute: event.absolute,
          accuracyDeg,
        };
      } else {
        source = 'none';
        heading = { headingDeg: null, absolute: event.absolute, accuracyDeg };
      }
      lastLogAt = logEventThrottled(lastLogAt, source, event, heading);
      onHeading(heading);
    };
    this.source.addEventListener('deviceorientation', listener);
    return () => this.source.removeEventListener('deviceorientation', listener);
  }
}

function logEventThrottled(
  lastLogAt: number,
  source: 'webkitCompassHeading' | 'alpha' | 'none',
  event: DeviceOrientationEventLike,
  heading: HeadingData,
): number {
  const now = Date.now();
  if (now - lastLogAt < EVENT_LOG_INTERVAL_MS) {
    return lastLogAt;
  }
  console.debug(LOG_PREFIX, 'deviceorientation event', {
    source,
    alpha: event.alpha,
    beta: event.beta,
    gamma: event.gamma,
    absolute: event.absolute,
    webkitCompassHeading: event.webkitCompassHeading ?? null,
    webkitCompassAccuracy: event.webkitCompassAccuracy ?? null,
    emittedHeadingDeg: heading.headingDeg,
    emittedAbsolute: heading.absolute,
  });
  return now;
}
