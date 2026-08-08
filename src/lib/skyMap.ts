import { DEG_TO_RAD } from '../astro/constants';

export interface SkyMapPoint {
  xFrac: number;
  yFrac: number;
}

export function skyMapPoint(azimuthDeg: number, altitudeDeg: number): SkyMapPoint {
  const radiusFrac = Math.max(0, Math.min(1, 1 - Math.max(0, altitudeDeg) / 90));
  const angleRad = (azimuthDeg - 90) * DEG_TO_RAD;
  return {
    xFrac: 0.5 + (radiusFrac * Math.cos(angleRad)) / 2,
    yFrac: 0.5 + (radiusFrac * Math.sin(angleRad)) / 2,
  };
}
