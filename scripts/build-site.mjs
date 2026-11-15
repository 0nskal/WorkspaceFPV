// Kopiuje zbudowaną appkę (dist/) do site/app/, żeby wdrożyć ją razem ze stroną (Cloudflare Pages).
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist');
const dest = resolve(root, 'site', 'app');

if (!existsSync(src)) {
  console.error('Brak dist/. Najpierw uruchom: npm run build');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Skopiowano ${src} -> ${dest}`);
