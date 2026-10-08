/**
 * @canvas      03 AI Chat — how to use the AI chat panel, and what happens when several AI chats run at once
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ai-hero |
 *              ai-open | ai-suggest | ai-scope | ai-working | ai-done | ai-attach | ai-attach-menu | ai-question |
 *              ai-long | ai-long-pinned |
 *              ai-two-artboards | ai-same-artboard | ai-copy | ai-queue-rule | ai-other-tab | ai-tereza | ai-chat-list |
 *              ai-panel-closed | ai-quit |
 *              ai-needs-hidden | ai-needs-tab | ai-needs-away | ai-permission | ai-choice-fail | ai-not-ready |
 *              ai-advanced | ai-adv-edges |
 *              ai-history
 * @brief       "Jak pouzivat AI chat a edge cases kdy pojede nekolik sessions zaraz" — and "aby se uzivatel citil …
 *              ze muze pouzit ACP panel v nejakem jednoduchem modu a aby tak nejak vse pusobilo ze funguje proste
 *              autonomne". Simple by default; every ACP capability (sessions, permissions, tool calls, slash
 *              commands, model, attachments) still reachable under the panel's Advanced or ⌘K.
 *
 * Convention (same as 01 Create Flow): every app artboard is a <Stage> — a 1440 × 900 window with its note
 * strip underneath (artboard 1440 × 980). Close-ups are V2 boards on the dotted canvas with the note at the
 * foot. Chrome comes from ./_kit; the richer AI chat panel pieces are local (prefix ai-) and listed as kit
 * candidates: Working, Result, Waiting, Permission, Choice, Problem, ChatList, TheirAi,
 * Wipe, Ring, FoldNeeds, tab marks — plus (review 2026-10-08) Clip glyph, Composer (paperclip + chips inside the
 * prompt + multi-line), AChip, AttachMenu, Consent, Suggest (contextual chips + why), BigChat (tall / pinned panel).
 *
 * THE PAPERCLIP (every prompt in this canvas): the kit's single-row ask gets a paperclip before the scope chip
 * (drawn by CSS on .k-ask until the kit AIPanel grows an `attach` button); rich states use the local Composer.
 *
 * THE RULE drawn here (ai-same-artboard + ai-queue-rule): one AI at a time per artboard. Different artboards run
 * side by side; a second ask on a busy artboard — yours or anyone's AI — waits its turn and starts by itself on
 * top of the result. "Run on a copy" is the way to not wait: AI works on a duplicate beside it (ai-copy).
 *
 * THE RING (one visual idea for AI on the canvas): dashed spark = AI is working here · solid spark, once, with a
 * before → after wipe = done · dashed azure = waiting for you · a small spark ring = AI points at a spot.
 *
 * WHEN AI ASKS FIRST: only when a change would replace something you made or move it to the trash (photos, footage, text you
 * wrote). Restyling — colour, type, layout, on any number of artboards — never asks; Undo takes it back.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./03 AI Chat.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, AIRunIcon, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT, Artboard, ConnectSheet, Avatar, Canvas, CanvasesPanel, CommentPin, Cursor, Dialog, GatorMock, HeroMock, Icon, InFill, InSelect, InSize,
  InSwitch, Inspector, Kbd, Mark, Menu, Note, PanelIcon, PhoneMock, PricingMock, ProjectPill, ShareCluster,
  Spark, Stage, TABS, Thumb, Toast, Toolbar, Tooltip, V2, Veil, VideoFrameMock, Window, ZoomUndo,
} from "./_kit";
import type { AIRun, Art, Folder } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];

/* ═══ Local pieces — the AI chat panel, richer than the kit's simple AIPanel (kit candidates) ═══════ */

function You({ children }: { children: ReactNode }) {
  return <p className="k-ai-msg k-ai-msg--you">{children}</p>;
}
function Says({ children, hover = false }: { children: ReactNode; hover?: boolean }) {
  return (
    <div className={`ai-says${hover ? " ai-says--hover" : ""}`}>
      <p className="k-ai-msg k-ai-msg--ai">{children}</p>
      {hover ? (
        <span className="ai-msg-acts">
          <span className="icon-btn k-icon-sm" title="Copy"><Icon name="duplicate" size={12} /></span>
          <span className="icon-btn k-icon-sm" title="Retry"><Icon name="sync" size={12} /></span>
          <span className="k-tip ai-msg-tip">Retry — ask again for a new answer</span>
        </span>
      ) : null}
    </div>
  );
}
/** A quiet divider in the conversation — which artboard, when. */
function Divider({ children }: { children: ReactNode }) {
  return <p className="ai-mark">{children}</p>;
}

/** The one-line progress: what AI is doing right now, and Stop. Same words as the artboard's tag. */
function Working({ children, step }: { children: ReactNode; step?: string }) {
  return (
    <p className="k-ai-working ai-working">
      <span className="motion-soft k-ai-wspark"><Spark size={14} /></span>
      <span className="k-ai-wtxt">{children}{step ? <span className="ai-step">{step}</span> : null}</span>
      <span className="btn btn--ghost btn--sm"><Icon name="stop" size={12} />Stop</span>
    </p>
  );
}

const ACT_ICON: Record<string, string> = { Undo: "undo", Compare: "view", Show: "fit", "Keep the copy": "check" };
/** A result: the AI describes what changed, then Undo first, then the way on. */
function Result({ children, actions = ["Undo", "Keep going"] }: { children: ReactNode; actions?: string[] }) {
  return (
    <div className="ai-result">
      <p className="k-ai-msg k-ai-msg--ai">{children}</p>
      <span className="ai-result-acts">
        {actions.map((a) => <span key={a} className="chip ai-act">{ACT_ICON[a] ? <Icon name={ACT_ICON[a]} size={12} /> : <Spark size={10} />}{a}</span>)}
      </span>
    </div>
  );
}

/** Second ask on a busy artboard: it waits in line (the rule). One verb; Cancel is the quiet ×. */
function Waiting({ title, children, verb = "Run on a copy" }: { title: ReactNode; children?: ReactNode; verb?: string }) {
  return (
    <div className="ai-card ai-wait">
      <p className="ai-card-t"><span className="ai-card-ic ai-card-ic--wait"><Icon name="clock" size={14} /></span><span className="ai-card-tt">{title}</span><span className="icon-btn k-icon-sm ai-card-x" title="Cancel this ask"><Icon name="close" size={12} /></span></p>
      {children ? <p className="ai-card-d ai-card-d--meta">{children}</p> : null}
      <span className="ai-card-a"><span className="btn btn--sm"><Icon name="duplicate" size={12} />{verb}</span></span>
    </div>
  );
}

/** AI asks before replacing something you made or moving it to the trash — inline, never a modal. Title verb = button verb. */
function Permission({ children, detail, verb, always = "Always for this canvas", checked = false }: { children: ReactNode; detail?: ReactNode; verb: string; always?: string; checked?: boolean }) {
  return (
    <div className="ai-card ai-perm">
      <p className="ai-card-t"><span className="ai-card-ic ai-card-ic--ask"><Icon name="help" size={14} /></span>{children}</p>
      {detail ? <div className="ai-card-d">{detail}</div> : null}
      <span className="ai-card-a">
        <span className="ai-check"><span className="ai-box" data-on={checked ? "true" : undefined}>{checked ? <Icon name="check" size={10} /> : null}</span>{always}</span>
        <span className="btn btn--sm">Not now</span>
        <span className="btn btn--sm btn--primary">{verb}</span>
      </span>
    </div>
  );
}

