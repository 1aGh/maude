/**
 * @canvas      10 Share and Collaboration — one Share button, people and AI on the same canvas, comments, sync in words
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   co-share-sheet | co-share-roles | co-browser-view |
 *              co-presence | co-follow | co-bring | co-spotlight |
 *              co-comment-thread | co-mention-notify | co-comment-video | co-comment-print |
 *              co-sync-offline | co-sync-back | co-conflict | co-trashed |
 *              co-local-cloud |
 *              co-twelve | co-ask-edit | co-access-ends |
 *              co-share-advanced
 * @brief       "...co te jeste napadne" — Share & Collaboration (plan row 10): Share sheet (invite people, link, roles) ·
 *              presence (faces, cursors, AI cursor) · comment threads · follow someone · sync status words · a conflict
 *              when both edit offline · a local project shared → "move to cloud". Drawn on Alligators brand.
 *
 * Ground truth (apps/hub + apps/studio, 2026-10-06):
 *   · apps/hub/src/role-matrix.mjs — the cell knows owner · member · viewer; a viewer may "look, comment and download";
 *     invite / delete are owner-only. This canvas draws Can edit (member) · Can comment (viewer: look, comment and
 *     download) · Can view (look only — CONTRACT §6). Download and export start at Can comment, said the same way in the
 *     role menu and the matrix (the hub would need a look-only viewer). Proposed, one rule everywhere: editors may MOVE
 *     things to the trash (it is recoverable); only owners CLEAR IT OUT (CONTRACT §7 words). Role menu (co-share-roles), matrix (co-share-advanced) and
 *     Tereza trashing Combine-cisla (co-trashed) all follow it. The hub's delete gate would split into two verbs.
 *   · apps/hub/src/invites.mjs — invites are single-use and expire (Petra's row: expiry + Resend); a self-hosted hub
 *     has only admin/member, "no view-only accounts" (co-share-advanced, column 3).
 *   · apps/hub/src/revocations.mjs — removing a person ends their session (co-access-ends).
 *   · DDR-116 (Keep mine / theirs / both, "zero data loss") — co-conflict draws all three choices, and Version history
 *     showing the version you didn't keep. Proposed UI.
 *   · DDR-078 agents as presence peers (avatar + ✦); 03 AI Chat's "Tereza's AI" outline + tag is reused verbatim.
 *   · Follow and "Bring everyone here" do not exist today (04 md-present-link follows a presenter only) — Proposed.
 *
 * Reused decisions: the Share cluster is the kit ShareCluster (mode switch, canEdit, access) — CoCluster only adds
 * face rings / overflow / a comment count on top via CSS. Share › Advanced is 06 ad-share's fold, verbatim
 * (Links, link rules, sync). Local → cloud follows 02 Onboarding step for step (offer → browser sign-in if needed →
 * Share opens on Invite while it goes up). Thread / Comments panel from 04 (md-th, md-cm). Busy-canvas legend from
 * 01 (cf-busy). Timeline from 07 (ve-tl). Print guides from 08 (ak-pg-*).
 *
 * Toolbars (CONTRACT §2): Edit's toolbar while designing; a comment or a sticky is Preview — the cluster reads Preview and
 * the toolbar is Preview's annotation toolbar (04 md-comment). Can view has no toolbar and opens in Preview (04
 * md-edge-viewer); Can comment would get Hand · Comment (04 md-comment-only).
 *
 * Presence colours: people wear sky / green / yellow / lilac / grey only — never coral, which sits next to the AI
 * spark. You = yellow, Tereza = sky, Jonas = green, Petra = lilac, Lukáš = grey; a crowd repeats tones, names carry it.
 *
 * Convention: every app artboard is a <Stage> — a 1440 × 900 window with its note strip underneath (1440 × 980).
 * Close-ups (co-share-roles, co-bring, co-mention-notify, co-local-cloud, co-ask-edit, co-access-ends,
 * co-share-advanced) are V2 boards with their note at the foot. All chrome from ./_kit; local pieces use `co-`.
 * Scale honesty: Combine-kampan at 27 %, the follow view at 57 %, LetakA6 at 30 %, video-hype at 25 %.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./10 Share and Collaboration.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, Canvas, CanvasesPanel, CommentPin, Cursor, Dialog, GatorMock, Icon, InSelect, Kbd,
  Mark, Note, PanelIcon, ProjectPill, SearchPalette, Selection, ShareCluster, Spark, Stage, Sticky, TABS, Thumb, Toast,
  Toolbar, Tooltip, V2, VideoFrameMock, Window, ZoomUndo,
} from "./_kit";
import type { Folder, Mode, Tab, Tone, Who } from "./_kit";

const W = 1440;
const H = 980;
const TABS2: Tab[] = [TABS.studio, TABS.alligators];

/* ─── People: You, Tereza, Jonas (kit) + the rest of the Alligators team. No coral — that's next to the AI spark. ─── */
const P = {
  petra: { name: "Petra", ini: "P", tone: "lilac" as Tone },
  lukas: { name: "Lukáš", ini: "L", tone: "grey" as Tone },
  klara: { name: "Klára", ini: "K", tone: "yellow" as Tone },
  ondrej: { name: "Ondřej", ini: "O", tone: "sky" as Tone },
  eliska: { name: "Eliška", ini: "E", tone: "green" as Tone },
  radek: { name: "Radek", ini: "R", tone: "grey" as Tone },
  hana: { name: "Hana", ini: "H", tone: "lilac" as Tone },
  filip: { name: "Filip", ini: "F", tone: "sky" as Tone },
  vojta: { name: "Vojta", ini: "V", tone: "green" as Tone },
};
const nameOf = (w: Who) => (typeof w === "string" ? w.toLowerCase() : w.name.toLowerCase());
const nameCap = (w: Who) => (typeof w === "string" ? (w === "you" ? "You" : w[0].toUpperCase() + w.slice(1)) : w.name);

/* ═══ Share cluster — the kit ShareCluster (mode switch · canEdit · access), plus face rings / +N / a count ═══
   The kit draws everything; this wrapper only passes the overflow as a grey "+N" face and sets data-* hooks that
   the CSS uses for a follow ring, an open face, an open Share and an unread count on Comments. */
type Status = "saved" | "syncing" | "offline" | "local";

function CoCluster({
  faces = ["tereza", "jonas"], more, ring, ringAll, ringTone = "sky", faceOpen, status = "saved", statusText, comments, access,
  canEdit = true, mode, open = false, style,
}: {
  faces?: Who[]; more?: number; ring?: string; ringAll?: boolean; ringTone?: Tone; faceOpen?: string; status?: Status; statusText?: string;
  comments?: number | boolean; access?: string; canEdit?: boolean; mode?: Mode; open?: boolean; style?: CSSProperties;
}) {
  const people: Who[] = more ? [...faces, { name: `${more} more here`, ini: `+${more}`, tone: "grey" as Tone }] : faces;
  const at = (n?: string) => (n === "more" ? people.length : n ? faces.findIndex((f) => nameOf(f) === n) + 1 : 0);
  const hooks = {
    "data-ring": ringAll ? "all" : ring ? String(at(ring)) : undefined,
    "data-face-open": faceOpen ? String(at(faceOpen)) : undefined,
    "data-share-open": open ? "true" : undefined,
    "data-cmt": typeof comments === "number" ? "true" : undefined,
    "data-access": access ? "true" : undefined,
  };
  const vars = { "--co-ring": `var(--object-${ringTone})`, "--co-cmt": typeof comments === "number" ? `"${comments}"` : undefined } as CSSProperties;
  return (
    <span className="co-trw" {...hooks} style={vars}>
      <ShareCluster people={people} status={status} statusText={statusText} comments={comments !== undefined && comments !== false}
        mode={mode ?? (canEdit ? "edit" : "viewing")} canEdit={canEdit} access={access} style={style} />
    </span>
  );
}

/* ═══ The Share sheet (02 ob-local-moved + 06 ad-share, one component) ═══════════════════════ */
type Row = { who?: Who; team?: string; sub?: ReactNode; role: string; quiet?: boolean; hl?: boolean; off?: boolean; act?: string; menu?: ReactNode };
const TEAM_LINK = { who: "Anyone in Alligators brand with the link", role: "Can view" };

