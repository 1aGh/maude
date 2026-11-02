/**
 * @canvas      Docs Infographics — maude diagram primitives · 8 documentation diagrams drawn in the maude DS · the visual spec for site/components/mdcc/diagrams/* (phase-17)
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   architecture-map | command-flow | loop-diagram | command-tree | file-tree | stat-panel | inspector-diagram | dev-server-schema
 * @brief       Infographic/diagram primitives canvas for the maude docs site (dogfooding the design plugin on our own docs). 8 artboards, one per diagram component, real maude data, mono part-number stamps, strict 1px hairline structure, one indigo accent per board.
 * @stack       React 19 · TSX · Bun.build · sibling Docs Infographics.css (every value a var(--*) token)
 * @history     .design/_history/ui-docs_infographics/
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). The big idea:
 * maude's own docs diagrams, drawn in maude's own instrument-panel language —
 * 1px hairlines, mono-first part-numbers, ONE indigo accent doing the focal job
 * per board, an oversized faint mono watermark bleeding behind each diagram. Calm,
 * dense, hairline-first. Tokens + shared component classes are self-imported so the
 * canvas renders in maude no matter which DS the host injects (Studio Docs prior).
 * Lifts the FlowLoopDiagram card/dot/accent vocabulary + thin-stroke icon set from
 * `Studio Docs.tsx`, and `.insp-row` / `.tree-row` / `.panel` / `.tag` from the maude
 * preview `_components.css`.
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Docs Infographics.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { ReactNode } from "react";

/* ───────────────────────────── Icon set ─────────────────────────────────────
 * Thin-stroke (1.4) geometric glyphs — lifted from the Studio Docs prior.
 * Decorative; every <Icon> is aria-hidden.
 * ──────────────────────────────────────────────────────────────────────────── */
