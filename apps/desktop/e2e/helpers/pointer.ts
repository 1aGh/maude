import { browser } from '@wdio/globals';

/**
 * Pointer input at a WINDOW coordinate, for the canvas and for shell drags.
 *
 * The embedded WebDriver's `browser.action('pointer')` raises `mousedown`/`mouseup`/`click` on the TOP document only:
 * no `pointer*` events, and nothing ever reaches the canvas iframe. Both the canvas (selection, artboard labels) and the
 * shell's drag handles (timeline trim edges, the reframe window) listen for `pointerdown`/`pointermove`/`pointerup`, so a
 * scenario that "clicked at the artboard" through actions selected nothing and the timeline island never came out.
 *
 * These helpers synthesise the whole sequence (pointer + mouse + click) on the element under the point, descending into
 * the canvas frame (same-origin only: the lane runs with MAUDE_CANVAS_ORIGIN_SPLIT=0) and translating the coordinates.
 * A drag keeps its start target for the moves and the release, as pointer capture would.
 */

type Phase = 'click' | 'down' | 'move' | 'up';

function send(phase: Phase, x: number, y: number): boolean {
  const w = window as unknown as {
    __maudePointer?: { el: Element; win: Window; ox: number; oy: number };
  };
  let win: Window = window;
  let ox = 0;
  let oy = 0;
  let el: Element | null = document.elementFromPoint(x, y);
  while (el instanceof HTMLIFrameElement && el.contentDocument) {
    const r = el.getBoundingClientRect();
    ox += r.left;
    oy += r.top;
    win = el.contentWindow as Window;
    el = el.contentDocument.elementFromPoint(x - ox, y - oy);
  }
  if (phase === 'move' || phase === 'up') {
    const held = w.__maudePointer;
    if (held) {
      el = held.el;
      win = held.win;
      ox = held.ox;
      oy = held.oy;
    }
  }
  if (!el) return false;
  const W = win as Window & typeof globalThis;
  const at = (type: string, buttons: number) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    view: win,
    button: 0,
    buttons,
    clientX: x - ox,
    clientY: y - oy,
    screenX: x,
    screenY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    detail: type === 'click' ? 1 : 0,
  });
  const fire = (kind: 'pointer' | 'mouse', type: string, buttons: number) => {
    const init = at(type, buttons);
    const ev = kind === 'pointer' ? new W.PointerEvent(type, init) : new W.MouseEvent(type, init);
    (el as Element).dispatchEvent(ev);
  };
  if (phase === 'down' || phase === 'click') {
    w.__maudePointer = { el, win, ox, oy };
    fire('pointer', 'pointerdown', 1);
    fire('mouse', 'mousedown', 1);
  }
  if (phase === 'move') {
    fire('pointer', 'pointermove', 1);
    fire('mouse', 'mousemove', 1);
  }
  if (phase === 'up' || phase === 'click') {
    fire('pointer', 'pointerup', 0);
    fire('mouse', 'mouseup', 0);
    fire('mouse', 'click', 0);
    w.__maudePointer = undefined;
  }
  return true;
}

const run = (phase: Phase, x: number, y: number) =>
  browser.execute(send, phase, Math.round(x), Math.round(y)) as Promise<boolean>;

/** A click at a window coordinate, through whichever document is under it. */
export const pointerClick = (x: number, y: number) => run('click', x, y);
/** Press at a coordinate and hold: later moves and the release go to this target. */
export const pointerDown = (x: number, y: number) => run('down', x, y);
/** Move the held pointer to a window coordinate. */
export const pointerMove = (x: number, y: number) => run('move', x, y);
/** Release the held pointer at a window coordinate. */
export const pointerUp = (x: number, y: number) => run('up', x, y);

/**
 * A window point over BARE canvas — under it the top document has the canvas frame (no shell island, panel or
 * Inspector floats there) and the canvas has no artboard. A "click on empty canvas" at a fixed offset from an
 * artboard lands on whatever the shell put there (the Inspector the selection itself opened), so it never
 * deselects; this walks rings of candidates around `near` and returns the first bare one, or null.
 */
export function bareCanvasPoint(near: { x: number; y: number; w: number; h: number }) {
  return browser.execute((b) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement | null;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return null;
    const f = frame.getBoundingClientRect();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    for (const r of [80, 140, 220, 320, 440]) {
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(t) * (b.w / 2 + r));
        const y = Math.round(cy + Math.sin(t) * (b.h / 2 + r));
        if (x < f.left + 8 || y < f.top + 8 || x > f.right - 8 || y > f.bottom - 8) continue;
        if (document.elementFromPoint(x, y) !== frame) continue;
        const inner = doc.elementFromPoint(x - f.left, y - f.top);
        if (!inner || inner.closest('[data-dc-screen], button, input, [role]')) continue;
        return { x, y };
      }
    }
    return null;
  }, near) as Promise<{ x: number; y: number } | null>;
}
