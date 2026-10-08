/**
 * SPECIMEN — colors-accent · maude-v2
 *
 * Demonstrates the three colour ROLES of maude-v2 and where each may appear:
 *   --accent (azure)  → primary action, current selection, focus. Functional only.
 *   --spark  (vermilion) → the AI, and only the AI.
 *   --object-* → colour that lives ON the canvas (stickies, shapes), never in chrome.
 * Hero = a live slice of the app: frosted islands over the canvas, so the accent is
 * seen in context, not as a bare chip. Share is the ONLY solid azure surface; the
 * active toolbar tool is muted azure. Includes a "wrong" panel (accent-everywhere).
 *
 * Every displayed value is read from the live tokens (getComputedStyle on <html>), so
 * the numbers follow the theme switch and can never drift from colors_and_type.css.
 *
 * Hero-preview gate specimen (written in Batch A, drift-checked against the locked
 * moodboard before the Batch B/C fan-out; recomposed in the post-critic fix pass).
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./colors-accent.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Live token values ──────────────────────────────────────────────────── */

const WATCHED = [
  "--accent", "--accent-hover", "--accent-active", "--accent-muted", "--accent-tint", "--accent-text",
  "--spark", "--spark-hover", "--spark-muted", "--spark-text",
  "--object-yellow", "--object-green", "--object-lilac", "--object-coral", "--object-sky", "--object-grey",
];

/** "oklch(0.53 0.175 238 / 0.12)" → "0.53 0.175 238 / 12 %" — short enough for a swatch line. */
function short(raw: string) {
  const m = /oklch\(([^)]+)\)/.exec(raw);
  if (!m) return raw || "—";
  // Browsers serialise 0.53 as .53 — put the leading zero back so values read like the token file.
  const [body, alpha] = m[1].split("/").map((x) => x.trim().replace(/(^|\s)\.(\d)/g, (_m, pre: string, d: string) => `${pre}0.${d}`));
  if (!alpha) return body;
  const a = Number.parseFloat(alpha);
  return `${body} / ${Number.isFinite(a) ? Math.round(a * 100) : alpha} %`;
}

