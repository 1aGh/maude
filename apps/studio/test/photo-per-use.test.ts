// S8.15 — photo edits per use (contract S8-asset-sidecars §5.1, §5.6).
//
// One use of a picture gets its own edit: a v1 PhotoEdit stored content-addressed at
// `assets/<img8>.<edit8>.photo.json` and named on the element by `data-photo-edit="<edit8>"`.
// The every-use file `assets/<img8>.photo.json` keeps its v1 meaning. Proven here:
//   - the name is the canonical hash of the bytes written; the same edit twice is one file;
//     a collision lengthens the name, never overwrites;
//   - `edit` outside /^[0-9a-f]{8,16}$/ is refused before any path is built;
//   - the local gate passes the bytes to `writes()`: a canvas-only editor may create a use's
//     edit of a picture its canvas references, nothing else, and repeating it is no overwrite;
//   - the attribute travels with the element: duplicate an artboard, copy or rename the canvas.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closureFor, type ProjectReader, perUsePhotoRefs } from '../access/closure.ts';
import { type GateInput, localGate } from '../access/request.ts';
import { photoEditHash, resolveAccess } from '../access/scope.ts';
import type { Context } from '../context.ts';
import { artboardDuplicate } from '../edit-ops/duplicate-at-width.ts';
import type { ResolvedEditOp } from '../edit-ops/types.ts';
import { createPhotoStore } from '../photo-store.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const IMG = 'a1b2c3d4';
const B_ONLY = 'd1d2d3d4';
const PUNCHY = { adjustments: { contrast: 0.3, saturation: 0.2 } };

function store() {
  const root = join(tmpdir(), `s815-${Math.random().toString(36).slice(2)}`);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  const emitted: string[] = [];
  const ctx = {
    paths: { designRoot, repoRoot: root },
    bus: { emit: (_e: string, rel: string) => emitted.push(rel) },
  } as unknown as Context;
  return { s: createPhotoStore(ctx), designRoot, root, emitted };
}

