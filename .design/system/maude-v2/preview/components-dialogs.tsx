/**
 * SPECIMEN — components-dialogs · maude-v2
 *
 * DEMONSTRATES: --bg-2 sheet surface · --radius-xl · --shadow-lg + --island-edge · the canvas-tone
 *               veil (--bg-0 at about half strength, never black) · --dur-panel open · --status-error
 *               on the one destructive verb · the Advanced disclosure that keeps every capability.
 * COMPOSITION:  hero = the Share sheet opened from the Share button on its island, over a dimmed
 *               canvas: one primary ("Copy link") and "Invite people" inside the sheet; the three
 *               link types (web link, app link, this-Mac link) + invite by GitHub username under
 *               Advanced — live toggle, nothing removed · confirm dialogs in plain words with a keep-or-kill copy
 *               panel · the "Sign in as another account…" flow for one project tab, as three
 *               frames · anatomy + three rules.
 * COPY VOICE:   per CONTRACT.md §4 — the title asks with the same verb as the primary button
 *               ("Move “Onboarding” to the trash?" → Move to trash), the other button is Cancel,
 *               the body says what happens to your work. Never "OK", never "we".
 * WHEN SCAFFOLDED: universal (default-on).
 * NOTES:        A sheet opens from the island that asked for it and floats one plane higher
 *               (--shadow-lg). Only a sheet that needs a decision gets the veil; menus and
 *               popovers never do. Esc and click-away close it unless something would be lost.
 */
