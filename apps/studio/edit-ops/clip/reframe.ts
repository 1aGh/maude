// edit-ops/clip/reframe.ts — `video.reframe` and `video.fit` (S7.6c; V2-1.10 §5.3 + §5.8 B3, 07
// ve-reframe / ve-fit-fill).
//
// `<Reframe focus={[[sourceSec, x, y], …]} zoom={1} fit="fill" formats={{ "16:9": [[…]] }}>` wraps the
// media element of ONE clip. The op merges a patch into the clip's current props: a key that is
// absent keeps its value, `null` clears it. With `format: "W:H"` the `focus` patch is that format's
// own keyframes (`formats["W:H"]`, "This format"); without it, the shared `focus` ("All formats").
// Defaults are not written (zoom 1, fit "fill", no keyframes), and a Reframe left with nothing to say
// is unwrapped — Reset = centre framing, no `<Reframe>` (B3). Wrapping replaces a legacy
// `data-mframe` crop wrapper (§5.3: "replaces the data-mframe wrapper when keyframes are set"); a clip
// with neither keeps its bytes until a value is set. Pure: no IO.

import MagicString from 'magic-string';

import {
  ASPECT_RE,
  attrNode,
  bad,
  ensureCanvasLibImport,
  finish,
  firstIn,
  innerText,
  isFrac,
  jsonProp,
  jsxElements,
  literalProp,
  type Node,
  parseProgram,
  resolveClip,
  setProp,
} from './jsx.ts';

export type Keyframe = [number, number, number];
export type Fit = 'fill' | 'fit' | 'blur';
export const FITS: readonly Fit[] = ['fill', 'fit', 'blur'];
export const MAX_KEYFRAMES = 2000;
export const MAX_ZOOM = 8;

export interface ReframePatch {
  focus?: Keyframe[] | null;
  zoom?: number | null;
  fit?: Fit | null;
  /** with `format`, `focus` is `formats[format]` */
  format?: string;
  formats?: Record<string, Keyframe[]> | null;
}

interface ReframeProps {
  focus: Keyframe[];
  zoom: number;
  fit: Fit;
  formats: Record<string, Keyframe[]>;
}

const MEDIA = new Set(['Video', 'OffthreadVideo', 'Img', 'MaudeVideo', 'MaudeImg']);
const REFRAME = new Set(['Reframe']);

/** Keyframes: `[sourceSec ≥ 0, x, y]` with x, y fractions of the source frame; sorted by time, one
 *  per time (the later one wins). */
export function keyframes(file: string, v: unknown, id: string): Keyframe[] {
  if (!Array.isArray(v) || v.length > MAX_KEYFRAMES) bad(file, 'The framing is not readable.', id);
  const byTime = new Map<number, Keyframe>();
  for (const k of v as unknown[]) {
    if (!Array.isArray(k) || k.length !== 3) bad(file, 'The framing is not readable.', id);
    const [t, x, y] = k as unknown[];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || !isFrac(x) || !isFrac(y))
      bad(file, 'A framing point is outside the picture.', id);
    byTime.set(t as number, [t as number, x as number, y as number]);
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

function formatsOf(file: string, v: unknown, id: string): Record<string, Keyframe[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    bad(file, 'The formats are not readable.', id);
  const out: Record<string, Keyframe[]> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 32) bad(file, 'Too many formats.', id);
  for (const [k, f] of entries) {
    if (!ASPECT_RE.test(k)) bad(file, `“${k}” is not a format (W:H).`, id);
    out[k] = keyframes(file, f, id);
  }
  return out;
}

function zoomOf(file: string, v: unknown, id: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > MAX_ZOOM)
    bad(file, `Zoom is between 1 and ${MAX_ZOOM}.`, id);
  return v as number;
}

function fitOf(file: string, v: unknown, id: string): Fit {
  if (!FITS.includes(v as Fit)) bad(file, 'Fit is fill, fit or blur.', id);
  return v as Fit;
}

