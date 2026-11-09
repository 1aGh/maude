/**
 * @canvas      17 Accounts and Connections — where am I signed in, in which project, and does the connection work
 * @ds          maude-v2
 * @platform    desktop
 * @kind        canvas
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-v2-17_accounts_and_connections
 * @artboards   ac-model | ac-states | ac-toast | ac-menu-broken | ac-menus | ac-switch | ac-sync |
 *              ac-general | ac-general-states | ac-connections | ac-advanced | ac-link-a | ac-link-b | ac-home
 * @brief       Plan .ai/plans/feature-accounts-and-connections-2.1.1.md, task T1 (Michal, 2026-11-09): "Several accounts on
 *              cloud.maude.sh, several projects under each. A project is either connected to the person's own local repo, or
 *              Maude keeps a copy somewhere in the background. Plus projects on the person's own servers. The person must find
 *              their way at a glance: where they are signed in, in which project, and whether the connection works. As simple
 *              as possible." — the proposal shown to Michal before any builder starts (T2–T6).
 *              Revision 1 (Michal, verbatim): "general bych taky udelal vzdy pod sebou, libi se mi jak to mel connections
 *              s ikonami vzdy, jen bych to udelal klidne jako karty spis rozbalovani a sjednotit tenhle vzhled pak pro vse
 *              general/connections/advanced" → Settings is one column of expandable cards in all three tabs, in the look of
 *              today's Connections row (v2/settings/connection-row.jsx: icon · title · one line · status · its own Advanced).
 *
 * Ground truth (main @ 91e57a20a, 2026-11-09):
 *   · The avatar card (v2/shell/project-account-card.jsx + project-account-model.js) mixes the account kind with the
 *     location ("Signed in with · Account · Project · Profile on this Mac"); a local project has no action.
 *   · The account chip sits first in the Share cluster (shell/account-card.jsx, canvas 11 · pn-accounts) — lifted here.
 *   · Diagnostics › Sync on a local project: "nothing to sync", no action (diagnostics-sheet.jsx SyncView).
 *   · Settings › Connections holds cloud + team-server linking; Settings › Advanced is 8 flat groups.
 *   · Two team-server dialogs: Settings "Add a team server" (panels/TeamProjects.jsx) and Home "Sign in to your own hub"
 *     (v2/onboarding/HubSheet.jsx). Here they become ONE "Link your server" dialog.
 *
 * Words (CONTRACT §3, §4): Maude Cloud is the name; the address cloud.maude.sh appears only on account rows. A self-hosted
 * server shows its own host. The person's words are account, project, your server, this Mac — never hub, profile, token,
 * bearer. Status is a word with a dot or a glyph, never hue alone. Offline reads "Offline — changes wait on this Mac".
 *
 * Three places, exactly: Your folder (a folder the person chose, path shown) · Kept by Maude (a copy in the background,
 * no path to manage) · On your server. A Maude Cloud project is reachable from any Mac; on this Mac its copy is either
 * your folder or kept by Maude.
 *
 * All pieces local with prefix `ac-`; chrome from ./_kit. Static mocks — spans, no real controls.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./17 Accounts and Connections.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import { Artboard, Avatar, Canvas, Dialog, HeroMock, Icon, Mark, ModeSwitch, Note, ProjectPill, Stage, StatusWord, Thumb, Toolbar, V2, Veil, Window, ZoomUndo } from "./_kit";
import type { Art, Tab, Tone } from "./_kit";

const W = 1440;
const H = 980;
const FLOW: CSSProperties = { position: "relative", left: "auto", top: "auto", translate: "none" };

/* ═══ Data — accounts, places, projects ═══════════════════════════════════════════════════════ */

type AcctKind = "cloud" | "server" | "local";
type AcctKey = "alice" | "bright" | "server" | "mac";
const ACCTS: Record<AcctKey, { kind: AcctKind; ini: string; tone: Tone; email: string; where: string; short: string }> = {
  alice: { kind: "cloud", ini: "A", tone: "yellow", email: "alice@example.com", where: "Maude Cloud", short: "alice@example.com" },
  bright: { kind: "cloud", ini: "H", tone: "sky", email: "hello@brightside.example", where: "Maude Cloud", short: "hello@brightside.example" },
  server: { kind: "server", ini: "D", tone: "green", email: "alice@example.com", where: "design.example.com", short: "design.example.com" },
  mac: { kind: "local", ini: "", tone: "grey", email: "", where: "This Mac", short: "This Mac" },
};

type Conn = "ok" | "syncing" | "offline" | "missing" | "rejected" | "unreachable" | "local";
type SW = "ok" | "warn" | "error" | "busy" | "off";
const CONN: Record<Conn, { name: string; word: string; icon: string; tone?: "warn" | "error"; sw: SW; line: string; fix?: string; a: AcctKey; why: string }> = {
  ok: { name: "Connected", word: "Saved", icon: "cloud", sw: "ok", line: "Connected · synced 2 min ago", a: "alice", why: "No badge. The face is the account." },
  syncing: { name: "Syncing", word: "Syncing…", icon: "sync", sw: "busy", line: "Syncing · 3 changes going out", a: "alice", why: "A thin ring turns round the face." },
  offline: { name: "Offline", word: "Offline — changes wait on this Mac", icon: "offline", tone: "warn", sw: "off", line: "Offline — changes wait on this Mac. They go out when it’s back online.", a: "alice", why: "The face goes grey. Nothing to do." },
  missing: { name: "Sign-in missing", word: "Sign in to sync", icon: "lock", tone: "error", sw: "error", line: "This project is on design.example.com — sign in to sync.", fix: "Sign in", a: "server", why: "Broken link: you can fix it, one click." },
  rejected: { name: "Sign-in stopped working", word: "Sign-in stopped working", icon: "lock", tone: "error", sw: "error", line: "Your sign-in to design.example.com stopped working. Changes wait on this Mac.", fix: "Sign in again", a: "server", why: "Broken link: you can fix it, one click." },
  unreachable: { name: "Server unreachable", word: "Can’t reach design.example.com", icon: "problem", tone: "warn", sw: "warn", line: "design.example.com doesn’t answer. Changes wait on this Mac.", fix: "Retry design.example.com", a: "server", why: "Warning glyph: the server’s side, not yours." },
  local: { name: "Only on this Mac", word: "Only on this Mac", icon: "laptop", sw: "off", line: "Nothing leaves this Mac.", fix: "Put on Maude Cloud…", a: "mac", why: "A plain laptop. Never a badge." },
};

