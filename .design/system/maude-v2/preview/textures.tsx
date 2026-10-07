/**
 * SPECIMEN — textures · maude-v2
 *
 * The organic layer seeded by the draw engine from the maude-v2 palette: two
 * full-bleed backgrounds (with dark twins), a pattern sheet (canvas dots, frost
 * grain, sticky confetti) and three spot illustrations for empty states. Assets live
 * in system/maude-v2/assets/organic/ and are referenced by their real repo path
 * (RELATIVE-URL SAFETY). Backgrounds swap with the theme; spot art follows it when inlined.
 */
import "./_layout.css";
import "./textures.css";
import { SpecimenHeader } from "./_specimen-controls";

const A = "/.design/system/maude-v2/assets/organic";

const SPOTS = [
  { file: "spot-empty-canvas.svg", title: "Empty canvas", line: "Your canvas is ready. Ask AI for a first draft, or start drawing." },
  { file: "spot-no-results.svg", title: "No results", line: "Nothing called “pricng”. Try another word, or ask AI to find it." },
  { file: "spot-ai-ready.svg", title: "AI is ready", line: "Describe it in a sentence. AI puts a first draft on the canvas." },
];

export default function Textures() {
  return (
    <>
      <SpecimenHeader crumbs={["Brand", "Textures"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Quiet light behind the work, a little play at the edges.</h1>
          <p className="lede">
            Backgrounds for the site and the first-run moments, patterns for surfaces that need a grain, and small
            drawings for empty states. All of them are drawn from the same palette as the app, and all of them stay
            low enough that text and canvases sit on top without a fight.
          </p>
        </section>

        <h2 data-no>Backgrounds<span className="h2-aside">full-bleed · the site, Home, onboarding</span></h2>
        <div className="tx-bgs">
          <figure className="tx-bg">
            <div className="tx-bg-frame">
              <img className="tx-light" src={`${A}/backgrounds.svg`} alt="" />
              <img className="tx-dark" src={`${A}/backgrounds-dark.svg`} alt="" />
              <div className="tx-bg-content">
                <strong>What shall we make?</strong>
                <span>Light glass — a faint azure glow through frosted bands.</span>
              </div>
            </div>
            <figcaption><code>backgrounds.svg</code> · <code>backgrounds-dark.svg</code></figcaption>
          </figure>
          <figure className="tx-bg">
            <div className="tx-bg-frame">
              <img className="tx-light" src={`${A}/backgrounds-2.svg`} alt="" />
              <img className="tx-dark" src={`${A}/backgrounds-2-dark.svg`} alt="" />
              <div className="tx-bg-content">
                <strong>Good morning, Studio site.</strong>
                <span>Canvas morning — object colours drift at the edges. No spark: AI hasn't done anything here.</span>
              </div>
            </div>
            <figcaption><code>backgrounds-2.svg</code> · <code>backgrounds-2-dark.svg</code></figcaption>
          </figure>
        </div>
        <p>
          The centre stays calm so a headline or a prompt can sit on it. On narrow screens the edges crop away and only
          the quiet middle remains — that is intended.
        </p>

        <h2 data-no>Patterns<span className="h2-aside">seamless tiles · dots, frost grain, sticky confetti</span></h2>
        <div className="tx-patterns">
          <img src={`${A}/patterns.svg`} alt="Pattern sheet: canvas dots, frost grain and sticky confetti, each in light and dark." />
        </div>
        <p>
          Use the tiles by id (<code>mv2-pattern-dots-light</code>, <code>mv2-pattern-grain-dark</code>,
          <code> mv2-pattern-confetti-light</code> …). Confetti belongs to empty states and celebrations only — never
          behind a canvas you're working on.
        </p>

        <h2 data-no>Spot art<span className="h2-aside">empty states · ~240 × 160</span></h2>
        <div className="tx-spots">
          {SPOTS.map((s) => (
            <figure key={s.file} className="island tx-spot">
              <img src={`${A}/${s.file}`} alt="" />
              <figcaption>
                <strong>{s.title}</strong>
                <span>{s.line}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · textures — seeded by the draw engine from the DS palette</span>
        <span>assets/organic/</span>
      </footer>
    </>
  );
}
