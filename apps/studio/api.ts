// JSON endpoint backers: comments, canvas state, index-data, system-data.
// Returns plain objects; http.ts wraps them in Response.json().

import crypto from 'node:crypto';
import { type Dirent, renameSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat as statp,
} from 'node:fs/promises';
import path from 'node:path';
import { createAssetMirror, s3ConfigFromEnv } from './assets-s3.ts';
import { canvasArtifacts, locatorKeyFor, relocatedName } from './canvas-artifacts.ts';
import { renderBriefBoard, validateCanvasName, validateFolderName } from './canvas-create.ts';
import { rewriteRelativeImports } from './canvas-imports.ts';
import { canvasSlugFromRel } from './canvas-slug.ts';
import { atomicWrite } from './sync/atomic-write.ts';
import { dedupeCommentsById } from './sync/comment-identity.ts';
import { isRuntimeStateRel } from './sync/file-membership.ts';

// Re-exported so existing external callers (canvas-list-watch.ts, tests) keep
// importing it from api.ts — the actual implementation now lives in
// canvas-slug.ts (a leaf module) so canvas-artifacts.ts can depend on it
// without a cycle back through api.ts.
export { canvasSlugFromRel } from './canvas-slug.ts';

/** Plan T17/L03 — the supporting files the file tree can move, rename and
 *  delete: what it previews (notes, styles, data, images, media, fonts), minus
 *  the canvas's own sidecars, which only ever travel with their canvas. */
export function isSupportingFileRel(rel: string): boolean {
  if (/\.(meta\.json|annotations\.svg|registry\.json)$/i.test(rel)) return false;
  return /\.(md|css|json|txt|ya?ml|svg|png|jpe?g|gif|webp|avif|mp4|webm|mov|mp3|wav|ogg|m4a|woff2?|ttf|otf)$/i.test(
    rel
  );
}

import {
  type AssembleClip,
  type AttributeState,
  assembleCompSource,
  CanvasEditError,
  type ClipInfo,
  type ConvertChildBox,
  type ConvertContainerSpec,
  componentMapForCanvas,
  convertToAbsolute,
  deleteArtboard,
  deleteElement,
  detachComponent,
  duplicateArtboard,
  duplicateElement,
  type EditScope,
  editArrayElementString,
  editAttribute,
  enumerateClips,
  type InsertKind,
  insertArtboard,
  insertClip,
  insertElement,
  insertElementIntoArtboard,
  type MovePosition,
  moveElement,
  removeAttribute,
  reorderClip,
  resizeArtboard,
  resolveEditScope,
  retimeSequence,
  retimeSequenceByClip,
  editText as runEditText,
  setArtboardGuides,
  setArtboardHug,
  setArtboardKind,
  setArtboardLabel,
  setArtboardPrint,
  setArtboardStyle,
  toggleClipHidden,
} from './canvas-edit.ts';
import {
  applyClipAudio,
  applyClipFraming,
  applyClipGrade,
  applyDetachAudio,
  applyEditTransition,
  applyFitTotalToContent,
  applyInsertTransition,
  applyMoveClipToOverlay,
  applyMoveClipToStoryline,
  applyOnDisk,
  applyRemoveTransition,
  applyReorderOverlayLayer,
  applyResolvePlaceholder,
  applySetClipText,
  applySetPlaybackRate,
  applySplitClip,
  applyTrimIn,
  type GradeParams,
  insertClipAt,
  removeClipRippled,
  seriesMove,
} from './clip-ops.ts';
import type { Context } from './context.ts';
import {
  type AudioMatch,
  type Candidate,
  rankMatches,
  sanitizeReuseText,
} from './generation/audio-library.ts';
import { createHistory } from './history.ts';
import { clearLocatorSlug, readLocator, writeLocator } from './locator.ts';
import { STICKERS_DIR } from './paths.ts';
import { getPaperPreset, MAX_PRINT_MM } from './print/units.ts';
import { sessionDir } from './session-scope.ts';
import { describeSourceOp } from './sync/source-ops.ts';
import { isWorkspaceMode } from './workspace-mode.ts';

// Directories that never hold user-facing canvases. Exported so the
// external-canvas watcher (`canvas-list-watch.ts`) shares one source instead of
// a hand-synced copy. (activity.ts still carries its own historical mirror.)
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.expo',
  'coverage',
  'dev-server',
  '_history',
]);
const HIDDEN_OK = new Set(['.ai', '.claude', '.design']);

// feature-studio-file-preview — binary/media extensions the tree lists so a
// DS's assets/{fonts,graphics,logos,photos,...} files show up (previously
// only their parent folders did, via findFiles's dirsOut accounting). Kept as
// an explicit enumerated list rather than a broad pattern so it can never
// accidentally widen to swallow runtime JSON — findFiles already excludes
// `_`-prefixed entries before this list is even consulted.
export const PREVIEW_ASSET_EXTS = [
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
];

// ---------- File tree ----------

/**
 * Find canvas files under a non-DS group root. Phase 3.6+ accepts both `.tsx`
 * (current authoring format) and `.html` (legacy, pre-codemod) so the tree
 * keeps rendering during the migration grace window. DS preview specimens
 * (`system/<ds>/preview/*.html`) intentionally stay `.html` and travel via
 * the DS-aware `findFiles()` path below.
 */
/**
 * True when `abs` is a directory tree holding nothing but folder placeholders
 * (`.gitkeep`, `.DS_Store`) — what a folder projection leaves before any
 * content arrives. False when it is absent, is not a directory, or holds
 * anything real (a symlink counts as real: never followed, never removed).
 */
async function onlyFolderPlaceholders(abs: string, depth = 0): Promise<boolean> {
  if (depth > 16) return false;
  let entries: Dirent[];
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await onlyFolderPlaceholders(path.join(abs, e.name), depth + 1))) return false;
    } else if (!(e.isFile() && (e.name === '.gitkeep' || e.name === '.DS_Store'))) {
      return false;
    }
  }
  return true;
}

export async function findHtmlFiles(absRoot: string, prefixUnderRepo: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && !HIDDEN_OK.has(e.name) && !e.name.startsWith('_')) continue;
    if (e.name.startsWith('_')) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(absRoot, e.name);
    const rel = path.posix.join(prefixUnderRepo, e.name);
    if (e.isDirectory()) out.push(...(await findHtmlFiles(full, rel)));
    else {
      const low = e.name.toLowerCase();
      if (low.endsWith('.tsx') || low.endsWith('.html')) out.push(rel);
    }
  }
  return out;
}

/**
 * `dirsOut`, when passed, accumulates every directory visited (group-relative
 * POSIX paths, same shape as the returned file paths) — INCLUDING empty ones,
 * since a directory is recorded before recursing into it, not after finding a
 * match inside. feature-file-tree-drag-drop-folders (Task 6) reuses this one
 * traversal instead of adding a second full walk of `system/` (the largest
 * group) just to enumerate directories.
 */
export async function findFiles(
  absRoot: string,
  prefix: string,
  exts: string[],
  dirsOut?: string[]
): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && !HIDDEN_OK.has(e.name)) continue;
    if (e.name.startsWith('_')) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(absRoot, e.name);
    const rel = path.posix.join(prefix, e.name);
    if (e.isDirectory()) {
      dirsOut?.push(rel);
      out.push(...(await findFiles(full, rel, exts, dirsOut)));
    } else if (e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) {
      // feature-studio-file-preview security review — `e.isFile()` (not just
      // "not a directory") excludes symlinks: a symlink Dirent is neither
      // isDirectory() nor isFile(), so without this check a symlink dropped
      // into an assets/ folder (e.g. pointing at ~/.ssh/id_rsa, named to fit
      // an allowlisted extension) would be listed and, since this feature
      // makes every listed row one-click-fetchable, served straight into the
      // preview panel.
      //
      // A HARDLINK survives `isFile()` (hardlinks are, by design, ordinary
      // files — same inode, indistinguishable from the "original" at the
      // Dirent level), so it needs a second check: `nlink > 1` means this
      // directory entry shares its inode with at least one other name
      // somewhere on the filesystem. A design system's own assets are never
      // legitimately multiply-linked, so excluding them closes the same
      // one-click-disclosure path for a hardlink planted at, say, a
      // teammate's readable dotfile.
      try {
        const st = await lstat(full);
        if (st.nlink > 1) continue;
      } catch {
        continue;
      }
      out.push(rel);
    }
  }
  return out;
}

// ---------- Comments ----------

/**
 * Phase 6 — single reply on a comment thread. `id` is `r_<hex>`; persists inside
 * the parent `Comment.thread[]`. Bodies are bounded the same way as comment
 * bodies (4000 chars), and `@handle` tokens in `body` flow into the parent's
 * `mentions[]` union.
 */
export interface Reply {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface Comment {
  id: string;
  file: string;
  selector: string;
  /** Occurrence index among `querySelectorAll(selector)` — disambiguates a
   * component repeated within one artboard. Absent on legacy comments. */
  index?: number;
  dom_path: string[];
  tag: string;
  classes: string;
  bounds: { x: number; y: number; w: number; h: number } | null;
  html_excerpt: string;
  text: string;
  status: 'open' | 'resolved';
  created: string;
  resolved_at: string | null;
  // Phase 6 — author + threading + mentions. Default-filled on read for legacy
  // comments missing these fields (see `loadCommentsForFile`); persisted on next
  // write. `author` defaults to the local `git config user.name` resolved at
  // create time, `thread` to `[]`, `mentions` to `[]`.
  author: string;
  thread: Reply[];
  mentions: string[];
  /** enhanced-video-editing (Task 23) — a TIMELINE anchor: preferred
   *  `{ clipStableId, frameOffset }` (survives reorder/ripple), fallback
   *  `{ frame }` (track-level). Absent on ordinary element comments. Comment
   *  text is untrusted user/peer text (DDR-054) — rendered as text, never
   *  into TSX. */
  timeline?: { clipStableId?: string; frameOffset?: number; frame?: number; lane?: string };
}

export interface GitCommitter {
  name: string;
  email: string;
  commits: number;
}

export type CreateCanvasResult =
  | { ok: true; file: string; rel: string; slug: string }
  | { ok: false; status: number; error: string };

export type DeleteCanvasResult =
  | { ok: true; rel: string; slug: string; trashed: string[]; trashDir: string }
  | { ok: false; status: number; error: string };

// feature-file-tree-drag-drop-folders (Task 3/4).
export type MoveCanvasResult =
  | { ok: true; fromRel: string; toRel: string; fromSlug: string; toSlug: string; moved: string[] }
  | { ok: false; status: number; error: string };

export type CreateFolderResult =
  | { ok: true; dir: string }
  | { ok: false; status: number; error: string };

/** Phase 12 — result of an in-canvas direct edit (`editCss` / `editText`). */
export type EditOpResult =
  /** `previous` — what a css/attr write replaced (`null` = was unset); absent
   *  when it was an expression no literal undo can restore. */
  | { ok: true; delta: number; seq?: number; previous?: string | null }
  /** `conflict` = the target no longer held the caller's expected value. */
  | { ok: false; status: number; error: string; conflict?: true };

/**
 * Optional expected-current value for a css/attr write (audit 2026-09-13 P1
 * #5). An absent `expected` key keeps the unconditional legacy behaviour; a
 * present one must be a bounded string or `null` ("currently unset").
 */
function expectedValueOf(input: {
  expected?: unknown;
}): { ok: true; expected?: string | null } | { ok: false } {
  if (!Object.hasOwn(input, 'expected') || input.expected === undefined) return { ok: true };
  if (input.expected === null) return { ok: true, expected: null };
  if (typeof input.expected === 'string' && input.expected.length <= 256) {
    return { ok: true, expected: input.expected };
  }
  return { ok: false };
}

/**
 * Phase 12.1 (DDR-138) — result of a node-move reorder. Carries the re-settle
 * hints the client uses to re-select the moved element through the positional
 * `data-cd-id` churn: `movedId` (recomputed positional id == the post-reload DOM
 * id, best-effort) and `semanticId` (the moved element's `data-dc-element`, which
 * survives the move verbatim — the reliable key when present).
 */
export type ReorderOpResult =
  | { ok: true; delta: number; movedId: string | null; semanticId: string | null; seq: number }
  | { ok: false; status: number; error: string };

export type ReorderRevertResult =
  | { ok: true; dir: 'undo' | 'redo' }
  | { ok: false; status: number; error: string };

export interface Api {
  // File tree
  fileSlug(file: string): string;
  loadCommentsForFile(file: string): Promise<Comment[]>;
  saveCommentsForFile(file: string, list: Comment[]): Promise<void>;
  loadAllComments(): Promise<Record<string, Comment[]>>;
  /**
   * Resolve a canvas URL slug back to its repo-relative `file` path by scanning
   * the ACTUAL canvas files under each canvas group — independent of whether the
   * canvas has any comments yet. The inverse of `fileSlug`. Returns null when no
   * canvas matches. Load-bearing for collab: a peer that has not yet received any
   * comment for a canvas must still resolve the file to MATERIALIZE the first
   * hub-pushed comment to disk (the receiving-peer projection gap, DDR-064).
   */
  fileForSlug(slug: string): Promise<string | null>;
  commentsAdd(payload: Partial<Comment> & { file: string; text: string }): Promise<Comment | null>;
  commentsPatch(id: string, patch: Partial<Comment>): Promise<Comment | null>;
  commentsDelete(id: string): Promise<boolean>;
  commentsAddReply(id: string, payload: { body: string; author?: string }): Promise<Comment | null>;
  gitCommitters(): Promise<GitCommitter[]>;
  /**
   * Phase 8 — local `git config user.name`, cached for the process lifetime.
   * Used by the collab client to derive a stable color hash per peer.
   * Empty string when git is unset; the client falls back to `anonymous-<pid>`.
   */
  gitCurrentUser(): Promise<string>;
  parseMentions(text: string): string[];
  // Canvas state
  loadCanvasState(file: string): Promise<Record<string, unknown> | null>;
  saveCanvasState(file: string, state: Record<string, unknown>): Promise<void>;
  timelineMediaLoad(key: string): Promise<Record<string, unknown> | null>;
  timelineMediaSave(key: string, data: Record<string, unknown>): Promise<boolean>;
  // Canvas meta sidecar (Phase 4 T5 — .design/ui/<slug>.meta.json)
  loadCanvasMeta(file: string): Promise<Record<string, unknown> | null>;
  /** DDR-148 — raw .tsx source for the Timeline sequence/keyframe parser. */
  loadCanvasSource(
    file: unknown
  ): Promise<{ ok: true; source: string } | { ok: false; status: number; error: string }>;
  patchCanvasMeta(
    file: string,
    patch: Record<string, unknown>
  ): Promise<Record<string, unknown> | null>;
  // Annotations sidecar (Phase 5 — .design/<slug>.annotations.svg)
  loadAnnotations(file: string): Promise<string | null>;
  saveAnnotations(file: string, svg: string, writeId?: string, base?: string): Promise<boolean>;
  /** Materialize a document snapshot without publishing it as another user edit. */
  projectAnnotations(file: string, svg: string, isCurrent: () => boolean): Promise<boolean>;
  // Phase 23 — content-addressed binary image write (drag-drop / paste / picker)
  saveAsset(bytes: Uint8Array): Promise<SaveAssetResult>;
  /** Stage F1 — list content-addressed image/video assets for the AssetPicker. */
  listAssets(): Promise<{ ok: true; assets: AssetListing[] }>;
  /** feature-ai-media-generation (Task 1.2) — read a content-addressed
   *  `assets/<sha8>.<ext>` source's bytes + sniffed mime for the image-edit /
   *  image-to-video generation flows. Contained to <designRoot>/assets/;
   *  null for an unknown/contained-out path. */
  readAssetBytes(rel: unknown): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** feature-ai-media-generation (Task 2.6) — write a caption sidecar
   *  (`assets/<sha8>.srt|.vtt`) next to a content-addressed source, so a cloud
   *  STT result lands where the local whisper path also writes it. Contained to
   *  <designRoot>/assets/; text byte-capped; format allowlisted. */
  writeCaptionSidecar(
    sourceRel: unknown,
    format: unknown,
    text: unknown
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** feature-ai-media-generation (Task 2.5) — write the audio-intent sidecar
   *  (`assets/<sha8>.audio.json`) for reuse-before-you-pay search. */
  writeAudioIntent(
    assetRel: unknown,
    meta: { kind?: string; prompt?: string; provider?: string; model?: string; at?: string }
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** feature-ai-media-generation (Task 2.5) — keyword-search the project's own
   *  generated audio by recorded intent; ranked reuse candidates. */
  searchAudioLibrary(query: unknown, limit?: number): Promise<AudioMatch[]>;
  /** Phase 4 (feature-whiteboard-annotation-improvements) — the bundled sticker
   *  catalogue (MAUDE's own, not the served project's) for the StickerPicker. */
  listStickers(): Promise<{ ok: true; packs: StickerPack[] }>;
  /** DDR-148 — streaming variant for the HTTP route (100 MB video without a
   *  full in-RAM buffer). Sniffs + caps + content-addresses like saveAsset. */
  saveAssetFromStream(stream: ReadableStream<Uint8Array>): Promise<SaveAssetResult>;
  // Persist a clipboard-pasted ACP composer image → runtime `_chat/attachments/`,
  // returns an absolute path (Phase 31 follow-up — POST /_api/acp/attachment).
  saveChatAttachment(bytes: Uint8Array): Promise<SaveAssetResult>;
  // Resolve a content-addressed attachment name (`<sha8>.<ext>`) to its absolute
  // path, or null (GET /_api/acp/attachment — the read side of the pair above).
  resolveChatAttachment(name: unknown): Promise<string | null>;
  // Create a blank brief board OR an assembled video-comp from the browser
  // (Phase 22 — POST /_api/canvas; DDR-150 P4 Task 12 adds kind "video-comp").
  createCanvas(input: {
    name?: unknown;
    kind?: unknown;
    group?: unknown;
    clips?: unknown;
    fps?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<CreateCanvasResult>;
  // Duplicate a canvas beside itself ("<name> copy") — POST /_api/canvas
  // { duplicateOf }. Source, meta and the whiteboard layer; not comments or
  // history, which belong to the original.
  duplicateCanvas(input: { file?: unknown }): Promise<CreateCanvasResult>;
  // Soft-delete a canvas from the browser (Phase 22 — DELETE /_api/canvas)
  deleteCanvas(input: { file?: unknown }): Promise<DeleteCanvasResult>;
  // feature-file-tree-drag-drop-folders (Task 3) — move/rename a canvas + its
  // full artifact set (POST /_api/fs-move).
  moveCanvas(input: { file?: unknown; toDir?: unknown }): Promise<MoveCanvasResult>;
  // feature-file-tree-drag-drop-folders (Task 4) — create an empty folder
  // inside a canvas group, with a `.gitkeep` (POST /_api/fs-mkdir).
  createFolder(input: { parent?: unknown; name?: unknown }): Promise<CreateFolderResult>;
  // Phase 12 (DDR-103) — single-property inline CSS edit (POST /_api/edit-css).
  // Main-origin only: writes one key into the element's inline `style={{}}` object.
  editCss(input: {
    canvas?: unknown;
    id?: unknown;
    property?: unknown;
    value?: unknown;
    reset?: unknown;
    idIndex?: unknown;
    /** Expected current value (string) or `null` = currently unset. Absent = unconditional. */
    expected?: unknown;
  }): Promise<EditOpResult>;
  // Phase 12 (DDR-103) — inline text-content edit (POST /_api/edit-text). Main-origin only.
  editText(input: {
    canvas?: unknown;
    id?: unknown;
    text?: unknown;
    occurrence?: unknown;
    before?: unknown;
  }): Promise<EditOpResult>;
  // Phase 12.2 (DDR-104) — custom HTML attribute edit (POST /_api/edit-attr). Main-origin
  // only. The CSS panel's "custom HTML attribute" escape hatch (data-*, aria-*, role, …);
  // writes a plain JSX attribute via editAttribute's non-`style.` path.
  editAttr(input: {
    canvas?: unknown;
    id?: unknown;
    attr?: unknown;
    value?: unknown;
    reset?: unknown;
    expected?: unknown;
  }): Promise<EditOpResult>;
  // Phase 12.1 (DDR-138) — node-move reorder (POST /_api/reorder). Main-origin
  // only. Moves the element with data-cd-id `id` to `position` relative to
  // `refId` (reparent-capable), snapshotting pre-move for /design:rollback.
  reorder(input: {
    canvas?: unknown;
    id?: unknown;
    refId?: unknown;
    position?: unknown;
  }): Promise<ReorderOpResult>;
  /** DDR-148 — Timeline drag-to-retime a sequence's durationInFrames / from. */
  retimeSequenceOp(input: {
    canvas?: unknown;
    // DDR-150 P2 — prefer stableId (comp-scoped, multi-comp-safe) over index.
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
    index?: unknown;
    durationInFrames?: unknown;
    from?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  // feature-enhanced-video-editing (Phase 2) — parametric clip verbs (speed ·
  // trim-in · audio · detach-audio · framing · grade · transition).
  clipEditOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    stableId?: unknown;
    contentHash?: unknown;
    verb?: unknown;
    rate?: unknown;
    deltaFrames?: unknown;
    muted?: unknown;
    volume?: unknown;
    framing?: unknown;
    grade?: unknown;
    presentation?: unknown;
    durationInFrames?: unknown;
    atFrame?: unknown;
    src?: unknown;
    mediaKind?: unknown;
    text?: unknown;
    toIndex?: unknown;
  }): Promise<
    | { ok: true; seq?: number; extra?: Record<string, unknown> }
    | { ok: false; status: number; error: string }
  >;
  // DDR-150 P3 — remove a clip addressed by stableId (fingerprint + semantic
  // gate; refuses the only clip; drops an adjacent transition in a series).
  removeSequenceOp(input: {
    canvas?: unknown;
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  // DDR-150 P4 — insert a new <Sequence> (optionally with media) after a comp's
  // last clip. Returns the new clip's stableId.
  insertSequenceOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    from?: unknown;
    durationInFrames?: unknown;
    mediaTag?: unknown;
    src?: unknown;
  }): Promise<
    | { ok: true; stableId: string | null; seq?: number }
    | { ok: false; status: number; error: string }
  >;
  // DDR-150 P5 — z-order reorder: move a standalone <Sequence> before/after a
  // sibling (render stacking), reusing moveElement + the semantic gate. Both
  // clips are fingerprint-checked. Returns the moved clip's (re-settled) stableId.
  reorderSequenceOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    stableId?: unknown;
    contentHash?: unknown;
    refStableId?: unknown;
    refContentHash?: unknown;
    position?: unknown;
  }): Promise<
    | { ok: true; stableId: string | null; seq?: number }
    | { ok: false; status: number; error: string }
  >;
  // DDR-150 dogfood — replace a media src that lives in an array literal
  // (the showreel `CLIPS[i].src` pattern), addressed by mediaArrayRef.
  editArraySrcOp(input: {
    canvas?: unknown;
    arrayName?: unknown;
    index?: unknown;
    field?: unknown;
    value?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  // DDR-150 dogfood — hide/show a clip (gates its body behind {false && …}).
  toggleHideOp(input: {
    canvas?: unknown;
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
  }): Promise<
    { ok: true; hidden: boolean; seq?: number } | { ok: false; status: number; error: string }
  >;
  // DDR-150 P2 — the single authoritative clip enumerator for a video-comp.
  // Read-only; the Timeline addresses every op by the returned `stableId`
  // (never a regex document-order index — the multi-comp mis-hit defect).
  compClips(input: { canvas?: unknown; artboardId?: unknown }): Promise<
    | {
        ok: true;
        compName: string | null;
        artboardId: string | null;
        fps: number | null;
        durationInFrames: number | null;
        clips: Array<Omit<ClipInfo, 'start' | 'end'>>;
      }
    | { ok: false; status: number; error: string }
  >;
  // Stage I (feature-element-editing-robustness) — general element structural
  // edits. Each logs a whole-file undo seq (reverted via reorderRevert).
  /** Delete an element by data-cd-id (reused-component instance via idIndex). */
  deleteElementOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; deletedId: string; seq?: number } | { ok: false; status: number; error: string }
  >;
  /**
   * feature-4 T8 (convert-to-absolute, DDR-188) — rewrite a container's stamped
   * children to `position:absolute` with frozen boxes (+ container relative), in
   * ONE whole-file write with ONE undo `seq`.
   */
  convertChildrenToAbsoluteOp(input: {
    canvas?: unknown;
    containerId?: unknown;
    containerIdIndex?: unknown;
    containerSetRelative?: unknown;
    allowShared?: unknown;
    children?: unknown;
    containers?: unknown;
    dissolve?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /**
   * Insert a synthesized div/text/image relative to a reference element, OR —
   * when the artboard has no element to anchor on yet — as a direct child of
   * `artboardId` (the tool-palette "+ Element" empty-artboard fallback).
   * Exactly one of `refId` / `artboardId` must be provided.
   */
  insertElementOp(input: {
    canvas?: unknown;
    refId?: unknown;
    artboardId?: unknown;
    position?: unknown;
    kind?: unknown;
    src?: unknown;
    refIndex?: unknown;
  }): Promise<
    { ok: true; newId: string | null; seq?: number } | { ok: false; status: number; error: string }
  >;
  /** Insert a new empty artboard from a screen-size preset. */
  insertArtboardOp(input: {
    canvas?: unknown;
    id?: unknown;
    label?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<
    { ok: true; artboardId: string; seq?: number } | { ok: false; status: number; error: string }
  >;
  /** Duplicate an artboard at a new width (feature-3-web-artboards T3). */
  duplicateArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    width?: unknown;
  }): Promise<
    { ok: true; artboardId: string; seq?: number } | { ok: false; status: number; error: string }
  >;
  /** Free-hand artboard resize — write width/height numeric props (DDR-027, D4). */
  resizeArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Toggle an artboard's Hug/Fixed height sizing mode (CSS-panel control). */
  setArtboardHugOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    fixed?: unknown;
    freezeHeight?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Set artboard "more settings" — background / padding / layout / gap. */
  setArtboardStyleOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    background?: unknown;
    padding?: unknown;
    layout?: unknown;
    gap?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Kind-switch surfaces (T8) — context menu + Inspector picker. */
  setArtboardKindOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    kind?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Rename an artboard (T25/L08 — double-click its name on the canvas). */
  setArtboardLabelOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    label?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Generic layout guides (T5) — replace-whole-prop write. */
  setArtboardGuidesOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    guides?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** feature-2-print-artboards T2 — paper/orientation/bleed/margins, replace-whole-prop write. */
  setArtboardPrintOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    print?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Duplicate an element (Cmd+D) — a copy as the next sibling, whole-file undo. */
  duplicateElementOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; newId: string | null; seq?: number } | { ok: false; status: number; error: string }
  >;
  /** Delete an artboard by its `id` prop (whole-file undo seq). */
  deleteArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }>;
  /** Edit-scope verdict (local vs shared component instance) for the INV-3 badge. */
  editScopeOp(input: {
    canvas?: unknown;
    id?: unknown;
    rendered?: unknown;
  }): Promise<({ ok: true } & EditScope) | { ok: false; status: number; error: string }>;
  /** feature-4 T7a — Layers-panel component map (purple instance rows). */
  componentMapOp(input: {
    canvas?: unknown;
  }): Promise<
    | { ok: true; map: Record<string, { component: string; root: boolean; usages: number }> }
    | { ok: false; status: number; error: string }
  >;
  /** feature-4 detach-component — clone the definition + repoint ONE usage. */
  detachComponentOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; detachedName: string; seq?: number } | { ok: false; status: number; error: string }
  >;
  // Undo/redo a prior reorder by seq (Cmd+Z from the canvas undo stack). Whole-
  // file content swap from the in-memory revert log — immune to the positional
  // data-cd-id churn a reorder causes (inverse-descriptor undo would go stale).
  // Refuses (409) when the canvas changed since the reorder (external edit).
  reorderRevert(input: {
    canvas?: unknown;
    seq?: unknown;
    dir?: unknown;
  }): Promise<ReorderRevertResult>;
  // Aggregate data
  buildIndexData(): Promise<unknown>;
  buildSystemData(dsName?: string | null): Promise<unknown>;
}

export interface ApiHooks {
  /**
   * Publish a comments mutation to the SHARED DOC (and the shell's sidebar).
   *
   * `comments` is the post-mutation list, handed over IN MEMORY — issue #111.
   * The hook used to take only `file` and re-read `_comments/<slug>.json`
   * itself, which put a full disk round-trip between the mutation's write and
   * the doc publish. `Room.flush()` fires on ANY doc update (every hub update
   * re-arms it), so on a hub-linked project a flush landed inside that window,
   * projected the PRE-mutation doc back over the file, and the new comment was
   * gone before the hook's own read reached it — "only the first comment
   * stays". Passing the list removes the read, and `publishComments` awaits
   * this hook BEFORE touching disk so the doc is never the stale side.
   */
  /** `base` — the list this mutation started from (a merge hint for the project). */
  onCommentsChanged: (file: string, comments: Comment[], base?: Comment[]) => void | Promise<void>;
  /** Phase 8 Task 5 — fires after a successful PUT /_api/annotations write. */
  onAnnotationsChanged?: (file: string, svg: string, writeId?: string, base?: string) => void;
  /**
   * Accepted-revisions mode (DDR-241): propose a folder operation as ONE
   * project action before touching disk. Absent, or answering `null`, means
   * the project is not in that mode and the local operation is the whole story.
   */
  /**
   * A layout (shared meta) write, with the file text it replaced — accepted
   * revisions propose it with that base instead of inferring one.
   */
  onMetaChanged?: (file: string, text: string, baseText: string | null) => void;
  proposeFolder?: (
    op:
      | { op: 'dir.create'; path: string }
      | { op: 'dir.delete'; path: string }
      | { op: 'dir.move'; from: string; to: string }
  ) => Promise<{ status: 'accepted' | 'rejected'; code?: string; queued?: boolean }> | null;
  /**
   * feature-file-tree-drag-drop-folders (Task 3) — is a collab room pinned
   * (a shared-doc hub provider attached, DDR-064)? `moveCanvas` refuses the
   * move rather than rename a file out from under a live hub session.
   */
  isRoomPinned?: (slug: string) => boolean;
  /**
   * The MOVE protocol (codec `stampMovedTo`): stamp the slug's shared document
   * retired-to-`toRel`, push the stamp, and detach the sync provider — so the
   * move can proceed instead of being refused. On a cell EVERY canvas is
   * pinned (the studio child's own runtime holds the doc), which made the
   * pinned refusal a universal "cannot move anything in the cloud".
   * Returns false when no runtime carries the slug — the caller keeps the
   * refusal for that case (an unretired pinned room is still unsafe to move).
   */
  retireCanvasForMove?: (fromSlug: string, toRel: string) => Promise<boolean>;
  /** Flush + force-tear-down a canvas's collab room ahead of a move (best
   *  effort — a room may not be live for the slug at all). */
  flushAndDropRoom?: (slug: string) => Promise<void>;
  /** Retarget `_active.json` (active/open_tabs/selected) after a move. */
  retargetActive?: (fromFile: string, toFile: string) => void;
}

// FigJam v3 — the annotation sanitizer moved to annotations-model.ts (the
// schema owner; the allowlist guards exactly that vocabulary, and the
// headless `maude design annotate` write verb needs it without pulling the
// server modules). Re-exported here so every existing `from './api.ts'`
// import keeps working unchanged.
export { ASSET_IMAGE_HREF_RE, sanitizeAnnotationSvg } from './annotations-model.ts';

import { sanitizeAnnotationSvg } from './annotations-model.ts';

/**
 * Phase 23 — per-file ceiling for a still image. Raised 10 MB → 50 MB (still
 * well under the video cap / MAX_REQUEST_BODY headroom) after a real drone
 * photo tripped the old ceiling. Overridable via `MAUDE_ASSET_MAX_IMAGE_BYTES`
 * (bytes), mirroring {@link ASSET_MAX_VIDEO_BYTES}'s override. The route lives
 * on the (untrusted) canvas origin (DDR-088), and images stream through the
 * same category-capped writer as video/audio (`saveAssetFromStream`), so
 * raising this doesn't reintroduce the memory-amplification risk DDR-088 capped.
 */
export const ASSET_MAX_BYTES = (() => {
  const env = Number(process.env.MAUDE_ASSET_MAX_IMAGE_BYTES);
  return Number.isFinite(env) && env > 0 ? env : 50 * 1024 * 1024;
})();

/**
 * Phase 23 security review (DDR-088 follow-up) — aggregate per-server-instance
 * write budget for `/_api/asset`. Content-addressing dedupes IDENTICAL bytes,
 * but a one-byte mutation (a PNG `tEXt` chunk / a single pixel) yields a fresh
 * sha8 each time, so dedup is NOT a disk-fill defense. This caps total bytes a
 * single dev-server instance will ever write to `assets/` — generous for real
 * reference material, but bounds a scripted loop from the untrusted canvas
 * origin. Overridable via `MAUDE_ASSET_SESSION_BUDGET` (bytes) for power users.
 */
export const ASSET_SESSION_BUDGET = (() => {
  const env = Number(process.env.MAUDE_ASSET_SESSION_BUDGET);
  // DDR-148 — raised 256 MB → 1 GB now that the route accepts video/audio (one
  // 100 MB clip would blow a 256 MB budget after a couple of drops). Still an
  // aggregate per-server-instance disk-fill bound; env-overridable.
  return Number.isFinite(env) && env > 0 ? env : 1024 * 1024 * 1024;
})();

/**
 * Phase 23 — content-type sniff from the first bytes (magic numbers). The
 * declared name / extension / Content-Type is NEVER trusted — the bytes decide
 * the stored extension (a `.png` name carrying GIF bytes is stored as `.gif`).
 * SVG (XML/text) matches nothing here → returns null → rejected, so a
 * script-bearing vector can't ride in through the image route. See DDR (Task 9).
 */
export function sniffImageType(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | null {
  const b = bytes;
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG — FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  // GIF — "GIF87a" / "GIF89a"
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'gif';
  }
  // WEBP — "RIFF"????"WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export interface SaveAssetResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Relative `assets/<sha8>.<ext>` path on success. */
  path?: string;
}

/** Stage F1 — one media asset in the AssetPicker listing. */
export interface AssetListing {
  /** designRoot-relative path (`assets/<sha8>.<ext>`) — what a src/href uses. */
  path: string;
  name: string;
  ext: string;
  kind: 'image' | 'video' | 'audio';
  size: number;
  mtimeMs: number;
}

/** Phase 4 (feature-whiteboard-annotation-improvements) — one bundled sticker. */
export interface StickerItem {
  file: string;
  keywords: string[];
  /** Servable path — `/_stickers/<pack>/<file>` (main-origin static route). */
  url: string;
}

/** A bundled sticker pack — one `apps/studio/stickers/<slug>/manifest.json`. */
export interface StickerPack {
  slug: string;
  name: string;
  author: string;
  attributionUrl: string;
  license: string;
  stickers: StickerItem[];
}

/** DDR-148 — media category, decides which per-file cap applies. */
export type AssetCategory = 'image' | 'video' | 'audio';

export interface AssetTypeInfo {
  /** Stored file extension (bytes decide it, never the upload name). */
  ext: string;
  category: AssetCategory;
}

/**
 * DDR-148 — per-file ceiling for time-based media (video + audio). Images keep
 * the tighter {@link ASSET_MAX_BYTES} cap. Overridable via
 * `MAUDE_ASSET_MAX_VIDEO_BYTES` (bytes) for power users. The route lives on the
 * (untrusted) canvas origin, so this cap + the session budget + the streamed
 * write are the trust mitigation, exactly like the image caps (DDR-088).
 */
export const ASSET_MAX_VIDEO_BYTES = (() => {
  const env = Number(process.env.MAUDE_ASSET_MAX_VIDEO_BYTES);
  return Number.isFinite(env) && env > 0 ? env : 100 * 1024 * 1024;
})();

/** The byte cap for a category. */
export function assetCapForCategory(category: AssetCategory): number {
  return category === 'image' ? ASSET_MAX_BYTES : ASSET_MAX_VIDEO_BYTES;
}

const UNSUPPORTED_ASSET_MSG =
  'unsupported media type — png/jpeg/gif/webp images or mp4/mov/webm/mp3/wav/m4a media only (SVG/script rejected)';

function capError(category?: AssetCategory): string {
  if (category === 'image') {
    return `image exceeds the ${Math.round(ASSET_MAX_BYTES / (1024 * 1024))} MB cap`;
  }
  const mb = Math.round(ASSET_MAX_VIDEO_BYTES / (1024 * 1024));
  return `media exceeds the ${mb} MB cap`;
}

/** Concatenate a small list of chunks (used only for the ≤ few-KB sniff head). */
function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * DDR-148 — magic-byte type sniff for the WIDENED asset route: images (via
 * {@link sniffImageType}) PLUS time-based media. The declared name / extension
 * / Content-Type is NEVER trusted — the bytes decide the stored extension AND
 * the category (→ which cap applies). The server only sniffs; it never PARSES a
 * container (parsing happens in the sandboxed capture browser). Anything that
 * isn't a recognised raster/video/audio magic number (SVG, HTML, arbitrary
 * script) → null → rejected (415). Needs ≥ 12 bytes for the ISO-BMFF brands.
 */
export function sniffAssetType(bytes: Uint8Array): AssetTypeInfo | null {
  const img = sniffImageType(bytes);
  if (img) return { ext: img, category: 'image' };
  const b = bytes;
  // ISO-BMFF (mp4 / mov / m4a): "ftyp" box at offset 4, brand at offset 8.
  if (
    b.length >= 12 &&
    b[4] === 0x66 && // f
    b[5] === 0x74 && // t
    b[6] === 0x79 && // y
    b[7] === 0x70 // p
  ) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (brand === 'qt  ') return { ext: 'mov', category: 'video' };
    if (brand.startsWith('M4A')) return { ext: 'm4a', category: 'audio' };
    if (brand.startsWith('M4V')) return { ext: 'm4v', category: 'video' };
    // isom / mp41 / mp42 / avc1 / iso2 / iso5 / dash / mp4v / … → treat as mp4.
    return { ext: 'mp4', category: 'video' };
  }
  // Matroska / WebM — EBML header 1A 45 DF A3.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { ext: 'webm', category: 'video' };
  }
  // MP3 — "ID3" tag OR a frame-sync (0xFF followed by 0b111xxxxx).
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    return { ext: 'mp3', category: 'audio' };
  }
  if (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) {
    return { ext: 'mp3', category: 'audio' };
  }
  // WAV — "RIFF"????"WAVE".
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x41 &&
    b[10] === 0x56 &&
    b[11] === 0x45
  ) {
    return { ext: 'wav', category: 'audio' };
  }
  return null;
}

