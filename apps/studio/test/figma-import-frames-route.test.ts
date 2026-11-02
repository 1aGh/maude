// S8.17 — POST /_api/figma/frames + /_api/figma/import-frames (routes/figma.ts), the handler's own gate.
//
//   • Can edit on the PROJECT: a viewer, a commenter and a canvas-only session get 403 `forbidden` and the
//     verb is never called (no token spent, no network);
//   • the body is narrowed: 1–60 frame ids of the node-id shape, a folder and a name as bounded strings;
//   • failures are FIXED reasons — an upstream message never becomes a response string (DDR-216 D10);
//   • a landed canvas is announced so the Canvases list shows it.
// The cross-site / foreign-Host half is figma-routes.test.ts (a real boot).

import { describe, expect, test } from 'bun:test';
import { createFigmaRoutes, parsePicturesRequest } from '../routes/figma.ts';

type Role = 'view' | 'comment' | 'edit' | 'owner';
const rank: Record<Role, number> = { view: 0, comment: 1, edit: 2, owner: 3 };
const accessAs = (role: Role, canvasOnly = false) =>
  ({
    canvasOnly,
    can: (cap: string) => rank[role] >= rank[(cap === 'edit' ? 'edit' : 'view') as Role],
  }) as never;

const URL_D = 'https://www.figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027';
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function routes(role: Role, opts: { canvasOnly?: boolean; fail?: unknown } = {}) {
  const calls: unknown[] = [];
  const announced: string[] = [];
  const specs = createFigmaRoutes({
    root: '/repo',
    designRel: '.design',
    access: () => accessAs(role, opts.canvasOnly),
    list: async (r) => {
      calls.push(['list', r]);
      if (opts.fail) throw opts.fail;
      return {
        surface: 'design',
        fileName: 'Uniformy-2027',
        frames: [{ id: '2:1', name: 'A', width: 900, height: 1280 }],
      };
    },
    importPictures: async (r) => {
      calls.push(['import', r]);
      if (opts.fail) throw opts.fail;
      return { canvas: 'ui/Uniformy-2027.tsx', artboards: 1, dispositions: [] };
    },
    announce: (rel) => announced.push(rel),
  });
  const by = (path: string) => specs.find((s) => s.path === path) as (typeof specs)[number];
  return { by, calls, announced, specs };
}

describe('the table rows', () => {
  test('both are main-origin POSTs a read-only session may not call', () => {
    const { specs } = routes('edit');
    expect(specs.map((s) => [s.method, s.path, s.origin, s.readOnly])).toEqual([
      ['POST', '/_api/figma/frames', 'main', 'refused'],
      ['POST', '/_api/figma/import-frames', 'main', 'refused'],
    ]);
  });
});

describe('Can edit on the project', () => {
  for (const role of ['view', 'comment'] as Role[]) {
    test(`${role}: 403 forbidden, the verb is never called`, async () => {
      const { by, calls } = routes(role);
      const a = await by('/_api/figma/frames').handle(
        post('/_api/figma/frames', { url: URL_D }),
        {}
      );
      const b = await by('/_api/figma/import-frames').handle(
        post('/_api/figma/import-frames', { url: URL_D, frames: ['2:1'] }),
        {}
      );
      expect([a.status, b.status]).toEqual([403, 403]);
      expect(calls).toEqual([]);
    });
  }
  test('a canvas-only editor has no say over where new canvases go', async () => {
    const { by, calls } = routes('edit', { canvasOnly: true });
    const r = await by('/_api/figma/import-frames').handle(
      post('/_api/figma/import-frames', { url: URL_D, frames: ['2:1'] }),
      {}
    );
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });
  test('edit: lists, imports, and announces the new canvas', async () => {
    const { by, calls, announced } = routes('edit');
    const a = await by('/_api/figma/frames').handle(post('/_api/figma/frames', { url: URL_D }), {});
    expect(a.status).toBe(200);
    expect((await a.json()).frames[0]).toMatchObject({ id: '2:1', width: 900 });
    const b = await by('/_api/figma/import-frames').handle(
      post('/_api/figma/import-frames', {
        url: URL_D,
        frames: ['2:1', '2:1'],
        folder: 'ui',
        styles: true,
      }),
      {}
    );
    expect(b.status).toBe(200);
    expect(calls[1]).toEqual([
      'import',
      {
        url: URL_D,
        frames: ['2:1'],
        folder: 'ui',
        name: null,
        comments: true,
        styles: true,
        root: '/repo',
        designRootRel: '.design',
      },
    ]);
    expect(announced).toEqual(['ui/Uniformy-2027.tsx']);
  });
});

describe('the body is narrowed', () => {
  test.each([
    [{ url: URL_D }],
    [{ url: URL_D, frames: [] }],
    [{ url: URL_D, frames: ['../../x'] }],
    [{ url: URL_D, frames: Array.from({ length: 61 }, (_, i) => `1:${i}`) }],
    [{ url: URL_D, frames: ['1:1'], folder: 7 }],
    [{ url: URL_D, frames: ['1:1'], name: 'x'.repeat(81) }],
    [{ url: '', frames: ['1:1'] }],
  ])('refused: %j', (body) => {
    expect(parsePicturesRequest(body)).toBeNull();
  });
});

describe('a failure is a fixed reason, never a message', () => {
  const canary = 'UPSTREAM_SAID_figd_SECRETSECRET';
  test.each([
    [Object.assign(new Error(canary), { kind: 'not_configured' }), 400, 'not-connected'],
    [Object.assign(new Error(canary), { kind: 'rate_limited' }), 502, 'rate_limited'],
    [Object.assign(new Error(canary), { name: 'FigmaUrlError' }), 400, 'bad-url'],
    [Object.assign(new Error(canary), { code: 3 }), 422, 'not-on-page'],
    [new Error(canary), 500, 'failed'],
  ])('%#', async (fail, status, reason) => {
    const { by } = routes('edit', { fail });
    const r = await by('/_api/figma/import-frames').handle(
      post('/_api/figma/import-frames', { url: URL_D, frames: ['2:1'] }),
      {}
    );
    expect(r.status).toBe(status);
    const text = await r.text();
    expect(JSON.parse(text).reason).toBe(reason);
    expect(text).not.toContain(canary);
  });
});
