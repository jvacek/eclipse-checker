import { COMPASS_ACCURACY_LIMIT_DEG } from '../ar/arController';

/**
 * Live magnetometer calibration readout: shows the current `webkitCompassAccuracy`
 * and how close it is to the trusted `COMPASS_ACCURACY_LIMIT_DEG` threshold.
 * The bar fills toward the target line; it turns green once accuracy is trusted.
 */
export function AccuracyGauge({ accuracyDeg }: { accuracyDeg: number }) {
  const trusted = accuracyDeg <= COMPASS_ACCURACY_LIMIT_DEG;
  // Scale: 0–60° fills the bar; the 15° target line sits at 25%.
  const maxShownDeg = 60;
  const pct = Math.min(Math.max(accuracyDeg / maxShownDeg, 0), 1) * 100;
  const targetPct = (COMPASS_ACCURACY_LIMIT_DEG / maxShownDeg) * 100;
  return (
    <div className="ar-accuracy" data-trusted={trusted}>
      <div className="ar-accuracy-label">
        <span>
          Accuracy <strong>{accuracyDeg.toFixed(1)}°</strong>
        </span>
        <span className={trusted ? 'ar-accuracy-status-ok' : ''}>
          {trusted ? 'good ✓' : `target ≤ ${COMPASS_ACCURACY_LIMIT_DEG}°`}
        </span>
      </div>
      <div className="ar-accuracy-track">
        <span className="ar-accuracy-fill" style={{ width: `${pct}%` }} />
        <span className="ar-accuracy-target" style={{ left: `${targetPct}%` }} />
      </div>
    </div>
  );
}

export const COMPASS_CALIBRATION_HINT =
  'Move the phone in a figure-8 (∞) motion for a few seconds to calibrate the magnetometer — accuracy improves as you do this. Keep away from magnetic phone cases, mounts, and metal.';
