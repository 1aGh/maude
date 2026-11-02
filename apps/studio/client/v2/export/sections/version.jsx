// client/v2/export/sections/version.jsx — S8.9: "AI is still changing the artboard" (09 ex-edges, right column).
//
// An AI run's edits are staged and reach the artboard only when its turn ends (V2-1.5), so an export started
// now is always the LAST FINISHED version. While a run of YOURS holds the artboard the sheet says so and asks
// which one you mean — and Export still means export:
//
//   From 14:05    The last finished version. Exports now.          (spec without `wait`)
//   Wait for AI   Exports by itself when AI is done.               (spec `wait:'ai'`, held by exporters/wait-ai.ts)
//
// Another person's AI is mentioned (one line) but not waited on: only this Mac's run registry can say that run
// has ended, so offering a wait the server cannot keep would be a lie.

import { useRef } from 'react';
import { StIcon } from '../../../shell/icons.jsx';
import { actorName, ringsFor } from '../../ai/runs-model.js';
import { Row } from '../parts.jsx';

export const VERSION_ROW = 'Version';
export const VERSION_NOW_SUB = 'The last finished version. Exports now.';
export const VERSION_NOW_NOTIME = 'Last finished version';
export const VERSION_WAIT = 'Wait for AI';
export const VERSION_WAIT_SUB = 'Exports by itself when AI is done.';
export const HANDOFF_NEEDS_EDIT = 'Handoff to production needs Can edit.';
export const aiHint = (label, who = null) =>
  `${who ? `${who}’s AI is` : 'AI is'} changing this artboard right now${label ? ` — “${label}”` : ''}.`;

const pad = (n) => String(n).padStart(2, '0');
/** "14:05" — local 24-hour time of a millisecond timestamp; null when it is not one. */
export function clockTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The title of the "exports now" option: "From 14:05", or the plain words when the time is not known. */
export const versionNowTitle = (lastFinishedAt) => {
  const t = clockTime(lastFinishedAt);
  return t ? `From ${t}` : VERSION_NOW_NOTIME;
};

/**
 * Is an AI run changing what this export reaches?
 *   scope 'selection'  → the picked artboards (else the active one)
 *   scope 'canvas'     → any artboard of the canvas
 *   folder / project   → not artboard-bound: never
 * `view` is `GET /_api/ai/runs` as the runs store keeps it.
 * @returns {{ working: boolean, mine: boolean, label: string | null, who: string | null }}
 */
export function aiOnTarget(
  view,
  { activeCanvas, scope, artboards, activeArtboardId, entryOf } = {}
) {
  const none = { working: false, mine: false, label: null, who: null };
  if (!view || !activeCanvas || (scope !== 'selection' && scope !== 'canvas')) return none;
  const rings = ringsFor(view, { activeCanvas, entryOf });
  const ids =
    scope === 'canvas'
      ? Object.keys(rings)
      : (artboards?.length ? artboards : activeArtboardId ? [activeArtboardId] : []).filter(
          (id) => rings[id]
        );
  if (ids.length === 0) return none;
  const hit = new Set(ids);
  const holds = (keys) => (keys || []).some((k) => hit.has(k.artboard));
  const mineRun = (view.mine || []).find(
    (r) =>
      (r.state === 'running' || r.state === 'starting' || r.state === 'needs-you') &&
      holds(r.leases)
  );
  if (mineRun) return { working: true, mine: true, label: mineRun.label || null, who: null };
  const other = (view.others || []).find((o) => o && o.state !== 'waiting' && holds(o.artboards));
  const first = rings[ids[0]];
  return {
    working: true,
    mine: false,
    label: other?.label || null,
    who: first && first.who !== 'you' ? actorName(first.who) : null,
  };
}

function Option({ on, title, sub, icon, testid, onPick, onKey, refFn }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio group of cards, the design's control
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabIndex={on ? 0 : -1}
      className="ex-opt"
      data-on={on ? 'true' : undefined}
      data-testid={testid}
      ref={refFn}
      onClick={onPick}
      onKeyDown={onKey}
    >
      <span className="ex-radio" data-on={on ? 'true' : undefined} />
      <span className="ex-opt-ic">{icon}</span>
      <span className="ex-opt-t">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}

/**
 * The Version row. `value` is 'now' | 'ai'. Shown only when a run of yours holds the target
 * (`info.working && info.mine`).
 */
export function VersionRow({ info, value, onPick, lastFinishedAt = null }) {
  const refs = useRef({});
  if (!info?.working || !info.mine) return null;
  const move = (e) => {
    if (
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowUp'
    )
      return;
    e.preventDefault();
    const to = value === 'now' ? 'ai' : 'now';
    onPick(to);
    refs.current[to]?.focus();
  };
  return (
    <Row k={VERSION_ROW} top testid="export-row-version">
      {/* biome-ignore lint/a11y/useSemanticElements: see Option */}
      <span
        className="ex-opts"
        role="radiogroup"
        aria-label={VERSION_ROW}
        data-testid="export-version"
        data-value={value}
      >
        <Option
          on={value === 'now'}
          title={versionNowTitle(lastFinishedAt)}
          sub={VERSION_NOW_SUB}
          icon={<StIcon name="reload" size={16} />}
          testid="export-version-now"
          onPick={() => onPick('now')}
          onKey={move}
          refFn={(el) => {
            refs.current.now = el;
          }}
        />
        <Option
          on={value === 'ai'}
          title={VERSION_WAIT}
          sub={VERSION_WAIT_SUB}
          icon={<StIcon name="sparkle" size={14} />}
          testid="export-version-wait"
          onPick={() => onPick('ai')}
          onKey={move}
          refFn={(el) => {
            refs.current.ai = el;
          }}
        />
      </span>
    </Row>
  );
}

/** The line on top while AI is changing the artboard (mine or someone else's). */
export function AiHint({ info }) {
  if (!info?.working) return null;
  return (
    <div className="ex-hint ex-hint--ai" data-testid="export-ai-hint" role="note">
      <span className="ex-hint-ic">
        <StIcon name="sparkle" size={13} />
      </span>
      <span className="ex-hint-t">{aiHint(info.label, info.mine ? null : info.who)}</span>
    </div>
  );
}
