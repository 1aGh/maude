// The file plane's WHOLE membership policy — one positive classifier.
//
// Sync's unit used to be a canvas, and a file travelled iff some canvas
// claimed it by name. A fresh link of a real project delivered 79/79 canvases
// and lost 103 files — the design system's assets, its token stylesheets,
// `_brand-css.ts` (→ `TypeError: Importing a module script failed`), both
// docs (RCA: issue-fresh-link-gets-canvases-but-not-the-design-system). Every
// fix so far added a per-file-kind lane; the growth was the bug. This module
// replaces the taxonomy: membership in the manifest-driven file plane
// (Plane B) is decided HERE, positively, and nowhere else.
//
// BREAKER's honest test, from the binding debate
// (kg: maude/sync-two-plane-manifest-architecture): "That manifest collapses
// into whole-folder with extra steps — if the classifier ends up as
// everything-except-the-exclusion-regex, I have paid a manifest complexity
// for zero safety. The honest test before building: can the team enumerate
// the versioned classes POSITIVELY?" This module IS that enumeration:
//
//   canvas-owned   → Plane A (the per-canvas Yjs CRDT docs), NEVER Plane B.
//                    A canvas body (`.tsx` inside a canvas group) and its
//                    named sidecars (`.meta.json`, the same-named sibling
//                    `.css`, `.annotations.svg`). Plane disjointness is
//                    enforced at the SOURCE — these never enter a manifest —
//                    and tested, because a second transport under a CRDT lane
//                    is how a converged edit gets clobbered by a stale copy.
//   inert-media    → images / fonts / video / audio / svg. Flows freely.
//   companion-text → css / md. Flows freely.
//   code-module    → ts / tsx / js / mjs outside canvas bodies. Flows ONLY
//                    through the owner-hub gate: the receiver admits it when
//                    its STORED hub record says `role === 'owner'` (or the
//                    hub is the loopback cell pairing) — never on a
//                    hub-supplied claim.
//   never          → `config.json` at the design root (it names the hub URL
//                    and the canvas groups — a synced config is a hub
//                    rewriting its own trust anchors), everything the DDR-115
//                    runtime-state taxonomy matches, and EVERYTHING not
//                    positively claimed above. Default-closed: an extension
//                    not listed here does not travel.
//
// THE RECEIVER RE-VALIDATES EVERY PATH (ATTACKER's invariant, same debate):
// a hub-supplied `class` field is a hint for reporting, never authority —
// each side classifies against its OWN tree and config before a byte moves.
//
// ⚠ MIRRORED in `apps/hub/src/file-membership.mjs` (the doc-namespace
// precedent). The hub image installs frozen against its own bun.lock and must
// not reach into apps/studio, so the logic is duplicated rather than shared,
// and the two are pinned to each other by
// `test/sync-file-membership.test.ts`, which imports the hub's `.mjs` and
// asserts both agree over an adversarial corpus. Change one, change the other.
//
// ⚠ FOURTH COPY, WITH A TRIPWIRE. `isRuntimeStateRel` below replicates
// `git/service.ts` `isMaudeRuntimeState` instead of importing it — importing
// would drag the git surface into the hub mirror's parity story. Three copies
// of the DDR-115 list already exist (git/service.ts, cli/lib/
// gitignore-block.mjs, the repo .gitignore) and they have drifted silently
// before; this copy is pinned by a test that imports BOTH and asserts
// agreement on a fixture list, which turns the drift into a unit-testable
// bug. The debate accepted the 4th copy knowingly, on that condition.

/** A `canvasGroups[]` entry, as loose as the config actually is — mirrors
 *  `canvas-path.ts`'s `CanvasGroupLike` (declared locally so this module,
 *  like its hub mirror, is dependency-free). */
export interface CanvasGroupLike {
  path?: string;
}

export type FileClass = 'canvas-owned' | 'inert-media' | 'companion-text' | 'code-module' | 'never';

/** The classes the file plane actually carries. `canvas-owned` is Plane A's;
 *  `never` is nobody's. */
export const FILE_PLANE_CLASSES = ['inert-media', 'companion-text', 'code-module'] as const;
export type FilePlaneClass = (typeof FILE_PLANE_CLASSES)[number];

export function isFilePlaneClass(c: FileClass): c is FilePlaneClass {
  return c === 'inert-media' || c === 'companion-text' || c === 'code-module';
}

/** Max relative-path length (matches the hub's checkout shape cap). */
export const MAX_REL_LEN = 512;

/** Max designRoot-relative depth (matches the hub's 8-segment cap). */
export const MAX_SEGMENTS = 8;

// The positive extension enumerations. Everything is lowercase; the lookup
// lowercases first — a DS legitimately ships `…P1020428.JPG`.
const INERT_MEDIA_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'svg',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'woff2',
  'woff',
  'ttf',
  'otf',
]);
const COMPANION_TEXT_EXTS = new Set(['css', 'md', 'srt', 'vtt']);
const CODE_MODULE_EXTS = new Set(['ts', 'tsx', 'js', 'mjs']);

