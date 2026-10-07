/**
 * @canvas      11 Projects and Navigation — always finding the right canvas: project tabs (two variants), Home at scale, a big project, ⌘K, Version history
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   pn-tab-a | pn-tab-b | pn-tab-a20 | pn-tab-b20 | pn-ab | pn-tab-menu | pn-windows | pn-accounts |
 *              pn-home | pn-home-search |
 *              pn-organise | pn-move | pn-trash | pn-jump |
 *              pn-k-across | pn-k-close |
 *              pn-history | pn-compare |
 *              pn-switch-ai | pn-relaunch | pn-deeplink | pn-cant-open
 * @brief       "co tě ještě napadne" — Projects & Navigation. Michal: "Dulezite predevsim je aby se uzivatel citil
 *              ze vzdy najde spravny canvas" · the v2 driver: "UI aby podporovalo desktop-project-tabs"
 *              (.ai/plans/feature-desktop-project-tabs-and-identity-profiles.md) · v2-redesign-approach decision:
 *              "Navrhnout obě varianty — nativní macOS window tabs vs vlastní tab strip à la Figma".
 *
 * Section 1 draws BOTH tab variants Michal asked for, then compares them (pn-ab):
 *   A · native macOS window tabs (the plan: tabbing_identifier, "NO in-page tab strip") — only what AppKit draws:
 *       title text, close ×, +, the system » overflow menu, the Window menu, Merge All Windows, the Mac's own tab
 *       right-click menu. Project identity, account and AI state live INSIDE the window (project pill + its spark,
 *       the account chip in the Share cluster, a Mac notification for a tab you left).
 *   B · a Figma-style strip drawn by Maude — project square + name on every tab, a W face for a second account,
 *       the AI spark / "?" needs-you, Home pinned first, "10 more" list with folders and state. Needs plan changes
 *       (listed on pn-ab).
 *   Everything after section 1 draws Variant A — the plan as written, and the proposed pick (Michal to choose).
 *   Picking A amends CONTRACT §6 twice (no project-initial avatar on a native tab; the tab right-click menu is the
 *   Mac's own) — pn-ab says so. Whether AppKit's tab bar has a » list is a T5-spike check; fallback = Show All Tabs + ⌘K.
 *
 * Ownership (same as 10): You OWN Alligators brand and Studio site. Losing access / being turned to Can view is drawn
 * on Brno Open 2026, Tereza's project (pn-cant-open). Home › Shared with you lists only canvases from projects you
 * aren't in (Liga ČAAF 2027 — Jonas's, Pražský pohár — Tereza's). Kavárna Na Rohu syncs to the studio's own hub
 * (10 co-share-advanced). Canvas links have one shape: alligators.cloud.maude.sh/c/combine-kampan (no file path).
 *
 * Decisions this canvas proposes (Michal to confirm — each is also in its artboard's note):
 *   · Home tab: + (⌘T) opens Home on the app's own page (the plan's boot window before it navigates); picking a project
 *     navigates that same tab (switch_project on the calling window). One Home at a time. A: Home is wherever it was
 *     opened; B: Home is pinned first.
 *   · A project opens ONCE — opening it again switches to its tab (the plan's window label is the hash of its folder).
 *   · Running projects: the plan runs at most 5 and never stops one that has a window, so a 6th tab is refused.
 *     Proposed amendment: tabs past 5 REST — the tab stays, its server stops, a click wakes it (about a second). Never a
 *     tab where AI is working or changes are unsent. Never closes a tab for you.
 *   · Relaunch reopens every tab, resting (plan v1 restores only the last project — amendment).
 *   · Keys: ⌃Tab / ⌃⇧Tab and ⇧⌘] / ⇧⌘[ (macOS's own), ⌘T, ⌘W = close this project's tab (macOS), ⇧⌘\ Show All Tabs.
 *     Close canvas (Menu › File) has no key. Reopen a closed tab from Home or ⌘K — ⇧⌘T stays Timeline (CONTRACT §7).
 *     NOT ⌘1–9 — ⌘0 / ⌘1 are Zoom to fit / Actual size (CONTRACT §2).
 *   · Accounts: the binding is per PROJECT and kept on this Mac (plan T2). Signing out signs out every project on that
 *     account. One form everywhere: "Work · you@work-studio.cz", "Personal · you@gmail.com"; faces W / P.
 *   · Trash is the last row of the Canvases panel AND is listed in Canvases › Advanced (06 › 5). Clear out asks first.
 *   · Version history: Compare / Restore this version (06's verbs). Restore brings back the WHOLE canvas as a new version;
 *     "Restore only this artboard" is the narrow one. Nothing after it is lost.
 *   · Search groups results by project once they come from 2+ projects; this tab first.
 *   · Canvases panel: Pinned, then the tree sorted by Recent (01's Recent block becomes this sort). Expanded canvas rows
 *     are the jump list for artboards; Layers lists what's inside one.
 *
 * Convention (same as 01 Create Flow): every app artboard is a <Stage> — a 1440 × 900 window with its note strip
 * underneath (artboard 1440 × 980). Close-ups (pn-ab, pn-tab-menu, pn-windows, pn-k-close, pn-cant-open) are V2 boards
 * with the note inside. Chrome comes from ./_kit; local pieces use the `pn-` prefix.
 *
 * Content: Alligators brand modelled on ~/Maude/alligators — 93 canvases (2026 16 · club-web 9 · print 6 ·
 * social 31 · legacy 27 · 4 at the root) and Combine-kampan's real 21 artboards (as in 08 Artboard Kinds).
 * Studio site: Homepage, Pricing, Onboarding, Mobile — detail. Local: Portfolio 2026 (02 Onboarding).
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./11 Projects and Navigation.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, Callout, Canvas, CommentPin, Dialog, GatorMock, HeroMock, Icon, Kbd, Mark, Menu, ModeSwitch, Note,
  PanelIcon, PhoneMock, PricingMock, ProjectPill, ShareCluster, Spark, Stage, Thumb, Toast, Toolbar, V2, Veil, ZoomUndo,
} from "./_kit";
import type { Art, Kind, MenuItem, Tone, Who } from "./_kit";

const W = 1440;
const H = 980;

/* ═══ Accounts — one form everywhere (plan: a profile = { label, email }, bound per project) ═══ */

type Acct = "personal" | "work";
const ACCT: Record<Acct, { ini: string; tone: Tone; label: string; email: string }> = {
  work: { ini: "W", tone: "sky", label: "Work", email: "you@work-studio.cz" },
  personal: { ini: "P", tone: "yellow", label: "Personal", email: "you@gmail.com" },
};
/** An account is a circle with its label's initial (W / P) — never the person's "M", so two accounts never look alike. */
function AcctFace({ acct, size = "sm" }: { acct: Acct; size?: "sm" | "md" | "lg" }) {
  const a = ACCT[acct];
  return <span className="pn-acctf" title={`${a.label} · ${a.email}`}><Avatar ini={a.ini} tone={a.tone} size={size} /></span>;
}

/** The project square — kit Avatar with the rounded-square treatment. */
function Sq({ ini, tone, size = "sm" }: { ini: string; tone: Tone; size?: "sm" | "md" | "lg" }) {
  return <span className="pn-sq"><Avatar ini={ini} tone={tone} size={size} /></span>;
}

/* ═══ Variant A — native macOS window tabs: ONLY what AppKit draws ═════════════════════════════
   Title text, close ×, +, the system » overflow (a plain menu of titles), the Mac's own right-click menu. */

/** The Mac's own right-click menu on a window tab. */
const MAC_TAB_MENU: MenuItem[] = [{ label: "Close Tab" }, { label: "Close Other Tabs" }, { label: "Move Tab to New Window" }, "sep", { label: "Show All Tabs" }];

function NativeWindow({
  tabs, active = 0, height = 900, children, label, more, moreOpen, ctx, ctxHl, style,
}: {
  tabs: string[]; active?: number; height?: number; children?: ReactNode; label?: string;
  /** tabs that don't fit — the system's » lists them by full title */
  more?: string[]; moreOpen?: boolean;
  /** index of the tab whose Mac right-click menu is open */
  ctx?: number; ctxHl?: string; style?: CSSProperties;
}) {
  const dense = tabs.length > 6;
  return (
    <div className="k-window pn-nw" role="img" aria-label={label ?? `Maude — ${tabs[active] ?? "Home"}`} style={{ height, ...style }}>
      <div className="k-titlebar">
        <span className="k-lights"><i /><i /><i /></span>
        <span className={`k-tabs pn-nt-tabs${dense ? " pn-nt-tabs--dense" : ""}`}>
          {tabs.map((t, i) => {
            const on = i === active;
            return (
              <span key={t + i} className="k-tab pn-nt" data-on={on ? "true" : undefined} data-menu={ctx === i ? "true" : undefined} title={t}>
                {on ? <span className="k-tab-x"><Icon name="close" size={10} /></span> : null}
                <span className="k-tab-name">{t}</span>
                {ctx === i ? <Menu items={MAC_TAB_MENU} highlight={ctxHl} width={220} style={{ left: 0, top: "calc(100% + var(--space-2))", zIndex: 30 }} /> : null}
              </span>
            );
          })}
        </span>
        {more ? (
          <span className="pn-nt-more" data-open={moreOpen ? "true" : undefined} title={`${more.length} more tabs`}>
            <span aria-hidden="true">»</span>
            {moreOpen ? <Menu items={more.map((l) => ({ label: l }))} width={210} style={{ left: "auto", right: 0, top: "calc(100% + var(--space-2))", zIndex: 30 }} /> : null}
          </span>
        ) : null}
        <span className="k-tab-add"><Icon name="plus" size={13} /></span>
      </div>
      <div className="k-body">{children}</div>
    </div>
  );
}

/** Variant A's project pill — the kit pill, plus a spark while AI works anywhere in this project. */
function PnPill({ project, canvas, ai, style }: { project: string; canvas?: string; ai?: string; style?: CSSProperties }) {
  return (
    <span className="island k-pill pn-pill" title="Project menu" style={style}>
      <span className="k-pill-mark"><Mark size={22} /></span>
      <span className="k-pill-txt">
        <span className="k-pill-name">{project}</span>
        {canvas ? (<><span className="k-pill-sep">/</span><span className="k-pill-canvas">{canvas}</span></>) : null}
        {ai ? <span className="pn-pill-ai motion-soft" title={ai}><Spark size={11} /></span> : null}
        <span className="k-caret"><Icon name="chevron" size={14} /></span>
      </span>
    </span>
  );
}

/** Variant A's Share cluster — the kit cluster (faces · status · Edit/Preview/Present · panels · Share) with the
 *  project's account first. The account chip shows only when this Mac has two or more accounts. */
function PnCluster({ acct, people = ["tereza", "jonas"], open = false, viewing = false, style }: { acct?: Acct; people?: Who[]; open?: boolean; /** looking at a past version: the mode switch shows the non-editing state (CONTRACT §7) */ viewing?: boolean; style?: CSSProperties }) {
  return (
    <div className="island k-tr pn-tr" style={style}>
      {acct ? (
        <>
          <span className="pn-me" data-open={open ? "true" : undefined} title={`${ACCT[acct].label} · ${ACCT[acct].email}`}>
            <AcctFace acct={acct} size="md" /><span>{ACCT[acct].label}</span><Icon name="chevron" size={12} />
          </span>
          <span className="pn-tr-div" />
        </>
      ) : null}
      {people.length ? <span className="k-faces">{people.map((p) => <Avatar key={String(p)} who={p} />)}</span> : null}
      <span className="k-saved"><Icon name="cloud" size={16} />Saved</span>
      <ModeSwitch mode={viewing ? "viewing" : "edit"} canEdit={!viewing} />
      <span className="icon-btn" title="Hide panels ⌘\"><Icon name="panel-right" /></span>
      <span className="btn btn--primary"><Icon name="share" size={14} />Share</span>
    </div>
  );
}

