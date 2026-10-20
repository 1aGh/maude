// apps/studio/bridge/dgn-protocol.ts — the ONE typed shell↔canvas `dgn` message table (V2-1.2 §5.2).
//
// Both documents import it: the shell (`client/hooks/*` via `../../bridge/dgn-protocol.ts`) and the
// canvas runtime (`canvas-shell.tsx`, `canvas-comment-mount.tsx`, … via `./bridge/…`; bundled into
// the canvas-lib runtime and comment-mount). Leaf module: no React, no DOM beyond the
// `MessageEvent` / `Window` types; type-only imports only (erased).
//
// Per message: direction (`c2s` / `s2c`), `gate` (who may send it — enforced today), `target` (the
// gate the §5.2 arrow tightens it to in V2-2.10c, when different), `status`, the `owner` of its
// semantics, and `parse` (strips unknown keys; strings ≤ 4 000, arrays ≤ 10 000; junk → null).
//
// Drift gate: test/dgn-protocol-coverage.test.ts runs scripts/v2-dgn/dgn-inventory.mjs over the
// sources — every `dgn` literal must be a row here, with the direction the code uses, and every
// live row must still have its sender and handler. Adding a literal outside this table fails it.
//
// Gate vocabulary. Shell side (after `e.origin === canvasOrigin`): `active` — `e.source` is the
// active canvas window (never `null === null`); `asked` — the frame the shell asked (by `id`);
// `frame` — any iframe the shell owns; `any` — any canvas-origin window. Canvas side: `parent` —
// `e.source === window.parent`; `parent|self` — also the canvas document posting to itself; `any`.

import type { ApplyEditMessage } from '../client/apply-edit-request.ts';
import type { AiActivityEntry } from '../collab/ai-activity.ts';
import type { EditOpCode, ElementRef } from '../edit-ops/types.ts';
import type { PhotoEdit } from '../photo/schema.ts';
import type { Selection } from '../use-selection-set.tsx';
import {
  CANVAS_MODES,
  type CanvasModeV2,
  type ModeCaps,
  PRESENT_KINDS,
  type PresentSpec,
  TOOL_IDS,
  type ToolId,
} from './canvas-modes.ts';
import { clampInsets, type Insets } from './occlusion.ts';

export const DGN_V = 2;
type Id = string;
type Rect = { x: number; y: number; w: number; h: number };
/** S4.8 — what the annotation tools remember per person (annotations/ui/tool-prefs.ts is the palette gate). */
export type AnnotationPrefsPayload = {
  stickyColor?: string;
  ink?: string;
  thickness?: 3 | 6;
  tip?: 'pen' | 'highlighter' | 'eraser';
  highlighterColor?: string;
  highlighterWidth?: number;
};
/** S2.19 — what the prompt may say of a selected element: locators only, never its markup (DDR-054). */
export type AskLocator = {
  id?: string;
  tag?: string;
  text?: string;
  selector?: string;
  index?: number;
};

// Payload shapes still private to their modules (names fixed by the contract). Opaque here; each is
// lifted beside its builder when its listener is routed through the accept helpers (V2-2.10b).
/** S2.1 — one rung of the selection's breadcrumb (S2-edit-ops.md §7). */
export type SelectionCrumb = { label: string; ref: ElementRef | null };
export const SELECTION_KINDS = [
  'frame',
  'text',
  'image',
  'path',
  'shape',
  'instance',
  'artboard',
  'multi',
] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];

export type InsertAnchor = {
  refId?: string;
  refIndex?: number;
  artboardId?: string | null;
  position?: string;
};
export type ConvertToAbsoluteRequest = {
  artboardId?: string;
  allowShared?: boolean;
  containers?: unknown[];
  dissolve?: unknown[];
  containerId?: string;
  children?: unknown[];
  containerSetRelative?: boolean;
};
export type LayerNode = Record<string, unknown>;
export type CommentThread = Record<string, unknown>;
export type CommentDraft = Record<string, unknown>;
export type CommentPatch = Record<string, unknown>;
export type CapturedItem = Record<string, unknown>;
export type ExportPayload = Record<string, unknown>;
export type ExportResult = { ok: boolean; browser?: boolean; jobId?: string; error?: string };
export type ExportHistoryEntry = Record<string, unknown>;
export type OpenExportDetail = Record<string, unknown>;
export type TimelineComp = Record<string, unknown>;
export type RecordEditPayload = Record<string, unknown>;
export type GitLifecycleEvent = Record<string, unknown>;
/** S9.22 — the overlay's request id (`cm<n>`), echoed back so it can match the answer. */
export type ReqId = string | number;
/** S9.22 — one comment op as the overlay asks it; `op` is one of COMMENT_OPS, the rest the door's. */
export type CommentOpRequest = { op: string } & Record<string, unknown>;
/** S9.22 — a mention row as the popover shows it (comments/people.ts `MentionRow`). */
export type MentionPerson = { id: string; name: string; role?: string };
type Empty = Record<string, never>;

