// Buduje proces glowny i preload Electrona do dist-electron/*.cjs (esbuild).
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // electron-updater zostaje zewnetrzny: electron-builder dokleja go z node_modules (dependencies) do app.asar.
  external: ['electron', 'electron-updater'],
  sourcemap: false,
  logLevel: 'info',
});
