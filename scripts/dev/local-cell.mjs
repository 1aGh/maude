#!/usr/bin/env node
// A LOCAL CELL — the sync stack on your laptop, from source.
//
// A Maude "cell" is not a special program. It is this repo's hub running in
// workspace mode: it owns a git checkout, supervises a studio child over
// loopback, journals every file write, and mirrors to object storage. The
// Cloudflare parts (the Worker, the Durable Object, R2) are transport and
// durability around exactly that. So the whole sync arc — the journal, the
// poke, the heal, the tail, the restore drill — is reproducible here, against
// a scratch repo, with no account and no network.
//
// What this stands up:
//
//   • a scratch git repo with a real `.design/` project (canvas + design
//     system + an asset), so the classifier has a genuine tree to judge
//     rather than a fixture that flatters it;
//   • the hub from SOURCE in workspace mode, with a peer token minted for you;
//   • a `file://` backup target, so the journal tail and the restore drill are
//     the real code paths and not stubs;
//   • the studio child the hub supervises, which is what a browser talks to.
//
// ── The one flag that matters ────────────────────────────────────────────────
//
// `--no-watch` sets MAUDE_NO_WATCH=1 on the studio child. The container
// watcher gap is inotify-specific: on macOS `fs.watch` DOES fire for the
// atomic tmp+rename writes the hub makes, so an open canvas would heal on a
// laptop whether or not the Sync v2 control channel works at all. With the
// watcher gone, the poke is the ONLY way anything downstream can learn a file
// landed — which is the cell's real situation, and the difference between
// testing the fix and testing around it.
//
// USE IT. A green run without `--no-watch` proves almost nothing about the
// thing this arc changed.
//
//   node scripts/dev/local-cell.mjs --no-watch
//
// Then, in a second terminal, link a desktop to it — the command is printed on
// boot — and run `pnpm dev:desktop`.

import { spawn } from 'node:child_process';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

if (has('help')) {
  process.stdout.write(`local-cell — the sync stack on your laptop, from source

  --dir PATH      where to put the scratch cell (default: a fresh temp dir)
  --port N        hub port (default 4599)
  --no-watch      run the studio child WITHOUT its filesystem watcher, so the
                  container watcher gap is reproduced and the control channel
                  is the only path a file arrival can travel. Use this.
  --no-events     also disable the control channel (MAUDE_FILE_EVENTS=0) — the
                  before picture: with --no-watch this is the bug, live.
  --no-peer       skip the desktop-side project (cloud side only)
  --keep          do not delete the scratch dir on exit
  --help

Prepared for you on boot:

  • the CLOUD side  — this hub, serving the project a browser opens
  • the DESKTOP side — a SECOND project directory, already linked to this hub
                       with its own token, so 'pnpm dev:desktop' opens a real
                       peer rather than a solo project

Credentials live in a scratch hubs.json inside the run directory, so your own
config store is never read or written.
`);
  process.exit(0);
}

const port = Number(arg('port', '4599'));
const keep = has('keep');
const root = arg('dir') ? resolve(arg('dir')) : mkdtempSync(join(tmpdir(), 'maude-local-cell-'));
const repoDir = join(root, 'repo');
const dataDir = join(root, 'data');
const backupDir = join(root, 'object-storage');
const designRoot = join(repoDir, '.design');
/** The DESKTOP side: a second machine, in a second directory. */
const peerRepo = join(root, 'desktop-project');
const peerDesign = join(peerRepo, '.design');
/** Scratch credential store — your real ~/.config/maude is never touched. */
const hubsConfig = join(root, 'hubs.json');
const ADMIN_EMAIL = 'you@local.test';
const ADMIN_PASSWORD = 'local-cell-password';

/* ------------------------------------------------------------ the project */

