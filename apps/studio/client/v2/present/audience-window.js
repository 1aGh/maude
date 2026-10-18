// S3.6a — the page side of the audience window (contract `v2/contracts/S3-present-session.md` §6).
// The shell (apps/desktop/src-tauri/src/present.rs) owns the window: it answers only the project
// tab in front, builds the follower-root URL itself from the tab's recorded origin, and closes the
// window when its display goes away. The page passes a display id, the canvas and its presenter
// session id — never a URL. Presenter view (S3.6b) is the caller.

import { invoke, isNativeApp } from '../../github.js';

/** Every connected display: `{ id, name, primary, current }[]`. `[]` outside the desktop app or
 *  when the shell refuses (a tab that isn't in front). */
export async function presentDisplays() {
  if (!isNativeApp()) return [];
  try {
    const list = await invoke('present_displays');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** D10 (hidden, not greyed): "Presenter view on another display" exists only in the desktop app
 *  with more than one display. */
export function canPresentToAnotherDisplay(displays) {
  return isNativeApp() && Array.isArray(displays) && displays.length > 1;
}

/** The display the audience goes to unless the person picks one: one this window is not on,
 *  a non-primary one first. `null` when there is no other display. */
export function audienceDisplay(displays) {
  if (!Array.isArray(displays)) return null;
  const others = displays.filter((d) => d && !d.current);
  return others.find((d) => !d.primary) || others[0] || null;
}

/** Open (or move) this project's audience window, full screen, on `displayId`. Rejects with the
 *  shell's own message (a display that went away, a tab not in front). */
export function openAudience({ displayId, canvas, sid }) {
  if (!isNativeApp())
    return Promise.reject(new Error('Presenting on another display needs the Maude app.'));
  return invoke('present_audience_open', { displayId, canvas, sid });
}

/** Close this project's audience window (End, esc). Idempotent; a no-op outside the app. */
export async function closeAudience() {
  if (!isNativeApp()) return;
  try {
    await invoke('present_audience_close');
  } catch {
    // Nothing open, or the tab no longer shows its project: the shell closes it on its own.
  }
}
