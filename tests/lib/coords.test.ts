import { describe, expect, it } from 'vitest';

import { parseCoordinate } from '../../src/lib/coords';

describe('parseCoordinate', () => {
  it('parses plain decimals', () => {
    expect(parseCoordinate('40.4168')).toBeCloseTo(40.4168, 6);
    expect(parseCoordinate('-3.7038')).toBeCloseTo(-3.7038, 6);
  });

  it('parses DMS with hemisphere suffix', () => {
    expect(parseCoordinate('40°25\'0"N')).toBeCloseTo(40.4167, 4);
    expect(parseCoordinate('3°42\'14"W')).toBeCloseTo(-3.7039, 4);
    expect(parseCoordinate('40 25 0 N')).toBeCloseTo(40.4167, 4);
  });

  it('parses DMS with degree/minute only', () => {
    expect(parseCoordinate("3°42'W")).toBeCloseTo(-3.7, 4);
  });

  it('parses signed DMS without hemisphere', () => {
    expect(parseCoordinate('-40 25 30')).toBeCloseTo(-40.425, 4);
  });

  it('honours sign + hemisphere without double negation', () => {
    expect(parseCoordinate("-3°42'W")).toBeCloseTo(-3.7, 4);
  });

  it('rejects invalid input', () => {
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('abc')).toBeNull();
    expect(parseCoordinate("10°99'")).toBeNull();
    expect(parseCoordinate('1°2\'3"4"')).toBeNull();
  });
});
