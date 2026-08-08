import { describe, expect, it, vi } from 'vitest';

import {
  PermissionError,
  requestPermission,
  type PermissionRequestor,
} from '../../src/sensors/permission';

function makeRequestor<T>(
  overrides: Partial<PermissionRequestor<T>> = {},
  impl: () => Promise<T> = async () => ({}) as T,
): PermissionRequestor<T> {
  return {
    fallbackAvailable: false,
    isSupported: () => true,
    request: impl,
    ...overrides,
  };
}

describe('requestPermission', () => {
  it('returns denied/unsupported without calling request when unsupported', async () => {
    const request = vi.fn();
    const outcome = await requestPermission(
      makeRequestor({ isSupported: () => false, request: request as () => Promise<never> }),
    );
    expect(outcome).toEqual({
      state: 'denied',
      reason: 'unsupported',
      fallbackAvailable: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns granted with data on success', async () => {
    const outcome = await requestPermission(
      makeRequestor({ fallbackAvailable: true }, async () => ({ ok: true }) as never),
    );
    expect(outcome).toEqual({ state: 'granted', data: { ok: true } });
  });

  it('maps a user-denied PermissionError to denied/user-denied', async () => {
    const outcome = await requestPermission(
      makeRequestor({}, async () => {
        throw new PermissionError('user-denied');
      }),
    );
    expect(outcome).toEqual({ state: 'denied', reason: 'user-denied', fallbackAvailable: false });
  });

  it('maps an error PermissionError to denied/error', async () => {
    const outcome = await requestPermission(
      makeRequestor({}, async () => {
        throw new PermissionError('error', 'position unavailable');
      }),
    );
    expect(outcome).toEqual({ state: 'denied', reason: 'error', fallbackAvailable: false });
  });

  it('maps an unexpected rejection to denied/error', async () => {
    const outcome = await requestPermission(
      makeRequestor({}, async () => {
        throw new Error('boom');
      }),
    );
    expect(outcome).toEqual({ state: 'denied', reason: 'error', fallbackAvailable: false });
  });
});
