/**
 * @canvas      ChatPanel — phase-31 native ACP chat sidepanel, docked in the REAL Maude app shell (maude DS) · 4 artboards
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   idle-ready | streaming-edit | agent-editing | not-connected
 * @brief       The native ACP chat sidepanel (DDR-123), shown AS it lives in the real
 *              Maude app — docked as an `st-rpanel` "Assistant" tab beside the real
 *              menubar, file-tree, dotted `st-stage` and `st-statusbar`. A developer
 *              drives Claude (/design:edit, /design:new, /design:critic, /design:screenshot)
 *              while watching the same canvas; the edit lands on the canvas with the real
 *              `st-activity` violet agent rim. Runs on the user's OWN `claude` CLI on their
 *              Pro/Max subscription — zero login in Maude, never API billing. Not-connected
 *              = a plain explainer in the panel; the rest of the app stays live.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (Studio.css shell + sibling ChatPanel.css)
 * @history     .design/_history/chatpanel/
 *
 * Re-housed (critic iter-3): the shell is now LIFTED verbatim from the real app
 * (Studio.tsx / Studio.css `st-*`), not an invented `chat-shell`. Only the chat
 * content (feed / tool-call card / composer / states) is canvas-local (`chat-*`).
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Studio.css";
import "./ChatPanel.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

/* ── Icon set (thin-stroke geometric, DS heritage) ─────────────────────────── */
const ICONS: Record<string, JSX.Element> = {
  "chevron-down": <polyline points="3.5 6 8 10.5 12.5 6" />,
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  file: (<><path d="M4 2h5l3 3v9H4z" /><polyline points="9 2 9 5 12 5" /></>),
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  search: (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /></>),
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  sliders: (<><line x1="3" y1="5" x2="13" y2="5" /><circle cx="6" cy="5" r="1.7" fill="currentColor" /><line x1="3" y1="11" x2="13" y2="11" /><circle cx="10" cy="11" r="1.7" fill="currentColor" /></>),
  comment: <path d="M3 3h10v7H7l-3 2.4V10H3z" />,
  pen: (<><path d="M11 2.5l2.5 2.5-7.6 7.6-3.2.7.7-3.2z" /><line x1="9.6" y1="3.9" x2="12.1" y2="6.4" /></>),
  plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
  camera: (<><path d="M2.5 5.5h2l1-1.5h3l1 1.5h2v6h-9z" /><circle cx="7" cy="8.2" r="1.9" /></>),
  cursor: <path d="M3 2l9 4.4-4 1.1-1.1 4z" />,
  hand: <path d="M5.5 8.5V5a1 1 0 0 1 2 0v2M7.5 7V4a1 1 0 0 1 2 0v3M9.5 7.5V5.5a1 1 0 0 1 2 0V10a3 3 0 0 1-3 3H8a3 3 0 0 1-2.8-1.9L4.2 9a1 1 0 0 1 1.5-1.1z" />,
  square: <rect x="3" y="3" width="10" height="10" rx="1.5" />,
  circle: <circle cx="8" cy="8" r="5.2" />,
  play: <polygon points="5 3.5 12.5 8 5 12.5" fill="currentColor" stroke="none" />,
  "zoom-in": (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /><line x1="5" y1="7" x2="9" y2="7" /><line x1="7" y1="5" x2="7" y2="9" /></>),
  "zoom-out": (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /><line x1="5" y1="7" x2="9" y2="7" /></>),
  fit: (<><polyline points="3 6 3 3 6 3" /><polyline points="10 3 13 3 13 6" /><polyline points="13 10 13 13 10 13" /><polyline points="6 13 3 13 3 10" /></>),
  sun: (<><circle cx="8" cy="8" r="2.6" /><line x1="8" y1="1.5" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="14.5" /><line x1="1.5" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="14.5" y2="8" /><line x1="3.4" y1="3.4" x2="4.4" y2="4.4" /><line x1="11.6" y1="11.6" x2="12.6" y2="12.6" /><line x1="12.6" y1="3.4" x2="11.6" y2="4.4" /><line x1="4.4" y1="11.6" x2="3.4" y2="12.6" /></>),
  "panel-left": (<><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><line x1="6.4" y1="3" x2="6.4" y2="13" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  send: (<><path d="M2.5 8h9M8 4.5 11.5 8 8 11.5" /></>),
  stop: <rect x="4" y="4" width="8" height="8" rx="1.2" />,
  terminal: (<><rect x="2" y="3" width="12" height="10" rx="1.4" /><polyline points="4.5 6.5 6.5 8 4.5 9.5" /><line x1="8" y1="9.8" x2="11" y2="9.8" /></>),
  clock: (<><circle cx="8" cy="8" r="5.6" /><polyline points="8 5 8 8 10 9.4" /></>),
};

function Icon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
function Kbd({ children }: { children: React.ReactNode }) { return <span className="kbd">{children}</span>; }

const AVATAR_HUES: Record<string, string> = { you: "var(--accent)", anna: "var(--presence-online)", agent: "var(--presence-agent)" };
function Avatar({ who, initials }: { who: string; initials: string }) {
  return <span className="st-avatar" style={{ background: AVATAR_HUES[who] || "var(--bg-4)" }}>{initials}</span>;
}
function PresenceCursor({ x, y, color, name, agent }: { x: number; y: number; color: string; name: string; agent?: boolean }) {
  return (
    <div className={"st-cursor" + (agent ? " is-agent" : "")} style={{ left: x, top: y }}>
      <svg width="18" height="18" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={color} stroke="var(--bg-0)" strokeWidth="0.8" /></svg>
      <span className="st-cursor-tag" style={{ background: color }}>{name}</span>
    </div>
  );
}
function MiniArtboard({ label, style, accent }: { label: string; style: React.CSSProperties; accent?: boolean }) {
  return (
    <div className="st-ab" style={style}>
      <span className="st-ab-label">{label}</span>
      <div className="st-ab-bar"><span className="st-ab-dot" /><span className="st-ab-dot" /><span className="st-ab-dot" /></div>
      <div className="st-ab-body">
        <div className="st-sk st-sk--line" style={{ width: "60%" }} />
        <div className="st-sk--row">
          <div className="st-sk" style={{ width: 40, height: 40, borderRadius: "var(--radius-pill)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, justifyContent: "center" }}>
            <div className="st-sk st-sk--line" style={{ width: "80%" }} />
            <div className="st-sk st-sk--line" style={{ width: "55%" }} />
          </div>
        </div>
        <div className="st-sk" style={{ width: "100%", height: 26, borderRadius: "var(--radius-sm)" }} />
        {accent ? <div className="st-sk st-sk--accent" style={{ width: "44%", height: 20, borderRadius: "var(--radius-sm)" }} /> : <div className="st-sk st-sk--line" style={{ width: "40%" }} />}
      </div>
    </div>
  );
}

/* ── Real app chrome (lifted st-* shapes) ──────────────────────────────────── */
const MENU_NAMES = ["File", "Edit", "View", "Selection", "Tools", "Help"];
function Menubar({ presence }: { presence?: React.ReactNode }) {
  return (
    <header className="st-menubar">
      <span className="st-brand">
        <span className="st-brand-mark"><svg viewBox="0 0 32 32" width="100%" height="100%" fill="none" aria-hidden="true"><path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" /></svg></span>
        <span className="st-brand-name">maude</span>
      </span>
      <nav className="st-menus" aria-label="Application menu">
        {MENU_NAMES.map((m) => <button key={m} type="button" className="st-menu">{m}</button>)}
      </nav>
      <div className="st-mb-right">
        {presence ? <div className="st-presence">{presence}</div> : null}
        <button type="button" className="st-whatsnew" data-unseen="true" aria-label="What's new"><Icon name="sparkle" size={15} /></button>
        <span className="st-stamp">CANVAS</span>
        <span className="st-mb-file">ui / <b>Login</b></span>
        <span className="st-mb-sep" />
        <span className="st-mb-count"><span className="st-dot" style={{ background: "var(--accent)" }} />4</span>
        <span className="st-mb-sep" />
        <span className="st-mb-count st-mono">68%</span>
        <span className="st-mb-sep" />
        <span className="st-mb-proj">maude</span>
      </div>
    </header>
  );
}

function TreeRow({ glyph = "file", name, sel, muted, badge, here }: { glyph?: string; name: string; sel?: boolean; muted?: boolean; badge?: string; here?: string }) {
  return (
    <div className={"st-row" + (sel ? " is-sel" : "") + (muted ? " is-muted" : "")} style={{ paddingLeft: 22 }}>
      <span className="st-row-glyph"><Icon name={glyph} size={13} /></span>
      <span className="st-row-name">{name}</span>
      {here ? <span className="st-presence" style={{ marginLeft: "auto" }}><Avatar who="anna" initials={here} /></span> : null}
      {badge ? <span className="st-row-badge">{badge}</span> : null}
    </div>
  );
}
function Sidebar() {
  return (
    <nav className="st-sidebar" aria-label="Files">
      <div className="st-sb-hd">
        <span className="st-sb-title">Files</span>
        <div className="st-sb-hd-actions">
          <span className="st-live"><span className="st-live-dot is-pulse" /> live</span>
          <button type="button" className="st-iconbtn" aria-label="Collapse sidebar"><Icon name="panel-left" size={15} /></button>
        </div>
      </div>
      <div className="st-search">
        <div className="st-search-box"><Icon name="search" size={13} /><input placeholder="Search canvases…" readOnly aria-label="Search canvases" /><Kbd>/</Kbd></div>
      </div>
      <div className="st-tree">
        <div className="st-tree-section">
          <div className="st-tree-sec-hd"><Icon name="chevron-down" size={13} /><span className="st-sec-name">Redesign · draft</span><span className="st-pill">4</span></div>
          <TreeRow name="Login" sel />
          <TreeRow name="Pricing" here="AN" />
          <TreeRow name="Settings" />
          <TreeRow name="Onboarding" />
        </div>
        <div className="st-tree-section">
          <div className="st-tree-sec-hd"><Icon name="chevron-down" size={13} /><span className="st-sec-name">Design system</span><span className="st-pill">2</span></div>
          <TreeRow glyph="folder" name="maude" muted />
        </div>
      </div>
    </nav>
  );
}

const TOOLS = [["cursor", "move"], ["hand", "hand"], ["comment", "comment"], ["sep", ""], ["pen", "pen"], ["square", "rect"], ["circle", "ellipse"], ["sep", ""], ["play", "present"]];
function FloatingToolbar() {
  return (
    <div className="st-toolbar" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t, i) => t[0] === "sep"
        ? <span className="st-tool-sep" key={"s" + i} />
        : <button key={t[1]} type="button" className={"st-tool" + (t[1] === "move" ? " is-active" : "")} aria-label={t[1]} aria-pressed={t[1] === "move"}><Icon name={t[0]} size={16} /></button>)}
    </div>
  );
}
function ZoomHud() {
  return (
    <div className="st-zoom" role="toolbar" aria-label="Zoom">
      <button type="button" aria-label="Zoom out"><Icon name="zoom-out" size={15} /></button>
      <span className="st-zoom-val">68%</span>
      <button type="button" aria-label="Zoom in"><Icon name="zoom-in" size={15} /></button>
      <button type="button" aria-label="Fit"><Icon name="fit" size={15} /></button>
    </div>
  );
}
function Minimap() {
  const abs = [{ l: 12, t: 18, w: 30, h: 26 }, { l: 50, t: 12, w: 38, h: 30 }, { l: 48, t: 52, w: 32, h: 22 }];
  return (
    <div className="st-minimap">
      <div className="st-mm-hd"><span>World</span><span className="st-mono">3 / 3</span></div>
      <div className="st-mm-world">
        {abs.map((a, i) => <div key={i} className={"st-mm-ab" + (i === 0 ? " is-active" : "")} style={{ left: a.l, top: a.t, width: a.w, height: a.h }} />)}
        <div className="st-mm-vp" style={{ left: 6, top: 8, width: 88, height: 56 }} />
      </div>
    </div>
  );
}
function StatusBar({ note = "Login · Redesign" }: { note?: string }) {
  return (
    <footer className="st-statusbar">
      <span className="st-sb-slot st-sb-active"><span className="lead" /><span className="lbl">active</span><span className="val">ui / Login</span></span>
      <span className="st-sb-slot st-sb-sel"><span className="lbl">editing</span><span className="val">{note}</span></span>
      <span className="st-sb-spacer" />
      <span className="st-sb-slot"><span className="st-dot" style={{ background: "var(--presence-online)" }} /><span className="lbl">live</span></span>
      <span className="st-sb-slot"><span className="lbl">hub sync</span><span className="val">0 ↑</span></span>
      <button type="button" className="st-sb-theme" aria-label="Switch to light theme"><Icon name="sun" size={13} />light</button>
    </footer>
  );
}

