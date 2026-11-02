// edit-ops/clip/track.ts — `clip.track` (P8 C8, 07 · the per-track view / volume button in the Full timeline's gutter).
//
// One write for a whole track, so ONE undo step takes the whole toggle back (the per-clip routes would be N writes):
//   · `hidden` — Text / Graphics: every named clip's body is gated behind `{false && (…)}` (or the wrapper stripped),
//     exactly what the clip menu's Hide writes (canvas-edit.ts `applyToggleClipHidden`), but to a set state, never a
//     toggle: a clip already in the wanted state is left alone, so the button is idempotent;
//   · `muted` — Video / Music: the bare `muted` attribute on each clip's media element (a clip's direct <Video> or
//     <Audio>, or a loose `loose:…` bed) — what `clip.audio` writes for one clip.
// A clip that has nothing to hide or mute (a self-closing clip, an image beat) is skipped, never an error: a track is
// a mixed bag. Pure: no IO. No new comp vocabulary — every byte written is one the per-clip verbs already write.

import MagicString from 'magic-string';

import { applyToggleClipHidden, CanvasEditError } from '../../canvas-edit.ts';
import { applyClipAudio } from '../../clip-ops.ts';
import {
  attrNode,
  bad,
  finish,
  firstIn,
  jsxElements,
  type Node,
  parseProgram,
  resolveSpan,
} from './jsx.ts';

const MAX_IDS = 200;
const AUDIO = new Set(['Audio', 'MaudeAudio']);

export interface TrackPatch {
  ids: string[];
  hidden?: boolean;
  muted?: boolean;
}

export function trackPatch(file: string, p: Record<string, unknown>): TrackPatch {
  const ids = Array.isArray(p.ids)
    ? p.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 256)
    : [];
  if (!ids.length) bad(file, 'The track has nothing on it to change.');
  const hidden = typeof p.hidden === 'boolean' ? p.hidden : undefined;
  const muted = typeof p.muted === 'boolean' ? p.muted : undefined;
  if ((hidden === undefined) === (muted === undefined))
    bad(file, 'A track is hidden or muted, one at a time.');
  return { ids: ids.slice(0, MAX_IDS), hidden, muted };
}

/** A loose bed's `<Audio>`: the bare `muted` attribute on or off. */
function setBedMuted(
  file: string,
  source: string,
  artboard: string | undefined,
  id: string,
  want: boolean
): string {
  const span = resolveSpan(file, source, artboard, id, undefined);
  const hit = firstIn(jsxElements(parseProgram(file, source)), span.start, span.end, AUDIO);
  if (!hit) return source;
  const el = (hit as { el: Node }).el;
  const a = attrNode(el, 'muted');
  const s = new MagicString(source);
  if (want && !a) {
    s.appendRight(el.openingElement.name.end, ' muted'); // where clip.audio puts it: right after the tag name
  } else if (!want && a) {
    s.remove(a.start - 1, a.end);
  } else return source;
  return finish(file, s, id);
}

export function applyTrack(
  file: string,
  source: string,
  artboard: string | undefined,
  patch: TrackPatch
): { source: string; changed: number; skipped: number } {
  let out = source;
  let changed = 0;
  let skipped = 0;
  for (const id of patch.ids) {
    try {
      let next = out;
      if (patch.hidden !== undefined) {
        const r = applyToggleClipHidden(file, out, artboard, id, undefined);
        // the toggle flipped it the other way: it was already in the wanted state — keep the bytes as they were
        next = r.hidden === patch.hidden ? r.source : out;
      } else if (id.startsWith('loose:')) {
        next = setBedMuted(file, out, artboard, id, patch.muted as boolean);
      } else {
        next = applyClipAudio(file, out, artboard, id, undefined, { muted: patch.muted }).source;
      }
      if (next === out) skipped += 1;
      else {
        out = next;
        changed += 1;
      }
    } catch (e) {
      if (!(e instanceof CanvasEditError)) throw e;
      skipped += 1;
    }
  }
  return { source: out, changed, skipped };
}
