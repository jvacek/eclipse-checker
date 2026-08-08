import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

import { EclipseCalculator } from './astro';
import type { EclipseView, ObserverLocation } from './astro';
import { useHeading } from './hooks/useHeading';
import { usePermission } from './hooks/usePermission';
import { buildShareUrl, parseShareParams } from './lib/shareUrl';
import {
  createGeolocationRequestor,
  requestDeviceOrientationPermission,
  type GeolocationData,
} from './sensors';
import { ARView } from './ui/ARView';
import { Landing } from './ui/Landing';
import { ManualForm } from './ui/ManualForm';
import { Results } from './ui/Results';
import { SkyMap } from './ui/SkyMap';
import { Status } from './ui/Status';

type Phase =
  | { kind: 'landing' }
  | { kind: 'locating' }
  | { kind: 'manual'; notice?: string }
  | { kind: 'results'; view: EclipseView; accuracyMeters: number | null; passed: boolean }
  | { kind: 'ar'; view: EclipseView; headingAuthorized: boolean }
  | { kind: 'error'; message: string };

function computeFor(location: ObserverLocation, eclipseDate?: string): EclipseView | null {
  const options = { refDate: new Date() };
  return eclipseDate !== undefined
    ? EclipseCalculator.forEclipseDate(eclipseDate, location, options)
    : EclipseCalculator.forLocation(location, options);
}

function resultFromLocation(
  location: ObserverLocation,
  accuracyMeters: number | null,
  eclipseDate?: string,
): Phase {
  try {
    const view = computeFor(location, eclipseDate);
    if (view === null) {
      return {
        kind: 'error',
        message: 'No solar eclipse visible from this location within the 10-year search window.',
      };
    }
    const passed = new Date(view.times.peak.utcIso).getTime() < Date.now();
    return { kind: 'results', view, accuracyMeters, passed };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function initialPhase(): Phase {
  if (typeof window === 'undefined') {
    return { kind: 'landing' };
  }
  const params = parseShareParams(window.location.search);
  if (params === null) {
    return { kind: 'landing' };
  }
  return resultFromLocation(
    { lat: params.lat, lon: params.lon, heightMeters: params.heightMeters },
    null,
    params.eclipseDate,
  );
}

const DENIAL_NOTICE: Record<string, string> = {
  unsupported: 'Location is not available in this browser. Enter coordinates manually.',
  'user-denied': 'Location permission was denied. Enter coordinates manually.',
  error: 'Could not get your location. Enter coordinates manually.',
};

const geolocationRequestor = createGeolocationRequestor();

function shareUrlFor(view: EclipseView): string {
  return buildShareUrl(window.location.href, {
    lat: view.observer.lat,
    lon: view.observer.lon,
    heightMeters: view.observer.heightMeters,
    eclipseDate: view.eclipseDateIso,
    kind: view.kind,
  });
}

export default function App() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const geolocation = usePermission(geolocationRequestor);
  const [headingAuthorized, setHeadingAuthorized] = useState(false);
  const heading = useHeading(headingAuthorized);

  useEffect(() => {
    if (phase.kind === 'results') {
      window.history.replaceState(null, '', shareUrlFor(phase.view));
    }
  }, [phase]);

  const locate = async () => {
    setPhase({ kind: 'locating' });
    const outcome = await geolocation.request();
    if (outcome.state === 'denied') {
      setPhase({ kind: 'manual', notice: DENIAL_NOTICE[outcome.reason] });
      return;
    }
    setPhase(resultFromLocation(toLocation(outcome.data), outcome.data.accuracyMeters));
  };

  const submitManual = (location: ObserverLocation) => {
    setPhase(resultFromLocation(location, null));
  };

  // Request the iOS deviceorientation permission inside the click gesture so the
  // compass can align as soon as AR starts, instead of waiting for a manual
  // "recalibrate" tap.
  const viewAr = async (view: EclipseView) => {
    const granted = await requestDeviceOrientationPermission(window);
    console.debug(
      '[eclipse-checker:ar] entry: orientation permission',
      granted ? 'granted' : 'denied',
    );
    if (granted) {
      // Only listen for deviceorientation once permission is granted — iOS logs
      // "No device orientation events will be fired" if a listener is registered
      // before the permission request. This also switches on the 2D sky-map
      // heading when returning to results.
      setHeadingAuthorized(true);
    }
    setPhase({ kind: 'ar', view, headingAuthorized: granted });
  };

  return (
    <>
      <main className="app">
        <h1>Eclipse Checker</h1>
        <p className="subtitle">Find the next solar eclipse visible from where you stand.</p>

        {phase.kind === 'landing' && (
          <Landing
            locating={geolocation.pending}
            onLocate={() => void locate()}
            onManual={() => setPhase({ kind: 'manual' })}
          />
        )}

        {phase.kind === 'locating' && <Status message="Requesting your location…" />}

        {phase.kind === 'manual' && (
          <ManualForm notice={phase.notice} onSubmit={submitManual} busy={false} />
        )}

        {phase.kind === 'error' && (
          <>
            <Status message={phase.message} tone="error" />
            <ManualForm onSubmit={submitManual} busy={false} />
          </>
        )}

        {phase.kind === 'results' && (
          <div className="results-wrap">
            <Results
              view={phase.view}
              passed={phase.passed}
              shareUrl={shareUrlFor(phase.view)}
              locationAccuracyMeters={phase.accuracyMeters}
              onRestart={() => {
                window.history.replaceState(null, '', window.location.pathname);
                setPhase({ kind: 'landing' });
              }}
              onViewAr={() => void viewAr(phase.view)}
            />
            <SkyMap view={phase.view} headingDeg={heading.headingDeg} />
          </div>
        )}

        {phase.kind === 'ar' && (
          <ARView
            view={phase.view}
            headingAuthorized={phase.headingAuthorized}
            onExit={() => {
              setPhase({
                kind: 'results',
                view: phase.view,
                accuracyMeters: null,
                passed: new Date(phase.view.times.peak.utcIso).getTime() < Date.now(),
              });
            }}
          />
        )}
      </main>
      <Analytics />
    </>
  );
}

function toLocation(data: GeolocationData): ObserverLocation {
  return {
    lat: data.lat,
    lon: data.lon,
    heightMeters: data.altitudeMeters ?? 0,
  };
}