/* The canvas stage — the Login artboard the chat is editing, with the real
 * st-activity violet agent rim + agent cursor when Claude is editing. */
function Stage({ editing }: { editing?: boolean }) {
  return (
    <>
      <div className="st-world">
        <MiniArtboard label="login" style={{ left: 56, top: 96, width: 204, height: 168 }} accent />
        {editing ? (
          <>
            <div className="st-activity" style={{ left: 56, top: 96, width: 204, height: 168 }} />
            <span className="st-activity-badge" style={{ left: 64, top: 84 }}><Icon name="sparkle" size={11} /> Claude is editing</span>
          </>
        ) : (
          <div className="st-halo" style={{ left: 68, top: 214, width: 178, height: 28 }}>
            <span className="st-halo-tag">button.cta</span>
            <span className="st-halo-tick" style={{ left: -4, top: -4 }} />
            <span className="st-halo-tick" style={{ right: -4, top: -4 }} />
            <span className="st-halo-tick" style={{ left: -4, bottom: -4 }} />
            <span className="st-halo-tick" style={{ right: -4, bottom: -4 }} />
          </div>
        )}
        <MiniArtboard label="pricing" style={{ left: 300, top: 64, width: 232, height: 182 }} />
        <MiniArtboard label="settings" style={{ left: 286, top: 300, width: 206, height: 150 }} />
        <div className="st-pin" style={{ left: 256, top: 90 }}>1</div>
        {editing ? <PresenceCursor x={176} y={232} color="var(--presence-agent)" name="Claude" agent /> : null}
      </div>
      <FloatingToolbar />
      <ZoomHud />
      <Minimap />
    </>
  );
}

