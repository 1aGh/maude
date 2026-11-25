#!/usr/bin/env node
// Maude Cloud, end to end, on this machine — scenarios C1…C8.
//
//   FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/cloud-scenarios.mjs
//   … --only C3            one scenario (its prerequisites are set up, not asserted)
//   … --only C3,C8         several
//   … --keep               keep the scratch dir (printed) for a post-mortem
//   … --verbose            cell + studio logs on stderr
//
// The stack is cloud-stack.mjs (control plane in local workerd, a Stripe
// stand-in, captured e-mail, a Cloudflare domain registry, one hub from source
// per project behind a local TLS edge). Nothing here reaches cloud.maude.sh,
// Stripe, Resend, Cloudflare or Google. See README.md beside this file for
// what is real and what is a stand-in.
//
// Exit code: 0 when every scenario that ran passed, 1 otherwise.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stubClaudeEnv } from '../../lib/stub-claude.mjs';
import { Client, hiddenFields, textOf } from './cloud-http.mjs';
import { freePort, killAll, killTree, REPO, startStack, track } from './cloud-stack.mjs';
import { CARD_DECLINED, CARD_OK } from './cloud-stripe-standin.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : null;
};
const ONLY = opt('only')
  ? new Set(
      opt('only')
        .split(',')
        .map((s) => s.trim().toUpperCase())
    )
  : null;
const RUN_ID = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The design root's folder name inside a checkout. */
const DESIGN_DIR = ['.', 'design'].join('');
const DAY = 86_400_000;

// A session env var would leak this run's browser into every other agent's.
delete process.env.AGENT_BROWSER_SESSION;

/* ------------------------------------------------------------------ report */

const results = [];
let current = null;
const say = (s = '') => process.stdout.write(`${s}\n`);

function check(name, ok, evidence = '') {
  const line = {
    name,
    ok: Boolean(ok),
    evidence: String(evidence ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 300),
  };
  current.checks.push(line);
  say(`    ${line.ok ? 'ok  ' : 'FAIL'}  ${name}${line.evidence ? ` — ${line.evidence}` : ''}`);
  return line.ok;
}
/** A check the scenario cannot continue without. */
function need(name, ok, evidence = '') {
  if (!check(name, ok, evidence)) throw new Error(`stopped at: ${name}`);
}
async function waitFor(fn, { timeoutMs = 30_000, everyMs = 300 } = {}) {
  const started = Date.now();
  let last = null;
  for (;;) {
    try {
      last = await fn();
      if (last) return { ok: true, value: last, ms: Date.now() - started };
    } catch (err) {
      last = err;
    }
    if (Date.now() - started > timeoutMs)
      return { ok: false, value: last, ms: Date.now() - started };
    await sleep(everyMs);
  }
}

/* ----------------------------------------------------------------- browser */

const browsers = new Set();
function agentBrowser(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((ok) => {
    execFile(
      'agent-browser',
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) =>
        ok({
          ok: !err,
          out: String(stdout ?? '').trim(),
          err: String(stderr ?? '').trim() || (err ? String(err.message) : ''),
        })
    );
  });
}
class Browser {
  constructor(stack, name) {
    this.stack = stack;
    this.session = `cloud-e2e-${RUN_ID}-${name}`;
    this.started = false;
    browsers.add(this);
  }
  async run(...args) {
    const launch = this.started
      ? []
      : [
          '--ignore-https-errors',
          '--args',
          // Every name resolves to the local edge: the browser cannot reach a
          // real Stripe, Google or Maude Cloud even by accident.
          `--host-resolver-rules=MAP * 127.0.0.1:${this.stack.edgePort}`,
        ];
    this.started = true;
    return agentBrowser(['--session', this.session, ...launch, ...args]);
  }
  async open(url) {
    const r = await this.run('open', url);
    if (!r.ok) throw new Error(`browser open ${url}: ${r.err || r.out}`);
    return r;
  }
  /** Evaluate an expression that returns a JSON string; returns the parsed value. */
  async eval(js) {
    const r = await this.run('eval', js);
    if (!r.ok) return null;
    try {
      const once = JSON.parse(r.out);
      return typeof once === 'string' ? JSON.parse(once) : once;
    } catch {
      return r.out;
    }
  }
  async state() {
    return (
      (await this.eval(
        "JSON.stringify({ url: location.href, title: document.title, text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 4000), standin: document.body?.dataset?.standin ?? null })"
      )) ?? { url: '', title: '', text: '' }
    );
  }
  /** Wait until the page's url/text satisfies `test`. Returns the last state. */
  async until(test, { timeoutMs = 30_000 } = {}) {
    let s = null;
    const w = await waitFor(
      async () => {
        s = await this.state();
        return s && typeof s === 'object' && test(s) ? s : null;
      },
      { timeoutMs, everyMs: 400 }
    );
    return { ok: w.ok, ...(s ?? {}) };
  }
  async fill(sel, value) {
    const r = await this.run('fill', sel, value);
    if (!r.ok) throw new Error(`browser fill ${sel}: ${r.err || r.out}`);
  }
  async click(sel) {
    const r = await this.run('click', sel);
    if (!r.ok) throw new Error(`browser click ${sel}: ${r.err || r.out}`);
  }
  async checkBox(sel) {
    const r = await this.run('check', sel);
    if (!r.ok) throw new Error(`browser check ${sel}: ${r.err || r.out}`);
  }
  async shot(name) {
    const dir = join(this.stack.root, 'shots');
    mkdirSync(dir, { recursive: true });
    await this.run('screenshot', join(dir, `${name}.png`));
  }
  async close() {
    if (this.started)
      await agentBrowser(['--session', this.session, 'close'], { timeoutMs: 15_000 });
    browsers.delete(this);
  }
}

/* ------------------------------------------------------------- the fixture */

let stack = null;
const PASSWORD = 'correct-horse-battery-staple-1';
/** name → { email, client, browser, accountId, token } */
const people = {};
function person(name) {
  if (!people[name]) {
    people[name] = {
      name,
      email: `${name}-${RUN_ID}@e2e.test`,
      client: new Client(name),
      browser: null,
      accountId: null,
      token: null,
      exists: false,
    };
  }
  return people[name];
}
const browserOf = (p) => {
  p.browser ??= new Browser(stack, p.name);
  return p.browser;
};
const C = () => stack.cloudUrl;
const mailTo = (email, subject = null) =>
  stack.mail.filter((m) => m.to === email && (!subject || subject.test(m.subject)));
const linkIn = (text, pattern) => String(text ?? '').match(pattern)?.[0] ?? null;
const accountIdOf = async (email) =>
  (await stack.d1('SELECT id FROM accounts WHERE email = ?', email))[0]?.id ?? null;
const projectRow = async (id) =>
  (await stack.d1('SELECT * FROM projects WHERE id = ?', id))[0] ?? null;
/** Separate scenarios are separate minutes: the per-minute cost limits start clean. */
const newMinute = () => stack.d1('DELETE FROM rate_hits');

