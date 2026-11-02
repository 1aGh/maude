/**
 * @canvas      Studio Docs — Maude documentation redesign · docs rendered AS the studio chrome (menubar + nav tree + dotted canvas) under the maude DS · 7 artboards · dark studio default + a light reading/handoff inset
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   landing | docs-home | article | command-ref | search | flow-loop | intro-video
 * @brief       Nový návrh Maude dokumentace ("Studio Docs"), vycházející z reálného site/ (Fumadocs). Rozkreslené do artboardů: marketing landing, /docs index, article reader, command-reference page, ⌘K search palette — plus plánovaná infographic (the flow loop) a nástřel intro videa v3.
 * @stack       React 19 · TSX · Bun.build · sibling Studio Docs.css (every value a var(--*) token)
 * @history     .design/_history/studio-docs/
 * @handoff     bunx shadcn add file://./Studio Docs.registry.json
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). The big idea:
 * the docs are a reading surface OF the studio — same cohesive panel material,
 * 1px hairlines, dotted-canvas backdrop, ONE indigo accent, mono-first labels.
 * Tokens + shared component classes are self-imported so the canvas renders in
 * maude no matter which DS the host injects (the Studio.tsx prior, DDR-093-era).
 * Chrome + sidebar + palette are built in the sibling CSS the same way Studio.css
 * builds its own — atoms (.btn/.kbd/.callout/.panel/.tag) come from _components.css.
 */

// Self-contained: pin the maude tokens + shared component classes to this canvas.
import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Studio Docs.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

/* ───────────────────────────── Icon set ─────────────────────────────────────
 * Thin-stroke (1.4) geometric glyphs — terminal/IDE heritage, no emoji (DS rule).
 * Lifted + extended from the Studio.tsx prior.
 * ──────────────────────────────────────────────────────────────────────────── */
