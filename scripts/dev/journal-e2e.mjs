#!/usr/bin/env node
// End-to-end assertions against a RUNNING local cell (scripts/dev/local-cell.mjs).
//
// The unit suites already prove each piece in isolation. This proves the thing
// they cannot: that a real hub process, a real studio child, a real git
// checkout and a real object-storage target compose into the behaviour the arc
// promises — and it does so by acting as an ordinary peer, over the wire, with
// nothing stubbed.
//
//   node scripts/dev/journal-e2e.mjs --hub http://127.0.0.1:4599 --token mau_… --repo /tmp/…/repo
//
// Every check states what it proves, and a failure names the property rather
// than the assertion. Exits non-zero on the first failure.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const HUB = (arg('hub') ?? 'http://127.0.0.1:4599').replace(/\/+$/, '');
const TOKEN = arg('token');
const REPO = arg('repo');
if (!TOKEN || !REPO) {
  console.error('usage: journal-e2e.mjs --hub URL --token TOK --repo PATH   (see local-cell.mjs)');
  process.exit(2);
}
const DESIGN_ROOT = join(REPO, '.design');

let passed = 0;
const results = [];

function ok(what, detail = '') {
  passed += 1;
  results.push(`  ✔ ${what}${detail ? ` — ${detail}` : ''}`);
}
function fail(what, detail) {
  results.push(`  ✘ ${what}\n      ${detail}`);
  process.stdout.write(`${results.join('\n')}\n\n`);
  console.error(`FAILED after ${passed} passing check(s).`);
  process.exit(1);
}
function check(cond, what, detail) {
  if (cond) ok(what);
  else fail(what, detail);
}

const auth = { authorization: `Bearer ${TOKEN}` };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function journal(since = 0, epoch = null) {
  const q = new URLSearchParams({ since: String(since) });
  if (epoch) q.set('epoch', epoch);
  const res = await fetch(`${HUB}/api/journal?${q}`, { headers: auth });
  if (!res.ok) fail('GET /api/journal answers', `HTTP ${res.status}`);
  return res.json();
}

