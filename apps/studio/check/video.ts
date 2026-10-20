// check/video.ts — S7.5: the canvas-tsx rules for the comp vocabulary (contract V2-1.10 §5.7 lint
// additions, §5.8 B3). Called by check/index.ts `checkCanvasTsx` on the already-parsed program.
//
//   video-captions-twice   one <Captions> per comp
//   video-duck-child       <Duck> wraps exactly one <Audio>
//   video-reframe-follow   <Reframe follow> (following a subject) is not in Maude 2.0 (B3)
//   video-reframe-focus    focus / formats keys: literal [sourceSec, x, y], sorted, x and y in [0, 1]
//   video-reframe-zoom     zoom ≥ 1;  video-reframe-fit: fill | fit | blur
//   video-place-at         <Place at formats>: literal [x, y] pairs in [0, 1]
//   video-captions-fixes   `fixes` is a JSON literal of { src, at, text }
//   video-derived-prop     `__words` / `__speech` are the build's — never in the file
//
// Only components imported from `@maude/canvas-lib` are judged (aliases followed): a comp's own
// local `Captions` (today's CUES pattern) is the author's business.

// biome-ignore lint/suspicious/noExplicitAny: oxc's ESTree nodes are walked structurally
type Node = any;

export interface VideoFinding {
  code: string;
  where: string;
  what: string;
  fix: string;
  line: number;
}

const LIB = '@maude/canvas-lib';
const VOCAB = ['Captions', 'Duck', 'Reframe', 'Place'] as const;
type Vocab = (typeof VOCAB)[number];
const ASPECT_RE = /^[1-9]\d{0,4}:[1-9]\d{0,4}$/;

function lineAt(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function imports(program: Node): Map<string, Vocab> {
  const out = new Map<string, Vocab>();
  for (const st of program?.body ?? []) {
    if (st.type !== 'ImportDeclaration' || st.source?.value !== LIB) continue;
    for (const sp of st.specifiers ?? []) {
      const imported = sp.imported?.name ?? sp.imported?.value;
      if (sp.type === 'ImportSpecifier' && VOCAB.includes(imported) && sp.local?.name)
        out.set(sp.local.name, imported as Vocab);
    }
  }
  return out;
}

function elements(program: Node): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    if (n.type === 'JSXElement') out.push(n);
    for (const k in n) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const tagOf = (el: Node): string | null =>
  el?.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null;

const attr = (el: Node, name: string): Node | null =>
  (el.openingElement?.attributes ?? []).find(
    (a: Node) => a.type === 'JSXAttribute' && a.name?.name === name
  ) ?? null;

const NOT = Symbol('not-literal');

/** A JSON-shaped literal (numbers, strings, null, booleans, arrays, plain objects), or NOT. */
function literal(n: Node): unknown {
  if (!n) return NOT;
  switch (n.type) {
    case 'Literal':
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return n.value;
    case 'NullLiteral':
      return null;
    case 'UnaryExpression':
      if (
        n.operator === '-' &&
        (n.argument?.type === 'Literal' || n.argument?.type === 'NumericLiteral')
      ) {
        const v = n.argument.value;
        return typeof v === 'number' ? -v : NOT;
      }
      return NOT;
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const e of n.elements ?? []) {
        const v = literal(e);
        if (v === NOT) return NOT;
        out.push(v);
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of n.properties ?? []) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') return NOT;
        const key = p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
        if (typeof key !== 'string') return NOT;
        const v = literal(p.value);
        if (v === NOT) return NOT;
        out[key] = v;
      }
      return out;
    }
    case 'ParenthesizedExpression':
      return literal(n.expression);
    default:
      return NOT;
  }
}

/** The literal value of an attribute: a string value, a `{…}` literal, `true` when bare. */
function attrValue(a: Node): unknown {
  const v = a.value;
  if (v == null) return true;
  if (v.type === 'JSXExpressionContainer') return literal(v.expression);
  return literal(v);
}

const frac = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Why a focus-key list is wrong, or null. */
function focusProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return 'is not a list of [sourceSec, x, y] keys';
  let prev = Number.NEGATIVE_INFINITY;
  for (const k of v) {
    if (
      !Array.isArray(k) ||
      k.length !== 3 ||
      !k.every((x) => typeof x === 'number' && Number.isFinite(x))
    )
      return 'has a key that is not [sourceSec, x, y]';
    const [t, x, y] = k as [number, number, number];
    if (t < 0) return 'has a key before the start of the source';
    if (t < prev) return 'keys are not in time order';
    if (!frac(x) || !frac(y)) return 'has an x or y outside 0…1';
    prev = t;
  }
  return null;
}

/** The top-level declaration (component) an offset sits in. */
function compSpans(program: Node): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (const st of program?.body ?? []) {
    const inner =
      st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration'
        ? (st.declaration ?? st)
        : st;
    if (inner.type === 'FunctionDeclaration')
      out.push({ name: inner.id?.name ?? 'default', start: st.start, end: st.end });
    else if (inner.type === 'VariableDeclaration')
      for (const d of inner.declarations ?? [])
        out.push({ name: d.id?.name ?? '?', start: d.start ?? st.start, end: d.end ?? st.end });
    else out.push({ name: '(module)', start: st.start, end: st.end });
  }
  return out;
}

