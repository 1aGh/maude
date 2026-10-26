// Seed a project for ds-review.e2e.ts part 2 (S10.10, 13 · ds-edit-master): ONE converted design system `acme`
// with a Button master, FOURTEEN canvases that follow it (the review groups by folder from thirteen) — three at
// the top of ui/, five in ui/club-web and six in ui/2026/combine — and ONE change waiting: the master's Corners,
// 4 → 6 px, the way the inspector's master panel would leave it.
//
// Run with bun (the studio's DS engine and local home are bun-native): `bun fixtures/seed-ds-master.ts`. Prints the
// project root on its last stdout line. Created fresh under the OS temp dir each run.

import {
  canvasTsx,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
} from '../../../studio/test/_ds-engine-fixture.ts';
import { installRealDsCanvas, labelDsGroup } from './real-ds-canvas.ts';

const COMPONENTS = {
  schemaVersion: 1,
  system: DS,
  components: {
    Button: { class: 'btn', label: 'Tlačítko', variants: { primary: 'btn--primary' } },
  },
};

const p = await makeProject();
// the pinned system row and the real Design system canvas (bar, board) are drawn from these two — seed-ds-review.ts
labelDsGroup(p.root);
await p.outside(`${DS_PATH}/components.json`, `${JSON.stringify(COMPONENTS, null, 2)}\n`);
await p.engine.keepOutside(DS, { by: PERSON });
const add = async (folder: string, names: string[]) => {
  for (const name of names) {
    await p.outside(`${folder}/${name}.tsx`, canvasTsx(name));
    await p.outside(`${folder}/${name}.meta.json`, `${JSON.stringify({ title: name }, null, 2)}\n`);
  }
};
await add('ui/club-web', ['Web1', 'Web2', 'Web3', 'Web4', 'Web5']);
await add('ui/2026/combine', ['Letak', 'Plakat', 'Sit', 'Banner', 'Karta', 'Cedule']);
await p.engine.mergePending(DS, {
  components: { Button: { '.btn': { 'border-radius': { value: '6px' } } } },
  by: PERSON,
});
// last, after anything the engine records (see seed-ds-review.ts): the swap keeps the meta, `dsPending` included
installRealDsCanvas(p.root, 'acme');
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
