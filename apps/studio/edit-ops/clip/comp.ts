// edit-ops/clip/comp.ts — where a video artboard's comp lives in the canvas source (S7.6c).
//
// A video artboard is `<DCArtboard id=…><VideoComp component={X} …/></DCArtboard>`; X is a component
// declared in the same file. Linked formats are DERIVED, not stored (S7 Q4, decision
// maude/v2-S7-linked-formats-derived): artboards whose VideoComp names the same X share one cut.
// Pure: no IO.

import { enumerateClips } from '../../canvas-edit.ts';
import { bad, jsxElements, literalProp, type Node, tagOf } from './jsx.ts';

/** A VideoComp artboard: the DCArtboard element, its VideoComp element and the comp's name. */
export interface VideoArtboard {
  id: string;
  artboard: Node;
  videoComp: Node;
  comp: string | null;
}

/** Every DCArtboard that mounts a VideoComp, in document order. */
export function videoArtboards(file: string, program: Node): VideoArtboard[] {
  const els = jsxElements(program);
  const out: VideoArtboard[] = [];
  for (const { el } of els) {
    if (tagOf(el) !== 'DCArtboard') continue;
    const vc = els.find(
      (e) => e.el.start > el.start && e.el.end <= el.end && tagOf(e.el) === 'VideoComp'
    )?.el;
    if (!vc) continue;
    const id = literalProp(file, el, 'id');
    if (typeof id !== 'string') continue;
    const cv = vc.openingElement.attributes.find(
      (a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'component'
    )?.value;
    const comp =
      cv?.type === 'JSXExpressionContainer' && cv.expression?.type === 'Identifier'
        ? (cv.expression.name as string)
        : null;
    out.push({ id, artboard: el, videoComp: vc, comp });
  }
  return out;
}

/** The video artboard `id` names; refuses when there is none. */
export function videoArtboard(file: string, program: Node, id: string | undefined): VideoArtboard {
  const all = videoArtboards(file, program);
  const hit = id === undefined ? all[0] : all.find((a) => a.id === id);
  if (!hit) bad(file, 'That artboard is not a video.', id ?? '');
  return hit as VideoArtboard;
}

/** The top-level statement declaring component `name` (`function X…`, `const X = () => …`, either
 *  exported), the inner declaration node, and the span of the declared identifier. */
export function compDeclaration(
  program: Node,
  name: string
): { statement: Node; decl: Node; id: Node } | null {
  for (const st of program.body ?? []) {
    const inner =
      st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration'
        ? st.declaration
        : st;
    if (!inner) continue;
    if (inner.type === 'FunctionDeclaration' && inner.id?.name === name)
      return { statement: st, decl: inner, id: inner.id };
    if (inner.type === 'VariableDeclaration')
      for (const d of inner.declarations ?? [])
        if (d.id?.type === 'Identifier' && d.id.name === name)
          return { statement: st, decl: inner, id: d.id };
  }
  return null;
}

/** The comp the artboard mounts (enumerateClips' own resolution), and its declaration. */
export function compOf(
  file: string,
  source: string,
  program: Node,
  artboard: string | undefined
): { name: string; statement: Node; decl: Node; id: Node } {
  const name = enumerateClips(file, source, artboard).compName;
  const d = name ? compDeclaration(program, name) : null;
  if (!name || !d) bad(file, 'This video’s composition is not in the canvas file.', artboard ?? '');
  return { name: name as string, ...(d as NonNullable<typeof d>) };
}

const unparen = (n: Node): Node =>
  n?.type === 'ParenthesizedExpression' ? unparen(n.expression) : n;
const isJsx = (n: Node) => n?.type === 'JSXElement' || n?.type === 'JSXFragment';

/** The comp's returned tree: an arrow's expression body, or the function body's top-level
 *  `return <…>`; else the outermost JSX inside the declaration. */
export function rootJsx(decl: Node): Node | null {
  const fn =
    decl.type === 'FunctionDeclaration'
      ? decl
      : (decl.declarations ?? []).map((d: Node) => d.init).find(Boolean);
  const body = fn?.body;
  if (body && isJsx(unparen(body))) return unparen(body);
  if (body?.type === 'BlockStatement')
    for (const st of [...(body.body ?? [])].reverse())
      if (st.type === 'ReturnStatement' && isJsx(unparen(st.argument))) return unparen(st.argument);
  return firstJsx(decl);
}

function firstJsx(node: Node): Node | null {
  let found: Node | null = null;
  const visit = (n: Node): void => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
      found = n;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(n[k]);
    }
  };
  visit(node);
  return found;
}
