// S8.1 — `POST /_api/export-estimate` and the v2 export doors' ACL (contract
// S8-export-spec.md §5.3, §5.5; V2-1.16 L7). Handler level, with the session injected: the
// route answers numbers from the index rows it is given, a canvas-only session can never reach
// Folder / Whole project (403 `not-in-scope`, the same body as a missing canvas), and an
// ungranted canvas answers exactly like a missing one.

import { describe, expect, test } from 'bun:test';

import { notInScopeResponse } from '../access/request.ts';
import { type Access, resolveAccess } from '../access/scope.ts';
import type { ExportHistoryEntry } from '../exporters/jobs.ts';
import type { SpecCanvas } from '../exporters/scope.ts';
import { createExportRoutes, type ExportRouteDeps, planExportV2 } from '../routes/export.ts';

const AB = (id: string, kind = 'digital', w = 1080, h = 1350) => ({ id, label: id, kind, w, h });
const CANVASES: SpecCanvas[] = [
  { rel: 'ui/a.tsx', artboards: [AB('hero'), AB('story'), AB('reel', 'video', 1080, 1920)] },
  { rel: 'ui/b.tsx', artboards: [AB('poster', 'print', 559, 794)] },
  { rel: 'ui/sub/c.tsx', artboards: [AB('one')] },
  { rel: 'brand/d.tsx', artboards: [AB('d1'), AB('d2')] },
];

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const VIEWER = resolveAccess({ v: 1, role: 'viewer' }); // Can comment — exports
const OBSERVER = resolveAccess({ v: 1, role: 'observer' }); // Can view — never exports
const GRANTED_A = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
const GRANTED_A_VIEW = resolveAccess({
  v: 1,
  role: null,
  grants: [{ c: 'ui/a.tsx', r: 'observer' }],
});

function deps(access: Access, history: ExportHistoryEntry[] = []): ExportRouteDeps {
  return {
    designRel: '.design',
    projectName: () => 'Alligators',
    canvases: () => CANVASES,
    activeCanvas: () => 'ui/a.tsx',
    access: () => access,
    history: () => history,
    renderLane: () => 'local',
  };
}

async function estimate(access: Access, spec: unknown, history: ExportHistoryEntry[] = []) {
  const [route] = createExportRoutes(deps(access, history));
  if (!route) throw new Error('no route');
  const res = await route.handle(
    new Request('http://127.0.0.1/_api/export-estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    }),
    {}
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const NOT_IN_SCOPE = await notInScopeResponse().json();

describe('POST /_api/export-estimate — numbers from the index', () => {
  test('the route is the one table spec, main origin, EXPORT class', () => {
    const [route] = createExportRoutes(deps(OWNER));
    expect([route?.method, route?.path, route?.origin]).toEqual([
      'POST',
      '/_api/export-estimate',
      'main',
    ]);
  });

  test('counts per scope, files, bytes, seconds, lane, byKind', async () => {
    const { status, body } = await estimate(OWNER, { v: 2, scope: 'canvas', format: 'png' });
    expect(status).toBe(200);
    expect(body.counts).toEqual({ selection: null, canvas: 3, folder: 5, project: 7 });
    // `reel` is a video artboard but the spec is PNG for every kind: three PNGs
    expect(body.files).toBe(3);
    expect(typeof body.bytes).toBe('number');
    expect(body.bytes as number).toBeGreaterThan(0);
    expect(body.seconds as number).toBeGreaterThan(0);
    expect(body.lane).toBe('this-mac');
    expect(body.basis).toEqual({ bytes: 'table', seconds: 'table' });
    expect(body.byKind).toEqual({
      digital: { artboards: 2, files: 2, format: 'png' },
      video: { artboards: 1, files: 1, format: 'png' },
    });
    expect(body.skipped).toEqual([]);
  });

  test('a bigger scale is more bytes; JPG is fewer than PNG (numbers, never copy)', async () => {
    const png1 = (
      await estimate(OWNER, {
        v: 2,
        scope: 'canvas',
        format: 'png',
        options: { size: { scale: 1 } },
      })
    ).body;
    const png2 = (
      await estimate(OWNER, {
        v: 2,
        scope: 'canvas',
        format: 'png',
        options: { size: { scale: 2 } },
      })
    ).body;
    const jpg = (
      await estimate(OWNER, {
        v: 2,
        scope: 'canvas',
        format: 'jpg',
        options: { size: { scale: 2 } },
      })
    ).body;
    expect(png2.bytes as number).toBeGreaterThan(png1.bytes as number);
    expect(jpg.bytes as number).toBeLessThan(png2.bytes as number);
  });

  test('skipped kinds carry a reason; whole project counts every visible canvas', async () => {
    const { body } = await estimate(OWNER, { v: 2, scope: 'project', format: 'mp4' });
    expect(body.files).toBe(1); // only `reel` is a video artboard
    expect((body.skipped as unknown[]).length).toBe(6);
    expect(
      (body.skipped as Array<{ reason: string }>).every((s) => s.reason === 'format-unit')
    ).toBe(true);
  });

  test('this Mac’s own throughput wins once there are enough samples', async () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString();
    const h = (secs: number): ExportHistoryEntry => ({
      format: 'png',
      scope: 'canvas-as-separate',
      filename: 'x.zip',
      at: at(secs),
      status: 'done',
      startedAt: at(0),
      finishedAt: at(secs),
    });
    const { body } = await estimate(OWNER, { v: 2, scope: 'canvas', format: 'png' }, [
      h(4),
      h(6),
      h(5),
    ]);
    expect(body.basis).toEqual({ bytes: 'table', seconds: 'history' });
    expect(body.seconds).toBe(5);
  });

  test('a bad spec is a 400 naming the field', async () => {
    const { status, body } = await estimate(OWNER, {
      v: 2,
      scope: 'canvas',
      format: 'png',
      huh: 1,
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'bad-spec', field: 'huh' });
  });
});

describe('the ACL (V2-1.16 L7) — estimate and the export doors agree', () => {
  test('Can view (observer) is refused; Can comment (viewer) is allowed', async () => {
    expect((await estimate(OBSERVER, { v: 2, scope: 'canvas', format: 'png' })).status).toBe(403);
    expect((await estimate(VIEWER, { v: 2, scope: 'project', format: 'png' })).status).toBe(200);
  });

  test('canvas-only: Folder / Whole project → 403 with the missing-file body', async () => {
    for (const spec of [
      { v: 2, scope: 'folder', folder: 'ui', format: 'png' },
      { v: 2, scope: 'project', format: 'zip' },
      { v: 2, scope: 'project', format: 'png' },
    ]) {
      const r = await estimate(GRANTED_A, spec);
      expect(r.status).toBe(403);
      expect(r.body).toEqual(NOT_IN_SCOPE);
      const plan = planExportV2(spec, deps(GRANTED_A));
      expect(plan.ok).toBe(false);
      if (!plan.ok) {
        expect(plan.response.status).toBe(403);
        expect(await plan.response.json()).toEqual(NOT_IN_SCOPE);
      }
    }
  });

  test('canvas-only: an ungranted canvas answers exactly like a missing one', async () => {
    const ungranted = await estimate(GRANTED_A, {
      v: 2,
      scope: 'canvas',
      canvas: 'ui/b.tsx',
      format: 'png',
    });
    const missing = await estimate(GRANTED_A, {
      v: 2,
      scope: 'canvas',
      canvas: 'ui/none.tsx',
      format: 'png',
    });
    expect(ungranted).toEqual(missing);
    expect(ungranted).toEqual({ status: 403, body: NOT_IN_SCOPE });
  });

  test('canvas-only: its own canvas works, and Folder / Whole project count as —', async () => {
    const r = await estimate(GRANTED_A, { v: 2, scope: 'canvas', format: 'png' });
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ selection: null, canvas: 3, folder: null, project: null });
  });

  test('canvas-only with Can view on its canvas: refused (no export there)', async () => {
    expect((await estimate(GRANTED_A_VIEW, { v: 2, scope: 'canvas', format: 'png' })).status).toBe(
      403
    );
  });
});

