// client/v2/shell/canvas-crash-guard.js — 2.0.5: a canvas that crashes the page is not reopened in a loop.
//
// When a heavy canvas makes WebKit kill the page's WebContent process, the desktop shell reloads the tab
// (apps/desktop/src-tauri/src/web_process.rs) and the shell reopened the same canvas — which crashed it
// again, over and over. No JavaScript runs at the crash, so the guard works backwards: while a canvas is
// open the shell keeps a "live" mark in localStorage and clears it on a clean `pagehide`. A page that boots
// and finds the mark still there died with that canvas open. `CRASH_LIMIT` such deaths of the same canvas
// within `CRASH_WINDOW_MS` and the viewport stops opening it: the tab shows "This canvas is too heavy to
// show all at once" with the lighter way in (only the artboards near the viewport mounted,
// `?artboard-live=light`). Pure over a Storage-like object so it is testable without a browser.

export const CRASH_LIMIT = 2;
export const CRASH_WINDOW_MS = 10 * 60 * 1000;
/** A chosen lighter mode is kept this long for that canvas (it survives the next crash reload). */
export const LIGHT_KEEP_MS = 24 * 60 * 60 * 1000;
export const CRASH_KEY = 'maude.canvas-crash.v1';

function empty() {
  return { live: null, crashes: {}, light: {} };
}

function read(storage) {
  try {
    const raw = storage?.getItem(CRASH_KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return empty();
    return {
      live: typeof s.live === 'string' ? s.live : null,
      crashes: s.crashes && typeof s.crashes === 'object' ? s.crashes : {},
      light: s.light && typeof s.light === 'object' ? s.light : {},
    };
  } catch {
    return empty();
  }
}

/**
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void } | null} storage
 * @param {() => number} [now]
 */
export function createCrashGuard(storage, now = Date.now) {
  const s = read(storage);
  const save = () => {
    try {
      storage?.setItem(CRASH_KEY, JSON.stringify(s));
    } catch {
      /* private mode / quota — the guard just forgets */
    }
  };
  const prune = () => {
    const t = now();
    for (const [p, list] of Object.entries(s.crashes)) {
      const kept = Array.isArray(list)
        ? list.filter((x) => typeof x === 'number' && t - x < CRASH_WINDOW_MS)
        : [];
      if (kept.length) s.crashes[p] = kept;
      else delete s.crashes[p];
    }
    for (const [p, at] of Object.entries(s.light)) {
      if (typeof at !== 'number' || t - at >= LIGHT_KEEP_MS) delete s.light[p];
    }
  };
  // Boot: a mark left behind is a page that died with that canvas open.
  if (s.live) {
    const list = s.crashes[s.live] || [];
    list.push(now());
    s.crashes[s.live] = list;
    s.live = null;
  }
  prune();
  save();

  return {
    /** The open canvas (null when none is framed). Called whenever the active frame changes. */
    noteOpen(path) {
      const next = typeof path === 'string' && path ? path : null;
      if (s.live === next) return;
      s.live = next;
      save();
    },
    /** A clean unload (`pagehide`): whatever was open did not crash the page. */
    noteClean() {
      if (s.live === null) return;
      s.live = null;
      save();
    },
    crashCount(path) {
      prune();
      return (s.crashes[path] || []).length;
    },
    /** Too heavy: it crashed the page `CRASH_LIMIT` times recently and no lighter mode was chosen. */
    tooHeavy(path) {
      if (!path) return false;
      prune();
      return (s.crashes[path] || []).length >= CRASH_LIMIT && !(path in s.light);
    },
    isLight(path) {
      prune();
      return !!path && path in s.light;
    },
    /** "Show visible artboards only". */
    chooseLight(path) {
      s.light[path] = now();
      save();
    },
    /** "Show everything": forget the crashes and the lighter mode for this canvas. */
    forgive(path) {
      delete s.crashes[path];
      delete s.light[path];
      save();
    },
  };
}

let shared = null;
const subs = new Set();

/** The page's one guard, on localStorage, cleared on a clean pagehide. */
export function crashGuard() {
  if (shared) return shared;
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  const g = createCrashGuard(storage);
  const wrap = (fn) => (path) => {
    fn(path);
    for (const cb of subs) cb();
  };
  shared = { ...g, chooseLight: wrap(g.chooseLight), forgive: wrap(g.forgive) };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => g.noteClean());
  return shared;
}

/** Re-render on a choice made on the card. */
export function subscribeCrashGuard(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
