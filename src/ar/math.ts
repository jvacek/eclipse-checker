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
  // PA is measured counterclockwise from celestial north (0 north, 90 east).
  // The disc plane's +Y is celestial north and +X celestial west (screen
  // right when facing the sun), so the eastward component is -X. `|| 0`
  // normalizes a degenerate -0.
  return {
    moonOffsetX: -Math.sin(pa) * distance || 0,
    moonOffsetY: Math.cos(pa) * distance || 0,
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

/**
 * World-anchored orientation for the sun disc plane. The plane's local +Y
 * points at celestial north (the north celestial pole projected onto the disc
 * plane), local +Z toward the observer, and local +X at celestial west — the
 * unique right-handed completion. The crescent's position angle is measured
 * counterclockwise from celestial north, so anchoring +Y to it (rather than
 * copying the camera orientation, which pins the crescent to the screen) keeps
 * the moon's offset fixed in the sky while the phone rotates.
 *
 * @param azimuthDeg true compass azimuth of the sun
 * @param altitudeDeg sun altitude
 * @param latitudeDeg observer latitude (to locate the NCP)
 */
export function sunDiscOrientation(
  azimuthDeg: number,
  altitudeDeg: number,
  latitudeDeg: number,
): QuaternionTuple {
  const s = sunDirectionVector(azimuthDeg, altitudeDeg);
  const ncp = sunDirectionVector(0, latitudeDeg);
  const ncpDot = s.x * ncp.x + s.y * ncp.y + s.z * ncp.z;

  // Project the NCP onto the plane perpendicular to the sun direction.
  const north = {
    x: ncp.x - s.x * ncpDot,
    y: ncp.y - s.y * ncpDot,
    z: ncp.z - s.z * ncpDot,
  };
  const northLen = Math.hypot(north.x, north.y, north.z);
  if (northLen < 1e-6) {
    // Sun at the celestial pole: celestial north is undefined in the disc;
    // fall back to the zenith-projected up so the disc keeps a stable tilt.
    const upDot = s.y;
    const projLen = Math.hypot(-s.x * upDot, 1 - s.y * upDot, -s.z * upDot) || 1;
    north.x = (-s.x * upDot) / projLen;
    north.y = (1 - s.y * upDot) / projLen;
    north.z = (-s.z * upDot) / projLen;
  } else {
    north.x /= northLen;
    north.y /= northLen;
    north.z /= northLen;
  }

  // +Z toward the observer, +X = cross(+Y, +Z) — celestial west. This is the
  // unique right-handed frame with +Y = celestial north and the front face
  // toward the camera, so the moon's position angle is not mirrored (see
  // eclipseDiscGeometry: PA 90° = east renders at the observer's left).
  const z = { x: -s.x, y: -s.y, z: -s.z };
  const west = {
    x: north.y * z.z - north.z * z.y,
    y: north.z * z.x - north.x * z.z,
    z: north.x * z.y - north.y * z.x,
  };
  const westLen = Math.hypot(west.x, west.y, west.z);
  if (westLen < 1e-6) {
    return [0, 0, 0, 1];
  }
  west.x /= westLen;
  west.y /= westLen;
  west.z /= westLen;

  return quaternionFromBasis(west, north, z);
}

/** Quaternion (x, y, z, w) from an orthonormal right-handed basis of column axes. */
function quaternionFromBasis(
  x: Direction3,
  y: Direction3,
  z: Direction3,
): QuaternionTuple {
  const m00 = x.x;
  const m01 = y.x;
  const m02 = z.x;
  const m10 = x.y;
  const m11 = y.y;
  const m12 = z.y;
  const m20 = x.z;
  const m21 = y.z;
  const m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
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
  /** Keep the arrow until the sun's disc (this angular radius) clears the edge. */
  hidePadDeg = 0,
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
  const padY = Math.tan(hidePadDeg * DEG_TO_RAD) / tanV;
  const padX = padY / aspect;
  if (vz < -1e-6) {
    ndcX = vx / -vz / tanH;
    ndcY = vy / -vz / tanV;
    if (Math.abs(ndcX) <= 1 - padX && Math.abs(ndcY) <= 1 - padY) {
      return null; // the sun disc is fully inside the viewport
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
