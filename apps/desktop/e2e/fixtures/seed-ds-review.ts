// Seed a project with ONE converted design system for ds-review.e2e.ts (S10.8).
//
// Run with bun (the studio's DS engine and local home are bun-native): `bun fixtures/seed-ds-review.ts`.
// It builds the same scratch project the studio's own DS tests use (apps/studio/test/_ds-engine-fixture.ts:
// system `acme` converted, head = base = R0, three canvases ui/Home · ui/Landing · ui/Pricing that follow it,
// and the Design system canvas), then leaves ONE change waiting — Accent, Light and Dark — the way the DS
// canvas's token editor would. Prints the project root on its last stdout line. Created fresh under the OS
// temp dir each run; the e2e config boots the app into it.

import { ACCENT, DS, makeProject, PERSON } from '../../../studio/test/_ds-engine-fixture.ts';

const p = await makeProject();
await p.engine.mergePending(DS, {
  tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
  by: PERSON,
});
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
