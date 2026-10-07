/**
 * SPECIMEN — empty-state · maude-v2
 *
 * DEMONSTRATES: --font-rounded (the playful face, allowed here) · --fg-0..3 · --spark /
 *   --spark-fg (the Ask-AI prompt and the AI's own next step) · --accent (only where a
 *   non-AI primary action exists) · --object-* (starter thumbnails = canvas content) ·
 *   --dur-spring + --ease-spring (the one drop of spring, on the hero) · .island · .ask ·
 *   .btn--spark · .kbd · .row-item · .chip.
 * COMPOSITION: hero = the first-run Home ("What shall we make?") — an Ask-AI prompt and
 *   three starter suggestions that land with a spring, with numbered notes anchored to
 *   each part · six empty surfaces from the real app (empty canvas, AI chat panel, no
 *   search results, no comments yet, version history, shared with you) · the anatomy of
 *   one empty state · "Voice — keep or kill" (good copy vs corporate / dev-jargon copy)
 *   + the CONTRACT §3 words (say / not) · where play stops (empty state vs error).
 * CONTRACT: the Home question is --type-3xl · --font-rounded · --w-semibold · tracking 0; the
 *   no-results line is CONTRACT §4 word for word; the app never says "we" or names itself
 *   (sole exception: "What shall we make?"); one action per empty state; toolbar in order.
 * COPY VOICE: the title is the situation in the user's words ("No comments on Homepage
 *   yet"), the next sentence is what to do ("Press C, then click anywhere"), the action
 *   is a verb about their work ("Ask AI", "Share for feedback") — never "Get Started".
 * WHEN SCAFFOLDED: universal (default-on). Reference: universal/empty-state.html.tpl.
 * NOTES: empty states are a playful surface, so the situation line is set in SF Pro
 *   Rounded. Errors are not empty states — they stay in the plain face (last section).
 *
 * ANIMATION SAFETY: one-shot entrance on the hero only — the spark glyph (40 px, ≤ 56)
 *   and the three starter cards rise and settle on --dur-spring · --ease-spring.
 *   Compositor-only (transform + opacity). Every animated child sits inside a stage
 *   with overflow: hidden. "Replay" remounts the hero so the moment can be seen again.
 *   Reduced motion: the tokens collapse every --dur-* to 1 ms, and empty-state.css also
 *   drops the animation when the page is previewed with data-reduced-motion="true".
 */
import { useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./empty-state.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — lifted from the maude-v2 family (16-unit grid, 1.5 rounded stroke) ── */
const PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25l3.25 3.25" />
    </>
  ),
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  sticky: (
    <>
      <path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" />
      <path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" />
    </>
  ),
  share: (
    <>
      <path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" />
      <path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" />
    </>
  ),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  more: (<g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>),
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  warn: (
    <>
      <path d="M8 2.75l5.75 10H2.25z" />
      <path d="M8 6.75v2.5M8 11h.01" />
    </>
  ),
};

/** Toolbar, left → right (CONTRACT §2). */
const TOOLBAR: [string, string][] = [
  ["select", "Select"], ["hand", "Hand"], ["frame", "Frame"], ["shape", "Shape"], ["pen", "Pen"],
  ["text", "Text"], ["sticky", "Sticky"], ["comment", "Comment"], ["more", "More"],
];

function Ico({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="es-ico" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[id]}
    </svg>
  );
}

/** Numbered note marker — always a child of the element it explains, so it stays anchored. */
function Pin({ n }: { n: number }) {
  return <span className="es-pin" aria-hidden="true">{n}</span>;
}

const STARTERS = [
  { title: "A pricing page with a yearly toggle", line: "Landing page · Studio site", thumb: "es-th-page" },
  { title: "Three onboarding screens for mobile", line: "Onboarding · welcome to sign-in", thumb: "es-th-phones" },
  { title: "A moodboard in calm, warm colours", line: "Moodboard · photos and swatches", thumb: "es-th-board" },
];

