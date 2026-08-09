interface LandingProps {
  locating: boolean;
  onLocate: () => void;
  onManual: () => void;
}

export function Landing({ locating, onLocate, onManual }: LandingProps) {
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
    </section>
  );
}
