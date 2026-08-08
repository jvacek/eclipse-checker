import { SearchLocalSolarEclipse, Observer } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';

import { EclipseCalculator } from '../../src/astro/eclipse';
import type { ObserverLocation } from '../../src/astro/types';
import fixture from '../fixtures/2026-08-12-nasa.json';

const REF_DATE = new Date('2026-08-11T00:00:00Z');

interface FixtureLocation {
  name: string;
  lat: number;
  lon: number;
  height: number;
  timezone: string;
  partialEndToleranceMin?: number;
  expected: {
    kind: string;
    partialBeginLocal: string;
    peakLocal: string;
    partialEndLocal: string;
    totalityDurationMin?: number;
    magnitude: number | null;
    obscuration: number | null;
    sunAltitudePeakDeg: number | null;
  } | null;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function timeDiffMinutes(a: string, b: string): number {
  return Math.abs(toMinutes(a) - toMinutes(b));
}

function toLocation(location: FixtureLocation): ObserverLocation {
  return { lat: location.lat, lon: location.lon, heightMeters: location.height };
}

function toObserver(location: FixtureLocation): Observer {
  return new Observer(location.lat, location.lon, location.height);
}

describe('EclipseCalculator.forEclipseDate — 2026-08-12 fixture', () => {
  for (const location of fixture.locations as FixtureLocation[]) {
    if (location.expected === null) {
      it(`${location.name}: eclipse not visible → null`, () => {
        const view = EclipseCalculator.forEclipseDate(fixture.eclipseDate, toLocation(location), {
          refDate: REF_DATE,
          timezone: location.timezone,
        });
        expect(view).toBeNull();
      });
      continue;
    }

    const expected = location.expected;
    const endToleranceMin = location.partialEndToleranceMin ?? 5;

    it(`${location.name}: kind, times, magnitude, obscuration, altitude`, () => {
      const view = EclipseCalculator.forEclipseDate(fixture.eclipseDate, toLocation(location), {
        refDate: REF_DATE,
        timezone: location.timezone,
      });
      expect(view).not.toBeNull();
      if (view === null) return;

      expect(view.kind).toBe(expected.kind);
      expect(view.eclipseDateIso).toBe(fixture.eclipseDate);
      expect(view.timezone).toBe(location.timezone);
      expect(view.daysUntil).toBe(1);

      expect(timeDiffMinutes(view.times.peak.localTime, expected.peakLocal)).toBeLessThanOrEqual(
        fixture.tolerances.peakTimeMin,
      );
      expect(
        timeDiffMinutes(view.times.begin.localTime, expected.partialBeginLocal),
      ).toBeLessThanOrEqual(5);
      expect(
        timeDiffMinutes(view.times.end.localTime, expected.partialEndLocal),
      ).toBeLessThanOrEqual(endToleranceMin);

      if (expected.magnitude !== null) {
        expect(Math.abs(view.magnitude - expected.magnitude)).toBeLessThanOrEqual(
          fixture.tolerances.magnitude,
        );
      }
      if (expected.obscuration !== null) {
        expect(Math.abs(view.obscuration - expected.obscuration)).toBeLessThanOrEqual(
          fixture.tolerances.obscuration,
        );
      }
      if (expected.sunAltitudePeakDeg !== null) {
        expect(Math.abs(view.sunAltitudePeakDeg - expected.sunAltitudePeakDeg)).toBeLessThanOrEqual(
          fixture.tolerances.sunAltitudeDeg,
        );
      }
      if (expected.totalityDurationMin !== undefined) {
        expect(view.totalitySeconds).not.toBeNull();
        if (view.totalitySeconds !== null) {
          expect(
            Math.abs(view.totalitySeconds - expected.totalityDurationMin * 60),
          ).toBeLessThanOrEqual(30);
        }
      }
    });

    it(`${location.name}: our obscuration agrees with astronomy-engine's value`, () => {
      const observer = toObserver(location);
      const info = SearchLocalSolarEclipse(REF_DATE, observer);
      const view = EclipseCalculator.forEclipseDate(fixture.eclipseDate, toLocation(location), {
        refDate: REF_DATE,
        timezone: location.timezone,
      });
      expect(view).not.toBeNull();
      if (view === null) return;
      expect(Math.abs(view.obscuration - info.obscuration)).toBeLessThan(0.005);
    });
  }
});

describe('EclipseCalculator.forLocation', () => {
  it('finds the 2026-08-12 eclipse for Madrid', () => {
    const madrid = (fixture.locations as FixtureLocation[]).find((l) => l.name === 'Madrid')!;
    const view = EclipseCalculator.forLocation(toLocation(madrid), {
      refDate: REF_DATE,
      timezone: madrid.timezone,
    });
    expect(view?.eclipseDateIso).toBe('2026-08-12');
  });

  it('returns the next eclipse within the horizon for a location that misses 2026-08-12 (Sydney → 2028-07-22 total)', () => {
    const sydney = (fixture.locations as FixtureLocation[]).find((l) =>
      l.name.startsWith('Sydney'),
    )!;
    const view = EclipseCalculator.forLocation(toLocation(sydney), {
      refDate: REF_DATE,
      timezone: sydney.timezone,
    });
    expect(view).not.toBeNull();
    expect(view?.kind).toBe('Total');
    expect(view?.eclipseDateIso).toBe('2028-07-22');
  });

  it('returns null when no eclipse is found within the search horizon', () => {
    const view = EclipseCalculator.forLocation(
      { lat: -33.8688, lon: 151.2093, heightMeters: 58 },
      { refDate: REF_DATE, searchHorizonDays: 1 },
    );
    expect(view).toBeNull();
  });
});
