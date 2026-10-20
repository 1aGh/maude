// client/v2/timeline/advanced/video-cap.js — S7.18 / C22: how long one export of this video may be, said in the
// Timeline and written per artboard (`video.allow-longer`).
//
//   · past 3 600 frames (2:00 at 30 fps) the video WARNS — here, in the Export sheet and on the server, one
//     number (exporters/video-cap.ts), one sentence (export/sections/video-copy.js `overCapLine`);
//   · "Allow longer" stores `artboardMeta[id].maxFrames` (the exporter's ceiling, 18 000 frames) through the one
//     meta route, `PATCH /_api/present-meta { file, maxFrames: { [id]: n | null } }` — Can edit and up, refused
//     below that by the server whatever the UI shows; "Back to the limit" takes it off again.
// The Export sheet's own Allow longer stays the per-export switch; what this stores is the artboard's ceiling
// (`stored is a ceiling, not a switch`, test/export-video-sound.test.ts), the number S8's server reads.
// A small store like poster.js, so the badge, the Advanced row and the ⌘K action read one answer.

import { useSyncExternalStore } from 'react';
import {
  ALLOW_LONGER,
  ALLOW_LONGER_OFF,
  clock,
  overCapLine,
} from '../../export/sections/video-copy.js';

/** C22: one export goes up to 3 600 frames unless the artboard allows longer. */
export const DEFAULT_CAP = 3600;
/** The exporter's ceiling — what "Allow longer" asks for. */
export const CAP_CEILING = 18000;

export const CAP_WORDS = Object.freeze({
  allow: ALLOW_LONGER,
  back: ALLOW_LONGER_OFF,
  limit: (cap, fps) =>
    `One export goes up to ${clock(cap, fps)} (${cap.toLocaleString('en-US')} frames at ${fps} fps).`,
  longer: (label, cap, fps) =>
    `${label} may export up to ${clock(cap, fps)} (${cap.toLocaleString('en-US')} frames).`,
  past: (label, frames, cap, fps) =>
    `${label} is ${clock(frames, fps)} long — more than the ${clock(cap, fps)} it may export. Trim it to export it.`,
  readOnly: 'Your role can’t change how long this video may be.',
  failed: 'Not saved — the limit stays as it was.',
  none: 'Select a video first.',
  on: 'Longer videos are on.',
  off: 'Back to the limit.',
});

/**
 * What the Timeline says about the length of one video.
 * @param {{ frames: number, fps?: number, stored?: number|null, label?: string }} p
 * @returns {{ kind: 'ok'|'warn'|'allowed'|'past', warn: boolean, cap: number, line: string, action: 'allow'|'back'|null, actionLabel: string|null }}
 */
export function capView({ frames, fps = 30, stored = null, label = 'This video' }) {
  const f = Number.isFinite(frames) ? Math.max(0, Math.round(frames)) : 0;
  const rate = Math.max(1, Math.round(fps || 30));
  if (stored != null) {
    const cap = Math.max(DEFAULT_CAP, stored);
    if (f > cap)
      return {
        kind: 'past',
        warn: true,
        cap,
        line: CAP_WORDS.past(label, f, cap, rate),
        action: 'back',
        actionLabel: CAP_WORDS.back,
      };
    return {
      kind: 'allowed',
      warn: f > DEFAULT_CAP,
      cap,
      line: CAP_WORDS.longer(label, cap, rate),
      action: 'back',
      actionLabel: CAP_WORDS.back,
    };
  }
  if (f > DEFAULT_CAP)
    return {
      kind: 'warn',
      warn: true,
      cap: DEFAULT_CAP,
      line: overCapLine({ label, frames: f, fps: rate, cap: DEFAULT_CAP, allowed: false }),
      action: 'allow',
      actionLabel: CAP_WORDS.allow,
    };
  return {
    kind: 'ok',
    warn: false,
    cap: DEFAULT_CAP,
    line: CAP_WORDS.limit(DEFAULT_CAP, rate),
    action: null,
    actionLabel: null,
  };
}

// ── the stored number ───────────────────────────────────────────────────────────────────────────────
const entries = new Map(); // `${file}\u0000${id}` → frames | null
const subs = new Set();
let version = 0;
const keyOf = (file, id) => `${file}\u0000${id}`;
const notify = () => {
  version++;
  for (const fn of subs) fn();
};

/** The stored limit of one video (frames), or null = the default. */
export const maxFramesOf = (file, id) => entries.get(keyOf(file, id)) ?? null;

const isStored = (n) => Number.isInteger(n) && n >= 1 && n <= CAP_CEILING;

/** Read what the canvas's meta says about this video's limit. */
export async function loadMaxFrames(file, id, fetchImpl = globalThis.fetch) {
  if (!file || !id) return;
  try {
    const r = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    const n = meta?.artboardMeta?.[id]?.maxFrames;
    entries.set(keyOf(file, id), isStored(n) ? n : null);
  } catch {
    // the default stays on screen
  }
  notify();
}

/** Store `frames` (null = back to the limit). Resolves `{ ok, message }` — the words are the toast's. */
export async function saveMaxFrames(file, id, frames, fetchImpl = globalThis.fetch) {
  const before = maxFramesOf(file, id);
  entries.set(keyOf(file, id), frames);
  notify();
  try {
    const r = await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, maxFrames: { [id]: frames } }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    const kept = body?.maxFrames?.[id];
    entries.set(keyOf(file, id), isStored(kept) ? kept : null);
    notify();
    return { ok: true, message: frames === null ? CAP_WORDS.off : CAP_WORDS.on };
  } catch (e) {
    entries.set(keyOf(file, id), before);
    notify();
    return {
      ok: false,
      message: /403/.test(String(e?.message)) ? CAP_WORDS.readOnly : CAP_WORDS.failed,
    };
  }
}

// ── the video the action reads ──────────────────────────────────────────────────────────────────────
let source = () => null;
/** The Timeline says which video it follows: `() => { file, artboardId } | null`. */
export function bindCapTarget(fn) {
  source = typeof fn === 'function' ? fn : () => null;
}

/** `video.allow-longer`: the followed video may export up to the ceiling (`on: false` = back to the limit). */
export async function allowLongerAtFollowed(on = true, fetchImpl = globalThis.fetch) {
  const at = source();
  if (!at?.file || !at.artboardId) return CAP_WORDS.none;
  const done = await saveMaxFrames(at.file, at.artboardId, on ? CAP_CEILING : null, fetchImpl);
  return done.message;
}

/** Re-renders when any stored limit changes. */
export function useCapVersion() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
    () => version
  );
}
