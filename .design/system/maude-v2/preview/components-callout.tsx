/**
 * SPECIMEN — components-callout · maude-v2
 *
 * DEMONSTRATES: four callout tones — quiet note (no fill, --fg-2 icon), heads-up (--bg-3 fill,
 *               --status-warn icon), error (--bg-3 fill, --status-error icon, ONE action) and the
 *               AI suggestion (--spark-muted fill, the spark) · colour on the icon, ink on the
 *               words · --radius-md inside islands · the Details disclosure that keeps raw text.
 * COMPOSITION:  hero = a slice of the app with three callouts living where they belong: an
 *               offline note at the foot of the Canvases island, an export error inside the
 *               Export popover, an AI suggestion in the AI chat panel pointing at the headline it
 *               means · the four tones as anatomy cards · "say it like a person": developer
 *               messages rewritten, the original kept under Details · callout vs toast vs dialog ·
 *               four rules.
 * COPY VOICE:   the first words are the takeaway ("You're offline.", "Couldn't export Pricing.");
 *               the rest says what's safe and what you can do. No codes, no exclamation marks.
 * WHEN SCAFFOLDED: universal (default-on).
 * NOTES:        A callout is inline — it sits in the flow next to what it's about, and stays only
 *               while it's true. It is not a toast (comes and goes) and not a dialog (asks).
 *               No coloured side bars, no boxed hairlines: a soft fill and an icon do the work.
 */
import type { ReactNode } from "react";
import "./_layout.css";
import "./components-callout.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Tone = "quiet" | "heads" | "error" | "ai";

