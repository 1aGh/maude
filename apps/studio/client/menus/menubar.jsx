// menus/menubar.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect } from 'react';
import { Kbd, StIcon } from '../shell/icons.jsx';
import { isNativeApp } from '../github.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { basename, displayName } from '../shell/util.js';
import { ExportBadge } from '../export-center.jsx';
import { ACTIONS_BY_ID } from '../../actions/index.ts';
import { V1_MENUBAR } from '../../actions/legacy.ts';
import { runActionMessage } from '../actions/shell-key-handlers.js';

/** V2-2.4 — a dropdown's rows, rendered from the action registry's v1 layout
 *  (actions/legacy.ts `V1_MENUBAR`): label = the action's v1 menu label, the
 *  key chip verbatim, v1's per-menu gating (viewer, desktop-only, canvas-only,
 *  greyed without a canvas / share path). Ids are registry action ids. */
export function v1MenuItems(
  menu,
  { readOnly = false, hasCanvas = false, hasSharePath = false } = {}
) {
  const out = [];
  for (const r of V1_MENUBAR[menu]) {
    if (readOnly && r.viewer === false) continue;
    if (r.canvas && !hasCanvas) continue;
    if (r.native && !isNativeApp()) continue;
    if (r.sep) {
      out.push({ sep: true });
      continue;
    }
    const item = { id: r.id, label: r.label ?? ACTIONS_BY_ID.get(r.id)?.legacy?.menu ?? r.id };
    if (r.kbd !== undefined) item.shortcut = r.kbd;
    if (r.needs === 'canvas') item.disabled = !hasCanvas;
    else if (r.needs === 'share-path') item.disabled = !hasSharePath;
    if (r.tool) item.tool = r.tool;
    out.push(item);
  }
  return out;
}

/** Edit ▸ New artboard rows → the preset `onInsertArtboard` takes. */
const ARTBOARD_PRESET = {
  'artboard.new-desktop': 'desktop',
  'artboard.new-laptop': 'laptop',
  'artboard.new-tablet': 'tablet',
  'artboard.new-mobile': 'mobile',
  'artboard.new-a4': 'print-a4',
  'artboard.new-letter': 'print-letter',
};

// ───────── Menubar (CV-01/CV-08 top chrome) ─────────
//
// Replaces the legacy `.header` action-button toolbar. Mirrors the shared
// Menubar component from .design/ui/Canvas Viewport.html — brand · menus ·
// status. View dropdown is wired to the panels + zoom that exist today;
// Presentation Mode stays phase-tagged until it ships.

export const MENU_NAMES = ['File', 'Edit', 'View', 'Selection', 'Tools', 'Help'];

// Shared close-on-Esc / outside-click effect for the menubar dropdowns.
export function useDropdownClose(onClose) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onDocClick(e) {
      if (!e.target.closest('.st-dropdown, .st-menu')) onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDocClick);
    };
  }, [onClose]);
}

export function ViewDropdown({ panels, onToggle, onClose, onZoom, hasCanvas }) {
  useDropdownClose(onClose);
  return (
    <div className="st-dropdown" role="menu" aria-label="View" style={{ left: 152 }}>
      <div className="st-dd-hd">Panels</div>
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className={'st-dd-item' + (p.checked ? ' is-on' : '')}
          aria-disabled={p.disabled ? 'true' : undefined}
          title={p.hint || undefined}
          onClick={() => {
            // Cloud Phase 27 C2 — a row that states an absence still has
            // somewhere to send you. A disabled item with a `href` opens it
            // instead of doing nothing, which is the difference between "this
            // is not available here" and a dead button.
            if (p.disabled) {
              if (p.href) {
                window.open(p.href, '_blank', 'noopener,noreferrer');
                onClose();
              }
              return;
            }
            onToggle(p.id);
            onClose();
          }}
        >
          <span className="st-dd-lead">
            <span className="st-dd-check">
              {p.checked ? <StIcon name="check" size={13} /> : null}
            </span>
            <span>{p.label}</span>
            {p.phase ? <span className="st-dd-phase">{p.phase}</span> : null}
          </span>
          {p.shortcut ? <Kbd>{p.shortcut}</Kbd> : null}
        </button>
      ))}
      <div className="st-dd-sep" />
      <div className="st-dd-hd">Zoom</div>
      {v1MenuItems('zoom').map((z) => (
        <button
          key={z.label}
          type="button"
          role="menuitem"
          className="st-dd-item"
          aria-disabled={hasCanvas ? undefined : 'true'}
          onClick={() => {
            if (!hasCanvas) return;
            onZoom?.(z.id);
            onClose();
          }}
        >
          <span className="st-dd-lead">
            <span className="st-dd-check" />
            <span>{z.label}</span>
          </span>
          <Kbd>{z.shortcut}</Kbd>
        </button>
      ))}
    </div>
  );
}

