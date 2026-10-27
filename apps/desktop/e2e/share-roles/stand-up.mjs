// The share-roles lane's world, stood up on loopback and torn down after (S9.21c · V2-8.3).
//
//   scenarios/share-roles.e2e.ts needs: a hub that holds roles-v2 (Can view, canvas scope, share links),
//   four people with accounts, the owner's linked project, Lukáš's studio already running, and a loopback
//   control that stands in for "Petra accepts the invitation" and "a third person opens the link".
//   `MAUDE_SHARE_ROLES_CONFIG` (wdio.share-roles.conf.ts) names all of it; this module writes that file.
//
// WHAT IS REAL AND WHAT IS NOT
//   • the HUB is the real hub from source (fixtures/share-roles-hub.mjs), in cloud-identity mode, so every
//     `/api/access/*` call is FORWARDED to a control plane exactly as a cell forwards it;
//   • the CONTROL PLANE is the real one — apps/cloud/worker.mjs, in this process, on an in-memory SQLite
//     standing in for D1 (what apps/cloud's own tests do) behind a loopback HTTP server. Invitations, grants,
//     requests, links, memberships and the notices it sends the cell are its code, not a stub of it;
//   • its two outbound calls to the cell (`https://<project>.<zone>/health` and `/internal/access-changed`)
//     are routed to the local hub by a `fetch` shim that is installed in THIS process only, refuses every
//     other non-loopback host, and is removed on stop;
//   • a person's credential is minted the way the cell does it: the project token the control plane would
//     hand them (`mintProjectToken`) is exchanged at the hub's `/auth/login` — except for Can view, which
//     the desktop door refuses by design (409 browser-door) and the cell's browser lane mints instead
//     (`peerTokenDoor … browserLane` + `peerSessionFields`, the same functions);
//   • the LINK VIEWER is what a link viewer really is — a plain browser on the project's CELL door
//     (decision maude/v2-p8-e2e-link-viewer-on-cell-door). A second hub runs in workspace mode
//     (fixtures/share-roles-cell.mjs: the studio as its child, the Smoke canvas in its own checkout, the
//     canvas origin through its door, the same cloud identity), and `/viewer/redeem` walks the control
//     plane's real link → browser-door → handoff-code redirects and hands back the cell's own
//     `/auth/browser?code=…`, so the browser's session cookie is minted by the cell itself. The control
//     plane's notices go to BOTH hubs (they are one project's cell, split in two here);
//   • one thing is a stand-in: a studio renews its credential through the control plane's project listing,
//     whose project address is `https://<id>.<zone>` and can never match a loopback hub. So the runner does
//     that exchange itself when a person's claim changes (`watchClaims`): it re-mints and rewrites that
//     person's hubs.json, which the studio watches. That is the "re-exchange" the scenario waits for.
//
// Everything lives under one throwaway directory: a throwaway HOME and XDG (never ~/.config/maude), a stub
// `claude` first on PATH (no keychain dialog), NO_OPEN and MAUDE_NO_AUTOBUILD on every boot. Run under
// Node 24 (better-sqlite3 for the hub's token store, node:sqlite for the control plane's D1).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findNode24, hubEnv } from '../fixtures/local-hub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const E2E = resolve(HERE, '..');

const PROJECT_ID = 'share-roles';
const PROJECT_NAME = 'Share Roles';
const ZONE = 'share-roles.test';
const CANVAS = 'ui/Smoke.tsx';
const PEOPLE = {
  owner: { email: 'owner@share-roles.test', name: 'Olga Owner' },
  petra: { email: 'petra@share-roles.test', name: 'Petra Nováková' },
  lukas: { email: 'lukas@share-roles.test', name: 'Lukáš Dvořák' },
  viewer: { email: 'viewer@share-roles.test', name: 'Vendula Host' },
};

