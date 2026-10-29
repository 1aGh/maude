// p8-update-fails-loud — both directions against a REAL hub (loopback, spawned here from the
// fixture the update-to-accepted work used — never a real hub, never a real credential), with a
// token that hub rejects (the alligators report: an expired hub token, `invalid-token`):
//   (a) a format-1 linked project: Update refuses before touching anything and says why — through
//       the studio route, as the app's dialog calls it;
//   (b) a format-2 project that still saves the old way: the switch is refused visibly, and the
//       project stays at format 2, saving the old way — readable and editable as it was.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyFailureState,
  olderGateState,
  saveModeState,
} from '../client/v2/shell/format-update.js';
import { EXIT, planMigration } from '../migrate/engine.ts';
import { createProjectFormatRoutes } from '../routes/project-format.ts';
import { fixtureProject, fullTreeHash, opts, type Project, run } from './_migrate-harness.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
/** serve-hub.mjs's operator secret — the project owner on that hub. */
const OWNER_SECRET = 'test-secret';
/** A credential the hub has never issued: the expired-token case. */
const REJECTED_TOKEN = 'maude-test-expired-token';

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
}

function startLegacyHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, port: info.port });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`hub exited ${code}: ${buf}`));
    });
  });
}

function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGTERM');
  });
}

const ownerApi = (hub: Hub, route: string, init: RequestInit = {}) =>
  fetch(`${hub.http}${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${OWNER_SECRET}`,
      'x-maude-format': '2',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

function link(project: Project, url: string) {
  const f = join(project.design, 'config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, `${JSON.stringify({ ...cfg, linkedHub: { url, linkedAt: 1 } }, null, 2)}\n`);
}
const localFormat = (project: Project) =>
  JSON.parse(readFileSync(join(project.design, 'config.json'), 'utf8')).formatVersion ?? 1;

describe.skipIf(!HUB_READY)('Update project with a token the hub rejects', () => {
  let hub: Hub;
  let dataRoot: string;
  let url: string;
  const projects: Project[] = [];

  beforeAll(async () => {
    const scratch = fixtureProject();
    projects.push(scratch);
    dataRoot = join(scratch.repo, 'hub-data');
    hub = await startLegacyHub(dataRoot);
    url = `http://127.0.0.1:${hub.port}`;
  }, 30_000);

  afterAll(async () => {
    if (hub) await stopHub(hub);
    for (const p of projects) p.dispose();
  });

  test('the hub really rejects it (the precondition)', async () => {
    const r = await fetch(`${url}/api/projects/current/v1/mode`, {
      headers: { authorization: `Bearer ${REJECTED_TOKEN}` },
    });
    expect([401, 403]).toContain(r.status);
    expect((await ownerApi(hub, '/api/projects/current/v1/mode')).body.mode).toBe('legacy');
  });

  test('(a) format 1: Update refuses before touching anything, and the app can say why', async () => {
    const p = fixtureProject();
    projects.push(p);
    link(p, url);
    const before = fullTreeHash(p.design);
    const hubFormatBefore = (await (await fetch(`${url}/health`)).json()).formatVersion;
    const hubRec = { url, token: REJECTED_TOKEN, role: 'owner' };
    // The dialog's call: the studio route, apply, from the Maude window.
    const [, migrate] = createProjectFormatRoutes({
      repoRoot: p.repo,
      designRel: '.design',
      hub: () => hubRec,
      formatView: () => ({}),
      engine: { liveStudio: () => false, dsEmitter: null },
    });
    const res = await migrate.handle(
      new Request('http://127.0.0.1/_api/project/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ direction: 'forward', apply: true }),
      }),
      {} as never
    );
    expect(res.status).toBe(409);
    const report = (await res.json()) as Awaited<ReturnType<typeof planMigration>>;
    expect(report.refusals.map((r) => r.code)).toContain('token-rejected');
    // nothing moved: not a byte on disk, not the hub's format, not its save mode
    expect(fullTreeHash(p.design)).toBe(before);
    expect(localFormat(p)).toBe(1);
    expect((await (await fetch(`${url}/health`)).json()).formatVersion).toBe(hubFormatBefore);
    expect((await ownerApi(hub, '/api/projects/current/v1/mode')).body.mode).toBe('legacy');
    // and the words the dialog shows for that answer offer the sign-in
    expect(applyFailureState({ status: 409, report })).toMatchObject({
      kind: 'token-rejected',
      action: 'sign-in-again',
    });
    // the callout says it too, before anyone clicks
    const dry = await planMigration(opts(p, { hub: hubRec }));
    const cfg = { formatGate: { projectFormat: 1, supported: 2 } };
    expect(olderGateState({ cfg, plan: dry })).toMatchObject({ action: 'sign-in-again' });
  }, 30_000);

  test('(b) format 2, saves the old way: the switch is refused visibly; still format 2, still the old way', async () => {
    const p = fixtureProject();
    projects.push(p);
    await run(opts(p)); // local → format 2 (unlinked)
    link(p, url);
    // the hub at format 2 too, as a v2 studio's link leaves it
    const flip = await ownerApi(hub, '/api/project-format', {
      method: 'POST',
      body: JSON.stringify({ formatVersion: 2 }),
    });
    expect(flip.status).toBe(200);
    const before = fullTreeHash(p.design);
    const hubRec = { url, token: REJECTED_TOKEN, role: 'owner' };
    const r = await run(opts(p, { hub: hubRec }));
    expect(r.exitCode).toBe(EXIT.refused);
    expect(r.refusals.map((x) => x.code)).toContain('token-rejected');
    // the project as it was: format 2 (editable, not view only), saving the old way
    expect(fullTreeHash(p.design)).toBe(before);
    expect(localFormat(p)).toBe(2);
    const mode = await ownerApi(hub, '/api/projects/current/v1/mode');
    expect(mode.body.mode).toBe('legacy');
    // and the quiet callout says why instead of going away
    const cfg = { saveMode: 'legacy', formatVersion: 2 };
    expect(saveModeState({ cfg, plan: r })).toMatchObject({
      kind: 'save-mode-sign-in',
      action: 'sign-in-again',
    });
    expect(mode.body.formatVersion).toBe(2);
  }, 30_000);
});
