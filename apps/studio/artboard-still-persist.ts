/**
 * @file       artboard-still-persist.ts — #212 §5 (T2.2): the overview stills, kept across sessions through the shell
 * @scope      apps/studio/artboard-still-persist.ts (canvas document; started by artboard-live-gate.tsx)
 * @purpose    The canvas never stores anything itself (its origin's storage is readable by every canvas on it — C4's
 *             named gap) and never names a key: it asks its shell once (`stills-want { file }`) and offers each still
 *             it drew (`still-put { file, artboard, sig, bytes }`). The SHELL picks the key and checks the bytes
 *             (client/v2/shell/still-bridge.js). An answer (`stills`) becomes SEEDS in the cache, shown only once
 *             the artboard's own body has the content signature the still was drawn from (`StillCache.adopt`).
 *
 *             `sig` on the wire = the body's content signature + `~` + this document's style signature (the linked
 *             stylesheets: a DS tokens / components change the source hashes cannot see). A seed of another style
 *             is never seeded. Puts wait for the shell's answer and then go to the origin that answered — never `*`.
 *             Contract: client/v2/contracts/212-still-cache.md §5.
 */

import type { StillController } from './artboard-still.ts';
import { acceptFromShell } from './bridge/dgn-protocol.ts';
import { checkStillWebp } from './bridge/still-webp.ts';
import { currentCanvasFile } from './shell-canvas-file.ts';

export const STILL_STYLE_SEP = '~';
/** Stills offered before the shell answered, kept to send then (the newest per artboard). */
const PENDING_MAX = 2000;
/** A frame opened with any of these is not today's plain canvas: it neither asks nor offers. */
const NOT_PLAIN = ['sha', 'embed', 'follow', 'hide-chrome', 'thumbnail'];

export function persistAllowed(search: string): boolean {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return false;
  }
  return !NOT_PLAIN.some((k) => q.has(k));
}

const fnv = (s: string, h0 = 0x811c9dc5) => {
  let h = h0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

let styleMemo: { doc: Document; print: string; sig: string } | null = null;

/**
 * A signature of the document's LINKED stylesheets (the DS tokens / components / layout CSS and the canvas's own
 * lane): their hrefs and rules. Memoized on a cheap print (hrefs + rule counts); a sheet whose rules cannot be read
 * counts by its href only.
 */
export function documentStyleSignature(doc: Document): string {
  const parts: string[] = [];
  const sheets: Array<{ href: string; rules: CSSRuleList | null }> = [];
  for (const sh of Array.from(doc.styleSheets ?? [])) {
    const owner = sh.ownerNode as Element | null;
    if (owner?.nodeName !== 'LINK') continue;
    let rules: CSSRuleList | null = null;
    try {
      rules = sh.cssRules;
    } catch {
      rules = null;
    }
    sheets.push({ href: sh.href ?? '', rules });
    parts.push(`${sh.href ?? ''}#${rules ? rules.length : -1}`);
  }
  const print = parts.join('\n');
  if (styleMemo && styleMemo.doc === doc && styleMemo.print === print) return styleMemo.sig;
  let h = 0x811c9dc5;
  for (const s of sheets) {
    h = fnv(s.href, h);
    if (s.rules) for (const r of Array.from(s.rules)) h = fnv(r.cssText, h);
  }
  const sig = `${h.toString(36)}.${sheets.length}`;
  styleMemo = { doc, print, sig };
  return sig;
}

export interface StillPersistOptions {
  win?: Window;
  file?: string | null;
  styleSig?: () => string;
  /** a blob of bytes (tests pass a fake) */
  toBlob?: (bytes: ArrayBuffer) => Blob;
  /** a blob's bytes */
  bytesOf?: (blob: Blob) => Promise<ArrayBuffer>;
}

/** Ask the shell for this canvas's persisted stills and offer the ones this document draws. Returns a stop. */
export function startStillPersist(st: StillController, o: StillPersistOptions = {}): () => void {
  const win = o.win ?? window;
  let embedded = false;
  try {
    embedded = win.parent !== win;
  } catch {
    embedded = true;
  }
  const file = o.file === undefined ? currentCanvasFile() : o.file;
  if (!embedded || !file || !persistAllowed(win.location?.search ?? '')) return () => {};
  const styleSig = o.styleSig ?? (() => documentStyleSignature(win.document));
  const toBlob = o.toBlob ?? ((b: ArrayBuffer) => new Blob([b], { type: 'image/webp' }));
  const bytesOf = o.bytesOf ?? ((b: Blob) => b.arrayBuffer());
  let shellOrigin: string | null = null;
  const pending = new Map<string, { blob: Blob; sig: string }>();

  const offer = (id: string, blob: Blob, sig: string) => {
    if (!shellOrigin) {
      pending.delete(id);
      if (pending.size < PENDING_MAX) pending.set(id, { blob, sig });
      return;
    }
    const to = shellOrigin;
    void bytesOf(blob)
      .then((bytes) => {
        if (!checkStillWebp(bytes).ok) return;
        try {
          win.parent.postMessage(
            {
              dgn: 'still-put',
              file,
              artboard: id,
              sig: `${sig}${STILL_STYLE_SEP}${styleSig()}`,
              bytes,
            },
            to
          );
        } catch {
          /* detached */
        }
      })
      .catch(() => {});
  };

  const onMessage = (e: MessageEvent) => {
    // only the shell that opened this frame may answer (acceptFromShell checks it again, by the table's gate)
    const parent = win.parent;
    if (e.source !== parent || !e.data) return;
    const m = acceptFromShell(e, win);
    if (m?.dgn !== 'stills' || m.file !== file || shellOrigin) return;
    shellOrigin = e.origin;
    const style = styleSig();
    for (const it of m.items) {
      const cut = it.sig.lastIndexOf(STILL_STYLE_SEP);
      if (cut <= 0 || it.sig.slice(cut + 1) !== style) continue;
      if (!checkStillWebp(it.bytes).ok) continue;
      st.cache.seed(it.artboard, toBlob(it.bytes), it.sig.slice(0, cut));
    }
    st.adoptSeeds();
    for (const [id, p] of pending) offer(id, p.blob, p.sig);
    pending.clear();
  };
  win.addEventListener('message', onMessage);
  const off = st.cache.onEncoded(offer);
  try {
    win.parent.postMessage({ dgn: 'stills-want', file }, '*');
  } catch {
    /* detached */
  }
  return () => {
    win.removeEventListener('message', onMessage);
    off();
  };
}
