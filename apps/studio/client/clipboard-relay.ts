// client/clipboard-relay.ts — the shell half of V2-clipboard-objects: the object / artboard clipboard
// LIVES HERE (decision `maude/v2-clipboard-objects-split`), as a handle only — the copied text stays on
// the server (edit-ops/clipboard.ts). The canvas asks for Cut / Copy / Paste with ordinary `dgn:'edit-op'`
// requests; the shell's edit-op relay passes each through `shapeClipRequest` before forwarding it and
// through `noteClipResult` after.
//
//   copy / cut   forwarded as is; an ok answer's `detail.clip` handle becomes the shell's clipboard.
//   paste        the shell names ITS handle (`params.clip`), overwriting whatever the canvas sent — a
//                canvas can never choose what is pasted. Nothing held → refused here, nothing sent.
//   another canvas  a paste of a clip copied in ANOTHER canvas is not run on the canvas's word: the
//                canvas iframe is untrusted (DDR-054, the C4 frame scope), and planted code there must not
//                pull a different canvas's content into its own file. The shell answers `queued` (the
//                canvas records nothing) and asks in its own toast — "Paste 2 objects from Home?" ·
//                Paste — a click on trusted chrome; only then does the shell run the edit-op itself.

import type { EditOpRequest, EditOpResult } from '../edit-ops/types.ts';

export interface ClipHandle {
  id: string;
  kind: 'objects' | 'artboards';
  count: number;
  /** designRoot-relative canvas the clip was read from */
  from: string;
}

export const CLIP_COPY_OPS: ReadonlySet<string> = new Set([
  'object.copy',
  'object.cut',
  'artboard.copy',
  'artboard.cut',
]);
export const CLIP_PASTE_OP = 'canvas.paste';
export const NOTHING_TO_PASTE = 'Nothing to paste. Copy an object or an artboard first.';
/** #122 — a cloud tab's paste of a copy made elsewhere: the clip lives in a project on this Mac. */
export const CELL_NO_CROSS_PROJECT = 'Paste between projects works for projects on this Mac.';

const CLIP_ID_RE = /^c_[0-9a-f]{16}$/;

let held: ClipHandle | null = null;

/** The handle the shell holds (tests, the menus' "can paste"). */
export function heldClip(): ClipHandle | null {
  return held;
}

/** Tests only. */
export function _setHeldClip(h: ClipHandle | null): void {
  held = h;
}

