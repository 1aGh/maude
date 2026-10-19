// edit-ops/swap-variant.ts — S2.17: `component.swap-variant` (ed-comp-instance).
//
// "Swap the variant — or the whole component — and your text comes along." The instance keeps its words
// and its overrides (the children and the `style` are not touched); only the choice of master changes.
//
// params
//   variant     the variant to wear (`outline`), or null for the master's own look. Checked against the
//               variants the canvas's system really has (`req.ctx.variantsOf`, the server's reading of
//               its components.json), never against the request.
//   component   another component of the same shape (one that holds words and forwards its props:
//               Button · Chip · Badge · Card · Callout). The tag is renamed, `@maude/ds` imports the new
//               name once, and the old name's import goes when nothing else uses it. A variant the new
//               component does not have is dropped (`detail.droppedVariant` says which).
// targets[0]  the instance.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { CanvasEditError } from '../canvas-edit.ts';
import { addImports, NAME_RE, RECIPES, topLevelNames, VARIANT_RE } from './insert-component.ts';
import { readInstance, swappableWith } from './instance-model.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

type AnyNode = any;

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

const parse = (file: string, source: string) =>
  parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, { sourceType: 'module' });

/** The variants `component` may wear on this server: the system's word, else the shipped defaults. */
export function variantsFor(req: ResolvedEditOp, component: string): readonly string[] {
  return req.ctx?.variantsOf?.(component) ?? RECIPES[component]?.variants ?? [];
}

/** Does `name` still appear anywhere but in an import? (JSX tags and plain references.) */
export function stillUsed(source: string, file: string, name: string): boolean {
  const parsed = parse(file, source);
  let used = false;
  const visit = (n: AnyNode) => {
    if (used || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (n.type === 'ImportDeclaration') return;
    if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && n.name === name) {
      used = true;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(n[k]);
    }
  };
  visit(parsed.program);
  return used;
}

/** Take `name` out of the `@maude/ds` import (the whole line when it was the only name). */
export function dropImport(source: string, file: string, name: string): string {
  const parsed = parse(file, source);
  const decl = (parsed.program.body as AnyNode[]).find(
    (st) =>
      st.type === 'ImportDeclaration' &&
      st.source?.value === '@maude/ds' &&
      st.importKind !== 'type' &&
      (st.specifiers ?? []).some(
        (sp: AnyNode) => sp.type === 'ImportSpecifier' && sp.local?.name === name
      )
  );
  if (!decl) return source;
  const specs = decl.specifiers as AnyNode[];
  const s = new MagicString(source);
  const i = specs.findIndex((sp) => sp.type === 'ImportSpecifier' && sp.local?.name === name);
  if (specs.length === 1) {
    const nl = source[decl.end] === '\n' ? 1 : 0;
    s.remove(decl.start, decl.end + nl);
  } else if (i > 0) s.remove(specs[i - 1].end, specs[i].end);
  else s.remove(specs[0].start, specs[1].start);
  return s.toString();
}

export const componentSwapVariant: EditOp = {
  id: 'component.swap-variant',
  apply(source, req) {
    const target = req.targets[0];
    if (!target || req.targets.length !== 1) return fail(req, 'Select one instance to swap.');
    const p = req.params;
    const hasVariant = Object.hasOwn(p, 'variant');
    const to = p.component;
    if (!hasVariant && to === undefined) return fail(req, 'Pick a variant or a component.');
    const f = readInstance(source, req.file, target.element);
    if (!f) return fail(req, 'This is not an instance of a component.');
    if (f.repeats) return fail(req, 'This one repeats; change it where it is written.');
    if (f.variant === 'code')
      return fail(req, `${target.element} sets its variant in code; change it in the code.`);

    let component = f.component;
    if (to !== undefined && to !== null) {
      if (typeof to !== 'string' || !NAME_RE.test(to) || !Object.hasOwn(RECIPES, to))
        return fail(req, 'That component cannot be swapped in from here.');
      if (to !== f.component && !swappableWith(f.component).includes(to))
        return fail(
          req,
          `${f.component} and ${to} hold different things; place ${to} and remove this one.`
        );
      component = to;
    }

    let variant: string | null = f.variant;
    let dropped: string | null = null;
    if (hasVariant) {
      const v = p.variant;
      if (v === null || v === '') variant = null;
      else if (typeof v !== 'string' || !VARIANT_RE.test(v))
        return fail(req, 'That variant is not one this component has.');
      else {
        const have = variantsFor(req, component);
        if (have.length === 0) return fail(req, `${component} has no variants.`);
        if (!have.includes(v)) return fail(req, 'That variant is not one this component has.');
        variant = v;
      }
    } else if (
      variant !== null &&
      component !== f.component &&
      !variantsFor(req, component).includes(variant)
    ) {
      dropped = variant;
      variant = null;
    }

    const parsed = parse(req.file, source);
    if (component !== f.component && topLevelNames(parsed.program).get(component) === 'other')
      return fail(req, `This canvas already has its own ${component}; rename it first.`);

    const s = new MagicString(source);
    const open = f.comp.openingElement;
    if (component !== f.component) {
      s.overwrite(open.name.start, open.name.end, component);
      const close = f.comp.closingElement;
      if (close) s.overwrite(close.name.start, close.name.end, component);
    }
    if (variant !== f.variant) {
      if (variant === null) {
        const a = f.variantAttr;
        if (a) {
          const ws = /\s*$/.exec(source.slice(0, a.start))?.[0].length ?? 0;
          s.remove(a.start - ws, a.end);
        }
      } else if (f.variantAttr)
        s.overwrite(f.variantAttr.start, f.variantAttr.end, `variant="${variant}"`);
      else s.appendLeft(open.name.end, ` variant="${variant}"`);
    }
    if (component !== f.component) addImports(s, source, parsed.program, [component]);
    let out = s.toString();
    if (component !== f.component && !stillUsed(out, req.file, f.component))
      out = dropImport(out, req.file, f.component);
    return { source: out, ...(dropped ? { detail: { droppedVariant: dropped } } : {}) };
  },
};
