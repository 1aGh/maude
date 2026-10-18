// edit-ops/insert-component.ts — `component.insert` (⇧I, S2.16, ed-comp-pick): place an instance of a
// design-system component, LINKED — the canvas imports it from `@maude/ds`, it does not copy it.
//
// params
//   component   the export name (`Button`) — one of RECIPES, the same list `GET /_api/ds/components`
//               offers; anything else is refused (an agent cannot plant arbitrary JSX through here)
//   variant     optional (`primary`); only for a component that takes one
//   text        optional words for a component that holds some (≤ 120 chars, one line)
//   glyph       optional icon name for Icon
//   artboard    where to put it when no target names a frame (the DCArtboard `id`)
//   at          optional free placement: `{ x: number | 'centre', y: number }` — px from the container's
//               top-left, or centred across it. Absent = in the flow (appended after the last child).
// targets[0]    optional: the frame to put it in ("↵ places it in the selected frame")
//
// What is written, once: `import { Name } from "@maude/ds"` (merged into an existing @maude/ds import,
// never twice), and the instance as the LAST child of the frame or artboard. A component that does not
// forward `data-cd-id` / `style` to its DOM node (Logo, Icon, Switch …) sits inside a plain `<div
// data-cd-id>` so it stays selectable. A canvas that is LEFT OUT of the design system's current
// revision (`meta.dsRev`) gets `data-ds-rev="head"` on the new instance: it "arrives current" (V2-1.6
// §5.8). The server knows that from the meta — never from the request.
//
// Pure: bytes in, bytes out. A refusal throws `CanvasEditError` in the canvas's words.

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { CanvasEditError } from '../canvas-edit.ts';
import { generateElementId, usedIds, walkIdElements } from '../element-ids.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';

type AnyNode = any; // oxc-parser's ESTree nodes, untyped here like canvas-edit.ts

export const DS_SPECIFIER = '@maude/ds';

export interface Recipe {
  /** the component forwards `data-cd-id`, `data-ds-rev` and `style` to its DOM node */
  forwards: boolean;
  /** the `variant` values the shipped defaults know (a system's components.json may list others) */
  variants?: readonly string[];
  /** literal props, as written */
  props?: string;
  /** what goes between the tags: 'text' = the words, a string = fixed JSX, absent = self-closing */
  children?: 'text' | string;
  /** other `@maude/ds` names the children use */
  uses?: readonly string[];
}

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
const ITEMS = 'items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value="a"' as const;

/** The components ⇧I can place: the core set of V2-1.13 §5.3.9 + the brand pieces (§5.11). */
export const RECIPES: Readonly<Record<string, Recipe>> = Object.freeze({
  Button: { forwards: true, variants: BUTTON_VARIANTS, children: 'text' },
  IconButton: {
    forwards: true,
    variants: BUTTON_VARIANTS,
    props: 'label="Action"',
    children: '<Icon name="add" />',
    uses: ['Icon'],
  },
  Input: { forwards: true, props: 'placeholder="Text"' },
  Field: { forwards: false, props: 'label="Label"', children: '<Input />', uses: ['Input'] },
  Switch: { forwards: false, props: 'checked={false} label="Switch"' },
  Checkbox: { forwards: true },
  Segmented: { forwards: false, props: ITEMS },
  Tabs: { forwards: false, props: ITEMS },
  Chip: { forwards: true, variants: ['accent', 'soft'], children: 'text' },
  Badge: {
    forwards: true,
    variants: ['success', 'warn', 'error', 'info', 'accent'],
    children: 'text',
  },
  Card: { forwards: true, variants: ['raised', 'interactive', 'flat'], children: 'text' },
  Callout: { forwards: true, variants: ['info', 'success', 'warn', 'error'], children: 'text' },
  Dialog: { forwards: false, props: 'title="Title"', children: 'text' },
  Tooltip: { forwards: false, children: 'text' },
  Logo: { forwards: false, variants: ['mark', 'wordmark', 'lockup'] },
  Icon: { forwards: false },
});

const NAME_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;
const VARIANT_RE = /^[a-z][a-z0-9-]{0,31}$/;
const GLYPH_RE = /^[a-z]+(?:-[a-z]+)*$/;
const MAX_TEXT = 120;
const LIMIT = 1_000_000;

export const DS_REV_HEAD = 'head';

/**
 * `data-ds-rev` for an instance placed on a canvas with this meta: `"head"` when the canvas is left
 * out of the current revision (`meta.dsRev` set), else null (V2-1.6 §5.8).
 */
export function dsRevForPlacement(meta: { dsRev?: unknown } | null | undefined): string | null {
  return typeof meta?.dsRev === 'string' && meta.dsRev ? DS_REV_HEAD : null;
}

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

/** JSX text that survives any character: plain when it is safe, a string expression otherwise. */
const jsxText = (s: string): string => (/[{}<>&]/.test(s) ? `{${JSON.stringify(s)}}` : s);

interface Parsed {
  component: string;
  recipe: Recipe;
  variant: string | null;
  text: string;
  glyph: string | null;
  artboard: string | null;
  at: { x: number | 'centre'; y: number } | null;
}