// Help dropdown — cheat sheet · deep help · tour · what's new.
// Shared menubar dropdown — File / Edit / Selection / Tools / Help all render
// the identical {id,label,shortcut,sep?,disabled?} list over the same button
// skeleton, differing only in aria-label, left offset, and an optional header.
// (ViewDropdown stays separate — its checkbox/phase/zoom-op rows genuinely
// diverge.) Per the /flow:done simplifier pass — collapsed 5 near-dupes.
export function DropdownMenu({ label, left, header, items, onAction, onClose }) {
  useDropdownClose(onClose);
  return (
    <div className="st-dropdown" role="menu" aria-label={label} style={{ left }}>
      {header ? <div className="st-dd-hd">{header}</div> : null}
      {items.map((it, i) =>
        it.sep ? (
          <div key={'s' + i} className="st-dd-sep" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="st-dd-item"
            aria-disabled={it.disabled ? 'true' : undefined}
            onClick={() => {
              if (it.disabled) return;
              onAction(it.id);
              onClose();
            }}
          >
            <span className="st-dd-lead">
              <span className="st-dd-check" />
              <span>{it.label}</span>
            </span>
            {it.shortcut ? <Kbd>{it.shortcut}</Kbd> : null}
          </button>
        )
      )}
    </div>
  );
}

export function HelpDropdown({ onAction, onClose }) {
  return (
    <DropdownMenu
      label="Help"
      left={320}
      onAction={onAction}
      onClose={onClose}
      // The collab "how sharing works" course (DDR-119), the quick-setup journey
      // and the readiness check (DDR-166 T7) are native, no-terminal concerns —
      // desktop-only rows in the layout.
      items={v1MenuItems('help')}
    />
  );
}

export function SelectionDropdown({ onAction, onClose, readOnly = false }) {
  return (
    <DropdownMenu
      label="Selection"
      left={214}
      onAction={onAction}
      onClose={onClose}
      // Cloud Phase 25 C2 — annotation selection exists to edit/delete
      // annotations; absent for a viewer.
      items={v1MenuItems('selection', { readOnly })}
    />
  );
}

export function ToolsDropdown({ onAction, onClose, readOnly = false }) {
  // Mirrors DEFAULT_TOOLS in apps/studio/use-tool-mode.tsx (the layout row
  // carries the v1 tool id the menu posts). Cloud Phase 25 C2 — a viewer keeps
  // only the navigate/inspect tools (same READ_ONLY_TOOL_IDS the canvas enforces).
  // feature-4 (browse/move split) — Browse is the boot default (mock is alive);
  // Move (V) is the select tool.
  const items = v1MenuItems('tools', { readOnly });
  return (
    <DropdownMenu
      label="Tools"
      left={290}
      header="Tool palette"
      onAction={(id) => onAction(items.find((it) => it.id === id)?.tool)}
      onClose={onClose}
      items={items}
    />
  );
}

