import { describe, expect, it } from 'vitest';

import type { EclipseView } from '../../src/astro';
import { verdictFor } from '../../src/lib/verdict';

function view(partial: Partial<Pick<EclipseView, 'kind' | 'sunAltitudePeakDeg' | 'magnitude'>>) {
  return {
    kind: 'Total' as const,
    sunAltitudePeakDeg: 40,
    magnitude: 1,
    ...partial,
  };
}

describe('verdictFor', () => {
  it('flags a below-horizon eclipse as not visible regardless of kind', () => {
    expect(verdictFor(view({ kind: 'Total', sunAltitudePeakDeg: -2 }))).toEqual({
      tier: 'below-horizon',
      text: expect.stringContaining('below the horizon'),
    });
  });

  it('calls a high-altitude total an excellent view', () => {
    expect(verdictFor(view({ kind: 'Total', sunAltitudePeakDeg: 40 }))).toMatchObject({
      tier: 'excellent',
    });
  });

  it('calls a low total near-the-horizon', () => {
    expect(verdictFor(view({ kind: 'Total', sunAltitudePeakDeg: 5 }))).toMatchObject({
      tier: 'low',
      text: expect.stringContaining('unobstructed view'),
    });
  });

  it('treats an annular eclipse with the total/annular tiers', () => {
    expect(verdictFor(view({ kind: 'Annular', sunAltitudePeakDeg: 60 }))).toMatchObject({
      tier: 'excellent',
    });
    expect(verdictFor(view({ kind: 'Annular', sunAltitudePeakDeg: 4 }))).toMatchObject({
      tier: 'low',
    });
  });

  it('reports clearly visible darkening for a strong partial', () => {
    expect(
      verdictFor(view({ kind: 'Partial', sunAltitudePeakDeg: 30, magnitude: 0.8 })),
    ).toMatchObject({ tier: 'partial-clear' });
  });

  it('reports grazing for a weak partial', () => {
    expect(
      verdictFor(view({ kind: 'Partial', sunAltitudePeakDeg: 30, magnitude: 0.2 })),
    ).toMatchObject({ tier: 'grazing' });
  });
});
