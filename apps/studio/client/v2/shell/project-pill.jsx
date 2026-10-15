// client/v2/shell/project-pill.jsx — V2-4.2: the project pill and THE one menu (CONTRACT §1).
//
// The pill (mark + project name, top-left; accessible name "Project menu") opens the menu. The menu
// is `buildProjectMenu()` — PROJECT_MENU (actions/menu.ts) filtered by the registry — so a label,
// a key hint and a disabled state are the registry's, never typed here. A row runs `run(id)`, which
// is the shell's one handler for that action (menu-runner.js) — no second handler.
//
// Keyboard (WAI-ARIA menu): the pill opens with ↵ / Space / ↓; inside, ↑ ↓ move, Home / End jump,
// → or ↵ opens a submenu, ← or esc closes one level, esc on the root returns focus to the pill,
// a letter jumps to the next row starting with it, Tab closes. Every rendered row is reachable.
//
// Island: the pill is a floating `.island` with `data-occludes="top"` (V2-4.1), so Fit leaves room
// for it. The menu is the popover plane: opaque, the largest shadow, no backdrop-filter (M1).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { buildProjectMenu } from './project-menu-model.js';

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The menu rows of one level, in DOM order (the level's own `[role=menu]`, not a nested one). */
function rowsOf(menuEl) {
  return Array.from(menuEl.querySelectorAll(':scope > [role=none] > [role^=menuitem]'));
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
    </svg>
  );
}