/** AI asks a clarifying question with choices. */
function Choice({ q, options, picked }: { q: ReactNode; options: { label: string; sw?: string; hint?: string }[]; picked?: string }) {
  return (
    <div className="ai-card ai-choice">
      <p className="ai-card-t"><span className="ai-card-ic ai-card-ic--ask"><Icon name="help" size={14} /></span>{q}</p>
      <div className="ai-opts">
        {options.map((o) => (
          <span key={o.label} className="row-item ai-opt" aria-current={picked === o.label ? "true" : undefined}>
            {o.sw ? <span className={`ai-sw ai-sw--${o.sw}`} /> : <span className="ai-sw ai-sw--none"><Icon name="edit" size={12} /></span>}
            <span className="ai-opt-t">{o.label}{o.hint ? <span className="ai-opt-h">{o.hint}</span> : null}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** What happened · what is safe · one verb (CONTRACT §4). */
function Problem({ title, children, verb }: { title: ReactNode; children?: ReactNode; verb: string }) {
  return (
    <div className="ai-card ai-prob">
      <p className="ai-card-t"><span className="ai-card-ic ai-card-ic--prob"><Icon name="problem" size={14} /></span>{title}</p>
      {children ? <p className="ai-card-d">{children}</p> : null}
      <span className="ai-card-a"><span className="btn btn--sm btn--primary">{verb}</span></span>
    </div>
  );
}

/* ─── The prompt, with a paperclip (Michal's review 2026-10-08, kit candidates) ─────────────────── */

/** Paperclip — drawn in the family's hand (16 grid, 1.5 round stroke). Kit candidate: GLYPHS.attach. */
function Clip({ size = 16 }: { size?: number }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5.25L6.6 9.65a1.2 1.2 0 0 0 1.7 1.7l4.4-4.4a2.6 2.6 0 0 0-3.68-3.68L4.6 7.7a4 4 0 0 0 5.66 5.66l3.24-3.26" />
    </svg>
  );
}

type AttKind = "image" | "video" | "file" | "folder";
/** One attachment inside the prompt. Pictures are a thumbnail (name on hover); files and folders say name + what. */
function AChip({ kind, name, meta, art = "blank", wait = false }: { kind: AttKind; name?: string; meta?: string; art?: Art; wait?: boolean }) {
  if (kind === "image") {
    return (
      <span className="ai-ach ai-ach--img" title={name}>
        <Thumb art={art} className="ai-ach-thumb" />
        <span className="ai-ach-x"><Icon name="close" size={9} /></span>
      </span>
    );
  }
  return (
    <span className={`ai-ach${wait ? " ai-ach--wait" : ""}`}>
      {kind === "video" ? (
        <span className="ai-ach-pic"><Thumb art={art} className="ai-ach-vthumb" /><span className="ai-ach-play"><Icon name="play" size={8} /></span></span>
      ) : <span className="ai-ach-ic"><Icon name={kind === "folder" ? "folder" : "file"} size={14} /></span>}
      <span className="ai-att-txt"><span className="ai-att-n">{name}</span><span className="ai-att-m">{meta}</span></span>
      <span className="ai-att-x"><Icon name="close" size={10} /></span>
    </span>
  );
}

/** The prompt field. One row when short: 📎 · scope chip · text · send. Attachments sit inside it, on top; a long
 *  prompt wraps above the row (multi). The paperclip opens Attach files… · Choose a folder… · From Assets · Paste. */
function Composer({ scope, text, placeholder = "Ask AI…", chips, multi = false, clipOpen = false, menu, className = "" }: {
  scope: string; text?: ReactNode; placeholder?: string; chips?: ReactNode; multi?: boolean; clipOpen?: boolean; menu?: ReactNode; className?: string;
}) {
  const clip = <span className={`icon-btn k-icon-sm ai-clip${clipOpen ? " k-pressed" : ""}`} title="Attach"><Clip size={16} /></span>;
  return (
    <div className={`ask ai-ask${multi ? " ai-ask--multi" : ""}${className ? " " + className : ""}`}>
      {chips ? <div className="ai-ask-chips">{chips}</div> : null}
      {multi ? <p className="ai-ask-text">{text}<i className="k-caretline" /></p> : null}
      <div className="ai-ask-row">
        {clip}
        <span className="chip chip--accent k-selchip">◆ {scope}</span>
        {multi ? <span className="ai-ask-sp" /> : <span className={`k-ask-in${text ? "" : " k-ask-ph"}`}>{text ?? placeholder}{text ? <i className="k-caretline" /> : null}</span>}
        <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
      </div>
      {menu}
    </div>
  );
}

/** The paperclip's menu — one short list; dragging stays the fastest way. */
function AttachMenu({ style, highlight }: { style?: CSSProperties; highlight?: string }) {
  return (
    <Menu style={style} width={232} highlight={highlight} items={[
      { label: "Attach files…", icon: "file" },
      { label: "Choose a folder…", icon: "folder" },
      { label: "From Assets", icon: "image" },
      { label: "Paste a screenshot", icon: "fit", keys: "⌘V" },
      "sep",
      { label: "Or drag files here", icon: "insert", disabled: true },
    ]} />
  );
}

/** A folder from disk asks once: AI may read it (never writes to it). Title verb = button verb. */
function Consent({ name = "Combine 2026 fotky", count = 48 }: { name?: string; count?: number }) {
  return (
    <div className="ai-consent">
      <p className="ai-consent-t"><span className="ai-consent-ic"><Icon name="folder" size={14} /></span><span>Let AI read “{name}” ({count} files)?</span></p>
      <p className="ai-consent-d">Asked once for this folder. AI only reads it — nothing on disk changes.</p>
      <span className="ai-card-a"><span className="btn btn--sm">Not now</span><span className="btn btn--sm btn--primary">Let AI read</span></span>
    </div>
  );
}

/** The comment pin's own shape (kit .k-cpin-dot), small, for a chip that is about comments. */
function PinDot({ ini = "T", tone = "sky" }: { ini?: string; tone?: string }) {
  return <span className={`ai-pindot k-av--${tone}`}>{ini}</span>;
}

/** Suggestions come from what you were doing. Max 3 chips, one line each; the lead chip carries its context glyph and
 *  the tiny "why" under the row explains it. Follow-ups under an answer need no why. */
function Suggest({ chips, why, icon }: { chips: string[]; why?: ReactNode; icon?: string | ReactNode }) {
  return (
    <div className="ai-sugg">
      <div className="k-ai-sugg ai-sugg-row">
        {chips.slice(0, 3).map((c, i) => <span key={c} className={`chip k-sugg ai-sugg-chip${i === 0 && icon ? " ai-sugg-lead" : ""}`}>{i === 0 && icon ? (typeof icon === "string" ? <Icon name={icon} size={12} /> : icon) : null}{c}</span>)}
      </div>
      {why ? <p className="ai-why">{why}</p> : null}
    </div>
  );
}

/** The tall AI chat panel (long chats): 420 wide, full window height, resizable edge, Pin to the side in the header.
 *  Same header, messages and foot as the kit panel. pinned = docked flush in the right column. Kit candidate. */
function BigChat({ title, count, pinned = false, up = false, children, jump, composer, resize, pinTip }: {
  title: string; count?: number; pinned?: boolean; up?: boolean; children: ReactNode; jump?: ReactNode; composer: ReactNode; resize?: boolean; pinTip?: ReactNode;
}) {
  return (
    <div className={`island island--pad k-ai k-ai--chat ai-big${pinned ? " ai-big--pinned" : ""}`}>
      <div className="k-ai-hd k-ai-hd--chat">
        <Spark size={14} />
        <span className="k-ai-title"><span className="k-ai-title-t">{title}</span><Icon name="chevron" size={12} /></span>
        {count ? <span className="chip k-ai-sess k-ai-count"><Spark size={10} /><b>{count}</b><Icon name="chevron" size={12} /></span> : null}
        <span className="icon-btn k-icon-sm" title="New chat"><Icon name="plus" size={14} /></span>
        <span className={`icon-btn k-icon-sm ai-pinbtn${pinned ? " k-pressed" : ""}`} title={pinned ? "Unpin" : "Pin to the side"}><Icon name="panel-right" size={14} />{pinTip}</span>
        <span className="icon-btn k-icon-sm" title="Hide the AI chat panel"><Icon name="chevron" size={14} /></span>
      </div>
      <div className={`k-ai-msgs ai-big-msgs${up ? " ai-big-msgs--up" : " k-ai-msgs--end"}`}>{children}</div>
      {jump}
      <div className="k-ai-askwrap">{composer}</div>
      <span className="k-adv-btn k-ai-adv"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced</span>
      {resize ? (
        <span className="ai-resize">
          <i className="ai-resize-line" /><i className="ai-resize-grip" />
          <span className="ai-resize-cur"><svg className="k-ic" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M2.5 11h17M6 7.5L2.5 11 6 14.5M16 7.5l3.5 3.5-3.5 3.5" fill="none" stroke="var(--bg-2)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><path d="M2.5 11h17M6 7.5L2.5 11 6 14.5M16 7.5l3.5 3.5-3.5 3.5" fill="none" stroke="var(--fg-0)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="k-tip ai-resize-tip">Drag to resize · double-click for full height</span>
        </span>
      ) : null}
    </div>
  );
}

/** You, with what you attached above the words. */
function YouWith({ chips, children }: { chips: ReactNode; children: ReactNode }) {
  return (
    <div className="ai-youwith">
      <span className="ai-youwith-att">{chips}</span>
      <p className="k-ai-msg k-ai-msg--you">{children}</p>
    </div>
  );
}
/** Sent attachments (read-only, no ×). */
function Sent({ kind, name, meta, art = "blank" }: { kind: AttKind; name?: string; meta?: string; art?: Art }) {
  if (kind === "image") return <Thumb art={art} className="ai-sent-img" />;
  return (
    <span className="ai-ach ai-ach--sent">
      <span className="ai-ach-ic"><Icon name={kind === "folder" ? "folder" : kind === "video" ? "video" : "file"} size={14} /></span>
      <span className="ai-att-txt"><span className="ai-att-n">{name}</span><span className="ai-att-m">{meta}</span></span>
    </span>
  );
}
/** What AI did — folded by default; the steps live behind it (the raw log is under Advanced). */
function Steps({ children }: { children: ReactNode }) {
  return <span className="k-adv-btn ai-steps"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>{children}</span>;
}

/** Another person's AI on the same canvas — the same spark outline and spark-led tag as yours; her avatar
 *  sits inside the tag, so you know whose AI it is. Drawn in canvas px over the artboard. */
function TheirAi({ x, y, w, h, who = "tereza", doing, cx = 0.84, cy = 0.74 }: { x: number; y: number; w: number; h: number; who?: string; doing: string; cx?: number; cy?: number }) {
  const name = who === "tereza" ? "Tereza" : "Jonas";
  const tone = who === "tereza" ? "sky" : "green";
  return (
    <>
      <span className="ai-their-ol" style={{ left: x - 5, top: y - 5, width: w + 10, height: h + 10 }} />
      <span className="ai-their-tagpos" style={{ left: x + w + 5, top: y + h + 8 }}>
        <span className="k-cur-tag k-cur-tag--ai ai-their-tag motion-soft"><Spark size={10} color="var(--spark-fg)" /><Avatar who={who} size="sm" />{name}'s AI · {doing}</span>
      </span>
      <span className="ai-their-cur" style={{ left: x + w * cx, top: y + h * cy }}>
        <svg className="k-ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--presence-agent)" stroke={`var(--object-${tone})`} strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </span>
    </>
  );
}

/** The ring around an artboard (or a group of them), in canvas px. done = solid spark, settles once with the
 *  spring; needs = dashed azure with a "Waiting for you" tag; point = a small spark ring AI uses to point. */
function Ring({ x, y, w, h, kind, tag }: { x: number; y: number; w: number; h: number; kind: "done" | "needs" | "point"; tag?: ReactNode }) {
  return (
    <span className={`ai-ring ai-ring--${kind}`} style={{ left: x, top: y, width: w, height: h }}>
      {tag ? <span className={`ai-ring-tag ai-ring-tag--${kind}`}>{kind === "needs" ? <Icon name="help" size={11} /> : <Spark size={9} color="var(--spark-fg)" />}{tag}</span> : null}
    </span>
  );
}

/** The done moment: for about a second a wipe passes across the artboard, before → after, then settles. */
function Wipe({ at, headline = "COMBINE 2026", sub = "So 14. 3. · Kraví hora" }: { at: number; headline?: string; sub?: string }) {
  return (
    <div className="ai-wipe">
      <div className="ai-post ai-post--green"><GatorMock variant="social" headline={headline} sub={sub} /></div>
      <div className="ai-wipe-before" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }}><div className="ai-post ai-post--plain"><GatorMock variant="social" headline={headline} sub={sub} /></div></div>
      <span className="ai-wipe-line" style={{ left: `${at}%` }}><span className="ai-wipe-lab ai-wipe-lab--b">Before</span><span className="ai-wipe-lab ai-wipe-lab--a">After</span></span>
    </div>
  );
}

/** The folded spark when a chat needs you: azure ring + a count. Wins over the busy dot. */
function FoldNeeds({ count = 1, inline = false }: { count?: number; inline?: boolean }) {
  return (
    <span className={`island k-iconbtn ${inline ? "ai-spec-fold" : "k-iconbtn--ai"} ai-fold-needs`}>
      <span className="icon-btn"><Spark size={16} /><i className="ai-needs-badge">{count}</i></span>
    </span>
  );
}

/** A chat list — Running, then Earlier grouped by canvas. Search narrows it. */
type ChatRow = { t: string; where?: string; when: string; who?: string; state?: AIRun["state"] | "stopped"; via?: string; hover?: boolean };
type ChatGroup = { canvas: string; art: Art; count?: number; rows: ChatRow[]; more?: number };
function ChatList({ query, running = [], groups, foot, style, children }: { query?: string; running?: ChatRow[]; groups: ChatGroup[]; foot?: string; style?: CSSProperties; children?: ReactNode }) {
  const hl = (s: string, q?: string) => {
    if (!q) return s;
    const at = s.toLowerCase().indexOf(q.toLowerCase());
    if (at < 0) return s;
    return <>{s.slice(0, at)}<mark className="k-mark">{s.slice(at, at + q.length)}</mark>{s.slice(at + q.length)}</>;
  };
  const Row = ({ r }: { r: ChatRow }) => (
    <span className={`row-item ai-cl-row${r.hover ? " ai-cl-row--hover" : ""}`}>
      <AIRunIcon state={r.state === "working" || r.state === "needs" ? r.state : "idle"} />
      <span className="k-ai-stxt">
        <span className="k-ai-st">{hl(r.t, query)}</span>
        {r.via ? <span className="k-ai-sw">… {hl(r.via, query)} …</span> : r.where ? <span className="k-ai-sw">{r.where}</span> : null}
      </span>
      {r.who ? <Avatar who={r.who} size="sm" /> : null}
      {r.hover ? <span className="icon-btn k-icon-sm ai-cl-dots"><Icon name="more" size={14} /></span> : <span className={`ai-cl-when${r.state === "needs" ? " ai-cl-when--needs" : ""}`}>{r.state === "needs" ? "Needs you" : r.state === "stopped" ? `Stopped · ${r.when}` : r.when}</span>}
    </span>
  );
  return (
    <div className="island ai-cl" style={style}>
      <div className="ai-cl-hd">
        <span className="ai-cl-back"><Icon name="chevron" size={12} /></span>
        <strong>Chats</strong>
        <span className="chip">Alligators brand</span>
        <span className="icon-btn k-icon-sm"><Icon name="plus" size={14} /></span>
      </div>
      <span className={`k-find${query ? " k-find--on" : ""}`}>
        <Icon name="search" size={14} />
        {query ? <span className="k-find-q">{query}<i className="k-caretline" /></span> : <span className="k-find-q k-find-ph">Search chats</span>}
        {query ? <span className="k-find-x"><Icon name="close" size={10} /></span> : null}
      </span>
      <div className="ai-cl-list">
        {running.length ? (<><p className="island-title ai-cl-gt">Running<span className="ai-cl-gc">{running.length}</span></p>{running.map((r) => <Row key={r.t} r={r} />)}</>) : null}
        {!query ? <p className="island-title ai-cl-gt">Earlier</p> : null}
        {groups.map((g) => (
          <div key={g.canvas} className="ai-cl-grp">
            <span className="ai-cl-canvas"><Thumb art={g.art} className="k-thumb--row" /><span>{g.canvas}</span>{g.count ? <span className="ai-cl-gc">{g.count} {g.count === 1 ? "chat" : "chats"}</span> : null}</span>
            {g.rows.map((r) => <Row key={r.t} r={r} />)}
            {g.more ? <span className="ai-cl-more">{g.more} more</span> : null}
          </div>
        ))}
      </div>
      <p className="ai-cl-foot">{foot ?? "41 chats · kept with the project"}</p>
      {children}
    </div>
  );
}

/** Small close-up frame title + note at the foot. */
function Closeup({ title, note, children, className = "", theme = "light" }: { title: ReactNode; note: ReactNode; children: ReactNode; className?: string; theme?: "light" | "dark" }) {
  return (
    <V2 theme={theme} className={`ai-closeup ${className}`}>
      <p className="ai-closeup-h">{title}</p>
      <div className="ai-closeup-body">{children}</div>
      <div className="ai-closeup-note">{note}</div>
    </V2>
  );
}

/* ═══ Alligators content ═════════════════════════════════════════════════════════════════════ */

/* The canonical Alligators tree from the kit (93 = 16 + 9 + 6 + 31 + 27 + 4 at the root) — counts add up on screen. */
const KAMPAN_FOLDERS: Folder[] = ALLIGATORS_FOLDERS;

/** Same tree with combine closed and dresy open — Uniformy-2027 says "Needs you" in its row (ai-needs-hidden). */
const NEEDS_FOLDERS: Folder[] = ALLIGATORS_FOLDERS.map((f) => f.name !== "2026" ? f : {
  ...f, folders: f.folders?.map((sf) => sf.name === "combine" ? { ...sf, open: false }
    : sf.name === "dresy" ? { ...sf, open: true, items: [
      { name: "Uniformy-2027", art: "gator-jersey", meta: "Needs you" },
      { name: "Helma-varianty", art: "gator-jersey" },
      { name: "Dresy-cisla-a-jmena", art: "gator-jersey" },
      { name: "Treninkove-dresy", art: "gator-jersey" },
    ] } : sf),
});

type PostLook = "plain" | "half" | "green";
/** Combine-kampan — a working slice of five artboards, laid out between the left panel and the AI chat panel
 *  (the canvas as it really is — 21 artboards, 19 fixed size + 2 print — is drawn in 01 / 08 / 11).
 *  Every AI tag sits under its artboard (aiAt="below") so tags never jump between corner and foot. */
function Kampan({ post = "plain", postAi, posterAi, webAi, storyAi, sel, children, poster = "cz", postLabel, postMade, postWipe }: {
  post?: PostLook; postAi?: string; posterAi?: string; webAi?: string; storyAi?: string; sel?: "post" | "web" | "poster" | "teaser"; children?: ReactNode; poster?: "cz" | "en"; postLabel?: string; postMade?: string; postWipe?: number;
}) {
  return (
    <>
      <Artboard label="Web · STAŇ SE GATOREM" kind="web" x={310} y={110} w={440} h={275} aiWorking={webAi} aiAt="below" selected={sel === "web"} size="1440 × 900"><GatorMock variant="web" /></Artboard>
      <Artboard label={postLabel ?? "Post 1:1 · Combine 2026"} kind="digital" x={790} y={110} w={260} h={260} aiWorking={postAi} aiAt="below" aiMade={postMade} selected={sel === "post"} size="1080 × 1080">
        {postWipe !== undefined ? <Wipe at={postWipe} /> : <div className={`ai-post ai-post--${post}`}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div>}
      </Artboard>
      <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={310} y={445} w={150} h={267} aiWorking={storyAi} aiAt="below"><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
      <Artboard label="16:9 · teaser" kind="video" x={500} y={445} w={250} h={141} selected={sel === "teaser"} size="1920 × 1080"><VideoFrameMock caption="Combine 2026" time="0:12 / 0:30" /></Artboard>
      <Artboard label="A4 · plakát" kind="print" x={790} y={430} w={200} h={283} aiWorking={posterAi} aiAt="below" selected={sel === "poster"} size="210 × 297 mm">
        <GatorMock variant="poster" headline={poster === "en" ? "BECOME A GATOR" : "COMBINE 2026"} sub={poster === "en" ? "Sat 14 Mar · Kraví hora" : "So 14. 3. · Kraví hora"} />
      </Artboard>
      {children}
    </>
  );
}

/** The usual chrome around Combine-kampan. */
function GatorChrome({ left = false, folders = KAMPAN_FOLDERS, ai, insp, status = "saved", people = ["tereza", "jonas"], zoom = 38, canvas = "Combine-kampan" }: { left?: boolean; folders?: Folder[]; ai?: ReactNode; insp?: ReactNode; status?: "saved" | "syncing" | "offline"; people?: string[]; zoom?: number; canvas?: string }) {
  return (
    <>
      <ProjectPill project="Alligators brand" canvas={canvas} />
      {left ? <CanvasesPanel project="Alligators brand" count={ALLIGATORS_COUNT} selected={canvas} folders={folders} items={ALLIGATORS_ROOT} /> : <PanelIcon icon="panel-left" at="left" />}
      <ShareCluster people={people} status={status} mode="edit" />
      {insp}
      <ZoomUndo zoom={zoom} />
      <Toolbar />
      {ai}
    </>
  );
}

const ASK = "Make it greener, keep the logo white";
const DONE = "Done — Post 1:1 is greener: background, badge and button. The logo stays white.";

/** Uniformy-2027 — the kit's jerseys plus team photos (the permission story): 4 photos on 4 artboards. */
const UNI: { label: string; v: "jersey" | "photo"; cap?: string }[] = [
  { label: "Dres doma", v: "jersey", cap: "Domácí dres 2027" }, { label: "Dres venku", v: "jersey", cap: "Venkovní dres 2027" },
  { label: "Helma z boku", v: "jersey", cap: "Helma · zelená/zlatá" }, { label: "Kalhoty doma", v: "jersey", cap: "Kalhoty doma" },
  { label: "Foto · obrana", v: "photo" }, { label: "Foto · útok", v: "photo" },
  { label: "Foto · speciální týmy", v: "photo" }, { label: "Foto · trenéři", v: "photo" },
];
function Uniformy({ ring = false }: { ring?: boolean }) {
  return (
    <>
      {UNI.map((u, i) => {
        const col = i % 4; const row = Math.floor(i / 4);
        const x = 290 + col * 200; const y = 110 + row * 300;
        return (
          <Artboard key={u.label} label={u.label} kind={u.v === "photo" ? "digital" : "print"} x={x} y={y} w={170} h={240}>
            {u.v === "jersey" ? <GatorMock variant="jersey" headline={u.cap} /> : <div className="ai-photo"><span className="ai-photo-sky" /><span className="ai-photo-team"><i /><i /><i /><i /><i /></span><span className="ai-photo-cap">2025</span></div>}
            {u.v === "photo" ? <span className="ai-will">will change</span> : null}
          </Artboard>
        );
      })}
      {ring ? <Ring kind="needs" x={278} y={384} w={794} h={278} tag="Waiting for you · Replace 4 photos?" /> : null}
    </>
  );
}
const PERM_DETAIL = (
  <span className="ai-perm-list">
    <Thumb art="gator-poster" className="ai-perm-th" /><Thumb art="gator-social" className="ai-perm-th" /><Thumb art="gator-poster" className="ai-perm-th" /><Thumb art="gator-reel" className="ai-perm-th" />
    <span>Obrana, útok, speciální týmy, trenéři</span>
  </span>
);

/* ═══ The canvas ═════════════════════════════════════════════════════════════════════════════ */
export default function AIChat() {
  return (
    <DesignCanvas>
      {/* ── 0 · The moment ───────────────────────────────────────────────────────────────── */}
      <DCSection id="moment" title="Two AIs, side by side" subtitle="The signature moment — your AI finishes in place while Tereza's AI keeps working on the artboard next to it">
        <DCArtboard id="ai-hero" label="1 · Two AIs, two artboards — the finish lands in place" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="The result shows up where it happened.">A solid spark ring settles and a wipe passes before → after on Post 1:1 while Tereza's AI keeps translating the poster. The paperclip attaches photos, a PDF or a whole folder; a folder asks once.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={200} y={130} w={480} h={480} aiMade="Made by AI" size="1080 × 1080"><Wipe at={30} /></Artboard>
                <Ring kind="done" x={193} y={123} w={494} h={494} />
                <Artboard label="A4 · plakát" kind="print" x={730} y={130} w={332} h={470}><GatorMock variant="poster" headline="BECOME A GATOR" sub="So 14. 3. · Kraví hora" /></Artboard>
                <TheirAi x={730} y={130} w={332} h={470} doing="translating to English" cx={0.6} cy={0.84} />
                <Cursor name="tereza" x={560} y={720} />
              </Canvas>
              <GatorChrome zoom={64} ai={
                <AIPanel advanced className="ai-own" chat="Make it greener" scope="Post 1:1" chips={["Same on Story 9:16", "A darker green"]}
                  above={<>
                    <Consent />
                    <Composer scope="Post 1:1" text="Swap the background for the sharpest photo"
                      chips={<><AChip kind="image" name="kravi-hora-01.jpg" art="gator-poster" /><AChip kind="folder" name="Combine 2026 fotky" meta="48 files" wait /><AChip kind="file" name="Combine-brief-2026.pdf" meta="PDF · 12 pages" /></>} />
                  </>}>
                  <You>{ASK}</You>
                  <Result>{DONE}</Result>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 1 · Simple mode ──────────────────────────────────────────────────────────────── */}
      <DCSection id="simple" title="Ask, watch, keep or undo" subtitle="Simple mode on Combine-kampan — one field, the selection as a chip, results described in one line">
        <DCArtboard id="ai-open" label="2 · ⌘/ opens the AI chat panel" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Select, press ⌘/, type.">The panel opens with your selection as a chip. Up to three suggestions come from what you are doing — here Tereza's open comments — and a quiet line says why.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan sel="post">
                  <CommentPin who="tereza" x={826} y={150} />
                  <CommentPin who="tereza" x={980} y={214} />
                  <CommentPin who="tereza" x={884} y={316} />
                </Kampan>
              </Canvas>
              <GatorChrome left
                insp={<Inspector title="Post 1:1 · Combine 2026" rows={[["Preset", <InSelect value="Post" />], ["Size", <InSize w={1080} h={1080} />], ["Fill", <InFill name="Ink" tone="ink" />], ["Clip content", <InSwitch on />]]} />}
                ai={
                  <AIPanel advanced chat="New chat" scope="Post 1:1" prompt={ASK}
                    above={<Suggest icon={<PinDot />} chips={["Resolve 3 comments", "Three variants", "English version"]} why="Because Tereza left 3 comments on Post 1:1" />}>
                    <p className="ai-hint">Ask for a change, a few variants, or an answer. AI works on what the chip says.</p>
                  </AIPanel>
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-suggest" label="3 · Suggestions follow what you were doing" width={1520} height={640} fixed>
          <Closeup title="Suggestions come from your last moves, and say why." note={<Note n={3} title="Three chips at most, each one line, with one reason.">Open comments, selected clips, a canvas you just shared, your last ask — the lead chip follows it. Follow-ups under an answer need no reason; Advanced › Suggestions turns them off.</Note>}>
            <div className="ai-ctxs">
              <div className="ai-ctx">
                <span className="ai-scope-lab">3 comments are open</span>
                <div className="ai-ctx-stage">
                  <div className="ai-mini ai-ctx-mini"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div>
                  <CommentPin who="tereza" x={130} y={22} />
                  <CommentPin who="tereza" x={214} y={70} />
                  <CommentPin who="jonas" x={150} y={118} />
                </div>
                <AIPanel free chat="New chat" scope="Combine-kampan"
                  above={<Suggest icon={<PinDot />} chips={["Resolve 3 comments", "Reply to Tereza", "List what changed"]} why="Because 3 comments are open on this canvas" />}>
                  <p className="ai-hint">Ask for a change, a few variants, or an answer.</p>
                </AIPanel>
              </div>
              <div className="ai-ctx">
                <span className="ai-scope-lab">4 clips are selected</span>
                <div className="ai-ctx-stage ai-ctx-stage--clips">
                  {["trenink-0412.mov", "combine-start.mov", "40y-sprint.mov", "tackle-2.mov"].map((c) => (
                    <span key={c} className="ai-clipsel"><Thumb art="video" className="ai-clipsel-th" /><span className="ai-clipsel-n">{c}</span></span>
                  ))}
                </div>
                <AIPanel free chat="New chat" scope="4 clips"
                  above={<Suggest icon="video" chips={["Cut a 15 s video from these", "Czech captions", "Best moments"]} why="Because 4 clips are selected" />}>
                  <p className="ai-hint">Ask for a change, a few variants, or an answer.</p>
                </AIPanel>
              </div>
              <div className="ai-ctx">
                <span className="ai-scope-lab">A canvas you just shared</span>
                <div className="ai-ctx-stage ai-ctx-stage--done">
                  <span className="ai-ctx-row"><span className="ai-mini ai-mini--s ai-ctx-s"><GatorMock variant="invite" headline="POZVÁNKA" sub="" /></span><span className="ai-mini ai-mini--s ai-ctx-s"><GatorMock variant="invite" headline="COMBINE" sub="" /></span><span className="ai-mini ai-mini--s ai-ctx-s"><GatorMock variant="social" headline="14. 3." sub="" /></span></span>
                  <span className="ai-ctx-event"><Icon name="people" size={12} />Combine-invite · shared with Jonas · 2 min ago</span>
                </div>
                <AIPanel free chat="New chat" scope="Combine-invite"
                  above={<Suggest icon="view" chips={["Run a design review", "Check it for print", "English version"]} why="Because you just shared this canvas" />}>
                  <p className="ai-hint">Ask for a change, a few variants, or an answer.</p>
                </AIPanel>
              </div>
              <div className="ai-ctx">
                <span className="ai-scope-lab">Your last ask was about colour</span>
                <div className="ai-ctx-stage ai-ctx-stage--last">
                  <p className="k-ai-msg k-ai-msg--you ai-ctx-ask">{ASK}</p>
                  <span className="ai-ctx-event"><Icon name="check" size={12} />Done on Post 1:1 · 10 min ago</span>
                </div>
                <AIPanel free chat="New chat" scope="Story 9:16"
                  above={<Suggest icon="history" chips={["Same for the story", "A darker green", "Same on all 21"]} why="Because you last asked for a greener post" />}>
                  <p className="ai-hint">Ask for a change, a few variants, or an answer.</p>
                </AIPanel>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-scope" label="4 · The chip says what AI touches" width={1320} height={540} fixed>
          <Closeup title="The chip is the scope — it follows your selection." note={<Note n={4} title="One chip, four cases.">Nothing selected means the whole canvas. Click the chip to change it before you send; ⌘/ always attaches what is selected now.</Note>}>
            <div className="ai-scope-grid">
              <div className="ai-scope-col">
                <span className="ai-scope-lab">Folded</span>
                <div className="ai-scope-stage ai-scope-stage--fold">
                  <PanelIcon icon="spark" at="ai" style={{ position: "absolute", right: 16, bottom: 16 }} />
                  <span className="k-tip ai-tip-near">Ask AI <Kbd>⌘</Kbd><Kbd>/</Kbd></span>
                </div>
                <p className="ai-scope-cap">The spark sits in the corner. Click it or press ⌘/.</p>
              </div>
              <div className="ai-scope-col">
                <span className="ai-scope-lab">One artboard</span>
                <div className="ai-scope-stage">
                  <div className="ai-mini ai-mini--sel"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div>
                  <div className="ask k-ask ai-scope-ask"><span className="chip chip--accent k-selchip">◆ Post 1:1</span><span className="k-ask-in k-ask-ph">Ask AI…</span><span className="send"><Spark size={12} color="var(--spark-fg)" /></span></div>
                </div>
                <p className="ai-scope-cap">The artboard's short name. Long Czech names are cut, never wrapped.</p>
              </div>
              <div className="ai-scope-col">
                <span className="ai-scope-lab">Nothing selected</span>
                <div className="ai-scope-stage">
                  <div className="ai-mini-row"><span className="ai-mini ai-mini--s"><GatorMock variant="social" headline="COMBINE" sub="" /></span><span className="ai-mini ai-mini--s"><GatorMock variant="poster" headline="A4" sub="" /></span><span className="ai-mini ai-mini--s"><GatorMock variant="reel" headline="ZAPIŠ SE" sub="" /></span></div>
                  <div className="ask k-ask ai-scope-ask"><span className="chip chip--accent k-selchip">◆ Whole canvas</span><span className="k-ask-in k-ask-ph">Ask AI…</span><span className="send"><Spark size={12} color="var(--spark-fg)" /></span></div>
                  <Menu style={{ left: 12, bottom: 60 }} width={216} items={[
                    { label: "Whole canvas", checked: true }, { label: "Post 1:1 · Combine 2026", checked: false }, { label: "Choose artboards…", checked: false }, "sep", { label: "No canvas — just ask", checked: false },
                  ]} />
                </div>
                <p className="ai-scope-cap">Click the chip to narrow it, or to ask without touching the canvas.</p>
              </div>
              <div className="ai-scope-col">
                <span className="ai-scope-lab">Several artboards</span>
                <div className="ai-scope-stage">
                  <div className="ai-mini-row"><span className="ai-mini ai-mini--s ai-mini--sel"><GatorMock variant="social" headline="COMBINE" sub="" /></span><span className="ai-mini ai-mini--s ai-mini--sel"><GatorMock variant="reel" headline="ZAPIŠ SE" sub="" /></span><span className="ai-mini ai-mini--s ai-mini--sel"><GatorMock variant="poster" headline="A4" sub="" /></span></div>
                  <div className="ask k-ask ai-scope-ask"><span className="chip chip--accent k-selchip">◆ 3 artboards</span><span className="k-ask-in">Same green on all three<i className="k-caretline" /></span><span className="send"><Spark size={12} color="var(--spark-fg)" /></span></div>
                </div>
                <p className="ai-scope-cap">Shift-click or drag to select; the count is the chip. Hover lists their names.</p>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-working" label="5 · AI works where you can see it" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Progress is one line, on the panel and on the canvas.">The artboard wears a dashed spark and a tag; the panel shows the same words with Stop. You keep working anywhere else.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan post="half" postAi="AI is making it greener">
                  <Cursor name="you" tag={false} x={520} y={250} />
                </Kampan>
              </Canvas>
              <GatorChrome status="syncing" ai={
                <AIPanel advanced chat="Make it greener" scope="Post 1:1">
                  <You>{ASK}</You>
                  <Working step="Background done · badge next">AI is making it greener</Working>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-done" label="6 · Done — the finish, then Undo or Keep going" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="Done shows itself on the artboard.">The dashed spark closes into a solid ring and a wipe passes before → after, then settles into Made by AI. The panel says what changed; Undo takes the whole change back.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan postWipe={62} postMade="Made by AI">
                  <Ring kind="done" x={784} y={104} w={272} h={272} />
                </Kampan>
              </Canvas>
              <GatorChrome ai={
                <AIPanel advanced chat="Make it greener" scope="Post 1:1" chips={["Same on Story 9:16", "A darker green"]}>
                  <You>{ASK}</You>
                  <Result>{DONE}</Result>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-attach" label="7 · Drop a photo or footage in" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Drag files straight onto the panel, or paste.">Photos, footage and PDFs land inside the prompt and in Assets too; ⌘V pastes a screenshot the same way. The scope chip still says where AI works.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan sel="teaser" /></Canvas>
              <GatorChrome ai={
                <AIPanel advanced className="ai-own" style={{ height: 400 }} chat="New chat" scope="16:9 · teaser"
                  above={<Composer scope="16:9 · teaser" text="Use this clip for the first three seconds" chips={<><AChip kind="image" name="kravi-hora-hriste.jpg" art="gator-poster" /><AChip kind="file" name="Combine-brief-2026.pdf" meta="PDF · 12 pages" /></>} />}
                  drop={<span className="ai-drop"><Icon name="video" size={20} /><strong>Drop to attach</strong><span>AI can use it in this chat</span></span>}>
                  <p className="ai-hint">Ask for a change, a few variants, or an answer. AI works on what the chip says.</p>
                </AIPanel>
              } />
              <span className="ai-ghost" style={{ left: 1110, top: 650 }}>
                <span className="ai-ghost-card"><Thumb art="video" className="ai-ghost-thumb" /><span><strong>trenink-0412.mov</strong><span>Footage · 0:42</span></span></span>
                <span className="ai-ghost-plus">+1</span>
              </span>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-attach-menu" label="8 · The paperclip — files, a folder, Assets, a screenshot" width={1320} height={700} fixed>
          <Closeup title="One paperclip in the prompt. Everything you attach sits inside it." note={<Note n={8} title="Attach without leaving the field.">The paperclip lists the four ways in; dragging onto the panel still works. A folder from disk asks once, then attaches straight away next time.</Note>}>
            <div className="ai-am">
              <div className="ai-am-col">
                <span className="ai-scope-lab">The paperclip opens</span>
                <div className="ai-am-stage">
                  <AIPanel free className="ai-own" style={{ height: 380 }} chat="New chat" scope="Post 1:1"
                    above={<Composer scope="Post 1:1" clipOpen menu={<AttachMenu highlight="Choose a folder…" style={{ left: 0, bottom: "calc(100% + 8px)" }} />} />}>
                    <p className="ai-hint">Ask for a change, a few variants, or an answer. AI works on what the chip says.</p>
                  </AIPanel>
                </div>
                <p className="ai-scope-cap">Attach files… and Choose a folder… open the Mac's own picker. From Assets opens the left panel's Assets tab to pick from.</p>
              </div>
              <div className="ai-am-col">
                <span className="ai-scope-lab">What a chip shows</span>
                <div className="ai-am-kinds">
                  <span className="ai-am-kind"><AChip kind="image" name="kravi-hora-01.jpg" art="gator-poster" /><span><strong>Photo</strong>A thumbnail; the name shows on hover.</span></span>
                  <span className="ai-am-kind"><AChip kind="video" name="trenink-0412.mov" meta="Footage · 0:42" art="video" /><span><strong>Footage</strong>Its length, so AI knows what it has.</span></span>
                  <span className="ai-am-kind"><AChip kind="file" name="Combine-brief-2026.pdf" meta="PDF · 12 pages" /><span><strong>File</strong>Name and what it is.</span></span>
                  <span className="ai-am-kind"><AChip kind="folder" name="Combine 2026 fotky" meta="48 files" /><span><strong>Folder</strong>Name and how many files are inside.</span></span>
                  <span className="ai-am-kind"><AChip kind="image" name="Snímek obrazovky 2026-10-06 v 14.05.png" art="board" /><span><strong>Screenshot</strong>⌘V in the field — same as a photo.</span></span>
                </div>
                <p className="ai-scope-cap">Every chip has its ×. What you attach also lands in Assets, so the next chat can use it.</p>
              </div>
              <div className="ai-am-col">
                <span className="ai-scope-lab">A folder asks once</span>
                <div className="ai-am-stage">
                  <AIPanel free className="ai-own" chat="New chat" scope="Story 9:16"
                    above={<><Consent /><Composer scope="Story 9:16" text="Pick the six sharpest action shots" chips={<AChip kind="folder" name="Combine 2026 fotky" meta="48 files" wait />} /></>} />
                </div>
                <p className="ai-scope-cap">Only for folders on your Mac. Not now keeps the chip and sends without it; allowed folders are listed in the panel's Advanced.</p>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-question" label="9 · A question — the canvas stays put" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Ask anything; not every answer is a change.">The answer says the canvas didn't change. AI points at the spot it means with a small spark ring, gone when you click, and offers the fix as a chip.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan>
                  <Ring kind="point" x={800} y={647} w={124} h={20} tag="9 pt" />
                </Kampan>
              </Canvas>
              <GatorChrome ai={
                <AIPanel advanced chat="Is the poster readable?" scope="A4 · plakát" chips={["Make the date line 14 pt", "Check LetakA6 too"]}>
                  <You>Is the A4 poster readable from three metres?</You>
                  <Says>Mostly. COMBINE 2026 reads from five metres; the date line is 9 pt and fades past two. The canvas didn't change.</Says>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 1b · A long chat ─────────────────────────────────────────────────────────────── */}
      <DCSection id="long" title="A long chat, in a bigger panel" subtitle="Many turns with photos, a PDF and a folder — the panel grows to full height, resizes from its edge, and pins to the side">
        <DCArtboard id="ai-long" label="10 · A long chat — full height, resizable, scrolled up" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Long chats get room.">The panel grows to the window's full height and its left edge drags wider; earlier turns fold their steps, and Jump to latest brings you back. The prompt grows to six lines before it scrolls.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Web · STAŇ SE GATOREM" kind="web" x={100} y={110} w={420} h={262}><GatorMock variant="web" /></Artboard>
                <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={560} y={110} w={240} h={240}><div className="ai-post ai-post--green"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={100} y={440} w={150} h={267}><div className="ai-post ai-post--green"><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></div></Artboard>
                <Artboard label="A4 · plakát" kind="print" x={290} y={430} w={190} h={269}><GatorMock variant="poster" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                <Artboard label="Reels 9:16 · recap" kind="video" x={520} y={440} w={150} h={267}><VideoFrameMock caption="Combine 2026" time="0:00 / 0:15" vertical /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={36} />
              <Toolbar />
              <BigChat title="Combine recap" up resize
                jump={<span className="ai-jump"><Icon name="chevron" size={12} />Jump to latest<span className="ai-jump-n">2 new</span></span>}
                composer={<Composer multi scope="Reels 9:16 · recap"
                  chips={<AChip kind="video" name="recap-2025.mp4" meta="Footage · 0:31" art="video" />}
                  text="Now cut a 15 s recap for Reels from the six shots — fast cuts on the beat, end on the ZAPIŠ SE card, and use the music from last year's recap." />}>
                <Divider>Yesterday, 18:20</Divider>
                <YouWith chips={<><Sent kind="image" art="gator-poster" /><Sent kind="image" art="gator-social" /><Sent kind="image" art="gator-reel" /></>}>Make a story from these three, same look as the post</YouWith>
                <div className="ai-result">
                  <p className="k-ai-msg k-ai-msg--ai">Done — Story 9:16 uses the three photos in Club green, like Post 1:1. The logo stays white.</p>
                  <span className="ai-ba">
                    <span className="ai-ba-pic"><span className="ai-mini ai-ba-mini"><GatorMock variant="reel" headline="" sub="" /></span><span className="ai-ba-l">Before</span></span>
                    <Icon name="chevron-r" size={14} />
                    <span className="ai-ba-pic"><span className="ai-mini ai-ba-mini ai-post--green"><GatorMock variant="reel" headline="" sub="" /></span><span className="ai-ba-l">After</span></span>
                  </span>
                  <span className="ai-result-acts"><span className="chip ai-act"><Icon name="undo" size={12} />Undo</span><span className="chip ai-act"><Icon name="view" size={12} />Compare</span></span>
                  <Steps>What AI did · 6 steps · 41 s</Steps>
                </div>
                <YouWith chips={<Sent kind="file" name="Combine-brief-2026.pdf" meta="PDF · 12 pages" />}>Check the poster against the brief</YouWith>
                <Says>Two things differ from the brief: the date should read “So 14. 3. 2026”, and the sponsor strip is missing. The canvas didn't change.</Says>
                <Divider>Today, 09:12</Divider>
                <YouWith chips={<Sent kind="folder" name="Combine 2026 fotky" meta="48 files" />}>Pick the six sharpest action shots for the recap</YouWith>
                <Says>Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked.</Says>
              </BigChat>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-long-pinned" label="11 · Pinned to the side — a full-height column" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Pin to the side when the chat is the work.">The pin in the panel's header docks it as a full-height column and the canvas makes room; drag the edge to size it. Same as Menu › View › Advanced › Pin panels to the side, for this panel only.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <div className="ai-pinlay">
                <div className="ai-pin-c">
                  <Canvas>
                    <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={100} y={130} w={150} h={267}><div className="ai-post ai-post--green"><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></div></Artboard>
                    <Artboard label="Reels 9:16 · recap" kind="video" x={300} y={130} w={180} h={320} aiWorking="AI is cutting the recap" aiAt="below"><VideoFrameMock caption="Combine 2026" time="0:06 / 0:15" vertical /></Artboard>
                    <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={540} y={130} w={220} h={220}><div className="ai-post ai-post--green"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
                    <Artboard label="A4 · plakát" kind="print" x={540} y={410} w={170} h={240}><GatorMock variant="poster" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
                  </Canvas>
                  <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
                  <PanelIcon icon="panel-left" at="left" />
                  <ShareCluster people={["tereza", "jonas"]} status="syncing" mode="edit" />
                  <ZoomUndo zoom={36} />
                  <Toolbar />
                </div>
                <span className="ai-pin-h"><i /></span>
                <div className="ai-pin-r">
                  <BigChat title="Combine recap" pinned count={1}
                    pinTip={<span className="k-tip ai-pin-tip">Unpin — float over the canvas</span>}
                    composer={<Composer scope="Reels 9:16 · recap" />}>
                    <YouWith chips={<><Sent kind="image" art="gator-poster" /><Sent kind="image" art="gator-social" /><Sent kind="image" art="gator-reel" /></>}>Make a story from these three, same look as the post</YouWith>
                    <Result actions={["Undo", "Compare"]}>Done — Story 9:16 uses the three photos in Club green, like Post 1:1. The logo stays white.</Result>
                    <YouWith chips={<Sent kind="file" name="Combine-brief-2026.pdf" meta="PDF · 12 pages" />}>Check the poster against the brief</YouWith>
                    <Says>Two things differ from the brief: the date should read “So 14. 3. 2026”, and the sponsor strip is missing. The canvas didn't change.</Says>
                    <Divider>Today, 09:12</Divider>
                    <YouWith chips={<Sent kind="folder" name="Combine 2026 fotky" meta="48 files" />}>Pick the six sharpest action shots for the recap</YouWith>
                    <div className="ai-result">
                      <p className="k-ai-msg k-ai-msg--ai">Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked.</p>
                      <span className="ai-six">{(["gator-poster", "gator-social", "gator-reel", "gator-poster", "gator-social", "gator-reel"] as Art[]).map((a, i) => <Thumb key={i} art={a} className="ai-six-th" />)}</span>
                      <Steps>What AI did · 4 steps · 1 min</Steps>
                    </div>
                    <YouWith chips={<Sent kind="video" name="recap-2025.mp4" meta="Footage · 0:31" />}>Now cut a 15 s recap for Reels from the six shots — fast cuts on the beat, end on the ZAPIŠ SE card, and use the music from last year's recap.</YouWith>
                    <Working step="4 of 6 shots placed · music next">AI is cutting the recap</Working>
                  </BigChat>
                </div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Several at once ──────────────────────────────────────────────────────────── */}
      <DCSection id="several" title="Several AI chats at once" subtitle="Different artboards, the same artboard, a copy, another project tab, Tereza's AI, many chats, a hidden panel, quitting mid-run">
        <DCArtboard id="ai-two-artboards" label="12 · Two chats, two artboards" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Side by side, each on its own artboard.">Every running chat has its artboard, its spark outline and its tag. The count next to the title lists them; click one to jump there. Nothing to manage.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan post="half" poster="en" postAi="AI is making it greener" posterAi="AI is translating to English" /></Canvas>
              <GatorChrome status="syncing" ai={
                <AIPanel advanced chat="Translate the poster" scope="A4 · plakát" runs={{ open: true, yours: [
                    { title: "Make it greener", where: "Post 1:1 · Combine 2026", state: "working" },
                    { title: "Translate the poster", where: "A4 · plakát", state: "working", current: true },
                  ] }}>
                  <You>Translate the poster to English, keep the layout</You>
                  <Working step="Headline and date done · button next">AI is translating to English</Working>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-same-artboard" label="13 · Same artboard — the second one waits" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="One AI per artboard. The next one waits its turn.">The second ask starts by itself when “Make it greener” finishes, on top of its result. Can't wait? Run on a copy puts a duplicate beside it for AI to work on.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan post="half" postAi="AI is making it greener · 1 waiting" /></Canvas>
              <GatorChrome status="syncing" ai={
                <AIPanel advanced chat="Headline in one word" scope="Post 1:1" count={2}>
                  <You>Headline in one word</You>
                  <Waiting title={<>Waiting for “Make it greener” to finish on Post 1:1.</>}>Starts by itself, on top of its result — about a minute.</Waiting>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-copy" label="14 · Run on a copy — both versions, side by side" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="A copy starts from before the busy chat, so ideas never mix.">Post 1:1 · copy lands right beside the original. Keep the copy replaces Post 1:1 (the original stays in Version history); Undo removes the copy.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan post="green" postMade="Made by AI">
                  <span className="ai-copy-link" style={{ left: 1050, top: 240, width: 40 }} />
                  <Artboard label="Post 1:1 · copy" kind="digital" x={1090} y={110} w={260} h={260} aiMade="Made by AI" selected>
                    <div className="ai-post ai-post--plain"><GatorMock variant="social" headline="COMBINE" sub="So 14. 3. · Kraví hora" /></div>
                  </Artboard>
                  <span className="ai-copy-from" style={{ left: 1090, top: 386 }}><Icon name="duplicate" size={12} />Copied from Post 1:1 before “Make it greener”</span>
                </Kampan>
              </Canvas>
              <GatorChrome ai={
                <AIPanel advanced chat="Headline in one word" scope="Post 1:1 · copy" chips={["Same on Post 1:1"]}>
                  <You>Headline in one word</You>
                  <Divider>Ran on a copy — Post 1:1 was busy</Divider>
                  <Result actions={["Undo", "Keep the copy"]}>Done — Post 1:1 · copy says COMBINE. It started from Post 1:1 before “Make it greener”, so each shows one idea.</Result>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-queue-rule" label="15 · The rule, drawn once" width={1320} height={580} fixed>
          <Closeup title="One AI at a time per artboard. Everything else runs side by side." note={<Note n={15} title="Why a line, not a race.">Two AIs writing the same artboard would undo each other. A line keeps both changes; a copy keeps both versions. Same rule for your AI, Tereza's and Jonas's.</Note>}>
            <div className="ai-lanes">
              <div className="ai-lane-hd"><span /><span className="ai-tick">now</span><span className="ai-tick">+1 min</span><span className="ai-tick">+2 min</span></div>
              <div className="ai-lane">
                <span className="ai-lane-ab"><Thumb art="gator-social" className="k-thumb--row" />Post 1:1</span>
                <span className="ai-track">
                  <span className="ai-job ai-job--run" style={{ left: "0%", width: "40%" }}><Spark size={10} />Make it greener<Avatar who="you" size="sm" /></span>
                  <span className="ai-job ai-job--wait" style={{ left: "41%", width: "34%" }}><Icon name="clock" size={11} />Headline in one word · starts by itself<Avatar who="you" size="sm" /></span>
                  <span className="ai-job ai-job--wait" style={{ left: "76%", width: "22%" }}><Icon name="clock" size={11} />Club green</span>
                </span>
              </div>
              <div className="ai-lane">
                <span className="ai-lane-ab"><Thumb art="gator-print" className="k-thumb--row" />A4 · plakát</span>
                <span className="ai-track"><span className="ai-job ai-job--run" style={{ left: "0%", width: "52%" }}><Spark size={10} />Translate to English<Avatar who="you" size="sm" /></span></span>
              </div>
              <div className="ai-lane">
                <span className="ai-lane-ab"><Thumb art="gator-reel" className="k-thumb--row" />Story 9:16</span>
                <span className="ai-track"><span className="ai-job ai-job--run" style={{ left: "6%", width: "36%" }}><Spark size={10} />Tereza's AI · bigger date<Avatar who="tereza" size="sm" /></span><span className="ai-job ai-job--wait" style={{ left: "43%", width: "20%" }}><Icon name="clock" size={11} />Club green</span></span>
              </div>
              <div className="ai-lane">
                <span className="ai-lane-ab"><Icon name="frame" size={14} />Whole canvas</span>
                <span className="ai-track">
                  <span className="ai-job ai-job--run" style={{ left: "0%", width: "36%" }}><Spark size={10} />Club green everywhere · 13 free artboards now</span>
                  <span className="ai-track-cap" style={{ left: "38%" }}>then Story 9:16 and Post 1:1, each as soon as it is free</span>
                </span>
              </div>
              <div className="ai-lane ai-lane--copy">
                <span className="ai-lane-ab"><Icon name="duplicate" size={14} />Post 1:1 · copy</span>
                <span className="ai-track"><span className="ai-job ai-job--copy" style={{ left: "0%", width: "34%" }}><Spark size={10} />Headline in one word — no waiting</span></span>
              </div>
            </div>
            <ol className="ai-rules">
              <li><strong>Different artboards run side by side.</strong> Each has its own outline and tag.</li>
              <li><strong>The same artboard waits its turn.</strong> Whoever's AI it is, the next ask starts by itself on top of the result.</li>
              <li><strong>A whole-canvas ask doesn't wait.</strong> It starts on the free artboards and takes each busy one when it frees up.</li>
              <li><strong>Run on a copy skips the line.</strong> AI works on a duplicate beside it; you keep the one you like.</li>
            </ol>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-other-tab" label="16 · Running in another project tab" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="A tab with a spark is still working.">AI keeps going in Alligators brand while you work in Studio site. When a chat there finishes, one toast says so; Show switches tabs and opens the result.</Note>}>
            <div className="ai-tabrun">
              <Window tabs={TABS2} activeTab={0}>
                <Canvas>
                  <Artboard label="Homepage" kind="web" x={300} y={120} w={520} h={325}><HeroMock /></Artboard>
                  <Artboard label="Pricing" kind="web" x={860} y={120} w={300} h={325}><PricingMock /></Artboard>
                  <Artboard label="Mobile" kind="web" x={300} y={500} w={150} h={300}><PhoneMock title="Calm software" tone="sky" /></Artboard>
                </Canvas>
                <ProjectPill project="Studio site" canvas="Homepage" />
                <PanelIcon icon="panel-left" at="left" />
                <ShareCluster people={["tereza"]} mode="edit" />
                <ZoomUndo zoom={50} />
                <Toolbar />
                <PanelIcon icon="spark" at="ai" />
                <Toast icon="spark" action="Show">Alligators brand — Post 1:1 is greener. 1 chat still running there.</Toast>
              </Window>
            </div>
            <Tooltip text="Alligators brand · AI is translating A4 · plakát" x={505} y={46} below />
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-tereza" label="17 · Tereza's AI on the same canvas" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Other people's AI looks like yours, with their face in the tag.">Tereza's AI wears the same spark outline and tag, led by her avatar. It shows under “On this canvas” — view only, her chat stays hers.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Kampan webAi="AI is adding the date">
                  <TheirAi x={790} y={110} w={260} h={260} doing="shorter headline" />
                  <Cursor name="tereza" x={430} y={560} />
                  <Cursor name="jonas" x={890} y={640} />
                </Kampan>
              </Canvas>
              <GatorChrome status="syncing" ai={
                <AIPanel advanced chat="Add the date to the hero" scope="Web" runs={{ open: true, all: false,
                  yours: [{ title: "Add the date to the hero", where: "Web · STAŇ SE GATOREM", state: "working", current: true }],
                  canvas: [{ title: "Shorter headline", where: "Post 1:1 · Tereza's AI", state: "working", who: "tereza" }] }}>
                  <You>Add “So 14. 3. · Kraví hora” under the hero headline</You>
                  <Working step="Placing the date line">AI is adding the date</Working>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-chat-list" label="18 · 41 chats — Running, then Earlier" width={1100} height={860} fixed>
          <Closeup title="Every chat is kept with the project, grouped by canvas." note={<Note n={18} title="Running first, then by canvas.">The chat title opens the list. Search finds words inside chats, not just titles. A chat that needs you says so instead of a time.</Note>}>
            <div className="ai-cl-pair">
              <ChatList
                running={[
                  { t: "Make it greener", where: "Combine-kampan › Post 1:1", when: "now", state: "working" },
                  { t: "New team photos", where: "Uniformy-2027 › 4 artboards", when: "", state: "needs" },
                ]}
                groups={[
                  { canvas: "Combine-kampan", art: "gator-poster", count: 9, more: 7, rows: [
                    { t: "Translate the poster", where: "A4 · plakát", when: "12 min ago", hover: true },
                    { t: "Is the poster readable?", where: "A4 · plakát", when: "yesterday" },
                  ] },
                  { canvas: "Uniformy-2027", art: "gator-jersey", count: 5, more: 3, rows: [
                    { t: "Helmet side view in green and gold", where: "Helma z boku", when: "Monday" },
                    { t: "Dres venku from Tereza's sketch", where: "Dres venku", when: "Monday", state: "stopped" },
                  ] },
                  { canvas: "video-hype", art: "gator-reel", count: 3, more: 2, rows: [
                    { t: "Czech captions, word by word", where: "Reels 9:16", when: "2 Oct" },
                  ] },
                ]}
              >
                <Menu style={{ right: 12, top: 318 }} width={200} items={[
                  { label: "Open" }, { label: "Rename…" }, { label: "Copy transcript" }, "sep", { label: "Archive" }, { label: "Move to trash" },
                ]} />
              </ChatList>
              <ChatList query="dres"
                groups={[
                  { canvas: "Uniformy-2027", art: "gator-jersey", rows: [
                    { t: "Darker green for Dres doma", where: "Dres doma", when: "Monday" },
                    { t: "Helmet side view in green and gold", via: "match the dres venku stripes", when: "Monday" },
                  ] },
                  { canvas: "Combine-kampan", art: "gator-poster", rows: [
                    { t: "Three Story variants", via: "players in the 2027 dres", when: "yesterday", who: "tereza" },
                  ] },
                ]}
                foot="3 results"
              />
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-panel-closed" label="19 · Panel hidden — AI keeps going" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Hiding the panel never stops AI.">⌘\ or the panel's own chevron hides it to the spark; the dot says AI is busy. The outline stays on the canvas, and a toast says when each chat is done. Only Stop stops.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan post="green" postMade="Made by AI" storyAi="AI is making the date bigger" /></Canvas>
              <GatorChrome status="syncing" ai={<span className="ai-fold-busy"><PanelIcon icon="spark" at="ai" dot /></span>} />
              <Toast icon="spark" action="Show">Done — Post 1:1 is greener. The logo stays white.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-quit" label="20 · Quitting mid-run" width={1200} height={620} fixed>
          <Closeup title="Quitting stops AI where it is — and keeps what it finished." note={<Note n={20} title="Asked once, honest about what stops.">AI runs on this Mac, so quitting stops it. What it finished is a version; next time the chat carries on with Keep going. Closing a project tab asks the same.</Note>}>
            <div className="ai-quit">
              <div className="ai-quit-win">
                <V2 className="ai-quit-scene">
                  <Canvas>
                    <div className="ai-quit-abs">
                      <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={60} y={70} w={180} h={180} aiWorking="AI is making it greener" aiAt="below"><div className="ai-post ai-post--half"><GatorMock variant="social" headline="COMBINE 2026" /></div></Artboard>
                      <Artboard label="A4 · plakát" kind="print" x={300} y={70} w={127} h={180} aiWorking="AI is translating" aiAt="below"><GatorMock variant="poster" /></Artboard>
                    </div>
                  </Canvas>
                  <Veil />
                  <Dialog title="Quit while AI is working?" primary="Quit" width={380}>
                    2 chats stop where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time.
                  </Dialog>
                </V2>
              </div>
              <span className="ai-arrow"><Icon name="submenu" size={20} /><span>next launch</span></span>
              <AIPanel free advanced chat="Make it greener" scope="Post 1:1">
                <You>{ASK}</You>
                <Divider>Stopped when the app quit · 6 Oct, 18:12</Divider>
                <Result>Post 1:1 is half done — the background is green, the badge and button are not yet.</Result>
              </AIPanel>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · AI needs you ─────────────────────────────────────────────────────────────── */}
      <DCSection id="needs-you" title="When AI needs you" subtitle="How a waiting chat finds you out of sight, then permission, a question, a failure, and AI not ready">
        <DCArtboard id="ai-needs-hidden" label="21 · Needs you — panel hidden, another canvas" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="A chat that needs you finds you.">The folded spark turns azure with a count, the canvas row says Needs you, and one toast offers Open. The count stays until you answer.</Note>}>
            <div className="ai-needs-hidden">
              <Window tabs={TABS2} activeTab={1}>
                <Canvas><Kampan post="green" postMade="Made by AI" /></Canvas>
                <GatorChrome left folders={NEEDS_FOLDERS} ai={<FoldNeeds count={1} />} />
                <span className="ai-needs-toast"><Toast icon="help" action="Open">AI needs you on Uniformy-2027 — replace 4 team photos?</Toast></span>
              </Window>
            </div>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-needs-tab" label="22 · Needs you — in another project tab" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="The tab's spark turns into an azure question mark.">You're in Studio site; a chat in Alligators brand is waiting. One toast says where; Open switches tabs, opens Uniformy-2027 and the question.</Note>}>
            <div className="ai-tabneeds">
              <Window tabs={TABS2} activeTab={0}>
                <Canvas>
                  <Artboard label="Homepage" kind="web" x={300} y={120} w={520} h={325}><HeroMock /></Artboard>
                  <Artboard label="Pricing" kind="web" x={860} y={120} w={300} h={325}><PricingMock /></Artboard>
                  <Artboard label="Mobile" kind="web" x={300} y={500} w={150} h={300}><PhoneMock title="Calm software" tone="sky" /></Artboard>
                </Canvas>
                <ProjectPill project="Studio site" canvas="Homepage" />
                <PanelIcon icon="panel-left" at="left" />
                <ShareCluster people={["tereza"]} mode="edit" />
                <ZoomUndo zoom={50} />
                <Toolbar />
                <PanelIcon icon="spark" at="ai" />
                <span className="ai-needs-toast"><Toast icon="help" action="Open">AI needs you on Uniformy-2027 in Alligators brand</Toast></span>
              </Window>
            </div>
            <Tooltip text="Alligators brand · AI needs you on Uniformy-2027" x={505} y={46} below />
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-needs-away" label="23 · Needs you — the app in the background" width={1320} height={640} fixed>
          <Closeup title="One mark for “needs you”, wherever you are." note={<Note n={23} title="Needs you never times out and never decides for you.">The chat waits on its question while every other chat keeps running. Each mark leads to the same place: the question, open, on its canvas.</Note>}>
            <div className="ai-away">
              <div className="ai-desk">
                <div className="ai-desk-app"><span className="ai-desk-bar"><i /><i /><i /></span><span className="ai-desk-lines"><i /><i /><i /><i /></span></div>
                <div className="ai-notif">
                  <span className="ai-notif-ic"><Mark size={30} /></span>
                  <span className="ai-notif-txt">
                    <span className="ai-notif-app">Maude<span>now</span></span>
                    <strong>AI needs you on Uniformy-2027</strong>
                    <span>Alligators brand · Uniformy-2027 — “Replace 4 team photos?”</span>
                  </span>
                </div>
                <div className="ai-desk-dock"><i /><i /><i /><span className="ai-dock-app"><Mark size={34} /><b>1</b></span><i /></div>
                <p className="ai-desk-cap">Maude in the background: a Mac notification and a count on the Dock icon — the same pair a mention gets. Click either and the question is open. Off in Settings › General.</p>
              </div>
              <div className="ai-ladder">
                <span className="ai-ladder-row"><span className="ai-ladder-spec"><FoldNeeds inline /></span><span className="ai-ladder-t"><strong>Folded spark</strong>An azure ring and a count. It wins over the busy dot.</span></span>
                <span className="ai-ladder-row"><span className="ai-ladder-spec"><span className="ai-spec-tab k-proj"><Avatar ini="A" tone="lilac" size="sm" />Alligators brand<i className="ai-tabmark" /></span></span><span className="ai-ladder-t"><strong>Project tab</strong>The tab's spark becomes an azure question mark.</span></span>
                <span className="ai-ladder-row"><span className="ai-ladder-spec"><span className="row-item ai-spec-row"><Thumb art="gator-jersey" className="k-thumb--row" /><span className="ai-spec-name">Uniformy-2027</span><span className="ai-spec-needs">Needs you</span></span></span><span className="ai-ladder-t"><strong>Canvases panel and chat list</strong>Needs you instead of a time.</span></span>
                <span className="ai-ladder-row"><span className="ai-ladder-spec"><span className="ai-spec-ab"><Thumb art="gator-jersey" w={44} h={60} /><Thumb art="gator-jersey" w={44} h={60} /><span className="ai-spec-ring" /></span></span><span className="ai-ladder-t"><strong>On the artboards</strong>A dashed azure ring around what will change, with the question as its tag.</span></span>
                <div className="ai-ringkey">
                  <span className="ai-ringkey-t">The ring, everywhere AI is on the canvas</span>
                  <span className="ai-ringkey-row">
                    <span className="ai-ringkey-i"><i className="ai-ringkey-sw ai-ringkey-sw--work" />Working</span>
                    <span className="ai-ringkey-i"><i className="ai-ringkey-sw ai-ringkey-sw--done" />Done — settles once</span>
                    <span className="ai-ringkey-i"><i className="ai-ringkey-sw ai-ringkey-sw--needs" />Waiting for you</span>
                  </span>
                </div>
                <p className="ai-sr">Screen readers: one polite live region per panel says Working, Waiting, Done and Needs you once each. ⌘/ moves focus into the field; esc gives it back.</p>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-permission" label="24 · Asks before replacing your work" width={W} height={H} fixed>
          <Stage note={<Note n={24} title="Open lands here: the question open, the ring on what will change.">AI asks first only when it would replace something you made or move it to the trash. Restyling never asks — Undo takes it back.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Uniformy ring /></Canvas>
              <GatorChrome canvas="Uniformy-2027" zoom={24} ai={
                <AIPanel advanced chat="New team photos" scope="Whole canvas">
                  <You>Swap the 2025 team photos for the new ones in Assets › Foto 2026</You>
                  <Permission verb="Replace 4 photos" detail={PERM_DETAIL}>Replace 4 team photos in Uniformy-2027?</Permission>
                </AIPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ai-choice-fail" label="25 · A question back, and a failure" width={920} height={600} fixed>
          <Closeup title="AI asks when it can't guess; it says plainly when it can't finish." note={<Note n={25} title="Choices, not essays.">A question comes with picks and a way to type your own. A failure says what happened, that nothing changed, and the one verb that fixes it.</Note>}>
            <div className="ai-pair">
              <AIPanel free advanced chat="Make it greener" scope="Post 1:1">
                <You>{ASK}</You>
                <Choice q="Which green?" picked="Club green" options={[
                  { label: "Club green", sw: "green", hint: "from the Alligators design system" },
                  { label: "Lighter green", sw: "light", hint: "reads better on print" },
                  { label: "Darker green", sw: "dark", hint: "for night photos" },
                  { label: "Something else…" },
                ]} />
              </AIPanel>
              <AIPanel free advanced chat="Hype reel, 15 s" scope="Reels 9:16">
                <You>Cut the hype reel to 15 s from the training footage</You>
                <Problem title="Couldn't finish — the footage file is missing. Nothing changed." verb="Pick another clip">
                  trenink-0412.mov was moved or renamed. Put it back in Assets to try again, or pick another clip.
                </Problem>
              </AIPanel>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-not-ready" label="26 · Not connected · offline · setting up · used up · almost used up" width={1840} height={660} fixed>
          <Closeup title="When AI can't run yet: Ask AI still takes the prompt, and keeps it." note={<Note n={26} title="The rest of the app keeps working.">Not connected, the first send asks once to connect a Claude account; offline, the prompt is queued. Setting up or used up, it waits in the field. Details: Menu › Diagnostics › AI setup.</Note>}>
            <div className="ai-trio">
              <div className="ai-conn">
                <AIPanel free advanced dim chat="Three Story variants" scope="Whole canvas">
                  <You>Three Story variants</You>
                </AIPanel>
                <ConnectSheet inline width={360} />
              </div>
              <AIPanel free advanced chat="Three Story variants" scope="Whole canvas">
                <You>Three Story variants</You>
                <p className="ai-queued"><Icon name="clock" size={12} />Queued — sends when this Mac is online.</p>
                <p className="ai-offline"><Icon name="offline" size={14} />AI is back when this Mac is online.</p>
              </AIPanel>
              <AIPanel free advanced chat="New chat" scope="Whole canvas" prompt="Three Story variants">
                <div className="ai-state">
                  <span className="ai-state-ic ai-state-ic--busy motion-soft"><Spark size={16} /></span>
                  <p><strong>Setting up AI on this Mac.</strong> About a minute — keep drawing meanwhile.</p>
                  <span className="ai-bar"><i style={{ width: "62%" }} /></span>
                </div>
              </AIPanel>
              <AIPanel free advanced chat="New chat" scope="Whole canvas" prompt="Three Story variants">
                <div className="ai-state">
                  <span className="ai-state-ic"><Icon name="clock" size={16} /></span>
                  <p><strong>AI’s allowance is used up until 18:40.</strong> Your prompt is kept and sends then.</p>
                  <span className="btn btn--sm">See usage</span>
                </div>
              </AIPanel>
              <AIPanel free advanced chat="Three Story variants" scope="Story 9:16"
                above={<p className="ai-quota"><span className="ai-bar ai-bar--meter"><i style={{ width: "90%" }} /></span>90% of this 5-hour allowance used · resets 18:40</p>}>
                <You>Three Story variants</You>
                <Working step="First variant done">AI is drawing three variants</Working>
              </AIPanel>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Advanced ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced, inside the panel" subtitle="Model, modes, tools, images video and voice, the raw log, slash commands, the session, Open in terminal — one disclosure away, never in the way">
        <DCArtboard id="ai-advanced" label="27 · Advanced — everything that used to be visible" width={1000} height={1340} fixed>
          <Closeup title="Advanced is a layer of the panel, not a mode of the app." note={<Note n={27} title="Nothing removed, only hidden.">Model, modes, tools, the image, video and voice settings, the raw tool log, slash commands and the session sit under Advanced at the panel's foot. ⌘K finds each by name (“model”, “raw log”, “terminal”).</Note>}>
            <div className="ai-pair">
              <AIPanel free chat="Make it greener" scope="Post 1:1" advanced={
                <>
                  <span className="k-adv-btn ai-adv-hd"><span className="k-adv-ch ai-rot"><Icon name="submenu" size={12} /></span>Advanced</span>
                  <div className="ai-adv-rows">
                    <span className="ai-adv-row"><span>Model</span><InSelect value="Opus" /></span>
                    <span className="ai-adv-row"><span>Effort</span><span className="seg k-in-seg"><span className="k-seg-b">Low</span><span className="k-seg-b" aria-pressed="true">Medium</span><span className="k-seg-b">High</span></span></span>
                    <span className="ai-adv-row"><span>Fast mode</span><InSwitch on={false} /></span>
                    <span className="ai-adv-row"><span>Ask before</span><InSelect value="Replace or move to the trash" /></span>
                    <span className="ai-adv-row"><span>Show in chat</span><InSelect value="Normal" /></span>
                    <span className="ai-adv-row"><span>Suggestions</span><InSelect value="On" /></span>
                    <span className="ai-adv-sub">AI may</span>
                    <span className="ai-adv-row"><span>Change canvases</span><InSwitch on /></span>
                    <span className="ai-adv-row"><span>Use Assets and footage</span><InSwitch on /></span>
                    <span className="ai-adv-row"><span>Search the web</span><InSwitch on /></span>
                    <span className="ai-adv-row"><span>Write outside this project</span><span className="ai-adv-val">Asks every time</span></span>
                    <span className="ai-adv-row"><span>Folders AI may read</span><span className="ai-adv-val">1 · Combine 2026 fotky</span></span>
                    <span className="ai-adv-row"><span>Always allowed on this canvas</span><span className="btn btn--ghost btn--sm">Reset</span></span>
                    <span className="ai-adv-sub">From the agent</span>
                    <span className="ai-adv-row"><span>Agent persona</span><InSelect value="Default" /></span>
                    <span className="ai-adv-hint">Options the agent adds show up here by themselves.</span>
                    <span className="ai-adv-sub">Images, video and voice</span>
                    <span className="ai-adv-row"><span>Provider</span><InSelect value="Gemini" /></span>
                    <span className="ai-adv-row"><span>Shape</span><InSelect value="As the artboard" /></span>
                    <span className="ai-adv-row"><span>Place on the canvas</span><InSwitch on /></span>
                    <span className="ai-adv-hint">Keys for images live in Settings › Connections.</span>
                    <span className="ai-adv-sub">This chat</span>
                    <span className="ai-adv-row"><span>Context used</span><span className="ai-meter"><span className="ai-bar ai-bar--meter"><i style={{ width: "38%" }} /></span><b>38%</b></span></span>
                    <span className="ai-adv-row"><span>5-hour limit</span><span className="ai-meter"><span className="ai-bar ai-bar--meter"><i style={{ width: "64%" }} /></span><b>64% · resets 18:40</b></span></span>
                    <span className="ai-adv-row"><span>Session</span><span className="k-mono ai-mono">c-mg4x1k-7f3a9</span></span>
                    <span className="ai-adv-acts"><span className="btn btn--sm"><Icon name="file" size={12} />Raw log</span><span className="btn btn--sm"><Icon name="duplicate" size={12} />Copy transcript</span><span className="btn btn--sm"><Icon name="tab" size={12} />Open in terminal</span></span>
                  </div>
                </>
              }>
                <You>{ASK}</You>
                <Result>{DONE}</Result>
              </AIPanel>
              <div className="ai-adv-right">
                <div className="island island--pad ai-log">
                  <p className="island-title ai-log-t">Raw log<span className="chip">Make it greener</span></p>
                  <div className="ai-log-lines">
                    <span className="k-mono"><b>Read</b> 2026/combine/Combine-kampan.tsx</span>
                    <span className="k-mono"><b>Read</b> system/alligators/colors_and_type.css</span>
                    <span className="k-mono"><b>Edit</b> Combine-kampan.tsx <em className="ai-add">+14</em> <em className="ai-del">−6</em></span>
                    <span className="k-mono"><b>Bash</b> maude design screenshot --screen post-1x1</span>
                    <span className="k-mono ai-log-ok"><b>Done</b> 41 s · 3 tool calls · claude-opus</span>
                  </div>
                </div>
                <div className="island island--pad ai-slash">
                  <div className="ask k-ask"><span className="k-ask-in k-mono">/design:cr<i className="k-caretline" /></span><span className="send"><Spark size={12} color="var(--spark-fg)" /></span></div>
                  <Menu style={{ position: "relative", left: 0, top: 0, marginTop: 8 }} width={372} items={[
                    { group: "Slash commands" },
                    { label: "/design:critic", note: "Review this canvas", highlight: true },
                    { label: "/design:edit", note: "Change the selection" },
                    { label: "/design:screenshot", note: "Capture an artboard" },
                    { label: "/design:export", note: "Export this canvas" },
                    { label: "/flow:plan", note: "Your own commands too" },
                  ]} />
                </div>
                <p className="ai-adv-foot">Open in terminal continues this exact chat in Claude Code — same session, same history. /design:chat in a terminal does the reverse.</p>
                <div className="island island--pad ai-kq">
                  <span className="k-find k-find--on"><Icon name="search" size={14} /><span className="k-find-q">raw<i className="k-caretline" /></span><Kbd>esc</Kbd></span>
                  {[["Raw log", "AI chat panel › Advanced", "file"], ["Show in chat: Verbose", "AI chat panel › Advanced", "view"], ["Open in terminal", "AI chat panel › Advanced", "tab"]].map(([a, b, ic], i) => (
                    <span key={a} className="row-item ai-kq-row" aria-current={i === 0 ? "true" : undefined}><Icon name={ic} size={14} /><span className="ai-kq-t">{a}</span><span className="chip">{b}</span></span>
                  ))}
                </div>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ai-adv-edges" label="28 · Modes, slash, paste, Copy and Retry, the terminal" width={1520} height={820} fixed>
          <Closeup title="Every agent control has a plain-words home." note={<Note n={28} title="Modes read as what AI may do.">The agent's own names stay in grey for people who know them. A mode where AI changes nothing is said up front, with one verb to undo it.</Note>}>
            <div className="ai-edges">
              <div className="ai-edge">
                <span className="ai-scope-lab">Ask before — the whole list</span>
                <div className="ai-edge-stage ai-modes">
                  <Menu style={{ position: "relative", left: 0, top: 0 }} width={300} items={[
                    { group: "AI asks before…" },
                    { label: "Replace or move to the trash", note: "default", checked: true },
                    { label: "When unsure", note: "auto", checked: false },
                    { label: "Nothing — change freely", note: "acceptEdits", checked: false },
                    "sep", { group: "AI changes nothing" },
                    { label: "Suggest only", note: "plan", checked: false },
                    { label: "Skip what needs asking", note: "dontAsk", checked: false },
                    "sep",
                    { label: "Skip every check", note: "bypassPermissions", checked: false },
                  ]} />
                </div>
                <p className="ai-scope-cap">The model decides which modes it offers; the rest stay hidden. Skip every check shows only where the agent allows it.</p>
              </div>
              <div className="ai-edge">
                <span className="ai-scope-lab">Suggest only, said up front</span>
                <div className="ai-edge-stage">
                  <AIPanel free advanced style={{ height: 460 }} chat="Make it greener" scope="Post 1:1"
                    banner={<div className="ai-modebar"><span className="ai-modebar-ic"><Icon name="view" size={14} /></span><span className="ai-modebar-t"><strong>AI is set to suggest only.</strong> The canvas won't change.</span><span className="btn btn--sm">Allow changes</span></div>}>
                    <You>{ASK}</You>
                    <Says>Suggestion for Post 1:1: Club green background, ink badge and button, the logo stays white. Nothing changed.</Says>
                  </AIPanel>
                </div>
                <p className="ai-scope-cap">Picked Suggest only or Skip what needs asking? The field says so, so “autonomous” never quietly does nothing.</p>
              </div>
              <div className="ai-edge">
                <span className="ai-scope-lab">Type / in the simple field</span>
                <div className="ai-edge-stage">
                  <AIPanel free advanced className="ai-own" style={{ height: 460 }} chat="New chat" scope="Post 1:1"
                    above={<><div className="ai-slashup"><Menu style={{ position: "relative", left: 0, top: 0 }} width={308} items={[
                      { group: "Slash commands" },
                      { label: "/design:critic", note: "Review this canvas", highlight: true },
                      { label: "/design:edit", note: "Change the selection" },
                      { label: "/design:export", note: "Export this canvas" },
                    ]} /></div><Composer scope="Post 1:1" text="/des" chips={<AChip kind="image" name="Snímek obrazovky 2026-10-06 v 14.05.png" art="gator-social" />} /></>}>
                    <p className="ai-hint">Ask for a change, a few variants, or an answer. AI works on what the chip says.</p>
                  </AIPanel>
                </div>
                <p className="ai-scope-cap">Slash commands work without opening Advanced. ⌘V pastes a screenshot as a chip, like a dropped file.</p>
              </div>
              <div className="ai-edge">
                <span className="ai-scope-lab">Copy, Retry, and the terminal</span>
                <div className="ai-edge-stage">
                  <AIPanel free advanced style={{ height: 460 }} chat="Make it greener" scope="Post 1:1">
                    <Divider>Continued from the terminal · 6 Oct, 18:20</Divider>
                    <You>Make the badge rounder too</You>
                    <Says hover>Done — the badge on Post 1:1 is a full pill now. Nothing else moved.</Says>
                  </AIPanel>
                </div>
                <p className="ai-scope-cap">Hover any message for Copy and Retry. /design:chat in a terminal brings that chat here; Open in terminal takes it back.</p>
              </div>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · History & trust ──────────────────────────────────────────────────────────── */}
      <DCSection id="history" title="History and trust" subtitle="Every AI change is a version — compare before and after, restore, undo across chats">
        <DCArtboard id="ai-history" label="29 · Made by AI, in Version history" width={W} height={H} fixed>
          <Stage note={<Note n={29} title="Every AI change is a version you can compare and restore.">⌘Z steps back through your changes and your AI's, newest first. Undo this chat takes back one chat out of order. Tereza's changes are never in your ⌘Z.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <div className="ai-cmp">
                  <Artboard label="Before · 14:31" kind="digital" x={290} y={150} w={380} h={380}><div className="ai-post ai-post--plain"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
                  <Artboard label="After · 14:32 · Made by AI" kind="digital" x={700} y={150} w={380} h={380} selected><div className="ai-post ai-post--green"><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></div></Artboard>
                  <span className="ai-cmp-bar" style={{ left: 290, top: 560 }}>
                    <span className="seg k-in-seg"><span className="k-seg-b" aria-pressed="true">Side by side</span><span className="k-seg-b">Overlay</span></span>
                    <span className="ai-cmp-diff"><Spark size={10} />3 changes · background, badge, button</span>
                  </span>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <div className="island island--pad ai-vh">
                <div className="ai-vh-hd"><Icon name="history" size={14} /><strong>Version history</strong><span className="icon-btn k-icon-sm"><Icon name="close" size={12} /></span></div>
                <span className="seg k-in-seg ai-vh-seg"><span className="k-seg-b" aria-pressed="true">All</span><span className="k-seg-b">Made by AI</span><span className="k-seg-b">People</span></span>
                <div className="ai-vh-list">
                  <span className="row-item ai-vh-row"><span className="ai-vh-dot ai-vh-dot--now" /><span className="ai-vh-t"><strong>Now</strong><span>Combine-kampan · Saved</span></span></span>
                  <span className="row-item ai-vh-row" aria-current="true">
                    <span className="ai-vh-dot ai-vh-dot--ai"><Spark size={10} /></span>
                    <span className="ai-vh-t"><strong>Make it greener</strong><span>Post 1:1 · 14:32</span></span>
                    <span className="chip chip--spark">Made by AI</span>
                  </span>
                  <span className="ai-vh-acts"><span className="btn btn--sm">Undo this chat</span><span className="btn btn--sm btn--primary">Restore</span></span>
                  <span className="row-item ai-vh-row"><Avatar who="you" size="sm" /><span className="ai-vh-t"><strong>Moved the logo</strong><span>Web · 14:20</span></span></span>
                  <span className="row-item ai-vh-row">
                    <span className="ai-vh-dot ai-vh-dot--ai"><Spark size={10} /></span>
                    <span className="ai-vh-t"><strong>Bigger date</strong><span>Story 9:16 · 14:05 · Tereza's AI</span></span>
                    <span className="chip chip--spark">Made by AI</span>
                  </span>
                  <span className="row-item ai-vh-row"><Avatar who="tereza" size="sm" /><span className="ai-vh-t"><strong>Sticky on the poster</strong><span>A4 · plakát · 13:58</span></span></span>
                  <span className="row-item ai-vh-row">
                    <span className="ai-vh-dot ai-vh-dot--ai"><Spark size={10} /></span>
                    <span className="ai-vh-t"><strong>Translate the poster</strong><span>A4 · plakát · yesterday</span></span>
                    <span className="chip chip--spark">Made by AI</span>
                  </span>
                  <span className="row-item ai-vh-row"><Avatar who="jonas" size="sm" /><span className="ai-vh-t"><strong>New teaser cut</strong><span>16:9 · teaser · yesterday</span></span></span>
                </div>
              </div>
              <ZoomUndo zoom={42} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
