// Where a synced canvas belongs on disk — the one answer both receivers use.
//
// A document name carries a FLATTENED slug (`ui/2026/social/summer-camp.tsx` →
// `ui-2026-social-summer-camp`). `/`→`-` is not reversible, so neither receiver
// could reconstruct the folder and both wrote the body flat at the design root.
// A file there is inside no `canvasGroups` entry, which means the file tree does
// not list it and `scanCanvases` does not sync it onward: the canvas arrives and
// is invisible.
//
// So the path travels WITH the document, in `syncMeta.path` — an existing,
// already-synced, never-materialized lane. This module is the receiver's half:
// it decides whether to believe it.
//
// WHY THE RECEIVER CHECKS RATHER THAN TRUSTS. DDR-054 treats hub-pushed content
// as untrusted, and a path is a strictly more dangerous input than a slug — a
// slug can only name a file, a path chooses a directory. The load-bearing rule
// is #7 below: the path must slug BACK to the document carrying it. That makes
// a hostile path self-defeating, because a path pointing somewhere else no
// longer addresses this document. The value is not believed because the sender
// is trusted; it is believed because it was checked against a value the
// receiver derived independently.
//
// A rejected path is never fatal. It degrades to `fallbackCanvasPath`, which is
// today's behaviour made VISIBLE — flat, but inside a canvas group.
//
// ONE COPY, TWO RUNTIMES (the `apps/hub/Dockerfile` rule). The hub imports this
// file rather than re-typing it in `.mjs`, exactly as it does for
// `sync/autocommit.ts` and `cloud/mirror.mjs`: re-typing a guarantee is
// re-typing it without its tests. Hence dependency-free — no `node:path`, no
// `node:fs`, nothing a plain-Node hub or a bun-compiled sidecar has to resolve.
// Callers that need real disk resolution pass `join`/`resolve`/`sep` in, the
// way `pullTargets` already does.

import { canvasSlugFromRel } from '../canvas-slug.ts';

/** A `canvasGroups[]` entry, as loose as the config actually is. */
export interface CanvasGroupLike {
  path?: string;
}

export type CanvasPathVerdict = { ok: true; rel: string } | { ok: false; reason: string };

/**
 * Cap on a wire path. Generous next to any real project tree and far below the
 * point where a path becomes an amplification vector.
 */
export const MAX_CANVAS_PATH_LEN = 400;

/**
 * Cap on path DEPTH, which the length cap does not imply.
 *
 * The hub's `slugFromDocName` accepts any slash-free tail, so a 400-character
 * path can still be 200 single-character components — and the receivers create
 * parent directories with `mkdirSync(recursive: true)`. Eight is past anything
 * a real project nests.
 */
export const MAX_CANVAS_PATH_DEPTH = 8;

/**
 * The charset one path component may use.
 *
 * `slugFromDocName`'s explicit-charset style, widened by exactly one character:
 * a space, because canvas filenames legitimately contain them (`Kanban App.tsx`
 * — the slug transform maps whitespace to `_`, so such files exist and sync
 * today). No dot: that is what keeps `.`/`..` and extension smuggling out of
 * every component but the last, which is handled separately.
 */
// NOTE the `(?![\s\S])` terminator rather than `$`: in JavaScript `$` ALSO
// matches immediately before a trailing newline, so `/^[a-z]+$/.test('ui\n')`
// is true. Rule 1's control-character check catches that today, but these
// regexes are documented as the charset boundary and must hold on their own.
//
// EXPORTED (S1.23c, lead decision `v2-lead-canvas-names-sync-safe`): this is also the allowlist for a
// canvas or folder NAME (`canvas-create.ts`), so a name the studio accepts is by construction a name
// every receiver accepts. The client's mirror (`client/v2/canvases/rename-model.js`) is pinned to this
// regex's `.source` by `test/canvas-names-sync-safe.test.ts`.
export const COMPONENT = /^[A-Za-z0-9_-][A-Za-z0-9 _-]*(?![\s\S])/;

