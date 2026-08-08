import { describe, expect, it } from 'vitest';

import {
  angularSeparationDeg,
  circleOverlapFraction,
  magnitudeFromGeometry,
  positionAngleDeg,
} from '../../src/astro/geometry';

describe('angularSeparationDeg', () => {
  it('returns 0 for identical coordinates', () => {
    expect(angularSeparationDeg(5, 20, 5, 20)).toBeCloseTo(0, 6);
  });

  it('returns 90 degrees for RA offset of 6h at the equator', () => {
    expect(angularSeparationDeg(0, 0, 6, 0)).toBeCloseTo(90, 4);
  });

  it('returns 180 degrees for antipodal points', () => {
    expect(angularSeparationDeg(0, 0, 12, 0)).toBeCloseTo(180, 4);
  });
});

describe('positionAngleDeg', () => {
  it('returns 0 when the moon is due north of the sun', () => {
    expect(positionAngleDeg(2, 10, 2, 11)).toBeCloseTo(0, 4);
  });

  it('returns 90 when the moon is due east of the sun at the equator', () => {
    expect(positionAngleDeg(2, 0, 3, 0)).toBeCloseTo(90, 4);
  });

  it('returns 270 when the moon is due west of the sun at the equator', () => {
    expect(positionAngleDeg(2, 0, 1, 0)).toBeCloseTo(270, 4);
  });

  it('accounts for great-circle curvature at higher declinations', () => {
    expect(positionAngleDeg(2, 10, 3, 10)).toBeCloseTo(88.69, 2);
  });

  it('normalizes to [0, 360)', () => {
    const pa = positionAngleDeg(2, 10, 2, 9);
    expect(pa).toBeGreaterThanOrEqual(0);
    expect(pa).toBeLessThan(360);
  });
});

describe('magnitudeFromGeometry', () => {
  it('returns 0 for a grazing contact', () => {
    expect(magnitudeFromGeometry(1, 1, 2)).toBeCloseTo(0, 9);
  });

  it('returns 0.5 when the moon covers half the solar diameter', () => {
    expect(magnitudeFromGeometry(1, 1, 1)).toBeCloseTo(0.5, 9);
  });

  it('exceeds 1 when the moon completely covers the sun', () => {
    expect(magnitudeFromGeometry(1, 1.2, 0)).toBeGreaterThan(1);
  });
});

describe('circleOverlapFraction', () => {
  it('returns 0 for non-overlapping circles', () => {
    expect(circleOverlapFraction(1, 1, 3)).toBe(0);
  });

  it('returns 1 when one circle fully contains the other', () => {
    expect(circleOverlapFraction(1, 2, 0)).toBe(1);
  });

  it('returns the area ratio when the moon is smaller (annular)', () => {
    expect(circleOverlapFraction(2, 1, 0)).toBe(0.25);
  });

  it('returns 1 for a total eclipse (moon larger, centered)', () => {
    expect(circleOverlapFraction(1, 2, 0)).toBe(1);
  });

  it('returns a partial-overlap fraction strictly between 0 and 1', () => {
    const f = circleOverlapFraction(1, 1, 0.5);
    expect(f).toBeGreaterThan(0.5);
    expect(f).toBeLessThan(1);
  });

  it('returns 0.391 for equal unit circles offset by their radius', () => {
    expect(circleOverlapFraction(1, 1, 1)).toBeCloseTo(0.391, 3);
  });
});
