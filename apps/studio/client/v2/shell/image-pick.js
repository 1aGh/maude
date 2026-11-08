// client/v2/shell/image-pick.js — r2-p1 TD10 (Michal, UX audit F10): what Image (I) does in the shell.
//
// I (or the toolbar's Image button) asks the shell `tool-panel-open {panel: 'image'}`; the shell opens a file picker AT
// ONCE — no Assets tab, the left panel stays what it was. The picked picture goes into Assets (`uploadAsset`, the same
// import "Add files…" uses) and is handed to the canvas that asked as `place-image {asset, natural, label}`; the canvas
// places it at the next click, or ↵ in the middle of the view (editing/place-image.tsx). A video (MP4 · MOV · M4V · WebM)
// takes the same road and lands as a `<video>` (the `image.place` op decides by the stored file's extension).
//
// The picker is ONE HTML `<input type="file">` that lives in the shell's DOM (`data-testid="image-tool-input"`), so a
// DOM e2e or an agent driving the page hands it a file without any dialog (a change event is the whole contract). A
// person gets the platform's dialog: the native one in the app (`pickMediaFiles`, as Add files… does — it needs no
// page activation), the input's own in a browser.
//
// #168 F1 — the canvas decides when it asks, so it never opens the dialog itself: an ask (`ask(canvas)`) shows the
// shell's own chip, "Choose a picture for <canvas>" + Choose…, and only a click on that chip opens the dialog. Two
// cancelled dialogs in a row and the shell stops offering the chip for PICK_BACKOFF_MS; a placed picture resets it.
//
// The pure half (`placeFiles`) takes everything it touches as a function so a test drives it.

import { uploadAsset } from '../../../asset-upload.ts';
import { isVideoFile, isVideoName, videoNaturalOf } from '../../../video-natural.ts';
import { isNativeApp, pickedMediaSource, pickMediaFiles } from '../../github.js';
import { notifyCanvasTriggered } from '../../../notifications.tsx';
import { basename, displayName, shellToast } from '../../shell/util.js';

export const IMAGE_INPUT_TESTID = 'image-tool-input';
export const NOT_A_PICTURE_LINE =
  'That is not a picture or a video. Pick a PNG, JPEG, GIF, WebP, SVG or HEIC picture, or an MP4, MOV, M4V or WebM video.';
export const NOT_ADDED_LINE = 'That picture or video couldn’t be added, so nothing was placed.';
/** #168 F1: the one id the chip is shown under (a repeat ask replaces it) and the back-off after two cancels. */
export const PICK_CHIP_ID = 'canvas-image-pick';
export const PICK_BACKOFF_MS = 60_000;
const CANCELS_BEFORE_BACKOFF = 2;

const IMAGE_NAME = /\.(avif|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;
// r3 (Michal: "nemůžu vkládat videa"): a video (mp4 · mov · m4v · webm) is placed like a picture. Sound stays out — there is
// no place-on-canvas path for it. The video rules live in video-natural.ts, shared with the Finder drop.
const isVideo = isVideoFile;
const isPicture = (f) =>
  !!f && (String(f.type || '').startsWith('image/') || IMAGE_NAME.test(String(f.name || '')));
const isPlaceable = (f) => isPicture(f) || isVideo(f);

async function naturalSizeOf(file) {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return out.w > 0 && out.h > 0 ? out : null;
  } catch {
    return null;
  }
}

const mimeOf = (name) => {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  return ext ? `image/${ext}` : '';
};

/**
 * @param deps.post (canvas, msg) => boolean — post to that canvas's window on the canvas origin
 * @param deps.upload (file) => Promise<{path} | {error}> — default `uploadAsset`
 * @param deps.natural (file) => Promise<{w,h} | null>
 * @param deps.videoNatural (file) => Promise<{w,h} | null> — a video's size, fitted (default: read from its metadata)
 * @param deps.toast (line) => void
 * @param deps.activePath () => string | null — the canvas a file handed to the input (no dialog) is placed on
 * @param deps.notify (notice) => string | null — the chip (default `notifyCanvasTriggered`: one id, rate-limited)
 * @param deps.nameOf (path) => string — the canvas name the chip says
 * @param deps.now () => number — ms clock (the back-off)
 * @param deps.isNative / deps.pickNative / deps.nativeSource — the app's own dialog (default: github.js)
 */
