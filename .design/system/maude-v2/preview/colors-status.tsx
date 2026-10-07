/**
 * SPECIMEN — colors-status · maude-v2
 *
 * DEMONSTRATES: --status-success, --status-warn, --status-error, --status-info — and the
 *   line between --status-error (hue 22) and --spark (hue 36, the AI). Close hues, opposite
 *   meanings, so neither may ever lean on colour alone.
 * COMPOSITION: hero = a slice of the app where an export fails while the AI is working on the
 *   same canvas, with a "Hide colour" switch that drains all hue so you can check the two
 *   still read apart by glyph, word and place. Beside it, a four-point "tell them apart" key.
 *   Then the four states, the three forms status takes (row · toast · field), the
 *   "colour on the icon, ink on the word" rule, and three wrong turns.
 * COPY VOICE: says what happened to the user's work ("Couldn't export Pricing"), offers the
 *   next step ("Try again"), never shouts, no exclamation marks, no codes.
 * WHEN SCAFFOLDED: status family (always for maude-v2).
 * NOTES: Status is separate from azure — azure says "do this", status says "this happened".
 *   And separate from the spark — the spark is never an error, a warning or a "New" badge.
 */
import { useState } from "react";
import "./_layout.css";
import "./colors-status.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

type Kind = "success" | "warn" | "error" | "info";

