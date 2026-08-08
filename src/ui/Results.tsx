import type { EclipseView } from '../astro';

interface ResultsProps {
  view: EclipseView;
  shareUrl: string;
  locationAccuracyMeters: number | null;
  onRestart: () => void;
  onViewAr?: () => void;
}

export function Results({
  view,
  shareUrl,
  locationAccuracyMeters,
  onRestart,
  onViewAr,
}: ResultsProps) {
  const visibility =
    view.sunAltitudePeakDeg > 0
      ? 'The Sun will be above the horizon at peak.'
      : 'The Sun will be below the horizon at peak — the eclipse will not be visible.';

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
        <button type="button" className="link" onClick={onRestart}>
          Start over
        </button>
      </div>

      <dl className="results-dl">
        <dt>Peak</dt>
        <dd>
          {view.times.peak.localTime} local
          {view.daysUntil > 0
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
        <dt>Verdict</dt>
        <dd>{visibility}</dd>
      </dl>

      {locationAccuracyMeters !== null && (
        <p className="location-note">Location accuracy ±{Math.round(locationAccuracyMeters)} m</p>
      )}

      <button type="button" className="primary" onClick={() => void share()}>
        Share
      </button>

      {onViewAr !== undefined && (
        <button type="button" className="secondary" onClick={onViewAr}>
          View in AR
        </button>
      )}
    </section>
  );
}
