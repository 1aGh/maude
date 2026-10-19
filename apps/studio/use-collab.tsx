/**
 * @file       use-collab.tsx — client-side Yjs collab provider for canvas iframes
 * @scope      apps/studio/use-collab.tsx
 * @purpose    Mounts a single Y.Doc + Awareness per canvas iframe. Opens a
 *             WebSocket to `/_ws/collab/:slug`, speaks the y-websocket binary
 *             protocol, exposes hooks for the cursor overlay + Task 3 comments
 *             binding.
 *
 * Boundary:
 *   - Server-side equivalent is `collab/protocol.ts` + `collab/room.ts`.
 *   - This file mirrors the message framing (varint-prefixed sync + awareness
 *     frames) so the two sides converge over a binary WS without intermediate
 *     JSON.
 *   - Imports `yjs` + `y-protocols/{sync,awareness}` via the canvas-shell
 *     importmap (RUNTIME_PACKAGES additions). Canvas bundles that don't mount
 *     <CollabProvider> never resolve these specifiers and pay zero bundle cost.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { JSX } from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';

import { isTrustedOrigin, touchesBodyLane } from './collab/origins.ts';
import {
  presenceName,
  type Summon,
  type Surface,
  sanitizeArtboard,
  sanitizeFollowTarget,
  sanitizeIdleSince,
  sanitizeInComments,
  sanitizeSummon,
  sanitizeSurface,
} from './presence/fields.ts';
import { PERSON_TONES, TONE_COLOR } from './presence/tones.ts';
import { sanitizePointer } from './present/pointer-point.ts';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Color hash — stable per peer identity.

/**
 * djb2 string hash → one of the five person tones (S9.23 / CONTRACT §6 C32: sky · green · yellow ·
 * lilac · grey — never coral, which belongs to the AI). Determinism per input name is the load-bearing
 * property: every peer hashing "Alice" must land on the SAME color. The tones live in
 * `presence/tones.ts` (the shell reads the same function for its rings).
 */
const COLOR_PALETTE = PERSON_TONES.map((t) => TONE_COLOR[t]);

/** The AI agent's exclusive cursor/avatar hue — `--presence-agent`. */
export const AGENT_COLOR = 'oklch(0.700 0.190 322)';

export function colorForName(name: string): string {
  // COLOR_PALETTE is a non-empty const tuple; the explicit `?? '#000'`
  // fallback is unreachable but satisfies `noUncheckedIndexedAccess`.
  const FALLBACK = '#000000';
  if (!name) return COLOR_PALETTE[0] ?? FALLBACK;
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  const idx = ((hash % COLOR_PALETTE.length) + COLOR_PALETTE.length) % COLOR_PALETTE.length;
  return COLOR_PALETTE[idx] ?? FALLBACK;
}

// ─────────────────────────────────────────────────────────────────────────────
// Awareness state shape.

export interface CollabAwarenessState {
  name: string;
  color: string;
  /**
   * Cursor position in **world coords** (canvas-lib viewport space) so foreign
   * peers see the same conceptual point even when their local viewport is
   * panned/zoomed differently. Null = peer is not over the canvas surface.
   */
  cursor: { x: number; y: number } | null;
  /**
   * Most-recently selected element. `cssPath` is the locator id chain the
   * canvas-shell already uses; `bounds` are screen-px rect at the moment of
   * publish (so it's a hint, not a live ref). Null when nothing selected.
   */
  selection: { cssPath: string; bounds: { x: number; y: number; w: number; h: number } } | null;
  /**
   * Currently-selected annotation stroke IDs (Phase 5). Strokes are addressed
   * by their stable `data-id` attribute, so peers can resolve halos via
   * `document.querySelectorAll('[data-id="<id>"]')`. Empty when nothing
   * annotation-shaped is selected.
   */
  annotationSelection: string[];
  /**
   * DDR-242 AD5 / Task 22 — an annotation gesture in flight (drag, resize,
   * draw), so peers see it move live. It never touches storage: the op
   * commits once at gesture end, and this goes back to null.
   */
  annotationGesture?: AnnotationGesture | null;
  viewport: { x: number; y: number; zoom: number };
  /**
   * Soft editing-presence (Phase 30). Set while THIS peer (a human editing via
   * the CSS-inspector / a `/design:edit`-driven write, or a bridged agent) is
   * actively editing the canvas body; `since` is the epoch-ms the edit session
   * began. Null/absent = not editing. This is a SOFT, attributed heads-up that
   * rides the same hub-bridged awareness channel as cursors — it is NOT a lock
   * (no lease, no takeover, never blocks another peer). Cleared on idle + on
   * disconnect (awareness GC). The visual conflict picker (DDR-116) remains the
   * safety net for divergent saves.
   */
  editing?: { since: number } | null;
  /**
   * S3.7a (S3-present-session §2) — this peer is presenting artboards: where it is in its run, so
   * followers (the audience window, presentation-link viewers) show the same artboard. Published by the
   * canvas only while the shell's `set-mode` grants `caps.present`; null / absent = not presenting.
   * Untrusted on the way in: `sanitizePresent` drops a bad one WHOLE.
   */
  present?: PresentAwareness | null;
  /** S3.7a — the `sid` of the presentation this peer follows (null / absent = not following). */
  watching?: string | null;
  /**
   * S3.2b — the presenter's Pointer (L) in WORLD coords, as `cursor` is; null / absent = no dot.
   * Untrusted on the way in: `sanitizePointer` (present/pointer-point.ts) keeps a finite point or null.
   */
  pointer?: { x: number; y: number } | null;
  /**
   * S2.18 (V2-1.15 §5.12, Gate 0 A10) — the object this person is editing: a SOFT lock others see as a
   * ring + read-only inspector fields. Advisory between people; no server refuses on it. Published by
   * `createHoldPublisher`; null / absent = holding nothing. The hub stamps `actor` (V2-1.15 §5.3);
   * a receiver ignores it. Untrusted on the way in: `sanitizeHoldingState` drops a bad one WHOLE.
   */
  holding?: HoldingAwareness | null;
  /**
   * S9.23 (S9-slices Q9) — presence, additive (a v1 peer renders only the fields it knows). `artboard`:
   * the artboard this person is on; `idleSince`: epoch-ms of their last input, published only once idle
   * (3 min) and null while active; `surface`: the Mac app or a browser; `inComments`: the Comments
   * panel has their attention; `summon`: Bring everyone here (stripped by the hub / room without the
   * `summon` capability); `followTarget`: the clientID their camera follows. Never an e-mail address.
   */
  artboard?: string | null;
  idleSince?: number | null;
  surface?: Surface;
  inComments?: boolean;
  summon?: Summon | null;
  followTarget?: number | null;
  /**
   * Server-side `disconnect` matches awareness states to outgoing peers by
   * this token (must equal the ws.data.id the server assigns at upgrade).
   * Until the server pushes the assigned id back to the client, we use a
   * client-generated UUID — collisions are negligible and disconnect cleanup
   * tolerates a stale state (the next awareness GC pass drops it).
   */
  __connId: string;
}

