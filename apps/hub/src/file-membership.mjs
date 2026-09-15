// The file plane's membership policy — HUB MIRROR.
//
// ⚠ THE LOGIC IS MIRRORED from `apps/studio/sync/file-membership.ts` and the
// two are pinned to each other by `apps/studio/test/sync-file-membership.test.ts`,
// which imports THIS file across the package boundary and asserts both
// classifiers agree over an adversarial corpus (the doc-namespace precedent).
// They are separate files on purpose: the hub image installs frozen against
// its own bun.lock and must not reach into apps/studio. Change one, change
// the other, or that test fails.
//
// The `.ts` original carries the full policy rationale (BREAKER's honest
// test, the class table, the 4th-copy tripwire); read it there. The short
// form: membership in the manifest-driven file plane is a POSITIVE
// enumeration —
//
//   canvas-owned   → Plane A (per-canvas CRDT docs), never in a manifest.
//   inert-media    → images / fonts / video / audio / svg.
//   companion-text → css / md.
//   code-module    → ts / tsx / js / mjs outside canvas bodies (owner-gated
//                    on the RECEIVER; the hub only reports the class).
//   never          → design-root `config.json`, DDR-115 runtime state, and
//                    everything not positively claimed. Default-closed.

/** The classes the file plane actually carries. */
export const FILE_PLANE_CLASSES = ['inert-media', 'companion-text', 'code-module'];

/** @param {string} c */
export function isFilePlaneClass(c) {
  return c === 'inert-media' || c === 'companion-text' || c === 'code-module';
}

/** Max relative-path length (matches `checkoutRelShape`'s cap). */
export const MAX_REL_LEN = 512;

/** Max designRoot-relative depth (matches the 8-segment cap). */
export const MAX_SEGMENTS = 8;

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

/** Maude's OWN sidecar vocabulary, by full suffix — never bare `.json`
 *  (default-closed stands). See the `.ts` mirror for the acceptance finding
 *  that added these. */
// + the footage analysis, component registry, edit decision list: versioned
// sidecars (DDR-115) the T32 scale run found never reaching a peer.
const COMPANION_SIDECAR_SUFFIXES = [
  '.photo.json',
  '.audio.json',
  '.footage.json',
  '.registry.json',
  '.edl.json',
];

/** A DIRECTORY segment must start alphanumeric — keeps `_*` runtime
 *  directories out structurally, before the explicit taxonomy check. */
const DIR_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/** The FINAL segment may additionally start with `_` — real versioned files
 *  (`_brand-css.ts`, `preview/_layout.css`) do. Leading dot stays refused. */
const FILE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/**
 * The DDR-115 runtime-state taxonomy, replicated byte-for-byte from
 * `apps/studio/git/service.ts` `isMaudeRuntimeState` (via the `.ts` half of
 * this mirror, which carries the tripwire test).
 *
 * @param {string} p
 */
export function isRuntimeStateRel(p) {
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

/**
 * Classify one designRoot-relative path. Total: every input gets a class;
 * every malformed input gets `never` — shape refusal and policy refusal are
 * the same answer, so this can never become an oracle.
 *
 * @param {string} rel
 * @param {{ canvasGroups?: ReadonlyArray<{ path?: string }>,
 *           hasFile?: (rel: string) => boolean }} [opts]
 *        `hasFile` probes the SAME tree `rel` came from — it powers the one
 *        sibling-dependent split (a group `.css` beside a same-named `.tsx`
 *        is that canvas's Yjs css lane, not plane-B content). Absent ⇒ the
 *        flowing side; receivers re-check against their own disk.
 * @returns {'canvas-owned'|'inert-media'|'companion-text'|'code-module'|'never'}
 */
export function classifyProjectFile(rel, opts = {}) {
  const parts = relShape(rel);
  if (parts === null) return 'never';

  if (rel === 'config.json') return 'never';
  if (isRuntimeStateRel(rel)) return 'never';

  const last = parts[parts.length - 1] ?? '';
  const lowerLast = last.toLowerCase();
  const lowerRel = rel.toLowerCase();
  const inGroup = normalizedGroups(opts.canvasGroups).some((g) =>
    lowerRel.startsWith(`${g.toLowerCase()}/`)
  );

  if (inGroup) {
    if (lowerLast.endsWith('.tsx')) return 'canvas-owned';
    if (lowerLast.endsWith('.meta.json')) return 'canvas-owned';
    if (lowerLast.endsWith('.annotations.svg')) return 'canvas-owned';
    if (lowerLast.endsWith('.css') && opts.hasFile) {
      const sibling = `${rel.slice(0, -'.css'.length)}.tsx`;
      if (opts.hasFile(sibling)) return 'canvas-owned';
    }
  }

  // The annotations sidecar's REAL shape: flat at the design root, keyed by
  // the slug (`ui-2.annotations.svg`). The in-group rule above never fires for
  // it, so it fell through to `inert-media` and the FILE plane carried a file
  // the DOC lane already owns — the two-lane erase described in the studio
  // classifier (sync/file-membership.ts), which this file must mirror.
  if (parts.length === 1 && lowerLast.endsWith('.annotations.svg')) return 'canvas-owned';

  if (COMPANION_SIDECAR_SUFFIXES.some((s) => lowerLast.endsWith(s))) return 'companion-text';

  const dot = lowerLast.lastIndexOf('.');
  const ext = dot < 0 ? '' : lowerLast.slice(dot + 1);
  if (INERT_MEDIA_EXTS.has(ext)) return 'inert-media';
  if (COMPANION_TEXT_EXTS.has(ext)) return 'companion-text';
  if (CODE_MODULE_EXTS.has(ext)) return 'code-module';

  return 'never';
}

/**
 * The shape gate alone — true when `rel` could name a project file at all.
 * For surfaces that must parse BEFORE they can classify (the PUT route's URL
 * parser); a parse-stage refusal is final, so it may refuse only what NO
 * configuration could ever admit — the shape.
 *
 * @param {string} rel
 */
export function isProjectFileShape(rel) {
  return relShape(rel) !== null;
}

/** The segment shape rules alone — split parts, or null on refusal.
 *  @param {unknown} rel @returns {string[]|null} */

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
export function isForeignConflictArtifact(rel) {
  return /\.sync-conflict-/i.test(rel);
}

function relShape(rel) {
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

/** Declared group paths, normalised — the same semantics (and the same
 *  `['system', 'ui']` fallback) as canvas-path's helper.
 *  @param {ReadonlyArray<{ path?: string }>|undefined} canvasGroups */
function normalizedGroups(canvasGroups) {
  const out = [];
  for (const g of canvasGroups ?? []) {
    const p = normalizeGroup(g?.path);
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length > 0 ? out : ['system', 'ui'];
}

/** One group path, or null when unusable as a containment prefix.
 *  @param {unknown} raw @returns {string|null} */
function normalizeGroup(raw) {
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
