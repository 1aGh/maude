/**
 * SPECIMEN — components-tooltips · maude-v2
 *
 * DEMONSTRATES: the ink tooltip (--fg-0 fill, --bg-1 text, --radius-sm) · the rich tooltip on the
 *               popover plane (--bg-2, --shadow-lg, --radius-lg) · the first-use hint (an island
 *               with a pointer and an --accent-tint ring on its target) · .kbd inside each ·
 *               --dur-soft fades with no movement.
 * COMPOSITION:  hero = a slice of the app with all three kinds anchored to real controls: a hint
 *               on the Show panels button, a rich tooltip on the Component tool in the toolbar,
 *               an ink tooltip on zoom · the three kinds side by side with their timing · a delay
 *               timeline (pause → appear, glide to a neighbour → instant) · a live dock to hover ·
 *               placement points toward the canvas · hints instead of tours (right/wrong) ·
 *               keep-or-kill wording.
 * COPY VOICE:   a tooltip is the control's name, no period ("Frame"); a rich tooltip adds one
 *               sentence about what it does to your work; a hint says what just happened and
 *               how to undo it, in the product's own voice.
 * WHEN SCAFFOLDED: universal (default-on).
 * NOTES:        Keys and Edit-toolbar order are CONTRACT §2 exactly (V H F R P T I ⇧I · More); glyphs are
 *               iconography.tsx GLYPHS, verbatim. The AI is not a toolbar tool — it is the AI chat
 *               panel, hidden to its spark at the bottom right.
 *               Tooltips never carry information you can't get another way — they name things.
 *               Hints replace the old step-by-step tours: one at a time, the first time it
 *               matters, and the tours themselves still live under Help.
 */
import type { ReactNode } from "react";
import "./_layout.css";
import "./components-tooltips.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Tool = { id: string; label: string; key: string; d: ReactNode };

