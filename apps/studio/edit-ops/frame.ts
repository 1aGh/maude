// edit-ops/frame.ts — `object.frame` (⌥⌘G, ⌘G in Edit): wrap the selection in a new frame (S2.6).
//
// "Frame · stacked ↓": a plain `<div>` with `display: flex; flex-direction: column`, placed where the
// first selected object was, holding the selected objects in their source order (objects that were
// not side by side are gathered into it). Every selected object keeps its id (it moves, it is not
// rewritten); the new frame gets a NEW readable id ("frame", "frame-2", …), returned in `created` so
// the canvas selects it. Only direct children of one JSX parent can be framed together — an object
// in a repeat or a condition, objects in different parents, an artboard: refused with a plain line.

import MagicString from 'magic-string';

import { CanvasEditError, spanWithFraming } from '../canvas-edit.ts';
import { generateElementId, usedIds, walkIdElements } from '../element-ids.ts';
import { lineIndent, reindent, type SiblingGroup, siblingModel } from './siblings.ts';
import type { EditOp } from './types.ts';

export const FRAME_STYLE = "style={{ display: 'flex', flexDirection: 'column' }}";

const NOT_BESIDE = 'Frame works on objects that sit side by side in the same place.';

export const objectFrame: EditOp = {
  id: 'object.frame',
  apply(source, req) {
    const err = (message: string, id = '') =>
      new CanvasEditError(message, { canvas: req.file, id });
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) throw err('This canvas does not parse.');
    if (req.targets.length === 0) throw err('Select something to frame.');
    const model = siblingModel(source, req.file);
    const picked = new Set<number>();
    let group: SiblingGroup | null = null;
    let artboard = req.targets[0]?.artboard ?? '';
    for (const t of req.targets) {
      const el = walk.elements.find((e) => e.id === t.element);
      if (!el) throw err(NOT_BESIDE, t.element);
      if (el.tag === 'DCArtboard' || el.tag === 'DCSection')
        throw err('An artboard is not framed; frame what is inside it.', t.element);
      const hit = model.at.get(el.start);
      if (!hit) throw err(NOT_BESIDE, t.element);
      if (group && hit.group !== group) throw err(NOT_BESIDE, t.element);
      group = hit.group;
      picked.add(hit.index);
      artboard = t.artboard;
    }
    if (!group) throw err(NOT_BESIDE);
    const siblings = group.kids;
    const kids = [...picked]
      .sort((a, b) => a - b)
      .map((i) => siblings[i] as { start: number; end: number });
    const first = kids[0] as { start: number; end: number };
    const indent = lineIndent(source, first.start);
    const unit = indent.includes('\t') ? '\t' : '  ';
    const id = generateElementId({ tag: 'div', dcElement: 'frame' }, usedIds(walk.elements));
    const inner = kids
      .map((k) => `\n${indent}${unit}${reindent(source.slice(k.start, k.end), '', unit)}`)
      .join('');
    const wrapper = `<div data-cd-id="${id}" ${FRAME_STYLE}>${inner}\n${indent}</div>`;
    const s = new MagicString(source);
    s.overwrite(first.start, first.end, wrapper);
    for (const k of kids.slice(1)) {
      // a child on its own line goes with its line break; one that shares a line goes alone
      const [rs] = spanWithFraming(source, k.start, k.end);
      const own = /^\s*$/.test(source.slice(source.lastIndexOf('\n', k.start - 1) + 1, k.start));
      s.remove(own ? rs : k.start, k.end);
    }
    return { source: s.toString(), created: [{ artboard, element: id }] };
  },
};
