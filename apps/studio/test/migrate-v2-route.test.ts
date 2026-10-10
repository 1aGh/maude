// V2-1.12 §5.9 — `POST /_api/project/migrate`, the app's "Update project":
// the same engine in-process (the one caller allowed while the studio has the
// project open), the report as the body, exit codes as statuses.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createProjectFormatRoutes, statusForExit } from '../routes/project-format.ts';
import { matchRoute } from '../routes/table.ts';
import { fixtureProject, type Project } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

function routes(project: Project, onMigrated = () => {}) {
  return createProjectFormatRoutes({
    repoRoot: project.repo,
    designRel: '.design',
    hub: () => null,
    formatView: () => ({ formatVersion: 1 }),
    onMigrated,
    // a live studio is the normal case here — it must not matter for this caller
    engine: {
      liveStudio: () => true,
      dsEmitter: null,
      now: () => new Date('2026-10-09T12:00:00Z'),
    },
  });
}

// what a browser sends from the Maude window; curl-local refuses to forge it
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

async function post(
  project: Project,
  body: unknown,
  onMigrated?: () => void,
  headers: Record<string, string> = FROM_WINDOW
) {
  const m = matchRoute(routes(project, onMigrated), 'POST', '/_api/project/migrate');
  if (!m) throw new Error('no route');
  const res = await m.spec.handle(
    new Request('http://localhost/_api/project/migrate', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    m.params
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /_api/project/migrate', () => {
  test('an apply from a non-browser client is refused and writes nothing; its dry run is open', async () => {
    p = fixtureProject();
    const before = readFileSync(path.join(p.repo, '.design', 'config.json'), 'utf8');
    const refused = await post(p, { direction: 'forward', apply: true }, undefined, {});
    expect(refused.status).toBe(403);
    expect(readFileSync(path.join(p.repo, '.design', 'config.json'), 'utf8')).toBe(before);
    expect((await post(p, { direction: 'forward' }, undefined, {})).status).toBe(200);
  });

  test('dry-run by default, apply on request, then already-there; onMigrated fires once', async () => {
    p = fixtureProject();
    let migrated = 0;
    const dry = await post(p, { direction: 'forward' }, () => migrated++);
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ format: 'maude.migrate-report', dryRun: true, exitCode: 0 });
    expect(
      JSON.parse(readFileSync(path.join(p.design, 'config.json'), 'utf8')).formatVersion
    ).toBeUndefined();
    const applied = await post(p, { direction: 'forward', apply: true }, () => migrated++);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ dryRun: false, exitCode: 0 });
    expect(migrated).toBe(1);
    const again = await post(p, { apply: true });
    expect(again).toMatchObject({ status: 200, body: { exitCode: 10 } });
  });

  test('refusals are 409 with the report; bad bodies are 400', async () => {
    p = fixtureProject();
    expect((await post(p, { direction: 'reverse', apply: true })).status).toBe(409);
    expect((await post(p, { direction: 'sideways' })).status).toBe(400);
    expect((await post(p, { direction: 'forward', strip: true })).status).toBe(400);
    expect((await post(p, '{nope')).status).toBe(400);
  });

  test('the table: main origin only; migrate refused for a read-only role', () => {
    p = fixtureProject();
    expect(routes(p).map((r) => `${r.method} ${r.path} ${r.origin} ${r.readOnly}`)).toEqual([
      'GET /_api/project/format main allowed',
      'POST /_api/project/migrate main refused',
    ]);
    expect([0, 10, 11, 1].map(statusForExit)).toEqual([200, 200, 409, 500]);
  });
});
