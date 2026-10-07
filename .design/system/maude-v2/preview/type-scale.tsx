/**
 * SPECIMEN — type-scale · maude-v2
 *
 * DEMONSTRATES: --type-xs … --type-3xl, --lh-xs … --lh-3xl, --font-display, --font-body,
 *               --font-rounded (playful surfaces), --font-mono (Advanced only), --tracking-tight.
 * COMPOSITION:  hero = a slice of the app where a "Show sizes" switch pins each string's
 *               ladder step onto the string itself (islands only ever use xs/sm); the big
 *               steps shown where they belong — Home and an empty canvas; then the 8-step
 *               ladder with real Maude strings and the 1.2 ratio worked out; the three faces
 *               and their one job each (mono lives inside an Advanced disclosure); and a
 *               right/wrong pair on "three sizes per surface".
 * COPY VOICE:   real product strings at each step — no Lorem.
 * NOTES:        Restraint ladder. Mirrors the tokens exactly: ratio 1.2 from 14 px, weights
 *               only through --w-* (capped at --w-semibold), tracking never tighter than
 *               --tracking-tight and Rounded always at 0. The Home question is fixed by
 *               CONTRACT §5: --type-3xl · --font-rounded · --w-semibold · tracking 0.
 *               text-wrap (balance/pretty) is global in _layout.css — nothing local here.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./type-scale.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* The toolbar, in CONTRACT §2 order (V H F R P T N C). */
const TOOLS: { name: string; key: string; d: string }[] = [
  { name: "Select", key: "V", d: "M4 3l9 4.5-4 1.2L8 13z" },
  { name: "Hand", key: "H", d: "M5.5 8V4.3a1 1 0 0 1 2 0V7.5M7.5 7V3.3a1 1 0 0 1 2 0V7.5M9.5 7.5V4.5a1 1 0 0 1 2 0v4.8c0 2.4-1.6 4.2-4 4.2-1.5 0-2.6-.7-3.4-1.9L2.7 9.2a1 1 0 0 1 1.6-1.2L5.5 9.5" },
  { name: "Frame", key: "F", d: "M2 5h12M2 11h12M5 2v12M11 2v12" },
  { name: "Shape", key: "R", d: "M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" },
  { name: "Pen", key: "P", d: "M3 13l1-3.4 6.6-6.6a1.4 1.4 0 0 1 2 2L6 11.6z" },
  { name: "Text", key: "T", d: "M3 4h10M8 4v9" },
  { name: "Sticky", key: "N", d: "M3.5 3h9v6.2L9.2 12.5H3.5zM9.2 12.5V9.2h3.3" },
  { name: "Comment", key: "C", d: "M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7.2L4.5 13v-2H4.5A1.5 1.5 0 0 1 3 9.5z" },
];

/** Wraps a string and, when sizes are shown, pins its ladder step onto it. */
function Sized({ step, show, children, side = "right" }: { step: string; show: boolean; children: ReactNode; side?: "right" | "top" | "top-end" | "bottom-end" }) {
  return (
    <span className="ts-sized">
      {children}
      {show ? <span className={`ts-tag ts-tag--${side}`} aria-hidden="true">{step}</span> : null}
    </span>
  );
}