const PRIVATE_TSX = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Private() {
  return (
    <DesignCanvas>
      <DCSection id="private" title="Private">
        <DCArtboard id="private" label="PRIVATE/01" width={480} height={320}>
          <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', color: '#111' }}>
            <h1>Not for Petra</h1>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const PRIVATE_META = `${JSON.stringify(
  {
    title: 'Private',
    platform: 'desktop',
    sections: [
      {
        id: 'private',
        title: 'Private',
        artboards: [{ id: 'private', label: 'PRIVATE/01', width: 480, height: 320 }],
      },
    ],
    css_mode: 'inline',
    layout: { artboards: [{ id: 'private', x: 0, y: 0 }] },
  },
  null,
  2
)}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imp = (rel) => import(new URL(rel, `file://${REPO}/`).href);

/** The first free loopback TCP port. */
function freePort() {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function until(what, fn, ms = 30_000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`${what}: not within ${ms} ms${last ? ` (${String(last)})` : ''}`);
}

const isLoopbackHost = (h) =>
  h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h.endsWith('.localhost');

/** hubs.json / project-links.json: owner-only, replaced by rename (the studio's watcher sees a rename). */
function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, file);
}

/** The role a 1.x build reads from hubs.json (sync/hubs-config.ts `v1RoleProjection`). */
const v1Role = (role) =>
  typeof role === 'string' && ['owner', 'member', 'viewer', 'admin'].includes(role)
    ? role
    : 'viewer';

/**
 * @param {{ out?: string, workDir?: string, keep?: boolean, log?: (line: string) => void,
 *           bun?: string }} [opts]
 */
