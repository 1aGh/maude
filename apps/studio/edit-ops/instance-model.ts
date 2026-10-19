// edit-ops/instance-model.ts — S2.17: what an instance of a design-system component IS, read from the TSX.
//
// An instance is a JSX element whose tag is a name the canvas imports from `@maude/ds` (`<Button
// data-cd-id="cta" variant="primary">Book</Button>`), or — for a component that does not forward
// `data-cd-id` / `style` (Logo, Icon, Switch …) — the `<div data-cd-id>` that ⇧I wrapped around it. The
// facts the inspector shows and the three ops write all come from here, so a hand-written instance reads
// the same as a placed one. Pure: bytes in, facts and spans out; no IO.
//
// What counts as an OVERRIDE (what "N changes from <master>" counts and Reset takes back):
//   · the words, when they differ from the master's own (`defaultText` — what ⇧I writes: the export name);
//   · every inline `style` declaration that is not PLACEMENT. Where it sits (position, left, top, transform …)
//     is the frame's business, not the instance's look, so Reset keeps it.
// `variant` is a choice of master, not an override: swapping it is not a "change".

import { parseSync } from 'oxc-parser';

import { CanvasEditError } from '../canvas-edit.ts';
import { RECIPES, type Recipe, topLevelNames } from './insert-component.ts';

type AnyNode = any; // oxc-parser's ESTree nodes, untyped here like canvas-edit.ts

/** Declarations that say WHERE an instance is, not how it looks — Reset leaves them. */
export const PLACEMENT_PROPS = new Set([
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'inset',
  'inset-block',
  'inset-inline',
  'z-index',
  'transform',
  'translate',
  'rotate',
  'margin',
  'grid-area',
  'order',
  'align-self',
  'justify-self',
]);

/** The properties the Fill row speaks for. */
export const FILL_PROPS = new Set(['background', 'background-color', 'background-image']);

export const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export interface StyleProp {
  /** kebab-case */
  prop: string;
  start: number;
  end: number;
  /** a spread — its keys are unknown */
  spread: boolean;
}

export interface InstanceFacts {
  /** the `@maude/ds` export name */
  component: string;
  recipe: Recipe;
  /** the id-carrying element is a `<div>` around the component */
  wrapper: boolean;
  /** the id-carrying element (its open tag carries `data-cd-id`, `style`) */
  host: AnyNode;
  /** the component element */
  comp: AnyNode;
  /** `variant="x"` → x; null = none; 'code' = an expression (the file's, not ours) */
  variant: string | null | 'code';
  variantAttr: AnyNode | null;
  styleAttr: AnyNode | null;
  /** the host's `style` props; null = `style` is code (not an object literal) */
  style: StyleProp[] | null;
  /** the words, when they are a plain string; null = code or none */
  text: string | null;
  /** has children that are not one plain string */
  textInCode: boolean;
  /** the master's own words */
  defaultText: string;
  /** it sits in a `.map()` callback — one source element, many renders */
  repeats: boolean;
}

export interface Overrides {
  text: boolean;
  fill: boolean;
  /** the non-placement style props, in order */
  props: string[];
  count: number;
}

const attrOf = (open: AnyNode, name: string): AnyNode | null =>
  (open.attributes ?? []).find(
    (a: AnyNode) =>
      a.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === name
  ) ?? null;

const stringOf = (n: AnyNode): string | null => {
  if (!n) return null;
  if (n.type === 'Literal' || n.type === 'StringLiteral')
    return typeof n.value === 'string' ? n.value : null;
  if (n.type === 'TemplateLiteral' && n.expressions?.length === 0)
    return n.quasis?.[0]?.value?.cooked ?? null;
  return null;
};

const attrString = (a: AnyNode): string | null => {
  if (!a) return null;
  if (a.value == null) return null;
  const direct = stringOf(a.value);
  if (direct !== null) return direct;
  return a.value.type === 'JSXExpressionContainer' ? stringOf(a.value.expression) : null;
};

const tagName = (el: AnyNode): string =>
  el.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : '';

/** JSX text rule: lines trimmed and joined by one space. */
const jsxTextValue = (raw: string): string => raw.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim();

function childText(comp: AnyNode): { text: string | null; inCode: boolean } {
  const kids = (comp.children ?? []).filter(
    (c: AnyNode) => !(c.type === 'JSXText' && !String(c.value).trim())
  );
  if (kids.length === 0) return { text: null, inCode: false };
  if (kids.length === 1) {
    const k = kids[0];
    if (k.type === 'JSXText') return { text: jsxTextValue(String(k.value)), inCode: false };
    if (k.type === 'JSXExpressionContainer') {
      const s = stringOf(k.expression);
      if (s !== null) return { text: s, inCode: false };
    }
  }
  return { text: null, inCode: true };
}