const LADDER = [
  { t: "3xl", px: 35, lh: "1.08", face: "Rounded · semibold · tracking 0", math: "14 × 1.2⁵ = 34.8", role: "The Home question", sample: "What shall we make?", cls: "ts-s-3xl" },
  { t: "2xl", px: 29, lh: "1.14", face: "Rounded · semibold", math: "14 × 1.2⁴ = 29.0", role: "Empty-canvas headline, onboarding", sample: "Your canvas is ready.", cls: "ts-s-2xl" },
  { t: "xl", px: 24, lh: "1.22", face: "Display · semibold", math: "14 × 1.2³ = 24.2", role: "Home section, sheet heading", sample: "Recent projects", cls: "ts-s-xl" },
  { t: "lg", px: 20, lh: "1.30", face: "Display · semibold", math: "14 × 1.2² = 20.2", role: "Dialog title, project card", sample: "Share “Studio site”", cls: "ts-s-lg" },
  { t: "md", px: 17, lh: "1.40", face: "Text · regular", math: "14 × 1.2 = 16.8", role: "Lede, onboarding step", sample: "Ask AI for a first draft, or start drawing.", cls: "ts-s-md" },
  { t: "base", px: 14, lh: "1.45", face: "Text · regular", math: "the base", role: "Comments, AI chat replies, settings copy", sample: "Can we try the hero with a bigger photo? The current one feels small on desktop.", cls: "ts-s-base" },
  { t: "sm", px: 12, lh: "1.42", face: "Text · regular / semibold", math: "14 ÷ 1.2 = 11.7 → held at 12", role: "Panel rows, buttons, menu items", sample: "Homepage   Onboarding   Pricing", cls: "ts-s-sm" },
  { t: "xs", px: 11, lh: "1.36", face: "Text · semibold / regular", math: "14 ÷ 1.2² = 9.7 → floor 11", role: "Panel titles, hints, timestamps", sample: "Canvases · Edited 2 min ago by Jonas", cls: "ts-s-xs" },
];