type Place = { k: "folder"; path: string } | { k: "kept" } | { k: "server"; host: string };
type Proj = { name: string; ini: string; tone: Tone; a: AcctKey; place: Place; copy?: Place; conn: Conn; arts: [Art, Art, Art]; when: string; canvases: number };
const P_BRAND: Proj = { name: "Brand site", ini: "B", tone: "coral", a: "alice", place: { k: "folder", path: "~/git/brand-site" }, conn: "ok", arts: ["home", "price", "onb"], when: "2 min ago", canvases: 6 };
const P_PORT: Proj = { name: "Portfolio 2026", ini: "P", tone: "lilac", a: "alice", place: { k: "kept" }, conn: "syncing", arts: ["moodboard", "brand", "board"], when: "yesterday", canvases: 3 };
const P_APP: Proj = { name: "Brightside app", ini: "B", tone: "green", a: "bright", place: { k: "kept" }, conn: "ok", arts: ["mobile", "onb", "flow"], when: "Monday", canvases: 14 };
const P_SPRING: Proj = { name: "Spring campaign", ini: "S", tone: "yellow", a: "bright", place: { k: "folder", path: "~/work/spring-campaign" }, conn: "ok", arts: ["gator-poster", "gator-social", "gator-reel"], when: "3 Nov", canvases: 9 };
const P_DS: Proj = { name: "Design system", ini: "D", tone: "sky", a: "server", place: { k: "server", host: "design.example.com" }, copy: { k: "kept" }, conn: "rejected", arts: ["brand", "admin", "board"], when: "yesterday", canvases: 11 };
const P_WEB: Proj = { name: "Website 2027", ini: "W", tone: "green", a: "server", place: { k: "server", host: "design.example.com" }, copy: { k: "folder", path: "~/git/website-2027" }, conn: "rejected", arts: ["home", "gator-web", "price"], when: "1 Nov", canvases: 7 };
const P_LOGO: Proj = { name: "Logo ideas", ini: "L", tone: "coral", a: "mac", place: { k: "folder", path: "~/git/logo-ideas" }, conn: "local", arts: ["brand", "blank", "board"], when: "today", canvases: 2 };
const P_MOOD: Proj = { name: "Moodboard", ini: "M", tone: "lilac", a: "mac", place: { k: "kept" }, conn: "local", arts: ["moodboard", "blank", "blank"], when: "28 Oct", canvases: 1 };
const PROJECTS: Proj[] = [P_BRAND, P_PORT, P_APP, P_SPRING, P_DS, P_WEB, P_LOGO, P_MOOD];

const T_DS: Tab = { name: "Design system", initial: "D", color: "sky" };
const T_BRAND: Tab = { name: "Brand site", initial: "B", color: "coral" };
const T_LOGO: Tab = { name: "Logo ideas", initial: "L", color: "coral" };
const TABS_DS: Tab[] = [{ name: "Home", home: true }, T_DS, T_BRAND, T_LOGO];
const TABS_BRAND: Tab[] = [{ name: "Home", home: true }, T_BRAND, T_DS, T_LOGO];

/* ═══ Pieces ════════════════════════════════════════════════════════════════════════════════════ */

/** The broken-link glyph — the kit's link, split, with two ticks. Only for a sign-in the person can fix. */
function BrokenLink({ size = 10 }: { size?: number }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.6 9.4 5.1 10.9a2.1 2.1 0 0 1-3-3l1.5-1.5" />
      <path d="M9.4 6.6 10.9 5.1a2.1 2.1 0 0 1 3 3l-1.5 1.5" />
      <path d="M5.2 1.8v1.6M1.8 5.2h1.6M10.8 14.2v-1.6M14.2 10.8h-1.6" />
    </svg>
  );
}

/** "Kept by Maude" — the mark, single-colour. */
function KeptGlyph({ size = 12 }: { size?: number }) {
  return <span className="ac-kept-g"><Mark size={size} tile="currentColor" star="var(--bg-1)" /></span>;
}

type FaceSize = "sm" | "md" | "lg";
/** An account's face: a circle for a Maude Cloud account, a tile with the server glyph for your server,
 *  a laptop tile for this Mac only. The connection state rides on it as one badge. */
function Face({ a, conn = "ok", size = "md" }: { a: AcctKey; conn?: Conn; size?: FaceSize }) {
  const acct = ACCTS[a];
  const ic = size === "lg" ? 16 : size === "md" ? 13 : 10;
  const glyph = size === "sm" ? 8 : size === "md" ? 10 : 12;
  return (
    <span className={`ac-face ac-face--${size}`} data-conn={conn} title={acct.email || acct.where}>
      {acct.kind === "cloud" ? <Avatar ini={acct.ini} tone={acct.tone} size={size} /> : <span className={`ac-tile ac-tile--${acct.kind} ac-tile--${size}`}><Icon name={acct.kind === "server" ? "server" : "laptop"} size={ic} /></span>}
      {conn === "syncing" ? (
        <svg className="ac-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="30 100" /></svg>
      ) : null}
      {conn === "missing" || conn === "rejected" ? <span className="ac-badge ac-badge--bad" title="Sign-in needed"><BrokenLink size={glyph} /></span> : null}
      {conn === "unreachable" ? <span className="ac-badge ac-badge--warn" title="Can’t reach the server"><Icon name="problem" size={glyph} /></span> : null}
    </span>
  );
}

/** The account chip, first in the Share cluster (lifted from 11 · pn-me): face · where · chevron. */
function AcctChip({ a, conn = "ok", open = false }: { a: AcctKey; conn?: Conn; open?: boolean }) {
  return (
    <span className="ac-chip" data-open={open ? "true" : undefined} data-conn={conn}>
      <Face a={a} conn={conn} size="md" />
      <span className="ac-chip-l">{ACCTS[a].short}</span>
      <Icon name="chevron" size={12} />
    </span>
  );
}

/** The Share cluster with the account chip first (11 · PnCluster), the save word per state. */
function Cluster({ conn, a, open = false, people = ["tereza"], style }: { conn: Conn; a?: AcctKey; open?: boolean; people?: string[]; style?: CSSProperties }) {
  const c = CONN[conn];
  return (
    <div className="island k-tr ac-tr" style={style}>
      <AcctChip a={a ?? c.a} conn={conn} open={open} />
      <span className="ac-tr-div" />
      {people.length ? <span className="k-faces">{people.map((p) => <Avatar key={p} who={p} />)}</span> : null}
      <span className={`k-saved${c.tone ? ` k-saved--${c.tone}` : ""}`}><Icon name={c.icon} size={16} />{c.word}</span>
      <ModeSwitch mode="edit" />
      <span className="icon-btn" title="Hide panels ⌘\"><Icon name="panel-right" /></span>
      <span className="btn btn--primary"><Icon name="share" size={14} />Share</span>
    </div>
  );
}

function PlaceIcon({ p, size = 12 }: { p: Place; size?: number }) {
  if (p.k === "kept") return <KeptGlyph size={size} />;
  return <Icon name={p.k === "folder" ? "folder" : "server"} size={size} />;
}
function placeLabel(p: Place): string {
  return p.k === "folder" ? "Your folder" : p.k === "kept" ? "Kept by Maude" : `On ${p.host}`;
}
/** Where the project lives — one of exactly three places. */
function PlaceChip({ p, path = true }: { p: Place; path?: boolean }) {
  return (
    <span className={`ac-place ac-place--${p.k}`}>
      <PlaceIcon p={p} />
      <span>{placeLabel(p)}</span>
      {path && p.k === "folder" ? <span className="k-mono ac-place-path">{p.path}</span> : null}
    </span>
  );
}

/** The project square (11 · Sq) — a project wears a rounded square, an account a circle. */
function Sq({ p, size = "md" }: { p: Proj; size?: FaceSize }) {
  return <span className="ac-sq"><Avatar ini={p.ini} tone={p.tone} size={size} /></span>;
}

