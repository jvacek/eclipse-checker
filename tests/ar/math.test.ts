import { describe, expect, it } from 'vitest';

import {
  eclipseDiscGeometry,
  northAlignedAzimuth,
  northAlignYawOffsetDeg,
  normalizeDeg,
  offscreenSunIndicator,
  sunDirectionVector,
} from '../../src/ar/math';

describe('normalizeDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
  });
});

describe('northAlignYawOffsetDeg', () => {
  it('is zero when the camera world already matches the compass', () => {
    expect(northAlignYawOffsetDeg([0, 0, 0, 1], 0)).toBeCloseTo(0, 6);
  });

  it('returns the offset between the compass and the camera world azimuth', () => {
    const offset = northAlignYawOffsetDeg([0, 0, 0, 1], 10);
    expect(offset).toBeCloseTo(10, 6);
  });

  it('wraps around 360', () => {
    expect(northAlignYawOffsetDeg([0, 0, 0, 1], 350)).toBeCloseTo(350, 6);
  });
});

describe('northAlignedAzimuth', () => {
  it('subtracts the captured yaw offset', () => {
    expect(northAlignedAzimuth(180, 90)).toBe(90);
    expect(northAlignedAzimuth(0, 90)).toBe(270);
    expect(northAlignedAzimuth(90, 0)).toBe(90);
  });
});

describe('sunDirectionVector', () => {
  it('points north (-z) for azimuth 0 at the horizon', () => {
    const v = sunDirectionVector(0, 0);
    expect(v.z).toBeCloseTo(-1, 6);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  it('points east (+x) for azimuth 90', () => {
    const v = sunDirectionVector(90, 0);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('raises with altitude and keeps unit magnitude', () => {
    const v = sunDirectionVector(45, 30);
    const magnitude = Math.hypot(v.x, v.y, v.z);
    expect(magnitude).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0.5, 6);
  });
});

describe('eclipseDiscGeometry', () => {
  it('centers the moon fully over the sun for a total eclipse', () => {
    const g = eclipseDiscGeometry(0.26, 0.28, 0.001, 0);
    expect(g.moonOffsetX).toBeCloseTo(0, 4);
    expect(g.moonOffsetY).toBeLessThan(0.01);
    expect(g.moonRadius).toBeGreaterThan(1);
  });

  it('offsets the moon along the position angle', () => {
    const g = eclipseDiscGeometry(0.26, 0.27, 0.13, 90);
    expect(g.moonOffsetX).toBeCloseTo(0.5, 4);
    expect(g.moonOffsetY).toBeCloseTo(0, 4);
  });

  it('returns zero geometry for a degenerate sun radius', () => {
    expect(eclipseDiscGeometry(0, 0.27, 0.13, 90)).toEqual({
      moonOffsetX: 0,
      moonOffsetY: 0,
      moonRadius: 0,
    });
  });
});

describe('offscreenSunIndicator', () => {
  const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
  const FOV = 60;
  const ASPECT = 1;
  const MARGIN = 0.12;

  it('returns null when the sun is within the viewport', () => {
    const result = offscreenSunIndicator(IDENTITY, sunDirectionVector(10, 5), FOV, ASPECT, MARGIN);
    expect(result).toBeNull();
  });

  it('points right at the right margin for a sun to the east', () => {
    const result = offscreenSunIndicator(
      IDENTITY,
      sunDirectionVector(90, 0),
      FOV,
      ASPECT,
      MARGIN,
    )!;
    expect(result.x).toBeCloseTo(1 - MARGIN, 4);
    expect(result.angleDeg).toBeCloseTo(90, 4);
  });

  it('points up at the top margin for a sun overhead', () => {
    const result = offscreenSunIndicator(
      IDENTITY,
      sunDirectionVector(0, 60),
      FOV,
      ASPECT,
      MARGIN,
    )!;
    expect(result.y).toBeCloseTo(MARGIN, 4);
    expect(result.angleDeg).toBeCloseTo(0, 4);
  });

  it('points down-left for a sun behind and to the left', () => {
    const result = offscreenSunIndicator(
      IDENTITY,
      sunDirectionVector(225, 0),
      FOV,
      ASPECT,
      MARGIN,
    )!;
    expect(result.x).toBeLessThan(0.5);
    expect(result.angleDeg).toBeCloseTo(-90, 4);
  });

  it('points straight down for a sun directly behind', () => {
    const result = offscreenSunIndicator(
      IDENTITY,
      sunDirectionVector(180, 0),
      FOV,
      ASPECT,
      MARGIN,
    )!;
    expect(result.y).toBeCloseTo(1 - MARGIN, 4);
    expect(result.angleDeg).toBeCloseTo(180, 4);
  });

  it('clamps every result inside [margin, 1-margin] on both axes', () => {
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const alt of [0, 30, 60]) {
        const result = offscreenSunIndicator(
          IDENTITY,
          sunDirectionVector(az, alt),
          FOV,
          ASPECT,
          MARGIN,
        );
        if (result === null) {
          continue;
        }
        expect(result.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
        expect(result.x).toBeLessThanOrEqual(1 - MARGIN + 1e-6);
        expect(result.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);
        expect(result.y).toBeLessThanOrEqual(1 - MARGIN + 1e-6);
      }
    }
  });
});
