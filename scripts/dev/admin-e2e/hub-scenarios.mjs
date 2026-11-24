#!/usr/bin/env node
// HUB SCENARIOS — the self-hosted team server, end to end, in the shape production runs.
//
//   FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/hub-scenarios.mjs
//   … --only S3[,S5]     run just these          … --keep-dir   keep the scratch dir + logs
//   … --no-browser       HTTP half only (every browser-facing scenario is then SKIPPED, a FAIL)
//
// What it stands up (all scratch, all loopback, all killed by pid on the way out):
//   • the hub's REAL entry point (apps/hub/test/fixtures/serve-team-server.mjs → runAsMain),
//     workspace mode, hybrid OIDC limited to one domain, a seeded first admin, a git checkout
//     with a .design/ project, live pairing, a separate canvas origin, trusted proxy, file
//     backups, the supervised studio child ON, the sign-in rate limits ON;
//   • the identity provider: its token/JWKS side is the hub's `oidcFetch` seam (the issuer is
//     https to the hub), its sign-in PAGE is a local https server the real browser reaches by a
//     host-resolver rule;
//   • desktop peers: the studio server the desktop app runs as its sidecar, over scratch
//     projects linked to the hub.
//
// README.md next to this file says what each scenario asserts and what is out of reach.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStubClaude } from '../../lib/stub-claude.mjs';
import { v2Config } from '../v2-config.mjs';
import {
  Browser,
  bearer,
  freePort,
  ISSUER,
  killEverything,
  killGroup,
  oidcAs,
  person,
  REPO_ROOT,
  rawRequest,
  refreshTarget,
  sleep,
  spawnLogged,
  startProvider,
  tail,
  waitFor,
} from './hub-lib.mjs';

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (n, fb = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb;
};
if (has('help')) {
  process.stdout.write(
    'hub-scenarios — the team server end to end\n\n  --only S1[,S2]   run just these scenarios\n  --no-browser     skip the real browser (browser scenarios then FAIL as not run)\n  --keep-dir       keep the scratch directory (logs, screenshots)\n'
  );
  process.exit(0);
}
const only = (arg('only') ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const useBrowser = !has('no-browser');
const keepDir = has('keep-dir');

const line = (s = '') => process.stdout.write(`${s}\n`);
const RUN = randomBytes(3).toString('hex');
const DOMAIN = 'studyfi.test';
/** The design root's folder name inside a checkout. */
const DESIGN = ['.', 'design'].join('');
const ADMIN = {
  email: `michal@${DOMAIN}`,
  password: `seeded-${RUN}-admin-pass`,
  sub: 'sub-michal',
};
const ADMIN_KEY = `e2e-admin-key-${RUN}-${randomBytes(8).toString('hex')}`;
const who = (name, domain = DOMAIN) => ({ sub: `sub-${name}`, email: `${name}@${domain}` });

/* ------------------------------------------------------------ the fixture */

const root = mkdtempSync(join(tmpdir(), 'maude-hub-e2e-'));
const logDir = join(root, 'logs');
const shotDir = join(root, 'shots');
const FIXTURE = join(REPO_ROOT, 'apps/hub/test/fixtures/serve-team-server.mjs');

/** A `claude` that is not there: a scratch HOME plus the real one raises a keychain dialog. */
function stubBin() {
  return writeStubClaude(join(root, 'stub-bin'));
}
const STUB_BIN = stubBin();
const scratchHome = (name) => {
  const home = join(root, 'homes', name);
  mkdirSync(join(home, '.config'), { recursive: true });
  return home;
};

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

async function seedRepo(repoDir) {
  const d = join(repoDir, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  mkdirSync(join(d, 'system/smoke'), { recursive: true });
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(
    join(d, 'config.json'),
    `${JSON.stringify(
      v2Config({
        name: 'hub-e2e',
        canvasGroups: [
          { label: 'Canvases', path: 'ui' },
          { label: 'Design system', path: 'system' },
        ],
        designSystems: [{ name: 'smoke', path: 'system/smoke' }],
      }),
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(d, 'ui/home.tsx'),
    `export default function Home() {\n  return (\n    <main style={{ padding: 48, fontFamily: 'system-ui' }}>\n      <h1>Hub e2e</h1>\n    </main>\n  );\n}\n`
  );
  writeFileSync(
    join(d, 'ui/home.meta.json'),
    `${JSON.stringify({ title: 'Home', kind: 'web' }, null, 2)}\n`
  );
  writeFileSync(join(d, 'system/smoke/brand.css'), ':root { --bg-0: #0b0b0c; --fg-0: #f5f5f4; }\n');
  writeFileSync(join(d, 'system/smoke/README.md'), '# Smoke design system\n');
  writeFileSync(
    join(d, 'assets/mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6"/></svg>\n'
  );
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, 'config', 'user.email', 'cell@local');
  git(repoDir, 'config', 'user.name', 'Hub E2E');
  const { writeGitignoreBlock } = await import(join(REPO_ROOT, 'cli/lib/gitignore-block.mjs'));
  writeGitignoreBlock(repoDir, { designRel: '.design' });
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'seed: hub e2e project');
}

/**
 * One team server: its own ports, data dir, checkout and log. `extraEnv` is how S9 boots the
 * cloud-cell shape on a second one.
 */
async function makeHub(name, extraEnv = {}) {
  const dir = join(root, name);
  const port = await freePort();
  const studioPort = await freePort();
  const hub = {
    name,
    dir,
    port,
    studioPort,
    dataDir: join(dir, 'data'),
    repoDir: join(dir, 'repo'),
    backupDir: join(dir, 'backups'),
    publicUrl: `http://studio.cell.localhost:${port}`,
    canvasOrigin: `http://canvas.cell.localhost:${port}`,
    loopback: `http://127.0.0.1:${port}`,
    handle: null,
    boots: 0,
    extraEnv,
  };
  mkdirSync(hub.dataDir, { recursive: true });
  mkdirSync(hub.backupDir, { recursive: true });
  mkdirSync(hub.repoDir, { recursive: true });
  await seedRepo(hub.repoDir);
  return hub;
}

function hubEnv(hub) {
  const home = scratchHome(hub.name);
  return {
    PATH: `${STUB_BIN}:${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    PORT: String(hub.port),
    DATA_DIR: hub.dataDir,
    HUB_SECRET: ADMIN_KEY,
    HUB_PUBLIC_URL: hub.publicUrl,
    HUB_INSECURE_HTTP: '1',
    // every request reaches the hub from "the proxy"; the person's address is what it stamps
    // (both loopbacks: a browser reaches `*.localhost` over ::1, this script over 127.0.0.1)
    HUB_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    HUB_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_REPO_DIR: hub.repoDir,
    MAUDE_DESIGN_ROOT: '.design',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    MAUDE_CELL_PAIRING: '1',
    MAUDE_PUBLIC_CANVAS_ORIGIN: hub.canvasOrigin,
    MAUDE_EXTRA_SHELL_ORIGINS: hub.publicUrl,
    MAUDE_STUDIO_PORT: String(hub.studioPort),
    MAUDE_ADMIN_EMAIL: ADMIN.email,
    MAUDE_ADMIN_PASSWORD: ADMIN.password,
    MAUDE_BACKUP_TARGET: `file://${hub.backupDir}`,
    MAUDE_BACKUP_INTERVAL_MS: String(60_000),
    MAUDE_JOURNAL_WALK_MS: '3000',
    HUB_OIDC_MODE: 'hybrid',
    HUB_OIDC_ISSUER: ISSUER,
    HUB_OIDC_CLIENT_ID: 'hub',
    HUB_OIDC_CLIENT_SECRET: `e2e-client-secret-${RUN}`,
    HUB_OIDC_ALLOWED_DOMAINS: DOMAIN,
    HUB_OIDC_LABEL: 'Example ID',
    ...hub.extraEnv,
  };
}

const health = async (hub) => {
  try {
    const r = await rawRequest({
      port: hub.port,
      host: new URL(hub.publicUrl).host,
      path: '/health',
    });
    return r.status === 200 ? r.json() : null;
  } catch {
    return null;
  }
};

async function startHub(hub, { needStudio = true } = {}) {
  hub.boots += 1;
  hub.handle = spawnLogged(`${hub.name}-boot${hub.boots}`, process.execPath, [FIXTURE], {
    env: hubEnv(hub),
    cwd: join(REPO_ROOT, 'apps/hub'),
    logDir,
  });
  const up = await waitFor(() => health(hub), { timeoutMs: 40_000 });
  if (!up.ok) throw new Error(`${hub.name} never answered /health:\n${tail(hub.handle.logPath)}`);
  if (needStudio) {
    const ready = await waitFor(
      async () => {
        const h = await rawRequest({
          port: hub.port,
          host: new URL(hub.publicUrl).host,
          path: '/health',
          headers: { authorization: `Bearer ${ADMIN_KEY}` },
        });
        const j = h.json();
        return j?.studio?.state === 'ready' && j.studio.ok ? j : null;
      },
      { timeoutMs: 120_000, everyMs: 500 }
    );
    if (!ready.ok) {
      throw new Error(
        `${hub.name}: the studio child never became ready:\n${tail(hub.handle.logPath, 3000)}`
      );
    }
    hub.studioReadyMs = ready.ms;
  }
  return up.value;
}

/* ----------------------------------------------------------------- people */

let ipSeq = 10;
const nextIp = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const http1 = (hub) => person({ port: hub.port, publicUrl: hub.publicUrl, ip: nextIp() });
let browserSeq = 0;
const browsers = [];
function newBrowser(label) {
  if (!useBrowser) throw new Error('the real browser is off (--no-browser)');
  const b = new Browser({
    session: `hub-e2e-${RUN}-${label}-${++browserSeq}`,
    providerPort: provider.port,
    ip: nextIp(),
    shotDir,
  });
  browsers.push(b);
  return b;
}

const okJson = (res, what) => {
  if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  return res.json();
};

/** The seeded admin, signed in with the password (a session admin — no admin key). */
async function adminSession(hub) {
  if (hub.admin) {
    const me = (await hub.admin.json('/admin/api/me')).json();
    if (me?.admin) return hub.admin;
  }
  const a = http1(hub);
  await a.get('/studio/signin?return=admin');
  const r = await a.form('/studio/signin', { email: ADMIN.email, password: ADMIN.password });
  if (r.status === 302) {
    hub.admin = a;
    return a;
  }
  // Once the admin has linked their sign-in (S1) the seeded password stops working — by
  // design — and the provider is the way in.
  const o = http1(hub);
  await o.get('/studio/signin?return=admin');
  const viaProvider = await oidcAs(o, await o.get('/auth/oidc/start'), {
    sub: ADMIN.sub,
    email: ADMIN.email,
  });
  if (viaProvider.status !== 302 || (await o.json('/admin/api/me')).json()?.admin !== true) {
    throw new Error(
      `the seeded admin could not sign in: password HTTP ${r.status}, provider HTTP ${viaProvider.status}`
    );
  }
  hub.adminPasswordRetired = true;
  hub.admin = o;
  return o;
}
const people = async (hub) =>
  okJson(await (await adminSession(hub)).json('/admin/api/people'), 'people').people;
const personRow = async (hub, email) => (await people(hub)).find((p) => p.email === email) ?? null;
const events = async (hub, q = 'limit=500') =>
  okJson(await (await adminSession(hub)).json(`/admin/api/activity?${q}`), 'activity').events;
/** Settings are saved whole (name + who can join), as the page's form does. */
const setJoin = async (hub, whoCanJoin) => {
  const a = await adminSession(hub);
  const now = okJson(await a.json('/admin/api/settings'), 'settings');
  if (now.whoCanJoin === whoCanJoin) return now;
  return okJson(
    await a.json('/admin/api/settings', {
      name: now.name,
      description: now.description,
      whoCanJoin,
    }),
    'settings'
  );
};

async function invite(hub, email, role = 'member') {
  const a = await adminSession(hub);
  const j = okJson(
    await a.json('/admin/api/people/invite', { emails: [email], role }),
    `invite ${email}`
  );
  const inv = j.invites[0];
  if (!inv?.ok || !inv.url) throw new Error(`invite ${email}: ${JSON.stringify(inv)}`);
  return { url: inv.url, value: new URL(inv.url).pathname.split('/join/')[1], id: inv.id };
}

/** A member who is simply THERE (invited, joined through the provider) — over HTTP. */
async function ensureMember(hub, name) {
  const id = who(name);
  const row = await personRow(hub, id.email);
  if (row?.kind === 'account') return id;
  const inv = await invite(hub, id.email);
  const p = http1(hub);
  const joined = await oidcAs(p, await p.form('/auth/oidc/start', { invite: inv.value }), id);
  if (joined.status !== 302)
    throw new Error(`${name} could not join: HTTP ${joined.status} ${joined.text.slice(0, 200)}`);
  return id;
}

/** Sign in through the provider over HTTP; the response is the callback's. */
async function oidcSignIn(hub, id, p = http1(hub)) {
  const res = await oidcAs(p, await p.get('/auth/oidc/start'), id);
  return { p, res };
}

/* ---------------------------------------------------------------- report */

const results = [];
let current = null;
function check(label, okay, evidence = '') {
  current.checks.push({ label, ok: !!okay, evidence });
  line(
    `    ${okay ? '✔' : '✖'} ${label}${evidence ? `  — ${String(evidence).slice(0, 260)}` : ''}`
  );
  return !!okay;
}
const scenarios = [];
const scenario = (id, title, fn, { browser = false } = {}) =>
  scenarios.push({ id, title, fn, browser });

async function runScenario(s, ctx) {
  current = { id: s.id, title: s.title, checks: [], error: null, evidence: '' };
  line(`\n  ${s.id}  ${s.title}`);
  const startedAt = Date.now();
  try {
    if (s.browser && !useBrowser)
      throw new Error('not run: needs the real browser (--no-browser was given)');
    current.evidence = (await s.fn(ctx)) ?? '';
  } catch (err) {
    current.error = err?.stack?.split('\n').slice(0, 3).join(' | ') ?? String(err);
    line(`    ✖ threw: ${current.error}`);
  }
  current.ms = Date.now() - startedAt;
  current.pass = !current.error && current.checks.length > 0 && current.checks.every((c) => c.ok);
  line(
    `  ${current.pass ? 'PASS' : 'FAIL'}  ${s.id}  (${(current.ms / 1000).toFixed(1)}s)${current.evidence ? `  ${current.evidence}` : ''}`
  );
  results.push(current);
}

/* ============================================================== SCENARIOS */

let provider;

// ---------------------------------------------------------------- S1
scenario(
  'S1',
  'first boot: the seeded admin signs in with a password, links their sign-in, comes back through the provider',
  async ({ hub }) => {
    const b = newBrowser('admin');
    await b.open(`${hub.publicUrl}/admin`);
    const landing = await b.until(
      `(() => { const a = document.querySelector('[data-testid="admin-signin"]'); return !!a && a.offsetParent !== null; })()`
    );
    check('/admin shows Sign in to a stranger', landing.ok, await b.url());
    await b.click('[data-testid="admin-signin"]');
    await b.until(`!!document.querySelector('#password')`);
    await b.fill('#email', ADMIN.email);
    await b.fill('#password', ADMIN.password);
    await b.click('button[type="submit"]');
    const overview = await b.until(
      `(() => { const v = document.querySelector('[data-testid="view-overview"]'); return !!v && v.offsetParent !== null; })()`
    );
    await b.shot('S1-overview');
    const me1 = await b.eval(
      `fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`
    );
    const m1 = JSON.parse(me1 ?? '{}');
    check(
      'signed in with the seeded password and sees Overview',
      overview.ok,
      `url ${await b.url()}`
    );
    const keyInBrowser = await b.eval(
      `JSON.stringify(Object.keys(localStorage).concat(Object.keys(sessionStorage)))`
    );
    check(
      'a session admin — no admin key in play',
      m1.admin === true && m1.kind !== 'key' && !String(keyInBrowser).includes(ADMIN_KEY),
      `me.admin=${m1.admin} kind=${m1.kind ?? '-'} storage=${keyInBrowser}`
    );
    check(
      'the account has no provider sign-in yet',
      m1.canLink === true,
      `canLink=${m1.canLink} provider=${m1.provider}`
    );

    // Link my sign-in — the card is on Settings.
    await b.click('[data-testid="nav-settings"]');
    const btn = await b.until(
      `(() => [...document.querySelectorAll('[data-testid="link-signin"]')].some(e => e.offsetParent !== null))()`
    );
    check('Settings offers "Link my sign-in"', btn.ok);
    await b.eval(
      `[...document.querySelectorAll('[data-testid="link-signin"]')].find(e => e.offsetParent !== null).click()`
    );
    await b.signInAtProvider({ sub: ADMIN.sub, email: ADMIN.email });
    const back = await b.until(`location.pathname.replace(/\\/$/, '') === '/admin'`);
    const m2 = JSON.parse(
      (await b.eval(`fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`)) ??
        '{}'
    );
    check(
      'linked: back on /admin, nothing left to link',
      back.ok && m2.admin === true && m2.canLink === false,
      `canLink=${m2.canLink} url=${await b.url()}`
    );

    // Sign out, then in again through the provider alone.
    await b.eval(`document.querySelector('[data-testid="nav-overview"]')?.click()`);
    await b.eval(
      `[...document.querySelectorAll('[data-testid="admin-signout"]')].find(e => e.offsetParent !== null)?.click()`
    );
    const out = await waitFor(
      async () => {
        const j = JSON.parse(
          (await b.eval(
            `fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`
          )) ?? '{}'
        );
        return j.signedIn === false;
      },
      { timeoutMs: 15_000 }
    );
    check('signed out', out.ok);
    await b.open(`${hub.publicUrl}/studio/signin?return=admin`);
    await b.click('a.button[href="/auth/oidc/start"]');
    await b.signInAtProvider({ sub: ADMIN.sub, email: ADMIN.email });
    const again = await b.until(
      `(() => { const v = document.querySelector('[data-testid="view-overview"]'); return !!v && v.offsetParent !== null; })()`
    );
    const m3 = JSON.parse(
      (await b.eval(`fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`)) ??
        '{}'
    );
    await b.shot('S1-back-through-provider');
    check(
      'signed back in through the provider as the same admin',
      again.ok && m3.admin === true && m3.email === ADMIN.email,
      `me=${m3.email} admin=${m3.admin} url=${await b.url()}`
    );
    const stale = http1(hub);
    const pwAfter = await stale.form('/studio/signin', {
      email: ADMIN.email,
      password: ADMIN.password,
    });
    check(
      'after linking, the seeded password no longer signs in',
      pwAfter.status === 401 && !stale.jar.has('maude_studio'),
      `HTTP ${pwAfter.status}`
    );
    const ev = await events(hub);
    check(
      'Activity has the password sign-in, the link and the provider sign-in',
      ['signin-browser', 'oidc-self-link', 'oidc-signin'].every((k) =>
        ev.some((e) => e.kind === k && e.actor === ADMIN.email)
      ),
      ev
        .filter((e) => e.actor === ADMIN.email)
        .map((e) => e.kind)
        .join(',')
    );
    await b.close();
    return `admin ${ADMIN.email}: password → linked → provider`;
  },
  { browser: true }
);

// ---------------------------------------------------------------- S2
scenario(
  'S2',
  'invite by email → the invitee opens /join in a clean browser → provider → in, no approval',
  async ({ hub }) => {
    await setJoin(hub, 'ask');
    const marek = who(`marek-${RUN}`);
    const inv = await invite(hub, marek.email);
    check(
      'the admin gets a one-time /join link',
      inv.url.startsWith(`${hub.publicUrl}/join/inv_`),
      inv.url.replace(inv.value, 'inv_…')
    );
    const b = newBrowser('invitee');
    await b.open(inv.url);
    const btn = await b.until(`!!document.querySelector('[data-testid="join-provider"]')`);
    check(
      'the invitation page offers the provider button',
      btn.ok,
      (await b.text())?.slice(0, 120).replace(/\s+/g, ' ')
    );
    await b.click('[data-testid="join-provider"]');
    await b.signInAtProvider(marek);
    const landed = await b.until(
      `location.host === ${JSON.stringify(new URL(hub.publicUrl).host)} && !location.pathname.startsWith('/auth/') && !location.pathname.startsWith('/join')`
    );
    const me = JSON.parse(
      (await b.eval(`fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`)) ??
        '{}'
    );
    await b.shot('S2-landed');
    check(
      'lands signed in',
      landed.ok && me.signedIn !== false && me.email === marek.email,
      `url=${await b.url()} me=${me.email} role=${me.roleLabel}`
    );
    const list = await people(hub);
    const row = list.find((p) => p.email === marek.email);
    check(
      'no pending row, no approval',
      !list.some((p) => p.kind === 'request' && p.email === marek.email),
      `rows for marek: ${list
        .filter((p) => p.email === marek.email)
        .map((p) => p.kind)
        .join(',')}`
    );
    check(
      'in People as a member',
      row?.kind === 'account' && row.role === 'member' && row.linked === true,
      `kind=${row?.kind} role=${row?.role} status=${row?.statusLabel}`
    );
    const ev = await events(hub);
    const created = ev.find((e) => e.kind === 'invite-create' && e.target === marek.email);
    const joined = ev.find((e) => e.kind === 'invite-redeem' && e.actor === marek.email);
    check(
      'the kept log has invite-create and the join',
      !!created && !!joined,
      `invite-create by ${created?.actor}; invite-redeem by ${joined?.actor} (${joined?.detail})`
    );
    check('the invite value is nowhere in the log', !JSON.stringify(ev).includes(inv.value));
    await b.close();
    return `${marek.email} joined by invitation, role ${row?.roleLabel}`;
  },
  { browser: true }
);

// ---------------------------------------------------------------- S3
scenario(
  'S3',
  'an invitation for a@ opened while signed in at the provider as b@ → refusal naming a@, invite not burned',
  async ({ hub }) => {
    await setJoin(hub, 'ask');
    const anna = who(`anna-${RUN}`);
    const boris = who(`boris-${RUN}`);
    const inv = await invite(hub, anna.email);
    const b = newBrowser('mismatch');
    await b.open(inv.url);
    await b.until(`!!document.querySelector('[data-testid="join-provider"]')`);
    await b.click('[data-testid="join-provider"]');
    await b.signInAtProvider(boris);
    const refused = await b.until(`!!document.querySelector('[data-testid="join-mismatch"]')`);
    const text = (await b.text()) ?? '';
    await b.shot('S3-refusal');
    check(
      'a refusal page, naming the invited address',
      refused.ok && text.includes(anna.email),
      text.slice(0, 200).replace(/\s+/g, ' ')
    );
    const cookiesB = await b.cookieNames();
    check(
      'the wrong identity is not signed in and got no account',
      !cookiesB.includes('maude_studio') && !(await personRow(hub, boris.email)),
      `cookies=[${cookiesB.join(',')}] boris row=${JSON.stringify(await personRow(hub, boris.email))}`
    );
    const stillOpen = await personRow(hub, anna.email);
    check(
      'the invitation is still open',
      stillOpen?.kind === 'invite',
      `kind=${stillOpen?.kind} status=${stillOpen?.statusLabel}`
    );
    // the page carries the invite on: use another account
    await b.click('[data-testid="join-mismatch"] button[type="submit"]');
    await b.signInAtProvider(anna);
    const landed = await b.until(
      `location.host === ${JSON.stringify(new URL(hub.publicUrl).host)} && !location.pathname.startsWith('/auth/')`
    );
    const meA = JSON.parse(
      (await b.eval(`fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`)) ??
        '{}'
    );
    const row = await personRow(hub, anna.email);
    check(
      'the right identity then gets in on the same link',
      landed.ok && meA.email === anna.email && row?.kind === 'account',
      `me=${meA.email} kind=${row?.kind}`
    );
    check(
      'the provider was asked to show its account chooser',
      provider.seen.some((s) => s.prompt === 'select_account'),
      `prompts seen: ${[...new Set(provider.seen.map((s) => s.prompt))].join(',')}`
    );
    const ev = await events(hub);
    check(
      'the refusal is in the log',
      ev.some(
        (e) =>
          e.kind === 'oidc-refused' && e.actor === boris.email && e.detail?.includes(anna.email)
      ),
      ev.find((e) => e.kind === 'oidc-refused' && e.actor === boris.email)?.detail
    );
    await b.close();
    return `${boris.email} refused for ${anna.email}'s invite; ${anna.email} then joined`;
  },
  { browser: true }
);

// ---------------------------------------------------------------- S4
scenario(
  'S4',
  'an uninvited person from the allowed domain under each Who-can-join mode; an outsider never',
  async ({ hub }) => {
    const a = await adminSession(hub);
    // ---- ask
    await setJoin(hub, 'ask');
    const cyril = who(`cyril-${RUN}`);
    const first = await oidcSignIn(hub, cyril);
    check(
      'ask: turned to the waiting page, not signed in',
      first.res.status === 403 &&
        /Waiting for access/.test(first.res.text) &&
        !first.p.jar.has('maude_studio'),
      `HTTP ${first.res.status}`
    );
    const asking = (await people(hub)).find((p) => p.kind === 'request' && p.email === cyril.email);
    check(
      'ask: the admin sees them under Asks to join',
      !!asking,
      JSON.stringify(asking ?? null).slice(0, 160)
    );
    const letIn = await a.json('/admin/api/people/let-in', { sub: cyril.sub, role: 'member' });
    check('ask: the admin lets them in', letIn.status === 201, `HTTP ${letIn.status}`);
    const second = await oidcSignIn(hub, cyril);
    check(
      'ask: the next sign-in works',
      second.res.status === 302 && second.p.jar.has('maude_studio'),
      `HTTP ${second.res.status} → ${second.res.headers.location}`
    );

    // ---- invite-only
    await setJoin(hub, 'invite-only');
    const dana = who(`dana-${RUN}`);
    const turned = await oidcSignIn(hub, dana);
    const danaRows = (await people(hub)).filter((p) => p.email === dana.email);
    check(
      'invite-only: turned away, no row of any kind',
      turned.res.status === 403 && !turned.p.jar.has('maude_studio') && danaRows.length === 0,
      `HTTP ${turned.res.status}, rows=${danaRows.length}, page="${(/<h1>([^<]*)/.exec(turned.res.text) ?? [])[1]}"`
    );

    // ---- domain
    await setJoin(hub, 'domain');
    const emil = who(`emil-${RUN}`);
    const walked = await oidcSignIn(hub, emil);
    const emilRow = await personRow(hub, emil.email);
    check(
      'domain: walks in as a member',
      walked.res.status === 302 &&
        walked.p.jar.has('maude_studio') &&
        emilRow?.kind === 'account' &&
        emilRow.role === 'member',
      `HTTP ${walked.res.status}, kind=${emilRow?.kind} role=${emilRow?.role}`
    );

    // ---- an address outside the allowed domain, in every mode
    const outcomes = [];
    for (const mode of ['ask', 'invite-only', 'domain']) {
      await setJoin(hub, mode);
      const eve = who(`eve-${mode}-${RUN}`, 'elsewhere.test');
      const r = await oidcSignIn(hub, eve);
      const rows = (await people(hub)).filter((p) => p.email === eve.email);
      outcomes.push({
        mode,
        status: r.res.status,
        session: r.p.jar.has('maude_studio'),
        rows: rows.length,
      });
    }
    check(
      'an address outside the allowed domain is never admitted and never queued',
      outcomes.every((o) => o.status === 403 && !o.session && o.rows === 0),
      JSON.stringify(outcomes)
    );
    await setJoin(hub, 'ask');
    return `ask→pending→let in; invite-only→no row; domain→member; outsider→${outcomes.map((o) => o.status).join('/')}`;
  }
);

// ---------------------------------------------------------------- S7
scenario(
  'S7',
  'admin management: role, turn off/on, remove, sign out, the last-admin guard',
  async ({ hub }) => {
    const a = await adminSession(hub);
    await setJoin(hub, 'ask');
    const hana = await ensureMember(hub, `hana-${RUN}`);
    const row0 = await personRow(hub, hana.email);
    const { p: hp, res: in0 } = await oidcSignIn(hub, hana);
    check(
      'the member is signed in',
      in0.status === 302 && (await hp.json('/admin/api/me')).json()?.admin === false
    );
    check('a member reads no admin data', (await hp.json('/admin/api/people')).status === 403);

    // a live sync connection of theirs (a desktop session), to watch it end
    const desk = await desktopSignIn(hub, hana, { viaHttp: true });
    const ws = await openSync(hub, desk.token);
    check('their desktop sync connection is open', ws.opened, ws.detail);

    // ---- member → admin
    const up = await a.json('/admin/api/people/role', { id: row0.id, role: 'admin' });
    check(
      'promoted to Admin',
      up.status === 200 && up.json()?.user?.role === 'admin',
      `HTTP ${up.status} ended ${up.json()?.revoked} sessions`
    );
    check(
      'their old browser session ended at once',
      (await hp.json('/admin/api/me')).json()?.signedIn === false
    );
    const closed1 = await waitFor(() => ws.closed(), { timeoutMs: 10_000, everyMs: 100 });
    check('their sync connection was dropped within seconds', closed1.ok, `${closed1.ms} ms`);
    const asAdmin = await oidcSignIn(hub, hana);
    check(
      'signs in again with admin rights',
      asAdmin.res.status === 302 && (await asAdmin.p.json('/admin/api/people')).status === 200
    );
    // ---- admin → member
    const down = await a.json('/admin/api/people/role', { id: row0.id, role: 'member' });
    check(
      'demoted to Can edit',
      down.status === 200 && down.json()?.user?.role === 'member',
      `HTTP ${down.status}`
    );
    check(
      'the admin session they held is gone',
      (await asAdmin.p.json('/admin/api/people')).status !== 200,
      `HTTP ${(await asAdmin.p.json('/admin/api/people')).status}`
    );
    const asMember = await oidcSignIn(hub, hana);
    check(
      'signs in again as a member',
      asMember.res.status === 302 && (await asMember.p.json('/admin/api/people')).status === 403
    );

    // ---- turn off: browser session and sync connection refused within seconds
    const desk2 = await desktopSignIn(hub, hana, { viaHttp: true });
    const ws2 = await openSync(hub, desk2.token);
    check('a fresh desktop connection is open before Turn off', ws2.opened, ws2.detail);
    const t0 = Date.now();
    const off = await a.json('/admin/api/people/turn-off', { id: row0.id });
    check(
      'Turn off',
      off.status === 200,
      `HTTP ${off.status} revoked=${off.json()?.revoked} kicked=${off.json()?.kicked}`
    );
    const closed2 = await waitFor(() => ws2.closed(), { timeoutMs: 10_000, everyMs: 100 });
    check(
      'turned off: the sync connection is closed within seconds',
      closed2.ok,
      `${Date.now() - t0} ms after the click`
    );
    const re = await openSync(hub, desk2.token);
    check('turned off: reconnecting with the same credential is refused', !re.opened, re.detail);
    check(
      'turned off: the browser session is refused',
      (await asMember.p.json('/admin/api/me')).json()?.signedIn === false
    );
    const apiOff = await bearer({
      port: hub.port,
      publicUrl: hub.publicUrl,
      ip: nextIp(),
      token: desk2.token,
    })('/auth/session');
    check(
      'turned off: the desktop credential is refused over HTTP',
      apiOff.status === 401,
      `HTTP ${apiOff.status}`
    );
    const offIn = await oidcSignIn(hub, hana);
    check(
      'turned off: signing in again is refused',
      offIn.res.status === 403 && !offIn.p.jar.has('maude_studio'),
      `HTTP ${offIn.res.status}`
    );
    const offDesk = await desktopSignIn(hub, hana, { viaHttp: true, expectFail: true });
    check('turned off: a desktop sign-in is refused too', !offDesk.token, offDesk.detail);

    // ---- turn back on
    const on = await a.json('/admin/api/people/turn-on', { id: row0.id });
    const onIn = await oidcSignIn(hub, hana);
    check(
      'Turn back on → signs in again',
      on.status === 200 && onIn.res.status === 302,
      `HTTP ${on.status}/${onIn.res.status}`
    );

    // ---- sign out a person's sessions
    const so = await a.json('/admin/api/people/signout', { id: row0.id });
    check(
      'Sign out everywhere ends their sessions',
      so.status === 200 &&
        so.json()?.revoked >= 1 &&
        (await onIn.p.json('/admin/api/me')).json()?.signedIn === false,
      `revoked=${so.json()?.revoked}`
    );

    // ---- remove, under `domain`: the removed person does not walk back in
    await setJoin(hub, 'domain');
    const again = await oidcSignIn(hub, hana);
    check('(before Remove) still a member, signs in', again.res.status === 302);
    const rm = await a.json('/admin/api/people/remove', { id: row0.id });
    check('Remove', rm.status === 200, `HTTP ${rm.status}`);
    check(
      'removed: their session is gone',
      (await again.p.json('/admin/api/me')).json()?.signedIn === false
    );
    const back = await oidcSignIn(hub, hana);
    const rows = (await people(hub)).filter((p) => p.email === hana.email);
    check(
      'removed under `domain`: does NOT walk back in — lands in Asks to join',
      back.res.status === 403 &&
        !back.p.jar.has('maude_studio') &&
        rows.length === 1 &&
        rows[0].kind === 'request',
      `HTTP ${back.res.status}, rows=${rows.map((r) => r.kind).join(',') || 'none'}`
    );
    // a fresh colleague still walks in under the same mode (the rule is about the removed one)
    const fresh = await oidcSignIn(hub, who(`ivo-${RUN}`));
    check('…while a new colleague from the domain still walks in', fresh.res.status === 302);
    await setJoin(hub, 'ask');

    // ---- the last-admin guard
    const adminRow = await personRow(hub, ADMIN.email);
    const admins = (await people(hub)).filter(
      (p) => p.kind === 'account' && p.role === 'admin' && !p.disabled
    );
    const guard = [];
    for (const [path, body] of [
      ['/admin/api/people/role', { id: adminRow.id, role: 'member' }],
      ['/admin/api/people/turn-off', { id: adminRow.id }],
      ['/admin/api/people/remove', { id: adminRow.id }],
    ]) {
      const r = await a.json(path, body);
      guard.push({ path: path.split('/').pop(), status: r.status, error: r.json()?.error });
    }
    check(
      'the only admin cannot demote, turn off or remove themselves',
      admins.length === 1 && guard.every((g) => g.status === 409),
      JSON.stringify(guard).slice(0, 300)
    );
    // …and nobody else can either: the admin key is not "yourself", so this is the last-admin rule
    const key = bearer({
      port: hub.port,
      publicUrl: hub.publicUrl,
      ip: nextIp(),
      token: ADMIN_KEY,
    });
    const last = [];
    for (const [path, body] of [
      ['/admin/api/people/role', { id: adminRow.id, role: 'member' }],
      ['/admin/api/people/turn-off', { id: adminRow.id }],
      ['/admin/api/people/remove', { id: adminRow.id }],
    ]) {
      const r = await key(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      last.push({ path: path.split('/').pop(), status: r.status, error: r.json()?.error });
    }
    check(
      'the last-admin guard refuses the same three through the admin key',
      last.every((g) => g.status === 409) && last.every((g) => !/yourself/.test(g.error ?? '')),
      JSON.stringify(last).slice(0, 320)
    );
    check('…and is still an admin', (await a.json('/admin/api/me')).json()?.admin === true);
    const ev = await events(hub);
    const kinds = ['role-change', 'user-disable', 'user-enable', 'user-signout', 'user-delete'];
    check(
      'every change is in the log',
      kinds.every((k) => ev.some((e) => e.kind === k && e.target === hana.email)),
      kinds
        .map((k) => `${k}:${ev.filter((e) => e.kind === k && e.target === hana.email).length}`)
        .join(' ')
    );
    return `role ↑↓, off (${closed2.ms} ms to drop sync), on, sign-out, remove→request, guard 409×3`;
  }
);

/* -------------------------------------------------- the desktop's sign-in */

/**
 * What the desktop app does (apps/studio/sync/hub-browser-signin.ts): probe /health for
 * `desktop-signin-v1`, keep a PKCE verifier and a state in memory, open the hub's own page
 * with `?client=desktop…&redirect_uri=http://127.0.0.1:<port>/_api/hub-signin/return`, wait
 * for the browser's hop back, trade the code + verifier at /auth/desktop/exchange.
 * `viaHttp` walks the person's part without a rendered browser; otherwise `browser` does it.
 */
async function desktopSignIn(
  hub,
  id,
  { viaHttp = false, browser = null, invite: inviteValue = null, expectFail = false } = {}
) {
  const h = await health(hub);
  if (!h?.capabilities?.includes('desktop-signin-v1'))
    return {
      token: null,
      detail: `no desktop-signin-v1 in /health capabilities: ${JSON.stringify(h?.capabilities)}`,
    };
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  // the app's loopback return route
  let resolveReturn;
  const returned = new Promise((r) => {
    resolveReturn = r;
  });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (u.pathname !== '/_api/hub-signin/return') {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<!doctype html><title>Signed in — Maude</title><h1 data-testid="desktop-return">You can close this tab.</h1>'
    );
    resolveReturn(u.searchParams);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}/_api/hub-signin/return`;
  const q = new URLSearchParams({
    client: 'desktop',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
  });
  const pagePath = `${inviteValue ? `/join/${inviteValue}` : '/studio/signin'}?${q}`;
  try {
    let params;
    if (viaHttp) {
      const p = http1(hub);
      const page = await p.get(pagePath);
      if (page.status !== 200)
        return { token: null, detail: `the hub's page answered HTTP ${page.status}` };
      const start = inviteValue
        ? await p.form('/auth/oidc/start', { invite: inviteValue })
        : await p.get('/auth/oidc/start');
      const cb = await oidcAs(p, start, id);
      const dest = refreshTarget(cb.text);
      if (!dest)
        return {
          token: null,
          detail: `no hand-off page after sign-in: HTTP ${cb.status} ${(/<h1>([^<]*)/.exec(cb.text) ?? [])[1] ?? ''}`,
        };
      if (!dest.startsWith(redirectUri))
        return { token: null, detail: `the hand-off went somewhere else: ${dest.slice(0, 80)}` };
      params = new URL(dest).searchParams;
      if (p.jar.has('maude_studio'))
        return {
          token: null,
          detail: 'the desktop hand-off also minted a browser session (it must not)',
        };
    } else {
      await browser.open(`${hub.publicUrl}${pagePath}`);
      if (inviteValue) {
        await browser.until(`!!document.querySelector('[data-testid="join-provider"]')`);
        await browser.click('[data-testid="join-provider"]');
      } else {
        await browser.click('a.button[href="/auth/oidc/start"]');
      }
      await browser.signInAtProvider(id);
      params = await Promise.race([returned, sleep(25_000).then(() => null)]);
      if (!params)
        return {
          token: null,
          detail: `the browser never came back to the app (at ${await browser.url()})`,
        };
    }
    if (params.get('state') !== state)
      return { token: null, detail: `state mismatch on the return` };
    if (params.get('error'))
      return { token: null, detail: `the hub handed back error=${params.get('error')}` };
    const code = params.get('code');
    const ex = await rawRequest({
      port: hub.port,
      host: new URL(hub.publicUrl).host,
      method: 'POST',
      path: '/auth/desktop/exchange',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': nextIp(),
        'x-maude-access': '2',
      },
      body: JSON.stringify({ code, code_verifier: verifier }),
    });
    const j = ex.json();
    if (ex.status !== 200 || !j?.token)
      return { token: null, detail: `exchange HTTP ${ex.status} ${ex.text.slice(0, 160)}` };
    if (!expectFail) {
      // single use: the same code again is refused
      const replay = await rawRequest({
        port: hub.port,
        host: new URL(hub.publicUrl).host,
        method: 'POST',
        path: '/auth/desktop/exchange',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({ code, code_verifier: verifier }),
      });
      j.replayStatus = replay.status;
    }
    return {
      token: j.token,
      user: j.user,
      label: j.label,
      scope: j.scope,
      expiresAt: j.expiresAt,
      replayStatus: j.replayStatus,
      code,
      detail: `exchange 200 as ${j.user?.email} (${j.user?.role})`,
    };
  } finally {
    server.close();
  }
}

