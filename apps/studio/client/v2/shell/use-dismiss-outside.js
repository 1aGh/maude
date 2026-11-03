// client/v2/shell/use-dismiss-outside.js — "a click anywhere else closes the popover", including the click that
// never reaches the shell.
//
// Three doors:
//   · a `pointerdown` in the capture phase anywhere in the shell outside `ref` (capture, so a handler that stops the
//     event cannot keep the popover open);
//   · a press in the canvas (`canvas-pointer.js`). Canvases render in an iframe on another origin (DDR-054): a
//     click in one bubbles nothing to the shell, so the canvas tells the shell over the dgn bridge. This is the
//     door that holds in the packaged app: WebKit does not move focus into the iframe on a press that lands on
//     nothing focusable, so the window blur below never arrives there (rc3 r4-12);
//   · the shell window's `blur` — Chromium's way of saying the same, and switching apps (closing then is what a
//     menu does anyway).
// `onDismiss('outside' | 'canvas' | 'blur')` runs. None of the doors stops the press: it still reaches what it was
// aimed at. Esc and what focus does after are the popover's own — an outside dismissal should leave the focus
// where the click put it.

import { useEffect, useRef } from 'react';
import { onCanvasPointer } from './canvas-pointer.js';

/**
 * @param {boolean} open
 * @param {{ current: Element | null }} ref the popover; a pointerdown inside it is not a dismissal
 * @param {(why: 'outside' | 'canvas' | 'blur') => void} onDismiss
 */
export function useDismissOutside(open, ref, onDismiss) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) latest.current('outside');
    };
    const onBlur = () => latest.current('blur');
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    const offCanvas = onCanvasPointer(() => latest.current('canvas'));
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      offCanvas();
    };
  }, [open, ref]);
}