/** A Mac notification — how Variant A tells you about AI in a tab you left. Drawn as the OS draws it. */
function MacNote({ title, body, style }: { title: ReactNode; body: ReactNode; style?: CSSProperties }) {
  return (
    <span className="pn-macnote" style={style}>
      <span className="pn-macnote-ic"><Mark size={30} /></span>
      <span className="pn-macnote-t"><strong>{title}</strong><span>{body}</span></span>
      <span className="pn-macnote-time">now</span>
    </span>
  );
}

/* ═══ Variant B — a Figma-style strip drawn by Maude ══════════════════════════════════════ */

type PTab = {
  name: string; ini?: string; tone?: Tone; home?: boolean; local?: boolean;
  /** a second account's face — the main account wears none */
  acct?: Acct;
  /** AI state in that tab: a spark while working, an azure "?" when it needs you */
  ai?: "working" | "needs";
  /** resting: the project's server is stopped; the tab wakes it when opened (plan amendment) */
  rest?: boolean;
  /** where it lives — shown in the overflow list */
  where?: string;
};
const T_HOME: PTab = { name: "Home", home: true };
const T_STUDIO: PTab = { name: "Studio site", ini: "S", tone: "yellow", where: "Studio team · cloud" };
const T_GATOR: PTab = { name: "Alligators brand", ini: "A", tone: "lilac", acct: "work", where: "Alligators · cloud" };
const T_PORT: PTab = { name: "Portfolio 2026", ini: "P", tone: "sky", local: true, where: "~/Desktop/Portfolio 2026 · this Mac" };

/** CONTRACT §6 — right-click a project tab (Variant B can draw it as written). */
const TAB_MENU: MenuItem[] = [{ label: "Rename…" }, { label: "Move to a new window" }, { label: "Sign in as another account…" }, "sep", { label: "Close tab" }];

function BTab({ t, on, dense, tip, menu, menuHl }: { t: PTab; on: boolean; dense: boolean; tip?: ReactNode; menu?: boolean; menuHl?: string }) {
  return (
    <span className={`k-tab pn-tab${t.home ? " pn-tab--home" : ""}${dense && !on && !t.home ? " pn-tab--dense" : ""}${dense && on ? " pn-tab--wide" : ""}`} data-on={on ? "true" : undefined} data-menu={menu ? "true" : undefined} title={t.rest ? `${t.name} — resting, opens in a second` : t.name}>
      {on && !t.home ? <span className="k-tab-x"><Icon name="close" size={10} /></span> : null}
      {t.home ? <span className="k-tab-home"><Icon name="home" size={14} /></span> : <Avatar ini={t.ini ?? t.name.slice(0, 1)} tone={t.tone ?? "sky"} size="sm" />}
      {t.home ? null : <span className="k-tab-name">{t.name}</span>}
      {t.local && !dense ? <span className="k-tab-st" title="Local project"><Icon name="laptop" size={11} /></span> : null}
      {t.acct && !(dense && !on) ? <AcctFace acct={t.acct} /> : null}
      {t.ai === "working" ? <span className="pn-tab-ai motion-soft" title="AI is working"><Spark size={11} /></span> : null}
      {t.ai === "needs" ? <span className="pn-tab-q" title="AI needs you">?</span> : null}
      {t.rest ? <span className="pn-tab-rest" /> : null}
      {menu ? <Menu items={TAB_MENU} highlight={menuHl} width={236} style={{ left: 0, top: "calc(100% + var(--space-2))", zIndex: 30 }} /> : null}
      {tip ? <span className="k-tip pn-tabtip">{tip}</span> : null}
    </span>
  );
}

/** The "N more" list: full names, where each lives, its account and its state. */
function BMore({ tabs }: { tabs: PTab[] }) {
  return (
    <div className="k-menu pn-bmore">
      <span className="k-find pn-bmore-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Find a tab</span></span>
      {tabs.map((t) => (
        <span className="row-item pn-bmore-r" key={t.name}>
          <Sq ini={t.ini ?? t.name.slice(0, 1)} tone={t.tone ?? "sky"} size="md" />
          <span className="pn-bmore-t"><strong>{t.name}</strong><span>{t.where}</span></span>
          {t.acct ? <AcctFace acct={t.acct} /> : null}
          {t.ai === "working" ? <span className="chip chip--spark"><Spark size={9} />AI working</span> : t.ai === "needs" ? <span className="chip">Needs you</span> : t.rest ? <span className="pn-bmore-st"><span className="pn-tab-rest" />Resting</span> : null}
        </span>
      ))}
    </div>
  );
}

function PnWindow({
  tabs, active = 0, height = 900, children, tabTip, plusTip, tabMenu, menuHl, label, style, more, moreOpen,
}: {
  tabs: PTab[]; active?: number; height?: number; children?: ReactNode; tabTip?: { i: number; text: ReactNode }; plusTip?: ReactNode;
  tabMenu?: number; menuHl?: string; label?: string; style?: CSSProperties; more?: PTab[]; moreOpen?: boolean;
}) {
  const dense = !!more || tabs.length > 6;
  return (
    <div className="k-window pn-win" role="img" aria-label={label ?? `Maude — ${tabs[active]?.name ?? "Home"}`} style={{ height, ...style }}>
      <div className="k-titlebar">
        <span className="k-lights"><i /><i /><i /></span>
        <span className="k-tabs pn-btabs">
          {tabs.map((t, i) => <BTab key={t.name + i} t={t} on={i === active} dense={dense} tip={tabTip?.i === i ? tabTip.text : undefined} menu={tabMenu === i} menuHl={menuHl} />)}
        </span>
        {more ? (
          <span className="pn-more" data-open={moreOpen ? "true" : undefined}>
            {more.length} more<Icon name="chevron" size={12} />
            {moreOpen ? <BMore tabs={more} /> : null}
          </span>
        ) : null}
        <span className="k-tab-add pn-add">
          <Icon name="plus" size={13} />
          {plusTip ? <span className="k-tip pn-tabtip pn-tabtip--end">{plusTip}</span> : null}
        </span>
      </div>
      <div className="k-body">{children}</div>
    </div>
  );
}

/* ═══ Twenty projects (the same 19 projects + Home in both variants) ═════════════════════════
   Running (≤ 5, plan T6): Studio site, Alligators brand, Open studio, Matchday 2026, Newsletter. The rest rest. */
const P20: PTab[] = [
  T_STUDIO,
  { ...T_GATOR },
  { name: "Open studio", ini: "O", tone: "coral", ai: "needs", where: "Studio team · cloud" },
  { name: "Matchday 2026", ini: "M", tone: "green", ai: "working", where: "Alligators · cloud", acct: "work" },
  { name: "Trenérský manuál", ini: "T", tone: "green", rest: true, where: "~/Maude/Trenérský manuál · this Mac" },
  { ...T_PORT, rest: true },
  { name: "Kavárna Na Rohu", ini: "K", tone: "coral", rest: true, where: "hub.studio-brno.cz · the studio's own hub" },
  { name: "Svatba K + T", ini: "S", tone: "lilac", rest: true, where: "~/Maude/Svatba K + T · this Mac" },
  { name: "Juniors camp", ini: "J", tone: "yellow", rest: true, where: "Alligators · cloud", acct: "work" },
  { name: "Sponzoři 2027", ini: "S", tone: "sky", rest: true, where: "Alligators · cloud", acct: "work" },
  { name: "Fakultní web", ini: "F", tone: "grey", rest: true, where: "~/Maude/Fakultní web · this Mac" },
  { name: "Výroční zpráva", ini: "V", tone: "yellow", rest: true, where: "~/Maude/Výroční zpráva · this Mac" },
  { name: "Newsletter", ini: "N", tone: "sky", where: "Studio team · cloud" },
  { name: "Moodboard léto", ini: "M", tone: "coral", rest: true, where: "~/Desktop/Moodboard léto · this Mac" },
  { name: "Brand audit", ini: "B", tone: "lilac", rest: true, where: "Studio team · cloud" },
  { name: "Pitch deck", ini: "P", tone: "green", rest: true, where: "~/Maude/Pitch deck · this Mac" },
  { name: "Plakáty Combine", ini: "P", tone: "lilac", rest: true, where: "Alligators · cloud", acct: "work" },
  { name: "E-shop vouchery", ini: "E", tone: "yellow", rest: true, where: "~/Maude/E-shop vouchery · this Mac" },
  { name: "Klub web 2027", ini: "K", tone: "green", rest: true, where: "Alligators · cloud", acct: "work" },
];
/** Variant A: 19 projects + the Home tab at the end (where it was opened); 12 fit, » lists 8. */
const A20 = [...P20.map((t) => t.name), "Home"];
const A20_VIS = A20.slice(0, 12);
const A20_MORE = A20.slice(12);
/** Variant B: Home pinned first + 9 tabs; "10 more" lists the rest (with folder, account and state). */
const B20_VIS: PTab[] = [T_HOME, ...P20.slice(0, 9)];
const B20_MORE: PTab[] = P20.slice(9);

/* ═══ Content: Alligators brand (93) and Studio site (4) ═══════════════════════════════════ */

/** Combine-kampan's real artboards (08 Artboard Kinds) — FB covers 1920 × 1005, IG posts 1080 × 1350,
 *  stories 1080 × 1920 — drawn at `z` (0.2 = 20 %). */
