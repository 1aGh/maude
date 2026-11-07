// Phase 4 T5 — `/_api/canvas-meta` GET/PATCH endpoint round-trip.
// DDR-115 — per-user camera split: `viewport` lives in a gitignored per-machine
// view file (`_canvas-state/<slug>.view.json`), NEVER inline in the versioned
// `.meta.json`. PATCH splits the lanes; GET merges them back.
//
// Verifies:
//   - PATCH `viewport` leaves `.meta.json` BYTE-UNCHANGED + writes the view file
//     (the mouse-move churn killer) — and a viewport-only patch on a meta-less
//     canvas still succeeds
//   - PATCH clamps zoom to [0.1, 4.0] / rejects non-finite coords (view file)
//   - GET merges the view file's viewport into the returned meta
//   - GET strips a stale inline viewport from a legacy meta
//   - PATCH `layout` writes meta AND bumps `last_modified` (a real shared change)
//   - PATCH layout persists position-only entries (DDR-027)
//   - Paths that escape repoRoot are 404

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

interface MetaShape {
  title?: string;
  sections?: unknown[];
  viewport?: { x: number; y: number; zoom: number };
  layout?: { artboards: unknown[] };
  last_modified?: string;
  [k: string]: unknown;
}

function repoRel(designRoot: string, abs: string): string {
  // designRoot ends in `.design`. repoRoot is its parent.
  const repoRoot = designRoot.replace(/\.design$/, '').replace(/\/+$/, '');
  return abs.startsWith(`${repoRoot}/`) ? abs.slice(repoRoot.length + 1) : abs;
}

/** `_canvas-state/<slug>.view.json` for a `<designRoot>/ui/<Name>.tsx` canvas. */
function viewPath(designRoot: string, slug: string): string {
  return join(designRoot, '_canvas-state', `${slug}.view.json`);
}

