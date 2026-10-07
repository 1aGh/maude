/**
 * SPECIMEN — components-status · maude-v2
 *
 * DEMONSTRATES: ambient status — a sync dot on the project pill (--status-success /
 *               --presence-offline / --status-warn), the saving word beside the artboard name
 *               (--fg-2), the AI working (--presence-agent spark on the agent cursor and the folded
 *               AI chat panel), and connection lost as ONE human sentence on a small panel. Plus the
 *               pointer to where the full detail lives: Menu › Diagnostics — a SUBMENU of the one
 *               menu (CONTRACT §1), never a window of its own. Report a bug lives in Menu › Help.
 * COMPOSITION:  hero = a state scrubber over a slice of the app: pick Synced / Saving / AI working /
 *               Offline / Connection lost and watch only the small things change · the signal
 *               vocabulary (what each looks like, where it sits, what hover says) · shown vs
 *               operated (the old docked status bar as the wrong turn) · the escalation ladder
 *               (shown → said → asked) · the one menu with its Diagnostics submenu open.
 * COPY VOICE:   states are told in a few words about the work ("Synced with Tereza · just now",
 *               "Your changes are safe on this Mac"). Never a code, a port or a stamp.
 * WHEN SCAFFOLDED: status family (always for maude-v2).
 * NOTES:        State is shown, not operated. There is no button to "make it sync"; when Maude
 *               needs you, it says one sentence. Everything a power user wants — ports, folders,
 *               logs — is one menu away in Diagnostics, never in the default view.
 */
import { useState } from "react";
import "./_layout.css";
import "./components-status.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type State = "synced" | "saving" | "ai" | "offline" | "lost";

const STATES: { id: State; label: string; hover: string }[] = [
  { id: "synced", label: "Synced", hover: "Synced with Tereza · just now" },
  { id: "saving", label: "Saving", hover: "Saving your changes…" },
  { id: "ai", label: "AI working", hover: "Synced · AI is editing Pricing" },
  { id: "offline", label: "Offline", hover: "Offline — changes are kept on this Mac" },
  { id: "lost", label: "Connection lost", hover: "Trying to reconnect…" },
];

function Dot({ state }: { state: State }) {
  const cls = state === "offline" ? "off" : state === "lost" ? "warn" : state === "saving" ? "saving" : "ok";
  return <span className={`ss-dot ss-dot--${cls}`} aria-hidden="true" />;
}

/** The pill's mark is decoration next to the project name — hidden from the accessibility tree. */
function PillMark({ size }: { size: number }) {
  return <span className="ss-mark" aria-hidden="true"><Mark size={size} title="" /></span>;
}

const SIGNALS = [
  { key: "sync", name: "Sync dot", demo: <span className="ss-sig-pill"><PillMark size={18} />Studio site<span className="ss-dot ss-dot--ok" aria-hidden="true" /><span className="ss-vh">, synced</span></span>, means: "Your project is saved and shared.", lives: "On the project pill", hover: "Synced with Tereza · just now" },
  { key: "save", name: "Saving", demo: <span className="ss-sig-label">Pricing <span className="ss-saving">Saving…</span></span>, means: "Your last change is being kept.", lives: "Beside the artboard name, then fades", hover: "—" },
  { key: "ai", name: "AI working", demo: <span className="ss-sig-ai"><span className="ss-spark-live"><Spark size={14} color="var(--spark)" /></span>Editing Pricing</span>, means: "AI is changing something.", lives: "On its cursor, and on the hidden AI chat panel", hover: "AI is editing Pricing" },
  { key: "off", name: "Offline", demo: <span className="ss-sig-pill"><PillMark size={18} />Studio site<span className="ss-dot ss-dot--off" aria-hidden="true" /><span className="ss-vh">, offline</span></span>, means: "Nothing to fix. It syncs when you're back.", lives: "Same dot, hollow and grey", hover: "Offline — changes are kept on this Mac" },
  { key: "lost", name: "Connection lost", demo: <span className="ss-sig-sentence"><span className="ss-dot ss-dot--warn" aria-hidden="true" />Connection lost. Trying again…</span>, means: "Trying again on its own. Your work is safe.", lives: "One sentence under the pill", hover: "—" },
];