/* ------------------------------------------------------- sync connections */

const hubRequire = createRequire(join(REPO_ROOT, 'apps/hub/package.json'));
const sockets = [];

/**
 * One sync connection with a credential — the same client library the studio uses
 * (@hocuspocus/provider), on the file plane's control document. `opened` is "the hub
 * authenticated and synced it"; `closed()` turns true when the hub ends it.
 */
async function openSync(hub, token, { doc = 'maude.files', waitMs = 8_000 } = {}) {
  const { HocuspocusProvider } = hubRequire('@hocuspocus/provider');
  const Y = hubRequire('yjs');
  const ydoc = new Y.Doc();
  const state = { synced: false, authFailed: null, closed: false };
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${hub.port}`,
    name: doc,
    token,
    document: ydoc,
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.authFailed = reason ?? 'refused';
    },
    onClose: () => {
      if (state.synced) state.closed = true;
    },
  });
  sockets.push(provider);
  await waitFor(() => state.synced || state.authFailed, { timeoutMs: waitMs, everyMs: 50 });
  return {
    opened: state.synced && !state.authFailed,
    detail: state.authFailed
      ? `refused: ${state.authFailed}`
      : state.synced
        ? 'authenticated + synced'
        : 'no answer',
    // after a kick the provider reconnects by itself; "closed" = the hub ended the open one
    closed: () => state.closed || !!state.authFailed,
    destroy: () => {
      try {
        provider.destroy();
      } catch {
        /* gone */
      }
    },
  };
}

/* ------------------------------------------------------ the desktop peers */

/**
 * A second machine: a scratch project LINKED to the hub with one person's credential, served
 * by the studio server the desktop app runs as its sidecar.
 *
 * The link verb of the CLI is what writes this link for a person at a terminal. It refuses to
 * run inside an AI session by design ("linking to a hub is your decision"), so this writes
 * the two things that verb writes — `linkedHub` in the project config and the credential in
 * a scratch hubs.json — the way scripts/dev/local-cell.mjs does. With `--cli-link` (a
 * person's terminal) the real verb is run instead.
 */
async function makePeer(hub, name, cred) {
  const dir = join(root, 'peers', name);
  const design = join(dir, DESIGN);
  const home = scratchHome(`peer-${name}`);
  const hubsConfig = join(home, '.config', 'maude', 'hubs.json');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(home, '.config', 'maude'), { recursive: true });
  const base = {
    name: `peer-${name}`,
    canvasGroups: [
      { label: 'Canvases', path: 'ui' },
      { label: 'Design system', path: 'system' },
    ],
  };
  const env = {
    PATH: `${STUB_BIN}:${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    HUBS_CONFIG_PATH: hubsConfig,
    MAUDE_APP_BOUND_HUB: hub.loopback,
    MAUDE_PROJECT_ROOT: dir,
    MAUDE_INDEX_DIR: join(root, 'index', name),
  };
  let linkedBy = 'config + hubs.json, as the link verb writes them';
  if (has('cli-link')) {
    writeFileSync(join(design, 'config.json'), `${JSON.stringify(v2Config(base), null, 2)}\n`);
    execFileSync(
      process.execPath,
      [
        join(REPO_ROOT, 'cli/bin/maude.mjs'),
        'design',
        'link',
        hub.loopback,
        '--token',
        cred.token,
        '--yes',
      ],
      { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    linkedBy = 'the CLI verb';
  } else {
    writeFileSync(
      join(design, 'config.json'),
      `${JSON.stringify(
        v2Config({
          ...base,
          linkedHub: { url: hub.loopback, linkedAt: Date.now(), syncFiles: true },
        }),
        null,
        2
      )}\n`
    );
    writeFileSync(
      hubsConfig,
      `${JSON.stringify(
        {
          hubs: {
            [hub.loopback]: {
              token: cred.token,
              linkedAt: Date.now(),
              role: cred.user?.role === 'admin' ? 'owner' : 'member',
              ...(cred.expiresAt ? { expiresAt: cred.expiresAt } : {}),
            },
          },
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
  }
  const port = await freePort();
  const handle = spawnLogged(
    `peer-${name}`,
    'bun',
    [join(REPO_ROOT, 'apps/studio/server.ts'), '--root', dir, '--port', String(port)],
    { cwd: join(REPO_ROOT, 'apps/studio'), env, logDir }
  );
  const up = await waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${port}/_health`, { signal: AbortSignal.timeout(2_000) }))
        .status < 500,
    { timeoutMs: 90_000 }
  );
  if (!up.ok) throw new Error(`peer ${name} never came up:\n${tail(handle.logPath)}`);
  const abs = (rel) => join(design, rel);
  return {
    name,
    dir,
    design,
    port,
    handle,
    linkedBy,
    has: (rel) => existsSync(abs(rel)),
    text: (rel) => {
      try {
        return readFileSync(abs(rel), 'utf8');
      } catch {
        return '';
      }
    },
    write: (rel, body) => {
      mkdirSync(join(abs(rel), '..'), { recursive: true });
      writeFileSync(abs(rel), body);
    },
  };
}

// ---------------------------------------------------------------- S5
scenario(
  'S5',
  'desktop: sign in by browser hand-off, the credential opens the project and syncs; two people, both directions; a refused write',
  async ({ hub }) => {
    await setJoin(hub, 'ask');
    const hubDesign = join(hub.repoDir, DESIGN);
    const hubHas = (rel) => existsSync(join(hubDesign, rel));
    const hubText = (rel) => {
      try {
        return readFileSync(join(hubDesign, rel), 'utf8');
      } catch {
        return '';
      }
    };

    // ---- person A: invited, accepts the invitation FROM THE DESKTOP APP, in a real browser
    const fiona = who(`fiona-${RUN}`);
    const inv = await invite(hub, fiona.email);
    const b = newBrowser('desktop');
    const credA = await desktopSignIn(hub, fiona, { browser: b, invite: inv.value });
    const after = (await b.text()) ?? '';
    await b.shot('S5-desktop-return');
    check(
      'the browser flow ends on the app’s loopback return and the code is exchanged',
      !!credA.token,
      credA.detail
    );
    if (!credA.token) return 'no credential';
    check(
      'the browser tab is left on the app’s own page',
      /close this tab/i.test(after),
      `${String(await b.url()).replace(/code=[^&]+/, 'code=…')}`
    );
    check(
      'the code is single use',
      credA.replayStatus === 400,
      `replay → HTTP ${credA.replayStatus}`
    );
    const rowA = await personRow(hub, fiona.email);
    check(
      'the invitee is a member, no approval',
      rowA?.kind === 'account' && rowA.role === 'member',
      `kind=${rowA?.kind} role=${rowA?.role}`
    );
    await b.close();

    // (a) the credential lists and opens the project
    const asA = bearer({
      port: hub.port,
      publicUrl: hub.publicUrl,
      ip: nextIp(),
      token: credA.token,
    });
    const session = await asA('/auth/session');
    check(
      'the credential is a session of that person',
      session.status === 200 && session.json()?.user?.email === fiona.email,
      `HTTP ${session.status} ${session.text.slice(0, 120)}`
    );
    const manifest = await asA('/api/files');
    const mj = manifest.json() ?? {};
    const list = mj.files ?? mj.entries ?? mj.manifest ?? [];
    const paths = Array.isArray(list)
      ? list.map((f) => f.path ?? f.rel ?? f.name ?? JSON.stringify(f))
      : Object.keys(list);
    check(
      'it lists the project',
      manifest.status === 200 && paths.some((p) => String(p).includes('brand.css')),
      `HTTP ${manifest.status}, ${paths.length} files: ${paths.slice(0, 6).join(', ')} ${paths.length ? '' : manifest.text.slice(0, 160)}`
    );
    const one = await asA('/_project-file/system/smoke/brand.css');
    check(
      'it opens a file of the project',
      one.status === 200 && one.text.includes('--bg-0'),
      `HTTP ${one.status} ${one.buffer.length} bytes`
    );
    // (b) it syncs
    const wsA = await openSync(hub, credA.token);
    check('it syncs (the hub authenticates the connection)', wsA.opened, wsA.detail);
    wsA.destroy();
    const wrong = await openSync(hub, `${credA.token}x`, { waitMs: 6_000 });
    check('a wrong credential does not sync', !wrong.opened, wrong.detail);
    wrong.destroy();

    // ---- person B: already a member, signs in from their own desktop
    const gustav = await ensureMember(hub, `gustav-${RUN}`);
    const credB = await desktopSignIn(hub, gustav, { viaHttp: true });
    check(
      'a second person signs in from their own desktop',
      !!credB.token && credB.user?.email === gustav.email,
      credB.detail
    );
    if (!credB.token) return 'no second credential';

    // ---- two linked checkouts = two machines, two people
    const A = await makePeer(hub, 'a', credA);
    const pulled = await waitFor(
      () => A.has('ui/home.tsx') && A.has('system/smoke/brand.css') && A.has('assets/mark.svg'),
      { timeoutMs: 90_000 }
    );
    check(
      'a new project comes down into an empty linked folder',
      pulled.ok,
      `${pulled.ms} ms; ui/home.tsx=${A.has('ui/home.tsx')} brand.css=${A.has('system/smoke/brand.css')} mark.svg=${A.has('assets/mark.svg')} (${A.linkedBy})`
    );
    check(
      '…byte-identical to the hub’s checkout',
      pulled.ok && A.text('ui/home.tsx') === hubText('ui/home.tsx')
    );
    const B = await makePeer(hub, 'b', credB);
    const pulledB = await waitFor(() => B.has('ui/home.tsx') && B.has('system/smoke/brand.css'), {
      timeoutMs: 90_000,
    });
    check('the second person’s folder fills too', pulledB.ok, `${pulledB.ms} ms`);
    hub.peers = { A, B, credA, credB };

    // ---- A edits a canvas → the hub's checkout → B
    const markA = `MARK-A-${RUN}`;
    A.write(
      'ui/home.tsx',
      A.text('ui/home.tsx').replace('</main>', `  <p data-e2e="${markA}">${markA}</p>\n    </main>`)
    );
    const upA = await waitFor(() => hubText('ui/home.tsx').includes(markA), { timeoutMs: 60_000 });
    check('A’s canvas edit reaches the hub’s checkout', upA.ok, `${upA.ms} ms`);
    const toB = await waitFor(() => B.text('ui/home.tsx').includes(markA), { timeoutMs: 60_000 });
    check('…and arrives in B’s folder', toB.ok, `${toB.ms} ms`);

    // ---- B edits → the hub → A (the other direction, the other person)
    const markB = `MARK-B-${RUN}`;
    B.write(
      'ui/home.tsx',
      B.text('ui/home.tsx').replace('</main>', `  <p data-e2e="${markB}">${markB}</p>\n    </main>`)
    );
    const upB = await waitFor(() => hubText('ui/home.tsx').includes(markB), { timeoutMs: 60_000 });
    check('B’s edit reaches the hub’s checkout', upB.ok, `${upB.ms} ms`);
    const toA = await waitFor(
      () => A.text('ui/home.tsx').includes(markB) && A.text('ui/home.tsx').includes(markA),
      { timeoutMs: 60_000 }
    );
    check('…and arrives in A’s folder, with A’s own edit kept', toA.ok, `${toA.ms} ms`);

    // ---- a file-plane change too (a design-system file), B → hub → A
    const css = `:root { --bg-0: #0b0b0c; --fg-0: #f5f5f4; --e2e: "${RUN}"; }\n`;
    B.write('system/smoke/brand.css', css);
    const cssUp = await waitFor(
      () => hubText('system/smoke/brand.css') === css && A.text('system/smoke/brand.css') === css,
      { timeoutMs: 60_000 }
    );
    check('a design-system file crosses B → hub → A', cssUp.ok, `${cssUp.ms} ms`);

    // ---- the hub commits what arrived
    const committed = await waitFor(
      () => {
        const log = git(hub.repoDir, 'log', '--oneline', '-n', '20');
        return log.split('\n').length > 1 ? log : null;
      },
      { timeoutMs: 60_000, everyMs: 1000 }
    );
    check(
      'the hub’s checkout committed the work',
      committed.ok,
      committed.ok
        ? `${committed.value.split('\n').length} commits; newest "${committed.value.split('\n')[0]}"`
        : `only the seed commit; status: ${git(hub.repoDir, 'status', '--short').slice(0, 200)}`
    );

    // ---- a write the role may not make: a code module is the owner's to write
    const asB = bearer({
      port: hub.port,
      publicUrl: hub.publicUrl,
      ip: nextIp(),
      token: credB.token,
    });
    const body = 'export const planted = true;\n';
    const refused = await asB('/api/file/system/smoke/preview/_e2e-planted.ts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-maude-expect-hash': 'none',
        'x-maude-content-sha256': createHash('sha256').update(body).digest('hex'),
      },
      body,
    });
    check(
      'a member’s write of a code module is refused at the door',
      refused.status === 403 && !hubHas('system/smoke/preview/_e2e-planted.ts'),
      `HTTP ${refused.status} ${refused.text.slice(0, 120)}`
    );
    const noCred = await rawRequest({
      port: hub.port,
      host: new URL(hub.publicUrl).host,
      method: 'PUT',
      path: '/api/file/assets/e2e-anon.svg',
      headers: {
        'x-maude-expect-hash': 'none',
        'x-maude-format': '2',
        'content-length': 5,
        'x-forwarded-for': nextIp(),
      },
      body: '<svg>',
    });
    check(
      'a write with no credential is refused',
      noCred.status === 401 && !hubHas('assets/e2e-anon.svg'),
      `HTTP ${noCred.status}`
    );
    const adminPeople = await asB('/admin/api/people');
    check(
      'a member’s desktop credential opens no admin data',
      adminPeople.status === 401 || adminPeople.status === 403,
      `HTTP ${adminPeople.status}`
    );

    return `fiona (browser) + gustav: down ${pulled.ms} ms, A→hub ${upA.ms} ms, →B ${toB.ms} ms, B→hub ${upB.ms} ms, →A ${toA.ms} ms`;
  },
  { browser: true }
);