describe('/_api/canvas-meta — GET/PATCH (DDR-115 camera split)', () => {
  test('PATCH viewport leaves meta byte-unchanged + writes the view file (churn killer)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Phase4.tsx');
      writeFileSync(tsxAbs, 'export default function P(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(
        metaAbs,
        JSON.stringify({
          title: 'Phase 4',
          sections: [{ id: 'overview', label: 'Overview' }],
          ai_context: { pinned_decisions: ['keep dc-* classes'] },
        })
      );
      const before = readFileSync(metaAbs, 'utf8');
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 12, y: 34, zoom: 1.5 } } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      // The returned object is GET-shaped: shared keys + the camera merged in.
      expect(merged.title).toBe('Phase 4');
      expect(merged.sections).toBeDefined();
      expect(merged.ai_context).toBeDefined();
      expect(merged.viewport).toEqual({ x: 12, y: 34, zoom: 1.5 });

      // KEYSTONE — the versioned meta is byte-identical; no viewport, no
      // last_modified bump on a viewport-only patch.
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);

      // The camera landed in the gitignored per-machine view file.
      const vAbs = viewPath(designRoot, 'ui-phase4');
      expect(existsSync(vAbs)).toBe(true);
      const view = JSON.parse(readFileSync(vAbs, 'utf8'));
      expect(view.viewport).toEqual({ x: 12, y: 34, zoom: 1.5 });
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH viewport succeeds on a canvas with no meta yet (writes only the view file)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'NoMeta.tsx');
      writeFileSync(tsxAbs, 'export default function N(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 1, y: 2, zoom: 2 } } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      expect(merged.viewport).toEqual({ x: 1, y: 2, zoom: 2 });
      // No meta was conjured into existence.
      expect(existsSync(metaAbs)).toBe(false);
      expect(existsSync(viewPath(designRoot, 'ui-nometa'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH clamps zoom to [0.02, 4.0]', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Clamp.tsx');
      writeFileSync(tsxAbs, 'export default function C(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), '{"title":"Clamp"}');
      const file = repoRel(designRoot, tsxAbs);

      const r1 = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 0, y: 0, zoom: 99 } } }),
      });
      const m1 = (await r1.json()) as MetaShape;
      expect(m1.viewport?.zoom).toBe(4);

      const r2 = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 0, y: 0, zoom: 0.0001 } } }),
      });
      const m2 = (await r2.json()) as MetaShape;
      expect(m2.viewport?.zoom).toBe(0.02);
    } finally {
      await killProc(proc);
    }
  });

  // Issue #91 — a board wider than ~10x the viewport needs a zoom below the
  // OLD 0.1 floor to ever be framed whole ("fit to screen") or dragged across
  // in one motion. Before the fix, this value was silently re-clamped up to
  // 0.1 on save, so even a client that could reach 0.05 lost it on reload.
  test('PATCH preserves a deep zoom-out that the old [0.1, 4.0] floor used to clamp away (issue #91)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'DeepZoom.tsx');
      writeFileSync(tsxAbs, 'export default function D(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), '{"title":"DeepZoom"}');
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 0, y: 0, zoom: 0.05 } } }),
      });
      const m = (await r.json()) as MetaShape;
      expect(m.viewport?.zoom).toBe(0.05);

      // Round-trips through a fresh GET too (the persisted view file, not just
      // the PATCH response) — this is what a page reload would read back.
      const g = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      const gm = (await g.json()) as MetaShape;
      expect(gm.viewport?.zoom).toBe(0.05);
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH ignores non-finite viewport (NaN/Infinity) — keeps the prior camera', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Bad.tsx');
      writeFileSync(tsxAbs, 'export default function B(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), '{"title":"Bad"}');
      const file = repoRel(designRoot, tsxAbs);

      // Seed a valid camera (writes the view file).
      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 1, y: 2, zoom: 1 } } }),
      });

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 'nope', y: null, zoom: 1 } } }),
      });
      const m = (await r.json()) as MetaShape;
      // Prior valid camera preserved (the bad patch was a no-op for the view file).
      expect(m.viewport).toEqual({ x: 1, y: 2, zoom: 1 });
      const view = JSON.parse(readFileSync(viewPath(designRoot, 'ui-bad'), 'utf8'));
      expect(view.viewport).toEqual({ x: 1, y: 2, zoom: 1 });
    } finally {
      await killProc(proc);
    }
  });

  test('GET merges the view file viewport into the returned meta', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Merge.tsx');
      writeFileSync(tsxAbs, 'export default function M(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'Merge' }));
      mkdirSync(join(designRoot, '_canvas-state'), { recursive: true });
      writeFileSync(
        viewPath(designRoot, 'ui-merge'),
        JSON.stringify({ viewport: { x: 7, y: 8, zoom: 0.5 } })
      );
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      expect(r.status).toBe(200);
      const m = (await r.json()) as MetaShape;
      expect(m.title).toBe('Merge');
      expect(m.viewport).toEqual({ x: 7, y: 8, zoom: 0.5 });
    } finally {
      await killProc(proc);
    }
  });

  test('GET strips a stale inline viewport from a legacy meta (no view file)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Legacy.tsx');
      writeFileSync(tsxAbs, 'export default function L(){return <main/>}\n');
      // A pre-DDR-115 meta with the camera baked inline + a stale last_modified.
      writeFileSync(
        tsxAbs.replace(/\.tsx$/, '.meta.json'),
        JSON.stringify({
          title: 'Legacy',
          viewport: { x: 5, y: 6, zoom: 0.5 },
          last_modified: '2020-01-01T00:00:00.000Z',
        })
      );
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      const m = (await r.json()) as MetaShape;
      expect(m.title).toBe('Legacy');
      // The stale inline camera + timestamp are NOT surfaced (no view file → none).
      expect(m.viewport).toBeUndefined();
      expect(m.last_modified).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH layout writes meta AND bumps last_modified (a real shared change)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Layout.tsx');
      writeFileSync(tsxAbs, 'export default function L(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'L', sections: [] }));
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { layout: { artboards: [{ id: 'a', x: 0, y: 0 }] } } }),
      });
      expect(r.status).toBe(200);
      const onDisk = JSON.parse(readFileSync(metaAbs, 'utf8')) as MetaShape;
      expect(onDisk.layout?.artboards).toBeDefined();
      expect(typeof onDisk.last_modified).toBe('string');
      expect(onDisk.title).toBe('L');
      // The camera never leaks into the versioned meta.
      expect(onDisk.viewport).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH layout persists position-only entries (Phase 4.2 strip-on-write)', async () => {
    // DDR-027: artboard w/h is JSX-authoritative. The client-side writer
    // (canvas-lib.tsx patchCanvasMeta) strips w/h before PATCH; the server
    // must round-trip whatever shape it receives without rejecting partial
    // entries.
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Phase42.tsx');
      writeFileSync(tsxAbs, 'export default function P(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'P', sections: [] }));
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file,
          patch: {
            layout: {
              artboards: [
                { id: 'a', x: 100, y: 50 },
                { id: 'b', x: 1500, y: 50 },
              ],
            },
          },
        }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      const arts = merged.layout?.artboards as Array<Record<string, unknown>> | undefined;
      expect(arts).toBeDefined();
      expect(arts?.length).toBe(2);
      // No w/h written.
      expect(arts?.[0]).toEqual({ id: 'a', x: 100, y: 50 });
      expect(arts?.[1]).toEqual({ id: 'b', x: 1500, y: 50 });

      const onDisk = JSON.parse(readFileSync(metaAbs, 'utf8')) as MetaShape;
      const diskArts = onDisk.layout?.artboards as Array<Record<string, unknown>> | undefined;
      expect(diskArts?.[0]).not.toHaveProperty('w');
      expect(diskArts?.[0]).not.toHaveProperty('h');
    } finally {
      await killProc(proc);
    }
  });

  // Security follow-up to issue #91 — `layout.artboards[]` is reachable from
  // the untrusted canvas origin (DDR-054) and previously had no count/magnitude
  // bound. Now that the zoom-floor fix lets `fit()` correctly frame whatever
  // bounding box a synced layout describes, an unbounded artboard count could
  // promote hundreds/thousands of simultaneous GPU layers on the viewer's
  // client (a DoS). Caps mirror the existing overlays/locked lanes.
  test('PATCH layout rejects an oversized artboards array as a silent no-op', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Oversized.tsx');
      writeFileSync(tsxAbs, 'export default function O(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'Oversized', sections: [] }));
      const file = repoRel(designRoot, tsxAbs);

      // Seed a valid, small layout first.
      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { layout: { artboards: [{ id: 'a', x: 0, y: 0 }] } } }),
      });

      // A crafted, oversized layout (2001 > the 2000-entry cap) must not land.
      const huge = Array.from({ length: 2001 }, (_, i) => ({ id: `a${i}`, x: i, y: 0 }));
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { layout: { artboards: huge } } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      // Silent no-op — the prior small, valid layout is still what's live.
      const arts = merged.layout?.artboards as Array<Record<string, unknown>> | undefined;
      expect(arts).toEqual([{ id: 'a', x: 0, y: 0 }]);

      const onDisk = JSON.parse(readFileSync(metaAbs, 'utf8')) as MetaShape;
      const diskArts = onDisk.layout?.artboards as Array<Record<string, unknown>> | undefined;
      expect(diskArts).toEqual([{ id: 'a', x: 0, y: 0 }]);
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH layout rejects an out-of-range artboard coordinate as a silent no-op', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'OutOfRange.tsx');
      writeFileSync(tsxAbs, 'export default function R(){return <main/>}\n');
      writeFileSync(
        tsxAbs.replace(/\.tsx$/, '.meta.json'),
        JSON.stringify({ title: 'OutOfRange' })
      );
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file,
          patch: { layout: { artboards: [{ id: 'a', x: 50_000_000, y: 0 }] } },
        }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      expect(merged.layout).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH viewport on a non-existent canvas is refused (404) and mints no file (DDR-115 F-A2)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      // No .tsx written — the canvas does not exist.
      const file = '.design/ui/Ghost.tsx';
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 1, y: 2, zoom: 1 } } }),
      });
      expect(r.status).toBe(404);
      // The untrusted-origin write was refused — no per-machine file minted.
      expect(existsSync(viewPath(designRoot, 'ui-ghost'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH rejects paths that escape repoRoot', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: '../escape.tsx',
          patch: { viewport: { x: 0, y: 0, zoom: 1 } },
        }),
      });
      expect(r.status).toBe(404);
    } finally {
      await killProc(proc);
    }
  });
});

