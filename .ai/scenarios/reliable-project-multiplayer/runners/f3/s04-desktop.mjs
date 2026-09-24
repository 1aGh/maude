#!/usr/bin/env node
// S04 on a deployed backend: an invalid draft U1 is held, the app dies, the
// person repairs it (U2) while a teammate changes the same canvas, the app
// comes back. Oracle: the project, every historical revision and the peer
// never hold U1; the repair lands on top of the teammate's change; U1's bytes
// and the version it started from are still recoverable on this device.
//
//   node s04-desktop.mjs --work <selfhost dir> --scratch <dir> --out <dir>
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasSource, loadBackend } from './backend.mjs';
import { startDesktop, startProxy, until } from './desktop.mjs';

const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const scratch = arg('scratch');
const out = arg('out');
mkdirSync(scratch, { recursive: true });
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const tag = randomBytes(3).toString('hex');
const B = await loadBackend('selfhost', { work });
const name = `F3Repair${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const rel = `ui/${name}.tsx`;
const base = canvasSource(name, 'Base title');
assert.equal((await B.propose('b', [{ op: 'doc.create', doc, path: rel, lanes: { html: base } }])).status, 200);
const created = (await B.bootstrap('owner')).revision;
const port = fx.port;
const proxy = await startProxy({ listen: port + 70, target: port, control: port + 71 });
const A = await startDesktop({
  root: join(scratch, `desktop-repair-${tag}`),
  port: port + 80,
  hubUrl: `http://127.0.0.1:${port + 70}`,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'desktop-repair',
});
const U1 = base.replace('Base title</h1>', `Unfinished draft ${tag}`); // no closing tag
const U2 = base.replaceAll('Base title', `Repaired draft ${tag}`);
const candidateFile = join(A.design, '_history', doc, 'sync-recovery', 'candidate.tsx.json');
const result = { doc, tag };
try {
  await until(() => A.read(rel) === base, 'desktop pulled the canvas', 90000);
  A.write(rel, U1);
  const held = await until(
    async () => ((await A.status())?.conflicts ?? []).find((c) => c.slug === doc && c.kind === 'body-rejected'),
    'U1 held as a rejected candidate',
    60000
  );
  result.u1Held = { reason: held.reason };
  await A.kill();
  // Repair while the app is down; a teammate changes colour meanwhile.
  A.write(rel, U2);
  const peer = await B.propose('b', [
    { op: 'lane.replace', doc, lane: 'html', base: sha(base), content: base.replace('color: "red"', 'color: "teal"') },
  ]);
  assert.equal(peer.status, 200);
  await A.restart();
  const accepted = await until(
    async () => {
      const s = (await B.doc(doc, 'owner')).source;
      return s.includes(`Repaired draft ${tag}`) && s.includes('teal') ? s : null;
    },
    'the repair rebased onto the teammate change',
    120000
  );
  await until(() => A.read(rel) === accepted, 'desktop converged', 60000);
  // U1 must appear nowhere in the project's history.
  const head = (await B.bootstrap('owner')).revision;
  const u1Seen = [];
  for (let rev = created; rev <= head; rev++) {
    const lane = await B.api('owner', `lane?doc=${doc}&lane=html&rev=${rev}`);
    if (lane.status === 200 && lane.body.body?.includes(`Unfinished draft ${tag}`)) u1Seen.push(rev);
  }
  const candidate = existsSync(candidateFile) ? JSON.parse(readFileSync(candidateFile, 'utf8')) : null;
  const statusAfter = await A.status();
  result.after = {
    acceptedHasRepairAndTeammate: true,
    acceptedHash: sha(accepted),
    revisionsChecked: head - created + 1,
    u1InAnyRevision: u1Seen,
    originalU1Recoverable: candidate?.original === U1,
    startingVersionRecoverable: candidate?.base === base,
    candidateMarkedResolved: candidate?.resolved ?? null,
    conflictClearedAfterRepair: !((statusAfter?.conflicts ?? []).some((c) => c.slug === doc)),
  };
  writeFileSync(join(out, 'desktop-sync-status.json'), JSON.stringify(statusAfter, null, 2));
} finally {
  writeFileSync(join(out, 'desktop.log'), A.log.replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
  await A.stop();
  proxy.stop();
}
const a = result.after;
result.status =
  result.u1Held &&
  a &&
  a.u1InAnyRevision.length === 0 &&
  a.originalU1Recoverable &&
  a.startingVersionRecoverable &&
  a.conflictClearedAfterRepair
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's04-desktop.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