function ShareSheet({
  title, sub, scope, typed, inviteRole = "Can edit", rows, rowsTitle, link = TEAM_LINK, request, advLabel = "Links, link rules, sync", advOpen, adv, width = 400, isStatic = false, style, children,
}: {
  title: string; sub?: ReactNode; scope?: "canvas" | "project"; typed?: ReactNode; inviteRole?: string; rows: Row[]; rowsTitle?: ReactNode;
  link?: { who: string; role: string } | null; request?: ReactNode; advLabel?: string; advOpen?: boolean; adv?: ReactNode; width?: number;
  isStatic?: boolean; style?: CSSProperties; children?: ReactNode;
}) {
  return (
    <div className={`co-pop${isStatic ? " co-pop--static" : ""}`} style={{ width, ...style }}>
      <p className="co-sh-t">{title}</p>
      {sub ? <p className="co-sh-sub">{sub}</p> : null}
      {scope ? (
        <span className="seg k-seg co-scope">
          <span className="k-seg-b" aria-pressed={scope === "canvas"}>This canvas</span>
          <span className="k-seg-b" aria-pressed={scope === "project"}>Whole project</span>
        </span>
      ) : null}
      {request}
      <div className="co-inv">
        <span className={`input co-inv-in${typed ? " co-inv-in--on" : ""}`}>{typed ?? <span className="co-inv-ph">Name or email</span>}</span>
        <InSelect value={inviteRole} />
        <span className="btn btn--primary">Invite</span>
      </div>
      <div className="co-ppl">
        {rowsTitle ? <p className="co-ppl-h">{rowsTitle}</p> : null}
        {rows.map((r, i) => (
          <span key={i} className={`co-pp${r.off ? " co-pp--off" : ""}`} data-hl={r.hl ? "true" : undefined}>
            {r.team ? <span className="co-pp-team"><Icon name="people" size={14} /></span> : <Avatar who={r.who} />}
            <span className="co-pp-t"><span className="co-pp-n">{r.team ?? (r.who ? nameCap(r.who) : "")}</span>{r.sub ? <span className="co-pp-s">{r.sub}</span> : null}</span>
            {r.act ? <span className="btn btn--ghost btn--sm co-pp-act">{r.act}</span> : null}
            <span className={`co-role${r.quiet ? " co-role--quiet" : ""}`}>{r.role}{r.quiet ? null : <Icon name="chevron" size={12} />}</span>
            {r.menu}
          </span>
        ))}
      </div>
      {link ? (
        <div className="co-link">
          <span className="co-link-ic"><Icon name="link" size={14} /></span>
          <span className="co-link-t">{link.who}<span>{link.role}</span></span>
          <span className="btn btn--sm">Copy link</span>
        </div>
      ) : null}
      <div className="k-adv" data-open={advOpen ? "true" : undefined}>
        <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{advLabel}</span></span>
        {advOpen ? <div className="co-adv-body">{adv}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ARow({ k, children, mono = false, copy = false }: { k: string; children: ReactNode; mono?: boolean; copy?: boolean }) {
  return (
    <div className="co-arow">
      <span>{k}</span>
      <span className="co-arow-v">{mono ? <span className="co-mono">{children}</span> : children}{copy ? <span className="co-copy" title="Copy"><Icon name="duplicate" size={12} /></span> : null}</span>
    </div>
  );
}

/** Share › Advanced — 06 Advanced's ad-share fold, verbatim: This link · Other ways in · Where it syncs. */
function ShareAdvanced({
  rules = true, app = "maude://alligators/combine-kampan", mac = "localhost:4402/?c=Combine-kampan", hub = "alligators.cloud.maude.sh", last = "6 Oct, 14:05 · 247 assets",
}: { rules?: boolean; app?: string; mac?: string; hub?: string; last?: string }) {
  return (
    <>
      {rules ? (
        <>
          <p className="co-adv-sub">This link</p>
          <ARow k="Who can open"><InSelect value="Team only" /></ARow>
          <ARow k="Role"><InSelect value="Can view" /></ARow>
          <ARow k="Expires"><InSelect value="In 7 days" /></ARow>
          <ARow k="New people join as"><InSelect value="Can edit" /></ARow>
        </>
      ) : null}
      <p className="co-adv-sub">Other ways in</p>
      <ARow k="App link" mono copy>{app}</ARow>
      <ARow k="This Mac only" mono copy>{mac}</ARow>
      <div className="co-arow co-arow--stack"><span>Invite by GitHub username</span><span className="co-inv"><span className="input co-mono co-gh">@username</span><span className="btn btn--sm">Invite</span></span></div>
      <p className="co-adv-sub">Where it syncs</p>
      <ARow k="Hub" mono copy>{hub}</ARow>
      <ARow k="Last synced">{last}</ARow>
      <p className="co-hint">Sync details live in Menu › Diagnostics › Sync.</p>
    </>
  );
}

const KAMPAN_ROWS: Row[] = [
  { who: "you", role: "Owner", quiet: true },
  { who: "tereza", sub: "tereza@alligators.cz", role: "Can edit" },
  { who: "jonas", sub: "jonas@alligators.cz", role: "Can comment" },
  { who: P.petra, sub: "Invited 2 days ago · expires in 5 days", role: "Can view", act: "Resend" },
];

/* ═══ Combine-kampan at 27 % — the busy canvas (01 cf-busy layout, two rows) ═════════════════ */
const KAMPAN = {
  web: { x: 96, y: 140, w: 389, h: 243 },
  post: { x: 520, y: 140, w: 292, h: 292 },
  a4: { x: 850, y: 140, w: 214, h: 303 },
  reel: { x: 96, y: 490, w: 146, h: 260 },
  teaser: { x: 272, y: 490, w: 427, h: 240 },
  story: { x: 730, y: 490, w: 146, h: 260 },
};

function Kampan({ yourAi = true, children }: { yourAi?: boolean; children?: ReactNode }) {
  const k = KAMPAN;
  return (
    <>
      <Artboard label="Web · STAŇ SE GATOREM" kind="web" {...k.web}><GatorMock variant="web" /></Artboard>
      <Artboard label="Post 1:1 · Combine 2026" kind="digital" {...k.post} aiWorking={yourAi ? "AI is making it greener" : undefined} aiAt="below" aiCursor={{ x: "80%", y: "24%" }}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
      <Artboard label="A4 · plakát" kind="print" {...k.a4}><GatorMock variant="poster" /></Artboard>
      <Artboard label="Reels · nábor" kind="video" {...k.reel}><VideoFrameMock vertical caption="ZAPIŠ SE" time="0:12 / 0:30" /></Artboard>
      <Artboard label="16:9 · teaser" kind="video" {...k.teaser}><VideoFrameMock caption="Combine 2026" time="0:21 / 0:45" /></Artboard>
      <Artboard label="Story 9:16 · Zapiš se" kind="digital" {...k.story}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
      {children}
    </>
  );
}

/** Someone else's AI — 03 AI Chat's TheirAi: same spark outline + tag, led by its owner's face. */
function TheirAi({ x, y, w, h, who = "tereza", doing }: { x: number; y: number; w: number; h: number; who?: "tereza" | "jonas"; doing: string }) {
  const name = who === "tereza" ? "Tereza" : "Jonas";
  const tone = who === "tereza" ? "sky" : "green";
  return (
    <>
      <span className="co-their-ol" style={{ left: x - 5, top: y - 5, width: w + 10, height: h + 10 }} />
      <span className="co-their-tagpos" style={{ left: x + w + 5, top: y + h + 8 }}>
        <span className="k-cur-tag k-cur-tag--ai co-their-tag motion-soft"><Spark size={10} color="var(--spark-fg)" /><Avatar who={who} size="sm" />{name}'s AI · {doing}</span>
      </span>
      <span className="co-their-cur" style={{ left: x + w * 0.7, top: y + h * 0.3 }}>
        <svg className="k-ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke={`var(--object-${tone})`} strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </span>
    </>
  );
}

function Ring({ x, y, w, h, tone }: { x: number; y: number; w: number; h: number; tone: Tone }) {
  return <span className="co-ring" style={{ left: x - 2, top: y - 2, width: w + 4, height: h + 4, "--co-ring": `var(--object-${tone})` } as CSSProperties} />;
}

/** Your own cursor — never carries a name tag (kit Cursor always tags; this hides it). */
function OwnCursor({ x, y, tone = "yellow" }: { x: number; y: number; tone?: Tone }) {
  return <span className="co-own"><Cursor color={tone} label="" x={x} y={y} /></span>;
}

function KampanChrome({ children, left = false, zoom = 27 }: { children?: ReactNode; left?: boolean; zoom?: number }) {
  return (
    <>
      <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
      {left ? null : <PanelIcon icon="panel-left" at="left" />}
      <ZoomUndo zoom={zoom} />
      <Toolbar />
      {children}
    </>
  );
}

/* Legend under the presence artboard (01 cf-busy) */
function Legend({ rows }: { rows: [Tone | "ai", string, string][] }) {
  return (
    <div className="co-legend">
      {rows.map(([tone, who, what]) => (
        <span key={who} className="co-lg"><i className={`co-lg-dot co-lg-dot--${tone}`} /><strong>{who}</strong>{what}</span>
      ))}
    </div>
  );
}

function NoteRow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="co-note-row">{children}{aside}</div>;
}

/* ═══ Bring everyone here — the signature moment, as a 3-frame filmstrip ═══════════════════════
   Each cursor glides to you on its own curve and leaves a dotted wake in its own colour. */
type Pt = [number, number];
const bez = (a: Pt, b: Pt, bend: number, t: number): Pt => {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const c: Pt = [mx - (dy / len) * bend, my + (dx / len) * bend];
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
const ME: Pt = [214, 236];
const MOVERS: { who: Who; tone: Tone; from: Pt; to: Pt; bend: number }[] = [
  { who: "tereza", tone: "sky", from: [372, 30], to: [252, 206], bend: -60 },
  { who: "jonas", tone: "green", from: [26, 286], to: [160, 252], bend: -44 },
  { who: P.petra, tone: "lilac", from: [374, 274], to: [256, 270], bend: 30 },
];

function Wake({ m, t }: { m: (typeof MOVERS)[number]; t: number }) {
  const n = 16;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const k = (i + 1) / (n + 1);
        const [x, y] = bez(m.from, m.to, m.bend, t * k);
        return <circle key={i} cx={x + 4} cy={y + 4} r={1.2 + k * 3.4} fill={`var(--object-${m.tone})`} stroke="var(--object-ink)" strokeOpacity={0.18 * k} strokeWidth={0.75} opacity={0.15 + k * 0.85} />;
      })}
    </>
  );
}

