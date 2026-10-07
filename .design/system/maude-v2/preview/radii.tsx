/**
 * SPECIMEN — radii · maude-v2
 *
 * DEMONSTRATES: --radius-xs, --radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-pill —
 *               soft concentric corners: island 14 › control 10 › chip 6, dock 20, pill.
 * COMPOSITION:  hero = three real islands magnified (Share, the Ask field, the dock) with each
 *               corner's circle drawn in — when outer = inner + padding the circles share one
 *               centre, which is what makes the corners feel nested; a padding playground that
 *               recomputes the inner radius live and shows the off-centre circle of the
 *               "same radius" mistake; the ladder with every corner magnified ×4 beside its real
 *               component; radii on the canvas (sticky, artboard, selection ring, comment); and a
 *               right/wrong pair.
 * COPY VOICE:   terse role labels.
 * NOTES:        Pill is 999 px, never a percentage. Past ~8 px of padding, stop subtracting —
 *               the inner shape takes its own step from the ladder.
 */
import { useState } from "react";
import "./_layout.css";
import "./radii.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

type Pad = 1 | 2 | 3;
const PAD_PX: Record<Pad, number> = { 1: 4, 2: 8, 3: 12 };

const LADDER = [
  { t: "--radius-xs", px: "4", uses: "Keys, stickies, thumbnails", cls: "rd-r-xs", demo: "kbd" },
  { t: "--radius-sm", px: "6", uses: "Chips, list rows, artboards", cls: "rd-r-sm", demo: "chip" },
  { t: "--radius-md", px: "10", uses: "Buttons, fields, icon buttons — every control", cls: "rd-r-md", demo: "btn" },
  { t: "--radius-lg", px: "14", uses: "Islands, the Ask field, large buttons", cls: "rd-r-lg", demo: "island" },
  { t: "--radius-xl", px: "20", uses: "The dock, sheets", cls: "rd-r-xl", demo: "dock" },
  { t: "--radius-pill", px: "999", uses: "Avatars, the AI's cursor label, switches", cls: "rd-r-pill", demo: "pill" },
];

/** A dashed circle drawn at one of an element's top corners, with a dot at its centre. */
function Circle({ kind, corner = "tl" }: { kind: "o" | "i"; corner?: "tl" | "tr" }) {
  return (
    <span className={`rd-circ rd-circ--${kind} rd-circ--${corner}`} aria-hidden="true">
      <span className="rd-ctr" />
    </span>
  );
}

function LadderDemo({ demo }: { demo: string }) {
  switch (demo) {
    case "kbd":
      return <span className="rd-demo-row"><span className="kbd">⌘</span><span className="kbd">\</span><span className="rd-mini-sticky" /></span>;
    case "chip":
      return <span className="rd-demo-row"><span className="chip">Homepage</span><span className="chip chip--accent">◆ hero</span></span>;
    case "btn":
      return <span className="rd-demo-row"><button className="btn" type="button">Duplicate</button><input className="input rd-demo-input" aria-label="Rename" defaultValue="Pricing" /></span>;
    case "island":
      return <span className="island rd-demo-island"><span className="island-title rd-it">Canvases</span><span className="row-item" aria-current="true">Homepage</span></span>;
    case "dock":
      return (
        <span className="island dock rd-demo-dock">
          <span className="icon-btn" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg></span>
          <span className="icon-btn" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M8 4v9" /></svg></span>
        </span>
      );
    default:
      return (
        <span className="rd-demo-row">
          <span className="rd-av">T</span>
          <span className="rd-av rd-av--2">J</span>
          <span className="rd-agent"><Spark size={10} color="var(--spark-fg)" /> AI</span>
          <button type="button" className="switch" role="switch" aria-checked="true" aria-label="Snap to dots" />
        </span>
      );
  }
}

