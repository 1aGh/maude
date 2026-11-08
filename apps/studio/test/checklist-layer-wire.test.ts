// #113 slice B — the layer's checklist seams (annotations/ui/checklist-wire.ts + their call sites in
// annotations-layer.tsx). Every gesture reaches the board as ONE batch: the lock net drops entry edits of a
// locked list (a tick passes), the sticky grows to fit its entries in the same batch, and undoing that batch
// restores the board. Entries travel with a copied / pasted / duplicated / templated sticky (fresh ids, `list`
// remapped), and a deleted sticky takes its entries. The layer adds no key handler of its own.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { addItem, rewordItem, tickItem } from '../annotations/checklist-ops.ts';
import { itemsOf } from '../annotations/elements/checkitem.model.ts';
import { applyOps, type Op } from '../annotations/ops.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  checklistCommitOps,
  isChecklistTarget,
  itemPutsFor,
  itemsForCopy,
  splitPasteItems,
} from '../annotations/ui/checklist-wire.ts';
import { expandTemplate } from '../annotations/ui/template-place.ts';

const board = (extra: Record<string, unknown> = {}): Map<string, AnnotationElement> =>
  new Map(
    validateElements([
      {
        id: 's1',
        type: 'sticky',
        index: 'a0',
        x: 0,
        y: 0,
        w: 200,
        h: 120,
        text: 'Launch',
        ...extra,
      },
      { id: 'c1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
      { id: 'c2', type: 'checkitem', index: 'a1', list: 's1', text: 'Record the demo' },
      { id: 's2', type: 'sticky', index: 'a1', x: 400, y: 0, w: 200, h: 200, text: 'Plain' },
    ]).elements.map((e) => [e.id, e])
  );

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as T & { ok: true; ops: Op[] };
};

describe('checklistCommitOps — one batch per gesture', () => {
  test('an add grows the sticky in the SAME batch, and its inverse restores the board', () => {
    const b = board();
    const ops = checklistCommitOps(b, ok(addItem(b, 's1', { id: 'c9', text: 'Ship it' })).ops);
    expect(ops.filter((o) => o.op === 'put')).toHaveLength(1);
    const grow = ops.find((o) => o.op === 'patch' && o.id === 's1');
    expect(grow).toBeDefined();
    const r = applyOps(b, ops);
    expect((r.state.get('s1')?.h as number) > 120).toBe(true);
    expect(itemsOf(r.state.values(), 's1').map((i) => i.id)).toEqual(['c1', 'c2', 'c9']);
    // one ⌘Z = the batch's inverse, applied as one batch
    const back = applyOps(r.state, r.inverse).state;
    expect(back.get('c9')).toBeUndefined();
    expect(back.get('s1')?.h).toBe(120);
  });

  test('a locked list still ticks; an add / reword that slipped through is dropped', () => {
    const b = board({ locked: true });
    const tick = checklistCommitOps(b, ok(tickItem(b, 'c1', true, { by: 'Jonas' })).ops);
    expect(tick).toHaveLength(1);
    expect(tick[0]).toMatchObject({ op: 'patch', id: 'c1' });
    // the ops engine refuses these on a locked list; a hand-made batch is still caught by the net
    const sneaky: Op[] = [
      {
        op: 'put',
        el: { id: 'cx', type: 'checkitem', index: 'a9', list: 's1' } as AnnotationElement,
      },
      { op: 'patch', id: 'c2', set: { text: 'changed' } },
    ];
    expect(checklistCommitOps(b, sneaky)).toEqual([]);
    // and a locked sticky never grows (the lock guards resize)
    expect(checklistCommitOps(b, ok(tickItem(b, 'c2', true, { by: 'J' })).ops)).toHaveLength(1);
  });

  test('a reword that needs no room adds nothing', () => {
    const b = board({ h: 600 });
    expect(checklistCommitOps(b, ok(rewordItem(b, 'c1', 'Post')).ops)).toHaveLength(1);
  });
});

