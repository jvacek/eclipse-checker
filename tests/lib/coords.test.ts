import { describe, expect, it } from 'vitest';

import { formatLatLon, parseCoordinate } from '../../src/lib/coords';

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

describe('formatLatLon', () => {
  it('formats decimal degrees with hemisphere suffixes', () => {
    expect(formatLatLon(65.2, -25.2)).toBe('65.2°N, 25.2°W');
    expect(formatLatLon(-31.3, -48.5)).toBe('31.3°S, 48.5°W');
    expect(formatLatLon(3.0, -51.5)).toBe('3.0°N, 51.5°W');
    expect(formatLatLon(-15.6, 126.7)).toBe('15.6°S, 126.7°E');
  });

  it('supports a custom precision', () => {
    expect(formatLatLon(40.4168, -3.7038, 2)).toBe('40.42°N, 3.70°W');
  });

  it('never renders a negative zero', () => {
    expect(formatLatLon(-0, 0)).toBe('0.0°N, 0.0°E');
  });
});