import { useState } from "react";
import "./_layout.css";
import "./components-dialogs.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`dg-chev${open ? " dg-chev--open" : ""}`} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M7 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8" />
      <path d="M9 6.8a2.6 2.6 0 0 0-3.7 0L3.2 8.9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="2" />
      <path d="M3 10.5V4.5A1.5 1.5 0 0 1 4.5 3h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function Caret() {
  return (
    <svg className="dg-caret-ico" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function Avatar({ name, tone }: { name: string; tone: "sky" | "green" | "lilac" | "you" }) {
  return <span className={`dg-av dg-av--${tone}`} aria-hidden="true">{name.slice(0, 1)}</span>;
}

/** A small canvas scene that sits under every veil, so the dialog is always seen over real work. */
function Scene({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <div className={`dg-board${compact ? " dg-board--sm" : ""}`}>
        <div className="dg-board-img" />
        <div className="dg-board-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
      </div>
      {!compact && <div className="sticky sticky--yellow dg-st1">Bigger photo in the hero?</div>}
      {!compact && <div className="sticky sticky--sky dg-st2">Ask Jonas about the footer</div>}
    </>
  );
}

function ShareSheet() {
  const [adv, setAdv] = useState(true);
  return (
    <div className="dg-sheet dg-share" role="dialog" aria-modal="true" aria-labelledby="dg-share-t">
      <div className="dg-sheet-hd">
        <h3 id="dg-share-t">Share “Homepage”</h3>
        <button className="icon-btn dg-close" type="button" aria-label="Close"><CloseIcon /></button>
      </div>

      <div className="dg-invite">
        <input className="input" aria-label="Invite people by email" placeholder="Add people by email" />
        <button className="btn" type="button">Invite people</button>
      </div>

      <div className="dg-people">
        <div className="row-item"><Avatar name="You" tone="you" />You<span className="dg-role">Owner</span></div>
        <div className="row-item"><Avatar name="Tereza" tone="sky" />Tereza<span className="dg-role">Can edit <Caret /></span></div>
        <div className="row-item"><Avatar name="Jonas" tone="green" />Jonas<span className="dg-role">Can comment <Caret /></span></div>
      </div>

      <div className="dg-link">
        <span className="dg-link-ico"><LinkIcon /></span>
        <span className="dg-link-txt"><strong>Anyone with the link</strong><span>can view and leave comments</span></span>
        <button className="btn btn--primary" type="button">Copy link</button>
      </div>

      <div className="dg-adv" data-open={adv}>
        <button className="dg-adv-btn" type="button" aria-expanded={adv} aria-controls="dg-adv-body" onClick={() => setAdv((v) => !v)}>
          <Chevron open={adv} /> Advanced
          <span className="dg-adv-count">3 link types · GitHub</span>
        </button>
        {adv && (
          <div className="dg-adv-body" id="dg-adv-body">
            <div className="dg-adv-row">
              <span className="dg-adv-l">Web link</span>
              <code className="dg-adv-v">https://maude.sh/s/studio-site/homepage</code>
              <button className="icon-btn" type="button" aria-label="Copy web link"><CopyIcon /></button>
            </div>
            <div className="dg-adv-row">
              <span className="dg-adv-l">Open in the Maude app</span>
              <code className="dg-adv-v">maude://studio-site/homepage</code>
              <button className="icon-btn" type="button" aria-label="Copy app link"><CopyIcon /></button>
            </div>
            <div className="dg-adv-row">
              <span className="dg-adv-l">This Mac only</span>
              <code className="dg-adv-v">http://localhost:4402/ui/homepage</code>
              <button className="icon-btn" type="button" aria-label="Copy local link"><CopyIcon /></button>
            </div>
            <div className="dg-adv-row">
              <span className="dg-adv-l">Invite by GitHub username</span>
              <input className="input dg-adv-in" aria-label="GitHub username" placeholder="username" />
              <button className="btn btn--sm" type="button">Invite</button>
            </div>
          </div>
        )}
      </div>

      <p className="dg-sheet-note">People you share with see your changes as you make them.</p>
    </div>
  );
}

const COPY = [
  { keep: "Move “Onboarding” to the trash?", kill: "Are you sure?", why: "Name the thing, and ask with the button's verb. A bare question sends you to the button to learn what's at stake." },
  { keep: "Its versions go with it. You can bring it back from the trash.", kill: "This will run git rm on .design/ui/onboarding.tsx.", why: "Say what happens to the work, not to the files underneath." },
  { keep: "Move to trash", kill: "OK", why: "The confirm button repeats the title's verb. “OK” agrees to something you may not have read." },
  { keep: "Cancel", kill: "Not now · Keep it", why: "The way out always has the same name, so it's found without reading." },
];

export default function ComponentsDialogs() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Dialogs & sheets"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>A sheet floats up from where you asked. The canvas waits underneath.</h1>
          <p className="lede">
            Dialogs are islands too — one plane higher, over a canvas that dims a little but stays in
            view. Plain words in the title, the verb on the button, and everything technical kept
            under Advanced. Nothing is taken away, it's just not in your face.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Surface</dt><dd>--bg-2 · --radius-xl</dd></div>
          <div><dt>Plane</dt><dd>--shadow-lg, above the islands</dd></div>
          <div><dt>Veil</dt><dd>canvas tone at half strength</dd></div>
          <div><dt>Opens</dt><dd>--dur-panel · --ease-out</dd></div>
        </dl>

        {/* ── Hero: Share ──────────────────────────────────────────────── */}
        <h2 data-no>Share<span className="h2-aside">one primary up front, every other way under Advanced (shown open)</span></h2>
        <div className="stage dg-hero">
          <Scene />
          <div className="island dg-pill"><Mark size={22} /><span>Studio site</span><span className="dg-caret" aria-hidden="true">⌄</span></div>
          <div className="island dg-tr">
            <button className="icon-btn" type="button" aria-label="Hide panels">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
            </button>
            <button className="btn btn--primary dg-share-on" type="button" aria-expanded="true">Share</button>
          </div>
          <div className="dg-veil" aria-hidden="true" />
          <ShareSheet />
          <span className="dg-from" aria-hidden="true" />
        </div>
        <div className="dg-hero-notes">
          <p><strong>Copy link</strong> is the one primary action. Most people share by pasting a link, so it gets the azure.</p>
          <p><strong>Invite people</strong> lives inside the sheet, next to the field it acts on — a plain button, not a second blue one.</p>
          <p><strong>Advanced</strong> holds the three link types (web, app, this Mac) and GitHub invites. Mono type appears only in here.</p>
        </div>

        {/* ── Confirm ──────────────────────────────────────────────────── */}
        <h2 data-no>Confirm, in plain words<span className="h2-aside">the question, what happens, the verb</span></h2>
        <div className="dg-confirms">
          <div className="stage dg-mini">
            <Scene compact />
            <div className="dg-veil" aria-hidden="true" />
            <div className="dg-sheet dg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dg-c1-t" aria-describedby="dg-c1-b">
              <h3 id="dg-c1-t">Move “Onboarding” to the trash?</h3>
              <p id="dg-c1-b">Its versions go with it. You can bring it back from the trash.</p>
              <div className="dg-actions">
                <button className="btn btn--ghost" type="button">Cancel</button>
                <button className="btn dg-btn-danger" type="button">Move to trash</button>
              </div>
            </div>
          </div>
          <div className="stage dg-mini">
            <Scene compact />
            <div className="dg-veil" aria-hidden="true" />
            <div className="dg-sheet dg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dg-c2-t" aria-describedby="dg-c2-b">
              <h3 id="dg-c2-t">Restore the version from 6 Oct, 14:05?</h3>
              <p id="dg-c2-b">What you have now is saved as a version first, so nothing is lost.</p>
              <div className="dg-actions">
                <button className="btn btn--ghost" type="button">Cancel</button>
                <button className="btn btn--primary" type="button">Restore</button>
              </div>
            </div>
          </div>
          <div className="stage dg-mini">
            <Scene compact />
            <div className="dg-veil" aria-hidden="true" />
            <div className="dg-sheet dg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dg-c3-t" aria-describedby="dg-c3-b">
              <h3 id="dg-c3-t"><Spark size={14} color="var(--spark)" /> Redo Pricing with AI?</h3>
              <p id="dg-c3-b">AI rewrites all three plans. Your current layout stays in Version history.</p>
              <div className="dg-actions">
                <button className="btn btn--ghost" type="button">Cancel</button>
                <button className="btn btn--spark" type="button">Redo with AI</button>
              </div>
            </div>
          </div>
        </div>

        <div className="dg-copy">
          <div className="dg-copy-hd"><span>Keep</span><span>Kill</span><span>Why</span></div>
          {COPY.map((c) => (
            <div className="dg-copy-row" key={c.keep}>
              <span className="dg-keep">{c.keep}</span>
              <span className="dg-kill">{c.kill}</span>
              <span className="dg-why">{c.why}</span>
            </div>
          ))}
        </div>

        {/* ── Sign in as another account ───────────────────────────────── */}
        <h2 data-no>Another account, one tab<span className="h2-aside">“Sign in as another account…” on a project tab</span></h2>
        <p>
          Some projects belong to a client's account. You switch accounts for that one project tab —
          the rest of Maude stays signed in as you. Three short steps, each a small sheet.
        </p>
        <div className="dg-flow">
          <figure className="dg-step">
            <div className="stage dg-step-stage">
              <div className="island dg-tabs">
                <span className="dg-tab">Studio site</span>
                <span className="dg-tab dg-tab--on">Alligators brand</span>
              </div>
              <div className="dg-menu" role="menu" aria-label="Project tab menu">
                <div className="row-item" role="menuitem">Rename…</div>
                <div className="row-item" role="menuitem">Duplicate project</div>
                <div className="row-item" role="menuitem" aria-current="true">Sign in as another account…</div>
                <div className="dg-menu-sep" />
                <div className="row-item" role="menuitem">Close tab</div>
              </div>
            </div>
            <figcaption><span className="dg-step-n">1</span>Right-click the project tab.</figcaption>
          </figure>

          <figure className="dg-step">
            <div className="stage dg-step-stage">
              <div className="dg-veil" aria-hidden="true" />
              <div className="dg-sheet dg-acct" role="dialog" aria-modal="true" aria-labelledby="dg-a-t">
                <h3 id="dg-a-t">Sign in to Alligators brand as…</h3>
                <p>Only this project tab changes. Your other tabs stay as they are.</p>
                <div className="dg-acct-list">
                  <div className="row-item"><Avatar name="You" tone="you" />You<span className="dg-role">now</span></div>
                  <div className="row-item" aria-current="true"><Avatar name="Alligators" tone="lilac" />Alligators club</div>
                  <div className="row-item dg-acct-add"><span className="dg-av dg-av--add" aria-hidden="true">+</span>Another account…</div>
                </div>
                <div className="dg-actions">
                  <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
                  <button className="btn btn--primary btn--sm" type="button">Sign in</button>
                </div>
              </div>
            </div>
            <figcaption><span className="dg-step-n">2</span>Pick an account, or add one.</figcaption>
          </figure>

          <figure className="dg-step">
            <div className="stage dg-step-stage">
              <div className="dg-veil" aria-hidden="true" />
              <div className="dg-sheet dg-acct" role="dialog" aria-modal="true" aria-labelledby="dg-b-t">
                <h3 id="dg-b-t">Finish in your browser</h3>
                <p>A sign-in page is open in your browser. Come back here when it says you're done.</p>
                <div className="dg-wait" role="status"><span className="dg-wait-dot" aria-hidden="true" />Waiting for your browser…</div>
                <details className="dg-details">
                  <summary>Advanced</summary>
                  <div className="dg-code">
                    <span>Or enter this code at the sign-in page</span>
                    <code>K7QM-4TXD</code>
                  </div>
                </details>
                <div className="dg-actions">
                  <button className="btn btn--ghost btn--sm" type="button">Cancel</button>
                  <button className="btn btn--sm" type="button">Open the page again</button>
                </div>
              </div>
            </div>
            <figcaption><span className="dg-step-n">3</span>Sign in where you're used to signing in.</figcaption>
          </figure>
        </div>
        <div className="dg-after">
          <div className="island dg-tabs dg-tabs--after">
            <span className="dg-tab">Studio site</span>
            <span className="dg-tab dg-tab--on"><Avatar name="Alligators" tone="lilac" />Alligators brand</span>
          </div>
          <span className="dg-after-cap">Afterwards the tab carries the account's initial, so you always know who you're working as.</span>
        </div>

        {/* ── Anatomy + rules ─────────────────────────────────────────── */}
        <h2 data-no>Anatomy<span className="h2-aside">four parts, always in this order</span></h2>
        <div className="dg-anat">
          <div className="dg-sheet dg-anat-sheet" aria-hidden="true">
            <h3>Rename “Pricing”?</h3>
            <p>Links people already have will keep working.</p>
            <div className="dg-anat-adv"><Chevron open={false} /> Advanced</div>
            <div className="dg-actions">
              <span className="btn btn--ghost btn--sm">Cancel</span>
              <span className="btn btn--primary btn--sm">Rename</span>
            </div>
          </div>
          <ol className="dg-anat-key">
            <li><strong>Title</strong>The real question, with the thing's name in it.</li>
            <li><strong>Body</strong>One or two sentences about your work — what changes, what stays safe.</li>
            <li><strong>Advanced</strong>Optional. Closed by default; it holds the technical bits and extra options.</li>
            <li><strong>Actions</strong>Cancel on the left as a ghost, the title's verb on the right. One primary at most.</li>
          </ol>
        </div>

        <div className="dg-rules">
          <div className="dg-rule"><strong>Opens from its island</strong><span>A sheet grows out of the button that asked for it and returns there when it closes, on --dur-panel.</span></div>
          <div className="dg-rule"><strong>Dim, don't blackout</strong><span>The veil is the canvas colour at half strength. Your work stays in view; only a decision earns a veil.</span></div>
          <div className="dg-rule"><strong>Easy to leave</strong><span>Esc, Cancel and clicking outside all close it — unless typing would be lost; then it asks first.</span></div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · dialogs &amp; sheets</span>
        <span>The question, what happens, the verb</span>
      </footer>
    </>
  );
}
