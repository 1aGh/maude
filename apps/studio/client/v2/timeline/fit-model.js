// client/v2/timeline/fit-model.js — S7.10 (07 · ve-fit-fill): "Vertical footage asks once how to sit."
//
// A phone clip on a 16:9 video: Fill crops it to the player, Fit adds bars, Blur behind fills the sides with a blurred
// copy. The question is asked ONCE per clip, and "Same for every vertical clip" answers it for the next ones. The
// answer is the `fit` of the clip's `<Reframe>` (video.fit) — a file fact every peer sees; what is remembered here is
// only that THIS person was asked (Fill is the default and writes nothing, so the file can't say it) and their
// standing choice. Both are per-viewer conveniences: wrapped in try/catch, the question simply asks again without them.
//
// Pure except for the two storage helpers (localStorage, guarded).

/** [key, label, small line] — the canvas's three options, in its order. */
export const FIT_CHOICES = Object.freeze([
  Object.freeze(['fill', 'Fill', 'Crops to the player, follows the player']),
  Object.freeze(['fit', 'Fit', 'Whole picture, dark bars']),
  Object.freeze(['blur', 'Blur behind', 'A blurred copy fills the sides']),
]);

/** Taller than wide, by a margin (a 1:1 square is not "vertical"). */
export const isVertical = (size) => !!size && size.w > 0 && size.h > size.w * 1.05;

/** The video it sits in is wider than tall — a vertical clip in a vertical video needs no answer. */
export const isWideComp = (comp) => !!comp && comp.width > comp.height;

/**
 * Should this clip ask now? A clip with a picture, not asked before, with no `fit` written, vertical, in a wide video.
 * @param {{ seq: any, comp: any, size: {w:number,h:number}|null, asked: boolean }} q
 */
export function shouldAsk({ seq, comp, size, asked }) {
  if (!seq?.stableId || !seq.mediaSrc) return false;
  if (!['Video', 'OffthreadVideo', 'MaudeVideo', 'Img'].includes(seq.mediaTag ?? '')) return false;
  if (asked || seq.fit) return false;
  return isVertical(size) && isWideComp(comp);
}

// ── what this viewer was asked / chose ──────────────────────────────────────────────────────────────────────
const ASKED = 'maude.fitAsked';
const STANDING = 'maude.fitStanding';
const MAX_ASKED = 300;

const read = (key) => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* private window, blocked storage: the question just asks again */
  }
};

export const askKey = (canvas, artboardId, stableId) => `${canvas}|${artboardId ?? ''}|${stableId}`;

/** Session memory too, so a blocked storage still asks once per clip per session. */
const session = new Set();

export function wasAsked(key) {
  if (session.has(key)) return true;
  try {
    return (JSON.parse(read(ASKED) ?? '[]') ?? []).includes(key);
  } catch {
    return false;
  }
}

export function markAsked(key) {
  session.add(key);
  try {
    const list = JSON.parse(read(ASKED) ?? '[]');
    const next = [...(Array.isArray(list) ? list : []).filter((k) => k !== key), key].slice(
      -MAX_ASKED
    );
    write(ASKED, JSON.stringify(next));
  } catch {
    write(ASKED, JSON.stringify([key]));
  }
}

/** The answer given for "every vertical clip", or null. */
export function standingFit() {
  const v = read(STANDING);
  return v === 'fill' || v === 'fit' || v === 'blur' ? v : null;
}
export const setStandingFit = (fit) => write(STANDING, fit ?? '');

/** Tests only: forget what this session asked. */
export function resetFitMemory() {
  session.clear();
}

// ── how big is the picture ──────────────────────────────────────────────────────────────────────────────────
const sizes = new Map();

/** The picture's own size, read once from its metadata. null = could not tell (never guessed). */
export function probeSize(url, { make = defaultMake } = {}) {
  if (!url) return Promise.resolve(null);
  if (sizes.has(url)) return sizes.get(url);
  const p = new Promise((resolve) => {
    let el;
    try {
      el = make(url);
    } catch {
      resolve(null);
      return;
    }
    const done = (size) => {
      el.onloadedmetadata = el.onload = el.onerror = null;
      resolve(size);
    };
    el.onloadedmetadata = () =>
      done(el.videoWidth ? { w: el.videoWidth, h: el.videoHeight } : null);
    el.onload = () => done(el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
  sizes.set(url, p);
  return p;
}

function defaultMake(url) {
  const isImage = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i.test(url);
  const el = document.createElement(isImage ? 'img' : 'video');
  if (!isImage) {
    el.preload = 'metadata';
    el.muted = true;
  }
  el.src = url;
  return el;
}

/** Tests only. */
export function resetProbeCache() {
  sizes.clear();
}