const ICONS: Record<string, React.ReactNode> = {
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  "chevron-down": <polyline points="3.5 6 8 10.5 12.5 6" />,
  search: (<><circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13.5" y2="13.5" /></>),
  command: <path d="M5 2.5a2 2 0 1 0 2 2v7a2 2 0 1 0 2-2H5z" transform="translate(0.5 0.5)" />,
  book: (<><path d="M3 3.5h6a2 2 0 0 1 2 2V13H5a2 2 0 0 0-2 2z" transform="translate(1 -1)" /><path d="M13 3.5H7a2 2 0 0 0-2 2V13h6a2 2 0 0 1 2 2z" transform="translate(0 -1)" /></>),
  doc: (<><path d="M4 2h5l3 3v9H4z" /><polyline points="9 2 9 5 12 5" /></>),
  terminal: (<><polyline points="3.5 5.5 6 8 3.5 10.5" /><line x1="8" y1="11" x2="12" y2="11" /></>),
  palette: (<><circle cx="8" cy="8" r="5.5" /><circle cx="6" cy="6" r="0.9" fill="currentColor" stroke="none" /><circle cx="10" cy="6.2" r="0.9" fill="currentColor" stroke="none" /><circle cx="10.6" cy="9.4" r="0.9" fill="currentColor" stroke="none" /></>),
  workflow: (<><rect x="2.5" y="2.5" width="4" height="4" rx="1" /><rect x="9.5" y="9.5" width="4" height="4" rx="1" /><path d="M6.5 4.5h3a2 2 0 0 1 2 2v3" /></>),
  server: (<><rect x="2.5" y="3" width="11" height="4" rx="1" /><rect x="2.5" y="9" width="11" height="4" rx="1" /><line x1="5" y1="5" x2="5" y2="5" /><line x1="5" y1="11" x2="5" y2="11" /></>),
  shield: <path d="M8 2l5 2v4c0 3.2-2.2 5.2-5 6-2.8-.8-5-2.8-5-6V4z" />,
  sliders: (<><line x1="3" y1="5" x2="13" y2="5" /><circle cx="6" cy="5" r="1.7" fill="currentColor" /><line x1="3" y1="11" x2="13" y2="11" /><circle cx="10" cy="11" r="1.7" fill="currentColor" /></>),
  layers: (<><polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" /><polyline points="2.2 9 8 12.3 13.8 9" /></>),
  braces: (<><path d="M6 2.5C4.5 2.5 4.5 5 4.5 6S3 8 3 8s1.5 1 1.5 2 0 3.5 1.5 3.5" /><path d="M10 2.5C11.5 2.5 11.5 5 11.5 6S13 8 13 8s-1.5 1-1.5 2 0 3.5-1.5 3.5" /></>),
  recipe: (<><path d="M5 2.5h6v11H5z" /><line x1="7" y1="6" x2="9" y2="6" /><line x1="7" y1="8.5" x2="9" y2="8.5" /></>),
  sun: (<><circle cx="8" cy="8" r="2.6" /><line x1="8" y1="1.5" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="14.5" /><line x1="1.5" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="14.5" y2="8" /><line x1="3.4" y1="3.4" x2="4.4" y2="4.4" /><line x1="11.6" y1="11.6" x2="12.6" y2="12.6" /><line x1="12.6" y1="3.4" x2="11.6" y2="4.4" /><line x1="4.4" y1="11.6" x2="3.4" y2="12.6" /></>),
  moon: <path d="M12.5 9.6A5 5 0 1 1 7 3a4 4 0 0 0 5.5 6.6z" />,
  github: <path d="M8 1.5a6.5 6.5 0 0 0-2 12.7c.3 0 .4-.1.4-.3v-1.2c-1.8.4-2.2-.8-2.2-.8-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.5.7 1.9.6 0-.5.2-.7.4-.9-1.4-.2-2.9-.7-2.9-3.2 0-.7.3-1.3.7-1.7 0-.2-.3-.9.1-1.8 0 0 .6-.2 1.8.7a6 6 0 0 1 3.2 0c1.2-.9 1.8-.7 1.8-.7.4.9.1 1.6.1 1.8.4.4.7 1 .7 1.7 0 2.5-1.5 3-2.9 3.2.2.2.4.6.4 1.2v1.8c0 .2.1.4.4.3A6.5 6.5 0 0 0 8 1.5z" fill="currentColor" stroke="none" />,
  play: <polygon points="5 3.5 12.5 8 5 12.5" fill="currentColor" stroke="none" />,
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  "arrow-right": (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  "arrow-left": (<><line x1="13" y1="8" x2="3.5" y2="8" /><polyline points="7 4.5 3.5 8 7 11.5" /></>),
  loop: (<><path d="M3 8a5 5 0 0 1 8.6-3.5L13 6" /><polyline points="13 2.5 13 6 9.5 6" /><path d="M13 8a5 5 0 0 1-8.6 3.5L3 10" /><polyline points="3 13.5 3 10 6.5 10" /></>),
  copy: (<><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M3.5 10.5h-.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5" /></>),
  x: (<><line x1="4.3" y1="4.3" x2="11.7" y2="11.7" /><line x1="11.7" y1="4.3" x2="4.3" y2="11.7" /></>),
  expand: (<><polyline points="3 6 3 3 6 3" /><polyline points="10 3 13 3 13 6" /><polyline points="13 10 13 13 10 13" /><polyline points="6 13 3 13 3 10" /></>),
  volume: (<><polygon points="3 6 5.5 6 8 3.5 8 12.5 5.5 10 3 10" fill="currentColor" stroke="none" /><path d="M10.5 6a3 3 0 0 1 0 4" /></>),
  pause: (<><rect x="4.5" y="3.5" width="2.2" height="9" rx="0.6" fill="currentColor" stroke="none" /><rect x="9.3" y="3.5" width="2.2" height="9" rx="0.6" fill="currentColor" stroke="none" /></>),
  cursor: <path d="M3 2l9 4.4-4 1.1-1.1 4z" />,
  download: (<><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><polyline points="3 12.8 3 13.6 13 13.6 13 12.8" /></>),
  code: (<><polyline points="6 5 3 8 6 11" /><polyline points="10 5 13 8 10 11" /></>),
  link: (<><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1" /><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1" /></>),
};

function Icon({ name, size = 16, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
function Kbd({ children }: { children: React.ReactNode }) { return <span className="kbd">{children}</span>; }

/* Themed artboard wrapper — pins the maude token ladder + fills the DCArtboard body. */
function Board({ theme = "dark", children }: { theme?: "dark" | "light"; children: React.ReactNode }) {
  return (
    <div className="maude" data-theme={theme}
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "var(--bg-0)", color: "var(--fg-0)", fontFamily: "var(--font-body)" }}>
      {children}
    </div>
  );
}

/* The maude brand mark — the filled 4-point sparkle from the app favicon
 * (no emoji, DS rule). Scales to ~66% of its tile so it reads at every
 * .sd-brand-mark size (nav 22px · info 30px · hero lockup 44px). */
function BrandMark() {
  return (
    <span className="sd-brand-mark">
      <svg viewBox="0 0 32 32" width="100%" height="100%" fill="currentColor" aria-hidden="true">
        <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" />
      </svg>
    </span>
  );
}

/* ───────────────────────── Shared chrome ───────────────────────────────────── */
function DocsMenubar({ active = "Docs", theme = "dark" }: { active?: string; theme?: string }) {
  const links = ["Docs", "Roadmap", "What's New", "About"];
  return (
    <div className="sd-menubar">
      <div className="sd-brand">
        <BrandMark />
        <span className="sd-brand-name">maude</span>
        <span className="sd-brand-sku">docs</span>
      </div>
      <nav className="sd-nav" aria-label="primary">
        {links.map((l) => (
          <a key={l} className={"sd-navlink" + (l === active ? " is-active" : "")} href="#">{l}</a>
        ))}
      </nav>
      <div className="sd-mb-right">
        <button type="button" className="sd-cmdk" aria-label="Search docs">
          <Icon name="search" size={14} />
          <span>Search docs…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button type="button" className="sd-iconbtn" aria-label="Theme" title="Theme">
          <Icon name={theme === "light" ? "sun" : "moon"} size={15} />
        </button>
        <button type="button" className="sd-iconbtn" aria-label="GitHub" title="GitHub repo">
          <Icon name="github" size={15} />
        </button>
        <span className="sd-ver">v0.28.1</span>
      </div>
    </div>
  );
}

/* The real site/ IA from site/content/docs/meta.json. */
type NavItem = { id: string; label: string; glyph: string; count?: number; expandable?: boolean };
type NavGroup = { section?: string; items: NavItem[] };
const NAV: NavGroup[] = [
  { items: [
    { id: "index", label: "Overview", glyph: "book" },
    { id: "getting-started", label: "Getting Started", glyph: "play" },
  ] },
  { section: "Learn", items: [
    { id: "cli", label: "maude CLI", glyph: "terminal" },
    { id: "design", label: "Design", glyph: "palette" },
    { id: "flow", label: "Flow", glyph: "workflow" },
    { id: "hub", label: "Hub", glyph: "server" },
    { id: "security", label: "Security", glyph: "shield" },
    { id: "config", label: "Config", glyph: "sliders" },
  ] },
  { section: "Look up", items: [
    { id: "commands-design", label: "commands · design", glyph: "layers", count: 14, expandable: true },
    { id: "commands-flow", label: "commands · flow", glyph: "layers", count: 30, expandable: true },
    { id: "config-schema", label: "Config schema", glyph: "braces" },
  ] },
  { section: "Recipes", items: [
    { id: "recipes", label: "Recipes", glyph: "recipe", count: 3 },
  ] },
];
const DESIGN_CMDS = ["new", "edit", "draw", "browse", "critic", "screenshot", "rollback", "export", "handoff", "smoke", "setup-ds", "setup-docs", "init", "help"];

function DocsSidebar({ active, expand }: { active: string; expand?: string }) {
  return (
    <aside className="sd-sidebar" aria-label="docs navigation">
      <div className="sd-sb-search">
        <div className="sd-sb-searchbox">
          <Icon name="search" size={14} />
          <span>Search…</span>
          <Kbd>⌘K</Kbd>
        </div>
      </div>
      <div className="sd-tree">
        {NAV.map((g) => (
          <div key={g.section ?? "root"}>
            {g.section ? <div className="sd-tree-sec">{g.section}</div> : null}
            {g.items.map((it) => (
              <div key={it.id}>
                <a href="#" className={"sd-nav-row" + (it.id === active ? " is-active" : "")} aria-current={it.id === active ? "page" : undefined}>
                  <span className="sd-nav-glyph">
                    {it.expandable ? <Icon name={expand === it.id ? "chevron-down" : "chevron-right"} size={12} /> : <Icon name={it.glyph} size={14} />}
                  </span>
                  <span className="sd-nav-name">{it.label}</span>
                  {it.count != null ? <span className="sd-nav-count">{it.count}</span> : null}
                </a>
                {it.expandable && expand === it.id && it.id === "commands-design"
                  ? DESIGN_CMDS.map((c) => (
                      <a href="#" key={c} className={"sd-nav-row sd-nav-child" + (c === "new" && active === "commands-design" ? " is-active" : "")} aria-current={c === "new" && active === "commands-design" ? "page" : undefined}>
                        <span className="sd-nav-name"><span className="sd-mono">/design:{c}</span></span>
                      </a>
                    ))
                  : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function TocRail({ items, active }: { items: { label: string; sub?: boolean }[]; active: number }) {
  return (
    <aside className="sd-toc" aria-label="on this page">
      <div className="sd-toc-hd">On this page</div>
      {items.map((it, i) => (
        <a key={it.label} className={"sd-toc-link" + (it.sub ? " is-sub" : "") + (i === active ? " is-active" : "")} href="#" aria-current={i === active ? "location" : undefined}>{it.label}</a>
      ))}
    </aside>
  );
}

function Breadcrumb({ trail }: { trail: string[] }) {
  return (
    <div className="sd-breadcrumb">
      {trail.map((t, i) => (
        <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          {i > 0 ? <span className="sd-bc-sep">/</span> : null}
          {i === trail.length - 1 ? <b>{t}</b> : <span>{t}</span>}
        </span>
      ))}
    </div>
  );
}

function CodeBlock({ lang, copy = true, children }: { lang: string; copy?: boolean; children: React.ReactNode }) {
  return (
    <div className="sd-code">
      <div className="sd-code-hd">
        <span className="sd-code-lang">{lang}</span>
        {copy ? <button type="button" className="sd-code-copy" aria-label="Copy code"><Icon name="copy" size={12} /> copy</button> : null}
      </div>
      <div className="sd-code-body">{children}</div>
    </div>
  );
}

/* ═══════════════════════════ A · landing ════════════════════════════════════ */
const CATALOG = [
  { sku: "DSN-01", title: "design", desc: "Canvas-first iteration on .tsx mocks. Bun dev-server tracks active tab + selection over WebSocket.", tags: ["canvas", "critics", "handoff"] },
  { sku: "FLW-01", title: "flow", desc: "The agentic loop that ships things. Second-brain .ai/ workspace, project-agnostic.", tags: ["plan", "execute", "validate"] },
  { sku: "CLI-01", title: "maude", desc: "Small CLI. Scaffolds .ai/, reads config, boots the dev-server, doctor diagnostics.", tags: ["init", "doctor", "cache"] },
  { sku: "HUB-01", title: "hub", desc: "Optional self-hosted Yjs sync hub. Mirror .design/ across collaborators. No SaaS tier.", tags: ["yjs", "self-host"] },
];

function Landing() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Docs" />
        <div className="sd-landing sd-canvas">
          <section className="sd-hero" aria-labelledby="land-h1">
            <div>
              <div className="sd-hero-lockup">
                <BrandMark />
                <span className="sd-wordmark">maude</span>
                <span className="sd-brand-sku">docs</span>
              </div>
              <div className="sd-hero-sku"><span>MARKETPLACE</span><span>·</span><span>TWO PLUGINS</span><span>·</span><span>MIT</span></div>
              <h1 id="land-h1" className="sd-hero-h1">Maude, how it <span className="sd-accent">works mostly</span>.</h1>
              <p className="sd-hero-punch">Vibe-design &amp; vibe-code workflows for Claude Code. Two plugins, one CLI, some vibes.</p>
              <p className="sd-hero-fine">No telemetry, no signup, no <span className="sd-strike">book a demo</span> button. If it crashes, <span className="sd-inline-code">git pull</span> and try again. That's the entire support contract.</p>
              <div className="sd-cta-row">
                <button type="button" className="btn btn--primary">Read the docs <Icon name="arrow-right" size={14} /></button>
                <button type="button" className="btn btn--ghost">Browse the catalog</button>
                <button type="button" className="sd-watch" aria-label="Watch the intro video">
                  <span className="sd-watch-play"><Icon name="play" size={11} /></span>
                  Watch the intro <span className="sd-watch-dur">0:38</span>
                </button>
              </div>
            </div>
            <div className="sd-install">
              <div className="sd-install-hd"><Icon name="terminal" size={13} /> install</div>
              <div className="sd-install-body">
                <div className="sd-install-line"><span className="sd-install-prompt">$</span> npm i -g @1agh/maude <button type="button" className="sd-install-copy" aria-label="Copy install command"><Icon name="copy" size={13} /></button></div>
                <div className="sd-install-line"><span className="sd-install-comment"># or: pnpm add -g @1agh/maude</span></div>
                <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--space-3) 0" }} />
                <div className="sd-install-line"><span className="sd-install-comment"># inside Claude Code</span></div>
                <div className="sd-install-line"><span className="sd-install-prompt">›</span> /plugin marketplace add 1aGh/maude</div>
              </div>
            </div>
          </section>

          <section aria-labelledby="cat-h">
            <div className="sd-cat-head">
              <h2 id="cat-h" className="sd-cat-h2">The catalog.</h2>
              <span className="sd-cat-eyebrow">two plugins · one CLI · one hub — <a href="#">see the roadmap →</a></span>
            </div>
            <div className="sd-cat-grid">
              {CATALOG.map((c) => (
                <a href="#" key={c.sku} className="sd-cat-card" aria-label={`${c.title} plugin`}>
                  <div className="sd-cat-cardhd">
                    <span className="sd-cat-sku">{c.sku}</span>
                    <span className="tag">MIT</span>
                  </div>
                  <div className="sd-cat-title">{c.title}</div>
                  <p className="sd-cat-desc">{c.desc}</p>
                  <div className="sd-cat-tags">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                  <div className="sd-cat-foot"><span>plugin</span><span className="sd-open">open →</span></div>
                </a>
              ))}
            </div>
          </section>

          <div className="sd-landing-foot">
            <span>Built in the open by people who'd rather ship than pitch. <a href="#" style={{ color: "var(--accent)" }}>More.</a></span>
            <dl className="sd-metafoot">
              <div><dt>license</dt><dd>MIT</dd></div>
              <div><dt>telemetry</dt><dd>none</dd></div>
              <div><dt>signup</dt><dd>never</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ B · docs · home ════════════════════════════════ */
const PICK = [
  { title: "Getting Started", desc: "Four steps and you're in. (Maybe five. Depends on your shell.)", glyph: "play" },
  { title: "maude CLI", desc: "Subcommands: init, config, doctor, cache, design, hub.", glyph: "terminal", mono: true },
  { title: "Design canvas loop", desc: "/design:new, /design:edit, /design:critic, and the rest of the loop.", glyph: "palette" },
  { title: "Flow lifecycle", desc: "The 30 slash commands behind plan, execute, done, validate, release.", glyph: "workflow" },
  { title: "Config reference", desc: "Every key in .ai/workflows.config.json with examples.", glyph: "sliders" },
  { title: "Self-host the hub", desc: "Optional Yjs sync hub — mirror .design/ across collaborators.", glyph: "server" },
];

function DocsHome() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Docs" />
        <div className="sd-body">
          <DocsSidebar active="index" />
          <div className="sd-main">
            <div className="sd-main-scroll sd-canvas">
              <Breadcrumb trail={["Docs", "Overview"]} />
              <div className="sd-doc">
                <h1 className="sd-h1">Maude, how it works mostly</h1>
                <p className="sd-lede">Two plugins, one CLI, and the <span className="sd-inline-code">.ai/</span> workspace they both pretend not to need. You're probably here for <span className="sd-inline-code">design</span> or <span className="sd-inline-code">flow</span>. <span className="sd-inline-code">maude</span> is the plumbing. Cmd-K skips ahead.</p>

                <h2 className="sd-h2">Pick a direction</h2>
                <div className="sd-card-grid">
                  {PICK.map((c) => (
                    <a href="#" key={c.title} className="sd-card">
                      <div className="sd-card-title"><Icon name={c.glyph} size={16} className="sd-accent" />{c.mono ? <code>{c.title}</code> : c.title}<Icon name="arrow-right" size={14} className="sd-card-arrow" /></div>
                      <div className="sd-card-desc">{c.desc}</div>
                    </a>
                  ))}
                </div>

                <h2 className="sd-h2">Why both plugins together?</h2>
                <p className="sd-p">The two plugins share a worldview. <b style={{ color: "var(--fg-0)" }}>Claude Code is the IDE. The repo is the source of truth.</b> Decisions get written to <span className="sd-inline-code">.ai/decisions/</span>. Plans archive to <span className="sd-inline-code">.ai/plans/archive/</span>. Design mocks live in <span className="sd-inline-code">.design/</span> next to the production code they precede. Nothing lives only in a chat scroll.</p>
                <div className="callout callout--info">
                  <Icon name="sparkle" size={16} className="sd-accent" />
                  <div><b style={{ color: "var(--fg-0)" }}>Install one, install both.</b> They're independent — same plugin runs in Next.js, Expo, Go, anything.</div>
                </div>
              </div>
            </div>
          </div>
          <TocRail items={[{ label: "Pick a direction" }, { label: "Why both plugins together?" }, { label: "License and source" }]} active={0} />
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ C · docs · article ═════════════════════════════ */
function Article() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Docs" />
        <div className="sd-body">
          <DocsSidebar active="getting-started" />
          <div className="sd-main">
            <div className="sd-main-scroll sd-canvas" style={{ position: "relative" }}>
              <Breadcrumb trail={["Docs", "Getting Started"]} />
              <div className="sd-doc">
                <h1 className="sd-h1">Getting Started</h1>
                <p className="sd-lede">Four steps and you're in. (Maybe five. Depends on your shell.) <span className="sd-inline-code">npm install</span>, a marketplace, two plugins, two init commands. No accounts, no API keys, no telemetry.</p>

                <h2 className="sd-h2">Install the CLI</h2>
                <p className="sd-p"><span className="sd-inline-code">maude</span> is required, not optional. Several skills shell out to it.</p>
                <CodeBlock lang="bash">
                  <div><span className="sd-tok-fn">npm</span> i -g @1agh/maude</div>
                  <div className="sd-tok-cmt"># or with pnpm</div>
                  <div><span className="sd-tok-fn">pnpm</span> add -g @1agh/maude</div>
                </CodeBlock>
                <div className="callout callout--info" style={{ marginBottom: "var(--space-5)" }}>
                  <Icon name="terminal" size={15} className="sd-accent" />
                  <div style={{ fontSize: "var(--type-sm)" }}>This gives you the <span className="sd-inline-code">maude</span> binary that scaffolds the <span className="sd-inline-code">.ai/</span> workspace and boots the design dev server.</div>
                </div>

                <h2 className="sd-h2">Add the marketplace</h2>
                <p className="sd-p">Inside Claude Code:</p>
                <CodeBlock lang="text" copy={false}>
                  <div><span className="sd-tok-key">/plugin</span> marketplace add 1aGh/maude</div>
                </CodeBlock>

                <h2 className="sd-h2">Install the plugins</h2>
                <CodeBlock lang="text" copy={false}>
                  <div><span className="sd-tok-key">/plugin</span> install design@maude</div>
                  <div><span className="sd-tok-key">/plugin</span> install flow@maude</div>
                </CodeBlock>

                <h2 className="sd-h2">Init the workspace</h2>
                <CodeBlock lang="text" copy={false}>
                  <div><span className="sd-tok-key">/flow:init</span></div>
                  <div><span className="sd-tok-key">/design:init</span></div>
                </CodeBlock>

                <div className="sd-docfoot">
                  <div className="sd-prevnext">
                    <a href="#" className="sd-pn"><span className="sd-pn-label">← previous</span><span className="sd-pn-title">Overview</span></a>
                    <a href="#" className="sd-pn sd-pn--next"><span className="sd-pn-label">next →</span><span className="sd-pn-title">maude CLI</span></a>
                  </div>
                  <div className="sd-meta"><Icon name="sparkle" size={12} /> Auto-generated · <a href="#">Edit on GitHub</a> · MIT</div>
                </div>
              </div>

              {/* Light reading/handoff inset — honors maude's two-theme-equal contract. */}
              <div className="sd-inset maude" data-theme="light">
                <span className="sd-inset-tag" style={{ color: "var(--accent)" }}>light · reading / handoff mode</span>
                <div className="sd-inset-body">
                  <div className="sd-inset-mb"><BrandMark /><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--type-sm)" }}>maude</span><span className="sd-brand-sku" style={{ marginLeft: "auto" }}>docs</span></div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--type-lg)", fontWeight: 650, marginBottom: 6 }}>Getting Started</div>
                  <p style={{ fontSize: "var(--type-xs)", lineHeight: "var(--lh-xs)", color: "var(--fg-1)", margin: 0 }}>Same article, light surface — for sharing, printing, or reading away from the studio. Two themes, equal status.</p>
                </div>
              </div>
            </div>
          </div>
          <TocRail items={[{ label: "Install the CLI" }, { label: "Add the marketplace" }, { label: "Install the plugins" }, { label: "Init the workspace" }]} active={0} />
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ D · command reference ══════════════════════════ */
function CommandRef() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Docs" />
        <div className="sd-body">
          <DocsSidebar active="commands-design" expand="commands-design" />
          <div className="sd-main">
            <div className="sd-main-scroll sd-canvas">
              <Breadcrumb trail={["Docs", "Look up", "commands · design", "/design:new"]} />
              <div className="sd-doc">
                <h1 className="sd-cmd-h1">/design:new</h1>
                <p className="sd-lede">Vytvoř nový multi-artboard canvas přes <span className="sd-inline-code">frontend-design</span>. Default = <span className="sd-inline-code">--perfect</span> (8 iter, full panel, target 4.5/5).</p>

                <table className="sd-tbl">
                  <tbody>
                    <tr><th scope="row">Command</th><td><code>/design:new</code></td></tr>
                    <tr><th scope="row">Category</th><td><span className="tag tag--accent">daily</span></td></tr>
                    <tr><th scope="row">Argument hint</th><td><code>&lt;Name&gt; "&lt;brief&gt;" [--component] [--mobile] [--quick | --no-critic] [--ds=&lt;name&gt;]</code></td></tr>
                    <tr><th scope="row">Source</th><td><a className="sd-link" href="#"><Icon name="github" size={12} /> plugins/design/commands/new.md</a></td></tr>
                  </tbody>
                </table>

                <h2 className="sd-h2">Invocation</h2>
                <CodeBlock lang="text" copy={false}>
                  <div><span className="sd-tok-key">/design:new</span> <span className="sd-tok-str">"Match Recap"</span> <span className="sd-tok-str">"Post-game recap — 3 artboardy"</span></div>
                </CodeBlock>

                <h2 className="sd-h2">Summary</h2>
                <p className="sd-p">Vytvoří nový canvas v <span className="sd-inline-code">&lt;designRoot&gt;/&lt;newCanvasDir&gt;/&lt;Name&gt;.tsx</span>. Generic envelope se adaptuje podle <span className="sd-inline-code">.design/config.json</span>. Canvas envelope se importuje z <span className="sd-inline-code">@maude/canvas-lib</span>.</p>

                <div className="callout callout--warn">
                  <Icon name="code" size={16} style={{ color: "var(--status-warn)" }} />
                  <div><b style={{ color: "var(--fg-0)" }}>Source of truth.</b> This page is auto-generated from the command's frontmatter. The exact prompt Claude runs — directives, edge-cases, tool-routing — lives in <a className="sd-link" href="#">plugins/design/commands/new.md</a>.</div>
                </div>
              </div>
            </div>
          </div>
          <TocRail items={[{ label: "Invocation" }, { label: "Summary" }, { label: "Source of truth" }]} active={0} />
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ E · ⌘K · search ════════════════════════════════ */
const RESULTS: { group: string; rows: { glyph: string; label: React.ReactNode; crumb: string; sel?: boolean }[] }[] = [
  { group: "Pages", rows: [
    { glyph: "play", label: "Getting Started", crumb: "Docs", sel: true },
    { glyph: "palette", label: "Design canvas loop", crumb: "Docs / Learn" },
    { glyph: "sliders", label: "Config reference", crumb: "Docs / Learn" },
  ] },
  { group: "Commands", rows: [
    { glyph: "command", label: <code>/design:new</code>, crumb: "design · daily" },
    { glyph: "command", label: <code>/design:edit</code>, crumb: "design · daily" },
    { glyph: "command", label: <code>/flow:plan</code>, crumb: "flow · daily" },
  ] },
  { group: "Recipes", rows: [
    { glyph: "recipe", label: "Next.js", crumb: "Recipes" },
    { glyph: "recipe", label: "Expo", crumb: "Recipes" },
  ] },
];

function SearchBoard() {
  return (
    <Board>
      <div className="sd-shell">
        {/* dimmed reader behind the palette — inert + hidden from AT while the dialog is open */}
        <DocsMenubar active="Docs" />
        <div className="sd-body" style={{ filter: "saturate(0.7)" }} inert aria-hidden="true">
          <DocsSidebar active="getting-started" />
          <div className="sd-main"><div className="sd-main-scroll sd-canvas" /></div>
          <TocRail items={[{ label: "Install the CLI" }]} active={0} />
        </div>
        <div className="sd-cp-scrim">
          <div className="sd-cp" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="sd-cp-input">
              <Icon name="search" size={18} style={{ color: "var(--fg-2)" }} />
              <input className="sd-cp-query" defaultValue="design new" aria-label="Search docs and commands"
                role="combobox" aria-expanded="true" aria-controls="sd-cp-results" />
              <span className="sd-cp-count">14 results</span>
            </div>
            <div className="sd-cp-results" id="sd-cp-results" role="listbox" aria-label="Search results">
              {RESULTS.map((grp) => (
                <div key={grp.group} role="group" aria-label={grp.group}>
                  <div className="sd-cp-group">{grp.group}</div>
                  {grp.rows.map((r, i) => (
                    <div key={grp.group + "-" + i} className={"sd-cp-row" + (r.sel ? " is-sel" : "")} role="option" aria-selected={!!r.sel}>
                      <span className="sd-cp-glyph"><Icon name={r.glyph} size={15} /></span>
                      <span className="sd-cp-label">{r.label}</span>
                      <span className="sd-cp-crumb">{r.crumb}</span>
                      {r.sel ? <span className="sd-cp-enter"><Kbd>↵</Kbd></span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="sd-cp-foot">
              <span className="sd-cp-hint"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="sd-cp-hint"><Kbd>↵</Kbd> open</span>
              <span className="sd-cp-hint"><Kbd>⌘↵</Kbd> new tab</span>
              <span className="sd-cp-hint" style={{ marginLeft: "auto" }}><Kbd>esc</Kbd> close</span>
            </div>
          </div>
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ F · infographic · the flow loop ════════════════ */
type Cmd = { name: string; daily?: boolean };
const PHASES: { n: string; name: string; accent?: boolean; produces: string; cmds: Cmd[] }[] = [
  { n: "00", name: "Setup", produces: ".ai/ workspace + PRD", cmds: [{ name: "init" }, { name: "setup-prd" }, { name: "setup-context" }] },
  { n: "01", name: "Plan", produces: "plan-NNN.md", cmds: [{ name: "plan", daily: true }, { name: "status", daily: true }] },
  { n: "02", name: "Execute", accent: true, produces: "working code", cmds: [{ name: "execute", daily: true }, { name: "quick", daily: true }, { name: "bug-fix" }] },
  { n: "03", name: "Validate", produces: "green gates", cmds: [{ name: "validate", daily: true }, { name: "review-code" }, { name: "scenario", daily: true }] },
  { n: "04", name: "Done", produces: "commit · PR · retro", cmds: [{ name: "done", daily: true }, { name: "record-ddr" }, { name: "record-retro" }] },
  { n: "05", name: "Release", produces: "tagged vX.Y.Z", cmds: [{ name: "release", daily: true }, { name: "release-changelog" }, { name: "maintain-clean" }] },
];

/* The reusable flow-loop diagram — embedded as a FIGURE inside the /docs/flow article
   (the user's ask: infographics live in the markdown content, not as standalone boards). */
function FlowLoopDiagram() {
  return (
    <div className="sd-fl-diagram">
      <div className="sd-fl">
        {PHASES.map((p, i) => (
          <div key={p.name} style={{ display: "contents" }}>
            <div className={"sd-fl-phase" + (p.accent ? " is-accent" : "")}>
              <div className="sd-fl-card">
                <span className="sd-fl-num">{p.n}</span>
                <div className="sd-fl-name">{p.name}</div>
                <div className="sd-fl-cmds">
                  {p.cmds.map((c) => (
                    <div key={c.name} className={"sd-fl-cmd" + (c.daily ? " is-daily" : "")}>
                      <span className="sd-fl-dot" /><span>{c.name}</span>
                    </div>
                  ))}
                </div>
                <div className="sd-fl-out">
                  <span className="sd-fl-out-arrow"><Icon name="arrow-right" size={12} /></span>
                  <span>{p.produces}</span>
                </div>
              </div>
            </div>
            {i < PHASES.length - 1 ? <span className="sd-fl-conn"><Icon name="arrow-right" size={15} /></span> : null}
          </div>
        ))}
      </div>
      <div className="sd-fl-return">
        <span className="sd-fl-return-rail" />
        <span className="sd-fl-return-cap is-left"><Icon name="arrow-left" size={14} /></span>
        <span className="sd-fl-return-label"><Icon name="loop" size={13} /> ship it → next feature · the loop repeats</span>
        <span className="sd-fl-return-cap is-right"><span className="sd-fl-return-node" /></span>
      </div>
      <div className="sd-ai-band">
        <div className="sd-ai-band-lead">
          <span className="sd-ai-band-title"><span className="sd-mono">.ai/</span> workspace</span>
          <span className="sd-ai-band-sub">everything the loop writes — nothing lives in a chat scroll</span>
        </div>
        <div className="sd-ai-chips">
          <span className="sd-ai-chip">decisions/DDR-*.md</span>
          <span className="sd-ai-chip">plans/archive/</span>
          <span className="sd-ai-chip">state/STATE.md</span>
          <span className="sd-ai-chip">logs/retro</span>
        </div>
      </div>
      <div className="sd-fl-legend">
        <span className="sd-legend-item"><span className="sd-legend-dot" style={{ background: "var(--accent)" }} /> 11 daily verbs · one-word terse</span>
        <span className="sd-legend-item"><span className="sd-legend-dot" style={{ background: "transparent", border: "1px solid var(--fg-2)" }} /> 19 grouped · group-verb prefix</span>
        <span className="sd-legend-item"><Icon name="braces" size={12} /> 30 commands · CATEGORIES.md</span>
      </div>
    </div>
  );
}

/* F · /docs/flow — a real article page with the infographic embedded inline in the content. */
function FlowDocs() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Docs" />
        <div className="sd-body">
          <DocsSidebar active="flow" />
          <div className="sd-main">
            <div className="sd-main-scroll sd-canvas">
              <Breadcrumb trail={["Docs", "Learn", "Flow"]} />
              <div className="sd-doc" style={{ maxWidth: 944 }}>
                <h1 className="sd-h1">Flow lifecycle</h1>
                <p className="sd-lede">Thirty commands. Eleven run every feature cycle and stay one-word terse (<span className="sd-inline-code">plan</span>, <span className="sd-inline-code">execute</span>, <span className="sd-inline-code">done</span>, <span className="sd-inline-code">validate</span>). The rest belong to a group and wear it as a prefix.</p>
                <p className="sd-p">The loop is the whole idea — plan, execute, validate, done, release, then on to the next feature. Everything a cycle produces is written to <span className="sd-inline-code">.ai/</span>, next to the code, never only in a chat scroll.</p>

                <figure className="sd-fig">
                  <figcaption className="sd-fig-label"><Icon name="workflow" size={12} /> Figure 1 · the <span className="sd-mono">/flow:*</span> lifecycle</figcaption>
                  <FlowLoopDiagram />
                  <figcaption className="sd-fig-cap">Daily verbs carry an accent dot; each phase writes a durable artifact into <span className="sd-inline-code">.ai/</span>.</figcaption>
                </figure>

                <h2 className="sd-h2">Daily — the eleven verbs</h2>
                <p className="sd-p">The verbs you run every cycle stay one word: <span className="sd-inline-code">plan</span>, <span className="sd-inline-code">execute</span>, <span className="sd-inline-code">done</span>, <span className="sd-inline-code">validate</span>, <span className="sd-inline-code">status</span>, <span className="sd-inline-code">pause</span>, <span className="sd-inline-code">resume</span>, <span className="sd-inline-code">scenario</span>, <span className="sd-inline-code">quick</span>, <span className="sd-inline-code">release</span>, <span className="sd-inline-code">help</span>.</p>
                <div className="callout callout--info">
                  <Icon name="sparkle" size={16} className="sd-accent" />
                  <div style={{ fontSize: "var(--type-sm)" }}>The full grouped catalog lives in <span className="sd-inline-code">plugins/flow/CATEGORIES.md</span> — and one slash away as <span className="sd-inline-code">/flow:help</span>.</div>
                </div>

                <h2 className="sd-h2">What lands in .ai/</h2>
                <p className="sd-p">Every cycle writes durable artifacts next to the code — decisions to <span className="sd-inline-code">.ai/decisions/</span>, finished plans to <span className="sd-inline-code">.ai/plans/archive/</span>, and the running state to <span className="sd-inline-code">.ai/state/STATE.md</span>. Nothing important lives only in a chat scroll.</p>
              </div>
            </div>
          </div>
          <TocRail items={[{ label: "The loop" }, { label: "Daily verbs" }, { label: "What lands in .ai/" }]} active={0} />
        </div>
      </div>
    </Board>
  );
}

/* G · /changelog — combined What's New + Roadmap as one timeline (Shipped · Now · Next). */
const TIMELINE: { group: string; kind: "now" | "shipped" | "next"; items: { tag: string; title: string; date: string; bullets: string[] }[] }[] = [
  { group: "Now — in progress", kind: "now", items: [
    { tag: "Phase 25", title: "Draw-as-code geometry engine", date: "active", bullets: ["/design:draw + draw-agent", "deterministic SVG → JSX, single source"] },
    { tag: "design", title: "Studio Docs — docs-site redesign", date: "in design", bullets: ["docs rendered as the studio chrome", "embedded infographics + intro video v3"] },
  ] },
  { group: "Shipped", kind: "shipped", items: [
    { tag: "v0.28.1", title: "Per-canvas design-system tokens", date: "2026-06-04", bullets: ["UI canvas tokens resolve from meta.designSystem", "Studio app-shell canvas under the maude DS"] },
    { tag: "v0.23", title: "Canvas media", date: "Phase 23", bullets: ["drop / paste images onto the canvas", "paste a link → chip"] },
    { tag: "v0.18", title: "Marketplace-install self-heal", date: "Phase 19", bullets: ["dev-server bootstraps artifacts on first launch", "client bundle committed to git"] },
  ] },
  { group: "Next — planned", kind: "next", items: [
    { tag: "Phase 26", title: "Live multiplayer cursors · GA", date: "planned", bullets: ["presence on the shared canvas", "the AI agent gets its own cursor hue"] },
    { tag: "hub", title: "Managed invites + token scopes", date: "planned", bullets: ["rotate-as-kill-switch", "per-peer scope chips"] },
  ] },
];

function ChangelogRoadmap() {
  return (
    <Board>
      <div className="sd-shell">
        <DocsMenubar active="Roadmap" />
        <div className="sd-cr sd-canvas">
          <div className="sd-cr-inner">
            <div className="sd-cr-head">
              <div className="sd-cr-eyebrow"><Icon name="workflow" size={12} /> CHANGELOG · ROADMAP</div>
              <h1 className="sd-cr-h1">What shipped, what's next.</h1>
              <p className="sd-cr-sub">One timeline — releases, work in progress, and the plan. Generated from <span className="sd-inline-code">.ai/plans/</span> + <span className="sd-inline-code">whats-new.json</span>, never hand-kept.</p>
              <div className="sd-cr-controls">
                <div className="sd-cr-filter seg" role="tablist" aria-label="Filter timeline">
                  <button type="button" role="tab" aria-controls="sd-cr-timeline" aria-selected="true">All</button>
                  <button type="button" role="tab" aria-controls="sd-cr-timeline" aria-selected="false">Now</button>
                  <button type="button" role="tab" aria-controls="sd-cr-timeline" aria-selected="false">Shipped</button>
                  <button type="button" role="tab" aria-controls="sd-cr-timeline" aria-selected="false">Next</button>
                </div>
                <div className="sd-cr-dotlegend">
                  <span className="sd-legend-item"><span className="sd-cr-dot is-now" /> in progress</span>
                  <span className="sd-legend-item"><span className="sd-cr-dot is-shipped" /> shipped</span>
                  <span className="sd-legend-item"><span className="sd-cr-dot is-next" /> planned</span>
                </div>
              </div>
            </div>
            <div className="sd-tl" id="sd-cr-timeline" role="tabpanel">
              {TIMELINE.map((g) => (
                <div key={g.group}>
                  <div className="sd-tl-group">{g.group}</div>
                  {g.items.map((it) => (
                    <div key={it.title} className="sd-tl-item">
                      <span className={"sd-tl-dot is-" + g.kind} />
                      <div className="sd-tl-card">
                        <div className="sd-tl-cardhd">
                          <span className={"tag" + (g.kind === "now" ? " tag--accent" : "")}>{it.tag}</span>
                          <span className="sd-tl-title">{it.title}</span>
                          <span className="sd-tl-date">{it.date}</span>
                        </div>
                        <ul className="sd-tl-bullets">{it.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Board>
  );
}

/* ═══════════════════════════ canvas ═════════════════════════════════════════ */
export default function StudioDocs() {
  return (
    <DesignCanvas>
      <DCSection id="docs" title="Studio Docs — maude documentation" subtitle="MAUDE/DOCS · 7 artboards · dark studio + light reading inset">
        <DCArtboard id="landing" label="A · landing" width={1440} height={900}><Landing /></DCArtboard>
        <DCArtboard id="docs-home" label="B · docs · home" width={1440} height={900}><DocsHome /></DCArtboard>
        <DCArtboard id="article" label="C · docs · article (+ light inset)" width={1440} height={900}><Article /></DCArtboard>
        <DCArtboard id="command-ref" label="D · command reference" width={1440} height={900}><CommandRef /></DCArtboard>
        <DCArtboard id="search" label="E · ⌘K · search" width={1440} height={900}><SearchBoard /></DCArtboard>
        <DCArtboard id="flow-docs" label="F · docs · flow (embedded infographic)" width={1440} height={900}><FlowDocs /></DCArtboard>
        <DCArtboard id="changelog" label="G · changelog & roadmap" width={1440} height={900}><ChangelogRoadmap /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
