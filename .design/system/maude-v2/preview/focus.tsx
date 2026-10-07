/**
 * SPECIMEN — focus · maude-v2
 *
 * DEMONSTRATES: --accent as the focus ring · --accent-tint as the field halo ·
 *               :focus-visible (keyboard only, never on click) · the keyboard path
 *               through the islands.
 * COMPOSITION:  hero = a slice of the app with the keyboard path numbered on the
 *               real controls; an auto-tour walks the ring along it until you take
 *               over with Tab · anatomy of the two forms (ring, halo) · every island
 *               control idle vs focused · a live island to tab through · four rules.
 * NOTES:        Two forms, one colour. Buttons, icon buttons, rows and canvas objects
 *               get the RING (2 px --accent, offset outside). Fields and the AI prompt
 *               get the HALO (3 px --accent-tint plus a 1 px --accent line). The spark
 *               never marks focus, not even on the AI prompt. Focus is where your keys
 *               go; selection is what you picked — see selection.tsx.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./focus.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

const PATH = [
  { k: "F6", t: "Project menu", d: "The pill under the icon — rename, version history, Advanced." },
  { k: "F6", t: "Canvases", d: "Arrow keys move between canvases, Return opens one." },
  { k: "F6", t: "Panels & Share", d: "Tab moves between the two buttons." },
  { k: "F6", t: "Ask AI", d: "Type, then Return. Esc hands focus back to the canvas." },
  { k: "F6", t: "Toolbar", d: "Arrow keys pick a tool; the dock remembers the last one." },
  { k: "Esc", t: "On the canvas", d: "Tab walks the objects — this sticky, then the artboard." },
];

function PointerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M4 3l9 4.5-4 1.2L8 13z" />
    </svg>
  );
}
function FrameIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 5h12M2 11h12M5 2v12M11 2v12" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M8 4v9" />
    </svg>
  );
}
function PanelsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="2.2" />
      <line x1="10" y1="3" x2="10" y2="13" />
    </svg>
  );
}

function Stop({ n }: { n: number }) {
  return <span className="fo-stop" aria-hidden="true">{n}</span>;
}

/* ─── Hero: the keyboard path ────────────────────────────────────────────── */

function KeyboardPath() {
  const [step, setStep] = useState(0);
  const [touring, setTouring] = useState(true);

  useEffect(() => {
    if (!touring) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % PATH.length), 1500);
    return () => window.clearInterval(id);
  }, [touring]);

  const tour = (i: number) => (touring && step === i ? "true" : undefined);

  return (
    <div className="fo-hero">
      <div
        className="stage fo-stage"
        onFocusCapture={() => setTouring(false)}
      >
        <div className="fo-board">
          <div className="fo-board-img" />
          <div className="fo-board-body"><strong>Onboarding</strong><span>Welcome, pick a template, invite.</span></div>
        </div>
        <div className="sticky sticky--coral fo-sticky" tabIndex={0} data-tour={tour(5)} role="group" aria-roledescription="sticky" aria-label="Shorter welcome line">
          Shorter welcome line
          <Stop n={6} />
        </div>

        <div className="fo-pill-wrap">
          <button className="island fo-pill" type="button" data-tour={tour(0)}>
            <Mark size={20} />
            <span>Studio site</span>
          </button>
          <Stop n={1} />
        </div>

        <div className="island island--pad fo-list" data-tour-within={tour(1)}>
          <p className="island-title">Canvases</p>
          <button className="row-item fo-row" type="button" data-tour={tour(1)}><span className="thumb fo-th-coral" />Onboarding</button>
          <button className="row-item fo-row" type="button"><span className="thumb fo-th-yellow" />Homepage</button>
          <button className="row-item fo-row" type="button"><span className="thumb fo-th-green" />Pricing</button>
          <Stop n={2} />
        </div>

        <div className="island fo-tr">
          <button className="icon-btn" type="button" aria-label="Hide panels" aria-keyshortcuts="Meta+Backslash" data-tour={tour(2)}><PanelsIcon /></button>
          <button className="btn btn--primary" type="button">Share</button>
          <Stop n={3} />
        </div>

        <div className="island island--pad fo-ai">
          <div className="fo-ai-hd"><Spark size={12} color="var(--spark)" /> AI</div>
          <label className="ask" data-tour={tour(3)}>
            <input aria-label="Ask AI" placeholder="Ask AI to tidy the welcome step…" />
            <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
          </label>
          <Stop n={4} />
        </div>

        <div className="island dock fo-dock" role="toolbar" aria-label="Toolbar">
          <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select" data-tour={tour(4)}><PointerIcon /></button>
          <button className="icon-btn" type="button" aria-label="Frame"><FrameIcon /></button>
          <button className="icon-btn" type="button" aria-label="Text"><TextIcon /></button>
          <Stop n={5} />
        </div>
      </div>

      <ol className="fo-path" aria-label="Keyboard path">
        {PATH.map((p, i) => (
          <li key={p.t} data-active={touring && step === i ? "true" : undefined}>
            <span className="fo-path-n">{i + 1}</span>
            <div>
              <strong>{p.t}</strong>
              <span>{p.d}</span>
            </div>
            <span className="kbd">{p.k}</span>
          </li>
        ))}
        <li className="fo-path-foot">
          {touring
            ? "Walking the path on its own. Press Tab inside the canvas to take over."
            : "You have the keyboard. F6 jumps panel to panel, Tab moves inside one."}
        </li>
      </ol>
    </div>
  );
}