/** The final component: the same charset plus exactly one `.tsx` suffix. */
const FINAL_COMPONENT = /^[A-Za-z0-9_-][A-Za-z0-9 _-]*\.tsx(?![\s\S])/;

/** A component may not end in a space — trailing-space filenames are a mess on
 *  every platform and a rename hazard on Windows. */
const TRAILING_SPACE = / $/;

export interface ValidateCanvasPathArgs {
  /** The wire value. Anything at all — this is untrusted input. */
  path: unknown;
  /** The slug of the document that carried it. Rule 7 checks the path against it. */
  slug: string;
  /** Design root, relative to the repo root (`.design`). Rule 7 passes it through. */
  designRel?: string;
  /** Declared groups. A path outside every group is refused (rule 8). */
  canvasGroups?: readonly CanvasGroupLike[];
  /**
   * Accept a group this project has not declared (rule 8 relaxed to "the first
   * component is group-shaped").
   *
   * ONLY for a genuinely fresh link — a design root with no canvases and no
   * `config.json` of its own. Such a project has declared nothing, so refusing
   * every path against a DEFAULT group list would reject the whole of a project
   * whose author simply calls their group `screens`, and the empty-folder case
   * would arrive invisible. The caller is expected to then WRITE the groups it
   * learned, so this relaxation applies once and never again.
   *
   * It widens which DIRECTORY a path may name; it does not weaken rules 1-7,
   * and rule 7 still ties every path to its own document.
   */
  allowUndeclaredGroup?: boolean;
}

/**
 * Believe a `syncMeta.path`, or say why not.
 *
 * Every rule exists because its absence lets a path do something a slug cannot.
 * Ordered cheapest-first, and each returns a reason rather than a boolean so a
 * rejection is debuggable from a log line.
 */
