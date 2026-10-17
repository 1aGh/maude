// client/v2/shell/modal-focus.js — V2-4 gate (a11y B2, W3, W4): the shell's ONE focus discipline for
// overlays, lifted from the Share dialog's and the Settings sheet's traps (which now call `trapTab`).
//
//   trapTab(e, root)        Tab / ⇧Tab wrap inside `root` (and pull a focus that escaped back in)
//   useModalFocus({…})      an overlay's lifetime: remember the opener, focus inside, trap Tab (modal
//                           only), esc closes (from ANY element inside — a palette row too), and on
//                           close give focus back to the opener — or, when the opener is gone, to the
//                           shell's fallback (never BODY)
//   rovingTabKey(e, …)      WAI-ARIA tabs: ←/→ (↑/↓), Home / End move AND select, one tab stop
//   installFocusRescue(…)   focus that fell to BODY because its element vanished (a hidden panel, the
//                           Present exit pill) lands on a sensible control instead
//
// Overlays stack: only the topmost `useModalFocus` handles Tab and esc, so a dialog opened from a sheet
// owns the keys until it closes.

import { useEffect, useRef } from 'react';
import { railTarget } from '../settings/settings-model.js';

export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** The tabbable elements inside `root`, in DOM order (hidden / inert subtrees left out). */
export function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (n) =>
      n.getAttribute('tabindex') !== '-1' &&
      !n.closest('[hidden], [inert]') &&
      n.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Keep Tab inside `root`. Returns true when it moved focus (the caller need do nothing else).
 * A focus that is outside `root` (it escaped, or the overlay just opened) is pulled to the first /
 * last element.
 */
export function trapTab(e, root) {
  if (e.key !== 'Tab' || !root || e.defaultPrevented) return false;
  const nodes = focusables(root);
  const active = root.ownerDocument.activeElement;
  if (nodes.length === 0) {
    e.preventDefault();
    root.focus?.();
    return true;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const inside = root.contains(active) && active !== root;
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** The shell's own landmark when an opener is gone: the canvas, else the project pill. */
export function shellFallback(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return null;
  return (
    doc.querySelector('[data-testid="canvas-frame"]') ??
    doc.querySelector('[data-testid="project-pill"]') ??
    null
  );
}

function usable(el, doc) {
  return (
    !!el &&
    el !== doc.body &&
    el !== doc.documentElement &&
    el.isConnected &&
    typeof el.focus === 'function' &&
    !el.closest?.('[hidden], [inert]')
  );
}

/** Give focus back to `opener`, or to `fallback()` / the shell landmark when it is gone. */
export function restoreFocus(opener, fallback, doc = document) {
  const to = usable(opener, doc) ? opener : (fallback?.() ?? shellFallback(doc));
  if (usable(to, doc)) to.focus({ preventScroll: true });
}

/** The open overlays, topmost last (module state: one shell document). */
const STACK = [];

/**
 * An overlay's focus lifetime. Returns the ref to put on the dialog element.
 *
 * @param {object} o
 * @param {boolean} [o.open=true] — the overlay is showing (a component that renders null while closed)
 * @param {() => void} o.onClose — esc
 * @param {boolean} [o.modal=true] — trap Tab (`aria-modal`); a non-modal sheet only restores focus
 * @param {boolean} [o.esc=true] — esc closes from anywhere inside (window capture, before React)
 * @param {{ current: HTMLElement | null }} [o.initialRef] — focused on open (else the dialog itself
 *   when nothing inside has focus)
 * @param {() => HTMLElement | null} [o.fallback] — where focus goes when the opener is gone
 */
export function useModalFocus({
  open = true,
  onClose,
  modal = true,
  esc = true,
  initialRef,
  fallback,
} = {}) {
  const ref = useRef(null);
  const live = useRef({ onClose, fallback });
  live.current = { onClose, fallback };
  useEffect(() => {
    if (!open) return undefined;
    const doc = document;
    const opener = doc.activeElement;
    const entry = { ref };
    STACK.push(entry);
    const root = ref.current;
    const first = initialRef?.current;
    if (first) first.focus({ preventScroll: true });
    else if (root && !root.contains(doc.activeElement)) root.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (STACK[STACK.length - 1] !== entry) return;
      if (esc && e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        live.current.onClose?.();
        return;
      }
      if (modal) trapTab(e, ref.current);
    };
    // Window capture: before React (a row's own keydown) and before the shell's key listener.
    const win = doc.defaultView ?? window;
    win.addEventListener('keydown', onKey, true);
    return () => {
      win.removeEventListener('keydown', onKey, true);
      const at = STACK.indexOf(entry);
      if (at >= 0) STACK.splice(at, 1);
      const { fallback: fb } = live.current;
      // After the overlay's DOM is gone (this cleanup runs before React removes it on unmount, and the
      // element still holds focus): a microtask later the opener takes it back.
      queueMicrotask(() => {
        const now = doc.activeElement;
        if (now && now !== doc.body && now.isConnected && !ref.current?.contains(now)) return;
        restoreFocus(opener, fb, doc);
      });
    };
  }, [open, modal, esc, initialRef]);
  return ref;
}

/**
 * WAI-ARIA tabs (automatic activation): ←/→/↑/↓ and Home / End select the next tab and focus it. Use on
 * the `role=tablist` element's keydown; give each tab `tabIndex={selected ? 0 : -1}`.
 * @returns the id it selected, or null when the key is not a tab key
 */
export function rovingTabKey(e, ids, current, select) {
  const to = railTarget(ids, current, e.key);
  if (!to) return null;
  e.preventDefault();
  if (to !== current) select(to);
  const list = e.currentTarget;
  const tabs = [...(list?.querySelectorAll?.('[role="tab"]') ?? [])];
  tabs[ids.indexOf(to)]?.focus();
  return to;
}

/**
 * Focus that fell to BODY because the element holding it vanished (⌘\ hid the panel it was in, Present's
 * exit pill unmounted) lands on `target(lost)` instead. Browsers fire no blur for that (the "focus
 * fixup" is silent), so the check runs after DOM changes: BODY has focus and the last focused element
 * is gone or hidden. A click on blank chrome (the element still there) is left alone. Install once per
 * shell document; returns the uninstall.
 * @param {(lost: Element, doc: Document) => Element | null} [target]
 */
export function installFocusRescue(doc = document, target = defaultRescueTarget) {
  let last = null;
  let pending = false;
  const onIn = (e) => {
    if (e.target && e.target !== doc.body) last = e.target;
  };
  const check = () => {
    pending = false;
    const a = doc.activeElement;
    if ((a && a !== doc.body) || !last) return;
    if (usable(last, doc) && visible(last)) return;
    const lost = last;
    last = null;
    const to = target(lost, doc);
    if (usable(to, doc)) to.focus({ preventScroll: true });
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(check);
  };
  const mo = new MutationObserver(schedule);
  mo.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'inert', 'class', 'style'],
  });
  doc.addEventListener('focusin', onIn, true);
  return () => {
    mo.disconnect();
    doc.removeEventListener('focusin', onIn, true);
  };
}

function visible(el) {
  return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

/** A control inside a hidden panel → the Hide / Show panels toggle; anything else → the shell landmark. */
export function defaultRescueTarget(lost, doc = document) {
  const inPanel = lost?.closest?.('.st-dockslot, [data-occludes]');
  if (inPanel) {
    const toggle = doc.querySelector('[data-testid="share-cluster-panels"]');
    if (toggle) return toggle;
  }
  return shellFallback(doc);
}
