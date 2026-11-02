// Seed a project that LINKS a team library, for ds-library.e2e.ts (S10.18c).
//
// Run with bun: `bun fixtures/seed-ds-library.ts`. It starts the stand-in hub (fixtures/ds-library-hub.ts, loopback,
// self-exiting), links `gator` from it at V1 with this Mac's grant kept in a scratch grants file, moves the hub on to
// V2 — so the app, opening the project, finds the library ahead and the card says "2 updates waiting" — and puts two
// canvases on the system. Prints, on its LAST two stdout lines, the grants file and the project root:
//
//   <grants file>
//   <project root>
//
// The app must be started with MAUDE_DS_LIBRARY_GRANTS_PATH=<grants file> (the wdio config does) or it holds no
// grant — which is the OTHER scenario (a peer sees the card and who can update it).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDsLibrary, fileGrantStore } from '../../../studio/ds/library.ts';
import { makeProject, PERSON } from '../../../studio/test/_ds-engine-fixture.ts';
import { GRANT, LIB, PROJECT } from './ds-library-hub.ts';
import { labelDsGroup } from './real-ds-canvas.ts';

const hubProc = Bun.spawn(['bun', join(import.meta.dir, 'ds-library-hub.ts')], {
  stdout: 'pipe',
  stderr: 'ignore',
  stdin: 'ignore',
});
const reader = hubProc.stdout.getReader();
const first = await reader.read();
const port = Number(new TextDecoder().decode(first.value).trim());
if (!Number.isInteger(port) || port < 1) throw new Error('the stand-in hub did not start');
hubProc.unref();
const hub = `http://127.0.0.1:${port}`;

const p = await makeProject();
labelDsGroup(p.root);
const grantsFile = join(mkdtempSync(join(tmpdir(), 'maude-e2e-grants-')), 'ds-library-grants.json');
const lib = createDsLibrary(p.engine, { grants: fileGrantStore(grantsFile) });
await lib.link({ url: `${hub}/api/projects/${PROJECT}/v1/ds/${LIB}`, grant: GRANT, by: PERSON });
for (const c of ['Home', 'Landing'])
  await p.outside(
    `ui/${c}.meta.json`,
    `${JSON.stringify({ title: c, designSystem: LIB }, null, 2)}\n`
  );
await fetch(`${hub}/_flip`); // the library moved on after it was linked
// the app opens its own home on this project; ours must not hold the database
p.home.close();
console.log(grantsFile);
console.log(p.root);
process.exit(0);
