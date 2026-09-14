// feature-acp-context-hardening — per-canvas selection memory (`selections`
// map) with the `selected` mirror invariant, restore-on-switch, the mtime
// drift gate, html size cap on parked entries, and open_tabs GC.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { type Context, createBus } from '../context.ts';
import { createInspect, type SelectedElement } from '../inspect.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

const A = '.design/ui/fixture.html'; // exists via makeSandbox
const B = '.design/ui/second.tsx';

function selFor(file: string, text = 'hello') {
  return {
    file,
    selector: 'h1',
    tag: 'h1',
    classes: '',
    text,
    dom_path: ['html', 'body', 'h1'],
    bounds: { x: 0, y: 0, w: 100, h: 24 },
    html: `<h1>${text}</h1>`,
  };
}

async function mkRig() {
  const { root, designRoot } = makeSandbox();
  await Bun.write(join(root, B), 'export default function Second() { return <h1>B</h1>; }');
  const ctx = mkCtx(root, designRoot);
  const inspect = createInspect(ctx, async () => []);
  return { root, designRoot, ctx, inspect };
}

const asOne = (v: unknown): SelectedElement => v as SelectedElement;

describe('per-canvas selections — restore on switch', () => {
  test('selection survives a canvas switch and comes back on return', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    expect(asOne(inspect.state.selected).selector).toBe('h1');

    inspect.setActive(B);
    expect(inspect.state.selected).toBeNull(); // B has no memory

    inspect.setActive(A);
    const restored = asOne(inspect.state.selected);
    expect(restored).not.toBeNull();
    expect(restored.selector).toBe('h1');
    expect(restored.file).toBe(A); // SEL_VALID (`selected.file === active`) holds
  });

  test('parked (non-active) entries carry html: "" — size cap', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    // Active canvas's write-through keeps the rich copy…
    expect(asOne(inspect.state.selections['ui/fixture']).html).toContain('<h1>');
    inspect.setActive(B);
    // …but parking on switch-away strips it.
    expect(asOne(inspect.state.selections['ui/fixture']).html).toBe('');
    inspect.setActive(A);
    expect(asOne(inspect.state.selected).html).toBe('');
  });

  test('mirror invariant: selected === selections[activeSlug] after select', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    expect(inspect.state.selections['ui/fixture']).toBe(inspect.state.selected);
  });

  test('a cross-canvas plant (selection.file != active) is NOT stored (attacker F2 residual)', async () => {
    // An active untrusted canvas posts a selection claiming a DIFFERENT canvas's
    // file — it must not land in that canvas's slot for later agent delivery.
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(B, 'planted')); // A is active, payload claims B
    expect(inspect.state.selections['ui/second']).toBeUndefined();
    expect(inspect.state.selections['ui/fixture']).toBeUndefined();
    // Later opening B must not resurrect the plant.
    inspect.setActive(B);
    expect(inspect.state.selected).toBeNull();
  });

  test('single-entry array still collapses to a bare object (Phase 4.1 contract)', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected([selFor(A)]);
    expect(Array.isArray(inspect.state.selected)).toBe(false);
    expect(asOne(inspect.state.selected).tag).toBe('h1');
  });
});

describe('per-canvas selections — drift gate', () => {
  test('canvas edited while parked → restored selection is stale', async () => {
    const { root, inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    const stamped = asOne(inspect.state.selected).canvas_mtime;
    expect(stamped).toBeGreaterThan(0);

    inspect.setActive(B);
    // Another writer edits canvas A while it's parked (ensure mtime moves).
    await Bun.sleep(5);
    await Bun.write(join(root, A), '<!doctype html><html><body><h1>changed</h1></body></html>');

    inspect.setActive(A);
    expect(asOne(inspect.state.selected).stale).toBe(true);
  });

  test('untouched canvas restores without the stale flag', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    inspect.setActive(B);
    inspect.setActive(A);
    expect(asOne(inspect.state.selected).stale).toBeUndefined();
  });
});

