/**
 * 2.0.7 — the stills' warm-up (the overview level, artboard-still.ts). An artboard whose children never mount while
 * the person looks around (the ring mounts one per `GESTURE_MOUNT_GAP_MS` mid-pan, so about half of the mascot
 * canvas's 88 never do during a sweep) has no still: it passes as a flat own-colour block. Once the canvas is open
 * and nothing moves, the warm-up mounts such artboards one at a time — far away, asleep, within the DOM budget — lets
 * the still controller draw each (sliced, within its idle frame budget), then releases it: its placeholder now
 * shows the kept still, and a later pass shows the still from its first frame.
 *
 * Rules: one artboard at a time; only after `WARM_QUIET_MS` with no input and no camera move, and only while the
 * still controller is quiet (no gesture, past its settle hold, no hand-back, no drawing on screen waiting) and the
 * ring's own mounts are done. Any input pauses it at once: a mount asked for but not yet made is withdrawn, one made
 * is released only once it is quiet again (a release is an unmount — main-thread work). Never past the DOM budget,
 * never past the still cache's byte budget (an evicted still would be warmed again, forever), never a video artboard
 * (`eager`, its media rule), never one on screen or near (the ring's), each artboard at most once per document.
 */

/** Quiet needed before the warm-up mounts the next artboard: no input, no camera move (ms). */
export const WARM_QUIET_MS = 1500;
/** Between one artboard's release and the next one's mount (ms): the frames the release paints in. */
export const WARM_GAP_MS = 120;
/** How often a waiting warm-up looks again (ms). */
export const WARM_POLL_MS = 150;
/** A warm mount whose still has not come by then is released and not tried again (ms). */
export const WARM_STEP_MAX_MS = 5000;

export interface WarmCandidate {
  id: string;
  /** distance to the viewport centre (px) — nearest first */
  dist: number;
  /** its first mount fits the DOM budget now */
  fits: boolean;
}

/** What the warm-up needs from the runtime (an adapter: the registry, the still controller, the clock). */
export interface WarmHost {
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  /** artboards it may mount now: not mounted, far, not pinned / eager, a gate holds them */
  candidates(): WarmCandidate[];
  /** would this artboard show a still at the settled zoom (under the cut)? */
  wanted(id: string): boolean;
  hasStill(id: string): boolean;
  mount(id: string): void;
  release(id: string): void;
  mounted(id: string): boolean;
  /** nothing moves, nothing is held, nothing on screen is being drawn, the ring's mounts are done */
  quiet(): boolean;
  /** the last camera write or settle (ms) */
  lastActivity(): number;
  /** the still cache can take one more still without dropping a kept one */
  cacheRoom(): boolean;
}

export type WarmState = 'waiting' | 'mounting' | 'drawing' | 'paused' | 'done' | 'full';

export interface WarmStats {
  state: WarmState;
  warmed: number;
  failed: number;
  /** ms (host clock) the first warm mount was asked for / the warm-up found nothing left */
  startedAt: number | null;
  finishedAt: number | null;
  current: string | null;
  /** why it stopped short: 'budget' (DOM) | 'cache' (bytes) */
  full: string | null;
}

export class StillWarmup {
  private current: { id: string; at: number; drawn: boolean } | null = null;
  private tried = new Set<string>();
  private timer: unknown = null;
  private inputAt = Number.NEGATIVE_INFINITY;
  private warmed = 0;
  private failed = 0;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private state: WarmState = 'waiting';
  private full: string | null = null;
  private stopped = false;

  constructor(private readonly host: WarmHost) {}

  /** Start (or wake) the warm-up: after the quiet it looks for the next artboard. */
  kick(ms = WARM_POLL_MS, now = false): void {
    if (this.stopped) return;
    if (this.timer !== null) {
      if (!now) return;
      this.host.cancel(this.timer);
    }
    this.timer = this.host.later(() => {
      this.timer = null;
      this.tick();
    }, ms);
  }

  /** Any input (pointer, wheel, key, touch): pause at once. */
  input(): void {
    this.inputAt = this.host.now();
    const c = this.current;
    if (c && !this.host.mounted(c.id)) {
      // asked for, not made yet: withdrawn (the drain never mounts it); tried again once quiet
      this.host.release(c.id);
      this.tried.delete(c.id);
      this.current = null;
    }
    this.state = 'paused';
    this.full = null;
    this.kick(WARM_QUIET_MS);
  }

  /** The camera settled or the zoom changed: once quiet, look again (a zoom-out brings new artboards under the cut). */
  wake(): void {
    if (this.state === 'done' || this.state === 'full') {
      this.state = 'waiting';
      this.full = null;
    }
    this.kick();
  }

  /** The still controller finished a drawing of `id`. */
  stillDone(id: string, ok: boolean): void {
    const c = this.current;
    if (!c || c.id !== id || c.drawn) return;
    c.drawn = true;
    if (ok) this.warmed += 1;
    else this.failed += 1;
    this.kick(0, true);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.host.cancel(this.timer);
    this.timer = null;
    if (this.current) this.host.release(this.current.id);
    this.current = null;
  }

  stats(): WarmStats {
    return {
      state: this.state,
      warmed: this.warmed,
      failed: this.failed,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      current: this.current?.id ?? null,
      full: this.full,
    };
  }

  private tick(): void {
    if (this.stopped) return;
    const t = this.host.now();
    const quietAt = Math.max(this.inputAt, this.host.lastActivity()) + WARM_QUIET_MS;
    if (t < quietAt) {
      this.kick(Math.max(16, quietAt - t));
      return;
    }
    const c = this.current;
    if (c) {
      const late = t - c.at > WARM_STEP_MAX_MS;
      // drawn (or late): released once nothing moves — a release is an unmount
      if (c.drawn || late || this.host.hasStill(c.id)) {
        if (!this.host.quiet()) {
          this.kick();
          return;
        }
        if (!c.drawn && !this.host.hasStill(c.id)) this.failed += 1;
        else if (!c.drawn) this.warmed += 1;
        this.host.release(c.id);
        this.current = null;
        this.kick(WARM_GAP_MS);
        return;
      }
      this.state = this.host.mounted(c.id) ? 'drawing' : 'mounting';
      this.kick();
      return;
    }
    if (!this.host.quiet()) {
      if (this.state !== 'done' && this.state !== 'full') this.state = 'waiting';
      this.kick();
      return;
    }
    let pick: WarmCandidate | null = null;
    let blocked = false;
    for (const k of this.host.candidates()) {
      if (this.tried.has(k.id) || this.host.hasStill(k.id) || !this.host.wanted(k.id)) continue;
      if (!k.fits) {
        blocked = true;
        continue;
      }
      if (!pick || k.dist < pick.dist) pick = k;
    }
    if (!pick) {
      this.state = blocked ? 'full' : 'done';
      this.full = blocked ? 'budget' : null;
      if (this.finishedAt === null && this.startedAt !== null) this.finishedAt = t;
      return; // woken again by input (or a kick from the runtime)
    }
    if (!this.host.cacheRoom()) {
      this.state = 'full';
      this.full = 'cache';
      if (this.finishedAt === null && this.startedAt !== null) this.finishedAt = t;
      return;
    }
    if (this.startedAt === null) this.startedAt = t;
    this.finishedAt = null;
    this.tried.add(pick.id);
    this.current = { id: pick.id, at: t, drawn: false };
    this.state = 'mounting';
    this.host.mount(pick.id);
    this.kick();
  }
}