/** canvas → shell (posted to window.parent) */
export interface CanvasToShell {
  // lifecycle
  loaded: { file: string };
  'canvas-rendered': { file: string };
  'canvas-failed': { file: string };
  'canvas-mounted': { file: string; children: number };
  // S6.12 (C5) — the canvas could not draw / drew without an error. `message` is plain text (≤ 300). The
  // shell never trusts `file`: it names the frame the message came from (DDR-054).
  'render-error': { file: string; message: string };
  'render-ok': { file: string };
  // S10.4 (V2-1.6 §5.8) — the `data-ds-rev` values (`head` | a revision id) the canvas document carries;
  // the studio answers with `ds-pins`. A value is a name, never a path.
  'ds-pins-want': { revs: string[] };
  // S10.8 — "Review…" on the Design system canvas's bar: the person asks for "Update N canvases". The canvas
  // only asks; the shell opens the sheet (client/v2/ds/review-host.jsx), for the canvas on screen.
  'ds-review': Empty;
  'canvas-expired': Empty;
  // S4.9 — the annotation board of `file` changed (a local write, a peer's, an undo): the shell's
  // Preview annotation list (client/v2/annotations/annotation-list.jsx) re-reads it.
  'annotations-changed': { file: string };
  // S4.12 (S4-S9 §3.3) — Turn into a comment: the canvas names the sticky; the SHELL calls
  // POST /_api/annotations/to-comment with the active canvas as `file` (the canvas is untrusted, DDR-054).
  'annotation-to-comment': { id: string };
  // S4.12 (S4-S5 §1) — what is selected on the annotation layer: ids, a count per type and the artboards
  // they ride with — never their words. `ids: []` clears. The AI chat's scope chip reads it (S4.15).
  'annotation-selection': { ids: string[]; kinds: Record<string, number>; artboards: string[] };
  // S4.12 — a toast the shell owns, because a canvas notice cannot carry an Undo button
  // (decision v2-S4.9-shell-owns-hidden-toast): "6 stickies moved to the trash" + Undo.
  'annotation-toast': { v: 1; message: string; undo: boolean };
  // S4.12 — ⌘/ (or Ask AI about it) with annotations selected: open the AI chat with that scope.
  'annotation-ask-ai': { v: 1 };
  // S9.21b (10 co-ask-edit) — a read-only canvas saw a drag on the design go nowhere; the shell shows its own
  // "You can look at …, not change it." tip. No text, no element, no position (DDR-054).
  'view-only-gesture': { v: 1 };
  // S4.14 (S4-S9 §2.6) — a formal vote. The canvas holds no vote: it names an artboard for one dot more or
  // less (`remove`), and the SHELL posts the ballot to /_api/votes/ballot as the session.
  'vote-cast': { artboard: string; remove?: boolean };
  // S4.14 — the canvas's artboards (names + world rects; untrusted, text only) for the Start a vote sheet
  // and the result section's place. `open` = "Start a vote…" (⌘K / the artboard's right-click, `focus`).
  'vote-board': {
    artboards: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }>;
    open?: boolean;
    focus?: string;
  };
  // S4.18 (an-visibility) — ⇧P pressed inside the canvas hid or showed the layer: the shell keeps the pref
  // and shows "Annotations hidden. Press ⇧P to bring them back." + Show (it owns that toast).
  'annotations-visibility': { v: 1; visible: boolean };
  'canvas-notice': {
    message: string;
    kind: 'info' | 'success' | 'error' | 'warning' | 'undo';
  };
  'embed-escape': Empty;
  // selection + inline edit
  'select-set': {
    selection: Selection | Selection[] | null;
    /** S2.1 (S2-edit-ops.md §7) — the selection as refs; computed ids stay transient */
    refs?: ElementRef[];
    /** artboard › … › selected, outermost first; `ref: null` = the artboard */
    crumbs?: SelectionCrumb[];
    kind?: SelectionKind;
  };
  'edit-text': { id: Id; file: string; text: string; occurrence?: number; before?: string };
  'apply-edit': ApplyEditMessage & { requestId: string };
  'undo-barrier': { requestId: string };
  /** S2.20b — ⌘Z (`redo: false`) / ⇧⌘Z pressed in an op-log canvas: the shell's projection runs it */
  'undo-key': { redo: boolean };
  /** S2.1 — one structural edit; the shell pins `file` to the active canvas (S2-edit-ops.md §6) */
  'edit-op': {
    requestId: string;
    op: string;
    targets: ElementRef[];
    params?: Record<string, unknown>;
    expectRev?: string;
  };
  'active-artboard': { id: Id | null };
  /**
   * S2.11b — the slot a lifted card would land in, for Layers to draw the same numbered place
   * (ed-lay-reorder). `index` is 1-based among `total` siblings of the frame `parentId`; `index: 0`
   * = the drag ended (no slot). A frame with no `data-cd-id` has no `parentId` and Layers draws none.
   */
  'reorder-slot': { index: number; total: number; parentId?: Id };
  'layers-tree': { artboardId: Id | null; tree: LayerNode[] };
  'open-inspector': { tab?: string };
  'copy-style': Empty;
  'paste-style': { id: Id };
  // structural write requests (the shell writes; main-origin routes only, DDR-054)
  'insert-request': InsertAnchor & { kind: 'div' | 'text' | 'image'; src?: string };
  'insert-image-request': InsertAnchor;
  'delete-request': { id: Id; idIndex?: number };
  'duplicate-request': { id: Id; idIndex?: number };
  'reorder-request': {
    id: Id;
    refId: Id;
    position: string;
    idIndex?: number;
    refIndex?: number;
  };
  'reorder-revert': { seq: number; dir: 'undo' | 'redo' };
  'reposition-request': {
    id: Id;
    left: string;
    top: string;
    beforeLeft?: string;
    beforeTop?: string;
    idIndex?: number;
  };
  'resize-request': {
    id: Id;
    patch: Record<string, string>;
    before?: Record<string, string>;
    idIndex?: number;
  };
  'replace-media-request': { id: Id; before?: string };
  'convert-to-absolute-request': ConvertToAbsoluteRequest;
  'delete-artboard-request': { artboardId: Id };
  'duplicate-artboard-request': { artboardId: Id; width?: number };
  'rename-artboard-request': { artboardId: Id; label: string };
  'resize-artboard-request': { artboardId: Id; width: number; height: number };
  'set-artboard-kind-request': { artboardId: Id; kind: string | null };
  'open-timeline-request': { artboardId: Id };
  // annotations / media
  'replace-annotation-media-request': { id: Id; before?: string };
  'edit-annotation-photo-request': { id: Id; asset: string };
  // (`open-sticker-picker` retired in V2-4.5c: the Stickers slot posts `tool-panel-open {panel:'stickers'}`)
  // comments
  'comment-compose': { selection: Selection };
  'comment-submit': { payload: CommentDraft };
  'comment-patch': { id: Id; patch: CommentPatch };
  'comment-delete': { id: Id };
  'comment-click': { id: Id };
  // S9.22 — the overlay asks the shell to run a comment op through `POST /_api/comments/op` (the op
  // is the door's to judge, comments/ops.ts) and for the mention people; the shell answers the asker.
  'comment-op': { reqId: ReqId; op: CommentOpRequest };
  'comment-people-request': { reqId: ReqId };
  // export
  'export-request': { id: Id; payload: ExportPayload };
  'export-history-request': { id: Id };
  'open-export': { detail: OpenExportDetail };
  'export-capture-progress': { id: Id; current: number; total: number };
  'export-capture-done': { id: Id; items: CapturedItem[] };
  'export-capture-error': { id: Id; message: string };
  'export-selection': { id: Id; selectors: string[] };
  // timeline
  'timeline-comps': { comps: TimelineComp[] };
  'timeline-frame': { id?: Id; frame: number };
  'timeline-ended': { id?: Id };
  /** S7.8 — the Player started / stopped (its own play and pause events): the shell's transport follows the truth. */
  'timeline-playing': { id?: Id; playing: boolean };
  // keys forwarded from the iframe (V2-1.3 / V2-2.4 — supersedes toggle-palette / shell-shortcut)
  key: { v: 1; chord: string; hint?: { artboardId?: Id } };
  // mode / tools
  'tool-cursor': { tool: ToolId };
  // (`present-enter` retired in V2-4.3b: Present lives in the Share cluster, shell-local)
  // V2-4.3b — who else is on the active canvas, from its Yjs awareness, for the Share cluster's faces.
  // Untrusted text: ≤ PEERS_MAX peers, names ≤ PEER_NAME_MAX, rendered as text only.
  // S9.23 — where each person is (the face menu, the people list): all optional, all checked by value.
  peers: {
    peers: Array<{
      clientID: number;
      name: string;
      color?: string;
      following?: boolean;
      artboard?: string;
      idleSince?: number;
      surface?: 'browser';
      inComments?: boolean;
    }>;
  };
  // S2.18 (A10, V2-1.15 §5.8) — the single selection's holds, for the inspector's view mode: a person
  // holding it (their name), and an AI run holding it (`held`) or another object of its artboard.
  // Untrusted text, rendered as text only; ≤ HOLD_LABEL_MAX.
  'hold-view': {
    person: { name: string } | null;
    label: string;
    ai: { label: string; held: boolean; mine: boolean } | null;
  };
  // legacy, no in-tree sender (accepted today; removal needs a characterization proof)
  select: { selection: Selection };
  'clear-select': Empty;
  artboards: { count: number };
  /** S11.2 — the ONE selected artboard has nothing on it (the shell draws the hint at `rect`, iframe viewport px);
   *  `rect: null` = it is not empty now / something else is selected. `label` / `from` are untrusted text. */
  'artboard-empty': {
    artboardId: Id | null;
    rect: Rect | null;
    label?: string;
    from?: string;
  };
  /**
   * S7.7 — the ONE selected whole artboard, for the timeline island: which (`artboardId`), what kind (`video` ⇒ the
   * island rises from it), its name and where it is (`rect`, iframe viewport px; re-sent while a video is selected so
   * the island follows pan and zoom). `{ artboardId: null }` = no whole artboard is selected now. `label` is untrusted.
   */
  'artboard-anchor': { artboardId: Id | null; kind?: string; label?: string; rect?: Rect | null };
  /**
   * S7.8 — Space went down and up inside 200 ms with no drag between: a TAP, not the Hand. The shell plays / pauses
   * the video the timeline follows (07 · ve-play). Carries nothing; a hold or a pan sends nothing at all.
   */
  'space-tap': Empty;
  /**
   * S2.19 (14 `ed-edge-ask`) — ⌘/ with elements selected: which (`refs`, with the canvas's locators for the
   * prompt's `[selected: …]` lines) and where (`rect`, iframe viewport px). The SHELL draws the bubble and owns
   * the words: a canvas never carries a prompt to the shell. `-rect`: the live AI outline over the asked
   * elements moved (`null`: it is gone — the run is over).
   */
  // S2.21: an artboard's "Ask AI about this artboard" names the artboard instead of elements (`refs` is [])
  'ask-selection': { refs: ElementRef[]; selection?: AskLocator[]; rect: Rect; artboard?: Id };
  'ask-selection-rect': { rect: Rect | null };
  'insert-artboard-request': { id?: Id; label?: string; width?: number; height?: number };

  // ── V2-1.2 mode lane — live since V2-4.3b (set-mode / mode-changed / mode-request); the rest new ──
  'mode-changed': {
    seq: number;
    mode: CanvasModeV2;
    tool: ToolId;
    present: PresentSpec | null;
    cause: 'set-mode' | 'tool' | 'clamp' | 'boot';
  };
  'mode-request': {
    mode: CanvasModeV2 | 'back';
    tool?: ToolId;
    present?: PresentSpec;
    cause: 'key' | 'esc' | 'inspect' | 'toolbar' | 'link';
  };
  'toolbar-rect': { mode: CanvasModeV2; rect: Rect | null };
  'tool-panel-open': {
    panel: 'stickers' | 'components' | 'templates' | 'assets' | 'sizes';
    anchor: Rect | null;
    /** S4.3: the id of the sticker being replaced (Replace… on a selected sticker opens the gallery in replace mode) */
    replace?: Id;
  };
  // S7.20: the canvas wrote a size-picker pick (`artboard.insert-preset`) at `world`; the shell closes the picker and
  // remembers the pick in Recent. Only after a write that went through.
  'size-place': { presetId: string; world: { x: number; y: number } };
  // S4.8 — a change to what the annotation tools remember per person (sticky colour, Marker ink / thickness /
  // tip, Highlighter hue / nib): the shell writes prefs.json and tells every canvas (`annotation-prefs`).
  // Only fields that are members of their palette survive `parse` + the receivers' sanitiser.
  'annotation-prefs-set': { prefs: AnnotationPrefsPayload };
  'viewport-zoom': { zoom: number };
  // S3.7a — `sid` / `seq` (S3-present-session §3): the presenting session, and its step count.
  'present-position': { index: number; total: number; artboardId: Id; sid?: string; seq?: number };
  // S3.6b — the Present run's artboards with their world rects and labels, in canvas order: the presenter
  // view's order map (the live layout exists only in the canvas). Untrusted: labels render as text only.
  'present-run': {
    artboards: Array<{ id: Id; label: string; x: number; y: number; w: number; h: number }>;
  };
  // S3.7a — a follower canvas tells its follower page (client/v2/present/follow-view.jsx) what it shows.
  // Untrusted: `presenterName` is rendered as text only and re-clamped by the page.
  'present-follow-state': {
    live: boolean;
    sid: string | null;
    presenterName: string;
    presenterIndex: number;
    index: number;
    total: number;
    watchers: number;
    ended: boolean;
  };
  // S3.3 — the clip on the presented artboard (video-comp): the shell's transport mirrors it. `t` and
  // `duration` are seconds, 0..86400.
  // S3.8 — `sources`: the media files the clip uses (src URLs, ≤ 8 × 400 chars); `missing`: its media failed to
  // load, so it holds its first frame. Untrusted: the shell only compares them with what is on this Mac.
  'present-media': {
    playing: boolean;
    t: number;
    duration: number;
    muted: boolean;
    sources?: string[];
    missing?: boolean;
  };
  /** S3.10a — a plain click in Preview on an element with `data-cd-link` + `data-cd-id`. Never the target:
   *  the shell reads it from the TSX (`GET /_api/links`, S3-links-format §1.3). */
  'link-follow': { elementId: Id; artboardId: Id | null };
  // S8.19 — the placeholder frame's Relink… (a Missing picture): the shell opens its relink sheet for
  // that rel. The canvas asks; the shell decides (the write is the shell's `asset.relink` edit op).
  'asset-relink-request': { rel: string };
}

/** S8.19 — one picture's state, as the shell tells the canvas (contract S8-S9-asset-presence §5.5). */
export interface AssetStateItem {
  rel: string;
  state: 'here' | 'uploading' | 'waiting' | 'missing';
  /** A display name only — never an e-mail, never a device id. */
  who?: { name: string | null; kind: 'mac' | 'pc' | 'linux' | null; self: boolean };
  /** The hub already has the bytes; this Mac has not pulled them yet ("Syncing…"). */
  syncing?: boolean;
}

