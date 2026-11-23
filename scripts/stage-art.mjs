/**
 * Prepares a generated render (object on a near-black studio background) for the app's dark "stage":
 * remaps the levels so the background becomes exactly #0C0D0E (the dark theme page colour), then saves WebP.
 * Pixel coordinates are kept (optionally after a crop), so overlay anchors measured on the source stay valid.
 *
 *   node scripts/stage-art.mjs <in.png> <out.webp> [--extract x,y,w,h] [--size N]
 */
import sharp from 'sharp';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/stage-art.mjs <in.png> <out.webp> [--extract x,y,w,h] [--size N]');
  process.exit(1);
}
const arg = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : null);
const ex = arg('--extract')?.split(',').map(Number);
const size = Number(arg('--size') ?? 0);
const TARGET = [12, 13, 14];

let img = sharp(input).removeAlpha();
if (ex) img = img.extract({ left: ex[0], top: ex[1], width: ex[2], height: ex[3] });
const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h, channels: c } = info;
// background = median of a 6 px border ring, per channel
const ring = [[], [], []];
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    if (x > 5 && y > 5 && x < w - 6 && y < h - 6) continue;
    const i = (y * w + x) * c;
    for (let k = 0; k < 3; k++) ring[k].push(data[i + k]);
  }
const bg = ring.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
const a = bg.map((b, k) => (255 - TARGET[k]) / (255 - b));
const b = bg.map((bk, k) => TARGET[k] - a[k] * bk);
let out = img.linear(a, b);
if (size) out = out.resize({ width: size });
await out.webp({ quality: 88 }).toFile(output);
const m = await sharp(output).metadata();
console.log(`${output}: ${m.width}x${m.height}, background ${bg.join(',')} -> ${TARGET.join(',')}`);
