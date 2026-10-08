/**
 * @canvas      14 Editing — artboards, the objects inside them, layout, text, shapes, images, components and the
 *              inspector, told on Studio site (Homepage) and Alligators brand (Combine-kampan, Czech)
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ed-ab-select | ed-ab-resize | ed-ab-arrange | ed-ab-tidy | ed-ab-menu |
 *              ed-obj-enter | ed-obj-multi | ed-obj-order |
 *              ed-lay-auto | ed-lay-reorder | ed-lay-free |
 *              ed-text-edit | ed-text-style |
 *              ed-shape | ed-pen |
 *              ed-img |
 *              ed-comp-pick | ed-comp-instance |
 *              ed-inspector |
 *              ed-edge-ai | ed-edge-ask | ed-edge-tereza | ed-edge-huge | ed-edge-undo | ed-edge-paste | ed-edge-keys
 * @brief       "jeste me doslo ze tam vubec neni navrh jak bude vypadat prace s artboards a annotations, jak bude
 *              vypadat ta samotna editace a objekty atd." — this canvas: ARTBOARDS + OBJECTS + EDITING.
 *              Annotations (stickies, marker, arrows, stamps, sections) live in 15 Annotations.
 *
 * Toolbar = the kit's Edit toolbar everywhere (CONTRACT §2: Select V · Hand H · Frame F · Shape R · Pen P · Text T ·
 * Image I · Component ⇧I · More = Line · Ellipse · Polygon · Crop · Export area). Every Share cluster is mode="edit".
 *
 * TODAY → V2 (nothing deleted): ⌘-click / ⌘⇧-click selection → plain click + ⇧-click, double-click enters a frame ·
 * dc-snap-guide (sibling + grid) + distance pills → smart guides and spacing chips in the guide colour (magenta, never
 * the selection azure — DDR-046) · artboard hug height → Height "Fits content" · inspector Layout Row/Column, Hug/Fixed,
 * Space between, Start/Center/End/Stretch → Layout section with token chips · "convert to absolute" → Layout ›
 * Advanced › Convert layout to absolute · Advanced — raw CSS / Copy CSS → Advanced at the inspector's foot · purple
 * instance rows + Detach → Instance inspector (Go to Tlačítko · Detach) · Layers tree (Hidden / Visible, Keep
 * selectable / locked) → the Layers tab, synced with the canvas · Bring forward / Send backward → the object menu.
 *
 * Convention (same as 01/04/08/13): app artboards are <Stage> — 1440 × 900 window + note strip (artboard 1440 × 980).
 * Close-ups carry their own note strip at the foot. Designs are drawn ONCE at their real size (SiteHome 1440 × 1573,
 * Post 1080 × 1080, Story 1080 × 1920, ClubPage 1440 × 6000) and scaled; every overlay (selection, guides, chips)
 * is computed from the same design rects (HR, PR, SR) so it lands on the object at any zoom. The user's designs are
 * theme-pinned (.maude-v2.k-fixed light) — only the chrome around them follows the app theme. Local pieces: `ed-`.
 * Guide colour = its own fixed oklch(0.55 0.20 328) magenta — not derived from the AI spark, distinct from selection
 * azure (238) and AI vermilion (36); white chip text on it = 5.4:1 in both themes (kit/DS candidate: --guide).
 *
 * NAMES — 13 Design System wins. Every token chip, menu row and variant here is taken from 13's Space & shape, Colour,
 * Type and Components sections: Studio site → corners XS 4 · S 6 · M 10 · L 14 · XL 20 · Round; spacing 4 · 8 · 12 · 16 ·
 * 24 · 32 · 48 · 64 (numbers, no names → "Space 24", CSS var(--space-24)); elevation Flat · Resting · Floating · Sheet;
 * colours Page · Panel · Raised · Well · Ink · Secondary · Quiet · Leaf …; Button Primary · Line · Ghost. Alligators →
 * corners XS 2 … XL 16 · Round; spacing 4 · 8 · 16 · 24 · 32 · 48 · 64 · 96; elevation Flat · Soft · Lifted; Klubová zelená ·
 * Inkoust · Šedá · Žlutá — akcent · Bílá; Tlačítko Plné · Obrys; Brand = Logo · Signs; Patterns = Klubový web — hero ·
 * Leták A5 · Matchday post · Story 9:16.
 * KINDS + ROWS — same as 04 Modes: a button is kind "Button" with a Border row and an Interaction section (On click ·
 * On hover). Border on boxes (frames, buttons, shapes); Stroke only on lines and Pen paths. Corners is its own section.
 * Object keys = CONTRACT §2: ] forward · [ backward · ⌘] to front · ⌘[ to back · ⌥⌘G frame selection (⌘G is an alias,
 * for Figma hands) · ⇧⌘G remove frame · ⇧⌘L lock. Copy / paste properties ⌥⌘C / ⌥⌘V.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./14 Editing.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, Artboard, Avatar, Callout, Canvas, CanvasesPanel, Cursor, HeroMock, Icon, InButton, InFill, InSeg, InSelect,
  InSwitch, Kbd, Menu, Note, PanelIcon, PhoneMock, ProjectPill, ShareCluster, Spark, Stage, TABS, Toolbar, Tooltip, V2,
  Window, ZoomUndo,
} from "./_kit";
import type { LayerRow, MenuItem } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];
const STUDIO_SYS = "Studio site system";
const GATOR_SYS = "Alligators brand system";

/* ═══ Geometry — design rects, projected onto the canvas at a zoom ══════════════════════════════ */

type R = { x: number; y: number; w: number; h: number };
type AB = { x: number; y: number; k: number };
/** A design rect on artboard `a` (x, y, zoom k) → canvas px. pad grows it on every side. */
const box = (a: AB, r: R, pad = 0): CSSProperties => ({ left: a.x + r.x * a.k - pad, top: a.y + r.y * a.k - pad, width: r.w * a.k + pad * 2, height: r.h * a.k + pad * 2 });
const cx = (a: AB, x: number) => a.x + x * a.k;
const cy = (a: AB, y: number) => a.y + y * a.k;

/* Studio site — Homepage, Desktop 1440 × 1573 (height fits content). */
const HOME_H = 1573;
const HR = {
  navBtn: { x: 1220, y: 22, w: 148, h: 44 },
  h1: { x: 72, y: 168, w: 690, h: 136 },
  sub: { x: 72, y: 328, w: 560, h: 56 },
  cta2: { x: 268, y: 424, w: 184, h: 52 },
  art: { x: 800, y: 140, w: 568, h: 400 },
  svc: { x: 72, y: 620, w: 1296, h: 280 },
  work: { x: 72, y: 960, w: 1296, h: 370 },
  nav: { x: 0, y: 0, w: 1440, h: 88 },
  hero: { x: 0, y: 88, w: 1440, h: 470 },
  eyebrow: { x: 72, y: 580, w: 160, h: 24 },
  foot: { x: 0, y: 1413, w: 1440, h: 160 },
};
const card = (i: number): R => ({ x: 96 + i * 424, y: 644, w: 400, h: 232 });

/* Alligators — Post 1:1 (1080 × 1080) and Story 9:16 (1080 × 1920), placed freely. */
const PR = {
  photo: { x: 380, y: 0, w: 700, h: 1080 },
  logo: { x: 64, y: 64, w: 120, h: 114 },
  date: { x: 800, y: 64, w: 216, h: 216 },
  title: { x: 64, y: 520, w: 900, h: 258 },
  sub: { x: 64, y: 800, w: 640, h: 60 },
  btn: { x: 64, y: 904, w: 300, h: 96 },
};
const SR = {
  date: { x: 800, y: 64, w: 216, h: 216 },
  title: { x: 64, y: 1170, w: 952, h: 300 },
  btn: { x: 290, y: 1660, w: 500, h: 120 },
};

/* ═══ Local glyphs (16 grid, 1.5 round stroke — the house hand). Kit candidates. ═══════════════ */

const LG: Record<string, ReactNode> = {
  "dir-row": <path d="M2.5 8h10M9.5 5l3 3-3 3" />,
  "dir-col": <path d="M8 2.5v10M5 9.5l3 3 3-3" />,
  "dir-grid": <path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" />,
  "dir-free": (<><rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeDasharray="2 2" /><path d="M5 5h3.5v3.5H5zM9.5 9.5h2v2h-2z" /></>),
  "al-left": <path d="M2.5 2.5v11M5 4.5h8v3H5zM5 9.5h5v2.5H5z" />,
  "al-hc": <path d="M8 2.5v11M4 4.5h8v3H4zM5.5 9.5h5v2.5h-5z" />,
  "al-right": <path d="M13.5 2.5v11M3 4.5h8v3H3zM6 9.5h5v2.5H6z" />,
  "al-top": <path d="M2.5 2.5h11M4.5 5v8h3V5zM9.5 5v5H12V5z" />,
  "al-vm": <path d="M2.5 8h11M4.5 4v8h3V4zM9.5 5.5v5H12v-5z" />,
  "al-bottom": <path d="M2.5 13.5h11M4.5 3v8h3V3zM9.5 6v5H12V6z" />,
  "dist-h": <path d="M2.5 2.5v11M13.5 2.5v11M6.5 5h3v6h-3z" />,
  "dist-v": <path d="M2.5 2.5h11M2.5 13.5h11M5 6.5h6v3H5z" />,
  tidy: <path d="M2.5 4.5h4v4h-4zM9.5 4.5h4v4h-4zM2.5 11.5h11" />,
  token: <path d="M8 3.25L12.75 8 8 12.75 3.25 8z" />,
  rotate: <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M11.5 2.5v2.5H9" />,
  unlink: <path d="M6.5 9.5L5 11a2 2 0 0 1-2.8-2.8l1.5-1.5M9.5 6.5L11 5a2 2 0 0 1 2.8 2.8l-1.5 1.5M6 3V2M3 6H2M10 13v1M13 10h1" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  "ta-left": <path d="M3 4h10M3 7h7M3 10h10M3 13h6" />,
  "ta-center": <path d="M3 4h10M4.5 7h7M3 10h10M5 13h6" />,
  "ta-right": <path d="M3 4h10M6 7h7M3 10h10M7 13h6" />,
  "ta-just": <path d="M3 4h10M3 7h10M3 10h10M3 13h6" />,
  "pt-smooth": (<><path d="M2.5 12.5C4 6 12 6 13.5 12.5" /><path d="M3.5 6.75h9" /><circle cx="8" cy="6.75" r="1.25" /></>),
  "pt-sharp": (<><path d="M2.5 12.5L8 5l5.5 7.5" /><path d="M6.5 5h3" /></>),
  union: <path d="M2.5 2.5h7v4h4v7h-7v-4h-4z" />,
  subtract: (<><path d="M2.5 2.5h7v4h-3v3h-4z" /><path d="M6.5 6.5h7v7h-7z" strokeDasharray="1.5 1.5" /></>),
  intersect: (<><path d="M2.5 2.5h7v7h-7zM6.5 6.5h7v7h-7z" strokeDasharray="1.5 1.5" /><path d="M6.5 6.5h3v3h-3z" /></>),
  exclude: <path d="M2.5 2.5h7v4h-3v3h-4zM9.5 6.5h4v7h-7v-4h3z" />,
  speaker: (<><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.75a6 6 0 0 1 0 8.5" /></>),
  picture: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
};
function G({ n, size = 16 }: { n: string; size?: number }) {
  if (!(n in LG)) return <Icon name={n} size={size} />;
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{LG[n]}</svg>
  );
}

/** The Alligators "A" mark — paths verbatim from assets/logos/mark-green.svg (as lifted in 13 Design System). */
function GatorMark({ size = 64 }: { size?: number }) {
  return (
    <svg className="ed-gmark" width={size} height={Math.round(size * 0.952)} viewBox="777.6 1499.8 39.9 38" fillRule="evenodd" aria-hidden="true">
      <path fillRule="nonzero" fill="currentColor" d="M801.109,1529.41L804.796,1529.41L803.269,1525C799.649,1523.74 795.577,1523.31 791.841,1524.38L790.099,1529.41L794.005,1529.41L794.005,1535.43L779.967,1535.43L779.967,1529.41L782.725,1529.41L792.808,1502.12L802.599,1502.12L812.462,1529.41L815.147,1529.41L815.147,1535.43L801.109,1535.43L801.109,1529.41ZM793.798,1518.67C797.592,1519.17 800.672,1521.93 803.244,1525L797.398,1508.16L793.798,1518.67Z" />
      <path fill="currentColor" d="M801.642,1526.66C799.001,1525.880 796.147,1525.59 793.436,1526.13L793.023,1527.32L796.086,1527.32L796.086,1537.51L777.885,1537.51L777.885,1527.32C777.885,1527.32 781.275,1527.32 781.275,1527.32L791.358,1500.03L804.06,1500.03L804.308,1500.72C804.308,1500.72 812.393,1523.09 813.923,1527.32L817.229,1527.32L817.229,1537.51L799.028,1537.51L799.028,1527.32L801.871,1527.32L801.642,1526.66ZM803.334,1528.37L800.068,1528.37L800.068,1536.47L816.188,1536.47L816.188,1528.37L813.192,1528.37L803.329,1501.08L792.083,1501.08L782,1528.37L778.926,1528.37L778.926,1536.47L795.046,1536.47L795.046,1528.37L791.561,1528.37L792.643,1525.24C795.867,1524.45 799.321,1524.81 802.453,1525.82C802.453,1525.82 803.334,1528.37 803.334,1528.37ZM795.169,1517.88L797.405,1511.35L800.732,1520.94C799.059,1519.52 797.211,1518.4 795.169,1517.88ZM796.502,1517.2C797.254,1517.47 797.982,1517.81 798.685,1518.21L797.411,1514.54L796.502,1517.2Z" />
    </svg>
  );
}

/* ═══ The user's designs (theme-pinned, drawn at real size) ═══════════════════════════════════ */

const FIXED = "maude-v2 k-fixed";

/** A design at its real size, scaled to the artboard's zoom. `top` shifts it (a zoomed-in crop). */
function Scaled({ k, w, h, top = 0, children }: { k: number; w: number; h: number; top?: number; children: ReactNode }) {
  return <div className="ed-scaled" style={{ width: w, height: h, top, transform: `scale(${k})` }}>{children}</div>;
}

type CardId = "product" | "brand" | "apps";
const CARDS: Record<CardId, { t: string; d: string; tone: string }> = {
  product: { t: "Product design", d: "Apps and tools people enjoy using.", tone: "coral" },
  brand: { t: "Brand systems", d: "Logos, type and colour that hold up.", tone: "green" },
  apps: { t: "Small apps", d: "From sketch to the App Store in weeks.", tone: "lilac" },
};
function SvcCard({ id, style, className = "", ai = false }: { id: CardId; style?: CSSProperties; className?: string; /** AI is adding a line here */ ai?: boolean }) {
  const c = CARDS[id];
  return (
    <span className={`ed-sh-card ed-sh-card--${c.tone} ${className}`} style={style}>
      <b className="ed-sh-dot" />
      <strong>{c.t}</strong>
      <span>{c.d}</span>
      {ai ? <i className="ed-sh-cardsk" /> : null}
    </span>
  );
}

