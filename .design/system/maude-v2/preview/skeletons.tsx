/**
 * SPECIMEN — skeletons · maude-v2
 *
 * DEMONSTRATES: loading placeholders in the shape of what's coming — a project's canvas
 *   thumbnail grid, an island list, and the AI chat panel while the AI is working — with
 *   a slow sheen that moves by transform only, staggered per row, and that stands still
 *   under prefers-reduced-motion (or this page's own "Still" switch).
 * COMPOSITION: hero = opening a project: six canvas cards that cross-fade from skeleton to
 *   real, steppable (Loading · Arriving · Ready) or replayable; island lists where skeleton
 *   rows hold the exact row height; the AI "thinking" moment on a stage (ghost artboards
 *   on the canvas, the agent cursor, a breathing spark in the AI chat panel); a timing
 *   strip for when to show what; rules; and a right/wrong.
 * COPY VOICE: the skeletons carry no copy; captions talk about the user's work.
 * NOTES: skeleton beats spinner whenever the shape is known. Opacity cross-fade and the
 *   sheen's translateX are the only animated properties (compositor-only). Every busy
 *   region sets aria-busy and announces itself once through a visually hidden status.
 */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import "./_layout.css";
import "./skeletons.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Phase = "loading" | "arriving" | "ready";
const PHASES: { id: Phase; label: string }[] = [
  { id: "loading", label: "Loading" },
  { id: "arriving", label: "Arriving" },
  { id: "ready", label: "Ready" },
];

const CANVASES = [
  { name: "Homepage", meta: "Edited 2 h ago", art: "home", w: 62 },
  { name: "Onboarding", meta: "Tereza · yesterday", art: "onboarding", w: 48 },
  { name: "Pricing", meta: "Edited Monday", art: "pricing", w: 70 },
  { name: "Mobile — detail", meta: "Jonas · last week", art: "mobile", w: 55 },
  { name: "Brand sheet", meta: "Edited in May", art: "brand", w: 40 },
  { name: "Moodboard", meta: "Tereza · in May", art: "mood", w: 66 },
];

const LIST_W = [64, 48, 72, 56, 40];
const LAYER_ROWS = [
  { indent: 0, w: 52 },
  { indent: 1, w: 66 },
  { indent: 1, w: 44 },
  { indent: 1, w: 58 },
  { indent: 0, w: 70 },
];

/** Stagger index for the sheen — CSS reads --i. */
const at = (i: number, width?: number): CSSProperties =>
  ({ "--i": i, ...(width ? { width: `${width}%` } : {}) }) as CSSProperties;

