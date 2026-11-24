// The local Maude Cloud stack behind cloud-scenarios.mjs. Everything from
// source, nothing from production:
//
//   control plane  apps/cloud/worker.mjs, bundled by `wrangler deploy --dry-run`
//                  (the deploy bundler, no upload) and run in local workerd
//                  through Miniflare with a local D1 + R2. Miniflare rather
//                  than `wrangler dev --local` for one reason: the Worker
//                  calls api.stripe.com, api.resend.com, api.cloudflare.com
//                  and https://<project>.<CELL_ZONE> by ABSOLUTE URL with no
//                  base-URL seam, and Miniflare's `outboundService` is the
//                  only way to answer those locally without editing product
//                  source. Every outbound fetch the Worker makes lands in
//                  `outbound()` below; an unknown host is refused (502) and
//                  recorded, never sent to the network.
//   Stripe         cloud-stripe-standin.mjs (API + hosted Checkout / portal).
//   e-mail         api.resend.com/emails is captured into `mail`.
//   Cloudflare     the Workers custom-domain API is a small registry here; a
//                  project hostname answers only while its domain is attached.
//   data plane     one hub from source per project (apps/hub/src/server.mjs,
//                  workspace mode), started on first request the way a cell
//                  wakes, with the env `apps/cells/cell-config.mjs cellEnv()`
//                  derives for that tenant and the config the control plane's
//                  /internal/cell-config answers. `POST /_cell/restart` stops
//                  it; the next request starts it with a fresh config.
//   edge           one local TLS listener (self-signed) that routes by Host:
//                  cloud.localhost → control plane, <id>.cell.localhost and
//                  canvas-<id>.cell.localhost → that project's cell,
//                  checkout.stripe.com / billing.stripe.com → the stand-in
//                  (the browser is started with a host-resolver rule that maps
//                  every name to this listener, so it cannot reach the real
//                  ones).

import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStripeStandin } from './cloud-stripe-standin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);

/** Every child this stack started, so a crash or a signal can reap them by pid. */
export const children = new Set();
export function track(proc) {
  children.add(proc);
  proc.on('exit', () => children.delete(proc));
  return proc;
}
/** Signal a child AND its own children (it was started as a process-group leader). */
export function killTree(proc, signal = 'SIGTERM') {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      process.kill(proc.pid, signal);
    } catch {
      /* already gone */
    }
  }
}
/** Pids whose command line names `needle` (a scratch dir): the net under the pid list. */
export function pidsNaming(needle) {
  try {
    return execFileSync('pgrep', ['-f', needle], { encoding: 'utf8' })
      .split('\n')
      .map((l) => Number(l.trim()))
      .filter((n) => n && n !== process.pid);
  } catch {
    return [];
  }
}
export function killAll(scratch = null) {
  const all = [...children];
  for (const p of all) killTree(p, 'SIGTERM');
  const strays = scratch ? pidsNaming(scratch) : [];
  for (const pid of strays) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    for (const p of all) killTree(p, 'SIGKILL');
    for (const pid of scratch ? pidsNaming(scratch) : []) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, 2500).unref();
}

