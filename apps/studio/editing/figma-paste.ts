// editing/figma-paste.ts — what a Figma copy looks like on the clipboard (S2.15; artboard ed-edge-paste).
//
// Figma's ⌘C writes `text/html` with two spans: `data-metadata="<!--(figmeta)BASE64(/figmeta)-->"` — a small JSON
// `{fileKey, pasteID, dataType}` — and `data-buffer="<!--(figma)BASE64(/figma)-->"`, its binary scene. The scene is not
// something Maude reads (a frame arrives as Figma's exact PICTURE, never as layers: rule figma-arrives-as-an-exact-picture);
// this module only recognises that a paste CAME from Figma, so the paste can say so and offer the picture instead of
// dropping the markup in as text. Pure: a string in, facts out. It never throws and reads only the head of the string.

export interface FigmaPaste {
  fileKey: string | null;
  pasteID: number | null;
  /** 'scene' for a frame copy, 'design' for older builds, FigJam 'whiteboard' … */
  dataType: string | null;
  /** the frame's name, when the clipboard says it (the metadata does not today; kept for when it does) */
  name: string | null;
}

const HEAD = 24_000;
const META = /<!--\(figmeta\)([A-Za-z0-9+/=_-]{4,4096})\(\/figmeta\)-->/;
const MAX_NAME = 120;

function decode(b64: string): string | null {
  try {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;

/** The Figma copy this `text/html` carries, or null for anything else (plain HTML, a forged marker, a long payload). */
export function parseFigmaPaste(html: string | null | undefined): FigmaPaste | null {
  if (!html || html.length < 20) return null;
  const head = html.slice(0, HEAD);
  const m = META.exec(head);
  if (!m) return null;
  // the scene span is the second half of the pair; a bare metadata comment is somebody's HTML, not a Figma copy
  if (!head.includes('(figma)') && !html.includes('<!--(figma)')) return null;
  const text = decode(m[1] as string);
  if (text === null) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(text);
  } catch {
    return null;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const o = meta as Record<string, unknown>;
  const name = str(o.name) ?? str(o.nodeName);
  return {
    fileKey: str(o.fileKey),
    pasteID: typeof o.pasteID === 'number' && Number.isFinite(o.pasteID) ? o.pasteID : null,
    dataType: str(o.dataType),
    name: name ? name.slice(0, MAX_NAME) : null,
  };
}

/** The words under the pasted picture (CONTRACT §4: what happened, nothing claimed about text or layers). */
export const pastedLine = (name: string | null): string =>
  name ? `Pasted from Figma as an image of “${name}”.` : 'Pasted from Figma as an image.';

/** Figma sent layers and no picture: nothing was pasted; one verb. */
export const NO_PICTURE_LINE = 'Nothing pasted — Figma sent layers, not a picture.';
export const AS_PICTURE_VERB = 'Paste as picture';
/** What to do when the clipboard has no picture to give. */
export const COPY_AS_PNG_LINE = 'In Figma, Copy as PNG (⇧⌘C), then paste again.';
