/**
 * @canvas      04 Modes — Edit, Preview and Present, plus the tools that look like modes (Comment, Annotations, Inspect)
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   md-model | md-keys |
 *              md-edit |
 *              md-motion | md-preview | md-preview-follow | md-preview-combine |
 *              md-present-menu | md-present-lift | md-present-full | md-present-video | md-present-canvas | md-presenter | md-present-link |
 *              md-comment | md-comment-only |
 *              md-draw |
 *              md-inspect |
 *              md-edge-ai | md-edge-viewer | md-edge-mixed | md-edge-offline | md-esc
 * @brief       "Ruzne mody edit/preview/present atd." — the ways of looking at a canvas, drawn on Studio site
 *              (a linked web prototype) and Alligators brand (the 15-artboard Combine campaign with print + video).
 *
 * THE DECISION (md-model): one small mode switch — Edit · Preview · Present — lives in the Share cluster, top
 * right, the one cluster that stays on screen in Edit AND Preview, so the switch never moves. Modes have their
 * OWN glyphs (DDR-223 addendum 2): pencil-ruler, an eye in a frame, an easel, and reading glasses for Viewing —
 * never a tool's glyph (Pen, Hand, Select), never a menu row's (Menu › Edit, Menu › View). People who can only
 * view or comment get Viewing in the first slot; editing controls are hidden, never greyed.
 *
 * PREVIEW = THE LIVE CANVAS (DDR-223): every artboard works in place (links, hovers, video, scrolling pages);
 * stickies, annotations and comment pins stay; you pan the whole canvas; the toolbar keeps only the annotation
 * tools (Hand · Sticky · Comment · More). A link to another canvas opens it in Preview at the linked artboard.
 *
 * PRESENT has two kinds: Artboards (one by one, full screen, in canvas order) and Canvas (today's Presentation
 * mode, DDR-117 — no chrome, no pins, no annotations, pan and zoom freely). One name: Present.
 *
 * TODAY → V2 (nothing deleted): toolbar Preview/Edit/Present segment (DDR-223) → the switch · Presentation mode
 * (DDR-117) → Present the canvas · ⇧⌘M Comments sidebar → Comments panel · ⌥-hover measure → in Edit AND Inspect ·
 * Copy CSS + Export + Handoff → Inspect · read-only viewer (?ro=1, boots Preview) → Viewing / Preview ·
 * print guides → View › Advanced, also while presenting.
 *
 * Convention: every app artboard is a Stage (1440 × 900 window + note strip, artboard 1440 × 980); full-screen
 * moments use a local ScreenStage (same frame, no window chrome); close-ups carry their note at the foot.
 * Local pieces use the `md-` prefix.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./04 Modes.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, Artboard, Avatar, Canvas, CanvasesPanel, CommentPin, GatorMock, HeroMock, Icon, InFill, InSelect, InSize,
  Inspector, Kbd, Menu, Note, PanelIcon, PhoneMock, ProjectPill, Selection, Spark, Stage, StatusWord, Sticky, TABS, Thumb,
  Toolbar, V2, VideoFrameMock, Window, ZoomUndo, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT,
} from "./_kit";
import type { Art, Folder, Kind, Who } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];
const RUN = 14; // 15 artboards on Combine-kampan, 1 skipped → a run of 14

/* ═══ Motion helpers (the filmstrips) ════════════════════════════════════════════════════════ */

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** --ease-out = cubic-bezier(0.25, 0.8, 0.25, 1): progress at time fraction t. */
function easeOut(t: number) {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 32; k++) {
    const s = (lo + hi) / 2;
    const x = 0.75 * s * (1 - s) + s * s * s;
    if (x < t) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return 2.4 * s * (1 - s) * (1 - s) + 3 * s * s * (1 - s) + s * s * s;
}

/* ═══ Mode glyphs — the modes' own, never a tool's or a menu row's (DDR-223 addendum 2) ═══════
   Drawn on a 24 grid at 2.25 stroke = the house 16 grid at 1.5 stroke. Kit candidates. */

type Mode = "edit" | "preview" | "present" | "viewing";
const MODE_WORD: Record<Mode, string> = { edit: "Edit", preview: "Preview", present: "Present", viewing: "Viewing" };
const MODE_PATHS: Record<Mode, ReactNode> = {
  /* pencil-ruler — making */
  edit: (
    <>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </>
  ),
  /* an eye in a frame — the design, looked at live (the bare eye stays Menu › View's) */
  preview: (
    <>
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="4.5" />
      <path d="M6 12s2.2-3.75 6-3.75S18 12 18 12s-2.2 3.75-6 3.75S6 12 6 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  /* an easel — showing */
  present: (
    <>
      <path d="M2 3.5h20" />
      <path d="M20.5 3.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-10" />
      <path d="m7.5 21 4.5-5 4.5 5" />
    </>
  ),
  /* reading glasses — looking, without changing */
  viewing: (
    <>
      <circle cx="6" cy="15.5" r="3.75" />
      <circle cx="18" cy="15.5" r="3.75" />
      <path d="M14.25 15.5a2.25 2.25 0 0 0-4.5 0" />
      <path d="M2.4 14 5 7.5c.6-1.3 1.4-2 2.75-2" />
      <path d="M21.6 14 19 7.5c-.6-1.3-1.4-2-2.75-2" />
    </>
  ),
};
function ModeGlyph({ m, size = 15 }: { m: Mode; size?: number }) {
  return (
    <svg className="k-ic md-mg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {MODE_PATHS[m]}
    </svg>
  );
}

/* ═══ Local pieces (kit candidates — see report) ═══════════════════════════════════════════ */

/** A pointer mid-click: the arrow plus a ring where it pressed. */
function Click() {
  return (
    <span className="md-click maude-v2 k-fixed" data-theme="light" aria-hidden="true">
      <i />
      <svg className="k-ic" width="48" height="48" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--bg-2)" stroke="var(--fg-0)" strokeWidth="1" strokeLinejoin="round" /></svg>
    </span>
  );
}

/** The mode switch. Editors get Edit · Preview · Present; Can view / Can comment get Viewing · Preview · Present. */
function ModeSwitch({ mode, canEdit = true, menu = false, click }: { mode: Mode; canEdit?: boolean; menu?: boolean; click?: Mode }) {
  const segs: Mode[] = [canEdit ? "edit" : "viewing", "preview", "present"];
  return (
    <span className="md-modes" title="Mode">
      {segs.map((id) => (
        <span key={id} className={`md-mode-b${id === "present" ? " md-mode-b--menu" : ""}`} aria-pressed={mode === id ? "true" : undefined} data-open={id === "present" && menu ? "true" : undefined} title={MODE_WORD[id]}>
          <ModeGlyph m={id} />
          {id === "present" ? <span className="md-mode-ch"><Icon name="chevron" size={10} /></span> : null}
          {click === id ? <Click /> : null}
        </span>
      ))}
    </span>
  );
}

/** Inspect's own glyph — corner brackets around a point (a tool, so never Select's arrow or a mode's glyph). Kit candidate. */
function InspectGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}

/** The Share cluster with the mode switch in it (kit ShareCluster + `mode`). `compact` hides faces + status only —
 *  everything right of the switch stays, so the switch never moves. `fade` dims faces + status (motion frames). */
function MdCluster({
  people = ["tereza"], status = "saved", mode = "edit", canEdit = true, access, menu = false, click, compact = false, fade, style,
}: {
  people?: Who[]; status?: "saved" | "syncing" | "offline" | "local"; mode?: Mode; canEdit?: boolean; access?: string;
  menu?: boolean; click?: Mode; compact?: boolean; fade?: number; style?: CSSProperties;
}) {
  const st = { saved: ["cloud", "Saved"], syncing: ["sync", "Syncing…"], offline: ["offline", "Offline — kept on this Mac"], local: ["laptop", "Local project"] }[status];
  return (
    <div className="island k-tr md-tr" style={style}>
      {compact ? null : (
        <span className="md-tr-who" style={fade !== undefined ? { opacity: fade } : undefined}>
          {people.length ? <span className="k-faces">{people.map((p) => <Avatar key={String(p)} who={p} />)}</span> : null}
          {access ? (
            <span className="k-saved md-access">{access}</span>
          ) : (
            <span className={`k-saved${status === "offline" ? " k-saved--warn" : ""}`}><Icon name={st[0]} size={16} />{st[1]}</span>
          )}
        </span>
      )}
      <ModeSwitch mode={mode} canEdit={canEdit} menu={menu} click={click} />
      <span className="icon-btn" title="Hide panels ⌘\"><Icon name="panel-right" /></span>
      {canEdit ? <span className="btn btn--primary"><Icon name="share" size={14} />Share</span> : <span className="btn btn--primary">Ask to edit</span>}
    </div>
  );
}

/** Preview's own line, top centre: which canvas, the way back after a link, and esc. */
function PreviewBar({ name, back, hint = "to edit", style }: { name: string; back?: string; hint?: string; style?: CSSProperties }) {
  return (
    <div className="island md-pbar" style={style}>
      {back ? <span className="btn btn--ghost btn--sm md-pbar-back"><span className="md-flip"><Icon name="submenu" size={12} /></span>{back}</span> : <span className="md-pbar-ic"><ModeGlyph m="preview" size={16} /></span>}
      <span className="md-pbar-t">Previewing <strong>{name}</strong></span>
      <span className="md-pbar-div" />
      <span className="md-pbar-esc"><Kbd>esc</Kbd>{hint}</span>
    </div>
  );
}

/** Preview keeps a toolbar with only the annotation tools (DDR-223 d.5). Can comment gets Select · Hand · Comment. */
const PREVIEW_TOOLS: [string, string, string][] = [["hand", "Hand", "H"], ["sticky", "Sticky", "N"], ["comment", "Comment", "C"]];
const COMMENT_TOOLS: [string, string, string][] = [["select", "Select", "V"], ["hand", "Hand", "H"], ["comment", "Comment", "C"]];
function SlimDock({ tools = PREVIEW_TOOLS, pressed, more = true, style }: { tools?: [string, string, string][]; pressed?: string; more?: boolean; style?: CSSProperties }) {
  return (
    <div className="island dock k-dock" style={style}>
      {tools.map(([id, label, key]) => (
        <span key={id} className={`icon-btn${pressed === id ? " k-pressed" : ""}`} title={`${label} · ${key}`}><Icon name={id} size={18} /></span>
      ))}
      {more ? (
        <>
          <span className="divider-v" />
          <span className="icon-btn" title="More — Arrow, Highlighter, Section, Eraser"><Icon name="more" size={18} /></span>
        </>
      ) : null}
    </div>
  );
}

