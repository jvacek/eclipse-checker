import { SearchLocalSolarEclipse, Observer } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';

import { EclipseCalculator } from '../../src/astro/eclipse';
import type { ObserverLocation } from '../../src/astro/types';
import fixture from '../fixtures/2026-08-12-nasa.json';
import annularFixture from '../fixtures/2027-02-06-annular.json';
import upcomingFixture from '../fixtures/upcoming-eclipses.json';

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

function toLocation(location: { lat: number; lon: number; height: number }): ObserverLocation {
  return { lat: location.lat, lon: location.lon, heightMeters: location.height };
}

function toObserver(location: { lat: number; lon: number; height: number }): Observer {
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

describe('EclipseCalculator.forEclipseDate — past pinned date', () => {
  it('returns a non-null view even when the eclipse is already past', () => {
    const madrid = (fixture.locations as FixtureLocation[]).find((l) => l.name === 'Madrid')!;
    const view = EclipseCalculator.forEclipseDate('2026-08-12', toLocation(madrid), {
      refDate: new Date('2026-08-15T00:00:00Z'),
      timezone: madrid.timezone,
    });
    expect(view).not.toBeNull();
    expect(view?.eclipseDateIso).toBe('2026-08-12');
  });

  it('still rejects when the pinned date misses the found eclipse', () => {
    const madrid = (fixture.locations as FixtureLocation[]).find((l) => l.name === 'Madrid')!;
    const view = EclipseCalculator.forEclipseDate('2026-08-20', toLocation(madrid), {
      refDate: new Date('2026-08-15T00:00:00Z'),
      timezone: madrid.timezone,
    });
    expect(view).toBeNull();
  });

  it('returns null for a malformed date', () => {
    const madrid = (fixture.locations as FixtureLocation[]).find((l) => l.name === 'Madrid')!;
    expect(
      EclipseCalculator.forEclipseDate('notadate', toLocation(madrid), {
        refDate: new Date('2026-08-15T00:00:00Z'),
      }),
    ).toBeNull();
    expect(
      EclipseCalculator.forEclipseDate('2026-02-30', toLocation(madrid), {
        refDate: new Date('2026-08-15T00:00:00Z'),
      }),
    ).toBeNull();
  });
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

interface AnnularFixtureLocation {
  name: string;
  lat: number;
  lon: number;
  height: number;
  timezone: string;
  expected: {
    kind: string;
    peakUtcIso: string;
    magnitude: number;
    obscuration: number;
  };
}

describe('EclipseCalculator.forEclipseDate — 2027-02-06 annular fixture', () => {
  const location = (annularFixture.locations as AnnularFixtureLocation[])[0];
  const expected = location.expected;
  const REF = new Date('2027-02-05T00:00:00Z');

  it('reports kind/times/magnitude/obscuration for the annular path', () => {
    const view = EclipseCalculator.forEclipseDate(
      annularFixture.eclipseDate,
      toLocation(location),
      {
        refDate: REF,
        timezone: location.timezone,
      },
    );
    expect(view).not.toBeNull();
    if (view === null) return;

    expect(view.kind).toBe('Annular');
    expect(view.eclipseDateIso).toBe(annularFixture.eclipseDate);
    const peakMs = new Date(view.times.peak.utcIso).getTime();
    const expectedMs = new Date(expected.peakUtcIso).getTime();
    expect(Math.abs(peakMs - expectedMs) / 60000).toBeLessThanOrEqual(
      annularFixture.tolerances.peakTimeMin,
    );
    expect(Math.abs(view.magnitude - expected.magnitude)).toBeLessThanOrEqual(
      annularFixture.tolerances.magnitude,
    );
    expect(Math.abs(view.obscuration - expected.obscuration)).toBeLessThanOrEqual(
      annularFixture.tolerances.obscuration,
    );
  });

  it('agrees with astronomy-engine obscuration within 0.005', () => {
    const observer = toObserver(location);
    const info = SearchLocalSolarEclipse(REF, observer);
    const view = EclipseCalculator.forEclipseDate(
      annularFixture.eclipseDate,
      toLocation(location),
      {
        refDate: REF,
        timezone: location.timezone,
      },
    );
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(Math.abs(view.obscuration - info.obscuration)).toBeLessThan(0.005);
  });

  it('does NOT report full obscuration for an annular eclipse (regression guard)', () => {
    const view = EclipseCalculator.forEclipseDate(
      annularFixture.eclipseDate,
      toLocation(location),
      {
        refDate: REF,
        timezone: location.timezone,
      },
    );
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.obscuration).toBeLessThan(1);
  });
});

describe('EclipseCalculator.upcomingEclipses', () => {
  it('matches the NASA decade table for dates and kinds', () => {
    const upcoming = EclipseCalculator.upcomingEclipses({
      refDate: new Date(upcomingFixture.referenceDate),
      count: upcomingFixture.eclipses.length,
    });
    expect(upcoming.map((e) => ({ date: e.date, kind: e.kind }))).toEqual(
      upcomingFixture.eclipses.map(({ date, kind }) => ({ date, kind })),
    );
  });

  it('reports greatest-eclipse coordinates and obscuration for total/annular only', () => {
    const upcoming = EclipseCalculator.upcomingEclipses({
      refDate: new Date(upcomingFixture.referenceDate),
      count: upcomingFixture.eclipses.length,
    });
    for (let i = 0; i < upcoming.length; i += 1) {
      const ours = upcoming[i];
      const expected = upcomingFixture.eclipses[i];
      if (expected.latitude !== undefined && expected.longitude !== undefined) {
        expect(Math.abs(ours.latitude! - expected.latitude)).toBeLessThanOrEqual(
          upcomingFixture.tolerances.coordinateDeg,
        );
        expect(Math.abs(ours.longitude! - expected.longitude)).toBeLessThanOrEqual(
          upcomingFixture.tolerances.coordinateDeg,
        );
        expect(ours.obscuration).not.toBeUndefined();
        expect(Math.abs(ours.obscuration! - expected.obscuration!)).toBeLessThanOrEqual(
          upcomingFixture.tolerances.obscuration,
        );
      } else {
        expect(ours.latitude).toBeUndefined();
        expect(ours.longitude).toBeUndefined();
        expect(ours.obscuration).toBeUndefined();
      }
    }
  });

  it('skips an eclipse whose peak has already passed and honours count', () => {
    const ref = new Date('2026-08-12T23:00:00Z'); // after the 2026-08-12 peak
    const upcoming = EclipseCalculator.upcomingEclipses({ refDate: ref, count: 2 });
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].date).toBe('2027-02-06');
    expect(upcoming[0].kind).toBe('Annular');
    expect(upcoming[1].date).toBe('2027-08-02');
  });

  it('returns an empty list for a zero count', () => {
    const upcoming = EclipseCalculator.upcomingEclipses({
      refDate: REF_DATE,
      count: 0,
    });
    expect(upcoming).toEqual([]);
  });
});