// ---------------------------------------------------------------- S6
scenario(
  'S6',
  'browser studio: a member signed in through the provider opens the hub’s studio and the project loads',
  async ({ hub }) => {
    await setJoin(hub, 'ask');
    const jana = await ensureMember(hub, `jana-${RUN}`);
    const b = newBrowser('studio');
    await b.open(`${hub.publicUrl}/`);
    const door = await b.until(`location.pathname.startsWith('/studio/signin')`, 15_000);
    check('a stranger at the studio is sent to the sign-in page', door.ok, await b.url());
    await b.click('a.button[href="/auth/oidc/start"]');
    await b.signInAtProvider(jana);
    const home = await b.until(
      `location.host === ${JSON.stringify(new URL(hub.publicUrl).host)} && location.pathname === '/'`,
      20_000
    );
    check('signed in through the provider, back at the studio', home.ok, await b.url());
    const mounted = await b.until(
      `(() => { const r = document.querySelector('#root'); return !!r && r.children.length > 0; })()`,
      30_000
    );
    check('the studio shell mounted (#root has children)', mounted.ok, `${mounted.ms} ms`);
    const listed = await b.until(
      `document.querySelectorAll('[data-testid^="canvas-row-"]').length > 0`,
      30_000
    );
    const rows = await b.eval(
      `JSON.stringify([...document.querySelectorAll('[data-testid^="canvas-row-"]')].map(e => e.getAttribute('data-testid')))`
    );
    check(
      'it lists the project’s canvases',
      listed.ok && String(rows).includes('canvas-row-ui-home'),
      String(rows).slice(0, 200)
    );
    await b.eval(`document.querySelector('[data-testid="canvas-row-ui-home"]')?.click()`);
    await sleep(20_000);
    const stuck = await b.eval(`/Opening…|Opening\\.\\.\\./.test(document.body.innerText)`);
    const frame = await b.eval(
      `(() => { const f = document.querySelector('[data-testid="canvas-frame"]'); return f ? (f.getAttribute('src') || f.src || 'present') : null; })()`
    );
    await b.shot('S6-studio');
    check(
      'no "Opening…" left on screen 20 s after opening a canvas',
      stuck === false || stuck === 'false',
      `stuck=${stuck}`
    );
    check(
      'the canvas frame is on the separate canvas origin',
      typeof frame === 'string' && frame.startsWith(hub.canvasOrigin),
      String(frame)
        .slice(0, 110)
        .replace(/([?&](t|fc)=)[^&]+/g, '$1…')
    );
    const errs = (await b.run(['errors'])).out;
    check(
      'no page errors',
      !/error/i.test(errs.replace(/no (page )?errors[^\n]*/gi, '')),
      errs.slice(0, 200) || 'none'
    );
    const me = JSON.parse(
      (await b.eval(`fetch('/admin/api/me').then(r => r.json()).then(j => JSON.stringify(j))`)) ??
        '{}'
    );
    check(
      '…as that member',
      me.email === jana.email && me.admin === false,
      `${me.email} admin=${me.admin}`
    );
    await b.close();
    return `${jana.email}: shell mounted in ${mounted.ms} ms, rows ${String(rows).slice(0, 80)}`;
  },
  { browser: true }
);