export type ForeignAwareness = Omit<CollabAwarenessState, '__connId'> & { clientID: number };

/** A live annotation gesture, in WORLD coordinates. */
export interface AnnotationGesture {
  /** `type` (S4.12): typing in a sticky — the ids are the sticky; peers edge it in this person's colour. */
  kind: 'move' | 'resize' | 'draw' | 'type';
  /** Elements the gesture moves / resizes (empty while drawing a new one). */
  ids: string[];
  /** move: the drag offset. */
  dx?: number;
  dy?: number;
  /** resize: the box being dragged out; draw: a shape / sticky / section being drawn. */
  box?: { x: number; y: number; w: number; h: number };
  /** draw: pen ink so far, flat [x0,y0,x1,y1,…] (the latest part, capped). */
  points?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Untrusted-input sanitization at the awareness trust boundary.
//
// Phase 8 awareness was loopback-only — every state came from a trusted local
// tab. Phase 9 (Task 5) bridges awareness through a SEMI-TRUSTED hub (DDR-054),
// so foreign states are now attacker-influenceable. `useForeignAwareness` is
// the single chokepoint where remote state is read before it reaches the
// cursor / participant render sinks, so all validation lives here. Fields are
// validated for VALUE, not just type:
//   - color: re-derived locally from the (sanitized) name and the wire value
//     is DISCARDED — a hub-chosen `color` string would otherwise flow into an
//     inline `style` and a `url(...)` value beacons every viewer's browser.
//     The palette is deterministic, so re-derivation is visually identical.
//   - name: control / bidi / zero-width chars stripped, length-capped — blocks
//     identity spoofing + render bloat.
//   - cursor / viewport: finite-number gated — a NaN/Infinity would poison the
//     CSS transform / the local viewport controller during Follow mode.
//   - selection.cssPath: charset + length allowlist before it reaches
//     `querySelector` — blocks selector-complexity DoS + arbitrary DOM probing.
//   - annotationSelection: per-id token + array-length capped — blocks a
//     querySelector render-storm.
//   - peer count capped — blocks an unbounded-clients memory/render DoS.

const MAX_FOREIGN_PEERS = 64;
const MAX_NAME_LEN = 64;
const MAX_CSSPATH_LEN = 512;
const MAX_ANNOTATION_IDS = 256;
const MAX_ANNOTATION_ID_LEN = 128;

// Charset of every selector the canvas-shell `cssPath()` emits
// (`[data-*="..."]`, `#id`, `tag.cls:nth-child(N)`, ` > ` combinators).
const CSSPATH_ALLOWED = /^[A-Za-z0-9 ._#>:[\]="'()-]+$/;
// `cssPath()` only ever emits `:nth-child(N)` as a parenthesised construct.
// Functional pseudo-classes (`:has()`, `:is()`, `:where()`, `:not()`) trigger
// per-render subtree walks → a malicious hub peer could publish a deeply
// nested `:has()` selector and pin every viewer's main thread (querySelector
// re-runs each render). So after stripping the legit `:nth-child/of-type(N)`
// forms, any residual paren means a functional pseudo — reject. The charset
// allowlist alone was wider than the generator (the original DoS hole).
const CSSPATH_NTH = /:nth-(child|of-type)\(\d{1,4}\)/g;
const ANNOTATION_ID_ALLOWED = /^[A-Za-z0-9._:-]+$/;

function isSafeCssPath(p: string): boolean {
  if (p.length > MAX_CSSPATH_LEN || !CSSPATH_ALLOWED.test(p)) return false;
  const stripped = p.replace(CSSPATH_NTH, '');
  return !stripped.includes('(') && !stripped.includes(')');
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Control (C0/C1), zero-width, and bidi-override code points get stripped from
// displayed strings so a remote peer can't spoof another's identity or hide
// payloads in labels. A charCode scan (not a regex literal with raw control
// chars) sidesteps biome's noControlCharactersInRegex while keeping the same
// semantics — same approach as the hub's sanitizeForLog (DDR-053).
function isUnsafeCodePoint(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'anonymous';
  let cleaned = '';
  for (const ch of raw) {
    if (!isUnsafeCodePoint(ch.codePointAt(0) ?? 0)) cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, MAX_NAME_LEN);
  return cleaned || 'anonymous';
}

function sanitizeCursor(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as { x?: unknown; y?: unknown };
  return isFiniteNum(c.x) && isFiniteNum(c.y) ? { x: c.x, y: c.y } : null;
}

const GESTURE_KINDS = new Set(['move', 'resize', 'draw', 'type']);
const MAX_GESTURE_POINTS = 512; // numbers, i.e. 256 points
const GESTURE_COORD_LIMIT = 1e6;

function gestureNum(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(-GESTURE_COORD_LIMIT, Math.min(GESTURE_COORD_LIMIT, v));
}

/**
 * Task 22 — a peer's gesture preview is untrusted like every other awareness
 * field: kind allowlisted, ids through the same token + count gate as the
 * selection, every number finite and clamped, pen points capped.
 */
export function sanitizeAnnotationGesture(raw: unknown): AnnotationGesture | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.kind !== 'string' || !GESTURE_KINDS.has(g.kind)) return null;
  const out: AnnotationGesture = {
    kind: g.kind as AnnotationGesture['kind'],
    ids: sanitizeAnnotationSelection(g.ids),
  };
  const dx = gestureNum(g.dx);
  const dy = gestureNum(g.dy);
  if (dx !== undefined && dy !== undefined) {
    out.dx = dx;
    out.dy = dy;
  }
  const b = g.box as Record<string, unknown> | undefined;
  if (b && typeof b === 'object') {
    const x = gestureNum(b.x);
    const y = gestureNum(b.y);
    const w = gestureNum(b.w);
    const h = gestureNum(b.h);
    if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
      out.box = { x, y, w: Math.abs(w), h: Math.abs(h) };
    }
  }
  if (Array.isArray(g.points)) {
    const pts: number[] = [];
    const src = g.points.slice(-MAX_GESTURE_POINTS);
    for (const v of src) {
      const n = gestureNum(v);
      if (n === undefined) break;
      pts.push(n);
    }
    if (pts.length % 2 === 1) pts.pop();
    if (pts.length) out.points = pts;
  }
  return out;
}

