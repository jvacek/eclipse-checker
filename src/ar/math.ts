import { DEG_TO_RAD } from '../astro/constants';

export type QuaternionTuple = [number, number, number, number];

export function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

const RAD_TO_DEG = 180 / Math.PI;

export function northAlignedAzimuth(azimuthDeg: number, yawOffsetDeg: number): number {
  return normalizeDeg(azimuthDeg - yawOffsetDeg);
}

export interface Direction3 {
  x: number;
  y: number;
  z: number;
}

export function sunDirectionVector(azimuthDeg: number, altitudeDeg: number): Direction3 {
  const az = azimuthDeg * DEG_TO_RAD;
  const alt = altitudeDeg * DEG_TO_RAD;
  return {
    x: Math.sin(az) * Math.cos(alt),
    y: Math.sin(alt),
    z: -Math.cos(az) * Math.cos(alt),
  };
}

export interface EclipseDiscGeometry {
  moonOffsetX: number;
  moonOffsetY: number;
  moonRadius: number;
}

export function eclipseDiscGeometry(
  rSunDeg: number,
  rMoonDeg: number,
  separationDeg: number,
  positionAngleDeg: number,
): EclipseDiscGeometry {
  const distance = rSunDeg > 0 ? separationDeg / rSunDeg : 0;
  const pa = positionAngleDeg * DEG_TO_RAD;
  return {
    moonOffsetX: Math.sin(pa) * distance,
    moonOffsetY: Math.cos(pa) * distance,
    moonRadius: rSunDeg > 0 ? rMoonDeg / rSunDeg : 0,
  };
}

// Rotates the vector (vx, vy, vz) by the unit quaternion q.
function rotateQuaternion(
  q: QuaternionTuple,
  vx: number,
  vy: number,
  vz: number,
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const cx = qy * vz - qz * vy;
  const cy = qz * vx - qx * vz;
  const cz = qx * vy - qy * vx;
  const dx = qy * cz - qz * cy;
  const dy = qz * cx - qx * cz;
  const dz = qx * cy - qy * cx;
  return [vx + 2 * qw * cx + 2 * dx, vy + 2 * qw * cy + 2 * dy, vz + 2 * qw * cz + 2 * dz];
}

function cameraForwardAzimuthDeg(q: QuaternionTuple): number {
  const f = rotateQuaternion(q, 0, 0, -1);
  return normalizeDeg(Math.atan2(f[0], -f[2]) * RAD_TO_DEG);
}

export function northAlignYawOffsetDeg(
  cameraQuaternion: QuaternionTuple,
  compassHeadingDeg: number,
): number {
  return normalizeDeg(compassHeadingDeg - cameraForwardAzimuthDeg(cameraQuaternion));
}

export interface OffscreenIndicator {
  /** CSS rotation for an up-pointing arrow glyph; 0 = up, clockwise positive. */
  angleDeg: number;
  /** Fraction of viewport width, clamped to [margin, 1-margin]. */
  x: number;
  /** Fraction of viewport height measured from the top. */
  y: number;
}

export function offscreenSunIndicator(
  cameraQuaternion: QuaternionTuple,
  sunDirection: Direction3, // may be un-normalized (e.g. overlay.sun.position)
  fovDeg: number, // camera vertical FOV
  aspect: number, // viewport width / height
  margin = 0.12,
): OffscreenIndicator | null {
  // camera space: rotate by the conjugate (unit quaternion) — camera looks down -z
  const [qx, qy, qz, qw] = cameraQuaternion;
  const [vx, vy, vz] = rotateQuaternion(
    [-qx, -qy, -qz, qw],
    sunDirection.x,
    sunDirection.y,
    sunDirection.z,
  );

  const tanV = Math.tan((fovDeg * DEG_TO_RAD) / 2);
  const tanH = tanV * aspect;

  let ndcX: number;
  let ndcY: number;
  if (vz < -1e-6) {
    ndcX = vx / -vz / tanH;
    ndcY = vy / -vz / tanV;
    if (Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1) {
      return null; // on screen
    }
  } else {
    // Behind the camera: point toward (vx, vy) as-is — NOT negated.
    ndcX = vx;
    ndcY = vy;
    if (Math.hypot(ndcX, ndcY) < 1e-6) {
      ndcX = 0;
      ndcY = -1; // straight behind: point down
    }
  }

  const len = Math.hypot(ndcX, ndcY);
  const dx = ndcX / len;
  const dy = ndcY / len;
  const halfX = 0.5 - margin;
  const halfY = 0.5 - margin;
  const t = Math.min(halfX / Math.abs(dx), halfY / Math.abs(dy));
  return {
    angleDeg: Math.atan2(dx, dy) * RAD_TO_DEG, // 0 = up, clockwise (CSS rotate)
    x: 0.5 + dx * t,
    y: 0.5 - dy * t, // NDC y-up -> screen y-down
  };
}
