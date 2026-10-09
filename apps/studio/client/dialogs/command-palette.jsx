// dialogs/command-palette.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { commandForEnter, matchCommands } from '../command-palette-match.js';
import { Kbd, StIcon } from '../shell/icons.jsx';

// ⌘K command palette — the mockup's signature surface, wired to real shell
// actions (theme, system view, comments, reload, help, what's new, new board).
// Scoped to shell-doable actions only — in-canvas export lives in the iframe.
export function CommandPalette({ open, onClose, actions }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  // Keep the keyboard-active row visible while arrowing through a scrolled list.
  useEffect(() => {
    listRef.current?.querySelector('.st-pal-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const filtered = useMemo(() => matchCommands(actions, q), [q, actions]);
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);
  if (!open) return null;
  const run = (a) => {
    onClose();
    a.run();
  };
  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="st-pal-search">
          <StIcon name="search" size={18} />
          <input
            // biome-ignore lint/a11y/noAutofocus: command palette opens on an explicit ⌘K.
            autoFocus
            placeholder="Type a command or search…"
            value={q}
            aria-label="Command search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = commandForEnter(actions, q, e.currentTarget.value, active);
                if (pick) run(pick);
              }
            }}
          />
          <Kbd>⌘K</Kbd>
        </div>
        <div className="st-pal-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="st-pal-empty">No matching command.</div>
          ) : (
            filtered.map((a, i) => {
              // Emit a group header when the group changes (flat list → grouped
              // display; keyboard nav still indexes across the whole array).
              const header =
                a.group && (i === 0 || filtered[i - 1].group !== a.group) ? (
                  <div className="st-pal-group" key={'g-' + a.group}>
                    {a.group}
                  </div>
                ) : null;
              return (
                <Fragment key={a.id}>
                  {header}
                  <button
                    type="button"
                    className={'st-pal-item' + (i === active ? ' is-active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(a)}
                  >
                    <span className="st-pal-icon">
                      <StIcon name={a.icon} size={15} />
                    </span>
                    <span className="st-pal-label">{a.label}</span>
                    {a.kbd ? (
                      <span className="st-pal-kbd">
                        <Kbd>{a.kbd}</Kbd>
                      </span>
                    ) : null}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
