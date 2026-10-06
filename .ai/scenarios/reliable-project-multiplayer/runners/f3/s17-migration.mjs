#!/usr/bin/env node
// S17 on a deployed backend: a legacy project moves onto accepted revisions
// the way the operator runbook does it (docs/operations/project-multiplayer-
// rollout.md) — dry run, switch (interrupted by a SIGKILL of the hub), parity,
// rollback before and after a new accepted write, and forward again. Around
// it: a desktop whose edit is still pending (offline) during the switch, and a
// stale legacy socket that stays open across the epoch flip.
// Oracle: never two writers (the stale socket cannot write while accepted; an
// accepted proposal is refused while legacy), bytes/history/pending work are
// conserved in both directions, a double-submitted switch cannot advance a
// second epoch.
//
//   node s17-migration.mjs --work <fresh legacy selfhost dir> --scratch <dir> --out <dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource, loadBackend, platformRetries } from './backend.mjs';
import { startDesktop, startProxy, until } from './desktop.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));
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
const cloud = fx.backend === 'cloud';
const B = await loadBackend('selfhost', { work });
const hub = (verb) =>
  cloud
    ? execFileSync('node', [join(HERE, 'cloud-ops.mjs'), verb], { stdio: 'ignore', timeout: 360000 })
    : execFileSync('node', [join(HERE, 'selfhost.mjs'), verb, '--work', work], { stdio: 'ignore' });
