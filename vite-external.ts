import type { IncomingMessage, ServerResponse } from 'node:http';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';

const MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.tflite': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

const rootDir = fileURLToPath(new URL('.', import.meta.url));

interface ExternalSource {
  urlPrefix: string;
  diskPath: string;
}

const sources: ExternalSource[] = [
  {
    urlPrefix: '/external/xr',
    diskPath: resolve(rootDir, 'node_modules/@8thwall/engine-binary/dist'),
  },
  {
    urlPrefix: '/external/xrextras',
    diskPath: resolve(rootDir, 'node_modules/@8thwall/xrextras/dist'),
  },
];

function tryServeFile(reqUrl: string | undefined): {
  filePath: string;
  mimeType: string;
} | null {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent((reqUrl ?? '').split('?')[0]);
  } catch {
    // Malformed percent-encoding (e.g. a stray % in the path) would throw and
    // 500 the request; treat it as not-served so the app falls back gracefully.
    return null;
  }
  for (const source of sources) {
    if (!urlPath.startsWith(source.urlPrefix)) continue;
    const subPath = normalize('.' + urlPath.slice(source.urlPrefix.length));
    const filePath = join(source.diskPath, subPath);
    if (!filePath.startsWith(source.diskPath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      continue;
    }
    return { filePath, mimeType: MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' };
  }
  return null;
}

/**
 * Serves the 8th Wall engine + xrextras from local `node_modules` during dev
 * and copies them into the build output (`dist/external/`) so the self-hosted
 * engine is never fetched from a third-party CDN at runtime.
 */
export function externalAssets(): Plugin {
  let outDir = 'dist';

  return {
    name: 'eclipse-checker:external-assets',

    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir;
    },

    configureServer(server) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stack = server.middlewares.stack as any[];
      stack.unshift({
        route: '',
        handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }
          const result = tryServeFile(req.url);
          if (!result) {
            next();
            return;
          }
          res.setHeader('Content-Type', result.mimeType);
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(result.filePath).pipe(res);
        },
      });
    },

    closeBundle() {
      const targetDir = join(process.cwd(), outDir, 'external');
      for (const source of sources) {
        const dest = join(targetDir, source.urlPrefix.replace('/external/', ''));
        cpSync(source.diskPath, dest, { recursive: true, force: true });
      }
    },
  };
}
