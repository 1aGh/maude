/**
 * SPECIMEN — ui_kits-desktop-index · maude-v2
 *
 * The catalogue/launcher for the maude-v2 desktop kit: every specimen in this design
 * system, grouped the way a designer looks for them, each card opening the specimen.
 * Written last (it links every peer). The showcase is the signature entry and leads.
 * The page count is computed from GROUPS, so adding a specimen (e.g. "textures") updates it.
 * No spark here: the spark marks AI only, never a "featured" badge.
 */
import "./_layout.css";
import "./ui_kits-desktop-index.css";
import { SpecimenHeader } from "./_specimen-controls";

type Entry = { slug: string; title: string; line: string; sig?: boolean };

const GROUPS: { name: string; blurb: string; entries: Entry[] }[] = [
  {
    name: "Start here",
    blurb: "The app as a whole, and where AI lives in it.",
    entries: [
      { slug: "ui_kits-desktop-showcase", title: "Maude Desktop v2", line: "The canvas is the window. Everything else floats, folds, and waits.", sig: true },
      { slug: "colors-accent", title: "Colour roles", line: "Azure acts. The spark marks AI. Colour lives on the canvas.", sig: true },
      { slug: "empty-state", title: "Empty states", line: "Empty is where the work starts.", sig: true },
    ],
  },
  {
    name: "Colour",
    blurb: "Ink, surfaces, status, people — in both lights.",
    entries: [
      { slug: "colors-text", title: "Text", line: "Four steps of ink, one reading order." },
      { slug: "colors-surfaces", title: "Surfaces", line: "The canvas is the floor. Everything else floats." },
      { slug: "colors-status", title: "Status", line: "Status says what happened. The spark says who's at work." },
      { slug: "colors-presence", title: "Presence", line: "People in calm colours. AI in the spark." },
      { slug: "colors-themes-side-by-side", title: "Light and dark", line: "One app, two lights." },
    ],
  },
  {
    name: "Foundations",
    blurb: "Type, space, shape, depth and motion.",
    entries: [
      { slug: "type-scale", title: "Type", line: "Small in the chrome, generous on the canvas." },
      { slug: "spacing-scale", title: "Spacing", line: "Eights, with a half-step for tight joints." },
      { slug: "grid", title: "Grid", line: "No columns. The window is the canvas." },
      { slug: "radii", title: "Radii", line: "Soft corners that nest." },
      { slug: "elevation", title: "Elevation", line: "Three planes: the canvas, the islands, what opens from them." },
      { slug: "borders", title: "Borders", line: "Edges, not boxes." },
      { slug: "opacity", title: "Opacity", line: "Frosted at 88 %. Everything you make, fully solid." },
      { slug: "focus", title: "Focus", line: "Your keys go where the azure ring is." },
      { slug: "selection", title: "Selection", line: "What you picked is azure — on the canvas and in Layers." },
      { slug: "motion", title: "Motion", line: "Gentle by default. A drop of spring when something lands." },
      { slug: "iconography", title: "Icons", line: "Drawn in one hand, light enough to disappear." },
      { slug: "logo", title: "Logo", line: "One mark: the spark on a speech tile." },
      { slug: "textures", title: "Textures", line: "Quiet light behind the work, a little play at the edges." },
    ],
  },
  {
    name: "Components",
    blurb: "The pieces every island is made of.",
    entries: [
      { slug: "components-buttons", title: "Buttons", line: "One azure button per island. Everything else stays quiet." },
      { slug: "components-inputs", title: "Inputs", line: "Search, ask, adjust — three kinds of field in one calm well." },
      { slug: "components-toggles", title: "Toggles & Advanced", line: "Flip it, pick one, tick a few. The knobs wait under Advanced." },
      { slug: "components-cards", title: "Canvas cards", line: "The picture first. The name second." },
      { slug: "components-list", title: "Lists", line: "Short rows, real pictures, tools on hover." },
      { slug: "components-tables", title: "Version history", line: "Reads like a contact sheet, not a log." },
      { slug: "components-dialogs", title: "Sheets & dialogs", line: "A sheet floats up from where you asked." },
      { slug: "components-tooltips", title: "Tooltips & hints", line: "A word when you pause. Never a tour." },
      { slug: "components-callout", title: "Callouts", line: "A quiet sentence next to what it's about." },
      { slug: "components-status", title: "Ambient status", line: "State is shown, not operated." },
      { slug: "skeletons", title: "Loading", line: "Show the shape of what's coming." },
    ],
  },
  {
    name: "Finding things",
    blurb: "Nothing is deleted — this is how you reach what's hidden.",
    entries: [
      { slug: "components-toast-menu", title: "The one menu", line: "One menu under the project pill. Toasts that whisper." },
      { slug: "components-command-palette", title: "Search ⌘K", line: "Finds everything, even what's hidden." },
      { slug: "components-keyboard", title: "Keys", line: "A handful of keys, each with one job." },
      { slug: "components-shortcuts-overlay", title: "Shortcuts", line: "Press ? and every shortcut is there." },
      { slug: "components-resize-panels", title: "Panels", line: "Hide panels with ⌘\\, or keep them at the side under Advanced." },
    ],
  },
];

const href = (slug: string) => `/_canvas-shell.html?canvas=system/maude-v2/preview/${slug}.tsx`;
const total = GROUPS.reduce((n, g) => n + g.entries.length, 0);
const lead = GROUPS[0];
const pages = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

export default function UiKitsDesktopIndex() {
  return (
    <>
      <SpecimenHeader crumbs={["Desktop kit", "Index"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Everything in maude-v2, one click away.</h1>
          <p className="lede">
            Start with the app, then the colour roles. Every page below opens on its own and reads in both light and
            dark. “{lead.name}” is where the design system shows itself best.
          </p>
        </section>
        <dl className="specimen-meta">
          <div><dt>Pages</dt><dd className="idx-num">{total}</dd></div>
          <div><dt>Direction</dt><dd>Light glass with a spark</dd></div>
          <div><dt>Platform</dt><dd>Desktop (macOS first)</dd></div>
          <div><dt>Themes</dt><dd>Light · Dark</dd></div>
        </dl>

        {GROUPS.map((g) => (
          <section key={g.name} className="idx-group">
            <h2 data-no>{g.name}<span className="h2-aside"><span className="idx-num">{pages(g.entries.length)}</span> · {g.blurb}</span></h2>
            <div className={`idx-grid${g === lead ? " idx-grid--lead" : ""}`}>
              {g.entries.map((e) => (
                <a key={e.slug} className={`idx-card${e.sig ? " idx-card--sig" : ""}`} href={href(e.slug)}>
                  <span className="idx-card-title">{e.title}</span>
                  <span className="idx-card-line">{e.line}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · desktop kit index</span>
        <span>Locked direction: ui/v2/maude-v2-moodboard.tsx → direction-mix</span>
      </footer>
    </>
  );
}
