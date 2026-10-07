/**
 * SPECIMEN — components-inputs · maude-v2
 *
 * DEMONSTRATES: .input / .select / .textarea / .field / .field-label / .field-hint · .ask (the AI prompt)
 *               · --bg-3 input well → --bg-2 on focus · the focus HALO (3 px --accent-tint + 1 px
 *               --accent) · --spark on the send button only · --status-error paired with an icon and
 *               words · --radius-md fields, --radius-lg for the Ask field · .kbd hints.
 * COMPOSITION:  hero = the three kinds of field in their real homes on one canvas — search (⌘K,
 *               "Search"), ask (the AI chat panel) and adjust (the inspector, W / H / X / Y that you
 *               can scrub, resizing the artboard live) · a live Search that filters as you type · the Ask
 *               prompt through its five moments · number-field anatomy and states · a "Canvas settings"
 *               island with text, select, textarea and a field the project controls · live validation in
 *               plain words, plus a before / after table for error copy.
 * COPY VOICE:   real labels about the user's work ("Search", "Ask AI to…", "Background"); words per
 *               CONTRACT.md §3 and the no-results line exactly as §4.
 *               Errors say what happened and what to do, in one short sentence. No codes.
 * NOTES:        Labels sit above, hints below — never inside. Placeholders are examples, not
 *               instructions. Errors show after you've typed or left the field, never on an untouched one.
 *               Number fields scrub: drag the letter, or ↑ / ↓ (⇧ for ×10).
 */
