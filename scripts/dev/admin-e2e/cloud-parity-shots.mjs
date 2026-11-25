#!/usr/bin/env node
// Maude Cloud, page by page, beside canvas 16 — the real pages for the parity check.
//
//   FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/cloud-parity-shots.mjs [--out <dir>]
//
// Stands up the local control plane (cloud-stack.mjs), seeds it to mirror the
// artboards of `.design/ui/v2/16 Team Server and Cloud Admin.tsx` — an owner
// with five projects and about a dozen people, open invitations and requests to
// edit; a member in two of them; an operator with several accounts, one trial
// ending in two days and one Promo — and screenshots each page at 1440 × 980 in
// a light colour scheme into `<out>/<artboard>-real.png`, beside the design's
// `<artboard>-design.png`.
//
// Everything is seeded straight into the local D1 except the accounts, which
// sign up over HTTP so they have real passwords and sessions. Figures only
// analytics can give (opens, exports, storage, who is here now) are absent
// locally, and the pages leave those tiles out rather than inventing them.

import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from './cloud-http.mjs';
import { killAll, REPO, startStack } from './cloud-stack.mjs';

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? process.argv[i + 1] : join(REPO, '.ai/scenarios/admin-ui-parity/cloud');
})();
mkdirSync(OUT, { recursive: true });

const PASSWORD = 'correct-horse-battery-staple-1';
const DAY = 86_400_000;
const NOW = Date.now();
const RUN = Math.random().toString(36).slice(2, 7);
const say = (s) => console.log(s);

const stack = await startStack({ log: (s) => say(`[stack] ${s}`) });
const C = stack.cloudUrl;

function ab(args) {
  return new Promise((ok) =>
    execFile('agent-browser', args, { timeout: 60_000 }, (err, out, errOut) =>
      ok({ ok: !err, out: String(out ?? ''), err: String(errOut ?? err?.message ?? '') })
    )
  );
}

/** One browser session per person, every name resolved to the local edge. */
class Shooter {
  constructor(name) {
    this.session = `cloud-parity-${RUN}-${name}`;
    this.started = false;
  }
  async run(...args) {
    const launch = this.started
      ? []
      : [
          '--ignore-https-errors',
          '--args',
          `--host-resolver-rules=MAP * 127.0.0.1:${stack.edgePort}`,
        ];
    this.started = true;
    return ab(['--session', this.session, ...launch, ...args]);
  }
  async signIn(email) {
    await this.run('open', `${C}/login`);
    await this.run('set', 'viewport', '1440', '980');
    await this.run('set', 'media', 'light');
    await this.run('fill', 'input[name=email]', email);
    await this.run('fill', 'input[name=password]', PASSWORD);
    await this.run('click', 'button[type=submit]');
    await this.run('wait', '1200');
  }
  async shot(path, file) {
    await this.run('open', `${C}${path}`);
    await this.run('wait', '800');
    const r = await this.run('screenshot', join(OUT, file));
    say(`${r.ok ? 'shot' : 'FAILED'} ${file} ← ${path}${r.ok ? '' : ` (${r.err})`}`);
  }
  close() {
    return ab(['--session', this.session, 'close']);
  }
}

