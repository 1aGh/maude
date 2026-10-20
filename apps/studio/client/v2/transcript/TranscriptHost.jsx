// client/v2/transcript/TranscriptHost.jsx — S7.11: the Transcript panel wired to the shell (07 · ve-captions).
//
// Always mounted (like the timeline host), and does three jobs:
//   · FEED   keeps `comp-media-store` fresh for the video the timeline follows — it asks again when the canvas
//            changed (the comp announced itself, a teammate wrote, our own write landed);
//   · DOOR   hands captions-api.js the shell's pieces: the ONE clip pipe (`timelineClipVerb`, so the undo, the
//            refusal and the toast are a gesture's), toasts, Undo, Settings, and the speech reader;
//   · PANEL  draws the Transcript island when `transcriptUi.open`.

import { useEffect, useMemo, useRef } from 'react';
import { runActionMessage } from '../../actions/shell-key-handlers.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { usePanelLayout } from '../shell/use-panel-layout.js';
import {
  cutSelection,
  findSpeech,
  fixWord,
  setUpSpeech,
  transcriptDoor,
  transcriptUi,
  useTranscriptUi,
} from './captions-api.js';
import { compMediaStore, useCompMedia } from './comp-media-store.js';
import { TranscriptPanel } from './TranscriptPanel.jsx';
import { buildTranscriptModel } from './transcript-model.js';

const FEED_MS = 120;

/** `assets/7c40e2b1.mp4` → the clip's name on the timeline ("Rozhovor · Kilián"), else the file's name. */
export function sourceNamer(sequences) {
  return (src) => {
    const base = String(src).replace(/^.*\//, '');
    const row = (sequences || []).find((r) => r?.mediaSrc && String(r.mediaSrc).endsWith(base));
    const label = row?.label;
    if (label && !['Video', 'OffthreadVideo', 'MaudeVideo', 'Audio'].includes(label)) return label;
    return base;
  };
}

/** `POST /_api/media-analysis` → the answer captions-api.js reads. */
export async function analyseAsset(asset, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/_api/media-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset, kind: 'transcript' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) return { ok: true };
    if (j?.error === 'no-engine') return { ok: false, reason: 'no-engine' };
    if (j?.error === 'no-words') return { ok: false, reason: 'no-words' };
    return { ok: false, reason: 'failed', message: j?.message };
  } catch {
    return { ok: false, reason: 'failed', message: 'The studio did not answer.' };
  }
}

export default function TranscriptHost() {
  const {
    shellCore: {
      activeComps,
      activePath,
      postToActiveCanvas,
      setSettingsOpen,
      timelineArtboardId,
      timelineFrame,
      timelineOpFailed,
      timelineRefresh,
      timelineSequences,
      viewerMode,
    },
    photoAndTimeline: { timelineClipVerb },
  } = useShellStore();
  const ui = useTranscriptUi();
  const { hidden: panelsHidden } = usePanelLayout();

  const canvas =
    activePath && activePath !== SYSTEM_TAB && activeComps.length > 0 ? activePath : null;
  const artboard = canvas ? (timelineArtboardId ?? null) : null;

  // ── FEED ──
  useEffect(() => {
    if (!canvas || !artboard) return undefined;
    const t = setTimeout(() => void compMediaStore.load(canvas, artboard), FEED_MS);
    return () => clearTimeout(t);
    // biome-ignore lint/correctness/useExhaustiveDependencies: these are the "the canvas changed" signals
  }, [canvas, artboard, activeComps, timelineRefresh, timelineSequences]);

  // another video: its words are not these words
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target changing is the trigger
  useEffect(() => {
    transcriptUi.clearSelection();
    transcriptUi.set({ tip: null, notice: null, noEngine: false });
    if (!canvas) transcriptUi.close();
  }, [canvas, artboard]);

  // ── DOOR ──
  const live = useRef({});
  live.current = {
    canvas,
    artboard,
    viewerMode,
    timelineClipVerb,
    postToActiveCanvas,
    setSettingsOpen,
    timelineOpFailed,
    sequences: timelineSequences,
  };
  useEffect(
    () =>
      transcriptDoor.set({
        target: () =>
          live.current.canvas && live.current.artboard
            ? { canvas: live.current.canvas, artboard: live.current.artboard }
            : null,
        canEdit: () => !live.current.viewerMode,
        run: (clipRef, verb, params) =>
          live.current.timelineClipVerb(clipRef, verb, params, { quiet: true }),
        analyse: (asset) => analyseAsset(asset),
        toast: (text, ok, action) => shellToast(text, ok, action),
        undo: () => live.current.postToActiveCanvas(runActionMessage('edit.undo')),
        fail: (prefix, message) => live.current.timelineOpFailed(prefix, message),
        openSettings: () => live.current.setSettingsOpen(true),
        nameOf: (src) => sourceNamer(live.current.sequences)(src),
      }),
    []
  );

  // ── PANEL ──
  const { media } = useCompMedia(canvas, artboard);
  const model = useMemo(
    () => buildTranscriptModel(media, { nameOf: sourceNamer(timelineSequences) }),
    [media, timelineSequences]
  );
  if (!ui.open || !canvas || !artboard || panelsHidden) return null;
  return (
    <TranscriptPanel
      model={model}
      ui={ui}
      frame={timelineFrame ?? 0}
      canEdit={!viewerMode}
      onSelect={(keys, anchor) => transcriptUi.select(keys, anchor)}
      onCut={() => void cutSelection()}
      onFix={(item, text) => fixWord(item, text)}
      onFindSpeech={() => void findSpeech()}
      onSetUp={setUpSpeech}
      onClose={transcriptUi.close}
    />
  );
}