export function validateCanvasPath(args: ValidateCanvasPathArgs): CanvasPathVerdict {
  const { path, slug, designRel = '.design', canvasGroups, allowUndeclaredGroup } = args;

  // 1. A string, bounded, with no NUL or control characters. A NUL truncates
  //    the name at the syscall boundary on some platforms, so a path that
  //    validates as one thing can create another.
  if (typeof path !== 'string' || path.length === 0) return no('not a non-empty string');
  if (path.length > MAX_CANVAS_PATH_LEN) return no(`longer than ${MAX_CANVAS_PATH_LEN} characters`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
  if (/[\u0000-\u001f\u007f]/.test(path)) return no('contains a control character');

  // 2. Relative. Rejects `/etc/...`, a UNC `\\host\share`, and `C:\...`.
  if (path.startsWith('/')) return no('absolute');
  if (/^[A-Za-z]:/.test(path)) return no('carries a drive letter');

  // 3. `/` is the only separator. A backslash is a LEGAL filename character on
  //    POSIX, so accepting it would let `a\../b` read as one component here and
  //    as a traversal on a receiver that normalises separators.
  if (path.includes('\\')) return no('contains a backslash');

  // 4 + 5. Componentwise. No empty component (`a//b`, a trailing `/`), no `.`
  //        or `..`, and nothing outside the charset. Note this runs on the RAW
  //        string: `canvasSlugFromRel` below percent-decodes, and a check that
  //        ran after decoding could be walked past with `%2e%2e`.
  const parts = path.split('/');
  if (parts.length < 2) return no('not inside a canvas group');
  if (parts.length > MAX_CANVAS_PATH_DEPTH) return no('nested deeper than a project ever is');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length === 0) return no('has an empty path component');
    if (part === '.' || part === '..') return no('has a dot component');
    if (TRAILING_SPACE.test(part)) return no('has a component ending in a space');
    const re = i === parts.length - 1 ? FINAL_COMPONENT : COMPONENT;
    if (!re.test(part)) return no(`component ${i} is outside the canvas charset`);
  }

  // 6. Covered by FINAL_COMPONENT — stated separately because it is a rule, not
  //    an implementation detail: the sync body lane is `.tsx` (Phase 3.6).

  // 6b. THE ONE PLACE RULE 7 IS NOT A BIJECTION. `canvasSlugFromRel` strips an
  //     optional leading `<designRel>/`, so with `designRoot: "mocks"` the path
  //     `mocks/ui/card.tsx` slugs to `ui-card` — the same slug as `ui/card.tsx`,
  //     one component the check cannot see. Contained either way, but "the path
  //     slugs back to its own document" has to be true without an asterisk, so
  //     the redundant prefix is refused outright rather than silently stripped.
  const designPrefix = String(designRel ?? '').replace(/^\/+|\/+$/g, '');
  if (designPrefix && (path === designPrefix || path.startsWith(`${designPrefix}/`))) {
    return no('repeats the design-root prefix');
  }

  // 7. THE ONE THAT MAKES THIS SAFE. The path must slug back to the document
  //    that carried it. `canvasSlugFromRel` is IMPORTED, never re-typed: a
  //    second copy that drifts turns the whole check into decoration.
  const derived = canvasSlugFromRel(path, designRel);
  if (derived !== String(slug ?? '').toLowerCase()) {
    return no(`slugs to "${derived}", not to this document`);
  }

  // 8. Inside a declared canvas group. Containment against the design root
  //    follows from rules 2-4 (relative, no `..`, no backslash), and this is
  //    the stronger statement anyway: a path outside every group is a path the
  //    tree would not list, which is the failure this whole module exists for.
  //    Callers keep their own resolve()-based check as well — belt and braces
  //    at a create.
  // Case-INSENSITIVE, because rule 7 above lowercases: `ui/CARD.tsx` satisfies
  // rule 7 against slug `ui-card`, and a case-sensitive group check would then
  // accept or refuse the same document depending on the peer's filesystem.
  const groups = normalizedGroups(canvasGroups);
  const lower = path.toLowerCase();
  if (!groups.some((g) => lower.startsWith(`${g.toLowerCase()}/`))) {
    // Rules 4-5 already proved every component is group-shaped, so under the
    // fresh-link relaxation there is nothing further to check — the path is
    // inside SOME group, just not one this project has heard of yet.
    if (!allowUndeclaredGroup) return no('outside every declared canvas group');
  }

  return { ok: true, rel: path };
}

/**
 * Where a canvas goes when no path arrived, or the one that did was refused.
 *
 * Flat — a slug cannot be un-flattened without guessing — but placed INSIDE a
 * canvas group wherever that is possible, because the design root is not inside
 * one: the file tree and `scanCanvases` enumerate `canvasGroups`, so the old
 * design-root fallback produced a file nobody could see and that never synced
 * onward. A flat file in `ui/` is untidy; a flat file at the root is lost.
 *
 * THE CONSTRAINT THAT SHAPES THIS. Moving a canvas is already a new document
 * (the slug derives from the path), so the fallback may not put the body
 * anywhere that re-slugs. Writing `ui-legacy` to `ui/ui-legacy.tsx` would slug
 * to `ui-ui-legacy` on the receiver's next scan: a SECOND document, syncing the
 * same bytes under a different name, with the original left orphaned on the hub
 * — a duplicate is strictly worse than an untidy file.
 *
 * So the group is chosen by the slug's own prefix, which is where the slug came
 * from in the first place: `ui-legacy` → `ui/legacy.tsx`, which slugs back to
 * `ui-legacy`. Visible AND the same document. A slug matching no declared group
 * (a canvas that was already outside every group at its author) keeps today's
 * design-root behaviour — identity preserved, still invisible, and no worse
 * than before. That case cannot be fixed without either a path or a rename, and
 * a path is exactly what `syncMeta.path` supplies.
 */