const I = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** The Edit toolbar, left → right (CONTRACT §2) — glyphs copied verbatim from iconography.tsx GLYPHS. */
const TOOLS: Tool[] = [
  { id: "select", label: "Select", key: "V", d: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" /> },
  { id: "hand", label: "Hand", key: "H", d: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" /> },
  { id: "frame", label: "Frame", key: "F", d: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" /> },
  { id: "shape", label: "Shape", key: "R", d: <><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></> },
  { id: "pen", label: "Pen", key: "P", d: <><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></> },
  { id: "text", label: "Text", key: "T", d: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" /> },
  { id: "image", label: "Image", key: "I", d: <><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></> },
  { id: "component", label: "Component", key: "⇧I", d: <><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></> },
  { id: "more", label: "More", key: "", d: <g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g> },
];

function ToolIcon({ t }: { t: Tool }) {
  return <svg viewBox="0 0 16 16" {...I} aria-hidden="true">{t.d}</svg>;
}

/** "Right panels" — iconography.tsx GLYPHS panel-right, verbatim. */
function PanelsIcon() {
  return (
    <svg viewBox="0 0 16 16" {...I} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" />
    </svg>
  );
}

const KINDS = [
  {
    cls: "ink", name: "Tooltip", when: "Names a control.", delay: "after a 400 ms pause", stays: "until the pointer leaves",
    demo: <span className="tt-tip">Frame <span className="kbd tt-kbd">F</span></span>,
  },
  {
    cls: "rich", name: "Rich tooltip", when: "Names a tool and says what it does.", delay: "after a 700 ms pause", stays: "until the pointer leaves",
    demo: (
      <span className="tt-rich tt-rich--static">
        <span className="tt-rich-hd"><strong>Comment</strong><span className="kbd">C</span></span>
        <span>Pin a note to anything on the canvas. People you share with see it.</span>
      </span>
    ),
  },
  {
    cls: "hint", name: "First-use hint", when: "Explains something that just happened.", delay: "once, at that moment", stays: "until “Got it”",
    demo: (
      <span className="tt-hint tt-hint--static">
        <span>Panels hidden. Press <span className="kbd">⌘</span><span className="kbd">\</span> to bring them back.</span>
        <span className="tt-hint-ft"><button className="btn btn--ghost btn--sm" type="button">Got it</button></span>
      </span>
    ),
  },
];

const WORDS = [
  { keep: "Frame", kill: "Frame tool — click to create a new frame element (F)" },
  { keep: "Show panels", kill: "Toggle dock panel visibility" },
  { keep: "Ask AI", kill: "Open assistant (Claude Code session)" },
  { keep: "Zoom to fit", kill: "Fit all artboards to viewport bounds" },
];

export default function ComponentsTooltips() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Tooltips & hints"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>A word when you pause. A hint when it matters. Never a tour.</h1>
          <p className="lede">
            Tooltips name things and get out of the way. A rich tooltip adds one sentence on the tools
            people wonder about. And instead of a six-step tour, Maude says one thing, once, right
            where it just happened.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Tooltip</dt><dd>ink · --radius-sm</dd></div>
          <div><dt>Rich</dt><dd>--bg-2 · --shadow-lg</dd></div>
          <div><dt>Hint</dt><dd>island + pointer</dd></div>
          <div><dt>Fade</dt><dd>--dur-soft, opacity only</dd></div>
        </dl>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <h2 data-no>In the app<span className="h2-aside">each kind anchored to the control it explains</span></h2>
        <div className="stage tt-hero">
          <div className="tt-board">
            <div className="tt-board-img" />
            <div className="tt-board-body"><strong>Onboarding</strong><span>Welcome, pick a plan, invite the team.</span></div>
          </div>
          <div className="sticky sticky--green tt-st1">Shorter welcome text</div>

          <div className="island tt-pill" aria-hidden="true"><Mark size={22} title="" /><span>Studio site</span><span className="tt-pill-sep">/</span><span>Onboarding</span><span className="tt-caret">⌄</span></div>

          {/* 1 · first-use hint on the Show panels button */}
          <div className="island tt-tr">
            <button className="icon-btn tt-target" type="button" aria-label="Show panels" aria-describedby="tt-hint-1"><PanelsIcon /></button>
            <button className="btn btn--primary" type="button">Share</button>
          </div>
          <div className="tt-hint tt-hint--hero" id="tt-hint-1" role="note">
            <span className="tt-hint-arrow" aria-hidden="true" />
            <strong>Panels hidden.</strong>
            <span>Press <span className="kbd">⌘</span><span className="kbd">\</span> or click here to bring them back.</span>
            <span className="tt-hint-ft">
              <span className="tt-hint-step">Tip</span>
              <button className="btn btn--ghost btn--sm" type="button">Got it</button>
            </span>
          </div>

          {/* 2 · rich tooltip on the Component tool */}
          <div className="island dock tt-dock" role="toolbar" aria-label="Toolbar">
            {TOOLS.map((t) => (
              <button key={t.id} className={`icon-btn${t.id === "component" ? " tt-hover" : ""}`} type="button" aria-pressed={t.id === "more" ? undefined : t.id === "select"} aria-label={t.label} aria-describedby={t.id === "component" ? "tt-rich-1" : undefined}>
                <ToolIcon t={t} />
              </button>
            ))}
          </div>
          <div className="island tt-ai-fold">
            <button className="icon-btn tt-ai" type="button" aria-label="Open the AI chat panel"><Spark size={16} color="var(--spark)" /></button>
          </div>
          <div className="tt-rich tt-rich--hero" role="tooltip" id="tt-rich-1">
            <span className="tt-rich-hd"><strong>Component</strong><span className="tt-rich-keys"><span className="kbd">⇧</span><span className="kbd">I</span></span></span>
            <span>Place a piece from your design system. Change the original and every copy follows.</span>
            <span className="tt-arrow tt-arrow--down tt-arrow--card" aria-hidden="true" />
          </div>

          {/* 3 · ink tooltip on zoom */}
          <div className="island tt-zoom">
            <button className="icon-btn" type="button" aria-label="Zoom out"><svg viewBox="0 0 16 16" {...I}><path d="M4 8h8" /></svg></button>
            <button className="tt-zoom-v tt-hover" type="button" aria-describedby="tt-tip-1">72%</button>
            <button className="icon-btn" type="button" aria-label="Zoom in"><svg viewBox="0 0 16 16" {...I}><path d="M4 8h8M8 4v8" /></svg></button>
          </div>
          <span className="tt-tip tt-tip--hero" role="tooltip" id="tt-tip-1">Zoom to fit <span className="kbd tt-kbd">⌘</span><span className="kbd tt-kbd">0</span><span className="tt-arrow tt-arrow--down" aria-hidden="true" /></span>

          <span className="tt-tag tt-tag--1" aria-hidden="true">1</span>
          <span className="tt-tag tt-tag--2" aria-hidden="true">2</span>
          <span className="tt-tag tt-tag--3" aria-hidden="true">3</span>
        </div>
        <ol className="tt-hero-key">
          <li><span className="tt-tag">1</span><span><strong>First-use hint.</strong> You just pressed ⌘\ by accident. It says what happened and how to undo it, then leaves for good.</span></li>
          <li><span className="tt-tag">2</span><span><strong>Rich tooltip.</strong> Components are new to many people, so the tool explains itself in one line.</span></li>
          <li><span className="tt-tag">3</span><span><strong>Tooltip.</strong> The name and the shortcut. Nothing else.</span></li>
        </ol>

        {/* ── Three kinds ─────────────────────────────────────────────── */}
        <h2 data-no>Three kinds<span className="h2-aside">each says a little more, and waits a little longer</span></h2>
        <div className="tt-kinds">
          {KINDS.map((k) => (
            <div className="tt-kind" key={k.cls}>
              <div className="tt-kind-demo">{k.demo}</div>
              <div className="tt-kind-meta">
                <strong>{k.name}</strong>
                <span>{k.when}</span>
                <dl>
                  <div><dt>Shows</dt><dd>{k.delay}</dd></div>
                  <div><dt>Stays</dt><dd>{k.stays}</dd></div>
                </dl>
              </div>
            </div>
          ))}
        </div>

        {/* ── Timing ──────────────────────────────────────────────────── */}
        <h2 data-no>Timing<span className="h2-aside">patient the first time, instant once you're browsing</span></h2>
        <div className="tt-time">
          <div className="tt-time-track" aria-hidden="true">
            <span className="tt-time-tick" style={{ left: "0%" }}>0</span>
            <span className="tt-time-tick" style={{ left: "33.3%" }}>400 ms</span>
            <span className="tt-time-tick" style={{ left: "58.3%" }}>700 ms</span>
            <span className="tt-time-tick" style={{ left: "100%" }}>1.2 s</span>
          </div>
          <div className="tt-lane">
            <span className="tt-lane-l">Pause on Frame</span>
            <div className="tt-lane-bar"><span className="tt-seg tt-seg--wait" style={{ left: 0, width: "33.3%" }}>waiting</span><span className="tt-seg tt-seg--show" style={{ left: "33.3%", width: "66.7%" }}>“Frame F”</span></div>
          </div>
          <div className="tt-lane">
            <span className="tt-lane-l">Glide to Text</span>
            <div className="tt-lane-bar"><span className="tt-seg tt-seg--show" style={{ left: 0, width: "100%" }}>“Text T” — no wait, the tooltip just moves</span></div>
          </div>
          <div className="tt-lane">
            <span className="tt-lane-l">Pause on Component</span>
            <div className="tt-lane-bar"><span className="tt-seg tt-seg--wait" style={{ left: 0, width: "58.3%" }}>waiting a little longer</span><span className="tt-seg tt-seg--rich" style={{ left: "58.3%", width: "41.7%" }}>rich tooltip</span></div>
          </div>
          <div className="tt-lane">
            <span className="tt-lane-l">Click or leave</span>
            <div className="tt-lane-bar"><span className="tt-seg tt-seg--gone" style={{ left: 0, width: "13%" }}>fade</span><span className="tt-lane-note">gone on --dur-soft; clicking never leaves a tooltip behind</span></div>
          </div>
        </div>

        {/* ── Live + placement ────────────────────────────────────────── */}
        <h2 data-no>Hover it<span className="h2-aside">and tab through — focus shows the same tooltip</span></h2>
        <div className="tt-live">
          <div className="stage tt-live-stage">
            <div className="island dock tt-live-dock">
              {TOOLS.map((t) => (
                <span className="tt-live-item" key={t.id}>
                  <button className="icon-btn" type="button" aria-label={t.label} aria-pressed={t.id === "more" ? undefined : t.id === "select"}><ToolIcon t={t} /></button>
                  <span className="tt-tip tt-tip--live" role="tooltip">{t.label}{t.key ? <> <span className="kbd tt-kbd">{t.key}</span></> : null}<span className="tt-arrow tt-arrow--down" aria-hidden="true" /></span>
                </span>
              ))}
            </div>
            <div className="island tt-live-side">
              {["Canvases", "Layers", "Comments"].map((l) => (
                <span className="tt-live-item tt-live-item--side" key={l}>
                  <button className="icon-btn" type="button" aria-label={l}>
                    <svg viewBox="0 0 16 16" {...I} aria-hidden="true">{l === "Canvases" ? <><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M6 3v10" /></> : l === "Layers" ? <path d="M8 2.5l5.5 3.25L8 9 2.5 5.75zM2.5 9.25L8 12.5l5.5-3.25" /> : <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />}</svg>
                  </button>
                  <span className="tt-tip tt-tip--right" role="tooltip">{l}<span className="tt-arrow tt-arrow--left" aria-hidden="true" /></span>
                </span>
              ))}
            </div>
          </div>
          <div className="tt-place">
            <strong>Point toward the canvas</strong>
            <p>A tooltip opens on the side facing your work, away from the window edge: above the toolbar, right of a left panel, below the top panels.</p>
            <div className="tt-place-map" aria-hidden="true">
              <span className="tt-pm tt-pm--top">↓ top panels</span>
              <span className="tt-pm tt-pm--left">left panel →</span>
              <span className="tt-pm tt-pm--right">← right panel</span>
              <span className="tt-pm tt-pm--dock">↑ toolbar</span>
              <span className="tt-pm-canvas">your canvas</span>
            </div>
          </div>
        </div>

        {/* ── Hints, not tours ────────────────────────────────────────── */}
        <h2 data-no>Hints, not tours<span className="h2-aside">one thing, once, where it happened</span></h2>
        <div className="tt-compare">
          <figure className="tt-case">
            <div className="stage tt-mini">
              <div className="tt-mini-board" />
              <div className="island tt-mini-tr"><button className="icon-btn tt-target" type="button" aria-label="Show panels"><PanelsIcon /></button></div>
              <div className="tt-hint tt-hint--mini" role="note">
                <span className="tt-hint-arrow" aria-hidden="true" />
                <span>Panels hidden. Press <span className="kbd">⌘</span><span className="kbd">\</span> to bring them back.</span>
                <span className="tt-hint-ft"><button className="btn btn--ghost btn--sm" type="button">Got it</button></span>
              </div>
            </div>
            <figcaption><strong className="tt-ok">Right</strong> It appears the first time you hide the panels, points at the button that brings them back, and never shows again.</figcaption>
          </figure>
          <figure className="tt-case">
            <div className="stage tt-mini" aria-hidden="true">
              <div className="tt-mini-board" />
              <div className="tt-tour-veil" />
              <div className="tt-tour">
                <span className="tt-tour-step">Step 2 of 6</span>
                <strong>Welcome to the canvas!</strong>
                <span>Here you can find files, layers, inspector, comments, changes, sync and the assistant.</span>
                <span className="tt-tour-ft"><span>Skip</span><span>Back</span><span className="tt-tour-next">Next</span></span>
              </div>
            </div>
            <figcaption><strong className="tt-bad">Wrong</strong> A six-step tour before you've made anything. A list of every panel, an exclamation mark, and a blocked canvas.</figcaption>
          </figure>
        </div>
        <div className="tt-hint-rules">
          <div><strong>Once</strong><span>A hint shows the first time it's useful, then remembers you've seen it.</span></div>
          <div><strong>Anchored</strong><span>It points at a real control, never at empty canvas.</span></div>
          <div><strong>One at a time</strong><span>If two could show, the second waits for another day.</span></div>
          <div><strong>Still there</strong><span>The full tour lives in Menu › Help › Take the tour — moved, not removed.</span></div>
        </div>

        {/* ── Words ───────────────────────────────────────────────────── */}
        <h2 data-no>Say the name<span className="h2-aside">keep or kill</span></h2>
        <div className="tt-words">
          {WORDS.map((w) => (
            <div className="tt-word" key={w.keep}>
              <span className="tt-tip">{w.keep}</span>
              <span className="tt-word-kill">{w.kill}</span>
            </div>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · tooltips &amp; hints</span>
        <span>Name it, then get out of the way</span>
      </footer>
    </>
  );
}