function BringFrame({ step }: { step: 1 | 2 | 3 }) {
  const t = step === 1 ? 0 : step === 2 ? 0.62 : 1;
  return (
    <MiniWin w={448} h={360}>
      <Canvas>
        <Artboard label="Web" kind="web" x={24} y={74} w={130} h={82}><GatorMock variant="web" /></Artboard>
        <Artboard label="Post 1:1" kind="digital" x={172} y={74} w={82} h={82}><GatorMock variant="social" headline="COMBINE" /></Artboard>
        <Artboard label="A4" kind="print" x={270} y={74} w={58} h={82}><GatorMock variant="poster" headline="STAŇ SE" /></Artboard>
        {step === 2 ? <span className="co-beacon" style={{ left: ME[0], top: ME[1] }}><i /><i /></span> : null}
        {step === 3 ? <span className="co-beacon co-beacon--rest" style={{ left: ME[0], top: ME[1] }}><i /></span> : null}
        {step === 2 ? <svg className="co-wake" width="448" height="320" aria-hidden="true">{MOVERS.map((m) => <Wake key={nameOf(m.who)} m={m} t={t} />)}</svg> : null}
        {MOVERS.map((m) => {
          const [x, y] = bez(m.from, m.to, m.bend, t);
          return <Cursor key={nameOf(m.who)} name={typeof m.who === "string" ? m.who : m.who.name} color={m.tone} x={Math.round(x)} y={Math.round(y)} />;
        })}
        <OwnCursor x={ME[0]} y={ME[1]} />
      </Canvas>
      {step === 1 ? (
        <SearchPalette query="bring" style={{ width: 300, top: 22 }} groups={[{ title: "Actions", rows: [
          { label: "Bring everyone here", icon: "people", meta: "3 people", selected: true },
          { label: "Follow Tereza", icon: "view" },
        ] }]} />
      ) : null}
      {step === 2 ? <span className="co-corners" style={{ "--co-ring": "var(--object-yellow)" } as CSSProperties}><i /><i /><i /><i /></span> : null}
      {step === 3 ? (
        <>
          <span className="co-frame" style={{ "--co-ring": "var(--object-yellow)" } as CSSProperties} />
          <span className="island co-fpill co-fpill--sm" style={{ "--co-ring": "var(--object-yellow)" } as CSSProperties}><Avatar who="you" size="sm" />Everyone here is following you<span className="btn btn--sm">Stop</span></span>
        </>
      ) : null}
    </MiniWin>
  );
}

