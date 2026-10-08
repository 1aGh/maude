/**
 * SPECIMEN — components-toast-menu · maude-v2
 *
 * DEMONSTRATES: (1) THE ONE MENU — rendered from CONTRACT.md §1, which wins over any other
 *   specimen. The project pill (mark + project name, accessible name ends "Project menu")
 *   opens it: Back to Home · File › Edit › View › Help › · Version history ⌥⌘H · Share… ·
 *   Export… ⇧⌘E · Diagnostics › (a submenu: status words, Logs, Reload, Advanced) · Settings… ⌘,
 *   It replaces the six-menu in-app menubar; the native macOS menu stays. Keyboard model:
 *   ↑ ↓ move, Home / End jump, → opens a submenu, ← or esc steps back, esc on the top level
 *   closes and returns focus to the pill. (2) WHERE EVERY FORMER MENUBAR ITEM WENT — a
 *   filterable map, path chips written "Menu › …": nothing removed. (3) Toasts — one at a
 *   time, at most one action; errors stay until you act. (4) The artboard context menu.
 * COMPOSITION: hero = the open menu over a slice of the app, every submenu live; the
 *   migration map with destination filters and a moved/removed tally; a toast playground
 *   above the toolbar with its timing strip; the artboard context menu; right/wrong.
 * COPY VOICE: CONTRACT §3–4 — short everyday labels, glyph shortcuts in macOS order (⌥⇧⌘),
 *   status in words ("Up to date", "Running"). Developer detail (address, process) appears
 *   only inside Diagnostics › Advanced, in mono. The app never says "we".
 * NOTES: menus are the popover plane (--bg-2, --shadow-lg, island edge); toasts are islands.
 *   The spark appears only on AI rows and the AI's toast. Destructive = a word in
 *   --status-error-text, never a filled red row. Glyphs = iconography.tsx GLYPHS, verbatim.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import "./_layout.css";
import "./components-toast-menu.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — copied verbatim from iconography.tsx GLYPHS (16 grid, 1.5 rounded stroke) ── */
const G: Record<string, ReactNode> = {
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  chevron: <path d="M5 6.5l3 3 3-3" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  home: <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />,
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  share: (<><path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" /><path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" /></>),
  export: (<><path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" /><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>),
  file: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M9 2.5v3h3" /></>),
  edit: (<><path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z" /><path d="M3 13.5h10" /></>),
  view: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  help: (<><circle cx="8" cy="8" r="5.75" /><path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" /></>),
  pulse: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" />,
  settings: (<><path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" /><circle cx="8.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></>),
  "panel-right": (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></>),
  done: (<><circle cx="8" cy="8" r="5.75" /><path d="M5.5 8.25l1.75 1.75 3.25-3.75" /></>),
  problem: (<><path d="M8 2.75l5.75 10H2.25z" /><path d="M8 6.75v2.5M8 11h.01" /></>),
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  sticky: (<><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>),
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
  more: (<g className="tm-dots"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>),
};
function Ic({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="tm-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {G[id]}
    </svg>
  );
}

/** Edit toolbar order, left → right (CONTRACT §2). The AI is not a tool here — it is the AI chat panel. */
const TOOLBAR = ["select", "hand", "frame", "shape", "pen", "text", "image", "component", "more"];

/* ─── Menu keyboard model (WAI-ARIA menu) ──────────────────────────────────── */
function ownItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]')).filter(
    (el) => el.closest('[role="menu"]') === menu,
  );
}
function focusFirst(menu: HTMLElement | null) {
  if (menu) ownItems(menu)[0]?.focus();
}
type MenuKeys = { onClose?: () => void; onBack?: () => void; onOpenSub?: (row: HTMLElement) => void };
/** ↑ ↓ move (wrapping) · Home / End · → opens a submenu · ← / esc step back · esc on the top level closes. */
function menuKeyDown(e: KeyboardEvent<HTMLElement>, k: MenuKeys) {
  const items = ownItems(e.currentTarget);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
  else if (e.key === "ArrowRight" && i >= 0 && items[i].getAttribute("aria-haspopup") === "menu" && k.onOpenSub) { e.preventDefault(); k.onOpenSub(items[i]); }
  else if (e.key === "ArrowLeft" && k.onBack) { e.preventDefault(); k.onBack(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (k.onBack ?? k.onClose)?.(); }
}

/* ─── Menu model — CONTRACT §1, exactly ────────────────────────────────────── */
type Tone = "ok" | "warn" | "error";
type Entry =
  | { sep: true }
  | { fold: string; items: Entry[] }
  | { group: string; items: Entry[] }
  | { label: string; keys?: string; check?: boolean; isNew?: boolean; status?: { tone: Tone; word: string }; mono?: string; danger?: boolean };

const SEP: Entry = { sep: true };

const SUBMENUS: Record<string, Entry[]> = {
  File: [
    { label: "New canvas", keys: "⌘N" }, { label: "New project…", keys: "⇧⌘N" }, { label: "Open project…", keys: "⌘O" }, SEP,
    { label: "Duplicate canvas" }, { label: "Rename canvas" }, { label: "Move to…" }, SEP,
    { label: "Import from Figma…" }, { label: "Import a brand…" }, { label: "Assemble clips into a video" }, SEP,
    { label: "Export…", keys: "⇧⌘E" }, { label: "Handoff to production", keys: "⇧⌘H" }, { label: "Close canvas" },
  ],
  Edit: [
    { label: "Undo", keys: "⌘Z" }, { label: "Redo", keys: "⇧⌘Z" }, SEP,
    { label: "Cut", keys: "⌘X" }, { label: "Copy", keys: "⌘C" }, { label: "Paste", keys: "⌘V" }, SEP,
    { label: "Select all", keys: "⌘A" }, { label: "Deselect all", keys: "esc" }, { label: "Select all annotations", keys: "⇧⌘A" }, SEP,
    { fold: "Advanced", items: [
      { group: "New artboard", items: [{ label: "Desktop" }, { label: "Laptop" }, { label: "Tablet" }, { label: "Mobile" }, { label: "A4" }, { label: "Letter" }] },
    ] },
  ],
  View: [
    { label: "Hide panels", keys: "⌘\\" }, { label: "Comments", keys: "⇧⌘M" }, { label: "Annotations", keys: "⇧P", check: true }, { label: "Presentation mode" }, SEP,
    { label: "Zoom in", keys: "⌘+" }, { label: "Zoom out", keys: "⌘−" }, { label: "Zoom to fit", keys: "⌘0" }, { label: "Actual size", keys: "⌘1" }, SEP,
    { fold: "Advanced", items: [
      { label: "Layers as a panel" }, { label: "Inspector", keys: "⇧⌘I" }, { label: "Open inspector on select", check: true }, { label: "Timeline", keys: "⇧⌘T" },
      { label: "Minimap" }, { label: "Zoom controls" }, { label: "Print guides" }, { label: "Hidden files" }, { label: "Pin panels to the side" },
    ] },
  ],
  Help: [
    { label: "Keyboard shortcuts", keys: "?" }, { label: "Help and guides", keys: "F1" }, { label: "What's new", isNew: true }, SEP,
    { label: "Take the tour" }, { label: "Watch the intro" }, { label: "How sharing works" }, SEP,
    { label: "Report a bug…" },
  ],
  Diagnostics: [
    { label: "Sync", status: { tone: "ok", word: "Up to date" } },
    { label: "Server", status: { tone: "ok", word: "Running" } },
    { label: "AI setup", status: { tone: "ok", word: "Ready" } }, SEP,
    { label: "Logs" }, { label: "Reload canvas", keys: "⌘R" }, { label: "Check AI setup again" }, SEP,
    { fold: "Advanced", items: [
      { label: "Address", mono: "localhost:4402" }, { label: "Process", mono: "29598" },
      { label: "Project folder", mono: "~/Studio site" }, { label: "Resync now" }, { label: "Download all" },
    ] },
  ],
};

type Top = { label: string; icon: string; keys?: string; sub?: boolean; isNew?: boolean; settings?: boolean } | { sep: true };
const TOP: Top[] = [
  { label: "Back to Home", icon: "home" }, { sep: true },
  { label: "File", icon: "file", sub: true }, { label: "Edit", icon: "edit", sub: true },
  { label: "View", icon: "view", sub: true }, { label: "Help", icon: "help", sub: true, isNew: true }, { sep: true },
  { label: "Version history", icon: "history", keys: "⌥⌘H" }, { label: "Share…", icon: "share" }, { label: "Export…", icon: "export", keys: "⇧⌘E" }, { sep: true },
  { label: "Diagnostics", icon: "pulse", sub: true }, { label: "Settings…", icon: "settings", keys: "⌘,", settings: true },
];

function NewDot() {
  return <><span className="tm-dot" aria-hidden="true" /><span className="tm-vh"> (new)</span></>;
}

function MenuEntries({ items, initialFold = null }: { items: Entry[]; initialFold?: string | null }) {
  const [openFold, setOpenFold] = useState<string | null>(initialFold);
  return (
    <>
      {items.map((e, i) => {
        if ("sep" in e) return <div className="tm-sep" key={i} role="separator" />;
        if ("group" in e) {
          return (
            <div key={i} role="group" aria-label={e.group} className="tm-group">
              <span className="tm-group-hd" aria-hidden="true">{e.group}</span>
              <MenuEntries items={e.items} />
            </div>
          );
        }
        if ("fold" in e) {
          const open = openFold === e.fold;
          return (
            <div key={i} className="tm-fold">
              <button type="button" role="menuitem" tabIndex={-1} className="row-item tm-item tm-fold-btn" aria-expanded={open} onClick={() => setOpenFold(open ? null : e.fold)}>
                <span className="tm-check" />
                <span className="tm-label">{e.fold}</span>
                <span className={`tm-fold-chev${open ? " is-open" : ""}`}><Ic id="submenu" size={12} /></span>
              </button>
              {open ? <div className="tm-fold-body" role="group" aria-label={e.fold}><MenuEntries items={e.items} /></div> : null}
            </div>
          );
        }
        return (
          <button
            type="button"
            tabIndex={-1}
            className={`row-item tm-item${e.danger ? " is-danger" : ""}`}
            role={e.check !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={e.check !== undefined ? e.check : undefined}
            key={i}
          >
            <span className="tm-check">{e.check ? <Ic id="check" size={14} /> : null}</span>
            <span className="tm-label">{e.label}{e.isNew ? <NewDot /> : null}</span>
            {e.status ? <span className={`tm-status tm-status--${e.status.tone}`}><span className="tm-status-dot" aria-hidden="true" />{e.status.word}</span> : null}
            {e.mono ? <span className="tm-mono mono">{e.mono}</span> : null}
            {e.keys ? <span className="tm-keys">{e.keys}</span> : null}
          </button>
        );
      })}
    </>
  );
}

function SettingsPreview() {
  const [tab, setTab] = useState<"General" | "Connections" | "Advanced">("General");
  const rows: Record<string, [string, string][]> = {
    General: [["Appearance", "Match macOS"], ["Open last project on launch", "On"], ["Language", "English"]],
    Connections: [["AI", "Connected"], ["Figma", "Not connected"], ["Team space", "Studio site"]],
    Advanced: [["Model and effort", "Auto"], ["Provider keys", "2 saved"], ["Hub address", "Custom"]],
  };
  return (
    <div className="tm-settings">
      <p className="tm-settings-t">Settings</p>
      <span className="seg" role="group" aria-label="Settings sections">
        {(["General", "Connections", "Advanced"] as const).map((t) => (
          <button type="button" key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </span>
      <dl className="tm-settings-rows">
        {rows[tab].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className="tm-settings-note">Three sections, down from seven. Opens in its own window — <span className="tm-keys">⌘,</span></p>
    </div>
  );
}

/* ─── Hero: the one menu ─────────────────────────────────────────────────── */
function OneMenu() {
  const [open, setOpen] = useState(true);
  const [sub, setSub] = useState<string>("Diagnostics");
  const [focusSub, setFocusSub] = useState(false);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const [subTop, setSubTop] = useState(0);

  useLayoutEffect(() => {
    const row = rowRefs.current[sub];
    if (row && mainRef.current) setSubTop(row.offsetTop - 4);
  }, [sub, open]);

  useEffect(() => {
    if (focusSub) { focusFirst(subRef.current); setFocusSub(false); }
  }, [focusSub, sub]);

  const isSettings = sub === "Settings…";

  function close() {
    setOpen(false);
    pillRef.current?.focus();
  }
  function openAndFocus() {
    setOpen(true);
    window.requestAnimationFrame(() => focusFirst(mainRef.current));
  }

  return (
    <div className="stage tm-hero">
      <div className="tm-hero-board" aria-hidden="true">
        <span className="tm-hero-img" />
        <strong>Homepage</strong>
        <span>Hero, pricing and footer.</span>
      </div>
      <div className="sticky sticky--lilac tm-hero-st" aria-hidden="true">Mobile first</div>

      <button
        type="button"
        ref={pillRef}
        className="island tm-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="tm-project-menu"
        onClick={(e) => (open ? setOpen(false) : e.detail === 0 ? openAndFocus() : setOpen(true))}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); openAndFocus(); } }}
      >
        <span className="tm-pill-mark" aria-hidden="true"><Mark size={22} title="" /><span className="tm-pill-dot" /></span>
        <span className="tm-pill-name">Studio site</span>
        <span className="tm-pill-sep" aria-hidden="true">/</span>
        <span className="tm-vh">, </span>
        <span className="tm-pill-canvas">Homepage</span>
        <span className="tm-vh">, Project menu, something new in Help</span>
        <Ic id="chevron" size={14} />
      </button>

      <div className="island tm-tr" aria-hidden="true">
        <span className="tm-av tm-av-sky">T</span>
        <span className="tm-av tm-av-green">J</span>
        <span className="btn btn--primary btn--sm tm-share">Share</span>
      </div>

      {open ? (
        <div className="tm-menus">
          <div
            className="tm-menu tm-main"
            id="tm-project-menu"
            role="menu"
            aria-label="Project menu"
            ref={mainRef}
            onKeyDown={(e) => menuKeyDown(e, {
              onClose: close,
              onOpenSub: (row) => { const l = row.dataset.label ?? ""; setSub(l); setFocusSub(true); },
            })}
          >
            <div className="tm-menu-hd" aria-hidden="true">
              <strong>Studio site</strong>
              <span className="tm-saved"><Ic id="check" size={12} /> Saved</span>
            </div>
            {TOP.map((t, i) => {
              if ("sep" in t) return <div className="tm-sep" key={i} role="separator" />;
              const active = sub === t.label && (t.sub || t.settings);
              return (
                <button
                  type="button"
                  key={t.label}
                  data-label={t.label}
                  ref={(el) => { rowRefs.current[t.label] = el; }}
                  className={`row-item tm-item tm-top${active ? " is-open" : ""}`}
                  role="menuitem"
                  tabIndex={i === 0 ? 0 : -1}
                  aria-haspopup={t.sub ? "menu" : undefined}
                  aria-expanded={t.sub ? !!active : undefined}
                  onMouseEnter={() => (t.sub || t.settings) && setSub(t.label)}
                  onFocus={() => (t.sub || t.settings) && setSub(t.label)}
                  onClick={() => { if (t.sub) { setSub(t.label); setFocusSub(true); } }}
                >
                  <span className="tm-top-ic"><Ic id={t.icon} /></span>
                  <span className="tm-label">{t.label}{t.isNew ? <NewDot /> : null}</span>
                  {t.keys ? <span className="tm-keys">{t.keys}</span> : null}
                  {t.sub ? <span className="tm-sub-chev"><Ic id="submenu" size={12} /></span> : null}
                </button>
              );
            })}
            <div className="tm-sep" role="separator" />
            <button type="button" role="menuitem" tabIndex={-1} className="row-item tm-item tm-account">
              <span className="tm-av tm-av-you" aria-hidden="true">Y</span>
              <span className="tm-label">Sign out</span>
              <span className="tm-keys">You</span>
            </button>
          </div>

          {isSettings ? (
            <div className="tm-menu tm-sub" role="group" aria-label="Settings window, preview" style={{ marginTop: subTop }} key="settings">
              <SettingsPreview />
            </div>
          ) : (
            <div
              className="tm-menu tm-sub"
              role="menu"
              aria-label={sub}
              ref={subRef}
              style={{ marginTop: subTop }}
              key={sub}
              onKeyDown={(e) => menuKeyDown(e, { onBack: () => rowRefs.current[sub]?.focus() })}
            >
              <MenuEntries items={SUBMENUS[sub] ?? []} initialFold={sub === "Diagnostics" ? "Advanced" : null} />
            </div>
          )}
        </div>
      ) : null}

      <p className="tm-native">The macOS menu bar keeps its own File, Edit and Help — this menu is the one inside the window. Keys: ↑ ↓ to move, → to open, ← or esc to step back.</p>
    </div>
  );
}

/* ─── Where every menubar item went ─────────────────────────────────────── */
type Dest = "menu" | "keys" | "canvas" | "auto" | "advanced" | "diagnostics";
const DEST: Record<Dest, string> = {
  menu: "Menu",
  keys: "⌘K & keys",
  canvas: "On the canvas",
  auto: "Automatic",
  advanced: "Advanced",
  diagnostics: "Diagnostics",
};
type Moved = { from: string; was: string; to: string; kind: Dest };
const MAP: Moved[] = [
  { from: "File", was: "New canvas…", to: "Menu › File · ⌘N", kind: "menu" },
  { from: "File", was: "Assemble dropped clips → video", to: "Menu › File", kind: "menu" },
  { from: "File", was: "Export…", to: "Menu › Export… · ⇧⌘E", kind: "menu" },
  { from: "File", was: "Share link…", to: "The Share button", kind: "canvas" },
  { from: "File", was: "Handoff to production", to: "Menu › File · ⇧⌘H", kind: "menu" },
  { from: "File", was: "Generate with AI…", to: "AI chat panel · ⌘/", kind: "keys" },
  { from: "File", was: "Settings…", to: "Menu › Settings… · ⌘,", kind: "menu" },
  { from: "File", was: "Reload canvas", to: "Happens by itself · Menu › Diagnostics", kind: "auto" },
  { from: "File", was: "Close canvas", to: "Menu › File", kind: "menu" },
  { from: "Edit", was: "Undo · Redo", to: "Menu › Edit · ⌘Z", kind: "menu" },
  { from: "Edit", was: "Deselect all", to: "esc · Menu › Edit", kind: "keys" },
  { from: "Edit", was: "Select all annotations", to: "Menu › Edit · ⇧⌘A", kind: "menu" },
  { from: "Edit", was: "New artboard presets", to: "Frame tool (F) · Menu › Edit › Advanced", kind: "advanced" },
  { from: "View", was: "Project tree", to: "Canvases panel · ⌘\\", kind: "canvas" },
  { from: "View", was: "Changes", to: "Menu › Version history · ⌥⌘H", kind: "menu" },
  { from: "View", was: "Comments sidebar", to: "Appears when there are comments · ⇧⌘M", kind: "canvas" },
  { from: "View", was: "Show hidden files", to: "Menu › View › Advanced", kind: "advanced" },
  { from: "View", was: "Layers", to: "Menu › View › Advanced", kind: "advanced" },
  { from: "View", was: "Inspector", to: "Appears when you select", kind: "canvas" },
  { from: "View", was: "Auto-open Inspector", to: "On by default · Menu › View › Advanced", kind: "auto" },
  { from: "View", was: "Timeline", to: "Appears with a video artboard", kind: "canvas" },
  { from: "View", was: "Assistant", to: "AI chat panel · ⌘/", kind: "keys" },
  { from: "View", was: "Annotations", to: "Menu › View · ⇧P", kind: "menu" },
  { from: "View", was: "Minimap", to: "Menu › View › Advanced", kind: "advanced" },
  { from: "View", was: "Zoom controls", to: "Menu › View › Advanced", kind: "advanced" },
  { from: "View", was: "Presentation mode", to: "Menu › View", kind: "menu" },
  { from: "View", was: "Show print guides", to: "Menu › View › Advanced", kind: "advanced" },
  { from: "View", was: "Zoom in · out · fit · actual", to: "Menu › View · ⌘0 ⌘1", kind: "menu" },
  { from: "Selection", was: "Deselect all", to: "Merged into Menu › Edit", kind: "menu" },
  { from: "Selection", was: "Select all annotations", to: "Merged into Menu › Edit", kind: "menu" },
  { from: "Tools", was: "Select · Hand · Frame", to: "Edit toolbar · V H F", kind: "canvas" },
  { from: "Tools", was: "Rect · Pen · Text", to: "Edit toolbar · Shape R · Pen P · Text T", kind: "canvas" },
  { from: "Tools", was: "Ellipse", to: "Edit toolbar › More", kind: "canvas" },
  { from: "Tools", was: "Sticky · Comment · Arrow", to: "Preview toolbar · N C A — from Edit too", kind: "canvas" },
  { from: "Tools", was: "Browse", to: "Preview, in the mode switch", kind: "canvas" },
  { from: "Tools", was: "Eraser", to: "Search · ⌘K", kind: "keys" },
  { from: "Help", was: "Keyboard shortcuts", to: "Menu › Help · ?", kind: "keys" },
  { from: "Help", was: "Help · commands & flows", to: "Menu › Help · F1", kind: "menu" },
  { from: "Help", was: "Report a bug…", to: "Menu › Help", kind: "menu" },
  { from: "Help", was: "Take the tour", to: "Hints at your first try · Menu › Help", kind: "menu" },
  { from: "Help", was: "Watch the intro", to: "Menu › Help", kind: "menu" },
  { from: "Help", was: "What's new", to: "A dot on the project pill · Menu › Help", kind: "menu" },
  { from: "Help", was: "How sharing works", to: "Menu › Help", kind: "menu" },
  { from: "Help", was: "Quick setup", to: "Happens by itself · Menu › Help", kind: "auto" },
  { from: "Help", was: "Check AI editing readiness", to: "Happens by itself · Menu › Diagnostics", kind: "diagnostics" },
  { from: "Right side", was: "Presence avatars", to: "Top-right panel", kind: "canvas" },
  { from: "Right side", was: "View-only stamp", to: "The Share button says “View only”", kind: "canvas" },
  { from: "Right side", was: "Account and Sign out", to: "Menu, bottom row", kind: "menu" },
  { from: "Right side", was: "Assistant sparkle", to: "The AI chat panel, hidden to its spark", kind: "canvas" },
  { from: "Right side", was: "Export jobs badge", to: "A toast when it's ready", kind: "auto" },
  { from: "Right side", was: "Mode stamp · file path", to: "Menu › Diagnostics › Advanced", kind: "diagnostics" },
  { from: "Right side", was: "Artboard count", to: "Menu › Diagnostics › Advanced", kind: "diagnostics" },
  { from: "Right side", was: "Live · hub sync chips", to: "Menu › Diagnostics › Sync", kind: "diagnostics" },
  { from: "Right side", was: "Project name", to: "The project pill", kind: "canvas" },
];
const FROM_ORDER = ["File", "Edit", "View", "Selection", "Tools", "Help", "Right side"];

function MigrationMap() {
  const [kind, setKind] = useState<Dest | "all">("all");
  const count = (k: Dest) => MAP.filter((m) => m.kind === k).length;
  const shown = MAP.filter((m) => kind === "all" || m.kind === kind);
  return (
    <div className="tm-map">
      <div className="tm-map-bar">
        <div className="tm-tally">
          <span><strong>{MAP.length}</strong> moved</span>
          <span><strong>0</strong> removed</span>
        </div>
        <div className="tm-filters" role="group" aria-label="Filter by new home">
          <button type="button" className={`chip tm-filter${kind === "all" ? " is-on" : ""}`} aria-pressed={kind === "all"} onClick={() => setKind("all")}>All {MAP.length}</button>
          {(Object.keys(DEST) as Dest[]).map((k) => (
            <button type="button" key={k} className={`chip tm-filter${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              <span className={`tm-kind tm-kind--${k}`} aria-hidden="true" />{DEST[k]} {count(k)}
            </button>
          ))}
        </div>
      </div>
      <div className="tm-map-cols">
        {FROM_ORDER.map((f) => {
          const rows = shown.filter((m) => m.from === f);
          if (!rows.length) return null;
          return (
            <section className="tm-map-col" key={f}>
              <p className="island-title">{f === "Right side" ? "Menubar, right side" : `${f} menu`}</p>
              {rows.map((m) => (
                <div className="tm-map-row" key={m.was}>
                  <span className="tm-was">{m.was}</span>
                  <span className="tm-to"><span className={`tm-kind tm-kind--${m.kind}`} aria-hidden="true" />{m.to}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Toasts ─────────────────────────────────────────────────────────────── */
type ToastKind = "ai" | "version" | "panels" | "export" | "error";
const TOASTS: Record<ToastKind, { icon: ReactNode; msg: ReactNode; action?: string; ms: number | null; name: string }> = {
  ai: { name: "AI finished", icon: <span className="tm-t-ai" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>, msg: "Done — three hero variants are on the canvas. Pick one.", action: "Show me", ms: 6000 },
  version: { name: "Version restored", icon: <span className="tm-t-ic" aria-hidden="true"><Ic id="history" /></span>, msg: "Homepage is back to the 14:02 version.", action: "Undo", ms: 4000 },
  panels: { name: "Panels hidden", icon: <span className="tm-t-ic" aria-hidden="true"><Ic id="panel-right" /></span>, msg: <>Panels hidden. Press <span className="kbd">⌘</span><span className="kbd">\</span> to bring them back.</>, ms: 4000 },
  export: { name: "Export ready", icon: <span className="tm-t-ic tm-t-ok" aria-hidden="true"><Ic id="done" /></span>, msg: "Homepage.png is ready.", action: "Show in Finder", ms: 4000 },
  error: { name: "Couldn't sync", icon: <span className="tm-t-ic tm-t-err" aria-hidden="true"><Ic id="problem" /></span>, msg: "Couldn't sync Pricing. Your changes are safe on this Mac.", action: "Try now", ms: null },
};

function Toast({ k, onAct }: { k: ToastKind; onAct?: () => void }) {
  const t = TOASTS[k];
  return (
    <div className={`island tm-toast${k === "error" ? " is-error" : ""}`} role={k === "error" ? "alert" : "status"}>
      {t.icon}
      <span className="tm-t-msg">{t.msg}</span>
      {t.action ? <button type="button" className="btn btn--sm btn--ghost tm-t-act" onClick={onAct}>{t.action}</button> : null}
    </div>
  );
}

function ToastPlayground() {
  const [cur, setCur] = useState<{ k: ToastKind; n: number } | null>({ k: "ai", n: 0 });
  const timer = useRef<number | null>(null);

  function show(k: ToastKind) {
    if (timer.current) window.clearTimeout(timer.current);
    const n = Date.now();
    setCur({ k, n });
    const ms = TOASTS[k].ms;
    if (ms) timer.current = window.setTimeout(() => setCur((c) => (c && c.n === n ? null : c)), ms);
  }

  return (
    <div className="tm-toasts">
      <div className="stage tm-toast-stage">
        <div className="tm-ts-board" aria-hidden="true"><span className="tm-ts-img" /><span className="tm-ts-img tm-ts-img2" /><span className="tm-ts-img tm-ts-img3" /></div>
        <div className="tm-toast-slot">{cur ? <Toast key={cur.n} k={cur.k} onAct={() => setCur(null)} /> : null}</div>
        <div className="island dock tm-ts-dock" aria-hidden="true">
          {TOOLBAR.map((g, i) => <span className={`icon-btn${i === 0 ? " tm-ts-on" : ""}`} key={g}><Ic id={g} size={18} /></span>)}
        </div>
        <div className="island tm-ts-ai" aria-hidden="true"><Spark size={16} color="var(--spark)" /></div>
      </div>
      <div className="tm-toast-side">
        <p className="island-title">Show a toast</p>
        <div className="tm-toast-btns">
          {(Object.keys(TOASTS) as ToastKind[]).map((k) => (
            <button type="button" key={k} className="btn btn--sm" onClick={() => show(k)}>{TOASTS[k].name}</button>
          ))}
        </div>
        <p className="tm-toast-rule">One at a time — a new toast replaces the last. Above the toolbar, centred, never over your selection. One action at most.</p>
        <div className="tm-timing" role="group" aria-label="How long each toast stays">
          {(Object.keys(TOASTS) as ToastKind[]).map((k) => (
            <div className="tm-timing-row" key={k}>
              <span>{TOASTS[k].name}</span>
              <span className="tm-timing-bar" aria-hidden="true"><span className={`tm-timing-fill${TOASTS[k].ms ? "" : " is-stays"}`} style={{ width: TOASTS[k].ms ? `${(TOASTS[k].ms as number) / 80}%` : "100%" }} /></span>
              <span className="tm-timing-v">{TOASTS[k].ms ? `${(TOASTS[k].ms as number) / 1000} s` : "until you act"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Context menu on an artboard ───────────────────────────────────────── */
const CTX: Entry[] = [
  { label: "Copy", keys: "⌘C" }, { label: "Paste", keys: "⌘V" }, { label: "Duplicate", keys: "⌘D" }, { label: "Rename" }, SEP,
  { label: "Add a comment", keys: "C" }, { label: "Export this artboard…", keys: "⇧⌘E" }, { label: "Copy link to artboard" }, SEP,
  { label: "Bring forward", keys: "⌘]" }, { label: "Send backward", keys: "⌘[" }, { label: "Lock" }, { label: "Hide" }, SEP,
  { fold: "Advanced", items: [{ label: "Copy CSS" }, { label: "Copy element id" }] }, SEP,
  { label: "Delete artboard", keys: "⌫", danger: true },
];

function ContextDemo() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>({ x: 330, y: 118 });
  const [focusMenu, setFocusMenu] = useState(false);
  const boardRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focusMenu && pos) { focusFirst(menuRef.current); setFocusMenu(false); }
  }, [focusMenu, pos]);

  function openAt(x: number, y: number, r: DOMRect) {
    setPos({ x: Math.min(x, r.width - 250), y: Math.min(y, r.height - 500) });
    setFocusMenu(true);
  }
  function onCtx(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    openAt(e.clientX - r.left, e.clientY - r.top, r);
  }
  function openFromBoard() {
    const stage = boardRef.current?.closest(".tm-ctx-stage") as HTMLElement | null;
    const b = boardRef.current;
    if (!stage || !b) return;
    openAt(b.offsetLeft + b.offsetWidth - 40, b.offsetTop + 40, stage.getBoundingClientRect());
  }
  function close() {
    setPos(null);
    boardRef.current?.focus();
  }

  return (
    <div className="stage tm-ctx-stage" onContextMenu={onCtx} onClick={() => setPos(null)}>
      <button
        type="button"
        ref={boardRef}
        className="tm-ctx-board"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={(e) => { e.stopPropagation(); if (pos) setPos(null); else openFromBoard(); }}
        onKeyDown={(e) => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); openFromBoard(); } }}
      >
        <span className="tm-ctx-label">Pricing · <span className="tm-num">1440 × 900</span></span>
        <span className="tm-ctx-art" aria-hidden="true"><span /><span /><span /></span>
      </button>
      <p className="tm-ctx-hint">Right-click anywhere on this canvas, or focus the artboard and press ⇧F10. esc closes.</p>
      {pos ? (
        <div
          className="tm-menu tm-ctx"
          role="menu"
          aria-label="Artboard menu"
          ref={menuRef}
          style={{ left: Math.max(pos.x, 8), top: Math.max(pos.y, 8) }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => menuKeyDown(e, { onClose: close })}
        >
          <button type="button" role="menuitem" tabIndex={-1} className="row-item tm-item tm-ctx-ai">
            <span className="tm-check"><Spark size={12} color="var(--spark)" /></span>
            <span className="tm-label">Ask AI about this artboard</span>
            <span className="tm-keys">⌘/</span>
          </button>
          <div className="tm-sep" role="separator" />
          <MenuEntries items={CTX} />
        </div>
      ) : null}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function ComponentsToastMenu() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Menus & toasts"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>One menu under your project. Toasts that whisper.</h1>
          <p className="lede">
            The six menus that sat across the top are now one, under the project pill — File, Edit,
            View and Help, then Version history, Share, Export, Diagnostics and Settings. Every item from
            the old bar has a home, and the map below shows where. Toasts say one thing, offer one action
            at most, and leave.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Opens from</dt><dd>the project pill, top left</dd></div>
          <div><dt>Written as</dt><dd>Menu › File › Export…</dd></div>
          <div><dt>Former menubar</dt><dd><span className="tm-num">{MAP.length}</span> items moved · 0 removed</dd></div>
          <div><dt>Toasts</dt><dd>one at a time · one action</dd></div>
        </dl>

        <h2 data-no>The one menu<span className="h2-aside">hover, click, or use the arrow keys</span></h2>
        <OneMenu />

        <h2 data-no>Where every menubar item went<span className="h2-aside">filter by its new home</span></h2>
        <MigrationMap />

        <h2 data-no>Toasts<span className="h2-aside">quiet, one at a time, at most one action</span></h2>
        <ToastPlayground />
        <div className="tm-not-toast">
          <span className="tm-pill tm-pill--static island" aria-hidden="true"><span className="tm-pill-mark"><Mark size={20} title="" /><span className="tm-pill-dot" /></span><span className="tm-pill-name">Studio site</span></span>
          <p><strong>Not a toast:</strong> “What's new” is a dot on the project pill, and the tour is a hint at your first try. Nothing pops up just to announce itself.</p>
        </div>

        <h2 data-no>Context menu<span className="h2-aside">right-click an artboard</span></h2>
        <ContextDemo />

        <h2 data-no>Say it once</h2>
        <div className="tm-compare">
          <figure className="tm-case">
            <div className="stage tm-case-stage">
              <Toast k="export" />
            </div>
            <figcaption><strong className="tm-ok">Right</strong> One toast. Names the work, one action, gone in four seconds.</figcaption>
          </figure>
          <figure className="tm-case">
            <div className="stage tm-case-stage tm-wrong" aria-hidden="true">
              <div className="island tm-toast"><span className="tm-t-ai"><Spark size={12} color="var(--spark-fg)" /></span><span className="tm-t-msg">Successfully exported your file!</span></div>
              <div className="island tm-toast"><span className="tm-t-msg mono">SYNC OK · 200 · hub</span></div>
              <div className="island tm-toast"><span className="tm-t-msg">Saved! New version created!</span><span className="btn btn--sm">View</span><span className="btn btn--sm">Undo</span><span className="btn btn--sm">Details</span></div>
            </div>
            <figcaption><strong className="tm-bad">Wrong</strong> A stack of them, exclamation marks, a status code, three buttons — and a spark on something the AI didn't do.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · menus & toasts · renders CONTRACT.md §1</span>
        <span>Nothing deleted, only moved — the native macOS menu stays as it is</span>
      </footer>
    </>
  );
}