const ICONS: Record<string, ReactNode> = {
  "arrow-right": (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  "arrow-left": (<><line x1="13" y1="8" x2="3.5" y2="8" /><polyline points="7 4.5 3.5 8 7 11.5" /></>),
  loop: (<><path d="M3 8a5 5 0 0 1 8.6-3.5L13 6" /><polyline points="13 2.5 13 6 9.5 6" /><path d="M13 8a5 5 0 0 1-8.6 3.5L3 10" /><polyline points="3 13.5 3 10 6.5 10" /></>),
  workflow: (<><rect x="2.5" y="2.5" width="4" height="4" rx="1" /><rect x="9.5" y="9.5" width="4" height="4" rx="1" /><path d="M6.5 4.5h3a2 2 0 0 1 2 2v3" /></>),
  server: (<><rect x="2.5" y="3" width="11" height="4" rx="1" /><rect x="2.5" y="9" width="11" height="4" rx="1" /><circle cx="5" cy="5" r="0.6" fill="currentColor" stroke="none" /><circle cx="5" cy="11" r="0.6" fill="currentColor" stroke="none" /></>),
  braces: (<><path d="M6 2.5C4.5 2.5 4.5 5 4.5 6S3 8 3 8s1.5 1 1.5 2 0 3.5 1.5 3.5" /><path d="M10 2.5C11.5 2.5 11.5 5 11.5 6S13 8 13 8s-1.5 1-1.5 2 0 3.5-1.5 3.5" /></>),
  layers: (<><polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" /><polyline points="2.2 9 8 12.3 13.8 9" /></>),
  terminal: (<><polyline points="3.5 5.5 6 8 3.5 10.5" /><line x1="8" y1="11" x2="12" y2="11" /></>),
  folder: <path d="M2.5 4.5h3.2l1.3 1.5h6.5v6.5a1 1 0 0 1-1 1H2.5z" />,
  cube: (<><polygon points="8 2.3 13.5 5.2 13.5 10.8 8 13.7 2.5 10.8 2.5 5.2" /><line x1="8" y1="2.3" x2="8" y2="13.7" /><line x1="2.5" y1="5.2" x2="8" y2="8" /><line x1="13.5" y1="5.2" x2="8" y2="8" /></>),
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  pointer: <path d="M4 3l8.5 4-3.6 1.1L7 12.5z" />,
  push: (<><line x1="8" y1="13" x2="8" y2="4" /><polyline points="4.5 7.5 8 4 11.5 7.5" /></>),
  rewind: (<><polyline points="8 4 4 8 8 12" /><polyline points="12 4 8 8 12 12" /></>),
  doc: (<><path d="M4 2h5l3 3v9H4z" /><polyline points="9 2 9 5 12 5" /></>),
};

function Icon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/* ─── Per-artboard root: pins the maude DS dark tokens + dotted backdrop ──────── */
function Board({ children }: { children: ReactNode }) {
  return (
    <div className="maude di-root" data-theme="dark">
      {children}
    </div>
  );
}

/* ─── Shared diagram frame — the recurring signature chrome ───────────────────
 * part# stamp (top-left, mono) · 1px hairline border · oversized faint mono
 * watermark bleeding behind · caption row at the bottom. One accent per board.
 * ──────────────────────────────────────────────────────────────────────────── */
function Frame({
  part,
  name,
  watermark,
  caption,
  children,
  bodyClass,
}: {
  part: string;
  name: string;
  watermark: string;
  caption: string;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <figure className="di-frame" aria-label={`${name} — ${caption}`}>
      <span className="di-frame-wm" aria-hidden="true">{watermark}</span>
      <header className="di-frame-stamp">
        <span className="di-frame-tick" aria-hidden="true" />
        <span className="di-frame-part">{part}</span>
        <span className="di-frame-name">{name}</span>
      </header>
      <div className={"di-frame-body" + (bodyClass ? " " + bodyClass : "")}>{children}</div>
      <figcaption className="di-frame-cap">{caption}</figcaption>
    </figure>
  );
}

/* ═══════════════════════ 1 · ArchitectureMap ════════════════════════════════ */
const AI_FILES = [
  { glyph: "├─", label: "state/STATE.md" },
  { glyph: "├─", label: "plans/" },
  { glyph: "├─", label: "decisions/" },
  { glyph: "└─", label: "workflows.config.json" },
];
const DESIGN_FILES = [
  { glyph: "├─", label: "config.json" },
  { glyph: "├─", label: "ui/" },
  { glyph: "├─", label: "system/" },
  { glyph: "└─", label: "_history/" },
];

function ArchitectureMap() {
  // Single coordinate system: the SVG arrow layer + the absolute boxes share the
  // 856×456 inner canvas, so the crossing accent arrows land on real anchors.
  return (
    <Frame part="MDCC-DGM/MAP" name="ArchitectureMap" watermark="MAP" caption="Claude Code · two plugins · the maude CLI · the .ai/ and .design/ workspaces">
      <div className="di-am">
        <svg className="di-am-wires" viewBox="0 0 856 456" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="am-accent" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M1 1.5 6.5 4.5 1 7.5" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {/* dotted leaders: maude CLI → each plugin */}
          <path className="di-am-leader" d="M566 96 H700" />
          <path className="di-am-leader" d="M566 116 C 640 116 660 116 700 108" />
          {/* crossing accent arrows: design → .design/, flow → .ai/ */}
          <path className="di-am-arc" d="M150 150 C 150 250 706 250 706 312" markerEnd="url(#am-accent)" />
          <path className="di-am-arc" d="M414 150 C 414 250 150 250 150 312" markerEnd="url(#am-accent)" />
        </svg>

        {/* Claude Code host shell */}
        <div className="di-am-shell">
          <div className="di-am-shell-hd">
            <Icon name="sparkle" size={13} className="di-am-shell-glyph" />
            <span className="di-am-shell-name">Claude Code</span>
            <span className="di-am-shell-sub">host shell · plugin marketplace</span>
          </div>
          <div className="di-am-tiles">
            <div className="di-am-tile">
              <div className="di-am-tile-hd"><Icon name="cube" size={13} /><span>/plugin design</span></div>
              <div className="di-am-tile-sku">MAUDE/PLG·DSN</div>
              <div className="di-am-tile-note">canvas-first TSX mocks</div>
            </div>
            <div className="di-am-tile">
              <div className="di-am-tile-hd"><Icon name="workflow" size={13} /><span>/plugin flow</span></div>
              <div className="di-am-tile-sku">MAUDE/PLG·FLW</div>
              <div className="di-am-tile-note">agentic .ai/ workspace loop</div>
            </div>
            <div className="di-am-cli">
              <Icon name="terminal" size={14} className="di-am-cli-glyph" />
              <span className="di-am-cli-name">maude</span>
              <span className="di-am-cli-sub">CLI · @1agh/maude</span>
            </div>
          </div>
        </div>

        {/* workspace folder cards */}
        <div className="di-am-cards">
          <div className="di-am-card" data-owner="flow">
            <div className="di-am-card-hd"><Icon name="folder" size={13} /><span className="di-mono">.ai/</span><span className="di-am-card-owner">owned by flow</span></div>
            <ul className="di-am-tree">
              {AI_FILES.map((f) => (
                <li key={f.label}><span className="di-am-glyph">{f.glyph}</span><span>{f.label}</span></li>
              ))}
            </ul>
          </div>
          <div className="di-am-card" data-owner="design">
            <div className="di-am-card-hd"><Icon name="folder" size={13} /><span className="di-mono">.design/</span><span className="di-am-card-owner">owned by design</span></div>
            <ul className="di-am-tree">
              {DESIGN_FILES.map((f) => (
                <li key={f.label}><span className="di-am-glyph">{f.glyph}</span><span>{f.label}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 2 · CommandFlow ════════════════════════════════════ */
const FLOW_STEPS = [
  { n: "01", command: "install", caption: "/plugin marketplace add 1aGh/maude" },
  { n: "02", command: "maude init", caption: "scaffold the .ai/ workspace" },
  { n: "03", command: "/flow:init", caption: "detect stack · fill config" },
  { n: "04", command: "ready", caption: "plan → execute → done" },
];

function CommandFlow() {
  return (
    <Frame part="MDCC-DGM/FLW" name="CommandFlow" watermark="FLW" caption="Four steps from a fresh repo to the first feature cycle" bodyClass="di-flow-body">
      <div className="di-flow">
        {FLOW_STEPS.map((s, i) => (
          <div key={s.command} className="di-flow-pair" style={{ display: "contents" }}>
            <div className={"di-flow-cell" + (i === FLOW_STEPS.length - 1 ? " is-last" : "")}>
              <span className="di-flow-num">{s.n}</span>
              <span className="di-flow-cmd">{s.command}</span>
              <span className="di-flow-cap">{s.caption}</span>
            </div>
            {i < FLOW_STEPS.length - 1 ? (
              <span className="di-flow-conn" aria-hidden="true"><Icon name="arrow-right" size={15} /></span>
            ) : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 3 · LoopDiagram ════════════════════════════════════ */
type LoopNode = { command: string; caption: string; active?: boolean };
const DESIGN_LOOP: LoopNode[] = [
  { command: "init", caption: "one-time" },
  { command: "setup-ds", caption: "design system" },
  { command: "new", caption: "scaffold canvas" },
  { command: "edit", caption: "iterate in place", active: true },
  { command: "critic", caption: "panel review" },
  { command: "handoff", caption: "ship to code" },
  { command: "repeat", caption: "next surface" },
];

function LoopDiagram() {
  const W = 540;
  const H = 540;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 188;
  const n = DESIGN_LOOP.length;
  const pts = DESIGN_LOOP.map((_, i) => {
    const theta = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + R * Math.cos(theta), y: cy + R * Math.sin(theta) };
  });
  // Arrowed arcs between consecutive nodes (i → i+1, closing 6 → 0). Endpoints
  // are pulled in by `gap` so the line clears each node card; a slight pull
  // toward the centre gives the arc its curve.
  const gap = 56;
  const arcs = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sx = p.x + ux * gap;
    const sy = p.y + uy * gap;
    const ex = q.x - ux * gap;
    const ey = q.y - uy * gap;
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const cmx = mx + (cx - mx) * 0.16;
    const cmy = my + (cy - my) * 0.16;
    const closing = i === n - 1;
    return { d: `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cmx.toFixed(1)} ${cmy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, closing };
  });

  return (
    <Frame part="MDCC-DGM/LP" name="LoopDiagram" watermark="LP" caption="The design canvas loop — edit is where you live; everything else bookends it" bodyClass="di-loop-body">
      <div className="di-loop" style={{ width: W, height: H }}>
        <svg className="di-loop-wires" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <marker id="lp-arrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M1 1.5 6.5 4.5 1 7.5" fill="none" stroke="var(--fg-2)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="lp-arrow-accent" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M1 1.5 6.5 4.5 1 7.5" fill="none" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {arcs.map((a, i) => (
            <path
              key={i}
              className={"di-loop-arc" + (a.closing ? " is-closing" : "")}
              d={a.d}
              markerEnd={a.closing ? "url(#lp-arrow-accent)" : "url(#lp-arrow)"}
            />
          ))}
        </svg>

        <div className="di-loop-hub">
          <Icon name="loop" size={16} className="di-accent" />
          <span className="di-loop-hub-title">canvas loop</span>
          <span className="di-loop-hub-sub">/design:*</span>
        </div>

        {DESIGN_LOOP.map((node, i) => (
          <div
            key={node.command}
            className={"di-loop-node" + (node.active ? " is-active" : "")}
            style={{ left: pts[i].x, top: pts[i].y }}
          >
            <span className="di-loop-node-cmd">{node.command}</span>
            <span className="di-loop-node-cap">{node.caption}</span>
            {node.active ? <span className="di-loop-node-flag">active</span> : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 4 · CommandTree ════════════════════════════════════ */
type TreeRow =
  | { kind: "group"; label: string; note: string }
  | { kind: "leaf"; glyph: string; label: string; last?: boolean };
const DESIGN_TREE: TreeRow[] = [
  { kind: "group", label: "setup.", note: "run once" },
  { kind: "leaf", glyph: "├─", label: "init" },
  { kind: "leaf", glyph: "├─", label: "setup-ds" },
  { kind: "leaf", glyph: "└─", label: "setup-docs", last: true },
  { kind: "group", label: "daily.", note: "the canvas loop" },
  { kind: "leaf", glyph: "├─", label: "new" },
  { kind: "leaf", glyph: "├─", label: "edit" },
  { kind: "leaf", glyph: "├─", label: "critic" },
  { kind: "leaf", glyph: "├─", label: "screenshot" },
  { kind: "leaf", glyph: "├─", label: "rollback" },
  { kind: "leaf", glyph: "└─", label: "browse", last: true },
  { kind: "group", label: "validate.", note: "regression" },
  { kind: "leaf", glyph: "└─", label: "smoke", last: true },
];

function CommandTree() {
  return (
    <Frame part="MDCC-DGM/TR" name="CommandTree" watermark="TR" caption="The /design: catalog — setup once, iterate daily, validate before ship">
      <div className="di-tree">
        <div className="di-tree-root"><Icon name="braces" size={13} className="di-accent" /><span className="di-mono">/design:</span></div>
        <ul className="di-tree-list">
          {DESIGN_TREE.map((row) =>
            row.kind === "group" ? (
              <li key={row.label} className="di-tree-group">
                <span className="di-tree-group-label">{row.label}</span>
                <span className="di-tree-group-note">{row.note}</span>
              </li>
            ) : (
              <li key={row.label} className="di-tree-leaf">
                <span className="di-tree-glyph" aria-hidden="true">{row.glyph}</span>
                <span className="di-tree-leaf-label">{row.label}</span>
              </li>
            )
          )}
        </ul>
        <div className="di-tree-foot"><span className="di-mono">42</span> commands across both plugins · grouped in CATEGORIES.md</div>
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 5 · FileTree ═══════════════════════════════════════ */
type FileRow = { depth: number; glyph: string; label: string; hint?: string; add?: boolean };
const AI_SKELETON: FileRow[] = [
  { depth: 0, glyph: "", label: ".ai/" },
  { depth: 1, glyph: "├─", label: "state/", hint: "STATE.md · HANDOFF.md" },
  { depth: 1, glyph: "├─", label: "plans/", hint: "+ archive/" },
  { depth: 1, glyph: "├─", label: "decisions/", hint: "DDR-NNN-*.md" },
  { depth: 1, glyph: "├─", label: "scenarios/" },
  { depth: 1, glyph: "├─", label: "logs/", hint: "retros · reviews" },
  { depth: 1, glyph: "└─", label: "workflows.config.json", hint: "← the only file you usually edit", add: true },
];

function FileTree() {
  return (
    <Frame part="MDCC-DGM/FT" name="FileTree" watermark="FT" caption="The .ai/ skeleton maude init writes — one highlighted file is the one you touch">
      <div className="di-ft">
        {AI_SKELETON.map((r) => (
          <div
            key={r.label}
            className={"di-ft-row" + (r.add ? " is-add" : "") + (r.depth === 0 ? " is-root" : "")}
            style={{ paddingLeft: `calc(var(--space-3) + ${r.depth} * var(--space-6))` }}
          >
            <span className="di-ft-name">
              {r.glyph ? <span className="di-ft-glyph" aria-hidden="true">{r.glyph}</span> : null}
              <span className="di-ft-label">{r.label}</span>
            </span>
            {r.hint ? <span className="di-ft-hint">{r.hint}</span> : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 6 · StatPanel ══════════════════════════════════════ */
const STATS = [
  { value: "42", label: "commands", hint: "design + flow" },
  { value: "11", label: "critics", hint: "panel agents" },
  { value: "2", label: "plugins", hint: "design · flow" },
  { value: "1", label: "CLI", hint: "@1agh/maude" },
  { value: "0", label: "telemetry", hint: "by design" },
];

function StatPanel() {
  return (
    <Frame part="MDCC-DGM/STT" name="StatPanel" watermark="STT" caption="The catalog at a glance — number-driven from build-stats" bodyClass="di-stat-body">
      <div className="di-stat">
        {STATS.map((c) => (
          <div key={c.label} className="di-stat-cell">
            <span className="di-stat-val">{c.value}</span>
            <span className="di-stat-label">{c.label}</span>
            <span className="di-stat-hint">{c.hint}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 7 · InspectorDiagram ═══════════════════════════════ */
function InspectorDiagram() {
  return (
    <Frame part="MDCC-DGM/INS" name="InspectorDiagram" watermark="INS" caption="Cmd+Click an element → it persists to _active.json → the next /design:edit reads it">
      <div className="di-ins">
        {/* stylized canvas iframe */}
        <div className="di-ins-browser">
          <div className="di-ins-chrome">
            <span className="di-ins-dot" /><span className="di-ins-dot" /><span className="di-ins-dot" />
            <span className="di-ins-url"><Icon name="server" size={11} /> localhost:4711</span>
          </div>
          <div className="di-ins-stage">
            <div className="di-ins-art">A · hero</div>
            <div className="di-ins-art is-target">
              B · pricing
              <span className="di-ins-el">
                <span className="di-ins-halo" aria-hidden="true" />
                <span className="di-ins-halo-ring" aria-hidden="true" />
                plan card
              </span>
            </div>
            <div className="di-ins-art">C · footer</div>
          </div>
        </div>
        {/* leader-line annotations */}
        <ul className="di-ins-notes">
          <li><span className="di-ins-tick" aria-hidden="true" /><Icon name="pointer" size={12} className="di-accent" /> <span className="di-mono">Cmd+Click</span> the element</li>
          <li><span className="di-ins-tick" aria-hidden="true" /><Icon name="push" size={12} /> selection persists to <span className="di-mono">_active.json</span></li>
          <li><span className="di-ins-tick" aria-hidden="true" /><Icon name="terminal" size={12} /> <span className="di-mono">/design:edit</span> reads from here</li>
        </ul>
      </div>
    </Frame>
  );
}

/* ═══════════════════════ 8 · DevServerSchema ════════════════════════════════ */
type SchemaKey = { key: string; type: string };
const SCHEMA: { file: string; icon: string; keys: SchemaKey[] }[] = [
  { file: "_server.json", icon: "server", keys: [
    { key: "pid", type: "number" },
    { key: "port", type: "number" },
    { key: "url", type: "string" },
    { key: "started", type: "iso-8601" },
  ] },
  { file: "_active.json", icon: "pointer", keys: [
    { key: "active", type: "path" },
    { key: "open_tabs", type: "path[]" },
    { key: "selected", type: "element | null" },
    { key: "last_change", type: "iso-8601" },
  ] },
  { file: "_history/<slug>/", icon: "layers", keys: [
    { key: "000-envelope.md", type: "brief" },
    { key: "NNN-screen-*.png", type: "snapshot" },
    { key: "chat.md", type: "transcript" },
  ] },
];
const SCHEMA_FLOW = [
  { label: "server writes", icon: "server" },
  { label: "inspector pushes", icon: "push" },
  { label: "rollback reads", icon: "rewind" },
];

function DevServerSchema() {
  return (
    <Frame part="MDCC-DGM/SRV" name="DevServerSchema" watermark="SRV" caption="Three files, one contract — the dev-server writes them, slash commands read them">
      <div className="di-schema">
        <div className="di-schema-panels">
          {SCHEMA.map((p) => (
            <div key={p.file} className="di-schema-panel">
              <div className="di-schema-hd"><Icon name={p.icon} size={12} /><span className="di-mono">{p.file}</span></div>
              <ul className="di-schema-rows">
                {p.keys.map((k) => (
                  <li key={k.key} className="di-schema-row">
                    <span className="di-schema-key">{k.key}</span>
                    <span className="di-schema-type">{k.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="di-schema-flow" aria-hidden="true">
          {SCHEMA_FLOW.map((f, i) => (
            <div key={f.label} className="di-schema-flow-pair" style={{ display: "contents" }}>
              <span className="di-schema-flow-step">
                <Icon name={f.icon} size={12} className={i === 0 ? "di-accent" : undefined} />
                {f.label}
              </span>
              {i < SCHEMA_FLOW.length - 1 ? <Icon name="arrow-right" size={13} className="di-schema-flow-arrow" /> : null}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ═══════════════════════════ canvas ═════════════════════════════════════════ */
export default function DocsInfographics() {
  return (
    <DesignCanvas>
      <DCSection
        id="diagrams"
        title="Docs Infographics — maude diagram primitives"
        subtitle="MDCC·DGM · 8 components · dark studio default"
      >
        <DCArtboard id="architecture-map" label="A · MDCC-DGM/MAP · ArchitectureMap" width={920} height={560}>
          <Board><ArchitectureMap /></Board>
        </DCArtboard>
        <DCArtboard id="command-flow" label="B · MDCC-DGM/FLW · CommandFlow" width={900} height={320}>
          <Board><CommandFlow /></Board>
        </DCArtboard>
        <DCArtboard id="loop-diagram" label="C · MDCC-DGM/LP · LoopDiagram" width={680} height={620}>
          <Board><LoopDiagram /></Board>
        </DCArtboard>
        <DCArtboard id="command-tree" label="D · MDCC-DGM/TR · CommandTree" width={640} height={560}>
          <Board><CommandTree /></Board>
        </DCArtboard>
        <DCArtboard id="file-tree" label="E · MDCC-DGM/FT · FileTree" width={680} height={520}>
          <Board><FileTree /></Board>
        </DCArtboard>
        <DCArtboard id="stat-panel" label="F · MDCC-DGM/STT · StatPanel" width={940} height={208}>
          <Board><StatPanel /></Board>
        </DCArtboard>
        <DCArtboard id="inspector-diagram" label="G · MDCC-DGM/INS · InspectorDiagram" width={840} height={560}>
          <Board><InspectorDiagram /></Board>
        </DCArtboard>
        <DCArtboard id="dev-server-schema" label="H · MDCC-DGM/SRV · DevServerSchema" width={980} height={540}>
          <Board><DevServerSchema /></Board>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