function Closeup({ title, sub, note, children, className = "" }: { title: ReactNode; sub?: ReactNode; note: ReactNode; children: ReactNode; className?: string }) {
  return (
    <V2 className={`ac-cu ${className}`}>
      <div className="ac-cu-hd"><p className="ac-cu-h">{title}</p>{sub ? <p className="ac-cu-sub">{sub}</p> : null}</div>
      <div className="ac-cu-body">{children}</div>
      <div className="ac-cu-note">{note}</div>
    </V2>
  );
}
function Col({ label, children, w, style }: { label: ReactNode; children: ReactNode; w?: number; style?: CSSProperties }) {
  return (
    <div className="ac-col" style={{ width: w, ...style }}>
      <span className="ac-col-l">{label}</span>
      {children}
    </div>
  );
}
function Btn({ children, primary = false, ghost = false, icon }: { children: ReactNode; primary?: boolean; ghost?: boolean; icon?: string }) {
  return <span className={`btn btn--sm${primary ? " btn--primary" : ""}${ghost ? " btn--ghost" : ""}`}>{icon ? <Icon name={icon} size={12} /> : null}{children}</span>;
}
function Row({ k, children }: { k: ReactNode; children?: ReactNode }) {
  return <div className="ac-row"><span className="ac-row-k">{k}</span><span className="ac-row-v">{children}</span></div>;
}
/** The disclosure at the foot of a panel or a card — "Advanced" by default (CONTRACT §3). */
function Fold({ open = false, hint, label = "Advanced", children }: { open?: boolean; hint?: string; label?: string; children?: ReactNode }) {
  return (
    <div className="k-adv ac-fold" data-open={open ? "true" : undefined}>
      <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>{label}{!open && hint ? <span className="k-adv-count">{hint}</span> : null}</span>
      {open ? <div className="ac-fold-body">{children}</div> : null}
    </div>
  );
}

/* ═══ C · The avatar menu ═══════════════════════════════════════════════════════════════════════ */

type MenuV = "cloud" | "broken" | "folder" | "kept";
const MENU_P: Record<MenuV, Proj> = { cloud: P_BRAND, broken: P_DS, folder: P_LOGO, kept: P_MOOD };

function MRow({ label, icon, sub = false, hl = false, keys, note }: { label: ReactNode; icon?: ReactNode; sub?: boolean; hl?: boolean; keys?: string; note?: string }) {
  return (
    <span className="row-item k-mi ac-mi" data-hl={hl ? "true" : undefined}>
      <span className="k-mi-ic">{icon}</span>
      <span className="k-mi-lab">{label}</span>
      {note ? <span className="k-mi-note">{note}</span> : null}
      {keys ? <span className="k-mi-keys">{keys}</span> : null}
      {sub ? <span className="k-mi-ch"><Icon name="submenu" size={12} /></span> : null}
    </span>
  );
}

/** The project block — top of the avatar menu: name · where it lives · account · status. */
function ProjectBlock({ p, conn }: { p: Proj; conn: Conn }) {
  const a = ACCTS[p.a];
  const c = CONN[conn];
  const bad = conn === "missing" || conn === "rejected";
  return (
    <div className={`ac-pb${bad ? " ac-pb--bad" : ""}`}>
      <span className="ac-pb-hd"><Sq p={p} /><strong>{p.name}</strong></span>
      <span className="ac-pb-line">
        <span className="ac-pb-ic"><PlaceIcon p={p.place} size={13} /></span>
        <span className="ac-pb-txt">
          {placeLabel(p.place)}
          {p.place.k === "folder" ? <span className="k-mono ac-pb-mono"> {p.place.path}</span> : null}
          {p.copy ? <span className="ac-q"> · copy {p.copy.k === "kept" ? "kept by Maude" : "in your folder"}</span> : null}
          {a.kind === "cloud" ? <span className="ac-q"> · also on Maude Cloud</span> : null}
        </span>
      </span>
      <span className="ac-pb-line">
        <span className="ac-pb-ic"><Face a={p.a} size="sm" /></span>
        <span className="ac-pb-txt">{a.kind === "local" ? "No account — only on this Mac" : <>{a.email}<span className="ac-q"> · {a.kind === "cloud" ? "Maude Cloud" : "your server"}</span></>}</span>
      </span>
      <span className="ac-pb-line">
        <span className="ac-pb-ic" />
        <StatusWord state={c.sw}>{conn === "rejected" ? "Sign-in stopped working · synced yesterday" : conn === "local" ? "Only on this Mac" : c.line}</StatusWord>
      </span>
      {bad ? (
        <div className="ac-pb-fix">
          <span className="ac-pb-fixt">Changes wait on this Mac and go out after you sign in.</span>
          <span className="ac-pb-fixr"><span className="input ac-in ac-in--ro"><Icon name="server" size={12} />design.example.com</span><Btn primary>Sign in again</Btn></span>
        </div>
      ) : null}
    </div>
  );
}

function AcctMenu({ v, hl, style }: { v: MenuV; hl?: string; style?: CSSProperties }) {
  const p = MENU_P[v];
  const local = v === "folder" || v === "kept";
  return (
    <div className="k-menu ac-menu" style={style}>
      <ProjectBlock p={p} conn={v === "cloud" ? "ok" : v === "broken" ? "rejected" : "local"} />
      {local ? (
        <>
          <span className="k-msep" />
          <MRow icon={<Icon name="cloud" size={14} />} label="Put this project on Maude Cloud…" hl={hl === "cloud"} />
          <MRow icon={<Icon name="server" size={14} />} label="Link your server…" hl={hl === "server"} />
        </>
      ) : null}
      {v === "cloud" ? (
        <>
          <span className="k-msep" />
          <MRow icon={<Icon name="folder" size={14} />} label="Show in Finder" />
        </>
      ) : null}
      <span className="k-msep" />
      <span className="k-mgroup">Account</span>
      <MRow icon={<Face a={p.a} size="sm" />} label="Switch account" sub hl={hl === "switch"} />
      <span className="k-msep" />
      <MRow icon={<Icon name="settings" size={14} />} label="Project settings…" keys="⌘," />
    </div>
  );
}

/** "Switch account" — the accounts already on this Mac, by e-mail; the current one ticked; adding one is the foot. */
function SwitchSub({ current, style }: { current: AcctKey; style?: CSSProperties }) {
  const rows: AcctKey[] = ["mac", "alice", "bright", "server"];
  return (
    <div className="k-menu ac-menu ac-sub" style={style}>
      <span className="k-mgroup">Use for this project</span>
      {rows.map((k) => {
        const a = ACCTS[k];
        return (
          <span key={k} className="row-item k-mi ac-mi ac-mi--two" data-hl={k === "bright" ? "true" : undefined}>
            <span className="k-mi-ic">{k === current ? <Icon name="check" size={14} /> : null}</span>
            <Face a={k} size="md" />
            <span className="ac-mi-two"><strong>{k === "mac" ? "No account — this Mac only" : a.email}</strong><span>{k === "mac" ? "Nothing leaves this Mac" : k === "server" ? "Your server · design.example.com" : "Maude Cloud · cloud.maude.sh"}</span></span>
          </span>
        );
      })}
      <span className="k-msep" />
      <MRow icon={<Icon name="plus" size={14} />} label="Add a Maude Cloud account…" />
      <MRow icon={<Icon name="server" size={14} />} label="Sign in with custom server…" />
    </div>
  );
}

/* ═══ E · Settings — one column of cards, the Connections look, in every tab ═══════════════════ */