function useTokenValues() {
  const read = () => {
    const out: Record<string, string> = {};
    if (typeof document === "undefined") return out;
    const cs = getComputedStyle(document.documentElement);
    for (const t of WATCHED) out[t] = short(cs.getPropertyValue(t).trim());
    return out;
  };
  const [vals, setVals] = useState<Record<string, string>>(read);
  useEffect(() => {
    setVals(read());
    const obs = new MutationObserver(() => setVals(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);
  return vals;
}

/* ─── The Edit toolbar (CONTRACT §2 order) — glyphs verbatim from iconography.tsx ─────────── */

const TOOLS: { name: string; key: string; d: ReactNode }[] = [
  { name: "Select", key: "V", d: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" /> },
  { name: "Hand", key: "H", d: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" /> },
  { name: "Frame", key: "F", d: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" /> },
  { name: "Shape", key: "R", d: <><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></> },
  { name: "Pen", key: "P", d: <><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></> },
  { name: "Text", key: "T", d: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" /> },
  { name: "Image", key: "I", d: <><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></> },
  { name: "Component", key: "⇧I", d: <><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></> },
];

function ToolIcon({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

function Toolbar({ className }: { className: string }) {
  return (
    <div className={`island dock ${className}`} role="toolbar" aria-label="Toolbar">
      {TOOLS.map((t, i) => (
        <button key={t.name} className="icon-btn" type="button" aria-pressed={i === 0} aria-label={t.name} aria-keyshortcuts={t.key.replace("⇧", "Shift+")}>
          <ToolIcon d={t.d} />
        </button>
      ))}
      <span className="divider-v" />
      <button className="icon-btn" type="button" aria-label="More tools: Line, Ellipse, Polygon, Crop, Export area">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12" cy="8" r="1.2" /></svg>
      </button>
    </div>
  );
}

/** The user's own design — a calm landscape drawn in canvas object colours (lifted from the showcase). */
function Landscape({ className = "" }: { className?: string }) {
  return (
    <span className={`ca-land ${className}`} aria-hidden="true">
      <span className="ca-land-sun" />
      <span className="ca-land-hill" />
    </span>
  );
}

/* ─── Ladders ────────────────────────────────────────────────────────────── */

const ACCENT: { name: string; note: string; cls: string; demo: () => ReactNode }[] = [
  { name: "--accent", note: "Share at rest · selection · focus ring", cls: "acc", demo: () => <span className="ca-fill-word">Rest</span> },
  { name: "--accent-hover", note: "the pointer is on Share", cls: "acc-h", demo: () => <span className="ca-fill-word">Hover</span> },
  { name: "--accent-active", note: "Share while pressed", cls: "acc-a", demo: () => <span className="ca-fill-word">Pressed</span> },
  {
    name: "--accent-muted",
    note: "selected row · active tool · chip — text on it is --accent-text",
    cls: "acc-m",
    demo: () => <span className="ca-fill-row">Selected</span>,
  },
  {
    name: "--accent-tint",
    note: "selected text · the halo round a focused field",
    cls: "acc-t",
    demo: () => <span className="ca-fill-sel">Selected text</span>,
  },
];

const SPARK = [
  { name: "--spark", note: "Ask AI send · the AI's cursor · its label", cls: "spk" },
  { name: "--spark-hover", note: "the pointer is on an AI action", cls: "spk-h" },
  { name: "--spark-muted", note: "behind “Made by AI” — the words are --spark-text", cls: "spk-m" },
];

const OBJECTS = ["yellow", "green", "lilac", "coral", "sky", "grey"];

export default function ColorsAccent() {
  const v = useTokenValues();
  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Accent & roles"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Azure acts. The spark is the AI. Colour lives on the canvas.</h1>
          <p className="lede">
            Three roles, never mixed. Azure marks what you can do and what you picked. The spark shows
            up only when AI is speaking or working. Everything colourful — stickies, shapes — sits on the
            canvas, so the chrome stays quiet.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Accent</dt><dd className="ca-val">oklch {v["--accent"]}</dd></div>
          <div><dt>Spark</dt><dd className="ca-val">oklch {v["--spark"]}</dd></div>
          <div><dt>Strategy</dt><dd>single accent + reserved AI role</dd></div>
          <div><dt>Themes</dt><dd>light (default) · dark — values follow the switch</dd></div>
        </dl>

        {/* ── Hero: the roles in context ─────────────────────────────────── */}
        <h2 data-no>In context<span className="h2-aside">a slice of the app — panels over the canvas</span></h2>
        <div className="stage ca-hero">
          <div className="ca-artboard">
            <Landscape className="ca-artboard-img" />
            <div className="ca-artboard-body">
              <strong>We design calm software.</strong>
              <span>A small studio in Brno.</span>
            </div>
            <span className="ca-draft" aria-hidden="true"><i /><i /><i /></span>
            <span className="ca-sel" aria-hidden="true" />
            <span className="ca-sel-label">Homepage · 1440 × 900</span>
          </div>

          <div className="ca-cursor" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke="var(--bg-2)" strokeWidth="1" /></svg>
            <span><Spark size={10} color="var(--spark-fg)" /> AI is drawing the footer</span>
          </div>

          <div className="sticky sticky--lilac ca-st1">Mobile first</div>
          <div className="sticky sticky--yellow ca-st2">Bigger photo in the hero?</div>
          <div className="sticky sticky--green ca-st3">Move the CTA up</div>

          <div className="island ca-pill">
            <Mark size={22} />
            <span>Studio site</span>
            <svg className="ca-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 6.5l3 3 3-3" /></svg>
          </div>

          <div className="island island--pad ca-list">
            <p className="island-title">Canvases</p>
            <div className="row-item" aria-current="true"><span className="thumb ca-th-sky" />Homepage</div>
            <div className="row-item"><span className="thumb ca-th-yellow" />Onboarding</div>
            <div className="row-item"><span className="thumb ca-th-green" />Pricing</div>
            <div className="row-item"><span className="thumb ca-th-lilac" />Mobile — detail</div>
          </div>

          <div className="island ca-tr">
            <button className="icon-btn" type="button" aria-label="Hide panels" aria-keyshortcuts="Meta+Backslash">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
            </button>
            <button className="btn btn--primary" type="button">Share</button>
          </div>

          <div className="island island--pad ca-ai">
            <div className="ca-ai-hd"><Spark size={14} color="var(--spark)" /> AI</div>
            <p className="ca-ai-msg">Done — three hero variants are on the canvas. Pick one.</p>
            <div className="ask">
              <span className="chip chip--accent">Hero</span>
              <input aria-label="Ask AI" placeholder="Ask AI…" />
              <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
            </div>
          </div>

          <Toolbar className="ca-dock" />
        </div>
        <ul className="ca-legend">
          <li><i className="ca-key ca-key--acc" />Azure: Share, the selected artboard, the current canvas.</li>
          <li><i className="ca-key ca-key--accm" />Muted azure: the tool you're holding — never a second solid button.</li>
          <li><i className="ca-key ca-key--spk" />The spark: AI's cursor, its panel and its send button.</li>
          <li><i className="ca-key ca-key--obj" />Object colours: the design and the stickies. Nothing else.</li>
        </ul>

        {/* ── Ladders ────────────────────────────────────────────────────── */}
        <h2 data-no>Accent ladder<span className="h2-aside">azure · hue 238 · functional only</span></h2>
        <div className="ca-row5">
          {ACCENT.map((s) => (
            <div className="swatch" key={s.name}>
              <div className={`fill ca-fill ca-${s.cls}`}>{s.demo()}</div>
              <div className="meta">
                <strong>{s.name}</strong>
                <span className="ca-oklch">{v[s.name]}</span>
                <span className="ca-note">{s.note}</span>
              </div>
            </div>
          ))}
        </div>

        <h2 data-no>Spark<span className="h2-aside">vermilion · hue 36 · the AI only</span></h2>
        <div className="ca-row5">
          {SPARK.map((s) => (
            <div className="swatch" key={s.name}>
              <div className={`fill ca-fill ca-${s.cls}`}>
                {s.cls === "spk" ? <Spark size={44} color="var(--spark-fg)" /> : null}
                {s.cls === "spk-h" ? <span className="ca-fill-word ca-fill-word--ink">Hover</span> : null}
                {s.cls === "spk-m" ? <span className="ca-fill-made"><Spark size={10} color="currentColor" /> Made by AI</span> : null}
              </div>
              <div className="meta">
                <strong>{s.name}</strong>
                <span className="ca-oklch">{v[s.name]}</span>
                <span className="ca-note">{s.note}</span>
              </div>
            </div>
          ))}
          <div className="ca-uses">
            <p className="ca-uses-hd">Where it appears</p>
            <div className="ca-use">
              <button className="btn btn--spark btn--sm" type="button"><Spark size={10} color="var(--spark-fg)" /> Ask AI</button>
              <span>The one action that hands work to AI.</span>
            </div>
            <div className="ca-use">
              <span className="ca-agent-tag"><Spark size={9} color="var(--spark-fg)" /> AI</span>
              <span>AI's cursor label, wherever it is working.</span>
            </div>
            <div className="ca-use">
              <span className="ca-agent"><span className="ca-agent-dot" />AI is editing Pricing</span>
              <span>A dot plus words — never colour alone.</span>
            </div>
          </div>
        </div>

        <h2 data-no>Canvas objects<span className="h2-aside">colour lives on the canvas, not in chrome</span></h2>
        <div className="ca-objects">
          {OBJECTS.map((o, i) => (
            <div key={o} className={`ca-obj ca-ob-${o}`} style={{ rotate: `${[-2.5, 1.8, -1.2, 2.6, -1.9, 1.1][i]}deg` }}>
              <strong>{o}</strong>
              <span className="ca-obj-meta">
                <code>--object-{o}</code>
                <span className="ca-obj-val">{v[`--object-${o}`]}</span>
              </span>
            </div>
          ))}
        </div>

        {/* ── Good / wrong ───────────────────────────────────────────────── */}
        <h2 data-no>One job per surface</h2>
        <div className="ca-compare">
          <figure className="ca-case">
            <div className="stage ca-mini">
              <div className="island island--pad ca-mini-list">
                <div className="row-item" aria-current="true"><span className="thumb ca-th-sky" />Homepage</div>
                <div className="row-item"><span className="thumb ca-th-yellow" />Onboarding</div>
                <div className="row-item"><span className="thumb ca-th-green" />Pricing</div>
              </div>
              <div className="ca-mini-ab"><Landscape /></div>
              <div className="island ca-mini-tr"><button className="btn btn--primary btn--sm" type="button">Share</button></div>
            </div>
            <figcaption><strong className="ca-ok">Right</strong> Azure marks the one selected canvas and the one primary action. The design carries the colour.</figcaption>
          </figure>
          <figure className="ca-case">
            <div className="stage ca-mini ca-wrong">
              <div className="island island--pad ca-mini-list">
                <div className="row-item ca-w-row"><span className="thumb" />Homepage</div>
                <div className="row-item ca-w-row"><span className="thumb" />Onboarding</div>
                <div className="row-item ca-w-row2"><span className="thumb" />Pricing</div>
              </div>
              <div className="ca-mini-ab"><Landscape /></div>
              <div className="island ca-mini-tr ca-w-island"><button className="btn btn--spark btn--sm" type="button">Share</button></div>
            </div>
            <figcaption><strong className="ca-bad">Wrong</strong> Azure on every row, the spark on Share, sticky colours in the chrome. Nothing leads, and the spark stops meaning AI.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · colour roles</span>
        <span>Locked direction: ui/v2/maude-v2-moodboard.tsx → direction-mix</span>
      </footer>
    </>
  );
}
