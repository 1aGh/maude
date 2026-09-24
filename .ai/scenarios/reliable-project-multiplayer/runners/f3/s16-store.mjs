#!/usr/bin/env node
// S16 on a deployed backend: the accepted store under the failures an
// operator actually meets on a self-hosted hub.
//
//   A  two coordinators — a second hub container started on the SAME data and
//      checkout volumes (the "old process that never died"), both taking
//      proposals, raced on one document; then the project's epoch advanced
//      through one of them while the other still serves.
//   B  a missing payload — the current content of one canvas removed from the
//      store (a partial restore / corruption), the hub restarted on it.
//   C  a full store — the hub on a data disk that is filled to the last byte.
//   D  compaction and GC — a canvas with history is deleted, backups roll past
//      their retention (keep 14) and both disks are replaced; then only the
//      checkout (renderer) disk is replaced.
//
// Oracle: one linear head (contiguous revisions, every acknowledged
// transaction exactly once, at the revision it was acknowledged with); no
// acknowledgment the store does not hold; a refused write is refused loudly
// and is accepted exactly once when retried after the cause is gone; current,
// historical (including a deleted canvas's) and pending references readable
// after retention and disk replacement.
//
//   node s16-store.mjs --work <fresh selfhost dir, transactions mode> --scratch <dir> --out <dir>
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource, loadBackend, sha } from './backend.mjs';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const only = argv.includes('--only') ? arg('only').split(',') : ['A', 'B', 'C', 'D'];
const work = arg('work');
const scratch = arg('scratch');
const out = arg('out');
mkdirSync(scratch, { recursive: true });
mkdirSync(out, { recursive: true });
const fx = () => JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const tag = randomBytes(3).toString('hex');
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const selfhost = (...a) =>
  execFileSync('node', [join(HERE, 'selfhost.mjs'), ...a, '--work', work], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Database = createRequire(join(REPO, 'apps/hub/package.json'))('better-sqlite3');
async function healthy(url, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })).ok) return true;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  return false;
}
let B = await loadBackend('selfhost', { work });
const assertTx = (m) => assert.equal(m.mode, 'transactions', 'S16 needs an accepted project');
assertTx((await B.api('owner', 'mode')).body);