type STab = "General" | "Connections" | "Advanced";
function SettingsSheet({ tab, children, style }: { tab: STab; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ac-settings" style={style}>
      <div className="ac-set-rail">
        <p className="ac-set-t">Settings</p>
        {(["General", "Connections", "Advanced"] as const).map((t) => (
          <span key={t} className="row-item ac-set-tab" aria-current={t === tab ? "true" : undefined}><Icon name={t === "General" ? "settings" : t === "Connections" ? "link" : "more"} size={14} />{t}</span>
        ))}
        <span className="ac-set-sp" />
        <span className="ac-set-foot">Maude 2.1.1</span>
      </div>
      <div className="ac-set-main"><div className="ac-cards">{children}</div></div>
    </div>
  );
}

/** One settings card — today's Connections row (connection-row.jsx) made expandable: icon · title · one line ·
 *  status, an action when one click fixes it, the chevron opens it. The same card in General, Connections, Advanced. */
function SCard({ icon, title, desc, sum, sw, open = false, action, bad = false, bare = false, children }: { icon: ReactNode; title: ReactNode; desc?: ReactNode; sum: ReactNode; sw?: SW; open?: boolean; action?: ReactNode; bad?: boolean; bare?: boolean; children?: ReactNode }) {
  return (
    <section className={`ac-card${bad ? " ac-card--bad" : ""}`} data-open={open ? "true" : undefined}>
      <div className="ac-card-r">
        <span className={`ac-card-ic${bare ? " ac-card-ic--bare" : ""}`}>{icon}</span>
        <span className="ac-card-t">
          <strong>{title}</strong>
          {desc ? <span className="ac-card-d">{desc}</span> : null}
          {sw ? <StatusWord state={sw}>{sum}</StatusWord> : <span className="ac-card-s">{sum}</span>}
        </span>
        {action ? <span className="ac-card-a">{action}</span> : null}
        <span className="ac-card-ch"><Icon name="submenu" size={14} /></span>
      </div>
      {open && children ? <div className="ac-card-b">{children}</div> : null}
    </section>
  );
}

function placeDesc(p: Proj): string {
  const a = ACCTS[p.a];
  const where = p.place.k === "folder" ? `Your folder · ${p.place.path}` : placeLabel(p.place);
  if (p.copy) return `${where} · copy ${p.copy.k === "kept" ? "kept by Maude" : "in your folder"}`;
  return a.kind === "cloud" ? `${where} · also on Maude Cloud` : `${where} · only on this Mac`;
}

/** General's first card — This project: where it lives, which account, does it connect; the one fix in its header. */
function ThisProjectCard({ p, conn, open = false }: { p: Proj; conn: Conn; open?: boolean }) {
  const a = ACCTS[p.a];
  const c = CONN[conn];
  const bad = conn === "missing" || conn === "rejected";
  const status = conn === "rejected" ? "Sign-in stopped working" : conn === "local" ? "Only on this Mac" : c.line;
  return (
    <SCard bare bad={bad} open={open} icon={<Sq p={p} size="lg" />} title={<>This project <span className="ac-card-q">{p.name}</span></>} desc={placeDesc(p)} sw={c.sw} sum={status}
      action={bad && !open ? <Btn primary>Sign in again</Btn> : undefined}>
      <Row k="Lives in"><PlaceChip p={p.place} /><Btn>Change…</Btn></Row>
      <Row k="Account"><span className="ac-inline"><Face a={p.a} size="sm" />{a.kind === "local" ? "No account" : a.email}</span><Btn ghost>Switch…</Btn></Row>
      <Row k="Connection"><StatusWord state={c.sw}>{status}</StatusWord></Row>
      {bad ? (
        <div className="ac-callout">
          <span className="ac-callout-ic"><BrokenLink size={14} /></span>
          <span className="ac-callout-t"><strong>Your sign-in to design.example.com stopped working.</strong><span>Changes wait on this Mac and go out after you sign in.</span></span>
          <Btn primary>Sign in again</Btn>
        </div>
      ) : null}
      {conn === "local" ? <div className="ac-acts"><Btn icon="cloud">Put on Maude Cloud…</Btn><Btn icon="server">Link your server…</Btn></div> : <Fold label="Sync details" hint="Project files · trash · first link" />}
    </SCard>
  );
}

/** The rest of General (general-section.jsx), one card each, closed — the line says what is set. */
function GeneralRest() {
  return (
    <>
      <SCard icon={<Icon name="view" size={16} />} title="Look" desc="How Maude looks on this Mac." sum="Dark" />
      <SCard icon={<Icon name="frame" size={16} />} title="Canvas and view" desc="What sits on the canvas with your work." sum="Zoom controls and annotations on · minimap off" />
      <SCard icon={<Icon name="terminal" size={16} />} title="Terminal" desc="The maude command in your terminal." sum="Opens projects in Maude" />
      <SCard icon={<Icon name="type" size={16} />} title="Keyboard" desc="Shortcuts on the canvas." sum="Single-key shortcuts on" />
      <SCard icon={<Icon name="panel-left" size={16} />} title="Layout" desc="Where the panels sit." sum="Panels in their usual places" />
    </>
  );
}

/** Settings › Connections — only the person's own integrations (no project linking). */
function ConnectionCards() {
  return (
    <>
      <SCard open icon={<Icon name="spark" size={16} />} title="AI — your Claude account" desc="Pro or Max, or an API key." sw="ok" sum="Connected · alice@example.com">
        <Row k="Signed in as">alice@example.com</Row>
        <Row k="Plan">Claude Max</Row>
        <div className="ac-acts"><Btn>Change…</Btn><Btn>Sign out…</Btn></div>
        <Fold hint="API key · Claude Code version" />
      </SCard>
      <SCard icon={<Icon name="component" size={16} />} title="Figma" desc="For Import from Figma." sw="off" sum="Not connected" action={<Btn>Connect…</Btn>} />
      <SCard icon={<Icon name="link" size={16} />} title="GitHub" desc="GitHub projects and invites by username." sw="ok" sum="Signed in as @alice" action={<Btn>Sign out…</Btn>} />
      <SCard icon={<Icon name="image" size={16} />} title="AI images, video and voice" desc="Your own keys for pictures, video and voice." sw="ok" sum="2 providers · fal, ElevenLabs" action={<Btn>Manage…</Btn>} />
      <p className="ac-hint ac-cards-foot">Which account a project uses, and where it lives, is in General › This project.</p>
    </>
  );
}

/** Settings › Advanced — the same cards; This project's switches moved to General › This project › Sync details. */
function AdvancedCards() {
  return (
    <>
      <SCard icon={<Icon name="spark" size={16} />} title="Generation spend" desc="Limits for AI pictures, video and voice." sum="Stops at $5 a session and $20 a day · asks before a job over $2" />
      <SCard open icon={<Icon name="laptop" size={16} />} title="This Mac" desc="Version, updates, the local server." sum="Maude 2.1.1 · port 4402 · keys in the macOS Keychain">
        <div className="ac-card-cols">
          <div>
            <Row k="Version"><span className="k-mono">2.1.1 · build 431</span></Row>
            <Row k="Update">Up to date</Row>
            <Row k="Local server port"><span className="input ac-in ac-in--num k-mono">4402</span></Row>
          </div>
          <div>
            <Row k="Runtime"><span className="k-mono">Bun 1.3.4 · built in</span></Row>
            <Row k="Keys are kept in"><span className="k-mono">macOS Keychain</span></Row>
            <Row k="Server build"><span className="k-mono">maude-server</span></Row>
          </div>
        </div>
      </SCard>
      <SCard icon={<Icon name="terminal" size={16} />} title="Claude Code" desc="The plugins Maude’s AI runs with." sum="design 2.1.1 · flow 2.1.1 · installs by itself" />
      <SCard icon={<Icon name="history" size={16} />} title="Decision memory" desc="Remembers why things are the way they are." sum="On · 523 decisions in this project" />
      <SCard icon={<Icon name="video" size={16} />} title="Engines" desc="Subtitles and video keyframes." sum="Auto · subtitles on this Mac, keyframes by ffmpeg" />
      <SCard icon={<Icon name="lock" size={16} />} title="Privacy" desc="What leaves this Mac besides your work." sum="No usage data · asks before adding logs to a bug report" />
      <SCard icon={<Icon name="pulse" size={16} />} title="Experimental" desc="Previews of what comes next." sum="2 previews, both off" />
    </>
  );
}

