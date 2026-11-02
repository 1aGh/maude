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

async function raceRun(n) {
  const rel = `ui/Race${n}.tsx`;
  await seed(rel, `Race${n}`);
  await until('alice has four', () => ids(disk(alice, rel)).length === 4, 60_000);
  await sleep(1_500);
  hub.stop();
  await until('the cell to stop', async () => {
    try {
      await fetch(`${hub.http}/health`, { signal: AbortSignal.timeout(1_000) });
      return false;
    } catch {
      return true;
    }
  });
  const a = await alice.call('POST', '/_api/edit-op', {
    file: rel,
    op: 'artboard.trash',
    targets: [],
    params: { artboards: ['flag-front', 'flag-back', 'tackle-front'] },
  });
  process.kill(alice.proc.pid, 'SIGSTOP');
  const b = await bob.call('POST', '/_api/edit-op', {
    file: rel,
    op: 'artboard.trash',
    targets: [],
    params: { artboards: ['tackle-back'] },
  });
  hub = await startLocalHub({
    dir: hubDir,
    port: hubPort,
    workspace: cellRepo,
    transactions: !LEGACY,
  });
  process.kill(alice.proc.pid, 'SIGCONT');
  let converged = false;
  try {
    await until(
      'the two Macs equal',
      () => {
        const x = ids(disk(alice, rel)).join(',');
        const y = ids(disk(bob, rel)).join(',');
        return x === y;
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
  const ok =
    converged ||
    (final.aliceConflicts > 0 && final.aliceKeptTheirs) ||
    (final.bobConflicts > 0 && final.bobKeptTheirs);
  return { ok, converged, final };
}

let pass = 0;
try {
  for (let n = 1; n <= RUNS; n++) {
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
