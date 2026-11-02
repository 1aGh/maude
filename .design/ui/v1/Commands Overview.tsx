/**
 * @canvas      commands-overview · Two parallel diagram-flow visualizations of the maude commandscape — /flow:* and /design:* — one for dependency subtrees (USER → command → spawned subs/agents/skills), one for side-effects (producer command → state file → consumer commands).
 * @ds          project
 * @platform    desktop
 * @opt_out     palette
 * @artboards   legend | flow-dep-graph | flow-sideeffects-flow | design-dep-graph | design-sideeffects-flow
 * @brief       Commands overview canvas — diagram-flow visualization of what runs how and what creates what and where. Flow + design separately, no tables, Sugiyama-style layered DAG.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline
 * @history     .design/_history/commands-overview/
 * @handoff     (not authored for handoff — internal docs reference canvas)
 */

import "./Commands Overview.css";
import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

/* ───────────────────────────────────────────────────────────────────── *
 *  commands-overview / MDCC-DGM                                         *
 *                                                                       *
 *  Five artboards. Static print-aesthetic Sugiyama DAGs + producer-     *
 *  consumer flows. No tables (user veto). One accent per diagram.       *
 *  Lifts: AbHd + DiagramFrame chrome from docs-infographics iter-3.     *
 *  New primitives: NodeCmd / NodeUser / NodeAgent / NodeSkill /         *
 *  NodeFile / EdgeSpawn / EdgeRead / EdgeWrite. Shared across all 5.    *
 * ───────────────────────────────────────────────────────────────────── */

const VER = "v0.17.2";

// ─── Shared per-artboard header strip (lifted from docs-infographics) ─
function AbHd({ sku, label, sub }: { sku: string; label: string; sub?: string }) {
  return (
    <div className="ab-hd" role="presentation">
      <span className="lead">
        <b>{sku}</b> · {label}
      </span>
      <span className="right">
        {sub ? <span>{sub}</span> : null}
        <span className="ok" aria-label="theme paper-light">
          <span className="glyph" aria-hidden="true">●</span> LIGHT
        </span>
        <span>{VER}</span>
      </span>
    </div>
  );
}