/* ═══ F · Link your server ══════════════════════════════════════════════════════════════════════ */

function Spin({ sm = false }: { sm?: boolean }) {
  return <svg className={`ac-spin${sm ? " ac-spin--sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" strokeWidth={sm ? 3 : 2.5} strokeLinecap="round" strokeDasharray="18 60" /></svg>;
}

type LinkState = "empty" | "testing" | "answered" | "invite" | "advanced" | "waiting" | "no-answer" | "not-maude";
function LinkDialog({ s, width }: { s: LinkState; width: number }) {
  const style: CSSProperties = { ...FLOW, width };
  if (s === "waiting") {
    return (
      <div className="k-dialog ac-dlg" style={style}>
        <p className="k-dialog-t">Finish signing in in your browser</p>
        <div className="k-dialog-b ac-dlg-b">
          <div className="ac-wait"><span className="ac-wait-ic"><Spin /></span><span><strong>design.example.com</strong> opened in your browser. Sign in there — this closes by itself when you’re done.</span></div>
          <p className="ac-fine">Logo ideas starts syncing right after. Nothing is sent before you sign in.</p>
        </div>
        <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn">Open the page again</span></div>
      </div>
    );
  }
  const typed = s !== "empty";
  const ok = s === "answered" || s === "invite" || s === "advanced";
  const err = s === "no-answer" || s === "not-maude";
  return (
    <div className="k-dialog ac-dlg" style={style}>
      <p className="k-dialog-t">Link your server</p>
      <div className="k-dialog-b ac-dlg-b">
        <p>Sync <strong>Logo ideas</strong> with a Maude server your team runs.</p>
        <span className="ac-lab">Address</span>
        <span className={`input ac-in ac-in--lg${typed ? "" : " ac-in--ph"}${err ? " ac-in--bad" : ""}`}>{typed ? <>design.example.com{s === "testing" ? <i className="k-caretline" /> : null}</> : "design.example.com"}</span>
        {s === "empty" ? <span className="ac-test ac-test--hint">Ask whoever runs it for the address. It’s checked as you type.</span> : null}
        {s === "testing" ? <span className="ac-test"><Spin sm />Checking design.example.com…</span> : null}
        {ok ? <span className="ac-test ac-test--ok"><Icon name="check" size={13} />design.example.com answers — Maude 2.1.0</span> : null}
        {s === "no-answer" ? <span className="ac-test ac-test--bad"><Icon name="problem" size={13} />design.example.com didn’t answer. Check the address, or try again when this Mac is online.</span> : null}
        {s === "not-maude" ? <span className="ac-test ac-test--bad"><Icon name="problem" size={13} />design.example.com answers, but it isn’t a Maude server. Check the address with whoever runs it.</span> : null}

        <span className={`btn btn--primary ac-btn-full${ok ? "" : " ac-btn-off"}`}>Sign in in your browser</span>
        {s === "invite" ? (
          <div className="ac-invite">
            <span className="ac-lab">Invite link</span>
            <span className="input ac-in ac-in--lg ac-in--clip">https://design.example.com/join/7Q4-K2M<i className="k-caretline" /></span>
            <span className="ac-test ac-test--ok"><Icon name="check" size={13} />From Tereza · Can edit · Website 2027</span>
          </div>
        ) : (
          <span className="btn btn--ghost ac-btn-full">I have an invite link</span>
        )}

        <Fold open={s === "advanced"} hint="Sign-in key · folder">
          <span className="ac-lab">Sign-in key</span>
          <span className="input ac-in ac-in--ph">Paste a key the server’s admin gave you</span>
          <span className="ac-test ac-test--hint">Instead of the browser. It stays in this Mac’s Keychain.</span>
          <span className="ac-lab ac-lab--gap">Folder on this Mac</span>
          <span className="ac-radio" data-on="true"><i />Keep a copy for me<span className="ac-q">— nothing to manage</span></span>
          <span className="ac-radio"><i />Use my folder…</span>
          <span className="ac-pick"><span className="input ac-in ac-in--ph k-mono">~/git/logo-ideas</span><Btn>Choose…</Btn></span>
        </Fold>
      </div>
      <div className="k-dialog-a"><span className="btn">Cancel</span></div>
    </div>
  );
}

/* ═══ H · Home ══════════════════════════════════════════════════════════════════════════════════ */

function HomeAcct({ a, conn, n }: { a: AcctKey; conn: Conn; n: string }) {
  const acct = ACCTS[a];
  const c = CONN[conn];
  const bad = conn === "rejected" || conn === "missing";
  return (
    <span className={`ac-hacct${bad ? " ac-hacct--bad" : ""}`}>
      <Face a={a} conn={conn} size="lg" />
      <span className="ac-hacct-t">
        <strong>{acct.email}</strong>
        <span>{acct.kind === "cloud" ? "Maude Cloud" : "design.example.com"} · {n}</span>
        <StatusWord state={c.sw}>{conn === "rejected" ? "Sign-in stopped working" : conn === "ok" ? "Connected" : c.name}</StatusWord>
      </span>
      {bad ? <Btn primary>Sign in again</Btn> : null}
    </span>
  );
}
/** Home's location chip: the account for a synced project, the place for a project only on this Mac. */
function HomeChip({ p }: { p: Proj }) {
  const a = ACCTS[p.a];
  if (a.kind === "cloud") return <span className="ac-place"><Icon name="cloud" size={12} /><span>{a.email}</span></span>;
  if (a.kind === "server") return <span className="ac-place"><Icon name="server" size={12} /><span>design.example.com</span></span>;
  return <PlaceChip p={p.place} path={false} />;
}
function HomeRow({ p, hl = false }: { p: Proj; hl?: boolean }) {
  const c = CONN[p.conn];
  const path = p.place.k === "folder" ? p.place.path : p.copy?.k === "folder" ? p.copy.path : null;
  return (
    <span className="ac-hrow" data-hl={hl ? "true" : undefined}>
      <span className="k-stack ac-hrow-pic">{p.arts.map((art, i) => <Thumb key={i} art={art} />)}</span>
      <span className="ac-hrow-name"><strong>{p.name}</strong><span>{p.canvases} {p.canvases === 1 ? "canvas" : "canvases"} · {p.when}</span></span>
      <span className="ac-hrow-where"><HomeChip p={p} />{path ? <span className="k-mono ac-hrow-path">{path}</span> : null}</span>
      <span className="ac-hrow-st"><Face a={p.a} conn={p.conn} size="sm" /><StatusWord state={c.sw}>{p.conn === "ok" ? "Connected" : p.conn === "rejected" ? "Sign-in stopped working" : c.name}</StatusWord></span>
    </span>
  );
}

/* ═══ A · The model ═════════════════════════════════════════════════════════════════════════════ */

function ModelCol({ a, projects, conn = "ok", label }: { a: AcctKey; projects: Proj[]; conn?: Conn; label: string }) {
  const acct = ACCTS[a];
  return (
    <div className="ac-mcol">
      <span className="ac-mcol-k">{label}</span>
      <div className="ac-macct">
        <Face a={a} conn={conn} size="lg" />
        <span className="ac-macct-t">
          <strong>{acct.kind === "local" ? "No account" : acct.email}</strong>
          <span>{acct.kind === "cloud" ? "Maude Cloud · cloud.maude.sh" : acct.kind === "server" ? "Your server · design.example.com" : "Only on this Mac"}</span>
          <StatusWord state={CONN[conn].sw}>{conn === "rejected" ? "Sign-in stopped working" : conn === "local" ? "Nothing to connect" : "Connected"}</StatusWord>
        </span>
      </div>
      <div className="ac-mprojs">
        {projects.map((p) => (
          <div key={p.name} className="ac-mproj">
            <span className="ac-mproj-hd"><Sq p={p} size="sm" /><strong>{p.name}</strong></span>
            <PlaceChip p={p.place} />
            <span className="ac-mproj-q">
              {acct.kind === "cloud" ? <><Icon name="cloud" size={11} />Also on Maude Cloud — from any Mac</> : null}
              {p.copy ? <><PlaceIcon p={p.copy} size={11} />{p.copy.k === "kept" ? "Copy kept by Maude" : <>Copy in <span className="k-mono">{p.copy.k === "folder" ? p.copy.path : ""}</span></>}</> : null}
              {acct.kind === "local" ? <><Icon name="laptop" size={11} />Nothing leaves this Mac</> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelBoard() {
  return (
    <Closeup title="Accounts → projects → where each one lives" sub="Alice has two Maude Cloud accounts, a sign-in on her team’s server, and two projects on no account at all. Every project answers three questions: which account, which place, does it connect."
      note={<Note n={1} title="Exactly three places — and a project is always in one.">Your folder (a folder you chose, the path is shown) · Kept by Maude (a copy in the background, no path to manage) · On your server. A Maude Cloud project opens from any Mac; on this Mac its copy is your folder or kept by Maude.</Note>}>
      <div className="ac-model">
        <ModelCol label="Maude Cloud account" a="alice" projects={[P_BRAND, P_PORT]} />
        <ModelCol label="Maude Cloud account" a="bright" projects={[P_APP, P_SPRING]} />
        <ModelCol label="Your server" a="server" conn="rejected" projects={[P_DS, P_WEB]} />
        <ModelCol label="This Mac only" a="mac" conn="local" projects={[P_LOGO, P_MOOD]} />
      </div>
      <div className="ac-legend">
        {([
          [<Icon key="f" name="folder" size={18} />, "Your folder", "A folder you chose — usually your own repo. The path is shown; Show in Finder opens it.", "~/git/brand-site"],
          [<KeptGlyph key="k" size={18} />, "Kept by Maude", "Maude keeps the copy in the background. No path, nothing to manage.", "no path"],
          [<Icon key="s" name="server" size={18} />, "On your server", "Your team runs it. This Mac keeps a copy — kept by Maude, or in your folder.", "design.example.com"],
        ] as [ReactNode, string, string, string][]).map(([ic, t, d, ex]) => (
          <div key={t} className="ac-leg">
            <span className="ac-leg-ic">{ic}</span>
            <span className="ac-leg-t"><strong>{t}</strong><span>{d}</span><span className="chip ac-leg-ex">{ex}</span></span>
          </div>
        ))}
        <div className="ac-leg">
          <span className="ac-leg-faces"><Face a="alice" size="lg" /><Face a="server" size="lg" /><Face a="mac" size="lg" /></span>
          <span className="ac-leg-t"><strong>The face says what kind</strong><span>A circle with a letter is a Maude Cloud account; a server tile is your server; a laptop is this Mac only.</span></span>
        </div>
      </div>
    </Closeup>
  );
}

/* ═══ B · Connection states ═════════════════════════════════════════════════════════════════════ */

function SignInToast({ missing = false, at = "free" }: { missing?: boolean; at?: "free" | "dock" }) {
  return (
    <div className={`island k-toast ${at === "dock" ? "k-toast--dock" : "ac-toast"}`}>
      <span className="k-toast-ic ac-toast-bad"><BrokenLink size={15} /></span>
      <span className="k-toast-txt">{missing ? "This project is on design.example.com — sign in to sync." : "Your sign-in to design.example.com stopped working. Changes wait on this Mac."}</span>
      <span className="btn btn--ghost btn--sm k-toast-act">{missing ? "Sign in" : "Sign in again"}</span>
    </div>
  );
}

function StatesBoard() {
  const order: Conn[] = ["ok", "syncing", "offline", "missing", "rejected", "unreachable", "local"];
  return (
    <Closeup title="Connection states — the account chip, as it sits in the top bar" sub="Six states for a synced project, one for a project only on this Mac. The face carries at most one badge; the save word beside it says the same thing in words."
      note={<Note n={2} title="The badge says whose move it is.">The broken link appears only for a sign-in the person can repair in one click. Offline greys the face (the network — nothing to do); a server that doesn’t answer gets the warning glyph (the server’s side). A project only on this Mac is a plain laptop — never a badge.</Note>}>
      <div className="ac-states">
        <div className="ac-st ac-st--hd"><span>In the top bar</span><span>State</span><span>What it says — avatar menu and Settings</span><span>One click</span></div>
        {order.map((k) => {
          const c = CONN[k];
          return (
            <div key={k} className="ac-st">
              <span className="ac-st-bar"><span className="island ac-st-isl"><AcctChip a={c.a} conn={k} /><span className={`k-saved${c.tone ? ` k-saved--${c.tone}` : ""}`}><Icon name={c.icon} size={16} />{c.word}</span></span></span>
              <span className="ac-st-name"><strong>{c.name}</strong><span>{c.why}</span></span>
              <span className="ac-st-line"><StatusWord state={c.sw}>{c.line}</StatusWord></span>
              <span className="ac-st-fix">{c.fix ? <Btn primary={k === "missing" || k === "rejected"}>{c.fix}</Btn> : <span className="ac-q">—</span>}</span>
            </div>
          );
        })}
      </div>
      <div className="ac-toasts">
        <span className="ac-col-l">Toast — once per session, the two sign-in states only</span>
        <SignInToast missing />
        <SignInToast />
      </div>
    </Closeup>
  );
}

/** A settings window: Brand site, Settings open on one tab. */
function SettingsStage({ tab, note, children }: { tab: STab; note: ReactNode; children: ReactNode }) {
  return (
    <Stage note={note}>
      <Window tabs={TABS_BRAND} activeTab={1}>
        <Canvas><Artboard label="Desktop" kind="web" x={300} y={140} w={403} h={252}><HeroMock /></Artboard></Canvas>
        <ProjectPill project="Brand site" canvas="Homepage" />
        <Cluster conn="ok" />
        <Veil />
        <SettingsSheet tab={tab}>{children}</SettingsSheet>
      </Window>
    </Stage>
  );
}

/* ═══ The canvas ════════════════════════════════════════════════════════════════════════════════ */

export default function AccountsAndConnections() {
  return (
    <DesignCanvas>
      {/* ── A · The model ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="model" title="The model — accounts, projects, places" subtitle="Who you are signed in as, which projects sit under each account, and the one place each project lives">
        <DCArtboard id="ac-model" label="1 · Accounts → projects → where each lives" width={W} height={H} fixed>
          <ModelBoard />
        </DCArtboard>
      </DCSection>

      {/* ── B · Connection states ─────────────────────────────────────────────────────────── */}
      <DCSection id="states" title="Connection states" subtitle="Connected · Syncing · Offline · Sign-in missing · Sign-in stopped working · Server unreachable — and only on this Mac">
        <DCArtboard id="ac-states" label="2 · Seven states, one chip" width={W} height={H} fixed>
          <StatesBoard />
        </DCArtboard>
        <DCArtboard id="ac-toast" label="3 · Sign-in stopped working — the toast, once per session" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Told once, then it waits by the face.">The toast shows the first time this session finds the sign-in broken, with one button. After it goes, the broken-link badge and the save word keep saying it; nothing else interrupts.</Note>}>
            <Window tabs={TABS_DS} activeTab={1}>
              <Canvas><Artboard label="Buttons" kind="web" x={260} y={150} w={520} h={326}><HeroMock headline="Buttons, one family." sub="Primary · secondary · ghost" cta="Primary" /></Artboard></Canvas>
              <ProjectPill project="Design system" canvas="Buttons" />
              <Cluster conn="rejected" />
              <ZoomUndo />
              <Toolbar />
              <SignInToast at="dock" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── C · The avatar menu ───────────────────────────────────────────────────────────── */}
      <DCSection id="menu" title="The avatar menu" subtitle="Project first — name, where it lives, account, status — then what this state needs, then the account, then Project settings">
        <DCArtboard id="ac-menu-broken" label="4 · Sign-in stopped working — the menu opens on the fix" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="The fix is on top, with the address already filled in.">The project block turns red and carries the one button. Sign in again opens design.example.com in the browser — nobody types the address a second time.</Note>}>
            <Window tabs={TABS_DS} activeTab={1}>
              <Canvas><Artboard label="Buttons" kind="web" x={180} y={150} w={520} h={326}><HeroMock headline="Buttons, one family." sub="Primary · secondary · ghost" cta="Primary" /></Artboard></Canvas>
              <ProjectPill project="Design system" canvas="Buttons" />
              <Cluster conn="rejected" open />
              <AcctMenu v="broken" style={{ left: "auto", right: 326, top: 60 }} />
              <ZoomUndo />
              <Toolbar />
            </Window>
          </Stage>
        </DCArtboard>
        <DCArtboard id="ac-menus" label="5 · Four projects, one menu" width={W} height={H} fixed>
          <Closeup title="The same menu for every project — the top block and the actions change with the state" sub="Top to bottom: the project (name · where it lives · account · status with the last sync) · what this state needs · Account › Switch account · Project settings."
            note={<Note n={5} title="A local project now has somewhere to go.">Today the card offers nothing for a project only on this Mac. Here it offers the two ways out — Maude Cloud or your server — and the location line tells your folder from a copy Maude keeps.</Note>}>
            <div className="ac-cols">
              <Col label="Maude Cloud · connected" w={322}><AcctMenu v="cloud" style={FLOW} /></Col>
              <Col label="Your server · sign-in stopped working" w={322}><AcctMenu v="broken" style={FLOW} /></Col>
              <Col label="Only on this Mac · your folder" w={322}><AcctMenu v="folder" hl="cloud" style={FLOW} /></Col>
              <Col label="Only on this Mac · kept by Maude" w={322}><AcctMenu v="kept" style={FLOW} /></Col>
            </div>
          </Closeup>
        </DCArtboard>
        <DCArtboard id="ac-switch" label="6 · Switch account on a local project — safe, and reversible" width={W} height={H} fixed>
          <Closeup title="Switch account never moves a project to an empty account" sub="Today “Sign in as another account…” on a local project binds it to a fresh, empty account; it then reads “This Mac only” with no way back. Here the list is the accounts already on this Mac, “No account” is one of them, and a sheet says what happens."
            note={<Note n={6} title="Nothing moves, and the way back is in the same list.">Picking an account only decides which account the project uses when it goes to Maude Cloud. The folder stays where it is; nothing is uploaded until the person chooses Put on Maude Cloud. Adding an account or a server is the foot of the list.</Note>}>
            <div className="ac-switch">
              <div className="ac-switch-m">
                <AcctMenu v="folder" hl="switch" style={FLOW} />
                <SwitchSub current="mac" style={{ left: 316, top: 222 }} />
              </div>
              <Dialog title="Use hello@brightside.example for Logo ideas?" primary="Use account" width={440} style={{ ...FLOW, marginTop: 120 }}>
                <div className="ac-conf">
                  <span className="ac-conf-r"><Icon name="folder" size={14} /><span>Logo ideas stays in <span className="k-mono">~/git/logo-ideas</span>. Nothing is moved or uploaded.</span></span>
                  <span className="ac-conf-r"><Icon name="cloud" size={14} /><span>When you put it on Maude Cloud, it goes to <strong>hello@brightside.example</strong>.</span></span>
                  <span className="ac-conf-r"><Icon name="undo" size={14} /><span>Switch back to No account at any time, from the same list.</span></span>
                </div>
              </Dialog>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── D · Sync ──────────────────────────────────────────────────────────────────────── */}
      <DCSection id="sync" title="Sync — a local project" subtitle="Menu › Diagnostics › Sync: “nothing to sync” becomes two ways out">
        <DCArtboard id="ac-sync" label="7 · Only on this Mac — and linked, for comparison" width={W} height={760} fixed>
          <Closeup title="Sync on a project only on this Mac offers the next step, not a dead end" sub="Was: “This project isn’t linked to the cloud, so there is nothing to sync. Everything is on this Mac.” — with no button."
            note={<Note n={7} title="Two buttons, the same two as the avatar menu.">Create project on Maude Cloud uses the move that exists today; Link your server opens the one dialog (12–13). Either way the folder stays where it is.</Note>}>
            <div className="ac-cols">
              <Col label="Only on this Mac" w={500}>
                <div className="island island--pad ac-sync">
                  <div className="ac-sync-hd"><strong>Sync · Logo ideas</strong><StatusWord state="off">Only on this Mac</StatusWord></div>
                  <div className="ac-sync-empty">
                    <span className="ac-sync-ic"><Icon name="laptop" size={22} /></span>
                    <strong>Only on this Mac</strong>
                    <p>Nothing leaves this Mac yet. Put it on Maude Cloud to open it from any Mac and share it — or sync it with your own server.</p>
                    <div className="ac-acts ac-acts--c"><Btn primary icon="cloud">Create project on Maude Cloud</Btn><Btn icon="server">Link your server</Btn></div>
                    <p className="ac-fine">It stays in <span className="k-mono">~/git/logo-ideas</span> either way.</p>
                  </div>
                </div>
              </Col>
              <Col label="Linked, all good" w={500}>
                <div className="island island--pad ac-sync">
                  <div className="ac-sync-hd"><strong>Sync · Brand site</strong><StatusWord state="ok">Up to date</StatusWord></div>
                  <Row k="Account"><span className="ac-inline"><Face a="alice" size="sm" />alice@example.com<span className="ac-q">Maude Cloud</span></span></Row>
                  <Row k="On this Mac"><PlaceChip p={P_BRAND.place} /></Row>
                  <Row k="Last sync">2 min ago</Row>
                  <Row k="Project files">1 318 · all here</Row>
                  <Row k="Assets">247 · all here</Row>
                  <Fold hint="Address, commands" />
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── E · Settings ──────────────────────────────────────────────────────────────────── */}
      <DCSection id="settings" title="Settings — one column of cards" subtitle="General, Connections and Advanced share one card: icon · title · one line · status, a chevron to open it, its own Advanced inside">
        <DCArtboard id="ac-general" label="8 · Settings › General — This project first, every section a card" width={W} height={H} fixed>
          <SettingsStage tab="General" note={<Note n={8} title="One column, one card per section — the Connections look, everywhere.">This project opens first: where it lives, which account, does it connect — with Change… and Switch… beside them. The rest stay closed and say what is set. The old Advanced › This project switches live under Sync details.</Note>}>
            <ThisProjectCard p={P_BRAND} conn="ok" open />
            <GeneralRest />
          </SettingsStage>
        </DCArtboard>
        <DCArtboard id="ac-general-states" label="9 · This project — broken, local, closed" width={W} height={H} fixed>
          <Closeup title="The This project card in the states that need the person" sub="Status words are the chip’s (2). Closed, the card still carries the one fix — Sign in again sits in its header."
            note={<Note n={9} title="The fix never hides inside a closed card.">Open or closed, a broken sign-in shows its red status and Sign in again. A project only on this Mac offers its two ways out when opened; Change… picks another folder or lets Maude keep it.</Note>}>
            <div className="ac-cols">
              <Col label="Your server · sign-in stopped working · open" w={460}>
                <div className="ac-panel ac-cards"><ThisProjectCard p={P_DS} conn="rejected" open /></div>
              </Col>
              <Col label="Only on this Mac · open, Change… pressed" w={460}>
                <div className="ac-panel ac-cards"><ThisProjectCard p={P_LOGO} conn="local" open /></div>
                <div className="k-menu ac-change">
                  <span className="k-mgroup">Where Logo ideas lives</span>
                  <MRow icon={<Icon name="check" size={14} />} label="Your folder" note="~/git/logo-ideas" />
                  <MRow label="Use another folder…" />
                  <MRow label="Let Maude keep it" note="no path" />
                  <span className="k-msep" />
                  <MRow icon={<Icon name="folder" size={14} />} label="Show in Finder" />
                </div>
              </Col>
              <Col label="Closed — four projects" w={384}>
                <div className="ac-panel ac-cards">
                  <ThisProjectCard p={P_BRAND} conn="ok" />
                  <ThisProjectCard p={P_PORT} conn="syncing" />
                  <ThisProjectCard p={P_DS} conn="rejected" />
                  <ThisProjectCard p={P_MOOD} conn="local" />
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
        <DCArtboard id="ac-connections" label="10 · Settings › Connections — yours, in every project" width={W} height={H} fixed>
          <SettingsStage tab="Connections" note={<Note n={10} title="Connections is about you; This project is about this project.">Claude, Figma, GitHub and the AI providers follow the person into every project. Maude Cloud and your server belong to a project, so they moved to General › This project.</Note>}>
            <ConnectionCards />
          </SettingsStage>
        </DCArtboard>
        <DCArtboard id="ac-advanced" label="11 · Settings › Advanced — the same cards, one open" width={W} height={H} fixed>
          <SettingsStage tab="Advanced" note={<Note n={11} title="Seven cards; closed, each says what is set.">The status line says what is set, so most visits end without opening anything. This project left Advanced — its switches are under General › This project › Sync details. ⌘K still finds every row inside by name.</Note>}>
            <AdvancedCards />
          </SettingsStage>
        </DCArtboard>
      </DCSection>

      {/* ── F · Link your server ──────────────────────────────────────────────────────────── */}
      <DCSection id="link" title="Link your server — one dialog" subtitle="Replaces Settings “Add a team server” and Home “Sign in to your own hub”: the address with a check as you type, sign-in in the browser, an invite link, and Advanced for a key and the folder">
        <DCArtboard id="ac-link-a" label="12 · Empty · checking · answers · an invite link" width={W} height={H} fixed>
          <Closeup title="Type the address — it is checked as you type, then the browser does the sign-in" sub="The primary button wakes only once the server answers. An invite link is the other way in; it fills in the address and the access."
            note={<Note n={12} title="One field, one check, one button.">No Test connection button: the check runs as the address is typed. The answer names the server and its Maude version, so a wrong address shows before anyone signs in.</Note>}>
            <div className="ac-cols ac-cols--dlg">
              <Col label="Empty" w={320}><LinkDialog s="empty" width={320} /></Col>
              <Col label="Checking" w={320}><LinkDialog s="testing" width={320} /></Col>
              <Col label="Answers" w={320}><LinkDialog s="answered" width={320} /></Col>
              <Col label="I have an invite link" w={320}><LinkDialog s="invite" width={320} /></Col>
            </div>
          </Closeup>
        </DCArtboard>
        <DCArtboard id="ac-link-b" label="13 · Advanced open · waiting for the browser · two errors" width={W} height={H} fixed>
          <Closeup title="Advanced holds the two things most people never need" sub="A sign-in key from the server’s admin (instead of the browser), and which folder on this Mac the project uses — a copy kept by Maude unless the person picks a folder."
            note={<Note n={13} title="Errors say what happened and what is safe.">Didn’t answer and isn’t a Maude server are different problems with different next steps; nothing is linked or sent until the sign-in finishes.</Note>}>
            <div className="ac-cols ac-cols--dlg">
              <Col label="Advanced open" w={320}><LinkDialog s="advanced" width={320} /></Col>
              <Col label="Waiting for the browser" w={320}><LinkDialog s="waiting" width={320} /></Col>
              <Col label="The server didn’t answer" w={320}><LinkDialog s="no-answer" width={320} /></Col>
              <Col label="Not a Maude server" w={320}><LinkDialog s="not-maude" width={320} /></Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── H · Home ──────────────────────────────────────────────────────────────────────── */}
      <DCSection id="home" title="Home" subtitle="Accounts on top with their state; every project says where it lives and whether it connects">
        <DCArtboard id="ac-home" label="14 · Home — accounts, and where every project lives" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="One look answers all three questions.">The accounts row says where you are signed in and whether each sign-in works; each project row says which account or place, with the same badge as the top bar. A broken sign-in is fixed from here too.</Note>}>
            <Window tabs={TABS_DS} activeTab={0}>
              <Canvas dots={false}>
                <div className="k-home-bg">
                  <ProjectPill project="Home" home />
                  <div className="island k-home-tr"><span className="icon-btn"><Icon name="search" /></span></div>
                  <div className="ac-home">
                    <p className="ac-home-h">Accounts on this Mac<span className="btn btn--ghost btn--sm">Add an account…</span></p>
                    <div className="ac-haccts">
                      <HomeAcct a="alice" conn="ok" n="2 projects" />
                      <HomeAcct a="bright" conn="ok" n="2 projects" />
                      <HomeAcct a="server" conn="rejected" n="2 projects" />
                    </div>
                    <p className="ac-home-h">Projects<span className="ac-home-sort">Recently opened<Icon name="chevron" size={12} /></span></p>
                    <div className="ac-hrows">
                      <span className="ac-hrow ac-hrow--hd"><span /><span>Project</span><span>Where</span><span>Connection</span></span>
                      {PROJECTS.map((p) => <HomeRow key={p.name} p={p} hl={p.name === "Design system"} />)}
                    </div>
                  </div>
                </div>
              </Canvas>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