const log = async () => {
  const all = [];
  for (let after = 0; ; ) {
    const r = await B.api('owner', `revisions?after=${after}&limit=1000`);
    assert.equal(r.status, 200, `revisions ${r.status}`);
    all.push(...r.body.revisions);
    if (r.body.revisions.length < 1000) return all;
    after = r.body.revisions.at(-1).revision;
  }
};
const chain = (rows) => {
  const revs = rows.map((r) => r.revision);
  const txs = rows.map((r) => r.tx);
  return {
    revisions: revs.length,
    contiguous: revs.every((v, i) => v === (i === 0 ? revs[0] : revs[i - 1] + 1)),
    duplicateTransactions: txs.length - new Set(txs).size,
  };
};
const create = async (b, name, title) => {
  const src = canvasSource(name, title);
  const doc = `ui-${name.toLowerCase()}`;
  const r = await b.propose('owner', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }]);
  assert.equal(r.status, 200, `create ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { doc, rel: `ui/${name}.tsx`, src };
};
const edit = (b, who, c, from, to, opts) =>
  b.propose(who, [{ op: 'lane.replace', doc: c.doc, lane: 'html', base: sha(from), content: to }], opts);
const result = { tag };
const save = () => writeFileSync(join(out, 's16-store.json'), JSON.stringify(result, null, 2));

// ── A: two coordinators on one store ────────────────────────────────────────
if (only.includes('A')) {
  const f = fx();
  const env = JSON.parse(docker('inspect', '-f', '{{json .Config.Env}}', f.container)).filter(
    (e) => !/^(PATH|NODE_VERSION|YARN_VERSION|HOME)=/.test(e)
  );
  const second = `${f.container}-second`;
  const port2 = f.port + 1;
  try {
    docker('rm', '-f', second);
  } catch {
    /* none */
  }
  docker(
    'run', '-d', '--name', second, '-p', `127.0.0.1:${port2}:1234`,
    '-v', `${join(work, 'data')}:/data`, '-v', `${join(work, 'repo')}:/repo`,
    ...env.flatMap((e) => ['-e', e]),
    'maude-f3-selfhost:local'
  );
  const up2 = await healthy(`http://127.0.0.1:${port2}`);
  const w2 = join(scratch, `second-${tag}`);
  mkdirSync(w2, { recursive: true });
  writeFileSync(join(w2, 'fixture.json'), JSON.stringify({ ...f, url: `http://127.0.0.1:${port2}` }), { mode: 0o600 });
  const B2 = await loadBackend('selfhost', { work: w2 });
  const hubs = [B, B2];
  try {
    const R = await create(B, `F3Race${tag}`, 'Race');
    const acks = [];
    const outcomes = {};
    let current = R.src;
    for (let round = 0; round < 20; round++) {
      // Both coordinators see the same head, then each takes a conflicting
      // change on the same base at the same moment.
      const [x, y] = await Promise.all(
        hubs.map((h, i) =>
          edit(h, i === 0 ? 'a' : 'b', R, current, R.src.replace('Race<', `Race r${round} via hub${i + 1}<`))
        )
      );
      for (const [i, r] of [x, y].entries()) {
        outcomes[`${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`] =
          (outcomes[`${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`] ?? 0) + 1;
        if (r.status === 200) acks.push({ hub: i + 1, round, tx: r.body.transactionId, revision: r.body.revision });
      }
      const head = await B.doc(R.doc, 'owner');
      current = head.source;
    }
    const rows = await log();
    const byTx = new Map(rows.map((r) => [r.tx, r]));
    const ackedPerRound = Object.values(Object.groupBy(acks, (a) => a.round)).map((g) => g.length);
    // An epoch advance through hub 2 while hub 1 still serves.
    const before = (await B2.api('owner', 'mode')).body;
    const toLegacy = await B2.api('owner', 'mode', { mode: 'legacy' });
    const legacy = (await B2.api('owner', 'mode')).body;
    const viaStaleWhileLegacy = await edit(B, 'a', R, current, R.src.replace('Race<', 'Stale while legacy<'), { epoch: legacy.epoch });
    const back = await B2.api('owner', 'mode', { mode: 'transactions', expectEpoch: legacy.epoch });
    const after = (await B2.api('owner', 'mode')).body;
    const viaStaleOldEpoch = await edit(B, 'a', R, current, R.src.replace('Race<', 'Old epoch<'), { epoch: before.epoch });
    const viaStaleNewEpoch = await edit(B, 'a', R, current, R.src.replace('Race<', 'New epoch via hub1<'), { epoch: after.epoch });
    const rows2 = await log();
    const final = await B.doc(R.doc, 'owner');
    result.A = {
      secondHubUp: up2,
      rounds: 20,
      outcomes,
      ackedPerRound: { max: Math.max(...ackedPerRound), rounds: ackedPerRound.length },
      acks: acks.length,
      everyAckStoredAtItsRevision: acks.every((a) => byTx.get(a.tx)?.revision === a.revision),
      chain: chain(rows2),
      epochs: { before: before.epoch, legacy: legacy.epoch, after: after.epoch, toLegacy: toLegacy.status, back: back.status },
      staleCoordinator: {
        whileLegacy: { status: viaStaleWhileLegacy.status, code: viaStaleWhileLegacy.body?.code ?? null },
        oldEpoch: { status: viaStaleOldEpoch.status, code: viaStaleOldEpoch.body?.code ?? null },
        currentEpoch: { status: viaStaleNewEpoch.status, code: viaStaleNewEpoch.body?.code ?? null },
      },
      finalHeadIsLastAck:
        viaStaleNewEpoch.status === 200
          ? final.source.includes('New epoch via hub1')
          : sha(final.source) === sha(current),
      parity: (await B.api('owner', 'parity')).body,
      parityViaSecond: (await B2.api('owner', 'parity')).body,
    };
    result.A.status =
      up2 &&
      result.A.acks >= 20 &&
      result.A.ackedPerRound.max === 1 &&
      result.A.everyAckStoredAtItsRevision &&
      result.A.chain.contiguous &&
      result.A.chain.duplicateTransactions === 0 &&
      viaStaleWhileLegacy.status >= 400 &&
      viaStaleOldEpoch.status === 409 &&
      viaStaleOldEpoch.body?.code === 'epoch-stale' &&
      result.A.finalHeadIsLastAck
        ? 'pass'
        : 'fail';
  } finally {
    writeFileSync(join(out, 'second-hub.log'), docker('logs', second).replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
    docker('rm', '-f', second);
  }
  // While both ran, each served its own (stale) replicas and both wrote the
  // shared checkout — recorded above. With the stale process gone, the
  // remaining coordinator must converge by itself.
  let converged = null;
  const endA = Date.now() + 120000;
  while (Date.now() < endA) {
    converged = (await B.api('owner', 'parity')).body;
    if (converged?.ok) break;
    await sleep(3000);
  }
  result.A.parityAfterStaleProcessStopped = converged;
  if (!converged?.ok) result.A.status = 'fail';
}

save();
// ── B: a missing payload ────────────────────────────────────────────────────
if (only.includes('B')) {
  const X = await create(B, `F3Payload${tag}`, `Payload ${tag}`);
  const Y = await create(B, `F3Neighbour${tag}`, `Neighbour ${tag}`);
  // A teammate moves the head, so a save made on the ORIGINAL body needs that
  // body (the merge base) — the payload this part removes.
  const X2 = X.src.replace('color: "red"', 'color: "teal"');
  assert.equal((await edit(B, 'b', X, X.src, X2)).status, 200);
  const hash = sha(X.src);
  docker('stop', fx().container);
  const dbPath = join(work, 'data', 'project-store.sqlite');
  let db = new Database(dbPath);
  const row = db.prepare('SELECT * FROM blobs WHERE hash = ?').get(hash);
  assert.ok(row, 'payload row present');
  db.prepare('DELETE FROM blobs WHERE hash = ?').run(hash);
  db.close();
  docker('start', fx().container);
  const bootedMissing = await healthy(fx().url);
  const headBefore = (await B.bootstrap('owner')).revision;
  const tx = `tx_f3_missing_${randomUUID()}`;
  const t0 = Date.now();
  // A different line from the teammate's (line 2 vs the h1 on line 4), so the
  // merge has no genuine overlap — only the missing base can stop it.
  const mine = X.src.replace(`function F3Payload${tag}()`, `function F3PayloadEdited${tag}()`);
  const refused = await edit(B, 'a', X, X.src, mine, { transactionId: tx });
  const refusedMs = Date.now() - t0;
  const neighbour = await edit(B, 'a', Y, Y.src, Y.src.replace('color: "red"', 'color: "green"'));
  const headAfter = (await B.bootstrap('owner')).revision;
  const blobRead = await B.api('owner', `blobs/${hash}`);
  const hist = await B.api('owner', 'history?limit=20');
  docker('stop', fx().container);
  db = new Database(dbPath);
  db.prepare('INSERT INTO blobs (hash, body, size) VALUES (?, ?, ?)').run(row.hash, row.body, row.size);
  db.close();
  docker('start', fx().container);
  await healthy(fx().url);
  // The same transaction asked again gets the same (recorded) answer; the
  // candidate goes out again as a NEW proposal once the payload is back.
  const replayed = await edit(B, 'a', X, X.src, mine, { transactionId: tx });
  const retried = await edit(B, 'a', X, X.src, mine);
  const again = await edit(B, 'a', X, X.src, mine, { transactionId: retried.body?.transactionId });
  const mergedX = (await B.doc(X.doc, 'owner')).source;
  const rows = await log();
  result.B = {
    bootedWithMissingPayload: bootedMissing,
    refused: { status: refused.status, code: refused.body?.code ?? null, ms: refusedMs },
    noAckWhileMissing: headAfter === headBefore + (neighbour.status === 200 ? 1 : 0),
    neighbourUnaffected: neighbour.status === 200,
    blobReadWhileMissing: blobRead.status,
    historyReadable: hist.status === 200,
    sameTxReplayed: { status: replayed.status, code: replayed.body?.code ?? null },
    retried: { status: retried.status, revision: retried.body?.revision ?? null },
    retriedTwiceSameResult: again.status === 200 && again.body?.revision === retried.body?.revision,
    txStoredOnce: rows.filter((r) => r.tx === retried.body?.transactionId).length,
    refusedTxNotStored: rows.every((r) => r.tx !== tx),
    chain: chain(rows),
    mergedKeepsBoth: mergedX?.includes(`F3PayloadEdited${tag}`) && mergedX?.includes('teal'),
  };
  result.B.status =
    result.B.bootedWithMissingPayload &&
    refused.status >= 400 &&
    refused.status !== 200 &&
    result.B.noAckWhileMissing &&
    result.B.neighbourUnaffected &&
    result.B.historyReadable &&
    retried.status === 200 &&
    result.B.retriedTwiceSameResult &&
    result.B.txStoredOnce === 1 &&
    result.B.refusedTxNotStored &&
    replayed.status === refused.status &&
    result.B.mergedKeepsBoth &&
    result.B.chain.contiguous
      ? 'pass'
      : 'fail';
}

save();
// ── C: a full store ─────────────────────────────────────────────────────────
if (only.includes('C')) {
  const f = fx();
  const Z = await create(B, `F3Full${tag}`, `Full ${tag}`);
  const rowsBefore = await log();
  const env = JSON.parse(docker('inspect', '-f', '{{json .Config.Env}}', f.container)).filter(
    (e) => !/^(PATH|NODE_VERSION|YARN_VERSION|HOME)=/.test(e) && !/^MAUDE_BACKUP|^MAUDE_S3_/.test(e)
  );
  docker('stop', f.container);
  // A clone of the data volume on a small disk (the real volume stays as it
  // is — this hub's writes are thrown away with the clone).
  const dataBytes = Number(execFileSync('du', ['-sb', join(work, 'data')], { encoding: 'utf8' }).split(/\s+/)[0]);
  const size = Math.ceil(dataBytes / 1048576) + 24;
  const full = `${f.container}-fullstore`;
  const repoClone = join(scratch, `full-repo-${tag}`);
  cpSync(join(work, 'repo'), repoClone, { recursive: true });
  try {
    docker('rm', '-f', full);
  } catch {
    /* none */
  }
  docker(
    'run', '-d', '--name', full, '-p', `127.0.0.1:${f.port}:1234`,
    '--mount', `type=tmpfs,destination=/data,tmpfs-size=${size}m,tmpfs-mode=1777`,
    '-v', `${join(work, 'data')}:/seed:ro`, '-v', `${repoClone}:/repo`,
    ...env.flatMap((e) => ['-e', e]),
    '--entrypoint', '/usr/bin/tini', 'maude-f3-selfhost:local', '--', 'sh', '-c', 'cp -R /seed/. /data/ && exec /app/entrypoint.sh'
  );
  const upFull = await healthy(f.url);
  try {
    const fill = docker(
      'exec', full, 'sh', '-c',
      'for bs in 1048576 65536 4096 512 1; do dd if=/dev/zero of=/data/fill.$bs bs=$bs 2>/dev/null; done; df -k /data | tail -1'
    );
    const headBefore = (await B.bootstrap('owner')).revision;
    const big = Z.src.replace(`Full ${tag}<`, `Full ${tag} ${'x'.repeat(200000)}<`);
    const tx = `tx_f3_full_${randomUUID()}`;
    const t0 = Date.now();
    const refused = await edit(B, 'a', Z, Z.src, big, { transactionId: tx }).catch((e) => ({ status: 0, body: { error: String(e) } }));
    const refusedMs = Date.now() - t0;
    const small = await edit(B, 'a', Z, Z.src, Z.src.replace(`Full ${tag}<`, `F ${tag}<`)).catch((e) => ({ status: 0, body: { error: String(e) } }));
    const boot = await B.api('owner', 'bootstrap');
    const whileFull = {
      refused: { status: refused.status, code: refused.body?.code ?? refused.body?.error ?? null, ms: refusedMs },
      small: { status: small.status, code: small.body?.code ?? null },
      bootstrap: boot.status,
      headAfter: boot.body?.revision ?? null,
      hubAlive: await healthy(f.url, 5000),
    };
    // An acknowledgment while full must be real: the store holds it.
    const rowsFull = boot.status === 200 ? await log() : [];
    const falseAcks = [refused, small]
      .filter((r) => r.status === 200)
      .filter((r) => !rowsFull.some((x) => x.tx === r.body.transactionId && x.revision === r.body.revision)).length;
    docker('exec', full, 'sh', '-c', 'rm -f /data/fill.*');
    await sleep(1000);
    const retried = await edit(B, 'a', Z, Z.src, big, { transactionId: tx });
    const rowsAfter = await log();
    result.C = {
      diskMiB: size,
      hubUpOnSmallDisk: upFull,
      df: fill,
      headBefore,
      whileFull,
      falseAcks,
      retried: { status: retried.status, code: retried.body?.code ?? null, revision: retried.body?.revision ?? null },
      txStoredOnce: rowsAfter.filter((r) => r.tx === tx).length,
      chain: chain(rowsAfter),
      storeGrewByOnlyAcked: rowsAfter.length - rowsBefore.length === [refused, small, retried].filter((r) => r.status === 200 && !r.body?.noop).length,
    };
    result.C.status =
      upFull &&
      whileFull.hubAlive &&
      falseAcks === 0 &&
      (refused.status !== 200 || whileFull.headAfter > headBefore) &&
      refusedMs < 30000 &&
      [200, 409].includes(retried.status) &&
      result.C.txStoredOnce <= 1 &&
      result.C.chain.contiguous &&
      result.C.chain.duplicateTransactions === 0
        ? 'pass'
        : 'fail';
  } finally {
    writeFileSync(join(out, 'fullstore-hub.log'), docker('logs', full).replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
    docker('rm', '-f', full);
    rmSync(repoClone, { recursive: true, force: true });
    docker('start', f.container);
    await healthy(f.url);
  }
}

save();
// ── D: retention, deletion and replaced disks ───────────────────────────────
if (only.includes('D')) {
  // Backups every 10 s so retention (keep 14) is exceeded within the run.
  selfhost('recreate', '--set', 'MAUDE_BACKUP_INTERVAL_MS=10000');
  B = await loadBackend('selfhost', { work });
  const G = await create(B, `F3Gone${tag}`, `Gone ${tag}`);
  const versions = [G.src];
  for (let i = 1; i <= 3; i++) {
    const next = G.src.replace(`Gone ${tag}<`, `Gone ${tag} v${i}<`);
    assert.equal((await edit(B, 'a', G, versions.at(-1), next)).status, 200);
    versions.push(next);
  }
  const gRevs = (await log()).filter((r) => r.effects?.some((e) => e.doc === G.doc)).map((r) => r.revision);
  const del = await B.propose('a', [{ op: 'doc.delete', doc: G.doc }]);
  assert.equal(del.status, 200, `delete ${del.status} ${JSON.stringify(del.body)}`);
  const K = await create(B, `F3Kept${tag}`, `Kept ${tag}`);
  // Wait past retention, then two more intervals after the last write.
  await sleep(200000);
  const { listObjects, s3ConfigFromEnv } = await import(join(REPO, 'apps/hub/src/s3.mjs'));
  const envFile = Object.fromEntries(
    readFileSync('/tmp/maude-r2-test.env', 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  const cfg = s3ConfigFromEnv({
    MAUDE_S3_ENDPOINT: 'https://b5b596efe65abb732777c7171dc18145.r2.cloudflarestorage.com',
    MAUDE_S3_BUCKET: 'maude-multiplayer-test-20260922',
    ...envFile,
  });
  const backupKeys = (await listObjects(cfg, `${fx().tenant}/`)).map((o) => o.key);
  const generations = [...new Set(backupKeys.filter((k) => k.includes('manifest')).map((k) => k.split('/').slice(0, -1).join('/')))];
  const snapshot = async () => {
    const rows = await log();
    const head = await B.bootstrap('owner');
    const lanes = {};
    for (const rev of gRevs) {
      const l = await B.api('owner', `lane?doc=${G.doc}&lane=html&rev=${rev}`);
      lanes[rev] = l.status === 200 ? sha(l.body.body ?? '') : `status ${l.status}`;
    }
    return {
      revision: head.revision,
      chainHash: sha(JSON.stringify(rows.map((r) => [r.revision, r.tx]))),
      liveDocs: head.docs.filter((d) => !d.retired).map((d) => [d.doc, d.lanes?.html?.hash]).sort(),
      deletedLive: head.docs.some((d) => d.doc === G.doc && !d.retired),
      deletedHistory: lanes,
    };
  };
  const before = await snapshot();
  const expectedDeletedHistory = Object.fromEntries(gRevs.map((rev, i) => [rev, sha(versions[i])]));
  // 1. Both disks replaced: the latest backup generation is all there is.
  selfhost('wipe-disk');
  B = await loadBackend('selfhost', { work });
  const afterWipe = await snapshot();
  const parityWipe = (await B.api('owner', 'parity')).body;
  // 2. Only the checkout (renderer) disk replaced; the store stays. By design
  //    the hub REFUSES this boot (rehydrate.mjs): restoring the checkout alone
  //    would pair it with newer documents. The runbook's recovery is the whole
  //    latest generation into empty disks (`wipe-disk`), measured after it.
  docker('stop', fx().container);
  rmSync(join(work, 'repo'), { recursive: true, force: true });
  mkdirSync(join(work, 'repo'));
  docker('start', fx().container);
  const startedTorn = await healthy(fx().url, 60000);
  const refusal = startedTorn
    ? null
    : (() => {
        // The entrypoint writes to the container's stderr; read both streams.
        const r = spawnSync('docker', ['logs', '--tail', '40', fx().container], { encoding: 'utf8' });
        return `${r.stdout}\n${r.stderr}`.split('\n').find((l) => /refusing to start/.test(l)) ?? null;
      })();
  selfhost('wipe-disk');
  B = await loadBackend('selfhost', { work });
  const upFresh = await healthy(fx().url, 300000);
  const afterRepo = upFresh ? await snapshot() : null;
  const parityRepo = upFresh ? (await B.api('owner', 'parity')).body : null;
  const kOnDisk = existsSync(join(work, 'repo', '.design', K.rel))
    ? readFileSync(join(work, 'repo', '.design', K.rel), 'utf8') === K.src
    : false;
  result.D = {
    backupGenerations: generations.length,
    retentionHeld: generations.length <= 14 && generations.length >= 1,
    deletedCanvasRevisions: gRevs,
    before: { revision: before.revision, deletedLive: before.deletedLive },
    historyBeforeWipe: JSON.stringify(before.deletedHistory) === JSON.stringify(expectedDeletedHistory),
    afterBothDisks: {
      sameHead: afterWipe.revision === before.revision,
      sameChain: afterWipe.chainHash === before.chainHash,
      sameLiveDocs: JSON.stringify(afterWipe.liveDocs) === JSON.stringify(before.liveDocs),
      deletedStaysDeleted: !afterWipe.deletedLive,
      deletedHistoryReadable: JSON.stringify(afterWipe.deletedHistory) === JSON.stringify(expectedDeletedHistory),
      parity: parityWipe?.ok ?? null,
    },
    checkoutOnlyDisk: { hubStarted: startedTorn, refusal },
    afterCheckoutDisk: afterRepo && {
      sameHead: afterRepo.revision === before.revision,
      sameChain: afterRepo.chainHash === before.chainHash,
      deletedHistoryReadable: JSON.stringify(afterRepo.deletedHistory) === JSON.stringify(expectedDeletedHistory),
      parity: parityRepo?.ok ?? null,
      currentCanvasOnDisk: kOnDisk,
    },
  };
  const a = result.D.afterBothDisks;
  const c = result.D.afterCheckoutDisk;
  result.D.status =
    result.D.retentionHeld &&
    result.D.historyBeforeWipe &&
    a.sameHead && a.sameChain && a.sameLiveDocs && a.deletedStaysDeleted && a.deletedHistoryReadable && a.parity === true &&
    !startedTorn && /documents are present but the checkout is gone/.test(refusal ?? '') &&
    c && c.sameHead && c.sameChain && c.deletedHistoryReadable && c.parity === true && c.currentCanvasOnDisk
      ? 'pass'
      : 'fail';
}

result.status = only.every((k) => result[k]?.status === 'pass') ? 'pass' : 'fail';
writeFileSync(join(out, 's16-store.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