describe('EclipseCalculator.sampleAt', () => {
  it('matches the view fields when sampled at peak', () => {
    const madrid = (fixture.locations as FixtureLocation[]).find((l) => l.name === 'Madrid')!;
    const view = EclipseCalculator.forEclipseDate(fixture.eclipseDate, toLocation(madrid), {
      refDate: REF_DATE,
      timezone: madrid.timezone,
    });
    expect(view).not.toBeNull();
    if (view === null) return;

    const sample = EclipseCalculator.sampleAt(
      new Date(view.times.peak.utcIso),
      toLocation(madrid),
      { refDate: REF_DATE, timezone: madrid.timezone },
    );

    expect(Math.abs(sample.sunAltitudeDeg - view.sunAltitudePeakDeg)).toBeLessThanOrEqual(
      fixture.tolerances.sunAltitudeDeg,
    );
    expect(Math.abs(sample.sunAzimuthDeg - view.sunAzimuthPeakDeg)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sample.magnitude - view.magnitude)).toBeLessThanOrEqual(
      fixture.tolerances.magnitude,
    );
    expect(Math.abs(sample.obscuration - view.obscuration)).toBeLessThanOrEqual(
      fixture.tolerances.obscuration,
    );
    expect(Math.abs(sample.positionAngleDeg - view.moonPositionAngleDeg)).toBeLessThanOrEqual(0.5);
  });
});
