import {
  Body,
  MakeTime,
  Observer,
  SearchLocalSolarEclipse,
  type AstroTime,
  type EclipseEvent,
  type FlexibleDateTime,
  type LocalSolarEclipseInfo,
} from 'astronomy-engine';

import {
  getAngularRadiusDeg,
  getTopocentricHorizontal,
  type RefractionOption,
} from './coordinates';
import { MOON_RADIUS_METERS, SUN_RADIUS_METERS } from './constants';
import {
  angularSeparationDeg,
  circleOverlapFraction,
  magnitudeFromGeometry,
  positionAngleDeg,
} from './geometry';
import type {
  EclipseKind,
  EclipseEventLocal,
  EclipseSample,
  EclipseView,
  ObserverLocation,
} from './types';

const SECONDS_PER_DAY = 86400;
const DEFAULT_SEARCH_HORIZON_DAYS = 3650;
const J2000_UNIX_OFFSET_SECONDS = 946728000;
const PRE_ECLIPSE_SEARCH_LEAD_DAYS = 1.5;

const KIND_MAP: Record<string, EclipseKind> = {
  partial: 'Partial',
  annular: 'Annular',
  total: 'Total',
};

export interface EclipseCalculationOptions {
  refDate?: FlexibleDateTime;
  timezone?: string;
  refraction?: RefractionOption;
  searchHorizonDays?: number;
}

interface ResolvedOptions {
  refDate: FlexibleDateTime;
  timezone: string;
  refraction: RefractionOption;
  searchHorizonDays: number;
}

export const EclipseCalculator = {
  forLocation(
    location: ObserverLocation,
    options: EclipseCalculationOptions = {},
  ): EclipseView | null {
    const opts = resolveOptions(options);
    const observer = new Observer(location.lat, location.lon, location.heightMeters);
    const info = SearchLocalSolarEclipse(opts.refDate, observer);
    return buildView(info, location, observer, opts, false);
  },

  forEclipseDate(
    eclipseDateIso: string,
    location: ObserverLocation,
    options: EclipseCalculationOptions = {},
  ): EclipseView | null {
    const opts = resolveOptions(options);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eclipseDateIso)) {
      return null;
    }
    const targetStart = new Date(`${eclipseDateIso}T00:00:00Z`);
    if (Number.isNaN(targetStart.getTime())) {
      return null;
    }
    const searchStart = new Date(
      targetStart.getTime() - PRE_ECLIPSE_SEARCH_LEAD_DAYS * SECONDS_PER_DAY * 1000,
    );
    const observer = new Observer(location.lat, location.lon, location.heightMeters);
    const info = SearchLocalSolarEclipse(searchStart, observer);
    const peakUtMs = epochMs(info.peak.time);
    if (
      peakUtMs < targetStart.getTime() ||
      peakUtMs >= targetStart.getTime() + SECONDS_PER_DAY * 1000
    ) {
      return null;
    }
    return buildView(info, location, observer, opts, true);
  },

  // @todo Not currently surfaced in the UI; kept as the scrubber primitive for
  // the per-time-of-day slider. Do not delete — it is unit-tested.
  sampleAt(
    time: FlexibleDateTime,
    location: ObserverLocation,
    options: EclipseCalculationOptions = {},
  ): EclipseSample {
    const opts = resolveOptions(options);
    const observer = new Observer(location.lat, location.lon, location.heightMeters);
    const timeObj = MakeTime(time);
    const sun = getTopocentricHorizontal(Body.Sun, timeObj, observer, opts.refraction);
    const moon = getTopocentricHorizontal(Body.Moon, timeObj, observer, opts.refraction);
    const rSunDeg = getAngularRadiusDeg(SUN_RADIUS_METERS, sun.distanceAu);
    const rMoonDeg = getAngularRadiusDeg(MOON_RADIUS_METERS, moon.distanceAu);
    const separationDeg = angularSeparationDeg(sun.ra, sun.dec, moon.ra, moon.dec);
    return {
      utcIso: formatUtcIso(timeObj),
      sunAltitudeDeg: sun.altitude,
      sunAzimuthDeg: sun.azimuth,
      moonAltitudeDeg: moon.altitude,
      moonAzimuthDeg: moon.azimuth,
      separationDeg,
      positionAngleDeg: positionAngleDeg(sun.ra, sun.dec, moon.ra, moon.dec),
      rSunDeg,
      rMoonDeg,
      magnitude: magnitudeFromGeometry(rSunDeg, rMoonDeg, separationDeg),
      obscuration: circleOverlapFraction(rSunDeg, rMoonDeg, separationDeg),
    };
  },
};

