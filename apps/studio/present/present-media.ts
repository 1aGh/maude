// apps/studio/present/present-media.ts — S3.3: a clip plays where it stands on the Present stage
// (04 Modes · md-present-video).
//
//   an artboard with a video-comp   starts from its first frame WITH SOUND when its turn comes
//   click                           pauses it (and plays it again) instead of moving on
//   → · space · the shell's ‹ ›     move on mid-clip — nothing waits for the end; the clip stops
//   it ends                         the last frame stays up (nothing seeks it back); → moves on
//   `present-media`                 {playing, t, duration, muted} to the shell: its transport mirrors it
//   `present-media-cmd`             the shell's transport (and presenter view's `mute`) drives it
//
// The clip is found by its artboard in the registry video-comp.tsx fills (`__maudeVideoComps`); this file
// drives the Remotion Player through the same handle the Timeline uses, so there is no second playback
// path. Everything the clip had before Present (frame, sound) comes back when Present ends.
//
// SOUND. The Present gesture happens in the shell, not in this iframe. Measured on macOS WKWebView
// (S3.3, autoplay probe): an unmuted `play()` from a cross-origin iframe with no gesture RESOLVES, with
// WKWebView's own default configuration and with wry's `autoplay: true`; so the desktop needs no webview
// setting. A browser that refuses sound (the follower page) is handled here without a canvas workaround:
// the clip plays muted instead and `muted: true` tells the shell, whose transport offers the sound.

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

/** The part of Remotion's `PlayerRef` this needs (a fake in the tests). */
export interface PlayerLike {
  play(): void;
  pause(): void;
  seekTo(frame: number): void;
  isPlaying(): boolean;
  getCurrentFrame(): number;
  mute(): void;
  unmute(): void;
  isMuted(): boolean;
  addEventListener(event: string, cb: () => void): void;
  removeEventListener(event: string, cb: () => void): void;
}

/** One registered video-comp (video-comp.tsx `CompEntry`, the fields read here). */
export interface ClipRef {
  artboardId: string | null;
  fps: number;
  durationInFrames: number;
  ref: { current: PlayerLike | null };
}

export type MediaOp = 'play' | 'pause' | 'mute' | 'unmute';

export interface MediaState {
  playing: boolean;
  /** Seconds, 0..86400. */
  t: number;
  duration: number;
  muted: boolean;
}

