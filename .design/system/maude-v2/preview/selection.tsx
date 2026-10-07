/**
 * SPECIMEN — selection · maude-v2
 *
 * DEMONSTRATES: the artboard selection ring + size label + handles (--accent,
 *               --accent-fg) · hover outline · multi-select and the group box ·
 *               the marquee (--accent-muted + 1 px --accent) · text selection
 *               (--accent-tint) · the selected layer row (.row-item[aria-current]) ·
 *               your selection vs the AI's (azure vs spark).
 * COMPOSITION:  hero = a working piece of canvas: click, Shift-click and click-away
 *               select real objects, and the Layers island follows — one selection,
 *               shown in two places · anatomy strip (hover › selected › marquee ›
 *               group) · text selection on an artboard and in an AI reply · layer-row
 *               states · "yours, not the AI's" pair.
 * NOTES:        Azure is the one colour of "what you picked". The AI never wears it:
 *               anything the AI is working on gets a dashed spark outline instead.
 *               Focus (where your keys go) is a separate state — see focus.tsx.
 */
import { useState } from "react";
import type { MouseEvent } from "react";
import "./_layout.css";
import "./selection.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

type Obj = { id: string; kind: "artboard" | "sticky"; name: string; x: number; y: number; w: number; h: number; tone: string; size?: string };

const OBJECTS: Obj[] = [
  { id: "home", kind: "artboard", name: "Homepage", x: 24, y: 56, w: 208, h: 236, tone: "coral", size: "1440 × 900" },
  { id: "pricing", kind: "artboard", name: "Pricing", x: 264, y: 56, w: 208, h: 236, tone: "sky", size: "1440 × 1200" },
  { id: "cta", kind: "sticky", name: "Move the CTA up", x: 508, y: 64, w: 120, h: 104, tone: "yellow" },
  { id: "mobile", kind: "sticky", name: "Mobile first", x: 528, y: 196, w: 120, h: 104, tone: "green" },
];

function Handles() {
  return (
    <>
      <span className="se-h se-h--tl" />
      <span className="se-h se-h--tr" />
      <span className="se-h se-h--bl" />
      <span className="se-h se-h--br" />
    </>
  );
}

function ArtboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2 5h12M2 11h12M5 2v12M11 2v12" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
      <path d="M3 13L13 3" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

/* ─── Hero: one selection, two places ────────────────────────────────────── */