type KB = { label: string; kind: Kind; w: number; h: number; body: ReactNode };
const KB_FB_A: KB = { label: "FB event cover · FB Event · 1.91:1", kind: "digital", w: 1920, h: 1005, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="CESA VUT · 9:00" /> };
const KB_FB_B: KB = { label: "FB event cover · varianta B, datum vpředu", kind: "digital", w: 1920, h: 1005, body: <GatorMock variant="web" headline="ST 1. 10. · 9:00" sub="Combine 2026" /> };
const KB_IG: KB = { label: "Oznámení události · Instagram · IG Post · 4:5", kind: "digital", w: 1080, h: 1350, body: <GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT" /> };
const KB_POST: KB = { label: "Pozvánka na combine · IG Post · 4:5", kind: "digital", w: 1080, h: 1350, body: <GatorMock variant="social" headline="COMBINE 2026" sub="1. 10." /> };
const KB_HOST: KB = { label: "Obálka videosérie · pozvánka od hosta · IG Story · 9:16", kind: "digital", w: 1080, h: 1920, body: <GatorMock variant="reel" headline="HOST ZE ZÁMOŘÍ" sub="díl 1 ze 6" /> };
const KB_STORY: KB = { label: "Pozvánka · story · IG Story · 9:16", kind: "digital", w: 1080, h: 1920, body: <GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 9." /> };
const KB_STORY_TYPO: KB = { ...KB_STORY, body: <GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 6." /> };
const KB_STORY2: KB = { label: "Zítra se měří · countdown story · IG Story · 9:16", kind: "digital", w: 1080, h: 1920, body: <GatorMock variant="reel" headline="ZÍTRA" sub="9:00" /> };

function KAb({ b, x, y, z, selected, dim }: { b: KB; x: number; y: number; z: number; selected?: boolean; dim?: boolean }) {
  return <Artboard label={b.label} kind={b.kind} x={x} y={y} w={Math.round(b.w * z)} h={Math.round(b.h * z)} selected={selected} size={selected ? `${b.w} × ${b.h}` : undefined} dim={dim}>{b.body}</Artboard>;
}

/** Combine-kampan at 20 %, framed for a window with the Canvases panel open on the left. */
function Kampan({ dim = false, dx = 0 }: { dim?: boolean; dx?: number }) {
  const z = 0.2;
  return (
    <>
      <KAb b={KB_FB_A} x={340 + dx} y={96} z={z} dim={dim} />
      <KAb b={KB_FB_B} x={746 + dx} y={96} z={z} dim={dim} />
      <KAb b={KB_IG} x={1152 + dx} y={96} z={z} dim={dim} />
      <KAb b={KB_POST} x={340 + dx} y={392} z={z} dim={dim} />
      <KAb b={KB_HOST} x={578 + dx} y={392} z={z} dim={dim} />
      <KAb b={KB_STORY} x={816 + dx} y={392} z={z} dim={dim} />
      <KAb b={KB_STORY2} x={1054 + dx} y={392} z={z} dim={dim} />
    </>
  );
}

/** The 21 artboards of Combine-kampan, in canvas order (08 Artboard Kinds). */
const KAMPAN_21: [string, Kind][] = [
  ["Release plan · Combine 2026 (4 týdny)", "digital"],
  ["FB event cover · FB Event · 1.91:1", "digital"],
  ["FB event cover · varianta B, datum vpředu", "digital"],
  ["FB event cover · varianta C, žlutá", "digital"],
  ["FB event cover · kontrola safe zóny (nenahrávat)", "digital"],
  ["Oznámení události · Instagram · IG Post · 4:5", "digital"],
  ["Carousel cover · sedm disciplín · IG Post · 4:5", "digital"],
  ["Slide 01 · 40 YARD DASH · IG Post · 4:5", "digital"],
  ["Slide 02 · BENCH PRESS · IG Post · 4:5", "digital"],
  ["Slide 03 · VERTICAL JUMP · IG Post · 4:5", "digital"],
  ["Slide 04 · BROAD JUMP · IG Post · 4:5", "digital"],
  ["Slide 05 · 3-CONE DRILL · IG Post · 4:5", "digital"],
  ["Slide 06 · 20-YARD SHUTTLE · IG Post · 4:5", "digital"],
  ["Slide 07 · POSITION DRILLS · IG Post · 4:5", "digital"],
  ["Přehled všech sedmi · IG Post · 4:5", "digital"],
  ["Pozvánka na combine · IG Post · 4:5", "digital"],
  ["Obálka videosérie · pozvánka od hosta · IG Story · 9:16", "digital"],
  ["Pozvánka · story · IG Story · 9:16", "digital"],
  ["Zítra se měří · countdown story · IG Story · 9:16", "digital"],
  ["Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm", "print"],
  ["Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm", "print"],
];

/** Studio site, the simple project, at 50 %. */
function StudioView() {
  return (
    <>
      <Artboard label="Homepage" kind="web" x={300} y={120} w={520} h={325}><HeroMock /></Artboard>
      <Artboard label="Pricing" kind="web" x={860} y={120} w={300} h={325}><PricingMock /></Artboard>
      <Artboard label="Mobile" kind="web" x={300} y={500} w={150} h={300}><PhoneMock title="Calm software" tone="sky" /></Artboard>
    </>
  );
}

/* ─── Uniformy-2027 (2026/dresy) — the jerseys, with a helmet and trousers drawn locally ─── */
function Helmet({ side = true }: { side?: boolean }) {
  return (
    <div className="k-mk pn-helm">
      <span className="pn-helm-shell" /><span className="pn-helm-mask" /><span className="pn-helm-logo" />
      <span className="pn-mk-cap">{side ? "Helma z boku" : "Helma zepředu"}</span>
    </div>
  );
}
function Pants({ away = false }: { away?: boolean }) {
  return (
    <div className={`k-mk pn-pants${away ? " pn-pants--away" : ""}`}>
      <span className="pn-pants-l" /><span className="pn-pants-r" /><span className="pn-pants-belt" />
      <span className="pn-mk-cap">{away ? "Kalhoty venku" : "Kalhoty doma"}</span>
    </div>
  );
}
/** One jersey. `away` = the away kit; `v` = which version of it (history). */
function Jersey({ away = false, v = "now" }: { away?: boolean; v?: "now" | "approved" }) {
  return (
    <div className={`pn-jersey${away ? " pn-jersey--away" : ""}${v === "approved" ? " pn-jersey--old" : ""}`}>
      <GatorMock variant="jersey" headline={away ? "Venkovní dres 2027" : "Domácí dres 2027"} />
    </div>
  );
}

/* ═══ The organised Canvases panel (kit CanvasesPanel markup + pins, sort, drag, Trash, artboards) ═══ */

function PnPanel({ children, foot, width = 264, find, style }: { children: ReactNode; foot?: ReactNode; width?: number; find?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="island k-cp pn-cp" style={{ width, ...style }}>
      <div className="k-cp-hd">
        <span className="seg k-seg"><span className="k-seg-b" aria-pressed="true">Canvases</span><span className="k-seg-b" aria-pressed="false">Layers</span><span className="k-seg-b" aria-pressed="false">Assets</span></span>
        <span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span>
      </div>
      {find ?? <span className="k-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Search</span><Kbd>⌘K</Kbd></span>}
      <div className="k-cp-list">{children}</div>
      {foot ? <p className="k-cp-foot">{foot}</p> : null}
    </div>
  );
}

const pad = (depth: number, base = "var(--space-2)") => ({ paddingLeft: `calc(${base} + ${depth} * var(--space-4))` });

function PRow({
  name, art = "blank", depth = 0, current, pinned, hover, kinds, meta, ghost, people, ai, expand, sub, local, actions,
}: {
  name: string; art?: Art; depth?: number; current?: boolean; pinned?: boolean; hover?: boolean; kinds?: Kind[]; meta?: ReactNode;
  ghost?: boolean; people?: Who[]; ai?: boolean; expand?: "closed" | "open"; sub?: ReactNode; local?: boolean;
  /** replaces the hover buttons (e.g. Restore in Trash) */
  actions?: ReactNode;
}) {
  return (
    <span className={`row-item k-cp-row pn-row${ghost ? " pn-row--ghost" : ""}${hover ? " pn-row--hover" : ""}${sub ? " k-cp-row--two" : ""}`} aria-current={current ? "true" : undefined} style={pad(depth, expand ? "var(--space-1)" : "var(--space-2)")} title={name}>
      {expand ? <span className="k-cp-tw pn-tw" data-open={expand === "open" ? "true" : undefined}><Icon name="submenu" size={12} /></span> : null}
      <Thumb art={art} className="k-thumb--row" />
      {sub ? <span className="k-cp-two"><span className="k-cp-name">{name}</span><span className="k-cp-sub">{sub}</span></span> : <span className="k-cp-name">{name}</span>}
      <span className="k-cp-badges">
        {ai ? <span className="k-cp-ai motion-soft" title="AI is working"><Spark size={11} /></span> : null}
        {people?.length ? <span className="k-faces k-faces--sm">{people.map((p) => <Avatar key={String(p)} who={p} size="sm" />)}</span> : null}
        {kinds?.map((k) => <span key={k} className="k-kind"><Icon name={k} size={11} /></span>)}
        {local ? <span className="k-cp-local"><Icon name="laptop" size={12} /></span> : null}
        {pinned && !hover ? <span className="pn-pin" title="Pinned"><Icon name="pin" size={12} /></span> : null}
        {meta ? <span className="k-cp-meta">{meta}</span> : null}
        {actions ? <span className="pn-rowact">{actions}</span> : hover ? (
          <>
            <span className="pn-rowbtn" data-on={pinned ? "true" : undefined} title={pinned ? "Unpin" : "Pin"}><Icon name="pin" size={12} /></span>
            <span className="pn-rowbtn" title="More"><Icon name="more" size={12} /></span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function FRow({ name, count, open, depth = 0, drop, dropTag }: { name: string; count?: number; open?: boolean; depth?: number; drop?: boolean; dropTag?: string }) {
  return (
    <span className={`row-item k-cp-folder${drop ? " pn-fold--drop" : ""}`} data-open={open ? "true" : undefined} style={pad(depth, "var(--space-1)")}>
      <span className="k-cp-tw"><Icon name="submenu" size={12} /></span>
      <span className="k-cp-fic"><Icon name="folder" size={14} /></span>
      <span className="k-cp-name">{name}</span>
      {count !== undefined ? <span className="k-cp-count">{count}</span> : null}
      {dropTag ? <span className="pn-droptag">{dropTag}</span> : null}
    </span>
  );
}

function ABRow({ label, kind, depth = 1, current, meta }: { label: string; kind: Kind; depth?: number; current?: boolean; meta?: ReactNode }) {
  return (
    <span className="row-item pn-ab" aria-current={current ? "true" : undefined} style={pad(depth)} title={label}>
      <span className="pn-ab-k"><Icon name={kind} size={12} /></span>
      <span className="k-cp-name">{label}</span>
      {meta ? <span className="k-cp-meta">{meta}</span> : null}
    </span>
  );
}

function TrashRow({ count, on }: { count: number; on?: boolean }) {
  return (
    <span className="row-item pn-trashrow" aria-current={on ? "true" : undefined}>
      <span className="pn-trashrow-ic"><Icon name="trash" size={14} /></span>
      <span className="k-cp-name">Trash</span>
      <span className="k-cp-count">{count}</span>
    </span>
  );
}

const T = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => <p className="island-title k-cp-t">{children}{aside ? <span className="k-cp-tc">{aside}</span> : null}</p>;

/** The tree as it is — 2026 open on combine, the rest folded, the four leftovers at the root. */
function GatorTree({ dragging = false, combineOpen = true, kampanCurrent = true }: { dragging?: boolean; combineOpen?: boolean; kampanCurrent?: boolean }) {
  return (
    <>
      <FRow name="2026" count={16} open />
      <FRow name="combine" count={6} open={combineOpen} depth={1} />
      {combineOpen ? (
        <>
          <PRow name="Combine-kampan" art="gator-poster" depth={2} current={kampanCurrent} pinned people={["tereza"]} />
          <PRow name="Combine-kampan — varianta pro partnery a sponzory" art="gator-web" depth={2} />
          <PRow name="Combine-letak-registrace" art="gator-print" depth={2} kinds={["print"]} />
          <PRow name="Combine-invite" art="gator-social" depth={2} />
          <PRow name="Combine-cisla" art="gator-numbers" depth={2} />
          <PRow name="Combine-video-AI" art="video" depth={2} ai kinds={["video"]} />
        </>
      ) : null}
      <FRow name="dresy" count={4} depth={1} />
      <FRow name="social" count={6} depth={1} />
      <FRow name="club-web" count={9} />
      <FRow name="print" count={6} />
      <FRow name="social" count={31} />
      <FRow name="legacy" count={27} drop={dragging} dropTag={dragging ? "Move here" : undefined} />
      <PRow name="test" />
      <PRow name="Test2" />
      <PRow name="ahoj" />
      <PRow name="ahoj2" art="board" ghost={dragging} />
    </>
  );
}

/* ═══ Search — kit SearchPalette markup, accent- and word-order-insensitive marks, project groups ═══ */

/** Fold to a comparable form: lower-case, no diacritics, one char per char (keeps indices aligned). */
const fold = (t: string) => Array.from(t).map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().slice(0, 1) || c).join("");
/** Marks every word of `words` in `text`, ignoring accents ("letak" marks "Leták"). */
function marks(text: string, words: string[]): ReactNode {
  const f = fold(text);
  const hit = new Array(text.length).fill(false);
  for (const w of words.map((x) => fold(x.trim())).filter(Boolean)) {
    let at = f.indexOf(w);
    while (at >= 0) { for (let i = at; i < at + w.length; i++) hit[i] = true; at = f.indexOf(w, at + w.length); }
  }
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && hit[j] === hit[i]) j++;
    out.push(hit[i] ? <mark className="k-mark" key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return out;
}

type PRowData = { label: string; art?: Art; icon?: string; kind?: Kind; sq?: [string, Tone]; meta?: string; where?: string; via?: string; sel?: boolean; hint?: ReactNode; words?: string[]; quiet?: boolean;
  /** words to mark in the meta line too — a match through the parent canvas shows where it matched */
  metaWords?: string[] };
type PGroup = { title: ReactNode; sq?: [string, Tone]; aside?: ReactNode; rows: PRowData[] };

function PnPalette({ query, groups, foot, note, style, empty }: { query: string; groups: PGroup[]; foot?: ReactNode; note?: ReactNode; style?: CSSProperties; empty?: boolean }) {
  const words = query.split(/\s+/).filter(Boolean);
  return (
    <div className="k-pal pn-pal" style={style}>
      <span className="k-pal-field"><Icon name="search" size={18} /><span className="k-pal-typed">{query || <span className="k-pal-ph">Search canvases, artboards, actions, or ask AI…</span>}{query ? <i className="k-caretline k-caretline--lg" /> : null}</span><Kbd>esc</Kbd></span>
      <div className="k-pal-res">
        {note ? <p className="pn-pal-note"><Icon name="search" size={12} /><span>{note}</span></p> : null}
        {groups.map((g, gi) => (
          <div key={gi}>
            <p className="island-title k-pal-gt">{g.sq ? <Sq ini={g.sq[0]} tone={g.sq[1]} /> : null}{g.title}{g.aside ? <span className="k-pal-aside">{g.aside}</span> : null}</p>
            {g.rows.map((r, ri) => (
              <span className={`k-pal-row${r.quiet ? " pn-pal-quiet" : ""}`} data-sel={r.sel ? "true" : undefined} key={ri}>
                {r.art ? <Thumb art={r.art} className="k-thumb--pal" /> : r.sq ? <span className="pn-pal-sq"><Sq ini={r.sq[0]} tone={r.sq[1]} size="md" /></span> : <span className="k-pal-ic">{r.kind ? <Icon name={r.kind} size={14} /> : <Icon name={r.icon ?? "search"} />}</span>}
                <span className="k-pal-label"><span className="k-pal-ltxt">{empty ? r.label : marks(r.label, r.words ?? words)}</span>{r.via ? <span className="k-pal-via">matches “{r.via}”</span> : null}{r.meta ? <span className="k-pal-meta">{r.metaWords && !empty ? marks(r.meta, r.metaWords) : r.meta}</span> : null}</span>
                {r.where ? <span className="chip">{r.where}</span> : null}
                {r.hint ? <span className="pn-pal-hint">{r.hint}</span> : null}
              </span>
            ))}
          </div>
        ))}
        <div className="k-pal-ask">
          <span className="k-pal-row">
            <span className="k-pal-ic k-pal-ic--spark"><Spark size={12} color="var(--spark-fg)" /></span>
            <span className="k-pal-label">Ask AI<span className="k-pal-meta"> — {query ? `find “${query}” by what it looks like` : "describe what you want on the canvas"}</span></span>
            <span className="k-keys"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          </span>
        </div>
      </div>
      <div className="k-pal-foot">
        <span className="k-pal-hints"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span></span>
        <span>{foot}</span>
      </div>
    </div>
  );
}

/* ═══ Home, scrolled — pinned, recent across projects, shared with you, every project by account ═══ */

type HCard = { name: string; art: Art; proj: [string, Tone, string]; meta: string; ai?: boolean; who?: Who[] };
/* Line 1 = the project (square + name, truncates first); line 2 = folder · time. */
const RECENT: HCard[] = [
  { name: "Uniformy-2027", art: "gator-jersey", proj: ["A", "lilac", "Alligators brand"], meta: "2026/dresy · 5 min ago", who: ["jonas"] },
  { name: "Homepage", art: "home", proj: ["S", "yellow", "Studio site"], meta: "20 min ago", who: ["tereza"] },
  { name: "Combine-kampan", art: "gator-poster", proj: ["A", "lilac", "Alligators brand"], meta: "2026/combine · 1 h ago", ai: true },
  { name: "Mobilní app — case study", art: "mobile", proj: ["P", "sky", "Portfolio 2026"], meta: "yesterday" },
  { name: "matchday", art: "gator-social", proj: ["A", "lilac", "Alligators brand"], meta: "social · yesterday" },
  { name: "Pricing", art: "price", proj: ["S", "yellow", "Studio site"], meta: "Monday", who: ["tereza", "jonas"] },
];

type HProj = { name: string; sq: [string, Tone]; meta: string; arts: [Art, Art, Art]; state?: "tab" | "mac" | "cloud" };
const PROJ_WORK: HProj[] = [
  { name: "Alligators brand", sq: ["A", "lilac"], meta: "93 canvases", arts: ["gator-poster", "gator-web", "gator-reel"], state: "tab" },
  { name: "Sponzoři 2027", sq: ["S", "sky"], meta: "8 canvases", arts: ["gator-numbers", "gator-print", "gator-social"], state: "tab" },
  { name: "Nábor 2027", sq: ["N", "green"], meta: "Tereza's · 6 canvases", arts: ["gator-web", "admin", "flow"], state: "cloud" },
];
const PROJ_PERSONAL: HProj[] = [
  { name: "Studio site", sq: ["S", "yellow"], meta: "4 canvases", arts: ["home", "price", "mobile"], state: "tab" },
  { name: "Portfolio 2026", sq: ["P", "sky"], meta: "12 canvases", arts: ["mobile", "brand", "moodboard"], state: "mac" },
];
const STATE_WORD: Record<NonNullable<HProj["state"]>, ReactNode> = {
  tab: "in a tab",
  mac: <><Icon name="laptop" size={12} />this Mac only</>,
  cloud: <><Icon name="cloud" size={12} />not on this Mac yet</>,
};

function ProjRow({ p }: { p: HProj }) {
  return (
    <span className={`row-item pn-prow${p.state === "cloud" ? " pn-prow--cloud" : ""}`}>
      <Thumb art={p.arts[0]} className="pn-prow-thumb" />
      <span className="pn-prow-t"><strong>{p.name}</strong><span>{p.meta} · {STATE_WORD[p.state ?? "tab"]}</span></span>
      {p.state === "cloud" ? <span className="btn btn--sm">Open</span> : null}
      <Sq ini={p.sq[0]} tone={p.sq[1]} />
    </span>
  );
}

function PnHome({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`k-home-bg pn-home-bg${dim ? " pn-dim" : ""}`}>
      <ProjectPill project="Home" home />
      <div className="island k-home-tr"><span className="icon-btn"><Icon name="search" /></span><Kbd>⌘K</Kbd></div>
      <div className="pn-home">
        {/* The question scrolled away with the page (it never shrinks — CONTRACT §5); the bar keeps both ways in. */}
        <div className="pn-askrow">
          <div className="island pn-askbar">
            <div className="ask pn-ask">
              <span className="pn-askbar-spark"><Spark size={16} /></span>
              <span className="pn-askbar-ph">Ask AI for a new canvas…</span>
              <span className="chip">in <strong>Studio site</strong><Icon name="chevron" size={12} /></span>
              <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
            </div>
          </div>
          <span className="btn btn--ghost btn--sm k-home-empty pn-empty">Start with an empty canvas <Kbd>⌘N</Kbd></span>
        </div>

        <div className="pn-sec">
          <p className="pn-h">Pinned<span className="pn-h-aside">pin any canvas from its row or its menu</span></p>
          <div className="pn-pins">
            {([["Combine-kampan", "gator-poster", ["A", "lilac"], "Alligators brand · 2026/combine"], ["Uniformy-2027", "gator-jersey", ["A", "lilac"], "Alligators brand · 2026/dresy"], ["Homepage", "home", ["S", "yellow"], "Studio site"], ["LetakA6", "gator-print", ["A", "lilac"], "Alligators brand · print"]] as [string, Art, [string, Tone], string][]).map(([n, a, p, m]) => (
              <span className="pn-pincard" key={n}><Thumb art={a} className="pn-thumb-pin" /><span className="pn-pincard-t"><strong>{n}</strong><span><Sq ini={p[0]} tone={p[1]} />{m}</span></span></span>
            ))}
          </div>
        </div>

        <div className="pn-sec">
          <p className="pn-h">Recent canvases
            <span className="pn-h-right"><span className="chip pn-filter">All projects<Icon name="chevron" size={12} /></span><span className="btn btn--ghost btn--sm">See all</span></span>
          </p>
          <div className="pn-cards">
            {RECENT.map((c) => (
              <span className="k-card pn-card" key={c.name}>
                <span className="k-card-pic"><Thumb art={c.art} className="pn-thumb-card" />{c.ai ? <span className="chip chip--spark k-card-ai"><Spark size={9} />Made by AI</span> : null}</span>
                <strong>{c.name}</strong>
                <span className="k-card-meta pn-card-proj"><Sq ini={c.proj[0]} tone={c.proj[1]} /><span>{c.proj[2]}</span></span>
                <span className="k-card-meta pn-card-meta">{c.meta}</span>
                {c.who ? <span className="k-card-faces">{c.who.map((w) => <Avatar key={String(w)} who={w} size="sm" />)}</span> : null}
              </span>
            ))}
          </div>
        </div>

        <div className="pn-two">
          <div className="pn-sec">
            <p className="pn-h">Shared with you<span className="pn-h-aside">canvases from other people's projects · 3 new this week</span></p>
            <div className="island pn-shared">
              {([
                ["Rozpis-zápasů", "gator-numbers", "jonas", "Liga ČAAF 2027 · Jonas's · 1 h ago", ["L", "green"], "Can edit"],
                ["Plakát-finále", "gator-poster", "tereza", "Pražský pohár · Tereza's · yesterday", ["P", "coral"], "Can comment"],
                ["Mapa-areálu", "gator-web", "tereza", "Pražský pohár · Tereza's · Monday", ["P", "coral"], "Can view"],
              ] as [string, Art, string, string, [string, Tone], string][]).map(([n, a, who, m, p, role]) => (
                <span className="row-item pn-shrow" key={n}>
                  <Thumb art={a} className="pn-thumb-sh" />
                  <span className="pn-shrow-t"><strong>{n}</strong><span><Avatar who={who} size="sm" />{m}</span></span>
                  <Sq ini={p[0]} tone={p[1]} />
                  <span className="chip">{role}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="pn-sec">
            <p className="pn-h">Projects<span className="pn-h-aside">20 projects</span>
              <span className="pn-h-right"><span className="k-find pn-pfind"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Find a project</span></span><span className="pn-sort">Recent<Icon name="chevron" size={11} /></span></span>
            </p>
            <div className="island pn-projlist">
              <p className="pn-acct-h"><AcctFace acct="work" />Work · you@work-studio.cz</p>
              {PROJ_WORK.map((p) => <ProjRow key={p.name} p={p} />)}
              <p className="pn-acct-h"><AcctFace acct="personal" />Personal · you@gmail.com</p>
              {PROJ_PERSONAL.map((p) => <ProjRow key={p.name} p={p} />)}
              <span className="pn-projmore"><span>15 more</span><span className="pn-projopen"><Icon name="folder" size={14} />Open project…<Kbd>⌘O</Kbd></span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Version history — pictures, who, named versions ═══════════════════════════════════ */

/** tv = how that version's picture differs (the jersey's colour, the helmet) — so each row shows its own state. */
type VRow = { title: string; sub: string; art: Art; tv?: "ink" | "white" | "helm" | "big"; who?: Who; ai?: boolean; named?: boolean; sel?: boolean; mark?: "A" | "B"; restored?: boolean };
function HistoryPanel({ rows, acts, foot, style }: { rows: { group: string; rows: VRow[] }[]; acts?: ReactNode; foot?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="island island--pad pn-vh" style={style}>
      <div className="pn-vh-hd"><Icon name="history" size={14} /><strong>Version history</strong><Kbd>⌥⌘H</Kbd><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
      <span className="seg k-in-seg pn-vh-seg"><span className="k-seg-b" aria-pressed="true">All</span><span className="k-seg-b">Named</span><span className="k-seg-b">Made by AI</span><span className="k-seg-b">People</span></span>
      <div className="pn-vh-list">
        <span className="row-item pn-vh-row pn-vh-now"><span className="pn-vh-dot" /><span className="pn-vh-t"><strong>Now</strong><span>Uniformy-2027 · Saved</span></span><span className="btn btn--ghost btn--sm">Name this version…</span></span>
        {rows.map((g) => (
          <div key={g.group} className="pn-vh-g">
            <p className="pn-vh-gt">{g.group}</p>
            {g.rows.map((r) => (
              <div key={r.title + r.sub}>
                <span className={`row-item pn-vh-row${r.named ? " pn-vh-row--named" : ""}`} aria-current={r.sel ? "true" : undefined}>
                  {r.mark ? <span className="pn-vh-mark">{r.mark}</span> : null}
                  <Thumb art={r.art} className={`pn-thumb-vh${r.tv ? ` pn-tv--${r.tv}` : ""}`} />
                  <span className="pn-vh-t">
                    <strong>{r.title}</strong>
                    <span>{r.ai ? <span className="pn-vh-ai"><Spark size={10} /></span> : r.who ? <Avatar who={r.who} size="sm" /> : null}{r.sub}</span>
                  </span>
                  {r.named ? <span className="chip">Named</span> : r.ai ? <span className="chip chip--spark">Made by AI</span> : r.restored ? <span className="chip">Restored</span> : null}
                </span>
                {r.sel && acts ? <span className="pn-vh-acts">{acts}</span> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {foot}
    </div>
  );
}

/** The panel's Advanced fold, closed — the git lives here (06 Advanced › 10). */
function AdvFold({ hint }: { hint: string }) {
  return (
    <div className="k-adv pn-adv">
      <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{hint}</span></span>
    </div>
  );
}

/* ═══ Close-up frame + small windows ═══════════════════════════════════════════════════════ */

function Closeup({ title, sub, note, children, theme = "light", className = "" }: { title: ReactNode; sub?: ReactNode; note: ReactNode; children: ReactNode; theme?: "light" | "dark"; className?: string }) {
  return (
    <V2 theme={theme} className={`pn-cu ${className}`}>
      <div className="pn-cu-hd"><p className="pn-cu-h">{title}</p>{sub ? <p className="pn-cu-sub">{sub}</p> : null}</div>
      <div className="pn-cu-body">{children}</div>
      <div className="pn-cu-note">{note}</div>
    </V2>
  );
}

function Col({ label, n, children, w, style }: { label: ReactNode; n?: number | string; children: ReactNode; w?: number; style?: CSSProperties }) {
  return (
    <div className="pn-col" style={{ width: w, ...style }}>
      <p className="pn-col-l">{n !== undefined ? <Callout n={n} /> : null}{label}</p>
      {children}
    </div>
  );
}

/** The Mac's own Window menu — the OS's tab commands, untouched by the app (CONTRACT §1). */
function MacWindowMenu({ hl }: { hl?: string }) {
  return (
    <div className="pn-macmenu">
      <span className="pn-macbar"><span>File</span><span>Edit</span><span>View</span><span className="pn-macbar-on">Window</span><span>Help</span></span>
      <Menu width={260} highlight={hl} style={{ position: "relative", left: 0, top: 0 }} items={[
        { label: "Show Previous Tab", keys: "⌃⇧Tab" }, { label: "Show Next Tab", keys: "⌃Tab" },
        { label: "Move Tab to New Window" }, { label: "Merge All Windows" }, "sep",
        { label: "Show All Tabs", keys: "⇧⌘\\" }, "sep",
        { label: "Studio site", checked: false }, { label: "Alligators brand", checked: true },
      ]} />
    </div>
  );
}

/** A canvas surface inside a small window (close-ups): pill + a few artboards, no full chrome. */
/** A small project canvas. Default = Alligators brand; pn-cant-open draws Brno Open 2026 (Tereza's project) with it. */
function MiniGator({ pill = true, dim = false, project = "Alligators brand", canvas = "Combine-kampan", head = "COMBINE", story = "ZAPIŠ" }: { pill?: boolean; dim?: boolean; project?: string; canvas?: string; head?: string; story?: string }) {
  return (
    <Canvas dim={dim}>
      <Artboard label="Pozvánka · IG Post" kind="digital" x={100} y={84} w={96} h={120}><GatorMock variant="social" headline={head} sub="1. 10." /></Artboard>
      <Artboard label="Story · 9:16" kind="digital" x={216} y={84} w={68} h={120}><GatorMock variant="reel" headline={story} sub="" /></Artboard>
      <Artboard label="Arch 1 · A4" kind="print" x={304} y={84} w={150} h={106}><GatorMock variant="print" headline={head} sub="" /></Artboard>
      {pill ? <ProjectPill project={project} canvas={canvas} /> : null}
    </Canvas>
  );
}
function MiniStudio() {
  return (
    <Canvas>
      <Artboard label="Homepage" kind="web" x={130} y={90} w={240} h={150}><HeroMock headline="Calm software" sub="" cta="See the work" /></Artboard>
      <Artboard label="Mobile" kind="web" x={394} y={90} w={75} h={150}><PhoneMock title="Calm" tone="sky" /></Artboard>
      <ProjectPill project="Studio site" canvas="Homepage" />
    </Canvas>
  );
}

/* ═══ Shared chrome per project (Variant A: account chip + spark live inside) ═════════════════ */
function GatorChrome({ canvas = "Combine-kampan", people = ["tereza", "jonas"] as Who[], zoom = 20, tool = "select", ai, dock = true, acctOpen = false }: { canvas?: string; people?: Who[]; zoom?: number | string; tool?: string; ai?: string; dock?: boolean; acctOpen?: boolean }) {
  return (
    <>
      <PnPill project="Alligators brand" canvas={canvas} ai={ai} />
      <PnCluster acct="work" people={people} open={acctOpen} />
      <ZoomUndo zoom={zoom} />
      {dock ? <Toolbar tool={tool} /> : null}
      <PanelIcon icon="spark" at="ai" />
    </>
  );
}
const TABS3 = ["Studio site", "Alligators brand", "Home"];
const AI_VIDEO = "AI is cutting Combine-video-AI";

/** A trade-off row on pn-ab. win = which variant does this better (a check, plus the words — never colour alone). */
function TRow({ k, a, b, win }: { k: string; a: ReactNode; b: ReactNode; win?: "a" | "b" }) {
  return (
    <>
      <span className="pn-ab-k">{k}</span>
      <span className="pn-ab-c" data-win={win === "a" ? "true" : undefined}>{win === "a" ? <span className="pn-ab-win"><Icon name="check" size={12} /></span> : null}<span>{a}</span></span>
      <span className="pn-ab-c" data-win={win === "b" ? "true" : undefined}>{win === "b" ? <span className="pn-ab-win"><Icon name="check" size={12} /></span> : null}<span>{b}</span></span>
    </>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function ProjectsAndNavigation() {
  return (
    <DesignCanvas>
      {/* ── 1 · Project tabs, two ways ───────────────────────────────────────────────────── */}
      <DCSection id="tabs" title="Project tabs — two ways to draw them" subtitle="Michal asked for both: A · native macOS window tabs (the plan) · B · a Figma-style strip drawn by Maude — three tabs, then twenty, then the trade-offs. Everything after this section draws A">
        <DCArtboard id="pn-tab-a" label="1 · A · Native macOS tabs — titles only" width={W} height={H} fixed>
          <Stage note={<Note n={1} tag="Variant A" title="A: the Mac draws the tabs — titles only.">① Titles, × and + are AppKit's. ② The project and its AI sit in the pill. ③ The account sits by the faces.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan /></Canvas>
              <PnPanel foot={<>93 canvases · ⌘K searches every project</>}>
                <T aside={<span className="pn-sort">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <GatorTree />
                <TrashRow count={3} />
              </PnPanel>
              <GatorChrome ai={AI_VIDEO} />
            </NativeWindow>
            <Callout n={1} x={600} y={10} />
            <Callout n={2} x={340} y={66} />
            <Callout n={3} x={932} y={66} />
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-tab-b" label="2 · B · Figma-style strip — the tabs say more" width={W} height={H} fixed>
          <Stage note={<Note n={2} tag="Variant B" title="B: Maude draws the strip, so tabs carry state.">① Square + name. ② W = a second account. ③ AI working, or ? when it needs you. Home stays first.</Note>}>
            <PnWindow tabs={[T_HOME, T_STUDIO, T_GATOR, { ...P20[3] }, { ...P20[2] }]} active={2} tabTip={{ i: 3, text: <>Matchday 2026 · AI is drawing the score card</> }}>
              <Canvas><Kampan /></Canvas>
              <PnPanel foot={<>93 canvases · ⌘K searches every project</>}>
                <T aside={<span className="pn-sort">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <GatorTree />
                <TrashRow count={3} />
              </PnPanel>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={20} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </PnWindow>
            <Callout n={1} x={318} y={10} />
            <Callout n={2} x={642} y={10} />
            <Callout n={3} x={922} y={10} />
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-tab-a20" label="3 · A · 20 tabs — titles shorten, » lists the rest" width={W} height={H} fixed>
          <Stage note={<Note n={3} tag="Variant A" title="A at 20 tabs: titles shorten, » lists the rest.">AI in a tab you left reaches you as a Mac notification; ⌘K lists every open tab.</Note>}>
            <NativeWindow tabs={A20_VIS} active={1} more={A20_MORE} moreOpen>
              <Canvas><Kampan dx={-150} /></Canvas>
              <GatorChrome ai={AI_VIDEO} />
              <span className="pn-inset" style={{ right: 16, top: 360, left: "auto", alignItems: "flex-end" }}>
                <span className="chip pn-inset-tag">The Mac's notification, for a tab you left</span>
                <MacNote title="Open studio — AI needs you" body="Pick one of three hero variants to keep going." />
              </span>
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-tab-b20" label="4 · B · 20 tabs — square and short name on every tab" width={W} height={H} fixed>
          <Stage note={<Note n={4} tag="Variant B" title="B at 20 tabs: every tab keeps its square and name.">“10 more” lists the rest with folder, account and state; a ring marks a resting tab.</Note>}>
            <PnWindow tabs={B20_VIS} active={2} more={B20_MORE} moreOpen tabTip={{ i: 5, text: <>Trenérský manuál · resting — opens in a second</> }}>
              <Canvas><Kampan dx={-150} /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={20} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </PnWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-ab" label="5 · A or B — the trade-offs, and a pick" width={W} height={H} fixed>
          <Closeup className="pn-cu--ab" title="A or B — native tabs, or a strip Maude draws"
            sub="Same projects, same twenty-tab day. A is what the plan builds today; B says more on every tab but takes the Mac's own window tools away."
            note={<Note n={5} tag="Proposed — Michal to choose" title="Proposed: A now; one spark on the tab later, if it's missed.">B's richer strip costs a reversed plan decision and the Mac's window tools.</Note>}>
            <div className="pn-ab-strips">
              <div className="pn-ab-col">
                <p className="pn-col-l"><span className="chip">A</span>Native macOS tabs — the plan</p>
                <NativeWindow tabs={TABS3} active={1} height={40} label="Variant A, three tabs" />
                <NativeWindow tabs={A20.slice(0, 5)} active={1} more={A20.slice(5)} height={40} label="Variant A, twenty tabs" />
              </div>
              <div className="pn-ab-col">
                <p className="pn-col-l"><span className="chip">B</span>Figma-style strip — Maude draws it</p>
                <PnWindow tabs={[T_HOME, T_STUDIO, T_GATOR, P20[3]]} active={2} height={40} label="Variant B, four tabs" />
                <PnWindow tabs={[T_HOME, ...P20.slice(0, 3)]} active={2} more={P20.slice(3)} height={40} label="Variant B, twenty tabs" />
              </div>
            </div>
            <div className="pn-ab-grid">
              <span className="pn-ab-hd" />
              <span className="pn-ab-hd">A · Native tabs</span>
              <span className="pn-ab-hd">B · Maude's strip</span>
              <TRow k="Feels like a Mac" win="a" a="Exactly like Finder and Safari. Nothing to learn." b="Like Figma or Arc — familiar to designers, but Maude-made." />
              <TRow k="Mission Control, full screen" win="a" a="Free: drag a tab out, Merge All Windows, Show All Tabs (⇧⌘\), the Window menu." b="Maude is one window to the Mac. Drag-out, merge and Show All Tabs are rebuilt — or gone." />
              <TRow k="Which project is which" win="b" a="Title text only. The pill inside names the project." b="Square, colour and name on every tab." />
              <TRow k="AI in a tab you left" win="b" a="Not on the tab: a Mac notification when AI is done or needs you; ⌘K lists open tabs." b="A spark while it works, a ? when it needs you — right on the tab." />
              <TRow k="Two accounts" a="Inside the window: the account chip by the faces." b="A W face on tabs of the second account." />
              <TRow k="Twenty tabs" a="Titles shorten; » lists the rest — if AppKit has none (T5 spike), Show All Tabs and ⌘K." b="Square and short name stay; “10 more” lists folders, accounts and state." />
              <TRow k="CONTRACT §6" win="b" a="Amends two lines: no project initial on the tab, and the tab's right-click menu is the Mac's." b="As written: the project initial on every tab and the §6 tab menu." />
              <TRow k="Windows and Linux" win="b" a="Separate windows, no tab bar (the plan's call)." b="The same strip everywhere." />
              <TRow k="Effort" win="a" a="In the plan now — T5 (a window per project), T10 (Window menu)." b="A new phase: reverses a plan decision and reopens its security model. Weeks, not days." />
            </div>
            <div className="pn-ab-boxes">
              <div className="pn-ab-box pn-ab-box--pick">
                <p className="pn-ab-bt"><span className="chip">Proposed — Michal to choose</span></p>
                <p className="pn-ab-p"><strong>A for v2.0.</strong> Build the plan as written and draw project, account and AI inside the window (artboards 1, 3, 8). Picking A amends CONTRACT §6 (tab avatar, tab menu).</p>
                <p className="pn-ab-p">If people miss AI on the tab, add one thing later: a trailing spark through the tab's accessory view — a small native spike, not a rewrite.</p>
                <p className="pn-ab-p">Pick B only if Maude should feel like one Figma-style app window more than like a Mac app.</p>
              </div>
              <div className="pn-ab-box">
                <p className="pn-ab-bt">B would change the plan</p>
                <ul className="pn-ab-ul">
                  <li>Reverse “no in-page tab strip” — the strip lives in the page.</li>
                  <li>Host many projects in one window — multiwebview or framing; both reopen the per-window security model (DDR-109).</li>
                  <li>Turn macOS tabbing off; rebuild drag-out, merge, the Window menu and Show All Tabs.</li>
                  <li>A feed of every tab's AI, account and rest state, with its own security review (T14).</li>
                  <li>Home as a real tab with its own route; new desktop tests for the strip (T13).</li>
                </ul>
              </div>
              <div className="pn-ab-box">
                <p className="pn-ab-bt">Both need these plan lines</p>
                <ul className="pn-ab-ul">
                  <li><strong>Home tab:</strong> ⌘T opens a window on the app's own page; picking a project navigates that same tab. One Home at a time.</li>
                  <li><strong>Resting tabs:</strong> the plan runs 5 projects and never stops one with a window, so a 6th tab is refused. Proposed: tabs past 5 rest — the tab stays, its server stops, a click wakes it. Never with AI working or changes unsent.</li>
                  <li><strong>Relaunch:</strong> every tab comes back, resting (v1 restores only the last project).</li>
                </ul>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="pn-tab-menu" label="6 · Right-click a tab — whose menu it is" width={W} height={640} fixed>
          <Closeup title="Right-click a tab — in A the Mac owns the menu, in B Maude does"
            sub="CONTRACT §6 lists Rename… · Move to a new window · Sign in as another account… · Close tab. B can draw that as written; A can't add to the Mac's menu."
            note={<Note n={6} title="One right-click, two owners.">If A wins, Sign in as another account… moves to the account chip and Rename… to Home (CONTRACT §6).</Note>}>
            <div className="pn-wins">
              <Col n="A" label="The Mac's own tab menu" w={660}>
                <div className="pn-mini">
                  <NativeWindow tabs={["Studio site", "Alligators brand", "Home"]} active={1} ctx={1} ctxHl="Move Tab to New Window" height={340} label="Maude — Variant A, the Mac's tab menu"><MiniGator /></NativeWindow>
                </div>
              </Col>
              <Col n="B" label="CONTRACT §6, as written" w={660}>
                <div className="pn-mini">
                  <PnWindow tabs={[T_HOME, T_STUDIO, T_GATOR]} active={2} tabMenu={2} menuHl="Move to a new window" height={340} label="Maude — Variant B, the contract's tab menu"><MiniGator /></PnWindow>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="pn-windows" label="7 · A · Tabs and windows — drag out, merge back, open once" width={W} height={H} fixed>
          <Closeup title="Tabs and windows are the Mac's own (A)" sub="Drag a tab off the strip and it becomes a window; drop it on another strip, or Window › Merge All Windows, and it joins back. In B, Maude would rebuild all of this."
            note={<Note n={7} title="Proposed: a project opens once.">Opening it again — from Home, ⌘K or a link — switches to its tab, in whichever window holds it.</Note>}>
            <div className="pn-wins">
              <Col n={1} label="Drag the tab off the strip" w={640}>
                <div className="pn-mini pn-mini--drag">
                  <NativeWindow tabs={["Studio site", "Home"]} active={0} height={290} label="Maude — Studio site, Alligators brand being dragged out"><MiniStudio /></NativeWindow>
                  <span className="pn-ghost-win"><span className="pn-ghost-tab"><span>Alligators brand</span></span></span>
                </div>
              </Col>
              <span className="pn-arrow"><Icon name="submenu" size={20} /></span>
              <Col n={2} label="It lands as its own window" w={600}>
                <div className="pn-mini">
                  <NativeWindow tabs={["Alligators brand"]} active={0} height={290} label="Maude — Alligators brand in its own window"><MiniGator /></NativeWindow>
                </div>
              </Col>
            </div>
            <div className="pn-wins pn-wins--2">
              <Col n={3} label="Merge — the Mac's Window menu" w={300}>
                <MacWindowMenu hl="Merge All Windows" />
              </Col>
              <Col n={4} label="Opening it again switches to it" w={940}>
                <div className="pn-mini pn-mini--stack">
                  <div className="pn-mini-back">
                    <NativeWindow tabs={["Studio site", "Home"]} active={1} height={250} label="Maude — Home, behind">
                      <Canvas><span className="pn-mini-home"><Spark size={20} /><strong>What shall we make?</strong></span><span className="pn-mini-card"><Thumb art="gator-poster" className="pn-thumb-mini" /><strong>Alligators brand</strong><span>93 canvases</span></span></Canvas>
                    </NativeWindow>
                  </div>
                  <div className="pn-mini-front">
                    <NativeWindow tabs={["Alligators brand"]} active={0} height={250} label="Maude — Alligators brand comes forward">
                      <MiniGator pill={false} />
                      <Toast at="top">Alligators brand is open in this window.</Toast>
                    </NativeWindow>
                  </div>
                  <span className="pn-click" style={{ left: 96, top: 160 }} />
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="pn-accounts" label="8 · A · Two accounts on this Mac — the account is the project's" width={W} height={H} fixed>
          <Stage note={<Note n={8} tag="Variant A" title="The account belongs to the project, on this Mac.">It sits by the faces. Signing out signs out every project on that account.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan dx={-150} /></Canvas>
              <GatorChrome acctOpen />
              <div className="k-menu pn-acctcard">
                <span className="pn-acctcard-row"><AcctFace acct="work" size="lg" /><span><strong>Work · you@work-studio.cz</strong><span>Alligators brand uses this account</span></span></span>
                <span className="k-msep" />
                <span className="pn-acctcard-gt">Also on this Mac</span>
                <span className="pn-acctcard-row pn-acctcard-row--sm"><AcctFace acct="personal" size="md" /><span><strong>Personal · you@gmail.com</strong><span>Studio site, Portfolio 2026 and 11 more</span></span></span>
                <span className="k-msep" />
                <span className="row-item k-mi pn-acctcard-act">Sign in as another account…</span>
                <span className="row-item k-mi pn-acctcard-act pn-acctcard-act--two"><span>Sign out of you@work-studio.cz…</span><span className="pn-acctcard-sub">Signs out every project on it: Alligators brand, Matchday 2026 and 4 more.</span></span>
                <span className="pn-acctcard-foot">Kept on this Mac — Alligators brand opens as Work next time.</span>
              </div>
            </NativeWindow>
            <span className="pn-click pn-click--sm" style={{ left: 964, top: 64 }} />
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Home at scale ─────────────────────────────────────────────────────────────── */}
      <DCSection id="home" title="Home at scale" subtitle="Scrolled past the question: pinned, recent across every project, shared with you, twenty projects by account — and Search from Home">
        <DCArtboard id="pn-home" label="9 · Home, scrolled — everything you touched" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Home answers “where was I?” before you search.">Scrolled, Ask AI and Start with an empty canvas ⌘N stay on top; projects group by account.</Note>}>
            <NativeWindow tabs={TABS3} active={2}>
              <Canvas dots={false}><PnHome /></Canvas>
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-home-search" label="10 · ⌘K on Home — before you type" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="An empty Search is a shortcut list.">Recent searches, open tabs with their AI, recent canvases — from every project, open or not.</Note>}>
            <NativeWindow tabs={TABS3} active={2}>
              <Canvas dots={false}><PnHome dim /></Canvas>
              <Veil />
              <PnPalette query="" empty foot="every project, open or not" groups={[
                { title: "Recent searches", rows: [
                  { label: "letak a6 predni", icon: "clock", sel: true, hint: "5 results" },
                  { label: "uniformy 2027", icon: "clock", hint: "12 results" },
                  { label: "pricing yearly", icon: "clock", hint: "2 results" },
                ] },
                { title: "Open tabs", rows: [
                  { label: "Alligators brand", sq: ["A", "lilac"], meta: "Combine-kampan · AI is cutting Combine-video-AI" },
                  { label: "Studio site", sq: ["S", "yellow"], meta: "Homepage" },
                ] },
                { title: "Recent canvases", rows: [
                  { label: "Uniformy-2027", art: "gator-jersey", meta: "Alligators brand · 2026/dresy · 5 min ago" },
                  { label: "Homepage", art: "home", meta: "Studio site · 20 min ago" },
                  { label: "Mobilní app — case study", art: "mobile", meta: "Portfolio 2026 · not open", hint: "opens a tab" },
                ] },
              ]} />
            </NativeWindow>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Inside a big project ──────────────────────────────────────────────────────── */}
      <DCSection id="big" title="Inside a big project" subtitle="Alligators brand — 93 canvases: pin, sort, drag into a folder, rename, Move to trash and back, and a canvas with 21 artboards">
        <DCArtboard id="pn-organise" label="11 · Pinned on top, sorted your way" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Pinned on top, then the tree, sorted your way.">Hover a row for its pin and ⋯. Recent is a sort here — the same order 01's Recent list shows.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan /></Canvas>
              <PnPanel>
                <T aside="2">Pinned</T>
                <PRow name="Combine-kampan" art="gator-poster" pinned current people={["tereza"]} />
                <PRow name="Uniformy-2027" art="gator-jersey" pinned hover />
                <T aside={<span className="pn-sort pn-sort--open">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <GatorTree kampanCurrent={false} combineOpen={false} />
                <TrashRow count={3} />
              </PnPanel>
              <Menu width={260} highlight="Recently opened" style={{ left: 196, top: 272 }} items={[
                { group: "Sort by" },
                { label: "Recently opened", checked: true }, { label: "Name", checked: false }, { label: "Kind", checked: false, note: "web · social · print · video" }, "sep",
                { label: "Folders on top", checked: true },
              ]} />
              <GatorChrome />
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-move" label="12 · Drag into a folder · rename in place" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Drag onto a folder; double-click to rename.">① The folder says where it lands. ② ↵ renames, esc keeps the name. Or Menu › File › Move to…</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan /></Canvas>
              <PnPanel>
                <T aside={<span className="pn-sort">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <GatorTree dragging combineOpen={false} kampanCurrent={false} />
                <TrashRow count={3} />
              </PnPanel>
              <span className="pn-dragrow" style={{ left: 112, top: 412 }}>
                <Thumb art="board" className="k-thumb--row" /><span>ahoj2</span>
              </span>
              <span className="pn-inset" style={{ left: 16, top: 592 }}>
                <span className="chip pn-inset-tag">Double-click a name</span>
                <span className="island pn-inset-panel">
                  <span className="row-item k-cp-row pn-row pn-row--edit">
                    <Thumb art="blank" className="k-thumb--row" />
                    <span className="input pn-rename">Combine — test barev<i className="k-caretline" /></span>
                  </span>
                  <span className="pn-inset-foot"><Kbd>↵</Kbd> rename · <Kbd>esc</Kbd> keep “Test2”</span>
                </span>
              </span>
              <GatorChrome />
            </NativeWindow>
            <Callout n={1} x={288} y={434} />
            <Callout n={2} x={290} y={640} />
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-trash" label="13 · Move to trash, Restore, clear out" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Nothing is gone until you clear out the trash.">① Move to trash ② Undo ③ Trash: the panel's last row, also in Canvases › Advanced ④ Clear out asks.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan /></Canvas>
              <PnPanel find={<span className="pn-back"><span className="pn-back-ch"><Icon name="chevron" size={12} /></span><strong>Trash</strong><span className="k-cp-count">3 canvases · 1 artboard</span></span>}
                foot={<span className="pn-trashfoot"><span>Kept until you clear it out.</span><span className="btn btn--ghost btn--sm">Clear out…</span></span>}>
                <T>Today</T>
                <PRow name="ahoj" sub="root · You, just now" hover actions={<span className="btn btn--sm btn--primary">Restore</span>} />
                <PRow name="Arch 2 · vnitřek" art="gator-print" sub="artboard of Combine-kampan · Jonas, 14:05" kinds={["print"]} />
                <T>Earlier</T>
                <PRow name="letak-nabor-2022-old" art="gator-poster" sub="legacy · Tereza, 3 Oct" />
                <PRow name="Super-Bowl-Watch-Party — kopie" art="gator-social" sub="2026/social · You, 28 Sep" />
              </PnPanel>
              <span className="pn-inset" style={{ left: 330, top: 120 }}>
                <span className="chip pn-inset-tag">Right-click “ahoj”</span>
                <Menu width={220} highlight="Move to trash" style={{ position: "relative", left: 0, top: 0 }} items={[
                  { label: "Open" }, { label: "Pin", icon: "pin" }, { label: "Rename", icon: "edit" }, { label: "Duplicate", icon: "duplicate" },
                  { label: "Move to…", icon: "folder", sub: true }, { label: "Copy link", icon: "link" }, "sep",
                  { label: "Move to trash", icon: "trash", danger: true },
                ]} />
              </span>
              <span className="pn-inset" style={{ left: 820, top: 300 }}>
                <span className="chip pn-inset-tag">Clear out…, from the Trash foot</span>
                <Dialog title="Clear out the trash?" primary="Clear out" danger width={380} style={{ position: "relative", left: "auto", top: "auto", translate: "none" }}>
                  3 canvases and 1 artboard go for good — for everyone on Alligators brand. Restore can't bring them back after this.
                </Dialog>
                <span className="pn-inset-cap">Only an owner clears out the trash — editors see Restore only.</span>
              </span>
              <Toast icon="trash" action="Undo">“ahoj” moved to the trash.</Toast>
              <GatorChrome />
            </NativeWindow>
            <Callout n={1} x={302} y={162} />
            <Callout n={2} x={540} y={782} />
            <Callout n={3} x={272} y={100} />
            <Callout n={4} x={792} y={342} />
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-jump" label="14 · 21 artboards — jump from the panel" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="A canvas row opens into its artboards — the jump list.">Click one of the 21 and the canvas glides there. Layers lists what's inside one.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas>
                <KAb b={KB_HOST} x={328} y={150} z={0.3} />
                <KAb b={KB_STORY} x={698} y={150} z={0.3} />
                <span className="pn-flash" style={{ left: 692, top: 144, width: 336, height: 588 }} />
                <KAb b={KB_STORY2} x={1068} y={150} z={0.3} />
              </Canvas>
              <PnPanel foot="21 artboards · 19 digital, 2 print">
                <T aside={<span className="pn-sort">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <FRow name="2026" count={16} open />
                <FRow name="combine" count={6} open depth={1} />
                <PRow name="Combine-kampan" art="gator-poster" depth={2} expand="open" pinned meta="21" />
                {KAMPAN_21.map(([l, k]) => <ABRow key={l} label={l} kind={k} depth={2} current={l.startsWith("Pozvánka · story")} />)}
              </PnPanel>
              <GatorChrome zoom={30} />
            </NativeWindow>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · ⌘K everywhere ─────────────────────────────────────────────────────────────── */}
      <DCSection id="search" title="⌘K everywhere" subtitle="Canvases and artboards across every open project, grouped by project with pictures · artboards by name · hidden tools with their path · typos and Czech accents">
        <DCArtboard id="pn-k-across" label="15 · ⌘K — every project, grouped" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="From 2+ projects, results group by project — this tab first.">Another tab switches to it; a closed project opens a tab.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas><Kampan /></Canvas>
              <GatorChrome />
              <Veil />
              <PnPalette query="mobil" foot="7 results" groups={[
                { title: "Alligators brand", sq: ["A", "lilac"], aside: "this tab", rows: [
                  { label: "responsive", art: "gator-web", meta: "club-web · 6 artboards", via: "Mobil · domů", sel: true },
                  { label: "Mobil · nábor 2027", kind: "web", meta: "artboard in website · club-web" },
                ] },
                { title: "Studio site", sq: ["S", "yellow"], aside: "in another tab", rows: [
                  { label: "Mobile — detail", art: "mobile", meta: "4 artboards" },
                  { label: "Mobile", kind: "web", meta: "artboard in Homepage" },
                ] },
                { title: "Portfolio 2026", sq: ["P", "sky"], aside: "not open — opens a tab", rows: [
                  { label: "Mobilní app — case study", art: "mobile", meta: "12 artboards · on this Mac" },
                ] },
                { title: "Tools and settings", aside: "not on screen, found by search", rows: [
                  { label: "New artboard — Mobile", icon: "frame", where: "Menu › Edit › Advanced" },
                  { label: "Duplicate at another width › Mobile", icon: "duplicate", where: "Right-click an artboard" },
                ] },
              ]} />
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-k-close" label="16 · Artboards by name, accents and typos" width={W} height={680} fixed>
          <Closeup title="Type it the way you'd say it" sub="Accents, word order and a swapped letter don't matter. The marks show what matched — in the name or in its canvas."
            note={<Note n={16} title="Every word counts, in any order.">“letak a6 predni” finds LetakA6 › A · přední FLAG. One letter off still finds Uniformy-2027 — and says so.</Note>}>
            <div className="pn-pals">
              <PnPalette query="letak a6 predni" style={{ position: "relative", left: "auto", top: "auto", translate: "none", width: 600 }} foot="5 results" groups={[
                { title: "Canvases and artboards", rows: [
                  { label: "A · přední FLAG", kind: "print", meta: "artboard in LetakA6 · print", sel: true, words: ["predni"], metaWords: ["letak", "a6"] },
                  { label: "C · přední TACKLE", kind: "print", meta: "artboard in LetakA6 · print", words: ["predni"], metaWords: ["letak", "a6"] },
                  { label: "LetakA6", art: "gator-print", meta: "Alligators brand · print · 4 artboards", words: ["letak", "a6"] },
                  { label: "Combine-letak-registrace", art: "gator-print", meta: "Alligators brand · 2026/combine", words: ["letak"] },
                ] },
                { title: "Tools and settings", aside: "not on screen", rows: [
                  { label: "Print guides", icon: "print", via: "leták → print", where: "Menu › View › Advanced", words: [] },
                ] },
              ]} />
              <PnPalette query="unifromy 2027" style={{ position: "relative", left: "auto", top: "auto", translate: "none", width: 600 }} foot="4 close matches"
                note={<>Nothing called “unifromy”. Showing close matches for <strong>uniformy</strong>.</>} groups={[
                { title: "Canvases and artboards", rows: [
                  { label: "Uniformy-2027", art: "gator-jersey", meta: "Alligators brand · 2026/dresy · 12 artboards", sel: true, words: ["uniformy", "2027"] },
                  { label: "Domácí dres 2027 · přední", kind: "print", meta: "artboard in Uniformy-2027", words: ["2027"], metaWords: ["uniformy", "2027"] },
                  { label: "Venkovní dres 2027 · přední", kind: "print", meta: "artboard in Uniformy-2027", words: ["2027"], metaWords: ["uniformy", "2027"] },
                  { label: "uniformy-2026-stare", art: "gator-jersey", meta: "Alligators brand · legacy", words: ["uniformy"], quiet: true },
                ] },
              ]} />
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Version history ───────────────────────────────────────────────────────────── */}
      <DCSection id="history" title="Version history — ⌥⌘H" subtitle="Saved versions with pictures, who or AI made each, named versions; Compare and Restore this version (06's verbs); Restore adds a new version; the git stays in Advanced">
        <DCArtboard id="pn-history" label="17 · Versions with pictures — looking at yesterday" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Click a version to look at it, read-only.">Each has its picture and a face or the spark. Restore this version adds it as a new version — Now stays.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas>
                <Artboard label="Domácí dres · přední" kind="print" x={300} y={130} w={220} h={276}><Jersey v="approved" /></Artboard>
                <Artboard label="Venkovní dres · přední" kind="print" x={548} y={130} w={220} h={276}><Jersey away v="approved" /></Artboard>
                <Artboard label="Helma z boku" kind="print" x={796} y={130} w={220} h={276}><Helmet /></Artboard>
                <Artboard label="Kalhoty doma" kind="print" x={300} y={460} w={220} h={276}><Pants /></Artboard>
                <Artboard label="Kalhoty venku" kind="print" x={548} y={460} w={220} h={276}><Pants away /></Artboard>
              </Canvas>
              <PnPill project="Alligators brand" canvas="Uniformy-2027" />
              <div className="island pn-viewbar">
                <Icon name="history" size={14} />
                <span className="pn-viewbar-t">Viewing <strong>“Schváleno trenéry”</strong> · 5 Oct, 18:40 · Jonas</span>
                <span className="pn-viewbar-esc"><Kbd>esc</Kbd> back to now</span>
              </div>
              <PnCluster acct="work" viewing />
              <HistoryPanel acts={<><span className="btn btn--sm"><Icon name="view" size={12} />Compare</span><span className="btn btn--sm btn--primary">Restore this version</span></>}
                foot={<AdvFold hint="branch, version ids" />}
                rows={[
                  { group: "Today", rows: [
                    { title: "Venkovní dres v zelené", sub: "14:32 · Venkovní dres · přední", art: "gator-jersey", ai: true },
                    { title: "Číslo 27 větší", sub: "14:05 · You", art: "gator-jersey", tv: "big", who: "you" },
                    { title: "Logo na helmě", sub: "11:20 · Tereza", art: "gator-jersey", tv: "helm", who: "tereza" },
                  ] },
                  { group: "Yesterday", rows: [
                    { title: "Schváleno trenéry", sub: "18:40 · Jonas", art: "gator-jersey", tv: "ink", who: "jonas", named: true, sel: true },
                    { title: "Restored “První návrh helmy”", sub: "10:02 · Tereza", art: "gator-jersey", tv: "helm", who: "tereza", restored: true },
                  ] },
                  { group: "4 Oct", rows: [
                    { title: "První návrh dresů", sub: "16:15 · from Tereza's ask", art: "gator-jersey", tv: "white", ai: true },
                  ] },
                ]} />
              <ZoomUndo zoom={20} />
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-compare" label="18 · Compare two versions — every change, and what Restore takes back" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="A and B side by side; every change, in words.">Restore this version brings back the whole canvas (git: 06 › 10).</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas>
                <Artboard label="A · Schváleno trenéry · 5 Oct, 18:40" kind="print" x={290} y={110} w={320} h={400}><Jersey away v="approved" /></Artboard>
                <Artboard label="B · Now · 6 Oct, 14:32" kind="print" x={640} y={110} w={320} h={400} selected><Jersey away /></Artboard>
                <div className="pn-cmpbar" style={{ left: 290, top: 536 }}>
                  <span className="seg k-in-seg"><span className="k-seg-b" aria-pressed="true">Side by side</span><span className="k-seg-b">Overlay</span></span>
                  <span className="pn-cmp-n">4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku</span>
                </div>
                <div className="pn-cmplist" style={{ left: 290, top: 580 }}>
                  <span><b className="pn-cmp-dot" /><span className="pn-cmp-ab">Venkovní dres</span>Dres: černá → zelená <span className="pn-cmp-who"><Spark size={10} />Made by AI, 14:32</span></span>
                  <span><b className="pn-cmp-dot" /><span className="pn-cmp-ab">Venkovní dres</span>Límec: zelený → černý <span className="pn-cmp-who"><Spark size={10} />Made by AI, 14:32</span></span>
                  <span><b className="pn-cmp-dot" /><span className="pn-cmp-ab">Venkovní dres</span>Číslo 27: 120 → 150 px <span className="pn-cmp-who"><Avatar who="you" size="sm" />You, 14:05</span></span>
                  <span><b className="pn-cmp-dot" /><span className="pn-cmp-ab">Helma z boku</span>Logo na helmě: added <span className="pn-cmp-who"><Avatar who="tereza" size="sm" />Tereza, 11:20</span></span>
                </div>
              </Canvas>
              <PnPill project="Alligators brand" canvas="Uniformy-2027" />
              <PnCluster acct="work" viewing />
              <HistoryPanel acts={
                <span className="pn-vh-restore">
                  <span className="pn-vh-why">Restores the whole canvas as it was at A, as a new version — Tereza's helmet logo goes too. Now stays in the list.</span>
                  <span className="pn-vh-btns"><span className="btn btn--sm btn--ghost">Stop comparing</span><span className="btn btn--sm">Restore only Venkovní dres</span><span className="btn btn--sm btn--primary">Restore this version</span></span>
                </span>}
                foot={<AdvFold hint="branch main · a41f9c2" />}
                rows={[
                  { group: "Today", rows: [
                    { title: "Venkovní dres v zelené", sub: "14:32 · Venkovní dres · přední", art: "gator-jersey", ai: true, mark: "B" },
                    { title: "Číslo 27 větší", sub: "14:05 · You", art: "gator-jersey", tv: "big", who: "you" },
                    { title: "Logo na helmě", sub: "11:20 · Tereza", art: "gator-jersey", tv: "helm", who: "tereza" },
                  ] },
                  { group: "Yesterday", rows: [
                    { title: "Schváleno trenéry", sub: "18:40 · Jonas", art: "gator-jersey", tv: "ink", who: "jonas", named: true, sel: true, mark: "A" },
                  ] },
                ]} />
              <ZoomUndo zoom={32} />
            </NativeWindow>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Edge cases ────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When navigation gets hard" subtitle="AI working in the tab you left · a restart with 20 tabs · a link from Slack · a project that moved on disk · access removed, or turned to Can view on a project someone else owns">
        <DCArtboard id="pn-switch-ai" label="19 · Switch tabs while AI works — and the keys" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Leave mid-run; AI keeps going and tells you when it's done.">Tabs move with ⌃Tab like every Mac app; ⌘0 and ⌘1 stay zoom.</Note>}>
            <NativeWindow tabs={TABS3} active={0}>
              <Canvas><StudioView /></Canvas>
              <PnPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <PnCluster acct="personal" people={["tereza"]} />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Veil />
              <div className="pn-ks">
                <div className="pn-ks-hd"><strong>Keyboard shortcuts</strong><span className="k-find pn-ks-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Find a shortcut</span></span><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
                <p className="pn-ks-gt">Tabs and windows</p>
                {([["Next tab", "⌃Tab"], ["Previous tab", "⌃⇧Tab"], ["Next / previous tab, too", "⇧⌘]  ⇧⌘["], ["New tab — opens Home", "⌘T"], ["Close this project's tab", "⌘W"], ["Show all tabs", "⇧⌘\\"]] as [string, string][]).map(([l, k]) => (
                  <span className="pn-ks-r" key={l}><span>{l}</span><span className="pn-ks-k">{k.split("  ").map((x) => <Kbd key={x}>{x}</Kbd>)}</span></span>
                ))}
                <p className="pn-ks-gt">Finding a canvas</p>
                {([["Search every project", "⌘K"], ["Open project…", "⌘O"], ["Version history", "⌥⌘H"]] as [string, string][]).map(([l, k]) => (
                  <span className="pn-ks-r" key={l}><span>{l}</span><Kbd>{k}</Kbd></span>
                ))}
                <p className="pn-ks-foot">⌘W closes the project's tab, as on every Mac. Close canvas (Menu › File) has no key. A closed tab comes back from Home or ⌘K — ⇧⌘T stays Timeline.</p>
              </div>
              <span className="pn-inset" style={{ right: 16, top: 72, left: "auto", alignItems: "flex-end", zIndex: 25 }}>
                <span className="chip pn-inset-tag">The Mac's notification</span>
                <MacNote title="Alligators brand — AI is done" body="Combine-video-AI is cut: 0:42, ready to look at." />
              </span>
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-relaunch" label="20 · After a restart — 20 tabs come back, resting" width={W} height={H} fixed>
          <Stage note={<Note n={20} tag="Plan amendment" title="Proposed: after a restart, every tab comes back.">Only the front one runs; the rest wake when you open them.</Note>}>
            <NativeWindow tabs={A20_VIS} active={1} more={A20_MORE}>
              <Canvas><Kampan /></Canvas>
              <PnPanel foot={<>93 canvases · ⌘K searches every project</>}>
                <T aside={<span className="pn-sort">Recent<Icon name="chevron" size={11} /></span>}>Alligators brand</T>
                <GatorTree />
                <TrashRow count={3} />
              </PnPanel>
              <GatorChrome />
              <Toast at="top" icon="tab">20 tabs reopened. Each one starts when you open it.</Toast>
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-deeplink" label="21 · A link from Slack — right tab, right artboard" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="A link opens the exact spot.">Its tab comes forward (or opens), the canvas glides to the story and her comment opens.</Note>}>
            <NativeWindow tabs={TABS3} active={1}>
              <Canvas>
                <KAb b={KB_HOST} x={360} y={130} z={0.33} />
                <KAb b={KB_STORY_TYPO} x={740} y={130} z={0.33} />
                <span className="pn-flash" style={{ left: 734, top: 124, width: 368, height: 646 }} />
                <CommentPin who="tereza" x={832} y={652} text={<>V datu je překlep — má být do 25. 9., ne 25. 6.</>} count={1} />
              </Canvas>
              <GatorChrome zoom={33} />
              <Toast at="top" icon="link">Opened from Tereza's link — Pozvánka · story.</Toast>
              <span className="pn-inset" style={{ left: 24, top: 560 }}>
                <span className="chip pn-inset-tag">The link, in Slack</span>
                <span className="pn-msg">
                  <span className="pn-msg-hd"><Avatar who="tereza" /><strong>Tereza</strong><span>14:12</span></span>
                  <span className="pn-msg-t">Mrkni prosím na story, v datu je překlep</span>
                  <span className="pn-msg-link"><Icon name="link" size={12} />alligators.cloud.maude.sh/c/combine-kampan#pozvanka-story</span>
                </span>
                <span className="pn-handoff"><Icon name="submenu" size={12} />A web link opens the browser, which offers Open in the Mac app; Share › app link (maude://) comes straight here. Moving or renaming the canvas keeps the link.</span>
              </span>
            </NativeWindow>
          </Stage>
        </DCArtboard>

        <DCArtboard id="pn-cant-open" label="22 · A project that moved · access removed · now Can view" width={W} height={800} fixed>
          <Closeup title="When a project can't open the way it used to"
            sub="Each says what happened, what is safe, and gives one thing to do. Access changes happen on Brno Open 2026, a project Tereza owns — you own Alligators brand and Studio site. Words match 10 Share and Collaboration (co-access-ends, co-ask-edit)."
            note={<Note n={22} title="Words, not errors — nothing thrown away.">A moved folder is found again. Removed: changes were saved first. Can view: Ask to edit.</Note>}>
            <div className="pn-wins pn-wins--3">
              <Col n={1} label="Portfolio 2026 was moved on disk" w={440}>
                <div className="pn-mini">
                  <NativeWindow tabs={["Studio site", "Portfolio 2026"]} active={1} height={480} label="Maude — Portfolio 2026 folder not found">
                    <Canvas>
                      <div className="pn-gone">
                        <span className="pn-gone-ic"><Icon name="folder" size={22} /></span>
                        <p className="pn-gone-t">Portfolio 2026 isn't where it was.</p>
                        <p className="pn-gone-b">It was in Desktop › Portfolio 2026. Nothing inside has changed — the folder was moved or renamed.</p>
                        <span className="btn btn--primary">Find the folder…</span>
                        <p className="pn-gone-f">Closing the tab keeps it on Home.</p>
                      </div>
                    </Canvas>
                    <ProjectPill project="Portfolio 2026" />
                  </NativeWindow>
                </div>
              </Col>
              <Col n={2} label="Brno Open 2026 (Tereza's) — you were removed" w={440}>
                <div className="pn-mini">
                  <NativeWindow tabs={["Studio site", "Brno Open 2026"]} active={1} height={480} label="Maude — Brno Open 2026, access removed">
                    <MiniGator dim project="Brno Open 2026" canvas="Program-turnaje" head="BRNO OPEN" story="FINÁLE" />
                    <div className="pn-gone pn-gone--card island">
                      <span className="pn-gone-ic"><Icon name="lock" size={22} /></span>
                      <p className="pn-gone-t">You no longer have access to Brno Open 2026.</p>
                      <p className="pn-gone-b">Your last changes were saved first. If this is a surprise, ask someone on the team.</p>
                      <span className="btn btn--primary"><Icon name="home" size={14} />Back to Home</span>
                    </div>
                  </NativeWindow>
                </div>
              </Col>
              <Col n={3} label="Brno Open 2026 (Tereza's) — you're now Can view" w={440}>
                <div className="pn-mini">
                  <NativeWindow tabs={["Studio site", "Brno Open 2026"]} active={1} height={480} label="Maude — Brno Open 2026, now Can view">
                    <MiniGator pill={false} head="BRNO OPEN" story="FINÁLE" />
                    <ProjectPill project="Brno Open 2026" folded />
                    <ShareCluster people={["tereza"]} access="Can view" canEdit={false} mode="viewing" panelsButton={false} />
                    <div className="pn-tipcard" style={{ left: 100, top: 240 }}>You can look at Brno Open 2026, not change it.<span>Ask to edit, top right, sends a request to Tereza, who owns it.</span></div>
                    <Toast at="dock" icon="lock" style={{ bottom: 16 }}>Tereza changed you to Can view. Your changes were saved first.</Toast>
                  </NativeWindow>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
