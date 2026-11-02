// apps/studio/bridge/paste-data.ts — Menu › Edit › Paste into the canvas (p8-sweep-leftovers item 8).
//
// The canvas iframe is untrusted (DDR-054) and is framed with `allow="clipboard-write"` only, so a clipboard READ
// from inside it is blocked by the permissions policy — the menu's Paste logged "Clipboard API has been blocked"
// and did nothing. `clipboard-read` is NOT granted to the canvas origin. Instead the trusted shell reads the
// clipboard on the person's own menu pick (client/v2/shell/paste-forward.js) and forwards what it read as one typed
// `paste-data` message (bridge/dgn-protocol.ts); the frame replays it as a `paste` event, so the SAME listeners a
// ⌘V reaches handle it (board strokes, Figma paste, media intake, the object clipboard marker).
//
// What crosses is bounded and typed: text/plain and text/html strings, and one image Blob of an allowlisted type.
// Anything else — another key, a wrong type, an oversize string or picture, an empty message — is refused whole.
// Leaf module: no React; the DOM only in `dispatchPasteData`.

/** One string's cap (text/plain or text/html), in UTF-16 units — far above any real paste, well below a hang. */
export const PASTE_TEXT_MAX = 1_000_000;
/** The picture's cap in bytes (a 4K screenshot is ~10 MB as PNG). */
export const PASTE_IMAGE_MAX = 20 * 1024 * 1024;
export const PASTE_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export interface PasteData {
  v: 1;
  text?: string;
  html?: string;
  image?: Blob;
}

const KEYS = new Set(['dgn', 'v', 'text', 'html', 'image']);
const okText = (s: unknown) => typeof s === 'string' && s.length <= PASTE_TEXT_MAX;
export const okImage = (b: unknown): b is Blob =>
  typeof Blob !== 'undefined' &&
  b instanceof Blob &&
  PASTE_IMAGE_TYPES.includes(b.type) &&
  b.size > 0 &&
  b.size <= PASTE_IMAGE_MAX;

/** The forwarded payload, cleaned — or null when anything in it is off (refused whole, never trimmed). */
export function parsePasteData(raw: unknown): PasteData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!KEYS.has(k)) return null;
  if (r.v !== 1) return null;
  const out: PasteData = { v: 1 };
  if (r.text !== undefined) {
    if (!okText(r.text)) return null;
    out.text = r.text as string;
  }
  if (r.html !== undefined) {
    if (!okText(r.html)) return null;
    out.html = r.html as string;
  }
  if (r.image !== undefined) {
    if (!okImage(r.image)) return null;
    out.image = r.image;
  }
  return out.text || out.html || out.image ? out : null;
}

const extOf = (type: string) => (type === 'image/jpeg' ? 'jpg' : type.split('/')[1]);

const isEditable = (el: Element | null) =>
  !!el &&
  ((el as HTMLElement).isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT');

/**
 * Canvas side: replay the forwarded clipboard as a `paste` on the focused element (else the body), the path ⌘V
 * takes. A text field gets the text inserted (a script-made paste event inserts nothing by itself).
 * @returns 'inserted' | 'dispatched' | 'none'
 */
export function dispatchPasteData(
  data: PasteData,
  doc: Document = document
): 'inserted' | 'dispatched' | 'none' {
  const active = doc.activeElement;
  if (isEditable(active)) {
    if (!data.text) return 'none';
    doc.execCommand?.('insertText', false, data.text);
    return 'inserted';
  }
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (!view?.DataTransfer || !view.ClipboardEvent) return 'none';
  const dt = new view.DataTransfer();
  if (data.text) dt.setData('text/plain', data.text);
  if (data.html) dt.setData('text/html', data.html);
  if (data.image) {
    const type = data.image.type;
    dt.items.add(new view.File([data.image], `Pasted image.${extOf(type)}`, { type }));
  }
  const target = active && active !== doc.documentElement ? active : doc.body;
  target?.dispatchEvent(
    new view.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  );
  return 'dispatched';
}
