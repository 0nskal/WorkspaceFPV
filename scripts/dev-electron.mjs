// Tryb deweloperski Electrona: Vite dev server + okno Electrona wskazujace na niego.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning',
});

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log('Vite:', url);

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, WORKSPACEFPV_DEV_URL: url } });
child.on('exit', async () => { await server.close(); process.exit(0); });
