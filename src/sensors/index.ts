export { requestPermission, PermissionError } from './permission';
export type {
  PermissionDeniedReason,
  PermissionOutcome,
  PermissionRequestor,
  PermissionState,
} from './permission';
export { createGeolocationRequestor } from './geolocation';
export type { GeolocationData, GeolocationLike, GeolocationPositionLike } from './geolocation';
export {
  compassHeading,
  createOrientationRequestor,
  HeadingTracker,
  requestDeviceOrientationPermission,
} from './deviceOrientation';
export type {
  DeviceOrientationEventLike,
  DeviceOrientationLike,
  HeadingData,
} from './deviceOrientation';