function ToneIcon({ tone, size = 16 }: { tone: Tone; size?: number }) {
  if (tone === "ai") return <span className="co-ico co-ico--ai"><Spark size={size - 2} color="var(--spark)" /></span>;
  return (
    <svg className={`co-ico co-ico--${tone}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tone === "quiet" && <><path d="M4.6 11.8h6.6a2.7 2.7 0 0 0 .4-5.4 3.6 3.6 0 0 0-6.9-.6A3 3 0 0 0 4.6 11.8z" /><path d="M2.5 2.5l11 11" /></>}
      {tone === "heads" && <><path d="M8 2.4l6.1 10.6H1.9z" /><path d="M8 6.6v2.8" /><circle cx="8" cy="11.3" r="0.4" fill="currentColor" /></>}
      {tone === "error" && <><circle cx="8" cy="8" r="6.2" /><path d="M6 6l4 4M10 6l-4 4" /></>}
    </svg>
  );
}

function Callout({ tone, title, children, action, details, className = "" }: { tone: Tone; title: string; children?: ReactNode; action?: ReactNode; details?: ReactNode; className?: string }) {
  return (
    <div className={`co co--${tone} ${className}`} role={tone === "error" ? "alert" : "note"}>
      <ToneIcon tone={tone} />
      <div className="co-body">
        <p className="co-text"><strong>{title}</strong>{children ? <> {children}</> : null}</p>
        {(action || details) && (
          <div className="co-foot">
            {action}
            {details}
          </div>
        )}
      </div>
    </div>
  );
}

const TONES: { tone: Tone; name: string; use: string; title: string; body: string; action?: string }[] = [
  { tone: "quiet", name: "Quiet note", use: "Something is true right now, and nothing needs doing.", title: "You're offline.", body: "Changes are kept on this Mac and sync when you're back." },
  { tone: "heads", name: "Heads-up", use: "It'll work, but you might want to look first.", title: "Jonas is editing this artboard.", body: "Your changes will land after his." },
  { tone: "error", name: "Error", use: "Something didn't happen. Say why, offer one way forward.", title: "Couldn't export Pricing.", body: "A font isn't on this Mac.", action: "Use a similar font" },
  { tone: "ai", name: "AI suggestion", use: "AI noticed something and can fix it, if you want.", title: "The headline is hard to read on the photo.", body: "A slightly darker photo would fix it.", action: "Fix it" },
];

const REWRITES = [
  { raw: "WebSocket closed (1006). Reconnecting in 4s…", human: "Connection lost. Trying again…", tone: "quiet" as Tone },
  { raw: "SYNC_DIVERGED: local ahead by 3, remote ahead by 1", human: "Your copy and Tereza's both changed. Pick which to keep.", tone: "heads" as Tone },
  { raw: "ENOENT: no such file .design/ui/pricing.tsx", human: "Pricing was moved or deleted in Finder. Find it to keep working.", tone: "error" as Tone },
  { raw: "hub 401 Unauthorized (token expired)", human: "Your sign-in expired. Sign in again to keep syncing.", tone: "error" as Tone },
];

export default function ComponentsCallout() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Callouts"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>A quiet sentence in the flow, right next to what it's about.</h1>
          <p className="lede">
            Callouts tell you how your work is doing in plain words. When nothing needs doing they're
            barely there. When something went wrong they say why and offer one way forward. When AI
            has an idea, the spark says so.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Fill</dt><dd>none · --bg-3 · --spark-muted</dd></div>
          <div><dt>Colour</dt><dd>on the icon, never the words</dd></div>
          <div><dt>Actions</dt><dd>one at most</dd></div>
          <div><dt>Raw text</dt><dd>kept under Details</dd></div>
        </dl>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <h2 data-no>Where they live<span className="h2-aside">inside the island they're about, never floating on their own</span></h2>
        <div className="stage co-hero">
          <div className="co-board">
            <div className="co-board-img"><span className="co-headline">Plans for every studio</span><span className="co-ai-mark" aria-hidden="true" /></div>
            <div className="co-board-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
          </div>

          <div className="sticky sticky--green co-st1">Use the new photo</div>
          <div className="sticky sticky--lilac co-st2">Ask Tereza about the fonts</div>

          <div className="island co-pill"><Mark size={22} /><span>Studio site</span><svg className="co-caret" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg></div>

          <div className="island island--pad co-list">
            <p className="island-title">Canvases</p>
            <div className="row-item" aria-current="true"><span className="thumb co-th-sky" aria-hidden="true" />Homepage</div>
            <div className="row-item"><span className="thumb co-th-yellow" aria-hidden="true" />Onboarding</div>
            <div className="row-item"><span className="thumb co-th-coral" aria-hidden="true" />Pricing</div>
            <div className="row-item"><span className="thumb co-th-lilac" aria-hidden="true" />Mobile — detail</div>
            <Callout tone="quiet" title="You're offline." className="co-in-list">Changes are kept on this Mac.</Callout>
          </div>

          <div className="island co-tr">
            <button className="btn btn--ghost co-export-on" type="button" aria-expanded="true">Export</button>
            <button className="btn btn--primary" type="button">Share</button>
          </div>
          <div className="co-pop" role="dialog" aria-label="Export Pricing">
            <div className="co-pop-hd"><strong>Export “Pricing”</strong><span className="chip">PDF</span></div>
            <Callout
              tone="error"
              title="Couldn't export Pricing."
              action={<button className="btn btn--sm" type="button">Use a similar font</button>}
              details={<details className="co-details"><summary>Details</summary><code>font "Söhne Buch" not found · pricing.pdf</code></details>}
            >
              The headline font isn't on this Mac.
            </Callout>
            <div className="co-pop-ft"><button className="btn btn--ghost btn--sm" type="button">Cancel</button><button className="btn btn--primary btn--sm" type="button" disabled>Export</button></div>
          </div>

          <div className="island island--pad co-ai" role="region" aria-label="AI chat panel">
            <div className="co-ai-hd"><Spark size={14} color="var(--spark)" /> AI</div>
            <p className="co-ai-msg">Done — the hero now uses the new photo.</p>
            <Callout
              tone="ai"
              title="The headline is hard to read on the photo."
              action={<button className="btn btn--spark btn--sm" type="button">Fix it</button>}
            >
              A slightly darker photo behind it would fix it.
            </Callout>
            <div className="ask">
              <input aria-label="Ask AI" placeholder="Ask AI…" />
              <span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
            </div>
          </div>
        </div>
        <div className="co-hero-notes">
          <p><strong>Offline</strong> is a fact, not a problem — a quiet line at the foot of the list, no colour, no button.</p>
          <p><strong>The export error</strong> says why in words you'd use, offers the one fix, and keeps the raw message under Details.</p>
          <p><strong>AI's idea</strong> carries the spark, points at the headline it means and offers one action. Ignoring it is fine — it clears once the headline changes.</p>
        </div>

        {/* ── Four tones ───────────────────────────────────────────────── */}
        <h2 data-no>Four tones<span className="h2-aside">from barely there to “here's a fix”</span></h2>
        <div className="co-tones">
          {TONES.map((t) => (
            <div className="co-tone" key={t.tone}>
              <div className="co-tone-demo">
                <Callout
                  tone={t.tone}
                  title={t.title}
                  action={t.action ? <button className={`btn btn--sm${t.tone === "ai" ? " btn--spark" : ""}`} type="button">{t.action}</button> : undefined}
                >
                  {t.body}
                </Callout>
              </div>
              <div className="co-tone-meta">
                <strong>{t.name}</strong>
                <span>{t.use}</span>
                <code>{t.tone === "quiet" ? "no fill · --fg-2 icon" : t.tone === "heads" ? "--bg-3 · --status-warn icon" : t.tone === "error" ? "--bg-3 · --status-error icon" : "--spark-muted · spark"}</code>
              </div>
            </div>
          ))}
        </div>

        {/* ── Rewrites ─────────────────────────────────────────────────── */}
        <h2 data-no>Say it like a person<span className="h2-aside">the original message isn't thrown away — it moves under Details</span></h2>
        <div className="co-rewrites">
          {REWRITES.map((r) => (
            <div className="co-rw" key={r.raw}>
              <code className="co-rw-raw">{r.raw}</code>
              <span className="co-rw-arrow" aria-hidden="true">→</span>
              <span className="co-rw-human"><ToneIcon tone={r.tone} size={14} />{r.human}</span>
            </div>
          ))}
        </div>
        <div className="co-detail-demo">
          <Callout
            tone="error"
            title="Your sign-in expired."
            action={<button className="btn btn--sm" type="button">Sign in again</button>}
            details={<details className="co-details" open><summary>Details</summary><code>hub 401 Unauthorized (token expired) · studio-site</code></details>}
          >
            Sign in again to keep syncing Studio site.
          </Callout>
          <p>Details is closed by default. Open it and the exact message is there to copy into a bug report — mono type appears only inside it.</p>
        </div>

        {/* ── Callout vs toast vs dialog ──────────────────────────────── */}
        <h2 data-no>Callout, toast or dialog<span className="h2-aside">how long it stays decides which</span></h2>
        <div className="co-which">
          <div className="co-w">
            <div className="co-w-art co-w-art--callout" aria-hidden="true"><span className="co-w-panel"><span /><span /><span className="co-w-note" /></span></div>
            <strong>Callout</strong>
            <span>Stays while it's true, inside the thing it's about. “You're offline.”</span>
          </div>
          <div className="co-w">
            <div className="co-w-art co-w-art--toast" aria-hidden="true"><span className="co-w-toast" /></div>
            <strong>Toast</strong>
            <span>Says something happened, then goes. “Saved.” “Exported to Downloads.”</span>
          </div>
          <div className="co-w">
            <div className="co-w-art co-w-art--dialog" aria-hidden="true"><span className="co-w-veil" /><span className="co-w-sheet" /></div>
            <strong>Dialog</strong>
            <span>Needs a decision before anything else happens. “Move “Onboarding” to the trash?”</span>
          </div>
        </div>

        <div className="co-rules">
          <div><strong>One action, at most</strong><span>If there are two ways forward, the second goes into a menu. No “Leave it” button — a callout clears itself.</span></div>
          <div><strong>No boxes, no bars</strong><span>A soft fill and an icon. Coloured side stripes and hairline frames are not used.</span></div>
          <div><strong>Quiet when it's fine</strong><span>If nothing needs doing, no fill and no colour — just the sentence.</span></div>
          <div><strong>The spark is AI</strong><span>Only a suggestion from AI wears it. A warning never does.</span></div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · callouts</span>
        <span>The takeaway first, then what's safe, then one way forward</span>
      </footer>
    </>
  );
}
