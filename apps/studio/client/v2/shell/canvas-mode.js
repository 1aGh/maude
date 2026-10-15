// client/v2/shell/canvas-mode.js — V2-4.3b: the shell OWNS the canvas mode (V2-1.2 §4 decision 1, §5.4).
//
//   Edit (editors) or Viewing (Can view / Can comment) · Preview · Present
//
// Mode is per project window (Q6): a link to another canvas keeps Preview, and every canvas iframe is
// told. Present stays today's shell-level Present (`presentMode`, DDR-117) — this store holds the mode
// you are in when you are NOT presenting, so leaving Present returns to it.
//
// Pure and DOM-free: the store, the caps, the M4 router decision and the lane that posts `set-mode`
// AFTER the target layout's insets (§5.6). The hook in use-canvas-mode-lane.js wires them to the shell.

import {
  ALL_CAPS,
  baseMode,
  clampMode,
  initialMode,
  NO_CAPS,
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
 */
export function createShellMode(caps = ALL_CAPS) {
  let snap = Object.freeze({ mode: initialMode(caps), tool: null, nonce: 0 });
  const subs = new Set();
  const emit = (next) => {
    snap = Object.freeze(next);
    for (const fn of subs) fn();
  };
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** A person chose `mode` (the switch, a menu, a granted `mode-request`). */
    select(mode, { tool = null } = {}) {
      emit({ mode, tool, nonce: snap.nonce + 1 });
    },
    /** The canvas clamped us (a `mode-changed` with cause `clamp`): adopt it without re-sending. */
    adopt(mode) {
      if (mode !== snap.mode) emit({ ...snap, mode, tool: null });
    },
    /** A role change (demoted / promoted): `clampMode(current, caps')`. Before anyone chose a mode
     *  (the role arrives with `/_config`, after boot) it is the boot posture instead: a view-only link
     *  opens in Preview, as DDR-223's read-only canvas does. */
    clamp(caps2) {
      const m = snap.nonce === 0 ? initialMode(caps2) : clampMode(snap.mode, caps2);
      if (m !== snap.mode) emit({ mode: m, tool: null, nonce: snap.nonce === 0 ? 0 : snap.nonce + 1 });
    },
  };
}

/** The mode the canvases are in: Present while presenting, else the stored mode clamped by the role. */
export const effectiveMode = (mode, caps, presenting) =>
  presenting ? 'present' : clampMode(mode, caps);

/** The `set-mode` payload for one frame (§5.2: ≤ 300 bytes, M5). `tool` only for the active frame. */
export function setModeMessage({ seq, mode, caps, tool }) {
  const msg = {
    dgn: 'set-mode',
    v: 2,
    seq,
    mode,
    present: mode === 'present' ? { kind: 'canvas' } : null,
    caps: { edit: !!caps.edit, annotate: !!caps.annotate, comment: !!caps.comment },
  };
  if (tool) msg.tool = tool;
  return msg;
}

/**
 * M4 — what a `mode-request` from a canvas does. The caller has already checked it came from the
 * ACTIVE canvas (the table's `active` gate); this adds "no modal open" and "the role allows it".
 * @returns {{ kind: 'set', mode, tool? } | { kind: 'present' } | { kind: 'exit-present', next? }
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
  if (req.mode === 'present') return presenting ? null : { kind: 'present' };
  if (req.mode === 'edit' && !caps.edit) return { kind: 'deny', reason: 'role' };
  const target = clampMode(req.mode, caps);
  const set = req.tool
    ? { kind: 'set', mode: target, tool: req.tool }
    : { kind: 'set', mode: target };
  return presenting ? { kind: 'exit-present', next: set } : set;
}

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
    broadcast({ mode, caps, tool = null }) {
      flushInsets();
      const act = active();
      for (const win of frames()) {
        seq += 1;
        post(win, setModeMessage({ seq, mode, caps, tool: win === act ? tool : null }));
      }
    },
    /** Tell ONE frame the current mode (a freshly loaded or newly active canvas). No tool: a seed never
     *  re-arms a tool the canvas already holds. */
    seed(win, { mode, caps }) {
      seq += 1;
      post(win, setModeMessage({ seq, mode, caps, tool: null }));
    },
    get seq() {
      return seq;
    },
  };
}
