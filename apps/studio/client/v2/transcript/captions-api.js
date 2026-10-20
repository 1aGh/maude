// client/v2/transcript/captions-api.js — S7.11: what the Captions tool, the Transcript panel and the Captions
// inspector DO (registry: video.captions.add / .style / .fix-word, video.transcript.cut / .find-speech / .open).
//
// Every write is one edit op through the shell's ONE clip pipe (`/_api/edit-op`, minRole edit enforced by the
// server): the same bytes the `captions add` / `cut-words` verbs write, one undo step each, the same refusals
// (held-by-ai, locked, a role below Can edit). This module decides WHICH op and says the outcome in CONTRACT
// words; the shell hands it the pipe through `transcriptDoor` (TranscriptHost) so a test hands it a fake one.
//
//   door = { target(): { canvas, artboard } | null,   // the video the panel follows
//            canEdit(): boolean,
//            run(clipRef, verb, params): Promise<answer|null>,   // quiet: this module words the outcome
//            analyse(asset): Promise<{ ok } | { ok:false, reason:'no-engine'|'no-words'|'failed', message? }>,
//            toast(text, ok, action?), undo(), fail(prefix, message), openSettings(),
//            nameOf(src): string }

import { useSyncExternalStore } from 'react';

import { compMediaStore } from './comp-media-store.js';
import {
  buildTranscriptModel,
  captionFixes,
  captionsAddedText,
  cutPlan,
  cutTipText,
  flatItems,
} from './transcript-model.js';

export const NO_ENGINE_TEXT = 'Captions need speech recognition on this Mac.';
export const NO_SPEECH_TEXT = 'No speech found in this video.';

// ── the door ────────────────────────────────────────────────────────────────────────────────────────────
let door = null;
const subs = new Set();
let version = 0;
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

export const transcriptDoor = {
  /** @returns {() => void} take it away again */
  set(next) {
    door = next;
    notify();
    return () => {
      if (door === next) {
        door = null;
        notify();
      }
    };
  },
  get: () => door,
};

// ── the panel + tool state (one per window) ─────────────────────────────────────────────────────────────
const initialUi = () => ({
  /** the Transcript panel is up (it takes the left slot — Q17) */
  open: false,
  /** 'Finding the words…' while speech is being read, else null */
  working: null,
  /** the tool found no speech engine: the explanation + Set up… */
  noEngine: false,
  /** one quiet line (no speech found, a refusal) */
  notice: null,
  /** the keys of the selected words, and the one a shift-click extends from */
  selection: [],
  anchor: null,
  /** the line over the transcript after a cut ("Struck “Ehm…” — cut 0.4 s from the interview") */
  tip: null,
});
let ui = initialUi();
const setUi = (patch) => {
  ui = { ...ui, ...patch };
  notify();
};

