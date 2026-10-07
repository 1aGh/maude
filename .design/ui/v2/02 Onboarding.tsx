/**
 * @canvas      02 Onboarding — first launch is Home: sign in to cloud.maude.sh once, and your first sentence becomes your first project
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ob-first-launch | ob-signin-browser | ob-home-new | ob-ai-connect | ob-first-draw | ob-sig-draw |
 *              ob-invite-page | ob-invite-landed | ob-home-team |
 *              ob-local-name | ob-local-first | ob-local-share | ob-local-moved |
 *              ob-adv-open | ob-adv-sheets | ob-settings |
 *              ob-edge-offline | ob-edge-timeout | ob-edge-other-mac | ob-edge-accounts | ob-edge-ai-missing | ob-edge-whats-new
 * @brief       "nejaky onboarding ale ne tak slozity jako ted, vse smerujeme predevsim na to aby uzivatele pouzivali
 *              cloud.maude.sh vse ostatni je advanced ale rozkresli to a nebo chci jen vytvorit lokalni projekt" ·
 *              "musime proste vychazet z predpokladu ze vsichni chteji jen to nejjednodussi reseni a to je
 *              nainstalovat desktop a zatim neco tvorit."
 *
 * Replaces (and keeps every capability of) today's Onboarding (GitHub / folder / team-hub doors + success tour),
 * OnboardingTour (Menu › Help › Take the tour), CreateProject (GitHub create/open → Advanced), SetupChecklist
 * ("Bring my existing brand" → Home starter + Menu › File › Import a brand…) and Cloud Self Service
 * (A2 sign-in → browser; B1–B4 wizard / Stripe / waiting room → a silent 14-day trial, billing on the web;
 * D1–E2 people, billing, GitHub copy, download, delete, devices → Settings › General › Account opens cloud.maude.sh).
 * The full map is drawn on `ob-settings` ("Where everything went").
 *
 * Why there is no separate welcome screen: the maude-v2 empty-state prior says first run IS Home ("What shall we
 * make?", no product name, no welcome speech). The sign-in choice is a card on Home instead of a wall before it,
 * so a first launch shows one headline, not two.
 *
 * PROPOSED — Michal to confirm (defaults chosen for this pass, marked "Proposed" in the notes too):
 *   · AI is bring-your-own Claude (subscription or API key); cloud.maude.sh does not include it. Connected just in
 *     time at the first prompt — never an onboarding step.
 *   · The trial starts silently at first sign-in (14 days, no card). Billing lives on cloud.maude.sh, reached from
 *     Settings › General › Account. Nothing blocks the first canvas.
 *   · The first cloud project is named from the first sentence ("Open studio"); a blank ⌘N start is "Untitled project".
 *   · Account lives in Settings › General (CONTRACT §1 has General · Connections · Advanced, no Account tab).
 *   · A project wears a rounded square, a person a circle (tabs + Home project cards) — now kit CSS.
 *
 * Convention: every app artboard is a <Stage> — a 1440 × 900 window with its note strip underneath
 * (artboard 1440 × 980). Close-ups (ob-sig-draw, ob-adv-sheets, ob-settings) are V2 boards with their note inside.
 * All chrome comes from ./_kit; local pieces use the `ob-` prefix (ObHome lifts the kit Home markup class for class).
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "../../system/maude-v2/preview/empty-state.css";
import "./_kit.css";
import "./02 Onboarding.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT, Artboard, Avatar, Callout, ConnectSheet, Canvas, CanvasesPanel, CommentPin, Cursor, GatorMock, HeroMock, Icon, Kbd,
  Mark, Menu, Note, PanelIcon, PhoneMock, PosterMock, ProjectPill, ShareCluster, Spark, Stage, StatusWord,
  TABS, Thumb, Toast, Toolbar, V2, Veil, Window, ZoomUndo,
} from "./_kit";
import type { Art, Tab, Tone, Who } from "./_kit";

const W = 1440;
const H = 980;

/* ─── Tabs ───────────────────────────────────────────────────────────────────────────────── */
const OPEN_STUDIO: Tab = { name: "Open studio", initial: "O", color: "coral", account: "You" };
const PORTFOLIO_LOCAL: Tab = { name: "Portfolio 2026", initial: "P", color: "sky", account: "this Mac", local: true };
const PORTFOLIO_CLOUD: Tab = { name: "Portfolio 2026", initial: "P", color: "sky", account: "You", syncing: true };
const PROMPT_NEW = "A poster for my open studio on Thursday, in warm colours";

/* ═══ Local pieces (kit candidates) ═════════════════════════════════════════════════════════ */

/* ─── Home, lifted from the kit's <Home> class for class, with three extra slots:
       a placeholder, a `below` slot (the sign-in card, the empty shelf, the What's-new line),
       and the account face top right (a circle — a person — never the project's square). ─── */
type HomeCard = { name: string; art: Art; meta: string; ai?: boolean; who?: Who[] };
type HomeProject = { name: string; arts: [Art, Art, Art]; meta: string; ini: string; tone: Tone; local?: boolean };
type Starter = { t: string; l: string; art: Art; brand?: boolean };

const NEW_STARTERS: Starter[] = [
  { t: "A landing page", l: "calm and light", art: "home" },
  { t: "Three logo ideas", l: "for a new brand", art: "brand" },
  { t: "Bring my existing brand", l: "logo, colours, fonts", art: "moodboard", brand: true },
];
const STUDIO_RECENTS: HomeCard[] = [
  { name: "Homepage", art: "home", meta: "Studio site · 2 min ago", who: ["tereza"] },
  { name: "Pricing", art: "price", meta: "Studio site · Tereza is here", who: ["tereza", "jonas"] },
  { name: "Combine-kampan", art: "gator-poster", meta: "Alligators brand · yesterday", ai: true },
  { name: "Mobile — detail", art: "mobile", meta: "Studio site · Monday" },
];
const BOTH_PROJECTS: HomeProject[] = [
  { name: "Studio site", arts: ["home", "price", "onb"], meta: "5 canvases", ini: "S", tone: "yellow" },
  { name: "Alligators brand", arts: ["gator-poster", "gator-web", "gator-reel"], meta: "93 canvases", ini: "A", tone: "lilac" },
];

