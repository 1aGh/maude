// S9.12 — the ACL gate's fixture, route inventory and sweep (V2-1.16 §7, studio browser door).
//
// THE INVENTORY IS READ FROM THE ROUTE TABLES, never typed by hand (S9-slices §5 risk): the
// legacy `routes` literal of http.ts, the V2-2.5 table (`allSpecs`), the canvas origin's map
// (routes/canvas-origin.ts), and the fall-through branches of `handleFallthrough`. A route
// added to any of them is swept, and must be classified (access-route-classes.test.ts).
//
// THE FIXTURE (one workspace-mode child, HOME and every credential file inside the sandbox):
//   A  ui/a.tsx                        imports ./a.css, uses assets/aaaa0001.png — the grant
//   B  ui/canary-folder/canary-b.tsx   `CANARY-B-SOURCE`, uses assets/bbbb0001.png
//                                      (bytes `CANARY-B-ASSET`), kind imported-figma,
//                                      a comment `CANARY secret on B`, an AI run, a
//                                      commit naming it
//   C  ui/canary-c.tsx                 on DS `canary-ds`, its own commit
//   +  an empty folder ui/canary-empty/
//   +  S9.12b: a trashed copy of B (`_trash/…canary-b-copy`, deleted by the owner) and an
//      export job of B started by ANOTHER member's session (`x-maude-session: owner-sess`)
// Nothing of A carries the word `canary`, so any `canary` (case-folded) an A-only session
// receives — or the sha256 of B's file, or the C-only commit — is a leak.
//
// THE SWEEP, per route and origin, as one session:
//   - untargeted: GET and POST {} — no canary;
//   - paired: the same request naming B and naming a missing canvas, for every target
//     spelling a handler reads (`file`/`canvas`/`path`/`slug`/`id`/`sha`/…, the `:params` of
//     a pattern, a static-lane path). U1: the two answers are byte-identical once the one
//     value the request sent is swapped back; and the B answer carries no canary beyond it.
// Every built URL is self-checked: an `undefined`, `null` or unsubstituted `:param`
// segment is a red test (the hub sweep once swept every pattern row at `/v1/undefined`).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Subprocess, spawn } from 'bun';

import type { AclCheck } from '../access/filters.ts';
import type { AccessClaim } from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { allSpecs } from '../routes/index.ts';
import { killProc, makeSandbox, nextPort } from './_helpers.ts';
import { stubDeps } from './_route-stubs.ts';

const STUDIO = join(import.meta.dir, '..');
export const D = '.design';
export const A_REL = 'ui/a.tsx';
export const B_REL = 'ui/canary-folder/canary-b.tsx';
export const C_REL = 'ui/canary-c.tsx';
export const M_REL = 'ui/missing-folder/missing-zz.tsx';
export const A_ASSET = 'assets/aaaa0001.png';
export const B_ASSET = 'assets/bbbb0001.png';
export const M_ASSET = 'assets/zzzz0001.png';
export const B_COMMENT = 'c_bbbbbbbbbbbb';
export const M_COMMENT = 'c_zzzzzzzzzzzz';
export const A_COMMENT = 'c_aaaaaaaaaaaa';
export const B_SLUG = canvasSlugFromRel(`${D}/${B_REL}`, D);
export const M_SLUG = canvasSlugFromRel(`${D}/${M_REL}`, D);

const A_SRC =
  'import \'./a.css\';\nexport default function A() { return <img data-dc-screen="a1" src="assets/aaaa0001.png" />; }\n';
export const B_SRC =
  '// CANARY-B-SOURCE\nexport default function B() { return <img data-dc-screen="canary-board" src="assets/bbbb0001.png" />; }\n';
const C_SRC = 'export default function C() { return <div data-dc-screen="c1">canary c</div>; }\n';
export const B_SHA256 = createHash('sha256').update(B_SRC).digest('hex');

// ---------------------------------------------------------------------------
// Sessions (the proxy's vouched headers, V2-1.7 §5.4).

