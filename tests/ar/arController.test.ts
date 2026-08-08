// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Quaternion, Scene } from 'three';

import type { EclipseView } from '../../src/astro';
import { createARController } from '../../src/ar/arController';
import type { EngineApiLike, EngineSessionApi } from '../../src/ar/engineSession';
import { SUN_DISTANCE } from '../../src/ar/scene';
import type { DeviceOrientationEventLike, DeviceOrientationLike } from '../../src/sensors';

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

function makeFakeEngine(): EngineApiLike {
  return {
    Threejs: {
      pipelineModule: () => ({ name: 'threejs' }),
      xrScene: () => ({ scene: new Scene(), camera: { quaternion: new Quaternion() } }),
    },
    GlTextureRenderer: { pipelineModule: () => ({ name: 'gl-texture' }) },
    XrController: { pipelineModule: () => ({ name: 'xr-controller' }) },
    addCameraPipelineModules: vi.fn(),
    clearCameraPipelineModules: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
  } as unknown as EngineApiLike;
}

function makeDom() {
  const section = document.createElement('section');
  const canvas = document.createElement('canvas');
  const arrow = document.createElement('div');
  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.appendChild(glyph);
  section.appendChild(canvas);
  section.appendChild(arrow);
  document.body.appendChild(section);
  return { section, canvas, arrow, glyph };
}

function makeController(options: {
  engine?: EngineApiLike;
  session?: EngineSessionApi;
  onStatus?: (status: 'active' | 'error') => void;
  onError?: (message: string) => void;
  onCompass?: (state: 'requesting' | 'waiting' | 'aligned' | 'denied') => void;
  headingSource?: FakeOrientationSource;
  dom?: ReturnType<typeof makeDom>;
}) {
  const dom = options.dom ?? makeDom();
  const engine = options.engine ?? makeFakeEngine();
  const session =
    options.session ?? {
      start: () => Promise.resolve({ scene: new Scene(), camera: { quaternion: new Quaternion() } }),
      stop: vi.fn(),
    };
  const onStatus = options.onStatus ?? vi.fn();
  const onError = options.onError ?? vi.fn();
  const onCompass = options.onCompass ?? vi.fn();
  const headingSource = options.headingSource ?? makeOrientationSource();
  const controller = createARController({
    view: makeView(),
    canvas: dom.canvas,
    section: dom.section,
    arrow: dom.arrow,
    glyph: dom.glyph,
    headingSource,
    loadEngine: () => Promise.resolve(engine),
    createSession: () => session,
    callbacks: { onStatus, onError, onCompass },
  });
  return { controller, dom, engine, session, onStatus, onError, onCompass, headingSource, glyph: dom.glyph };
}

