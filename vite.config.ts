/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// `base` relativo ('./') funciona en cualquier subruta (p. ej. GitHub Pages en
// https://usuario.github.io/<repo>/) sin tener que conocer el nombre del repo.
// Se puede forzar con la variable de entorno BASE_PATH (p. ej. "/rebuilt-sim/").
const base = process.env.BASE_PATH ?? './';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

function listPublic(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listPublic(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/**
 * Plugin mínimo de PWA: genera `sw.js` con la lista de todos los archivos del
 * build para precache (offline completo). Evita depender de Workbox.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'rebuilt-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = new Set<string>(['./', 'index.html']);
      for (const f of Object.keys(bundle)) files.add(f);
      for (const f of listPublic('public')) if (f !== 'sw.js') files.add(f);
      const template = readFileSync('src/pwa/sw-template.js', 'utf8');
      const version = `${pkg.version}-${Date.now().toString(36)}`;
      const source = template
        .replace('__CACHE_VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify([...files].sort(), null, 0));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  server: { host: true },
  preview: { host: true },
  plugins: [serviceWorkerPlugin()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
