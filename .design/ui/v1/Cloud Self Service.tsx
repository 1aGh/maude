/**
 * @canvas      Cloud Self Service — every screen a Maude Cloud customer walks through, in order · a legend board + 14 screen boards across 5 stages, each annotated with sticky notes
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   legend | landing | auth | dashboard-empty | new-project | payment | waiting | dashboard | connect | launch | people | billing | mirror-activity | leave | devices
 * @brief       Kompletní design všech screens, kterými uživatel Maude Cloud aktuálně musí projít — celý self-service hub, se sticky notes u každého kroku, aby byl celý user flow vidět vedle sebe.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling Cloud Self Service.css)
 * @history     .design/_history/ui-cloud_self_service/
 *
 * SOURCE OF TRUTH — this board is a re-draw of code that exists today, not a
 * proposal. Every screen below is one function in apps/cloud:
 *
 *   pages.mjs           homePage · signupPage · loginPage
 *   checkout-pages.mjs  newProjectPage · waitingRoomPage · billingPage
 *   dashboard.mjs       dashboardPage (+ STATE_COPY)
 *   brand.mjs           appShell — the signed-in chrome every admin page wears
 *   project-admin.mjs   connectPage · downloadPage · deletePage · auditPage · mirrorPage
 *   people-page.mjs     peoplePage · removeConfirmPage
 *   invites.mjs         invitePage
 *   handoff.mjs         launchPage
 *   device-auth.mjs     activatePage · accountPage
 *
 * THE STICKY NOTES carry two things. Yellow = what happens at this step and
 * where it goes next. Red = a finding from the 2026-07-31 production-readiness
 * audit that lands on THIS screen. A flow board that only showed the happy path
 * would be the same lie the audit's headline names: every page is honest and
 * the journey is not.
 *
 * Authored under the `maude` DS. Tokens + shared classes are imported in-file
 * so the canvas is self-contained (Studio / Studio Hub precedent + DDR-093).
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./Cloud Self Service.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const ME = "michal@brno-alligators.cz";
const PROJECT = { id: "alligators", name: "Brno Alligators" };

/* ── Glyphs — lifted verbatim from brand.mjs GLYPHS (the shell's own icon set,
 * 1.25 stroke, fill:none, currentColor). Same family, so the mock and the
 * running product draw the same nav. */
const G: Record<string, JSX.Element> = {
  grid: (<><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>),
  plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
  open: (<><path d="M6 3H3v10h10v-3" /><path d="M9 3h4v4" /><line x1="13" y1="3" x2="7" y2="9" /></>),
  people: (<><circle cx="6" cy="5.5" r="2.5" /><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" /><path d="M11 9.2c1.7.4 3 1.9 3 3.8" /><path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.6" /></>),
  card: (<><rect x="2" y="4" width="12" height="8" rx="1.5" /><line x1="2" y1="7" x2="14" y2="7" /></>),
  branch: (<><circle cx="4.5" cy="4" r="1.8" /><circle cx="4.5" cy="12" r="1.8" /><circle cx="11.5" cy="6" r="1.8" /><path d="M4.5 5.8v4.4" /><path d="M11.5 7.8c0 2.4-3 2.2-5 3.2" /></>),
  clock: (<><circle cx="8" cy="8" r="5.5" /><polyline points="8 5 8 8 10.5 9.5" /></>),
  down: (<><path d="M8 2.5v7" /><polyline points="5 7 8 10 11 7" /><path d="M3 12.5h10" /></>),
  trash: (<><path d="M3.5 5h9" /><path d="M6.5 5V3.5h3V5" /><path d="M5 5l.6 8h4.8L11 5" /></>),
};

function Glyph({ name }: { name: string }) {
  return (
    <svg className="cs-g" viewBox="0 0 16 16" aria-hidden="true">
      {G[name]}
    </svg>
  );
}

/* ── The brand mark. Lifted from the DS logo specimen (system/maude/preview/
 * logo.tsx) via the cloud's own lockup() in brand.mjs — the spark on the
 * squared-bottom-right bubble tile. Not redrawn (DDR-141). */
function Lockup({ size = 26, words = "Maude Cloud" }: { size?: number; words?: string | null }) {
  return (
    <span className="cs-lockup">
      {/* The tile carries the accessible name when the wordmark is omitted —
       * otherwise the mark-alone form has no text node at all. */}
      <span
        className="cs-mark"
        style={{ width: size, height: size }}
        {...(words ? {} : { role: "img" as const, "aria-label": "Maude" })}
      >
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
        </svg>
      </span>
      {words ? <span className="cs-word">{words}</span> : null}
    </span>
  );
}

/* Google's official four brand hues. The commonly-copied
 * #FFC107/#FF3D00/#4CAF50/#1976D2 set is the Material-icons knock-off — altering
 * the G is the one thing Google's guidelines do not permit. (The same wrong set
 * ships in apps/cloud/pages.mjs — worth fixing there.) */
const GOOGLE_G = (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FBBC05" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z" />
    <path fill="#EA4335" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#34A853" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#4285F4" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.2C40.7 35.7 44 30.3 44 24c0-1.2-.1-2.4-.4-3.5z" />
  </svg>
);

/* ─────────────────────────── flow-board furniture ────────────────────────── */

/* canvas-lib's <DCPostIt> takes children only — no className — so the two
 * variants this board needs (a red "gap" slip, a green "fork" slip) can't ride
 * it. This is the same `dc-postit` class and the same role, plus one modifier. */
function Note({
  kind = "note",
  title,
  children,
}: {
  kind?: "note" | "gap" | "fork";
  title: string;
  children: React.ReactNode;
}) {
  const cls = kind === "note" ? "dc-postit" : `dc-postit cs-${kind}`;
  return (
    <aside className={cls}>
      <strong>{title}</strong>
      {children}
    </aside>
  );
}

function Step({
  stage,
  code,
  name,
  actor,
  notes,
  children,
}: {
  stage: string;
  code: string;
  name: string;
  actor: string;
  notes: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="cs-step">
      <div className="cs-stage">
        {/* The stage name is repeated on every board on purpose. DCSection is
         * metadata-only inside DesignCanvas (it renders `display: contents`),
         * so a section title never reaches the screen — without this the five
         * chapters of the journey are invisible at every zoom level. */}
        <div className="cs-marker">
          <span className="cs-stage-name">{stage}</span>
          <b>{code}</b>
          <span>{name}</span>
          <span className="cs-actor">{actor}</span>
        </div>
        {children}
      </div>
      <div className="cs-notes">{notes}</div>
    </div>
  );
}