/** shell → canvas (posted to iframe.contentWindow) */
export interface ShellToCanvas {
  // chrome + view (DDR-117 family)
  theme: { theme: 'light' | 'dark' };
  'view-chrome': Partial<{
    minimap: boolean;
    zoom: boolean;
    present: boolean;
    guides: boolean;
    print: boolean;
    safeZones: boolean;
  }>;
  'view-annotations': { visible: boolean };
  'canvas-cap': { t: string };
  // S10.4 — the follower swap: the two designRoot-relative `.css` files the canvas follows now
  // (client/v2/ds/follower-swap.js decides WHEN; the shell swaps `#canvas-tokens` / `#canvas-components`).
  'ds-css': { tokens?: string | null; components?: string | null };
  // S10.4 — element pins: per `data-ds-rev` value, the sibling files of the revision it names (loaded by
  // the shell document and scoped with ds/pin-scope.ts); a value not listed keeps the canvas's own look.
  'ds-pins': {
    revs: Record<string, { tokens: string; components: string | null }>;
    rootClass: string | null;
  };
  // S10.8 — a canvas left out of a design-system update: the `data-cd-id`s of the elements that wear what
  // changed (client/v2/ds/update-dots.js names them from the usage index); the shell document draws a dot.
  'ds-update-dots': { ids: string[] };
  'ai-activity': { file: string; entry: AiActivityEntry | null };
  // selection + edit round-trips
  'select-by-id': { id?: Id; artboardId?: Id | null; index?: number };
  /** S11.9 — Layers › Advanced › Select by selector: the canvas selects what the selector matches inside its
   *  artboards (capped at 500, scoped to `[data-dc-screen]`). */
  'select-by-selector': { selector: string };
  highlight: { id: Id | null; artboardId?: Id | null; index?: number };
  'request-layers': { artboardId: Id | null };
  'force-clear': Empty;
  'select-clear': Empty;
  'locked-set': { locked: string[] };
  'apply-style': {
    id: Id;
    artboardId?: Id | null;
    index?: number;
    prop: string;
    value: string | null;
  };
  'record-edit': { payload: RecordEditPayload };
  'apply-edit-result': { requestId: string; ok: boolean; error?: string; conflict?: boolean };
  'undo-barrier-ok': { requestId: string };
  /** S2.1 — the route's answer (`EditOpResult`, flattened) */
  'edit-op-result': {
    requestId: string;
    ok: boolean;
    actionId?: string | null;
    writeId?: string;
    rev?: string;
    refs?: ElementRef[];
    created?: ElementRef[];
    code?: EditOpCode;
    message?: string;
  };
  'edit-reverted': { op: string; id?: Id; reason?: string };
  'reorder-failed': Empty;
  'reposition-failed': Empty;
  'resize-failed': Empty;
  'resize-artboard-failed': Empty;
  'freeze-and-set-kind': {
    artboardId: Id;
    kind: string | null;
    ask?: boolean;
    freeze?: boolean;
  };
  'op-toast': { message: string };
  'tool-set': { tool: ToolId };
  // annotations / media
  // `sticker` (S4.3): which bundled sticker the bytes at `path` came from, so Replace/Flip/Recent can
  // name it (`pack` = the pack slug, `id` = its file); `path` alone (a pasted PNG) stays valid
  'insert-sticker': {
    path: string;
    follow?: boolean;
    sticker?: { pack: string; id: string; flip?: boolean };
  };
  // S4.4: a Templates-panel pick (`id` is an annotations/templates.ts id); the canvas expands the same
  // spec `annotate --board <id>` does and, with `follow`, the ghost trails the pointer until a click (S4.13)
  'insert-template': { id: string; follow?: boolean };
  // S2.16: a Component-picker pick (⇧I). `component` is a `@maude/ds` export name (validated here, and
  // again by the `component.insert` writer); `mode` 'ghost' = the pick follows the pointer until a click,
  // 'selection' = ↵ puts it in the selected frame. Accepted only from the shell (`gate: 'parent'`).
  'place-component': {
    component: string;
    label?: string;
    variant?: string;
    glyph?: string;
    mode: 'ghost' | 'selection';
  };
  // S7.20: the F size picker's hover — where the artboard of this preset would land, dashed and labelled
  // ("FB event cover 1920 × 1005"); `null` = the pointer left the tiles. The canvas picks the place.
  'size-ghost': {
    preset: { id: string; label: string; sizeText: string; w: number; h: number } | null;
  };
  // S1.3: the Canvases panel's artboard jump list — ease (glide) or cut the camera to an artboard and
  // optionally flash its outline. The shell decides glide (reduced motion = cut); a repeat to the same
  // artboard while gliding is a no-op. canvas-lib's handler lands with the L1 slice that owns it.
  'reveal-artboard': { artboardId: Id; glide: boolean; flash: boolean };
  // S5.11 (V2-1.15 §5.8, P3): which artboards an AI is on, for the ring + tag the canvas draws. A state, a
  // name and a count per artboard — never a prompt, a question or a progress line (the canvas is untrusted).
  // `done` is the settled ring after a run (driven by the V2-1.5 action event, not the registry).
  'ai-runs': {
    artboards: Record<
      Id,
      { state: 'running' | 'needs-you' | 'done'; who: string; tag: string; waiting: number }
    >;
  };
  // S11.5 (05 es-all-trashed): the outlines an all-trashed canvas keeps. The shell reads the Trash itself and
  // sends ids, labels and where each stood (`rect: null` = unknown, left out); the canvas draws and never says
  // what is in the Trash. The table caps the strings (ids 128, labels 200); the layer draws at most 200.
  'trashed-artboards': {
    canvas: string;
    items: Array<{ id: Id; label: string; rect: Rect | null }>;
  };
  'insert-annotation-media': { paths: string[] };
  // `sticker` (S4.13): Replace… on a gallery sticker names the new one, so the canvas keeps its identity (a
  // pick that is not a gallery sticker omits it and the canvas clears the old identity)
  'replace-annotation-media': {
    id: Id;
    path: string;
    sticker?: { pack: string; id: string; flip?: boolean };
  };
  /** S8.15 — `use`: the `data-cd-id` of the one use being edited (absent = every use). */
  'photo-preview': { asset: string; edit: PhotoEdit | null; use?: string };
  'photo-busy': { asset: string; busy: boolean };
  // comments
  'comments-set': { comments: CommentThread[] };
  // S6.11b — `reply`: a thread landing (invite / mention) focuses the thread's reply field
  'comment-focus': { id: Id | null; reply?: true };
  // S9.22 — the shell's answers to `comment-op` / `comment-people-request`, to the frame that asked.
  'comment-op-ack': { reqId: ReqId | null };
  'comment-op-result': {
    reqId: ReqId | null;
    ok: boolean;
    comment?: CommentThread | null;
    status?: number;
    error?: string;
  };
  'comment-people': { reqId: ReqId | null; people: MentionPerson[] | null };
  // S4.17 — the Preview annotation list selects / filters on the canvas (handler: S4.9)
  'annotation-select': { v: 1; ids: string[] };
  'annotation-filter': { v: 1; authors: string[] };
  // export
  'export-capture': { id: Id; format: string; artboardIds: Id[]; scale: number };
  'export-selection-query': { id: Id };
  'export-result': { id: Id } & ExportResult;
  'export-history-result': { id: Id; history: ExportHistoryEntry[] };
  // timeline
  'timeline-play': { id?: Id };
  'timeline-pause': { id?: Id };
  'timeline-seek': { id?: Id; frame: number };
  'timeline-loop': { id?: Id; loop: boolean };
  'timeline-mute': { id?: Id; muted: boolean };
  'timeline-volume': { id?: Id; volume: number };
  'timeline-request-comps': Empty;
  // the shell runs a canvas action (V2-1.3 / V2-2.4 — supersedes undo/redo/zoom/selection-clear/
  // annotation-select-all)
  'run-action': { v: 1; id: string; params?: Record<string, unknown> };
  // dead send (no canvas handler) — keep declared, retire in V2-8.0
  'git-lifecycle': { payload: GitLifecycleEvent };

  // ── NEW (V2-1.2) ──
  'set-mode': {
    v: 2;
    seq: number;
    mode: CanvasModeV2;
    present: PresentSpec | null;
    tool?: ToolId;
    caps: ModeCaps;
  };
  'occluded-insets': { seq: number; insets: Insets };
  'present-step': { to: number | 'next' | 'prev' };
  // S3.7a — the follower page tells its canvas which session to follow (`sid: null` = the first
  // presenter seen), whether it is live, and whether it is the locked audience window.
  'present-follow': { sid: string | null; live: boolean; locked: boolean };
  // S3.3 — the shell's transport (and presenter view: `mute` on the Mac's canvas) drives the clip.
  'present-media-cmd': { op: 'play' | 'pause' | 'mute' | 'unmute' };
  // V2-4 gate (WCAG 2.1.4) — the per-Mac "Single-key shortcuts" switch: `false` → the canvas resolves no
  // character-key chord (V, /, ⇧0 …; actions/keys.ts › isCharacterChord). State, not an event: the shell
  // sends it on every change and seeds each canvas on `loaded` / `canvas-rendered`.
  'key-prefs': { singleKeys: boolean };
  // S4.8 (Q8) — the person's annotation-tool memory, seeded on `loaded` / `canvas-rendered` and re-sent on
  // each change made in another canvas. State, not an event.
  'annotation-prefs': { prefs: AnnotationPrefsPayload };
  // S4.14 (S4-S9 §2.6) — the vote the canvas shows: the projection only (targets, state, YOUR dots, the
  // counts once ended). Never a name, never another person's picks — the parser keeps nothing else.
  'vote-state': {
    vote: {
      id: string;
      targets: string[];
      state: 'open' | 'ended';
      perVoter: number;
      tallies?: Record<string, number>;
    } | null;
    mine: Record<string, number>;
  };
  // S2.18 (V2-1.15 §5.12) — what the canvas can't see for this person's `holding`: an inspector field has
  // focus (`field`), the app has focus (`app`), an inspector edit just landed (`gesture`). State, sent on
  // every change to the active canvas.
  'hold-intent': { field: boolean; app: boolean; gesture?: boolean };
  // S2.18 (V2-1.15 §5.8) — the objects live AI runs hold on this canvas (a run's `objects`): the canvas
  // draws the spark outline + tag and the click tip. A tag and a flag per object — never a prompt.
  'ai-holds': {
    /** `scope: true` (S2.19) — the object was ASKED about by a ⌘/ selection: the canvas draws those as one outline */
    holds: Array<{
      artboard: Id;
      element: Id;
      occurrence?: number;
      tag: string;
      mine: boolean;
      scope?: boolean;
      /** S5.19 (03 `ai-question`) — a spot the AI points at (a small spark ring, gone on a click); the tag is its name only */
      point?: boolean;
    }>;
  };
  // S4.15 (an-ai-read) — the places the AI means, while its "Make these changes" card is the latest message:
  // the annotation layer draws a dashed spark outline and a tag. `ref` is `ab:<artboard>` or `el:<artboard>/<id>`;
  // the tag is built by the shell from the ref alone (the element's name) — never a word of the agent's answer
  // (DDR-054, v2-lead-neutral-ai-ring-tags). `[]` clears.
  'ai-seen': { targets: Array<{ ref: string; tag: string }> };
  // S2.20 — pointing at an Undo history row lights the artboards it would undo; `[]` clears.
  'undo-preview': { artboards: string[]; tag: string | null };
  // S2.20b — state, not an event: `opLog: true` → the shell owns ⌘Z (the op log) and the canvas
  // keeps no durable stack; sent on every change and to a frame on `loaded` / `canvas-rendered`.
  'undo-mode': { opLog: boolean };
  // S8.19 — "Waiting for Jonas's Mac" vs Missing for the open canvas's media. State, not an event: the
  // shell sends the whole list on open, every 60 s while something waits, at reconnect and after a
  // sweep ends. ≤ 256 items; a name with an `@` is refused whole (the canvas never sees an e-mail).
  'asset-state': { items: AssetStateItem[] };
}

