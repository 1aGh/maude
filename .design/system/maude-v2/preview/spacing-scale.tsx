/**
 * SPECIMEN — spacing-scale · maude-v2
 *
 * DEMONSTRATES: --space-0 … --space-8 — an 8 px rhythm with a 4 px half-step.
 * COMPOSITION:  hero = the anatomy of a real island and the dock at true size, with a
 *               measured overlay (padding bands, gap bands, row height) you can switch off;
 *               then the scale laid on an 8 px ruler so every step reads as a count of
 *               eights; inline / stack / inset shown on Maude's own surfaces (the Ask field,
 *               the Share sheet, a window); and the one place the half-step sets the rhythm —
 *               a dense Advanced section next to the airy default.
 * COPY VOICE:   short role labels in everyday words ("island padding", "inset from the window").
 * NOTES:        Islands are compact outside, airy inside. 4 px is a joint inside a control
 *               (chip, dock gaps, row padding); as the rhythm BETWEEN rows it only appears
 *               in Advanced.
 */
import { useState } from "react";
import "./_layout.css";
import "./spacing-scale.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/** A real spacer in the layout — invisible normally, a measured band when the overlay is on. */
function Gap({ step, on, label, axis = "y" }: { step: 1 | 2 | 3 | 4 | 5; on: boolean; label?: string; axis?: "x" | "y" }) {
  return (
    <span className={`sp-gap sp-gap--${axis} sp-s${step}`} data-on={on} aria-hidden="true">
      {on && label ? <i className="sp-tag sp-tag--side">{label}</i> : null}
    </span>
  );
}

const SCALE = [
  { t: "--space-0", px: 0, u: "0", role: "Reset — nothing between", cls: "sp-b0" },
  { t: "--space-1", px: 4, u: "½", role: "Half-step — joints inside a control: chip icon to label, gaps in the dock, row padding", cls: "sp-b1", half: true },
  { t: "--space-2", px: 8, u: "1", role: "Inline gap — icon and label, dock padding, island title to first row", cls: "sp-b2" },
  { t: "--space-3", px: 12, u: "1½", role: "Island padding — the inside of every island", cls: "sp-b3" },
  { t: "--space-4", px: 16, u: "2", role: "Inset — islands from the window edge; stack gap in a sheet", cls: "sp-b4" },
  { t: "--space-5", px: 24, u: "3", role: "Layout gutter — the Home grid, groups inside a sheet", cls: "sp-b5" },
  { t: "--space-6", px: 32, u: "4", role: "Sheet margins, space above a Home section", cls: "sp-b6" },
  { t: "--space-7", px: 48, u: "6", role: "Between Home sections", cls: "sp-b7" },
  { t: "--space-8", px: 64, u: "8", role: "First-run and empty-canvas breathing room", cls: "sp-b8" },
];

const STICKIES = ["yellow", "green", "lilac"];

