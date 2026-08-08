// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHeading } from '../../src/hooks/useHeading';
import type { DeviceOrientationEventLike } from '../../src/sensors';

function installListenerSpy() {
  const listeners: Array<(event: DeviceOrientationEventLike) => void> = [];
  const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    if (type === 'deviceorientation') {
      listeners.push(listener as unknown as (event: DeviceOrientationEventLike) => void);
    }
  }) as Window['addEventListener']);
  const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    if (type === 'deviceorientation') {
      const idx = listeners.indexOf(
        listener as unknown as (event: DeviceOrientationEventLike) => void,
      );
      if (idx >= 0) listeners.splice(idx, 1);
    }
  }) as Window['removeEventListener']);
  return { addSpy, removeSpy, listeners };
}

describe('useHeading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a deviceorientation listener only when enabled', () => {
    const { addSpy } = installListenerSpy();
    const { rerender } = renderHook(({ enabled }) => useHeading(enabled), {
      initialProps: { enabled: false },
    });
    expect(addSpy).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function));

    rerender({ enabled: true });
    expect(addSpy).toHaveBeenCalledWith('deviceorientation', expect.any(Function));
  });

  it('removes the listener when the hook is disabled', () => {
    const { addSpy, removeSpy } = installListenerSpy();
    const { rerender } = renderHook(({ enabled }) => useHeading(enabled), {
      initialProps: { enabled: true },
    });
    expect(addSpy).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    expect(removeSpy).toHaveBeenCalledWith('deviceorientation', expect.any(Function));
  });

  it('removes the listener on unmount', () => {
    const { addSpy, removeSpy } = installListenerSpy();
    const { unmount } = renderHook(() => useHeading(true));
    expect(addSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('deviceorientation', expect.any(Function));
  });
});
