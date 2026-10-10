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

// Payload shapes still private to their modules (names fixed by the contract). Opaque here; each is
// lifted beside its builder when its listener is routed through the accept helpers (V2-2.10b).
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
type Empty = Record<string, never>;

/** canvas → shell (posted to window.parent) */
export interface CanvasToShell {
  // lifecycle
  loaded: { file: string };
  'canvas-rendered': { file: string };
  'canvas-failed': { file: string };
  'canvas-mounted': { file: string; children: number };
  'canvas-expired': Empty;
  'canvas-notice': {
    message: string;
    kind: 'info' | 'success' | 'error' | 'warning' | 'undo';
  };
  'embed-escape': Empty;
  // selection + inline edit
  'select-set': { selection: Selection | Selection[] | null };
  'edit-text': { id: Id; file: string; text: string; occurrence?: number; before?: string };
  'apply-edit': ApplyEditMessage & { requestId: string };
  'undo-barrier': { requestId: string };
  'active-artboard': { id: Id | null };
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
  'open-sticker-picker': Empty;
  // comments
  'comment-compose': { selection: Selection };
  'comment-submit': { payload: CommentDraft };
  'comment-patch': { id: Id; patch: CommentPatch };
  'comment-delete': { id: Id };
  'comment-click': { id: Id };
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
  // keys forwarded from the iframe (V2-1.3 / V2-2.4 — supersedes toggle-palette / shell-shortcut)
  key: { v: 1; chord: string; hint?: { artboardId?: Id } };
  // mode / tools
  'tool-cursor': { tool: ToolId };
  'present-enter': Empty;
  // legacy, no in-tree sender (accepted today; removal needs a characterization proof)
  select: { selection: Selection };
  'clear-select': Empty;
  artboards: { count: number };
  'insert-artboard-request': { id?: Id; label?: string; width?: number; height?: number };

  // ── NEW (V2-1.2) — declared; the governed path that sends / handles them is V2-2.10e+ ──
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
    panel: 'stickers' | 'components' | 'templates' | 'assets';
    anchor: Rect | null;
  };
  'viewport-zoom': { zoom: number };
  'present-position': { index: number; total: number; artboardId: Id };
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
  }>;
  'view-annotations': { visible: boolean };
  'canvas-cap': { t: string };
  'ai-activity': { file: string; entry: AiActivityEntry | null };
  // selection + edit round-trips
  'select-by-id': { id?: Id; artboardId?: Id | null; index?: number };
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
  undo: Empty;
  redo: Empty;
  'tool-set': { tool: ToolId };
  // annotations / media
  'insert-sticker': { path: string; follow?: boolean };
  'insert-annotation-media': { paths: string[] };
  'replace-annotation-media': { id: Id; path: string };
  'photo-preview': { asset: string; edit: PhotoEdit | null };
  'photo-busy': { asset: string; busy: boolean };
  // comments
  'comments-set': { comments: CommentThread[] };
  'comment-focus': { id: Id | null };
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
const lit =
  (...xs: readonly unknown[]): V =>
  (v) =>
    xs.includes(v) ? v : BAD;
