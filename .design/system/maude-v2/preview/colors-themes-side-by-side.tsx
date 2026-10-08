/**
 * SPECIMEN — colors-themes-side-by-side · maude-v2
 *
 * DEMONSTRATES: light (default) and dark as equal themes over ONE token contract. The same
 *   markup is rendered twice; only the scope changes — a container with class "maude-v2"
 *   and data-theme="light" | "dark" — and colors_and_type.css does the rest.
 * COMPOSITION: hero = a wipe — the same slice of the app stacked light-under-dark, with a
 *   slider that moves the seam across it, so every island, sticky and cursor can be read in
 *   both themes at the exact same spot. Then the classic two-up of a compact panel set, a
 *   live token table (each swatch resolved inside its own scope, never typed in), the three
 *   things dark does on purpose, and what never changes between themes.
 * COPY VOICE: identical strings in both panes — only the theme differs.
 * WHEN SCAFFOLDED: theme-both (maude-v2: light default, dark equal-status).
 * NOTES: Each scope restates `color` and `background` on itself, because inherited values are
 *   computed in the parent's theme. If anything differs between panes beyond colour, that is
 *   a token bug, not a per-theme design.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import "./_layout.css";
import "./colors-themes-side-by-side.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Theme = "light" | "dark";

/* ─── One slice of the app — rendered per theme, markup identical ──────────── */
function AppSlice() {
  return (
    <>
      <div className="th-artboard">
        <div className="th-ab-img" />
        <div className="th-ab-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
        <span className="th-sel" aria-hidden="true" />
      </div>
      <div className="sticky sticky--yellow th-st1">Bigger photo in the hero?</div>
      <div className="sticky sticky--lilac th-st2">Mobile first</div>
      <div className="th-cursor" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke="var(--bg-2)" strokeWidth="1" /></svg>
        <span><Spark size={10} color="var(--spark-fg)" /> AI is sketching…</span>
      </div>

      <div className="island th-pill"><Mark size={20} /><span>Studio site</span></div>
      <div className="island island--pad th-list">
        <p className="island-title">Canvases</p>
        <div className="row-item" aria-current="true"><span className="thumb th-th-coral" />Homepage</div>
        <div className="row-item"><span className="thumb th-th-yellow" />Onboarding</div>
        <div className="row-item"><span className="thumb th-th-green" />Pricing</div>
      </div>
      <div className="island th-tr"><button className="btn btn--primary btn--sm" type="button">Share</button></div>
      <div className="island island--pad th-ai">
        <div className="th-ai-hd"><Spark size={13} color="var(--spark)" /> AI</div>
        <p className="th-ai-msg">Done — three hero variants are on the canvas. Pick one.</p>
      </div>
      <div className="island dock th-dock">
        <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
        </button>
        <button className="icon-btn" type="button" aria-label="Frame">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h12M2 11h12M5 2v12M11 2v12" /></svg>
        </button>
        <button className="icon-btn" type="button" aria-label="Text">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M8 4v9" /></svg>
        </button>
        <button className="icon-btn" type="button" aria-label="Image">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></svg>
        </button>
        <span className="divider-v" />
        <button className="icon-btn" type="button" aria-label="More tools">
          <svg viewBox="0 0 16 16" fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></svg>
        </button>
      </div>
    </>
  );
}

/* ─── A compact panel set for the two-up ──────────────────────────────────── */
function PanelSet({ theme }: { theme: Theme }) {
  return (
    <div className="maude-v2 th-pane" data-theme={theme}>
      <span className="th-pane-tag">{theme === "light" ? "Light" : "Dark"}</span>
      <div className="island island--pad th-panel">
        <p className="island-title">Ask AI</p>
        <div className="ask">
          <span className="chip chip--accent">◆ hero</span>
          <input aria-label={`Ask AI (${theme})`} placeholder="Ask AI…" />
          <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
        </div>
        <div className="th-btns">
          <button className="btn btn--primary btn--sm" type="button">Share</button>
          <button className="btn btn--sm" type="button">Duplicate</button>
          <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
        </div>
        <div className="th-chips">
          <span className="chip">Frame</span>
          <span className="chip chip--spark"><Spark size={10} color="var(--spark)" /> Made by AI</span>
          <span className="th-saved"><i />Saved</span>
        </div>
        <div className="th-text">
          <strong>Homepage</strong>
          <span>Edited by Tereza · 2 min ago</span>
        </div>
      </div>
    </div>
  );
}

const ROWS: { token: string; kind: "fill" | "ink" | "edge" | "lift" | "on-spark"; note: string; on?: boolean }[] = [
  { token: "--bg-0", kind: "fill", note: "The canvas. Near-white, then a soft graphite." },
  { token: "--bg-1", kind: "fill", note: "Island body. Lighter than the canvas in both." },
  { token: "--bg-2", kind: "fill", note: "Popovers and the artboard paper." },
  { token: "--fg-0", kind: "ink", note: "Primary ink flips from cool ink to near-white." },
  { token: "--fg-2", kind: "ink", note: "Meta. Re-tuned per theme, not mirrored." },
  { token: "--accent", kind: "fill", note: "A touch brighter in dark so it holds its weight." },
  { token: "--spark", kind: "fill", note: "Same vermilion family, nudged warmer in dark." },
  { token: "--spark-fg", kind: "on-spark", note: "White on the spark in light, a dark warm ink in dark.", on: true },
  { token: "--object-yellow", kind: "fill", note: "Stickies go deeper in dark so they don't glow.", on: true },
  { token: "--island-edge", kind: "edge", note: "Ink hairline in light, a white hairline in dark.", on: true },
  { token: "--island-shadow", kind: "lift", note: "Soft and cool in light, deeper and black in dark." },
];