export const transcriptUi = {
  get: () => ui,
  set: setUi,
  open: () => setUi({ open: true }),
  close: () => setUi({ open: false, selection: [], anchor: null }),
  toggle: () => (ui.open ? transcriptUi.close() : transcriptUi.open()),
  select: (selection, anchor = ui.anchor) => setUi({ selection, anchor }),
  clearSelection: () => setUi({ selection: [], anchor: null }),
  reset: () => {
    ui = initialUi();
    notify();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
};

/** The window's captions/transcript state; re-renders on any change. */
export function useTranscriptUi() {
  useSyncExternalStore(transcriptUi.subscribe, transcriptUi.version, transcriptUi.version);
  return ui;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const undoAction = (d) => ({ label: 'Undo', onClick: () => d.undo() });

async function reread(d) {
  const t = d.target();
  if (!t) return null;
  return compMediaStore.load(t.canvas, t.artboard);
}

const refusal = (a) => (a && (a.message || a.error)) || 'That did not go through.';

/** The words of "from the interview": the one source's name, or a count. */
function fromText(d, model) {
  const names = model.sections.map((s) => d.nameOf?.(s.src) || s.name);
  if (names.length === 1) return names[0];
  return `${names.length} clips`;
}

// ── Captions from speech (video.captions.add) ──────────────────────────────────────────────────────────
/**
 * The island's Captions from speech tool. Reads the words of every clip that has sound (transcribing the ones
 * that have none yet — on this Mac, never in the cloud), then adds the video's captions. With captions already
 * there it only opens the Transcript panel (Q17).
 * @returns {Promise<{ ok: boolean, reason?: string, words?: number }>}
 */
export async function addCaptionsFromSpeech() {
  const d = door;
  const t = d?.target();
  if (!d || !t) return { ok: false, reason: 'no-video' };
  if (!d.canEdit()) {
    // a viewer / commenter can read the words, not write captions
    transcriptUi.open();
    return { ok: false, reason: 'read-only' };
  }
  if (ui.working) return { ok: false, reason: 'busy' };
  setUi({ working: 'Finding the words…', noEngine: false, notice: null });
  try {
    let media = await reread(d);
    let model = buildTranscriptModel(media);
    for (const src of model.missing) {
      const r = await d.analyse(src);
      if (r?.ok) continue;
      if (r?.reason === 'no-engine') {
        setUi({ noEngine: true });
        return { ok: false, reason: 'no-engine' };
      }
      if (r?.reason === 'no-words') continue; // music, ambience: nothing to caption in that file
      d.fail('Captions', r?.message || 'The words could not be read.');
      return { ok: false, reason: 'failed' };
    }
    if (model.missing.length) {
      media = await reread(d);
      model = buildTranscriptModel(media);
    }
    if (!model.hasWords) {
      setUi({ notice: NO_SPEECH_TEXT });
      return { ok: false, reason: 'no-speech' };
    }
    if (media?.captions) {
      transcriptUi.open();
      return { ok: true, words: media.words?.length ?? 0 };
    }
    const a = await d.run(null, 'video.captions.add', { words: 'line', position: 'bottom' });
    if (!a?.ok) {
      if (a) d.fail('Captions', refusal(a));
      return { ok: false, reason: 'refused' };
    }
    media = await reread(d);
    const n = media?.words?.length ?? 0;
    d.toast(captionsAddedText(n, fromText(d, buildTranscriptModel(media))), true, undoAction(d));
    transcriptUi.open();
    return { ok: true, words: n };
  } finally {
    setUi({ working: null });
  }
}

/** Find speech (video.transcript.find-speech): read the words of the sources that have none, no captions added. */
export async function findSpeech() {
  const d = door;
  const t = d?.target();
  if (!d || !t || !d.canEdit()) return { ok: false };
  if (ui.working) return { ok: false, reason: 'busy' };
  setUi({ working: 'Finding the words…', noEngine: false, notice: null });
  try {
    const model = buildTranscriptModel(await reread(d));
    for (const src of model.missing) {
      const r = await d.analyse(src);
      if (r?.ok || r?.reason === 'no-words') continue;
      if (r?.reason === 'no-engine') {
        setUi({ noEngine: true });
        return { ok: false, reason: 'no-engine' };
      }
      d.fail('Find speech', r?.message || 'The words could not be read.');
      return { ok: false, reason: 'failed' };
    }
    const media = await reread(d);
    if (!buildTranscriptModel(media).hasWords) setUi({ notice: NO_SPEECH_TEXT });
    return { ok: true };
  } finally {
    setUi({ working: null });
  }
}

/** Set up… — Settings, where the person downloads a speech model themselves (never downloaded for them). */
export function setUpSpeech() {
  door?.openSettings?.();
}

// ── edit by transcript (video.transcript.cut) ──────────────────────────────────────────────────────────
/**
 * ⌫ on the selected words: the source time of those words leaves the clip, as ONE undoable edit; the
 * captions follow because they are derived from the cut (no write to them).
 */
export async function cutSelection() {
  const d = door;
  const t = d?.target();
  if (!d || !t || !d.canEdit()) return { ok: false, reason: 'read-only' };
  const media = compMediaStore.get(t.canvas, t.artboard);
  const model = buildTranscriptModel(media, { nameOf: d.nameOf });
  const plan = cutPlan(model, ui.selection);
  if (!plan) return { ok: false, reason: 'nothing-selected' };
  if (plan.refusal) {
    setUi({ notice: plan.refusal });
    return { ok: false, reason: 'refused', message: plan.refusal };
  }
  const a = await d.run({ stableId: plan.clip }, 'cut-source-range', {
    srcStart: plan.srcStart,
    srcEnd: plan.srcEnd,
  });
  if (!a?.ok) {
    if (a) d.fail('Cut', refusal(a));
    return { ok: false, reason: 'refused' };
  }
  await reread(d);
  const from = d.nameOf?.(plan.src) || 'the clip';
  const tip =
    cutTipText(plan, from) + (plan.inPause ? '' : '. Cut inside a phrase — play it back to check');
  setUi({ selection: [], anchor: null, tip, notice: null });
  d.toast(`Cut ${plan.removedSec.toFixed(1)} s.`, true, undoAction(d));
  return { ok: true, plan };
}

// ── fix a word (video.captions.fix-word) ───────────────────────────────────────────────────────────────
/**
 * Typing over a word writes a `fixes` entry into THIS video's <Captions> (keyed by source time, so it
 * survives a re-transcription). Other videos using the same clip keep what they said (V2-1.10 Q4).
 */
export async function fixWord(item, text) {
  const d = door;
  const t = d?.target();
  if (!d || !t || !d.canEdit()) return { ok: false, reason: 'read-only' };
  const media = compMediaStore.get(t.canvas, t.artboard);
  if (!media?.captions) return { ok: false, reason: 'no-captions' };
  const fixes = captionFixes(media.captions.fixes, item, text);
  const a = await d.run(null, 'video.captions.add', { fixes: fixes.length ? fixes : null });
  if (!a?.ok) {
    if (a) d.fail('Caption', refusal(a));
    return { ok: false, reason: 'refused' };
  }
  await reread(d);
  return { ok: true };
}

// ── style (video.captions.style) ───────────────────────────────────────────────────────────────────────
/** Words at a time · Position · Font · Highlight · line length — the props of the one <Captions>. */
export async function styleCaptions(patch) {
  const d = door;
  const t = d?.target();
  if (!d || !t || !d.canEdit()) return { ok: false, reason: 'read-only' };
  const a = await d.run(null, 'video.captions.add', patch);
  if (!a?.ok) {
    if (a) d.fail('Captions', refusal(a));
    return { ok: false, reason: 'refused' };
  }
  await reread(d);
  return { ok: true };
}

/** Everything the lane / panel / inspector draw from, for the video the door follows. */
export function modelFor(media, nameOf) {
  const model = buildTranscriptModel(media, { nameOf });
  return { model, items: flatItems(model) };
}
