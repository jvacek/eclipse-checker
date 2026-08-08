import { useState } from 'react';

import { EclipseCalculator } from './astro';
import type { EclipseView } from './astro';

interface FormState {
  lat: string;
  lon: string;
  height: string;
  refDate: string;
}

const DEFAULT_FORM: FormState = {
  lat: '40.4168',
  lon: '-3.7038',
  height: '667',
  refDate: '2026-08-11',
};

export default function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [view, setView] = useState<EclipseView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const compute = () => {
    setError(null);
    try {
      const location = {
        lat: Number(form.lat),
        lon: Number(form.lon),
        heightMeters: Number(form.height),
      };
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
        setView(undefined);
        setError('Latitude and longitude must be numbers.');
        return;
      }
      const result = EclipseCalculator.forLocation(location, {
        refDate: new Date(`${form.refDate}T00:00:00Z`),
      });
      setView(result);
    } catch (err) {
      setView(undefined);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="app">
      <h1>Eclipse Checker</h1>
      <p className="subtitle">
        Find the next solar eclipse visible from a location. Phase 0 scaffold — astronomy core only.
      </p>

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          compute();
        }}
      >
        <label>
          Latitude
          <input value={form.lat} onChange={update('lat')} inputMode="decimal" />
        </label>
        <label>
          Longitude
          <input value={form.lon} onChange={update('lon')} inputMode="decimal" />
        </label>
        <label>
          Height (m)
          <input value={form.height} onChange={update('height')} inputMode="decimal" />
        </label>
        <label>
          Search from date
          <input type="date" value={form.refDate} onChange={update('refDate')} />
        </label>
        <button type="submit">Compute</button>
      </form>

      {error !== null && <p className="message error">{error}</p>}
      {view === undefined && error === null && (
        <p className="message">Enter coordinates and press Compute.</p>
      )}
      {view === null && (
        <p className="message">
          No solar eclipse visible from this location within the 10-year search window.
        </p>
      )}
      {view !== null && view !== undefined && <ResultView view={view} />}
    </main>
  );
}

function ResultView({ view }: { view: EclipseView }) {
  return (
    <section className="results">
      <h2>
        {view.kind} eclipse — {view.eclipseDateIso} ({view.timezone})
      </h2>
      <dl>
        <dt>Peak</dt>
        <dd>
          {view.times.peak.localTime} local ({view.daysUntil} day(s) after search start)
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
        <dt>Moon position angle</dt>
        <dd>{view.moonPositionAngleDeg.toFixed(1)}°</dd>
      </dl>
    </section>
  );
}
