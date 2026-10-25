// usage: bun .scr/crop.mjs <in.png> <x> <y> <w> <h> <out.png> [maxW]
import { createRequire } from 'node:module';
const require = createRequire('/Users/iagh/git/personal/maude/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/package.json');
const sharp = require('sharp');
const [inp, x, y, w, h, out, maxW] = process.argv.slice(2);
let p = sharp(inp).extract({ left: +x, top: +y, width: +w, height: +h });
if (maxW) p = p.resize({ width: +maxW, withoutEnlargement: true });
await p.toFile(out);
console.log('ok', out);
