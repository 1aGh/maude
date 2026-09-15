#!/usr/bin/env node
// Real-process surface runner. Partial runs never produce a certified baseline.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addToken } from '../../../apps/hub/src/tokens.mjs';
import { closeUsers, createUser } from '../../../apps/hub/src/users.mjs';
import { buildSurfaceCatalogue, cataloguePath } from './surface-catalogue.mjs';
import { seedMediaFixture } from './surface-fixture.mjs';
import { sourceManifest, treeManifest } from './surface-provenance.mjs';
import { writeSurfaceReport } from './surface-report.mjs';
import { startResourceSampler } from './surface-resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const arg = (key, fallback) => {
  const i = argv.indexOf(`--${key}`);
  return i < 0 ? fallback : argv[i + 1];
};
const mode = arg('mode', 'baseline');
if (!['baseline', 'candidate'].includes(mode))
  throw new Error('mode must be baseline or candidate');
// How the project saves: `legacy` (raw shared documents) or `accepted`
// (DDR-241 accepted revisions — the project is switched after the cell is up
// and before any peer joins, exactly as an operator would).
const saveMode = arg('save-mode', 'legacy');
if (!['legacy', 'accepted'].includes(saveMode))
  throw new Error('save-mode must be legacy or accepted');
const samples = Number(arg('samples', '1'));
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100)
  throw new Error('samples must be an integer from 1 to 100 (currently the UI text lane only)');
const startupIndexFailures = Number(arg('startup-index-failures', '0'));
if (
  !Number.isSafeInteger(startupIndexFailures) ||
  startupIndexFailures < 0 ||
  startupIndexFailures > 5
)
  throw new Error('startup-index-failures must be an integer from 0 to 5');
const app = resolve(
  arg(
    'app',
    process.env.MAUDE_E2E_APP ??
      join(
        root,
        'apps/desktop/src-tauri/target/debug/bundle/macos/Maude.app/Contents/MacOS/maude-desktop'
      )
  )
);
if (!existsSync(app) || !app.includes('.app/Contents/MacOS/'))
  throw new Error('Build a bundled debug app first, or pass --app with its bundled executable.');
