/**
 * SPECIMEN — components-buttons · maude-v2
 *
 * DEMONSTRATES: .btn (secondary) · .btn--primary (azure) · .btn--ghost · .btn--spark (the AI only) ·
 *               .btn--sm / .btn--lg · .icon-btn (island 32, dock 40) · .kbd hints ·
 *               --accent / --accent-hover / --accent-active / --accent-fg · --spark / --spark-fg ·
 *               --bg-3 / --bg-4 · --radius-md / --radius-lg / --radius-xl · --dur-flip + --ease-out.
 * COMPOSITION:  hero = a slice of the app with a "primaries only" lens that dims every other button,
 *               so you can count exactly one azure per island (the teaching device) · the four-step
 *               hierarchy · each button's life as a filmstrip (idle → hover → pressed → working → done,
 *               plus the disabled case with its reason in words) · sizes on a height ruler with where
 *               each lives · icon-only anatomy for islands and the dock, with names and key hints ·
 *               the Share button magnified and at three widths · right / wrong.
 * COPY VOICE:   short everyday verbs about the user's work — "Share", "Invite", "Duplicate",
 *               "Generate variants". Working labels keep the verb ("Inviting", not "Loading…").
 * CONTRACT:     the project pill is one button whose name ends "Project menu"; the toolbar runs
 *               Select · Hand · Frame · Shape · Pen · Text · Image · Component · More (Edit; the AI is the AI
 *               chat panel, never a toolbar slot); keys per CONTRACT §2; a callout carries one
 *               action; dialogs pair the title's verb with the button and say "Cancel".
 * NOTES:        Disabled never relies on colour alone: it says why, next to the button. Destructive is a
 *               quiet button with error-coloured words and an in-place confirm, never a red fill.
 *               The spark fill is only ever on something the AI will do.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./_layout.css";
import "./components-buttons.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — lifted from the iconography family (16 grid, 1.5 stroke) ─────── */
function Ic({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const I = {
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  panels: (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></>),
  share: (<><path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" /><path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" /></>),
  plus: <path d="M8 3v10M3 8h10" />,
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.5-.5" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  more: (<g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  search: (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
};

/** The Edit toolbar, left → right (CONTRACT §2) — tools that make things inside artboards. */
const TOOLBAR: { k: keyof typeof I; name: string; key: string }[] = [
  { k: "select", name: "Select", key: "V" }, { k: "hand", name: "Hand", key: "H" }, { k: "frame", name: "Frame", key: "F" },
  { k: "shape", name: "Shape", key: "R" }, { k: "pen", name: "Pen", key: "P" }, { k: "text", name: "Text", key: "T" },
  { k: "image", name: "Image", key: "I" }, { k: "component", name: "Component", key: "⇧I" }, { k: "more", name: "More", key: "" },
];

const PEOPLE = [
  { n: "T", who: "Tereza", c: "sky" },
  { n: "J", who: "Jonas", c: "green" },
];

function Avatars({ big = false }: { big?: boolean }) {
  return (
    <span className={`bt-avatars${big ? " bt-avatars--big" : ""}`} role="img" aria-label={`Here now: ${PEOPLE.map((p) => p.who).join(", ")}`}>
      {PEOPLE.map((p) => (
        <span key={p.n} className={`bt-av bt-av--${p.c}`} aria-hidden="true">{p.n}</span>
      ))}
    </span>
  );
}

function Working() {
  return (
    <span className="bt-dots" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

/* ─── Hero: one primary per surface ──────────────────────────────────────── */
function PrimaryLens() {
  const [lens, setLens] = useState<"all" | "primary">("all");
  return (
    <>
      <div className="bt-lens-bar">
        <span className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={lens === "all"} onClick={() => setLens("all")}>Every button</button>
          <button type="button" aria-pressed={lens === "primary"} onClick={() => setLens("primary")}>Primaries only</button>
        </span>
        <span className="bt-lens-note">
          {lens === "all"
            ? "Five panels, seventeen buttons. Switch the lens and count the azure."
            : "At most one azure per island, and some have none. The pressed tool is a selection and the spark is the AI — neither is a primary."}
        </span>
      </div>

      <div className="stage bt-hero" data-lens={lens}>
        <div className="bt-artboard">
          <div className="bt-artboard-img" />
          <div className="bt-artboard-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
        </div>
        <div className="sticky sticky--yellow bt-sticky">Bigger photo in the hero?</div>

        <button className="island bt-pill" type="button" aria-haspopup="menu" aria-expanded="false">
          <span aria-hidden="true"><Mark size={22} title="" /></span>
          <span>Studio site</span>
          <span className="bt-vh">, Project menu</span>
          <span className="bt-pill-caret"><Ic size={14}>{I.chevron}</Ic></span>
        </button>

        <div className="island bt-tr">
          <button className="icon-btn bt-quiet" type="button" aria-label="Show panels"><Ic>{I.panels}</Ic></button>
          <Avatars />
          <button className="btn btn--primary bt-one" type="button" data-one="Share">Share</button>
        </div>

        <div className="island island--pad bt-sheet">
          <p className="island-title">Share “Homepage”</p>
          <div className="bt-sheet-row">
            <input className="input" aria-label="Invite people" defaultValue="tereza@studio.site" />
            <button className="btn btn--primary bt-one" type="button" data-one="Invite">Invite</button>
          </div>
          <div className="bt-sheet-row bt-sheet-end">
            <button className="btn btn--ghost btn--sm bt-quiet" type="button"><Ic size={14}>{I.link}</Ic>Copy link</button>
            <button className="btn btn--ghost btn--sm bt-quiet" type="button">Done</button>
          </div>
        </div>

        <div className="island island--pad bt-ai">
          <div className="bt-ai-hd">
            <Spark size={14} color="var(--spark)" /> AI
            <button className="icon-btn bt-quiet bt-ai-x" type="button" aria-label="Dismiss"><Ic size={14}>{I.close}</Ic></button>
          </div>
          <p className="bt-ai-msg">The hero feels heavy. Three lighter takes could help.</p>
          <div className="bt-ai-row">
            <button className="btn btn--spark btn--sm bt-ai-act" type="button"><Spark size={10} color="var(--spark-fg)" /> Generate variants</button>
          </div>
        </div>

        <div className="island dock bt-dock" role="toolbar" aria-label="Toolbar">
          {TOOLBAR.map((t, i) => (
            <button key={t.k} className={`icon-btn ${i === 0 ? "bt-sel" : "bt-quiet"}`} type="button" aria-pressed={t.k === "more" ? undefined : i === 0} aria-label={t.name}><Ic size={18}>{I[t.k]}</Ic></button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── Hierarchy ──────────────────────────────────────────────────────────── */
const LADDER = [
  { k: "Primary", cls: "btn btn--primary", label: "Share", role: "The one thing this island is for. Azure, one per surface.", tok: "--accent · --accent-fg" },
  { k: "Secondary", cls: "btn", label: "Duplicate", role: "A real alternative that sits next to the primary. A quiet well.", tok: "--bg-3 · --fg-0" },
  { k: "Ghost", cls: "btn btn--ghost", label: "Cancel", role: "Ways out and small extras. No fill until you point at it.", tok: "transparent · --fg-1" },
  { k: "Spark", cls: "btn btn--spark", label: "Ask AI", role: "Only for something the AI will do. Never a second accent.", tok: "--spark · --spark-fg", spark: true },
];

/* ─── Lifecycles ─────────────────────────────────────────────────────────── */
type Frame = { s: string; node: ReactNode; note?: string };
const LIFE: { k: string; frames: Frame[] }[] = [
  {
    k: "Primary",
    frames: [
      { s: "Idle", node: <span className="btn btn--primary">Invite</span> },
      { s: "Hover", node: <span className="btn btn--primary bt-f-hover">Invite</span> },
      { s: "Pressed", node: <span className="btn btn--primary bt-f-press">Invite</span>, note: "scale 0.97" },
      { s: "Working", node: <span className="btn btn--primary bt-f-busy">Inviting <Working /></span>, note: "keeps the verb" },
      { s: "Done", node: <span className="btn btn--primary"><Ic size={14}>{I.check}</Ic>Invited</span>, note: "for 1.5 s, then back" },
    ],
  },
  {
    k: "Secondary",
    frames: [
      { s: "Idle", node: <span className="btn">Duplicate</span> },
      { s: "Hover", node: <span className="btn bt-f-hover2">Duplicate</span> },
      { s: "Pressed", node: <span className="btn bt-f-hover2 bt-f-press">Duplicate</span> },
      { s: "Working", node: <span className="btn bt-f-busy">Duplicating <Working /></span> },
      { s: "Done", node: <span className="btn"><Ic size={14}>{I.check}</Ic>Copy is on the canvas</span> },
    ],
  },
  {
    k: "Spark",
    frames: [
      { s: "Idle", node: <span className="btn btn--spark"><Spark size={11} color="var(--spark-fg)" />Generate variants</span> },
      { s: "Hover", node: <span className="btn btn--spark bt-f-spark-hover"><Spark size={11} color="var(--spark-fg)" />Generate variants</span> },
      { s: "Pressed", node: <span className="btn btn--spark bt-f-spark-hover bt-f-press"><Spark size={11} color="var(--spark-fg)" />Generate variants</span> },
      { s: "Working", node: <span className="btn btn--spark bt-f-busy"><span className="bt-spark-turn"><Spark size={11} color="var(--spark-fg)" /></span>Generating</span>, note: "the spark turns" },
      { s: "Done", node: <span className="btn btn--ghost bt-f-done-ai"><Spark size={11} color="var(--spark)" />Three variants added</span>, note: "hands back to you" },
    ],
  },
];

const SIZES = [
  { k: "Small", cls: "btn btn--ghost btn--sm", h: 26, label: "Copy link", where: "Inside dense islands — sheet footers, layer row actions." },
  { k: "Default", cls: "btn btn--primary", h: 32, label: "Share", where: "Every island. The size you reach for without thinking." },
  { k: "Large", cls: "btn btn--primary btn--lg", h: 40, label: "New canvas", where: "Home, empty canvases, onboarding — where a first step needs room." },
];

const ISLAND_ICONS: { k: string; i: ReactNode; key: string }[] = [
  { k: "Show panels", i: I.panels, key: "⌘\\" },
  { k: "Version history", i: I.history, key: "⌥⌘H" },
  { k: "Search", i: I.search, key: "⌘K" },
  { k: "More", i: I.more, key: "" },
];

export default function ComponentsButtons() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Buttons"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>One azure button per island. Everything else stays quiet.</h1>
          <p className="lede">
            Every island has one thing it is for, and that one button is azure. Alternatives sit in a
            quiet well, ways out have no fill at all, and the spark button only appears when the AI is
            about to do the work.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Variants</dt><dd>primary · secondary · ghost · spark</dd></div>
          <div><dt>Heights</dt><dd>26 · 32 · 40</dd></div>
          <div><dt>Corner</dt><dd>10 inside a 14 island</dd></div>
          <div><dt>Press</dt><dd>scale 0.97 · 120 ms</dd></div>
        </dl>

        <h2 data-no>One primary per surface<span className="h2-aside">a slice of the app — switch the lens and count</span></h2>
        <PrimaryLens />

        <h2 data-no>Four steps of loudness</h2>
        <div className="bt-ladder">
          {LADDER.map((l, i) => (
            <div className="bt-rung" key={l.k} style={{ "--rung": i } as CSSProperties}>
              <div className="bt-rung-demo">
                <button className={l.cls} type="button">
                  {l.spark ? <Spark size={11} color="var(--spark-fg)" /> : null}
                  {l.label}
                </button>
              </div>
              <strong>{l.k}</strong>
              <span>{l.role}</span>
              <code>{l.tok}</code>
            </div>
          ))}
        </div>
        <div className="bt-destructive">
          <div className="island island--pad bt-confirm">
            <span className="bt-confirm-q">Move “Pricing” to the trash?</span>
            <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
            <button className="btn btn--sm bt-danger" type="button">Move to trash</button>
          </div>
          <p>
            <strong>Taking something away</strong> is a quiet button with error-coloured words, confirmed in
            place, with the title's verb on the button and Cancel beside it. No red fill — nothing in the trash is gone, and the canvas comes back from Version history.
          </p>
        </div>

        <h2 data-no>A button's day<span className="h2-aside">same button, five moments</span></h2>
        <div className="bt-life">
          {LIFE.map((row) => (
            <div className="bt-life-row" key={row.k}>
              <span className="bt-life-k">{row.k}</span>
              <ol className="bt-film">
                {row.frames.map((f) => (
                  <li key={f.s}>
                    <span className="bt-film-cell" aria-hidden="true">{f.node}</span>
                    <span className="bt-film-s">{f.s}</span>
                    {f.note ? <span className="bt-film-n">{f.note}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <div className="bt-life-row bt-life-row--off">
            <span className="bt-life-k">Disabled</span>
            <div className="bt-off">
              <button className="btn btn--primary" type="button" disabled>Invite</button>
              <span className="bt-off-why">Add a name or an email first.</span>
              <span className="bt-off-note">
                Disabled buttons don't hover or press, and they always say why — the colour alone never
                explains anything.
              </span>
            </div>
          </div>
        </div>

        <h2 data-no>Three sizes<span className="h2-aside">height ruler · where each one lives</span></h2>
        <div className="bt-sizes">
          {SIZES.map((s) => (
            <div className="bt-size" key={s.k}>
              <div className="bt-size-demo">
                <span className="bt-ruler" style={{ height: s.h }} aria-hidden="true"><span>{s.h}</span></span>
                <button className={s.cls} type="button">{s.label}</button>
              </div>
              <strong>{s.k}</strong>
              <span>{s.where}</span>
            </div>
          ))}
        </div>

        <h2 data-no>Icon-only<span className="h2-aside">the unit of every panel and the toolbar</span></h2>
        <div className="bt-icons">
          <figure className="bt-icon-plate">
            <div className="stage bt-icon-stage">
              <div className="island bt-icon-island">
                {ISLAND_ICONS.map((b, i) => (
                  <span className="bt-tip-wrap" key={b.k}>
                    <button className={`icon-btn${i === 0 ? " bt-f-hover3" : ""}`} type="button" aria-label={b.k}><Ic>{b.i}</Ic></button>
                    {i === 0 ? (
                      <span className="bt-tip" aria-hidden="true">{b.k}<span className="kbd">{b.key}</span></span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
            <figcaption>
              <strong>Panel · 32</strong> A 16 px glyph in a 32 px button, corner 10, 4 px from the panel's edge.
              Every one has a name; pointing at it shows the name and its key.
            </figcaption>
          </figure>
          <figure className="bt-icon-plate">
            <div className="stage bt-icon-stage">
              <div className="island dock bt-icon-dock" role="toolbar" aria-label="Toolbar, second example">
                {TOOLBAR.map((t, i) => (
                  <button key={t.k} className="icon-btn" type="button" aria-pressed={t.k === "more" ? undefined : i === 0} aria-label={t.name} tabIndex={-1}><Ic size={18}>{I[t.k]}</Ic></button>
                ))}
              </div>
              <span className="bt-keys" aria-hidden="true">
                {TOOLBAR.map((t) => (t.key ? <span className="kbd" key={t.k}>{t.key}</span> : <span className="bt-keys-gap" key={t.k} />))}
              </span>
            </div>
            <figcaption>
              <strong>Toolbar · 40</strong> Rounder and chunkier: an 18 px glyph, corner 12, nested in the toolbar's 20.
              The current tool is pressed — azure as selection. The AI is not a slot here: it is the AI chat panel.
            </figcaption>
          </figure>
        </div>

        <h3>Key hints</h3>
        <div className="bt-kbd-row">
          <button className="btn" type="button">Search<span className="kbd">⌘K</span></button>
          <button className="btn btn--ghost" type="button">Hide panels<span className="kbd">⌘\</span></button>
          <button className="btn btn--primary" type="button">New canvas<span className="kbd bt-kbd-on">⌘N</span></button>
          <span className="bt-kbd-note">A hint sits after the label, one step quieter. On azure it turns to a soft tint so it never competes with the word.</span>
        </div>

        <h2 data-no>The Share button<span className="h2-aside">magnified · the one primary in the top-right panel</span></h2>
        <div className="bt-share">
          <div className="stage bt-share-stage">
            <div className="bt-share-zoom">
              <div className="island bt-share-island">
                <button className="icon-btn" type="button" aria-label="Show panels" tabIndex={-1}><Ic>{I.panels}</Ic></button>
                <Avatars />
                <button className="btn btn--primary" type="button" tabIndex={-1}>Share</button>
                <span className="bt-pin bt-pin--1" aria-hidden="true">1</span>
                <span className="bt-pin bt-pin--2" aria-hidden="true">2</span>
                <span className="bt-pin bt-pin--3" aria-hidden="true">3</span>
                <span className="bt-pin bt-pin--4" aria-hidden="true">4</span>
              </div>
            </div>
          </div>
          <ol className="bt-share-key">
            <li><span className="bt-pin">1</span><div><strong>Who's here</strong><span>Faces of the people on this canvas, in their canvas colours. Click one to follow their view.</span></div></li>
            <li><span className="bt-pin">2</span><div><strong>Always one word</strong><span>“Share”, whatever the state. The sheet behind it does the explaining.</span></div></li>
            <li><span className="bt-pin">3</span><div><strong>The island's one azure</strong><span>The panels button beside it stays quiet, so Share leads without shouting.</span></div></li>
            <li><span className="bt-pin">4</span><div><strong>Nested corners</strong><span>Corner 10 inside the island's 14, with 4 px between — the curves share a centre.</span></div></li>
          </ol>
        </div>
        <div className="bt-widths">
          <div className="bt-width">
            <div className="island bt-w-island"><button className="icon-btn" type="button" aria-label="Show panels"><Ic>{I.panels}</Ic></button><Avatars /><button className="btn btn--primary" type="button">Share</button></div>
            <span>Wide window — faces, then Share.</span>
          </div>
          <div className="bt-width">
            <div className="island bt-w-island"><button className="icon-btn" type="button" aria-label="Show panels"><Ic>{I.panels}</Ic></button><button className="btn btn--primary" type="button">Share</button></div>
            <span>Narrower — the faces fold into the sheet.</span>
          </div>
          <div className="bt-width">
            <div className="island bt-w-island"><button className="icon-btn bt-share-ic" type="button" aria-label="Share"><Ic>{I.share}</Ic></button></div>
            <span>Panels hidden — Share stays, as an azure icon.</span>
          </div>
        </div>

        <h2 data-no>Right and wrong</h2>
        <div className="bt-compare">
          <figure className="bt-case">
            <div className="stage bt-mini">
              <div className="island island--pad bt-mini-sheet">
                <p className="island-title">Export “Homepage”</p>
                <div className="bt-mini-row">
                  <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
                  <button className="btn btn--sm" type="button">Copy as image</button>
                  <button className="btn btn--primary btn--sm" type="button">Export</button>
                </div>
              </div>
            </div>
            <figcaption><strong className="bt-ok">Right</strong> One azure, one quiet alternative, one way out — read right to left by importance.</figcaption>
          </figure>
          <figure className="bt-case">
            <div className="stage bt-mini">
              <div className="island island--pad bt-mini-sheet">
                <p className="island-title">Export “Homepage”</p>
                <div className="bt-mini-row">
                  <button className="btn btn--primary btn--sm" type="button">Cancel</button>
                  <button className="btn btn--primary btn--sm" type="button">Copy as image</button>
                  <button className="btn btn--spark btn--sm" type="button">Export</button>
                </div>
              </div>
            </div>
            <figcaption><strong className="bt-bad">Wrong</strong> Three loud buttons, and the spark on an export the AI isn't doing. Nothing leads, and the spark stops meaning “the AI”.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · buttons</span>
        <span>One primary per island · the spark only for the AI</span>
      </footer>
    </>
  );
}
