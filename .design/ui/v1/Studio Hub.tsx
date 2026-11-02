/**
 * @canvas      Studio Hub — operator console for self-hosted Maude sync, reimagined under the maude DS · 7 artboards: landing · onboarding wizard · dashboard · peers & presence · tokens · invite-issued modal · states & settings
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   landing | onboarding | dashboard | peers | tokens | invite-modal | states
 * @brief       Redesign of the maude hub (apps/hub) — the self-hosted Yjs sync server + admin console — renamed Studio Hub and dressed in the maude "Unified Pro Studio" DS. Source of truth for functionality: apps/hub/src/{server,admin-auth,bootstrap}.mjs + src/admin/. Content prior: Sync Hub Admin (project DS). Chrome prior: Studio (maude app-shell). Expanded beyond today's vanilla-JS admin with a public landing page, a first-run onboarding wizard, a spatial presence map, a canvases browser, and a settings surface.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling Studio Hub.css)
 * @history     .design/_history/studio-hub/
 *
 * Authored under the `maude` DS (dark-first). Tokens + shared component classes
 * are imported in-file so the canvas is self-contained (per the Studio precedent
 * + DDR-093 note: a UI canvas can't rely on the host injecting the right DS). The
 * `.maude[data-theme="dark"]` wrapper on each artboard scopes the token ladder;
 * heavy chrome lives in the sibling Studio Hub.css (every value a var(--*) token).
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Studio Hub.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const VER = "v0.18.0";
const HUB = "studio-hub.fly.dev";
const TOKEN = "mau_a3f9c8b2d1e4f6079b5c8e2a1d4f7c0b";

/* ───────────────────────────── Icon set ─────────────────────────────────────
 * Thin-stroke (1.4) geometric glyphs — terminal/IDE heritage, no emoji (DS rule).
 * ──────────────────────────────────────────────────────────────────────────── */
