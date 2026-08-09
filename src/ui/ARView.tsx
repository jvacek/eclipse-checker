import { useEffect, useRef, useState } from 'react';

import type { EclipseView } from '../astro';
import {
  createARController,
  type ARController,
  type CompassState,
} from '../ar/arController';
import type { EngineApiLike, EngineSessionApi } from '../ar/engineSession';
import type { DeviceOrientationLike } from '../sensors';
import { AccuracyGauge, COMPASS_CALIBRATION_HINT } from './AccuracyGauge';

const XR_ENGINE_LICENSE_URL = 'https://github.com/8thwall/engine/blob/main/LICENSE';
const AR_LOG_PREFIX = '[eclipse-checker:ar]';

function compassMessage(state: CompassState): string {
  switch (state) {
    case 'aligned':
      return 'Compass aligned';
    case 'provisional':
      return 'Compass calibrating — view is approximate';
    case 'requesting':
      return 'Requesting compass access…';
    case 'denied':
      return 'Compass permission denied — the AR view is not north-aligned';
    default:
      return 'Calibrate the compass to align the view';
  }
}

export interface ARViewProps {
  view: EclipseView;
  onExit: () => void;
  /** Whether deviceorientation permission was granted (requested by the AR-entry gesture). */
  headingAuthorized?: boolean;
  /** Injectable engine loader (defaults to the browser lazy loader). */
  loadEngine?: () => Promise<unknown>;
  /** Injectable session factory (defaults to the XR8 three.js session). */
  createSession?: (engine: EngineApiLike, canvas: HTMLCanvasElement) => EngineSessionApi;
  /** Injectable heading source (defaults to `window`). */
  headingSource?: DeviceOrientationLike;
}

/**
 * Thin React shell over the imperative `ARController`. All AR side effects
 * (engine load, camera pipeline, rAF render loop, compass yaw capture) live in
 * `src/ar/arController.ts`; this component only owns status state and DOM refs
 * that the controller writes into.
 */
export function ARView({
  view,
  onExit,
  headingAuthorized = true,
  loadEngine,
  createSession,
  headingSource,
}: ARViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<SVGSVGElement>(null);
  const onExitRef = useRef(onExit);
  const controllerRef = useRef<ARController | null>(null);

  const [status, setStatus] = useState<'starting' | 'active' | 'error' | 'exiting'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [safetyVisible, setSafetyVisible] = useState(true);
  const [compass, setCompass] = useState<CompassState>(headingAuthorized ? 'waiting' : 'denied');
  const compassRef = useRef<CompassState>(compass);
  const [accuracyDeg, setAccuracyDeg] = useState<number | null>(null);

  /** setCompass + a console breadcrumb so state transitions are visible while debugging. */
  const updateCompass = (next: CompassState) => {
    if (compassRef.current !== next) {
      console.info(AR_LOG_PREFIX, `compass state: ${compassRef.current} -> ${next}`);
      compassRef.current = next;
    }
    setCompass(next);
  };

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const controller = createARController({
      view,
      canvas,
      section: sectionRef.current,
      arrow: arrowRef.current,
      glyph: glyphRef.current,
      headingSource,
      loadEngine,
      createSession,
      callbacks: {
        onStatus: (next) => setStatus(next),
        onError: (message) => setError(message),
        onCompass: updateCompass,
        onAccuracy: setAccuracyDeg,
      },
    });
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.stop();
    };
    // The controller is created once per mount; props that feed it (view,
    // injectables) are captured at creation and the session never re-configures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exitAR = () => {
    // Stop the engine and paint a black cover, then leave on the next frame so
    // the last rendered AR frame never flashes over the results view. The
    // controller's stop() is idempotent and also restores the canvas under the
    // section, so a pending start() rejection can't surface an error screen.
    setStatus('exiting');
    controllerRef.current?.stop();
    requestAnimationFrame(() => onExitRef.current());
  };

  return (
    <section ref={sectionRef} className="ar-view" data-status={status}>
      <canvas ref={canvasRef} className="ar-canvas" />

      <div ref={arrowRef} className="ar-sun-arrow" hidden aria-hidden="true">
        <svg ref={glyphRef} viewBox="0 0 24 24">
          <path d="M12 2 L20 16 L12 12 L4 16 Z" fill="currentColor" />
        </svg>
        <span>Sun</span>
      </div>

      {status === 'starting' && <p className="ar-status">Starting AR…</p>}

      {status === 'error' && (
        <div className="ar-error" role="alert">
          <p>{error ?? 'AR is unavailable in this browser.'}</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              controllerRef.current?.stop();
              onExitRef.current();
            }}
          >
            Back to results
          </button>
        </div>
      )}

      {status === 'active' && (
        <>
          <p className="ar-compass" data-state={compass}>
            {compassMessage(compass)}
          </p>
          {compass !== 'aligned' && compass !== 'denied' && (
            <p className="ar-compass-hint">{COMPASS_CALIBRATION_HINT}</p>
          )}
        </>
      )}

      {status === 'exiting' && <div className="ar-exit-cover" aria-hidden="true" />}

      <div className="ar-safety">
        {safetyVisible && (
          <div className="ar-safety-info">
            <button
              type="button"
              className="ar-safety-dismiss"
              aria-label="Hide safety and license info"
              onClick={() => setSafetyVisible(false)}
            >
              ×
            </button>
            <p>
              Safety: never look at the Sun through any lens or AR overlay. The overlay is a
              simulation — view the eclipse only with certified solar filters.
            </p>
            <p className="ar-attribution">
              AR powered by the 8th Wall engine (Niantic Spatial). See the{' '}
              <a href={XR_ENGINE_LICENSE_URL} target="_blank" rel="noreferrer">
                XR Engine License Agreement
              </a>
              .
            </p>
          </div>
        )}
        {status === 'active' && compass !== 'denied' && accuracyDeg !== null && (
          <AccuracyGauge accuracyDeg={accuracyDeg} />
        )}
        {status === 'active' && compass !== 'aligned' && (
          <button
            type="button"
            className="secondary"
            onClick={() => void controllerRef.current?.recalibrate()}
          >
            Recalibrate compass
          </button>
        )}
        <button type="button" className="primary" onClick={exitAR}>
          Exit AR
        </button>
      </div>
    </section>
  );
}
