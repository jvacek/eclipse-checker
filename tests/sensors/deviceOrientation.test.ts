import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compassHeading,
  createOrientationRequestor,
  HeadingTracker,
  requestDeviceOrientationPermission,
  type DeviceOrientationEventLike,
  type DeviceOrientationLike,
} from '../../src/sensors/deviceOrientation';

describe('compassHeading', () => {
  it('returns null for an uncalibrated magnetometer', () => {
    expect(compassHeading(180, 0, false)).toBeNull();
  });

  it('returns 0 when pointing north', () => {
    expect(compassHeading(0, 0, true)).toBe(0);
  });

  it('converts alpha to a compass bearing', () => {
    expect(compassHeading(90, 0, true)).toBe(270);
    expect(compassHeading(180, 0, true)).toBe(180);
    expect(compassHeading(270, 0, true)).toBe(90);
  });

  it('applies the screen-orientation correction', () => {
    expect(compassHeading(0, 90, true)).toBe(270);
  });

  it('normalizes into [0, 360)', () => {
    expect(compassHeading(359, 90, true)).toBeCloseTo(271, 6);
    expect(compassHeading(1, 359, true)).toBeCloseTo(0, 6);
  });
});

describe('HeadingTracker', () => {
  function makeSource(): DeviceOrientationLike & {
    listeners: Array<(e: DeviceOrientationEventLike) => void>;
  } {
    const listeners: Array<(e: DeviceOrientationEventLike) => void> = [];
    return {
      listeners,
      addEventListener: (_type, listener) => listeners.push(listener),
      removeEventListener: (_type, listener) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }

  it('emits corrected Android headings and stops on cleanup', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source, () => 90);
    const onHeading = vi.fn();
    const stop = tracker.start(onHeading);

    source.listeners[0]({ alpha: 45, beta: 0, gamma: 0, absolute: true });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: 225,
      absolute: true,
      accuracyDeg: null,
    });

    stop();
    expect(source.listeners).toHaveLength(0);
  });

  it('uses webkitCompassHeading on iOS when available', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({ alpha: 99, beta: 0, gamma: 0, absolute: true, webkitCompassHeading: 44 });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: 44,
      absolute: true,
      accuracyDeg: null,
    });
  });

  it('treats webkitCompassHeading as absolute even though iOS reports absolute: false', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    // iOS Safari always reports absolute: false on deviceorientation events;
    // the webkit compass heading is earth-referenced regardless.
    source.listeners[0]({
      alpha: 99,
      beta: 0,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 44,
    });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: 44,
      absolute: true,
      accuracyDeg: null,
    });
  });

  it('forwards webkitCompassAccuracy when iOS reports it', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 44,
      webkitCompassAccuracy: 40,
    });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: 44,
      absolute: true,
      accuracyDeg: 40,
    });
  });

  it('ignores a non-finite webkitCompassHeading and falls back to alpha', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({
      alpha: 90,
      beta: 0,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: Number.NaN,
    });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: 270,
      absolute: true,
      accuracyDeg: null,
    });
  });

  it('emits null heading when alpha is unavailable', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({ alpha: null, beta: 0, gamma: 0, absolute: true });
    expect(onHeading).toHaveBeenLastCalledWith({
      headingDeg: null,
      absolute: true,
      accuracyDeg: null,
    });
  });
});

describe('createOrientationRequestor', () => {
  it('resolves without a prompt when requestPermission is not required', async () => {
    const requestor = createOrientationRequestor({ addEventListener: () => undefined } as never);
    await expect(requestor.request()).resolves.toBeUndefined();
  });

  it('throws user-denied when the iOS prompt is refused', async () => {
    const requestor = createOrientationRequestor({
      requestPermission: async () => 'denied',
    } as never);
    await expect(requestor.request()).rejects.toMatchObject({ reason: 'user-denied' });
  });
});

describe('requestDeviceOrientationPermission', () => {
  afterEach(() => {
    delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  });

  function windowLike(): DeviceOrientationLike {
    // Real windows have the listener APIs but no requestPermission of their own.
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }

  it('falls back to the DeviceOrientationEvent static, as on iOS', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission,
    };

    await expect(requestDeviceOrientationPermission(windowLike())).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('prefers the source’s own requestPermission over the global static', async () => {
    const globalRequest = vi.fn(async () => 'denied' as const);
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission: globalRequest,
    };
    const sourceRequest = vi.fn(async () => 'granted' as const);

    const source: DeviceOrientationLike = { ...windowLike(), requestPermission: sourceRequest };
    await expect(requestDeviceOrientationPermission(source)).resolves.toBe(true);
    expect(sourceRequest).toHaveBeenCalledTimes(1);
    expect(globalRequest).not.toHaveBeenCalled();
  });

  it('resolves true when no permission API exists', async () => {
    await expect(requestDeviceOrientationPermission(windowLike())).resolves.toBe(true);
  });

  it('resolves false when the iOS prompt is refused', async () => {
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission: async () => 'denied',
    };
    await expect(requestDeviceOrientationPermission(windowLike())).resolves.toBe(false);
  });

  it('resolves false when the prompt throws (e.g. outside a user gesture)', async () => {
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission: async () => {
        throw new Error('user gesture required');
      },
    };
    await expect(requestDeviceOrientationPermission(windowLike())).resolves.toBe(false);
  });
});