function AssistantTabs() {
  return (
    <div className="st-rp-tabs">
      <button type="button" className="st-rp-tab is-active"><Icon name="sparkle" size={14} /> Assistant</button>
      <button type="button" className="st-rp-tab"><Icon name="comment" size={14} /> Comments <span className="st-rp-tabct">3</span></button>
      <button type="button" className="st-rp-tab"><Icon name="sliders" size={14} /> Inspect</button>
    </div>
  );
}
function StatusRow({ status }: { status: "ready" | "working" | "off" }) {
  const dot = status === "ready" ? "chat-status-dot--ready" : status === "working" ? "chat-status-dot--working" : "";
  const label = status === "ready" ? "Ready" : status === "working" ? "Working…" : "Not connected";
  return (
    <div className="chat-statusrow" role="status">
      <span className={`chat-status-dot ${dot}`} aria-hidden="true" /> {label}
      <span className="chat-statusrow-sep">·</span> <span className="chat-statusrow-cc">Claude Code</span>
    </div>
  );
}

// The 4 persistent quick-action buttons (DDR-123 scope note).
function QuickActions({ disabled }: { disabled?: boolean }) {
  return (
    <div className="chat-quick">
      <button type="button" className="btn btn--sm chat-qa" disabled={disabled}><Icon name="pen" size={12} /> /design:edit</button>
      <button type="button" className="btn btn--sm chat-qa" disabled={disabled}><Icon name="plus" size={12} /> /design:new</button>
      <button type="button" className="btn btn--sm btn--ghost chat-qa" disabled={disabled}><Icon name="sliders" size={12} /> /design:critic</button>
      <button type="button" className="btn btn--sm btn--ghost chat-qa" disabled={disabled} aria-label="/design:screenshot"><Icon name="camera" size={12} /></button>
    </div>
  );
}
function Composer({ placeholder, label, disabled }: { placeholder: string; label: string; disabled?: boolean }) {
  return (
    <div className={"chat-composer" + (disabled ? " chat-composer--off" : "")}>
      {!disabled ? <div className="chat-ctx"><Icon name="file" size={12} /> Editing <b>Login</b> · Redesign</div> : null}
      <div className="chat-input-wrap">
        <textarea className="textarea" rows={2} aria-label={label} placeholder={placeholder} disabled={disabled} defaultValue="" />
        <button type="button" className="btn btn--primary chat-send" aria-label="Send" disabled={disabled}><Icon name="send" size={13} /></button>
      </div>
      {disabled
        ? <div className="chat-foot"><Icon name="clock" size={12} /> waiting for Claude Code…</div>
        : <div className="chat-foot"><Kbd>⌘↵</Kbd> to send<span className="chat-foot-spacer" /><span>your Claude subscription</span></div>}
    </div>
  );
}

