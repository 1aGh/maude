/**
 * @canvas      06 Advanced — nothing deleted: every tool, action and debug tool that left the default view, and where it lives now
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ad-map | ad-why | ad-trace |
 *              ad-inspector | ad-left | ad-ai | ad-share | ad-timeline | ad-export | ad-history | ad-ds |
 *              ad-menus | ad-diag | ad-logs | ad-syncd |
 *              ad-settings |
 *              ad-pinned | ad-search | ad-open-all | ad-code |
 *              ad-edge-sync | ad-edge-syntax | ad-edge-hub | ad-edge-where | ad-edge-remember
 * @brief       "advanced mode" — "nechci mazat zadne tools nebo akce pripadne debug tools jako sync atd. Klidne to
 *              nekam schovat do menu abych se k tomu dostal ale opravdu nic nemazat" — "Advanced separately in each panel".
 *
 * THE DECISION (ad-why): there is NO sticky "Advanced mode" switch. Advanced is a LAYER INSIDE EACH PANEL — a
 * disclosure at the panel's foot — plus Menu › View › Advanced, Menu › Diagnostics (+ its Advanced),
 * Settings › Advanced, and Search ⌘K finds every one of them by name. Michal's literal "advanced mode" is answered
 * by a ONE-SHOT ⌘K action, "Open all Advanced sections" (ad-open-all) — the inverse of "Close all".
 *
 * THE PROOF (ad-map): ITEMS lists every thing visible in today's Maude (v2-feature-inventory.md, swept line by
 * line) that the v2 default view no longer shows. Each row has exactly one new home AND a `ref`: the artboard that
 * draws that home — an id in BOARDS (this canvas; numbers are computed from the order), "NN · <artboard id>" for
 * another v2 canvas, or null = "not drawn yet". Every count on the map is computed from this list.
 * Not counted: tools that moved into a toolbar (one click in the default view) — CONTRACT §2's two toolbars: Line ·
 * Ellipse · Polygon · Crop · Export area in Edit's More; Arrow, Highlighter (Marker's second tip), Eraser (a Marker
 * option) and Section on Preview's annotation toolbar; Insert became Edit's Image + Component — and NEW Advanced rows that
 * today's app doesn't have (fps, codec, colour profile, link expiry, file-name tokens).
 *
 * Convention (same as 01/03/04): app artboards are a <Stage> — a 1440 × 900 window + note strip (1440 × 980).
 * Close-ups are a local <Closeup> on the dotted canvas, title on top, note at the foot. Mono ONLY inside
 * Advanced bodies, Diagnostics and the code view. Local pieces use the `ad-` prefix (kit candidates in the report).
 * Cross-canvas: Timeline's Advanced is a fold at its FOOT with 07's timecode (07 · ve-advanced wins); the artboard
 * inspector's Advanced carries 08 · ak-advanced's sections (Exact size · Resolution · Colour · Guides · In code)
 * plus 06's Look and layout; print colour is "RGB — the print shop converts to CMYK"; export colour profiles are
 * 09's sRGB · Display P3.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./06 Advanced.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, Callout, Canvas, CanvasesPanel, GatorMock, HeroMock, Icon, InFill, InSeg, InSelect, InSize, InSwitch, Kbd, Menu,
  Note, PanelIcon, PricingMock, ProjectMenu, ProjectPill, SearchPalette, ShareCluster, Spark, Stage, StatusWord, TABS,
  Thumb, Toolbar, V2, Veil, VideoFrameMock, Window, ZoomUndo, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT,
} from "./_kit";
import type { Art, Folder, MenuItem, Tone } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];
const FREE: CSSProperties = { position: "relative", left: "auto", right: "auto", top: "auto", bottom: "auto" };

/* ═══ The artboards — numbers are computed from this order, so every "→ N" on the map checks itself ═══ */
const BOARDS = [
  ["ad-map", "The map"],
  ["ad-why", "Why there's no Advanced mode switch"],
  ["ad-trace", "One thing, end to end — Resync"],
  ["ad-inspector", "Inspector › Advanced"],
  ["ad-left", "Canvases and Layers › Advanced, and Trash"],
  ["ad-ai", "AI chat panel › Advanced (short)"],
  ["ad-share", "Share › Advanced"],
  ["ad-timeline", "Timeline › Advanced, at its foot"],
  ["ad-export", "Export › Advanced"],
  ["ad-history", "Version history › Advanced — the git, folded"],
  ["ad-ds", "The old design system view — now under Design system › Advanced"],
  ["ad-menus", "Menu › File, View › Advanced, Help"],
  ["ad-diag", "Menu › Diagnostics, Advanced open"],
  ["ad-logs", "Logs, Server, AI setup"],
  ["ad-syncd", "Sync details — the old Sync panel, whole"],
  ["ad-settings", "Settings › Advanced"],
  ["ad-pinned", "Pin panels to the side"],
  ["ad-search", "⌘K and ? — find any hidden tool"],
  ["ad-open-all", "“Advanced mode” as a one-shot — Open all"],
  ["ad-code", "The canvas as code, read-only"],
  ["ad-edge-sync", "Sync problem — words first, details folded"],
  ["ad-edge-syntax", "A canvas whose code is broken"],
  ["ad-edge-hub", "A project on a self-hosted hub"],
  ["ad-edge-where", "In the browser, comment-only, local, offline"],
  ["ad-edge-remember", "The remembered fold"],
] as const;
type BoardId = (typeof BOARDS)[number][0];
const bn = (id: BoardId) => BOARDS.findIndex((b) => b[0] === id) + 1;
const lab = (id: BoardId, label?: string) => `${bn(id)} · ${label ?? BOARDS[bn(id) - 1][1]}`;

/* ═══ The map data ════════════════════════════════════════════════════════════════════════════ */

type HomeId = "panel" | "menu" | "diag" | "settings";
const HOMES: { id: HomeId; title: string; sub: string; tone: Exclude<Tone, "grey">; unit: string }[] = [
  { id: "panel", title: "In its panel, under Advanced", sub: "the disclosure at the foot of that panel", tone: "sky", unit: "panels" },
  { id: "menu", title: "In the menu", sub: "Menu › File · Edit · View · Help, and View › Advanced", tone: "lilac", unit: "submenus" },
  { id: "diag", title: "Menu › Diagnostics", sub: "status in words; the tools under its Advanced", tone: "yellow", unit: "submenu" },
  { id: "settings", title: "Settings", sub: "General · Connections · Advanced", tone: "green", unit: "tabs" },
];
const TARGETS: { id: string; home: HomeId; label: string; head?: string }[] = [
  { id: "insp", home: "panel", label: "Inspector" },
  { id: "canv", home: "panel", label: "Canvases panel" },
  { id: "lay", home: "panel", label: "Layers" },
  { id: "assets", home: "panel", label: "Assets tab", head: "Assets — the left panel's third tab" },
  { id: "ds", home: "panel", label: "Design system", head: "Design system › Advanced — 13" },
  { id: "ai", home: "panel", label: "AI chat panel" },
  { id: "share", home: "panel", label: "Share" },
  { id: "tl", home: "panel", label: "Timeline" },
  { id: "exp", home: "panel", label: "Export" },
  { id: "vh", home: "panel", label: "Version history" },
  { id: "menu", home: "menu", label: "Menu › File · Edit · View · Help" },
  { id: "view", home: "menu", label: "Menu › View › Advanced" },
  { id: "diag", home: "diag", label: "Menu › Diagnostics" },
  { id: "setg", home: "settings", label: "Settings › General" },
  { id: "setc", home: "settings", label: "Settings › Connections" },
  { id: "seta", home: "settings", label: "Settings › Advanced" },
];
/* Where each thing sits in today's Maude (v2-feature-inventory.md sections). Numbered for the ledger pills. */
const SOURCES: { id: string; label: string }[] = [
  { id: "bar", label: "Menu bar and title bar" },
  { id: "status", label: "Status bar" },
  { id: "files", label: "Files panel" },
  { id: "canvas", label: "Canvas and right-click" },
  { id: "insp", label: "Inspector" },
  { id: "git", label: "Changes panel" },
  { id: "sync", label: "Sync panel and banners" },
  { id: "share", label: "Share dialog" },
  { id: "ai", label: "Assistant panel" },
  { id: "tl", label: "Timeline" },
  { id: "export", label: "Export dialog" },
  { id: "settings", label: "Settings, 7 tabs" },
  { id: "help", label: "Help, setup and ⌘K" },
];

/** Where the home is drawn: an artboard of this canvas, "NN · <id>" in another v2 canvas, or null = not drawn yet. */
type Ref = BoardId | `${"02" | "03" | "04" | "05" | "07" | "08" | "09" | "10" | "12" | "13"} · ${string}` | null;
const TRACE = "Resync";
/* [what, today's place, new home, where that home is drawn] */
const ITEMS: [string, string, string, Ref][] = [
  /* 1 · menu bar, title bar, banners */
  ["Six menus: File · Edit · View · Selection · Tools · Help", "bar", "menu", "ad-menus"],
  ["Mode stamp Idle · Canvas · System", "bar", "diag", "ad-logs"],
  ["Active file path", "bar", "canv", "ad-left"],
  ["“N artboards” count", "bar", "lay", "ad-left"],
  ["What's new megaphone", "bar", "menu", "ad-menus"],
  ["Report-a-bug icon", "bar", "menu", "ad-menus"],
  ["Export jobs badge", "bar", "exp", "ad-export"],
  ["Cloud account email and Sign out", "bar", "setc", "ad-edge-hub"],
  ["Browser “← Dashboard” link", "bar", "menu", "ad-menus"],
  ["Dock resize grips and tab strips", "bar", "view", "ad-pinned"],
  ["Update banner — Restart now · Later", "bar", "seta", "ad-settings"],
  ["Generate with AI… — provider, model, aspect", "bar", "ai", "ad-ai"],
  /* 18 · status bar */
  ["Selected element's selector", "status", "insp", "ad-inspector"],
  ["Open comments count", "status", "menu", "ad-menus"],
  ["Changes chip — N unsaved", "status", "vh", "ad-history"],
  ["Live / reconnecting dot", "status", "diag", "ad-logs"],
  ["Hub sync chip", "status", "diag", "ad-diag"],
  ["App version", "status", "seta", "ad-settings"],
  ["Light / dark toggle", "status", "setg", "02 · ob-settings"],
  /* 2 · files panel (+ its bottom docks) */
  ["Refresh tree ⇧⌘R", "files", "canv", "ad-left"],
  ["Live dot and shown / total count", "files", "canv", "ad-left"],
  ["Show hidden files (H)", "files", "canv", "ad-left"],
  ["Sidecar files — .meta.json, .css", "files", "canv", "ad-left"],
  ["Runtime · gitignored section", "files", "canv", "ad-left"],
  ["Rename a supporting file", "files", "canv", "ad-left"],
  ["Design system folder path", "files", "canv", "ad-left"],
  ["Preview of non-canvas files — md, fonts, audio", "files", "canv", null],
  ["Imported-from-Figma and experimental badges", "files", "canv", null],
  ["Unsaved badges M · A · D · U", "files", "vh", "ad-history"],
  ["Branch switcher", "files", "vh", "ad-history"],
  ["Pull a local copy", "files", "vh", "ad-history"],
  ["“Continue on <draft>” chip", "files", "vh", "ad-history"],
  ["Open another folder or team project", "files", "menu", "ad-menus"],
  ["Sign in with GitHub", "files", "setc", "ad-edge-hub"],
  ["Open the cloud dashboard", "files", "setg", "02 · ob-settings"],
  ["New GitHub project — visibility, description", "files", "menu", "02 · ob-adv-sheets"],
  /* 3 · canvas, right-click, overlays */
  ["“localhost:PORT” and version line", "canvas", "diag", "ad-diag"],
  ["Copy CSS", "canvas", "insp", "ad-inspector"],
  ["Copy data-cd-id", "canvas", "insp", "ad-inspector"],
  ["Copy style · Paste style", "canvas", "insp", "ad-inspector"],
  ["Convert layout to absolute", "canvas", "insp", "ad-inspector"],
  ["Artboard theme — DS default · Follow chrome", "canvas", "insp", "ad-inspector"],
  ["Reset position · Fit just this artboard", "canvas", "insp", "ad-inspector"],
  ["Minimap", "canvas", "view", "ad-menus"],
  ["Zoom controls", "canvas", "view", "ad-menus"],
  ["Print guides", "canvas", "view", "ad-menus"],
  ["Export project ZIP, canvas as separate", "canvas", "exp", "09 · ex-formats"],
  ["Asset picker — Upload…, thumbnails, Insert", "canvas", "assets", "12 · ia-assets-panel"],
  ["Design system view — S key, picker", "canvas", "ds", "13 · ds-advanced"],
  ["Token and type ladders, preview galleries", "canvas", "ds", "13 · ds-advanced"],
  ["Raw system folder and MAUDE-DSN/01", "canvas", "ds", "13 · ds-advanced"],
  /* 4 · inspector */
  ["CSS tab — raw properties", "insp", "insp", "ad-inspector"],
  ["Tag and Class", "insp", "insp", "ad-inspector"],
  ["Custom CSS property rows", "insp", "insp", "ad-inspector"],
  ["HTML attribute rows", "insp", "insp", "ad-inspector"],
  ["Token popover per design system", "insp", "insp", "ad-inspector"],
  ["Grid tracks editor", "insp", "insp", "ad-inspector"],
  ["Body layout select", "insp", "insp", "ad-inspector"],
  ["Edit scope — Local · Shared, Detach", "insp", "insp", "ad-inspector"],
  ["Layer tags", "insp", "lay", "ad-left"],
  ["Layer ids — the DOM tree", "insp", "lay", "ad-left"],
  ["Layers as a separate panel", "insp", "view", "ad-menus"],
  /* 7 · git */
  ["Branch names and New branch", "git", "vh", "ad-history"],
  ["SHA on every version", "git", "vh", "ad-history"],
  ["Fetch remote branches", "git", "vh", "ad-history"],
  ["“Add to shared” — opens a PR", "git", "vh", "ad-history"],
  ["Save version with a message", "git", "vh", "ad-history"],
  ["Publish changes", "git", "vh", "ad-history"],
  ["Discard a file's changes", "git", "vh", "ad-history"],
  ["Get latest", "git", "diag", "ad-syncd"],
  /* 8 · sync */
  [TRACE, "sync", "diag", "ad-diag"],
  ["Download all", "sync", "diag", "ad-diag"],
  ["Held · rate-limited · failed lists", "sync", "diag", "ad-syncd"],
  ["Asset transfers with Cancel", "sync", "diag", "ad-syncd"],
  ["Conflict — Keep mine · Use theirs · Keep both", "sync", "diag", "ad-syncd"],
  ["Unfinished AI edit — Publish · Discard", "sync", "diag", "ad-syncd"],
  ["“Sign in again” when sync stops", "sync", "diag", "ad-syncd"],
  ["Hints — maude design status, /design:rollback", "sync", "diag", "ad-syncd"],
  ["“Repo state changed — reload?”", "sync", "diag", "ad-diag"],
  ["Trash — clear out old files", "sync", "canv", "ad-left"],
  ["Sync project files · Propagate deletions", "sync", "seta", "ad-settings"],
  ["First-link conflicts rule", "sync", "seta", "ad-settings"],
  ["Hand .design/ to the workspace", "sync", "seta", "ad-settings"],
  ["Sync canvases only or everything", "sync", "seta", "ad-settings"],
  /* 9 · share */
  ["Local link — this Mac only", "share", "share", "ad-share"],
  ["Open in Maude app link", "share", "share", "ad-share"],
  ["Invite by GitHub username", "share", "share", "ad-share"],
  /* 12 · assistant */
  ["Model · Effort · Fast mode", "ai", "ai", "ad-ai"],
  ["Permission mode", "ai", "ai", "ad-ai"],
  ["Transcript view — thinking, verbose", "ai", "ai", "ad-ai"],
  ["Context % and token counts", "ai", "ai", "ad-ai"],
  ["Slash-command quick actions", "ai", "ai", "ad-ai"],
  ["Tool-call cards in the feed", "ai", "ai", "ad-ai"],
  ["Readiness list — Claude Code", "ai", "diag", "ad-logs"],
  /* 13 · timeline */
  ["Frame readout", "tl", "tl", "ad-timeline"],
  ["Long-comp badge", "tl", "tl", "ad-timeline"],
  ["Keyframe markers", "tl", "tl", "ad-timeline"],
  /* 10 · export */
  ["PNG at 150 · 300 · 600 dpi", "export", "exp", "ad-export"],
  ["PDF quality and text outlines", "export", "exp", "ad-export"],
  ["Crop and registration marks", "export", "exp", "ad-export"],
  ["AI handoff — copies /design:handoff", "export", "exp", "ad-export"],
  ["HTML · PowerPoint · Canva formats", "export", "exp", "09 · ex-formats"],
  ["Render service note", "export", "exp", "09 · ex-advanced"],
  /* Settings */
  ["Inspector vocabulary Advanced · Designer", "settings", "insp", "ad-inspector"],
  ["Auto-open inspector on select", "settings", "view", "ad-menus"],
  ["Panel positions left / right", "settings", "view", "ad-pinned"],
  ["AI provider keys", "settings", "setc", "ad-edge-hub"],
  ["Figma token", "settings", "setc", "ad-edge-hub"],
  ["Where keys are kept — keys.json", "settings", "seta", "ad-settings"],
  ["Transcription engine and whisper model", "settings", "seta", "ad-settings"],
  ["Keyframe engine and Gemma model", "settings", "seta", "ad-settings"],
  ["Install Claude Code automatically", "settings", "seta", "ad-settings"],
  /* 17 · help, setup, ⌘K */
  ["Help: slash commands, opt-out, critic loop", "help", "menu", "ad-menus"],
  ["Quick setup — brand, Figma import", "help", "menu", "ad-menus"],
  ["Handoff to production ⇧⌘H", "help", "menu", "ad-menus"],
  ["Server build name MAUDE-DEV-SRV", "help", "seta", "ad-settings"],
  ["Draw with the SVG agent — copies /design:draw", "help", "seta", "ad-settings"],
  ["Brand upload “Copy command”", "help", "seta", "ad-settings"],
  ["Check AI editing readiness…", "help", "diag", "ad-diag"],
  ["The claude binary path", "help", "diag", "ad-logs"],
  ["Reload canvas ⌘R", "help", "diag", "ad-diag"],
  ["Server log tail", "help", "diag", "ad-logs"],
  ["Team hub address and access token", "help", "setc", "ad-edge-hub"],
  ["Your team's own server — email, password", "help", "setc", "ad-edge-hub"],
];
const TOTAL = ITEMS.length;
const isLocal = (r: Ref): r is BoardId => !!r && BOARDS.some((b) => b[0] === r);
const DRAWN_HERE = ITEMS.filter((i) => isLocal(i[3])).length;
const DRAWN_ELSE = ITEMS.filter((i) => i[3] && !isLocal(i[3])).length;
const NOT_DRAWN = TOTAL - DRAWN_HERE - DRAWN_ELSE;
const tgtHome = (t: string) => TARGETS.find((x) => x.id === t)!.home;
const homeTone = (h: HomeId) => HOMES.find((x) => x.id === h)!.tone;
const countBy = (f: (i: [string, string, string, Ref]) => boolean) => ITEMS.filter(f).length;
const srcNo = (s: string) => SOURCES.findIndex((x) => x.id === s) + 1;

