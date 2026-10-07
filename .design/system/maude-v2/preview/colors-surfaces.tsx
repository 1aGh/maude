/**
 * SPECIMEN — colors-surfaces · maude-v2
 *
 * DEMONSTRATES: --bg-0 … --bg-4, the island material (--island-bg, --island-blur,
 *   --island-edge, --island-shadow), --canvas-bg / --canvas-dot, and the three border
 *   strengths (--border-subtle, --border-default, --border-strong).
 * COMPOSITION: hero = the elevation story told twice — a live slice of the app with every
 *   surface tagged where it sits (canvas → island → popover → input well → pressed row),
 *   next to a side view that lifts the same layers apart so the height reads at a glance.
 *   Then the ladder, the island material taken apart (frost · blur · edge · shadow) with a
 *   right / peek-through / glass-on-content comparison, and a border × surface matrix.
 * COPY VOICE: terse labels in everyday nouns (canvas, island, menu), no hype.
 * WHEN SCAFFOLDED: always (Core).
 * NOTES: In maude-v2 the canvas is the floor — --bg-0 IS the canvas. Chrome never frames
 *   it; it floats over it as islands. Borders are alpha of ink, so one token works on
 *   every surface in both themes.
 */
import "./_layout.css";
import "./colors-surfaces.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

const LADDER = [
  { t: "--bg-0", role: "Canvas", where: "The whole window. The dot grid sits on it.", cls: "b0" },
  { t: "--bg-1", role: "Island body", where: "Panels, the dock, the project pill.", cls: "b1" },
  { t: "--bg-2", role: "Popover", where: "Menus, sheets, the artboard paper.", cls: "b2" },
  { t: "--bg-3", role: "Input well", where: "Fields, segmented tracks, row hover.", cls: "b3" },
  { t: "--bg-4", role: "Pressed", where: "Pressed buttons, a selected row without azure.", cls: "b4" },
];

const BORDERS = [
  { t: "--border-subtle", note: "dividers inside an island" },
  { t: "--border-default", note: "a field's edge, a card on paper" },
  { t: "--border-strong", note: "a dashed drop target" },
];
const ON = [
  { k: "canvas", label: "on the canvas" },
  { k: "island", label: "on an island" },
  { k: "popover", label: "on a popover" },
];

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
);

