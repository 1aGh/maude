// overlay.jsx — hand-rolled guided-tour engine (zero runtime dep, DDR-B).
//
// One <TourOverlay steps={[…]} open onClose onComplete bus hasSelection hasCanvas/>
// drives both the per-feature spotlight tours (a What's New entry's `tour[]`) and
// the evergreen usage tour.
//
// A step is { target, title, body, placement?, ...setup }. The engine does more
// than spotlight: before each step it puts the shell into the state the target
// needs, then waits for the element to actually render before measuring — so the
// tour *walks the user through the live feature* instead of floating a modal over
// a missing element. Setup directives (all optional):
//   canvas: true            → ensure a canvas is open (bus.setup opens the first)
//   inspector: true         → open the right-hand Inspector
//   tab: 'inspect'|'layers'|'css'  → switch the Inspector tab
//   requireSelection: true  → the target only exists once an element is ⌘-clicked
//                             in the canvas; the card shows a "⌘-click to continue"
//                             hint and the spotlight snaps onto the real row the
//                             moment a selection lands.
// A step whose target still can't be resolved shows centered (no spotlight) — the
// tour never dead-ends on a missing element.
//
// A11y: role="dialog" + aria-modal, focus moves to the primary button on each
// step and is trapped within the card, focus is restored on close, Esc skips,
// ←/→ navigate. prefers-reduced-motion disables the spotlight transition.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

function getRect(target) {
  if (typeof document === 'undefined' || !target) return null;
  try {
    const el = document.querySelector(target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return r;
  } catch {
    return null;
  }
}

const CARD_W = 320;
const CARD_H_EST = 184;

function computeCardStyle(rect) {
  if (typeof window === 'undefined' || !rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const placeLeft = rect.left > CARD_W + 36 && vw - rect.right < CARD_W + 36;
  if (placeLeft) {
    // Panel-on-the-right targets (the Inspector): park the card to its left so it
    // never covers the very thing it's pointing at.
    const top = Math.min(Math.max(12, rect.top), vh - CARD_H_EST - 12);
    return { top, left: Math.max(12, rect.left - CARD_W - 16), width: CARD_W };
  }
  const roomBelow = vh - rect.bottom;
  const top =
    roomBelow > CARD_H_EST + 24 ? rect.bottom + 12 : Math.max(12, rect.top - CARD_H_EST - 12);
  const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
  return { top, left, width: CARD_W };
}

export function TourOverlay({ steps, open, onClose, onComplete, bus, hasSelection, hasCanvas }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const prevFocus = useRef(null);
  const pollRef = useRef(null);
  // The bus is rebuilt by the parent on every render; ref it so its identity
  // churn never re-triggers the per-step setup effect (which would thrash).
  const busRef = useRef(bus);
  busRef.current = bus;

  const step = steps[i] || null;

  const measure = useCallback(() => {
    if (!step) {
      setRect(null);
      return null;
    }
    const r = getRect(step.target);
    setRect(r);
    return r;
  }, [step]);

  // Reset to the first step whenever a tour (re)opens.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Per-step: run the step's setup (open canvas / inspector / switch tab), then
  // poll for the target to render before settling on a measurement. React state
  // updates + the canvas-shell round-trip are async, so a single synchronous
  // querySelector almost always misses on the first frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only on step/selection change; bus + measure reached via ref/stable closures on purpose.
  useLayoutEffect(() => {
    if (!open || !step) return undefined;
    let cancelled = false;
    setRect(null);

    // Establish the UI state this step wants to highlight.
    try {
      busRef.current?.setup?.(step);
    } catch {}

    let tries = 0;
    const MAX = 24; // ~3s at 130ms
    const tick = () => {
      if (cancelled) return;
      const r = measure();
      const settled = r || tries >= MAX;
      if (settled) {
        if (r) {
          try {
            document
              .querySelector(step.target)
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          } catch {}
          // Re-measure after the scroll so the spotlight is glued post-layout.
          requestAnimationFrame(() => {
            if (!cancelled) measure();
          });
        }
        return;
      }
      tries += 1;
      pollRef.current = setTimeout(tick, 130);
    };
    tick();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // Re-run when the step changes OR a selection arrives (a requireSelection
    // target pops into existence the moment the user ⌘-clicks). `bus`/`measure`
    // are reached through refs/stable closures to avoid identity-churn re-runs.
  }, [open, i, hasSelection]);

  // Keep the spotlight glued to its target through scroll/resize; restore focus.
  useEffect(() => {
    if (!open) return undefined;
    prevFocus.current = document.activeElement;
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      try {
        prevFocus.current?.focus?.();
      } catch {}
    };
  }, [open, measure]);

  const last = i >= steps.length - 1;
  const next = useCallback(() => {
    if (last) {
      onComplete?.();
      onClose?.();
    } else {
      setI((n) => Math.min(n + 1, steps.length - 1));
    }
  }, [last, onComplete, onClose, steps.length]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Keyboard: Esc skips, ←/→ navigate, Tab is trapped within the card buttons.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === 'Tab') {
        const card = cardRef.current;
        if (!card) return;
        const f = card.querySelectorAll('button');
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, next, back, onClose]);

  // Move focus to the primary action on each step (accessible dialog behavior).
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      const primary = cardRef.current?.querySelector('[data-tour-primary]');
      try {
        primary?.focus();
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [open, i]);

  if (!open || !steps.length || !step) return null;
  const pad = 6;
  const spot = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // A requireSelection step whose target hasn't materialized yet: tell the user
  // the one action only they can take (the canvas iframe is cross-origin, so the
  // tour can't ⌘-click for them — DDR-054).
  const needSelHint = !!step.requireSelection && !hasSelection;
  const needCanvasHint = (!!step.canvas || !!step.requireSelection) && hasCanvas === false;

  // Optional per-step graphic (Phase 29 / E4): a component drawn above the copy —
  // the collab tour uses it for the centered two-layer infographic step. Widens the
  // card so the diagram has room.
  const Graphic = step.render || null;

  return (
    <div className="mdcc-tour" role="presentation">
      {spot ? (
        <div className="mdcc-tour__spot" style={spot} aria-hidden="true" />
      ) : (
        <div className="mdcc-tour__scrim" aria-hidden="true" />
      )}
      <div
        className={'mdcc-tour__card' + (Graphic ? ' mdcc-tour__card--graphic' : '')}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdcc-tour-title"
        aria-describedby="mdcc-tour-body"
        style={computeCardStyle(rect)}
      >
        <div className="mdcc-tour__step">
          {i + 1} / {steps.length}
        </div>
        {Graphic && (
          <div className="mdcc-tour__graphic">
            <Graphic />
          </div>
        )}
        <div className="mdcc-tour__title" id="mdcc-tour-title">
          {step.title}
        </div>
        <div className="mdcc-tour__body" id="mdcc-tour-body">
          {step.body}
        </div>
        {(needCanvasHint || needSelHint) && (
          <div className="mdcc-tour__hint" role="status" aria-live="polite">
            <span className="mdcc-tour__hint-dot" aria-hidden="true" />
            {needCanvasHint
              ? 'Open any canvas from the sidebar to follow along.'
              : 'Hold ⌘ and click an element in the canvas — the panel fills in live.'}
          </div>
        )}
        <div className="mdcc-tour__actions">
          <button type="button" className="mdcc-tour__skip" onClick={onClose}>
            Skip
          </button>
          <div className="mdcc-tour__nav">
            {i > 0 && (
              <button type="button" className="mdcc-tour__back" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="mdcc-tour__next" data-tour-primary onClick={next}>
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
