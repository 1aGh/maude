/**
 * @file       artboard-webgl.ts — 2.0.5: the per-canvas WebGL context budget
 * @scope      apps/studio/artboard-webgl.ts (DOM half of artboard-live.ts `planWebgl`)
 * @purpose    A canvas of 88 three.js artboards created 88 WebGL contexts; the browsers drop the oldest past
 *             ~16 and WebKit kills the page long before memory runs out. Every WebGL context a canvas creates
 *             is tracked here (a `getContext` wrapper, installed only when artboards may sleep — never in a
 *             capture). At most `WEBGL_LIVE_CAP` stay live: those of live artboards nearest the viewport
 *             centre. The rest are released through `WEBGL_lose_context` — after a snapshot of the last frame
 *             is laid under the canvas, so a sleeping scene still shows its picture — and restored when their
 *             artboard is live again.
 *
 *             We cancel the `webglcontextlost` of a loss WE caused (that is what lets `restoreContext()` work)
 *             and leave a loss the browser caused to the page. three.js re-initialises on
 *             `webglcontextrestored` by itself; raw WebGL code must listen for it (or gate its loop on
 *             `useArtboardActive()`) — the canvas plugin docs say so.
 */

import { type GlCandidate, planWebgl, WEBGL_LIVE_CAP } from './artboard-live.ts';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type LoseExt = { loseContext(): void; restoreContext(): void };

interface Entry {
  key: number;
  canvas: HTMLCanvasElement;
  ext: LoseExt | null;
  /** 'live' | lost by us | being lost (snapshot pending) | lost by the browser. */
  state: 'live' | 'ours' | 'losing' | 'browser';
  lastLive: number;
  /** The canvas's own inline background, put back on restore. */
  savedBg: { image: string; size: string; repeat: string } | null;
}

const SNAPSHOT_MAX = 640;

export class WebglBudget {
  private entries = new Map<number, Entry>();
  private byCanvas = new WeakMap<HTMLCanvasElement, Entry>();
  private seq = 0;
  private queued = false;

  constructor(
    private readonly isLive: (artboardId: string | null) => boolean,
    private readonly cap: number = WEBGL_LIVE_CAP
  ) {}