/* ═══ Comments ═══════════════════════════════════════════════════════════════════════════════ */
function CommentsPanel({ rows, counts = ["Open 4", "Mine 1", "Resolved 6"] }: { rows: { who: Who; on: string; t: string; m: string; cur?: boolean }[]; counts?: [string, string, string] }) {
  return (
    <div className="island co-cm">
      <div className="co-cm-hd"><span>Comments</span><span className="icon-btn k-icon-sm"><Icon name="close" size={14} /></span></div>
      <span className="seg k-seg co-cm-f">{counts.map((c, i) => <span key={c} className="k-seg-b" aria-pressed={i === 0}>{c}</span>)}</span>
      <div className="co-cm-list">
        {rows.map((r) => (
          <span key={r.t} className="row-item co-cm-row" aria-current={r.cur ? "true" : undefined}>
            <Avatar who={r.who} />
            <span className="co-cm-txt"><span className="co-cm-on">{r.on}</span><span className="co-cm-body">{r.t}</span><span className="co-cm-m">{r.m}</span></span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Msg({ who, when, children }: { who: Who; when: string; children: ReactNode }) {
  return <div className="co-th-msg"><Avatar who={who} size="sm" /><span><strong>{nameCap(who)}</strong><em>{when}</em><br />{children}</span></div>;
}

/* ═══ Timeline with comment markers (07 ve-tl, simplified) ═══════════════════════════════════ */
function CommentTimeline({ style }: { style?: CSSProperties }) {
  const X = (s: number) => `${(s / 30) * 100}%`;
  const clips: [number, number, string, string][] = [[0, 6, "", "40 yd sprint"], [6, 11, "co-tl-clip--sky", "Lavička"], [11, 19, "", "Touchdown"], [19, 24, "co-tl-clip--crowd", "Tribuna"], [24, 30, "", "Logo"]];
  return (
    <div className="island co-tl" style={style}>
      <div className="co-tl-hd">
        <span className="icon-btn k-icon-sm"><Icon name="play" size={14} /></span>
        <span className="co-tl-time">0:12 <span>/ 0:30</span></span>
        <span className="co-tl-name"><Icon name="video" size={12} />Reels · nábor</span>
        <span className="co-tl-sp" />
        <span className="co-tl-cnt"><Icon name="comment" size={13} />2 comments on this video</span>
      </div>
      <div className="co-tl-area">
        <span className="co-tl-labs" style={{ top: 22 + 4 + 14 + 4 }}><span style={{ height: 40 }}><Icon name="video" size={12} /></span><span style={{ height: 24 }}><Icon name="pulse" size={12} /></span></span>
        <div className="co-tl-row co-tl-row--marks">
          <span className="co-tl-mk" data-on="true" style={{ left: X(12) }}><span className="k-cpin-dot k-av--sky">T</span></span>
          <span className="co-tl-mk" style={{ left: X(21) }}><span className="k-cpin-dot k-av--green">J</span></span>
        </div>
        <div className="co-tl-row co-tl-row--ruler">{[0, 5, 10, 15, 20, 25, 30].map((s) => <span key={s} className="co-tl-tick" style={{ left: X(s), translate: s === 0 ? "0 0" : s === 30 ? "-100% 0" : undefined }}>{s}s</span>)}</div>
        <div className="co-tl-row co-tl-row--video">{clips.map(([a, b, c, l]) => <span key={l} className={`co-tl-clip ${c}`} style={{ left: `calc(${X(a)} + 1px)`, width: `calc(${X(b - a)} - 2px)` }}><span>{l}</span></span>)}</div>
        <div className="co-tl-row co-tl-row--music"><span className="co-tl-wave">{Array.from({ length: 72 }, (_, i) => <i key={i} style={{ height: `${28 + ((i * 41) % 64)}%` }} />)}</span></div>
        <span className="co-tl-head" style={{ left: X(12), top: 22 }} />
      </div>
    </div>
  );
}

/* ═══ Print flyer with guides (08 ak-pg-*) ═══════════════════════════════════════════════════ */
function Flyer({ front = true }: { front?: boolean }) {
  return (
    <div className="co-flyer">
      {front ? <GatorMock variant="print" headline="FLAG FOOTBALL" sub="Nábor 8–14 let · Út a Čt 17:00" /> : <GatorMock variant="print" headline="JAK SE PŘIHLÁSIT" sub="Trénink zdarma · Kraví hora" />}
      {front ? <span className="co-flyer-url">alligators.cz/flag</span> : null}
      <span className="co-pg-trim" />
      <span className="co-pg-safe" />
    </div>
  );
}

/* ═══ Uniformy-2027 (dresy) — the sync story. Unsent canvases say so in a word, not with the laptop glyph
   (the laptop means Local project in the status slot). ══════════════════════════════════════════ */
const DRESY_FOLDERS = (mark: "offline" | "syncing" | "none"): Folder[] => {
  const m = mark === "offline" ? "not sent" : mark === "syncing" ? "sending" : undefined;
  return [
    { name: "2026", open: true, count: 16, folders: [
      { name: "combine", open: true, count: 6, items: [
        { name: "Combine-kampan", art: "gator-poster", people: ["tereza"] },
        { name: "Combine-cisla", art: "gator-numbers", meta: m },
      ] },
      { name: "dresy", open: true, count: 4, items: [
        { name: "Uniformy-2027", art: "gator-jersey", meta: m },
        { name: "Uniformy-2027 — varianty barev pro sponzory", art: "gator-jersey", meta: mark === "offline" ? m : undefined },
        { name: "Dresy-mockupy-foto", art: "moodboard" },
      ] },
      { name: "social", count: 6 },
    ] },
    { name: "club-web", count: 9 }, { name: "print", count: 6 }, { name: "social", count: 31 }, { name: "legacy", count: 27 },
  ];
};

function Dresy({ changed = false }: { changed?: boolean }) {
  return (
    <>
      <Artboard label="Domácí dres 2027" kind="print" x={330} y={110} w={230} h={290}><GatorMock variant="jersey" headline="Domácí dres 2027" /></Artboard>
      <Artboard label="Venkovní dres 2027" kind="print" x={600} y={110} w={230} h={290}><div className="co-away"><GatorMock variant="jersey" headline="Venkovní dres 2027" /></div></Artboard>
      <Artboard label="Tréninkový dres" kind="print" x={870} y={110} w={230} h={290}><GatorMock variant="jersey" headline="Tréninkový dres" /></Artboard>
      {changed ? <span className="co-change" style={{ left: 640, top: 412 }}><Avatar who="tereza" size="sm" />Tereza changed this · 09:15</span> : null}
    </>
  );
}

/* ═══ Mini windows for close-ups ════════════════════════════════════════════════════════════ */
function MiniWin({ w, h, tabs = [TABS.alligators], active = 0, children }: { w: number; h: number; tabs?: Tab[]; active?: number; children: ReactNode }) {
  return <div className="co-mini" style={{ width: w }}><Window tabs={tabs} activeTab={active} height={h}>{children}</Window></div>;
}

function BrowserWin({ url, w, h, children }: { url: string; w: number; h: number; children: ReactNode }) {
  return (
    <div className="co-mini" style={{ width: w }}>
      <div className="k-window" role="img" aria-label={`Browser — ${url}`} style={{ height: h }}>
        <div className="co-btitle"><span className="k-lights"><i /><i /><i /></span><span className="co-url"><Icon name="lock" size={11} />{url}</span></div>
        <div className="k-body">{children}</div>
      </div>
    </div>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function ShareAndCollaboration() {
  return (
    <DesignCanvas>
      {/* ── 1 · Share ───────────────────────────────────────────────────────────────────────── */}
      <DCSection id="share" title="One Share button — Invite first" subtitle="Invite people by email, say what they can do in plain words, copy a link second — for one canvas or the whole project; a link opens in any browser">
        <DCArtboard id="co-share-sheet" label="1 · Share — Invite is the first thing" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="One Share, Invite first.">An email, a role in words, Invite. Copy link is second, in the link row; This canvas or Whole project comes first. A pending invite can be sent again.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan yourAi={false} /></Canvas>
              <KampanChrome>
                <CoCluster faces={["tereza", "jonas"]} open />
                <PanelIcon icon="spark" at="ai" />
                <ShareSheet
                  title="Share Combine-kampan"
                  scope="canvas"
                  width={440}
                  typed={<><span className="chip co-inv-chip">lukas.novak@gmail.com</span><i className="k-caretline" /></>}
                  rowsTitle={<><span>3 people · 1 invited</span><span>+ 9 in Alligators brand</span></>}
                  rows={[...KAMPAN_ROWS, { team: "Everyone in Alligators brand", sub: "9 people · change it in Whole project", role: "Can edit", quiet: true }]}
                />
              </KampanChrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-share-roles" label="2 · Roles in words — one canvas or the whole project" width={W} height={790} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">What someone can do is said as what they can do.</p>
            <p className="co-closeup-sub">Three roles, each with one line, and one rule for the trash: editors move things there, only owners clear it out. Downloading starts at Can comment. The scope switch at the top of Share decides what the invite covers.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="people" size={12} />Jonas's role, opened</span>
                <ShareSheet isStatic title="Share Combine-kampan" scope="canvas" rows={[
                  KAMPAN_ROWS[0], KAMPAN_ROWS[1],
                  { ...KAMPAN_ROWS[2], hl: true, menu: (
                    <div className="k-menu co-rolemenu" style={{ right: 0, top: "calc(100% + var(--space-1))" }}>
                      <span className="co-rm"><span className="co-rm-ic" /><span className="co-rm-t">Can edit<span>Change artboards, draw, use AI, move to the trash</span></span></span>
                      <span className="co-rm" data-hl="true"><span className="co-rm-ic"><Icon name="check" size={14} /></span><span className="co-rm-t">Can comment<span>Look, comment and download</span></span></span>
                      <span className="co-rm"><span className="co-rm-ic" /><span className="co-rm-t">Can view<span>Look only</span></span></span>
                      <span className="k-msep" />
                      <span className="co-rm"><span className="co-rm-ic" /><span className="co-rm-t">Make owner<span>Owners also invite people and clear out the trash</span></span></span>
                      <span className="co-rm co-rm--danger"><span className="co-rm-ic" /><span className="co-rm-t">Remove from Combine-kampan</span></span>
                    </div>
                  ) },
                  KAMPAN_ROWS[3],
                ]} />
              </div>
              <div className="co-col" style={{ marginLeft: "var(--space-8)" }}>
                <span className="co-col-l"><Icon name="file" size={12} />This canvas — Petra sees one canvas</span>
                <span className="co-ro">
                  <CanvasesPanel project="Alligators brand" count={1} selected="Combine-kampan" items={[{ name: "Combine-kampan", art: "gator-poster", people: ["tereza"], sub: "Shared with you · Can view" }]} style={{ position: "relative", left: 0, top: 0, width: 300 }} foot="Only Combine-kampan was shared with you." />
                </span>
                <p className="co-col-cap">It opens in an Alligators brand tab with just that canvas in the panel, and no New canvas. The project's other 92 canvases stay out of sight.</p>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="folder" size={12} />Whole project — Lukáš sees all 93</span>
                <CanvasesPanel project="Alligators brand" count={93} selected="Combine-kampan" folders={[
                  { name: "2026", open: true, count: 16, folders: [{ name: "combine", count: 6 }, { name: "dresy", count: 4 }, { name: "social", count: 6 }] },
                  { name: "club-web", count: 9 }, { name: "print", count: 6 }, { name: "social", count: 31 }, { name: "legacy", count: 27 },
                ]} style={{ position: "relative", left: 0, top: 0, width: 300 }} foot="New canvases join this list for him too." />
                <p className="co-col-cap">Proposed: a role on one canvas adds to the project role, never lowers it — Tereza can edit everywhere, so a Can view on one canvas changes nothing for her.</p>
              </div>
            </div>
            <div className="co-closeup-note"><Note n={2} title="Three roles, in words.">Can edit, Can comment, Can view — each with what it lets you do. Sharing one canvas shows only that canvas; sharing the project brings every canvas, new ones too.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="co-browser-view" label="3 · A link, opened in a browser" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Any browser is enough to look.">Vojta has no app. The link opens Combine-kampan live on cloud.maude.sh in Preview — cursors and pins, no toolbar. Ask to edit is the way to more.</Note>}>
            <BrowserWin url="alligators.cloud.maude.sh/c/combine-kampan" w={1440} h={900}>
              <Canvas>
                <Kampan yourAi={false}>
                  <Cursor name="tereza" x={990} y={330} />
                  <Cursor name="jonas" x={360} y={300} />
                  <OwnCursor x={640} y={600} tone="green" />
                </Kampan>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CoCluster faces={["tereza", "jonas"]} canEdit={false} access="Can view" mode="preview" />
              <span className="island co-openapp"><Mark size={18} />Open in the Mac app</span>
              <span className="island k-uz co-zoom-only"><span className="btn btn--ghost btn--sm k-zoom">27%</span></span>
            </BrowserWin>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Presence ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="presence" title="Who's here, and where" subtitle="Faces in the Share cluster, named cursors, your AI and Tereza's AI, following someone, bringing everyone to you">
        <DCArtboard id="co-presence" label="4 · Faces, cursors and two AIs" width={W} height={H} fixed>
          <Stage note={<NoteRow aside={<Legend rows={[["green", "Jonas", "Web · selected"], ["sky", "Tereza", "A4 · plakát"], ["lilac", "Petra", "16:9 · teaser"], ["ai", "AI", "yours, Post 1:1"], ["ai", "Tereza's AI", "Story 9:16"]]} />}><Note n={4} title="A face, a cursor, a colour each.">People wear soft colours; only AI wears the spark. Click a face to follow, go to, or bring everyone here.</Note></NoteRow>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan>
                  <Ring {...KAMPAN.web} tone="green" />
                  <Cursor name="jonas" x={360} y={300} />
                  <Cursor name="tereza" x={990} y={330} />
                  <Cursor name={P.petra.name} color="lilac" x={520} y={640} />
                  <TheirAi {...KAMPAN.story} doing="translating to English" />
                </Kampan>
              </Canvas>
              <KampanChrome>
                <CoCluster faces={["tereza", "jonas", P.petra]} more={4} faceOpen="tereza" />
                <PanelIcon icon="spark" at="ai" dot />
                <div className="k-menu co-facemenu" style={{ right: 330, top: 64 }}>
                  <div className="co-fm-hd"><Avatar who="tereza" size="lg" /><span><strong>Tereza</strong><em>On A4 · plakát · Can edit</em></span></div>
                  <span className="k-msep" />
                  <span className="row-item k-mi" data-hl="true"><span className="k-mi-ic"><Icon name="view" size={14} /></span><span className="k-mi-lab">Follow Tereza</span></span>
                  <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="arrow" size={14} /></span><span className="k-mi-lab">Go to A4 · plakát</span></span>
                  <span className="k-msep" />
                  <span className="co-fm-ai"><Spark size={12} />Tereza's AI<em>Story 9:16 · view only</em></span>
                  <span className="k-msep" />
                  <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="people" size={14} /></span><span className="k-mi-lab">Bring everyone here</span></span>
                </div>
              </KampanChrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-follow" label="5 · Following Tereza" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Your view moves with hers.">A thin frame in her colour and one pill say so; her selection is in her colour, not yours. Esc, a scroll or a click stops following.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={-170} y={110} w={616} h={616}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                <Artboard label="A4 · plakát" kind="print" x={494} y={110} w={453} h={640}>
                  <GatorMock variant="poster" />
                  <span className="co-sel-tone" style={{ "--co-ring": "var(--object-sky)" } as CSSProperties}><Selection x={28} y={506} w={266} h={70} editing /></span>
                </Artboard>
                <Cursor name="tereza" x={786} y={632} label="Tereza · typing" />
              </Canvas>
              <span className="co-frame" style={{ "--co-ring": "var(--object-sky)" } as CSSProperties} />
              <span className="island co-fpill" style={{ "--co-ring": "var(--object-sky)" } as CSSProperties}><Avatar who="tereza" />Following Tereza<Kbd>esc</Kbd></span>
              <KampanChrome zoom={57}>
                <CoCluster faces={["tereza", "jonas", P.petra]} more={4} ring="tereza" />
                <PanelIcon icon="spark" at="ai" />
              </KampanChrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-bring" label="6 · Bring everyone here — the moment" width={W} height={700} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">Bring everyone here — every cursor glides to you.</p>
            <p className="co-closeup-sub">Combine-kampan, with Tereza, Jonas and Petra spread across it. One gesture, three moments, under half a second end to end.</p>
            <div className="co-film">
              {([
                [1, "0 ms", "You ask", "From ⌘K or any face in the Share cluster — no overflow needed."],
                [2, "≈ 250 ms", "They glide", "Each cursor takes its own curve and leaves a dotted wake in its colour. Your frame draws in from the corners."],
                [3, "≈ 420 ms", "Everyone's here", "They land around your cursor with a small spring. The wake is gone; the pill says who leads, with Stop."],
              ] as [1 | 2 | 3, string, string, string][]).map(([n, ms, t, cap]) => (
                <div className="co-film-f" key={n}>
                  <span className="co-film-h"><span className="co-film-n">{n}</span><strong>{t}</strong><span className="co-film-ms">{ms}</span></span>
                  <BringFrame step={n} />
                  <p className="co-col-cap">{cap}</p>
                </div>
              ))}
            </div>
            <div className="island co-motion">
              <span><strong>Cursors</strong>spring, 420 ms · nearest first, 40 ms apart</span>
              <span><strong>Wake</strong>dots in the person's colour · gone 160 ms after landing</span>
              <span><strong>Frame</strong>draws in from the corners · 220 ms</span>
              <span><strong>Reduced motion</strong>everyone appears at once · no wake · the frame fades in</span>
            </div>
            <div className="co-closeup-note"><Note n={6} title="A small, warm moment of arriving together.">The one playful spring in Share. On their screens the camera eases to your view and their own pill reads Following You, with esc to leave.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="co-spotlight" label="7 · Everyone's here" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Everyone follows you, until they don't.">The end of the glide (6), at full size. Each person can leave with esc; Stop ends it for all.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan yourAi={false}>
                  <span className="co-beacon co-beacon--rest" style={{ left: 1010, top: 600 }}><i /></span>
                  <Cursor name="tereza" x={1052} y={562} />
                  <Cursor name="jonas" x={950} y={622} />
                  <Cursor name={P.petra.name} color="lilac" x={1058} y={640} />
                  <OwnCursor x={1010} y={600} />
                </Kampan>
              </Canvas>
              <span className="co-frame" style={{ "--co-ring": "var(--object-yellow)" } as CSSProperties} />
              <span className="island co-fpill" style={{ "--co-ring": "var(--object-yellow)" } as CSSProperties}><Avatar who="you" />Everyone here is following you · 3 people<span className="btn btn--sm">Stop</span></span>
              <KampanChrome>
                <CoCluster faces={["tereza", "jonas", P.petra]} ringAll ringTone="yellow" />
                <PanelIcon icon="spark" at="ai" />
              </KampanChrome>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Comments ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="comments" title="Comments together" subtitle="A thread with a mention, how a mention reaches you, a comment on a video frame, a comment on a print artboard">
        <DCArtboard id="co-comment-thread" label="8 · A thread, a mention, Resolve" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="A comment lives on its spot.">C switches to Preview with Comment in hand. @ suggests people with their role and reaches them anywhere (9). Resolve moves the thread to Resolved — kept.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={330} y={110} w={432} h={432}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                <Artboard label="A4 · plakát" kind="print" x={800} y={110} w={318} h={449}><GatorMock variant="poster" /></Artboard>
                <CommentPin who="tereza" x={600} y={170} />
                <CommentPin who="jonas" x={1000} y={462} />
                <div className="co-th" style={{ left: 1082, top: 300, width: 330 }}>
                  <div className="co-th-hd"><span className="co-th-where"><Icon name="print" size={12} />A4 · plakát</span><span className="btn btn--ghost btn--sm"><Icon name="check" size={13} />Resolve</span></div>
                  <Msg who="jonas" when="2 h ago">Datum je moc malé — z tribuny ho nepřečteš.</Msg>
                  <Msg who="tereza" when="1 h ago">Zvětším ho, jen počkám na korekturu textu.</Msg>
                  <div className="co-th-comp co-th-comp--on">
                    <span className="co-th-in">Korektura je hotová, <span className="co-at">@Te</span><i className="k-caretline" /></span>
                    <span className="co-th-send"><Icon name="submenu" size={14} /></span>
                    <div className="k-menu co-mention">
                      <span className="row-item k-mi" data-hl="true"><Avatar who="tereza" size="sm" /><span className="k-mi-lab">Tereza</span><span className="k-mi-keys">Can edit</span></span>
                    </div>
                  </div>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CommentsPanel rows={[
                { who: "jonas", on: "A4 · plakát", t: "Datum je moc malé — z tribuny ho nepřečteš.", m: "2 h ago · 1 reply", cur: true },
                { who: "tereza", on: "Post 1:1 · Combine 2026", t: "Logo o kousek výš, ať nesedí na hráči?", m: "yesterday" },
                { who: P.petra, on: "Reels · nábor · at 0:12", t: "Logo naskočí moc brzo.", m: "yesterday" },
                { who: "you", on: "Web · STAŇ SE GATOREM", t: "Tlačítko ZAPIŠ SE chce víc kontrastu.", m: "Monday" },
              ]} />
              <CoCluster faces={["tereza", "jonas"]} comments mode="preview" />
              <ZoomUndo zoom={40} />
              <Toolbar mode="annotate" tool="comment" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-mention-notify" label="9 · When someone mentions you" width={W} height={700} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">A mention finds you once, wherever you are.</p>
            <p className="co-closeup-sub">Jonas wrote “@” and your name in a thread on A4 · plakát. What you see depends on where you are — each one opens that thread.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="file" size={12} />Maude open, another canvas</span>
                <MiniWin w={460} h={340}>
                  <Canvas>
                    <Artboard label="Domácí dres 2027" kind="print" x={80} y={136} w={120} h={152}><GatorMock variant="jersey" headline="Domácí dres 2027" /></Artboard>
                    <Artboard label="Venkovní dres 2027" kind="print" x={240} y={136} w={120} h={152}><div className="co-away"><GatorMock variant="jersey" headline="Venkovní dres 2027" /></div></Artboard>
                  </Canvas>
                  <CoCluster faces={["jonas"]} comments={1} />
                  <Toast at="free" style={{ left: "50%", top: 64 }} action="Open"><Avatar who="jonas" size="sm" /> Jonas mentioned you on A4 · plakát</Toast>
                </MiniWin>
                <p className="co-col-cap">One toast with Open, and a count on Comments until you read it.</p>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="laptop" size={12} />Maude in the background</span>
                <div className="co-notif">
                  <Mark size={32} />
                  <span className="co-notif-t">
                    <span className="co-notif-app"><span>Maude</span><span>now</span></span>
                    <strong>Jonas mentioned you</strong>
                    <span>Alligators brand · A4 · plakát — “Mrkni prosím na datum, je pořád malé.”</span>
                  </span>
                </div>
                <div className="co-dock" style={{ alignSelf: "center", marginTop: "var(--space-6)" }}>
                  <span className="co-dock-app co-dock-app--dim"><Thumb art="board" w={36} h={36} /></span>
                  <span className="co-dock-app"><Mark size={40} /><span className="co-dock-badge">1</span></span>
                  <span className="co-dock-app co-dock-app--dim"><Thumb art="home" w={36} h={36} /></span>
                </div>
                <p className="co-col-cap">A Mac notification and a count on the Dock icon. Click either and the thread is open.</p>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="cloud" size={12} />Maude closed</span>
                <div className="co-mail">
                  <div className="co-mail-hd"><span>From cloud.maude.sh · 14:05</span><strong>Jonas mentioned you in Alligators brand</strong></div>
                  <div className="co-mail-b">
                    <div className="co-mail-q"><Thumb art="gator-poster" /><span><strong>A4 · plakát</strong><br />“Mrkni prosím na datum, je pořád malé.”</span></div>
                    <span className="btn btn--primary" style={{ alignSelf: "flex-start" }}>Open in the Mac app</span>
                    <span className="co-mail-f">Change which e-mails you get in Settings › General.</span>
                  </div>
                </div>
                <p className="co-col-cap">Proposed: one e-mail per mention, never a digest of everything.</p>
              </div>
            </div>
            <div className="co-closeup-note"><Note n={9} title="One mention, one nudge, in the right place.">In the app a toast; in the background a Mac notification and a Dock count; with Maude closed an e-mail from cloud.maude.sh. All three open the thread, not the top of the canvas.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="co-comment-video" label="10 · A comment on a video frame" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="A pin on a video keeps its moment.">It shows at 0:12 only; each thread is a marker on the timeline, and a click jumps the playhead there.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Reels · nábor" kind="video" x={330} y={72} w={270} h={480} selected size="1080 × 1920"><VideoFrameMock vertical caption="TOUCHDOWN" time="0:12 / 0:30" /></Artboard>
                <CommentPin who="tereza" x={540} y={110} />
                <div className="co-th" style={{ left: 640, top: 96 }}>
                  <div className="co-th-hd"><span className="co-th-where"><Icon name="video" size={12} />Reels · nábor</span><span className="btn btn--ghost btn--sm"><Icon name="check" size={13} />Resolve</span></div>
                  <span className="co-th-meta"><span className="co-frame-chip"><Icon name="clock" size={11} />at 0:12</span></span>
                  <Msg who="tereza" when="yesterday">Logo tu naskočí moc brzo — dej ho až po touchdownu, kolem 0:14.</Msg>
                  <Msg who="jonas" when="3 h ago">Souhlas. A hudba ať tam na vteřinu ztichne.</Msg>
                  <div className="co-th-comp"><span className="co-th-in co-th-ph">Reply…</span><span className="co-th-send"><Icon name="submenu" size={14} /></span></div>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="video-hype" />
              <PanelIcon icon="panel-left" at="left" />
              <CoCluster faces={["tereza", "jonas"]} comments mode="preview" />
              <CommentTimeline style={{ left: 250, width: 880, bottom: 92 }} />
              <ZoomUndo zoom={25} />
              <Toolbar mode="annotate" tool="comment" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-comment-print" label="11 · A comment on a print artboard" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="On paper, a comment speaks millimetres.">The thread says where on the sheet it sits; print guides show the trim and the safe margin it means.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="A · přední FLAG" kind="print" x={560} y={100} w={318} h={442}><Flyer /></Artboard>
                <Artboard label="B · zadní" kind="print" x={918} y={100} w={318} h={442}><Flyer front={false} /></Artboard>
                <span className="co-bleedtag" style={{ left: 1036, top: 548 }}>Bleed 3 mm · trim · safe margin 5 mm</span>
                <CommentPin who="jonas" x={676} y={498} />
                <div className="co-th" style={{ left: 664, top: 536 }}>
                  <div className="co-th-hd"><span className="co-th-where"><Icon name="print" size={12} />A · přední FLAG</span><span className="btn btn--ghost btn--sm"><Icon name="check" size={13} />Resolve</span></div>
                  <span className="co-th-meta"><span className="co-frame-chip">14 mm from the left · 2 mm above the trim</span></span>
                  <Msg who="jonas" when="10 min ago">Adresa webu je moc u kraje — v tiskárně ji můžou uříznout.</Msg>
                  <div className="co-th-comp co-th-comp--on"><span className="co-th-in">Posunu ji nad bezpečný okraj.<i className="k-caretline" /></span><span className="co-th-send"><Icon name="submenu" size={14} /></span></div>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="LetakA6" />
              <PanelIcon icon="panel-left" at="left" />
              <CoCluster faces={["jonas"]} comments mode="preview" />
              <ZoomUndo zoom={30} />
              <Toolbar mode="annotate" tool="comment" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Sync ───────────────────────────────────────────────────────────────────────── */}
      <DCSection id="sync" title="Sync in words" subtitle="A day offline on Alligators brand, back online with 14 changes, the same sticky changed on two Macs, a canvas moved to the trash while you had it open">
        <DCArtboard id="co-sync-offline" label="12 · A day offline on Alligators brand" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Offline is a word, not a wall.">Everything works and stays on this Mac; canvases say “not sent” and the panel foot counts. Comments and invites wait in line.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Dresy />
                <Sticky color="yellow" x={630} y={460} rotate={-2} w={190}>Číslo na zádech větší — 30 cm</Sticky>
                <CommentPin who="you" x={1010} y={150} text={<>Pruh na rukávu sjednotit s helmou.<span className="co-queued"><Icon name="clock" size={12} />Queued — sends when this Mac is online.</span></>} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Uniformy-2027" />
              <CanvasesPanel project="Alligators brand" count={93} selected="Uniformy-2027" folders={DRESY_FOLDERS("offline")} foot="14 changes since yesterday 18:20 — kept on this Mac" />
              <CoCluster faces={[]} status="offline" mode="preview" />
              <Tooltip text="Invites send when this Mac is online." x={1306} y={66} below />
              <ZoomUndo zoom={29} />
              <Toolbar mode="annotate" tool="comment" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-sync-back" label="13 · Back online — 14 changes go up" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Reconnecting is quiet.">The word reads Syncing…; the panel foot counts. Tereza's overnight change wears her name; the sticky that needs a look is marked until someone picks.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Dresy changed />
                <Sticky color="yellow" x={630} y={460} rotate={-2} w={190}>Číslo na zádech větší — 30 cm</Sticky>
                <span className="co-needs" style={{ left: 830, top: 474 }}><Avatar who="you" size="sm" /><Avatar who="jonas" size="sm" />2 versions</span>
                <CommentPin who="you" x={1010} y={150} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Uniformy-2027" />
              <CanvasesPanel project="Alligators brand" count={93} selected="Uniformy-2027" folders={DRESY_FOLDERS("syncing")} foot="Sending 14 changes · 9 sent" />
              <CoCluster faces={["tereza", "jonas"]} status="syncing" mode="preview" />
              <Toast at="top" icon="sync" action="Show">Back online. Your changes are going up; one sticky needs a look.</Toast>
              <ZoomUndo zoom={29} />
              <Toolbar mode="annotate" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-conflict" label="14 · You and Jonas changed the same sticky" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Two versions, side by side, nothing lost.">Keep yours, keep Jonas's, or keep both. Whichever you choose, Version history shows the other, with Restore.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Dresy changed />
                <div className="co-twin" style={{ left: 330, top: 440, width: 600 }}>
                  <div className="island co-twin-card"><strong>You and Jonas both changed this sticky while offline.</strong><span>Both versions are here. Keep one, or keep both side by side.</span></div>
                  <div className="co-twin-pair">
                    <div className="co-twin-one">
                      <span className="co-twin-who"><Avatar who="you" size="sm" />Yours · yesterday 21:40 · this Mac</span>
                      <Sticky color="yellow" x={0} y={0} w={200}>Číslo na zádech větší — 30 cm</Sticky>
                      <span className="btn btn--sm">Keep yours</span>
                    </div>
                    <span className="co-twin-vs">or</span>
                    <div className="co-twin-one">
                      <span className="co-twin-who"><Avatar who="jonas" size="sm" />Jonas · today 7:55 · his Mac</span>
                      <Sticky color="yellow" x={0} y={0} w={200}>Číslo 25 cm — jinak se nad něj nevejde sponzor</Sticky>
                      <span className="btn btn--sm">Keep Jonas's</span>
                    </div>
                  </div>
                  <span className="btn btn--sm co-twin-both"><Icon name="duplicate" size={13} />Keep both</span>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Uniformy-2027" />
              <PanelIcon icon="panel-left" at="left" />
              <CoCluster faces={["tereza", "jonas"]} mode="preview" />
              <div className="island co-vh" style={{ left: 1028, top: 420 }}>
                <p className="co-vh-t"><Icon name="history" size={14} />Version history<span>this sticky</span></p>
                <span className="co-vh-r"><Avatar who="jonas" size="sm" /><span><span><strong>Jonas</strong> · today 7:55</span><em>“Číslo 25 cm — jinak se nad…”</em></span><span className="btn btn--ghost btn--sm">Restore</span></span>
                <span className="co-vh-r"><Avatar who="you" size="sm" /><span><span><strong>You</strong> · yesterday 21:40</span><em>“Číslo na zádech větší — 30 cm”</em></span><span className="btn btn--ghost btn--sm">Restore</span></span>
                <span className="co-vh-r co-vh-r--old"><Avatar who="tereza" size="sm" /><span><span><strong>Tereza</strong> · 3 Oct</span><em>“Číslo na zádech?”</em></span></span>
                <p className="co-hint co-vh-f">Both stay here whatever you keep. <Kbd>⌥⌘H</Kbd></p>
              </div>
              <ZoomUndo zoom={29} />
              <Toolbar mode="annotate" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-trashed" label="15 · Moved to the trash while you had it open" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="Nothing closes under you.">Editors can move a canvas to the trash; only an owner clears it out. Keep looking — changes stay with it. Restore puts it back for everyone.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post · Combine v číslech" kind="digital" x={330} y={140} w={300} h={300}><GatorMock variant="numbers" /></Artboard>
                <Artboard label="Story · 86 hráčů" kind="digital" x={670} y={140} w={169} h={300}><GatorMock variant="reel" headline="86 HRÁČŮ" sub="Combine 2026" /></Artboard>
                <Artboard label="Post · 4,62 s na 40 yardů" kind="digital" x={879} y={140} w={300} h={300}><GatorMock variant="social" headline="4,62 s" sub="nejrychlejší 40 yardů" /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-cisla" />
              <div className="island co-banner">
                <span className="co-banner-ic"><Icon name="trash" size={16} /></span>
                <span className="co-banner-t">Tereza moved Combine-cisla to the trash · 2 min ago<span>You can keep looking. Anything you change now stays with it.</span></span>
                <span className="btn btn--sm btn--primary">Restore</span>
              </div>
              <CanvasesPanel project="Alligators brand" count={92} selected="Combine-cisla" folders={[
                { name: "2026", open: true, count: 15, folders: [
                  { name: "combine", open: true, count: 5, items: [
                    { name: "Combine-kampan", art: "gator-poster", people: ["tereza"] },
                    { name: "Combine-letak-registrace", art: "gator-print", kinds: ["print"] },
                    { name: "Combine-invite", art: "gator-social", kinds: ["digital"] },
                    { name: "Combine-cisla", art: "gator-numbers", dim: true, sub: <span className="co-trashrow"><Icon name="trash" size={11} />In the trash · open here</span> },
                    { name: "Combine-video-AI", art: "video", kinds: ["video"] },
                  ] },
                  { name: "dresy", count: 4 }, { name: "social", count: 6 },
                ] },
                { name: "club-web", count: 9 }, { name: "print", count: 6 }, { name: "social", count: 31 }, { name: "legacy", count: 27 },
              ]} />
              <CoCluster faces={["tereza"]} />
              <ZoomUndo zoom={28} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Local → cloud ──────────────────────────────────────────────────────────────── */}
      <DCSection id="local" title="A local project wants to be shared" subtitle="Share offers Move to cloud, signs you in only if needed, then opens on Invite while it goes up — the same steps as 02 Onboarding">
        <DCArtboard id="co-local-cloud" label="16 · Local project — Share moves it to the cloud" width={W} height={720} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">Sharing a local project is one move, then an invite.</p>
            <p className="co-closeup-sub">Portfolio 2026 lives only on this Mac (Local project). Its Share button is the only place that offers the cloud.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="laptop" size={12} />1 · Share on a local project</span>
                <CoCluster faces={[]} status="local" open style={{ position: "relative", right: "auto", top: "auto", alignSelf: "flex-end" }} />
                <div className="co-pop co-pop--static" style={{ width: 380 }}>
                  <p className="co-sh-t">Move “Portfolio 2026” to the cloud?</p>
                  <p className="co-card-b">Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It stays on this Mac too.</p>
                  <span className="co-req-a"><span className="btn">Cancel</span><span className="btn btn--primary">Move to cloud</span></span>
                  <p className="co-hint" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", paddingTop: "var(--space-2)", boxShadow: "inset 0 0.5px 0 var(--border-subtle)" }}>Only need a file? Menu › Export… <Kbd>⇧⌘E</Kbd></p>
                </div>
              </div>
              <span className="co-step"><Icon name="submenu" size={14} /></span>
              <div className="co-col">
                <span className="co-col-l"><Icon name="cloud" size={12} />2 · Only if you're not signed in yet</span>
                <BrowserWin url="cloud.maude.sh/sign-in" w={360} h={400}>
                  <div className="co-web">
                    <Mark size={32} />
                    <p className="co-web-t">Sign in to cloud.maude.sh</p>
                    <p className="co-web-s">Then this page sends you back to the app.</p>
                    <span className="btn co-web-btn">Continue with Google</span>
                    <span className="input co-web-in">you@studio.cz</span>
                    <span className="btn btn--primary co-web-btn">Continue with email</span>
                    <span className="co-web-cancel">Cancel and go back to the app</span>
                  </div>
                </BrowserWin>
                <p className="co-col-cap">The same browser sign-in as 02 Onboarding, step 2. Signed in already? This step doesn't appear.</p>
              </div>
              <span className="co-step"><Icon name="submenu" size={14} /></span>
              <div className="co-col">
                <span className="co-col-l"><Icon name="share" size={12} />3 · Share opens on Invite</span>
                <CoCluster faces={[]} status="syncing" open style={{ position: "relative", right: "auto", top: "auto", alignSelf: "flex-end" }} />
                <ShareSheet isStatic width={380} title="Share “Portfolio 2026”" scope="project"
                  typed={<>tereza@alligators.cz<i className="k-caretline" /></>}
                  rows={[{ who: "you", role: "Owner", quiet: true }]}
                  link={{ who: "Anyone with the link", role: "Can view" }} />
                <Toast at="free" icon="cloud" style={{ position: "relative", left: "auto", top: "auto", translate: "none", alignSelf: "flex-start" }}>Moved to the cloud — 3 canvases are going up now.</Toast>
              </div>
            </div>
            <div className="co-closeup-note"><Note n={16} title="Offer, sign in if needed, invite.">Step for step as 02 Onboarding. You can invite at once — canvases go up in the background, and the word next to Share reads Syncing… until they're there.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Edge cases ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When sharing gets crowded, or ends" subtitle="Twelve people on one canvas, view access meeting an edit, someone removed, a link turned off">
        <DCArtboard id="co-twelve" label="17 · Twelve people on one canvas" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="A crowd stays readable.">Three faces and +8; the list says where each person is. Idle cursors turn grey and shrink to an initial.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan yourAi={false}>
                  <Ring {...KAMPAN.web} tone="green" />
                  <Cursor name="jonas" x={360} y={300} />
                  <Cursor name="tereza" x={872} y={250} />
                  <Cursor name={P.petra.name} color="lilac" x={520} y={640} />
                  <Cursor name={P.lukas.name} color="grey" x={640} y={260} />
                  <Cursor name={P.klara.name} color="yellow" x={160} y={580} />
                  <Cursor name={P.ondrej.name} color="sky" x={800} y={600} />
                  <Cursor color="grey" label="E" x={250} y={430} />
                  <Cursor color="grey" label="R" x={940} y={700} />
                  <Cursor color="grey" label="H" x={1030} y={520} />
                </Kampan>
              </Canvas>
              <KampanChrome>
                <CoCluster faces={["tereza", "jonas", P.petra]} more={8} faceOpen="more" />
                <PanelIcon icon="spark" at="ai" />
                <div className="k-menu co-plist" style={{ right: 300, top: 64 }}>
                  <p className="co-pl-h"><span>12 on Combine-kampan</span><span>you + 11</span></p>
                  {([
                    ["tereza", "A4 · plakát"], ["jonas", "Web · STAŇ SE GATOREM"], [P.petra, "16:9 · teaser"], [P.lukas, "Post 1:1"],
                    [P.klara, "Reels · nábor"], [P.ondrej, "Story 9:16"], [P.vojta, "in a browser · Can view"], [P.filip, "in Comments"],
                  ] as [Who, string][]).map(([w, where]) => (
                    <span className="co-pl-r" key={nameOf(w)}><Avatar who={w} /><span>{nameCap(w)}</span><em>{where}</em></span>
                  ))}
                  {([[P.eliska, "idle · 4 min"], [P.radek, "idle · 12 min"], [P.hana, "idle · 25 min"]] as [Who, string][]).map(([w, where]) => (
                    <span className="co-pl-r co-pl-r--idle" key={nameOf(w)}><Avatar who={w} /><span>{nameCap(w)}</span><em>{where}</em></span>
                  ))}
                  <span className="k-msep" />
                  <span className="co-pl-act" data-hl="true"><Icon name="people" size={14} />Bring everyone here</span>
                </div>
              </KampanChrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="co-ask-edit" label="18 · Can view, trying to change something" width={W} height={820} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">View access meets an edit: one request, one answer.</p>
            <p className="co-closeup-sub">Petra can view Combine-kampan. She tries to drag the headline on Post 1:1.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l"><Icon name="laptop" size={12} />On Petra's Mac</span>
                <MiniWin w={720} h={480}>
                  <Canvas>
                    <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={150} y={88} w={260} h={260}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                    <OwnCursor x={240} y={196} tone="lilac" />
                    <div className="co-callout" style={{ left: 320, top: 214 }}>You can look at Combine-kampan, not change it.<span>Ask to edit, top right, sends a request to its owner.</span></div>
                  </Canvas>
                  <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
                  <CoCluster faces={["tereza"]} canEdit={false} access="Can view" />
                </MiniWin>
                <p className="co-col-cap">When the owner says yes, Petra sees:</p>
                <Toast at="free" icon="done" style={{ position: "relative", left: "auto", top: "auto", translate: "none", alignSelf: "flex-start" }}>You can edit Combine-kampan now.</Toast>
              </div>
              <span className="co-step"><Icon name="submenu" size={14} /></span>
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="laptop" size={12} />On yours — you own it</span>
                <Toast at="free" action="Review" style={{ position: "relative", left: "auto", top: "auto", translate: "none", alignSelf: "flex-start" }}><Avatar who={P.petra} size="sm" /> Petra asks to edit Combine-kampan</Toast>
                <ShareSheet isStatic width={420} title="Share Combine-kampan" scope="canvas"
                  request={
                    <div className="co-req">
                      <span className="co-req-t"><Avatar who={P.petra} />Petra asks to edit Combine-kampan</span>
                      <span className="co-req-s">2 min ago · she can view it now</span>
                      <span className="co-req-a"><span className="btn btn--sm">Not now</span><span className="btn btn--sm btn--primary">Let Petra edit</span></span>
                    </div>
                  }
                  rows={[KAMPAN_ROWS[0], KAMPAN_ROWS[1], { who: P.petra, sub: "petra@alligators.cz", role: "Can view" }]} />
              </div>
            </div>
            <div className="co-closeup-note"><Note n={18} title="A view-only person can ask, once.">The mode switch reads Viewing and there is no toolbar. Petra's drag does nothing and one dark tip says why; Ask to edit waits at the top of the owner's Share.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="co-access-ends" label="19 · Access ends, gently" width={W} height={680} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">When access ends, it says so plainly — and nothing is lost.</p>
            <p className="co-closeup-sub">You remove Lukáš from the project while he has a canvas open; later the link to Combine-kampan is turned off while a viewer watches.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="laptop" size={12} />You — removing Lukáš</span>
                <div className="co-rel" style={{ width: 420, height: 380 }}>
                  <ShareSheet isStatic width={400} title="Share Alligators brand" scope="project" link={null}
                    rows={[{ who: "you", role: "Owner", quiet: true }, { who: "tereza", role: "Can edit" }, { who: P.lukas, sub: "lukas.novak@gmail.com", role: "Can edit", hl: true }]} />
                  <Dialog title="Remove Lukáš from Alligators brand?" primary="Remove" danger width={360} style={{ top: "62%" }}>
                    He stops seeing its 93 canvases right away. Everything he made stays in the project.
                  </Dialog>
                </div>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="laptop" size={12} />On Lukáš's Mac, a moment later</span>
                <MiniWin w={420} h={380}>
                  <Canvas dim>
                    <Artboard label="Domácí dres 2027" kind="print" x={70} y={34} w={120} h={150}><GatorMock variant="jersey" headline="Domácí dres 2027" /></Artboard>
                    <Artboard label="Venkovní dres 2027" kind="print" x={220} y={34} w={120} h={150}><GatorMock variant="jersey" headline="Venkovní dres 2027" /></Artboard>
                  </Canvas>
                  <div className="co-card co-card--low" style={{ width: 340 }}>
                    <span className="co-card-ic"><Icon name="lock" size={16} /></span>
                    <p className="co-card-t">You no longer have access to Alligators brand.</p>
                    <p className="co-card-b">Your last changes were saved first. If this is a surprise, ask someone on the team.</p>
                    <span className="btn btn--primary"><Icon name="home" size={14} />Back to Home</span>
                  </div>
                </MiniWin>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="link" size={12} />A viewer on a link, in a browser</span>
                <BrowserWin url="alligators.cloud.maude.sh/c/combine-kampan" w={420} h={380}>
                  <Canvas dim>
                    <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={110} y={70} w={200} h={200}><GatorMock variant="social" headline="COMBINE 2026" /></Artboard>
                  </Canvas>
                  <div className="co-card" style={{ width: 320 }}>
                    <span className="co-card-ic"><Icon name="link" size={16} /></span>
                    <p className="co-card-t">This link was turned off.</p>
                    <p className="co-card-b">Ask the person who shared Combine-kampan for a new one.</p>
                  </div>
                </BrowserWin>
              </div>
            </div>
            <div className="co-closeup-note"><Note n={19} title="Told plainly, once.">Remove asks once. Lukáš's open canvas dims behind one sentence and Back to Home; his work stays in the project. A viewer on a link that was turned off gets the same calm card.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Advanced ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Share › Advanced" subtitle="The same fold as 06 Advanced — link rules, other ways in, where it syncs — the roles side by side, and a project on a self-hosted hub">
        <DCArtboard id="co-share-advanced" label="20 · Share › Advanced — link rules, other ways in, where it syncs" width={W} height={1080} fixed>
          <V2 className="co-closeup">
            <p className="co-closeup-h">Share › Advanced — the exact parts, folded away.</p>
            <p className="co-closeup-sub">Left: Combine-kampan on cloud.maude.sh with Advanced open — the same fold as 06 Advanced. Middle: the roles side by side. Right: Kavárna Na Rohu, which syncs to the studio's own hub. Who changed what lives in Version history <Kbd>⌥⌘H</Kbd>.</p>
            <div className="co-cols">
              <div className="co-col">
                <span className="co-col-l co-col-l--accent"><Icon name="cloud" size={12} />Cloud project, Advanced open</span>
                <ShareSheet isStatic width={420} title="Share Combine-kampan" scope="canvas" rows={[KAMPAN_ROWS[0], KAMPAN_ROWS[1], KAMPAN_ROWS[2]]} advOpen adv={<ShareAdvanced />} />
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="people" size={12} />The roles, side by side</span>
                <div className="island co-matrix">
                  <p className="co-mx-t">What each role can do</p>
                  <div className="co-mx">
                    <span /><span className="co-mx-h">Owner</span><span className="co-mx-h">Can edit</span><span className="co-mx-h">Can comment</span><span className="co-mx-h">Can view</span>
                    {([
                      ["Look", [1, 1, 1, 1]],
                      ["Comment", [1, 1, 1, 0]],
                      ["Download and export", [1, 1, 1, 0]],
                      ["Draw annotations", [1, 1, 0, 0]],
                      ["Change artboards", [1, 1, 0, 0]],
                      ["Use AI on it", [1, 1, 0, 0]],
                      ["Move to the trash", [1, 1, 0, 0]],
                      ["Invite people", [1, 0, 0, 0]],
                      ["Clear out the trash", [1, 0, 0, 0]],
                    ] as [string, number[]][]).map(([k, v]) => (
                      <Fragment key={k}>
                        <span className="co-mx-k">{k}</span>
                        {v.map((x, i) => <span key={k + i} className={`co-mx-v${x ? "" : " co-mx-v--no"}`}>{x ? <Icon name="check" size={14} /> : "—"}</span>)}
                      </Fragment>
                    ))}
                  </div>
                  <p className="co-hint">AI runs on each person's own Claude account. A link can give Can view or Can comment, never more. Can view is look only — downloads start at Can comment. The trash keeps things until an owner clears it out.</p>
                </div>
              </div>
              <div className="co-col">
                <span className="co-col-l"><Icon name="server" size={12} />A project on a self-hosted hub</span>
                <ShareSheet isStatic width={380} title="Share Homepage" sub="Kavárna Na Rohu · syncs to the studio's own hub" scope="canvas" link={null}
                  rows={[{ who: "you", role: "Owner", quiet: true }, { who: "tereza", role: "Can edit" }]} advOpen advLabel="Other ways in, sync, roles"
                  adv={<>
                    <ShareAdvanced rules={false} app="maude://kavarna-na-rohu/homepage" mac="localhost:4402/?c=Homepage" hub="https://hub.studio-brno.cz" last="6 Oct, 13:52 · 38 assets" />
                    <p className="co-adv-sub">Roles on this hub</p>
                    <span className="co-rm"><span className="co-rm-ic"><Icon name="check" size={14} /></span><span className="co-rm-t">Can edit<span>Available</span></span></span>
                    <span className="co-rm co-rm--off"><span className="co-rm-ic" /><span className="co-rm-t">Can comment · Can view<span>Not on this hub — it has no view-only accounts, so no link either</span></span></span>
                    <p className="co-hint">People you invite get an account on this hub — the e-mail tells them where to sign in.</p>
                  </>} />
              </div>
            </div>
            <div className="co-closeup-note"><Note n={20} title="Every exact part has a home.">The fold matches 06 Advanced row for row: link rules, the app link and this-Mac-only link, GitHub invite, where it syncs. A self-hosted hub shows its own address and only the roles it supports.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