export function fallbackCanvasPath(
  slug: string,
  canvasGroups?: readonly CanvasGroupLike[]
): string {
  const safeSlug = sanitizeSlug(slug);
  // LONGEST match wins: `ui/social` is a better home than `ui` for
  // `ui-social-x`, and declaration order should not decide that. No other
  // tie-break is needed — two groups of equal length that both prefix one slug
  // are the same group.
  const matching = normalizedGroups(canvasGroups)
    .filter((g) => safeSlug.startsWith(`${prefixOf(g)}-`))
    .sort((a, b) => b.length - a.length);
  for (const group of matching) {
    const rest = safeSlug.slice(prefixOf(group).length + 1);
    if (rest.length > 0) return `${group}/${rest}.tsx`;
  }
  return `${safeSlug}.tsx`;
}

/** The slug prefix a group path contributes (`ui/social` → `ui-social`). */
function prefixOf(group: string): string {
  return group.replace(/\//g, '-').replace(/\s+/g, '_').toLowerCase();
}

/**
 * A slug reduced to something that can only ever be ONE filename.
 *
 * Both `slugFromDocName`s already constrain the charset upstream, so this is
 * the second line rather than the first — but it is the line standing between
 * a bad slug and a directory of the sender's choosing, and it is cheap.
 */
function sanitizeSlug(slug: unknown): string {
  const s = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ._-]/g, '-')
    // No `..` — contained either way once the separators are gone, but a
    // filename containing it invites a later reader to normalise it.
    .replace(/\.{2,}/g, '-')
    // No dotfile, and no leading separator-ish character.
    .replace(/^[.\s-]+/, '');
  return s.length > 0 ? s : 'canvas';
}

/** Declared group paths, normalised and stripped of anything that escapes. */
function normalizedGroups(canvasGroups?: readonly CanvasGroupLike[]): string[] {
  const out: string[] = [];
  for (const g of canvasGroups ?? []) {
    const p = normalizeGroup(g?.path);
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length > 0 ? out : ['system', 'ui'];
}

/**
 * One group path, or null when it is not usable as a containment prefix.
 *
 * The same shape as `isContainedRel` (context.ts) and deliberately not a call
 * to it — that function is in the dev-server's config module, which pulls
 * `node:path`, and this file has to load in the hub's plain-Node runtime.
 * Stricter here, which is the safe direction: a group path that is not a plain
 * relative directory name is dropped rather than clamped.
 */
function normalizeGroup(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!p) return null;
  if (/^[A-Za-z]:/.test(p)) return null;
  const parts = p.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return null;
    if (!COMPONENT.test(part)) return null;
  }
  return p;
}

function no(reason: string): CanvasPathVerdict {
  return { ok: false, reason };
}

/**
 * The receiver's whole decision in one call: believe the wire path, or fall
 * back — and either way return a design-root-relative body path.
 *
 * Both receivers call THIS rather than composing the two above, so "what does a
 * refused path do" has one answer instead of two that can drift.
 */
export function resolveCanvasBodyRel(args: {
  path: unknown;
  slug: string;
  designRel?: string;
  canvasGroups?: readonly CanvasGroupLike[];
  allowUndeclaredGroup?: boolean;
  /** Called with the reason when a PRESENT path is refused. Absent is not a
   *  refusal — an older peer omits the field and that is the normal case. */
  onRefused?: (reason: string) => void;
}): { rel: string; fromPath: boolean } {
  const { path, slug, designRel, canvasGroups, allowUndeclaredGroup, onRefused } = args;
  if (path !== undefined && path !== null) {
    const verdict = validateCanvasPath({
      path,
      slug,
      designRel,
      canvasGroups,
      allowUndeclaredGroup,
    });
    if (verdict.ok) return { rel: verdict.rel, fromPath: true };
    onRefused?.(verdict.reason);
  }
  return {
    rel: fallbackCanvasPath(slug, canvasGroups),
    fromPath: false,
  };
}
