// Generuje assets/icon.png (512), assets/icon.ico i docs/icon.png z assets/icon.svg.
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const svg = await readFile('assets/icon.svg');
await mkdir('docs', { recursive: true });
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

const p512 = await png(512);
await writeFile('assets/icon.png', p512);
await writeFile('docs/icon.png', p512);
const sizes = [16, 24, 32, 48, 64, 128, 256];
await writeFile('assets/icon.ico', await pngToIco(await Promise.all(sizes.map(png))));
console.log('ikony gotowe');