const VOICE = [
  { kill: "Get Started", keep: "Ask AI for a first draft", why: "a verb about their work" },
  { kill: "No data available.", keep: "No comments on Homepage yet.", why: "names what's missing" },
  { kill: "Oops! Nothing here!", keep: "Nothing called “pricng”.", why: "no exclamation marks" },
  { kill: "No artboards found in .design/ui — initialize a canvas.", keep: "Your canvas is ready. Ask AI for a first draft, or start drawing.", why: "no paths, no jargon" },
  { kill: "Unleash your creativity with AI-powered magic.", keep: "Done — three hero variants are on the canvas. Pick one.", why: "no hype" },
  { kill: "History store not initialized.", keep: "Versions appear here as you work.", why: "reassures instead of reporting" },
];

/** CONTRACT §3 — say these, not those. */
const WORDS_YES = ["canvas", "artboard", "frame", "project", "project tab", "panel", "toolbar", "AI chat panel", "AI", "Search", "Version history", "Hide panels", "Share", "Advanced", "Diagnostics"];
const WORDS_NO = ["board", "page", "screen", "repo", "workspace", "island", "sidebar", "dock", "Assistant", "the assistant", "command palette", "quick find", "commits", "fold", "tuck", "publish", "Pro", "Debug"];

/* ─── Hero — first-run Home ──────────────────────────────────────────────── */
function HomeFirstRun() {
  return (
    <div className="stage es-hero">
      <button type="button" className="island es-pill" aria-haspopup="menu" aria-expanded="false">
        <span aria-hidden="true"><Mark size={22} title="" /></span>
        <span>Home</span>
        <span className="es-vh">, Project menu</span>
        <span className="es-caret"><Ico id="chevron" size={14} /></span>
      </button>
      <div className="island es-tr">
        <button className="icon-btn" type="button" aria-label="Search">
          <Ico id="search" />
        </button>
        <span className="kbd" aria-hidden="true">⌘K</span>
      </div>

      <div className="es-home">
        <span className="es-land es-home-spark" style={{ ["--i" as string]: 0 }}>
          <Spark size={40} color="var(--spark)" />
        </span>
        <h3 className="es-home-title">
          What shall we make?
          <Pin n={1} />
        </h3>
        <p className="es-home-sub">Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there.</p>

        <div className="island island--pad es-home-ask">
          <Pin n={2} />
          <div className="ask es-ask-lg">
            <input aria-label="Ask AI" placeholder="A pricing page for Studio site, calm and light" />
            <span className="send" aria-hidden="true"><Spark size={14} color="var(--spark-fg)" /></span>
          </div>
          <div className="es-ask-foot">
            <span className="chip">Starts a new canvas in <strong>Studio site</strong> <Ico id="chevron" size={12} /></span>
            <span className="es-ask-hint"><span className="kbd">↵</span> to send</span>
          </div>
        </div>

        <div className="es-starters">
          <Pin n={3} />
          {STARTERS.map((s, i) => (
            <button key={s.title} type="button" className="es-starter es-land" style={{ ["--i" as string]: i + 1 }}>
              <span className={`es-thumb ${s.thumb}`} aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="es-starter-txt">
                <strong>{s.title}</strong>
                <span>{s.line}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="es-home-alt">
          <Pin n={4} />
          <button className="btn btn--ghost" type="button">Start with an empty canvas <span className="kbd">⌘N</span></button>
          <button className="btn btn--ghost" type="button">Open project… <span className="kbd">⌘O</span></button>
        </div>
      </div>
    </div>
  );
}

/* ─── The six empty surfaces ─────────────────────────────────────────────── */
function EmptyCanvas() {
  return (
    <div className="stage es-case-stage">
      <div className="es-oncanvas">
        <strong className="es-sit">Your canvas is ready.</strong>
        <span className="es-next">Ask AI for a first draft, or start drawing.</span>
        <div className="es-acts">
          <button className="btn btn--spark btn--sm" type="button"><Spark size={10} color="var(--spark-fg)" /> Ask AI</button>
        </div>
      </div>
      <div className="island dock es-mini-dock" role="toolbar" aria-label="Toolbar">
        {TOOLBAR.map(([id, name], i) => (
          <button key={id} className="icon-btn" type="button" aria-pressed={id === "more" ? undefined : i === 0} aria-label={name}><Ico id={id} /></button>
        ))}
      </div>
    </div>
  );
}

function EmptyAiPanel() {
  return (
    <div className="stage es-case-stage">
      <div className="island island--pad es-panel es-panel--right">
        <div className="es-panel-hd"><Spark size={14} color="var(--spark)" /> <span className="es-ai-name">AI</span></div>
        <div className="es-panel-empty">
          <strong className="es-sit es-sit--sm">Ask about Homepage.</strong>
          <span className="es-next">AI sees what you've selected, so “make this calmer” just works.</span>
          <div className="es-chips">
            <span className="chip">Tighten the hero copy</span>
            <span className="chip">Make a dark version</span>
          </div>
        </div>
        <div className="ask">
          <input aria-label="Ask AI about Homepage" placeholder="Ask AI…" />
          <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
        </div>
      </div>
    </div>
  );
}

function EmptySearch() {
  return (
    <div className="stage es-case-stage">
      <div className="island es-palette">
        <div className="es-palette-q">
          <Ico id="search" />
          <span className="es-q">pricng</span>
          <span className="kbd">esc</span>
        </div>
        <div className="es-panel-empty es-panel-empty--left">
          <strong className="es-sit es-sit--sm">Nothing called “pricng”.</strong>
          <span className="es-next">Try another word, or ask AI to find it.</span>
        </div>
        <div className="es-palette-list">
          <p className="island-title">Did you mean</p>
          <div className="row-item" aria-current="true"><span className="thumb es-tn-green" />Pricing <span className="es-row-meta">Studio site</span></div>
        </div>
        <div className="es-palette-ft"><button className="btn btn--spark btn--sm" type="button"><Spark size={10} color="var(--spark-fg)" /> Ask AI to find it</button></div>
      </div>
    </div>
  );
}

function EmptyComments() {
  return (
    <div className="stage es-case-stage">
      <div className="island island--pad es-panel es-panel--right">
        <div className="es-panel-hd es-panel-hd--split">
          <span>Comments</span>
          <button className="icon-btn" type="button" aria-label="Close comments"><Ico id="close" /></button>
        </div>
        <div className="es-panel-empty">
          <span className="es-glyph"><Ico id="comment" size={18} /></span>
          <strong className="es-sit es-sit--sm">No comments on Homepage yet.</strong>
          <span className="es-next">Press <span className="kbd">C</span>, then click anywhere on the canvas to leave one.</span>
          <button className="btn btn--ghost btn--sm" type="button"><Ico id="share" /> Share for feedback</button>
        </div>
      </div>
    </div>
  );
}

function EmptyHistory() {
  return (
    <div className="stage es-case-stage">
      <div className="island island--pad es-panel es-panel--right">
        <div className="es-panel-hd es-panel-hd--split">
          <span>Version history</span>
          <button className="icon-btn" type="button" aria-label="Close version history"><Ico id="close" /></button>
        </div>
        <div className="es-panel-empty">
          <span className="es-glyph"><Ico id="history" size={18} /></span>
          <strong className="es-sit es-sit--sm">Versions appear here as you work.</strong>
          <span className="es-next">Every change is kept on its own. There's nothing to save.</span>
        </div>
      </div>
    </div>
  );
}

function EmptyShared() {
  return (
    <div className="stage es-case-stage es-shared">
      <p className="es-shared-hd">Shared with you</p>
      <div className="es-shared-row">
        <span className="es-ghost-card" />
        <span className="es-ghost-card" />
        <span className="es-ghost-card" />
      </div>
      <div className="es-shared-msg">
        <strong className="es-sit es-sit--sm">Nothing shared with you yet.</strong>
        <span className="es-next">When Tereza or Jonas share a project, it shows up here.</span>
        <button className="btn btn--sm" type="button">Copy your invite link</button>
      </div>
    </div>
  );
}

const CASES = [
  { name: "Empty canvas", where: "a new canvas, before anything is on it", note: "AI is the next step, so the one action is spark; drawing is the toolbar.", el: <EmptyCanvas /> },
  { name: "AI chat panel", where: "the AI chat panel, first open", note: "Suggestions are written as things you'd say.", el: <EmptyAiPanel /> },
  { name: "No search results", where: "Search (⌘K), when nothing matches", note: "The CONTRACT line, word for word, then the closest match.", el: <EmptySearch /> },
  { name: "No comments yet", where: "the comments panel on a canvas", note: "Teach the shortcut in the sentence itself.", el: <EmptyComments /> },
  { name: "Version history", where: "a canvas that was just created", note: "Nothing to do — so no button. Just reassurance.", el: <EmptyHistory /> },
  { name: "Shared with you", where: "Home, before anyone has shared", note: "Use real names; ghost cards show the shape to come.", el: <EmptyShared /> },
];

export default function EmptyState() {
  const [run, setRun] = useState(0);

  return (
    <>
      <SpecimenHeader crumbs={["Brand & voice", "Empty states"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Empty is where the work starts.</h1>
          <p className="lede">
            Every empty surface names what belongs there and offers one next step. Home and the AI's moments get the
            rounded face and a little warmth; everywhere else stays quiet and short.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Home question</dt><dd>Rounded · --type-3xl · semibold · tracking 0</dd></div>
          <div><dt>Situation line</dt><dd>SF Pro Rounded · --type-lg</dd></div>
          <div><dt>Structure</dt><dd>what's missing · what to do · one action</dd></div>
          <div><dt>Spark</dt><dd>only when the AI is the next step</dd></div>
          <div><dt>Motion</dt><dd>one spring, on Home only</dd></div>
        </dl>

        {/* ── Hero: first-run Home ───────────────────────────────────────── */}
        <h2 data-no>First run — Home<span className="h2-aside">the first thing anyone sees after install</span></h2>
        <div className="es-hero-bar">
          <span>The spark and the starters land once, on <code>--dur-spring</code> · <code>--ease-spring</code>. With reduced motion they simply appear.</span>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setRun((r) => r + 1)}>Replay</button>
        </div>
        <HomeFirstRun key={run} />
        <ol className="es-legend">
          <li><span className="es-pin">1</span><span><strong>The situation, as a question.</strong> Rounded face, the largest line on the screen. No product name, no welcome speech.</span></li>
          <li><span className="es-pin">2</span><span><strong>The Ask-AI prompt is the main action</strong> — the only spark-coloured control. The placeholder is a real request, not “Type here…”.</span></li>
          <li><span className="es-pin">3</span><span><strong>Three starters</strong>, written as finished requests so one click sends them; the small line says what kind of canvas it makes. Thumbnails are canvas content, so they may carry object colour.</span></li>
          <li><span className="es-pin">4</span><span><strong>The quiet way out.</strong> An empty canvas (⌘N) or Open project… (⌘O), as ghost buttons. Nobody is forced through the AI.</span></li>
        </ol>

        {/* ── Variants ───────────────────────────────────────────────────── */}
        <h2 data-no>Every empty surface<span className="h2-aside">same three parts, sized to where they live</span></h2>
        <div className="es-cases">
          {CASES.map((c) => (
            <figure className="es-case" key={c.name}>
              {c.el}
              <figcaption>
                <strong>{c.name}</strong>
                <span className="es-where">{c.where}</span>
                <span>{c.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* ── Anatomy ────────────────────────────────────────────────────── */}
        <h2 data-no>Anatomy<span className="h2-aside">one empty state, taken apart</span></h2>
        <div className="es-anatomy">
          <div className="stage es-anatomy-stage">
            <div className="island island--pad es-panel es-anatomy-panel">
              <div className="es-panel-empty">
                <span className="es-glyph es-a-anchor"><Ico id="comment" size={18} /><Pin n={1} /></span>
                <strong className="es-sit es-sit--sm es-a-anchor">No comments on Homepage yet.<Pin n={2} /></strong>
                <span className="es-next es-a-anchor">Press <span className="kbd">C</span>, then click anywhere on the canvas to leave one.<Pin n={3} /></span>
                <span className="es-a-anchor es-a-btn"><button className="btn btn--ghost btn--sm" type="button"><Ico id="share" /> Share for feedback</button><Pin n={4} /></span>
              </div>
            </div>
          </div>
          <ol className="es-spec">
            <li>
              <span className="es-pin">1</span>
              <div><strong>Glyph</strong><span>Optional. One 18 px icon from the family, in <code>--fg-2</code>. The spark replaces it only when the AI is the next step.</span></div>
            </li>
            <li>
              <span className="es-pin">2</span>
              <div><strong>Situation</strong><span>Rounded, <code>--type-md</code> in panels and <code>--type-lg</code> on the canvas, <code>--fg-0</code>. Name the thing that's missing and where.</span></div>
            </li>
            <li>
              <span className="es-pin">3</span>
              <div><strong>Next step</strong><span>Body face, <code>--type-sm</code>, <code>--fg-1</code>, under 44 characters a line. Put the shortcut in the sentence.</span></div>
            </li>
            <li>
              <span className="es-pin">4</span>
              <div><strong>One action — or none</strong><span>A plain or ghost button. Spark when the AI does it. Never two competing buttons, never an action for its own sake.</span></div>
            </li>
          </ol>
        </div>

        {/* ── Voice ──────────────────────────────────────────────────────── */}
        <h2 data-no>Voice — keep or kill<span className="h2-aside">talk about their work, not the tool</span></h2>
        <div className="es-voice">
          <div className="es-voice-hd">
            <span className="es-kill-tag">Kill</span>
            <span className="es-keep-tag">Keep</span>
            <span>Why</span>
          </div>
          {VOICE.map((v) => (
            <div className="es-voice-row" key={v.keep}>
              <s className="es-kill">{v.kill}</s>
              <span className="es-keep">{v.keep}</span>
              <span className="es-why">{v.why}</span>
            </div>
          ))}
        </div>
        <div className="es-words">
          <div className="es-words-col">
            <p className="es-words-hd">Say</p>
            <div className="es-words-list">{WORDS_YES.map((w) => <span className="chip" key={w}>{w}</span>)}</div>
          </div>
          <div className="es-words-col">
            <p className="es-words-hd">Not, in anything a person reads</p>
            <div className="es-words-list">{WORDS_NO.map((w) => <span className="chip es-chip-no" key={w}>{w}</span>)}</div>
          </div>
        </div>

        {/* ── Where play stops ───────────────────────────────────────────── */}
        <h2 data-no>Where play stops<span className="h2-aside">an empty state is not an error</span></h2>
        <div className="es-compare">
          <figure className="es-cmp">
            <div className="stage es-cmp-stage">
              <div className="island island--pad es-cmp-card">
                <span className="es-err-ico"><Ico id="warn" size={18} /></span>
                <div className="es-cmp-txt">
                  <strong>Couldn't save Homepage.</strong>
                  <span>Your changes are kept on this Mac and save again when you're back online.</span>
                </div>
                <button className="btn btn--sm" type="button">Try now</button>
              </div>
            </div>
            <figcaption><strong className="es-ok">Right</strong> Errors use the plain face, the status colour next to an icon and a word, and say what's safe. No spring, no spark.</figcaption>
          </figure>
          <figure className="es-cmp">
            <div className="stage es-cmp-stage">
              <div className="island island--pad es-cmp-card es-wrong">
                <span className="es-wrong-spark"><Spark size={22} color="var(--spark)" /></span>
                <div className="es-cmp-txt">
                  <strong>Oops! Something went wrong!</strong>
                  <span>Don't worry, our AI is on it.</span>
                </div>
                <button className="btn btn--spark btn--sm" type="button">Let's go</button>
              </div>
            </div>
            <figcaption><strong className="es-bad">Wrong</strong> Rounded and cheerful about a failure, the spark on something the AI didn't do, and no word on whether the work is safe.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · empty states &amp; voice</span>
        <span>Reference: universal/empty-state · Locked direction: ui/v2/maude-v2-moodboard.tsx → direction-mix</span>
      </footer>
    </>
  );
}