/**
 * Maude's OWN sidecar vocabulary, positively enumerated by full suffix —
 * never bare `.json` (that stays default-closed; a manifest must not be able
 * to land arbitrary json, least of all a config). Found by the Task-12
 * acceptance run on the real alligators tree: `assets/<sha8>.photo.json`
 * (non-destructive photo edits) and `assets/<sha8>.audio.json` are versioned
 * content (DDR-115 does not ignore them), and without a lane the second
 * machine silently loses every photo edit — the exact bug class this module
 * exists to end.
 */
// + the footage analysis, component registry, edit decision list: versioned
// sidecars (DDR-115) the T32 scale run found never reaching a peer.
const COMPANION_SIDECAR_SUFFIXES = [
  '.photo.json',
  '.audio.json',
  '.footage.json',
  '.registry.json',
  '.edl.json',
];

/**
 * A DIRECTORY segment must start alphanumeric — the same rule as the hub's
 * `checkoutRelShape`, and the rule that keeps every `_*` runtime DIRECTORY
 * (`_history/`, `_untrusted/`, `_trash/`, …) out structurally, before the
 * explicit runtime-state check even runs.
 */
const DIR_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/**
 * The FINAL segment may additionally start with `_` — this is the one
 * deliberate relaxation over `checkoutRelShape`, and the reason the paired
 * refusal below (`isRuntimeStateRel`) lands in the same module, same commit:
 * real versioned FILES like `_brand-css.ts` and `preview/_layout.css` start
 * with an underscore, and refusing the underscore wholesale is exactly the
 * DDR-115 shape accident that left them laneless. A leading dot stays
 * refused — `.DS_Store` and dotfiles are not project content.
 */
const FILE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/**
 * Maude's own per-machine runtime state — the DDR-115 taxonomy, replicated
 * byte-for-byte from `git/service.ts` `isMaudeRuntimeState` (see the 4th-copy
 * tripwire note in the header; the parity test imports both and asserts
 * agreement). These never travel in EITHER direction, no matter what their
 * extension says.
 */
export function isRuntimeStateRel(p: string): boolean {
  return (
    /(^|\/)_(?:server|active|sync|preflight|locator|export-history|generate-history)(?:\.[A-Za-z0-9_-]{1,64})?\.json$/.test(
      p
    ) ||
    /(^|\/)_server\.(?:lock|log)$/.test(p) ||
    /(^|\/)_(?:history|trash|draw|photo|smoke|reports|canvas-state|state|chat|comments|untrusted|export-jobs)(?:\/|$)/.test(
      p
    ) ||
    /(^|\/)\.kgai(?:\/|$)/.test(p)
  );
}

export interface ClassifyOptions {
  /** Declared canvas groups. Absent ⇒ the same `['system', 'ui']` default the
   *  canvas-path receiver uses — the two halves of sync must agree on what a
   *  group is, or a body one lane owns leaks into the other. */
  canvasGroups?: readonly CanvasGroupLike[];
  /**
   * Presence probe over the SAME tree `rel` came from. Powers the ONE
   * sibling-dependent split: a `.css` inside a canvas group is canvas-owned
   * when `<same-name>.tsx` exists (it is that canvas's Yjs css lane), and
   * companion-text when it does not (`brand.css`, `_layout.css` — the RCA's
   * missing stylesheets). This cannot be decided from the path alone, and
   * both misreadings are wrong: "all group css is canvas-owned" re-loses the
   * RCA's five files, "all group css flows" double-transports a CRDT lane.
   * Absent ⇒ companion-text (the flowing side) — safe because every RECEIVER
   * passes its own disk probe and re-refuses what its tree shows is a
   * sidecar.
   */
  hasFile?: (rel: string) => boolean;
}

/**
 * Classify one designRoot-relative path. Total: every input gets a class, and
 * every malformed input gets `never` — shape refusal and policy refusal are
 * deliberately the same answer, so no caller can tell them apart and leak an
 * oracle.
 *
 * Shape gates (all refusals → `never`): relative, `/`-separated, ≤ 8
 * segments, ≤ 512 chars, no `..`/`.`/empty segment, no backslash, no drive
 * letter, no control characters, no trailing-space segment, no
 * `node_modules`, directory segments start alphanumeric, the final segment
 * may start with `_`.
 */
