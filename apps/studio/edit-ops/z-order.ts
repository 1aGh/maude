// edit-ops/z-order.ts — `object.bring-front` ⌘] · `object.bring-forward` ] · `object.send-backward` [
// · `object.send-back` ⌘[ (S2.6).
//
// Stacking IS source order among siblings (a later sibling paints above an earlier one, and in an
// auto-layout frame it is also the layout order — the same truth the Layers panel shows). The ops
// permute the selected siblings' source text among the slots their parent's children occupy; every
// byte of every sibling is preserved, only the order changes. Selected objects in different parents
// move within their own parent. An object inside a repeat (`.map()`) or a condition (`{a && <X/>}`)
// is not a direct child and is refused rather than guessed at. Already at the end: nothing changes
// and nothing is written.

import MagicString from 'magic-string';

import { CanvasEditError } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { type SiblingGroup, siblingModel } from './siblings.ts';
import type { EditOp } from './types.ts';

export type ZMove = 'front' | 'forward' | 'backward' | 'back';

/** new position → old index, for the picked set (stable among picked and among the rest). */
export function reorder(n: number, picked: ReadonlySet<number>, move: ZMove): number[] {
  const all = Array.from({ length: n }, (_, i) => i);
  const yes = all.filter((i) => picked.has(i));
  const no = all.filter((i) => !picked.has(i));
  if (move === 'front') return [...no, ...yes];
  if (move === 'back') return [...yes, ...no];
  const out = all.slice();
  const swap = (a: number, b: number) => {
    const t = out[a] as number;
    out[a] = out[b] as number;
    out[b] = t;
  };
  if (move === 'forward') {
    for (let i = n - 2; i >= 0; i--)
      if (picked.has(out[i] as number) && !picked.has(out[i + 1] as number)) swap(i, i + 1);
  } else {
    for (let i = 1; i < n; i++)
      if (picked.has(out[i] as number) && !picked.has(out[i - 1] as number)) swap(i, i - 1);
  }
  return out;
}

const REFUSED =
  'Order works on objects that sit directly in a frame — not inside a repeat or a condition.';

function apply(move: ZMove): EditOp['apply'] {
  return (source, req) => {
    const walk = walkIdElements(source, req.file);
    if (!walk.ok)
      throw new CanvasEditError('This canvas does not parse.', { canvas: req.file, id: '' });
    const model = siblingModel(source, req.file);
    const picked = new Map<SiblingGroup, Set<number>>();
    for (const t of req.targets) {
      const el = walk.elements.find((e) => e.id === t.element);
      const hit = el ? model.at.get(el.start) : undefined;
      if (!el || !hit) throw new CanvasEditError(REFUSED, { canvas: req.file, id: t.element });
      const set = picked.get(hit.group) ?? new Set<number>();
      picked.set(hit.group, set);
      set.add(hit.index);
    }
    const s = new MagicString(source);
    let changed = false;
    for (const [group, set] of picked) {
      const order = reorder(group.kids.length, set, move);
      order.forEach((from, slot) => {
        if (from === slot) return;
        changed = true;
        const dst = group.kids[slot] as { start: number; end: number };
        const src = group.kids[from] as { start: number; end: number };
        s.overwrite(dst.start, dst.end, source.slice(src.start, src.end));
      });
    }
    return { source: changed ? s.toString() : source };
  };
}

export const objectBringFront: EditOp = { id: 'object.bring-front', apply: apply('front') };
export const objectBringForward: EditOp = { id: 'object.bring-forward', apply: apply('forward') };
export const objectSendBackward: EditOp = { id: 'object.send-backward', apply: apply('backward') };
export const objectSendBack: EditOp = { id: 'object.send-back', apply: apply('back') };