/** The edit toolbar mid-fold: tools that only edit slide out (motion frame 2). */
const EDIT_ONLY = ["select", "frame", "shape", "pen", "text"];
function MorphDock({ p }: { p: number }) {
  const all: [string, string][] = [["select", "Select"], ["hand", "Hand"], ["frame", "Frame"], ["shape", "Shape"], ["pen", "Pen"], ["text", "Text"], ["sticky", "Sticky"], ["comment", "Comment"]];
  return (
    <div className="island dock k-dock">
      {all.map(([id, label]) => {
        const out = EDIT_ONLY.includes(id);
        return (
          <span key={id} className="icon-btn md-morph" title={label} style={out ? { width: 36 * (1 - p), opacity: 1 - p, transform: `translateY(${p * 14}px)` } : undefined}>
            <Icon name={id} size={18} />
          </span>
        );
      })}
      <span className="divider-v" />
      <span className="icon-btn"><Icon name="more" size={18} /></span>
    </div>
  );
}

function ZoomOnly({ zoom, style }: { zoom: string; style?: CSSProperties }) {
  return <div className="island md-zoomonly" style={style}><span className="btn btn--ghost btn--sm k-zoom">{zoom}</span></div>;
}

/** Renders a design at its real size (base) and scales it to `w` — the page reads like the real thing. */
function Scaled({ w, base = [1440, 900], children }: { w: number; base?: [number, number]; children: ReactNode }) {
  return <div className="md-scaled" style={{ width: base[0], height: base[1], transform: `scale(${w / base[0]})` }}>{children}</div>;
}

/** A slide drawn at a small design size and scaled up, so on-screen type keeps the design's proportions. */
function Fit({ w, h, bw, children }: { w: number; h: number; bw: number; children: ReactNode }) {
  return <Scaled w={w} base={[bw, (bw * h) / w]}><div className="md-cq">{children}</div></Scaled>;
}

/** A full-screen surface (no window chrome) with the note strip under it. */
function ScreenStage({ theme = "light", note, kind = "stage", children }: { theme?: "light" | "dark"; note?: ReactNode; kind?: "stage" | "ui" | "canvas"; children: ReactNode }) {
  return (
    <V2 theme={theme} className="k-stage">
      <div className="k-stage-win"><div className={`md-screen md-screen--${kind}`}>{children}</div></div>
      {note ? <div className="k-stage-note">{note}</div> : null}
    </V2>
  );
}

/** A browser window (the cloud viewer) — the address bar belongs to the browser, not to Maude. */
function BrowserWin({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="k-window md-browser" role="img" aria-label={`Browser — ${url}`} style={{ height: 900 }}>
      <div className="md-btitle">
        <span className="k-lights"><i /><i /><i /></span>
        <span className="md-bnav"><span className="md-flip"><Icon name="submenu" size={14} /></span><Icon name="submenu" size={14} /></span>
        <span className="md-url"><Icon name="lock" size={11} />{url}</span>
        <span className="md-bnav"><Icon name="share" size={14} /></span>
      </div>
      <div className="k-body">{children}</div>
    </div>
  );
}

/** Pointer in a live design (hand) and the presenter's pointer (your presence colour, ringed so it holds on yellow art). */
function Hand({ x, y }: { x: number; y: number }) {
  return <span className="md-hand maude-v2 k-fixed" data-theme="light" style={{ left: x, top: y }}><Icon name="hand" size={22} /></span>;
}
function Laser({ x, y }: { x: number; y: number }) {
  return (
    <>
      <svg className="md-trail" style={{ left: x - 150, top: y - 40 }} width="160" height="60" viewBox="0 0 160 60" aria-hidden="true">
        <path d="M4 52 C 40 50, 70 20, 110 30 S 146 42, 150 40" fill="none" />
      </svg>
      <span className="md-laser" style={{ left: x, top: y }} />
    </>
  );
}

/** Present · Artboards controls — they appear when the mouse moves, and fade again. */
function PresentControls({ n, of = RUN, label, video, presenter = true, style }: { n: number; of?: number; label: string; video?: string; presenter?: boolean; style?: CSSProperties }) {
  return (
    <div className="island md-pctl" style={style}>
      <span className="icon-btn"><span className="md-flip"><Icon name="submenu" /></span></span>
      <span className="md-pctl-n">{n} / {of}</span>
      <span className="icon-btn"><Icon name="submenu" /></span>
      <span className="md-pbar-div" />
      {video ? (
        <>
          <span className="icon-btn"><PauseGlyph /></span>
          <span className="md-pctl-time">{video}</span>
          <span className="icon-btn"><SoundGlyph /></span>
          <span className="md-pbar-div" />
        </>
      ) : null}
      <span className="md-pctl-lab">{label}</span>
      <span className="md-pbar-div" />
      {presenter ? <span className="icon-btn" title="Presenter view"><Icon name="laptop" /></span> : null}
      <span className="md-pbar-esc"><Kbd>esc</Kbd>to leave</span>
    </div>
  );
}
/** Present · Canvas — the only chrome is this pill, and it fades (DDR-117's exit pill). */
function CanvasPill({ zoom = "21%", style }: { zoom?: string; style?: CSSProperties }) {
  return (
    <div className="island md-pctl md-cpill" style={style}>
      <span className="md-cpill-ic"><ModeGlyph m="present" size={15} /></span>
      <span className="md-cpill-t">Presenting the canvas</span>
      <span className="md-pbar-div" />
      <span className="md-pctl-time">{zoom}</span>
      <span className="md-pbar-div" />
      <span className="md-pbar-esc"><Kbd>esc</Kbd>to leave</span>
    </div>
  );
}
function PauseGlyph() {
  return <svg className="k-ic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3.5" width="2.5" height="9" rx="1" fill="currentColor" /><rect x="9.5" y="3.5" width="2.5" height="9" rx="1" fill="currentColor" /></svg>;
}
function SoundGlyph({ size = 16 }: { size?: number }) {
  return <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5z" /><path d="M10.5 6a2.75 2.75 0 0 1 0 4M12.25 4.25a5.25 5.25 0 0 1 0 7.5" /></svg>;
}

/* ─── Studio site — the real pages, drawn at their real size ───────────────────────────────── */

/** Homepage at 1440 × 900. Key boxes (base px): "See pricing" 250,436 · 184×52 · "Book a call" 1226,20 · 150×48. */
function SiteHome({ hover, linkSel = false }: { hover?: "cta"; linkSel?: boolean }) {
  return (
    <div className="md-sh">
      <div className="md-sh-nav">
        <span className="md-sh-logo"><b />Studio</span>
        <span>Work</span><span>Services</span><span>Pricing</span><span>About</span>
        <em>Book a call</em>
      </div>
      <p className="md-sh-h1">Calm software, made in Brno.</p>
      <p className="md-sh-sub">A small studio for product and brand. Two designers, one developer, no rush.</p>
      <div className="md-sh-ctas">
        <span className="md-sh-btn md-sh-btn--ink">See the work</span>
        <span className="md-sh-btn md-sh-btn--line" data-hover={hover === "cta" ? "true" : undefined} data-link={linkSel ? "true" : undefined}>See pricing →</span>
      </div>
      <div className="md-sh-art"><span className="md-sh-sun" /><span className="md-sh-hill" /><span className="md-sh-hill2" /></div>
      <div className="md-sh-svc">
        <span><b className="md-dot md-dot--coral" /><strong>Product design</strong>Apps and tools people enjoy using.</span>
        <span><b className="md-dot md-dot--green" /><strong>Brand systems</strong>Logos, type and colour that hold up.</span>
        <span><b className="md-dot md-dot--lilac" /><strong>Small apps</strong>From sketch to the App Store in weeks.</span>
      </div>
    </div>
  );
}