/* ─── Idle vs focused grid ───────────────────────────────────────────────── */

const CONTROLS: { name: string; form: "Ring" | "Halo" | "Ring, inside" | "Ring, 3 px out"; render: (focused: boolean) => ReactNode }[] = [
  { name: "Primary button", form: "Ring", render: (f) => <button type="button" tabIndex={-1} className={`btn btn--primary${f ? " fo-ring" : ""}`}>Share</button> },
  { name: "Quiet button", form: "Ring", render: (f) => <button type="button" tabIndex={-1} className={`btn btn--ghost${f ? " fo-ring" : ""}`}>Cancel</button> },
  { name: "Icon button", form: "Ring", render: (f) => <button type="button" tabIndex={-1} aria-label="Frame" className={`icon-btn${f ? " fo-ring" : ""}`}><FrameIcon /></button> },
  {
    name: "Segmented",
    form: "Ring",
    render: (f) => (
      <span className="seg">
        <button type="button" tabIndex={-1} aria-pressed="true">Fill</button>
        <button type="button" tabIndex={-1} aria-pressed="false" className={f ? "fo-ring" : undefined}>Fit</button>
      </span>
    ),
  },
  { name: "Switch", form: "Ring", render: (f) => <button type="button" tabIndex={-1} role="switch" aria-checked="true" aria-label="Snap to grid" className={`switch${f ? " fo-ring" : ""}`} /> },
  { name: "Text field", form: "Halo", render: (f) => <input tabIndex={-1} className={`input${f ? " fo-halo" : ""}`} defaultValue="Onboarding" aria-label="Canvas name" /> },
  {
    name: "AI prompt",
    form: "Halo",
    render: (f) => (
      <span className={`ask fo-ask${f ? " fo-halo" : ""}`}>
        <input tabIndex={-1} aria-label="Ask AI" placeholder="Ask AI…" />
        <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
      </span>
    ),
  },
  { name: "Layer row", form: "Ring, inside", render: (f) => <span className={`row-item fo-row-demo${f ? " fo-ring-in" : ""}`}><span className="thumb fo-th-yellow" />Headline</span> },
  { name: "Sticky", form: "Ring, 3 px out", render: (f) => <span className={`sticky sticky--yellow fo-mini-sticky${f ? " fo-ring-out" : ""}`}>Idea</span> },
];