function StatusIcon({ kind, size = 16 }: { kind: Kind; size?: number }) {
  return (
    <svg className={`st-ico st-ico-${kind}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "warn" ? <path d="M8 2.4l6.1 10.6H1.9z" /> : <circle cx="8" cy="8" r="6.2" />}
      {kind === "success" && <path d="M5.4 8.2l1.8 1.8 3.4-3.7" />}
      {kind === "warn" && <><path d="M8 6.6v2.8" /><circle cx="8" cy="11.3" r="0.4" fill="currentColor" /></>}
      {kind === "error" && <path d="M6 6l4 4M10 6l-4 4" />}
      {kind === "info" && <><path d="M8 7.4v3.6" /><circle cx="8" cy="5.2" r="0.4" fill="currentColor" /></>}
    </svg>
  );
}

const STATES: { kind: Kind; name: string; means: string; says: string[] }[] = [
  { kind: "success", name: "Success", means: "It worked, and it's kept.", says: ["Saved", "Synced with Tereza", "Exported to Downloads"] },
  { kind: "warn", name: "Warning", means: "It'll work, but look first.", says: ["Low on space for versions", "Jonas is editing this frame", "Fonts substituted"] },
  { kind: "error", name: "Error", means: "It didn't happen. Here's the next step.", says: ["Couldn't export Pricing", "Couldn't sync — you're offline", "That link has expired"] },
  { kind: "info", name: "Info", means: "Worth knowing, nothing to fix.", says: ["New version from Tereza", "Shared with 3 people", "Comments are on"] },
];

const KEY = [
  { k: "Glyph", ai: "the spark", err: "a circle with a cross" },
  { k: "Word", ai: "“AI …”", err: "“Couldn't …”" },
  { k: "Place", ai: "on the work it's doing", err: "next to what failed" },
  { k: "Hue", ai: "36 · vermilion", err: "22 · red — too close to trust alone" },
];

export default function ColorsStatus() {
  const [mono, setMono] = useState(false);
  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Status"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Status says what happened. The spark says who's at work.</h1>
          <p className="lede">
            Four status colours, each always paired with an icon and a plain sentence. They tell you how
            your work is doing. The spark is something else entirely — it marks the AI, and an error is
            never dressed in it.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Success</dt><dd>hue 152</dd></div>
          <div><dt>Warning</dt><dd>hue 78</dd></div>
          <div><dt>Error</dt><dd>hue 22</dd></div>
          <div><dt>Info</dt><dd>hue 250</dd></div>
          <div><dt>Spark (not status)</dt><dd>hue 36</dd></div>
        </dl>

        {/* ── Hero: error vs spark ───────────────────────────────────────── */}
        <h2 data-no>The spark is never an error<span className="h2-aside">same canvas, same moment — drain the colour and check</span></h2>
        <div className="st-hero">
          <div className={`stage st-stage${mono ? " st-mono" : ""}`}>
            <div className="st-ab-label">Pricing</div>
            <div className="st-artboard">
              <div className="st-plans">
                <div className="st-plan"><b>Free</b><span>For trying it out</span></div>
                <div className="st-plan st-plan-ai">
                  <b>Pro</b><span className="st-skel" /><span className="st-skel st-skel--short" />
                </div>
                <div className="st-plan"><b>Team</b><span>For studios</span></div>
              </div>
            </div>
            <div className="st-agent" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke="var(--bg-2)" strokeWidth="1" /></svg>
              <span><Spark size={10} color="var(--spark-fg)" /> AI is writing the Pro plan</span>
            </div>

            <div className="island st-toast" role="status">
              <StatusIcon kind="error" />
              <span className="st-toast-msg"><b>Couldn't export Pricing.</b> The file is still open in another app.</span>
              <button className="btn btn--ghost btn--sm" type="button">Try again</button>
            </div>
          </div>

          <aside className="st-key">
            <div className="st-key-hd">
              <span>Tell them apart</span>
              <label className="st-switch-l">
                <button type="button" role="switch" aria-checked={mono} className="switch" onClick={() => setMono((v) => !v)} aria-label="Hide colour" />
                Hide colour
              </label>
            </div>
            <div className={`st-pair${mono ? " st-mono" : ""}`}>
              <span className="st-pair-ai"><Spark size={14} color="var(--spark)" /> AI is working</span>
              <span className="st-pair-err"><StatusIcon kind="error" /> Couldn't export</span>
            </div>
            <dl className="st-key-list">
              {KEY.map((r) => (
                <div key={r.k}>
                  <dt>{r.k}</dt>
                  <dd><span className="st-k-ai">{r.ai}</span><span className="st-k-err">{r.err}</span></dd>
                </div>
              ))}
            </dl>
            <p>With the colour gone, the spark is still the AI and the cross is still the failure. That is the test every status must pass.</p>
          </aside>
        </div>

        {/* ── Four states ────────────────────────────────────────────────── */}
        <h2 data-no>Four states<span className="h2-aside">the colour names the outcome, the sentence explains it</span></h2>
        <div className="st-states">
          {STATES.map((s) => (
            <div className={`st-state st-state-${s.kind}`} key={s.kind}>
              <span className="st-state-bar" />
              <div className="st-state-hd"><StatusIcon kind={s.kind} size={18} /><strong>{s.name}</strong><code>--status-{s.kind}</code></div>
              <p>{s.means}</p>
              <ul>{s.says.map((w) => <li key={w}><StatusIcon kind={s.kind} size={12} />{w}</li>)}</ul>
            </div>
          ))}
        </div>

        {/* ── Forms ──────────────────────────────────────────────────────── */}
        <h2 data-no>Where status shows up<span className="h2-aside">a row, a toast, a field — always beside the thing it's about</span></h2>
        <div className="stage st-forms">
          <div className="island island--pad st-list">
            <p className="island-title">Canvases</p>
            <div className="row-item" aria-current="true"><span className="thumb st-th-coral" />Homepage</div>
            <div className="row-item"><span className="thumb st-th-yellow" />Onboarding<span className="st-row-s"><StatusIcon kind="success" size={14} />Synced</span></div>
            <div className="row-item"><span className="thumb st-th-green" />Pricing<span className="st-row-s"><StatusIcon kind="error" size={14} />Couldn't sync</span></div>
            <div className="row-item"><span className="thumb st-th-lilac" />Mobile — detail<span className="st-row-s"><StatusIcon kind="info" size={14} />New version</span></div>
          </div>

          <div className="island island--pad st-share">
            <p className="island-title">Share “Pricing”</p>
            <div className="field">
              <label className="field-label" htmlFor="st-invite">Invite by email</label>
              <input id="st-invite" className="input st-input-err" defaultValue="tereza@studio" aria-invalid="true" aria-describedby="st-invite-hint" />
              <span className="field-hint st-hint-err" id="st-invite-hint"><StatusIcon kind="error" size={12} />That email is missing its ending, like .com</span>
            </div>
            <span className="st-warn-line"><StatusIcon kind="warn" size={14} />Jonas is editing this frame right now</span>
          </div>

          <div className="island st-toast st-toast--ok" role="status">
            <StatusIcon kind="success" />
            <span className="st-toast-msg"><b>Saved.</b> Version 12 is in version history.</span>
          </div>
        </div>

        {/* ── Rule ───────────────────────────────────────────────────────── */}
        <h2 data-no>Colour on the icon, ink on the word</h2>
        <div className="st-rule">
          <div className="st-rule-row st-rule-ok">
            <span className="st-rule-tag">Right</span>
            <span className="st-line"><StatusIcon kind="warn" />Fonts substituted on 2 artboards</span>
            <span className="st-line"><StatusIcon kind="success" />Exported to Downloads</span>
          </div>
          <div className="st-rule-row st-rule-bad">
            <span className="st-rule-tag">Wrong</span>
            <span className="st-line st-tinted-warn">Fonts substituted on 2 artboards</span>
            <span className="st-line st-tinted-ok">Exported to Downloads</span>
          </div>
          <p>Amber and green text is hard to read on a light island. Keep the sentence in ink and let the icon carry the colour — it reads the same in both themes.</p>
        </div>

        {/* ── Wrong turns ────────────────────────────────────────────────── */}
        <h2 data-no>Three wrong turns</h2>
        <div className="st-wrong">
          <figure className="st-case">
            <div className="st-case-box"><span className="st-dot-only" />Pricing</div>
            <figcaption><strong className="st-bad">A dot alone</strong> Red what? With no word, half your readers guess and the rest miss it.</figcaption>
          </figure>
          <figure className="st-case">
            <div className="st-case-box st-spark-err"><Spark size={12} color="var(--spark)" />Couldn't export Pricing</div>
            <figcaption><strong className="st-bad">An error in the spark</strong> Now the AI looks broken, and the next real AI moment looks like a failure.</figcaption>
          </figure>
          <figure className="st-case">
            <div className="st-case-box">Version history <span className="chip chip--spark">New</span></div>
            <figcaption><strong className="st-bad">A spark “New” badge</strong> The spark is the AI, not a highlighter. News is info.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · status colours</span>
        <span>Every status: an icon, a sentence, a place</span>
      </footer>
    </>
  );
}
