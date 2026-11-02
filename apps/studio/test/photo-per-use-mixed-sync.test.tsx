// S8.15 (UI half) — a v2 desktop and a 1.x peer on one project, BOTH directions (memory: sync is asymmetric; test
// it both ways). The v2 side writes through the Photo section's own helpers (`saveUseEdit` / `writeUseEdit` /
// `readSeed`, client/v2/photo/photo-section.jsx) against the real photo store and the real `photo.use-edit` op, so the
// bytes under test are the ones the UI lands. "Sync" moves what the file plane carries — classified by the studio
// classifier AND its hub mirror, which must agree — and the canvas TSX (its own lane) between two project trees.
//
//   v2 → v1: the per-use file and the attribute arrive; the 1.x reader validates the file, renders the every-use
//            look (or the original), and a 1.x TSX write keeps `data-photo-edit` byte for byte.
//   v1 → v2: a 1.x every-use save and that TSX come back; the v2 Photo section still seeds the use from its own
//            edit, the other use from the 1.x every-use look, and the per-use file is untouched.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { classifyProjectFile as hubClassify } from '../../hub/src/file-membership.mjs';
import { applyEdit } from '../canvas-edit.ts';
import type { Context } from '../context.ts';
import { photoUseEdit } from '../edit-ops/photo-use.ts';
import type { ResolvedEditOp } from '../edit-ops/types.ts';
import { createPhotoStore } from '../photo-store.ts';
import { classifyProjectFile, isFilePlaneClass } from '../sync/file-membership.ts';
import { validatePhotoEdit as validateV191 } from './fixtures/v1/photo-schema.v1.9.1.ts';
import { createPhotoStore as createV191Store } from './fixtures/v1/photo-store.v1.9.1.ts';

