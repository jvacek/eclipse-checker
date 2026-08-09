import { useState } from 'react';

import { parseCoordinate } from '../lib/coords';

interface ManualFormProps {
  notice?: string;
  onBack?: () => void;
  onSubmit: (location: { lat: number; lon: number; heightMeters: number }) => void;
}

const DEFAULT_LAT = '';
const DEFAULT_LON = '';
const DEFAULT_HEIGHT = '';

export function ManualForm({ notice, onBack, onSubmit }: ManualFormProps) {
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lon, setLon] = useState(DEFAULT_LON);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const latValue = parseCoordinate(lat);
    const lonValue = parseCoordinate(lon);
    if (latValue === null || Math.abs(latValue) > 90) {
      setError('Latitude must be a decimal or DMS value between -90 and 90.');
      return;
    }
    if (lonValue === null || Math.abs(lonValue) > 180) {
      setError('Longitude must be a decimal or DMS value between -180 and 180.');
      return;
    }
    const heightMeters = Number(height);
    if (!Number.isFinite(heightMeters) || heightMeters < 0) {
      setError('Height must be a non-negative number of metres.');
      return;
    }
    setError(null);
    onSubmit({ lat: latValue, lon: lonValue, heightMeters });
  };

  return (
    <>
      {onBack !== undefined && (
        <button type="button" className="link back" onClick={onBack}>
          ← Back
        </button>
      )}
      <form className="form" onSubmit={submit}>
      {notice !== undefined && <p className="form-notice">{notice}</p>}
      <label>
        Latitude (decimal or DMS, e.g. 40.4168 or 40°25'S)
        <input
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          placeholder="e.g. 40.4168 or 40°25'S"
          inputMode="decimal"
        />
      </label>
      <label>
        Longitude (decimal or DMS)
        <input
          value={lon}
          onChange={(event) => setLon(event.target.value)}
          placeholder="e.g. -3.7038 or 3°42'W"
          inputMode="decimal"
        />
      </label>
      <label>
        Height (m)
        <input
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          placeholder="0"
          inputMode="decimal"
        />
      </label>
      {error !== null && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      <button type="submit">Show eclipse</button>
    </form>
    </>
  );
}
