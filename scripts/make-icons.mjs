// Builds every icon from the drone render (app/src/assets/img/drone-top.webp) on a dark rounded square,
// saved as assets/icon-source.png (1024 px), then:
// assets/icon.png (512), assets/icon.ico (16..256), docs/icon.png (256),
// app/src/ui/logo.png (96, in-app top bar), site/favicon.png (64), site/apple-touch-icon.png (180).
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile } from 'node:fs/promises';

// rounded square (macOS-like proportions) with a soft top light, the quad filling most of it
const tile = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><radialGradient id="g" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#23282c"/><stop offset="1" stop-color="#0c0d0e"/></radialGradient></defs><rect x="40" y="40" width="944" height="944" rx="228" fill="url(#g)"/><rect x="42" y="42" width="940" height="940" rx="226" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="4"/></svg>`,
);
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="40" y="40" width="944" height="944" rx="228"/></svg>`);
// the render's own background is levelled to #0C0D0E; a radial fade blends it into the tile
const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 980"><defs><radialGradient id="f"><stop offset=".78" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="980" height="980" fill="url(#f)"/></svg>`);
const quad = await sharp('app/src/assets/img/drone-top.webp').resize(980, 980).ensureAlpha().composite([{ input: fade, blend: 'dest-in' }]).png().toBuffer();
await sharp(tile)
  .resize(1024, 1024)
  .composite([{ input: quad, left: 22, top: 26 }, { input: mask, blend: 'dest-in' }])
  .png({ compressionLevel: 9 })
  .toFile('assets/icon-source.png');
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
