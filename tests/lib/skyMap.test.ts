import { describe, expect, it } from 'vitest';

import { skyMapPoint } from '../../src/lib/skyMap';

describe('skyMapPoint', () => {
  it('puts the zenith at the center', () => {
    expect(skyMapPoint(0, 90)).toEqual({ xFrac: 0.5, yFrac: 0.5 });
  });

  it('puts north at the top edge and east at the right edge', () => {
    const north = skyMapPoint(0, 0);
    expect(north.xFrac).toBeCloseTo(0.5, 6);
    expect(north.yFrac).toBeCloseTo(0, 6);

    const east = skyMapPoint(90, 0);
    expect(east.xFrac).toBeCloseTo(1, 6);
    expect(east.yFrac).toBeCloseTo(0.5, 6);
  });

  it('places a mid-altitude object inside the horizon ring', () => {
    const p = skyMapPoint(0, 30);
    expect(p.yFrac).toBeCloseTo(0.5 - 1 / 3, 6);
    expect(p.xFrac).toBeCloseTo(0.5, 6);
  });

  it('clamps below-horizon and above-zenith altitudes', () => {
    const below = skyMapPoint(0, -10);
    expect(below.yFrac).toBeCloseTo(0, 6);

    const above = skyMapPoint(0, 120);
    expect(above).toEqual({ xFrac: 0.5, yFrac: 0.5 });
  });
});
