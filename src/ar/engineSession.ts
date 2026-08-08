export interface EngineSceneLike {
  scene: unknown;
  camera: unknown;
}

export interface EngineThreejsApi {
  pipelineModule(): unknown;
  xrScene(): EngineSceneLike & { renderer?: unknown };
}

export interface EngineGlTextureRendererApi {
  pipelineModule(): unknown;
}

export interface EngineXrControllerApi {
  pipelineModule(): unknown;
}

export interface EngineApiLike {
  addCameraPipelineModules(modules: unknown[]): void;
  clearCameraPipelineModules(): void;
  run(config: { canvas: unknown }): void;
  stop(): void;
  Threejs: EngineThreejsApi;
  GlTextureRenderer: EngineGlTextureRendererApi;
  XrController: EngineXrControllerApi;
}

export interface EngineSessionOptions {
  engine: EngineApiLike;
  canvas: unknown;
  /** Extra camera pipeline modules, e.g. XRExtras helpers. */
  extraModules?: unknown[];
}

export interface EngineSessionApi {
  /** Starts the engine camera pipeline; resolves with the main scene. */
  start(): Promise<EngineSceneLike>;
  /** Tears the engine down (camera, tracking, modules). */
  stop(): void;
}

const SCENE_MODULE_NAME = 'eclipse-checker-overlay';

/**
 * Wraps the self-hosted 8th Wall engine's three.js pipeline for the eclipse AR
 * overlay: installs the camera feed, three.js scene and SLAM modules, and
 * surfaces the engine-owned *main reality scene* that the overlay is drawn
 * into. Content there renders over the full camera feed, so buildings, trees
 * and other occluders show through where the eclipse would be hidden.
 *
 * The engine API is injected so this module is unit-testable without a browser.
 */
export function createEngineSession(options: EngineSessionOptions): EngineSessionApi {
  const { engine, canvas } = options;

  let resolveScene: ((scene: EngineSceneLike) => void) | null = null;
  let rejectScene: ((reason: Error) => void) | null = null;
  const sceneReady = new Promise<EngineSceneLike>((resolve, reject) => {
    resolveScene = resolve;
    rejectScene = reject;
  });

  const sceneModule = {
    name: SCENE_MODULE_NAME,
    onStart: () => {
      const xrScene = engine.Threejs.xrScene();
      if (xrScene.scene === undefined) {
        rejectScene?.(new Error('the 8th Wall engine did not create a scene'));
        return;
      }
      resolveScene?.(xrScene);
    },
    onException: (error: unknown) => {
      // The engine routes session failures (e.g. no usable session manager) to
      // every pipeline module's `onException` hook; surface them so start()
      // rejects promptly instead of hanging until a timeout.
      rejectScene?.(error instanceof Error ? error : new Error(String(error)));
    },
  };

  function start(): Promise<EngineSceneLike> {
    engine.addCameraPipelineModules([
      engine.GlTextureRenderer.pipelineModule(),
      engine.Threejs.pipelineModule(),
      engine.XrController.pipelineModule(),
      ...(options.extraModules ?? []),
      sceneModule,
    ]);
    engine.run({ canvas });
    return sceneReady;
  }

  function stop(): void {
    engine.stop();
    engine.clearCameraPipelineModules();
  }

  return { start, stop };
}