function sanitizeViewport(raw: unknown): { x: number; y: number; zoom: number } {
  const fallback = { x: 0, y: 0, zoom: 1 };
  if (!raw || typeof raw !== 'object') return fallback;
  const v = raw as { x?: unknown; y?: unknown; zoom?: unknown };
  if (!isFiniteNum(v.x) || !isFiniteNum(v.y) || !isFiniteNum(v.zoom) || v.zoom <= 0)
    return fallback;
  return { x: v.x, y: v.y, zoom: v.zoom };
}

function sanitizeSelection(raw: unknown): CollabAwarenessState['selection'] {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { cssPath?: unknown; bounds?: unknown };
  const b = s.bounds as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
  const bounds =
    b && isFiniteNum(b.x) && isFiniteNum(b.y) && isFiniteNum(b.w) && isFiniteNum(b.h)
      ? { x: b.x, y: b.y, w: b.w, h: b.h }
      : null;
  // Only keep cssPath if it matches the locator grammar — otherwise drop it and
  // let the renderer fall back to the (validated) bounds.
  const cssPath = typeof s.cssPath === 'string' && isSafeCssPath(s.cssPath) ? s.cssPath : '';
  if (!cssPath && !bounds) return null;
  return { cssPath, bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 } };
}

function sanitizeAnnotationSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (out.length >= MAX_ANNOTATION_IDS) break;
    if (
      typeof id === 'string' &&
      id.length <= MAX_ANNOTATION_ID_LEN &&
      ANNOTATION_ID_ALLOWED.test(id)
    )
      out.push(id);
  }
  return out;
}

// Soft editing-presence (Phase 30). `since` must be a finite POSITIVE epoch-ms
// that is not in the future (allow ±5 s clock skew). A future / NaN / Infinity /
// non-positive value is rejected → `null` (treated as not-editing), so a hostile
// hub peer can't pin a permanent "editing" badge with a far-future timestamp or
// poison a `Date.now() - since` age computation with a NaN.
function sanitizeEditingState(raw: unknown): { since: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as { since?: unknown };
  if (!isFiniteNum(e.since) || e.since <= 0 || e.since > Date.now() + 5000) return null;
  return { since: e.since };
}

// ── S3.7a — the presenter's position (S3-present-session §2) ──────────────────────────────────────
// A planted canvas can only lie about its OWN artboards (S3-slices §5 risk 2); what it must not do is
// hand a follower a malformed state that half-applies. So every member is checked for value, the
// object is rebuilt from the known keys only, and ANY bad member drops the whole `present` (null) —
// never a partial object a follower would act on.

export interface PresentMediaAwareness {
  playing: boolean;
  t: number;
  duration: number;
  muted: boolean;
}

export interface PresentAwareness {
  v: 1;
  /** One presentation session (new per Present start). */
  sid: string;
  index: number;
  /** Presented artboards only (skip excluded). */
  total: number;
  artboardId: string;
  /** +1 per step; a follower ignores a lower one for the same sid. */
  seq: number;
  media: PresentMediaAwareness | null;
}

export const PRESENT_SID_RE = /^[a-z0-9]{8,32}$/;
const PRESENT_ARTBOARD_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PRESENT_TOTAL_MAX = 2000;
const PRESENT_SEQ_MAX = 2 ** 31 - 1;
const PRESENT_MEDIA_T_MAX = 86400;
const PRESENT_KEYS = ['v', 'sid', 'index', 'total', 'artboardId', 'seq', 'media'];
const MEDIA_KEYS = ['playing', 't', 'duration', 'muted'];

const isIntIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isPlainObj = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

function sanitizePresentMedia(raw: unknown): PresentMediaAwareness | null | undefined {
  if (raw === null) return null;
  if (!isPlainObj(raw)) return undefined; // bad
  if (Object.keys(raw).some((k) => !MEDIA_KEYS.includes(k))) return undefined;
  const { playing, t, duration, muted } = raw;
  if (typeof playing !== 'boolean' || typeof muted !== 'boolean') return undefined;
  const inRange = (n: unknown): n is number => isFiniteNum(n) && n >= 0 && n <= PRESENT_MEDIA_T_MAX;
  if (!inRange(t) || !inRange(duration)) return undefined;
  return { playing, t, duration, muted };
}

/**
 * The awareness `present` field, validated whole. Unknown keys, a non-integer or out-of-range number,
 * an id outside its grammar, `index ≥ total`, a bad `media` — each one returns null, so a follower
 * acts on a complete state or on nothing.
 */