/* ═══ Local pieces (kit candidates — see report) ══════════════════════════════════════════════ */

/** A close-up on the dotted canvas: title on top, the pieces, the note at the foot. */
function Closeup({ title, sub, note, children, theme = "light", className = "" }: { title: ReactNode; sub?: ReactNode; note: ReactNode; children: ReactNode; theme?: "light" | "dark"; className?: string }) {
  return (
    <V2 theme={theme} className={`ad-closeup ${className}`}>
      <div className="ad-closeup-hd">
        <p className="ad-closeup-h">{title}</p>
        {sub ? <p className="ad-closeup-sub">{sub}</p> : null}
      </div>
      <div className="ad-closeup-body">{children}</div>
      <div className="ad-closeup-note">{note}</div>
    </V2>
  );
}

/** A labelled column in a close-up: "Closed — what everyone sees" / "Advanced open". */
function Col({ label, open = false, children, width, style }: { label: ReactNode; open?: boolean; children: ReactNode; width?: number; style?: CSSProperties }) {
  return (
    <div className="ad-col" style={{ width, ...style }}>
      <span className={`ad-col-l${open ? " ad-col-l--open" : ""}`}><Icon name={open ? "chevron" : "submenu"} size={12} />{label}</span>
      {children}
    </div>
  );
}

/** The panel-foot disclosure. Closed: one quiet row + what's inside (≤ 3 nouns). Open: the body (mono allowed inside). */
function Fold({ open = false, hint, children, label = "Advanced", remembered = false }: { open?: boolean; hint?: string; children?: ReactNode; label?: string; remembered?: boolean }) {
  return (
    <div className="k-adv ad-fold" data-open={open ? "true" : undefined}>
      <span className="k-adv-btn">
        <span className="k-adv-ch"><Icon name="submenu" size={12} /></span>{label}
        {remembered ? <span className="ad-kept" title="Stays open next time"><Icon name="pin" size={11} />kept open</span> : null}
        {!open && hint ? <span className="k-adv-count">{hint}</span> : null}
      </span>
      {open ? <div className="ad-fold-body">{children}</div> : null}
    </div>
  );
}

