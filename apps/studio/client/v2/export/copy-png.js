// client/v2/export/copy-png.js — S8.8: Copy as PNG (⇧⌘C, registry `export.copy-png`).
//
// "⇧⌘C copies it as a PNG to paste into a chat or a post." What is selected is rendered by the same export
// the sheet runs (one spec, the jobs lane), the finished PNG is fetched by job id, and `nativeSave().copyPng`
// puts it on the clipboard — `navigator.clipboard` first, the desktop shell's `clipboard_write_png` when
// WKWebView refuses (S8.23, Q13). No sheet, nothing saved to a folder; the job lands in the Exports panel.
//
// One artboard or one object. Several things cannot be one image: the answer says so instead of picking one.
//
// Everything that touches the world is injectable (`fetchImpl`, `copy`, `wait`), so a test runs the whole
// path without a server, a clipboard or a clock.

import { titleOf } from '../inspector/model.js';
import { isArtboardSelection } from '../inspector/kinds/index.js';
import { nativeSave } from './native-save.js';
import { quickExport } from './use-export-spec.js';
import { specsFor } from './export-sizes.js';

export const COPY_WORDS = Object.freeze({
  none: 'Select an artboard or an object first.',
  several: 'Copy as PNG takes one artboard or one object.',
  noId: 'Give this object an id first (Advanced › Element id).',
  noCanvas: 'Open a canvas first.',
  failed: 'Not copied; try again.',
  timeout: 'The image took too long. Export it instead.',
  notPng: 'That export is not a single PNG.',
});

export const copiedWords = (name) => `Copied “${name}” as a PNG — paste it anywhere.`;

/** An artboard is copied at its own size (1×), an object at 2× — the same scales the section offers first. */
const ARTBOARD_SCALE = 1;
const OBJECT_SCALE = 2;

/**
 * What ⇧⌘C copies, as a target + a scale — or the plain line saying why not.
 * `selected`: the shell's selection (one element, or an array).
 */
export function copyTarget(selected) {
  const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
  if (!list.length) return { ok: false, reason: COPY_WORDS.none };
  if (list.length > 1) return { ok: false, reason: COPY_WORDS.several };
  const el = list[0];
  if (isArtboardSelection(el)) {
    const id = el.artboardId || el.attrs?.['data-dc-screen'];
    return id
      ? { ok: true, target: { artboardId: id }, scale: ARTBOARD_SCALE, name: titleOf(el, null) }
      : { ok: false, reason: COPY_WORDS.none };
  }
  if (!el.id) return { ok: false, reason: COPY_WORDS.noId };
  return {
    ok: true,
    target: { elementIds: [el.id] },
    scale: OBJECT_SCALE,
    name: titleOf(el, null),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the jobs list until this job is done (or failed, or the time is up). */
async function finished(jobId, { fetchImpl, wait, pollMs, timeoutMs }) {
  const t0 = Date.now();
  for (;;) {
    const r = await fetchImpl('/_api/export-jobs');
    if (r.ok) {
      const job = (await r.json())?.jobs?.find((j) => j.id === jobId);
      if (job?.status === 'done') return { ok: true };
      if (job?.status === 'failed') return { ok: false, error: job.error || COPY_WORDS.failed };
    }
    if (Date.now() - t0 > timeoutMs) return { ok: false, error: COPY_WORDS.timeout };
    await wait(pollMs);
  }
}

/**
 * Render the selection as a PNG and put it on the clipboard.
 * @param {object} o
 * @param o.selected    the shell's selection
 * @param o.canvasFile  repo-relative canvas file (`.design/ui/Home.tsx`)
 * @param o.designRel   the design root (`.design`)
 * @returns {Promise<{ ok: boolean, message: string }>} the line to say (a toast)
 */
export async function copyAsPng({
  selected,
  canvasFile,
  designRel,
  fetchImpl = globalThis.fetch,
  copy = (blob) => nativeSave().copyPng(blob),
  wait = sleep,
  pollMs = 200,
  timeoutMs = 60_000,
}) {
  const t = copyTarget(selected);
  if (!t.ok) return { ok: false, message: t.reason };
  if (!canvasFile) return { ok: false, message: COPY_WORDS.noCanvas };
  try {
    const [spec] = specsFor([{ format: 'png', scale: t.scale }], t.target, {
      canvasFile,
      designRel,
    });
    const { jobId } = await quickExport(spec, fetchImpl);
    const done = await finished(jobId, { fetchImpl, wait, pollMs, timeoutMs });
    if (!done.ok) return { ok: false, message: done.error };
    const res = await fetchImpl(`/_api/export-jobs/download?id=${encodeURIComponent(jobId)}`);
    if (!res.ok) return { ok: false, message: COPY_WORDS.failed };
    const blob = await res.blob();
    if (blob.type && blob.type !== 'image/png') return { ok: false, message: COPY_WORDS.notPng };
    const put = await copy(
      blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: 'image/png' })
    );
    if (!put.ok) return { ok: false, message: put.error || COPY_WORDS.failed };
    return { ok: true, message: copiedWords(t.name) };
  } catch (e) {
    return {
      ok: false,
      message: e?.message && e.message.length < 120 ? e.message : COPY_WORDS.failed,
    };
  }
}

// ── the shell's binding (⇧⌘C, ⌘K, the menu all run the same function) ────────────────────────────
// The shell binds what it knows about the selection once (hooks/use-palette-and-panels.jsx); the key handler,
// the menu runner and the palette then call `runCopyPng()` and say what it answers. Nothing bound (no shell,
// a test) is one plain line, never a silent key.
let bound = null;

/** `read()` → { selected, canvasFile, designRel }. Returns the unbind (only removes its own). */
export function bindCopyPng(read) {
  bound = read;
  return () => {
    if (bound === read) bound = null;
  };
}

/** What the shell bound — `{ selected, canvasFile, designRel }` — or null (Copy export command reads it too). */
export const boundCopyState = () => (bound ? bound() : null);

/** Run ⇧⌘C on what the shell is showing. Resolves `{ ok, message }`. */
export async function runCopyPng(opts = {}) {
  if (!bound) return { ok: false, message: COPY_WORDS.none };
  const state = bound();
  return copyAsPng({ ...state, ...opts });
}