/** `ui/Home.tsx` / `.design/ui/Home.tsx` → the same key. */
const canvasKey = (f: string) => f.replace(/^\.design\//, '').replace(/^\/+/, '');

/** "Home" for `ui/Home.tsx`. */
export const canvasName = (f: string) =>
  (canvasKey(f).split('/').pop() ?? f).replace(/\.(tsx|jsx)$/, '');

const what = (h: Pick<ClipHandle, 'kind' | 'count'>) =>
  h.kind === 'artboards'
    ? h.count === 1
      ? 'the artboard'
      : `${h.count} artboards`
    : h.count === 1
      ? 'the object'
      : `${h.count} objects`;

export type ClipShape =
  | { kind: 'forward'; body: EditOpRequest }
  | { kind: 'reply'; result: EditOpResult }
  | {
      kind: 'confirm';
      body: EditOpRequest;
      line: string;
      reply: EditOpResult;
      /** #122 (122-C) — a copy from another project: Rust carries it after the click (clip_take) */
      take?: () => Promise<ClipHandle>;
    };

// V2-8.9 attacker L2 — the ask below is trusted chrome, so it fires on the PERSON's schedule: only
// within PASTE_INTENT_MS of a paste the shell itself saw — its own ⌘V / Edit › Paste / ⌘K row
// (menu-runner), or a ⌘V the active frame relayed while it held the focus of a focused window (the
// sec-a undo-key focus gate, use-canvas-bridge). One intent answers one ask. Planted canvas code that
// sends `canvas.paste` on its own timing gets a refusal in the canvas's own words, never the shell's toast.
// A ⌘V the frame relayed is still the CANVAS's say (its code can send that message while it has focus): it
// may unlock a paste between two canvases of this project, never one from another project (`shapeClipPaste`).
export const PASTE_INTENT_MS = 1000;
let pasteIntentAt = Number.NEGATIVE_INFINITY;
let pasteIntentFromShell = false;

/** The clip ask's Paste button is inert this long after the toast appears: a lured click lands on nothing. */
export const CLIP_CONFIRM_ARM_MS = 600;

/** A paste the shell itself saw: a keydown in its own document, its menu, its ⌘K row. */
export function notePasteIntent(now: number = Date.now()): void {
  pasteIntentAt = now;
  pasteIntentFromShell = true;
}

/** A ⌘V the active frame relayed while it held the focus of a focused window. */
export function noteFramePasteIntent(now: number = Date.now()): void {
  pasteIntentAt = now;
  pasteIntentFromShell = false;
}

/** Tests only. */
export function _resetPasteIntent(): void {
  pasteIntentAt = Number.NEGATIVE_INFINITY;
  pasteIntentFromShell = false;
}

/** What the relay does with one canvas edit-op request. */
export function shapeClipRequest(
  body: EditOpRequest,
  { now = Date.now(), cloudTab = false }: { now?: number; cloudTab?: boolean } = {}
): ClipShape {
  if (body.op !== CLIP_PASTE_OP) return { kind: 'forward', body };
  const { clip: _theirs, ...params } = body.params ?? {};
  if (!held)
    return {
      kind: 'reply',
      result: {
        ok: false,
        code: 'invalid',
        message: cloudTab ? CELL_NO_CROSS_PROJECT : NOTHING_TO_PASTE,
      },
    };
  const out: EditOpRequest = { ...body, params: { ...params, clip: held.id } };
  if (canvasKey(held.from) === canvasKey(body.file)) return { kind: 'forward', body: out };
  if (!(now - pasteIntentAt >= 0 && now - pasteIntentAt <= PASTE_INTENT_MS))
    return {
      kind: 'reply',
      result: {
        ok: false,
        code: 'invalid',
        message: `To paste ${what(held)} copied in ${canvasName(held.from)}, press ⌘V.`,
      },
    };
  pasteIntentAt = Number.NEGATIVE_INFINITY;
  return {
    kind: 'confirm',
    body: out,
    line: `Paste ${what(held)} copied in ${canvasName(held.from)}?`,
    // the canvas records nothing for this ask (no write id); the shell's own run records the ⌘Z
    reply: { ok: true, actionId: null, writeId: '', rev: '', refs: [], queued: true },
  };
}

const isHandle = (h: Partial<ClipHandle> | null | undefined): h is ClipHandle =>
  !!h &&
  typeof h.id === 'string' &&
  CLIP_ID_RE.test(h.id) &&
  (h.kind === 'objects' || h.kind === 'artboards') &&
  typeof h.count === 'number' &&
  typeof h.from === 'string';

/** After the server answered: a copy / cut's handle becomes the clipboard (and, on the desktop, the shell's). */
export function noteClipResult(
  body: EditOpRequest,
  result: EditOpResult,
  bridge: ClipBridge | null = tauriClipBridge()
): void {
  if (!result.ok || !CLIP_COPY_OPS.has(body.op)) return;
  const h = (result.detail as { clip?: Partial<ClipHandle> } | undefined)?.clip;
  if (!isHandle(h)) return;
  // #122 (122-C) — the desktop shell keeps the latest copy on this Mac, so another project's tab can paste it
  try {
    Promise.resolve(bridge?.note({ id: h.id, kind: h.kind, count: h.count, from: h.from })).catch(
      () => {}
    );
  } catch {
    /* an older app without the command — same-project paste is unaffected */
  }
  held = { id: h.id, kind: h.kind, count: h.count, from: h.from };
}

/**
 * V2-8.9 attacker L3 — what the CANVAS hears of an edit-op answer: a copy / cut's clip handle stays in
 * the shell (the canvas draws only its kind + count — editing/clipboard.ts), so a sibling frame that
 * reads this one's messages (the split-view origin gap) never learns a handle. Every other answer as is.
 */
export function frameClipResult(body: EditOpRequest, result: EditOpResult): EditOpResult {
  if (!result.ok || !CLIP_COPY_OPS.has(body.op)) return result;
  const detail = result.detail as Record<string, unknown> | undefined;
  const clip = detail?.clip as Partial<ClipHandle> | undefined;
  if (!detail || !clip || typeof clip !== 'object') return result;
  return { ...result, detail: { ...detail, clip: { kind: clip.kind, count: clip.count } } };
}

// ── #122 (122-C) — a paste between two projects on this Mac (contract §5.6) ──────────────────────────
//
// The desktop shell (Rust, clip_bridge.rs) keeps the latest copy made in ANY project tab — in memory, never on
// disk — and answers each tab only kind / count / where (`clip_latest`). A paste whose latest copy was made
// in another project's tab is asked in this shell's own words, on the person's schedule only (the same 1 s
// intent as a cross-canvas paste); after Paste, Rust reads the clip from that project's server and hands it
// to this one's over shell-token routes (`clip_take`), and the paste names the handle Rust brought. The tab
// that copied last wins, like the system clipboard. Cloud tabs and the browser have no bridge.

/** What Rust says about the latest copy on this Mac (never a handle of another tab). */
export interface ClipLatest {
  seq: number;
  /** the latest copy was made in this tab: paste with the shell's own handle */
  mine: boolean;
  kind: ClipHandle['kind'];
  count: number;
  from: string;
  /** the project it was copied in */
  project: string;
}

export interface ClipBridge {
  note(h: ClipHandle): unknown;
  latest(): Promise<ClipLatest | null>;
  take(seq: number): Promise<ClipHandle>;
}

type TauriWin = { __TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => unknown } } };

