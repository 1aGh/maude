/**
 * SPECIMEN — components-toggles · maude-v2
 *
 * DEMONSTRATES: .switch (track 34 × 20, thumb on --ease-spring) · .seg (segmented, text and icon) ·
 *               checkbox (incl. mixed) and radio as real <input>s restyled · the per-panel "Advanced"
 *               disclosure — --font-mono and the 4 px half-step appear ONLY inside it · --accent for
 *               on / checked / chosen · --bg-3 / --bg-4 tracks · --dur-flip, --dur-panel + --ease-out.
 * COMPOSITION:  hero = one frame on the canvas and its inspector shown twice — Advanced closed and
 *               Advanced open — sharing one state, so flipping a friendly control rewrites the raw CSS
 *               and the frame on the canvas at once · every panel has its own Advanced (inspector, AI chat
 *               panel, Share sheet, Menu › Diagnostics) · a live "Canvas" island of switches · segmented
 *               controls, text and icon · an export sheet with a mixed "All artboards" checkbox and a
 *               radio group · a five-card guide to choosing.
 * COPY VOICE:   real settings in everyday words — "Snap to grid", "Clip content", "Who can open the link".
 * NOTES:        Advanced is a layer inside a panel, never a separate mode. Closed, it's one quiet row
 *               with a count; open, it's dense and monospaced, and it stays open for that panel until you
 *               close it. Nothing is ever removed from the friendly view to make room — only tucked here.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./components-toggles.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

function Ic({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const CHEVRON = <path d="M6 4l4 4-4 4" />;

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
    />
  );
}

/* ─── Hero: the inspector, closed and open, one shared frame ─────────────── */
type Dir = "column" | "row";
type Frame = { dir: Dir; gap: 12 | 24 | 40; clip: boolean };

function cssOf(f: Frame) {
  return [
    ["display", "flex"],
    ["flex-direction", f.dir],
    ["gap", `${f.gap}px`],
    ["padding", "32px 40px"],
    ["overflow", f.clip ? "hidden" : "visible"],
    ["border-radius", "0"],
  ];
}

