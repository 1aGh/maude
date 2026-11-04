#!/usr/bin/env node
// F14 / F15 (p8-fix-c) — the trash/restore sync rig, both directions, throwaway everything.
//
// Stands up what the desktop team-cell lane stands up, minus the app: a CELL-shaped local hub
// (apps/hub serve-hub.mjs in workspace mode, under Node 24, its own checkout) and two studios
// (`bun apps/studio/server.ts`, the process the desktop runs as its sidecar) — alice and bob —
// each linked to it with its own token. Then it runs one scenario N times:
//
//   --scenario restore   F14: bob trashes three of four artboards, a hand edit takes the last one
//                        out of his file, bob (or alice, --restorer alice) restores the Trash. Every
//                        peer's disk and the cell's checkout must end with the three artboards.
//   --scenario race      F15: the cell goes away, alice trashes A-C, bob trashes D, the cell comes
//                        back. The two Macs must end EQUAL, or one of them shows a conflict.
//
//   --scenario first     p8-fix-c2 #1: only the boot — both copies start on an EMPTY project, then
//                        one (--first-by alice|bob) makes the first canvas; the other must get it
//                        without a restart. Every scenario boots this way.
//
//   node scripts/dev/trash-sync-repro.mjs --scenario restore --runs 20 [--restorer bob|alice] [--keep]
//
// Nothing here touches a real hub, a real ~/.config, the person's index or the keychain: HOME,
// XDG_CONFIG_HOME, MAUDE_INDEX_DIR and the credential stores are all under one mkdtemp, a stub
// `claude` is first on PATH, NO_OPEN=1.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startLocalHub } from '../../apps/desktop/e2e/fixtures/local-hub.mjs';
import { heldConflicts } from '../../apps/studio/client/v2/diagnostics/sync-details/sync-details-model.js';
import { saveStatus } from '../../apps/studio/client/v2/shell/save-status.js';
import { syncPresentation } from '../../apps/studio/sync/presentation.ts';
import { stubClaudeEnv } from '../lib/stub-claude.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (n, fb) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fb;
};
const SCENARIO = arg('scenario', 'restore');
const RUNS = Number(arg('runs', '1'));
const RESTORER = arg('restorer', 'bob');
const KEEP = argv.includes('--keep');
const SETTLE_MS = Number(arg('settle', '0'));
// --legacy: a hub with no accepted-revisions store (the shared-document mode a 1.x hub speaks)
const LEGACY = argv.includes('--legacy');
// who makes the project's first canvas after both copies booted empty (p8-fix-c2 #1)
const FIRST_BY = arg('first-by', 'alice');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (src) =>
  [...(src ?? '').matchAll(/<DCArtboard\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
async function until(what, fn, ms = 60_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out: ${what}${last ? ` (${last})` : ''}`);
}
function freePort() {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const ARTBOARDS = [
  ['flag-front', 'A'],
  ['flag-back', 'B'],
  ['tackle-front', 'C'],
  ['tackle-back', 'D'],
];
const SOURCE = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Leták A6">
${ARTBOARDS.map(
  ([id, label]) => `        <DCArtboard id="${id}" label="${label}" width={180} height={254}>
          <h1 style={{ padding: 16 }}>${label}</h1>
        </DCArtboard>`
).join('\n')}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const meta = (title) =>
  `${JSON.stringify(
    {
      title,
      sections: [
        {
          id: 'main',
          title: 'Leták A6',
          artboards: ARTBOARDS.map(([id, label]) => ({ id, label, width: 180, height: 254 })),
        },
      ],
      css_mode: 'inline',
      layout: { artboards: ARTBOARDS.map(([id], i) => ({ id, x: i * 210, y: 0 })) },
    },
    null,
    2
  )}\n`;

const scratch = mkdtempSync(join(tmpdir(), 'maude-trash-repro-'));
const children = [];
let hub = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) {
    try {
      c.kill('SIGCONT');
      c.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
  hub?.stop();
  if (!KEEP) rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
for (const [sig, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(sig, () => {
    cleanup();
    process.exit(code);
  });
}
// A boot step that times out rejects the top-level await: the children (two studios, the hub)
// must not outlive the rig as orphans on a machine-wide test lane.
process.on('exit', cleanup);

function projectConfig(root, hubUrl) {
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      name: 'Trash repro',
      designRoot: '.design',
      formatVersion: 2,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      ...(hubUrl ? { linkedHub: { url: hubUrl, linkedAt: Date.now() } } : {}),
    })
  );
}
function credentials(dir, hubUrl, token, folder) {
  mkdirSync(dir, { recursive: true });
  const hubsPath = join(dir, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({
      hubs: { [hubUrl]: { token, role: 'member', linkedAt: Date.now() } },
      trusted: [hubUrl],
    }),
    { mode: 0o600 }
  );
  writeFileSync(
    join(dir, 'project-links.json'),
    JSON.stringify({
      v: 1,
      since: Date.now(),
      links: { [realpathSync(folder)]: { hub: hubUrl, at: Date.now(), how: 'link' } },
    }),
    { mode: 0o600 }
  );
  return hubsPath;
}

// a stub claude (no keychain dialog) — the shared one, which also empties MAUDE_CLAUDE_BIN so an
// inherited pin cannot reach the real binary — and a throwaway HOME/XDG/index for every child
const fakeHome = join(scratch, 'home');
mkdirSync(fakeHome, { recursive: true });
const baseEnv = {
  ...process.env,
  ...stubClaudeEnv(scratch),
  HOME: fakeHome,
  XDG_CONFIG_HOME: join(fakeHome, '.config'),
  MAUDE_INDEX_DIR: join(scratch, 'index'),
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_CANVAS_ORIGIN_SPLIT: '1',
  NO_OPEN: '1',
  ...(argv.includes('--debug') ? { MAUDE_SYNC_DEBUG: '1' } : {}),
  // p8-orphan-sidecars — a studio ends by itself when this rig is SIGKILLed (no exit handler runs then)
  MAUDE_EXIT_WITH_PARENT: '1',
};
for (const k of Object.keys(baseEnv)) {
  if (
    /^(MAUDE_SHELL_|MAUDE_PROFILE_|MAUDE_TOKEN_|MAUDE_APP_BOUND_HUB|AWS_|CLOUDFLARE_|GH_TOKEN)/.test(
      k
    )
  )
    delete baseEnv[k];
}

async function startStudio(name, root, hubsPath) {
  const port = await freePort();
  const proc = spawn(
    'bun',
    ['--no-env-file', join(ROOT, 'apps/studio/server.ts'), '--root', root, '--port', String(port)],
    {
      env: {
        ...baseEnv,
        HUBS_CONFIG_PATH: hubsPath,
        MAUDE_CLOUD_CONFIG: join(dirname(hubsPath), 'cloud.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  const logFile = join(scratch, `${name}.log`);
  const keep = (c) => {
    log = (log + c.toString('utf8')).slice(-20_000);
    appendFileSync(logFile, c);
  };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  children.push(proc);
  const url = `http://127.0.0.1:${port}`;
  await until(`${name}'s studio`, async () => (await fetch(`${url}/_health`)).ok, 90_000).catch(
    (e) => {
      throw new Error(`${e}\n${log}`);
    }
  );
  const call = async (method, route, body) => {
    const r = await fetch(`${url}${route}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* text */
    }
    return { status: r.status, body: parsed };
  };
  return { name, root, port, url, proc, call, log: () => log };
}

const hubDir = join(scratch, 'hub');
const cellRepo = join(scratch, 'cell');
projectConfig(cellRepo, null);
hub = await startLocalHub({ dir: hubDir, workspace: cellRepo, transactions: !LEGACY });
const hubPort = Number(new URL(hub.http).port);
const aliceRoot = join(scratch, 'alice');
const bobRoot = join(scratch, 'bob');
projectConfig(aliceRoot, hub.http);
projectConfig(bobRoot, hub.http);
// p8-fix-c2 #1 — BOTH copies boot onto a project with no canvas anywhere ("linked … but 0
// syncable canvases"), and only then does one of them make the project's first canvas. The other
// must get it without a restart (this rig used to seed a canvas before bob booted to hide that).
const alice = await startStudio(
  'alice',
  aliceRoot,
  credentials(join(scratch, 'alice-cfg'), hub.http, hub.tokens.alice, aliceRoot)
);
const bob = await startStudio(
  'bob',
  bobRoot,
  credentials(join(scratch, 'bob-cfg'), hub.http, hub.tokens.bob, bobRoot)
);
await until(
  'both copies linked with nothing to sync',
  () => [alice, bob].every((p) => /0 syncable canvases/.test(p.log())),
  60_000
);
const firstBy = FIRST_BY === 'bob' ? bob : alice;
const firstTo = firstBy === bob ? alice : bob;
writeFileSync(
  join(firstBy.root, '.design', 'ui', 'welcome.tsx'),
  SOURCE.replace('Leták A6', 'Welcome')
);
await until(
  'welcome on the hub',
  async () => {
    // a legacy hub has no accepted-revisions bootstrap: the author saying it is synced is the signal
    if (LEGACY) return /1\/1 synced/.test(firstBy.log());
    const r = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    const boot = await r.json();
    return (boot.docs ?? []).some((d) => !d.retired && d.path === 'ui/welcome.tsx');
  },
  120_000
);
const firstAt = Date.now();
await until(
  `the first canvas on ${firstTo.name}’s disk, no restart`,
  () => read(join(firstTo.root, '.design', 'ui', 'welcome.tsx')) !== null,
  180_000
);
const firstReachedS = Number(((Date.now() - firstAt) / 1000).toFixed(1));
console.log(`[rig] ${firstBy.name}’s first canvas reached ${firstTo.name} in ${firstReachedS}s`);
/** What `--scenario first` asserts: it IS the boot above, so its verdict is read from the boot. */
const firstVerdict = () => {
  // the arrival must be the empty copy's hub poll (p8-fix-c2 #1), not a process restart or a seed
  const viaPoll = /first canvas arrived from the hub/.test(firstTo.log());
  const bootedEmpty = [alice, bob].every((p) => /0 syncable canvases/.test(p.log()));
  return {
    ok: viaPoll && bootedEmpty,
    firstBy: firstBy.name,
    firstTo: firstTo.name,
    reachedInS: firstReachedS,
    viaPoll,
    bootedEmpty,
  };
};
const peers = { alice, bob };
const disk = (p, rel) => read(join(p.root, '.design', rel));
const syncStatus = async (p) => (await p.call('GET', '/_sync-status')).body;

async function seed(rel, title) {
  writeFileSync(join(aliceRoot, '.design', rel), SOURCE);
  writeFileSync(join(aliceRoot, '.design', rel.replace(/\.tsx$/, '.meta.json')), meta(title));
  await until(`${rel} on bob's disk`, () => ids(disk(bob, rel)).length === 4, 180_000);
}

async function trashList(p, rel) {
  const r = await p.call('GET', '/_api/trash');
  return (r.body?.items ?? []).filter((i) => i.kind === 'artboard' && i.path === rel);
}

async function restoreRun(n) {
  const rel = `ui/Letak${n}.tsx`;
  await seed(rel, `Letak${n}`);
  const t = await bob.call('POST', '/_api/edit-op', {
    file: rel,
    op: 'artboard.trash',
    targets: [],
    params: { artboards: ['flag-back', 'tackle-front', 'tackle-back'] },
  });
  if (t.status !== 200) throw new Error(`trash: ${t.status} ${JSON.stringify(t.body)}`);
  await until(
    'three in bob’s Trash',
    async () => (await trashList(bob, rel)).length === 3,
    120_000
  );
  await until('alice has one artboard', () => ids(disk(alice, rel)).length === 1, 120_000);
  // the hand edit: the last artboard leaves bob's file (an AI run, an editor, a pull)
  writeFileSync(
    join(bobRoot, '.design', rel),
    SOURCE.replace(/ {8}<DCArtboard[\s\S]*<\/DCArtboard>\n/, '')
  );
  // the hand edit reaches the project (and so alice) before anyone restores — as the e2e waits
  // for Saved — unless --settle N restores N ms after it instead
  if (SETTLE_MS) await sleep(SETTLE_MS);
  else await until('the hand edit at alice', () => ids(disk(alice, rel)).length === 0, 120_000);
  const restorer = peers[RESTORER];
  await until(
    `three in ${restorer.name}’s Trash`,
    async () => (await trashList(restorer, rel)).length === 3,
    120_000
  );
  const items = await trashList(restorer, rel);
  const answers = [];
  for (const it of items) {
    const r = await restorer.call('POST', '/_api/trash/restore', { id: it.id });
    answers.push(`${it.artboard}:${r.status}${r.body?.ok === false ? `/${r.body?.reason}` : ''}`);
  }
  // settle: every side must reach three
  const want = 3;
  let ok = true;
  try {
    await until(
      'three artboards everywhere',
      () => [disk(bob, rel), disk(alice, rel)].every((s) => ids(s).length === want),
      60_000
    );
  } catch {
    ok = false;
  }
  await sleep(3_000); // and still there a beat later (nothing undoes it)
  // (the cell's checkout holds no canvas source here — no studio child materializes it)
  const final = { bob: ids(disk(bob, rel)), alice: ids(disk(alice, rel)) };
  if (Object.values(final).some((v) => v.length !== want)) ok = false;
  return { ok, answers, final };
}

// F15 (v2-204) — the race's shape, varied per run so a series covers the orders a person meets:
//   --trasher alice|bob|mixed  who moves three artboards to the trash (default alice; the other peer is "the other")
//   --other trash|dup|text|text-trashed|mixed
//                           what the other peer does at the same time: trash the fourth, duplicate the fourth
//                           (adds an artboard), hand-edit the fourth's text, hand-edit a text inside an artboard
//                           the trasher removes; `mixed` picks one per run
//   --net offline|online|mixed  the cell away during both edits (default offline), or up the whole time
//   --order stop|jitter     `stop` (default, the original rig): the trasher is SIGSTOPped while the cell comes
//                           back; `jitter`: no SIGSTOP, a seeded random order and 0–2.5 s between the two edits
//   --restart-held          once the outcome is read, restart every studio that is apart and read it again — a
//                           conflict only in memory is lost there
const TRASHER = arg('trasher', 'alice');
const OTHER = arg('other', 'trash');
const NET = arg('net', 'offline');
const ORDER = arg('order', 'stop');
const RESTART_HELD = argv.includes('--restart-held');
const SEED = Number(arg('seed', '7'));
function rng(n) {
  // mulberry32 over (seed, run): the same series replays the same timings
  let t = (SEED * 1_000_003 + n * 7919) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
/** The hub's accepted html of `rel` (bootstrap lane hash → blob), or null when it cannot tell. */
async function hubIds(rel) {
  try {
    const h = { authorization: `Bearer ${hub.tokens.owner}` };
    const base = `${hub.http}/api/projects/current/v1`;
    const boot = await (await fetch(`${base}/bootstrap`, { headers: h })).json();
    const d = (boot.docs ?? []).find((x) => !x.retired && x.path === rel);
    const hash = d?.lanes?.html?.hash;
    if (!hash) return null;
    const blob = await (await fetch(`${base}/blobs/${hash}`, { headers: h })).json();
    return typeof blob?.body === 'string' ? ids(blob.body) : null;
  } catch {
    return null;
  }
}
async function cellAway() {
  hub.stop();
  await until('the cell to stop', async () => {
    try {
      await fetch(`${hub.http}/health`, { signal: AbortSignal.timeout(1_000) });
      return false;
    } catch {
      return true;
    }
  });
}
async function cellBack() {
  hub = await startLocalHub({
    dir: hubDir,
    port: hubPort,
    workspace: cellRepo,
    transactions: !LEGACY,
  });
}
async function restartStudio(p) {
  const i = children.indexOf(p.proc);
  p.proc.kill('SIGTERM');
  await new Promise((r) => (p.proc.exitCode !== null ? r() : p.proc.once('exit', r)));
  if (i >= 0) children.splice(i, 1);
  const next = await startStudio(p.name, p.root, join(scratch, `${p.name}-cfg`, 'hubs.json'));
  Object.assign(p, next);
}

async function raceRun(n) {
  const rel = `ui/Race${n}.tsx`;
  const r = rng(n);
  const trasher = (TRASHER === 'mixed' ? pick(r, ['alice', 'bob']) : TRASHER) === 'bob' ? bob : alice;
  const other = trasher === bob ? alice : bob;
  const otherDoes = OTHER === 'mixed' ? pick(r, ['trash', 'dup', 'text', 'text-trashed']) : OTHER;
  const net = NET === 'mixed' ? pick(r, ['offline', 'online']) : NET;
  const otherFirst = ORDER === 'jitter' && r() < 0.5;
  const gapMs = ORDER === 'jitter' ? Math.round(r() * 2_500) : 0;
  const shape = { trasher: trasher.name, otherDoes, net, order: ORDER, otherFirst, gapMs };
  await seed(rel, `Race${n}`);
  await until('alice has four', () => ids(disk(alice, rel)).length === 4, 60_000);
  await sleep(1_500);
  if (net === 'offline') await cellAway();
  const trash3 = () =>
    trasher.call('POST', '/_api/edit-op', {
      file: rel,
      op: 'artboard.trash',
      targets: [],
      params: { artboards: ['flag-front', 'flag-back', 'tackle-front'] },
    });
  const handEdit = (label) => {
    const p = join(other.root, '.design', rel);
    writeFileSync(p, read(p).replace(`<h1 style={{ padding: 16 }}>${label}</h1>`, `<h1 style={{ padding: 16 }}>${label} edited</h1>`));
    return Promise.resolve({ status: 'hand' });
  };
  const otherEdit = () =>
    otherDoes === 'trash'
      ? other.call('POST', '/_api/edit-op', {
          file: rel,
          op: 'artboard.trash',
          targets: [],
          params: { artboards: ['tackle-back'] },
        })
      : otherDoes === 'dup'
        ? other.call('POST', '/_api/edit-op', {
            file: rel,
            op: 'artboard.duplicate',
            targets: [],
            params: { items: [{ artboard: 'tackle-back', at: { x: 900, y: 0 } }] },
          })
        : handEdit(otherDoes === 'text' ? 'D' : 'A');
  let a;
  let b;
  if (ORDER === 'stop') {
    a = await trash3();
    process.kill(trasher.proc.pid, 'SIGSTOP');
    b = await otherEdit();
    if (net === 'offline') await cellBack();
    process.kill(trasher.proc.pid, 'SIGCONT');
  } else {
    const first = otherFirst ? otherEdit : trash3;
    const second = otherFirst ? trash3 : otherEdit;
    const p1 = first();
    await sleep(gapMs);
    const p2 = second();
    [a, b] = otherFirst ? [await p2, await p1] : [await p1, await p2];
    if (net === 'offline') {
      await sleep(Math.round(r() * 1_500));
      await cellBack();
    }
  }
  let converged = false;
  try {
    await until(
      'the two Macs equal',
      () => {
        const x = disk(alice, rel);
        const y = disk(bob, rel);
        return x !== null && x === y;
      },
      Number(arg('race-wait', '90000'))
    );
    converged = true;
  } catch {
    /* apart */
  }
  const [sa, sb] = [await syncStatus(alice), await syncStatus(bob)];
  // a held source conflict: the runtime's `source-conflict-<slug>` notice (what the Sync details'
  // Needs-you card reads) — with both versions kept (this disk + _history/<slug>/sync-recovery)
  const slug = rel
    .replace(/\//g, '-')
    .replace(/\.tsx$/, '')
    .toLowerCase();
  const conflicts = (s) =>
    (s?.notices ?? []).filter((n) => n?.id === `source-conflict-${slug}`).length;
  const kept = (p) =>
    read(join(p.root, '.design', '_history', slug, 'sync-recovery', 'incoming.tsx')) !== null;
  const final = {
    alice: ids(disk(alice, rel)),
    bob: ids(disk(bob, rel)),
    aliceConflicts: conflicts(sa),
    bobConflicts: conflicts(sb),
    aliceKeptTheirs: kept(alice),
    bobKeptTheirs: kept(bob),
    aliceOp: a.status,
    bobOp: b.status,
    hub: await hubIds(rel),
    shape,
    // a hand edit's words, where each side ended (lost everywhere with no conflict = dropped in silence)
    ...(otherDoes.startsWith('text')
      ? { editedAt: { alice: /edited</.test(disk(alice, rel) ?? ''), bob: /edited</.test(disk(bob, rel) ?? '') } }
      : {}),
  };
  // p8-held-conflict-status — the refused Mac's real /_sync-status through the Share cluster's own status
  // machine: a held conflict must read Not saved · Compare, never Saved. --status-out <file> keeps that
  // payload (tokens / scratch paths scrubbed) for test/fixtures/held-conflict-sync-status.json.
  for (const [who, st] of [
    ['alice', sa],
    ['bob', sb],
  ]) {
    const held = heldConflicts(st).map((c) => c.slug);
    if (!held.length) continue;
    const word = saveStatus({
      linked: true,
      online: true,
      phase: syncPresentation(st)?.phase ?? null,
      pending: Number(st?.queuedOps) || 0,
      held,
    });
    final[`${who}Status`] = `${word.word} · ${word.actions.map((x) => x.label).join(' · ')}`;
    const out = arg('status-out', '');
    if (out) {
      const scrub = JSON.stringify(st, null, 2)
        .replaceAll(scratch, '<scratch>')
        .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<port>')
        .replace(/"(token|key|secret)[^"]*":\s*"[^"]*"/gi, '"$1":"<scrubbed>"');
      writeFileSync(out, `${scrub}\n`);
    }
  }
  if (!converged && argv.includes('--dump')) {
    console.log('alice /_sync-status', JSON.stringify(await syncStatus(alice)).slice(0, 3000));
    console.log('bob /_sync-status', JSON.stringify(await syncStatus(bob)).slice(0, 3000));
  }
  // equal, or the side whose disk is not the project's shows the conflict with both versions kept
  const heldAt = (who) => final[`${who}Conflicts`] > 0 && final[`${who}KeptTheirs`];
  const sameAsHub = (who) => final.hub !== null && final[who].join(',') === final.hub.join(',');
  // equal (and the hub's), or the side apart shows the conflict with both versions kept while the other
  // side IS the project's version — two disks apart with nobody told is the F15 silent divergence
  let ok =
    (converged && (final.hub === null || sameAsHub('alice'))) ||
    (heldAt('alice') && (sameAsHub('bob') || heldAt('bob'))) ||
    (heldAt('bob') && (sameAsHub('alice') || heldAt('alice')));
  final.silent = !converged && !heldAt('alice') && !heldAt('bob');
  if (RESTART_HELD && !converged) {
    // a conflict that lives only in the runtime is gone after a restart: read every apart side again
    for (const p of [alice, bob]) if (!sameAsHub(p.name)) await restartStudio(p);
    await sleep(Number(arg('restart-wait', '30000')));
    const [ra, rb] = [await syncStatus(alice), await syncStatus(bob)];
    final.afterRestart = {
      alice: ids(disk(alice, rel)),
      bob: ids(disk(bob, rel)),
      aliceConflicts: conflicts(ra),
      bobConflicts: conflicts(rb),
    };
    const ar = final.afterRestart;
    const eq = disk(alice, rel) === disk(bob, rel);
    if (!eq && !(ar.aliceConflicts > 0 && kept(alice)) && !(ar.bobConflicts > 0 && kept(bob)))
      ok = false;
    // a conflict held before the restart that is gone after it, with nobody's choice: its side was
    // overwritten by the project's version in silence (the recovery copy is not a notice)
    for (const who of ['alice', 'bob'])
      if (heldAt(who) && ar[`${who}Conflicts`] === 0 && ar[who].join(',') !== final[who].join(',')) {
        ar.silentlyResolved = who;
        ok = false;
      }
  }
  return { ok, converged, final };
}

let pass = 0;
try {
  const FIRST = Number(arg('first', '1'));
  for (let n = FIRST; n < FIRST + RUNS; n++) {
    const t0 = Date.now();
    // a run that cannot reach its next step is a FAIL of that run, not the end of the series (each run
    // works on its own fresh canvas) — so the rate is honest
    const r = await (SCENARIO === 'first'
      ? Promise.resolve(firstVerdict())
      : SCENARIO === 'race'
        ? raceRun(n)
        : restoreRun(n)
    ).catch((e) => ({
      ok: false,
      error: String(e?.message ?? e),
    }));
    if (r.ok) pass++;
    else if (argv.includes('--dump') || SCENARIO === 'restore') {
      // the sync lines of both studios, so a failed run says why without --keep + a shell on the box
      const pick = (log) =>
        log
          .split('\n')
          .filter((l) => /\[(sync|projection)|refus|blocked|conflict|held/i.test(l))
          .slice(-40)
          .join('\n');
      console.log(
        `--- bob (sync lines) ---\n${pick(bob.log())}\n--- alice (sync lines) ---\n${pick(alice.log())}`
      );
    }
    console.log(
      `[${SCENARIO} ${n}/${RUNS}] ${r.ok ? 'PASS' : 'FAIL'} ${SCENARIO === 'first' ? `${firstReachedS}s (the boot)` : `${((Date.now() - t0) / 1000).toFixed(1)}s`} ${JSON.stringify(r)}`
    );
  }
} catch (e) {
  console.error(`[rig] ${e?.stack ?? e}`);
  console.error(
    `--- bob log ---\n${bob.log().slice(-4000)}\n--- alice log ---\n${alice.log().slice(-4000)}`
  );
} finally {
  console.log(`${SCENARIO}: ${pass}/${RUNS} pass  (scratch ${KEEP ? scratch : 'removed'})`);
  cleanup();
}
process.exit(pass === RUNS ? 0 : 1);
