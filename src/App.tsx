import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

import { EclipseCalculator } from './astro';
import type { EclipseView, ObserverLocation } from './astro';
import { useHeading } from './hooks/useHeading';
import { usePermission } from './hooks/usePermission';
import { buildShareUrl, parseShareParams } from './lib/shareUrl';
import {
  createGeolocationRequestor,
  isCompassAvailable,
  requestDeviceOrientationPermission,
  type GeolocationData,
} from './sensors';
import { ARView } from './ui/ARView';
import { AccuracyGauge, COMPASS_CALIBRATION_HINT } from './ui/AccuracyGauge';
import { COMPASS_ACCURACY_LIMIT_DEG } from './ar/arController';
import { Landing } from './ui/Landing';
import { ManualForm } from './ui/ManualForm';
import { QrPrompt } from './ui/QrPrompt';
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
  const [compassPending, setCompassPending] = useState(false);
  const heading = useHeading(headingAuthorized);
  const compassAvailable = isCompassAvailable();

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

  // Activate the compass on the results screen (outside AR) so the sky map can
  // show the heading marker right after locating, without entering the AR view
  // first. Request the iOS permission inside the click gesture.
  const enableCompass = async () => {
    setCompassPending(true);
    const granted = await requestDeviceOrientationPermission(window);
    console.debug(
      '[eclipse-checker:heading] enable: orientation permission',
      granted ? 'granted' : 'denied',
    );
    setCompassPending(false);
    if (granted) {
      setHeadingAuthorized(true);
    }
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
    if (granted && compassAvailable) {
      // Only listen for deviceorientation once permission is granted — iOS logs
      // "No device orientation events will be fired" if a listener is registered
      // before the permission request. This also switches on the 2D sky-map
      // heading when returning to results. A device with no compass can't use a
      // heading at all, so don't mark it authorized on the results screen.
      setHeadingAuthorized(true);
    }
    setPhase({ kind: 'ar', view, headingAuthorized: granted && compassAvailable });
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
          <ManualForm
            notice={phase.notice}
            onBack={() => setPhase({ kind: 'landing' })}
            onSubmit={submitManual}
          />
        )}

        {phase.kind === 'error' && (
          <>
            <Status message={phase.message} tone="error" />
            <ManualForm onBack={() => setPhase({ kind: 'landing' })} onSubmit={submitManual} />
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
            <div className="sky-map-block">
              <div className="compass-toggle">
                {headingAuthorized ? (
                  <p className="compass-on" role="status">
                    Compass active
                  </p>
                ) : compassAvailable ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void enableCompass()}
                    disabled={compassPending}
                  >
                    {compassPending ? 'Enabling…' : 'Activate compass'}
                  </button>
                ) : (
                  <QrPrompt compact />
                )}
              </div>
              {headingAuthorized && heading.accuracyDeg !== null && (
                <div className="sky-map-accuracy">
                  <AccuracyGauge accuracyDeg={heading.accuracyDeg} />
                  {heading.accuracyDeg > COMPASS_ACCURACY_LIMIT_DEG && (
                    <p className="sky-map-hint">{COMPASS_CALIBRATION_HINT}</p>
                  )}
                </div>
              )}
              <SkyMap view={phase.view} headingDeg={heading.headingDeg} />
            </div>
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

        {phase.kind !== 'ar' && (
          <footer className="app-footer">
            <a href="https://github.com/jvacek/eclipse-checker" target="_blank" rel="noreferrer">
              View source on GitHub
            </a>
            <span className="app-footer-sep" aria-hidden="true">
              ·
            </span>
            <a href="https://ko-fi.com/jvacek" target="_blank" rel="noreferrer">
              Buy me a coffee on Ko-fi
            </a>
          </footer>
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