type HomeO = { w?: number; slots?: (CardId | "slot")[]; footer?: "done" | "ai"; caret?: boolean; cardsAi?: boolean };
/** Studio site — Homepage, Desktop. Section heights are fixed so HR rects hold at 1440. */
function SiteHome({ o = {} }: { o?: HomeO }) {
  const slots = o.slots ?? ["product", "brand", "apps"];
  return (
    <div className={`ed-sh ${FIXED}`} data-theme="light" style={{ width: o.w ?? 1440, height: HOME_H }}>
      <div className="ed-sh-nav">
        <span className="ed-sh-logo"><b />Studio</span>
        <span>Work</span><span>Services</span><span>Pricing</span><span>About</span>
        <em>Book a call</em>
      </div>
      <p className="ed-sh-h1">Calm software, made in Brno.{o.caret ? <i className="ed-caret" /> : null}</p>
      <p className="ed-sh-sub">A small studio for product and brand. Two designers, one developer, no rush.</p>
      <div className="ed-sh-ctas"><span className="ed-sh-btn ed-sh-btn--ink">See the work</span><span className="ed-sh-btn ed-sh-btn--line">See pricing →</span></div>
      <div className="ed-sh-art"><span className="ed-sh-sun" /><span className="ed-sh-hill" /><span className="ed-sh-hill2" /></div>
      <p className="ed-sh-eyebrow">What we do</p>
      <div className="ed-sh-svc">
        {slots.map((s, i) => (s === "slot" ? <span key={"s" + i} className="ed-sh-slot" /> : <SvcCard key={s} id={s} ai={o.cardsAi} />))}
      </div>
      <p className="ed-sh-wt">Selected work</p>
      <div className="ed-sh-work"><i /><i /><i /></div>
      <div className={`ed-sh-foot${o.footer === "ai" ? " ed-sh-foot--ai" : ""}`}>
        <span className="ed-sh-logo ed-sh-logo--foot"><b />Studio</span>
        <span className="ed-sh-fcol"><strong>Studio</strong><span>Work</span><span>Services</span>{o.footer === "ai" ? null : <span>Pricing</span>}</span>
        {o.footer === "ai" ? (
          <><span className="ed-sh-fcol ed-sh-sk"><i /><i /><i /></span><span className="ed-sh-news ed-sh-sk"><i /><i /></span></>
        ) : (
          <>
            <span className="ed-sh-fcol"><strong>Say hello</strong><span>hello@studio.cz</span><span>Kounicova 12, Brno</span></span>
            <span className="ed-sh-news"><strong>A note when we ship something</strong><span className="ed-sh-field">your@email.cz<em>Subscribe</em></span></span>
          </>
        )}
      </div>
    </div>
  );
}

/** A match photo — drawn in shapes (sky, stand, field, a player in the club jersey). v shifts it for asset tiles. */
function Photo({ v = 0, style, num = 27 }: { v?: number; style?: CSSProperties; /** the jersey number */ num?: number }) {
  return (
    <span className={`ed-photo ed-photo--${v}`} style={style} aria-hidden="true">
      <i className="ed-photo-sky" /><i className="ed-photo-stand" /><i className="ed-photo-field" /><i className="ed-photo-line" />
      <span className="ed-pl"><i className="ed-pl-helm" /><i className="ed-pl-body"><b>{num}</b></i><i className="ed-pl-leg ed-pl-leg--a" /><i className="ed-pl-leg ed-pl-leg--b" /></span>
    </span>
  );
}

type PostV = "combine" | "zapis" | "cisla" | "trener" | "odpocet";
const POSTS: Record<PostV, { t: [string, string]; s: string; b: string }> = {
  combine: { t: ["COMBINE", "2026"], s: "So 14. 3. · Brno, Kraví hora", b: "ZAPIŠ SE" },
  zapis: { t: ["STAŇ SE", "GATOREM"], s: "Přijď na Combine v sobotu 14. 3. — s kamarády i bez zkušeností.", b: "ZAPIŠ SE" },
  cisla: { t: ["COMBINE", "V ČÍSLECH"], s: "86 hráčů · 11 trenérů · 4,62 s na 40 yardů", b: "VÝSLEDKY" },
  trener: { t: ["TRENÉŘI", "2026"], s: "Jedenáct trenérů, čtyři pozice, jeden tým.", b: "POZNEJ JE" },
  odpocet: { t: ["UŽ ZA", "7 DNÍ"], s: "Combine 2026 · So 14. 3. · Kraví hora", b: "ZAPIŠ SE" },
};
type GO = { mark?: boolean; caret?: boolean; crop?: boolean; btn?: "ghost" | "none"; btnText?: string; btnWhite?: boolean; noLogo?: boolean; ties?: boolean };

/** Czech text: a one-letter word (v k s z o u i a) stays on the line with the next word — a no-break space. With `show`
 *  (text editing, language Čeština) each tie is drawn as a small arc so you can see what the language protects. */
const ONE = /^[vkszouiaVKSZOUIA]$/;
function Czech({ t, show = false }: { t: string; show?: boolean }) {
  const w = t.split(" ");
  const out: ReactNode[] = [];
  for (let i = 0; i < w.length; i++) {
    const sep = i < w.length - 1 ? " " : "";
    if (ONE.test(w[i]) && i < w.length - 1) {
      /* the pair never breaks (nowrap + a no-break space); the tie mark is drawn under the space */
      out.push(<span key={i} className="ed-tiepair">{w[i]}{show ? <span className="ed-tie">{"\u00a0"}<svg viewBox="0 0 12 5" aria-hidden="true"><path d="M1 1.2Q6 5.2 11 1.2" /></svg></span> : "\u00a0"}{w[i + 1]}</span>);
      out.push(i + 1 < w.length - 1 ? " " : "");
      i++;
      continue;
    }
    out.push(<Fragment key={i}>{w[i]}{sep}</Fragment>);
  }
  return <>{out}</>;
}

/** Alligators Post 1:1 — dark green, condensed type, the photo on the right. Everything placed freely. */
function Post({ v = "combine", o = {} }: { v?: PostV; o?: GO }) {
  const p = POSTS[v];
  return (
    <div className={`ed-g ed-post ${FIXED}`} data-theme="light">
      <span className="ed-post-photo">{o.crop ? <Photo style={{ left: -80, top: -140, width: 900, height: 1360 }} /> : <Photo />}</span>
      {o.noLogo ? null : <span className="ed-post-logo"><GatorMark size={120} /></span>}
      <span className="ed-gdate ed-post-date"><b>SO</b><strong>14/3</strong></span>
      <p className="ed-gtitle ed-post-title">{p.t[0]}<br />{o.mark ? <mark>{p.t[1]}</mark> : p.t[1]}{o.caret ? <i className="ed-caret ed-caret--g" /> : null}</p>
      <p className="ed-post-sub"><Czech t={p.s} show={o.ties} /></p>
      {o.btn === "none" ? null : <span className="ed-gbtn ed-post-btn" data-white={o.btnWhite ? "true" : undefined}>{o.btnText ?? p.b}</span>}
    </div>
  );
}

/** Alligators Story 9:16 — photo on top, title, the button centred (pinned to the bottom). */
function Story({ v = "zapis", o = {} }: { v?: PostV; o?: GO }) {
  const p = POSTS[v];
  return (
    <div className={`ed-g ed-story ${FIXED}`} data-theme="light">
      <span className="ed-story-photo"><Photo v={v === "trener" ? 3 : v === "cisla" ? 1 : 0} /></span>
      <span className="ed-story-logo"><GatorMark size={120} /></span>
      <span className="ed-gdate ed-story-date"><b>SO</b><strong>14/3</strong></span>
      <p className="ed-gtitle ed-story-title">{p.t[0]}<br />{p.t[1]}</p>
      <p className="ed-story-sub"><Czech t={p.s} /></p>
      {o.btn === "none" ? null : o.btn === "ghost" ? <span className="ed-gbtn ed-story-btn ed-gbtn--ghost">ZAPIŠ SE</span> : <span className="ed-gbtn ed-story-btn" data-white={o.btnWhite ? "true" : undefined}>{o.btnText ?? p.b}</span>}
    </div>
  );
}