/** The one menu's top level — CONTRACT §1, in order (static picture, no menu roles). */
const TOP = ["Back to Home", "|", "File ›", "Edit ›", "View ›", "Help ›", "|", "Version history|⌥⌘H", "Share…", "Export…|⇧⌘E", "|", "Diagnostics ›", "Settings…|⌘,"];
/** Menu › Diagnostics — status words, then actions, then Advanced (closed). */
const DIAG: { label: string; word?: string; keys?: string }[] = [
  { label: "Sync", word: "Up to date" }, { label: "Server", word: "Running" }, { label: "AI setup", word: "Ready" },
  { label: "|" }, { label: "Logs" }, { label: "Reload canvas", keys: "⌘R" }, { label: "Check AI setup again" },
  { label: "|" }, { label: "Advanced ›" },
];

/** Toolbar glyphs, left → right (CONTRACT §2) — copied verbatim from iconography.tsx GLYPHS. */
const TOOLBAR = [
  { name: "Select", d: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" /> },
  { name: "Hand", d: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" /> },
  { name: "Frame", d: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" /> },
  { name: "Shape", d: <><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></> },
  { name: "Pen", d: <><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></> },
  { name: "Text", d: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" /> },
  { name: "Sticky", d: <><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></> },
  { name: "Comment", d: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" /> },
  { name: "More", d: <g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g> },
];

export default function ComponentsStatus() {
  const [state, setState] = useState<State>("synced");
  const cur = STATES.find((s) => s.id === state) ?? STATES[0];

  return (
    <>
      <SpecimenHeader crumbs={["Components", "Status"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>State is shown, not operated.</h1>
          <p className="lede">
            Status lives in small places: a dot on the project pill, a word that fades after saving,
            the spark while the AI works. There's nothing to press to make it go. When Maude needs
            you, it says so in one sentence. The full detail is one menu away, in Diagnostics.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Synced</dt><dd>--status-success dot</dd></div>
          <div><dt>Offline</dt><dd>--presence-offline, hollow</dd></div>
          <div><dt>Trouble</dt><dd>--status-warn + a sentence</dd></div>
          <div><dt>AI</dt><dd>--presence-agent (the spark)</dd></div>
        </dl>

        {/* ── Hero: the scrubber ─────────────────────────────────────────── */}
        <h2 data-no>Only the small things change<span className="h2-aside">pick a state</span></h2>
        <div className="ss-scrub">
          <span className="seg" role="group" aria-label="Project state">
            {STATES.map((s) => (
              <button key={s.id} type="button" aria-pressed={state === s.id} onClick={() => setState(s.id)}>{s.label}</button>
            ))}
          </span>
          <span className="ss-scrub-hover">The tooltip shows what hovering the dot says.</span>
        </div>
        <div className={`stage ss-hero ss-hero--${state}`}>
          <div className="ss-ab-label">
            Pricing
            {state === "saving" && <span className="ss-saving" role="status">Saving…</span>}
          </div>
          <div className="ss-board">
            <div className="ss-plans">
              <div className="ss-plan"><b>Free</b><span>For trying it out</span></div>
              <div className={`ss-plan${state === "ai" ? " ss-plan--ai" : ""}`}><b>Pro</b><span>For working designers</span></div>
              <div className="ss-plan"><b>Team</b><span>For studios</span></div>
            </div>
          </div>
          {state === "ai" && (
            <div className="ss-agent" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke="var(--bg-2)" strokeWidth="1" /></svg>
              <span><Spark size={10} color="var(--spark-fg)" /> AI is editing Pro</span>
            </div>
          )}
          <div className="sticky sticky--yellow ss-st">Annual toggle first?</div>

          <button type="button" className="island ss-pill" aria-haspopup="menu" aria-expanded="false" aria-describedby={state !== "lost" ? "ss-hovertip" : undefined}>
            <PillMark size={22} />
            <span>Studio site</span>
            <Dot state={state} />
            <span className="ss-vh">, {cur.label}, Project menu</span>
            <span className="ss-caret" aria-hidden="true">⌄</span>
          </button>
          {state === "lost" && (
            <div className="island ss-lost" role="status">
              <span className="ss-dot ss-dot--warn" aria-hidden="true" />
              <span><b>Connection lost.</b> Your changes are safe on this Mac — trying again…</span>
            </div>
          )}
          {state !== "lost" && <div className="ss-hovertip" role="tooltip" id="ss-hovertip"><span className="ss-hovertip-arrow" aria-hidden="true" />{cur.hover}</div>}

          <div className="island ss-tr">
            <button className="icon-btn" type="button" aria-label="Show panels">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></svg>
            </button>
            <button className="btn btn--primary" type="button">Share</button>
          </div>

          <div className="island ss-ai-fold">
            <button className="icon-btn" type="button" aria-label={state === "ai" ? "Open the AI chat panel — AI is working" : "Open the AI chat panel"}>
              <span className={state === "ai" ? "ss-spark-live" : ""}><Spark size={16} color="var(--spark)" /></span>
            </button>
            {state === "ai" && <span className="ss-ai-badge" aria-hidden="true" />}
          </div>

          <div className="island dock ss-dock" role="toolbar" aria-label="Toolbar">
            {TOOLBAR.map((t, i) => (
              <button key={t.name} className="icon-btn" type="button" aria-pressed={t.name === "More" ? undefined : i === 0} aria-label={t.name}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.d}</svg>
              </button>
            ))}
          </div>
        </div>
        <p className="ss-hero-cap">
          Five states, and the canvas never moves. The dot, a word, a spark — and only when something
          is actually wrong, one sentence. No banner pushes your work down.
        </p>

        {/* ── Vocabulary ─────────────────────────────────────────────────── */}
        <h2 data-no>The signals<span className="h2-aside">what each looks like, where it sits, what hover adds</span></h2>
        <div className="ss-sigs">
          {SIGNALS.map((s) => (
            <div className="ss-sig" key={s.key}>
              <div className="ss-sig-demo">{s.demo}</div>
              <strong>{s.name}</strong>
              <span>{s.means}</span>
              <dl>
                <div><dt>Lives</dt><dd>{s.lives}</dd></div>
                <div><dt>Hover</dt><dd>{s.hover}</dd></div>
              </dl>
            </div>
          ))}
        </div>

        {/* ── Shown vs operated ──────────────────────────────────────────── */}
        <h2 data-no>Shown, not operated<span className="h2-aside">the same facts, before and after</span></h2>
        <div className="ss-compare">
          <figure className="ss-case">
            <div className="stage ss-mini">
              <div className="ss-mini-board" />
              <div className="island ss-mini-pill"><PillMark size={20} /><span>Studio site</span><span className="ss-dot ss-dot--ok" aria-hidden="true" /><span className="ss-vh">, synced</span></div>
            </div>
            <figcaption><strong className="ss-ok">Right</strong> One dot on the pill. Hover tells you who it's synced with. The canvas keeps the whole window.</figcaption>
          </figure>
          <figure className="ss-case">
            <div className="stage ss-mini">
              <div className="ss-mini-board" />
              <div className="ss-oldbar" aria-hidden="true">
                <span className="ss-stamp">IDLE</span>
                <span className="ss-stamp">CANVAS</span>
                <span className="ss-chip-old">● live</span>
                <span className="ss-chip-old">⟳ hub sync</span>
                <span className="ss-chip-old">:4402</span>
                <span className="ss-chip-old">main</span>
                <span className="ss-chip-old">12 artboards</span>
              </div>
            </div>
            <figcaption><strong className="ss-bad">Wrong</strong> A docked bar of stamps and buttons. Seven things to read, two to click, none about your design.</figcaption>
          </figure>
        </div>

        {/* ── Escalation ────────────────────────────────────────────────── */}
        <h2 data-no>Shown → said → asked<span className="h2-aside">louder only when it has to be</span></h2>
        <div className="ss-ladder">
          <div className="ss-rung">
            <span className="ss-rung-n">1</span>
            <div className="ss-rung-demo"><span className="ss-sig-pill"><PillMark size={18} />Studio site<span className="ss-dot ss-dot--off" aria-hidden="true" /><span className="ss-vh">, offline</span></span></div>
            <strong>Shown</strong>
            <span>A dot or a word. You notice it if you look. Offline, saving, synced.</span>
          </div>
          <div className="ss-rung">
            <span className="ss-rung-n">2</span>
            <div className="ss-rung-demo"><span className="ss-sig-sentence"><span className="ss-dot ss-dot--warn" aria-hidden="true" />Connection lost. Trying again…</span></div>
            <strong>Said</strong>
            <span>One sentence when it lasts more than a few seconds. Still nothing to press.</span>
          </div>
          <div className="ss-rung">
            <span className="ss-rung-n">3</span>
            <div className="ss-rung-demo"><span className="ss-sig-ask"><b>Your copy and Tereza's both changed.</b><span className="btn btn--sm btn--primary">Compare</span></span></div>
            <strong>Asked</strong>
            <span>Only when the choice is yours to make. One question, one button.</span>
          </div>
        </div>

        {/* ── Diagnostics pointer ───────────────────────────────────────── */}
        <h2 data-no>Where the full detail lives<span className="h2-aside">Menu › Diagnostics</span></h2>
        <div className="ss-diag">
          <div
            className="stage ss-diag-stage"
            role="img"
            aria-label="The one menu open on the project pill, with its Diagnostics submenu: Sync, Up to date; Server, Running; AI setup, Ready; Logs; Reload canvas; Check AI setup again; Advanced."
          >
            <div className="island ss-diag-pill"><PillMark size={22} /><span>Studio site</span><span className="ss-dot ss-dot--ok" /><span className="ss-caret">⌄</span></div>
            <div className="ss-menus">
              <div className="ss-menu">
                {TOP.map((t, i) => {
                  if (t === "|") return <div className="ss-menu-sep" key={i} />;
                  const [label, keys] = t.split("|");
                  const sub = label.endsWith(" ›");
                  return (
                    <div className={`row-item${label === "Diagnostics ›" ? " ss-menu-diag" : ""}`} aria-current={label === "Diagnostics ›" ? "true" : undefined} key={i}>
                      {sub ? label.slice(0, -2) : label}
                      {keys ? <span className="ss-menu-k">{keys}</span> : null}
                      {sub ? <span className="ss-menu-k">›</span> : null}
                    </div>
                  );
                })}
              </div>
              <div className="ss-menu ss-menu--sub">
                {DIAG.map((d, i) =>
                  d.label === "|" ? (
                    <div className="ss-menu-sep" key={i} />
                  ) : (
                    <div className="row-item" key={i}>
                      {d.label}
                      {d.word ? <span className="ss-menu-k ss-menu-word"><span className="ss-dot ss-dot--ok" />{d.word}</span> : null}
                      {d.keys ? <span className="ss-menu-k">{d.keys}</span> : null}
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
          <div className="ss-diag-side">
            <p>Diagnostics is a submenu of the one menu — Menu › Diagnostics, or type its name into Search with ⌘K. It is never part of the default view, and nothing on the canvas links to it except the menu.</p>
            <p>Status comes first, in words. Ports, the project folder and the process sit one more step down, under Advanced. Report a bug lives in Menu › Help.</p>
            <p>The old status bar's facts all moved here. None were removed — they just stopped standing between you and your work.</p>
          </div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · status</span>
        <span>Shown, then said, then asked</span>
      </footer>
    </>
  );
}
