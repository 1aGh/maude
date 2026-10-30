// Internal shim behind place.sh (`maude design place`). See place.sh for usage.
import path from 'node:path';
import { placeNear } from '../layout/free-space.ts';
import { loadRects, parseCommon } from './_rects-input.mjs';

const usage = (msg) => {
  process.stderr.write(
    `maude design place: ${msg}\nusage: maude design place [<canvas>] --near <id> --size WxH [--gap N] [--rects <file>] [--json]\n`
  );
  process.exit(2);
};
const a = parseCommon(process.argv.slice(2), ['--near', '--size', '--gap']);
if (a.error) usage(a.error);
if (!a.near) usage('--near <artboard or element id> is required');
const m = /^(\d{1,5})x(\d{1,5})$/.exec(a.size ?? '');
if (!m) usage('--size is WxH, e.g. 1440x900');
const gap = a.gap === undefined ? 80 : Number(a.gap);
if (!Number.isFinite(gap) || gap < 0 || gap > 10000) usage('--gap is a number of px');
const r = loadRects(a, path.dirname(new URL(import.meta.url).pathname));
if (r.error) {
  process.stderr.write(`maude design place: ${r.error}\n`);
  process.exit(r.code);
}
const spot = placeNear(r.manifest, a.near, { w: Number(m[1]), h: Number(m[2]) }, { gap });
if (!spot) {
  process.stderr.write(
    `maude design place: no artboard or element "${a.near}" in ${r.canvas} — \`maude design canvas-rects ${r.canvas}\` lists them\n`
  );
  process.exit(1);
}
process.stdout.write(
  a.json
    ? `${JSON.stringify(spot)}\n`
    : `x=${spot.x} y=${spot.y} w=${spot.w} h=${spot.h} (${spot.side} of ${spot.near})\n`
);
