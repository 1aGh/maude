// importedFrom — a comment someone else wrote, in a tool this project does not share (S8.17b).
//
// A Figma review comment arrives as a comment pin (CONTRACT §-import, Michal 2026-10-21). Its writer
// is NOT a person of this project: not a member, not a mention target, never notified, no avatar. The
// thread carries who wrote it as a LABEL, on the root and on each reply that came from Figma:
//
//   importedFrom: { source: 'figma', author: { name, handle? }, at? }
//
// `by` — the record's `author` — stays the person who ran the import (ACL, audit, who may delete).
// `at` is when the author wrote it in Figma; the record's `created` is the same moment.
//
// The field is ADDITIVE (V2-1.12 R1/R3): a comment record has no version field, and every reader since
// Phase 6 keeps unknown top-level keys, replies included (`api.ts backfillComment` spreads the raw
// record and keeps `thread` as is). A Maude 1 peer therefore carries it through a read and a rewrite
// untouched and shows the importer as the author, which is the honest fallback. A Maude 2 reader
// re-clamps it here: the name is UNTRUSTED third-party text (DDR-216 D6) and the record can also arrive
// from a peer, so a shape that fails is dropped, never guessed at.
//
// Erasable TypeScript only: the hub reads comment records under Node's strip-only TypeScript.

/** The sources a thread can be imported from. One today. */
export type ImportSource = 'figma';

export interface ImportedFrom {
  source: ImportSource;
  author: { name: string; handle?: string };
  /** ISO time the author wrote it, in the source tool. */
  at?: string;
}

/** The longest name a thread shows (code points). Figma's own limit is shorter. */
export const MAX_IMPORTED_NAME = 80;
const MAX_HANDLE = 40;
const HANDLE_RE = /^[A-Za-z0-9._-]{1,40}$/;
/** What a thread says when the source gave no usable name. */
export const IMPORTED_UNKNOWN_NAME = 'Someone';

const SOURCE_WORDS: Record<ImportSource, string> = { figma: 'Figma' };

/**
 * Control (C0/C1), format (bidi marks and embeddings, zero-width, soft hyphen, BOM, tags), line and
 * paragraph separators, private use, surrogates and unassigned code points. Whitespace is handled
 * first, so a newline or a tab in a name becomes a single space, never a joined word.
 */
const HIDDEN_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;

/** A display name from untrusted text: no hidden or direction-changing characters, one line, bounded. */
export function cleanImportedName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const flat = raw.normalize('NFC').replace(/\s+/gu, ' ').replace(HIDDEN_RE, '');
  const trimmed = flat.replace(/\s+/gu, ' ').trim();
  return Array.from(trimmed).slice(0, MAX_IMPORTED_NAME).join('').trim();
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** An ISO-looking time, normalised; anything else is absent. */
function cleanAt(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * The valid `importedFrom` of a raw value, or `undefined`. Never throws, never adds a person: an
 * empty or hostile name reads as "Someone", not as a blank.
 */
export function sanitizeImportedFrom(raw: unknown): ImportedFrom | undefined {
  if (!isObject(raw) || raw.source !== 'figma') return undefined;
  const author = isObject(raw.author) ? raw.author : {};
  const out: ImportedFrom = {
    source: 'figma',
    author: { name: cleanImportedName(author.name) || IMPORTED_UNKNOWN_NAME },
  };
  if (
    typeof author.handle === 'string' &&
    author.handle.length <= MAX_HANDLE &&
    HANDLE_RE.test(author.handle)
  )
    out.author.handle = author.handle;
  const at = cleanAt(raw.at);
  if (at) out.at = at;
  return out;
}

/** "Jonas · from Figma" — the words under a thread's first message and each imported reply. */
export function importedLabel(imp: ImportedFrom | undefined | null): string {
  return imp ? `${imp.author.name} · from ${SOURCE_WORDS[imp.source]}` : '';
}

/**
 * The tolerant read of one stored record: `importedFrom` on the root and on each reply is replaced by
 * its sanitized value or removed. Never adds a key a record did not have.
 */
export function withSanitizedImportedFrom<T extends object>(record: T): T {
  const src = record as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if ('importedFrom' in out) {
    const imp = sanitizeImportedFrom(out.importedFrom);
    if (imp) out.importedFrom = imp;
    else delete out.importedFrom;
  }
  if (Array.isArray(out.thread)) {
    out.thread = out.thread.map((r) => {
      if (!isObject(r) || !('importedFrom' in r)) return r;
      const { importedFrom, ...rest } = r;
      const imp = sanitizeImportedFrom(importedFrom);
      return imp ? { ...rest, importedFrom: imp } : rest;
    });
  }
  return out as T;
}