function styleOf(host: AnyNode): { attr: AnyNode | null; props: StyleProp[] | null } {
  const attr = attrOf(host.openingElement, 'style');
  if (!attr) return { attr: null, props: [] };
  const obj = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  if (obj?.type !== 'ObjectExpression') return { attr, props: null };
  const props: StyleProp[] = [];
  for (const p of obj.properties as AnyNode[]) {
    if (p?.type === 'SpreadElement') {
      props.push({ prop: '', start: p.start, end: p.end, spread: true });
      continue;
    }
    const k = p?.key;
    const name = k?.type === 'Identifier' ? k.name : k?.type === 'Literal' ? String(k.value) : null;
    if (name === null || p.computed) return { attr, props: null };
    props.push({
      prop: name.startsWith('--') ? name : kebab(name),
      start: p.start,
      end: p.end,
      spread: false,
    });
  }
  return { attr, props };
}

/** Is the node inside a `.map(…)` (or any call) callback? One source element, many renders. */
const isRepeat = (ancestors: AnyNode[]): boolean =>
  ancestors.some(
    (a, i) =>
      a.type === 'CallExpression' &&
      a.callee?.type === 'MemberExpression' &&
      a.callee.property?.name === 'map' &&
      ancestors
        .slice(i + 1)
        .some((b) => b.type === 'ArrowFunctionExpression' || b.type === 'FunctionExpression')
  );

/** Every JSXElement with its ancestors, in source order. */
function jsxElements(program: AnyNode): Array<{ el: AnyNode; ancestors: AnyNode[] }> {
  const out: Array<{ el: AnyNode; ancestors: AnyNode[] }> = [];
  const visit = (node: AnyNode, ancestors: AnyNode[]) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, ancestors);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'JSXElement') out.push({ el: node, ancestors });
    const next = [...ancestors, node];
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k], next);
    }
  };
  visit(program, []);
  return out;
}

const fail = (file: string, id: string, message: string): never => {
  throw new CanvasEditError(message, { canvas: file, id });
};

/**
 * The instance whose id-carrying element has `data-cd-id="<id>"`, or null when that element is not one
 * (a plain frame, a local component's usage). A source that does not parse refuses.
 */
export function readInstance(source: string, file: string, id: string): InstanceFacts | null {
  const parsed = parseSync(file.endsWith('.tsx') ? file : `${file}.tsx`, source, {
    sourceType: 'module',
  });
  if (parsed.errors?.length) return fail(file, id, 'This canvas does not parse.');
  const bound = topLevelNames(parsed.program);
  const isDs = (n: string) => bound.get(n) === 'ds' && Object.hasOwn(RECIPES, n);
  const all = jsxElements(parsed.program);
  const hit = all.find(({ el }) => attrString(attrOf(el.openingElement, 'data-cd-id')) === id);
  if (!hit) return null;
  const host = hit.el;
  let comp: AnyNode | null = null;
  let wrapper = false;
  const name = tagName(host);
  if (isDs(name)) comp = host;
  else if (name === 'div') {
    const kids = (host.children ?? []).filter(
      (c: AnyNode) => !(c.type === 'JSXText' && !String(c.value).trim())
    );
    if (kids.length === 1 && kids[0].type === 'JSXElement' && isDs(tagName(kids[0]))) {
      comp = kids[0];
      wrapper = true;
    }
  }
  if (!comp) return null;
  const component = tagName(comp);
  const recipe = RECIPES[component] as Recipe;
  const variantAttr = attrOf(comp.openingElement, 'variant');
  let variant: InstanceFacts['variant'] = null;
  if (variantAttr) {
    const v = attrString(variantAttr);
    variant = v === null ? 'code' : v;
  }
  const { attr: styleAttr, props: style } = styleOf(host);
  const { text, inCode } =
    recipe.children === 'text' ? childText(comp) : { text: null, inCode: false };
  return {
    component,
    recipe,
    wrapper,
    host,
    comp,
    variant,
    variantAttr,
    styleAttr,
    style,
    text,
    textInCode: inCode,
    defaultText: component,
    repeats: isRepeat(hit.ancestors),
  };
}

/** What this instance sets over its master. */
export function overridesOf(f: InstanceFacts): Overrides {
  const props = (f.style ?? [])
    .filter((p) => !p.spread && !PLACEMENT_PROPS.has(p.prop))
    .map((p) => p.prop);
  const text = f.recipe.children === 'text' && f.text !== null && f.text !== f.defaultText;
  return {
    text,
    fill: props.some((p) => FILL_PROPS.has(p)),
    props,
    count: props.length + (text ? 1 : 0),
  };
}

/** The components `component` can be swapped for: the same shape (holds words; forwards its props). */
export function swappableWith(
  component: string,
  all: readonly string[] = Object.keys(RECIPES)
): string[] {
  const r = RECIPES[component];
  if (!r || r.children !== 'text' || !r.forwards) return [component];
  return all.filter((n) => RECIPES[n]?.children === 'text' && RECIPES[n]?.forwards);
}