export function classifyProjectFile(rel: string, opts: ClassifyOptions = {}): FileClass {
  const parts = relShape(rel);
  if (parts === null) return 'never';

  // The design root's own `config.json` names the linked hub and the canvas
  // groups — a peer that syncs it hands naming authority to the hub.
  if (rel === 'config.json') return 'never';
  if (isRuntimeStateRel(rel)) return 'never';

  const last = parts[parts.length - 1] ?? '';
  const lowerLast = last.toLowerCase();
  const lowerRel = rel.toLowerCase();
  const inGroup = normalizedGroups(opts.canvasGroups).some((g) =>
    lowerRel.startsWith(`${g.toLowerCase()}/`)
  );

  if (inGroup) {
    // The canvas body and its NAMED sidecars — Plane A's, by construction.
    if (lowerLast.endsWith('.tsx')) return 'canvas-owned';
    if (lowerLast.endsWith('.meta.json')) return 'canvas-owned';
    if (lowerLast.endsWith('.annotations.svg')) return 'canvas-owned';
    if (lowerLast.endsWith('.css') && opts.hasFile) {
      const sibling = `${rel.slice(0, -'.css'.length)}.tsx`;
      if (opts.hasFile(sibling)) return 'canvas-owned';
    }
  }

  // The annotations sidecar's REAL shape: flat at the design root, keyed by
  // the slug (`ui-2.annotations.svg`) — the naming asymmetry the canvas
  // artifacts vocabulary documents. The in-group rule above never fires for
  // it, so it fell through to `inert-media` and the FILE plane carried a file
  // the DOC lane already owns. Two lanes, two conflict semantics, no shared
  // ancestor: a stale doc-lane materialisation on one peer bumped the file's
  // mtime, the file plane read that as a fresh local edit and pushed it, and
  // a drawing made seconds earlier on the other machine was erased everywhere
  // (observed live: 417 B of strokes at 10:50:28, an empty 72 B wrapper
  // pushed over them at 10:50:33). The annotations lane's own stamped
  // newest-wins protection never saw it coming — it guards the DOC lane, and
  // this was the file plane acting alone. One owner: the canvas.
  if (parts.length === 1 && lowerLast.endsWith('.annotations.svg')) return 'canvas-owned';

  if (COMPANION_SIDECAR_SUFFIXES.some((s) => lowerLast.endsWith(s))) return 'companion-text';

  const dot = lowerLast.lastIndexOf('.');
  const ext = dot < 0 ? '' : lowerLast.slice(dot + 1);
  if (INERT_MEDIA_EXTS.has(ext)) return 'inert-media';
  if (COMPANION_TEXT_EXTS.has(ext)) return 'companion-text';
  if (CODE_MODULE_EXTS.has(ext)) return 'code-module';

  // Default-closed. Not an error — the answer.
  return 'never';
}

/**
 * The shape gate alone — true when `rel` could name a project file at all.
 *
 * Exposed for surfaces that must parse BEFORE they can classify: the hub's
 * PUT route parses the URL before it knows the checkout's canvas groups, and
 * a parse-stage refusal there is final (the request falls through), so it may
 * refuse only what NO configuration could ever admit — the shape.
 */
export function isProjectFileShape(rel: string): boolean {
  return relShape(rel) !== null;
}

/** The segment shape rules alone — split parts, or null on refusal. */

/**
 * Another program's conflict artifact. Never ours to carry.
 *
 * `~/git` is a real Syncthing tree, and Syncthing writes
 * `hero.sync-conflict-20260818-101500-ABCDEF.png` beside the original. Nothing
 * excluded those, so `scanLocalFiles` saw one as `create-up`, pushed it to the
 * hub, journalled it, and delivered it to every peer — where Syncthing could
 * in turn make conflict copies OF the conflict copies. A noise-amplification
 * loop in the one environment the maintainer actually runs, and it makes
 * conflict provenance exactly as unattributable as `conflictCopyName`'s own
 * comment says it must not be.
 */
export function isForeignConflictArtifact(rel: string): boolean {
  return /\.sync-conflict-/i.test(rel);
}

function relShape(rel: unknown): string[] | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > MAX_REL_LEN) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
  if (/[\u0000-\u001f\u007f]/.test(rel)) return null;
  if (rel.startsWith('/') || rel.includes('\\') || /^[A-Za-z]:/.test(rel)) return null;
  if (isForeignConflictArtifact(rel)) return null;
  const parts = rel.split('/');
  if (parts.length > MAX_SEGMENTS) return null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? '';
    if (!p || p === '.' || p === '..') return null;
    if (p === 'node_modules') return null;
    if (/ $/.test(p)) return null;
    if (!(i === parts.length - 1 ? FILE_SEGMENT : DIR_SEGMENT).test(p)) return null;
  }
  return parts;
}

/**
 * Declared group paths, normalised — the same semantics (and the same
 * `['system', 'ui']` fallback) as `canvas-path.ts`'s private helper, re-typed
 * here because this module must load dependency-free in the hub's plain-Node
 * runtime through its `.mjs` mirror.
 */
function normalizedGroups(canvasGroups?: readonly CanvasGroupLike[]): string[] {
  const out: string[] = [];
  for (const g of canvasGroups ?? []) {
    const p = normalizeGroup(g?.path);
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length > 0 ? out : ['system', 'ui'];
}

/** One group path, or null when unusable as a containment prefix (stricter is
 *  the safe direction — an escaping group is dropped, not clamped). */
function normalizeGroup(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!p) return null;
  if (/^[A-Za-z]:/.test(p)) return null;
  for (const part of p.split('/')) {
    if (!part || part === '.' || part === '..') return null;
    if (!/^[A-Za-z0-9_-][A-Za-z0-9 _-]*(?![\s\S])/.test(part)) return null;
  }
  return p;
}
