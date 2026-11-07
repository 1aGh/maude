/**
 * @file       artboard-freeze.ts — 2.0.7: an awake artboard does no work of its own while the camera moves
 * @scope      apps/studio/artboard-freeze.ts (React-free; driven by artboard-live-gate.tsx on the frame freeze)
 * @purpose    Michal: "while you pan or zoom, artboards must not redraw". The frame freeze (frame-clock.ts + the
 *             shell's `maude-frame-freeze`) holds the artboards' frame callbacks; this pauses what runs without
 *             one, in the artboards that are awake and showing their body (an asleep artboard has its CSS
 *             animations and videos paused already; one under its still shows no body):
 *
 *             - CSS animations — `data-dc-frozen` on the article, the same rule as `data-dc-asleep`;
 *             - Web Animations started by script (motion's accelerated ones, `el.animate`) — paused, and played
 *               again on the thaw. A CSS animation or transition is left to the attribute: calling `pause()` on
 *               one would detach it from `animation-play-state` for good, and the sleep rule would stop working;
 *             - `<video>` that plays SILENTLY (muted or at volume 0) and is not a VideoComp's (its Player syncs
 *               its own). A video with sound keeps playing: a pan must not cut the sound.
 *
 *             The thaw resumes exactly what the freeze paused, and only what is still paused and connected.
 *             Timers (setTimeout / setInterval) are not held: Maude's own gesture end, settle and publish run
 *             on them, and React's scheduler and every library share them — a canvas can opt in through
 *             `useArtboardGesture()`.
 */

import { STILL_ATTR } from './artboard-still.ts';

export const FROZEN_ATTR = 'data-dc-frozen';

export const ARTBOARD_FREEZE_CSS = `
.dc-artboard[${FROZEN_ATTR}] .dc-artboard-body *,
.dc-artboard[${FROZEN_ATTR}] .dc-artboard-body *::before,
.dc-artboard[${FROZEN_ATTR}] .dc-artboard-body *::after { animation-play-state: paused !important; }
`;

/** Awake and showing its body: an asleep artboard is paused already, one under its still renders no body. */
export function freezable(article: Element): boolean {
  if (article.hasAttribute('data-dc-asleep')) return false;
  const still = article.getAttribute(STILL_ATTR);
  return still !== 'still' && still !== 'cover';
}

/** A Web Animation a script started (not a CSS animation / transition — those follow the attribute). */
function scripted(a: Animation): boolean {
  const g = globalThis as unknown as { CSSAnimation?: unknown; CSSTransition?: unknown };
  if (typeof g.CSSAnimation === 'function' && a instanceof (g.CSSAnimation as typeof Animation))
    return false;
  if (typeof g.CSSTransition === 'function' && a instanceof (g.CSSTransition as typeof Animation))
    return false;
  return true;
}

function silent(m: HTMLMediaElement): boolean {
  return m.muted || m.volume === 0;
}

export class ArtboardFreeze {
  private articles: Element[] = [];
  private anims: Animation[] = [];
  private media: HTMLMediaElement[] = [];
  private on = false;
  private n = { freezes: 0, articles: 0, anims: 0, media: 0 };

  frozen(): boolean {
    return this.on;
  }

  freeze(articles: Iterable<Element>): void {
    if (this.on) return;
    this.on = true;
    this.n.freezes += 1;
    for (const a of articles) {
      if (!a.isConnected || !freezable(a)) continue;
      a.setAttribute(FROZEN_ATTR, '');
      this.articles.push(a);
      const body = a.querySelector('.dc-artboard-body');
      if (!body) continue;
      const list =
        typeof (body as Element & { getAnimations?: unknown }).getAnimations === 'function'
          ? body.getAnimations({ subtree: true })
          : [];
      for (const an of list) {
        if (an.playState !== 'running' || !scripted(an)) continue;
        an.pause();
        this.anims.push(an);
      }
      for (const m of body.querySelectorAll<HTMLMediaElement>('video')) {
        if (m.paused || m.ended || !silent(m) || m.closest('.dc-video-comp')) continue;
        m.pause();
        this.media.push(m);
      }
    }
    this.n.articles += this.articles.length;
    this.n.anims += this.anims.length;
    this.n.media += this.media.length;
  }

  thaw(): void {
    if (!this.on) return;
    this.on = false;
    for (const a of this.articles) a.removeAttribute(FROZEN_ATTR);
    for (const an of this.anims) if (an.playState === 'paused') an.play();
    for (const m of this.media) if (m.isConnected && m.paused) void m.play?.()?.catch?.(() => {});
    this.articles = [];
    this.anims = [];
    this.media = [];
  }

  stats(): { frozen: boolean; freezes: number; articles: number; anims: number; media: number } {
    return { frozen: this.on, ...this.n };
  }
}