export function sanitizePresent(raw: unknown): PresentAwareness | null {
  if (!isPlainObj(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > PRESENT_KEYS.length || keys.some((k) => !PRESENT_KEYS.includes(k))) return null;
  const { v, sid, index, total, artboardId, seq, media } = raw;
  if (v !== 1) return null;
  if (typeof sid !== 'string' || !PRESENT_SID_RE.test(sid)) return null;
  if (!isIntIn(total, 1, PRESENT_TOTAL_MAX)) return null;
  if (!isIntIn(index, 0, total - 1)) return null;
  if (typeof artboardId !== 'string' || !PRESENT_ARTBOARD_RE.test(artboardId)) return null;
  if (!isIntIn(seq, 0, PRESENT_SEQ_MAX)) return null;
  const m = media === undefined ? null : sanitizePresentMedia(media);
  if (m === undefined) return null;
  return { v: 1, sid, index, total, artboardId, seq, media: m };
}

// ── S2.18 — a person's hold (V2-1.15 §5.12) ─────────────────────────────────────────────────────
// A hold is advisory, but it is drawn on every peer's canvas and it closes their inspector fields, so
// the boundary is strict: known keys only, V2-1.4 id grammars, a bounded print, and an `at` that is
// finite and not in the future (+5 s skew). Any bad member drops the whole hold. `actor` is the hub's
// stamp (§5.3) — nothing here reads it, so a peer's own claim buys nothing.

export interface HoldingAwareness {
  /** DCArtboard id */
  artboard: string;
  /** ElementId (V2-1.4) or a computed 8-hex id */
  element: string;
  /** the element print, for a computed id */
  print?: string;
  /** epoch-ms of the last refresh (each edit gesture, ≤ every 5 s; a heartbeat while a field is focused) */
  at: number;
}

/** A hold nobody refreshed for this long is free — measured by the RECEIVER's clock. */
export const HOLD_FREE_MS = 30_000;
/** A gesture refreshes `at` at most this often. */
export const HOLD_REFRESH_MS = 5000;
/** While a field stays focused (no gestures), `at` is refreshed this often so receivers keep it. */
export const HOLD_HEARTBEAT_MS = 10_000;
const HOLD_SKEW_MS = 5000;
const HOLD_PRINT_MAX = 512;
const HOLD_KEYS = ['artboard', 'element', 'print', 'at', 'actor'];
// mirrors annotations/elements/_shared.ts ARTBOARD_ID_RE / ELEMENT_ID_RE (V2-1.4) — kept local so the
// canvas bundle does not pull the annotations module in
const HOLD_ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HOLD_ELEMENT_RE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|[0-9a-f]{8})$/;
const HOLD_ELEMENT_MAX = 48;

/** The awareness `holding` field, validated whole (null = holding nothing, or a bad hold). */
export function sanitizeHoldingState(
  raw: unknown,
  now: number = Date.now()
): HoldingAwareness | null {
  if (!isPlainObj(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > HOLD_KEYS.length || keys.some((k) => !HOLD_KEYS.includes(k))) return null;
  const { artboard, element, print, at } = raw;
  if (typeof artboard !== 'string' || !HOLD_ARTBOARD_RE.test(artboard)) return null;
  if (typeof element !== 'string' || element.length > HOLD_ELEMENT_MAX) return null;
  if (!HOLD_ELEMENT_RE.test(element)) return null;
  if (print !== undefined && (typeof print !== 'string' || print.length > HOLD_PRINT_MAX))
    return null;
  if (!isFiniteNum(at) || at <= 0 || at > now + HOLD_SKEW_MS) return null;
  return print === undefined ? { artboard, element, at } : { artboard, element, print, at };
}

/**
 * The optional fields every local `setLocalState` carries over, so a cursor publish never drops a
 * presenter's position, a follower's watch, a Pointer dot or a hold. Seed and publish both use it.
 */
export function carryLocal(cur: Partial<CollabAwarenessState>): {
  editing: CollabAwarenessState['editing'];
  present: PresentAwareness | null;
  watching: string | null;
  pointer: { x: number; y: number } | null;
  holding: HoldingAwareness | null;
  // S9.23 — the presence fields: a cursor publish must not un-idle, un-summon or un-follow.
  artboard: string | null;
  idleSince: number | null;
  surface: Surface;
  inComments: boolean;
  summon: Summon | null;
  followTarget: number | null;
} {
  return {
    editing: cur.editing ?? null,
    present: cur.present ?? null,
    watching: cur.watching ?? null,
    pointer: cur.pointer ?? null,
    holding: cur.holding ?? null,
    artboard: cur.artboard ?? null,
    idleSince: cur.idleSince ?? null,
    surface: cur.surface ?? 'app',
    inComments: cur.inComments ?? false,
    summon: cur.summon ?? null,
    followTarget: cur.followTarget ?? null,
  };
}

export interface HoldTarget {
  artboard: string;
  element: string;
  print?: string;
}

export interface HoldPublisher {
  /** the single selected object (null = deselect, or several, or an artboard) */
  select(target: HoldTarget | null): void;
  /** an inspector field for the selection has focus */
  field(focused: boolean): void;
  /** the window / the app has focus */
  app(focused: boolean): void;
  /** an edit gesture on the selection (drag, nudge, a typed value, a text edit) */
  gesture(): void;
  /** unmount: frees the hold, clears the timer */
  dispose(): void;
}

/**
 * The local `holding` matrix (V2-1.15 §5.12). Held = an object is selected AND the app has focus AND
 * (a field for it has focus OR a gesture happened within 30 s). Anything else is null. `publish` gets
 * every change; one timer covers both the 30 s idle and the focused-field heartbeat.
 */
export function createHoldPublisher(deps: {
  publish: (holding: HoldingAwareness | null) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}): HoldPublisher {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let target: HoldTarget | null = null;
  let focused = false;
  let appOn = true;
  let lastGesture: number | null = null;
  let sent: HoldingAwareness | null = null;
  let timer: unknown = null;
  let disposed = false;

  const same = (a: HoldTarget | null, b: HoldTarget | null) =>
    !!a && !!b && a.artboard === b.artboard && a.element === b.element;
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const send = (h: HoldingAwareness | null) => {
    sent = h;
    deps.publish(h);
  };

  function evaluate(refresh: boolean): void {
    stopTimer();
    const t = now();
    const recent = lastGesture !== null && t - lastGesture < HOLD_FREE_MS;
    const held = !disposed && !!target && appOn && (focused || recent);
    if (!held || !target) {
      if (sent !== null) send(null);
      return;
    }
    if (!sent || !same(sent, target) || refresh) {
      const h: HoldingAwareness = { artboard: target.artboard, element: target.element, at: t };
      if (target.print) h.print = target.print;
      send(h);
    }
    // the next moment something changes: the focused-field heartbeat, or the gesture going stale
    const beat = (sent as HoldingAwareness).at + HOLD_HEARTBEAT_MS - t;
    const idle = !focused && lastGesture !== null ? lastGesture + HOLD_FREE_MS - t : Infinity;
    const wait = Math.max(0, Math.min(focused ? beat : Infinity, idle));
    if (Number.isFinite(wait)) {
      timer = setTimer(() => {
        timer = null;
        const due = !!sent && now() - sent.at >= HOLD_HEARTBEAT_MS;
        evaluate(due);
      }, wait);
    }
  }

  return {
    select(next) {
      const moved = !same(target, next);
      target = next ? { ...next } : null;
      if (moved) lastGesture = null;
      evaluate(false);
    },
    field(v) {
      focused = v;
      evaluate(false);
    },
    app(v) {
      appOn = v;
      evaluate(false);
    },
    gesture() {
      if (!target) return;
      lastGesture = now();
      evaluate(!!sent && same(sent, target) && now() - sent.at >= HOLD_REFRESH_MS);
    },
    dispose() {
      disposed = true;
      evaluate(false);
    },
  };
}

/** The awareness `watching` field: a presenter's sid, or null. */
export function sanitizeWatching(raw: unknown): string | null {
  return typeof raw === 'string' && PRESENT_SID_RE.test(raw) ? raw : null;
}

/**
 * Validate + normalize one foreign awareness state at the trust boundary.
 * Returns null for states that can't be a peer (no usable name). `color` is
 * always re-derived locally from the sanitized name — the wire value is never
 * trusted, which is what closes the hub CSS-`url()` exfil channel. Exported so
 * the hostile-input matrix can exercise it without a React harness.
 */
export function sanitizeForeignState(clientID: number, state: unknown): ForeignAwareness | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Partial<CollabAwarenessState>;
  if (typeof s.name !== 'string') return null;
  // Names + colour only (S9 Q9): a v1 peer whose git name IS an address is shown by its local part.
  const name = presenceName(sanitizeName(s.name));
  return {
    clientID,
    name,
    color: colorForName(name),
    cursor: sanitizeCursor(s.cursor),
    selection: sanitizeSelection(s.selection),
    annotationSelection: sanitizeAnnotationSelection(s.annotationSelection),
    annotationGesture: sanitizeAnnotationGesture(s.annotationGesture),
    viewport: sanitizeViewport(s.viewport),
    editing: sanitizeEditingState(s.editing),
    present: sanitizePresent(s.present),
    watching: sanitizeWatching(s.watching),
    pointer: sanitizePointer(s.pointer),
    holding: sanitizeHoldingState(s.holding),
    artboard: sanitizeArtboard(s.artboard),
    idleSince: sanitizeIdleSince(s.idleSince),
    surface: sanitizeSurface(s.surface),
    inComments: sanitizeInComments(s.inComments),
    summon: sanitizeSummon(s.summon),
    followTarget: sanitizeFollowTarget(s.followTarget),
  };
}

