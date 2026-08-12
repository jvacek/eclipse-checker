import type { UpcomingEclipse } from '../astro';
import { formatLatLon } from '../lib/coords';

interface LandingProps {
  locating: boolean;
  upcoming: UpcomingEclipse[];
  onLocate: () => void;
  onManual: () => void;
}

const ECLIPSE_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatEclipseDate(isoDate: string): string {
  return ECLIPSE_DATE_FORMATTER.format(new Date(`${isoDate}T00:00:00Z`));
}

export function Landing({ locating, upcoming, onLocate, onManual }: LandingProps) {
  return (
    <section className="landing">
      <div className="landing-hero" aria-hidden="true">
        <div className="eclipse-art">
          <div className="sun" />
          <div className="moon" />
        </div>
      </div>
      <p className="landing-lead">
        Check whether you'll get a clear view of the next solar eclipse from where you are — the
        exact peak time, how much of the Sun is obscured, and whether it's above the horizon.
      </p>
      <div className="landing-actions">
        <button type="button" className="locate" onClick={onLocate} disabled={locating}>
          {locating ? 'Locating…' : 'Find my location'}
        </button>
        <button type="button" className="secondary" onClick={onManual} disabled={locating}>
          Enter coordinates manually
        </button>
      </div>

      <section className="upcoming">
        <h2 className="upcoming-title">Upcoming solar eclipses</h2>
        <p className="upcoming-note">
          The next eclipses visible anywhere on Earth — use the buttons above to see them from your
          location.
        </p>
        <ul className="upcoming-list">
          {upcoming.map((eclipse) => (
            <li key={eclipse.date} className="upcoming-item">
              <span className="upcoming-kind" data-kind={eclipse.kind.toLowerCase()}>
                {eclipse.kind}
              </span>
              <span className="upcoming-date">{formatEclipseDate(eclipse.date)}</span>
              {eclipse.latitude !== undefined && eclipse.longitude !== undefined && (
                <span className="upcoming-place">
                  greatest eclipse {formatLatLon(eclipse.latitude, eclipse.longitude)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
