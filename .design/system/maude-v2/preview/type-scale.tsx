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

/* The Edit toolbar, in CONTRACT §2 order (V H F R P T I ⇧I) — glyphs verbatim from iconography.tsx. */
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
                  className={`icon-btn${t.name === "Image" ? " ts-dock-hot" : ""}`}
                  type="button"
                  aria-pressed={t.name === "Select"}
                  aria-label={t.name}
                  aria-keyshortcuts={t.key.replace("⇧", "Shift+")}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.d}</svg>
                </button>
                {t.name === "Image" ? (
                  <span className="ts-tip" role="tooltip">
                    <Sized step="xs" show={show} side="top">Image</Sized>
                    <span className="kbd">I</span>
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
