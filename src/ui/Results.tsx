import type { EclipseView } from '../astro';
import { verdictFor } from '../lib/verdict';

interface ResultsProps {
  view: EclipseView;
  passed?: boolean;
  shareUrl: string;
  locationAccuracyMeters: number | null;
  onRestart: () => void;
  onViewAr?: () => void;
}

export function Results({
  view,
  passed = false,
  shareUrl,
  locationAccuracyMeters,
  onRestart,
  onViewAr,
}: ResultsProps) {
  const verdict = verdictFor(view);

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${view.kind} eclipse ${view.eclipseDateIso}`,
          url: shareUrl,
        });
        return;
      } catch {
        // user cancelled or share failed → fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(shareUrl);
  };

  return (
    <section className="results" data-kind={view.kind.toLowerCase()}>
      <div className="results-head">
        <h2>
          {view.kind} eclipse — {view.eclipseDateIso} ({view.timezone})
        </h2>
        <button
          type="button"
          className="restart"
          onClick={onRestart}
          aria-label="Start over"
          title="Start over"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="currentColor" />
          </svg>
        </button>
      </div>

      {passed && (
        <p className="passed-notice" role="status">
          This eclipse has already passed.
        </p>
      )}

      <p className="results-verdict" data-tier={verdict.tier} role="status">
        {verdict.text}
      </p>

      <dl className="results-dl">
        <dt>Peak</dt>
        <dd>
          {view.times.peak.localTime} local
          {passed
            ? ''
            : view.daysUntil > 0
              ? ` · in ${view.daysUntil} day${view.daysUntil === 1 ? '' : 's'}`
              : ' · today'}
        </dd>
        <dt>Begin / End</dt>
        <dd>
          {view.times.begin.localTime} – {view.times.end.localTime}
        </dd>
        <dt>Magnitude</dt>
        <dd>{view.magnitude.toFixed(4)} of solar diameter</dd>
        <dt>Obscuration</dt>
        <dd>{Math.round(view.obscuration * 1000) / 10}% of solar area</dd>
        {view.totalitySeconds !== null && (
          <>
            <dt>Totality</dt>
            <dd>{Math.round(view.totalitySeconds)} s</dd>
          </>
        )}
        <dt>Sun at peak</dt>
        <dd>
          altitude {view.sunAltitudePeakDeg.toFixed(1)}°, azimuth{' '}
          {view.sunAzimuthPeakDeg.toFixed(1)}°
        </dd>
      </dl>

      {locationAccuracyMeters !== null && (
        <p className="location-note">Location accuracy ±{Math.round(locationAccuracyMeters)} m</p>
      )}

      <div className="results-actions">
        {onViewAr !== undefined && (
          <button type="button" className="ar-primary" onClick={onViewAr}>
            View in AR
          </button>
        )}

        <button
          type="button"
          className="share"
          aria-label="Share this eclipse"
          title="Share this eclipse"
          onClick={() => void share()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M18 16.1c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91 1.2L8.04 10.3A2.98 2.98 0 0 0 3 12a3 3 0 0 0 5.04 2.11l7.12 4.16A2.98 2.98 0 0 0 18 21a3 3 0 1 0 0-4.9z"
              fill="currentColor"
            />
          </svg>
          <span>Share</span>
        </button>
      </div>
    </section>
  );
}