function Level({ nodes, depth, trail, openPath, cur, setCur, onRow, onHover, label }) {
  const ref = useRef(null);
  // A submenu that would run off the bottom slides up to fit (the Diagnostics / Help case).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || depth === 0) return;
    el.style.top = '';
    const r = el.getBoundingClientRect();
    const over = r.bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = `${-4 - Math.min(over, Math.max(0, r.top - 8))}px`;
  });
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`st-pm${depth > 0 ? ' st-pm--sub' : ''}`}
      data-testid={depth === 0 ? 'project-menu' : `project-menu-sub-${slug(label)}`}
    >
      {nodes.map((n, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity but position
        if (n.type === 'sep') return <hr key={`s${i}`} className="st-pm-sep" />;
        if (n.type === 'sub') {
          const key = `${trail}/${n.label}`;
          const open = openPath[depth] === n.label;
          return (
            <div role="none" key={key} className="st-pm-li">
              <button
                type="button"
                role="menuitem"
                className={`st-pm-row${n.advanced ? ' st-pm-row--adv' : ''}`}
                tabIndex={cur === key ? 0 : -1}
                aria-haspopup="menu"
                aria-expanded={open}
                data-testid={`project-menu-row-sub-${slug(n.label)}`}
                data-key={key}
                data-sub={n.label}
                onFocus={() => setCur(key)}
                onMouseEnter={(e) => onHover(depth, n.label, e.currentTarget)}
                onClick={() => onRow(depth, n, key)}
              >
                <span className="st-pm-ic" aria-hidden="true" />
                <span className="st-pm-lab">{n.label}</span>
                <span className="st-pm-ch" aria-hidden="true">
                  <StIcon name="chevron-right" size={12} />
                </span>
              </button>
              {open ? (
                <Level
                  nodes={n.children}
                  depth={depth + 1}
                  trail={key}
                  openPath={openPath}
                  cur={cur}
                  setCur={setCur}
                  onRow={onRow}
                  onHover={onHover}
                  label={n.label}
                />
              ) : null}
            </div>
          );
        }
        const key = `${trail}/${n.id}`;
        const check = n.checked !== undefined;
        return (
          <div role="none" key={key} className="st-pm-li">
            {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is menuitemcheckbox whenever aria-checked is set (a dynamic role biome can't follow) */}
            <button
              type="button"
              role={check ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={check ? n.checked : undefined}
              aria-disabled={n.disabled ? 'true' : undefined}
              className="st-pm-row"
              tabIndex={cur === key ? 0 : -1}
              data-testid={`project-menu-row-${n.id}`}
              data-key={key}
              data-action={n.id}
              onFocus={() => setCur(key)}
              onMouseEnter={(e) => onHover(depth, null, e.currentTarget)}
              onClick={() => onRow(depth, n, key)}
            >
              <span className="st-pm-ic" aria-hidden="true">
                {n.checked ? <StIcon name="check" size={13} /> : null}
              </span>
              <span className="st-pm-lab">{n.label}</span>
              {n.keys ? <Kbd>{n.keys}</Kbd> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * @param project the project's name
 * @param canvas the open canvas' name (optional)
 * @param ctx KeyCtx for the registry's predicates (project-menu-model `menuCtx`)
 * @param state `{ panelsHidden, checked }` for labels / ticks
 * @param run (id) => void — the shell's runner
 * @param docked the pill sits on the pinned left column (no island chrome of its own)
 * @param onOpen (opener) => void — called with the element that had focus before the menu opened
 *   (Cut / Paste act on it)
 * @param pillRef optional ref to the pill button
 */
export function ProjectPill({
  project,
  canvas,
  ctx,
  state,
  run,
  docked = false,
  onOpen,
  pillRef: outerRef,
}) {
  const [open, setOpen] = useState(false);
  const [openPath, setOpenPath] = useState([]);
  const [cur, setCur] = useState(null);
  const wrapRef = useRef(null);
  const ownBtn = useRef(null);
  const btnRef = outerRef ?? ownBtn;
  const menuRef = useRef(null);
  const opener = useRef(null);
  const model = useMemo(() => buildProjectMenu(ctx, state), [ctx, state]);

  const close = useCallback(
    (focusPill = true) => {
      setOpen(false);
      setOpenPath([]);
      setCur(null);
      if (focusPill) btnRef.current?.focus();
    },
    [btnRef]
  );

  // What had focus before the menu: a click on the pill does not move focus in Safari, so read it
  // on pointerdown / keydown, before the pill takes it.
  const noteOpener = () => {
    const a = document.activeElement;
    opener.current = a && a !== btnRef.current && a !== document.body ? a : null;
  };

  const openMenu = useCallback(() => {
    onOpen?.(opener.current);
    setOpen(true);
  }, [onOpen]);

  // First row focused on open.
  useEffect(() => {
    if (!open) return;
    const root = menuRef.current?.firstElementChild;
    if (root) rowsOf(root)[0]?.focus();
  }, [open]);

  // Outside pointer / the window losing focus (a click into the canvas iframe) closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) close(false);
    };
    const onBlur = () => close(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, close]);

  const focusFirstOf = (subRow) => {
    // After the submenu mounts: its first row.
    requestAnimationFrame(() => {
      const li = subRow?.parentElement;
      const sub = li?.querySelector(':scope > [role=menu]');
      if (sub) rowsOf(sub)[0]?.focus();
    });
  };

  const onRow = (depth, n, key) => {
    if (n.type === 'sub') {
      setOpenPath((p) => [...p.slice(0, depth), n.label]);
      focusFirstOf(
        Array.from(menuRef.current?.querySelectorAll('[data-key]') ?? []).find(
          (el) => el.getAttribute('data-key') === key
        )
      );
      return;
    }
    if (n.disabled) return;
    close(true);
    run(n.id);
  };

  const onHover = (depth, subLabel, el) => {
    setOpenPath((p) => {
      const next = subLabel ? [...p.slice(0, depth), subLabel] : p.slice(0, depth);
      return next.length === p.length && next.every((x, i) => x === p[i]) ? p : next;
    });
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  };

  const onMenuKey = (e) => {
    const row = e.target.closest?.('[role^=menuitem]');
    const level = row?.closest('[role=menu]');
    if (!row || !level) return;
    const rows = rowsOf(level);
    const i = rows.indexOf(row);
    const go = (j) => {
      e.preventDefault();
      rows[(j + rows.length) % rows.length]?.focus();
    };
    const isSub = row.hasAttribute('data-sub');
    switch (e.key) {
      case 'ArrowDown':
        return go(i + 1);
      case 'ArrowUp':
        return go(i - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(rows.length - 1);
      case 'ArrowRight':
        if (isSub) {
          e.preventDefault();
          row.click();
        }
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        row.click();
        return;
      case 'ArrowLeft':
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        const depth = level.getAttribute('data-testid') === 'project-menu' ? 0 : 1;
        if (depth === 0) {
          if (e.key === 'Escape') close(true);
          return;
        }
        // Close one level: back to the row that opened it.
        const parentRow = level.parentElement?.querySelector(':scope > [role^=menuitem]');
        setOpenPath((p) => p.slice(0, -1));
        parentRow?.focus();
        return;
      }
      case 'Tab':
        close(true);
        return;
      default:
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      const order = [...rows.slice(i + 1), ...rows.slice(0, i + 1)];
      const hit = order.find((r) =>
        r.querySelector('.st-pm-lab')?.textContent?.trim().toLowerCase().startsWith(ch)
      );
      if (hit) {
        e.preventDefault();
        hit.focus();
      }
    }
  };

  return (
    <span
      ref={wrapRef}
      className="st-pill island"
      // Docked on the pinned left column it covers no canvas, so it declares no edge.
      data-occludes={docked ? undefined : 'top'}
      data-open={open ? 'true' : undefined}
      data-docked={docked ? 'true' : undefined}
    >
      <button
        ref={btnRef}
        type="button"
        className="st-pill-btn"
        aria-label="Project menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Project menu"
        data-testid="project-pill"
        onPointerDown={noteOpener}
        onKeyDown={(e) => {
          // ↵ / Space / ↓ open it; handled here (and the synthesized click cancelled) so a key press
          // opens exactly once in every engine.
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) {
            e.preventDefault();
            noteOpener();
            openMenu();
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close(true);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ') e.preventDefault();
        }}
        onClick={() => {
          if (open) close(true);
          else openMenu();
        }}
      >
        <span className="st-pill-mark">
          <Mark />
        </span>
        <span className="st-pill-name">{project || 'maude'}</span>
        {canvas ? (
          <>
            <span className="st-pill-sep" aria-hidden="true">
              /
            </span>
            <span className="st-pill-canvas">{canvas}</span>
          </>
        ) : null}
        <span className="st-pill-caret" aria-hidden="true">
          <StIcon name="chevron-down" size={14} />
        </span>
      </button>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: key events bubble from the menu's rows
        <div ref={menuRef} className="st-pm-root" onKeyDown={onMenuKey}>
          <Level
            nodes={model}
            depth={0}
            trail=""
            openPath={openPath}
            cur={cur}
            setCur={setCur}
            onRow={onRow}
            onHover={onHover}
            label="Project menu"
          />
        </div>
      ) : null}
    </span>
  );
}
