import { Body, Equator, Horizon, Observer, type FlexibleDateTime } from 'astronomy-engine';

import { AU_METERS, RAD_TO_DEG } from './constants';

export type RefractionOption = 'normal' | 'none';

export interface TopocentricHorizontal {
  azimuth: number;
  altitude: number;
  distanceAu: number;
  ra: number;
  dec: number;
}

export function getTopocentricHorizontal(
  body: Body,
  time: FlexibleDateTime,
  observer: Observer,
  refraction: RefractionOption = 'normal',
): TopocentricHorizontal {
  const equatorial = Equator(body, time, observer, true, true);
  const horizontal =
    refraction === 'normal'
      ? Horizon(time, observer, equatorial.ra, equatorial.dec, 'normal')
      : Horizon(time, observer, equatorial.ra, equatorial.dec);
  return {
    azimuth: horizontal.azimuth,
    altitude: horizontal.altitude,
    distanceAu: equatorial.dist,
    ra: equatorial.ra,
    dec: equatorial.dec,
  };
}

export function getAngularRadiusDeg(bodyRadiusMeters: number, distanceAu: number): number {
  return Math.asin(bodyRadiusMeters / (distanceAu * AU_METERS)) * RAD_TO_DEG;
}
