// client/v2/canvases/rename-model.js — S1.2: the rules of renaming a canvas in place (11 · pn-move).
//
// Pure. ↵ renames, esc keeps the name; a name another canvas in the same folder already has is refused
// INLINE — the field stays open with the reason under it, nothing is sent. S1.23b: so is a name TOO CLOSE
// to a sibling's — one that would share its sync document (an em dash vs a hyphen, `a%20b` vs `a b`,
// case); the server (`sync-name-key.ts`) is the authority and also checks across folders. Everything
// else the server's allowlist decides (`canvas-create.ts` validateCanvasName) and its words come back in
// the same slot.

export const RENAME_MAX = 60;

export const RENAME_WORDS = {
  taken: 'That name is already used in this folder.',
  // Same words as the server's `NAME_REFUSAL` (canvas-create.ts) — a test pins them equal.
  reserved: 'Names can’t contain / \\ : * ? " < > | or start with a dot. Try another name.',
  long: `Names are ${RENAME_MAX} characters or fewer.`,
  failed: 'Could not rename. Try again.',
  // Same words as the server's `tooCloseText` (sync-name-key.ts) — a test pins them equal.
  close: (name, other) =>
    `“${name}” is too close to “${other}”, which is already here. Try another name.`,
};

// Path separators, the reserved characters and control characters (lead decision
// `v2-lead-canvas-names-any-filename-safe`): the same set as `canvas-create.ts` RESERVED_RE.
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
const RESERVED = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const norm = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/ +/g, ' ');
const fold = (s) => norm(s).toLowerCase();

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
 *  { kind: 'error', error }      refuse inline, keep the field open
 *  { kind: 'rename', name }      send `name`
 * `siblings` is a Set of folded names (see `siblingNames`).
 */
export function checkRename({ draft, current, siblings = new Set() }) {
  const name = norm(draft);
  if (!name || name === norm(current)) return { kind: 'keep' };
  if (RESERVED.test(name) || name.startsWith('.'))
    return { kind: 'error', error: RENAME_WORDS.reserved };
  if ([...name].length > RENAME_MAX) return { kind: 'error', error: RENAME_WORDS.long };
  if (siblings.has(fold(name))) return { kind: 'error', error: RENAME_WORDS.taken };
  const near = siblings.closeKeys?.get?.(closeKey(name));
  if (near !== undefined) return { kind: 'error', error: RENAME_WORDS.close(name, near) };
  return { kind: 'rename', name };
}
