// S7.22 — `artboard.set-safe-zones` through the one dispatch route (S2-edit-ops.md): the Safe zones row, ⌘K and an
// agent all write the DCArtboard `safeZones` string prop, and nothing else. Pure dispatcher harness (no server),
// the shape of v2-artboard-duplicate-op.test.ts.

import { describe, expect, test } from 'bun:test';

import { applySetArtboardSafeZones } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { opLabel } from '../edit-ops/op-label.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Story.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Story() {
  return (
    <DesignCanvas>
      <DCArtboard id="story" label="Gameday · story" width={1080} height={1920} fixed kind="digital">
        <p data-cd-id="date">Sobota 19:00</p>
      </DCArtboard>
      <DCArtboard id="reels" label="Reels" width={1080} height={1920} fixed safeZones="instagram-story">
        <p>Vstupenky na webu</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(opts: { held?: string } = {}) {
  const files = new Map<string, string>([[FILE, SRC]]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after, label) => {
      files.set(rel, after);
      writes.push(label);
    },
    heldByAi: () => null,
    heldArtboard: (_rel, artboard) => (artboard === opts.held ? { mine: true } : null),
    log: createWriteLog(),
  };
  return {
    files,
    writes,
    run: (preset: unknown, artboard: unknown = 'story') =>
      dispatchEditOp(
        { file: FILE, op: 'artboard.set-safe-zones', targets: [], params: { artboard, preset } },
        deps
      ),
  };
}
const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe('artboard.set-safe-zones', () => {
  test('the op is in the table the route dispatches', () => {
    expect(EDIT_OPS.some((o) => o.id === 'artboard.set-safe-zones')).toBe(true);
  });

  test('a preset becomes the safeZones string prop and nothing else moves', async () => {
    const h = harness();
    ok(await h.run('instagram-reels'));
    const out = h.files.get(FILE) as string;
    expect(out).toContain(
      '<DCArtboard safeZones="instagram-reels" id="story" label="Gameday · story" width={1080} height={1920} fixed kind="digital">'
    );
    expect(out.replace('safeZones="instagram-reels" ', '')).toBe(SRC);
    expect(h.writes).toEqual(['pre-artboard.set-safe-zones']);
  });

  test('another preset replaces the old one on that artboard only', async () => {
    const h = harness();
    ok(await h.run('tiktok', 'reels'));
    const out = h.files.get(FILE) as string;
    expect(out).toContain(
      'id="reels" label="Reels" width={1080} height={1920} fixed safeZones="tiktok"'
    );
    expect(out).not.toContain('instagram-story');
    expect(out).toContain(
      'id="story" label="Gameday · story" width={1080} height={1920} fixed kind="digital">'
    );
  });

  test('None (null or "") takes the prop out again', async () => {
    for (const none of [null, '']) {
      const h = harness();
      ok(await h.run(none, 'reels'));
      const out = h.files.get(FILE) as string;
      expect(out).not.toContain('safeZones');
      expect(out).toContain(
        '<DCArtboard id="reels" label="Reels" width={1080} height={1920} fixed>'
      );
    }
  });

  test('a preset this build does not know is refused, and nothing is written', async () => {
    const h = harness();
    for (const bad of ['snapchat', '__proto__', 7, {}, '"><script>']) {
      const r = await h.run(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid');
    }
    expect(h.files.get(FILE)).toBe(SRC);
    expect(h.writes).toEqual([]);
  });

  test('an artboard that is not on the canvas, or a bad id, is refused', async () => {
    const h = harness();
    for (const art of ['nope', 7, '', 'a b']) {
      const r = await h.run('tiktok', art);
      expect(r.ok).toBe(false);
    }
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('an AI run holding the artboard refuses it (held-by-ai), like a resize', async () => {
    const h = harness({ held: 'story' });
    const r = await h.run('tiktok');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('held-by-ai');
    expect(h.files.get(FILE)).toBe(SRC);
  });

  test('setting what is already there writes the same bytes', () => {
    const once = applySetArtboardSafeZones('/x/Story.tsx', SRC, 'story', 'tiktok').source;
    const twice = applySetArtboardSafeZones('/x/Story.tsx', once, 'story', 'tiktok').source;
    expect(twice).toBe(once);
  });

  test("the undo step says what happened, in the person's words", () => {
    expect(opLabel('artboard.set-safe-zones', { preset: 'instagram-reels' }, [])).toBe(
      'Safe zones: Instagram Reels'
    );
    expect(opLabel('artboard.set-safe-zones', { preset: null }, [])).toBe('Removed safe zones');
  });
});
