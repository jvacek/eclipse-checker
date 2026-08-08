// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as THREE from 'three';
import { Scene, Quaternion } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EclipseView } from '../../src/astro';
import type { EngineApiLike } from '../../src/ar/engineSession';
import { SUN_DISTANCE } from '../../src/ar/scene';
import type { DeviceOrientationEventLike, DeviceOrientationLike } from '../../src/sensors';
import { ARView } from '../../src/ui/ARView';

function makeView(): EclipseView {
  return {
    kind: 'Partial',
    eclipseDateIso: '2026-08-12',
    timezone: 'Europe/Madrid',
    daysUntil: 4,
    times: {
      begin: {
        utcIso: '2026-08-12T17:36:00Z',
        localTime: '19:36',
        sunAltitudeDeg: 20,
        sunAzimuthDeg: 265,
      },
      peak: {
        utcIso: '2026-08-12T18:32:00Z',
        localTime: '20:32',
        sunAltitudeDeg: 7,
        sunAzimuthDeg: 280,
      },
      end: {
        utcIso: '2026-08-12T19:16:00Z',
        localTime: '21:16',
        sunAltitudeDeg: 0,
        sunAzimuthDeg: 292,
      },
    },
    totalitySeconds: null,
    magnitude: 0.999,
    obscuration: 0.9997,
    sunAltitudePeakDeg: 7,
    sunAzimuthPeakDeg: 280,
    moonPositionAngleDeg: 90,
    rSunDeg: 0.26,
    rMoonDeg: 0.27,
    separationDeg: 0.13,
    observer: { lat: 40.4168, lon: -3.7038, heightMeters: 650 },
  };
}

interface FakeOrientationSource extends DeviceOrientationLike {
  listeners: Array<(event: DeviceOrientationEventLike) => void>;
}

function makeOrientationSource(): FakeOrientationSource {
  return {
    listeners: [],
    addEventListener(_type, listener) {
      this.listeners.push(listener);
    },
    removeEventListener(_type, listener) {
      this.listeners = this.listeners.filter((l) => l !== listener);
    },
  };
}

interface FakeSkyScene {
  scene: Scene;
  camera: { quaternion: Quaternion };
}

function makeSkyScene(): FakeSkyScene {
  return { scene: new Scene(), camera: { quaternion: new Quaternion() } };
}

function makeFakeEngine(): {
  engine: EngineApiLike;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn();
  const engine = {
    Threejs: {
      pipelineModule: () => ({ name: 'threejs' }),
      xrScene: () => ({ scene: {}, camera: {} }),
    },
    GlTextureRenderer: { pipelineModule: () => ({ name: 'gl-texture' }) },
    XrController: { pipelineModule: () => ({ name: 'xr-controller' }) },
    addCameraPipelineModules: vi.fn(),
    clearCameraPipelineModules: vi.fn(),
    run,
    stop: vi.fn(),
  } as unknown as EngineApiLike;
  return { engine, run };
}

function renderActive(view = makeView()) {
  const sky = makeSkyScene();
  const { engine } = makeFakeEngine();
  const orientation = makeOrientationSource();
  const stop = vi.fn();
  const start = vi.fn(() => Promise.resolve(sky));
  const createSession = vi.fn(() => ({ start, stop }));
  render(
    <ARView
      view={view}
      onExit={() => undefined}
      loadEngine={() => Promise.resolve(engine)}
      createSession={createSession}
      headingSource={orientation}
    />,
  );
  return { engine, stop, orientation, sky, createSession, start };
}