export function createApi(ctx: Context, hooks: ApiHooks): Api {
  const onCommentsChanged = hooks.onCommentsChanged;
  const onAnnotationsChanged = hooks.onAnnotationsChanged;
  const { paths, cfg } = ctx;

  // Phase 12.1 — in-memory reorder revert log (Cmd+Z for drag/keyboard moves).
  // Whole-file {before, after} per reorder, keyed by a monotonic seq the client
  // stores in its undo record. Ephemeral by design: a server restart drops it
  // (undo answers 404 and the canvas stack entry is a no-op, honest failure).
  const REORDER_LOG_CAP = 50;
  const reorderLog = new Map<
    number,
    { abs: string; before: string; after: string; undoActionId?: string }
  >();
  let reorderSeq = 0;

  // DDR-150 dogfood #1 — the SAME whole-file log backs the Timeline clip ops
  // (retime / remove / insert / z-reorder / replace-src): every successful op
  // registers its {before, after} and returns the seq; the shell keeps a
  // per-canvas undo/redo stack of seqs and replays them through
  // /_api/reorder-revert (guarded whole-file swap, 409 on divergence).
  function logUndo(abs: string, before: string, after: string): number {
    const seq = ++reorderSeq;
    reorderLog.set(seq, { abs, before, after });
    while (reorderLog.size > REORDER_LOG_CAP) {
      const oldest = reorderLog.keys().next().value;
      if (oldest === undefined) break;
      reorderLog.delete(oldest);
    }
    return seq;
  }

  // ── Structural-write throttle + source-size ceiling (G3 security, DDR-152) ──
  // The new structural verbs (delete / insert-element / insert-artboard /
  // resize-artboard) are the first that let an UNTRUSTED active canvas both
  // *remove* and *grow* its own source: the shell relays a canvas's `dgn:*`
  // request after gating only on `e.source === activeWin` — there is no user
  // gesture on the wire, so a hostile on-load script can drive these in a loop.
  // Two bounds close the disk-fill / silent-shred DoS the adversarial review
  // flagged (mirrors the ASSET_SESSION_BUDGET the /_api/asset lane already has,
  // DDR-088 — this is the OTHER untrusted-origin disk-write surface):
  //   (a) a per-api token bucket caps the sustained rate. A human does a few
  //       structural edits/sec; a scripted loop can't beat the refill, which
  //       keeps every whole-file _history snapshot + RAM undo entry rate-bound.
  //   (b) a growth op is refused once the source already exceeds
  //       MAX_CANVAS_SOURCE, so inserts can't inflate the .tsx (and the snapshot
  //       + undo copies it holds) without bound. Deletes/shrinks always pass.
  // Bucket state is per-createApi (each test/instance starts full); env-tunable.
  const STRUCTURAL_BURST = (() => {
    const env = Number(process.env.MAUDE_STRUCTURAL_BURST);
    return Number.isFinite(env) && env > 0 ? Math.floor(env) : 40;
  })();
  const STRUCTURAL_REFILL_PER_SEC = 8;
  let structuralTokens = STRUCTURAL_BURST;
  let structuralLastRefill = Date.now();
  /** Consume one token; false when the caller is over the sustained rate. */
  function takeStructuralToken(): boolean {
    const now = Date.now();
    structuralTokens = Math.min(
      STRUCTURAL_BURST,
      structuralTokens + ((now - structuralLastRefill) / 1000) * STRUCTURAL_REFILL_PER_SEC
    );
    structuralLastRefill = now;
    if (structuralTokens < 1) return false;
    structuralTokens -= 1;
    return true;
  }
  const RATE_LIMITED = {
    ok: false as const,
    status: 429,
    error: 'too many structural edits — slow down',
  };
  const MAX_CANVAS_SOURCE = (() => {
    const env = Number(process.env.MAUDE_MAX_CANVAS_SOURCE);
    return Number.isFinite(env) && env > 0 ? Math.floor(env) : 512 * 1024;
  })();

  function fileSlug(file: string): string {
    return canvasSlugFromRel(file, paths.designRel);
  }

  async function fileForSlug(slug: string): Promise<string | null> {
    // Authoritative slug → canvas-file resolver: enumerate the real canvas
    // files under each canvas group and match by the canonical slug. Unlike a
    // comments-file scan, this resolves even when the canvas has NO comments yet
    // — the fix for the receiving-peer projection gap where a fresh peer could
    // not locate the file to write the first hub-pushed comment (DDR-064).
    for (const g of cfg.canvasGroups) {
      const groupAbs = path.join(paths.designRoot, g.path);
      const groupRel = path.posix.join(paths.designRel, g.path);
      let files: string[];
      try {
        files = await findHtmlFiles(groupAbs, groupRel);
      } catch {
        continue;
      }
      for (const rel of files) {
        if (fileSlug(rel) === slug) return rel;
      }
    }
    return null;
  }

  function commentsPath(file: string): string {
    return path.join(paths.commentsDir, `${fileSlug(file)}.json`);
  }

  async function loadCommentsForFile(file: string): Promise<Comment[]> {
    try {
      const raw = await Bun.file(commentsPath(file)).text();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Phase 6 — default-fill `author` / `thread` / `mentions` for legacy
      // rows. No write-back here; the on-disk shape stays stable until the
      // next mutation persists the upgraded record.
      //
      // Deduped by comment identity first (issue #112). This is the read half
      // of the repair: a project whose `_comments/<slug>.json` was already
      // doubled by the pre-fix sync lane heals the moment it is loaded, and no
      // consumer — pins, sidebar, `/_comments`, the /design:edit agent — ever
      // sees the same comment eight times. First occurrence wins, matching the
      // rule the codec and the cold-start union use.
      return dedupeCommentsById(arr).map(backfillComment);
    } catch {
      return [];
    }
  }

  // Security (adversarial review 2026-07-30): the timeline anchor is read by
  // the /design:edit agent (edit.md §0.6b treats `lane` as navigation), and a
  // comment can arrive from an UNTRUSTED hub peer (DDR-054) via the sync-persist
  // path — which does NOT go through commentsAdd's validation. So re-clamp the
  // anchor HERE, at the read boundary every consumer (incl. /_comments served to
  // the agent) passes through: bound `lane`/`clipStableId` length, coerce frame
  // ints, and drop unknown fields — a poisoned over-long `lane` can't smuggle an
  // instruction past the 40-char label the feature is documented to carry.
  function sanitizeTimelineAnchor(raw: unknown): Comment['timeline'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const t = raw as Record<string, unknown>;
    const anchor: NonNullable<Comment['timeline']> = {};
    if (typeof t.clipStableId === 'string' && t.clipStableId.length <= 200)
      anchor.clipStableId = t.clipStableId;
    if (Number.isFinite(Number(t.frameOffset)))
      anchor.frameOffset = Math.max(0, Math.round(Number(t.frameOffset)));
    if (Number.isFinite(Number(t.frame))) anchor.frame = Math.max(0, Math.round(Number(t.frame)));
    if (typeof t.lane === 'string' && t.lane.length <= 40) anchor.lane = t.lane;
    return anchor.clipStableId != null || anchor.frame != null ? anchor : undefined;
  }

  function backfillComment(raw: unknown): Comment {
    const c = (raw ?? {}) as Partial<Comment>;
    const timeline = sanitizeTimelineAnchor((c as { timeline?: unknown }).timeline);
    return {
      ...(c as Comment),
      author: typeof c.author === 'string' ? c.author : '',
      thread: Array.isArray(c.thread) ? c.thread : [],
      mentions: Array.isArray(c.mentions) ? c.mentions : [],
      ...(timeline ? { timeline } : { timeline: undefined }),
    };
  }

  async function saveCommentsForFile(file: string, list: Comment[]) {
    // The write half of the #112 repair, and the reason it belongs HERE: this
    // is the one choke point every writer passes through — the API mutations,
    // and the collab room's `persistJson`, which materializes the Y.Array
    // straight to disk. Deduping at the door means a doc caught mid-convergence
    // (or a peer still running the old wholesale write) cannot persist a
    // duplicated list as the canvas's new truth, which is how the doubling
    // survived restarts and compounded.
    await Bun.write(commentsPath(file), JSON.stringify(dedupeCommentsById(list), null, 2));
  }

  /**
   * Land one comments mutation: SHARED DOC FIRST, disk second (issue #111).
   *
   * The order is the fix, not a style choice. Under DDR-064 the room's Y.Doc is
   * the shared object and `_comments/<slug>.json` is its projection — and
   * `Room.flush()` projects doc→file on an 800 ms trailing debounce that ANY
   * doc update re-arms, hub traffic included. So on a linked project a flush is
   * almost always pending, and any window in which the doc is behind the file
   * is a window in which that flush silently writes the older list back.
   *
   * Publishing to the doc first removes the window instead of narrowing it: a
   * flush firing at any point from here on carries a doc that already holds the
   * mutation. Both halves are awaited, so the HTTP response cannot report a
   * comment the doc never received.
   *
   * The list is deduped ONCE here so the doc and the file are handed byte-equal
   * content — otherwise the file→doc import that follows the write would see a
   * difference and re-enter the loop.
   */
  async function publishComments(file: string, list: Comment[], base?: Comment[]): Promise<void> {
    const settled = dedupeCommentsById(list);
    await onCommentsChanged(file, settled, base ? dedupeCommentsById(base) : undefined);
    await saveCommentsForFile(file, settled);
  }

  async function loadAllComments(): Promise<Record<string, Comment[]>> {
    const out: Record<string, Comment[]> = {};
    let entries: Dirent[];
    try {
      entries = await readdir(paths.commentsDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(paths.commentsDir, e.name), 'utf8');
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const file = arr[0]?.file as string | undefined;
        // Backfill legacy rows so callers see the v2 shape uniformly.
        if (file) out[file] = arr.map(backfillComment);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  function newCommentId(): string {
    return `c_${crypto.randomBytes(6).toString('hex')}`;
  }

  function newReplyId(): string {
    return `r_${crypto.randomBytes(6).toString('hex')}`;
  }

  // ---------- Git author resolution ----------
  //
  // Author defaults flow from `git config user.name` resolved against the
  // repo root. Cached for the lifetime of the process — the local git
  // identity doesn't shift mid-session and `Bun.spawn` is cheap-but-not-free.

  let cachedGitUser: string | null = null;
  let cachedGitUserAttempted = false;
  async function gitCurrentUser(): Promise<string> {
    if (cachedGitUserAttempted) return cachedGitUser ?? '';
    cachedGitUserAttempted = true;
    try {
      const proc = Bun.spawn(['git', 'config', 'user.name'], {
        cwd: paths.repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const name = out.trim();
      cachedGitUser = name || null;
    } catch {
      cachedGitUser = null;
    }
    return cachedGitUser ?? '';
  }

  // `git shortlog -sne` against the repo head — cached for 60 s so the
  // @mention popup doesn't re-fork git on every keystroke.
  let cachedCommitters: GitCommitter[] | null = null;
  let cachedCommittersAt = 0;
  async function gitCommitters(): Promise<GitCommitter[]> {
    const now = Date.now();
    if (cachedCommitters && now - cachedCommittersAt < 60_000) return cachedCommitters;
    try {
      const proc = Bun.spawn(['git', 'shortlog', '-sne', 'HEAD'], {
        cwd: paths.repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 20);
      const out: GitCommitter[] = [];
      for (const line of lines) {
        // Format: `<spaces><count>\t<name> <<email>>`
        const m = line.match(/^(\d+)\s+(.+?)\s+<([^>]+)>$/);
        if (!m) continue;
        const commits = Number(m[1]);
        const name = m[2]?.trim() ?? '';
        const email = m[3]?.trim() ?? '';
        if (!name) continue;
        out.push({ name, email, commits });
      }
      cachedCommitters = out;
      cachedCommittersAt = now;
      return out;
    } catch {
      cachedCommitters = cachedCommitters ?? [];
      cachedCommittersAt = now;
      return cachedCommitters;
    }
  }

  /**
   * Extract `@handle` tokens from free text. Deduped, returns the literal
   * `@name` form (matching what the autocomplete inserts), so a comment with
   * `"@ada @lin @ada"` collapses to `["@ada","@lin"]`.
   */
  function parseMentions(text: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    if (typeof text !== 'string' || !text) return out;
    const re = /@[\w][\w.-]*/g;
    for (const m of text.matchAll(re)) {
      const tok = m[0];
      if (!tok || seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
    }
    return out;
  }

  function mentionsUnion(c: Comment): string[] {
    const all = [c.text, ...c.thread.map((r) => r.body)].join('\n');
    return parseMentions(all);
  }

  async function commentsAdd(payload: Partial<Comment> & { file: string; text: string }) {
    if (!payload || typeof payload.file !== 'string' || !payload.file) return null;
    if (typeof payload.text !== 'string' || !payload.text.trim()) return null;
    const list = await loadCommentsForFile(payload.file);
    const base = structuredClone(list);
    const text = String(payload.text).trim().slice(0, 4000);
    const author =
      typeof payload.author === 'string' && payload.author.trim()
        ? payload.author.trim().slice(0, 120)
        : await gitCurrentUser();
    const c: Comment = {
      id: newCommentId(),
      file: payload.file,
      selector: String(payload.selector || ''),
      index: typeof payload.index === 'number' ? payload.index : undefined,
      dom_path: Array.isArray(payload.dom_path) ? payload.dom_path.slice(0, 16) : [],
      tag: String(payload.tag || ''),
      classes: String(payload.classes || ''),
      bounds: payload.bounds ?? null,
      html_excerpt: String(payload.html_excerpt || '').slice(0, 2000),
      text,
      status: 'open',
      created: new Date().toISOString(),
      resolved_at: null,
      author,
      thread: [],
      mentions: parseMentions(text),
    };
    // Task 23 — timeline anchor pass-through (validated shape only).
    const tl = payload.timeline;
    if (tl && typeof tl === 'object') {
      const anchor: NonNullable<Comment['timeline']> = {};
      if (typeof tl.clipStableId === 'string' && tl.clipStableId.length <= 200) {
        anchor.clipStableId = tl.clipStableId;
      }
      if (Number.isFinite(Number(tl.frameOffset))) {
        anchor.frameOffset = Math.max(0, Math.round(Number(tl.frameOffset)));
      }
      if (Number.isFinite(Number(tl.frame))) {
        anchor.frame = Math.max(0, Math.round(Number(tl.frame)));
      }
      // Dogfood (2026-07-30) — the C-tool records WHICH lane the click landed
      // on (storyline · V<n> overlay · A<n> audio) so an agent reading the
      // comment knows exactly where to look.
      if (
        typeof (tl as { lane?: unknown }).lane === 'string' &&
        (tl as { lane: string }).lane.length <= 40
      ) {
        anchor.lane = (tl as { lane: string }).lane;
      }
      if (anchor.clipStableId != null || anchor.frame != null) c.timeline = anchor;
    }
    list.push(c);
    await publishComments(payload.file, list, base);
    return c;
  }

  async function commentsAddReply(
    id: string,
    payload: { body: string; author?: string }
  ): Promise<Comment | null> {
    if (!payload || typeof payload.body !== 'string' || !payload.body.trim()) return null;
    const all = await loadAllComments();
    for (const [file, list] of Object.entries(all)) {
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) continue;
      const entry = list[i];
      if (!entry) continue;
      const base = structuredClone(list);
      const body = payload.body.trim().slice(0, 4000);
      const author =
        typeof payload.author === 'string' && payload.author.trim()
          ? payload.author.trim().slice(0, 120)
          : await gitCurrentUser();
      const reply: Reply = {
        id: newReplyId(),
        author,
        body,
        created: new Date().toISOString(),
      };
      entry.thread = [...entry.thread, reply];
      entry.mentions = mentionsUnion(entry);
      await publishComments(file, list, base);
      return entry;
    }
    return null;
  }

  // Mutations are ID-TOTAL, not first-match (issue #112). `loadAllComments`
  // dedupes, so under normal operation there is exactly one entry per id and
  // these behave as they always did. They stay total as defense in depth: the
  // reporter's second symptom — "I can't then close or resolve the comments" —
  // was a `findIndex` + `return` marking copy 1 of 8 resolved while the overlay
  // (which filters `status !== 'resolved'`) kept drawing the other seven, and a
  // delete removing one copy per click. A duplicated list can still reach these
  // from an older peer mid-upgrade; resolve must resolve either way.
  async function commentsPatch(id: string, patch: Partial<Comment>) {
    const all = await loadAllComments();
    for (const [file, list] of Object.entries(all)) {
      const matches = list.filter((c) => c.id === id);
      const first = matches[0];
      if (!first) continue;
      const base = structuredClone(list);
      for (const entry of matches) {
        if (patch.status === 'resolved' || patch.status === 'open') {
          entry.status = patch.status;
          entry.resolved_at = patch.status === 'resolved' ? new Date().toISOString() : null;
        }
        if (typeof patch.text === 'string' && patch.text.trim()) {
          entry.text = patch.text.trim().slice(0, 4000);
          entry.mentions = mentionsUnion(entry);
        }
      }
      await publishComments(file, list, base);
      return first;
    }
    return null;
  }

  async function commentsDelete(id: string): Promise<boolean> {
    const all = await loadAllComments();
    for (const [file, list] of Object.entries(all)) {
      const remaining = list.filter((c) => c.id !== id);
      if (remaining.length === list.length) continue;
      await publishComments(file, remaining, list);
      return true;
    }
    return false;
  }

  // ---------- Canvas state ----------

  // Cloud Phase 27 D3 — one member's place in the project is not another's.
  // `sessionDir` is a no-op without an ambient session, so a desktop resolves
  // the identical path it always did.
  function canvasStatePath(file: string): string {
    return path.join(sessionDir(paths.canvasStateDir), `${fileSlug(file)}.json`);
  }

  async function loadCanvasState(file: string) {
    try {
      const raw = await Bun.file(canvasStatePath(file)).text();
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  // ---------- Timeline media visuals cache (enhanced-video-editing Task 7) ----
  //
  // Filmstrip dataURL strips + waveform peak arrays, keyed `<sha8>:<bucket>`,
  // persisted under `_canvas-state/timeline-media/` — per-machine runtime state
  // (DDR-115; `_canvas-state/` is already on all three ignore lists, so a
  // subdirectory needs no list change).

  const TL_MEDIA_KEY_RE = /^[A-Za-z0-9._:-]{1,160}$/;

  function timelineMediaPath(key: string): string | null {
    if (!TL_MEDIA_KEY_RE.test(key) || key.includes('..')) return null;
    return path.join(paths.canvasStateDir, 'timeline-media', `${key.replaceAll(':', '__')}.json`);
  }

  async function timelineMediaLoad(key: string): Promise<Record<string, unknown> | null> {
    const p = timelineMediaPath(key);
    if (!p) return null;
    try {
      const obj = JSON.parse(await Bun.file(p).text());
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  async function timelineMediaSave(key: string, data: Record<string, unknown>): Promise<boolean> {
    const p = timelineMediaPath(key);
    if (!p) return false;
    // Shape gate (security review 2026-07-30): `strip[]` is later rendered as
    // `<img src={u}>` in the trusted shell (TimelinePanel), so persist only the
    // two known shapes — a filmstrip of `data:image/*` URLs and a numeric peak
    // array. Anything else (a poisoned `http(s)://` beacon URL, a non-array) is
    // dropped rather than cached. Defense-in-depth over the loopback guard.
    const clean: Record<string, unknown> = {};
    if (Array.isArray(data.strip)) {
      const strip = data.strip.filter(
        (u): u is string => typeof u === 'string' && /^data:image\//.test(u)
      );
      if (strip.length !== data.strip.length) return false; // reject if any entry was rejected
      clean.strip = strip;
    }
    if (Array.isArray(data.peaks)) {
      if (!data.peaks.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
      clean.peaks = data.peaks;
    }
    if (Object.keys(clean).length === 0) return false;
    try {
      await Bun.write(p, JSON.stringify(clean));
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Canvas meta sidecar (Phase 4 T5; split DDR-115) ----------
  //
  // Each canvas under `<designRoot>/ui/<name>.tsx` has a sibling
  // `<name>.meta.json` — the SHARED, versioned document (title, sections,
  // `layout` per-artboard world-coord rects, css_mode, …). The PATCH path is
  // intentionally merge-shallow on top-level keys — never clobber `title`,
  // `sections`, `ai_context`, or any other authoring metadata.
  //
  // DDR-115 — the PER-USER camera (`viewport` pan/zoom) NO LONGER lives in
  // `.meta.json`. It churns on every mouse pan/zoom, so persisting it inline
  // dirtied a tracked file. It now lives in a gitignored per-machine view file
  // (`canvasViewPath` below). PATCH splits the lanes (viewport → view file,
  // layout → meta); GET merges them back so the client (`window.__canvas_meta__`)
  // is unchanged. `last_modified` is stamped into meta ONLY on a real shared
  // (layout) change — never on a viewport-only patch.

  /**
   * Resolve `file` (a path relative to repoRoot like `.design/ui/Foo.tsx`) into
   * the absolute path of the canvas SOURCE file. Refuses traversal, paths that
   * escape repoRoot, and non-canvas extensions. Returns null on rejection.
   */
  function canvasSourceAbs(file: string): string | null {
    let p = String(file).replace(/^\/+/, '');
    try {
      p = decodeURIComponent(p);
    } catch {
      /* ignore */
    }
    if (p.includes('..')) return null;
    const abs = path.join(paths.repoRoot, p);
    if (!abs.startsWith(`${paths.repoRoot}/`)) return null;
    const ext = path.extname(abs).toLowerCase();
    if (ext !== '.tsx' && ext !== '.html') return null;
    return abs;
  }

  /**
   * Resolve `file` into the absolute path of its sibling `.meta.json` sidecar.
   * Same containment guard as `canvasSourceAbs` (refuses paths that escape
   * repoRoot / non-canvas extensions).
   */
  function canvasMetaPath(file: string): string | null {
    const abs = canvasSourceAbs(file);
    return abs ? abs.replace(/\.(tsx|html)$/i, '.meta.json') : null;
  }

  // ---------- Per-machine canvas view / camera (DDR-115) ----------
  //
  // The canvas pan/zoom ("camera") is PER-USER runtime state, separate from the
  // shared `.meta.json` document. It lives in `_canvas-state/<slug>.view.json`
  // ({ viewport }) — gitignored, swept on delete, export-excluded. DISTINCT from
  // the legacy `_canvas-state/<slug>.json` ({ sections, viewport:{x,y,scale} })
  // store: that uses `scale` clamped 0.05–8, this uses `zoom` clamped 0.02–4, so
  // overloading one file would let the two writers clobber each other's shape.

  /** Validate a candidate viewport — finite x/y, zoom clamped [0.02, 4] (the
   *  Phase 4 rule). Mirrors `ZOOM_MIN` in canvas-lib.tsx (issue #91) — keep the
   *  two floors in lockstep or a save/reload round-trip silently re-clamps a
   *  zoom the client just let the user reach. Returns the normalized viewport,
   *  or null when invalid. */
  function normalizeViewport(v: unknown): { x: number; y: number; zoom: number } | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const vv = v as { x?: unknown; y?: unknown; zoom?: unknown };
    if (
      Number.isFinite(vv.x as number) &&
      Number.isFinite(vv.y as number) &&
      Number.isFinite(vv.zoom as number)
    ) {
      const zoom = Math.min(4, Math.max(0.02, vv.zoom as number));
      return { x: vv.x as number, y: vv.y as number, zoom };
    }
    return null;
  }

  /** Per-machine view file for a canvas: `_canvas-state/<slug>.view.json`. Gated
   *  by the same containment guard as the meta sidecar (traversal / repoRoot /
   *  canvas-ext). Returns null when `file` is not a valid canvas path. */
  function canvasViewPath(file: string): string | null {
    if (!canvasMetaPath(file)) return null; // reuse the containment + ext gate
    // D3 again — the camera is the other per-machine singleton two members in
    // one cell were silently sharing.
    return path.join(sessionDir(paths.canvasStateDir), `${fileSlug(file)}.view.json`);
  }

  const MAX_OVERLAY_KEYS = 32;
  const MAX_OVERLAY_KEY_LEN = 64;

  /**
   * Validate a candidate overlay-visibility bag — feature-1-artboard-kinds-
   * foundation T6. A flat string→boolean map (`{ guides: true }`); downstream
   * plans (print bleed, web breakpoints) add their own keys without a schema
   * change here. Reachable from the untrusted canvas origin (DDR-054) via the
   * same `/_api/canvas-meta` PATCH the viewport lane already uses, so it's
   * capped the same way `set-artboard-style` caps its patch shape — bounded
   * key COUNT and key LENGTH, not just type. Empty object is valid (an
   * explicit "nothing on" state); malformed input is null (silent no-op).
   */
  function normalizeOverlays(v: unknown): Record<string, boolean> | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > MAX_OVERLAY_KEYS) return null;
    const out: Record<string, boolean> = {};
    for (const [k, val] of entries) {
      if (k.length === 0 || k.length > MAX_OVERLAY_KEY_LEN) return null;
      if (typeof val !== 'boolean') return null;
      out[k] = val;
    }
    return out;
  }

  // feature-4 T7b — per-user LOCKED layer keys (`"<cdId>:<occurrenceIndex>"`).
  // Runtime state per DDR-115 (like the camera + overlays): view.json, never the
  // versioned `.meta.json`. Reachable from the untrusted canvas origin via the
  // same PATCH lane, so shape + count are bounded.
  const MAX_LOCKED_KEYS = 500;
  const LOCKED_KEY_RE = /^[\w-]{1,64}:\d{1,4}$/;

  function normalizeLocked(v: unknown): string[] | null {
    if (!Array.isArray(v) || v.length > MAX_LOCKED_KEYS) return null;
    const out: string[] = [];
    for (const k of v) {
      if (typeof k !== 'string' || !LOCKED_KEY_RE.test(k)) return null;
      out.push(k);
    }
    return [...new Set(out)];
  }

  // Issue #91 security follow-up — `layout.artboards[]` (DDR-027 position-only
  // entries) is reachable from the untrusted canvas origin (DDR-054) via the
  // same PATCH lane as overlays/locked above, but previously had no count or
  // magnitude bound. `fit()`/`computeFit` (canvas-lib.tsx) now correctly frames
  // whatever bounding box this describes — before the zoom-floor fix, a hard
  // 0.1 zoom clamp accidentally masked an unbounded layout into a cropped,
  // mismatched view; after it, an oversized synced layout can legitimately be
  // framed whole, promoting every artboard in it to its own GPU layer at once
  // (canvas-lib.tsx `content-visibility` comment). Cap count + coordinate
  // magnitude the same way `normalizeOverlays`/`normalizeLocked` cap theirs.
  const MAX_LAYOUT_ARTBOARDS = 2000;
  const MAX_LAYOUT_COORD = 1_000_000;

  function normalizeLayoutArtboards(
    v: unknown
  ): Array<{ id: string; x: number; y: number }> | null {
    if (!Array.isArray(v) || v.length > MAX_LAYOUT_ARTBOARDS) return null;
    const out: Array<{ id: string; x: number; y: number }> = [];
    for (const entry of v) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const e = entry as { id?: unknown; x?: unknown; y?: unknown };
      if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 128) return null;
      if (
        !Number.isFinite(e.x as number) ||
        !Number.isFinite(e.y as number) ||
        Math.abs(e.x as number) > MAX_LAYOUT_COORD ||
        Math.abs(e.y as number) > MAX_LAYOUT_COORD
      ) {
        return null;
      }
      out.push({ id: e.id, x: e.x as number, y: e.y as number });
    }
    return out;
  }

  /** Raw view-file contents, tolerant of a missing/corrupt file (→ `{}`) — the
   *  read half of the read-modify-write both `saveCanvasView` and
   *  `saveCanvasOverlays` need so writing one lane never clobbers the other. */
  async function readCanvasViewRaw(file: string): Promise<Record<string, unknown>> {
    const viewAbs = canvasViewPath(file);
    if (!viewAbs) return {};
    try {
      const obj = JSON.parse(await Bun.file(viewAbs).text());
      return obj && typeof obj === 'object' && !Array.isArray(obj)
        ? (obj as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  async function loadCanvasView(file: string): Promise<{
    viewport?: { x: number; y: number; zoom: number };
    overlays?: Record<string, boolean>;
    locked?: string[];
  } | null> {
    const viewAbs = canvasViewPath(file);
    if (!viewAbs) return null;
    try {
      const obj = JSON.parse(await Bun.file(viewAbs).text());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const vp = normalizeViewport((obj as { viewport?: unknown }).viewport);
        const ov = normalizeOverlays((obj as { overlays?: unknown }).overlays);
        const lk = normalizeLocked((obj as { locked?: unknown }).locked);
        const result: {
          viewport?: { x: number; y: number; zoom: number };
          overlays?: Record<string, boolean>;
          locked?: string[];
        } = {};
        if (vp) result.viewport = vp;
        if (ov && Object.keys(ov).length > 0) result.overlays = ov;
        if (lk && lk.length > 0) result.locked = lk;
        return result;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Persist the per-user camera. Validates + clamps; best-effort (mkdir the
   *  bucket if absent). Returns the normalized viewport on write, null when the
   *  path is rejected or the viewport is invalid (no write). Read-modify-write
   *  so an existing `overlays` key in the same view file survives. */
  async function saveCanvasView(
    file: string,
    viewport: unknown
  ): Promise<{ x: number; y: number; zoom: number } | null> {
    const viewAbs = canvasViewPath(file);
    if (!viewAbs) return null;
    const vp = normalizeViewport(viewport);
    if (!vp) return null;
    try {
      await mkdir(sessionDir(paths.canvasStateDir), { recursive: true });
      const current = await readCanvasViewRaw(file);
      await Bun.write(viewAbs, `${JSON.stringify({ ...current, viewport: vp }, null, 2)}\n`);
      return vp;
    } catch {
      return null;
    }
  }

  /**
   * Persist the per-user overlay-visibility bag (T6). Shallow-merges into
   * whatever `overlays` the view file already has — a `{ guides: true }` patch
   * doesn't erase a `bleed` key a downstream print-plan toggle already set.
   * Never touches the versioned `.meta.json`. Read-modify-write so an existing
   * `viewport` key survives.
   */
  async function saveCanvasOverlays(
    file: string,
    overlays: unknown
  ): Promise<Record<string, boolean> | null> {
    const viewAbs = canvasViewPath(file);
    if (!viewAbs) return null;
    const ov = normalizeOverlays(overlays);
    if (ov === null) return null;
    try {
      await mkdir(sessionDir(paths.canvasStateDir), { recursive: true });
      const current = await readCanvasViewRaw(file);
      const prevOverlays =
        current.overlays && typeof current.overlays === 'object' && !Array.isArray(current.overlays)
          ? (current.overlays as Record<string, unknown>)
          : {};
      const merged = normalizeOverlays({ ...prevOverlays, ...ov }) ?? ov;
      await Bun.write(viewAbs, `${JSON.stringify({ ...current, overlays: merged }, null, 2)}\n`);
      return merged;
    } catch {
      return null;
    }
  }

  async function loadCanvasMeta(file: string): Promise<Record<string, unknown> | null> {
    const metaAbs = canvasMetaPath(file);
    if (!metaAbs) return null;
    let obj: Record<string, unknown> = {};
    let hadMeta = false;
    try {
      const parsed = JSON.parse(await Bun.file(metaAbs).text());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
        hadMeta = true;
      }
    } catch {
      // No meta on disk — fall through to a possible view-only result.
    }
    // DDR-115 — never surface the per-user camera or the local write-timestamp
    // from the on-disk meta: `viewport` is stale (the live camera lives in the
    // view file), `last_modified` is local bookkeeping. Strip both, then overlay
    // the current camera so the shell's `window.__canvas_meta__.viewport` still
    // restores on reload — the client stays unchanged. (`= undefined` over
    // `delete` — JSON.stringify/Response.json drop undefined keys, matching the
    // codebase convention + biome's noDelete.)
    obj.viewport = undefined;
    obj.last_modified = undefined;
    // T6 — `overlays` (per-user guide/mark visibility) is runtime state same as
    // `viewport`; a versioned `.meta.json` should never carry one (sanitizer),
    // but strip defensively before overlaying the real per-user value below.
    obj.overlays = undefined;
    // feature-4 T7b — `locked` (per-user locked layer keys) is the same class.
    obj.locked = undefined;
    const view = await loadCanvasView(file);
    if (view?.viewport) obj.viewport = view.viewport;
    if (view?.overlays) obj.overlays = view.overlays;
    if (view?.locked) obj.locked = view.locked;
    // Preserve the historic contract: no meta AND no camera/overlays → null
    // (GET → {}, PATCH-on-rejected-path → 404). A view-only canvas still
    // returns its camera/overlays.
    if (!hadMeta && !view?.viewport && !view?.overlays && !view?.locked) return null;
    return obj;
  }

  /**
   * Apply a `patch` from the (untrusted) client, splitting the two lanes
   * (DDR-115):
   *   - `viewport` → the per-machine view file (`saveCanvasView`); NEVER the
   *     versioned meta. A viewport-only patch leaves `.meta.json` byte-unchanged
   *     (no `last_modified` bump) — this is the mouse-move churn killer.
   *   - `layout`   → the shared `.meta.json`, shallow-merged so `title`,
   *     `sections`, `ai_context`, … are preserved; `last_modified` is stamped
   *     ONLY here (a real shared change the user wants committable).
   * Returns the same coherent object a GET would produce (shared meta + camera),
   * or null only when the path itself is rejected (traversal / bad ext) so the
   * route maps it to 404. A viewport-only patch on a canvas that has no meta yet
   * still succeeds (writes only the view file) and returns `{ viewport }`.
   */
  async function patchCanvasMeta(
    file: string,
    patch: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const metaAbs = canvasMetaPath(file);
    if (!metaAbs) return null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;

    // DDR-115 security (F-A2) — the PATCH lanes are reachable from the untrusted
    // canvas origin (DDR-054). Refuse to mint per-canvas state (view file or
    // `.meta.json`) for a canvas that doesn't exist, so a malicious origin can't
    // spray arbitrary-slug files/inodes via fabricated `file` paths. A valid
    // patch only ever targets a canvas the user actually has; `.meta.json` may
    // still be absent (first layout/viewport write), but the source must exist.
    const srcAbs = canvasSourceAbs(file);
    if (!srcAbs || !(await Bun.file(srcAbs).exists())) return null;

    // --- Per-user camera lane: viewport → view file, never the versioned meta.
    if (patch.viewport !== undefined) {
      if (patch.viewport === null) {
        // Explicit clear — best-effort remove the view file.
        const viewAbs = canvasViewPath(file);
        if (viewAbs) {
          try {
            await rm(viewAbs);
          } catch {
            /* absent / unreadable — nothing to clear */
          }
        }
      } else {
        // saveCanvasView validates + clamps; an invalid viewport is a silent no-op.
        await saveCanvasView(file, patch.viewport);
      }
    }

    // --- Per-user overlay-visibility lane (T6): overlays → view file, never
    // the versioned meta. Same shape as the viewport lane above — `null`
    // clears, an invalid bag is a silent no-op (normalizeOverlays → null).
    if (patch.overlays !== undefined) {
      if (patch.overlays === null) {
        const viewAbs = canvasViewPath(file);
        if (viewAbs) {
          try {
            const current = await readCanvasViewRaw(file);
            const { overlays: _drop, ...rest } = current;
            await mkdir(sessionDir(paths.canvasStateDir), { recursive: true });
            await Bun.write(viewAbs, `${JSON.stringify(rest, null, 2)}\n`);
          } catch {
            /* best-effort clear */
          }
        }
      } else {
        await saveCanvasOverlays(file, patch.overlays);
      }
    }

    // --- Per-user locked-layers lane (feature-4 T7b): locked → view file,
    // never the versioned meta. REPLACE semantics (the client sends the full
    // set — merge semantics would make unlocking impossible); `null` clears; an
    // invalid array is a silent no-op (normalizeLocked → null).
    if (patch.locked !== undefined) {
      const viewAbs = canvasViewPath(file);
      if (viewAbs) {
        try {
          const current = await readCanvasViewRaw(file);
          if (patch.locked === null) {
            const { locked: _drop, ...rest } = current;
            await mkdir(sessionDir(paths.canvasStateDir), { recursive: true });
            await Bun.write(viewAbs, `${JSON.stringify(rest, null, 2)}\n`);
          } else {
            const lk = normalizeLocked(patch.locked);
            if (lk !== null) {
              await mkdir(sessionDir(paths.canvasStateDir), { recursive: true });
              await Bun.write(viewAbs, `${JSON.stringify({ ...current, locked: lk }, null, 2)}\n`);
            }
          }
        } catch {
          /* best-effort */
        }
      }
    }

    // --- Shared document lane: layout → versioned meta, stamps last_modified. ---
    if (patch.layout !== undefined) {
      let current: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(await Bun.file(metaAbs).text());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          current = parsed as Record<string, unknown>;
        }
      } catch {
        // No existing meta — create one with just the layout key.
      }
      const next = { ...current };
      if (patch.layout === null) {
        next.layout = undefined;
      } else if (typeof patch.layout === 'object' && !Array.isArray(patch.layout)) {
        const rawLayout = patch.layout as Record<string, unknown>;
        if ('artboards' in rawLayout) {
          // Bounded — see normalizeLayoutArtboards. An oversized/malformed
          // `artboards` array is a silent no-op (leaves the prior persisted
          // layout in place), matching the overlays/locked lanes' convention.
          const artboards = normalizeLayoutArtboards(rawLayout.artboards);
          if (artboards !== null) {
            next.layout = { ...rawLayout, artboards };
          }
        } else {
          next.layout = patch.layout;
        }
      }
      // Defensive: a stale inline viewport must never persist in the versioned
      // file (the camera lane owns it now). JSON.stringify drops undefined keys.
      next.viewport = undefined;
      next.last_modified = new Date().toISOString();
      // Trailing newline — consistent with canvas-create.ts + sync/codec.ts
      // (mergeSharedMetaIntoLocal), so a layout edit doesn't churn the newline.
      const baseText = Object.keys(current).length ? JSON.stringify(current) : null;
      const nextText = `${JSON.stringify(next, null, 2)}\n`;
      await Bun.write(metaAbs, nextText);
      hooks.onMetaChanged?.(file, nextText, baseText);
      // Same reason as the annotations sidecar below, and the same bug: this
      // lane writes the FILE and nothing else, so in a cell — where there is no
      // `fs.watch` — the layout never entered the doc and never reached a peer.
      // Not "late", NEVER: a canvas `.meta.json` is `canvas-owned`, so it is
      // excluded from the journal by design and the walk-import belt behind
      // every other class does not cover it either. Dragging an artboard in the
      // cloud left every other machine showing the old position indefinitely,
      // while the same drag on a laptop crossed in seconds (a laptop watcher
      // fires) — which reads as "sync is broken one way" rather than as a
      // missing announce.
      announceWritten(path.relative(paths.designRoot, metaAbs));
    }

    // Return the merged view (shared meta + camera) — identical to GET, so the
    // client gets a coherent object regardless of which lane(s) the patch hit.
    return await loadCanvasMeta(file);
  }

  // ---------- Annotations sidecar (Phase 5) ----------
  //
  // Each canvas keeps a single `.annotations.svg` file under `<designRoot>/`
  // named by the canonical `fileSlug()`. The client posts the full SVG string
  // on every stroke commit; the server overwrites the file. SVG is bounded at
  // 1 MB (rejects larger bodies) — well above realistic annotation sizes for
  // hundreds of strokes but small enough that a malicious POST can't fill the
  // disk in one round-trip.

  function annotationsPath(file: string): string {
    return path.join(paths.designRoot, `${fileSlug(file)}.annotations.svg`);
  }

  async function loadAnnotations(file: string): Promise<string | null> {
    try {
      return await Bun.file(annotationsPath(file)).text();
    } catch {
      return null;
    }
  }

  async function saveAnnotations(
    file: string,
    svg: string,
    writeId?: string,
    base?: string
  ): Promise<boolean> {
    if (typeof svg !== 'string') return false;
    if (svg.length > 1024 * 1024) return false;
    // Cheap content gate — must look like an <svg> document. Avoids accidental
    // writes of arbitrary blobs through this endpoint.
    if (!/^\s*<svg[\s>]/i.test(svg)) return false;
    // A3 (DDR-060 F1 re-audit) — sanitize active content before persisting.
    // This endpoint is on the canvas-origin allowlist (DDR-054 "inert collab
    // write") and accepts ANY `file`, so a hub-pushed canvas can write a
    // sibling's `.annotations.svg`. The persisted SVG is currently consumed only
    // via `svgToStrokes` (DOMParser image/svg+xml → structured strokes → React
    // re-render), so a `<script>`/`on*` payload is parsed inertly and discarded
    // — the stored-XSS chain is LATENT today, not live. We sanitize anyway so
    // "inert" stays true for any future raw-render consumer and for the synced
    // file a peer/Claude-context ingests. The legit annotation vocabulary
    // (strokesToSvg) is purely presentational — path/rect/ellipse/g/line/
    // polyline/text — so stripping executable constructs is zero-regression.
    const clean = sanitizeAnnotationSvg(svg);
    // The edit's base travels only as a merge hint for the project — bounded
    // and sanitized like the value itself, never written anywhere.
    const cleanBase =
      typeof base === 'string' &&
      base.length <= 1024 * 1024 &&
      (base === '' || /^\s*<svg[\s>]/i.test(base))
        ? base === ''
          ? ''
          : sanitizeAnnotationSvg(base)
        : undefined;
    await Bun.write(annotationsPath(file), clean);
    onAnnotationsChanged?.(file, clean, writeId, cleanBase);
    // Annotations reach OTHER VIEWERS over the collab room, which is why this
    // never needed an `fs:any`. But the file is also a versioned, file-plane
    // sidecar (DDR-115), and the file plane learns about a cell's own writes
    // through exactly this event — so without it, a sticky note drawn in the
    // cloud crossed to open browsers instantly and to a peer's DISK a quarter
    // of an hour later.
    announceWritten(`${fileSlug(file)}.annotations.svg`);
    return true;
  }

  async function projectAnnotations(
    file: string,
    svg: string,
    isCurrent: () => boolean
  ): Promise<boolean> {
    if (typeof svg !== 'string' || svg.length > 1024 * 1024 || !/^\s*<svg[\s>]/i.test(svg))
      return false;
    if (!isCurrent()) return false;
    const clean = sanitizeAnnotationSvg(svg);
    // Runtime scratch stays out of the file plane. The async IO must not touch
    // the serving file until we recheck the document; another edit may have
    // arrived while Bun.write was pending. Check + rename have no await gap.
    const scratch = path.join(paths.designRoot, '_state');
    await mkdir(scratch, { recursive: true });
    const temp = path.join(scratch, `annotations-${crypto.randomUUID()}.tmp`);
    try {
      await Bun.write(temp, clean);
      if (!isCurrent()) return false;
      renameSync(temp, annotationsPath(file));
      announceWritten(`${fileSlug(file)}.annotations.svg`);
      return true;
    } finally {
      await rm(temp, { force: true });
    }
  }

  // Phase 23 — content-addressed asset write. Reachable from the (potentially
  // untrusted, DDR-054) canvas origin, so every cap is load-bearing, NOT
  // optional (DDR Task 9):
  //   • magic-byte sniff → true type ∈ {png,jpg,gif,webp}; a header lie or an
  //     SVG (script-bearing vector) is rejected — bytes decide, name is ignored.
  //   • per-category ceiling ({@link ASSET_MAX_BYTES} for images; assets get
  //     their OWN cap; never routed through the 1 MB SVG-text gate in
  //     saveAnnotations).
  //   • content-addressed name `assets/<sha8-of-bytes>.<ext>` → identical drops
  //     dedupe → a malicious canvas can't fill the disk with N copies of one
  //     image, and orphan-on-delete is safe (shared content survives).
  //   • resolved-path containment assert (defense-in-depth; the name carries no
  //     user input, but a poisoned designRoot must still not escape).
  // Running total of bytes this server instance has actually written (post-dedupe).
  let assetBytesWritten = 0;
  // S3/R2 asset lane (Cloud Phase 3 Task 2). Unconfigured by default — a local
  // project and a single-box self-hoster both work with no bucket at all.
  const assetMirror = createAssetMirror(s3ConfigFromEnv());
  if (assetMirror.configured) {
    console.log(`[assets] mirroring new assets to ${assetMirror.describe}`);
  }

  /**
   * DDR-148 — the streaming write path behind `POST /_api/asset`. Reads the
   * request body chunk-by-chunk so a 100 MB video never lands as a single
   * ArrayBuffer in RAM (the memory-amplification vector DDR-088 §review flagged
   * for the untrusted canvas origin — worse now that the per-file cap is 100 MB,
   * not a few MB). Sniffs the type from the head, applies the CATEGORY cap while
   * streaming (image {@link ASSET_MAX_BYTES} · video/audio {@link ASSET_MAX_VIDEO_BYTES}), writes
   * to a temp file, then content-addresses (sha8) → dedupe-rename. Nothing is
   * ever parsed — only magic bytes are read. `saveAsset(bytes)` wraps this so
   * both the route and any programmatic caller share ONE tested path.
   */
  /**
   * Say that a file this process wrote has landed.
   *
   * Most write paths get this for free: they arm `activity:suppress` before
   * writing, and `createContainerWriteBridge` turns that into the `fs:any` a
   * cell's `fs.watch` never fires. The asset writer does not — it streams to a
   * temp file and content-addresses the name, so there is no `rel` to suppress
   * until after the rename, by which point suppression means nothing.
   *
   * That gap was invisible while `fs:any` only drove hot-reload (the uploader
   * already knew, and other viewers reloaded eventually). It stopped being
   * invisible when the same event became how a cell tells its hub to journal a
   * write: an image dropped in the cloud got no row until the 15-minute
   * walk-import belt found it, so it reached a peer's laptop up to fifteen
   * minutes later while every other kind of edit crossed in seconds.
   *
   * WORKSPACE-MODE ONLY, on the same reasoning as the bridge: locally
   * `fs.watch` fires for this rename and a second source would double-load.
   */
  function announceWritten(rel: string): void {
    if (!isWorkspaceMode()) return;
    ctx.bus.emit('fs:any', rel);
  }

  async function saveAssetFromStream(stream: ReadableStream<Uint8Array>): Promise<SaveAssetResult> {
    const assetsDir = path.join(paths.designRoot, 'assets');
    const tmpName = `.tmp-${crypto.randomBytes(8).toString('hex')}`;
    const tmpAbs = path.join(assetsDir, tmpName);
    const hash = crypto.createHash('sha256');
    let sink: Bun.FileSink | null = null;
    let typeInfo: AssetTypeInfo | null = null;
    let cap = ASSET_MAX_VIDEO_BYTES; // provisional max until the head is sniffed
    let total = 0;
    const headChunks: Uint8Array[] = [];
    let headLen = 0;

    const cleanup = async () => {
      try {
        if (sink) await sink.end();
      } catch {
        /* sink already closed */
      }
      try {
        await rm(tmpAbs, { force: true });
      } catch {
        /* temp already gone */
      }
    };
    const flushHead = () => {
      for (const c of headChunks) {
        hash.update(c);
        sink?.write(c);
      }
      headChunks.length = 0;
      headLen = 0;
    };

    // Explicit reader (NOT `for await` — Bun's HTTP `req.body` ReadableStream
    // does not implement Symbol.asyncIterator, so async-iteration throws
    // "undefined is not a function"; getReader().read() works for every stream).
    const reader = stream.getReader();
    try {
      await mkdir(assetsDir, { recursive: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value;
        if (!chunk || chunk.length === 0) continue;
        total += chunk.length;
        if (total > cap) {
          await cleanup();
          return { ok: false, status: 413, error: capError(typeInfo?.category) };
        }
        if (!typeInfo) {
          headChunks.push(chunk);
          headLen += chunk.length;
          if (headLen >= 12) {
            typeInfo = sniffAssetType(concatBytes(headChunks));
            if (!typeInfo) {
              await cleanup(); // nothing written yet — no temp file to remove
              return { ok: false, status: 415, error: UNSUPPORTED_ASSET_MSG };
            }
            cap = assetCapForCategory(typeInfo.category);
            if (total > cap) {
              await cleanup();
              return { ok: false, status: 413, error: capError(typeInfo.category) };
            }
            sink = Bun.file(tmpAbs).writer();
            flushHead();
          }
        } else {
          hash.update(chunk);
          sink?.write(chunk);
        }
      }

      if (total === 0) {
        await cleanup();
        return { ok: false, status: 400, error: 'empty body' };
      }
      // A body shorter than 12 bytes never triggered the mid-stream sniff.
      if (!typeInfo) {
        typeInfo = sniffAssetType(concatBytes(headChunks));
        if (!typeInfo) {
          await cleanup();
          return { ok: false, status: 415, error: UNSUPPORTED_ASSET_MSG };
        }
        cap = assetCapForCategory(typeInfo.category);
        if (total > cap) {
          await cleanup();
          return { ok: false, status: 413, error: capError(typeInfo.category) };
        }
        sink = Bun.file(tmpAbs).writer();
        flushHead();
      }
      if (sink) await sink.end();

      const sha8 = hash.digest('hex').slice(0, 8);
      const name = `${sha8}.${typeInfo.ext}`;
      const fileAbs = path.join(assetsDir, name);
      // Containment backstop — the name is content-addressed (sha8 hex + sniffed
      // ext), no user-controlled segment, but assert anyway (poisoned designRoot).
      if (path.resolve(fileAbs) !== path.join(path.resolve(assetsDir), name)) {
        await rm(tmpAbs, { force: true });
        return { ok: false, status: 400, error: 'resolved asset path escapes assets dir' };
      }
      // Dedupe — identical bytes hash to the same name; drop the temp copy.
      if (await Bun.file(fileAbs).exists()) {
        await rm(tmpAbs, { force: true });
        return { ok: true, path: `assets/${name}` };
      }
      // Aggregate write budget — bounds a scripted disk-fill loop from the
      // untrusted canvas origin. Only a genuinely NEW file counts.
      if (assetBytesWritten + total > ASSET_SESSION_BUDGET) {
        await rm(tmpAbs, { force: true });
        return {
          ok: false,
          status: 429,
          error: 'asset write budget exceeded for this server session',
        };
      }
      await rename(tmpAbs, fileAbs);
      assetBytesWritten += total;
      const rel = `assets/${name}`;
      announceWritten(rel);
      // S3/R2 lane (Cloud Phase 3) — mirror the bytes so a second machine can
      // resolve them without the file riding git. Deliberately awaited but
      // never able to fail the save: the asset is already on disk, the mirror
      // is the redundant copy, and `maude hub asset-check` reconciles a miss.
      // Only a genuinely NEW file reaches here, so this is not re-uploading on
      // every dedupe hit.
      if (assetMirror.configured) {
        void assetMirror.push(rel, new Uint8Array(await Bun.file(fileAbs).arrayBuffer()));
      }
      return { ok: true, path: rel };
    } catch (err) {
      await cleanup();
      return { ok: false, status: 500, error: err instanceof Error ? err.message : 'write failed' };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  }

  async function saveAsset(bytes: Uint8Array): Promise<SaveAssetResult> {
    if (!bytes || bytes.length === 0) return { ok: false, status: 400, error: 'empty body' };
    // TS 5.7 widens a plain Uint8Array to Uint8Array<ArrayBufferLike>, which
    // BodyInit rejects (it excludes SharedArrayBuffer-backed views). These
    // bytes never are one.
    return saveAssetFromStream(
      new Response(bytes as Uint8Array<ArrayBuffer>).body as ReadableStream<Uint8Array>
    );
  }

  // Stage F1 (feature-element-editing-robustness) — list the versioned content-
  // addressed media under <designRoot>/assets/ for the AssetPicker (Replace
  // image / insert image). Read-only; returns image + video assets only (never
  // arbitrary files), newest first, capped. MAIN-ORIGIN ONLY at the route layer.
  async function listAssets(): Promise<{ ok: true; assets: AssetListing[] }> {
    const assetsDir = path.join(paths.designRoot, 'assets');
    const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
    const VID = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg']);
    // feature-ai-media-generation Phase 2 — generated audio (ElevenLabs music /
    // SFX / voiceover) is content-addressed under assets/ like any other media;
    // surface it in the picker so a generated track can be dropped into an EDL.
    const AUD = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.opus']);
    let entries: string[] = [];
    try {
      entries = await readdir(assetsDir);
    } catch {
      return { ok: true, assets: [] }; // no assets dir yet
    }
    const out: AssetListing[] = [];
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      const kind = IMG.has(ext) ? 'image' : VID.has(ext) ? 'video' : AUD.has(ext) ? 'audio' : null;
      if (!kind) continue;
      let size = 0;
      let mtimeMs = 0;
      try {
        // lstat (not stat): a symlink planted under assets/ resolves to isFile()
        // === false here → skipped. Defends the listing against a symlink that
        // would otherwise be served by the /assets/<file> static route.
        const st = await lstat(path.join(assetsDir, name));
        if (!st.isFile()) continue;
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      out.push({ path: `assets/${name}`, name, ext: ext.slice(1), kind, size, mtimeMs });
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { ok: true, assets: out.slice(0, 500) };
  }

  // feature-ai-media-generation (Task 1.2) — read a content-addressed source
  // asset's bytes + authoritative (magic-byte-SNIFFED, not extension-trusted)
  // mime, for the image-edit / image-to-video generation flows (Nano Banana
  // maskless edit reads the source into an inlineData part). The provider adapter
  // never touches the filesystem — the generation route wires this onto
  // AdapterContext.readSourceAsset. Contained to <designRoot>/assets/ (an lstat
  // isFile guard defeats a planted symlink, mirroring listAssets); returns null
  // for an unknown / traversing / oversized path. Capped at ASSET_MAX_BYTES so a
  // huge source can't be buffered into RAM before an outbound provider POST.
  async function readAssetBytes(rel: unknown): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (typeof rel !== 'string' || !rel.startsWith('assets/')) return null;
    const name = rel.slice('assets/'.length);
    if (
      !name ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('..') ||
      name.startsWith('_')
    )
      return null;
    const assetsDir = path.join(paths.designRoot, 'assets');
    const fileAbs = path.join(assetsDir, name);
    // Containment backstop — the name is validated above; assert the join anyway.
    if (path.resolve(fileAbs) !== path.join(path.resolve(assetsDir), name)) return null;
    try {
      const st = await lstat(fileAbs);
      if (!st.isFile() || st.size > ASSET_MAX_BYTES) return null;
    } catch {
      return null;
    }
    const bytes = new Uint8Array(await readFile(fileAbs));
    const info = sniffAssetType(bytes);
    if (!info) return null; // not a recognised raster/video/audio — reject
    const mime =
      info.ext === 'jpg'
        ? 'image/jpeg'
        : info.category === 'image'
          ? `image/${info.ext}`
          : info.category === 'video'
            ? `video/${info.ext}`
            : `audio/${info.ext}`;
    return { bytes, mime };
  }

  // feature-ai-media-generation (Task 2.6, DDR-164) — write a caption SIDECAR
  // (SRT/VTT text) next to a content-addressed source asset, so a CLOUD STT
  // result (ElevenLabs Scribe / Groq) lands in the SAME place the local whisper
  // path writes it: `assets/<sha8>.srt` beside `assets/<sha8>.<ext>`. Local +
  // cloud subtitles therefore live at one predictable path (the EDL caption
  // track / a video-comp `<track>` reads `assets/<sha8>.srt`). The caption text
  // is NOT run through the media magic-byte store (it isn't media) — it is a
  // versioned text sidecar, mirroring `.meta.json` / `.annotations.svg`.
  //
  // Contained to <designRoot>/assets/ exactly like readAssetBytes: the source
  // must be a validated `assets/<sha8>.<ext>` name, the format is allowlisted,
  // and the text is byte-capped. Returns the sidecar rel path or null on a bad
  // source / format.
  async function writeCaptionSidecar(
    sourceRel: unknown,
    format: unknown,
    text: unknown
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (typeof sourceRel !== 'string' || !sourceRel.startsWith('assets/'))
      return { ok: false, error: 'source must be an assets/<sha8>.<ext> path' };
    const srcName = sourceRel.slice('assets/'.length);
    if (
      !srcName ||
      srcName.includes('/') ||
      srcName.includes('\\') ||
      srcName.includes('..') ||
      srcName.startsWith('_')
    )
      return { ok: false, error: 'invalid source asset name' };
    const fmt = format === 'vtt' ? 'vtt' : format === 'srt' ? 'srt' : null;
    if (!fmt) return { ok: false, error: 'format must be srt or vtt' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty caption text' };
    if (text.length > 4 * 1024 * 1024) return { ok: false, error: 'caption text too large' };

    // Strip the source extension → `<sha8>` (or the whole name if none), append
    // the caption format. A dotless source name keeps its whole name as the base.
    const dot = srcName.lastIndexOf('.');
    const base = dot > 0 ? srcName.slice(0, dot) : srcName;
    const outName = `${base}.${fmt}`;
    const assetsDir = path.join(paths.designRoot, 'assets');
    const fileAbs = path.join(assetsDir, outName);
    if (path.resolve(fileAbs) !== path.join(path.resolve(assetsDir), outName))
      return { ok: false, error: 'resolved sidecar path escapes assets dir' };
    try {
      await mkdir(assetsDir, { recursive: true });
      await Bun.write(fileAbs, text);
      return { ok: true, path: `assets/${outName}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sidecar write failed' };
    }
  }

  // feature-ai-media-generation (Task 2.5, DDR-164) — write the AUDIO INTENT
  // sidecar (`assets/<sha8>.audio.json`) next to a generated audio asset: the
  // durable, semantic "what was this audio FOR" index that reuse-before-you-pay
  // searches. Byte-content-addressing already dedups identical outputs; this adds
  // the "do we already have a warm lo-fi loop?" lookup. Contained to assets/ like
  // the caption sidecar; the intent is inert non-secret metadata.
  async function writeAudioIntent(
    assetRel: unknown,
    meta: { kind?: string; prompt?: string; provider?: string; model?: string; at?: string }
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (typeof assetRel !== 'string' || !assetRel.startsWith('assets/'))
      return { ok: false, error: 'asset must be an assets/<sha8>.<ext> path' };
    const name = assetRel.slice('assets/'.length);
    if (
      !name ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('..') ||
      name.startsWith('_')
    )
      return { ok: false, error: 'invalid asset name' };
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const outName = `${base}.audio.json`;
    const assetsDir = path.join(paths.designRoot, 'assets');
    const fileAbs = path.join(assetsDir, outName);
    if (path.resolve(fileAbs) !== path.join(path.resolve(assetsDir), outName))
      return { ok: false, error: 'resolved sidecar path escapes assets dir' };
    const record = {
      asset: assetRel,
      kind: meta.kind,
      prompt: typeof meta.prompt === 'string' ? meta.prompt.slice(0, 8000) : undefined,
      provider: meta.provider,
      model: meta.model,
      at: meta.at ?? new Date().toISOString(),
    };
    try {
      await mkdir(assetsDir, { recursive: true });
      await Bun.write(fileAbs, `${JSON.stringify(record, null, 2)}\n`);
      return { ok: true, path: `assets/${outName}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'intent write failed' };
    }
  }

  // feature-ai-media-generation (Task 2.5) — search the project's OWN generated
  // audio by intent (keyword overlap against the recorded prompt/kind), so the
  // reuse-first path can offer an existing track before paying for a new
  // generation. Reads the `assets/<sha8>.audio.json` sidecars; ranks with the
  // shared pure scorer (generation/audio-library.ts) so local + provider-history
  // results are comparable. Best-effort — a malformed sidecar is skipped.
  async function searchAudioLibrary(query: unknown, limit = 10): Promise<AudioMatch[]> {
    if (typeof query !== 'string' || !query.trim()) return [];
    const assetsDir = path.join(paths.designRoot, 'assets');
    let entries: string[];
    try {
      entries = await readdir(assetsDir);
    } catch {
      return [];
    }
    // F2 (ethical-hacker) — an intent sidecar is a peer-synced, hence UNTRUSTED
    // (DDR-054), file: a hostile branch peer could commit a giant `.audio.json`
    // or thousands of them to OOM the reader (the F1 RAM-DoS class, on disk). A
    // real intent record is tiny → cap the per-file read AND the number scanned.
    const MAX_SIDECAR_BYTES = 256 * 1024;
    const MAX_SIDECARS = 4000;
    const candidates: Candidate[] = [];
    let scanned = 0;
    for (const name of entries) {
      if (!name.endsWith('.audio.json')) continue;
      if (++scanned > MAX_SIDECARS) break;
      try {
        const fileAbs = path.join(assetsDir, name);
        const st = await lstat(fileAbs);
        if (!st.isFile() || st.size > MAX_SIDECAR_BYTES) continue;
        const raw = await readFile(fileAbs, 'utf8');
        const intent = JSON.parse(raw) as Record<string, unknown>;
        const asset =
          typeof intent.asset === 'string'
            ? intent.asset
            : `assets/${name.replace(/\.audio\.json$/, '')}`;
        candidates.push({
          source: 'local',
          ref: asset,
          // Sanitize the peer-synced (untrusted) prompt before it can be echoed
          // into an agent context (F3).
          text: sanitizeReuseText(intent.prompt),
          kind: typeof intent.kind === 'string' ? intent.kind : undefined,
          provider: typeof intent.provider === 'string' ? intent.provider : undefined,
          at: typeof intent.at === 'string' ? intent.at : undefined,
        });
      } catch {
        /* skip a malformed sidecar */
      }
    }
    return rankMatches(query, candidates, { limit });
  }

  // Phase 4 (feature-whiteboard-annotation-improvements) — the bundled sticker
  // catalogue for the StickerPicker. Reads from MAUDE's OWN `STICKERS_DIR`
  // (paths.ts, DDR-045) — never the served project's designRoot, unlike
  // listAssets above. A pack directory missing or with an invalid
  // manifest.json is skipped, not fatal — one bad pack shouldn't blank the
  // whole picker. MAIN-ORIGIN ONLY at the route layer (the picker is shell UI,
  // same posture as listAssets/AssetPicker).
  async function listStickers(): Promise<{ ok: true; packs: StickerPack[] }> {
    let packDirs: string[] = [];
    try {
      const entries = await readdir(STICKERS_DIR, { withFileTypes: true });
      packDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return { ok: true, packs: [] }; // no bundled stickers in this layout
    }
    const packs: StickerPack[] = [];
    for (const slug of packDirs) {
      try {
        const manifestPath = path.join(STICKERS_DIR, slug, 'manifest.json');
        const raw = await readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as {
          name?: string;
          author?: string;
          attributionUrl?: string;
          license?: string;
          stickers?: Array<{ file?: string; keywords?: string[] }>;
        };
        const stickers: StickerItem[] = (manifest.stickers ?? [])
          .filter(
            (s): s is { file: string; keywords?: string[] } =>
              typeof s.file === 'string' && !!s.file
          )
          .map((s) => ({
            file: s.file,
            keywords: Array.isArray(s.keywords)
              ? s.keywords.filter((k) => typeof k === 'string')
              : [],
            url: `/_stickers/${slug}/${encodeURIComponent(s.file)}`,
          }));
        packs.push({
          slug,
          name: manifest.name ?? slug,
          author: manifest.author ?? '',
          attributionUrl: manifest.attributionUrl ?? '',
          license: manifest.license ?? '',
          stickers,
        });
      } catch {}
    }
    packs.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, packs };
  }

  // Phase 31 follow-up — persist an image pasted straight from the clipboard into
  // the ACP composer (a screenshot has no path yet), so the chip can point Claude
  // at a real file to Read. Sibling of saveAsset, but:
  //   • writes under the RUNTIME `_chat/attachments/` (gitignored — DDR-115), not
  //     the versioned `assets/`; pasted screenshots are ephemeral, not canvas media.
  //   • returns an ABSOLUTE path — Claude runs with its own cwd, so a project-
  //     relative string could miss; an absolute path always resolves.
  // Same load-bearing caps as saveAsset (magic-byte sniff → no SVG/script,
  // ASSET_MAX_BYTES, content-addressed name, shared session write budget).
  // MAIN-ORIGIN ONLY at the route layer (the untrusted canvas can't reach it).
  async function saveChatAttachment(bytes: Uint8Array): Promise<SaveAssetResult> {
    if (!bytes || bytes.length === 0) return { ok: false, status: 400, error: 'empty body' };
    if (bytes.length > ASSET_MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        error: `attachment exceeds the ${Math.round(ASSET_MAX_BYTES / (1024 * 1024))} MB cap`,
      };
    }
    const kind = sniffImageType(bytes);
    if (!kind) {
      return {
        ok: false,
        status: 415,
        error: 'unsupported image type — png/jpeg/gif/webp only (SVG rejected)',
      };
    }
    const sha8 = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const name = `${sha8}.${kind}`;
    const dir = path.join(paths.designRoot, '_chat', 'attachments');
    const fileAbs = path.join(dir, name);
    // Containment backstop — the name is content-addressed (no user input), assert anyway.
    if (path.resolve(fileAbs) !== path.join(path.resolve(dir), name)) {
      return { ok: false, status: 400, error: 'resolved attachment path escapes _chat dir' };
    }
    try {
      if (!(await Bun.file(fileAbs).exists())) {
        if (assetBytesWritten + bytes.length > ASSET_SESSION_BUDGET) {
          return {
            ok: false,
            status: 429,
            error: 'asset write budget exceeded for this server session',
          };
        }
        await mkdir(dir, { recursive: true });
        await Bun.write(fileAbs, bytes);
        assetBytesWritten += bytes.length;
      }
    } catch (err) {
      return { ok: false, status: 500, error: err instanceof Error ? err.message : 'write failed' };
    }
    return { ok: true, path: fileAbs };
  }

  // Read side of saveChatAttachment — resolve a content-addressed attachment
  // name back to its absolute path under `_chat/attachments/`, or null. The
  // name is the ONLY input and must match our own `<sha8>.<ext>` shape, so
  // traversal is impossible by construction; the resolve() assert mirrors the
  // write side's containment backstop. MAIN-ORIGIN ONLY at the route layer
  // (the untrusted canvas origin never reaches the serving route).
  async function resolveChatAttachment(name: unknown): Promise<string | null> {
    if (typeof name !== 'string' || !/^[0-9a-f]{8}\.(?:png|jpe?g|gif|webp)$/.test(name)) {
      return null;
    }
    const dir = path.join(paths.designRoot, '_chat', 'attachments');
    const fileAbs = path.join(dir, name);
    if (path.resolve(fileAbs) !== path.join(path.resolve(dir), name)) return null;
    if (!(await Bun.file(fileAbs).exists())) return null;
    return fileAbs;
  }

  // Phase 22 — create a blank brief board from the browser file tree. Wired ONLY
  // on the main origin (server.ts startMainServer); the segregated canvas origin
  // (DDR-054) never exposes this — an untrusted canvas iframe must not be able to
  // write arbitrary `.tsx` files. The single user-controlled value (`name`) is
  // gated by `validateCanvasName` (path + JSX + JSON injection boundary); `group`
  // is allowlisted to the configured canvas groups; a `resolve()` containment
  // assert is the defense-in-depth backstop.
  async function createCanvas(input: {
    name?: unknown;
    kind?: unknown;
    group?: unknown;
    // DDR-150 P4 Task 12 — video-comp assemble payload (kind === 'video-comp').
    clips?: unknown;
    fps?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<CreateCanvasResult> {
    // v1 stamps blank brief-boards + assembled video-comps — richer generation
    // stays with `/design:new` (Claude).
    const kind = input.kind == null || input.kind === '' ? 'brief-board' : input.kind;
    if (kind !== 'brief-board' && kind !== 'video-comp') {
      return { ok: false, status: 400, error: 'kind must be "brief-board" or "video-comp"' };
    }
    // Parse + validate the assemble clip list up front (video-comp only).
    const assembleClips: AssembleClip[] = [];
    if (kind === 'video-comp') {
      // Task 20 (enhanced-video-editing) — an EMPTY clips[] is the greenfield
      // "New video" flow: scaffold an editable empty comp, build the cut
      // drop-first on the Timeline.
      if (!Array.isArray(input.clips)) {
        return { ok: false, status: 400, error: 'video-comp needs a clips[] (may be empty)' };
      }
      if (input.clips.length > 60) {
        return { ok: false, status: 400, error: 'too many clips (max 60)' };
      }
      for (const raw of input.clips) {
        const c = raw as { src?: unknown; mediaKind?: unknown; durationInFrames?: unknown };
        const src = typeof c?.src === 'string' ? c.src : '';
        if (!src) return { ok: false, status: 400, error: 'each clip needs a src' };
        const mediaKind = c?.mediaKind === 'audio' ? 'audio' : 'video';
        const durationInFrames = Number.isFinite(Number(c?.durationInFrames))
          ? Math.max(1, Math.min(100000, Math.round(Number(c.durationInFrames))))
          : null;
        assembleClips.push({ src, mediaKind, durationInFrames });
      }
    }
    const v = validateCanvasName(input.name);
    if (!v.ok || !v.name || !v.componentName) {
      return { ok: false, status: 400, error: v.error ?? 'invalid name' };
    }

    // Group must be one of the configured canvas groups (+ the new-canvas dir).
    const allowed = new Set<string>(cfg.canvasGroups.map((g) => g.path));
    allowed.add(cfg.newCanvasDir || 'ui');
    const group =
      input.group == null || input.group === '' ? cfg.newCanvasDir || 'ui' : String(input.group);
    if (!allowed.has(group)) {
      return { ok: false, status: 400, error: `group must be one of: ${[...allowed].join(', ')}` };
    }

    const groupAbs = path.join(paths.designRoot, group);
    const fileAbs = path.join(groupAbs, `${v.name}.tsx`);
    // Containment backstop, two layers (Phase 22 security review F2). The name
    // regex already forbids traversal, but `group` comes from config
    // (canvasGroups[].path / newCanvasDir), which `normalizeConfig` does NOT
    // validate for `..`. So assert (1) the GROUP resolves inside designRoot —
    // a config-supplied `../../etc` must not relocate the write out of the
    // project — and (2) the file resolves inside that group. Without (1) a
    // poisoned config would be an arbitrary-directory `.tsx` write (latent today
    // because config isn't sync-scoped; closed now so a future config-sync can't
    // re-open it).
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedGroup = path.resolve(groupAbs);
    if (
      resolvedGroup !== resolvedDesignRoot &&
      !resolvedGroup.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'canvas group resolves outside the design root' };
    }
    if (
      path.resolve(fileAbs) !== path.join(resolvedGroup, `${v.name}.tsx`) ||
      !path.resolve(fileAbs).startsWith(`${resolvedGroup}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'resolved path escapes the canvas group' };
    }
    if (await Bun.file(fileAbs).exists()) {
      return {
        ok: false,
        status: 409,
        error: `a canvas named "${v.name}" already exists in ${group}`,
      };
    }

    const rel = path.posix.join(group, `${v.name}.tsx`);
    const slug = fileSlug(rel);
    const dsName = cfg.defaultDesignSystem || 'project';
    const platform = 'desktop';
    let tsx: string;
    if (kind === 'video-comp') {
      try {
        tsx = assembleCompSource(v.componentName, assembleClips, {
          fps: Number.isFinite(Number(input.fps)) ? Number(input.fps) : undefined,
          width: Number.isFinite(Number(input.width)) ? Number(input.width) : undefined,
          height: Number.isFinite(Number(input.height)) ? Number(input.height) : undefined,
          allowEmpty: assembleClips.length === 0,
        });
      } catch (err) {
        return {
          ok: false,
          status: 400,
          error: err instanceof Error ? err.message : 'assemble failed',
        };
      }
    } else {
      tsx = renderBriefBoard({
        name: v.name,
        componentName: v.componentName,
        dsName,
        platform,
        seedHint: 'Empty brief board — annotate me',
        historyDir: path.posix.join(paths.designRel, '_history', slug),
      });
    }
    const now = new Date().toISOString();
    const meta =
      kind === 'video-comp'
        ? {
            kind: 'video-comp',
            title: v.name,
            subtitle: 'assembled reel',
            brief: v.name,
            tags: ['video'],
            designSystem: dsName,
            platform,
            created: now,
            last_modified: now,
          }
        : {
            kind: 'brief-board',
            title: v.name,
            subtitle: 'brief board',
            brief: v.name,
            designSystem: dsName,
            platform,
            created: now,
            last_modified: now,
          };
    await Bun.write(fileAbs, tsx);
    await Bun.write(
      path.join(groupAbs, `${v.name}.meta.json`),
      `${JSON.stringify(meta, null, 2)}\n`
    );
    // Phase 30 — same-machine live tree refresh. Other tabs on THIS dev-server
    // re-read the (branch-scoped, on-disk) canvas list so a freshly-created
    // canvas appears without a reload. Cross-machine peers get the new canvas
    // via git "Get latest" — the file travels through git, this event is only a
    // "refresh your list" nudge for online local tabs (loopback inspector WS).
    ctx.bus.emit('canvas-list-update', { action: 'added', rel, slug });
    // The inverse of `canvas-deleted` (see deleteCanvas for why this is its own
    // event). Creating a name the project buried earlier has to lift the
    // tombstone, or every peer would dutifully trash the new canvas for as long
    // as the gravestone lives.
    ctx.bus.emit('canvas-created', { slug });
    // designRel-prefixed path — matches the file-tree `file.path` shape so the
    // client can open it directly after reloadTree().
    return { ok: true, file: path.posix.join(paths.designRel, rel), rel, slug };
  }

  async function duplicateCanvas(input: { file?: unknown }): Promise<CreateCanvasResult> {
    const raw = input?.file;
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, status: 400, error: 'file is required' };
    }
    let rel = raw.trim();
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* leave as-is */
    }
    rel = rel.replace(/^\/+/, '');
    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    if (rel.startsWith(`${drPrefix}/`)) rel = rel.slice(drPrefix.length + 1);
    if (rel.includes('..') || !/\.tsx$/i.test(rel)) {
      return { ok: false, status: 400, error: 'invalid path' };
    }
    const fileAbs = path.resolve(path.join(paths.designRoot, rel));
    const dirAbs = path.dirname(fileAbs);
    const groups = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const inGroup = groups.some((g) => {
      const gAbs = path.resolve(path.join(paths.designRoot, g.path));
      return dirAbs === gAbs || dirAbs.startsWith(`${gAbs}${path.sep}`);
    });
    if (!inGroup) {
      return {
        ok: false,
        status: 400,
        error: 'only canvases under a managed canvas group can be duplicated',
      };
    }
    if (!(await assertRealpathContained(dirAbs))) {
      return { ok: false, status: 400, error: 'source path escapes the design root via a symlink' };
    }
    if (!(await Bun.file(fileAbs).exists())) {
      return { ok: false, status: 404, error: 'canvas not found' };
    }
    const base = path.basename(rel).replace(/\.tsx$/i, '');
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    // "<name> copy", then "<name> copy 2", … — the first free, valid name.
    let name: string | null = null;
    for (let n = 1; n < 100 && !name; n++) {
      const suffix = n === 1 ? ' copy' : ` copy ${n}`;
      const v = validateCanvasName(`${base.slice(0, 60 - suffix.length)}${suffix}`);
      if (!v.ok || !v.name) return { ok: false, status: 400, error: v.error ?? 'invalid name' };
      const candidate = path.posix.join(dir, `${v.name}.tsx`);
      if (await Bun.file(path.join(paths.designRoot, candidate)).exists()) continue;
      if (await fileForSlug(fileSlug(candidate))) continue;
      name = v.name;
    }
    if (!name) return { ok: false, status: 409, error: 'too many copies of this canvas' };
    const toRel = path.posix.join(dir, `${name}.tsx`);
    const toAbs = path.join(paths.designRoot, toRel);
    await Bun.write(toAbs, await Bun.file(fileAbs).arrayBuffer());
    const metaAbs = fileAbs.replace(/\.tsx$/i, '.meta.json');
    if (await Bun.file(metaAbs).exists()) {
      let text = await Bun.file(metaAbs).text();
      try {
        const meta = JSON.parse(text) as Record<string, unknown>;
        const now = new Date().toISOString();
        if (typeof meta.title !== 'string' || meta.title === base) meta.title = name;
        meta.created = now;
        meta.last_modified = now;
        text = `${JSON.stringify(meta, null, 2)}\n`;
      } catch {
        /* an unreadable meta is copied verbatim, like the source */
      }
      await Bun.write(toAbs.replace(/\.tsx$/i, '.meta.json'), text);
    }
    const slug = fileSlug(toRel);
    // The whiteboard layer is slug-keyed at the design root (canvas-artifacts).
    const annotationsAbs = path.join(paths.designRoot, `${fileSlug(rel)}.annotations.svg`);
    if (await Bun.file(annotationsAbs).exists()) {
      await Bun.write(
        path.join(paths.designRoot, `${slug}.annotations.svg`),
        await Bun.file(annotationsAbs).arrayBuffer()
      );
    }
    ctx.bus.emit('canvas-list-update', { action: 'added', rel: toRel, slug });
    ctx.bus.emit('canvas-created', { slug });
    return { ok: true, file: path.posix.join(paths.designRel, toRel), rel: toRel, slug };
  }

  // Phase 22 — SOFT-delete a canvas (DELETE /_api/canvas). Same trust boundary as
  // createCanvas: main-origin-only, never the untrusted canvas iframe origin
  // (DDR-054). Destructive, so it MOVES the whole sidecar set to
  // `<designRoot>/_trash/<stamp>__<slug>/` (recoverable locally) instead of a hard
  // rm — pairs with the existing `_history/` + /design:rollback model. Hub
  // propagation of the delete is deliberately out of scope (Phase 26 consent).
  async function deleteCanvas(input: { file?: unknown }): Promise<DeleteCanvasResult> {
    const raw = input?.file;
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, status: 400, error: 'file is required' };
    }
    let rel = raw.trim();
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* leave as-is */
    }
    rel = rel.replace(/^\/+/, '');
    const prefix = `${paths.designRel.replace(/^\/+|\/+$/g, '')}/`;
    if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);

    // Only a real `.tsx` canvas, no traversal.
    if (rel.includes('..')) return { ok: false, status: 400, error: 'invalid path' };
    if (
      !/\.tsx$/i.test(rel) &&
      isSupportingFileRel(rel) &&
      (await isRegularFile(path.join(paths.designRoot, rel)))
    ) {
      return deleteSupportingFile(rel);
    }
    if (!/\.tsx$/i.test(rel)) {
      // feature-file-tree-drag-drop-folders (follow-up) — a non-.tsx target is
      // a folder delete (dogfood gap: the tree offered no way to remove a
      // user-created folder at all). deleteFolder does its own validation, so
      // an invalid path still reports the right error from there.
      return deleteFolder(rel);
    }

    const fileAbs = path.join(paths.designRoot, rel);
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedFile = path.resolve(fileAbs);
    if (
      resolvedFile !== resolvedDesignRoot &&
      !resolvedFile.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'path escapes the design root' };
    }

    // Must live under a NON-DS canvas group — never the design system (`system`),
    // never a loose root file (config.json, README). Deleting DS sources is not a
    // canvas operation.
    const deletable = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const inGroup = deletable.some((g) => {
      const gAbs = path.resolve(path.join(paths.designRoot, g.path));
      return resolvedFile.startsWith(`${gAbs}${path.sep}`);
    });
    if (!inGroup) {
      return {
        ok: false,
        status: 400,
        error: 'only canvases under a managed canvas group can be deleted',
      };
    }

    if (!(await Bun.file(fileAbs).exists())) {
      return { ok: false, status: 404, error: 'canvas not found' };
    }

    const slug = fileSlug(rel);
    // Filesystem-safe wall-clock stamp (no `:`) so repeated deletes of the same
    // canvas don't collide in _trash.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashDir = path.join(paths.designRoot, '_trash', `${stamp}__${slug}`);
    await mkdir(trashDir, { recursive: true });

    const trashed: string[] = [];
    const moveIfExists = async (src: string, destName: string) => {
      try {
        await statp(src); // throws if absent (works for files AND dirs)
      } catch {
        return;
      }
      try {
        await rename(src, path.join(trashDir, destName));
        trashed.push(path.relative(paths.designRoot, src));
      } catch {
        /* best-effort — a sidecar that can't move shouldn't abort the delete */
      }
    };

    // Every on-disk artifact this canvas owns — primary, same-basename
    // siblings (.meta.json/.css/.registry.json), and every slug-keyed sidecar
    // (history, canvas-state incl. the DDR-115 view file, comments, the
    // .ydoc.bin cache, annotations, footage EDL). Primary/sibling trash names
    // stay bare basenames (unchanged from before); slug-keyed sidecars flatten
    // their designRoot-relative path with `__` — both match the pre-existing
    // naming exactly, so old trash bundles and any restore tooling stay valid.
    for (const artifact of canvasArtifacts({ rel, paths })) {
      const relToDesignRoot = path.relative(paths.designRoot, artifact.abs);
      const destName =
        artifact.kind === 'slug-keyed'
          ? relToDesignRoot.split(path.sep).join('__')
          : path.basename(artifact.abs);
      await moveIfExists(artifact.abs, destName);
    }

    await Bun.write(
      path.join(trashDir, '_trash-manifest.json'),
      `${JSON.stringify({ canvas: rel, slug, deletedAt: new Date().toISOString(), trashed }, null, 2)}\n`
    );

    // Phase 30 — live tree refresh for other local tabs (see createCanvas).
    ctx.bus.emit('canvas-list-update', { action: 'removed', rel, slug });
    // A SEPARATE EVENT, DELIBERATELY. `canvas-list-update` is emitted by this
    // API *and* by the filesystem watcher, so its payload can describe a file
    // an agent or a `git checkout` produced — which is why discovery treats it
    // as a nudge and re-derives the truth itself. This one is only ever emitted
    // HERE, from a privileged route the canvas origin cannot reach, so it
    // carries something the watcher's version cannot: the user meant it. Sync
    // needs exactly that, because "gone from this disk" and "deleted from the
    // project" are different claims and only the second may travel.
    ctx.bus.emit('canvas-deleted', { slug });
    return {
      ok: true,
      rel,
      slug,
      trashed,
      trashDir: path.relative(paths.repoRoot, trashDir),
    };
  }

  // feature-file-tree-drag-drop-folders (dogfood follow-up) — delete a whole
  // FOLDER. `relDir` is already designRel-stripped (deleteCanvas's caller did
  // that normalization). Trashes every nested canvas through deleteCanvas
  // itself (same `_trash/<stamp>__<slug>/` bundle shape, so a folder delete
  // is recoverable exactly like a single-canvas delete), then best-effort
  // removes whatever's left (empty subdirs, `.gitkeep` markers).
  // ── Plan T17/L03 — supporting files ──────────────────────────────────────
  // Notes, styles, data, images, media and fonts that live in a canvas folder
  // beside the canvases. They move, rename and delete as themselves. One that a
  // canvas, stylesheet or whiteboard still names is refused with the name of
  // the file that uses it: a moved or deleted asset must never leave a broken
  // image behind silently (L17).
  async function isRegularFile(abs: string): Promise<boolean> {
    try {
      return (await statp(abs)).isFile();
    } catch {
      return false;
    }
  }

  async function supportingFileGuard(
    rel: string
  ): Promise<{ ok: true; abs: string } | { ok: false; status: number; error: string }> {
    if (rel.includes('..') || rel.startsWith('/') || isRuntimeStateRel(rel)) {
      return { ok: false, status: 400, error: 'invalid path' };
    }
    const abs = path.resolve(path.join(paths.designRoot, rel));
    const groups = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const inGroup = groups.some((g) =>
      abs.startsWith(`${path.resolve(path.join(paths.designRoot, g.path))}${path.sep}`)
    );
    if (!inGroup) {
      return {
        ok: false,
        status: 400,
        error: 'only files inside a canvas folder can be changed here',
      };
    }
    if (!(await assertRealpathContained(path.dirname(abs)))) {
      return { ok: false, status: 400, error: 'path escapes the design root via a symlink' };
    }
    if (!(await isRegularFile(abs))) return { ok: false, status: 404, error: 'file not found' };
    return { ok: true, abs };
  }

  /** The first project file (canvas, stylesheet, meta, whiteboard) that names `rel`'s file. */
  async function firstReferenceTo(rel: string): Promise<string | null> {
    const base = path.posix.basename(rel);
    const { readdir, readFile } = await import('node:fs/promises');
    const walk = async (dirAbs: string, depth: number): Promise<string | null> => {
      if (depth > 12) return null;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dirAbs, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dirAbs, e.name);
        if (e.isDirectory()) {
          const hit = await walk(abs, depth + 1);
          if (hit) return hit;
        } else if (/\.(tsx|jsx|css|meta\.json|annotations\.svg)$/i.test(e.name)) {
          const other = path.relative(paths.designRoot, abs).split(path.sep).join('/');
          if (other === rel) continue;
          const text = await readFile(abs, 'utf8').catch(() => '');
          if (text.includes(base)) return other;
        }
      }
      return null;
    };
    return walk(paths.designRoot, 0);
  }

  async function moveSupportingFile(
    rel: string,
    toDirRaw: unknown,
    toNameRaw: unknown
  ): Promise<MoveCanvasResult> {
    const g = await supportingFileGuard(rel);
    if (!g.ok) return g;
    const ext = path.posix.extname(rel);
    let base = path.posix.basename(rel);
    if (toNameRaw !== undefined && toNameRaw !== null && toNameRaw !== '') {
      const stem = String(toNameRaw).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '');
      const v = validateCanvasName(stem);
      if (!v.ok || !v.name) return { ok: false, status: 400, error: v.error ?? 'invalid name' };
      base = `${v.name}${ext}`;
    }
    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    let toDir =
      typeof toDirRaw === 'string'
        ? toDirRaw.trim().replace(/^\/+|\/+$/g, '')
        : path.posix.dirname(rel);
    if (toDir === drPrefix || toDir === '.') toDir = '';
    else if (toDir.startsWith(`${drPrefix}/`)) toDir = toDir.slice(drPrefix.length + 1);
    const toRel = path.posix.join(toDir, base);
    if (toRel === rel)
      return { ok: false, status: 400, error: 'source and destination are the same' };
    const dest = await supportingFileGuard(toRel).then((d) =>
      d.ok
        ? { ok: false as const, status: 409, error: `a file named "${base}" already exists there` }
        : d
    );
    if (!dest.ok && dest.status !== 404) return dest;
    const toAbs = path.resolve(path.join(paths.designRoot, toRel));
    if (!(await isRegularFile(path.join(paths.designRoot, rel))))
      return { ok: false, status: 404, error: 'file not found' };
    const toDirAbs = path.dirname(toAbs);
    try {
      if (!(await statp(toDirAbs)).isDirectory()) throw new Error('not a folder');
    } catch {
      return { ok: false, status: 400, error: 'destination folder does not exist' };
    }
    const user = await firstReferenceTo(rel);
    if (user) {
      return {
        ok: false,
        status: 409,
        error: `${path.posix.basename(rel)} is used by ${user} — change that first`,
      };
    }
    await rename(g.abs, toAbs);
    // A hub's own studio has no watcher to see this rename: announce both
    // ends, or the journal learns of it only from the walk-import belt and a
    // teammate waits minutes for a rename that took a second here.
    announceWritten(rel);
    announceWritten(toRel);
    ctx.bus.emit('canvas-list-update', {
      action: 'moved',
      rel: toRel,
      slug: fileSlug(toRel),
      fromRel: rel,
      fromSlug: fileSlug(rel),
    });
    return {
      ok: true,
      fromRel: rel,
      toRel,
      fromSlug: fileSlug(rel),
      toSlug: fileSlug(toRel),
      moved: [toRel],
    };
  }

  async function deleteSupportingFile(rel: string): Promise<DeleteCanvasResult> {
    const g = await supportingFileGuard(rel);
    if (!g.ok) return g;
    const user = await firstReferenceTo(rel);
    if (user) {
      return {
        ok: false,
        status: 409,
        error: `${path.posix.basename(rel)} is used by ${user} — remove it there first`,
      };
    }
    const slug = fileSlug(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashDir = path.join(paths.designRoot, '_trash', `${stamp}__${slug}`);
    await mkdir(trashDir, { recursive: true });
    const trashed = path.join(trashDir, path.posix.basename(rel));
    await rename(g.abs, trashed);
    announceWritten(rel);
    ctx.bus.emit('canvas-list-update', { action: 'removed', rel, slug });
    return {
      ok: true,
      rel,
      slug,
      trashed: [path.relative(paths.repoRoot, trashed)],
      trashDir: path.relative(paths.repoRoot, trashDir),
    };
  }

  async function deleteFolder(relDir: string): Promise<DeleteCanvasResult> {
    if (relDir.includes('..')) return { ok: false, status: 400, error: 'invalid path' };
    const dirAbs = path.join(paths.designRoot, relDir);
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedDir = path.resolve(dirAbs);
    if (
      resolvedDir !== resolvedDesignRoot &&
      !resolvedDir.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'path escapes the design root' };
    }
    try {
      const st = await statp(dirAbs);
      if (!st.isDirectory()) {
        return { ok: false, status: 400, error: 'only .tsx canvases or folders can be deleted' };
      }
    } catch {
      return { ok: false, status: 404, error: 'folder not found' };
    }

    const deletable = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const inGroup = deletable.some((g) => {
      const gAbs = path.resolve(path.join(paths.designRoot, g.path));
      return resolvedDir === gAbs || resolvedDir.startsWith(`${gAbs}${path.sep}`);
    });
    if (!inGroup) {
      return {
        ok: false,
        status: 400,
        error: 'only folders under a managed canvas group can be deleted',
      };
    }
    if (deletable.some((g) => path.resolve(path.join(paths.designRoot, g.path)) === resolvedDir)) {
      return { ok: false, status: 400, error: 'cannot delete a canvas group root' };
    }
    if (!(await assertRealpathContained(resolvedDir))) {
      return { ok: false, status: 400, error: 'path escapes the design root via a symlink' };
    }

    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    const dirRelPosix = path.posix.join(paths.designRel, relDir);
    const found = (await findHtmlFiles(dirAbs, dirRelPosix)).filter((p) => /\.tsx$/i.test(p));
    const MAX_BATCH = 50;
    if (found.length > MAX_BATCH) {
      return {
        ok: false,
        status: 400,
        error: `folder has ${found.length} canvases — the batch delete cap is ${MAX_BATCH}; delete a smaller subset`,
      };
    }
    const canvasRels = found.map((p) =>
      p.startsWith(`${drPrefix}/`) ? p.slice(drPrefix.length + 1) : p
    );

    // ONE project action for the whole folder (accepted-revisions mode): the
    // hub deletes every canvas under it and the folder entry together, so a
    // peer never sees half a folder, and history shows one step.
    const folderAction = await hooks.proposeFolder?.({
      op: 'dir.delete',
      path: relDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    });
    if (folderAction?.status === 'rejected') {
      return {
        ok: false,
        status: 409,
        error: `the project did not accept deleting this folder (${folderAction.code ?? 'rejected'})`,
      };
    }

    const trashed: string[] = [];
    let lastTrashDir = '';
    for (const r of canvasRels) {
      const result = await deleteCanvas({ file: r });
      if (result.ok) {
        trashed.push(...result.trashed);
        lastTrashDir = result.trashDir;
      }
      // best-effort — a canvas that fails to trash shouldn't abort the whole
      // folder delete; the final rm below still clears whatever's left.
    }

    try {
      await rm(dirAbs, { recursive: true, force: true });
    } catch {
      /* best-effort — a leftover empty dir isn't worth failing the op over */
    }

    ctx.bus.emit('canvas-list-update', { action: 'removed-folder', dir: dirRelPosix });
    return { ok: true, rel: relDir, slug: '', trashed, trashDir: lastTrashDir };
  }

  // feature-file-tree-drag-drop-folders (security review finding) — the
  // string-based `resolvedX.startsWith(designRoot)` containment check (used
  // throughout this file, inherited from createCanvas's original pattern)
  // does NOT follow symlinks: `path.resolve()` normalizes `..` segments but
  // never dereferences a symlink. A symlink planted INSIDE a canvas group —
  // via a malicious git peer, a hub-synced project, or just an accident —
  // pointing outside designRoot would pass every existing containment check
  // while `rename()`/`mkdir()` follow it at the OS level, writing (or
  // reading) outside the project entirely. Verified exploitable against
  // moveCanvas pre-fix: a canvas moved "into" a symlinked destination folder
  // landed on disk outside designRoot. Walks up to the deepest EXISTING
  // ancestor (a not-yet-created leaf is safe by construction — mkdir cannot
  // traverse a symlink that doesn't exist yet) and verifies ITS realpath
  // stays inside designRoot's OWN realpath — resolving BOTH sides matters:
  // on macOS `$TMPDIR` (and every sandbox test using it) sits under
  // `/var/folders/...`, itself a symlink to `/private/var/folders/...`, so
  // comparing a realpath'd candidate against a merely `path.resolve()`d root
  // false-positives on every path in a temp-dir sandbox (caught by this
  // function's own test coverage). Same symlink gap likely pre-exists in
  // createCanvas/deleteCanvas's original containment checks — out of scope
  // for this feature to fix retroactively, flagged in DDR-198 as a follow-up.
  async function realpathOfDeepestExisting(targetAbs: string): Promise<string | null> {
    let probe = targetAbs;
    for (;;) {
      try {
        return path.resolve(await realpath(probe));
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) return null; // walked to the filesystem root, found nothing
        probe = parent;
      }
    }
  }

  async function assertRealpathContained(targetAbs: string): Promise<boolean> {
    const realRoot = await realpathOfDeepestExisting(path.resolve(paths.designRoot));
    const realTarget = await realpathOfDeepestExisting(targetAbs);
    if (realRoot === null || realTarget === null) return false;
    return realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`);
  }

  /**
   * Re-root a moved canvas's relative imports for its new folder depth
   * (issue #114). `fromDir` / `toDir` are POSIX, design-root-relative.
   *
   * Runs AFTER the rename, on the file at its destination. Best-effort by
   * design: the move has already committed, and failing it here would leave a
   * half-moved tree — strictly worse than the un-rewritten imports that were
   * the status quo. A no-op rewrite writes nothing.
   */
  async function rewriteCanvasImports(abs: string, fromDir: string, toDir: string): Promise<void> {
    if (fromDir === toDir) return;
    try {
      // NEVER DEREFERENCE A SYMLINK HERE. The move's containment checks cover
      // the source *directory* (`assertRealpathContained(path.dirname(...))`)
      // and the destination, but never the source FILE — which was inert while
      // the move was a bare `rename()`, because renaming a symlink moves the
      // LINK and no out-of-root byte is ever touched. This function is the
      // first code on the path that reads and writes the file's contents, so
      // without this guard a planted `ui/evil.tsx -> /elsewhere/secrets.ts`
      // would turn an ordinary drag-and-drop into an out-of-root read AND an
      // out-of-root write. `lstat` does not follow; a link is skipped, not
      // repaired — its target is not ours to rewrite.
      const st = await lstat(abs);
      if (!st.isFile()) return;
      const source = await readFile(abs, 'utf8');
      const next = rewriteRelativeImports(source, fromDir, toDir);
      // atomicWrite, not `writeFile` — this lands on a `.tsx` the fs-mirror is
      // watching, so a truncate-then-write can surface a partial-content watch
      // event (the exact hazard atomic-write.ts was built for), and a crash
      // mid-write would leave a truncated canvas.
      if (next !== source) atomicWrite(abs, next);
    } catch (err) {
      console.warn(
        `[move] could not rewrite relative imports in ${abs}: ${(err as Error).message}`
      );
    }
  }

  // feature-file-tree-drag-drop-folders (Task 3) — move/rename a canvas + its
  // full artifact set (POST /_api/fs-move). Same main-origin-only trust
  // boundary as createCanvas/deleteCanvas (DDR-054): never reachable from the
  // untrusted canvas iframe. NOT atomic across artifacts — a crash mid-loop
  // leaves a partial state; the primary `.tsx` moves FIRST (so the tree is
  // never wrong about where the canvas lives) and every relocation is logged
  // to `_history/<toSlug>/_move.json` for forensic recovery. See the DDR
  // (Task 14) for the accepted-limitation writeup.
  async function moveCanvas(input: {
    file?: unknown;
    toDir?: unknown;
    toName?: unknown;
  }): Promise<MoveCanvasResult> {
    const raw = input?.file;
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, status: 400, error: 'file is required' };
    }
    let rel = raw.trim();
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* leave as-is */
    }
    rel = rel.replace(/^\/+/, '');
    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    if (rel.startsWith(`${drPrefix}/`)) rel = rel.slice(drPrefix.length + 1);
    if (rel.includes('..')) return { ok: false, status: 400, error: 'invalid path' };
    if (!/\.tsx$/i.test(rel)) {
      // Plan T17/L03 — a supporting file (notes, styles, images, media in a
      // canvas folder) moves or renames as itself, never as a "folder".
      if (isSupportingFileRel(rel) && (await isRegularFile(path.join(paths.designRoot, rel)))) {
        return moveSupportingFile(rel, input?.toDir, input?.toName);
      }
      // feature-file-tree-drag-drop-folders (Task 11) — a non-.tsx source is a
      // folder move (dragging a folder onto a folder). moveFolder does its own
      // existence + containment validation, so an invalid path still reports
      // the right error from there.
      return moveFolder(rel, input?.toDir, input?.toName);
    }

    // A rename is a move in place under a new name (`toName`, same allowlist as
    // a new canvas's name); `toDir` defaults to the canvas's own folder then.
    let newBase: string | null = null;
    if (input?.toName !== undefined && input.toName !== null && input.toName !== '') {
      const v = validateCanvasName(input.toName);
      if (!v.ok || !v.name) return { ok: false, status: 400, error: v.error ?? 'invalid name' };
      newBase = `${v.name}.tsx`;
    }
    const toDirInput =
      typeof input?.toDir === 'string'
        ? input.toDir
        : newBase
          ? path.posix.dirname(rel) === '.'
            ? ''
            : path.posix.dirname(rel)
          : null;
    if (typeof toDirInput !== 'string') {
      return { ok: false, status: 400, error: 'toDir is required' };
    }
    let toDir = toDirInput.trim().replace(/^\/+|\/+$/g, '');
    try {
      toDir = decodeURIComponent(toDir);
    } catch {
      /* leave as-is */
    }
    if (toDir === drPrefix) toDir = '';
    else if (toDir.startsWith(`${drPrefix}/`)) toDir = toDir.slice(drPrefix.length + 1);
    if (toDir.includes('..')) return { ok: false, status: 400, error: 'invalid destination' };

    const fileAbs = path.join(paths.designRoot, rel);
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedFile = path.resolve(fileAbs);
    if (
      resolvedFile !== resolvedDesignRoot &&
      !resolvedFile.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'source path escapes the design root' };
    }

    // Two-layer containment + non-DS group membership, for BOTH source and
    // destination — the exact predicate deleteCanvas uses for the source.
    const deletable = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const withinAGroup = (abs: string) =>
      deletable.some((g) => {
        const gAbs = path.resolve(path.join(paths.designRoot, g.path));
        return abs === gAbs || abs.startsWith(`${gAbs}${path.sep}`);
      });
    if (!withinAGroup(path.dirname(resolvedFile))) {
      return {
        ok: false,
        status: 400,
        error: 'only canvases under a managed canvas group can be moved',
      };
    }
    if (!(await assertRealpathContained(path.dirname(resolvedFile)))) {
      return { ok: false, status: 400, error: 'source path escapes the design root via a symlink' };
    }

    const toDirAbs = path.join(paths.designRoot, toDir);
    const resolvedToDir = path.resolve(toDirAbs);
    if (
      resolvedToDir !== resolvedDesignRoot &&
      !resolvedToDir.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'destination resolves outside the design root' };
    }
    if (!withinAGroup(resolvedToDir)) {
      return {
        ok: false,
        status: 400,
        error: 'destination must be inside a managed canvas group',
      };
    }
    if (!(await assertRealpathContained(resolvedToDir))) {
      return {
        ok: false,
        status: 400,
        error: 'destination resolves outside the design root via a symlink',
      };
    }

    if (!(await Bun.file(fileAbs).exists())) {
      return { ok: false, status: 404, error: 'canvas not found' };
    }

    const base = newBase ?? path.basename(rel);
    const toRel = path.posix.join(toDir, base);
    if (path.posix.normalize(toRel) === path.posix.normalize(rel)) {
      return { ok: false, status: 400, error: 'source and destination are the same' };
    }
    const toAbs = path.join(paths.designRoot, toRel);
    if (await Bun.file(toAbs).exists()) {
      return {
        ok: false,
        status: 409,
        error: `a canvas named "${base.replace(/\.tsx$/i, '')}" already exists in ${toDir || '.'}`,
      };
    }

    const fromSlug = fileSlug(rel);
    const toSlug = fileSlug(toRel);

    // Slug-collision guard (security review finding) — canvasSlugFromRel's
    // `/`→`-` flattening is not injective: "ui/a-b.tsx" and "ui/a/b.tsx" both
    // hash to "ui-a-b". Without this check, moving a canvas into a directory
    // that happens to collide with another canvas's slug would silently
    // clobber that OTHER canvas's history/comments/annotations/camera the
    // moment the primary rename lands (the "primary moves first" ordering
    // that makes a crash mid-move recoverable also means the file path check
    // above — which only looks at the DESTINATION FILE PATH, not the slug —
    // is not sufficient on its own). Reuses the same authoritative
    // slug→file resolver `fileForSlug` uses for comment routing (DDR-064).
    const slugCollision = await fileForSlug(toSlug);
    if (slugCollision) {
      let collisionRel = slugCollision;
      if (collisionRel.startsWith(`${drPrefix}/`))
        collisionRel = collisionRel.slice(drPrefix.length + 1);
      if (collisionRel !== rel) {
        return {
          ok: false,
          status: 409,
          error: `moving here would collide with "${collisionRel}"'s slug ("${toSlug}") — rename one of them first`,
        };
      }
    }

    // Collab guard — a pinned room (shared-doc hub provider attached, DDR-064)
    // must not have its file renamed out from under it. The old behaviour was
    // to REFUSE, which on a cell meant moving was impossible outright: cell
    // pairing pins every canvas, so a guard written for a rare local state
    // fired on 100% of cloud moves. Now the move COORDINATES: the sync runtime
    // stamps the document retired-to-the-new-path (the move protocol, codec
    // stampMovedTo) and detaches — after which the rename is exactly as safe
    // as on an unpinned desktop. The refusal remains only for the case where
    // no runtime can do that, because then the pin really is unownable here.
    if (hooks.isRoomPinned?.(fromSlug)) {
      const retired = (await hooks.retireCanvasForMove?.(fromSlug, toRel)) ?? false;
      if (!retired) {
        return {
          ok: false,
          status: 409,
          error: 'canvas has a live shared session — cannot move while pinned to the hub',
        };
      }
    } else {
      // An unpinned canvas may still have a live synced document (the desktop
      // agent lane pins nothing) — retire it too, or the old document lives on
      // and re-materialises the canvas at its old path on every machine.
      await hooks.retireCanvasForMove?.(fromSlug, toRel);
    }
    await hooks.flushAndDropRoom?.(fromSlug);

    // Primary `.tsx` moves FIRST — abort the whole op if this fails so the
    // tree is never wrong about where the canvas lives.
    await mkdir(toDirAbs, { recursive: true });
    try {
      await rename(fileAbs, toAbs);
    } catch (err) {
      return { ok: false, status: 500, error: err instanceof Error ? err.message : 'move failed' };
    }

    // The canvas is at a new depth now, so its relative specifiers point at the
    // wrong place (issue #114). Bytes used to move without them, and the canvas
    // 500s on the next build with `Could not resolve`. Best-effort: the move
    // itself already succeeded, and a rewrite failure must not leave the tree
    // half-moved — it leaves a build error the user can fix by hand, which is
    // exactly where they were before this existed.
    await rewriteCanvasImports(toAbs, path.posix.dirname(rel), path.posix.dirname(toRel));

    const moved: string[] = [path.relative(paths.repoRoot, toAbs)];
    for (const artifact of canvasArtifacts({ rel, paths })) {
      if (artifact.kind === 'primary') continue; // already moved above
      if (artifact.carryOnMove === false) {
        // The old slug's CRDT cache — carrying it would hand the new document
        // the retirement stamp we just wrote. Drop it; the canvas is on disk.
        // A FILE, not a tree: `recursive` would turn a future slug regression
        // into a directory delete, and this path is only ever one cache file.
        await rm(artifact.abs, { force: true }).catch((err) => {
          console.warn(`[move] could not drop the stale doc cache: ${(err as Error).message}`);
        });
        continue;
      }
      const dest = relocatedName(artifact, rel, toRel, paths);
      if (path.resolve(dest) === path.resolve(artifact.abs)) continue;
      try {
        await statp(artifact.abs); // throws if absent — best-effort, most sidecars won't exist
      } catch {
        continue;
      }
      try {
        await mkdir(path.dirname(dest), { recursive: true });
        await rename(artifact.abs, dest);
        moved.push(path.relative(paths.repoRoot, dest));
      } catch {
        /* best-effort — a sidecar that can't relocate shouldn't abort the move */
      }
    }

    // Re-key the `_locator.json` entry (the DIVERGENT slug shape) under its
    // own per-path mutex.
    const locatorAbs = path.join(paths.designRoot, '_locator.json');
    const fromKey = locatorKeyFor(rel);
    const toKey = locatorKeyFor(toRel);
    try {
      const map = await readLocator(locatorAbs, fromKey);
      if (map) {
        await writeLocator(locatorAbs, toKey, map);
        await clearLocatorSlug(locatorAbs, fromKey);
      }
    } catch {
      /* best-effort — a stale locator entry re-derives on next transpile */
    }

    // Retarget `_active.json` (active canvas / open tabs / selection) if this
    // canvas was referenced anywhere in it.
    const fromFile = path.posix.join(paths.designRel, rel);
    const toFile = path.posix.join(paths.designRel, toRel);
    hooks.retargetActive?.(fromFile, toFile);

    // Forensic log for the non-atomic move — see the doc comment above.
    try {
      const toHistoryDir = path.join(paths.historyDir, toSlug);
      await mkdir(toHistoryDir, { recursive: true });
      await Bun.write(
        path.join(toHistoryDir, '_move.json'),
        `${JSON.stringify(
          { fromRel: rel, toRel, fromSlug, toSlug, moved, movedAt: new Date().toISOString() },
          null,
          2
        )}\n`
      );
    } catch {
      /* forensic log only — never block the move on it */
    }

    ctx.bus.emit('canvas-list-update', {
      action: 'moved',
      rel: toRel,
      slug: toSlug,
      fromRel: rel,
      fromSlug,
    });

    return { ok: true, fromRel: rel, toRel, fromSlug, toSlug, moved };
  }

  // feature-file-tree-drag-drop-folders (Task 11) — move a whole FOLDER
  // (dragging a folder onto a folder). `relDir` is already designRel-stripped
  // (moveCanvas's caller did that normalization). One native directory
  // `rename()` relocates the primary `.tsx` + same-dir siblings for EVERY
  // nested canvas at once (they live inside the moved directory); only the
  // slug-keyed sidecars (flat dirs like `_history/<slug>/`, not nested by
  // folder structure) need their own per-canvas relocation afterward.
  async function moveFolder(
    relDir: string,
    toDirRaw: unknown,
    toNameRaw?: unknown
  ): Promise<MoveCanvasResult> {
    if (relDir.includes('..')) return { ok: false, status: 400, error: 'invalid path' };
    const dirAbs = path.join(paths.designRoot, relDir);
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedDir = path.resolve(dirAbs);
    if (
      resolvedDir !== resolvedDesignRoot &&
      !resolvedDir.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'source path escapes the design root' };
    }
    try {
      const st = await statp(dirAbs);
      if (!st.isDirectory()) {
        return { ok: false, status: 400, error: 'only .tsx canvases or folders can be moved' };
      }
    } catch {
      return { ok: false, status: 404, error: 'folder not found' };
    }

    const deletable = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const withinAGroup = (abs: string) =>
      deletable.some((g) => {
        const gAbs = path.resolve(path.join(paths.designRoot, g.path));
        return abs === gAbs || abs.startsWith(`${gAbs}${path.sep}`);
      });
    if (!withinAGroup(resolvedDir)) {
      return {
        ok: false,
        status: 400,
        error: 'only folders under a managed canvas group can be moved',
      };
    }
    if (deletable.some((g) => path.resolve(path.join(paths.designRoot, g.path)) === resolvedDir)) {
      return { ok: false, status: 400, error: 'cannot move a canvas group root' };
    }
    if (!(await assertRealpathContained(resolvedDir))) {
      return { ok: false, status: 400, error: 'source path escapes the design root via a symlink' };
    }

    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    let toDir = typeof toDirRaw === 'string' ? toDirRaw.trim().replace(/^\/+|\/+$/g, '') : '';
    try {
      toDir = decodeURIComponent(toDir);
    } catch {
      /* leave as-is */
    }
    if (toDir === drPrefix) toDir = '';
    else if (toDir.startsWith(`${drPrefix}/`)) toDir = toDir.slice(drPrefix.length + 1);
    if (toDir.includes('..')) return { ok: false, status: 400, error: 'invalid destination' };

    const toDirAbs = path.join(paths.designRoot, toDir);
    const resolvedToDir = path.resolve(toDirAbs);
    if (
      resolvedToDir !== resolvedDesignRoot &&
      !resolvedToDir.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'destination resolves outside the design root' };
    }
    if (!withinAGroup(resolvedToDir)) {
      return { ok: false, status: 400, error: 'destination must be inside a managed canvas group' };
    }
    if (!(await assertRealpathContained(resolvedToDir))) {
      return {
        ok: false,
        status: 400,
        error: 'destination resolves outside the design root via a symlink',
      };
    }
    // Refuse a move into itself or a descendant of itself.
    if (resolvedToDir === resolvedDir || resolvedToDir.startsWith(`${resolvedDir}${path.sep}`)) {
      return { ok: false, status: 400, error: 'cannot move a folder into itself' };
    }

    // A RENAME is a move to a new name in the same (or another) parent — one
    // manifest action (dir.move), the same as any folder move (plan T17).
    let base = path.basename(relDir);
    if (toNameRaw !== undefined && toNameRaw !== null && toNameRaw !== '') {
      const v = validateFolderName(toNameRaw);
      if (!v.ok || !v.name) return { ok: false, status: 400, error: v.error ?? 'invalid name' };
      base = v.name;
    }
    const toRelDir = path.posix.join(toDir, base);
    if (path.posix.normalize(toRelDir) === path.posix.normalize(relDir)) {
      return { ok: false, status: 400, error: 'source and destination are the same' };
    }
    const toDirFinalAbs = path.join(paths.designRoot, toRelDir);
    try {
      await statp(toDirFinalAbs);
      return { ok: false, status: 409, error: `"${base}" already exists in ${toDir || '.'}` };
    } catch {
      /* good — doesn't exist yet */
    }

    // Enumerate every .tsx canvas under this folder (recursive) BEFORE the
    // rename, so each one's from/to rel is computed against the OLD tree
    // shape. `.html` legacy canvases are out of scope, same as moveCanvas.
    const dirRelPosix = path.posix.join(paths.designRel, relDir);
    const found = (await findHtmlFiles(dirAbs, dirRelPosix)).filter((p) => /\.tsx$/i.test(p));
    const MAX_BATCH = 50;
    if (found.length > MAX_BATCH) {
      return {
        ok: false,
        status: 400,
        error: `folder has ${found.length} canvases — the batch move cap is ${MAX_BATCH}; move a smaller subset`,
      };
    }
    const canvasRels = found.map((p) =>
      p.startsWith(`${drPrefix}/`) ? p.slice(drPrefix.length + 1) : p
    );

    // Slug-collision guard, per nested canvas — same rationale as
    // moveCanvas's (canvasSlugFromRel's `/`→`-` flattening is not injective).
    // Excludes collisions AMONG the batch itself (those canvases are moving
    // together, not being clobbered by an outsider) but refuses if any
    // destination slug already belongs to a canvas OUTSIDE this move.
    const batchRelSet = new Set(canvasRels);
    for (const r of canvasRels) {
      const toRel = toRelDir + r.slice(relDir.length);
      const toSlug = fileSlug(toRel);
      const collision = await fileForSlug(toSlug);
      if (collision) {
        let collisionRel = collision;
        if (collisionRel.startsWith(`${drPrefix}/`))
          collisionRel = collisionRel.slice(drPrefix.length + 1);
        if (!batchRelSet.has(collisionRel)) {
          return {
            ok: false,
            status: 409,
            error: `moving "${path.basename(r)}" would collide with "${collisionRel}"'s slug ("${toSlug}") — rename one of them first`,
          };
        }
      }
    }

    // ONE project action for the whole folder (accepted-revisions mode) —
    // canvases, empty sub-folders and all. The per-canvas retire below then
    // only lets go locally; it proposes nothing of its own.
    const folderMove = await hooks.proposeFolder?.({
      op: 'dir.move',
      from: relDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      to: toRelDir,
    });
    if (folderMove?.status === 'rejected') {
      return {
        ok: false,
        status: 409,
        error: `the project did not accept this move (${folderMove.code ?? 'rejected'})`,
      };
    }

    // Collab guard for every canvas found, BEFORE any disk mutation. Same
    // coordinated retire as moveCanvas — refuse only when a pinned room could
    // not be retired, and retire even unpinned synced documents so none of
    // them lives on to resurrect its canvas at the old path.
    for (const r of canvasRels) {
      const slug = fileSlug(r);
      const toRel = toRelDir + r.slice(relDir.length);
      const retired = (await hooks.retireCanvasForMove?.(slug, toRel)) ?? false;
      if (!retired && hooks.isRoomPinned?.(slug)) {
        return {
          ok: false,
          status: 409,
          error: `"${path.basename(r)}" has a live shared session — cannot move the folder while it's pinned to the hub`,
        };
      }
    }
    for (const r of canvasRels) {
      await hooks.flushAndDropRoom?.(fileSlug(r));
    }

    await mkdir(toDirAbs, { recursive: true });
    // OUR OWN ACTION MAY ALREADY BE ON THIS DISK. The destination did not exist
    // when this move was checked; the project accepted the move since, and its
    // announcement can reach this machine's sync before the answer reaches this
    // request — which materializes the destination folders (each with its
    // `.gitkeep`). Renaming onto that non-empty placeholder failed (ENOTEMPTY),
    // leaving the old folder in this person's tree while every teammate had
    // the move (plan T31/L02). A destination holding nothing but placeholders
    // is that projection; it is replaced, never merged into.
    if (await onlyFolderPlaceholders(toDirFinalAbs)) {
      await rm(toDirFinalAbs, { recursive: true, force: true });
    }
    try {
      await rename(dirAbs, toDirFinalAbs);
    } catch (err) {
      return { ok: false, status: 500, error: err instanceof Error ? err.message : 'move failed' };
    }

    const moved: string[] = [path.relative(paths.repoRoot, toDirFinalAbs)];
    const locatorAbs = path.join(paths.designRoot, '_locator.json');
    for (const fromRel of canvasRels) {
      const toRel = toRelDir + fromRel.slice(relDir.length);
      const fromSlug = fileSlug(fromRel);
      const toSlug = fileSlug(toRel);
      // Same depth change as moveCanvas, once per nested canvas (issue #114).
      // A folder move relocates every canvas inside it by the same delta, but
      // each one's own dir differs, so the rewrite is per file, not per folder.
      await rewriteCanvasImports(
        path.join(paths.designRoot, toRel),
        path.posix.dirname(fromRel),
        path.posix.dirname(toRel)
      );
      for (const artifact of canvasArtifacts({ rel: fromRel, paths })) {
        if (artifact.kind !== 'slug-keyed') continue; // primary/siblings already moved with the dir
        const dest = relocatedName(artifact, fromRel, toRel, paths);
        if (path.resolve(dest) === path.resolve(artifact.abs)) continue;
        try {
          await statp(artifact.abs);
        } catch {
          continue;
        }
        try {
          await mkdir(path.dirname(dest), { recursive: true });
          await rename(artifact.abs, dest);
          moved.push(path.relative(paths.repoRoot, dest));
        } catch {
          /* best-effort */
        }
      }
      const fromKey = locatorKeyFor(fromRel);
      const toKey = locatorKeyFor(toRel);
      try {
        const map = await readLocator(locatorAbs, fromKey);
        if (map) {
          await writeLocator(locatorAbs, toKey, map);
          await clearLocatorSlug(locatorAbs, fromKey);
        }
      } catch {
        /* best-effort */
      }
      const fromFile = path.posix.join(paths.designRel, fromRel);
      const toFile = path.posix.join(paths.designRel, toRel);
      hooks.retargetActive?.(fromFile, toFile);
      try {
        const toHistoryDir = path.join(paths.historyDir, toSlug);
        await mkdir(toHistoryDir, { recursive: true });
        await Bun.write(
          path.join(toHistoryDir, '_move.json'),
          `${JSON.stringify(
            {
              fromRel,
              toRel,
              fromSlug,
              toSlug,
              folderMove: true,
              movedAt: new Date().toISOString(),
            },
            null,
            2
          )}\n`
        );
      } catch {
        /* forensic log only */
      }
      ctx.bus.emit('canvas-list-update', {
        action: 'moved',
        rel: toRel,
        slug: toSlug,
        fromRel,
        fromSlug,
      });
    }

    return { ok: true, fromRel: relDir, toRel: toRelDir, fromSlug: '', toSlug: '', moved };
  }

  // feature-file-tree-drag-drop-folders (Task 4) — create an empty folder
  // inside a canvas group (POST /_api/fs-mkdir). Git can't track an empty
  // directory, so a `.gitkeep` goes in immediately — without it a
  // collaborator's `git pull` never materializes the folder. Same
  // main-origin-only / non-DS-group / two-layer-containment posture as
  // createCanvas/moveCanvas.
  async function createFolder(input: {
    parent?: unknown;
    name?: unknown;
  }): Promise<CreateFolderResult> {
    const v = validateFolderName(input?.name);
    if (!v.ok || !v.name) {
      return { ok: false, status: 400, error: v.error ?? 'invalid name' };
    }

    let parent = typeof input?.parent === 'string' ? input.parent.trim() : '';
    parent = parent.replace(/^\/+|\/+$/g, '');
    const drPrefix = paths.designRel.replace(/^\/+|\/+$/g, '');
    if (parent === drPrefix) parent = '';
    else if (parent.startsWith(`${drPrefix}/`)) parent = parent.slice(drPrefix.length + 1);
    if (parent.includes('..')) return { ok: false, status: 400, error: 'invalid parent' };

    const parentAbs = path.join(paths.designRoot, parent);
    const resolvedDesignRoot = path.resolve(paths.designRoot);
    const resolvedParent = path.resolve(parentAbs);
    if (
      resolvedParent !== resolvedDesignRoot &&
      !resolvedParent.startsWith(`${resolvedDesignRoot}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'parent resolves outside the design root' };
    }
    const deletable = cfg.canvasGroups.filter(
      (g) => g.label !== 'Design system' && !/^system(\/|$)/.test(g.path)
    );
    const withinAGroup = deletable.some((g) => {
      const gAbs = path.resolve(path.join(paths.designRoot, g.path));
      return resolvedParent === gAbs || resolvedParent.startsWith(`${gAbs}${path.sep}`);
    });
    if (!withinAGroup) {
      return { ok: false, status: 400, error: 'parent must be inside a managed canvas group' };
    }
    if (!(await assertRealpathContained(resolvedParent))) {
      return {
        ok: false,
        status: 400,
        error: 'parent resolves outside the design root via a symlink',
      };
    }

    const dirAbs = path.join(parentAbs, v.name);
    const resolvedDir = path.resolve(dirAbs);
    if (
      resolvedDir !== path.join(resolvedParent, v.name) ||
      !resolvedDir.startsWith(`${resolvedParent}${path.sep}`)
    ) {
      return { ok: false, status: 400, error: 'resolved path escapes the parent folder' };
    }
    try {
      await statp(dirAbs); // throws if absent (works for files AND dirs)
      return { ok: false, status: 409, error: `"${v.name}" already exists` };
    } catch {
      /* good — doesn't exist yet */
    }

    const folderCreate = await hooks.proposeFolder?.({
      op: 'dir.create',
      path: path.posix.join(parent, v.name),
    });
    if (folderCreate?.status === 'rejected') {
      return {
        ok: false,
        status: 409,
        error: `the project did not accept this folder (${folderCreate.code ?? 'rejected'})`,
      };
    }

    await mkdir(dirAbs, { recursive: true });
    await Bun.write(path.join(dirAbs, '.gitkeep'), '');

    const dirRel = path.posix.join(paths.designRel, parent, v.name);
    ctx.bus.emit('canvas-list-update', { action: 'mkdir', dir: dirRel });
    return { ok: true, dir: dirRel };
  }

  // Phase 12 (DDR-103) — resolve a v2 canvas slug (`selected.canvas`: POSIX,
  // extension-less, designRoot-relative — matches `_locator.json` keys + the
  // `canvasSlug()` shape) to its absolute `.tsx` path, with a containment
  // backstop. Same main-origin-only trust boundary as createCanvas: the
  // untrusted canvas iframe origin never reaches a source-write endpoint.
  function resolveCanvasAbs(
    slugRaw: unknown
  ): { ok: true; abs: string } | { ok: false; status: number; error: string } {
    if (typeof slugRaw !== 'string' || !slugRaw.trim()) {
      return { ok: false, status: 400, error: 'canvas (slug) required' };
    }
    let slug = slugRaw.replace(/^\/+|\/+$/g, '').replace(/\.(tsx|html)$/i, '');
    // Accept either the bare slug (`ui/Foo`) or the designRel-prefixed file path
    // the client `selected.file` carries (`.design/ui/Foo.tsx`) — strip a leading
    // designRel so both shapes resolve to the same canvas (mirrors deriveCanvasSlug).
    const dr = paths.designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (dr && slug.startsWith(`${dr}/`)) slug = slug.slice(dr.length + 1);
    if (
      !slug ||
      path.isAbsolute(slug) ||
      slug.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
    ) {
      return { ok: false, status: 400, error: 'invalid canvas slug' };
    }
    const abs = `${path.join(paths.designRoot, ...slug.split('/'))}.tsx`;
    const resolvedRoot = path.resolve(paths.designRoot);
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      return { ok: false, status: 400, error: 'canvas resolves outside the design root' };
    }
    return { ok: true, abs };
  }

  /**
   * DDR-148 — read a canvas's RAW .tsx source (containment via resolveCanvasAbs).
   * The Timeline panel parses `<Sequence>`/`<TransitionSeries.Sequence>` blocks
   * + `interpolate` windows from it to draw the sequence/keyframe rows. Read-only,
   * MAIN-ORIGIN ONLY at the route layer (never the untrusted canvas iframe).
   */
  async function loadCanvasSource(
    file: unknown
  ): Promise<{ ok: true; source: string } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(file);
    if (!r.ok) return r;
    const f = Bun.file(r.abs);
    if (!(await f.exists())) return { ok: false, status: 404, error: 'canvas not found' };
    const source = await f.text();
    // A comp is small; never stream a huge blob into the panel.
    if (source.length > 512 * 1024) {
      return { ok: false, status: 413, error: 'canvas source too large for the timeline parser' };
    }
    return { ok: true, source };
  }

  // 8-hex lowercase, the shape `computeId` (canvas-edit.ts) stamps on data-cd-id.
  // Pipeline-injected ids are 8-hex, but hand-AUTHORED `data-cd-id` attrs are
  // preserved verbatim by the transpile (canvas-pipeline.ts) and are equally
  // valid targets (dogfood 2026-07-20: `data-cd-id="wal-hero-nav"`). Accept
  // both — word chars + dashes, bounded; the AST walkers do exact matching, so
  // this is only a shape gate.
  const CD_ID_RE = /^[\w-]{1,64}$/;

  // RC1 (rca/issue-canvas-hmr-optimistic-update-consistency) — every inline
  // edit is USER-originated (inspector CSS knobs, inline text, attr panel, and
  // their undo/redo which re-POST the same endpoints), so it must not light the
  // "agent works here" rim. Mirror the reorder pattern (below): arm the
  // suppression BEFORE the write so it catches the debounced fs:any, disarm on
  // a no-op (delta 0 = no write) or throw so a failed edit can't mute the next
  // genuine agent edit's rim.
  /** T24/T25 — say what a structural edit IS (sync/source-ops), for replay. */
  function announceOp(
    abs: string,
    rel: string,
    before: string,
    op: Parameters<typeof describeSourceOp>[2]
  ): void {
    const described = describeSourceOp(abs, before, op);
    if (described) ctx.bus.emit('source-op', { rel, op: described });
  }

  async function suppressedEdit(
    abs: string,
    run: () => Promise<{ delta: number; changed?: boolean; previous?: AttributeState }>,
    errLabel: string,
    describe?: Parameters<typeof describeSourceOp>[2]
  ): Promise<EditOpResult> {
    const rel = path.relative(paths.designRoot, abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      // DDR-150 dogfood #1 — capture before/after so the edit registers in the
      // whole-file undo log (the Timeline replace-src path rides this; other
      // inspector edits get an undoable seq for free).
      const before = await Bun.file(abs).text();
      // T24 — what this edit IS, so a lost race re-applies it instead of
      // turning "we both picked a colour" into a conflict.
      if (describe) {
        const op = describeSourceOp(abs, before, describe);
        if (op) ctx.bus.emit('source-op', { rel, op });
      }
      const res = await run();
      const previous =
        res.previous?.kind === 'absent'
          ? { previous: null }
          : res.previous?.kind === 'literal'
            ? { previous: res.previous.value }
            : {};
      // `changed === false` = the op collapsed to a no-op and nothing hit disk —
      // NOT `delta === 0`, which an equal-length replacement also produces.
      if (res.changed === false) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, delta: res.delta, ...previous };
      }
      const after = await Bun.file(abs).text();
      const seq = after !== before ? logUndo(abs, before, after) : undefined;
      return { ok: true, delta: res.delta, seq, ...previous };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      if (err instanceof CanvasEditError && err.conflict) {
        return { ok: false, status: 409, error: err.message, conflict: true };
      }
      return {
        ok: false,
        status: 422,
        error: err instanceof CanvasEditError ? err.message : errLabel,
      };
    }
  }

  async function editCss(input: {
    canvas?: unknown;
    id?: unknown;
    property?: unknown;
    value?: unknown;
    reset?: unknown;
    idIndex?: unknown;
    expected?: unknown;
  }): Promise<EditOpResult> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const pre = expectedValueOf(input);
    if (!pre.ok) return { ok: false, status: 400, error: 'invalid expected value' };
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    // Stage H3 — optional DOM-occurrence index. Present only for a whole-instance
    // move/resize (reposition/resize-request); routes the write to the dragged
    // component instance's own `<Component/>` usage so it stays LOCAL. Absent for
    // knob / paste-style edits (those stay global on the shared inner element).
    const idIndex =
      typeof input.idIndex === 'number' && Number.isInteger(input.idIndex) && input.idIndex >= 0
        ? input.idIndex
        : undefined;
    const property = typeof input.property === 'string' ? input.property.trim() : '';
    // CSS property names are ASCII letters + hyphens only (optionally a leading
    // `-` for vendor prefixes) — reject anything that could smuggle a second key
    // or an expression into the inline style object.
    if (!property || !/^-?[a-z][a-z-]*$/.test(property)) {
      return { ok: false, status: 400, error: 'invalid css property' };
    }
    // kebab → camelCase JSX style key.
    const camel = property.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    // Phase 12.3 — `reset: true` REMOVES the inline property (back to class /
    // inherited). No value needed; a missing key is a no-op (delta 0).
    if (input.reset === true) {
      return suppressedEdit(
        r.abs,
        () =>
          removeAttribute(
            r.abs,
            id,
            `style.${camel}`,
            idIndex,
            pre.expected === undefined ? undefined : { expected: pre.expected, next: null }
          ),
        'reset failed',
        {
          kind: 'remove',
          id,
          attr: `style.${camel}`,
          ...(idIndex !== undefined ? { occurrence: idIndex } : {}),
        }
      );
    }
    const value = typeof input.value === 'string' ? input.value : '';
    if (!value.trim()) return { ok: false, status: 400, error: 'value required' };
    if (value.length > 256) return { ok: false, status: 413, error: 'value too long' };
    // The value is always written as a JS STRING literal: JSON.stringify escapes
    // quotes/backslashes/newlines so it can never break out of the string, and
    // React accepts string values for every style prop — so `var(--accent)`,
    // `#fff`, `8px`, `700`, `1.5` all ride verbatim.
    return suppressedEdit(
      r.abs,
      () =>
        editAttribute(
          r.abs,
          id,
          `style.${camel}`,
          JSON.stringify(value),
          idIndex,
          pre.expected === undefined ? undefined : { expected: pre.expected, next: value }
        ),
      'edit failed',
      {
        kind: 'set',
        id,
        attr: `style.${camel}`,
        value: JSON.stringify(value),
        ...(idIndex !== undefined ? { occurrence: idIndex } : {}),
      }
    );
  }

  async function editText(input: {
    canvas?: unknown;
    id?: unknown;
    text?: unknown;
    occurrence?: unknown;
    before?: unknown;
  }): Promise<EditOpResult> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    if (typeof input.text !== 'string') return { ok: false, status: 400, error: 'text required' };
    if (input.text.length > 5000) return { ok: false, status: 413, error: 'text too long' };
    const text = input.text;
    // Optional context for editing `{variable}` text (unified-text-editing
    // follow-up): which rendered instance, and its pre-edit text — both used
    // only to target the right source string; a bad/absent value just makes an
    // unresolvable expression edit fail loud (route to /design:edit).
    const occurrence =
      typeof input.occurrence === 'number' &&
      Number.isInteger(input.occurrence) &&
      input.occurrence >= 0
        ? input.occurrence
        : undefined;
    const before =
      typeof input.before === 'string' && input.before.length <= 5000 ? input.before : undefined;
    return suppressedEdit(
      r.abs,
      () => runEditText(r.abs, id, text, { occurrence, before }),
      'edit failed',
      { kind: 'text', id, text, ...(occurrence !== undefined ? { occurrence } : {}) }
    );
  }

  async function editAttr(input: {
    canvas?: unknown;
    id?: unknown;
    attr?: unknown;
    value?: unknown;
    reset?: unknown;
    expected?: unknown;
  }): Promise<EditOpResult> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const pre = expectedValueOf(input);
    if (!pre.ok) return { ok: false, status: 400, error: 'invalid expected value' };
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const attr = typeof input.attr === 'string' ? input.attr.trim() : '';
    // Plain HTML attributes only — data-*, aria-*, role, title, id, lang, dir…
    // Reject `style*` (that's /_api/edit-css), `data-cd-id` (pipeline-owned, also
    // refused downstream by editAttribute), and anything that isn't a bare html
    // attribute name. Digits allowed mid-name (e.g. data-2x).
    if (
      !attr ||
      !/^[a-z][a-z0-9-]*$/.test(attr) ||
      attr === 'data-cd-id' ||
      attr.startsWith('style')
    ) {
      return { ok: false, status: 400, error: 'invalid attribute' };
    }
    // Phase 12.3 — `reset: true` REMOVES the custom attribute. No-op if absent.
    if (input.reset === true) {
      return suppressedEdit(
        r.abs,
        () =>
          removeAttribute(
            r.abs,
            id,
            attr,
            undefined,
            pre.expected === undefined ? undefined : { expected: pre.expected, next: null }
          ),
        'reset failed',
        { kind: 'remove', id, attr }
      );
    }
    const value = typeof input.value === 'string' ? input.value : '';
    if (!value.trim()) return { ok: false, status: 400, error: 'value required' };
    if (value.length > 256) return { ok: false, status: 413, error: 'value too long' };
    // DDR-150 P3 — a media/image `src` edit (the clip-replace path) must stay a
    // contained asset reference: no path traversal, no script/file/data schemes.
    if (
      attr === 'src' &&
      (/\.\./.test(value) || /^\s*(javascript|vbscript|file|data):/i.test(value))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'src must be a contained asset path (no ../ or javascript:/file:/data: schemes)',
      };
    }
    // Non-`style.` attr name → editAttribute writes a plain quoted JSX attribute.
    // Pass the value RAW: editStringAttr quotes/escapes it itself (JSON.stringify
    // on replace, escapeAttr on insert) — pre-stringifying here double-encoded
    // the value (`data-x="\"ok\""`; knob-smoke finding, 2026-06-12).
    return suppressedEdit(
      r.abs,
      () =>
        editAttribute(
          r.abs,
          id,
          attr,
          value,
          undefined,
          pre.expected === undefined ? undefined : { expected: pre.expected, next: value }
        ),
      'edit failed',
      { kind: 'set', id, attr, value }
    );
  }

  // Phase 12.1 (DDR-138) — snapshot stack so a reorder is undoable via
  // /design:rollback (a positional move has no value-inverse the edit-source
  // undo command can re-apply, so it rides `_history` instead).
  const history = createHistory(ctx);

  const MOVE_POSITIONS = new Set(['before', 'after', 'inside-start', 'inside-end']);

  async function reorder(input: {
    canvas?: unknown;
    id?: unknown;
    refId?: unknown;
    position?: unknown;
    idIndex?: unknown;
    refIndex?: unknown;
  }): Promise<ReorderOpResult> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const refId = typeof input.refId === 'string' ? input.refId.trim() : '';
    if (!CD_ID_RE.test(refId)) {
      return { ok: false, status: 400, error: 'invalid reference data-cd-id' };
    }
    const position = input.position;
    if (typeof position !== 'string' || !MOVE_POSITIONS.has(position)) {
      return { ok: false, status: 400, error: 'invalid position' };
    }
    // Occurrence index of a reused-component instance (which rendered copy). 0/absent
    // for a normal element; moveElement maps it to the parent USAGE.
    const idIndex = Number.isInteger(input.idIndex) ? (input.idIndex as number) : undefined;
    const refIndex = Number.isInteger(input.refIndex) ? (input.refIndex as number) : undefined;
    // A same-id move CAN be valid now: two instances of the same reused component
    // resolve to DIFFERENT usage elements. Only bail when they're the same instance.
    if (id === refId && (idIndex ?? 0) === (refIndex ?? 0)) {
      return { ok: false, status: 422, error: 'cannot move an element relative to itself' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    // Arm the "user did this — don't light the agent-editing rim" suppression
    // BEFORE the write so it catches the debounced fs:any. It's disarmed below if
    // the move turns out to be a no-op or throws (adversarial F2 — else a
    // failed/spam reorder would swallow the next genuine edit's rim).
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, {
        kind: 'move',
        id,
        refId,
        position: String(position),
        ...(idIndex !== undefined ? { idIndex } : {}),
        ...(refIndex !== undefined ? { refIndex } : {}),
      });
      const res = await moveElement(r.abs, id, refId, position as MovePosition, idIndex, refIndex);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        // No-op move (the reparse-clean edit collapsed to the same source) — no
        // write happened, so disarm the rim suppression and DON'T snapshot/log
        // (adversarial F2 + F3: never deposit a _history blob for a non-write).
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, delta: 0, movedId: res.movedId, semanticId: res.semanticId, seq: 0 };
      }
      // A real write landed. Snapshot the pre-move source for /design:rollback
      // (RELATIVE path → `_history/<slug>/`; the absolute path would mangle the
      // slug slug.sh can't find) — best-effort. Log {before, after} under a seq so
      // Cmd+Z can revert by whole-file swap (inverse descriptors go stale as
      // positional ids churn).
      try {
        await history.writeSnapshot(rel, before, 'pre-reorder');
      } catch {
        /* snapshot is a safety net, not a gate */
      }
      const seq = ++reorderSeq;
      reorderLog.set(seq, { abs: r.abs, before, after });
      while (reorderLog.size > REORDER_LOG_CAP) {
        const oldest = reorderLog.keys().next().value;
        if (oldest === undefined) break;
        reorderLog.delete(oldest);
      }
      return { ok: true, delta: res.delta, movedId: res.movedId, semanticId: res.semanticId, seq };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel); // move threw, no write — disarm
      return {
        ok: false,
        status: 422,
        error: err instanceof CanvasEditError ? err.message : 'reorder failed',
      };
    }
  }

  /**
   * DDR-148 — Timeline drag-to-retime. Rewrites the `durationInFrames` / `from`
   * of the `index`-th sequence (document order). MAIN-ORIGIN ONLY at the route
   * layer. Snapshots pre-retime for /design:rollback; suppresses the agent-rim.
   */
  async function retimeSequenceOp(input: {
    canvas?: unknown;
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
    index?: unknown;
    durationInFrames?: unknown;
    from?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    // DDR-150 P2 — prefer the comp-scoped stableId (multi-comp-safe) over the
    // legacy whole-file index. The index path stays for back-compat.
    const stableId = typeof input.stableId === 'string' ? input.stableId : null;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const contentHash = typeof input.contentHash === 'string' ? input.contentHash : undefined;
    const index = Number.isInteger(input.index) ? (input.index as number) : -1;
    if (!stableId && (index < 0 || index > 500))
      return { ok: false, status: 400, error: 'invalid sequence index' };
    const frames = (v: unknown, lo: number): number | undefined => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(lo, Math.min(100000, n)) : undefined;
    };
    const patch: { durationInFrames?: number; from?: number } = {};
    if (input.durationInFrames != null) patch.durationInFrames = frames(input.durationInFrames, 1);
    if (input.from != null) patch.from = frames(input.from, 0);
    if (patch.durationInFrames == null && patch.from == null) {
      return { ok: false, status: 400, error: 'nothing to retime' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (stableId) await retimeSequenceByClip(r.abs, artboardId, stableId, contentHash, patch);
      else await retimeSequence(r.abs, index, patch);
      // A trim/move that pushes a clip past the comp end stretches the comp
      // (the timeline always reaches the last clip — dogfood rule).
      try {
        await applyOnDisk(r.abs, (src) => applyFitTotalToContent(r.abs, src, artboardId));
      } catch {
        /* fit is best-effort — the retime itself already landed */
      }
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-retime');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'retime failed',
      };
    }
  }

  async function removeSequenceOp(input: {
    canvas?: unknown;
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const stableId = typeof input.stableId === 'string' ? input.stableId : null;
    if (!stableId) return { ok: false, status: 400, error: 'stableId required' };
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const contentHash = typeof input.contentHash === 'string' ? input.contentHash : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      // feature-enhanced-video-editing — the iMovie Delete ripples: a series
      // beat's removal shrinks the comp TOTAL (duration − transition overlap);
      // a standalone overlay/audio clip removes without moving the cut.
      await removeClipRippled(r.abs, artboardId, stableId, contentHash);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-remove-clip');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'remove failed',
      };
    }
  }

  async function insertSequenceOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    from?: unknown;
    durationInFrames?: unknown;
    mediaTag?: unknown;
    src?: unknown;
    lane?: unknown;
    index?: unknown;
    placeholder?: unknown;
  }): Promise<
    | { ok: true; stableId: string | null; seq?: number }
    | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const from = Number.isFinite(Number(input.from))
      ? Math.max(0, Math.round(Number(input.from)))
      : 0;
    const durationInFrames = Number.isFinite(Number(input.durationInFrames))
      ? Math.max(1, Math.min(100000, Math.round(Number(input.durationInFrames))))
      : 90;
    const mediaTag = typeof input.mediaTag === 'string' ? input.mediaTag : null;
    const src = typeof input.src === 'string' ? input.src : null;
    // Task 6 — positional insert: lane + (storyline) index route through the
    // caret-aware engine; the legacy append path stays for lane-less callers.
    const lane =
      input.lane === 'storyline' || input.lane === 'overlay' || input.lane === 'audio'
        ? input.lane
        : null;
    const laneIndex = Number.isInteger(Number(input.index))
      ? Math.max(0, Math.round(Number(input.index)))
      : undefined;
    // Task 22 — a prompt-carrying AI slate instead of media.
    const ph = input.placeholder as { prompt?: unknown; kind?: unknown } | null | undefined;
    const placeholder =
      ph && typeof ph === 'object' && typeof ph.prompt === 'string'
        ? { prompt: ph.prompt, kind: typeof ph.kind === 'string' ? ph.kind : 'veo' }
        : null;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      const res = lane
        ? await insertClipAt(r.abs, artboardId, {
            lane,
            index: laneIndex,
            from,
            durationInFrames,
            mediaTag,
            src,
            placeholder,
          })
        : await insertClip(r.abs, artboardId, { from, durationInFrames, mediaTag, src });
      const after = await Bun.file(r.abs).text();
      let seq: number | undefined;
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
      } else {
        try {
          await history.writeSnapshot(rel, before, 'pre-insert-clip');
        } catch {
          /* snapshot best-effort */
        }
        seq = logUndo(r.abs, before, after);
      }
      return { ok: true, stableId: res.stableId, seq };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'insert failed',
      };
    }
  }

  /**
   * feature-enhanced-video-editing (Phase 2) — the parametric clip verbs, one
   * dispatch op: speed · trim-in · audio · detach-audio · framing · grade ·
   * transition. Every verb is a pure clip-ops fn run under the file lock, with
   * the same stableId + contentHash optimistic-concurrency discipline, pre-op
   * snapshot, and whole-file undo seq as the structural clip ops.
   */
  async function clipEditOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    stableId?: unknown;
    contentHash?: unknown;
    verb?: unknown;
    rate?: unknown;
    deltaFrames?: unknown;
    muted?: unknown;
    volume?: unknown;
    framing?: unknown;
    grade?: unknown;
    presentation?: unknown;
    durationInFrames?: unknown;
    atFrame?: unknown;
    src?: unknown;
    mediaKind?: unknown;
    text?: unknown;
    toIndex?: unknown;
  }): Promise<
    | { ok: true; seq?: number; extra?: Record<string, unknown> }
    | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const stableId = typeof input.stableId === 'string' ? input.stableId : null;
    if (!stableId) return { ok: false, status: 400, error: 'stableId required' };
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const hash = typeof input.contentHash === 'string' ? input.contentHash : undefined;
    const verb = typeof input.verb === 'string' ? input.verb : '';
    const abs = r.abs;
    // Just `{ source: string }`: the `& Record<string, unknown>` was there for
    // the rest-spread below, but an INTERFACE return (SpeedResult and friends)
    // has no implicit index signature, so no verb's function was actually
    // assignable — every branch failed the check the same way.
    let run: ((source: string) => { source: string }) | null = null;
    switch (verb) {
      case 'speed': {
        const rate = Number(input.rate);
        run = (src) => applySetPlaybackRate(abs, src, artboardId, stableId, hash, rate);
        break;
      }
      case 'trim-in': {
        const delta = Number(input.deltaFrames);
        if (!Number.isFinite(delta))
          return { ok: false, status: 400, error: 'deltaFrames required' };
        run = (src) => applyTrimIn(abs, src, artboardId, stableId, hash, delta);
        break;
      }
      case 'audio': {
        const opts: { muted?: boolean; volume?: number | null } = {};
        if (typeof input.muted === 'boolean') opts.muted = input.muted;
        if (input.volume !== undefined)
          opts.volume = input.volume == null ? null : Number(input.volume);
        run = (src) => applyClipAudio(abs, src, artboardId, stableId, hash, opts);
        break;
      }
      case 'detach-audio': {
        run = (src) => applyDetachAudio(abs, src, artboardId, stableId, hash);
        break;
      }
      case 'framing': {
        const f = input.framing as { scale?: unknown; x?: unknown; y?: unknown } | null;
        const framing =
          f == null
            ? null
            : { scale: Number(f.scale) || 1, x: Number(f.x) || 0, y: Number(f.y) || 0 };
        run = (src) => applyClipFraming(abs, src, artboardId, stableId, hash, framing);
        break;
      }
      case 'grade': {
        const grade = input.grade == null ? null : (input.grade as GradeParams);
        run = (src) => applyClipGrade(abs, src, artboardId, stableId, hash, grade);
        break;
      }
      case 'transition': {
        const opts: { presentation?: string; durationInFrames?: number } = {};
        if (typeof input.presentation === 'string') opts.presentation = input.presentation;
        if (input.durationInFrames != null) opts.durationInFrames = Number(input.durationInFrames);
        run = (src) => applyEditTransition(abs, src, artboardId, stableId, hash, opts);
        break;
      }
      case 'split': {
        const atFrame = Number(input.atFrame);
        if (!Number.isFinite(atFrame)) return { ok: false, status: 400, error: 'atFrame required' };
        run = (src) => applySplitClip(abs, src, artboardId, stableId, hash, atFrame);
        break;
      }
      case 'insert-transition': {
        const presentation = typeof input.presentation === 'string' ? input.presentation : 'fade';
        const frames = Number(input.durationInFrames) || 15;
        run = (src) =>
          applyInsertTransition(abs, src, artboardId, stableId, hash, presentation, frames);
        break;
      }
      case 'remove-transition': {
        run = (src) => applyRemoveTransition(abs, src, artboardId, stableId, hash);
        break;
      }
      case 'set-text': {
        const t = typeof input.text === 'string' ? input.text : '';
        run = (src) => applySetClipText(abs, src, artboardId, stableId, hash, t);
        break;
      }
      case 'to-overlay': {
        run = (src) => applyMoveClipToOverlay(abs, src, artboardId, stableId, hash);
        break;
      }
      case 'to-storyline': {
        run = (src) => applyMoveClipToStoryline(abs, src, artboardId, stableId, hash);
        break;
      }
      case 'layer-order': {
        const toIndex = Number(input.toIndex);
        if (!Number.isFinite(toIndex)) return { ok: false, status: 400, error: 'toIndex required' };
        run = (src) => applyReorderOverlayLayer(abs, src, artboardId, stableId, hash, toIndex);
        break;
      }
      case 'resolve-placeholder': {
        const src2 = typeof input.src === 'string' ? input.src : '';
        const mediaKind = input.mediaKind === 'image' ? 'image' : 'video';
        run = (src) =>
          applyResolvePlaceholder(abs, src, artboardId, stableId, hash, src2, mediaKind);
        break;
      }
      default:
        return { ok: false, status: 400, error: `unknown clip verb "${verb}"` };
    }
    const rel = path.relative(paths.designRoot, abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(abs).text();
      // The switch above either assigned `run` or returned; say so to the checker.
      if (!run) return { ok: false, status: 400, error: `unknown clip verb "${verb}"` };
      const result = await applyOnDisk(abs, run);
      const after = await Bun.file(abs).text();
      let seq: number | undefined;
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
      } else {
        try {
          await history.writeSnapshot(rel, before, `pre-clip-${verb}`);
        } catch {
          /* snapshot best-effort */
        }
        seq = logUndo(abs, before, after);
      }
      const { source: _src, ...extra } = result;
      return { ok: true, seq, extra };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : `clip ${verb} failed`,
      };
    }
  }

  // Stage I (feature-element-editing-robustness) — general element structural
  // edits (delete / insert / new-artboard) + free-hand artboard resize (D4). All
  // MAIN-ORIGIN ONLY at the route layer; each logs a whole-file {before, after}
  // under a seq (logUndo) so Cmd+Z reverts through /_api/reorder-revert (a
  // structural edit renumbers positional data-cd-ids → an inverse descriptor
  // goes stale). Same agent-rim suppression + pre-op snapshot as reorder.

  /** Delete the element with `data-cd-id === id` (reused-component instance via idIndex). */
  async function deleteElementOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; deletedId: string; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const idIndex = Number.isInteger(input.idIndex) ? (input.idIndex as number) : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, {
        kind: 'delete',
        id,
        ...(idIndex !== undefined ? { occurrence: idIndex } : {}),
      });
      const res = await deleteElement(r.abs, id, idIndex);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, deletedId: res.deletedId };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-delete-element');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, deletedId: res.deletedId, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'delete failed',
      };
    }
  }

  /** Insert a synthesized element (div/text/image) relative to `refId`, or —
   * empty-artboard fallback — as a direct child of `artboardId`. */
  async function insertElementOp(input: {
    canvas?: unknown;
    refId?: unknown;
    artboardId?: unknown;
    position?: unknown;
    kind?: unknown;
    src?: unknown;
    refIndex?: unknown;
  }): Promise<
    { ok: true; newId: string | null; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const hasRefId = typeof input.refId === 'string' && input.refId.trim() !== '';
    const hasArtboardId = typeof input.artboardId === 'string' && input.artboardId.trim() !== '';
    if (hasRefId === hasArtboardId) {
      return { ok: false, status: 400, error: 'provide exactly one of refId / artboardId' };
    }
    const refId = hasRefId ? (input.refId as string).trim() : '';
    if (hasRefId && !CD_ID_RE.test(refId)) {
      return { ok: false, status: 400, error: 'invalid reference data-cd-id' };
    }
    const artboardId = hasArtboardId ? (input.artboardId as string).trim() : '';
    if (hasArtboardId && !/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    const position = input.position;
    if (typeof position !== 'string' || !MOVE_POSITIONS.has(position)) {
      return { ok: false, status: 400, error: 'invalid position' };
    }
    if (hasArtboardId && position !== 'inside-start' && position !== 'inside-end') {
      return {
        ok: false,
        status: 400,
        error: 'artboardId insert requires inside-start/inside-end',
      };
    }
    const kind = input.kind;
    if (kind !== 'div' && kind !== 'text' && kind !== 'image') {
      return { ok: false, status: 400, error: 'invalid kind (div|text|image)' };
    }
    const src = typeof input.src === 'string' ? input.src : undefined;
    const refIndex = Number.isInteger(input.refIndex) ? (input.refIndex as number) : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large to grow' };
      }
      const res = hasArtboardId
        ? await insertElementIntoArtboard(
            r.abs,
            artboardId,
            position as 'inside-start' | 'inside-end',
            kind as InsertKind,
            { src }
          )
        : await insertElement(r.abs, refId, position as MovePosition, kind as InsertKind, {
            src,
            occurrence: refIndex,
          });
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, newId: res.newId };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-insert-element');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, newId: res.newId, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'insert failed',
      };
    }
  }

  /**
   * feature-4 T8 (convert-to-absolute, DDR-188) — the "Remove auto layout"
   * analogue. Rewrite every stamped child of a container to `position:absolute`
   * with the frozen box the canvas measured, and set the container
   * `position:relative` when static — ONE whole-file write, ONE undo `seq`. The
   * canvas iframe pre-filters to plain, globally-unique children (no unstamped /
   * repeated / component instances); the AST writer's `resolveUsageId` guard is
   * the server-side backstop for a shared-component usage.
   */
  async function convertChildrenToAbsoluteOp(input: {
    canvas?: unknown;
    containerId?: unknown;
    containerIdIndex?: unknown;
    containerSetRelative?: unknown;
    allowShared?: unknown;
    children?: unknown;
    containers?: unknown;
    dissolve?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1_000_000
        ? Math.round(v)
        : null;
    // Simplifier fix (review fan-out, 2026-07-21) — reuse canvas-edit.ts's own
    // exported spec types instead of a locally re-declared shape, which had
    // drifted (missing `freezeSize?`, populated a few lines below via a spread
    // that silently bypassed excess-property checking).
    const parseChildren = (raw: unknown): ConvertChildBox[] | string => {
      if (!Array.isArray(raw) || raw.length === 0) return 'children required';
      const out: ConvertChildBox[] = [];
      for (const c of raw as Array<Record<string, unknown>>) {
        const id = typeof c?.id === 'string' ? c.id.trim() : '';
        if (!CD_ID_RE.test(id)) return 'invalid child data-cd-id';
        const left = num(c.left);
        const top = num(c.top);
        const width = num(c.width);
        const height = num(c.height);
        if (left === null || top === null || width === null || height === null) {
          return 'invalid child box (left/top/width/height)';
        }
        const idIndex = Number.isInteger(c.idIndex) ? (c.idIndex as number) : undefined;
        out.push({ id, idIndex, left, top, width, height });
      }
      return out;
    };

    // feature-4 artboard-level convert (2026-07-19) — MULTI-container batch.
    // Each container: optional containerId (absent = the artboard-body root
    // level), a setRelative flag, and its children boxes. Total child count is
    // capped across the batch.
    let containersSpec: ConvertContainerSpec[] | undefined;
    if (input.containers !== undefined) {
      if (!Array.isArray(input.containers) || input.containers.length === 0) {
        return { ok: false, status: 400, error: 'invalid containers' };
      }
      if (input.containers.length > 200) {
        return { ok: false, status: 400, error: 'too many containers' };
      }
      containersSpec = [];
      let total = 0;
      for (const c of input.containers as Array<Record<string, unknown>>) {
        let containerId: string | undefined;
        if (c?.containerId !== undefined && c.containerId !== null) {
          const cid = typeof c.containerId === 'string' ? c.containerId.trim() : '';
          if (!CD_ID_RE.test(cid)) {
            return {
              ok: false,
              status: 400,
              error: `invalid container data-cd-id (${String(c.containerId).slice(0, 64)})`,
            };
          }
          containerId = cid;
        }
        const kids = parseChildren(c?.children);
        if (typeof kids === 'string') return { ok: false, status: 400, error: kids };
        total += kids.length;
        if (total > 500) return { ok: false, status: 400, error: 'too many children' };
        let freezeSize: { width: number; height: number } | undefined;
        if (c?.freezeSize && typeof c.freezeSize === 'object') {
          const fw = num((c.freezeSize as Record<string, unknown>).width);
          const fh = num((c.freezeSize as Record<string, unknown>).height);
          if (fw !== null && fh !== null) freezeSize = { width: fw, height: fh };
        }
        containersSpec.push({
          containerId,
          containerIdIndex: Number.isInteger(c?.containerIdIndex)
            ? (c.containerIdIndex as number)
            : undefined,
          containerSetRelative: c?.containerSetRelative === true,
          ...(freezeSize ? { freezeSize } : {}),
          children: kids,
        });
      }
    }

    // Legacy single-container shape (the element context-menu action).
    let containerId = '';
    let containerIdIndex: number | undefined;
    let containerSetRelative = false;
    let children: ConvertChildBox[] = [];
    if (!containersSpec) {
      containerId = typeof input.containerId === 'string' ? input.containerId.trim() : '';
      if (!CD_ID_RE.test(containerId)) {
        return { ok: false, status: 400, error: 'invalid container data-cd-id' };
      }
      containerIdIndex = Number.isInteger(input.containerIdIndex)
        ? (input.containerIdIndex as number)
        : undefined;
      containerSetRelative = input.containerSetRelative === true;
      if (Array.isArray(input.children) && input.children.length > 500) {
        return { ok: false, status: 400, error: 'too many children' };
      }
      const kids = parseChildren(input.children);
      if (typeof kids === 'string') return { ok: false, status: 400, error: kids };
      children = kids;
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large' };
      }
      // feature-4 TRUE FLATTEN — validated dissolve list (batch shape only).
      let dissolve: string[] | undefined;
      if (input.dissolve !== undefined) {
        if (!Array.isArray(input.dissolve) || input.dissolve.length > 200) {
          return { ok: false, status: 400, error: 'invalid dissolve list' };
        }
        dissolve = [];
        for (const d of input.dissolve) {
          const id = typeof d === 'string' ? d.trim() : '';
          if (!CD_ID_RE.test(id)) {
            return { ok: false, status: 400, error: 'invalid dissolve data-cd-id' };
          }
          dissolve.push(id);
        }
      }
      const res = await convertToAbsolute(
        r.abs,
        containersSpec
          ? { allowShared: input.allowShared === true, containers: containersSpec, dissolve }
          : {
              containerId,
              containerIdIndex,
              containerSetRelative,
              allowShared: input.allowShared === true,
              children,
            }
      );
      const after = res.source;
      if (!res.changed || after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-convert-absolute');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'convert-to-absolute failed',
      };
    }
  }

  /**
   * feature-4 detach-component (2026-07-19) — clone the component definition
   * under a fresh name + repoint THIS usage at the clone, so subsequent edits
   * stay local to this instance. Whole-file undo seq (Stage-I lane).
   */
  async function detachComponentOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; detachedName: string; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const idIndex = Number.isInteger(input.idIndex) ? (input.idIndex as number) : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large to grow' };
      }
      const res = await detachComponent(r.abs, id, idIndex);
      const after = res.source;
      if (!res.changed || after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, detachedName: res.detachedName };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-detach-component');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, detachedName: res.detachedName, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'detach failed',
      };
    }
  }

  /** Insert a new empty artboard (id/label/width/height) after the last one. */
  async function insertArtboardOp(input: {
    canvas?: unknown;
    id?: unknown;
    label?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<
    { ok: true; artboardId: string; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(id)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    const label = typeof input.label === 'string' ? input.label.slice(0, 120) : id;
    const width = Number.isFinite(Number(input.width))
      ? Math.max(64, Math.min(8192, Math.round(Number(input.width))))
      : 0;
    const height = Number.isFinite(Number(input.height))
      ? Math.max(64, Math.min(8192, Math.round(Number(input.height))))
      : 0;
    if (!width || !height) return { ok: false, status: 400, error: 'width and height required' };
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large to grow' };
      }
      const res = await insertArtboard(r.abs, { id, label, width, height });
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, artboardId: res.artboardId };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-insert-artboard');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, artboardId: res.artboardId, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'insert-artboard failed',
      };
    }
  }

  /**
   * Duplicate an artboard at a new width (feature-3-web-artboards T3,
   * "Duplicate at width…") — clones id/label/width, everything else
   * (kind/guides/print/style/children) carries over verbatim.
   */
  async function duplicateArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    width?: unknown;
  }): Promise<
    { ok: true; artboardId: string; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboardId' };
    }
    const width = Number.isFinite(Number(input.width))
      ? Math.max(64, Math.min(8192, Math.round(Number(input.width))))
      : 0;
    if (!width) return { ok: false, status: 400, error: 'width required' };
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large to grow' };
      }
      const res = await duplicateArtboard(r.abs, artboardId, width);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, artboardId: res.artboardId };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-duplicate-artboard');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, artboardId: res.artboardId, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'duplicate-artboard failed',
      };
    }
  }

  /** Free-hand artboard resize (D4) — write width/height NUMERIC props (DDR-027). */
  async function resizeArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    width?: unknown;
    height?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    const dim = (v: unknown): number | undefined =>
      Number.isFinite(Number(v)) ? Math.max(64, Math.min(8192, Math.round(Number(v)))) : undefined;
    const width = dim(input.width);
    const height = dim(input.height);
    if (width == null && height == null) {
      return { ok: false, status: 400, error: 'width or height required' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, {
        kind: 'artboard',
        fn: 'resize',
        artboardId,
        args: [width, height],
      });
      await resizeArtboard(r.abs, artboardId, width, height);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-resize-artboard');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'resize-artboard failed',
      };
    }
  }

  /** Toggle an artboard's Hug/Fixed height sizing mode (CSS-panel control). */
  async function setArtboardHugOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    fixed?: unknown;
    freezeHeight?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    if (typeof input.fixed !== 'boolean') {
      return { ok: false, status: 400, error: 'fixed (boolean) required' };
    }
    const fixed = input.fixed;
    const freezeHeight = Number.isFinite(Number(input.freezeHeight))
      ? Math.max(64, Math.min(8192, Math.round(Number(input.freezeHeight))))
      : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, {
        kind: 'artboard',
        fn: 'hug',
        artboardId,
        args: [fixed, freezeHeight],
      });
      await setArtboardHug(r.abs, artboardId, fixed, freezeHeight);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-hug');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-hug failed',
      };
    }
  }

  const ARTBOARD_KIND_VALUES = new Set(['digital', 'print', 'web', 'video']);

  /** Kind-switch surfaces (T8): context menu + Inspector picker. */
  async function setArtboardKindOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    kind?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    let kind: string | null;
    if (input.kind === null) {
      kind = null;
    } else if (typeof input.kind === 'string' && ARTBOARD_KIND_VALUES.has(input.kind)) {
      kind = input.kind;
    } else {
      return { ok: false, status: 400, error: 'invalid kind' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, { kind: 'artboard', fn: 'kind', artboardId, args: [kind] });
      await setArtboardKind(r.abs, artboardId, kind);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-kind');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-kind failed',
      };
    }
  }

  /** Rename an artboard (plan T25/L08 — double-click its name). */
  async function setArtboardLabelOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    label?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    if (typeof input.label !== 'string' || !input.label.trim()) {
      return { ok: false, status: 400, error: 'name is required' };
    }
    const label = input.label;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, { kind: 'artboard', fn: 'label', artboardId, args: [label] });
      await setArtboardLabel(r.abs, artboardId, label);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-label');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-label failed',
      };
    }
  }

  const MAX_GUIDES_JSON_BYTES = 4096;

  /** Generic layout guides (T5) — Inspector/skill writer. Replace-whole-prop,
   *  never a deep merge (see applySetArtboardGuides's own doc comment). */
  async function setArtboardGuidesOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    guides?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    let guides: Record<string, unknown> | null;
    if (input.guides === null) {
      guides = null;
    } else if (
      input.guides &&
      typeof input.guides === 'object' &&
      !Array.isArray(input.guides) &&
      JSON.stringify(input.guides).length <= MAX_GUIDES_JSON_BYTES
    ) {
      guides = input.guides as Record<string, unknown>;
    } else {
      return { ok: false, status: 400, error: 'invalid guides' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, {
        kind: 'artboard',
        fn: 'guides',
        artboardId,
        args: [guides],
      });
      await setArtboardGuides(r.abs, artboardId, guides);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-guides');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-guides failed',
      };
    }
  }

  const PRINT_ORIENTATION_VALUES = new Set(['portrait', 'landscape']);

  function isFiniteMmOrUndefined(v: unknown): v is number | undefined {
    return (
      v === undefined ||
      (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRINT_MM)
    );
  }

  /**
   * feature-2-print-artboards T2 — paper/orientation/bleed/margins. Replace-
   * whole-prop (see applySetArtboardPrint's own doc comment) — the caller
   * sends the full merged object, not a delta. `print: null` clears the
   * prop. Shape validation lives HERE (canvas-edit.ts stays generic
   * Record<string, unknown> AST surgery, same split as setArtboardGuidesOp).
   */
  async function setArtboardPrintOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    print?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    let print: Record<string, unknown> | null;
    if (input.print === null) {
      print = null;
    } else if (input.print && typeof input.print === 'object' && !Array.isArray(input.print)) {
      const p = input.print as Record<string, unknown>;
      if (typeof p.paper !== 'string' || !getPaperPreset(p.paper)) {
        return { ok: false, status: 400, error: 'invalid or unknown paper preset' };
      }
      if (p.orientation !== undefined && !PRINT_ORIENTATION_VALUES.has(p.orientation as string)) {
        return { ok: false, status: 400, error: 'invalid orientation' };
      }
      if (!isFiniteMmOrUndefined(p.bleedMm)) {
        return { ok: false, status: 400, error: 'invalid bleedMm' };
      }
      if (p.marginsMm !== undefined) {
        if (typeof p.marginsMm !== 'object' || p.marginsMm === null || Array.isArray(p.marginsMm)) {
          return { ok: false, status: 400, error: 'invalid marginsMm' };
        }
        const m = p.marginsMm as Record<string, unknown>;
        for (const side of ['top', 'right', 'bottom', 'left']) {
          if (!isFiniteMmOrUndefined(m[side])) {
            return { ok: false, status: 400, error: `invalid marginsMm.${side}` };
          }
        }
      }
      print = p;
    } else {
      return { ok: false, status: 400, error: 'invalid print' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      await setArtboardPrint(r.abs, artboardId, print);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-print');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-print failed',
      };
    }
  }

  const ARTBOARD_LAYOUT_VALUES = new Set(['block', 'flex-col', 'flex-row', 'grid']);

  /** Set artboard "more settings" — background / padding / layout / gap. */
  async function setArtboardStyleOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    background?: unknown;
    padding?: unknown;
    layout?: unknown;
    gap?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    const patch: {
      background?: string | null;
      padding?: number | string | null;
      layout?: string | null;
      gap?: number | string | null;
    } = {};
    if ('background' in input) {
      if (input.background === null) patch.background = null;
      else if (typeof input.background === 'string' && input.background.length <= 256) {
        patch.background = input.background;
      } else {
        return { ok: false, status: 400, error: 'invalid background' };
      }
    }
    if ('layout' in input) {
      if (input.layout === null) patch.layout = null;
      else if (typeof input.layout === 'string' && ARTBOARD_LAYOUT_VALUES.has(input.layout)) {
        patch.layout = input.layout;
      } else {
        return { ok: false, status: 400, error: 'invalid layout' };
      }
    }
    // Dogfood (artboard panel ↔ shared inspector controls) — padding/gap
    // accept a design-token binding alongside raw px. STRICT single-var shape
    // (not a free-form CSS string like `background`): the value lands in a
    // JSX prop AND in `.dc-artboard-body`'s inline style, so anything beyond
    // one `var(--…)` reference is rejected rather than round-tripped.
    const BOX_TOKEN_RE = /^var\(--[a-zA-Z0-9_-]{1,64}\)$/;
    const clampBoxDim = (v: unknown): number | string | null | undefined => {
      if (v === null) return null;
      if (v === undefined) return undefined;
      if (typeof v === 'string' && BOX_TOKEN_RE.test(v)) return v;
      return Number.isFinite(Number(v)) ? Math.max(0, Math.min(512, Math.round(Number(v)))) : NaN;
    };
    if ('padding' in input) {
      const p = clampBoxDim(input.padding);
      if (typeof p === 'number' && Number.isNaN(p))
        return { ok: false, status: 400, error: 'invalid padding' };
      patch.padding = p;
    }
    if ('gap' in input) {
      const g = clampBoxDim(input.gap);
      if (typeof g === 'number' && Number.isNaN(g))
        return { ok: false, status: 400, error: 'invalid gap' };
      patch.gap = g;
    }
    if (Object.keys(patch).length === 0) {
      return { ok: false, status: 400, error: 'no style props given' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      announceOp(r.abs, rel, before, { kind: 'artboard', fn: 'style', artboardId, args: [patch] });
      await setArtboardStyle(r.abs, artboardId, patch);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-set-artboard-style');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'set-artboard-style failed',
      };
    }
  }

  /** Duplicate an element (Cmd+D) — insert a copy as the next sibling. */
  async function duplicateElementOp(input: {
    canvas?: unknown;
    id?: unknown;
    idIndex?: unknown;
  }): Promise<
    { ok: true; newId: string | null; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const idIndex = Number.isInteger(input.idIndex) ? (input.idIndex as number) : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      if (before.length > MAX_CANVAS_SOURCE) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: false, status: 413, error: 'canvas source too large to grow' };
      }
      announceOp(r.abs, rel, before, {
        kind: 'duplicate',
        id,
        ...(idIndex !== undefined ? { occurrence: idIndex } : {}),
      });
      const res = await duplicateElement(r.abs, id, idIndex);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, newId: res.newId };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-duplicate-element');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, newId: res.newId, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'duplicate failed',
      };
    }
  }

  /** Delete an artboard by its `id` prop (Backspace / context-menu on a frame). */
  async function deleteArtboardOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    if (!takeStructuralToken()) return RATE_LIMITED;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId.trim() : '';
    if (!/^[A-Za-z][\w-]{0,63}$/.test(artboardId)) {
      return { ok: false, status: 400, error: 'invalid artboard id' };
    }
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      await deleteArtboard(r.abs, artboardId);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      try {
        await history.writeSnapshot(rel, before, 'pre-delete-artboard');
      } catch {
        /* snapshot best-effort */
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'delete-artboard failed',
      };
    }
  }

  /**
   * Edit-scope verdict for the INV-3 predictability badge (Stage H). READ-only —
   * parses the canvas + returns whether an edit to `id` is local or shared. No
   * write, no undo, no rate-cap (a mere parse the shell runs on selection). The
   * client supplies `rendered` = the DOM occurrence count of the cd-id so the
   * `.map()` case is honest.
   */
  async function editScopeOp(input: {
    canvas?: unknown;
    id?: unknown;
    rendered?: unknown;
  }): Promise<({ ok: true } & EditScope) | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!CD_ID_RE.test(id)) return { ok: false, status: 400, error: 'invalid data-cd-id' };
    const rendered = Number.isFinite(Number(input.rendered))
      ? Math.max(1, Math.round(Number(input.rendered)))
      : 1;
    try {
      const source = await Bun.file(r.abs).text();
      const scope = resolveEditScope(r.abs, source, id, rendered);
      return { ok: true, ...scope };
    } catch (err) {
      return { ok: false, status: 500, error: err instanceof Error ? err.message : 'scope failed' };
    }
  }

  /**
   * feature-4 T7a (layers purple instances) — the component map for the shell's
   * Layers panel: `{ [cdId]: { component, root, usages } }` for every element
   * that renders through an instantiated component. READ-only parse (same
   * posture as editScopeOp).
   */
  async function componentMapOp(input: {
    canvas?: unknown;
  }): Promise<
    | { ok: true; map: Record<string, { component: string; root: boolean; usages: number }> }
    | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    try {
      const file = Bun.file(r.abs);
      // Security fix (review fan-out, 2026-07-21) — this route is AUTO-fetched
      // by the shell on every canvas/artboard switch (no user action), unlike
      // the sibling edit-scope route it mirrors. Per this repo's hub-push
      // threat model (DDR-060), a peer could otherwise cost a collaborator
      // CPU/memory the moment they merely open a pathologically large synced
      // canvas — cap it the same way the structural-write ops cap `before`.
      if (file.size > MAX_CANVAS_SOURCE) {
        return { ok: false, status: 413, error: 'canvas source too large' };
      }
      const source = await file.text();
      return { ok: true, map: componentMapForCanvas(r.abs, source) };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : 'component map failed',
      };
    }
  }

  async function toggleHideOp(input: {
    canvas?: unknown;
    stableId?: unknown;
    artboardId?: unknown;
    contentHash?: unknown;
  }): Promise<
    { ok: true; hidden: boolean; seq?: number } | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const stableId = typeof input.stableId === 'string' ? input.stableId : null;
    if (!stableId) return { ok: false, status: 400, error: 'stableId required' };
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const contentHash = typeof input.contentHash === 'string' ? input.contentHash : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      const res = await toggleClipHidden(r.abs, artboardId, stableId, contentHash);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true, hidden: res.hidden };
      }
      return { ok: true, hidden: res.hidden, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'hide failed',
      };
    }
  }

  async function editArraySrcOp(input: {
    canvas?: unknown;
    arrayName?: unknown;
    index?: unknown;
    field?: unknown;
    value?: unknown;
  }): Promise<{ ok: true; seq?: number } | { ok: false; status: number; error: string }> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const arrayName = typeof input.arrayName === 'string' ? input.arrayName : '';
    const field = typeof input.field === 'string' ? input.field : 'src';
    const index = Number.isInteger(input.index) ? (input.index as number) : -1;
    const value = typeof input.value === 'string' ? input.value : '';
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arrayName)) {
      return { ok: false, status: 400, error: 'invalid array name' };
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field)) {
      return { ok: false, status: 400, error: 'invalid field' };
    }
    if (index < 0 || index > 500) return { ok: false, status: 400, error: 'invalid index' };
    if (!value.trim()) return { ok: false, status: 400, error: 'value required' };
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      await editArrayElementString(r.abs, arrayName, index, field, value);
      const after = await Bun.file(r.abs).text();
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
        return { ok: true };
      }
      return { ok: true, seq: logUndo(r.abs, before, after) };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'edit failed',
      };
    }
  }

  async function reorderSequenceOp(input: {
    canvas?: unknown;
    artboardId?: unknown;
    stableId?: unknown;
    contentHash?: unknown;
    refStableId?: unknown;
    refContentHash?: unknown;
    position?: unknown;
    /** 'move' = the magnetic drag commit: a real series MOVE (any distance)
     *  instead of the legacy adjacent swap. */
    mode?: unknown;
  }): Promise<
    | { ok: true; stableId: string | null; seq?: number }
    | { ok: false; status: number; error: string }
  > {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const stableId = typeof input.stableId === 'string' ? input.stableId : null;
    const refStableId = typeof input.refStableId === 'string' ? input.refStableId : null;
    if (!stableId || !refStableId) {
      return { ok: false, status: 400, error: 'stableId and refStableId required' };
    }
    const position: MovePosition = input.position === 'before' ? 'before' : 'after';
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    const contentHash = typeof input.contentHash === 'string' ? input.contentHash : undefined;
    const refContentHash =
      typeof input.refContentHash === 'string' ? input.refContentHash : undefined;
    const rel = path.relative(paths.designRoot, r.abs);
    ctx.bus.emit('activity:suppress', rel);
    try {
      const before = await Bun.file(r.abs).text();
      const res =
        input.mode === 'move'
          ? await seriesMove(
              r.abs,
              artboardId,
              stableId,
              contentHash,
              refStableId,
              refContentHash,
              position
            )
          : await reorderClip(
              r.abs,
              artboardId,
              stableId,
              contentHash,
              refStableId,
              refContentHash,
              position
            );
      const after = await Bun.file(r.abs).text();
      let seq: number | undefined;
      if (after === before) {
        ctx.bus.emit('activity:unsuppress', rel);
      } else {
        try {
          await history.writeSnapshot(rel, before, 'pre-reorder-clip');
        } catch {
          /* snapshot best-effort */
        }
        seq = logUndo(r.abs, before, after);
      }
      return { ok: true, stableId: res.stableId, seq };
    } catch (err) {
      ctx.bus.emit('activity:unsuppress', rel);
      return {
        ok: false,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'reorder failed',
      };
    }
  }

  async function compClips(input: { canvas?: unknown; artboardId?: unknown }) {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const artboardId = typeof input.artboardId === 'string' ? input.artboardId : undefined;
    try {
      const source = await Bun.file(r.abs).text();
      const result = enumerateClips(r.abs, source, artboardId);
      // Strip the internal source offsets — the client addresses by stableId.
      const clips = result.clips.map(({ start: _s, end: _e, ...c }) => c);
      return {
        ok: true as const,
        compName: result.compName,
        artboardId: result.artboardId,
        fps: result.fps,
        durationInFrames: result.durationInFrames,
        clips,
        // DDR-150 dogfood #5 — loose media beds (audio/bg video) for replace.
        media: result.media,
      };
    } catch (err) {
      return {
        ok: false as const,
        status: err instanceof CanvasEditError ? 422 : 500,
        error: err instanceof Error ? err.message : 'enumerate failed',
      };
    }
  }

  async function reorderRevert(input: {
    canvas?: unknown;
    seq?: unknown;
    dir?: unknown;
  }): Promise<ReorderRevertResult> {
    const r = resolveCanvasAbs(input.canvas);
    if (!r.ok) return r;
    const dir = input.dir;
    if (dir !== 'undo' && dir !== 'redo') return { ok: false, status: 400, error: 'invalid dir' };
    const seq = typeof input.seq === 'number' ? input.seq : Number.NaN;
    const entry = Number.isInteger(seq) ? reorderLog.get(seq) : undefined;
    if (!entry || entry.abs !== r.abs) {
      return {
        ok: false,
        status: 404,
        error: 'reorder not found (server restarted or log rotated)',
      };
    }
    try {
      const current = await Bun.file(r.abs).text();
      const expect = dir === 'undo' ? entry.after : entry.before;
      const write = dir === 'undo' ? entry.before : entry.after;
      // T26 — a project that saves through accepted revisions undoes the
      // ACTION this edit became: effect-aware, so a teammate's later change
      // elsewhere in the canvas neither blocks the undo nor gets reverted
      // with it (a whole-file swap could do only one of those).
      const runtime = ctx.syncControl?.current?.();
      if (runtime?.acceptedMode?.()) {
        const rel = path.relative(paths.repoRoot, r.abs);
        // Undo targets the edit's action; redo targets the undo that
        // reverted it (reverting a revert re-applies, effect-aware again).
        const actionId =
          dir === 'undo'
            ? (runtime.acceptedActionForContent?.(rel, entry.after) ?? null)
            : (entry.undoActionId ?? null);
        if (actionId) {
          const res = await runtime.acceptedUndo?.(actionId, dir === 'redo');
          if (res?.status === 'accepted' || res?.queued) {
            if (dir === 'undo') entry.undoActionId = res.actionId;
            else delete entry.undoActionId;
            return { ok: true, dir };
          }
          return {
            ok: false,
            status: 409,
            error:
              res?.code === 'base-conflict'
                ? 'someone changed the same thing since — undo skipped'
                : `undo refused (${res?.code ?? 'unknown'})`,
          };
        }
      }
      if (current !== expect) {
        return {
          ok: false,
          status: 409,
          error: 'canvas changed since this reorder — undo skipped',
        };
      }
      const rel = path.relative(paths.designRoot, r.abs);
      ctx.bus.emit('activity:suppress', rel);
      try {
        await Bun.write(r.abs, write);
      } catch (e) {
        ctx.bus.emit('activity:unsuppress', rel); // write failed — disarm the rim suppression
        throw e;
      }
      return { ok: true, dir };
    } catch {
      return { ok: false, status: 500, error: 'revert failed' };
    }
  }

  async function saveCanvasState(file: string, state: Record<string, unknown>) {
    if (!state || typeof state !== 'object') return;
    const safe: Record<string, unknown> = {};
    if (state.sections && typeof state.sections === 'object') safe.sections = state.sections;
    if (state.viewport && typeof state.viewport === 'object') {
      const v = state.viewport as { x?: number; y?: number; scale?: number };
      safe.viewport = {
        x: Number.isFinite(v.x) ? v.x : 0,
        y: Number.isFinite(v.y) ? v.y : 0,
        scale: Number.isFinite(v.scale) ? Math.min(8, Math.max(0.05, v.scale as number)) : 1,
      };
    }
    await Bun.write(canvasStatePath(file), JSON.stringify(safe, null, 2));
  }

  // ---------- Index data + System data ----------

  async function buildIndexData() {
    const groups = [];

    // DDR-093 — per-canvas design-system map (repo-relative canvas path → DS
    // name) so the client's canvasUrl() injects each UI canvas's OWN tokens
    // instead of unconditionally designSystems[0]. Populated from the canvas
    // groups below; returned on the payload and folded into the client cfg.
    const canvasDesignSystems: Record<string, string> = {};
    // DDR-174 (T15) — surface a canvas's `.meta.json` `kind` in the file tree
    // when it's a value the user should notice at a glance (today: only
    // `reconstructed-experimental`, so this map stays empty on every project
    // that hasn't run `/design:import --reconstruct`). Piggybacks on the same
    // `loadCanvasMeta` call the DDR-093 DS-map loop below already makes for
    // non-path-owned (`ui/`) canvases — no extra I/O for the common case.
    const canvasKinds: Record<string, string> = {};
    // DDR-216 D7 adds `imported-figma`. The badge deliberately reads as
    // THIRD-PARTY CONTENT rather than as provenance-therefore-trustworthy: a
    // clean "imported from Figma" stamp otherwise makes the most
    // attacker-influenced artifact in the tree look like real design work, to a
    // human AND to `design-system-keeper` / the critic panel.
    const NOTABLE_KINDS = new Set(['reconstructed-experimental', 'imported-figma']);
    const defaultDs = cfg.defaultDesignSystem || cfg.designSystems?.[0]?.name || 'project';
    // A file under `system/<folder>/` belongs to the DS that owns that folder —
    // path-authoritative, because specimens/ui_kits rarely carry a sidecar
    // `designSystem`. Returns null for `ui/` canvases (resolved via sidecar).
    const ownerDsName = (repoRelPath: string): string | null => {
      let r = repoRelPath;
      const prefix = `${paths.designRel}/`;
      if (r.startsWith(prefix)) r = r.slice(prefix.length);
      const m = r.match(/^system\/([^/]+)\//);
      if (!m) return null;
      const folder = m[1];
      const owner = (cfg.designSystems ?? []).find(
        (d) => d.path === `system/${folder}` || d.path.endsWith(`/${folder}`)
      );
      return owner?.name ?? null;
    };

    // PROJECT — top-level .design/ files (README.md, INDEX.md, config.json, …).
    // These are non-HTML so they're listed but not openable in the iframe; the
    // sidebar can still display them as context (mirrors CV-08 mock).
    const projectFiles: string[] = [];
    try {
      const entries = await readdir(paths.designRoot, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (e.name.startsWith('_')) continue;
        if (e.name.startsWith('.')) continue;
        if (!/\.(md|json|txt|yml|yaml|css)$/i.test(e.name)) continue;
        projectFiles.push(path.posix.join(paths.designRel, e.name));
      }
    } catch {}
    if (projectFiles.length) {
      groups.push({
        label: 'Project',
        paths: projectFiles,
        fullPath: paths.designRel,
        // Strip `.design/` — the section header already names the parent;
        // the chain `▾ .design → file` was redundant.
        stripPrefix: `${paths.designRel}/`,
        kind: 'project' as const,
      });
    }

    // Canvas groups — strip just `.design/` so the immediate subdir
    // (`system`, `ui`, …) shows up as a dir wrapper in the tree (mirrors
    // CV-08's `▾ ui` / `▾ system/project` headers).
    //
    // For DS groups (label === 'Design system' OR path starts with `system`)
    // we also include sibling .md / .css / .json so README, SKILL, and the
    // tokens CSS file render in the tree per CV-08 mock. Inert at click time
    // (FileRow non-HTML branch).
    for (const g of cfg.canvasGroups) {
      const groupAbs = path.join(paths.designRoot, g.path);
      const groupRel = path.posix.join(paths.designRel, g.path);
      const isDs = g.label === 'Design system' || /^system(\/|$)/.test(g.path);
      // Always include canvas sidecars (`.meta.json`, `.css`, `.registry.json`)
      // so the client can nest them under their primary `.tsx` / `.html`. DS
      // groups additionally surface `.md` for README + SKILL docs, plus
      // PREVIEW_ASSET_EXTS (images/fonts/video/audio) so assets/ subfolders
      // list their files instead of rendering as permanently-empty tree nodes
      // (feature-studio-file-preview) — click-time behavior lives client-side
      // in FileRow's previewKind() branch.
      // feature-file-tree-drag-drop-folders (Task 6) — `dirs` accumulates
      // every directory in this group (incl. empty ones) via the SAME
      // traversal, so a freshly `mkdir`'d folder with no files yet is still
      // representable in the tree.
      const dirs: string[] = [];
      const filePaths = isDs
        ? await findFiles(
            groupAbs,
            groupRel,
            ['.tsx', '.html', '.md', '.css', '.json', ...PREVIEW_ASSET_EXTS],
            dirs
          )
        : await findFiles(
            groupAbs,
            groupRel,
            ['.tsx', '.html', '.css', '.json', ...PREVIEW_ASSET_EXTS],
            dirs
          );
      // DDR-093 — record each `.tsx` canvas's design system. canvasUrl() only
      // injects tokens for `.tsx`, so skip everything else. Path-owned DS wins
      // (system/<ds>/…); otherwise the sidecar's `meta.designSystem`, defaulting
      // to the project default when the canvas declares none.
      for (const fp of filePaths) {
        if (!fp.endsWith('.tsx')) continue;
        let dsName = ownerDsName(fp);
        if (!dsName) {
          const meta = await loadCanvasMeta(fp);
          const declared = meta?.designSystem;
          dsName = typeof declared === 'string' && declared.trim() ? declared : defaultDs;
          const kind = meta?.kind;
          if (typeof kind === 'string' && NOTABLE_KINDS.has(kind)) canvasKinds[fp] = kind;
        }
        canvasDesignSystems[fp] = dsName;
      }
      // Strip down to `g.path` so per-DS folders (`project`, `beta`, …) show
      // up as the top-level dirs inside the DS section. Single-DS configs get
      // a wrapper folder too — slightly more verbose, but consistent with
      // multi-DS and gives the user one click-target per DS to open its
      // SystemView.
      const matchedDs =
        g.label === 'Design system'
          ? (cfg.designSystems ?? []).filter(
              (d) => d.path === g.path || d.path.startsWith(`${g.path}/`)
            )
          : [];
      const dsFolders = matchedDs.map((d) => ({
        name: d.name,
        path: d.path,
        // Folder name relative to the group root — what the client will see as
        // a top-level dir name inside the tree.
        folder:
          d.path === g.path
            ? d.path.split('/').pop() || d.path
            : d.path.slice(g.path.length + 1).split('/')[0],
      }));
      groups.push({
        label: g.label,
        paths: filePaths,
        fullPath: groupRel,
        stripPrefix: `${paths.designRel}/${g.path}/`,
        kind: 'canvas' as const,
        dsFolders: dsFolders.length ? dsFolders : undefined,
        dirs,
      });
    }

    // RUNTIME — gitignored state files (_active.json, _server.json) +
    // pointers to _history/ and _comments/ dirs. Visible but inert in the
    // sidebar; matches the CV-08 mock's bottom section.
    const runtimeFiles: string[] = [];
    try {
      const entries = await readdir(paths.designRoot, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (!e.name.startsWith('_')) continue;
        runtimeFiles.push(path.posix.join(paths.designRel, e.name));
      }
    } catch {}
    if (runtimeFiles.length) {
      groups.push({
        label: 'Runtime',
        paths: runtimeFiles,
        fullPath: paths.designRel,
        // Same as PROJECT — strip `.design/` so each row sits flat under the
        // section header instead of nested under a redundant `.design` dir.
        stripPrefix: `${paths.designRel}/`,
        kind: 'runtime' as const,
      });
    }

    return {
      project: cfg.name,
      projectLabel: ctx.projectLabel,
      designRoot: paths.designRel,
      groups,
      canvasDesignSystems,
      canvasKinds,
    };
  }

  function tokenKind(name: string, value: string): string {
    const n = name.toLowerCase();
    const v = String(value).trim();
    if (/(color|fg|bg|border|accent|status|surface|text)/.test(n)) return 'color';
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return 'color';
    if (/^(rgb|rgba|hsl|hsla|oklch|color)\(/i.test(v)) return 'color';
    if (/(font-size|fs|text)/.test(n) && /\d/.test(v)) return 'fontsize';
    if (/(font|family|display|sans|mono)/.test(n)) return 'font';
    if (/(radius|r-)/.test(n)) return 'radius';
    if (/(shadow|elev)/.test(n)) return 'shadow';
    if (/(space|gap|s-|spacing)/.test(n)) return 'space';
    if (/(weight|fw)/.test(n)) return 'weight';
    if (/(line-height|lh|leading)/.test(n)) return 'leading';
    if (/(duration|ease|motion)/.test(n)) return 'motion';
    return 'other';
  }

  function parseTokens(css: string) {
    const tokens: { name: string; value: string; kind: string }[] = [];
    const re = /(--[a-z][a-z0-9-]*)\s*:\s*([^;}]+);/gi;
    const seen = new Set<string>();
    for (const m of css.matchAll(re)) {
      const name = m[1]?.trim() ?? '';
      const value = m[2]?.trim() ?? '';
      const key = `${name}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ name, value, kind: tokenKind(name, value) });
    }
    return tokens;
  }

  /**
   * Build the System view payload.
   *
   * - When `dsName` is null/undefined, scope to the top-level system dir
   *   (`paths.systemDirRel`) and read tokens from `cfg.tokensCssRel`. This is
   *   the legacy single-DS shape every pre-DDR-048 caller sees.
   * - When `dsName` is provided, scope to the matching `designSystems[]` entry:
   *   `sysAbs`/`sysRel` point at the DS folder, `tokensAbs` reads from the
   *   per-DS `tokensCssRel` (auto-resolved by `normalizeDesignSystems`), and
   *   the previews/ui_kits galleries are restricted to that DS subtree.
   *
   * Returns `null` when `dsName` is set but not found in `cfg.designSystems` so
   * the HTTP handler can 404 instead of silently falling back.
   *
   * DDR-048 — system view renders user tokens only; the per-DS scope is what
   * keeps multi-DS projects from blending the wrong tokens into the wrong
   * preview gallery.
   */
  async function buildSystemData(dsName?: string | null) {
    let dsEntry: NonNullable<typeof cfg.designSystems>[number] | null = null;
    if (dsName) {
      dsEntry = cfg.designSystems?.find((d) => d.name === dsName) ?? null;
      if (!dsEntry) return null;
    }

    const scopedSystemRel = dsEntry ? dsEntry.path : paths.systemDirRel;
    const sysAbs = path.join(paths.designRoot, scopedSystemRel);
    const sysRel = path.posix.join(paths.designRel, scopedSystemRel);

    let readme: string | null = null;
    let readmePath: string | null = null;
    const readmeCandidates = [
      path.join(paths.designRoot, 'README.md'),
      path.join(sysAbs, 'README.md'),
    ];
    try {
      const subs = await readdir(sysAbs, { withFileTypes: true });
      for (const s of subs)
        if (s.isDirectory()) readmeCandidates.push(path.join(sysAbs, s.name, 'README.md'));
    } catch {
      /* ignore */
    }
    for (const c of readmeCandidates) {
      try {
        readme = await readFile(c, 'utf8');
        readmePath = path.relative(paths.repoRoot, c);
        break;
      } catch {
        /* ignore */
      }
    }

    let tokens: ReturnType<typeof parseTokens> = [];
    let tokensPath: string | null = null;
    // Per-DS tokens path (auto-resolved by normalizeDesignSystems) wins; the
    // top-level cfg.tokensCssRel is a project-wide fallback for legacy
    // single-DS configs that don't declare `designSystems[]`. DDR-048.
    const tokensCssRel = dsEntry?.tokensCssRel ?? cfg.tokensCssRel;
    try {
      const tokensAbs = path.join(paths.designRoot, tokensCssRel);
      const css = await readFile(tokensAbs, 'utf8');
      tokens = parseTokens(css);
      tokensPath = path.relative(paths.repoRoot, tokensAbs);
    } catch {
      /* ignore */
    }
    const tokenGroups: Record<string, typeof tokens> = {};
    for (const t of tokens) {
      const group = tokenGroups[t.kind] ?? [];
      group.push(t);
      tokenGroups[t.kind] = group;
    }

    async function galleryFor(folderName: string) {
      const matches: { abs: string; rel: string }[] = [];
      try {
        // When scoped to a single DS (sysAbs IS the DS folder), only check
        // the DS-relative `<folderName>` subdir — scanning sub-dirs here
        // would treat the DS's own `preview/` as a sibling DS root.
        if (!dsEntry) {
          const subs = await readdir(sysAbs, { withFileTypes: true });
          for (const s of subs) {
            if (!s.isDirectory()) continue;
            const candidate = path.join(sysAbs, s.name, folderName);
            try {
              const st = await statp(candidate);
              if (st.isDirectory())
                matches.push({ abs: candidate, rel: path.posix.join(sysRel, s.name, folderName) });
            } catch {
              /* ignore */
            }
          }
        }
        try {
          const st = await statp(path.join(sysAbs, folderName));
          if (st.isDirectory())
            matches.push({
              abs: path.join(sysAbs, folderName),
              rel: path.posix.join(sysRel, folderName),
            });
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
      const items: { label: string; path: string; group: string }[] = [];
      for (const m of matches) {
        const files = await findFiles(m.abs, m.rel, ['.tsx', '.html']);
        for (const f of files) {
          const fname = (f.split('/').pop() ?? '').replace(/\.(tsx|html)$/i, '');
          const group = f.split('/').slice(-2, -1)[0] || folderName;
          const label = fname.toLowerCase() === 'index' ? group : fname;
          items.push({ label, path: f, group });
        }
      }
      return items;
    }

    const previewGallery = await galleryFor('preview');
    const uiKitsGallery = await galleryFor('ui_kits');

    // Always advertise the available DSes so the client can render the picker
    // even when the initial fetch was unscoped — avoids a second roundtrip.
    const availableDesignSystems = (cfg.designSystems ?? []).map((d) => ({
      name: d.name,
      path: d.path,
      description: d.description ?? null,
    }));

    return {
      project: cfg.name,
      designRoot: paths.designRel,
      systemDir: sysRel,
      ds: dsEntry
        ? {
            name: dsEntry.name,
            path: dsEntry.path,
            description: dsEntry.description ?? null,
            rootClass: dsEntry.rootClass ?? null,
            themeDefault: dsEntry.themeDefault ?? null,
          }
        : null,
      availableDesignSystems,
      defaultDesignSystem: cfg.defaultDesignSystem ?? availableDesignSystems[0]?.name ?? null,
      readme,
      readmePath,
      tokens,
      tokenGroups,
      tokensPath,
      previewGallery,
      uiKitsGallery,
      rootClass: dsEntry?.rootClass ?? cfg.rootClass,
      themeDefault: dsEntry?.themeDefault ?? cfg.themeDefault,
      teamAccentDefault: cfg.teamAccentDefault,
    };
  }

  return {
    fileSlug,
    loadCommentsForFile,
    saveCommentsForFile,
    loadAllComments,
    fileForSlug,
    commentsAdd,
    commentsPatch,
    commentsDelete,
    commentsAddReply,
    gitCommitters,
    gitCurrentUser,
    parseMentions,
    loadCanvasState,
    saveCanvasState,
    timelineMediaLoad,
    timelineMediaSave,
    loadCanvasMeta,
    loadCanvasSource,
    patchCanvasMeta,
    loadAnnotations,
    saveAnnotations,
    projectAnnotations,
    saveAsset,
    listAssets,
    readAssetBytes,
    writeCaptionSidecar,
    writeAudioIntent,
    searchAudioLibrary,
    listStickers,
    saveAssetFromStream,
    saveChatAttachment,
    resolveChatAttachment,
    createCanvas,
    duplicateCanvas,
    deleteCanvas,
    moveCanvas,
    createFolder,
    editCss,
    editText,
    editAttr,
    clipEditOp,
    removeSequenceOp,
    insertSequenceOp,
    reorderSequenceOp,
    editArraySrcOp,
    toggleHideOp,
    compClips,
    reorder,
    retimeSequenceOp,
    convertChildrenToAbsoluteOp,
    detachComponentOp,
    deleteElementOp,
    insertElementOp,
    insertArtboardOp,
    resizeArtboardOp,
    setArtboardHugOp,
    setArtboardStyleOp,
    setArtboardKindOp,
    setArtboardLabelOp,
    setArtboardGuidesOp,
    setArtboardPrintOp,
    deleteArtboardOp,
    duplicateArtboardOp,
    duplicateElementOp,
    editScopeOp,
    componentMapOp,
    reorderRevert,
    buildIndexData,
    buildSystemData,
  };
}
