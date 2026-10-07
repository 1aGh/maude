/**
 * SPECIMEN — borders · maude-v2
 *
 * DEMONSTRATES: --border-subtle, --border-default, --border-strong (alpha of ink, so one
 *   token sits on every surface), --island-edge (the 0.5px inner edge that, with
 *   --island-shadow, defines an island), the state edges (--accent selection + focus,
 *   --status-error), and dividers inside islands.
 * COMPOSITION: hero = an island on the canvas next to a magnifying loupe of its corner
 *   (shadow · 0.5px edge · body), with a live switch between the real edge, the old 1px
 *   hairline box and no edge; an ink-on-surface matrix; dividers inside a real icon-menu
 *   island (space first, a line only when the kind of thing changes); state edges in
 *   context; and a right/wrong panel on why hairline-boxed density is not the look.
 * COPY VOICE: plain role labels, everyday nouns.
 * NOTES: every edge is drawn as an inset box-shadow, never a CSS border, so edges never
 *   shift layout and nest cleanly with the concentric radii (island 14 › control 10 › chip 6).
 */
import { useId, useState } from "react";
import "./_layout.css";
import "./borders.css";
import { Mark, SpecimenHeader } from "./_specimen-controls";

type EdgeMode = "edge" | "hairline" | "none";
const MODES: { id: EdgeMode; label: string }[] = [
  { id: "edge", label: "0.5 px edge" },
  { id: "hairline", label: "1 px box" },
  { id: "none", label: "No edge" },
];

const INKS = [
  { token: "--border-subtle", cls: "subtle", light: "ink · 7%", dark: "white · 6%", use: "Dividers inside islands, resting input wells." },
  { token: "--border-default", cls: "default", light: "ink · 12%", dark: "white · 11%", use: "Canvas thumbnails, key caps, the specimen tiles on this page." },
  { token: "--border-strong", cls: "strong", light: "ink · 24%", dark: "white · 20%", use: "Hover on a thumbnail, leader lines, a drop target." },
  { token: "--island-edge", cls: "island", light: "ink · 10% · 0.5 px", dark: "white · 9% · 0.5 px", use: "Islands only — always with the island shadow." },
];
const SURFACES = [
  { token: "--bg-0", name: "Canvas", cls: "s0" },
  { token: "--bg-1", name: "Island", cls: "s1" },
  { token: "--bg-2", name: "Menu", cls: "s2" },
  { token: "--bg-3", name: "Input well", cls: "s3" },
];

/** The island corner at six times — shadow, 0.5px inner edge, frosted body. */
function Loupe({ mode }: { mode: EdgeMode }) {
  const uid = useId().replace(/:/g, "");
  const blur = `bd-blur-${uid}`;
  const dots = `bd-dots-${uid}`;
  const clip = `bd-clip-${uid}`;
  // 0.5px × 6 = 3 units, drawn inside the shape (inset by half the stroke).
  const edgeW = mode === "hairline" ? 6 : 3;
  return (
    <svg className="bd-loupe-svg" viewBox="0 0 300 300" role="img" aria-label="A panel corner magnified six times">
      <defs>
        <filter id={blur} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <pattern id={dots} width="120" height="120" patternUnits="userSpaceOnUse">
          <circle className="bd-l-dot" cx="60" cy="60" r="6" />
        </pattern>
        <clipPath id={clip}>
          <circle cx="150" cy="150" r="150" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect className="bd-l-canvas" width="300" height="300" />
        <rect width="300" height="300" fill={`url(#${dots})`} />
        {mode !== "hairline" ? (
          <rect className="bd-l-shadow" x="84" y="114" width="420" height="420" rx="84" filter={`url(#${blur})`} />
        ) : null}
        <rect className="bd-l-body" x="78" y="78" width="420" height="420" rx="84" />
        {mode !== "none" ? (
          <rect
            className={mode === "hairline" ? "bd-l-edge bd-l-edge--box" : "bd-l-edge"}
            x={78 + edgeW / 2}
            y={78 + edgeW / 2}
            width={420 - edgeW}
            height={420 - edgeW}
            rx={84 - edgeW / 2}
            strokeWidth={edgeW}
          />
        ) : null}
        <g className="bd-l-content">
          <rect x="132" y="150" width="34" height="24" rx="5" />
          <rect x="182" y="156" width="96" height="12" rx="6" />
          <rect x="132" y="204" width="34" height="24" rx="5" />
          <rect x="182" y="210" width="72" height="12" rx="6" />
        </g>
      </g>
    </svg>
  );
}

