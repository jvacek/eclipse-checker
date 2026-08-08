import type { EclipseView } from '../astro';

export type VerdictTier = 'below-horizon' | 'excellent' | 'low' | 'partial-clear' | 'grazing';

export interface Verdict {
  tier: VerdictTier;
  text: string;
}

/** Suns at or above this altitude at peak are treated as an unobstructed view. */
const HIGH_ALTITUDE_DEG = 15;
/** Partial eclipses at/above this magnitude show a clear darkening. */
const CLEAR_PARTIAL_MAGNITUDE = 0.5;

/**
 * Human-friendly viewing verdict, tiered by the eclipse kind and the Sun's
 * altitude/magnitude at peak. Pure and unit-testable; `Results` renders the
 * text and can style by `tier`.
 */
export function verdictFor(
  view: Pick<EclipseView, 'kind' | 'sunAltitudePeakDeg' | 'magnitude'>,
): Verdict {
  if (view.sunAltitudePeakDeg <= 0) {
    return {
      tier: 'below-horizon',
      text: 'The Sun will be below the horizon at peak — the eclipse will not be visible.',
    };
  }
  if (view.kind !== 'Partial') {
    return view.sunAltitudePeakDeg >= HIGH_ALTITUDE_DEG
      ? { tier: 'excellent', text: 'Excellent view — the Sun is high above the horizon at peak.' }
      : { tier: 'low', text: 'Near the horizon at peak — find an unobstructed view.' };
  }
  return view.magnitude >= CLEAR_PARTIAL_MAGNITUDE
    ? { tier: 'partial-clear', text: 'Clearly visible darkening of the Sun.' }
    : { tier: 'grazing', text: 'Grazing eclipse — the Sun barely darkens.' };
}
