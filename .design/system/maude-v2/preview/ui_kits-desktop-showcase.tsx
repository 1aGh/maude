/**
 * SPECIMEN — ui_kits-desktop-showcase · maude-v2
 *
 * DEMONSTRATES: every maude-v2 token and component composed into Maude Desktop v2 — the Tier-0
 *   prior every later v2 screen lifts its shell from. The canvas is the whole window; the chrome
 *   is frosted .island pieces (called "panels" in UI copy) that float over it and fold into one icon
 *   each (⌘\ hides them all). --accent = selection + the one primary action · --spark = the AI only
 *   (its cursor, its panel, its send) · --object-* = what is ON the canvas (artboard content,
 *   stickies, people's cursors). Words, keys and the menu tree follow CONTRACT.md — it wins.
 * COMPOSITION: macOS window frames (traffic lights + native project tabs in the title bar, each tab
 *   carrying the account it works as) stacked down the page, one screen each:
 *     1. Canvas workspace — LIVE: click an artboard, press ⌘\ or ⌘K, open the project pill,
 *        name the parts (on by default, so the numbered legend always has pins to match).
 *     1b. Two toolbars, one per mode (CONTRACT §2) — Edit (tools that make things inside artboards,
 *        More open) beside Preview (annotation only, Sticky in hand).
 *     2. Panels hidden — the signature moment, full height: every panel folded into its icon, the
 *        note centred above the folded toolbar, then a three-step strip of the fold itself
 *        (open → folding with a ghost outline → icon only) on --dur-panel · --ease-out.
 *     3. Something selected — the inspector arrives on the right; the view pans + scales so the
 *        Pricing artboard and the AI's tag stay clear of it.
 *     4. Home — "What shall we make?", starters, recent canvases and projects. No setup steps.
 *     5. The one menu — the canonical tree from CONTRACT.md §1, Diagnostics open; a strip shows
 *        where the old six-menu bar and the status cluster went ("Menu › …" chips).
 *     6. Search (⌘K) over the canvas — finds a canvas and a hidden tool in one search.
 *     7. Project tabs up close (pins in one row above, on leaders) · 8. the shell's rules.
 * COPY VOICE: quiet pro with a warm touch — the user's canvases ("Homepage", "Pricing"), projects
 *   ("Studio site", "Alligators brand") and people (Tereza, Jonas). The app never says "we" or "I";
 *   the only "we" is the Home question (you + AI). No ports, paths, branches, status stamps or slash
 *   commands in the default view — only inside Menu › Diagnostics › Advanced and an inspector's
 *   Advanced row, in mono.
 * WHEN SCAFFOLDED: platform-desktop. Reference: platform-desktop/ui_kits-desktop-showcase.html —
 *   its docked nav + sidebar + status bar is deliberately REPLACED: chrome floats, never frames.
 * NOTES:
 *   - Lifted, not reinvented: the icon family (iconography), Mark + Spark (_specimen-controls),
 *     the cursor shape + people colours (colors-presence), card thumbnails (components-cards),
 *     Home (empty-state), the palette (components-command-palette), the menu model
 *     (CONTRACT.md / components-toast-menu), the Advanced row (components-toggles), the fold (motion).
 *   - A11Y: static figures are role="img" + inert (no tab stops); only the live hero and its
 *     controls are reachable. Accessible names start with the visible text (2.5.3).
 *   - ANIMATION SAFETY: panels fold toward their own icon on transform + opacity only
 *     (--dur-panel · --ease-out); the AI cursor's tag breathes on the shared, slow .motion-soft
 *     role class (stops under reduced motion) — the only loop on the page. Every window body clips.
 *   - RELATIVE-URL SAFETY: no assets — every icon, thumbnail and artboard is inline SVG / CSS.
 */
import { useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import "./_layout.css";
import "./ui_kits-desktop-showcase.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — the maude-v2 family (16 grid, 1.5 rounded stroke), lifted from iconography ── */
const GLYPH: Record<string, ReactNode> = {
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  sticky: (<><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
  line: <path d="M3 13L13 3" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  polygon: <path d="M8 2.25l5.5 4-2.1 6.5H4.6l-2.1-6.5z" />,
  crop: <path d="M4.5 1.75v9.75h9.75M1.75 4.5h9.75v9.75" />,
  slice: (<><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2 2" /><path d="M5.5 10.5l5-5" /></>),
  marker: (<><path d="M10.75 2.75l2.5 2.5-6 6-2.5-2.5z" /><path d="M4.75 8.75L3 13l4.25-1.75" /></>),
  arrow: <path d="M3 13L13 3M7.5 3H13v5.5" />,
  stamp: (<><circle className="sc-stamp-disc" cx="8" cy="8" r="5.75" /><path d="M5.6 9.4a2.9 2.9 0 0 0 4.8 0" /><path d="M6.1 6.4h.01M9.9 6.4h.01" strokeWidth={2} /></>),
  section: (<><path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" /><path d="M5.5 6h5" /></>),
  more: (<g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.15" /><circle cx="8" cy="8" r="1.15" /><circle cx="12.5" cy="8" r="1.15" /></g>),
  share: (<><path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" /><path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" /></>),
  "panel-left": (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M6 3v10" /></>),
  "panel-right": (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></>),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  "chevron-r": <path d="M6.25 4.5L9.75 8l-3.5 3.5" />,
  search: (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>),
  home: <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />,
  layers: <path d="M8 2.5l5.5 3.25L8 9 2.5 5.75zM2.5 9.25L8 12.5l5.5-3.25" />,
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  export: (<><path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" /><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>),
  settings: (<><path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" /><circle cx="8.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></>),
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  undo: <path d="M6 3.5L3 6.5l3 3M3 6.5h6.25a3.75 3.75 0 0 1 0 7.5H7.5" />,
  redo: <path d="M10 3.5l3 3-3 3M13 6.5H6.75a3.75 3.75 0 0 0 0 7.5H8.5" />,
  file: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M9 2.5v3h3" /></>),
  edit: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  view: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  help: (<><circle cx="8" cy="8" r="5.75" /><path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" /></>),
  pulse: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" />,
  sync: <path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3" />,
  print: (<><path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" /><path d="M4.5 9.5h7v4h-7z" /></>),
  server: (<><rect x="2.5" y="2.75" width="11" height="4.25" rx="1.5" /><rect x="2.5" y="9" width="11" height="4.25" rx="1.5" /><path d="M5 4.9h.01M5 11.1h.01" /></>),
  folder: <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5L8 4.5h4A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z" />,
  corner: <path d="M3.5 12.5V8a4.5 4.5 0 0 1 4.5-4.5h4.5" />,
  cloud: <path d="M4.75 12.5a2.75 2.75 0 0 1-.4-5.47A3.75 3.75 0 0 1 11.6 6a3.25 3.25 0 0 1 .15 6.5zM6.25 9.5l1.25 1.25 2.25-2.5" />,
};

function Ic({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="sc-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPH[id]}
    </svg>
  );
}

/** Text only a screen reader hears — used to finish an accessible name after the visible words. */
function Vh({ children }: { children: ReactNode }) {
  return <span className="sc-vh">{children}</span>;
}

/** A person's or an account's initial — people wear the canvas palette (colors-presence rule). */
function Av({ ini, tone, size = "md" }: { ini: string; tone: string; size?: "sm" | "md" }) {
  return <span className={`sc-av sc-av--${tone} sc-av--${size}`} aria-hidden="true">{ini}</span>;
}

/** The cursor shape from colors-presence: people get an ink edge, the agent a paper edge. */
function Cursor({ color }: { color: string }) {
  const edge = color === "var(--presence-agent)" ? "var(--bg-2)" : "var(--object-ink)";
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={color} stroke={edge} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

type Art = "home" | "price" | "onb" | "mobile" | "brand" | "board";
/** What is on a canvas, drawn small (components-cards) — the only place a card carries colour. */
function Thumb({ art, className = "" }: { art: Art; className?: string }) {
  return (
    <span className={`sc-thumb sc-art--${art} ${className}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

/** Numbered marker that sits on the part it names (the one numbering style on this page). */
function Pin({ n, show, className = "" }: { n: number; show: boolean; className?: string }) {
  if (!show) return null;
  return <span className={`sc-pin ${className}`} aria-hidden="true">{n}</span>;
}

/* ─── The window: traffic lights + native project tabs (one window tab per project) ──
   A live window is a labelled group; every static one is a picture (role="img") whose contents
   are inert, so a mock never adds tab stops or duplicate landmarks. */
type Tab = { id: string; name: string; ini?: string; tone?: string; home?: boolean };
const TAB_STUDIO: Tab = { id: "studio", name: "Studio site", ini: "M", tone: "yellow" };
const TAB_ALLIG: Tab = { id: "allig", name: "Alligators brand", ini: "A", tone: "lilac" };
const TAB_HOME: Tab = { id: "home", name: "Home", home: true };
const WORK_TABS = [TAB_STUDIO, TAB_ALLIG];

function MacWindow({ tabs, active, height, label, live = false, children }: { tabs: Tab[]; active: string; height: number; label: string; live?: boolean; children: ReactNode }) {
  return (
    <div className="sc-window" role={live ? "group" : "img"} aria-label={label}>
      <div className="sc-titlebar" inert={!live}>
        <span className="sc-lights" aria-hidden="true"><i /><i /><i /></span>
        <nav className="sc-tabs" aria-label="Project tabs">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <span key={t.id} className="sc-tab" aria-current={on ? "page" : undefined}>
                {on ? <span className="sc-tab-x" aria-hidden="true"><Ic id="close" size={10} /></span> : null}
                {t.home ? <span className="sc-tab-home"><Ic id="home" size={13} /></span> : <Av ini={t.ini ?? ""} tone={t.tone ?? "sky"} size="sm" />}
                <span className="sc-tab-name">{t.name}</span>
              </span>
            );
          })}
        </nav>
        <button className="sc-tab-add" type="button" aria-label="New project tab"><Ic id="plus" size={13} /></button>
      </div>
      <div className="sc-body" style={{ height }} inert={!live}>{children}</div>
    </div>
  );
}

/* ─── The canvas world — a 1056-wide slice, centred so panels can pin to the edges ── */
type Sel = "home" | null;
/** While the inspector is open the view pans + scales so Pricing and the AI's tag end ≥ --space-4
    before it (inspector left edge = window − 268 px). Same camera live and static. */
const SEL_ZOOM = 86;
const SEL_CAM = `translate(-44px, 8px) scale(${SEL_ZOOM / 100})`;

function World({ sel, onSelect, cam, pins = false, dim = false }: { sel: Sel; onSelect?: (s: Sel) => void; cam?: string; pins?: boolean; dim?: boolean }) {
  const live = !!onSelect;
  const pick = (s: Sel) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(s);
  };
  const keyPick = (s: Sel) => (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(s);
    }
  };
  const selected = sel === "home";
  return (
    <div className={`sc-world${dim ? " is-dim" : ""}`} style={cam ? { transform: cam } : undefined} onClick={live ? () => onSelect?.(null) : undefined}>
      {/* Homepage artboard — its name label turns into the selection label (one element, one name). */}
      <div
        className="sc-ab sc-ab--home"
        data-selected={selected ? "true" : undefined}
        {...(live ? { role: "button", tabIndex: 0, "aria-pressed": selected, onClick: pick("home"), onKeyDown: keyPick("home") } : {})}
      >
        <span className="sc-ab-name">
          Homepage{selected ? <span className="sc-ab-size"> · 1440 × 1600</span> : null}
          {live ? <Vh>, artboard</Vh> : null}
        </span>
        <div className="sc-ab-page" aria-hidden="true">
          <div className="sc-hp-nav"><b /><i /><i /><i /></div>
          <div className="sc-hp-hero"><span className="sc-hp-sun" /><span className="sc-hp-hill" /></div>
          <div className="sc-hp-copy">
            <strong>Calm software, made in Brno.</strong>
            <span>A small studio for product and brand.</span>
            <em>See the work</em>
          </div>
          <div className="sc-hp-tiles"><i /><i /><i /></div>
        </div>
        {selected ? <span className="sc-sel" aria-hidden="true"><i /><i /><i /><i /></span> : null}
      </div>

      {/* Pricing artboard — AI is drawing its footer */}
      <div className="sc-ab sc-ab--price">
        <span className="sc-ab-name">Pricing</span>
        <div className="sc-ab-page" aria-hidden="true">
          <div className="sc-pr-head"><strong>Simple pricing</strong><span>Monthly · Yearly</span></div>
          <div className="sc-pr-plans">
            <span className="sc-pr-plan sc-pr-plan--a"><b>Solo</b><i /><i /></span>
            <span className="sc-pr-plan sc-pr-plan--b"><b>Studio</b><i /><i /><i /></span>
            <span className="sc-pr-plan sc-pr-plan--c"><b>Team</b><i /><i /></span>
          </div>
        </div>
        <div className="sc-ai-zone">
          <span className="sc-ai-line" /><span className="sc-ai-line sc-ai-line--short" />
          <span className="sc-cur sc-cur--ai">
            <Cursor color="var(--presence-agent)" />
            <span className="sc-cur-tag sc-cur-tag--ai motion-soft"><Spark size={10} color="var(--spark-fg)" /> AI is drawing the footer</span>
            <Pin n={8} show={pins} />
          </span>
        </div>
      </div>

      {/* Stickies — colour lives on the canvas */}
      <div className="sticky sticky--yellow sc-st sc-st--1">Bigger photo in the hero?</div>
      <div className="sticky sticky--green sc-st sc-st--2">
        Move the CTA up
        <span className="sc-cur sc-cur--tereza">
          <Cursor color="var(--object-sky)" />
          <span className="sc-cur-tag sc-cur-tag--sky">Tereza</span>
          <Pin n={9} show={pins} />
        </span>
      </div>
      <div className="sticky sticky--lilac sc-st sc-st--3">Mobile first</div>
      <div className="sticky sticky--sky sc-st sc-st--4">Yearly toggle?</div>
    </div>
  );
}

/* ─── Panels (the DS calls them islands) ───────────────────────────────── */
type Fold = { left: boolean; right: boolean; ai: boolean; dock: boolean };
const OPEN: Fold = { left: false, right: false, ai: false, dock: false };
const ZEN: Fold = { left: true, right: true, ai: true, dock: true };

/** The project pill — opens the Project menu. Its name starts with what it shows (2.5.3). */
function Pill({ folded, open, onClick, pins }: { folded: boolean; open?: boolean; onClick?: () => void; pins: boolean }) {
  return (
    <button className="island sc-pill" type="button" aria-haspopup="menu" aria-expanded={!!open} data-folded={folded ? "true" : undefined} onClick={onClick}>
      <span className="sc-pill-mark" aria-hidden="true"><Mark size={22} /></span>
      <span className="sc-pill-txt">
        <span className="sc-pill-name">Studio site</span>
        <span className="sc-pill-sep">/</span>
        <span className="sc-pill-canvas">Homepage</span>
        <span className="sc-caret"><Ic id="chevron" size={14} /></span>
      </span>
      {folded ? <Vh>Project menu</Vh> : <Vh>, Project menu</Vh>}
      <Pin n={1} show={pins} />
    </button>
  );
}

const CANVAS_ROWS: { name: string; art: Art; current?: boolean }[] = [
  { name: "Homepage", art: "home", current: true },
  { name: "Pricing", art: "price" },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
];

function LeftIsland({ folded, onFold, pins }: { folded: boolean; onFold?: () => void; pins: boolean }) {
  return (
    <>
      <div className="island sc-left sc-fold sc-fold--tl" data-folded={folded ? "true" : undefined} aria-hidden={folded}>
        <div className="sc-left-hd">
          <span className="seg sc-seg" role="group" aria-label="Left panel">
            <button type="button" aria-pressed="true">Canvases</button>
            <button type="button" aria-pressed="false">Layers</button>
          </span>
          <button className="icon-btn sc-icon-sm" type="button" aria-label="Hide this panel" onClick={onFold}><Ic id="panel-left" /></button>
        </div>
        <div className="sc-find"><Ic id="search" size={14} /><span>Search</span><span className="kbd">⌘K</span></div>
        <p className="island-title sc-it">Studio site</p>
        {CANVAS_ROWS.map((r) => (
          <div className="row-item" key={r.name} aria-current={r.current ? "true" : undefined}>
            <Thumb art={r.art} className="sc-thumb--row" />
            {r.name}
          </div>
        ))}
        <div className="row-item sc-row-new"><span className="sc-row-plus"><Ic id="plus" size={14} /></span>New canvas</div>
        <Pin n={2} show={pins} />
      </div>
      <div className="island sc-iconbtn sc-iconbtn--left sc-unfold" data-shown={folded ? "true" : undefined} aria-hidden={!folded}>
        <button className="icon-btn" type="button" aria-label="Show Canvases and Layers" onClick={onFold}><Ic id="panel-left" /></button>
      </div>
    </>
  );
}

function TopRight({ zen, panelsOn, onPanels, pins }: { zen: boolean; panelsOn: boolean; onPanels?: () => void; pins: boolean }) {
  return (
    <div className="island sc-tr" data-zen={zen ? "true" : undefined}>
      <span className="sc-tr-extra" aria-hidden={zen}>
        <span className="sc-faces" role="img" aria-label="Here now: Tereza, Jonas">
          <Av ini="T" tone="sky" />
          <Av ini="J" tone="green" />
        </span>
        <span className="sc-saved"><Ic id="cloud" size={16} />Saved</span>
      </span>
      <span className="sc-rel">
        <button className="icon-btn" type="button" aria-expanded={panelsOn} aria-label={panelsOn ? "Hide panels" : "Show panels"} aria-keyshortcuts="Meta+Backslash" onClick={onPanels}>
          <Ic id="panel-right" />
        </button>
        <Pin n={4} show={pins} />
      </span>
      <span className="sc-tr-extra" aria-hidden={zen}>
        <button className="btn btn--primary" type="button"><Ic id="share" size={14} />Share</button>
      </span>
      <Pin n={3} show={pins} />
    </div>
  );
}

/** The Edit toolbar — order + keys from CONTRACT.md §2: tools that make things inside artboards.
 *  The AI is not a tool — it is the AI chat panel. */
const TOOLS = [
  { id: "select", label: "Select", key: "V" },
  { id: "hand", label: "Hand", key: "H" },
  { id: "frame", label: "Frame", key: "F" },
  { id: "shape", label: "Shape", key: "R" },
  { id: "pen", label: "Pen", key: "P" },
  { id: "text", label: "Text", key: "T" },
  { id: "image", label: "Image", key: "I" },
  { id: "component", label: "Component", key: "Shift+I" },
];
/** Under the Edit toolbar's More (CONTRACT §2). */
const MORE_TOOLS = [
  { id: "line", label: "Line" },
  { id: "ellipse", label: "Ellipse" },
  { id: "polygon", label: "Polygon" },
  { id: "crop", label: "Crop" },
  { id: "slice", label: "Export area" },
];
/** The Preview toolbar (CONTRACT §2) — annotation only; the design stays live. Keys pressed in Edit switch here. */
const PREVIEW_TOOLS = [
  { id: "hand", label: "Hand", key: "H" },
  { id: "sticky", label: "Sticky", key: "N" },
  { id: "comment", label: "Comment", key: "C" },
  { id: "marker", label: "Marker", key: "M" },
  { id: "arrow", label: "Arrow", key: "A" },
  { id: "shape", label: "Shape", key: "R" },
  { id: "text", label: "Text", key: "T" },
  { id: "stamp", label: "Stickers", key: "E" },
  { id: "section", label: "Section", key: "S" },
];

function Dock({ folded, pins }: { folded: boolean; pins: boolean }) {
  return (
    <>
      <div className="island dock sc-dock sc-fold sc-fold--b" role="toolbar" aria-label="Toolbar" data-folded={folded ? "true" : undefined} aria-hidden={folded}>
        {TOOLS.map((t, i) => (
          <button key={t.id} className="icon-btn" type="button" aria-pressed={i === 0} aria-label={t.label} aria-keyshortcuts={t.key}>
            <Ic id={t.id} size={18} />
          </button>
        ))}
        <span className="divider-v" />
        <button className="icon-btn" type="button" aria-label="More tools: Line, Ellipse, Polygon, Crop, Export area"><Ic id="more" size={18} /></button>
        <Pin n={5} show={pins} />
      </div>
      <div className="island sc-iconbtn sc-iconbtn--dock sc-unfold" data-shown={folded ? "true" : undefined} aria-hidden={!folded}>
        <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select — show the toolbar"><Ic id="select" /></button>
      </div>
    </>
  );
}

/** One Preview-toolbar tool, drawn the FigJam way (kit AnnotateIcon): Sticky is a note in its colour, Marker shows
 *  its ink, Stickers a yellow disc — the object colours of what each tool makes, allowed in Preview only. */
const SWATCHES = ["yellow", "coral", "green", "sky", "lilac"];
function AnnotateIcon({ id, color = "yellow", ink = "coral" }: { id: string; color?: string; ink?: string }) {
  if (id === "sticky") return <span className={`sc-ad-note sc-ad-note--${color}`} />;
  if (id === "marker") return <span className="sc-ad-mk"><Ic id="marker" size={22} /><i className={`sc-ad-ink sc-ad-ink--${ink}`} /></span>;
  return <span className={id === "stamp" ? "sc-ad-stamp" : "sc-ad-ic"}><Ic id={id} size={22} /></span>;
}

/** Close-up: the two toolbars, one per mode (CONTRACT §2). Static figures — no tab stops. */
function ModeToolbars() {
  return (
    <div className="sc-modes" role="group" aria-label="The two toolbars">
      <figure className="sc-mode">
        <div className="stage sc-mode-stage" role="img" aria-label="Edit toolbar with More open: Line, Ellipse, Polygon, Crop, Export area">
          <div className="sc-mode-in" inert>
            <div className="island sc-more" role="menu" aria-label="More tools">
              {MORE_TOOLS.map((t, i) => (
                <span className="row-item sc-more-row" role="menuitem" aria-current={i === 1 ? "true" : undefined} key={t.id}><Ic id={t.id} />{t.label}</span>
              ))}
            </div>
            <div className="island dock sc-mode-dock">
              {TOOLS.map((t, i) => (
                <span className="icon-btn" aria-pressed={i === 0} key={t.id}><Ic id={t.id} size={18} /></span>
              ))}
              <span className="divider-v" />
              <span className="icon-btn sc-more-on"><Ic id="more" size={18} /></span>
            </div>
          </div>
        </div>
        <figcaption className="sc-cap"><strong>Edit.</strong> Tools that make things inside artboards — frames, shapes, paths, text, images, components. Line, Ellipse, Polygon, Crop and Export area wait under More.</figcaption>
      </figure>
      <figure className="sc-mode">
        <div className="stage sc-mode-stage" role="img" aria-label="Preview toolbar: Hand, Sticky, Comment, Marker, Arrow, Shape, Text, Stickers, Section — Sticky in hand, its colours open">
          <div className="sc-mode-in" inert>
            <div className="sticky sticky--yellow sc-mode-st">Bigger photo?</div>
            <div className="island dock sc-mode-dock sc-adock">
              {PREVIEW_TOOLS.map((t, i) => (
                <span className="sc-mode-slot" key={t.id}>
                  <span className="icon-btn sc-ad-b" aria-pressed={t.id === "sticky"}>
                    <AnnotateIcon id={t.id} />
                    {t.id === "sticky" ? (
                      <span className="island sc-ad-pop">
                        {SWATCHES.map((c) => <i key={c} className={`sc-ad-sw sc-ad-sw--${c}`} data-on={c === "yellow" ? "true" : undefined} />)}
                      </span>
                    ) : null}
                  </span>
                  {i === 0 ? <span className="divider-v" /> : null}
                </span>
              ))}
            </div>
          </div>
        </div>
        <figcaption className="sc-cap"><strong>Preview.</strong> Only marks on top of the live work, a size bigger and a little playful — each tool wears the colour of what it makes, and Sticky's colours open above it. Press N, C, M, A, E or S in Edit to come here with that tool; esc takes you back.</figcaption>
      </figure>
    </div>
  );
}

function UndoZoom({ folded, pins, zoom = 100 }: { folded: boolean; pins: boolean; zoom?: number }) {
  return (
    <div className="island sc-uz sc-fold sc-fold--bl" data-folded={folded ? "true" : undefined} aria-hidden={folded}>
      <button className="icon-btn" type="button" aria-label="Undo" aria-keyshortcuts="Meta+Z"><Ic id="undo" /></button>
      <button className="icon-btn" type="button" aria-label="Redo" aria-keyshortcuts="Shift+Meta+Z"><Ic id="redo" /></button>
      <span className="sc-uz-div" />
      <button className="btn btn--ghost btn--sm sc-zoom" type="button">{zoom}%<Vh> zoom</Vh></button>
      <Pin n={6} show={pins} />
    </div>
  );
}

function AiPanel({ folded, chip, onFold, pins }: { folded: boolean; chip: string; onFold?: () => void; pins: boolean }) {
  return (
    <>
      <div className="island island--pad sc-ai sc-fold sc-fold--br" role="group" aria-label="AI chat panel" data-folded={folded ? "true" : undefined} aria-hidden={folded}>
        <div className="sc-ai-hd">
          <Spark size={14} color="var(--spark)" />
          <span className="sc-ai-name">AI</span>
          <button className="icon-btn sc-icon-sm" type="button" aria-label="Hide the AI chat panel" onClick={onFold}><Ic id="chevron" size={14} /></button>
        </div>
        <p className="sc-ai-msg">Done — three hero variants are on the canvas. Pick one.</p>
        <div className="sc-ai-sugg">
          <button className="chip sc-sugg" type="button">Make it calmer</button>
          <button className="chip sc-sugg" type="button">Try a dark version</button>
        </div>
        <div className="ask">
          <span className="chip chip--accent sc-selchip"><span aria-hidden="true">◆ </span>{chip}</span>
          <input aria-label="Ask AI" aria-keyshortcuts="Meta+Slash" placeholder="Ask AI…" />
          <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
        </div>
        <Pin n={7} show={pins} />
      </div>
      <div className="island sc-iconbtn sc-iconbtn--ai sc-unfold" data-shown={folded ? "true" : undefined} aria-hidden={!folded}>
        <button className="icon-btn sc-spark-btn" type="button" aria-label="Show the AI chat panel" onClick={onFold}>
          <Spark size={16} color="var(--spark)" />
          <span className="sc-ai-dot" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

/* ─── Contextual: the inspector (only while something is selected) ── */
const CSS_ROWS: [string, string][] = [
  ["width", "1440px"],
  ["height", "1600px"],
  ["background", "var(--bg-2)"],
  ["border-radius", "0"],
  ["overflow", "hidden"],
  ["display", "flex"],
];

function Inspector({ shown, advOpen, onAdv }: { shown: boolean; advOpen: boolean; onAdv?: () => void }) {
  return (
    <div className="island island--pad sc-insp sc-fold sc-fold--tr" role="group" aria-label="Inspector" data-folded={shown ? undefined : "true"} aria-hidden={!shown}>
      <div className="sc-insp-hd">
        <strong>Homepage</strong>
        <span className="chip">Artboard</span>
      </div>
      <div className="sc-insp-row">
        <span>Preset</span>
        <select className="select sc-insp-select" defaultValue="desktop" aria-label="Preset">
          <option value="desktop">Desktop</option>
          <option value="laptop">Laptop</option>
          <option value="tablet">Tablet</option>
          <option value="mobile">Mobile</option>
        </select>
      </div>
      <div className="sc-insp-row">
        <span>Size</span>
        <span className="sc-wh">
          <label className="sc-num"><b>W</b><input className="input" defaultValue="1440" aria-label="Width" /></label>
          <label className="sc-num"><b>H</b><input className="input" defaultValue="1600" aria-label="Height" /></label>
        </span>
      </div>
      <div className="sc-insp-row">
        <span>Fill</span>
        <span className="sc-fill"><span className="sc-fill-sw" aria-hidden="true" />White<span className="sc-fill-pct">100%</span></span>
      </div>
      <div className="sc-insp-row">
        <span>Corners</span>
        <label className="sc-num sc-num--one"><b aria-hidden="true"><Ic id="corner" size={12} /></b><input className="input" defaultValue="0" aria-label="Corner radius" /></label>
      </div>
      <div className="sc-insp-row">
        <span>Clip content</span>
        <button type="button" role="switch" className="switch" aria-checked="true" aria-label="Clip content" />
      </div>
      <div className="sc-insp-row">
        <span>Export</span>
        <button className="btn btn--sm" type="button"><Ic id="export" size={12} />PNG · 2×</button>
      </div>
      <div className="sc-adv" data-open={advOpen ? "true" : undefined}>
        <button className="sc-adv-btn" type="button" aria-expanded={advOpen} onClick={onAdv}>
          <span className="sc-adv-ch"><Ic id="chevron-r" size={12} /></span>
          Advanced
          <span className="sc-adv-count">{advOpen ? "CSS" : `${CSS_ROWS.length} properties`}</span>
        </button>
        {advOpen ? (
          <div className="sc-adv-body">
            {CSS_ROWS.map(([k, v]) => (
              <div className="sc-css" key={k}><span className="mono sc-css-k">{k}</span><span className="mono sc-css-v">{v}</span></div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Search (⌘K) — the palette over the canvas (components-command-palette, compact) ── */
type Hit = { id: string; kind: "canvas" | "tool"; label: string; art?: Art; icon?: string; meta?: string; where?: string; words: string[] };
const FIND: Hit[] = [
  { id: "c-home", kind: "canvas", label: "Homepage", art: "home", meta: "Studio site · 2 min ago", words: ["landing"] },
  { id: "c-pri", kind: "canvas", label: "Pricing", art: "price", meta: "Studio site · Tereza is here", words: ["plans", "price"] },
  { id: "c-onb", kind: "canvas", label: "Onboarding", art: "onb", meta: "Studio site · yesterday", words: ["welcome", "signup"] },
  { id: "c-mob", kind: "canvas", label: "Mobile — detail", art: "mobile", meta: "Studio site · Monday", words: ["phone", "ios"] },
  { id: "c-brand", kind: "canvas", label: "Brand board", art: "brand", meta: "Alligators brand · Jonas", words: ["logo", "colours"] },
  { id: "t-print", kind: "tool", label: "Print guides", icon: "print", where: "Menu › View › Advanced", words: ["bleed", "margins", "a4"] },
  { id: "t-sync", kind: "tool", label: "Sync", icon: "sync", where: "Menu › Diagnostics", words: ["cloud", "resync", "hub", "offline"] },
  { id: "t-server", kind: "tool", label: "Server", icon: "server", where: "Menu › Diagnostics", words: ["port", "localhost", "restart"] },
  { id: "t-history", kind: "tool", label: "Version history", icon: "history", where: "Menu · ⌥⌘H", words: ["commit", "git", "restore", "branch", "changes"] },
  { id: "t-layers", kind: "tool", label: "Layers as a panel", icon: "layers", where: "Menu › View › Advanced", words: ["docked", "dock", "sidebar"] },
];

function find(q: string): { hit: Hit; at: number; via?: string }[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  const out: { hit: Hit; at: number; via?: string }[] = [];
  for (const hit of FIND) {
    const at = hit.label.toLowerCase().indexOf(n);
    if (at >= 0) { out.push({ hit, at }); continue; }
    const via = hit.words.find((w) => w.includes(n));
    if (via) out.push({ hit, at: -1, via });
  }
  return out;
}

function Hl({ text, at, len }: { text: string; at: number; len: number }) {
  if (at < 0 || !len) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="sc-mark">{text.slice(at, at + len)}</mark>{text.slice(at + len)}</>;
}

function Palette({ q, onQ, onClose }: { q: string; onQ?: (v: string) => void; onClose?: () => void }) {
  const uid = useId();
  const hits = useMemo(() => find(q), [q]);
  const groups: { kind: "canvas" | "tool"; title: string; aside?: string }[] = [
    { kind: "canvas", title: "Canvases" },
    { kind: "tool", title: "Tools and settings", aside: "hidden from the chrome, found by search" },
  ];
  const firstId = hits.length ? `${uid}-${hits[0].hit.id}` : `${uid}-ask`;
  return (
    <div className="sc-pal" role="dialog" aria-label="Search">
      <label className="sc-pal-field">
        <Ic id="search" size={18} />
        {onQ ? (
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={firstId}
            value={q}
            onChange={(e) => onQ(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
            placeholder="Search canvases, actions, or ask AI…"
            aria-label="Search canvases, actions, or ask AI"
          />
        ) : (
          <span className="sc-pal-typed">{q}<span className="sc-caret-line" aria-hidden="true" /></span>
        )}
        <span className="kbd">esc</span>
      </label>
      <div className="sc-pal-res">
        {q.trim() && !hits.length ? <p className="sc-pal-none">Nothing called “{q.trim()}”. Try another word, or ask AI to find it.</p> : null}
        <div role="listbox" id={`${uid}-list`} aria-label="Results">
          {groups.map((g) => {
            const rows = hits.filter((h) => h.hit.kind === g.kind);
            if (!rows.length) return null;
            return (
              <div key={g.kind} role="group" aria-labelledby={`${uid}-g-${g.kind}`}>
                <p className="island-title sc-pal-gt" id={`${uid}-g-${g.kind}`}>{g.title}{g.aside ? <span className="sc-pal-aside">{g.aside}</span> : null}</p>
                {rows.map(({ hit, at, via }) => {
                  const id = `${uid}-${hit.id}`;
                  return (
                    <div className="sc-pal-row" role="option" id={id} aria-selected={id === firstId} key={hit.id}>
                      {hit.art ? <Thumb art={hit.art} className="sc-thumb--pal" /> : <span className="sc-pal-ic"><Ic id={hit.icon ?? "search"} /></span>}
                      <span className="sc-pal-label">
                        <span><Hl text={hit.label} at={at} len={q.trim().length} /></span>
                        {via ? <span className="sc-pal-via">matches “{via}”</span> : null}
                      </span>
                      {hit.meta ? <span className="sc-pal-meta">{hit.meta}</span> : null}
                      {hit.where ? <span className="chip">{hit.where}</span> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="sc-pal-ask" role="group" aria-label="Ask AI">
            <div className="sc-pal-row" role="option" id={`${uid}-ask`} aria-selected={firstId === `${uid}-ask`}>
              <span className="sc-pal-ic sc-pal-ic--spark"><Spark size={12} color="var(--spark-fg)" /></span>
              <span className="sc-pal-label">Ask AI<span className="sc-pal-meta"> — describe what you want on the canvas</span></span>
              <span className="sc-keys" aria-hidden="true"><span className="kbd">⌘</span><span className="kbd">↵</span></span>
            </div>
          </div>
        </div>
      </div>
      <div className="sc-pal-foot">
        <span className="sc-pal-hints" aria-hidden="true"><span><span className="kbd">↑</span><span className="kbd">↓</span> move</span><span><span className="kbd">↵</span> open</span></span>
        <span role="status">{q.trim() ? `${hits.length} ${hits.length === 1 ? "result" : "results"}` : "Type to search"}</span>
      </div>
    </div>
  );
}

/* ─── The one menu under the project pill — the canonical tree (CONTRACT.md §1) ─── */
type MRow = { label: string; icon?: string; keys?: string; sub?: boolean; dot?: boolean; open?: boolean } | "sep";
const MENU: MRow[] = [
  { label: "Back to Home", icon: "home" }, "sep",
  { label: "File", icon: "file", sub: true }, { label: "Edit", icon: "edit", sub: true },
  { label: "View", icon: "view", sub: true }, { label: "Help", icon: "help", sub: true, dot: true }, "sep",
  { label: "Version history", icon: "history", keys: "⌥⌘H" }, { label: "Share…", icon: "share" }, { label: "Export…", icon: "export", keys: "⇧⌘E" }, "sep",
  { label: "Diagnostics", icon: "pulse", sub: true, open: true }, { label: "Settings…", icon: "settings", keys: "⌘," },
];

function Diagnostics() {
  return (
    <div className="sc-menu sc-submenu" role="menu" aria-label="Diagnostics">
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">Sync</span><span className="sc-st-word sc-st-word--ok"><i />Up to date</span></div>
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">Server</span><span className="sc-st-word sc-st-word--ok"><i />Running</span></div>
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">AI setup</span><span className="sc-st-word sc-st-word--ok"><i />Ready</span></div>
      <span className="sc-msep" role="separator" />
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">Logs</span></div>
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">Reload canvas</span><span className="sc-mi-keys">⌘R</span></div>
      <div className="row-item sc-mi" role="menuitem"><span className="sc-mi-lab">Check AI setup again</span></div>
      <span className="sc-msep" role="separator" />
      <div className="sc-mi-adv">
        <span className="sc-mi-adv-hd"><Ic id="chevron" size={12} />Advanced</span>
        <span className="sc-mi-adv-row"><span>Address</span><span className="mono">localhost:4402</span></span>
        <span className="sc-mi-adv-row"><span>Process</span><span className="mono">41207</span></span>
        <span className="sc-mi-adv-row"><span>Project folder</span><span className="mono">~/Studio site</span></span>
        <span className="sc-mi-adv-acts"><span className="chip">Resync now</span><span className="chip">Download all</span></span>
      </div>
    </div>
  );
}

function OneMenu() {
  return (
    <div className="sc-menu sc-menu--main" role="menu" aria-label="Project menu">
      <div className="sc-menu-search"><Ic id="search" size={14} /><span>Search</span><span className="kbd">⌘K</span></div>
      {MENU.map((r, i) =>
        r === "sep" ? (
          <span className="sc-msep" role="separator" key={i} />
        ) : (
          <div className="row-item sc-mi" role="menuitem" aria-haspopup={r.sub ? "menu" : undefined} aria-expanded={r.open ? true : undefined} aria-current={r.open ? "true" : undefined} key={r.label}>
            <span className="sc-mi-ic"><Ic id={r.icon ?? "file"} size={14} /></span>
            <span className="sc-mi-lab">{r.label}{r.dot ? <span className="sc-mi-dot" role="img" aria-label="What's new" /> : null}</span>
            {r.keys ? <span className="sc-mi-keys">{r.keys}</span> : null}
            {r.sub ? <span className="sc-mi-ch"><Ic id="chevron-r" size={12} /></span> : null}
            {r.open ? <Diagnostics /> : null}
          </div>
        ),
      )}
    </div>
  );
}

/* ─── One workspace, any state ─────────────────────────────────────────── */
type WSProps = {
  sel?: Sel;
  fold?: Fold;
  zen?: boolean;
  menu?: boolean;
  palette?: ReactNode;
  pins?: boolean;
  advOpen?: boolean;
  toast?: string;
  on?: {
    select?: (s: Sel) => void;
    left?: () => void;
    ai?: () => void;
    all?: () => void;
    menu?: () => void;
    adv?: () => void;
  };
};

function Workspace({ sel = null, fold = OPEN, zen = false, menu = false, palette, pins = false, advOpen = false, toast, on = {} }: WSProps) {
  const inspecting = !!sel && !fold.right;
  return (
    <>
      <World sel={sel} onSelect={on.select} cam={inspecting ? SEL_CAM : undefined} pins={pins} dim={!!palette} />
      <Pill folded={zen} open={menu} onClick={on.menu} pins={pins} />
      <LeftIsland folded={fold.left} onFold={on.left} pins={pins} />
      <TopRight zen={zen} panelsOn={!zen} onPanels={on.all} pins={pins} />
      <Inspector shown={inspecting} advOpen={advOpen} onAdv={on.adv} />
      <UndoZoom folded={fold.dock} pins={pins} zoom={inspecting ? SEL_ZOOM : 100} />
      <Dock folded={fold.dock} pins={pins} />
      <AiPanel folded={fold.ai} chip={sel === "home" ? "Homepage" : "Whole canvas"} onFold={on.ai} pins={pins} />
      {menu ? <OneMenu /> : null}
      {palette ? <><div className="sc-veil" aria-hidden="true" />{palette}</> : null}
      {toast ? <div className="island sc-toast" role="status">{toast}</div> : null}
    </>
  );
}

const HIDDEN_NOTE = "Panels hidden. Press ⌘\\ to bring them back.";

/* ─── 1 · the live hero ─────────────────────────────────────────────────── */
const LEGEND: [string, string][] = [
  ["Project pill", "The mark, the project and the canvas. Opens the Project menu."],
  ["Canvases · Layers", "Find a canvas by its picture. Folds into the icon on its corner."],
  ["Who's here · Share", "Faces, the word Saved, one Share button — the only azure fill."],
  ["Panels button", "⌘\\ hides every panel; press it again to show them."],
  ["Toolbar", "Edit's tools make things inside artboards. Line, Ellipse and the rest wait under More."],
  ["Undo · zoom", "Small and low, out of the work's way."],
  ["AI chat panel", "One prompt, the selection as a chip, the spark to send."],
  ["AI's cursor", "On the footer it is drawing — AI always shows where it works."],
  ["Tereza", "On the sticky she's writing. People wear canvas colours."],
];

function LiveHero() {
  const [sel, setSel] = useState<Sel>(null);
  const [fold, setFold] = useState<Fold>(OPEN);
  const [menu, setMenu] = useState(false);
  const [pal, setPal] = useState(false);
  const [q, setQ] = useState("pri");
  const [pins, setPins] = useState(true);
  const [adv, setAdv] = useState(false);
  const [toast, setToast] = useState<string | undefined>(undefined);

  const zen = fold.left && fold.ai && fold.dock && fold.right;

  function toggleAll() {
    setMenu(false);
    setFold((f) => {
      const goingZen = !(f.left && f.ai && f.dock && f.right);
      setToast(goingZen ? HIDDEN_NOTE : undefined);
      return goingZen ? ZEN : OPEN;
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggleAll(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setMenu(false); setPal(true); }
      else if (e.key === "Escape") { setPal(false); setMenu(false); setSel(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(undefined), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function reset() {
    setSel(null); setFold(OPEN); setMenu(false); setPal(false); setAdv(false); setToast(undefined); setQ("pri"); setPins(true);
  }

  return (
    <>
      <div className="sc-controls" role="group" aria-label="Try the workspace">
        <button type="button" className={`btn btn--sm ${sel ? "" : "btn--ghost"}`} aria-pressed={!!sel} onClick={() => setSel(sel ? null : "home")}>Select Homepage</button>
        <button type="button" className={`btn btn--sm ${zen ? "" : "btn--ghost"}`} aria-pressed={zen} onClick={toggleAll}>Hide panels <span className="kbd">⌘\</span></button>
        <button type="button" className={`btn btn--sm ${menu ? "" : "btn--ghost"}`} aria-pressed={menu} onClick={() => { setPal(false); setMenu((m) => !m); }}>Open the Project menu</button>
        <button type="button" className={`btn btn--sm ${pal ? "" : "btn--ghost"}`} aria-pressed={pal} onClick={() => { setMenu(false); setPal((p) => !p); }}>Search <span className="kbd">⌘K</span></button>
        <span className="sc-controls-sp" />
        <label className="sc-controls-pins">
          <button type="button" role="switch" className="switch" aria-checked={pins} aria-label="Name the parts" onClick={() => setPins((p) => !p)} />
          Name the parts
        </label>
        <button type="button" className="btn btn--sm btn--ghost" onClick={reset}>Reset</button>
      </div>
      <figure className="sc-fig">
        <div className="sc-scroll">
          <MacWindow tabs={WORK_TABS} active="studio" height={680} label="Maude — Studio site, Homepage canvas" live>
            <Workspace
              sel={sel}
              fold={fold}
              zen={zen}
              menu={menu}
              pins={pins}
              advOpen={adv}
              toast={toast}
              palette={pal ? <Palette q={q} onQ={setQ} onClose={() => setPal(false)} /> : undefined}
              on={{
                select: (s) => { setMenu(false); setSel(s); },
                left: () => setFold((f) => ({ ...f, left: !f.left })),
                ai: () => setFold((f) => ({ ...f, ai: !f.ai })),
                all: toggleAll,
                menu: () => { setPal(false); setMenu((m) => !m); },
                adv: () => setAdv((a) => !a),
              }}
            />
          </MacWindow>
        </div>
        <figcaption className="sc-cap"><strong>Canvas workspace.</strong> The canvas runs edge to edge under the title bar. Every piece of chrome is a small panel over it, and each one folds into the icon it came from.</figcaption>
      </figure>
      {/* The numbered legend only shows while its pins are on the picture. */}
      {pins ? (
        <ol className="sc-legend">
          {LEGEND.map(([t, d], i) => (
            <li key={t}><span className="sc-pin sc-pin--inline" aria-hidden="true">{i + 1}</span><span><strong>{t}</strong>{d}</span></li>
          ))}
        </ol>
      ) : (
        <p className="sc-legend-off">Turn on “Name the parts” to number every panel.</p>
      )}
    </>
  );
}

/* ─── 2 · panels hidden — the fold, step by step ──────────────────────────
   Static frames of the real fold (transform + opacity toward the icon). The middle frame is the
   true ease-out state at 40 ms: --ease-out has covered ~57 % of the move by then. */
const STEPS: { k: "open" | "mid" | "icon"; t: string; at: string; d: string }[] = [
  { k: "open", t: "Open", at: "0 ms", d: "The AI chat panel at full size." },
  { k: "mid", t: "Folding", at: "40 ms", d: "Most of the move happens early. The outline marks where it comes back." },
  { k: "icon", t: "Icon only", at: "220 ms", d: "The spark stays in the corner. Click it, or press ⌘\\." },
];

function FoldSteps() {
  return (
    <div className="sc-steps">
      <p className="sc-steps-hd"><span className="mono">--dur-panel · --ease-out</span><span>transform + opacity only, toward the icon it folds into</span></p>
      <ol className="sc-steps-row">
        {STEPS.map((s) => (
          <li className={`sc-step sc-step--${s.k}`} key={s.k}>
            <div className="sc-window sc-step-win" aria-hidden="true" inert>
              <div className="sc-body sc-step-body">
                {s.k === "mid" ? <div className="sc-step-ghost"><AiPanel folded={false} chip="Whole canvas" pins={false} /></div> : null}
                <div className={s.k === "mid" ? "sc-step-shrink" : undefined}>
                  <AiPanel folded={s.k === "icon"} chip="Whole canvas" pins={false} />
                </div>
              </div>
            </div>
            <p className="sc-step-cap"><span className="sc-step-at">{s.at}</span><strong>{s.t}</strong>{s.d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─── 4 · Home ──────────────────────────────────────────────────────────── */
const STARTERS: { t: string; l: string; art: Art }[] = [
  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
  { t: "Three logo ideas", l: "for Alligators brand", art: "brand" },
  { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
];
const RECENT: { name: string; art: Art; meta: string; ai?: boolean; who?: string[] }[] = [
  { name: "Homepage", art: "home", meta: "Studio site · 2 min ago", who: ["T"] },
  { name: "Pricing", art: "price", meta: "Studio site · Tereza is here", who: ["T", "J"] },
  { name: "Brand board", art: "board", meta: "Alligators brand · yesterday", ai: true },
  { name: "Mobile — detail", art: "mobile", meta: "Studio site · Monday" },
];

function HomeScreen() {
  return (
    <div className="sc-home-bg">
      <button className="island sc-pill sc-pill--home" type="button" aria-haspopup="menu">
        <span className="sc-pill-mark" aria-hidden="true"><Mark size={22} /></span>
        <span className="sc-pill-txt"><span className="sc-pill-name">Home</span><span className="sc-caret"><Ic id="chevron" size={14} /></span></span>
        <Vh>, Project menu</Vh>
      </button>
      <div className="island sc-home-tr">
        <button className="icon-btn" type="button" aria-label="Search" aria-keyshortcuts="Meta+K"><Ic id="search" /></button>
        <span className="kbd">⌘K</span>
      </div>

      <div className="sc-home">
        <span className="sc-home-spark"><Spark size={48} color="var(--spark)" /></span>
        <h3 className="sc-home-title">What shall we make?</h3>
        <p className="sc-home-sub">Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there.</p>
        <div className="island island--pad sc-home-ask">
          <div className="ask sc-ask-lg">
            <input aria-label="Ask AI" placeholder="A calm landing page for Studio site, light and airy" />
            <span className="send" aria-hidden="true"><Spark size={14} color="var(--spark-fg)" /></span>
          </div>
          <div className="sc-home-askfoot">
            <span className="chip">Starts a new canvas in <strong>Studio site</strong> <Ic id="chevron" size={12} /></span>
            <span className="sc-home-hint"><span className="kbd">↵</span> to send</span>
          </div>
        </div>
        <div className="sc-starters">
          {STARTERS.map((s) => (
            <button className="sc-starter" type="button" key={s.t}>
              <Thumb art={s.art} className="sc-thumb--starter" />
              <span><strong>{s.t}</strong><span>{s.l}</span></span>
            </button>
          ))}
        </div>

        <div className="sc-home-sec">
          <p className="sc-home-h">Recent canvases<button className="btn btn--ghost btn--sm" type="button">See all</button></p>
          <div className="sc-cards">
            {RECENT.map((c) => (
              <button className="sc-card" type="button" key={c.name}>
                <span className="sc-card-pic">
                  <Thumb art={c.art} className="sc-thumb--card" />
                  {c.ai ? <span className="chip chip--spark sc-card-ai"><Spark size={9} color="var(--spark)" />Made by AI</span> : null}
                </span>
                <strong>{c.name}</strong>
                <span className="sc-card-meta">{c.meta}</span>
                {c.who ? <span className="sc-card-faces">{c.who.map((w) => <Av key={w} ini={w} tone={w === "T" ? "sky" : "green"} size="sm" />)}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="sc-home-sec">
          <p className="sc-home-h">Recent projects</p>
          <div className="sc-projects">
            <button className="sc-project" type="button">
              <span className="sc-stack"><Thumb art="home" /><Thumb art="price" /><Thumb art="onb" /></span>
              <span className="sc-project-txt"><strong>Studio site</strong><span>5 canvases</span></span>
              <Av ini="M" tone="yellow" size="sm" />
            </button>
            <button className="sc-project" type="button">
              <span className="sc-stack"><Thumb art="brand" /><Thumb art="board" /><Thumb art="mobile" /></span>
              <span className="sc-project-txt"><strong>Alligators brand</strong><span>8 canvases</span></span>
              <Av ini="A" tone="lilac" size="sm" />
            </button>
            <button className="sc-project sc-project--open" type="button">
              <span className="sc-project-plus"><Ic id="folder" size={18} /></span>
              <span className="sc-project-txt"><strong>Open project…</strong><span>Any folder works</span></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 5 · where the old menubar went (items + keys from CONTRACT.md §1–2) ──── */
const MOVED: { was: string; now: string; items: string; note?: string }[] = [
  { was: "File", now: "Menu › File", items: "New canvas ⌘N · New project… ⇧⌘N · Open project… ⌘O · Export… ⇧⌘E · Close canvas", note: "Generate with AI is the AI chat panel now." },
  { was: "Edit + Selection", now: "Menu › Edit", items: "Undo ⌘Z · Redo ⇧⌘Z · Select all ⌘A · Deselect all esc", note: "New artboard sizes → Edit › Advanced." },
  { was: "View", now: "Menu › View", items: "Hide panels ⌘\\ · Comments ⇧⌘M · Presentation mode · Zoom to fit ⌘0", note: "Minimap, print guides, hidden files → View › Advanced." },
  { was: "Tools", now: "Two toolbars", items: "Edit: Select · Hand · Frame · Shape · Pen · Text · Image · Component", note: "Line, Ellipse, Polygon, Crop, Export area → More. Sticky, Comment, Arrow → Preview's toolbar." },
  { was: "Help", now: "Menu › Help", items: "Keyboard shortcuts ? · What's new · Take the tour · Report a bug…", note: "What's new is a quiet dot, not a toast." },
  { was: "Changes", now: "Menu › Version history", items: "Saved versions, each with a preview and Restore · ⌥⌘H", note: "Branches and pull requests → its Advanced." },
  { was: "Status bar", now: "Menu › Diagnostics", items: "Sync · Server · AI setup · Logs · Reload canvas ⌘R", note: "Shown in words. Address, process and folder under Advanced." },
  { was: "Settings · 7 tabs", now: "Menu › Settings…", items: "General · Connections · Advanced · ⌘,", note: "Theme follows the Mac, in one place." },
];

/* ─── 7 · project tabs up close ────────────────────────────────────────── */
const TAB_NOTES: [string, string][] = [
  ["The Mac's own lights", "Close, minimise, full screen. Nothing of ours sits in their row."],
  ["One tab, one project", "Each project tab is its own window — drag it out, merge it back, ⇧⌘] to switch."],
  ["The account it works as", "Your initial, or a client's. Change it per tab with “Sign in as another account…”."],
  ["A new tab opens Home", "Start something, or open another project next to this one."],
];

/* ─── 8 · the shell's rules ────────────────────────────────────────────── */
const RULES: { t: string; d: string; do: string }[] = [
  { t: "The canvas is the window", d: "Edge to edge, under the title bar. Chrome floats over it and never frames it.", do: "Floating panels only — no docked bars by default." },
  { t: "Everything folds to an icon", d: "Each panel folds toward the icon that brings it back. ⌘\\ hides them all.", do: "--dur-panel · --ease-out, transform + opacity." },
  { t: "Context calls the tool", d: "The inspector arrives with a selection; the timeline with a video artboard.", do: "No permanent empty panels." },
  { t: "Advanced lives in its panel", d: "One quiet row at the foot of each panel. Never a separate app mode.", do: "Mono appears only in there." },
  { t: "Status is shown, not controlled", d: "Saving, sync and the server just work. Problems speak up in plain words.", do: "Details: Menu › Diagnostics." },
  { t: "Nothing is deleted", d: "Every tool, action and diagnostic is still one search away.", do: "Search ⌘K · the Project menu · Advanced." },
];

export default function UiKitsDesktopShowcase() {
  return (
    <>
      <SpecimenHeader crumbs={["UI kits", "Desktop showcase"]} />
      <main className="specimen sc-page">
        <section className="specimen-title">
          <h1>The canvas is the window. Everything else floats, folds, and waits.</h1>
          <p className="lede">
            Maude Desktop v2, screen by screen. One project per window tab, a canvas from edge to edge, and a few small panels
            over it — the project, your canvases, Share, the tools, AI. Each folds into its icon. Whatever used to crowd the
            chrome now lives in one menu, in Search, or under Advanced. Nothing was removed.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Window</dt><dd>native macOS · one tab per project</dd></div>
          <div><dt>Chrome</dt><dd>panels over the canvas · hide with ⌘\</dd></div>
          <div><dt>Contextual</dt><dd>inspector · timeline · comments</dd></div>
          <div><dt>Hidden, not removed</dt><dd>Menu · Search ⌘K · Advanced</dd></div>
        </dl>

        {/* ── 1 · Hero ─────────────────────────────────────────────────── */}
        <h2 data-no>Canvas workspace<span className="h2-aside">live — click an artboard, press ⌘\ or ⌘K, open the project pill</span></h2>
        <LiveHero />

        {/* ── 1b · Two toolbars — one per mode ─────────────────────────── */}
        <h2 data-no>Two toolbars<span className="h2-aside">Edit makes things inside artboards · Preview marks them up</span></h2>
        <ModeToolbars />

        {/* ── 2 · Panels hidden — the signature moment ─────────────────── */}
        <h2 data-no>Panels hidden<span className="h2-aside">⌘\ — every panel folds into its icon, and the canvas is all that's left</span></h2>
        <figure className="sc-fig">
          <div className="sc-scroll">
            <MacWindow tabs={WORK_TABS} active="studio" height={660} label="Maude — every panel hidden, only their icons remain">
              <Workspace fold={ZEN} zen toast={HIDDEN_NOTE} />
            </MacWindow>
          </div>
          <figcaption className="sc-cap"><strong>The canvas alone.</strong> Five icons stay where their panels were — the mark, Canvases, the panels button, the current tool and the spark. Undo and zoom keep their keys. The note says it once, then fades.</figcaption>
        </figure>
        <FoldSteps />

        {/* ── 3 · Something selected ───────────────────────────────────── */}
        <h2 data-no>Something selected<span className="h2-aside">the inspector arrives and the view makes room for it</span></h2>
        <figure className="sc-fig">
          <div className="sc-scroll">
            <MacWindow tabs={WORK_TABS} active="studio" height={640} label="Maude — Homepage artboard selected, inspector open">
              <Workspace sel="home" fold={{ ...OPEN, left: true }} />
            </MacWindow>
          </div>
          <figcaption className="sc-cap"><strong>The inspector, on selection only.</strong> Size, fill, corners, clip and export in plain words; the raw CSS waits one row down, under a closed Advanced. The view pans so nothing you're working on sits under a panel, and the AI chat panel picks up the selection as its chip.</figcaption>
        </figure>

        {/* ── 4 · Home ─────────────────────────────────────────────────── */}
        <h2 data-no>Home<span className="h2-aside">the first thing after install — nothing to set up</span></h2>
        <figure className="sc-fig">
          <div className="sc-scroll">
            <MacWindow tabs={[TAB_STUDIO, TAB_ALLIG, TAB_HOME]} active="home" height={720} label="Maude — Home: What shall we make?">
              <HomeScreen />
            </MacWindow>
          </div>
          <figcaption className="sc-cap"><strong>Home, in a new tab.</strong> A question, a prompt, three starters written as requests, then your recent canvases and projects as pictures. No sign-in wall, no checklist, no folder picker first.</figcaption>
        </figure>

        {/* ── 5 · The one menu ─────────────────────────────────────────── */}
        <h2 data-no>The one menu<span className="h2-aside">under the project pill — Diagnostics open</span></h2>
        <figure className="sc-fig">
          <div className="sc-scroll">
            <MacWindow tabs={WORK_TABS} active="studio" height={640} label="Maude — the Project menu open, Diagnostics expanded">
              <Workspace menu fold={{ ...OPEN, left: true }} />
            </MacWindow>
          </div>
          <figcaption className="sc-cap"><strong>Six menus and a status bar became one list.</strong> File, Edit, View and Help as submenus; Version history, Share and Export at the top level; Diagnostics shows sync, the server and AI setup in words. The Mac's own menu bar is untouched.</figcaption>
        </figure>
        <div className="sc-moved" role="group" aria-label="Where the old chrome went">
          {MOVED.map((m) => (
            <div className="sc-moved-card" key={m.was}>
              <span className="sc-moved-was">{m.was}</span>
              <span className="sc-moved-now"><Ic id="chevron-r" size={12} />{m.now}</span>
              <span className="sc-moved-items">{m.items}</span>
              {m.note ? <span className="sc-moved-note">{m.note}</span> : null}
            </div>
          ))}
        </div>

        {/* ── 6 · Search ───────────────────────────────────────────────── */}
        <h2 data-no>Search over the canvas<span className="h2-aside">⌘K — a canvas and a hidden tool in one search</span></h2>
        <figure className="sc-fig">
          <div className="sc-scroll">
            <MacWindow tabs={WORK_TABS} active="studio" height={520} label="Maude — Search open over the canvas">
              <Workspace palette={<Palette q="pri" />} />
            </MacWindow>
          </div>
          <figcaption className="sc-cap"><strong>“pri” finds Pricing and the print guides.</strong> Canvases come first, with their pictures. A tool that left the chrome names its other home, so Search teaches the menu. Ask AI is always the last row.</figcaption>
        </figure>

        {/* ── 7 · Project tabs ─────────────────────────────────────────── */}
        <h2 data-no>Project tabs<span className="h2-aside">native window tabs — each with its own account</span></h2>
        <figure className="sc-tabs-zoom">
          <div className="sc-titlebar sc-titlebar--zoom" role="img" aria-label="Two project tabs, enlarged, with the Alligators brand tab's menu open">
            <div className="sc-titlebar-in" inert>
              <span className="sc-lights sc-rel"><i /><i /><i /><Pin n={1} show className="sc-pin--lead sc-lead-28" /></span>
              <nav className="sc-tabs" aria-label="Project tabs, enlarged">
                <span className="sc-tab" aria-current="page">
                  <span className="sc-tab-x"><Ic id="close" size={10} /></span><Av ini="M" tone="yellow" size="sm" /><span className="sc-tab-name">Studio site</span>
                  <Pin n={2} show className="sc-pin--lead sc-lead-16" />
                </span>
                <span className="sc-tab sc-tab--menu">
                  <span className="sc-rel"><Av ini="A" tone="lilac" size="sm" /><Pin n={3} show className="sc-pin--lead sc-lead-26" /></span>
                  <span className="sc-tab-name">Alligators brand</span>
                  <span className="sc-tabmenu" role="menu" aria-label="Alligators brand tab">
                    <span className="row-item" role="menuitem">Rename…</span>
                    <span className="row-item" role="menuitem">Move to a new window</span>
                    <span className="row-item" role="menuitem" aria-current="true">Sign in as another account…</span>
                    <span className="sc-msep" role="separator" />
                    <span className="row-item" role="menuitem">Close tab</span>
                  </span>
                </span>
              </nav>
              <span className="sc-tab-add sc-rel"><Ic id="plus" size={13} /><Pin n={4} show className="sc-pin--lead sc-lead-20" /></span>
            </div>
          </div>
          <ol className="sc-legend sc-legend--tabs">
            {TAB_NOTES.map(([t, d], i) => (
              <li key={t}><span className="sc-pin sc-pin--inline" aria-hidden="true">{i + 1}</span><span><strong>{t}</strong>{d}</span></li>
            ))}
          </ol>
        </figure>

        {/* ── 8 · Rules ────────────────────────────────────────────────── */}
        <h2 data-no>The shell, in six rules</h2>
        <ol className="sc-rules">
          {RULES.map((r) => (
            <li className="sc-rule" key={r.t}>
              <strong>{r.t}</strong>
              <span>{r.d}</span>
              <span className="sc-rule-do">{r.do}</span>
            </li>
          ))}
        </ol>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · desktop showcase — the shell every v2 screen lifts</span>
        <span>Words, keys and the menu: CONTRACT.md · locked direction: ui/v2/maude-v2-moodboard.tsx</span>
      </footer>
    </>
  );
}