export default function ColorsSurfaces() {
  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Surfaces"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>The canvas is the floor. Everything else floats.</h1>
          <p className="lede">
            Five steps of surface, and one material for chrome. Your work sits on the canvas; panels hover
            over it as frosted islands; menus open one step higher still. Each step is only a little
            lighter (or, in dark, a little brighter) — shadow does the lifting, not colour.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Steps</dt><dd>--bg-0 … --bg-4</dd></div>
          <div><dt>Island</dt><dd>~88% opaque · blur 16 · 0.5px edge</dd></div>
          <div><dt>Borders</dt><dd>alpha of ink — one token, any surface</dd></div>
          <div><dt>Themes</dt><dd>light (default) · dark</dd></div>
        </dl>

        {/* ── Hero: the elevation story ──────────────────────────────────── */}
        <h2 data-no>Canvas → island → popover<span className="h2-aside">where each surface sits, then the same layers lifted apart</span></h2>
        <div className="cs-hero">
          <div className="stage cs-stage">
            <div className="cs-artboard">
              <div className="cs-ab-img" />
              <div className="cs-ab-body"><strong>Onboarding</strong><span>Welcome, pick a template, invite.</span></div>
            </div>
            <div className="sticky sticky--sky cs-st1">Shorter welcome text</div>
            <div className="sticky sticky--yellow cs-st2">Skip step 2?</div>

            <div className="island cs-pill"><Mark size={20} /><span>Studio site</span><Chevron /></div>

            <div className="island island--pad cs-props">
              <span className="cs-tag cs-tag-island"><b>1</b>island</span>
              <p className="island-title">Fill</p>
              <div className="cs-fill-row">
                <span className="cs-fill-chip" />
                <span>Sky</span>
                <span className="cs-fill-pct">100%</span>
              </div>
            </div>

            <div className="cs-pop">
              <span className="cs-tag cs-tag-pop"><b>2</b>popover</span>
              <div className="cs-pop-search"><span>Search colours</span><span className="cs-tag cs-tag-well"><b>3</b>well</span></div>
              <div className="cs-pop-row cs-pressed"><span className="cs-sw cs-sw-sky" />Sky<span className="cs-tag cs-tag-press"><b>4</b>pressed</span></div>
              <div className="cs-pop-row"><span className="cs-sw cs-sw-green" />Green</div>
              <div className="cs-pop-row"><span className="cs-sw cs-sw-lilac" />Lilac</div>
            </div>

            <div className="island dock cs-dock">
              <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
              </button>
              <button className="icon-btn" type="button" aria-label="Frame">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h12M2 11h12M5 2v12M11 2v12" /></svg>
              </button>
              <span className="divider-v" />
              <button className="icon-btn" type="button" aria-label="Ask AI"><Spark size={16} color="var(--spark)" /></button>
            </div>

            {/* surface tags live INSIDE the surface they name (1–4); the canvas tag sits on the canvas */}
            <span className="cs-tag cs-tag-canvas"><b>0</b>canvas</span>
          </div>

          <figure className="cs-side" aria-label="Side view of the surface layers">
            <figcaption>Side view</figcaption>
            <div className="cs-side-stack">
              <div className="cs-lvl cs-lvl-pop"><span className="cs-slab cs-slab-pop" /><span className="cs-lvl-t"><b>Popover</b>--bg-2 · --shadow-lg</span></div>
              <div className="cs-lvl cs-lvl-isl"><span className="cs-slab cs-slab-isl" /><span className="cs-lvl-t"><b>Island</b>--island-bg · --island-shadow</span></div>
              <div className="cs-lvl cs-lvl-obj">
                <span className="cs-slab cs-slab-paper" />
                <span className="cs-slab cs-slab-sticky" />
                <span className="cs-lvl-t"><b>On the canvas</b>artboard paper, stickies</span>
              </div>
              <div className="cs-ground"><span className="cs-lvl-t"><b>Canvas</b>--bg-0 · dot grid</span></div>
            </div>
            <p>Height comes from the shadow. The colour steps stay small so the canvas never looks boxed in.</p>
          </figure>
        </div>

        {/* ── Ladder ─────────────────────────────────────────────────────── */}
        <h2 data-no>The ladder<span className="h2-aside">deepest → highest</span></h2>
        <div className="grid cs-grid">
          {LADDER.map((s) => (
            <div className="swatch" key={s.t}>
              <div className={`fill cs-${s.cls}`} />
              <div className="meta"><strong>{s.t}</strong>{s.role} — {s.where}</div>
            </div>
          ))}
          <div className="swatch cs-swatch-island">
            <div className="fill cs-fill-island"><span className="island cs-mini-island" /></div>
            <div className="meta"><strong>--island-bg</strong>The chrome material — --bg-1 at ~88%, frosted.</div>
          </div>
        </div>

        {/* ── Island material ────────────────────────────────────────────── */}
        <h2 data-no>The island, taken apart<span className="h2-aside">four tokens make the material</span></h2>
        <div className="cs-anatomy">
          <div className="stage cs-anat-stage">
            <div className="cs-anat-art" />
            <div className="sticky sticky--coral cs-anat-st">Hero first</div>
            <div className="island island--pad cs-anat-island">
              <p className="island-title">Canvases</p>
              <div className="row-item" aria-current="true"><span className="thumb cs-th-coral" />Homepage</div>
              <div className="row-item"><span className="thumb cs-th-yellow" />Onboarding</div>
              <div className="row-item"><span className="thumb cs-th-green" />Pricing</div>
            </div>
          </div>
          <ol className="cs-parts">
            <li><b>Frost</b><code>--island-bg</code><span>The island body at about 88% — enough to hint at the canvas, never enough to read through.</span></li>
            <li><b>Blur</b><code>--island-blur</code><span>16px of blur with a little saturation, so whatever sits beneath turns into soft colour.</span></li>
            <li><b>Edge</b><code>--island-edge</code><span>A 0.5px inner hairline. Ink in light, white in dark — it keeps the shape crisp on any canvas.</span></li>
            <li><b>Shadow</b><code>--island-shadow</code><span>Two soft layers. This is what makes it float.</span></li>
          </ol>
        </div>

        <div className="cs-compare">
          <figure className="cs-case">
            <div className="stage cs-mini">
              <div className="cs-mini-art" />
              <div className="island island--pad cs-mini-isl"><div className="row-item" aria-current="true">Homepage</div><div className="row-item">Pricing</div></div>
            </div>
            <figcaption><strong className="cs-ok">Right</strong> Frosted chrome over the canvas. The design underneath softens, the labels stay sharp.</figcaption>
          </figure>
          <figure className="cs-case">
            <div className="stage cs-mini">
              <div className="cs-mini-art" />
              <div className="cs-mini-isl cs-peek"><div className="row-item">Homepage</div><div className="row-item">Pricing</div></div>
            </div>
            <figcaption><strong className="cs-bad">Wrong</strong> Peek-through. The canvas reads through the panel and the labels fight it.</figcaption>
          </figure>
          <figure className="cs-case">
            <div className="stage cs-mini">
              <div className="cs-mini-art cs-mini-art--wide">
                <div className="cs-glass-card">Plans from 9 €</div>
              </div>
            </div>
            <figcaption><strong className="cs-bad">Wrong</strong> Glass on content. Frost is for chrome only — the user's artboard stays solid paper.</figcaption>
          </figure>
        </div>

        {/* ── Borders ────────────────────────────────────────────────────── */}
        <h2 data-no>Borders<span className="h2-aside">ink at low alpha — one token on every surface</span></h2>
        <div className="cs-matrix">
          <span />
          {ON.map((o) => <span className="cs-mx-hd" key={o.k}>{o.label}</span>)}
          {BORDERS.map((b) => (
            <div className="cs-mx-row" key={b.t}>
              <span className="cs-mx-label"><b>{b.t}</b>{b.note}</span>
              {ON.map((o) => (
                <span className={`cs-mx-cell cs-on-${o.k}`} key={o.k}>
                  <span className={`cs-edge cs-edge-${b.t.replace("--border-", "")}`}>Pricing</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · surfaces</span>
        <span>Frost is for chrome. Content stays solid.</span>
      </footer>
    </>
  );
}