// feature-1-artboard-kinds-foundation, T6 — per-user overlay-visibility lane.
// Same camera-split contract as `viewport` above: `overlays` lives ONLY in the
// gitignored per-machine view file, never the versioned `.meta.json`.
describe('/_api/canvas-meta — overlays lane (T6)', () => {
  test('PATCH overlays leaves meta byte-unchanged + writes the view file', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Overlays.tsx');
      writeFileSync(tsxAbs, 'export default function O(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'Overlays', sections: [] }));
      const before = readFileSync(metaAbs, 'utf8');
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { overlays: { guides: true } } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      expect(merged.overlays).toEqual({ guides: true });

      // KEYSTONE — versioned meta is byte-identical; no last_modified bump.
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);

      const vAbs = viewPath(designRoot, 'ui-overlays');
      expect(existsSync(vAbs)).toBe(true);
      const view = JSON.parse(readFileSync(vAbs, 'utf8'));
      expect(view.overlays).toEqual({ guides: true });
    } finally {
      await killProc(proc);
    }
  });

  test('absent overlays key resolves to hidden (T6 Gotcha — old view files default off)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'NoOverlays.tsx');
      writeFileSync(tsxAbs, 'export default function N(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'N' }));
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      const m = (await r.json()) as MetaShape;
      expect(m.overlays).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH overlays merges with an existing viewport in the SAME view file', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Both.tsx');
      writeFileSync(tsxAbs, 'export default function B(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'B' }));
      const file = repoRel(designRoot, tsxAbs);

      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { viewport: { x: 3, y: 4, zoom: 1 } } }),
      });
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { overlays: { guides: true } } }),
      });
      const merged = (await r.json()) as MetaShape;
      // Both lanes present — writing overlays didn't clobber the viewport.
      expect(merged.viewport).toEqual({ x: 3, y: 4, zoom: 1 });
      expect(merged.overlays).toEqual({ guides: true });

      const view = JSON.parse(readFileSync(viewPath(designRoot, 'ui-both'), 'utf8'));
      expect(view.viewport).toEqual({ x: 3, y: 4, zoom: 1 });
      expect(view.overlays).toEqual({ guides: true });
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH overlays shallow-merges keys — a later patch keeps an earlier key', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Merge2.tsx');
      writeFileSync(tsxAbs, 'export default function M(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'M' }));
      const file = repoRel(designRoot, tsxAbs);

      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { overlays: { guides: true } } }),
      });
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // A downstream plan (print) toggling ITS OWN key shouldn't erase `guides`.
        body: JSON.stringify({ file, patch: { overlays: { bleed: true } } }),
      });
      const merged = (await r.json()) as MetaShape;
      expect(merged.overlays).toEqual({ guides: true, bleed: true });
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH ignores a malformed overlays bag (non-boolean value) — silent no-op', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Malformed.tsx');
      writeFileSync(tsxAbs, 'export default function X(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'X' }));
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { overlays: { guides: 'yes' } } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      expect(merged.overlays).toBeUndefined();
      expect(existsSync(viewPath(designRoot, 'ui-malformed'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('PATCH overlays on a non-existent canvas is refused (404), mints no file', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const file = '.design/ui/GhostOverlays.tsx';
      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { overlays: { guides: true } } }),
      });
      expect(r.status).toBe(404);
      expect(existsSync(viewPath(designRoot, 'ui-ghostoverlays'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });
});