const opt =
  (f: V): V =>
  (v) =>
    v === undefined ? undefined : f(v);
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
const rect = shape({ x: num, y: num, w: num, h: num });
const mode: V = lit(...CANVAS_MODES);
const tool: V = lit(...TOOL_IDS);
const present = shape({ kind: lit(...PRESENT_KINDS), from: opt(str) });
const caps = shape({ edit: bool, annotate: bool, comment: bool });
const insets: V = (v) => clampInsets(v) ?? BAD;

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
  'canvas-expired': { gate: 'frame', status: 'live', owner: 'h/use-shell-core', parse: none },
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
    parse: p({ selection: nul((v) => (Array.isArray(v) ? arrOf(jsonObj)(v) : jsonObj(v))) }),
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
  'active-artboard': { gate: 'active', status: 'live', owner: BR, parse: p({ id: nul(str) }) },
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
  'open-sticker-picker': { gate: 'active', status: 'legacy', owner: BR, parse: none },
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
  'export-request': {
    gate: 'active',
    status: 'live',
    owner: BR,
    parse: p({ id: str, payload: jsonObj }),
  },
  'export-history-request': { gate: 'active', status: 'live', owner: BR, parse: p({ id: str }) },
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
  key: {
    gate: 'active',
    status: 'live',
    owner: 'actions/registry (V2-1.3)',
    parse: p({ v: lit(1), chord: str, hint: opt(shape({ artboardId: opt(str) })) }),
  },
  'tool-cursor': { gate: 'active', status: 'live', owner: BR, parse: p({ tool: str }) },
  'present-enter': { gate: 'active', status: 'legacy', owner: BR, parse: none },
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
  artboards: {
    gate: 'active',
    status: 'legacy',
    owner: BR,
    orphan: 'no-sender',
    parse: p({ count: num }),
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
    status: 'new',
    owner: 'shell mode router (V2-2.10e)',
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
    status: 'new',
    owner: 'shell mode router (V2-2.10e)',
    parse: p({
      mode: (v) => (v === 'back' ? v : mode(v)),
      tool: opt(tool),
      present: opt(present),
      cause: lit('key', 'esc', 'inspect', 'toolbar', 'link'),
    }),
  },
  'toolbar-rect': {
    gate: 'active',
    status: 'new',
    owner: 'shell tool panels (V2-4.5)',
    parse: p({ mode, rect: nul(rect) }),
  },
  'tool-panel-open': {
    gate: 'active',
    status: 'new',
    owner: 'shell tool panels (V2-4.5)',
    parse: p({
      panel: lit('stickers', 'components', 'templates', 'assets'),
      anchor: nul(rect),
    }),
  },
  'viewport-zoom': {
    gate: 'active',
    status: 'new',
    owner: 'shell ZoomUndo (V2-4.x)',
    parse: p({ zoom: num }),
  },
  'present-position': {
    gate: 'active',
    status: 'proposed',
    owner: 'S3 present',
    parse: p({ index: num, total: num, artboardId: str }),
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
    }),
  },
  'view-annotations': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({ visible: bool }),
  },
  'canvas-cap': { gate: 'parent', status: 'live', owner: 'tpl/_shell.html', parse: p({ t: str }) },
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
  // The v1 lanes V2-2.4 retired for run-action. One dynamic sender is left (`{dgn: dir}`,
  // use-palette-and-panels onUndoRedo — the inspector knobs' ⌘Z) and no canvas handler.
  undo: {
    gate: 'any',
    target: 'parent',
    status: 'legacy',
    owner: CS,
    orphan: 'no-handler',
    parse: none,
  },
  redo: {
    gate: 'any',
    target: 'parent',
    status: 'legacy',
    owner: CS,
    orphan: 'no-handler',
    parse: none,
  },
  'tool-set': { gate: 'parent', status: 'live', owner: 'use-tool-mode', parse: p({ tool: str }) },
  'insert-sticker': {
    gate: 'parent',
    status: 'live',
    owner: 'annotations-layer',
    parse: p({ path: str, follow: opt(bool) }),
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
    parse: p({ id: str, path: str }),
  },
  'photo-preview': {
    gate: 'any',
    target: 'parent',
    status: 'live',
    owner: 'canvas-lib (photo)',
    parse: p({ asset: str, edit: nul(jsonObj) }),
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
    parse: p({ id: nul(str) }),
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
  'export-result': {
    gate: 'parent',
    status: 'live',
    owner: 'export-dialog',
    parse: p({ id: str, ok: bool, browser: opt(bool), jobId: opt(str), error: opt(str) }),
  },
  'export-history-result': {
    gate: 'parent',
    status: 'live',
    owner: 'export-dialog',
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
    status: 'new',
    owner: 'bridge/canvas-mode-store (V2-2.10e)',
    parse: p({ v: lit(2), seq: num, mode, present: nul(present), tool: opt(tool), caps }),
  },
  'occluded-insets': {
    gate: 'parent',
    status: 'new',
    owner: 'bridge/canvas-mode-store',
    parse: p({ seq: num, insets }),
  },
  'present-step': {
    gate: 'parent',
    status: 'proposed',
    owner: 'S3 present',
    parse: p({ to: (v) => (v === 'next' || v === 'prev' ? v : num(v)) }),
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
