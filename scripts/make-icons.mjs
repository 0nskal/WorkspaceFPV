// Builds every icon from assets/icon-source.png (1024 px, the WorkspaceFPV logo):
// assets/icon.png (512), assets/icon.ico (16..256), docs/icon.png (256),
// app/src/ui/logo.png (96, in-app top bar), site/favicon.png (64), site/apple-touch-icon.png (180).
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile } from 'node:fs/promises';

const src = await readFile('assets/icon-source.png');
const png = (size) =>
  sharp(src)
    .resize(size, size, { kernel: 'lanczos3' })
    .sharpen(size <= 64 ? { sigma: 0.6 } : undefined)
    .png({ compressionLevel: 9 })
    .toBuffer();

await writeFile('assets/icon.png', await png(512));
await writeFile('docs/icon.png', await png(256));
await writeFile('app/src/ui/logo.png', await png(96));
await writeFile('site/favicon.png', await png(64));
await writeFile('site/apple-touch-icon.png', await png(180));
const sizes = [16, 24, 32, 48, 64, 128, 256];
await writeFile('assets/icon.ico', await pngToIco(await Promise.all(sizes.map(png))));
console.log('icons ready');