// ---------------------------------------------------------------- S8
/** What must survive a restart about each row — not "here now / away", which is presence. */
const durableStatus = (p) =>
  /^(Here|Away|Last seen|Active|Online)/i.test(p.statusLabel ?? '') ? 'in' : (p.statusLabel ?? '');
const peopleKey = (list) =>
  list
    .map((p) => `${p.kind}:${p.email}:${p.role ?? ''}:${durableStatus(p)}:${p.linked ?? ''}`)
    .sort();

scenario(
  'S8',
  'restart: the hub is killed hard and started on the same data dir — nothing is lost',
  async ({ hub }) => {
    const a = await adminSession(hub);
    // something of every kind to find again
    const kept = await ensureMember(hub, `karel-${RUN}`);
    const lada = who(`lada-${RUN}`);
    const openInv = await invite(hub, lada.email);
    okJson(
      await a.json('/admin/api/settings', { name: `Studio ${RUN}`, whoCanJoin: 'invite-only' }),
      'settings'
    );
    const before = {
      people: peopleKey(await people(hub)),
      events: await events(hub, 'limit=1000'),
    };
    const adminLinked = (await personRow(hub, ADMIN.email))?.linked;

    const pid = hub.handle.pid;
    await killGroup(hub.handle, { hard: true });
    const down = await waitFor(async () => !(await health(hub)), { timeoutMs: 10_000 });
    check('the hub is down (SIGKILL — no shutdown hook ran)', down.ok, `pid ${pid}`);
    await startHub(hub);
    check(
      'it starts again on the same data dir, studio child ready',
      true,
      `pid ${hub.handle.pid}, studio ready after ${hub.studioReadyMs} ms`
    );

    const me = (await a.json('/admin/api/me')).json();
    check(
      'the admin’s session survived (sessions are on disk)',
      me?.admin === true,
      `admin=${me?.admin}`
    );
    const afterPeople = peopleKey(await people(hub));
    const settings = okJson(await a.json('/admin/api/settings'), 'settings');
    const afterEvents = await events(hub, 'limit=1000');
    const changed = afterPeople
      .filter((r) => !before.people.includes(r))
      .concat(before.people.filter((r) => !afterPeople.includes(r)));
    check(
      'accounts, requests and invitations are as they were',
      changed.length === 0,
      changed.length ? `differs: ${changed.join(' ‖ ')}` : `${afterPeople.length} rows, identical`
    );
    check(
      'settings are as they were',
      settings.name === `Studio ${RUN}` && settings.whoCanJoin === 'invite-only',
      `name="${settings.name}" whoCanJoin=${settings.whoCanJoin}`
    );
    const lost = before.events.filter((e) => !afterEvents.some((x) => x.id === e.id));
    check(
      'the kept log lost nothing',
      lost.length === 0 && before.events.length > 0,
      `${before.events.length} events before, ${afterEvents.length} after, ${lost.length} lost`
    );
    // links: a linked member signs in through the provider; the linked admin too (when S1 ran)
    const again = await oidcSignIn(hub, kept);
    check(
      'a linked member signs in through the provider after the restart',
      again.res.status === 302,
      `HTTP ${again.res.status}`
    );
    if (adminLinked) {
      const adm = await oidcSignIn(hub, { sub: ADMIN.sub, email: ADMIN.email });
      check(
        'the admin’s linked sign-in still reaches the admin account',
        adm.res.status === 302 && (await adm.p.json('/admin/api/me')).json()?.admin === true,
        `HTTP ${adm.res.status}`
      );
    }
    // the open invitation still works (invite-only, so only the invitation lets them in)
    const lp = http1(hub);
    const joined = await oidcAs(
      lp,
      await lp.form('/auth/oidc/start', { invite: openInv.value }),
      lada
    );
    check(
      'an invitation made before the restart still works',
      joined.status === 302,
      `HTTP ${joined.status}`
    );

    // Activity shows the steps the run made (whichever scenarios ran before this one)
    const ev = await events(hub, 'limit=1000');
    const kinds = [...new Set(ev.map((e) => e.kind))].sort();
    const ranIds = new Set(results.filter((r) => r.checks.length).map((r) => r.id));
    const expected = new Set(['signin-browser', 'invite-create', 'invite-redeem', 'settings']);
    if (ranIds.has('S1')) for (const k of ['oidc-self-link', 'oidc-signin']) expected.add(k);
    if (ranIds.has('S3')) expected.add('oidc-refused');
    if (ranIds.has('S4'))
      for (const k of ['oidc-pending', 'oidc-approve', 'oidc-domain-join']) expected.add(k);
    if (ranIds.has('S7'))
      for (const k of ['role-change', 'user-disable', 'user-enable', 'user-signout', 'user-delete'])
        expected.add(k);
    const missing = [...expected].filter((k) => !kinds.includes(k));
    check(
      'Activity shows every step taken so far',
      missing.length === 0,
      missing.length
        ? `missing: ${missing.join(', ')} (have ${kinds.join(', ')})`
        : `${ev.length} events, kinds: ${kinds.join(', ')}`
    );
    const secrets = [ADMIN_KEY, ADMIN.password, openInv.value];
    check('no secret is in the log', !secrets.some((s) => JSON.stringify(ev).includes(s)));

    // CSV
    const csv = await a.json('/admin/api/activity.csv');
    let rows = [];
    let csvError = '';
    try {
      rows = parseCsv(csv.text);
    } catch (err) {
      csvError = err.message;
    }
    const width = rows[0]?.length ?? 0;
    check(
      'the CSV download parses',
      csv.status === 200 &&
        /text\/csv/.test(csv.headers['content-type'] ?? '') &&
        /attachment/.test(csv.headers['content-disposition'] ?? '') &&
        rows.length > 1 &&
        width >= 4 &&
        rows.every((r) => r.length === width),
      csvError ||
        `HTTP ${csv.status}, ${rows.length - 1} rows × ${width} columns (${rows[0]?.join('|')})`
    );
    check(
      '…and carries the same events',
      rows.length - 1 === ev.length && rows.some((r) => r.includes('invite-create')),
      `${rows.length - 1} CSV rows vs ${ev.length} events; first: ${rows[1]?.join(' | ').slice(0, 140)}`
    );
    // sync still works for the desktop peers (when S5 ran in this run)
    if (hub.peers) {
      const mark = `MARK-RESTART-${RUN}`;
      const { A, B } = hub.peers;
      A.write(
        'ui/home.tsx',
        A.text('ui/home.tsx').replace('</main>', `  <p>${mark}</p>\n    </main>`)
      );
      const hubFile = join(hub.repoDir, DESIGN, 'ui/home.tsx');
      const crossed = await waitFor(
        () => B.text('ui/home.tsx').includes(mark) && readFileSync(hubFile, 'utf8').includes(mark),
        { timeoutMs: 120_000 }
      );
      check(
        'the desktop peers reconnect and an edit still crosses',
        crossed.ok,
        `${crossed.ms} ms`
      );
    }
    await setJoin(hub, 'ask');
    return `${afterPeople.length} people rows, ${afterEvents.length} events, CSV ${rows.length - 1} rows — intact after SIGKILL`;
  }
);

