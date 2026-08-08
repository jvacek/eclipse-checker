import { PermissionError, type PermissionRequestor } from './permission';

export interface HeadingData {
  headingDeg: number | null;
  absolute: boolean;
}

export interface DeviceOrientationEventLike {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number | null;
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

/**
 * Requests the iOS `DeviceOrientationEvent` permission (a no-op that resolves
 * true on platforms where `requestPermission` is not required). Returns whether
 * compass events are authorized. On iOS this must be called from a user gesture.
 */
export async function requestDeviceOrientationPermission(
  source: DeviceOrientationLike = window,
): Promise<boolean> {
  if (typeof source.requestPermission !== 'function') {
    return true;
  }
  try {
    return (await source.requestPermission()) === 'granted';
  } catch {
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
      if (typeof source.requestPermission !== 'function') {
        return;
      }
      const result = await source.requestPermission();
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
    const listener = (event: DeviceOrientationEventLike) => {
      if (typeof event.webkitCompassHeading === 'number') {
        onHeading({
          headingDeg: normalizeDeg(event.webkitCompassHeading),
          absolute: event.absolute,
        });
      } else if (typeof event.alpha === 'number') {
        onHeading({
          headingDeg: compassHeading(event.alpha, this.screenAngle(), event.absolute),
          absolute: event.absolute,
        });
      } else {
        onHeading({ headingDeg: null, absolute: event.absolute });
      }
    };
    this.source.addEventListener('deviceorientation', listener);
    return () => this.source.removeEventListener('deviceorientation', listener);
  }
}