describe('ARView (8th Wall engine)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
    delete (window as unknown as { XRExtras?: unknown }).XRExtras;
  });

  it('starts the engine pipeline and becomes active', async () => {
    const { createSession, start, sky } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));
    expect(createSession).toHaveBeenCalledWith(expect.anything(), expect.any(HTMLCanvasElement));
    expect(start).toHaveBeenCalledTimes(1);
    expect(sky.scene.children.length).toBeGreaterThan(0);
  });

  it('exposes window.THREE so the engine three.js pipeline can instantiate its renderer', async () => {
    renderActive();
    await waitFor(() =>
      expect((window as unknown as { THREE?: typeof THREE }).THREE).toBe(THREE),
    );
  });

  it('adds the XRExtras FullWindowCanvas module via the default session factory', async () => {
    const sentinel = { name: 'full-window-canvas' };
    (window as unknown as { XRExtras?: unknown }).XRExtras = {
      FullWindowCanvas: { pipelineModule: () => sentinel },
    };
    const { engine } = makeFakeEngine();
    const addModules = engine.addCameraPipelineModules as ReturnType<typeof vi.fn>;
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={() => Promise.resolve(engine)}
        headingSource={makeOrientationSource()}
      />,
    );
    await waitFor(() => expect(addModules).toHaveBeenCalled());
    const modules = addModules.mock.calls[0][0] as Array<{
      name?: string;
      onStart?: () => void;
    }>;
    expect(modules).toContainEqual(sentinel);
    modules.find((m) => m.name === 'eclipse-checker-overlay')?.onStart?.();
  });

  it('aligns the sun to the compass heading', async () => {    const { orientation, sky } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    expect(orientation.listeners).toHaveLength(1);
    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
    });

    await waitFor(() => expect(screen.getByText(/Compass aligned/)).toBeInTheDocument());

    // Camera quaternion is identity → world azimuth 0. A compass heading of 90° means
    // the sun (real azimuth 280°) must be drawn at world azimuth 190°.
    const sun = sky.scene.children[0];
    const az = (280 - 90) * (Math.PI / 180);
    const alt = 7 * (Math.PI / 180);
    await waitFor(() => {
      expect(sun.position.x).toBeCloseTo(Math.sin(az) * Math.cos(alt) * SUN_DISTANCE, 4);
      expect(sun.position.z).toBeCloseTo(-Math.cos(az) * Math.cos(alt) * SUN_DISTANCE, 4);
    });
  });

  it('renders the safety notice, attribution link and exit button', async () => {
    renderActive();
    expect(
      screen.getByText(/never look at the Sun through any lens or AR overlay/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/AR powered by the 8th Wall engine/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /XR Engine License Agreement/ })).toHaveAttribute(
      'href',
      expect.stringContaining('8thwall'),
    );
    expect(screen.getByRole('button', { name: 'Exit AR' })).toBeInTheDocument();
  });

  it('shows compass calibration progress, then alignment once a fix arrives', async () => {
    const { orientation } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    // Before any absolute heading, the compass shows the waiting hint.
    expect(screen.getByText(/Point your phone north to align the compass/i)).toBeInTheDocument();

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());
    expect(screen.getByText(/Compass aligned/i)).toHaveAttribute('data-state', 'aligned');
  });

  it('aligns from iOS events, which always report absolute: false', async () => {
    const { orientation } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    // iOS Safari delivers the earth-referenced heading via webkitCompassHeading
    // while event.absolute stays false.
    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 90,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());
  });

  it('ignores a heading with poor webkitCompassAccuracy (e.g. right after an app switch)', async () => {
    const { orientation, sky } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());

    const sun = sky.scene.children[0];
    const xBefore = sun.position.x;
    const zBefore = sun.position.z;

    // A re-calibrating magnetometer reports a far-off heading with degraded
    // accuracy; it must not drag the sun away from the world-anchored ring.
    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 180,
      webkitCompassAccuracy: 40,
    });

    expect(sun.position.x).toBeCloseTo(xBefore, 6);
    expect(sun.position.z).toBeCloseTo(zBefore, 6);
    expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument();
  });

  it('snaps to a fresh heading instead of blending when the app returns to foreground', async () => {
    const { orientation, sky } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());

    // App switch: background and come back. The smoothed fix is dropped so the
    // next good event snaps instead of EMA-blending a stale bias in.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 100,
    });

    const sun = sky.scene.children[0];
    const az = (280 - 100) * (Math.PI / 180);
    const alt = 7 * (Math.PI / 180);
    await waitFor(() => {
      expect(sun.position.x).toBeCloseTo(Math.sin(az) * Math.cos(alt) * SUN_DISTANCE, 4);
      expect(sun.position.z).toBeCloseTo(-Math.cos(az) * Math.cos(alt) * SUN_DISTANCE, 4);
    });
  });

  it('recalibrate clears the fix and re-aligns on the next heading event', async () => {
    const { orientation } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    await userEvent.click(screen.getByRole('button', { name: /Recalibrate compass/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/Point your phone north to align the compass/i),
      ).toBeInTheDocument(),
    );

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 42,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());
  });

  it('hides the recalibrate button once the compass is aligned', async () => {
    const { orientation } = renderActive();
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));

    expect(screen.getByRole('button', { name: /Recalibrate compass/i })).toBeInTheDocument();

    orientation.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: 90,
    });
    await waitFor(() => expect(screen.getByText(/Compass aligned/i)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Recalibrate compass/i })).not.toBeInTheDocument(),
    );
  });

  it('reports compass permission denied without a heading fix', async () => {
    const { engine } = makeFakeEngine();
    const sky = makeSkyScene();
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        headingAuthorized={false}
        loadEngine={() => Promise.resolve(engine)}
        createSession={() => ({ start: () => Promise.resolve(sky), stop: vi.fn() })}
      />,
    );
    const section = document.querySelector('.ar-view');
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));
    const msg = await screen.findByText(/Compass permission denied/i);
    expect(msg).toHaveAttribute('data-state', 'denied');
  });

  it('calls onExit when the exit button is clicked', async () => {
    const onExit = vi.fn();
    const sky = makeSkyScene();
    const { engine } = makeFakeEngine();
    render(
      <ARView
        view={makeView()}
        onExit={onExit}
        loadEngine={() => Promise.resolve(engine)}
        createSession={() => ({ start: () => Promise.resolve(sky), stop: vi.fn() })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Exit AR' }));
    // A black cover paints before leaving so the last AR frame never flashes.
    expect(document.querySelector('.ar-view')).toHaveAttribute('data-status', 'exiting');
    expect(document.querySelector('.ar-exit-cover')).toBeTruthy();
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  });

  it('restores the canvas under the section when FullWindowCanvas moved it to the body', async () => {
    // XRExtras' FullWindowCanvas reparents the canvas into document.body on
    // attach and never moves it back on detach. Exiting must restore it under
    // the section, otherwise the frozen last AR frame stays pinned over the
    // results view after ARView unmounts.
    const sky = makeSkyScene();
    const { engine } = makeFakeEngine();
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={() => Promise.resolve(engine)}
        createSession={() => ({ start: () => Promise.resolve(sky), stop: vi.fn() })}
      />,
    );
    const section = document.querySelector('.ar-view') as HTMLElement;
    await waitFor(() => expect(section).toHaveAttribute('data-status', 'active'));
    const canvas = section.querySelector('.ar-canvas') as HTMLCanvasElement;
    document.body.appendChild(canvas);
    expect(canvas.parentElement).toBe(document.body);

    await userEvent.click(screen.getByRole('button', { name: 'Exit AR' }));

    await waitFor(() => expect(canvas.parentElement).toBe(section));
    expect(section.contains(canvas)).toBe(true);
  });

  it('restores the canvas under the section when the engine errors out', async () => {
    const { engine } = makeFakeEngine();
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={() => Promise.resolve(engine)}
        createSession={() => ({
          start: () => Promise.reject(new Error('engine exploded')),
          stop: vi.fn(),
        })}
      />,
    );
    await screen.findByRole('alert');
    const section = document.querySelector('.ar-view') as HTMLElement;
    const canvas = section.querySelector('.ar-canvas') as HTMLCanvasElement;
    document.body.appendChild(canvas);
    expect(canvas.parentElement).toBe(document.body);

    await userEvent.click(screen.getByRole('button', { name: 'Back to results' }));

    await waitFor(() => expect(canvas.parentElement).toBe(section));
    expect(section.contains(canvas)).toBe(true);
  });

  it('dismisses the safety and license info while keeping the buttons', async () => {
    renderActive();
    expect(
      screen.getByText(/never look at the Sun through any lens or AR overlay/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Hide safety and license info/i }));

    expect(
      screen.queryByText(/never look at the Sun through any lens or AR overlay/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/AR powered by the 8th Wall engine/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit AR' })).toBeInTheDocument();
  });

  it('shows role=alert when the engine fails to load', async () => {
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={() => Promise.reject(new Error('engine exploded'))}
        createSession={() => ({ start: () => Promise.resolve(makeSkyScene()), stop: vi.fn() })}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/engine exploded/);
    expect(screen.getByRole('button', { name: 'Back to results' })).toBeInTheDocument();
  });

  it('shows a friendly message instead of the raw engine error when no session can start', async () => {
    const { engine } = makeFakeEngine();
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={() => Promise.resolve(engine)}
        createSession={() => ({
          start: () =>
            Promise.reject(new Error('No valid session manager to handle this session.')),
          stop: vi.fn(),
        })}
      />,
    );
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert).toHaveTextContent(/supported on this device or browser/i),
    );
    expect(alert).not.toHaveTextContent(/No valid session manager/);
  });

  it('fails fast with a friendly message when no camera is available', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic' }],
      },
      configurable: true,
    });
    const loadEngine = vi.fn(() => Promise.resolve({}));
    render(
      <ARView
        view={makeView()}
        onExit={() => undefined}
        loadEngine={loadEngine}
        createSession={() => ({ start: () => Promise.resolve(makeSkyScene()), stop: vi.fn() })}
      />,
    );
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent(/AR needs the camera/i));
    expect(loadEngine).not.toHaveBeenCalled();
  });

  it('starts the off-screen sun arrow hidden', async () => {
    renderActive();
    const arrow = document.querySelector('.ar-sun-arrow') as HTMLElement;
    expect(arrow).toHaveAttribute('hidden');
  });

  it('shows the off-screen arrow once active when the sun is behind-right', async () => {
    renderActive();
    const arrow = document.querySelector('.ar-sun-arrow') as HTMLElement;
    // Identity camera, default view: sun azimuth 280°, altitude 7° → behind-right.
    await waitFor(() => expect(arrow).not.toHaveAttribute('hidden'));
  });
});