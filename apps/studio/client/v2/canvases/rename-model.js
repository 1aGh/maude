// client/v2/canvases/rename-model.js — S1.2: the rules of renaming a canvas in place (11 · pn-move).
//
// Pure. ↵ renames, esc keeps the name; a name another canvas in the same folder already has is refused
// INLINE — the field stays open with the reason under it, nothing is sent. S1.23b: so is a name TOO CLOSE
// to a sibling's — one that would share its sync document (an em dash vs a hyphen, `a%20b` vs `a b`,
// case); the server (`sync-name-key.ts`) is the authority and also checks across folders. Everything
// else the server's allowlist decides (`canvas-create.ts` validateCanvasName) and its words come back in
// the same slot. S1.23c (lead decision `v2-lead-canvas-names-sync-safe`): a name stays inside the sync
// path charset, and a refused one carries a suggestion folded to it, which the inline field takes in.

export const RENAME_MAX = 60;

export const RENAME_WORDS = {
  taken: 'That name is already used in this folder.',
  // Same words as the server's `NAME_RULE` / `nameRefusal` (canvas-create.ts) — a test pins them equal.
  rule: 'Names can use letters, numbers, spaces, - and _.',
  refusal: (suggestion) =>
    suggestion
      ? `Names can use letters, numbers, spaces, - and _. Try “${suggestion}”.`
      : 'Names can use letters, numbers, spaces, - and _. Try another name.',
  long: `Names are ${RENAME_MAX} characters or fewer.`,
  // sec-a L3 — same words as the server's `underscoreRefusal` (canvas-create.ts)
  underscore: (suggestion) =>
    suggestion
      ? `Names can’t start with _. Try “${suggestion}”.`
      : 'Names can’t start with _. Try another name.',
  failed: 'Could not rename. Try again.',
  // Same words as the server's `tooCloseText` (sync-name-key.ts) — a test pins them equal.
  close: (name, other) =>
    `“${name}” is too close to “${other}”, which is already here. Try another name.`,
};

// The allowed names: the sync path charset — letters A–Z/a–z, digits, space, `_` and `-`, first character
// not a space. The SAME regex as `sync/canvas-path.ts` `COMPONENT` (the server imports that one); this
// file ships in the browser bundle, so it is mirrored here and `test/canvas-names-sync-safe.test.ts`
// pins the two `.source`s equal.
export const ALLOWED_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9 _-]*(?![\s\S])/;

const norm = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/ +/g, ' ');
const fold = (s) => norm(s).toLowerCase();

/**
 * The typed name folded to the allowed set: — – and kin become `-`, letters lose their accents (NFD,
 * marks stripped: č→c), every other character is dropped, spaces collapse, ends trimmed, at most
 * RENAME_MAX characters. Mirrors `canvas-create.ts` `foldToAllowedName`; empty when nothing is left.
 */
export function suggestName(raw) {
  const folded = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .replace(/ +/g, ' ')
    .trim();
  return [...folded].slice(0, RENAME_MAX).join('').trim();
}

/**
 * The sync key of one name inside a folder: the real slug (`canvas-slug.ts`: percent-decode,
 * whitespace → `_`, lowercase) then the wire sanitiser (`sync/doc-name.ts` `sanitizeComponent`:
 * anything outside `[a-z0-9._-]` → `-`, runs collapse, ends trimmed). Mirrored, not imported — this
 * file ships in the browser bundle; `test/canvas-sync-name-collision.test.ts` pins it to the server.
 * Two siblings share a folder prefix, so equal local keys mean equal document ids.
 */
export function closeKey(name) {
  let p = norm(name);
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is */
  }
  return p
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/[-.]+$/g, '');
}

/** The names of the canvases that sit in `dir` besides `selfPath`, folded for comparing. The set also
 *  carries `closeKeys` (sync key → that sibling's name) for the too-close check. */
export function siblingNames(tree, dir, selfPath) {
  const folder = tree?.byPath?.get?.(dir);
  const out = new Set();
  out.closeKeys = new Map();
  for (const c of folder?.canvases || []) {
    if (c.path === selfPath) continue;
    out.add(fold(c.name));
    const key = closeKey(c.name);
    if (!out.closeKeys.has(key)) out.closeKeys.set(key, c.name);
  }
  return out;
}

/**
 * What ↵ would do with `draft`.
 *  { kind: 'keep' }              empty or unchanged — close the field, send nothing
 *  { kind: 'error', error, suggestion? }  refuse inline, keep the field open; `suggestion` is the
 *                                whole-name fix the field takes in so one ↵ accepts it — offered only
 *                                when it is non-empty and does not collide with a sibling
 *  { kind: 'rename', name }      send `name`
 * `siblings` is a Set of folded names (see `siblingNames`).
 */
export function checkRename({ draft, current, siblings = new Set() }) {
  const name = norm(draft);
  if (!name || name === norm(current)) return { kind: 'keep' };
  if (!ALLOWED_NAME_RE.test(name)) {
    const folded = suggestName(name);
    const collides =
      siblings.has(fold(folded)) || siblings.closeKeys?.get?.(closeKey(folded)) !== undefined;
    return folded && !collides
      ? { kind: 'error', error: RENAME_WORDS.refusal(folded), suggestion: folded }
      : { kind: 'error', error: RENAME_WORDS.refusal('') };
  }
  if (name.startsWith('_')) {
    const fix = name.replace(/^[_\s]+/, '');
    return fix && !siblings.has(fold(fix))
      ? { kind: 'error', error: RENAME_WORDS.underscore(fix), suggestion: fix }
      : { kind: 'error', error: RENAME_WORDS.underscore('') };
  }
  if ([...name].length > RENAME_MAX) return { kind: 'error', error: RENAME_WORDS.long };
  if (siblings.has(fold(name))) return { kind: 'error', error: RENAME_WORDS.taken };
  const near = siblings.closeKeys?.get?.(closeKey(name));
  if (near !== undefined) return { kind: 'error', error: RENAME_WORDS.close(name, near) };
  return { kind: 'rename', name };
}