function ObHome({
  prompt, placeholder = "Describe it — a poster, a landing page, three logo ideas…", target, starters = NEW_STARTERS, sending = false,
  offline = false, account = false, below, recents, projects,
}: {
  prompt?: string; placeholder?: string; target: ReactNode; starters?: Starter[]; sending?: boolean; offline?: boolean; account?: boolean;
  below?: ReactNode; recents?: HomeCard[]; projects?: HomeProject[];
}) {
  return (
    <div className="k-home-bg">
      <ProjectPill project="Home" home />
      <div className="island k-home-tr"><span className="icon-btn"><Icon name="search" /></span><Kbd>⌘K</Kbd>{account ? <span className="ob-acct" title="You — signed in to cloud.maude.sh"><Avatar who="you" /></span> : null}</div>
      <div className="k-home">
        <span className={`k-home-spark${sending ? " motion-soft" : ""}`}><Spark size={48} /></span>
        <p className="k-home-title">What shall we make?</p>
        <p className="k-home-sub">Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there.</p>
        <div className="island island--pad k-home-ask">
          <div className="ask k-ask-lg">
            <span className={`k-ask-in${prompt ? "" : " k-ask-ph"}`}>{prompt ?? placeholder}{prompt && !sending ? <i className="k-caretline" /> : null}</span>
            <span className="send">{sending ? <span className="motion-soft"><Spark size={14} color="var(--spark-fg)" /></span> : <Spark size={14} color="var(--spark-fg)" />}</span>
          </div>
          <div className="k-home-askfoot">
            <span className="chip">Starts a new canvas in <strong>{target}</strong><Icon name="chevron" size={12} /></span>
            {offline ? <span className="k-home-hint ob-off-hint"><Icon name="offline" size={13} />AI is back when this Mac is online.</span> : <span className="k-home-hint"><Kbd>↵</Kbd> to send</span>}
          </div>
        </div>
        <div className="k-starters">
          {starters.map((s) => (
            <span className={`k-starter${s.brand ? " ob-starter-brand" : ""}`} key={s.t}><Thumb art={s.art} className="k-thumb--starter" /><span><strong>{s.t}</strong><span>{s.l}</span></span></span>
          ))}
        </div>
        {/* CONTRACT §7 — Home always has a way in without AI (kit Home `emptyStart`). */}
        <span className="btn btn--ghost btn--sm k-home-empty">Start with an empty canvas <Kbd>⌘N</Kbd></span>
        {below}
        {recents ? (
          <div className="k-home-sec">
            <p className="k-home-h">Recent canvases<span className="btn btn--ghost btn--sm">See all</span></p>
            <div className="k-cards">
              {recents.map((c) => (
                <span className="k-card" key={c.name}>
                  <span className="k-card-pic">
                    <Thumb art={c.art} className="k-thumb--card" />
                    {c.ai ? <span className="chip chip--spark k-card-ai"><Spark size={9} />Made by AI</span> : null}
                  </span>
                  <strong>{c.name}</strong>
                  <span className="k-card-meta">{c.meta}</span>
                  {c.who ? <span className="k-card-faces">{c.who.map((w) => <Avatar key={String(w)} who={w} size="sm" />)}</span> : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {projects ? (
          <div className="k-home-sec">
            <p className="k-home-h">Recent projects</p>
            <div className="k-projects">
              {projects.map((p) => (
                <span className="k-project" key={p.name}>
                  <span className="k-stack">{p.arts.map((a, i) => <Thumb key={i} art={a} />)}</span>
                  <span className="k-project-txt"><strong>{p.name}</strong><span>{p.meta}</span></span>
                  {p.local ? <span className="k-project-st"><Icon name="laptop" size={14} /></span> : null}
                  <Avatar ini={p.ini} tone={p.tone} size="sm" />
                </span>
              ))}
              <span className="k-project k-project--open">
                <span className="k-project-plus"><Icon name="folder" size={18} /></span>
                <span className="k-project-txt"><strong>Open project…</strong><span>Any folder works</span></span>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── The sign-in card — the welcome, folded into Home ─────────────────────────────────── */
const ADV_ROWS: { icon: string; t: string; d: string }[] = [
  { icon: "server", t: "Use a self-hosted hub", d: "Your team's own server — its address and your sign-in." },
  { icon: "folder", t: "Open a folder or a GitHub project", d: "Any folder on this Mac, or a project on GitHub." },
  { icon: "spark", t: "Connect AI now", d: "Your Claude account or an API key. Otherwise at the first prompt." },
  { icon: "terminal", t: "Install the maude command", d: "Plus the Claude Code plugin, for the terminal." },
  { icon: "insert", t: "Import from Figma", d: "Frames arrive as exact pictures; Make editable, one at a time." },
];

function AdvFlyout() {
  return (
    <div className="ob-fly">
      {ADV_ROWS.map((r) => (
        <span className="row-item ob-advrow" key={r.t}>
          <span className={`ob-advrow-ic${r.icon === "spark" ? " ob-advrow-ic--spark" : ""}`}>{r.icon === "spark" ? <Spark size={14} /> : <Icon name={r.icon} size={16} />}</span>
          <span className="ob-advrow-txt"><strong>{r.t}</strong><span>{r.d}</span></span>
          <span className="ob-advrow-ch"><Icon name="submenu" size={12} /></span>
        </span>
      ))}
      <p className="ob-fly-foot">Each row opens one sheet. Later they live in Settings › Connections and Settings › Advanced, and Search <Kbd>⌘K</Kbd> finds them.</p>
    </div>
  );
}

type DoorState = "idle" | "waiting" | "timeout" | "offline";
function SignInCard({ state = "idle", adv = false }: { state?: DoorState; adv?: boolean }) {
  const cloudBtn = (
    <span className={`btn btn--lg ob-door-btn${state === "offline" ? " ob-btn-off" : " btn--primary"}`}><Icon name="cloud" />Sign in to cloud.maude.sh</span>
  );
  const localBtn = <span className={`btn btn--lg ob-door-btn${state === "offline" ? " btn--primary" : " ob-btn-2"}`}><Icon name="laptop" />Just a local project</span>;
  return (
    <div className="ob-door" data-state={state}>
      <div className="ob-door-hd">
        <span className="ob-door-ic"><Icon name="cloud" size={18} /></span>
        <span className="ob-door-txt">
          <strong>Keep your work on cloud.maude.sh</strong>
          <span>Every Mac you use, and everyone you invite, sees the same canvases.</span>
        </span>
      </div>
      {state === "waiting" ? (
        <div className="ob-door-wait">
          <span className="ob-wait"><StatusWord state="busy">Waiting for your browser…</StatusWord></span>
          <span className="btn">Cancel</span>
          <span className="ob-door-link">Open the page again</span>
        </div>
      ) : (
        <>
          {state === "timeout" ? <p className="ob-door-line"><StatusWord state="off">Sign-in didn't finish</StatusWord><span>Nothing changed on this Mac. Try again whenever you like.</span></p> : null}
          {state === "offline" ? <p className="ob-door-line ob-door-line--warn"><StatusWord state="warn">Offline</StatusWord><span>Sign-in waits until this Mac is online — the button wakes up by itself.</span></p> : null}
          <div className="ob-door-acts">
            {state === "offline" ? <>{localBtn}{cloudBtn}</> : <>{cloudBtn}{localBtn}</>}
          </div>
        </>
      )}
      <div className="ob-door-foot">
        {state === "waiting" ? (
          <span className="ob-door-hint">Signed in on another device? <span className="ob-door-link">Enter a code instead</span></span>
        ) : state === "offline" ? (
          <span className="ob-door-hint">A local project works right now, and moves to the cloud any time.</span>
        ) : (
          <span className="ob-door-hint">Opens your browser, then brings you back. 14 days free, no card.</span>
        )}
        {state === "waiting" ? null : (
          <span className="ob-door-adv" data-open={adv ? "true" : undefined}>Advanced options<Icon name="submenu" size={12} /></span>
        )}
      </div>
      {adv ? <AdvFlyout /> : null}
    </div>
  );
}

/** The quiet shelf under Home's prompt once signed in with nothing made (lifted from 05 Empty States `es-shelf`). */
function EmptyShelf({ where, title, children }: { where: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="ob-shelf">
      <p className="ob-shelf-h"><span>Your projects</span><span className="ob-shelf-where">{where}</span></p>
      <div className="ob-shelf-row">
        <span className="ob-ghosts"><i /><i /><i /></span>
        <span className="ob-shelf-txt"><strong>{title}</strong><span>{children}</span></span>
      </div>
    </div>
  );
}

/** A plain sheet built on the kit's dialog plane. */
function ObSheet({ title, children, actions, width = 420, style, className = "" }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; width?: number; style?: CSSProperties; className?: string }) {
  return (
    <div className={`k-dialog ob-sheet ${className}`} style={{ width, ...style }}>
      <p className="k-dialog-t">{title}</p>
      {children ? <div className="k-dialog-b ob-sheet-b">{children}</div> : null}
      {actions ? <div className="k-dialog-a">{actions}</div> : null}
    </div>
  );
}

/** A collapsed (or open) "Advanced" row inside a sheet — the kit's panel disclosure, reused. */
function AdvRow({ label, open = false, children }: { label: string; open?: boolean; children?: ReactNode }) {
  return (
    <div className="k-adv ob-adv" data-open={open ? "true" : undefined}>
      <span className="k-adv-btn"><span className={`k-adv-ch${open ? " ob-rot" : ""}`}><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{label}</span></span>
      {open ? <div className="k-adv-body ob-adv-body">{children}</div> : null}
    </div>
  );
}

/** A browser window drawn in front of the app (sign-in, invite). */
function Browser({ url, children, style }: { url: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ob-br" style={style}>
      <div className="ob-br-bar">
        <span className="k-lights"><i /><i /><i /></span>
        <span className="ob-br-nav"><Icon name="submenu" size={14} /></span>
        <span className="ob-br-url"><Icon name="lock" size={12} /><span><b>cloud.maude.sh</b>{url}</span></span>
        <span className="ob-br-sp" />
      </div>
      <div className="ob-br-page">{children}</div>
    </div>
  );
}

/** A popover hanging under the Share button. */
function SharePop({ children, width = 360, className = "" }: { children: ReactNode; width?: number; className?: string }) {
  return <div className={`ob-pop ${className}`} style={{ width }}>{children}</div>;
}

/* ─── The first draft, built up piece by piece (the signature moment). Theme-fixed: it is the user's design. ─── */
function BuildPoster({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="k-mk ob-bp maude-v2 k-fixed" data-theme="light" data-step={step}>
      {step >= 2 ? <><span className="ob-bp-sun" /><span className="ob-bp-hill" /></> : <span className="ob-bp-plan ob-bp-plan--pic" />}
      <div className="ob-bp-copy">
        {step >= 3 ? (
          <strong>{step === 3 ? <>Open stu<i className="ob-bp-caret" /></> : "Open studio"}</strong>
        ) : <span className="ob-bp-plan ob-bp-plan--h" />}
        {step >= 4 ? <><span className="ob-bp-sub">Thursday 18:00 · Kounicova 12</span><em>Free entry</em></> : <span className="ob-bp-plan ob-bp-plan--d" />}
      </div>
    </div>
  );
}

/* ─── The empty canvas — lifted from 05 Empty States (`Empty size="canvas" spot="canvas"`): the
       spot-empty-canvas art, the CONTRACT line, Ask AI ⌘/. Kit candidate `EmptyCanvas` (01 · 02 · 05). ─── */
const DOT_RINGS: [string, number][] = [
  ["88,40 104,40 120,40 136,40 152,40 56,56 72,56 88,56 104,56 120,56 136,56 152,56 168,56 184,56 56,72 72,72 88,72 104,72 120,72 136,72 152,72 168,72 184,72 56,88 72,88 88,88 104,88 120,88 136,88 152,88 168,88 184,88 56,104 72,104 88,104 104,104 120,104 136,104 152,104 168,104 184,104 88,120 104,120 120,120 136,120 152,120", 1],
  ["72,24 88,24 104,24 120,24 136,24 152,24 168,24 40,40 56,40 72,40 168,40 184,40 200,40 40,56 200,56 24,72 40,72 200,72 216,72 24,88 40,88 200,88 216,88 40,104 200,104 40,120 56,120 72,120 168,120 184,120 200,120 72,136 88,136 104,136 120,136 136,136 152,136 168,136", 0.6],
  ["72,8 88,8 104,8 120,8 136,8 152,8 168,8 40,24 56,24 184,24 200,24 24,40 216,40 8,56 24,56 216,56 232,56 8,72 232,72 8,88 232,88 8,104 24,104 216,104 232,104 24,120 216,120 40,136 56,136 184,136 200,136 72,152 88,152 104,152 120,152 136,152 152,152 168,152", 0.3],
];
const LINE = { stroke: "var(--fg-2)", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function SpotSticky({ x, y, s, rot, fill, lines = 2 }: { x: number; y: number; s: number; rot: number; fill: string; lines?: number }) {
  const p = s * 0.2;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})`}>
      <rect x="0" y="2" width={s} height={s} rx="4" fill="var(--object-ink)" opacity="0.08" />
      <rect x="0" y="0" width={s} height={s} rx="4" fill={fill} {...LINE} />
      <line x1={p} y1={p} x2={s - p} y2={p} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      {lines > 1 ? <line x1={p} y1={p + 6} x2={p + (s - 2 * p) * 0.6} y2={p + 6} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" /> : null}
    </g>
  );
}
function EmptyCanvas() {
  return (
    <div className="ob-empty">
      <svg className="ob-spot" width={240} height={160} viewBox="0 0 240 160" fill="none" aria-hidden="true">
        {DOT_RINGS.map(([pts, o]) => (
          <g key={o} fill="var(--canvas-dot)" opacity={o}>
            {pts.split(" ").map((pt) => { const [cx, cy] = pt.split(","); return <circle key={pt} cx={cx} cy={cy} r="1" />; })}
          </g>
        ))}
        <g transform="translate(116 20)">
          <rect x="0" y="2" width="96" height="72" rx="8" fill="var(--object-ink)" opacity="0.08" />
          <rect x="0" y="0" width="96" height="72" rx="8" fill="var(--bg-1)" {...LINE} />
          <line x1="4" y1="-8" x2="28" y2="-8" {...LINE} opacity="0.55" />
        </g>
        <SpotSticky x={36} y={96} s={40} rot={-6} fill="var(--object-yellow)" />
        <SpotSticky x={100} y={76} s={36} rot={5} fill="var(--object-lilac)" />
        <SpotSticky x={184} y={116} s={28} rot={-3} fill="var(--object-green)" lines={1} />
      </svg>
      <p className="es-sit">Your canvas is ready.</p>
      <p className="es-next">Ask AI for a first draft, or start drawing.</p>
      <div className="es-acts"><span className="btn btn--spark btn--sm ob-ask"><Spark size={10} color="var(--spark-fg)" />Ask AI<span className="ob-ask-k">⌘/</span></span></div>
    </div>
  );
}

/* ─── Alligators brand — the real project: the kit's canonical tree (ALLIGATORS_*, 93 = 16 + 9 + 6 + 31 + 27 + 4). ─── */

/** Combine-kampan at a working zoom (for the edge boards). */
function KampanSlice({ dim = false, poster, posterSelected = false }: { dim?: boolean; poster?: ReactNode; posterSelected?: boolean }) {
  return (
    <>
      <Artboard label="Web · STAŇ SE GATOREM" kind="web" x={320} y={110} w={480} h={300} dim={dim}><GatorMock variant="web" /></Artboard>
      <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={840} y={110} w={240} h={240} dim={dim}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
      <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={1120} y={110} w={135} h={240} dim={dim}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
      <Artboard label="A4 · plakát" kind="print" x={840} y={410} w={212} h={300} dim={dim} selected={posterSelected} size="210 × 297"><GatorMock variant="poster" /></Artboard>
      <Artboard label="A4 · leták B · zadní" kind="print" x={1092} y={410} w={212} h={300} dim={dim}><GatorMock variant="print" headline="Jak na Combine" sub="Registrace · rozpis · mapa" /></Artboard>
      <Artboard label="16:9 · teaser" kind="video" x={320} y={460} w={305} h={172} dim={dim}><GatorMock variant="web" headline="COMBINE 2026" sub="Teaser · 0:30" /></Artboard>
      {poster}
    </>
  );
}

/** Portfolio 2026 — the local project after a little work. */
function PortfolioBoards() {
  return (
    <>
      <Artboard label="Cover" kind="print" x={300} y={140} w={260} h={368}><PosterMock title="Portfolio 2026" sub="Product and brand · Brno" tone="sky" /></Artboard>
      <Artboard label="Case study — Alligators rebrand" kind="web" x={600} y={140} w={480} h={300}><HeroMock headline="Brno Alligators, redrawn." sub="A club brand that works on a helmet and a phone." cta="Read the case" /></Artboard>
      <Artboard label="Contact" kind="web" x={1120} y={140} w={150} h={325}><PhoneMock title="Say hello" tone="sky" /></Artboard>
    </>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function Onboarding() {
  return (
    <DesignCanvas>
      {/* ── 1 · Cloud first — a brand-new account ───────────────────────────────────────────── */}
      <DCSection id="cloud-first" title="Cloud first — a brand-new account" subtitle="First launch is Home: sign in once in the browser, then your first sentence becomes your first cloud project — no wizard, no card, no tour">
        <DCArtboard id="ob-first-launch" label="1 · First launch is Home" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="One headline, one obvious button.">First launch is Home itself — the question, the prompt, and one card: Sign in to cloud.maude.sh, or Just a local project. Everything else waits behind Advanced options.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home" label="Maude — first launch">
              <Canvas><ObHome target="a new project" below={<SignInCard />} /></Canvas>
              <Callout outline n={1} x={404} y={458} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-signin-browser" label="2 · Sign in in the browser" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Sign in where you already sign in.">Google or email; the same buttons make a new account. The app waits in words with Cancel — it can't see a closed tab, so the page has its own Cancel too. Then the browser asks, once, to open Maude.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas><ObHome target="a new project" below={<SignInCard state="waiting" />} /></Canvas>
              <Callout outline n={1} x={404} y={524} />
              <div className="ob-osprompt" style={{ left: 40, top: 640 }}>
                <span className="chip ob-osprompt-tag">The browser's own prompt — then, once</span>
                <strong>Open Maude?</strong>
                <span>cloud.maude.sh wants to open this application.</span>
                <span className="ob-osprompt-chk"><i />Always allow cloud.maude.sh to open Maude</span>
                <span className="ob-osprompt-a"><span className="btn btn--sm">Cancel</span><span className="btn btn--sm btn--primary">Open Maude</span></span>
              </div>
              <Callout outline n={2} x={26} y={626} />
            </Window>
            <Browser url="/sign-in" style={{ left: 880, top: 112, width: 540, height: 640 }}>
              <div className="ob-web">
                <Mark size={40} />
                <p className="ob-web-t">Sign in to cloud.maude.sh</p>
                <p className="ob-web-s">Then this page sends you back to the app.</p>
                <span className="btn btn--lg ob-web-btn">Continue with Google</span>
                <span className="ob-web-or"><i />or<i /></span>
                <span className="input ob-web-in">you@studio.cz</span>
                <span className="btn btn--primary btn--lg ob-web-btn">Continue with email</span>
                <p className="ob-web-fine">New here? The same buttons make your account.<br />The first 14 days are free — no card.</p>
                <span className="ob-web-cancel">Cancel and go back to the app</span>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-home-new" label="3 · Back on Home — signed in, nothing made yet" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Proposed: the trial starts by itself.">No plan to pick, no card, no waiting room — 14 free days start silently and billing lives on cloud.maude.sh. The chip says the sentence starts a new project.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas>
                <ObHome account prompt={PROMPT_NEW} target="a new project" below={
                  <EmptyShelf where={<><Icon name="cloud" size={13} />cloud.maude.sh</>} title="No projects yet.">Your first canvas starts one — and everyone you invite sees it here.</EmptyShelf>
                } />
              </Canvas>
              <Toast at="top" icon="done">Signed in. What you make now lives on cloud.maude.sh.</Toast>
              <Callout outline n={1} x={1294} y={26} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-ai-connect" label="4 · First send — connect Claude, just in time" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Proposed: AI is yours, connected when you first ask.">The cloud keeps and shares canvases; AI runs on your own Claude account. One sheet at the first send, then the sentence runs. Cancel leaves a ready, empty canvas.</Note>}>
            <Window tabs={[TABS.home, OPEN_STUDIO]} activeTab={1}>
              <Canvas>
              </Canvas>
              <ProjectPill project="Open studio" canvas="Poster" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={[]} status="saved" mode="edit" />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <AIPanel chat="New chat" advanced messages={[{ from: "you", text: PROMPT_NEW }]} />
              <Veil strong />
              <ConnectSheet style={{ left: 560 }} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-first-draw" label="5 · AI draws the first canvas" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Straight into making — nothing on top of it.">The poster builds piece by piece on the first canvas. No tip card while AI works; the project's name came from the sentence, and Rename is the toast's one action.</Note>}>
            <Window tabs={[TABS.home, OPEN_STUDIO]} activeTab={1}>
              <Canvas>
                <Artboard label="A4 · poster" kind="print" x={420} y={90} w={300} h={424} aiWorking="AI is writing the headline" aiAt="below" aiCursor={{ x: "56%", y: "84%" }}><BuildPoster step={3} /></Artboard>
              </Canvas>
              <ProjectPill project="Open studio" canvas="Poster" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={[]} status="saved" mode="edit" />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <AIPanel chat="A poster for the open studio" advanced messages={[{ from: "you", text: PROMPT_NEW }, { from: "ai", text: "Claude account connected. An A4 poster is on the canvas — the words are going in now." }]} working="AI is writing the headline" step="3 of 4 · button next" />
              <Toast at="top" icon="cloud" action="Rename">Open studio is your first project, on cloud.maude.sh.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-sig-draw" label="6 · How a first draft arrives" width={W} height={860} fixed>
          <V2 className="ob-closeup">
            <div className="ob-closeup-top">
              <p className="ob-closeup-h">A first draft arrives piece by piece — never a spinner.</p>
              <p className="ob-closeup-s">The artboard is there in the first second. Big shapes land before small ones; words type in where the AI cursor sits. The same choreography every time AI makes something new.</p>
            </div>
            <div className="ob-film">
              <Artboard label="A4 · poster" kind="print" x={0} y={0} w={260} h={368} aiWorking="AI is placing the colour" aiAt="below" aiCursor={{ x: "50%", y: "20%" }}><BuildPoster step={1} /></Artboard>
              <Artboard label="A4 · poster" kind="print" x={360} y={0} w={260} h={368} aiWorking="AI is drawing the picture" aiAt="below" aiCursor={{ x: "70%", y: "38%" }}><BuildPoster step={2} /></Artboard>
              <Artboard label="A4 · poster" kind="print" x={720} y={0} w={260} h={368} aiWorking="AI is writing the headline" aiAt="below" aiCursor={{ x: "56%", y: "84%" }}><BuildPoster step={3} /></Artboard>
              <Artboard label="A4 · poster" kind="print" x={1080} y={0} w={260} h={368} aiMade selected size="210 × 297"><BuildPoster step={4} /></Artboard>
              <span className="k-tip ob-film-hint" style={{ left: 1080, top: 410 }}><Kbd>⌘</Kbd><Kbd>/</Kbd>Select anything, then ask AI to change it.</span>
            </div>
            <div className="ob-rail">
              {[
                ["0 s", "Paper and colour", "The artboard opens at A4 and takes the warm colour. Dashed spark marks show where the rest will go."],
                ["1 s", "The picture", "Shapes land with one spring (--dur-spring). Big before small, back to front."],
                ["3 s", "The words", "The headline types in at the AI cursor. Stop keeps whatever is already there."],
                ["6 s", "Done — one hint", "Made by AI sits in the label row. The only tip is the one that fits the first selection."],
              ].map(([t, h, d]) => (
                <div className="ob-rail-step" key={t}><span className="ob-rail-t">{t}</span><strong>{h}</strong><span>{d}</span></div>
              ))}
            </div>
            <div className="ob-closeup-note"><Note n={6} title="Reduced motion: each piece simply appears.">The order stays — colour, picture, words, details — so the draft still reads as being made. Undo ⌘Z takes back the whole draft in one step.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Joining a team ──────────────────────────────────────────────────────────────── */}
      <DCSection id="invite" title="Joining a team" subtitle="Tereza's link, opened before Maude is installed — install, sign in, and you land on her comment, not on a menu">
        <DCArtboard id="ob-invite-page" label="7 · The invite, in the browser" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="The link explains itself.">Who invited you, to what, and her comment — then one download. Already installed? Open in Maude. After install, sign-in is step 2 again and the invite does the rest.</Note>}>
            <Browser url="/invite/combine-kampan" style={{ left: 0, top: 0, width: 1440, height: 900, borderRadius: "var(--radius-lg)" }}>
              <div className="ob-inv">
                <span className="ob-inv-who"><Avatar who="tereza" size="lg" /><Mark size={32} /></span>
                <p className="ob-inv-t">Tereza invited you to Alligators brand</p>
                <p className="ob-inv-s">93 canvases · Tereza and Jonas work here</p>
                <div className="ob-inv-card">
                  <Thumb art="gator-poster" w={220} h={150} className="ob-inv-thumb" />
                  <div className="ob-inv-c">
                    <strong>Combine-kampan</strong>
                    <span className="ob-inv-cm"><Avatar who="tereza" size="sm" /><span>“Můžeš mrknout na plakát do pátku? Logo bych dal větší.”</span></span>
                  </div>
                </div>
                <span className="btn btn--primary btn--lg ob-inv-btn">Download Maude for Mac</span>
                <span className="btn btn--ghost ob-inv-open">Already installed? Open in Maude</span>
                <div className="ob-inv-steps">
                  <span><b>1</b>Download and open</span>
                  <span><b>2</b>Sign in</span>
                  <span><b>3</b>You're on the poster, by Tereza's comment</span>
                </div>
                <p className="ob-inv-fine">Just looking? <u>See it in the browser</u> — view only, any computer.</p>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-invite-landed" label="8 · Landed on her comment" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="No Home, no picking — you land where she pointed.">The camera eases from the whole canvas onto the poster and stops at Tereza's comment, reply field ready. She's here, live. This is how every entry point should feel.</Note>}>
            <Window tabs={[TABS.home, TABS.alligators]} activeTab={1}>
              <Canvas>
                <Artboard label="A4 · plakát" kind="print" x={360} y={100} w={300} h={424}><GatorMock variant="poster" /></Artboard>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={1080} y={100} w={240} h={240}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={1080} y={404} w={135} h={240}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
                <span className="ob-focus" style={{ left: 382, top: 122 }} />
                <CommentPin who="tereza" x={396} y={136} />
                <div className="ob-thread" style={{ left: 700, top: 100 }}>
                  <span className="ob-thread-hd"><Avatar who="tereza" /><span><strong>Tereza</strong><span>2 h ago · on A4 · plakát</span></span><span className="btn btn--ghost btn--sm">Resolve</span></span>
                  <p className="ob-thread-txt">Můžeš mrknout na plakát do pátku? Logo bych dal větší.</p>
                  <span className="ob-thread-in"><span className="input ob-in-focus">Reply to Tereza<i className="k-caretline" /></span></span>
                  <span className="ob-thread-foot"><span>Tereza is on this canvas now</span><span className="k-home-hint"><Kbd>↵</Kbd> to send</span></span>
                </div>
                <Cursor name="Tereza" color="sky" x={590} y={300} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel project="Alligators brand" count={ALLIGATORS_COUNT} selected="Combine-kampan" folders={ALLIGATORS_FOLDERS} items={ALLIGATORS_ROOT} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={55} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Toast at="top" icon="people">Tereza invited you here — her comment is on the poster.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-home-team" label="9 · Next time — Home shows the team's work" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="A team is just more on Home.">After the invite, Home shows Alligators brand — 93 canvases, Tereza and Jonas on them. Say what to make: the chip puts it in Alligators brand.</Note>}>
            <Window tabs={[TABS.home, TABS.alligators]} activeTab="home">
              <Canvas>
                <ObHome
                  account
                  prompt="A matchday poster for Saturday — Gators vs. Steelers"
                  target="Alligators brand"
                  starters={[
                    { t: "A matchday poster", l: "in the club's green", art: "gator-poster" },
                    { t: "Three reel covers", l: "for Krpole v pohybu", art: "gator-reel" },
                    { t: "A sponsors post", l: "1:1, with all logos", art: "gator-social" },
                  ]}
                  recents={[
                    { name: "Combine-kampan", art: "gator-poster", meta: "Alligators brand · 1 h ago", who: ["tereza", "jonas"] },
                    { name: "Uniformy-2027", art: "gator-jersey", meta: "Alligators brand · Jonas, yesterday", who: ["jonas"] },
                    { name: "matchday", art: "gator-social", meta: "Alligators brand · Monday", who: ["tereza"] },
                    { name: "video-hype", art: "gator-reel", meta: "Alligators brand · last week", ai: true },
                  ]}
                  projects={[{ name: "Alligators brand", arts: ["gator-poster", "gator-web", "gator-reel"], meta: "93 canvases · Tereza, Jonas", ini: "A", tone: "lilac" }]}
                />
              </Canvas>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Just a local project ────────────────────────────────────────────────────────── */}
      <DCSection id="local" title="“Just a local project”" subtitle="No account: name it, make something, and move it to the cloud only when you want to share">
        <DCArtboard id="ob-local-name" label="10 · Name it — that's all" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="A name, and you're in.">The project is kept in your Maude folder on this Mac — said in words. The folder path is under Advanced (opened on the right), never in the way.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas><ObHome target="a new project" below={<SignInCard />} /></Canvas>
              <Veil strong />
              <ObSheet title="Create a local project" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Create project</span></>}>
                <span className="field">
                  <span className="field-label">Name</span>
                  <span className="input ob-in-focus">Portfolio 2026<i className="k-caretline" /></span>
                  <span className="field-hint">Kept on this Mac, in your Maude folder. Move it to the cloud any time.</span>
                </span>
                <AdvRow label="Location" />
              </ObSheet>
              <Callout outline n={1} x={496} y={322} />
              <div className="ob-inset" style={{ left: 990, top: 470 }}>
                <span className="chip ob-inset-tag">Advanced, opened</span>
                <AdvRow label="" open>
                  <span className="ob-loc"><span>Location</span><span className="k-mono">~/Maude/Portfolio 2026</span></span>
                  <span className="ob-loc-acts"><span className="btn btn--sm">Choose another folder…</span></span>
                </AdvRow>
              </div>
              <Callout outline n={2} x={976} y={456} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-local-first" label="11 · The first local canvas" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Local is just as ready.">The project opens on an empty canvas with the usual line. AI works the same here — the first Ask AI connects your Claude account, once. Status says Local project.</Note>}>
            <Window tabs={[TABS.home, PORTFOLIO_LOCAL]} activeTab={1}>
              <Canvas>
                <EmptyCanvas />
              </Canvas>
              <ProjectPill project="Portfolio 2026" canvas="Untitled canvas" />
              <CanvasesPanel project="Portfolio 2026" count={1} selected="Untitled canvas" items={[{ name: "Untitled canvas", art: "blank", meta: "now" }]} />
              <ShareCluster people={[]} status="local" mode="edit" />
              <ZoomUndo zoom={100} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-local-share" label="12 · Local — Share offers the cloud" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Local, said in two quiet places — then a calm offer.">The tab carries a laptop and the status word says Local project. Nothing nags. Only Share offers the cloud, because sharing needs it.</Note>}>
            <Window tabs={[TABS.home, PORTFOLIO_LOCAL]} activeTab={1}>
              <Canvas><PortfolioBoards /></Canvas>
              <ProjectPill project="Portfolio 2026" canvas="Case studies" />
              <CanvasesPanel project="Portfolio 2026" count={3} selected="Case studies" items={[
                { name: "Case studies", art: "home" },
                { name: "Cover ideas", art: "board" },
                { name: "CV", art: "onb" },
              ]} />
              <ShareCluster people={[]} status="local" mode="edit" />
              <ZoomUndo zoom={36} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <SharePop>
                <p className="ob-pop-t">Move “Portfolio 2026” to the cloud?</p>
                <p className="ob-pop-b">Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It stays on this Mac too.</p>
                <span className="ob-pop-a"><span className="btn">Cancel</span><span className="btn btn--primary">Move to cloud</span></span>
                <p className="ob-pop-foot">Only need a file? Menu › Export… <Kbd>⇧⌘E</Kbd></p>
              </SharePop>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-local-moved" label="13 · Moved — now Share invites" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="One move, and it's shareable.">Not signed in yet? Move to cloud opens the browser sign-in from step 2 first. Canvases go up in the background; inviting by GitHub username waits under Advanced.</Note>}>
            <Window tabs={[TABS.home, PORTFOLIO_CLOUD]} activeTab={1}>
              <Canvas><PortfolioBoards /></Canvas>
              <ProjectPill project="Portfolio 2026" canvas="Case studies" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={[]} status="syncing" mode="edit" />
              <ZoomUndo zoom={36} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <SharePop width={380}>
                <p className="ob-pop-t">Share “Portfolio 2026”</p>
                <span className="ob-invite"><span className="input ob-invite-in">tereza@alligators.cz<i className="k-caretline" /></span><span className="btn btn--primary">Invite</span></span>
                <span className="ob-person"><Avatar who="you" /><span className="ob-person-n">You</span><span className="ob-person-r">Owner</span></span>
                <span className="ob-linkrow"><Icon name="link" size={14} /><span className="ob-linkrow-t">Anyone with the link<span>Can view</span></span><span className="btn btn--sm">Copy link</span></span>
                <AdvRow label="Invite by GitHub username" />
              </SharePop>
              <Toast at="top" icon="cloud">Moved to the cloud — 3 canvases are going up now.</Toast>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Advanced ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced — one disclosure away, nothing removed" subtitle="Self-hosted hub, a folder or GitHub project, AI connected up front, the maude command and plugin, Figma — and where every old door went">
        <DCArtboard id="ob-adv-open" label="14 · Advanced options, opened" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Everything today's onboarding could do — folded.">One click opens the list beside the card; each row is one sheet. It is closed again next time; the same rows live in Settings › Connections and › Advanced.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas><ObHome target="a new project" below={<SignInCard adv />} /></Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-adv-sheets" label="15 · The Advanced sheets" width={W} height={H} fixed>
          <V2 className="ob-closeup">
            <p className="ob-closeup-h">One sheet per Advanced row — plus invite by GitHub username, under Share.</p>
            <div className="ob-grid">
              <ObSheet className="ob-sheet--static" title="Connect to your own hub" width={440} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Connect</span></>}>
                <span className="field">
                  <span className="field-label">Hub address</span>
                  <span className="ob-row2"><span className="input k-mono ob-mono">https://maude.alligators.cz</span><span className="btn btn--sm">Test connection</span></span>
                  <span className="ob-ok"><StatusWord state="ok">Reachable — hub 1.4</StatusWord></span>
                </span>
                <span className="seg ob-seg"><span className="k-seg-b" aria-pressed="true">Email and password</span><span className="k-seg-b" aria-pressed="false">Invite link or key</span></span>
                <span className="ob-row2">
                  <span className="input ob-ph">you@alligators.cz</span>
                  <span className="input ob-ph">Password</span>
                </span>
                <p className="ob-fine">Projects on this hub open like cloud ones. cloud.maude.sh stays signed in too.</p>
              </ObSheet>

              <ObSheet className="ob-sheet--static" title="Open a folder or a GitHub project" width={440} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Open</span></>}>
                <span className="seg ob-seg"><span className="k-seg-b" aria-pressed="false">A folder on this Mac</span><span className="k-seg-b" aria-pressed="true">From GitHub</span></span>
                <span className="ob-list">
                  <span className="row-item" aria-current="true"><Icon name="lock" size={12} /><span className="k-mono ob-list-n">brno-alligators/brand</span><span className="ob-list-m">Private</span></span>
                  <span className="row-item"><Icon name="lock" size={12} /><span className="k-mono ob-list-n">brno-alligators/club-web</span><span className="ob-list-m">Private</span></span>
                  <span className="row-item"><Icon name="folder" size={12} /><span className="k-mono ob-list-n">1aGh/personal-page</span><span className="ob-list-m">Public</span></span>
                </span>
                <span className="input ob-ph">Or paste a GitHub link</span>
                <span className="ob-newgh"><Icon name="plus" size={12} />New project on GitHub — private by default</span>
              </ObSheet>

              <ObSheet className="ob-sheet--static" title="Connect AI" width={440} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Connect</span></>}>
                <span className="ob-opt" data-on="true">
                  <span className="ob-radio" />
                  <span className="ob-opt-txt"><strong>Claude Pro or Max</strong><span>Sign in through your browser. Claude Code is set up for you.</span></span>
                </span>
                <span className="ob-opt">
                  <span className="ob-radio" />
                  <span className="ob-opt-txt"><strong>API key</strong><span>Pay as you go, from your Anthropic console.</span><span className="input k-mono ob-mono ob-ph">sk-ant-…</span></span>
                </span>
                <span className="ob-ok"><StatusWord state="off">Not connected yet — or connect at your first prompt</StatusWord></span>
              </ObSheet>

              <ObSheet className="ob-sheet--static" title="Install the maude command" width={440} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Install</span></>}>
                <span className="ob-inst"><span className="ob-inst-ic"><Icon name="terminal" /></span><span className="ob-inst-t"><strong>maude command</strong><span>Start, serve and script projects from the terminal.</span></span><StatusWord state="off">Not installed</StatusWord></span>
                <span className="ob-inst"><span className="ob-inst-ic"><Icon name="layers" size={14} /></span><span className="ob-inst-t"><strong>Claude Code plugin</strong><span>The design and flow commands, inside Claude Code.</span></span><StatusWord state="ok">Installed</StatusWord></span>
                <span className="ob-cmds">
                  <span className="ob-cmds-h">Or in Terminal</span>
                  <span className="ob-cmd"><span className="k-mono">npm i -g @1agh/maude</span><span className="chip">Copy</span></span>
                  <span className="ob-cmd"><span className="k-mono">/plugin marketplace add 1aGh/maude</span><span className="chip">Copy</span></span>
                </span>
              </ObSheet>

              <ObSheet className="ob-sheet--static" title="Import from Figma" width={440} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Import</span></>}>
                <span className="field">
                  <span className="field-label">Figma link</span>
                  <span className="input k-mono ob-mono">figma.com/design/…/Uniformy-2027</span>
                </span>
                <span className="ob-ok"><StatusWord state="ok">Figma connected</StatusWord></span>
                <p className="ob-fine">Each frame arrives as an artboard on a new canvas in Alligators brand — Figma's exact picture of it. Make editable turns one artboard into layers; it needs Figma Dev Mode, on a paid seat.</p>
                <AdvRow label="Access token" />
              </ObSheet>

              <div className="ob-pop ob-pop--static" style={{ width: 440 }}>
                <p className="ob-pop-t">Share “Combine-kampan”</p>
                <span className="ob-invite"><span className="input ob-ph ob-invite-flat">Email address</span><span className="btn btn--primary">Invite</span></span>
                <AdvRow label="Invite by GitHub username" open>
                  <span className="ob-invite"><span className="input k-mono ob-mono ob-invite-in">@jonas-gator<i className="k-caretline" /></span><span className="btn">Invite</span></span>
                  <span className="ob-fine ob-fine--in">They get access the next time they sign in with GitHub.</span>
                </AdvRow>
              </div>
            </div>
            <div className="ob-closeup-note"><Note n={15} title="Advanced language is allowed here, and only here.">Addresses, commands, GitHub names and keys show in mono inside these sheets. Each title asks with its main button's verb; the other button is Cancel.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="ob-settings" label="16 · Settings and where every old door went" width={W} height={H} fixed>
          <V2 className="ob-closeup">
            <p className="ob-closeup-h">Settings holds the rest — and nothing from today's onboarding is gone.</p>
            <div className="ob-grid">
              <div className="ob-set">
                <div className="ob-set-hd"><strong>Settings</strong><span className="seg ob-seg"><span className="k-seg-b" aria-pressed="true">General</span><span className="k-seg-b" aria-pressed="false">Connections</span><span className="k-seg-b" aria-pressed="false">Advanced</span></span></div>
                <p className="ob-set-g">Account</p>
                <span className="ob-set-me"><Avatar who="you" size="lg" /><span><strong>You</strong><span>Signed in to cloud.maude.sh</span></span></span>
                <span className="ob-set-row"><span>Plan</span><span className="ob-set-v">Free trial · 12 days left</span></span>
                <span className="btn ob-set-btn"><Icon name="link" size={14} />Manage on cloud.maude.sh</span>
                <span className="ob-set-links">
                  {["People and invites", "Billing and plan", "Your Macs", "Download everything", "Delete the account"].map((l) => <span className="row-item" key={l}><span>{l}</span><Icon name="link" size={12} /></span>)}
                </span>
                <p className="ob-set-g">Look</p>
                <span className="ob-set-row"><span>Theme</span><span className="seg ob-seg"><span className="k-seg-b" aria-pressed="false">Light</span><span className="k-seg-b" aria-pressed="false">Dark</span><span className="k-seg-b" aria-pressed="true">Auto</span></span></span>
              </div>

              <div className="ob-set">
                <div className="ob-set-hd"><strong>Settings</strong><span className="seg ob-seg"><span className="k-seg-b" aria-pressed="false">General</span><span className="k-seg-b" aria-pressed="true">Connections</span><span className="k-seg-b" aria-pressed="false">Advanced</span></span></div>
                {([
                  ["cloud", "cloud.maude.sh", "Where your projects live.", ["ok", "Signed in"], "Sign out"],
                  ["server", "Your own hub", "A self-hosted server, beside the cloud.", ["off", "Not connected"], "Connect…"],
                  ["spark", "AI — your Claude account", "Pro or Max, or an API key.", ["ok", "Connected"], "Change…"],
                  ["insert", "Figma", "For Import from Figma.", ["off", "No token"], "Add token…"],
                  ["lock", "GitHub", "GitHub projects and invites by username.", ["ok", "Connected"], "Disconnect"],
                ] as [string, string, string, ["ok" | "off", string], string][]).map(([ic, t, d, [st, w], a]) => (
                  <span className="ob-conn" key={t}>
                    <span className={`ob-advrow-ic${ic === "spark" ? " ob-advrow-ic--spark" : ""}`}>{ic === "spark" ? <Spark size={14} /> : <Icon name={ic} size={16} />}</span>
                    <span className="ob-conn-t"><strong>{t}</strong><span>{d}</span><StatusWord state={st}>{w}</StatusWord></span>
                    <span className="btn btn--sm">{a}</span>
                  </span>
                ))}
              </div>

              <div className="ob-where">
                <p className="ob-where-t">Where every old door went</p>
                {([
                  ["The GitHub door", "Advanced options › Open a folder or a GitHub project"],
                  ["The folder door", "Just a local project · Menu › File › Open project… ⌘O"],
                  ["The team-hub door", "Advanced options › Use a self-hosted hub (email + password)"],
                  ["Invite by GitHub username", "Share › Advanced"],
                  ["AI setup, Claude Code", "At the first prompt · Settings › Connections · Menu › Diagnostics › AI setup"],
                  ["Bring my existing brand", "Home starter · Menu › File › Import a brand…"],
                  ["Figma import", "Advanced options · Menu › File › Import from Figma…"],
                  ["maude command, plugin", "Advanced options · Settings › Advanced"],
                  ["People, billing, Macs, download, delete", "Settings › General › Manage on cloud.maude.sh"],
                  ["Sign in with a code", "Waiting for your browser… › Enter a code instead"],
                  ["The success tour", "Menu › Help › Take the tour"],
                ] as [string, string][]).map(([o, n]) => (
                  <span className="ob-where-row" key={o}><span className="ob-where-o">{o}</span><span className="ob-where-n">{n}</span></span>
                ))}
                <p className="ob-fine ob-where-fine">Search <Kbd>⌘K</Kbd> finds every one of these by name — “hub”, “figma”, “api key”, “billing”.</p>
              </div>
            </div>
            <div className="ob-closeup-note"><Note n={16} title="Proposed: the account is a web page, opened from one button.">People, billing, your Macs, download everything and delete live on cloud.maude.sh — Manage on cloud.maude.sh opens them in the browser, signed in.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Edge cases ──────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When the first run isn't simple" subtitle="Offline, a sign-in that never finished, a second Mac, a work invite in a personal app, no AI yet, after an update — words, not errors">
        <DCArtboard id="ob-edge-offline" label="17 · Offline at first launch" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Offline swaps the buttons, not the screen.">Just a local project becomes the main button and the cloud one rests, then wakes up by itself. Ask AI stays on: a prompt sent now is queued until the Mac is online.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas><ObHome offline target="a project on this Mac" below={<SignInCard state="offline" />} /></Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-edge-timeout" label="18 · Sign-in never finished" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Cancelled or forgotten — not a failure.">Cancel in the app or on the web page brings the card back at once; a tab left open ends the wait after 10 minutes. One line says nothing changed, buttons live.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas><ObHome target="a new project" below={<SignInCard state="timeout" />} /></Canvas>
              <Callout outline n={1} x={404} y={524} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-edge-other-mac" label="19 · Already signed in on another Mac" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="A second Mac is just a sign-in.">Cloud projects and recents arrive by themselves. A local project stays on the Mac that made it — Share › Move to cloud there brings it here.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas>
                <ObHome
                  account
                  target="Studio site"
                  recents={[
                    { name: "Combine-kampan", art: "gator-poster", meta: "Alligators brand · 2 h ago", who: ["tereza"] },
                    { name: "Pricing", art: "price", meta: "Studio site · Tereza is here", who: ["tereza", "jonas"] },
                    { name: "Homepage", art: "home", meta: "Studio site · yesterday" },
                    { name: "Uniformy-2027", art: "gator-jersey", meta: "Alligators brand · Monday", who: ["jonas"] },
                  ]}
                  starters={[
                    { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                    { t: "Three logo ideas", l: "for Alligators brand", art: "brand" },
                    { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
                  ]}
                  projects={BOTH_PROJECTS}
                />
              </Canvas>
              <Toast at="top" icon="done">Signed in — your 2 cloud projects are here.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-edge-accounts" label="20 · A work invite in a personal app" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="The invite says who it's for.">Tereza invited your work address; this app is signed in as you, personally. Open puts the invite in its own tab, signed in as work — your other tabs don't change.</Note>}>
            <Window tabs={[TABS.home, TABS.studio]} activeTab="home">
              <Canvas>
                <ObHome account target="Studio site" recents={STUDIO_RECENTS} projects={BOTH_PROJECTS.slice(0, 1)} starters={[
                  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                  { t: "Three logo ideas", l: "for a new brand", art: "brand" },
                  { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
                ]} />
              </Canvas>
              <Veil strong />
              <ObSheet title="Open the invite as you@work-studio.cz?" width={460} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Open</span></>}>
                <p>Tereza invited that address to Alligators brand. This window is signed in with your personal account.</p>
                <span className="ob-acc">
                  <span className="ob-acc-row"><Avatar who="you" size="lg" /><span className="ob-acc-t"><strong>You · personal</strong><span>This window, now</span></span></span>
                  <span className="ob-acc-arrow"><Icon name="submenu" size={14} /></span>
                  <span className="ob-acc-row"><span className="ob-acc-work"><Avatar ini="M" tone="sky" size="lg" /><i><Icon name="people" size={10} /></i></span><span className="ob-acc-t"><strong>you@work-studio.cz</strong><span>Work · a new tab</span></span></span>
                </span>
                <p className="ob-fine">Opens Alligators brand in its own tab, signed in as you@work-studio.cz. To switch the whole app: Settings › General › Account.</p>
              </ObSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-edge-ai-missing" label="21 · No AI connected yet — on a team project" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="Ask AI looks the same; the first use asks once.">Each person brings their own Claude account — Tereza's doesn't cover you. ⌘/ on the poster opens the one sheet; after Connect, the waiting prompt runs.</Note>}>
            <Window tabs={[TABS.home, TABS.alligators]} activeTab={1}>
              <Canvas>
                <KampanSlice posterSelected />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={18} />
              <Toolbar />
              <AIPanel chat="New chat" advanced scope="A4 · plakát" messages={[{ from: "you", text: "Make the logo bigger, like Tereza asked" }]} />
              <Veil strong />
              <ConnectSheet style={{ left: 560 }} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ob-edge-whats-new" label="22 · After an update — findable, never in the way" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="Updates don't interrupt.">You land where you left off — from 1.x too, signed in as before. Home shows one quiet line once; Menu › Help keeps the dot until you read it. No modal, no tour.</Note>}>
            <Window tabs={[TABS.home, TABS.studio, TABS.alligators]} activeTab="home">
              <Canvas>
                <ObHome account target="Studio site" recents={STUDIO_RECENTS} projects={BOTH_PROJECTS} starters={[
                  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                  { t: "Three logo ideas", l: "for Alligators brand", art: "brand" },
                  { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
                ]} below={<span className="ob-new"><i className="k-mi-dot" />What's new in 2.0 — one menu, calmer panels, cloud first.<span className="ob-door-link">See what's new</span></span>} />
              </Canvas>
              <Callout outline n={1} x={472} y={436} />
              <div className="ob-menuinset">
                <span className="chip ob-inset-tag">Menu › Help</span>
                <Menu width={232} style={{ position: "relative", left: 0, top: 0 }} items={[
                  { label: "Keyboard shortcuts", keys: "?" }, { label: "Help and guides", keys: "F1" }, { label: "What's new", dot: true, highlight: true }, { label: "Take the tour" },
                  { label: "Watch the intro" }, { label: "How sharing works" }, "sep", { label: "Report a bug…" },
                ]} />
              </div>
              <Callout outline n={2} x={112} y={464} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