function TokenCell({ theme, token, kind }: { theme: Theme; token: string; kind: string }) {
  const v = `var(${token})`;
  const style: CSSProperties =
    kind === "fill" ? { background: v } :
    kind === "ink" ? { color: v } :
    kind === "edge" ? { boxShadow: `inset 0 0 0 1px ${v}` } :
    kind === "lift" ? { boxShadow: v } : {};
  return (
    <span className="maude-v2 th-cell" data-theme={theme}>
      {kind === "ink" ? <span className="th-ink" style={style}>Homepage</span>
        : kind === "on-spark" ? <span className="th-onspark"><Spark size={10} color="var(--spark-fg)" /> Ask AI</span>
        : <span className={`th-sw th-sw--${kind}`} style={style} />}
    </span>
  );
}

export default function ColorsThemesSideBySide() {
  const [split, setSplit] = useState(50);
  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Light & dark"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>One app, two lights.</h1>
          <p className="lede">
            Light is where Maude starts; dark is its equal, not an afterthought. Both read from the same
            tokens, so the islands, the stickies and the AI look like themselves either way — only the light
            in the room changes.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Default</dt><dd>light — follows macOS appearance</dd></div>
          <div><dt>Dark</dt><dd>equal status, every token declared</dd></div>
          <div><dt>Switch</dt><dd>data-theme on a .maude-v2 scope</dd></div>
        </dl>

        {/* ── Hero: the wipe ─────────────────────────────────────────────── */}
        <h2 data-no>The same spot, both themes<span className="h2-aside">drag the seam across the canvas</span></h2>
        <div className="th-wipe" style={{ "--split": `${split}%` } as CSSProperties}>
          <div className="maude-v2 th-scope" data-theme="light"><AppSlice /></div>
          <div className="maude-v2 th-scope th-scope--top" data-theme="dark" aria-hidden="true" inert><AppSlice /></div>
          <span className="th-seam" aria-hidden="true"><span className="th-seam-knob" /></span>
          <span className="th-wipe-tag th-wipe-tag--l">Light</span>
          <span className="th-wipe-tag th-wipe-tag--r">Dark</span>
        </div>
        <label className="th-range">
          <span>Light</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Move the seam between light and dark" />
          <span>Dark</span>
        </label>

        {/* ── Two-up ─────────────────────────────────────────────────────── */}
        <h2 data-no>Side by side<span className="h2-aside">identical markup — only data-theme differs</span></h2>
        <div className="th-two">
          <PanelSet theme="light" />
          <PanelSet theme="dark" />
        </div>

        {/* ── What changes ───────────────────────────────────────────────── */}
        <h2 data-no>What changes<span className="h2-aside">each swatch is resolved inside its own theme</span></h2>
        <div className="th-table" role="table" aria-label="Token values in light and dark">
          <div className="th-tr-row th-tr-hd" role="row">
            <span role="columnheader">Token</span>
            <span role="columnheader">Light</span>
            <span role="columnheader">Dark</span>
            <span role="columnheader">What happens</span>
          </div>
          {ROWS.map((r) => (
            <div className="th-tr-row" role="row" key={r.token}>
              <span role="cell" className="th-tok"><code>{r.token}</code>{r.on ? <span className="chip">on purpose</span> : null}</span>
              <span role="cell"><TokenCell theme="light" token={r.token} kind={r.kind} /></span>
              <span role="cell"><TokenCell theme="dark" token={r.token} kind={r.kind} /></span>
              <span role="cell" className="th-note">{r.note}</span>
            </div>
          ))}
        </div>

        {/* ── What stays ─────────────────────────────────────────────────── */}
        <h2 data-no>What never changes</h2>
        <div className="th-stays">
          <div className="th-stay"><span className="th-stay-radius" /><b>Radii</b><span>Island 14 › control 10 › chip 6</span></div>
          <div className="th-stay"><span className="th-stay-space"><i /><i /><i /><i /></span><b>Spacing</b><span>8px rhythm, 4px half-step</span></div>
          <div className="th-stay"><span className="th-stay-type">Aa</span><b>Type</b><span>SF Pro, same scale and weights</span></div>
          <div className="th-stay"><span className="th-stay-motion"><i /></span><b>Motion</b><span>Same durations and easing</span></div>
        </div>
        <p className="th-foot-note">
          Structure, size and timing are theme-free tokens. A panel that moves, resizes or reflows when the
          theme flips is a bug.
        </p>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · light & dark</span>
        <span>Light is the first-run look; dark is its equal</span>
      </footer>
    </>
  );
}
