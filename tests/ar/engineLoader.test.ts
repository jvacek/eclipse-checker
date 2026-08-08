import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserEngineLoader,
  createEngineLoader,
  ENGINE_LOAD_TIMEOUT_MS,
  ENGINE_XR_URL,
  ENGINE_XREXTRAS_URL,
  EngineLoadError,
  type EngineLoaderDeps,
} from '../../src/ar/engineLoader';

const FAKE_ENGINE = { fake: true };

function makeDeps(overrides: Partial<EngineLoaderDeps> = {}) {
  const scripts: Array<{ url: string; attributes: Record<string, string> }> = [];
  return {
    scripts,
    deps: {
      getXR8: () => undefined,
      onXR8Loaded: () => Promise.resolve(),
      loadScript: (url: string, attributes: Record<string, string>) => {
        scripts.push({ url, attributes });
        return Promise.resolve();
      },
      ...overrides,
    } as EngineLoaderDeps,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createEngineLoader', () => {
  it('returns an already-loaded engine without injecting scripts', async () => {
    const { deps, scripts } = makeDeps({ getXR8: () => FAKE_ENGINE });
    const load = createEngineLoader(deps);
    expect(await load()).toBe(FAKE_ENGINE);
    expect(scripts).toHaveLength(0);
  });

  it('injects xrextras then the engine, waits for ready, and returns the engine', async () => {
    let xr8: unknown;
    const { deps, scripts } = makeDeps({
      getXR8: () => xr8,
      onXR8Loaded: () => {
        xr8 = FAKE_ENGINE;
        return Promise.resolve();
      },
    });
    const load = createEngineLoader(deps);
    expect(await load()).toBe(FAKE_ENGINE);
    expect(scripts.map((s) => s.url)).toEqual([ENGINE_XREXTRAS_URL, ENGINE_XR_URL]);
    expect(scripts[1].attributes).toEqual({ 'data-preload-chunks': 'slam' });
  });

  it('caches the load promise across calls', async () => {
    let xr8: unknown;
    const loadScript = vi.fn(() => Promise.resolve());
    const { deps } = makeDeps({
      getXR8: () => xr8,
      onXR8Loaded: () => {
        xr8 = FAKE_ENGINE;
        return Promise.resolve();
      },
      loadScript,
    });
    const load = createEngineLoader(deps);
    await Promise.all([load(), load()]);
    expect(loadScript).toHaveBeenCalledTimes(2);
    await load();
    expect(loadScript).toHaveBeenCalledTimes(2);
  });

  it('throws EngineLoadError when the engine never becomes available', async () => {
    const { deps } = makeDeps();
    const load = createEngineLoader(deps);
    await expect(load()).rejects.toBeInstanceOf(EngineLoadError);
  });
});

describe('createBrowserEngineLoader', () => {
  interface ScriptEl {
    src: string;
    async: boolean;
    attrs: Record<string, string>;
    setAttribute(name: string, value: string): void;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }

  function makeBrowserDom() {
    const scripts: ScriptEl[] = [];
    const listeners: Record<string, Array<() => void>> = {};
    const win = {
      XR8: undefined as unknown,
      document: {
        head: {
          appendChild: () => {
            scripts.at(-1)?.onload?.();
          },
        },
        createElement: () => {
          const el: ScriptEl = {
            src: '',
            async: false,
            attrs: {},
            setAttribute(name, value) {
              this.attrs[name] = value;
            },
            onload: null,
            onerror: null,
          };
          scripts.push(el);
          return el;
        },
        addEventListener: (type: string, cb: () => void) => {
          (listeners[type] ??= []).push(cb);
        },
        removeEventListener: () => undefined,
        querySelector: () => null,
      },
      addEventListener: (type: string, cb: () => void) => {
        (listeners[type] ??= []).push(cb);
      },
      removeEventListener: () => undefined,
    };
    return { win, scripts, listeners };
  }

  function fire(listeners: Record<string, Array<() => void>>, type: string): void {
    for (const cb of listeners[type] ?? []) {
      cb();
    }
  }

  it('injects scripts and resolves once xrloaded fires', async () => {
    const { win, scripts, listeners } = makeBrowserDom();
    const load = createBrowserEngineLoader(win);
    const promise = load();
    await Promise.resolve();
    expect(scripts.map((s) => s.src)).toEqual([ENGINE_XREXTRAS_URL, ENGINE_XR_URL]);
    expect(scripts[1].attrs).toEqual({ 'data-preload-chunks': 'slam' });
    win.XR8 = FAKE_ENGINE;
    fire(listeners, 'xrloaded');
    await expect(promise).resolves.toBe(FAKE_ENGINE);
  });

  it('rejects when xrloaded never fires within the timeout', async () => {
    vi.useFakeTimers();
    const { win } = makeBrowserDom();
    const load = createBrowserEngineLoader(win);
    const promise = load();
    const expectation = expect(promise).rejects.toBeInstanceOf(EngineLoadError);
    await vi.advanceTimersByTimeAsync(ENGINE_LOAD_TIMEOUT_MS + 1);
    await expectation;
  });
});
