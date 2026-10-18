// bridge/link-target.ts — the `data-cd-link` grammar (S3.10a; contract client/v2/contracts/S3-links-format.md §2).
//
// A link is one attribute on an element that carries a literal `data-cd-id`:
//   same canvas    "#pricing-desktop"
//   other canvas   "site/pricing.tsx#desktop" · "site/pricing.tsx"   (designRoot-relative; split on the LAST "#")
//   external       "https://cal.com/studio"                          (http/https only, stored in `href` form)
// Anything else is invalid — `javascript:`, `data:`, `file:`, `mailto:`, a path out of the design root, a runtime
// dir (`_draw/…`), a bare word. An invalid value is reported by `maude design check` and never followed.
//
// LEAF MODULE: no React, no DOM, no node:* — it is shared by the canvas runtime (chip), the shell (playback),
// the server (`GET /_api/links`, the writers) and the check. `URL` is the only global it uses.

export const LINK_ATTR = 'data-cd-link';
export const LINK_MAX = 2048;

export type LinkTarget =
  | { kind: 'artboard'; artboard: string }
  | { kind: 'canvas'; canvas: string; artboard: string | null }
  | { kind: 'external'; url: string; host: string };

/** The meta schema's `artboardId`. */
export const LINK_ARTBOARD_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Control characters (C0, DEL, C1) and every Unicode whitespace (incl. U+2028/2029, U+FEFF).
function hasControlOrSpace(v: string): boolean {
  for (let k = 0; k < v.length; k++) {
    const c = v.charCodeAt(k);
    if (c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0x2028 || c === 0x2029 || c === 0xfeff)
      return true;
  }
  return /\s/.test(v);
}
// An HTML character reference: JSX decodes it, so the DOM value would differ from the file text.
const CHAR_REF = /&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/;

function artboardOk(a: string): boolean {
  return LINK_ARTBOARD_RE.test(a);
}

function canvasPathOk(p: string): boolean {
  if (!p.endsWith('.tsx') || p.length <= 4) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes(':') || p.includes('"')) return false;
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (seg.startsWith('_')) return false; // runtime dirs (DDR-115) are never a canvas
  }
  return true;
}

/** IPv4 dotted literal → its four octets, or null. */
function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/** loopback, link-local, unspecified, or a localhost name — never a link target. */
function localHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = ipv4(h);
  if (v4) {
    const [a, b] = v4 as [number, number];
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return true;
    if (/^fe[89ab][0-9a-f]?:/.test(v6)) return true; // fe80::/10
    // IPv4-mapped (WHATWG prints it in hex: ::ffff:7f00:1)
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (mapped) {
      const hi = Number.parseInt(mapped[1] as string, 16);
      const a = hi >> 8;
      const b = hi & 0xff;
      return a === 127 || a === 0 || (a === 169 && b === 254);
    }
    return false;
  }
  return false;
}

function parseExternal(raw: string): LinkTarget | null {
  if (!raw.startsWith('https://') && !raw.startsWith('http://')) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  if (localHost(u.hostname)) return null;
  const url = u.href;
  if (url.length > LINK_MAX || url.includes('"') || CHAR_REF.test(url) || hasControlOrSpace(url))
    return null;
  return { kind: 'external', url, host: u.host };
}

/** The target a `data-cd-link` value names, or null when it is not a valid link. Pure. */
export function parseLinkTarget(raw: unknown): LinkTarget | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > LINK_MAX) return null;
  if (hasControlOrSpace(raw) || CHAR_REF.test(raw)) return null;
  if (raw.startsWith('#')) {
    const artboard = raw.slice(1);
    return artboardOk(artboard) ? { kind: 'artboard', artboard } : null;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return parseExternal(raw); // any scheme: only http(s) survive
  const cut = raw.lastIndexOf('#');
  const path = (cut < 0 ? raw : raw.slice(0, cut)).normalize('NFC');
  const artboard = cut < 0 ? null : raw.slice(cut + 1);
  if (!canvasPathOk(path)) return null;
  if (artboard !== null && !artboardOk(artboard)) return null;
  return { kind: 'canvas', canvas: path, artboard };
}

/** The attribute value for `t`. `parseLinkTarget(formatLinkTarget(t))` deep-equals `t`. */
export function formatLinkTarget(t: LinkTarget): string {
  if (t.kind === 'artboard') return `#${t.artboard}`;
  if (t.kind === 'canvas') return t.artboard === null ? t.canvas : `${t.canvas}#${t.artboard}`;
  return t.url;
}

/** "site/pricing-plans.tsx" → "Pricing Plans" (the fallback name of another canvas). */
export function canvasWords(canvas: string): string {
  const base = (canvas.split('/').pop() ?? canvas).replace(/\.tsx$/, '');
  return base
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** host + path, no scheme, no trailing "/": "https://cal.com/studio/" → "cal.com/studio". */
export function externalDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  }
}

/**
 * "Go to Pricing" · "Go to Desktop" · "Opens cal.com/studio". The names come from the caller (the artboard's
 * label, the canvas's name); the fallback is the canvas file's basename in words, and the artboard id.
 */
export function linkLabel(
  t: LinkTarget,
  names: { canvas?: string; artboard?: string } = {}
): string {
  if (t.kind === 'artboard') return `Go to ${names.artboard || t.artboard}`;
  if (t.kind === 'canvas') return `Go to ${names.canvas || canvasWords(t.canvas)}`;
  return `Opens ${externalDisplay(t.url)}`;
}
