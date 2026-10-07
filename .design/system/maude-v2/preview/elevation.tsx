/**
 * SPECIMEN — elevation · maude-v2
 *
 * DEMONSTRATES: --shadow-sm · --shadow-md · --shadow-lg · --island-shadow (+ --island-edge,
 *               --island-bg, --island-blur) — the three planes of the app: the canvas,
 *               the islands floating over it, and the popovers that open from an island.
 * COMPOSITION:  hero = a live slice of the app with each plane tagged where it sits ·
 *               a side view (the planes pulled apart, so the height order reads at a
 *               glance) · the ladder as tiles on a piece of canvas · "frost, never
 *               peek-through" right/wrong · three short rules.
 * NOTES:        Shadow means "this floats". The canvas never casts one. Things ON the
 *               canvas (artboards, stickies) sit just above the dots; chrome floats
 *               higher; a popover floats highest. Frost is for the navigation layer
 *               only, at ~88 % — the design must never read through a panel.
 */
import "./_layout.css";
import "./elevation.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

const LADDER = [
  { cls: "flat", name: "Flat", tok: "none", where: "The canvas itself, input wells, rows inside an island. Nothing to lift." },
  { cls: "sm", name: "Small", tok: "--shadow-sm", where: "A lifted control inside an island — the picked segment, a key cap, a switch knob." },
  { cls: "md", name: "Medium", tok: "--shadow-md", where: "Things on the canvas: an artboard, a variant the AI just made." },
  { cls: "island", name: "Island", tok: "--island-shadow", where: "Every piece of chrome: panels, the dock, the project pill. Always with the 0.5 px edge." },
  { cls: "lg", name: "Large", tok: "--shadow-lg", where: "What opens from a panel: the project menu, Share, version history." },
];

function PlaneTag({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <span className={`el-tag ${className}`}>
      <span className="el-tag-n">{n}</span>
      {label}
    </span>
  );
}

