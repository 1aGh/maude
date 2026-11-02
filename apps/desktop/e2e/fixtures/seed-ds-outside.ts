// Seed a project with ONE converted design system and NOTHING waiting, for ds-review-outside.e2e.ts (S10.11).
//
// Run with bun: `bun fixtures/seed-ds-outside.ts`. Same scratch project as seed-ds-review.ts (system `acme`
// converted, head = base = R0, three canvases that follow it, the Design system canvas) — but no change is
// waiting: the scenario itself edits colors_and_type.css from outside the app, the way Claude Code would, and
// watches the review arrive. Prints the project root on its last stdout line.

import { makeProject } from '../../../studio/test/_ds-engine-fixture.ts';
import { installRealDsCanvas, labelDsGroup } from './real-ds-canvas.ts';

const p = await makeProject();
labelDsGroup(p.root);
// last, after anything the engine records: the swap is a plain disk write, and the engine's own proposals
// (a waiting change is a `dsPending` entry in the canvas meta) are written through the kernel — the meta kept here
// is read AFTER them, so the disk copy the server finds at boot already holds the pending change
installRealDsCanvas(p.root, 'acme');
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