export type DgnMessage<M> = { [K in keyof M]: { dgn: K } & M[K] }[keyof M];
export type CanvasToShellMessage = DgnMessage<CanvasToShell>;
export type ShellToCanvasMessage = DgnMessage<ShellToCanvas>;
export type ShellGate = 'active' | 'asked' | 'frame' | 'any';
export type CanvasGate = 'parent' | 'parent|self' | 'any';
export type DgnStatus = 'live' | 'legacy' | 'new' | 'proposed';
export interface DgnSpec<P, G> {
  /** The gate enforced today (the accept helpers apply it). */
  gate: G;
  /** The §5.2 arrow: what V2-2.10c tightens `gate` to. Absent = already there. */
  target?: G;
  status: DgnStatus;
  /** The module that owns the semantics. */
  owner: string;
  /** A declared orphan: no in-tree sender, or no handler (inventory-checked). */
  orphan?: 'no-sender' | 'no-handler';
  parse: (raw: Record<string, unknown>) => P | null;
}

// ─── validators ───────────────────────────────────────────────────────────────
// A validator returns the cleaned value, `undefined` for an absent optional, or BAD.

const BAD: unique symbol = Symbol('dgn.bad');
type V = (v: unknown) => unknown;
export const MAX_STR = 4000;
export const MAX_ARR = 10000;
const MAX_DEPTH = 16;
const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const str: V = (v) => (typeof v === 'string' && v.length <= MAX_STR ? v : BAD);
const num: V = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : BAD);
const bool: V = (v) => (typeof v === 'boolean' ? v : BAD);
/** S3.3 — a time in seconds: finite, 0..86400 (a day), else the whole message is junk. */
const seconds: V = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86400 ? v : BAD;
/** S3.8 — the media files a presented clip uses: at most 8 strings of at most 400 chars. */
const mediaSources: V = (v) => {
  if (!Array.isArray(v) || v.length > 8) return BAD;
  for (const x of v) if (typeof x !== 'string' || x.length > 400) return BAD;
  return [...v];
};
const lit =
  (...xs: readonly unknown[]): V =>
  (v) =>
    xs.includes(v) ? v : BAD;
const opt =
  (f: V): V =>
  (v) =>
    v === undefined ? undefined : f(v);
// S3.10a — a linked element's authored id (V2-1.4 §4.2: never 8 hex) and its artboard (S3-links-format §9).
const linkElementIdV: V = (v) =>
  typeof v === 'string' &&
  v.length <= 48 &&
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v) &&
  !/^[0-9a-f]{8}$/.test(v)
    ? v
    : BAD;
const linkArtboardIdV: V = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : BAD;
const nul =
  (f: V): V =>
  (v) =>
    v === null ? null : f(v);
const arrOf =
  (f: V): V =>
  (v) => {
    if (!Array.isArray(v) || v.length > MAX_ARR) return BAD;
    const out: unknown[] = [];
    for (const x of v) {
      const r = f(x);
      if (r === BAD) return BAD;
      out.push(r);
    }
    return out;
  };
/** A JSON value with the caps applied at every depth (opaque payloads owned by other modules). */
const json: V = (v) => jsonAt(v, 0);
function jsonAt(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : BAD;
  if (typeof v === 'string') return v.length <= MAX_STR ? v : BAD;
  if (depth >= MAX_DEPTH || typeof v !== 'object') return BAD;
  if (Array.isArray(v)) {
    if (v.length > MAX_ARR) return BAD;
    const out: unknown[] = [];
    for (const x of v) {
      const r = jsonAt(x, depth + 1);
      if (r === BAD) return BAD;
      out.push(r);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (++n > MAX_ARR || k.length > MAX_STR) return BAD;
    const r = jsonAt((v as Record<string, unknown>)[k], depth + 1);
    if (r === BAD) return BAD;
    if (r !== undefined) out[k] = r;
  }
  return out;
}
const jsonObj: V = (v) => (isPlain(v) ? json(v) : BAD);
const strMap: V = (v) => {
  if (!isPlain(v)) return BAD;
  const out: Record<string, string> = {};
  const keys = Object.keys(v);
  if (keys.length > MAX_ARR) return BAD;
  for (const k of keys) {
    const r = str(v[k]);
    if (r === BAD || k.length > MAX_STR) return BAD;
    out[k] = r as string;
  }
  return out;
};
/** A map of validated values with a bounded key count; `__proto__`/`constructor`/`prototype` keys are REJECTED. */
export const RING_KEYS_MAX = 256;
const recOf =
  (f: V, max = RING_KEYS_MAX): V =>
  (v) => {
    if (!isPlain(v)) return BAD;
    const keys = Object.keys(v);
    if (keys.length > max) return BAD;
    const out: Record<string, unknown> = Object.create(null);
    for (const k of keys) {
      if (k.length > 200 || k === '__proto__' || k === 'constructor' || k === 'prototype')
        return BAD;
      const r = f(v[k]);
      if (r === BAD) return BAD;
      out[k] = r;
    }
    return out;
  };
/** S4.12 — an annotation element id as the layer mints it (`s_xxxxxxxx`) or a migrated one: word chars and dashes. */
const annotationIdV: V = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : BAD;
const shortStr =
  (max: number): V =>
  (v) =>
    typeof v === 'string' && v.length <= max ? v : BAD;
const dsName: V = (v) => (typeof v === 'string' && /^[A-Z][A-Za-z0-9]{0,63}$/.test(v) ? v : BAD);
const dsSlug: V = (v) => (typeof v === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v) ? v : BAD);
const count: V = (v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 9999 ? v : BAD;
const shape =
  (fields: Record<string, V>): V =>
  (v) => {
    if (!isPlain(v)) return BAD;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(fields)) {
      const r = fields[k](v[k]);
      if (r === BAD) return BAD;
      if (r !== undefined) out[k] = r;
    }
    return out;
  };
/** A whole number in [min, max]. */
const intIn =
  (min: number, max: number): V =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : BAD;
/** The `data-cd-id` grammar the writers accept (api.ts CD_ID_RE): word characters and dashes, 1–64. */
const cdId: V = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : BAD);
const rect = shape({ x: num, y: num, w: num, h: num });
/** A palette colour as the tools store it: `#rrggbb` or `#rrggbbaa` (the receivers check palette membership). */
const hexColour: V = (v) =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v) ? v : BAD;
const annotationPrefs = shape({
  stickyColor: opt(hexColour),
  ink: opt(hexColour),
  thickness: opt(lit(3, 6)),
  tip: opt(lit('pen', 'highlighter', 'eraser')),
  highlighterColor: opt(hexColour),
  highlighterWidth: opt(intIn(1, 64)),
});
const mode: V = lit(...CANVAS_MODES);
const tool: V = lit(...TOOL_IDS);
const present = shape({ kind: lit(...PRESENT_KINDS), from: opt(str) });
const caps = shape({ edit: bool, annotate: bool, comment: bool, present: opt(bool) });
const PRESENT_SID = /^[a-z0-9]{8,32}$/;
const sid: V = (v) => (typeof v === 'string' && PRESENT_SID.test(v) ? v : BAD);
export const PRESENT_NAME_MAX = 64;
const presenterName: V = (v) => (typeof v === 'string' && v.length <= PRESENT_NAME_MAX ? v : BAD);
const insets: V = (v) => clampInsets(v) ?? BAD;
/** S10.4 — a designRoot-relative `.css` path; the same rule as the shell's `DS_CSS_REL` (no URL, no `..`). */
const DS_CSS_REL = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9 ._/-]{0,255}\.css$/;
const dsCssPath: V = (v) => (typeof v === 'string' && DS_CSS_REL.test(v) ? v : BAD);
/** S10.4 — a `data-ds-rev` value: `head` or a revision id. */
const PIN_VALUE = /^(?:head|[0-9a-f]{64})$/;
export const DS_PINS_MAX = 16;
const pinValue: V = (v) => (typeof v === 'string' && PIN_VALUE.test(v) ? v : BAD);
const pinValues: V = (v) =>
  Array.isArray(v) && v.length <= DS_PINS_MAX ? arrOf(pinValue)(v) : BAD;
/** S10.8 — the element ids a left-out canvas dots: `data-cd-id` values, capped (client/v2/ds/update-dots.js). */
export const DS_DOTS_MAX = 200;
const DOT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const dotId: V = (v) => (typeof v === 'string' && DOT_ID.test(v) ? v : BAD);
const dotIds: V = (v) => (Array.isArray(v) && v.length <= DS_DOTS_MAX ? arrOf(dotId)(v) : BAD);
const dsPinEntry = shape({ tokens: dsCssPath, components: nul(dsCssPath) });
const dsPinRevs: V = (v) => {
  if (!isPlain(v)) return BAD;
  const keys = Object.keys(v);
  if (keys.length > DS_PINS_MAX) return BAD;
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    if (pinValue(k) === BAD) return BAD;
    const r = dsPinEntry(v[k]);
    if (r === BAD) return BAD;
    out[k] = r;
  }
  return out;
};
const rootClassName: V = (v) =>
  typeof v === 'string' && /^[A-Za-z_][\w-]{0,63}$/.test(v) ? v : BAD;
/** S3.6b — `present-run`: at most this many artboards (the follow fields' 0..2000 index range). */
export const PRESENT_RUN_MAX = 2000;
const presentRunCell = shape({
  id: shortStr(200),
  label: shortStr(200),
  x: num,
  y: num,
  w: num,
  h: num,
});
const presentRunList: V = (v) =>
  Array.isArray(v) && v.length <= PRESENT_RUN_MAX ? arrOf(presentRunCell)(v) : BAD;