/** Sign in the person's HTTP client (cookie jar). */
async function signIn(p) {
  const r = await p.client.post(`${C()}/auth/login`, {
    form: { email: p.email, password: PASSWORD },
  });
  if (r.status !== 303) throw new Error(`sign-in of ${p.email} answered ${r.status}`);
  return r;
}
/** An account with a confirmed address, made over HTTP (setup, not asserted). */
async function ensureAccount(p) {
  if (p.exists) return p;
  const r = await p.client.post(`${C()}/auth/signup`, {
    form: { email: p.email, password: PASSWORD, disclosure: 'yes' },
  });
  if (r.status !== 303)
    throw new Error(`signup of ${p.email} answered ${r.status}: ${textOf(r.text).slice(0, 200)}`);
  const link = linkIn(
    mailTo(p.email, /Confirm/i).at(-1)?.text,
    /https:\/\/\S+\/auth\/verify\?t=\S+/
  );
  if (!link) throw new Error(`no confirmation mail for ${p.email}`);
  const v = await p.client.get(link);
  if (v.status !== 200) throw new Error(`verify link answered ${v.status}`);
  p.accountId = await accountIdOf(p.email);
  p.exists = true;
  return p;
}
/** The device flow over HTTP: code → the person approves at /activate → token. */
async function deviceToken(p, clientName = 'e2e device') {
  const app = new Client(`${p.name}-app`);
  const code = await app.post(`${C()}/auth/device/code`, { json: { client: clientName } });
  const approve = await p.client.post(`${C()}/activate`, { form: { code: code.json.user_code } });
  if (approve.status !== 200) throw new Error(`approve answered ${approve.status}`);
  const tok = await app.post(`${C()}/auth/device/token`, {
    json: { device_code: code.json.device_code },
  });
  if (!tok.json?.token) throw new Error(`device token answered ${tok.status}`);
  return tok.json.token;
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

const PROJECT = { id: `acme-${RUN_ID}`, name: `Acme ${RUN_ID}` };
let projectReady = false;
/** The owner's trial project, provisioned through the real path (setup, not asserted). */
async function ensureProject() {
  const owner = await ensureAccount(person('owner'));
  if (projectReady) return owner;
  owner.token ??= await deviceToken(owner);
  const r = await new Client('app').post(`${C()}/api/projects`, {
    json: { name: PROJECT.name },
    headers: bearer(owner.token),
  });
  if (r.json?.project?.state !== 'active')
    throw new Error(`trial project: ${r.status} ${r.text.slice(0, 200)}`);
  projectReady = true;
  return owner;
}
/** Invite `p` to a project as `role` and accept through the invitation (setup). */
async function ensureInvited(ownerP, projectId, p, role) {
  const members = await stack.d1(
    'SELECT m.role FROM project_members m JOIN accounts a ON a.id = m.account_id WHERE m.project_id = ? AND a.email = ?',
    projectId,
    p.email
  );
  if (members.length) return p;
  const before = mailTo(p.email, /invited you/i).length;
  await ownerP.client.post(`${C()}/projects/${projectId}/people`, {
    form: { email: p.email, role, do: 'invite' },
  });
  const mail = mailTo(p.email, /invited you/i);
  if (mail.length <= before) throw new Error(`no invitation mail for ${p.email}`);
  const link = linkIn(mail.at(-1).text, /https:\/\/\S+\/invite\/[0-9a-f-]+/);
  if (p.exists) {
    await p.client.get(link);
    await p.client.post(link, { form: {} });
  } else {
    await p.client.get(link);
    const r = await p.client.post(link, { form: { password: PASSWORD, disclosure: 'yes' } });
    if (r.status !== 303) throw new Error(`invite accept answered ${r.status}`);
    p.exists = true;
  }
  p.accountId = await accountIdOf(p.email);
  return p;
}
async function ensureOperator() {
  const op = await ensureAccount(person('operator'));
  if (!op.isOperator) {
    await stack.setOperators([op.accountId]);
    op.isOperator = true;
  }
  return op;
}

/** Sign a person into their real browser session (the /login form). */
async function browserSignIn(p) {
  const b = browserOf(p);
  await b.open(`${C()}/login`);
  await b.fill('input[name=email]', p.email);
  await b.fill('input[name=password]', PASSWORD);
  await b.click('button[type=submit]');
  const s = await b.until((x) => !/\/login/.test(x.url) && x.text.includes(p.email));
  if (!s.ok)
    throw new Error(`browser sign-in of ${p.email} did not land: ${s.url} ${s.text.slice(0, 120)}`);
  p.browserSignedIn = true;
  return b;
}
async function ensureBrowser(p) {
  if (p.browserSignedIn) return browserOf(p);
  return browserSignIn(p);
}

/** A cell session for the person's HTTP client, through the browser door. */
async function cellDoor(p, projectId) {
  const r = await p.client.follow('GET', `${stack.cellUrl(projectId)}/`);
  return r;
}
/** A hub credential the way the app gets one: /projects/open → the cell's /auth/login. */
async function hubCredential(token, projectId, { declare = false } = {}) {
  const c = new Client('app');
  const opened = await c.post(`${C()}/projects/open`, {
    json: { project: projectId },
    headers: { ...bearer(token), ...(declare ? { 'x-maude-access': '2' } : {}) },
  });
  if (opened.status !== 200) return { opened };
  const login = await c.post(`${opened.json.url}/auth/login`, {
    json: { token: opened.json.token },
  });
  return { opened, login, hubToken: login.json?.token ?? null, url: opened.json.url };
}

/* ---------------------------------------------- the desktop side (studio) */

const desks = [];
/**
 * A fresh folder served by the studio server from source — the same process the
 * desktop app runs as its sidecar — pointed at the local control plane. Sign-in,
 * the project list and the attach all go through its own `/_api/cloud/*` routes
 * (apps/studio/cloud/endpoints.ts), which is the code the app runs.
 */
async function startDesk(name, projectName) {
  const { v2Config } = await import(pathToFileURL(join(REPO, 'scripts/dev/v2-config.mjs')).href);
  const dir = join(stack.root, 'desks', name);
  const proj = join(dir, 'project');
  mkdirSync(join(proj, '.design'), { recursive: true });
  mkdirSync(join(dir, 'home/.config/maude'), { recursive: true });
  writeFileSync(
    join(proj, '.design/config.json'),
    `${JSON.stringify(v2Config({ name: projectName, canvasGroups: [{ label: 'Canvases', path: 'ui' }] }), null, 2)}\n`
  );
  const port = await freePort();
  const logs = [];
  const proc = track(
    spawn(
      'bun',
      ['run', join(REPO, 'apps/studio/server.ts'), '--root', proj, '--port', String(port)],
      {
        env: {
          TMPDIR: process.env.TMPDIR ?? '/tmp',
          HOME: join(dir, 'home'),
          XDG_CONFIG_HOME: join(dir, 'home/.config'),
          // never the person's real claude (keychain) nor the real machine index
          ...stubClaudeEnv(join(dir, 'home')),
          MAUDE_INDEX_DIR: join(dir, 'index'),
          NO_OPEN: '1',
          MAUDE_NO_AUTOBUILD: '1',
          MAUDE_CLOUD_URL: C(),
          MAUDE_CLOUD_CONFIG: join(dir, 'cloud.json'),
          HUBS_CONFIG_PATH: join(dir, 'hubs.json'),
          // The local edge's certificate is self-signed.
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }
    )
  );
  const keep = (c) => {
    logs.push(c.toString('utf8'));
    if (logs.length > 300) logs.shift();
    if (flag('verbose')) process.stderr.write(`[desk ${name}] ${c}`);
  };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  const base = `http://localhost:${port}`;
  const client = new Client(`desk-${name}`);
  client.headers = { origin: base };
  const up = await waitFor(async () => (await client.get(`${base}/_health`)).status === 200, {
    timeoutMs: 40_000,
  });
  if (!up.ok)
    throw new Error(`studio server for ${name} did not start: ${logs.join('').slice(-500)}`);
  const desk = {
    name,
    dir,
    proj,
    design: join(proj, '.design'),
    base,
    client,
    proc,
    log: () => logs.join(''),
    hubsJson: () =>
      existsSync(join(dir, 'hubs.json'))
        ? JSON.parse(readFileSync(join(dir, 'hubs.json'), 'utf8'))
        : null,
    stop: () => killTree(proc, 'SIGTERM'),
  };
  desks.push(desk);
  return desk;
}
/** Sign the desk in with the device flow; `approve(userCode, url)` is the person's half. */
async function deskSignIn(desk, approve) {
  const start = await desk.client.post(`${desk.base}/_api/cloud/signin/start`, { json: {} });
  if (!start.json?.ok) throw new Error(`signin/start: ${start.status} ${start.text.slice(0, 200)}`);
  const pending = await desk.client.post(`${desk.base}/_api/cloud/signin/poll`, {
    json: { deviceCode: start.json.deviceCode },
  });
  await approve(start.json.userCode, start.json.verificationUrl);
  const done = await desk.client.post(`${desk.base}/_api/cloud/signin/poll`, {
    json: { deviceCode: start.json.deviceCode },
  });
  return { start: start.json, pending: pending.json, done: done.json };
}
const fileHas = (path, needle) => existsSync(path) && readFileSync(path, 'utf8').includes(needle);

/* --------------------------------------------------------------- scenarios */

const scenarios = {};

scenarios.C1 = {
  title: 'sign up with e-mail + password, confirm the address, sign in; Google redirects',
  async run() {
    const owner = person('owner');
    const b = browserOf(owner);
    // The guard every browser scenario relies on: Stripe's name is the stand-in.
    await b.open('https://checkout.stripe.com/__standin');
    const guard = await b.state();
    need(
      'the browser resolves checkout.stripe.com to the local stand-in',
      /"standin":"stripe"/.test(guard.text),
      guard.text.slice(0, 60)
    );

    await b.open(`${C()}/signup`);
    await b.fill('input[name=email]', owner.email);
    await b.fill('input[name=password]', PASSWORD);
    await b.checkBox('input[name=disclosure]');
    await b.click('button[type=submit]');
    const landed = await b.until(
      (s) => /Your projects/.test(s.text) && s.text.includes(owner.email)
    );
    need(
      'signup lands signed in on the dashboard',
      landed.ok,
      `${landed.url} · ${landed.text.slice(0, 80)}`
    );
    owner.exists = true;
    owner.browserSignedIn = true;
    owner.accountId = await accountIdOf(owner.email);

    const mail = mailTo(owner.email, /Confirm your email/i);
    need(
      'one confirmation mail was captured',
      mail.length === 1,
      `${mail.length} mail(s): ${mail[0]?.subject}`
    );
    const before = (
      await stack.d1('SELECT email_verified_at FROM accounts WHERE id = ?', owner.accountId)
    )[0];
    check(
      'the address is unconfirmed until the link is followed',
      before.email_verified_at === null,
      `email_verified_at=${before.email_verified_at}`
    );
    const link = linkIn(mail[0].text, /https:\/\/\S+\/auth\/verify\?t=\S+/);
    await b.open(link);
    const confirmed = await b.until((s) => /Address confirmed/.test(s.text));
    check('the mailed link confirms the address', confirmed.ok, confirmed.text.slice(0, 90));
    const after = (
      await stack.d1('SELECT email_verified_at FROM accounts WHERE id = ?', owner.accountId)
    )[0];
    check(
      'D1 records the confirmation',
      Number(after.email_verified_at) > 0,
      `email_verified_at=${after.email_verified_at}`
    );
    const again = await new Client('anon').get(link);
    check('the link works once', again.status === 410, `second use → HTTP ${again.status}`);

    // Sign out, then in again through the form.
    await b.open(`${C()}/`);
    await b.click('form[action="/auth/logout"] button');
    const out = await b.until((s) => !s.text.includes(owner.email));
    check('sign out ends the browser session', out.ok, out.url);
    await browserSignIn(owner);
    const s = await b.state();
    check(
      'sign in with the password lands on the dashboard',
      /Your projects/.test(s.text) && s.text.includes(owner.email),
      s.url
    );

    const wrong = await new Client('anon').post(`${C()}/auth/login`, {
      form: { email: owner.email, password: 'not-the-password-123' },
    });
    check(
      'a wrong password is refused with one sentence',
      wrong.status === 401 && /don’t match/.test(textOf(wrong.text)),
      `HTTP ${wrong.status}`
    );

    // HTTP client session for later scenarios.
    await signIn(owner);

    const g = await new Client('anon').get(`${C()}/auth/google`);
    const to = g.location ? new URL(g.location) : null;
    check(
      'GET /auth/google redirects to Google with PKCE and our callback',
      g.status === 303 &&
        to?.host === 'accounts.google.com' &&
        to.searchParams.get('redirect_uri') === `${C()}/auth/google/callback` &&
        to.searchParams.get('client_id') === stack.secrets.GOOGLE_CLIENT_ID &&
        Boolean(to.searchParams.get('state')) &&
        to.searchParams.get('code_challenge_method') === 'S256',
      `${g.status} → ${to?.origin}${to?.pathname} redirect_uri=${to?.searchParams.get('redirect_uri')}`
    );
    check(
      'the OAuth state rides an HttpOnly cookie',
      /HttpOnly/i.test(String(g.headers['set-cookie'] ?? '')),
      String(g.headers['set-cookie'] ?? '').slice(0, 60)
    );
    check(
      'Google itself was never called',
      stack.unrouted.length === 0,
      `${stack.unrouted.length} unrouted outbound fetches`
    );
  },
};

scenarios.C2 = {
  title: 'new project on trial (no card) → provisioned → dashboard card → owner tiles',
  async run() {
    const owner = await ensureAccount(person('owner'));
    await signIn(owner);

    // An unconfirmed address gets no free workspace.
    const fresh = person('unconfirmed');
    await fresh.client.post(`${C()}/auth/signup`, {
      form: { email: fresh.email, password: PASSWORD, disclosure: 'yes' },
    });
    const freshToken = await deviceToken(fresh);
    const refused = await new Client('app').post(`${C()}/api/projects`, {
      json: { name: `Nope ${RUN_ID}` },
      headers: bearer(freshToken),
    });
    check(
      'an unconfirmed address is refused a trial project',
      refused.status === 403 && refused.json?.reason === 'email-unverified',
      `HTTP ${refused.status} ${refused.json?.reason}`
    );

    owner.token ??= await deviceToken(owner);
    const app = new Client('app');
    const stripeCallsBefore = stack.stripe.calls.length;
    const created = await app.post(`${C()}/api/projects`, {
      json: { name: PROJECT.name },
      headers: bearer(owner.token),
    });
    need(
      'POST /api/projects creates the project with no card',
      created.status === 201 && created.json?.project?.id === PROJECT.id,
      `HTTP ${created.status} ${JSON.stringify(created.json?.project ?? created.json).slice(0, 160)}`
    );
    projectReady = created.json.project.state === 'active';
    check(
      'it is active on a trial',
      created.json.project.state === 'active' && created.json.project.plan === 'trial',
      `state=${created.json.project.state} plan=${created.json.project.plan}`
    );
    check(
      'Stripe was not involved',
      stack.stripe.calls.length === stripeCallsBefore,
      `${stack.stripe.calls.length - stripeCallsBefore} Stripe calls`
    );
    const days = (created.json.project.trialEndsAt - Date.now()) / DAY;
    check('the trial ends in about 14 days', days > 13 && days <= 14.01, `${days.toFixed(2)} days`);

    const host = `${PROJECT.id}.${stack.zone}`;
    check(
      'provisioning attached the project hostname and its canvas origin (Cloudflare API)',
      stack.cf.domains.has(host) && stack.cf.domains.has(`canvas-${host}`),
      [...stack.cf.domains.keys()].filter((h) => h.includes(PROJECT.id)).join(', ')
    );
    const row = await projectRow(PROJECT.id);
    check(
      'D1: state active, no subscription, cell_running',
      row?.state === 'active' && row.subscription_id === null && row.cell_running === 1,
      `state=${row?.state} sub=${row?.subscription_id} cell_running=${row?.cell_running}`
    );
    const audit = await stack.d1(
      "SELECT action FROM audit_log WHERE project_id = ? AND action = 'trial.provisioned'",
      PROJECT.id
    );
    check('the audit log records trial.provisioned', audit.length === 1, `${audit.length} row(s)`);

    const health = await waitFor(
      async () => {
        const r = await app.get(`${stack.cellUrl(PROJECT.id)}/health`);
        return r.status === 200 && r.json?.ok ? r.json : null;
      },
      { timeoutMs: 70_000 }
    );
    check(
      'the project address answers /health from a started cell',
      health.ok,
      health.ok
        ? `v${health.value.version} identity=${health.value.identity?.mode} in ${health.ms} ms`
        : String(health.value?.status ?? health.value)
    );

    const replay = await app.post(`${C()}/api/projects`, {
      json: { name: PROJECT.name },
      headers: bearer(owner.token),
    });
    const claims = await stack.d1(
      'SELECT COUNT(*) AS n FROM trial_claims WHERE account_id = ?',
      owner.accountId
    );
    check(
      'creating it again is a replay, not a second project',
      replay.status === 200 && replay.json?.project?.id === PROJECT.id && claims[0].n === 1,
      `HTTP ${replay.status}, ${claims[0].n} trial claim(s)`
    );

    const listed = await app.get(`${C()}/api/projects`, { headers: bearer(owner.token) });
    check(
      'GET /api/projects lists it as the owner',
      listed.json?.projects?.some(
        (p) => p.id === PROJECT.id && p.role === 'owner' && p.state === 'active'
      ),
      JSON.stringify(listed.json?.projects ?? []).slice(0, 160)
    );

    const b = await ensureBrowser(owner);
    await b.open(`${C()}/`);
    const dash = await b.until((s) => s.text.includes(PROJECT.name));
    check(
      'the dashboard shows the project card: name, Ready, Free trial',
      dash.ok && /Ready/i.test(dash.text) && /Free trial · 1[34] days left/i.test(dash.text),
      dash.text.match(new RegExp(`${PROJECT.name}.{0,90}`))?.[0] ?? dash.text.slice(0, 120)
    );
    check(
      'the owner tiles render: People and Invites',
      /People 1 in 1 project/i.test(dash.text) &&
        /Invites 0 sent · 0 joined · 0 waiting/i.test(dash.text),
      dash.text.match(/People 1 in.{0,90}/i)?.[0] ?? dash.text.slice(0, 260)
    );
    await b.shot('C2-dashboard');
  },
};

const REFUSED_FORM =
  /^(Not allowed\.|That request could not be verified\. Reload the page and try again\.)$/;
/**
 * Submit a csrf-protected form by clicking it in the real browser. The browser
 * path is the assertion: a refusal ("That request could not be verified…") or a
 * page that never arrives is a failed check, and nothing is posted over HTTP in
 * its place. Returns the browser state after the click.
 */
async function submitInBrowser(_p, b, { label, action, click, done }) {
  await b.click(click);
  const s = await b.until((x) => done(x) || REFUSED_FORM.test(x.text.trim()), {
    timeoutMs: 20_000,
  });
  const accepted = s.ok && !REFUSED_FORM.test(s.text.trim());
  check(
    `${label}: the form is accepted when submitted from a real browser`,
    accepted,
    accepted ? s.url : `Chromium POST ${action} → “${s.text.trim().slice(0, 120)}”`
  );
  return { ...s, ok: accepted };
}

/** Drive Choose a plan from /account/billing to the hosted Checkout page. */
async function toCheckout(p, b, projectId) {
  await b.open(`${C()}/account/billing`);
  const action = `/projects/${projectId}/billing/plan`;
  const form = `form[action="${action}"]`;
  await b.checkBox(`${form} input[name=plan][value=project]`);
  await b.checkBox(`${form} input[name=interval][value=monthly]`);
  const atStripe = (s) =>
    s.standin === 'stripe' && /checkout\.stripe\.com\/c\/pay\/cs_test_/.test(s.url);
  const s = await submitInBrowser(p, b, {
    label: 'Choose a plan',
    pagePath: '/account/billing',
    action,
    click: `${form} button[type=submit]`,
    fields: { plan: 'project', interval: 'monthly' },
    done: atStripe,
  });
  return s;
}
async function payWith(b, card) {
  await b.fill('#cardnumber', card);
  await b.click('#pay');
}

scenarios.C3 = {
  title: 'checkout: declined card, paid card → webhook → paid, replay, cancel',
  async run() {
    const owner = await ensureProject();
    await signIn(owner);
    const b = await ensureBrowser(owner);

    // ---- a card that is declined
    let pay = await toCheckout(owner, b, PROJECT.id);
    need(
      'Choose a plan leaves for the hosted Checkout page',
      pay.ok,
      `${pay.url} · ${pay.text?.slice(0, 200)}`
    );
    const eventsBefore = stack.stripe.events.length;
    await payWith(b, CARD_DECLINED.replace(/(.{4})/g, '$1 ').trim());
    const declined = await b.until((s) => /Your card was declined/.test(s.text));
    check(
      '4000 0000 0000 0002 is declined with a clear message, on the payment page',
      declined.ok && /checkout\.stripe\.com/.test(declined.url),
      declined.text.slice(0, 80)
    );
    let row = await projectRow(PROJECT.id);
    check(
      'the project stays on its trial: no subscription, still active',
      row.subscription_id === null && row.state === 'active' && row.trial_ends_at > Date.now(),
      `sub=${row.subscription_id} state=${row.state}`
    );
    check(
      'no webhook was sent for a declined card',
      stack.stripe.events.length === eventsBefore,
      `${stack.stripe.events.length - eventsBefore} event(s)`
    );
    await b.click('#back');
    const back = await b.until((s) => new RegExp(`/projects/${PROJECT.id}/billing`).test(s.url));
    check(
      'Back returns to the billing page, which still says Free trial and Choose a plan',
      back.ok && /Free trial/.test(back.text) && /Choose a plan/.test(back.text),
      back.text.match(/Free trial.{0,80}/)?.[0] ?? back.url
    );

    // ---- a card that pays
    pay = await toCheckout(owner, b, PROJECT.id);
    need('a second Checkout opens', pay.ok, pay.url);
    await payWith(b, '4242 4242 4242 4242');
    const paid = await b.until((s) => new RegExp(`/projects/${PROJECT.id}/billing`).test(s.url), {
      timeoutMs: 40_000,
    });
    need(
      '4242 4242 4242 4242 pays and returns to the billing page',
      paid.ok,
      `${paid.url} · ${paid.text.slice(0, 100)}`
    );
    row = await projectRow(PROJECT.id);
    need(
      'the subscription is attached to the project',
      /^sub_/.test(String(row.subscription_id)) && row.plan === 'project',
      `sub=${row.subscription_id} plan=${row.plan}`
    );
    check(
      'the billing page shows a paid plan, not a trial',
      !/Free trial/.test(paid.text) &&
        /(Active|Renews|Cloud Project|next payment|Invoices)/i.test(paid.text),
      paid.text.match(/Billing .{0,200}/)?.[0] ?? ''
    );
    await b.shot('C3-billing-paid');

    const completed = stack.stripe.events
      .filter((e) => e.type === 'checkout.session.completed')
      .at(-1);
    check(
      'the signed checkout.session.completed webhook was accepted and named the project',
      completed?.status === 200 && /"handled":true/.test(completed.body),
      `HTTP ${completed?.status} ${completed?.body}`
    );
    const jobsBefore = await stack.d1(
      'SELECT COUNT(*) AS n FROM jobs WHERE project_id = ?',
      PROJECT.id
    );
    const attempts = await stack.d1(
      'SELECT payment FROM checkout_attempts WHERE project_id = ?',
      PROJECT.id
    );
    check(
      'one checkout attempt is recorded as charged',
      attempts.length === 1 && attempts[0].payment === 'charged',
      JSON.stringify(attempts)
    );

    // ---- the same event again
    const snapshot = JSON.stringify(await projectRow(PROJECT.id));
    const replay = await stack.stripe.replay(completed.id);
    const replay2 = await stack.stripe.replay(completed.id);
    await stack.cron();
    const afterRow = await projectRow(PROJECT.id);
    const same = (a, b2) =>
      ['state', 'subscription_id', 'plan', 'account_id', 'trial_ends_at'].every(
        (k) => a[k] === b2[k]
      );
    const attemptsAfter = await stack.d1(
      'SELECT payment FROM checkout_attempts WHERE project_id = ?',
      PROJECT.id
    );
    const stuck = await stack.d1(
      'SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND finished_at IS NULL',
      PROJECT.id
    );
    check(
      'a replayed webhook is acknowledged and changes nothing',
      replay.status === 200 &&
        replay2.status === 200 &&
        same(JSON.parse(snapshot), afterRow) &&
        attemptsAfter.length === 1 &&
        stuck[0].n === 0,
      `replays HTTP ${replay.status}/${replay2.status}; state=${afterRow.state} sub unchanged=${JSON.parse(snapshot).subscription_id === afterRow.subscription_id}; attempts=${attemptsAfter.length}; pending jobs after sweep=${stuck[0].n} (jobs before ${jobsBefore[0].n})`
    );
    const bad = await new Client('stripe').post(`${C()}/webhooks/stripe`, {
      body: completed.rawBody,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stack.signWebhook(`${completed.rawBody} `),
      },
    });
    const stale = await new Client('stripe').post(`${C()}/webhooks/stripe`, {
      body: completed.rawBody,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stack.signWebhook(
          completed.rawBody,
          Math.floor(Date.now() / 1000) - 3600
        ),
      },
    });
    check(
      'a wrong signature and a stale timestamp are both refused',
      bad.status === 400 && stale.status === 400,
      `HTTP ${bad.status} / ${stale.status}`
    );

    // ---- cancel
    await b.open(`${C()}/projects/${PROJECT.id}/billing/cancel`);
    const cancelPage = await b.until(
      (s) => /cancel/i.test(s.text) && /billing\/cancel/.test(s.url)
    );
    need('the cancel page opens', cancelPage.ok, cancelPage.text.slice(0, 120));
    await b.checkBox('input[name=sure]');
    await b.click(`form[action="/projects/${PROJECT.id}/billing/cancel"] button[type=submit]`);
    const cancelled = await b.until((s) =>
      new RegExp(`/projects/${PROJECT.id}/billing$`).test(s.url)
    );
    const sub = stack.stripe.subscriptions.get(row.subscription_id);
    check(
      'cancelling sets cancel-at-period-end at Stripe (not an immediate stop)',
      cancelled.ok && sub.cancel_at_period_end === true && sub.status === 'active',
      `cancel_at_period_end=${sub.cancel_at_period_end} status=${sub.status}`
    );
    check(
      'the billing page says the plan is ending and when',
      /(cancel|ends on|ending|Keep the plan|Undo)/i.test(cancelled.text),
      cancelled.text.match(/Billing .{0,220}/)?.[0] ?? ''
    );
    const audit = await stack.d1(
      "SELECT action FROM audit_log WHERE project_id = ? AND action = 'billing.cancelled'",
      PROJECT.id
    );
    check('the cancel is in the audit log', audit.length === 1, `${audit.length} row(s)`);
    await stack.cron();
    row = await projectRow(PROJECT.id);
    check(
      'until the period ends the project stays active',
      row.state === 'active' && stack.cf.domains.has(`${PROJECT.id}.${stack.zone}`),
      `state=${row.state}`
    );

    // Undo, so the project keeps its plan for the scenarios after this one.
    const resume = hiddenFields(cancelled.text, /billing\/resume/);
    const r = await owner.client.post(`${C()}/projects/${PROJECT.id}/billing/resume`, {
      form: resume?.fields ?? {},
    });
    check(
      'undoing the cancel clears it at Stripe',
      r.status === 303 && sub.cancel_at_period_end === false,
      `HTTP ${r.status} cancel_at_period_end=${sub.cancel_at_period_end}`
    );

    // ---- the period really ends, on a second project bought with a card up front
    const second = { id: `paid-${RUN_ID}`, name: `Paid ${RUN_ID}` };
    await b.open(`${C()}/projects/new`);
    await b.fill('input[name=name]', second.name);
    await b.checkBox('form[action="/projects/new"] input[name=plan][value=project]');
    await b.checkBox('form[action="/projects/new"] input[name=interval][value=monthly]');
    await b.click('form[action="/projects/new"] button[type=submit]');
    const pay2 = await b.until((s) => s.standin === 'stripe', { timeoutMs: 8000 });
    const wizardPost = stack.edgeLog
      .filter((e) => e.method === 'POST' && e.path === '/projects/new')
      .at(-1);
    const wizardCsp = (await owner.client.get(`${C()}/projects/new`)).headers[
      'content-security-policy'
    ];
    check(
      'the wizard’s hand-off to Stripe Checkout is followed by a real browser',
      pay2.ok,
      `POST /projects/new answered HTTP ${wizardPost?.status}; the browser is at ${pay2.url}; the page’s CSP: “${wizardCsp}”`
    );
    need('the card-up-front wizard reaches Checkout', pay2.ok, pay2.url);
    await payWith(b, CARD_OK);
    const room = await b.until((s) => new RegExp(`/projects/${second.id}/setup`).test(s.url), {
      timeoutMs: 40_000,
    });
    need('paying lands in the waiting room', room.ok, room.url);
    const settled = await waitFor(
      async () => {
        await b.open(`${C()}/projects/${second.id}/setup`);
        const p = await projectRow(second.id);
        return p?.state === 'active' ? p : null;
      },
      { timeoutMs: 90_000, everyMs: 1500 }
    );
    need(
      'the waiting room settles once the workspace answers (provision first, then keep the plan)',
      settled.ok,
      `state=${(await projectRow(second.id))?.state}`
    );
    const sub2 = stack.stripe.subscriptions.get(settled.value.subscription_id);
    check(
      'that subscription starts with the advertised 14-day trial',
      sub2?.status === 'trialing',
      `status=${sub2?.status}`
    );
    const mailBefore = mailTo(owner.email).length;
    const ended = await stack.stripe.endSubscription(sub2.id, 'canceled');
    await stack.cron();
    const held = await projectRow(second.id);
    check(
      'when Stripe ends the subscription the webhook is accepted',
      ended.status === 200,
      `HTTP ${ended.status} ${ended.body}`
    );
    check(
      'the first sweep tears nothing down on one bad read',
      held.state === 'active' && stack.cf.domains.has(`${second.id}.${stack.zone}`),
      `state=${held.state}`
    );
    check(
      '…and records when the bad reading started, so the six-hour wait can end',
      Number(held.adverse_since) > 0,
      `adverse_since=${held.adverse_since} after the sweep: reconcile.mjs settle() returns before applyActions when a round has no actions, so the debounce start is never saved and a cancelled subscription never suspends (failing repro: cloud-repro-suspend-debounce.test.mjs)`
    );
    // The clock, moved: the subscription has now read ended for seven hours (the wait is six).
    await stack.d1(
      'UPDATE projects SET adverse_since = ? WHERE id = ?',
      Date.now() - 7 * 3600_000,
      second.id
    );
    await stack.cron();
    const gone = await projectRow(second.id);
    check(
      '…and once it has stayed ended, the sweep moves the project out of active',
      gone.state !== 'active',
      `state=${gone.state}`
    );
    const detached = !stack.cf.domains.has(`${second.id}.${stack.zone}`);
    const told = mailTo(owner.email).length - mailBefore;
    const did = await stack.d1(
      "SELECT action, detail FROM audit_log WHERE project_id = ? AND (action LIKE 'do.%' OR action LIKE 'reconcile%') ORDER BY at",
      second.id
    );
    const jobs = await stack.d1(
      'SELECT reason, outcome, detail FROM jobs WHERE project_id = ? ORDER BY created_at',
      second.id
    );
    say(`      (jobs: ${JSON.stringify(jobs).slice(0, 500)})`);
    check(
      'its address is taken down',
      detached,
      `domain attached=${!detached}; effects: ${did.map((d) => `${d.action}${d.detail ? `(${d.detail})` : ''}`).join(', ')}; mails to owner: ${told}`
    );
  },
};