function Inspector({ f, set, open, setOpen, id }: { f: Frame; set: (p: Partial<Frame>) => void; open: boolean; setOpen: (v: boolean) => void; id: string }) {
  const rows = cssOf(f);
  return (
    <div className="island island--pad tg-insp">
      <p className="island-title">Hero · frame</p>
      <div className="tg-insp-row">
        <span>Layout</span>
        <span className="seg tg-seg-sm" role="group" aria-label="Layout direction">
          <button type="button" aria-pressed={f.dir === "column"} onClick={() => set({ dir: "column" })}>Column</button>
          <button type="button" aria-pressed={f.dir === "row"} onClick={() => set({ dir: "row" })}>Row</button>
        </span>
      </div>
      <div className="tg-insp-row">
        <span>Gap</span>
        <span className="seg tg-seg-sm" role="group" aria-label="Gap">
          {([12, 24, 40] as const).map((g) => (
            <button key={g} type="button" aria-pressed={f.gap === g} onClick={() => set({ gap: g })}>{g}</button>
          ))}
        </span>
      </div>
      <div className="tg-insp-row">
        <span>Clip content</span>
        <Switch on={f.clip} onChange={(v) => set({ clip: v })} label="Clip content" />
      </div>

      <div className="tg-adv" data-open={open}>
        <button className="tg-adv-btn" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className="tg-adv-ch"><Ic size={12}>{CHEVRON}</Ic></span>
          Advanced
          <span className="tg-adv-count">{open ? "CSS" : `${rows.length} ${rows.length === 1 ? "property" : "properties"}`}</span>
        </button>
        {open ? (
          <div className="tg-adv-body" id={id}>
            {rows.map(([k, v]) => (
              <label className="tg-css" key={k}>
                <span className="tg-css-k">{k}</span>
                <input className="tg-css-v" value={v} readOnly aria-label={k} />
              </label>
            ))}
            <button className="tg-css-add" type="button">+ Add property</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdvancedHero() {
  const [f, setF] = useState<Frame>({ dir: "column", gap: 24, clip: true });
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(true);
  const set = (p: Partial<Frame>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="stage tg-hero">
      <div className="tg-frame-wrap">
        <span className="tg-frame-label">Hero · 640 × 360</span>
        <div className="tg-frame" style={{ flexDirection: f.dir, gap: f.gap / 2, overflow: f.clip ? "hidden" : "visible" }}>
          <span className="tg-blk tg-blk--title" />
          <span className="tg-blk tg-blk--text" />
          <span className="tg-blk tg-blk--photo" />
        </div>
      </div>

      <div className="tg-pair">
        <div className="tg-col">
          <p className="tg-col-cap"><strong>Closed</strong> what everyone sees</p>
          <Inspector f={f} set={set} open={openA} setOpen={setOpenA} id="tg-adv-a" />
        </div>
        <div className="tg-col">
          <p className="tg-col-cap"><strong>Open</strong> the same frame, as CSS</p>
          <Inspector f={f} set={set} open={openB} setOpen={setOpenB} id="tg-adv-b" />
        </div>
      </div>
    </div>
  );
}

/* ─── Checkbox tree ──────────────────────────────────────────────────────── */
const ARTBOARDS = ["Homepage", "Onboarding", "Pricing", "Mobile — detail"];

function ExportSheet() {
  const [picked, setPicked] = useState<boolean[]>([true, true, false, true]);
  const [comments, setComments] = useState(false);
  const [who, setWho] = useState("link");
  const all = useRef<HTMLInputElement>(null);
  const n = picked.filter(Boolean).length;

  useEffect(() => {
    if (all.current) all.current.indeterminate = n > 0 && n < picked.length;
  }, [n, picked.length]);

  return (
    <div className="tg-forms">
      <div className="island island--pad tg-sheet">
        <p className="island-title">Export “Studio site”</p>
        <label className="tg-opt tg-opt--parent">
          <input ref={all} type="checkbox" className="tg-check" checked={n === picked.length} onChange={(e) => setPicked(picked.map(() => e.target.checked))} />
          <span>All artboards</span>
          <span className="tg-opt-meta">{n} of {picked.length}</span>
        </label>
        <div className="tg-children">
          {ARTBOARDS.map((a, i) => (
            <label className="tg-opt" key={a}>
              <input type="checkbox" className="tg-check" checked={picked[i]} onChange={() => setPicked(picked.map((p, j) => (j === i ? !p : p)))} />
              <span>{a}</span>
            </label>
          ))}
        </div>
        <div className="tg-sep" />
        <label className="tg-opt">
          <input type="checkbox" className="tg-check" checked={comments} onChange={() => setComments(!comments)} />
          <span>Include comments</span>
        </label>
        <label className="tg-opt tg-opt--off">
          <input type="checkbox" className="tg-check" disabled />
          <span>Include Version history</span>
          <span className="tg-opt-meta">only for PDF</span>
        </label>
        <div className="tg-sheet-ft">
          <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
          <button className="btn btn--primary btn--sm" type="button" disabled={n === 0}>{n === 0 ? "Pick an artboard" : `Export ${n} ${n === 1 ? "artboard" : "artboards"}`}</button>
        </div>
      </div>

      <div className="island island--pad tg-sheet">
        <p className="island-title">Who can open the link</p>
        <fieldset className="tg-radios">
          <legend className="tg-sr">Who can open the link</legend>
          {[
            { v: "invited", t: "Only people you invite", d: "Tereza and Jonas, for now." },
            { v: "link", t: "Anyone with the link can view", d: "They can look around, but not change anything." },
            { v: "comment", t: "Anyone with the link can comment", d: "Comments land on the canvas for you to resolve." },
          ].map((r) => (
            <label className="tg-opt tg-opt--radio" key={r.v}>
              <input type="radio" name="tg-who" className="tg-radio" checked={who === r.v} onChange={() => setWho(r.v)} />
              <span className="tg-radio-txt"><span>{r.t}</span><span className="tg-opt-meta">{r.d}</span></span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

/* ─── Canvas switches ────────────────────────────────────────────────────── */
function CanvasSwitches() {
  const [s, setS] = useState({ snap: true, dots: true, comments: false, sounds: false });
  const flip = (k: keyof typeof s) => (v: boolean) => setS((x) => ({ ...x, [k]: v }));
  return (
    <div className="tg-switches">
      <div className="island island--pad tg-switch-island" data-dots={s.dots}>
        <p className="island-title">Canvas</p>
        {[
          { k: "snap" as const, t: "Snap to grid", d: "Things line up as you drag them." },
          { k: "dots" as const, t: "Show the dot grid", d: "Turn it off for a plain canvas." },
          { k: "comments" as const, t: "Show comments", d: "Pins stay where they were left." },
        ].map((r) => (
          <div className="tg-sw-row" key={r.k}>
            <span className="tg-sw-txt"><span>{r.t}</span><span className="tg-opt-meta">{r.d}</span></span>
            <Switch on={s[r.k]} onChange={flip(r.k)} label={r.t} />
          </div>
        ))}
        <div className="tg-sw-row tg-sw-row--off">
          <span className="tg-sw-txt"><span>Follow Tereza</span><span className="tg-opt-meta">Tereza is away — you can follow her when she's back.</span></span>
          <Switch on={false} label="Follow Tereza" disabled />
        </div>
      </div>
      <div className="tg-sw-anat">
        <div className="tg-sw-big" aria-hidden="true">
          <span className="tg-sw-big-track"><span className="tg-sw-big-thumb" /></span>
          <span className="tg-dim tg-dim--w">34</span>
          <span className="tg-dim tg-dim--h">20</span>
          <span className="tg-dim tg-dim--t">thumb 16 · travels 14</span>
        </div>
        <p><strong>A switch acts the moment you flip it.</strong> No Save button follows it, ever. The thumb lands with a drop of spring — one of the few places the spring is allowed, because flipping something feels physical.</p>
        <p>If it can't be flipped right now, the row says why in words, instead of just greying out.</p>
      </div>
    </div>
  );
}

/* ─── Segmented ──────────────────────────────────────────────────────────── */
function Segs() {
  const [view, setView] = useState("Grid");
  const [fit, setFit] = useState("Fill");
  const [align, setAlign] = useState("Left");
  const ALIGN: Record<string, string> = { Left: "M3 3v10M6 5h7M6 8h5M6 11h7", Centre: "M8 3v10M4 5h8M5 8h6M4 11h8", Right: "M13 3v10M3 5h7M5 8h5M3 11h7" };
  return (
    <div className="tg-segs">
      <figure className="tg-seg-cell">
        <span className="seg" role="group" aria-label="Show canvases as">
          {["Grid", "List"].map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </span>
        <figcaption><strong>Two views</strong><span>Home and the canvas finder.</span></figcaption>
      </figure>
      <figure className="tg-seg-cell">
        <span className="seg" role="group" aria-label="Image fit">
          {["Fill", "Fit", "Crop"].map((v) => <button key={v} type="button" aria-pressed={fit === v} onClick={() => setFit(v)}>{v}</button>)}
        </span>
        <figcaption><strong>Three ways to place a photo</strong><span>In the inspector, when an image is selected.</span></figcaption>
      </figure>
      <figure className="tg-seg-cell">
        <span className="seg tg-seg-icons" role="group" aria-label="Text alignment">
          {Object.keys(ALIGN).map((v) => (
            <button key={v} type="button" aria-pressed={align === v} aria-label={`Align ${v.toLowerCase()}`} onClick={() => setAlign(v)}>
              <Ic size={14}><path d={ALIGN[v]} /></Ic>
            </button>
          ))}
        </span>
        <figcaption><strong>Icons, when the picture is the word</strong><span>Each one still has a name for screen readers and tooltips.</span></figcaption>
      </figure>
      <p className="tg-seg-note">
        The chosen segment lifts onto its own tile with a thin azure edge, never a solid azure fill — it's a
        view, not an action. Up to four options, all in sight. A fifth means it's time for a select.
      </p>
    </div>
  );
}

const GUIDE = [
  { k: "Switch", q: "On or off, right now?", demo: <span className="switch tg-on" aria-hidden="true" /> },
  { k: "Segmented", q: "One of two to four, all in view?", demo: <span className="seg tg-seg-sm" aria-hidden="true"><button type="button" tabIndex={-1} aria-pressed="true">Fill</button><button type="button" tabIndex={-1}>Fit</button></span> },
  { k: "Radio", q: "One of a few, each needing a sentence?", demo: <span className="tg-demo-radio" aria-hidden="true" /> },
  { k: "Checkbox", q: "Any number, then a button confirms?", demo: <span className="tg-demo-check" aria-hidden="true" /> },
  { k: "Advanced", q: "A knob nobody needs every day?", demo: <span className="tg-demo-adv" aria-hidden="true"><Ic size={10}>{CHEVRON}</Ic>Advanced</span> },
];

export default function ComponentsToggles() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Toggles"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Flip it, pick one, tick a few. The knobs wait under Advanced.</h1>
          <p className="lede">
            Switches act at once, segments pick a view, checkboxes and radios gather choices before a button
            confirms. Every panel keeps its raw settings one row away, under Advanced — closed for most
            people, there in a click for whoever wants to see the CSS.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Switch</dt><dd>34 × 20 · acts at once</dd></div>
          <div><dt>Segmented</dt><dd>2 to 4 options, all in view</dd></div>
          <div><dt>Checkbox · radio</dt><dd>16 px, real inputs</dd></div>
          <div><dt>Advanced</dt><dd>one row · remembered per panel</dd></div>
        </dl>

        <h2 data-no>Advanced is a layer inside a panel<span className="h2-aside">same frame twice — change either, both follow</span></h2>
        <AdvancedHero />
        <div className="tg-hero-notes">
          <p><strong>Closed</strong> — one quiet row at the bottom of the panel, with a count, so you know there's more without it asking for attention.</p>
          <p><strong>Open</strong> — denser and in SF Mono, on a 4 px rhythm. It's the only place in the app mono appears, and it stays open for this panel until you close it.</p>
          <p><strong>Both are true</strong> — flip Row or Clip content above and the CSS rewrites itself. Advanced isn't a second copy; it's the same frame, said precisely.</p>
        </div>

        <h2 data-no>Every panel has its own<span className="h2-aside">where the technical things live now</span></h2>
        <div className="tg-everywhere">
          <div className="island island--pad tg-ew">
            <p className="island-title"><Spark size={10} color="var(--spark)" /> AI chat panel</p>
            <div className="tg-adv" data-open="true">
              <span className="tg-adv-btn tg-adv-btn--static"><span className="tg-adv-ch"><Ic size={12}>{CHEVRON}</Ic></span>Advanced</span>
              <div className="tg-adv-body">
                <div className="tg-sw-row tg-sw-row--dense"><span>Show each step AI takes</span><span className="switch tg-on" aria-hidden="true" /></div>
                <div className="tg-sw-row tg-sw-row--dense"><span>Thinking</span><span className="seg tg-seg-sm" aria-hidden="true"><button type="button" tabIndex={-1} aria-pressed="true">Quick</button><button type="button" tabIndex={-1}>Deep</button></span></div>
                <label className="tg-css"><span className="tg-css-k">context</span><input className="tg-css-v" readOnly value="3 canvases · 41 layers" aria-label="context" /></label>
              </div>
            </div>
          </div>
          <div className="island island--pad tg-ew">
            <p className="island-title">Share “Homepage”</p>
            <div className="tg-adv" data-open="true">
              <span className="tg-adv-btn tg-adv-btn--static"><span className="tg-adv-ch"><Ic size={12}>{CHEVRON}</Ic></span>Advanced</span>
              <div className="tg-adv-body">
                <div className="tg-sw-row tg-sw-row--dense"><span>Link stops working after</span><span className="tg-mini-sel">30 days</span></div>
                <label className="tg-css tg-css--stack"><span className="tg-css-k">embed</span><textarea className="tg-css-v tg-css-ta" readOnly rows={2} aria-label="Embed code" value={'<iframe src="https://maude.sh/s/hp-7k2" width="1440" height="900"></iframe>'} /></label>
              </div>
            </div>
          </div>
          <div className="island island--pad tg-ew">
            <p className="island-title">Menu › Diagnostics</p>
            <div className="tg-adv" data-open="true">
              <span className="tg-adv-btn tg-adv-btn--static"><span className="tg-adv-ch"><Ic size={12}>{CHEVRON}</Ic></span>Advanced</span>
              <div className="tg-adv-body">
                {[
                  ["address", "http://localhost:4402"],
                  ["process", "maude-server · 48211"],
                  ["project folder", "~/Projects/studio-site"],
                  ["synced", "2 min ago"],
                ].map(([k, v]) => (
                  <label className="tg-css" key={k}><span className="tg-css-k">{k}</span><input className="tg-css-v" readOnly value={v} aria-label={k} /></label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="tg-ew-note">
          Folders, addresses and processes used to sit in the chrome. Now they're here — hidden by default, never removed.
        </p>

        <h2 data-no>Switches<span className="h2-aside">a live “Canvas” island</span></h2>
        <CanvasSwitches />

        <h2 data-no>Segmented<span className="h2-aside">pick a view</span></h2>
        <Segs />

        <h2 data-no>Checkboxes and radios<span className="h2-aside">gather choices, then confirm</span></h2>
        <ExportSheet />

        <h2 data-no>Which one?</h2>
        <div className="tg-guide">
          {GUIDE.map((g) => (
            <div className="tg-guide-card" key={g.k}>
              <div className="tg-guide-demo">{g.demo}</div>
              <span className="tg-guide-q">{g.q}</span>
              <strong>{g.k}</strong>
            </div>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · toggles</span>
        <span>Hidden, never removed — Advanced in every panel</span>
      </footer>
    </>
  );
}
