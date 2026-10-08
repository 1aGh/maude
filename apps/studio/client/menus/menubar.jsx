// menus/menubar.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect } from 'react';
import { Kbd, StIcon } from '../shell/icons.jsx';
import { isNativeApp } from '../github.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { basename, displayName } from '../shell/util.js';
import { ExportBadge } from '../export-center.jsx';

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
            <span className="st-dd-check">{p.checked ? <StIcon name="check" size={13} /> : null}</span>
            <span>{p.label}</span>
            {p.phase ? <span className="st-dd-phase">{p.phase}</span> : null}
          </span>
          {p.shortcut ? <Kbd>{p.shortcut}</Kbd> : null}
        </button>
      ))}
      <div className="st-dd-sep" />
      <div className="st-dd-hd">Zoom</div>
      {[
        { op: 'in', label: 'Zoom In', shortcut: '⌘ +' },
        { op: 'out', label: 'Zoom Out', shortcut: '⌘ −' },
        { op: 'fit', label: 'Fit to Screen', shortcut: '⌘ 0' },
        { op: 'actual', label: 'Actual Size · 100 %', shortcut: '⌘ 1' },
      ].map((z) => (
        <button
          key={z.label}
          type="button"
          role="menuitem"
          className="st-dd-item"
          aria-disabled={hasCanvas ? undefined : 'true'}
          onClick={() => {
            if (!hasCanvas) return;
            onZoom?.(z.op);
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
      items={[
        { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: '?' },
        { id: 'help', label: 'Help · commands & flows', shortcut: 'F1' },
        { id: 'report-bug', label: 'Report a bug…' },
        { sep: true },
        { id: 'tour', label: 'Take the tour' },
        { id: 'watch-intro', label: 'Watch the intro' },
        // The collab "how sharing works" course teaches the plain-words Save →
        // Publish → Pull cycle — a non-technical, native-app concern. A web-studio
        // dev already knows git, so it's hidden there (DDR-119).
        ...(isNativeApp() ? [{ id: 'collab-tour', label: 'How sharing works' }] : []),
        // DDR-166 plan, Phase 2 (T7) — the quick-setup journey (design system →
        // first canvas → first AI edit) is a native, no-terminal concern same as
        // the two tours above.
        ...(isNativeApp() ? [{ id: 'quick-setup', label: 'Quick setup' }] : []),
        ...(isNativeApp() ? [{ id: 'readiness', label: 'Check AI editing readiness…' }] : []),
        { id: 'whatsnew', label: "What's new" },
      ]}
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
      items={[
        { id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' },
        // Cloud Phase 25 C2 — annotation selection exists to edit/delete
        // annotations; absent for a viewer.
        ...(readOnly
          ? []
          : [{ id: 'select-all-annotations', label: 'Select all annotations', shortcut: '⌘ ⇧ A' }]),
      ]}
    />
  );
}

export function ToolsDropdown({ onAction, onClose, readOnly = false }) {
  // Mirrors DEFAULT_TOOLS in apps/studio/use-tool-mode.tsx — kept in sync by
  // hand because the menubar lives in the dev-server shell (no shared bundle
  // with the canvas iframes). Cloud Phase 25 C2 — a viewer keeps only the
  // navigate/inspect tools (same READ_ONLY_TOOL_IDS the canvas enforces).
  const items = [
    // feature-4 (browse/move split) — Browse is the boot default (mock is
    // alive); Move (V) is the select tool.
    { id: 'browse', label: 'Browse (interact)', shortcut: '' },
    { id: 'move', label: 'Select', shortcut: 'V' },
    { id: 'hand', label: 'Hand', shortcut: 'H' },
    ...(readOnly
      ? []
      : [
          { id: 'comment', label: 'Comment', shortcut: 'C' },
          { id: 'pen', label: 'Pen', shortcut: 'B' },
          { id: 'rect', label: 'Rect', shortcut: 'R' },
          { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
          { id: 'sticky', label: 'Sticky', shortcut: 'N' },
          { id: 'arrow', label: 'Arrow', shortcut: 'A' },
          { id: 'text', label: 'Text', shortcut: 'T' },
          { id: 'eraser', label: 'Eraser', shortcut: 'E' },
        ]),
  ];
  return (
    <DropdownMenu
      label="Tools"
      left={290}
      header="Tool palette"
      onAction={onAction}
      onClose={onClose}
      items={items}
    />
  );
}

// Plan C follow-up — File + Edit menus, previously inert. Both dispatch to real
// shell flows (File) or the in-canvas undo stack / selection bridges (Edit).
export function FileDropdown({ onAction, onClose, hasCanvas, hasSharePath, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer keeps the reads (export, handoff, reload,
  // close); create / assemble / generate / settings are absent.
  const items = readOnly
    ? [
        { id: 'export', label: 'Export…', shortcut: '⇧⌘E' },
        { id: 'share', label: 'Share link…', disabled: !hasSharePath },
        { id: 'handoff', label: 'Handoff to production', shortcut: '⇧⌘H' },
        { sep: true },
        { id: 'reload', label: 'Reload canvas', shortcut: '⌘R', disabled: !hasCanvas },
        { id: 'close', label: 'Close canvas', disabled: !hasCanvas },
      ]
    : [
        // Bare N — the browser reserves ⌘N (New Window) and never delivers it.
        { id: 'new', label: 'New canvas…', shortcut: 'N' },
        // DDR-150 P4 Task 12 — one-click "udělej z toho video" from the clips
        // dropped as reference chips on the active canvas.
        { id: 'assemble', label: 'Assemble dropped clips → video', disabled: !hasCanvas },
        { id: 'export', label: 'Export…', shortcut: '⇧⌘E' },
        { id: 'share', label: 'Share link…', disabled: !hasSharePath },
        { id: 'handoff', label: 'Handoff to production', shortcut: '⇧⌘H' },
        { sep: true },
        // feature-ai-media-generation (DDR-16x) — BYOK generate action + settings.
        { id: 'generate', label: 'Generate with AI…' },
        { id: 'settings', label: 'Settings…', shortcut: '⌘,' },
        { sep: true },
        { id: 'reload', label: 'Reload canvas', shortcut: '⌘R', disabled: !hasCanvas },
        { id: 'close', label: 'Close canvas', disabled: !hasCanvas },
      ];
  return <DropdownMenu label="File" left={40} onAction={onAction} onClose={onClose} items={items} />;
}

export function EditDropdown({ onAction, onClose, hasCanvas, readOnly = false }) {
  // Cloud Phase 25 C2 — a viewer's Edit menu is selection only; undo/redo,
  // artboard insert and annotation ops are writes.
  if (readOnly) {
    return (
      <DropdownMenu
        label="Edit"
        left={90}
        onAction={onAction}
        onClose={onClose}
        items={[{ id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' }]}
      />
    );
  }
  return (
    <DropdownMenu
      label="Edit"
      left={90}
      onAction={onAction}
      onClose={onClose}
      items={[
        { id: 'undo', label: 'Undo', shortcut: '⌘Z' },
        { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z' },
        { sep: true },
        { id: 'deselect-all', label: 'Deselect all', shortcut: 'Esc' },
        { id: 'select-all-annotations', label: 'Select all annotations', shortcut: '⇧⌘A' },
        // Stage I4 — insert an empty artboard from a device-size preset into the
        // active canvas. Only meaningful with a canvas open.
        ...(hasCanvas
          ? [
              { sep: true },
              { id: 'new-artboard:desktop', label: 'New artboard: Desktop' },
              { id: 'new-artboard:laptop', label: 'New artboard: Laptop' },
              { id: 'new-artboard:tablet', label: 'New artboard: Tablet' },
              { id: 'new-artboard:mobile', label: 'New artboard: Mobile' },
              // feature-2-print-artboards T2 — "+ Artboard" quick-insert must
              // set kind="print" + the print prop together (the plan's own
              // gotcha for this task), not just a plain digital-sized board.
              { id: 'new-artboard:print-a4', label: 'New artboard: A4 (print)' },
              { id: 'new-artboard:print-letter', label: 'New artboard: Letter (print)' },
            ]
          : []),
      ]}
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
  const viewerHiddenPanels = new Set(cloud ? ['autoopen'] : ['assistant', 'autoopen']);
  const panels = [
    { id: 'tree', label: 'Project Tree', shortcut: 'T', checked: sidebarOpen, disabled: false },
    {
      id: 'changes',
      // In a cell this panel is History (the hub already committed the work),
      // so the menu names what it opens rather than an unsaved count there is
      // no way — and no reason — to act on.
      label: cloud
        ? 'History'
        : changesCount > 0
          ? `Changes · ${changesCount} unsaved`
          : 'Changes',
      shortcut: '⌘ ⇧ G',
      checked: changesOpen,
      disabled: false,
    },
    {
      id: 'comments',
      label: 'Comments Sidebar',
      shortcut: '⌘ ⇧ M',
      checked: commentsPanelOpen,
      disabled: false,
    },
    {
      id: 'hidden',
      label: 'Show hidden files',
      shortcut: 'H',
      checked: showHidden,
      disabled: false,
    },
    {
      id: 'layers',
      label: 'Layers',
      shortcut: '',
      checked: inspectorOpen && inspectorTab === 'layers',
      disabled: false,
    },
    {
      id: 'inspector',
      label: 'Inspector',
      shortcut: '⌘ ⇧ I',
      checked: inspectorOpen,
      disabled: false,
    },
    {
      id: 'autoopen',
      label: 'Auto-open Inspector on select',
      shortcut: '',
      checked: !!autoOpenInspector,
      disabled: false,
    },
    // DDR-148 — Timeline (video-comp scrub). Phase-tag hints when the active
    // canvas actually has a comp; the panel itself shows an empty state otherwise.
    {
      id: 'timeline',
      label: 'Timeline',
      shortcut: '⌘ ⇧ T',
      phase: hasComps ? 'video' : undefined,
      checked: timelineOpen,
      disabled: false,
    },
    // Phase 31 (DDR-123) — native-only ACP chat sidepanel.
    ...(isNativeApp()
      ? [
          {
            id: 'assistant',
            label: 'Assistant',
            shortcut: '⌘ ⇧ A',
            checked: assistantOpen,
            disabled: false,
          },
        ]
      : // Cloud Phase 27 C2 — THE AGENT'S ABSENCE IS STATED WHERE THE AGENT
        // WOULD BE. It runs on YOUR `claude` subscription, on YOUR machine
        // (DDR-123), so a browser tab genuinely cannot have it. That is a
        // legitimate difference — but a menu that silently lacks an item its
        // user has seen on the desktop reads as "the cloud one is broken", so
        // the row stays, disabled, saying where to find it. Never a hidden
        // item, never a dead button, never silence.
        cloud
        ? [
            {
              id: 'assistant',
              label: 'Assistant — in the desktop app',
              shortcut: '',
              checked: false,
              disabled: true,
              href: 'https://maude.sh/download',
              hint: 'The agent runs on your own Claude subscription, on your own machine.',
            },
          ]
        : []),
    {
      id: 'annotate',
      label: 'Annotations',
      shortcut: '⇧ P',
      checked: annotationsVisible,
      disabled: false,
    },
    {
      id: 'minimap',
      label: 'Minimap',
      shortcut: '',
      checked: minimapVisible,
      disabled: !activePath || isSystem,
    },
    {
      id: 'zoomctl',
      label: 'Zoom controls',
      shortcut: '',
      checked: zoomCtlVisible,
      disabled: !activePath || isSystem,
    },
    {
      id: 'present',
      label: 'Presentation Mode',
      shortcut: '',
      checked: presentMode,
      disabled: !activePath || isSystem,
    },
    // feature-2-print-artboards T3 — per-canvas persisted (overlays.print in
    // view.json), same lane as the foundation's `guides` key; NOT gated on the
    // active artboard actually being kind="print" (mirrors minimap/zoomctl,
    // which aren't content-gated either — the overlay itself renders nothing
    // for a non-print artboard regardless of this flag).
    {
      id: 'print-guides',
      label: 'Show print guides',
      shortcut: '',
      checked: printGuidesVisible,
      disabled: !activePath || isSystem,
    },
  ].filter((p) => !readOnly || !viewerHiddenPanels.has(p.id));

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
      document
        .querySelector('.st-dropdown [role="menuitem"]:not([aria-disabled="true"])')
        ?.focus();
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
    <header
      className="st-menubar"
      aria-label="Application menubar"
      data-testid="menubar"
    >
      <span className="st-brand" data-tour="brand">
        <span className="st-brand-mark">
          <svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg>
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
            if (id === 'new') onNewCanvas?.();
            else if (id === 'assemble') onAssembleVideo?.();
            else if (id === 'export') onOpenExport?.('export');
            else if (id === 'share') { document.querySelector('[data-testid="menu-file"]')?.focus(); onShare?.(); }
            else if (id === 'handoff') onOpenExport?.('handoff');
            else if (id === 'generate') onOpenGenerate?.();
            else if (id === 'settings') onOpenSettings?.();
            else if (id === 'reload') onReload?.();
            else if (id === 'close') onCloseCanvas?.();
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'edit' && (
        <EditDropdown
          readOnly={readOnly}
          hasCanvas={!!activePath && !isSystem}
          onAction={(id) => {
            if (id === 'undo') postToActiveCanvas({ dgn: 'undo' });
            else if (id === 'redo') postToActiveCanvas({ dgn: 'redo' });
            else if (id === 'deselect-all') postToActiveCanvas({ dgn: 'selection-clear' });
            else if (id === 'select-all-annotations')
              postToActiveCanvas({ dgn: 'annotation-select-all' });
            else if (id.startsWith('new-artboard:'))
              onInsertArtboard?.(id.slice('new-artboard:'.length));
          }}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'view' && (
        <ViewDropdown
          panels={panels}
          onToggle={(id) => {
            if (id === 'tree') onToggleSidebar();
            else if (id === 'changes') onToggleChanges();
            else if (id === 'comments') onToggleComments();
            else if (id === 'hidden') onToggleShowHidden();
            else if (id === 'annotate') onToggleAnnotations();
            else if (id === 'inspector') onToggleInspector();
            else if (id === 'autoopen') onToggleAutoOpenInspector?.();
            else if (id === 'timeline') onToggleTimeline?.();
            else if (id === 'assistant') onToggleAssistant?.();
            else if (id === 'layers') onOpenLayers?.();
            else if (id === 'minimap') onToggleMinimap?.();
            else if (id === 'zoomctl') onToggleZoomCtl?.();
            else if (id === 'present') onTogglePresent?.();
            else if (id === 'print-guides') onTogglePrintGuides?.();
          }}
          onZoom={(op) => postToActiveCanvas({ dgn: 'zoom', op })}
          hasCanvas={!!activePath && !isSystem}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === 'selection' && (
        <SelectionDropdown
          readOnly={readOnly}
          onAction={(id) => {
            if (id === 'deselect-all') postToActiveCanvas({ dgn: 'selection-clear' });
            else if (id === 'select-all-annotations')
              postToActiveCanvas({ dgn: 'annotation-select-all' });
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
            if (id === 'shortcuts') onOpenShortcuts?.();
            else if (id === 'help') onOpenHelp?.();
            else if (id === 'report-bug') onReportBug?.();
            else if (id === 'tour') onStartTour?.();
            else if (id === 'collab-tour') onStartCollabTour?.();
            else if (id === 'quick-setup') onOpenQuickSetup?.();
            else if (id === 'readiness') onOpenReadiness?.();
            else if (id === 'whatsnew') onOpenWhatsNew?.();
            else if (id === 'watch-intro') onWatchIntro?.();
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
        <button type="button" className="st-mb-icon st-share-btn" data-testid="share-btn" data-tip={sharePath ? 'Share link' : 'Open a canvas to share it'} aria-label="Share link" disabled={!sharePath} onClick={onShare}><StIcon name="share" size={15} /></button>
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