/** `peers` (V2-4.3b): a planted or oversized list is REJECTED whole, never trimmed. */
export const PEERS_MAX = 32;
export const PEER_NAME_MAX = 64;
const PEER_COLOR = /^(#[0-9a-f]{3,8}|oklch\([0-9.%\s/-]{1,40}\))$/i;
const PEER_ARTBOARD = /^[A-Za-z0-9_-]{1,64}$/;
type PeerEntry = {
  clientID: number;
  name: string;
  color?: string;
  following?: boolean;
  artboard?: string;
  idleSince?: number;
  surface?: 'browser';
  inComments?: boolean;
};
const peerList: V = (v) => {
  if (!Array.isArray(v) || v.length > PEERS_MAX) return BAD;
  const out: PeerEntry[] = [];
  for (const x of v) {
    if (!isPlain(x)) return BAD;
    const { clientID, name, color, following, artboard, idleSince, surface, inComments } = x;
    if (typeof clientID !== 'number' || !Number.isSafeInteger(clientID) || clientID < 0) return BAD;
    if (typeof name !== 'string' || name.length > PEER_NAME_MAX) return BAD;
    if (color !== undefined && (typeof color !== 'string' || !PEER_COLOR.test(color))) return BAD;
    if (following !== undefined && typeof following !== 'boolean') return BAD;
    if (artboard !== undefined && (typeof artboard !== 'string' || !PEER_ARTBOARD.test(artboard)))
      return BAD;
    if (
      idleSince !== undefined &&
      (typeof idleSince !== 'number' || !Number.isSafeInteger(idleSince) || idleSince <= 0)
    )
      return BAD;
    if (surface !== undefined && surface !== 'browser') return BAD;
    if (inComments !== undefined && typeof inComments !== 'boolean') return BAD;
    const peer: PeerEntry = { clientID, name };
    if (color !== undefined) peer.color = color;
    if (following === true) peer.following = true;
    if (artboard !== undefined) peer.artboard = artboard;
    if (idleSince !== undefined) peer.idleSince = idleSince;
    if (surface === 'browser') peer.surface = 'browser';
    if (inComments === true) peer.inComments = true;
    out.push(peer);
  }
  return out;
};

/** S2.18 — hold labels / tags (`hold-view`, `ai-holds`): bounded text, rendered as text only. */
export const HOLD_LABEL_MAX = 120;
export const AI_HOLDS_MAX = 256;
const holdText: V = (v) => (typeof v === 'string' && v.length <= HOLD_LABEL_MAX ? v : BAD);
const aiHoldList: V = (v) =>
  Array.isArray(v) && v.length <= AI_HOLDS_MAX
    ? arrOf(
        shape({
          artboard: holdText,
          element: holdText,
          occurrence: opt((x) =>
            typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 10000 ? x : BAD
          ),
          tag: holdText,
          mine: bool,
          scope: opt(bool),
          point: opt(bool),
        })
      )(v)
    : BAD;

/** S4.15 — `ai-seen`: where the AI points, as host refs (`ab:<id>` | `el:<artboard>/<id>`) and a bounded tag. */
export const AI_SEEN_MAX = 8;
export const AI_SEEN_TAG_MAX = 40;
const SEEN_ID = '[A-Za-z0-9_.:-]{1,128}';
const SEEN_REF = new RegExp(`^(?:ab:${SEEN_ID}|el:${SEEN_ID}/${SEEN_ID})$`);
const aiSeenList: V = (v) =>
  Array.isArray(v) && v.length <= AI_SEEN_MAX
    ? arrOf(
        shape({
          ref: (x) => (typeof x === 'string' && SEEN_REF.test(x) ? x : BAD),
          tag: (x) => (typeof x === 'string' && x.length <= AI_SEEN_TAG_MAX ? x : BAD),
        })
      )(v)
    : BAD;

/** S9.22 — the comment bridge. The op names the door takes (comments/ops.ts `parseCommentOp`). */
export const COMMENT_OPS = ['add', 'reply', 'resolve', 'reopen', 'edit-own', 'delete-own'] as const;
/** S4.V4 G5 — the sticky ↔ comment conversion asks the thread makes; the SHELL answers them (S4.7 routes,
 *  its own session conversion map), never the comment door. `{ op, commentId }` only. */
export const COMMENT_CONVERT_OPS = ['to-sticky', 'convert-undo', 'convert-undoable'] as const;
const reqIdV: V = (v) =>
  (typeof v === 'string' && v.length > 0 && v.length <= 64) ||
  (typeof v === 'number' && Number.isSafeInteger(v))
    ? v
    : BAD;
/** The op body: a plain object with a known `op`, every value under the JSON caps. */
const commentOpV: V = (v) => {
  if (!isPlain(v)) return BAD;
  if ((COMMENT_CONVERT_OPS as readonly unknown[]).includes(v.op))
    return typeof v.commentId === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(v.commentId)
      ? { op: v.op, commentId: v.commentId }
      : BAD;
  if (!(COMMENT_OPS as readonly unknown[]).includes(v.op)) return BAD;
  return json(v);
};
const mentionPerson = shape({ id: shortStr(200), name: shortStr(120), role: opt(shortStr(40)) });
/** S8.19 — `asset-state`: a planted or oversized list is REJECTED whole, never trimmed. */
export const ASSET_STATE_MAX = 256;
const ASSET_WHO_NAME_MAX = 64;
const assetWho = shape({
  name: nul((v) =>
    typeof v === 'string' && v.length <= ASSET_WHO_NAME_MAX && !v.includes('@') ? v : BAD
  ),
  kind: nul(lit('mac', 'pc', 'linux')),
  self: bool,
});
const assetStateItem = shape({
  rel: shortStr(512),
  state: lit('here', 'uploading', 'waiting', 'missing'),
  who: opt(assetWho),
  syncing: opt(bool),
});
const assetStateList: V = (v) =>
  Array.isArray(v) && v.length <= ASSET_STATE_MAX ? arrOf(assetStateItem)(v) : BAD;

/** A top-level parser over exactly the interface's keys (the type pins the key set). */
function p<T>(
  fields: NoInfer<{ [K in keyof Required<T>]: V }>
): (raw: Record<string, unknown>) => T | null {
  const s = shape(fields as Record<string, V>);
  return (raw) => {
    const r = s(raw);
    return r === BAD ? null : (r as T);
  };
}
const none = (raw: Record<string, unknown>): Empty | null => (isPlain(raw) ? {} : null);

const anchor = {
  refId: opt(str),
  refIndex: opt(num),
  artboardId: opt(nul(str)),
  position: opt(str),
};
const tlId = { id: opt(str) };
const elementRef = shape({ artboard: str, element: str, occurrence: opt(num) });
/** An array no longer than `max` (refused whole past it, never trimmed). */
const capped =
  (max: number, f: V): V =>
  (v) =>
    Array.isArray(v) && v.length <= max ? f(v) : BAD;
const askLocator = shape({
  id: opt(shortStr(128)),
  tag: opt(shortStr(24)),
  text: opt(shortStr(160)),
  selector: opt(shortStr(200)),
  index: opt(num),
});
const crumb = shape({ label: str, ref: nul(elementRef) });
const EDIT_OP_CODES = ['held-by-ai', 'locked', 'stale', 'invalid', 'forbidden'] as const;

// ─── the table ────────────────────────────────────────────────────────────────

type C2S = { [K in keyof CanvasToShell]: DgnSpec<CanvasToShell[K], ShellGate> };
type S2C = { [K in keyof ShellToCanvas]: DgnSpec<ShellToCanvas[K], CanvasGate> };
const BR = 'h/use-canvas-bridge'; // client/hooks/use-canvas-bridge.jsx
const CS = 'canvas-shell';

const c2s: C2S = {
  loaded: { gate: 'any', status: 'live', owner: BR, parse: p({ file: str }) },
  'canvas-rendered': { gate: 'active', status: 'live', owner: BR, parse: p({ file: str }) },
  'canvas-failed': { gate: 'active', status: 'live', owner: BR, parse: p({ file: str }) },
  'canvas-mounted': {
    gate: 'any',
    status: 'legacy',
    owner: 'tpl/_shell.html (probe)',
    orphan: 'no-handler',
    parse: p({ file: str, children: num }),
  },
  // S6.12 — handled by client/v2/create/use-render-error.js; `frame` (not `active`): a background tab's
  // canvas that breaks must be known when it is brought forward.
  'render-error': {
    gate: 'frame',
    status: 'live',
    owner: 'v2/create/use-render-error',
    parse: p({ file: str, message: shortStr(600) }),
  },
  'render-ok': {
    gate: 'frame',
    status: 'live',
    owner: 'v2/create/use-render-error',
    parse: p({ file: str }),
  },
  // S10.8 — handled by client/v2/ds/use-ds-frames.js (opens the review for the ACTIVE canvas's system)
  'ds-review': { gate: 'active', status: 'live', owner: 'h/use-ds-frames', parse: none },
  // S10.4 — handled by client/v2/ds/pins.js (createPinsHost.onMessage)
  'ds-pins-want': {
    gate: 'active',
    status: 'live',
    owner: 'v2/ds/pins',
    parse: p({ revs: pinValues }),
  },
  'canvas-expired': { gate: 'frame', status: 'live', owner: 'h/use-shell-core', parse: none },
  // S4.9 — sent by annotations-layer after a write lands; the shell relays it to the annotation list
  // (ANNOTATIONS_CHANGED_EVENT) in the same slice that mounts the list (S4.17's mount point).
  'annotations-changed': {
    gate: 'active',
    status: 'live',
    orphan: 'no-handler',
    owner: 'annotations-layer (S4.9) → annotation-list (S4.17)',
    parse: p({ file: str }),
  },
  'annotation-to-comment': {
    gate: 'active',
    status: 'live',
    owner: 'annotations-layer (S4.12) → shell convert (routes/annotations.ts, S4.7)',
    parse: p({ id: annotationIdV }),
  },
  'annotation-selection': {
    gate: 'active',
    status: 'live',
    owner: 'annotations-layer (S4.12) → AI scope chip (S4.15, S5.8)',
    parse: p({
      ids: capped(500, arrOf(annotationIdV)),
      kinds: recOf(count, 16),
      artboards: capped(200, arrOf(shortStr(128))),
    }),
  },
  'annotation-toast': {
    gate: 'active',
    status: 'live',
    owner: 'annotations-layer (S4.12) → shell toast',
    parse: p({ v: lit(1), message: shortStr(300), undo: bool }),
  },
  'annotation-ask-ai': {
    gate: 'active',
    status: 'live',
    owner: 'annotations-layer (S4.12) → shell AI chat',
    parse: p({ v: lit(1) }),
  },
  'view-only-gesture': {
    gate: 'active',
    status: 'live',
    owner: 'view-only-gesture (S9.21b) → shell access host tip',
    parse: p({ v: lit(1) }),
  },
  'vote-cast': {
    gate: 'active',
    status: 'live',
    owner: 'annotations/ui/vote-dots (S4.14) → shell vote store (routes/votes.ts)',
    parse: p({ artboard: linkArtboardIdV, remove: opt(bool) }),
  },
  'vote-board': {
    gate: 'active',
    status: 'live',
    owner: 'annotations/ui/vote-dots + editing/artboard-menu (S4.14) → shell vote sheet',
    parse: p({
      artboards: capped(
        200,
        arrOf(shape({ id: linkArtboardIdV, label: shortStr(120), x: num, y: num, w: num, h: num }))
      ),
      open: opt(bool),
      focus: opt(linkArtboardIdV),
    }),
  },
  'annotations-visibility': {
    gate: 'active',
    status: 'live',
    owner: 'annotations-layer ⇧P (S4.18) → shell use-photo-and-timeline',
    parse: p({ v: lit(1), visible: bool }),
  },
  'canvas-notice': {
    gate: 'active',
    status: 'live',
    owner: 'canvas-notice-message',
    parse: p({ message: str, kind: lit('info', 'success', 'error', 'warning', 'undo') }),
  },
  'embed-escape': { gate: 'active', status: 'live', owner: 'c/embed-view', parse: none },
  'select-set': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({
      selection: nul((v) => (Array.isArray(v) ? arrOf(jsonObj)(v) : jsonObj(v))),
      refs: opt(arrOf(elementRef)),
      crumbs: opt(arrOf(crumb)),
      kind: opt(lit(...SELECTION_KINDS)),
    }),
  },
  'edit-text': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, file: str, text: str, occurrence: opt(num), before: opt(str) }),
  },
  'apply-edit': {
    gate: 'active',
    status: 'live',
    owner: 'client/apply-edit-request',
    parse: p({
      requestId: str,
      op: json,
      canvas: opt(json),
      id: opt(json),
      key: opt(json),
      value: opt(json),
      from: opt(json),
      occurrence: opt(json),
    }),
  },
  'undo-barrier': { gate: 'active', status: 'live', owner: BR, parse: p({ requestId: str }) },
  'undo-key': {
    gate: 'active',
    status: 'live',
    owner: 'v2/undo/use-undo-mode-lane (S2.20b)',
    parse: p({ redo: bool }),
  },
  'edit-op': {
    gate: 'active',
    status: 'live',
    owner: 'editing (S2.1)',
    parse: p({
      requestId: str,
      op: str,
      targets: arrOf(elementRef),
      params: opt(jsonObj),
      expectRev: opt(str),
    }),
  },
  'active-artboard': { gate: 'active', status: 'live', owner: BR, parse: p({ id: nul(str) }) },
  'reorder-slot': {
    gate: 'active',
    status: 'live',
    owner: 'editing/reorder-slot',
    parse: (raw) => {
      const r = p<CanvasToShell['reorder-slot']>({
        index: intIn(0, MAX_ARR),
        total: intIn(0, MAX_ARR),
        parentId: opt(cdId),
      })(raw);
      // a slot lies inside its total and names its frame; index 0 is "the drag ended"
      if (!r || r.index > r.total) return null;
      if (r.index > 0 && r.parentId === undefined) return null;
      return r;
    },
  },
  'layers-tree': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: nul(str), tree: arrOf(jsonObj) }),
  },
  'open-inspector': { gate: 'active', status: 'live', owner: BR, parse: p({ tab: opt(str) }) },
  'copy-style': { gate: 'active', status: 'live', owner: BR, parse: none },
  'paste-style': { gate: 'active', status: 'live', owner: BR, parse: p({ id: str }) },
  'insert-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ ...anchor, kind: lit('div', 'text', 'image'), src: opt(str) }),
  },
  'insert-image-request': { gate: 'active', status: 'live', owner: BR, parse: p(anchor) },
  'delete-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, idIndex: opt(num) }),
  },
  'duplicate-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, idIndex: opt(num) }),
  },
  'reorder-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, refId: str, position: str, idIndex: opt(num), refIndex: opt(num) }),
  },
  'reorder-revert': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ seq: num, dir: lit('undo', 'redo') }),
  },
  'reposition-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({
      id: str,
      left: str,
      top: str,
      beforeLeft: opt(str),
      beforeTop: opt(str),
      idIndex: opt(num),
    }),
  },
  'resize-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, patch: strMap, before: opt(strMap), idIndex: opt(num) }),
  },
  'replace-media-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, before: opt(str) }),
  },
  'convert-to-absolute-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({
      artboardId: opt(str),
      allowShared: opt(bool),
      containers: opt(arrOf(json)),
      dissolve: opt(arrOf(json)),
      containerId: opt(str),
      children: opt(arrOf(json)),
      containerSetRelative: opt(bool),
    }),
  },
  'delete-artboard-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str }),
  },
  'duplicate-artboard-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str, width: opt(num) }),
  },
  'rename-artboard-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str, label: str }),
  },
  'resize-artboard-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str, width: num, height: num }),
  },
  'set-artboard-kind-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str, kind: nul(str) }),
  },
  'open-timeline-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ artboardId: str }),
  },
  'replace-annotation-media-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, before: opt(str) }),
  },
  'edit-annotation-photo-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, asset: str }),
  },
  'comment-compose': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ selection: jsonObj }),
  },
  'comment-submit': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ payload: jsonObj }),
  },
  'comment-patch': {
    gate: 'active', // + owns-comment, in the handler
    status: 'live',
    owner: BR,
    parse: p({ id: str, patch: jsonObj }),
  },
  'comment-delete': { gate: 'active', status: 'live', owner: BR, parse: p({ id: str }) },
  'comment-click': { gate: 'active', status: 'live', owner: BR, parse: p({ id: str }) },
  // S9.22 — the shell runs the op as the session (the door judges it); an `add` is pinned to the
  // active canvas in the handler (client/v2/comments/comment-bridge.js), the iframe's `file` ignored.
  'comment-op': {
    gate: 'active',
    status: 'live',
    owner: 'v2/comments/comment-bridge (S9.22)',
    parse: p({ reqId: reqIdV, op: commentOpV }),
  },
  'comment-people-request': {
    gate: 'active',
    status: 'live',
    owner: 'v2/comments/comment-bridge (S9.22)',
    parse: p({ reqId: reqIdV }),
  },
  // A6b-2: S8.2 retired the in-canvas export dialog (export-dialog.tsx) that sent these two; the shell
  // still answers them (the gate in use-canvas-bridge stays), nothing in the tree asks.
  'export-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    orphan: 'no-sender',
    parse: p({ id: str, payload: jsonObj }),
  },
  'export-history-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    orphan: 'no-sender',
    parse: p({ id: str }),
  },
  'open-export': { gate: 'active', status: 'legacy', owner: BR, parse: p({ detail: jsonObj }) },
  'export-capture-progress': {
    gate: 'asked',
    status: 'live',
    owner: 'h/use-shell-core',
    parse: p({ id: str, current: num, total: num }),
  },
  'export-capture-done': {
    gate: 'asked',
    status: 'live',
    owner: 'h/use-shell-core',
    parse: p({ id: str, items: arrOf(jsonObj) }),
  },
  'export-capture-error': {
    gate: 'asked',
    status: 'live',
    owner: 'h/use-shell-core',
    parse: p({ id: str, message: str }),
  },
  'export-selection': {
    gate: 'asked',
    status: 'live',
    owner: 'c/app',
    parse: p({ id: str, selectors: arrOf(str) }),
  },
  'timeline-comps': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ comps: arrOf(jsonObj) }),
  },
  'timeline-frame': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ ...tlId, frame: num }),
  },
  'timeline-ended': { gate: 'active', status: 'live', owner: BR, parse: p(tlId) },
  // S7.8 — a click on the artboard's own play button (or any Player play / pause) tells the shell.
  'timeline-playing': {
    gate: 'active',
    status: 'live',
    owner: 'v2/timeline (S7.8)',
    parse: p({ ...tlId, playing: bool }),
  },
  key: {
    gate: 'active',
    status: 'live',
    owner: 'actions/registry (V2-1.3)',
    parse: p({ v: lit(1), chord: str, hint: opt(shape({ artboardId: opt(str) })) }),
  },
  'tool-cursor': { gate: 'active', status: 'live', owner: BR, parse: p({ tool: str }) },
  peers: {
    gate: 'active',
    status: 'live',
    owner: 'v2/shell/use-canvas-mode-lane (V2-4.3b)',
    parse: p({ peers: peerList }),
  },
  'hold-view': {
    gate: 'active',
    status: 'live',
    owner: 'v2/inspector/view-mode (S2.18)',
    parse: p({
      person: nul(shape({ name: holdText })),
      label: holdText,
      ai: nul(shape({ label: holdText, held: bool, mine: bool })),
    }),
  },
  select: {
    gate: 'active',
    status: 'legacy',
    owner: BR,
    orphan: 'no-sender',
    parse: p({ selection: jsonObj }),
  },
  'clear-select': {
    gate: 'active',
    status: 'legacy',
    owner: BR,
    orphan: 'no-sender',
    parse: none,
  },
  // S11.2 — live: the canvas reports its real artboard count (editing/empty-report.ts); the empty canvas
  // ("Your canvas is ready.") shows at 0.
  artboards: {
    gate: 'active',
    status: 'live',
    owner: 'v2/empty (S11.2); the shell bridge keeps the Layers count',
    parse: p({ count: num }),
  },
  // S11.2 — the shell draws the empty-artboard hint (Q5 of S11-slices): the copy lives in one table.
  'artboard-empty': {
    gate: 'active',
    status: 'live',
    owner: 'v2/empty (S11.2)',
    parse: p({ artboardId: nul(str), rect: nul(rect), label: opt(str), from: opt(str) }),
  },
  // S7.7 — the canvas says which artboard is selected and where; the shell's timeline island rises from a video.
  'artboard-anchor': {
    gate: 'active',
    status: 'live',
    owner: 'v2/timeline (S7.7)',
    parse: p({ artboardId: nul(str), kind: opt(str), label: opt(str), rect: opt(nul(rect)) }),
  },
  // S7.8 — tap Space = play, hold = Hand; the canvas decides on key-up (editing/space-tap.ts), the shell plays.
  'space-tap': {
    gate: 'active',
    status: 'live',
    owner: 'v2/timeline (S7.8)',
    parse: none,
  },
  'ask-selection': {
    gate: 'active',
    status: 'live',
    owner: 'editing/ask-bubble (S2.19)',
    parse: p({
      refs: capped(200, arrOf(elementRef)),
      selection: opt(capped(12, arrOf(askLocator))),
      rect,
      artboard: opt(str),
    }),
  },
  'ask-selection-rect': {
    gate: 'active',
    status: 'live',
    owner: 'editing/ai-scope-outline (S2.19)',
    parse: p({ rect: nul(rect) }),
  },
  'insert-artboard-request': {
    gate: 'active',
    status: 'legacy',
    owner: BR,
    orphan: 'no-sender',
    parse: p({ id: opt(str), label: opt(str), width: opt(num), height: opt(num) }),
  },
  'mode-changed': {
    gate: 'active',
    status: 'live',
    owner: 'v2/shell/use-canvas-mode-lane (V2-4.3b)',
    parse: p({
      seq: num,
      mode,
      tool,
      present: nul(present),
      cause: lit('set-mode', 'tool', 'clamp', 'boot'),
    }),
  },
  'mode-request': {
    gate: 'active', // + no modal + role (M4), in the handler
    status: 'live',
    owner: 'v2/shell/use-canvas-mode-lane (V2-4.3b)',
    parse: p({
      mode: (v) => (v === 'back' ? v : mode(v)),
      tool: opt(tool),
      present: opt(present),
      cause: lit('key', 'esc', 'inspect', 'toolbar', 'link'),
    }),
  },
  'toolbar-rect': {
    gate: 'active',
    status: 'live',
    owner: 'tool-palette (V2-4.5a); shell tool panels (V2-4.5c)',
    parse: p({ mode, rect: nul(rect) }),
  },
  'tool-panel-open': {
    gate: 'active',
    status: 'live',
    owner: 'tool-palette (V2-4.5c); shell tool panels (V2-4.5c)',
    parse: p({
      panel: lit('stickers', 'components', 'templates', 'assets', 'sizes'),
      anchor: nul(rect),
      replace: opt(str),
    }),
  },
  'size-place': {
    gate: 'active',
    status: 'live',
    owner: 'editing/size-ghost (S7.20); client/v2/kinds',
    parse: p({ presetId: shortStr(40), world: shape({ x: num, y: num }) }),
  },
  // S3.2b — Present: the canvas posts its zoom for the pill (present/present-zoom.ts). S3.9 — canvas-lib's
  // ViewportZoomReporter posts it too; the shell's ZoomOnly readout (Preview) listens.
  'annotation-prefs-set': {
    gate: 'active',
    status: 'live',
    owner: 'annotations/ui/tool-state (S4.8); shell v2/shell/use-annotation-prefs (S4.8)',
    parse: p({ prefs: annotationPrefs }),
  },
  'viewport-zoom': {
    gate: 'active',
    status: 'live',
    owner:
      'present/present-zoom.ts (S3.2b) + v2/preview/zoom-only (S3.9) ← canvas-lib ViewportZoomReporter',
    parse: p({ zoom: num }),
  },
  // S3.1 — live: the Present stage (S3.2a) reports through canvas-mode-store `reportPresentPosition`;
  // the shell's mode store keeps it (use-canvas-mode-lane).
  'present-position': {
    gate: 'active',
    status: 'live',
    owner: 'v2/shell/use-canvas-mode-lane (S3.1)',
    parse: p({
      index: num,
      total: num,
      artboardId: str,
      sid: opt(sid),
      seq: opt(intIn(0, 2 ** 31 - 1)),
    }),
  },
  // S3.6b — the Present stage (present-stage.tsx `reportPresentRun`) → the presenter view's order map
  // (client/v2/present/presenter-host.jsx through use-canvas-mode-lane). A planted or oversized list is
  // refused whole.
  'present-run': {
    gate: 'active',
    status: 'live',
    owner: 'present/present-stage.tsx (S3.6b)',
    parse: p({
      artboards: presentRunList,
    }),
  },
  // S3.7a — the follower canvas (present-stage.tsx `usePresentFollow`) → its follower page.
  'present-follow-state': {
    gate: 'active',
    status: 'live',
    owner: 'v2/present/follow-view (S3.7a)',
    parse: p({
      live: bool,
      sid: nul(sid),
      presenterName,
      presenterIndex: intIn(0, 2000),
      index: intIn(0, 2000),
      total: intIn(0, 2000),
      watchers: intIn(0, 100000),
      ended: bool,
    }),
  },
  // S3.3 — live: the Present stage's media engine (present/present-media.ts) echoes the clip;
  // the shell lane (use-canvas-mode-lane) keeps it for the transport.
  'present-media': {
    gate: 'active',
    status: 'live',
    owner: 'present/present-media (S3.3)',
    parse: p({
      playing: bool,
      t: seconds,
      duration: seconds,
      muted: bool,
      sources: opt(mediaSources),
      missing: opt(bool),
    }),
  },
  // S3.10a — live: input-router's Preview branch posts it; the shell's link-follow plays it. Extra keys
  // (`target`, `url`, …) are dropped by `p`, so a planted canvas cannot hand the shell a destination.
  'link-follow': {
    gate: 'active', // + shell mode === 'preview' + no modal + ≤ 4/s, in the handler
    status: 'live',
    owner: 'S3 links (client/v2/preview/link-follow.js)',
    parse: p({ elementId: linkElementIdV, artboardId: nul(linkArtboardIdV) }),
  },
  'asset-relink-request': {
    gate: 'active',
    status: 'live',
    owner: 'client/v2/assets/asset-state-lane (S8.19)',
    parse: p({ rel: shortStr(512) }),
  },
};