// ─── Shared diagram-frame wrapper (lifted from docs-infographics) ────
function DiagramFrame({
  sku,
  caption,
  children,
}: {
  sku: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure
      className="dgm-frame"
      data-dc-element={`diagram-${sku.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
    >
      <div className="dgm-frame-hd">
        <span className="sku">{sku}</span>
        <span className="dgm-frame-ver">{VER}</span>
      </div>
      <div className="dgm-frame-bd">{children}</div>
      <figcaption className="dgm-frame-ft">{caption}</figcaption>
    </figure>
  );
}

/* ───────────────────────────────────────────────────────────────────── *
 *  SVG node + edge primitives                                           *
 *  Geometry stays inline (positions computed per artboard). These       *
 *  components only handle shape + class hooks (which the CSS styles).   *
 * ───────────────────────────────────────────────────────────────────── */

// User-callable entry-point. Bold rectangle, letter-spaced label.
// `slug` artboard-scopes the data-dc-element so the inspector + critics can
// disambiguate across the three artboards that render a USER node.
function NodeUser({ x, y, w = 100, h = 36, slug = "default" }: { x: number; y: number; w?: number; h?: number; slug?: string }) {
  return (
    <g className="dgm-node-user" data-dc-element={`node-user-${slug}`}>
      <rect x={x} y={y} width={w} height={h} />
      <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" fontSize="13">USER</text>
    </g>
  );
}

// Command node. Rectangle. `hub` adds accent border + highlight on label.
function NodeCmd({
  x,
  y,
  w = 144,
  h = 44,
  cmd,
  sub,
  hub,
  star,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  cmd: string;
  sub?: string;
  hub?: boolean;
  star?: 1 | 2;
}) {
  return (
    <g className={hub ? "dgm-node-cmd-hub" : "dgm-node-cmd"} data-dc-element={`node-cmd-${cmd.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <rect x={x} y={y} width={w} height={h} />
      <text x={x + w / 2} y={y + (sub ? 18 : h / 2 + 4)} textAnchor="middle" fontSize="12" className="cmd" fontWeight="700">
        {cmd}
        {star ? <tspan dx="6" fill="var(--accent-active)">{"★".repeat(star)}</tspan> : null}
      </text>
      {sub ? (
        <text x={x + w / 2} y={y + 34} textAnchor="middle" fontSize="10" fill="var(--fg-1)">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

// Subagent. Ellipse, italic label.
function NodeAgent({
  cx,
  cy,
  rx = 70,
  ry = 18,
  label,
}: {
  cx: number;
  cy: number;
  rx?: number;
  ry?: number;
  label: string;
}) {
  return (
    <g className="dgm-node-agent" data-dc-element={`node-agent-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11">
        {label}
      </text>
    </g>
  );
}

// Skill invocation. Dashed-border rectangle.
function NodeSkill({
  x,
  y,
  w = 152,
  h = 32,
  label,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
}) {
  return (
    <g className="dgm-node-skill" data-dc-element={`node-skill-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <rect x={x} y={y} width={w} height={h} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize="11">
        {label}
      </text>
    </g>
  );
}

// File / state-folder. Hexagon (drawn as path).
function NodeFile({
  cx,
  cy,
  w = 168,
  h = 40,
  path,
  role,
  hub,
}: {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  path: string;
  role?: string;
  hub?: boolean;
}) {
  const hw = w / 2;
  const hh = h / 2;
  const notch = 10;
  const points = [
    `${cx - hw + notch},${cy - hh}`,
    `${cx + hw - notch},${cy - hh}`,
    `${cx + hw},${cy}`,
    `${cx + hw - notch},${cy + hh}`,
    `${cx - hw + notch},${cy + hh}`,
    `${cx - hw},${cy}`,
  ].join(" ");
  return (
    <g className={hub ? "dgm-node-file-hub" : "dgm-node-file"} data-dc-element={`node-file-${path.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <polygon points={points} />
      <text x={cx} y={cy + (role ? -2 : 5)} textAnchor="middle" fontSize="11" className="path">
        {path}
      </text>
      {role ? (
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="var(--fg-1)" letterSpacing="1">
          {role}
        </text>
      ) : null}
    </g>
  );
}

// Edge primitives. Use SVG markers (defined per-artboard, shared marker ids by suffix).
type EdgeProps = { x1: number; y1: number; x2: number; y2: number; curve?: number; markerId?: string };

function pathFor({ x1, y1, x2, y2, curve = 0 }: Omit<EdgeProps, "markerId">) {
  if (curve === 0) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + curve;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

function EdgeSpawn({ x1, y1, x2, y2, curve, markerId, hub }: EdgeProps & { hub?: boolean }) {
  return (
    <path
      className={hub ? "edge-spawn-hub" : "edge-spawn"}
      d={pathFor({ x1, y1, x2, y2, curve })}
      markerEnd={markerId ? `url(#${markerId})` : undefined}
    />
  );
}

function EdgeRead({ x1, y1, x2, y2, curve, markerId }: EdgeProps) {
  return (
    <path
      className="edge-read"
      d={pathFor({ x1, y1, x2, y2, curve })}
      markerEnd={markerId ? `url(#${markerId})` : undefined}
    />
  );
}

function EdgeWrite({ x1, y1, x2, y2, curve, markerId }: EdgeProps) {
  return (
    <path
      className="edge-write"
      d={pathFor({ x1, y1, x2, y2, curve })}
      markerEnd={markerId ? `url(#${markerId})` : undefined}
    />
  );
}

// Self-loop / cycle indicator. Single primitive used by both the
// utils-verify retry loop and the /design:edit snapshot-edit-recritic cycle.
// `d` is an explicit SVG path so callers can hand-tune the curl geometry.
function EdgeLoop({ d, markerId }: { d: string; markerId?: string }) {
  return (
    <path
      className="edge-loop"
      d={d}
      markerEnd={markerId ? `url(#${markerId})` : undefined}
    />
  );
}

// Marker defs reused across artboards. Define once per <svg>.
function ArrowMarkers({ idSuffix }: { idSuffix: string }) {
  return (
    <defs>
      <marker
        id={`mk-spawn-${idSuffix}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-1)" />
      </marker>
      <marker
        id={`mk-spawn-hub-${idSuffix}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
      </marker>
      <marker
        id={`mk-write-${idSuffix}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
      </marker>
      <marker
        id={`mk-read-${idSuffix}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-1)" />
      </marker>
    </defs>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Artboard 1 · Legend                                                  *
 *  One canvas. Four shapes. Three arrow styles.                         *
 * ═════════════════════════════════════════════════════════════════════ */

function AbLegend() {
  return (
    <div className="mdcc ab-cmdo" data-theme="light">
      <AbHd sku="MDCC-DGM/LEG" label="Legend" sub="taxonomy · 4 shapes · 3 edges" />
      <DiagramFrame sku="MDCC-DGM/LEG" caption="One canvas. Four shapes. Three arrow styles. Read the rest in that grammar.">
        <svg viewBox="0 0 1180 700" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Legend of node shapes and edge styles used across all artboards: rectangle command, ellipse agent, dashed-border skill, hexagon file; solid spawn arrow, dashed read arrow, accent write arrow. Branded MDCC — Maude command catalog.">
          <ArrowMarkers idSuffix="leg" />

          {/* ── Brand wordmark — opens the canvas with mark presence ── */}
          <g data-dc-element="brand-wordmark">
            <text x="40" y="48" fontSize="40" fontWeight="700" fill="var(--fg-0)" letterSpacing="-1">maude</text>
            <text x="180" y="48" fontSize="40" fontWeight="700" fill="var(--accent)" letterSpacing="-1">/</text>
            <text x="200" y="48" fontSize="40" fontWeight="700" fill="var(--accent-active)" letterSpacing="-1">cmd-cat</text>
            <text x="40" y="68" fontSize="11" fill="var(--fg-1)" letterSpacing="2">MDCC-DGM/LEG · COMMAND CATALOG · v0.17.2</text>
            <line x1="40" y1="86" x2="1140" y2="86" stroke="var(--border-strong)" strokeWidth="1" />
          </g>

          {/* ── Row title: NODE SHAPES ── */}
          <text x="40" y="118" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">MDCC-DGM/LEG.NODE</text>
          <text x="40" y="138" fontSize="16" fill="var(--fg-0)" fontWeight="700">Node shapes — by role</text>
          <line x1="40" y1="152" x2="1140" y2="152" stroke="var(--border-strong)" strokeWidth="1" />

          {/* USER */}
          <NodeUser x={70} y={180} w={140} h={48} slug="legend" />
          <text x="140" y="256" textAnchor="middle" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">USER ENTRY</text>
          <text x="140" y="272" textAnchor="middle" fontSize="10" fill="var(--fg-1)">bold rectangle · top of every DAG</text>

          {/* Command */}
          <NodeCmd x={290} y={180} w={180} h={48} cmd="/flow:execute" sub="user-callable command" />
          <text x="380" y="256" textAnchor="middle" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">COMMAND</text>
          <text x="380" y="272" textAnchor="middle" fontSize="10" fill="var(--fg-1)">rectangle · accent border = hub</text>

          {/* Agent */}
          <NodeAgent cx={580} cy={204} rx={92} ry={24} label="security-auditor" />
          <text x="580" y="256" textAnchor="middle" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">SUBAGENT</text>
          <text x="580" y="272" textAnchor="middle" fontSize="10" fill="var(--fg-1)">ellipse · italic label · spawned</text>

          {/* Skill */}
          <NodeSkill x={720} y={180} w={188} h={48} label="Skill(claude-md-keeper)" />
          <text x="814" y="256" textAnchor="middle" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">SKILL</text>
          <text x="814" y="272" textAnchor="middle" fontSize="10" fill="var(--fg-1)">dashed border · plugin skill call</text>

          {/* File */}
          <NodeFile cx={1010} cy={204} w={196} h={48} path=".ai/state/STATE.md" role="STATE FILE" />
          <text x="1010" y="256" textAnchor="middle" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">FILE / FOLDER</text>
          <text x="1010" y="272" textAnchor="middle" fontSize="10" fill="var(--fg-1)">hexagon · accent border = hub</text>

          {/* ── Row title: EDGE STYLES ── */}
          <text x="40" y="346" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">MDCC-DGM/LEG.EDGE</text>
          <text x="40" y="366" fontSize="16" fill="var(--fg-0)" fontWeight="700">Edge styles — by relationship</text>
          <line x1="40" y1="380" x2="1140" y2="380" stroke="var(--border-strong)" strokeWidth="1" />

          {/* Edge 1 — spawn */}
          <text x="40" y="420" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">SPAWNS</text>
          <EdgeSpawn x1={150} y1={428} x2={420} y2={428} markerId="mk-spawn-leg" />
          <text x="440" y="432" fontSize="12" fill="var(--fg-0)">solid line · parent command runs the child synchronously or fans out a subagent</text>

          {/* Edge 2 — read */}
          <text x="40" y="466" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">READS</text>
          <EdgeRead x1={150} y1={474} x2={420} y2={474} markerId="mk-read-leg" />
          <text x="440" y="478" fontSize="12" fill="var(--fg-0)">dashed line · command reads file as input (resume from HANDOFF.md, replay from cache)</text>

          {/* Edge 3 — write */}
          <text x="40" y="512" fontSize="11" fill="var(--fg-1)" letterSpacing="1.5">WRITES</text>
          <EdgeWrite x1={150} y1={520} x2={420} y2={520} markerId="mk-write-leg" />
          <text x="440" y="524" fontSize="12" fill="var(--fg-0)">accent line · command produces or mutates the file as a side effect</text>

          {/* ── Hub marker ── */}
          <text x="40" y="580" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">MDCC-DGM/LEG.HUB</text>
          <text x="40" y="604" fontSize="14" fill="var(--fg-0)">
            <tspan fill="var(--accent)" fontWeight="700">★</tspan> marks a fan-out hub — one node, ≥ 3 outgoing edges.
            <tspan dx="12" fill="var(--accent)" fontWeight="700">★★</tspan> marks the canonical hub of its plugin.
          </text>

          {/* ── Decorative right-side: example hub mini ── */}
          <g transform="translate(820, 430)">
            <NodeCmd x={0} y={0} w={120} h={40} cmd="/flow:done" hub star={2} />
            <EdgeSpawn x1={60} y1={40} x2={-10} y2={130} curve={-20} markerId="mk-spawn-leg" hub />
            <EdgeSpawn x1={60} y1={40} x2={60} y2={130} markerId="mk-spawn-leg" hub />
            <EdgeSpawn x1={60} y1={40} x2={130} y2={130} curve={-20} markerId="mk-spawn-leg" hub />
            <EdgeSpawn x1={60} y1={40} x2={210} y2={130} curve={-30} markerId="mk-spawn-leg" hub />
            <rect x={-50} y={130} width={70} height={28} fill="var(--bg-1)" stroke="var(--border-strong)" strokeWidth="1" />
            <text x={-15} y={148} textAnchor="middle" fontSize="10" fill="var(--fg-1)">validate</text>
            <rect x={30} y={130} width={70} height={28} fill="var(--bg-1)" stroke="var(--border-strong)" strokeWidth="1" />
            <text x={65} y={148} textAnchor="middle" fontSize="10" fill="var(--fg-1)">review-code</text>
            <rect x={110} y={130} width={70} height={28} fill="var(--bg-1)" stroke="var(--border-strong)" strokeWidth="1" />
            <text x={145} y={148} textAnchor="middle" fontSize="10" fill="var(--fg-1)">record-ddr</text>
            <rect x={190} y={130} width={70} height={28} fill="var(--bg-1)" stroke="var(--border-strong)" strokeWidth="1" />
            <text x={225} y={148} textAnchor="middle" fontSize="10" fill="var(--fg-1)">changelog</text>
            <text x={100} y={185} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">SAMPLE FAN-OUT · 1 → 4</text>
          </g>
        </svg>

        {/* sr-only mirror */}
        <table className="sr-only">
          <caption>Visual taxonomy used across the commands overview canvas</caption>
          <thead><tr><th>Glyph</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>Bold rectangle labeled USER</td><td>User entry point at the top of every dependency graph.</td></tr>
            <tr><td>Rectangle with command name</td><td>User-callable command. Accent border denotes a fan-out hub.</td></tr>
            <tr><td>Ellipse with italic label</td><td>Subagent spawned by the parent command.</td></tr>
            <tr><td>Dashed-border rectangle</td><td>Plugin skill invocation.</td></tr>
            <tr><td>Hexagon</td><td>File or folder produced or consumed by commands.</td></tr>
            <tr><td>Solid arrow</td><td>Parent command spawns the child.</td></tr>
            <tr><td>Dashed arrow</td><td>Command reads the file as input.</td></tr>
            <tr><td>Accent solid arrow</td><td>Command writes or mutates the file.</td></tr>
            <tr><td>Star</td><td>Fan-out hub: one node, three or more outgoing edges. Double star marks the canonical hub of its plugin.</td></tr>
          </tbody>
        </table>
      </DiagramFrame>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Artboard 2 · Flow dependency subtree                                 *
 *  30+ commands · /flow:done as fan-out hub (★★)                        *
 * ═════════════════════════════════════════════════════════════════════ */

function AbFlowDep() {
  // Rank 1 hub command positions (selected: the 6 that have meaningful spawns).
  const r1Y = 150;
  const r1 = [
    { x: 80, cmd: "/flow:init" },
    { x: 250, cmd: "/flow:setup-prd", sub: "PRD + plan seed" },
    { x: 420, cmd: "/flow:plan", sub: "feature plan" },
    { x: 590, cmd: "/flow:execute", sub: "★ inner loop", hub: true, star: 1 as const },
    { x: 780, cmd: "/flow:done", sub: "★★ fan-out hub", hub: true, star: 2 as const },
    { x: 990, cmd: "/flow:pause", sub: "→ resume" },
  ];

  return (
    <div className="mdcc ab-cmdo" data-theme="light">
      <AbHd sku="MDCC-DGM/FLW-DEP" label="Flow · dependency subtree" sub="30+ commands · 2 hubs · 1 inner loop" />
      <DiagramFrame sku="MDCC-DGM/FLW-DEP" caption="Thirty commands. One fan-out hub. The rest are leaves. (Verbatim from phase-17 Appendix A.)">
        <svg viewBox="0 0 1180 620" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Flow plugin dependency subtree, layered Sugiyama DAG. USER at top, six representative commands at rank 1, spawns at rank 2, leaf side-effects at rank 3. /flow:done is the fan-out hub spawning validate, review-code, record-ddr, release-changelog, record-retro and Skill(ddr-keeper).">
          <ArrowMarkers idSuffix="fldep" />

          {/* ── Rank 0: USER ── */}
          <NodeUser x={540} y={36} w={100} h={36} slug="flow-dep" />
          <text x="40" y="58" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 0</text>

          {/* USER → each rank-1 hub. Curve=0 keeps the 6 fan-out lines as straight
              rays from USER instead of bowing init/pause upward (iter-2 design-critic). */}
          {r1.map((c) => (
            <EdgeSpawn
              key={`u-${c.cmd}`}
              x1={590}
              y1={72}
              x2={c.x + 72}
              y2={r1Y}
              markerId="mk-spawn-fldep"
            />
          ))}

          {/* ── Rank 1: 6 hub commands ── */}
          <text x="40" y={r1Y + 10} fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 1</text>
          {r1.map((c) => (
            <NodeCmd key={`r1-${c.cmd}`} x={c.x} y={r1Y} w={144} cmd={c.cmd} sub={c.sub} hub={c.hub} star={c.star} />
          ))}

          {/* Note: 24 more leaf commands grouped */}
          <g transform="translate(40, 240)">
            <rect x={0} y={0} width={210} height={64} className="dgm-subgraph" />
            <text x={8} y={14} fontSize="9" fill="var(--fg-1)" letterSpacing="2">LEAVES · 24 MORE</text>
            <text x={8} y={30} fontSize="10" fill="var(--fg-1)">status · setup-context · codebase-map</text>
            <text x={8} y={44} fontSize="10" fill="var(--fg-1)">quick · resume · validate-a11y · -visual</text>
            <text x={8} y={58} fontSize="10" fill="var(--fg-1)">bug-rca · bug-fix · scenario · release · …</text>
          </g>

          {/* ── Rank 2: /flow:execute spawns ── */}
          <text x="40" y="350" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 2</text>

          {/* execute → utils-verify (with retry loop arrow) */}
          <EdgeSpawn x1={662} y1={194} x2={460} y2={336} curve={20} markerId="mk-spawn-fldep" />
          <NodeCmd x={388} y={336} w={144} cmd="/flow:utils-verify" sub="max 3× retry" />
          {/* retry loop: routed via EdgeLoop primitive (shared with /design:edit cycle) */}
          <EdgeLoop d="M 388 358 Q 360 340 360 320 Q 360 300 388 318" markerId="mk-read-fldep" />
          <text x={324} y={300} fontSize="9" fill="var(--fg-1)" letterSpacing="1">
            <tspan aria-hidden="true">↻ </tspan>EDIT-VERIFY
          </text>

          {/* execute → /design:smoke */}
          <EdgeSpawn x1={662} y1={194} x2={620} y2={336} markerId="mk-spawn-fldep" />
          <NodeCmd x={548} y={336} w={144} cmd="/design:smoke" sub="DDR-021 trigger" />

          {/* execute → code-simplifier agent */}
          <EdgeSpawn x1={662} y1={194} x2={750} y2={336} curve={-15} markerId="mk-spawn-fldep" />
          <NodeAgent cx={750} cy={350} rx={68} ry={16} label="code-simplifier" />

          {/* execute writes STATE.md */}
          <EdgeWrite x1={734} y1={194} x2={950} y2={336} curve={-40} markerId="mk-write-fldep" />
          <NodeFile cx={950} cy={350} w={172} h={36} path=".ai/state/STATE.md" role="STATUS · CHECKPOINTS" />

          {/* ── /flow:done fan-out (the signature moment) ── */}
          {/* done → validate, review-code, record-ddr, release-changelog, record-retro, Skill(ddr-keeper) */}
          {/* Sugiyama fix: routed via a virtual waypoint at y=402 (between rank 2 + 3) */}
          {/* so the arcs visibly clear the rank-2 strip instead of passing through nodes. */}
          {/* All hub edges (accent). */}
          <path d="M 852 194 L 852 402 L 250 402 L 250 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          <path d="M 852 194 L 852 402 L 420 402 L 420 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          <path d="M 852 194 L 852 402 L 600 402 L 600 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          <path d="M 852 194 L 852 402 L 780 402 L 780 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          <path d="M 852 194 L 852 402 L 960 402 L 960 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          <path d="M 852 194 L 852 402 L 1110 402 L 1110 446" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-fldep)" />
          {/* The y=402 bus-line that the 6 hub edges ride — visual anchor */}
          <text x={862} y={398} fontSize="9" fill="var(--accent-active)" letterSpacing="2">/flow:done FAN-OUT BUS</text>

          {/* ── Rank 3: /flow:done branches ── */}
          <text x="40" y="460" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 3</text>

          <NodeCmd x={178} y={446} w={144} cmd="/flow:validate" sub="5-agent fan-out" hub />
          <NodeCmd x={348} y={446} w={144} cmd="/flow:review-code" sub="security + simplify" />
          <NodeCmd x={528} y={446} w={144} cmd="/flow:record-ddr" sub="per decision" />
          <NodeCmd x={708} y={446} w={144} cmd="/flow:release-changelog" sub="→ .changeset/*" />
          <NodeCmd x={888} y={446} w={144} cmd="/flow:record-retro" sub="lessons" />
          <NodeSkill x={1052} y={448} w={120} h={40} label="Skill(ddr-keeper)" />

          {/* validate → its sub-agents (small cluster below) */}
          <EdgeSpawn x1={250} y1={490} x2={140} y2={560} curve={10} markerId="mk-spawn-fldep" />
          <EdgeSpawn x1={250} y1={490} x2={260} y2={560} markerId="mk-spawn-fldep" />
          <EdgeSpawn x1={250} y1={490} x2={380} y2={560} curve={-10} markerId="mk-spawn-fldep" />
          <NodeAgent cx={140} cy={576} rx={64} ry={14} label="security-auditor" />
          <NodeAgent cx={260} cy={576} rx={60} ry={14} label="ethical-hacker" />
          <NodeAgent cx={380} cy={576} rx={56} ry={14} label="scenario-runner" />

          {/* legend strip · bottom-right */}
          <g transform="translate(880, 552)">
            <text x={0} y={0} fontSize="9" fill="var(--fg-1)" letterSpacing="2">EDGES</text>
            <line x1={0} y1={14} x2={30} y2={14} className="edge-spawn-hub" />
            <text x={36} y={18} fontSize="10" fill="var(--fg-1)">hub spawn</text>
            <line x1={110} y1={14} x2={140} y2={14} className="edge-write" />
            <text x={146} y={18} fontSize="10" fill="var(--fg-1)">writes file</text>
            <line x1={210} y1={14} x2={240} y2={14} className="edge-read" />
            <text x={246} y={18} fontSize="10" fill="var(--fg-1)">retry / read</text>
          </g>
        </svg>

        <table className="sr-only">
          <caption>Flow plugin dependency subtree</caption>
          <thead><tr><th>Parent</th><th>Spawns</th></tr></thead>
          <tbody>
            <tr><td>USER</td><td>30+ flow commands. Six shown as hubs (init, setup-prd, plan, execute, done, pause). The remaining 24 are leaves: status, setup-context, setup-codebase-map, quick, resume, validate-a11y, validate-visual, bug-rca, bug-fix, scenario, release, record-execution, video-new-scene, maintain-ai-health, maintain-clean, maintain-discover, maintain-docs, help, plus the spawned sub-commands that show in their own rank below.</td></tr>
            <tr><td>/flow:execute</td><td>/flow:utils-verify (with up to 3 retries), /design:smoke (DDR-021 trigger), code-simplifier subagent. Writes STATE.md.</td></tr>
            <tr><td>/flow:done</td><td>/flow:validate, /flow:review-code, /flow:record-ddr, /flow:release-changelog, /flow:record-retro, Skill(ddr-keeper). Six branches — the canonical fan-out hub.</td></tr>
            <tr><td>/flow:validate</td><td>security-auditor + ethical-hacker (parallel), scenario-runner, plus a11y-auditor and design-system-guard.</td></tr>
          </tbody>
        </table>
      </DiagramFrame>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Artboard 3 · Flow side-effects flow                                  *
 *  Six files. Eleven commands. STATE.md as gravity well.                *
 * ═════════════════════════════════════════════════════════════════════ */

function AbFlowSideEffects() {
  // Center column file rail.
  const files = [
    { y: 96, path: ".ai/state/STATE.md", role: "★★ STATUS HUB", hub: true },
    { y: 192, path: ".ai/state/HANDOFF.md", role: "PAUSE → RESUME" },
    { y: 288, path: ".ai/plans/archive/", role: "DONE-PLAN STORAGE" },
    { y: 384, path: ".ai/decisions/DDR-NNN-*.md", role: "DECISION LOG" },
    { y: 480, path: ".ai/logs/security-reviews/", role: "SECURITY CACHE" },
    { y: 558, path: "coverage-baseline.json", role: "BASELINE METRIC" },
  ];

  // Producers (left column, by file)
  const producers: Record<string, string[]> = {
    ".ai/state/STATE.md": ["setup-prd", "execute", "done", "pause", "resume"],
    ".ai/state/HANDOFF.md": ["pause"],
    ".ai/plans/archive/": ["done"],
    ".ai/decisions/DDR-NNN-*.md": ["record-ddr"],
    ".ai/logs/security-reviews/": ["validate", "validate-security", "review-code"],
    "coverage-baseline.json": ["done (on baselineBranch)"],
  };

  // Consumers (right column, by file)
  const consumers: Record<string, string[]> = {
    ".ai/state/STATE.md": ["status", "plan", "done", "pause", "resume", "maintain-ai-health"],
    ".ai/state/HANDOFF.md": ["resume (single P/C)"],
    ".ai/plans/archive/": ["pnpm gen:roadmap"],
    ".ai/decisions/DDR-NNN-*.md": ["done (sweep)", "validate (drift)"],
    ".ai/logs/security-reviews/": ["mtime = cache key"],
    "coverage-baseline.json": ["validate"],
  };

  const cxFile = 590;
  const xProd = 270;
  const xCons = 910;

  return (
    <div className="mdcc ab-cmdo" data-theme="light">
      <AbHd sku="MDCC-DGM/FLW-SE" label="Flow · side-effects flow" sub="6 files · 11 producers · 9 consumer commands" />
      <DiagramFrame sku="MDCC-DGM/FLW-SE" caption="Six files. Eleven writers. Nine readers. One contract holds it together — and STATE.md is the contract.">
        <svg viewBox="0 0 1180 620" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Flow side-effects flow: six state files in the center column with producer commands fanning in from the left (accent write arrows) and consumer commands fanning out to the right (dashed read arrows). STATE.md is the gravity well with five producers and six consumers.">
          <ArrowMarkers idSuffix="flse" />

          {/* Column headers */}
          <text x={xProd} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">PRODUCERS</text>
          <text x={xProd} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">commands that write</text>
          <text x={cxFile} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">STATE FILES</text>
          <text x={cxFile} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">the contract surface</text>
          <text x={xCons} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">CONSUMERS</text>
          <text x={xCons} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">commands that read</text>

          <line x1="40" y1="72" x2="1140" y2="72" stroke="var(--border-strong)" strokeWidth="1" />

          {/* File rail in the middle */}
          {files.map((f) => (
            <NodeFile key={f.path} cx={cxFile} cy={f.y} w={224} h={44} path={f.path} role={f.role} hub={f.hub} />
          ))}

          {/* Producer columns — for each file, stack the producers and draw write arrows */}
          {files.map((f) => {
            const list = producers[f.path] ?? [];
            const stackH = list.length * 22;
            const startY = f.y - stackH / 2;
            return (
              <g key={`prod-${f.path}`}>
                {list.map((p, i) => {
                  const py = startY + i * 22 + 6;
                  return (
                    <g key={`${f.path}-${p}`}>
                      <text x={xProd + 80} y={py + 4} textAnchor="end" fontSize="11" fill="var(--fg-0)">/flow:{p}</text>
                      <EdgeWrite
                        x1={xProd + 90}
                        y1={py}
                        x2={cxFile - 112}
                        y2={f.y}
                        curve={(py - f.y) * 0.1}
                        markerId="mk-write-flse"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Consumer columns — same idea on the right */}
          {files.map((f) => {
            const list = consumers[f.path] ?? [];
            const stackH = list.length * 22;
            const startY = f.y - stackH / 2;
            return (
              <g key={`cons-${f.path}`}>
                {list.map((c, i) => {
                  const cy = startY + i * 22 + 6;
                  return (
                    <g key={`${f.path}-${c}`}>
                      <EdgeRead
                        x1={cxFile + 112}
                        y1={f.y}
                        x2={xCons - 80}
                        y2={cy}
                        curve={(cy - f.y) * 0.1}
                        markerId="mk-read-flse"
                      />
                      <text x={xCons - 70} y={cy + 4} fontSize="11" fill="var(--fg-1)">/flow:{c}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        <table className="sr-only">
          <caption>Flow side-effects matrix: producers and consumers per state file</caption>
          <thead><tr><th>File</th><th>Producers</th><th>Consumers</th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.path}>
                <td>{f.path}</td>
                <td>{(producers[f.path] ?? []).join(", ")}</td>
                <td>{(consumers[f.path] ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiagramFrame>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Artboard 4 · Design dependency subtree                               *
 *  13 commands · /design:new as ★ hub                                   *
 * ═════════════════════════════════════════════════════════════════════ */

function AbDesignDep() {
  // Rank 1: 13 design commands grouped into 3 clusters.
  const setupCluster = [
    { x: 80, cmd: "/design:init" },
    { x: 220, cmd: "/design:setup-ds", sub: "Skill + research" },
    { x: 360, cmd: "/design:setup-docs", sub: "regen INDEX" },
  ];
  const dailyCluster = [
    { x: 520, cmd: "/design:new", sub: "★ scaffold", hub: true, star: 1 as const },
    { x: 680, cmd: "/design:edit", sub: "★ iterate", hub: true, star: 1 as const },
    { x: 820, cmd: "/design:critic" },
    { x: 960, cmd: "/design:screenshot" },
  ];
  // Utility-cluster nodes are positioned inline below (different sizes per slot —
  // an array map would constrain the row to a single width and lose the right-
  // gutter triple).
  const r1Y = 150;

  return (
    <div className="mdcc ab-cmdo" data-theme="light">
      <AbHd sku="MDCC-DGM/DSN-DEP" label="Design · dependency subtree" sub="13 commands · 2 hubs · 1 iteration loop" />
      <DiagramFrame sku="MDCC-DGM/DSN-DEP" caption="Thirteen commands. Two hubs. /design:new owns the scaffold; /design:edit owns the loop. Everything else is a utility.">
        <svg viewBox="0 0 1180 620" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Design plugin dependency subtree, layered Sugiyama DAG. USER at top, thirteen design commands grouped into setup, daily, and utility clusters at rank 1. /design:new spawns Skill(frontend-design), ux-research-agent, design-system-keeper, and a critic panel of signature-moment + design + frontend + a11y critics.">
          <ArrowMarkers idSuffix="dsdep" />

          {/* USER */}
          <NodeUser x={540} y={36} w={100} h={36} slug="design-dep" />
          <text x="40" y="58" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 0</text>

          {/* USER → rank-1 hubs (only the hubs get explicit edges; clusters get cluster edges) */}
          <EdgeSpawn x1={590} y1={72} x2={592} y2={r1Y} markerId="mk-spawn-dsdep" hub />
          <EdgeSpawn x1={590} y1={72} x2={752} y2={r1Y} curve={-5} markerId="mk-spawn-dsdep" hub />
          {/* Soft edge from USER to setup cluster */}
          <EdgeSpawn x1={590} y1={72} x2={220} y2={r1Y} curve={-20} markerId="mk-spawn-dsdep" />
          {/* Soft edge to critic + screenshot */}
          <EdgeSpawn x1={590} y1={72} x2={892} y2={r1Y} curve={-10} markerId="mk-spawn-dsdep" />
          <EdgeSpawn x1={590} y1={72} x2={1032} y2={r1Y} curve={-30} markerId="mk-spawn-dsdep" />

          {/* Rank 1 label */}
          <text x="40" y={r1Y + 10} fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 1</text>

          {/* Setup cluster · subgraph wrapper */}
          <rect x={60} y={r1Y - 16} width={430} height={70} className="dgm-subgraph" />
          <text x={70} y={r1Y - 4} fontSize="9" fill="var(--fg-1)" letterSpacing="2">SETUP · 3</text>
          {setupCluster.map((c) => (
            <NodeCmd key={`s-${c.cmd}`} x={c.x} y={r1Y} w={130} h={42} cmd={c.cmd} sub={c.sub} />
          ))}

          {/* Daily cluster · subgraph wrapper (slightly accented) */}
          <rect x={500} y={r1Y - 16} width={580} height={70} className="dgm-subgraph" stroke="var(--accent)" strokeDasharray="3 2" />
          <text x={510} y={r1Y - 4} fontSize="9" fill="var(--accent-active)" letterSpacing="2">DAILY · 4 · CANVAS LOOP</text>
          {dailyCluster.map((c) => (
            <NodeCmd key={`d-${c.cmd}`} x={c.x} y={r1Y} w={140} h={42} cmd={c.cmd} sub={c.sub} hub={c.hub} star={c.star} />
          ))}

          {/* Utility cluster · 6 small commands across the bottom of rank 1 */}
          <rect x={60} y={232} width={430} height={70} className="dgm-subgraph" />
          <text x={70} y={244} fontSize="9" fill="var(--fg-1)" letterSpacing="2">UTILITY · 3 + 3 (RIGHT)</text>
          <NodeCmd x={80} y={250} w={130} h={36} cmd="/design:rollback" />
          <NodeCmd x={220} y={250} w={130} h={36} cmd="/design:handoff" />
          <NodeCmd x={360} y={250} w={130} h={36} cmd="/design:smoke" />
          {/* Right-side stacked browse/export/help (less central) */}
          <NodeCmd x={1030} y={232} w={110} h={26} cmd="/design:browse" />
          <NodeCmd x={1030} y={266} w={110} h={26} cmd="/design:export" />
          <NodeCmd x={1030} y={300} w={110} h={26} cmd="/design:help" />

          {/* ── /design:new fan-out (signature moment) ── */}
          {/* new → 4 spawns at rank 2. Sugiyama fix: route via a bus-line at y=346 */}
          {/* (between the utility cluster bottom at y=302 and rank-2 nodes at y=376), */}
          {/* so the 4 hub edges clear the utility strip cleanly. */}
          <path d="M 590 192 L 590 346 L 250 346 L 250 386" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-dsdep)" />
          <path d="M 590 192 L 590 346 L 460 346 L 460 386" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-dsdep)" />
          <path d="M 590 192 L 590 346 L 650 346 L 650 386" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-dsdep)" />
          <path d="M 590 192 L 590 346 L 850 346 L 850 386" className="edge-spawn-hub" markerEnd="url(#mk-spawn-hub-dsdep)" />
          <text x={600} y={342} fontSize="9" fill="var(--accent-active)" letterSpacing="2">/design:new FAN-OUT BUS</text>

          {/* ── Rank 2: /design:new spawns ── */}
          <text x="40" y="396" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 2</text>

          <NodeSkill x={170} y={376} w={168} h={40} label="Skill(frontend-design)" />
          <NodeAgent cx={460} cy={396} rx={90} ry={20} label="ux-research-agent" />
          <NodeAgent cx={650} cy={396} rx={90} ry={20} label="design-system-keeper" />

          {/* Critic panel cluster · rank 2 right */}
          <rect x={760} y={364} width={350} height={80} className="dgm-subgraph" stroke="var(--accent)" strokeDasharray="3 2" />
          <text x={770} y={378} fontSize="9" fill="var(--accent-active)" letterSpacing="2">CRITIC PANEL · 4 AGENTS · ITER ≤ 8</text>
          <NodeAgent cx={830} cy={416} rx={62} ry={14} label="signature-moment" />
          <NodeAgent cx={945} cy={416} rx={40} ry={14} label="design" />
          <NodeAgent cx={1015} cy={416} rx={36} ry={14} label="frontend" />
          <NodeAgent cx={1085} cy={416} rx={20} ry={14} label="a11y" />

          {/* ── /design:edit inner loop arc ── */}
          {/* edit → critic panel (re-runs the panel per iter). Tightened so it */}
          {/* stays in the gap between /design:edit and the critic-panel subgraph. */}
          <EdgeSpawn x1={750} y1={192} x2={935} y2={376} curve={-30} markerId="mk-spawn-dsdep" />
          {/* edit loops back into itself (snapshot + re-edit) — EdgeLoop primitive */}
          {/* with the curl pulled tighter to clear the critic-panel subgraph at y=364-444 */}
          <EdgeLoop d="M 750 192 Q 880 220 880 250 Q 880 280 770 200" markerId="mk-read-dsdep" />
          <text x={798} y={264} fontSize="9" fill="var(--fg-1)" letterSpacing="1">
            <tspan aria-hidden="true">↻ </tspan>SNAPSHOT · EDIT · RE-CRITIC
          </text>

          {/* ── Rank 3: file writes (compact strip) ── */}
          <text x="40" y="510" fontSize="10" fill="var(--fg-1)" letterSpacing="2">RANK 3 · FILE WRITES</text>
          <EdgeWrite x1={590} y1={192} x2={170} y2={552} curve={50} markerId="mk-write-dsdep" />
          <EdgeWrite x1={590} y1={192} x2={395} y2={552} curve={40} markerId="mk-write-dsdep" />
          <EdgeWrite x1={590} y1={192} x2={620} y2={552} curve={40} markerId="mk-write-dsdep" />
          <EdgeWrite x1={590} y1={192} x2={870} y2={552} curve={50} markerId="mk-write-dsdep" />
          <NodeFile cx={170} cy={566} w={196} h={32} path={"<Name>.tsx"} />
          <NodeFile cx={395} cy={566} w={208} h={32} path={"<Name>.meta.json"} />
          <NodeFile cx={620} cy={566} w={232} h={32} path={"_history/<slug>/"} hub />
          <NodeFile cx={870} cy={566} w={252} h={32} path={"INDEX.md · README.md"} />
        </svg>

        <table className="sr-only">
          <caption>Design plugin dependency subtree</caption>
          <thead><tr><th>Parent</th><th>Spawns</th></tr></thead>
          <tbody>
            <tr><td>USER</td><td>13 design commands grouped as setup (init, setup-ds, setup-docs), daily (new, edit, critic, screenshot), utility (rollback, handoff, smoke, browse, export, help).</td></tr>
            <tr><td>/design:new</td><td>Skill(frontend-design), ux-research-agent (cache-first), design-system-keeper (parallel), critic panel of signature-moment + design + frontend + a11y. Hub spawn.</td></tr>
            <tr><td>/design:edit</td><td>Re-runs critic panel per iteration, snapshots NNN-tsx.bak before edit, appends to chat.md.</td></tr>
            <tr><td>File writes</td><td>&lt;Name&gt;.tsx, &lt;Name&gt;.meta.json, _history/&lt;slug&gt;/, INDEX.md and README.md.</td></tr>
          </tbody>
        </table>
      </DiagramFrame>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Artboard 5 · Design side-effects flow                                *
 *  _history/<slug>/ as gravity well                                     *
 * ═════════════════════════════════════════════════════════════════════ */

function AbDesignSideEffects() {
  const files = [
    { y: 96, path: ".design/config.json", role: "DS RESOLUTION" },
    { y: 176, path: "_server.json", role: "PID · PORT · URL" },
    { y: 256, path: "_active.json", role: "INSPECTOR SELECTION" },
    { y: 348, path: "_history/<slug>/", role: "★★ CANVAS HISTORY HUB", hub: true },
    { y: 440, path: "<Name>.tsx · .meta.json", role: "CANVAS + SIDECAR" },
    { y: 520, path: "INDEX.md · README.md", role: "DOCS INDEX" },
    { y: 588, path: "<Name>.registry.json", role: "HANDOFF DROP" },
  ];

  const producers: Record<string, string[]> = {
    ".design/config.json": ["init"],
    "_server.json": ["(dev-server)"],
    "_active.json": ["(inspector WS)"],
    "_history/<slug>/": ["new (envelope, baseline)", "edit (snapshots)", "screenshot", "critic (reports)", "new (chat.md)"],
    "<Name>.tsx · .meta.json": ["new", "edit"],
    "INDEX.md · README.md": ["setup-docs", "new (step 11)"],
    "<Name>.registry.json": ["handoff"],
  };

  const consumers: Record<string, string[]> = {
    ".design/config.json": ["every command (path resolution)"],
    "_server.json": ["orchestrator (avoid dup spawn)"],
    "_active.json": ["edit (scope to selected)"],
    "_history/<slug>/": ["rollback", "critic (re-run)", "retros"],
    "<Name>.tsx · .meta.json": ["dev-server (render)", "handoff (registry)"],
    "INDEX.md · README.md": ["docs site", "audit"],
    "<Name>.registry.json": ["shadcn bunx add"],
  };

  const cxFile = 590;
  const xProd = 260;
  const xCons = 920;

  return (
    <div className="mdcc ab-cmdo" data-theme="light">
      <AbHd sku="MDCC-DGM/DSN-SE" label="Design · side-effects flow" sub="7 files · 8 producers · 9 consumer commands" />
      <DiagramFrame sku="MDCC-DGM/DSN-SE" caption="One folder per canvas. Everything else is a pointer back to it. _history/&lt;slug&gt;/ is where the iteration lives.">
        <svg viewBox="0 0 1180 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Design side-effects flow: seven design files in the center column with producers fanning in from the left (accent write arrows) and consumers fanning out to the right (dashed read arrows). _history/<slug>/ is the gravity well with five producers and three consumers.">
          <ArrowMarkers idSuffix="dsse" />

          <text x={xProd} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">PRODUCERS</text>
          <text x={xProd} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">commands + runtime</text>
          <text x={cxFile} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">DESIGN FILES</text>
          <text x={cxFile} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">the contract surface</text>
          <text x={xCons} y={42} textAnchor="middle" fontSize="11" fill="var(--accent-active)" letterSpacing="2" fontWeight="700">CONSUMERS</text>
          <text x={xCons} y={58} textAnchor="middle" fontSize="10" fill="var(--fg-1)" letterSpacing="1">commands + runtime</text>

          <line x1="40" y1="72" x2="1140" y2="72" stroke="var(--border-strong)" strokeWidth="1" />

          {files.map((f) => (
            <NodeFile key={f.path} cx={cxFile} cy={f.y} w={248} h={40} path={f.path} role={f.role} hub={f.hub} />
          ))}

          {files.map((f) => {
            const list = producers[f.path] ?? [];
            const stackH = list.length * 20;
            const startY = f.y - stackH / 2;
            return (
              <g key={`pd-${f.path}`}>
                {list.map((p, i) => {
                  const py = startY + i * 20 + 6;
                  return (
                    <g key={`${f.path}-${p}`}>
                      <text x={xProd + 90} y={py + 4} textAnchor="end" fontSize="11" fill="var(--fg-0)">/design:{p}</text>
                      <EdgeWrite
                        x1={xProd + 100}
                        y1={py}
                        x2={cxFile - 124}
                        y2={f.y}
                        curve={(py - f.y) * 0.08}
                        markerId="mk-write-dsse"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {files.map((f) => {
            const list = consumers[f.path] ?? [];
            const stackH = list.length * 20;
            const startY = f.y - stackH / 2;
            return (
              <g key={`co-${f.path}`}>
                {list.map((c, i) => {
                  const cy = startY + i * 20 + 6;
                  return (
                    <g key={`${f.path}-${c}`}>
                      <EdgeRead
                        x1={cxFile + 124}
                        y1={f.y}
                        x2={xCons - 80}
                        y2={cy}
                        curve={(cy - f.y) * 0.08}
                        markerId="mk-read-dsse"
                      />
                      <text x={xCons - 70} y={cy + 4} fontSize="11" fill="var(--fg-1)">/design:{c}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        <table className="sr-only">
          <caption>Design side-effects matrix: producers and consumers per file</caption>
          <thead><tr><th>File</th><th>Producers</th><th>Consumers</th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.path}>
                <td>{f.path}</td>
                <td>{(producers[f.path] ?? []).join(", ")}</td>
                <td>{(consumers[f.path] ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DiagramFrame>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════ *
 *  Canvas root                                                          *
 * ═════════════════════════════════════════════════════════════════════ */

export default function CommandsOverview() {
  return (
    <DesignCanvas
      title="Commands Overview"
      subtitle="Two parallel diagram-flow visualizations of the maude commandscape — /flow:* + /design:*."
    >
      <DCSection title="Legend" subtitle="Read the rest in this grammar.">
        <DCArtboard id="legend" title="MDCC-DGM/LEG · Legend">
          <AbLegend />
        </DCArtboard>
      </DCSection>

      <DCSection title="Flow" subtitle="30+ commands · 6 state files">
        <DCArtboard id="flow-dep-graph" title="MDCC-DGM/FLW-DEP · Flow dependency subtree">
          <AbFlowDep />
        </DCArtboard>
        <DCArtboard id="flow-sideeffects-flow" title="MDCC-DGM/FLW-SE · Flow side-effects flow">
          <AbFlowSideEffects />
        </DCArtboard>
      </DCSection>

      <DCSection title="Design" subtitle="13 commands · 7 state files">
        <DCArtboard id="design-dep-graph" title="MDCC-DGM/DSN-DEP · Design dependency subtree">
          <AbDesignDep />
        </DCArtboard>
        <DCArtboard id="design-sideeffects-flow" title="MDCC-DGM/DSN-SE · Design side-effects flow">
          <AbDesignSideEffects />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
