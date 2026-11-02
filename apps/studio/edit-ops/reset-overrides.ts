// edit-ops/reset-overrides.ts — S2.17: `component.reset` (ed-comp-instance: "2 changes from Tlačítko. Reset").
//
// Takes an instance back to what its master gives it, and touches nothing else: the words go back to the
// master's own, the inline `style` declarations that are not PLACEMENT go (instance-model.ts), and the
// variant, the id, `data-ds-rev`, the position and everything else stay. An instance with no overrides is
// answered with the same bytes (no write). Words that are code (`{label}`) and a `style` that is code are
// the file's, not ours: they are left, and `detail.kept` says so.
//
// params  props?: string[]  — reset only these (kebab-case style props, or `text`); absent = all of them.
// targets[0]  the instance.

import MagicString from 'magic-string';

import { CanvasEditError } from '../canvas-edit.ts';
import { jsxText } from './insert-component.ts';
import { overridesOf, PLACEMENT_PROPS, readInstance } from './instance-model.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

export const componentReset: EditOp = {
  id: 'component.reset',
  apply(source, req) {
    const target = req.targets[0];
    if (!target || req.targets.length !== 1) return fail(req, 'Select one instance to reset.');
    const f = readInstance(source, req.file, target.element);
    if (!f) return fail(req, 'This is not an instance of a component.');
    if (f.repeats) return fail(req, 'This one repeats; change it where it is written.');

    let only: Set<string> | null = null;
    if (req.params.props !== undefined) {
      const raw = req.params.props;
      if (!Array.isArray(raw) || raw.length > 64 || raw.some((x) => typeof x !== 'string'))
        return fail(req, 'Say which changes to take back.');
      only = new Set(raw as string[]);
    }
    const wants = (name: string) => only === null || only.has(name);

    const o = overridesOf(f);
    const s = new MagicString(source);
    const kept: string[] = [];

    // the words
    if (o.text && wants('text')) {
      const kids = (f.comp.children ?? []) as Array<{ start: number; end: number }>;
      const first = kids[0];
      const last = kids[kids.length - 1];
      if (first && last) s.overwrite(first.start, last.end, jsxText(f.defaultText));
    } else if (f.textInCode) kept.push('text');

    // the look: the inline style, minus the declarations that are placement
    if (f.styleAttr && f.style === null) kept.push('style');
    else if (f.styleAttr && f.style) {
      const drop = new Set(
        f.style
          .filter((p) => !p.spread && !PLACEMENT_PROPS.has(p.prop) && wants(p.prop))
          .map((p) => p.start)
      );
      if (drop.size > 0) {
        const left = f.style.filter((p) => !drop.has(p.start));
        const attr = f.styleAttr;
        if (left.length === 0) {
          const ws = /\s*$/.exec(source.slice(0, attr.start))?.[0].length ?? 0;
          s.remove(attr.start - ws, attr.end);
        } else {
          const text = left.map((p) => source.slice(p.start, p.end)).join(', ');
          s.overwrite(attr.start, attr.end, `style={{ ${text} }}`);
        }
      }
    }
    return { source: s.toString(), ...(kept.length ? { detail: { kept } } : {}) };
  },
};
