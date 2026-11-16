import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

// Aplikacja zyje w app/, build trafia do dist/ (base './' = dziala tez pod /app/ i z file:// w Electronie).
export default defineConfig({
  root: resolve(import.meta.dirname, 'app'),
  base: './',
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
});