export default function Skeletons() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [still, setStill] = useState(false);
  const [run, setRun] = useState(0);

  // Replay: loading → arriving → ready, so the cross-fade can be watched end to end.
  useEffect(() => {
    if (run === 0) return;
    setPhase("loading");
    const a = window.setTimeout(() => setPhase("arriving"), 1400);
    const b = window.setTimeout(() => setPhase("ready"), 2600);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [run]);

  const isReady = (i: number) => phase === "ready" || (phase === "arriving" && i < 3);
  const busy = phase !== "ready";

  return (
    <>
      <SpecimenHeader crumbs={["Status", "Skeletons"]} />
      <main className={`specimen${still ? " sk-still" : ""}`}>
        <section className="specimen-title">
          <h1>Show the shape of what's coming.</h1>
          <p className="lede">
            When something takes a moment, Maude draws its outline first — the thumbnails, the rows, the
            reply — so nothing jumps when it lands. The sheen moves slowly and only sideways, and it stands
            still if you've asked your Mac for less motion.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Moves</dt><dd>transform + opacity only</dd></div>
          <div><dt>Sheen</dt><dd>slow, staggered per row</dd></div>
          <div><dt>Under 300 ms</dt><dd>show nothing</dd></div>
          <div><dt>Reduced motion</dt><dd>still, full shape</dd></div>
        </dl>

        {/* ── Hero: opening a project ──────────────────────────────────── */}
        <h2 data-no>Opening a project<span className="h2-aside">cards keep their size from first frame to last</span></h2>
        <div className="sk-toolbar">
          <span className="seg" role="group" aria-label="Loading phase">
            {PHASES.map((p) => (
              <button key={p.id} type="button" aria-pressed={phase === p.id} onClick={() => setPhase(p.id)}>{p.label}</button>
            ))}
          </span>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setRun((n) => n + 1)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5" /></svg>
            Replay
          </button>
          <span className="seg sk-toolbar-end" role="group" aria-label="Sheen">
            <button type="button" aria-pressed={!still} onClick={() => setStill(false)}>Moving</button>
            <button type="button" aria-pressed={still} onClick={() => setStill(true)}>Still</button>
          </span>
        </div>

        <div className="stage sk-hero" aria-busy={busy}>
          <span className="sk-sr" role="status">{busy ? "Loading canvases in Studio site" : "Six canvases loaded"}</span>
          <div className="island sk-pill">
            <Mark size={22} />
            <span>Studio site</span>
          </div>
          <div className="island sk-hero-tr">
            <button className="btn btn--primary btn--sm" type="button">New canvas</button>
          </div>

          <div className="sk-cards">
            {CANVASES.map((c, i) => {
              const ready = isReady(i);
              return (
                <article key={c.name} className="sk-card" data-ready={ready}>
                  <div className="sk-card-ghost" aria-hidden="true">
                    <span className="sk sk-thumb" style={at(i)} />
                    <span className="sk sk-line" style={at(i, c.w)} />
                    <span className="sk sk-line sk-line--sm" style={at(i, c.w - 18)} />
                  </div>
                  <div className="sk-card-real" aria-hidden={!ready}>
                    <div className={`sk-art sk-art--${c.art}`} aria-hidden="true">
                      <i /><i /><i />
                    </div>
                    <strong>{c.name}</strong>
                    <span>{c.meta}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* ── Island lists ─────────────────────────────────────────────── */}
        <h2 data-no>Lists inside islands<span className="h2-aside">same row height, so nothing moves when names arrive</span></h2>
        <div className="sk-lists">
          <figure className="sk-list-case">
            <div className="stage sk-list-stage">
              <div className="island island--pad sk-list" aria-busy="true">
                <span className="sk-sr" role="status">Loading canvases</span>
                <p className="island-title">Canvases</p>
                {LIST_W.map((w, i) => (
                  <div key={i} className="row-item sk-row" aria-hidden="true">
                    <span className="sk sk-row-thumb" style={at(i)} />
                    <span className="sk sk-row-bar" style={at(i, w)} />
                  </div>
                ))}
              </div>
            </div>
            <figcaption><strong>Canvases, loading.</strong> The island title is real from the start — only what is still loading is grey.</figcaption>
          </figure>
          <figure className="sk-list-case">
            <div className="stage sk-list-stage">
              <div className="island island--pad sk-list" aria-busy="true">
                <span className="sk-sr" role="status">Loading layers</span>
                <p className="island-title">Layers</p>
                {LAYER_ROWS.map((r, i) => (
                  <div key={i} className={`row-item sk-row${r.indent ? " sk-row--in" : ""}`} aria-hidden="true">
                    <span className="sk sk-row-icon" style={at(i)} />
                    <span className="sk sk-row-bar" style={at(i, r.w)} />
                  </div>
                ))}
              </div>
            </div>
            <figcaption><strong>Layers, loading.</strong> Indents are kept, so the tree's shape is readable before its names.</figcaption>
          </figure>
          <figure className="sk-list-case">
            <div className="stage sk-list-stage">
              <div className="island island--pad sk-list">
                <p className="island-title">Canvases</p>
                {CANVASES.slice(0, 5).map((c, i) => (
                  <div key={c.name} className="row-item" aria-current={i === 0 ? "true" : undefined}>
                    <span className={`thumb sk-th sk-th--${c.art}`} />
                    {c.name}
                  </div>
                ))}
              </div>
            </div>
            <figcaption><strong>Canvases, ready.</strong> Line up the two islands: every row sits where its skeleton was.</figcaption>
          </figure>
        </div>

        {/* ── AI thinking ──────────────────────────────────────────────── */}
        <h2 data-no>While the AI works<span className="h2-aside">the spark breathes; the canvas shows where things will land</span></h2>
        <div className="stage sk-ai-stage" aria-busy="true">
          <span className="sk-sr" role="status">AI is sketching three hero variants</span>
          <div className="sk-ai-source">
            <div className="sk-ai-source-top" />
            <span className="sk-ai-label">Homepage</span>
          </div>
          <div className="sk-ghosts" aria-hidden="true">
            {["Variant A", "Variant B", "Variant C"].map((v, i) => (
              <div key={v} className={`sk-ghost${i === 0 ? " sk-ghost--done" : ""}`}>
                <span className="sk-ghost-label">{v}</span>
                {i === 0 ? (
                  <div className="sk-ghost-real"><i /><i /><i /></div>
                ) : (
                  <>
                    <span className="sk sk-ghost-hero" style={at(i)} />
                    <span className="sk sk-ghost-line" style={at(i, 70)} />
                    <span className="sk sk-ghost-line" style={at(i + 1, 46)} />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="sk-agent" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke="var(--bg-2)" strokeWidth="1" /></svg>
            <span><Spark size={10} color="var(--spark-fg)" /> AI is sketching</span>
          </div>

          <aside className="island island--pad sk-ai-panel" aria-label="AI chat panel">
            <div className="sk-ai-hd"><Spark size={14} color="var(--spark)" /> AI</div>
            <p className="sk-ai-you">Three hero variants for Homepage, please — calmer than the current one.</p>
            <div className="sk-ai-thinking">
              <span className="sk-ai-spark" aria-hidden="true"><Spark size={14} color="var(--spark)" /></span>
              <span className="sk-ai-status">Sketching three hero variants</span>
              <span className="sk-ai-count">1 of 3</span>
            </div>
            <div className="sk-ai-reply" aria-hidden="true">
              <span className="sk sk-line" style={at(0, 92)} />
              <span className="sk sk-line" style={at(1, 78)} />
              <span className="sk sk-line" style={at(2, 54)} />
            </div>
            <div className="ask sk-ask">
              <input aria-label="Ask AI" placeholder="Ask AI…" />
              <button className="btn btn--ghost btn--sm" type="button">Stop</button>
            </div>
          </aside>
        </div>

        {/* ── When to show what ────────────────────────────────────────── */}
        <h2 data-no>When to show what<span className="h2-aside">by how long the wait is, and how much we know</span></h2>
        <div className="sk-timeline">
          <div className="sk-tl-step sk-tl-step--none">
            <span className="sk-tl-when">Under 300 ms</span>
            <div className="sk-tl-demo"><span className="sk-tl-empty" /></div>
            <strong>Nothing</strong>
            <p>A flash of grey is worse than a short wait. Let it land.</p>
          </div>
          <div className="sk-tl-step sk-tl-step--wide">
            <span className="sk-tl-when">300 ms to a few seconds</span>
            <div className="sk-tl-demo">
              <span className="sk sk-tl-thumb" style={at(0)} />
              <span className="sk-tl-col">
                <span className="sk sk-line" style={at(1, 80)} />
                <span className="sk sk-line sk-line--sm" style={at(2, 50)} />
              </span>
            </div>
            <strong>Skeleton</strong>
            <p>In the shape of what's coming. The default for canvases, lists and previews.</p>
          </div>
          <div className="sk-tl-step">
            <span className="sk-tl-when">Longer AI work</span>
            <div className="sk-tl-demo sk-tl-ai">
              <span className="sk-ai-spark" aria-hidden="true"><Spark size={14} color="var(--spark)" /></span>
              <span>Sketching · 2 of 3</span>
            </div>
            <strong>Words and progress</strong>
            <p>Say what it's doing and how far along. Always with a way to stop.</p>
          </div>
          <div className="sk-tl-step">
            <span className="sk-tl-when">Size unknown</span>
            <div className="sk-tl-demo sk-tl-ring-demo">
              <span className="sk-ring" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.5" strokeLinecap="round"><circle className="sk-ring-track" cx="8" cy="8" r="6" /><path className="sk-ring-arc" d="M8 2a6 6 0 0 1 6 6" /></svg>
              </span>
              <span>Adding photo.jpg</span>
            </div>
            <strong>A small ring</strong>
            <p>Only for uploads and work with no shape yet. Small, beside the thing — never over the canvas.</p>
          </div>
        </div>

        {/* ── Rules ────────────────────────────────────────────────────── */}
        <h2 data-no>How a skeleton is built</h2>
        <div className="sk-rules">
          <div className="sk-anatomy" aria-hidden="true">
            <span className="sk sk-anatomy-bar sk-frozen" />
            <span className="sk-anatomy-tag sk-anatomy-tag--fill">--bg-4 on islands and cards</span>
            <span className="sk-anatomy-tag sk-anatomy-tag--sheen">sheen · translateX only</span>
            <span className="sk-anatomy-tag sk-anatomy-tag--radius">radius of the real thing</span>
          </div>
          <ul className="sk-rule-list">
            <li><strong>Same box as the real thing.</strong> Thumbnails, rows and lines take the exact size and radius of what replaces them.</li>
            <li><strong>One quiet grey.</strong> <code>--bg-4</code> on islands and cards; the sheen is a lighter surface, never a colour.</li>
            <li><strong>Slow, and only sideways.</strong> The sheen slides on transform, rows start a beat apart, the real content fades in on opacity.</li>
            <li><strong>Still when asked.</strong> With reduced motion the sheen stops and the shapes stay, at full strength.</li>
            <li><strong>Heard once.</strong> The region is marked busy and says "Loading canvases" one time — not once per row.</li>
          </ul>
        </div>

        {/* ── Right / wrong ────────────────────────────────────────────── */}
        <h2 data-no>Keep the canvas in view</h2>
        <div className="sk-compare">
          <figure className="sk-case">
            <div className="stage sk-mini">
              <div className="island island--pad sk-mini-list" aria-hidden="true">
                <p className="island-title">Canvases</p>
                {[60, 44, 70].map((w, i) => (
                  <div key={i} className="row-item sk-row">
                    <span className="sk sk-row-thumb" style={at(i)} />
                    <span className="sk sk-row-bar" style={at(i, w)} />
                  </div>
                ))}
              </div>
              <div className="sk-mini-art"><span /></div>
            </div>
            <figcaption><strong className="sk-ok">Right</strong> Only the list is waiting, so only the list is grey. Your artboard stays put and you can keep working.</figcaption>
          </figure>
          <figure className="sk-case">
            <div className="stage sk-mini">
              <div className="sk-mini-art"><span /></div>
              <div className="sk-blocker" aria-hidden="true">
                <span className="sk-blocker-ring" />
                <span>Loading…</span>
              </div>
            </div>
            <figcaption><strong className="sk-bad">Wrong</strong> A sheet over the whole canvas with a big spinner. The work vanishes, nothing hints at what's coming, and you're locked out while you wait.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · skeletons · transform + opacity, reduced-motion safe</span>
        <span>The spark appears only where the AI is the one working</span>
      </footer>
    </>
  );
}
