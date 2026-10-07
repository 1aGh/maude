/**
 * SPECIMEN — iconography · maude-v2
 *
 * DEMONSTRATES: the maude-v2 icon family — one hand-drawn set of inline SVGs on a 16-unit
 *   grid, 1.5px rounded stroke that never scales, shown at its two sizes (16 in panels and
 *   menus, 18 in the toolbar), colour via currentColor, and the spark (the logo's four-point
 *   star, lifted from <Spark> = assets/logos/spark.svg) as the one filled glyph — the AI's.
 *   SOURCE OF TRUTH: every glyph the one menu uses (home, file, edit, view, help, history,
 *   share, export, pulse = Diagnostics, settings, submenu, check) lives in GLYPHS below; other
 *   specimens copy these exact paths, never a redraw.
 * COMPOSITION: hero = a slice of the app where every icon sits in its real home (islands,
 *   toolbar, the AI chat panel folded into its spark) with anchored size callouts; then the
 *   full family with a keyline overlay + ink switcher, a magnified anatomy plate (the
 *   comment bubble is cut from the logo tile), the four drawing rules, optical balance,
 *   and a right/wrong toolbar.
 * COPY VOICE: everyday names, where each icon lives — no glyph codes, no SKU labels.
 * NOTES: one family, never mixed with a library set. Strokes carry
 *   vector-effect: non-scaling-stroke (iconography.css), so 18px grows the shape, not the line.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./iconography.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── The family — every glyph drawn on a 16 × 16 grid, live area 2–14 ─────── */
type Glyph = { id: string; name: string; home: string; draw: ReactNode };

