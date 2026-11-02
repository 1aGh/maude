/**
 * @canvas      Studio — Maude app-shell redesign · the dotted infinite canvas framed by ONE cohesive chrome material · 6 artboards · hero is live (collapse sidebar · menubar dropdown · theme flip · tool switch)
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   hero | comments | annotate | palette | inspector | handoff
 * @brief       Redesign of the Maude desktop app from today's reality + Canvas Viewport. Layout the user likes: left sidebar (file tree) · top menubar+tools+status · bottom context bar · right sidebar (comments / inspector / css knobs). Covers the implemented feature surface across 6 artboards, with light interactions on the hero so the chrome is visible "v pohybu".
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling Studio.css)
 * @history     .design/_history/studio/
 * @handoff     bunx shadcn add file://./Studio.registry.json
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). Tokens +
 * shared component classes arrive via the dev-server _shell.html harness; the
 * heavy chrome lives in the sibling Studio.css (every value a var(--*) token).
 * The `.maude[data-theme]` wrapper on each artboard scopes the token ladder.
 */

import { useState } from "react";
// Pin this canvas to the `maude` DS directly. The dev-server client only injects
// the RIGHT DS tokens for `system/<ds>/preview/` specimens — for a UI canvas it
// always injects designSystems[0] (= `project`), ignoring meta.designSystem
// (app.jsx canvasUrl, ~L113). Importing the maude tokens here makes the canvas
// self-contained so it renders in maude no matter what the host injects; the
// `.maude[data-theme]` scope (specificity 0,2,0) wins over any `:root` pollution.
import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Studio.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

/* ───────────────────────────── Icon set ─────────────────────────────────────
 * Thin-stroke (1.4) geometric glyphs — terminal/IDE heritage, no emoji (DS rule).
 * ──────────────────────────────────────────────────────────────────────────── */