export interface MediaDeps {
  /** The window that listens for the shell's `present-media-cmd`. Absent: no listener (tests). */
  win?: Window;
  clips(): readonly ClipRef[];
  post(msg: Record<string, unknown>): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

/** What the Present stage calls (present-stage.tsx `StageDeps.media`). */
export interface StageMedia {
  /** Present started: listen for the shell's commands. */
  start(): void;
  /** The stage is on `artboardId` now (after it told the shell where it is). */
  arrive(artboardId: string): void;
  /** The stage is about to move off its artboard. */
  leave(): void;
  /** A click on the stage: true when the clip took it (the stage must not move on). */
  click(): boolean;
  /** Present ended: stop, and put every clip back as it was. */
  stop(): void;
}

export interface PresentMedia extends StageMedia {
  command(op: MediaOp): void;
  hasClip(artboardId: string): boolean;
}

/** Retries for a Player that is not mounted yet, and the wait between them. */
const MOUNT_TRIES = 5;
const MOUNT_WAIT_MS = 60;
/** After this long a clip that was told to play with sound but is not playing is retried muted. */
const SOUND_CHECK_MS = 400;
const EVENTS = ['play', 'pause', 'ended', 'volumechange', 'timeupdate', 'seeked'] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function createPresentMedia(deps: MediaDeps): PresentMedia {
  let cur: { clip: ClipRef; p: PlayerLike; off: () => void } | null = null;
  /** The presenter wants it playing (a click or a pause command sets it false). */
  let wantPlaying = false;
  let ended = false;
  /** The presenter muted this Present (presenter view): every clip that follows starts muted. */
  let soundOff = false;
  let last = '';
  let gen = 0;
  const timers = new Set<number>();
  /** What each clip had before Present touched it. */
  const originals = new Map<PlayerLike, { frame: number; muted: boolean }>();
  let unbind: (() => void) | null = null;

  const later = (fn: () => void, ms: number) => {
    const h = deps.setTimer(() => {
      timers.delete(h);
      fn();
    }, ms);
    timers.add(h);
  };
  const clearTimers = () => {
    for (const h of timers) deps.clearTimer(h);
    timers.clear();
  };

  const clipFor = (id: string) => deps.clips().find((c) => c.artboardId === id) ?? null;

  const state = (): MediaState | null => {
    if (!cur) return null;
    const { clip, p } = cur;
    const fps = clip.fps > 0 ? clip.fps : 30;
    const duration = Math.min(86400, clip.durationInFrames / fps);
    const raw = ended ? duration : p.getCurrentFrame() / fps;
    return {
      playing: p.isPlaying(),
      t: r2(Math.min(duration, Math.max(0, raw))),
      duration: r2(duration),
      muted: p.isMuted(),
    };
  };

  /** Tell the shell — once per distinct state. */
  const echo = () => {
    const s = state();
    if (!s) return;
    const key = `${s.playing}|${s.t}|${s.duration}|${s.muted}`;
    if (key === last) return;
    last = key;
    deps.post({ dgn: 'present-media', ...s });
  };

  const playNow = (p: PlayerLike) => {
    try {
      p.play();
    } catch {
      // The browser refused sound: play muted, and say so.
      try {
        p.mute();
        p.play();
      } catch {
        /* the Player is mid-mount: the sound check tries once more */
      }
    }
  };

  const applySound = (p: PlayerLike) => {
    if (p.isMuted() !== soundOff) {
      if (soundOff) p.mute();
      else p.unmute();
    }
  };

  const detach = () => {
    clearTimers();
    gen += 1;
    cur?.off();
    const was = cur;
    cur = null;
    wantPlaying = false;
    return was;
  };

  const begin = (clip: ClipRef, p: PlayerLike) => {
    const onEvent = (ev: string) => () => {
      if (ev === 'ended') ended = true;
      else if (ev === 'play' || ev === 'seeked') ended = false;
      echo();
    };
    const handlers = EVENTS.map((ev) => [ev, onEvent(ev)] as const);
    for (const [ev, fn] of handlers) p.addEventListener(ev, fn);
    cur = {
      clip,
      p,
      off: () => {
        for (const [ev, fn] of handlers) {
          try {
            p.removeEventListener(ev, fn);
          } catch {
            /* a Player that is gone */
          }
        }
      },
    };
    ended = false;
    last = '';
    if (!originals.has(p)) originals.set(p, { frame: p.getCurrentFrame(), muted: p.isMuted() });
    wantPlaying = true;
    try {
      p.seekTo(0);
    } catch {
      /* the Player is mid-mount */
    }
    applySound(p);
    playNow(p);
    echo();
    // A Player that took the call and played nothing (sound refused where it cannot throw): once, muted.
    const mine = gen;
    later(() => {
      if (mine !== gen || !cur || !wantPlaying) return;
      if (cur.p.isPlaying()) return;
      try {
        if (!cur.p.isMuted()) cur.p.mute();
        cur.p.play();
      } catch {
        /* nothing more to try */
      }
      echo();
    }, SOUND_CHECK_MS);
  };

  const api: PresentMedia = {
    start() {
      const win = deps.win;
      if (!win || unbind) return;
      const onMessage = (e: MessageEvent) => {
        // Only the shell may drive the clip: the table checks the sender too, this is the visible gate.
        const parent = win.parent;
        if (!e.data || e.source !== parent) return;
        const m = acceptFromShell(e, win);
        if (m?.dgn === 'present-media-cmd') api.command(m.op);
      };
      win.addEventListener('message', onMessage);
      unbind = () => win.removeEventListener('message', onMessage);
    },

    arrive(artboardId) {
      detach()?.p.pause();
      const clip = clipFor(artboardId);
      // Nothing but the presented clip makes sound: an autoPlay comp elsewhere on the canvas is stopped.
      for (const c of deps.clips()) {
        const p = c.ref.current;
        if (p && p !== clip?.ref.current && p.isPlaying()) p.pause();
      }
      if (!clip) return;
      const mine = gen;
      const tryMount = (left: number) => {
        if (mine !== gen) return;
        const p = clip.ref.current;
        if (p) {
          begin(clip, p);
          return;
        }
        if (left > 0) later(() => tryMount(left - 1), MOUNT_WAIT_MS);
      };
      tryMount(MOUNT_TRIES);
    },

    leave() {
      detach()?.p.pause();
    },

    click() {
      if (!cur) return false;
      const { p } = cur;
      if (p.isPlaying()) {
        wantPlaying = false;
        p.pause();
      } else {
        if (ended) p.seekTo(0);
        wantPlaying = true;
        playNow(p);
      }
      echo();
      return true;
    },

    command(op) {
      if (op === 'mute' || op === 'unmute') {
        soundOff = op === 'mute';
        if (!cur) return;
        if (soundOff) cur.p.mute();
        else cur.p.unmute();
        echo();
        return;
      }
      if (!cur) return;
      const { p } = cur;
      if (op === 'pause') {
        wantPlaying = false;
        p.pause();
      } else {
        if (ended) p.seekTo(0);
        wantPlaying = true;
        playNow(p);
      }
      echo();
    },

    hasClip: (artboardId) => clipFor(artboardId) !== null,

    stop() {
      unbind?.();
      unbind = null;
      detach()?.p.pause();
      for (const [p, o] of originals) {
        try {
          p.seekTo(o.frame);
          if (p.isMuted() !== o.muted) {
            if (o.muted) p.mute();
            else p.unmute();
          }
        } catch {
          /* a Player that is gone */
        }
      }
      originals.clear();
      soundOff = false;
    },
  };
  return api;
}
