// actions/defs/video.ts — the video tools (S7.6c; V2-1.10 §5.7 registry table + S7-slices S7.6).
//
// Twelve ids from V2-1.10 §5.7 plus the four S7.6 adds (`video.format.add/unlink`, `video.take.swap`,
// `video.fit`). Each write is one edit op (`POST /_api/edit-op`, edit-ops/clip/*) or a verb that
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
  row('video.captions.add', 'Captions from speech', 'Timeline › Captions'),
  row('video.captions.style', 'Caption style', 'Inspector › Captions'),
  row('video.captions.fix-word', 'Fix a caption word', 'Transcript panel'),
  row('video.captions.export', 'Export captions', 'Export sheet', 'comment'),
  row('video.transcript.cut', 'Cut these words', 'Transcript panel'),
  row('video.transcript.find-speech', 'Find speech', 'Transcript panel'),
  row('video.music.beats', 'Find the beat', 'Inspector › Music'),
  row('video.music.duck', 'Lower under speech', 'Inspector › Music'),
  row('video.cut-to-beat', 'Cut to the beat', 'Inspector › Music'),
  row('video.snap', 'Snap to the beat', 'Timeline'),
  row('video.reframe', 'Re-frame', 'Timeline › Re-frame'),
  row('video.poster.set', 'Set as poster frame', 'Inspector › Poster'),
  row('video.format.add', 'Add a format', 'Inspector › Formats'),
  row('video.format.unlink', 'Make an unlinked copy', 'Inspector › Formats'),
  row('video.take.swap', 'Swap a take', 'Timeline › Other takes'),
  row('video.fit', 'Fit the picture', 'Inspector › Clip'),
];
