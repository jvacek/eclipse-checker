import { describe, expect, it, vi } from 'vitest';

import {
  createEngineSession,
  type EngineApiLike,
  type EngineSceneLike,
} from '../../src/ar/engineSession';

const SCENE_MODULE_NAME = 'eclipse-checker-overlay';

interface FakeEngine {
  engine: EngineApiLike;
  modules: Array<{
    name?: string;
    onStart?: () => void;
    onException?: (error: unknown) => void;
    onDetach?: () => void;
    onUpdate?: (result: unknown) => void;
  }>;
  sky: EngineSceneLike;
  run: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeEngine(): FakeEngine {
  const sky: EngineSceneLike = { scene: { fake: true }, camera: { fake: true } };
  const modules: FakeEngine['modules'] = [];
  const engine: EngineApiLike = {
    Threejs: {
      pipelineModule: () => ({ name: 'threejs' }),
      xrScene: () => sky,
    },
    GlTextureRenderer: { pipelineModule: () => ({ name: 'gl-texture' }) },
    XrController: { pipelineModule: () => ({ name: 'xr-controller' }) },
    addCameraPipelineModules: (mods) => modules.push(...(mods as typeof modules)),
    clearCameraPipelineModules: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
  };
  return { engine, modules, sky, run: engine.run as never, stop: engine.stop as never };
}

function findSceneModule(modules: FakeEngine['modules']) {
  return modules.find((m) => m.name === SCENE_MODULE_NAME);
}

describe('createEngineSession', () => {
  it('installs the camera, three.js and SLAM modules, then starts the pipeline', () => {
    const { engine, modules } = makeEngine();
    const canvas = { fake: true };
    const session = createEngineSession({ engine, canvas });

    void session.start();

    expect(modules.map((m) => m.name)).toEqual([
      'gl-texture',
      'threejs',
      'xr-controller',
      SCENE_MODULE_NAME,
    ]);
    expect(engine.run).toHaveBeenCalledWith({ canvas });
  });

  it('resolves start() with the engine main scene', async () => {
    const { engine, modules, sky } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    const sceneModule = findSceneModule(modules);
    expect(sceneModule).toBeDefined();
    sceneModule!.onStart!();
    await expect(ready).resolves.toBe(sky);
  });

  it('rejects start() when the engine reports a session error via onException', async () => {
    const { engine, modules } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    const sceneModule = findSceneModule(modules)!;
    expect(sceneModule.onException).toBeDefined();
    sceneModule.onException!(new Error('No valid session manager to handle this session.'));
    await expect(ready).rejects.toThrow(/No valid session manager/);
  });

  it('rejects start() when the engine did not create a scene', async () => {
    const { engine, modules } = makeEngine();
    (engine.Threejs as { xrScene(): unknown }).xrScene = () => ({ camera: { fake: true } });
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    findSceneModule(modules)!.onStart!();
    await expect(ready).rejects.toThrow(/did not create a scene/);
  });

  it('installs extra modules after the built-in ones', () => {
    const { engine, modules } = makeEngine();
    const extra = { name: 'xrextras-full-window' };
    const session = createEngineSession({ engine, canvas: {}, extraModules: [extra] });
    void session.start();
    expect(modules).toContain(extra);
    expect(modules[modules.length - 2]).toBe(extra);
  });

  it('stop() stops the engine and clears the pipeline modules', () => {
    const { engine } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    session.stop();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.clearCameraPipelineModules).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent: a second stop does not tear the engine down again', async () => {
    const { engine } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    session.stop();
    await expect(ready).rejects.toThrow(/stopped before it started/);
    session.stop();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.clearCameraPipelineModules).toHaveBeenCalledTimes(1);
  });

  it('start() after stop() rejects instead of running the engine twice', async () => {
    const { engine } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    session.stop();
    await expect(session.start()).rejects.toThrow(/stopped/);
    expect(engine.run).not.toHaveBeenCalled();
  });

  it('stop() while the session is still starting rejects the pending start()', async () => {
    const { engine, modules } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    expect(findSceneModule(modules)).toBeDefined();
    session.stop();
    await expect(ready).rejects.toThrow(/stopped before it started/);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending start() if the engine detaches the module without starting', async () => {
    const { engine, modules } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    const sceneModule = findSceneModule(modules)!;
    expect(sceneModule.onDetach).toBeDefined();
    sceneModule.onDetach!();
    await expect(ready).rejects.toThrow(/ended before it started/);
  });

  it('settles the start() promise only once across onStart/onException/onDetach', async () => {
    const { engine, modules, sky } = makeEngine();
    const session = createEngineSession({ engine, canvas: {} });
    const ready = session.start();
    const sceneModule = findSceneModule(modules)!;
    sceneModule.onStart!();
    sceneModule.onException!(new Error('late failure'));
    sceneModule.onDetach!();
    await expect(ready).resolves.toBe(sky);
  });

  it('reports world-tracking status transitions via onTrackingStatus', () => {
    const { engine, modules } = makeEngine();
    const onTrackingStatus = vi.fn();
    createEngineSession({ engine, canvas: {}, onTrackingStatus }).start();

    const sceneModule = findSceneModule(modules)!;
    expect(sceneModule.onUpdate).toBeDefined();
    // Initialising frame: reported once.
    sceneModule.onUpdate!({ processCpuResult: { reality: { trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' } } });
    expect(onTrackingStatus).toHaveBeenNthCalledWith(1, { status: 'LIMITED', reason: 'INITIALIZING' });
    // Same status repeated: not re-reported.
    sceneModule.onUpdate!({ processCpuResult: { reality: { trackingStatus: 'LIMITED', trackingReason: 'INITIALIZING' } } });
    expect(onTrackingStatus).toHaveBeenCalledTimes(1);
    // Settled frame: reported once.
    sceneModule.onUpdate!({ processCpuResult: { reality: { trackingStatus: 'NORMAL', trackingReason: 'UNSPECIFIED' } } });
    expect(onTrackingStatus).toHaveBeenNthCalledWith(2, { status: 'NORMAL', reason: 'UNSPECIFIED' });
  });

  it('ignores onUpdate frames that carry no reality result', () => {
    const { engine, modules } = makeEngine();
    const onTrackingStatus = vi.fn();
    createEngineSession({ engine, canvas: {}, onTrackingStatus }).start();
    const sceneModule = findSceneModule(modules)!;
    sceneModule.onUpdate!({ frameStartResult: {} });
    sceneModule.onUpdate!({ processCpuResult: {} });
    expect(onTrackingStatus).not.toHaveBeenCalled();
  });
});
