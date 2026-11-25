#!/usr/bin/env node
// A team server seeded to look like the design canvas "16 Team Server and Cloud Admin"
// (ts-overview, ts-people, ts-activity, …): about 14 people, one asking to join, one
// invited, one turned off, a backup, activity rows — so the real /admin can be
// screenshotted next to the artboards (.ai/scenarios/admin-ui-parity/hub/).
//
//   node scripts/dev/admin-e2e/hub-parity-serve.mjs [--port 4815]
//
// Prints one JSON line {url, email, password, key, dir} once it is ready, then serves until
// killed (SIGINT/SIGTERM take the hub's process group down). The hub is its real entry point
// (apps/hub/test/fixtures/serve-team-server.mjs → runAsMain), NO_OPEN=1, a stub `claude`.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeStubClaude } from '../../lib/stub-claude.mjs';
import { v2Config } from '../v2-config.mjs';
import {
  freePort,
  ISSUER,
  killEverything,
  oidcAs,
  person,
  REPO_ROOT,
  rawRequest,
  spawnLogged,
  tail,
  waitFor,
} from './hub-lib.mjs';

const argPort = process.argv.indexOf('--port');
const port = argPort > 0 ? Number(process.argv[argPort + 1]) : await freePort();
const DOMAIN = 'studyfi.test';
const RUN = randomBytes(3).toString('hex');
const ADMIN = { email: `michal@${DOMAIN}`, password: `parity-${RUN}-admin-pass` };
const KEY = `parity-admin-key-${RUN}-${randomBytes(8).toString('hex')}`;
const root = mkdtempSync(join(tmpdir(), 'maude-hub-parity-'));
const dataDir = join(root, 'data');
const repoDir = join(root, 'repo');
const backupDir = join(root, 'backups');
const home = join(root, 'home');
for (const d of [dataDir, repoDir, backupDir, join(home, '.config')])
  mkdirSync(d, { recursive: true });

const git = (...args) => execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore' });
const d = join(repoDir, '.design');
mkdirSync(join(d, 'ui'), { recursive: true });
writeFileSync(
  join(d, 'config.json'),
  `${JSON.stringify(v2Config({ name: 'StudyFi Design', canvasGroups: [{ label: 'Canvases', path: 'ui' }] }), null, 2)}\n`
);
for (const name of ['onboarding-v3', 'paywall', 'pricing-hero', 'home']) {
  writeFileSync(
    join(d, `ui/${name}.tsx`),
    `export default function C() {\n  return <main><h1>${name}</h1></main>;\n}\n`
  );
}
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'cell@local');
git('config', 'user.name', 'Parity');
git('add', '-A');
git('commit', '-q', '-m', 'seed');

const publicUrl = `http://127.0.0.1:${port}`;
const env = {
  PATH: `${writeStubClaude(join(root, 'stub-bin'))}:${process.env.PATH}`,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  NO_OPEN: '1',
  MAUDE_NO_AUTOBUILD: '1',
  PORT: String(port),
  DATA_DIR: dataDir,
  HUB_SECRET: KEY,
  HUB_PUBLIC_URL: publicUrl,
  HUB_INSECURE_HTTP: '1',
  // the seeding below signs several people in; each sends its own X-Forwarded-For
  HUB_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
  HUB_ADMIN_RATE_LIMIT: 'off',
  HUB_WORKSPACE_MODE: '1',
  MAUDE_WORKSPACE_MODE: '1',
  MAUDE_REPO_DIR: repoDir,
  MAUDE_DESIGN_ROOT: '.design',
  MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
  MAUDE_ADMIN_EMAIL: ADMIN.email,
  MAUDE_ADMIN_PASSWORD: ADMIN.password,
  MAUDE_BACKUP_TARGET: `file://${backupDir}`,
  MAUDE_BACKUP_INTERVAL_MS: String(6 * 3_600_000),
  HUB_OIDC_MODE: 'hybrid',
  HUB_OIDC_ISSUER: ISSUER,
  HUB_OIDC_CLIENT_ID: 'hub',
  HUB_OIDC_CLIENT_SECRET: `parity-${RUN}`,
  HUB_OIDC_ALLOWED_DOMAINS: DOMAIN,
  HUB_OIDC_LABEL: 'Google',
};
const hub = spawnLogged(
  'hub',
  process.execPath,
  [join(REPO_ROOT, 'apps/hub/test/fixtures/serve-team-server.mjs')],
  { env, cwd: join(REPO_ROOT, 'apps/hub'), logDir: join(root, 'logs') }
);
const stop = async () => {
  await killEverything();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const host = new URL(publicUrl).host;
const up = await waitFor(
  async () => (await rawRequest({ port, host, path: '/health' })).status > 0,
  { timeoutMs: 40_000 }
);
if (!up.ok) {
  process.stderr.write(`the hub never answered:\n${tail(hub.logPath)}\n`);
  await stop();
}

const keyed = (path, body) =>
  rawRequest({
    port,
    host,
    method: body === undefined ? 'GET' : 'POST',
    path: `/admin/api${path}`,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(JSON.stringify(body)),
          }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  }).then((r) => r.json());

// ---- people: the canvas's list, in real addresses
const accounts = [
  ['tereza.novakova', 'admin'],
  ['jonas.berger', 'member'],
  ['anna.kralova', 'member'],
  ['ondrej.maly', 'member'],
  ['filip.horak', 'member'],
  ['eva.pokorna', 'member'],
  ['marek.cerny', 'member'],
  ['katerina.ruzickova', 'member'],
  ['tomas.vesely', 'member'],
  ['lucie.dolezalova', 'member'],
  ['jakub.prochazka', 'member'],
];
for (const [name, role] of accounts) {
  await keyed('/users', {
    email: `${name}@${DOMAIN}`,
    password: `parity-${RUN}-${name}-pw`,
    role,
  });
}
const settings = await keyed('/settings');
await keyed('/settings', {
  name: 'StudyFi Design',
  description: settings.description ?? '',
  whoCanJoin: 'ask',
});
await keyed('/people/invite', { emails: [`petra.svobodova@${DOMAIN}`], role: 'member' });
// Lukáš signs in with the provider and asks to join.
const lukas = person({ port, publicUrl, ip: '10.9.0.7' });
await oidcAs(lukas, await lukas.get('/auth/oidc/start'), {
  sub: 'sub-lukas',
  email: `lukas.dvorak@${DOMAIN}`,
});
// A sign-in of a few people, so "Last here" has real stamps.
for (const [name] of accounts.slice(0, 4)) {
  const p = person({
    port,
    publicUrl,
    ip: `10.9.1.${accounts.findIndex((a) => a[0] === name) + 1}`,
  });
  await p.get('/studio/signin');
  await p.form('/studio/signin', {
    email: `${name}@${DOMAIN}`,
    password: `parity-${RUN}-${name}-pw`,
  });
}
const all = await keyed('/people');
const filip = all.people.find((p) => p.email === `filip.horak@${DOMAIN}`);
if (filip) await keyed('/people/turn-off', { id: filip.id });
const tereza = all.people.find((p) => p.email === `tereza.novakova@${DOMAIN}`);
await keyed('/backup/run', {});
await waitFor(
  async () => {
    const o = await keyed('/overview');
    return o.health?.find((h) => h.key === 'backups')?.at ? o : null;
  },
  { timeoutMs: 30_000 }
);

process.stdout.write(
  `${JSON.stringify({ url: `${publicUrl}/admin`, email: ADMIN.email, password: ADMIN.password, key: KEY, dir: root, tereza: tereza?.key ?? null })}\n`
);
setInterval(() => {}, 1 << 30);
