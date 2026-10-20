// actions/defs/video.ts — the video tools (S7.6c; V2-1.10 §5.7 registry table + S7-slices S7.6).
//
// Twelve ids from V2-1.10 §5.7 plus the five S7.6 adds (`video.format.add/unlink`, `video.take.swap`,
// `video.fit`, `video.place`). Each write is one edit op (`POST /_api/edit-op`, edit-ops/clip/*) or a verb that
// ends in one, so the server refuses every role below Can edit whatever the UI shows (hidden ≠
// refused); the AI paths are in agents.ts. The rows are greyed below Can edit and `video.captions.
// export` is a read Can comment may run (A6: comment can download).
//
// Their surfaces are the Timeline island, the clip inspector and the Transcript panel (S7.9–S7.13),
// which bind these ids as they land; until then the rows stay out of ⌘K (`search.hidden`) so no
// row is offered without a runner.

import type { ActionDef } from '../types.ts';

const EDITS = { minRole: 'edit' as const };
const LATER = (where: string) => ({ hidden: true, where, note: 'bound by its S7 surface' });

const row = (
  id: string,
  label: string,
  where: string,
  minRole: 'edit' | 'comment' = 'edit'
): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
  enabled: minRole === 'edit' ? EDITS : { minRole },
  search: LATER(where),
});

export const VIDEO_ACTIONS: ActionDef[] = [
  // S7.11 — bound: the island's Captions from speech tool, and the Transcript panel (07 ve-captions)
  {
    ...row('video.captions.add', 'Captions from speech', 'Timeline › Captions'),
    search: {
      where: 'Timeline › Captions',
      keywords: ['captions', 'subtitles', 'speech', 'transcribe'],
    },
  },
  {
    ...row('video.transcript.open', 'Transcript', 'Timeline › Transcript', 'comment'),
    search: {
      where: 'Timeline › Transcript',
      keywords: ['transcript', 'words', 'captions', 'text'],
    },
  },
  row('video.captions.style', 'Caption style', 'Inspector › Captions'),
  row('video.captions.fix-word', 'Fix a caption word', 'Transcript panel'),
  row('video.captions.export', 'Export captions', 'Export sheet', 'comment'),
  row('video.transcript.cut', 'Cut these words', 'Transcript panel'),
  row('video.transcript.find-speech', 'Find speech', 'Transcript panel'),
  row('video.music.beats', 'Find the beat', 'Inspector › Music'),
  row('video.music.duck', 'Lower under speech', 'Inspector › Music'),
  // S7.12 — the Music inspector's Volume (a clip or a loose bed; `clip.audio` only reaches clips)
  row('video.music.volume', 'Music volume', 'Inspector › Music'),
  row('video.cut-to-beat', 'Cut to the beat', 'Inspector › Music'),
  row('video.snap', 'Snap to the beat', 'Timeline'),
  // S7.13 — bound: the clip inspector's Framing › Re-frame… opens the island on the selected clip (07 ve-reframe)
  {
    ...row('video.reframe', 'Re-frame', 'Timeline › Re-frame'),
    search: {
      where: 'Timeline › Re-frame',
      keywords: ['reframe', 'crop', 'framing', 'vertical', 'focus', 'window'],
    },
  },
  // S7.8 — bound: the playhead's frame becomes the poster (`artboardMeta.poster`), from ⌘K and the Poster flag on
  // the ruler. The inspector's Poster section (S7.5+) places the same id.
  {
    ...row('video.poster.set', 'Set as poster frame', 'Timeline'),
    search: { where: 'Timeline › Poster', keywords: ['poster', 'cover', 'thumbnail'] },
  },
  // S7.13 — bound: the Video inspector's Formats rows (07 ve-formats). ⌘K reaches them through formats-ui.js: Add a format
  // opens the size list, Make an unlinked copy runs on the selected video.
  {
    ...row('video.format.add', 'Add a format', 'Inspector › Formats'),
    search: {
      where: 'Inspector › Formats',
      keywords: ['format', 'size', '16:9', '9:16', '1:1', 'reels', 'linked', 'aspect'],
    },
  },
  {
    ...row('video.format.unlink', 'Make an unlinked copy', 'Inspector › Formats'),
    search: {
      where: 'Inspector › Formats',
      keywords: ['unlink', 'copy', 'own cut', 'fork', 'format'],
    },
  },
  // S7.18 — bound: Timeline › Advanced › Long videos. C22: past 3 600 frames a video warns; this stores the
  // artboard's own ceiling (`artboardMeta.maxFrames`, ≤ 18 000) so one export may go that far.
  {
    ...row('video.allow-longer', 'Allow longer videos', 'Timeline › Advanced'),
    search: {
      where: 'Timeline › Advanced',
      keywords: ['longer', 'length', 'limit', '2 min', 'frames'],
    },
  },
  // S7.18 — bound: Timeline › Advanced › the keyframe's curve (a handle drag / arrow key writes it)
  row('video.easing.set', 'Keyframe curve', 'Timeline › Advanced'),
  row('video.take.swap', 'Swap a take', 'Timeline › Other takes'),
  row('video.fit', 'Fit the picture', 'Inspector › Clip'),
  row('video.place', 'Place the title', 'Inspector › Formats'),
  // S7.10 — the Title inspector's Motion grid and the join's picker (07 ve-text, ve-transition)
  row('video.title.motion', 'Title motion', 'Inspector › Title'),
  // S7.11b — the Title inspector's Font and Colour rows (07 ve-text)
  row('video.title.style', 'Title font and colour', 'Inspector › Title'),
  row('video.transition.set', 'Set the transition', 'Timeline › Join'),
];