describe('planExportV2 — the v2 half of /_api/export(-jobs)', () => {
  test('a plan is one group: every unit, the project name, a stamped date', () => {
    const now = new Date(2026, 9, 18);
    const p = planExportV2(
      { v: 2, scope: 'folder', folder: 'ui', format: 'jpg' },
      deps(OWNER),
      undefined,
      now
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.group.project).toBe('Alligators');
    expect(p.group.date).toBe(now);
    expect(p.group.units.map((u) => [u.canvas, u.scope])).toEqual([
      ['ui/a.tsx', 'canvas-as-separate'],
      ['ui/b.tsx', 'canvas-as-separate'],
      ['ui/sub/c.tsx', 'canvas-as-separate'],
    ]);
    expect(p.first.format).toBe('jpg');
  });

  test('what cannot run yet is refused with its field, never silently dropped', async () => {
    // S8.1b lifted `at` and Display P3 for PNG/JPG on this Mac — what still refuses them (a workspace
    // lane, another format) is test/export-past-version-p3.test.ts
    for (const [spec, field] of [
      [{ v: 2, scope: 'canvas', format: 'pdf', at: { sha: 'abc1234' } }, 'at'],
      [
        { v: 2, scope: 'canvas', format: 'svg', options: { colorProfile: 'display-p3' } },
        'options.colorProfile',
      ],
      [
        { v: 2, scope: 'canvas', format: 'audio', byKind: { digital: { format: 'audio' } } },
        'format',
      ],
    ] as const) {
      const p = planExportV2(spec, deps(OWNER));
      expect(p.ok).toBe(false);
      if (!p.ok) {
        expect(p.response.status).toBe(400);
        expect(await p.response.json()).toMatchObject({ field });
      }
    }
  });

  test('wait:ai is accepted (S8.9) — the plan carries it for the queue to hold on', () => {
    const p = planExportV2({ v: 2, scope: 'canvas', format: 'png', wait: 'ai' }, deps(OWNER));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.group.spec.wait).toBe('ai');
  });

  test('nothing to export is a 422 with the reasons', async () => {
    const p = planExportV2(
      { v: 2, scope: 'canvas', canvas: 'ui/b.tsx', format: 'gif' },
      deps(OWNER)
    );
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.response.status).toBe(422);
      expect(await p.response.json()).toEqual({
        error: 'nothing-to-export',
        skipped: [{ name: 'poster', reason: 'format-unit' }],
      });
    }
  });
});
