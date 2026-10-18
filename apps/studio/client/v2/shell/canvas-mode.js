// client/v2/shell/canvas-mode.js — V2-4.3b: the shell OWNS the canvas mode (V2-1.2 §4 decision 1, §5.4).
//
//   Edit (editors) or Viewing (Can view / Can comment) · Preview · Present
//
// Mode is per project window (Q6): a link to another canvas keeps Preview, and every canvas iframe is
// told. S3.1 (D1): this store is the ONE mode owner, Present included — `{ mode, present, returnTo }`.
// The shell's `presentMode` (DDR-117's chrome hiding) is derived from it (`mode === 'present'`), never
// held beside it, so the two cannot disagree. Leaving Present returns to `returnTo`.
//
// Pure and DOM-free: the store, the caps, the M4 router decision and the lane that posts `set-mode`
// AFTER the target layout's insets (§5.6). The hook in use-canvas-mode-lane.js wires them to the shell.

import {
  ALL_CAPS,
  baseMode,
  clampMode,
  initialMode,
  NO_CAPS,
  presentSpec,
  slotAllows,
} from '../../../bridge/canvas-modes.ts';

const COMMENT_ONLY = Object.freeze({ edit: false, annotate: false, comment: true });

/** owner/editor → all · Can comment (today's `viewer`) → comment only · Can view (`observer`) → none. */
export function capsFor({ canEdit, role } = {}) {
  if (canEdit) return ALL_CAPS;
  return role === 'observer' ? NO_CAPS : COMMENT_ONLY;
}

export const sameCaps = (a, b) =>
  a === b ||
  (!!a && !!b && a.edit === b.edit && a.annotate === b.annotate && a.comment === b.comment);

/** The segments of the switch, left to right. Editing controls are hidden for viewing roles, never
 *  greyed (04 · md-model): the first slot is Edit or Viewing. */
export const modeSegments = (caps) => [caps.edit ? 'edit' : 'viewing', 'preview', 'present'];

export const MODE_WORD = Object.freeze({
  edit: 'Edit',
  viewing: 'Viewing',
  preview: 'Preview',
  present: 'Present',
});

/**
 * The shell's mode store. `nonce` changes on every `select`, so choosing the mode you are already in
 * still re-sends `set-mode` — with the mode's resting tool, the "get me out of the pen" gesture the
 * palette's active segment used to be.
 *
 * Present (S3.1): `present(spec)` enters with `returnTo` = the mode you were in; `back()` leaves to
 * it. `position` is the Present · Artboards echo (`present-position`) while presenting.
 */
export function createShellMode(caps = ALL_CAPS) {
  let snap = Object.freeze({
    mode: initialMode(caps),
    tool: null,
    nonce: 0,
    present: null,
    returnTo: null,
    position: null,
  });
  const subs = new Set();
  const emit = (next) => {
    snap = Object.freeze({ ...snap, ...next });
    for (const fn of subs) fn();
  };
  const notPresenting = { present: null, returnTo: null, position: null };
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** A person chose `mode` (the switch, a menu, a granted `mode-request`). Choosing a mode while
     *  presenting leaves Present for it. Present itself goes through `present(spec)`. */
    select(mode, { tool = null } = {}) {
      if (mode === 'present') return;
      emit({ mode, tool, nonce: snap.nonce + 1, ...notPresenting });
    },
    /** Enter Present (Artboards or the Canvas). Already presenting: nothing (esc leaves first). */
    present(spec) {
      if (snap.mode === 'present') return false;
      emit({
        mode: 'present',
        tool: null,
        nonce: snap.nonce + 1,
        present: presentSpec(spec),
        returnTo: snap.mode,
        position: null,
      });
      return true;
    },
    /** Leave Present for where it was entered from (esc, the pill, `mode-request back`). */
    back() {
      if (snap.mode !== 'present') return false;
      emit({ mode: snap.returnTo ?? 'edit', tool: null, nonce: snap.nonce + 1, ...notPresenting });
      return true;
    },
    /** The presenting canvas moved on (`present-position`). Kept only while presenting artboards. */
    position(pos) {
      if (snap.mode !== 'present' || snap.present?.kind !== 'artboards') return;
      const p = snap.position;
      if (p && p.index === pos.index && p.total === pos.total && p.artboardId === pos.artboardId)
        return;
      emit({ position: { index: pos.index, total: pos.total, artboardId: pos.artboardId } });
    },
    /** The canvas clamped us (a `mode-changed` with cause `clamp`): adopt it without re-sending. */
    adopt(mode) {
      if (mode === 'present' || snap.mode === 'present') return;
      if (mode !== snap.mode) emit({ mode, tool: null });
    },
    /** A role change (demoted / promoted): `clampMode(current, caps')`. Before anyone chose a mode
     *  (the role arrives with `/_config`, after boot) it is the boot posture instead: a view-only link
     *  opens in Preview, as DDR-223's read-only canvas does. Present stays (any role may present
     *  locally); where it returns to is clamped. */
    clamp(caps2) {
      if (snap.mode === 'present') {
        const r = snap.returnTo && clampMode(snap.returnTo, caps2);
        if (r !== snap.returnTo) emit({ returnTo: r });
        return;
      }
      const m = snap.nonce === 0 ? initialMode(caps2) : clampMode(snap.mode, caps2);
      if (m !== snap.mode)
        emit({ mode: m, tool: null, nonce: snap.nonce === 0 ? 0 : snap.nonce + 1 });
    },
  };
}