export default function Elevation() {
  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Elevation"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Three planes: the canvas, the islands, what opens from them.</h1>
          <p className="lede">
            Shadow only ever means “this floats”. The canvas stays flat. Your artboards sit just above
            the dots, the chrome floats over everything you make, and a menu floats over the chrome.
            Soft shadows, a hairline edge, nothing heavier.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Strategy</dt><dd>soft · ink-tinted · few levels</dd></div>
          <div><dt>Planes</dt><dd>canvas › objects › islands › popovers</dd></div>
          <div><dt>Island edge</dt><dd>0.5 px inner hairline</dd></div>
          <div><dt>Dark theme</dt><dd>deeper shadows, the edge carries the shape</dd></div>
        </dl>

        {/* ── Hero: planes in context ───────────────────────────────────── */}
        <h2 data-no>In the app<span className="h2-aside">each plane, tagged where it sits</span></h2>
        <div className="stage el-hero">
          <div className="el-board">
            <div className="el-board-img" />
            <div className="el-board-body"><strong>Pricing</strong><span>Three plans and a FAQ.</span></div>
          </div>
          <div className="sticky sticky--lilac el-sticky">Annual toggle first?</div>

          <div className="island el-pill">
            <Mark size={22} />
            <span>Studio site</span>
            <span className="el-caret" aria-hidden="true">⌄</span>
          </div>

          <div className="el-menu" role="menu" aria-label="Project menu">
            <div className="row-item" role="menuitem">Rename</div>
            <div className="row-item" role="menuitem">Duplicate canvas</div>
            <div className="row-item" role="menuitem" aria-current="true">Version history</div>
            <div className="el-menu-sep" />
            <div className="row-item el-menu-adv" role="menuitem">Advanced <span aria-hidden="true">›</span></div>
          </div>

          <div className="island island--pad el-layers">
            <p className="island-title">Layers</p>
            <div className="row-item" aria-current="true"><span className="thumb el-th-sky" />Plans</div>
            <div className="row-item"><span className="thumb el-th-yellow" />FAQ</div>
            <div className="row-item"><span className="thumb el-th-green" />Footer</div>
          </div>

          <div className="island el-ai">
            <Spark size={14} color="var(--spark)" />
            <span>Ask AI about Pricing…</span>
          </div>

          <PlaneTag n={0} label="Canvas · flat" className="el-tag--canvas" />
          <PlaneTag n={1} label="Artboard · --shadow-md" className="el-tag--board" />
          <PlaneTag n={2} label="Island · --island-shadow" className="el-tag--island" />
          <PlaneTag n={3} label="Menu · --shadow-lg" className="el-tag--menu" />
        </div>

        {/* ── Side view ─────────────────────────────────────────────────── */}
        <h2 data-no>Side view<span className="h2-aside">the planes pulled apart</span></h2>
        <div className="el-side" role="group" aria-label="The four planes, from the canvas up">
          <div className="el-side-col">
            <div className="el-slab el-slab--menu"><span>Menu, Share, version history</span></div>
            <div className="el-slab el-slab--island"><span>Panels, the dock, the project pill</span></div>
            <div className="el-slab el-slab--board"><span>Artboards, stickies, shapes</span></div>
            <div className="el-slab el-slab--canvas"><span>The canvas — dot grid, edge to edge</span></div>
          </div>
          <ol className="el-side-key">
            <li><strong>3 · Popover</strong><code>--shadow-lg</code><span>Opens from an island, closes when you click away.</span></li>
            <li><strong>2 · Island</strong><code>--island-shadow</code><span>Frosted chrome. Floats over everything you make.</span></li>
            <li><strong>1 · On the canvas</strong><code>--shadow-md</code><span>Your work — lifted just enough to leave the dots.</span></li>
            <li><strong>0 · Canvas</strong><code>no shadow</code><span>The ground. It never casts or carries a shadow.</span></li>
          </ol>
        </div>

        {/* ── Ladder ────────────────────────────────────────────────────── */}
        <h2 data-no>The ladder<span className="h2-aside">five steps, one job each</span></h2>
        <div className="el-ladder">
          {LADDER.map((l) => (
            <div className="el-step" key={l.cls}>
              <div className={`el-card el-card--${l.cls}`}>
                <strong>{l.name}</strong>
                <code>{l.tok}</code>
              </div>
              <p>{l.where}</p>
            </div>
          ))}
        </div>

        {/* ── Frost vs peek-through ─────────────────────────────────────── */}
        <h2 data-no>Frost, never peek-through<span className="h2-aside">the island fill stays at ~88 %</span></h2>
        <div className="el-compare">
          <figure className="el-case">
            <div className="stage el-mini">
              <div className="el-busy"><span /><span /><span /></div>
              <div className="island island--pad el-over">
                <p className="island-title">Canvases</p>
                <div className="row-item" aria-current="true"><span className="thumb el-th-sky" />Homepage</div>
                <div className="row-item"><span className="thumb el-th-yellow" />Onboarding</div>
                <div className="row-item"><span className="thumb el-th-green" />Pricing</div>
              </div>
            </div>
            <figcaption><strong className="el-ok">Right</strong> The panel is frosted: you sense the artboard behind it, you can't read it. Labels stay crisp.</figcaption>
          </figure>
          <figure className="el-case">
            <div className="stage el-mini">
              <div className="el-busy"><span /><span /><span /></div>
              <div className="island island--pad el-over el-over--glass">
                <p className="island-title">Canvases</p>
                <div className="row-item" aria-current="true"><span className="thumb el-th-sky" />Homepage</div>
                <div className="row-item"><span className="thumb el-th-yellow" />Onboarding</div>
                <div className="row-item"><span className="thumb el-th-green" />Pricing</div>
              </div>
            </div>
            <figcaption><strong className="el-bad">Wrong</strong> Thin glass lets the design through. The list fights the artboard, and the panel looks like part of your work.</figcaption>
          </figure>
        </div>

        {/* ── Rules ─────────────────────────────────────────────────────── */}
        <h2 data-no>Three rules</h2>
        <div className="el-rules">
          <div className="el-rule">
            <strong>One island deep</strong>
            <span>Never put an island inside an island. Sections inside a panel are rows and dividers, not more floating cards.</span>
          </div>
          <div className="el-rule">
            <strong>Shadows don't decorate</strong>
            <span>A card that never moves off the page gets a fill step, not a shadow. If it doesn't float, it doesn't cast.</span>
          </div>
          <div className="el-rule">
            <strong>Dark keeps the order</strong>
            <span>In the dark theme shadows deepen and the 0.5 px edge does more of the work — the planes stack the same way.</span>
          </div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · elevation</span>
        <span>canvas › objects › islands › popovers</span>
      </footer>
    </>
  );
}
