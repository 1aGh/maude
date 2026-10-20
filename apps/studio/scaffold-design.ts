// scaffold-design.ts — write a minimal, BOOTABLE `.design/` into a folder (Phase 28).
//
// Used by two native-app flows: "New project" (create a GitHub repo → init a local
// project) and the "open a repo with no Maude design system" fallback ("set it up?").
// It deliberately scaffolds only the MINIMUM the dev-server needs to boot (per
// context.ts the only hard requirement is a `.design/` dir; config needs just
// `name` + `designRoot`). A real design system is still created by /design:setup-ds
// (agent-driven) — this just gets the project to open instead of crash-looping.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const CONFIG_SCHEMA =
  'https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/config.schema.json';

// ── "How to use Maude" — a 10-artboard reference canvas, added on request (Help and guides),
// (Phase 1, DDR-166's onboarding plan — replaces the earlier
// explainer-video plan item). Genuinely self-contained: no `system/maude/`
// import (doesn't exist yet on a fresh project), tokens inlined as custom
// properties. Source of truth for edits: .design/ui/How to use Maude.tsx in
// this repo — re-sync this constant by hand after editing there.
const HOW_TO_USE_MAUDE_TSX = `/**
 * @canvas      How to use Maude · added from Help and guides (scaffold-design.ts) · 10 artboards, one per capability
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   start-here | design-system | edit-canvas | ai-assistant | point-comment-draw | generate-images | photo-editing | media-and-templates | save-share-collab | draw-as-code
 * @brief       A "how to use Maude" reference canvas added from Help and guides. One artboard per capability cluster (start here, design system, editing, AI assistant, annotation-driven iteration, AI image generation, photo editing, media/templates, git+collab, draw-as-code). Real domain nouns, no Lorem, honest mini-mockups instead of live screenshots (the seeded copy has to work with zero server state).
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (inline styles — no sibling CSS to keep in sync across the scaffold template)
 * @history     .design/_history/how-to-use-maude/
 *
 * Genuinely self-contained (no DS import): this canvas is SEEDED into a
 * brand-new project by scaffoldDesign() before any design system exists, so
 * unlike Studio Docs.tsx it can't rely on \`system/maude/\` being present. The
 * token VALUES below are copied from system/maude/colors_and_type.css's dark
 * theme (kept in sync by eye — this is a fixed onboarding surface, not a
 * living DS specimen) and applied as inline custom properties on \`Board\`, so
 * every \`var(--token)\` below still resolves without an external stylesheet.
 */

import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

// Copied from system/maude/colors_and_type.css (dark theme) — see the note above.
const TOKENS: React.CSSProperties = {
  "--bg-0": "oklch(0.165 0.012 255)",
  "--bg-1": "oklch(0.198 0.012 255)",
  "--bg-2": "oklch(0.232 0.013 255)",
  "--bg-3": "oklch(0.270 0.013 252)",
  "--border-subtle": "oklch(0.290 0.012 255)",
  "--border-default": "oklch(0.360 0.013 252)",
  "--fg-0": "oklch(0.955 0.005 250)",
  "--fg-1": "oklch(0.790 0.008 250)",
  "--fg-2": "oklch(0.660 0.010 250)",
  "--fg-3": "oklch(0.500 0.010 250)",
  "--accent": "oklch(0.680 0.180 268)",
  "--accent-muted": "oklch(0.460 0.110 268)",
  "--accent-tint": "color-mix(in oklab, oklch(0.680 0.180 268) 16%, transparent)",
  "--status-success": "oklch(0.760 0.150 162)",
  "--presence-agent": "oklch(0.700 0.190 322)",
  "--radius-sm": "5px",
  "--radius-md": "7px",
  "--radius-lg": "10px",
  "--radius-pill": "999px",
  "--space-2": "4px",
  "--space-3": "8px",
  "--space-4": "12px",
  "--space-5": "16px",
  "--space-6": "24px",
  "--space-7": "32px",
  "--font-display": '"Inter Tight", "Inter", system-ui, -apple-system, sans-serif',
  "--font-body": '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  "--font-mono": '"JetBrains Mono", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  "--type-xs": "11px", "--lh-xs": "16px",
  "--type-sm": "12px", "--lh-sm": "18px",
  "--type-base": "14px",
  "--type-md": "16px", "--lh-md": "24px",
  "--type-2xl": "28px",
  "--tracking-tight": "-0.014em",
  "--tracking-wide": "0.04em",
} as React.CSSProperties;

/* ── Icon set — thin-stroke (1.4) geometric glyphs, no emoji (DS rule) ── */
const ICONS: Record<string, React.ReactNode> = {
  cursor: <path d="M3 2l9 4.4-4 1.1-1.1 4z" />,
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  palette: (<><circle cx="8" cy="8" r="5.5" /><circle cx="6" cy="6" r="0.9" fill="currentColor" stroke="none" /><circle cx="10" cy="6.2" r="0.9" fill="currentColor" stroke="none" /><circle cx="10.6" cy="9.4" r="0.9" fill="currentColor" stroke="none" /></>),
  layers: (<><polygon points="8 2.2 13.8 5.5 8 8.8 2.2 5.5" /><polyline points="2.2 9 8 12.3 13.8 9" /></>),
  sliders: (<><line x1="3" y1="5" x2="13" y2="5" /><circle cx="6" cy="5" r="1.7" fill="currentColor" /><line x1="3" y1="11" x2="13" y2="11" /><circle cx="10" cy="11" r="1.7" fill="currentColor" /></>),
  message: <path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6A1.7 1.7 0 0 1 13.5 4.2v4.6a1.7 1.7 0 0 1-1.7 1.7H6.2L3 13V4.2z" />,
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  pen: (<><path d="M10.5 2.8l2.7 2.7L6 12.7 3 13.5l.8-3z" /><line x1="9.2" y1="4.1" x2="11.9" y2="6.8" /></>),
  pin: (<><path d="M8 1.8c-2.2 0-4 1.7-4 4 0 2.9 4 8.4 4 8.4s4-5.5 4-8.4c0-2.3-1.8-4-4-4z" /><circle cx="8" cy="5.8" r="1.4" /></>),
  highlighter: <path d="M3 13h4L13.5 6.5a1.6 1.6 0 0 0 0-2.3l-1.7-1.7a1.6 1.6 0 0 0-2.3 0L3 9v4z" />,
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="1.4" /><circle cx="6" cy="6.5" r="1.2" /><path d="M3 11.5l3.2-3.2a1 1 0 0 1 1.4 0L13 13" /></>),
  wand: (<><path d="M2.5 13.5 9 7" /><path d="M10 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none" /><path d="M13 2l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3z" fill="currentColor" stroke="none" /></>),
  scissors: (<><circle cx="4.2" cy="4.2" r="1.7" /><circle cx="4.2" cy="11.8" r="1.7" /><line x1="5.5" y1="5.3" x2="13" y2="13" /><line x1="5.5" y1="10.7" x2="13" y2="3" /></>),
  drop: <path d="M8 2c2.4 3 4.2 5.7 4.2 8a4.2 4.2 0 1 1-8.4 0C3.8 7.7 5.6 5 8 2z" />,
  grid: (<><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.8" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.8" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.8" /><rect x="9" y="9" width="4.5" height="4.5" rx="0.8" /></>),
  git: (<><circle cx="4" cy="4" r="1.6" /><circle cx="4" cy="12" r="1.6" /><circle cx="12" cy="6" r="1.6" /><path d="M4 5.6v4.8M5.6 4H9a1.4 1.4 0 0 1 1.4 1.4v.6" /></>),
  users: (<><circle cx="6" cy="6" r="2.3" /><path d="M2 13.5c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" /><circle cx="12.2" cy="5.5" r="1.9" /><path d="M10.8 9.8c1.7.3 2.9 1.7 2.9 3.5" /></>),
  play: <polygon points="5 3.5 12.5 8 5 12.5" fill="currentColor" stroke="none" />,
  code: (<><polyline points="6 5 3 8 6 11" /><polyline points="10 5 13 8 10 11" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  "arrow-right": (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  terminal: (<><polyline points="3.5 5.5 6 8 3.5 10.5" /><line x1="8" y1="11" x2="12" y2="11" /></>),
};
function Icon({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {ICONS[name]}
    </svg>
  );
}
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{ display: "inline-block", padding: "1px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", background: "var(--bg-2)", fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-0)" }}>
      {children}
    </kbd>
  );
}

/* ── Shared frame chrome ── */
function Board({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...TOKENS, position: "absolute", inset: 0, overflow: "hidden", background: "var(--bg-0)", color: "var(--fg-0)", fontFamily: "var(--font-body)" }}>
      {children}
    </div>
  );
}
function ArtHeader({ n, total, eyebrow, title }: { n: number; total: number; eyebrow: string; title: string }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "var(--space-6) var(--space-7) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--accent)" }}>{eyebrow}</span>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--type-2xl)", fontWeight: 650, letterSpacing: "var(--tracking-tight)" }}>{title}</h1>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-3)" }}>{String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
    </header>
  );
}
function Body({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "var(--space-6) var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-6)", height: "calc(100% - 84px)", boxSizing: "border-box", overflow: "hidden" }}>{children}</div>;
}
function Lede({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, maxWidth: 640, fontSize: "var(--type-md)", lineHeight: "var(--lh-md)", color: "var(--fg-1)" }}>{children}</p>;
}
function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-5)", background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)" }}>
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", color: "var(--accent)" }}><Icon name={icon} size={15} /></span>
      <div style={{ fontSize: "var(--type-base)", fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: "var(--type-sm)", lineHeight: "var(--lh-sm)", color: "var(--fg-2)" }}>{body}</div>
    </div>
  );
}
function CardRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>{children}</div>;
}
// A real, hands-on instruction — every one of these describes something you
// can genuinely do RIGHT NOW on this artboard or in this app (verified
// against the actual keyboard-shortcut table in client/app.jsx, not guessed).
function TryIt({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", border: "1px solid var(--accent-muted)" }}>
      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--accent)" }}>Try it</span>
      <span style={{ fontSize: "var(--type-sm)", lineHeight: "var(--lh-sm)", color: "var(--fg-0)" }}>{children}</span>
    </div>
  );
}
// A big hand-drawn-feel curved arrow + numbered callout, pointing at a real
// interactive target elsewhere in the artboard (the same "point at it"
// vocabulary the product itself uses for annotations).
function PointAt({ x, y, w = 150, h = 70, flip = false, children }: { x: number; y: number; w?: number; h?: number; flip?: boolean; children: React.ReactNode }) {
  // Starts below the label (clears the text instead of striking through it)
  // and ends short of the box's bottom edge (clears whatever sits just below).
  const path = flip ? \`M\${w - 10} 20 C \${w * 0.4} 18, \${w * 0.15} \${h * 0.45}, 6 \${h - 28}\` : \`M6 20 C \${w * 0.6} 18, \${w * 0.85} \${h * 0.45}, \${w - 6} \${h - 28}\`;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" }}>
      <svg width={w} height={h} viewBox={\`0 0 \${w} \${h}\`} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <path d={path} stroke="var(--presence-agent)" strokeWidth="2" fill="none" strokeLinecap="round" markerEnd="url(#pointAtArrow)" />
        <defs>
          <marker id="pointAtArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--presence-agent)" />
          </marker>
        </defs>
      </svg>
      <div style={{ position: "absolute", top: 0, [flip ? "right" : "left"]: 0, maxWidth: w - 10, fontSize: "var(--type-xs)", fontWeight: 700, color: "var(--presence-agent)", textAlign: flip ? "right" : "left" }}>{children}</div>
    </div>
  );
}
function StepRow({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: "var(--radius-pill)", background: "var(--bg-2)", border: "1px solid var(--border-default)", fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--accent)" }}>{n}</span>
      <div>
        <div style={{ fontSize: "var(--type-base)", fontWeight: 600, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: "var(--type-sm)", lineHeight: "var(--lh-sm)", color: "var(--fg-2)" }}>{body}</div>
      </div>
    </div>
  );
}
function MiniPanelHd({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-2)", fontSize: "var(--type-xs)", color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>
      <span>{label}</span>
      {right}
    </div>
  );
}
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", overflow: "hidden", ...style }}>{children}</div>;
}

/* ─────────────────────────── 01 · Start here ─────────────────────────── */
function ArtStartHere() {
  return (
    <Board>
      <ArtHeader n={1} total={10} eyebrow="Orientation" title="Start here" />
      <Body>
        <Lede>Everything you design lives on a canvas. Canvases are grouped in the file tree on the left. A fresh project starts with two groups: <b>Design system</b> (your tokens and components) and <b>UI kit</b> (the screens you build).</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 230, flexShrink: 0 }}>
            <MiniPanelHd label="FILES" right={<Icon name="grid" size={13} />} />
            <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--type-sm)" }}>
              <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", marginTop: 2 }}>Design system</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-2)" }}><Icon name="folder" size={13} /> (empty until set up)</div>
              <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", marginTop: 8 }}>UI kit</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: "var(--radius-sm)", background: "var(--accent-tint)", color: "var(--accent)" }}>Welcome.tsx</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-1)" }}>How to use Maude.tsx</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-1)" }}>How to make video.tsx</div>
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="cursor" title="Click to open" body="Opening a file replaces the active canvas. Nothing is destructive: your work saves on its own as you go." />
            <FeatureCard icon="grid" title="One infinite canvas" body="Every artboard on a canvas lives on the same pannable, zoomable surface. Pan and zoom like a whiteboard." />
            <FeatureCard icon="terminal" title="No terminal needed" body="Everything here (browsing, editing, saving, sharing) works from the app. The Assistant is the only thing that pairs with a Claude Code you install once." />
          </CardRow>
        </div>
        <TryIt>Click "How to make video.tsx" in the file list on the left, right now. That's the real file tree, not a picture of it.</TryIt>
      </Body>
    </Board>
  );
}

/* ────────────────────── 02 · Build a design system ───────────────────── */
function ArtDesignSystem() {
  const swatches = ["oklch(0.68 0.18 268)", "oklch(0.76 0.15 162)", "oklch(0.80 0.13 78)", "oklch(0.66 0.19 25)"];
  return (
    <Board>
      <ArtHeader n={2} total={10} eyebrow="Foundations" title="Build a design system" />
      <Body>
        <Lede>Ask the Assistant to run <b>/design:setup-ds</b> and it interviews you: a handful of sharp questions about your product, mood, and brand. Then it generates a real, tokenized system: color, type, space, motion, and components. No blank Figma file, no picking a font at random.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ flex: 1, padding: "var(--space-5)" }}>
            <div style={{ fontSize: "var(--type-xs)", fontFamily: "var(--font-mono)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: "var(--space-3)" }}>Colors</div>
            <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
              {swatches.map((c) => <span key={c} style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: c, border: "1px solid var(--border-subtle)" }} />)}
            </div>
            <div style={{ fontSize: "var(--type-xs)", fontFamily: "var(--font-mono)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: "var(--space-3)" }}>Type</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Display heading</div>
            <div style={{ fontSize: "var(--type-sm)", color: "var(--fg-2)" }}>Body copy at a readable measure.</div>
          </Panel>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <StepRow n={1} title="A dozen sharp questions" body="Product, audience, mood references, a hard-NO list: real research grounds every option, not vibes." />
            <StepRow n={2} title="Pick a direction" body="A small set of moodboard variants, seeded from your answers. Pick one and refine it." />
            <StepRow n={3} title="A complete, tokenized system" body="Colors, type ladder, spacing, motion, and a component library: every value a token, nothing hardcoded." />
          </div>
        </div>
        <TryIt>Open the Assistant (<Kbd>⌘⇧A</Kbd>) and type <code>/design:setup-ds</code>. It starts the real interview.</TryIt>
      </Body>
    </Board>
  );
}

/* ────────────────────────── 03 · Edit a canvas ────────────────────────── */
function ArtEditCanvas() {
  return (
    <Board>
      <ArtHeader n={3} total={10} eyebrow="Editing" title="Edit a canvas" />
      <Body>
        <Lede>This isn't a mockup. The button below is a real element on this real artboard. Try the two moves that cover most editing:</Lede>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-7)", padding: "var(--space-4) 0" }}>
          <div
            data-dc-element="try-it-button"
            style={{ padding: "16px 30px", borderRadius: "var(--radius-md)", background: "var(--accent)", color: "var(--bg-0)", fontFamily: "var(--font-display)", fontSize: "var(--type-md)", fontWeight: 700, cursor: "pointer" }}
          >
            Get started
          </div>
          <div style={{ position: "relative", width: 260, height: 90 }}>
            <PointAt x={0} y={0} w={130} h={60} flip>① ⌘-click this button</PointAt>
            <div style={{ position: "absolute", left: 0, bottom: 0, maxWidth: 250, fontSize: "var(--type-sm)", color: "var(--fg-2)" }}>The Inspector opens (or press <Kbd>⌘⇧I</Kbd>). Try changing its Fill or Radius, or double-click "Get started" to retype it.</div>
          </div>
        </div>
        <TryIt><Kbd>⌘</Kbd>-click the button above right now. Then in the Inspector's CSS tab, change its background. This artboard updates live, the same way any canvas does.</TryIt>
        <CardRow>
          <FeatureCard icon="pen" title="Inline text edit" body="Double-click any text on the canvas and type. No dialog, no round-trip." />
          <FeatureCard icon="sliders" title="Bind to a token" body="Drag a color or spacing value onto a design token to bind it. Change the token, every use updates." />
          <FeatureCard icon="layers" title="Drag to reorder" body="Reorder elements right on the canvas, or open Layers (⌘⇧I) to drag them there instead." />
        </CardRow>
      </Body>
    </Board>
  );
}

/* ───────────────────────── 04 · The AI Assistant ──────────────────────── */
function ArtAiAssistant() {
  return (
    <Board>
      <ArtHeader n={4} total={10} eyebrow="Assistant" title="The AI Assistant" />
      <Body>
        <Lede>The chat panel runs on your own Claude subscription: never a separate key, never metered billing. It sees whatever's open and selected, so short requests work: "make this bigger," not a paragraph of context.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 320, flexShrink: 0 }}>
            <MiniPanelHd label="ASSISTANT" right={<span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--status-success)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />Ready</span>} />
            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "80%", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", color: "var(--fg-0)", fontSize: "var(--type-sm)" }}>Make the hero title bigger and tighten the tracking</div>
              <div style={{ maxWidth: "85%", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--bg-2)", fontSize: "var(--type-sm)", color: "var(--fg-1)" }}>Bumped it to <code>var(--type-3xl)</code> and tightened tracking. Want it bolder too?</div>
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="terminal" title="Slash commands" body="Type / for autocomplete: /design:new, /design:edit, /design:critic and more, right in the composer." />
            <FeatureCard icon="message" title="It remembers" body="Conversations survive a restart. Close the laptop, come back tomorrow, keep going mid-thought." />
            <FeatureCard icon="sparkle" title="Runs on your subscription" body="Install Claude Code once, sign in, and the Assistant just works. No separate API key, ever." />
          </CardRow>
        </div>
        <TryIt>Press <Kbd>⌘⇧A</Kbd> right now to open the Assistant. It's the sparkle icon, top-right of the window.</TryIt>
      </Body>
    </Board>
  );
}

/* ──────────────────── 05 · Point, comment, draw → it acts ────────────── */
function ArtPointCommentDraw() {
  return (
    <Board>
      <ArtHeader n={5} total={10} eyebrow="✦ The signature move" title="Point, comment, draw → it acts" />
      <Body>
        <Lede>You don't have to describe a change in words. The box below is real. Try it:</Lede>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-7)" }}>
          <div data-dc-element="try-it-annotate-target" style={{ width: 160, height: 90, borderRadius: "var(--radius-md)", background: "var(--bg-2)", border: "1px solid var(--accent)" }} />
          <div style={{ position: "relative", width: 260, height: 90 }}>
            <PointAt x={0} y={0} w={130} h={60} flip>① ⌘-click this box</PointAt>
            <div style={{ position: "absolute", left: 0, bottom: 0, maxWidth: 250, fontSize: "var(--type-sm)", color: "var(--fg-2)" }}>② right-click it for the annotation menu, or press <Kbd>⌘⇧M</Kbd> to open Comments and drop a pin on it.</div>
          </div>
        </div>
        <TryIt>Right-click the box above right now. The context menu has highlighter, sticky notes, and freehand drawing. Anything you mark stays attached to that exact spot as context for the Assistant.</TryIt>
        <CardRow>
          <FeatureCard icon="cursor" title="⌘-click to select" body="Hover for a preview, click to select. ⌘⇧+click adds more than one to the selection." />
          <FeatureCard icon="pin" title="Comment on a pixel" body="Pin a note to an exact spot, not a vague description. The Assistant reads it as scoped context." />
          <FeatureCard icon="highlighter" title="Draw & annotate" body="Highlighter, sticky notes, shapes and freehand marks: a real whiteboard layer over the canvas." />
        </CardRow>
      </Body>
    </Board>
  );
}

/* ──────────────── 06 · Generate images with your own AI key ───────────── */
function ArtGenerateImages() {
  return (
    <Board>
      <ArtHeader n={6} total={10} eyebrow="AI media" title="Generate images with your own AI key" />
      <Body>
        <Lede>Bring your own Google (Nano Banana) key and generate an image right onto the canvas, via <b>⌘K → "Generate with AI"</b>, or just ask in the chat ("generate a hero image of a mountain lake"). The result lands as a normal asset you can place, edit, and re-generate.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 260, height: 150, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <MiniPanelHd label="GENERATE" right={<Icon name="sparkle" size={13} style={{ color: "var(--accent)" }} />} />
            <div style={{ flex: 1, margin: "var(--space-3)", borderRadius: "var(--radius-md)", background: "linear-gradient(135deg, var(--bg-3), var(--bg-2))", display: "grid", placeItems: "center", color: "var(--fg-3)" }}>
              <Icon name="image" size={26} />
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="wand" title="Prompt, or seed from a still" body="A plain-text prompt, or start from an image you already generated so a new shot matches its look." />
            <FeatureCard icon="pen" title="Ask to edit it again" body="&ldquo;Make the sky purple&rdquo; produces a fresh AI-edited version. Iterate the same way you'd iterate on any canvas element." />
            <FeatureCard icon="sliders" title="Stays on your machine" body="Add your key under File → Settings → AI generation. It's sent straight to the provider, never touches git history." />
          </CardRow>
        </div>
        <TryIt>Press <Kbd>⌘K</Kbd> right now and pick "Generate with AI…" from the list.</TryIt>
      </Body>
    </Board>
  );
}

/* ─────────────────────────── 07 · Photo editing ───────────────────────── */
function ArtPhotoEditing() {
  return (
    <Board>
      <ArtHeader n={7} total={10} eyebrow="AI media" title="Photo editing, right on the canvas" />
      <Body>
        <Lede>Select any photo and open the <b>Photo</b> tab in the Inspector: adjustments, duotone, grain, masking, and one-click background removal. Every edit is non-destructive, the original stays untouched.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 280, flexShrink: 0 }}>
            <MiniPanelHd label="PHOTO" />
            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {["Brightness", "Contrast", "Saturation"].map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <span style={{ width: 80, fontSize: "var(--type-xs)", color: "var(--fg-2)" }}>{k}</span>
                  <div style={{ flex: 1, height: 3, borderRadius: "var(--radius-pill)", background: "var(--bg-3)", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "60%", borderRadius: "var(--radius-pill)", background: "var(--accent)" }} />
                  </div>
                </div>
              ))}
              <button type="button" style={{ marginTop: 4, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", background: "var(--bg-2)", color: "var(--fg-0)", fontSize: "var(--type-sm)", cursor: "pointer" }}><Icon name="scissors" size={13} /> Remove background</button>
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="scissors" title="One-click background removal" body="Runs locally: no upload, no per-image cost." />
            <FeatureCard icon="drop" title="Duotone, grain, masking" body="Real photo-editing tools, not a filter preset list. Every value is a canvas-native property." />
            <FeatureCard icon="check" title="Non-destructive" body="Adjustments live as metadata next to the asset. Revert anytime, the source file never changes." />
          </CardRow>
        </div>
        <TryIt>Drop any photo from Finder onto this canvas, ⌘-click it, then open the Photo tab (<Kbd>⌘⇧I</Kbd>) to try Remove background.</TryIt>
      </Body>
    </Board>
  );
}

/* ────────────────────── 08 · Drop in media & templates ────────────────── */
function ArtMediaTemplates() {
  return (
    <Board>
      <ArtHeader n={8} total={10} eyebrow="Assets" title="Drop in media & templates" />
      <Body>
        <Lede>Drag images, video, or audio straight from Finder onto the canvas: one file or a whole batch. Paste a link to unfurl it. Create or delete a canvas from the file tree without ever touching the filesystem yourself.</Lede>
        <CardRow>
          <FeatureCard icon="image" title="Drag & drop, one or many" body="Drop a single photo or select a batch. Every file lands, even in a large drop. Video and audio go on the canvas as annotations; photos can drop straight into an artboard." />
          <FeatureCard icon="arrow-right" title="Paste a link" body="Paste a URL onto the canvas and it unfurls. No manual screenshotting." />
          <FeatureCard icon="grid" title="Create & delete canvases" body="Right-click the file tree: new canvas, new folder, rename, delete, all without a terminal." />
        </CardRow>
        <TryIt>Drag any image file from Finder and drop it right on this artboard, now. It lands as a real asset.</TryIt>
      </Body>
    </Board>
  );
}

/* ────────────────── 09 · Save, share, collaborate ──────────────────────── */
function ArtSaveShareCollab() {
  return (
    <Board>
      <ArtHeader n={9} total={10} eyebrow="Version & team" title="Save, share, collaborate" />
      <Body>
        <Lede>Version control lives in plain words: <b>Save version</b> keeps a checkpoint just for you, <b>Publish</b> shares it with your team, <b>Get latest</b> pulls in everyone else's work. No terminal, no git vocabulary required.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <CardRow>
            <FeatureCard icon="git" title="No-terminal git layer" body="Save version · Publish · Get latest: the same underlying git history, described in plain words." />
            <FeatureCard icon="users" title="Live multiplayer" body="See your team's cursors moving in real time, on the same branch. Changes sync as they happen." />
            <FeatureCard icon="play" title="Present Mode" body="Strip the chrome down to just your artboards for a clean walkthrough or a client call." />
          </CardRow>
        </div>
        <TryIt>Press <Kbd>⌘⇧G</Kbd> right now to open Changes. It tracks everything since your last save, live.</TryIt>
      </Body>
    </Board>
  );
}

/* ───────────────────────────── 10 · Draw as code ───────────────────────── */
function ArtDrawAsCode() {
  return (
    <Board>
      <ArtHeader n={10} total={10} eyebrow="Vector & motion" title="Draw as code" />
      <Body>
        <Lede>Ask for a logo, icon, or diagram and it's built by a deterministic geometry engine: real computed vectors, never a guessed path. Animate the result once and ship one file that plays identically on web and native.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 180, height: 150, flexShrink: 0, display: "grid", placeItems: "center" }}>
            <svg width={72} height={72} viewBox="0 0 32 32" style={{ color: "var(--accent)" }} aria-hidden>
              <rect width="16" height="16" x="8" y="8" fill="none" stroke="currentColor" strokeWidth="2.4" rx="4" />
              <g fill="currentColor"><rect width="5.6" height="5.6" x="23" y="3" rx="1.6" /><rect width="5.6" height="5.6" x="3" y="23" rx="1.6" /><rect width="5.6" height="5.6" x="23" y="23" rx="1.6" /></g>
            </svg>
          </Panel>
          <CardRow>
            <FeatureCard icon="code" title="Computed, not guessed" body="Splines, connectors, and layout math produce the SVG. Deterministic and consistent, every time." />
            <FeatureCard icon="play" title="Animate once" body="Turn a mark into motion and export a single .lottie. Frame for frame, web and native in sync." />
            <FeatureCard icon="check" title="WCAG + grid-checked" body="Every mark clears a legibility, contrast, and grid-alignment gate before it's considered done." />
          </CardRow>
        </div>
        <TryIt>Open the Assistant (<Kbd>⌘⇧A</Kbd>) and ask it to draw a simple compass icon. Watch it build from geometry, not guess a path.</TryIt>
      </Body>
    </Board>
  );
}

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="how-to-use-maude" title="How to use Maude" subtitle="REFERENCE · 10 artboards, one per capability">
        <DCArtboard id="start-here" label="01 · Start here" width={1040} height={640}><ArtStartHere /></DCArtboard>
        <DCArtboard id="design-system" label="02 · Design system" width={1040} height={640}><ArtDesignSystem /></DCArtboard>
        <DCArtboard id="edit-canvas" label="03 · Edit a canvas" width={1040} height={640}><ArtEditCanvas /></DCArtboard>
        <DCArtboard id="ai-assistant" label="04 · AI Assistant" width={1040} height={640}><ArtAiAssistant /></DCArtboard>
        <DCArtboard id="point-comment-draw" label="05 · Point, comment, draw" width={1040} height={640}><ArtPointCommentDraw /></DCArtboard>
        <DCArtboard id="generate-images" label="06 · Generate images" width={1040} height={640}><ArtGenerateImages /></DCArtboard>
        <DCArtboard id="photo-editing" label="07 · Photo editing" width={1040} height={640}><ArtPhotoEditing /></DCArtboard>
        <DCArtboard id="media-and-templates" label="08 · Media & templates" width={1040} height={640}><ArtMediaTemplates /></DCArtboard>
        <DCArtboard id="save-share-collab" label="09 · Save, share, collaborate" width={1040} height={640}><ArtSaveShareCollab /></DCArtboard>
        <DCArtboard id="draw-as-code" label="10 · Draw as code" width={1040} height={640}><ArtDrawAsCode /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const HOW_TO_USE_MAUDE_META = {
  title: 'How to use Maude',
  subtitle: 'Reference canvas added from Help and guides \u2014 10 artboards, one per capability',
  brief:
    'Onboarding reference canvas (replaces the Phase 1 explainer-video plan item). Added by Help and guides (scaffold-design.ts). One artboard per capability cluster: start here, design system, editing, AI assistant, point/comment/draw iteration, AI image generation (Nano Banana), photo editing, media & templates, save/share/collaborate, draw-as-code. Honest inline mini-mockups (no live screenshots \u2014 has to work with zero server state on a freshly scaffolded project).',
  platform: 'desktop',
  designSystem: 'maude',
  opt_out_scope: 'none',
  sections: [
    {
      id: 'how-to-use-maude',
      title: 'How to use Maude',
      subtitle: 'REFERENCE \u00b7 10 artboards, one per capability',
    },
  ],
  artboards: [
    {
      id: 'start-here',
      label: '01 \u00b7 Start here',
    },
    {
      id: 'design-system',
      label: '02 \u00b7 Design system',
    },
    {
      id: 'edit-canvas',
      label: '03 \u00b7 Edit a canvas',
    },
    {
      id: 'ai-assistant',
      label: '04 \u00b7 AI Assistant',
    },
    {
      id: 'point-comment-draw',
      label: '05 \u00b7 Point, comment, draw',
    },
    {
      id: 'generate-images',
      label: '06 \u00b7 Generate images',
    },
    {
      id: 'photo-editing',
      label: '07 \u00b7 Photo editing',
    },
    {
      id: 'media-and-templates',
      label: '08 \u00b7 Media & templates',
    },
    {
      id: 'save-share-collab',
      label: '09 \u00b7 Save, share, collaborate',
    },
    {
      id: 'draw-as-code',
      label: '10 \u00b7 Draw as code',
    },
  ],
  layout: {
    artboards: [
      {
        id: 'start-here',
        x: 0,
        y: 0,
      },
      {
        id: 'design-system',
        x: 1120,
        y: 0,
      },
      {
        id: 'edit-canvas',
        x: 2240,
        y: 0,
      },
      {
        id: 'ai-assistant',
        x: 3360,
        y: 0,
      },
      {
        id: 'point-comment-draw',
        x: 4480,
        y: 0,
      },
      {
        id: 'generate-images',
        x: 5600,
        y: 0,
      },
      {
        id: 'photo-editing',
        x: 6720,
        y: 0,
      },
      {
        id: 'media-and-templates',
        x: 7840,
        y: 0,
      },
      {
        id: 'save-share-collab',
        x: 8960,
        y: 0,
      },
      {
        id: 'draw-as-code',
        x: 10080,
        y: 0,
      },
    ],
  },
  css_mode: 'inline',
  iteration_count: 1,
};

// ── "How to make video" — the video-comp companion (7 artboards). Same
// self-contained shape. Source of truth: .design/ui/How to make video.tsx.
const HOW_TO_MAKE_VIDEO_TSX = `/**
 * @canvas      How to make video · added from Help and guides (scaffold-design.ts) · 7 artboards, one per video capability
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   start-video-comp | timeline | ai-assistant-video | footage-to-cut | generate-video-audio | captions | export
 * @brief       A "how to make video" reference canvas added from Help and guides, beside How to use Maude.tsx. One artboard per capability cluster: what a video-comp is, the Timeline, the Assistant for video, turning raw footage into a cut, AI video/audio generation, automatic captions (whisper.cpp / cloud), export. Honest inline mini-mockups, no live screenshots.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (inline styles, no sibling CSS)
 * @history     .design/_history/how-to-make-video/
 *
 * Genuinely self-contained (no DS import) — same reasoning as How to use
 * Maude.tsx: this is seeded into a brand-new project before any design
 * system exists, so it can't rely on \`system/maude/\` being present. Token
 * VALUES are copied from system/maude/colors_and_type.css's dark theme and
 * applied as inline custom properties on \`Board\`.
 */