describe('entries travel with their sticky', () => {
  test('copy carries the entries of the copied stickies only, unlocked', () => {
    const b = board();
    b.set('c1', { ...(b.get('c1') as AnnotationElement), locked: true });
    const items = itemsForCopy(b, ['s1', 's2']);
    expect(items.map((i) => i.id)).toEqual(['c1', 'c2']);
    expect(items[0]?.locked).toBeUndefined();
    expect(itemsForCopy(b, ['s2'])).toEqual([]);
  });

  test('paste: entries split from the cards, remapped to the pasted sticky; a stray is dropped', () => {
    const b = board();
    const payload = [
      b.get('s1') as AnnotationElement,
      ...itemsForCopy(b, ['s1']),
      { id: 'stray', type: 'checkitem', index: 'a0', list: 'elsewhere' } as AnnotationElement,
    ];
    const { drawn, items } = splitPasteItems(payload);
    expect(drawn.map((e) => e.id)).toEqual(['s1']);
    expect(items.map((e) => e.id)).toEqual(['c1', 'c2', 'stray']);
    let n = 0;
    const puts = itemPutsFor([...drawn, ...items], new Map([['s1', 'copy']]), () => `n${++n}`);
    expect(puts).toHaveLength(2);
    for (const p of puts) {
      expect(p.op).toBe('put');
      if (p.op === 'put') expect(p.el.list).toBe('copy');
    }
    expect(puts.map((p) => (p.op === 'put' ? p.el.text : null))).toEqual([
      'Write the post',
      'Record the demo',
    ]);
  });

  test('the Checklist template places its entries as records beside the strokes', () => {
    const placed = expandTemplate('checklist', { x: 0, y: 0 }, 'Jonas');
    expect(placed).not.toBeNull();
    const sticky = placed?.strokes.find((s) => s.tool === 'sticky');
    expect(sticky).toBeDefined();
    expect(placed?.records.length).toBe(3);
    for (const r of placed?.records ?? []) {
      expect(r.type).toBe('checkitem');
      expect(r.list).toBe(sticky?.id);
    }
    // entries are never selected on their own
    expect(placed?.selectIds.some((id) => placed.records.some((r) => r.id === id))).toBe(false);
  });

  test('a press or a key inside an interactive checklist is the checklist’s', () => {
    const root = { closest: (sel: string) => (sel === '[data-an-checklist]' ? {} : null) };
    expect(isChecklistTarget(root as unknown as EventTarget)).toBe(true);
    expect(isChecklistTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isChecklistTarget(null)).toBe(false);
  });
});

describe('the layer wires it (source pins)', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'annotations-layer.tsx'), 'utf8');

  test('every stroke commit takes a deleted sticky’s entries; copies bring theirs in the same batch', () => {
    expect(src).toContain('...withItemDeletes(committed, guardLockedOps(');
    expect(src).toContain('extraOps: itemPutsFor(board.committed.values(), res.idMap)');
    expect(src).toContain('extraOps: pastedRecords.length ? itemPutsFor(pastedRecords, res.idMap)');
    expect(src).toContain('placed.records.map(');
    expect(src).toContain('...itemsForCopy(board.committed, expanded)');
  });

  test('a checklist gesture goes through the lock net, as one undo record', () => {
    expect(src).toContain('const ops = checklistCommitOps(board.committed, res.ops);');
    expect(src).toMatch(/buildAnnotationOpsRecord\(\{ ops, inverse, label: res\.label/);
  });

  test('no new key handler: the checklist keys are registry entries through useCanvasKeys', () => {
    // the layer's own document/window keydown listeners stay the ones it had before #113
    expect(src.match(/addEventListener\('keydown'/g)?.length).toBe(8);
    expect(src).toContain("'checklist.toggle': checklistKey('checklist.toggle')");
    expect(src).toContain('checkItemFocused: (e) => isChecklistTarget(e.target)');
  });
});