const GLYPHS: Glyph[] = [
  /* The toolbar, left → right (CONTRACT §2): Select · Hand · Frame · Shape · Pen · Text · Sticky · Comment · More */
  { id: "select", name: "Select", home: "toolbar · V", draw: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" /> },
  {
    id: "hand",
    name: "Hand",
    home: "toolbar · H, or hold Space",
    draw: (
      <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />
    ),
  },
  { id: "frame", name: "Frame", home: "toolbar · F · layers", draw: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" /> },
  {
    id: "shape",
    name: "Shape",
    home: "toolbar · R · layers",
    draw: (
      <>
        <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" />
        <circle cx="10.25" cy="10.25" r="3.5" />
      </>
    ),
  },
  {
    id: "pen",
    name: "Pen",
    home: "toolbar · P",
    draw: (
      <>
        <path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" />
        <path d="M8.75 4.75l2.5 2.5" />
      </>
    ),
  },
  { id: "text", name: "Text", home: "toolbar · T · layers", draw: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" /> },
  {
    id: "sticky",
    name: "Sticky",
    home: "toolbar · N · layers",
    draw: (
      <>
        <path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" />
        <path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" />
      </>
    ),
  },
  {
    id: "comment",
    name: "Comment",
    home: "toolbar · C · top-right panel",
    draw: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  },
  {
    id: "more",
    name: "More",
    home: "end of the toolbar · every panel",
    draw: (
      <g className="ic-dots">
        <circle cx="3.5" cy="8" r="1.1" />
        <circle cx="8" cy="8" r="1.1" />
        <circle cx="12.5" cy="8" r="1.1" />
      </g>
    ),
  },
  { id: "spark", name: "AI", home: "the AI chat panel, folded", draw: null },

  /* The one menu (CONTRACT §1) — every row's glyph lives here, nowhere else */
  { id: "chevron", name: "Menu", home: "project pill", draw: <path d="M5 6.5l3 3 3-3" /> },
  { id: "submenu", name: "Submenu", home: "a menu row that opens more", draw: <path d="M6 4.5l3.5 3.5L6 11.5" /> },
  { id: "check", name: "Ticked", home: "a menu row that is on", draw: <path d="M3.5 8.5l3 3 6-7" /> },
  {
    id: "home",
    name: "Home",
    home: "Menu › Back to Home",
    draw: <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />,
  },
  {
    id: "file",
    name: "File",
    home: "Menu › File",
    draw: (
      <>
        <path d="M4 2.5h5.25l2.75 2.75v8.25H4z" />
        <path d="M9 2.5v3h3" />
      </>
    ),
  },
  {
    id: "edit",
    name: "Edit",
    home: "Menu › Edit",
    draw: (
      <>
        <path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z" />
        <path d="M3 13.5h10" />
      </>
    ),
  },
  {
    id: "view",
    name: "View",
    home: "Menu › View",
    draw: (
      <>
        <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
        <circle cx="8" cy="8" r="1.75" />
      </>
    ),
  },
  {
    id: "help",
    name: "Help",
    home: "Menu › Help",
    draw: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" />
      </>
    ),
  },
  {
    id: "history",
    name: "Version history",
    home: "Menu › Version history · ⌥⌘H",
    draw: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  },
  {
    id: "share",
    name: "Share",
    home: "Menu › Share… · top-right panel",
    draw: (
      <>
        <path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" />
        <path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" />
      </>
    ),
  },
  {
    id: "export",
    name: "Export",
    home: "Menu › Export… · ⇧⌘E",
    draw: (
      <>
        <path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" />
        <path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
      </>
    ),
  },
  { id: "pulse", name: "Diagnostics", home: "Menu › Diagnostics", draw: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" /> },
  {
    id: "settings",
    name: "Settings",
    home: "Menu › Settings… · ⌘,",
    draw: (
      <>
        <path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" />
        <circle cx="8.5" cy="5" r="1.5" />
        <circle cx="5.5" cy="11" r="1.5" />
      </>
    ),
  },

  /* Panels, search and status */
  {
    id: "search",
    name: "Search",
    home: "⌘K",
    draw: (
      <>
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.25 10.25l3.25 3.25" />
      </>
    ),
  },
  {
    id: "panel-left",
    name: "Left panels",
    home: "top-left panel",
    draw: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="2.5" />
        <path d="M6 3v10" />
      </>
    ),
  },
  {
    id: "panel-right",
    name: "Right panels",
    home: "top-right panel",
    draw: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="2.5" />
        <path d="M10 3v10" />
      </>
    ),
  },
  {
    id: "collapse",
    name: "Hide panels",
    home: "panel corner · ⌘\\",
    draw: <path d="M2.5 9.5h4v4M13.5 6.5h-4v-4M6.5 9.5l-4 4M9.5 6.5l4-4" />,
  },
  {
    id: "layers",
    name: "Layers",
    home: "left panel",
    draw: <path d="M8 2.5l5.5 3.25L8 9 2.5 5.75zM2.5 9.25L8 12.5l5.5-3.25" />,
  },
  { id: "tab", name: "Project tab", home: "project tabs", draw: <path d="M1.5 13.5h2v-7A2.5 2.5 0 0 1 6 4h4a2.5 2.5 0 0 1 2.5 2.5v7h2" /> },
  { id: "menu", name: "Compact menu", home: "narrow windows", draw: <path d="M3 4.5h10M3 8h10M3 11.5h6" /> },
  {
    id: "done",
    name: "Done",
    home: "toasts · status, with a word",
    draw: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M5.5 8.25l1.75 1.75 3.25-3.75" />
      </>
    ),
  },
  {
    id: "problem",
    name: "Problem",
    home: "errors · always with a word",
    draw: (
      <>
        <path d="M8 2.75l5.75 10H2.25z" />
        <path d="M8 6.75v2.5M8 11h.01" />
      </>
    ),
  },
];

const BY_ID = Object.fromEntries(GLYPHS.map((g) => [g.id, g]));

/** One icon. The spark is the logo's star, lifted from <Spark> — never redrawn. */
function Icon({ id, size = 16 }: { id: string; size?: number }) {
  if (id === "spark") return <Spark size={size} />;
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {BY_ID[id]?.draw}
    </svg>
  );
}

/** Keyline overlay: the 2–14 live area, the 12-unit circle and the centre lines. */
function Keylines({ size }: { size: number }) {
  return (
    <svg className="ic-keys" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 0v16M0 8h16" />
    </svg>
  );
}

/** Toolbar order, left → right (CONTRACT §2). The AI is not a tool — it is the AI chat panel. */
const DOCK = ["select", "hand", "frame", "shape", "pen", "text", "sticky", "comment", "more"];
const INKS = [
  { id: "default", label: "Default" },
  { id: "muted", label: "Muted" },
  { id: "pressed", label: "Pressed" },
];