function resolveOptions(options: EclipseCalculationOptions): ResolvedOptions {
  return {
    refDate: options.refDate ?? new Date(),
    timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    refraction: options.refraction ?? 'normal',
    searchHorizonDays: options.searchHorizonDays ?? DEFAULT_SEARCH_HORIZON_DAYS,
  };
}

function buildView(
  info: LocalSolarEclipseInfo,
  location: ObserverLocation,
  observer: Observer,
  opts: ResolvedOptions,
  allowPast: boolean,
): EclipseView | null {
  const begin = info.partial_begin;
  const peakEvent = info.peak;
  const end = info.partial_end;
  const peak = peakEvent.time;
  const refUt = MakeTime(opts.refDate).ut;
  if ((!allowPast && peak.ut < refUt) || peak.ut - refUt > opts.searchHorizonDays) {
    return null;
  }

  const sun = getTopocentricHorizontal(Body.Sun, peak, observer, opts.refraction);
  const moon = getTopocentricHorizontal(Body.Moon, peak, observer, opts.refraction);
  const rSunDeg = getAngularRadiusDeg(SUN_RADIUS_METERS, sun.distanceAu);
  const rMoonDeg = getAngularRadiusDeg(MOON_RADIUS_METERS, moon.distanceAu);
  const separationDeg = angularSeparationDeg(sun.ra, sun.dec, moon.ra, moon.dec);

  return {
    kind: KIND_MAP[info.kind] ?? 'Partial',
    eclipseDateIso: formatUtcIso(peak).slice(0, 10),
    timezone: opts.timezone,
    daysUntil: Math.max(
      0,
      utcDayNumber(epochMs(peak)) -
        utcDayNumber((refUt * SECONDS_PER_DAY + J2000_UNIX_OFFSET_SECONDS) * 1000),
    ),
    times: {
      begin: toLocalEvent(begin, observer, opts),
      // The peak event's horizontal coords come from the topocentric sun already
      // computed above, so the view's `sunAltitude/AzimuthPeakDeg` and
      // `times.peak` cannot disagree.
      peak: {
        utcIso: formatUtcIso(peak),
        localTime: formatLocalTime(peak, opts.timezone),
        sunAltitudeDeg: sun.altitude,
        sunAzimuthDeg: sun.azimuth,
      },
      end: toLocalEvent(end, observer, opts),
    },
    totalitySeconds:
      info.total_begin !== undefined && info.total_end !== undefined
        ? (info.total_end.time.ut - info.total_begin.time.ut) * SECONDS_PER_DAY
        : null,
    magnitude: magnitudeFromGeometry(rSunDeg, rMoonDeg, separationDeg),
    obscuration: circleOverlapFraction(rSunDeg, rMoonDeg, separationDeg),
    sunAltitudePeakDeg: sun.altitude,
    sunAzimuthPeakDeg: sun.azimuth,
    moonPositionAngleDeg: positionAngleDeg(sun.ra, sun.dec, moon.ra, moon.dec),
    rSunDeg,
    rMoonDeg,
    separationDeg,
    observer: { ...location },
  };
}

function toLocalEvent(
  event: EclipseEvent,
  observer: Observer,
  opts: ResolvedOptions,
): EclipseEventLocal {
  const sun = getTopocentricHorizontal(Body.Sun, event.time, observer, opts.refraction);
  return {
    utcIso: formatUtcIso(event.time),
    localTime: formatLocalTime(event.time, opts.timezone),
    sunAltitudeDeg: sun.altitude,
    sunAzimuthDeg: sun.azimuth,
  };
}

function epochMs(time: AstroTime): number {
  return (time.ut * SECONDS_PER_DAY + J2000_UNIX_OFFSET_SECONDS) * 1000;
}

function utcDayNumber(epochMsValue: number): number {
  return Math.floor(epochMsValue / (SECONDS_PER_DAY * 1000));
}

function formatUtcIso(time: AstroTime): string {
  return new Date(epochMs(time)).toISOString();
}

function formatLocalTime(time: AstroTime, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs(time)));
}
