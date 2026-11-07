// _video-limits.mjs — the pure decisions of the video capture shim (_video-playwright.mjs):
// how long it may run, what it says when it is killed, and the default output scale.
// Kept out of the shim so bun:test can pin them without a browser. Issue #128 §2.

/** The old flat ceiling, now the floor: setup + a short render never needed more. */
export const HARD_KILL_BASE_MS = 150_000;
/** Budget per frame. The frame-step fallback measures ~2.5 s/frame (exporters/video.ts), so 3 s
 *  leaves headroom for a slower Mac without letting a wedged run hang for hours. */
export const HARD_KILL_PER_FRAME_MS = 3_000;
/** Once frames are completing, the render is only killed after this long WITHOUT a new frame. */
export const HARD_KILL_STALL_MS = 150_000;

/** The wall-clock budget for a render of `frames` frames (0 / unknown → the old flat ceiling). */
export function hardKillBudgetMs({ timeoutMs, frames }) {
  const floor = Math.max(Number(timeoutMs) || 0, HARD_KILL_BASE_MS);
  const n = Number.isFinite(frames) && frames > 0 ? frames : 0;
  return floor + n * HARD_KILL_PER_FRAME_MS;
}

/**
 * The self-kill watchdog. The deadline is `start + hardKillBudgetMs(frames)`, pushed out to
 * `lastProgress + HARD_KILL_STALL_MS` while frames keep completing, so a long export that is making
 * progress is never killed and a wedged one still is. The timer re-checks the (moving) deadline
 * when it fires instead of being re-armed on every frame.
 *
 * `setFrames(n)` — the frame count became known (comp meta / --frames), possibly after the fast
 * path failed. `progress()` — a frame completed. `stop()` — the render finished.
 */
export function createHardKill({
  timeoutMs,
  onKill,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const startedAt = now();
  let frames = 0;
  let lastProgress = null;
  let handle = null;
  let stopped = false;

  const deadline = () => {
    const byBudget = startedAt + hardKillBudgetMs({ timeoutMs, frames });
    return lastProgress === null ? byBudget : Math.max(byBudget, lastProgress + HARD_KILL_STALL_MS);
  };
  const arm = () => {
    if (stopped) return;
    const wait = Math.max(0, deadline() - now());
    handle = setTimer(() => {
      if (stopped) return;
      if (now() < deadline()) return arm();
      onKill(deadline() - startedAt);
    }, wait);
    handle?.unref?.();
  };
  arm();
  return {
    setFrames(n) {
      if (Number.isFinite(n) && n > 0) frames = n;
    },
    progress() {
      lastProgress = now();
    },
    stop() {
      stopped = true;
      if (handle) clearTimer(handle);
    },
  };
}

/** The text printed when the watchdog fires — honest about the machine it is on (issue #128 §2b). */
export function hardTimeoutMessage({ ms, platform, gpu, frame, total }) {
  const got =
    Number.isFinite(frame) && frame > 0 && Number.isFinite(total) && total > 0
      ? ` It made it to frame ${frame} of ${total}.`
      : '';
  let hint;
  if (platform === 'darwin') {
    hint =
      'on macOS this is usually a long or heavy capture (the cost grows with frames and with the ' +
      'export scale) or a stalled video encoder — try a lower scale or a shorter range';
  } else if (platform === 'linux') {
    hint = 'on headless Linux this is usually the video encoder or GPU init';
  } else {
    hint = 'this is usually a long or heavy capture or a stalled video encoder';
  }
  return (
    `_video-playwright: HARD TIMEOUT after ${ms}ms — exiting. The render did not complete` +
    ` (see the last stage logged above; ${hint}).${got} gpu=${gpu ? 'on' : 'off'}.`
  );
}

/**
 * Default output scale when the user passed none (decision maude/burndown-d6-default-export-scale):
 * 1× when the artboard's short side is already >= 1080 px (a social-format Reel at 1080×1900 gains
 * nothing from 2160×3804 and pays double per frame), else 2× so a small comp is not a tiny capture.
 * An artboard that could not be measured keeps the historical 2×.
 */
export function defaultVideoScale(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 2;
  return Math.min(w, h) >= 1080 ? 1 : 2;
}