import { useId, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";
import "./_layout.css";
import "./components-inputs.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

function Ic({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const SEARCH = (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>);
const CLEAR = <path d="M5 5l6 6M11 5l-6 6" />;
const CHEVRON = <path d="M5 6.5l3 3 3-3" />;
const LINK = <path d="M6 4.5V3.5a2 2 0 0 1 4 0v1M6 11.5v1a2 2 0 0 0 4 0v-1M8 6.5v3" />;
const ALERT = (<><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3.5M8 10.75v.01" /></>);
const CHECK = <path d="M3.5 8.5l3 3 6-7" />;

const CANVASES = ["Homepage", "Onboarding", "Pricing", "Mobile — detail", "Brand moodboard", "Pricing — old"];
const THUMB: Record<string, string> = {
  Homepage: "sky", Onboarding: "yellow", Pricing: "green", "Mobile — detail": "lilac", "Brand moodboard": "coral", "Pricing — old": "grey",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ─── Number field that scrubs ───────────────────────────────────────────── */
function Scrub({ k, label, value, onChange, min = -9999, max = 9999, unit, state, mixed }: {
  k: string; label: string; value: number; onChange?: (v: number) => void; min?: number; max?: number; unit?: string;
  state?: "hover" | "scrub" | "focus"; mixed?: boolean;
}) {
  const id = useId();
  const start = useRef<{ x: number; v: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const set = (v: number) => onChange?.(clamp(Math.round(v), min, max));

  const down = (e: RPointerEvent<HTMLLabelElement>) => {
    if (!onChange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, v: value };
    setScrubbing(true);
  };
  const move = (e: RPointerEvent<HTMLLabelElement>) => {
    if (!start.current) return;
    set(start.current.v + (e.clientX - start.current.x) * (e.shiftKey ? 10 : 1));
  };
  const up = () => {
    start.current = null;
    setScrubbing(false);
  };

  return (
    <span className="in-num" data-state={scrubbing ? "scrub" : state}>
      <label htmlFor={id} className="in-num-k" title={`Drag to change ${label.toLowerCase()}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {k}
      </label>
      <input
        id={id}
        className="in-num-v"
        inputMode="numeric"
        aria-label={label}
        value={mixed ? "" : String(value)}
        placeholder={mixed ? "Mixed" : undefined}
        readOnly={!onChange}
        tabIndex={onChange ? 0 : -1}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^\d-]/g, ""));
          if (!Number.isNaN(n)) set(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            set(value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
        }}
      />
      {unit ? <span className="in-num-u">{unit}</span> : null}
    </span>
  );
}

function Select({ label, options, value, disabled }: { label: string; options: string[]; value?: string; disabled?: boolean }) {
  return (
    <span className="in-select">
      <select className="select" aria-label={label} defaultValue={value} disabled={disabled}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <span className="in-select-ch"><Ic>{CHEVRON}</Ic></span>
    </span>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */
function InContext() {
  const [box, setBox] = useState({ w: 1440, h: 900, x: 0, y: 120 });
  const set = (k: keyof typeof box) => (v: number) => setBox((b) => ({ ...b, [k]: v }));
  return (
    <div className="stage in-hero">
      <div className="in-board" style={{ width: box.w / 4, height: box.h / 4, translate: `${box.x / 4}px ${(box.y - 120) / 4}px` }}>
        <div className="in-board-art"><i /><i /><i /></div>
        <span className="in-board-sel" aria-hidden="true" />
        <span className="in-board-label">Homepage · {box.w} × {box.h}</span>
      </div>

      <div className="island in-pill"><Mark size={22} /><span>Studio site</span></div>

      <div className="island island--pad in-finder">
        <p className="in-tag">Search</p>
        <label className="in-search">
          <Ic>{SEARCH}</Ic>
          <input aria-label="Search" placeholder="Search" />
          <span className="kbd">⌘K</span>
        </label>
        <div className="in-finder-list">
          <div className="row-item" aria-current="true"><span className="thumb in-th-sky" aria-hidden="true" />Homepage</div>
          <div className="row-item"><span className="thumb in-th-yellow" aria-hidden="true" />Onboarding</div>
          <div className="row-item"><span className="thumb in-th-green" aria-hidden="true" />Pricing</div>
        </div>
      </div>

      <div className="island island--pad in-inspector">
        <p className="in-tag">Adjust</p>
        <p className="island-title">Artboard</p>
        <div className="in-num-grid">
          <Scrub k="W" label="Width" value={box.w} onChange={set("w")} min={600} max={1800} />
          <Scrub k="H" label="Height" value={box.h} onChange={set("h")} min={400} max={1000} />
          <Scrub k="X" label="X position" value={box.x} onChange={set("x")} min={-400} max={400} />
          <Scrub k="Y" label="Y position" value={box.y} onChange={set("y")} min={0} max={300} />
        </div>
        <p className="in-inspector-hint">Drag a letter, or use ↑ ↓ — hold ⇧ for steps of ten.</p>
      </div>

      <div className="island island--pad in-ai">
        <p className="in-tag">Ask</p>
        <label className="ask">
          <span className="chip chip--accent"><span aria-hidden="true">◆</span> Hero</span>
          <input aria-label="Ask AI" placeholder="Ask AI to make the hero lighter…" />
          <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
        </label>
      </div>
    </div>
  );
}

/* ─── Live finder ────────────────────────────────────────────────────────── */
function Finder() {
  const [q, setQ] = useState("pri");
  const t = q.trim();
  const hits = CANVASES.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()));
  const mark = (name: string) => {
    const t = q.trim();
    const i = t ? name.toLowerCase().indexOf(t.toLowerCase()) : -1;
    if (i < 0) return name;
    return (<>{name.slice(0, i)}<b>{name.slice(i, i + t.length)}</b>{name.slice(i + t.length)}</>);
  };
  return (
    <div className="in-finder-live">
      <div className="island island--pad in-finder-island">
        <label className="in-search in-search--lg" data-filled={q ? "true" : undefined}>
          <Ic size={16}>{SEARCH}</Ic>
          <input aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          {q ? (
            <button className="in-clear" type="button" aria-label="Clear" onClick={() => setQ("")}><Ic size={12}>{CLEAR}</Ic></button>
          ) : (
            <span className="kbd">⌘K</span>
          )}
        </label>
        <p className="in-count" aria-live="polite">
          {q.trim() ? (hits.length ? `${hits.length} ${hits.length === 1 ? "canvas" : "canvases"} in Studio site` : "") : "Recent"}
        </p>
        {hits.length ? (
          hits.map((c, i) => (
            <div className="row-item" key={c} aria-current={i === 0 ? "true" : undefined}>
              <span className={`thumb in-th-${THUMB[c]}`} aria-hidden="true" />
              <span>{mark(c)}</span>
              {i === 0 ? <span className="in-ret" aria-hidden="true">↵</span> : null}
            </div>
          ))
        ) : (
          <div className="in-none">
            <span>Nothing called “{t}”. Try another word, or ask AI to find it.</span>
            <button className="btn btn--sm" type="button"><Spark size={11} color="var(--spark-text)" />Ask AI</button>
          </div>
        )}
      </div>
      <ul className="in-notes">
        <li><strong>⌘K hint until you type</strong><span>Then it turns into a clear button, in the same spot.</span></li>
        <li><strong>The first match is ready</strong><span>↵ opens it — the row is already selected.</span></li>
        <li><strong>Matches are bold, not coloured</strong><span>Azure stays for the selected row.</span></li>
        <li><strong>Nothing found is a way forward</strong><span>Try “pricng” — the line suggests another word, and Ask AI finds it for you.</span></li>
      </ul>
    </div>
  );
}

/* ─── Ask moments ────────────────────────────────────────────────────────── */
const ASK: { k: string; note: string; node: ReactNode }[] = [
  {
    k: "Empty", note: "The send rests, quiet, until there's something to send.",
    node: (<span className="ask"><input tabIndex={-1} aria-label="Ask AI" placeholder="Ask AI…" /><span className="send in-send-off" aria-hidden="true"><Spark size={12} color="currentColor" /></span></span>),
  },
  {
    k: "With a selection", note: "What you picked rides along as a chip. × lets go of it.",
    node: (<span className="ask"><span className="chip chip--accent in-chip"><span aria-hidden="true">◆</span> Hero<span className="in-chip-x" aria-hidden="true"><Ic size={10}>{CLEAR}</Ic></span></span><input tabIndex={-1} aria-label="Ask AI" placeholder="Ask AI about Hero…" /><span className="send in-send-off" aria-hidden="true"><Spark size={12} color="currentColor" /></span></span>),
  },
  {
    k: "Typing", note: "The halo is azure — focus is yours. The send lights up in the spark.",
    node: (<span className="ask in-halo"><span className="chip chip--accent"><span aria-hidden="true">◆</span> Hero</span><input tabIndex={-1} aria-label="Ask AI" defaultValue="Make it lighter, keep the photo" /><span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span></span>),
  },
  {
    k: "AI at work", note: "The field says what's happening. Send becomes Stop.",
    node: (<span className="ask in-busy"><span className="in-busy-dot" /><input tabIndex={-1} aria-label="Ask AI" placeholder="AI is working on Hero…" disabled /><button className="in-stop" type="button" tabIndex={-1} aria-label="Stop"><i /></button></span>),
  },
  {
    k: "Longer thoughts", note: "Grows up to six lines. ⇧↵ for a new line, ↵ sends.",
    node: (
      <span className="ask in-multi">
        <textarea tabIndex={-1} aria-label="Ask AI" rows={3} defaultValue={"Three hero variants:\n— one with the photo full-bleed\n— one text-only, bigger type"} />
        <span className="in-multi-ft"><span className="kbd">⇧↵</span><span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span></span>
      </span>
    ),
  },
];

/* ─── Validation ─────────────────────────────────────────────────────────── */
function validate(v: string): { kind: "error" | "ok" | "hint"; msg: string; fix?: string } {
  const t = v.trim();
  if (!t) return { kind: "error", msg: "Give the canvas a name." };
  if (t.includes("/")) return { kind: "error", msg: "Names can't contain a slash — try a dash instead.", fix: t.replace(/\//g, " — ") };
  if (t.length > 40) return { kind: "error", msg: `Keep it under 40 characters — this one has ${t.length}.` };
  if (CANVASES.some((c) => c.toLowerCase() === t.toLowerCase())) return { kind: "error", msg: `There's already a ${t} in this project.`, fix: `${t} 2` };
  return { kind: "ok", msg: "Shows in the canvas list and on the project tab." };
}

function NameField() {
  const [v, setV] = useState("Pricing");
  const r = validate(v);
  const bad = r.kind === "error";
  const id = useId();
  return (
    <div className="in-validate">
      <div className="island island--pad in-validate-island">
        <div className="field" data-invalid={bad ? "true" : undefined}>
          <label className="field-label" htmlFor={id}>Canvas name</label>
          <input id={id} className="input" value={v} aria-invalid={bad} aria-describedby={`${id}-m`} onChange={(e) => setV(e.target.value)} />
          <span id={`${id}-m`} className={`field-hint in-msg in-msg--${bad ? "error" : "ok"}`}>
            {bad ? <Ic size={12}>{ALERT}</Ic> : <Ic size={12}>{CHECK}</Ic>}
            <span>{r.msg}</span>
            {bad && r.fix ? <button className="in-fix" type="button" onClick={() => setV(r.fix ?? v)}>Use “{r.fix}”</button> : null}
          </span>
        </div>
      </div>
      <div className="in-tries">
        <span>Try:</span>
        {["Homepage", "Pricing/old", "", "Spring campaign"].map((t) => (
          <button key={t || "empty"} className="btn btn--ghost btn--sm" type="button" onClick={() => setV(t)}>{t ? `“${t}”` : "empty"}</button>
        ))}
      </div>
    </div>
  );
}

const COPY = [
  { bad: "Field required", good: "Give the canvas a name." },
  { bad: "Invalid value: -20", good: "Width can't go below 1 — set it to 1." },
  { bad: "ERR_DUPLICATE_SLUG", good: "There's already a Homepage in this project." },
  { bad: "Upload failed (413)", good: "That image is too big to place. Try one under 20 MB." },
];

export default function ComponentsInputs() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Inputs"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Search, ask, adjust — three kinds of field in one calm well.</h1>
          <p className="lede">
            Every field is the same soft well that brightens when you type into it. Search knows your
            canvases, the Ask field carries what you picked to AI, and the inspector's numbers move when
            you drag them. When something's off, the field says so in one plain sentence.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Well</dt><dd>--bg-3 → --bg-2 on focus</dd></div>
          <div><dt>Focus</dt><dd>azure halo, even on the Ask field</dd></div>
          <div><dt>Heights</dt><dd>32 field · 24 inspector number</dd></div>
          <div><dt>Labels</dt><dd>above · hints and errors below</dd></div>
        </dl>

        <h2 data-no>In their homes<span className="h2-aside">drag W, H, X or Y — the artboard follows</span></h2>
        <InContext />

        <h2 data-no>Search<span className="h2-aside">⌘K · type to filter — live</span></h2>
        <Finder />

        <h2 data-no>The Ask field<span className="h2-aside">the one field that carries the spark — on its send, nowhere else</span></h2>
        <div className="in-asks">
          {ASK.map((a) => (
            <figure className="in-ask-cell" key={a.k}>
              <div className="island island--pad in-ask-island" aria-hidden="true">{a.node}</div>
              <figcaption><strong>{a.k}</strong><span>{a.note}</span></figcaption>
            </figure>
          ))}
        </div>

        <h2 data-no>Numbers in the inspector<span className="h2-aside">compact, scrubbable, honest about mixed values</span></h2>
        <div className="in-nums">
          {[
            { s: "Rest", node: <Scrub k="W" label="Width" value={1440} /> },
            { s: "Pointing at the letter", node: <Scrub k="W" label="Width" value={1440} state="hover" />, n: "the cursor turns to ↔" },
            { s: "Dragging", node: <Scrub k="W" label="Width" value={1488} state="scrub" />, n: "letter and value go azure" },
            { s: "Typing", node: <Scrub k="W" label="Width" value={1440} state="focus" />, n: "the halo, like every field" },
            { s: "Mixed", node: <Scrub k="W" label="Width" value={0} mixed />, n: "two frames, two widths" },
            { s: "With a unit", node: <Scrub k="↻" label="Rotation" value={12} unit="°" /> },
          ].map((c) => (
            <figure className="in-num-cell" key={c.s}>
              <div className="in-num-slot">{c.node}</div>
              <figcaption><strong>{c.s}</strong>{c.n ? <span>{c.n}</span> : null}</figcaption>
            </figure>
          ))}
        </div>
        <div className="in-lock">
          <div className="island island--pad in-lock-island">
            <p className="island-title">Artboard</p>
            <div className="in-lock-row">
              <Scrub k="W" label="Width" value={1440} />
              <button className="icon-btn in-lock-btn" type="button" aria-pressed="true" aria-label="Keep proportions"><Ic>{LINK}</Ic></button>
              <Scrub k="H" label="Height" value={900} />
            </div>
          </div>
          <p className="in-lock-cap">Keep proportions sits between the two numbers it ties together. Pressed, it's azure — a choice you made, not an alert.</p>
        </div>

        <h2 data-no>Text, choices and notes<span className="h2-aside">a “Canvas settings” island</span></h2>
        <div className="stage in-settings-stage">
          <div className="island island--pad in-settings">
            <p className="island-title">Canvas settings</p>
            <div className="field">
              <label className="field-label" htmlFor="in-name">Name</label>
              <input id="in-name" className="input" defaultValue="Mobile — detail" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="in-desc">Description</label>
              <textarea id="in-desc" className="textarea" defaultValue="Product detail on a phone. Tereza owns the photos, Jonas the copy." />
              <span className="field-hint">Shown on the canvas card when you point at it.</span>
            </div>
            <div className="in-two">
              <div className="field">
                <span className="field-label">Background</span>
                <Select label="Background" options={["Dot grid", "Plain", "Lines"]} value="Dot grid" />
              </div>
              <div className="field">
                <span className="field-label">New artboards</span>
                <Select label="New artboards" options={["Mobile · 390 × 844", "Tablet · 834 × 1194", "Desktop · 1440 × 900"]} value="Mobile · 390 × 844" />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Design system</span>
              <Select label="Design system" options={["Studio site"]} value="Studio site" disabled />
              <span className="field-hint">Set by the project. Change it in Menu › Settings…</span>
            </div>
            <div className="in-settings-ft">
              <button className="btn btn--ghost" type="button">Cancel</button>
              <button className="btn btn--primary" type="button">Save</button>
            </div>
          </div>
        </div>

        <h2 data-no>Saying what's wrong<span className="h2-aside">live — type, or pick a try</span></h2>
        <NameField />
        <div className="in-copy">
          <div className="in-copy-hd"><span>Instead of</span><span>Say</span></div>
          {COPY.map((c) => (
            <div className="in-copy-row" key={c.bad}>
              <span className="in-copy-bad">{c.bad}</span>
              <span className="in-copy-good">{c.good}</span>
            </div>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · inputs</span>
        <span>Labels above · halo on focus · errors in words, with an icon</span>
      </footer>
    </>
  );
}
