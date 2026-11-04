// editing/page-activity.ts — Maude 2.0.4 (task O): one "is anyone using this canvas right now" clock for the
// canvas runtime's per-frame and polling loops.
//
// Measured on 2.0.3 (headless WebKit, an idle canvas with nothing selected): the rotate handle's rAF loop ran 72×/s
// and the sticky-name / minimap polls measured every long page 15×/s, forever — the idle CPU of every open project
// tab. A loop built on this clock runs only while the page is ACTIVE and stops outright (no timer, no frame) when it
// goes idle or hidden; the next sign of use starts it again and runs it at once, so nothing lags the person.
//
// Active = visible AND something happened in the last IDLE_AFTER_MS: input (pointer, wheel, keys), a message from
// the shell (camera moves, selections and file pushes all arrive as `message`), a resize or scroll, a focus, or a
// change to the page's nodes (an AI write, a hot swap). Attribute changes are deliberately NOT activity: the loops
// themselves write styles every frame and would keep the page awake forever.
//
// Pure core (`createPageActivity`) over an injected environment, so the clock is tested without a DOM;
// `pageActivity()` is the one per-window instance the canvas uses.

/** How long after the last sign of use the page counts as idle. Long enough to cover a camera glide (≤ 1 s). */
export const IDLE_AFTER_MS = 3000;

/** Window events that count as use. */
export const WAKE_EVENTS = [
  'pointermove',
  'pointerdown',
  'pointerup',
  'wheel',
  'keydown',
  'keyup',
  'message',
  'resize',
  'scroll',
  'focus',
] as const;

export interface ActivityEnv {
  now(): number;
  hidden(): boolean;
  /** Subscribe to every wake source (events, visibility, node changes); returns the unsubscribe. */
  listen(onWake: () => void, onVisibility: () => void): () => void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
}

export interface PageActivity {
  active(): boolean;
  /** Called with the new state on every change. Returns the unsubscribe. */
  subscribe(fn: (active: boolean) => void): () => void;
  /** Count as use now (a caller that knows the page changed). */
  poke(): void;
  dispose(): void;
}

export function createPageActivity(env: ActivityEnv, idleAfter = IDLE_AFTER_MS): PageActivity {
  let last = env.now();
  let state = !env.hidden();
  let timer: unknown = null;
  const subs = new Set<(active: boolean) => void>();
  const set = (next: boolean) => {
    if (next === state) return;
    state = next;
    for (const fn of [...subs]) fn(next);
  };
  // One timer while active, re-armed only when it fires (not on every pointermove): it checks how long ago the last
  // use was and either sleeps the rest or turns the page idle. Idle = no timer at all.
  const arm = (ms: number) => {
    timer = env.setTimer(() => {
      timer = null;
      const since = env.now() - last;
      if (env.hidden()) set(false);
      else if (since >= idleAfter) set(false);
      else arm(idleAfter - since);
    }, ms);
  };
  const poke = () => {
    last = env.now();
    if (env.hidden()) return;
    set(true);
    if (timer === null) arm(idleAfter);
  };
  const onVisibility = () => {
    if (env.hidden()) {
      if (timer !== null) env.clearTimer(timer);
      timer = null;
      set(false);
    } else poke();
  };
  const off = env.listen(poke, onVisibility);
  if (state) arm(idleAfter);
  return {
    active: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    poke,
    dispose() {
      off();
      if (timer !== null) env.clearTimer(timer);
      timer = null;
      subs.clear();
    },
  };
}

/** The real environment: window events, `visibilitychange`, and node (not attribute) changes. */
export function domActivityEnv(win: Window): ActivityEnv {
  const doc = win.document;
  return {
    now: () => win.performance?.now?.() ?? Date.now(),
    hidden: () => doc.hidden === true,
    listen(onWake, onVisibility) {
      const opts = { passive: true, capture: true } as const;
      for (const t of WAKE_EVENTS) win.addEventListener(t, onWake, opts);
      doc.addEventListener('visibilitychange', onVisibility);
      const MO = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
      const mo = typeof MO === 'function' && doc.documentElement ? new MO(onWake) : null;
      mo?.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
      return () => {
        for (const t of WAKE_EVENTS) win.removeEventListener(t, onWake, opts);
        doc.removeEventListener('visibilitychange', onVisibility);
        mo?.disconnect();
      };
    },
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (t) => win.clearTimeout(t as number),
  };
}

const KEY = Symbol.for('maude.pageActivity');

/** The window's one activity clock (made on first use). */
export function pageActivity(win: Window = window): PageActivity {
  const w = win as unknown as Record<symbol, PageActivity | undefined>;
  let a = w[KEY];
  if (!a) {
    a = createPageActivity(domActivityEnv(win));
    w[KEY] = a;
  }
  return a;
}

/**
 * `setInterval(fn, ms)` that runs only while the page is active: `fn` runs at once, every `ms` while active, once
 * more as the page goes idle (so what it draws settles on the final state), and again at once when use resumes.
 */
export function activeInterval(
  fn: () => void,
  ms: number,
  activity: PageActivity = pageActivity()
): () => void {
  let t: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (t === null) t = setInterval(fn, ms);
  };
  const stop = () => {
    if (t !== null) clearInterval(t);
    t = null;
  };
  fn();
  if (activity.active()) start();
  const off = activity.subscribe((on) => {
    fn();
    if (on) start();
    else stop();
  });
  return () => {
    off();
    stop();
  };
}

/**
 * A `requestAnimationFrame` loop that runs only while the page is active. `tick` runs every frame while active and
 * once more as the page goes idle; the loop restarts on the next use. Returns the stop.
 */
export function activeFrameLoop(
  tick: () => void,
  activity: PageActivity = pageActivity()
): () => void {
  let raf = 0;
  let running = false;
  const frame = () => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    tick();
  };
  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  if (activity.active()) start();
  else tick();
  const off = activity.subscribe((on) => {
    if (on) start();
    else {
      stop();
      tick();
    }
  });
  return () => {
    off();
    stop();
  };
}