describe('per-canvas selections — lifecycle', () => {
  test('explicit deselect clears the active canvas memory', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    inspect.setSelected(null);
    expect(inspect.state.selections['ui/fixture']).toBeUndefined();
    inspect.setActive(B);
    inspect.setActive(A);
    expect(inspect.state.selected).toBeNull();
  });

  test('single-canvas shell ordering (tabs BEFORE active) never GCs the outgoing canvas', async () => {
    // The shell replaces the tab and sends `tabs` with ONLY the incoming canvas
    // before `active` parks the outgoing one — the exact wire order of app.jsx
    // openTab effects. The outgoing canvas's memory must survive the round trip.
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setOpenTabs([A]);
    inspect.setSelected(selFor(A));

    inspect.setOpenTabs([B]); // switch A→B: tabs first…
    inspect.setActive(B); //    …then active (parks A)
    expect(inspect.state.selections['ui/fixture']).toBeDefined();

    inspect.setOpenTabs([A]); // switch back B→A: tabs first…
    inspect.setActive(A); //    …then active (restores A)
    expect(asOne(inspect.state.selected).selector).toBe('h1');
    expect(asOne(inspect.state.selected).file).toBe(A);
  });

  test('closing a tab GCs its parked selection', async () => {
    const { inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    inspect.setActive(B); // parks A
    inspect.setOpenTabs([B]); // A closed
    expect(inspect.state.selections['ui/fixture']).toBeUndefined();
    expect(Object.keys(inspect.state.selections)).toHaveLength(0);
  });

  test('save/load round-trips selections; legacy file without them loads as {}', async () => {
    const { designRoot, ctx, inspect } = await mkRig();
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    await inspect.save();

    const reloaded = createInspect(ctx, async () => []);
    await reloaded.load();
    expect(asOne(reloaded.state.selections['ui/fixture']).selector).toBe('h1');

    // Legacy shape (pre-selections) → invariant restored on load.
    await Bun.write(
      join(designRoot, '_active.json'),
      JSON.stringify({ active: A, open_tabs: [A], selected: null, last_change: null })
    );
    const legacy = createInspect(ctx, async () => []);
    await legacy.load();
    expect(legacy.state.selections).toEqual({});
  });

  test('switch emits the restored selection on the bus (clients stay in sync)', async () => {
    const { ctx, inspect } = await mkRig();
    const emitted: unknown[] = [];
    ctx.bus.on('selected', (s: unknown) => emitted.push(s));
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    inspect.setActive(B);
    inspect.setActive(A);
    // emits: initial activate (null), select(A), switch→B (null), switch→A (restored)
    expect(emitted).toHaveLength(4);
    expect(emitted[0]).toBeNull();
    expect(emitted[2]).toBeNull();
    expect(asOne(emitted[3]).selector).toBe('h1');
  });
});

describe('deleted canvas context', () => {
  test('removes the active canvas and its selection without polluting another canvas', async () => {
    const { inspect } = await mkRig();
    inspect.setOpenTabs([A, B]);
    inspect.setActive(B);
    inspect.setSelected(selFor(B, 'keep B'));
    inspect.setActive(A);
    inspect.setSelected(selFor(A, 'remove A'));
    expect(inspect.remove(A)).toBe(true);
    expect(inspect.state.active).toBeNull();
    expect(inspect.state.selected).toBeNull();
    expect(inspect.state.open_tabs).toEqual([B]);
    expect(inspect.state.selections['ui/fixture']).toBeUndefined();
    inspect.setActive(B);
    expect(asOne(inspect.state.selected).text).toBe('keep B');
    expect(inspect.remove(A)).toBe(false);
  });

  test('deleting a background canvas keeps the current canvas and selection', async () => {
    const { inspect } = await mkRig();
    inspect.setOpenTabs([A, B]);
    inspect.setActive(A);
    inspect.setSelected(selFor(A));
    inspect.setActive(B);
    inspect.setSelected(selFor(B));
    const selected = inspect.state.selected;
    inspect.remove(A);
    expect(inspect.state.active).toBe(B);
    expect(inspect.state.selected).toBe(selected);
    expect(inspect.state.open_tabs).toEqual([B]);
    expect(inspect.state.selections['ui/fixture']).toBeUndefined();
  });
});
