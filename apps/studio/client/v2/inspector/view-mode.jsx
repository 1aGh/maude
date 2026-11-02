// client/v2/inspector/view-mode.jsx — S2.18 (Gate 0 A10; 14 Editing ed-edge-tereza, ed-edge-ai): the
// inspector's view mode while someone else holds the selection.
//
//   a person holds it   `ed-insp--view`: every value readable (Interaction included), no field opens, and
//                       one line — "Tereza is editing See pricing. You can look; the fields open when they
//                       move on." — with Comment. Advisory: the server never refuses on a person's hold.
//   AI holds it         the same read-only view + "Footer is AI's until it's done · Stop in the AI chat"
//                       (the 409 held-by-ai backstop is the server's, routes/agent.ts).
//   AI holds another    fields stay open; the line "AI is changing Footer in this artboard. Everything
//   object here         else stays yours."
//
// The canvas knows who holds what (its awareness + the shell's `ai-holds`) and reports the selection's
// holds as `hold-view`. In return this file tells the canvas what it can't see for this person's own
// hold: an inspector field has focus, the app has focus, an inspector edit just landed (`hold-intent`).

import { useEffect, useState } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { menuRunner } from '../shell/menu-runner.js';

/** What the inspector shows for a `hold-view` (null = nothing held). Words: CONTRACT §3. */
export function viewModeOf(hold) {
  if (!hold) return { view: false, line: null };
  if (hold.person) {
    return {
      view: true,
      line: {
        tone: 'people',
        text: `${hold.person.name} is editing ${hold.label}. You can look; the fields open when they move on.`,
        comment: true,
      },
    };
  }
  if (hold.ai?.held) {
    return {
      view: true,
      line: {
        tone: 'ai',
        text: `${hold.ai.label} is AI's until it's done${hold.ai.mine ? ' · Stop in the AI chat' : ''}`,
        comment: false,
      },
    };
  }
  if (hold.ai) {
    return {
      view: false,
      line: {
        tone: 'ai',
        text: `AI is changing ${hold.ai.label} in this artboard. Everything else stays yours.`,
        comment: false,
      },
    };
  }
  return { view: false, line: null };
}

/** The active canvas's window (the one `canvas-frame` iframe, client/shell/viewport.jsx). */
function activeCanvasWin() {
  const f =
    typeof document !== 'undefined'
      ? document.querySelector('iframe[data-testid="canvas-frame"]')
      : null;
  return f?.contentWindow ?? null;
}

// The canvas posts `hold-view` ONCE per change (hold-rings.tsx dedupes on the view). The inspector frame
// mounts with the very selection that produced it, so when someone already holds the object ("Tereza
// first, you second", 14 · ed-edge-tereza) the message landed before the frame's listener existed and the
// fields stayed open. The newest `hold-view` is kept from module load (the shell imports this at boot) and
// re-judged at read time against the CURRENT origin and active canvas, so a record from a canvas that is
// no longer active, or from another origin, still reads as nothing.
let lastHoldView = null;
const holdViewSubs = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data?.dgn !== 'hold-view') return;
    lastHoldView = { origin: e.origin, source: e.source, data: e.data };
    for (const fn of holdViewSubs) fn();
  });
}

/** The kept `hold-view`, accepted now (gate + payload), as the inspector reads it; null = nothing held. */
function readHoldView(origin) {
  if (!lastHoldView) return null;
  const m = acceptFromCanvas(lastHoldView, { canvasOrigin: origin, active: activeCanvasWin() });
  if (m?.dgn !== 'hold-view') return null;
  return m.person || m.ai ? { person: m.person, label: m.label, ai: m.ai } : null;
}

/**
 * The selection's holds from the active canvas, and this person's `hold-intent` back to it.
 * `rootRef` = the inspector's root (focus inside it = a field for the selection has focus).
 */
export function useHoldView({ canvasOrigin, rootRef }) {
  const [hold, setHold] = useState(() =>
    typeof window === 'undefined' ? null : readHoldView(canvasOrigin || window.location.origin)
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const origin = canvasOrigin || window.location.origin;
    const onMessage = () => setHold(readHoldView(origin));
    // the one that may have arrived between the first render and this effect
    onMessage();
    let field = false;
    let app = typeof document === 'undefined' || document.hasFocus();
    const send = (gesture) => {
      try {
        activeCanvasWin()?.postMessage(
          gesture
            ? { dgn: 'hold-intent', field, app, gesture: true }
            : { dgn: 'hold-intent', field, app },
          origin
        );
      } catch {
        /* detached */
      }
    };
    const inside = (n) => !!(n && rootRef.current?.contains(n));
    const isField = (n) =>
      inside(n) && n.matches?.('input, select, textarea, [contenteditable="true"]');
    const onFocusIn = (e) => {
      const next = isField(e.target);
      if (next !== field) {
        field = next;
        send(false);
      }
    };
    const onFocusOut = (e) => {
      if (!field || isField(e.relatedTarget)) return;
      field = false;
      send(false);
    };
    const onEdit = (e) => {
      if (isField(e.target)) send(true);
    };
    // the app's focus: the shell's window. Focus moving into the canvas iframe blurs this window but
    // not the app — `document.hasFocus()` stays true then.
    const onAppBlur = () =>
      setTimeout(() => {
        const next = document.hasFocus();
        if (next !== app) {
          app = next;
          send(false);
        }
      }, 0);
    const onAppFocus = () => {
      if (!app) {
        app = true;
        send(false);
      }
    };
    holdViewSubs.add(onMessage);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    window.addEventListener('blur', onAppBlur);
    window.addEventListener('focus', onAppFocus);
    return () => {
      holdViewSubs.delete(onMessage);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
      window.removeEventListener('blur', onAppBlur);
      window.removeEventListener('focus', onAppFocus);
    };
  }, [canvasOrigin, rootRef]);
  return hold;
}

/** The view-mode line (`tone` people / ai) + Comment for a person's hold. */
export function HoldLine({ line }) {
  if (!line) return null;
  return (
    <p
      className={`ed-insp-line ed-insp-line--${line.tone}`}
      data-testid="inspector-hold-line"
      role="status"
    >
      <span className="ed-insp-line-t">{line.text}</span>
      {line.comment ? (
        <button
          type="button"
          className="ed-insp-line-act"
          data-testid="inspector-hold-comment"
          onClick={() => menuRunner.run('tool.comment')}
        >
          Comment
        </button>
      ) : null}
    </p>
  );
}