export function createImagePick(deps) {
  const upload = deps.upload ?? ((f) => uploadAsset(f, { name: f.name }));
  const natural = deps.natural ?? naturalSizeOf;
  const videoNatural = deps.videoNatural ?? videoNaturalOf;
  const toast = deps.toast ?? ((line) => shellToast(line, false));
  const notify = deps.notify ?? notifyCanvasTriggered;
  const nameOf = deps.nameOf ?? ((p) => displayName(basename(p)));
  const now = deps.now ?? (() => Date.now());
  const isNative = deps.isNative ?? isNativeApp;
  const pickNative = deps.pickNative ?? pickMediaFiles;
  const nativeSource = deps.nativeSource ?? pickedMediaSource;
  let input = null;
  let forCanvas = null;
  let cancels = 0;
  let lastCancel = -Infinity;
  const cancelled = () => {
    cancels++;
    lastCancel = now();
  };

  /** The pick for `canvas`: the first picture or video of `files` into Assets, then `place-image` to that canvas. */
  async function placeFiles(canvas, files) {
    const f = Array.from(files || []).find(isPlaceable);
    if (!f) {
      if (files?.length) toast(NOT_A_PICTURE_LINE);
      return;
    }
    let r;
    try {
      r = await upload(f);
    } catch {
      r = null;
    }
    if (!r || typeof r.path !== 'string') {
      toast(NOT_ADDED_LINE);
      return;
    }
    const size = await (isVideo(f) ? videoNatural(f) : natural(f));
    cancels = 0;
    deps.post(canvas, { dgn: 'place-image', asset: r.path, natural: size, label: f.name });
  }

  /** The one input, in `doc` from the first render; its change is the pick. */
  function mount(doc) {
    if (input?.isConnected) return input;
    input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm';
    input.setAttribute('data-testid', IMAGE_INPUT_TESTID);
    // a picker, not a control: off-screen, out of the tree and the tab order (V2-8.7 axe `label`)
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      const canvas = forCanvas ?? deps.activePath?.() ?? null;
      forCanvas = null;
      input.value = '';
      if (canvas) void placeFiles(canvas, files);
    });
    // the browser's own dialog closed with nothing picked
    input.addEventListener('cancel', () => {
      forCanvas = null;
      cancelled();
    });
    doc.body.appendChild(input);
    return input;
  }

  /** The platform's dialog for `canvas` — only ever from the chip's click (a person in the shell), never a canvas. */
  async function open(canvas) {
    forCanvas = canvas;
    if (isNative()) {
      const picked = await pickNative();
      if (!picked?.length) {
        forCanvas = null;
        cancelled();
        return;
      }
      const first = picked.find((p) => IMAGE_NAME.test(p.name) || isVideoName(p.name));
      if (!first) {
        toast(NOT_A_PICTURE_LINE);
        return;
      }
      // a picked source is not a Blob (it reads through the app), so its size comes from the place op, not here
      const src = nativeSource(first, mimeOf(first.name));
      try {
        await placeFiles(canvas, [src]);
      } finally {
        src.release?.();
        forCanvas = null;
      }
      return;
    }
    mount(document).click();
  }

  /**
   * Image (I) asked by `canvas`: the shell's chip, never the dialog. False when backing off (two cancels in a row,
   * less than PICK_BACKOFF_MS ago) — the ask is ignored and nothing is shown.
   */
  function ask(canvas) {
    if (cancels >= CANCELS_BEFORE_BACKOFF && now() - lastCancel < PICK_BACKOFF_MS) return false;
    if (cancels >= CANCELS_BEFORE_BACKOFF) cancels = 0;
    notify({
      id: PICK_CHIP_ID,
      title: `Choose a picture for ${nameOf(canvas)}`,
      kind: 'info',
      icon: 'image',
      action: { label: 'Choose…', onClick: () => void open(canvas) },
    });
    return true;
  }

  return { placeFiles, mount, open, ask };
}
