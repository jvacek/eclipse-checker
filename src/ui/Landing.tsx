interface LandingProps {
  locating: boolean;
  onLocate: () => void;
  onManual: () => void;
}

export function Landing({ locating, onLocate, onManual }: LandingProps) {
  return (
    <section className="landing">
      <p className="landing-lead">
        Point your phone at the sky to see where the next solar eclipse will be — computed locally
        from the ephemeris for your exact position.
      </p>
      <div className="landing-actions">
        <button type="button" className="primary" onClick={onLocate} disabled={locating}>
          {locating ? 'Locating…' : 'Find my location'}
        </button>
        <button type="button" className="secondary" onClick={onManual} disabled={locating}>
          Enter coordinates manually
        </button>
      </div>
    </section>
  );
}
