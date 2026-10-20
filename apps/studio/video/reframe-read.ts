// video/reframe-read.ts — S7.13: what a clip's `<Reframe>` says, read back as plain data for the Re-frame island.
//
// The clip enumerator (canvas-edit.ts) hands the Timeline each clip's source span; this reads the literal props the studio
// writes (`edit-ops/clip/reframe.ts`: JSON, never an expression) and nothing else. A prop that is not a clean literal reads as
// absent — the island then starts from the centre, and `maude design check` is what refuses the file (S7.5), not this.
// Pure: no IO, no imports.

export type FocusKey = [number, number, number];
export interface ReframeRead {
  /** `[sourceSec, x, y]`, x and y fractions of the SOURCE frame — the shared ("All formats") keyframes */
  focus: FocusKey[];
  zoom: number;
  fit: 'fill' | 'fit' | 'blur' | null;
  /** per-format keyframes, keyed by the reduced aspect ("16:9") — "This format" */
  formats: Record<string, FocusKey[]>;
}

/** The text of `<Reframe …>`'s opening tag, or null. */
function openingTag(span: string): string | null {
  const at = span.search(/<Reframe\b/);
  if (at < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = at + 8; i < span.length; i++) {
    const c = span[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return span.slice(at, i + 1);
  }
  return null;
}

/** `name={<json>}` → the parsed value, or undefined. Brace-matched, string-aware. */
function jsonProp(tag: string, name: string): unknown {
  const m = new RegExp(`\\s${name}=\\{`).exec(tag);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < tag.length; i++) {
    const c = tag[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(tag.slice(start, i));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const isKey = (k: unknown): k is FocusKey =>
  Array.isArray(k) &&
  k.length === 3 &&
  k.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
  (k[0] as number) >= 0 &&
  (k[1] as number) >= 0 &&
  (k[1] as number) <= 1 &&
  (k[2] as number) >= 0 &&
  (k[2] as number) <= 1;

const keysOf = (v: unknown): FocusKey[] =>
  Array.isArray(v) && v.length <= 2000 ? (v.filter(isKey) as FocusKey[]) : [];

/** The clip's `<Reframe>`, or null when it has none (centre framing, B3). */
export function reframeOf(span: string): ReframeRead | null {
  const tag = openingTag(span);
  if (!tag) return null;
  const out: ReframeRead = { focus: [], zoom: 1, fit: null, formats: {} };
  out.focus = keysOf(jsonProp(tag, 'focus'));
  const zoom = jsonProp(tag, 'zoom');
  if (typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 1) out.zoom = zoom;
  const fit = /\bfit="(fill|fit|blur)"/.exec(tag)?.[1];
  if (fit) out.fit = fit as ReframeRead['fit'];
  const formats = jsonProp(tag, 'formats');
  if (formats && typeof formats === 'object' && !Array.isArray(formats))
    for (const [k, v] of Object.entries(formats as Record<string, unknown>))
      if (/^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(k)) out.formats[k] = keysOf(v);
  return out;
}
