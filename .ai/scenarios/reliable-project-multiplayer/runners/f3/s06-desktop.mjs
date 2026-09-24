#!/usr/bin/env node
// S06 on a deployed backend: offline desktop edits survive an app restart,
// meet a teammate's newer changes on reconnect, and a REJECTED queued action
// is held without blocking the independent work queued behind it.
//
//   node s06-desktop.mjs --work <selfhost dir> --scratch <dir> --out <dir>
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const mk = async (base) => {
  const name = `${base}${tag}`;
  const src = canvasSource(name, `${base} title`);
  const doc = `ui-${name.toLowerCase()}`;
  const r = await B.propose('b', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }]);
  assert.equal(r.status, 200);
  return { name, doc, rel: `ui/${name}.tsx`, src };
};
const X = await mk('F3OfflineX');
const Y = await mk('F3OfflineY');
const Z = await mk('F3OfflineZ');
const accepted = async (c) => (await B.doc(c.doc, 'owner')).source;
const port = fx.port;
const proxy = await startProxy({ listen: port + 50, target: port, control: port + 51 });
const A = await startDesktop({
  root: join(scratch, `desktop-a-${tag}`),
  port: port + 60,
  hubUrl: `http://127.0.0.1:${port + 50}`,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'desktop-a',
});
const result = { tag, rounds: {} };
try {
  for (const c of [X, Y, Z])
    await until(() => A.read(c.rel) === c.src, `desktop pulled ${c.rel}`, 90000);

  // ── Round 1: offline edits + restart + a teammate's newer change ──────────
  await proxy.offline();
  const aX = X.src.replace('color: "red"', 'color: "purple"');
  const aY = Y.src.replace('Y title<', 'Y title edited offline<');
  A.write(X.rel, aX);
  A.write(Y.rel, aY);
  await new Promise((r) => setTimeout(r, 1500));
  await A.kill(); // the app dies with its queue unsent
  const bX = X.src.replaceAll('F3OfflineX title', 'Teammate title');
  const peer = await B.propose('b', [{ op: 'lane.replace', doc: X.doc, lane: 'html', base: sha(X.src), content: bX }]);
  assert.equal(peer.status, 200, 'teammate edit accepted while A is offline');
  await A.restart(); // still offline: the durable queue must survive this
  await new Promise((r) => setTimeout(r, 1500));
  const stillOffline = { x: A.read(X.rel), y: A.read(Y.rel) };
  await proxy.online();
  const merged = await until(
    async () => {
      const x = await accepted(X);
      const y = await accepted(Y);
      return x.includes('purple') && x.includes('Teammate title') && y.includes('edited offline') ? { x, y } : null;
    },
    'offline edits reconciled with the teammate change',
    120000
  );
  await until(() => A.read(X.rel) === merged.x, 'desktop shows the merged X', 60000);
  const hist = await B.history('owner', 60);
  result.rounds.offlineRestart = {
    localEditsKeptWhileOffline: stillOffline.x === aX && stillOffline.y === aY,
    bothChangesInX: true,
    offlineYAccepted: true,
    desktopConverged: A.read(X.rel) === merged.x && A.read(Y.rel) === merged.y,
    offlineActionsBy: [
      ...new Set(
        hist
          .filter((h) => h.effects?.some((e) => [X.doc, Y.doc].includes(e.doc)) && h.revision > peer.body.revision)
          .map((h) => h.actor)
      ),
    ],
  };

  // ── Round 2: a rejected action first, independent work behind it ─────────
  await proxy.offline();
  const beforeX = await accepted(X);
  const invalid = `${A.read(X.rel).replace('</h1>', '</h2>')}`; // does not parse
  const zEdit = Z.src.replace('Z title<', 'Z title after a rejected action<');
  A.write(X.rel, invalid);
  await new Promise((r) => setTimeout(r, 700));
  A.write(Z.rel, zEdit);
  await new Promise((r) => setTimeout(r, 1500));
  await proxy.online();
  await until(async () => (await accepted(Z)).includes('after a rejected action'), 'Z accepted behind a rejected X', 120000);
  await new Promise((r) => setTimeout(r, 3000));
  const status = await A.status();
  result.rounds.rejectedFirst = {
    acceptedXUnchanged: (await accepted(X)) === beforeX,
    invalidDraftKeptLocally: A.read(X.rel) === invalid,
    independentZAccepted: true,
    desktopToldAboutX: (status?.conflicts ?? []).some(
      (c) => c.slug === X.doc && c.kind === 'body-rejected' && c.reason === 'invalid-source'
    ),
  };
  writeFileSync(join(out, 'desktop-a-sync-status.json'), JSON.stringify(status, null, 2));
} finally {
  writeFileSync(join(out, 'desktop-a.log'), A.log.replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
  await A.stop();
  proxy.stop();
}
const r1 = result.rounds.offlineRestart;
const r2 = result.rounds.rejectedFirst;
result.status =
  r1?.localEditsKeptWhileOffline &&
  r1?.desktopConverged &&
  r1?.offlineActionsBy.length === 1 &&
  r1.offlineActionsBy[0] === fx.users.a.email &&
  r2?.acceptedXUnchanged &&
  r2?.invalidDraftKeptLocally &&
  r2?.desktopToldAboutX
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's06-desktop.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
