export const ENGINE_XREXTRAS_URL = '/external/xrextras/xrextras.js';
export const ENGINE_XR_URL = '/external/xr/xr.js';

export class EngineLoadError extends Error {
  constructor(reason: string) {
    super(`8th Wall engine failed to load: ${reason}`);
    this.name = 'EngineLoadError';
  }
}

export interface EngineLoaderDeps {
  /** Returns the current value of `window.XR8` (or a test double). */
  getXR8(): unknown;
  /** Resolves once the engine has signalled it is ready (`xrloaded`). */
  onXR8Loaded(timeoutMs: number): Promise<void>;
  /** Injects a `<script>` and resolves when it has executed. */
  loadScript(url: string, attributes: Record<string, string>): Promise<void>;
  timeoutMs?: number;
}

export const ENGINE_LOAD_TIMEOUT_MS = 20_000;

/**
 * Lazily loads the self-hosted 8th Wall engine on first AR entry. The engine
 * scripts are only fetched once; subsequent calls return the cached promise.
 */
export function createEngineLoader(deps: EngineLoaderDeps): () => Promise<unknown> {
  let cached: Promise<unknown> | null = null;
  return () => {
    if (cached !== null) {
      return cached;
    }
    cached = loadEngineOnce(deps);
    return cached;
  };
}

async function loadEngineOnce(deps: EngineLoaderDeps): Promise<unknown> {
  const existing = deps.getXR8();
  if (existing !== undefined) {
    return existing;
  }
  const timeoutMs = deps.timeoutMs ?? ENGINE_LOAD_TIMEOUT_MS;
  await deps.loadScript(ENGINE_XREXTRAS_URL, {});
  await deps.loadScript(ENGINE_XR_URL, { 'data-preload-chunks': 'slam' });
  await deps.onXR8Loaded(timeoutMs);
  const engine = deps.getXR8();
  if (engine === undefined) {
    throw new EngineLoadError('window.XR8 was not defined after load');
  }
  return engine;
}

export interface BrowserDom {
  head: { appendChild(el: unknown): void };
  createElement(tag: string): {
    async: boolean;
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    setAttribute(name: string, value: string): void;
  };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  querySelector(selector: string): unknown;
}

export interface EngineWindowLike {
  XR8?: unknown;
  document: BrowserDom;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Browser-flavoured loader: injects the xrextras + engine `<script>` tags and
 * waits for the engine's `xrloaded` event. Safe to call repeatedly; the engine
 * is only ever loaded once.
 */
export function createBrowserEngineLoader(
  win: EngineWindowLike = window as unknown as EngineWindowLike,
): () => Promise<unknown> {
  const doc = win.document;
  return createEngineLoader({
    getXR8: () => win.XR8,
    onXR8Loaded: (timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        if (win.XR8 !== undefined) {
          resolve();
          return;
        }
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new EngineLoadError('xrload failed'));
        };
        const cleanup = () => {
          clearTimeout(timer);
          win.removeEventListener?.('xrloaded', onLoaded);
          win.removeEventListener?.('xrload', onError);
          doc.removeEventListener('xrloaded', onLoaded);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new EngineLoadError(`timed out after ${timeoutMs} ms waiting for xrloaded`));
        }, timeoutMs);
        win.addEventListener?.('xrloaded', onLoaded);
        win.addEventListener?.('xrload', onError);
        doc.addEventListener('xrloaded', onLoaded);
      }),
    loadScript: (url, attributes) =>
      new Promise<void>((resolve, reject) => {
        if (doc.querySelector(`script[src="${url}"]`) !== null) {
          resolve();
          return;
        }
        const el = doc.createElement('script');
        el.async = true;
        el.src = url;
        for (const [key, value] of Object.entries(attributes)) {
          el.setAttribute(key, value);
        }
        el.onload = () => resolve();
        el.onerror = () => reject(new EngineLoadError(`could not load ${url}`));
        doc.head.appendChild(el);
      }),
  });
}
