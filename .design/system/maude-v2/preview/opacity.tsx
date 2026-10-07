/**
 * SPECIMEN — opacity · maude-v2
 *
 * DEMONSTRATES: the island fill (--island-bg, ~88 % opaque) · where alpha lives in the
 *               tokens (--accent-tint, --accent-muted, --spark-muted, the ink-alpha
 *               borders) · disabled as a colour (--fg-3), not a fade · quiet text as a
 *               step down the --fg ladder · the sheet veil.
 * COMPOSITION:  hero = a fill scrubber: drag the island's opacity over a busy artboard
 *               and read the verdict, with 88 % marked as the token · alpha tiles over
 *               the dot grid (so the translucency is visible) · disabled right/wrong ·
 *               quiet-not-faded pairs · the veil behind a Share sheet.
 * NOTES:        Opacity is not a token family here; the alphas that matter are baked
 *               into named tokens. Content is always opaque. Why the island stops at
 *               ~88 %: floating panels thin enough to let a busy file show through are
 *               harder to read (the peek-through lesson of Figma's UI3 panels).
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import "./_layout.css";
import "./opacity.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

const ISLAND = 88;

function verdict(p: number) {
  if (p < 70) return { tone: "bad", t: "Peek-through", d: "The artboard reads through the panel. Your layer names fight the design behind them." };
  if (p < 85) return { tone: "warn", t: "Too thin", d: "Calm canvases look fine — busy ones still show their shapes under the list." };
  if (p <= 92) return { tone: "ok", t: "Frosted — the island", d: "You sense the canvas behind, you can't read it. The panel floats and the labels stay crisp." };
  if (p < 100) return { tone: "warn", t: "Nearly solid", d: "Calm, but the panel stops feeling like it floats over your work." };
  return { tone: "warn", t: "Solid", d: "The canvas disappears behind it. Right for a popover, heavy for an island." };
}

const ALPHAS = [
  { cls: "content", tok: "Your work", v: "always 1", use: "Artboards, stickies, images. Content is never translucent." },
  { cls: "island", tok: "--island-bg", v: "0.88 · both themes", use: "Every island. Frost, never peek-through." },
  { cls: "tint", tok: "--accent-tint", v: "0.22 · dark 0.30", use: "Text selection, the focus halo." },
  { cls: "muted", tok: "--accent-muted", v: "0.12 · dark 0.18", use: "The selected row, an accent chip." },
  { cls: "spark", tok: "--spark-muted", v: "0.12 · dark 0.18", use: "“Made by AI” chips, the agent's glow." },
  { cls: "border", tok: "--border-default", v: "ink 0.12 · dark 0.11", use: "Borders are ink-alpha, so they sit on any surface." },
];

function Busy() {
  return (
    <div className="op-busy" aria-hidden="true">
      <div className="op-busy-hero"><strong>Plans for every team</strong><span>Start free. Upgrade when the canvas fills up.</span></div>
      <span className="op-busy-a" />
      <span className="op-busy-b" />
      <span className="op-busy-c" />
    </div>
  );
}

function FillScrubber() {
  const [pct, setPct] = useState(ISLAND);
  const v = verdict(pct);
  return (
    <div className="op-hero">
      <div className="stage op-stage">
        <Busy />
        <div className="island island--pad op-scrub-island" style={{ "--op-fill": `${pct}%` } as CSSProperties}>
          <p className="island-title">Layers</p>
          <div className="row-item" aria-current="true"><span className="thumb op-th-coral" />Plans</div>
          <div className="row-item"><span className="thumb op-th-yellow" />Headline</div>
          <div className="row-item"><span className="thumb op-th-sky" />Price cards</div>
          <div className="row-item"><span className="thumb op-th-green" />FAQ</div>
        </div>
      </div>

      <div className="op-panel">
        <label className="field-label" htmlFor="op-fill">Island fill</label>
        <div className="op-readout"><span>{pct}</span> %</div>
        <input
          id="op-fill"
          className="op-range"
          type="range"
          min={40}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          aria-valuetext={`${pct} percent — ${v.t}`}
        />
        <div className="op-scale" aria-hidden="true">
          <span>40</span>
          <span className="op-mark" style={{ left: `${((ISLAND - 40) / 60) * 100}%` }}>88 · token</span>
          <span>100</span>
        </div>
        <div className={`op-verdict op-verdict--${v.tone}`} role="status">
          <strong>{v.t}</strong>
          <span>{v.d}</span>
        </div>
        <button className="btn btn--sm" type="button" onClick={() => setPct(ISLAND)} disabled={pct === ISLAND}>
          Back to 88 %
        </button>
      </div>
    </div>
  );
}

export default function Opacity() {
  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Opacity"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Frosted at 88 %. Everything you make, fully solid.</h1>
          <p className="lede">
            Only the chrome is see-through, and only a little — enough to feel the canvas under a
            panel, never enough to read it. Your work is always opaque. Disabled things and quiet
            text change colour instead of fading, so nothing lets the canvas leak through.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Island</dt><dd>--island-bg · 0.88</dd></div>
          <div><dt>Content</dt><dd>always opaque</dd></div>
          <div><dt>Disabled</dt><dd>--fg-3, not a fade</dd></div>
          <div><dt>Veil</dt><dd>canvas tone, not black</dd></div>
        </dl>

        <h2 data-no>Why 88 %<span className="h2-aside">drag the fill over a busy artboard</span></h2>
        <FillScrubber />
        <p>
          Floating panels that let a busy file show through are harder to read — the lesson from
          Figma's UI3 panels. Below about 85 % the shapes of your design start competing with the
          layer names. At 100 % the panel feels like a wall. The island sits in between, with the
          blur doing the rest.
        </p>

        <h2 data-no>Where alpha lives<span className="h2-aside">baked into named tokens, over the dot grid</span></h2>
        <div className="op-alphas">
          {ALPHAS.map((a) => (
            <div className="swatch" key={a.cls}>
              <div className={`fill op-a op-a--${a.cls}`}><span /></div>
              <div className="meta"><strong>{a.tok}</strong><span className="op-a-v">{a.v}</span>{a.use}</div>
            </div>
          ))}
        </div>

        <h2 data-no>Disabled is a colour<span className="h2-aside">never fade an island</span></h2>
        <div className="op-compare">
          <figure className="op-case">
            <div className="stage op-mini">
              <Busy />
              <div className="island island--pad op-dis">
                <p className="island-title">Export “Pricing”</p>
                <div className="row-item">PNG · 2×</div>
                <div className="row-item op-row-off">PDF — needs an artboard</div>
                <div className="op-dis-actions">
                  <button className="btn btn--ghost btn--sm" type="button" disabled>Copy</button>
                  <button className="btn btn--primary btn--sm" type="button" disabled>Export</button>
                </div>
              </div>
            </div>
            <figcaption><strong className="op-ok">Right</strong> Unavailable labels drop to <code>--fg-3</code>; the button loses its azure. The island stays as frosted as every other.</figcaption>
          </figure>
          <figure className="op-case">
            <div className="stage op-mini">
              <Busy />
              <div className="island island--pad op-dis op-dis--faded">
                <p className="island-title">Export “Pricing”</p>
                <div className="row-item">PNG · 2×</div>
                <div className="row-item">PDF — needs an artboard</div>
                <div className="op-dis-actions">
                  <button className="btn btn--ghost btn--sm" type="button" tabIndex={-1}>Copy</button>
                  <button className="btn btn--primary btn--sm" type="button" tabIndex={-1}>Export</button>
                </div>
              </div>
            </div>
            <figcaption><strong className="op-bad">Wrong</strong> Fading the whole island to say “not now” lets the artboard through, and the azure button still looks pressable.</figcaption>
          </figure>
        </div>

        <h2 data-no>Quiet, not faded<span className="h2-aside">step down the text ladder</span></h2>
        <div className="op-quiet">
          <div className="island island--pad op-quiet-col">
            <p className="island-title">Ladder</p>
            <span className="op-q op-q--0">Homepage <em>--fg-0</em></span>
            <span className="op-q op-q--1">Edited by Tereza <em>--fg-1</em></span>
            <span className="op-q op-q--2">2 minutes ago <em>--fg-2</em></span>
            <span className="op-q op-q--3">Not available <em>--fg-3</em></span>
          </div>
          <div className="island island--pad op-quiet-col op-quiet-col--bad">
            <p className="island-title">Faded</p>
            <span className="op-q op-q--0">Homepage <em>1.0</em></span>
            <span className="op-q op-q--0 op-fade-1">Edited by Tereza <em>0.7</em></span>
            <span className="op-q op-q--0 op-fade-2">2 minutes ago <em>0.5</em></span>
            <span className="op-q op-q--0 op-fade-3">Not available <em>0.3</em></span>
          </div>
          <p className="op-quiet-note">
            The ladder was tuned for both themes; a faded <code>--fg-0</code> picks up whatever sits
            behind the island and drifts from one canvas to the next. Use the next step down instead.
          </p>
        </div>

        <h2 data-no>The veil<span className="h2-aside">behind a sheet, the room dims a little</span></h2>
        <div className="stage op-veil-stage">
          <Busy />
          <div className="op-veil" aria-hidden="true" />
          <div className="op-sheet" role="dialog" aria-label="Share Homepage">
            <div className="op-sheet-hd"><strong>Share “Homepage”</strong><span className="chip">Studio site</span></div>
            <div className="row-item"><span className="op-avatar">T</span>Tereza<span className="op-role">Can edit</span></div>
            <div className="row-item"><span className="op-avatar">J</span>Jonas<span className="op-role">Can comment</span></div>
            <div className="op-sheet-ai"><Spark size={10} color="var(--spark)" /> AI can see this canvas while it's shared.</div>
            <div className="op-sheet-ft"><button className="btn btn--ghost btn--sm" type="button">Copy link</button><button className="btn btn--primary btn--sm" type="button">Done</button></div>
          </div>
        </div>
        <p>
          The veil is the canvas colour at about half strength, not black — your design stays in view,
          just quieter. Islands and menus never get a veil; only a sheet that asks for a decision does.
        </p>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · opacity</span>
        <span>Frost for chrome, solid for content, colour for state</span>
      </footer>
    </>
  );
}
