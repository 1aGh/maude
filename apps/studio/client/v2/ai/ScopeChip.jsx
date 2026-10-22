// client/v2/ai/ScopeChip.jsx — S5.8 (03 AI Chat `ai-scope`): the composer's one chip. "◆ Whole canvas",
// "◆ Post 1:1", "◆ 3 artboards", "No canvas". Click it to narrow the scope before sending: Whole canvas ·
// the artboard in view · Choose artboards… · — · No canvas — just ask.
//
// The chip is also the v1 context chip (`chat-context-chip`, with its "Remove canvas context from this
// message" ×): the × shows on hover / focus and does what "No canvas — just ask" does.
//
// Presentational: the scope state (choice vs. selection) lives in the caller; this reports `onChoose(scope)`.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { scopeLabel, scopeMenu, scopeNames, scopeTitle, toggleArtboard } from './scope.js';

export function ScopeChip({
  scope,
  artboards = [],
  activeArtboardId = null,
  stale = false,
  onChoose,
  onRemove,
}) {
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const menuId = useId();

  const close = useCallback((refocus) => {
    setOpen(false);
    setChoosing(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  // Outside click and Escape close it; Escape does not travel on to the island (it was spent here).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  // Focus the first row when it opens.
  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector('[role^="menuitem"]');
    first?.focus({ preventScroll: true });
  }, [open]);

  const onMenuKey = (e) => {
    const rows = [...(rootRef.current?.querySelectorAll('[role^="menuitem"]') ?? [])];
    const at = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows[(at + 1) % rows.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rows[(at - 1 + rows.length) % rows.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      rows[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      rows[rows.length - 1]?.focus();
    }
  };

  const none = scope?.kind === 'none';
  const label = scopeLabel(scope, artboards);
  const items = scopeMenu({ scope, artboards, activeArtboardId, choosing });
  const hoverNames =
    scope?.kind === 'artboards' && scope.ids.length > 1 ? scopeNames(scope, artboards) : [];

  return (
    <div
      ref={rootRef}
      className={`ai-scope${none ? ' ai-scope--none' : ''}${stale ? ' ai-scope--stale' : ''}`}
      data-testid="chat-context-chip"
    >
      <button
        ref={btnRef}
        type="button"
        className="ai-scope-chip"
        data-testid="ai-scope-chip"
        data-scope={scope?.kind ?? 'whole'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={
          stale
            ? `${scopeTitle(scope, artboards)} — canvas changed since selection`
            : scopeTitle(scope, artboards)
        }
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {none ? null : (
          <span className="ai-scope-dot" aria-hidden="true">
            ◆
          </span>
        )}
        <span className="ai-scope-text">{label}</span>
        {stale ? (
          <span className="ai-scope-warn" aria-hidden="true">
            ⚠
          </span>
        ) : null}
      </button>
      {!none ? (
        <button
          type="button"
          className="chat-ctx-x ai-scope-x"
          aria-label="Remove canvas context from this message"
          title="Remove canvas context from this message"
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
      {hoverNames.length ? (
        <span className="ai-scope-names" role="tooltip">
          {hoverNames.join(' · ')}
        </span>
      ) : null}
      {open ? (
        <div
          id={menuId}
          className="ai-scope-menu"
          role="menu"
          aria-label="What AI works on"
          data-testid="ai-scope-menu"
          onKeyDown={onMenuKey}
        >
          {choosing ? (
            <>
              {artboards.map((a) => {
                const on = scope?.kind === 'artboards' && scope.ids.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className="ai-scope-item"
                    data-testid={`ai-scope-item-artboard-${a.id}`}
                    onClick={() => onChoose(toggleArtboard(scope, a.id))}
                  >
                    <span className="ai-scope-check" aria-hidden="true">
                      {on ? <StIcon name="check" size={14} /> : null}
                    </span>
                    <span className="ai-scope-item-text">{a.label}</span>
                  </button>
                );
              })}
              <hr className="ai-scope-sep" />
              <button
                type="button"
                role="menuitem"
                className="ai-scope-item"
                data-testid="ai-scope-item-done"
                onClick={() => close(true)}
              >
                <span className="ai-scope-check" aria-hidden="true" />
                <span className="ai-scope-item-text">Done</span>
              </button>
            </>
          ) : (
            items.map((it) =>
              it.sep ? (
                <hr key={it.id} className="ai-scope-sep" />
              ) : it.choose ? (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  className="ai-scope-item"
                  data-testid={`ai-scope-item-${it.id}`}
                  onClick={() => setChoosing(true)}
                >
                  <span className="ai-scope-check" aria-hidden="true">
                    {it.checked ? <StIcon name="check" size={14} /> : null}
                  </span>
                  <span className="ai-scope-item-text">{it.label}</span>
                </button>
              ) : (
                <button
                  key={it.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={it.checked}
                  className="ai-scope-item"
                  data-testid={`ai-scope-item-${it.id}`}
                  onClick={() => {
                    onChoose(it.scope);
                    close(true);
                  }}
                >
                  <span className="ai-scope-check" aria-hidden="true">
                    {it.checked ? <StIcon name="check" size={14} /> : null}
                  </span>
                  <span className="ai-scope-item-text">{it.label}</span>
                </button>
              )
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