// feature-4 T7b — `locked` (per-user locked layer keys) is the third view-file
// lane: same split contract as viewport/overlays (never the versioned meta),
// REPLACE semantics (the client sends the full set), bounded shape.
describe('/_api/canvas-meta — locked lane (feature-4 T7b)', () => {
  test('PATCH locked leaves meta byte-unchanged + writes the view file; GET merges it back', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Locked.tsx');
      writeFileSync(tsxAbs, 'export default function L(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'Locked', sections: [] }));
      const before = readFileSync(metaAbs, 'utf8');
      const file = repoRel(designRoot, tsxAbs);

      const r = await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { locked: ['aabbccdd:0', 'deadbeef:2'] } }),
      });
      expect(r.status).toBe(200);
      const merged = (await r.json()) as MetaShape;
      expect(merged.locked).toEqual(['aabbccdd:0', 'deadbeef:2']);
      // Versioned meta byte-identical (runtime state never lands there).
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);
      const view = JSON.parse(readFileSync(viewPath(designRoot, 'ui-locked'), 'utf8'));
      expect(view.locked).toEqual(['aabbccdd:0', 'deadbeef:2']);

      // REPLACE semantics — a smaller set unlocks the dropped key.
      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { locked: ['aabbccdd:0'] } }),
      });
      const g = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      expect(((await g.json()) as MetaShape).locked).toEqual(['aabbccdd:0']);
    } finally {
      await killProc(proc);
    }
  });

  test('malformed locked keys are a silent no-op (shape-gated)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'BadLock.tsx');
      writeFileSync(tsxAbs, 'export default function B(){return <main/>}\n');
      writeFileSync(tsxAbs.replace(/\.tsx$/, '.meta.json'), JSON.stringify({ title: 'B' }));
      const file = repoRel(designRoot, tsxAbs);
      await fetch(`http://localhost:${port}/_api/canvas-meta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file, patch: { locked: ['../../etc/passwd', 'not-a-key'] } }),
      });
      const g = await fetch(
        `http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`
      );
      expect(((await g.json()) as MetaShape).locked).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });
});

// r4 #6 — `canvasTheme` (the person's Light | Dark pick for this canvas) is the fourth view-file lane: per user, per
// Mac, never the versioned meta (DDR-115). REPLACE semantics; only 'light' | 'dark' are values; `null` forgets it.
describe('/_api/canvas-meta — canvasTheme lane (r4 #6)', () => {
  test('PATCH canvasTheme leaves meta byte-unchanged + writes the view file; GET merges it back; null forgets', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Themed.tsx');
      writeFileSync(tsxAbs, 'export default function T(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'Themed', sections: [] }));
      const before = readFileSync(metaAbs, 'utf8');
      const file = repoRel(designRoot, tsxAbs);
      const patch = (p: unknown) =>
        fetch(`http://localhost:${port}/_api/canvas-meta`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file, patch: p }),
        });
      const get = async () =>
        (await (
          await fetch(`http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`)
        ).json()) as MetaShape;

      const r = await patch({ canvasTheme: 'dark' });
      expect(r.status).toBe(200);
      expect(((await r.json()) as MetaShape).canvasTheme).toBe('dark');
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);
      expect(JSON.parse(readFileSync(viewPath(designRoot, 'ui-themed'), 'utf8')).canvasTheme).toBe(
        'dark'
      );
      expect((await get()).canvasTheme).toBe('dark');

      // anything but light | dark is a silent no-op — the pick stays
      await patch({ canvasTheme: 'sepia' });
      expect((await get()).canvasTheme).toBe('dark');
      await patch({ canvasTheme: 'light' });
      expect((await get()).canvasTheme).toBe('light');
      await patch({ canvasTheme: null });
      expect((await get()).canvasTheme).toBeUndefined();
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);
    } finally {
      await killProc(proc);
    }
  });
});