function Browser({
  url,
  tag,
  h = 830,
  children,
}: {
  url: React.ReactNode;
  tag?: string;
  h?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="cs-browser">
      <div className="cs-urlbar">
        <span className="cs-dots">
          <i /><i /><i />
        </span>
        <span className="cs-url">
          <span className="cs-lock">&#9679;</span>
          {url}
        </span>
        {tag ? <span className={`cs-tag${tag === "not ours" ? " cs-tag--ext" : ""}`}>{tag}</span> : null}
      </div>
      <div style={{ height: h, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

/* ── Screen chrome A — the centred narrow page (pages.mjs / checkout-pages.mjs). */
function Narrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="cs-narrow">
      <main>{children}</main>
    </div>
  );
}

/* ── Screen chrome B — the signed-in app shell (brand.mjs appShell). One
 * component, every admin screen: exactly how the product does it. */
function Shell({
  active,
  project,
  isOwner = true,
  title,
  pill,
  lede,
  children,
}: {
  active: string;
  project?: { id: string; name: string } | null;
  isOwner?: boolean;
  title: string;
  pill?: { tone: string; label: string } | null;
  lede?: string | null;
  children: React.ReactNode;
}) {
  const item = (key: string, label: string, glyph: string, danger = false) => (
    <span
      className={`cs-navitem${danger ? " cs-danger" : ""}`}
      {...(active === key ? { "aria-current": "page" as const } : {})}
    >
      <Glyph name={glyph} />
      <span>{label}</span>
    </span>
  );
  return (
    <div className="cs-shell">
      <header className="cs-top">
        <Lockup size={26} />
        <span className="cs-spacer" />
        <span className="cs-who">{ME}</span>
        <span className="cs-btn cs-btn--ghost" style={{ height: 26, fontWeight: 400 }}>
          Sign out
        </span>
      </header>
      <nav className="cs-nav">
        <div className="cs-navhd">Workspace</div>
        {item("projects", "Your projects", "grid")}
        {item("new", "Start a project", "plus")}
        {item("account", "Account", "people")}
        {project ? (
          <>
            <div className="cs-navsep" />
            <div className="cs-navhd">{project.name}</div>
            {item("connect", "Open", "open")}
            {item("people", "People", "people")}
            {isOwner ? item("billing", "Billing", "card") : null}
            {isOwner ? item("mirror", "GitHub copy", "branch") : null}
            {item("audit", "Activity", "clock")}
            {item("download", "Download everything", "down")}
            {isOwner ? item("delete", "Delete project…", "trash", true) : null}
          </>
        ) : null}
      </nav>
      <main className="cs-main">
        <div className="cs-inner">
          <div className="cs-pagehd">
            <h1>{title}</h1>
            {pill ? <span className={`cs-pill ${pill.tone}`}>{pill.label}</span> : null}
          </div>
          {lede ? <p className="cs-lede">{lede}</p> : null}
          {children}
        </div>
      </main>
      <footer className="cs-foot">
        <span>Maude Cloud</span>
        <span className="cs-spacer" />
        <span className="cs-promise">
          Everything here is yours to take — every project can be downloaded in full, at any time,
          including after you stop paying for it.
        </span>
      </footer>
    </div>
  );
}

function Check() {
  return (
    <span className="cs-box cs-on">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 8.2 6.4 11.5 13 4.2" />
      </svg>
    </span>
  );
}

/* ══════════════════════════════ the board ════════════════════════════════ */

export default function CloudSelfService() {
  return (
    <DesignCanvas
      title="Cloud Self Service"
      subtitle="Every screen a Maude Cloud customer walks through, in order — start at board 00, then 14 screens across 5 stages"
    >
      {/* ──────────────────────────── how to read ─────────────────────────── */}
      <DCSection id="guide" title="0 · How to read this" subtitle="the spine and the key">
        <DCArtboard
          id="legend"
          label="00 · how to read this board"
          width={1740}
          height={640}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <div className="cs-legend">
            <div>
              <Lockup size={34} words="Maude Cloud" />
              <h1>Every screen, in the order somebody meets it.</h1>
            </div>
            <p className="cs-lede">
              Fourteen boards below. Each one is a screen that ships in{" "}
              <span className="cs-mono">apps/cloud</span> today — drawn inside a browser frame with
              its real address — and a column of notes saying what happens there. Read left to
              right, top to bottom. Nothing here is a proposal.
            </p>
            <div className="cs-legend-cols">
              <div>
                <div className="cs-legend-hd">The spine — five stages, fourteen boards</div>
                <div className="cs-spine-row">
                  <b>1 · Arrive</b>
                  <span className="cs-boards">A1–A2</span>
                  <span>Landing, and the two ways to have an account.</span>
                </div>
                <div className="cs-spine-row">
                  <b>2 · Buy</b>
                  <span className="cs-boards">B1–B4</span>
                  <span>Wizard, card, waiting room. The irreversible step.</span>
                </div>
                <div className="cs-spine-row">
                  <b>3 · Open it</b>
                  <span className="cs-boards">C1–C3</span>
                  <span>Dashboard, the last door, the hand-off to the app.</span>
                </div>
                <div className="cs-spine-row">
                  <b>4 · Run it</b>
                  <span className="cs-boards">D1–D3</span>
                  <span>People, money, and the copy on GitHub.</span>
                </div>
                <div className="cs-spine-row">
                  <b>5 · Leave it</b>
                  <span className="cs-boards">E1–E2</span>
                  <span>The exit, and the door for a second machine.</span>
                </div>
              </div>
              <div>
                <div className="cs-legend-hd">The notes</div>
                <div className="cs-keys">
                  <div className="cs-key">
                    <i className="cs-k-note" />
                    <div>
                      <b>What happens here</b>
                      The step in the customer's terms, and where it goes next.
                    </div>
                  </div>
                  <div className="cs-key">
                    <i className="cs-k-gap" />
                    <div>
                      <b>Gap</b>
                      A finding from the 2026-07-31 readiness audit, on the screen it lands on.
                      Twelve of the fourteen boards carry at least one — that density is the
                      point, not a drafting accident.
                    </div>
                  </div>
                  <div className="cs-key">
                    <i className="cs-k-fork" />
                    <div>
                      <b>Fork</b>
                      Where the path splits and two different people go two different ways.
                    </div>
                  </div>
                </div>
                <p className="cs-quiet" style={{ marginTop: "var(--space-6)" }}>
                  Sources per board are named in{" "}
                  <span className="cs-mono">Cloud Self Service.meta.json</span>; the plan they feed
                  is <span className="cs-mono">.ai/plans/cloud-phase-24-self-service-ready.md</span>.
                </p>
              </div>
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      {/* ───────────────────────── STAGE 1 — arrive ───────────────────────── */}
      <DCSection
        id="arrive"
        title="1 · Arrive"
        subtitle="cloud.maude.sh — the two doors, and the account behind both"
      >
        <DCArtboard
          id="landing"
          label="A1 · landing · cloud.maude.sh"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="1 · Arrive"
            code="A1"
            name="Landing"
            actor="anyone"
            notes={
              <>
                <Note title="Two doors, one destination">
                  <p>
                    Google both <em>creates</em> the account and signs in, so it earns a
                    first-class button here rather than a link buried on the signup page.
                  </p>
                  <p>
                    <code>GET /</code> → <code>/auth/google</code> or <code>/signup</code>
                  </p>
                </Note>
                <Note title="Signed in? Different page">
                  <p>
                    The same route renders “You’re signed in” with a way to the projects list —
                    one function, two states (<code>homePage</code>).
                  </p>
                </Note>
                <Note kind="gap" title="The bill of materials is missing">
                  <p>
                    “A home for your design projects” does not say the customer will need a
                    desktop computer, the Maude app, and <b>a second paid Anthropic
                    subscription</b> to make anything.
                  </p>
                  <p>
                    The string “Claude” appears in <b>zero</b> customer-facing cloud pages. The
                    card is authorised before the real cost is revealed.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/</>}>
              <Narrow>
                <Lockup size={30} />
                <h1>A home for your design projects</h1>
                <p className="cs-quiet" style={{ marginBottom: "var(--space-6)" }}>
                  Synced, versioned, and always yours to take with you.
                </p>
                <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
                  <span className="cs-btn cs-btn--google">{GOOGLE_G} Continue with Google</span>
                  <span className="cs-btn">Create an account</span>
                </div>
                <p className="cs-quiet" style={{ marginTop: "var(--space-6)" }}>
                  Already have an account? <span className="cs-link">Sign in</span>.
                </p>
              </Narrow>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="auth"
          label="A2 · create account · sign in"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="1 · Arrive"
            code="A2"
            name="Create account · Sign in"
            actor="anyone"
            notes={
              <>
                <Note title="Consent lives where the decision is">
                  <p>
                    The disclosure card is <em>inside</em> signup, not on a page nobody visits.
                    <code>disclosure_accepted_at</code> is written only when the box was really
                    ticked (DDR-193 §4).
                  </p>
                </Note>
                <Note title="Sign-in remembers where you were going">
                  <p>
                    <code>?next=</code> carries the page that sent you — almost always an
                    invitation — so signing in lands you back there, not on a dashboard you then
                    have to leave.
                  </p>
                </Note>
                <Note kind="gap" title="Google is still in Testing">
                  <p>
                    The consent screen was never published, so only allow-listed accounts can use
                    the button we just made the front door. A stranger gets an error.
                  </p>
                </Note>
                <Note kind="fork" title="Fork">
                  <p>
                    New customer → <b>B1 empty dashboard</b>.<br />
                    Invited person → straight back to <b>D1 join</b>.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div>
                <div className="cs-vlabel">POST /auth/signup</div>
                <Browser url={<><b>cloud.maude.sh</b>/signup</>} h={780}>
                  <Narrow>
                    <h1>Create your account</h1>
                    <span className="cs-btn cs-btn--google cs-btn--wide">
                      {GOOGLE_G} Continue with Google
                    </span>
                    <div className="cs-or">or</div>
                    <span className="cs-label">Email</span>
                    <div className="cs-input cs-filled">{ME}</div>
                    <span className="cs-label">Password</span>
                    <div className="cs-input">••••••••••••</div>
                    <p className="cs-quiet" style={{ margin: "var(--space-2) 0 0" }}>
                      At least 12 characters.
                    </p>
                    <div className="cs-card" style={{ marginTop: "var(--space-5)" }}>
                      <h2>What Maude Cloud can and cannot see</h2>
                      <p className="cs-quiet" style={{ margin: 0 }}>
                        We store and sync your project: your designs, your edit history, and who is
                        editing. We never open, run, or render your work on our computers — designs
                        are only ever drawn on your own device. You can download everything and
                        leave at any time.
                      </p>
                    </div>
                    <label className="cs-check">
                      <Check />
                      <span>I understand what Maude Cloud stores and what it never does.</span>
                    </label>
                    <span className="cs-btn">Create account</span>
                  </Narrow>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">POST /auth/login</div>
                <Browser url={<><b>cloud.maude.sh</b>/login?next=/invite/…</>} h={780}>
                  <Narrow>
                    <h1>Sign in</h1>
                    <span className="cs-btn cs-btn--google cs-btn--wide">
                      {GOOGLE_G} Continue with Google
                    </span>
                    <div className="cs-or">or</div>
                    <span className="cs-label">Email</span>
                    <div className="cs-input" />
                    <span className="cs-label">Password</span>
                    <div className="cs-input" />
                    <p style={{ margin: "var(--space-5) 0 0" }}>
                      <span className="cs-btn">Sign in</span>
                    </p>
                    <p className="cs-quiet" style={{ marginTop: "var(--space-6)" }}>
                      New here? <span className="cs-link">Create an account</span>.
                    </p>
                    <div className="cs-card cs-stop" style={{ marginTop: "var(--space-7)" }}>
                      <h2 style={{ color: "var(--status-error)" }}>Error state</h2>
                      <p className="cs-quiet" style={{ margin: 0 }}>
                        “That email and password don’t match.” — one message for both fields, so
                        it never confirms which addresses exist.
                      </p>
                    </div>
                  </Narrow>
                </Browser>
              </div>
            </div>
          </Step>
        </DCArtboard>
      </DCSection>

      {/* ────────────────────────── STAGE 2 — buy ─────────────────────────── */}
      <DCSection
        id="buy"
        title="2 · Buy"
        subtitle="empty dashboard → wizard → Stripe → waiting room. The only irreversible step in the flow."
      >
        <DCArtboard
          id="dashboard-empty"
          label="B1 · your projects · empty"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="2 · Buy"
            code="B1"
            name="Your projects (empty)"
            actor="new customer"
            notes={
              <>
                <Note title="The first thing a paying customer sees">
                  <p>
                    The shell arrives fully formed — nav, account chip, the take-everything promise
                    in the status bar — before there is anything in it. The empty state is the
                    only call to action.
                  </p>
                </Note>
                <Note title="One shell, every admin screen">
                  <p>
                    <code>appShell()</code> in <code>brand.mjs</code>: 232px nav, hairline seams,
                    the dotted canvas as the deepest surface. Every board from here to the end
                    wears it.
                  </p>
                </Note>
                <Note kind="gap" title="Nobody has walked this">
                  <p>
                    Production <code>audit_log</code> holds <b>no project-creation event</b>. The
                    pilot was provisioned by hand — the wizard below has never run end to end.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/</>}>
              <Shell active="projects" title="Your projects">
                <div className="cs-card" style={{ textAlign: "center", padding: "var(--space-8)" }}>
                  <p style={{ margin: "0 0 var(--space-3)", fontWeight: 600 }}>No projects yet.</p>
                  <p className="cs-quiet" style={{ maxWidth: "26rem", margin: "0 auto var(--space-6)" }}>
                    A project is one design system and the work around it. You can invite people to
                    it once it exists.
                  </p>
                  <span className="cs-btn">Start a project</span>
                </div>
              </Shell>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="new-project"
          label="B2 · start a project · the wizard"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="2 · Buy"
            code="B2"
            name="Start a project"
            actor="new customer"
            notes={
              <>
                <Note title="One page, three questions">
                  <p>Name · plan · billing rhythm. No script — the id the name becomes is decided server-side and shown on the next page.</p>
                  <p><code>POST /projects/new</code></p>
                </Note>
                <Note title="Trial framing, said plainly">
                  <p>
                    “The first 14 days are free — your card is not charged until the trial ends, and
                    you can stop any time before that.”
                  </p>
                </Note>
                <Note kind="gap" title="This is the last honest moment">
                  <p>
                    Everything after this screen assumes a desktop computer. This is where the full
                    cost belongs — including the Anthropic subscription — because the next click is
                    a card form.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/projects/new</>}>
              <Shell
                active="new"
                title="Start a project"
                lede="One project is one workspace with its own address, its own people, and its own design system. The first 14 days are free — your card is not charged until the trial ends, and you can stop any time before that."
              >
                <span className="cs-label" style={{ marginTop: 0 }}>
                  What is the project called?
                </span>
                <div className="cs-input cs-filled">Brno Alligators</div>
                <div className="cs-plans">
                  <div className="cs-plan cs-picked">
                    <strong>
                      <span className="cs-radio cs-on" /> Studio
                    </strong>
                    <span className="cs-quiet" style={{ display: "block", marginTop: 4 }}>
                      One team, one design system, everything synced.
                    </span>
                    <p className="cs-price">
                      €29<span> / month</span>
                    </p>
                  </div>
                  <div className="cs-plan">
                    <strong>
                      <span className="cs-radio" /> Studio Plus
                    </strong>
                    <span className="cs-quiet" style={{ display: "block", marginTop: 4 }}>
                      More people, more storage, a copy on GitHub.
                    </span>
                    <p className="cs-price">
                      €79<span> / month</span>
                    </p>
                  </div>
                </div>
                <div className="cs-interval">
                  <label>
                    <span className="cs-radio cs-on" /> Monthly
                  </label>
                  <label>
                    <span className="cs-radio" /> Annual — two months free
                  </label>
                </div>
                <p style={{ marginTop: "var(--space-5)" }}>
                  <span className="cs-btn">Continue to payment details</span>
                </p>
                <p className="cs-quiet" style={{ marginTop: "var(--space-4)" }}>
                  Payment details are handled by Stripe. Nothing is charged today.
                </p>
              </Shell>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="payment"
          label="B3 · payment details · Stripe (not our page)"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="2 · Buy"
            code="B3"
            name="Payment details"
            actor="new customer"
            notes={
              <>
                <Note title="We never see a card">
                  <p>
                    Stripe-hosted checkout on Stripe’s own domain. Maude holds a customer id and a
                    subscription id — never a number.
                  </p>
                </Note>
                <Note title="Authorise now, charge later">
                  <p>
                    The card is <em>authorised</em> here and only <em>charged</em> once the project
                    actually comes up. Provisioning failure voids it — see B4.
                  </p>
                </Note>
                <Note kind="gap" title="The money is fake">
                  <p>
                    The key in use is <code>rk_test_</code>; every live price id in
                    <code>pricing.json</code> is <code>null</code>, and <code>livemode</code> is
                    false.
                  </p>
                  <p>
                    No <code>automatic_tax</code> anywhere on an EU VAT product. No ToS, DPA or
                    privacy pack. No public pricing page — nobody can learn the price without
                    starting a checkout.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>checkout.stripe.com</b>/c/pay/cs_test_…</>} tag="not ours">
              <div className="cs-narrow">
                <main style={{ maxWidth: "30rem" }}>
                  <div className="cs-card">
                    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
                      <h2 style={{ margin: 0 }}>Brno Alligators — Studio</h2>
                      <span className="cs-spacer" />
                      <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--type-lg)", fontWeight: 600 }}>
                        €29,00
                      </span>
                    </div>
                    <p className="cs-quiet" style={{ margin: "var(--space-2) 0 0" }}>
                      Billed monthly after a 14-day free trial. Cancel any time.
                    </p>
                  </div>
                  <span className="cs-label" style={{ marginTop: 0 }}>Email</span>
                  <div className="cs-input cs-filled">{ME}</div>
                  <span className="cs-label">Card information</span>
                  <div className="cs-input">1234 1234 1234 1234</div>
                  <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 6 }}>
                    <div className="cs-input" style={{ flex: 1 }}>MM / YY</div>
                    <div className="cs-input" style={{ flex: 1 }}>CVC</div>
                  </div>
                  <span className="cs-label">Country</span>
                  <div className="cs-input cs-filled">Czechia</div>
                  <p style={{ marginTop: "var(--space-6)" }}>
                    <span className="cs-btn cs-btn--stripe cs-btn--wide">Start trial</span>
                  </p>
                  <p className="cs-mono" style={{ textAlign: "center", marginTop: "var(--space-5)" }}>
                    powered by stripe · terms · privacy
                  </p>
                </main>
              </div>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="waiting"
          label="B4 · waiting room · three endings"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="2 · Buy"
            code="B4"
            name="Setting up"
            actor="new customer"
            notes={
              <>
                <Note title="Named steps, never a percentage">
                  <p>
                    A percentage would be a guess about infrastructure. Four named steps are the
                    truth (DDR-203). The page re-checks itself with a meta refresh — no script, so
                    it works even when everything else is uncertain.
                  </p>
                </Note>
                <Note title="It answers the real question on screen">
                  <p>
                    “Have I been charged?” arrives long before any email does — so the answer is
                    printed <em>here</em>, in the reassurance card.
                  </p>
                </Note>
                <Note kind="gap" title="Capacity is one">
                  <p>
                    <code>max_instances = 1</code>. A second concurrent customer never gets a
                    container: this room times out and the sale is voided.
                  </p>
                  <p>
                    Worse — per-tenant config is Worker-<b>global</b>, so a new tenant’s first boot
                    could clone the pilot’s repository.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div>
                <div className="cs-vlabel">waiting · refresh 5s</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/setup</>} h={780}>
                  <Narrow>
                    <Lockup size={24} />
                    <h1>Setting up Brno Alligators</h1>
                    <ul className="cs-steps">
                      <li className="cs-done">Setting up your account</li>
                      <li className="cs-now">Building your workspace</li>
                      <li>Adding your project</li>
                      <li>Ready</li>
                    </ul>
                    <div className="cs-card cs-ok">
                      <p style={{ margin: 0 }}>
                        This usually takes a minute or two. Your card has not been charged yet —
                        that happens once your project is up.
                      </p>
                    </div>
                    <p className="cs-quiet" style={{ marginTop: "var(--space-5)" }}>
                      This page checks again every few seconds by itself.
                    </p>
                  </Narrow>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">ready · and failed</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/setup</>} h={780}>
                  <Narrow>
                    <Lockup size={24} />
                    <h1>Brno Alligators is ready</h1>
                    <p className="cs-quiet">Your project is ready.</p>
                    <p>
                      <span className="cs-btn">Open your project</span>
                    </p>
                    <p className="cs-quiet">Back to your projects</p>

                    <div className="cs-navsep" style={{ margin: "var(--space-7) 0" }} />

                    <div className="cs-vlabel">the other ending</div>
                    <h1 style={{ fontSize: "var(--type-xl)" }}>Something went wrong</h1>
                    <div className="cs-card cs-stop">
                      <p style={{ margin: 0 }}>
                        We could not set up your project, so you have not been charged.
                      </p>
                    </div>
                    <p style={{ marginTop: "var(--space-5)" }}>
                      <span className="cs-btn">Try again</span>
                    </p>
                  </Narrow>
                </Browser>
              </div>
            </div>
          </Step>
        </DCArtboard>
      </DCSection>

      {/* ───────────────────────── STAGE 3 — open it ──────────────────────── */}
      <DCSection
        id="open"
        title="3 · Open it"
        subtitle="the dashboard, the last door, and the hand-off into the desktop app"
      >
        <DCArtboard
          id="dashboard"
          label="C1 · your projects · every state"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="3 · Open it"
            code="C1"
            name="Your projects"
            actor="owner"
            notes={
              <>
                <Note title="The hub. Everything else hangs off a card.">
                  <p>
                    Primary action per state; everything secondary folds into the ⋯ menu, filtered
                    by what this person may actually do.
                  </p>
                </Note>
                <Note title="Download is in EVERY state">
                  <p>
                    Including <em>paused</em> and <em>deleted</em>. An export you can only reach
                    while everything is fine is not a guarantee.
                  </p>
                </Note>
                <Note title="Six states, six sentences">
                  <p>
                    Setting up · Ready · Payment did not go through · Paused · Downloaded, ready to
                    delete · Deleted. Each carries a note that says what is safe
                    (<code>STATE_COPY</code>).
                  </p>
                </Note>
                <Note kind="gap" title="Nothing is enforced after the sale">
                  <p>
                    The reconciler computes <code>suspend-cell</code> and never runs it. A
                    non-payer keeps a serving cell; the export-before-purge email never sends
                    itself.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/</>}>
              <Shell active="projects" title="Your projects">
                <div className="cs-projects">
                  <article className="cs-project" style={{ position: "relative" }}>
                    <div className="cs-pcanvas">
                      <span className="cs-ab cs-ab1" />
                      <span className="cs-ab cs-ab2" />
                      <span className="cs-ab cs-ab3" />
                    </div>
                    <div className="cs-pbody">
                      <div className="cs-prow">
                        <h2>Brno Alligators</h2>
                        <span className="cs-spacer" />
                        <span className="cs-pill ok">Ready</span>
                      </div>
                      <p className="cs-pnote" />
                      <div className="cs-pfoot">
                        <span className="cs-btn">Open</span>
                        <span className="cs-spacer" />
                        <span className="cs-dots-btn">⋯</span>
                      </div>
                    </div>
                    <div className="cs-menu">
                      <a>People</a>
                      <a>Billing</a>
                      <a>GitHub copy</a>
                      <a>Activity</a>
                      <a>Download everything</a>
                      <div className="cs-menusep" />
                      <a className="cs-danger">Delete project…</a>
                    </div>
                  </article>
                  <article className="cs-project">
                    <div className="cs-pcanvas">
                      <span className="cs-ab cs-ab1" />
                      <span className="cs-ab cs-ab3" />
                    </div>
                    <div className="cs-pbody">
                      <div className="cs-prow">
                        <h2>Studyfi v3</h2>
                        <span className="cs-spacer" />
                        <span className="cs-pill warn">Payment did not go through</span>
                      </div>
                      <p className="cs-pnote">
                        Your work is safe and the project keeps running. Update your card to avoid
                        it pausing.
                      </p>
                      <div className="cs-pfoot">
                        <span className="cs-btn">Open</span>
                        <span className="cs-spacer" />
                        <span className="cs-dots-btn">⋯</span>
                      </div>
                    </div>
                  </article>
                  <article className="cs-project">
                    <div className="cs-pcanvas">
                      <span className="cs-ab cs-ab2" />
                    </div>
                    <div className="cs-pbody">
                      <div className="cs-prow">
                        <h2>Dugmate</h2>
                        <span className="cs-spacer" />
                        <span className="cs-pill warn">Setting up</span>
                      </div>
                      <p className="cs-pnote">
                        This usually takes a minute or two. The setup page shows each step live.
                      </p>
                      <div className="cs-pfoot">
                        <span className="cs-btn">Setup progress</span>
                        <span className="cs-spacer" />
                        <span className="cs-dots-btn">⋯</span>
                      </div>
                    </div>
                  </article>
                  <article className="cs-project">
                    <div className="cs-pcanvas" />
                    <div className="cs-pbody">
                      <div className="cs-prow">
                        <h2>Horizon</h2>
                        <span className="cs-spacer" />
                        <span className="cs-pill stop">Paused</span>
                      </div>
                      <p className="cs-pnote">
                        Nothing has been deleted. Restart it, or download everything and keep it.
                      </p>
                      <div className="cs-pfoot">
                        <span className="cs-btn">Open</span>
                        <span className="cs-spacer" />
                        <span className="cs-dots-btn">⋯</span>
                      </div>
                    </div>
                  </article>
                </div>
              </Shell>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="connect"
          label="C2 · open your project · the last door"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="3 · Open it"
            code="C2"
            name="Open Brno Alligators"
            actor="member"
            notes={
              <>
                <Note title="Why this page exists at all">
                  <p>
                    “Open” used to be a bare link to the workspace hostname — which greets a
                    customer with an operator console. This page is the honest door instead.
                  </p>
                </Note>
                <Note title="One click, nothing to paste">
                  <p>
                    <code>POST /projects/…/handoff</code> mints a one-time code (120s, single-use,
                    hashed at rest) and hands it to the app. No token ever reaches the clipboard.
                  </p>
                </Note>
                <Note kind="gap" title="The browser card instructs the impossible">
                  <p>
                    It asks the customer to sign in “with your workspace email and password” — a
                    credential <b>no customer is ever issued</b>. Only a derived admin credential
                    exists.
                  </p>
                  <p>Either delete the card or say what is true: the browser shows the gallery, the app edits.</p>
                </Note>
                <Note kind="gap" title="Windows is unsigned">
                  <p>
                    “Download Maude” sends a volunteer to a SmartScreen warning that the club’s new
                    design tool is dangerous — at the exact moment she is following our
                    instructions.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/connect</>}>
              <Shell active="connect" project={PROJECT} title="Open Brno Alligators">
                <div className="cs-card">
                  <h2>In the Maude app</h2>
                  <p className="cs-quiet">
                    One click — the app opens this project signed in as you. Nothing to copy,
                    nothing to paste.
                  </p>
                  <span className="cs-btn">Open in Maude</span>
                  <p className="cs-quiet" style={{ margin: "var(--space-4) 0 0" }}>
                    Don’t have the app yet? <span className="cs-link">Download Maude</span>, then
                    come back and press the button.
                  </p>
                </div>
                <div className="cs-card">
                  <h2>In your browser</h2>
                  <p className="cs-quiet">
                    Your project lives at its own address. Sign in there with your{" "}
                    <b style={{ color: "var(--fg-1)" }}>workspace email and password</b> — for now
                    this is separate from your Maude account; one sign-in for both is on the
                    roadmap.
                  </p>
                  <span className="cs-btn cs-btn--ghost">Open alligators.cloud.maude.sh</span>
                </div>
                <p className="cs-quiet">
                  Running the machinery yourself? The operator console lives at the same address
                  under <span className="cs-mono">/admin</span>.
                </p>
              </Shell>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="launch"
          label="C3 · maude:// hand-off · the app opens"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="3 · Open it"
            code="C3"
            name="Opening in Maude"
            actor="member · desktop"
            notes={
              <>
                <Note title="The browser parks, the app decides">
                  <p>
                    The deep link only <em>parks</em> an untrusted URL. The app asks the human, then
                    redeems the code against <b>its own</b> configured cloud address — never the
                    one the link named.
                  </p>
                </Note>
                <Note title="Burn before decide">
                  <p>
                    The code is spent by a conditional update before membership is re-checked, so a
                    replay finds nothing left to spend. Two minutes, one use.
                  </p>
                </Note>
                <Note title="This is where the work actually happens">
                  <p>
                    Everything before this board is administration. Designs are only ever drawn
                    here, on the customer’s own computer.
                  </p>
                </Note>
                <Note kind="gap" title="…and here is the second bill">
                  <p>
                    To make anything, this window needs Claude Code and a paid Anthropic
                    subscription. The customer learns it now — after paying us.
                  </p>
                </Note>
              </>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              <Browser url={<><b>cloud.maude.sh</b>/launch/alligators</>} h={300}>
                <Narrow>
                  <h1 style={{ textAlign: "center" }}>Opening in Maude…</h1>
                  <p className="cs-quiet" style={{ textAlign: "center" }}>
                    If nothing happened, use the button below.
                  </p>
                  <p style={{ textAlign: "center" }}>
                    <span className="cs-btn">Open alligators in Maude</span>
                  </p>
                  <p className="cs-quiet" style={{ textAlign: "center", marginBottom: 0 }}>
                    The link works once and expires after two minutes.
                  </p>
                </Narrow>
              </Browser>
              <div className="cs-app">
                <div className="cs-appbar">
                  <Lockup size={18} words={null} />
                  <span className="cs-title">Brno Alligators</span>
                  <span className="cs-mono">alligators.cloud.maude.sh</span>
                  <span className="cs-spacer" />
                  <span className="cs-cloudchip">
                    <i /> Connected — synced just now
                  </span>
                </div>
                <div className="cs-wsp">
                  <div className="cs-wsp-rail">
                    <div className="cs-navhd" style={{ padding: "0 0 var(--space-3)" }}>
                      Canvases
                    </div>
                    <div className="cs-wsp-row cs-on">Team Kit</div>
                    <div className="cs-wsp-row">Matchday Poster</div>
                    <div className="cs-wsp-row">Recruiting Trailer</div>
                    <div className="cs-wsp-row">Brand · logo</div>
                  </div>
                  <div className="cs-wsp-boards">
                    <div className="cs-wsp-ab" style={{ flex: 1 }}>
                      <div className="cs-wsp-cap">matchday-poster · A2</div>
                      <div className="cs-poster">
                        <span>Sat 12 Sep · 17:00 · Brno</span>
                        <b>
                          ALLIGATORS
                          <br />
                          vs OSTRAVA
                        </b>
                      </div>
                    </div>
                    <div className="cs-wsp-ab" style={{ width: 230 }}>
                      <div className="cs-wsp-cap">team-kit · palette</div>
                      <div className="cs-swatches">
                        <i style={{ background: "var(--accent)" }} />
                        <i style={{ background: "var(--bg-4)" }} />
                        <i style={{ background: "var(--status-warn)" }} />
                      </div>
                      <div className="cs-quiet" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
                        Home · away · alternate. Locked 12 Jul.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Step>
        </DCArtboard>
      </DCSection>

      {/* ──────────────────────── STAGE 4 — run it ────────────────────────── */}
      <DCSection
        id="run"
        title="4 · Run it"
        subtitle="self-administration — people, money, and the copy on GitHub"
      >
        <DCArtboard
          id="people"
          label="D1 · people · invitation · join"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="4 · Run it"
            code="D1"
            name="People → invitation → join"
            actor="owner → invitee"
            notes={
              <>
                <Note title="The invitation IS the account">
                  <p>
                    If the invited person has no Maude account, the link makes one. They never have
                    to find this project themselves.
                  </p>
                </Note>
                <Note title="Removal is honest about timing">
                  <p>
                    “Remove” reads as instantaneous and is not — tokens verify offline, so the
                    confirm screen says so <em>before</em> the decision, not in a later support
                    reply.
                  </p>
                </Note>
                <Note kind="gap" title="What can a viewer actually do?">
                  <p>
                    The invite email promises they can “look at the work”. The read-only gallery
                    exists at <code>view-…</code> but is <b>linked from nowhere</b>, and only a
                    terminal command can publish into it.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div style={{ flex: "1.35" }}>
                <div className="cs-vlabel">/projects/alligators/people</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/people</>} h={780}>
                  <Shell
                    active="people"
                    project={PROJECT}
                    title="People"
                    lede="Who is on Brno Alligators, and what each person can do."
                  >
                    <div className="cs-card">
                      <h2>Add someone</h2>
                      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                        <div className="cs-input" style={{ flex: 1 }}>their email</div>
                        <div className="cs-input" style={{ width: 130 }}>Member</div>
                        <span className="cs-btn">Send invitation</span>
                      </div>
                      <p className="cs-quiet" style={{ margin: "var(--space-4) 0 0" }}>
                        They get an email with a link. If they do not have a Maude account yet, the
                        link makes one.
                      </p>
                    </div>
                    <table className="cs-table">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>What they can do</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{ME}</td>
                          <td className="cs-quiet">Owner — everything, including billing</td>
                          <td className="cs-right cs-quiet">you</td>
                        </tr>
                        <tr>
                          <td>tomas@brno-alligators.cz</td>
                          <td className="cs-quiet">Member — can edit the designs</td>
                          <td className="cs-right cs-link">Remove</td>
                        </tr>
                        <tr>
                          <td>petra@brno-alligators.cz</td>
                          <td className="cs-quiet">Viewer — can look, not change</td>
                          <td className="cs-right cs-link">Remove</td>
                        </tr>
                      </tbody>
                    </table>
                  </Shell>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">the email → /invite/…</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
                  <div className="cs-email">
                    <div className="cs-emailhd">
                      Maude &lt;hello@maude.sh&gt; · Join Brno Alligators on Maude
                    </div>
                    <div className="cs-emailbd">
                      <p style={{ margin: "0 0 var(--space-4)" }}>
                        Michal invited you to <b style={{ color: "var(--fg-0)" }}>Brno Alligators</b>.
                        You can look at the work and follow along.
                      </p>
                      <span className="cs-btn">Join the project</span>
                    </div>
                  </div>
                  <Browser url={<><b>cloud.maude.sh</b>/invite/8f2c…</>} h={430}>
                    <Narrow>
                      <h1>Join Brno Alligators</h1>
                      <p className="cs-quiet">
                        This invitation is for <b style={{ color: "var(--fg-1)" }}>petra@brno-alligators.cz</b>.
                        Viewer — can look, not change.
                      </p>
                      <div className="cs-card">
                        <span className="cs-label" style={{ marginTop: 0 }}>Choose a password</span>
                        <div className="cs-input">at least 12 characters</div>
                        <label className="cs-check">
                          <Check />
                          <span>I’ve read what Maude Cloud stores.</span>
                        </label>
                        <span className="cs-btn">Create account and join</span>
                      </div>
                    </Narrow>
                  </Browser>
                </div>
              </div>
            </div>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="billing"
          label="D2 · billing · handed to Stripe"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="4 · Run it"
            code="D2"
            name="Billing"
            actor="owner"
            notes={
              <>
                <Note title="We state the situation; Stripe owns the numbers">
                  <p>
                    Cards, invoices, plan changes and cancelling all live in Stripe’s own portal —
                    “it is your billing relationship, so you hold it directly.”
                  </p>
                </Note>
                <Note title="The state pill is the same vocabulary as the card">
                  <p>
                    Ready · Payment did not go through · Paused. One set of words across dashboard,
                    billing and email.
                  </p>
                </Note>
                <Note kind="gap" title="The ladder below has never run">
                  <p>
                    past-due → suspend → export → purge is computed and never executed. It needs
                    proving with Stripe test clocks before a stranger’s card is ever charged.
                  </p>
                </Note>
              </>
            }
          >
            <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/billing</>}>
              <Shell
                active="billing"
                project={PROJECT}
                title="Billing"
                pill={{ tone: "ok", label: "Ready" }}
              >
                <div className="cs-card cs-ok">
                  <h2>Ready</h2>
                  <p className="cs-quiet" style={{ margin: 0 }}>
                    Studio, billed monthly. Next payment 28 August 2026.
                  </p>
                </div>
                <p style={{ marginTop: "var(--space-5)" }}>
                  <span className="cs-btn">Manage billing at Stripe</span>
                </p>
                <p className="cs-quiet" style={{ marginTop: "var(--space-4)", maxWidth: "34rem" }}>
                  Cards, invoices, plan changes and cancelling all live there — it is your billing
                  relationship, so you hold it directly.
                </p>
                <div className="cs-navsep" style={{ margin: "var(--space-7) 0" }} />
                <div className="cs-vlabel">the other states of this same page</div>
                <div style={{ display: "flex", gap: "var(--space-4)" }}>
                  <div className="cs-card cs-warn" style={{ flex: 1, marginBottom: 0 }}>
                    <h2>Payment did not go through</h2>
                    <p className="cs-quiet" style={{ margin: 0 }}>
                      Your work is safe and the project keeps running.
                    </p>
                  </div>
                  <div className="cs-card cs-stop" style={{ flex: 1, marginBottom: 0 }}>
                    <h2>Paused</h2>
                    <p className="cs-quiet" style={{ margin: 0 }}>
                      Nothing has been deleted. Restart it, or download everything and keep it.
                    </p>
                  </div>
                </div>
              </Shell>
            </Browser>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="mirror-activity"
          label="D3 · GitHub copy · activity log"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="4 · Run it"
            code="D3"
            name="GitHub copy · Activity"
            actor="owner"
            notes={
              <>
                <Note title="Additions only, never overwriting">
                  <p>
                    The project pushes itself to a repository the customer owns about once an hour.
                    It is a copy, not a sync — nothing already there is touched.
                  </p>
                </Note>
                <Note title="If we ever touch your project, it shows up here">
                  <p>
                    Including the platform’s own actions. Internal action names are translated into
                    the customer’s language (<code>AUDIT_COPY</code>) — “Routine platform check”,
                    not <code>reconcile</code>.
                  </p>
                </Note>
                <Note kind="fork" title="This pair is the trust surface">
                  <p>
                    Everything the trust page promises has to be visible on one of these two
                    screens, or it is only a promise.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div>
                <div className="cs-vlabel">/projects/alligators/mirror</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/mirror</>} h={780}>
                  <Shell
                    active="mirror"
                    project={PROJECT}
                    title="Copy to GitHub"
                    lede="This project keeps a copy of its history at brno-alligators/design on the “main” branch."
                  >
                    <div className="cs-card">
                      <span className="cs-label" style={{ marginTop: 0 }}>GitHub repository</span>
                      <div className="cs-input cs-filled">brno-alligators/design</div>
                      <span className="cs-label">Branch</span>
                      <div className="cs-input cs-filled">main</div>
                      <p style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-4)" }}>
                        <span className="cs-btn">Save</span>
                        <span className="cs-btn cs-btn--ghost">Disconnect</span>
                      </p>
                    </div>
                    <p className="cs-quiet">
                      Your project pushes itself to this repository about once an hour — additions
                      only, never overwriting anything already there. First{" "}
                      <span className="cs-link">give the Maude Mirror app access</span> to the
                      repository on GitHub, then come back here and save.
                    </p>
                  </Shell>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">/projects/alligators/audit</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/audit</>} h={780}>
                  <Shell
                    active="audit"
                    project={PROJECT}
                    title="Activity"
                    lede="Everything that happened to this project — by you, by people you invited, and by the platform itself."
                  >
                    <table className="cs-table">
                      <thead>
                        <tr>
                          <th>What</th>
                          <th>Who</th>
                          <th className="cs-right">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Opened the project from a new device</td>
                          <td className="cs-quiet">michal@…</td>
                          <td className="cs-right cs-quiet">2 min ago</td>
                        </tr>
                        <tr>
                          <td>Accepted an invitation</td>
                          <td className="cs-quiet">petra@…</td>
                          <td className="cs-right cs-quiet">yesterday</td>
                        </tr>
                        <tr>
                          <td>GitHub copy connected</td>
                          <td className="cs-quiet">michal@…</td>
                          <td className="cs-right cs-quiet">3 days ago</td>
                        </tr>
                        <tr>
                          <td>Routine platform check</td>
                          <td className="cs-quiet">platform</td>
                          <td className="cs-right cs-quiet">3 days ago</td>
                        </tr>
                        <tr>
                          <td>Project came up — billing began</td>
                          <td className="cs-quiet">michal@…</td>
                          <td className="cs-right cs-quiet">3 days ago</td>
                        </tr>
                        <tr>
                          <td>Account created with Google</td>
                          <td className="cs-quiet">michal@…</td>
                          <td className="cs-right cs-quiet">3 days ago</td>
                        </tr>
                      </tbody>
                    </table>
                  </Shell>
                </Browser>
              </div>
            </div>
          </Step>
        </DCArtboard>
      </DCSection>

      {/* ─────────────────── STAGE 5 — leave it / more devices ────────────── */}
      <DCSection
        id="depart"
        title="5 · Leave it · more devices"
        subtitle="the exit that makes the rest credible, and the door for a second machine"
      >
        <DCArtboard
          id="leave"
          label="E1 · download everything · delete"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="5 · Leave it"
            code="E1"
            name="Download everything → Delete"
            actor="owner"
            notes={
              <>
                <Note title="Delete is gated on having a copy">
                  <p>
                    You cannot reach the permanent button until a complete export exists. The exit
                    is what makes “always yours” true rather than decorative.
                  </p>
                </Note>
                <Note title="Taking it changes nothing here">
                  <p>
                    Exporting is not leaving. The project keeps running exactly as before — a
                    deliberate anti-lock-in stance.
                  </p>
                </Note>
                <Note kind="gap" title="“It opens without Maude” is a git bundle">
                  <p>
                    True for an engineer, false for the person this whole arc is staked on. On the
                    one page a <em>leaving</em> customer must use, that sentence has to change or
                    the format has to.
                  </p>
                </Note>
                <Note kind="gap" title="Delete does not purge the bytes">
                  <p>
                    Billing stops, the address detaches, state goes to <code>purged</code> — and
                    <code>tenants/&lt;id&gt;/</code> stays in storage forever. For a product whose
                    pitch is “you can leave”, this is the one thing that must not be true.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div>
                <div className="cs-vlabel">/projects/alligators/download</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/download</>} h={780}>
                  <Shell
                    active="download"
                    project={PROJECT}
                    title="Download everything"
                    lede="A complete copy of Brno Alligators: the full history as a standard git bundle, plus a list of every media file. It opens without Maude, and taking it changes nothing here."
                  >
                    <p>
                      <span className="cs-btn">Prepare a fresh copy</span>
                      <span className="cs-quiet" style={{ marginLeft: "var(--space-4)" }}>
                        takes a moment for large projects
                      </span>
                    </p>
                    <table className="cs-table" style={{ marginTop: "var(--space-6)" }}>
                      <thead>
                        <tr>
                          <th>Taken</th>
                          <th>Files</th>
                          <th className="cs-right" />
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="cs-mono">2026-07-30T09-12Z</td>
                          <td className="cs-link">alligators.bundle · media.json</td>
                          <td className="cs-right cs-quiet">184.2 MB</td>
                        </tr>
                        <tr>
                          <td className="cs-mono">2026-07-02T17-40Z</td>
                          <td className="cs-link">alligators.bundle · media.json</td>
                          <td className="cs-right cs-quiet">171.8 MB</td>
                        </tr>
                      </tbody>
                    </table>
                  </Shell>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">/projects/alligators/delete</div>
                <Browser url={<><b>cloud.maude.sh</b>/projects/alligators/delete</>} h={780}>
                  <Shell active="delete" project={PROJECT} title="Delete Brno Alligators?">
                    <div className="cs-card cs-stop">
                      <h2 style={{ color: "var(--status-error)" }}>This is permanent</h2>
                      <ul
                        className="cs-quiet"
                        style={{ margin: "var(--space-3) 0 0", paddingLeft: "var(--space-6)", lineHeight: 1.9 }}
                      >
                        <li>The workspace and its address stop existing.</li>
                        <li>Billing stops — nothing further is charged.</li>
                        <li>The copy you downloaded stays yours, forever.</li>
                      </ul>
                    </div>
                    <label className="cs-check">
                      <span className="cs-box" />
                      <span>I have my copy, and I want Brno Alligators deleted.</span>
                    </label>
                    <p style={{ marginTop: "var(--space-5)", display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                      <span className="cs-btn">Delete this project</span>
                      <span className="cs-quiet">Cancel</span>
                    </p>
                    <div className="cs-navsep" style={{ margin: "var(--space-7) 0" }} />
                    <div className="cs-vlabel">before an export exists</div>
                    <div className="cs-card">
                      <h2>Download your copy first</h2>
                      <p className="cs-quiet" style={{ margin: 0 }}>
                        Deleting is permanent, so it is only offered once a complete copy of your
                        work exists. It takes a minute and it is yours to keep.
                      </p>
                    </div>
                  </Shell>
                </Browser>
              </div>
            </div>
          </Step>
        </DCArtboard>

        <DCArtboard
          id="devices"
          label="E2 · connect an app · connected devices"
          width={1740}
          height={1000}
          fixed
          padding={40}
          background="var(--bg-0)"
        >
          <Step
            stage="5 · Leave it"
            code="E2"
            name="Connect an app · Account"
            actor="owner · any device"
            notes={
              <>
                <Note title="The other way in">
                  <p>
                    C3 is the one-click path from a project. This is the path from the app: it shows
                    a code, the human types it here, and the app signs itself in.
                  </p>
                  <p><code>POST /auth/device/code</code> → <code>/activate</code></p>
                </Note>
                <Note title="The warning is the point">
                  <p>
                    “Only enter a code you are looking at yourself, in an app you just started.
                    Anyone with this code can act as you here.” Said before the field, not after.
                  </p>
                </Note>
                <Note title="Disconnecting closes the door, not just the session">
                  <p>
                    Tokens verify offline, so revocation needs a registry the door itself reads —
                    otherwise a disconnected device keeps working until its token expires.
                  </p>
                </Note>
              </>
            }
          >
            <div className="cs-variants">
              <div>
                <div className="cs-vlabel">/activate</div>
                <Browser url={<><b>cloud.maude.sh</b>/activate</>} h={780}>
                  <Shell
                    active="account"
                    title="Connect an app"
                    lede="A Maude app on one of your devices is asking to use your account."
                  >
                    <div className="cs-card cs-warn">
                      <h2>Maude Desktop wants to use your account</h2>
                      <p className="cs-quiet" style={{ margin: 0 }}>
                        Asked for your projects and the right to open them. If you did not just
                        start that app on that machine, close this page — connecting it lets it act
                        as you.
                      </p>
                    </div>
                    <div className="cs-card">
                      <span className="cs-label" style={{ marginTop: 0 }}>
                        Confirm the code the app is showing
                      </span>
                      <div className="cs-code">KTPV-9WQR</div>
                      <p style={{ marginTop: "var(--space-5)" }}>
                        <span className="cs-btn">Connect the app</span>
                      </p>
                      <p className="cs-quiet" style={{ margin: "var(--space-4) 0 0" }}>
                        Only enter a code you are looking at yourself, in an app you just started.
                        Anyone with this code can act as you here.
                      </p>
                    </div>
                    <div className="cs-card cs-ok">
                      <h2>You’re connected</h2>
                      <p className="cs-quiet" style={{ margin: 0 }}>
                        Go back to the app — it signs itself in within a few seconds. You can close
                        this tab.
                      </p>
                    </div>
                  </Shell>
                </Browser>
              </div>
              <div>
                <div className="cs-vlabel">/account</div>
                <Browser url={<><b>cloud.maude.sh</b>/account</>} h={780}>
                  <Shell
                    active="account"
                    title="Account"
                    lede={`Signed in as ${ME}. Apps and devices connected to your account are listed here — disconnecting one signs it out the next time it checks in.`}
                  >
                    <table className="cs-table">
                      <tbody>
                        <tr>
                          <td>Maude Desktop — MacBook Pro</td>
                          <td className="cs-quiet">added 2026-07-28 · last used today</td>
                          <td className="cs-right cs-link">Disconnect</td>
                        </tr>
                        <tr>
                          <td>Maude Desktop — Mac mini</td>
                          <td className="cs-quiet">added 2026-07-12 · last used 4 days ago</td>
                          <td className="cs-right cs-link">Disconnect</td>
                        </tr>
                        <tr>
                          <td>A Maude app</td>
                          <td className="cs-quiet">added 2026-06-30 · never used</td>
                          <td className="cs-right cs-link">Disconnect</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="cs-quiet" style={{ marginTop: "var(--space-6)" }}>
                      The Maude desktop app connects itself when you sign in there.
                    </p>
                  </Shell>
                </Browser>
              </div>
            </div>
          </Step>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