  /** Wraps `HTMLCanvasElement.prototype.getContext` once per window. Returns the uninstall. */
  install(win: Window & typeof globalThis): () => void {
    const proto = win.HTMLCanvasElement?.prototype;
    if (!proto) return () => {};
    const orig = proto.getContext;
    const budget = this;
    const wrapped = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (ctx && typeof type === 'string' && /webgl/i.test(type)) budget.track(this, ctx as GL);
      return ctx;
    } as typeof proto.getContext;
    proto.getContext = wrapped;
    return () => {
      if (proto.getContext === wrapped) proto.getContext = orig;
    };
  }

  track(canvas: HTMLCanvasElement, gl: GL): void {
    if (this.byCanvas.has(canvas)) return;
    let ext: LoseExt | null = null;
    try {
      ext = (gl.getExtension('WEBGL_lose_context') as LoseExt | null) ?? null;
    } catch {
      ext = null;
    }
    const e: Entry = {
      key: ++this.seq,
      canvas,
      ext,
      state: 'live',
      lastLive: Date.now(),
      savedBg: null,
    };
    this.entries.set(e.key, e);
    this.byCanvas.set(canvas, e);
    canvas.addEventListener('webglcontextlost', (ev) => {
      if (e.state === 'ours' || e.state === 'losing') ev.preventDefault();
      else e.state = 'browser';
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (e.state === 'browser') e.state = 'live';
    });
    // Created while the page builds: plan once the current task (the whole React commit) is done.
    this.update();
  }

  /** Re-plan soon (coalesced to one microtask). */
  update(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.apply();
    });
  }

  stats(): { tracked: number; live: number; lost: number } {
    let live = 0;
    for (const e of this.entries.values()) if (e.state === 'live') live += 1;
    return { tracked: this.entries.size, live, lost: this.entries.size - live };
  }

  /** Plan and act now. */
  apply(): void {
    const win = typeof window === 'undefined' ? null : window;
    const cx = (win?.innerWidth ?? 0) / 2;
    const cy = (win?.innerHeight ?? 0) / 2;
    const now = Date.now();
    const cands: GlCandidate[] = [];
    for (const e of [...this.entries.values()]) {
      if (!e.canvas.isConnected) {
        // Unmounted (a light-mode artboard, a re-render): free its context instead of waiting for GC.
        this.entries.delete(e.key);
        if (e.state === 'live') this.loseNow(e);
        continue;
      }
      if (e.state === 'browser' || !e.ext) continue;
      const board = e.canvas.closest('[data-dc-screen]');
      const live = this.isLive(board ? board.getAttribute('data-dc-screen') : null);
      const r = e.canvas.getBoundingClientRect();
      const distance = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      cands.push({ key: e.key, live, distance, lastLive: e.lastLive, lost: e.state !== 'live' });
    }
    const { lose, restore } = planWebgl(cands, this.cap);
    for (const key of lose) {
      const e = this.entries.get(key);
      if (e?.state === 'live') this.loseWithSnapshot(e);
    }
    for (const key of restore) {
      const e = this.entries.get(key);
      if (e) this.restore(e, now);
    }
    for (const c of cands) {
      const e = this.entries.get(c.key);
      if (e && e.state === 'live') e.lastLive = now;
    }
  }

  private loseWithSnapshot(e: Entry): void {
    e.state = 'losing';
    const run = () => {
      if (e.state !== 'losing') return; // restored before the frame came
      this.snapshot(e);
      this.loseNow(e);
    };
    // In the next frame our callback runs after the page's own render loop (it registered first), so the
    // drawing buffer still holds the frame the page just drew.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  private loseNow(e: Entry): void {
    e.state = 'ours';
    try {
      e.ext?.loseContext();
    } catch {
      /* already lost */
    }
  }

  private restore(e: Entry, now: number): void {
    if (e.state === 'losing') {
      e.state = 'live';
      return;
    }
    if (e.state !== 'ours') return;
    e.state = 'live';
    e.lastLive = now;
    try {
      e.ext?.restoreContext();
    } catch {
      /* not restorable — the page keeps a blank canvas until it rebuilds */
    }
    // Leave the snapshot under the canvas until the page has drawn again.
    const clear = () => this.clearSnapshot(e);
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => requestAnimationFrame(clear));
    else clear();
  }

  private snapshot(e: Entry): void {
    const c = e.canvas;
    if (!c.width || !c.height || typeof document === 'undefined') return;
    try {
      const k = Math.min(1, SNAPSHOT_MAX / Math.max(c.width, c.height));
      const snap = document.createElement('canvas');
      snap.width = Math.max(1, Math.round(c.width * k));
      snap.height = Math.max(1, Math.round(c.height * k));
      const g = snap.getContext('2d');
      if (!g) return;
      g.drawImage(c, 0, 0, snap.width, snap.height);
      const url = snap.toDataURL('image/png');
      if (!e.savedBg)
        e.savedBg = {
          image: c.style.backgroundImage,
          size: c.style.backgroundSize,
          repeat: c.style.backgroundRepeat,
        };
      c.style.backgroundImage = `url("${url}")`;
      c.style.backgroundSize = '100% 100%';
      c.style.backgroundRepeat = 'no-repeat';
      c.setAttribute('data-dc-gl-asleep', '');
    } catch {
      /* a tainted or unreadable canvas: it sleeps blank */
    }
  }

  private clearSnapshot(e: Entry): void {
    if (e.state !== 'live') return;
    const c = e.canvas;
    c.removeAttribute('data-dc-gl-asleep');
    if (!e.savedBg) return;
    c.style.backgroundImage = e.savedBg.image;
    c.style.backgroundSize = e.savedBg.size;
    c.style.backgroundRepeat = e.savedBg.repeat;
    e.savedBg = null;
  }
}
