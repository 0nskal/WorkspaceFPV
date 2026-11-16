// Generuje z assets/icon.svg: assets/icon.png (512), docs/icon.png (256), assets/icon.ico (16..256).
// Rozmiary <= 32 px biora uproszczony wariant assets/icon-small.svg (grubsze linie, bez poswiaty).
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const big = await readFile('assets/icon.svg');
const small = await readFile('assets/icon-small.svg');
await mkdir('docs', { recursive: true });
const png = (size) => sharp(size <= 32 ? small : big, { density: 384 }).resize(size, size).png().toBuffer();

await writeFile('assets/icon.png', await png(512));
await writeFile('docs/icon.png', await png(256));
const sizes = [16, 24, 32, 48, 64, 128, 256];
await writeFile('assets/icon.ico', await pngToIco(await Promise.all(sizes.map(png))));
console.log('ikony gotowe');
