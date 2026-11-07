// video/object-fit.ts — #128 §3: `style.objectFit` on @remotion/media's <Video> is silently dropped.
//
// <Video> takes `objectFit` as a PROP (default "contain") and overwrites `style.objectFit` with it, so a
// 16:9 clip in a 9:16 artboard with `style={{ objectFit: "cover" }}` stayed letterboxed, in the preview
// and in the export (the old <OffthreadVideo> read the style, so existing kits spread a `cover()` helper
// into it). The canvas build therefore reads the style's objectFit into the prop for the author, and
// `maude design check` (check/video.ts) tells them to write the prop themselves.
//
//   <Video style={{ objectFit: "cover" }} />   →   <Video objectFit={({ objectFit: "cover" })?.objectFit} style=… />
//
// The source on disk is never touched (the build maps the text it is about to bundle, like video/inject.ts).
// Rules: the prop wins when both are given; a clip directly inside a canvas-lib <Reframe> is left alone
// (Reframe frames its child itself); the style is read at run time (`(style)?.objectFit`), so a spread
// helper or a const works too. Pure: oxc-parser only (check/video.ts imports `objectFitSites`).

import { parseSync } from 'oxc-parser';

// biome-ignore lint/suspicious/noExplicitAny: oxc's ESTree nodes are walked structurally
type Node = any;

const MEDIA = '@remotion/media';
const LIB = '@maude/canvas-lib';
/** The video components of @remotion/media (the ones that read the `objectFit` prop). */
const VIDEO_EXPORTS = new Set(['Video', 'experimental_Video']);

export interface ObjectFitSite {
  el: Node;
  /** the source text of the `style` expression: `{ objectFit: "cover" }` */
  styleText: string;
  /** where the new attribute goes: straight after the tag name, so a later attribute (a spread) wins */
  insertAt: number;
}

function importedNames(
  program: Node,
  from: string,
  wanted: (name: string) => boolean
): Set<string> {
  const out = new Set<string>();
  for (const st of program?.body ?? []) {
    if (st.type !== 'ImportDeclaration' || st.source?.value !== from) continue;
    for (const sp of st.specifiers ?? []) {
      if (sp.type !== 'ImportSpecifier') continue;
      const imported = sp.imported?.name ?? sp.imported?.value;
      if (typeof imported === 'string' && wanted(imported) && sp.local?.name)
        out.add(sp.local.name);
    }
  }
  return out;
}

const tagName = (el: Node): string | null =>
  el?.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null;

/** Every JSXElement with the element it sits directly under (null at the top). */
function walk(program: Node): Array<{ el: Node; parent: Node | null }> {
  const out: Array<{ el: Node; parent: Node | null }> = [];
  const visit = (node: Node, parent: Node | null): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c, parent);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'JSXElement') out.push({ el: node, parent });
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k], node.type === 'JSXElement' ? node : parent);
    }
  };
  visit(program, null);
  return out.sort((a, b) => a.el.start - b.el.start);
}

/** `{ a: 1, b }` with no spread and no `objectFit` key: nothing in it can set the fit. */
function cannotSetFit(expr: Node): boolean {
  if (expr?.type !== 'ObjectExpression') return false;
  return !(expr.properties ?? []).some(
    (p: Node) =>
      p.type === 'SpreadElement' || p.computed || (p.key?.name ?? p.key?.value) === 'objectFit'
  );
}

/**
 * The @remotion/media `<Video>` elements whose `style` may carry an objectFit and which have no
 * `objectFit` prop of their own. `text` is the program's source.
 */
export function objectFitSites(program: Node, text: string): ObjectFitSite[] {
  const videos = importedNames(program, MEDIA, (n) => VIDEO_EXPORTS.has(n));
  if (videos.size === 0) return [];
  const reframes = importedNames(program, LIB, (n) => n === 'Reframe');
  const out: ObjectFitSite[] = [];
  for (const { el, parent } of walk(program)) {
    const tag = tagName(el);
    if (!tag || !videos.has(tag)) continue;
    if (parent && reframes.has(tagName(parent) ?? '')) continue;
    const attrs: Node[] = el.openingElement.attributes ?? [];
    const named = (n: string) =>
      attrs.find(
        (a) => a.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === n
      );
    if (named('objectFit')) continue;
    const style = named('style');
    const container = style?.value;
    if (container?.type !== 'JSXExpressionContainer') continue;
    const expr = container.expression;
    if (!expr || expr.type === 'JSXEmptyExpression' || cannotSetFit(expr)) continue;
    out.push({
      el,
      styleText: text.slice(expr.start, expr.end),
      insertAt: el.openingElement.name.end as number,
    });
  }
  return out;
}

/**
 * `text` (a canvas module the build is about to bundle) with every site's `objectFit` prop added.
 * Never throws: text that does not parse comes back unchanged, the bundler reports the syntax.
 */
export function mapVideoObjectFit(file: string, text: string): string {
  // no `objectFit` text gate: the helper that sets it (`cover()`) may live in another file
  if (!text.includes(MEDIA)) return text;
  let program: Node;
  try {
    const parsed = parseSync(file, text, { sourceType: 'module', lang: 'tsx' });
    if (parsed.errors?.length) return text;
    program = parsed.program;
  } catch {
    return text;
  }
  const sites = objectFitSites(program, text);
  let code = text;
  for (const s of sites.sort((a, b) => b.insertAt - a.insertAt))
    code = `${code.slice(0, s.insertAt)} objectFit={(${s.styleText})?.objectFit}${code.slice(s.insertAt)}`;
  return code;
}
