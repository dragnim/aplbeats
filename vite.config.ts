import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The site is served from https://dragnim.github.io/aplbeats/, so every asset
// URL must be prefixed. VITE_BASE lets the Pages workflow — or a custom domain —
// override this without touching the config.
const base = process.env.VITE_BASE ?? '/aplbeats/';

const auditionRoot = fileURLToPath(new URL('./.audition', import.meta.url));

/**
 * Serve the Jupiter-4 audition bench's audio, in dev and nowhere else.
 *
 * The audition candidates are eighty megabytes of temporary WAVs that must never reach a build, so
 * they live in `.audition/` — outside `public/`, gitignored, and reachable only through this. That
 * is a stronger guarantee than remembering to delete them: `apply: 'serve'` means the plugin does
 * not exist during `vite build`, and nothing outside `public/` is copied into `dist` anyway.
 *
 * Two URL spaces are served: `/audio/audition/…` for the prepared WAVs, and `/audition-manifest.json`
 * for the candidate list the bench reads. Both are resolved inside `.audition/` and refuse to
 * escape it.
 */
function auditionAssets(): Plugin {
  const send = (response: ServerResponse, path: string): boolean => {
    // Resolved and checked, so a `..` in a URL cannot read outside the audition directory.
    const full = resolve(join(auditionRoot, normalize(path)));
    if (!full.startsWith(auditionRoot) || !existsSync(full) || !statSync(full).isFile()) return false;

    const type = extname(full) === '.json' ? 'application/json' : 'audio/wav';
    response.setHeader('Content-Type', type);
    response.setHeader('Content-Length', String(statSync(full).size));
    // Temporary files that change whenever they are rebuilt. Never cache them.
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(full).pipe(response);
    return true;
  };

  return {
    name: 'aplbeats-audition-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = decodeURIComponent((request.url ?? '').split('?')[0] ?? '');
        const path = url.startsWith(base) ? url.slice(base.length - 1) : url;

        if (path.startsWith('/audio/audition/')) {
          if (send(response, join('audio', path.slice('/audio/audition/'.length)))) return;
        }
        if (path === '/audition-manifest.json') {
          if (send(response, 'candidates.json')) return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), auditionAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    /*
     * One entry point, and `audition.html` is deliberately not it.
     *
     * Vite builds `index.html` unless told otherwise, so the audition page is a dev-server page by
     * construction rather than by an exclusion somebody has to remember. `npm run build` produces
     * exactly what it always produced.
     */
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
});