const ICONS: Record<string, JSX.Element> = {
  overview: (<><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>),
  peers: (<><circle cx="6" cy="6" r="2.3" /><path d="M2.5 13c0-2 1.6-3.2 3.5-3.2S9.5 11 9.5 13" /><path d="M10.2 4.2a2.3 2.3 0 0 1 0 3.6M11 13c0-1.6-.9-2.7-2-3.1" /></>),
  key: (<><circle cx="5" cy="5" r="2.5" /><path d="M6.8 6.8l5 5M10.3 10.3l1.3-1.3M11.8 11.8l1.2-1.2" /></>),
  tokens: (<><path d="M2.5 6V4.5h11V6a1.3 1.3 0 0 0 0 4v1.5h-11V10a1.3 1.3 0 0 0 0-4z" /><line x1="9" y1="5" x2="9" y2="11" strokeDasharray="1.3 1.2" /></>),
  canvases: (<><polygon points="8 2.4 13.6 5.6 8 8.8 2.4 5.6" /><polyline points="2.4 9 8 12.2 13.6 9" /></>),
  activity: <polyline points="2 8.5 5 8.5 6.5 4 9.5 12 11 8.5 14 8.5" />,
  settings: (<><circle cx="8" cy="8" r="2" /><path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5" /></>),
  search: (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /></>),
  plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
  copy: (<><rect x="5.5" y="5.5" width="8" height="8" rx="1.4" /><path d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  x: (<><line x1="4.3" y1="4.3" x2="11.7" y2="11.7" /><line x1="11.7" y1="4.3" x2="4.3" y2="11.7" /></>),
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  "arrow-right": (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  rotate: (<><path d="M12.5 6.5A5 5 0 1 0 13 9" /><polyline points="12.8 2.8 12.8 6.5 9.1 6.5" /></>),
  shield: (<><path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><polyline points="5.8 8 7.4 9.6 10.4 6" /></>),
  bolt: <polygon points="9 2 4 9 7.5 9 7 14 12 7 8.5 7" />,
  link: (<><path d="M6.5 9.5 9.5 6.5" /><path d="M7 4.5 8.5 3a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2" /><path d="M9 11.5 7.5 13a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" /></>),
  server: (<><rect x="2.5" y="3" width="11" height="4" rx="1" /><rect x="2.5" y="9" width="11" height="4" rx="1" /><line x1="4.5" y1="5" x2="4.6" y2="5" /><line x1="4.5" y1="11" x2="4.6" y2="11" /></>),
  database: (<><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" /><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>),
  cloud: <path d="M5 12h6a2.5 2.5 0 0 0 .2-5A3.5 3.5 0 0 0 4.5 7.4 2.3 2.3 0 0 0 5 12z" />,
  terminal: (<><rect x="2" y="3" width="12" height="10" rx="1.4" /><polyline points="4.5 6.5 6.5 8 4.5 9.5" /><line x1="8" y1="10" x2="11" y2="10" /></>),
  branch: (<><circle cx="4.5" cy="4" r="1.6" /><circle cx="4.5" cy="12" r="1.6" /><circle cx="11" cy="4.5" r="1.6" /><path d="M4.5 5.6v4.8M11 6.1c0 2.4-1.6 3.4-4 3.9" /></>),
  globe: (<><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.5 2.6 3.5 2.6 5.5S9.7 12.5 8 13.5C6.3 12 5.4 10 5.4 8S6.3 4 8 2.5z" /></>),
  agentCursor: <path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="currentColor" stroke="currentColor" />,
  eye: (<><path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4S1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.6" /></>),
  forget: (<><path d="M6 2.5h4a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H6" /><polyline points="3 8 8 8" /><polyline points="5.5 5.5 3 8 5.5 10.5" /></>),
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

// The maude brand mark — the filled 4-point spark from the app favicon. Fills
// its tile (the `.sh-mark` box draws the indigo bubble + halo); same 32-grid
// star path as the canonical logo specimen so the mark is identical everywhere.
function Sparkle() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" fill="currentColor" aria-hidden="true">
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" />
    </svg>
  );
}

/* ── Shared primitives ──────────────────────────────────────────────────────── */

function AbHd({ sku, label, sub }: { sku: string; label: string; sub?: string }) {
  return (
    <div className="sh-abhd" role="presentation">
      <span><b>{sku}</b> · {label}</span>
      <span className="sh-abhd-right">
        {sub ? <span>{sub}</span> : null}
        <span className="sh-abhd-theme"><span className="sh-dotglyph" aria-hidden="true" /> dark</span>
        <span>{VER}</span>
      </span>
    </div>
  );
}

function Avatar({ name, color, size }: { name: string; color: string; size?: number }) {
  const st: React.CSSProperties = { background: color };
  if (size) { st.width = size; st.height = size; }
  return <span className="sh-avatar" style={st} aria-hidden="true">{name[0].toUpperCase()}</span>;
}

// The shared sidebar nav — used by every authed app-shell artboard.
function NavSidebar({ active }: { active: string }) {
  const items: [string, string, string | null][] = [
    ["overview", "Overview", null],
    ["peers", "Peers", "2"],
    ["tokens", "Tokens", "4"],
    ["canvases", "Canvases", "7"],
    ["activity", "Activity", null],
    ["settings", "Settings", null],
  ];
  return (
    <nav className="sh-nav" aria-label="Hub navigation">
      <div className="sh-nav-brand">
        <span className="sh-mark" aria-hidden="true"><Sparkle /></span>
        <span className="sh-nav-brand-tx">
          <span className="sh-nav-brand-name">Studio Hub</span>
          <span className="sh-nav-brand-url">{HUB}</span>
        </span>
      </div>
      <div className="sh-nav-sect">Operate</div>
      <div className="sh-nav-list">
        {items.map(([id, label, count]) => (
          <button key={id} type="button" className="sh-nav-item" aria-current={active === id ? "page" : undefined}>
            <span className="sh-nav-ic"><Icon name={id} /></span>
            <span className="sh-nav-label">{label}</span>
            {count ? <span className="sh-nav-count">{count}</span> : null}
          </button>
        ))}
      </div>
      <div className="sh-nav-foot">
        <div className="sh-auth">
          <span className="sh-auth-row"><span className="presence-dot presence-dot--online" aria-hidden="true" /> authenticated</span>
          <button type="button" className="btn btn--ghost btn--sm"><Icon name="forget" size={13} /> forget on this device</button>
        </div>
      </div>
    </nav>
  );
}

function TopBar({ title, action = true }: { title: string; action?: boolean }) {
  return (
    <div className="sh-topbar">
      <div className="sh-crumbs">
        <span className="sh-crumb-root">{HUB}</span>
        <span className="sh-crumb-sep" aria-hidden="true"><Icon name="chevron-right" size={13} /></span>
        <h1>{title}</h1>
      </div>
      <div className="sh-topbar-spacer" />
      <span className="sh-live"><span className="presence-dot presence-dot--online" aria-hidden="true" /> live</span>
      <label className="sh-search">
        <Icon name="search" size={15} />
        <input type="text" placeholder="Search peers, tokens…" aria-label="Search" />
        <span className="kbd" aria-hidden="true">/</span>
      </label>
      {action ? <button type="button" className="btn btn--primary"><Icon name="plus" size={14} /> Generate invite</button> : null}
    </div>
  );
}

/* Connected-peers table body (shared between overview + peers). */
function PeerRows() {
  return (
    <>
      <tr>
        <td className="sh-td-doc">canvas-viewport</td>
        <td><span className="sh-user"><Avatar name="alice" color="var(--status-info)" /> alice</span></td>
        <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
        <td className="sh-td-num">28 ms</td>
        <td className="sh-td-num">4m ago</td>
      </tr>
      <tr>
        <td className="sh-td-doc">docs-site</td>
        <td><span className="sh-user"><Avatar name="bob" color="var(--status-warn)" /> bob</span></td>
        <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
        <td className="sh-td-num">41 ms</td>
        <td className="sh-td-num">12m ago</td>
      </tr>
    </>
  );
}

function ActivityFeed() {
  const rows: [string, JSX.Element, string][] = [
    ["join", (<><b>alice</b> joined <code>canvas-viewport</code></>), "2m"],
    ["agent", (<><b>agent</b> is editing <code>studio</code> — 3 frames touched</>), "3m"],
    ["token", (<>invite issued for <b>carol</b> · scope <code>hub-wide</code></>), "6m"],
    ["join", (<><b>bob</b> joined <code>docs-site</code></>), "12m"],
    ["warn", (<><b>ci-bot</b> token rotated — 0 sessions kicked</>), "1h"],
  ];
  return (
    <div className="sh-feed">
      {rows.map((r, i) => (
        <div className="sh-feed-row" key={i}>
          <span className="sh-feed-rail"><span className={`sh-feed-dot is-${r[0]}`} aria-hidden="true" /></span>
          <span className="sh-feed-body">{r[1]}</span>
          <span className="sh-feed-time">{r[2]}</span>
        </div>
      ))}
    </div>
  );
}

function StatusKV() {
  return (
    <dl className="sh-kv">
      <dt>uptime</dt><dd>6d 14h 22m</dd>
      <dt>version</dt><dd>{VER}</dd>
      <dt>port</dt><dd>1234</dd>
      <dt>data dir</dt><dd>/data <span className="sh-unit">· 4.2 MB</span></dd>
      <dt>auth</dt><dd>env-secret</dd>
      <dt>transport</dt><dd>TLS · Caddy</dd>
      <dt>peers</dt><dd>2</dd>
    </dl>
  );
}

/* The dashboard body — reused dimmed behind the invite modal (artboard F). */
function DashboardBody() {
  return (
    <div className="sh-content sh-dotted">
      <div className="sh-stats">
        <div className="sh-stat">
          <div className="sh-stat-top"><span className="sh-stat-lbl">Connected peers</span><span className="sh-stat-ic"><Icon name="peers" /></span></div>
          <span className="sh-stat-num">2</span>
          <span className="sh-stat-delta is-up"><Icon name="bolt" size={12} /> 2 active now</span>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-top"><span className="sh-stat-lbl">Active tokens</span><span className="sh-stat-ic"><Icon name="key" /></span></div>
          <span className="sh-stat-num">4 <small>· 1 scoped</small></span>
          <span className="sh-stat-delta"><Icon name="shield" size={12} /> rotate = kill switch</span>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-top"><span className="sh-stat-lbl">Synced canvases</span><span className="sh-stat-ic"><Icon name="canvases" /></span></div>
          <span className="sh-stat-num">7</span>
          <span className="sh-spark" aria-hidden="true"><i style={{ height: 6 }} /><i style={{ height: 10 }} /><i style={{ height: 8 }} /><i style={{ height: 14 }} /><i style={{ height: 11 }} /><i style={{ height: 18 }} /></span>
        </div>
        <div className="sh-stat">
          <div className="sh-stat-top"><span className="sh-stat-lbl">Uptime</span><span className="sh-stat-ic"><Icon name="server" /></span></div>
          <span className="sh-stat-num">6d</span>
          <span className="sh-stat-delta"><span className="presence-dot presence-dot--online" aria-hidden="true" /> /health 200 · 41 ms</span>
        </div>
      </div>

      <div className="sh-grid">
        <div className="sh-grid-col">
          <section className="panel">
            <div className="panel-hd">Connected peers <span className="sh-live"><span className="presence-dot presence-dot--online" aria-hidden="true" /> live · 5s</span></div>
            <table className="sh-tbl">
              <caption>Connected peers</caption>
              <thead><tr><th>Canvas</th><th>User</th><th>Scope</th><th>Latency</th><th>Connected</th></tr></thead>
              <tbody><PeerRows /></tbody>
            </table>
            <div className="sh-panel-foot"><span className="sh-sku">HUB · /admin/api/peers</span><a>Open peers <Icon name="arrow-right" size={13} /></a></div>
          </section>

          <section className="panel">
            <div className="panel-hd">Activity</div>
            <ActivityFeed />
          </section>
        </div>

        <div className="sh-grid-col">
          <section className="panel">
            <div className="panel-hd">Hub status</div>
            <div className="panel-bd"><StatusKV /></div>
          </section>

          <section className="panel">
            <div className="panel-hd">Quick actions</div>
            <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <button type="button" className="btn btn--primary" style={{ justifyContent: "flex-start" }}><Icon name="plus" size={14} /> Generate invite token</button>
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }}><Icon name="link" size={14} /> Copy hub link</button>
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }}><Icon name="rotate" size={14} /> Rotate a token</button>
              <p className="sh-field-help">One-time tokens, shown once. Rotation is the only revoke — it kicks live sessions within 5s.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function StudioHub() {
  const copied = true; // static mock — the invite dialog shows the post-copy state

  return (
    <DesignCanvas>
      <DCSection id="hub" title="Studio Hub · maude" subtitle="Operator console for self-hosted Maude sync · 7 artboards">

        {/* ── A · LANDING ──────────────────────────────────────────────────── */}
        <DCArtboard id="landing" label="A · landing · what Studio Hub is" width={1360} height={940}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/A" label="landing · public splash" sub="self-hosted" />
            <div className="sh-landing">
              <header className="sh-topnav">
                <span className="sh-topnav-brand"><span className="sh-mark" aria-hidden="true"><Sparkle /></span> Studio Hub</span>
                <nav className="sh-topnav-links" aria-label="Marketing">
                  <a aria-current="page">Overview</a>
                  <a>Deploy</a>
                  <a>Docs</a>
                  <a>Pricing</a>
                </nav>
                <div className="sh-topnav-right">
                  <button type="button" className="btn btn--ghost btn--sm"><Icon name="branch" size={14} /> GitHub</button>
                  <button type="button" className="btn btn--primary btn--sm">Deploy your hub <Icon name="arrow-right" size={13} /></button>
                </div>
              </header>

              <div className="sh-hero">
                <div className="sh-hero-copy">
                  <span className="sh-eyebrow">self-hosted · yjs crdt · zero telemetry</span>
                  <h1 className="sh-display">Real-time sync for your <span className="sh-em">design canvases</span> — on your own box.</h1>
                  <p className="sh-lede">Studio Hub is the sync server behind Maude's infinite canvas. Run it on Docker, Fly, or a Raspberry Pi and your team — plus the AI agent — edit the same canvases live. No SaaS, no seat pricing, no data leaving your infra.</p>
                  <div className="sh-cta-row">
                    <button type="button" className="btn btn--primary"><Icon name="bolt" size={14} /> Deploy in 2 minutes</button>
                    <button type="button" className="btn"><Icon name="branch" size={14} /> View on GitHub</button>
                  </div>
                  <span className="sh-codechip"><span className="sh-prompt">$</span> maude hub deploy fly <Icon name="copy" size={13} /></span>
                  <div className="sh-meta-strip">
                    <span className="sh-meta-it"><Icon name="lock" size={12} /> token auth</span>
                    <span className="sh-meta-sep" aria-hidden="true" />
                    <span className="sh-meta-it"><Icon name="shield" size={12} /> rotate kill-switch</span>
                    <span className="sh-meta-sep" aria-hidden="true" />
                    <span className="sh-meta-it"><Icon name="server" size={12} /> ~$0.45/mo on fly</span>
                  </div>
                </div>

                {/* console preview inset — proves it's a real instrument */}
                <div className="sh-preview" aria-hidden="true">
                  <div className="sh-preview-bar">
                    <span className="sh-preview-dots"><i /><i /><i /></span>
                    <span className="sh-preview-url">{HUB}/admin</span>
                    <span className="sh-live" style={{ marginLeft: "auto" }}><span className="presence-dot presence-dot--online" /> live</span>
                  </div>
                  <div className="sh-preview-body sh-dotted">
                    <div className="sh-preview-mini">
                      <div className="sh-mini-stat"><b>2</b><span>peers</span></div>
                      <div className="sh-mini-stat"><b>4</b><span>tokens</span></div>
                      <div className="sh-mini-stat"><b>7</b><span>canvases</span></div>
                    </div>
                    <div className="panel" style={{ background: "var(--bg-1)" }}>
                      <div className="panel-hd">Connected peers</div>
                      <table className="sh-tbl">
                        <tbody>
                          <tr><td className="sh-td-doc">canvas-viewport</td><td><span className="sh-user"><Avatar name="alice" color="var(--status-info)" size={16} /> alice</span></td><td className="sh-td-num">4m</td></tr>
                          <tr><td className="sh-td-doc">docs-site</td><td><span className="sh-user"><Avatar name="bob" color="var(--status-warn)" size={16} /> bob</span></td><td className="sh-td-num">12m</td></tr>
                          <tr><td className="sh-td-doc">studio</td><td><span className="sh-user"><Avatar name="A" color="var(--presence-agent)" size={16} /> agent</span></td><td className="sh-td-num">now</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sh-props">
                <article className="sh-prop">
                  <span className="sh-prop-ic"><Icon name="key" /></span>
                  <h3>One-time invite tokens</h3>
                  <p>Mint a labelled token, paste the ready-made <code>maude design link</code> command into a teammate's terminal. Shown once, hashed at rest.</p>
                </article>
                <article className="sh-prop">
                  <span className="sh-prop-ic"><Icon name="shield" /></span>
                  <h3>Rotation is the kill switch</h3>
                  <p>No passwords to leak. Rotate a token and every live session using it is kicked within 5 seconds — the only revoke you need.</p>
                </article>
                <article className="sh-prop">
                  <span className="sh-prop-ic"><Icon name="peers" /></span>
                  <h3>Presence — humans + agent</h3>
                  <p>See who's on which canvas in real time, including the AI agent's own cursor. CRDT convergence means no merge conflicts, ever.</p>
                </article>
              </div>

              <div className="sh-deploy">
                <span className="sh-deploy-lbl">Deploy anywhere</span>
                <span className="sh-target"><span className="sh-target-ic"><Icon name="server" size={13} /></span> Docker Compose</span>
                <span className="sh-target"><span className="sh-target-ic"><Icon name="cloud" size={13} /></span> Fly.io</span>
                <span className="sh-target"><span className="sh-target-ic"><Icon name="globe" size={13} /></span> Tailscale Funnel</span>
                <span className="sh-target"><span className="sh-target-ic"><Icon name="lock" size={13} /></span> VPS + Caddy</span>
              </div>

              <footer className="sh-landing-foot">
                <span>Studio Hub {VER}</span>
                <span>·</span>
                <span>MIT licensed</span>
                <span>·</span>
                <span>Yjs + Hocuspocus</span>
                <span className="sh-foot-sep" />
                <span>ghcr.io/1agh/maude-hub</span>
              </footer>
            </div>
          </div>
        </DCArtboard>

        {/* ── B · ONBOARDING WIZARD ────────────────────────────────────────── */}
        <DCArtboard id="onboarding" label="B · first-run onboarding wizard" width={1160} height={880}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/B" label="first-run · claim & set up" sub="single-use link" />
            <div className="sh-wizard">
              <aside className="sh-steps">
                <div className="sh-steps-brand">
                  <span className="sh-mark sh-mark--lg" aria-hidden="true"><Sparkle /></span>
                  <span className="sh-steps-brand-tx">
                    <span className="sh-steps-brand-name">Studio Hub</span>
                    <span className="sh-steps-brand-sub">self-hosted sync</span>
                  </span>
                </div>
                {([
                  ["Claim the hub", "verify fingerprint", "active"],
                  ["Hub identity", "name · public URL", ""],
                  ["Transport", "TLS provider", ""],
                  ["First invite", "add a teammate", ""],
                  ["You're live", "open the console", ""],
                ] as [string, string, string][]).map((s, i, arr) => (
                  <div key={s[0]} className={`sh-step ${s[2] === "active" ? "is-active" : ""}`}>
                    <span className="sh-step-num">{i + 1}</span>
                    <span className="sh-step-tx"><b>{s[0]}</b><span>{s[1]}</span></span>
                    {i < arr.length - 1 ? <span className="sh-step-bar" aria-hidden="true" /> : null}
                  </div>
                ))}
              </aside>

              <div className="sh-wizard-main">
                <div className="sh-wizard-head">
                  <span className="sh-eyebrow">one-time bootstrap link · expires 24h</span>
                  <h1>Claim this hub</h1>
                  <p>This hub has no admin yet. Confirm to claim it — the link is consumed and can't be reused. <b>Verify the fingerprint matches your server logs</b> before you trust it.</p>
                </div>

                <div className="sh-fp">
                  <div className="sh-fp-row"><span className="sh-fp-k">Claiming</span><span className="sh-fp-v">https://{HUB}</span></div>
                  <div className="sh-fp-row"><span className="sh-fp-k">Fingerprint</span><span className="sh-fp-v"><span className="sh-grp">a3f9</span> c8b2 <span className="sh-grp">d1e4</span> f607</span></div>
                  <div className="sh-fp-row"><span className="sh-fp-k">Version</span><span className="sh-fp-v">{VER}</span></div>
                </div>

                <div className="sh-wizard-actions">
                  <button type="button" className="btn btn--primary"><Icon name="shield" size={14} /> Claim hub</button>
                  <span className="badge tag" style={{ color: "var(--status-warn)", borderColor: "color-mix(in oklab, var(--status-warn) 50%, transparent)" }}>expires 24h</span>
                  <span className="sh-grow" />
                  <span className="sh-sku">step 1 / 5</span>
                </div>
                <p className="sh-wizard-hint">Single-use. After you claim, <code>/admin</code> requires <code>HUB_SECRET</code> — there is no second bootstrap link. The key is stripped from this URL immediately so it never lands in history.</p>

                <div className="sh-peek">
                  <Icon name="arrow-right" size={15} />
                  <span>Next: <b>name your hub</b> &amp; set its public URL, then pick a TLS provider.</span>
                </div>
              </div>
            </div>
          </div>
        </DCArtboard>

        {/* ── C · DASHBOARD / OVERVIEW (hero) ──────────────────────────────── */}
        <DCArtboard id="dashboard" label="C · dashboard · operator console" width={1480} height={940}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/C" label="dashboard · overview" sub="authenticated" />
            <div className="sh-app">
              <NavSidebar active="overview" />
              <div className="sh-main">
                <TopBar title="Overview" />
                <DashboardBody />
              </div>
            </div>
          </div>
        </DCArtboard>

        {/* ── D · PEERS & PRESENCE ─────────────────────────────────────────── */}
        <DCArtboard id="peers" label="D · peers & presence · who's on what" width={1480} height={940}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/D" label="peers · live presence map" sub="2 peers · 1 agent" />
            <div className="sh-app">
              <NavSidebar active="peers" />
              <div className="sh-main">
                <TopBar title="Peers" />
                <div className="sh-content">
                  {/* signature moment: spatial presence map on the dotted canvas */}
                  <section className="panel" style={{ marginBottom: "var(--space-4)" }}>
                    <div className="panel-hd">Presence map <span className="sh-sku">who is on which canvas, right now</span></div>
                    <div className="sh-map sh-dotted">
                      <span className="sh-map-cap">live · {HUB}</span>

                      <div className="sh-map-node" data-active="true" style={{ left: 40, top: 56 }}>
                        <div className="sh-map-node-hd"><Icon name="canvases" size={13} /> canvas-viewport</div>
                        <div className="sh-map-node-bd">
                          <div className="sh-map-thumb"><Icon name="eye" size={18} /></div>
                          <div className="sh-map-peers"><span className="sh-map-occupants"><Avatar name="alice" color="var(--status-info)" /></span><span className="sh-num" style={{ fontSize: "var(--type-xs)", color: "var(--fg-2)" }}>alice · 28ms</span></div>
                        </div>
                      </div>

                      <div className="sh-map-node" style={{ left: 320, top: 140 }}>
                        <div className="sh-map-node-hd"><Icon name="canvases" size={13} /> docs-site</div>
                        <div className="sh-map-node-bd">
                          <div className="sh-map-thumb"><Icon name="eye" size={18} /></div>
                          <div className="sh-map-peers"><span className="sh-map-occupants"><Avatar name="bob" color="var(--status-warn)" /></span><span className="sh-num" style={{ fontSize: "var(--type-xs)", color: "var(--fg-2)" }}>bob · 41ms</span></div>
                        </div>
                      </div>

                      <div className="sh-map-node" data-active="true" style={{ left: 600, top: 40 }}>
                        <div className="sh-map-node-hd"><Icon name="canvases" size={13} /> studio</div>
                        <div className="sh-map-node-bd">
                          <div className="sh-map-thumb"><Icon name="eye" size={18} /></div>
                          <div className="sh-map-peers"><span className="sh-map-occupants"><Avatar name="A" color="var(--presence-agent)" /></span><span className="sh-num" style={{ fontSize: "var(--type-xs)", color: "var(--presence-agent)" }}>agent · editing</span></div>
                        </div>
                      </div>

                      {/* the AI agent cursor — the signature beat */}
                      <div className="sh-cursor" style={{ left: 690, top: 150 }}>
                        <span className="sh-cursor-arrow"><Icon name="agentCursor" size={18} /></span>
                        <span className="sh-cursor-tag">agent</span>
                      </div>
                      {/* a human peer cursor */}
                      <div className="sh-cursor sh-peer-cursor" style={{ left: 150, top: 188 }}>
                        <span className="sh-cursor-arrow"><Icon name="agentCursor" size={16} /></span>
                        <span className="sh-cursor-tag">alice</span>
                      </div>
                    </div>
                  </section>

                  <div className="sh-grid">
                    <section className="panel">
                      <div className="panel-hd">Connected peers <span className="sh-live"><span className="presence-dot presence-dot--online" aria-hidden="true" /> live · 5s</span></div>
                      <table className="sh-tbl">
                        <caption>Connected peers</caption>
                        <thead><tr><th>Canvas</th><th>User</th><th>Scope</th><th>Latency</th><th>Connected</th><th className="sh-td-act"><span className="sh-sr">Actions</span></th></tr></thead>
                        <tbody>
                          <tr>
                            <td className="sh-td-doc">canvas-viewport</td>
                            <td><span className="sh-user"><Avatar name="alice" color="var(--status-info)" /> alice</span></td>
                            <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                            <td className="sh-td-num">28 ms</td>
                            <td className="sh-td-num">4m ago</td>
                            <td className="sh-td-act"><button type="button" className="btn btn--danger btn--sm"><Icon name="x" size={12} /> Kick</button></td>
                          </tr>
                          <tr>
                            <td className="sh-td-doc">docs-site</td>
                            <td><span className="sh-user"><Avatar name="bob" color="var(--status-warn)" /> bob</span></td>
                            <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                            <td className="sh-td-num">41 ms</td>
                            <td className="sh-td-num">12m ago</td>
                            <td className="sh-td-act"><button type="button" className="btn btn--danger btn--sm"><Icon name="x" size={12} /> Kick</button></td>
                          </tr>
                          <tr>
                            <td className="sh-td-doc">studio</td>
                            <td><span className="sh-user"><Avatar name="A" color="var(--presence-agent)" /> agent</span></td>
                            <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                            <td className="sh-td-num">9 ms</td>
                            <td className="sh-td-num">now</td>
                            <td className="sh-td-act"><button type="button" className="btn btn--danger btn--sm" disabled><Icon name="x" size={12} /> Kick</button></td>
                          </tr>
                        </tbody>
                      </table>
                    </section>

                    <section className="panel">
                      <div className="panel-hd">Activity</div>
                      <ActivityFeed />
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DCArtboard>

        {/* ── E · TOKENS ───────────────────────────────────────────────────── */}
        <DCArtboard id="tokens" label="E · access tokens · rotate kill-switch" width={1360} height={960}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/E" label="tokens · issue · scope · rotate" sub="4 tokens" />
            <div className="sh-app">
              <NavSidebar active="tokens" />
              <div className="sh-main">
                <TopBar title="Access tokens" />
                <div className="sh-content">
                  <div className="sh-grid" style={{ gridTemplateColumns: "1.5fr 1fr", marginTop: 0 }}>
                    <div className="sh-grid-col">
                      <section className="panel">
                        <div className="panel-hd">Active tokens <span className="sh-sku">hashed at rest · shown once</span></div>
                        <table className="sh-tbl">
                          <caption>Active tokens</caption>
                          <thead><tr><th>Label</th><th>Scope</th><th>Created</th><th>Last used</th><th>Sessions</th><th className="sh-td-act"><span className="sh-sr">Actions</span></th></tr></thead>
                          <tbody>
                            <tr>
                              <td><span className="sh-user"><Avatar name="alice" color="var(--status-info)" size={18} /> alice</span></td>
                              <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                              <td className="sh-td-num">May 24</td>
                              <td className="sh-td-num">4m ago</td>
                              <td><span className="sh-sessions"><span className="sh-dot" aria-hidden="true" /> 1</span></td>
                              <td className="sh-td-act"><button type="button" className="btn btn--ghost btn--sm"><Icon name="rotate" size={13} /> Rotate</button></td>
                            </tr>
                            <tr>
                              <td><span className="sh-user"><Avatar name="bob" color="var(--status-warn)" size={18} /> bob</span></td>
                              <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                              <td className="sh-td-num">May 24</td>
                              <td className="sh-td-num">12m ago</td>
                              <td><span className="sh-sessions"><span className="sh-dot" aria-hidden="true" /> 1</span></td>
                              <td className="sh-td-act"><button type="button" className="btn btn--ghost btn--sm"><Icon name="rotate" size={13} /> Rotate</button></td>
                            </tr>
                            <tr>
                              <td><span className="sh-user"><Avatar name="carol" color="var(--presence-online)" size={18} /> carol</span></td>
                              <td><span className="sh-scope sh-scope--wide">hub-wide</span></td>
                              <td className="sh-td-num">just now</td>
                              <td className="sh-td-num">—</td>
                              <td><span className="sh-sessions is-zero"><span className="sh-dot" aria-hidden="true" /> 0</span></td>
                              <td className="sh-td-act"><button type="button" className="btn btn--ghost btn--sm"><Icon name="rotate" size={13} /> Rotate</button></td>
                            </tr>
                            <tr>
                              <td><span className="sh-user"><Avatar name="ci" color="var(--fg-3)" size={18} /> ci-bot <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-2)" }}>dev</code></span></td>
                              <td><span className="sh-scope">ci-bot/deploy</span></td>
                              <td className="sh-td-num">May 20</td>
                              <td className="sh-td-num">—</td>
                              <td><span className="sh-sessions is-zero"><span className="sh-dot" aria-hidden="true" /> 0</span></td>
                              <td className="sh-td-act"><button type="button" className="btn btn--ghost btn--sm"><Icon name="rotate" size={13} /> Rotate</button></td>
                            </tr>
                          </tbody>
                        </table>
                      </section>

                      {/* rotate-as-kill-switch confirm */}
                      <div className="sh-confirm" role="alertdialog" aria-labelledby="rot-h">
                        <p id="rot-h"><b>Rotate alice?</b> Live sessions using this token are kicked within <b>5s</b>. There's no undo — and no separate revoke. <b>Rotation is the kill switch.</b></p>
                        <span className="sh-confirm-act">
                          <button type="button" className="btn btn--ghost btn--sm">Cancel</button>
                          <button type="button" className="btn btn--danger btn--sm"><Icon name="rotate" size={13} /> Rotate &amp; kick 1 session</button>
                        </span>
                      </div>
                    </div>

                    <div className="sh-grid-col">
                      {/* generate-invite form */}
                      <section className="panel">
                        <div className="panel-hd">Generate invite <span className="sh-sku">HUB · /admin/api/token</span></div>
                        <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                          <div className="sh-field">
                            <label className="sh-field-label" htmlFor="lbl">Label this invite</label>
                            <input id="lbl" className="input" type="text" defaultValue="dave" />
                          </div>
                          <label className="sh-check">
                            <input className="switch" type="checkbox" defaultChecked aria-label="Hub-wide scope" />
                            <span className="sh-check-tx">
                              <b>Hub-wide — authorize all canvases</b>
                              <span>Required for canvas sync (peers use a per-canvas slug as the document name). Uncheck to scope the token to its label only.</span>
                            </span>
                          </label>
                          <div className="sh-actions">
                            <button type="button" className="btn btn--primary"><Icon name="plus" size={14} /> Generate token <span className="kbd" aria-hidden="true">⏎</span></button>
                          </div>
                          <p className="sh-field-help">One-time token, shown once. The command below goes straight into the peer's terminal.</p>
                        </div>
                      </section>

                      <div className="callout callout--info">
                        <span style={{ color: "var(--status-info)", flex: "0 0 auto" }}><Icon name="shield" /></span>
                        <span>
                          <b style={{ color: "var(--fg-0)" }}>Scope, briefly.</b> A <b>hub-wide</b> token reaches every synced canvas. A <b>label-scoped</b> token (e.g. <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)" }}>ci-bot/deploy</code>) only authorizes documents under that prefix — handy for CI bots that shouldn't touch live design work.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DCArtboard>

        {/* ── F · INVITE ISSUED (modal — signature moment) ─────────────────── */}
        <DCArtboard id="invite-modal" label="F · invite issued · single-use credential" width={1480} height={940}>
          <div className="maude sh-frame" data-theme="dark" style={{ position: "relative" }}>
            <AbHd sku="HUB/F" label="invite issued · shown once" sub="single-use" />
            {/* everything behind the dialog is inert — out of tab order + a11y tree */}
            <div className="sh-behind" inert>
              <div className="sh-app">
                <NavSidebar active="tokens" />
                <div className="sh-main">
                  <TopBar title="Access tokens" />
                  <DashboardBody />
                </div>
              </div>
            </div>

            <div className="sh-scrim" role="presentation">
              <div className="sh-issued" role="dialog" aria-modal="true" aria-labelledby="issued-title">
                <div className="sh-issued-hd">
                  <span className="sh-sku sh-sku--accent">invite issued</span>
                  <span className="sh-stampz">2026-06-05 14:32Z</span>
                </div>
                <div className="sh-issued-bd">
                  <h2 id="issued-title">Invite ready — for "carol"</h2>
                  <p>Copy the command into the peer's terminal. The token is shown <b>once</b>; close this and it's gone.</p>

                  <pre className="sh-cmd">{`maude design link https://${HUB} `}<span className="sh-cont">\\</span>{`\n  `}<span className="sh-flag">--token=</span>{TOKEN}</pre>

                  <div className="sh-issued-actions">
                    <button type="button" className={`btn ${copied ? "sh-btn-copied" : "btn--primary"}`}>
                      <Icon name="check" size={14} /> {copied ? "Command copied" : "Copy command"}
                    </button>
                    <span className="sh-sku">⌘C · clipboard</span>
                  </div>

                  <hr className="sh-tear" />

                  <div className="sh-stub">
                    <span className="sh-stub-lbl">raw token</span>
                    <code>{TOKEN}</code>
                  </div>
                  <div className="sh-issued-meta">
                    <span>single use</span>
                    <span>non-reissuable</span>
                    <span className="is-scope">scope · hub-wide</span>
                  </div>
                </div>
                <div className="sh-issued-ft">
                  <button type="button" className="btn btn--ghost">Done</button>
                </div>
              </div>
            </div>
          </div>
        </DCArtboard>

        {/* ── G · STATES & SETTINGS ────────────────────────────────────────── */}
        <DCArtboard id="states" label="G · states · sign-in · errors · settings" width={1160} height={1100}>
          <div className="maude sh-frame" data-theme="dark">
            <AbHd sku="HUB/G" label="edge states · sign-in · settings" />
            <div className="sh-states">

              {/* returning-operator sign-in */}
              <div className="sh-state-blk">
                <h3>Returning operator · sign in <span className="sh-sku">localStorage</span></h3>
                <div className="sh-card">
                  <div className="sh-card-bd">
                    <div className="sh-signin-hero">
                      <span className="sh-mark sh-mark--lg" aria-hidden="true"><Sparkle /></span>
                      <span className="sh-signin-hero-tx"><span className="sh-signin-hero-name">Studio Hub</span><span className="sh-signin-hero-sub">this hub is already claimed</span></span>
                    </div>
                    <div className="sh-field">
                      <label className="sh-field-label" htmlFor="secret">HUB_SECRET</label>
                      <input id="secret" className="input" type="password" defaultValue="••••••••••••••••••••" aria-label="HUB_SECRET" />
                    </div>
                    <div className="sh-actions">
                      <button type="button" className="btn btn--primary">Sign in <span className="kbd" aria-hidden="true">⏎</span></button>
                      <span className="sh-sku">bearer · /admin/api</span>
                    </div>
                    <p className="sh-field-help">Stored in this browser's <code>localStorage</code> only — clear it to sign out everywhere. No cookie, no server session.</p>
                  </div>
                </div>
              </div>

              {/* settings excerpt */}
              <div className="sh-state-blk">
                <h3>Settings <span className="sh-sku">identity · transport · storage</span></h3>
                <div className="sh-card">
                  <div className="sh-card-bd" style={{ gap: "var(--space-5)" }}>
                    <div className="sh-set-grid">
                      <div className="sh-set-row"><span className="sh-set-k"><b>Hub name</b><span>shown in the console + invites</span></span><span className="sh-set-v">Studio Hub</span></div>
                      <div className="sh-set-row"><span className="sh-set-k"><b>Public URL</b><span>HUB_PUBLIC_URL</span></span><span className="sh-set-v">https://{HUB}</span></div>
                      <div className="sh-set-row"><span className="sh-set-k"><b>Transport</b><span>TLS termination</span></span><span className="sh-set-v"><span className="sh-scope"><Icon name="lock" size={12} /> Caddy · auto cert</span></span></div>
                      <div className="sh-set-row"><span className="sh-set-k"><b>Storage</b><span>DATA_DIR</span></span><span className="sh-set-v">/data · 4.2 MB</span></div>
                    </div>
                  </div>
                </div>
                <div className="sh-card sh-danger panel">
                  <div className="panel-hd">Danger zone</div>
                  <div className="sh-card-bd">
                    <div className="sh-set-row"><span className="sh-set-k"><b>Rotate admin secret</b><span>signs every device out</span></span><button type="button" className="btn btn--danger btn--sm"><Icon name="rotate" size={13} /> Rotate</button></div>
                    <div className="sh-set-row"><span className="sh-set-k"><b>Wipe synced state</b><span>deletes all canvas documents</span></span><button type="button" className="btn btn--danger btn--sm"><Icon name="x" size={13} /> Wipe data</button></div>
                  </div>
                </div>
              </div>

              {/* error + empty states */}
              <div className="sh-state-blk">
                <h3>Auth expired · token rotated</h3>
                <div className="callout callout--info">
                  <span style={{ color: "var(--status-info)", flex: "0 0 auto" }}><Icon name="link" /></span>
                  <span>Your link was rotated by the hub admin. Re-link to continue: <code>maude design link https://{HUB} --token=mau_…</code></span>
                </div>
              </div>

              <div className="sh-state-blk">
                <h3>Rate limited · too many attempts</h3>
                <div className="callout callout--error">
                  <span style={{ color: "var(--status-error)", flex: "0 0 auto" }}><Icon name="shield" /></span>
                  <span><b style={{ color: "var(--fg-0)" }}>429 · Too many attempts.</b> The bootstrap + 401 paths cap at 5 requests / 60s per IP. Try again in <b>60s</b>, or set <code>HUB_ADMIN_RATE_LIMIT=off</code> for local dev.</span>
                </div>
              </div>

              <div className="sh-state-blk">
                <h3>Empty · no peers connected</h3>
                <div className="sh-empty">
                  <span className="sh-empty-glyph" aria-hidden="true"><Icon name="peers" size={20} /></span>
                  <p className="sh-empty-title">No peers connected.</p>
                  <p className="sh-empty-body">Generate an invite and paste the command into a teammate's terminal — they'll appear here the moment they open a canvas.</p>
                  <button type="button" className="btn btn--primary btn--sm"><Icon name="plus" size={13} /> Generate invite</button>
                </div>
              </div>

              <div className="sh-state-blk">
                <h3>Empty · no tokens yet</h3>
                <div className="sh-empty">
                  <span className="sh-empty-glyph" aria-hidden="true"><Icon name="key" size={20} /></span>
                  <p className="sh-empty-title">No tokens yet.</p>
                  <p className="sh-empty-body">Mint your first one-time invite. Tokens are hashed at rest and shown exactly once.</p>
                  <button type="button" className="btn btn--primary btn--sm"><Icon name="plus" size={13} /> Generate token</button>
                </div>
              </div>

            </div>
          </div>
        </DCArtboard>

      </DCSection>
    </DesignCanvas>
  );
}