/** A clean patch out of request params (unknown keys ignored). */
export function reframePatch(file: string, p: Record<string, unknown>, id: string): ReframePatch {
  const out: ReframePatch = {};
  if (p.format !== undefined) {
    if (typeof p.format !== 'string' || !ASPECT_RE.test(p.format))
      bad(file, 'The format is not readable (W:H).', id);
    out.format = p.format as string;
  }
  if (p.focus !== undefined) out.focus = p.focus === null ? null : keyframes(file, p.focus, id);
  if (p.zoom !== undefined) out.zoom = p.zoom === null ? null : zoomOf(file, p.zoom, id);
  if (p.fit !== undefined) out.fit = p.fit === null ? null : fitOf(file, p.fit, id);
  if (p.formats !== undefined)
    out.formats = p.formats === null ? null : formatsOf(file, p.formats, id);
  return out;
}

function readProps(file: string, el: Node | null, id: string): ReframeProps {
  const props: ReframeProps = { focus: [], zoom: 1, fit: 'fill', formats: {} };
  if (!el) return props;
  const focus = literalProp(file, el, 'focus', id);
  if (focus !== undefined) props.focus = keyframes(file, focus, id);
  const zoom = literalProp(file, el, 'zoom', id);
  if (zoom !== undefined) props.zoom = zoomOf(file, zoom, id);
  const fit = literalProp(file, el, 'fit', id);
  if (fit !== undefined) props.fit = fitOf(file, fit, id);
  const formats = literalProp(file, el, 'formats', id);
  if (formats !== undefined) props.formats = formatsOf(file, formats, id);
  return props;
}

/** The props as JSX value text, defaults dropped (null = not written). */
function propTexts(p: ReframeProps): Record<string, string | null> {
  const formats = Object.fromEntries(Object.entries(p.formats).filter(([, f]) => f.length));
  return {
    focus: p.focus.length ? jsonProp(p.focus) : null,
    zoom: p.zoom !== 1 ? `{${p.zoom}}` : null,
    fit: p.fit !== 'fill' ? `"${p.fit}"` : null,
    formats: Object.keys(formats).length ? jsonProp(formats) : null,
  };
}

export function applyReframe(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  patch: ReframePatch
): { source: string; reframed: boolean } {
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  const program = parseProgram(file, source);
  const els = jsxElements(program);
  const rf = firstIn(els, clip.start, clip.end, REFRAME)?.el ?? null;
  const props = readProps(file, rf, stableId);

  if (patch.formats !== undefined) props.formats = patch.formats ?? {};
  if (patch.focus !== undefined) {
    if (patch.format) {
      if (patch.focus === null) delete props.formats[patch.format];
      else props.formats[patch.format] = patch.focus;
    } else props.focus = patch.focus ?? [];
  }
  if (patch.zoom !== undefined) props.zoom = patch.zoom ?? 1;
  if (patch.fit !== undefined) props.fit = patch.fit ?? 'fill';

  const texts = propTexts(props);
  const empty = Object.values(texts).every((t) => t === null);
  const s = new MagicString(source);
  if (rf) {
    if (empty) s.overwrite(rf.start, rf.end, innerText(source, rf));
    else for (const [k, t] of Object.entries(texts)) setProp(s, rf, k, t);
  } else {
    if (empty) return { source, reframed: false };
    const media = firstIn(els, clip.start, clip.end, MEDIA)?.el;
    if (!media) bad(file, 'This clip has no picture to frame.', stableId);
    // A legacy crop wrapper (`<div data-mframe …><div …>MEDIA</div></div>`) is replaced.
    const wrapper = els.find(
      (e) =>
        e.el.start >= clip.start &&
        e.el.end <= clip.end &&
        e.el.start < media.start &&
        e.el.end >= media.end &&
        attrNode(e.el, 'data-mframe')
    )?.el;
    const target = wrapper ?? media;
    const attrs = Object.entries(texts)
      .filter(([, t]) => t !== null)
      .map(([k, t]) => ` ${k}=${t}`)
      .join('');
    s.overwrite(
      target.start,
      target.end,
      `<Reframe${attrs}>${source.slice(media.start, media.end)}</Reframe>`
    );
    ensureCanvasLibImport(s, program, 'Reframe');
  }
  return { source: finish(file, s, stableId), reframed: !empty };
}