describe('createARController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
    delete (window as unknown as { THREE?: unknown }).THREE;
  });

  it('becomes active and reports a heading fix once an accurate reading arrives', async () => {
    const { controller, onStatus, onCompass, headingSource, glyph } = makeController({});
    await controller.start();

    expect(onStatus).toHaveBeenCalledWith('active');
    expect((window as unknown as { THREE?: unknown }).THREE).toBeDefined();

    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');

    const arrow = glyph.parentElement as HTMLElement;
    expect(arrow).toBeTruthy();
    controller.stop();
  });

  it('stop() is idempotent and restores the canvas under the section', async () => {
    const { controller, dom, session } = makeController({});
    await controller.start();
    // Simulate XRExtras FullWindowCanvas moving the canvas into document.body.
    document.body.appendChild(dom.canvas);
    expect(dom.canvas.parentElement).toBe(document.body);

    controller.stop();
    controller.stop();
    expect(vi.mocked(session.stop)).toHaveBeenCalledTimes(1);
    expect(dom.canvas.parentElement).toBe(dom.section);
  });

  it('reports a friendly error and stops the session when startup fails', async () => {
    const { controller, session, onStatus, onError } = makeController({
      session: {
        start: () => Promise.reject(new Error('No valid session manager to handle this session.')),
        stop: vi.fn(),
      },
    });
    await controller.start();

    expect(onStatus).toHaveBeenCalledWith('error');
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/supported on this device or browser/i),
    );
    expect(vi.mocked(session.stop)).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('stop() during a pending start() aborts without emitting an error', async () => {
    let resolveStart!: (value: unknown) => void;
    const dom = makeDom();
    const session = {
      start: vi.fn(() => new Promise((resolve) => (resolveStart = resolve))),
      stop: vi.fn(),
    } as unknown as EngineSessionApi;
    const onStatus = vi.fn();
    const onError = vi.fn();
    const controller = createARController({
      view: makeView(),
      canvas: dom.canvas,
      section: dom.section,
      arrow: dom.arrow,
      glyph: dom.glyph,
      headingSource: makeOrientationSource(),
      loadEngine: () => Promise.resolve(makeFakeEngine()),
      createSession: () => session,
      callbacks: { onStatus, onError, onCompass: vi.fn() },
    });

    const started = controller.start();
    // Let start() reach the pending session.start() before tearing down.
    await vi.waitFor(() => expect(session.start).toHaveBeenCalled());
    controller.stop();
    resolveStart({ scene: new Scene(), camera: { quaternion: new Quaternion() } });
    await started;

    expect(onStatus).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('recalibrate resets the yaw offset and reports the permission outcome', async () => {
    const { controller, onCompass, headingSource, glyph } = makeController({});
    await controller.start();

    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');

    const granted = await controller.recalibrate();
    expect(granted).toBe(true); // jsdom has no DeviceOrientationEvent.requestPermission
    expect(onCompass).toHaveBeenCalledWith('requesting');
    expect(onCompass).toHaveBeenLastCalledWith('waiting');
    expect(glyph).toBeTruthy();
    controller.stop();
  });

  it('uses a provisional heading once the calibration grace period elapses, then upgrades', async () => {
    const dom = makeDom();
    const sky = new Scene();
    const session = {
      start: () => Promise.resolve({ scene: sky, camera: { quaternion: new Quaternion() } }),
      stop: vi.fn(),
    };
    const onCompass = vi.fn();
    const headingSource = makeOrientationSource();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const controller = createARController({
      view: makeView(),
      canvas: dom.canvas,
      section: dom.section,
      arrow: dom.arrow,
      glyph: dom.glyph,
      headingSource,
      loadEngine: () => Promise.resolve(makeFakeEngine()),
      createSession: () => session,
      callbacks: { onStatus: vi.fn(), onError: vi.fn(), onCompass },
    });
    await controller.start();

    // Poor accuracy before the 5s grace deadline: no fix yet, still waiting.
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 40,
    });
    expect(onCompass).not.toHaveBeenCalledWith('aligned');

    // After the deadline a poor reading is used provisionally (sun placed) but
    // the compass is NOT reported aligned — the recalibrate button stays visible.
    nowSpy.mockReturnValue(7_000);
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 40,
    });
    expect(onCompass).not.toHaveBeenCalledWith('aligned');

    const sun = sky.children[0] as { position: { x: number; z: number } };
    expect(sun).toBeDefined();
    const az = (280 - 90) * (Math.PI / 180);
    const alt = 7 * (Math.PI / 180);
    await vi.waitFor(() => {
      expect(sun.position.x).toBeCloseTo(Math.sin(az) * Math.cos(alt) * SUN_DISTANCE, 4);
      expect(sun.position.z).toBeCloseTo(-Math.cos(az) * Math.cos(alt) * SUN_DISTANCE, 4);
    });

    // A good reading upgrades the provisional fix and marks the compass aligned.
    nowSpy.mockReturnValue(8_000);
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 100,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');
    await vi.waitFor(() => {
      expect(sun.position.x).toBeCloseTo(Math.sin((280 - 100) * (Math.PI / 180)) * Math.cos(alt) * SUN_DISTANCE, 4);
    });

    controller.stop();
  });

  it('waits for the engine world frame to settle before capturing a trusted offset', async () => {
    const dom = makeDom();
    const sky = new Scene();
    let onTrackingStatus:
      | ((tracking: { status: string; reason: string }) => void)
      | undefined;
    const session = {
      start: () => Promise.resolve({ scene: sky, camera: { quaternion: new Quaternion() } }),
      stop: vi.fn(),
    };
    const onCompass = vi.fn();
    const headingSource = makeOrientationSource();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const controller = createARController({
      view: makeView(),
      canvas: dom.canvas,
      section: dom.section,
      arrow: dom.arrow,
      glyph: dom.glyph,
      headingSource,
      loadEngine: () => Promise.resolve(makeFakeEngine()),
      createSession: (_engine, _canvas, hooks) => {
        onTrackingStatus = hooks?.onTrackingStatus;
        return session;
      },
      callbacks: { onStatus: vi.fn(), onError: vi.fn(), onCompass },
    });
    await controller.start();

    // Accurate reading while the engine world frame is still INITIALIZING:
    // the offset must NOT be captured (the quaternion is not trustworthy yet).
    onTrackingStatus?.({ status: 'LIMITED', reason: 'INITIALIZING' });
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).not.toHaveBeenCalledWith('aligned');

    // The frame settles; the next accurate reading anchors the offset.
    nowSpy.mockReturnValue(2_000);
    onTrackingStatus?.({ status: 'NORMAL', reason: 'UNSPECIFIED' });
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');

    controller.stop();
  });

  it('drops the captured offset when the engine re-establishes its world frame', async () => {
    const dom = makeDom();
    const sky = new Scene();
    let onTrackingStatus:
      | ((tracking: { status: string; reason: string }) => void)
      | undefined;
    const session = {
      start: () => Promise.resolve({ scene: sky, camera: { quaternion: new Quaternion() } }),
      stop: vi.fn(),
    };
    const onCompass = vi.fn();
    const headingSource = makeOrientationSource();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const controller = createARController({
      view: makeView(),
      canvas: dom.canvas,
      section: dom.section,
      arrow: dom.arrow,
      glyph: dom.glyph,
      headingSource,
      loadEngine: () => Promise.resolve(makeFakeEngine()),
      createSession: (_engine, _canvas, hooks) => {
        onTrackingStatus = hooks?.onTrackingStatus;
        return session;
      },
      callbacks: { onStatus: vi.fn(), onError: vi.fn(), onCompass },
    });
    await controller.start();

    // Settle, then capture a trusted offset.
    nowSpy.mockReturnValue(2_000);
    onTrackingStatus?.({ status: 'NORMAL', reason: 'UNSPECIFIED' });
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');

    // The engine loses tracking and re-establishes its frame: the captured
    // offset is stale, so the compass returns to 'waiting' until the next fix.
    nowSpy.mockReturnValue(4_000);
    onTrackingStatus?.({ status: 'LIMITED', reason: 'INITIALIZING' });
    nowSpy.mockReturnValue(5_000);
    onTrackingStatus?.({ status: 'NORMAL', reason: 'UNSPECIFIED' });
    expect(onCompass).toHaveBeenCalledWith('waiting');

    // A fresh accurate reading re-anchors against the re-established frame.
    nowSpy.mockReturnValue(5_100);
    headingSource.listeners[0]({
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 2,
    });
    expect(onCompass).toHaveBeenCalledWith('aligned');

    controller.stop();
  });
});