export function videoVocabFindings(rel: string, text: string, program: Node): VideoFinding[] {
  const names = imports(program);
  if (names.size === 0) return [];
  const out: VideoFinding[] = [];
  const push = (code: string, at: number, what: string, fix: string) => {
    const line = lineAt(text, at);
    out.push({ code, where: `${rel}:${line}`, what, fix, line });
  };
  const comps = compSpans(program);
  const captionsIn = new Map<string, number>();

  for (const el of elements(program)) {
    const local = tagOf(el);
    const kind = local ? names.get(local) : undefined;
    if (!kind) continue;
    const at = el.start as number;

    for (const p of ['__words', '__speech'])
      if (attr(el, p))
        push(
          'video-derived-prop',
          at,
          `${p} on <${kind}> is filled in by Maude when the canvas builds`,
          `remove ${p} from the file — the words and speech come from the transcripts`
        );

    if (kind === 'Captions') {
      const comp = comps.find((c) => c.start <= at && at < c.end)?.name ?? '(module)';
      const first = captionsIn.get(comp);
      if (first !== undefined)
        push(
          'video-captions-twice',
          at,
          `${comp} has a second <Captions> (the first is on line ${first})`,
          'keep one <Captions> per comp — restyle the one already there'
        );
      else captionsIn.set(comp, lineAt(text, at));
      const fx = attr(el, 'fixes');
      if (fx) {
        // JSON, not just a literal: the build reads it with JSON.parse (derive.ts captionFixesOf),
        // so `{ src: … }` with bare keys would silently apply no fix.
        const e = fx.value?.type === 'JSXExpressionContainer' ? fx.value.expression : null;
        let v: unknown = NOT;
        try {
          if (e) v = JSON.parse(text.slice(e.start, e.end));
        } catch {
          v = NOT;
        }
        const ok =
          Array.isArray(v) &&
          v.every(
            (f) =>
              f &&
              typeof f === 'object' &&
              !Array.isArray(f) &&
              typeof (f as Record<string, unknown>).src === 'string' &&
              typeof (f as Record<string, unknown>).at === 'number' &&
              ((f as Record<string, unknown>).text === null ||
                typeof (f as Record<string, unknown>).text === 'string')
          );
        if (!ok)
          push(
            'video-captions-fixes',
            at,
            '<Captions fixes> is not a list of { src, at, text } written out in full',
            'write fixes as a JSON literal: [{ "src": "assets/….mp4", "at": 3.45, "text": "word" }]'
          );
      }
    } else if (kind === 'Duck') {
      const kids = (el.children ?? []).filter(
        (c: Node) => !(c.type === 'JSXText' && !String(c.value ?? '').trim())
      );
      const one = kids.length === 1 && kids[0].type === 'JSXElement';
      if (!one || !/^(?:Maude)?Audio$/.test(tagOf(kids[0]) ?? ''))
        push(
          'video-duck-child',
          at,
          '<Duck> must wrap exactly one <Audio>',
          'put the one music <Audio> inside <Duck>, and nothing else'
        );
    } else if (kind === 'Reframe') {
      if (attr(el, 'follow'))
        push(
          'video-reframe-follow',
          at,
          'following a subject is not in Maude 2.0',
          'remove follow and set focus keyframes: focus={[[sourceSec, x, y], …]}'
        );
      const focus = attr(el, 'focus');
      if (focus) {
        const why = focusProblem(attrValue(focus));
        if (why)
          push(
            'video-reframe-focus',
            at,
            `<Reframe focus> ${why}`,
            'write focus={[[sourceSec, x, y], …]} sorted by time, x and y between 0 and 1'
          );
      }
      const formats = attr(el, 'formats');
      if (formats) {
        const v = attrValue(formats);
        const bad =
          !v ||
          typeof v !== 'object' ||
          Array.isArray(v) ||
          Object.entries(v as Record<string, unknown>).some(
            ([k, keys]) => !ASPECT_RE.test(k) || focusProblem(keys) !== null
          );
        if (bad)
          push(
            'video-reframe-focus',
            at,
            '<Reframe formats> is not a map of "W:H" to focus keys',
            'write formats={{ "16:9": [[sourceSec, x, y], …] }}'
          );
      }
      const zoom = attr(el, 'zoom');
      if (zoom) {
        const v = attrValue(zoom);
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 1)
          push('video-reframe-zoom', at, '<Reframe zoom> is below 1', 'write zoom={1} or more');
      }
      const fit = attr(el, 'fit');
      if (fit) {
        const v = attrValue(fit);
        if (v !== 'fill' && v !== 'fit' && v !== 'blur')
          push(
            'video-reframe-fit',
            at,
            '<Reframe fit> is not fill, fit or blur',
            'write fit="fill", "fit" or "blur"'
          );
      }
    } else if (kind === 'Place') {
      const pair = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(frac);
      const a = attr(el, 'at');
      const f = attr(el, 'formats');
      const fv = f ? attrValue(f) : undefined;
      const badAt = a ? !pair(attrValue(a)) : false;
      const badFormats =
        f !== null &&
        (!fv ||
          typeof fv !== 'object' ||
          Array.isArray(fv) ||
          Object.entries(fv as Record<string, unknown>).some(
            ([k, p]) => !ASPECT_RE.test(k) || !pair(p)
          ));
      if (badAt || badFormats)
        push(
          'video-place-at',
          at,
          '<Place> positions are not [x, y] between 0 and 1',
          'write at={[0.5, 0.8]} and formats={{ "16:9": [0.5, 0.85] }}'
        );
    }
  }
  return out;
}
