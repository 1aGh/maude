// S8.15 — Apply to every use (contract S8-asset-sidecars §5.1; 12 · ia-photo-steps).
//
// The sheet names each canvas that shows the picture; Apply writes the every-use edit
// `assets/<img8>.photo.json` and takes `data-photo-edit` off every use (`photo.every-use`, one action
// per canvas). A session that may not change every canvas that uses the picture (G2) gets the action
// disabled with the generic reason — and a canvas-only session is never told the other canvases' names.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closureFor } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { type Access, resolveAccess } from '../access/scope.ts';
import type { Context } from '../context.ts';
import { photoEveryUse } from '../edit-ops/photo-every-use.ts';
import type { ResolvedEditOp } from '../edit-ops/types.ts';
import { createPhotoStore } from '../photo-store.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { EVERY_USE_REFUSAL } from '../routes/photo-every-use.ts';

const IMG = 'a1b2c3d4';
const PIC = `assets/${IMG}.jpg`;
const OTHER = 'assets/e5e6e7e8.jpg';

const canvas = (board: string, uses: string[]) => `export default function C() {
  return (
    <DCArtboard id="${board}" label="Post ${board}" width={400} height={400}>
${uses.map((u) => `      ${u}`).join('\n')}
    </DCArtboard>
  );
}
`;

function project() {
  const root = join(tmpdir(), `s815b-${Math.random().toString(36).slice(2)}`);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, PIC), 'jpg');
  writeFileSync(join(designRoot, OTHER), 'jpg');
  const files: Record<string, string> = {
    'ui/A.tsx': canvas('a', [
      `<img data-cd-id="hero" src="${PIC}" data-photo-edit="0011aabb" alt="" />`,
      `<img data-cd-id="side" src="${PIC}" alt="" />`,
      `<img data-cd-id="keep" src="${OTHER}" data-photo-edit="99887766" alt="" />`,
    ]),
    'ui/B.tsx': canvas('b', [`<img data-cd-id="hero" src="${PIC}" alt="" />`]),
    'ui/C.tsx': canvas('c', [
      `<img data-cd-id="hero" src="${PIC}" data-photo-edit="22334455" alt="" />`,
    ]),
  };
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(designRoot, rel), text);
  const ctx = {
    paths: { designRoot, repoRoot: root },
    bus: { emit: () => {} },
  } as unknown as Context;
  const store = createPhotoStore(ctx);
  let head = 0;
  const reader = diskProjectReader(designRoot, () => String(head));
  let session: Access = resolveAccess({ v: 1, role: 'owner' });
  const specs = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    photoEveryUse: {
      access: () => session,
      closure: (a) => (a.grants.length ? closureFor(a, reader) : null),
      usedIn: (rel) => (rel === PIC ? ['ui/A.tsx', 'ui/B.tsx', 'ui/C.tsx'] : []),
      read: (rel) => {
        try {
          return readFileSync(join(designRoot, rel), 'utf8');
        } catch {
          return null;
        }
      },
      exists: (rel) => existsSync(join(designRoot, rel)),
      saveEveryUse: (asset, edit) => store.savePhotoEdit(asset, edit),
    },
  });
  const get = specs.find((s) => s.path === '/_api/photo-every-use' && s.method === 'GET');
  const post = specs.find((s) => s.path === '/_api/photo-every-use' && s.method === 'POST');
  if (!get || !post) throw new Error('the route is not served');
  return {
    root,
    designRoot,
    read: (rel: string) => readFileSync(join(designRoot, rel), 'utf8'),
    as(a: Access) {
      session = a;
      head++;
    },
    async list(asset = PIC) {
      const r = await get.handle(
        new Request(`http://localhost/_api/photo-every-use?asset=${asset}`),
        {} as never
      );
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    },
    async apply(edit: unknown = { adjustments: { contrast: 0.3 } }) {
      const r = await post.handle(
        new Request('http://localhost/_api/photo-every-use', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ asset: PIC, edit }),
        }),
        {} as never
      );
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    },
  };
}

const grants = (...c: string[]) =>
  resolveAccess({ v: 1, role: null, grants: c.map((x) => ({ c: x, r: 'member' })) });