const putReq = (asset: string, body: unknown, q = 'perUse=1') =>
  new Request(`http://localhost/_api/photo-edit?asset=${asset}&${q}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('the per-use file is named by its bytes', () => {
  test('edit8 = the first 8 hex of the canonical hash of what lands on disk', async () => {
    const { s, designRoot, root, emitted } = store();
    try {
      const r = await s.savePerUseEdit(`assets/${IMG}.png`, PUNCHY);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const onDisk = JSON.parse(readFileSync(join(designRoot, r.path), 'utf8'));
      expect(r.edit8).toBe(photoEditHash(onDisk).slice(0, 8));
      expect(r.path).toBe(`assets/${IMG}.${r.edit8}.photo.json`);
      expect(onDisk.version).toBe(1);
      expect(emitted).toEqual([r.path]);
      // the every-use file is not touched
      expect(existsSync(join(designRoot, `assets/${IMG}.photo.json`))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the same edit twice (any key order) is one file; a different edit is another', async () => {
    const { s, root, emitted } = store();
    try {
      const a = await s.savePerUseEdit(IMG, PUNCHY);
      const b = await s.savePerUseEdit(IMG, { adjustments: { saturation: 0.2, contrast: 0.3 } });
      const c = await s.savePerUseEdit(IMG, { adjustments: { contrast: 0.4 } });
      expect(a.ok && b.ok && c.ok).toBe(true);
      if (!a.ok || !b.ok || !c.ok) return;
      expect(b.edit8).toBe(a.edit8);
      expect(c.edit8).not.toBe(a.edit8);
      expect(emitted).toEqual([a.path, c.path]); // the repeat wrote nothing
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a collision lengthens the name to 12 hex and keeps the other bytes', async () => {
    const { s, designRoot, root } = store();
    try {
      const plan = await s.planPerUseEdit(IMG, PUNCHY);
      if (!plan.ok) throw new Error('plan');
      const squatter = join(designRoot, plan.rel);
      writeFileSync(squatter, JSON.stringify({ version: 1, adjustments: { contrast: -1 } }));
      const r = await s.savePerUseEdit(IMG, PUNCHY);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.edit8).toHaveLength(12);
      expect(r.edit8.startsWith(plan.edit8)).toBe(true);
      expect(JSON.parse(readFileSync(squatter, 'utf8')).adjustments.contrast).toBe(-1);
      expect((await s.getPerUseEdit(IMG, r.edit8))?.adjustments?.contrast).toBe(0.3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an edit name outside 8–16 hex never builds a path', async () => {
    const { s, root } = store();
    try {
      for (const bad of ['../x', '..%2fx', 'ABCDEF12', 'abc', 'a'.repeat(17), `0badf00d/../x`]) {
        expect(await s.getPerUseEdit(IMG, bad)).toBeNull();
        const req = new Request(`http://localhost/_api/photo-edit?asset=${IMG}&edit=${bad}`);
        expect(await s.gateTarget(req)).toBeNull();
      }
      expect(await s.savePerUseEdit(IMG, { bogus: 1 })).toMatchObject({ ok: false, status: 400 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── the local gate passes the bytes to writes() ──────────────────────────────
describe('a canvas-only session through the local gate', () => {
  const reader = (files: Record<string, string>): ProjectReader => ({
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    head: () => 'h1',
  });
  const FILES: Record<string, string> = {
    'ui/A.tsx': `export default () => <img src="../assets/${IMG}.png" />;`,
    'ui/B.tsx': `export default () => <><img src="../assets/${IMG}.png" /><img src="../assets/${B_ONLY}.png" /></>;`,
    [`assets/${IMG}.png`]: 'png',
    [`assets/${B_ONLY}.png`]: 'png',
  };
  const gate = (
    s: ReturnType<typeof store>['s'],
    r: 'member' | 'viewer',
    o: Partial<GateInput> = {}
  ) => {
    const access = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/A.tsx', r }] });
    const closure = closureFor(access, reader(FILES));
    return {
      access,
      designRel: '.design',
      closure: () => closure,
      exists: (rel: string, body?: string) =>
        body === undefined ? rel in FILES : s.holdsOther(rel, body),
      targetFor: (req: Request) => s.gateTarget(req),
      bodyFor: (req: Request) => s.gateBody(req),
      ...o,
    } satisfies GateInput;
  };

  test('A’s member creates a use’s edit of a picture A references; again is no overwrite', async () => {
    const t = store();
    try {
      const g = gate(t.s, 'member');
      expect(await localGate(putReq(IMG, PUNCHY), '/_api/photo-edit', g)).toEqual({ ok: true });
      expect((await t.s.savePerUseEdit(IMG, PUNCHY)).ok).toBe(true);
      expect(await localGate(putReq(IMG, PUNCHY), '/_api/photo-edit', g)).toEqual({ ok: true });
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  test('a picture only B uses, a viewer grant, a door that passes no bytes: refused', async () => {
    const t = store();
    try {
      const refused = [
        await localGate(putReq(B_ONLY, PUNCHY), '/_api/photo-edit', gate(t.s, 'member')),
        await localGate(putReq(IMG, PUNCHY), '/_api/photo-edit', gate(t.s, 'viewer')),
        await localGate(
          putReq(IMG, PUNCHY),
          '/_api/photo-edit',
          gate(t.s, 'member', { bodyFor: undefined })
        ),
      ];
      for (const v of refused) expect(v.ok).toBe(false);
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });

  test('a squatter with other bytes under the name is never overwritten through the gate', async () => {
    const t = store();
    try {
      const g = gate(t.s, 'member');
      const plan = await t.s.planPerUseEdit(IMG, PUNCHY);
      if (!plan.ok) throw new Error('plan');
      // the gate's target moves to the lengthened name; the squatter's own name stays refused
      writeFileSync(join(t.designRoot, plan.rel), '{"version":1}');
      expect(await t.s.gateTarget(putReq(IMG, PUNCHY))).not.toBe(plan.rel);
      expect(t.s.holdsOther(plan.rel, plan.bytes)).toBe(true);
      expect(await localGate(putReq(IMG, PUNCHY), '/_api/photo-edit', g)).toEqual({ ok: true });
    } finally {
      rmSync(t.root, { recursive: true, force: true });
    }
  });
});

// ── the attribute travels with the element ───────────────────────────────────
describe('a per-use edit survives duplicate, copy and rename', () => {
  const E8 = '0a1b2c3d';
  const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Posts() {
  return (
    <DesignCanvas>
      <DCArtboard id="mvp" label="Post 4:5 · MVP" width={1080} height={1350}>
        <img data-cd-id="hero" src="../assets/${IMG}.png" data-photo-edit="${E8}" alt="" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
  const want = `assets/${IMG}.${E8}.photo.json`;

  test('Duplicate artboard: both uses keep the attribute, so both read the edit', () => {
    const req = {
      file: 'ui/Posts.tsx',
      params: { items: [{ artboard: 'mvp' }] },
      targets: [],
    } as unknown as ResolvedEditOp;
    const out = artboardDuplicate.apply(SRC, req);
    if (!('source' in out) || typeof out.source !== 'string') throw new Error(JSON.stringify(out));
    expect(out.source.match(/data-photo-edit="0a1b2c3d"/g)).toHaveLength(2);
    expect(perUsePhotoRefs(out.source)).toContain(want);
  });

  test('a copied or renamed canvas file grants the same per-use edit', () => {
    const files = { 'ui/Renamed copy.tsx': SRC, [`assets/${IMG}.png`]: 'png', [want]: '{}' };
    const access = resolveAccess({
      v: 1,
      role: null,
      grants: [{ c: 'ui/Renamed copy.tsx', r: 'viewer' }],
    });
    const closure = closureFor(access, {
      list: () => Object.keys(files),
      text: (rel) => (files as Record<string, string>)[rel] ?? null,
      head: () => 'h',
    });
    expect(closure.read.has(want)).toBe(true);
  });
});

// ── the route, on a real server ──────────────────────────────────────────────
describe('/_api/photo-edit per use (main origin)', () => {
  test('PUT ?perUse=1 names the edit; GET ?edit= reads it; the every-use read is unchanged', async () => {
    const sandbox = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(sandbox.root, port);
    const base = `http://localhost:${port}/_api/photo-edit?asset=assets/${IMG}.png`;
    try {
      const put = await fetch(`${base}&perUse=1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(PUNCHY),
      });
      expect(put.status).toBe(200);
      const j = (await put.json()) as { edit: string; path: string };
      expect(j.edit).toMatch(/^[0-9a-f]{8}$/);
      expect(j.path).toBe(`assets/${IMG}.${j.edit}.photo.json`);
      const one = await (await fetch(`${base}&edit=${j.edit}`)).json();
      expect(one.adjustments.contrast).toBe(0.3);
      expect(await (await fetch(base)).json()).toEqual({});
      expect((await fetch(`${base}&edit=..%2Fx`)).status).toBe(400);
      expect(
        (await fetch(`${base}&edit=..%2Fx&perUse=1`, { method: 'PUT', body: '{}' })).status
      ).toBe(400);
    } finally {
      await killProc(proc);
    }
  });
});
