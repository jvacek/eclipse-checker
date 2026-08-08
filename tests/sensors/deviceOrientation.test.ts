import { describe, expect, it, vi } from 'vitest';

import {
  compassHeading,
  createOrientationRequestor,
  HeadingTracker,
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
    expect(onHeading).toHaveBeenLastCalledWith({ headingDeg: 225, absolute: true });

    stop();
    expect(source.listeners).toHaveLength(0);
  });

  it('uses webkitCompassHeading on iOS when available', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({ alpha: 99, beta: 0, gamma: 0, absolute: true, webkitCompassHeading: 44 });
    expect(onHeading).toHaveBeenLastCalledWith({ headingDeg: 44, absolute: true });
  });

  it('emits null heading when alpha is unavailable', () => {
    const source = makeSource();
    const tracker = new HeadingTracker(source);
    const onHeading = vi.fn();
    tracker.start(onHeading);

    source.listeners[0]({ alpha: null, beta: 0, gamma: 0, absolute: true });
    expect(onHeading).toHaveBeenLastCalledWith({ headingDeg: null, absolute: true });
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
