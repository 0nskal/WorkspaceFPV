// Runs every node test of the project: bundles each test file with esbuild and executes it.
// Usage: npm test
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/^test.*\.mjs$/.test(name)) yield p;
  }
}

const out = mkdtempSync(join(tmpdir(), 'wfpv-tests-'));
const files = [...walk('app/src')].sort();
let failed = 0;
for (const [i, file] of files.entries()) {
  const outfile = join(out, `t${i}.mjs`);
  await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}`);
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
