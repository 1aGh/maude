// client/v2/shell/use-dismiss-outside.js — "a click anywhere else closes the popover", including the click that
// never reaches the shell.
//
// Two doors, the pair the project pill already used (shell/project-pill.jsx):
//   · a `pointerdown` in the capture phase anywhere in the shell outside `ref` (capture, so a handler that stops the
//     event cannot keep the popover open);
//   · the shell window's `blur`. Canvases render in an iframe on another origin (DDR-054): a click in one bubbles
//     nothing to the shell, but it moves focus into the iframe and so blurs this window. (Switching apps does the
//     same — closing then is what a menu does anyway.)
// `onDismiss('outside' | 'blur')` runs; esc and what focus does after are the popover's own.

import { useEffect, useRef } from 'react';

/**
 * @param {boolean} open
 * @param {{ current: Element | null }} ref the popover; a pointerdown inside it is not a dismissal
 * @param {(why: 'outside' | 'blur') => void} onDismiss
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
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, ref]);
}