import { DCArtboard, DCSection, DesignCanvas, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Copied from system/maude/colors_and_type.css (dark theme) — kept in sync
// by eye with How to use Maude.tsx's identical block (a fixed onboarding
// surface, not a living DS specimen).
const TOKENS: React.CSSProperties = {
  "--bg-0": "oklch(0.165 0.012 255)",
  "--bg-1": "oklch(0.198 0.012 255)",
  "--bg-2": "oklch(0.232 0.013 255)",
  "--bg-3": "oklch(0.270 0.013 252)",
  "--border-subtle": "oklch(0.290 0.012 255)",
  "--border-default": "oklch(0.360 0.013 252)",
  "--fg-0": "oklch(0.955 0.005 250)",
  "--fg-1": "oklch(0.790 0.008 250)",
  "--fg-2": "oklch(0.660 0.010 250)",
  "--fg-3": "oklch(0.500 0.010 250)",
  "--accent": "oklch(0.680 0.180 268)",
  "--accent-muted": "oklch(0.460 0.110 268)",
  "--accent-tint": "color-mix(in oklab, oklch(0.680 0.180 268) 16%, transparent)",
  "--radius-sm": "5px",
  "--radius-md": "7px",
  "--radius-lg": "10px",
  "--space-2": "4px",
  "--space-3": "8px",
  "--space-4": "12px",
  "--space-5": "16px",
  "--space-6": "24px",
  "--space-7": "32px",
  "--font-display": '"Inter Tight", "Inter", system-ui, -apple-system, sans-serif',
  "--font-body": '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  "--font-mono": '"JetBrains Mono", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
  "--type-xs": "11px",
  "--type-sm": "12px", "--lh-sm": "18px",
  "--type-base": "14px",
  "--type-md": "16px", "--lh-md": "24px",
  "--type-2xl": "28px",
  "--tracking-tight": "-0.014em",
  "--tracking-wide": "0.04em",
} as React.CSSProperties;

/* ── Icon set ── */
const ICONS: Record<string, React.ReactNode> = {
  play: <polygon points="5 3.5 12.5 8 5 12.5" fill="currentColor" stroke="none" />,
  pause: (<><rect x="4.5" y="3.5" width="2.2" height="9" rx="0.6" fill="currentColor" stroke="none" /><rect x="9.3" y="3.5" width="2.2" height="9" rx="0.6" fill="currentColor" stroke="none" /></>),
  film: (<><rect x="2.5" y="3" width="11" height="10" rx="1.4" /><line x1="5.5" y1="3" x2="5.5" y2="13" /><line x1="10.5" y1="3" x2="10.5" y2="13" /></>),
  scissors: (<><circle cx="4.2" cy="4.2" r="1.7" /><circle cx="4.2" cy="11.8" r="1.7" /><line x1="5.5" y1="5.3" x2="13" y2="13" /><line x1="5.5" y1="10.7" x2="13" y2="3" /></>),
  message: <path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h7.6A1.7 1.7 0 0 1 13.5 4.2v4.6a1.7 1.7 0 0 1-1.7 1.7H6.2L3 13V4.2z" />,
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  eye: (<><path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8s-2.3 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>),
  sparkle: <path d="M8 1.8l1.4 4.8L14 8l-4.6 1.4L8 14.2l-1.4-4.8L2 8l4.6-1.4z" fill="currentColor" stroke="none" />,
  volume: (<><polygon points="3 6 5.5 6 8 3.5 8 12.5 5.5 10 3 10" fill="currentColor" stroke="none" /><path d="M10.5 6a3 3 0 0 1 0 4" /></>),
  waveform: (<><line x1="2" y1="8" x2="2" y2="8" /><line x1="4" y1="5" x2="4" y2="11" /><line x1="6" y1="3" x2="6" y2="13" /><line x1="8" y1="6" x2="8" y2="10" /><line x1="10" y1="2" x2="10" y2="14" /><line x1="12" y1="5" x2="12" y2="11" /><line x1="14" y1="7" x2="14" y2="9" /></>),
  captions: (<><rect x="2" y="4" width="12" height="8" rx="1.4" /><line x1="4.5" y1="7" x2="8" y2="7" /><line x1="4.5" y1="9.3" x2="10.5" y2="9.3" /></>),
  download: (<><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><polyline points="3 12.8 3 13.6 13 13.6 13 12.8" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  wand: (<><path d="M2.5 13.5 9 7" /><path d="M10 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none" /></>),
  drag: (<><circle cx="6" cy="4.5" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="4.5" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="11.5" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="11.5" r="1" fill="currentColor" stroke="none" /></>),
};
function Icon({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {ICONS[name]}
    </svg>
  );
}
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{ display: "inline-block", padding: "1px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", background: "var(--bg-2)", fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-0)" }}>
      {children}
    </kbd>
  );
}
// Real, hands-on instructions (same shape as How to use Maude.tsx's TryIt —
// verified against the actual keyboard-shortcut table in client/app.jsx).
function TryIt({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", border: "1px solid var(--accent-muted)" }}>
      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--accent)" }}>Try it</span>
      <span style={{ fontSize: "var(--type-sm)", lineHeight: "var(--lh-sm)", color: "var(--fg-0)" }}>{children}</span>
    </div>
  );
}
function PointAt({ x, y, w = 150, h = 70, flip = false, children }: { x: number; y: number; w?: number; h?: number; flip?: boolean; children: React.ReactNode }) {
  const path = flip ? \`M\${w - 6} 6 C \${w * 0.35} 4, \${w * 0.1} \${h * 0.5}, 6 \${h - 6}\` : \`M6 6 C \${w * 0.65} 4, \${w * 0.9} \${h * 0.5}, \${w - 6} \${h - 6}\`;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, pointerEvents: "none" }}>
      <svg width={w} height={h} viewBox={\`0 0 \${w} \${h}\`} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <path d={path} stroke="var(--presence-agent, #c34fd8)" strokeWidth="2" fill="none" strokeLinecap="round" markerEnd="url(#pointAtArrowV)" />
        <defs>
          <marker id="pointAtArrowV" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--presence-agent, #c34fd8)" />
          </marker>
        </defs>
      </svg>
      <div style={{ position: "absolute", top: 0, [flip ? "right" : "left"]: 0, maxWidth: w - 10, fontSize: "var(--type-xs)", fontWeight: 700, color: "var(--presence-agent, #c34fd8)", textAlign: flip ? "right" : "left" }}>{children}</div>
    </div>
  );
}

/* ── Shared chrome (same shapes as How to use Maude.tsx) ── */
function Board({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...TOKENS, position: "absolute", inset: 0, overflow: "hidden", background: "var(--bg-0)", color: "var(--fg-0)", fontFamily: "var(--font-body)" }}>
      {children}
    </div>
  );
}
function ArtHeader({ n, total, eyebrow, title }: { n: number; total: number; eyebrow: string; title: string }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "var(--space-6) var(--space-7) var(--space-5)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--accent)" }}>{eyebrow}</span>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--type-2xl)", fontWeight: 650, letterSpacing: "var(--tracking-tight)" }}>{title}</h1>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-3)" }}>{String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
    </header>
  );
}
function Body({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "var(--space-6) var(--space-7)", display: "flex", flexDirection: "column", gap: "var(--space-6)", height: "calc(100% - 84px)", boxSizing: "border-box", overflow: "hidden" }}>{children}</div>;
}
function Lede({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, maxWidth: 640, fontSize: "var(--type-md)", lineHeight: "var(--lh-md)", color: "var(--fg-1)" }}>{children}</p>;
}
function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-5)", background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)" }}>
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", color: "var(--accent)" }}><Icon name={icon} size={15} /></span>
      <div style={{ fontSize: "var(--type-base)", fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: "var(--type-sm)", lineHeight: "var(--lh-sm)", color: "var(--fg-2)" }}>{body}</div>
    </div>
  );
}
function CardRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>{children}</div>;
}
function MiniPanelHd({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-2)", fontSize: "var(--type-xs)", color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>
      <span>{label}</span>
      {right}
    </div>
  );
}
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", overflow: "hidden", ...style }}>{children}</div>;
}
function Chip({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: "var(--radius-pill, 999px)", border: "1px solid var(--border-default)", background: "var(--bg-2)", color: "var(--fg-1)", fontSize: "var(--type-xs)", ...style }}>{children}</span>;
}
function PrimaryButton({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: "var(--radius-sm)", border: "1px solid transparent", background: "var(--accent)", color: "var(--bg-0)", fontSize: "var(--type-sm)", fontWeight: 600, cursor: "pointer", ...style }}>{children}</button>;
}

/* ─────────────────────── 01 · Start a video comp ──────────────────────── */
function ArtStartVideoComp() {
  return (
    <Board>
      <ArtHeader n={1} total={7} eyebrow="Video" title="Start a video comp" />
      <Body>
        <Lede>A video comp is a canvas artboard whose body is a real Remotion composition. You author it in TSX like any other canvas, but every animated value is a function of a frame number, so it plays back, scrubs, and exports frame-perfect.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 260, height: 150, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <MiniPanelHd label="VIDEO COMP" right={<span style={{ display: "flex", alignItems: "center", gap: 4 }}><Icon name="film" size={12} /> 0:04</span>} />
            <div style={{ flex: 1, margin: "var(--space-3)", borderRadius: "var(--radius-md)", background: "#000", display: "grid", placeItems: "center" }}>
              <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-tint)", display: "grid", placeItems: "center" }}><Icon name="play" size={16} style={{ color: "var(--accent)" }} /></span>
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="film" title="Ask for it in words" body="&ldquo;Cut these three clips together with a crossfade and a title card&rdquo;: the Assistant writes the comp." />
            <FeatureCard icon="play" title="Free scrub & preview" body="A real embedded player, right in the canvas. No separate render just to check a frame." />
            <FeatureCard icon="download" title="Export MP4 or GIF" body="⌘⇧E, or /design:export mp4, through Maude's own capture spine. No renderer install, no native binaries." />
          </CardRow>
        </div>
        <TryIt>Ask the Assistant (<Kbd>⌘⇧A</Kbd>) to add a video comp to this canvas. A 2-second title card is a good first try.</TryIt>
      </Body>
    </Board>
  );
}

// A real, tiny frame-driven Remotion comp — not a mockup. 90 frames @ 30fps
// (3s): a mark springs in, then keeps rotating for the rest of the loop, so
// scrubbing the REAL Timeline against this REAL comp shows real motion at
// every point, not a frozen frame (DDR-094 — freeze-frames lie).
const TIMELINE_DEMO_FRAMES = 90;
const TimelineDemoAnim = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 200 } });
  const scale = interpolate(pop, [0, 1], [0.6, 1]);
  const rotate = interpolate(frame, [0, TIMELINE_DEMO_FRAMES], [0, 360]);
  return (
    <AbsoluteFill style={{ background: "#0b0e16", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "#7c8cf8", transform: \`scale(\${scale}) rotate(\${rotate}deg)\` }} />
    </AbsoluteFill>
  );
};

/* ────────────────────────── 02 · Edit on the Timeline ─────────────────── */
// Accepts the VideoComp as \`children\` (not rendered inline) — canvas-lib.tsx's
// \`subtreeHasVideoComp()\` walks the STATIC JSX tree via \`props.children\` to
// decide whether to render the real top-right video badge, and it does NOT
// reach inside a function component's own return value — only literal JSX
// nesting from the DCArtboard call site down. So the VideoComp must arrive
// as a literal child at that call site (see Canvas() below), not be
// constructed inside this function's own body. Real bug, caught by checking
// \`document.querySelector('.dc-artboard-video-badge')\` live and finding
// nothing, not by assuming the mockup-style code would just work.
function ArtTimeline({ children }: { children: React.ReactNode }) {
  const clips = [
    { w: 90, label: "intro" },
    { w: 140, label: "clip-a" },
    { w: 110, label: "clip-b" },
    { w: 70, label: "outro" },
  ];
  return (
    <Board>
      {/* Points at the REAL video-artboard badge canvas-lib.tsx renders top-right
          (top:4px, right:6px) the instant any real <VideoComp> is in this
          artboard's subtree — not drawn by this canvas, just aimed at. */}
      <svg width={140} height={60} viewBox="0 0 140 60" style={{ position: "absolute", right: 26, top: "75px", overflow: "visible", pointerEvents: "none" }} aria-hidden>
        <path d="M108 56 C 135 20, 150 -15, 151 -60" stroke="var(--presence-agent, #c34fd8)" strokeWidth="2" fill="none" strokeLinecap="round" markerEnd="url(#pointAtBadge)" />
        <defs>
          <marker id="pointAtBadge" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--presence-agent, #c34fd8)" />
          </marker>
        </defs>
      </svg>
      <div style={{ position: "absolute", right: 75, top: "98px", width: 130, fontSize: "var(--type-xs)", fontWeight: 700, color: "var(--presence-agent, #c34fd8)", textAlign: "right" }}>
        ① that real icon, or ⌘⇧T
      </div>
      <ArtHeader n={2} total={7} eyebrow="Video" title="Edit on the Timeline" />
      <Body>
        <Lede>The clip on the left is a real, playing Remotion comp, not a screenshot. Click the small video icon in this artboard's own top-right corner (real chrome, not drawn by this canvas), or press <Kbd>⌘⇧T</Kbd>, to open the real Timeline and scrub it.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 220, flexShrink: 0, overflow: "hidden" }}>
            {children}
          </Panel>
          <Panel style={{ flex: 1, padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: "var(--space-3)" }}>
              <Icon name="play" size={13} />
              <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: "var(--type-xs)", color: "var(--fg-3)" }}>00:00 / 00:12</span>
            </div>
            <div style={{ display: "flex", height: 44, borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-default)" }}>
              {clips.map((c, i) => (
                <div key={c.label} style={{ width: c.w, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: i % 2 === 0 ? "var(--bg-2)" : "var(--bg-3)", borderRight: i < clips.length - 1 ? "1px solid var(--border-subtle)" : "none", fontSize: "var(--type-xs)", fontFamily: "var(--font-mono)", color: "var(--fg-1)" }}>
                  <Icon name="drag" size={11} style={{ color: "var(--fg-3)" }} /> {c.label}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "var(--space-2)", fontSize: "var(--type-xs)", color: "var(--fg-3)" }}>(a 4-clip cut, for scale: the real player on the left is the actual demo)</div>
          </Panel>
        </div>
        <TryIt>Click the small video-camera icon in this artboard's own top-right corner right now (or press <Kbd>⌘⇧T</Kbd>). The real Timeline opens, and you can scrub the clip on the left frame by frame.</TryIt>
        <CardRow>
          <FeatureCard icon="drag" title="Drag to retime" body="Move, trim, or resize a clip directly on the track. The underlying frame math updates with it." />
          <FeatureCard icon="scissors" title="Split, reorder, replace" body="Right-click for the full clip menu: the same vocabulary as a real NLE, scoped to what a comp needs." />
          <FeatureCard icon="eye" title="Inspect any clip" body="Select a clip to see its layer decomposition: video track, caption track, effects, each independently editable." />
        </CardRow>
      </Body>
    </Board>
  );
}

/* ───────────────────── 03 · AI Assistant for video ─────────────────────── */
function ArtAiAssistantVideo() {
  return (
    <Board>
      <ArtHeader n={3} total={7} eyebrow="Video" title="AI Assistant for video" />
      <Body>
        <Lede>Ask for beats, transitions, and motion graphics in plain language. The Assistant writes real Remotion, frame-driven and deterministic, never a CSS animation that would tear on export.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 320, flexShrink: 0 }}>
            <MiniPanelHd label="ASSISTANT" />
            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "85%", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--accent-tint)", fontSize: "var(--type-sm)" }}>Add a kinetic-type title card, then crossfade into the first clip</div>
              <div style={{ maxWidth: "90%", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--bg-2)", fontSize: "var(--type-sm)", color: "var(--fg-1)" }}>Added a per-letter spring-in title, 18-frame crossfade into clip-a. Want a chromatic-split flourish on the title too?</div>
            </div>
          </Panel>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ fontSize: "var(--type-xs)", fontFamily: "var(--font-mono)", letterSpacing: "var(--tracking-wide)", textTransform: "uppercase", color: "var(--fg-3)" }}>Prompt ideas</div>
            {["Crossfade these three clips with a music bed", "Add a lower-third caption to every clip", "Cinematic grade, teal/orange, subtle grain", "Ken-Burns push on the hero shot", "Kinetic-type title, per-letter spring-in"].map((p) => (
              <div key={p} style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "var(--bg-1)", border: "1px solid var(--border-subtle)", fontSize: "var(--type-sm)", color: "var(--fg-1)" }}>"{p}"</div>
            ))}
          </div>
        </div>
        <TryIt>Open the Assistant (<Kbd>⌘⇧A</Kbd>) and paste one of the prompts on the right, against any video comp you've already added.</TryIt>
      </Body>
    </Board>
  );
}

/* ───────────────────── 04 · Turn footage into a cut ────────────────────── */
function ArtFootageToCut() {
  return (
    <Board>
      <ArtHeader n={4} total={7} eyebrow="Video" title="Turn a folder of clips into a cut" />
      <Body>
        <Lede>Drop a folder of raw footage on the canvas and ask for a reel. An analyst watches every clip first (good moments, subject, motion, quality), then a director assembles an edit decision list before a single frame of comp code is written.</Lede>
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
          {[["folder", "Raw clips"], ["eye", "Analyst watches"], ["wand", "Director cuts"], ["film", "Comp generated"]].map(([icon, label], i, arr) => (
            <div key={label as string} style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", width: 100 }}>
                <span style={{ width: 44, height: 44, display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", background: "var(--bg-1)", border: "1px solid var(--border-default)", color: "var(--accent)" }}><Icon name={icon as string} size={18} /></span>
                <span style={{ fontSize: "var(--type-xs)", textAlign: "center", color: "var(--fg-2)" }}>{label}</span>
              </div>
              {i < arr.length - 1 ? <span style={{ color: "var(--fg-3)" }}>→</span> : null}
            </div>
          ))}
        </div>
        <CardRow>
          <FeatureCard icon="eye" title="It watches before it cuts" body="Every clip gets characterized (good-moment ranges, mood, quality score) before any editing decision is made." />
          <FeatureCard icon="wand" title="A real edit decision list" body="Beats, transitions, and an optional music bed: a story, not just clips concatenated in folder order." />
          <FeatureCard icon="film" title="Then it becomes a comp" body="The EDL turns into real, hand-editable TSX on the Timeline. Pull a different shot, retime a beat, it's all still yours." />
        </CardRow>
        <TryIt>Drag a folder of real clips from Finder onto this canvas, then ask the Assistant (<Kbd>⌘⇧A</Kbd>) for "a reel from these clips."</TryIt>
      </Body>
    </Board>
  );
}

/* ─────────────────── 05 · Generate video & audio ────────────────────────── */
function ArtGenerateVideoAudio() {
  return (
    <Board>
      <ArtHeader n={5} total={7} eyebrow="AI media" title="Generate video & audio with your own key" />
      <Body>
        <Lede>Bring your own key and fill a gap without hand-sourcing it. A generated clip drops into your assets like real footage, and Maude checks what you've already made before spending a new generation.</Lede>
        <CardRow>
          <FeatureCard icon="film" title="Video: text or seeded" body="A prompt, or seed a clip from a still you already generated so it matches your hero's look. Runs in the background." />
          <FeatureCard icon="waveform" title="Music, SFX & voiceover" body="One key covers music beds, sound effects, and text-to-speech. The track lands ready to drop under a reel." />
          <FeatureCard icon="check" title="Reuse before you pay" body="Before spending credits, Maude searches audio you've already generated (and your provider history) for a match." />
        </CardRow>
        <TryIt>Add your key under File → Settings → AI generation, then ask the Assistant for "a 4-second clip of ocean waves at sunset."</TryIt>
      </Body>
    </Board>
  );
}

/* ──────────────────────────── 06 · Captions ──────────────────────────────── */
function ArtCaptions() {
  return (
    <Board>
      <ArtHeader n={6} total={7} eyebrow="Video" title="Automatic captions" />
      <Body>
        <Lede>Subtitles are free and need no key. whisper.cpp runs locally (one-click model download) and writes word-timed captions on any clip. Prefer a cloud engine? Pick ElevenLabs Scribe or Groq in Settings. Maude never silently switches you to a paid engine.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 300, flexShrink: 0 }}>
            <div style={{ height: 90, background: "#000", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "var(--space-3)" }}>
              <span style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: "var(--type-sm)" }}>the canvas fills in <b>live</b></span>
            </div>
            <div style={{ padding: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
              <Chip>local · whisper.cpp</Chip>
              <Chip>cloud · Scribe</Chip>
            </div>
          </Panel>
          <CardRow>
            <FeatureCard icon="captions" title="Word-timed & editable" body="Captions land as an editable JSON sidecar. whisper mishears jargon sometimes, so patch it by hand and re-render, no re-transcribing." />
            <FeatureCard icon="check" title="Auto-converts your file" body="Any video container works. Maude handles the audio extraction, no ffmpeg wrangling." />
            <FeatureCard icon="sparkle" title="You choose the engine" body="Local, Scribe, or Groq: an explicit setting, never a silent default to a paid cloud engine." />
          </CardRow>
        </div>
        <TryIt>Select a clip on this canvas, then ask the Assistant (<Kbd>⌘⇧A</Kbd>) to "add captions to this clip."</TryIt>
      </Body>
    </Board>
  );
}

/* ────────────────────────────── 07 · Export ────────────────────────────── */
function ArtExport() {
  return (
    <Board>
      <ArtHeader n={7} total={7} eyebrow="Ship it" title="Export" />
      <Body>
        <Lede><Kbd>⌘⇧E</Kbd> opens the export dialog: MP4 (H.264) or palette-quantized GIF, resolved from the comp's own frame rate and duration. Everything renders through Maude's own capture spine: no renderer binaries, no install step for whoever opens the project next.</Lede>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Panel style={{ width: 260, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Chip style={{ background: "var(--accent-tint)", color: "var(--accent)", borderColor: "var(--accent-muted)" }}>MP4</Chip>
              <Chip>GIF</Chip>
            </div>
            <PrimaryButton style={{ alignSelf: "flex-start" }}><Icon name="download" size={13} /> Export ⌘⇧E</PrimaryButton>
          </Panel>
          <CardRow>
            <FeatureCard icon="download" title="No install, ever" body="Rendering happens through the same headless capture Maude already uses for screenshots. Nothing new to set up." />
            <FeatureCard icon="film" title="Frame-accurate" body="fps and duration come straight from the comp's own meta. What you scrub in the Player is exactly what exports." />
            <FeatureCard icon="check" title="Same command, from the CLI" body="/design:export mp4 --scope artboard works headlessly too, useful once a cut is part of a repeatable pipeline." />
          </CardRow>
        </div>
        <TryIt>Press <Kbd>⌘⇧E</Kbd> right now. The real export dialog opens for whatever's active.</TryIt>
      </Body>
    </Board>
  );
}

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="how-to-make-video" title="How to make video" subtitle="REFERENCE · 7 artboards, one per video capability">
        <DCArtboard id="start-video-comp" label="01 · Start a video comp" width={1040} height={640}><ArtStartVideoComp /></DCArtboard>
        <DCArtboard id="timeline" label="02 · Edit on the Timeline" width={1040} height={640}>
          <ArtTimeline>
            <VideoComp component={TimelineDemoAnim} durationInFrames={TIMELINE_DEMO_FRAMES} fps={30} width={220} height={140} />
          </ArtTimeline>
        </DCArtboard>
        <DCArtboard id="ai-assistant-video" label="03 · AI Assistant for video" width={1040} height={640}><ArtAiAssistantVideo /></DCArtboard>
        <DCArtboard id="footage-to-cut" label="04 · Footage into a cut" width={1040} height={640}><ArtFootageToCut /></DCArtboard>
        <DCArtboard id="generate-video-audio" label="05 · Generate video & audio" width={1040} height={640}><ArtGenerateVideoAudio /></DCArtboard>
        <DCArtboard id="captions" label="06 · Automatic captions" width={1040} height={640}><ArtCaptions /></DCArtboard>
        <DCArtboard id="export" label="07 · Export" width={1040} height={640}><ArtExport /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const HOW_TO_MAKE_VIDEO_META = {
  title: 'How to make video',
  subtitle:
    'Reference canvas added from Help and guides \u2014 7 artboards, one per video capability',
  brief:
    'Onboarding reference canvas (companion to How to use Maude.tsx). Added by Help and guides (scaffold-design.ts). One artboard per video-comp capability: starting a comp, the Timeline, the Assistant for video, turning raw footage into a cut, AI video/audio generation, automatic captions, export.',
  platform: 'desktop',
  designSystem: 'maude',
  opt_out_scope: 'none',
  sections: [
    {
      id: 'how-to-make-video',
      title: 'How to make video',
      subtitle: 'REFERENCE \u00b7 7 artboards, one per video capability',
    },
  ],
  artboards: [
    {
      id: 'start-video-comp',
      label: '01 \u00b7 Start a video comp',
    },
    {
      id: 'timeline',
      label: '02 \u00b7 Edit on the Timeline',
    },
    {
      id: 'ai-assistant-video',
      label: '03 \u00b7 AI Assistant for video',
    },
    {
      id: 'footage-to-cut',
      label: '04 \u00b7 Footage into a cut',
    },
    {
      id: 'generate-video-audio',
      label: '05 \u00b7 Generate video & audio',
    },
    {
      id: 'captions',
      label: '06 \u00b7 Automatic captions',
    },
    {
      id: 'export',
      label: '07 \u00b7 Export',
    },
  ],
  layout: {
    artboards: [
      {
        id: 'start-video-comp',
        x: 0,
        y: 0,
      },
      {
        id: 'timeline',
        x: 1120,
        y: 0,
      },
      {
        id: 'ai-assistant-video',
        x: 2240,
        y: 0,
      },
      {
        id: 'footage-to-cut',
        x: 3360,
        y: 0,
      },
      {
        id: 'generate-video-audio',
        x: 4480,
        y: 0,
      },
      {
        id: 'captions',
        x: 5600,
        y: 0,
      },
      {
        id: 'export',
        x: 6720,
        y: 0,
      },
    ],
  },
  css_mode: 'inline',
  iteration_count: 1,
};

/** Whether `dir` is already a Maude project (has `.design/config.json`). */
export function hasDesign(dir: string): boolean {
  return existsSync(join(dir, '.design', 'config.json'));
}

export interface ScaffoldResult {
  ok: boolean;
  error?: string;
}

/** The two guide canvases Help › Help and guides adds on request (S6.15, Q10), in the order shown. */
export const GUIDE_CANVASES = ['How to use Maude', 'How to make video'] as const;

export interface AddGuidesResult {
  ok: boolean;
  /** the guides written now */
  added: string[];
  /** the guides already there (a file of that name exists — never overwritten) */
  skipped: string[];
  error?: string;
}

/**
 * Add the guide canvases to a project's UI folder (`uiDir`, absolute). A new project starts empty
 * (Q10); the guides come from the same template strings the old scaffold seeded. A guide whose
 * `.tsx` already exists is skipped and left byte-for-byte as the person left it, so asking twice —
 * or after editing one — loses nothing.
 */
export function addGuideCanvases(uiDir: string): AddGuidesResult {
  const added: string[] = [];
  const skipped: string[] = [];
  const created = new Date().toISOString().slice(0, 10);
  const guides = [
    { name: GUIDE_CANVASES[0], tsx: HOW_TO_USE_MAUDE_TSX, meta: HOW_TO_USE_MAUDE_META },
    { name: GUIDE_CANVASES[1], tsx: HOW_TO_MAKE_VIDEO_TSX, meta: HOW_TO_MAKE_VIDEO_META },
  ];
  try {
    mkdirSync(uiDir, { recursive: true });
    for (const g of guides) {
      const tsxPath = join(uiDir, `${g.name}.tsx`);
      if (existsSync(tsxPath)) {
        skipped.push(g.name);
        continue;
      }
      // 'wx': a file that appears between the check and the write is not clobbered either
      writeFileSync(tsxPath, g.tsx, { encoding: 'utf8', flag: 'wx' });
      const metaPath = join(uiDir, `${g.name}.meta.json`);
      if (!existsSync(metaPath))
        writeFileSync(metaPath, `${JSON.stringify({ ...g.meta, created }, null, 2)}\n`, 'utf8');
      added.push(g.name);
    }
    return { ok: true, added, skipped };
  } catch (e) {
    return {
      ok: false,
      added,
      skipped,
      error: e instanceof Error ? e.message : 'Could not add the guides.',
    };
  }
}

/** Scaffold a minimal bootable `.design/` (no design system yet). Refuses to
 *  clobber an existing project. `name` is the human project label. */
export function scaffoldDesign(dir: string, name?: string): ScaffoldResult {
  const designDir = join(dir, '.design');
  const configPath = join(designDir, 'config.json');
  if (existsSync(configPath)) {
    return { ok: false, error: 'This folder is already a Maude project.' };
  }
  const projectName = (name && name.trim()) || basename(dir) || 'Untitled';
  try {
    mkdirSync(join(designDir, 'ui'), { recursive: true });
    mkdirSync(join(designDir, 'system'), { recursive: true });
    const config = {
      $schema: CONFIG_SCHEMA,
      name: projectName,
      designRoot: '.design',
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'UI kit', path: 'ui' },
      ],
      designSystems: [],
      completenessProfile: 'standard',
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    // A new project starts EMPTY (S6.15, Q10): no Welcome, no guides — Help › Help and guides adds
    // the guides on request (addGuideCanvases). `ui/` and `system/` stay in git with a .gitkeep;
    // `system/` is genuinely empty until /design:setup-ds.
    writeFileSync(join(designDir, 'ui', '.gitkeep'), '', 'utf8');
    writeFileSync(join(designDir, 'system', '.gitkeep'), '', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not set up the project.' };
  }
}