/** RFC 4180 — quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- S9
scenario(
  'S9',
  'parity guard: the cloud-cell shape (MAUDE_CLOUD_IDENTITY=strict) has no self-service admin and nothing 500s',
  async () => {
    const cell = await makeHub('cell');
    const home = scratchHome('cell');
    const env = {
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      PORT: String(cell.port),
      DATA_DIR: cell.dataDir,
      // what apps/cells/cell-config.mjs hands a cell
      MAUDE_WORKSPACE_MODE: '1',
      HUB_WORKSPACE_MODE: '1',
      MAUDE_TENANT_ID: 'e2e-tenant',
      MAUDE_REPO_DIR: cell.repoDir,
      MAUDE_DESIGN_ROOT: DESIGN,
      HUB_PUBLIC_URL: cell.publicUrl,
      HUB_INSECURE_HTTP: '1',
      HUB_SECRET: ADMIN_KEY,
      HUB_TRUSTED_PROXIES: '0.0.0.0/0,::/0',
      // a control plane that is not there: nothing of this run leaves the machine
      MAUDE_CONTROL_PLANE_URL: 'http://127.0.0.1:9',
      HUB_DASHBOARD_URL: 'http://127.0.0.1:9',
      MAUDE_CLOUD_IDENTITY: 'strict',
      MAUDE_PROJECT_TOKEN_KEY: randomBytes(32).toString('hex'),
      MAUDE_BACKUP_TARGET: `file://${cell.backupDir}`,
      MAUDE_PUBLIC_CANVAS_ORIGIN: cell.canvasOrigin,
      // the studio child is not what this guard is about (S6 covers it on the team server)
      MAUDE_STUDIO_CHILD: '0',
    };
    cell.handle = spawnLogged(
      'cell-boot1',
      process.execPath,
      [join(REPO_ROOT, 'apps/hub/src/server.mjs')],
      {
        env,
        cwd: join(REPO_ROOT, 'apps/hub'),
        logDir,
      }
    );
    const up = await waitFor(() => health(cell), { timeoutMs: 40_000 });
    if (!up.ok)
      throw new Error(`the cell-shaped hub never answered /health:\n${tail(cell.handle.logPath)}`);
    check(
      'boots in the cloud-cell shape',
      true,
      `v${up.value.version ?? '?'}, ${(up.value.capabilities ?? []).length} capabilities`
    );

    const seen = [];
    const note = (label, res) => {
      seen.push({ label, status: res.status });
      return res;
    };
    const host = new URL(cell.publicUrl).host;
    const p = http1(cell);
    const key = bearer({
      port: cell.port,
      publicUrl: cell.publicUrl,
      ip: nextIp(),
      token: ADMIN_KEY,
    });
    const post = (path, body) =>
      key(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const anonPost = (path, body) =>
      rawRequest({
        port: cell.port,
        host,
        method: 'POST',
        path,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': nextIp(),
          'content-length': Buffer.byteLength(JSON.stringify(body)),
        },
        body: JSON.stringify(body),
      });

    const me = note('GET /admin/api/me', await p.json('/admin/api/me'));
    check(
      '/admin/api/me is the plain 401 of a hub with no session way in (no name, no "signed out" answer)',
      me.status === 401 && !/signedIn|name/.test(me.text),
      `HTTP ${me.status} ${me.text.slice(0, 100)}`
    );
    note('GET /admin', await p.get('/admin'));
    note('GET /admin/', await p.get('/admin/'));
    note('GET /', await p.get('/'));
    note('GET /studio/signin', await p.get('/studio/signin'));
    note('GET /studio/signin?return=admin', await p.get('/studio/signin?return=admin'));
    const pw = note(
      'POST /studio/signin',
      await p.form('/studio/signin', { email: ADMIN.email, password: ADMIN.password })
    );
    check(
      'the password door mints no session',
      pw.status >= 400 && pw.status < 500 && !p.jar.has('maude_studio'),
      `HTTP ${pw.status}`
    );
    const login = note(
      'POST /auth/login',
      await anonPost('/auth/login', { email: ADMIN.email, password: ADMIN.password })
    );
    check(
      '/auth/login takes no password',
      login.status === 400 || login.status === 401,
      `HTTP ${login.status} ${login.text.slice(0, 110)}`
    );
    const join1 = note('GET /join/<invite>', await p.get(`/join/inv_${'a'.repeat(32)}`));
    const join2 = note(
      'POST /join',
      await p.form('/join', {
        token: `inv_${'a'.repeat(32)}`,
        email: ADMIN.email,
        password: 'a-long-enough-password-1',
      })
    );
    check(
      'the invitation door is closed',
      join1.status >= 400 && join1.status < 500 && join2.status >= 400 && join2.status < 500,
      `GET ${join1.status}, POST ${join2.status}`
    );
    const oidc1 = note('GET /auth/oidc/start', await p.get('/auth/oidc/start'));
    const oidc2 = note('POST /auth/oidc/start', await p.form('/auth/oidc/start', { link: '1' }));
    const oidc3 = note(
      'GET /auth/oidc/callback',
      await p.get('/auth/oidc/callback?code=x&state=y')
    );
    check(
      'provider sign-in is not offered',
      [oidc1, oidc2, oidc3].every((r) => r.status >= 400 && r.status < 500),
      `${oidc1.status}/${oidc2.status}/${oidc3.status}`
    );
    const dx = note(
      'POST /auth/desktop/exchange',
      await anonPost('/auth/desktop/exchange', { code: 'nope', code_verifier: 'x'.repeat(43) })
    );
    check(
      'a desktop exchange with no code is a plain refusal',
      dx.status === 400,
      `HTTP ${dx.status}`
    );

    // the admin key reaches the read side; the self-service people surface says "not here"
    const reads = {};
    for (const path of [
      '/admin/api/overview',
      '/admin/api/people',
      '/admin/api/activity',
      '/admin/api/activity.csv',
      '/admin/api/settings',
      '/admin/api/status',
      '/admin/api/users',
      '/admin/api/invites',
      '/admin/api/oidc/pending',
      '/admin/api/identity',
    ]) {
      reads[path.replace('/admin/api/', '')] = note(`GET ${path}`, await key(path)).status;
    }
    check(
      'the operator’s read side answers without a 5xx',
      Object.values(reads).every((s) => s < 500),
      JSON.stringify(reads)
    );
    const writes = {};
    for (const [path, body] of [
      ['/admin/api/people/invite', { emails: [`x@${DOMAIN}`], role: 'member' }],
      ['/admin/api/people/invite/reissue', { id: 'x' }],
      ['/admin/api/people/invite/revoke', { id: 'x' }],
      ['/admin/api/people/let-in', { sub: 'sub-x', role: 'member' }],
      ['/admin/api/people/dismiss', { sub: 'sub-x' }],
      ['/admin/api/people/role', { id: 'u_0000000000000000', role: 'admin' }],
      ['/admin/api/people/turn-off', { id: 'u_0000000000000000' }],
      ['/admin/api/people/turn-on', { id: 'u_0000000000000000' }],
      ['/admin/api/people/remove', { id: 'u_0000000000000000' }],
      ['/admin/api/people/signout', { id: 'u_0000000000000000' }],
    ]) {
      writes[path.replace('/admin/api/people/', '')] = note(
        `POST ${path}`,
        await post(path, body)
      ).status;
    }
    check(
      'every self-service people action answers 409 (“from Maude Cloud”)',
      Object.values(writes).every((s) => s === 409),
      JSON.stringify(writes)
    );
    const inv = note(
      'POST /admin/api/invites',
      await post('/admin/api/invites', { email: `x@${DOMAIN}`, role: 'member' })
    );
    check(
      'the older invite route is closed too',
      inv.status === 409,
      `HTTP ${inv.status} ${inv.text.slice(0, 90)}`
    );
    const user = note(
      'POST /admin/api/users',
      await post('/admin/api/users', {
        email: `x@${DOMAIN}`,
        password: 'a-long-enough-password-1',
        role: 'member',
      })
    );
    const usersAfter = (await key('/admin/api/users')).json()?.users ?? [];
    check(
      'no local account can be made',
      user.status >= 400 && user.status < 500 && usersAfter.length === 0,
      `HTTP ${user.status} ${user.text.slice(0, 90)}; accounts now: ${usersAfter.length}`
    );
    const settingsWas = (await key('/admin/api/settings')).json();
    const setJ = note(
      'POST /admin/api/settings {whoCanJoin}',
      await post('/admin/api/settings', {
        name: settingsWas?.name,
        description: settingsWas?.description,
        whoCanJoin: 'domain',
      })
    );
    const settingsNow = (await key('/admin/api/settings')).json();
    check(
      'Who-can-join is not this hub’s to change',
      (setJ.status >= 400 && setJ.status < 500) || settingsNow?.whoCanJoin !== 'domain',
      `HTTP ${setJ.status} ${setJ.text.slice(0, 100)}; whoCanJoin now ${settingsNow?.whoCanJoin}`
    );
    const peopleNow = (await key('/admin/api/people')).json();
    check(
      'People holds nobody',
      (peopleNow?.people ?? []).length === 0,
      JSON.stringify(peopleNow).slice(0, 200)
    );
    const fives = seen.filter((s) => s.status >= 500);
    check(
      'nothing answered 5xx',
      fives.length === 0,
      fives.length
        ? JSON.stringify(fives)
        : `${seen.length} requests, statuses ${[...new Set(seen.map((s) => s.status))].sort().join(',')}`
    );
    const logText = tail(cell.handle.logPath, 20_000);
    check(
      'nothing threw in the hub’s log',
      !/TypeError|ReferenceError|UnhandledPromiseRejection|uncaught/i.test(logText),
      (/.*(TypeError|ReferenceError|Unhandled|uncaught).*/i.exec(logText) ?? ['clean'])[0].slice(
        0,
        200
      )
    );
    await killGroup(cell.handle);
    return `${seen.length} requests, no 5xx; people actions → ${[...new Set(Object.values(writes))].join(',')}`;
  }
);

