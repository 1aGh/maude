// S8.15 — a 1.x peer meets per-use photo edits (V2-1.12: versioned files never break a v1 reader).
//
// The per-use edit adds no key to any v1 file: it is a NEW file (`assets/<img8>.<edit8>.photo.json`,
// a plain v1 PhotoEdit) plus one JSX attribute (`data-photo-edit`). Frozen 1.9.1 readers prove:
//   - every per-use file the v2 writer lands passes the strict v1 `validatePhotoEdit`;
//   - a 1.x studio answers its bridge's only question (`GET /_api/photo-edit?asset=` — the four
//     fetches in 1.9.1's canvas-lib name no edit) from the every-use file: a canvas whose one use
//     has its own edit shows the every-use look on a 1.x peer, or the original picture when
//     there is none — and never loses the per-use file;
//   - v1 TSX writers keep the attribute byte for byte; a v1 every-use save leaves per-use files alone.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyEdit, applyTextEdit } from '../canvas-edit.ts';
import type { Context } from '../context.ts';
import { createPhotoStore } from '../photo-store.ts';
import { validatePhotoEdit as validateV191 } from './fixtures/v1/photo-schema.v1.9.1.ts';
import { createPhotoStore as createV191Store } from './fixtures/v1/photo-store.v1.9.1.ts';

const IMG = 'a1b2c3d4';

function project() {
  const root = join(tmpdir(), `s815-v1-${Math.random().toString(36).slice(2)}`);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  const ctx = {
    paths: { designRoot, repoRoot: root },
    bus: { emit: () => {} },
  } as unknown as Context;
  return { v2: createPhotoStore(ctx), v1: createV191Store(ctx), designRoot, root };
}

const EDITS = [
  { adjustments: { contrast: 0.3, saturation: 0.2 } },
  { duotone: { enabled: true, colorA: '#1a1a2e', colorB: '#e94560', intensity: 0.8 } },
  { grain: { enabled: true, amount: 0.4, size: 1.5 } },
  { adjustments: { brightness: -0.1 }, mask: { preset: 'vignette', strength: 0.5 } },
];

describe('a 1.x reader and the per-use file', () => {
  test('every per-use file the v2 writer lands is a valid 1.9.1 PhotoEdit', async () => {
    const t = project();
    try {
      for (const e of EDITS) {
        const r = await t.v2.savePerUseEdit(IMG, e);
        if (!r.ok) throw new Error(r.error);
        const onDisk = JSON.parse(readFileSync(join(t.designRoot, r.path), 'utf8'));
        expect(validateV191(onDisk)).toEqual({ ok: true, errors: [] });
      }
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  test('a 1.x studio shows the original picture for a use with only a per-use edit', async () => {
    const t = project();
    try {
      const r = await t.v2.savePerUseEdit(`assets/${IMG}.png`, EDITS[0]);
      if (!r.ok) throw new Error(r.error);
      // 1.9.1's bridge asks `?asset=` and nothing else: no every-use file → no edit → original
      expect(await t.v1.getPhotoEdit(`assets/${IMG}.png`)).toBeNull();
      expect(existsSync(join(t.designRoot, r.path))).toBe(true);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  test('… and the every-use look when there is one; a v1 save of it keeps the per-use file', async () => {
    const t = project();
    try {
      const use = await t.v2.savePerUseEdit(IMG, EDITS[0]);
      if (!use.ok) throw new Error(use.error);
      const before = readFileSync(join(t.designRoot, use.path), 'utf8');
      expect((await t.v1.savePhotoEdit(IMG, EDITS[1])).ok).toBe(true);
      expect((await t.v1.getPhotoEdit(IMG))?.duotone?.colorB).toBe('#e94560');
      expect(readFileSync(join(t.designRoot, use.path), 'utf8')).toBe(before);
      // and v2 reads what the v1 peer wrote as the every-use look, the use's edit unchanged
      expect((await t.v2.getPhotoEdit(IMG))?.duotone?.colorB).toBe('#e94560');
      expect((await t.v2.getPerUseEdit(IMG, use.edit8))?.adjustments?.contrast).toBe(0.3);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });
});

describe('v1 TSX writers keep data-photo-edit', () => {
  const CANVAS = '/x/Posts.tsx';
  const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Posts() {
  return (
    <DesignCanvas>
      <DCArtboard id="mvp" label="Post 4:5" width={1080} height={1350}>
        <img data-cd-id="hero" src="../assets/${IMG}.png" data-photo-edit="0a1b2c3d" alt="" />
        <p data-cd-id="title">MVP zápasu</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
  test('a v1 style write on the photo leaves the attribute byte for byte', () => {
    const out = applyEdit(CANVAS, SRC, 'hero', 'style.opacity', '0.9').source;
    expect(out).toContain('data-photo-edit="0a1b2c3d"');
    expect(out.replace(' style={{ opacity: 0.9 }}', '')).toBe(SRC);
  });
  test('a v1 text write elsewhere on the artboard keeps it too', () => {
    const out = applyTextEdit(CANVAS, SRC, 'title', 'Hráč zápasu').source;
    expect(out).toContain('data-photo-edit="0a1b2c3d"');
  });
});