function read(req: ResolvedEditOp): Parsed {
  const p = req.params as Record<string, unknown>;
  const component = p.component;
  if (
    typeof component !== 'string' ||
    !NAME_RE.test(component) ||
    !Object.hasOwn(RECIPES, component)
  )
    return fail(req, 'That component cannot be placed from here.');
  const recipe = RECIPES[component] as Recipe;
  let variant: string | null = null;
  if (p.variant !== undefined && p.variant !== null) {
    if (typeof p.variant !== 'string' || !VARIANT_RE.test(p.variant))
      return fail(req, 'That variant is not one this component has.');
    if (!recipe.variants) return fail(req, `${component} has no variants.`);
    variant = p.variant;
  }
  let text = component;
  if (p.text !== undefined && p.text !== null) {
    if (typeof p.text !== 'string' || /\p{Cc}/u.test(p.text) || p.text.length > MAX_TEXT)
      return fail(req, 'The words for this component are not readable.');
    if (p.text.trim()) text = p.text.trim();
  }
  let glyph: string | null = null;
  if (p.glyph !== undefined && p.glyph !== null) {
    if (typeof p.glyph !== 'string' || !GLYPH_RE.test(p.glyph) || p.glyph.length > 40)
      return fail(req, 'That icon is not one of the system’s.');
    glyph = p.glyph;
  }
  let artboard: string | null = null;
  if (p.artboard !== undefined && p.artboard !== null) {
    if (typeof p.artboard !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.artboard))
      return fail(req, 'That artboard is not on this canvas.');
    artboard = p.artboard;
  }
  let at: Parsed['at'] = null;
  if (p.at !== undefined && p.at !== null) {
    const a = p.at as Record<string, unknown>;
    const x = a?.x;
    const y = a?.y;
    const okX =
      x === 'centre' || (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= LIMIT);
    if (
      !a ||
      typeof a !== 'object' ||
      !okX ||
      typeof y !== 'number' ||
      !Number.isFinite(y) ||
      Math.abs(y) > LIMIT
    )
      return fail(req, 'The canvas did not say where to put it; try again.');
    at = { x: x as number | 'centre', y: Math.round(y) };
    if (typeof at.x === 'number') at.x = Math.round(at.x);
  }
  return { component, recipe, variant, text, glyph, artboard, at };
}

// ── the import ────────────────────────────────────────────────────────────────────────────────

/** Top-level names a canvas already binds (imports, functions, classes, variables). */
function topLevelNames(program: AnyNode): Map<string, 'ds' | 'other'> {
  const names = new Map<string, 'ds' | 'other'>();
  const bind = (n: AnyNode, kind: 'ds' | 'other') => {
    if (n?.type === 'Identifier') names.set(n.name, kind);
    else if (n?.type === 'ObjectPattern')
      for (const pr of n.properties ?? []) bind(pr.value ?? pr.argument, kind);
    else if (n?.type === 'ArrayPattern') for (const el of n.elements ?? []) bind(el, kind);
    else if (n?.type === 'AssignmentPattern') bind(n.left, kind);
    else if (n?.type === 'RestElement') bind(n.argument, kind);
  };
  const decl = (d: AnyNode) => {
    if (!d) return;
    if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') bind(d.id, 'other');
    else if (d.type === 'VariableDeclaration') for (const v of d.declarations) bind(v.id, 'other');
  };
  for (const st of program.body ?? []) {
    if (st.type === 'ImportDeclaration') {
      const fromDs = st.source?.value === DS_SPECIFIER && st.importKind !== 'type';
      for (const sp of st.specifiers ?? [])
        if (sp.local?.name)
          names.set(
            sp.local.name,
            fromDs && sp.type === 'ImportSpecifier' && sp.imported?.name === sp.local.name
              ? 'ds'
              : 'other'
          );
    } else if (st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') {
      decl(st.declaration);
    } else decl(st);
  }
  return names;
}

/** Put `import { names } from "@maude/ds"` in the file once: merged into the one it has, else new. */
function addImports(s: MagicString, source: string, program: AnyNode, names: string[]): void {
  const bound = topLevelNames(program);
  const missing = names.filter((n) => bound.get(n) !== 'ds');
  if (missing.length === 0) return;
  const imports = (program.body ?? []).filter((st: AnyNode) => st.type === 'ImportDeclaration');
  const own = imports.find(
    (st: AnyNode) =>
      st.source?.value === DS_SPECIFIER &&
      st.importKind !== 'type' &&
      (st.specifiers ?? []).some((sp: AnyNode) => sp.type === 'ImportSpecifier')
  );
  if (own) {
    const named = (own.specifiers as AnyNode[]).filter((sp) => sp.type === 'ImportSpecifier');
    const last = named[named.length - 1] as AnyNode;
    s.appendLeft(last.end as number, `, ${missing.join(', ')}`);
    return;
  }
  const first = imports[0] as AnyNode | undefined;
  const raw = first ? source.slice(first.source.start, first.source.end) : '';
  const quote = raw.startsWith("'") ? "'" : '"';
  const line = `import { ${missing.join(', ')} } from ${quote}${DS_SPECIFIER}${quote};`;
  const lastImport = imports[imports.length - 1] as AnyNode | undefined;
  if (lastImport) s.appendLeft(lastImport.end as number, `\n${line}`);
  else s.prepend(`${line}\n`);
}

