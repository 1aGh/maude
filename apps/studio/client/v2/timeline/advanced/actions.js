// client/v2/timeline/advanced/actions.js — S7.18: the registry rows that live in the Timeline's Advanced, as the
// ⌘K / shell runner calls them. `timeline.add-track` (C35) draws an empty Video 2 or Music 2 on the followed video
// (a view — a comp's tracks are derived, so no byte changes); `video.allow-longer` (C22) is video-cap.js.

import { ADDABLE_TRACKS, advancedStore, trackKey } from './advanced-store.js';
import { ADV_WORDS } from './model.js';
import { followedVideo } from './video-cap.js';

/**
 * `timeline.add-track`: the named track (`video2` · `music2`) on the followed video; with no name, the next one
 * that is not there yet (the tracks the video already draws count — the Timeline says which).
 * @returns {string} the words for the toast
 */
export function addTrackAtFollowed(track) {
  const at = followedVideo();
  const has = at?.have ?? [];
  if (!at?.file || !at.artboardId) return 'Select a video first.';
  const key = trackKey(at.file, at.artboardId);
  const mine = advancedStore.tracksFor(key);
  const next = track ?? ADDABLE_TRACKS.find((t) => !mine.includes(t) && !has.includes(t)) ?? null;
  if (!next) return 'Video 2 and Music 2 are already there.';
  if (!ADDABLE_TRACKS.includes(next)) return 'That track is not one to add.';
  const name = ADV_WORDS.trackNames[next];
  if (mine.includes(next) || has.includes(next)) return `${name} is already there.`;
  advancedStore.addTrack(key, next);
  return ADV_WORDS.trackAdded(name);
}
