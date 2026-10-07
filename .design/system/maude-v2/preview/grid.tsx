/**
 * SPECIMEN — grid · maude-v2
 *
 * DEMONSTRATES: --layout-max-w (none), --layout-gutter, --canvas-grid, --canvas-dot,
 *               --space-4 as the island inset from the window edge.
 * COMPOSITION:  the reference template's 12-column overlay is replaced on purpose — Maude has
 *               no page max-width and no columns on the canvas: the window IS the canvas.
 *               Hero = a live window with the four corner anchors (menu pill top-left, Share
 *               top-right, dock bottom-center, AI chat panel bottom-right), switchable inset
 *               guides, and a Wide / Narrow control that shows islands folding into icons
 *               instead of reflowing into columns. Then the dot grid at three zooms with an
 *               object snapped to it, an anchor table with a tiny position glyph per island,
 *               and the one surface that does use columns — Home.
 * COPY VOICE:   terse role labels, everyday nouns.
 * NOTES:        Corners, not columns. Chrome floats 16 from the edge and never frames the canvas.
 */
import { useState } from "react";
import "./_layout.css";
import "./grid.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Width = "wide" | "narrow";

const ANCHORS = [
  { island: "Menu pill", where: "Top-left", inset: "16 · 16", folds: "Nothing to fold — it already is the icon. Everything hidden lives in its menu.", glyph: "tl" },
  { island: "Canvases & layers", where: "Top-left, under the pill", inset: "16 · 68", folds: "A list icon", glyph: "tl2" },
  { island: "Share", where: "Top-right", inset: "16 · 16", folds: "Stays — the one primary action", glyph: "tr" },
  { island: "Dock", where: "Bottom-center", inset: "16 from the bottom", folds: "The current tool", glyph: "bc" },
  { island: "AI chat panel", where: "Bottom-right, above the dock", inset: "16 · 92", folds: "The spark", glyph: "br" },
];

const ZOOMS = [
  { z: 0.5, label: "50 %", cls: "gr-z50" },
  { z: 1, label: "100 %", cls: "gr-z100" },
  { z: 2, label: "200 %", cls: "gr-z200" },
];

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="3" width="3" height="3" rx="0.8" /><rect x="2" y="10" width="3" height="3" rx="0.8" /><path d="M8 4.5h6M8 11.5h6" />
    </svg>
  );
}