/** The desktop's three caller-checked commands; null outside the app (the browser, a test). */
export function tauriClipBridge(win: unknown = globalThis): ClipBridge | null {
  const invoke = (win as TauriWin | null)?.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return null;
  return {
    note: (h) => invoke('clip_note', { id: h.id, kind: h.kind, count: h.count, from: h.from }),
    latest: async () => (await invoke('clip_latest')) as ClipLatest | null,
    take: async (seq) => ((await invoke('clip_take', { seq })) as { handle: ClipHandle }).handle,
  };
}

const isLatest = (l: unknown): l is ClipLatest => {
  const v = l as Partial<ClipLatest> | null;
  return (
    !!v &&
    typeof v.seq === 'number' &&
    typeof v.mine === 'boolean' &&
    (v.kind === 'objects' || v.kind === 'artboards') &&
    typeof v.count === 'number' &&
    typeof v.from === 'string' &&
    typeof v.project === 'string'
  );
};

/**
 * `shapeClipRequest`, but on the desktop a paste first asks the shell which copy is the latest on this Mac.
 * Synchronous for everything but a desktop paste (so no other edit-op changes its order).
 */
export function shapeClipPaste(
  body: EditOpRequest,
  {
    now = Date.now(),
    cloudTab = false,
    bridge = tauriClipBridge(),
    synced = false,
    here = '',
  }: {
    now?: number;
    cloudTab?: boolean;
    bridge?: ClipBridge | null;
    /** this project syncs (a linked hub): the ask says the paste lands in a synced project */
    synced?: boolean;
    /** this project's name, for that line */
    here?: string;
  } = {}
): ClipShape | Promise<ClipShape> {
  if (body.op !== CLIP_PASTE_OP || cloudTab || !bridge)
    return shapeClipRequest(body, { now, cloudTab });
  return (async (): Promise<ClipShape> => {
    let latest: unknown = null;
    try {
      latest = await bridge.latest();
    } catch {
      latest = null;
    }
    if (!isLatest(latest) || latest.mine) return shapeClipRequest(body, { now, cloudTab });
    const named = `${what(latest)} copied in ${canvasName(latest.from)} · ${latest.project}`;
    if (!(now - pasteIntentAt >= 0 && now - pasteIntentAt <= PASTE_INTENT_MS))
      return {
        kind: 'reply',
        result: { ok: false, code: 'invalid', message: `To paste ${named}, press ⌘V.` },
      };
    // another project's copy: only a paste the shell itself saw, never a ⌘V the frame relayed
    if (!pasteIntentFromShell)
      return {
        kind: 'reply',
        result: { ok: false, code: 'invalid', message: `To paste ${named}, use Edit › Paste.` },
      };
    pasteIntentAt = Number.NEGATIVE_INFINITY;
    const { clip: _theirs, ...params } = body.params ?? {};
    const seq = latest.seq;
    const into = synced
      ? ` into ${here.trim() ? `the synced project ${here.trim().slice(0, 80)}` : 'this synced project'}`
      : '';
    return {
      kind: 'confirm',
      body: { ...body, params },
      line: `Paste ${named}${into}?`,
      reply: { ok: true, actionId: null, writeId: '', rev: '', refs: [], queued: true },
      take: () => bridge.take(seq),
    };
  })();
}

const GONE_WORDS = 'That copy is gone; copy it again.';

/** After Paste on the shell's toast: the body to run — with the handle Rust brought, for another project's copy. */
export async function confirmedPasteBody(
  shape: Extract<ClipShape, { kind: 'confirm' }>
): Promise<{ ok: true; body: EditOpRequest } | { ok: false; message: string }> {
  if (!shape.take) return { ok: true, body: shape.body };
  let h: unknown;
  try {
    h = await shape.take();
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
    return { ok: false, message: message || GONE_WORDS };
  }
  if (!isHandle(h as Partial<ClipHandle>)) return { ok: false, message: GONE_WORDS };
  return {
    ok: true,
    body: { ...shape.body, params: { ...shape.body.params, clip: (h as ClipHandle).id } },
  };
}
