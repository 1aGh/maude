// P8 C2 (09 export) — POST /_api/export-preview: the artboard stills of what a spec reaches, through the project's picture
// service. Handler level: no server, no browser. The ACL is the export class (Can view refused), the spec goes through
// the same gate as the estimate (a canvas the session cannot see is not in the answer), and the answer fans out to at most
// MAX pictures.

import { describe, expect, test } from 'bun:test';

import { type Access, resolveAccess } from '../access/scope.ts';
import type { SpecCanvas } from '../exporters/scope.ts';
import { createExportRoutes, type ExportRouteDeps } from '../routes/export.ts';
import type { ThumbRequest, ThumbResult } from '../thumbs/service.ts';

const CANVASES: SpecCanvas[] = [
  {
    rel: 'ui/letak.tsx',
    artboards: [
      { id: 'a-flag', label: 'A · front', kind: 'print', w: 419, h: 581 },
      { id: 'b-flag', label: 'B · back', kind: 'print', w: 419, h: 581 },
    ],
  },
  {
    rel: 'ui/post.tsx',
    artboards: [{ id: 'p', label: 'Post', kind: 'digital', w: 1080, h: 1350 }],
  },
];
const OWNER = resolveAccess({ v: 1, role: 'owner' });
const OBSERVER = resolveAccess({ v: 1, role: 'observer' });

const asked: ThumbRequest[] = [];
const deps = (access: Access, withThumb = true): ExportRouteDeps => ({
  designRel: '.design',
  projectName: () => 'Alligators',
  canvases: () => CANVASES,
  activeCanvas: () => 'ui/letak.tsx',
  access: () => access,
  history: () => [],
  renderLane: () => 'local',
  retry: async () => ({ ok: false, reason: 'missing' }) as never,
  ...(withThumb
    ? {
        thumb: async (req: ThumbRequest): Promise<ThumbResult> => {
          asked.push(req);
          return { status: 'pending', key: `k${asked.length}` };
        },
      }
    : {}),
});

async function preview(access: Access, body: unknown, withThumb = true) {
  const route = createExportRoutes(deps(access, withThumb)).find(
    (r) => r.path === '/_api/export-preview'
  );
  if (!route) throw new Error('no /_api/export-preview route');
  const res = await route.handle(
    new Request('http://127.0.0.1/_api/export-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {}
  );
  return { status: res.status, route, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /_api/export-preview', () => {
  test('a main-origin EXPORT-class table spec that writes nothing', async () => {
    const { route } = await preview(OWNER, { spec: { v: 2, scope: 'canvas', format: 'png' } });
    expect([route.method, route.origin, route.readOnly]).toEqual(['POST', 'main', 'allowed']);
  });

  test('one still per artboard the spec reaches, asked of the picture service at card size', async () => {
    asked.length = 0;
    const { status, body } = await preview(OWNER, {
      spec: { v: 2, scope: 'canvas', canvas: 'ui/letak.tsx', format: 'pdf' },
    });
    expect(status).toBe(200);
    const items = body.items as Array<{ canvas: string; artboard: string; label: string }>;
    expect(items.map((i) => [i.canvas, i.artboard, i.label])).toEqual([
      ['ui/letak.tsx', 'a-flag', 'A · front'],
      ['ui/letak.tsx', 'b-flag', 'B · back'],
    ]);
    expect(asked.map((r) => [r.canvas, r.artboard, r.size, r.priority])).toEqual([
      ['ui/letak.tsx', 'a-flag', 'card', 'visible'],
      ['ui/letak.tsx', 'b-flag', 'card', 'visible'],
    ]);
  });

  test('no picture service: every row says why, the answer is still 200', async () => {
    const { status, body } = await preview(
      OWNER,
      { spec: { v: 2, scope: 'canvas', canvas: 'ui/post.tsx', format: 'png' } },
      false
    );
    expect(status).toBe(200);
    const items = body.items as Array<{ picture: { status: string; reason?: string } }>;
    expect(items[0]?.picture).toEqual({ status: 'unavailable', reason: 'no-engine' });
  });

  test('Can view is refused like every export; a stray key is a 400', async () => {
    expect(
      (await preview(OBSERVER, { spec: { v: 2, scope: 'canvas', format: 'png' } })).status
    ).toBe(403);
    expect(
      (await preview(OWNER, { spec: { v: 2, scope: 'canvas', format: 'png' }, x: 1 })).status
    ).toBe(400);
  });
});