describe('photo.every-use — every use in the canvas goes back to the every-use look', () => {
  test('removes data-photo-edit from each use of the picture, and only from those', () => {
    const src = canvas('a', [
      `<img data-cd-id="one" src="${PIC}" data-photo-edit="0011aabb" alt="" />`,
      `<img src="${PIC}" data-photo-edit="0011aabc" alt="" />`,
      `<img data-cd-id="two" src="${PIC}" data-photo-edit="0011aabd" data-cd-locked="true" alt="" />`,
      `<img data-cd-id="keep" src="${OTHER}" data-photo-edit="99887766" alt="" />`,
    ]);
    const out = photoEveryUse.apply(src, {
      file: 'ui/A.tsx',
      op: 'photo.every-use',
      targets: [],
      params: { asset: PIC },
    } as ResolvedEditOp);
    expect(out.source).not.toContain('0011aabb');
    expect(out.source).not.toContain('0011aabc'); // a use with no id yet is stamped, then cleared
    expect(out.source).toContain('0011aabd'); // a locked use keeps its own edit
    expect(out.source).toContain('99887766'); // another picture's edit is not this one's
  });
});

describe('/_api/photo-every-use — the sheet and Apply', () => {
  test('the sheet names every canvas that shows the picture, and how many uses have their own edit', async () => {
    const p = project();
    try {
      const { status, body } = await p.list();
      expect(status).toBe(200);
      expect(body.canApply).toBe(true);
      expect(body.reason).toBeUndefined();
      expect(body.uses).toEqual([
        { canvas: 'ui/A.tsx', name: 'A', artboards: ['Post a'], own: 1 },
        { canvas: 'ui/B.tsx', name: 'B', artboards: ['Post b'], own: 0 },
        { canvas: 'ui/C.tsx', name: 'C', artboards: ['Post c'], own: 1 },
      ]);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('Apply writes the every-use edit and takes each use back to it', async () => {
    const p = project();
    try {
      const { status, body } = await p.apply();
      expect(status).toBe(200);
      expect(body.path).toBe(`assets/${IMG}.photo.json`);
      expect(JSON.parse(p.read(`assets/${IMG}.photo.json`)).adjustments).toEqual({ contrast: 0.3 });
      expect(body.canvases).toEqual([
        { canvas: 'ui/A.tsx', ok: true },
        { canvas: 'ui/C.tsx', ok: true },
      ]);
      expect(p.read('ui/A.tsx')).not.toContain('0011aabb');
      expect(p.read('ui/A.tsx')).toContain('99887766');
      expect(p.read('ui/C.tsx')).not.toContain('data-photo-edit');
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('a canvas-only editor of one canvas: told only its own canvas, Apply disabled with the G2 line, refused', async () => {
    const p = project();
    try {
      p.as(grants('ui/A.tsx'));
      const { status, body } = await p.list();
      expect(status).toBe(200);
      expect(body.canApply).toBe(false);
      expect(body.reason).toBe(EVERY_USE_REFUSAL);
      expect((body.uses as Array<{ canvas: string }>).map((u) => u.canvas)).toEqual(['ui/A.tsx']);
      expect(JSON.stringify(body)).not.toContain('ui/B');
      const r = await p.apply();
      expect(r.status).toBe(403);
      expect(r.body.message).toBe(EVERY_USE_REFUSAL);
      expect(existsSync(join(p.designRoot, `assets/${IMG}.photo.json`))).toBe(false);
      expect(p.read('ui/A.tsx')).toContain('0011aabb');
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('a canvas-only session asking about a picture its canvases do not show is told nothing', async () => {
    const p = project();
    try {
      writeFileSync(join(p.designRoot, 'ui/B.tsx'), canvas('b', ['<p>no picture</p>']));
      p.as(grants('ui/B.tsx'));
      const { status, body } = await p.list();
      expect(status).toBe(404);
      expect(body.uses).toBeUndefined();
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('a viewer may read the sheet but never Apply', async () => {
    const p = project();
    try {
      p.as(resolveAccess({ v: 1, role: 'viewer' }));
      expect((await p.list()).body.canApply).toBe(false);
      expect((await p.apply()).status).toBe(403);
      expect(existsSync(join(p.designRoot, `assets/${IMG}.photo.json`))).toBe(false);
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });

  test('an edit that is not a PhotoEdit writes nothing', async () => {
    const p = project();
    try {
      const r = await p.apply({ adjustments: { contrast: 9 }, extra: true });
      expect(r.status).toBe(400);
      expect(existsSync(join(p.designRoot, `assets/${IMG}.photo.json`))).toBe(false);
      expect(p.read('ui/A.tsx')).toContain('0011aabb');
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  });
});