function LiveSelection() {
  const [sel, setSel] = useState<Set<string>>(() => new Set(["home"]));

  const pick = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setSel((prev) => {
      if (e.shiftKey || e.metaKey) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  };

  const picked = OBJECTS.filter((o) => sel.has(o.id));
  const single = picked.length === 1 ? picked[0] : null;
  const group =
    picked.length > 1
      ? {
          x: Math.min(...picked.map((o) => o.x)) - 6,
          y: Math.min(...picked.map((o) => o.y)) - 6,
          r: Math.max(...picked.map((o) => o.x + o.w)) + 6,
          b: Math.max(...picked.map((o) => o.y + o.h)) + 6,
        }
      : null;

  return (
    <div className="stage se-hero">
      <div className="se-world" onClick={() => setSel(new Set())} role="presentation">
        {OBJECTS.map((o) => {
          const on = sel.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`se-obj se-obj--${o.kind} se-tone-${o.tone}`}
              data-selected={on ? (single ? "single" : "multi") : undefined}
              aria-pressed={on}
              aria-label={`${o.name}, ${o.kind}`}
              style={{ left: o.x, top: o.y, width: o.w, height: o.h }}
              onClick={(e) => pick(o.id, e)}
            >
              {o.kind === "artboard" ? (
                <>
                  <span className="se-ab-img" />
                  <span className="se-ab-name">{o.name}</span>
                  <span className="se-ab-line" />
                  <span className="se-ab-line se-ab-line--short" />
                </>
              ) : (
                <span className="se-st-text">{o.name}</span>
              )}
              {single?.id === o.id ? (
                <>
                  <Handles />
                  <span className="se-label">{o.kind === "artboard" ? `${o.name} · ${o.size}` : "Sticky"}</span>
                </>
              ) : null}
            </button>
          );
        })}
        {group ? (
          <div className="se-group" style={{ left: group.x, top: group.y, width: group.r - group.x, height: group.b - group.y }} aria-hidden="true">
            <Handles />
            <span className="se-label">{picked.length} selected</span>
          </div>
        ) : null}
      </div>

      <div className="island island--pad se-layers">
        <p className="island-title">Layers</p>
        {OBJECTS.map((o) => (
          <button
            key={o.id}
            type="button"
            className="row-item se-row"
            aria-current={sel.has(o.id) ? "true" : undefined}
            onClick={(e) => pick(o.id, e)}
          >
            {o.kind === "artboard" ? <span className="se-row-icon"><ArtboardIcon /></span> : <span className={`thumb se-row-sticky se-tone-${o.tone}`} />}
            {o.name}
          </button>
        ))}
      </div>

      <div className="island se-hint" role="status">
        {picked.length === 0
          ? "Nothing selected. Click an artboard or a sticky."
          : picked.length === 1
            ? <>Shift-click to add more. Click the canvas to clear.</>
            : <>{picked.length} selected — move, align or ask AI about them together.</>}
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function Selection() {
  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Selection"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>What you picked is azure — on the canvas and in Layers.</h1>
          <p className="lede">
            A selection is one thing shown in two places: a ring on the canvas and a highlighted row
            in the Layers island. Pick on either side and the other follows. Text you select gets the
            same azure, lighter, so you can still read it.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Ring</dt><dd>2 px --accent + size label</dd></div>
          <div><dt>Row</dt><dd>--accent-muted · semibold</dd></div>
          <div><dt>Text</dt><dd>--accent-tint</dd></div>
          <div><dt>The AI's work</dt><dd>dashed --spark, never azure</dd></div>
        </dl>

        <h2 data-no>One selection, two places<span className="h2-aside">click, Shift-click, click away</span></h2>
        <LiveSelection />

        <h2 data-no>Anatomy<span className="h2-aside">from a hover to a group</span></h2>
        <div className="se-anat">
          {[
            { k: "hover", t: "Hover", d: "1 px --accent. Says “this is what a click would pick”." },
            { k: "single", t: "Selected", d: "2 px ring, four handles, the name and size above." },
            { k: "marquee", t: "Dragging a marquee", d: "--accent-muted fill with a 1 px --accent edge." },
            { k: "group", t: "Several picked", d: "Each keeps a thin ring; one box with handles holds them." },
          ].map((a) => (
            <figure className="se-anat-cell" key={a.k}>
              <div className={`se-anat-stage se-anat--${a.k}`}>
                <span className="se-mini se-mini--a" />
                <span className="se-mini se-mini--b" />
                {a.k === "single" ? <span className="se-mini-label">Hero · 1440 × 900</span> : null}
                {a.k === "single" || a.k === "group" ? <span className="se-mini-box"><Handles /></span> : null}
                {a.k === "group" ? <span className="se-mini-label">2 selected</span> : null}
                {a.k === "marquee" ? <span className="se-marquee" /> : null}
              </div>
              <figcaption><strong>{a.t}</strong>{a.d}</figcaption>
            </figure>
          ))}
        </div>

        <h2 data-no>Text<span className="h2-aside">--accent-tint, so the words stay readable</span></h2>
        <div className="se-text">
          <div className="se-text-board">
            <span className="se-text-cap">Homepage · Headline</span>
            <p className="se-text-h">Design the page <mark className="se-mark">you had in mind</mark><span className="se-caret" aria-hidden="true" /></p>
            <p className="se-text-p">Sketch it, ask for three versions, keep the one that fits.</p>
          </div>
          <div className="island island--pad se-text-ai">
            <span className="se-ai-hd"><Spark size={12} color="var(--spark)" /> AI</span>
            <p className="se-ai-msg">
              Done — the headline is tighter and the CTA moved up. <mark className="se-mark">The old version is in Version history</mark> if
              you want it back.
            </p>
          </div>
          <p className="se-text-note">
            Select any text on this page — it uses the same tint. Inside a text layer the caret is azure too;
            outside of text, azure always means a picked object.
          </p>
        </div>

        <h2 data-no>Layer rows<span className="h2-aside">every state in one island</span></h2>
        <div className="se-rows-wrap">
          <div className="island island--pad se-rows">
            <p className="island-title">Layers · Pricing</p>
            <div className="row-item"><span className="se-row-icon"><ArtboardIcon /></span>Pricing<span className="se-state">idle</span></div>
            <div className="row-item se-row-hover"><span className="thumb se-tone-sky" />Plans<span className="se-state">hover</span></div>
            <div className="row-item" aria-current="true"><span className="thumb se-tone-yellow" />Price cards<span className="se-state">selected</span></div>
            <div className="row-item se-row-focus" aria-current="true"><span className="thumb se-tone-green" />Annual toggle<span className="se-state">selected + keys</span></div>
            <div className="row-item se-row-off"><span className="se-row-icon"><EyeOffIcon /></span>Old banner<span className="se-state">hidden</span></div>
            <div className="row-item se-row-off"><span className="se-row-icon"><LockIcon /></span>Background<span className="se-state">locked</span></div>
          </div>
          <ul className="se-rows-notes">
            <li><strong>Selected</strong> rows take <code>--accent-muted</code> and go semibold — never a solid azure bar.</li>
            <li><strong>Several picked</strong> means several highlighted rows; the order doesn't change.</li>
            <li><strong>Keys on a selected row</strong> add the ring inside the row, so focus and selection read as two things.</li>
            <li><strong>Hidden and locked</strong> layers step down to <code>--fg-2</code> and show their icon — nothing disappears.</li>
          </ul>
        </div>

        <h2 data-no>Yours, not the AI's</h2>
        <div className="stage se-ai-stage">
          <div className="se-pair se-pair--you">
            <span className="se-pair-img se-tone-coral" />
            <span className="se-pair-name">Onboarding</span>
            <span className="se-pair-ring" aria-hidden="true"><Handles /></span>
            <span className="se-label se-pair-label">Onboarding · 390 × 844</span>
          </div>
          <div className="se-pair se-pair--ai">
            <span className="se-pair-img se-tone-lilac" />
            <span className="se-pair-name">Mobile — detail</span>
            <span className="se-pair-dash" aria-hidden="true" />
            <span className="se-ai-chip"><Spark size={10} color="var(--spark-fg)" /> AI is editing</span>
          </div>
        </div>
        <p>
          The azure ring is always you. When the AI is working on something, it gets a dashed spark
          outline and says so — it never borrows your selection, and you can keep working next to it.
        </p>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · selection</span>
        <span>Azure is what you picked · the spark is what the AI is doing</span>
      </footer>
    </>
  );
}