const ICONS = {
  "chevron-down": <polyline points="3.5 6 8 10.5 12.5 6" />,
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  file: (<><path d="M4 2h5l3 3v9H4z" /><polyline points="9 2 9 5 12 5" /></>),
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  search: (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /></>),
  plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
  cursor: <path d="M3 2l9 4.4-4 1.1-1.1 4z" />,
  hand: <path d="M5.5 8.5V5a1 1 0 0 1 2 0v2M7.5 7V4a1 1 0 0 1 2 0v3M9.5 7.5V5.5a1 1 0 0 1 2 0V10a3 3 0 0 1-3 3H8a3 3 0 0 1-2.8-1.9L4.2 9a1 1 0 0 1 1.5-1.1z" />,
  comment: <path d="M3 3h10v7H7l-3 2.4V10H3z" />,
  pen: (<><path d="M11 2.5l2.5 2.5-7.6 7.6-3.2.7.7-3.2z" /><line x1="9.6" y1="3.9" x2="12.1" y2="6.4" /></>),
  square: <rect x="3" y="3" width="10" height="10" rx="1.5" />,
  circle: <circle cx="8" cy="8" r="5.2" />,
  arrow: (<><line x1="3" y1="13" x2="12.5" y2="3.5" /><polyline points="6.5 3.5 12.5 3.5 12.5 9.5" /></>),
  eraser: (<><path d="M3.5 10.5l4.5-4.5 4 4-3 3H6z" /><line x1="6.5" y1="13.5" x2="13" y2="13.5" /></>),
  text: (<><polyline points="4 4.5 12 4.5" /><line x1="8" y1="4.5" x2="8" y2="12" /></>),
  sticky: (<><path d="M3 3h10v6.5l-3.5 3.5H3z" /><polyline points="13 9.5 9.5 9.5 9.5 13" /></>),
  "zoom-in": (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /><line x1="5" y1="7" x2="9" y2="7" /><line x1="7" y1="5" x2="7" y2="9" /></>),
  "zoom-out": (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /><line x1="5" y1="7" x2="9" y2="7" /></>),
  fit: (<><polyline points="3 6 3 3 6 3" /><polyline points="10 3 13 3 13 6" /><polyline points="13 10 13 13 10 13" /><polyline points="6 13 3 13 3 10" /></>),
  sun: (<><circle cx="8" cy="8" r="2.6" /><line x1="8" y1="1.5" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="14.5" /><line x1="1.5" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="14.5" y2="8" /><line x1="3.4" y1="3.4" x2="4.4" y2="4.4" /><line x1="11.6" y1="11.6" x2="12.6" y2="12.6" /><line x1="12.6" y1="3.4" x2="11.6" y2="4.4" /><line x1="4.4" y1="11.6" x2="3.4" y2="12.6" /></>),
  moon: <path d="M12.5 9.6A5 5 0 1 1 7 3a4 4 0 0 0 5.5 6.6z" />,
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  layers: (<><polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" /><polyline points="2.2 9 8 12.3 13.8 9" /></>),
  sliders: (<><line x1="3" y1="5" x2="13" y2="5" /><circle cx="6" cy="5" r="1.7" fill="currentColor" /><line x1="3" y1="11" x2="13" y2="11" /><circle cx="10" cy="11" r="1.7" fill="currentColor" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  x: (<><line x1="4.3" y1="4.3" x2="11.7" y2="11.7" /><line x1="11.7" y1="4.3" x2="4.3" y2="11.7" /></>),
  play: <polygon points="5 3.5 12.5 8 5 12.5" fill="currentColor" stroke="none" />,
  undo: (<><path d="M5.5 6H10a3.4 3.4 0 0 1 0 6.8H6.2" /><polyline points="5.5 3.6 3 6 5.5 8.4" /></>),
  download: (<><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><polyline points="3 12.8 3 13.6 13 13.6 13 12.8" /></>),
  code: (<><polyline points="6 5 3 8 6 11" /><polyline points="10 5 13 8 10 11" /></>),
  "panel-left": (<><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><line x1="6.4" y1="3" x2="6.4" y2="13" /></>),
  dots: (<><circle cx="4" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12" cy="8" r="1" fill="currentColor" /></>),
  reopen: (<><path d="M3.2 8a5 5 0 1 1 1.4 3.5" /><polyline points="3.2 11.4 3.2 8 6.6 8" /></>),
  resolve: (<><circle cx="8" cy="8" r="5.6" /><polyline points="5.4 8 7.2 9.9 10.6 6" /></>),
  eye: (<><path d="M1.8 8s2.4-4 6.2-4 6.2 4 6.2 4-2.4 4-6.2 4-6.2-4-6.2-4z" /><circle cx="8" cy="8" r="1.7" /></>),
  share: (<><circle cx="4" cy="8" r="1.7" /><circle cx="12" cy="4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><line x1="5.5" y1="7.1" x2="10.5" y2="4.8" /><line x1="5.5" y1="8.9" x2="10.5" y2="11.2" /></>),
};

function Icon({ name, size = 16, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* ───────────────────────────── Atoms ──────────────────────────────────────── */
function Kbd({ children }) { return <span className="kbd">{children}</span>; }

const AVATAR_HUES = {
  you: "var(--accent)",
  petra: "var(--presence-online)",
  sam: "var(--status-info)",
  agent: "var(--presence-agent)",
};
function Avatar({ who, initials }) {
  return <span className="st-avatar" style={{ background: AVATAR_HUES[who] || "var(--bg-4)" }}>{initials}</span>;
}

function PresenceCursor({ x, y, color, name, agent }) {
  return (
    <div className={"st-cursor" + (agent ? " is-agent" : "")} style={{ left: x, top: y }}>
      <svg width="18" height="18" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={color} stroke="var(--bg-0)" strokeWidth="0.8" /></svg>
      <span className="st-cursor-tag" style={{ background: color }}>{name}</span>
    </div>
  );
}

/* A small silhouette of the user's design work, rendered inside the canvas. */
function MiniArtboard({ label, style, accent, tone = "default", children }) {
  return (
    <div className="st-ab" style={style}>
      {label ? <span className="st-ab-label">{label}</span> : null}
      <div className="st-ab-bar"><span className="st-ab-dot" /><span className="st-ab-dot" /><span className="st-ab-dot" /></div>
      <div className="st-ab-body">
        {children || (
          <>
            <div className="st-sk st-sk--line" style={{ width: "60%" }} />
            <div className="st-sk--row">
              <div className="st-sk" style={{ width: 46, height: 46, borderRadius: "var(--radius-pill)" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, justifyContent: "center" }}>
                <div className="st-sk st-sk--line" style={{ width: "80%" }} />
                <div className="st-sk st-sk--line" style={{ width: "55%" }} />
              </div>
            </div>
            <div className="st-sk" style={{ width: "100%", height: 30, borderRadius: "var(--radius-sm)" }} />
            {accent ? <div className="st-sk st-sk--accent" style={{ width: "44%", height: 22, borderRadius: "var(--radius-sm)" }} /> : <div className="st-sk st-sk--line" style={{ width: "40%" }} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Menubar ────────────────────────────────────── */
const MENU_NAMES = ["File", "Edit", "View", "Selection", "Tools", "Help"];
const ENABLED_MENUS = ["View", "Selection", "Tools", "Help"];

function ViewDropdown({ panels = {} }) {
  const row = (label, on, kbd) => (
    <div className={"st-dd-item" + (on ? " is-on" : "")}>
      <span className="st-dd-lead"><span className="st-dd-check">{on ? <Icon name="check" size={13} /> : null}</span>{label}</span>
      <Kbd>{kbd}</Kbd>
    </div>
  );
  return (
    <div className="st-dropdown" style={{ left: 168 }} role="menu" aria-label="View">
      <div className="st-dd-hd">Panels</div>
      {row("Project Tree", panels.tree, "T")}
      {row("Layers", panels.layers, "L")}
      {row("Inspector", panels.inspector, "I")}
      {row("Comments", panels.comments, "C")}
      {row("Annotations", panels.annotations, "⇧⌘A")}
      <div className="st-dd-sep" />
      <div className="st-dd-hd">Zoom</div>
      <div className="st-dd-item"><span className="st-dd-lead"><span className="st-dd-check" />Fit to screen</span><Kbd>⇧⌘0</Kbd></div>
      <div className="st-dd-item"><span className="st-dd-lead"><span className="st-dd-check" />Actual size · 100%</span><Kbd>⌘0</Kbd></div>
    </div>
  );
}
function ToolsDropdown() {
  const tools = [["Move", "V"], ["Hand", "H"], ["Comment", "C"], ["Pen", "B"], ["Rectangle", "R"], ["Ellipse", "O"], ["Arrow", "A"], ["Text", "T"], ["Eraser", "E"]];
  return (
    <div className="st-dropdown" style={{ left: 252 }} role="menu" aria-label="Tools">
      <div className="st-dd-hd">Tool palette</div>
      {tools.map(([t, k]) => (
        <div className="st-dd-item" key={t}><span className="st-dd-lead"><span className="st-dd-check" />{t}</span><Kbd>{k}</Kbd></div>
      ))}
    </div>
  );
}

function Menubar({ theme, openMenu, onMenu, stamp = "CANVAS", file = "ui /", fileName = "Studio", artboards = 6, zoom = "100%", whatsNewUnseen = true, presence, interactive }) {
  return (
    <header className="st-menubar">
      <span className="st-brand">
        <span className="st-brand-mark"><svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg></span>
        <span className="st-brand-name">maude</span>
      </span>
      <nav className="st-menus" aria-label="Application menu">
        {MENU_NAMES.map((m) => {
          const enabled = ENABLED_MENUS.includes(m);
          return (
            <button key={m} type="button" className="st-menu" disabled={!enabled && interactive}
              aria-haspopup="menu" aria-expanded={openMenu === m}
              onClick={interactive && enabled ? () => onMenu(openMenu === m ? null : m) : undefined}>
              {m}
            </button>
          );
        })}
      </nav>
      {openMenu === "View" ? <ViewDropdown panels={{ tree: true, inspector: true, annotations: false }} /> : null}
      {openMenu === "Tools" ? <ToolsDropdown /> : null}

      <div className="st-mb-right">
        {presence ? <div className="st-presence">{presence}</div> : null}
        <button type="button" className="st-whatsnew" data-unseen={whatsNewUnseen} aria-label="What's new"><Icon name="sparkle" size={15} /></button>
        <span className="st-stamp">{stamp}</span>
        <span className="st-mb-file">{file} <b>{fileName}</b></span>
        <span className="st-mb-sep" />
        <span className="st-mb-count"><span className="st-dot" style={{ background: "var(--accent)" }} />{artboards}</span>
        <span className="st-mb-sep" />
        <span className="st-mb-count st-mono">{zoom}</span>
        <span className="st-mb-sep" />
        <span className="st-mb-proj">maude</span>
      </div>
    </header>
  );
}

/* ───────────────────────────── Sidebar (file tree) ────────────────────────── */
function TreeRow({ glyph = "file", name, depth = 1, sel, muted, badge }) {
  return (
    <div className={"st-row" + (sel ? " is-sel" : "") + (muted ? " is-muted" : "")} style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="st-row-glyph"><Icon name={glyph} size={glyph === "file" ? 13 : 13} /></span>
      <span className="st-row-name">{name}</span>
      {badge ? <span className="st-row-badge">{badge}</span> : null}
    </div>
  );
}

function Sidebar({ collapsed, onCollapse }) {
  return (
    <nav className={"st-sidebar" + (collapsed ? " is-collapsed" : "")} aria-label="Files">
      <div className="st-sb-hd">
        <span className="st-sb-title">Files</span>
        <div className="st-sb-hd-actions">
          <span className="st-live"><span className="st-live-dot is-pulse" /> live</span>
          <button type="button" className="st-iconbtn" aria-label="Collapse sidebar" onClick={onCollapse}><Icon name="panel-left" size={15} /></button>
        </div>
      </div>
      <div className="st-search">
        <div className="st-search-box">
          <Icon name="search" size={13} />
          <input placeholder="Search canvases…" readOnly />
          <Kbd>/</Kbd>
        </div>
      </div>
      <div className="st-tree">
        <div className="st-tree-section">
          <div className="st-tree-sec-hd"><Icon name="chevron-down" size={13} /><span className="st-sec-name">Design system</span><span className="st-pill">2</span></div>
          <TreeRow glyph="folder" name="maude" depth={1} />
          <TreeRow glyph="folder" name="project" depth={1} muted />
        </div>
        <div className="st-tree-section">
          <div className="st-tree-sec-hd"><Icon name="chevron-down" size={13} /><span className="st-sec-name">UI canvases</span><span className="st-pill">7</span></div>
          <TreeRow name="Studio" depth={1} sel />
          <TreeRow name="Canvas Viewport" depth={1} badge="2" />
          <TreeRow name="Commands" depth={1} />
          <TreeRow name="Docs" depth={1} badge="1" />
          <TreeRow name="Sync" depth={1} />
          <TreeRow name="Agency" depth={1} />
          <TreeRow name="Horizon" depth={1} />
        </div>
        <div className="st-tree-section">
          <div className="st-tree-sec-hd"><Icon name="chevron-right" size={13} /><span className="st-sec-name">Runtime · gitignored</span><span className="st-pill">4</span></div>
        </div>
      </div>
    </nav>
  );
}
function CollapsedRail({ shown, onExpand }) {
  return (
    <div className={"st-rail" + (shown ? " is-shown" : "")}>
      <div className="st-rail-inner">
        <button type="button" className="st-iconbtn" aria-label="Expand sidebar" onClick={onExpand}><Icon name="panel-left" size={15} /></button>
        <button type="button" className="st-iconbtn" aria-label="Search"><Icon name="search" size={15} /></button>
        <button type="button" className="st-iconbtn" aria-label="Files"><Icon name="folder" size={15} /></button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Floating chrome ────────────────────────────── */
const TOOLS = [
  ["cursor", "V", "move"], ["hand", "H", "hand"], ["comment", "C", "comment"], ["sep"],
  ["pen", "B", "pen"], ["square", "R", "rect"], ["circle", "O", "ellipse"], ["arrow", "A", "arrow"], ["eraser", "E", "eraser"], ["sep"],
  ["play", "P", "present"],
];
function FloatingToolbar({ tool = "move", onTool }) {
  return (
    <div className="st-toolbar" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t, i) => t[0] === "sep"
        ? <span className="st-tool-sep" key={"s" + i} />
        : (
          <button key={t[2]} type="button" className={"st-tool" + (tool === t[2] ? " is-active" : "")}
            aria-label={t[2]} aria-pressed={tool === t[2]} title={t[2] + " · " + t[1]}
            onClick={onTool ? () => onTool(t[2]) : undefined}>
            <Icon name={t[0]} size={16} />
          </button>
        ))}
    </div>
  );
}
function Minimap({ active = 0 }) {
  const abs = [{ l: 12, t: 16, w: 34, h: 26 }, { l: 56, t: 10, w: 40, h: 30 }, { l: 54, t: 50, w: 36, h: 24 }];
  return (
    <div className="st-minimap">
      <div className="st-mm-hd"><span>World</span><span className="st-mono">3 / 3</span></div>
      <div className="st-mm-world">
        {abs.map((a, i) => <div key={i} className={"st-mm-ab" + (i === active ? " is-active" : "")} style={{ left: a.l, top: a.t, width: a.w, height: a.h }} />)}
        <div className="st-mm-vp" style={{ left: 6, top: 6, width: 96, height: 60 }} />
      </div>
    </div>
  );
}
function ZoomHud({ value = "100%" }) {
  return (
    <div className="st-zoom" role="toolbar" aria-label="Zoom">
      <button type="button" aria-label="Zoom out"><Icon name="zoom-out" size={15} /></button>
      <span className="st-zoom-val">{value}</span>
      <button type="button" aria-label="Zoom in"><Icon name="zoom-in" size={15} /></button>
      <button type="button" aria-label="Fit"><Icon name="fit" size={15} /></button>
    </div>
  );
}

/* ───────────────────────────── Status bar (context) ───────────────────────── */
function StatusBar({ theme, onTheme, selected, file = ".design/ui/Studio.tsx", comments = 3, sync = "0 ↑", interactive }) {
  return (
    <footer className="st-statusbar">
      <span className="st-sb-slot st-sb-active"><span className="lead" /><span className="lbl">active</span><span className="val">{file}</span></span>
      {selected ? <span className="st-sb-slot st-sb-sel"><span className="lbl">selected</span><span className="val">{selected}</span></span> : null}
      <span className="st-sb-slot"><span className="lbl">comments</span><span className="val">{comments} open</span></span>
      <span className="st-sb-spacer" />
      <span className="st-sb-slot"><span className="st-dot" style={{ background: "var(--presence-online)" }} /><span className="lbl">live</span></span>
      <span className="st-sb-slot"><span className="lbl">hub sync</span><span className="val">{sync}</span></span>
      <button type="button" className="st-sb-theme" onClick={interactive ? onTheme : undefined} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
        <Icon name={theme === "dark" ? "sun" : "moon"} size={13} />{theme === "dark" ? "light" : "dark"}
      </button>
    </footer>
  );
}

/* ───────────────────────────── Right panels ───────────────────────────────── */
function InspectorPanel({ tab = "inspect", onTab }) {
  const tabBtn = (id, label, icon, ct) => (
    <button type="button" className={"st-rp-tab" + (tab === id ? " is-active" : "")} onClick={onTab ? () => onTab(id) : undefined}>
      <Icon name={icon} size={14} />{label}{ct ? <span className="st-rp-tabct">{ct}</span> : null}
    </button>
  );
  return (
    <aside className="st-rpanel" aria-label="Inspector">
      <div className="st-rp-tabs">
        {tabBtn("inspect", "Inspect", "sliders")}
        {tabBtn("layers", "Layers", "layers")}
        {tabBtn("css", "CSS", "code")}
      </div>
      <div className="st-rp-body">
        {tab === "inspect" && (
          <>
            <div className="st-rp-hd">button.cta · Hero</div>
            <div className="st-insp-row"><span className="st-insp-label">Pos</span><div className="st-insp-fields"><span className="st-field-lead"><span className="k">X</span><input className="st-field" defaultValue="248" readOnly /></span><span className="st-field-lead"><span className="k">Y</span><input className="st-field" defaultValue="412" readOnly /></span></div></div>
            <div className="st-insp-row"><span className="st-insp-label">Size</span><div className="st-insp-fields"><span className="st-field-lead"><span className="k">W</span><input className="st-field" defaultValue="184" readOnly /></span><span className="st-field-lead"><span className="k">H</span><input className="st-field" defaultValue="44" readOnly /></span></div></div>
            <div className="st-insp-row"><span className="st-insp-label">Radius</span><div className="st-insp-fields"><input className="st-field" defaultValue="5" readOnly /><span className="st-mono" style={{ fontSize: 10, color: "var(--fg-3)", alignSelf: "center" }}>radius-sm</span></div></div>
            <div className="st-insp-row"><span className="st-insp-label">Fill</span><div className="st-swatch-row"><span className="st-token-swatch" style={{ background: "var(--accent)" }} /><span className="st-mono" style={{ fontSize: 11, color: "var(--fg-1)" }}>--accent</span></div></div>
            <div className="st-insp-row"><span className="st-insp-label">Text</span><div className="st-swatch-row"><span className="st-token-swatch" style={{ background: "var(--accent-fg)" }} /><span className="st-mono" style={{ fontSize: 11, color: "var(--fg-1)" }}>--accent-fg</span></div></div>
            <div className="st-rp-hd" style={{ marginTop: 4 }}>Type</div>
            <div className="st-insp-row"><span className="st-insp-label">Font</span><div className="st-insp-fields"><span className="st-mono" style={{ fontSize: 11, color: "var(--fg-0)" }}>Inter · 14 / 500</span></div></div>
          </>
        )}
        {tab === "layers" && (
          <>
            <div className="st-rp-hd">Layers · Hero</div>
            <div className="st-layer"><Icon name="square" size={13} />artboard</div>
            <div className="st-layer" style={{ paddingLeft: 18 }}><Icon name="layers" size={13} />nav.bar<span className="st-layer-eye"><Icon name="eye" size={13} /></span></div>
            <div className="st-layer is-sel" style={{ paddingLeft: 18 }}><Icon name="square" size={13} />button.cta<span className="st-layer-eye"><Icon name="eye" size={13} /></span></div>
            <div className="st-layer" style={{ paddingLeft: 18 }}><Icon name="text" size={13} />h1.title</div>
            <div className="st-layer" style={{ paddingLeft: 18 }}><Icon name="circle" size={13} />avatar</div>
            <div className="st-layer" style={{ paddingLeft: 34 }}><Icon name="file" size={13} />img.src</div>
          </>
        )}
        {tab === "css" && <CssPanelMock />}
      </div>
    </aside>
  );
}

/* CSS panel — Phase 12.2 canvas-first spec (DDR-104). Hybrid vocabulary
 * (friendly section headers + CSS-named rows), per-field DS-token dropdowns,
 * a nested box-model widget, color control, per-row provenance, save-state, and
 * a demoted two-hatch Advanced section (custom CSS prop + custom HTML attr).
 * This is the static design spec for the critic gate; it ports to app.jsx
 * `CssKnobs` once it scores ≥ 4.0. Every value is a stand-in (token-bound /
 * raw-override / inherited) so the critic can read all three provenance states. */
function CssPanelMock() {
  const Chev = () => <Icon name="chevron-down" size={11} />;
  const PROV = { bound: "token-bound", raw: "raw override", inherit: "inherited" };
  const prov = (p: string) => (
    <span className={`st-cp-prov st-cp-prov--${p}`} role="img" aria-label={PROV[p]} />
  );
  const tokenField = (name: string, aria: string) => (
    <button type="button" className="st-cp-token" aria-label={`${aria} — token ${name}`}>
      <span className="st-cp-tokdot" aria-hidden="true" />
      <span className="st-cp-tokname">{name}</span>
      <Chev />
    </button>
  );
  const colorField = (name: string, aria: string, swatchVar: string) => (
    <button type="button" className="st-cp-token" aria-label={`${aria} — token ${name}`}>
      <span className="st-cp-tokswatch" style={{ background: `var(${swatchVar})` }} aria-hidden="true" />
      <span className="st-cp-tokname">{name}</span>
      <Chev />
    </button>
  );
  const numField = (value: string, unit: string, aria: string, placeholder?: string) => (
    <div className="st-cp-num">
      <input className="st-cp-numin" defaultValue={value} placeholder={placeholder} readOnly aria-label={aria} />
      <span className="st-cp-step">
        <button type="button" className="st-cp-stepb" tabIndex={-1} aria-label={`increase ${aria}`}>▲</button>
        <button type="button" className="st-cp-stepb" tabIndex={-1} aria-label={`decrease ${aria}`}>▼</button>
      </span>
      <button type="button" className="st-cp-unit" aria-label={`${aria} unit`}>{unit}<Chev /></button>
      <button type="button" className="st-cp-bind" aria-label={`bind ${aria} to a token`} title="bind to a token" />
    </div>
  );
  const row = (label: string, p: string, children) => (
    <div className="st-cp-row" key={label}>
      {prov(p)}
      <label className="st-cp-label" title={label}>{label}</label>
      <div className="st-cp-ctl">{children}</div>
    </div>
  );
  const bars = (dir: string) => (
    <span className={`st-cp-bars st-cp-bars--${dir}`} aria-hidden="true"><i /><i /><i /></span>
  );
  const selectField = (value: string, aria: string) => (
    <button type="button" className="st-cp-select" aria-label={aria}><span>{value}</span><Chev /></button>
  );
  const sechd = (title: string, open: boolean) => (
    <button type="button" className="st-cp-sechd" aria-expanded={open}>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={11} />{title}
    </button>
  );
  return (
    <div className="st-cp" aria-label="CSS">
      <div className="st-cp-id">
        <span className="st-cp-idtag">button<span className="st-cp-idcls">.cta</span></span>
        <span className="st-cp-idmeta">direct style</span>
      </div>

      <section className="st-cp-sec">
        {sechd("Layout", true)}
        {row("display", "raw", selectField("inline-flex", "display"))}
        {row("flex-direction", "raw", selectField("row", "flex-direction"))}
        {row("align-items", "raw", selectField("center", "align-items"))}
        {row("justify-content", "raw", selectField("center", "justify-content"))}
        {row("gap", "bound", tokenField("--space-2", "gap"))}
      </section>

      <section className="st-cp-sec">
        {sechd("Typography", true)}
        {row("font-family", "raw", selectField("Inter", "font-family"))}
        {row("color", "bound", colorField("--accent-fg", "color", "--accent-fg"))}
        {row("font-size", "raw", numField("14", "px", "font-size"))}
        {row("font-weight", "raw", selectField("500 · Medium", "font-weight"))}
        {row("line-height", "inherit",
          <div className="st-cp-num">
            <input className="st-cp-numin" defaultValue="" placeholder="1.5" readOnly aria-label="line-height" />
            <button type="button" className="st-cp-bind" aria-label="bind line-height to a token" title="bind to a token" />
          </div>)}
        {row("letter-spacing", "raw", numField("0", "em", "letter-spacing"))}
        {row("text-align", "raw",
          <div className="st-cp-seg" role="group" aria-label="text-align">
            <button type="button" className="st-cp-segbtn" aria-label="align left" aria-pressed="false">{bars("left")}</button>
            <button type="button" className="st-cp-segbtn is-active" aria-label="align center" aria-pressed="true">{bars("center")}</button>
            <button type="button" className="st-cp-segbtn" aria-label="align right" aria-pressed="false">{bars("right")}</button>
            <button type="button" className="st-cp-segbtn" aria-label="justify" aria-pressed="false">{bars("just")}</button>
          </div>)}
      </section>

      <section className="st-cp-sec">
        {sechd("Spacing", true)}
        <div className="st-cp-box" aria-label="margin and padding">
          <span className="st-cp-boxtag st-cp-boxtag--m"><i className="st-cp-prov st-cp-prov--inherit" role="img" aria-label="margin inherited" />margin</span>
          <input className="st-cp-boxv st-cp-boxv--mt is-zero" defaultValue="0" readOnly aria-label="margin-top" />
          <input className="st-cp-boxv st-cp-boxv--mr is-zero" defaultValue="auto" readOnly aria-label="margin-right" />
          <input className="st-cp-boxv st-cp-boxv--mb" defaultValue="16" readOnly aria-label="margin-bottom" />
          <input className="st-cp-boxv st-cp-boxv--ml is-zero" defaultValue="auto" readOnly aria-label="margin-left" />
          <div className="st-cp-boxpad">
            <span className="st-cp-boxtag st-cp-boxtag--p"><i className="st-cp-prov st-cp-prov--raw" role="img" aria-label="padding raw override" />padding</span>
            <input className="st-cp-boxv st-cp-boxv--pt" defaultValue="12" readOnly aria-label="padding-top" />
            <input className="st-cp-boxv st-cp-boxv--pr" defaultValue="24" readOnly aria-label="padding-right" />
            <input className="st-cp-boxv st-cp-boxv--pb" defaultValue="12" readOnly aria-label="padding-bottom" />
            <input className="st-cp-boxv st-cp-boxv--pl" defaultValue="24" readOnly aria-label="padding-left" />
            <div className="st-cp-boxcore">184 × 44</div>
          </div>
        </div>
        <div className="st-cp-boxlink">
          <button type="button" className="st-cp-linkbtn is-on" aria-pressed="true">
            <span className="st-cp-linkglyph" aria-hidden="true" />link all sides
          </button>
          <span className="st-cp-linkhint">edit one side, update all four</span>
        </div>
      </section>

      <section className="st-cp-sec">
        {sechd("Size", false)}
      </section>

      <section className="st-cp-sec">
        {sechd("Appearance", true)}
        {row("background-color", "bound", colorField("--accent", "background-color", "--accent"))}
        <div className="st-cp-row">
          {prov("bound")}
          <label className="st-cp-label" title="border-radius">border-radius</label>
          <div className="st-cp-ctl">
            {tokenField("--radius-sm", "border-radius")}
            <button type="button" className="st-cp-split is-on" aria-pressed="true" aria-label="set each corner separately" title="set each corner separately" />
          </div>
        </div>
        <div className="st-cp-corners" aria-label="per-corner radius">
          <label className="st-cp-cornerf"><span>TL</span><input defaultValue="8" readOnly aria-label="top-left radius" /></label>
          <label className="st-cp-cornerf"><span>TR</span><input defaultValue="8" readOnly aria-label="top-right radius" /></label>
          <label className="st-cp-cornerf"><span>BL</span><input defaultValue="8" readOnly aria-label="bottom-left radius" /></label>
          <label className="st-cp-cornerf"><span>BR</span><input defaultValue="4" readOnly aria-label="bottom-right radius" /></label>
        </div>
        {row("border", "raw",
          <div className="st-cp-border">
            <input className="st-cp-numin st-cp-numin--mini" defaultValue="1" readOnly aria-label="border-width" />
            <button type="button" className="st-cp-select st-cp-select--mini" aria-label="border-style"><span>solid</span><Chev /></button>
            <span className="st-cp-swatch st-cp-swatch--mini" style={{ background: "var(--border-default)" }} aria-hidden="true" />
          </div>)}
        {row("box-shadow", "bound", tokenField("--shadow-sm", "box-shadow"))}
        {row("opacity", "raw",
          <div className="st-cp-slider">
            <span className="st-cp-track" role="slider" tabIndex={0} aria-label="opacity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100} aria-valuetext="100%"><span className="st-cp-fill" style={{ width: "100%" }} /><span className="st-cp-thumb" style={{ left: "100%" }} /></span>
            <span className="st-cp-slval">100%</span>
          </div>)}
      </section>

      <div className="st-cp-save is-saved" role="status"><Icon name="resolve" size={12} />written to source</div>

      <section className="st-cp-adv is-open">
        <button type="button" className="st-cp-advhd" aria-expanded="true">
          <Icon name="chevron-down" size={12} />
          Advanced
        </button>
        <div className="st-cp-advbody">
          <div className="st-cp-advgrp">Custom CSS property</div>
          <div className="st-cp-kv has-warn">
            <input className="st-cp-numin" defaultValue="padding" readOnly aria-label="custom property name" aria-describedby="cp-warn-shadow" />
            <input className="st-cp-numin" defaultValue="0" readOnly aria-label="custom property value" aria-describedby="cp-warn-shadow" />
          </div>
          <div className="st-cp-warn" id="cp-warn-shadow">overrides the padding set in Spacing above</div>
          <button type="button" className="st-cp-add">+ Add CSS property</button>
          <div className="st-cp-note">used as-is — not linked to a token</div>
          <div className="st-cp-advgrp">Custom HTML attribute</div>
          <div className="st-cp-kv">
            <input className="st-cp-numin" defaultValue="data-state" readOnly aria-label="custom attribute name" />
            <input className="st-cp-numin" defaultValue="active" readOnly aria-label="custom attribute value" />
          </div>
          <button type="button" className="st-cp-add">+ Add HTML attribute</button>
        </div>
      </section>

      <div className="st-cp-legend">
        <span><i className="st-cp-prov st-cp-prov--bound" aria-hidden="true" />token</span>
        <span><i className="st-cp-prov st-cp-prov--raw" aria-hidden="true" />override</span>
        <span><i className="st-cp-prov st-cp-prov--inherit" aria-hidden="true" />inherited</span>
      </div>
    </div>
  );
}

function CommentsPanel() {
  return (
    <aside className="st-rpanel" aria-label="Comments">
      <div className="st-rp-tabs" style={{ borderBottom: "none", paddingBottom: 8 }}>
        <div className="st-cm-filters">
          <button type="button" className="st-cm-filter is-active">All · 3</button>
          <button type="button" className="st-cm-filter">Open · 2</button>
          <button type="button" className="st-cm-filter">Resolved · 1</button>
        </div>
      </div>
      <div className="st-rp-body" style={{ gap: 12 }}>
        <div className="st-cm-group-hd"><span>Studio · hero</span><span className="st-mono">2</span></div>
        <div className="st-comment is-active">
          <div className="st-comment-hd"><Avatar who="petra" initials="PV" /><span className="st-comment-who">Petra</span><span className="st-comment-time">2h</span><span className="st-pin" style={{ position: "static", width: 18, height: 18, borderRadius: 4 }}>1</span></div>
          <div className="st-comment-txt">CTA kontrast je hraniční — <span className="mention">@Claude</span> zkus tmavší accent na light tématu?</div>
          <div className="st-comment-foot"><span className="st-comment-sel">button.cta</span><span className="st-mini-act"><button className="st-iconbtn" aria-label="Resolve"><Icon name="resolve" size={14} /></button><button className="st-iconbtn" aria-label="Delete"><Icon name="x" size={14} /></button></span></div>
        </div>
        <div className="st-comment">
          <div className="st-comment-hd"><Avatar who="agent" initials="C" /><span className="st-comment-who">Claude</span><span className="st-comment-time">1h</span><span className="st-pin" style={{ position: "static", width: 18, height: 18, borderRadius: 4 }}>2</span></div>
          <div className="st-comment-txt">Hotovo — accent na light je teď oklch(0.52). WCAG AA na <span className="mention">--accent-fg</span> sedí (6.3:1).</div>
          <div className="st-comment-foot"><span className="st-comment-sel">tokens.css</span><span className="st-mini-act"><button className="st-iconbtn" aria-label="Resolve"><Icon name="resolve" size={14} /></button></span></div>
        </div>
        <div className="st-cm-group-hd"><span>Docs</span><span className="st-mono">1</span></div>
        <div className="st-comment is-resolved">
          <div className="st-comment-hd"><Avatar who="sam" initials="SK" /><span className="st-comment-who">Sam</span><span className="st-comment-time">yest</span></div>
          <div className="st-comment-txt">Heading scale na hero sekci dotažený. Zavírám.</div>
          <div className="st-comment-foot"><span className="st-comment-sel">h1.title</span><span className="st-mini-act"><button className="st-iconbtn" aria-label="Reopen"><Icon name="reopen" size={14} /></button></span></div>
        </div>
      </div>
    </aside>
  );
}

/* ───────────────────────────── Canvas stages ──────────────────────────────── */
/* Comments stage — open thread popover + agent activity overlay. */
function CommentsStage() {
  return (
    <div className="st-stage">
      <div className="st-world">
        <MiniArtboard label="dashboard" style={{ left: 70, top: 120, width: 230, height: 180 }} />
        <MiniArtboard label="profile" style={{ left: 96, top: 332, width: 196, height: 150 }} accent />

        {/* agent activity overlay rim */}
        <div className="st-activity" style={{ left: 70, top: 120, width: 230, height: 180 }}>
          <span className="st-activity-badge"><span className="st-dot" style={{ background: "#fff" }} />Claude is editing</span>
        </div>

        <div className="st-pin" style={{ left: 284, top: 150 }}>1</div>
        <div className="st-pin is-resolved" style={{ left: 276, top: 322 }}>2</div>

        {/* thread popover */}
        <div className="st-thread" style={{ left: 322, top: 150 }}>
          <div className="st-thread-hd"><span className="st-pin" style={{ position: "static", width: 18, height: 18, borderRadius: 4 }}>1</span><span className="st-comment-sel">card.metric</span><span style={{ marginLeft: "auto" }}><button className="btn btn--ghost btn--sm">Resolve</button></span></div>
          <div className="st-thread-body">
            <div className="st-thread-msg"><div className="st-comment-hd"><Avatar who="petra" initials="PV" /><span className="st-comment-who">Petra</span><span className="st-comment-time">8m</span></div><div className="st-comment-txt">Tahle metrika by chtěla tabular-nums, skáče to při refreshi.</div></div>
            <div className="st-thread-msg"><div className="st-comment-hd"><Avatar who="agent" initials="C" /><span className="st-comment-who">Claude</span><span className="st-comment-time">just now</span></div><div className="st-comment-txt"><span className="mention">@Petra</span> nastavuju <span className="mention">font-variant-numeric</span> na celý ladder — render za chvíli.</div></div>
          </div>
          <div className="st-thread-input"><input placeholder="Reply…  @ to mention" readOnly /><button className="btn btn--primary btn--sm">Send</button></div>
        </div>

        <PresenceCursor x={150} y={360} color="var(--presence-online)" name="Petra" />
        <PresenceCursor x={250} y={250} color="var(--presence-agent)" name="Claude · agent" agent />
      </div>
      <FloatingToolbar tool="comment" />
      <ZoomHud value="80%" />
    </div>
  );
}

/* Annotate stage — strokes, fill, sticky, selected stroke w/ context toolbar. */
function AnnotateStage() {
  return (
    <div className="st-stage">
      <div className="st-world">
        <MiniArtboard label="checkout" style={{ left: 120, top: 130, width: 280, height: 220 }} accent />

        {/* ellipse annotation w/ amber fill around the CTA */}
        <svg width="520" height="420" viewBox="0 0 520 420" style={{ position: "absolute", left: 60, top: 90, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
          <ellipse cx="200" cy="232" rx="78" ry="26" fill="color-mix(in oklab, var(--status-warn) 22%, transparent)" stroke="var(--status-info)" strokeWidth="2.2" />
          {/* arrow pointing at spacing */}
          <path d="M360 120 L268 196" stroke="var(--status-info)" strokeWidth="2.2" fill="none" />
          <path d="M268 196 l16 -3 l-6 -11 z" fill="var(--status-info)" />
          {/* freehand pen stroke (selected) */}
          <path d="M120 360 q30 -26 64 -8 t60 -4 t52 6" stroke="var(--accent)" strokeWidth="2.4" fill="none" />
        </svg>

        {/* selection halo around the pen stroke + context toolbar */}
        <div className="st-halo--group" style={{ left: 172, top: 426, width: 196, height: 40 }} />
        <div className="st-ctx" style={{ left: 176, top: 388 }}>
          <span className="st-sw is-on" style={{ background: "var(--accent)" }} />
          <span className="st-sw" style={{ background: "var(--status-info)" }} />
          <span className="st-sw" style={{ background: "var(--status-warn)" }} />
          <span className="st-sw" style={{ background: "var(--status-error)" }} />
          <span className="st-tool-sep" />
          <span className="st-ctx-chip">thick</span>
          <button className="st-iconbtn" aria-label="Delete stroke"><Icon name="x" size={14} /></button>
        </div>

        {/* sticky note */}
        <div className="st-sticky" style={{ left: 416, top: 150 }}><b>needs +8px</b> top padding on the card header</div>
      </div>
      {/* draw toolbar w/ pen active + color popover */}
      <FloatingToolbar tool="pen" />
      <div className="st-cpop" style={{ left: "50%", bottom: 62, transform: "translateX(40px)" }}>
        <span className="st-sw is-on" style={{ background: "var(--accent)" }} />
        <span className="st-sw" style={{ background: "var(--status-info)" }} />
        <span className="st-sw" style={{ background: "var(--status-success)" }} />
        <span className="st-sw" style={{ background: "var(--status-warn)" }} />
        <span className="st-sw" style={{ background: "var(--status-error)" }} />
        <span className="st-sw" style={{ background: "var(--fg-1)" }} />
      </div>
      <ZoomHud value="100%" />
      <Minimap active={0} />
    </div>
  );
}

/* Inspector stage — selected element matches the right-panel inspector. */
function InspectorStage() {
  return (
    <div className="st-stage">
      <div className="st-world">
        <MiniArtboard label="hero" style={{ left: 150, top: 150, width: 300, height: 230 }} accent>
          <div className="st-sk st-sk--line" style={{ width: "70%" }} />
          <div className="st-sk st-sk--line" style={{ width: "44%" }} />
          <div className="st-sk" style={{ width: "100%", height: 40, borderRadius: "var(--radius-sm)" }} />
          <div className="st-sk st-sk--accent" style={{ width: 184, height: 44, borderRadius: "var(--radius-sm)" }} />
        </MiniArtboard>
        <div className="st-halo" style={{ left: 168, top: 320, width: 184, height: 44 }}>
          <span className="st-halo-tag">button.cta · 184×44</span>
          <span className="st-halo-tick" style={{ left: -4, top: -4 }} />
          <span className="st-halo-tick" style={{ right: -4, top: -4 }} />
          <span className="st-halo-tick" style={{ left: -4, bottom: -4 }} />
          <span className="st-halo-tick" style={{ right: -4, bottom: -4 }} />
        </div>
      </div>
      <ZoomHud value="120%" />
      <Minimap active={0} />
    </div>
  );
}

/* ───────────────────────────── Shell wrapper ──────────────────────────────────
 * Absolutely fills the DCArtboard body (position:relative, overflow:hidden) so the
 * shell's height resolves to the body height — NOT the full artboard. Without this
 * the ~30px artboard label strip pushes the bottom status bar past the clip. */
function Shell({ theme = "dark", children }) {
  return <div className="maude" data-theme={theme} style={{ position: "absolute", inset: 0 }}>{children}</div>;
}

/* ===========================================================================
 * AB-A — HERO (interactive): collapse sidebar · menubar dropdown · theme · tools
 * =========================================================================== */
function HeroStudio() {
  const [collapsed, setCollapsed] = useState(false);
  const [openMenu, setOpenMenu] = useState("View");
  const [theme, setTheme] = useState("dark");
  const [tool, setTool] = useState("move");
  const [rtab, setRtab] = useState("inspect");

  return (
    <Shell theme={theme}>
      <div className="st-shell">
        <Menubar theme={theme} openMenu={openMenu} onMenu={setOpenMenu} interactive
          stamp="CANVAS" file="ui /" fileName="Studio" artboards={6} zoom="100%"
          presence={<><Avatar who="you" initials="MD" /><Avatar who="petra" initials="PV" /><Avatar who="agent" initials="C" /></>} />
        <div className="st-body">
          <CollapsedRail shown={collapsed} onExpand={() => setCollapsed(false)} />
          <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(true)} />
          <div className="st-stage" style={{ position: "relative" }}>
            <HeroStageInner tool={tool} setTool={setTool} />
          </div>
          <InspectorPanel tab={rtab} onTab={setRtab} />
        </div>
        <StatusBar theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} interactive
          selected="button.cta" comments={3} sync="0 ↑" />
      </div>
    </Shell>
  );
}
/* the hero's stage body shares the static HeroStage scene but drives the live tool */
function HeroStageInner({ tool, setTool }) {
  return (
    <>
      <div className="st-world">
        <MiniArtboard label="login" style={{ left: 70, top: 130, width: 196, height: 162 }} accent />
        <MiniArtboard label="dashboard" style={{ left: 312, top: 96, width: 244, height: 188 }} />
        <MiniArtboard label="settings" style={{ left: 292, top: 326, width: 210, height: 150 }} />
        <div className="st-halo" style={{ left: 82, top: 242, width: 172, height: 30 }}>
          <span className="st-halo-tag">button.cta</span>
          <span className="st-halo-tick" style={{ left: -4, top: -4 }} />
          <span className="st-halo-tick" style={{ right: -4, top: -4 }} />
          <span className="st-halo-tick" style={{ left: -4, bottom: -4 }} />
          <span className="st-halo-tick" style={{ right: -4, bottom: -4 }} />
        </div>
        <div className="st-guide st-guide--v" style={{ left: 292, top: 130, height: 346 }} />
        <span className="st-dist" style={{ left: 270, top: 302 }}>Δ 32</span>
        <div className="st-pin" style={{ left: 250, top: 118 }}>1</div>
        <PresenceCursor x={176} y={414} color="var(--presence-agent)" name="Claude · agent" agent />
      </div>
      <FloatingToolbar tool={tool} onTool={setTool} />
      <ZoomHud value="100%" />
      <Minimap active={0} />
    </>
  );
}

/* ===========================================================================
 * AB-B — COMMENTS & PRESENCE (static)
 * =========================================================================== */
function CommentsBoard() {
  return (
    <Shell theme="dark">
      <div className="st-shell">
        <Menubar stamp="CANVAS" file="ui /" fileName="Dashboard" artboards={4} zoom="80%"
          presence={<><Avatar who="you" initials="MD" /><Avatar who="petra" initials="PV" /><Avatar who="agent" initials="C" /></>} />
        <div className="st-body">
          <Sidebar collapsed={false} />
          <CommentsStage />
          <CommentsPanel />
        </div>
        <StatusBar theme="dark" comments={3} sync="2 ↑" selected="card.metric" />
      </div>
    </Shell>
  );
}

/* ===========================================================================
 * AB-C — ANNOTATE & DRAW (static)
 * =========================================================================== */
function AnnotateBoard() {
  return (
    <Shell theme="dark">
      <div className="st-shell">
        <Menubar stamp="CANVAS" file="ui /" fileName="Checkout" artboards={3} zoom="100%" openMenu={null} />
        <div className="st-body">
          <Sidebar collapsed={false} />
          <AnnotateStage />
          <InspectorPanel tab="layers" />
        </div>
        <StatusBar theme="dark" comments={1} sync="0 ↑" selected="stroke · pen" />
      </div>
    </Shell>
  );
}

/* ===========================================================================
 * AB-D — COMMAND PALETTE + WHAT'S NEW (static)
 * =========================================================================== */
const PALETTE = [
  { group: "Canvas", items: [["plus", "New canvas…", "⌘N", true], ["download", "Export…", "⇧⌘E"], ["share", "Handoff to production", "⇧⌘H"]] },
  { group: "Tools", items: [["pen", "Draw a mark with the SVG agent", "⌘D"], ["sun", "Toggle theme", "⌘⇧L"], ["sliders", "Open inspector", "I"]] },
];
function PaletteBoard() {
  return (
    <Shell theme="dark">
      <div className="st-shell">
        <Menubar stamp="IDLE" file="ui /" fileName="Studio" artboards={6} zoom="100%" />
        <div className="st-body">
          <Sidebar collapsed={false} />
          <div className="st-stage">
            <div className="st-world">
              <MiniArtboard label="login" style={{ left: 100, top: 150, width: 196, height: 160 }} accent />
              <MiniArtboard label="dashboard" style={{ left: 344, top: 120, width: 240, height: 184 }} />
            </div>
            <ZoomHud value="100%" />
            <Minimap active={0} />
            {/* What's New toast */}
            <div className="st-toast">
              <div className="st-toast-hd"><Icon name="sparkle" size={14} />What's new · v0.28</div>
              <div className="st-toast-title">Draw-as-code SVG agent</div>
              <div className="st-toast-txt">/design:draw teď kreslí loga, ikony a diagramy přes geometry engine — žádné guessed path data. Proof přes 16/24/48/256 ladder.</div>
              <div style={{ display: "flex", gap: 8 }}><button className="btn btn--primary btn--sm">See all</button><button className="btn btn--ghost btn--sm">Dismiss</button></div>
            </div>
            {/* command palette */}
            <div className="st-scrim">
              <div className="st-palette">
                <div className="st-pal-search"><Icon name="search" size={18} /><input placeholder="Type a command or search…" readOnly /><Kbd>⌘K</Kbd></div>
                <div className="st-pal-list">
                  {PALETTE.map((g) => (
                    <div key={g.group}>
                      <div className="st-pal-group">{g.group}</div>
                      {g.items.map(([icon, label, kbd, active]) => (
                        <div key={label} className={"st-pal-item" + (active ? " is-active" : "")}>
                          <span className="st-pal-icon"><Icon name={icon} size={15} /></span>
                          <span>{label}</span>
                          <span className="st-pal-kbd"><Kbd>{kbd}</Kbd></span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <InspectorPanel tab="inspect" />
        </div>
        <StatusBar theme="dark" comments={3} sync="0 ↑" />
      </div>
    </Shell>
  );
}

/* ===========================================================================
 * AB-E — INSPECT & CSS KNOBS (static, CSS tab)
 * =========================================================================== */
function InspectorBoard() {
  return (
    <Shell theme="dark">
      <div className="st-shell">
        <Menubar stamp="CANVAS" file="ui /" fileName="Hero" artboards={5} zoom="120%" openMenu={null} />
        <div className="st-body">
          <Sidebar collapsed={false} />
          <InspectorStage />
          <InspectorPanel tab="css" />
        </div>
        <StatusBar theme="dark" comments={2} sync="0 ↑" selected="button.cta · 184×44" />
      </div>
    </Shell>
  );
}

/* ===========================================================================
 * AB-F — LIGHT · HANDOFF & EXPORT (static, light theme)
 * =========================================================================== */
function HandoffBoard() {
  const fmts = [["PNG", "raster · 2×"], ["PDF", "vector · print"], ["SVG", "per artboard"], ["HTML", "self-contained"], ["shadcn", "registry-item"], ["ZIP", "project bundle"]];
  return (
    <Shell theme="light">
      <div className="st-shell">
        <Menubar stamp="CANVAS" file="ui /" fileName="Studio" artboards={6} zoom="100%" whatsNewUnseen={false} />
        <div className="st-body">
          <Sidebar collapsed={false} />
          <div className="st-stage">
            <div className="st-world">
              <MiniArtboard label="login" style={{ left: 96, top: 140, width: 196, height: 160 }} accent />
              <MiniArtboard label="dashboard" style={{ left: 338, top: 110, width: 240, height: 184 }} />
            </div>
            <ZoomHud value="100%" />
            <Minimap active={0} />
            {/* export dialog */}
            <div className="st-scrim" style={{ paddingTop: 120 }}>
              <div className="st-dialog">
                <div className="st-dialog-hd"><span className="st-dialog-title">Export &amp; handoff</span><button className="st-iconbtn" aria-label="Close"><Icon name="x" size={15} /></button></div>
                <div className="st-dialog-bd">
                  <div className="st-rp-hd">Format · 6 artboards selected</div>
                  <div className="st-fmt-grid">
                    {fmts.map(([n, s], i) => (
                      <div key={n} className={"st-fmt" + (i === 4 ? " is-on" : "")}>
                        <Icon name={i === 4 ? "share" : i === 3 ? "code" : "download"} size={16} />
                        <span className="st-fmt-name">{n}</span>
                        <span className="st-fmt-sub">{s}</span>
                      </div>
                    ))}
                  </div>
                  <div className="callout callout--success" style={{ fontSize: 12 }}>shadcn registry-item inlines canvas-lib + declares <span className="st-mono">motion</span> — drops straight into Next.js.</div>
                </div>
                <div className="st-dialog-ft"><button className="btn btn--ghost">Cancel</button><button className="btn btn--primary"><Icon name="download" size={14} />Export registry-item</button></div>
              </div>
            </div>
          </div>
          <InspectorPanel tab="inspect" />
        </div>
        <StatusBar theme="light" comments={0} sync="3 ↑ synced" />
      </div>
    </Shell>
  );
}

/* ───────────────────────────── Canvas root ────────────────────────────────── */
export default function Studio() {
  return (
    <DesignCanvas>
      <DCSection id="app" title="Maude — app shell" subtitle="MAUDE/APP · 6 artboards · dark studio + light handoff">
        <DCArtboard id="hero" label="A · studio · live" width={1440} height={900}><HeroStudio /></DCArtboard>
        <DCArtboard id="comments" label="B · review & presence" width={1440} height={900}><CommentsBoard /></DCArtboard>
        <DCArtboard id="annotate" label="C · annotate & draw" width={1440} height={900}><AnnotateBoard /></DCArtboard>
        <DCArtboard id="palette" label="D · command palette + what's new" width={1440} height={900}><PaletteBoard /></DCArtboard>
        <DCArtboard id="inspector" label="E · inspect & css knobs" width={1440} height={900}><InspectorBoard /></DCArtboard>
        <DCArtboard id="handoff" label="F · light · handoff & export" width={1440} height={900}><HandoffBoard /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