/** D1 — the shell's `presentMode`, derived from the one store. */
export const presentingOf = (snap) => snap.mode === 'present';

/**
 * Where Present starts (04 md-present-menu, CONTRACT §2 ⌥⌘↵ / ⇧⌥⌘↵):
 *   'selection' — the selected artboard, else the artboard in view, else the start;
 *   'start'     — the first artboard in canvas order;
 *   'canvas'    — Present the canvas (pan freely).
 */
export function presentSpecFor(kind, { selectedArtboard = null, inViewArtboard = null } = {}) {
  if (kind === 'canvas') return { kind: 'canvas' };
  if (kind === 'start') return { kind: 'artboards', from: 'start' };
  return presentSpec({ kind: 'artboards', from: selectedArtboard || inViewArtboard || 'start' });
}

/** The mode the canvases are in, clamped by the role (Present passes through). */
export const effectiveMode = (mode, caps) => clampMode(mode, caps);

/** The `set-mode` payload for one frame (§5.2: ≤ 300 bytes, M5). `tool` only for the active frame.
 *  S3.7a — `caps.present` (the canvas may publish its Present · Artboards position on awareness): Present
 *  · Artboards and `edit`, or presenter view on (S3.6b passes `presenterView`; S3-present-session §3). */
export function setModeMessage({ seq, mode, caps, tool, present = null, presenterView = false }) {
  const spec = mode === 'present' ? presentSpec(present) : null;
  const msg = {
    dgn: 'set-mode',
    v: 2,
    seq,
    mode,
    present: spec,
    caps: {
      edit: !!caps.edit,
      annotate: !!caps.annotate,
      comment: !!caps.comment,
      present: spec?.kind === 'artboards' && (!!caps.edit || !!presenterView),
    },
  };
  if (tool) msg.tool = tool;
  return msg;
}

/**
 * M4 — what a `mode-request` from a canvas does. The caller has already checked it came from the
 * ACTIVE canvas (the table's `active` gate); this adds "no modal open" and "the role allows it".
 * @returns {{ kind: 'set', mode, tool? } | { kind: 'present', present } | { kind: 'exit-present', next? }
 *           | { kind: 'deny', reason: 'modal' | 'role' } | null}   null = nothing to do
 */
export function decideModeRequest(req, { caps, presenting, mode, modalOpen }) {
  if (!req) return null;
  if (modalOpen) return { kind: 'deny', reason: 'modal' };
  if (req.mode === 'back') {
    if (presenting) return { kind: 'exit-present' };
    if (mode === 'preview') return { kind: 'set', mode: baseMode(caps) };
    return null;
  }
  if (req.mode === 'present')
    return presenting ? null : { kind: 'present', present: presentSpec(req.present) };
  if (req.mode === 'edit' && !caps.edit) return { kind: 'deny', reason: 'role' };
  const target = clampMode(req.mode, caps);
  // V2-4.5b (Q2): a key the role may not use — a viewing role's N / M / A / S, or C without the
  // comment cap — gets the denial line; the canvas asks anyway because the shell owns the role.
  if (req.tool && !slotAllows(target, req.tool, caps)) return { kind: 'deny', reason: 'role' };
  const set = req.tool
    ? { kind: 'set', mode: target, tool: req.tool }
    : { kind: 'set', mode: target };
  return presenting ? { kind: 'exit-present', next: set } : set;
}

/** Q1 — ⌥⌘P (and Menu / ⌘K "Preview"): Preview toggles back to `baseMode`, anything else enters
 *  Preview. The shell-focus key handler selects this; the canvas-focus key asks with `back`. */
export const previewToggleTarget = (mode, caps) =>
  mode === 'preview' ? baseMode(caps) : 'preview';

/**
 * The one sender of `set-mode`. For a mode transition it sends the TARGET layout's insets first
 * (`flushInsets` re-measures the islands after the fold committed and posts `occluded-insets` when
 * they changed) — postMessage between two windows is delivered in order, so the canvas eases into
 * the post-fold visible area (§5.6).
 * @param frames () => Window[]           every canvas iframe's window
 * @param active () => Window | null       the active one (gets the tool)
 * @param flushInsets () => void
 */
export function createModeLane({ frames, active, flushInsets = () => {} }) {
  let seq = 0;
  const post = (win, m) => {
    try {
      win?.postMessage(m, '*');
    } catch {
      /* detached */
    }
  };
  return {
    /** A mode transition (or a role change): insets first, then every frame. */
    broadcast({ mode, caps, tool = null, present = null }) {
      flushInsets();
      const act = active();
      for (const win of frames()) {
        seq += 1;
        post(win, setModeMessage({ seq, mode, caps, present, tool: win === act ? tool : null }));
      }
    },
    /** Tell ONE frame the current mode (a freshly loaded or newly active canvas). No tool: a seed never
     *  re-arms a tool the canvas already holds. */
    seed(win, { mode, caps, present = null }) {
      seq += 1;
      post(win, setModeMessage({ seq, mode, caps, present, tool: null }));
    },
    /** Present · Artboards: step the active canvas (shell controls, presenter view — S3.2b). */
    step(win, to) {
      if (to !== 'next' && to !== 'prev' && !(Number.isInteger(to) && to >= 0)) return;
      post(win, { dgn: 'present-step', to });
    },
    get seq() {
      return seq;
    },
  };
}
