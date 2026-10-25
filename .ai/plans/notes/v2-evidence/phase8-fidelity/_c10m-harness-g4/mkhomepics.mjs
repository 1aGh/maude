// node mkhomepics.mjs  → .scr/home-pics/<name>.jpg for seed-home.ts (480x360 vertical gradients, like `magick gradient:A-B`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, REPO } from './lib.mjs';
import { makeImages } from './img.mjs';

const src = readFileSync(join(HERE, 'seed-home.ts'), 'utf8');
const list = [];
for (const m of src.matchAll(/canvases: \{([^}]*)\}, c: \['(#[0-9a-f]+)', '(#[0-9a-f]+)'\]/g)) {
  for (const v of m[1].matchAll(/: '([^']+)'/g)) {
    list.push({ path: join(REPO, '.scr/home-pics', v[1].replace(/\W+/g, '') + '.jpg'), w: 480, h: 360, kind: 'gradient', bg: m[2], fg: m[3] });
  }
}
await makeImages(list);
console.log('home pics', list.length);