/* Magnified-plate node markers for the comment bubble (grid units). */
const NODES: [number, number][] = [
  [5, 2.5], [11, 2.5], [13.5, 5], [13.5, 13.5], [5, 13.5], [2.5, 11], [2.5, 5],
];

export default function Iconography() {
  const [keylines, setKeylines] = useState(false);
  const [ink, setInk] = useState("default");

  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Iconography"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Drawn in one hand, light enough to disappear.</h1>
          <p className="lede">
            {GLYPHS.length} icons, one line weight, rounded at every end. They sit at 16 in panels and
            menus and 18 in the toolbar, take their colour from whatever holds them, and stay out of the
            way of your work. The spark is the only filled one — it means the AI.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Stroke</dt><dd>1.5 px · round caps + joins</dd></div>
          <div><dt>Grid</dt><dd>16 × 16 · live area 2–14</dd></div>
          <div><dt>Sizes</dt><dd>16 panels and menus · 18 toolbar</dd></div>
          <div><dt>Colour</dt><dd>currentColor</dd></div>
        </dl>

        {/* ── Hero: every icon in its real home ─────────────────────────── */}
        <h2 data-no>In their places<span className="h2-aside">16 in the panels, 18 in the toolbar</span></h2>
        <div className="stage ic-hero">
          <div className="ic-artboard" aria-hidden="true">
            <div className="ic-artboard-top" />
            <div className="ic-artboard-body">
              <span className="ic-ab-line ic-ab-line--lg" />
              <span className="ic-ab-line" />
              <span className="ic-ab-btn" />
            </div>
          </div>
          <span className="ic-ab-label">Homepage</span>

          <button type="button" className="island ic-pill" aria-haspopup="menu" aria-expanded="false">
            <span aria-hidden="true"><Mark size={22} /></span>
            <span>Studio site</span>
            <span className="ic-vh">, Project menu</span>
            <span className="ic-pill-chev"><Icon id="chevron" /></span>
          </button>

          <div className="island island--pad ic-layers">
            <div className="ic-layers-hd">
              <span className="ic-layers-title"><Icon id="layers" /> Layers</span>
              <button className="icon-btn ic-sm" type="button" aria-label="Hide panels"><Icon id="collapse" /></button>
            </div>
            <div className="row-item" aria-current="true"><Icon id="frame" />Hero</div>
            <div className="row-item ic-indent"><Icon id="text" />Headline</div>
            <div className="row-item ic-indent"><Icon id="shape" />Badge</div>
            <div className="row-item"><Icon id="sticky" />Note from Tereza</div>
            <div className="row-item"><Icon id="comment" />Jonas · 2 replies</div>
          </div>
          <span className="ic-callout ic-callout--layers" aria-hidden="true">16 px in the panels</span>

          <div className="island ic-tr">
            <button className="icon-btn" type="button" aria-label="Search"><Icon id="search" /></button>
            <button className="icon-btn" type="button" aria-label="Comments"><Icon id="comment" /></button>
            <button className="btn btn--primary" type="button"><Icon id="share" /> Share</button>
            <button className="icon-btn" type="button" aria-label="Show right panels"><Icon id="panel-right" /></button>
          </div>

          <div className="island ic-ai-folded">
            <button className="icon-btn ic-ai-btn" type="button" aria-label="Open the AI chat panel"><Icon id="spark" /></button>
          </div>
          <span className="ic-callout ic-callout--ai" aria-hidden="true">AI chat panel, hidden to its spark</span>

          <div className="island dock ic-dock" role="toolbar" aria-label="Toolbar">
            {DOCK.map((id, i) => (
              <button key={id} className="icon-btn" type="button" aria-pressed={id === "more" ? undefined : i === 0} aria-label={BY_ID[id].name}>
                <Icon id={id} size={18} />
              </button>
            ))}
          </div>
          <span className="ic-callout ic-callout--dock" aria-hidden="true">18 px in the toolbar</span>
        </div>

        {/* ── The family ────────────────────────────────────────────────── */}
        <h2 data-no>The family<span className="h2-aside">every icon at 18 and 16, and where it lives</span></h2>
        <div className="ic-controls">
          <span className="seg" role="group" aria-label="Ink">
            {INKS.map((k) => (
              <button key={k.id} type="button" aria-pressed={ink === k.id} onClick={() => setInk(k.id)}>{k.label}</button>
            ))}
          </span>
          <label className="ic-switch-label">
            <button
              className="switch"
              type="button"
              role="switch"
              aria-checked={keylines}
              aria-label="Show keylines"
              onClick={() => setKeylines((v) => !v)}
            />
            Show keylines
          </label>
        </div>
        <div className="ic-family" data-ink={ink}>
          {GLYPHS.map((g) => (
            <div key={g.id} className={`ic-tile${g.id === "spark" ? " ic-tile--ai" : ""}`}>
              <div className="ic-wells">
                <span className="ic-well ic-well--18">
                  {keylines ? <Keylines size={18} /> : null}
                  <Icon id={g.id} size={18} />
                </span>
                <span className="ic-well ic-well--16">
                  {keylines ? <Keylines size={16} /> : null}
                  <Icon id={g.id} size={16} />
                </span>
              </div>
              <strong>{g.name}</strong>
              <span className="ic-home">{g.home}</span>
            </div>
          ))}
        </div>

        {/* ── Anatomy ───────────────────────────────────────────────────── */}
        <h2 data-no>Anatomy<span className="h2-aside">the comment bubble, at fourteen times</span></h2>
        <div className="ic-anatomy">
          <figure className="ic-plate">
            <svg viewBox="-1 -1 18 18" width="252" height="252" role="img" aria-label="Comment icon on its 16-unit grid">
              <g className="ic-plate-grid">
                {Array.from({ length: 17 }, (_, i) => (
                  <path key={`v${i}`} d={`M${i} 0V16M0 ${i}H16`} />
                ))}
              </g>
              <rect className="ic-plate-live" x="2" y="2" width="12" height="12" />
              <path
                className="ic-plate-stroke"
                d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              />
              <path
                className="ic-plate-spine"
                d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z"
              />
              {NODES.map(([x, y]) => (
                <circle key={`${x}-${y}`} className="ic-plate-node" cx={x} cy={y} r="0.22" />
              ))}
            </svg>
            <figcaption>Grid 16 · live area 2–14 · corner radius 2.5 · stroke 1.5</figcaption>
          </figure>
          <div className="ic-anatomy-notes">
            <div className="ic-lineage">
              <Mark size={44} />
              <span className="ic-lineage-arrow" aria-hidden="true">→</span>
              <span className="ic-lineage-ic"><Icon id="comment" size={18} /></span>
              <p>
                The comment bubble is cut from the logo tile: round on three corners, square on the
                bottom-right. A comment on the canvas and the app's own mark speak the same shape.
              </p>
            </div>
            <ol className="ic-anatomy-list">
              <li><strong>Keep to the live area.</strong> Shapes sit inside 2–14, so every icon carries the same air around it. Only points may reach past it.</li>
              <li><strong>Land on half-units.</strong> Strokes centre on .5 lines, so a 1.5 line falls on whole pixels at 16.</li>
              <li><strong>Round every end.</strong> Caps and joins are round — even the tip of the select arrow.</li>
            </ol>
          </div>
        </div>

        {/* ── Rules ─────────────────────────────────────────────────────── */}
        <h2 data-no>Four rules<span className="h2-aside">enough to draw the next icon yourself</span></h2>
        <div className="ic-rules">
          <article className="ic-rule">
            <div className="ic-rule-demo ic-weights">
              <span className="ic-weight ic-weight--thin"><i />0.75</span>
              <span className="ic-weight ic-weight--ok"><i />1.5</span>
              <span className="ic-weight ic-weight--heavy"><i />3</span>
            </div>
            <h3>Stroke · 1.5</h3>
            <p>One weight for the whole family. The line never scales — at 18 the shape grows, the stroke stays 1.5.</p>
          </article>
          <article className="ic-rule">
            <div className="ic-rule-demo">
              <svg width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              </svg>
              <svg width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" rx="1.5" />
              </svg>
            </div>
            <h3>Corners · 2.5 and 1.5</h3>
            <p>Containers (panels, bubbles, tabs) round at 2.5. Small shapes inside round at 1.5. Nothing is sharp.</p>
          </article>
          <article className="ic-rule">
            <div className="ic-rule-demo ic-rule-sizes">
              <span><Icon id="layers" size={16} /><small>16</small></span>
              <span><Icon id="layers" size={18} /><small>18</small></span>
            </div>
            <h3>Optical size · two steps</h3>
            <p>16 inside panels and menus, 18 in the toolbar where your hand lives. No 12, no 24 — bigger icons are illustrations.</p>
          </article>
          <article className="ic-rule">
            <div className="ic-rule-demo ic-rule-inks">
              <span className="ic-ink-default"><Icon id="pen" /></span>
              <span className="ic-ink-pressed"><Icon id="pen" /></span>
              <span className="ic-ink-ai"><Icon id="spark" /></span>
            </div>
            <h3>Colour · inherited</h3>
            <p>Icons take currentColor. Azure only behind a pressed tool; the spark wears its own colour only for the AI.</p>
          </article>
        </div>

        {/* ── Optical balance ───────────────────────────────────────────── */}
        <h2 data-no>Optical balance<span className="h2-aside">equal on the eye, not on the ruler</span></h2>
        <div className="ic-optical">
          <figure>
            <svg width="72" height="72" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect className="ic-opt-guide" x="2" y="2" width="12" height="12" />
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
            <figcaption>Square · 10 units</figcaption>
          </figure>
          <figure>
            <svg width="72" height="72" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect className="ic-opt-guide" x="2" y="2" width="12" height="12" />
              <circle cx="8" cy="8" r="5.75" />
            </svg>
            <figcaption>Circle · 11.5 units</figcaption>
          </figure>
          <figure>
            <svg width="72" height="72" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect className="ic-opt-guide" x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5 6.4 9.6 1.5 8l4.9-1.6z" className="ic-opt-spark" />
            </svg>
            <figcaption>Spark · reaches 13 units</figcaption>
          </figure>
          <p className="ic-optical-note">
            Round shapes and points look smaller than squares of the same size, so they reach a little
            further. The circle is 1.5 units wider than the square; the spark's four points run half a unit
            past the live area.
            Line them up in a row and they read as one size.
          </p>
        </div>

        {/* ── Right / wrong ─────────────────────────────────────────────── */}
        <h2 data-no>One family, or it shows</h2>
        <div className="ic-compare">
          <figure className="ic-case">
            <div className="stage ic-mini">
              <div className="island dock ic-mini-dock">
                {["select", "hand", "frame", "shape", "pen", "text", "sticky", "comment", "more"].map((id, i) => (
                  <button key={id} className="icon-btn" type="button" aria-pressed={id === "more" ? undefined : i === 0} aria-label={BY_ID[id].name} tabIndex={-1}>
                    <Icon id={id} size={18} />
                  </button>
                ))}
              </div>
            </div>
            <figcaption><strong className="ic-ok">Right</strong> One weight, round ends, quiet ink, in toolbar order. The pressed tool is the only azure — the AI has its own panel, not a slot here.</figcaption>
          </figure>
          <figure className="ic-case">
            <div className="stage ic-mini">
              <div className="island dock ic-mini-dock ic-wrong" aria-hidden="true">
                <span className="icon-btn"><svg width="18" height="18" viewBox="0 0 16 16"><path d="M3 2l10 5-4.5 1.5L7 13z" fill="currentColor" /></svg></span>
                <span className="icon-btn"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.6"><path d="M5 1v14M11 1v14M1 5h14M1 11h14" /></svg></span>
                <span className="icon-btn"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="miter"><path d="M11 2l3 3-8 8H3v-3z" /></svg></span>
                <span className="icon-btn"><svg width="18" height="18" viewBox="0 0 16 16"><text x="2" y="13" className="ic-wrong-glyph">T</text></svg></span>
                <span className="icon-btn"><span className="ic-wrong-sticky" /></span>
                <span className="divider-v" />
                <span className="icon-btn"><svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" className="ic-wrong-ai" /></svg></span>
              </div>
            </div>
            <figcaption><strong className="ic-bad">Wrong</strong> A filled arrow, a hairline frame, a heavy square pen, a letter for text, a coloured sticky, and a blob for the AI parked in the toolbar. Six icons, six families.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · iconography · {GLYPHS.length} glyphs, inline SVG — the menu's glyphs included</span>
        <span>The spark is lifted from the logo — assets/logos/spark.svg</span>
      </footer>
    </>
  );
}