function seedProject() {
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, 'system/smoke/preview'), { recursive: true });
  mkdirSync(join(designRoot, 'system/smoke/assets'), { recursive: true });
  mkdirSync(join(designRoot, 'assets'), { recursive: true });

  writeFileSync(
    join(designRoot, 'config.json'),
    `${JSON.stringify(
      {
        name: 'local-cell-smoke',
        // `label` is REQUIRED by config.schema.json, and omitting it is not a
        // cosmetic slip: the client renders `group.label.toUpperCase()`, so a
        // group without one throws before React mounts and the whole app is a
        // white screen with nothing in the log. Cost an afternoon once.
        canvasGroups: [
          { label: 'Canvases', path: 'ui' },
          { label: 'Design system', path: 'system' },
        ],
        designSystems: [{ name: 'smoke', path: 'system/smoke' }],
      },
      null,
      2
    )}
\n`
  );

  // A canvas — plane A. It must NOT appear in the journal; the two planes are
  // disjoint at classification, and this is the tree that proves it.
  writeFileSync(
    join(designRoot, 'ui/home.tsx'),
    `export default function Home() {
  return (
    <main style={{ padding: 48, fontFamily: 'system-ui' }}>
      <h1>Local cell smoke</h1>
      {/* The asset below is the one the journal should carry. */}
      <img src="assets/smoke-mark.svg" alt="" width={96} height={96} />
    </main>
  );
}
`
  );
  writeFileSync(
    join(designRoot, 'ui/home.meta.json'),
    `${JSON.stringify({ title: 'Home', kind: 'web' }, null, 2)}\n`
  );

  // Plane B, all three flowing classes.
  writeFileSync(
    join(designRoot, 'system/smoke/brand.css'),
    ':root { --bg-0: #0b0b0c; --fg-0: #f5f5f4; --accent: #7c5cff; }\n'
  );
  writeFileSync(
    join(designRoot, 'system/smoke/README.md'),
    '# Smoke design system\n\nA real tree for the classifier to judge.\n'
  );
  writeFileSync(
    join(designRoot, 'system/smoke/preview/_brand-css.ts'),
    'export const brand = { accent: "#7c5cff" };\n'
  );
  writeFileSync(
    join(designRoot, 'system/smoke/assets/logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>\n'
  );
  writeFileSync(
    join(designRoot, 'assets/smoke-mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6"/></svg>\n'
  );
}

/**
 * The DESKTOP side — a second machine, prepared so `pnpm dev:desktop` opens a
 * real peer instead of a solo project.
 *
 * It gets its OWN token and its own `.design/`, and it starts almost empty on
 * purpose: watching a project arrive is the clearest way to see the file plane
 * work, and "a fresh peer pulls the project down" is the path a new machine
 * actually takes.
 */
function seedPeer(token) {
  mkdirSync(join(peerDesign, 'ui'), { recursive: true });
  writeFileSync(
    join(peerDesign, 'config.json'),
    `${JSON.stringify(
      {
        name: 'desktop-side',
        // See the note in `seedProject` — a missing label is a white screen.
        canvasGroups: [
          { label: 'Canvases', path: 'ui' },
          { label: 'Design system', path: 'system' },
        ],
        linkedHub: {
          url: `http://127.0.0.1:${port}`,
          linkedAt: Date.now(),
          // The file plane is opt-in this release; the whole point of this run
          // is to exercise it, so it is on.
          syncFiles: true,
        },
      },
      null,
      2
    )}\n`
  );
  // One canvas, so the CRDT doc lanes have something to carry too — the two
  // planes running side by side is the thing worth watching.
  writeFileSync(
    join(peerDesign, 'ui/desktop-home.tsx'),
    `export default function DesktopHome() {
  return (
    <main style={{ padding: 48, fontFamily: 'system-ui' }}>
      <h1>Desktop side</h1>
      <p>Edit me, or drop a picture on me, and watch the cloud.</p>
    </main>
  );
}
`
  );
  writeFileSync(
    join(peerDesign, 'ui/desktop-home.meta.json'),
    `${JSON.stringify({ title: 'Desktop home', kind: 'web' }, null, 2)}\n`
  );
  // The credential, in a scratch store keyed by hub URL — the same shape
  // `maude design link` writes, minus touching your real one.
  writeFileSync(
    hubsConfig,
    `${JSON.stringify(
      {
        hubs: {
          [`http://127.0.0.1:${port}`]: { token, linkedAt: Date.now(), role: 'owner' },
        },
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
}

function run(cmd, args, opts = {}) {
  const r = spawn(cmd, args, { stdio: 'ignore', ...opts });
  return new Promise((res, rej) => {
    r.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    r.on('error', rej);
  });
}

async function seedRepo() {
  mkdirSync(repoDir, { recursive: true });
  await run('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  // The hub commits as itself; give it an identity so nothing prompts.
  await run('git', ['config', 'user.email', 'cell@local'], { cwd: repoDir });
  await run('git', ['config', 'user.name', 'Local Cell'], { cwd: repoDir });
  seedProject();
  // The same ignore block `maude init` writes. Without it the scratch repo
  // counts `_state/`, `_history/`, `_server.json` and every other per-machine
  // runtime path as project content (DDR-115), so `git status` is permanently
  // dirty and "did the commit capture the work" becomes unanswerable — a
  // question this cell exists to answer.
  const { writeGitignoreBlock } = await import(join(REPO_ROOT, 'cli/lib/gitignore-block.mjs'));
  writeGitignoreBlock(repoDir, { designRel: '.design' });
  await run('git', ['add', '-A'], { cwd: repoDir });
  await run('git', ['commit', '-q', '-m', 'seed: local cell smoke project'], { cwd: repoDir });
}

/* --------------------------------------------------------------- the token */

/**
 * Is this run directory an EXISTING cell we should resume?
 *
 * A cell you cannot restart is a cell you cannot leave running while you work,
 * and re-seeding would mint a second token while the desktop side still holds
 * the first — the peer would 401 against its own hub for no reason a person
 * could see. So a directory that already has a token store and a credential
 * file is resumed: same repo, same token, same journal, same object storage.
 */
function existingRun() {
  if (!existsSync(join(dataDir, 'tokens.db')) || !existsSync(hubsConfig)) return null;
  try {
    const parsed = JSON.parse(readFileSync(hubsConfig, 'utf8'));
    const entry = parsed?.hubs?.[`http://127.0.0.1:${port}`];
    return typeof entry?.token === 'string' && entry.token ? entry.token : null;
  } catch {
    return null;
  }
}

async function mintToken() {
  const { addToken } = await import(join(REPO_ROOT, 'apps/hub/src/tokens.mjs'));
  // `addToken` MINTS the value — it does not accept one. (The raw token is
  // never stored; only its HMAC is, so there is no way to hand one in.) Use
  // what it returns, or every request 401s with a token nothing ever saw.
  // `scope: '*'` because a local desktop opens every document in the project.
  const { value } = addToken(dataDir, { label: 'local-desktop', scope: '*' });
  return value;
}

/* ----------------------------------------------------------------- the run */

const line = (s = '') => process.stdout.write(`${s}\n`);

async function main() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  line(`[local-cell] scratch dir: ${root}`);
  const resumed = existingRun();
  const withPeer = !has('no-peer');
  let token;
  if (resumed) {
    token = resumed;
    line('[local-cell] resuming the existing cell — same repo, token, journal and storage');
  } else {
    await seedRepo();
    line('[local-cell] seeded a real .design/ project (canvas + DS + assets)');
    token = await mintToken();
    if (withPeer) {
      seedPeer(token);
      line('[local-cell] prepared the desktop-side project (linked, syncFiles on)');
    }
  }

  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    // Workspace mode IS what makes this a cell: the hub owns the checkout,
    // supervises the studio child, and journals every accepted write.
    MAUDE_WORKSPACE_MODE: '1',
    HUB_WORKSPACE_MODE: '1',
    MAUDE_REPO_DIR: repoDir,
    MAUDE_DESIGN_ROOT: '.design',
    // THE ADDRESS THE PERSON IS ACTUALLY AT — not the bound one.
    //
    // `upstreamHeaders` DROPS the incoming Host ("identity comes from
    // configuration", D4) and sets `host` from this URL, so this value IS what
    // the studio child believes it is. `sameOriginWrite` then compares the
    // browser's Origin against that host — bare, with no env in the middle.
    //
    // Pointing this at loopback while telling people to browse
    // `studio.cell.localhost` (as the banner below does, because the canvas
    // capability cookie is SameSite=Strict and 127.0.0.1 is a different site)
    // makes those two hosts disagree on every request. Reads are unaffected, so
    // the rig looks healthy right up until the first write: creating a canvas or
    // a folder answered `403 cross-origin write rejected`, which reads as broken
    // creation rather than as a hostname mismatch. Naming the customer-facing
    // host here is exactly what D4 asks for.
    HUB_PUBLIC_URL: `http://studio.cell.localhost:${port}`,
    HUB_INSECURE_HTTP: '1',
    // Object storage as a directory — the journal tail, the backup generations
    // and the restore drill all run their real code paths against it.
    MAUDE_BACKUP_TARGET: `file://${backupDir}`,
    // Fast enough to watch a generation roll while you are sitting there.
    MAUDE_BACKUP_INTERVAL_MS: String(2 * 60_000),
    // A dev checkout resolves dev modules the containment assert would refuse.
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    // A browser needs somebody to sign in AS. Seeded on first boot only; the
    // password is printed below because this hub is loopback-only and
    // throwaway by construction.
    MAUDE_ADMIN_EMAIL: ADMIN_EMAIL,
    MAUDE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    // Canvas render tokens are HMAC'd with this. Without it the studio still
    // loads, but every canvas-origin capability (live collab, annotations)
    // stays unauthenticated — and a local cell exists precisely to exercise
    // those. Fixed, not random: a rotating secret would invalidate the browser
    // sessions of a cell you restart while working.
    HUB_SECRET: 'local-cell-secret-not-for-production',
    // LIVE PAIRING ON.
    //
    // Without it the hub mints no loopback credential, so the studio child
    // runs with no doc-lane sync at all: a canvas created in the cloud browser
    // lives on the cell's disk and never becomes a Y.Doc, so no desktop can
    // ever learn it exists. The FILE plane still works (that is a different
    // lane) — which makes the half-working result especially confusing to look
    // at, since the design system crosses and the canvases do not.
    //
    // On the fleet this is the `CELL_LIVE_PAIRING` pilot allowlist. A local
    // cell exists to exercise both planes, so it is on here.
    MAUDE_CELL_PAIRING: '1',
    // THE CANVAS ORIGIN GOES THROUGH THE HUB'S DOOR, like the fleet's does.
    //
    // Without this the studio child serves its canvas origin RAW on a random
    // loopback port and the shell embeds it directly — no door, no capability
    // exchange, no injected role header. `projectReadOnly` in workspace mode
    // deliberately fails CLOSED without that header, so every canvas-origin
    // write answered 403 viewer: a person drew on the cloud canvas, the stroke
    // rendered from iframe memory, the PUT was silently refused, and the next
    // doc-lane materialisation erased it — which reads exactly like "desktop
    // keeps overwriting my cloud drawings".
    //
    // `canvas.localhost` resolves to loopback in every Chromium/WebKit build
    // (RFC 6761 treats *.localhost specially), so the hub recognises the Host,
    // runs the real canvas door (token → cookie → role), and proxies to the
    // child's canvas port — the same topology as canvas.<zone> on the fleet,
    // which also makes the local rig honest about origin isolation.
    // …and the two hostnames MUST be SAME-SITE, mirroring the fleet
    // (`canvas.<zone>` next to the project's own `<zone>` hostname). The
    // capability cookie is `SameSite=Strict` on purpose, and "site" is the
    // registrable domain: `canvas.localhost` embedded in a page served from
    // `127.0.0.1` is CROSS-site, so the browser never attaches the cookie to
    // the iframe's own fetches — the canvas RENDERS (module/CSS URLs carry
    // `?t=`) while every ambient read (annotations, tenant-referenced assets)
    // quietly 401s, which looks exactly like "cloud shows different content".
    // Under `cell.localhost`, `studio.` and `canvas.` share eTLD+1 and the
    // cookie flows, same as production. Chromium resolves any `*.localhost`
    // to loopback, so nothing needs /etc/hosts.
    MAUDE_PUBLIC_CANVAS_ORIGIN: `http://canvas.cell.localhost:${port}`,
    // Both shell spellings may embed the canvas: the same-site name (where the
    // capability cookie flows) and loopback (tooling, e2e, old bookmarks —
    // which render but cannot carry the ambient cookie; see the banner).
    MAUDE_EXTRA_SHELL_ORIGINS: `http://studio.cell.localhost:${port}`,
    // The studio child's port is otherwise a hardcoded 4399, so a SECOND local
    // cell silently fights the first one for it: the child loses the bind,
    // walks to the next free port, and the hub goes on proxying to a child that
    // belongs to the other cell — a different project, served under this one's
    // URL. Deriving it keeps the default run byte-identical (4599 → 4399) and
    // makes every other port self-consistent. An explicit env still wins.
    MAUDE_STUDIO_PORT: process.env.MAUDE_STUDIO_PORT ?? String(port - 200),
    ...(has('no-watch') ? { MAUDE_NO_WATCH: '1' } : {}),
    ...(has('no-events') ? { MAUDE_FILE_EVENTS: '0' } : {}),
  };

  const hub = spawn('node', [join(REPO_ROOT, 'apps/hub/src/server.mjs')], {
    env,
    stdio: 'inherit',
  });

  const base = `http://127.0.0.1:${port}`;
  setTimeout(() => {
    line();
    line('  ── local cell up ────────────────────────────────────────────────');
    line();
    line('  THE CLOUD SIDE — open this in a browser:');
    line();
    line(`      http://studio.cell.localhost:${port}`);
    line();
    line('      (NOT 127.0.0.1 — the canvas capability cookie is same-site');
    line('       scoped like production, and 127.0.0.1 is a different site,');
    line('       so annotations and tenant assets would silently not render.)');
    line(`      sign in as   ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
    line();
    if (withPeer) {
      line('  THE DESKTOP SIDE — already linked to that hub. Launch it with:');
      line();
      line(`      HUBS_CONFIG_PATH=${hubsConfig} \\`);
      line(`      MAUDE_PROJECT_ROOT=${peerRepo} \\`);
      line('      pnpm dev:desktop');
      line();
    }
    line(
      `  watcher     ${has('no-watch') ? 'OFF — the container gap, reproduced. The poke is the ONLY way an arrival becomes visible.' : 'ON — macOS fires for tmp+rename, so the poke is NOT isolated'}`
    );
    line(`  file events ${has('no-events') ? 'OFF — the BEFORE picture' : 'ON'}`);
    line(`  project     ${repoDir}`);
    line(`  storage     ${backupDir}`);
    line(`  peer token  ${token}`);
    line();
    line('  Watch it work:');
    line();
    line(`      curl -s ${base}/health | jq .capabilities`);
    line(
      `      curl -s -H 'authorization: Bearer ${token}' '${base}/api/journal?since=0' | jq '.head, (.entries|length)'`
    );
    line(`      cat ${join(backupDir, 'journal/tail.ndjson')} | tail -3`);
    if (withPeer) {
      line(`      cat ${join(peerDesign, '_sync.json')} | jq .files      # the doručenka`);
    }
    line();
    line('  Assert the whole loop automatically:');
    line();
    line(`      node scripts/dev/journal-e2e.mjs --hub ${base} --token ${token} --repo ${repoDir}`);
    line();
    line('  ─────────────────────────────────────────────────────────────────');
    line();
  }, 2500);

  const bye = () => {
    hub.kill('SIGTERM');
    if (!keep) {
      setTimeout(() => {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        process.exit(0);
      }, 1500);
    } else {
      line(`\n[local-cell] kept ${root}`);
      setTimeout(() => process.exit(0), 1500);
    }
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  hub.on('exit', (code, signal) => {
    line(`[local-cell] hub exited code=${code} signal=${signal ?? 'none'}`);
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(`[local-cell] ${err.message}`);
  process.exit(1);
});
