// Seed a project with two conformant design systems for ds-switch.e2e.ts (S10.14).
//
// Run with bun (the studio's DS engine and local home are bun-native): `bun fixtures/seed-ds-switch.ts`.
// It builds the studio's own switch fixture (apps/studio/test/_ds-switch-fixture.ts): system `alpha` (four display
// steps, five palette colours) and `beta` (three and two), seven canvases that follow alpha — ui/Home, ui/Pairs,
// ui/Pinned (dsPinned), ui/Blocked (an undefined name), ui/Pin and ui/combine/{One,Two} — and `acme` (private-only),
// which holds three canvases with no designSystem. Prints the project root on its last stdout line.

import { switchProject } from '../../../studio/test/_ds-switch-fixture.ts';

const p = await switchProject();
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(p.root);
process.exit(0);