export default function Borders() {
  const [mode, setMode] = useState<EdgeMode>("edge");

  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Borders"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Edges, not boxes.</h1>
          <p className="lede">
            Borders here are ink at low strength, so the same token reads right on the canvas, an island or
            an input. Islands get a half-pixel edge on the inside and a soft shadow underneath — that is
            what makes them float. Nothing gets a 1 px box drawn around it.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Family</dt><dd>alpha of ink</dd></div>
          <div><dt>Island edge</dt><dd>0.5 px, inside</dd></div>
          <div><dt>Drawn as</dt><dd>inset shadow — no layout shift</dd></div>
          <div><dt>Themes</dt><dd>light (default) · dark</dd></div>
        </dl>

        {/* ── Hero: the island edge, up close ──────────────────────────── */}
        <h2 data-no>The island edge, up close<span className="h2-aside">half a pixel does most of the work</span></h2>
        <div className="bd-hero">
          <div className={`stage bd-stage bd-mode-${mode}`}>
            <div className="bd-artboard" aria-hidden="true"><span /></div>
            <div className="island island--pad bd-island">
              <div className="bd-island-hd">
                <Mark size={18} />
                <span>Studio site</span>
              </div>
              <p className="island-title">Canvases</p>
              <div className="row-item" aria-current="true"><span className="thumb bd-th-sky" />Homepage</div>
              <div className="row-item"><span className="thumb bd-th-yellow" />Onboarding</div>
              <div className="row-item"><span className="thumb bd-th-green" />Pricing</div>
            </div>
            <span className="bd-loupe-ring" aria-hidden="true" />
          </div>

          <div className="bd-loupe-side">
            <div className="bd-loupe">
              <Loupe mode={mode} />
              <span className="bd-pin bd-pin--1">1</span>
              <span className="bd-pin bd-pin--2">2</span>
              <span className="bd-pin bd-pin--3">3</span>
            </div>
            <ol className="bd-legend">
              <li><strong>Shadow</strong> <code>--island-shadow</code> lifts the island off the canvas.</li>
              <li><strong>Edge</strong> <code>--island-edge</code>, 0.5 px on the inside, catches the light.</li>
              <li><strong>Body</strong> <code>--island-bg</code>, 88% frost — never see-through.</li>
            </ol>
            <span className="seg" role="group" aria-label="Edge">
              {MODES.map((m) => (
                <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
              ))}
            </span>
            <p className="bd-mode-note">
              {mode === "edge" && "The real thing. The edge is barely there, the shadow does the lifting."}
              {mode === "hairline" && "The old look. A full pixel, no shadow — the island turns into a box sitting on the canvas."}
              {mode === "none" && "Shadow alone. On a light canvas the island's rim goes soft and melts into the dot grid."}
            </p>
          </div>
        </div>

        {/* ── Ink on every surface ─────────────────────────────────────── */}
        <h2 data-no>Ink on every surface<span className="h2-aside">one token, four backgrounds, no retuning</span></h2>
        <div className="bd-matrix" role="table" aria-label="Border tokens on each surface">
          <div className="bd-mx-row bd-mx-head" role="row">
            <span role="columnheader">Token</span>
            {SURFACES.map((s) => (
              <span key={s.token} role="columnheader">{s.name}<small>{s.token}</small></span>
            ))}
            <span role="columnheader">Where it goes</span>
          </div>
          {INKS.map((k) => (
            <div key={k.token} className="bd-mx-row" role="row">
              <span role="rowheader" className="bd-mx-token">
                <code>{k.token}</code>
                <small className="bd-mx-light">{k.light}</small>
                <small className="bd-mx-dark">{k.dark}</small>
              </span>
              {SURFACES.map((s) => (
                <span key={s.token} role="cell" className={`bd-cell bd-${s.cls}`}>
                  <i className={`bd-rule bd-rule--${k.cls}`} />
                  <i className={`bd-box bd-box--${k.cls}`} />
                </span>
              ))}
              <span role="cell" className="bd-mx-use">{k.use}</span>
            </div>
          ))}
        </div>
        <pre className="bd-code"><code>{`/* an island */
box-shadow: var(--island-shadow), inset 0 0 0 0.5px var(--island-edge);

/* a thumbnail on the canvas list */
box-shadow: inset 0 0 0 0.5px var(--border-default);`}</code></pre>

        {/* ── Dividers inside islands ──────────────────────────────────── */}
        <h2 data-no>Dividers inside islands<span className="h2-aside">space first, a line only when the kind changes</span></h2>
        <div className="bd-dividers">
          <figure className="bd-dv-case">
            <div className="stage bd-dv-stage">
              <div className="island bd-menu" role="menu" aria-label="Project menu">
                <div className="bd-menu-hd"><Mark size={20} /><span>Studio site</span></div>
                <span className="bd-menu-item" role="menuitem">New canvas<span className="kbd">⌘N</span></span>
                <span className="bd-menu-item" role="menuitem">Open project…<span className="kbd">⌘O</span></span>
                <hr className="bd-sep" />
                <span className="bd-menu-item" role="menuitem">Version history</span>
                <span className="bd-menu-item" role="menuitem">Export…</span>
                <span className="bd-menu-item" role="menuitem">Share</span>
                <hr className="bd-sep" />
                <span className="bd-menu-item" role="menuitem">Settings<span className="kbd">⌘,</span></span>
                <span className="bd-menu-item bd-menu-item--quiet" role="menuitem">Advanced<span className="bd-menu-caret">›</span></span>
              </div>
            </div>
            <figcaption><strong>A line between kinds.</strong> Make, then manage, then the app itself. Lines are <code>--border-subtle</code>, inset from both sides, so they never touch the island's edge.</figcaption>
          </figure>
          <figure className="bd-dv-case">
            <div className="stage bd-dv-stage">
              <div className="island island--pad bd-panel">
                <p className="island-title">On this canvas</p>
                <div className="row-item"><span className="thumb bd-th-sky" />Hero</div>
                <div className="row-item"><span className="thumb bd-th-coral" />Pricing table</div>
                <div className="bd-gap" />
                <p className="island-title">People</p>
                <div className="row-item"><span className="bd-avatar bd-av-1">T</span>Tereza</div>
                <div className="row-item"><span className="bd-avatar bd-av-2">J</span>Jonas</div>
              </div>
            </div>
            <figcaption><strong>Space between groups.</strong> Two lists of the same weight are split by 12 px and a small heading. No line needed.</figcaption>
          </figure>
          <figure className="bd-dv-case">
            <div className="stage bd-dv-stage">
              <div className="island bd-panel bd-panel--ruled" aria-hidden="true">
                <p className="island-title">On this canvas</p>
                <div className="row-item"><span className="thumb bd-th-sky" />Hero</div>
                <div className="row-item"><span className="thumb bd-th-coral" />Pricing table</div>
                <p className="island-title">People</p>
                <div className="row-item"><span className="bd-avatar bd-av-1">T</span>Tereza</div>
                <div className="row-item"><span className="bd-avatar bd-av-2">J</span>Jonas</div>
              </div>
            </div>
            <figcaption><strong className="bd-bad">Wrong</strong> A full-width rule under every row. The island becomes a table and the eye counts lines instead of reading names.</figcaption>
          </figure>
        </div>

        {/* ── State edges ──────────────────────────────────────────────── */}
        <h2 data-no>Edges that mean something<span className="h2-aside">azure for selection and focus, error always with words</span></h2>
        <div className="bd-states">
          <div className="bd-state">
            <div className="stage bd-state-stage">
              <div className="bd-sel-artboard">
                <span className="bd-sel" aria-hidden="true" />
                <span className="bd-sel-label">Pricing</span>
              </div>
            </div>
            <h3>Selected on the canvas</h3>
            <p>2 px azure, outside the artboard, its radius one step rounder so the corners stay parallel.</p>
          </div>
          <div className="bd-state">
            <div className="bd-state-well">
              <div className="field">
                <label className="field-label" htmlFor="bd-name-rest">Canvas name</label>
                <input id="bd-name-rest" className="input" defaultValue="Mobile — detail" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="bd-name-focus">Canvas name</label>
                <input id="bd-name-focus" className="input bd-focused" defaultValue="Onboarding" />
              </div>
            </div>
            <h3>Resting and focused</h3>
            <p>A resting well has only a whisper of an edge. Focus brings a 3 px halo and a 1 px azure line.</p>
          </div>
          <div className="bd-state">
            <div className="bd-state-well">
              <div className="field">
                <label className="field-label" htmlFor="bd-name-err">Canvas name</label>
                <input id="bd-name-err" className="input bd-error" defaultValue="Homepage" aria-invalid="true" aria-describedby="bd-name-err-hint" />
                <span id="bd-name-err-hint" className="field-hint bd-error-hint">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.75V8.5M8 11.25v.01" /></svg>
                  There's already a Homepage in this project.
                </span>
              </div>
            </div>
            <h3>Something's off</h3>
            <p>Error colour on the edge, an icon and a sentence beside it. Colour alone never carries the message.</p>
          </div>
          <div className="bd-state">
            <div className="stage bd-state-stage bd-drop-stage">
              <div className="bd-drop">
                <span>Drop images on the canvas</span>
              </div>
            </div>
            <h3>Drop target</h3>
            <p>The one dashed edge in the system, in <code>--border-strong</code> — it appears only while you drag.</p>
          </div>
        </div>

        {/* ── Right / wrong ────────────────────────────────────────────── */}
        <h2 data-no>Why hairline boxes are not the look</h2>
        <div className="bd-compare">
          <figure className="bd-case">
            <div className="stage bd-cmp-stage">
              <div className="island island--pad bd-cmp-panel">
                <p className="island-title">Layers</p>
                <div className="row-item" aria-current="true"><span className="thumb bd-th-sky" />Hero</div>
                <div className="row-item"><span className="thumb bd-th-yellow" />Headline</div>
                <div className="row-item"><span className="thumb bd-th-green" />Sign-up button</div>
                <div className="row-item"><span className="thumb bd-th-coral" />Note from Tereza</div>
              </div>
            </div>
            <figcaption><strong className="bd-ok">Right</strong> One soft shape. Rows are separated by air; selection is a fill, not a frame. The canvas stays the loudest thing.</figcaption>
          </figure>
          <figure className="bd-case">
            <div className="stage bd-cmp-stage">
              <div className="bd-old" aria-hidden="true">
                <div className="bd-old-hd">LAYERS <span>[4]</span></div>
                <div className="bd-old-row bd-old-row--sel">Hero</div>
                <div className="bd-old-row">Headline</div>
                <div className="bd-old-row">Sign-up button</div>
                <div className="bd-old-row">Note from Tereza</div>
                <div className="bd-old-ft">4 items</div>
              </div>
            </div>
            <figcaption><strong className="bd-bad">Wrong</strong> A box, boxes inside it, a boxed header and footer. Every line competes with the artboards on the canvas, and the panel reads as a developer tool.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · borders · alpha-of-ink + the 0.5 px island edge</span>
        <span>Tokens: colors_and_type.css — Borders and Island blocks</span>
      </footer>
    </>
  );
}