// Plan C follow-up — File + Edit menus, previously inert. Both dispatch to real
// shell flows (File) or the in-canvas undo stack / selection bridges (Edit).
export function FileDropdown({ onAction, onClose, hasCanvas, hasSharePath, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer keeps the reads (export, handoff, reload,
  // close); create / assemble / generate / settings are absent. Bare N — the
  // browser reserves ⌘N (New Window) and never delivers it.
  const items = v1MenuItems('file', { readOnly, hasCanvas, hasSharePath });
  return (
    <DropdownMenu label="File" left={40} onAction={onAction} onClose={onClose} items={items} />
  );
}

export function EditDropdown({ onAction, onClose, hasCanvas, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer's Edit menu is selection only; undo/redo,
  // artboard insert and annotation ops are writes. Stage I4 / feature-2-print-
  // artboards T2 — the New artboard rows need an open canvas.
  return (
    <DropdownMenu
      label="Edit"
      left={90}
      onAction={onAction}
      onClose={onClose}
      items={v1MenuItems('edit', { readOnly, hasCanvas })}
    />
  );
}

export function Menubar({
  activePath,
  sharePath,
  onShare,
  project,
  /** `{ dashboardUrl?, projectName }` when this is a cloud tab, else null. */
  // Tri-state (see the note where this value is created): `undefined` until
  // the server config answers, `null` for the desktop, an object for a cloud
  // tab. Defaulting it to `null` here is what re-broke the boot 404 after the
  // call sites were fixed — a default fires on `undefined`, so "not known yet"
  // became "not cloud" one layer further in, invisibly.
  cloud,
  tabsCount,
  openMenu,
  setOpenMenu,
  commentsPanelOpen,
  onToggleComments,
  changesOpen,
  changesCount,
  onToggleChanges,
  onOpenSystem,
  sidebarOpen,
  onToggleSidebar,
  showHidden,
  onToggleShowHidden,
  onOpenHelp,
  onOpenShortcuts,
  onReportBug,
  onStartTour,
  onStartCollabTour,
  annotationsVisible,
  onToggleAnnotations,
  minimapVisible,
  onToggleMinimap,
  zoomCtlVisible,
  onToggleZoomCtl,
  presentMode,
  onTogglePresent,
  printGuidesVisible,
  onTogglePrintGuides,
  postToActiveCanvas,
  onOpenWhatsNew,
  onOpenReadiness,
  onOpenQuickSetup,
  onWatchIntro,
  whatsNewCount,
  exportCenter,
  artboardCount = 0,
  presence = null,
  inspectorOpen,
  inspectorTab,
  onToggleInspector,
  autoOpenInspector,
  onToggleAutoOpenInspector,
  onOpenLayers,
  timelineOpen,
  onToggleTimeline,
  hasComps = false,
  assistantOpen,
  onToggleAssistant,
  assistantBusy,
  assistantUnseen,
  onNewCanvas,
  onAssembleVideo,
  onOpenExport,
  onOpenSettings,
  onOpenGenerate,
  onReload,
  onCloseCanvas,
  onInsertArtboard,
  // Cloud Phase 25 C2 — viewer role: editing entries are absent from every
  // menu, and the stamp says VIEW ONLY so the absence is legible.
  readOnly = false,
}) {
  const isSystem = activePath === SYSTEM_TAB;
  const stamp = isSystem ? 'SYSTEM' : activePath ? 'CANVAS' : 'IDLE';
  const fileLabel = isSystem ? (
    <b>design system</b>
  ) : activePath ? (
    <>
      {activePath.split('/').slice(0, -1).join('/')}/<b>{displayName(basename(activePath))}</b>
    </>
  ) : (
    <span style={{ color: 'var(--u-fg-3)' }}>no canvas open</span>
  );

  // Cloud Phase 27 C1 — ROLE SHAPES WHAT IS OFFERED, NEVER WHAT IS VISIBLE.
  //
  // `inspector` and `layers` used to be on this list and should never have been.
  // Read-only means cannot CHANGE, not cannot SEE: a reviewer needs the
  // structure and the measured values to say anything useful, and hiding them
  // is how a viewer's Maude became a worse Maude rather than a narrower one.
  // What stays hidden is only what genuinely does not exist for this session —
  // the agent chat (`assistant`, which needs a `claude` on the machine the app
  // is running on) and auto-open (a preference for a surface you cannot edit).
  // In the cloud the `assistant` row is the stated-absence row above, so it must
  // NOT be filtered away here — a viewer would then get silence, which is the
  // exact thing C2 forbids.
  const viewerHiddenPanels = new Set(
    cloud ? ['view.inspector-on-select'] : ['ai.chat', 'view.inspector-on-select']
  );
  // V2-2.4 — the rows render from the registry's v1 layout (V1_MENUBAR.view);
  // this map adds each row's live state.
  const noCanvas = !activePath || isSystem;
  const panelState = {
    'view.panels': { checked: sidebarOpen },
    // In a cell this panel is History (the hub already committed the work),
    // so the menu names what it opens rather than an unsaved count there is
    // no way — and no reason — to act on.
    'history.open': {
      label: cloud ? 'History' : changesCount > 0 ? `Changes · ${changesCount} unsaved` : 'Changes',
      checked: changesOpen,
    },
    'view.comments': { checked: commentsPanelOpen },
    'view.hidden-files': { checked: showHidden },
    'view.layers': { checked: inspectorOpen && inspectorTab === 'layers' },
    'view.inspector': { checked: inspectorOpen },
    'view.inspector-on-select': { checked: !!autoOpenInspector },
    // DDR-148 — Timeline (video-comp scrub). Phase-tag hints when the active
    // canvas actually has a comp; the panel itself shows an empty state otherwise.
    'view.timeline-keep-open': { phase: hasComps ? 'video' : undefined, checked: timelineOpen },
    // Phase 31 (DDR-123) — native-only ACP chat sidepanel.
    'ai.chat': isNativeApp()
      ? { checked: assistantOpen }
      : // Cloud Phase 27 C2 — THE AGENT'S ABSENCE IS STATED WHERE THE AGENT
        // WOULD BE. It runs on YOUR `claude` subscription, on YOUR machine
        // (DDR-123), so a browser tab genuinely cannot have it. That is a
        // legitimate difference — but a menu that silently lacks an item its
        // user has seen on the desktop reads as "the cloud one is broken", so
        // the row stays, disabled, saying where to find it. Never a hidden
        // item, never a dead button, never silence.
        cloud
        ? {
            label: 'Assistant — in the desktop app',
            shortcut: '',
            checked: false,
            disabled: true,
            href: 'https://maude.sh/download',
            hint: 'The agent runs on your own Claude subscription, on your own machine.',
          }
        : null,
    'view.annotations': { checked: annotationsVisible },
    'view.minimap': { checked: minimapVisible, disabled: noCanvas },
    'view.zoom-controls': { checked: zoomCtlVisible, disabled: noCanvas },
    'present.canvas': { checked: presentMode, disabled: noCanvas },
    // feature-2-print-artboards T3 — per-canvas persisted (overlays.print in
    // view.json), same lane as the foundation's `guides` key; NOT gated on the
    // active artboard actually being kind="print" (mirrors minimap/zoomctl,
    // which aren't content-gated either — the overlay itself renders nothing
    // for a non-print artboard regardless of this flag).
    'view.print-guides': { checked: printGuidesVisible, disabled: noCanvas },
  };
  const panels = v1MenuItems('view')
    .filter((row) => panelState[row.id] !== null)
    .map((row) => ({ ...row, disabled: false, ...panelState[row.id] }))
    .filter((p) => !readOnly || !viewerHiddenPanels.has(p.id));

  const DROPDOWN_MENUS = ['file', 'edit', 'view', 'selection', 'tools', 'help'];
  function onMenuClick(key) {
    if (DROPDOWN_MENUS.includes(key)) {
      setOpenMenu(openMenu === key ? null : key);
    }
  }

  // Keyboard menubar (native-menu parity): while a dropdown is open, ↑/↓ rove
  // its items, ←/→ switch to the adjacent menu, Home/End jump, Esc returns
  // focus to the trigger (useDropdownClose handles the close itself).
  useEffect(() => {
    if (!openMenu || !DROPDOWN_MENUS.includes(openMenu)) return;
    // Move focus into the menu so ↑/↓ work immediately after a click.
    const t = setTimeout(() => {
      document.querySelector('.st-dropdown [role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }, 0);
    function onKey(e) {
      const items = [
        ...document.querySelectorAll('.st-dropdown [role="menuitem"]:not([aria-disabled="true"])'),
      ];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const cur = DROPDOWN_MENUS.indexOf(openMenu);
        setOpenMenu(DROPDOWN_MENUS[(cur + dir + DROPDOWN_MENUS.length) % DROPDOWN_MENUS.length]);
      } else if (e.key === 'Escape') {
        document.querySelector('.st-menu[aria-expanded="true"]')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu, setOpenMenu]);

  return (
    <header className="st-menubar" aria-label="Application menubar" data-testid="menubar">
      <span className="st-brand" data-tour="brand">
        <span className="st-brand-mark">
          <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true">
            <path
              d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="st-brand-name">maude</span>
      </span>
      {/* Cloud Phase 27 C4 — THE WAY BACK OUT.
          A browser tab has no window title and no app switcher, so a teammate
          who followed a link has nothing telling them which project they are in
          or how to leave it. The desktop gets both for free from the OS; the
          cloud has to say them. This is an ADDITION to the shared client behind
          the same `cloud` flag as C2's agent notice — never a fork of the
          component, which is how the two shells started diverging last time. */}
      {cloud ? (
        <span className="st-cloudback" data-testid="cloud-back">
          {/* Only when there IS somewhere to go back TO. `dashboardUrl` is
              absent on a self-hosted hub (one hub serves one project, so there
              is no dashboard), and a hardcoded fallback here quietly re-created
              the exact bug the server side just stopped: the link is the ONE
              way out this tab offers, and it pointed at cloud.maude.sh. The
              project name below stays either way — a tab must still say which
              project it is showing. */}
          {cloud.dashboardUrl ? (
            <a
              className="st-cloudback-link"
              href={cloud.dashboardUrl}
              title="Back to your projects"
            >
              ← Dashboard
            </a>
          ) : null}
          {cloud.projectName ? (
            <span className="st-cloudback-project" data-testid="cloud-project-name">
              {cloud.projectName}
            </span>
          ) : null}
        </span>
      ) : null}
      <nav className="st-menus" role="menubar" aria-label="Application menus" data-tour="menus">
        {MENU_NAMES.map((name) => {
          const key = name.toLowerCase();
          const hasDropdown = DROPDOWN_MENUS.includes(key);
          const interactive = hasDropdown || key === 'help';
          const open = openMenu === key;
          return (
            <button
              key={key}
              type="button"
              className="st-menu"
              role="menuitem"
              data-testid={`menu-${key}`}
              data-tour={key === 'help' ? 'help' : undefined}
              aria-haspopup={hasDropdown ? 'menu' : undefined}
              aria-expanded={hasDropdown ? open : undefined}
              onClick={() => onMenuClick(key)}
              // F4 — once any menu is open, hovering another trigger switches to
              // it (base-ui menubar behavior). Only among dropdown menus.
              onMouseEnter={() => {
                if (openMenu !== null && hasDropdown) setOpenMenu(key);
              }}
            >
              {name}
            </button>
          );
        })}
      </nav>
      {openMenu === 'file' && (
        <FileDropdown
          readOnly={readOnly}
          hasCanvas={!!activePath}
          hasSharePath={!!sharePath}
          onAction={(id) => {
            if (id === 'canvas.new') onNewCanvas?.();
            else if (id === 'video.assemble') onAssembleVideo?.();
            else if (id === 'export.open') onOpenExport?.('export');
            else if (id === 'share.open') {
              document.querySelector('[data-testid="menu-file"]')?.focus();
              onShare?.();
            } else if (id === 'handoff.open') onOpenExport?.('handoff');
            else if (id === 'ai.generate') onOpenGenerate?.();
            else if (id === 'settings.open') onOpenSettings?.();
            else if (id === 'canvas.reload') onReload?.();
            else if (id === 'canvas.close') onCloseCanvas?.();
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'edit' && (
        <EditDropdown
          readOnly={readOnly}
          hasCanvas={!!activePath && !isSystem}
          onAction={(id) => {
            // V2-2.4 — the canvas runs these on the `run-action` lane (V2-1.3 §5.7).
            if (id === 'edit.undo' || id === 'edit.redo' || id === 'select.none')
              postToActiveCanvas(runActionMessage(id));
            else if (id === 'select.all-annotations') postToActiveCanvas(runActionMessage(id));
            else if (id.startsWith('artboard.new-')) onInsertArtboard?.(ARTBOARD_PRESET[id]);
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'view' && (
        <ViewDropdown
          panels={panels}
          onToggle={(id) => {
            if (id === 'view.panels') onToggleSidebar();
            else if (id === 'history.open') onToggleChanges();
            else if (id === 'view.comments') onToggleComments();
            else if (id === 'view.hidden-files') onToggleShowHidden();
            else if (id === 'view.annotations') onToggleAnnotations();
            else if (id === 'view.inspector') onToggleInspector();
            else if (id === 'view.inspector-on-select') onToggleAutoOpenInspector?.();
            else if (id === 'view.timeline-keep-open') onToggleTimeline?.();
            else if (id === 'ai.chat') onToggleAssistant?.();
            else if (id === 'view.layers') onOpenLayers?.();
            else if (id === 'view.minimap') onToggleMinimap?.();
            else if (id === 'view.zoom-controls') onToggleZoomCtl?.();
            else if (id === 'present.canvas') onTogglePresent?.();
            else if (id === 'view.print-guides') onTogglePrintGuides?.();
          }}
          onZoom={(id) => postToActiveCanvas(runActionMessage(id))}
          hasCanvas={!!activePath && !isSystem}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'selection' && (
        <SelectionDropdown
          readOnly={readOnly}
          onAction={(id) => {
            if (id === 'select.none' || id === 'select.all-annotations')
              postToActiveCanvas(runActionMessage(id));
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'tools' && (
        <ToolsDropdown
          readOnly={readOnly}
          onAction={(tool) => postToActiveCanvas({ dgn: 'tool-set', tool })}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'help' && (
        <HelpDropdown
          onAction={(id) => {
            if (id === 'help.shortcuts') onOpenShortcuts?.();
            else if (id === 'help.guides') onOpenHelp?.();
            else if (id === 'help.report-bug') onReportBug?.();
            else if (id === 'help.tour') onStartTour?.();
            else if (id === 'help.sharing') onStartCollabTour?.();
            else if (id === 'help.setup') onOpenQuickSetup?.();
            else if (id === 'help.ai-readiness') onOpenReadiness?.();
            else if (id === 'help.whats-new') onOpenWhatsNew?.();
            else if (id === 'help.intro') onWatchIntro?.();
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      <div className="st-mb-right" data-tour="status">
        {presence ? <div className="st-presence">{presence}</div> : null}
        {readOnly && (
          <span
            className="st-stamp st-stamp--viewonly"
            data-testid="view-only-stamp"
            data-tip={
              cloud?.user
                ? `${cloud.user} is a viewer on this project — you can browse, comment and export where available. Ask a project owner for edit access, or sign out if that is not the account you meant to use.`
                : 'Your role in this project is viewer — you can browse, comment when available, and export where available. Ask a project owner for edit access.'
            }
          >
            VIEW ONLY
          </span>
        )}
        {/* Cloud Phase 27 C4 — WHO YOU ARE, AND HOW TO STOP BEING THEM.
            A browser tab carries no account identity of its own: the cookie is
            invisible, and the only thing on screen that reflected it was a
            three-word stamp. An owner who read VIEW ONLY had no way to tell
            whether the role was wrong or the ACCOUNT was, and no way to change
            either — the session outlived any fix by up to twelve hours because
            nothing in the studio could end it. This ends it. */}
        {cloud?.user ? (
          <span className="st-cloudwho" data-testid="cloud-account">
            <span
              className="st-cloudwho-email"
              title={cloud.role ? `Signed in as ${cloud.user} — ${cloud.role}` : cloud.user}
            >
              {cloud.user}
            </span>
            {/* A FORM, not a link. Signing out revokes the token server-side,
                so it is a write — and a write behind a GET is one any page can
                force on you from across the internet. */}
            <form method="post" action="/auth/browser/signout" className="st-cloudwho-form">
              <button
                type="submit"
                className="st-cloudwho-out"
                data-testid="cloud-signout"
                title="Sign out of this project"
              >
                Sign out
              </button>
            </form>
          </span>
        ) : null}
        {isNativeApp() && !readOnly && (
          <button
            type="button"
            className="st-assistant"
            data-testid="assistant-toggle"
            data-active={assistantOpen ? 'true' : 'false'}
            data-busy={assistantBusy ? 'true' : 'false'}
            data-unseen={assistantUnseen ? 'true' : 'false'}
            aria-label={`Assistant${assistantBusy ? ' — working' : assistantUnseen ? ' — new reply' : ''}`}
            data-tip="Assistant  ⌘⇧A"
            onClick={onToggleAssistant}
          >
            <StIcon name="sparkle" size={15} />
          </button>
        )}
        <button
          type="button"
          className="st-mb-icon st-share-btn"
          data-testid="share-btn"
          data-tip={sharePath ? 'Share link' : 'Open a canvas to share it'}
          aria-label="Share link"
          disabled={!sharePath}
          onClick={onShare}
        >
          <StIcon name="share" size={15} />
        </button>
        {exportCenter && <ExportBadge center={exportCenter} />}
        <button
          type="button"
          className="st-reportbug"
          data-testid="report-bug-toggle"
          aria-label="Report a bug"
          data-tip="Report a bug"
          onClick={onReportBug}
        >
          <StIcon name="bug" size={15} />
        </button>
        <button
          type="button"
          className="st-whatsnew"
          data-tour="whatsnew"
          data-unseen={whatsNewCount > 0 ? 'true' : 'false'}
          aria-label={`What's new${whatsNewCount > 0 ? ` — ${whatsNewCount} unseen` : ''}`}
          data-tip="What's new"
          onClick={onOpenWhatsNew}
        >
          <StIcon name="megaphone" size={15} />
        </button>
        <span className="st-stamp">{stamp}</span>
        <span className="st-mb-file" title={activePath || ''}>
          {fileLabel}
        </span>
        <span className="st-mb-sep" />
        <span className="st-mb-count" data-tip="Artboards in the open canvas">
          <span className="st-dot" style={{ background: 'var(--accent)' }} />
          {artboardCount} ARTBOARDS
        </span>
        <span className="st-mb-sep" />
        <span className="st-mb-proj">{project || 'maude'}</span>
      </div>
    </header>
  );
}