const work = mkdtempSync(join(tmpdir(), 'maude-surface-e2e-'));
const stamp = new Date().toISOString().replaceAll(':', '-');
const out = join(root, '.ai/device/scenario-runs/reliable-project-multiplayer', stamp);
mkdirSync(out, { recursive: true });
const stopResourceSampler = startResourceSampler(out);
const port = Number(arg('port', '19099'));
const peerPort = port + 100;
const hub = `http://studio.cell.localhost:${port}`;
const children = [];
function cleanup() {
  for (const { child, detached } of [...children].reverse()) {
    try {
      if (detached) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      /* already exited */
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
const env = {
  ...process.env,
  MAUDE_NO_AUTOBUILD: '1',
  NO_OPEN: '1',
  MAUDE_CLOUD_CONFIG: join(work, 'cloud.json'),
};
writeFileSync(env.MAUDE_CLOUD_CONFIG, '{}', { mode: 0o600 });
function start(name, cmd, args, extraEnv = {}) {
  const fd = openSync(join(work, `${name}.log`), 'a', 0o600);
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  children.push({ child, detached: true });
  return child;
}
async function ready(url) {
  const end = performance.now() + 60000;
  while (performance.now() < end) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Not ready: ${url}`);
}
async function free(p) {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(p, '127.0.0.1', ok);
  });
  await new Promise((ok) => server.close(ok));
}
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let exitCode = 2;
try {
  const catalogue = buildSurfaceCatalogue();
  if (JSON.stringify(catalogue) !== JSON.stringify(JSON.parse(readFileSync(cataloguePath, 'utf8'))))
    throw new Error(
      'Coverage inventory differs from current controls; review and regenerate it before this run.'
    );
  writeFileSync(join(out, 'coverage-catalogue.json'), JSON.stringify(catalogue, null, 2));
  await Promise.all([free(port), free(port - 200), free(peerPort), free(4455)]);
  const watch = arg('watch', 'normal');
  if (!['normal', 'control'].includes(watch)) throw new Error('watch must be normal or control');
  const notes = arg('notes', 'isolated');
  if (!['isolated', 'shared'].includes(notes)) throw new Error('notes must be isolated or shared');
  start('cell', 'node', [
    join(root, 'scripts/dev/local-cell.mjs'),
    '--dir',
    work,
    '--port',
    String(port),
    '--keep',
    ...(watch === 'control' ? ['--no-watch'] : []),
  ]);
  await ready(`http://127.0.0.1:${port}/health`);
  const data = join(work, 'data');
  for (const id of ['designer-a', 'designer-b'])
    createUser(data, {
      email: `${id}@local.test`,
      password: 'surface-test-password',
      role: 'member',
      scope: '*',
    });
  closeUsers(data);

  const source = join(work, 'desktop-project');
  const peerB = join(work, 'desktop-b');
  cpSync(source, peerB, {
    recursive: true,
    filter: (p) => !p.split('/').some((s) => s.startsWith('_')),
  });
  const uploadDir = join(work, 'upload-inputs');
  const media = seedMediaFixture(join(work, 'repo'), [source, peerB], uploadDir);
  writeFileSync(
    join(out, 'upload-input-manifest.json'),
    JSON.stringify(treeManifest(uploadDir), null, 2)
  );
  // Switch AFTER the fixture exists everywhere — the way an operator switches
  // a project that already has canvases and folders: they are imported.
  if (saveMode === 'accepted') {
    const { value: ownerToken } = addToken(data, {
      label: 'surface-operator',
      scope: '*',
      expiresAt: Date.now() + 12 * 3600000,
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/current/v1/mode`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'transactions' }),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 200)
      throw new Error(
        `switching to accepted revisions failed: ${res.status} ${JSON.stringify(body)}`
      );
    writeFileSync(join(out, 'save-mode-switch.json'), JSON.stringify(body, null, 2));
    console.log(`Accepted revisions ON: ${JSON.stringify(body?.imported ?? {})}`);
  }
  const identities = {};
  for (const [id, role] of [
    ['designer-a', 'member'],
    ['designer-b', 'member'],
    ['viewer', 'viewer'],
  ]) {
    const { value } = addToken(data, {
      label: `surface-${id}`,
      scope: '*',
      owner: `${id}@local.test`,
      role,
      readOnly: role === 'viewer',
      expiresAt: Date.now() + 12 * 3600000,
    });
    const path = join(work, `${id}-hubs.json`);
    writeFileSync(
      path,
      JSON.stringify({
        hubs: { [`http://127.0.0.1:${port}`]: { token: value, role, linkedAt: Date.now() } },
      }),
      { mode: 0o600 }
    );
    identities[id] = path;
  }
  start(
    'desktop-b',
    'bun',
    [
      '--no-env-file',
      join(root, 'apps/studio/server.ts'),
      '--root',
      peerB,
      '--port',
      String(peerPort),
    ],
    { HUBS_CONFIG_PATH: identities['designer-b'] }
  );
  await ready(`http://127.0.0.1:${peerPort}/_health`);
  const config = {
    mode,
    saveMode,
    media,
    work,
    out,
    port,
    hub,
    peerPort,
    peerB,
    nativeProject: source,
    watch,
    notes,
    app,
    roots: { hub: join(work, 'repo'), native: source, peer: peerB },
    identities,
    samples,
    startupIndexFailures,
    only: arg('only', '').split(',').filter(Boolean),
  };
  const configPath = join(work, 'run.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  writeFileSync(
    join(out, 'provenance.json'),
    JSON.stringify(
      {
        version: 1,
        mode,
        saveMode,
        watch,
        notes,
        samples,
        startupIndexFailures,
        app,
        appSha256: hash(app),
        clientSha256: hash(join(root, 'apps/studio/dist/client.bundle.js')),
        configSha256: hash(configPath),
        catalogueSha256: hash(join(out, 'coverage-catalogue.json')),
        fixtureSha256: hash(join(source, '.design/ui/desktop-home.tsx')),
        work,
        baselineComplete: false,
      },
      null,
      2
    )
  );
  writeFileSync(join(out, 'source-manifest.json'), JSON.stringify(sourceManifest(root), null, 2));
  writeFileSync(
    join(out, 'bundle-manifest.json'),
    JSON.stringify(treeManifest(resolve(app, '../../..')), null, 2)
  );
  writeFileSync(
    join(out, 'fixture-manifest.json'),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(config.roots).map(([id, path]) => [
          id,
          treeManifest(join(path, '.design'), { skipRuntime: true }),
        ])
      ),
      null,
      2
    )
  );
  console.log(`Surface evidence: ${out}`);
  const wdio = spawn(
    join(root, 'apps/desktop/e2e/node_modules/.bin/wdio'),
    ['run', join(root, 'apps/desktop/e2e/multiplayer/wdio.conf.ts')],
    {
      cwd: work,
      env: {
        ...env,
        MAUDE_SURFACE_CONFIG: configPath,
        MAUDE_E2E_APP: app,
        MAUDE_E2E_RUN_DIR: out,
        HUBS_CONFIG_PATH: identities['designer-a'],
      },
      stdio: [
        'ignore',
        openSync(join(out, 'native.log'), 'a'),
        openSync(join(out, 'native.log'), 'a'),
      ],
    }
  );
  children.push({ child: wdio, detached: false });
  const code = await new Promise((done, fail) => {
    wdio.once('exit', done);
    wdio.once('error', fail);
  });
  writeFileSync(
    join(out, 'driver-result.json'),
    JSON.stringify({ exitCode: code, completed: code === 0, expectedSamples: samples }, null, 2)
  );
  try {
    execFileSync(
      'bun',
      [join(root, 'scripts/dev/sync-e2e/surface-source-audit.mjs'), out, configPath],
      { stdio: 'pipe', timeout: 30000 }
    );
  } catch (error) {
    writeFileSync(join(out, 'source-audit-error.txt'), String(error));
  }
  writeFileSync(
    join(out, 'final-file-manifest.json'),
    JSON.stringify(
      {
        phase: 'after WDIO exit, before remaining backend teardown; not a fresh-client reopen',
        roots: Object.fromEntries(
          Object.entries(config.roots).map(([id, path]) => [
            id,
            treeManifest(join(path, '.design'), { skipRuntime: true }),
          ])
        ),
      },
      null,
      2
    )
  );
  exitCode = code || 2; // All L01–L24 variants + timing gates still required.
} catch (error) {
  writeFileSync(join(out, 'runner-error.txt'), String(error.stack ?? error));
  console.error(error.message);
  exitCode = 1;
} finally {
  cleanup();
  await stopResourceSampler();
  const counts = writeSurfaceReport(out);
  if (counts) console.log(`Partial observations: ${JSON.stringify(counts)}. T1 is not certified.`);
  // Logs and credentials remain in the isolated scratch directory.
}
process.exitCode = exitCode;
