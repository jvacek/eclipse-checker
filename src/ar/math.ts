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