export async function standUp(opts = {}) {
  if (process.versions.modules !== '137') {
    throw new Error(
      'the share-roles runner needs Node 24 (better-sqlite3 is built for ABI 137) — run it with a Node 24 binary first on PATH'
    );
  }
  const log = opts.log ?? (() => {});
  const work = opts.workDir ?? mkdtempSync(join(tmpdir(), 'maude-share-roles-'));
  mkdirSync(work, { recursive: true });
  const out = opts.out ?? join(work, 'evidence');
  mkdirSync(out, { recursive: true });
  const bun = opts.bun ?? process.env.MAUDE_E2E_BUN ?? 'bun';
  // Studio output is evidence, not noise: one log per studio under <out>/logs.
  const logs = join(out, 'logs');
  mkdirSync(logs, { recursive: true });
  const logFd = (name) => openSync(join(logs, `${name}.log`), 'a', 0o600);

  // ── cleanup bookkeeping ───────────────────────────────────────────────────────────────
  const children = [];
  const servers = [];
  const timers = [];
  let stopped = false;
  const realFetch = globalThis.fetch;
  async function stop() {
    if (stopped) return;
    stopped = true;
    globalThis.fetch = realFetch;
    for (const t of timers) clearInterval(t);
    for (const s of servers) s.closeAllConnections?.();
    for (const s of servers) s.close();
    for (const c of children) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* gone */
      }
    }
    const deadline = Date.now() + 8000;
    while (children.some((c) => c.exitCode === null && c.signalCode === null)) {
      if (Date.now() > deadline) {
        for (const c of children) {
          try {
            c.kill('SIGKILL');
          } catch {
            /* gone */
          }
        }
        break;
      }
      await sleep(100);
    }
    try {
      sqlite?.close();
    } catch {
      /* closed */
    }
    try {
      const { closeTokens } = await imp('apps/hub/src/tokens.mjs');
      closeTokens?.(hubData);
      closeTokens?.(cellData);
    } catch {
      /* not exported or closed */
    }
    if (!opts.keep && !opts.workDir && !process.env.MAUDE_E2E_KEEP) {
      rmSync(work, { recursive: true, force: true });
    }
  }

  let sqlite = null;
  const hubData = join(work, 'hub-data');
  const cellData = join(work, 'cell', 'data');
  try {
    // ── the control plane (real worker, in-memory D1) ─────────────────────────────────
    const [{ default: worker }, { d1FromSqlite }, { applySchema }, { SCHEMA_SQL }] =
      await Promise.all([
        imp('apps/cloud/worker.mjs'),
        imp('apps/cloud/db.mjs'),
        imp('apps/cloud/migrate.mjs'),
        imp('apps/cloud/schema.mjs'),
      ]);
    const { deriveCellSecret, mintProjectToken } = await imp('apps/cloud/cell-token.mjs');
    const { loadClaim } = await imp('apps/cloud/access-forward.mjs');
    const { DatabaseSync } = await import('node:sqlite');
    sqlite = new DatabaseSync(':memory:');
    const DB = d1FromSqlite(sqlite);
    await applySchema(DB, SCHEMA_SQL);
    const master = randomBytes(24).toString('hex');
    const env = { DB, CELL_SECRET_MASTER: master, CELL_ZONE: ZONE };

    const cpPort = await freePort();
    const cpUrl = `http://127.0.0.1:${cpPort}`;
    const cpServer = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const method = req.method ?? 'GET';
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) for (const x of v) headers.append(k, x);
          else if (v !== undefined) headers.set(k, v);
        }
        const request = new Request(`${cpUrl}${req.url}`, {
          method,
          headers,
          ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
        });
        const response = await worker.fetch(request, env, {
          waitUntil: (p) => p?.catch?.(() => {}),
        });
        const outHeaders = {};
        for (const [k, v] of response.headers) if (k !== 'set-cookie') outHeaders[k] = v;
        const cookies = response.headers.getSetCookie?.() ?? [];
        res.writeHead(
          response.status,
          cookies.length ? { ...outHeaders, 'set-cookie': cookies } : outHeaders
        );
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
    });
    servers.push(cpServer);
    await new Promise((ok) => cpServer.listen(cpPort, '127.0.0.1', ok));

    // Accounts: a real sign-up each (the control plane's own /auth/signup), then a display name.
    const password = `sr-${randomBytes(12).toString('hex')}`;
    let ip = 0;
    const sessions = {};
    for (const [who, p] of Object.entries(PEOPLE)) {
      const res = await realFetch(`${cpUrl}/auth/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': `10.7.0.${++ip}`,
        },
        body: new URLSearchParams({ email: p.email, password, disclosure: 'yes' }).toString(),
      });
      const cookie = /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
      if (!cookie)
        throw new Error(`control plane sign-up for ${who} gave no session (${res.status})`);
      sessions[who] = cookie;
      sqlite.prepare('UPDATE accounts SET name = ? WHERE email = ?').run(p.name, p.email);
    }
    const accountId = (who) =>
      sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(PEOPLE[who].email).id;
    sqlite
      .prepare(
        "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES (?, ?, ?, 'active', 1, 1)"
      )
      .run(PROJECT_ID, accountId('owner'), PROJECT_NAME);
    sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, 'member', 1)"
      )
      .run(PROJECT_ID, accountId('lukas'));

    // ── the hub (real, cloud-identity, roles-v2) ──────────────────────────────────────
    const node = findNode24();
    const hubSecret = await deriveCellSecret(master, PROJECT_ID);
    const projectKey = await deriveCellSecret(master, PROJECT_ID, 'project-token');
    const hubChildEnv = hubEnv({
      PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}`,
      MAUDE_CLOUD_IDENTITY: '1',
      MAUDE_TENANT_ID: PROJECT_ID,
      MAUDE_CONTROL_PLANE_URL: cpUrl,
      HUB_SECRET: hubSecret,
      MAUDE_PROJECT_TOKEN_KEY: projectKey,
      NO_OPEN: '1',
    });
    const hub = await new Promise((ok, fail) => {
      const proc = spawn(node, [join(E2E, 'fixtures/share-roles-hub.mjs'), hubData], {
        env: hubChildEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(proc);
      const hubLog = logFd('hub');
      let buf = '';
      const timer = setTimeout(
        () => fail(new Error(`the hub did not start in 30 s: ${buf.slice(-600)}`)),
        30_000
      );
      proc.on('exit', (code) => {
        clearTimeout(timer);
        fail(new Error(`the hub exited (${code}) before it listened: ${buf.slice(-600)}`));
      });
      proc.stdout.on('data', (c) => {
        writeSync(hubLog, c);
        buf += c.toString('utf8');
        const line = buf.split('\n').find((l) => l.startsWith('{'));
        if (!line) return;
        clearTimeout(timer);
        proc.removeAllListeners('exit');
        ok(JSON.parse(line));
      });
      proc.stderr.on('data', (c) => {
        writeSync(hubLog, c);
        buf += c.toString('utf8');
      });
    });
    const hubUrl = String(hub.http);
    log(`hub ${hubUrl} · control plane ${cpUrl}`);

    // The control plane reaches its cell by name; here the name is the local hub — and nothing else off-box.
    const cellHost = `${PROJECT_ID}.${ZONE}`;
    /** The link viewer's cell, once it is up (below). */
    let cell = null;
    globalThis.fetch = (input, init) => {
      const req = input instanceof Request ? input : null;
      const u = new URL(req ? req.url : String(input));
      if (u.hostname === cellHost) {
        const to = `${hubUrl}${u.pathname}${u.search}`;
        // A notice (`/internal/*`) reaches the link viewer's cell too — the same message, the same secret.
        if (u.pathname.startsWith('/internal/') && cell) {
          const toCell = `${cell.http}${u.pathname}${u.search}`;
          realFetch(req ? new Request(toCell, req.clone()) : toCell, init).then(
            (r) => log(`trace ${Date.now()} cp→viewer-cell ${u.pathname} → ${r.status}`),
            (e) =>
              log(`trace ${Date.now()} cp→viewer-cell ${u.pathname} failed: ${e?.message ?? e}`)
          );
        }
        const sent = realFetch(req ? new Request(to, req) : to, init);
        // trace (p8-e2e-fix-r5): the control plane → cell notices (`/internal/access-changed`) and their answers,
        // beside the claim watcher's rewrites — so a missing "raised" is placed on one side or the other
        if (u.pathname.startsWith('/internal/')) {
          const body = typeof init?.body === 'string' ? init.body : '';
          sent.then(
            (r) =>
              log(`trace ${Date.now()} cp→cell ${u.pathname} ${body.slice(0, 160)} → ${r.status}`),
            (e) => log(`trace ${Date.now()} cp→cell ${u.pathname} failed: ${e?.message ?? e}`)
          );
        }
        return sent;
      }
      if (!isLoopbackHost(u.hostname)) {
        return Promise.reject(
          new Error(`share-roles rig: ${u.hostname} is not reachable from here`)
        );
      }
      return realFetch(input, init);
    };

    // The posture this lane is about: refuse a hub that does not hand out links / canvas scope.
    const health = await (await realFetch(`${hubUrl}/health`)).json();
    if (!health?.access?.links || !health.access.scopes?.includes('canvas')) {
      throw new Error(
        `the hub's /health.access is not roles-v2: ${JSON.stringify(health?.access)}`
      );
    }

    // ── credentials ───────────────────────────────────────────────────────────────────
    const { addToken } = await imp('apps/hub/src/tokens.mjs');
    const { peerSessionFields } = await imp('apps/hub/src/cloud-identity.mjs');
    const { peerTokenDoor } = await imp('apps/studio/access/scope.ts');
    let minted = 0;

    const claimKey = (verdict) => JSON.stringify({ role: verdict.role, grants: verdict.grants });
    /** The hubs.json record for `who`, from their claim in the control plane's rows. */
    async function credentialFor(who) {
      const { verdict } = await loadClaim(DB, PROJECT_ID, accountId(who));
      if (!verdict.ok) throw new Error(`${who} holds no access (${verdict.reason})`);
      const claim = { v: 1, role: verdict.role, grants: verdict.grants };
      const email = PEOPLE[who].email;
      const desktop = peerTokenDoor(claim, { declaredAccess: 2, doorUrl: hubUrl });
      const now = Date.now();
      if (desktop.outcome === 'mint') {
        const { token } = await mintProjectToken({
          master,
          project: PROJECT_ID,
          email,
          role: desktop.claim.role,
          grants: desktop.claim.grants,
        });
        const res = await realFetch(`${hubUrl}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-maude-access': '2' },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => null);
        if (res.status !== 200 || !body?.token) {
          throw new Error(`hub /auth/login for ${who}: ${res.status} ${JSON.stringify(body)}`);
        }
        return {
          verdict,
          claim: desktop.claim,
          record: {
            token: body.token,
            linkedAt: now,
            role: v1Role(body.user?.role ?? desktop.claim.role),
            ...(desktop.v2 ? { access: desktop.claim } : {}),
            ...(typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
          },
        };
      }
      // Can view: the desktop door answers 409 browser-door by design; the cell's browser lane mints it.
      const lane = peerTokenDoor(claim, { declaredAccess: 2, browserLane: true });
      if (lane.outcome !== 'mint')
        throw new Error(`${who}: no credential for ${JSON.stringify(claim)}`);
      const expiresAt = now + 12 * 3600_000;
      const t = addToken(hubData, {
        label: `e2e-${who}-${++minted}`,
        owner: email,
        expiresAt,
        ...peerSessionFields(lane),
      });
      return {
        verdict,
        claim: lane.claim,
        record: {
          token: t.value,
          linkedAt: now,
          role: v1Role(lane.claim.role),
          access: lane.claim,
          expiresAt,
        },
      };
    }

    // ── projects and studios ──────────────────────────────────────────────────────────
    const fixture = join(E2E, 'fixtures/project/.design');
    const baseConfig = JSON.parse(readFileSync(join(fixture, 'config.json'), 'utf8'));
    const linkedHub = () => ({ url: hubUrl, linkedAt: Date.now() });
    function seedProject(root, { canvas, withPrivate = false, linked = true }) {
      const design = join(root, '.design');
      mkdirSync(join(design, 'ui'), { recursive: true });
      const config = {
        ...baseConfig,
        name: PROJECT_NAME,
        ...(linked ? { linkedHub: linkedHub() } : {}),
      };
      writeFileSync(join(design, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
      if (canvas) {
        cpSync(join(fixture, 'ui/Smoke.tsx'), join(design, 'ui/Smoke.tsx'));
        cpSync(join(fixture, 'ui/Smoke.meta.json'), join(design, 'ui/Smoke.meta.json'));
      }
      // A second canvas only the project's own people are given: what Petra must NOT be shown.
      if (withPrivate) {
        writeFileSync(join(design, 'ui/Private.tsx'), PRIVATE_TSX);
        writeFileSync(join(design, 'ui/Private.meta.json'), PRIVATE_META);
      }
      if (existsSync(join(fixture, '.gitignore'))) {
        cpSync(join(fixture, '.gitignore'), join(design, '.gitignore'));
      }
    }

    // The owner: this machine's native app. Its hubs.json, and the per-Mac link record beside it
    // (a committed `linkedHub` is a claim until a person on THIS machine linked it — link-consent.ts).
    const ownerDir = join(work, 'owner');
    const nativeProject = join(ownerDir, 'project');
    const ownerHubs = join(ownerDir, 'config', 'hubs.json');
    seedProject(nativeProject, { canvas: true, withPrivate: true });
    const ownerCred = await credentialFor('owner');
    writeJsonAtomic(ownerHubs, { hubs: { [hubUrl]: ownerCred.record } });
    {
      const { realpathSync } = await import('node:fs');
      writeJsonAtomic(join(dirname(ownerHubs), 'project-links.json'), {
        v: 1,
        since: Date.now() - 60_000,
        links: { [realpathSync(nativeProject)]: { hub: hubUrl, at: Date.now(), how: 'link' } },
      });
    }

    const { stubClaudeEnv } = await import(
      new URL('scripts/lib/stub-claude.mjs', `file://${REPO}/`).href
    );
    const studios = {};
    /** Boot a studio on `project` with `hubs` as its credential store; resolves to its address. */
    async function bootStudio(root, project, hubs) {
      const home = join(root, 'home');
      mkdirSync(home, { recursive: true });
      const port = await freePort();
      const studioEnv = {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(root, 'config'),
        ...stubClaudeEnv(home),
        HUBS_CONFIG_PATH: hubs,
        MAUDE_CLOUD_CONFIG: join(root, 'cloud.json'),
        MAUDE_APP_BOUND_HUB: hubUrl,
        MAUDE_CANVAS_ORIGIN_SPLIT: '1',
        MAUDE_NO_AUTOBUILD: '1',
        NO_OPEN: '1',
      };
      writeFileSync(studioEnv.MAUDE_CLOUD_CONFIG, '{}', { mode: 0o600 });
      const proc = spawn(
        bun,
        [
          '--no-env-file',
          join(REPO, 'apps/studio/server.ts'),
          '--root',
          project,
          '--port',
          String(port),
        ],
        {
          cwd: REPO,
          env: studioEnv,
          stdio: ['ignore', logFd(`studio-${basename(root)}`), logFd(`studio-${basename(root)}`)],
        }
      );
      children.push(proc);
      const url = `http://127.0.0.1:${port}`;
      await until(
        `the studio on ${project}`,
        async () => (await realFetch(`${url}/_health`)).ok,
        90_000
      );
      return { url, proc };
    }
    /** Boot a studio for `who` (a project of their own, their own credential) and return its address. */
    async function startStudio(who) {
      const root = join(work, who);
      const project = join(root, 'project');
      seedProject(project, { canvas: true, withPrivate: who === 'lukas' });
      const cred = await credentialFor(who);
      const hubs = join(root, 'config', 'hubs.json');
      writeJsonAtomic(hubs, { hubs: { [hubUrl]: cred.record } });
      const { url, proc } = await bootStudio(root, project, hubs);
      studios[who] = { url, project, hubs, claim: claimKey(cred.verdict), proc };
      log(`${who}'s studio ${url}`);
      return url;
    }
    /** The owner's studio, for a headless check only: the native app runs its own sidecar on the same project. */
    const startOwnerStudio = () => bootStudio(ownerDir, nativeProject, ownerHubs);

    // A person's access changed (raised, narrowed): do the credential exchange a studio would, and say it
    // in hubs.json. A person who lost everything is left alone — the hub ends their sessions itself.
    const watch = setInterval(async () => {
      for (const [who, s] of Object.entries(studios)) {
        try {
          const { verdict } = await loadClaim(DB, PROJECT_ID, accountId(who));
          if (!verdict.ok) continue;
          const now = claimKey(verdict);
          if (now === s.claim) continue;
          const cred = await credentialFor(who);
          writeJsonAtomic(s.hubs, { hubs: { [hubUrl]: cred.record } });
          s.claim = now;
          log(`${who}'s credential re-exchanged: ${now}`);
          const { statSync } = await import('node:fs');
          log(
            `trace ${Date.now()} watcher rewrote ${who}'s hubs.json mtimeMs=${statSync(s.hubs).mtimeMs}`
          );
        } catch {
          /* the next tick */
        }
      }
    }, 400);
    timers.push(watch);

    await startStudio('lukas');

    // ── the link viewer's cell (workspace mode: the hub is the door, the studio its child) ──
    {
      const root = join(work, 'cell');
      const repo = join(root, 'repo');
      const home = join(root, 'home');
      mkdirSync(home, { recursive: true });
      // The project's own checkout: the same canvases, no linkedHub — a cell IS the project's hub.
      seedProject(repo, { canvas: true, withPrivate: true, linked: false });
      const inRepo = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      inRepo('init', '-q', '-b', 'main');
      inRepo('config', 'user.email', 'cell@share-roles.test');
      inRepo('config', 'user.name', 'Share Roles Cell');
      inRepo('add', '-A');
      inRepo('commit', '-q', '-m', 'seed: share-roles cell');
      const port = await freePort();
      const studioPort = await freePort();
      // `*.localhost` is loopback in every Chromium; studio. and canvas. share a site, as on the fleet, so
      // the canvas capability cookie (SameSite=Strict) flows.
      const publicUrl = `http://studio.share-roles-cell.localhost:${port}`;
      const canvasOrigin = `http://canvas.share-roles-cell.localhost:${port}`;
      const stub = stubClaudeEnv(home, `${dirname(node)}${delimiter}${process.env.PATH ?? ''}`);
      const cellEnv = {
        ...hubEnv,
        // The studio child inherits HOME and PATH only (studio-child.mjs `childEnv`): a throwaway HOME,
        // the stub `claude` first on PATH.
        HOME: home,
        XDG_CONFIG_HOME: join(root, 'config'),
        ...stub,
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_REPO_DIR: repo,
        MAUDE_DESIGN_ROOT: '.design',
        MAUDE_STUDIO_SRC: join(REPO, 'apps/studio'),
        MAUDE_STUDIO_PORT: String(studioPort),
        ...(bun.includes('/') ? { MAUDE_BUN_PATH: bun } : {}),
        HUB_PUBLIC_URL: publicUrl,
        HUB_INSECURE_HTTP: '1',
        MAUDE_PUBLIC_CANVAS_ORIGIN: canvasOrigin,
        MAUDE_EXTRA_SHELL_ORIGINS: publicUrl,
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        MAUDE_PROJECT_NAME: PROJECT_NAME,
        MAUDE_NO_AUTOBUILD: '1',
      };
      const up = await new Promise((ok, fail) => {
        const proc = spawn(
          node,
          [join(E2E, 'fixtures/share-roles-cell.mjs'), cellData, String(port)],
          { env: cellEnv, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        children.push(proc);
        const cellLog = logFd('viewer-cell');
        let buf = '';
        const timer = setTimeout(
          () => fail(new Error(`the viewer's cell did not start in 120 s: ${buf.slice(-600)}`)),
          120_000
        );
        proc.on('exit', (code) => {
          clearTimeout(timer);
          fail(
            new Error(`the viewer's cell exited (${code}) before it served: ${buf.slice(-600)}`)
          );
        });
        proc.stdout.on('data', (c) => {
          writeSync(cellLog, c);
          buf += c.toString('utf8');
          const line = buf.split('\n').find((l) => l.startsWith('{"http"'));
          if (!line) return;
          clearTimeout(timer);
          proc.removeAllListeners('exit');
          ok(JSON.parse(line));
        });
        proc.stderr.on('data', (c) => {
          writeSync(cellLog, c);
          buf += c.toString('utf8');
        });
      });
      cell = { http: up.http, public: publicUrl, canvasOrigin, data: cellData, repo };
      log(`viewer's cell ${publicUrl} (loopback ${up.http})`);
    }

    // ── the loopback control the scenario calls ───────────────────────────────────────
    const inFlight = new Map();
    const once = (key, fn) => {
      if (!inFlight.has(key))
        inFlight.set(
          key,
          fn().catch((e) => {
            inFlight.delete(key);
            throw e;
          })
        );
      return inFlight.get(key);
    };
    const asSession = (who, extra = {}) => ({
      cookie: `maude_session=${sessions[who]}`,
      'sec-fetch-site': 'same-origin',
      'x-maude-access': '2',
      ...extra,
    });

    /** Petra opens her invitation signed in as herself: the control plane's own accept. */
    async function petraAccept() {
      const invite = await until(
        'Petra’s open invitation',
        async () =>
          sqlite
            .prepare(
              'SELECT id FROM project_invites WHERE project_id = ? AND lower(email) = ? AND redeemed_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1'
            )
            .get(PROJECT_ID, PEOPLE.petra.email),
        15_000
      );
      const res = await realFetch(`${cpUrl}/invite/${invite.id}`, {
        method: 'POST',
        redirect: 'manual',
        headers: asSession('petra'),
      });
      if (res.status !== 303) throw new Error(`accepting the invitation: ${res.status}`);
      return startStudio('petra');
    }

    /** A third person opens the owner's link, signed in: the control plane's own redeem. */
    async function viewerRedeem(link) {
      let token;
      try {
        const u = new URL(String(link));
        if (u.origin !== cpUrl) throw new Error('foreign origin');
        token = decodeURIComponent(/^\/l\/([^/]+)$/.exec(u.pathname)?.[1] ?? '');
      } catch {
        throw new Error('that is not a link this rig handed out');
      }
      if (!token) throw new Error('that is not a link this rig handed out');
      const res = await realFetch(`${cpUrl}/l/redeem`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...asSession('viewer'), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ link: token }).toString(),
      });
      if (res.status !== 303) throw new Error(`opening the link: ${res.status}`);
      // What their browser does next: the control plane's browser door, signed in as them, mints a one-time
      // code and sends them to the cell's `/auth/browser`. Followed here on the control plane only; the last
      // hop names the cell, which this rig answers with the viewer's cell's own public address.
      let at = new URL(res.headers.get('location') ?? '', cpUrl);
      for (let hop = 0; hop < 5; hop++) {
        if (at.hostname === cellHost) {
          if (at.pathname !== '/auth/browser' || !at.searchParams.get('code'))
            throw new Error(
              `the control plane sent the viewer to ${at.pathname}, not a sign-in code`
            );
          return `${cell.public}${at.pathname}${at.search}`;
        }
        if (at.origin !== cpUrl) throw new Error(`the link led off the rig (${at.origin})`);
        const next = await realFetch(at.href, { redirect: 'manual', headers: asSession('viewer') });
        const loc = next.headers.get('location');
        if (next.status < 300 || next.status >= 400 || !loc)
          throw new Error(`the browser door answered ${next.status} at ${at.pathname}`);
        at = new URL(loc, cpUrl);
      }
      throw new Error('the link redirected too many times');
    }

    const control = createServer(async (req, res) => {
      const reply = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        const chunks = [];
        for await (const c of req) chunks.push(c);
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          return reply(400, { error: 'not JSON' });
        }
        if (req.url === '/petra/accept')
          return reply(200, { url: await once('petra', petraAccept) });
        if (req.url === '/viewer/redeem') {
          return reply(200, { url: await once('viewer', () => viewerRedeem(body.url)) });
        }
        return reply(404, { error: 'not here' });
      } catch (e) {
        return reply(500, { error: String(e?.message ?? e) });
      }
    });
    servers.push(control);
    const controlPort = await freePort();
    await new Promise((ok) => control.listen(controlPort, '127.0.0.1', ok));

    // ── the run file ──────────────────────────────────────────────────────────────────
    const run = {
      out,
      nativeProject,
      ownerHubs,
      project: PROJECT_NAME,
      canvas: CANVAS,
      lifecycle: `http://127.0.0.1:${controlPort}`,
      petra: { email: PEOPLE.petra.email, name: PEOPLE.petra.name },
      lukas: { email: PEOPLE.lukas.email, name: PEOPLE.lukas.name, url: studios.lukas.url },
      viewer: { name: PEOPLE.viewer.name },
    };
    const runFile = join(work, 'share-roles.run.json');
    writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);

    return {
      runFile,
      run,
      work,
      stop,
      // for the headless test
      startOwnerStudio,
      hub: { http: hubUrl, data: hubData },
      cell,
      controlPlane: { url: cpUrl, sql: sqlite, sessions, accountId },
      studios,
      owner: { token: ownerCred.record.token },
      loadClaimFor: async (who) => (await loadClaim(DB, PROJECT_ID, accountId(who))).verdict,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}

/** Is this machine able to run the lane at all? (Node 24 for the hub, bun for the studios.) */
export function preflight() {
  findNode24();
  execFileSync(process.env.MAUDE_E2E_BUN ?? 'bun', ['--version'], { stdio: 'ignore' });
}