const claim = (c: AccessClaim) => Buffer.from(JSON.stringify(c)).toString('base64url');
export type Headers_ = Record<string, string>;
export const roleSession = (role: 'owner' | 'member' | 'viewer' | 'observer'): Headers_ => ({
  'x-maude-access': claim({ v: 1, role } as AccessClaim),
  'x-maude-role': role,
  'x-maude-readonly': role === 'owner' || role === 'member' ? '0' : '1',
});
/** The v1 proxy's projection only (no `x-maude-access`): what a pre-v2 hub sends. */
export const legacySession = (role: 'owner' | 'member' | 'viewer'): Headers_ => ({
  'x-maude-role': role,
  'x-maude-readonly': role === 'viewer' ? '1' : '0',
});
export const OWNER = roleSession('owner');
/** S9.12b — the owner as a session of its own (export jobs are listed per session). */
export const OWNER_SESSION: Headers_ = { ...OWNER, 'x-maude-session': 'owner-sess' };
/** The B copy the owner trashes at boot. */
export const B_COPY_REL = 'ui/canary-folder/canary-b-copy.tsx';
/** An export-job id no job has (the missing side of the job-id pair). */
export const M_JOB = '00000000-0000-4000-8000-00000000dead';
/** A canvas-only member of A — the session every sweep runs as. */
export const A_ONLY: Headers_ = {
  'x-maude-access': claim({ v: 1, role: null, grants: [{ c: A_REL, r: 'member' }] }),
  'x-maude-readonly': '1',
};
/**
 * gate-b-c4 — the A-only session as the proxy vouches it (`x-maude-user`: the subject its frame
 * key is minted for). A cell hands no frame key to a request without one.
 */
export const A_USER: Headers_ = { ...A_ONLY, 'x-maude-user': 'a-only@example.com' };

/**
 * gate-b-c4 — the capability the session's shell mints for `canvas` (its `/_config` key), so the
 * canvas / capture probes run inside that canvas's frame, as the canvas's own code does.
 */
export async function frameIn(cell: GateCell, headers: Headers_, canvas: string): Promise<string> {
  const { frameCapFor } = await import('../client/frame-cap.js');
  const r = await fetch(`${cell.base}/_config`, { headers: { origin: cell.base, ...headers } });
  const cfg = (await r.json()) as { frameKey?: string };
  const fc = frameCapFor(cfg.frameKey, canvas);
  if (!fc) throw new Error(`no frame key for ${canvas} (status ${r.status})`);
  return fc;
}

// ---------------------------------------------------------------------------
// The fixture.

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(
    ['git', '-c', 'user.name=Tess Ter', '-c', 'user.email=tess@example.com', ...args],
    {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      // Fixed dates: two boots of the fixture have the same commits (acl-u7-parity compares them).
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z',
      },
    }
  );
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

const comment = (id: string, file: string, text: string) => ({
  id,
  file,
  selector: '[data-dc-screen]',
  dom_path: [],
  tag: 'div',
  classes: '',
  bounds: null,
  html_excerpt: '',
  text,
  status: 'open',
  created: '2026-10-01T00:00:00.000Z',
  resolved_at: null,
  author: 'Tess Ter',
  thread: [],
  mentions: [],
});

export interface GateCell {
  base: string;
  canvasBase: string;
  root: string;
  designRoot: string;
  /** The commit touching C only — invisible to an A-only session. */
  cSha: string;
  /** The B AI run's id (owner-started), or null if the run could not be planted. */
  bRunId: string | null;
  /** S9.12b — the owner session's export job of B, or null if it could not be planted. */
  bJobId: string | null;
  /** S9.12b — the desktop fixture's capture origin (no capture listener in a cell). */
  captureBase?: string;
  /** S9.12b — the desktop fixture: rewrite hubs.json's stored claim (re-read per request). */
  setDesktopClaim?: (c: AccessClaim) => void;
  stop(): Promise<void>;
}

/** The stored claim a desktop fixture holds while the sweep runs as A-only. */
export const A_ONLY_CLAIM: AccessClaim = { v: 1, role: null, grants: [{ c: A_REL, r: 'member' }] };
const DESKTOP_HUB = 'http://hub.invalid:9';

