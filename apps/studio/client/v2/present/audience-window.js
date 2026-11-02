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

// The audience-lock version this seam and the shell (present.rs `AUDIENCE_LOCK`) accept. Not
// exported on purpose: the caller must hand in the number the FOLLOWER ROOT declares (S3.7a,
// `./follow-location.js` `AUDIENCE_LOCK` — `audience=1` renders no editor and takes no keys), so
// until that root ships, nothing opens a full-screen window onto the editor.
const AUDIENCE_LOCK_ACCEPTED = 1;

/** Open (or move) this project's audience window, full screen, on `displayId`. `lock` is the
 *  follower root's declared audience lock; any other value rejects `not-ready` before the shell
 *  is asked. Otherwise rejects with the shell's own message (a display that went away, the
 *  presenter's own display, a tab not in front). */
export function openAudience({ displayId, canvas, sid, lock }) {
  if (!isNativeApp())
    return Promise.reject(new Error('Presenting on another display needs the Maude app.'));
  if (lock !== AUDIENCE_LOCK_ACCEPTED)
    return Promise.reject(
      new Error("not-ready: this version of Maude can't show an audience screen yet.")
    );
  return invoke('present_audience_open', { displayId, canvas, sid, lock });
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
