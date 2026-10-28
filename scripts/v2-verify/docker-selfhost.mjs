#!/usr/bin/env node
// V2-8.18 — the self-hosted hub + cell images, run the way an operator runs them.
//
//   scripts/v2-test-lane.sh --wait 3600 --max 9000 -- node scripts/v2-verify/docker-selfhost.mjs [flags]
//
// build → operator path (workspace-up, admin, invite, /join) → sync through the container (two studio peers)
// → desktop legs (selfhost-entry, team-project on the container) → restart / kill+start on the same volume
// → the v1.9.1 → v2 upgrade on one volume + mixed 1.x/v2 peers → the cell image behind dev-edge with a
// file:// backup → down. Writes `<out>/report.md` ending in a ```json verdict and `<out>/verdict.json`.
//
// Local only, by construction: every image is built here (the v1 image from the v1.9.1 tag's sources via
// `git archive`), nothing is pushed or pulled from a Maude registry, there is no registry login, no R2, no
// Cloudflare. Object storage is the hub's own file backend (`MAUDE_BACKUP_TARGET=file://…`); media stay on
// the checkout disk (a hub without S3 serves them from there). Every container, volume, network and tag this
// run creates is named `maude-v2-docker-*` (the compose project is `maude-v2-docker-ws`) and removed on the way
// out, red or green — `--keep-images` keeps only the built images for a re-run.
//
// It needs this Mac's screen for its desktop legs, so it runs under the machine-wide test lane and never takes
// the lane itself (the wdio legs run inline). Never run it outside the lane.
//
// Flags: --reuse-images (skip a build when the tag exists) · --keep-images · --skip-desktop · --skip-app-build
//        (use the debug .app already built in this worktree) · --only <leg,leg> · --out <dir>
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const arg = (f, fb = null) => {
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fb;
};
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(arg('out', join(ROOT, '.ai/device/scenario-runs/v2-docker-selfhost', STAMP)));
const WORK = mkdtempSync(join(tmpdir(), 'maude-v2-docker-'));
chmodSync(WORK, 0o700);
mkdirSync(OUT, { recursive: true });

export const P = 'maude-v2-docker'; // every docker object this run creates carries it
const IMG = {
  hub: `${P}-hub:v2`,
  hubV1: `${P}-hub:v1.9.1`,
  cell: `${P}-cell:v2`,
  // workspace-up renders `ghcr.io/1agh/maude-hub:${MAUDE_IMAGE_TAG}` — the operator's pinned tag. A LOCAL
  // tag on the locally built image (compose's default pull policy uses a present image and never pulls it).
  // Removed on the way out; never pushed.
  composeTag: `${P}-local`,
};
const WS_PROJECT = `${P}-ws`;
const TEAM_PASSWORD = 'designer-pass-1'; // the team-project spec's constant (scenarios/team-project.e2e.ts)

// ── evidence ─────────────────────────────────────────────────────────────────────────────────────────────
const results = [];
const soak = [];
const log = (...a) =>
  console.log(`[docker-selfhost ${new Date().toISOString().slice(11, 19)}]`, ...a);