/** Wait until `probe()` returns truthy, or give up. Returns ms waited. */
async function until(probe, { timeoutMs = 15_000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return { ms: Date.now() - started, value: v };
    if (Date.now() - started > timeoutMs)
      fail(`waiting for ${label}`, `timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Attach to the reserved control document as an ordinary peer.
 *
 * Resolved from `apps/studio` because that is the workspace carrying
 * `@hocuspocus/provider`; a missing provider degrades this to a skipped check
 * rather than a failure, so the rest of the run still means something on a tree
 * with no studio deps installed.
 *
 * Returns `{ latest, close }`, or null with a reason.
 */
async function attachCtl() {
  let mod;
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(join(REPO_ROOT, 'apps/studio/package.json'));
    mod = await import(req.resolve('@hocuspocus/provider'));
  } catch (err) {
    return null_with(`@hocuspocus/provider not resolvable (${err.code ?? err.message})`);
  }
  const wsUrl = HUB.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  let latest = null;
  const provider = new mod.HocuspocusProvider({
    url: wsUrl,
    name: 'maude.files',
    token: TOKEN,
    onStateless: ({ payload }) => {
      try {
        const frame = JSON.parse(payload);
        if (frame?.t === 'files' && Number.isInteger(frame.head)) {
          // Keep ONLY what the receiver is allowed to believe, so the "carries
          // nothing else" assertion below is about the frame, not about us.
          const { t: _t, ...rest } = frame;
          latest = rest;
        }
      } catch {
        /* a malformed frame is the parser's problem, tested elsewhere */
      }
    },
  });
  // Give the handshake a moment; an unauthenticated attach simply never pokes.
  await new Promise((r) => setTimeout(r, 1200));
  return { latest: () => latest, close: () => provider.destroy() };
}
function null_with(why) {
  results.push(`  ⚠ control channel skipped — ${why}`);
  return null;
}

/**
 * Drive the real desktop engine against the running hub.
 *
 * A scratch design root stands in for a second machine: it starts empty, pulls
 * the project down, makes a local edit, pushes it back, and then proves the
 * two properties that matter most — a converged pass is free, and a
 * simultaneous edit on both sides parks rather than overwrites.
 */
async function fullLoop() {
  let createFileLedger;
  let createFilePlane;
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(join(REPO_ROOT, 'apps/studio/package.json'));
    void req;
    ({ createFileLedger } = await import(join(REPO_ROOT, 'apps/studio/sync/file-ledger.ts')));
    ({ createFilePlane } = await import(join(REPO_ROOT, 'apps/studio/sync/file-plane.ts')));
  } catch (err) {
    results.push(
      `  ⚠ full loop skipped — engine not importable under this runtime (${err.message})`
    );
    return;
  }

  const peer = mkdtempSync(join(tmpdir(), 'maude-peer-'));
  try {
    writeFileSync(
      join(peer, 'config.json'),
      JSON.stringify({ canvasGroups: [{ path: 'ui' }, { path: 'system' }] })
    );
    const ledger = createFileLedger({ designRoot: peer, hubUrl: HUB, flushMs: 0 });
    const mk = () =>
      createFilePlane({
        designRoot: peer,
        hubUrl: HUB,
        token: () => TOKEN,
        ledger,
        canvasGroups: [{ path: 'ui' }, { path: 'system' }],
        allowCodeModules: false,
        label: 'e2e-peer',
        log: { log() {}, warn() {} },
      });

    // ── down ────────────────────────────────────────────────────────────
    const first = await mk().reconcile();
    check(
      first.pulled.includes('system/smoke/brand.css'),
      'a fresh peer pulls the project down through the journal',
      `pulled ${JSON.stringify(first.pulled)}`
    );
    check(existsSync(join(peer, 'system/smoke/brand.css')), 'and the bytes are really on its disk');
    check(
      !existsSync(join(peer, 'ui/home.tsx')),
      'while the CANVAS stays on the doc plane',
      'a canvas arriving over the file lane means both transports own it — the duplicate jurisdiction the redesign exists to end'
    );

    // ── converged ───────────────────────────────────────────────────────
    const second = await mk().reconcile();
    check(
      second.pulled.length === 0 && second.pushed.length === 0,
      'a converged pass moves nothing',
      `pulled ${second.pulled.length}, pushed ${second.pushed.length}`
    );
    check(second.synced > 0, 'and says so positively rather than by silence');

    // ── up ──────────────────────────────────────────────────────────────
    const edited = `:root{--edited-by-e2e:${Date.now()}}\n`;
    writeFileSync(join(peer, 'system/smoke/brand.css'), edited);
    ledger.noteChanged('system/smoke/brand.css');
    const third = await mk().reconcile();
    check(
      third.pushed.includes('system/smoke/brand.css'),
      'a local edit travels UP through the same lane',
      `pushed ${JSON.stringify(third.pushed)}`
    );
    const onHub = await (
      await fetch(`${HUB}/_project-file/system/smoke/brand.css`, { headers: auth })
    ).text();
    check(onHub === edited, 'and the hub really holds the new bytes');

    // ── both sides at once ──────────────────────────────────────────────
    const theirs = ':root{--changed-on-the-hub:1}\n';
    await fetch(`${HUB}/api/file/system/smoke/brand.css`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'text/css' },
      body: theirs,
    });
    const mine = ':root{--changed-here-too:1}\n';
    writeFileSync(join(peer, 'system/smoke/brand.css'), mine);
    ledger.noteChanged('system/smoke/brand.css');

    const clash = await mk().reconcile();
    check(
      clash.conflicts.length === 1,
      'a simultaneous edit resolves as ONE conflict, not a merge'
    );
    const parked = readdirSync(join(peer, 'system/smoke')).find((n) =>
      n.includes('maude-conflict')
    );
    check(
      parked !== undefined,
      'the local version is parked where a person can find it',
      `dir held ${readdirSync(join(peer, 'system/smoke')).join(', ')}`
    );
    check(
      readFileSync(join(peer, 'system/smoke', parked ?? 'x'), 'utf8') === mine,
      'the parked copy is the LOCAL bytes, unmodified'
    );
    check(
      readFileSync(join(peer, 'system/smoke/brand.css'), 'utf8') === theirs,
      'and the canonical path now holds the hub version'
    );
    check(
      !readdirSync(join(peer, 'system/smoke')).some((n) => n.includes('sync-conflict')),
      'the copy is never named like Syncthing’s',
      '`~/git` runs real Syncthing; an identical pattern makes a conflict unattributable'
    );

    // ── the doručenka ───────────────────────────────────────────────────
    const states = mk().doruceka();
    check(
      states['system/smoke/brand.css'] === 'conflict',
      'and the doručenka says exactly that about exactly that file',
      `state was ${states['system/smoke/brand.css']}`
    );
  } finally {
    rmSync(peer, { recursive: true, force: true });
  }
}

async function main() {
  process.stdout.write(`\n  local cell end-to-end — ${HUB}\n\n`);

  /* 1 ── the capability the whole compat matrix hangs on ------------------ */
  const health = await (await fetch(`${HUB}/health`)).json();
  check(
    Array.isArray(health.capabilities) && health.capabilities.includes('ledger'),
    'the hub advertises `ledger` in /health',
    `capabilities was ${JSON.stringify(health.capabilities)} — a client gates its whole journal path on this, so without it nothing downstream even attaches`
  );

  /* 2 ── the walk-import reconciler indexed the checkout it was handed ---- */
  const boot = await journal(0);
  check(typeof boot.epoch === 'string' && boot.epoch.length > 0, 'the journal has an epoch');
  const paths = boot.entries.map((e) => e.path);
  for (const expected of [
    'assets/smoke-mark.svg',
    'system/smoke/brand.css',
    'system/smoke/README.md',
    'system/smoke/assets/logo.svg',
    'system/smoke/preview/_brand-css.ts',
  ]) {
    check(
      paths.includes(expected),
      `walk-import indexed ${expected}`,
      `the checkout carries it but the journal does not. The reconciler is the TRUTH and the write hooks are the optimization — a gap here means a file peers can never learn about. Journal has: ${paths.join(', ')}`
    );
  }

  /* 3 ── and it did NOT index plane A ------------------------------------- */
  check(
    !paths.some((p) => p === 'ui/home.tsx' || p === 'ui/home.meta.json'),
    'the canvas and its sidecar are ABSENT from the journal',
    `the planes are disjoint at classification (DDR-226 §1) — a canvas in the file journal means it could travel on two transports at once, which is the duplicate-jurisdiction bug the redesign exists to end. Journal has: ${paths.join(', ')}`
  );
  check(
    !paths.includes('config.json'),
    'config.json never enters the journal',
    'config.json is `never`-class — a hub that can write it can re-point the sync socket'
  );

  /* 3.5 ── attach the control channel, as a real peer over a real socket -- */
  //
  // This is the check the unit suites cannot make: the hub really emits, a real
  // `@hocuspocus/provider` really receives, and the frame really parses. The
  // whole watcher-gap fix rests on it.
  const ctl = await attachCtl();
  check(ctl !== null, 'a peer can attach the `maude.files` control channel', ctl?.why ?? '');

  /* 4 ── a real write through a real door lands a real row ---------------- */
  const bytes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!--${Date.now()}--><path d="M4 4h16v16H4z"/></svg>\n`
  );
  const rel = 'system/smoke/assets/pushed.svg';
  const headBefore = boot.head;

  const put = await fetch(`${HUB}/_asset-file/${rel}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'image/svg+xml' },
    body: bytes,
  });
  check(put.ok, 'a peer PUT through the checkout door is accepted', `HTTP ${put.status}`);

  /* 4.5 ── …and the hub POKES, unprompted, within the coalescing window --- */
  if (ctl) {
    const { value: poke, ms } = await until(() => ctl.latest(), {
      label: 'a poke to arrive on the control channel',
      timeoutMs: 10_000,
    });
    ok('the hub pokes a peer after an accepted write', `${ms} ms after the PUT`);
    check(
      poke.head > headBefore,
      'the poke carries a head PAST what the peer already had',
      `head ${poke.head} vs the peer's ${headBefore} — a poke that does not move the head tells a peer nothing`
    );
    check(
      Object.keys(poke).join(',') === 'head',
      'and it carries NOTHING else',
      `frame was ${JSON.stringify(poke)} — the channel must not be able to name a path or a hash (DDR-054: the hub is untrusted to peers)`
    );
  }

  const { value: after } = await until(
    async () => {
      const page = await journal(headBefore);
      return page.entries.find((e) => e.path === rel) ? page : null;
    },
    { label: 'the pushed file to appear in the journal' }
  );
  const row = after.entries.find((e) => e.path === rel);
  check(
    row.sha256 === sha256(bytes),
    'the row carries the hash of what is ON DISK',
    `row said ${row.sha256}`
  );
  check(row.size === bytes.length, 'and its real size', `row said ${row.size}`);
  check(
    row.class === 'inert-media',
    'classified by the receiver, not by the sender',
    `got ${row.class}`
  );
  check(
    existsSync(join(DESIGN_ROOT, rel)),
    'the bytes are in the checkout',
    'the row exists but the file does not — the journal must never describe a file that is not there'
  );

  /* 5 ── pushing the SAME bytes again is free ----------------------------- */
  const headAfterFirst = after.head;
  const put2 = await fetch(`${HUB}/_asset-file/${rel}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'image/svg+xml' },
    body: bytes,
  });
  check(put2.ok, 'an idempotent re-push is accepted');
  await new Promise((r) => setTimeout(r, 600));
  const afterRepush = await journal(0);
  check(
    afterRepush.head === headAfterFirst,
    'identical bytes append NO row',
    `head moved ${headAfterFirst} → ${afterRepush.head}. Same-hash must be a no-op, or every idempotent sweep wakes every peer for nothing`
  );

  /* 6 ── the cursor fails CLOSED ------------------------------------------ */
  const wrongEpoch = await journal(0, 'not-this-epoch');
  check(
    wrongEpoch.reanchor === true,
    'a foreign epoch answers `reanchor`',
    'an epoch mismatch answering an ordinary page is how a stale peer comes to believe it is current'
  );
  const future = await journal(afterRepush.head + 500);
  check(future.reanchor === true, 'a cursor from the future answers `reanchor`');
  const atHead = await journal(afterRepush.head);
  check(
    atHead.reanchor !== true && atHead.entries.length === 0,
    'a cursor AT the head is an ordinary empty page',
    'the converged steady state must be cheap and must not look like an error'
  );

  /* 7 ── the tail is on "object storage" ---------------------------------- */
  // The path is derived the same way the hub derives it, so a change to the
  // key shape fails here rather than silently in a restore six weeks later.
  const backupDir = join(REPO, '..', 'object-storage');
  const tailPath = join(backupDir, 'journal/tail.ndjson');
  const readTail = () => {
    if (!existsSync(tailPath)) return [];
    return (
      readFileSync(tailPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        // p8-holds-fix: the tail also carries one `{ holds: [...] }` line (the class-hold set).
        .filter((r) => !('holds' in r && !('seq' in r)))
    );
  };
  // Wait for the ROW, not for the FILE. The tail is written behind on a 2 s
  // debounce and the file already exists from the boot walk-import, so a probe
  // that stops at `existsSync` reads a stale tail and reports a durability bug
  // that isn't there. (It did exactly that the first time this ran.)
  const { value: tailRows, ms: tailMs } = await until(
    () => {
      const rows = readTail();
      return rows.some((r) => r.path === rel && r.sha256 === sha256(bytes)) ? rows : null;
    },
    { label: 'the pushed row to reach the journal tail' }
  );
  ok('the pushed row reaches the R2 tail', `${tailMs} ms after the write`);
  check(
    tailRows.every((r) => Number.isInteger(r.seq) && r.seq > 0),
    'every tail line carries the seq peers checkpointed against'
  );
  check(
    tailRows.find((r) => r.path === rel)?.source === 'peer-put',
    'and it records WHERE the write came from',
    'the source is forensics: "a desktop pushed it" and "it came back from the bucket after a wake" are different facts'
  );

  /* 8 ── the untrusted-nudge route tells a caller nothing ----------------- */
  const present = await fetch(`${HUB}/api/journal/report`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [rel] }),
  });
  const absent = await fetch(`${HUB}/api/journal/report`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ paths: ['assets/definitely-not-here.png'] }),
  });
  if (present.ok && absent.ok) {
    const a = JSON.stringify(await present.json());
    const b = JSON.stringify(await absent.json());
    check(
      a === b,
      'the nudge route is not an existence oracle',
      `a path that exists answered ${a} and one that does not answered ${b} — that difference is a filesystem probe over the customer's project for anyone who reaches the route`
    );
  } else {
    // Off-loopback it 404s, which is the other correct answer.
    check(
      present.status === 404 && absent.status === 404,
      'the nudge route is loopback-only',
      `got ${present.status} / ${absent.status}`
    );
  }

  /* 9 ── an out-of-band write is caught, not lost ------------------------- */
  //
  // Exactly the shape of a git-level restore or a write site nobody hooked.
  // The permanent belt catches it too, but on a 15-minute timer — too slow to
  // assert here, so this drives the same code path through the nudge and the
  // belt's own coverage lives in the hub unit suite.
  const oob = 'system/smoke/out-of-band.css';
  execFileSync('/bin/sh', [
    '-c',
    `printf ':root{--oob:1}\\n' > ${JSON.stringify(join(DESIGN_ROOT, oob))}`,
  ]);
  const nudge = await fetch(`${HUB}/api/journal/report`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [oob] }),
  });
  if (nudge.ok) {
    const { value: withOob } = await until(
      async () => {
        const page = await journal(0);
        return page.entries.find((e) => e.path === oob) ? page : null;
      },
      { label: 'the out-of-band file to be journalled', timeoutMs: 8000 }
    );
    const oobRow = withOob.entries.find((e) => e.path === oob);
    check(
      oobRow.class === 'companion-text',
      'an out-of-band write gets a row on nudge',
      `class ${oobRow.class}`
    );
  } else {
    ok('the nudge route refused an off-loopback caller (404) — belt covers this case');
  }

  /* 10 ── the FULL LOOP: a real ledger, a real engine, both directions ---- */
  //
  // Everything above tests the hub. This drives the DESKTOP engine — the same
  // `createFilePlane` a linked project runs — against this live hub, so the
  // thing being proven is the loop rather than either half of it.
  await fullLoop();

  process.stdout.write(`${results.join('\n')}\n\n`);
  ctl?.close();
  process.stdout.write(`  ${passed} checks passed.\n\n`);
  process.stdout.write(
    `  What this did NOT prove — these need a human and a browser:\n` +
      `    · the HEAL. Start the cell with --no-watch, open a canvas in the studio child,\n` +
      `      PUT an asset it references, and the broken frame must repair itself with NO\n` +
      `      reload. Without --no-watch macOS's own watcher does that job and the run\n` +
      `      proves nothing about the fix.\n` +
      `    · the desktop's own latency: link a desktop, drop a file in the cloud browser,\n` +
      `      and it should land in seconds rather than on the 20 s tick.\n\n`
  );
}

main().catch((err) => {
  process.stdout.write(`${results.join('\n')}\n\n`);
  console.error(`journal-e2e: ${err.stack ?? err.message}`);
  process.exit(1);
});
