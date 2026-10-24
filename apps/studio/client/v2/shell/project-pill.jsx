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
import { SWITCHER_TRIGGER_TESTID } from '../../panels/RepoBranchSwitcher.jsx';
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

// The DS Mark, lifted verbatim from the kit (.design/ui/v2/_kit.tsx `Mark`, = assets/logos/mark.svg):
// the azure tile (round on three corners, square bottom-right) with the white star. DDR-141 Tier-0 —
// never redrawn, never the AI's spark (that glyph is reserved for the AI, CONTRACT §7).
export function Mark({ size = 22 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill="var(--accent)" />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="var(--accent-fg)" />
    </svg>
  );
}

/**
 * p8-bugs3 #2 (08 ak-print-view, Menu › View › Advanced) — a submenu inside a submenu. The first level scrolls
 * (`overflow-y: auto`, so a tall View never leaves the window), and a panel nested in a scroll box is clipped to it
 * and dragged sideways by every focus: an empty panel with one row showing. So a nested panel leaves the flow:
 * fixed on the window, at the row that opened it (its top level with the row, its left at the row's right edge,
 * flipped to the row's left when the right has no room), kept 8px inside the window.
 */
function placeNested(el) {
  const li = el.parentElement;
  if (!li) return;
  const row = li.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const gap = 8;
  let left = row.right + gap;
  if (left + width > window.innerWidth - gap) left = row.left - gap - width;
  const top = Math.min(row.top - 4, window.innerHeight - gap - height);
  el.style.position = 'fixed';
  el.style.left = `${Math.max(gap, left)}px`;
  el.style.top = `${Math.max(gap, top)}px`;
}

function Level({ nodes, depth, trail, openPath, cur, setCur, onRow, onHover, label, popupTestid }) {
  const ref = useRef(null);
  // A submenu that would run off the bottom slides up to fit (the Diagnostics / Help case).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || depth === 0) return;
    el.style.top = '';
    if (depth >= 2) {
      placeNested(el);
      return;
    }
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
      data-testid={
        depth === 0 ? 'project-menu' : (popupTestid ?? `project-menu-sub-${slug(label)}`)
      }
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
                  popupTestid={n.popupTestid}
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
              data-testid={n.testid ?? `project-menu-row-${n.id}`}
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
              {n.status ? (
                // V2-4.7b: Diagnostics rows say their state in one word (CONTRACT §1), or show a value.
                <span
                  className={`st-pm-status${n.status.mono ? ' st-pm-status--mono' : ''}`}
                  data-tone={n.status.tone}
                  data-testid={`project-menu-status-${n.id}`}
                >
                  {n.status.word}
                </span>
              ) : null}
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
 * @param folded S3.9 — Preview folds the pill to its mark (04 md-preview); the name, canvas and caret
 *   return with the mode. The accessible name and the menu are unchanged.
 * @param onOpen (opener) => void — called with the element that had focus before the menu opened
 *   (Cut / Paste act on it)
 * @param pillRef optional ref to the pill button
 * @param switcher optional `useProjectSwitcher()` result (RepoBranchSwitcher.jsx) — the desktop app's
 *   "Switch project" submenu after the first group (P8 C4: the pill is the project switcher); its rows run
 *   `switcher.run(id)` instead of `run`, and the pill's wrapper carries `repo-switcher-trigger`
 * @param tree optional menu tree (actions/menu.ts node shape) — Home passes its own (home/home-menu.js); a
 *   project leaves it and gets PROJECT_MENU
 */
export function ProjectPill({
  project,
  canvas,
  ctx,
  state,
  run,
  docked = false,
  folded = false,
  onOpen,
  pillRef: outerRef,
  tree,
  switcher,
}) {
  const [open, setOpen] = useState(false);
  const [openPath, setOpenPath] = useState([]);
  const [cur, setCur] = useState(null);
  const wrapRef = useRef(null);
  const ownBtn = useRef(null);
  const btnRef = outerRef ?? ownBtn;
  const menuRef = useRef(null);
  const opener = useRef(null);
  const switchNode = !tree ? (switcher?.node ?? null) : null;
  const model = useMemo(() => {
    const base = buildProjectMenu(ctx, state, tree ? { tree } : undefined);
    if (!switchNode) return base;
    // after the first group (Home), before the four menus
    const at = base.findIndex((n) => n.type === 'sep');
    return at < 0
      ? [...base, { type: 'sep' }, switchNode]
      : [...base.slice(0, at + 1), switchNode, ...base.slice(at + 1)];
  }, [ctx, state, tree, switchNode]);

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
    if (typeof n.id === 'string' && n.id.startsWith('switch:')) switcher?.run(n.id);
    else run(n.id);
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
      data-folded={folded ? 'true' : undefined}
      data-testid={switchNode ? SWITCHER_TRIGGER_TESTID : undefined}
    >
      <button
        ref={btnRef}
        type="button"
        className="st-pill-btn"
        // Label in Name (WCAG 2.5.3): the visible text leads, so voice control ("click e2e-fixture") and a
        // screen reader both get the open project and canvas, then what the control is.
        aria-label={`${project || 'maude'}${canvas ? ` / ${canvas}` : ''}, project menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Project menu"
        data-testid="project-pill"
        // The tours' anchors for "the menus" (usage tour) and "the brand" (the 0.2x What's New tour) —
        // both were on the in-app menubar (V2-4.8a).
        data-tour="menus"
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
        <span className="st-pill-mark" data-tour="brand">
          <Mark />
        </span>
        {folded ? null : (
          <>
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
          </>
        )}
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
      {switcher?.status}
      {switcher?.dialog}
    </span>
  );
}