async function signUp(local, name) {
  // Thirteen sign-ups in a minute is a scripted burst; start each one clean.
  await stack.d1('DELETE FROM rate_hits').catch(() => {});
  const email = `${local}-${RUN}@e2e.test`;
  const client = new Client(local);
  const r = await client.post(`${C}/auth/signup`, {
    form: { email, password: PASSWORD, disclosure: 'yes' },
  });
  if (r.status !== 303) throw new Error(`signup ${email}: ${r.status}`);
  const mail = stack.mail.filter((m) => m.to === email && /Confirm/i.test(m.subject)).at(-1);
  const link = String(mail?.text ?? '').match(/https:\/\/\S+\/auth\/verify\?t=\S+/)?.[0];
  if (link) await client.get(link);
  const [{ id }] = await stack.d1('SELECT id FROM accounts WHERE email = ?', email);
  await stack.d1('UPDATE accounts SET name = ? WHERE id = ?', name, id);
  return { id, email, name };
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const changes = (counts) =>
  JSON.stringify({
    at: NOW,
    byDay: counts.map((count, i) => ({ day: day(NOW - (counts.length - 1 - i) * DAY), count })),
    week: counts.slice(-7).reduce((a, b) => a + b, 0),
  });

async function project(id, owner, name, extra = {}) {
  const cols = {
    id,
    account_id: owner.id,
    name,
    state: 'active',
    state_since: NOW - 40 * DAY,
    plan: 'project',
    created_at: NOW - 60 * DAY,
    version: '2.4.6',
    cell_running: 1,
    last_checkpoint: NOW - 3_600_000,
    ...extra,
  };
  const keys = Object.keys(cols);
  await stack.d1(
    `INSERT INTO projects (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ...keys.map((k) => cols[k])
  );
  await member(id, owner, 'owner');
}
const member = (projectId, who, role) =>
  stack.d1(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)',
    projectId,
    who.id,
    role,
    NOW - 20 * DAY
  );
const invite = (projectId, email, role, ageDays, leftDays) =>
  stack.d1(
    'INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(),
    projectId,
    email,
    role,
    NOW - ageDays * DAY,
    NOW + leftDays * DAY
  );
const request = (projectId, who, ageMs) =>
  stack.d1(
    'INSERT INTO access_requests (id, project_id, account_id, created_at) VALUES (?, ?, ?, ?)',
    crypto.randomUUID(),
    projectId,
    who.id,
    NOW - ageMs
  );

const shooters = [];
try {
  // ---- the owner's account (cl-account, cl-people), and the member (un-member-cl)
  const michal = await signUp('michal', 'StudyFi');
  const p = {};
  for (const [local, name] of [
    ['tereza', 'Tereza Nováková'],
    ['jonas', 'Jonas Berger'],
    ['anna', 'Anna Králová'],
    ['ondrej', 'Ondřej Malý'],
    ['vojta', 'Vojta Černý'],
    ['petra', 'Petra Svobodová'],
    ['marek', 'Marek Dvořák'],
    ['lukas', 'Lukáš Dvořák'],
    ['filip', 'Filip Horák'],
    ['radka', 'Radka Veselá'],
    ['tomas', 'Tomáš Kos'],
  ]) {
    p[local] = await signUp(local, name);
  }
  const bars = [
    30, 41, 38, 52, 22, 12, 15, 44, 57, 61, 49, 35, 16, 20, 58, 66, 72, 54, 47, 18, 14, 62, 70, 64,
    76, 59, 24, 21, 68, 81,
  ];
  const ids = {
    gator: `alligators-${RUN}`,
    app: `studyfi-app-${RUN}`,
    site: `marketing-${RUN}`,
    price: `pricing-${RUN}`,
    onb: `onboarding-${RUN}`,
  };
  await project(ids.gator, michal, 'Alligators brand', {
    changes: changes(bars.map((n) => Math.round(n * 0.55))),
    subscription_id: 'sub_local_gator',
  });
  await project(ids.app, michal, 'StudyFi app', {
    changes: changes(bars.map((n) => Math.round(n * 0.25))),
  });
  await project(ids.site, michal, 'Marketing site', {
    changes: changes(bars.map((n) => Math.round(n * 0.08))),
  });
  await project(ids.price, michal, 'Pricing tests', { trial_ends_at: NOW + 9 * DAY });
  await project(ids.onb, michal, 'Onboarding', {
    promo_since: NOW - 30 * DAY,
    promo_tier: 'dedicated',
  });
  for (const [pid, who, role] of [
    [ids.gator, 'tereza', 'member'],
    [ids.gator, 'jonas', 'member'],
    [ids.gator, 'ondrej', 'viewer'],
    [ids.gator, 'vojta', 'observer'],
    [ids.gator, 'petra', 'member'],
    [ids.app, 'tereza', 'member'],
    [ids.app, 'jonas', 'viewer'],
    [ids.app, 'anna', 'member'],
    [ids.app, 'marek', 'member'],
    [ids.site, 'anna', 'observer'],
    [ids.site, 'ondrej', 'member'],
    [ids.site, 'lukas', 'member'],
    [ids.price, 'jonas', 'member'],
    [ids.price, 'filip', 'viewer'],
    [ids.onb, 'tereza', 'member'],
    [ids.onb, 'radka', 'member'],
    [ids.onb, 'tomas', 'viewer'],
  ]) {
    await member(pid, p[who], role).catch(() =>
      // Before the v2 roles reach this database, Can view is stored as Can comment.
      member(pid, p[who], role === 'observer' ? 'viewer' : role)
    );
  }
  await request(ids.gator, p.vojta, 3_600_000);
  await request(ids.site, p.anna, DAY + 3_600_000);
  await invite(ids.app, `eva.pokorna-${RUN}@e2e.test`, 'member', 3, 4);
  await invite(ids.gator, `radek-${RUN}@e2e.test`, 'viewer', 6, 1);

  // ---- the operator's fleet (cl-operator, cl-op-account, cl-op-promo)
  const kolar = await signUp('jan', 'Ateliér Kolář');
  await project(`kolar-web-${RUN}`, kolar, 'Kolář web', { trial_ends_at: NOW + 2 * DAY });
  await project(`plakaty-${RUN}`, kolar, 'Plakáty 2027', { subscription_id: 'sub_local_kolar' });
  await project(`cenik-${RUN}`, kolar, 'Ceník — pokus', {
    state: 'suspended',
    trial_ends_at: NOW - 5 * DAY,
    cell_running: 0,
  });
  await member(`kolar-web-${RUN}`, p.marek, 'member');
  await member(`plakaty-${RUN}`, p.radka, 'member');
  const open = await signUp('hello', 'Open studio Brno');
  await project(`open-studio-${RUN}`, open, 'Open studio', { trial_ends_at: NOW + 11 * DAY });
  const gator = await signUp('tomas-owner', 'Alligators Brno');
  await project(`gator-club-${RUN}`, gator, 'Alligators club', { created_at: NOW - 250 * DAY });
  await stack
    .d1(
      "INSERT INTO audit_log (id, at, actor, action, account_id, project_id, reason) VALUES (?, ?, 'system', 'reconcile', ?, ?, NULL)",
      crypto.randomUUID(),
      NOW - 3_600_000,
      gator.id,
      `gator-club-${RUN}`
    )
    .catch(() => {});
  const op = await signUp('operator', 'Michal');
  await stack.setOperators([op.id]);

  // ---- the shots
  const owner = new Shooter('owner');
  shooters.push(owner);
  await owner.signIn(michal.email);
  await owner.shot('/', 'cl-account-real.png');
  await owner.shot('/account/people', 'cl-people-real.png');
  await owner.shot('/account/people?sheet=invite', 'cl-people-invite-real.png');
  await owner.shot(`/projects/${ids.onb}/billing`, 'cl-promo-owner-real.png');
  await owner.shot('/projects', 'cl-projects-real.png');

  const anna = new Shooter('anna');
  shooters.push(anna);
  await anna.signIn(p.anna.email);
  await anna.shot('/', 'un-member-cl-real.png');

  const ops = new Shooter('operator');
  shooters.push(ops);
  await ops.signIn(op.email);
  await ops.shot('/operator/new-project', 'cl-operator-real.png');
  await ops.shot(
    `/operator/accounts/${kolar.id}?sheet=free&project=kolar-web-${RUN}`,
    'cl-op-account-real.png'
  );
  await ops.shot(`/operator/projects/gator-club-${RUN}?sheet=promo`, 'cl-op-promo-real.png');

  const anon = new Shooter('anon');
  shooters.push(anon);
  await anon.run('open', `${C}/login`);
  await anon.run('set', 'viewport', '1440', '980');
  await anon.run('set', 'media', 'light');
  await anon.shot('/login', 'public-login-real.png');
  await anon.shot('/signup', 'public-signup-real.png');
  await anon.shot('/activate', 'public-activate-real.png');
} finally {
  for (const s of shooters) await s.close();
  await stack.stop().catch(() => {});
  killAll();
}