// A cloud cell's sessions die with it: everyone signs in again.
const signInAgain = async () => {
  const fresh = await loadBackend('cloud', { cache: null });
  Object.assign(B.tokens, fresh.tokens);
  for (const who of Object.keys(fresh.tokens)) fx.sessions[who] = fresh.tokens[who];
  return fresh.tokens;
};
const mode = async () => (await B.api('owner', 'mode')).body;
const setMode = (body) => B.api('owner', 'mode', body, { timeout: 120000 });
// The self-hosted hub's checkout is on this machine. The cloud cell's is not:
// there the hub's own copy is read the way any client reads it — a fresh
// owner socket on the document (legacy's canonical state), synced and closed.
const checkoutLocal = (rel) => {
  const p = join(work, 'repo', '.design', rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const checkout = (rel) => (cloud ? hubText(`ui-${rel.slice(3, -4).toLowerCase()}`) : checkoutLocal(rel));

const require = createRequire(join(REPO, 'apps/hub/package.json'));
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const socket = (doc, who = 'b') => {
  const d = new Y.Doc();
  const provider = new HocuspocusProvider({ url: fx.url.replace(/^http/, 'ws'), name: doc, token: fx.sessions[who].token, document: d });
  return { d, provider, html: () => d.getText('html').toString() };
};
async function hubText(doc) {
  const r = socket(doc, 'owner');
  try {
    await until(() => r.provider.synced, `hub copy of ${doc}`, 30000, 100);
    return r.html();
  } catch {
    return null;
  } finally {
    r.provider.destroy();
  }
}
const replace = (r, text) =>
  r.d.transact(() => {
    const t = r.d.getText('html');
    t.delete(0, t.length);
    t.insert(0, text);
  });

const start = await mode();
assert.equal(start.mode, 'legacy', 'S17 needs a fresh legacy project');
const port = fx.port;
const proxy = await startProxy({ listen: port + 110, target: fx.backend === "cloud" ? fx.url : port, control: port + 111 });
const A = await startDesktop({
  root: join(scratch, `desktop-migrate-${tag}`),
  port: port + 120,
  hubUrl: `http://127.0.0.1:${port + 110}`,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'desktop-migrate',
});
const mk = (base) => {
  const name = `${base}${tag}`;
  return { name, rel: `ui/${name}.tsx`, doc: `ui-${name.toLowerCase()}`, src: canvasSource(name, `${base} legacy`) };
};
const P = mk('F3MigPage');
const Q = mk('F3MigPanel');
const result = { tag, start };
const sockets = [];
try {
  // ── legacy: the desktop writes two canvases; they reach the hub checkout ──
  for (const c of [P, Q]) A.write(c.rel, c.src);
  for (const c of [P, Q]) await until(async () => (await checkout(c.rel)) === c.src, `legacy ${c.rel} on the hub`, 90000, 1000);
  // A legacy edit by a real legacy client (the desktop, writing its file).
  const qLegacyEdit = Q.src.replace('color: "red"', 'color: "olive"');
  A.write(Q.rel, qLegacyEdit);
  await until(async () => (await checkout(Q.rel)) === qLegacyEdit, 'a legacy edit reaches the hub', 60000, 1000);
  Q.legacy = qLegacyEdit;
  // A stale process of an older build: a raw socket opened now and never
  // closed, which knows nothing of accepted revisions.
  // (On the cloud a socket opened now dies with the cell the switch kills —
  // so there the stale socket is opened after the restart, still in legacy.)
  let stale = null;
  const openStale = async (expected = Q.legacy) => {
    stale = socket(Q.doc);
    sockets.push(stale);
    await until(() => stale.provider.synced && stale.html() === expected, 'stale socket synced', 30000);
  };
  const staleCheck = async (expected) => {
    const headBefore = (await B.bootstrap('owner')).revision;
    replace(stale, expected.replace('color: "olive"', 'color: "maroon"'));
    await new Promise((r) => setTimeout(r, 3000));
    const out = {
      stillOpen: stale.provider.configuration.websocketProvider.webSocket?.readyState === 1,
      headUnchanged: (await B.bootstrap('owner')).revision === headBefore,
      acceptedUnchanged: (await B.doc(Q.doc, 'owner')).source === expected,
      checkoutUnchanged: cloud ? null : (await checkout(Q.rel)) === expected,
    };
    const witness = socket(Q.doc, 'owner');
    sockets.push(witness);
    await until(() => witness.provider.synced, 'witness synced', 30000);
    out.freshReplicaUnchanged = witness.html() === expected;
    return out;
  };
  if (!cloud) await openStale();

  // ── dry run: reports, persists nothing ──
  const dry = await setMode({ mode: 'transactions', dryRun: true });
  const afterDry = await mode();
  result.dryRun = {
    status: dry.status,
    created: dry.body?.imported?.created ?? null,
    skipped: dry.body?.imported?.skipped ?? null,
    modeAfter: afterDry.mode,
    epochAfter: afterDry.epoch,
    revisionAfter: afterDry.revision,
  };

  // ── pending work: the desktop goes offline and edits P ──
  await proxy.offline();
  const pPending = P.src.replaceAll('F3MigPage legacy', 'Pending across the switch');
  A.write(P.rel, pPending);
  await new Promise((r) => setTimeout(r, 1500));

  // ── the switch, with the hub SIGKILLed while it runs ──
  const inflight = setMode({ mode: 'transactions', expectEpoch: start.epoch }).catch((e) => ({ status: 0, error: String(e) }));
  await new Promise((r) => setTimeout(r, 15));
  hub('kill');
  const interrupted = await inflight;
  hub('start');
  if (cloud) {
    const t = await signInAgain();
    // The desktop signs in again too — still offline, its edit only on disk.
    await A.relink(t.a.token);
    result.relinkedAfterCellRestart = true;
  }
  let m = await mode();
  if (cloud && m.mode === 'legacy') await openStale();
  result.interruptedSwitch = { answered: interrupted.status, modeAfterRestart: m.mode, epochAfterRestart: m.epoch, importPending: m.importPending };
  let sw = null;
  if (m.mode === 'legacy') {
    sw = await setMode({ mode: 'transactions', expectEpoch: m.epoch });
    assert.equal(sw.status, 200, `switch ${sw.status} ${JSON.stringify(sw.body)}`);
    m = await mode();
  }
  const switchEpoch = m.epoch;
  const doubled = await setMode({ mode: 'transactions', expectEpoch: start.epoch });
  result.switch = {
    status: sw?.status ?? 'completed-by-restart',
    mode: m.mode,
    epoch: switchEpoch,
    importPending: m.importPending,
    doubleSubmit: { status: doubled.status, code: doubled.body?.code ?? doubled.body?.error ?? null },
    epochAfterDouble: (await mode()).epoch,
  };
  const parity1 = await until(async () => {
    const r = await B.api('owner', 'parity');
    return r.status === 200 && r.body.ok ? r.body : null;
  }, 'parity after the switch', 120000, 2000).catch(async () => (await B.api('owner', 'parity')).body);
  const accQ = (await B.doc(Q.doc, 'owner')).source;
  result.afterSwitch = {
    parity: { ok: parity1.ok, checked: parity1.checked, mismatches: parity1.mismatches },
    qBytesConserved: accQ === Q.legacy,
    pImportedAsLegacy: (await B.doc(P.doc, 'owner')).source === P.src,
  };

  // ── the stale socket cannot write any more ──
  // (Cloud, switch completed by the restart: no legacy socket survived it, so
  // the stale socket is measured at the next legacy → accepted flip instead.)
  result.staleSocket = stale ? { atFlip: 'first-switch', ...(await staleCheck(Q.legacy)) } : null;

  // ── the pending desktop edit is conserved and lands as an action ──
  await proxy.online();
  const pLanded = async (ms) =>
    until(
      async () => ((await B.doc(P.doc, 'owner')).source === pPending ? true : null),
      'pending desktop edit landed',
      ms
    ).catch(() => false);
  const landedP = await pLanded(120000);
  const statusWhileUndelivered = landedP ? null : await A.status();
  // Known gap (see the F3 checkpoint): a save applied to the replica while the
  // socket was silently dead is fenced when it finally arrives; a restart's
  // cold start is what proposes it. Measured, so the gap is on record.
  let landedAfterRestart = null;
  if (!landedP) {
    await A.restart();
    landedAfterRestart = await pLanded(120000);
  }
  const hist1 = await B.history('owner', 100);
  result.pendingWork = {
    landed: landedP,
    landedAfterRestart,
    statusWhileUndelivered: statusWhileUndelivered && {
      conflicts: statusWhileUndelivered.conflicts ?? [],
      docs: statusWhileUndelivered.docs,
      accepted: statusWhileUndelivered.accepted ?? null,
    },
    onDiskStill: A.read(P.rel) === pPending,
    actor: hist1.find((h) => h.effects?.some((e) => e.doc === P.doc) && h.actor !== 'maude-migration')?.actor ?? null,
    migrationActions: hist1.filter((h) => /migration/.test(`${h.actor} ${h.kind} ${h.label}`)).length,
  };

  // ── rollback AFTER a new accepted write ──
  const headAccepted = (await B.bootstrap('owner')).revision;
  const back1 = await setMode({ mode: 'legacy' });
  const m2 = await mode();
  await until(async () => (await checkout(P.rel)) === pPending, 'legacy checkout keeps the accepted write', 30000, 1000).catch(() => null);
  const refusedWhileLegacy = await B.propose('owner', [{ op: 'dir.create', path: `ui/F3MigRefused${tag}` }], { epoch: m2.epoch });
  const histLegacy = await B.api('owner', 'history?limit=100');
  result.rollbackAfterWrite = {
    status: back1.status,
    mode: m2.mode,
    epoch: m2.epoch,
    acceptedWriteKept: (await checkout(P.rel)) === pPending,
    storeHeadKept: m2.revision === headAccepted,
    historyReadable: histLegacy.status === 200 && (histLegacy.body.history ?? []).length >= hist1.length,
    proposalRefused: { status: refusedWhileLegacy.status, code: refusedWhileLegacy.body?.code ?? null },
  };
  // A legacy write between the rollback and the next switch, by the desktop
  // (told of the rollback on its own socket).
  await until(() => A.read(Q.rel) === Q.legacy, 'desktop holds Q before the in-between write', 60000);
  const qBetween = Q.legacy.replaceAll('F3MigPanel legacy', 'Written while legacy again');
  A.write(Q.rel, qBetween);
  const betweenAt = Date.now();
  await until(async () => (await checkout(Q.rel)) === qBetween, 'legacy write between switches', 90000, 1000).catch(async (e) => {
    const peek = socket(Q.doc, 'owner');
    sockets.push(peek);
    await until(() => peek.provider.synced, 'peek synced', 20000).catch(() => null);
    writeFileSync(
      join(out, 'between-failure.json'),
      JSON.stringify(
        { sinceWriteMs: Date.now() - betweenAt, desktop: A.read(Q.rel), checkout: await checkout(Q.rel), hubDoc: peek.html(), stale: stale?.html() ?? null, status: await A.status() },
        null,
        1
      )
    );
    throw e;
  });

  // ── forward again: the in-between legacy write is carried, history kept ──
  if (!result.staleSocket) await openStale(qBetween);
  const fwd = await setMode({ mode: 'transactions', expectEpoch: m2.epoch });
  const m3 = await mode();
  const parity2 = await until(async () => {
    const r = await B.api('owner', 'parity');
    return r.status === 200 && r.body.ok ? r.body : null;
  }, 'parity after re-entry', 120000, 2000).catch(async () => (await B.api('owner', 'parity')).body);
  const oldRev = headAccepted;
  const oldLane = await B.api('owner', `lane?doc=${P.doc}&lane=html&rev=${oldRev}`);
  result.forwardAgain = {
    status: fwd.status,
    epoch: m3.epoch,
    carriedLegacyWrite: (await B.doc(Q.doc, 'owner')).source === qBetween,
    revisionAdvanced: m3.revision > headAccepted,
    oldRevisionReadable: oldLane.status === 200 && oldLane.body?.body === pPending,
    parity: { ok: parity2.ok, checked: parity2.checked, mismatches: parity2.mismatches },
  };
  if (!result.staleSocket) result.staleSocket = { atFlip: 'forward-again', ...(await staleCheck(qBetween)) };

  // ── rollback BEFORE any new write, then forward: nothing moves ──
  const headNow = m3.revision;
  const pNow = (await B.doc(P.doc, 'owner')).source;
  const qNow = (await B.doc(Q.doc, 'owner')).source;
  const back2 = await setMode({ mode: 'legacy' });
  await new Promise((r) => setTimeout(r, 2000));
  const identicalInLegacy = (await checkout(P.rel)) === pNow && (await checkout(Q.rel)) === qNow;
  const m4 = await mode();
  const fwd2 = await setMode({ mode: 'transactions', expectEpoch: m4.epoch });
  const m5 = await mode();
  result.rollbackBeforeWrite = {
    status: back2.status,
    identicalInLegacy,
    forwardStatus: fwd2.status,
    headUnchangedByRoundTrip: m5.revision === headNow,
    bytesUnchanged: (await B.doc(P.doc, 'owner')).source === pNow && (await B.doc(Q.doc, 'owner')).source === qNow,
    epochs: [start.epoch, switchEpoch, m2.epoch, m3.epoch, m4.epoch, m5.epoch],
  };
  // The desktop converged on the final accepted state.
  result.desktopConverged = await until(
    () => A.read(P.rel) === pNow && A.read(Q.rel) === qNow,
    'desktop converged',
    90000
  ).catch(() => false);
} finally {
  for (const s of sockets) s.provider.destroy();
  writeFileSync(join(out, 'desktop.log'), A.log.replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
  await A.stop();
  proxy.stop();
}
const r = result;
const checks = {
  dryRunPersistsNothing: r.dryRun.status === 200 && r.dryRun.modeAfter === 'legacy' && r.dryRun.epochAfter === r.start.epoch && r.dryRun.created >= 2,
  interruptedSwitchConsistent: r.switch.mode === 'transactions' && r.switch.importPending === false,
  doubleSubmitRefused: r.switch.doubleSubmit.status === 409 && r.switch.epochAfterDouble === r.switch.epoch,
  parityAfterSwitch: r.afterSwitch.parity.ok === true,
  bytesConserved: r.afterSwitch.qBytesConserved,
  staleSocketFenced:
    r.staleSocket.headUnchanged && r.staleSocket.acceptedUnchanged && r.staleSocket.checkoutUnchanged !== false && r.staleSocket.freshReplicaUnchanged,
  pendingWorkConserved: r.pendingWork.landed === true && r.pendingWork.actor === fx.users.a.email,
  rollbackKeepsAcceptedWrite: r.rollbackAfterWrite.status === 200 && r.rollbackAfterWrite.acceptedWriteKept && r.rollbackAfterWrite.historyReadable,
  noAcceptedWriterWhileLegacy: r.rollbackAfterWrite.proposalRefused.status >= 400,
  forwardCarriesLegacyWrite: r.forwardAgain.status === 200 && r.forwardAgain.carriedLegacyWrite && r.forwardAgain.parity.ok === true,
  historyConserved: r.forwardAgain.oldRevisionReadable,
  rollbackBeforeWriteIsNoop: r.rollbackBeforeWrite.identicalInLegacy && r.rollbackBeforeWrite.bytesUnchanged,
  epochsMonotonic: r.rollbackBeforeWrite.epochs.every((e, i, a) => i === 0 || e > a[i - 1]),
  desktopConverged: r.desktopConverged === true,
};
result.checks = checks;
result.platformRetries = platformRetries;
result.status = Object.values(checks).every(Boolean) ? 'pass' : 'fail';
writeFileSync(join(out, 's17-migration.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
void sha;