/** A row inside Advanced: plain words on the left, the value (often mono) on the right. */
function ARow({ k, children, mono = false, copy = false }: { k: ReactNode; children?: ReactNode; mono?: boolean; copy?: boolean }) {
  return (
    <div className="ad-row">
      <span className="ad-row-k">{k}</span>
      <span className={`ad-row-v${mono ? " k-mono" : ""}`}>{children}</span>
      {copy ? <CopyBtn /> : null}
    </div>
  );
}
function ASub({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <p className="ad-sub">{children}{aside ? <span className="ad-sub-a">{aside}</span> : null}</p>;
}
function CopyBtn({ label }: { label?: string }) {
  return label ? <span className="btn btn--ghost btn--sm ad-copy"><Icon name="duplicate" size={12} />{label}</span> : <span className="icon-btn ad-copy-i" title="Copy"><Icon name="duplicate" size={12} /></span>;
}
function Btn({ children, primary = false, ghost = false, icon }: { children: ReactNode; primary?: boolean; ghost?: boolean; icon?: string }) {
  return <span className={`btn btn--sm${primary ? " btn--primary" : ""}${ghost ? " btn--ghost" : ""}`}>{icon ? <Icon name={icon} size={12} /> : null}{children}</span>;
}
/** A command line — mono, with Copy. */
function Cmd({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="ad-cmd">
      <span className="ad-cmd-t">{note ? <span className="ad-cmd-n">{note}</span> : null}<span className="k-mono ad-cmd-c">{children}</span></span>
      <CopyBtn />
    </div>
  );
}
function PathChip({ children }: { children: ReactNode }) {
  return <span className="chip ad-path">{children}</span>;
}
function Css({ k, v, attr = false }: { k: string; v: string; attr?: boolean }) {
  return <div className={`k-css ad-css${attr ? " ad-css--attr" : ""}`}><span className="k-mono k-css-k">{k}</span><span className="k-mono k-css-v">{v}</span></div>;
}
function Badge({ s }: { s: "M" | "A" | "D" | "U" }) {
  return <span className={`ad-badge ad-badge--${s}`}>{s}</span>;
}
function Arrow() {
  return <span className="ad-arrow"><Icon name="submenu" size={16} /></span>;
}
/** "Drawn in N" — the cross-reference chip used under pieces that point at another artboard. */
function See({ children }: { children: ReactNode }) {
  return <span className="ad-see"><Icon name="submenu" size={11} />{children}</span>;
}

/** A free-standing inspector (title, plain rows, then the Advanced fold). */
function Insp({ title, kind, rows, fold, width = 288, style }: { title: string; kind: string; rows: [string, ReactNode][]; fold: ReactNode; width?: number; style?: CSSProperties }) {
  return (
    <div className="island island--pad k-insp ad-insp" style={{ ...FREE, width, ...style }}>
      <div className="k-insp-hd"><strong>{title}</strong><span className="chip">{kind}</span></div>
      {rows.map(([k, v]) => <div className="k-insp-row" key={k}><span>{k}</span>{v}</div>)}
      {fold}
    </div>
  );
}

/* ─── Inspector content (Studio site · Homepage · “Book a call”) ─── */
const BTN_ROWS: [string, ReactNode][] = [
  ["Size", <InSize w={150} h={48} />],
  ["Padding", <span className="ad-val">12 · 24</span>],
  ["Fill", <InFill name="Ink" tone="ink" />],
  ["Text", <span className="ad-val">SF Pro · 19 · Semibold</span>],
  ["Corners", <span className="ad-val">Round</span>],
];
function BtnAdvanced() {
  return (
    <>
      <ASub>Element</ASub>
      <ARow k="Tag" mono>a</ARow>
      <ARow k="Classes" mono>btn btn--primary</ARow>
      <ARow k="Selector" mono>nav &gt; a.btn</ARow>
      <ARow k="Element id" mono copy>cd-4f1a2c</ARow>
      <ASub>Used in</ASub>
      <ARow k="Edits apply to"><span className="ad-inline"><span className="ad-val">Shared · 4 places</span><Btn ghost>Detach</Btn></span></ARow>
      <ASub>Tokens bound</ASub>
      <ARow k="Fill" mono>--ink</ARow>
      <ARow k="Text colour" mono>--paper</ARow>
      <ARow k="Corners" mono>--radius-pill</ARow>
      <ASub aside={<span className="ad-link">Edit as text</span>}>CSS</ASub>
      <div className="ad-csslist">
        <Css k="padding" v="12px 24px" />
        <Css k="border-radius" v="999px" />
        <Css k="background" v="var(--ink)" />
        <Css k="font" v="600 19px/1.4 SF Pro Text" />
        <Css k="aria-label" v="“Book a call”" attr />
      </div>
      <div className="ad-acts">
        <Btn ghost icon="plus">Property</Btn>
        <Btn ghost icon="plus">Attribute</Btn>
      </div>
      <div className="ad-acts ad-acts--end ad-acts--wrap">
        <Btn>Copy style</Btn>
        <Btn>Paste style</Btn>
        <Btn>Copy CSS</Btn>
        <Btn primary icon="duplicate">Copy code</Btn>
      </div>
    </>
  );
}
/** The artboard's Advanced — 08 · ak-advanced's sections first (they win), then 06's Look and layout. */
function ArtboardAdvanced() {
  return (
    <>
      <ASub>Exact size</ASub>
      <ARow k="Artboard" mono>1440 × 900 px</ARow>
      <ARow k="Position"><span className="ad-inline"><span className="k-mono ad-mono-sm">x 0 · y 0</span><Btn ghost>Reset position</Btn></span></ARow>
      <ASub>Resolution</ASub>
      <ARow k="Canvas" mono>96 px per inch</ARow>
      <ARow k="Exports at" mono>2× · 2880 × 1800</ARow>
      <ASub>Colour</ASub>
      <ARow k="Designed in" mono>sRGB</ARow>
      <ASub aside={<span className="ad-link">Add</span>}>Guides</ASub>
      <ARow k="Columns" mono>12 · gutter 24 · margin 80</ARow>
      <ASub>Look and layout</ASub>
      <ARow k="Theme"><InSelect value="DS default" /></ARow>
      <ARow k="Body layout"><InSelect value="Column" /></ARow>
      <ARow k="Grid tracks"><Btn ghost>Edit tracks…</Btn></ARow>
      <ARow k="Layout"><Btn ghost>Convert to absolute…</Btn></ARow>
      <ASub>In code</ASub>
      <pre className="ad-pre k-mono">{`<DCArtboard id="desktop" kind="web"
  width={1440} height={900}>`}</pre>
      <ARow k="File" mono copy>Homepage.tsx · line 18</ARow>
      <div className="ad-acts ad-acts--end"><Btn primary icon="duplicate">Copy code</Btn></div>
    </>
  );
}

/* ─── Alligators: Combine-kampan at 20 % ─── */
function Kampan({ x = 120, y = 120, dim = false, sel, changed, sizes = true }: { x?: number; y?: number; dim?: boolean; sel?: string; changed?: string; sizes?: boolean }) {
  const at = (dx: number, dy: number) => ({ x: x + dx, y: y + dy });
  return (
    <>
      <Artboard label="Web · STAŇ SE GATOREM" kind="web" {...at(0, 0)} w={288} h={180} dim={dim} selected={sel === "web"} size="1440 × 900"><GatorMock variant="web" /></Artboard>
      <Artboard label="Post 1:1 · Combine 2026" kind="digital" {...at(328, 0)} w={216} h={216} dim={dim} selected={sel === "post"} size={sizes ? "1080 × 1080" : undefined}><div className={changed === "post" ? "ad-post-green" : undefined}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
      <Artboard label="A4 · plakát" kind="print" {...at(584, 0)} w={159} h={225} dim={dim} selected={sel === "a4"} size="210 × 297 mm"><GatorMock variant="poster" /></Artboard>
      <Artboard label="Story 9:16 · Zapiš se" kind="digital" {...at(0, 274)} w={216} h={384} dim={dim}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
      <Artboard label="Reels · nábor" kind="video" {...at(256, 274)} w={216} h={384} dim={dim} selected={sel === "reel"} size="1080 × 1920"><VideoFrameMock vertical caption="STAŇ SE GATOREM" time="0:04 / 0:15" /></Artboard>
    </>
  );
}

/* ═══ 1 · The map ═════════════════════════════════════════════════════════════════════════════ */

const SK = { w: 1344, u: 5, lg: 10, rg: 6, gg: 34, cap: 48, lx: 252, rx: 884, bar: 6 };

function Sankey() {
  const srcN = SOURCES.map((s) => countBy((i) => i[1] === s.id));
  const tgtN = TARGETS.map((t) => countBy((i) => i[2] === t.id));
  /* right column: groups of targets with a caption above each home */
  const tgtY: number[] = [];
  const caps: { home: HomeId; y: number; y0: number; y1: number }[] = [];
  let y = 0;
  TARGETS.forEach((t, i) => {
    if (i === 0 || TARGETS[i - 1].home !== t.home) {
      y += i === 0 ? SK.cap : SK.gg;
      caps.push({ home: t.home, y: y - 10, y0: y, y1: y });
    }
    tgtY.push(y);
    y += tgtN[i] * SK.u;
    caps[caps.length - 1].y1 = y;
    y += SK.rg;
  });
  const rightH = y - SK.rg;
  const leftH = srcN.reduce((a, n) => a + n * SK.u, 0) + (SOURCES.length - 1) * SK.lg;
  const h = Math.max(rightH, leftH) + 8;
  const lOff = SK.cap + (rightH - SK.cap - leftH) / 2;
  const srcY: number[] = [];
  let ly = lOff;
  srcN.forEach((n) => { srcY.push(ly); ly += n * SK.u + SK.lg; });

  /* bands: sources outer, targets inner — incoming bands stack in source order (fewest crossings).
     The traced item (Resync) gets its own one-unit ribbon on top of its band. */
  const sCur = [...srcY];
  const tCur = [...tgtY];
  const bands: { d: string; tone: string; key: string }[] = [];
  let trace: { d: string; lx: number; ly: number } | null = null;
  const x0 = SK.lx + SK.bar;
  const x1 = SK.rx;
  const mid = (x0 + x1) / 2;
  const ribbon = (a0: number, a1: number, b0: number, b1: number) => `M${x0},${a0} C${mid},${a0} ${mid},${b0} ${x1},${b0} L${x1},${b1} C${mid},${b1} ${mid},${a1} ${x0},${a1} Z`;
  SOURCES.forEach((s, si) => {
    TARGETS.forEach((t, ti) => {
      const inBand = ITEMS.filter((i) => i[1] === s.id && i[2] === t.id);
      const c = inBand.length;
      if (!c) return;
      const a0 = sCur[si], a1 = a0 + c * SK.u, b0 = tCur[ti], b1 = b0 + c * SK.u;
      sCur[si] = a1; tCur[ti] = b1;
      bands.push({ key: s.id + t.id, tone: homeTone(t.home), d: ribbon(a0, a1, b0, b1) });
      const k = inBand.findIndex((i) => i[0] === TRACE);
      if (k >= 0) {
        const ta0 = a0 + k * SK.u, tb0 = b0 + k * SK.u;
        trace = { d: ribbon(ta0, ta0 + SK.u, tb0, tb0 + SK.u), lx: mid, ly: (ta0 + tb0) / 2 + SK.u / 2 };
      }
    });
  });
  const tr = trace as { d: string; lx: number; ly: number } | null;

  return (
    <svg className="ad-sk" width={SK.w} height={h} viewBox={`0 0 ${SK.w} ${h}`} role="img" aria-label={`${TOTAL} things from ${SOURCES.length} places in today's Maude flow into ${TARGETS.length} homes in v2`}>
      <text x={0} y={12} className="ad-sk-h">Today — where it is visible</text>
      <text x={SK.rx} y={12} className="ad-sk-h">v2 — where it lives</text>
      {bands.map((b) => <path key={b.key} d={b.d} className={`ad-sk-band ad-sk-band--${b.tone}`} />)}
      {tr ? (
        <g>
          <path d={tr.d} className="ad-sk-trace" />
          <text x={tr.lx} y={tr.ly - 10} className="ad-sk-trace-t" textAnchor="middle">{TRACE} — traced end to end in {bn("ad-trace")}</text>
        </g>
      ) : null}
      {SOURCES.map((s, i) => {
        const cy = srcY[i] + (srcN[i] * SK.u) / 2;
        return (
          <g key={s.id}>
            <rect x={SK.lx} y={srcY[i]} width={SK.bar} height={srcN[i] * SK.u} rx={2} className="ad-sk-node" />
            <circle cx={9} cy={cy} r={8} className="ad-sk-pill" />
            <text x={9} y={cy} className="ad-sk-pn" textAnchor="middle" dominantBaseline="central">{i + 1}</text>
            <text x={24} y={cy} className="ad-sk-t" dominantBaseline="central">{s.label}</text>
            <text x={SK.lx - 8} y={cy} className="ad-sk-n" textAnchor="end" dominantBaseline="central">{srcN[i]}</text>
          </g>
        );
      })}
      {TARGETS.map((t, i) => {
        const cy = tgtY[i] + (tgtN[i] * SK.u) / 2;
        return (
          <g key={t.id}>
            <rect x={SK.rx} y={tgtY[i]} width={SK.bar} height={Math.max(tgtN[i] * SK.u, 2)} rx={2} className={`ad-sk-tnode ad-sk-tnode--${homeTone(t.home)}`} />
            <text x={SK.rx + 16} y={cy} className="ad-sk-t" dominantBaseline="central">{t.label}</text>
            <text x={SK.rx + 236} y={cy} className="ad-sk-n" textAnchor="end" dominantBaseline="central">{tgtN[i]}</text>
          </g>
        );
      })}
      {caps.map((c) => {
        const home = HOMES.find((x) => x.id === c.home)!;
        const n = countBy((i) => tgtHome(i[2]) === c.home);
        const places = TARGETS.filter((t) => t.home === c.home).length;
        const cy = (c.y0 + c.y1) / 2;
        return (
          <g key={c.home}>
            <circle cx={SK.rx + 4} cy={c.y - 2} r={4} className={`ad-sk-dot ad-sk-dot--${home.tone}`} />
            <text x={SK.rx + 14} y={c.y - 2} className="ad-sk-cap" dominantBaseline="central">{home.title}</text>
            <line x1={SK.rx + 262} y1={c.y0} x2={SK.rx + 262} y2={c.y1} className="ad-sk-brace" />
            <text x={SK.w} y={cy - 6} className="ad-sk-big" textAnchor="end" dominantBaseline="central">{n}</text>
            <text x={SK.w} y={cy + 18} className="ad-sk-bigl" textAnchor="end" dominantBaseline="central">{c.home === "diag" ? "one submenu" : `in ${places} ${home.unit}`}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RefChip({ r }: { r: Ref }) {
  if (!r) return <span className="ad-ref-c ad-ref-c--none" title="Its home is decided but not drawn yet">not drawn yet</span>;
  if (isLocal(r)) return <span className="ad-ref-c" title={BOARDS[bn(r) - 1][1]}>→ {bn(r)}</span>;
  return <span className="ad-ref-c ad-ref-c--ext" title="Drawn in another v2 canvas">→ {r}</span>;
}

function Ledger() {
  const cols: string[][] = [["insp", "canv", "lay", "assets", "ds"], ["ai", "share", "tl", "exp", "vh"], ["menu", "view", "diag"], ["setg", "setc", "seta"]];
  return (
    <div className="ad-ledger">
      {cols.map((ids, ci) => (
        <div className="ad-lcol" key={ci}>
          {ids.map((id) => {
            const t = TARGETS.find((x) => x.id === id)!;
            const rows = ITEMS.filter((i) => i[2] === id);
            return (
              <div className="ad-lgrp" key={id}>
                <p className="ad-lgrp-h"><i className={`ad-dot ad-dot--${homeTone(t.home)}`} />{t.head ?? (t.home === "panel" ? `${t.label} › Advanced` : t.label)}<span className="ad-lgrp-n">{rows.length}</span></p>
                {rows.map(([what, src, , ref]) => (
                  <span className={`ad-lrow${what === TRACE ? " ad-lrow--trace" : ""}${ref ? "" : " ad-lrow--open"}`} key={what}>
                    <span className="ad-lpill" title={SOURCES[srcNo(src) - 1].label}>{srcNo(src)}</span>
                    <span className="ad-ltxt">{what}</span>
                    <RefChip r={ref} />
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MapBoard() {
  return (
    <V2 className="ad-map">
      <div className="ad-map-hd">
        <p className="ad-map-h">Nothing deleted. {TOTAL} things left the default view — each has one new home.</p>
        <p className="ad-map-sub">Left: where each thing is visible in today's Maude. Right: where it lives in v2. Every row says which artboard draws its home — “→ {bn("ad-inspector")}” is this canvas, “→ 09 · ex-formats” is another v2 canvas. Search ⌘K finds each one by name ({bn("ad-search")}).</p>
        <div className="ad-stats">
          <span className="ad-stat"><b>{TOTAL}</b><span>moved out of sight</span></span>
          <span className="ad-stat ad-stat--zero"><b>0</b><span>deleted</span></span>
          <span className="ad-stat-sep" />
          <span className="ad-stat"><b>{DRAWN_HERE}</b><span>home drawn on this canvas</span></span>
          <span className="ad-stat"><b>{DRAWN_ELSE}</b><span>drawn in another v2 canvas</span></span>
          <span className="ad-stat ad-stat--open"><b>{NOT_DRAWN}</b><span>not drawn yet</span></span>
          <span className="ad-stat-gap" />
          {HOMES.map((h) => (
            <span className="ad-stat ad-stat--home" key={h.id}><i className={`ad-dot ad-dot--${h.tone}`} /><b>{countBy((i) => tgtHome(i[2]) === h.id)}</b><span>{h.title}</span></span>
          ))}
        </div>
      </div>
      <div className="ad-map-sk"><Sankey /></div>
      <div className="ad-map-lh">
        <p className="ad-map-h2">Every one of the {TOTAL}, by its new home — and where that home is drawn</p>
        <p className="ad-map-lsub">The number on the left is where it sits today: {SOURCES.map((s, i) => <span key={s.id} className="ad-lkey"><span className="ad-lpill">{i + 1}</span>{s.label}</span>)}</p>
      </div>
      <Ledger />
      <div className="ad-map-note">
        <Note title="Counted, not estimated.">Each row is a thing visible in today's app that the v2 default view no longer shows, swept line by line from the feature inventory; every number here is computed from that one list. Not counted: Trash (still the Canvases panel's last row), tools now in a toolbar, one click away (Edit's More; Arrow, Highlighter, Eraser and Section on Preview's toolbar; Insert as Image and Component), Export's Scope (now on the sheet itself, as in 09), and new Advanced rows (fps, codec, colour profile, link expiry).</Note>
      </div>
    </V2>
  );
}

/* ─── Why there is no switch ─── */
function MiniWin({ variant }: { variant: "switch" | "panel" | "all" }) {
  const sw = variant === "switch";
  const all = variant === "all";
  const lines = (n: number, mono = false) => Array.from({ length: n }, (_, i) => <i key={i} className={mono ? "ad-mw-mono" : undefined} style={{ width: `${[78, 54, 66, 40, 72, 58, 46, 80, 62][i % 9]}%` }} />);
  const fold = (open: boolean, n = 3) => (open ? <><span className="ad-mw-fold" data-open="true">Advanced</span>{lines(n, true)}</> : <span className="ad-mw-fold">Advanced</span>);
  return (
    <div className={`ad-mw ad-mw--${variant}`}>
      <div className="ad-mw-top">
        <span className="ad-mw-pill"><Icon name="menu" size={10} />Studio site</span>
        {sw ? <span className="ad-mw-switch"><span className="switch k-switch" aria-checked="true" />Advanced mode</span> : null}
        <span className="ad-mw-share">Share</span>
      </div>
      <div className="ad-mw-body">
        <div className="ad-mw-isl ad-mw-isl--left"><b>Canvases</b>{lines(sw ? 9 : 4, sw)}{sw ? <em className="k-mono">_history/ · .meta.json</em> : fold(all, 2)}</div>
        <div className="ad-mw-art"><span /></div>
        <div className="ad-mw-col">
          <div className="ad-mw-isl"><b>Inspector</b>{lines(2)}{fold(true, 4)}</div>
          <div className="ad-mw-isl"><b>Share</b>{lines(sw ? 4 : 1, sw)}{sw ? <em className="k-mono">localhost:4402</em> : fold(all, 2)}</div>
          <div className="ad-mw-isl ad-mw-isl--ai"><b><Spark size={8} /> AI</b>{lines(sw ? 4 : 1, sw)}{sw ? <em className="k-mono">c-mg4x1k · opus</em> : fold(all, 2)}</div>
        </div>
      </div>
    </div>
  );
}

function WhyBoard() {
  const paths: { icon: ReactNode; t: string; d: ReactNode }[] = [
    { icon: <Kbd>⌘K</Kbd>, t: "Search finds every hidden tool", d: <>By name, with its home beside it: “raw css”, “resync”, “branch”, “port”. ↵ runs it.</> },
    { icon: <span className="ad-keys"><Kbd>⌘K</Kbd><span className="ad-fast-q">open advanced</span></span>, t: "Open all Advanced, once", d: <>The “advanced mode” you asked for, as a one-shot: every fold opens, nothing stays switched on ({bn("ad-open-all")}).</> },
    { icon: <span className="ad-keys"><Kbd>⇧⌘I</Kbd><Kbd>⌥⌘H</Kbd><Kbd>⌘R</Kbd></span>, t: "Keys go straight there", d: <>Inspector, Version history, Reload canvas, Keep timeline open ⇧⌘T. <Kbd>?</Kbd> lists them all.</> },
    { icon: <Icon name="pin" size={16} />, t: "Open once, stays open", d: <>An Advanced you open is open next time — for that panel, on this Mac ({bn("ad-edge-remember")}).</> },
    { icon: <Icon name="panel-left" size={16} />, t: "Pin panels to the side", d: <>Menu › View › Advanced: docked panels with handles, for a fixed working room.</> },
    { icon: <Icon name="settings" size={16} />, t: "Settings › Advanced", d: <>One place for this Mac and this project: port, plugins, engines, flags, reset.</> },
  ];
  return (
    <Closeup title="Why there's no “Advanced mode” switch" sub="You need one detail in one panel — not every panel turned inside out at once, and not left that way." note={<Note n={bn("ad-why")} title="A disclosure where you are, never a second app.">A sticky switch would flood every panel and make screenshots, help and teammates disagree about what the app looks like. Detail opens in the panel you're in; the six paths below keep power users fast.</Note>}>
      <div className="ad-why">
        <div className="ad-why-card ad-why-card--no">
          <span className="chip ad-why-tag"><Icon name="close" size={12} />Not this</span>
          <MiniWin variant="switch" />
          <ul className="ad-why-list">
            <li>One switch opens raw detail in every panel at once.</li>
            <li>Two versions of the app to learn, document and support.</li>
            <li>Easy to leave on — the calm default is gone for good.</li>
          </ul>
        </div>
        <div className="ad-why-card ad-why-card--yes">
          <span className="chip chip--accent ad-why-tag"><Icon name="check" size={12} />This</span>
          <MiniWin variant="panel" />
          <ul className="ad-why-list">
            <li>Advanced sits at the foot of each panel, folded.</li>
            <li>Open it in the inspector; the rest of the app stays calm.</li>
            <li>The same panel, the same words, one layer deeper.</li>
          </ul>
        </div>
      </div>
      <p className="ad-why-h">Still fast for people who live in Advanced</p>
      <div className="ad-fast">
        {paths.map((p) => (
          <div className="island island--pad ad-fast-card" key={p.t}>
            <span className="ad-fast-ic">{p.icon}</span>
            <strong>{p.t}</strong>
            <span className="ad-fast-d">{p.d}</span>
          </div>
        ))}
      </div>
    </Closeup>
  );
}

/* ─── One item, end to end ─── */
function TraceBoard() {
  return (
    <Closeup title="One thing, end to end — Resync" sub="Where it was, where it lives now, what it does, and what you see afterwards. Alligators brand, cloud-linked, 1 318 files."
      note={<Note n={bn("ad-trace")} title="Every thing has a home — and a way back to it.">Resync left the always-visible Sync panel. It now lives under Menu › Diagnostics › Advanced; ⌘K “resync” runs it from anywhere, and Sync details points to it. Same verb in all three places.</Note>}>
      <div className="ad-trace">
        <div className="ad-tr-step">
          <span className="ad-tr-n"><b>1</b>Where it was</span>
          <div className="island island--pad ad-tr-old">
            <div className="ad-tr-old-hd"><strong>Sync</strong><span className="ad-tr-oldbtn">Download all</span><span className="ad-tr-oldbtn ad-tr-oldbtn--hl">Resync</span></div>
            <span className="ad-tr-oldrow">Project files · 1 318</span>
            <span className="ad-tr-oldrow">Assets · 247</span>
            <span className="ad-tr-oldrow">Held · rate-limited · failed — 0</span>
          </div>
          <p className="ad-tr-d">Today: a button in the Sync panel's header, docked and always in sight on every linked project.</p>
          <PathChip>Map: source 7 → Menu › Diagnostics</PathChip>
        </div>
        <Arrow />
        <div className="ad-tr-step ad-tr-step--wide">
          <span className="ad-tr-n"><b>2</b>Where it lives</span>
          <Menu width={300} style={FREE} items={[
            { label: "Sync", note: "Up to date" }, { label: "Server", note: "Running" }, { label: "AI setup", note: "Ready" }, "sep",
            { label: "Logs" }, { label: "Reload canvas", keys: "⌘R" }, { label: "Check AI setup again" }, "sep",
            { group: "Advanced" }, { label: "Address", note: "localhost:4402" }, { label: "Project folder", note: "~/Maude/alligators" },
            { label: "Resync now", highlight: true, icon: "sync" }, { label: "Download all", icon: "export" },
          ]} />
          <p className="ad-tr-d">Menu › Diagnostics › Advanced ({bn("ad-diag")}). Also:</p>
          <div className="ad-tr-ways">
            <span className="k-find k-find--on ad-tr-find"><Icon name="search" size={14} /><span className="k-find-q">resync</span><Kbd>↵</Kbd></span>
            <span className="row-item ad-tr-way" aria-current="true"><Icon name="sync" size={14} /><span>Resync now</span><span className="chip">Menu › Diagnostics › Advanced</span></span>
            <span className="row-item ad-tr-way"><Icon name="pulse" size={14} /><span>Sync details</span><span className="chip">points here ({bn("ad-syncd")})</span></span>
          </div>
        </div>
        <Arrow />
        <div className="ad-tr-step">
          <span className="ad-tr-n"><b>3</b>What it does</span>
          <div className="island island--pad ad-tr-card">
            <p className="ad-tr-p">Compares every file of Alligators brand on this Mac with the cloud copy. What's newer here is sent; what's newer there is fetched.</p>
            <p className="ad-tr-p">Nothing is overwritten: a file changed on both sides becomes a conflict in Sync details, with Keep mine or Use theirs.</p>
            <div className="ad-tr-prog"><span className="ad-bar"><i style={{ width: "91%" }} /></span><span className="ad-tr-pn">Resyncing… 1 204 of 1 318</span></div>
            <p className="ad-hint">You keep working; the status beside the faces says Syncing… until it's done.</p>
          </div>
        </div>
        <Arrow />
        <div className="ad-tr-step">
          <span className="ad-tr-n"><b>4</b>The result</span>
          <div className="island ad-toastish ad-tr-toast"><Icon name="check" size={14} />Resync done — 3 files sent, nothing else differed.</div>
          <div className="island island--pad ad-tr-card">
            <ARow k="Save status"><StatusWord state="ok">Saved</StatusWord></ARow>
            <ARow k="Sync"><StatusWord state="ok">Up to date</StatusWord></ARow>
            <div className="ad-logs-lines k-mono ad-tr-log"><span className="ad-ll"><span className="ad-ll-t">14:21:07</span><span className="ad-ll-s">sync</span><span className="ad-ll-m">resync · 1 318 checked · 3 sent · 0 conflicts</span></span></div>
          </div>
          <p className="ad-tr-d">The line lands in Logs ({bn("ad-logs")}); if anything conflicted, Sync details lists it.</p>
        </div>
      </div>
    </Closeup>
  );
}

/* ═══ 2 · Per panel ═══════════════════════════════════════════════════════════════════════════ */

function InspectorBoard({ theme = "light" }: { theme?: "light" | "dark" }) {
  return (
    <Closeup theme={theme} title="Inspector › Advanced — the code behind what you selected" sub="Studio site · Homepage. Plain words stay on top, all of them; Advanced adds a layer underneath — it never swaps the rows."
      note={<Note n={bn("ad-inspector")} title="The vocabulary switch became this fold.">Closed, the inspector speaks designer. Open, it adds what the code says — the id, where else it's used, bound tokens, raw CSS. An artboard's Advanced follows 08's sections, then its look and layout.</Note>}>
      <div className="ad-cols">
        <Col label="Closed — what everyone sees">
          <Insp title="Book a call" kind="Button" rows={BTN_ROWS} fold={<Fold hint="Code, tokens, CSS" />} />
        </Col>
        <Arrow />
        <Col label="Advanced open · a button" open>
          <Insp title="Book a call" kind="Button" width={336} rows={BTN_ROWS} fold={<Fold open><BtnAdvanced /></Fold>} />
        </Col>
        <Col label="Advanced open · an artboard" open>
          <Insp title="Desktop" kind="Artboard" width={316} rows={[["Preset", <InSelect value="Desktop" />], ["Size", <InSize w={1440} h={900} />], ["Fill", <InFill name="Paper" />]]} fold={<Fold open><ArtboardAdvanced /></Fold>} />
          <p className="ad-col-cap">Theme: DS default · Light · Dark · Follow the app. With an artboard selected, ⌘0 fits just that one. A print artboard adds bleed, trim and the print-shop colour line — <See>08 · ak-advanced</See></p>
        </Col>
      </div>
    </Closeup>
  );
}

/* ─── Canvases + Layers ─── */
type Row = { name: string; art?: Art; file?: string; depth: number; folder?: boolean; open?: boolean; count?: number; hidden?: boolean; sel?: boolean; menu?: boolean; icon?: string };
const HIDDEN_ROWS: Row[] = [
  { name: "_history/", icon: "history", depth: 2, hidden: true },
  { name: "Combine-kampan.meta.json", icon: "file", depth: 2, hidden: true },
  { name: "Combine-kampan.css", icon: "file", depth: 2, hidden: true },
];
/** The kit's one Alligators tree (ALLIGATORS_FOLDERS / ALLIGATORS_ROOT), flattened — counts match every v2 canvas.
 *  `hidden` = Show hidden files: Combine-kampan's supporting files dimmed in place, and the runtime folder at the root. */
const GATOR_ROWS = (files: boolean, hidden = false): Row[] => {
  const rows: Row[] = [];
  const walk = (fs: Folder[], depth: number) => fs.forEach((f) => {
    const extra = hidden && f.name === "combine" ? HIDDEN_ROWS.length : 0;
    rows.push({ name: f.name, depth, folder: true, open: f.open, count: (f.count ?? 0) + extra });
    if (!f.open) return;
    if (f.folders) walk(f.folders, depth + 1);
    (f.items ?? []).forEach((it) => {
      const main = it.name === "Combine-kampan";
      rows.push({ name: it.name, art: it.art, file: `${it.name}.tsx`, depth: depth + 1, sel: main, menu: files && main });
      if (hidden && main) rows.push(...HIDDEN_ROWS.map((h) => ({ ...h, depth: depth + 1 })));
    });
  });
  walk(ALLIGATORS_FOLDERS, 0);
  ALLIGATORS_ROOT.forEach((it) => rows.push({ name: it.name, art: it.art, file: `${it.name}.tsx`, depth: 0 }));
  if (hidden) rows.push({ name: "_canvas-state/", icon: "laptop", depth: 0, hidden: true });
  return rows;
};

/** Trash — the Canvases panel's last row (as 11 · pn-trash), and also listed in Canvases › Advanced. */
function TrashRow({ count = 12 }: { count?: number }) {
  return (
    <span className="row-item ad-trashrow">
      <span className="ad-trashrow-ic"><Icon name="trash" size={14} /></span>
      <span className="k-cp-name">Trash</span>
      <span className="k-cp-count">{count}</span>
    </span>
  );
}

function TreeRow({ r, files }: { r: Row; files: boolean }) {
  const pad = { paddingLeft: `calc(var(--space-1) + ${r.depth} * var(--space-4))` };
  if (r.folder) {
    return (
      <span className="row-item k-cp-folder" data-open={r.open ? "true" : undefined} style={pad}>
        <span className="k-cp-tw"><Icon name="submenu" size={12} /></span>
        <span className="k-cp-fic"><Icon name="folder" size={14} /></span>
        <span className="k-cp-name">{r.name}</span>
        {r.count !== undefined ? <span className="k-cp-count">{r.count}</span> : null}
      </span>
    );
  }
  return (
    <span className={`row-item k-cp-row${files && r.file ? " k-cp-row--two" : ""}${r.hidden ? " ad-row-hidden" : ""}`} aria-current={r.sel ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-2) + ${r.depth} * var(--space-4))` }}>
      {r.icon ? <span className="ad-hid-ic"><Icon name={r.icon} size={14} /></span> : <Thumb art={r.art ?? "blank"} className="k-thumb--row" />}
      {files && r.file ? (
        <span className="k-cp-two"><span className="k-cp-name">{r.name}</span><span className="k-cp-sub k-mono">{r.file}</span></span>
      ) : <span className="k-cp-name">{r.icon ? <span className="k-mono">{r.name}</span> : r.name}</span>}
      {r.menu ? (
        <span className="k-menu ad-rowmenu">
          <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="folder" size={14} /></span><span className="k-mi-lab">Reveal in Finder</span></span>
          <span className="row-item k-mi" data-hl="true"><span className="k-mi-ic"><Icon name="edit" size={14} /></span><span className="k-mi-lab">Open in editor</span></span>
          <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="file" size={14} /></span><span className="k-mi-lab">View code</span></span>
          <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="duplicate" size={14} /></span><span className="k-mi-lab">Copy file path</span></span>
          <span className="k-msep" />
          <span className="row-item k-mi"><span className="k-mi-ic" /><span className="k-mi-lab">Rename file…</span></span>
        </span>
      ) : null}
    </span>
  );
}

function LeftPanel({ tab = "canvases", width = 280, children, fold }: { tab?: "canvases" | "layers"; width?: number; children?: ReactNode; fold: ReactNode }) {
  return (
    <div className="island k-cp ad-cp" style={{ ...FREE, width, maxHeight: "none" }}>
      <div className="k-cp-hd">
        <span className="seg k-seg">
          <span className="k-seg-b" aria-pressed={tab === "canvases"}>Canvases</span>
          <span className="k-seg-b" aria-pressed={tab === "layers"}>Layers</span>
          <span className="k-seg-b">Assets</span>
        </span>
        <span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span>
      </div>
      {tab === "canvases" ? <span className="k-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Search</span><Kbd>⌘K</Kbd></span> : null}
      <div className="k-cp-list ad-cp-list">{children}</div>
      {fold}
    </div>
  );
}

function CanvasTree({ files = false }: { files?: boolean }) {
  return (
    <>
      <p className="island-title k-cp-t">Alligators brand<span className="k-cp-tc">{ALLIGATORS_COUNT} canvases</span></p>
      {GATOR_ROWS(files, files).map((r) => <TreeRow key={r.name + r.depth} r={r} files={files} />)}
      <TrashRow />
    </>
  );
}

type Layer = { name: string; tag?: string; depth: number; icon: string; sel?: boolean };
const LAYERS: Layer[] = [
  { name: "Web · STAŇ SE GATOREM", tag: "artboard#web", depth: 0, icon: "web" },
  { name: "Navigation", tag: "nav.gt-nav", depth: 1, icon: "frame" },
  { name: "Hero", tag: "section#hero", depth: 1, icon: "frame" },
  { name: "Player photo", tag: "img.gt-player", depth: 2, icon: "image" },
  { name: "STAŇ SE GATOREM", tag: "h1", depth: 2, icon: "type" },
  { name: "Combine 2026 · nábor", tag: "p.gt-sub", depth: 2, icon: "type" },
  { name: "ZAPIŠ SE", tag: "a.btn#cta", depth: 2, icon: "shape", sel: true },
  { name: "Partners", tag: "footer.gt-row", depth: 1, icon: "frame" },
  { name: "Post 1:1 · Combine 2026", tag: "artboard#post-1x1", depth: 0, icon: "digital" },
  { name: "A4 · plakát", tag: "artboard#a4-plakat", depth: 0, icon: "print" },
];

function TrashPanel() {
  const rows: [string, Art, string][] = [
    ["Combine-letak v1", "gator-print", "Jonas · yesterday"],
    ["A · zadní (staré)", "gator-print", "Tereza · 6 Oct, 14:05"],
    ["letak-nabor-2022-old", "gator-poster", "Tereza · 3 Oct"],
    ["Super-Bowl-Watch-Party — kopie", "gator-social", "You · 28 Sep"],
  ];
  return (
    <div className="island k-cp ad-cp ad-trash" style={{ ...FREE, width: 252, maxHeight: "none" }}>
      <div className="ad-trash-hd"><span className="ad-trash-back"><Icon name="chevron" size={12} /></span><strong>Trash</strong><span className="chip">12</span></div>
      {rows.map(([n, a, m]) => (
        <span className="row-item k-cp-row k-cp-row--two ad-trash-r" key={n}>
          <Thumb art={a} className="k-thumb--row" />
          <span className="k-cp-two"><span className="k-cp-name">{n}</span><span className="k-cp-sub">{m}</span></span>
          <Btn ghost>Restore</Btn>
        </span>
      ))}
      <p className="ad-hint">+ 8 more · 48 MB. Trash keeps things until you clear it out.</p>
      <div className="ad-acts"><Btn>Clear out older than 30 days…</Btn></div>
    </div>
  );
}

function LeftBoard() {
  return (
    <Closeup title="Canvases and Layers › Advanced — file names, hidden files, the tree, Trash" sub={`Alligators brand, ${ALLIGATORS_COUNT} canvases. The left panel has one Advanced; it follows the tab you're on.`}
      note={<Note n={bn("ad-left")} title="Files for whoever wants them, never in the way.">Canvases › Advanced adds file names, hidden files (H) dimmed in place, a row menu with Reveal in Finder, the folder and the design system. Trash stays the panel's last row; Advanced lists it too. Layers › Advanced adds tags, ids, select-by-selector.</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="Closed">
          <LeftPanel width={252} fold={<Fold hint="Files, folder, Trash" />}><CanvasTree /></LeftPanel>
        </Col>
        <Arrow />
        <Col label="Canvases · Advanced open" open>
          <LeftPanel width={300} fold={
            <Fold open remembered>
              <ARow k="Show file names"><InSwitch on /></ARow>
              <ARow k={<>Show hidden files <Kbd>H</Kbd></>}><InSwitch on /></ARow>
              <ARow k="Folder" mono copy>~/Maude/alligators</ARow>
              <ARow k="Design system"><span className="ad-inline"><span className="k-mono ad-mono-sm">system/alligators</span><Btn ghost>Open</Btn></span></ARow>
              <ARow k="Trash"><span className="ad-inline"><span className="ad-val">12 things</span><Btn ghost>Open</Btn></span></ARow>
              <div className="ad-row ad-row--foot"><span className="ad-row-k">{ALLIGATORS_COUNT} of {ALLIGATORS_COUNT} shown · updated just now</span><Btn ghost icon="sync">Refresh</Btn></div>
            </Fold>
          }>
            <CanvasTree files />
          </LeftPanel>
        </Col>
        <Col label="Trash — the panel's last row, or Canvases › Advanced" open style={{ marginLeft: "var(--space-6)" }}>
          <TrashPanel />
          <p className="ad-col-cap">A canvas moved to the trash waits here; Restore puts it back where it was. A whole canvas emptied: <See>05 · es-all-trashed</See></p>
        </Col>
        <Col label="Layers · Advanced open" open>
          <LeftPanel tab="layers" width={300} fold={
            <Fold open>
              <ARow k="Show tags and ids"><InSwitch on /></ARow>
              <ARow k="On this canvas">15 artboards · 214 layers</ARow>
              <div className="ad-row ad-row--stack"><span className="ad-row-k">Select by selector</span><span className="input ad-input k-mono">section#hero a</span></div>
              <ARow k="Element id" mono copy>cd-91be07</ARow>
            </Fold>
          }>
            <p className="island-title k-cp-t">Combine-kampan</p>
            {LAYERS.map((l) => (
              <span key={l.name} className="row-item k-ly ad-ly" aria-current={l.sel ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-2) + ${l.depth} * var(--space-4))` }}>
                <span className="k-ly-ic"><Icon name={l.icon} size={14} /></span>
                <span className="k-cp-name">{l.name}</span>
                {l.tag ? <span className="k-mono ad-ly-tag">{l.tag}</span> : null}
              </span>
            ))}
          </LeftPanel>
        </Col>
      </div>
    </Closeup>
  );
}

/* ─── AI chat panel (compact — the full version is 03 · ai-advanced) ─── */
function AiChat({ open }: { open: boolean }) {
  return (
    <div className="island island--pad k-ai ad-ai" style={{ ...FREE, width: 340, maxHeight: "none" }}>
      <div className="k-ai-hd">
        <Spark size={14} />
        <span className="k-ai-name">Make it greener</span>
        <span className="icon-btn k-icon-sm"><Icon name="plus" size={14} /></span>
        <span className="icon-btn k-icon-sm"><Icon name="chevron" size={14} /></span>
      </div>
      <div className="k-ai-msgs ad-ai-msgs">
        <p className="k-ai-msg k-ai-msg--you">Make it greener, keep the logo white</p>
        <p className="k-ai-msg k-ai-msg--ai">Done — Post 1:1 is greener: background, badge and button. The logo stays white.</p>
      </div>
      <div className="ask k-ask">
        <span className="chip chip--accent k-selchip">◆ Post 1:1</span>
        <span className="k-ask-in k-ask-ph">Ask AI…</span>
        <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
      </div>
      <Fold open={open} hint="Model, images, log">
        <ARow k="Model"><InSelect value="Opus" /></ARow>
        <ARow k="Effort"><InSeg options={["Low", "Medium", "High"]} value="Medium" /></ARow>
        <ARow k="Fast mode"><InSwitch on={false} /></ARow>
        <div className="ad-row ad-row--stack"><span className="ad-row-k">Ask before</span><InSelect value="Replace or move to the trash" /></div>
        <ARow k="Show in chat"><InSelect value="Normal" /></ARow>
        <ASub>Images, video and voice</ASub>
        <ARow k="Provider"><InSelect value="Gemini" /></ARow>
        <ARow k="Shape"><InSelect value="As the artboard" /></ARow>
        <ARow k="Place on the canvas"><InSwitch on /></ARow>
        <ASub>This chat</ASub>
        <ARow k="Context used">38%</ARow>
        <ARow k="5-hour limit">64% · resets 18:40</ARow>
        <ARow k="Session" mono>c-mg4x1k-7f3a9</ARow>
        <div className="ad-acts ad-acts--wrap">
          <Btn icon="file">Raw log</Btn>
          <Btn icon="duplicate">Copy transcript</Btn>
          <Btn icon="tab">Open in terminal</Btn>
        </div>
        <p className="ad-hint">Type <span className="k-mono">/</span> in the field for slash commands. Keys for images live in Settings › Connections.</p>
      </Fold>
    </div>
  );
}

function AiBoard() {
  return (
    <Closeup title="AI chat panel › Advanced — the short version" sub="Combine-kampan · Post 1:1. The same fold as 03 AI Chat, shortened; the image, video and voice settings of today's Generate dialog join it."
      note={<Note n={bn("ad-ai")} title="Same fold, same place.">Model, effort, fast mode, when AI asks, what the chat shows, the image settings, context and the 5-hour limit, the session, the raw log and Open in terminal. Slash commands still work when typed.</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="Closed"><AiChat open={false} /></Col>
        <Arrow />
        <Col label="Advanced open" open><AiChat open /></Col>
        <Col label="The long version" style={{ marginLeft: "var(--space-6)" }}>
          <div className="island island--pad ad-ref">
            <span className="chip ad-ref-chip"><Spark size={9} />03 AI Chat · ai-advanced</span>
            <strong>23 · Advanced — everything that used to be visible</strong>
            <span className="ad-ref-d">What AI may do — change canvases, use Assets and footage, search the web, write outside this project — “Always allowed on this canvas”, the agent's own options, and the raw tool log beside the panel.</span>
            <ul className="ad-ref-list">
              <li>Was the Generate dialog: provider, shape, place on the canvas — now here, under Images, video and voice.</li>
              <li>Was the chat's tool-call cards: Raw log.</li>
              <li>Was the ⓘ popover: context and the 5-hour limit.</li>
            </ul>
            <PathChip>Same fold, longer</PathChip>
          </div>
        </Col>
      </div>
    </Closeup>
  );
}

/* ─── Share ─── */
function ShareSheet({ open }: { open: boolean }) {
  /* Lifted from 10 · co-share-advanced: scope, people with their e-mail, the team link row. */
  const ppl: [string, string, string, string?][] = [["you", "You", "Owner"], ["tereza", "Tereza", "Can edit", "tereza@alligators.cz"], ["jonas", "Jonas", "Can comment", "jonas@alligators.cz"]];
  return (
    <div className="island island--pad ad-share" style={{ width: 400 }}>
      <p className="ad-share-t">Share Combine-kampan</p>
      <span className="seg k-seg ad-share-scope"><span className="k-seg-b" aria-pressed="true">This canvas</span><span className="k-seg-b">Whole project</span></span>
      <div className="ad-share-inv"><span className="input ad-input ad-input--ph">Name or email</span><InSelect value="Can edit" /><span className="btn btn--primary">Invite</span></div>
      <div className="ad-share-ppl">
        {ppl.map(([w, n, r, mail]) => <span className="ad-share-p" key={w}><Avatar who={w} /><span className="ad-share-pn">{n}{mail ? <small>{mail}</small> : null}</span><span className="ad-share-pr">{r}{r !== "Owner" ? <Icon name="chevron" size={12} /> : null}</span></span>)}
      </div>
      <div className="ad-share-link"><Icon name="link" size={14} /><span className="ad-share-ld"><strong>Anyone in the Alligators team</strong><span>Can view — look only</span></span><span className="btn btn--sm">Copy link</span></div>
      <Fold open={open} hint="Links, link rules, sync">
        <ASub>This link</ASub>
        <ARow k="Who can open"><InSelect value="Team only" /></ARow>
        <ARow k="Role"><InSelect value="Can view" /></ARow>
        <ARow k="Expires"><InSelect value="In 7 days" /></ARow>
        <ARow k="New people join as"><InSelect value="Can edit" /></ARow>
        <ASub>Other ways in</ASub>
        <ARow k="App link" mono copy>maude://alligators/combine-kampan</ARow>
        <ARow k="This Mac only" mono copy>localhost:4402/?c=Combine-kampan</ARow>
        <div className="ad-row ad-row--stack"><span className="ad-row-k">Invite by GitHub username</span><span className="ad-inline"><span className="input ad-input ad-input--ph k-mono">@username</span><Btn>Invite</Btn></span></div>
        <ASub>Where it syncs</ASub>
        <ARow k="Hub" mono copy>alligators.cloud.maude.sh</ARow>
        <ARow k="Last synced">6 Oct, 14:05 · 247 assets</ARow>
        <p className="ad-hint">Sync details live in Menu › Diagnostics › Sync.</p>
      </Fold>
    </div>
  );
}

function ShareBoard() {
  return (
    <Closeup title="Share › Advanced — the other links, the link's rules, where it syncs" sub="Alligators brand · Combine-kampan, cloud-linked. Invite stays the one primary button."
      note={<Note n={bn("ad-share")} title="One Share, three old links folded in.">The same sheet and fold as 10 · co-share-advanced. The app link, the this-Mac-only link and the GitHub invite moved under Advanced, next to the link's rules — who opens it, the role, when it expires — and the hub it syncs to. In a browser the this-Mac link is hidden ({bn("ad-edge-where")}).</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="Closed"><ShareSheet open={false} /></Col>
        <Arrow />
        <Col label="Advanced open" open><ShareSheet open /></Col>
      </div>
    </Closeup>
  );
}

/* ─── Timeline — Advanced at the FOOT, 07's timecode (07 · ve-advanced wins) ─── */
function TimelinePanel({ open }: { open: boolean }) {
  const secs = [0, 5, 10, 15, 20, 25, 30];
  const clips: { w: number; tone: string; label: string }[] = [
    { w: 18, tone: "green", label: "40 yd sprint" }, { w: 14, tone: "sky", label: "Bench" }, { w: 22, tone: "green", label: "Touchdown" },
    { w: 16, tone: "lilac", label: "Crowd" }, { w: 30, tone: "yellow", label: "Logo end card" },
  ];
  return (
    <div className="island ad-tl" data-open={open ? "true" : undefined}>
      <div className="ad-tl-hd">
        <span className="icon-btn k-icon-sm"><Icon name="play" size={14} /></span>
        <span className={`ad-tl-time${open ? " k-mono" : ""}`}>{open ? "00:00:12:08 / 00:00:30:00" : "0:12 / 0:30"}</span>
        <span className="ad-tl-name"><Icon name="video" size={12} />Reels · nábor</span>
        <span className="ad-tl-sp" />
        <Btn ghost icon="plus">Title</Btn>
        <span className="btn btn--ghost btn--sm"><Spark size={10} />AI clip</span>
      </div>
      <div className="ad-tl-ruler">
        {secs.map((s) => (
          <span key={s} className="ad-tl-tick" style={{ left: `${(s / 30) * 100}%` }}>
            {open ? <span className="k-mono">{s * 30}</span> : `${s}s`}
          </span>
        ))}
        <span className="ad-tl-head" style={{ left: "41%" }} />
      </div>
      <div className="ad-tl-tracks">
        <div className="ad-tl-track">{clips.map((c) => <span key={c.label} className={`ad-tl-clip ad-tl-clip--${c.tone}`} style={{ width: `${c.w}%` }}>{c.label}{open ? <em className="k-mono">{Math.round((c.w / 100) * 900)}f</em> : null}</span>)}</div>
        <div className="ad-tl-track ad-tl-track--cap">
          <span style={{ marginLeft: "6%", width: "26%" }}>STAŇ SE GATOREM</span><span style={{ marginLeft: "12%", width: "22%" }}>Combine 14. 3.</span>
          {open ? [28.4, 31.2, 62.8, 65.2].map((p) => <i key={p} className="ad-tl-kf" data-sel={p === 31.2 ? "true" : undefined} style={{ left: `${p}%` }} />) : null}
        </div>
        <div className="ad-tl-track ad-tl-track--music">{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</div>
        <span className="ad-tl-head ad-tl-head--line" style={{ left: "41%" }} />
      </div>
      <div className="k-adv ad-tl-foot" data-open={open ? "true" : undefined}>
        <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced</span>
        {open ? (
          <span className="ad-tl-foot-r"><span className="k-mono">30 fps · frame 368 of 900 · 00:00:12:08</span><InSeg options={["Timecode", "Frames"]} value="Frames" /></span>
        ) : <span className="ad-tl-foot-hint">Frames, keyframes, the cut as code</span>}
      </div>
      {open ? (
        <div className="ad-tl-body">
          <div className="ad-tl-sec">
            <ASub>This video</ASub>
            <ARow k="Frame rate" mono>30 fps</ARow>
            <ARow k="Size" mono>1080 × 1920</ARow>
            <ARow k="Codec" mono>H.264 · AAC 48 kHz</ARow>
            <ARow k="Length" mono>900 frames</ARow>
            <ARow k="Long videos">One part — up to 3 600 frames</ARow>
          </div>
          <div className="ad-tl-sec">
            <ASub aside={<span className="chip">y · opacity</span>}>Keyframe · STAŇ SE GATOREM</ASub>
            <ARow k="Easing" mono>cubic-bezier(0.22, 1, 0.36, 1)</ARow>
            <ARow k="y" mono>48px → 0px</ARow>
            <ARow k="Frames" mono>330 → 342</ARow>
            <div className="ad-acts"><CopyBtn label="Copy timecode" /></div>
          </div>
          <div className="ad-tl-sec">
            <ASub aside={<InSeg options={["EDL", "Code"]} value="EDL" />}>The cut as code</ASub>
            <pre className="ad-pre k-mono">{`{ "clip": "combine-40yd.mov",
  "durationFrames": 165,
  "transition": "cut" }`}</pre>
            <p className="ad-hint">reels-nabor.edl.json · <span className="ad-link">Open in code view</span></p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimelineBoard() {
  return (
    <Closeup title="Timeline › Advanced — at its foot: frames, keyframes, the cut as code" sub="Alligators brand · Reels · nábor (9:16, 30 s). The timeline appears only with a video artboard selected."
      note={<Note n={bn("ad-timeline")} title="Seconds by default, frames on request.">Advanced at the timeline's foot turns the ruler to frames, the readout to 07's timecode, and shows keyframes; the video's settings, the selected keyframe's curve and the cut as code open below. The big version: 07 · ve-advanced.</Note>}>
      <div className="ad-tl-stack">
        <Col label="Closed — what everyone sees"><TimelinePanel open={false} /></Col>
        <Col label="Advanced open" open><TimelinePanel open /></Col>
      </div>
    </Closeup>
  );
}

/* ─── Export ─── */
function ExportSheet({ open }: { open: boolean }) {
  return (
    <div className="ad-sheet" style={{ width: 420 }}>
      <p className="k-dialog-t">Export 3 artboards</p>
      <span className="ad-sheet-scope"><Thumb art="gator-social" w={28} h={28} /><Thumb art="gator-reel" w={16} h={28} /><Thumb art="gator-print" w={20} h={28} /><span>Post 1:1 · Story 9:16 · A4 · plakát</span></span>
      <ARow k="Scope"><InSelect value="Selection · 3 artboards" /></ARow>
      <ARow k="Format"><InSeg options={["PNG", "JPG", "PDF", "Other…"]} value="PNG" /></ARow>
      <ARow k="Size"><InSeg options={["1×", "2×", "3×"]} value="2×" /></ARow>
      <ARow k="Save to"><InSelect value="Downloads" /></ARow>
      <Fold open={open} hint="Scale, colour, file names">
        <ASub>Size</ASub>
        <ARow k="Exact scale"><span className="input ad-input ad-input--sm">2.5×</span></ARow>
        <ARow k="For print"><InSelect value="300 dpi" /></ARow>
        <ASub>Colour</ASub>
        <ARow k="Colour profile"><InSeg options={["sRGB", "Display P3"]} value="sRGB" /></ARow>
        <ASub>Files</ASub>
        <div className="ad-row ad-row--stack"><span className="ad-row-k">File names</span><span className="input ad-input k-mono">{"{canvas} — {artboard}@{scale}"}</span></div>
        <div className="ad-files k-mono">
          <span>Combine-kampan — Post 1-1 · Combine 2026@2x.png</span><span>Combine-kampan — Story 9-16 · Zapiš se@2x.png · +1</span>
        </div>
        <ASub>From the terminal</ASub>
        <Cmd>maude design export png --scope artboard --option scale=2</Cmd>
        <Cmd note="Claude Code">/design:export png --scope artboard --option scale=2</Cmd>
        <Cmd note="Claude Code · AI handoff">/design:handoff 2026/combine/Combine-kampan</Cmd>
      </Fold>
      <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Export</span></div>
    </div>
  );
}

function ExportBoard() {
  return (
    <Closeup title="Export › Advanced — exact scale, colour profile, file names, the command" sub="Alligators brand · three Combine-kampan artboards of three kinds. The sheet's title and its button say the same verb."
      note={<Note n={bn("ad-export")} title="Three choices up front, the rest one fold away.">Scope, format, size and where to save are all most exports need — the same sheet as 09. Advanced holds exact scale and dpi, the colour profile, a file-name pattern with a live preview, and the same export as a command.</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="Closed"><ExportSheet open={false} /></Col>
        <Arrow />
        <Col label="Advanced open" open><ExportSheet open /></Col>
        <Col label="Also under Export" style={{ marginLeft: "var(--space-6)" }}>
          <div className="island island--pad ad-recent">
            <p className="island-title">Exports</p>
            {[["Combine-kampan · 3 PNG", "2 min ago", "done"], ["Reels · nábor · MP4", "Rendering · 62%", "busy"], ["LetakA6 · PDF with bleed", "yesterday", "done"]].map(([a, b, s]) => (
              <span className="row-item ad-recent-r" key={a}><Icon name={s === "busy" ? "sync" : "export"} size={14} /><span className="ad-recent-t"><span>{a}</span><span className="ad-recent-m">{b}</span></span>{s === "done" ? <span className="icon-btn k-icon-sm" title="Show in Finder"><Icon name="folder" size={14} /></span> : null}</span>
            ))}
            <p className="ad-hint">Was the export badge in the menu bar; now the Exports icon in the Share cluster — <See>09 · ex-history</See></p>
          </div>
          <div className="island island--pad ad-recent">
            <p className="island-title">Print PDF, when a print artboard is in</p>
            <div className="ad-row ad-row--stack"><span className="ad-row-k">Colour</span><span className="ad-val">RGB — the print shop converts to CMYK.</span></div>
            <ARow k="Image quality"><InSelect value="300 dpi" /></ARow>
            <ARow k="Text"><InSelect value="Keep as text" /></ARow>
            <ARow k="Bleed 3 mm"><InSwitch on /></ARow>
            <ARow k="Crop marks"><InSwitch on /></ARow>
            <ARow k="Registration marks"><InSwitch on={false} /></ARow>
          </div>
          <div className="island island--pad ad-recent">
            <p className="island-title">Other… — every other format</p>
            <p className="ad-recent-m">PowerPoint · Canva · Web page (HTML) · SVG · Project ZIP · Code… ⇧⌘H. Video adds frame rate, codec and bitrate.</p>
            <p className="ad-hint"><See>09 · ex-formats</See> <See>09 · ex-advanced</See></p>
          </div>
        </Col>
      </div>
    </Closeup>
  );
}

/* ─── Version history — closed, then open; commit ids only inside the fold ─── */
function VhPanel({ open }: { open: boolean }) {
  const rows: { t: string; d: string; ai?: boolean; sel?: boolean; now?: boolean }[] = [
    { t: "Now", d: "Saved", now: true },
    { t: "14:32 · Made by AI", d: "Post 1:1 greener", ai: true, sel: true },
    { t: "14:05 · Tereza", d: "Story copy" },
    { t: "Yesterday, 18:40 · Jonas", d: "A4 · plakát" },
  ];
  return (
    <div className="island island--pad ad-vh" style={{ width: open ? 400 : 340 }}>
      <div className="ad-vh-hd"><Icon name="history" size={14} /><strong>Version history</strong><Kbd>⌥⌘H</Kbd><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
      <div className="ad-vh-list">
        {rows.map((r) => (
          <span key={r.t} className="row-item ad-vh-row" aria-current={r.sel ? "true" : undefined}>
            <span className={`ad-vh-dot${r.now ? " ad-vh-dot--now" : ""}`}>{r.ai ? <Spark size={9} /> : null}</span>
            <span className="ad-vh-t"><strong>{r.t}</strong><span>{r.d}</span></span>
          </span>
        ))}
      </div>
      <div className="ad-acts"><Btn icon="view">Compare</Btn><Btn primary>Restore this version</Btn></div>
      <Fold open={open} remembered={open} hint="Branch, git, changed files">
        <ARow k="Branch"><InSelect value="main" /></ARow>
        <ARow k="Drafts"><span className="ad-inline"><span className="k-mono ad-mono-sm">tereza/uniformy-v2</span><Btn ghost>Continue</Btn></span></ARow>
        <ARow k="Remote" mono copy>github.com/brno-alligators/brand</ARow>
        <ASub aside={<span className="k-mono">a41f9c2</span>}>Changed in this version</ASub>
        <div className="ad-chg"><Badge s="M" /><span className="k-mono">2026/combine/Combine-kampan.tsx</span><em className="k-mono ad-add">+14</em><em className="k-mono ad-del">−6</em></div>
        <div className="ad-chg"><Badge s="A" /><span className="k-mono">assets/5c1e9a07.svg</span></div>
        <div className="ad-diff k-mono">
          <span className="ad-diff-del">−  background: var(--gator-ink);</span>
          <span className="ad-diff-add">+  background: var(--gator-green);</span>
          <span className="ad-diff-add">+  --badge: var(--gator-lime);</span>
        </div>
        <ARow k="Not in a version yet"><span className="ad-inline"><Badge s="M" /><span className="k-mono ad-mono-sm">brief.md</span><Btn ghost>Discard</Btn></span></ARow>
        <div className="ad-acts ad-acts--wrap">
          <Btn>Save a version with a note…</Btn>
          <Btn>New branch…</Btn>
          <Btn>Fetch</Btn>
          <Btn>Publish 2 versions</Btn>
          <Btn>Pull a copy to this Mac…</Btn>
          <Btn>Add to main · opens a pull request</Btn>
        </div>
      </Fold>
    </div>
  );
}

function HistoryBoard() {
  return (
    <Closeup title="Version history › Advanced — versions up top, the git one fold down" sub="Alligators brand · Combine-kampan, a git-backed project. Closed, it's versions with Compare and Restore — no commit ids, no branch."
      note={<Note n={bn("ad-history")} title="Versions, not commits — the git is one fold down.">Advanced adds the branch and drafts, the remote, the commit id and changed files of the selected version, a diff, and the git actions in plain words. Get latest moved to Sync details ({bn("ad-syncd")}).</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="Closed — what everyone sees"><VhPanel open={false} /></Col>
        <Arrow />
        <Col label="Advanced open" open><VhPanel open /></Col>
      </div>
    </Closeup>
  );
}

/* ─── The old design system view — superseded by 13 Design System; kept as Design system › Advanced layer ─── */
function DsBoard() {
  const sw: [string, string][] = [["Gator green", "green"], ["Ink", "ink"], ["Lime", "yellow"], ["Sky", "sky"], ["Paper", "paper"]];
  const type: [string, string, string][] = [["Display", "COMBINE 2026", "64 · Heavy"], ["Headline", "Staň se gatorem", "40 · Bold"], ["Body", "Nábor pro sezónu 2026, všechny věkové kategorie.", "16 · Regular"], ["Caption", "So 14. 3. · Kraví hora", "12 · Medium"]];
  return (
    <Closeup title="The specimen view — now the Advanced layer of the Design system canvas" sub={<>Superseded by <b>13 Design System</b>: the default view is the Design system canvas itself, pinned above every canvas. This page — colours, type and specimens, then the folder, the token names and the raw file — is what Design system › Advanced opens.</>}
      note={<Note n={bn("ad-ds")} title="Superseded by 13 Design System — kept, one fold down.">Was the S key and a DESIGN SYSTEM section in the tree. The default is now the Design system canvas (13 · ds-board-studio); this view lives under its Advanced (13 · ds-advanced). ⌘K “design system” opens it; S stays free for the canvas.</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="How you get here">
          <div className="island island--pad ad-ds-way">
            <p className="island-title">Canvases › Advanced</p>
            <ARow k="Design system"><span className="ad-inline"><span className="k-mono ad-mono-sm">system/alligators</span><span className="btn btn--sm btn--primary">Open</span></span></ARow>
            <span className="k-find k-find--on ad-tr-find"><Icon name="search" size={14} /><span className="k-find-q">design system</span><Kbd>↵</Kbd></span>
            <span className="row-item ad-tr-way" aria-current="true"><Icon name="layers" size={14} /><span>Design system — alligators</span><span className="chip">View</span></span>
          </div>
        </Col>
        <Arrow />
        <Col label="The view" open>
          <div className="island ad-ds">
            <div className="ad-ds-hd"><Icon name="layers" size={16} /><strong>Design system › Advanced</strong><InSelect value="alligators" /><span className="ad-ds-n">1 of 2 in this project</span><span className="ad-tl-sp" /><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
            <div className="ad-ds-body">
              <div className="ad-ds-sec">
                <p className="ad-ds-t">Colours</p>
                <div className="ad-ds-sw">{sw.map(([n, t]) => <span className="ad-ds-chip" key={n}><i className={`ad-ds-c ad-ds-c--${t}`} /><span>{n}</span></span>)}</div>
                <p className="ad-ds-t">Type</p>
                <div className="maude-v2 k-fixed ad-ds-type" data-theme="light">
                  {type.map(([r, s, m], i) => <span className={`ad-ds-tr ad-ds-tr--${i}`} key={r}><span className="ad-ds-tr-r">{r}</span><span className="ad-ds-tr-s">{s}</span><span className="ad-ds-tr-m">{m}</span></span>)}
                </div>
              </div>
              <div className="ad-ds-sec">
                <p className="ad-ds-t">Components and specimens</p>
                <div className="ad-ds-gal">
                  {([["gator-social", "Post 1:1"], ["gator-poster", "Plakát A4"], ["gator-jersey", "Dres"], ["gator-web", "Web hero"]] as [Art, string][]).map(([a, n]) => <span className="ad-ds-g" key={n}><Thumb art={a} w={120} h={84} /><span>{n}</span></span>)}
                </div>
              </div>
            </div>
            <div className="ad-ds-foot">
              <Fold open hint="Folder, tokens, file">
                <div className="ad-ds-adv">
                  <div>
                    <ARow k="Folder" mono copy>system/alligators</ARow>
                    <ARow k="Tokens file" mono>colors_and_type.css · 48 tokens</ARow>
                    <ARow k="Code" mono>MAUDE-DSN/01</ARow>
                  </div>
                  <div className="ad-csslist">
                    <Css k="--gator-green" v="oklch(0.62 0.17 145)" />
                    <Css k="--gator-ink" v="oklch(0.22 0.02 150)" />
                    <Css k="--type-display" v="64px / 0.95" />
                  </div>
                </div>
                <div className="ad-acts ad-acts--end"><Btn icon="duplicate">Copy token names</Btn><Btn icon="edit">Open in editor</Btn></div>
              </Fold>
            </div>
          </div>
        </Col>
      </div>
    </Closeup>
  );
}

/* ═══ 3 · Menu and Diagnostics ════════════════════════════════════════════════════════════════ */

function MenusBoard() {
  const main: MenuItem[] = [
    { label: "Back to Home", icon: "home", highlight: true }, "sep",
    { label: "File", icon: "file", sub: true }, { label: "Edit", icon: "edit", sub: true }, { label: "View", icon: "view", sub: true }, { label: "Help", icon: "help", sub: true, dot: true }, "sep",
    { label: "Version history", icon: "history", keys: "⌥⌘H" }, { label: "Share…", icon: "share" }, { label: "Export…", icon: "export", keys: "⇧⌘E" }, "sep",
    { label: "Diagnostics", icon: "pulse", sub: true }, { label: "Settings…", icon: "settings", keys: "⌘," },
  ];
  const file: MenuItem[] = [
    { label: "New canvas", keys: "⌘N" }, { label: "New project…", keys: "⇧⌘N" }, { label: "Open project…", keys: "⌘O", highlight: true }, "sep",
    { label: "Duplicate canvas" }, { label: "Rename canvas" }, { label: "Move to…" }, "sep",
    { label: "Import from Figma…", highlight: true }, { label: "Import a brand…", highlight: true }, { label: "Assemble clips into a video" }, "sep",
    { label: "Export…", keys: "⇧⌘E" }, { label: "Handoff to production", keys: "⇧⌘H", highlight: true }, { label: "Close canvas" },
  ];
  const view: MenuItem[] = [
    { label: "Hide panels", keys: "⌘\\" }, { label: "Comments", keys: "⇧⌘M", note: "3 open", highlight: true }, { label: "Assets" }, { label: "Annotations", keys: "⇧P" }, { label: "Present the canvas", highlight: true }, "sep",
    { label: "Zoom in", keys: "⌘+" }, { label: "Zoom out", keys: "⌘−" }, { label: "Zoom to fit", keys: "⌘0" }, { label: "Actual size", keys: "⌘1" }, "sep",
    { group: "Advanced" },
    { label: "Layers as a panel", indent: true, highlight: true }, { label: "Inspector", keys: "⇧⌘I", indent: true }, { label: "Open inspector on select", indent: true, checked: true, highlight: true },
    { label: "Keep timeline open", keys: "⇧⌘T", indent: true }, { label: "Minimap", indent: true, highlight: true }, { label: "Zoom controls", indent: true, highlight: true }, { label: "Print guides", indent: true, highlight: true },
    { label: "Hidden files", indent: true }, { label: "Pin panels to the side", indent: true },
  ];
  const help: MenuItem[] = [
    { label: "Keyboard shortcuts", keys: "?" }, { label: "Help and guides", keys: "F1", highlight: true }, { label: "What's new", dot: true, highlight: true }, { label: "Take the tour" },
    { label: "Watch the intro" }, { label: "How sharing works" }, "sep", { label: "Report a bug…", highlight: true },
  ];
  const cols: [string, MenuItem[], ReactNode][] = [
    ["Menu", main, <>Back to Home — was the browser's “← Dashboard” link.</>],
    ["Menu › File", file, <>Open project… — was “Open another folder or team project”. Import from Figma… and Import a brand… — were Quick setup. Handoff — was in Help.</>],
    ["Menu › View, Advanced open", view, <>Comments shows the open count — was in the status bar. Present the canvas — was Presentation mode. Advanced: Layers as a panel, Open inspector on select, Minimap, Zoom controls, Print guides — were Settings and the canvas.</>],
    ["Menu › Help", help, <>Help and guides holds slash commands, opt-out and the critic loop. What's new and Report a bug were icons in the menu bar.</>],
  ];
  return (
    <Closeup title="The menu holds what the menu bar showed — File, View › Advanced, Help" sub="CONTRACT §1, the rows that took in something from today's app are marked. Same menu under the project pill on every project."
      note={<Note n={bn("ad-menus")} title="Six menus became one; nothing fell off.">Selection and Tools merged into Edit and the two toolbars; every View toggle and setting that was on screen is either here or under View › Advanced. Diagnostics is next ({bn("ad-diag")}).</Note>}>
      <div className="ad-menus">
        {cols.map(([t, items, cap]) => (
          <div className="ad-menus-col" key={t}>
            <span className="ad-col-l">{t}</span>
            <Menu width={t === "Menu" ? 236 : 268} style={FREE} items={items} />
            <p className="ad-col-cap">{cap}</p>
          </div>
        ))}
      </div>
    </Closeup>
  );
}

function DiagBoard() {
  return (
    <Stage note={<Note n={bn("ad-diag")} title="Status in words; the tools under Advanced.">① One word each for Sync, Server and AI setup. ② Logs, Reload canvas, Check AI setup again. ③ Address, Process, Project folder, Resync now (traced in {bn("ad-trace")}), Download all.</Note>}>
      <Window tabs={TABS2} activeTab={1}>
        <Canvas><Kampan x={600} y={150} /></Canvas>
        <ProjectPill project="Alligators brand" canvas="Combine-kampan" open />
        <ProjectMenu open="diagnostics" advanced diag={{ sync: ["Up to date", "ok"], server: ["Running", "ok"], ai: ["Ready", "ok"], address: "localhost:4402", process: "41207", folder: "~/Maude/alligators" }} />
        <ShareCluster mode="edit" people={["tereza", "jonas"]} />
        <ZoomUndo zoom={20} />
        <Toolbar />
        <PanelIcon icon="spark" at="ai" />
        <Callout n={1} x={556} y={104} />
        <Callout n={2} x={556} y={196} />
        <Callout n={3} x={556} y={309} />
      </Window>
    </Stage>
  );
}

function LogsBoard() {
  const lines: [string, string, string, string?][] = [
    ["14:05:12", "sync", "pushed Combine-kampan.tsx · 3.1 kB"],
    ["14:05:12", "sync", "pushed Combine-kampan.meta.json"],
    ["14:05:40", "server", "canvas built · Combine-kampan · 412 ms"],
    ["14:06:01", "ai", "chat c-mg4x1k · turn done · 41 s · 3 tool calls"],
    ["14:06:02", "export", "render service · Reels · nábor · 62 %"],
    ["14:06:10", "sync", "asset upload combine-40yd.mov · 62 %"],
    ["14:06:31", "sync", "hub replied 429 · retry in 40 s", "warn"],
    ["14:07:11", "sync", "retry ok · 3 files"],
    ["14:07:15", "server", "watcher · 1 change · Pricing.tsx"],
    ["14:07:15", "server", "canvas built · Pricing · 380 ms"],
    ["14:08:02", "ai", "setup check · Claude Code 2.1.240 · signed in"],
    ["14:08:30", "server", "reload canvas · Combine-kampan · by you"],
    ["14:09:02", "sync", "pulled Uniformy-2027.tsx · from Tereza"],
    ["14:09:44", "ai", "chat c-q81zr2 · waiting for you · permission"],
    ["14:10:05", "export", "render service · Reels · nábor · done · 18.4 MB"],
    ["14:10:06", "sync", "asset upload combine-40yd.mov · done"],
    ["14:11:20", "server", "canvas built · LetakA6 · 518 ms"],
    ["14:12:03", "sync", "trash · 12 things kept · 48 MB"],
  ];
  return (
    <Closeup title="Diagnostics, opened — Logs, Server and AI setup" sub="What the Diagnostics rows open. Mono and raw words are allowed here; this is the Advanced side of the app."
      note={<Note n={bn("ad-logs")} title="The log tail and the status bar, kept whole.">Logs filters by source and copies in one click. Server keeps what the status bar and mode stamp said. Check AI setup again answers in four rows; Reload canvas confirms with one line. Sync opens Sync details ({bn("ad-syncd")}).</Note>}>
      <div className="ad-logs-wrap">
        <div className="island island--pad ad-logs">
          <div className="ad-logs-hd">
            <strong>Logs</strong>
            <InSeg options={["All", "Sync", "Server", "AI", "Export"]} value="All" />
            <span className="k-find ad-logs-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Filter</span></span>
            <CopyBtn label="Copy all" />
            <Btn ghost icon="folder">Show in Finder</Btn>
          </div>
          <div className="ad-logs-lines k-mono">
            {lines.map(([t, s, m, lvl], i) => (
              <span key={i} className={lvl ? `ad-ll ad-ll--${lvl}` : "ad-ll"}><span className="ad-ll-t">{t}</span><span className={`ad-ll-s ad-ll-s--${s}`}>{s}</span><span className="ad-ll-m">{m}</span></span>
            ))}
          </div>
          <p className="ad-hint">Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines.</p>
        </div>
        <div className="ad-logs-side">
          <div className="island island--pad ad-syncd">
            <div className="ad-syncd-hd"><strong>Server</strong><StatusWord state="ok">Running</StatusWord></div>
            <ARow k="Showing">Canvas · Combine-kampan</ARow>
            <ARow k="Live connection">Connected</ARow>
            <ARow k="Address" mono copy>localhost:4402</ARow>
            <ARow k="Version" mono>2.0.0 · build 412</ARow>
            <p className="ad-hint">Was the status bar's live dot and version, the IDLE · CANVAS · SYSTEM stamp and the empty canvas's port line.</p>
          </div>
          <div className="island island--pad ad-syncd">
            <div className="ad-syncd-hd"><strong>AI setup</strong><span className="ad-syncd-when">Checked just now</span></div>
            {[["Claude Code installed", "2.1.240"], ["Found at", "~/.local/bin/claude"], ["Signed in", "You"], ["Plugins ready", "design 2.0.0 · flow 2.0.0"]].map(([a, b]) => (
              <span className="ad-check" key={a}><span className="ad-check-ic"><Icon name="check" size={12} /></span><span>{a}</span><span className="k-mono ad-check-v">{b}</span></span>
            ))}
          </div>
          <div className="island ad-toastish"><Icon name="sync" size={14} />Combine-kampan reloaded.</div>
        </div>
      </div>
    </Closeup>
  );
}

function SyncdBoard() {
  return (
    <Closeup title="Sync details — the old Sync panel, kept whole" sub="Menu › Diagnostics › Sync. Alligators brand, cloud-linked. What needs you comes first, each with its own choice; the lists and counts follow."
      note={<Note n={bn("ad-syncd")} title="Every row of today's Sync panel, in one place.">Get latest, conflicts with Keep mine · Use theirs · Keep both, the unfinished AI edit, Sign in again, transfers with Cancel, held · rate-limited · failed, and the terminal hints under Advanced. Resync now and Download all stay in Diagnostics › Advanced.</Note>}>
      <div className="ad-syncd-wrap">
        <div className="island island--pad ad-sd">
          <div className="ad-syncd-hd"><strong>Sync · Alligators brand</strong><StatusWord state="warn">2 need you</StatusWord></div>
          <div className="ad-sd-latest"><span className="ad-sd-l"><Avatar who="tereza" size="sm" />2 new versions from Tereza · Uniformy-2027</span><Btn primary>Get latest</Btn></div>
          <ASub>Needs you · 2</ASub>
          <div className="ad-sd-card">
            <span className="ad-sd-ct"><Icon name="problem" size={14} /><strong>Uniformy-2027 changed here and in the cloud.</strong></span>
            <span className="ad-sd-cd">Helma z boku — you at 14:02, Tereza at 14:04. Both versions are kept until you choose.</span>
            <div className="ad-acts"><Btn>Keep mine</Btn><Btn>Use theirs</Btn><Btn>Keep both</Btn><span className="ad-link ad-sd-cmp">Compare</span></div>
          </div>
          <div className="ad-sd-card">
            <span className="ad-sd-ct"><Spark size={12} /><strong>AI stopped halfway on Combine-video-AI.</strong></span>
            <span className="ad-sd-cd">The app quit at 13:58 while AI was cutting the trailer. The half-done cut is on this Mac only.</span>
            <div className="ad-acts"><Btn>Publish</Btn><Btn>Discard</Btn></div>
          </div>
          <ASub>Moving now</ASub>
          <div className="ad-xfer"><span className="k-mono">combine-40yd.mov</span><span className="ad-bar"><i style={{ width: "62%" }} /></span><span className="ad-xfer-n">62%</span><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
          <div className="ad-xfer"><span className="k-mono">tunel-noc.mp4</span><span className="ad-bar"><i style={{ width: "18%" }} /></span><span className="ad-xfer-n">18%</span><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
        </div>
        <div className="ad-sd-side">
          <div className="island island--pad ad-syncd">
            <ASub>Counts</ASub>
            <ARow k="Project files">1 318 · all here</ARow>
            <ARow k="Assets">247 · 2 moving</ARow>
            <ARow k="Held · rate-limited · failed">0 · 0 · 0</ARow>
            <ARow k="Trash">12 things — the Canvases panel's last row</ARow>
            <Fold open hint="Hub, commands">
              <ARow k="Hub" mono copy>alligators.cloud.maude.sh</ARow>
              <ARow k="Last good sync" mono>14:12:51</ARow>
              <Cmd note="Terminal — the same status">maude design status</Cmd>
              <Cmd note="Claude Code — undo a canvas from its history">/design:rollback Uniformy-2027</Cmd>
            </Fold>
          </div>
          <div className="island island--pad ad-syncd">
            <p className="ad-sd-when">When the sign-in runs out</p>
            <div className="ad-sd-card ad-sd-card--flat">
              <span className="ad-sd-ct"><Icon name="lock" size={14} /><strong>Sync stopped — the sign-in to the cloud ran out.</strong></span>
              <span className="ad-sd-cd">Your changes are kept on this Mac and go out after you sign in.</span>
              <div className="ad-acts"><Btn primary>Sign in again</Btn></div>
            </div>
          </div>
        </div>
      </div>
    </Closeup>
  );
}

/* ═══ 4 · Settings ════════════════════════════════════════════════════════════════════════════ */

function SettingsSheet({ tab, children, style }: { tab: "General" | "Connections" | "Advanced"; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ad-settings" style={style}>
      <div className="ad-set-rail">
        <p className="ad-set-t">Settings</p>
        {(["General", "Connections", "Advanced"] as const).map((t) => (
          <span key={t} className="row-item ad-set-tab" aria-current={t === tab ? "true" : undefined}><Icon name={t === "General" ? "settings" : t === "Connections" ? "link" : "more"} size={14} />{t}</span>
        ))}
        <span className="ad-set-sp" />
        <span className="ad-set-foot">Maude 2.0.0</span>
      </div>
      <div className="ad-set-main">{children}</div>
    </div>
  );
}
function SGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ad-sg"><p className="ad-sg-t">{title}</p>{children}</div>;
}
/** An engine's model card (was Settings › Subtitles / Video). */
function ModelCard({ name, state, size, cmd, action }: { name: string; state: ReactNode; size: string; cmd: string; action: string }) {
  return (
    <div className="ad-model">
      <span className="ad-model-hd"><strong>{name}</strong><span className="ad-model-sz">{size}</span></span>
      <span className="ad-model-st">{state}<Btn ghost>{action}</Btn></span>
      <Cmd>{cmd}</Cmd>
    </div>
  );
}

function SettingsBoard({ theme = "light" }: { theme?: "light" | "dark" }) {
  return (
    <Stage theme={theme} note={<Note n={bn("ad-settings")} title="Seven tabs became three; nothing was dropped.">Advanced is about this Mac and this project — plain words, the exact value in mono beside them. General (theme, account) is drawn in 02 · ob-settings; Connections in {bn("ad-edge-hub")}.</Note>}>
      <Window tabs={TABS2} activeTab={0}>
        <Canvas><Artboard label="Desktop" kind="web" x={300} y={140} w={403} h={252}><HeroMock /></Artboard></Canvas>
        <ProjectPill project="Studio site" canvas="Homepage" />
        <ShareCluster mode="edit" people={["tereza"]} />
        <Veil />
        <SettingsSheet tab="Advanced">
          <div className="ad-sg-cols">
            <div className="ad-sg-col">
              <SGroup title="This Mac">
                <ARow k="Version" mono>2.0.0 · build 412</ARow>
                <ARow k="Update"><span className="ad-inline"><span className="ad-val">2.0.1 is ready</span><Btn>Restart now</Btn></span></ARow>
                <ARow k="Local server port"><span className="input ad-input ad-input--sm k-mono">4402</span></ARow>
                <ARow k="Runtime" mono>Bun 1.3.4 · built in</ARow>
                <ARow k="Server build" mono>maude-dev-srv</ARow>
                <ARow k="Keys are kept in" mono>macOS Keychain</ARow>
                <p className="ad-hint">Or ~/.config/maude/keys.json when the Keychain is off. An update you skip installs when you next quit.</p>
              </SGroup>
              <SGroup title="Claude Code">
                <ARow k="Plugins" mono>design 2.0.0 · flow 2.0.0</ARow>
                <ARow k="Use my own plugin copy"><InSwitch on={false} /></ARow>
                <ARow k="Install and sign in automatically"><InSwitch on /></ARow>
                <ARow k="maude in the terminal"><CopyBtn label="Copy install command" /></ARow>
                <ARow k="Draw a mark with the SVG agent"><CopyBtn label="Copy command" /></ARow>
                <ARow k="Import a brand from the terminal"><CopyBtn label="Copy command" /></ARow>
              </SGroup>
              <SGroup title="Decision memory">
                <ARow k="Remember design decisions"><InSwitch on /></ARow>
                <ARow k="In this project" mono>523 decisions · kgai</ARow>
              </SGroup>
            </div>
            <div className="ad-sg-col">
              <SGroup title="Engines — Auto picks for you">
                <ARow k="Subtitles"><InSelect value="Auto" /></ARow>
                <ModelCard name="whisper.cpp · base" size="142 MB" state={<StatusWord state="ok">On this Mac</StatusWord>} action="Remove" cmd="brew install whisper-cpp" />
                <ARow k="Video keyframes"><InSelect value="Auto" /></ARow>
                <ModelCard name="Gemma 3 · 4B scout" size="3.3 GB" state={<StatusWord state="off">Not downloaded</StatusWord>} action="Download" cmd="ollama pull gemma3:4b" />
                <p className="ad-hint">Without a model, Auto uses ElevenLabs or Groq for subtitles and ffmpeg scene cuts for keyframes.</p>
              </SGroup>
              <SGroup title="Privacy">
                <ARow k="Send anonymous usage data"><InSwitch on={false} /></ARow>
                <ARow k="Logs in bug reports"><InSelect value="Ask each time" /></ARow>
              </SGroup>
            </div>
            <div className="ad-sg-col">
              <SGroup title="This project — Studio site">
                <ARow k="Sync project files, not only canvases"><InSwitch on /></ARow>
                <ARow k="Follow the trash from other devices"><InSwitch on /></ARow>
                <p className="ad-hint">Moved to the trash on another Mac — moved to the trash here too. Trash keeps it until you clear it out.</p>
                <ARow k="When a folder first links"><InSelect value="Keep asking" /></ARow>
                <ARow k="Who keeps .design/"><Btn ghost>This project · Hand over…</Btn></ARow>
              </SGroup>
              <SGroup title="Experimental">
                <ARow k="AI reviews argue it out (teams)"><InSwitch on={false} /></ARow>
                <ARow k="Faster canvas engine (preview)"><InSwitch on={false} /></ARow>
              </SGroup>
              <SGroup title="Reset">
                <div className="ad-acts ad-acts--wrap">
                  <Btn>Reset panel layout</Btn>
                  <Btn>Close all Advanced sections</Btn>
                  <span className="btn btn--sm ad-btn-warn">Reset all settings…</span>
                </div>
                <p className="ad-hint">⌘K “open advanced” opens them all, once ({bn("ad-open-all")}).</p>
              </SGroup>
            </div>
          </div>
        </SettingsSheet>
      </Window>
    </Stage>
  );
}

/* ═══ 5 · Power user ══════════════════════════════════════════════════════════════════════════ */

function PinnedBoard() {
  return (
    <Stage note={<Note n={bn("ad-pinned")} title="Pin panels to the side — docked, as an option.">Menu › View › Advanced. Panels sit flush with handles to drag; each keeps its Advanced at the foot, and opened folds stay open; ⌘\ still hides them all.</Note>}>
      <Window tabs={TABS2} activeTab={1}>
        <div className="ad-dock">
          <div className="ad-dock-l">
            <div className="ad-dock-pill"><ProjectPill project="Alligators brand" canvas="Combine-kampan" style={FREE} /></div>
            <CanvasesPanel project="Alligators brand" count={ALLIGATORS_COUNT} selected="Combine-kampan" folders={ALLIGATORS_FOLDERS} items={ALLIGATORS_ROOT} style={{ ...FREE, width: "100%", maxHeight: "none", flex: 1, boxShadow: "none", background: "transparent", backdropFilter: "none" }} />
            <div className="ad-dock-fold"><Fold hint="Files, folder, Trash" /></div>
          </div>
          <span className="ad-handle"><i /></span>
          <div className="ad-dock-c">
            <Canvas><Kampan x={28} y={110} sel="post" /></Canvas>
            <ZoomUndo zoom={20} />
            <Toolbar />
            <PanelIcon icon="spark" at="ai" />
            <span className="ad-handle-tip">Drag · double-click resets · ← → move 8</span>
          </div>
          <span className="ad-handle ad-handle--on"><i /></span>
          <div className="ad-dock-r">
            <ShareCluster mode="edit" people={["tereza"]} style={{ ...FREE, boxShadow: "none", background: "transparent", backdropFilter: "none" }} />
            <Insp title="Post 1:1 · Combine 2026" kind="Artboard" width={316} style={{ boxShadow: "none", background: "transparent", backdropFilter: "none" }} rows={[["Preset", <InSelect value="Post" />], ["Size", <InSize w={1080} h={1080} />], ["Fill", <InFill name="Gator green" tone="green" />]]} fold={
              <Fold open remembered>
                <ASub>Exact size</ASub>
                <ARow k="Artboard" mono>1080 × 1080 px</ARow>
                <ASub>Look and layout</ASub>
                <ARow k="Theme"><InSelect value="DS default" /></ARow>
                <ASub>In code</ASub>
                <ARow k="Element id" mono copy>cd-post-1x1</ARow>
                <div className="ad-csslist"><Css k="width" v="1080px" /><Css k="height" v="1080px" /><Css k="background" v="var(--gator-green)" /></div>
              </Fold>
            } />
          </div>
        </div>
      </Window>
    </Stage>
  );
}

function SearchBoard() {
  const groups: { title: string; keys: [string, string][] }[] = [
    { title: "Edit tools", keys: [["Select", "V"], ["Hand", "H"], ["Frame", "F"], ["Shape", "R"], ["Pen", "P"], ["Text", "T"], ["Image", "I"], ["Component", "⇧I"]] },
    { title: "Preview tools — the key switches to Preview", keys: [["Sticky", "N"], ["Comment", "C"], ["Marker", "M"], ["Arrow", "A"], ["Stickers", "E"], ["Section", "S"]] },
    { title: "Canvas", keys: [["Zoom to fit", "⌘0"], ["Actual size", "⌘1"], ["Undo", "⌘Z"], ["Redo", "⇧⌘Z"], ["Step back", "esc"]] },
    { title: "Panels and AI", keys: [["Hide / show panels", "⌘\\"], ["Ask AI", "⌘/"], ["Comments", "⇧⌘M"], ["Search", "⌘K"], ["All shortcuts", "?"]] },
    { title: "File", keys: [["New canvas", "⌘N"], ["Version history", "⌥⌘H"], ["Export…", "⇧⌘E"], ["Settings…", "⌘,"]] },
  ];
  const adv: [string, string, string][] = [["Inspector", "⇧⌘I", "Menu › View › Advanced"], ["Keep timeline open", "⇧⌘T", "Menu › View › Advanced"], ["Reload canvas", "⌘R", "Menu › Diagnostics"]];
  const moved: [string, string][] = [["Changes ⇧⌘G", "Version history ⌥⌘H"], ["Assistant ⇧⌘A", "Ask AI ⌘/ — ⇧⌘A now selects all annotations"], ["Files tree T", "Hide panels ⌘\\ — T is Text"], ["Hidden files H", "Canvases › Advanced — H is Hand"], ["Design system S", "⌘K “design system” — S is Section"], ["New board N", "New canvas ⌘N — N is Sticky, in Preview"], ["Search / and ⌘F", "⌘K"], ["Arrow, Highlighter", "Preview's toolbar — Arrow A; Highlighter is Marker's second tip"], ["Section, Eraser", "Preview's toolbar — Section S; Eraser is a Marker option"], ["Insert", "Edit's toolbar — Image I · Component ⇧I"]];
  /* Three columns, balanced by row count: Edit tools · Preview tools + File · Canvas + Panels and AI. */
  const cols = [[0], [1, 4], [2, 3]];
  return (
    <Closeup title="Two keys find everything — ⌘K by name, ? by key" sub="Search shows where each hidden tool lives, so you learn the way back. The shortcut sheet keeps the Advanced keys, and the keys that moved, one fold down."
      note={<Note n={bn("ad-search")} title="Learn the home while you use the shortcut.">Every Search result carries its path — Inspector › Advanced, Menu › Diagnostics — and ↵ runs it without opening the menu. The ? sheet splits the tools by toolbar — Edit's make things inside artboards, Preview's only mark up — and its Advanced holds only View › Advanced and Diagnostics keys, plus every key and tool that moved.</Note>}>
      <div className="ad-two">
        <SearchPalette query="copy" style={{ ...FREE, translate: "none", width: 560 }} groups={[
          { title: "Actions", aside: "6 hidden tools", rows: [
            { label: "Copy code", icon: "duplicate", where: "Inspector › Advanced", selected: true },
            { label: "Copy element id", icon: "duplicate", where: "Inspector › Advanced" },
            { label: "Copy file path", icon: "file", where: "Canvases › Advanced" },
            { label: "Copy export command", icon: "export", where: "Export › Advanced" },
            { label: "Copy transcript", icon: "comment", where: "AI chat panel › Advanced" },
            { label: "Copy logs", icon: "pulse", where: "Menu › Diagnostics › Logs" },
          ] },
          { title: "Also", rows: [{ label: "Copy link", icon: "link", where: "Share" }] },
        ]} footer="7 results" />
        <div className="ad-keys-sheet">
          <div className="ad-ks-hd"><strong>Keyboard shortcuts</strong><span className="k-find ad-ks-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Find a shortcut</span></span><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
          <div className="ad-ks-grid ad-ks-grid--3">
            {cols.map((c) => (
              <div className="ad-ks-col" key={c.join()}>
                {c.map((i) => groups[i]).map((g) => (
                  <div className="ad-ks-g" key={g.title}>
                    <p className="ad-ks-gt">{g.title}</p>
                    {g.keys.map(([l, k]) => <span className="ad-ks-r" key={l}><span>{l}</span><Kbd>{k}</Kbd></span>)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <Fold open remembered>
            <div className="ad-ks-adv">
              {adv.map(([l, k, p]) => <span className="ad-ks-r ad-ks-r--adv" key={l}><span>{l}</span><span className="ad-ks-p">{p}</span><Kbd>{k}</Kbd></span>)}
              <ASub>Keys and tools that moved</ASub>
              {moved.map(([o, n]) => <span className="ad-ks-r ad-ks-mv" key={o}><span className="ad-ks-o">{o}</span><Icon name="submenu" size={11} /><span className="ad-ks-n">{n}</span></span>)}
            </div>
          </Fold>
        </div>
      </div>
    </Closeup>
  );
}

function OpenAllBoard() {
  return (
    <Closeup title="“Advanced mode”, as a one-shot — ⌘K › Open all Advanced sections" sub="The answer to “advanced mode”: one action that opens every fold at once. Nothing stays switched on — from then on each panel remembers its own fold, like any fold you open."
      note={<Note n={bn("ad-open-all")} title="A command, not a mode.">Open all is the inverse of Close all Advanced sections (Settings › Advanced › Reset). Neither leaves a switch behind, so the app never has two looks; ⌘Z doesn't undo it, Close all does.</Note>}>
      <div className="ad-cols ad-cols--top">
        <Col label="⌘K “advanced”">
          <SearchPalette query="advanced" style={{ ...FREE, translate: "none", width: 520 }} groups={[
            { title: "Actions", rows: [
              { label: "Open all Advanced sections", icon: "chevron", where: "Once · every panel", selected: true },
              { label: "Close all Advanced sections", icon: "submenu", where: "Settings › Advanced › Reset" },
            ] },
            { title: "Places", rows: [
              { label: "Inspector › Advanced", icon: "panel-right", where: "Inspector" },
              { label: "Menu › View › Advanced", icon: "view", where: "Menu" },
              { label: "Menu › Diagnostics › Advanced", icon: "pulse", where: "Menu" },
              { label: "Settings › Advanced", icon: "settings", where: "Settings…  ⌘," },
            ] },
          ]} footer="6 results" />
        </Col>
        <Arrow />
        <Col label="↵ — every fold opens, once" open>
          <div className="ad-oa">
            <MiniWin variant="all" />
            <div className="island ad-toastish ad-oa-toast"><Icon name="check" size={14} />All Advanced sections are open.<span className="btn btn--ghost btn--sm">Close all</span></div>
          </div>
          <ul className="ad-why-list ad-oa-list">
            <li>Opens the fold of every panel, the menu's Advanced groups and the ? sheet's.</li>
            <li>Each panel then remembers its own, on this Mac ({bn("ad-edge-remember")}).</li>
            <li>No badge, no switch, no second look for screenshots or teammates.</li>
          </ul>
        </Col>
      </div>
    </Closeup>
  );
}

function CodeBoard() {
  const code: [number, ReactNode, boolean?][] = [
    [1, <span className="ad-c-com">{"/** @canvas Combine-kampan — nábor 2026 · web, social, print, video */"}</span>],
    [2, <><span className="ad-c-kw">import</span> {"\"../../system/alligators/colors_and_type.css\";"}</>],
    [3, <><span className="ad-c-kw">import</span> {"{ DesignCanvas, DCSection, DCArtboard } "}<span className="ad-c-kw">from</span> <span className="ad-c-str">"@maude/canvas-lib"</span>;</>],
    [4, ""],
    [5, <><span className="ad-c-kw">export default function</span> <span className="ad-c-fn">CombineKampan</span>() {"{"}</>],
    [6, <>{"  "}<span className="ad-c-kw">return</span> (</>],
    [7, <>{"    <DesignCanvas>"}</>],
    [8, <>{"      <DCSection "}<span className="ad-c-at">id</span>=<span className="ad-c-str">"social"</span>{" "}<span className="ad-c-at">title</span>=<span className="ad-c-str">"Sociální sítě"</span>{">"}</>],
    [9, <>{"        <DCArtboard "}<span className="ad-c-at">id</span>=<span className="ad-c-str">"post-1x1"</span>{" "}<span className="ad-c-at">width</span>={"{1080}"} <span className="ad-c-at">height</span>={"{1080}"}{">"}</>, true],
    [10, <>{"          <section "}<span className="ad-c-at">className</span>=<span className="ad-c-str">"gt-post"</span>{">"}</>, true],
    [11, <>{"            <h1>COMBINE 2026</h1>"}</>, true],
    [12, <>{"            <p>So 14. 3. · Kraví hora</p>"}</>, true],
    [13, <>{"            <a "}<span className="ad-c-at">className</span>=<span className="ad-c-str">"btn"</span>{">ZAPIŠ SE</a>"}</>, true],
    [14, <>{"          </section>"}</>, true],
    [15, <>{"        </DCArtboard>"}</>, true],
    [16, <>{"        <DCArtboard "}<span className="ad-c-at">id</span>=<span className="ad-c-str">"story-9x16"</span>{" "}<span className="ad-c-at">width</span>={"{1080}"} <span className="ad-c-at">height</span>={"{1920}"}{">"}</>],
    [17, <>{"          <StoryZapisSe />"}</>],
    [18, <>{"        </DCArtboard>"}</>],
    [19, <>{"      </DCSection>"}</>],
    [20, <>{"      <DCSection "}<span className="ad-c-at">id</span>=<span className="ad-c-str">"print"</span>{" "}<span className="ad-c-at">title</span>=<span className="ad-c-str">"Tisk"</span>{">"}</>],
    [21, <>{"        <DCArtboard "}<span className="ad-c-at">id</span>=<span className="ad-c-str">"a4-plakat"</span>{" "}<span className="ad-c-at">kind</span>=<span className="ad-c-str">"print"</span>{" "}<span className="ad-c-at">width</span>={"{794}"}{">"}</>],
    [22, <>{"          <PlakatCombine bleed={3} />"}</>],
    [23, <>{"        </DCArtboard>"}</>],
  ];
  return (
    <Stage note={<Note n={bn("ad-code")} title="The code is one look away, read-only.">View code (Canvases › Advanced, or ⌘K) marks the selected artboard's lines. Open in editor; the terminal commands sit under Advanced.</Note>}>
      <Window tabs={TABS2} activeTab={1}>
        <Canvas><Kampan x={64} y={120} sel="post" /></Canvas>
        <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
        <PanelIcon icon="panel-left" at="left" />
        <ZoomUndo zoom={20} />
        <div className="island ad-code">
          <div className="ad-code-hd">
            <Icon name="file" size={14} />
            <strong>Combine-kampan</strong>
            <span className="k-mono ad-code-path">2026/combine/Combine-kampan.tsx</span>
            <span className="chip"><Icon name="lock" size={11} />Read only</span>
            <span className="ad-tl-sp" />
            <CopyBtn label="Copy" />
            <Btn primary icon="edit">Open in editor</Btn>
            <span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span>
          </div>
          <div className="ad-code-body k-mono">
            {code.map(([n, c, hl]) => <span key={n} className={`ad-cl${hl ? " ad-cl--hl" : ""}`}><span className="ad-cl-n">{n}</span><span className="ad-cl-c">{c}</span></span>)}
          </div>
          <div className="ad-code-foot">
            <Fold open>
              <ASub>From the terminal — this canvas</ASub>
              <Cmd>maude design screenshot --canvas "2026/combine/Combine-kampan.tsx" --screen post-1x1</Cmd>
              <Cmd>maude design export png --scope canvas-as-separate --option scale=2</Cmd>
              <Cmd>maude design read-annotations "2026/combine/Combine-kampan.tsx"</Cmd>
              <ASub>In Claude Code</ASub>
              <Cmd>/design:edit "make the post greener, keep the logo white"</Cmd>
              <Cmd>/design:critic --agent brand-critic</Cmd>
            </Fold>
          </div>
        </div>
      </Window>
    </Stage>
  );
}

/* ═══ 6 · Edge cases ══════════════════════════════════════════════════════════════════════════ */

function EdgeSyncBoard() {
  return (
    <Stage note={<Note n={bn("ad-edge-sync")} title="A sync problem, in words, with one next step.">What happened, what is safe, one verb — Try now. The status beside the faces keeps a CONTRACT §6 word — Syncing… — and the hub, reply code and waiting files live one fold down.</Note>}>
      <Window tabs={TABS2} activeTab={1}>
        <Canvas><Kampan x={64} y={120} /></Canvas>
        <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
        <PanelIcon icon="panel-left" at="left" />
        <ShareCluster mode="edit" people={["tereza", "jonas"]} status="syncing" statusText="Syncing…" />
        <ZoomUndo zoom={20} />
        <Toolbar />
        <PanelIcon icon="spark" at="ai" />
        <div className="island island--pad ad-callout">
          <span className="ad-callout-caret" />
          <div className="ad-callout-hd"><span className="ad-callout-ic"><Icon name="clock" size={16} /></span><strong>3 changes are waiting to reach the cloud.</strong></div>
          <p className="ad-callout-d">They're safe on this Mac. The cloud is busy and asked to wait — the next try is in 40 s, by itself.</p>
          <div className="ad-acts ad-acts--end"><Btn primary>Try now</Btn></div>
          <Fold open>
            <ARow k="Hub" mono>alligators.cloud.maude.sh</ARow>
            <ARow k="Reply" mono>429 · rate limited</ARow>
            <ARow k="Next try" mono>14:06:40</ARow>
            <ARow k="Last good sync" mono>14:02:51</ARow>
            <ASub aside={<CopyBtn />}>Waiting · 3</ASub>
            <div className="ad-files k-mono">
              <span>2026/combine/Combine-kampan.tsx</span>
              <span>2026/combine/Combine-kampan.meta.json</span>
              <span>assets/7c40e2b1.mov · 412 MB</span>
            </div>
            <p className="ad-hint">A full compare is Resync now, in Menu › Diagnostics › Advanced.</p>
          </Fold>
        </div>
      </Window>
    </Stage>
  );
}

function EdgeSyntaxBoard() {
  return (
    <Stage note={<Note n={bn("ad-edge-syntax")} title="Broken code, said plainly — the details for the developer.">Someone edited Pricing in an editor and left it unfinished. Everyone gets one sentence and one way out; the error, the exact line and Open in editor sit under Advanced.</Note>}>
      <Window tabs={TABS2} activeTab={0}>
        <Canvas>
          <span className="ad-ghost" style={{ left: 250, top: 150, width: 403, height: 252 }} />
          <span className="ad-ghost" style={{ left: 693, top: 150, width: 234, height: 334 }} />
          <span className="ad-ghost" style={{ left: 967, top: 150, width: 109, height: 236 }} />
          <div className="ad-err">
            <div className="ad-callout-hd"><span className="ad-callout-ic ad-callout-ic--err"><Icon name="problem" size={16} /></span><strong>Pricing can't be drawn right now.</strong></div>
            <p className="ad-callout-d">Its code was changed outside the app 2 min ago and stops halfway on line 212. Other canvases are fine; the last good version is in Version history.</p>
            <div className="ad-acts ad-acts--end"><span className="btn btn--sm btn--spark"><Spark size={10} color="var(--spark-fg)" />Ask AI to fix it</span></div>
            <Fold open>
              <ARow k="Error" mono>{"SyntaxError: Expected \"}\" but found \")\""}</ARow>
              <ARow k="Where" mono copy>Pricing.tsx · line 212, column 19</ARow>
              <div className="ad-code-snip k-mono">
                <span><span className="ad-cl-n">210</span>{"  <span className=\"pr-plan\">"}</span>
                <span><span className="ad-cl-n">211</span>{"    <b>{plan.name}</b>"}</span>
                <span className="ad-snip-bad"><span className="ad-cl-n">212</span>{"    <i>{plan.price)</i>"}</span>
                <span className="ad-snip-caret"><span className="ad-cl-n" />{"                  ^"}</span>
                <span><span className="ad-cl-n">213</span>{"  </span>"}</span>
              </div>
              <div className="ad-acts"><Btn icon="edit">Open in editor</Btn><CopyBtn label="Copy error" /><Btn ghost icon="history">Last good version</Btn></div>
            </Fold>
          </div>
        </Canvas>
        <ProjectPill project="Studio site" canvas="Pricing" />
        <PanelIcon icon="panel-left" at="left" />
        <ShareCluster mode="edit" people={["tereza"]} />
        <ZoomUndo zoom={28} />
        <Toolbar />
        <PanelIcon icon="spark" at="ai" />
      </Window>
    </Stage>
  );
}

function EdgeHubBoard({ theme = "light" }: { theme?: "light" | "dark" }) {
  return (
    <Stage theme={theme} note={<Note n={bn("ad-edge-hub")} title="A self-hosted hub looks exactly like the cloud.">Studio site syncs to the team's own server. The window says Saved, like any cloud project; the address and the access token appear only under that connection's Advanced.</Note>}>
      <Window tabs={TABS2} activeTab={0}>
        <Canvas>
          <Artboard label="Desktop" kind="web" x={250} y={140} w={403} h={252}><HeroMock /></Artboard>
          <Artboard label="Pricing" kind="web" x={693} y={140} w={403} h={252}><PricingMock /></Artboard>
        </Canvas>
        <ProjectPill project="Studio site" canvas="Homepage" />
        <ShareCluster mode="edit" people={["tereza"]} />
        <Veil />
        <SettingsSheet tab="Connections">
          <div className="ad-conn">
            <div className="ad-conn-r"><span className="ad-conn-ic"><Icon name="cloud" size={16} /></span><span className="ad-conn-t"><strong>Maude Cloud</strong><span>Signed in as You</span></span><span className="btn btn--sm">Sign out</span><span className="ad-conn-adv"><Icon name="submenu" size={12} />Advanced</span></div>
            <div className="ad-conn-r ad-conn-r--open">
              <span className="ad-conn-ic"><Icon name="server" size={16} /></span>
              <span className="ad-conn-t"><strong>Studio site — your team's own server</strong><span className="k-sw k-sw--ok"><i />Connected · saved 1 min ago</span></span>
              <span className="btn btn--sm">Sign out</span>
              <div className="ad-conn-fold">
                <Fold open>
                  <ARow k="Address" mono copy>https://hub.studio-brno.cz</ARow>
                  <ARow k="Access token" mono><span className="ad-inline">•••• •••• a91f<Btn ghost>Replace…</Btn></span></ARow>
                  <ARow k="Signed in as" mono>you@studio-brno</ARow>
                  <ARow k="Hub version" mono>maude-hub 2.0.0</ARow>
                </Fold>
              </div>
            </div>
            {[["link", "GitHub", "Not connected", "Connect"], ["spark", "AI images, video and voice", "2 keys · Gemini, ElevenLabs", "Manage"], ["image", "Figma", "Connected · for imports", "Disconnect"]].map(([i, a, b, c]) => (
              <div className="ad-conn-r" key={a}><span className="ad-conn-ic">{i === "spark" ? <Spark size={14} /> : <Icon name={i} size={16} />}</span><span className="ad-conn-t"><strong>{a}</strong><span>{b}</span></span><span className="btn btn--sm">{c}</span><span className="ad-conn-adv"><Icon name="submenu" size={12} />Advanced</span></div>
            ))}
          </div>
        </SettingsSheet>
      </Window>
    </Stage>
  );
}

/* ─── Where you are changes a few Advanced rows (proposed) ─── */
type Cell = { t: string; s?: "same" | "swap" | "hide" | "grey" };
const WHERE_COLS = ["Mac app", "In the browser", "Can comment · Jonas", "Local project", "Offline"];
const WHERE_ROWS: [string, string, Cell[]][] = [
  ["Save status", "beside the faces", [{ t: "Saved" }, { t: "Saved" }, { t: "Can comment" }, { t: "Local project" }, { t: "Offline — kept on this Mac" }]],
  ["Reveal in Finder · Open in editor", "Canvases › Advanced", [{ t: "✓", s: "same" }, { t: "Open in the Mac app", s: "swap" }, { t: "hidden", s: "hide" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
  ["Open in terminal", "AI chat panel › Advanced", [{ t: "✓", s: "same" }, { t: "hidden", s: "hide" }, { t: "hidden — no AI", s: "hide" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
  ["This Mac only link", "Share › Advanced", [{ t: "✓", s: "same" }, { t: "hidden", s: "hide" }, { t: "hidden", s: "hide" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
  ["Link rules · GitHub invite", "Share › Advanced", [{ t: "✓", s: "same" }, { t: "✓", s: "same" }, { t: "hidden", s: "hide" }, { t: "Move to the cloud to share", s: "swap" }, { t: "greyed — needs the internet", s: "grey" }]],
  ["Address · Process · Project folder", "Diagnostics › Advanced", [{ t: "✓", s: "same" }, { t: "Runs in the cloud", s: "swap" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
  ["Resync now · Download all", "Diagnostics › Advanced", [{ t: "✓", s: "same" }, { t: "Download all only", s: "swap" }, { t: "Download all only", s: "swap" }, { t: "hidden — nothing syncs", s: "hide" }, { t: "greyed — back online", s: "grey" }]],
  ["Raw CSS · Property · Attribute", "Inspector › Advanced", [{ t: "✓", s: "same" }, { t: "✓", s: "same" }, { t: "read-only · Copy CSS", s: "swap" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
  ["Branch · Publish · Fetch", "Version history › Advanced", [{ t: "✓", s: "same" }, { t: "hidden — cloud versions", s: "hide" }, { t: "hidden", s: "hide" }, { t: "✓ if it's a git folder", s: "same" }, { t: "Save ✓ · Publish waits", s: "grey" }]],
  ["Settings › Advanced › This Mac", "Settings", [{ t: "✓", s: "same" }, { t: "hidden — General, Connections", s: "hide" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }, { t: "✓", s: "same" }]],
];

function EdgeWhereBoard() {
  return (
    <Closeup title="Where you are changes a few Advanced rows — browser, comment-only, local, offline" sub="cloud.maude.sh is the main way in, and a browser has no Finder, no terminal and no local port. Proposed: Mac-only rows are hidden or swapped, never shown broken."
      note={<Note n={bn("ad-edge-where")} title="Hidden, swapped or greyed — and the reason in the row.">In the browser, Reveal in Finder becomes Open in the Mac app and Diagnostics says Runs in the cloud. Jonas, who can comment, sees read-only CSS, no git and no AI. Offline greys only what needs the internet. Save words are CONTRACT §6.</Note>}>
      <div className="ad-where">
        <div className="ad-browser">
          <div className="ad-browser-bar"><span className="ad-browser-dots"><i /><i /><i /></span><span className="ad-browser-url"><Icon name="lock" size={11} />alligators.cloud.maude.sh/2026/combine/Combine-kampan</span></div>
          <div className="ad-browser-body">
            <div className="ad-where-pieces">
              <div>
                <span className="ad-col-l">Canvases › Advanced · row menu</span>
                <Menu width={232} style={FREE} items={[
                  { label: "Open in the Mac app", icon: "laptop", highlight: true }, { label: "View code", icon: "file" }, { label: "Copy link to this canvas", icon: "link" }, "sep", { label: "Rename file…" },
                ]} />
              </div>
              <div>
                <span className="ad-col-l">Menu › Diagnostics, Advanced</span>
                <Menu width={252} style={FREE} items={[
                  { label: "Sync", note: "Up to date" }, { label: "Server", note: "Runs in the cloud" }, "sep", { label: "Logs" }, { label: "Reload canvas", keys: "⌘R" }, "sep",
                  { group: "Advanced" }, { label: "Hub", note: "alligators.cloud.maude.sh" }, { label: "Download all", icon: "export" },
                ]} />
              </div>
            </div>
          </div>
        </div>
        <div className="ad-wt">
          <div className="ad-wt-row ad-wt-row--hd"><span className="ad-wt-k">Advanced row</span>{WHERE_COLS.map((c) => <span key={c} className="ad-wt-c">{c}</span>)}</div>
          {WHERE_ROWS.map(([k, home, cells]) => (
            <div className="ad-wt-row" key={k}>
              <span className="ad-wt-k"><strong>{k}</strong><span>{home}</span></span>
              {cells.map((c, i) => <span key={i} className={`ad-wt-c ad-wt-c--${c.s ?? "word"}`}>{c.t}</span>)}
            </div>
          ))}
          <p className="ad-hint">Proposed — Michal to confirm. Can comment comes from 04 · md-comment-only (05 · es-viewer draws the same); a local project's Share from 02 · ob-local-share.</p>
        </div>
      </div>
    </Closeup>
  );
}

function EdgeRememberBoard() {
  const small: [string, ReactNode][] = [["Size", <InSize w={150} h={48} />], ["Fill", <InFill name="Ink" tone="ink" />]];
  return (
    <Closeup title="An Advanced you open stays open — for that panel" sub="Remembered per panel, on this Mac. Never a mode: the other panels keep their own state."
      note={<Note n={bn("ad-edge-remember")} title="Opened once, there next time; the rest stays calm.">Open Inspector › Advanced on Monday and it's open on Tuesday, on any canvas. The Canvases panel kept its own choice. Settings › Advanced › Reset lists what's open and folds them all again.</Note>}>
      <div className="ad-rem">
        <div className="ad-rem-step">
          <span className="ad-rem-n">Monday · Studio site · Homepage</span>
          <p className="ad-rem-d">You open Advanced in the inspector to copy a token name.</p>
          <Insp title="Book a call" kind="Button" rows={small} fold={<Fold open><ARow k="Fill" mono>--ink</ARow><ARow k="Element id" mono copy>cd-4f1a2c</ARow><div className="ad-csslist"><Css k="padding" v="12px 24px" /><Css k="background" v="var(--ink)" /></div></Fold>} />
        </div>
        <Arrow />
        <div className="ad-rem-step">
          <span className="ad-rem-n">Tuesday · Alligators brand · Combine-kampan</span>
          <p className="ad-rem-d">A different element in another project — Advanced is already open.</p>
          <Insp title="ZAPIŠ SE" kind="Button" rows={[["Size", <InSize w={220} h={64} />], ["Fill", <InFill name="Gator green" tone="green" />]]} fold={<Fold open remembered><ARow k="Fill" mono>--gator-green</ARow><ARow k="Element id" mono copy>cd-91be07</ARow><div className="ad-csslist"><Css k="padding" v="16px 32px" /><Css k="background" v="var(--gator-green)" /></div></Fold>} />
        </div>
        <div className="ad-rem-step">
          <span className="ad-rem-n">Same Tuesday · the left panel</span>
          <p className="ad-rem-d">Canvases › Advanced was never opened, so it stays folded.</p>
          <LeftPanel width={268} fold={<Fold hint="Files, folder, Trash" />}>
            <p className="island-title k-cp-t">Alligators brand<span className="k-cp-tc">{ALLIGATORS_COUNT} canvases</span></p>
            {GATOR_ROWS(false).slice(0, 7).map((r) => <TreeRow key={r.name + r.depth} r={r} files={false} />)}
          </LeftPanel>
        </div>
        <div className="ad-rem-step ad-rem-step--reset">
          <span className="ad-rem-n">Fold them all again</span>
          <div className="island island--pad ad-rem-reset">
            <PathChip>Settings › Advanced › Reset</PathChip>
            <ARow k="Close all Advanced sections"><Btn>Close all</Btn></ARow>
            <ASub>Open now, on this Mac</ASub>
            {[["Inspector › Advanced", true], ["Version history › Advanced", true], ["Canvases › Advanced", false], ["Share › Advanced", false]].map(([l, on]) => (
              <ARow key={l as string} k={l as string}><InSwitch on={on as boolean} /></ARow>
            ))}
            <p className="ad-hint">Or ⌘K “close advanced”. Its inverse, “open advanced”, is {bn("ad-open-all")}.</p>
          </div>
        </div>
      </div>
    </Closeup>
  );
}

/* ═══ The canvas ═════════════════════════════════════════════════════════════════════════════ */
export default function Advanced() {
  return (
    <DesignCanvas>
      <DCSection id="map" title="Nothing deleted — where everything went" subtitle={`${TOTAL} things visible today, each with its new home and the artboard that draws it · why there is no switch · one thing traced end to end`}>
        <DCArtboard id="ad-map" label={lab("ad-map", `The map — ${TOTAL} things, each with its home`)} width={W} height={2560} fixed>
          <MapBoard />
        </DCArtboard>
        <DCArtboard id="ad-why" label={lab("ad-why")} width={W} height={H} fixed><WhyBoard /></DCArtboard>
        <DCArtboard id="ad-trace" label={lab("ad-trace")} width={W} height={H} fixed><TraceBoard /></DCArtboard>
      </DCSection>

      <DCSection id="panels" title="Advanced, inside each panel — closed, then open" subtitle="Inspector · Canvases, Layers and Trash · AI chat panel · Share · Timeline · Export · Version history · Design system › Advanced">
        <DCArtboard id="ad-inspector" label={lab("ad-inspector")} width={W} height={1180} fixed><InspectorBoard /></DCArtboard>
        <DCArtboard id="ad-left" label={lab("ad-left")} width={W} height={1360} fixed><LeftBoard /></DCArtboard>
        <DCArtboard id="ad-ai" label={lab("ad-ai")} width={W} height={1080} fixed><AiBoard /></DCArtboard>
        <DCArtboard id="ad-share" label={lab("ad-share")} width={W} height={H} fixed><ShareBoard /></DCArtboard>
        <DCArtboard id="ad-timeline" label={lab("ad-timeline")} width={W} height={H} fixed><TimelineBoard /></DCArtboard>
        <DCArtboard id="ad-export" label={lab("ad-export")} width={W} height={H} fixed><ExportBoard /></DCArtboard>
        <DCArtboard id="ad-history" label={lab("ad-history")} width={W} height={H} fixed><HistoryBoard /></DCArtboard>
        <DCArtboard id="ad-ds" label={lab("ad-ds")} width={W} height={H} fixed><DsBoard /></DCArtboard>
      </DCSection>

      <DCSection id="diagnostics" title="The menu and Menu › Diagnostics" subtitle="File · View › Advanced · Help take in the menu bar; Diagnostics shows status in words, Logs, Server, AI setup, and the whole old Sync panel">
        <DCArtboard id="ad-menus" label={lab("ad-menus")} width={W} height={H} fixed><MenusBoard /></DCArtboard>
        <DCArtboard id="ad-diag" label={lab("ad-diag")} width={W} height={H} fixed><DiagBoard /></DCArtboard>
        <DCArtboard id="ad-logs" label={lab("ad-logs")} width={W} height={H} fixed><LogsBoard /></DCArtboard>
        <DCArtboard id="ad-syncd" label={lab("ad-syncd")} width={W} height={H} fixed><SyncdBoard /></DCArtboard>
      </DCSection>

      <DCSection id="settings" title="Settings › Advanced" subtitle="General · Connections · Advanced — this Mac and this project, plain words, the exact value in mono beside them">
        <DCArtboard id="ad-settings" label={lab("ad-settings")} width={W} height={H} fixed><SettingsBoard /></DCArtboard>
      </DCSection>

      <DCSection id="power" title="For people who live in Advanced" subtitle="Pin panels to the side · ⌘K with paths · the ? sheet · Open all Advanced, once · the code view and the terminal commands">
        <DCArtboard id="ad-pinned" label={lab("ad-pinned")} width={W} height={H} fixed><PinnedBoard /></DCArtboard>
        <DCArtboard id="ad-search" label={lab("ad-search")} width={W} height={H} fixed><SearchBoard /></DCArtboard>
        <DCArtboard id="ad-open-all" label={lab("ad-open-all")} width={W} height={H} fixed><OpenAllBoard /></DCArtboard>
        <DCArtboard id="ad-code" label={lab("ad-code")} width={W} height={H} fixed><CodeBoard /></DCArtboard>
      </DCSection>

      <DCSection id="edges" title="Edge cases" subtitle="A sync problem · broken canvas code · a self-hosted hub · in the browser, comment-only, local, offline · the remembered fold">
        <DCArtboard id="ad-edge-sync" label={lab("ad-edge-sync")} width={W} height={H} fixed><EdgeSyncBoard /></DCArtboard>
        <DCArtboard id="ad-edge-syntax" label={lab("ad-edge-syntax")} width={W} height={H} fixed><EdgeSyntaxBoard /></DCArtboard>
        <DCArtboard id="ad-edge-hub" label={lab("ad-edge-hub")} width={W} height={H} fixed><EdgeHubBoard /></DCArtboard>
        <DCArtboard id="ad-edge-where" label={lab("ad-edge-where")} width={W} height={H} fixed><EdgeWhereBoard /></DCArtboard>
        <DCArtboard id="ad-edge-remember" label={lab("ad-edge-remember")} width={W} height={H} fixed><EdgeRememberBoard /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