// ── the container ─────────────────────────────────────────────────────────────────────────────

const lineIndentAt = (source: string, at: number): string => {
  const ls = source.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(source.slice(ls, at))?.[0] ?? '';
};

/** The container to append into: its closing-tag offset and the indent of the line it sits on. */
function containerOf(
  source: string,
  req: ResolvedEditOp,
  walk: Extract<ReturnType<typeof walkIdElements>, { ok: true }>,
  artboard: string | null
): { closeAt: number; tagIndent: string; label: string } {
  const ref: ElementRef | undefined = req.targets[0];
  const el = ref
    ? walk.elements.find((e) => e.id === ref.element)
    : walk.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === artboard);
  if (!el) return fail(req, 'Select a frame or an artboard to put it in.');
  if (el.tag === 'DCSection') return fail(req, 'Put it in an artboard, not on the section.');
  const text = source.slice(el.start, el.end);
  const close = text.lastIndexOf('</');
  if (!text.endsWith('>') || text.endsWith('/>') || close < 0)
    return fail(req, 'That object cannot hold anything; select a frame.');
  if (/^<(?:img|input|br|hr|svg|path|video|audio|canvas|textarea)\b/i.test(text))
    return fail(req, 'That object cannot hold anything; select a frame.');
  return { closeAt: el.start + close, tagIndent: lineIndentAt(source, el.start), label: el.tag };
}

// ── the op ────────────────────────────────────────────────────────────────────────────────────

export const componentInsert: EditOp = {
  id: 'component.insert',
  apply(source, req) {
    const a = read(req);
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return fail(req, 'This canvas does not parse.');
    if (req.targets.length > 1) return fail(req, 'Select one frame to put it in.');
    if (!req.targets[0] && !a.artboard)
      return fail(req, 'Select a frame or an artboard to put it in.');
    const box = containerOf(source, req, walk, a.artboard);
    const parsed = parseSync(req.file.endsWith('.tsx') ? req.file : `${req.file}.tsx`, source, {
      sourceType: 'module',
    });
    if (parsed.errors?.length) return fail(req, 'This canvas does not parse.');

    const { component, recipe } = a;
    // a name the canvas already binds to something of its own would shadow (or be shadowed by) the system's
    const bound = topLevelNames(parsed.program);
    const wants = [component, ...(recipe.uses ?? [])];
    for (const n of wants)
      if (bound.get(n) === 'other')
        return fail(req, `This canvas already has its own ${n}; rename it first.`);

    const used = usedIds(walk.elements);
    const arrival = dsRevForPlacement(req.ctx);
    const unit = box.tagIndent.includes('\t') ? '\t' : '  ';
    const here = `${box.tagIndent}${unit}`;

    const props: string[] = [];
    if (a.variant) props.push(`variant="${a.variant}"`);
    if (component === 'Icon') props.push(`name="${a.glyph ?? 'star'}"`, 'size={24}');
    else if (recipe.props) props.push(recipe.props);
    const inner =
      recipe.children === 'text' ? jsxText(a.text) : (recipe.children as string | undefined);

    const seed = { tag: component, text: recipe.children === 'text' ? a.text : '' };
    const id = generateElementId(seed, used);
    const style: string[] = [];
    if (a.at) {
      style.push("position: 'absolute'");
      if (a.at.x === 'centre') style.push("left: '50%'");
      else style.push(`left: ${a.at.x}`);
      style.push(`top: ${a.at.y}`);
      if (a.at.x === 'centre') style.push("transform: 'translateX(-50%)'");
    }
    const outerAttrs = [
      `data-cd-id="${id}"`,
      ...(arrival ? [`data-ds-rev="${arrival}"`] : []),
      ...(style.length ? [`style={{ ${style.join(', ')} }}`] : []),
    ];
    const open = (tag: string, attrs: string[]) =>
      `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    const element = (attrs: string[]): string =>
      inner === undefined
        ? `${open(component, attrs)} />`
        : `${open(component, attrs)}>${inner}</${component}>`;
    const jsx = recipe.forwards
      ? element([...outerAttrs, ...props])
      : `${open('div', outerAttrs)}>${element(props)}</div>`;

    const s = new MagicString(source);
    const ls = source.lastIndexOf('\n', box.closeAt - 1) + 1;
    if (/^[ \t]*$/.test(source.slice(ls, box.closeAt))) s.appendLeft(ls - 1, `\n${here}${jsx}`);
    else s.appendLeft(box.closeAt, jsx);
    addImports(s, source, parsed.program, wants);

    const out = s.toString();
    const check = walkIdElements(out, req.file);
    if (!check.ok)
      return fail(req, 'That would leave this canvas unreadable; nothing was changed.');
    const ownArtboard =
      box.label === 'DCArtboard' ? a.artboard : (req.targets[0]?.artboard ?? a.artboard);
    return { source: out, created: [{ artboard: ownArtboard ?? '', element: id }] };
  },
};