scenarios.C4 = {
  title: 'invite by e-mail (Can edit), join through the link, resend, cancel, ask to edit',
  async run() {
    const owner = await ensureProject();
    await signIn(owner);
    const member = person('member');
    const b = await ensureBrowser(owner);

    await b.open(`${C()}/projects/${PROJECT.id}/people`);
    await b.fill('input[name=email]', member.email);
    await b.run('select', 'select[name=role]', 'member');
    await b.click('button[name=do][value=invite]');
    const sent = await b.until((s) => s.text.includes(`Invitation sent to ${member.email}`));
    need(
      'the owner sends a Can edit invitation from the People page',
      sent.ok,
      sent.text.match(/Invitation sent.{0,60}/)?.[0] ?? sent.text.slice(0, 120)
    );
    let mail = mailTo(member.email, /invited you/i);
    need(
      'the invitation mail was captured',
      mail.length === 1,
      `${mail.length}: ${mail[0]?.subject}`
    );
    const link = linkIn(mail[0].text, /https:\/\/\S+\/invite\/[0-9a-f-]+/);
    check(
      'it names the project and carries the link',
      mail[0].text.includes(PROJECT.name) && Boolean(link),
      link ?? ''
    );

    // ---- resend
    const peoplePath = `/projects/${PROJECT.id}/people`;
    await b.open(`${C()}${peoplePath}`);
    await b.until((s) => /Send again/.test(s.text));
    const resent = await submitInBrowser(owner, b, {
      label: 'Send again',
      pagePath: peoplePath,
      action: peoplePath,
      click: 'button[value=invite-resend]',
      fields: { do: 'invite-resend' },
      pred: (f) => f.invite === link.split('/').pop(),
      done: (s) => /Sent again to/.test(s.text),
    });
    mail = mailTo(member.email, /invited you/i);
    check(
      'Send again mails the same link once more',
      resent.ok &&
        /Sent again to/.test(resent.text) &&
        mail.length === 2 &&
        linkIn(mail[1].text, /https:\/\/\S+\/invite\/[0-9a-f-]+/) === link,
      `${mail.length} mails; same link=${linkIn(mail[1]?.text, /https:\/\/\S+\/invite\/[0-9a-f-]+/) === link}`
    );
    const noCsrf = await owner.client.post(`${C()}/projects/${PROJECT.id}/people`, {
      form: { do: 'invite-resend', invite: link.split('/').pop() },
    });
    check(
      'a resend without the form’s csrf field is refused',
      noCsrf.status === 403 && mailTo(member.email, /invited you/i).length === 2,
      `HTTP ${noCsrf.status}`
    );

    // ---- cancel (on a second invitation)
    const dropped = person('dropped');
    await owner.client.post(`${C()}/projects/${PROJECT.id}/people`, {
      form: { email: dropped.email, role: 'viewer', do: 'invite' },
    });
    const droppedLink = linkIn(
      mailTo(dropped.email, /invited you/i).at(-1)?.text,
      /https:\/\/\S+\/invite\/[0-9a-f-]+/
    );
    const live = await new Client('anon').get(droppedLink);
    await b.open(`${C()}/projects/${PROJECT.id}/people`);
    const droppedId = droppedLink.split('/').pop();
    const cancelled = await submitInBrowser(owner, b, {
      label: 'Cancel invite',
      pagePath: peoplePath,
      action: peoplePath,
      click: `xpath=//form[.//input[@name="invite" and @value="${droppedId}"]]//button[@value="invite-cancel"]`,
      fields: { do: 'invite-cancel' },
      pred: (f) => f.invite === droppedId,
      done: (s) => /is cancelled/.test(s.text),
    });
    const dead = await new Client('anon').get(droppedLink);
    check(
      'Cancel invite kills the link',
      cancelled.ok &&
        /is cancelled/.test(cancelled.text) &&
        live.status === 200 &&
        dead.status === 404,
      `before HTTP ${live.status}, after HTTP ${dead.status}`
    );

    // ---- the invited person, in a clean browser
    const mb = browserOf(member);
    await mb.open(link);
    const invite = await mb.until((s) => s.text.includes(`You’re invited to ${PROJECT.name}`));
    need(
      'the invitation opens in a clean browser session',
      invite.ok && invite.text.includes(member.email),
      invite.text.slice(0, 120)
    );
    // The page leads with the app; the browser path is behind “Just looking?”.
    await mb.click('details > summary');
    await mb.fill('input[name=password]', PASSWORD);
    await mb.checkBox('input[name=disclosure]');
    await mb.click(`form[action="/invite/${link.split('/').pop()}"] button[type=submit]`);
    const joined = await mb.until(
      (s) =>
        s.text.includes(member.email) && s.text.includes(PROJECT.name) && !/\/invite\//.test(s.url)
    );
    need(
      'creating the account through the invitation lands signed in, with the project',
      joined.ok,
      `${joined.url} · ${joined.text.slice(0, 140)}`
    );
    member.exists = true;
    member.browserSignedIn = true;
    member.accountId = await accountIdOf(member.email);
    const row = await stack.d1(
      'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
      PROJECT.id,
      member.accountId
    );
    check('D1: they are a member with Can edit', row[0]?.role === 'member', `role=${row[0]?.role}`);
    const verified = await stack.d1(
      'SELECT email_verified_at FROM accounts WHERE id = ?',
      member.accountId
    );
    check(
      'redeeming the invitation counts as confirming the address',
      Number(verified[0].email_verified_at) > 0,
      `email_verified_at=${verified[0].email_verified_at}`
    );
    const used = await new Client('anon').get(link);
    check('the invitation link is spent', used.status === 404, `HTTP ${used.status}`);
    await signIn(member);

    // ---- Can view is not offered while the project's workspace does not hold it
    // (no hub advertises `roles-v2` yet — apps/hub/src/routes-v2/access.mjs
    // ROLES_V2_ADVERTISED — so an invitation to it would die at the browser door).
    const peopleHtml = (await owner.client.get(`${C()}/projects/${PROJECT.id}/people`)).text;
    check(
      'the People page does not offer Can view, and says why',
      !/<option value="observer"/.test(peopleHtml) &&
        /<option value="viewer"/.test(peopleHtml) &&
        /Can view is not available/.test(textOf(peopleHtml)),
      textOf(peopleHtml).match(/Can view is not available.{0,80}/)?.[0] ??
        'no explanation on the page'
    );
    const refusedView = await owner.client.post(`${C()}/projects/${PROJECT.id}/people`, {
      form: { email: person('refused-view').email, role: 'observer', do: 'invite' },
    });
    check(
      'a Can view invitation posted anyway is refused, and nothing is mailed',
      refusedView.status === 400 &&
        mailTo(person('refused-view').email, /invited you/i).length === 0,
      `HTTP ${refusedView.status}; mails=${mailTo(person('refused-view').email, /invited you/i).length}`
    );

    // ---- an existing account signs in through an invitation (Can comment)
    const viewer = await ensureAccount(person('viewer'));
    await owner.client.post(`${C()}/projects/${PROJECT.id}/people`, {
      form: { email: viewer.email, role: 'viewer', do: 'invite' },
    });
    const vLink = linkIn(
      mailTo(viewer.email, /invited you/i).at(-1)?.text,
      /https:\/\/\S+\/invite\/[0-9a-f-]+/
    );
    const vb = browserOf(viewer);
    await vb.open(vLink);
    const askSignIn = await vb.until(
      (s) => /Sign in/.test(s.text) && s.text.includes(PROJECT.name)
    );
    check(
      'an existing account is asked to sign in, not to create one',
      askSignIn.ok &&
        !(await vb.eval(
          "JSON.stringify(Boolean(document.querySelector('input[name=disclosure]')))"
        )),
      askSignIn.text.slice(0, 100)
    );
    await vb.open(`${C()}/login?next=${encodeURIComponent(`/invite/${vLink.split('/').pop()}`)}`);
    await vb.fill('input[name=email]', viewer.email);
    await vb.fill('input[name=password]', PASSWORD);
    await vb.click('button[type=submit]');
    await vb.until((s) => s.text.includes(viewer.email));
    viewer.browserSignedIn = true;
    let vRow = await waitFor(
      async () =>
        (
          await stack.d1(
            'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
            PROJECT.id,
            viewer.accountId
          )
        )[0],
      { timeoutMs: 4000 }
    );
    if (!vRow.ok) {
      // Signing in did not redeem by itself: the page offers the join.
      await vb.open(vLink);
      await vb.run('click', 'details > summary');
      await vb.click(`form[action="/invite/${vLink.split('/').pop()}"] button[type=submit]`);
      vRow = await waitFor(
        async () =>
          (
            await stack.d1(
              'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
              PROJECT.id,
              viewer.accountId
            )
          )[0],
        { timeoutMs: 8000 }
      );
    }
    need(
      'signing in through the invitation makes them a Can comment member',
      vRow.ok && vRow.value.role === 'viewer',
      `role=${vRow.value?.role}`
    );

    // ---- ask to edit, from Can comment, in the project itself
    await signIn(viewer);
    const cell = stack.cellUrl(PROJECT.id);
    const sameOrigin = { origin: cell, 'sec-fetch-site': 'same-origin' };
    const door = await cellDoor(viewer, PROJECT.id);
    need(
      'a Can comment person can open the project in the browser',
      door.status === 200 && door.url.startsWith(`${cell}/`),
      `${door.chain.map((c) => c.status).join(' → ')} “${textOf(door.text).slice(0, 90)}”`
    );
    const asker = viewer;
    const me = await asker.client.get(`${cell}/_api/share/me`, { headers: sameOrigin });
    check(
      'the project says they cannot edit',
      ['observer', 'viewer'].includes(me.json?.role) &&
        me.json?.caps?.edit !== true &&
        me.json?.caps?.request === true,
      JSON.stringify(me.json).slice(0, 200)
    );
    const asked = await asker.client.post(`${cell}/_api/share/requests`, {
      json: {},
      headers: sameOrigin,
    });
    need(
      'Ask to edit is recorded',
      asked.status === 201 && /^req_/.test(asked.json?.id ?? ''),
      `HTTP ${asked.status} ${asked.text.slice(0, 160)}`
    );
    await b.open(`${C()}/account/people`);
    const sees = await b.until((s) => s.text.includes(asker.email) && /Allow/.test(s.text));
    need(
      'the owner sees the request on /account/people',
      sees.ok,
      sees.text.match(/.{0,60}Allow.{0,40}/)?.[0] ?? sees.text.slice(0, 160)
    );
    const allowed = await submitInBrowser(owner, b, {
      label: 'Allow',
      pagePath: '/account/people',
      action: '/account/people',
      click: `xpath=//form[.//input[@name="do" and @value="request-allow"] and .//input[@name="request" and @value="${asked.json.id}"]]//button`,
      pred: (f) => f.do === 'request-allow' && f.request === asked.json.id,
      done: (s) => /They can edit now/.test(s.text),
    });
    check(
      'Allow answers “They can edit now.”',
      allowed.ok && /They can edit now/.test(allowed.text),
      allowed.text.match(/They can edit now\.?/)?.[0] ?? allowed.url
    );
    const me2 = await waitFor(
      async () => {
        const r = await asker.client.get(`${cell}/_api/share/me`, { headers: sameOrigin });
        return r.json?.caps?.edit === true ? r.json : null;
      },
      { timeoutMs: 15_000 }
    );
    const decided = await stack.d1(
      'SELECT decision FROM access_requests WHERE id = ?',
      asked.json.id
    );
    check(
      'the person can edit now, and the request is closed as approved',
      me2.ok && decided[0]?.decision === 'approved',
      `role=${me2.value?.role ?? '?'} decision=${decided[0]?.decision}`
    );

    // ---- /account/people: the lists, Find someone, and a bulk change — in the browser
    await b.open(`${C()}/account/people`);
    const lists = await b.until((x) => /Everyone\s+\d+/.test(x.text) && /Owners\s+1/.test(x.text));
    check(
      'the People page has its lists with counts (Everyone, Owners)',
      lists.ok,
      lists.text.match(/Everyone\s+\d+.{0,40}/)?.[0] ?? lists.text.slice(0, 120)
    );
    await b.fill('form.find input[name=q]', asker.email.slice(0, 6));
    await b.click('form.find button[type=submit]');
    const found = await b.until((x) => /[?&]q=/.test(x.url));
    const matrixText = found.text.split('Projects you own')[1]?.split('Shared with you')[0] ?? '';
    check(
      'Find someone narrows the table to the match',
      found.ok && matrixText.includes(asker.email) && !matrixText.includes(member.email),
      `${found.url} · ${matrixText.slice(0, 160)}`
    );
    await b.checkBox(`input[name=people][value="${asker.accountId}"]`);
    await b.eval(
      `(document.querySelector('#bulk select[name=project]').value=${JSON.stringify(PROJECT.id)},document.querySelector('#bulk select[name=role]').value='viewer','ok')`
    );
    const bulked = await submitInBrowser(owner, b, {
      label: 'Change role in that project (bulk)',
      action: '/account/people',
      click: '#bulk button[value=role-bulk]',
      done: (x) => /done=role-bulk/.test(x.url),
    });
    const bulkRole = await stack.d1(
      'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
      PROJECT.id,
      asker.accountId
    );
    check(
      'the bulk change is applied: the selected person is Can comment in that project',
      bulked.ok && bulkRole[0]?.role === 'viewer',
      `role=${bulkRole[0]?.role}; ${bulked.url}`
    );
    // One id that is not this owner's refuses the whole request.
    const stranger = await ensureAccount(person('stranger'));
    const pageNow = await owner.client.get(`${C()}/account/people`);
    const csrfNow = /name="csrf" value="([0-9a-f]{32})"/.exec(pageNow.text)?.[1] ?? '';
    const mixed = await owner.client.request('POST', `${C()}/account/people`, {
      body: `csrf=${csrfNow}&do=role-bulk&project=${PROJECT.id}&role=member&people=${asker.accountId}&people=${stranger.accountId}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const stillViewer = await stack.d1(
      'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
      PROJECT.id,
      asker.accountId
    );
    check(
      'a bulk request naming somebody who is not on this owner’s projects changes nobody',
      mixed.status === 404 && stillViewer[0]?.role === 'viewer',
      `HTTP ${mixed.status}; role=${stillViewer[0]?.role}`
    );
  },
};

async function studioState(b) {
  return b.eval(
    "JSON.stringify({ url: location.href, title: document.title, root: document.querySelector('#root')?.children.length ?? 0, text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 1500), rows: [...document.querySelectorAll('[data-testid^=\"canvas-row-\"]')].map((e) => e.dataset.testid), frame: Boolean(document.querySelector('[data-testid=\"canvas-frame\"]')) })"
  );
}
async function openStudioInBrowser(p, expectRole) {
  const b = await ensureBrowser(p);
  await b.open(`${C()}/projects/${PROJECT.id}/connect`);
  const connect = await b.until((s) => /In your browser/.test(s.text));
  need(
    `${p.name}: the Open page offers “Open in the browser”`,
    connect.ok,
    connect.text.slice(0, 100)
  );
  await b.click(`a[href="${stack.cellUrl(PROJECT.id)}"]`);
  let st = null;
  const loaded = await waitFor(
    async () => {
      st = await studioState(b);
      return (
        st &&
        typeof st === 'object' &&
        st.url.startsWith(stack.cellUrl(PROJECT.id)) &&
        st.root > 0 &&
        (st.rows.length > 0 || /welcome/.test(st.text)) &&
        !/Opening…/.test(st.text)
      );
    },
    { timeoutMs: 60_000, everyMs: 700 }
  );
  await b.shot(`C5-studio-${p.name}`);
  check(
    `${p.name}: the studio shell loads at the project address (#root has children)`,
    loaded.ok && st.root > 0,
    `${st?.url} title=“${st?.title}” #root children=${st?.root}`
  );
  check(
    `${p.name}: canvases are listed and it is not stuck on “Opening…”`,
    loaded.ok && !/Opening…/.test(st?.text ?? ''),
    `rows=${JSON.stringify(st?.rows)} · ${String(st?.text).slice(0, 110)}`
  );
  // What the shell itself reads: who it is signed in as, and with what access.
  const who = await b.eval(
    "Promise.all([fetch('/_api/git-user').then((r) => r.json()), fetch('/_config').then((r) => r.json())]).then(([u, c]) => JSON.stringify({ user: u.name ?? u, access: c.access ?? null, readOnly: c.readOnly ?? null, roleSource: c.roleSource ?? null }))"
  );
  check(
    `${p.name}: the shell is signed in as them, with the ${expectRole} role`,
    who?.user === p.email &&
      JSON.stringify(who?.access ?? {}).includes(`"${expectRole}"`) &&
      who?.readOnly !== true,
    JSON.stringify(who).slice(0, 220)
  );
  return st;
}

scenarios.C5 = {
  title: 'browser studio: owner and member open the project in the browser',
  async run() {
    const owner = await ensureProject();
    await signIn(owner);
    const member = await ensureInvited(owner, PROJECT.id, person('member'), 'member');
    await openStudioInBrowser(owner, 'owner');
    await openStudioInBrowser(member, 'member');
    const outsider = await ensureAccount(person('outsider'));
    await signIn(outsider);
    const refused = await cellDoor(outsider, PROJECT.id);
    check(
      'somebody who is not on the project does not get in through the door',
      !refused.url.startsWith(`${stack.cellUrl(PROJECT.id)}/?`) &&
        !(await outsider.client.get(`${stack.cellUrl(PROJECT.id)}/auth/session`)).text.includes(
          outsider.email
        ),
      `${refused.chain.map((c) => c.status).join(' → ')} ends at ${refused.url.slice(0, 90)}`
    );
  },
};

scenarios.C6 = {
  title:
    'desktop: device-code sign-in, download into a fresh folder, edits both ways, Can view refused, removal stops sync',
  async run() {
    const owner = await ensureProject();
    await signIn(owner);
    const member = await ensureInvited(owner, PROJECT.id, person('member'), 'member');
    await signIn(member);
    const cell = stack.cellUrl(PROJECT.id);

    // ---- the raw device-code contract
    const app = new Client('app');
    const code = await app.post(`${C()}/auth/device/code`, {
      json: { client: 'Maude Studio on darwin' },
    });
    check(
      'POST /auth/device/code hands out a device code, a user code and the /activate link',
      code.status === 200 &&
        /^mdc_/.test(code.json.device_code) &&
        /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.json.user_code) &&
        code.json.verification_url ===
          `${C()}/activate?code=${encodeURIComponent(code.json.user_code)}`,
      `${code.json.user_code} → ${code.json.verification_url}`
    );
    const pending = await app.post(`${C()}/auth/device/token`, {
      json: { device_code: code.json.device_code },
    });
    check(
      'polling before approval answers pending',
      pending.status === 202 && pending.json?.pending === true,
      `HTTP ${pending.status}`
    );
    const mb = await ensureBrowser(member);
    await mb.open(code.json.verification_url);
    const consent = await mb.until((s) =>
      /Maude Studio on darwin wants to use your account/.test(s.text)
    );
    check(
      'the person sees which app is asking, in the browser',
      consent.ok,
      consent.text.match(/Maude Studio.{0,60}/)?.[0] ?? consent.text.slice(0, 100)
    );
    await mb.click('form[action="/activate"] button[type=submit]');
    const approved = await mb.until((s) => /You(’|')re signed in/.test(s.text));
    check(
      'approving in the browser says the app is signed in',
      approved.ok,
      approved.text.match(/You.re signed in.{0,60}/)?.[0] ?? approved.text.slice(0, 120)
    );
    const tok = await app.post(`${C()}/auth/device/token`, {
      json: { device_code: code.json.device_code },
    });
    need(
      'POST /auth/device/token then returns a personal token for that person',
      tok.status === 200 &&
        /^mpt_/.test(tok.json?.token ?? '') &&
        tok.json.account?.email === member.email,
      `HTTP ${tok.status} account=${tok.json?.account?.email}`
    );
    member.token = tok.json.token;
    const burnt = await app.post(`${C()}/auth/device/token`, {
      json: { device_code: code.json.device_code },
    });
    check('the device code is single-use', burnt.status === 400, `HTTP ${burnt.status}`);
    const list = await app.get(`${C()}/api/projects`, { headers: bearer(member.token) });
    check(
      'GET /api/projects lists the shared project with the member role',
      list.json?.projects?.some((p) => p.id === PROJECT.id && p.role === 'member'),
      JSON.stringify(list.json?.projects ?? list.json).slice(0, 140)
    );
    const named = await app.post(`${C()}/api/projects/${PROJECT.id}/token`, {
      json: {},
      headers: bearer(member.token),
    });
    const cred = await hubCredential(member.token, PROJECT.id);
    check(
      'the project token comes from POST /projects/open (POST /api/projects/:id/token does not exist) and the cell exchanges it',
      named.status !== 200 &&
        !named.json?.token &&
        cred.opened.status === 200 &&
        cred.login?.status === 200 &&
        cred.login.json?.user?.email === member.email,
      `/api/projects/:id/token → ${named.status}; /projects/open → ${cred.opened.status}; cell /auth/login → ${cred.login?.status} role=${cred.login?.json?.user?.role}`
    );

    // ---- download into a fresh folder, the way the app does
    const mDesk = await startDesk('member', PROJECT.name);
    const mSign = await deskSignIn(mDesk, async (_code, url) => {
      await mb.open(url);
      await mb.until((s) => /wants to use your account/.test(s.text));
      await mb.click('form[action="/activate"] button[type=submit]');
      await mb.until((s) => /You(’|')re signed in/.test(s.text));
    });
    need(
      'the studio server signs in with the device flow (approved in the member’s browser)',
      mSign.pending?.pending === true &&
        mSign.done?.ok === true &&
        mSign.done.email === member.email,
      JSON.stringify(mSign.done)
    );
    const mProjects = await mDesk.client.get(`${mDesk.base}/_api/cloud/projects`);
    check(
      'its project list shows the cloud project',
      mProjects.json?.projects?.some((p) => p.id === PROJECT.id),
      JSON.stringify(mProjects.json?.projects ?? mProjects.json).slice(0, 120)
    );
    const attach = await mDesk.client.post(`${mDesk.base}/_api/cloud/attach`, {
      json: { project: PROJECT.id },
    });
    need(
      'attaching links the folder to the project as the member',
      attach.json?.ok === true && attach.json.role === 'member' && attach.json.url === cell,
      attach.text.slice(0, 160)
    );
    const seed = join(mDesk.design, 'ui/welcome.tsx');
    const down = await waitFor(() => fileHas(seed, 'seeded by the local cell stand-in'), {
      timeoutMs: 45_000,
    });
    need(
      'the project downloads into the fresh folder',
      down.ok,
      down.ok ? `ui/welcome.tsx arrived in ${down.ms} ms` : mDesk.log().slice(-300)
    );
    check(
      'the hub credential is stored outside the project, the folder only names the hub',
      Boolean(mDesk.hubsJson()?.hubs?.[cell]?.token) &&
        JSON.parse(readFileSync(join(mDesk.design, 'config.json'), 'utf8')).linkedHub?.url ===
          cell &&
        !readFileSync(join(mDesk.design, 'config.json'), 'utf8').includes('mau_'),
      `hubs.json has ${Object.keys(mDesk.hubsJson()?.hubs ?? {}).length} hub(s)`
    );

    // ---- the owner's own checkout
    const oDesk = await startDesk('owner', PROJECT.name);
    const oSign = await deskSignIn(oDesk, async (userCode) => {
      await owner.client.post(`${C()}/activate`, { form: { code: userCode } });
    });
    const oAttach = await oDesk.client.post(`${oDesk.base}/_api/cloud/attach`, {
      json: { project: PROJECT.id },
    });
    need(
      'the owner links a second folder',
      oSign.done?.ok === true && oAttach.json?.ok === true && oAttach.json.role === 'owner',
      oAttach.text.slice(0, 140)
    );
    const oSeed = join(oDesk.design, 'ui/welcome.tsx');
    const oDown = await waitFor(() => fileHas(oSeed, 'seeded by the local cell stand-in'), {
      timeoutMs: 45_000,
    });
    need('the owner’s folder receives the project too', oDown.ok, `${oDown.ms} ms`);
    await sleep(2500); // both peers settle on the same document before the first edit

    // ---- member → owner
    const m1 = `member-edit-${RUN_ID}`;
    writeFileSync(
      seed,
      readFileSync(seed, 'utf8').replace(
        '<h1>Welcome</h1>',
        `<h1>Welcome</h1>\n      <p data-edit="member">${m1}</p>`
      )
    );
    const toOwner = await waitFor(() => fileHas(oSeed, m1), { timeoutMs: 60_000 });
    check(
      'the member’s canvas edit arrives in the owner’s folder',
      toOwner.ok,
      toOwner.ok
        ? `${toOwner.ms} ms`
        : `not after ${toOwner.ms} ms · ${mDesk.log().split('\n').slice(-4).join(' | ').slice(0, 200)}`
    );
    const atCell = await waitFor(
      () => fileHas(join(stack.cellDir(PROJECT.id), 'repo/.design/ui/welcome.tsx'), m1),
      { timeoutMs: 30_000 }
    );
    check('…and in the project’s own checkout in the cloud', atCell.ok, `${atCell.ms} ms`);

    // ---- owner → member
    const o1 = `owner-edit-${RUN_ID}`;
    writeFileSync(
      oSeed,
      readFileSync(oSeed, 'utf8').replace(
        '<h1>Welcome</h1>',
        `<h1>Welcome</h1>\n      <p data-edit="owner">${o1}</p>`
      )
    );
    const toMember = await waitFor(() => fileHas(seed, o1), { timeoutMs: 60_000 });
    check(
      'the owner’s edit arrives in the member’s folder',
      toMember.ok,
      toMember.ok ? `${toMember.ms} ms` : `not after ${toMember.ms} ms`
    );
    check(
      'both edits survive on both sides',
      fileHas(seed, m1) && fileHas(seed, o1) && fileHas(oSeed, m1) && fileHas(oSeed, o1),
      `member has m=${fileHas(seed, m1)} o=${fileHas(seed, o1)}; owner has m=${fileHas(oSeed, m1)} o=${fileHas(oSeed, o1)}`
    );

    // ---- Changes: the edits just made, on the owner's dashboard after a sweep
    // The cell counts changes and reports them in its tenant stats; the hourly
    // sweep stores what it reports. A hub that does not report the field yet
    // must leave the dashboard with NO Changes tile (unknown is not zero).
    await stack.cron();
    const changesRow = (await stack.d1('SELECT changes FROM projects WHERE id = ?', PROJECT.id))[0]
      ?.changes;
    const dashHtml = (await owner.client.get(`${C()}/`)).text;
    const dashText = textOf(dashHtml);
    const tile = dashText.match(/Changes\s+(\d+)\s+this week[^.]{0,60}/);
    const barCount = (dashHtml.match(/<span class="bar/g) ?? []).length;
    if (changesRow) {
      const stored = JSON.parse(changesRow);
      const reportedWeek =
        stored.week ?? stored.byDay.slice(-7).reduce((n, d) => n + Number(d.count), 0);
      check(
        'the dashboard shows the Changes the cell reported for this week, with the 30-day chart',
        Boolean(tile) &&
          Number(tile[1]) === reportedWeek &&
          barCount === 30 &&
          !/<script/i.test(dashHtml),
        `${tile?.[0] ?? 'no Changes tile'} · ${barCount} bars · the cell reported week=${stored.week}`
      );
      // EXACT, not "at least one". One change = one accepted save of a canvas
      // (one committed action in the project store). Up to this sweep the
      // project has had exactly three: the seed canvas `ui/welcome.tsx` being
      // created through the cell's own studio, the member's edit, the owner's
      // edit. Each was relayed to the other desktop and written into the
      // cell's checkout — neither of which is a second change. (On 2026-11-25
      // the same run read 0, then 1, then 3: first the count ignored the
      // project store, then it was a minute stale. apps/hub/src/change-stats.mjs.)
      const EXPECTED_CHANGES = 3;
      check(
        `the cell counted exactly ${EXPECTED_CHANGES} changes: the seed canvas created + the member's edit + the owner's edit`,
        Number(tile?.[1]) === EXPECTED_CHANGES && reportedWeek === EXPECTED_CHANGES,
        `dashboard shows ${tile?.[1]}; the cell reported week=${stored.week}, today=${stored.byDay?.at?.(-1)?.count}`
      );
    } else {
      check(
        'the cell does not report changes yet, so the dashboard shows no Changes tile and no chart',
        !tile && barCount === 0,
        `projects.changes is NULL after the sweep (the hub side of changesByDay / changesWeek is not in this tree yet); tile=${Boolean(tile)} bars=${barCount}`
      );
    }

    // ---- Can view is refused on write
    // Can view cannot be invited while no workspace holds it (C4), so this is a
    // person who already has the role: joined as Can comment, then the row is
    // set to what an existing Can view member's row says.
    const looker = await ensureInvited(owner, PROJECT.id, person('looker'), 'viewer');
    await stack.d1(
      "UPDATE project_members SET role = 'observer' WHERE project_id = ? AND account_id = ?",
      PROJECT.id,
      looker.accountId
    );
    await signIn(looker);
    looker.token ??= await deviceToken(looker);
    const undeclared = await hubCredential(looker.token, PROJECT.id);
    const declared = await hubCredential(looker.token, PROJECT.id, { declare: true });
    check(
      'a Can view account gets no sync credential for a folder: 426 undeclared, 409 browser-door declared',
      undeclared.opened.status === 426 &&
        declared.opened.status === 409 &&
        declared.opened.json?.reason === 'browser-door',
      `undeclared → ${undeclared.opened.status}; declared → ${declared.opened.status} ${declared.opened.json?.reason}`
    );
    // Can comment is the look-only role a cell holds today: a credential, and no write.
    const commenter = await ensureInvited(owner, PROJECT.id, person('reader'), 'viewer');
    await signIn(commenter);
    commenter.token ??= await deviceToken(commenter);
    const cCred = await hubCredential(commenter.token, PROJECT.id, { declare: true });
    const cellUi = join(stack.cellDir(PROJECT.id), 'repo', DESIGN_DIR, 'system', 'e2e');
    const put = (client, headers, name) =>
      client.request('PUT', `${cell}/api/file/system/e2e/${name}`, {
        body: ':root { --e2e: 1; }\n',
        headers: { 'content-type': 'text/css', 'x-maude-format': '2', ...headers },
      });
    const cRead = cCred.hubToken ? await probeJournal(cell, cCred.hubToken) : { status: 0 };
    const cWrite = cCred.hubToken
      ? await put(new Client('w'), bearer(cCred.hubToken), `commenter-${RUN_ID}.css`)
      : {
          status: 0,
          text: `no credential: /projects/open → ${cCred.opened.status} ${JSON.stringify(cCred.opened.json ?? {}).slice(0, 80)}`,
        };
    await cellDoor(commenter, PROJECT.id);
    const cBrowserWrite = await put(
      commenter.client,
      { origin: cell, 'sec-fetch-site': 'same-origin' },
      `commenter-b-${RUN_ID}.css`
    );
    const landed = ['commenter', 'commenter-b'].some((n) =>
      existsSync(join(cellUi, `${n}-${RUN_ID}.css`))
    );
    check(
      'a look-only member can read, and every write is refused',
      cRead.status === 200 &&
        [401, 403].includes(cWrite.status) &&
        [401, 403].includes(cBrowserWrite.status) &&
        !landed,
      `role=${cCred.login?.json?.user?.role}; read HTTP ${cRead.status}; PUT with their credential → HTTP ${cWrite.status} ${String(cWrite.text).slice(0, 70)}; PUT from their browser session → HTTP ${cBrowserWrite.status}; file on disk=${landed}`
    );
    const memberWrite = await put(new Client('m'), bearer(cred.hubToken), `note-${RUN_ID}.css`);
    check(
      'the same write with the member’s credential is accepted (the control for the refusal)',
      memberWrite.status >= 200 && memberWrite.status < 300,
      `HTTP ${memberWrite.status} ${memberWrite.text.slice(0, 80)}`
    );

    // ---- removal: sessions and sync stop within seconds
    const mHub = mDesk.hubsJson().hubs[cell].token;
    const probe = (token) => probeJournal(cell, token);
    const alive = await probe(mHub);
    const mbCell = await openMemberCell(member);
    const removedAt = Date.now();
    const rm = await owner.client.post(`${C()}/projects/${PROJECT.id}/people`, {
      form: { do: 'remove', account: member.accountId, sure: 'yes' },
    });
    const still = await stack.d1(
      'SELECT 1 AS x FROM project_members WHERE project_id = ? AND account_id = ?',
      PROJECT.id,
      member.accountId
    );
    need(
      'the owner removes the member',
      (rm.status === 303 || rm.status === 200) && still.length === 0,
      `HTTP ${rm.status}; membership rows=${still.length}`
    );
    const dead = await waitFor(async () => (await probe(mHub)).status === 401, {
      timeoutMs: 20_000,
      everyMs: 400,
    });
    check(
      'the removed member’s sync credential stops working within seconds',
      alive.status === 200 && dead.ok,
      `before HTTP ${alive.status}; refused ${Date.now() - removedAt} ms after the removal`
    );
    const deadApp = await waitFor(async () => (await probe(cred.hubToken)).status === 401, {
      timeoutMs: 10_000,
    });
    check('…and so does the credential their app minted earlier', deadApp.ok, `${deadApp.ms} ms`);
    const browserDead = await waitFor(
      async () => {
        const r = await mbCell.eval(
          "fetch('/auth/session', { credentials: 'include' }).then((r) => JSON.stringify({ status: r.status }))"
        );
        return r && r.status !== 200 ? r : null;
      },
      { timeoutMs: 15_000 }
    );
    check(
      '…and their browser session at the project',
      browserDead.ok,
      `GET /auth/session → HTTP ${browserDead.value?.status}`
    );
    const reopen = await hubCredential(member.token, PROJECT.id);
    check(
      'they cannot open the project again',
      reopen.opened.status === 404,
      `POST /projects/open → HTTP ${reopen.opened.status}`
    );
    const m2 = `after-removal-${RUN_ID}`;
    writeFileSync(
      seed,
      readFileSync(seed, 'utf8').replace('<h1>Welcome</h1>', `<h1>Welcome</h1>\n      <p>${m2}</p>`)
    );
    await sleep(12_000);
    check(
      'an edit they make afterwards reaches nobody',
      !fileHas(oSeed, m2) &&
        !fileHas(join(stack.cellDir(PROJECT.id), 'repo/.design/ui/welcome.tsx'), m2),
      `owner has it=${fileHas(oSeed, m2)}; cloud has it=${fileHas(join(stack.cellDir(PROJECT.id), 'repo/.design/ui/welcome.tsx'), m2)}`
    );
    const o2 = `owner-after-${RUN_ID}`;
    writeFileSync(
      oSeed,
      readFileSync(oSeed, 'utf8').replace(
        '<h1>Welcome</h1>',
        `<h1>Welcome</h1>\n      <p>${o2}</p>`
      )
    );
    await sleep(12_000);
    check(
      '…and the owner’s later edits no longer reach their folder',
      !fileHas(seed, o2),
      `member has it=${fileHas(seed, o2)}`
    );
    for (const d of [mDesk, oDesk]) d.stop();
  },
};
const probeJournal = (cell, token) =>
  new Client('p').get(`${cell}/api/journal?since=0`, { headers: bearer(token) });
/** The member's browser, signed in at the project (for the removal check). */
async function openMemberCell(member) {
  const b = await ensureBrowser(member);
  await b.open(`${stack.cellUrl(PROJECT.id)}/`);
  await waitFor(
    async () => {
      const s = await studioState(b);
      return s && typeof s === 'object' && s.root > 0;
    },
    { timeoutMs: 45_000, everyMs: 700 }
  );
  return b;
}

/** Fill and submit one operator action form (`action` is the form's own path). */
async function operatorPost(op, pagePath, actionPath, fields) {
  const page = await op.client.get(`${C()}${pagePath}`);
  const form = hiddenFields(page.text, new RegExp(`^${actionPath.replace(/[/.]/g, '\\$&')}$`));
  if (!form)
    return {
      status: 0,
      text: `no form ${actionPath} on ${pagePath} (HTTP ${page.status})`,
      location: null,
      hidden: {},
    };
  const r = await op.client.post(`${C()}${actionPath}`, { form: { ...form.fields, ...fields } });
  return { ...r, hidden: form.fields };
}

scenarios.C7 = {
  title:
    'operator: 404 for others, free time, pause/wake, Promo, new project for an e-mail, move, sign out everywhere',
  async run() {
    const owner = await ensureAccount(person('owner'));
    await signIn(owner);
    const op = await ensureOperator();
    await signIn(op);

    // ---- nobody else
    const paths = [
      '/operator',
      '/operator/accounts',
      '/operator/projects',
      '/operator/new-project',
      `/operator/accounts/${owner.accountId}`,
    ];
    const asOwner = await Promise.all(paths.map((p) => owner.client.get(`${C()}${p}`)));
    const asNobody = await Promise.all(paths.map((p) => new Client('anon').get(`${C()}${p}`)));
    check(
      'a signed-in account that is not an operator gets 404 on every /operator page',
      asOwner.every((r) => r.status === 404),
      asOwner.map((r) => r.status).join(' ')
    );
    check(
      'a signed-out visitor gets a plain 404 too',
      asNobody.every((r) => r.status === 404),
      asNobody.map((r) => r.status).join(' ')
    );
    owner.token ??= await deviceToken(owner);
    op.token ??= await deviceToken(op);
    const viaToken = await new Client('app').get(`${C()}/operator`, {
      headers: bearer(op.token),
    });
    check(
      'the operator’s device token alone does not open /operator',
      viaToken.status === 404,
      `HTTP ${viaToken.status}`
    );

    // ---- a project for a brand-new address, no checkout
    const friend = person('friend');
    const P = { id: `friend-${RUN_ID}`, name: `Friend ${RUN_ID}` };
    const made = await operatorPost(op, '/operator/new-project', '/operator/new-project', {
      owner: friend.email,
      name: P.name,
      plan: 'trial',
      tier: 'project',
      ends: '',
      invites: '',
      reason: 'e2e: a project for a friend',
    });
    let row = await projectRow(P.id);
    need(
      'the operator creates a project for a brand-new e-mail with no checkout',
      (made.status === 303 || made.status === 200) &&
        row?.state === 'active' &&
        row.subscription_id === null,
      `HTTP ${made.status} → ${made.location ?? textOf(made.text).slice(0, 140)}; state=${row?.state}`
    );
    friend.accountId = await accountIdOf(friend.email);
    check(
      'the project belongs to a new account for that address',
      row.account_id === friend.accountId && Boolean(friend.accountId),
      `owner account=${row.account_id}`
    );
    check(
      'no Stripe checkout was opened for it',
      ![...stack.stripe.sessions.values()].some((s) => s.metadata.project_id === P.id),
      'no session'
    );
    const fMail = mailTo(friend.email);
    need(
      'that person gets exactly one mail',
      fMail.length === 1,
      `${fMail.length}: ${fMail.map((m) => m.subject).join(' | ')}`
    );
    const again = await operatorPost(op, '/operator/new-project', '/operator/new-project', {
      owner: friend.email,
      name: P.name,
      plan: 'trial',
      tier: 'project',
      ends: '',
      invites: '',
      reason: 'e2e: the same form again',
    });
    check(
      'submitting the same form again sends no second mail and makes no second project',
      mailTo(friend.email).length === 1 &&
        (
          await stack.d1(
            'SELECT COUNT(*) AS n FROM projects WHERE account_id = ?',
            friend.accountId
          )
        )[0].n === 1,
      `HTTP ${again.status}; mails=${mailTo(friend.email).length}`
    );

    // The person follows their one mail and signs in.
    const fLink = linkIn(fMail[0].text, /https:\/\/\S+/);
    const fb = browserOf(friend);
    await fb.open(fLink);
    let fPage = await fb.until((s) => s.text.length > 20);
    if (await fb.eval("JSON.stringify(Boolean(document.querySelector('input[name=password]')))")) {
      await fb.fill('input[name=password]', PASSWORD);
      if (
        await fb.eval("JSON.stringify(Boolean(document.querySelector('input[name=disclosure]')))")
      )
        await fb.checkBox('input[name=disclosure]');
      await fb.click('form button[type=submit]');
    }
    fPage = await fb.until((s) => s.text.includes(friend.email) && s.text.includes(P.name), {
      timeoutMs: 20_000,
    });
    need(
      'they sign in from that mail and see the project as theirs',
      fPage.ok,
      `${fLink.replace(/[?=].*/, '?…')} → ${fPage.url} · ${fPage.text.slice(0, 140)}`
    );
    friend.exists = true;
    friend.browserSignedIn = true;
    await signIn(friend);
    const fPeople = await friend.client.get(`${C()}/projects/${P.id}/people`);
    check(
      'they own it: the People page lists them as Owner',
      fPeople.status === 200 && /You\s+Owner/.test(textOf(fPeople.text)),
      `HTTP ${fPeople.status}`
    );
    const fHealth = await waitFor(
      async () => (await friend.client.get(`${stack.cellUrl(P.id)}/health`)).json?.ok === true,
      { timeoutMs: 70_000 }
    );
    check('its workspace answers', fHealth.ok, `${fHealth.ms} ms`);

    // ---- the account page + 30 days of free time
    const ob = await ensureBrowser(op);
    await ob.open(`${C()}/operator/accounts/${friend.accountId}`);
    const acct = await ob.until((s) => s.text.includes(friend.email) && s.text.includes(P.name));
    check(
      'the operator opens the account page: who, which projects',
      acct.ok,
      acct.text.match(new RegExp(`${friend.email.slice(0, 12)}.{0,120}`))?.[0] ??
        acct.text.slice(0, 120)
    );
    const before = (await projectRow(P.id)).trial_ends_at;
    const mailBefore = mailTo(friend.email).length;
    const free = await operatorPost(
      op,
      `/operator/accounts/${friend.accountId}`,
      `/operator/projects/${P.id}/free-time`,
      { days: '30', until: '', reason: 'e2e: thirty days on us' }
    );
    row = await projectRow(P.id);
    const added = (row.trial_ends_at - before) / DAY;
    need(
      'Give free time adds 30 days to the date the project is free until',
      free.status === 303 && Math.abs(added - 30) < 0.01,
      `HTTP ${free.status} → ${free.location}; +${added.toFixed(2)} days`
    );
    const freeMail = mailTo(friend.email).slice(mailBefore);
    check(
      'the owner is mailed about it, once',
      freeMail.length === 1,
      `${freeMail.length}: ${freeMail[0]?.subject}`
    );
    const newDate = new Date(row.trial_ends_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const fBilling = await friend.client.get(`${C()}/projects/${P.id}/billing`);
    check(
      'the owner’s billing page shows the new date',
      textOf(fBilling.text).includes(newDate),
      `${textOf(fBilling.text).match(/Free until.{0,40}/)?.[0]} (expected ${newDate})`
    );
    const retry = await op.client.post(`${C()}/operator/projects/${P.id}/free-time`, {
      form: { ...free.hidden, days: '30', until: '', reason: 'e2e: thirty days on us' },
    });
    const afterRetry = await projectRow(P.id);
    check(
      'sending the same form again adds nothing and mails nobody',
      afterRetry.trial_ends_at === row.trial_ends_at &&
        mailTo(friend.email).length === mailBefore + 1,
      `HTTP ${retry.status}; date unchanged=${afterRetry.trial_ends_at === row.trial_ends_at}; mails=${mailTo(friend.email).length - mailBefore}`
    );
    const logged = await stack.d1(
      "SELECT action, actor, reason FROM audit_log WHERE project_id = ? AND action LIKE 'operator.%' ORDER BY at",
      P.id
    );
    check(
      'the action is logged as the operator’s, with the reason',
      logged.some(
        (l) => l.action === 'operator.free-time.given' && /thirty days/.test(String(l.reason))
      ) && logged.filter((l) => l.action === 'operator.free-time.given').length === 1,
      logged.map((l) => `${l.action} by ${l.actor} (“${l.reason}”)`).join(', ')
    );

    // ---- pause → unreachable, with the right words → wake
    // This one from the operator's real browser: the reason typed in, the button clicked.
    const pauseAction = `/operator/projects/${P.id}/pause`;
    await ob.open(`${C()}/operator/projects/${P.id}`);
    await ob.click(`xpath=//details[.//form[@action="${pauseAction}"]]/summary`);
    await ob.fill(
      `form[action="${pauseAction}"] textarea[name=reason]`,
      'e2e: pausing for a check'
    );
    await ob.click(`form[action="${pauseAction}"] button[type=submit]`);
    const pausedInBrowser = await ob.until(
      (s) => /done=paused/.test(s.url) || !new RegExp(`/operator/projects/${P.id}$`).test(s.url),
      { timeoutMs: 15_000 }
    );
    check(
      'the operator’s Pause form works from a real browser',
      /done=paused/.test(pausedInBrowser.url),
      `${pausedInBrowser.url} · ${pausedInBrowser.text.slice(0, 120)}`
    );
    const paused = /done=paused/.test(pausedInBrowser.url)
      ? { status: 303, location: pausedInBrowser.url }
      : await operatorPost(op, `/operator/projects/${P.id}`, pauseAction, {
          reason: 'e2e: pausing for a check',
        });
    row = await projectRow(P.id);
    need(
      'Pause is accepted',
      paused.status === 303,
      `HTTP ${paused.status} → ${paused.location ?? textOf(paused.text).slice(0, 120)}; state=${row.state}`
    );
    const down = await waitFor(
      async () => !stack.cf.domains.has(`${P.id}.${stack.zone}`) && !stack.cells.has(P.id),
      { timeoutMs: 15_000 }
    );
    const unreachable = await friend.client.get(`${stack.cellUrl(P.id)}/health`);
    check(
      'the workspace is stopped and its address is down',
      down.ok && unreachable.status !== 200,
      `domain attached=${stack.cf.domains.has(`${P.id}.${stack.zone}`)} cell running=${stack.cells.has(P.id)}; GET /health → HTTP ${unreachable.status}`
    );
    const fDash = textOf((await friend.client.get(`${C()}/`)).text);
    const fBill2 = textOf((await friend.client.get(`${C()}/projects/${P.id}/billing`)).text);
    check(
      'the owner is told it is paused by Maude, not that they must pay',
      /paused/i.test(fDash) &&
        /paused/i.test(fBill2) &&
        !/Choose a plan to keep editing/.test(fDash),
      `dashboard: ${fDash.match(new RegExp(`${P.name}.{0,110}`))?.[0]} · billing: ${fBill2.match(/.{0,40}[Pp]aused.{0,80}/)?.[0]}`
    );
    friend.token ??= await deviceToken(friend);
    const openPaused = await hubCredential(friend.token, P.id);
    check(
      'the control plane mints no project token while it is paused, and says it is paused',
      openPaused.opened.status === 409 &&
        !openPaused.opened.json?.token &&
        /paused/i.test(openPaused.opened.json?.error ?? ''),
      `POST /projects/open → HTTP ${openPaused.opened.status} ${JSON.stringify(openPaused.opened.json ?? {}).slice(0, 120)}`
    );
    const projPage = await op.client.get(`${C()}/operator/projects/${P.id}`);
    const wakeAction = [...projPage.text.matchAll(/<form[^>]*action="([^"]*)"/g)]
      .map((m) => m[1])
      .find((a) => /wake|resume|unpause/.test(a));
    const woke = wakeAction
      ? await operatorPost(op, `/operator/projects/${P.id}`, wakeAction, {
          reason: 'e2e: waking it again',
        })
      : { status: 0, text: 'no wake form on the project page' };
    const up = await waitFor(
      async () => (await friend.client.get(`${stack.cellUrl(P.id)}/health`)).json?.ok === true,
      { timeoutMs: 70_000 }
    );
    row = await projectRow(P.id);
    need(
      'Wake brings the address and the workspace back',
      woke.status === 303 && up.ok && row.state === 'active',
      `${wakeAction ?? 'no wake form'} → HTTP ${woke.status}; state=${row.state}; /health ok=${up.ok}`
    );

    // ---- Promo, and a trial sweep that must not pause it
    const promo = await operatorPost(
      op,
      `/operator/projects/${P.id}`,
      `/operator/projects/${P.id}/promo`,
      {
        tier: 'project',
        ends: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10),
        reason: 'e2e: a friend of the house',
      }
    );
    row = await projectRow(P.id);
    need(
      'Mark as Promo is accepted',
      promo.status === 303 && row.promo_since != null,
      `HTTP ${promo.status} → ${promo.location ?? textOf(promo.text).slice(0, 120)}; promo_since=${row.promo_since}`
    );
    const pDash = textOf((await friend.client.get(`${C()}/`)).text);
    const pBill = textOf((await friend.client.get(`${C()}/projects/${P.id}/billing`)).text);
    const pAcct = textOf((await friend.client.get(`${C()}/account/billing`)).text);
    check(
      'the dashboard and both billing pages say Promo',
      /Promo/.test(pDash) && /Promo/.test(pBill) && /Promo/.test(pAcct),
      `dashboard: ${pDash.match(new RegExp(`${P.name}.{0,80}`))?.[0]} · billing: ${pBill.match(/.{0,30}Promo.{0,60}/)?.[0]}`
    );
    // The clock, moved: the trial date this project once had is now in the past.
    await stack.d1(
      'UPDATE projects SET trial_ends_at = ? WHERE id = ? AND trial_ends_at IS NOT NULL',
      Date.now() - 2 * DAY,
      P.id
    );
    await stack
      .d1(
        'UPDATE accounts SET trial_ends_at = ? WHERE id = ? AND trial_ends_at IS NOT NULL',
        Date.now() - 2 * DAY,
        friend.accountId
      )
      .catch(() => {});
    const startsBefore = stack.cellStarts.get(P.id) ?? 0;
    await stack.cron();
    await stack.cron();
    row = await projectRow(P.id);
    const pausedAudit = await stack.d1(
      "SELECT COUNT(*) AS n FROM audit_log WHERE project_id = ? AND action = 'do.plan-paused'",
      P.id
    );
    const cfg = await new Client('cell').get(`${C()}/internal/cell-config?tenant=${P.id}`, {
      headers: bearer(await stack.cellSecret(P.id)),
    });
    const writeOk = await friendWrite(friend, P.id);
    check(
      'a trial sweep past the old trial date does not pause a Promo project',
      row.state === 'active' &&
        pausedAudit[0].n === 0 &&
        cfg.json?.planState !== 'paused' &&
        stack.cells.has(P.id) &&
        (stack.cellStarts.get(P.id) ?? 0) === startsBefore &&
        writeOk.ok,
      `state=${row.state}; do.plan-paused rows=${pausedAudit[0].n}; cell-config planState=${cfg.json?.planState}; cell restarts=${(stack.cellStarts.get(P.id) ?? 0) - startsBefore}; owner write → HTTP ${writeOk.status}`
    );

    // ---- a paid plan starting ends Promo
    await fb.open(`${C()}/`);
    const pay = await toCheckout(friend, fb, P.id);
    need(
      'the Promo project’s owner can Choose a plan',
      pay.ok,
      `${pay.url} ${pay.text?.slice(0, 80)}`
    );
    await payWith(fb, CARD_OK);
    const paid = await fb.until((s) => new RegExp(`/projects/${P.id}/billing`).test(s.url), {
      timeoutMs: 40_000,
    });
    row = await projectRow(P.id);
    const promoEnded = await stack.d1(
      "SELECT detail FROM audit_log WHERE project_id = ? AND action = 'promo.ended'",
      P.id
    );
    check(
      'a paid plan starting ends Promo: subscription attached, Promo cleared, audited',
      paid.ok &&
        /^sub_/.test(String(row.subscription_id)) &&
        row.promo_since === null &&
        promoEnded.length === 1 &&
        !/Promo/.test(paid.text.replace(/promo\.ended/g, '')),
      `sub=${row.subscription_id} promo_since=${row.promo_since} promo.ended rows=${promoEnded.length}`
    );

    // ---- move a project to another owner
    // A paid project is not offered for a move (its plan is the old owner's at
    // Stripe), so the move is made on a second project the operator starts.
    const P2 = { id: `handover-${RUN_ID}`, name: `Handover ${RUN_ID}` };
    const paidPage = await op.client.get(`${C()}/operator/projects/${P.id}`);
    check(
      'a project with a paid plan has no Move form',
      !paidPage.text.includes(`/operator/projects/${P.id}/move"`),
      `move form on the paid project page=${paidPage.text.includes(`/operator/projects/${P.id}/move"`)}`
    );
    const made2 = await operatorPost(op, '/operator/new-project', '/operator/new-project', {
      owner: friend.email,
      name: P2.name,
      plan: 'trial',
      tier: 'project',
      ends: '',
      invites: '',
      reason: 'e2e: a project to hand over',
    });
    row = await projectRow(P2.id);
    need(
      'the operator starts a second project for the same person',
      row?.state === 'active' && row.account_id === friend.accountId,
      `HTTP ${made2.status} → ${made2.location ?? textOf(made2.text).slice(0, 140)}; state=${row?.state}`
    );
    const moved = await operatorPost(
      op,
      `/operator/projects/${P2.id}`,
      `/operator/projects/${P2.id}/move`,
      { to: owner.email, reason: 'e2e: handing it over' }
    );
    row = await projectRow(P2.id);
    need(
      'Move to another owner is accepted',
      moved.status === 303 && row.account_id === owner.accountId,
      `HTTP ${moved.status} → ${moved.location ?? textOf(moved.text).slice(0, 140)}; owner account now ${row.account_id === owner.accountId ? 'the new owner' : row.account_id}`
    );
    const newOwnerDash = textOf((await owner.client.get(`${C()}/`)).text);
    const newOwnerBilling = await owner.client.get(`${C()}/projects/${P2.id}/billing`);
    const oldOwnerBilling = await friend.client.get(`${C()}/projects/${P2.id}/billing`);
    const oldRole = await stack.d1(
      'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
      P2.id,
      friend.accountId
    );
    check(
      'the new owner has it (dashboard + billing); the old owner no longer has billing',
      newOwnerDash.includes(P2.name) &&
        newOwnerBilling.status === 200 &&
        oldOwnerBilling.status === 404,
      `new owner billing HTTP ${newOwnerBilling.status}; old owner billing HTTP ${oldOwnerBilling.status}; old owner is now ${oldRole[0]?.role ?? 'not a member'}`
    );
    const movedMail = stack.mail.filter(
      (m) => m.at > Date.now() - 20_000 && /hand|moved|owner/i.test(m.subject)
    );
    say(
      `      (mail after the move: ${movedMail.map((m) => `${m.to}: ${m.subject}`).join(' | ') || 'none'})`
    );

    // ---- Make owner: the owner OFFERS in their browser, the recipient ACCEPTS in theirs
    // (P2 now belongs to `owner`; `friend`, its previous owner, is on it as Can edit.)
    const obr = await ensureBrowser(owner);
    await obr.open(`${C()}/account/people`);
    const offerBtn = `xpath=//form[.//input[@name="project" and @value="${P2.id}"] and .//input[@name="account" and @value="${friend.accountId}"]]//button[@value="transfer-offer"]`;
    await obr.click(
      `xpath=//details[.//input[@name="project" and @value="${P2.id}"] and .//input[@name="account" and @value="${friend.accountId}"]]/summary`
    );
    const offered = await submitInBrowser(owner, obr, {
      label: 'Offer to make them the owner',
      action: '/account/people',
      click: offerBtn,
      done: (x) => /done=offered/.test(x.url),
    });
    row = await projectRow(P2.id);
    const offerMail = mailTo(friend.email, /owner of/i);
    check(
      'the offer changes nothing by itself, and the recipient is mailed',
      offered.ok && row.account_id === owner.accountId && offerMail.length === 1,
      `owner still ${row.account_id === owner.accountId ? 'the offerer' : row.account_id}; mails=${offerMail.length}: ${offerMail[0]?.subject}`
    );
    await fb.open(`${C()}/account/people`);
    const seesOffer = await fb.until((x) => x.text.includes(`owner of ${P2.name}`));
    check(
      'the recipient sees the offer on their People page',
      seesOffer.ok,
      seesOffer.text.slice(0, 160)
    );
    const accepted = await submitInBrowser(friend, fb, {
      label: 'Become the owner',
      action: '/account/people',
      click: 'xpath=//form[.//input[@name="do" and @value="transfer-accept"]]//button',
      done: (x) => /done=accepted/.test(x.url),
    });
    row = await projectRow(P2.id);
    const exOwner = await stack.d1(
      'SELECT role FROM project_members WHERE project_id = ? AND account_id = ?',
      P2.id,
      owner.accountId
    );
    check(
      'accepting makes them the owner; the previous owner stays on it as Can edit',
      accepted.ok && row.account_id === friend.accountId && exOwner[0]?.role === 'member',
      `owner=${row.account_id === friend.accountId ? 'the recipient' : row.account_id}; previous owner role=${exOwner[0]?.role}`
    );

    // ---- sign an account out everywhere
    const sessionBefore = await friend.client.get(`${C()}/auth/session`);
    const tokenBefore = await new Client('app').get(`${C()}/api/projects`, {
      headers: bearer(friend.token),
    });
    const out = await operatorPost(
      op,
      `/operator/accounts/${friend.accountId}`,
      `/operator/accounts/${friend.accountId}/sign-out`,
      { reason: 'e2e: sign out everywhere' }
    );
    const sessionAfter = await friend.client.get(`${C()}/auth/session`);
    const tokenAfter = await new Client('app').get(`${C()}/api/projects`, {
      headers: bearer(friend.token),
    });
    check(
      'Sign out everywhere redirects with done=signed-out',
      out.status === 303 && /done=signed-out/.test(out.location ?? ''),
      `HTTP ${out.status} → ${out.location}`
    );
    check(
      'the account’s browser session is dead',
      sessionBefore.status === 200 && sessionAfter.status === 401,
      `GET /auth/session ${sessionBefore.status} → ${sessionAfter.status}`
    );
    check(
      '…and so is its device token',
      tokenBefore.status === 200 && tokenAfter.status === 401,
      `GET /api/projects ${tokenBefore.status} → ${tokenAfter.status}`
    );
    await fb.open(`${C()}/account`);
    const kicked = await fb.until((s) => /\/login/.test(s.url) || /Sign in/.test(s.title ?? ''), {
      timeoutMs: 10_000,
    });
    check('…and the real browser is back at the sign-in page', kicked.ok, kicked.url);
    const opStill = await op.client.get(`${C()}/operator`);
    check(
      'the operator’s own session is untouched',
      opStill.status === 200,
      `HTTP ${opStill.status}`
    );
  },
};
/** One owner write at the project (PUT a small file with a fresh hub credential). */
async function friendWrite(p, projectId) {
  p.token ??= await deviceToken(p);
  const cred = await hubCredential(p.token, projectId);
  if (!cred.hubToken)
    return {
      ok: false,
      status: `open ${cred.opened.status}/login ${cred.login?.status}`,
      text: '',
    };
  const r = await new Client('w').request(
    'PUT',
    `${stack.cellUrl(projectId)}/api/file/system/e2e/probe-${Date.now()}.css`,
    {
      body: ':root { --e2e: 1; }\n',
      headers: {
        'content-type': 'text/css',
        'x-maude-format': '2',
        authorization: `Bearer ${cred.hubToken}`,
      },
    }
  );
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text, json: r.json };
}

scenarios.C8 = {
  title: 'trial runs out with no free time → paused → Choose a plan → pays → edits again',
  async run() {
    const t = await ensureAccount(person('trialer'));
    await signIn(t);
    t.token ??= await deviceToken(t);
    const P = { id: `trial-${RUN_ID}`, name: `Trial ${RUN_ID}` };
    const made = await new Client('app').post(`${C()}/api/projects`, {
      json: { name: P.name },
      headers: bearer(t.token),
    });
    need(
      'a trial project is provisioned',
      made.json?.project?.state === 'active' && made.json.project.plan === 'trial',
      `HTTP ${made.status} ${JSON.stringify(made.json?.project ?? made.json).slice(0, 120)}`
    );
    const before = await friendWrite(t, P.id);
    need(
      'inside the trial the owner can write',
      before.ok,
      `PUT /api/file → HTTP ${before.status} ${String(before.text).slice(0, 80)}`
    );
    const starts0 = stack.cellStarts.get(P.id) ?? 0;

    // The clock, moved past the end of the trial (workerd has no settable clock).
    const past = Date.now() - 3600_000;
    await stack.d1('UPDATE projects SET trial_ends_at = ? WHERE id = ?', past, P.id);
    await stack
      .d1('UPDATE accounts SET trial_ends_at = ? WHERE id = ?', past, t.accountId)
      .catch(() => {});
    await stack.cron();
    const audit = await stack.d1(
      "SELECT detail FROM audit_log WHERE project_id = ? AND action = 'do.plan-paused'",
      P.id
    );
    let row = await projectRow(P.id);
    need(
      'the sweep pauses the plan once (the cell is restarted, nothing is deleted)',
      audit.length === 1 && audit[0].detail === 'trial ended' && row.state === 'active',
      `do.plan-paused rows=${audit.length} (${audit[0]?.detail}); state=${row.state}`
    );
    const cfg = await new Client('cell').get(`${C()}/internal/cell-config?tenant=${P.id}`, {
      headers: bearer(await stack.cellSecret(P.id)),
    });
    check(
      'the control plane now tells the cell planState: paused',
      cfg.json?.planState === 'paused',
      `planState=${cfg.json?.planState}`
    );
    const refused = await friendWrite(t, P.id);
    check(
      'the restarted cell refuses the owner’s write with 402 plan',
      refused.status === 402 && (stack.cellStarts.get(P.id) ?? 0) > starts0,
      `PUT /api/file → HTTP ${refused.status} ${String(refused.text).slice(0, 100)}; cell starts ${starts0} → ${stack.cellStarts.get(P.id)}`
    );
    const read = await new Client('r').get(`${stack.cellUrl(P.id)}/health`);
    check(
      'reading still works — the address stays up',
      read.status === 200 && stack.cf.domains.has(`${P.id}.${stack.zone}`),
      `GET /health → HTTP ${read.status}`
    );
    await stack.cron();
    const audit2 = await stack.d1(
      "SELECT COUNT(*) AS n FROM audit_log WHERE project_id = ? AND action = 'do.plan-paused'",
      P.id
    );
    check(
      'the next sweep does not pause it a second time',
      audit2[0].n === 1,
      `${audit2[0].n} row(s)`
    );

    const b = await ensureBrowser(t);
    await b.open(`${C()}/`);
    const dash = await b.until((s) => s.text.includes(P.name));
    await b.open(`${C()}/projects/${P.id}/billing`);
    const bill = await b.until((s) => /Billing/.test(s.text));
    check(
      'the owner sees that the trial ended and Choose a plan',
      /Choose a plan/.test(bill.text) &&
        /(ended|paused|pick a plan|keep editing)/i.test(`${dash.text} ${bill.text}`),
      `dashboard: ${dash.text.match(new RegExp(`${P.name}.{0,110}`))?.[0]} · billing: ${bill.text.match(/Billing .{0,160}/)?.[0]}`
    );
    await b.shot('C8-trial-ended');

    const pay = await toCheckout(t, b, P.id);
    need('Choose a plan opens Checkout', pay.ok, pay.url);
    const startsPaused = stack.cellStarts.get(P.id) ?? 0;
    await payWith(b, CARD_OK);
    const paid = await b.until((s) => new RegExp(`/projects/${P.id}/billing`).test(s.url), {
      timeoutMs: 40_000,
    });
    row = await projectRow(P.id);
    need(
      'paying attaches the plan',
      paid.ok && /^sub_/.test(String(row.subscription_id)),
      `${paid.url}; sub=${row.subscription_id}`
    );
    const woke = await waitFor(
      async () => {
        const w = await friendWrite(t, P.id);
        return w.ok ? w : null;
      },
      { timeoutMs: 80_000, everyMs: 1500 }
    );
    const cfg2 = await new Client('cell').get(`${C()}/internal/cell-config?tenant=${P.id}`, {
      headers: bearer(await stack.cellSecret(P.id)),
    });
    check(
      'the cell is restarted unpaused and the owner can write again',
      woke.ok &&
        cfg2.json?.planState !== 'paused' &&
        (stack.cellStarts.get(P.id) ?? 0) > startsPaused,
      `PUT /api/file → HTTP ${woke.value?.status}; planState=${cfg2.json?.planState}; cell starts ${startsPaused} → ${stack.cellStarts.get(P.id)}`
    );
    await stack.cron();
    row = await projectRow(P.id);
    check(
      'the sweep after that leaves it active and paid',
      row.state === 'active' && /^sub_/.test(String(row.subscription_id)),
      `state=${row.state}`
    );
  },
};

/* --------------------------------------------------------------------- run */

let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const d of desks) d.stop();
  await Promise.all([...browsers].map((b) => b.close().catch(() => {})));
  if (stack) {
    const root = stack.root;
    await stack.stop({ keep: flag('keep') }).catch((err) => say(`stop: ${err.message}`));
    if (flag('keep')) say(`scratch kept: ${root}`);
  }
  killAll(stack?.root ?? null);
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
process.on('uncaughtException', (err) => {
  say(`uncaught: ${err.stack ?? err}`);
  shutdown(1);
});

scenarios.C9 = {
  title:
    'operator: People in this project, See it as the owner does (read only), Delete with Undo, the overview lists',
  async run() {
    const op = await ensureOperator();
    await signIn(op);
    const ob = await ensureBrowser(op);
    const nine = person('nine');
    const N = { id: `nine-${RUN_ID}`, name: `Nine ${RUN_ID}` };
    const made = await operatorPost(op, '/operator/new-project', '/operator/new-project', {
      owner: nine.email,
      name: N.name,
      plan: 'promo',
      tier: 'project',
      ends: '',
      invites: '',
      reason: 'e2e: a project for the C9 checks',
    });
    let row = await projectRow(N.id);
    need(
      'a Promo project exists for a new address',
      made.status === 303 && row?.state === 'active',
      `HTTP ${made.status}; state=${row?.state}`
    );
    nine.accountId = await accountIdOf(nine.email);

    // ---- People in this project — the form filled and clicked in the operator's browser
    const peopleUrl = `/operator/projects/${N.id}/people`;
    const invitee = person('nine-guest');
    await ob.open(`${C()}${peopleUrl}`);
    await ob.click('xpath=//details[.//input[@name="do" and @value="invite"]]/summary');
    const inviteForm = 'xpath=//form[.//input[@name="do" and @value="invite"]]';
    await ob.fill(`${inviteForm}//input[@name="email"]`, invitee.email);
    await ob.fill(`${inviteForm}//textarea[@name="reason"]`, 'e2e: support adds a colleague');
    await ob.click(`${inviteForm}//button[@type="submit"]`);
    const invitedPage = await ob.until((x) => /done=people-invite/.test(x.url), {
      timeoutMs: 15_000,
    });
    const invMail = mailTo(invitee.email, /invited you/i);
    const invLog = await stack.d1(
      "SELECT actor, reason FROM audit_log WHERE project_id = ? AND action = 'access.invite'",
      N.id
    );
    check(
      'the operator invites someone from People in this project, in a real browser',
      invitedPage.ok && invMail.length === 1 && invitedPage.text.includes(invitee.email),
      `${invitedPage.url}; mails=${invMail.length}`
    );
    check(
      'it is logged as the operator’s, with the reason — not as the owner’s',
      invLog.length === 1 &&
        invLog[0].actor === `operator:${op.email}` &&
        /support adds a colleague/.test(String(invLog[0].reason)),
      invLog.map((l) => `${l.actor} (“${l.reason}”)`).join(', ')
    );
    const inviteId = (
      await stack.d1(
        'SELECT id FROM project_invites WHERE project_id = ? AND email = ?',
        N.id,
        invitee.email
      )
    )[0]?.id;
    const cancelled = await operatorPost(op, peopleUrl, peopleUrl, {
      do: 'invite-cancel',
      invite: inviteId,
      reason: 'e2e: wrong address',
    });
    const ownerGone = await operatorPost(op, peopleUrl, peopleUrl, {
      do: 'remove',
      account: nine.accountId,
      reason: 'e2e: trying to remove the owner',
    });
    const stillOwner = await projectRow(N.id);
    check(
      'Cancel invite works; removing the owner is refused, as it is for the owner',
      /done=people-invite-cancel/.test(cancelled.location ?? '') &&
        /error=people-refused/.test(ownerGone.location ?? '') &&
        stillOwner.account_id === nine.accountId,
      `${cancelled.location} · ${ownerGone.location}`
    );

    // ---- See it as the owner does — read only
    const count = async (table) => (await stack.d1(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
    const before = [
      await count('sessions'),
      await count('personal_tokens'),
      await count('handoff_codes'),
    ];
    const startsBefore = stack.cellStarts.get(N.id) ?? 0;
    const viewBase = `/operator/accounts/${nine.accountId}/view`;
    await ob.open(`${C()}${viewBase}`);
    const dash = await ob.until((x) => /read only/.test(x.text) && x.text.includes(N.name));
    const inert = await ob.eval(
      "JSON.stringify({forms:document.querySelectorAll('form').length,live:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>!e.disabled).length})"
    );
    const inertNow = typeof inert === 'string' ? JSON.parse(inert) : inert;
    check(
      'the owner’s dashboard is shown with the read-only banner, no form and no live control',
      dash.ok && inertNow?.forms === 0 && inertNow?.live === 0,
      `${dash.text.match(/You are looking at this as .{0,60}/)?.[0]} · forms=${inertNow?.forms} live controls=${inertNow?.live}`
    );
    await ob.open(`${C()}${viewBase}/projects/${N.id}/billing`);
    const viewBilling = await ob.until((x) => /read only/.test(x.text) && /Promo/.test(x.text));
    check(
      '…and the owner’s billing page for the project',
      viewBilling.ok,
      viewBilling.text.slice(0, 140)
    );
    const viewPost = await operatorPostRaw(op, `${viewBase}/account/people`, {
      do: 'remove-all',
      sure: 'yes',
      people: nine.accountId,
      reason: 'e2e',
    });
    const closed = await Promise.all(
      [`/projects/${N.id}/connect`, `/projects/${N.id}/download`, '/account/macs'].map((x) =>
        op.client.get(`${C()}${viewBase}${x}`)
      )
    );
    const after = [
      await count('sessions'),
      await count('personal_tokens'),
      await count('handoff_codes'),
    ];
    check(
      'a POST under the view is 405; pages that open the project or hand out a credential are not in it',
      viewPost.status === 405 && closed.every((r) => r.status === 404),
      `POST → ${viewPost.status}; ${closed.map((r) => r.status).join(' ')}`
    );
    check(
      'no session, device token or hand-off code was made, and the workspace was not started',
      before.join() === after.join() && (stack.cellStarts.get(N.id) ?? 0) === startsBefore,
      `sessions/tokens/codes ${before.join('/')} → ${after.join('/')}; cell starts +${(stack.cellStarts.get(N.id) ?? 0) - startsBefore}`
    );
    await op.client.get(`${C()}${viewBase}`);
    await op.client.get(`${C()}${viewBase}`);
    const viewLog = await stack.d1(
      "SELECT detail FROM audit_log WHERE action = 'operator.account.viewed-as' AND account_id = ?",
      nine.accountId
    );
    check(
      'each page looked at is one log row, however often it is reloaded',
      viewLog.length === 2,
      `${viewLog.length} rows: ${viewLog.map((v) => JSON.parse(v.detail).page).join(', ')}`
    );

    // ---- Delete: never at once, with an Undo
    const delAction = `/operator/projects/${N.id}/delete`;
    const wrongName = await operatorPost(op, `/operator/projects/${N.id}`, delAction, {
      confirm: 'something else',
      reason: 'e2e: the wrong name',
    });
    await ob.open(`${C()}/operator/projects/${N.id}`);
    await ob.click(`xpath=//details[.//form[@action="${delAction}"]]/summary`);
    await ob.fill(`form[action="${delAction}"] input[name=confirm]`, N.id);
    await ob.fill(
      `form[action="${delAction}"] textarea[name=reason]`,
      'e2e: the owner asked for it'
    );
    await ob.click(`form[action="${delAction}"] button[type=submit]`);
    const scheduled = await ob.until((x) => /done=delete-scheduled/.test(x.url), {
      timeoutMs: 30_000,
    });
    row = await projectRow(N.id);
    const down = await waitFor(async () => !stack.cf.domains.has(`${N.id}.${stack.zone}`), {
      timeoutMs: 15_000,
    });
    const delMail = mailTo(nine.email, /will be deleted on/i);
    check(
      'a wrong typed name schedules nothing',
      /error=delete-confirm/.test(wrongName.location ?? ''),
      String(wrongName.location)
    );
    check(
      'Delete, from a real browser: paused and scheduled — the row is still there, nothing purged',
      scheduled.ok && row.state === 'suspended' && Number(row.delete_since) > 0 && down.ok,
      `state=${row.state} delete_since=${row.delete_since}; address down=${down.ok}`
    );
    check(
      'the owner is mailed the date and the way to their copy',
      delMail.length >= 1 && delMail[0].text.includes(`/projects/${N.id}/download`),
      `${delMail.length}: ${delMail[0]?.subject}`
    );
    const undone = await operatorPost(op, `/operator/projects/${N.id}`, `${delAction}/undo`, {
      reason: 'e2e: it was the wrong project',
    });
    row = await projectRow(N.id);
    const back = await waitFor(async () => stack.cf.domains.has(`${N.id}.${stack.zone}`), {
      timeoutMs: 30_000,
    });
    check(
      'Undo brings it back: running again, no deletion scheduled, the address is up',
      undone.status === 303 && row.state === 'active' && row.delete_since === null && back.ok,
      `HTTP ${undone.status} → ${undone.location}; state=${row.state}; address up=${back.ok}`
    );
    const ownerLog = await stack.d1(
      "SELECT action FROM audit_log WHERE project_id = ? AND action LIKE 'operator.project.delete%' ORDER BY at",
      N.id
    );
    check(
      'both steps are in the project’s log',
      ownerLog.map((l) => l.action).join() ===
        'operator.project.delete-scheduled,operator.project.delete-undone',
      ownerLog.map((l) => l.action).join(', ')
    );

    // ---- the overview's lists
    await ob.open(`${C()}/operator?tab=promo`);
    const promoTab = await ob.until(
      (x) => /Promo\s+\d+/.test(x.text) && x.text.includes(nine.email)
    );
    check(
      'the overview lists Promo accounts with a count, and Needs a look',
      promoTab.ok &&
        /Newest accounts\s+\d+/.test(promoTab.text) &&
        /Needs a look/.test(promoTab.text),
      promoTab.text.match(/Newest accounts.{0,120}/)?.[0] ?? promoTab.text.slice(0, 160)
    );
  },
};

/** A POST as the operator with their own token, to a path that has no form to read one from. */
async function operatorPostRaw(op, path, fields) {
  const page = await op.client.get(`${C()}/operator/accounts`);
  const any = await op.client.get(`${C()}/operator/new-project`);
  const csrf = hiddenFields(any.text, /new-project/)?.fields?.csrf ?? '';
  void page;
  return op.client.post(`${C()}${path}`, { form: { csrf, ...fields } });
}

async function main() {
  const unknown = ONLY ? [...ONLY].filter((id) => !scenarios[id]) : [];
  if (unknown.length) {
    say(`unknown scenario(s): ${unknown.join(', ')} — known: ${Object.keys(scenarios).join(', ')}`);
    process.exit(2);
  }
  say(`cloud-scenarios — run ${RUN_ID}`);
  stack = await startStack({ log: (s) => say(`[stack] ${s}`), verbose: flag('verbose') });
  say(
    `[stack] control plane ${stack.cloudUrl} · projects at https://<id>.${stack.zone} · scratch ${stack.root}`
  );

  for (const [id, scenario] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.has(id)) continue;
    current = { id, title: scenario.title, checks: [], error: null, started: Date.now() };
    results.push(current);
    say(`\n${id} — ${scenario.title}`);
    try {
      await newMinute();
      await scenario.run();
    } catch (err) {
      current.error = err;
      say(`    FAIL  ${String(err.message).slice(0, 400)}`);
      if (flag('verbose')) say(String(err.stack));
    }
    current.ms = Date.now() - current.started;
  }

  if (stack.unrouted.length) {
    say(
      `\nnote: the Worker tried ${stack.unrouted.length} outbound fetch(es) nothing local answers:`
    );
    for (const u of stack.unrouted.slice(0, 10)) say(`  ${u.method} ${u.url}`);
  }
  say('\n──────── summary');
  let failed = 0;
  for (const r of results) {
    const bad = r.checks.filter((c) => !c.ok);
    const ok = !r.error && bad.length === 0;
    if (!ok) failed += 1;
    say(
      `${ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.checks.length - bad.length}/${r.checks.length} checks  ${(r.ms / 1000).toFixed(1)} s  ${r.title}`
    );
    for (const c of bad) say(`        ✗ ${c.name} — ${c.evidence}`);
    if (r.error && !bad.some((c) => r.error.message.includes(c.name)))
      say(`        ✗ ${String(r.error.message).slice(0, 300)}`);
  }
  say(failed ? `\n${failed} scenario(s) FAILED` : '\nall scenarios passed');
  await shutdown(failed ? 1 : 0);
}

main().catch(async (err) => {
  say(`fatal: ${err.stack ?? err}`);
  await shutdown(1);
});