/* ==================================================================== run */

async function main() {
  line();
  line(`  ── hub scenarios ── run ${RUN} ── ${root}`);
  const selected = scenarios
    .filter((s) => !only.length || only.includes(s.id))
    .sort((x, y) => x.id.localeCompare(y.id));
  if (!selected.length) throw new Error(`no scenario matches --only ${only.join(',')}`);
  let hub = null;
  if (selected.some((s) => s.id !== 'S9')) {
    hub = await makeHub('hub');
    provider = await startProvider({
      dir: join(root, 'provider'),
      callbackPrefix: `${hub.publicUrl}/auth/oidc/callback`,
    });
    const h = await startHub(hub);
    line(
      `  hub       ${hub.publicUrl}  (pid ${hub.handle.pid}, v${h.version ?? '?'}, studio child ready in ${hub.studioReadyMs} ms)`
    );
    line(`  canvas    ${hub.canvasOrigin}`);
    line(
      `  provider  ${ISSUER} → 127.0.0.1:${provider.port} (page) + the hub’s oidcFetch seam (tokens)`
    );
    line(`  browser   ${useBrowser ? 'agent-browser, one session per person' : 'OFF'}`);
  }
  for (const s of selected) await runScenario(s, { hub });

  line();
  line('  ── result ─────────────────────────────────────────────────────────');
  for (const r of results) {
    line(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.evidence || ''}`);
    for (const c of r.checks.filter((x) => !x.ok)) {
      line(`          ✖ ${c.label}${c.evidence ? ` — ${String(c.evidence).slice(0, 220)}` : ''}`);
    }
    if (r.error) line(`          ✖ ${r.error}`);
  }
  const notRun = scenarios.filter((s) => !selected.includes(s)).map((s) => s.id);
  if (notRun.length) line(`  not run (--only): ${notRun.sort().join(', ')}`);
  line();
  return results.length === selected.length && results.every((r) => r.pass) ? 0 : 1;
}

let exiting = false;
async function cleanup() {
  if (exiting) return;
  exiting = true;
  for (const s of sockets) {
    try {
      s.destroy();
    } catch {
      /* gone */
    }
  }
  for (const b of browsers) await b.close().catch(() => {});
  await killEverything();
  await provider?.close().catch(() => {});
  if (!keepDir && process.exitCode === 0) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } else {
    line(`  kept ${root} (logs in ${logDir})`);
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    process.exitCode = 130;
    await cleanup();
    process.exit(130);
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    line(`\n  ✖ the harness itself failed: ${err?.stack ?? err}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode ?? 1);
  });
