// client/v2/empty/ai-drafting.jsx — rc3-h (#182): an EMPTY canvas reacts the moment a run of yours starts on it.
//
// Before AI writes anything the empty canvas used to keep inviting "Ask AI for a first draft" while the run worked
// — nothing moved for a minute. Now the invitation steps aside for the board's ghost (01 cf-ai-drafting: a dashed
// spark outline, "Mobile — next"): where the first artboard will land, "AI is drafting…" above it, and the AI
// cursor on it (_kit `aiCursor`, the spark arrow). It goes when the run ends, fails or is stopped, and when the real
// artboard lands (the canvas counts one). Shell-side over the canvas pane, like the empty-canvas card it replaces:
// no message into the untrusted canvas, no route.
//
// Decorative (`aria-hidden`): the AI chat's working line + its polite region say the same words to a screen reader.
// Reduced motion: the pulse and the cursor's drift stop; the ghost and the cursor stay.

import { ownRunWorkingOn, TAG_NEEDS_YOU } from '../ai/runs-model.js';
import { SparkGlyph } from './ask-button.jsx';

export const DRAFTING_LABEL = 'AI is drafting…';

const LIVE = new Set(['starting', 'running']);

/**
 * `null`, or what the ghost says. A run of yours is working on THIS canvas (its scope or a lease, or an edit
 * that names it) and the canvas has reported no artboards (`count` 0 — null while it has not said: no flash).
 *
 * @param {{ view: any, activePath: string|null, designRel?: string, count: number|null|undefined,
 *   target?: { file: string, artboard: string, label: string, adding?: boolean } | null }} f
 * @returns {{ label: string, waiting: boolean } | null}
 */
export function draftingPresence(f) {
  if (f.count !== 0 || !f.activePath) return null;
  const designRel = f.designRel || '.design';
  const mine = (f.view?.mine || []).filter((r) => LIVE.has(r?.state) || r?.state === 'needs-you');
  if (!mine.length) return null;
  const named = !!f.target && f.target.file === f.activePath;
  if (!ownRunWorkingOn(f.view, f.activePath, designRel) && !named) return null;
  const working = mine.some((r) => LIVE.has(r.state));
  if (!working) return { label: TAG_NEEDS_YOU, waiting: true };
  const adding =
    named && f.target.adding && f.target.label ? `AI is drawing ${f.target.label}` : null;
  return { label: adding || DRAFTING_LABEL, waiting: false };
}

/** The ghost, the label above it and the AI cursor, centred on the free canvas (`centre`, px from the left). */
export function AiDrafting({ label, centre, waiting = false }) {
  return (
    <div className="es-host" style={{ '--es-cx': `${centre}px` }}>
      <div
        className="es-aid"
        data-testid="ai-drafting"
        data-waiting={waiting ? 'true' : undefined}
        aria-hidden="true"
      >
        <span className="es-aid-l" data-testid="ai-drafting-label">
          <SparkGlyph size={10} />
          {label}
        </span>
        <span className="es-aid-ghost" data-testid="ai-drafting-ghost">
          <i />
          <i />
          <i />
        </span>
        <span className="es-aid-cur" data-testid="ai-drafting-cursor">
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
            <path
              d="M1 1l11 6.2-4.7 1.3L5.6 14z"
              fill="currentColor"
              stroke="var(--bg-0)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          <span className="es-aid-cur-l">AI</span>
        </span>
      </div>
    </div>
  );
}
