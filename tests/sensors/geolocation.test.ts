import { describe, expect, it } from 'vitest';

import { createGeolocationRequestor } from '../../src/sensors/geolocation';
import type { GeolocationLike } from '../../src/sensors/geolocation';

function makeGeo(impl: GeolocationLike): GeolocationLike {
  return impl;
}

describe('createGeolocationRequestor', () => {
  it('is unsupported when the geolocation API is missing', () => {
    const requestor = createGeolocationRequestor(undefined as never);
    expect(requestor.isSupported()).toBe(false);
  });

  it('resolves with normalized coordinates on success', async () => {
    const geo = makeGeo({
      getCurrentPosition: (success) =>
        success({
          coords: {
            latitude: 40.4168,
            longitude: -3.7038,
            altitude: 667,
            accuracy: 25,
          },
        }),
    });
    const requestor = createGeolocationRequestor(geo);
    expect(requestor.isSupported()).toBe(true);
    expect(requestor.fallbackAvailable).toBe(true);
    await expect(requestor.request()).resolves.toEqual({
      lat: 40.4168,
      lon: -3.7038,
      altitudeMeters: 667,
      accuracyMeters: 25,
    });
  });

  it('rejects with user-denied for permission-denied error code', async () => {
    const geo = makeGeo({
      getCurrentPosition: (_success, error) => error({ code: 1, message: 'denied' }),
    });
    await expect(createGeolocationRequestor(geo).request()).rejects.toMatchObject({
      reason: 'user-denied',
    });
  });

  it('rejects with error for other geolocation error codes', async () => {
    const geo = makeGeo({
      getCurrentPosition: (_success, error) => error({ code: 3, message: 'timeout' }),
    });
    await expect(createGeolocationRequestor(geo).request()).rejects.toMatchObject({
      reason: 'error',
    });
  });
});