/** Alligators club web — Domů · Desktop, 1440 × 6000 (a long page, sections stacked). */
const CLUB_SECTIONS: [string, number, number][] = [["Úvod", 0, 900], ["Zápasy", 900, 1000], ["Tým", 1900, 1200], ["Combine 2026", 3100, 700], ["Novinky", 3800, 1000], ["Partneři", 4800, 700], ["Patička", 5500, 500]];
function ClubPage() {
  return (
    <div className={`ed-g ed-club ${FIXED}`} data-theme="light">
      <section className="ed-club-hero"><span className="ed-club-nav"><GatorMark size={64} /><i /><i /><i /><em>ZAPIŠ SE</em></span><strong>STAŇ SE GATOREM</strong><span>Americký fotbal v Brně od roku 2002.</span><Photo v={2} style={{ left: 760, top: 160, width: 600, height: 640, borderRadius: 24 }} /></section>
      <section className="ed-club-sec ed-club-matches"><h3>Rozpis zápasů</h3>{["So 21. 3. · Alligators – Hippos", "So 4. 4. · Bulldogs – Alligators", "So 18. 4. · Alligators – Black Panthers", "So 2. 5. · Steelers – Alligators", "So 16. 5. · Alligators – Lions"].map((m) => <span key={m}>{m}</span>)}</section>
      <section className="ed-club-sec ed-club-team"><h3>Tým</h3><div>{[27, 11, 4, 88, 52, 7, 33, 21, 64, 9, 15, 72].map((n, i) => <span key={n}><Photo v={i % 6} num={n} /><b>#{n}</b></span>)}</div></section>
      <section className="ed-club-combine"><strong>COMBINE 2026</strong><span>So 14. 3. · Kraví hora</span><em>ZAPIŠ SE</em></section>
      <section className="ed-club-sec ed-club-news"><h3>Novinky</h3><div><i /><i /><i /></div></section>
      <section className="ed-club-sec ed-club-partners"><h3>Partneři</h3><div>{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div></section>
      <section className="ed-club-foot"><GatorMark size={80} /><span>Brno Alligators · Kraví hora 2, Brno</span></section>
    </div>
  );
}

/* ═══ On-canvas chrome: selection, handles, guides, chips, pointers ═══════════════════════════ */

type Tone = "you" | "thin" | "parent" | "hover" | "tereza" | "ai" | "focus" | "edit" | "ghost" | "crop";
const HANDLES8 = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLES4 = ["nw", "ne", "se", "sw"];
/** A selection-type outline in canvas px. handles: 0 | 4 | 8. tag = the small pill (below unless tagTop). */
function Sel({ s, tone = "you", handles = 4, tag, tagTop = false, tagRight = false, tagIcon, children }: { s: CSSProperties; tone?: Tone; handles?: 0 | 4 | 8; tag?: ReactNode; tagTop?: boolean; tagRight?: boolean; tagIcon?: string; children?: ReactNode }) {
  const hs = handles === 8 ? HANDLES8 : handles === 4 ? HANDLES4 : [];
  return (
    <span className={`ed-sel ed-sel--${tone}`} style={s}>
      {hs.map((h) => <i key={h} className={`ed-h ed-h--${h}`} />)}
      {tag ? <span className={`ed-sel-tag ed-sel-tag--${tone}${tagTop ? " ed-sel-tag--top" : ""}${tagRight ? " ed-sel-tag--right" : ""}`}>{tagIcon ? (tagIcon === "spark" ? <Spark size={10} color="var(--spark-fg)" /> : <Icon name={tagIcon} size={11} />) : null}{tag}</span> : null}
      {children}
    </span>
  );
}
/** The four edge-midpoint handles a selected kit Artboard lacks (it draws the corners) → eight handles. */
function Mids({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const at: [number, number][] = [[x + w / 2 - 4, y - 5], [x + w - 3, y + h / 2 - 4], [x + w / 2 - 4, y + h - 3], [x - 5, y + h / 2 - 4]];
  return <>{at.map(([l, t], i) => <i key={i} className="ed-mid" style={{ left: l, top: t }} />)}</>;
}
/** A smart-guide line (guide colour). */
function GLine({ x, y, len, v = false, soft = false }: { x: number; y: number; len: number; v?: boolean; soft?: boolean }) {
  return <span className={`ed-gl${soft ? " ed-gl--soft" : ""}`} style={v ? { left: x, top: y, height: len } : { left: x, top: y, width: len }} />;
}
/** A measured span: line with end ticks + its number chip in the middle. */
function Gap({ x, y, len, v = false, label, soft = false }: { x: number; y: number; len: number; v?: boolean; label: ReactNode; soft?: boolean }) {
  return (
    <span className={`ed-gap${v ? " ed-gap--v" : ""}${soft ? " ed-gap--soft" : ""}`} style={v ? { left: x, top: y, height: len } : { left: x, top: y, width: len }}>
      <span className="ed-chip">{label}</span>
    </span>
  );
}
/** A padding / gap band — tinted in the guide colour. */
function Band({ s, label, hot = false }: { s: CSSProperties; label?: ReactNode; hot?: boolean }) {
  return <span className={`ed-band${hot ? " ed-band--hot" : ""}`} style={s}>{label ? <span className="ed-chip">{label}</span> : null}</span>;
}
/** The token ruler over a gap being dragged — the system's space stops, the one it snaps to lit (the same gesture as
 *  the artboard preset ruler in ed-ab-resize). Stops are evenly spaced; the lit one sits over the pointer at x. */
function TokRuler({ x, y, stops, on, step = 40 }: { x: number; y: number; stops: string[]; on: string; step?: number }) {
  const at = stops.indexOf(on);
  return (
    <span className="ed-ruler ed-tokruler" style={{ left: x - at * step - 16, top: y, width: (stops.length - 1) * step + 32 }}>
      {stops.map((l, i) => (
        <span key={l} className="ed-ruler-t" data-on={l === on ? "true" : undefined} style={{ left: 16 + i * step }}><span>{l}</span></span>
      ))}
    </span>
  );
}
/** A floating chip in canvas px. */
function Chip({ x, y, children, tone = "guide" }: { x: number; y: number; children: ReactNode; tone?: "guide" | "accent" | "dark" | "quiet" }) {
  return <span className={`ed-chip ed-chip--${tone} ed-chip--abs`} style={{ left: x, top: y }}>{children}</span>;
}
/** Your own pointer — never labelled. kind ew / ns = a resize cursor centred on (x, y). */
function Ptr({ x, y, kind = "arrow" }: { x: number; y: number; kind?: "arrow" | "ew" | "ns" }) {
  if (kind !== "arrow") {
    const d = kind === "ew" ? "M2 8h12M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5" : "M8 2v12M5.5 4.5L8 2l2.5 2.5M5.5 11.5L8 14l2.5-2.5";
    return (
      <span className="ed-ptr" style={{ left: x - 10, top: y - 10 }}>
        <svg className="k-ic" width="20" height="20" viewBox="0 0 16 16" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={d} stroke="var(--bg-2)" strokeWidth="3.5" /><path d={d} stroke="var(--fg-0)" strokeWidth="1.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="ed-ptr" style={{ left: x, top: y }}>
      <svg className="k-ic" width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--bg-2)" stroke="var(--fg-0)" strokeWidth="1" strokeLinejoin="round" /></svg>
    </span>
  );
}
/** The live readout next to the pointer (size while resizing, position while moving). */
function Bubble({ x, y, children, tone = "dark" }: { x: number; y: number; children: ReactNode; tone?: "dark" | "accent" }) {
  return <span className={`ed-bubble ed-bubble--${tone}`} style={{ left: x, top: y }}>{children}</span>;
}
/** A quiet hint pill with keys. */
function Hint({ x, y, children, style }: { x?: number; y?: number; children: ReactNode; style?: CSSProperties }) {
  return <span className={`ed-hint${x !== undefined ? " ed-hint--abs" : ""}`} style={x !== undefined ? { left: x, top: y, ...style } : style}>{children}</span>;
}

/* ═══ Inspector pieces ═════════════════════════════════════════════════════════════════════════ */

function Crumbs({ path }: { path: string[] }) {
  return (
    <div className="ed-crumbs">
      {path.map((p, i) => (
        <Fragment key={p + i}>
          {i ? <span className="ed-crumbs-ch"><Icon name="submenu" size={10} /></span> : null}
          <span className="ed-crumb" data-last={i === path.length - 1 ? "true" : undefined}>{p}</span>
        </Fragment>
      ))}
      {path.length > 1 ? <span className="ed-crumbs-esc"><Kbd>esc</Kbd></span> : null}
    </div>
  );
}
function Insp({ title, kind, crumbs, uses, children, advCount, advOpen = false, adv, style, cls = "", free = false }: {
  title: ReactNode; kind?: string; crumbs?: string[]; uses?: string; children?: ReactNode; advCount?: string; advOpen?: boolean; adv?: ReactNode; style?: CSSProperties; cls?: string;
  /** static (in a close-up), not pinned to the window's right edge */ free?: boolean;
}) {
  return (
    <div className={`island island--pad k-insp ed-insp${free ? " ed-insp--free" : ""} ${cls}`} style={style}>
      {crumbs ? <Crumbs path={crumbs} /> : null}
      <div className="k-insp-hd"><strong>{title}</strong>{kind ? <span className="chip">{kind}</span> : null}</div>
      {uses ? <Uses name={uses} /> : null}
      {children}
      {advCount !== undefined ? (
        <div className="k-adv" data-open={advOpen ? "true" : undefined}>
          <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{advCount}</span></span>
          {advOpen && adv ? <div className="k-adv-body">{adv}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
function Sec({ t, aside, n, children }: { t: string; aside?: ReactNode; n?: number; children?: ReactNode }) {
  return (
    <div className="ed-sec">
      <p className="ed-sec-t"><span>{t}</span>{aside ? <span className="ed-sec-a">{aside}</span> : null}{n !== undefined ? <Callout n={n} outline /> : null}</p>
      {children}
    </div>
  );
}
/** dim = disabled (nothing to do here) · view = read-only while someone else edits (values stay readable, the field
 *  chrome goes quiet). */
function Row({ k, mod = false, children, dim = false, view = false }: { k: string; mod?: boolean; children?: ReactNode; dim?: boolean; view?: boolean }) {
  return (
    <div className={`k-insp-row ed-row${dim ? " ed-row--dim" : ""}${view ? " ed-row--view" : ""}`}>
      <span className="ed-row-k">{k}{mod ? <i className="ed-mod" title="Changed here" /> : null}</span>
      <span className="ed-row-v">{children}</span>
    </div>
  );
}
/** A number field: small label + value. */
function N({ l, v, w = 64, focus = false, mod = false }: { l?: ReactNode; v: ReactNode; w?: number; focus?: boolean; mod?: boolean }) {
  return <span className={`ed-n${focus ? " ed-n--focus" : ""}${mod ? " ed-n--mod" : ""}`} style={{ width: w }}>{l !== undefined ? <b>{l}</b> : null}<span>{v}</span></span>;
}
/** A value bound to a design-system token ("L · 24"). raw = a plain number with Bind. */
function Tok({ n, v, focus = false, raw = false, sw }: { n?: string; v: ReactNode; focus?: boolean; raw?: boolean; sw?: string }) {
  if (raw) return <span className="ed-tok ed-tok--raw"><span>{v}</span><em>Bind</em></span>;
  return (
    <span className={`ed-tok${focus ? " ed-tok--focus" : ""}`}>
      {sw ? <i className={`ed-tok-sw ed-tok-sw--${sw}`} /> : <G n="token" size={11} />}
      <b>{n}</b><span>{v}</span>
    </span>
  );
}
/** Sizing word (Hug · Fill · Fixed) as a small select. */
function Sz({ v }: { v: "Hug" | "Fill" | "Fixed" }) {
  return <span className="ed-sz"><G n={v === "Hug" ? "dir-free" : v === "Fill" ? "dist-h" : "minus"} size={12} />{v}<Icon name="chevron" size={10} /></span>;
}
/** An icon segmented control. */
function ISeg({ icons, on, off = [] }: { icons: string[]; on?: string; off?: string[] }) {
  return (
    <span className="seg ed-iseg">
      {icons.map((n) => <span key={n} className="k-seg-b" aria-pressed={n === on} data-off={off.includes(n) ? "true" : undefined}><G n={n} size={14} /></span>)}
    </span>
  );
}
/** The 3 × 3 alignment pad (where the content sits inside the frame). */
function AlignPad({ at = 4 }: { at?: number }) {
  return <span className="ed-ag">{Array.from({ length: 9 }, (_, i) => <i key={i} data-on={i === at ? "true" : undefined} />)}</span>;
}
/** Constraints: which edges this object keeps when its frame changes size. */
function Cons({ t = true, r = true, b = false, l = false }: { t?: boolean; r?: boolean; b?: boolean; l?: boolean }) {
  return (
    <span className="ed-cons">
      <i className="ed-cons-in" />
      <i className="ed-cons-p ed-cons-p--t" data-on={t ? "true" : undefined} />
      <i className="ed-cons-p ed-cons-p--r" data-on={r ? "true" : undefined} />
      <i className="ed-cons-p ed-cons-p--b" data-on={b ? "true" : undefined} />
      <i className="ed-cons-p ed-cons-p--l" data-on={l ? "true" : undefined} />
    </span>
  );
}
function Uses({ name }: { name: string }) {
  return <span className="ed-uses"><span className="ed-uses-ic"><Icon name="system" size={12} /></span><span className="ed-uses-t">Uses {name}</span><Icon name="submenu" size={12} /></span>;
}
/** A one-line status inside the inspector — what is true, at most one action. */
function Line({ tone = "quiet", icon, who, children, action }: { tone?: "quiet" | "ok" | "ai" | "people" | "warn"; icon?: string; who?: string; children: ReactNode; action?: string }) {
  return (
    <div className={`ed-line ed-line--${tone}`}>
      {who ? <Avatar who={who} size="sm" /> : icon ? <span className="ed-line-ic">{icon === "spark" ? <Spark size={12} /> : <G n={icon} size={14} />}</span> : null}
      <span className="ed-line-t">{children}</span>
      {action ? <span className="btn btn--ghost btn--sm ed-line-act">{action}</span> : null}
    </div>
  );
}
function Css({ k, v }: { k: string; v: string }) {
  return <div className="k-css"><span className="k-mono k-css-k">{k}</span><span className="k-mono k-css-v">{v}</span></div>;
}

/* ═══ Close-ups ═══════════════════════════════════════════════════════════════════════════════ */

/** A close-up artboard: V2 scope, a body for panes, the note strip at the foot (80 px). */
function Close({ theme = "light", note, children }: { theme?: "light" | "dark"; note: ReactNode; children: ReactNode }) {
  return (
    <V2 theme={theme} className="ed-close">
      <div className="ed-close-body">{children}</div>
      <div className="ed-close-note">{note}</div>
    </V2>
  );
}
/** One framed piece of canvas inside a close-up, with its small title. */
function Pane({ x, y, w, h, title, children, plain = false }: { x: number; y: number; w: number; h: number; title?: ReactNode; children?: ReactNode; plain?: boolean }) {
  return (
    <div className="ed-pane" style={{ left: x, top: y, width: w, height: h }}>
      {title ? <p className="ed-pane-t">{title}</p> : null}
      <div className={`ed-pane-c${plain ? " ed-pane-c--plain" : ""}`}>{children}</div>
    </div>
  );
}

/* ═══ Panels with real content ═══════════════════════════════════════════════════════════════ */

const lay = (name: string, icon: string, depth = 0, more: Partial<LayerRow> = {}): LayerRow => ({ name, icon, depth, ...more });
function homeLayers(sel: string[] = [], o: { hidden?: string[]; locked?: string[] } = {}): LayerRow[] {
  const L = (n: string, i: string, d = 0) => lay(n, i, d, { selected: sel.includes(n), hidden: o.hidden?.includes(n), locked: o.locked?.includes(n) });
  return [L("Nav", "frame"), L("Hero", "frame"), L("Headline", "text", 1), L("Sub", "text", 1), L("Buttons", "frame", 1), L("Picture", "image", 1), L("What we do", "text"), L("Services", "frame"), L("Product design", "frame", 1), L("Brand systems", "frame", 1), L("Small apps", "frame", 1), L("Selected work", "frame"), L("Footer", "frame")];
}
function postLayers(sel: string[] = [], locked: string[] = ["Logo"], hidden: string[] = []): LayerRow[] {
  const L = (n: string, i: string) => lay(n, i, 0, { selected: sel.includes(n), locked: locked.includes(n), hidden: hidden.includes(n) });
  return [L("Datum", "frame"), L("ZAPIŠ SE", "component"), L("Podtitulek", "text"), L("Titulek", "text"), L("Logo", "image"), L("Hráč · foto", "image"), L("Pozadí", "shape")];
}

/** The multi-selection bar: count · align · distribute · Tidy up. */
function AlignBar({ count, hl, style, tidy = true }: { count: string; hl?: string; style?: CSSProperties; tidy?: boolean }) {
  const b = (n: string) => <span key={n} className="icon-btn ed-bar-b" data-hl={hl === n ? "true" : undefined}><G n={n} size={16} /></span>;
  return (
    <div className="island ed-bar" style={style}>
      <span className="ed-bar-n">{count}</span>
      <span className="divider-v" />
      {["al-left", "al-hc", "al-right", "al-top", "al-vm", "al-bottom"].map(b)}
      <span className="divider-v" />
      {["dist-h", "dist-v"].map(b)}
      {tidy ? (<><span className="divider-v" /><span className="btn btn--sm ed-bar-tidy" data-hl={hl === "tidy" ? "true" : undefined}><G n="tidy" size={14} />Tidy up</span></>) : null}
    </div>
  );
}

const GATOR_PHOTOS: [number, string][] = [[0, "combine-2025-sprint.jpg"], [1, "kravi-hora-tym.jpg"], [2, "helma-detail.jpg"], [3, "trener-pistalka.jpg"], [4, "zapas-u19.jpg"], [5, "fanousci-tribuna.jpg"]];
function GatorAssets({ placed = 0 }: { placed?: number }) {
  return (
    <>
      <span className="k-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Search assets</span></span>
      <p className="island-title k-cp-t">Photos<span className="k-cp-tc">120</span></p>
      <div className="ed-assets">
        {GATOR_PHOTOS.map(([v, name]) => (
          <span key={name} className="ed-asset" data-placed={v === placed ? "true" : undefined}>
            <span className={`ed-asset-pic ${FIXED}`} data-theme="light"><Photo v={v} /></span>
            <span className="ed-asset-n">{name}</span>
            {v === placed ? <span className="ed-asset-on"><Icon name="check" size={10} /></span> : null}
          </span>
        ))}
      </div>
      <span className="row-item k-mi ed-asset-mac"><span className="k-mi-ic"><Icon name="folder" size={14} /></span><span className="k-mi-lab">From this Mac…</span></span>
    </>
  );
}

/** ⇧I — the component picker, grouped like the Design system canvas (Brand · Components · Patterns). */
function ComponentPicker({ style }: { style?: CSSProperties }) {
  const row = (l: string, note?: string, hl = false) => (
    <span key={l} className="row-item k-mi" data-hl={hl ? "true" : undefined}><span className="k-mi-ic"><Icon name="component" size={14} /></span><span className="k-mi-lab">{l}</span>{note ? <span className="k-mi-note">{note}</span> : null}</span>
  );
  return (
    <div className="k-menu ed-cpick" style={style}>
      <span className="k-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Search components</span></span>
      <p className="ed-cpick-sys"><Icon name="system" size={12} />{GATOR_SYS}</p>
      <span className="k-mgroup">Brand</span>
      {row("Logo", "2 variants")}
      {row("Signs", "12 glyphs")}
      <span className="k-mgroup">Components</span>
      {row("Tlačítko", "2 variants", true)}
      <span className={`ed-cpick-v ${FIXED}`} data-theme="light">
        <span className="ed-gbtn ed-gbtn--chip" aria-current="true">Plné</span>
        <span className="ed-gbtn ed-gbtn--chip ed-gbtn--line">Obrys</span>
      </span>
      {row("Štítek", "2 variants")}
      {row("Výsledek", "2 variants")}
      {row("Zápas")}
      {row("Pole formuláře")}
      {row("Karta hráče")}
      <span className="k-mgroup">Patterns</span>
      {row("Klubový web — hero")}
      {row("Leták A5")}
      {row("Matchday post")}
      {row("Story 9:16")}
      <span className="k-msep" />
      <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="system" size={14} /></span><span className="k-mi-lab">Open Design system</span></span>
    </div>
  );
}

/* ═══ The reorder filmstrip (signature) ═══════════════════════════════════════════════════════ */

/** --ease-out (0.25, 0.8, 0.25, 1) progress at time fraction x. */
function easeOut(x: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const s = (lo + hi) / 2;
    const xs = 0.75 * s * (1 - s) * (1 - s) + 0.75 * s * s * (1 - s) + s * s * s;
    if (xs < x) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return 2.4 * s * (1 - s) * (1 - s) + 3 * s * s * (1 - s) + s * s * s;
}
function FilmFrame({ t }: { t: number }) {
  const p = easeOut(Math.min(1, t / 220));
  const step = 50;
  const x = (slot: number) => 8 + slot * step;
  return (
    <div className={`ed-film-f ${FIXED}`} data-theme="light">
      <div className="ed-film-row">
        <span className="ed-film-slot" style={{ left: x(2), opacity: 1 - p }} />
        <span className="ed-film-slot" style={{ left: x(0), opacity: p }} />
        <span className="ed-film-c ed-film-c--coral" style={{ left: x(0 + p) }} />
        <span className="ed-film-c ed-film-c--green" style={{ left: x(1 + p) }} />
      </div>
      <span className="ed-film-c ed-film-c--lilac ed-film-lift" />
      <span className="ed-film-t">{t} ms</span>
    </div>
  );
}

/** ed-inspector — the top of each numbered section in the inspector (artboard px), so each explainer sits level with it. */
const EXPLAIN_TOPS = [133, 322, 452, 657, 723, 789, 855, 953, 1083, 1235, 1335];

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════════ */

export default function Editing() {
  /* ── shared placements ── */
  const A1: AB = { x: 150, y: 112, k: 0.38 }; // Homepage at 38 %
  const A1w = 1440 * A1.k;
  const A1h = HOME_H * A1.k;
  const A2w = 1280 * A1.k;
  const AO: AB = { x: 290, y: 70, k: 0.6 }; // Homepage at 60 % (objects)
  const AP: AB = { x: 330, y: 100, k: 0.6 }; // Post at 60 %
  const AL: AB = { x: 230, y: 111, k: 0.66 }; // Homepage at 66 % (layout)
  const AT: AB = { x: 290, y: 96, k: 0.62 }; // Post at 62 % (text, shape)
  const AI_: AB = { x: 330, y: 110, k: 0.56 }; // Post at 56 % (image)
  const AS: AB = { x: 420, y: 96, k: 0.36 }; // Story at 36 % (components)
  const AE: AB = { x: 296, y: 56, k: 0.44 };
  const AU: AB = { x: 470, y: 56, k: 0.44 }; // undo: clear of the history list // Homepage at 48 % (edge cases)
  const ARR = [140, 395.2, 650.4, 905.6]; // Combine posts at 22 %
  const PS = 1080 * 0.22;
  const TIDY: [number, number][] = [[150, 196], [396, 204], [640, 164], [900, 222]];
  const TS = { w: 1080 * 0.2, h: 1920 * 0.2 };

  /* ── reorder close-up placement (pane-local) ── */
  const RZ: AB = { x: 40, y: -348, k: 0.9 };

  return (
    <DesignCanvas>
      {/* ── 1 · Artboards ────────────────────────────────────────────────────────────────── */}
      <DCSection id="artboards" title="Artboards — select, size, arrange" subtitle="Studio site Homepage and Alligators Combine-kampan · eight handles, preset snapping, Fits content vs Fixed, smart guides, tidy up, the artboard menu (annotations live in 15 Annotations)">
        <DCArtboard id="ed-ab-select" label="1 · Select an artboard" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Click an artboard's name or edge to select it.">The name turns azure with its size, eight handles appear, and the inspector shows the artboard: preset, size, height, clip, fill, layout, export.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={A1.x} y={A1.y} w={A1w} h={A1h} selected size="1440 × 1573">
                  <Scaled k={A1.k} w={1440} h={HOME_H}><SiteHome /></Scaled>
                </Artboard>
                <Mids x={A1.x} y={A1.y} w={A1w} h={A1h} />
                <Artboard label="Tablet" kind="web" x={741} y={112} w={317} h={454}><HeroMock /></Artboard>
                <Artboard label="Mobile" kind="web" x={1100} y={112} w={148} h={321}><PhoneMock title="Calm software" tone="sky" /></Artboard>
                <Ptr x={A1.x + A1w + 1} y={A1.y + A1h / 2} kind="ew" />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Desktop" kind="Web page" advCount="6 properties">
                <Sec t="Artboard">
                  <Row k="Preset"><InSelect value="Desktop · 1440" /></Row>
                  <Row k="Size"><N l="W" v="1440" /><N l="H" v="1573" /></Row>
                  <Row k="Height"><InSeg options={["Fits content", "Fixed"]} value="Fits content" /></Row>
                  <Row k="Clip content"><InSwitch on /></Row>
                </Sec>
                <Sec t="Fill"><Row k="Background"><InFill name="Page" /></Row></Sec>
                <Sec t="Layout"><Row k="Content"><InSelect value="Top to bottom" /></Row></Sec>
                <Sec t="Export" aside={<G n="plus" size={12} />}><Row k="PNG"><InSelect value="2×" /></Row></Sec>
                <Row k="Other widths"><InButton icon="duplicate">Add a width</InButton></Row>
              </Insp>
              <ZoomUndo zoom={38} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-ab-resize" label="2 · Resize — snaps to presets" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Drag an edge; it clicks onto the next preset.">Laptop 1280 lights up on the ruler and the size reads next to the pointer. The page reflows while you drag; its height still fits the content.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <span className="ed-ghost" style={{ left: A1.x, top: A1.y, width: A1w, height: A1h }} />
                <Artboard label="Desktop" kind="web" x={A1.x} y={A1.y} w={A2w} h={A1h} selected size="1280 × 1573">
                  <Scaled k={A1.k} w={1280} h={HOME_H}><SiteHome o={{ w: 1280 }} /></Scaled>
                </Artboard>
                <Mids x={A1.x} y={A1.y} w={A2w} h={A1h} />
                <span className="ed-ruler" style={{ left: A1.x, top: A1.y - 52, width: A1w + 24 }}>
                  {([[834, "Tablet"], [1280, "Laptop"], [1440, "Desktop"]] as [number, string][]).map(([p, n]) => (
                    <span key={p} className="ed-ruler-t" data-on={p === 1280 ? "true" : undefined} data-at={p === 1280 ? "end" : p === 1440 ? "start" : undefined} style={{ left: p * A1.k }}><span>{n} {p}</span></span>
                  ))}
                </span>
                <GLine x={A1.x + A2w} y={A1.y - 30} len={A1h + 30} v />
                <Artboard label="Tablet" kind="web" x={741} y={112} w={317} h={454}><HeroMock /></Artboard>
                <Artboard label="Mobile" kind="web" x={1100} y={112} w={148} h={321}><PhoneMock title="Calm software" tone="sky" /></Artboard>
                <Ptr x={A1.x + A2w} y={A1.y + A1h / 2} kind="ew" />
                <Bubble x={A1.x + A2w + 16} y={A1.y + A1h / 2 + 12} tone="accent">Laptop · 1280 × 1573</Bubble>
                <Hint x={A1.x + A2w + 16} y={A1.y + A1h / 2 + 44}><Kbd>⌘</Kbd> ignores presets · <Kbd>⌥</Kbd> from the centre</Hint>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Desktop" kind="Web page" advCount="6 properties">
                <Sec t="Artboard">
                  <Row k="Preset"><span className="ed-focus"><InSelect value="Laptop · 1280" /></span></Row>
                  <Row k="Size"><N l="W" v="1280" focus /><N l="H" v="1573" /></Row>
                  <Row k="Height"><InSeg options={["Fits content", "Fixed"]} value="Fits content" /></Row>
                  <Line icon="dir-col">Drag the bottom edge to fix the height at a number.</Line>
                  <Row k="Clip content"><InSwitch on /></Row>
                </Sec>
                <Sec t="Fill"><Row k="Background"><InFill name="Page" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={38} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-ab-arrange" label="3 · Move one — smart guides and equal gaps" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Drag Trenéři into the row.">Its top edge snaps to the others and three magenta chips say every gap is now 80. The position reads next to the pointer; the guides go when you let go.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {(["combine", "zapis", "cisla"] as PostV[]).map((v, i) => (
                  <Artboard key={v} label={["Post 1:1 · Combine 2026", "Post 1:1 · Zapiš se", "Post 1:1 · Combine v číslech"][i]} kind="digital" x={ARR[i]} y={150} w={PS} h={PS}>
                    <Scaled k={0.22} w={1080} h={1080}><Post v={v} /></Scaled>
                  </Artboard>
                ))}
                <Artboard label="Post 1:1 · Trenéři" kind="digital" x={ARR[3]} y={150} w={PS} h={PS} selected size="1080 × 1080" style={{ boxShadow: "var(--shadow-lg)" }}>
                  <Scaled k={0.22} w={1080} h={1080}><Post v="trener" /></Scaled>
                </Artboard>
                {(["zapis", "odpocet"] as PostV[]).map((v, i) => (
                  <Artboard key={v} label={["Story 9:16 · Zapiš se", "Story 9:16 · Odpočet 7 dní"][i]} kind="digital" x={ARR[i]} y={414} w={PS} h={1920 * 0.22}>
                    <Scaled k={0.22} w={1080} h={1920}><Story v={v} /></Scaled>
                  </Artboard>
                ))}
                <GLine x={ARR[0]} y={150} len={ARR[3] + PS - ARR[0]} />
                <GLine x={ARR[0]} y={150 + PS} len={ARR[3] + PS - ARR[0]} soft />
                {[0, 1, 2].map((i) => <Gap key={i} x={ARR[i] + PS} y={150 + PS / 2} len={ARR[i + 1] - ARR[i] - PS} label="80" />)}
                <Ptr x={1010} y={300} />
                <Bubble x={1030} y={322}>X 3480 · Y 0</Bubble>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Post 1:1 · Trenéři" kind="Fixed size" advCount="5 properties">
                <Sec t="Artboard">
                  <Row k="Preset"><InSelect value="Post 1:1 · 1080" /></Row>
                  <Row k="Position"><N l="X" v="3480" focus /><N l="Y" v="0" focus /></Row>
                  <Row k="Size"><N l="W" v="1080" /><N l="H" v="1080" /></Row>
                </Sec>
                <Sec t="Fill"><Row k="Background"><Tok n="Klubová zelená" v="100 %" sw="ggreen" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={22} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-ab-tidy" label="4 · Several at once — align, distribute, tidy up" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Drag a box around four stories, or ⇧-click them.">A bar appears over the selection: align, distribute, and Tidy up — dashed outlines preview one even row (on the lowest one's line) before you press it.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {TIDY.map((_, i) => <span key={"g" + i} className="ed-ghost ed-ghost--accent" style={{ left: 150 + i * 240, top: 222, width: TS.w, height: TS.h }} />)}
                {(["zapis", "odpocet", "trener", "cisla"] as PostV[]).map((v, i) => (
                  <Artboard key={v} label={["Story · Zapiš se", "Story · Odpočet 7 dní", "Story · Trenéři", "Story · Combine v číslech"][i]} kind="digital" x={TIDY[i][0]} y={TIDY[i][1]} w={TS.w} h={TS.h}>
                    <Scaled k={0.2} w={1080} h={1920}><Story v={v} /></Scaled>
                  </Artboard>
                ))}
                {TIDY.map(([x, y], i) => <Sel key={"s" + i} s={{ left: x, top: y, width: TS.w, height: TS.h }} tone="thin" handles={0} />)}
                <Sel s={{ left: 150, top: 164, width: 900 + TS.w - 150, height: 222 + TS.h - 164 }} tone="parent" handles={8} />
                <AlignBar count="4 artboards" hl="tidy" style={{ left: 410, top: 96 }} />
                <Tooltip text="One row, even gaps" x={792} y={62} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="4 artboards" kind="Fixed size" advCount="Mixed">
                <Sec t="Artboards">
                  <Row k="Preset"><InSelect value="Story 9:16 · 1080" /></Row>
                  <Row k="Size"><N l="W" v="1080" /><N l="H" v="1920" /></Row>
                  <Row k="Position"><N l="X" v="Mixed" /><N l="Y" v="Mixed" /></Row>
                </Sec>
                <Sec t="Fill"><Row k="Background"><span className="ed-mixed"><i className="k-fill-sw k-fill-sw--green" /><i className="k-fill-sw k-fill-sw--ink" />Mixed</span></Row></Sec>
                <Sec t="Export"><Row k="PNG"><InSelect value="4 files · 2×" /></Row></Sec>
                <Line>Changes go to all 4.</Line>
              </Insp>
              <ZoomUndo zoom={20} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-ab-menu" label="5 · Right-click, ⌘D, rename in place" width={W} height={724} fixed>
          <Close note={<Note n={5} title="The artboard's own menu, a copy, a new name.">Right-click gives the settled set; Duplicate at another width reflows a copy. ⌘D lands the copy at the same gap. Double-click the name to type a new one — the field grows to the whole name.</Note>}>
            <Pane x={32} y={24} w={760} h={572} title="Right-click an artboard">
              <Artboard label="Desktop" kind="web" x={36} y={70} w={288} h={315} selected size="1440 × 1573"><Scaled k={0.2} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
              <Mids x={36} y={70} w={288} h={315} />
              <Ptr x={300} y={150} />
              <Menu width={268} style={{ left: 312, top: 158 }} items={[
                { label: "Ask AI about “Desktop”", icon: "spark", keys: "⌘/" },
                "sep",
                { label: "Duplicate", icon: "duplicate", keys: "⌘D" },
                { label: "Duplicate at another width", icon: "web", sub: true, highlight: true },
                { label: "Rename", icon: "edit" },
                "sep",
                { label: "Copy", keys: "⌘C" },
                { label: "Paste", keys: "⌘V" },
                "sep",
                { label: "Export…", icon: "export", keys: "⇧⌘E" },
                "sep",
                { label: "Move to trash", icon: "trash", keys: "⌫" },
              ] as MenuItem[]} />
              <Menu width={160} style={{ left: 584, top: 226 }} items={[
                { label: "Laptop", note: "1280" },
                { label: "Tablet", note: "834" },
                { label: "Mobile", note: "390", highlight: true },
                "sep",
                { label: "Custom width…" },
              ] as MenuItem[]} />
            </Pane>
            <Pane x={808} y={24} w={300} h={572} title="⌘D — a copy at the same gap">
              <Artboard label="Desktop" kind="web" x={22} y={70} w={120} h={131}><Scaled k={120 / 1440} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
              <Artboard label="Desktop 2" kind="web" x={158} y={70} w={120} h={131} selected size="1440"><Scaled k={120 / 1440} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
              <Gap x={142} y={135} len={16} label="120" />
              <div className="ed-pane-copy">
                <p><Kbd>⌘D</Kbd> Duplicate</p>
                <p>The copy lands to the right at the gap the row already uses, selected — press again to keep the rhythm.</p>
                <p><Kbd>⌥</Kbd> + drag duplicates too.</p>
              </div>
            </Pane>
            <Pane x={1124} y={24} w={284} h={572} title="Double-click the name">
              <Artboard label=" " kind="digital" x={34} y={84} w={216} h={216}><Scaled k={0.2} w={1080} h={1080}><Post v="cisla" /></Scaled></Artboard>
              <span className="ed-field" style={{ left: 30, top: 52, width: 236 }}><Icon name="digital" size={11} /><span>Post 1:1 · Combine v číslech — <mark>finále</mark></span><i className="ed-caret ed-caret--ui" /></span>
              <div className="ed-pane-copy" style={{ top: 322 }}>
                <p><Kbd>↵</Kbd> saves · <Kbd>esc</Kbd> cancels</p>
                <p><Kbd>tab</Kbd> moves to the next artboard's name — rename a whole row without the mouse.</p>
                <p>Long Czech names keep every háček; the label truncates on the canvas, never in the field.</p>
              </div>
            </Pane>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Objects ──────────────────────────────────────────────────────────────────── */}
      <DCSection id="objects" title="Objects inside an artboard" subtitle="Click selects the top object; double-click goes inside, esc steps out; ⇧-click adds; the Layers tab follows every selection">
        <DCArtboard id="ed-obj-enter" label="6 · Double-click goes inside a frame" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="Double-click Services, then Brand systems.">The frame you are inside shows a dashed outline; the inspector names the path. esc steps back out one level at a time. Layers shows the same selection.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AO.x} y={AO.y} w={1440 * AO.k} h={HOME_H * AO.k}><Scaled k={AO.k} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                <Sel s={box(AO, HR.svc, 3)} tone="parent" handles={0} />
                <Sel s={box(AO, card(1))} tone="you" handles={8} tag="Brand systems · 400 × 232" />
                <Sel s={box(AO, card(2))} tone="hover" handles={0} />
                <Ptr x={cx(AO, 1180)} y={cy(AO, 740)} />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <CanvasesPanel project="Studio site" tab="layers" selected="Desktop" layers={homeLayers(["Brand systems"])} />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Brand systems" kind="Frame" crumbs={["Desktop", "Services", "Brand systems"]} uses={STUDIO_SYS} advCount="7 properties">
                <Sec t="Position">
                  <Row k="In Services"><span className="ed-from">Set by Services · 2 of 3</span></Row>
                  <Row k="Place freely"><InSwitch on={false} /></Row>
                  <Line icon="dir-row">In auto layout, ← → move it earlier or later.</Line>
                </Sec>
                <Sec t="Size">
                  <Row k="Width"><N v="400" w={56} /><Sz v="Fill" /></Row>
                  <Row k="Height"><N v="232" w={56} /><Sz v="Hug" /></Row>
                </Sec>
                <Sec t="Layout">
                  <Row k="Direction"><ISeg icons={["dir-row", "dir-col", "dir-grid", "dir-free"]} on="dir-col" /></Row>
                  <Row k="Gap"><Tok n="Space" v="8" /></Row>
                  <Row k="Padding"><Tok n="Space" v="24" /></Row>
                </Sec>
                <Sec t="Fill"><Row k="Fill"><Tok n="Leaf" v="30 %" sw="green" /></Row></Sec>
                <Sec t="Corners"><Row k="All"><Tok n="L" v="14" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={60} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-obj-multi" label="7 · Multi-select — shared properties, align" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="⇧-click Titulek, Podtitulek and ZAPIŠ SE.">The inspector shows what they share and says Mixed where they differ — X reads Mixed because the button sits 6 px off. Align left fixes it.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={AP.x} y={AP.y} w={1080 * AP.k} h={1080 * AP.k}><Scaled k={AP.k} w={1080} h={1080}><div className="ed-off6"><Post v="combine" /></div></Scaled></Artboard>
                <Sel s={box(AP, PR.title)} tone="thin" handles={0} />
                <Sel s={box(AP, PR.sub)} tone="thin" handles={0} />
                <Sel s={box(AP, { ...PR.btn, x: 70 })} tone="thin" handles={0} />
                <Sel s={box(AP, { x: 64, y: 520, w: 900, h: 486 }, 4)} tone="you" handles={8} />
                <GLine x={cx(AP, 64)} y={cy(AP, 480)} len={560 * AP.k} v />
                <Chip x={cx(AP, 64) + 4} y={cy(AP, 1010)} tone="guide">X 64</Chip>
                <AlignBar count="3 objects" hl="al-left" tidy={false} style={{ left: cx(AP, 64) + 40, top: cy(AP, 520) - 64 }} />
                <Tooltip text="Align left" x={cx(AP, 64) + 177} y={cy(AP, 520) - 96} />
                <span className="ed-rot" style={{ left: cx(AP, 964) + 8, top: cy(AP, 1006) + 8 }}><G n="rotate" size={16} /></span>
                <Hint x={cx(AP, 1080) + 10} y={cy(AP, 1006) - 2}>Rotate · <Kbd>⇧</Kbd> 15°</Hint>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel project="Alligators brand" tab="layers" selected="Post 1:1 · Combine 2026" layers={postLayers(["Titulek", "Podtitulek", "ZAPIŠ SE"])} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="3 objects" kind="Mixed" advCount="Mixed">
                <Sec t="Position">
                  <Row k="X · Y"><N l="X" v="Mixed" focus /><N l="Y" v="Mixed" /></Row>
                  <Row k="Rotation"><N l={<G n="rotate" size={12} />} v="0°" /></Row>
                </Sec>
                <Sec t="Size"><Row k="Width"><N v="Mixed" w={72} /><Sz v="Fixed" /></Row></Sec>
                <Sec t="Fill">
                  <Row k="Fill"><span className="ed-mixed"><i className="k-fill-sw k-fill-sw--white" /><i className="k-fill-sw k-fill-sw--yellow" />Mixed</span></Row>
                  <Row k="Opacity"><N v="100 %" w={72} /></Row>
                </Sec>
                <Line>Changes go to all 3. Text settings show when only text is selected.</Line>
              </Insp>
              <ZoomUndo zoom={60} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-obj-order" label="8 · Nudge, frame, order, lock, hide" width={W} height={924} fixed>
          <Close note={<Note n={8} title="The small moves, all by hand or by key.">Arrows nudge, ⌥⌘G wraps a selection in a frame, the object menu orders, locks and hides. A locked object can't be picked — the click goes to its parent.</Note>}>
            <Pane x={32} y={24} w={470} h={388} title="Nudge — arrows move 1 px, with ⇧ 10 px">
              <span className={`ed-page ${FIXED}`} data-theme="light" style={{ left: 16, top: 72, width: 438, height: 132 }} />
              <div className={`ed-nudge ${FIXED}`} data-theme="light">
                <span className="ed-sh-btn ed-sh-btn--ink">See the work</span>
                <span className="ed-sh-btn ed-sh-btn--line ed-nudge-old">See pricing →</span>
                <span className="ed-sh-btn ed-sh-btn--line ed-nudge-new">See pricing →</span>
              </div>
              <Sel s={{ left: 242, top: 112, width: 184, height: 52 }} tone="you" handles={4} tag="Y 434" />
              <Gap x={334} y={102} len={10} v label="10" />
              <div className="ed-keyrow" style={{ top: 268 }}><span><Kbd>↓</Kbd> 1 px</span><span><Kbd>⇧</Kbd><Kbd>↓</Kbd> 10 px</span><span><Kbd>⌥</Kbd> shows distances</span></div>
            </Pane>
            <Pane x={32} y={428} w={470} h={388} title="Frame selection — ⌥⌘G">
              <span className={`ed-page ${FIXED}`} data-theme="light" style={{ left: 12, top: 40, width: 446, height: 172 }} />
              <div className={`ed-wrap ${FIXED}`} data-theme="light" style={{ left: 24, top: 70 }}>
                <b className="ed-sh-dot ed-wrap-dot" /><strong>Brand systems</strong><span>Logos, type and colour that hold up.</span>
              </div>
              <Sel s={{ left: 24, top: 70, width: 24, height: 24 }} tone="thin" handles={0} />
              <Sel s={{ left: 24, top: 104, width: 150, height: 26 }} tone="thin" handles={0} />
              <Sel s={{ left: 24, top: 138, width: 170, height: 40 }} tone="thin" handles={0} />
              <span className="ed-arrow" style={{ left: 206, top: 116 }}><Kbd>⌥⌘G</Kbd><Icon name="submenu" size={14} /></span>
              <span className="ed-arrow ed-arrow--or" style={{ left: 206, top: 146 }}>or <Kbd>⌘G</Kbd></span>
              <div className={`ed-wrap ed-wrap--framed ${FIXED}`} data-theme="light" style={{ left: 268, top: 54 }}>
                <b className="ed-sh-dot ed-wrap-dot" /><strong>Brand systems</strong><span>Logos, type and colour that hold up.</span>
              </div>
              <Sel s={{ left: 268, top: 54, width: 186, height: 140 }} tone="you" handles={8} tag="Frame · stacked ↓" />
              <div className="ed-minilayers" style={{ left: 24, top: 230 }}>
                <span><G n="dir-free" size={12} />Dot</span><span><Icon name="text" size={12} />Brand systems</span><span><Icon name="text" size={12} />Logos, type and…</span>
              </div>
              <div className="ed-minilayers" style={{ left: 268, top: 230 }}>
                <span data-on="true"><Icon name="frame" size={12} />Frame</span><span className="ed-in"><G n="dir-free" size={12} />Dot</span><span className="ed-in"><Icon name="text" size={12} />Brand systems</span><span className="ed-in"><Icon name="text" size={12} />Logos, type and…</span>
              </div>
            </Pane>
            <Pane x={518} y={24} w={380} h={792} title="Right-click an object">
              <span className={`ed-page ${FIXED}`} data-theme="light" style={{ left: 12, top: 40, width: 196, height: 84 }} />
              <div className={`ed-nudge ed-nudge--menu ${FIXED}`} data-theme="light"><span className="ed-sh-btn ed-sh-btn--ink ed-sh-btn--nav">Book a call</span></div>
              <Sel s={{ left: 28, top: 60, width: 148, height: 44 }} tone="you" handles={4} />
              <Menu width={292} style={{ left: 64, top: 118 }} items={[
                { label: "Ask AI about “Book a call”", icon: "spark", keys: "⌘/" },
                "sep",
                { label: "Cut", keys: "⌘X" }, { label: "Copy", keys: "⌘C" }, { label: "Paste", keys: "⌘V" }, { label: "Duplicate", icon: "duplicate", keys: "⌘D" },
                { label: "Copy properties", keys: "⌥⌘C" }, { label: "Paste properties", keys: "⌥⌘V" }, { label: "Select matching", note: "same style" },
                "sep",
                { label: "Frame selection", icon: "frame", keys: "⌥⌘G" }, { label: "Remove frame", keys: "⇧⌘G", disabled: true },
                "sep",
                { label: "Bring to front", keys: "⌘]" }, { label: "Bring forward", keys: "]", highlight: true }, { label: "Send backward", keys: "[" }, { label: "Send to back", keys: "⌘[" },
                "sep",
                { label: "Lock", icon: "lock", keys: "⇧⌘L" }, { label: "Hide", icon: "eye-off" },
                "sep",
                { label: "Advanced", sub: true, note: "Copy CSS · element id" },
                "sep",
                { label: "Remove", icon: "trash", keys: "⌫" },
              ] as MenuItem[]} />
            </Pane>
            <Pane x={914} y={24} w={494} h={388} title="A locked object — the click goes to its parent">
              <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={24} y={58} w={300} h={300} selected size="1080 × 1080"><Scaled k={300 / 1080} w={1080} h={1080}><Post v="combine" /></Scaled></Artboard>
              <span className="ed-lockbadge" style={{ left: 24 + 64 * (300 / 1080) + 26, top: 58 + 64 * (300 / 1080) - 6 }}><Icon name="lock" size={11} />Logo</span>
              <Sel s={{ left: 24 + 64 * (300 / 1080), top: 58 + 64 * (300 / 1080), width: 120 * (300 / 1080), height: 114 * (300 / 1080) }} tone="hover" handles={0} />
              <div className="ed-minilayers ed-minilayers--wide" style={{ left: 340, top: 58 }}>
                <span data-on="true"><Icon name="digital" size={12} />Post 1:1 · Com…</span>
                <span className="ed-in"><Icon name="frame" size={12} />Datum</span>
                <span className="ed-in"><Icon name="text" size={12} />Titulek</span>
                <span className="ed-in"><Icon name="image" size={12} />Logo<i className="ed-ml-st"><Icon name="lock" size={11} /></i></span>
                <span className="ed-in"><Icon name="image" size={12} />Hráč · foto</span>
              </div>
              <Tooltip text={<>Logo is locked · <Kbd>⇧⌘L</Kbd> unlocks</>} x={196} y={250} />
            </Pane>
            <Pane x={914} y={428} w={494} h={388} title="Hide, lock and pick — in Layers">
              <div className="ed-layersbig">
                {([["Datum", "frame", ""], ["ZAPIŠ SE", "component", ""], ["Podtitulek", "text", ""], ["Titulek", "text", "sel"], ["Logo", "image", "lock"], ["Hráč · foto", "image", "hover"], ["Pozadí — stará verze", "shape", "hidden"], ["Pozadí", "shape", ""]] as [string, string, string][]).map(([n, ic, st]) => (
                  <span key={n} className="row-item ed-lb" aria-current={st === "sel" ? "true" : undefined} data-st={st || undefined}>
                    <span className="k-ly-ic"><Icon name={ic} size={14} /></span>
                    <span className="k-cp-name">{n}</span>
                    {st === "hover" ? (<span className="ed-lb-acts"><Icon name="lock" size={12} /><Icon name="view" size={12} /></span>) : st === "lock" ? <span className="ed-lb-st"><Icon name="lock" size={12} /></span> : st === "hidden" ? <span className="ed-lb-st"><Icon name="eye-off" size={12} /></span> : null}
                  </span>
                ))}
              </div>
              <div className="ed-pane-copy" style={{ left: 262, top: 60, width: 210 }}>
                <p>Point at a row: lock and eye appear at its end.</p>
                <p>A hidden object stays in the file and in Layers, greyed. It never exports.</p>
                <p>Selecting a row selects it on the canvas, and the other way round.</p>
              </div>
            </Pane>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Layout ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="layout" title="Layout — auto layout and free placement" subtitle="Direction, gap and padding as Design-system tokens; Hug · Fill · Fixed; dragging opens a slot; social graphics place things freely, pinned by constraints">
        <DCArtboard id="ed-lay-auto" label="9 · Auto layout — gap and padding are tokens" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Drag a gap: it clicks through the system's space, like an artboard clicks onto presets.">Gap and padding read as tokens (Space 24); the ruler shows the stops. ⌘ ignores them; Auto spreads the cards (space between).</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AL.x} y={AL.y} w={1440 * AL.k} h={HOME_H * AL.k}><Scaled k={AL.k} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                <Band s={box(AL, { x: 72, y: 620, w: 1296, h: 24 })} />
                <Band s={box(AL, { x: 72, y: 876, w: 1296, h: 24 })} />
                <Band s={box(AL, { x: 72, y: 644, w: 24, h: 232 })} label="24" />
                <Band s={box(AL, { x: 1344, y: 644, w: 24, h: 232 })} />
                <Band s={box(AL, { x: 496, y: 644, w: 24, h: 232 })} label="24" hot />
                <Band s={box(AL, { x: 920, y: 644, w: 24, h: 232 })} />
                <Sel s={box(AL, HR.svc)} tone="you" handles={8} tag={<>Services <span className="ed-tag-q">→ Auto layout</span></>} />
                <TokRuler x={cx(AL, 508)} y={cy(AL, 620) - 12} stops={["12", "16", "24", "32", "48"]} on="24" />
                <Ptr x={cx(AL, 508)} y={cy(AL, 800)} kind="ew" />
                <Hint x={cx(AL, 508) + 18} y={cy(AL, 900) + 8}><Kbd>⌘</Kbd> any number · <Kbd>⌥</Kbd> every gap at once</Hint>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Menu width={208} style={{ left: 936, top: 118 }} items={[
                { group: "Gap · Space in " + STUDIO_SYS },
                ...["4", "8", "12", "16", "24", "32", "48", "64"].map((v) => (v === "24" ? { label: "Space 24", checked: true, highlight: true } : { label: "Space " + v })),
                "sep",
                { label: "Auto", note: "space between" },
                { label: "A number, no token…" },
              ] as MenuItem[]} />
              <Insp title="Services" kind="Frame" crumbs={["Desktop", "Services"]} advCount="4 properties" advOpen adv={
                <>
                  <span className="btn btn--sm ed-adv-btn"><G n="dir-free" size={12} />Convert layout to absolute</span>
                  <p className="ed-adv-note">Each card keeps where it is now; the frame stops arranging them. ⌘Z brings the layout back.</p>
                  <Css k="display" v="flex" /><Css k="gap" v="var(--space-24)" /><Css k="padding" v="var(--space-24)" />
                </>
              }>
                <Sec t="Layout" aside="Auto">
                  <Row k="Direction"><ISeg icons={["dir-row", "dir-col", "dir-grid", "dir-free"]} on="dir-row" /></Row>
                  <Row k="Gap"><Tok n="Space" v="24" focus /></Row>
                  <Row k="Padding"><Tok n="Space" v="24" /><span className="icon-btn k-icon-sm"><G n="dir-free" size={12} /></span></Row>
                  <Row k="Align"><AlignPad at={0} /></Row>
                </Sec>
                <Sec t="Size">
                  <Row k="Width"><N v="1296" w={64} /><Sz v="Fill" /></Row>
                  <Row k="Height"><N v="280" w={64} /><Sz v="Hug" /></Row>
                </Sec>
                <Line icon="dir-row">3 cards, each Fills the width.</Line>
              </Insp>
              <ZoomUndo zoom={66} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-lay-reorder" label="10 · Drag to reorder — the slot opens" width={W} height={1180} fixed>
          <Close note={<Note n={10} title="Drag Small apps to the front of Services.">The card lifts and follows the pointer; the others slide over and an empty slot opens where it will land, with the gaps measured. Layers shows the same slot.</Note>}>
            <Pane x={32} y={24} w={1376} h={700} plain>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={RZ.x} y={RZ.y} w={1440 * RZ.k} h={HOME_H * RZ.k}><Scaled k={RZ.k} w={1440} h={HOME_H}><SiteHome o={{ slots: ["slot", "product", "brand"] }} /></Scaled></Artboard>
                <Sel s={box(RZ, HR.svc, 3)} tone="parent" handles={0} />
                <Chip x={cx(RZ, 1368) - 150} y={cy(RZ, 620) - 28} tone="accent">Services <span className="ed-tag-q">→ Auto layout</span></Chip>
                <Band s={box(RZ, { x: 72, y: 644, w: 24, h: 232 })} label="24" />
                <Band s={box(RZ, { x: 496, y: 644, w: 24, h: 232 })} label="24" />
                <Band s={box(RZ, { x: 920, y: 644, w: 24, h: 232 })} label="24" />
                <span className="ed-slot-n" style={{ left: cx(RZ, 96) + 180 - 12, top: cy(RZ, 644) + 160 }}>1</span>
                <span className="ed-trail" style={{ left: cx(RZ, 520) - 52, top: cy(RZ, 800) }}><i /><i /><i /></span>
                <span className="ed-trail" style={{ left: cx(RZ, 944) - 52, top: cy(RZ, 800) }}><i /><i /><i /></span>
                <span className={`ed-lift ${FIXED}`} data-theme="light" style={{ left: cx(RZ, 96) + 34, top: cy(RZ, 644) - 92, width: 400 * RZ.k, height: 232 * RZ.k }}>
                  <span className="ed-lift-in" style={{ width: 400, height: 232, transform: `scale(${RZ.k})` }}><SvcCard id="apps" /></span>
                </span>
                <span className="ed-lift-tag" style={{ left: cx(RZ, 96) + 34, top: cy(RZ, 644) - 128 }}><G n="dir-row" size={12} />Small apps · moves to 1 of 3</span>
                <Ptr x={cx(RZ, 96) + 230} y={cy(RZ, 644) - 20} />
                <div className="ed-hints" style={{ left: 24, top: 640 }}>
                  <Hint>Let go — it moves here</Hint>
                  <Hint><Kbd>esc</Kbd> puts it back</Hint>
                  <Hint><Kbd>⌥</Kbd> while dragging — a copy</Hint>
                  <Hint>Drag out of the frame — place it freely</Hint>
                </div>
              </Canvas>
            </Pane>
            <Pane x={32} y={740} w={980} h={276} title="The reflow, frame by frame — neighbours slide on --dur-panel 220 ms, --ease-out">
              <div className="ed-film">{[0, 40, 90, 150, 220].map((t) => <FilmFrame key={t} t={t} />)}</div>
              <p className="ed-film-note">The lifted card follows the pointer 1:1, with no lag. With Reduce motion, neighbours jump to their place and the slot fades in.</p>
            </Pane>
            <Pane x={1028} y={740} w={380} h={276} title="Layers shows the same slot">
              <div className="ed-layersbig ed-layersbig--sm">
                <span className="row-item ed-lb"><span className="k-ly-ic"><Icon name="frame" size={14} /></span><span className="k-cp-name">Services</span><span className="ed-lb-st"><G n="dir-row" size={12} /></span></span>
                <span className="row-item ed-lb ed-lb--slot ed-in"><span className="k-ly-ic"><Icon name="frame" size={14} /></span><span className="k-cp-name">Small apps</span></span>
                <span className="row-item ed-lb ed-in"><span className="k-ly-ic"><Icon name="frame" size={14} /></span><span className="k-cp-name">Product design</span></span>
                <span className="row-item ed-lb ed-in"><span className="k-ly-ic"><Icon name="frame" size={14} /></span><span className="k-cp-name">Brand systems</span></span>
              </div>
              <p className="ed-film-note ed-film-note--side">Drag rows here too — the same slot, the same rules.</p>
            </Pane>
          </Close>
        </DCArtboard>

        <DCArtboard id="ed-lay-free" label="11 · Free placement with constraints" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="A social post places things freely.">Datum is pinned Right and Top, so it keeps 64 from the corner in every size — the story made with Duplicate at another width still shows it there.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={300} y={130} w={388.8} h={388.8}><Scaled k={0.36} w={1080} h={1080}><Post v="combine" /></Scaled></Artboard>
                <Artboard label="Story 9:16 · Combine 2026" kind="digital" x={728.8} y={130} w={388.8} h={691.2}><Scaled k={0.36} w={1080} h={1920}><Story v="combine" /></Scaled></Artboard>
                <Sel s={box({ x: 300, y: 130, k: 0.36 }, PR.date)} tone="you" handles={8} />
                <Gap x={cx({ x: 300, y: 130, k: 0.36 }, 1016)} y={cy({ x: 300, y: 130, k: 0.36 }, 172)} len={64 * 0.36} label="64" />
                <Gap x={cx({ x: 300, y: 130, k: 0.36 }, 908)} y={130} len={64 * 0.36} v label="64" />
                <Gap x={cx({ x: 728.8, y: 130, k: 0.36 }, 1016)} y={cy({ x: 728.8, y: 130, k: 0.36 }, 172)} len={64 * 0.36} label="64" soft />
                <Gap x={cx({ x: 728.8, y: 130, k: 0.36 }, 908)} y={130} len={64 * 0.36} v label="64" soft />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel project="Alligators brand" tab="layers" selected="Post 1:1 · Combine 2026" layers={postLayers(["Datum"])} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Datum" kind="Frame" crumbs={["Post 1:1 · Combine 2026", "Datum"]} advCount="5 properties">
                <Sec t="Position">
                  <Row k="X · Y"><N l="X" v="800" /><N l="Y" v="64" /></Row>
                  <Row k="Rotation"><N l={<G n="rotate" size={12} />} v="0°" /></Row>
                  <p className="ed-sub">Constraints</p>
                  <div className="ed-consrow"><Cons t r /><span className="ed-cons-sel"><InSelect value="Right" /><InSelect value="Top" /></span></div>
                </Sec>
                <Line icon="dir-free">Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner; its yellow is Podklad, the shape inside.</Line>
                <Sec t="Size"><Row k="W · H"><N l="W" v="216" /><N l="H" v="216" /></Row></Sec>
                <Sec t="Fill" aside={<G n="plus" size={12} />}><Row k="Fill" dim><span className="ed-none">None</span></Row></Sec>
              </Insp>
              <ZoomUndo zoom={36} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Text ─────────────────────────────────────────────────────────────────────── */}
      <DCSection id="text" title="Text" subtitle="Edit in place with a caret; styles come from the Design system; an override shows a dot; detach keeps the look — Czech with every háček and čárka">
        <DCArtboard id="ed-text-edit" label="12 · Edit text in place" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Double-click the headline and type.">The style from the Alligators system comes first. Language Čeština keeps one-letter words (v, s, i…) with the next word — small ties show where while you type.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Zapiš se" kind="digital" x={AT.x} y={AT.y} w={1080 * AT.k} h={1080 * AT.k}><Scaled k={AT.k} w={1080} h={1080}><Post v="zapis" o={{ mark: true, caret: true, ties: true }} /></Scaled></Artboard>
                <Sel s={box(AT, PR.title, 4)} tone="edit" handles={0} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Titulek" kind="Text" crumbs={["Post 1:1 · Zapiš se", "Titulek"]} uses={GATOR_SYS} advCount="8 properties">
                <Sec t="Type">
                  <Row k="Style"><span className="ed-style"><span className="ed-style-ic">Aa</span>Plakát<Icon name="chevron" size={12} /></span></Row>
                  <Row k="Font"><InSelect value="Avenir Next Condensed" /></Row>
                  <Row k="Size · weight"><N v="140" w={56} /><InSelect value="Heavy" /></Row>
                  <Row k="Line · letter"><N l={<G n="dir-col" size={11} />} v="92 %" w={72} /><N l={<G n="dir-row" size={11} />} v="0" w={56} /></Row>
                  <Row k="Align"><ISeg icons={["ta-left", "ta-center", "ta-right", "ta-just"]} on="ta-left" /></Row>
                  <Row k="Resizing"><InSeg options={["Width", "Height", "Fixed"]} value="Height" /></Row>
                  <Row k="Case"><InSeg options={["As typed", "AA"]} value="AA" /></Row>
                  <Row k="Language"><InSelect value="Čeština" /></Row>
                </Sec>
                <Line icon="text">Čeština: one-letter words stay with the next word (the ties under “v” and “s”), „quotes“ turn Czech.</Line>
                <Sec t="Fill"><Row k="Colour"><Tok n="Bílá" v="" sw="white" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={62} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-text-style" label="13 · A style, an override, a detach" width={W} height={760} fixed>
          <Close note={<Note n={13} title="Change one thing and the style shows a dot; Reset takes it back.">Detach keeps the look exactly and stops following Plakát — nothing else in the project changes. Updating Plakát for everyone is a Design system review (13).</Note>}>
            {([
              ["Uses the style", "Plakát", "140", false, "follow"],
              ["One thing changed", "Plakát · changed", "120", true, "mod"],
              ["Detached", "No style", "120", false, "detached"],
            ] as [string, string, string, boolean, string][]).map(([t, style, size, mod, st], i) => (
              <Pane key={t} x={32 + i * 464} y={24} w={448} h={608} title={t}>
                <div className={`ed-g ed-tsample ${FIXED}`} data-theme="light" data-st={st}><p className="ed-gtitle">STAŇ SE<br />GATOREM</p></div>
                <Insp title="Titulek" kind="Text" free cls="ed-insp--in" uses={st === "detached" ? undefined : GATOR_SYS}>
                  <Sec t="Type">
                    <Row k="Style" mod={mod}><span className={`ed-style${st === "detached" ? " ed-style--none" : ""}`}><span className="ed-style-ic">Aa</span>{style}<Icon name="chevron" size={12} /></span></Row>
                    <Row k="Size" mod={mod}><N v={size} w={64} mod={mod} />{st === "follow" ? <span className="ed-from">from Plakát</span> : null}</Row>
                    <Row k="Weight"><InSelect value="Heavy" />{st === "follow" ? <span className="ed-from">from Plakát</span> : null}</Row>
                    <Row k="Line height"><N v="92 %" w={64} /></Row>
                  </Sec>
                  {st === "mod" ? <Line icon="token" action="Reset">Size differs from Plakát.</Line> : null}
                  {st === "mod" ? <span className="ed-quietlink">Update Plakát for every canvas…</span> : null}
                  {st === "detached" ? <Line icon="unlink" action="Use a style">Keeps its look; stops following Plakát. Nothing else changes.</Line> : null}
                  {st === "follow" ? <Line icon="token">Change Plakát in the Design system and this follows.</Line> : null}
                </Insp>
              </Pane>
            ))}
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Shapes + Pen ─────────────────────────────────────────────────────────────── */}
      <DCSection id="shapes" title="Shapes and Pen" subtitle="R draws a rectangle; More holds Line, Ellipse, Polygon; each corner can differ; Pen edits points and handles">
        <DCArtboard id="ed-shape" label="14 · Shape — fill, stroke, each corner" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Podklad, the shape behind the date, has one tighter corner.">Drag the dot inside a corner to round it; unlink the corners to set each. More in the toolbar holds Line, Ellipse and Polygon.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={AT.x} y={AT.y} w={1080 * AT.k} h={1080 * AT.k}><Scaled k={AT.k} w={1080} h={1080}><Post v="combine" /></Scaled></Artboard>
                <Sel s={box(AT, PR.date)} tone="you" handles={8} tag="Podklad · 216 × 216" />
                {([[24, 24, false], [192, 24, false], [192, 192, false], [24, 192, true]] as [number, number, boolean][]).map(([dx, dy, on], i) => (
                  <i key={i} className="ed-rh" data-on={on ? "true" : undefined} style={{ left: cx(AT, PR.date.x + dx) - 4, top: cy(AT, PR.date.y + dy) - 4 }} />
                ))}
                <Chip x={cx(AT, PR.date.x) - 34} y={cy(AT, PR.date.y + 200)} tone="accent">8</Chip>
                <Ptr x={cx(AT, PR.date.x + 24) + 2} y={cy(AT, PR.date.y + 192) + 2} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Podklad" kind="Shape" crumbs={["Post 1:1 · Combine 2026", "Datum", "Podklad"]} advCount="6 properties">
                <Sec t="Shape">
                  <Row k="Kind"><InSelect value="Rectangle" /></Row>
                  <Row k="W · H"><N l="W" v="216" /><N l="H" v="216" /></Row>
                </Sec>
                <Sec t="Corners" aside={<span className="ed-sec-ic" data-on="true"><G n="unlink" size={12} /></span>}>
                  <div className="ed-corners"><N l="↖" v="40" w={116} /><N l="↗" v="40" w={116} /><N l="↙" v="8" w={116} focus /><N l="↘" v="40" w={116} /></div>
                </Sec>
                <Sec t="Fill" aside={<G n="plus" size={12} />}><Row k="Fill"><Tok n="Žlutá — akcent" v="100 %" sw="gyellow" /></Row></Sec>
                <Sec t="Border" aside={<G n="plus" size={12} />}>
                  <Row k="Border"><Tok n="Inkoust" v="" sw="gink" /><N v="3" w={44} /></Row>
                  <Row k="Position"><InSeg options={["Inside", "Centre", "Outside"]} value="Inside" /></Row>
                </Sec>
                <Sec t="Effects" aside={<G n="plus" size={12} />}><Row k="Shadow"><InSeg options={["Flat", "Soft", "Lifted"]} value="Flat" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={62} />
              <Toolbar tool="shape" more />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-pen" label="15 · Pen — draw, then points, handles, bend" width={W} height={1004} fixed>
          <Close note={<Note n={15} title="P draws: click for a sharp point, drag for a smooth one, click the first point to close.">Double-click a path to edit it — drag a handle to bend, ⌥-drag for a sharp corner. The dashed line is where the curve was.</Note>}>
            <Pane x={32} y={24} w={1000} h={692} plain>
              <div className={`ed-g ed-penart ${FIXED}`} data-theme="light">
                <p className="ed-gtitle">COMBINE<br />2026</p>
                <svg className="ed-pensvg" viewBox="0 0 1000 692" aria-hidden="true">
                  <path className="ed-swoosh" d="M120 520 C 200 570, 300 590, 380 570 S 560 500, 640 490 S 820 470, 900 450" />
                </svg>
              </div>
              <svg className="ed-penov" viewBox="0 0 1000 692" aria-hidden="true">
                <path className="ed-pen-was" d="M120 520 C 200 570, 300 590, 380 570 S 560 550, 640 540 S 820 470, 900 450" />
                <path className="ed-pen-path" d="M120 520 C 200 570, 300 590, 380 570 S 560 500, 640 490 S 820 470, 900 450" />
                <path className="ed-pen-h" d="M560 500 L640 490 L720 480" />
                <circle className="ed-pen-hd" cx="560" cy="500" r="5" />
                <circle className="ed-pen-hd ed-pen-hd--on" cx="720" cy="480" r="5" />
                {[[120, 520], [380, 570], [900, 450]].map(([x, y]) => <rect key={x} className="ed-pen-pt" x={x - 5} y={y - 5} width="10" height="10" />)}
                <rect className="ed-pen-pt ed-pen-pt--on" x={635} y={485} width="10" height="10" />
              </svg>
              <Ptr x={722} y={482} />
              <Chip x={652} y={512} tone="accent">Smooth</Chip>
              <Chip x={912} y={420} tone="quiet">Sharp</Chip>
            </Pane>
            <Pane x={32} y={732} w={1000} h={168} title="Draw a new one — Pen P" plain>
              <div className={`ed-g ed-penart ${FIXED}`} data-theme="light" />
              <svg className="ed-penov" viewBox="0 0 1000 140" aria-hidden="true">
                <path className="ed-pen-new" d="M70 104 L 230 40 C 300 14, 380 36, 420 92" />
                <path className="ed-pen-rubber" d="M420 92 L 476 36" />
                <circle className="ed-pen-close" cx="70" cy="104" r="10" />
                {[[70, 104], [230, 40]].map(([x, y]) => <rect key={x} className="ed-pen-pt" x={x - 5} y={y - 5} width="10" height="10" />)}
                <rect className="ed-pen-pt ed-pen-pt--on" x={415} y={87} width="10" height="10" />
                <path className="ed-pen-h" d="M380 36 L420 92 L460 148" />
              </svg>
              <Ptr x={476} y={36} />
              <Chip x={494} y={58} tone="guide">45°</Chip>
              <Chip x={88} y={112} tone="quiet">Click here to close</Chip>
              <div className="ed-pen-keys">
                <Hint>Click — a sharp point</Hint>
                <Hint>Drag — a smooth one</Hint>
                <Hint><Kbd>⇧</Kbd> 45° steps</Hint>
                <Hint><Kbd>↵</Kbd> or <Kbd>esc</Kbd> — finish, open</Hint>
              </div>
            </Pane>
            <Insp title="Path" kind="Pen · 4 points" free style={{ left: 1048, top: 24, width: 360 }} advCount="3 properties">
              <Sec t="Point">
                <Row k="Corner"><ISeg icons={["pt-smooth", "pt-sharp"]} on="pt-smooth" /></Row>
                <Row k="X · Y"><N l="X" v="640" /><N l="Y" v="490" /></Row>
              </Sec>
              <Sec t="Stroke"><Row k="Stroke"><Tok n="Žlutá — akcent" v="" sw="gyellow" /><N v="28" w={48} /></Row><Row k="Ends"><InSeg options={["Round", "Flat"]} value="Round" /></Row></Sec>
              <Sec t="Combine shapes"><Row k="Two or more" dim><ISeg icons={["union", "subtract", "intersect", "exclude"]} off={["union", "subtract", "intersect", "exclude"]} /></Row></Sec>
              <div className="ed-keylist">
                <p><span>Click</span>add a point</p>
                <p><span>Drag</span>pull out handles, bend</p>
                <p><span><Kbd>⌥</Kbd> drag</span>break a handle — sharp</p>
                <p><span>Double-click</span>sharp ↔ smooth</p>
                <p><span><Kbd>⌫</Kbd></span>remove the point</p>
                <p><span><Kbd>↵</Kbd> <Kbd>esc</Kbd></span>done</p>
              </div>
            </Insp>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Images ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="images" title="Images" subtitle="I opens Assets; drop a photo on a frame (or from Finder) and it fills it; double-click to crop; Fill · Fit · Crop · Tile; background removal hands off to Photo (12)">
        <DCArtboard id="ed-img" label="16 · Image — place, then crop" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Drop a photo on Hráč · foto, then double-click it.">It fills the frame, cropped to fit. In crop mode the whole photo shows faded beyond the frame: drag it, or its corners, until the player sits right. ↵ is done.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <span className={`ed-imgghost ${FIXED}`} data-theme="light" style={box(AI_, { x: 300, y: -140, w: 900, h: 1360 })}><Photo /></span>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={AI_.x} y={AI_.y} w={1080 * AI_.k} h={1080 * AI_.k}><Scaled k={AI_.k} w={1080} h={1080}><Post v="combine" o={{ crop: true }} /></Scaled></Artboard>
                <Sel s={box(AI_, PR.photo)} tone="crop" handles={0} tag="Hráč · foto · crop" tagTop />
                {(["nw", "ne", "se", "sw"] as const).map((c) => <i key={c} className={`ed-cb ed-cb--${c}`} style={box(AI_, PR.photo)} />)}
                {([[300, -140], [1200, -140], [1200, 1220], [300, 1220]] as [number, number][]).map(([x, y], i) => <i key={i} className="ed-imgh" style={{ left: cx(AI_, x) - 5, top: cy(AI_, y) - 5 }} />)}
                <Ptr x={cx(AI_, 760)} y={cy(AI_, 560)} />
                <Hint x={cx(AI_, 380)} y={cy(AI_, 1080) + 12}><Kbd>↵</Kbd> done · <Kbd>esc</Kbd> cancel</Hint>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel project="Alligators brand" tab="assets" assets={<GatorAssets placed={0} />} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Hráč · foto" kind="Image" crumbs={["Post 1:1 · Combine 2026", "Hráč · foto"]} advCount="4 properties">
                <Sec t="Image">
                  <div className="ed-imgrow"><span className={`ed-imgthumb ${FIXED}`} data-theme="light"><Photo /></span><span className="ed-imgname"><span>combine-2025-sprint.jpg</span><em>4032 × 3024</em></span><InButton>Replace…</InButton></div>
                  <Row k="Fit"><InSeg options={["Fill", "Fit", "Crop", "Tile"]} value="Crop" /></Row>
                  <Row k="Zoom"><N v="128 %" w={72} focus /></Row>
                </Sec>
                <Sec t="Adjust">
                  <Row k="Look"><InButton>Adjust…</InButton></Row>
                  <Row k="Background"><InButton icon="spark">Remove background</InButton></Row>
                  <Line icon="image">Both open Photo (12). Edits apply to this use only; Remove background is AI's job, so it wears the spark.</Line>
                </Sec>
              </Insp>
              <ZoomUndo zoom={56} />
              <Toolbar tool="image" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Components ───────────────────────────────────────────────────────────────── */}
      <DCSection id="components" title="Components" subtitle="⇧I lists the Design system's pieces grouped like its canvas; an instance shows what you changed, swaps variants, detaches, and goes to its main on the Design system canvas (13)">
        <DCArtboard id="ed-comp-pick" label="17 · Component ⇧I — from the Design system" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="⇧I lists the Alligators system: Brand, Components, Patterns.">Pick Tlačítko · Plné and click where it goes — it snaps to the story's centre and stays linked. ↵ places it in the selected frame instead.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={AS.x} y={AS.y} w={1080 * AS.k} h={1920 * AS.k}><Scaled k={AS.k} w={1080} h={1920}><Story v="zapis" o={{ btn: "ghost" }} /></Scaled></Artboard>
                <GLine x={cx(AS, 540)} y={AS.y} len={1920 * AS.k} v />
                <Sel s={box(AS, SR.btn)} tone="ghost" handles={0} tag="Tlačítko · Plné" tagIcon="component" />
                <Ptr x={cx(AS, 560)} y={cy(AS, 1700)} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ComponentPicker style={{ left: 860, bottom: 84, width: 300 }} />
              <ZoomUndo zoom={36} />
              <Toolbar tool="component" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-comp-instance" label="18 · An instance — override, swap, detach" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Change the text and colour of one Tlačítko.">Each change gets a dot; Reset takes them back. Swap the variant — or the whole component — and your text comes along. Detach breaks nothing.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={AS.x} y={AS.y} w={1080 * AS.k} h={1920 * AS.k}><Scaled k={AS.k} w={1080} h={1920}><Story v="zapis" o={{ btnText: "REGISTRUJ SE", btnWhite: true }} /></Scaled></Artboard>
                <Sel s={box(AS, SR.btn)} tone="you" handles={8} tag="Tlačítko · Plné" tagIcon="component" />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Menu width={208} style={{ left: 936, top: 150 }} items={[
                { group: "Tlačítko · variant" },
                { label: "Plné", checked: true, highlight: true },
                { label: "Obrys", checked: false },
                "sep",
                { label: "Your text and colour come along", disabled: true },
              ] as MenuItem[]} />
              <Insp title="Tlačítko" kind="Instance" crumbs={["Story 9:16 · Zapiš se", "Tlačítko"]} uses={GATOR_SYS} advCount="Instance of Tlačítko">
                <Sec t="Component">
                  <Row k="Component"><InSelect value="Tlačítko" /></Row>
                  <Row k="Variant"><span className="ed-focus"><InSelect value="Plné" /></span></Row>
                </Sec>
                <Sec t="Content">
                  <Row k="Text" mod><span className="input ed-in">REGISTRUJ SE</span></Row>
                  <Row k="Fill" mod><Tok n="Bílá" v="" sw="white" /></Row>
                  <Row k="Icon"><InSwitch on={false} /></Row>
                  <Line icon="token" action="Reset">2 changes from Tlačítko.</Line>
                  <span className="ed-quietlink">Update Tlačítko for every canvas…</span>
                </Sec>
                <Sec t="Main component">
                  <div className="ed-btnrow"><InButton icon="component">Go to Tlačítko</InButton><span className="btn btn--sm"><G n="unlink" size={12} />Detach</span></div>
                  <Line>Detach keeps this exact look as a plain frame. Nothing breaks; it stops following Tlačítko.</Line>
                </Sec>
              </Insp>
              <ZoomUndo zoom={36} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 8 · The inspector ────────────────────────────────────────────────────────────── */}
      <DCSection id="inspector" title="The inspector, every section" subtitle="One object, all of it: Position, Size, Layout, Fill, Corners, Border, Effects, Type, Interaction, Export — and Advanced last: CSS, the tokens it uses, its element id">
        <DCArtboard id="ed-inspector" label="19 · The inspector for one button" width={W} height={1860} fixed>
          <Close note={<Note n={19} title="Designer words first; CSS waits under Advanced.">Every value from the Design system reads as a token chip — Space 24, Round, Resting. A plain number shows plainly, with Bind. Interaction is where a click goes; Preview plays it.</Note>}>
            <Pane x={32} y={24} w={560} h={420} title="Book a call — selected">
              <div className={`ed-navcrop ${FIXED}`} data-theme="light">
                <span className="ed-sh-logo"><b />Studio</span><span>About</span>
                <em>Book a call</em>
              </div>
              <Band s={{ left: 260, top: 168, width: 38, height: 70 }} label="24" />
              <Band s={{ left: 460, top: 168, width: 38, height: 70 }} />
              <Band s={{ left: 298, top: 168, width: 162, height: 16 }} />
              <Sel s={{ left: 260, top: 168, width: 237, height: 70, borderRadius: "var(--radius-pill)" }} tone="you" handles={8} tag="Book a call · 148 × 44 · Hug" />
              <Chip x={370} y={136} tone="quiet">V 10 · not a token</Chip>
              <span className="ed-linkchip" style={{ left: 300, top: 268 }}><Icon name="link" size={12} />Opens cal.com/studio</span>
            </Pane>
            <Pane x={32} y={460} w={560} h={960} title="The words, and what they write">
              <div className="ed-words">
                {([
                  ["Hug", "width: fit-content"],
                  ["Fill", "flex: 1"],
                  ["Fixed 148", "width: 148px"],
                  ["Gap Space 8", "gap: var(--space-8)"],
                  ["Spacing Space between", "justify-content: space-between"],
                  ["Padding H 24 · V 10", "padding: 10px var(--space-24)"],
                  ["Fill Ink", "background: var(--ink)"],
                  ["Corners Round", "border-radius: var(--radius-round)"],
                  ["Border Ink 1.5", "border: 1.5px solid var(--ink)"],
                  ["Shadow Resting", "box-shadow: var(--shadow-resting)"],
                  ["Shadow Floating", "box-shadow: var(--shadow-floating)"],
                  ["Shadow Sheet", "box-shadow: var(--shadow-sheet)"],
                  ["Clip content", "overflow: hidden"],
                  ["Constraints Right · Top", "right: 72px; top: 22px"],
                  ["On click Open link", "<a href=\"https://cal.com/studio\">"],
                  ["Hidden", "display: none (kept in Layers)"],
                  ["Locked", "— (canvas only, never in the CSS)"],
                ] as [string, string][]).map(([a, b]) => <p key={a}><span>{a}</span><code className="k-mono">{b}</code></p>)}
              </div>
            </Pane>
            <Insp title="Book a call" kind="Button" free crumbs={["Desktop", "Nav", "Book a call"]} uses={STUDIO_SYS} style={{ left: 616, top: 24, width: 320 }} advCount="CSS · tokens · id" advOpen adv={
              <>
                <Css k="display" v="inline-flex" />
                <Css k="gap" v="var(--space-8)" />
                <Css k="padding" v="10px var(--space-24)" />
                <Css k="background" v="var(--ink)" />
                <Css k="border-radius" v="var(--radius-round)" />
                <Css k="box-shadow" v="var(--shadow-resting)" />
                <p className="ed-adv-h">Tokens it uses</p>
                <span className="ed-toks"><Tok n="Ink" v="" sw="ink" /><Tok n="Page" v="" sw="white" /><Tok n="Space" v="8" /><Tok n="Space" v="24" /><Tok n="Round" v="" /><Tok n="Resting" v="" /><Tok n="Link" v="" /></span>
                <p className="ed-adv-h">Element id</p>
                <span className="input k-mono ed-id">book-call</span>
                <span className="ed-adv-acts"><span className="btn btn--sm">Copy CSS</span><span className="btn btn--sm">Convert layout to absolute</span></span>
              </>
            }>
              <Sec t="Position" n={1}>
                <Row k="X · Y"><N l="X" v="1220" /><N l="Y" v="22" /></Row>
                <Row k="Rotation"><N l={<G n="rotate" size={12} />} v="0°" /></Row>
                <p className="ed-sub">Constraints</p>
                <div className="ed-consrow"><Cons t r /><span className="ed-cons-sel"><InSelect value="Right" /><InSelect value="Top" /></span></div>
              </Sec>
              <Sec t="Size" n={2}>
                <Row k="Width"><N v="148" w={56} /><Sz v="Hug" /></Row>
                <Row k="Height"><N v="44" w={56} /><Sz v="Hug" /></Row>
                <Row k="Clip content"><InSwitch on={false} /></Row>
              </Sec>
              <Sec t="Layout" n={3}>
                <Row k="Direction"><ISeg icons={["dir-row", "dir-col", "dir-grid", "dir-free"]} on="dir-row" /></Row>
                <Row k="Gap"><Tok n="Space" v="8" /></Row>
                <Row k="Spacing"><InSeg options={["Packed", "Space between"]} value="Packed" /></Row>
                <Row k="Padding"><span className="ed-ax">H</span><Tok n="Space" v="24" /><span className="ed-ax">V</span><Tok v="10" raw /></Row>
                <Row k="Align"><AlignPad at={4} /></Row>
              </Sec>
              <Sec t="Fill" n={4} aside={<G n="plus" size={12} />}><Row k="Fill"><Tok n="Ink" v="100 %" sw="ink" /></Row></Sec>
              <Sec t="Corners" n={5} aside={<span className="ed-sec-ic"><G n="unlink" size={12} /></span>}><Row k="All"><Tok n="Round" v="" /></Row></Sec>
              <Sec t="Border" n={6} aside={<G n="plus" size={12} />}><Row k="Border" dim><span className="ed-none">None</span></Row></Sec>
              <Sec t="Effects" n={7} aside={<G n="plus" size={12} />}>
                <Row k="Shadow"><InSeg options={["Flat", "Resting", "Floating", "Sheet"]} value="Resting" /></Row>
                <Row k="Opacity"><N v="100 %" w={72} /></Row>
              </Sec>
              <Sec t="Type" n={8} aside="text inside">
                <Row k="Style"><span className="ed-style"><span className="ed-style-ic">Aa</span>Link<Icon name="chevron" size={12} /></span></Row>
                <Row k="Size · weight"><N v="14" w={48} /><InSelect value="Semibold" /></Row>
                <Row k="Colour"><Tok n="Page" v="" sw="white" /></Row>
              </Sec>
              <Sec t="Interaction" n={9} aside={<G n="plus" size={12} />}>
                <Row k="On click"><span className="ed-focus"><InSelect value="Open cal.com/studio" /></span></Row>
                <Row k="On hover"><InSelect value="Lift to Floating" /></Row>
                <Line icon="link">Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes.</Line>
              </Sec>
              <Sec t="Export" n={10} aside={<G n="plus" size={12} />}>
                <Row k="PNG"><InSelect value="2×" /><InSelect value="SVG" /></Row>
                <Row k="This object"><InButton icon="export">Export Book a call</InButton></Row>
              </Sec>
            </Insp>
            <div className="ed-explain" style={{ left: 964, top: 0, width: 444 }}>
              {([
                ["Position", "Where it sits inside its frame. Constraints say which edges it keeps when the frame grows."],
                ["Size", "Hug wraps the content, Fill takes the room the frame gives, Fixed is a number."],
                ["Layout", "Auto layout: direction, gap, spacing (Packed or Space between), padding H and V, alignment. Values come from the system's space; 10 isn't in it, so it shows plainly with Bind."],
                ["Fill", "Colour from the Design system first; + adds another fill — a colour, a gradient or an image."],
                ["Corners", "One home on every object: one value, or unlink for each corner. Round, XS … XL from the system."],
                ["Border", "Empty until you add one with +. Inside, centre or outside. Lines and Pen paths call it Stroke."],
                ["Effects", "Shadows are the system's elevation — Flat, Resting, Floating, Sheet — the lowered, soft kind."],
                ["Type", "For the text inside. The style first; size and weight override it, with a dot."],
                ["Interaction", "Where a click goes and what a hover does. Preview plays it; Edit shows the link while selected."],
                ["Export", "This object as PNG or SVG — artboards export the same way, plus ⇧⌘E."],
                ["Advanced", "Last, folded at the foot: the CSS it writes, every token it uses, its element id. Copy CSS and Convert layout to absolute live here."],
              ] as [string, string][]).map(([t, d], i) => (
                <div key={t} className="ed-explain-i" style={{ top: EXPLAIN_TOPS[i] }}><Callout n={i + 1} outline /><p><strong>{t}.</strong> {d}</p></div>
              ))}
            </div>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 9 · Edge cases ───────────────────────────────────────────────────────────────── */}
      <DCSection id="edge" title="Edge cases" subtitle="AI and you in one artboard · ⌘/ on a selection, in place · Tereza on the same object · a 6000 px page · undo across AI and you · a paste from Figma · keyboard only">
        <DCArtboard id="ed-edge-ai" label="20 · AI edits the footer, you edit the headline" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="AI owns only the object it is changing.">You keep typing in the headline. Click the footer and a tip says it's AI's until done — Stop is in the AI chat. A token it uses can still change; AI picks up the new value.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AE.x} y={AE.y} w={1440 * AE.k} h={HOME_H * AE.k}><Scaled k={AE.k} w={1440} h={HOME_H}><SiteHome o={{ caret: true, footer: "ai" }} /></Scaled></Artboard>
                <Sel s={box(AE, HR.foot)} tone="ai" handles={0} tag="AI is drawing the footer" tagTop tagIcon="spark" />
                <Cursor agent x={cx(AE, 1040)} y={cy(AE, 1480)} tag={false} />
                <Sel s={box(AE, HR.h1, 3)} tone="edit" handles={0} />
                <Ptr x={cx(AE, 330)} y={cy(AE, 1500)} />
                <Tooltip text="Footer is AI's until it's done · Stop in the AI chat" x={cx(AE, 330) + 104} y={cy(AE, HOME_H) + 12} below />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Headline" kind="Text" crumbs={["Desktop", "Hero", "Headline"]}>
                <Sec t="Type">
                  <Row k="Style" mod><span className="ed-style"><span className="ed-style-ic">Aa</span>Display<Icon name="chevron" size={12} /></span></Row>
                  <Row k="Size · weight" mod><N v="64" w={48} mod /><InSelect value="Semibold" /></Row>
                  <Row k="Align"><ISeg icons={["ta-left", "ta-center", "ta-right", "ta-just"]} on="ta-left" /></Row>
                </Sec>
                <Line tone="ai" icon="spark">AI is changing Footer in this artboard. Everything else stays yours.</Line>
              </Insp>
              <AIPanel chat="Homepage footer" messages={[{ from: "you", text: "Add a footer: links, our address, and a newsletter signup." }]} working="AI is drawing the footer" step="Links done · newsletter field next" scope="Footer" />
              <ZoomUndo zoom={44} />
              <Toolbar tool="select" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-ask" label="21 · ⌘/ on a selection — AI works in place" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="Select three cards, press ⌘/, say what they need.">AI works inside those three only — its outline sits on the selection, not the page — and the whole change is one step: ⌘Z takes it back.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AO.x} y={AO.y} w={1440 * AO.k} h={HOME_H * AO.k}><Scaled k={AO.k} w={1440} h={HOME_H}><SiteHome o={{ cardsAi: true }} /></Scaled></Artboard>
                {[0, 1, 2].map((i) => <Sel key={i} s={box(AO, card(i))} tone="thin" handles={0} />)}
                <Sel s={box(AO, { x: 96, y: 644, w: 1248, h: 232 }, 8)} tone="ai" handles={0} tag="AI is adding a link to 3 cards" tagTop tagRight tagIcon="spark" />
                <Cursor agent x={cx(AO, 1000)} y={cy(AO, 836)} tag={false} />
                <div className="island ed-asked" style={{ left: cx(AO, 96) - 8, top: cy(AO, 876) + 16 }}>
                  <Avatar who="you" size="sm" />
                  <span className="ed-asked-t">Add a “Read more →” link to each card, same place in all three.</span>
                  <span className="ed-asked-k"><Kbd>⌘/</Kbd></span>
                </div>
                <Hint x={cx(AO, 96) + 432} y={cy(AO, 876) + 19}>One step — <Kbd>⌘Z</Kbd> undoes all of it · the rest of the page stays yours</Hint>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <CanvasesPanel project="Studio site" tab="layers" selected="Desktop" layers={homeLayers(["Product design", "Brand systems", "Small apps"])} />
              <ShareCluster people={["tereza"]} mode="edit" />
              <PanelIcon icon="spark" at="ai" dot />
              <ZoomUndo zoom={60} />
              <Toolbar tool="select" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-tereza" label="22 · Tereza is editing the same button" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="Tereza got there first.">Her sky ring and name sit on See pricing. You can select it and read every value; the fields open when she moves on. One action meanwhile: Comment.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AO.x} y={AO.y} w={1440 * AO.k} h={HOME_H * AO.k}><Scaled k={AO.k} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                <Sel s={{ ...box(AO, HR.cta2, 5), borderRadius: "var(--radius-pill)" }} tone="tereza" handles={0} tag="Tereza" tagTop />
                <Sel s={{ ...box(AO, HR.cta2), borderRadius: "var(--radius-pill)" }} tone="thin" handles={0} />
                <Cursor name="tereza" x={cx(AO, 420)} y={cy(AO, 462)} tag={false} />
                <Ptr x={cx(AO, 200)} y={cy(AO, 500)} />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="See pricing" kind="Button" crumbs={["Desktop", "Hero", "See pricing"]} cls="ed-insp--view" advCount="5 properties">
                <Line tone="people" who="tereza" action="Comment">Tereza is editing See pricing. You can look; the fields open when she moves on.</Line>
                <Sec t="Size"><Row k="W · H" view><N l="W" v="184" /><N l="H" v="52" /></Row></Sec>
                <Sec t="Fill"><Row k="Fill" view><Tok n="Page" v="" sw="white" /></Row></Sec>
                <Sec t="Border"><Row k="Border" view><Tok n="Ink" v="1.5" sw="ink" /></Row></Sec>
                <Sec t="Interaction"><Row k="On click" view><InSelect value="Go to Pricing" /></Row><Row k="On hover" view><InSelect value="Fill with Ink" /></Row></Sec>
              </Insp>
              <ZoomUndo zoom={60} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-huge" label="23 · A 6000 px page" width={W} height={H} fixed>
          <Stage note={<Note n={23} title="Inside a page six screens tall.">Its name sticks to the top of the window, and a minimap appears while you work in it — click a section there to jump. ⌘0 fits the whole page.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Domů · Desktop" kind="web" x={520} y={-380} w={316.8} h={1320}><Scaled k={0.22} w={1440} h={6000}><ClubPage /></Scaled></Artboard>
                <span className="ed-sticky-name" style={{ left: 520, top: 8 }}><Icon name="web" size={11} />Domů · Desktop<span>1440 × 6000</span></span>
                <Sel s={{ left: 520, top: -380 + 1900 * 0.22, width: 316.8, height: 1200 * 0.22 }} tone="you" handles={8} tag="Tým · 1440 × 1200" />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="club-web / Domů" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["jonas"]} mode="edit" />
              <div className="island ed-mini">
                <p className="ed-mini-t"><Icon name="web" size={11} />Domů · Desktop</p>
                <div className="ed-mini-b">
                  <span className="ed-mini-page">
                    {CLUB_SECTIONS.map(([n, y, h]) => <i key={n} data-on={n === "Tým" ? "true" : undefined} style={{ top: y * 0.04, height: h * 0.04 - 2 }} />)}
                    <b style={{ top: 1727 * 0.04, height: (5636 - 1727) * 0.04 }} />
                  </span>
                  <span className="ed-mini-list">{CLUB_SECTIONS.map(([n]) => <span key={n} data-on={n === "Tým" ? "true" : undefined}>{n}</span>)}</span>
                </div>
              </div>
              <Insp title="Tým" kind="Frame" crumbs={["Domů · Desktop", "Tým"]} advCount="5 properties">
                <Sec t="Size"><Row k="Width"><N v="1440" w={64} /><Sz v="Fill" /></Row><Row k="Height"><N v="1200" w={64} /><Sz v="Hug" /></Row></Sec>
                <Sec t="Layout"><Row k="Direction"><ISeg icons={["dir-row", "dir-col", "dir-grid", "dir-free"]} on="dir-grid" /></Row><Row k="Gap"><Tok n="Space" v="48" /></Row></Sec>
                <Line icon="web">You're looking at 1727–5636 of 6000.</Line>
              </Insp>
              <ZoomUndo zoom={22} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-undo" label="24 · Undo across AI and you" width={W} height={H} fixed>
          <Stage note={<Note n={24} title="⌘Z steps back through your changes and your AI's, in order.">Menu › Edit › Undo history lists them; an AI run is one step, and pointing at a row lights what it would undo. Saved versions stay in Version history.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AU.x} y={AU.y} w={1440 * AU.k} h={HOME_H * AU.k}><Scaled k={AU.k} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                <Sel s={box(AU, HR.foot)} tone="ai" handles={0} tag="Would undo · 14 changes" tagTop tagIcon="spark" />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <div className="k-menu ed-hist">
                <p className="ed-hist-t">Undo history<span>newest first</span></p>
                <p className="ed-hist-from">Opened from Menu › Edit › Undo history</p>
                {([
                  ["ai", "Footer — 14 changes, one step", "now", true],
                  ["you", "Headline text", "1 min ago", false],
                  ["you", "Moved See pricing 10 px", "3 min ago", false],
                  ["ai", "Hero picture — kept try 2 of 3", "6 min ago", false],
                  ["you", "Duplicated Desktop at Tablet", "10 min ago", false],
                ] as [string, string, string, boolean][]).map(([w, t, m, on]) => (
                  <span key={t} className="row-item ed-hist-r" data-hl={on ? "true" : undefined}>
                    {w === "ai" ? <span className="ed-hist-ai"><Spark size={11} /></span> : <Avatar who="you" size="sm" />}
                    <span className="ed-hist-txt"><span>{t}</span><em>{w === "ai" ? "AI" : "You"} · {m}</em></span>
                    {on ? <span className="k-mi-keys">⌘Z</span> : null}
                  </span>
                ))}
                <span className="k-msep" />
                <p className="ed-hist-foot">Tereza's changes are hers to undo.</p>
                <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="history" size={14} /></span><span className="k-mi-lab">Version history</span><span className="k-mi-keys">⌥⌘H</span></span>
              </div>
              <ZoomUndo zoom={44} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-paste" label="25 · Pasted from Figma" width={W} height={H} fixed>
          <Stage note={<Note n={25} title="A frame copied in Figma arrives as Figma's exact picture.">It looks right at once. Make editable rebuilds this one frame as layers — check the text after (12 Import and Assets has the full import).</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AE.x} y={AE.y} w={1440 * AE.k} h={HOME_H * AE.k}><Scaled k={AE.k} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                <span className={`ed-figpic ${FIXED}`} data-theme="light" style={box(AE, { x: 360, y: 600, w: 720, h: 400 })}>
                  <span className="ed-figpic-art" /><strong>Calm software, made in Brno.</strong><span>Hero · v3</span><i className="ed-figpic-b"><G n="picture" size={11} /></i>
                </span>
                <Sel s={box(AE, { x: 360, y: 600, w: 720, h: 400 })} tone="you" handles={8} />
                <div className="island ed-pastebar" style={{ left: cx(AE, 360), top: cy(AE, 1000) + 14 }}>
                  <G n="picture" size={14} /><span>Pasted from Figma as an image of “Hero / v3”.</span><span className="btn btn--sm btn--primary">Make editable</span>
                </div>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Hero / v3" kind="Image" crumbs={["Desktop", "Hero / v3"]} advCount="3 properties">
                <Sec t="Image">
                  <Row k="From"><span className="ed-src">Figma · Hero / v3</span></Row>
                  <Row k="W · H"><N l="W" v="720" /><N l="H" v="400" /></Row>
                  <Row k="Fit"><InSeg options={["Fill", "Fit"]} value="Fill" /></Row>
                </Sec>
                <Line icon="picture">Make editable needs Figma Dev Mode on a paid seat. Some text may come back as pictures.</Line>
              </Insp>
              <ZoomUndo zoom={44} />
              <Toolbar tool="select" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ed-edge-keys" label="26 · Keyboard only" width={W} height={884} fixed>
          <Close note={<Note n={26} title="Every object is reachable without a mouse.">tab walks objects in reading order, ↵ goes inside, esc comes back out; VoiceOver hears what is focused and where. The focus ring is thicker, with a halo — never mistaken for a selection.</Note>}>
            <Pane x={32} y={24} w={820} h={732} plain>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={40} y={40} w={1440 * 0.45} h={HOME_H * 0.45}><Scaled k={0.45} w={1440} h={HOME_H}><SiteHome /></Scaled></Artboard>
                {([[HR.nav, "1"], [HR.hero, "2"], [HR.eyebrow, "3"], [HR.svc, "4"], [HR.work, "5"], [HR.foot, "6"]] as [R, string][]).map(([r, n]) => (
                  <span key={n} className="ed-order" data-on={n === "4" ? "true" : undefined} style={{ left: 40 + 5, top: cy({ x: 40, y: 40, k: 0.45 }, r.y) + 2 }}>{n}</span>
                ))}
                {[0, 1, 2].map((i) => <span key={i} className="ed-order ed-order--in" style={{ left: cx({ x: 40, y: 40, k: 0.45 }, card(i).x) + 6, top: cy({ x: 40, y: 40, k: 0.45 }, card(i).y) + 6 }}>4.{i + 1}</span>)}
                <Sel s={box({ x: 40, y: 40, k: 0.45 }, HR.svc, 2)} tone="focus" handles={0} />
              </Canvas>
            </Pane>
            <div className="ed-keys" style={{ left: 884, top: 48, width: 524 }}>
              {([
                [["F6"], [], "Move between the panels and the canvas"],
                [["tab"], ["⇧", "tab"], "Next or previous object, in reading order"],
                [["↵"], [], "Go inside a frame · start typing in text"],
                [["esc"], [], "Step back out — at the top, the artboard itself"],
                [["↑", "↓", "←", "→"], [], "Move 1 px · with ⇧, 10 px"],
                [["⌘", "↑↓←→"], [], "Resize 1 px from the right or bottom · ⇧ 10 px"],
                [["←", "→"], [], "In auto layout — move it earlier or later"],
                [["R", "T", "F"], [], "A tool, then ↵ — adds one at its default size"],
                [["⌘D"], ["⌫"], "Duplicate · remove"],
                [["⌥⌘G"], [], "Wrap the selection in a frame"],
                [["⌘/"], [], "Ask AI about what's focused"],
                [["?"], [], "All shortcuts"],
              ] as [string[], string[], string][]).map(([a, b, t], i) => (
                <p key={i}><span className="ed-keys-k">{a.map((x) => <Kbd key={x}>{x}</Kbd>)}{b.length ? <span className="ed-keys-or">or</span> : null}{b.map((x) => <Kbd key={"b" + x}>{x}</Kbd>)}</span><span>{t}</span></p>
              ))}
              <div className="island ed-vo">
                <p className="ed-vo-t"><G n="speaker" size={14} />VoiceOver hears</p>
                <p>“Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside.”</p>
              </div>
            </div>
          </Close>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