const PLANS: [string, string, string, string[]][] = [
  ["Solo", "10 200", "12 000", ["One designer, two days a week", "Brand or product", "A check-in every month"]],
  ["Studio", "23 800", "28 000", ["Two designers, four days a week", "Brand and product", "A check-in every week"]],
  ["Team", "45 900", "54 000", ["Designers and a developer", "Shipped to production", "A shared Slack channel"]],
];
/** Pricing at 1440 × 900 (wide) or 834 × 1194 (Tablet). */
function SitePricing({ narrow = false, hoverYearly = false, yearly = false }: { narrow?: boolean; hoverYearly?: boolean; yearly?: boolean }) {
  return (
    <div className={`md-sp${narrow ? " md-sp--narrow" : ""}`}>
      <div className="md-sh-nav md-sp-nav">
        <span className="md-sh-logo"><b />Studio</span>
        {narrow ? <span className="md-sp-burger"><i /><i /><i /></span> : (<><span>Work</span><span>Services</span><span className="md-sp-here">Pricing</span><span>About</span></>)}
        <em>Book a call</em>
      </div>
      <p className="md-sp-h">Simple pricing</p>
      <p className="md-sp-sub">Pay monthly, or save 15 % with a year up front.</p>
      <span className="md-sp-tog">
        <span data-on={!yearly ? "true" : undefined}>Monthly</span>
        <span data-on={yearly ? "true" : undefined} data-hover={hoverYearly ? "true" : undefined}>Yearly <i>−15 %</i></span>
      </span>
      <div className="md-sp-plans">
        {PLANS.map(([name, y, m, pts], i) => (
          <div key={name} className={`md-sp-plan md-sp-plan--${i}`}>
            <span className="md-sp-name">{name}{i === 1 ? <i>Most picked</i> : null}</span>
            <span className="md-sp-price">{yearly ? y : m}<small> Kč / month</small></span>
            {pts.map((pt) => <span key={pt} className="md-sp-pt"><Icon name="check" size={18} />{pt}</span>)}
            <em>Book a call</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Homepage canvas at zoom z: Desktop, Tablet, Mobile (Duplicate-at-width siblings) in canvas units. */
function HomeBoards({ z, ox, oy, hover, aiDesktop, aiTablet }: { z: number; ox: number; oy: number; hover?: "cta"; aiDesktop?: string; aiTablet?: boolean }) {
  return (
    <>
      <Artboard label="Desktop" kind="web" x={ox} y={oy} w={1440 * z} h={900 * z} aiWorking={aiDesktop} aiCursor={false}>
        <Scaled w={1440 * z}><SiteHome hover={hover} /></Scaled>
      </Artboard>
      <Artboard label="Tablet" kind="web" x={ox + 1536 * z} y={oy} w={834 * z} h={1194 * z} aiWorking={aiTablet ? "AI" : undefined} aiAt="art" aiCursor={{ x: "5%", y: "34%" }}>
        <HeroMock headline="Calm software, made in Brno." />
      </Artboard>
      <Artboard label="Mobile" kind="web" x={ox + 2466 * z} y={oy} w={390 * z} h={844 * z}><PhoneMock title="Calm software" tone="sky" /></Artboard>
    </>
  );
}

/** The Studio site "Homepage" canvas in Edit — Desktop, Tablet, Mobile. */
function HomepageCanvas({ select = false }: { select?: boolean }) {
  const k = 672 / 1440;
  return (
    <>
      <Artboard label="Desktop" kind="web" x={80} y={120} w={672} h={420}>
        <Scaled w={672}><SiteHome linkSel={select} /></Scaled>
        {select ? <Selection x={250 * k} y={436 * k} w={184 * k} h={52 * k} /> : null}
      </Artboard>
      <Artboard label="Tablet" kind="web" x={792} y={120} w={200} h={286}><HeroMock headline="Calm software, made in Brno." /></Artboard>
      <Artboard label="Mobile" kind="web" x={1028} y={120} w={110} h={238}><PhoneMock title="Calm software" tone="sky" /></Artboard>
    </>
  );
}

/* ─── Alligators — the Combine campaign, 15 artboards in canvas order ─────────────────────── */

type Slide = { label: string; kind: Kind; art: Art; r: number; skip?: boolean };
const CAMPAIGN: Slide[] = [
  { label: "Web · STAŇ SE GATOREM", kind: "web", art: "gator-web", r: 1.6 },
  { label: "Web mobil", kind: "web", art: "gator-reel", r: 0.46 },
  { label: "Post 1:1 · Combine 2026", kind: "digital", art: "gator-social", r: 1 },
  { label: "Post 1:1 · Zapiš se", kind: "digital", art: "gator-social", r: 1 },
  { label: "Post 1:1 · Combine v číslech", kind: "digital", art: "gator-numbers", r: 1 },
  { label: "Post 1:1 · Trenéři", kind: "digital", art: "gator-social", r: 1 },
  { label: "Story 9:16 · Zapiš se", kind: "digital", art: "gator-reel", r: 0.5625 },
  { label: "Story 9:16 · Odpočet 7 dní", kind: "digital", art: "gator-reel", r: 0.5625 },
  { label: "Reels · nábor", kind: "video", art: "video", r: 0.5625 },
  { label: "16:9 · teaser", kind: "video", art: "video", r: 1.778 },
  { label: "A4 · plakát", kind: "print", art: "gator-poster", r: 0.707 },
  { label: "A4 · leták B · zadní", kind: "print", art: "gator-print", r: 0.707 },
  { label: "E-mail · pozvánka pro rodiče hráčů", kind: "web", art: "gator-print", r: 1.05 },
  { label: "Banner web 1200 × 300", kind: "web", art: "gator-numbers", r: 4 },
  { label: "Banner FB cover", kind: "digital", art: "gator-numbers", r: 2.7, skip: true },
];
/** Where each campaign artboard sits on the canvas at 14 % (positions follow 01 cf-open-big). */
const LAYOUT: [number, number, number, number][] = [
  [96, 92, 288, 180], [408, 92, 83, 180], [515, 92, 180, 180], [719, 92, 180, 180], [923, 92, 180, 180], [1127, 92, 180, 180],
  [96, 322, 101, 180], [221, 322, 101, 180], [346, 322, 101, 180], [471, 322, 320, 180], [815, 322, 127, 180], [966, 322, 127, 180], [1117, 322, 190, 180],
  [96, 552, 400, 100], [520, 552, 270, 100],
];
const POST_SUB = "So 14. 3. · Brno, Kraví hora";
/** The picture on campaign artboard `i`, as it sits on the canvas. */
function campaignArt(i: number): ReactNode {
  switch (i) {
    case 0: return <GatorMock variant="web" />;
    case 1: return <GatorMock variant="reel" headline="STAŇ SE GATOREM" sub="" />;
    case 2: return <GatorMock variant="social" headline="COMBINE 2026" sub={POST_SUB} />;
    case 3: return <GatorMock variant="invite" headline="Zapiš se do 10. 3." sub="" />;
    case 4: return <GatorMock variant="numbers" />;
    case 5: return <GatorMock variant="social" headline="11 TRENÉRŮ" sub="Combine 2026" />;
    case 6: return <GatorMock variant="reel" headline="ZAPIŠ SE" sub="" />;
    case 7: return <GatorMock variant="reel" headline="7 DNÍ" sub="" />;
    case 8: return <VideoFrameMock vertical caption="NÁBOR" time="0:04" />;
    case 9: return <VideoFrameMock caption="Combine 2026" time="0:12 / 0:30" />;
    case 10: return <GatorMock variant="poster" />;
    case 11: return <GatorMock variant="print" headline="Jak na Combine" sub="" />;
    case 12: return <GatorMock variant="invite" />;
    case 13: return <GatorMock variant="numbers" headline="STAŇ SE GATOREM · Combine 2026" />;
    default: return <GatorMock variant="numbers" headline="Combine 2026" />;
  }
}
/** The whole campaign on the canvas, at camera zoom `z` (1 = the 14 % fit) and pan dx/dy. */
function CampaignBoards({ z = 1, dx = 0, dy = 0, selected, live = false, labels = true }: { z?: number; dx?: number; dy?: number; selected?: number; live?: boolean; labels?: boolean }) {
  return (
    <div className={`md-fit${labels ? "" : " md-nolab"}`}>
      {LAYOUT.map(([x, y, w, h], i) => (
        <Artboard key={CAMPAIGN[i].label} label={CAMPAIGN[i].label} kind={CAMPAIGN[i].kind} x={x * z + dx} y={y * z + dy} w={w * z} h={h * z} selected={selected === i}>
          {campaignArt(i)}
          {live && i === 0 ? <span className="md-scroll md-scroll--sm" /> : null}
        </Artboard>
      ))}
    </div>
  );
}

/** One slide (what the audience sees). */
function SlideArt({ i }: { i: number }) {
  const c = CAMPAIGN[i];
  if (c.kind === "video") return <VideoFrameMock vertical={c.r < 1} caption={c.r < 1 ? "STAŇ SE GATOREM" : "Combine 2026"} time={c.r < 1 ? "0:06 / 0:15" : "0:00 / 0:30"} />;
  if (c.art === "gator-numbers") return <GatorMock variant="numbers" headline={c.r > 2 ? "Combine 2026" : undefined} />;
  if (c.art === "gator-web") return <GatorMock variant="web" />;
  if (c.art === "gator-print") return <GatorMock variant="print" headline="Jak na Combine" sub="Registrace · rozpis · mapa" />;
  if (c.art === "gator-poster") return <GatorMock variant="poster" />;
  if (c.label.includes("Trenéři")) return <GatorMock variant="social" headline="11 TRENÉRŮ" sub="Combine 2026" />;
  if (c.art === "gator-reel") return <GatorMock variant="reel" headline={c.label.includes("Odpočet") ? "7 DNÍ" : "ZAPIŠ SE"} sub="do 10. 3." />;
  return <GatorMock variant="social" headline="COMBINE 2026" sub={POST_SUB} />;
}
/** A screen box with slide `i` inside: contain (default), fill the width from the top (web), or fill (edge to edge). */
function ScreenBox({ i, w, h, fit = "contain", still = false, children }: { i: number; w: number; h: number; fit?: "contain" | "width" | "fill"; still?: boolean; children?: ReactNode }) {
  const r = CAMPAIGN[i].r;
  let fw = Math.min(w * 0.9, h * 0.9 * r);
  let fh = fw / r;
  let left = (w - fw) / 2;
  let top = (h - fh) / 2;
  if (fit === "width") { fw = w; fh = w / r; left = 0; top = 0; }
  if (fit === "fill") { fw = w; fh = h; left = 0; top = 0; }
  return (
    <div className="md-sbox" style={{ width: w, height: h }}>
      <div className={`md-slide${fit === "contain" ? "" : " md-slide--edge"}${still ? " md-novbar" : ""}`} style={{ width: fw, height: fh, left, top }}><Fit w={fw} h={fh} bw={r >= 1 ? 320 : 200}><SlideArt i={i} /></Fit></div>
      {children}
    </div>
  );
}

/** The run order, drawn as the canvas itself: every artboard where it lives, numbered in order. */
function OrderMap({ cur, scale = 0.41 }: { cur: number; scale?: number }) {
  let n = 0;
  return (
    <div className="md-pv-map" style={{ width: 1211 * scale, height: 560 * scale }}>
      {LAYOUT.map(([x, y, w, h], i) => {
        const c = CAMPAIGN[i];
        if (!c.skip) n += 1;
        return (
          <span key={c.label} className="md-pv-mcell" style={{ left: (x - 96) * scale, top: (y - 92) * scale, width: w * scale, height: h * scale }} aria-current={i === cur ? "true" : undefined} data-skip={c.skip ? "true" : undefined}>
            <Thumb art={c.art} w={w * scale} h={h * scale} />
            <span className="md-pv-mn">{c.skip ? <Icon name="eye-off" size={10} /> : n}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Presenter view — the presenter's own screen (theme-aware chrome; the audience boxes are a fixed dark stage). */
function PresenterView({ cur, offline = false }: { cur: number; offline?: boolean }) {
  const next = cur + 1;
  return (
    <>
      <div className="md-pv-top">
        <span className="md-pv-name">Combine-kampan<span className="chip">Presenter view</span></span>
        <span className="md-pv-clock"><strong>12:48</strong><span>elapsed</span><span className="md-pv-now">14:05</span></span>
        <span className="md-pv-right">
          {offline ? <StatusWord state="warn">Offline — kept on this Mac</StatusWord> : <span className="md-pv-aud"><Icon name="laptop" size={14} />Audience on LG UltraFine</span>}
          <span className="btn btn--sm">End<Kbd>esc</Kbd></span>
        </span>
      </div>
      <p className="island-title md-pv-l" style={{ left: 32, top: 76 }}>Now · {cur + 1} of {RUN} · {CAMPAIGN[cur].label}</p>
      <div className="md-pv-box" style={{ left: 32, top: 100 }}>
        <ScreenBox i={cur} w={800} h={450} still={offline}>
          {offline ? null : <Laser x={330} y={300} />}
          {offline ? (
            <span className="md-pv-miss">
              <Icon name="offline" size={14} />
              <span>Clip isn't on this Mac — the audience sees its first frame</span>
              <span className="btn btn--sm">Skip</span>
            </span>
          ) : null}
        </ScreenBox>
      </div>
      <div className="md-pv-under" style={{ left: 32, top: 566 }}>
        <span className="btn"><span className="md-flip"><Icon name="submenu" size={14} /></span>Previous</span>
        <span className="btn btn--primary">Next<Icon name="submenu" size={14} /></span>
        <span className="md-pv-hint"><Kbd>←</Kbd><Kbd>→</Kbd><Kbd>space</Kbd> or a clicker · <Kbd>L</Kbd> pointer · only you see this screen</span>
      </div>
      <p className="island-title md-pv-l" style={{ left: 864, top: 76 }}>Next · {CAMPAIGN[next].label}</p>
      <div className="md-pv-box" style={{ left: 864, top: 100 }}><ScreenBox i={next} w={544} h={306} /></div>
      <p className="island-title md-pv-l" style={{ left: 864, top: 426 }}>Notes</p>
      <div className="md-pv-notes" style={{ left: 864, top: 450 }}>
        {cur === 4 ? (
          <>
            <p>Loni přišlo 86 hráčů, nejrychlejší čtyřicítka za 4,62 s.</p>
            <p>Letos nově kategorie U15. Registrace do 10. 3. — odkaz je v biu.</p>
            <p className="md-pv-quiet">Pak pustit Reels.</p>
          </>
        ) : (
          <>
            <p>Teaser má 30 s, stačí prvních deset a pak dál.</p>
            <p className="md-pv-quiet">Potom plakát — tisk je u Tiskárny Kraví hora.</p>
          </>
        )}
      </div>
      <p className="island-title md-pv-l" style={{ left: 32, top: 622 }}>Order · 15 artboards · 1 skipped</p>
      <div className="md-pv-box" style={{ left: 32, top: 646 }}><OrderMap cur={cur} /></div>
      <div className="md-pv-legend" style={{ left: 570, top: 646 }}>
        <p>The order follows the canvas: row by row, left to right. Click any artboard to jump there.</p>
        <p className="md-pv-legend-r"><Icon name="eye-off" size={13} />Skipped — it stays on the canvas, out of the run.</p>
        <p className="md-pv-quiet">Order and notes… changes it.</p>
      </div>
    </>
  );
}

/** An open comment thread on the canvas. */
function Thread({ x, y }: { x: number; y: number }) {
  return (
    <div className="md-th" style={{ left: x, top: y }}>
      <div className="md-th-hd"><span>Pricing · Desktop</span><span className="btn btn--ghost btn--sm"><Icon name="check" size={13} />Resolve</span></div>
      <div className="md-th-msg"><Avatar who="tereza" size="sm" /><span><strong>Tereza</strong><em>2 h ago</em><br />Yearly should be the default — most studios pay for a year up front.</span></div>
      <div className="md-th-msg"><Avatar who="jonas" size="sm" /><span><strong>Jonas</strong><em>1 h ago</em><br />Agree. Then the −15 % moves onto Yearly, not next to it.</span></div>
      <div className="md-th-comp">
        <span className="md-th-in">Let's do it. <span className="md-mention-q">@Jo</span><i className="k-caretline" /></span>
        <span className="md-th-send"><Icon name="submenu" size={14} /></span>
        <div className="k-menu md-mention">
          <span className="row-item k-mi" data-hl="true"><Avatar who="jonas" size="sm" /><span className="k-mi-lab">Jonas</span><span className="k-mi-keys">Can edit</span></span>
        </div>
      </div>
    </div>
  );
}

/** Comments panel (⇧⌘M) — takes the Canvases panel's place while it's open. */
function CommentsPanel() {
  const rows: { who: Who; on: string; t: string; m: string; cur?: boolean }[] = [
    { who: "tereza", on: "Pricing · Desktop", t: "Yearly should be the default — most studios pay for a year up front.", m: "2 h ago · 1 reply", cur: true },
    { who: "jonas", on: "Pricing · Desktop", t: "Is “two days a week” clear enough? Maybe “16 hours a week”.", m: "yesterday" },
    { who: "you", on: "Pricing · Tablet", t: "Cards feel tall on Tablet — tighten the padding?", m: "Monday" },
  ];
  return (
    <div className="island md-cm">
      <div className="k-cp-hd"><span className="md-cm-t">Comments</span><span className="icon-btn k-icon-sm"><Icon name="close" size={14} /></span></div>
      <span className="seg k-seg md-cm-f"><span className="k-seg-b" aria-pressed="true">Open 3</span><span className="k-seg-b">Mine 1</span><span className="k-seg-b">Resolved 2</span></span>
      <div className="md-cm-list">
        {rows.map((r) => (
          <span key={r.t} className="row-item md-cm-row" aria-current={r.cur ? "true" : undefined}>
            <Avatar who={r.who} size="md" />
            <span className="md-cm-txt"><span className="md-cm-on">{r.on}</span><span className="md-cm-body">{r.t}</span><span className="md-cm-m">{r.m}</span></span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Read-only specs — the inspector's Inspect face. */
function InspectPanel({ style }: { style?: CSSProperties }) {
  return (
    <div className="island island--pad k-insp md-insp" style={style}>
      <div className="k-insp-hd"><strong>Book a call</strong><span className="chip">Button</span></div>
      <p className="island-title md-insp-g">Size and spacing</p>
      <div className="k-insp-row"><span>Size</span><span className="md-ro">150 × 48</span></div>
      <div className="k-insp-row"><span>Padding</span><span className="md-ro">12 · 24</span></div>
      <div className="k-insp-row"><span>Corners</span><span className="md-ro">Round</span></div>
      <div className="k-insp-row"><span>Gap to About</span><span className="md-ro">48</span></div>
      <p className="island-title md-insp-g">Colour and type</p>
      <div className="k-insp-row"><span>Fill</span><InFill name="Ink" tone="ink" /></div>
      <div className="k-insp-row"><span>Text</span><span className="md-ro">SF Pro Text · 19 · Semibold</span></div>
      <div className="k-insp-row"><span>Text colour</span><InFill name="Paper" /></div>
      <p className="island-title md-insp-g">Export</p>
      <div className="md-insp-ex"><span className="btn btn--sm">PNG 1×</span><span className="btn btn--sm">PNG 2×</span><span className="btn btn--sm">SVG</span><span className="btn btn--sm">Handoff…</span></div>
      <div className="md-insp-acts">
        <span className="btn btn--primary"><Icon name="duplicate" size={14} />Copy code</span>
        <span className="btn"><ModeGlyph m="edit" size={14} />Edit<Kbd>↵</Kbd></span>
      </div>
      <div className="k-adv" data-open="true">
        <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">CSS</span></span>
        <div className="k-adv-body">
          {[["padding", "12px 24px"], ["border-radius", "999px"], ["background", "var(--ink)"], ["font", "600 19px/1.4 SF Pro Text"], ["color", "var(--paper)"]].map(([k, v]) => (
            <div className="k-css" key={k}><span className="k-mono k-css-k">{k}</span><span className="k-mono k-css-v">{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A distance between the selection and a neighbour (hold ⌥ and point). */
function Measure({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string }) {
  const horiz = y1 === y2;
  return (
    <>
      <span className="md-mline" style={horiz ? { left: x1, top: y1, width: x2 - x1 } : { left: x1, top: y1, height: y2 - y1 }} data-dir={horiz ? "h" : "v"} />
      <span className="md-mlab" style={{ left: (x1 + x2) / 2, top: (y1 + y2) / 2 }}>{label}</span>
    </>
  );
}

/** A FigJam-style section on the annotation layer. */
function DrawSection({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
  return <div className="md-dsec" style={{ left: x, top: y, width: w, height: h }}><span className="md-dsec-t">{title}</span></div>;
}

/** Uniformy-2027 as it really is: 1920 × 1080 boards, fixed-size digital (~/Maude/alligators/.design/ui/2026/dresy).
 *  The same piece, markup and labels draw it in 05 · es-viewer (es-uni-*) — one look for the canvas everywhere. */
type UniItem = { dir: "a" | "b" | "c"; away?: boolean; helmet?: boolean };
const UNI: { label: string; eyebrow: string; title: string; items: UniItem[] }[] = [
  { label: "01 · Přehled", eyebrow: "Dresy 2027", title: "Tři směry", items: [{ dir: "a" }, { dir: "b" }, { dir: "c" }] },
  { label: "02 · Směr A: Tichá zeleň", eyebrow: "Směr A", title: "Tichá zeleň", items: [{ dir: "a" }, { dir: "a", away: true }] },
  { label: "03 · Směr B: Ramena", eyebrow: "Směr B", title: "Ramena", items: [{ dir: "b" }, { dir: "b", away: true }] },
  { label: "04 · Směr C: Tón v tónu", eyebrow: "Směr C", title: "Tón v tónu", items: [{ dir: "c" }, { dir: "c", away: true }] },
  { label: "05 · Konfigurátor", eyebrow: "Konfigurátor", title: "Doma · venku", items: [{ dir: "b" }, { dir: "b", away: true }, { dir: "b", helmet: true }] },
  { label: "10 · Detaily B", eyebrow: "Detaily B", title: "Helma z boku", items: [{ dir: "b", helmet: true }, { dir: "b" }] },
];
/** The kit's Alligators tree with 2026 › dresy open on Uniformy-2027 (counts stay the kit's). */
const DRESY_TREE: Folder[] = ALLIGATORS_FOLDERS.map((f) => f.name !== "2026" ? f : {
  ...f,
  folders: (f.folders ?? []).map((sf) => sf.name === "combine" ? { ...sf, open: false } : sf.name === "dresy" ? {
    ...sf, open: true, items: [
      { name: "Uniformy-2027", art: "gator-jersey", people: ["jonas"] },
      { name: "Uniformy-2027 — varianty barev pro sponzory", art: "gator-jersey" },
      { name: "Dresy-mockupy-foto", art: "moodboard" },
      { name: "Dresy-objednavka-2027", art: "flow" },
    ],
  } : sf),
});
function UniBoard({ eyebrow, title, items }: { eyebrow: string; title: string; items: UniItem[] }) {
  return (
    <div className="k-mk md-uni">
      <div className="md-uni-t"><span>{eyebrow}</span><strong>{title}</strong></div>
      <div className="md-uni-row">
        {items.map((it, i) => it.helmet
          ? <span key={i} className="md-uni-helm"><i /></span>
          : <span key={i} className={`md-uni-shirt md-uni-shirt--${it.dir}`} data-away={it.away ? "true" : undefined}><b>27</b></span>)}
      </div>
    </div>
  );
}

/* ─── Signature moment 1 · Edit → Preview, in motion ──────────────────────────────────────── */

const FRAME_W = 416;
/** One frame of the Edit → Preview move at progress p (0 = Edit, 1 = Preview). */
function EditPreviewFrame({ p, click = false }: { p: number; click?: boolean }) {
  const z = lerp(0.28, 0.7639, p);
  const ox = lerp(300, 170, p);
  const oy = lerp(140, 84, p);
  const open = 1 - p;
  return (
    <Window tabs={TABS2} activeTab={0}>
      <Canvas>
        <HomeBoards z={z} ox={ox} oy={oy} />
        <CommentPin who="jonas" x={ox + 1060 * z} y={oy + 640 * z} />
      </Canvas>
      {p < 1 ? <span className="md-pillfade" style={{ ["--md-o" as string]: open } as CSSProperties}><ProjectPill project="Studio site" canvas="Homepage" /></span> : <ProjectPill project="Studio site" folded />}
      {p < 1 ? (
        <div className="md-fold md-fold--left" style={{ transform: `scale(${lerp(1, 0.14, p)})`, opacity: lerp(1, 0.2, p) }}>
          <CanvasesPanel project="Studio site" count={4} selected="Homepage" items={[
            { name: "Homepage", art: "home", kinds: ["web"] }, { name: "Pricing", art: "price", kinds: ["web"] },
            { name: "Onboarding", art: "onb", kinds: ["web"] }, { name: "Mobile — detail", art: "mobile", kinds: ["web"] },
          ]} />
        </div>
      ) : <PanelIcon icon="panel-left" at="left" />}
      {p > 0 ? <PreviewBar name="Homepage" style={{ opacity: p, translate: `-50% ${(p - 1) * 10}px` }} /> : null}
      <MdCluster people={["tereza"]} mode={p === 0 ? "edit" : "preview"} click={click ? "preview" : undefined} fade={p > 0 && p < 1 ? open : undefined} compact={p === 1} />
      {p === 0 ? <ZoomUndo zoom={28} /> : <ZoomOnly zoom={`${Math.round(z * 100)}%`} />}
      {p === 0 ? <Toolbar /> : p < 1 ? <MorphDock p={p} /> : <SlimDock />}
      {p < 1 ? (
        <div className="md-fold md-fold--ai" style={{ transform: `scale(${lerp(1, 0.12, p)})`, opacity: lerp(1, 0.2, p) }}>
          <AIPanel scope="Homepage" messages={[{ from: "you", text: "Make the hero calmer" }, { from: "ai", text: "Done — softer sky, one headline line shorter." }]} />
        </div>
      ) : <PanelIcon icon="spark" at="ai" />}
    </Window>
  );
}

/* ─── Signature moment 2 · Present lifts the artboard out of the canvas ───────────────────── */

const LIFT_FROM: [number, number, number, number] = [515, 132, 180, 180]; // Post 1:1 · Combine 2026, in window px (body + 40 title bar)
const LIFT_TO: [number, number, number, number] = [310, 40, 820, 820];
function LiftFrame({ p, click = false }: { p: number; click?: boolean }) {
  if (p >= 1) {
    return (
      <div className="md-screen md-screen--stage md-screen--abs">
        <div className="md-slide" style={{ left: LIFT_TO[0], top: LIFT_TO[1], width: LIFT_TO[2], height: LIFT_TO[3] }}><Fit w={820} h={820} bw={320}><SlideArt i={2} /></Fit></div>
        <PresentControls n={3} label="Post 1:1 · Combine 2026" />
      </div>
    );
  }
  const r = LIFT_FROM.map((a, k) => lerp(a, LIFT_TO[k], p));
  return (
    <div className="md-liftf">
      <div className="md-liftf-win" style={{ opacity: 1 - p * 0.5 }}>
        <Window tabs={TABS2} activeTab={1}>
          <Canvas><CampaignBoards selected={p === 0 ? 2 : undefined} /></Canvas>
          <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
          <PanelIcon icon="panel-left" at="left" />
          <MdCluster people={["tereza", "jonas"]} mode="edit" click={click ? "present" : undefined} />
          <ZoomUndo zoom={14} />
          <Toolbar />
          <PanelIcon icon="spark" at="ai" />
        </Window>
      </div>
      {p > 0 ? (
        <>
          <div className="md-liftf-veil" style={{ opacity: p * 0.92 }} />
          <div className="md-slide md-lift" style={{ left: r[0], top: r[1], width: r[2], height: r[3] }}><Fit w={r[2]} h={r[3]} bw={320}><SlideArt i={2} /></Fit></div>
          <span className="md-lift-slot" style={{ left: LIFT_FROM[0], top: LIFT_FROM[1], width: LIFT_FROM[2], height: LIFT_FROM[3] }} />
        </>
      ) : null}
    </div>
  );
}

/** Where the Desktop artboard lands in Preview (window px) — drawn on frames 1 and 2. */
function Ghost() {
  return <span className="md-ghost" style={{ left: 170, top: 124, width: 1100, height: 688 }}><span>Lands here</span></span>;
}

/** A filmstrip frame: the 1440 × 900 moment scaled down, with its time and a caption. */
function Frame({ n, t, pct, title, children }: { n: number; t: string; pct?: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="md-fr">
      <div className="md-fr-box" style={{ width: FRAME_W, height: (FRAME_W * 900) / 1440 }}><Scaled w={FRAME_W}>{children}</Scaled></div>
      <p className="md-fr-t"><span className="md-fr-n">{n}</span><strong>{t}</strong>{pct ? <span className="md-fr-pct">{pct}</span> : null}</p>
      <p className="md-fr-d">{title}</p>
    </div>
  );
}

/** The --ease-out curve with the frames marked on it. */
function EaseCurve({ marks, total }: { marks: number[]; total: number }) {
  const w = 440;
  const h = 128;
  const X = (t: number) => 28 + t * (w - 48);
  const Y = (v: number) => h - 22 - v * (h - 40);
  const pts = Array.from({ length: 41 }, (_, k) => k / 40).map((t) => `${X(t).toFixed(1)},${Y(easeOut(t)).toFixed(1)}`).join(" ");
  return (
    <svg className="md-curve" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="md-curve-ax" d={`M${X(0)} ${Y(0)}H${X(1)}M${X(0)} ${Y(0)}V${Y(1) - 6}`} />
      <polyline className="md-curve-l" points={pts} />
      {marks.map((ms, k) => {
        const t = ms / total;
        return (
          <Fragment key={ms}>
            <path className="md-curve-g" d={`M${X(t)} ${Y(0)}V${Y(easeOut(t))}`} />
            <circle className="md-curve-d" cx={X(t)} cy={Y(easeOut(t))} r={9} />
            <text className="md-curve-n" x={X(t)} y={Y(easeOut(t)) + 4}>{k + 1}</text>
            <text className="md-curve-t" x={X(t)} y={h - 4}>{ms === 0 ? "0" : `${ms} ms`}</text>
          </Fragment>
        );
      })}
    </svg>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function Modes() {
  const ik = 1000 / 1440; // inspect zoom
  const pz = 0.7639; // preview zoom on Homepage
  const ek = 672 / 1440; // edit zoom on Homepage
  const mid = easeOut(40 / 220);
  const liftMid = easeOut(40 / 280);
  return (
    <DesignCanvas>
      {/* ── 0 · The model ───────────────────────────────────────────────────────────────── */}
      <DCSection id="model" title="One switch for how you look at a canvas" subtitle="Edit · Preview · Present in the Share cluster, with their own glyphs; Comment, Annotations and Inspect are tools, not modes">
        <DCArtboard id="md-model" label="1 · The mode switch, and what each mode shows" width={W} height={900} fixed>
          <V2 className="md-close md-close--model">
            <div className="md-close-l">
              <p className="md-close-h">One switch for how you look at a canvas.</p>
              <p className="md-close-lede">Edit, Preview and Present sit together in the Share cluster, top right — on screen in Edit and Preview alike, so the switch never moves. A mode is how you look; a tool is what your click does.</p>
              <div className="md-states">
                <span className="md-state-l md-state-l--top"><ModeGlyph m="edit" size={14} />Edit</span>
                <MdCluster people={["tereza", "jonas"]} mode="edit" style={{ position: "relative", right: "auto", top: "auto" }} />
                <span className="md-state-l md-state-l--top"><ModeGlyph m="preview" size={14} />Preview</span>
                <span className="md-state-p">
                  <MdCluster mode="preview" compact style={{ position: "relative", right: "auto", top: "auto" }} />
                  <span className="md-state-d">Faces and status step aside; the switch stays exactly where it was.</span>
                </span>
                <span className="md-state-l md-state-l--top"><ModeGlyph m="present" size={14} />Present</span>
                <span className="md-state-p">
                  <span className="md-state-k">Artboards — one by one</span>
                  <PresentControls n={3} label="Post 1:1 · Combine 2026" style={{ position: "relative", left: "auto", bottom: "auto", translate: "none" }} />
                  <span className="md-state-k">Canvas — pan freely</span>
                  <CanvasPill style={{ position: "relative", left: "auto", bottom: "auto", translate: "none" }} />
                  <span className="md-state-d">Nothing else on screen. These appear when the mouse moves, then fade.</span>
                </span>
                <span className="md-state-l md-state-l--top"><ModeGlyph m="viewing" size={14} />Viewing</span>
                <span className="md-state-p">
                  <MdCluster people={["tereza"]} mode="viewing" canEdit={false} access="Can view" style={{ position: "relative", right: "auto", top: "auto" }} />
                  <span className="md-state-d">For Can view and Can comment: clicks select for specs, nothing edits. A view-only link opens in Preview.</span>
                </span>
              </div>
            </div>
            <div className="md-close-r">
              <p className="island-title">What stays, what hides</p>
              <div className="md-tbl">
                <span className="md-tbl-h" />
                <span className="md-tbl-h"><ModeGlyph m="edit" size={13} />Edit</span>
                <span className="md-tbl-h"><ModeGlyph m="preview" size={13} />Preview</span>
                <span className="md-tbl-h"><ModeGlyph m="present" size={13} />Present · Artboards</span>
                <span className="md-tbl-h"><ModeGlyph m="present" size={13} />Present · Canvas</span>
                {[
                  ["Clicks on the design", "Select", "Use it — links, hovers, video", "Next artboard", "Pan and zoom"],
                  ["Toolbar", "Shown", "Hand, Sticky, Comment, More", "Hidden", "Hidden"],
                  ["Canvases panel", "Shown", "Folded to its icon", "Hidden", "Hidden"],
                  ["Inspector", "On selection", "⌘-click → Inspect", "Hidden", "Hidden"],
                  ["Hold ⌥ and point", "Measures the gap", "Measures the gap", "Off", "Off"],
                  ["AI chat panel", "Shown", "Folded to the spark", "Hidden", "Hidden"],
                  ["What AI changes", "Shows live", "Live — never under your pointer", "Lands when you move on", "Shows live, unmarked"],
                  ["Stickies and annotations", "Shown · ⇧P hides", "Shown · ⇧P hides", "Hidden", "Hidden"],
                  ["Comment pins", "Shown", "Shown", "Hidden", "Hidden"],
                  ["Project menu", "Project pill", "Folded pill (mark)", "esc first", "esc first"],
                  ["esc", "Steps back", "Back to Edit", "Artboard settles back", "Back to the same view"],
                ].map((r) => (
                  <span className="md-tbl-r" key={r[0]}>
                    <span className="md-tbl-k">{r[0]}</span>
                    {r.slice(1).map((c, i) => <span key={i} className={c === "Hidden" || c === "Off" ? "md-tbl-off" : undefined}>{c}</span>)}
                  </span>
                ))}
              </div>
              <p className="island-title md-notmodes-t">Not modes — tools that work in Edit and Preview</p>
              <div className="md-notmodes">
                <span><b><Icon name="comment" size={14} />Comment · <Kbd>C</Kbd></b>Pins and threads on any artboard, in Edit and Preview, and for anyone who can comment. ⇧⌘M lists them.</span>
                <span><b><Icon name="sticky" size={14} />Annotations · <Kbd>N</Kbd> and More</b>Stickies, arrows, sections, highlights — a layer AI reads. Preview's toolbar keeps exactly these.</span>
                <span><b><InspectGlyph />Inspect · ⌘-click</b>In Preview, ⌘-click inspects instead of following the link; ↵ opens that element in Edit. In Viewing, a click is enough.</span>
              </div>
            </div>
            <div className="md-close-note"><Note n={1} title="Why the Share cluster.">It is on screen whenever the switch matters and already says how you're working (faces, Saved). The toolbar keeps CONTRACT §2's order; the switch holds only ways of looking.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="md-keys" label="2 · Its own glyphs, words and keys" width={W} height={690} fixed>
          <V2 className="md-close md-close--keys">
            <div className="md-close-l">
              <p className="md-close-h">Its own glyphs, words and keys.</p>
              <p className="md-close-lede">A mode is how you look at the canvas; a tool is what your click does. The two never share a glyph or a word.</p>
              <p className="island-title">The modes</p>
              <div className="md-gl">
                {([["edit", "Editors"], ["preview", "Everyone"], ["present", "Everyone"], ["viewing", "Can view or comment"]] as [Mode, string][]).map(([m, who]) => (
                  <span key={m} className="md-gl-c"><span className="md-gl-i"><ModeGlyph m={m} size={28} /></span><strong>{MODE_WORD[m]}</strong><em>{who}</em></span>
                ))}
              </div>
              <p className="island-title">Already taken — modes don't borrow these</p>
              <div className="md-gl md-gl--taken">
                {([["pen", "Pen · P", "tool"], ["hand", "Hand · H", "tool"], ["select", "Select · V", "tool"], ["edit", "Edit ›", "menu"], ["view", "View ›", "menu"], ["video", "Video", "artboard kind"]] as [string, string, string][]).map(([ic, l, k]) => (
                  <span key={l} className="md-gl-c"><span className="md-gl-i"><Icon name={ic} size={20} /></span><strong>{l}</strong><em>{k}</em></span>
                ))}
              </div>
              <p className="md-gl-cap">“View” stays the menu's word, so read-only is <strong>Viewing</strong>. Status words say what someone may do: <strong>Can view</strong> (look only), <strong>Can comment</strong> (look, comment and download) — words only, no glyph.</p>
            </div>
            <div className="md-close-r">
              <p className="md-keys-hd"><span className="chip chip--accent">Proposed keys</span>CONTRACT §1 already has Present the canvas. Still proposed: Preview ⌥⌘P, Present ⌥⌘↵, Present from the start ⇧⌥⌘↵, the L pointer, and Viewing as the read-only slot word.</p>
              <div className="md-keys2">
                <div className="md-kl">
                  {([
                    ["⌥⌘P", "Preview"],
                    ["⌥⌘↵", "Present, from the selected artboard — or the one in view"],
                    ["⇧⌥⌘↵", "Present from the start"],
                    ["", "Present the canvas — no key; Search ⌘K finds it"],
                    ["→ ← space", "Next and previous. In Present, space moves on even on a video (a click pauses it); in Edit, a tap plays it"],
                    ["L", "Pointer, in your presence colour"],
                    ["esc", "One step back — see 23"],
                  ] as [string, string][]).map(([k, a]) => (
                    <span className="md-kl-r" key={a}>
                      <span className="md-kl-k">{k ? k.split(" ").map((x) => <Kbd key={x}>{x}</Kbd>) : <span className="md-kl-none">—</span>}</span>
                      <span>{a}</span>
                    </span>
                  ))}
                </div>
                <div className="md-vm-w">
                  <p className="island-title">Menu › View, amended</p>
                  <div className="md-vm">
                    <Menu width={290} style={{ position: "relative", left: "auto", top: "auto" }} items={[
                      { label: "Hide panels", keys: "⌘\\" }, { label: "Comments", keys: "⇧⌘M" }, { label: "Assets" }, { label: "Annotations", keys: "⇧P" }, "sep",
                      { label: "Preview", keys: "⌥⌘P" }, { label: "Present", keys: "⌥⌘↵" }, { label: "Present from the start", keys: "⇧⌥⌘↵" }, { label: "Present the canvas", note: "in CONTRACT §1" }, "sep",
                      { label: "Zoom in", keys: "⌘+" }, { label: "Zoom out", keys: "⌘−" }, { label: "Zoom to fit", keys: "⌘0" }, { label: "Actual size", keys: "⌘1" }, "sep",
                      { label: "Advanced", sub: true },
                    ]} />
                  </div>
                  <p className="md-vm-cap"><i />New or renamed rows. The Present menu (8) lists the same rows with the same keys.</p>
                </div>
              </div>
            </div>
            <div className="md-close-note"><Note n={2} title="One name: Present.">Every way of presenting starts with the word, in every menu. Mode glyphs are drawn for modes only — kit candidates, never reused by a tool, a menu row or a status word.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 1 · Edit ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="edit" title="Edit — the default" subtitle="Everything visible; a button's On click says where Preview will go; ⌥ measures here too">
        <DCArtboard id="md-edit" label="3 · Edit — set up where a click goes" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Edit is home.">Select “See pricing”: its On click reads Go to Pricing, and the link shows on the canvas while it's selected. Hold ⌥ and point at a neighbour to measure — in Edit as in Inspect.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomepageCanvas select />
                <span className="md-mhover" style={{ left: 80 + 64 * ek, top: 120 + 600 * ek, width: 405 * ek, height: 236 * ek }} />
                <Measure x1={80 + 342 * ek} y1={120 + 488 * ek} x2={80 + 342 * ek} y2={120 + 600 * ek} label="112" />
                <span className="md-link md-link--h" style={{ left: 284, top: 336, width: 14 }} />
                <span className="md-linkchip" style={{ left: 298, top: 323 }}><Icon name="link" size={13} />Go to Pricing</span>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <MdCluster people={["tereza"]} mode="edit" />
              <Inspector title="See pricing" kind="Button" rows={[
                ["Size", <InSize w={184} h={52} />],
                ["Fill", <InFill name="Paper" />],
                ["Border", <InFill name="Ink" tone="ink" pct="1.5" />],
                ["On click", <span className="md-focus"><InSelect value="Go to Pricing" /></span>],
                ["On hover", <InSelect value="Fill with Ink" />],
              ]} advanced={[["border", "1.5px solid var(--ink)"], ["border-radius", "999px"], ["href", "/pricing"]]} />
              <ZoomUndo zoom={47} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Preview ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="preview" title="Preview — the canvas, alive" subtitle="Every artboard works in place; stickies and pins stay; pan anywhere · a link to another canvas · a canvas with no links at all">
        <DCArtboard id="md-motion" label="4 · Edit → Preview, in motion" width={W} height={830} fixed>
          <V2 className="md-close md-close--col">
            <p className="md-close-h">Edit → Preview: the same artboard, no cut.</p>
            <p className="md-close-lede">One press of Preview. The chrome folds toward its icons while the camera eases onto the artboard you were on — 220 ms on <span className="md-tok">--dur-panel</span>, shaped by <span className="md-tok">--ease-out</span>.</p>
            <div className="md-film">
              <Frame n={1} t="0 ms" title="Edit. You press Preview; the dashed box is where the artboard will land."><EditPreviewFrame p={0} click /><Ghost /></Frame>
              <Frame n={2} t="40 ms" pct={`${Math.round(mid * 100)} % of the way`} title="Ease-out does most of the move early: panels shrink toward their icons, edit-only tools slide out."><EditPreviewFrame p={mid} /><Ghost /></Frame>
              <Frame n={3} t="220 ms" title="Preview. The Desktop artboard fills the view, live; the switch hasn't moved."><EditPreviewFrame p={1} /></Frame>
            </div>
            <div className="md-chor">
              <div className="md-chor-g">
                <EaseCurve marks={[0, 40, 220]} total={220} />
                <p className="md-chor-tok"><span className="chip">--dur-panel · 220 ms</span><span className="chip">--ease-out</span><span className="md-chor-rm">Reduce motion: a 1 ms cut to frame 3.</span></p>
              </div>
              <div className="md-chor-l">
                {([
                  ["Toolbar", "The tools that only edit — Select, Frame, Shape, Pen, Text — slide out. Hand, Sticky, Comment and More stay."],
                  ["Panels", "The Canvases panel and the AI chat panel fold into their icons, in the corners they came from."],
                  ["Camera", "Eases onto the artboard you were on. Same artboard, same place on the canvas — no new page."],
                  ["Switch", "Stays put; only the pressed segment moves. Faces and status fade beside it."],
                ] as [string, string][]).map(([k, v]) => (
                  <p key={k}><strong>{k}</strong>{v}</p>
                ))}
              </div>
            </div>
            <div className="md-close-note md-close-note--col"><Note n={4} title="The promise, made visible.">One switch, one place, one artboard: Preview is the canvas you were already looking at, waking up. Back to Edit runs the same frames in reverse.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="md-preview" label="5 · Previewing Homepage" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="The canvas, alive.">Every artboard works in place: links, hovers, video. Stickies and Jonas's pin stay; the toolbar keeps Hand, Sticky, Comment and More. Pan anywhere. esc returns to Edit on the artboard in view.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards z={pz} ox={170} oy={84} hover="cta" />
                <Sticky color="yellow" x={22} y={250} rotate={-2} w={128}>Hero: teplejší obloha?</Sticky>
                <CommentPin who="jonas" x={170 + 1290 * pz} y={84 + 628 * pz} />
                <Hand x={170 + 420 * pz} y={84 + 468 * pz} />
              </Canvas>
              <ProjectPill project="Studio site" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar name="Homepage" />
              <MdCluster mode="preview" compact />
              <ZoomOnly zoom="76%" />
              <SlimDock />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-preview-follow" label="6 · Followed a link to Pricing" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="A link to another canvas opens it in Preview.">See pricing goes to the Pricing canvas, on its Desktop artboard; ‹ Homepage goes back. Tablet sits beside it, live too. Tereza's pin is here — comments don't hide in Preview.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={110} y={84} w={1000} h={625}><Scaled w={1000}><SitePricing hoverYearly /></Scaled></Artboard>
                <Artboard label="Tablet" kind="web" x={1158} y={84} w={579} h={829}><Scaled w={579} base={[834, 1194]}><SitePricing narrow /></Scaled></Artboard>
                <CommentPin who="tereza" x={724} y={248} />
                <Hand x={680} y={292} />
              </Canvas>
              <ProjectPill project="Studio site" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar back="Homepage" name="Pricing" />
              <MdCluster mode="preview" compact />
              <ZoomOnly zoom="69%" />
              <SlimDock />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-preview-combine" label="7 · Preview on a canvas with no links" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="No links — Preview still earns its place.">Videos play with sound, the web page scrolls inside its artboard, and you pan across all 15. Nothing can be moved by accident.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <CampaignBoards live />
                <span className="md-abchip" style={{ left: 346, top: 510 }}><SoundGlyph size={13} />Playing</span>
                <span className="md-abchip" style={{ left: 96, top: 278 }}><Icon name="chevron" size={12} />Scrolls</span>
                <Sticky color="coral" x={846} y={556} rotate={1.5} w={150}>Teaser zkrátit na 15 s?</Sticky>
                <CommentPin who="tereza" x={900} y={336} />
                <Hand x={712} y={404} />
              </Canvas>
              <ProjectPill project="Alligators brand" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar name="Combine-kampan" />
              <MdCluster mode="preview" compact />
              <ZoomOnly zoom="14%" />
              <SlimDock />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Present ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="present" title="Present — artboards one by one, or the whole canvas" subtitle="Combine-kampan: 15 artboards of web, social, video and print · the lift · presenter view · a link for cloud viewers">
        <DCArtboard id="md-present-menu" label="8 · Present, and its small menu" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Present has a small menu.">A click on Present starts from the selected artboard. The arrow beside it offers the start, the whole canvas with nothing on it, presenter view, the order and notes, and a link that follows you.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><CampaignBoards selected={2} /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <MdCluster people={["tereza", "jonas"]} mode="edit" menu />
              <Menu style={{ right: 16, top: 62 }} width={352} items={[
                { group: "Artboards, one by one" },
                { label: "Present from “Post 1:1 · Combine 2026”", keys: "⌥⌘↵", highlight: true },
                { label: "Present from the start", keys: "⇧⌥⌘↵" },
                { group: "The canvas, pan freely" },
                { label: "Present the canvas", note: "no chrome, no pins" },
                "sep",
                { label: "Presenter view on another display", checked: true, note: "LG UltraFine" },
                { label: "Order and notes…" },
                "sep",
                { label: "Copy presentation link", note: "follows you live" },
              ]} />
              <ZoomUndo zoom={14} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-present-lift" label="9 · Present lifts the artboard out of the canvas" width={W} height={780} fixed>
          <V2 className="md-close md-close--col">
            <p className="md-close-h">Present lifts the artboard out of the canvas.</p>
            <p className="md-close-lede">The selected artboard rises from its place and fills the screen while everything else sinks into the dark. esc sets it back exactly where it was — the canvas never moved.</p>
            <div className="md-film">
              <Frame n={1} t="0 ms" title="⌥⌘↵, or a click on Present, with Post 1:1 · Combine 2026 selected."><LiftFrame p={0} click /></Frame>
              <Frame n={2} t="40 ms" pct={`${Math.round(liftMid * 100)} % of the way`} title="The artboard rises toward the centre, growing as it goes; the chrome and the other artboards sink into the dark."><LiftFrame p={liftMid} /></Frame>
              <Frame n={3} t="280 ms" title="Present · Artboards: 3 of 14. Only the work, and the controls until the mouse rests."><LiftFrame p={1} /></Frame>
            </div>
            <svg className="md-back" width="1312" height="64" viewBox="0 0 1312 64" aria-hidden="true">
              <path d="M1104 6 C 1104 52, 900 56, 656 56 S 208 52, 208 10" />
              <path d="M200 20 L208 8 L216 20" />
            </svg>
            <p className="md-back-t"><Kbd>esc</Kbd>runs it backwards: the artboard settles into its slot, and selection, zoom and panels are as you left them. <span className="chip">--dur-route · 280 ms</span><span className="chip">--ease-out</span><span className="md-chor-rm">Reduce motion: a 1 ms cut both ways.</span></p>
            <div className="md-close-note md-close-note--col"><Note n={9} title="A deck that is still the canvas.">Present doesn't open a new document — it lifts the work out of the place it lives and puts it back. Present the canvas skips the lift: the camera simply stays.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="md-present-full" label={`10 · Full screen — 3 of ${RUN}`} width={W} height={H} fixed>
          <ScreenStage note={<Note n={10} title="Only the work.">→ ← or space step through in canvas order (space moves on, as a clicker does). L turns the pointer into a ringed dot in your presence colour. The controls fade after two seconds; with Reduce motion they just hide.</Note>}>
            <div className="md-slide" style={{ left: 310, top: 40, width: 820, height: 820 }}><Fit w={820} h={820} bw={320}><SlideArt i={2} /></Fit></div>
            <Laser x={640} y={500} />
            <PresentControls n={3} label="Post 1:1 · Combine 2026" />
          </ScreenStage>
        </DCArtboard>

        <DCArtboard id="md-present-video" label="11 · A 9:16 video plays inline" width={W} height={H} fixed>
          <ScreenStage note={<Note n={11} title="Video plays where it stands.">Reels · nábor starts with sound when its turn comes, pillarboxed on a wide screen. A click on the video pauses it; → or space moves on mid-clip — nothing waits for the end.</Note>}>
            <div className="md-slide md-novbar" style={{ left: 495, top: 24, width: 450, height: 800 }}><Fit w={450} h={800} bw={225}><VideoFrameMock vertical caption="STAŇ SE GATOREM" time="0:06 / 0:15" /></Fit></div>
            <PresentControls n={9} label="Reels · nábor" video="0:06 / 0:15" />
          </ScreenStage>
        </DCArtboard>

        <DCArtboard id="md-present-canvas" label="12 · Present the canvas — pan freely" width={W} height={H} fixed>
          <ScreenStage kind="canvas" note={<Note n={12} title="Today's Presentation mode, kept.">No chrome, no pins, no annotations — only the artboards where they live. Drag or scroll to pan, pinch to zoom — for mood-board canvases and long walkthroughs. esc returns to the same view.</Note>}>
            <CampaignBoards z={1.5} dx={-90} dy={-70} labels={false} />
            <span className="md-grab maude-v2 k-fixed" data-theme="light" style={{ left: 706, top: 352 }}><Icon name="hand" size={26} /></span>
            <CanvasPill zoom="21%" />
          </ScreenStage>
        </DCArtboard>

        <DCArtboard id="md-presenter" label="13 · Presenter view on the Mac" width={W} height={H} fixed>
          <ScreenStage kind="ui" note={<Note n={13} title="Your screen, not theirs.">The audience gets the artboard on the second display; the Mac shows now, next, notes, the clock — and the order as the canvas itself, so you can jump by where things live.</Note>}>
            <PresenterView cur={4} />
          </ScreenStage>
        </DCArtboard>

        <DCArtboard id="md-present-link" label="14 · Watching from a link — and looking back" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Following Tereza, in a browser.">← took you back to 5 on your own, so the bar offers one action: Catch up. In a browser, esc first leaves the browser's full screen. A Share link opens the canvas instead.</Note>}>
            <BrowserWin url="alligators.cloud.maude.sh/present/combine-kampan">
              <div className="md-screen md-screen--stage md-screen--flat">
                <div className="md-slide" style={{ left: 410, top: 90, width: 620, height: 620 }}><Fit w={620} h={620} bw={320}><GatorMock variant="numbers" /></Fit></div>
                <div className="island md-follow">
                  <span className="md-live md-live--off"><i />Live</span>
                  <Avatar who="tereza" />
                  <span>Tereza is on <strong>6 of {RUN}</strong> · you're on 5</span>
                  <span className="btn btn--sm btn--primary">Catch up</span>
                </div>
                <span className="md-watch"><span className="k-faces"><Avatar who="you" /><Avatar who="jonas" /><Avatar ini="+4" tone="grey" /></span>6 watching</span>
              </div>
            </BrowserWin>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Comment ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="comment" title="Comment — a tool, in Edit or Preview" subtitle="Pins on artboards, threads, resolve, Open / Mine, @mentions · someone who may only comment">
        <DCArtboard id="md-comment" label="15 · Pins, a thread, a mention" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="C pins a comment to the spot.">The thread opens beside its pin; Resolve hides it from Open. The panel filters Open and Mine, newest first. @ suggests people on the project, with what they can do.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={312} y={96} w={704} h={440}><Scaled w={704}><SitePricing /></Scaled></Artboard>
                <Artboard label="Tablet" kind="web" x={1100} y={96} w={200} h={286}><Scaled w={200} base={[834, 1194]}><SitePricing narrow /></Scaled></Artboard>
                <CommentPin who="tereza" x={724} y={196} />
                <CommentPin who="jonas" x={360} y={318} />
                <CommentPin who="you" x={1150} y={250} />
                <Thread x={762} y={190} />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Pricing" />
              <CommentsPanel />
              <MdCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={49} />
              <Toolbar tool="comment" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-comment-only" label="16 · Someone who may only comment" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Can comment: Select, Hand, Comment.">Clicks select for specs. No editing tools, no AI chat panel — hidden, not greyed.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {UNI.map((b, i) => (
                  <Artboard key={b.label} label={b.label} kind="digital" x={300 + (i % 3) * 368} y={130 + Math.floor(i / 3) * 252} w={336} h={189}><UniBoard {...b} /></Artboard>
                ))}
                <CommentPin who="jonas" x={1128} y={448} text="Pruh na helmě sjednotit s dresem?" count={2} />
                <CommentPin who="you" x={772} y={236} />
                <div className="md-th md-th--new" style={{ left: 810, top: 232 }}>
                  <div className="md-th-msg"><Avatar who="you" size="sm" /><span className="md-th-in md-th-in--wrap">Číslo na zádech by mělo být větší — z tribuny ho není vidět.<i className="k-caretline" /></span></div>
                  <div className="md-th-acts"><span className="md-th-hint">@ to mention</span><span className="btn btn--sm">Cancel</span><span className="btn btn--sm btn--primary">Post</span></div>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Uniformy-2027" />
              <CanvasesPanel project="Alligators brand" count={ALLIGATORS_COUNT} selected="Uniformy-2027" folders={DRESY_TREE} items={ALLIGATORS_ROOT} />
              <MdCluster people={["tereza", "jonas"]} mode="viewing" canEdit={false} access="Can comment" />
              <ZoomOnly zoom="32%" />
              <SlimDock tools={COMMENT_TOOLS} pressed="comment" more={false} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Annotations ─────────────────────────────────────────────────────────────── */}
      <DCSection id="draw" title="Annotations — a layer above the artboards" subtitle="Stickies, arrows, a section, a highlight; AI reads the layer and works through it · the same tools stay in Preview">
        <DCArtboard id="md-draw" label="17 · Annotations AI can read" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Think on top of the work.">Stickies, arrows, sections and highlights sit on their own layer and never change the artboards. AI reads them — “do what the stickies say” works, and it asks when one is unclear. ⇧P hides the layer.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <DrawSection x={300} y={88} w={760} h={500} title="Feedback od trenérů" />
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={340} y={150} w={260} h={260}><div className="md-wrap md-bolddate"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={640} y={150} w={146} h={260}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
                <span className="md-hl" style={{ left: 357, top: 272, width: 128 }} />
                <Sticky color="yellow" x={846} y={150} rotate={-2} w={136}>Logo větší?</Sticky>
                <Sticky color="coral" x={846} y={300} rotate={1.5} w={136}>Na story méně textu</Sticky>
                <Sticky color="green" x={360} y={448} rotate={-1.5} w={150}>Datum tučně — 14. 3.</Sticky>
                <svg className="md-arrows" width="1440" height="860" viewBox="0 0 1440 860" aria-hidden="true">
                  <path d="M884 150 C 860 104, 340 104, 322 150 S 336 196, 360 200" />
                  <path d="M352 192 l9 8 l-11 4" />
                  <path d="M846 340 C 820 340, 806 330, 792 318" />
                  <path d="M790 316 l4 13 M790 316 l13 -2" />
                  <path d="M512 468 C 566 440, 548 300, 490 282" />
                  <path d="M489 282 l12 -6 M489 282 l9 9" />
                </svg>
                <Cursor2 />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <MdCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={36} />
              <Toolbar tool="arrow" more />
              <AIPanel
                scope="Feedback od trenérů"
                messages={[
                  { from: "you", text: "Do what the stickies in Feedback od trenérů ask" },
                  { from: "ai", text: "Done — the date on the post is bolder, and the story is down to “ZAPIŠ SE · do 10. 3.”. One sticky needs you." },
                ]}
                question={{ text: <>“Logo větší?” — make the crest bigger, or the whole lockup?</>, primary: "The crest", secondary: "The lockup" }}
              />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Inspect ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="inspect" title="Inspect — read-only specs" subtitle="⌘-click in Preview, or a click in Viewing: sizes, gaps, colours, export, Handoff, Copy code">
        <DCArtboard id="md-inspect" label="18 · Inspect “Book a call”" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Specs without the knobs.">Values read as words and numbers; hold ⌥ and point at a neighbour for the gap. Raw CSS waits under Advanced. Edit ↵ switches to Edit with Book a call selected; Handoff sends it on.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={80} y={84} w={1000} h={625}><Scaled w={1000}><SiteHome /></Scaled></Artboard>
                <span className="md-osel" style={{ left: 80 + 1226 * ik, top: 84 + 20 * ik, width: 150 * ik, height: 48 * ik }}><span className="k-sel-tag">150 × 48</span></span>
                <span className="md-mhover" style={{ left: 80 + 1112 * ik, top: 84 + 30 * ik, width: 66 * ik, height: 28 * ik }} />
                <Measure x1={80 + 1178 * ik} y1={84 + 44 * ik} x2={80 + 1226 * ik} y2={84 + 44 * ik} label="48" />
                <Measure x1={80 + 1340 * ik} y1={84} x2={80 + 1340 * ik} y2={84 + 20 * ik} label="20" />
                <Measure x1={80 + 1376 * ik} y1={84 + 44 * ik} x2={1080} y2={84 + 44 * ik} label="64" />
              </Canvas>
              <ProjectPill project="Studio site" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar name="Homepage" />
              <MdCluster mode="preview" compact />
              <InspectPanel style={{ top: 72, width: 300 }} />
              <ZoomOnly zoom="69%" />
              <SlimDock />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Edge cases ──────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When modes meet the real world" subtitle="AI changing the artboard you're using, a view-only link, mixed kinds on one screen, no internet, and what esc does everywhere">
        <DCArtboard id="md-edge-ai" label="19 · AI changes the artboard you're clicking through" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="AI never pulls the page out from under you.">The artboard under your pointer holds still, hover and all; AI's new hero lands when you move off it. Tablet, which you aren't touching, updates live.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards z={pz} ox={170} oy={84} hover="cta" aiDesktop="AI has a new hero — it lands when you move off" aiTablet />
                <Hand x={170 + 420 * pz} y={84 + 468 * pz} />
              </Canvas>
              <ProjectPill project="Studio site" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar name="Homepage" />
              <MdCluster mode="preview" compact />
              <ZoomOnly zoom="76%" />
              <SlimDock />
              <PanelIcon icon="spark" at="ai" dot />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-edge-viewer" label="20 · A view-only link, in a browser" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="Can view: it opens in Preview.">The designs are live, pins show, nothing can change — and Viewing is one click away for specs. The menu lists only what a viewer can do: Version history opens to look, without Restore.</Note>}>
            <BrowserWin url="alligators.cloud.maude.sh/social/matchday">
              <Canvas>
                <Artboard label="Post · Gameweek 4" kind="digital" x={330} y={130} w={240} h={240}><div className="md-wrap md-noem"><GatorMock variant="social" headline="GAMEWEEK 4" sub="So 15:00 · Riviera" /></div></Artboard>
                <Artboard label="Story · Zápas dnes" kind="digital" x={600} y={130} w={135} h={240}><div className="md-wrap md-noem"><GatorMock variant="reel" headline="ZÁPAS DNES" sub="15:00 · Riviera" /></div></Artboard>
                <Artboard label="Post · Výsledek" kind="digital" x={765} y={130} w={240} h={240}><div className="md-wrap md-noem"><GatorMock variant="social" headline="34 : 21" sub="Alligators vs. Ostrava Steelers" /></div></Artboard>
                <Artboard label="Story · MVP zápasu" kind="digital" x={1035} y={130} w={135} h={240}><div className="md-wrap md-noem"><GatorMock variant="reel" headline="MVP" sub="#27 · 3 touchdowny" /></div></Artboard>
                <Artboard label="Reels · sestřih" kind="video" x={330} y={430} w={135} h={240}><VideoFrameMock vertical caption="TOUCHDOWN" time="0:09 / 0:30" /></Artboard>
                <Artboard label="16:9 · sestřih" kind="video" x={495} y={430} w={427} h={240}><VideoFrameMock caption="Gameweek 4" time="0:21 / 1:10" /></Artboard>
                <CommentPin who="jonas" x={980} y={150} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="matchday" open />
              <div className="k-menu md-vmenu">
                <span className="k-menu-search"><Icon name="search" size={14} /><span>Search</span><Kbd>⌘K</Kbd></span>
                <MenuRowsLocal />
              </div>
              <PreviewBar name="matchday" hint="for Viewing" />
              <MdCluster people={["tereza"]} mode="preview" canEdit={false} access="Can view" />
              <ZoomOnly zoom="40%" />
            </BrowserWin>
          </Stage>
        </DCArtboard>

        <DCArtboard id="md-edge-mixed" label="21 · Mixed kinds on one screen" width={W} height={900} fixed>
          <V2 className="md-close md-close--col">
            <p className="md-close-h">Every kind fills the screen its own way.</p>
            <p className="md-close-lede">Presenting Combine-kampan walks web, social, video and print in canvas order. Each kind gets the treatment people expect from it.</p>
            <div className="md-mix">
              {([
                [0, "width", "Web · fills the width", "Starts at the top and scrolls with the trackpad."],
                [2, "contain", "Post 1:1 · fits the height", "Centred on the dark stage, never cropped."],
                [8, "contain", "Reels 9:16 · plays", "Pillarboxed, with sound. A click pauses."],
                [10, "contain", "A4 print · at the trim", "Bleed stays off-screen; print guides show it if they're on."],
                [13, "contain", "Banner 1200 × 300 · letterboxed", "Centred at full width, the stage around it."],
                [9, "fill", "16:9 video · edge to edge", "Holds its last frame when it ends; → moves on."],
              ] as [number, "contain" | "width" | "fill", string, string][]).map(([i, fit, t, d]) => (
                <div className="md-mix-c" key={t}>
                  <ScreenBox i={i} w={400} h={225} fit={fit}>
                    {i === 0 ? <span className="md-scroll md-scroll--sm" /> : null}
                  </ScreenBox>
                  <p className="md-mix-t"><Icon name={CAMPAIGN[i].kind} size={13} />{t}</p>
                  <p className="md-mix-d">{d}</p>
                </div>
              ))}
            </div>
            <div className="md-close-note md-close-note--col"><Note n={21} title="One rule per kind, no settings.">Fit, scroll, play or trim follows the artboard's kind. A skipped artboard (Banner FB cover) stays on the canvas — it's only left out of the run, which is why the counters say 14.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="md-edge-offline" label="22 · Presenting with no internet" width={W} height={H} fixed>
          <ScreenStage kind="ui" note={<Note n={22} title="Offline still presents.">Everything on this Mac plays. The one clip that never downloaded holds its first frame on the audience screen; only presenter view says why, with Skip. Copy presentation link waits for a connection.</Note>}>
            <PresenterView cur={9} offline />
          </ScreenStage>
        </DCArtboard>

        <DCArtboard id="md-esc" label="23 · What esc does, everywhere" width={W} height={780} fixed>
          <V2 className="md-close md-close--col">
            <p className="md-close-h">esc always steps back one place.</p>
            <p className="md-close-lede">Menus, sheets and Search close first, whatever the mode. After that, each mode has one step back — never two at once, never out of the project.</p>
            <div className="md-esc">
              {([
                [{ m: "edit" }, "Edit", "Deselects, closes a menu, or leaves a tool for Select.", "Nothing selected: nothing happens."],
                [{ m: "preview" }, "Preview", "Closes a menu or overlay inside the design first.", "Then back to Edit, on the artboard in view."],
                [{ m: "present" }, "Present · Artboards", "Back to the canvas; the artboard settles into its slot.", "Presenter view closes with it."],
                [{ m: "present" }, "Present · Canvas", "Back to the canvas at the same view.", "Panels return as they were."],
                [{ ic: "comment" }, "Comment · C", "Closes the open thread; a half-written reply is kept.", "Second esc: back to the mode's resting tool."],
                [{ ic: "sticky" }, "Annotation tools", "Leaves the tool; stickies and arrows stay where they are.", "Select in Edit, the live design in Preview."],
                [{ ic: "inspect" }, "Inspect · ⌘-click", "Clears the selection.", "Second esc: back to Edit."],
                [{ m: "viewing" }, "Viewing · Can view, Can comment", "Preview → Viewing. Present → back to wherever you came from.", "There's no Edit to return to."],
                [{ ic: "arrow" }, "Switching mid-drag", "A drag is set down where it is; a half-drawn arrow is kept.", "Same as esc: nothing lost."],
                [{ ic: "lock" }, "In a browser", "The first esc leaves the browser's full screen.", "Maude's own steps follow."],
              ] as [{ m?: Mode; ic?: string }, string, string, string][]).map(([g, m, a, b]) => (
                <div className="md-esc-r" key={m}>
                  <span className="md-esc-m">{g.m ? <ModeGlyph m={g.m} size={14} /> : g.ic === "inspect" ? <InspectGlyph /> : <Icon name={g.ic ?? "file"} size={14} />}{m}</span>
                  <span className="md-esc-k"><Kbd>esc</Kbd></span>
                  <span className="md-esc-a">{a}</span>
                  <span className="md-esc-b">{b}</span>
                </div>
              ))}
            </div>
            <div className="md-close-note md-close-note--col"><Note n={23} title="Same key, same promise.">esc never discards work: a draft comment, a half-drawn arrow or an AI run in progress all survive it. Stopping AI is its own button.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

/** Tereza's cursor beside the section, writing a sticky (presence). */
function Cursor2() {
  return (
    <span className="k-cur" style={{ left: 1000, top: 420 }}>
      <svg className="k-ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--object-sky)" stroke="var(--object-ink)" strokeWidth="1" strokeLinejoin="round" /></svg>
      <span className="k-cur-tag k-cur-tag--sky">Tereza</span>
    </span>
  );
}

/** A viewer's project menu — only what someone who can view may do (the rest isn't listed, not greyed). */
function MenuRowsLocal() {
  const rows: [string, string, string?, boolean?, string?][] = [
    ["View", "view", undefined, true], ["Help", "help", undefined, true],
    ["Version history", "history", "⌥⌘H", false, "to look"], ["Export…", "export", "⇧⌘E"],
    ["Sign in…", "people"],
  ];
  return (
    <>
      {rows.map(([l, ic, k, sub, note], i) => (
        <Fragment key={l}>
          {i === 2 || i === 4 ? <span className="k-msep" /> : null}
          <span className="row-item k-mi">
            <span className="k-mi-ic"><Icon name={ic} size={14} /></span>
            <span className="k-mi-lab">{l}</span>
            {note ? <span className="k-mi-note">{note}</span> : null}
            {k ? <span className="k-mi-keys">{k}</span> : null}
            {sub ? <span className="k-mi-ch"><Icon name="submenu" size={12} /></span> : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}
