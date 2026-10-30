// client/v2/export/scope-bar.jsx — S8.2: Scope, always on top of the sheet (09 Export `ScopeBar`).
//
// Selection · This canvas · Folder · Whole project, each with its artboard count and "—" when there is
// nothing in it ("00/rule/scope-is-always-visible"). A radio group: ← → move and pick, one tab stop.
// v1 re-emit: `export-scope` (was the Scope <select>) is now this group; its value rides `data-value`
// and each segment is `export-scope-<id>`.

import { countWord, SCOPES, SCOPE_OFF } from './export-copy.js';

/**
 * @param scope       the picked scope id
 * @param counts      { selection, canvas, folder, project } from the estimate (null → "—")
 * @param available   { [scope]: boolean } — a scope that is off keeps its place, greyed
 * @param offReason   { [scope]: string } — why, as the segment's tooltip
 * @param onPick      (scope) => void
 */
export function ScopeBar({ scope, counts, available, offReason = {}, onPick }) {
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = SCOPES.map(([id]) => id).filter((id) => available[id]);
    const at = ids.indexOf(scope);
    if (ids.length === 0) return;
    e.preventDefault();
    const to = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
    onPick(to);
    e.currentTarget.querySelector(`[data-testid="export-scope-${to}"]`)?.focus();
  };
  return (
    <div className="ex-scope">
      <span className="ex-scope-k" id="ex-scope-label">
        Scope
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: a radio group of segments, the design's control */}
      <div
        className="ex-seg ex-scope-seg"
        role="radiogroup"
        aria-labelledby="ex-scope-label"
        data-testid="export-scope"
        data-value={scope}
        onKeyDown={onKey}
      >
        {SCOPES.map(([id, label]) => {
          const on = id === scope;
          const off = !available[id];
          return (
            // biome-ignore lint/a11y/useSemanticElements: see the group
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={off && !on ? true : undefined}
              disabled={off && !on}
              tabIndex={on ? 0 : -1}
              title={off ? (offReason[id] ?? SCOPE_OFF[id]) : undefined}
              className="ex-seg-b"
              data-testid={`export-scope-${id}`}
              data-count={typeof counts?.[id] === 'number' ? counts[id] : undefined}
              onClick={() => onPick(id)}
            >
              {label}
              {counts ? <small>{countWord(counts[id])}</small> : null}
            </button>
          );
        })}
      </div>
      <span className="ex-scope-u">artboards</span>
    </div>
  );
}