const IMG = 'a1b2c3d4';
const ASSET = `assets/${IMG}.png`;
const CANVAS = 'ui/Posts.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Posts() {
  return (
    <DesignCanvas>
      <DCArtboard id="mvp" label="Post 4:5" width={1080} height={1350}>
        <img data-cd-id="hero" src="../assets/${IMG}.png" alt="" />
        <img data-cd-id="score" src="../assets/${IMG}.png" alt="" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let ui: typeof import('../client/v2/photo/photo-section.jsx');
const roots: string[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  ui = await import('../client/v2/photo/photo-section.jsx');
});
afterAll(() => {
  GlobalRegistrator.unregister();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function peer(kind: 'v2' | 'v1') {
  const root = join(tmpdir(), `s815c-${kind}-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const ctx = {
    paths: { designRoot, repoRoot: root },
    bus: { emit: () => {} },
  } as unknown as Context;
  return {
    designRoot,
    tsx: SRC,
    v2: createPhotoStore(ctx),
    v1: createV191Store(ctx),
  };
}
type Peer = ReturnType<typeof peer>;

/** The studio routes the Photo section talks to, over one peer's real store and the real edit-op. */
function studioFetch(p: Peer) {
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const method = init?.method ?? 'GET';
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
    if (url.pathname === '/_api/photo-edit') {
      const asset = url.searchParams.get('asset');
      const edit = url.searchParams.get('edit');
      if (method === 'GET')
        return json(
          (edit ? await p.v2.getPerUseEdit(asset, edit) : await p.v2.getPhotoEdit(asset)) ?? {}
        );
      if (url.searchParams.get('perUse') === '1') {
        const r = await p.v2.savePerUseEdit(asset, JSON.parse(String(init?.body)));
        return r.ok ? json({ ok: true, path: r.path, edit: r.edit8 }) : json(r, r.status);
      }
    }
    if (url.pathname === '/_api/edit-op') {
      const body = JSON.parse(String(init?.body));
      try {
        const out = photoUseEdit.apply(p.tsx, body as ResolvedEditOp) as { source: string };
        p.tsx = out.source;
        return json({ ok: true, writeId: 'w1', actionId: null });
      } catch (e) {
        return json({ ok: false, message: String(e) }, 409);
      }
    }
    return json({ ok: false }, 404);
  }) as unknown as typeof fetch;
}

/** Every file the file plane carries, by BOTH classifiers (they must agree), plus the canvas on its own lane. */
function sync(from: Peer, to: Peer) {
  for (const name of readdirSync(join(from.designRoot, 'assets'))) {
    const rel = `assets/${name}`;
    const studio = classifyProjectFile(rel);
    expect(hubClassify(rel)).toBe(studio);
    if (!isFilePlaneClass(studio)) continue;
    cpSync(join(from.designRoot, rel), join(to.designRoot, rel));
  }
  expect(classifyProjectFile(CANVAS)).toBe('canvas-owned');
  to.tsx = from.tsx;
}

const hero = { id: 'hero', index: 0, artboardId: 'mvp', file: CANVAS };
/** The `data-photo-edit` on the `<img>` with this id (attribute order is the writer's). */
const attrOf = (src: string, id: string) => {
  const tag = src.match(/<img\b[^>]*>/g)?.find((t) => t.includes(`data-cd-id="${id}"`)) ?? '';
  return /data-photo-edit="([0-9a-f]+)"/.exec(tag)?.[1] ?? null;
};

describe('v2 → v1', () => {
  test('the per-use edit arrives whole; the 1.x peer reads it as v1, shows the every-use look and keeps it', async () => {
    const a = peer('v2');
    const b = peer('v1');
    const own = { adjustments: { grayscale: 1, exposure: 0.12 } };
    const saved = await ui.saveUseEdit(
      { asset: ASSET, canvas: CANVAS, el: hero, edit: own, current: null },
      studioFetch(a)
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(attrOf(a.tsx, 'hero')).toBe(saved.edit8);
    expect(attrOf(a.tsx, 'score')).toBeNull();

    sync(a, b);
    const rel = `assets/${IMG}.${saved.edit8}.photo.json`;
    expect(existsSync(join(b.designRoot, rel))).toBe(true);
    expect(validateV191(JSON.parse(readFileSync(join(b.designRoot, rel), 'utf8')))).toEqual({
      ok: true,
      errors: [],
    });
    // 1.9.1's bridge asks only `?asset=`: no every-use edit yet → the original picture on every use
    expect(await b.v1.getPhotoEdit(ASSET)).toBeNull();
    // a 1.x TSX write on the picture keeps the attribute byte for byte
    b.tsx = applyEdit(`/x/${CANVAS}`, b.tsx, 'hero', 'style.opacity', '0.9').source;
    expect(attrOf(b.tsx, 'hero')).toBe(saved.edit8);
  });
});

describe('v1 → v2', () => {
  test('a 1.x every-use save comes back; v2 still seeds each use from what it shows', async () => {
    const a = peer('v2');
    const b = peer('v1');
    const own = { duotone: { enabled: true, colorA: '#0b2418', colorB: '#a8f0c0', intensity: 1 } };
    const saved = await ui.saveUseEdit(
      { asset: ASSET, canvas: CANVAS, el: hero, edit: own, current: null },
      studioFetch(a)
    );
    if (!saved.ok) throw new Error(saved.message);
    sync(a, b);
    const ownRel = join(b.designRoot, `assets/${IMG}.${saved.edit8}.photo.json`);
    const ownBytes = readFileSync(ownRel, 'utf8');

    // the 1.x peer changes the every-use look and the canvas, and syncs back
    const every = { adjustments: { contrast: 0.25, brightness: 0.04 } };
    expect((await b.v1.savePhotoEdit(IMG, every)).ok).toBe(true);
    b.tsx = applyEdit(`/x/${CANVAS}`, b.tsx, 'score', 'style.opacity', '0.8').source;
    expect(readFileSync(ownRel, 'utf8')).toBe(ownBytes);
    sync(b, a);

    // the use with its own edit still opens on it; the other opens on the 1.x every-use look
    const f = studioFetch(a);
    const heroAttr = attrOf(a.tsx, 'hero');
    expect(heroAttr).toBe(saved.edit8);
    expect(await ui.readSeed(ASSET, heroAttr, f)).toMatchObject(own);
    expect(await ui.readSeed(ASSET, attrOf(a.tsx, 'score'), f)).toMatchObject(every);

    // and Reset on v2 points the use back at what the 1.x peer chose for every use
    const r = await ui.writeUseEdit({ canvas: CANVAS, el: hero, edit8: null }, f);
    expect(r.ok).toBe(true);
    expect(attrOf(a.tsx, 'hero')).toBeNull();
    expect(a.tsx).toContain('opacity: 0.8');
  });
});