const s2c: S2C = {
  theme: {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ theme: lit('light', 'dark') }),
  },
  'view-chrome': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: CS,
    parse: p({
      minimap: opt(bool),
      zoom: opt(bool),
      present: opt(bool),
      guides: opt(bool),
      print: opt(bool),
      safeZones: opt(bool),
    }),
  },
  'view-annotations': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({ visible: bool }),
  },
  'canvas-cap': { gate: 'parent', status: 'live', owner: 'tpl/_shell.html', parse: p({ t: str }) },
  // S10.4 — sent by client/v2/ds/follower-swap.js, honoured by the shell template's `ds-css` region
  'ds-css': {
    gate: 'parent',
    status: 'live',
    owner: 'tpl/_shell.html',
    parse: p({ tokens: opt(nul(dsCssPath)), components: opt(nul(dsCssPath)) }),
  },
  // S10.4 — sent by client/v2/ds/pins.js, loaded + scoped by the shell template's `ds-pins` region
  'ds-pins': {
    gate: 'parent',
    status: 'live',
    owner: 'tpl/_shell.html',
    parse: p({ revs: dsPinRevs, rootClass: nul(rootClassName) }),
  },
  // S10.8 — sent by client/v2/ds/update-dots.js, drawn by the shell template's `ds-update-dots` region
  'ds-update-dots': {
    gate: 'parent',
    status: 'live',
    owner: 'tpl/_shell.html',
    parse: p({ ids: dotIds }),
  },
  'ai-activity': {
    gate: 'parent',
    status: 'live',
    owner: 'ai-banner',
    parse: p({ file: str, entry: nul(jsonObj) }),
  },
  'select-by-id': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ id: opt(str), artboardId: opt(nul(str)), index: opt(num) }),
  },
  'select-by-selector': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ selector: str }),
  },
  highlight: {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ id: nul(str), artboardId: opt(nul(str)), index: opt(num) }),
  },
  'request-layers': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ artboardId: nul(str) }),
  },
  'force-clear': {
    gate: 'any',
    target: 'parent|self',
    status: 'live',
    owner: CS,
    parse: none,
  },
  'select-clear': {
    gate: 'any',
    target: 'parent|self',
    status: 'legacy',
    owner: CS,
    orphan: 'no-sender',
    parse: none,
  },
  'locked-set': { gate: 'parent', status: 'live', owner: CS, parse: p({ locked: arrOf(str) }) },
  'apply-style': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({
      id: str,
      artboardId: opt(nul(str)),
      index: opt(num),
      prop: str,
      value: nul(str),
    }),
  },
  'record-edit': { gate: 'parent', status: 'live', owner: CS, parse: p({ payload: jsonObj }) },
  'apply-edit-result': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ requestId: str, ok: bool, error: opt(str), conflict: opt(bool) }),
  },
  'undo-barrier-ok': { gate: 'parent', status: 'live', owner: CS, parse: p({ requestId: str }) },
  'edit-op-result': {
    gate: 'parent',
    status: 'live',
    owner: 'editing (S2.1)',
    parse: p({
      requestId: str,
      ok: bool,
      actionId: opt(nul(str)),
      writeId: opt(str),
      rev: opt(str),
      refs: opt(arrOf(elementRef)),
      created: opt(arrOf(elementRef)),
      code: opt(lit(...EDIT_OP_CODES)),
      message: opt(str),
    }),
  },
  'edit-reverted': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ op: str, id: opt(str), reason: opt(str) }),
  },
  'reorder-failed': { gate: 'parent', status: 'live', owner: CS, parse: none },
  'reposition-failed': { gate: 'parent', status: 'live', owner: CS, parse: none },
  'resize-failed': { gate: 'parent', status: 'live', owner: 'use-element-resize', parse: none },
  'resize-artboard-failed': {
    gate: 'parent',
    status: 'live',
    owner: 'use-element-resize',
    parse: none,
  },
  'freeze-and-set-kind': {
    gate: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ artboardId: str, kind: nul(str), ask: opt(bool), freeze: opt(bool) }),
  },
  'op-toast': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: CS,
    parse: p({ message: str }),
  },
  'tool-set': {
    gate: 'parent',
    status: 'live',
    owner: 'use-tool-mode',
    // V2-4.8a: its shell sender was the in-app menubar's Tools menu; tools are armed by the canvas's
    // own toolbar and keys now (V2-4.5). The parent-gated handler stays until V2-8.0 retires the row.
    orphan: 'no-sender',
    parse: p({ tool: str }),
  },
  'insert-sticker': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({
      path: str,
      follow: opt(bool),
      sticker: opt(shape({ pack: str, id: str, flip: opt(bool) })),
    }),
  },
  'reveal-artboard': {
    gate: 'parent',
    status: 'live',
    // S1.3 sends it from the jump list once REVEAL_ARTBOARD_LIVE flips; the handler is canvas-shell's (A6c)
    owner: 'canvas-lib',
    parse: p({ artboardId: str, glide: bool, flash: bool }),
  },
  'ai-runs': {
    gate: 'parent',
    status: 'live',
    owner: 'artboard-activity-overlay',
    parse: p({
      artboards: recOf(
        shape({
          state: lit('running', 'needs-you', 'done'),
          who: shortStr(200),
          tag: shortStr(120),
          waiting: count,
        })
      ),
    }),
  },
  'insert-template': {
    gate: 'parent',
    status: 'live',
    // S4.4 sends it (Templates panel, ⌘K rows); the annotations layer's handler is S4.13's (a pick that follows the pointer)
    owner: 'annotations-layer',
    parse: p({ id: str, follow: opt(bool) }),
  },
  'trashed-artboards': {
    gate: 'parent',
    status: 'live',
    owner: 'artboard-ghosts-overlay (S11.5)',
    parse: p({
      canvas: shortStr(1024),
      items: arrOf(shape({ id: shortStr(128), label: shortStr(200), rect: nul(rect) })),
    }),
  },
  'place-component': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/place-ghost',
    parse: p({
      component: dsName,
      label: opt(shortStr(64)),
      variant: opt(dsSlug),
      glyph: opt(dsSlug),
      mode: lit('ghost', 'selection'),
    }),
  },
  'size-ghost': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/size-ghost (S7.20)',
    parse: p({
      preset: nul(
        shape({
          id: shortStr(40),
          label: shortStr(80),
          sizeText: shortStr(40),
          w: num,
          h: num,
        })
      ),
    }),
  },
  'insert-annotation-media': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({ paths: arrOf(str) }),
  },
  'replace-annotation-media': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({ id: str, path: str, sticker: opt(shape({ pack: str, id: str, flip: opt(bool) })) }),
  },
  'photo-preview': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'canvas-lib (photo)',
    parse: p({ asset: str, edit: nul(jsonObj), use: opt(str) }),
  },
  'photo-busy': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'canvas-lib (photo)',
    parse: p({ asset: str, busy: bool }),
  },
  'comments-set': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'comments-overlay',
    parse: p({ comments: arrOf(jsonObj) }),
  },
  'comment-focus': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'comments-overlay',
    parse: p({ id: nul(str), reply: opt(lit(true)) }),
  },
  'comment-op-ack': {
    gate: 'parent',
    status: 'live',
    owner: 'comments-overlay (S9.22)',
    parse: p({ reqId: nul(reqIdV) }),
  },
  'comment-op-result': {
    gate: 'parent',
    status: 'live',
    owner: 'comments-overlay (S9.22)',
    parse: p({
      reqId: nul(reqIdV),
      ok: bool,
      comment: opt(nul(jsonObj)),
      status: opt(num),
      error: opt(str),
    }),
  },
  'comment-people': {
    gate: 'parent',
    status: 'live',
    owner: 'comments-overlay (S9.22)',
    parse: p({ reqId: nul(reqIdV), people: nul(arrOf(mentionPerson)) }),
  },
  // S4.17 sends them (client/v2/annotations/annotation-list-model.js); the annotations layer hears
  // them (S4.9, annotations/ui/visibility.ts).
  'annotation-select': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer (S4.9)',
    parse: p({ v: lit(1), ids: arrOf(shortStr(200)) }),
  },
  'annotation-filter': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer (S4.9)',
    parse: p({ v: lit(1), authors: arrOf(shortStr(200)) }),
  },
  'export-capture': {
    gate: 'parent',
    status: 'live',
    owner: 'canvas-lib (export)',
    parse: p({ id: str, format: str, artboardIds: arrOf(str), scale: num }),
  },
  'export-selection-query': {
    gate: 'parent',
    status: 'live',
    owner: 'canvas-lib (export)',
    parse: p({ id: str }),
  },
  // A6b-2: the answers to the two retired in-canvas export requests (see c2s `export-request`).
  'export-result': {
    gate: 'parent',
    status: 'live',
    owner: 'export-dialog',
    orphan: 'no-handler',
    parse: p({ id: str, ok: bool, browser: opt(bool), jobId: opt(str), error: opt(str) }),
  },
  'export-history-result': {
    gate: 'parent',
    status: 'live',
    owner: 'export-dialog',
    orphan: 'no-handler',
    parse: p({ id: str, history: arrOf(jsonObj) }),
  },
  'timeline-play': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p(tlId),
  },
  'timeline-pause': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p(tlId),
  },
  'timeline-seek': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p({ ...tlId, frame: num }),
  },
  'timeline-loop': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p({ ...tlId, loop: bool }),
  },
  'timeline-mute': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p({ ...tlId, muted: bool }),
  },
  'timeline-volume': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: p({ ...tlId, volume: num }),
  },
  'timeline-request-comps': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'video-comp',
    parse: none,
  },
  'run-action': {
    gate: 'parent',
    status: 'live',
    owner: 'actions/registry (V2-1.3)',
    parse: p({ v: lit(1), id: str, params: opt(jsonObj) }),
  },
  'git-lifecycle': {
    gate: 'parent',
    status: 'legacy',
    owner: 'c/app',
    orphan: 'no-handler',
    parse: p({ payload: jsonObj }),
  },
  'set-mode': {
    gate: 'parent',
    status: 'live',
    owner: 'bridge/canvas-mode-store (V2-4.3b)',
    parse: p({ v: lit(2), seq: num, mode, present: nul(present), tool: opt(tool), caps }),
  },
  'occluded-insets': {
    gate: 'parent',
    status: 'new',
    owner: 'bridge/canvas-mode-store',
    parse: p({ seq: num, insets }),
  },
  // S3.1 — live: the shell lane's `step` sends it; canvas-mode-store keeps it for the Present stage.
  'present-step': {
    gate: 'parent',
    status: 'live',
    owner: 'bridge/canvas-mode-store (S3.1)',
    parse: p({ to: (v) => (v === 'next' || v === 'prev' ? v : num(v)) }),
  },
  // S3.7a — honoured only by a follower canvas (`follow=1`, present/follow.ts `isFollowCanvas`).
  'present-follow': {
    gate: 'parent',
    status: 'live',
    owner: 'bridge/canvas-mode-store (S3.7a)',
    parse: p({ sid: nul(sid), live: bool, locked: bool }),
  },
  // S3.3 — live: the shell transport's buttons; the Present stage's media engine applies it.
  'present-media-cmd': {
    gate: 'parent',
    status: 'live',
    owner: 'present/present-media (S3.3)',
    parse: p({ op: lit('play', 'pause', 'mute', 'unmute') }),
  },
  'key-prefs': {
    gate: 'parent',
    status: 'live',
    owner: 'bridge/canvas-mode-store (V2-4 gate)',
    parse: p({ singleKeys: bool }),
  },
  'annotation-prefs': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations/ui/tool-state (S4.8)',
    parse: p({ prefs: annotationPrefs }),
  },
  // S4.14 — the parser IS the projection: a field it does not name never reaches the canvas.
  'vote-state': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations/ui/vote-dots (S4.14)',
    parse: p({
      vote: nul(
        shape({
          id: annotationIdV,
          targets: capped(32, arrOf(shortStr(200))),
          state: lit('open', 'ended'),
          perVoter: intIn(1, 99),
          tallies: opt(recOf(count, 32)),
        })
      ),
      mine: recOf(count, 32),
    }),
  },
  'hold-intent': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/hold-rings (S2.18)',
    parse: p({ field: bool, app: bool, gesture: opt(bool) }),
  },
  // S9.22b — sent by the shell's run list (S5.11 runs-store → v2/ai/ring-relay.js `holdsFor`):
  // neutral tags from the state and the holder's name only, never the run's prompt
  'ai-holds': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/hold-rings (S2.18)',
    parse: p({ holds: aiHoldList }),
  },
  'ai-seen': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations/ui/ai-seen (S4.15); sent by v2/ai/seen-relay.js',
    parse: p({ targets: aiSeenList }),
  },
  'undo-preview': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/undo-preview (S2.20)',
    parse: p({ artboards: arrOf(str), tag: nul(str) }),
  },
  'undo-mode': {
    gate: 'parent',
    status: 'live',
    owner: 'editing/undo-mode (S2.20b)',
    parse: p({ opLog: bool }),
  },
  'asset-state': {
    gate: 'parent',
    status: 'live',
    owner: 'canvas-lib asset placeholder frame (S8.19, L1)',
    parse: p({ items: assetStateList }),
  },
};