function record(id, title, status, detail = {}, ms = 0) {
  results.push({ ...detail, id, title, status, ms });
  log(`${status.toUpperCase()} ${id} — ${title}${detail.why ? ` (${detail.why})` : ''}`);
}
async function leg(id, title, fn) {
  if (ONLY && !ONLY.has(id.split('.')[0])) return record(id, title, 'skip', { why: '--only' });
  const t0 = Date.now();
  try {
    const detail = (await fn()) ?? {};
    record(id, title, detail.status ?? 'pass', detail, Date.now() - t0);
  } catch (err) {
    record(id, title, 'fail', { why: String(err?.message ?? err).slice(0, 600) }, Date.now() - t0);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ── processes, docker, http ──────────────────────────────────────────────────────────────────────────────
const children = [];
const dockerObjects = {
  containers: new Set(),
  volumes: new Set(),
  networks: new Set(),
  images: new Set(),
};
function docker(...a) {
  return execFileSync('docker', a, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 << 20,
  }).trim();
}
function dockerQuiet(...a) {
  try {
    return docker(...a);
  } catch {
    return null;
  }
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 60_000, every = 500) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
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
async function http(url, opts = {}) {
  // one retry on a transport error: right after a container restart the proxy may hand back a dead
  // keep-alive socket; a second refusal is real and throws
  try {
    return await http1(url, opts);
  } catch (err) {
    if (!/fetch failed|ECONNRESET|socket/i.test(String(err?.message ?? err))) throw err;
    await sleep(2000);
    return http1(url, opts);
  }
}
async function http1(url, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const r = await fetch(url, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  if (raw) return { status: r.status, text, headers: r.headers };
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: r.status, body: json };
}
const healthy = (url) => async () => (await http(`${url}/health`)).status === 200;

// The hub rate-limits sign-in per client — a real control, kept: wait a 429 out.
let lastSignInAt = 0;
/**
 * The hub allows 5 sign-ins a minute per client address, and every caller here (the gate, the desktop app)
 * is the same loopback client behind Caddy. Before a desktop leg signs in through the UI, let the window
 * the gate's own sign-ins used run out — or the app meets "Too many attempts" (a real control, kept).
 */
async function signInWindowClear() {
  const wait = 65_000 - (Date.now() - lastSignInAt);
  if (wait > 0) await sleep(wait);
}
async function signIn(url, email, password) {
  for (let i = 0; i < 12; i++) {
    lastSignInAt = Date.now();
    const r = await http(`${url}/auth/login`, { method: 'POST', body: { email, password } });
    if (r.status === 200) return { token: r.body.token, role: r.body.user?.role ?? null };
    if (r.status !== 429)
      throw new Error(`sign-in ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    await sleep(15_000);
  }
  throw new Error(`sign-in ${email}: still rate limited`);
}
async function inviteAndJoin(url, secret, { email, password, role = 'member', by }) {
  const inv = await http(`${url}/admin/api/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    body: { email, role, ttlHours: 48, ...(by ? { createdBy: by } : {}) },
  });
  assert(
    inv.status === 201,
    `invite ${email}: ${inv.status} ${JSON.stringify(inv.body).slice(0, 200)}`
  );
  // What the invited person opens first: the join page, by the link's token.
  const page = await http(`${url}/join?token=${encodeURIComponent(inv.body.value)}`, { raw: true });
  const joined = await http(`${url}/join`, {
    method: 'POST',
    body: { token: inv.body.value, email, password },
  });
  assert(
    joined.status < 400,
    `join ${email}: ${joined.status} ${JSON.stringify(joined.body).slice(0, 200)}`
  );
  return { inviteRole: inv.body.invite?.role, joinPage: page.status, joinStatus: joined.status };
}
/** Does the hub hold `rel`? Accepted-revisions mode lists it in bootstrap; legacy (and 1.x) in the admin canvas list. */
async function hubHas(url, token, secret, rel) {
  const b = await http(`${url}/api/projects/current/v1/bootstrap`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (b.status === 200 && (b.body.docs ?? []).some((d) => !d.retired && d.path === rel))
    return true;
  const c = await http(`${url}/admin/api/canvases`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  return JSON.stringify(c.body).includes(rel.replace(/\.tsx$/, ''));
}
async function bootstrapDocs(url, token) {
  const r = await http(`${url}/api/projects/current/v1/bootstrap`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert(r.status === 200, `bootstrap: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return (r.body.docs ?? []).filter((d) => !d.retired).map((d) => d.path);
}

// ── a throwaway person: HOME/XDG, a stub `claude` first on PATH, never ~/.config/maude ───────────────────
const STUB_BIN = join(WORK, 'stub-bin');
mkdirSync(STUB_BIN, { recursive: true });
writeFileSync(join(STUB_BIN, 'claude'), `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
function personEnv(dir, extra = {}) {
  for (const d of ['home', 'config', 'data', 'cache']) mkdirSync(join(dir, d), { recursive: true });
  return {
    PATH: `${STUB_BIN}:${process.env.PATH}`,
    HOME: join(dir, 'home'),
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
    XDG_CACHE_HOME: join(dir, 'cache'),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    MAUDE_CLOUD_CONFIG: join(dir, 'cloud.json'),
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_CANVAS_ORIGIN_SPLIT: '1', // TSX sync rides the origin split (DDR-060)
    ...extra,
  };
}

export const canvasSource = (
  title
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Docker self-host">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/**
 * A studio peer linked to `hubUrl` with `token`, serving `<dir>/project`. `studioRoot` picks the build
 * (this tree, or the v1.9.1 sources for a 1.x peer).
 */
async function startPeer(
  name,
  { hubUrl, token, studioRoot = join(ROOT, 'apps/studio'), canvases = {} }
) {
  const dir = join(WORK, `peer-${name}`);
  const project = join(dir, 'project');
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(project, '.design', 'config.json'),
    JSON.stringify({
      name: 'Docker self-host',
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      linkedHub: { url: hubUrl, linkedAt: Date.now() },
    })
  );
  for (const [rel, title] of Object.entries(canvases))
    writeFileSync(join(project, '.design', rel), canvasSource(title));
  const hubs = join(dir, 'hubs.json');
  writeFileSync(
    hubs,
    JSON.stringify({ hubs: { [hubUrl]: { token, role: 'member', linkedAt: Date.now() } } }),
    {
      mode: 0o600,
    }
  );
  const port = await freePort();
  const logFile = join(OUT, `peer-${name}.log`);
  const child = spawn(
    'bun',
    ['--no-env-file', join(studioRoot, 'server.ts'), '--root', project, '--port', String(port)],
    {
      env: personEnv(dir, { HUBS_CONFIG_PATH: hubs, MAUDE_APP_BOUND_HUB: hubUrl }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let buf = '';
  const keep = (c) => {
    buf += c.toString('utf8');
    if (buf.length > 400_000) buf = buf.slice(-200_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push(child);
  const peer = {
    name,
    project,
    port,
    url: `http://127.0.0.1:${port}`,
    child,
    file: (rel) => join(project, '.design', rel),
    read: (rel) => {
      try {
        return readFileSync(join(project, '.design', rel), 'utf8');
      } catch {
        return null;
      }
    },
    write: (rel, title) => writeFileSync(join(project, '.design', rel), canvasSource(title)),
    config: async () => (await http(`${peer.url}/_config`)).body,
    stop: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* gone */
      }
      writeFileSync(logFile, buf);
    },
  };
  child.on('exit', () => writeFileSync(logFile, buf));
  await until(
    `peer ${name} health`,
    async () => (await http(`${peer.url}/_health`)).status === 200,
    60_000
  );
  return peer;
}

// ── images ───────────────────────────────────────────────────────────────────────────────────────────────
function imageExists(tag) {
  return Boolean(dockerQuiet('images', '-q', tag));
}
function build(tag, args, cwd, logName) {
  if (has('reuse-images') && imageExists(tag))
    return { reused: true, imageId: docker('images', '-q', '--no-trunc', tag) };
  const t0 = Date.now();
  const r = run('docker', ['build', '-t', tag, ...args], { cwd });
  writeFileSync(join(OUT, `build-${logName}.log`), r.out);
  assert(
    r.status === 0,
    `docker build ${tag} failed — ${r.out
      .split('\n')
      .filter((l) => /error/i.test(l))
      .slice(-6)
      .join(' | ')}`
  );
  dockerObjects.images.add(tag);
  return {
    reused: false,
    imageId: docker('images', '-q', '--no-trunc', tag),
    s: Math.round((Date.now() - t0) / 1000),
  };
}

// ── state shared between the legs ────────────────────────────────────────────────────────────────────────
const WS = {
  dir: join(WORK, WS_PROJECT),
  url: 'http://localhost',
  owner: { email: 'owner@docker-selfhost.test', password: randomBytes(15).toString('base64url') },
  designer: { email: 'designer@x.test', password: TEAM_PASSWORD }, // team-project's designer
  teammate: {
    email: 'teammate@docker-selfhost.test',
    password: randomBytes(15).toString('base64url'),
  },
  entry: { email: 'entry@docker-selfhost.test', password: randomBytes(15).toString('base64url') },
  secret: null,
  hubContainer: null,
  peers: {},
};
function readEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [
        l.slice(0, l.indexOf('=')),
        l.slice(l.indexOf('=') + 1).replace(/^'(.*)'$/, '$1'),
      ])
  );
}
const compose = (...a) => run('docker', ['compose', '-p', WS_PROJECT, ...a], { cwd: WS.dir });
function wsContainer(service) {
  return docker(
    'compose',
    '-p',
    WS_PROJECT,
    '--project-directory',
    WS.dir,
    'ps',
    '-a',
    '-q',
    service
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  await leg('preflight', 'Docker daemon up, port 80 free for the local workspace', async () => {
    const info = docker('info', '--format', '{{.ServerVersion}} {{.Architecture}}');
    // macOS refuses an unprivileged bind of 127.0.0.1:80 (EACCES) even when nothing listens, so ask lsof
    const listening = run('lsof', ['-nP', '-iTCP:80', '-sTCP:LISTEN']).out.trim();
    assert(
      !listening,
      `port 80 is taken — workspace-up --local serves http://localhost on it: ${listening}`
    );
    return { docker: info };
  });
  if (results.at(-1).status === 'fail') return finish(t0);

  // ── 1 · images ─────────────────────────────────────────────────────────────────────────────────────────
  await leg(
    'images.hub',
    'the hub image from apps/hub/Dockerfile, frozen lockfile, as hub-image.yml builds it',
    async () => {
      const wf = readFileSync(join(ROOT, '.github/workflows/hub-image.yml'), 'utf8');
      assert(
        /context:\s*\.\s*\n\s*file:\s*apps\/hub\/Dockerfile/.test(wf),
        'hub-image.yml no longer builds apps/hub/Dockerfile from the repo root'
      );
      assert(
        /bun install --frozen-lockfile/.test(
          readFileSync(join(ROOT, 'apps/hub/Dockerfile'), 'utf8')
        ),
        'the hub Dockerfile lost its frozen install'
      );
      const b = build(IMG.hub, ['-f', 'apps/hub/Dockerfile', '.'], ROOT, 'hub-v2');
      docker('tag', IMG.hub, `ghcr.io/1agh/maude-hub:${IMG.composeTag}`);
      dockerObjects.images.add(`ghcr.io/1agh/maude-hub:${IMG.composeTag}`);
      return b;
    }
  );
  await leg(
    'images.hubV1',
    'the v1.9.1 hub image from the tag’s own sources (git archive)',
    async () => {
      const src = join(WORK, 'v1.9.1');
      mkdirSync(src);
      const tar = run('bash', ['-c', `git -C "${ROOT}" archive v1.9.1 | tar -x -C "${src}"`]);
      assert(tar.status === 0, `git archive v1.9.1: ${tar.out.slice(-300)}`);
      WS.v1src = src;
      return build(IMG.hubV1, ['-f', 'apps/hub/Dockerfile', '.'], src, 'hub-v1.9.1');
    }
  );
  await leg(
    'images.cell',
    'the cell image (infra/cell/Dockerfile) on the v2 hub image',
    async () => {
      const decl = /maude-cell:(v[0-9.]+)/.exec(
        readFileSync(join(ROOT, 'apps/cells/wrangler.toml'), 'utf8')
      )?.[1];
      const b = build(
        IMG.cell,
        ['-f', 'infra/cell/Dockerfile', '--build-arg', `HUB_IMAGE=${IMG.hub}`, '.'],
        ROOT,
        'cell'
      );
      return {
        ...b,
        wranglerDeclares: decl,
        note: 'built from this tree on the local hub image; the fleet tag is only read',
      };
    }
  );

  // ── 2 · the operator path ──────────────────────────────────────────────────────────────────────────────
  const imagesOk = results.filter((r) => r.id === 'images.hub' && r.status === 'pass').length === 1;
  await leg(
    'operator.up',
    'maude hub workspace-up --local: compose up + its own verification',
    async () => {
      assert(imagesOk, 'no hub image');
      const r = run(
        'node',
        [
          join(ROOT, 'cli/bin/maude.mjs'),
          'hub',
          'workspace-up',
          '--local',
          '--canvas-domain',
          'canvas.localhost',
          '--admin-email',
          WS.owner.email,
          '--admin-password',
          WS.owner.password,
          '--image-tag',
          IMG.composeTag,
          '--out',
          WS.dir,
        ],
        { env: { ...process.env, COMPOSE_PROJECT_NAME: WS_PROJECT }, timeout: 600_000 }
      );
      writeFileSync(
        join(OUT, 'workspace-up.log'),
        r.out.replaceAll(WS.owner.password, '<redacted>')
      );
      dockerObjects.networks.add(`${WS_PROJECT}_default`);
      for (const v of ['hub-data', 'hub-repo', 'caddy-data', 'caddy-config'])
        dockerObjects.volumes.add(`${WS_PROJECT}_${v}`);
      const env = readEnvFile(join(WS.dir, '.env'));
      WS.secret = env.HUB_SECRET;
      WS.hubContainer = wsContainer('hub');
      dockerObjects.containers.add(WS.hubContainer);
      const caddy = wsContainer('caddy');
      dockerObjects.containers.add(caddy);
      const published = docker('port', caddy);
      assert(r.status === 0, `workspace-up exited ${r.status}: ${r.out.slice(-600)}`);
      // its own verification: ✓ proven, ✗ failed, – not automated (then THIS gate proves it: sync.peers)
      const steps = r.out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[✓✗–]/.test(l));
      assert(
        !steps.some((l) => l.startsWith('✗')),
        `workspace-up verification failed: ${steps.join(' | ')}`
      );
      return {
        published,
        verified: steps.filter((l) => l.startsWith('✓')),
        unverifiedByWorkspaceUp: steps.filter((l) => l.startsWith('–')),
        composeFiles: readdirSync(WS.dir),
        // the operator's pinned image is the local build
        image: docker('inspect', '-f', '{{.Config.Image}}', WS.hubContainer),
      };
    }
  );
  await leg(
    'operator.local-loopback',
    'local mode publishes the plain-HTTP port on loopback only',
    async () => {
      const caddy = wsContainer('caddy');
      const published = docker('port', caddy);
      assert(
        published.split('\n').every((l) => /127\.0\.0\.1:80$|\[::1\]:80$/.test(l.trim())),
        `--local publishes plain HTTP beyond loopback: ${published.replace(/\n/g, ', ')}`
      );
      return { published };
    }
  );
  await leg(
    'operator.people',
    'admin bootstrap, a refused viewer invite, three invitations through /join',
    async () => {
      assert(WS.secret, 'no workspace');
      const owner = await signIn(WS.url, WS.owner.email, WS.owner.password);
      assert(owner.role === 'admin', `the bootstrapped owner is ${owner.role}, not admin`);
      WS.owner.token = owner.token;
      // A hub's accounts are admin | member; a view-only person is not an invite (the Share sheet hides Can view).
      const viewer = await http(`${WS.url}/admin/api/invites`, {
        method: 'POST',
        headers: { authorization: `Bearer ${WS.secret}` },
        body: { email: 'viewer@docker-selfhost.test', role: 'viewer', ttlHours: 48 },
      });
      assert(viewer.status === 400, `a viewer invite was not refused: ${viewer.status}`);
      const joins = {};
      for (const who of ['designer', 'teammate', 'entry']) {
        joins[who] = await inviteAndJoin(WS.url, WS.secret, { ...WS[who], by: WS.owner.email });
        const s = await signIn(WS.url, WS[who].email, WS[who].password);
        assert(s.role === 'member', `${who} signed in as ${s.role}`);
        WS[who].token = s.token;
      }
      const health = (await http(`${WS.url}/health`)).body;
      WS.formatAtBoot = health.formatVersion ?? null;
      return {
        joins,
        viewerRefusal: viewer.status,
        hubVersion: health.version ?? null,
        formatVersion: WS.formatAtBoot,
      };
    }
  );

  await leg(
    'operator.mode',
    'the owner switches the new project to accepted revisions (the save mode the v2 desktop lanes use)',
    async () => {
      assert(WS.owner.token, 'no owner');
      const api = `${WS.url}/api/projects/current/v1/mode`;
      const auth = { authorization: `Bearer ${WS.owner.token}` };
      const before = await http(api, { headers: auth });
      assert(
        before.status === 200,
        `GET mode: ${before.status} ${JSON.stringify(before.body).slice(0, 200)}`
      );
      if (before.body.mode === 'transactions') return { mode: 'transactions', already: true };
      const flip = await http(api, {
        method: 'POST',
        headers: auth,
        body: { mode: 'transactions', expectEpoch: before.body.epoch ?? 0 },
      });
      assert(
        flip.status === 200,
        `switch: ${flip.status} ${JSON.stringify(flip.body).slice(0, 300)}`
      );
      return { from: before.body.mode, to: flip.body.mode, epoch: flip.body.epoch };
    }
  );

  // ── 3 · sync through the container: two studio peers ───────────────────────────────────────────────────
  await leg(
    'sync.peers',
    'two studio peers sync a canvas both ways through the container',
    async () => {
      assert(WS.teammate.token && WS.designer.token, 'no people');
      WS.peers.a = await startPeer('a', {
        hubUrl: WS.url,
        token: WS.teammate.token,
        canvases: { 'ui/docker-a.tsx': 'From peer A' },
      });
      await until(
        'peer A’s canvas on the hub',
        async () => hubHas(WS.url, WS.owner.token, WS.secret, 'ui/docker-a.tsx'),
        90_000
      );
      // the owner, not the designer: team-project's step 8 disables the designer, which ends their sessions
      WS.peers.b = await startPeer('b', { hubUrl: WS.url, token: WS.owner.token });
      await until(
        'peer A’s canvas on peer B’s disk',
        async () => WS.peers.b.read('ui/docker-a.tsx')?.includes('From peer A'),
        90_000
      );
      WS.peers.b.write('ui/docker-a.tsx', 'Edited by peer B');
      await until(
        'peer B’s edit on peer A’s disk',
        async () => WS.peers.a.read('ui/docker-a.tsx')?.includes('Edited by peer B'),
        90_000
      );
      const commits = dockerQuiet(
        'exec',
        WS.hubContainer,
        'git',
        '-C',
        '/repo',
        'rev-list',
        '--count',
        'HEAD'
      );
      return { autosaveCommits: Number(commits ?? 0) };
    }
  );

  // ── 4 · desktop legs (this Mac's screen, inline under the lane the gate holds) ─────────────────────────
  if (has('skip-desktop')) {
    record('desktop', 'desktop legs', 'skip', { why: '--skip-desktop' });
  } else {
    await leg('desktop.app', 'the debug test build of this worktree', async () => {
      if (has('skip-app-build')) return { status: 'pass', note: 'reused the existing debug .app' };
      const s = run(
        'bash',
        ['-c', 'cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release'],
        { cwd: ROOT, timeout: 1_200_000 }
      );
      writeFileSync(join(OUT, 'build-studio.log'), s.out);
      assert(s.status === 0, 'studio release build failed');
      const a = run(
        'bash',
        [
          '-c',
          'cd apps/desktop && PATH="$HOME/.cargo/bin:$PATH" MAUDE_SKIP_RUNTIME_BUILD=1 npx --no-install tauri build --debug --config src-tauri/tauri.e2e.conf.json',
        ],
        { cwd: ROOT, timeout: 3_600_000 }
      );
      writeFileSync(join(OUT, 'build-app.log'), a.out);
      assert(a.status === 0, 'debug app build failed');
      return {};
    });
    await leg(
      'desktop.selfhost-entry',
      'selfhost-entry: a clean profile signs in to the container and edits a canvas',
      async () => {
        assert(WS.entry.token, 'no invited person');
        const target = join(WORK, 'selfhost-target.json');
        writeFileSync(
          target,
          JSON.stringify({ hubUrl: WS.url, email: WS.entry.email, password: WS.entry.password }),
          { mode: 0o600 }
        );
        await signInWindowClear();
        const r = wdio(
          'multiplayer/selfhost-entry.conf.ts',
          { MAUDE_SELFHOST_ENTRY_TARGET: target },
          'selfhost-entry'
        );
        assert(r.status === 0, `selfhost-entry red — ${r.tail}`);
        return { log: r.log };
      }
    );
    await leg(
      'desktop.team-project',
      'team-project on the container (server away = docker kill + start, same volume)',
      async () => {
        assert(WS.designer.token, 'no designer');
        const target = join(WORK, 'team-hub-target.json');
        writeFileSync(
          target,
          JSON.stringify({
            http: WS.url,
            container: WS.hubContainer,
            adminSecret: WS.secret,
            ownerToken: WS.owner.token,
            teammateToken: WS.teammate.token,
            // a second member (the ai-runs lane's bob, p8-t-multi-2) — a person team-project never disables
            bobToken: WS.entry.token,
            away: 'kill',
          }),
          { mode: 0o600 }
        );
        await signInWindowClear();
        const r = wdio(
          'wdio.team-project.conf.ts',
          { MAUDE_E2E_HUB_TARGET: target },
          'team-project'
        );
        // the lane disables the designer and enables them again; the account must be usable afterwards
        assert(r.status === 0, `team-project red — ${r.tail}`);
        return { log: r.log };
      }
    );
  }

  // ── 5 · resilience on the same volume ──────────────────────────────────────────────────────────────────
  for (const [mode, act] of [
    ['restart', () => docker('restart', WS.hubContainer)],
    [
      'kill',
      () => {
        docker('kill', '--signal', 'KILL', WS.hubContainer);
        docker('start', WS.hubContainer);
      },
    ],
  ]) {
    await leg(
      `resilience.${mode}`,
      `docker ${mode === 'kill' ? 'kill + start' : 'restart'}: accounts, sessions, project and an in-flight edit survive`,
      async () => {
        assert(WS.peers.a && WS.peers.b, 'no peers');
        // the desktop legs end with the hub just restarted, and team-project's step 8 disables + re-enables
        // the designer (which ends their sessions): settle, then take a session minted NOW
        await until('hub healthy before', healthy(WS.url), 180_000);
        const live = await signIn(WS.url, WS.designer.email, WS.designer.password);
        const before = await bootstrapDocs(WS.url, WS.owner.token);
        const title = `In flight before ${mode}`;
        WS.peers.a.write('ui/docker-a.tsx', title); // the edit is in flight while the hub goes away
        act();
        await until('hub healthy again', healthy(WS.url), 180_000);
        const session = await http(`${WS.url}/auth/session`, {
          headers: { authorization: `Bearer ${live.token}` },
        });
        assert(
          session.status === 200,
          `a session from before the ${mode} is gone: ${session.status}`
        );
        for (const who of ['owner', 'designer', 'teammate'])
          await signIn(WS.url, WS[who].email, WS[who].password);
        const after = await bootstrapDocs(WS.url, WS.owner.token);
        assert(
          before.every((p) => after.includes(p)),
          `documents lost across the ${mode}: ${before.filter((p) => !after.includes(p))}`
        );
        await until(
          'the in-flight edit on peer B',
          async () => WS.peers.b.read('ui/docker-a.tsx')?.includes(title),
          120_000
        );
        WS.peers.b.write('ui/docker-b.tsx', `Peer B after ${mode}`);
        await until(
          'peer B’s new canvas on peer A',
          async () => WS.peers.a.read('ui/docker-b.tsx')?.includes(`after ${mode}`),
          120_000
        );
        return {
          docs: after.length,
          restarts: docker(
            'inspect',
            '-f',
            '{{.RestartCount}} {{.State.StartedAt}}',
            WS.hubContainer
          ),
        };
      }
    );
  }

  // tear the workspace down before the upgrade leg (port 80, memory)
  for (const p of Object.values(WS.peers)) p.stop();
  if (WS.secret) compose('down', '-v', '--remove-orphans');

  // ── 6 · upgrade v1.9.1 → v2 on one volume, mixed peers ────────────────────────────────────────────────
  await upgradeLegs();

  // ── 7 · the cell image behind dev-edge, backup on file:// ─────────────────────────────────────────────
  await cellLegs();

  // what needs a real fleet, said once each
  soak.push(
    'Caddy + Let’s Encrypt on a public domain — needs a real DNS name and ACME; local mode is plain HTTP on loopback.',
    'OIDC sign-in — the hub only talks to an issuer through its egress guard (oidc-egress.mjs), which refuses loopback and private addresses; a local mock IdP cannot be reached without weakening it.',
    'S3/R2 object storage (media off the checkout disk, the s3 backup target, s3-no-expiry) — Cloudflare R2 is out of bounds here; the file:// target and disk media are what this gate proves.',
    'Durable Objects, Workers routing (apps/cells/worker.mjs) and the fleet rollout (cells-deploy.yml) — dev-edge reproduces only the path rewrite + canvas-origin marker.',
    'Multi-arch (amd64) images — built here for this Mac’s arm64 only; hub-image.yml builds both under QEMU.',
    'The render sidecar (--render) — a ~3 GB browser image published per release; not part of this gate.',
    'Multiplayer surface catalogue + ai-runs through the container — the lanes take a hub URL once p8-t-multi-2 lands its local-hub confs; the hook is MAUDE_E2E_HUB_TARGET (see the hand-back).'
  );
  return finish(t0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
function wdio(conf, env, name) {
  const logFile = join(OUT, `wdio-${name}.log`);
  const r = run('npx', ['--no-install', 'wdio', 'run', conf], {
    cwd: join(ROOT, 'apps/desktop/e2e'),
    env: {
      ...process.env,
      PATH: `${STUB_BIN}:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
      MAUDE_CLAUDE_BIN: '',
      MAUDE_E2E_ON_TOP: '1',
      MAUDE_E2E_KEEP_FRONT: '1',
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      ...env,
    },
    timeout: 3_600_000,
  });
  writeFileSync(logFile, r.out);
  return {
    status: r.status,
    log: logFile,
    tail: r.out
      .split('\n')
      .filter((l) => /✖|Error|failed|FAIL/.test(l))
      .slice(-6)
      .join(' | '),
  };
}

const UP = { data: `${P}-up-data`, repo: `${P}-up-repo`, container: `${P}-up-hub` };
async function runHub(image, { port, secret, owner, name = UP.container, volumes, env = {} }) {
  dockerQuiet('rm', '-f', name);
  const envs = {
    HUB_PUBLIC_URL: `http://localhost:${port}`,
    HUB_SECRET: secret,
    HUB_INSECURE_HTTP: '1',
    HUB_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_CELL_PAIRING: '1',
    HUB_TRUSTED_PROXIES: '172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,fd00::/8',
    MAUDE_ADMIN_EMAIL: owner.email,
    MAUDE_ADMIN_PASSWORD: owner.password,
    ...env,
  };
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `127.0.0.1:${port}:1234`,
    ...volumes.flatMap((v) => ['-v', v]),
    ...Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    image
  );
  dockerObjects.containers.add(name);
  await until(`${image} healthy`, healthy(`http://localhost:${port}`), 180_000);
}

async function upgradeLegs() {
  const U = {
    port: await freePort(),
    secret: randomBytes(32).toString('hex'),
    owner: { email: 'owner@docker-upgrade.test', password: randomBytes(15).toString('base64url') },
    member: {
      email: 'member@docker-upgrade.test',
      password: randomBytes(15).toString('base64url'),
    },
  };
  U.url = `http://localhost:${U.port}`;
  const vols = [`${UP.data}:/data`, `${UP.repo}:/repo`];
  dockerObjects.volumes.add(UP.data);
  dockerObjects.volumes.add(UP.repo);
  const peers = {};
  await leg(
    'upgrade.v1',
    'the v1.9.1 image on a fresh volume: people + a real project from a 1.x peer',
    async () => {
      assert(imageExists(IMG.hubV1) && WS.v1src, 'no v1.9.1 image');
      await runHub(IMG.hubV1, { ...U, volumes: vols });
      const owner = await signIn(U.url, U.owner.email, U.owner.password);
      U.owner.token = owner.token;
      await inviteAndJoin(U.url, U.secret, { ...U.member, by: U.owner.email });
      U.member.token = (await signIn(U.url, U.member.email, U.member.password)).token;
      // the 1.x peer runs the v1.9.1 studio sources (deps installed frozen from the tag's own lockfile)
      const inst = run('bun', ['install', '--frozen-lockfile'], {
        cwd: join(WS.v1src, 'apps/studio'),
        timeout: 600_000,
      });
      assert(inst.status === 0, `v1.9.1 studio install: ${inst.out.slice(-300)}`);
      peers.v1 = await startPeer('v1', {
        hubUrl: U.url,
        token: U.member.token,
        studioRoot: join(WS.v1src, 'apps/studio'),
        canvases: { 'ui/legacy-one.tsx': 'Made on 1.9.1', 'ui/legacy-two.tsx': 'Also 1.9.1' },
      });
      await until(
        'the 1.x project on the v1 hub',
        // a 1.9.1 hub has no /v1/bootstrap; its admin canvas list names the stored documents
        async () => {
          const c = JSON.stringify(
            (
              await http(`${U.url}/admin/api/canvases`, {
                headers: { authorization: `Bearer ${U.secret}` },
              })
            ).body
          );
          return c.includes('legacy-one') && c.includes('legacy-two');
        },
        120_000
      );
      U.commitsV1 = Number(
        dockerQuiet('exec', UP.container, 'git', '-C', '/repo', 'rev-list', '--count', 'HEAD') ?? 0
      );
      U.versionV1 = (await http(`${U.url}/health`)).body.version ?? null;
      return { version: U.versionV1, commits: U.commitsV1 };
    }
  );
  await leg(
    'mixed.v2-on-v1-hub',
    'a v2 peer against the 1.x hub (CONTRACT A17: v2 opens it; the hub has no format-v2)',
    async () => {
      assert(peers.v1, 'no v1 hub');
      peers.v2old = await startPeer('v2-on-v1', { hubUrl: U.url, token: U.member.token });
      await until(
        'the 1.x canvases on the v2 peer',
        async () => peers.v2old.read('ui/legacy-one.tsx')?.includes('Made on 1.9.1'),
        120_000
      );
      const cfg = await peers.v2old.config();
      // the staged gate (format.ts STAGED_FORMAT_GATE_OPTS, newerOnly) keeps a format-1 project editable in v2
      peers.v2old.write('ui/legacy-two.tsx', 'Edited by v2 on the 1.x hub');
      await until(
        'the v2 edit on the 1.x peer',
        async () => peers.v1.read('ui/legacy-two.tsx')?.includes('Edited by v2'),
        120_000
      );
      peers.v2old.stop();
      return {
        formatVersion: cfg.formatVersion ?? null,
        formatGate: cfg.formatGate ?? null,
        readOnlyReason: cfg.readOnlyReason ?? null,
        note: 'editable both ways — the staged newerOnly gate; CONTRACT §4.1 full gate would open it view only',
      };
    }
  );
  await leg(
    'upgrade.v2',
    'the v2 image on the SAME volume: accounts, sessions, project and history survive',
    async () => {
      assert(peers.v1, 'no v1 hub');
      docker('stop', '-t', '20', UP.container);
      await runHub(IMG.hub, { ...U, volumes: vols });
      const health = (await http(`${U.url}/health`)).body;
      const session = await http(`${U.url}/auth/session`, {
        headers: { authorization: `Bearer ${U.member.token}` },
      });
      assert(
        session.status === 200,
        `a 1.9.1 session did not survive the upgrade: ${session.status}`
      );
      await signIn(U.url, U.owner.email, U.owner.password);
      await signIn(U.url, U.member.email, U.member.password);
      // what a person sees: a FRESH v2 peer of the upgraded hub receives the whole 1.x project
      await until(
        'the 1.x project on a fresh v2 peer of the upgraded hub',
        async () =>
          (await peerSees(U, 'ui/legacy-one.tsx', 'Made on 1.9.1')) &&
          (await peerSees(U, 'ui/legacy-two.tsx', 'Edited by v2 on the 1.x hub')),
        120_000
      );
      const docs = await bootstrapDocs(U.url, U.owner.token).catch((e) => [
        `bootstrap: ${e.message}`,
      ]);
      const commits = Number(
        dockerQuiet('exec', UP.container, 'git', '-C', '/repo', 'rev-list', '--count', 'HEAD') ?? 0
      );
      assert(commits >= U.commitsV1, `history shrank: ${U.commitsV1} → ${commits}`);
      // the 1.x peer stays connected through the swap and still edits a format-1 project
      peers.v1.write('ui/legacy-one.tsx', 'Edited on 1.9.1 after the hub upgrade');
      await until(
        'the 1.x edit on the upgraded hub',
        async () => peerSees(U, 'ui/legacy-one.tsx', 'after the hub upgrade'),
        120_000
      );
      return {
        version: health.version ?? null,
        formatVersion: health.formatVersion ?? null,
        commits,
        from: U.versionV1,
        bootstrapDocs: docs,
      };
    }
  );
  await leg(
    'mixed.v1-on-v2-project',
    'the owner moves the project to format 2: the 1.x peer turns view only and its edit is refused',
    async () => {
      assert(peers.v1, 'no 1.x peer');
      const flip = await http(`${U.url}/api/project-format`, {
        method: 'POST',
        headers: { authorization: `Bearer ${U.owner.token}` },
        body: { formatVersion: 2 },
      });
      assert(
        flip.status === 200,
        `format flip: ${flip.status} ${JSON.stringify(flip.body).slice(0, 200)}`
      );
      const cfg = await until(
        'the 1.x peer sees format 2',
        async () => {
          const c = await peers.v1.config();
          return c.formatGate ? c : null;
        },
        120_000
      );
      // the 1.x build's own gate (format.ts SUPPORTED_FORMAT 1): view only, by format, from the hub
      assert(
        cfg.readOnly === true &&
          cfg.readOnlyReason === 'format' &&
          cfg.formatGate?.projectFormat === 2,
        `the 1.x peer is not view only by format: ${JSON.stringify({ readOnly: cfg.readOnly, reason: cfg.readOnlyReason, gate: cfg.formatGate })}`
      );
      const before = await docText(U, 'ui/legacy-two.tsx');
      peers.v1.write('ui/legacy-two.tsx', 'A 1.x edit that must not land');
      await sleep(15_000);
      const after = await docText(U, 'ui/legacy-two.tsx');
      assert(
        !String(after).includes('must not land'),
        'the hub accepted a 1.x write to a format-2 project'
      );
      return {
        formatGate: cfg.formatGate,
        readOnlyReason: cfg.readOnlyReason ?? null,
        unchanged: before === after,
      };
    }
  );
  for (const p of Object.values(peers)) p.stop();
  dockerQuiet('rm', '-f', UP.container);
}

/** A second v2 peer as the hub's observer: does a fresh checkout of the project contain `needle`? */
async function peerSees(U, rel, needle) {
  if (!U.observer)
    U.observer = await startPeer('observer', { hubUrl: U.url, token: U.owner.token });
  return Boolean(U.observer.read(rel)?.includes(needle));
}
async function docText(U, rel) {
  await until(
    `${rel} on the observer`,
    async () => {
      if (!U.observer) await peerSees(U, rel, '');
      return U.observer.read(rel) !== null;
    },
    60_000
  );
  return U.observer.read(rel);
}

async function cellLegs() {
  const C = {
    cellPort: await freePort(),
    shellPort: await freePort(),
    canvasPort: await freePort(),
    tenant: 'docker-cell',
    secret: randomBytes(32).toString('hex'),
    owner: { email: 'owner@docker-cell.test', password: randomBytes(15).toString('base64url') },
    member: { email: 'member@docker-cell.test', password: randomBytes(15).toString('base64url') },
    backups: join(WORK, 'cell-backups'),
    name: `${P}-cell`,
  };
  while (new Set([C.cellPort, C.shellPort, C.canvasPort]).size < 3) C.canvasPort = await freePort();
  C.url = `http://localhost:${C.shellPort}`;
  mkdirSync(C.backups, { recursive: true });
  chmodSync(C.backups, 0o777); // the cell runs as `node`; the bind mount is this run's own dir
  const peers = {};
  let edge = null;
  await leg('cell.up', 'the cell image behind dev-edge.mjs, backups to file://', async () => {
    assert(imageExists(IMG.cell), 'no cell image');
    dockerQuiet('rm', '-f', C.name);
    const envs = {
      MAUDE_TENANT_ID: C.tenant,
      HUB_SECRET: C.secret,
      HUB_PUBLIC_URL: C.url,
      MAUDE_PUBLIC_CANVAS_ORIGIN: `http://localhost:${C.canvasPort}`,
      HUB_INSECURE_HTTP: '1',
      MAUDE_CELL_PAIRING: '1',
      MAUDE_ADMIN_EMAIL: C.owner.email,
      MAUDE_ADMIN_PASSWORD: C.owner.password,
      MAUDE_BACKUP_TARGET: 'file:///backups',
      MAUDE_BACKUP_INTERVAL_MS: '20000',
      HUB_TRUSTED_PROXIES: '172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,fd00::/8',
    };
    docker(
      'run',
      '-d',
      '--name',
      C.name,
      '-p',
      `127.0.0.1:${C.cellPort}:1234`,
      '-v',
      `${C.backups}:/backups`,
      '-v',
      `${P}-cell-data:/data`,
      '-v',
      `${P}-cell-repo:/repo`,
      ...Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      IMG.cell
    );
    dockerObjects.containers.add(C.name);
    dockerObjects.volumes.add(`${P}-cell-data`);
    dockerObjects.volumes.add(`${P}-cell-repo`);
    edge = spawn(
      'node',
      [
        join(ROOT, 'apps/cells/dev-edge.mjs'),
        '--cell',
        String(C.cellPort),
        '--shell',
        String(C.shellPort),
        '--canvas',
        String(C.canvasPort),
        '--tenant',
        C.tenant,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let edgeLog = '';
    edge.stdout.on('data', (c) => (edgeLog += c));
    edge.stderr.on('data', (c) => (edgeLog += c));
    edge.on('exit', (code) =>
      writeFileSync(join(OUT, 'dev-edge.log'), `${edgeLog}\n[exit ${code}]\n`)
    );
    children.push(edge);
    try {
      await until('the cell direct', healthy(`http://127.0.0.1:${C.cellPort}`), 180_000);
      await until('the cell through the edge', healthy(C.url), 60_000);
    } finally {
      writeFileSync(join(OUT, 'cell.log'), run('docker', ['logs', C.name]).out);
      writeFileSync(join(OUT, 'dev-edge.log'), edgeLog);
    }
    const logs = docker('logs', C.name);
    assert(/containment ok/.test(logs), 'the cell did not run its containment check');
    return { containment: true };
  });
  await leg('cell.sync', 'people and two peers sync through the edge into the cell', async () => {
    assert(edge, 'no cell');
    C.owner.token = (await signIn(C.url, C.owner.email, C.owner.password)).token;
    await inviteAndJoin(C.url, C.secret, { ...C.member, by: C.owner.email });
    C.member.token = (await signIn(C.url, C.member.email, C.member.password)).token;
    peers.a = await startPeer('cell-a', {
      hubUrl: C.url,
      token: C.member.token,
      canvases: { 'ui/cell-a.tsx': 'Into the cell' },
    });
    peers.b = await startPeer('cell-b', { hubUrl: C.url, token: C.owner.token });
    await until(
      'peer A’s canvas on peer B through the cell',
      async () => peers.b.read('ui/cell-a.tsx')?.includes('Into the cell'),
      120_000
    );
    peers.b.write('ui/cell-a.tsx', 'Back out of the cell');
    await until(
      'peer B’s edit on peer A',
      async () => peers.a.read('ui/cell-a.tsx')?.includes('Back out'),
      120_000
    );
    // the canvas door: the edge rewrites canvas.<zone>/<project>/… and sets the marker
    const canvas = await http(`http://localhost:${C.canvasPort}/${C.tenant}/_health`, {
      raw: true,
    });
    assert(
      [200, 401].includes(canvas.status),
      `the canvas door did not reach the cell: ${canvas.status}`
    );
    return { canvasDoor: canvas.status };
  });
  await leg(
    'cell.backup',
    'a backup generation lands on file:// and survives a cell restart',
    async () => {
      assert(edge, 'no cell');
      const files = await until(
        'a backup generation on disk',
        async () => {
          const all = walk(C.backups);
          return all.some((f) => /hub\.db/.test(f)) ? all : null;
        },
        180_000,
        2000
      );
      const listing = async () =>
        JSON.stringify({
          boot: (
            await http(`${C.url}/api/projects/current/v1/bootstrap`, {
              headers: { authorization: `Bearer ${C.owner.token}` },
            })
          ).body?.docs,
          canvases: (
            await http(`${C.url}/admin/api/canvases`, {
              headers: { authorization: `Bearer ${C.secret}` },
            })
          ).body?.canvases,
        }).slice(0, 400);
      const beforeRestart = await hubHas(C.url, C.owner.token, C.secret, 'ui/cell-a.tsx');
      const beforeListing = await listing();
      docker('restart', C.name);
      await until('the cell back', healthy(C.url), 180_000);
      // what a person sees after the restart: a FRESH peer of the cell receives the project
      peers.c = await startPeer('cell-c', { hubUrl: C.url, token: C.owner.token });
      const ok = await until(
        'the project on a fresh peer after the restart',
        async () => peers.c.read('ui/cell-a.tsx')?.includes('Back out'),
        120_000
      ).catch(() => false);
      assert(
        ok,
        `the cell lost its project across a restart — before: ${beforeRestart} ${beforeListing}; after: ${await listing()}`
      );
      return {
        generationFiles: files.length,
        sample: files.slice(0, 4).map((f) => f.slice(C.backups.length)),
      };
    }
  );
  await leg(
    'cell.restore-drill',
    'the file:// generation restores into an empty disk and holds the canvas',
    async () => {
      assert(edge, 'no cell');
      // the boot-time restore lane (rehydrate.mjs) run by hand against empty scratch disks inside the cell
      const r = run('docker', [
        'exec',
        '-e',
        'MAUDE_BACKUP_TARGET=file:///backups',
        '-e',
        `MAUDE_BACKUP_PREFIX=tenants/${C.tenant}`,
        C.name,
        'sh',
        '-c',
        'rm -rf /tmp/drill && mkdir -p /tmp/drill/data /tmp/drill/repo && node /app/dist/rehydrate.mjs --data /tmp/drill/data --repo /tmp/drill/repo && ls /tmp/drill/data',
      ]);
      assert(r.status === 0, `rehydrate into empty disks: ${r.out.slice(-400)}`);
      const q = run('docker', [
        'exec',
        '-w',
        '/app',
        C.name,
        'node',
        '-e',
        "const D=require('better-sqlite3');const db=new D('/tmp/drill/data/hub.db',{readonly:true});console.log(JSON.stringify(db.prepare('SELECT name FROM documents').all().map(r=>r.name)))",
      ]);
      assert(
        q.status === 0 && /cell-a/.test(q.out),
        `the restored hub.db does not hold the canvas: ${q.out.slice(-300)}`
      );
      run('docker', ['exec', C.name, 'rm', '-rf', '/tmp/drill']);
      return {
        restored: r.out.trim().split('\n').slice(-6),
        documents: q.out.trim().slice(0, 200),
      };
    }
  );
  for (const p of Object.values(peers)) p.stop();
  try {
    edge?.kill('SIGTERM');
  } catch {
    /* gone */
  }
  dockerQuiet('rm', '-f', C.name);
}
function walk(dir) {
  const out = [];
  for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (statSync(p).size > 0) out.push(p);
  }
  return out;
}

// ── down + report ────────────────────────────────────────────────────────────────────────────────────────
function cleanup() {
  for (const c of children)
    try {
      c.kill('SIGTERM');
    } catch {
      /* gone */
    }
  if (existsSync(join(WS.dir, 'docker-compose.yml'))) compose('down', '-v', '--remove-orphans');
  for (const c of dockerObjects.containers) if (c) dockerQuiet('rm', '-f', c);
  for (const v of dockerObjects.volumes) dockerQuiet('volume', 'rm', '-f', v);
  for (const n of dockerObjects.networks) dockerQuiet('network', 'rm', n);
  if (!has('keep-images')) for (const i of dockerObjects.images) dockerQuiet('rmi', i);
  else dockerQuiet('rmi', `ghcr.io/1agh/maude-hub:${IMG.composeTag}`);
  const left = dockerQuiet('ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}');
  rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return left;
}
function finish(t0) {
  const left = cleanup();
  const wallS = Math.round((Date.now() - t0) / 1000);
  const failed = results.filter((r) => r.status === 'fail');
  const verdict = {
    gate: 'V2-8.18',
    title: 'Self-hosted hub + cell images (Docker)',
    verdict: failed.length === 0 ? 'pass' : 'fail',
    wallSeconds: wallS,
    legs: results.map(({ id, status, ms, why }) => ({
      id,
      status,
      s: Math.round(ms / 1000),
      ...(why ? { why } : {}),
    })),
    failed: failed.map((r) => r.id),
    soak,
    leftovers: left || null,
    out: OUT,
  };
  const md = [
    `# V2-8.18 — Self-hosted hub + cell images (Docker) — ${STAMP}`,
    '',
    `Wall time ${Math.floor(wallS / 60)} min ${wallS % 60} s. Images: ${Object.values(IMG).join(', ')}. Local only — nothing pushed, no registry login, no R2/Cloudflare.`,
    '',
    '| leg | what | status | s | detail |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => {
      const { id, title, status, ms, ...rest } = r;
      return `| ${id} | ${title} | ${status} | ${Math.round(ms / 1000)} | ${JSON.stringify(rest).replaceAll('|', '\\|').slice(0, 500)} |`;
    }),
    '',
    '## Soak (needs a real fleet / domain)',
    '',
    ...soak.map((s) => `- ${s}`),
    '',
    '```json',
    JSON.stringify(verdict, null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'report.md'), md);
  writeFileSync(join(OUT, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(md);
  process.exit(failed.length === 0 ? 0 : 1);
}

process.on('SIGINT', () => finish(Date.now()));
process.on('SIGTERM', () => finish(Date.now()));
await main().catch((err) => {
  record('gate', 'the gate itself', 'fail', { why: String(err?.stack ?? err).slice(0, 800) });
  finish(Date.now());
});