/** Boot the gate cell; `revert` names ACL checks the server runs without (the revert guard). */
export async function bootGateCell(
  opts: { revert?: readonly AclCheck[]; desktop?: boolean; env?: Record<string, string> } = {}
): Promise<GateCell> {
  const { root, designRoot } = makeSandbox();
  const home = join(root, 'home');
  mkdirSync(join(home, '.config'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify(
      {
        name: 'test',
        designRoot: D,
        canvasGroups: [
          { label: 'System', path: 'system' },
          { label: 'UI', path: 'ui' },
        ],
        designSystems: [
          { name: 'shared', path: 'system/shared' },
          { name: 'canary-ds', path: 'system/canary-ds' },
        ],
        defaultDesignSystem: 'shared',
        // S9.12b — the desktop fixture is a hub-linked desktop: its access is hubs.json's claim.
        ...(opts.desktop ? { linkedHub: { url: DESKTOP_HUB, linkedAt: 1 } } : {}),
      },
      null,
      2
    )
  );
  const hubsPath = join(home, 'hubs.json');
  const setDesktopClaim = (c: AccessClaim) =>
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { [DESKTOP_HUB]: { token: 't', linkedAt: 1, access: c } } }),
      { mode: 0o600 }
    );
  if (opts.desktop) setDesktopClaim({ v: 1, role: 'owner' });
  for (const ds of ['shared', 'canary-ds']) {
    mkdirSync(join(designRoot, 'system', ds, 'preview'), { recursive: true });
    writeFileSync(join(designRoot, 'system', ds, 'colors_and_type.css'), ':root{--bg-0:#000}\n');
    writeFileSync(join(designRoot, 'system', ds, 'README.md'), `# ${ds}\n`);
  }
  mkdirSync(join(designRoot, 'ui', 'canary-folder'), { recursive: true });
  mkdirSync(join(designRoot, 'ui', 'canary-empty'), { recursive: true });
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  const put = (rel: string, text: string) => writeFileSync(join(designRoot, rel), text);
  put(A_REL, A_SRC);
  put('ui/a.css', '.a { color: red }\n');
  put('ui/a.meta.json', JSON.stringify({ designSystem: 'shared' }));
  put(B_REL, B_SRC);
  put(
    B_REL.replace('.tsx', '.meta.json'),
    JSON.stringify({ designSystem: 'shared', kind: 'imported-figma' })
  );
  put(C_REL, C_SRC);
  put('ui/canary-c.meta.json', JSON.stringify({ designSystem: 'canary-ds' }));
  put(A_ASSET, 'A-ASSET-BYTES');
  put(B_ASSET, 'CANARY-B-ASSET');
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  put('_comments/a.json', JSON.stringify([comment(A_COMMENT, `${D}/${A_REL}`, 'hello A')]));
  put(
    '_comments/b.json',
    JSON.stringify([comment(B_COMMENT, `${D}/${B_REL}`, 'CANARY secret on B')])
  );
  writeFileSync(join(root, '.gitignore'), '.design/_*\nhome/\n');

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.gitignore', '.design');
  git(root, 'commit', '-q', '-m', 'design: update 2 canvases\n\n- canary-folder/canary-b\n- a');
  put(C_REL, C_SRC.replace('c1', 'c2'));
  git(root, 'add', '.design');
  git(root, 'commit', '-q', '-m', 'canary only commit');
  const cSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'branch', 'canary-draft'); // a draft named after B (free text, U4)
  put(B_REL, `${B_SRC}// canary edit\n`); // the working tree moves on: the diff lists B
  put(A_REL, `${A_SRC}// edit\n`);
  put(B_COPY_REL, B_SRC); // trashed by the owner below

  // gate-b-u7: `/_api/preflight` (and every route that reads the sign-in state) spawns the
  // machine's real `claude auth status` under a 5 s deadline, so on a busy machine the same
  // request answered "Installed, but not signed in." in one boot and "couldn't read its
  // sign-in state" in the other (acl-u7-parity red, lane runs only). The fixture pins the CLI:
  // a stub first on PATH that answers a signed-out status at once, the same in every boot.
  const stubBin = join(home, 'bin');
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, 'claude'), `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });

  const port = nextPort();
  const proc = await spawnStudio(root, port, {
    PATH: `${stubBin}:${process.env.PATH ?? ''}`,
    MAUDE_CLAUDE_BIN: '',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    HUBS_CONFIG_PATH: hubsPath,
    MAUDE_CLOUD_CONFIG: join(home, 'cloud.json'),
    MAUDE_GEN_KEYS_PATH: join(home, 'gen-keys.json'),
    ...(opts.desktop
      ? // gate-b-sec4: the harness is the app that made this link (sync/link-consent.ts)
        { MAUDE_APP_BOUND_HUB: DESKTOP_HUB }
      : {
          MAUDE_WORKSPACE_MODE: '1',
          MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
          HUB_DASHBOARD_URL: 'http://127.0.0.1:9',
          MAUDE_PROJECT_NAME: 'Alligators',
        }),
    MAUDE_TEST_ACL_REVERT: (opts.revert ?? []).join(','),
    ...(opts.env ?? {}),
  });
  const base = `http://localhost:${port}`;
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
    canvasPort?: number;
  };
  // Plant B activity as the owner: an AI run on B.
  let bRunId: string | null = null;
  try {
    await fetch(`${base}/_api/ai/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...OWNER },
      body: JSON.stringify({ file: `${D}/${B_REL}`, author: 'Claude' }),
    });
    const runs = (await (await fetch(`${base}/_api/ai/runs`, { headers: OWNER })).json()) as {
      mine?: Array<{ id?: string }>;
      others?: Array<{ id?: string }>;
    };
    bRunId = [...(runs.mine ?? []), ...(runs.others ?? [])][0]?.id ?? null;
  } catch {
    bRunId = null;
  }
  // S9.12b — the owner trashes a copy of B (`_trash/<stamp>__<slug>/`).
  await fetch(`${base}/_api/canvas?file=${encodeURIComponent(`${D}/${B_COPY_REL}`)}`, {
    method: 'DELETE',
    headers: { origin: base, ...OWNER },
  }).catch(() => null);
  // S9.12b — another member's session exports B (a job record naming B, listed per session).
  let bJobId: string | null = null;
  try {
    const r = await fetch(`${base}/_api/export-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, ...OWNER_SESSION },
      body: JSON.stringify({
        format: 'html',
        scope: 'canvas-as-separate',
        options: { canvasFile: `${D}/${B_REL}` },
      }),
    });
    bJobId = ((await r.json()) as { jobId?: string }).jobId ?? null;
  } catch {
    bJobId = null;
  }
  // The capture origin (desktop only): the main origin 307s every canvas shell to it.
  let captureBase: string | undefined;
  if (opts.desktop) {
    const r = await fetch(`${base}/_canvas-shell?file=x`, { redirect: 'manual' });
    const loc = r.headers.get('location');
    captureBase = loc ? new URL(loc).origin : undefined;
  }
  return {
    base,
    canvasBase: `http://localhost:${info.canvasPort}`,
    root,
    designRoot,
    cSha,
    bRunId,
    bJobId,
    ...(captureBase ? { captureBase } : {}),
    ...(opts.desktop ? { setDesktopClaim } : {}),
    stop: () => killProc(proc),
  };
}

