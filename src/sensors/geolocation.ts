import { PermissionError, type PermissionRequestor } from './permission';

export interface GeolocationData {
  lat: number;
  lon: number;
  altitudeMeters: number | null;
  accuracyMeters: number;
}

export interface GeolocationPositionLike {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
  };
}

export interface GeolocationPositionErrorLike {
  code: number;
  message?: string;
}

export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPositionLike) => void,
    error: (err: GeolocationPositionErrorLike) => void,
    options?: PositionOptions,
  ): void;
}

const PERMISSION_DENIED_CODE = 1;

export function createGeolocationRequestor(
  geo?: GeolocationLike,
): PermissionRequestor<GeolocationData> {
  const resolve = (): GeolocationLike => (geo === undefined ? navigator.geolocation : geo);
  return {
    fallbackAvailable: true,
    isSupported: () => {
      const current = resolve();
      return current !== undefined && typeof current.getCurrentPosition === 'function';
    },
    request: () =>
      new Promise<GeolocationData>((resolveValue, rejectValue) => {
        resolve().getCurrentPosition(
          (position) =>
            resolveValue({
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              altitudeMeters: position.coords.altitude,
              accuracyMeters: position.coords.accuracy,
            }),
          (err) =>
            rejectValue(
              new PermissionError(
                err.code === PERMISSION_DENIED_CODE ? 'user-denied' : 'error',
                err.message,
              ),
            ),
          { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
        );
      }),
  };
}
