import { DEG_TO_RAD, RAD_TO_DEG } from './constants';
import { normalizeDeg } from '../lib/angles';

export function angularSeparationDeg(
  ra1Hours: number,
  dec1Deg: number,
  ra2Hours: number,
  dec2Deg: number,
): number {
  const a1 = ra1Hours * 15 * DEG_TO_RAD;
  const d1 = dec1Deg * DEG_TO_RAD;
  const a2 = ra2Hours * 15 * DEG_TO_RAD;
  const d2 = dec2Deg * DEG_TO_RAD;
  const cosSep = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(clamp(cosSep, -1, 1)) * RAD_TO_DEG;
}

export function positionAngleDeg(
  sunRaHours: number,
  sunDecDeg: number,
  moonRaHours: number,
  moonDecDeg: number,
): number {
  const as = sunRaHours * 15 * DEG_TO_RAD;
  const ds = sunDecDeg * DEG_TO_RAD;
  const am = moonRaHours * 15 * DEG_TO_RAD;
  const dm = moonDecDeg * DEG_TO_RAD;
  const pa = Math.atan2(
    Math.cos(ds) * Math.sin(am - as),
    Math.sin(dm) * Math.cos(ds) - Math.cos(dm) * Math.sin(ds) * Math.cos(am - as),
  );
  return normalizeDeg(pa * RAD_TO_DEG);
}

export function magnitudeFromGeometry(
  rSunDeg: number,
  rMoonDeg: number,
  separationDeg: number,
): number {
  return (rSunDeg + rMoonDeg - separationDeg) / (2 * rSunDeg);
}

export function circleOverlapFraction(r1: number, r2: number, distance: number): number {
  if (distance >= r1 + r2) return 0;
  if (distance <= Math.abs(r2 - r1)) {
    // One disc fully contains the other. Obscuration is the area ratio, not 1 —
    // for an annular eclipse (moon < sun) that's (rMoon/rSun)².
    return Math.min(r1, r2) ** 2 / (r1 * r1);
  }
  const a1 = Math.acos(
    clamp((r1 * r1 + distance * distance - r2 * r2) / (2 * r1 * distance), -1, 1),
  );
  const a2 = Math.acos(
    clamp((r2 * r2 + distance * distance - r1 * r1) / (2 * r2 * distance), -1, 1),
  );
  const area =
    a1 * r1 * r1 +
    a2 * r2 * r2 -
    0.5 *
      Math.sqrt(
        Math.max(
          0,
          (-distance + r1 + r2) *
            (distance + r1 - r2) *
            (distance - r1 + r2) *
            (distance + r1 + r2),
        ),
      );
  return clamp(area / (Math.PI * r1 * r1), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