/* The whole app frame; `children` is the chat-panel body (feed/quick/composer). */
function AppFrame({ editing, status, presence, statusNote, children }:
  { editing?: boolean; status: "ready" | "working" | "off"; presence?: React.ReactNode; statusNote?: string; children: React.ReactNode }) {
  return (
    <div className="maude" data-theme="dark" style={{ position: "absolute", inset: 0 }}>
      <div className="st-shell">
        <Menubar presence={presence} />
        <div className="st-body">
          <Sidebar />
          <div className="st-stage" style={{ position: "relative" }}><Stage editing={editing} /></div>
          <aside className="st-rpanel" aria-label="Assistant">
            <AssistantTabs />
            <div className="chat-panel">
              <StatusRow status={status} />
              {children}
            </div>
          </aside>
        </div>
        <StatusBar note={statusNote} />
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const presenceIdle = <><Avatar who="you" initials="MD" /><Avatar who="anna" initials="AN" /></>;
  const presenceAgent = <><Avatar who="you" initials="MD" /><Avatar who="agent" initials="C" /></>;

  return (
    <DesignCanvas>
      <DCSection id="chatpanel" title="ChatPanel · maude" subtitle="Native ACP chat sidepanel, docked in the real Maude app shell — runs on your own Claude CLI subscription · 4 artboards (phase-31 · DDR-123)">

        {/* A — idle / ready */}
        <DCArtboard id="idle-ready" label="A · idle — ready to edit" width={1240} height={780}>
          <AppFrame status="ready" presence={presenceIdle} statusNote="Login · Redesign">
            <div className="chat-feed" aria-live="polite">
              <div className="chat-empty">
                <span className="chat-empty-mark"><Icon name="sparkle" size={28} /></span>
                <div className="chat-empty-title">Edit this canvas with Claude</div>
                <p className="chat-empty-sub">Describe a change in plain words, or run a slash command. The canvas updates live while you watch.</p>
                <div className="chat-sugs">
                  <button type="button" className="chat-sug">Make the primary button bigger and add a hover state</button>
                  <button type="button" className="chat-sug">Review this screen for issues</button>
                  <button type="button" className="chat-sug">Add a Settings screen to this draft</button>
                </div>
              </div>
            </div>
            <QuickActions />
            <Composer placeholder="Ask Claude to change this canvas…" label="Ask Claude to change this canvas" />
          </AppFrame>
        </DCArtboard>

        {/* B — streaming a /design:edit */}
        <DCArtboard id="streaming-edit" label="B · streaming /design:edit + stop" width={1240} height={780}>
          <AppFrame status="working" editing presence={presenceAgent} statusNote="Claude editing Login">
            <div className="chat-feed" aria-live="polite">
              <div className="chat-msg chat-msg--user">
                <span className="chat-msg-role">you</span>
                <div className="chat-bubble"><code>/design:edit</code> make the primary button bigger and give it a hover state</div>
              </div>
              <div className="chat-msg chat-msg--assistant">
                <span className="chat-msg-role"><span className="chat-msg-spark"><Icon name="sparkle" size={12} /></span> claude</span>
                <div className="chat-tool">
                  <div className="chat-tool-hd"><Icon name="pen" size={12} /> <b>Edit</b> Login.tsx <span className="chat-tool-dot chat-tool-dot--run" aria-label="running" /></div>
                  <div className="chat-tool-body">
                    <div className="chat-tool-line"><span className="del">- </span>className="btn btn--primary"</div>
                    <div className="chat-tool-line"><span className="add">+ </span>className="btn btn--primary btn--lg"</div>
                  </div>
                </div>
                <div className="chat-bubble">Bumping the CTA to <code>--type-md</code> and adding a hover lift<span className="chat-caret" aria-hidden="true" /></div>
              </div>
            </div>
            <QuickActions disabled />
            <div className="chat-stopbar">
              <button type="button" className="btn btn--danger"><Icon name="stop" size={12} /> Stop</button>
              <span className="chat-stop-meta"><span className="chat-status-dot chat-status-dot--working" aria-hidden="true" />editing Login · <Kbd>esc</Kbd></span>
            </div>
          </AppFrame>
        </DCArtboard>

        {/* C — the edit lands on the canvas (signature moment) */}
        <DCArtboard id="agent-editing" label="C · the edit lands on the canvas" width={1240} height={780}>
          <AppFrame status="ready" editing presence={presenceAgent} statusNote="Claude editing Login">
            <div className="chat-feed" aria-live="polite">
              <div className="chat-msg chat-msg--user">
                <span className="chat-msg-role">you</span>
                <div className="chat-bubble"><code>/design:edit</code> make the primary button bigger and give it a hover state</div>
              </div>
              <div className="chat-msg chat-msg--assistant">
                <span className="chat-msg-role"><span className="chat-msg-spark"><Icon name="sparkle" size={12} /></span> claude</span>
                <div className="chat-tool">
                  <div className="chat-tool-hd"><Icon name="check" size={12} /> <b>Edited</b> Login.tsx <span className="chat-tool-dot chat-tool-dot--done" aria-label="done" /></div>
                  <div className="chat-tool-body"><div className="chat-tool-line"><span className="add">+ </span>btn--lg · hover lift +2px</div></div>
                </div>
                <div className="chat-bubble">Done — the CTA is larger with a soft hover. Anna, in this draft, saw it change live.</div>
              </div>
            </div>
            <QuickActions />
            <Composer placeholder="Ask for the next change…" label="Ask Claude for the next change" />
          </AppFrame>
        </DCArtboard>

        {/* D — not connected (the rest of the app stays live) */}
        <DCArtboard id="not-connected" label="D · not connected — how to connect" width={1240} height={780}>
          <AppFrame status="off" presence={presenceIdle} statusNote="Login · Redesign">
            <div className="chat-feed" aria-live="polite">
              <div className="chat-disabled">
                <span className="chat-disabled-mark"><Icon name="sparkle" size={26} /></span>
                <div className="chat-disabled-title">Claude Code isn’t connected</div>
                <p className="chat-disabled-sub">Open a terminal and run <code>claude</code> to sign in. Maude connects to it automatically — there’s no separate login here.</p>
                <div className="chat-trust">
                  <div className="chat-trust-row"><Icon name="check" size={13} /> Runs on your Claude Pro / Max subscription</div>
                  <div className="chat-trust-row"><Icon name="check" size={13} /> No login inside Maude — uses your own Claude Code</div>
                  <div className="chat-trust-row"><Icon name="check" size={13} /> Never metered API billing</div>
                </div>
                <button type="button" className="btn btn--ghost"><Icon name="terminal" size={13} /> Open a terminal</button>
              </div>
            </div>
            <QuickActions disabled />
            <Composer placeholder="Connect Claude Code to start…" label="Message Claude — connect Claude Code first" disabled />
          </AppFrame>
        </DCArtboard>

      </DCSection>
    </DesignCanvas>
  );
}
