// dialogs/help-modal.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect } from 'react';
import { MDCC_VERSION } from '../shell/constants.js';

// Help modal — hosts the cheatsheet that used to live in the left sidebar.
// Triggered from the menubar's Help item. Esc + backdrop click close it.
export function HelpModal({ open, onClose, onStartTour }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="help-modal-title">
            Help · shortcuts &amp; commands
          </span>
          <span className="sku">MAUDE-DEV-SRV / v{MDCC_VERSION}</span>
          {onStartTour && (
            <button
              type="button"
              className="mdcc-tour__back"
              style={{ marginLeft: 'auto' }}
              onClick={onStartTour}
            >
              ▶ Take the tour
            </button>
          )}
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="help-modal-body">
          <details open>
            <summary>Canvas selection &amp; tools</summary>
            <ul>
              <li>
                <kbd>V</kbd> <span>move tool — Cmd+click to select, Cmd+Shift to multi</span>
              </li>
              <li>
                <kbd>H</kbd> <span>hand tool — bare drag pans (no Space needed)</span>
              </li>
              <li>
                <kbd>C</kbd> <span>comment tool — hover paints, click drops a pin</span>
              </li>
              <li>
                <kbd>⌘</kbd> + hover <span>preview deepest element under cursor</span>
              </li>
              <li>
                <kbd>⌘</kbd> + click <span>select that element (replace)</span>
              </li>
              <li>
                <kbd>⌘⇧</kbd> + click <span>add deepest to selection (multi)</span>
              </li>
              <li>
                right-click <span>context menu (Copy CSS / Fit / Reset...)</span>
              </li>
              <li>
                <kbd>Esc</kbd> in canvas <span>clear selection + close menu</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Annotation tools</summary>
            <ul>
              <li>
                <kbd>B</kbd> <span>pen — freehand stroke</span>
              </li>
              <li>
                <kbd>R</kbd> <span>rectangle — drag to define corners</span>
              </li>
              <li>
                <kbd>O</kbd> <span>ellipse — drag from center outward</span>
              </li>
              <li>
                <kbd>A</kbd> <span>arrow — drag tail → tip</span>
              </li>
              <li>
                <kbd>E</kbd> <span>eraser — click or drag over strokes to remove</span>
              </li>
              <li>
                <kbd>V</kbd> + click stroke <span>select annotation (Shift+click to multi)</span>
              </li>
              <li>
                <kbd>V</kbd> + drag empty <span>marquee-select strokes that overlap</span>
              </li>
              <li>
                double-click rect/ellipse <span>add text inside the shape</span>
              </li>
              <li>
                arrow keys <span>nudge selected annotation 1 unit (Shift = 10)</span>
              </li>
              <li>
                <kbd>Backspace</kbd> <span>delete selected annotations</span>
              </li>
              <li>
                <kbd>⇧P</kbd> <span>presentation — hide annotations for clean screenshot</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Canvas &amp; panels</summary>
            <ul>
              <li>
                click in tree <span>open canvas (replaces the active one)</span>
              </li>
              <li>
                File ▸ Close canvas <span>clear the stage</span>
              </li>
              <li>
                <kbd>⌘R</kbd> <span>reload canvas</span>
              </li>
              <li>
                <kbd>/</kbd> <span>focus search</span>
              </li>
              <li>
                <kbd>⌘⇧M</kbd> <span>comments panel</span>
              </li>
              <li>
                <kbd>⌘⇧I</kbd> <span>inspector</span>
              </li>
              <li>
                <kbd>?</kbd> <span>keyboard-shortcuts cheat sheet</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Slash commands</summary>
            <ul className="cmds">
              <li>
                <code>
                  /design:edit "<i>feedback</i>"
                </code>
                <span>edit + 4-iter multi-axis loop</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --perfect
                </code>
                <span>8-iter polish (4.5/5 aspiration)</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --no-critic
                </code>
                <span>raw edit, skip loop</span>
              </li>
              <li>
                <code>
                  /design:edit "<i>…</i>" --opt-out=<i>scope</i>
                </code>
                <span>override DS scope (palette/aesthetic/full)</span>
              </li>
              <li>
                <code>
                  /design:new "<i>Name</i>" "<i>brief</i>"
                </code>
                <span>scaffold canvas</span>
              </li>
              <li>
                <code>
                  /design:new "<i>…</i>" --opt-out=aesthetic
                </code>
                <span>scaffold off-system canvas (gradients/radii/type free)</span>
              </li>
              <li>
                <code>/design:critic</code>
                <span>review panel (routed)</span>
              </li>
              <li>
                <code>/design:critic --all</code>
                <span>10-critic sweep</span>
              </li>
              <li>
                <code>/design:critic --agent signature-moment-critic</code>
                <span>aspiration axis only</span>
              </li>
              <li>
                <code>/design:rollback</code>
                <span>undo last edit</span>
              </li>
              <li>
                <code>/design:screenshot</code>
                <span>capture canvas</span>
              </li>
              <li>
                <code>/design:setup-docs</code>
                <span>refresh README + INDEX</span>
              </li>
              <li>
                <code>/design:handoff</code>
                <span>migrate to apps/</span>
              </li>
            </ul>
          </details>
          <details>
            <summary>Opt-out scope</summary>
            <ul>
              <li>
                <strong>palette</strong>{' '}
                <span>
                  default — tokens + rootClass kept; local namespace overrides colors only. DS
                  aesthetic still enforced.
                </span>
              </li>
              <li>
                <strong>aesthetic</strong>{' '}
                <span>
                  palette + gradients/off-ladder radii/alt type/decorative SVG flags allowed.
                </span>
              </li>
              <li>
                <strong>full</strong>{' '}
                <span>DS treated as advisory. Type/radii/aesthetic up to canvas.</span>
              </li>
              <li>
                <em>A11y enforced at every scope</em>{' '}
                <span>contrast, focus, semantics, motion, touch targets — never relaxed.</span>
              </li>
              <li>
                Persisted on canvas's <code>.meta.json</code> <code>opt_out_scope</code> field —
                subsequent <code>/design:edit</code> iterations inherit.
              </li>
              <li>
                Inferred from brief ("modern", "vibrant", "off-system") with one-shot
                AskUserQuestion before iter-1 critics fire.
              </li>
            </ul>
          </details>
          <details>
            <summary>Auto-critic loop</summary>
            <ul>
              <li>
                <strong>Default</strong>{' '}
                <span>4 iter · aspiration ≥ 4.0 · stable-but-bland exit</span>
              </li>
              <li>
                <strong>--perfect</strong>{' '}
                <span>8 iter · aspiration ≥ 4.5 · broader divergence tolerance</span>
              </li>
              <li>
                <strong>--perfect --all</strong>{' '}
                <span>every critic incl. aspiration · portfolio-grade</span>
              </li>
              <li>
                Exit: <code>solid</code> · <code>stable-but-bland</code> · <code>max-reached</code>{' '}
                · <code>divergent</code>
              </li>
              <li>
                <em>stable-but-bland</em> = correctness clean, aspiration plateau — surface for
                review with lowest 2 axes named
              </li>
              <li>
                When <code>opt_out_scope ∈ &#123;aesthetic, full&#125;</code>: iter-1 checkpoint
                fires — pick (a) run loop, (b) skip auto-loop and review iter 1, (c) a11y-only
                check.
              </li>
            </ul>
          </details>
          <details>
            <summary>Pin-to-element flow</summary>
            <ol>
              <li>Open a canvas</li>
              <li>
                <kbd>⌘</kbd>+click element
              </li>
              <li>Status bar shows ● selector</li>
              <li>
                Run{' '}
                <code>
                  /design:edit "<i>change just this</i>"
                </code>
              </li>
              <li>
                Reload iframe (<kbd>⌘R</kbd>)
              </li>
            </ol>
          </details>
          <details>
            <summary>Comments</summary>
            <ol>
              <li>
                <kbd>⌘</kbd>+click element, then <kbd>⌘C</kbd> <span>or ⌘⇧+click</span>
              </li>
              <li>Numbered pin appears on canvas</li>
              <li>
                <kbd>⌘⇧M</kbd> <span>opens panel — All / Open / Resolved</span>
              </li>
              <li>
                Click row in panel <span>jumps to that file + pin</span>
              </li>
              <li>
                Claude reads <code>_comments/&lt;slug&gt;.json</code> on next <code>/design</code>
              </li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}