export default function Focus() {
  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Focus"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Your keys go where the azure ring is.</h1>
          <p className="lede">
            Focus shows up only when you use the keyboard, and it is always the same azure — on a
            button, a field, the AI prompt or a sticky. One key jumps from island to island, so you
            can work the whole app without reaching for the trackpad.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Ring</dt><dd>2 px --accent · 2 px outside</dd></div>
          <div><dt>Halo</dt><dd>3 px --accent-tint + 1 px --accent</dd></div>
          <div><dt>Shows on</dt><dd>:focus-visible only</dd></div>
          <div><dt>Between islands</dt><dd>F6 · Tab inside · Esc to canvas</dd></div>
        </dl>

        <h2 data-no>The keyboard path<span className="h2-aside">numbered on the real controls</span></h2>
        <KeyboardPath />

        <h2 data-no>Two forms, one colour</h2>
        <div className="fo-anatomy">
          <figure className="fo-anat">
            <div className="fo-anat-stage">
              <button type="button" tabIndex={-1} className="btn btn--primary btn--lg fo-ring">Share</button>
              <span className="fo-dim fo-dim--ring">2 px --accent</span>
              <span className="fo-dim fo-dim--gap">2 px gap</span>
            </div>
            <figcaption>
              <strong>Ring</strong> — buttons, icon buttons, segments, switches, rows, canvas objects.
              Drawn with <code>outline</code>, so it never shifts the layout or hides the control's own edge.
            </figcaption>
          </figure>
          <figure className="fo-anat">
            <div className="fo-anat-stage">
              <input tabIndex={-1} className="input fo-halo fo-anat-input" defaultValue="Mobile — detail" aria-label="Canvas name" />
              <span className="fo-dim fo-dim--halo">3 px --accent-tint</span>
              <span className="fo-dim fo-dim--line">1 px --accent</span>
            </div>
            <figcaption>
              <strong>Halo</strong> — text fields and the AI prompt. The well brightens to <code>--bg-2</code>{" "}
              and a soft azure glow says “type here”, without a hard frame around your words.
            </figcaption>
          </figure>
        </div>

        <h2 data-no>Every control, focused<span className="h2-aside">idle on the left, keyboard focus on the right</span></h2>
        <div className="fo-grid">
          {CONTROLS.map((c) => (
            <div className="fo-cell" key={c.name}>
              <div className="fo-cell-hd"><strong>{c.name}</strong><span>{c.form}</span></div>
              <div className="island fo-cell-pair">
                <div className="fo-cell-slot">{c.render(false)}</div>
                <div className="fo-cell-slot">{c.render(true)}</div>
              </div>
            </div>
          ))}
        </div>

        <h2 data-no>Try it<span className="h2-aside">Tab through this island — click shows no ring, keys do</span></h2>
        <div className="stage fo-try">
          <div className="island island--pad fo-try-island">
            <p className="island-title">Share “Homepage”</p>
            <div className="field">
              <label className="field-label" htmlFor="fo-invite">Invite</label>
              <input id="fo-invite" className="input" placeholder="Tereza, Jonas…" />
            </div>
            <div className="fo-try-row">
              <span className="seg" role="group" aria-label="Access">
                <button type="button" aria-pressed="true">Can edit</button>
                <button type="button" aria-pressed="false">Can comment</button>
              </span>
            </div>
            <div className="fo-try-row fo-try-end">
              <button className="btn btn--ghost" type="button">Copy link</button>
              <button className="btn btn--primary" type="button">Invite</button>
            </div>
          </div>
        </div>

        <h2 data-no>Four rules</h2>
        <div className="fo-rules">
          <div className="fo-rule"><strong>Keyboard only</strong><span>Rings use <code>:focus-visible</code>. A click never leaves one behind.</span></div>
          <div className="fo-rule"><strong>Azure, even next to the AI</strong><span>The AI prompt focuses in azure. The spark belongs to the AI, not to your cursor.</span></div>
          <div className="fo-rule"><strong>Never just removed</strong><span>Restyle a control and the ring comes with it. No <code>outline: none</code> without a replacement.</span></div>
          <div className="fo-rule"><strong>Focus is not selection</strong><span>Selection is what you picked; focus is where your keys go. They can sit on the same artboard.</span></div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · focus</span>
        <span>Ring for things you press, halo for things you type into</span>
      </footer>
    </>
  );
}