export default function Radii() {
  const [pad, setPad] = useState<Pad>(1);
  const [same, setSame] = useState(false);
  const [circles, setCircles] = useState(true);

  const innerExpr = same ? "var(--radius-lg)" : `calc(var(--radius-lg) - var(--space-${pad}))`;
  const innerPx = same ? 14 : 14 - PAD_PX[pad];

  return (
    <>
      <SpecimenHeader crumbs={["Shape", "Radii"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Soft corners that nest.</h1>
          <p className="lede">
            Every corner in Maude is soft, and corners inside corners share a centre: the outer radius
            is the inner radius plus the padding between them. That is why an island and the button in
            it read as one object. Six steps, nothing in between.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Island</dt><dd>14</dd></div>
          <div><dt>Control</dt><dd>10</dd></div>
          <div><dt>Chip</dt><dd>6</dd></div>
          <div><dt>Dock</dt><dd>20</dd></div>
          <div><dt>Rule</dt><dd>outer = inner + padding</dd></div>
        </dl>

        {/* ── Hero: nesting on real islands ─────────────────────────────── */}
        <div className="rd-hero-hd">
          <h2 data-no>Corners that nest<span className="h2-aside">real islands at 2×, each corner's circle drawn in</span></h2>
          <label className="rd-switch-label">
            <button type="button" className="switch" role="switch" aria-checked={circles} aria-label="Show circles" onClick={() => setCircles((v) => !v)} />
            Show circles
          </label>
        </div>
        <div className="stage rd-hero" data-circles={circles}>
          <figure className="rd-nest">
            <div className="rd-mag">
              <div className="island rd-share">
                {circles ? <Circle kind="o" /> : null}
                <span className="icon-btn rd-rel" aria-hidden="true">
                  {circles ? <Circle kind="i" /> : null}
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
                </span>
                <span className="btn btn--primary">Share</span>
              </div>
            </div>
            <figcaption><span className="rd-eq">14 = 10 + 4</span>Share island · control inside a 4 px edge</figcaption>
          </figure>

          <figure className="rd-nest">
            <div className="rd-mag">
              <div className="ask rd-ask">
                {circles ? <Circle kind="o" corner="tr" /> : null}
                <span className="rd-ask-ph">Ask AI…</span>
                <span className="send rd-rel" aria-hidden="true">
                  {circles ? <Circle kind="i" corner="tr" /> : null}
                  <Spark size={12} color="var(--spark-fg)" />
                </span>
              </div>
            </div>
            <figcaption><span className="rd-eq">14 = 10 + 4</span>The Ask field · send button in its corner</figcaption>
          </figure>

          <figure className="rd-nest">
            <div className="rd-mag">
              <div className="island dock rd-dock">
                {circles ? <Circle kind="o" /> : null}
                <span className="icon-btn rd-rel rd-pressed" aria-hidden="true">
                  {circles ? <Circle kind="i" /> : null}
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
                </span>
                <span className="icon-btn" aria-hidden="true"><span className="rd-dock-sticky" /></span>
              </div>
            </div>
            <figcaption><span className="rd-eq">20 = 12 + 8</span>Dock · rounder, with an 8 px edge</figcaption>
          </figure>
        </div>
        <p className="rd-caption">
          One centre, two arcs: the inner corner runs parallel to the outer one, so the gap between
          them stays the same width all the way round the bend.
        </p>

        {/* ── Playground ─────────────────────────────────────────────────── */}
        <h2 data-no>Try the padding<span className="h2-aside">the inner radius follows</span></h2>
        <div className="rd-play">
          <div className="rd-play-controls">
            <div className="field">
              <span className="field-label" id="rd-pad-label">Padding</span>
              <span className="seg" role="group" aria-labelledby="rd-pad-label">
                {([1, 2, 3] as Pad[]).map((p) => (
                  <button key={p} type="button" aria-pressed={pad === p} onClick={() => setPad(p)}>{PAD_PX[p]}</button>
                ))}
              </span>
            </div>
            <div className="field">
              <span className="field-label" id="rd-mode-label">Inner corner</span>
              <span className="seg" role="group" aria-labelledby="rd-mode-label">
                <button type="button" aria-pressed={!same} onClick={() => setSame(false)}>Concentric</button>
                <button type="button" aria-pressed={same} onClick={() => setSame(true)}>Same radius</button>
              </span>
            </div>
            <div className="rd-readout">
              <span className="rd-readout-eq">{same ? `14 ≠ 14 + ${PAD_PX[pad]}` : `14 = ${innerPx} + ${PAD_PX[pad]}`}</span>
              <span className="rd-readout-note">
                {same
                  ? "Same radius inside and out: the inner circle sits off-centre and the gap pinches at the bend."
                  : pad === 3
                    ? "At 12 the inner corner is nearly square. Past 8, stop subtracting — give it its own step (rows in an island use 6)."
                    : "Inner radius = 14 − padding. The two circles share a centre."}
              </span>
            </div>
          </div>
          <div className="rd-play-area">
            <div className="rd-play-mag">
              <div className={`rd-pbox rd-pad-${pad}`}>
                <Circle kind="o" />
                <div className="rd-pinner" style={{ borderRadius: innerExpr }}>
                  <span className={`rd-circ rd-circ--i${same ? " rd-circ--off" : ""}`} style={{ width: `calc(${innerExpr} * 2)`, height: `calc(${innerExpr} * 2)` }} aria-hidden="true">
                    <span className="rd-ctr" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Ladder ─────────────────────────────────────────────────────── */}
        <h2 data-no>The ladder<span className="h2-aside">each corner magnified ×4 beside where it lives</span></h2>
        <div className="rd-ladder">
          {LADDER.map((r) => (
            <div className="rd-tile" key={r.t}>
              <div className="rd-tile-top">
                <span className={`rd-corner ${r.cls}`} aria-hidden="true" />
                <div className="rd-tile-demo"><LadderDemo demo={r.demo} /></div>
              </div>
              <div className="rd-tile-meta">
                <strong>{r.t}</strong>
                <span className="rd-px">{r.px} px</span>
                <span>{r.uses}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── On the canvas ──────────────────────────────────────────────── */}
        <h2 data-no>On the canvas<span className="h2-aside">objects stay crisper than chrome</span></h2>
        <div className="stage rd-canvas">
          <div className="rd-artboard">
            <span className="rd-ab-label">Pricing</span>
            <div className="rd-ab-img" />
            <div className="rd-ab-lines"><span /><span /></div>
            <span className="rd-sel" aria-hidden="true" />
            <div className="island rd-comment">
              <span className="rd-av">J</span>
              <span>Annual price first?</span>
            </div>
          </div>
          <div className="sticky sticky--coral rd-st">Three tiers, not four</div>
          <ul className="rd-canvas-notes">
            <li><strong>Artboard · 6</strong> a frame, not a card — only just soft</li>
            <li><strong>Selection · 6 + 4</strong> the ring sits 4 outside, so its corner is 10 — concentric outward</li>
            <li><strong>Sticky · 4</strong> paper corners</li>
            <li><strong>Comment · 14, one corner 4</strong> the sharp corner points at what it is about</li>
          </ul>
        </div>

        {/* ── Right / wrong ──────────────────────────────────────────────── */}
        <h2 data-no>Nest, don't stack</h2>
        <div className="rd-compare">
          <figure className="rd-case">
            <div className="stage rd-mini">
              <div className="island rd-mini-island">
                <span className="icon-btn" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg></span>
                <span className="btn btn--primary">Share</span>
              </div>
            </div>
            <figcaption><strong className="rd-ok">Right</strong> A 14 island, 10 controls, a 4 edge. The corners run parallel and the island floats free of the window edge.</figcaption>
          </figure>
          <figure className="rd-case">
            <div className="stage rd-mini">
              <div className="rd-wrong-bar">
                <span className="rd-wrong-btn">Share</span>
              </div>
              <div className="island rd-mini-island rd-wrong-island">
                <span className="icon-btn" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg></span>
                <span className="btn btn--primary">Share</span>
              </div>
            </div>
            <figcaption><strong className="rd-bad">Wrong</strong> A square docked bar framing the canvas, and an island whose controls copy its own 14 radius — the gap pinches at every corner.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · radii</span>
        <span>island 14 › control 10 › chip 6 · dock 20 · pill 999</span>
      </footer>
    </>
  );
}