export const DGN_TABLE: { c2s: C2S; s2c: S2C } = { c2s, s2c };

// ─── accept + post helpers ────────────────────────────────────────────────────

// Messages are built with a computed key so the inventory (which reads `{ dgn: … }` literals as
// send sites) sees only the real call sites, not these helpers.
const DGN_KEY = 'dgn';
const withType = (payload: unknown, type: string): Record<string, unknown> =>
  Object.assign({}, payload as object, { [DGN_KEY]: type });

export interface ShellAcceptCtx {
  canvasOrigin: string;
  active: Window | null | undefined;
  asked?: Window | null;
  frames?: () => Iterable<Window | null | undefined>;
}

const own = (o: object, k: string) => Object.hasOwn(o, k);
const typeOf = (data: unknown): string | null =>
  isPlain(data) && typeof data.dgn === 'string' ? data.dgn : null;

export function c2sSpec(type: string): DgnSpec<unknown, ShellGate> | null {
  return own(c2s, type) ? (c2s as Record<string, DgnSpec<unknown, ShellGate>>)[type] : null;
}
export function s2cSpec(type: string): DgnSpec<unknown, CanvasGate> | null {
  return own(s2c, type) ? (s2c as Record<string, DgnSpec<unknown, CanvasGate>>)[type] : null;
}