export default function SpacingScale() {
  const [on, setOn] = useState(true);

  return (
    <>
      <SpecimenHeader crumbs={["Space", "Spacing scale"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Eights, with a half-step for tight joints.</h1>
          <p className="lede">
            Every distance in Maude is a count of eight pixels. Islands stay compact on the outside and
            airy on the inside, so a small panel still feels calm. The 4 px half-step holds the joints
            inside a control together — and only becomes the rhythm in Advanced, where density helps.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Rhythm</dt><dd>8 px</dd></div>
          <div><dt>Half-step</dt><dd>4 px — joints, and Advanced rows</dd></div>
          <div><dt>Island padding</dt><dd>12 px</dd></div>
          <div><dt>Inset from the window</dt><dd>16 px</dd></div>
        </dl>

        {/* ── Hero: anatomy ──────────────────────────────────────────────── */}
        <div className="sp-hero-hd">
          <h2 data-no>Anatomy of an island<span className="h2-aside">true size · measured</span></h2>
          <label className="sp-switch-label">
            <button type="button" className="switch" role="switch" aria-checked={on} aria-label="Show spacing" onClick={() => setOn((v) => !v)} />
            Show spacing
          </label>
        </div>

        <div className="stage sp-hero">
          <div className="sp-hero-inner">
            <figure className="sp-piece">
              <div className="island island--pad sp-isl" data-on={on}>
                {on ? (
                  <>
                    <span className="sp-pad sp-pad--t" aria-hidden="true" />
                    <span className="sp-pad sp-pad--b" aria-hidden="true" />
                    <span className="sp-pad sp-pad--l" aria-hidden="true" />
                    <span className="sp-pad sp-pad--r" aria-hidden="true" />
                    <i className="sp-tag sp-tag--top">12</i>
                    <i className="sp-tag sp-tag--left">12</i>
                  </>
                ) : null}
                <p className="island-title sp-title">Canvases</p>
                <Gap step={2} on={on} label="8" />
                <div className="row-item sp-row" aria-current="true">
                  <span className="thumb sp-th-coral" />
                  <Gap step={2} on={on} axis="x" />
                  Homepage
                  {on ? <i className="sp-tag sp-tag--row">row 30</i> : null}
                </div>
                <div className="row-item sp-row"><span className="thumb sp-th-yellow" /><Gap step={2} on={false} axis="x" />Onboarding</div>
                <div className="row-item sp-row"><span className="thumb sp-th-green" /><Gap step={2} on={false} axis="x" />Pricing</div>
                <div className="row-item sp-row"><span className="thumb sp-th-lilac" /><Gap step={2} on={false} axis="x" />Mobile — detail</div>
              </div>
              <figcaption>Canvases island · 12 inside, 8 under the title, rows 30 tall with 4 × 8 padding</figcaption>
            </figure>

            <figure className="sp-piece">
              <div className="island dock sp-dock" data-on={on}>
                {on ? (
                  <>
                    <span className="sp-pad sp-pad--t sp-pad--8" aria-hidden="true" />
                    <span className="sp-pad sp-pad--b sp-pad--8" aria-hidden="true" />
                    <span className="sp-pad sp-pad--l sp-pad--8" aria-hidden="true" />
                    <span className="sp-pad sp-pad--r sp-pad--8" aria-hidden="true" />
                    <i className="sp-tag sp-tag--top">8</i>
                  </>
                ) : null}
                <button className="icon-btn" type="button" aria-pressed="true" aria-label="Select">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
                </button>
                <Gap step={1} on={on} axis="x" />
                <button className="icon-btn" type="button" aria-label="Frame">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h12M2 11h12M5 2v12M11 2v12" /></svg>
                </button>
                <Gap step={1} on={on} axis="x" />
                <button className="icon-btn" type="button" aria-label="Text">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M8 4v9" /></svg>
                </button>
                <Gap step={1} on={on} axis="x" />
                <span className="divider-v" />
                <Gap step={1} on={on} axis="x" />
                {STICKIES.map((c, i) => (
                  <span key={c} className="sp-dock-slot">
                    {i > 0 ? <Gap step={1} on={on} axis="x" /> : null}
                    <button className="icon-btn" type="button" aria-label={`${c} sticky`}>
                      <span className={`sp-dock-sticky sp-ds-${c}`} style={{ rotate: `${[-6, 4, -3][i]}deg` }} />
                    </button>
                  </span>
                ))}
                {on ? <i className="sp-tag sp-tag--under">button 40 · gap 4</i> : null}
              </div>
              <figcaption>Dock · 8 around, 4 between, 40 per button — a little chunkier than the other islands</figcaption>
            </figure>
          </div>
        </div>

        <ul className="sp-legend">
          <li><span className="sp-key sp-key--pad" />Padding — the inside of an island or the dock</li>
          <li><span className="sp-key sp-key--gap" />Gap — space between two things</li>
          <li><span className="sp-key sp-key--row" />Row height — set by the row's own padding</li>
        </ul>

        {/* ── The scale ──────────────────────────────────────────────────── */}
        <h2 data-no>The scale<span className="h2-aside">each step is a count of eights</span></h2>
        <div className="sp-scale">
          {SCALE.map((s) => (
            <div className={`sp-step${s.half ? " sp-step--half" : ""}`} key={s.t}>
              <div className="sp-step-id">
                <strong>{s.t}</strong>
                <span>{s.px} px</span>
              </div>
              <div className="sp-ruler" aria-hidden="true"><span className={`sp-bar ${s.cls}`} /></div>
              <span className="sp-units">× {s.u}</span>
              <span className="sp-role">{s.role}</span>
            </div>
          ))}
        </div>

        {/* ── Inline · stack · inset ─────────────────────────────────────── */}
        <h2 data-no>Inline, stack, inset<span className="h2-aside">the same steps, three directions</span></h2>
        <div className="sp-three">
          <figure className="sp-demo">
            <div className="sp-demo-area">
              <div className="island island--pad sp-askwrap">
                <div className="ask sp-ask" data-on={on}>
                  <span className="chip chip--accent">◆ hero</span>
                  <Gap step={2} on={on} axis="x" />
                  <input aria-label="Ask AI" placeholder="Ask AI…" />
                  <Gap step={2} on={on} axis="x" />
                  <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
                </div>
              </div>
            </div>
            <figcaption><strong>Inline · 8</strong> Things that read as one line sit eight apart: a chip, the Ask field, the send button.</figcaption>
          </figure>

          <figure className="sp-demo">
            <div className="sp-demo-area">
              <div className="island sp-sheet">
                <span className="sp-sheet-h">Share “Studio site”</span>
                <Gap step={2} on={on} label="8" />
                <span className="sp-sheet-p">Anyone with the link can view. Invite people to edit.</span>
                <Gap step={4} on={on} label="16" />
                <div className="sp-invite">
                  <input className="input" aria-label="Invite by email" placeholder="Invite by email" />
                  <button className="btn btn--primary" type="button">Invite</button>
                </div>
                <Gap step={4} on={on} label="16" />
                <div className="sp-people">
                  <div className="sp-person"><span className="sp-av">T</span>Tereza<span className="sp-role-chip">Can edit</span></div>
                  <Gap step={2} on={on} label="8" />
                  <div className="sp-person"><span className="sp-av">J</span>Jonas<span className="sp-role-chip">Can view</span></div>
                </div>
              </div>
            </div>
            <figcaption><strong>Stack · 16 / 8</strong> Groups sixteen apart, lines inside a group eight apart. The jump is what groups them.</figcaption>
          </figure>

          <figure className="sp-demo">
            <div className="sp-demo-area sp-window" data-on={on}>
              {on ? <span className="sp-inset" aria-hidden="true"><i className="sp-tag sp-tag--inset">16</i></span> : null}
              <div className="island sp-w-pill"><Mark size={16} /><span>Homepage</span></div>
              <div className="island sp-w-tr"><span className="sp-w-share">Share</span></div>
              <div className="island dock sp-w-dock">
                <span className="sp-w-dot" /><span className="sp-w-dot" /><span className="sp-w-dot" />
              </div>
              <div className="island sp-w-ai"><Spark size={12} color="var(--spark)" /></div>
            </div>
            <figcaption><strong>Inset · 16</strong> Every island floats sixteen from the window edge. Nothing touches the frame.</figcaption>
          </figure>
        </div>

        {/* ── Half-step in Advanced ──────────────────────────────────────── */}
        <h2 data-no>Airy by default, dense in Advanced<span className="h2-aside">where the half-step sets the rhythm</span></h2>
        <div className="sp-density">
          <figure className="sp-dens-case">
            <div className="island sp-settings">
              <p className="island-title">Canvas</p>
              <div className="sp-set-row"><span>Background</span><span className="seg" role="group" aria-label="Background"><button type="button" aria-pressed="true">Dots</button><button type="button" aria-pressed="false">Plain</button></span></div>
              <div className="sp-set-row"><span>Snap to dots</span><button type="button" className="switch" role="switch" aria-checked="true" aria-label="Snap to dots" /></div>
              <div className="sp-set-row"><span>Show comments</span><button type="button" className="switch" role="switch" aria-checked="false" aria-label="Show comments" /></div>
              <div className="sp-adv-hd">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                Advanced
              </div>
            </div>
            <figcaption><strong>Default</strong> Rows 32 tall, 8 apart, 12 inside. Room to breathe; three choices you actually use.</figcaption>
          </figure>

          <figure className="sp-dens-case">
            <div className="island sp-settings">
              <p className="island-title">Canvas</p>
              <div className="sp-set-row"><span>Background</span><span className="seg" role="group" aria-label="Background"><button type="button" aria-pressed="true">Dots</button><button type="button" aria-pressed="false">Plain</button></span></div>
              <div className="sp-set-row"><span>Snap to dots</span><button type="button" className="switch" role="switch" aria-checked="true" aria-label="Snap to dots" /></div>
              <div className="sp-set-row"><span>Show comments</span><button type="button" className="switch" role="switch" aria-checked="false" aria-label="Show comments" /></div>
              <div className="sp-adv-hd sp-adv-hd--open">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                Advanced
              </div>
              <dl className="sp-adv">
                <div><dt>Dot spacing</dt><dd>20</dd></div>
                <div><dt>Canvas file</dt><dd>homepage.tsx</dd></div>
                <div><dt>Artboards</dt><dd>6</dd></div>
                <div><dt>Local server</dt><dd>127.0.0.1:4399</dd></div>
                <div><dt>Autosave</dt><dd>on change</dd></div>
              </dl>
            </div>
            <figcaption><strong>Advanced open</strong> Rows 24 tall, 4 apart, values in mono. Dense on purpose — and only behind the disclosure.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · spacing</span>
        <span>8 px rhythm · 4 px half-step · islands inset 16 from the window</span>
      </footer>
    </>
  );
}
