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
  /** Static config; `disableWorldTracking` must be called before `run()`. */
  configure(config: { disableWorldTracking?: boolean }): unknown;
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

export interface EngineTrackingStatus {
  /** `'LIMITED'` (tracking uninitialized/lost) or `'NORMAL'` (settled). */
  status: string;
  /** `'INITIALIZING'`, `'UNSPECIFIED'`, or engine-specific extras. */
  reason: string;
}

export interface EngineSessionOptions {
  engine: EngineApiLike;
  canvas: unknown;
  /** Extra camera pipeline modules, e.g. XRExtras helpers. */
  extraModules?: unknown[];
  /** Fired whenever the engine's world-tracking status changes (once settled, re-anchors). */
  onTrackingStatus?: (tracking: EngineTrackingStatus) => void;
}

export interface EngineSessionApi {
  /** Starts the engine camera pipeline; resolves with the main scene. */
  start(): Promise<EngineSceneLike>;
  /** Tears the engine down (camera, tracking, modules). */
  stop(): void;
}

const SCENE_MODULE_NAME = 'eclipse-checker-overlay';

type SessionState = 'idle' | 'starting' | 'started' | 'stopped';

/**
 * Wraps the self-hosted 8th Wall engine's three.js pipeline for the eclipse AR
 * overlay: installs the camera feed, three.js scene and SLAM modules, and
 * surfaces the engine-owned *main reality scene* that the overlay is drawn
 * into. Content there renders over the full camera feed, so buildings, trees
 * and other occluders show through where the eclipse would be hidden.
 *
 * The engine API is injected so this module is unit-testable without a browser.
 *
 * Lifecycle is a strict `idle → starting → started → stopped` state machine:
 * - `start()` rejects if the session was already started or stopped (the 8th
 *   Wall engine is not safe to `run()` twice in one page).
 * - `stop()` is idempotent — safe to call from an exit handler *and* React's
 *   effect cleanup, and it rejects a still-pending `start()` instead of leaving
 *   it to hang until the caller's timeout.
 * - The pending `start()` also settles promptly when the engine detaches the
 *   module without starting (engine `stop()` from outside, session failure).
 */
export function createEngineSession(options: EngineSessionOptions): EngineSessionApi {
  const { engine, canvas } = options;

  let state: SessionState = 'idle';
  let settled = false;
  let lastTrackingStatus: EngineTrackingStatus | null = null;
  let resolveScene: ((scene: EngineSceneLike) => void) | null = null;
  let rejectScene: ((reason: Error) => void) | null = null;
  const sceneReady = new Promise<EngineSceneLike>((resolve, reject) => {
    resolveScene = resolve;
    rejectScene = reject;
  });

  const settleResolve = (scene: EngineSceneLike): void => {
    if (settled) {
      return;
    }
    settled = true;
    resolveScene?.(scene);
  };

  const settleReject = (reason: Error): void => {
    if (settled) {
      return;
    }
    settled = true;
    rejectScene?.(reason);
  };

  const sceneModule = {
    name: SCENE_MODULE_NAME,
    onStart: () => {
      const xrScene = engine.Threejs.xrScene();
      if (xrScene.scene === undefined) {
        settleReject(new Error('the 8th Wall engine did not create a scene'));
        return;
      }
      state = 'started';
      settleResolve(xrScene);
    },
    onException: (error: unknown) => {
      // The engine routes session failures (e.g. no usable session manager) to
      // every pipeline module's `onException` hook; surface them so start()
      // rejects promptly instead of hanging until a timeout.
      settleReject(error instanceof Error ? error : new Error(String(error)));
    },
    onDetach: () => {
      // Fired when the engine stops or the module is removed. If the session
      // never reached `onStart` (engine stopped out from under us), reject the
      // pending start() instead of letting it hang.
      if (!settled) {
        settleReject(new Error('the AR session ended before it started'));
      }
    },
    onUpdate: (result: unknown) => {
      // The engine's XrController exposes its world-tracking state as
      // `processCpuResult.reality`; surface status transitions so the caller
      // can (re-)anchor compass north only against a settled world frame.
      const reality = (result as { processCpuResult?: { reality?: unknown } }).processCpuResult
        ?.reality;
      if (typeof reality !== 'object' || reality === null) {
        return;
      }
      const { trackingStatus, trackingReason } = reality as {
        trackingStatus?: unknown;
        trackingReason?: unknown;
      };
      if (typeof trackingStatus !== 'string') {
        return;
      }
      const next: EngineTrackingStatus = {
        status: trackingStatus,
        reason: typeof trackingReason === 'string' ? trackingReason : 'UNSPECIFIED',
      };
      if (
        lastTrackingStatus === null ||
        lastTrackingStatus.status !== next.status ||
        lastTrackingStatus.reason !== next.reason
      ) {
        lastTrackingStatus = next;
        options.onTrackingStatus?.(next);
      }
    },
  };

  function start(): Promise<EngineSceneLike> {
    if (state !== 'idle') {
      return Promise.reject(
        new Error(`cannot start the AR session: state is "${state}" (started or stopped)`),
      );
    }
    state = 'starting';
    engine.addCameraPipelineModules([
      engine.GlTextureRenderer.pipelineModule(),
      engine.Threejs.pipelineModule(),
      engine.XrController.pipelineModule(),
      ...(options.extraModules ?? []),
      sceneModule,
    ]);
    // Disable SLAM so the camera tracks rotation only (via the IMU/compass) and
    // stays at the world origin. The eclipse position is a direction from the
    // phone — it must not be a room you can walk through, which fixed world
    // anchoring would allow. Must be set before `run()`.
    engine.XrController.configure({ disableWorldTracking: true });
    engine.run({ canvas });
    return sceneReady;
  }

  function stop(): void {
    if (state === 'stopped') {
      return;
    }
    if (state === 'starting') {
      settleReject(new Error('the AR session was stopped before it started'));
    }
    state = 'stopped';
    engine.stop();
    engine.clearCameraPipelineModules();
  }

  return { start, stop };
}
