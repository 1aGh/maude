// client/v2/canvases/move-sheet.jsx — S1.2: the "Move to…" list (11 · pn-move). A filter field over the folders
// of the project, indented as they sit; ↑ ↓ choose, ↵ moves, esc closes. The keyboard path of the drag onto a
// folder — the same `moveCanvasReq` answers both.

import { useEffect, useMemo, useRef, useState } from 'react';
import { pathTestIdSlug } from '../../shell/util.js';
import { filterTargets } from './move-model.js';
import { nothingCalled } from './tree-model.js';

export function MoveSheet({ name, targets, onPick, onBack }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const shown = useMemo(() => filterTargets(targets, query), [targets, query]);
  const at = Math.min(active, Math.max(0, shown.length - 1));
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!shown.length) return;
      setActive(
        (i) =>
          (Math.min(i, shown.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) %
          shown.length
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (shown[at]) onPick(shown[at]);
    } else if (e.key === 'ArrowLeft' && !query) {
      e.preventDefault();
      e.stopPropagation();
      onBack?.();
    }
  };
  return (
    <div className="cv-move" data-testid="canvas-move-sheet">
      <div className="st-dd-hd">Move “{name}” to</div>
      <input
        ref={inputRef}
        className="cv-move-filter"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="cv-move-list"
        aria-activedescendant={shown[at] ? `cv-move-${pathTestIdSlug(shown[at].path)}` : undefined}
        aria-label="Find a folder"
        placeholder="Find a folder"
        data-testid="canvas-move-filter"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {/* biome-ignore lint/a11y/useSemanticElements: a filtered listbox beside a combobox field */}
      <div id="cv-move-list" className="cv-move-list" role="listbox" aria-label="Folders">
        {shown.length === 0 ? (
          <p className="cv-move-none" data-testid="canvas-move-none">
            {query.trim() ? nothingCalled(query) : 'No other folders.'}
          </p>
        ) : (
          shown.map((t, i) => {
            const slug = pathTestIdSlug(t.path);
            return (
              <div
                key={t.path}
                id={`cv-move-${slug}`}
                role="option"
                aria-selected={i === at}
                tabIndex={-1}
                className={`st-dd-item cv-move-item${i === at ? ' is-hover' : ''}`}
                data-testid={`canvas-move-target-${slug}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(t)}
                onKeyDown={undefined}
                style={{ paddingLeft: `calc(var(--space-3) + ${t.depth} * var(--space-3))` }}
              >
                <span className="st-dd-lead">{query.trim() ? t.label : t.name}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