export function freePort() {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function findPnpmPackage(name) {
  const root = join(REPO, 'node_modules/.pnpm');
  const dir = execFileSync('ls', [root], { encoding: 'utf8' })
    .split('\n')
    .filter((d) => d.startsWith(`${name}@`))
    .sort()
    .pop();
  if (!dir) throw new Error(`${name} is not installed under node_modules/.pnpm — run pnpm install`);
  return join(root, dir, 'node_modules', name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ log?: (s: string) => void, verbose?: boolean }} [opts]
 */
export async function startStack({ log = () => {}, verbose = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'maude-cloud-e2e-'));
  const edgePort = await freePort();
  const cpPort = await freePort();
  const ZONE = `cell.localhost:${edgePort}`;
  const CLOUD = `https://cloud.localhost:${edgePort}`;

  // Secrets for this run only. They live in memory and in the scratch dir.
  const secrets = {
    CELL_SECRET_MASTER: randomBytes(32).toString('hex'),
    STRIPE_SECRET_KEY: `sk_test_local_${randomBytes(8).toString('hex')}`,
    STRIPE_WEBHOOK_SECRET: `whsec_local_${randomBytes(12).toString('hex')}`,
    RESEND_API_KEY: `re_local_${randomBytes(8).toString('hex')}`,
    CF_PROVISION_TOKEN: `cf_local_${randomBytes(8).toString('hex')}`,
    GRANT_SIGNING_SECRET: randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID: 'local-e2e.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'local-e2e-not-a-secret',
  };

  // ------------------------------------------------------------- the bundle
  const bundleDir = join(root, 'bundle');
  mkdirSync(bundleDir, { recursive: true });
  log('bundling apps/cloud (wrangler deploy --dry-run)');
  execFileSync(
    join(REPO, 'node_modules/.pnpm/node_modules/.bin/wrangler'),
    ['deploy', '--dry-run', '--outdir', bundleDir],
    {
      cwd: join(REPO, 'apps/cloud'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    }
  );

  // ----------------------------------------------------------- the stand-ins
  /** Captured e-mail: { to, subject, text, at }. */
  const mail = [];
  /** Cloudflare custom domains: hostname → { id, hostname, service }. */
  const domains = new Map();
  /** Outbound fetches the Worker made to a host nothing here answers. */
  const unrouted = [];
  const cf = { domains, calls: [], failNext: 0 };

  let mf = null;
  const cloudFetch = (path, init = {}) =>
    mf.dispatchFetch(`${CLOUD}${path}`, { redirect: 'manual', ...init });

  const stripe = createStripeStandin({
    secretKey: secrets.STRIPE_SECRET_KEY,
    webhookSecret: secrets.STRIPE_WEBHOOK_SECRET,
    deliverWebhook: (rawBody, signature) =>
      cloudFetch('/webhooks/stripe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: rawBody,
      }),
  });

  const j = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function cloudflareApi(request) {
    const url = new URL(request.url);
    cf.calls.push({ method: request.method, path: url.pathname + url.search });
    if (request.headers.get('authorization') !== `Bearer ${secrets.CF_PROVISION_TOKEN}`) {
      return j({ success: false, errors: [{ message: 'Authentication error' }] }, 403);
    }
    if (cf.failNext > 0) {
      cf.failNext -= 1;
      return j({ success: false, errors: [{ message: 'stand-in: injected failure' }] }, 500);
    }
    const m = url.pathname.match(
      /^\/client\/v4\/accounts\/[^/]+\/workers\/domains(?:\/([\w-]+))?$/
    );
    if (!m) return j({ success: false, errors: [{ message: 'stand-in: unhandled path' }] }, 404);
    if (request.method === 'PUT') {
      const body = await request.json();
      const prior = domains.get(body.hostname);
      const record = prior ?? {
        id: randomBytes(8).toString('hex'),
        hostname: body.hostname,
        service: body.service,
      };
      domains.set(body.hostname, record);
      return j({ success: true, result: record });
    }
    if (request.method === 'GET') {
      const want = url.searchParams.get('hostname');
      const result = [...domains.values()].filter((d) => !want || d.hostname === want);
      return j({ success: true, result });
    }
    if (request.method === 'DELETE' && m[1]) {
      for (const [host, d] of domains) if (d.id === m[1]) domains.delete(host);
      return j({ success: true, result: { id: m[1] } });
    }
    return j({ success: false, errors: [{ message: 'stand-in: unhandled method' }] }, 405);
  }

  async function resendApi(request) {
    if (request.headers.get('authorization') !== `Bearer ${secrets.RESEND_API_KEY}`) {
      return j({ message: 'API key is invalid' }, 401);
    }
    const body = await request.json();
    for (const to of body.to ?? []) {
      mail.push({ to, subject: body.subject, text: body.text, from: body.from, at: Date.now() });
    }
    return j({ id: `mail_${randomBytes(6).toString('hex')}` });
  }

  // ---------------------------------------------------------------- the cells
  const cellMod = await import(pathToFileURL(join(REPO, 'apps/cells/cell-config.mjs')).href);
  const { v2Config } = await import(pathToFileURL(join(REPO, 'scripts/dev/v2-config.mjs')).href);
  const { writeGitignoreBlock } = await import(
    pathToFileURL(join(REPO, 'cli/lib/gitignore-block.mjs')).href
  );
  /** The cells Worker's own env, as far as `cellEnv()` reads it. */
  const cellsWorkerEnv = {
    CELL_ZONE: ZONE,
    CELL_SECRET_MASTER: secrets.CELL_SECRET_MASTER,
    CONTROL_PLANE_URL: `http://127.0.0.1:${cpPort}`,
    DASHBOARD_URL: CLOUD,
    CELL_LIVE_PAIRING: '*',
  };
  /** tenant → { proc, port, ready, startedWith, starts, log } */
  const cells = new Map();
  const cellStarts = new Map();
  const cellLogs = new Map();

  function git(cwd, ...args) {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  }

  function seedCheckout(repoDir, name) {
    const design = join(repoDir, '.design');
    mkdirSync(join(design, 'ui'), { recursive: true });
    git(repoDir, 'init', '-q', '-b', 'main');
    git(repoDir, 'config', 'user.email', 'cell@local');
    git(repoDir, 'config', 'user.name', 'Local Cell');
    writeFileSync(
      join(design, 'config.json'),
      `${JSON.stringify(v2Config({ name, canvasGroups: [{ label: 'Canvases', path: 'ui' }] }), null, 2)}\n`
    );
    writeFileSync(
      join(design, 'ui/welcome.tsx'),
      `export default function Welcome() {
  return (
    <main style={{ padding: 48, fontFamily: 'system-ui' }}>
      <h1>Welcome</h1>
      <p data-marker="seed">seeded by the local cell stand-in</p>
    </main>
  );
}
`
    );
    writeFileSync(
      join(design, 'ui/welcome.meta.json'),
      `${JSON.stringify({ title: 'Welcome', kind: 'web' }, null, 2)}\n`
    );
    writeGitignoreBlock(repoDir, { designRel: '.design' });
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'seed: local cloud e2e project');
  }

  async function startCell(tenant) {
    const config = await cellMod.fetchTenantConfig({ tenantId: tenant, env: cellsWorkerEnv });
    // The Durable Object refuses to start a cell for a tenant the control
    // plane does not describe (scanner-started cells, 2026-10-02).
    if (!config.projectName && !config.adminEmail) return null;
    const dir = join(root, 'cells', tenant);
    const repoDir = join(dir, 'repo');
    const first = !existsSync(repoDir);
    if (first) {
      mkdirSync(join(dir, 'data'), { recursive: true });
      mkdirSync(join(dir, 'object-storage'), { recursive: true });
      mkdirSync(join(dir, 'home/.config'), { recursive: true });
      mkdirSync(repoDir, { recursive: true });
      seedCheckout(repoDir, config.projectName ?? tenant);
    }
    const port = await freePort();
    const studioPort = await freePort();
    const derived = await cellMod.cellEnv({
      tenantId: tenant,
      env: cellsWorkerEnv,
      hostname: `${tenant}.${ZONE}`,
      config,
    });
    const env = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      ...derived,
      // What differs from a container, and only that:
      NODE_ENV: 'development',
      HOME: join(dir, 'home'),
      XDG_CONFIG_HOME: join(dir, 'home/.config'),
      DATA_DIR: join(dir, 'data'),
      MAUDE_REPO_DIR: repoDir,
      MAUDE_DESIGN_ROOT: '.design',
      PORT: String(port),
      MAUDE_STUDIO_PORT: String(studioPort),
      HUB_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
      MAUDE_BACKUP_TARGET: `file://${join(dir, 'object-storage')}`,
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      NO_OPEN: '1',
      // The hub and its studio child reach the control plane and the canvas
      // origin through the local TLS edge, whose certificate is self-signed.
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_NO_WARNINGS: '1',
    };
    // A local disk that survives restarts is not "ephemeral"; the container's is.
    env.MAUDE_DATA_EPHEMERAL = undefined;
    const proc = track(
      spawn(process.execPath, [join(REPO, 'apps/hub/src/server.mjs')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group: the hub supervises a studio child, and a
        // stop must take both.
        detached: true,
      })
    );
    const buf = cellLogs.get(tenant) ?? [];
    cellLogs.set(tenant, buf);
    const keep = (c) => {
      const s = c.toString('utf8');
      buf.push(s);
      if (buf.length > 400) buf.shift();
      if (verbose) process.stderr.write(`[cell ${tenant}] ${s}`);
    };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    cellStarts.set(tenant, (cellStarts.get(tenant) ?? 0) + 1);
    const entry = { proc, port, planState: config.planState ?? null, startedAt: Date.now() };
    entry.ready = (async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (proc.exitCode !== null)
          throw new Error(`cell ${tenant} exited (${proc.exitCode}): ${buf.join('').slice(-800)}`);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) return entry;
        } catch {
          /* not listening yet */
        }
        await sleep(250);
      }
      throw new Error(`cell ${tenant} did not answer /health in 60 s: ${buf.join('').slice(-800)}`);
    })();
    proc.on('exit', () => {
      if (cells.get(tenant) === entry) cells.delete(tenant);
    });
    cells.set(tenant, entry);
    return entry;
  }

  async function stopCell(tenant) {
    const entry = cells.get(tenant);
    if (!entry) return { stopped: false };
    cells.delete(tenant);
    await new Promise((done) => {
      entry.proc.once('exit', done);
      entry.proc.kill('SIGTERM');
      setTimeout(() => killTree(entry.proc, 'SIGKILL'), 4000).unref();
    });
    // The studio child the hub supervised must not outlive it.
    killTree(entry.proc, 'SIGTERM');
    for (const pid of pidsNaming(join(root, 'cells', tenant, 'repo'))) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
    return { stopped: true };
  }

  /** Which tenant a hostname names, and through which door. Null = not a project. */
  function tenantOf(hostname) {
    const host = String(hostname).toLowerCase();
    const zoneHost = `.${ZONE.split(':')[0]}`;
    if (!host.endsWith(zoneHost)) return null;
    const label = host.slice(0, -zoneHost.length);
    if (label.startsWith('canvas-')) {
      const tenant = label.slice('canvas-'.length);
      return cellMod.isValidTenantId(tenant) ? { tenant, canvas: true } : null;
    }
    return cellMod.isValidTenantId(label) ? { tenant: label, canvas: false } : null;
  }

  /**
   * The cells Worker's routing decision for one request: `{ port }` to proxy,
   * or `{ response }` to answer. Mirrors apps/cells/worker.mjs + routeToCell.
   */
  async function routeCell({ hostname, method, pathname, headers }) {
    const named = tenantOf(hostname);
    const plain = (text, status) =>
      new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!named) return { response: plain('this hostname is not a Maude project\n', 404) };
    const { tenant, canvas } = named;
    // No custom domain attached ⇒ the hostname does not route at all.
    const attached = domains.has(`${canvas ? 'canvas-' : ''}${tenant}.${ZONE}`);
    if (!attached) {
      return { response: plain('edge: no route for this hostname (domain not attached)\n', 530) };
    }
    if (!canvas && method === 'POST' && pathname === cellMod.RESTART_PATH) {
      const offered = String(headers.authorization ?? '')
        .replace(/^Bearer\s+/i, '')
        .trim();
      const expected = await cellMod.deriveSecret(secrets.CELL_SECRET_MASTER, tenant);
      if (offered !== expected) return { response: plain('unauthorized\n', 401) };
      return { response: j({ ok: true, ...(await stopCell(tenant)) }) };
    }
    let entry = cells.get(tenant);
    if (!entry) {
      if (String(headers[cellMod.WAKE_HEADER] ?? '') === 'never') {
        return { response: j({ asleep: true }, 503) };
      }
      entry = await startCell(tenant);
      if (!entry) return { response: plain('this hostname is not a Maude project\n', 404) };
    }
    try {
      await entry.ready;
    } catch (err) {
      return { response: plain(`This project could not be started. ${err.message}\n`, 503) };
    }
    return { port: entry.port, tenant, canvas };
  }

  const HOP = new Set([
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'content-length',
  ]);

  /** The Worker's own fetch to a project hostname. */
  async function cellFetch(request) {
    const url = new URL(request.url);
    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
    const routed = await routeCell({
      hostname: url.hostname,
      method: request.method,
      pathname: url.pathname,
      headers,
    });
    if (routed.response) return routed.response;
    const out = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      if (HOP.has(k) || k === cellMod.CANVAS_ORIGIN_HEADER) continue;
      out.set(k, v);
    }
    out.set(cellMod.TENANT_HEADER, routed.tenant);
    out.set('x-forwarded-proto', 'https');
    if (routed.canvas) out.set(cellMod.CANVAS_ORIGIN_HEADER, '1');
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
    return fetch(`http://127.0.0.1:${routed.port}${url.pathname}${url.search}`, {
      method: request.method,
      headers: out,
      body,
      redirect: 'manual',
    });
  }

  // ------------------------------------------- everything the Worker fetches
  async function outbound(request) {
    const url = new URL(request.url);
    const host = url.hostname;
    if (host === 'api.stripe.com') return stripe.api(request);
    if (host === 'api.resend.com' && url.pathname === '/emails') return resendApi(request);
    if (host === 'api.cloudflare.com') return cloudflareApi(request);
    if (tenantOf(host)) return cellFetch(request);
    unrouted.push({ method: request.method, url: request.url });
    return new Response('stand-in: this host is not reachable from the local stack\n', {
      status: 502,
    });
  }

  // ------------------------------------------------------------ the Worker
  const { Miniflare, Response: MfResponse, convertV4MiniflareOptions } = require(
    findPnpmPackage('miniflare')
  );
  const baseBindings = {
    CF_ACCOUNT_ID: 'local-account',
    CF_ZONE_ID: 'local-zone',
    CELL_ZONE: ZONE,
    DASHBOARD_URL: CLOUD,
    MAUDE_R2_BUCKET: 'maude-cloud-assets-local',
    OPERATOR_ACCOUNT_IDS: '',
    ...secrets,
  };
  // Miniflare 5 takes a different option shape; `convertV4MiniflareOptions`
  // is its own bridge from the documented (v4) one, used when it exists.
  const v4 = (o) =>
    typeof convertV4MiniflareOptions === 'function' ? convertV4MiniflareOptions(o) : o;
  const mfOptions = (bindings) =>
    v4({
      host: '127.0.0.1',
      port: 0,
      verbose: false,
      d1Persist: join(root, 'd1'),
      r2Persist: join(root, 'r2'),
      modules: true,
      scriptPath: join(bundleDir, 'worker.js'),
      modulesRoot: bundleDir,
      compatibilityDate: '2026-07-01',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'maude-cloud-e2e' },
      r2Buckets: { EXPORTS: 'maude-cloud-assets-local' },
      bindings,
      outboundService: async (request) => {
        const res = await outbound(request);
        const headers = [];
        for (const [k, v] of res.headers) if (k !== 'set-cookie') headers.push([k, v]);
        for (const c of res.headers.getSetCookie?.() ?? []) headers.push(['set-cookie', c]);
        const body = res.status === 204 || res.status === 304 ? null : await res.arrayBuffer();
        return new MfResponse(body, { status: res.status, headers });
      },
    });
  let bindings = { ...baseBindings };
  mf = new Miniflare(mfOptions(bindings));
  await mf.ready;

  async function cron(cronExpr = '0 * * * *') {
    const worker = await mf.getWorker();
    return worker.scheduled({ cron: cronExpr });
  }
  /** Run SQL against the local D1 (the harness's own view of the database). */
  async function d1(sql, ...binds) {
    const db = await mf.getD1Database('DB');
    const stmt = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
    if (/^\s*(select|pragma)/i.test(sql)) return (await stmt.all()).results ?? [];
    return stmt.run();
  }
  /** Change who may open /operator — a deploy-time var, so the Worker restarts. */
  async function setOperators(ids) {
    bindings = { ...bindings, OPERATOR_ACCOUNT_IDS: ids.join(',') };
    await mf.setOptions(mfOptions(bindings));
    await mf.ready;
  }

  // ---------------------------------------------------------------- the edge
  const certDir = join(root, 'tls');
  mkdirSync(certDir, { recursive: true });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=maude-cloud-e2e',
      '-keyout',
      join(certDir, 'key.pem'),
      '-out',
      join(certDir, 'cert.pem'),
    ],
    { stdio: 'ignore' }
  );
  const tls = {
    key: readFileSync(join(certDir, 'key.pem')),
    cert: readFileSync(join(certDir, 'cert.pem')),
  };
  /** Every request the edge answered: { host, method, path, status } (bounded). */
  const edgeLog = [];

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }
  function toRequest(req, body, origin) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP.has(k)) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    // The address the client really came from — the rate limiter's key.
    headers.set('cf-connecting-ip', req.headers['x-e2e-client-ip'] ?? '127.0.0.1');
    return new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
  }
  async function writeResponse(res, response) {
    const headers = {};
    for (const [k, v] of response.headers) {
      if (
        k === 'set-cookie' ||
        k === 'content-encoding' ||
        k === 'content-length' ||
        k === 'transfer-encoding'
      )
        continue;
      headers[k] = v;
    }
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) headers['set-cookie'] = cookies;
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, headers);
    res.end(body);
  }

  function pipeToCell(req, res, routed) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === cellMod.CANVAS_ORIGIN_HEADER || k === cellMod.TENANT_HEADER)
        continue;
      headers[k] = v;
    }
    headers[cellMod.TENANT_HEADER] = routed.tenant;
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-for'] = '127.0.0.1';
    if (routed.canvas) headers[cellMod.CANVAS_ORIGIN_HEADER] = '1';
    const up = httpRequest(
      { host: '127.0.0.1', port: routed.port, method: req.method, path: req.url, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`edge: cell unreachable — ${e.message}\n`);
    });
    req.pipe(up);
  }

  async function onRequest(req, res) {
    const host = String(req.headers.host ?? '')
      .split(':')[0]
      .toLowerCase();
    const note = (status) => {
      edgeLog.push({
        host,
        method: req.method,
        path: req.url,
        status,
        origin: req.headers.origin ?? null,
        site: req.headers['sec-fetch-site'] ?? null,
      });
      if (edgeLog.length > 4000) edgeLog.shift();
    };
    try {
      if (host === 'cloud.localhost') {
        const body = await readBody(req);
        const request = toRequest(req, body, CLOUD);
        const response = await mf.dispatchFetch(request.url, {
          method: request.method,
          headers: [...request.headers],
          body: body.length ? body : undefined,
          redirect: 'manual',
        });
        note(response.status);
        return await writeResponse(res, response);
      }
      if (host === 'checkout.stripe.com' || host === 'billing.stripe.com') {
        const body = await readBody(req);
        const response = await stripe.hosted(toRequest(req, body, `https://${host}`));
        note(response.status);
        return await writeResponse(res, response);
      }
      if (tenantOf(host)) {
        const routed = await routeCell({
          hostname: host,
          method: req.method,
          pathname: new URL(req.url, 'https://x').pathname,
          headers: req.headers,
        });
        if (routed.response) {
          note(routed.response.status);
          return await writeResponse(res, routed.response);
        }
        note(0);
        return pipeToCell(req, res, routed);
      }
      note(502);
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`edge: ${host} is not part of the local stack\n`);
    } catch (err) {
      note(500);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`edge: ${err.stack ?? err}\n`);
    }
  }

  async function onUpgrade(req, socket, head) {
    const host = String(req.headers.host ?? '')
      .split(':')[0]
      .toLowerCase();
    if (!tenantOf(host)) return socket.destroy();
    const routed = await routeCell({
      hostname: host,
      method: req.method,
      pathname: new URL(req.url, 'https://x').pathname,
      headers: req.headers,
    }).catch(() => null);
    if (!routed || routed.response) {
      socket.write(`HTTP/1.1 ${routed?.response?.status ?? 502} Refused\r\n\r\n`);
      return socket.destroy();
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === cellMod.CANVAS_ORIGIN_HEADER || k === cellMod.TENANT_HEADER)
        continue;
      headers[k] = v;
    }
    headers[cellMod.TENANT_HEADER] = routed.tenant;
    headers['x-forwarded-proto'] = 'https';
    if (routed.canvas) headers[cellMod.CANVAS_ORIGIN_HEADER] = '1';
    const up = httpRequest({
      host: '127.0.0.1',
      port: routed.port,
      method: req.method,
      path: req.url,
      headers,
    });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = Object.entries(upRes.headers).map(([k, v]) => `${k}: ${v}\r\n`);
      socket.write(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n${lines.join('')}\r\n`);
      if (upHead?.length) socket.write(upHead);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      for (const s of [socket, upSocket]) s.on('error', () => s.destroy());
      socket.on('close', () => upSocket.destroy());
      upSocket.on('close', () => socket.destroy());
    });
    up.on('response', (upRes) => {
      socket.write(`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n\r\n`);
      socket.destroy();
    });
    up.on('error', () => socket.destroy());
    if (head?.length) up.write(head);
    up.end();
  }

  const listeners = [];
  for (const addr of ['127.0.0.1', '::1']) {
    const server = createHttpsServer(tls, onRequest);
    server.on('upgrade', onUpgrade);
    await new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(edgePort, addr, ok);
    });
    listeners.push(server);
  }
  // The cells' own way to the control plane (`/internal/*`): plain loopback.
  const cp = createHttpServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const request = toRequest(req, body, CLOUD);
      const response = await mf.dispatchFetch(request.url, {
        method: request.method,
        headers: [...request.headers],
        body: body.length ? body : undefined,
        redirect: 'manual',
      });
      await writeResponse(res, response);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(String(err?.message ?? err));
    }
  });
  await new Promise((ok) => cp.listen(cpPort, '127.0.0.1', ok));
  listeners.push(cp);

  // Workers have no boot hook: the first cron run is what creates the schema.
  await cron();

  async function stop({ keep = false } = {}) {
    for (const tenant of [...cells.keys()]) await stopCell(tenant).catch(() => {});
    for (const s of listeners) {
      s.closeAllConnections?.();
      s.close();
    }
    await mf.dispose().catch(() => {});
    killAll(root);
    await sleep(300);
    if (!keep) rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    edgePort,
    cloudUrl: CLOUD,
    zone: ZONE,
    cellUrl: (id) => `https://${id}.${ZONE}`,
    canvasUrl: (id) => `https://canvas-${id}.${ZONE}`,
    secrets,
    mail,
    stripe,
    cf,
    cells,
    cellStarts,
    cellLogs,
    cellDir: (id) => join(root, 'cells', id),
    unrouted,
    edgeLog,
    cron,
    d1,
    setOperators,
    stopCell,
    stop,
    /** The derived secret a cell presents to the control plane (and vice versa). */
    cellSecret: (tenant) => cellMod.deriveSecret(secrets.CELL_SECRET_MASTER, tenant),
    signWebhook(rawBody, t = Math.floor(Date.now() / 1000)) {
      const v1 = createHmac('sha256', secrets.STRIPE_WEBHOOK_SECRET)
        .update(`${t}.${rawBody}`)
        .digest('hex');
      return `t=${t},v1=${v1}`;
    },
  };
}