// 2.0.7 B2 — `canvasView` (the person's Canvas | Pages pick for this canvas) is the fifth view-file lane: per user, per
// Mac, never the versioned meta (DDR-115). REPLACE semantics; only 'canvas' | 'pages' are values; `null` forgets it.
describe('/_api/canvas-meta — canvasView lane (2.0.7 B2)', () => {
  test('PATCH canvasView leaves meta byte-unchanged + writes the view file; GET merges it back; null forgets', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      const tsxAbs = join(designRoot, 'ui', 'Paged.tsx');
      writeFileSync(tsxAbs, 'export default function T(){return <main/>}\n');
      const metaAbs = tsxAbs.replace(/\.tsx$/, '.meta.json');
      writeFileSync(metaAbs, JSON.stringify({ title: 'Paged', sections: [] }));
      const before = readFileSync(metaAbs, 'utf8');
      const file = repoRel(designRoot, tsxAbs);
      const patch = (p: unknown) =>
        fetch(`http://localhost:${port}/_api/canvas-meta`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file, patch: p }),
        });
      const get = async () =>
        (await (
          await fetch(`http://localhost:${port}/_api/canvas-meta?file=${encodeURIComponent(file)}`)
        ).json()) as MetaShape & { canvasView?: string };

      const r = await patch({ canvasView: 'pages' });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { canvasView?: string }).canvasView).toBe('pages');
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);
      expect(JSON.parse(readFileSync(viewPath(designRoot, 'ui-paged'), 'utf8')).canvasView).toBe(
        'pages'
      );
      expect((await get()).canvasView).toBe('pages');

      // the Light | Dark pick shares the file: writing one keeps the other
      await patch({ canvasTheme: 'dark' });
      expect((await get()).canvasView).toBe('pages');
      expect((await get()).canvasTheme).toBe('dark');

      // anything but canvas | pages is a silent no-op — the pick stays
      await patch({ canvasView: 'slides' });
      expect((await get()).canvasView).toBe('pages');
      await patch({ canvasView: 'canvas' });
      expect((await get()).canvasView).toBe('canvas');
      await patch({ canvasView: null });
      expect((await get()).canvasView).toBeUndefined();
      expect((await get()).canvasTheme).toBe('dark');
      expect(readFileSync(metaAbs, 'utf8')).toBe(before);
    } finally {
      await killProc(proc);
    }
  });
});
