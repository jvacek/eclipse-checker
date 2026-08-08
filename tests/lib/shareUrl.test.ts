import { describe, expect, it } from 'vitest';

import { buildShareUrl, parseShareParams } from '../../src/lib/shareUrl';

describe('parseShareParams', () => {
  it('returns null without lat/lon', () => {
    expect(parseShareParams('')).toBeNull();
    expect(parseShareParams('?lon=-3.7')).toBeNull();
    expect(parseShareParams('?lat=abc&lon=-3.7')).toBeNull();
  });

  it('parses lat/lon and defaults height', () => {
    expect(parseShareParams('?lat=40.4168&lon=-3.7038')).toEqual({
      lat: 40.4168,
      lon: -3.7038,
      heightMeters: 0,
    });
  });

  it('parses height, eclipseDate and kind', () => {
    const params = parseShareParams(
      '?lat=64.1466&lon=-21.9426&height=61&eclipseDate=2026-08-12&kind=Total',
    );
    expect(params).toEqual({
      lat: 64.1466,
      lon: -21.9426,
      heightMeters: 61,
      eclipseDate: '2026-08-12',
      kind: 'Total',
    });
  });
});

describe('buildShareUrl', () => {
  it('round-trips through parseShareParams', () => {
    const url = buildShareUrl('https://example.com/', {
      lat: 40.4168,
      lon: -3.7038,
      heightMeters: 667,
      eclipseDate: '2026-08-12',
      kind: 'Partial',
    });
    expect(parseShareParams(new URL(url).search)).toEqual({
      lat: 40.4168,
      lon: -3.7038,
      heightMeters: 667,
      eclipseDate: '2026-08-12',
      kind: 'Partial',
    });
  });

  it('preserves existing query params', () => {
    const url = buildShareUrl('https://example.com/app?utm=1', {
      lat: 1,
      lon: 2,
      heightMeters: 0,
    });
    expect(url).toContain('utm=1');
    expect(parseShareParams(new URL(url).search)).toEqual({ lat: 1, lon: 2, heightMeters: 0 });
  });
});
