// editing/video-play.ts — r4 #1: a `<video controls>` placed on an artboard (Image / Finder → `image.place`, edit-ops/
// image-fit.ts) must be playable where it sits. In Edit the canvas takes the click (the press selects), so the native
// controls are out of reach; Space is the way: a quick tap plays / pauses the SELECTED video element, the way it
// already plays a video artboard (S7.8, editing/space-tap.ts). Pure over a Document and the selection — no React.

/** What a selection entry needs to find its element again (a `Selection` of use-selection-set.tsx). */
export interface VideoSelectionRef {
  selector?: string;
  index?: number;
  id?: string;
}

const isVideo = (el: Element | null | undefined): el is HTMLVideoElement =>
  !!el && el.tagName === 'VIDEO';

/** The selected entries that ARE a `<video>` element (a selected artboard or frame is not one). */
export function selectedVideoElements(
  doc: Document,
  selected: readonly VideoSelectionRef[] | null | undefined
): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = [];
  for (const s of selected ?? []) {
    let el: Element | null = null;
    try {
      if (s.selector) el = doc.querySelectorAll(s.selector)[s.index ?? 0] ?? null;
      if (!isVideo(el) && s.id) el = doc.querySelector(`video[data-cd-id="${CSS.escape(s.id)}"]`);
    } catch {
      el = null; // a stale selector: nothing to play
    }
    if (isVideo(el) && !out.includes(el)) out.push(el);
  }
  return out;
}

/** Play every video that is paused; when all are playing, pause them. Never throws (autoplay policy). */
export function togglePlayback(videos: readonly HTMLVideoElement[]): boolean {
  if (videos.length === 0) return false;
  const anyPaused = videos.some((v) => v.paused || v.ended);
  for (const v of videos) {
    if (!anyPaused) {
      v.pause();
      continue;
    }
    if (!(v.paused || v.ended)) continue;
    try {
      const p = v.play() as Promise<void> | undefined;
      // the browser refused sound without a gesture: the key IS a gesture, but if it still refuses, play muted
      p?.catch?.(() => {
        v.muted = true;
        v.play()?.catch?.(() => {});
      });
    } catch {
      /* a video that cannot play (no source yet): nothing to do */
    }
  }
  return true;
}

/** The Space tap: play / pause the selected video elements. True when it took the tap (so the shell is not asked). */
export function playSelectedVideos(
  doc: Document,
  selected: readonly VideoSelectionRef[] | null | undefined
): boolean {
  return togglePlayback(selectedVideoElements(doc, selected));
}