export default function Grid() {
  const [width, setWidth] = useState<Width>("wide");
  const [guides, setGuides] = useState(true);
  const narrow = width === "narrow";

  return (
    <>
      <SpecimenHeader crumbs={["Layout", "Grid"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>No columns. The window is the canvas.</h1>
          <p className="lede">
            Maude has no page width and no column grid. The canvas runs edge to edge, and the chrome
            is placed by corners: each island anchors to one, sixteen pixels in. When the window gets
            smaller nothing reflows — side islands fold into their icons and the canvas keeps the room.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Max width</dt><dd>none</dd></div>
          <div><dt>Canvas grid</dt><dd>dots every 20 px</dd></div>
          <div><dt>Island inset</dt><dd>16 px from every edge</dd></div>
          <div><dt>Layout gutter</dt><dd>24 px — Home and sheets only</dd></div>
        </dl>

        {/* ── Hero: the window ───────────────────────────────────────────── */}
        <div className="gr-hero-hd">
          <h2 data-no>Four corners<span className="h2-aside">islands anchor to the window, not to a column</span></h2>
          <div className="gr-controls">
            <span className="seg" role="group" aria-label="Window width">
              <button type="button" aria-pressed={!narrow} onClick={() => setWidth("wide")}>Wide</button>
              <button type="button" aria-pressed={narrow} onClick={() => setWidth("narrow")}>Narrow</button>
            </span>
            <label className="gr-switch-label">
              <button type="button" className="switch" role="switch" aria-checked={guides} aria-label="Show guides" onClick={() => setGuides((v) => !v)} />
              Guides
            </label>
          </div>
        </div>

        <div className="gr-stagewrap">
          <span className="gr-win-label">Studio site · {narrow ? "narrow window" : "full window"}</span>
          <div className={`gr-window${narrow ? " gr-window--narrow" : ""}`}>
            {/* canvas content */}
            <div className="gr-artboard">
              <span className="gr-ab-label">Homepage</span>
              <div className="gr-ab-img" />
              <div className="gr-ab-lines"><span /><span /><span /></div>
            </div>
            <div className="sticky sticky--yellow gr-st1">Bigger photo in the hero?</div>
            <div className="sticky sticky--lilac gr-st2">Mobile first</div>

            {/* guides */}
            {guides ? (
              <div className="gr-guides" aria-hidden="true">
                <span className="gr-inset" />
                <i className="gr-tag gr-tag--t">16</i>
                <i className="gr-tag gr-tag--b">16</i>
                <i className="gr-tag gr-tag--l">16</i>
                <i className="gr-tag gr-tag--r">16</i>
                <span className="gr-anchor gr-a-tl" />
                <span className="gr-anchor gr-a-tr" />
                <span className="gr-anchor gr-a-bc" />
                <span className={`gr-anchor ${narrow ? "gr-a-br-low" : "gr-a-br"}`} />
                {!narrow ? <span className="gr-dockline" /> : null}
              </div>
            ) : null}

            {/* top-left */}
            <div className="island gr-pill">
              <Mark size={22} />
              <span>Homepage</span>
              <svg className="gr-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 6.5l3 3 3-3" /></svg>
            </div>
            {narrow ? (
              <div className="island gr-folded gr-list-icon">
                <button className="icon-btn" type="button" aria-label="Show canvases"><ListIcon /></button>
              </div>
            ) : (
              <div className="island island--pad gr-list">
                <p className="island-title">Canvases</p>
                <div className="row-item" aria-current="true"><span className="thumb gr-th-coral" />Homepage</div>
                <div className="row-item"><span className="thumb gr-th-yellow" />Onboarding</div>
                <div className="row-item"><span className="thumb gr-th-green" />Pricing</div>
              </div>
            )}

            {/* top-right */}
            <div className="island gr-tr">
              <button className="icon-btn" type="button" aria-label="Hide panels" aria-keyshortcuts="Meta+Backslash">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
              </button>
              <button className="btn btn--primary" type="button">Share</button>
            </div>

            {/* bottom-right */}
            {narrow ? (
              <div className="island gr-folded gr-ai-icon">
                <button className="icon-btn" type="button" aria-label="Open AI chat panel"><Spark size={16} color="var(--spark)" /></button>
              </div>
            ) : (
              <div className="island island--pad gr-ai">
                <div className="gr-ai-hd"><Spark size={14} color="var(--spark)" /> AI</div>
                <div className="ask">
                  <input aria-label="Ask AI" placeholder="Ask AI…" />
                  <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
                </div>
              </div>
            )}

            {/* bottom-center */}
            <div className="island dock gr-dock">
              <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
              </button>
              <button className="icon-btn" type="button" aria-label="Frame">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h12M2 11h12M5 2v12M11 2v12" /></svg>
              </button>
              <button className="icon-btn" type="button" aria-label="Text">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M8 4v9" /></svg>
              </button>
              <span className="divider-v" />
              {["yellow", "green", "lilac"].map((c, i) => (
                <button key={c} className="icon-btn" type="button" aria-label={`${c} sticky`}>
                  <span className={`gr-dock-sticky gr-ds-${c}`} style={{ rotate: `${[-6, 4, -3][i]}deg` }} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="gr-caption">
          {narrow
            ? "Narrow: the canvases list and the AI chat panel fold into their icons. The pill, Share and the dock keep their corners; the canvas keeps the middle."
            : "Wide: every island sits sixteen in from its corner. The AI chat panel rides one row above the dock, so the two never meet."}
        </p>

        {/* ── Dot grid ───────────────────────────────────────────────────── */}
        <h2 data-no>The dot grid<span className="h2-aside">20 px at 100 %, and it follows the zoom</span></h2>
        <div className="gr-zooms">
          {ZOOMS.map((z) => (
            <figure className="gr-zoom" key={z.label}>
              <div className={`gr-dots ${z.cls}`}>
                <div className="gr-snap" aria-hidden="true">
                  <span>Move the CTA up</span>
                </div>
                {z.z === 1 ? (
                  <span className="gr-measure" aria-hidden="true"><i className="gr-tag gr-tag--m">20</i></span>
                ) : null}
              </div>
              <figcaption><strong>{z.label}</strong>{z.z === 1 ? " — corners land on dots" : z.z < 1 ? " — the same sticky, half the pitch" : " — the same sticky, twice the pitch"}</figcaption>
            </figure>
          ))}
        </div>
        <p className="gr-caption">
          Artboards and stickies snap to the dots, and the pitch scales with zoom — so an object that
          sits on the grid at 100 % still sits on it at every other zoom.
        </p>

        {/* ── Anchor table ───────────────────────────────────────────────── */}
        <h2 data-no>Corners, not columns<span className="h2-aside">where each island lives and what it folds into</span></h2>
        <div className="gr-table" role="table" aria-label="Island anchors">
          <div className="gr-tr-row gr-th" role="row">
            <span role="columnheader" />
            <span role="columnheader">Island</span>
            <span role="columnheader">Anchor</span>
            <span role="columnheader">Inset</span>
            <span role="columnheader">Folds into</span>
          </div>
          {ANCHORS.map((a) => (
            <div className="gr-tr-row" role="row" key={a.island}>
              <span role="cell"><span className={`gr-glyph gr-g-${a.glyph}`} aria-hidden="true"><i /></span></span>
              <span role="cell" className="gr-t-island">{a.island}</span>
              <span role="cell">{a.where}</span>
              <span role="cell" className="gr-t-num">{a.inset}</span>
              <span role="cell" className="gr-t-folds">{a.folds}</span>
            </div>
          ))}
        </div>

        {/* ── Home grid ──────────────────────────────────────────────────── */}
        <h2 data-no>Where columns do appear<span className="h2-aside">Home is a page, not a canvas</span></h2>
        <div className="gr-home">
          <div className="island gr-home-pill"><Mark size={20} /><span>Home</span></div>
          <span className="gr-home-h">Recent projects</span>
          <div className="gr-home-grid">
            {[
              { n: "Studio site", m: "4 canvases · edited 2 min ago", c: "gr-th-coral" },
              { n: "Alligators brand", m: "7 canvases · edited yesterday", c: "gr-th-green" },
              { n: "Onboarding refresh", m: "2 canvases · edited Monday", c: "gr-th-lilac" },
            ].map((p) => (
              <div className="gr-proj" key={p.n}>
                <div className={`gr-proj-img ${p.c}`} />
                <strong>{p.n}</strong>
                <span>{p.m}</span>
              </div>
            ))}
            <button className="gr-proj gr-proj--new" type="button">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
              New project
            </button>
          </div>
        </div>
        <p className="gr-caption">
          Project cards fill the width in as many columns as fit, 24 apart. Still no max width — a
          bigger window simply shows more projects per row.
        </p>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · grid</span>
        <span>--layout-max-w: none · --canvas-grid 20 px · inset 16</span>
      </footer>
    </>
  );
}