/** Does `e.source` satisfy a shell-side gate? `active`/`asked` never pass as `null === null`. */
export function shellGateOk(gate: ShellGate, e: MessageEvent, ctx: ShellAcceptCtx): boolean {
  if (gate === 'any') return true;
  const src = e.source as unknown;
  if (gate === 'active') return !!ctx.active && src === ctx.active;
  if (gate === 'asked') return !!ctx.asked && src === ctx.asked;
  for (const w of ctx.frames?.() ?? []) if (w && src === w) return true;
  return false;
}

/** Does `e.source` satisfy a canvas-side gate, for the canvas document `win`? */
export function canvasGateOk(gate: CanvasGate, e: MessageEvent, win: Window): boolean {
  if (gate === 'any') return true;
  const src = e.source as unknown;
  if (src === win.parent) return true;
  return gate === 'parent|self' && src === win;
}

/** Canvas side, for a listener that branches on many types: false when `e.data` is a shell→canvas
 *  message this table gates and `e.source` fails that gate. Anything else is not this table's call
 *  (true) — the listener's own branches decide. */
export function canvasMayHandle(e: MessageEvent, win: Window): boolean {
  const t = typeOf(e.data);
  const spec = t ? s2cSpec(t) : null;
  return !spec || canvasGateOk(spec.gate, e, win);
}

/** The canvas→shell types gated `active` — the shell's one up-front source check. */
export const C2S_ACTIVE: ReadonlySet<string> = new Set(
  Object.keys(c2s).filter((k) => c2sSpec(k)?.gate === 'active')
);

/** Shell side: origin, gate and payload in one place; a handler only sees a validated message. */
export function acceptFromCanvas(
  e: MessageEvent,
  ctx: ShellAcceptCtx
): CanvasToShellMessage | null {
  if (e.origin !== ctx.canvasOrigin) return null;
  const t = typeOf(e.data);
  const spec = t ? c2sSpec(t) : null;
  if (!t || !spec || !shellGateOk(spec.gate, e, ctx)) return null;
  const parsed = spec.parse(e.data as Record<string, unknown>);
  return parsed ? (withType(parsed, t) as CanvasToShellMessage) : null;
}

/** Canvas side: gate and payload in one place (the canvas document is `win`). */
export function acceptFromShell(e: MessageEvent, win: Window): ShellToCanvasMessage | null {
  const t = typeOf(e.data);
  const spec = t ? s2cSpec(t) : null;
  if (!t || !spec || !canvasGateOk(spec.gate, e, win)) return null;
  const parsed = spec.parse(e.data as Record<string, unknown>);
  return parsed ? (withType(parsed, t) as ShellToCanvasMessage) : null;
}

/** Shell → one canvas window. */
export function postToCanvas<K extends keyof ShellToCanvas>(
  target: Window | null | undefined,
  type: K,
  payload: ShellToCanvas[K],
  targetOrigin: string
): void {
  try {
    target?.postMessage(withType(payload, type), targetOrigin);
  } catch {
    /* detached */
  }
}
/** Canvas → its shell. */
export function postToShell<K extends keyof CanvasToShell>(
  win: Window,
  type: K,
  payload: CanvasToShell[K]
): void {
  try {
    win.parent.postMessage(withType(payload, type), '*');
  } catch {
    /* detached */
  }
}