/**
 * Every foreign peer of `awareness` through the trust boundary (`sanitizeForeignState`), capped at
 * MAX_FOREIGN_PEERS. The one loop `useForeignAwareness` and the Present follower (S3.7a) both read,
 * so no consumer reads `getStates()` raw.
 */
export function readForeignPeers(awareness: Awareness): ForeignAwareness[] {
  const out: ForeignAwareness[] = [];
  const myId = awareness.clientID;
  for (const [clientID, state] of awareness.getStates() as Map<number, unknown>) {
    if (clientID === myId) continue;
    if (out.length >= MAX_FOREIGN_PEERS) break; // bound DoS via unbounded peers
    const peer = sanitizeForeignState(clientID, state);
    if (peer) out.push(peer);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context.

interface CollabValue {
  doc: Y.Doc;
  /**
   * SECURITY INVARIANT: in linked mode this Awareness carries states relayed
   * from a SEMI-TRUSTED hub (DDR-054). Foreign states are untrusted input —
   * read them ONLY through `useForeignAwareness`, which sanitizes every field
   * at the trust boundary (`sanitizeForeignState`). Do NOT call
   * `awareness.getStates()` directly in render code; that bypasses the gate.
   */
  awareness: Awareness;
  /** Local peer's session-stable color (derived from git user.name). */
  myColor: string;
  /** Local peer's display name (git user.name or anonymous fallback). */
  myName: string;
  /** Local peer's connection id (matches server-side ws.data.id pattern). */
  myConnId: string;
  /** True when the WS is OPEN. Cursor overlay can use this to gate rendering. */
  connected: boolean;
  /** Publish (debounce-coalesced) an updated local awareness state. */
  publishAwareness: (patch: Partial<Omit<CollabAwarenessState, '__connId'>>) => void;
}

const CollabContext = createContext<CollabValue | null>(null);

export function useCollab(): CollabValue | null {
  return useContext(CollabContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: foreign awareness peers (the cursor overlay subscribes to this).

export interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Could this awareness `change` alter the foreign peers we show? False only
 * when every touched client is the local one (our own cursor publish — #131).
 * Unknown shape → true, the safe direction.
 */
export function touchesForeignClient(changes: AwarenessChanges | undefined, myId: number): boolean {
  if (!changes) return true;
  const touched = [
    ...(changes.added ?? []),
    ...(changes.updated ?? []),
    ...(changes.removed ?? []),
  ];
  return touched.length === 0 || touched.some((id) => id !== myId);
}

/**
 * Returns the current set of foreign peers (excludes the local client). The
 * returned array is stable-reference between awareness updates — useful for
 * downstream React.memo cursor components.
 */
export function useForeignAwareness(): ForeignAwareness[] {
  const collab = useCollab();
  const [peers, setPeers] = useState<ForeignAwareness[]>([]);

  useEffect(() => {
    if (!collab) {
      setPeers([]);
      return;
    }
    const { awareness } = collab;
    // Sanitize every now-remote field at this trust boundary (Task 5).
    const compute = () => readForeignPeers(awareness);
    setPeers(compute());
    // Issue #131 — `change` fires for OUR OWN publishes too (the 30 Hz cursor),
    // and each one rebuilt every peer object and re-rendered every consumer.
    // Only a change that touches another client can change what we show.
    const onChange = (changes?: AwarenessChanges) => {
      if (!touchesForeignClient(changes, awareness.clientID)) return;
      setPeers(compute());
    };
    awareness.on('change', onChange);
    return () => {
      awareness.off('change', onChange);
    };
  }, [collab]);

  return peers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: soft editing-presence (Phase 30).
//
// A SOFT, attributed "I'm editing this canvas" heads-up — NOT a lock. It rides
// the same per-canvas awareness channel as cursors (so it crosses the hub for
// free via the awareness bridge) and is surfaced by the peer overlay so two
// people (or a person + an agent) don't unknowingly edit the same canvas at the
// same moment. It never blocks anyone; the visual conflict picker (DDR-116)
// remains the safety net for divergent saves.

const EDITING_IDLE_MS = 5000;

/**
 * Returns `setEditing()` / `clearEditing()`. Call `setEditing()` on each edit
 * the local user makes (CSS-inspector tweak, `/design:edit`-driven write); it
 * publishes `editing: { since }` once and auto-extends, then auto-clears after
 * `EDITING_IDLE_MS` of no calls (and on unmount). A no-op outside a
 * `CollabProvider` (returns callbacks that do nothing).
 */
export function useEditingPresence(): { setEditing: () => void; clearEditing: () => void } {
  const collab = useCollab();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sinceRef = useRef<number | null>(null);

  const clearEditing = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (sinceRef.current !== null) {
      sinceRef.current = null;
      collab?.publishAwareness({ editing: null });
    }
  }, [collab]);

  const setEditing = useCallback(() => {
    if (!collab) return;
    if (sinceRef.current === null) {
      sinceRef.current = Date.now();
      collab.publishAwareness({ editing: { since: sinceRef.current } });
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(clearEditing, EDITING_IDLE_MS);
  }, [collab, clearEditing]);

  // Clear local editing-presence on unmount.
  useEffect(() => () => clearEditing(), [clearEditing]);

  return { setEditing, clearEditing };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug derivation — must match `api.fileSlug` server-side.

/**
 * Mirror of server-side `api.fileSlug`. The input is the canvas path as the
 * shell stored it on `window.__canvas_meta_file__` (e.g. `.design/ui/Foo.tsx`).
 * Strip the designRel prefix (read from `window.__canvas_design_rel__`, set
 * by _shell.html) so both sides land on the same slug — without this both
 * tabs open a `design-ui-foo` room while the server's inspector bridge
 * pushes into `ui-foo`, and the rooms never converge.
 */
export function canvasSlugFromPath(canvasRel: string | null | undefined): string | null {
  if (!canvasRel) return null;
  let p = canvasRel.replace(/^\/+|\/+$/g, '');
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __canvas_design_rel__?: string };
    const designRel = (w.__canvas_design_rel__ ?? '').replace(/^\/+|\/+$/g, '');
    if (designRel && p.startsWith(`${designRel}/`)) p = p.slice(designRel.length + 1);
  }
  const slug = p
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.(tsx|html)$/i, '')
    .replace(/^\.+/, '')
    .toLowerCase();
  return /^[a-z0-9_-]+$/.test(slug) ? slug : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level, refcounted collab session (F4 — presence survives a hot-swap).
//
// A cross-peer synced edit (or an agent edit) hot-swaps the canvas module in
// place, which REMOUNTS the whole canvas subtree — including <CollabProvider>.
// If the Y.Doc + Awareness + WebSocket were owned by the component (useMemo /
// useEffect), that remount would CLOSE the awareness socket and re-handshake, so
// every peer's cursor + avatar blinks out and back on every synced change (the
// F4 bug). Instead the live session lives HERE, keyed by slug + refcounted: a
// same-slug remount re-acquires the SAME doc/awareness/socket within a short
// grace window, so the awareness connection never drops and presence is stable.
//
// One canvas iframe is one realm and only ever holds one slug (switching
// canvases navigates the iframe → fresh realm → fresh module state), so the map
// holds at most one live entry plus, briefly, one draining one.

const AWARENESS_THROTTLE_MS = 33; // ~30 Hz

interface CollabSession {
  slug: string;
  doc: Y.Doc;
  awareness: Awareness;
  connId: string;
  name: string;
  color: string;
  connected: boolean;
  refCount: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  /** React consumers subscribe so name/color/connected changes re-render. */
  listeners: Set<() => void>;
  /** Tear down the socket + listeners + destroy doc/awareness. */
  stop: () => void;
}

// The session registry MUST live on `window`, not in module scope, and be
// resolved LAZILY (per access, not once at module load). A hot-swap (F4)
// re-imports the canvas bundle with a cache-busting `?v=` query, and use-collab
// is INLINED into that per-canvas bundle — so each hot-swap re-evaluates a FRESH
// module with a fresh module-level binding. A plain `const SESSIONS = new Map()`
// would therefore be empty on every hot-swap and we'd spin a new Y.Doc +
// Awareness + socket (new clientID) each time, leaving the prior clientID's
// awareness to linger on the hub → phantom "self" avatars pile up until the
// awareness timeout. Anchoring the map on the iframe's `window` (which survives
// module re-evaluation) is what makes the session — and thus presence — survive
// the swap. Lazy resolution also tolerates a `window` that becomes available
// after this module first evaluates (test harness: imports are hoisted above
// happy-dom registration).
//
// SECURITY (DDR-054): the canvas iframe is untrusted and shares this realm, so
// the registry holds live network handles in reach of canvas script. We key it
// by a NON-ENUMERABLE global Symbol (not an enumerable string property) so it
// can't be harvested by an opportunistic `for…in` / `Object.keys(window)` sweep
// — defense in depth, NOT a trust boundary: same-realm canvas code can already
// reach collab state through `useCollab()`, and `Symbol.for` is recoverable by a
// determined attacker. Closing the underlying "untrusted canvas can mutate the
// shared doc" surface is a separate, pre-existing concern (tracked as a
// follow-up); this keeps the hot-swap fix from WIDENING discovery. A global
// Symbol (shared registry) is required so the re-imported module resolves the
// SAME key — a per-module `Symbol()` would defeat the cross-re-import survival.
const SESSIONS_KEY = Symbol.for('maude.collab.sessions.v1');
let moduleFallbackSessions: Map<string, CollabSession> | null = null;
function getSessions(): Map<string, CollabSession> {
  if (typeof window === 'undefined') {
    if (!moduleFallbackSessions) moduleFallbackSessions = new Map<string, CollabSession>();
    return moduleFallbackSessions;
  }
  const w = window as unknown as Record<symbol, Map<string, CollabSession> | undefined>;
  let map = w[SESSIONS_KEY];
  if (!map) {
    map = new Map<string, CollabSession>();
    Object.defineProperty(w, SESSIONS_KEY, {
      value: map,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return map;
}

// Keep a refcount-0 session alive briefly so a hot-swap remount (which unmounts
// then immediately remounts the provider in the same commit) reuses the live
// socket instead of reconnecting. A genuine close (no re-acquire within the
// window) tears down so the peer leaves the room cleanly.
const SESSION_GRACE_MS = 4000;

function notifySession(s: CollabSession): void {
  for (const l of s.listeners) l();
}

function createSession(slug: string): CollabSession {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const connId = crypto.randomUUID();

  const session: CollabSession = {
    slug,
    doc,
    awareness,
    connId,
    name: 'anonymous',
    color: colorForName('anonymous'),
    connected: false,
    refCount: 0,
    destroyTimer: null,
    listeners: new Set(),
    stop: () => {},
  };

  // Seed local awareness immediately so foreign peers see our name even before
  // the first cursor move; preserves any cursor/selection already published.
  const seedLocalAwareness = (name: string, color: string) => {
    const cur = (awareness.getLocalState() ?? {}) as Partial<CollabAwarenessState>;
    awareness.setLocalState({
      name,
      color,
      cursor: cur.cursor ?? null,
      selection: cur.selection ?? null,
      annotationSelection: cur.annotationSelection ?? [],
      annotationGesture: null,
      viewport: cur.viewport ?? { x: 0, y: 0, zoom: 1 },
      // editing / present / watching / pointer / holding (S2.18) — one list, carryLocal
      ...carryLocal(cur),
      __connId: connId,
    } satisfies CollabAwarenessState);
  };
  seedLocalAwareness(session.name, session.color);

  // Resolve identity from git user.name once per SESSION (not per mount) so a
  // hot-swap remount doesn't re-fetch + re-publish (which would churn awareness).
  let identityCancelled = false;
  fetch('/_api/git-user')
    .then((r) => r.json())
    .then((j) => {
      if (identityCancelled) return;
      const n = typeof j?.name === 'string' && j.name.trim() ? presenceName(j.name) : null;
      const finalName = n ?? `anonymous-${connId.slice(0, 6)}`;
      session.name = finalName;
      session.color = colorForName(finalName);
      seedLocalAwareness(finalName, session.color);
      notifySession(session);
    })
    .catch(() => {
      if (identityCancelled) return;
      const fallback = `anonymous-${connId.slice(0, 6)}`;
      session.name = fallback;
      session.color = colorForName(fallback);
      seedLocalAwareness(fallback, session.color);
      notifySession(session);
    });

  // ── WebSocket lifecycle ──────────────────────────────────────────────────
  let cancelled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsRef: WebSocket | null = null;
  // Consecutive failed connects. A server that refuses the upgrade (403/401 —
  // e.g. a deployment whose proxy does not carry the collab lane) used to be
  // retried every second, forever, silently — which is indistinguishable from
  // "nobody else is here" (the cloud-collab RCA shipped invisible exactly this
  // way). Back off exponentially and say so once.
  let failedConnects = 0;
  let failureWarned = false;

  function sendFrame(ws: WebSocket, payload: Uint8Array) {
    try {
      // Uint8Array<ArrayBufferLike> vs BufferSource — see saveAsset in api.ts.
      ws.send(payload as Uint8Array<ArrayBuffer>);
    } catch {
      /* dead socket — close handler will reconnect */
    }
  }

  function broadcastAwareness(ws: WebSocket, changed: number[]) {
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changed));
    sendFrame(ws, encoding.toUint8Array(encoder));
  }

  function broadcastSyncUpdate(ws: WebSocket, update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeUpdate(encoder, update);
    sendFrame(ws, encoding.toUint8Array(encoder));
  }

  function connect() {
    if (cancelled) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/_ws/collab/${slug}`);
    ws.binaryType = 'arraybuffer';
    wsRef = ws;

    ws.addEventListener('open', () => {
      failedConnects = 0;
      failureWarned = false;
      session.connected = true;
      notifySession(session);
      // Sync step 1 — announce our state vector so the server can send the
      // missing pieces (matches the encodeHandshake server path).
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeSyncStep1(encoder, doc);
      sendFrame(ws, encoding.toUint8Array(encoder));
      // Awareness initial state — fire our local state to the room.
      broadcastAwareness(ws, [awareness.clientID]);
    });

    ws.addEventListener('close', () => {
      const hadConnected = session.connected;
      session.connected = false;
      notifySession(session);
      wsRef = null;
      if (cancelled) return;
      failedConnects = hadConnected ? 0 : failedConnects + 1;
      if (failedConnects >= 5 && !failureWarned) {
        failureWarned = true;
        console.warn(
          '[collab] live sync unavailable — the collab socket keeps being refused. ' +
            'Presence, live annotations and cross-peer updates are off until it connects.'
        );
      }
      // 1s → 2s → 4s → … capped at 15s; a healthy drop (was connected) retries fast.
      const delay = Math.min(1000 * 2 ** Math.min(failedConnects, 4), 15000);
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener('error', () => {
      // Let close handler do the reconnect; error events without a close
      // would just retry-spam.
    });

    ws.addEventListener('message', (evt) => {
      const payload =
        evt.data instanceof ArrayBuffer
          ? new Uint8Array(evt.data)
          : evt.data instanceof Uint8Array
            ? evt.data
            : null;
      if (!payload) return;
      const decoder = decoding.createDecoder(payload);
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          readSyncMessage(decoder, encoder, doc, ws);
          if (encoding.length(encoder) > 1) sendFrame(ws, encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_AWARENESS: {
          applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
          break;
        }
        default:
          break;
      }
    });
  }

  // Wire doc updates → broadcast to server. Origin tagged with the ws so
  // server-side updates we receive don't echo back.
  //
  // ORIGIN GATE, lock 1 (DDR-122 follow-up — see collab/origins.ts). This file
  // runs in the UNTRUSTED canvas realm, so any script sharing the realm can
  // reach this doc through `useCollab().doc` and write the body lanes — the
  // canvas's own source. Refuse to broadcast such an op unless it carries a
  // trusted origin sentinel, which canvas script cannot obtain. Comments,
  // annotations, and presentation are untouched: the canvas realm co-authors
  // those by design, and same-machine boards must keep working.
  let bodyLaneWarned = false;
  const onDocUpdate = (
    update: Uint8Array,
    origin: unknown,
    _doc: Y.Doc,
    transaction: Y.Transaction
  ) => {
    const ws = wsRef;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (origin === ws) return; // came from server, don't echo
    if (touchesBodyLane(transaction) && !isTrustedOrigin(origin)) {
      if (!bodyLaneWarned) {
        bodyLaneWarned = true;
        console.warn(
          '[collab] refused to broadcast a canvas-realm write to the canvas source ' +
            '(html/css/meta). Untrusted canvas script may not edit the document body — ' +
            'DDR-122 follow-up.'
        );
      }
      return;
    }
    broadcastSyncUpdate(ws, update);
  };
  doc.on('update', onDocUpdate);

  // Wire awareness changes → broadcast. Same origin guard.
  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    const ws = wsRef;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (origin === ws) return;
    const changed = added.concat(updated, removed);
    broadcastAwareness(ws, changed);
  };
  awareness.on('update', onAwarenessUpdate);

  session.stop = () => {
    identityCancelled = true;
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    doc.off('update', onDocUpdate);
    awareness.off('update', onAwarenessUpdate);
    const ws = wsRef;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    try {
      awareness.destroy();
    } catch {
      /* ignore */
    }
    try {
      doc.destroy();
    } catch {
      /* ignore */
    }
  };

  connect();
  return session;
}

function scheduleSessionDestroy(s: CollabSession): void {
  if (s.destroyTimer) return;
  s.destroyTimer = setTimeout(() => {
    getSessions().delete(s.slug);
    s.stop();
  }, SESSION_GRACE_MS);
}

/** Idempotent get-or-create (called in render so children get a live doc on
 *  first render). A freshly created session self-destructs after the grace
 *  window unless a mount effect retains it — so a thrown-away render can't leak
 *  a socket. */
function peekOrCreateSession(slug: string): CollabSession {
  const sessions = getSessions();
  let s = sessions.get(slug);
  if (!s) {
    s = createSession(slug);
    sessions.set(slug, s);
    scheduleSessionDestroy(s);
  }
  return s;
}

function retainSession(slug: string): CollabSession {
  const s = peekOrCreateSession(slug);
  if (s.destroyTimer) {
    clearTimeout(s.destroyTimer);
    s.destroyTimer = null;
  }
  s.refCount++;
  return s;
}

function releaseSession(slug: string): void {
  const s = getSessions().get(slug);
  if (!s) return;
  s.refCount = Math.max(0, s.refCount - 1);
  if (s.refCount === 0) scheduleSessionDestroy(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider — thin consumer of the shared session (lifetime owned above).

interface CollabProviderProps {
  /** Canvas slug — must match server-side `parseCollabSlug`. */
  slug: string;
  children: ReactNode;
}

export function CollabProvider({ slug, children }: CollabProviderProps): JSX.Element {
  // Acquire (get-or-create) for render so children see a live doc immediately;
  // the refcount + teardown lifetime is managed in the effect below so a
  // hot-swap remount reuses the SAME socket (no presence blink — F4).
  const session = peekOrCreateSession(slug);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const s = retainSession(slug);
    const listener = () => forceRender();
    s.listeners.add(listener);
    // Identity / connection may have resolved between render and this effect.
    forceRender();
    return () => {
      s.listeners.delete(listener);
      releaseSession(slug);
    };
  }, [slug]);

  const { doc, awareness, connId: myConnId, name: myName, color: myColor, connected } = session;

  // ── Throttled awareness publish ─────────────────────────────────────────
  const pendingRef = useRef<Partial<Omit<CollabAwarenessState, '__connId'>> | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishAwareness = useCallback(
    (patch: Partial<Omit<CollabAwarenessState, '__connId'>>) => {
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      if (throttleTimerRef.current) return;
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (!next) return;
        const current = (awareness.getLocalState() ?? {}) as Partial<CollabAwarenessState>;
        awareness.setLocalState({
          name: current.name ?? session.name,
          color: current.color ?? session.color,
          cursor: current.cursor ?? null,
          selection: current.selection ?? null,
          annotationSelection: current.annotationSelection ?? [],
          // Kept across other fields' publishes (a cursor move mid-drag).
          annotationGesture: current.annotationGesture ?? null,
          viewport: current.viewport ?? { x: 0, y: 0, zoom: 1 },
          // S3.7a — a cursor publish must not drop the presenter's position (or a follower's watch);
          // S3.2b nor the Pointer dot; S2.18 nor a hold. One list: carryLocal.
          ...carryLocal(current),
          __connId: myConnId,
          ...next,
        } satisfies CollabAwarenessState);
      }, AWARENESS_THROTTLE_MS);
    },
    [awareness, session, myConnId]
  );

  // ── Cleanup throttle timer on unmount ───────────────────────────────────
  useEffect(
    () => () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    },
    []
  );

  const value = useMemo<CollabValue>(
    () => ({
      doc,
      awareness,
      myColor,
      myName,
      myConnId,
      connected,
      publishAwareness,
    }),
    [doc, awareness, myColor, myName, myConnId, connected, publishAwareness]
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}