export default function TypeScale() {
  const [show, setShow] = useState(true);

  return (
    <>
      <SpecimenHeader crumbs={["Type", "Scale"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Small in the chrome, generous on the canvas.</h1>
          <p className="lede">
            Eight sizes on a 1.2 ladder from 14 px. Panels speak in the two smallest, so they stay
            compact and quiet; AI's replies read at the base size. The big sizes wait for Home and for an empty canvas — the moments you
            are deciding what to make. One surface rarely needs more than three.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Base</dt><dd>14 px</dd></div>
          <div><dt>Ratio</dt><dd>1.2 (minor third)</dd></div>
          <div><dt>Faces</dt><dd>SF Pro · SF Pro Rounded (WebKit)</dd></div>
          <div><dt>Weights</dt><dd>--w-regular · --w-medium · --w-semibold</dd></div>
          <div><dt>Mono</dt><dd>Advanced only</dd></div>
        </dl>

        {/* ── Hero: sizes in the app ─────────────────────────────────────── */}
        <div className="ts-hero-hd">
          <h2 data-no>In the app<span className="h2-aside">panels use xs and sm; AI's replies read at base</span></h2>
          <label className="ts-switch-label">
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={show}
              aria-label="Show sizes"
              onClick={() => setShow((v) => !v)}
            />
            Show sizes
          </label>
        </div>

        <div className="stage ts-hero">
          <div className="ts-artboard">
            <span className="ts-ab-label"><Sized step="xs" show={show} side="top">Homepage — desktop</Sized></span>
            <div className="ts-ab-img" />
            <div className="ts-ab-body">
              <span className="ts-ab-h">Make room for what matters.</span>
              <span className="ts-ab-p">Studio site · hero draft</span>
            </div>
          </div>

          <div className="sticky sticky--yellow ts-sticky">
            <Sized step="base · Rounded" show={show} side="top">Bigger photo in the hero?</Sized>
          </div>

          <div className="island ts-comment">
            <span className="ts-avatar" aria-hidden="true">T</span>
            <div>
              <span className="ts-comment-name"><Sized step="xs · semibold" show={show}>Tereza</Sized></span>
              <span className="ts-comment-body"><Sized step="sm" show={show}>Love the new headline.</Sized></span>
            </div>
          </div>

          <div className="island ts-pill">
            <Mark size={22} />
            <Sized step="sm · semibold" show={show}>Studio site</Sized>
            <svg className="ts-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 6.5l3 3 3-3" /></svg>
          </div>

          <div className="island island--pad ts-list">
            <p className="island-title"><Sized step="xs · semibold" show={show}>Canvases</Sized></p>
            <div className="row-item" aria-current="true"><span className="thumb ts-th-sky" /><Sized step="sm · semibold" show={show}>Homepage</Sized></div>
            <div className="row-item"><span className="thumb ts-th-yellow" />Onboarding</div>
            <div className="row-item"><span className="thumb ts-th-green" />Pricing</div>
            <div className="row-item"><span className="thumb ts-th-lilac" />Mobile — detail</div>
          </div>

          <div className="island ts-tr">
            <button className="icon-btn" type="button" aria-label="Hide panels" aria-keyshortcuts="Meta+Backslash">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
            </button>
            <button className="btn btn--primary" type="button"><Sized step="sm · semibold" show={show} side="bottom-end">Share</Sized></button>
          </div>

          <div className="island island--pad ts-ai">
            <div className="ts-ai-hd"><Spark size={14} color="var(--spark)" /><Sized step="sm · Rounded" show={show}>AI</Sized></div>
            <p className="ts-ai-msg"><Sized step="base" show={show} side="top-end">Done — three hero variants are on the canvas. Pick one.</Sized></p>
            <div className="ask">
              <input aria-label="Ask AI" placeholder="Ask AI…" />
              <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
            </div>
          </div>

          <div className="island dock ts-dock" role="toolbar" aria-label="Toolbar">
            {TOOLS.map((t) => (
              <span className="ts-tool" key={t.name}>
                <button
                  className={`icon-btn${t.name === "Sticky" ? " ts-dock-hot" : ""}`}
                  type="button"
                  aria-pressed={t.name === "Select"}
                  aria-label={t.name}
                  aria-keyshortcuts={t.key}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.d} /></svg>
                </button>
                {t.name === "Sticky" ? (
                  <span className="ts-tip" role="tooltip">
                    <Sized step="xs" show={show} side="top">Sticky</Sized>
                    <span className="kbd">N</span>
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
        <p className="ts-caption">
          Inside the chrome two sizes do almost everything: 12 for rows and buttons, 11 for titles and
          hints. AI's replies are reading text, so they sit at 14. Stickies speak in Rounded — they
          belong to the canvas.
        </p>

        {/* Where the big sizes live */}
        <div className="ts-big">
          <section className="ts-home" aria-label="Home">
            <span className="ts-home-spark" aria-hidden="true"><Spark size={22} color="var(--spark)" /></span>
            <span className="ts-home-h"><Sized step="3xl · Rounded · tracking 0" show={show}>What shall we make?</Sized></span>
            <span className="ts-home-sub"><Sized step="xl · Display" show={show}>Recent projects</Sized></span>
            <div className="ts-cards">
              {[
                { n: "Studio site", m: "Edited 2 min ago · Tereza", c: "ts-th-sky" },
                { n: "Alligators brand", m: "Edited yesterday · Jonas", c: "ts-th-green" },
              ].map((p, i) => (
                <div className="ts-card" key={p.n}>
                  <div className={`ts-card-img ${p.c}`} />
                  <span className="ts-card-n">{i === 0 ? <Sized step="lg" show={show}>{p.n}</Sized> : p.n}</span>
                  <span className="ts-card-m">{i === 0 ? <Sized step="xs" show={show}>{p.m}</Sized> : p.m}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="ts-empty" aria-label="Empty canvas">
            <span className="ts-empty-spark" aria-hidden="true"><Spark size={22} color="var(--spark)" /></span>
            <span className="ts-empty-h"><Sized step="2xl · Rounded" show={show}>Your canvas is ready.</Sized></span>
            <span className="ts-empty-p"><Sized step="md" show={show}>Ask AI for a first draft, or start drawing.</Sized></span>
            <div className="ts-empty-actions">
              <button className="btn btn--spark" type="button"><Spark size={12} color="var(--spark-fg)" /> Ask AI</button>
              <button className="btn btn--ghost" type="button">Start drawing</button>
            </div>
          </section>
        </div>

        {/* ── The ladder ─────────────────────────────────────────────────── */}
        <h2 data-no>The ladder<span className="h2-aside">eight steps, one job each</span></h2>
        <div className="ts-ladder">
          {LADDER.map((s) => (
            <div className="ts-step" key={s.t}>
              <div className="ts-step-id">
                <strong>{s.t}</strong>
                <span>{s.px} / {s.lh}</span>
              </div>
              <div className={`ts-step-sample ${s.cls}`}>{s.sample}</div>
              <div className="ts-step-note">
                <span className="ts-step-role">{s.role}</span>
                <span>{s.face}</span>
                <span className="ts-step-math">{s.math}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="ts-caption">
          The two smallest steps are held at legible floors instead of following the ratio down — a
          true 1.2 step below 12 would be under 10 px, too small for a label you need to read at a glance.
        </p>

        {/* ── Faces ──────────────────────────────────────────────────────── */}
        <h2 data-no>Three faces, three jobs</h2>
        <div className="ts-faces">
          <div className="ts-face">
            <span className="ts-face-aa ts-f-display">Aa</span>
            <strong>SF Pro Display &amp; Text</strong>
            <p>The working voice. Display from 20 px up, Text below — on a Mac, system-ui picks the cut by size.</p>
            <span className="ts-face-ex ts-f-display">Share “Studio site”</span>
            <span className="ts-face-ex2">Anyone with the link can view.</span>
          </div>
          <div className="ts-face">
            <span className="ts-face-aa ts-f-rounded">Aa</span>
            <strong>SF Pro Rounded</strong>
            <p>For playful surfaces only: Home, empty states, onboarding, stickies and AI's name. Always at tracking 0.</p>
            <p className="ts-face-warn">WebKit only. Chrome and Firefox fall back to the body face, so judge Rounded in the app or Safari.</p>
            <div className="ts-face-play">
              <span className="sticky sticky--green ts-face-sticky">Move the CTA up</span>
              <span className="ts-agent-label"><Spark size={10} color="var(--spark-fg)" /> AI is sketching…</span>
            </div>
          </div>
          <div className="ts-face ts-face--adv">
            <span className="ts-face-aa ts-f-mono">Aa</span>
            <strong>SF Mono</strong>
            <p>Lives behind Advanced, never in the default view. Values you might copy, not words you read.</p>
            <details className="ts-adv" open>
              <summary>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                Advanced
              </summary>
              <dl className="ts-adv-rows">
                <div><dt>Canvas file</dt><dd>homepage.tsx</dd></div>
                <div><dt>Local server</dt><dd>127.0.0.1:4399</dd></div>
                <div><dt>Last saved</dt><dd>14:32:08</dd></div>
              </dl>
            </details>
          </div>
        </div>

        {/* ── Right / wrong ──────────────────────────────────────────────── */}
        <h2 data-no>Three sizes per surface<span className="h2-aside">hierarchy from a jump, not a gradient</span></h2>
        <div className="ts-compare">
          <figure className="ts-case">
            <div className="ts-case-box">
              <span className="ts-r-h">Nothing here yet</span>
              <span className="ts-r-p">This canvas is empty. Drop an image, add a sticky, or ask AI for a first draft.</span>
              <button className="btn btn--sm" type="button">Add a sticky</button>
            </div>
            <figcaption><strong className="ts-ok">Right</strong> Three sizes — 2xl, base, xs. Each level jumps two steps or more, so the order reads at once.</figcaption>
          </figure>
          <figure className="ts-case">
            <div className="ts-case-box ts-wrong">
              <span className="ts-w-eyebrow">MAUDE/HOMEPAGE · CANVAS · IDLE</span>
              <span className="ts-w-h">Nothing here yet</span>
              <span className="ts-w-sub">Empty canvas detected</span>
              <span className="ts-w-p">This canvas is empty. Drop an image, add a sticky, or ask AI for a first draft.</span>
              <span className="ts-w-meta">port 4399 · pid 81231</span>
            </div>
            <figcaption><strong className="ts-bad">Wrong</strong> Six sizes a step apart, a part-number eyebrow, mono everywhere and developer stamps in the default view.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · type scale</span>
        <span>Ratio 1.2 from 14 px · weights capped at --w-semibold</span>
      </footer>
    </>
  );
}