async function spawnStudio(
  root: string,
  port: number,
  env: Record<string, string>
): Promise<Subprocess> {
  const proc = spawn({
    cmd: [
      'bun',
      'run',
      '--preload',
      join(import.meta.dir, '_acl-seam-preload.ts'),
      join(STUDIO, 'server.ts'),
      '--port',
      String(port),
      '--root',
      root,
    ],
    cwd: STUDIO,
    env: {
      ...process.env,
      NO_OPEN: '1',
      NODE_ENV: 'test',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: join(root, '.design', '_state', 'machine.json'),
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const r = await fetch(`http://localhost:${port}/_health`, {
        signal: AbortSignal.timeout(200),
      });
      if (r.ok && ((await r.json()) as { pid?: number }).pid === proc.pid) return proc;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(50);
  }
  proc.kill();
  throw new Error(`gate cell did not start on port ${port}`);
}

// ---------------------------------------------------------------------------
// The inventory — read from the route tables.

const HTTP_SRC = () => readFileSync(join(STUDIO, 'http.ts'), 'utf8');

/** The keys of http.ts's legacy `routes` literal (`const legacyRoutes = { … } satisfies`). */
export function legacyRouteKeys(src = HTTP_SRC()): string[] {
  const start = src.indexOf('const legacyRoutes = {');
  const end = src.indexOf(
    '} satisfies Record<string, (req: Request) => Response | Promise<Response>>;',
    start
  );
  if (start < 0 || end < 0)
    throw new Error('http.ts: the legacy routes literal moved — update the inventory');
  const body = src.slice(start, end);
  const keys = [...body.matchAll(/^ {4}'(\/[^']*)':/gm)].map((m) => m[1] as string);
  // A key spelled any other way at the literal's depth would escape the sweep.
  const odd = body.split('\n').filter((l) => /^ {4}[^ /*}'\])]/.test(l));
  if (odd.length) throw new Error(`http.ts legacy routes: unparsed key lines:\n${odd.join('\n')}`);
  return keys;
}

/** The fall-through branches of `handleFallthrough` (prefixes + exact paths + patterns). */
export const FALLTHROUGH = Object.freeze([
  '/_api/thumb/:key',
  '/_api/comments/:id/reply',
  '/_client/:bundle',
  '/_canvas-runtime/:bundle',
  '/_canvas-shell',
  '/_canvas-shell.html',
  '/assets/:asset',
  '/_stickers/:sticker',
  '/_media/:media',
  '/.design/:rel', // the static lane (`safePathUnderRoot`)
]);

/** What `handleFallthrough` actually branches on — the U3 guard holds FALLTHROUGH to it. */
export function scrapedFallthrough(src = HTTP_SRC()): string[] {
  const start = src.indexOf('async function handleFallthrough(');
  const end = src.indexOf('function serveStudioPage(', start);
  const body = src.slice(start, end);
  const out = new Set<string>();
  for (const m of body.matchAll(/pathname(?:\.startsWith\(|\s===\s)'([^']+)'/g))
    out.add(m[1] as string);
  for (const m of body.matchAll(/\/\^((?:\\\/[A-Za-z_-]+)+)\\\//g))
    out.add(`${m[1]?.replace(/\\\//g, '/')}/`);
  return [...out].sort();
}

/** The canvas origin's own map (routes/canvas-origin.ts); table `origin: 'canvas'` specs join it. */
export function canvasOriginKeys(): string[] {
  const src = readFileSync(join(STUDIO, 'routes', 'canvas-origin.ts'), 'utf8');
  // p8-c4 — a wrapped handler too (`'/_api/canvas-meta': canvasOriginMeta(http.routes[…])`): the
  // old pattern read only `': http.` and so left canvas-meta out of every canvas-origin sweep.
  return [...src.matchAll(/^ {4}'(\/[^']*)': (?:[A-Za-z]+\()?http\./gm)].map((m) => m[1] as string);
}

export interface RouteRow {
  origin: 'main' | 'canvas';
  path: string;
  /** null = the handler decides by `req.method` (legacy + fall-through) */
  method: 'GET' | 'POST' | 'PATCH' | null;
  source: 'legacy' | 'table' | 'fallthrough' | 'canvas';
}

export function routeInventory(): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const path of legacyRouteKeys())
    rows.push({ origin: 'main', path, method: null, source: 'legacy' });
  const specs = allSpecs(stubDeps());
  for (const s of specs)
    rows.push({ origin: 'main', path: s.path, method: s.method, source: 'table' });
  for (const path of FALLTHROUGH)
    rows.push({ origin: 'main', path, method: null, source: 'fallthrough' });
  for (const path of canvasOriginKeys())
    rows.push({ origin: 'canvas', path, method: null, source: 'canvas' });
  for (const s of specs.filter((x) => x.origin === 'canvas'))
    rows.push({ origin: 'canvas', path: s.path, method: s.method, source: 'table' });
  for (const path of FALLTHROUGH.filter((p) => !p.startsWith('/_api/')))
    rows.push({ origin: 'canvas', path, method: null, source: 'fallthrough' });
  return rows;
}

// ---------------------------------------------------------------------------
// Building requests from REAL params.

interface Pair {
  b: string;
  m: string;
}

/** The `:param` of a pattern row, as B and as missing. Unknown → throws (self-check). */
function paramPair(path: string, name: string, cell: GateCell): Pair {
  if (name === 'id' && path.startsWith('/_api/comments/')) return { b: B_COMMENT, m: M_COMMENT };
  if (name === 'id' && path.startsWith('/_api/export-jobs/'))
    return { b: cell.bJobId ?? 'job-unplanted', m: M_JOB };
  if (name === 'id' && path.startsWith('/_api/ai/runs/'))
    return { b: cell.bRunId ?? 'run-unplanted', m: 'run-missing0' };
  // No outbox entry exists in a fresh cell; both sides name an absent id.
  if (name === 'id' && path.startsWith('/_api/outbox/'))
    return { b: 'ob_missing_b', m: 'ob_missing_m' };
  // S9.19 — a hub user / invitation id: the share routes judge the SESSION first, so any id will do
  if (name === 'id' && path.startsWith('/_api/share/')) return { b: 'u_probe_b', m: 'u_probe_m' };
  if (name === 'key') return { b: B_SLUG, m: M_SLUG };
  if (name === 'asset')
    return { b: B_ASSET.slice('assets/'.length), m: M_ASSET.slice('assets/'.length) };
  if (name === 'rel') return { b: B_REL, m: M_REL };
  if (name === 'bundle') return { b: 'client.bundle.js', m: 'client.bundle.js' };
  if (name === 'sticker') return { b: 'x.svg', m: 'x.svg' };
  if (name === 'media') return { b: 'x.mp4', m: 'x.mp4' };
  throw new Error(`no real value for :${name} in ${path}`);
}

/**
 * Every query spelling a handler reads a target from, as B and as missing. `route` (the row's
 * path) narrows `id` where it names something other than a comment (an export job of B).
 */
export function queryPairs(cell: GateCell, route = ''): Record<string, Pair> {
  const file = { b: `${D}/${B_REL}`, m: `${D}/${M_REL}` };
  return {
    file,
    canvas: file,
    path: file,
    rel: { b: B_REL, m: M_REL },
    slug: { b: B_SLUG, m: M_SLUG },
    id: route.startsWith('/_api/export-jobs')
      ? { b: cell.bJobId ?? 'job-unplanted', m: M_JOB }
      : { b: B_COMMENT, m: M_COMMENT },
    sha: { b: cell.cSha, m: 'deadbeef'.repeat(5) },
    key: { b: B_SLUG, m: M_SLUG },
    asset: { b: B_ASSET, m: M_ASSET },
    ds: { b: 'canary-ds', m: 'missin-ds' },
    name: { b: 'canary-b', m: 'missin-zz' },
  };
}

export interface Probe {
  /** `capture` — the desktop fixture's capture origin (S9.12b), probed with the canvas rows */
  origin: 'main' | 'canvas' | 'capture';
  method: 'GET' | 'POST' | 'PATCH';
  /** path + query, built from real params */
  url: string;
  body?: Record<string, string>;
  /** the B value this probe sent (paired probes) */
  sent?: string;
  /** the label of the B/missing pair this probe belongs to */
  pair?: string;
  side?: 'b' | 'm';
  route: string;
}

/** Writes the sweep never sends: they leave the machine (reports, sign-in, cloud) or start a session. */
export const UNSENT_WRITES: ReadonlySet<string> = new Set([
  '/_api/report',
  '/_api/report-fallback',
  '/_api/hub/link',
  '/_api/cloud/detach',
  '/_api/cloud/signin/start',
  '/_api/cloud/signin/poll',
  '/_api/cloud/signout',
  '/_api/workspace/sign-in',
  '/_api/workspace/disclosure',
]);

export function buildProbes(cell: GateCell, rows = routeInventory()): Probe[] {
  const probes: Probe[] = [];
  for (const row of rows) {
    const qp = queryPairs(cell, row.path);
    const names = [...row.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1] as string);
    const fill = (side: 'b' | 'm') =>
      row.path.replace(/:([A-Za-z_]+)/g, (_, n: string) => {
        const v = paramPair(row.path, n, cell)[side];
        return n === 'rel' ? v : encodeURIComponent(v);
      });
    const pathB = fill('b');
    const pathM = fill('m');
    const methods: Array<'GET' | 'POST' | 'PATCH'> = row.method
      ? [row.method]
      : row.origin === 'canvas' || row.source === 'fallthrough'
        ? ['GET']
        : ['GET', 'POST'];
    const id = `${row.origin} ${row.path}`;
    for (const method of methods) {
      if (method !== 'GET' && UNSENT_WRITES.has(row.path)) continue;
      if (pathB !== pathM) {
        const sent = paramPair(row.path, names[0] as string, cell).b;
        probes.push({
          origin: row.origin,
          method,
          url: pathB,
          route: id,
          pair: `${id} ${method} :param`,
          side: 'b',
          sent,
        });
        probes.push({
          origin: row.origin,
          method,
          url: pathM,
          route: id,
          pair: `${id} ${method} :param`,
          side: 'm',
        });
      } else {
        probes.push({
          origin: row.origin,
          method,
          url: pathB,
          route: id,
          ...(method !== 'GET' ? { body: {} } : {}),
        });
      }
      for (const [k, v] of Object.entries(qp)) {
        const pair = `${id} ${method} ${k}`;
        if (method === 'GET') {
          probes.push({
            origin: row.origin,
            method,
            url: `${pathB}?${k}=${encodeURIComponent(v.b)}`,
            route: id,
            pair,
            side: 'b',
            sent: v.b,
          });
          probes.push({
            origin: row.origin,
            method,
            url: `${pathM}?${k}=${encodeURIComponent(v.m)}`,
            route: id,
            pair,
            side: 'm',
          });
        } else {
          probes.push({
            origin: row.origin,
            method,
            url: pathB,
            body: { [k]: v.b },
            route: id,
            pair,
            side: 'b',
            sent: v.b,
          });
          probes.push({
            origin: row.origin,
            method,
            url: pathM,
            body: { [k]: v.m },
            route: id,
            pair,
            side: 'm',
          });
        }
      }
    }
  }
  return probes;
}

/** Self-check: no probe URL carries an unsubstituted or stringified-nothing segment. */
export function badProbeUrls(probes: readonly Probe[]): string[] {
  return probes
    .map((p) => p.url)
    .filter((u) => /\/:[A-Za-z_]|undefined|\bnull\b|\[object|NaN/.test(u));
}

// ---------------------------------------------------------------------------
// Running and judging.

export interface Answer {
  status: number;
  type: string;
  text: string;
  /** response headers worth grepping (Location, Content-Disposition, …) */
  heads: string;
}

async function readCapped(r: Response, maxBytes = 512 * 1024, ms = 4000): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + ms;
  try {
    while (size < maxBytes) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const next = await Promise.race([
        reader.read(),
        Bun.sleep(left).then(() => ({ done: true, value: undefined }) as const),
      ]);
      if (next.done || !next.value) break;
      chunks.push(next.value);
      size += next.value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  // Cut at a fixed byte count: two reads of one body must not differ by chunk boundaries.
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/**
 * One probe's answer. `fc` (gate-b-c4) is the frame capability a canvas / capture origin probe
 * carries — the frame the session's canvas code runs in; the main origin never takes one.
 */
export async function ask(
  cell: GateCell,
  p: Probe,
  headers: Headers_,
  fc?: string | null
): Promise<Answer> {
  const base =
    p.origin === 'main'
      ? cell.base
      : p.origin === 'capture'
        ? (cell.captureBase ?? 'http://127.0.0.1:9')
        : cell.canvasBase;
  const url =
    fc && p.origin !== 'main'
      ? `${p.url}${p.url.includes('?') ? '&' : '?'}fc=${encodeURIComponent(fc)}`
      : p.url;
  try {
    const r = await fetch(base + url, {
      method: p.method,
      redirect: 'manual',
      headers: {
        origin: base,
        ...(p.method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: p.method !== 'GET' ? JSON.stringify(p.body ?? {}) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const heads = ['location', 'content-disposition', 'x-maude-canvas', 'etag', 'link']
      .map((h) => `${h}: ${r.headers.get(h) ?? ''}`)
      .join('\n');
    return {
      status: r.status,
      type: r.headers.get('content-type') ?? '',
      text: await readCapped(r),
      heads,
    };
  } catch (err) {
    return { status: -1, type: '', text: `fetch failed: ${(err as Error).message}`, heads: '' };
  }
}

/** Every leak marker in `text`: the word canary (any case), B's sha256, the C-only commit. */
export function markers(text: string, cell: GateCell): string[] {
  const out = [...text.matchAll(/.{0,30}canary.{0,30}/gi)].map((m) => m[0]);
  if (text.includes(B_SHA256)) out.push('<sha256 of B>');
  if (text.includes(cell.cSha) || text.includes(cell.cSha.slice(0, 7)))
    out.push('<the C-only commit>');
  return out;
}

/** Swap the one value a probe sent back out of its answer (raw, URL-encoded, JSON). */
function unsend(text: string, sent: string | undefined, as: string | undefined): string {
  if (!sent || as === undefined) return text;
  let t = text;
  for (const [x, y] of [
    [JSON.stringify(sent).slice(1, -1), JSON.stringify(as).slice(1, -1)],
    [encodeURIComponent(sent), encodeURIComponent(as)],
    [sent, as],
  ] as const)
    t = t.split(x).join(y);
  return t;
}

/**
 * Volatile bytes two requests may differ in — clocks, mtimes, ports, the sandbox path and
 * the ids derived from it (`rootId`, the index `pid`), run / ask ids, etags. `across` (two
 * boots, acl-u7-parity) also masks 12–16-hex ids, which are per-boot by construction.
 */
export const normalize = (t: string, cell: GateCell, across = false) => {
  // Bun prints a bundled module's path relative to the server's cwd (STUDIO) when it sits only a few
  // levels away, so the sandbox root also appears in that spelling (`../tmp/slot2/mdcc-test-X/…`).
  const rel = relative(STUDIO, cell.root);
  let out = t.split(cell.root).join('<root>');
  if (rel && rel !== cell.root) out = out.split(rel).join('<root>');
  out = out
    .split(`:${cell.base.split(':').pop()}`)
    .join(':<port>')
    .split(`:${cell.canvasBase.split(':').pop()}`)
    .join(':<cport>')
    .split(cell.captureBase ? `:${cell.captureBase.split(':').pop()}` : '\u0000')
    .join(':<xport>')
    .replace(/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z/g, '<t>') // a `_trash/<stamp>__…` dir
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, '<t>')
    .replace(/\b\d{9,}(\.\d+)?\b/g, '<n>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/^etag: .*$/m, 'etag: <etag>');
  if (across)
    out = out
      .replace(/\b[a-z]?_?[0-9a-f]{12,16}\b/g, '<id>')
      .replace(/"pid":\d+/g, '"pid":<pid>')
      // render timings (/_health) and the index's mtime-derived hash differ per boot
      .replace(/("[A-Za-z0-9]*Ms[A-Za-z]*"):\d+(\.\d+)?/g, '$1:<ms>')
      .replace(/"hash":"[0-9a-f]{16,64}"/g, '"hash":"<hash>"');
  return out;
};

export interface SweepResult {
  probes: number;
  /** probe → leak markers */
  leaks: Record<string, string[]>;
  /** pair → why B and missing differ (U1) */
  oracles: Record<string, string>;
  /** route → statuses seen (for classification) */
  statuses: Record<string, number[]>;
  answers: Map<Probe, Answer>;
}

const label = (p: Probe) =>
  `${p.method} ${p.origin === 'main' ? '' : `[${p.origin}] `}${p.url}${p.body ? ` ${JSON.stringify(p.body)}` : ''}`;

export async function sweep(
  cell: GateCell,
  headers: Headers_,
  probes = buildProbes(cell),
  batch = 12,
  /** gate-b-c4 — the frame the canvas / capture probes run in (see `ask`). */
  fc?: string | null
): Promise<SweepResult> {
  const answers = new Map<Probe, Answer>();
  for (let i = 0; i < probes.length; i += batch) {
    const slice = probes.slice(i, i + batch);
    const got = await Promise.all(slice.map((p) => ask(cell, p, headers, fc)));
    slice.forEach((p, j) => answers.set(p, got[j] as Answer));
  }
  const leaks: Record<string, string[]> = {};
  const oracles: Record<string, string> = {};
  const statuses: Record<string, number[]> = {};
  const pairs = new Map<string, { b?: Probe; m?: Probe }>();
  for (const [p, a] of answers) {
    statuses[p.route] ??= [];
    const seen = statuses[p.route] as number[];
    if (!seen.includes(a.status)) seen.push(a.status);
    const pairOf = p.pair ? queryPairOf(p, cell) : undefined;
    const found = markers(unsend(`${a.heads}\n${a.text}`, p.sent, pairOf), cell);
    if (found.length) leaks[label(p)] = found;
    if (p.pair) {
      const e = pairs.get(p.pair) ?? {};
      e[p.side ?? 'b'] = p;
      pairs.set(p.pair, e);
    }
  }
  for (const [name, { b, m }] of pairs) {
    if (!b || !m) continue;
    const ab = answers.get(b) as Answer;
    const am = answers.get(m) as Answer;
    const nb = normalize(
      unsend(`${ab.status} ${ab.type}\n${ab.heads}\n${ab.text}`, b.sent, queryPairOf(b, cell)),
      cell
    );
    const nm = normalize(`${am.status} ${am.type}\n${am.heads}\n${am.text}`, cell);
    if (nb !== nm) {
      let at = 0;
      while (at < nb.length && nb[at] === nm[at]) at += 1;
      oracles[name] =
        `B ${ab.status} / missing ${am.status}, first difference at ${at}: ` +
        `${JSON.stringify(nb.slice(Math.max(0, at - 20), at + 60))} vs ${JSON.stringify(nm.slice(Math.max(0, at - 20), at + 60))}`;
    }
  }
  return { probes: probes.length, leaks, oracles, statuses, answers };
}

/** The missing-side value of the pair a B probe belongs to. */
function queryPairOf(p: Probe, cell: GateCell): string | undefined {
  if (!p.sent) return undefined;
  for (const v of Object.values(queryPairs(cell, p.route.split(' ')[1])))
    if (v.b === p.sent) return v.m;
  const row = p.route.split(' ')[1] as string;
  for (const n of [...row.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1] as string)) {
    const pp = paramPair(row, n, cell);
    if (pp.b === p.sent) return pp.m;
  }
  return undefined;
}

/**
 * S9.12b — the capture origin's probes (desktop fixture): every canvas-origin row, sent to the
 * capture listener instead (it serves the same `routes` map, GET/HEAD only).
 */
export function captureProbes(cell: GateCell): Probe[] {
  const rows = routeInventory().filter((r) => r.origin === 'canvas');
  return buildProbes(cell, rows).map((p) => ({
    ...p,
    origin: 'capture' as const,
    route: p.route.replace(/^canvas /, 'capture '),
    ...(p.pair ? { pair: p.pair.replace(/^canvas /, 'capture ') } : {}),
  }));
}
