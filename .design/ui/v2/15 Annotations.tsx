/**
 * @canvas      15 Annotations — stickies, arrows, marker, sections, stickers and AI on the layer above the design
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   an-enter | an-place | an-sticky | an-today |
 *              an-arrow-bind | an-follow | an-rebind | an-arrow-kinds |
 *              an-marker |
 *              an-section | an-templates | an-plan |
 *              an-stk-gallery | an-stk-search | an-stk-drop | an-stamps | an-vote |
 *              an-vs | an-convert |
 *              an-ai-read | an-ai-apply | an-ai-stickers | an-ai-write |
 *              an-layers | an-visibility |
 *              an-dangling | an-crowd | an-video | an-print | an-viewer | an-figjam
 * @brief       Michal, 2026-10-08: "jeste me doslo ze tam vubec neni navrh jak bude vypadat prace s artboards a annotations,
 *              jak bude vypadat ta samotna editace a objekty atd." — this canvas answers the ANNOTATIONS half (14 Editing
 *              draws artboards and objects). Drawn as a story on Studio site (a Homepage review) and Alligators brand
 *              (planning the Combine 2026 campaign — Czech stickies).
 *
 * GROUND TRUTH (today's whiteboard layer — every capability stays reachable, nothing deleted; an-today draws them):
 *   · plugins/design/skills/whiteboard + DDR-242 — one board per canvas (`<slug>.annotations.json`): sticky · text ·
 *     shape (rect/ellipse/diamond/triangle/triangle-down, fill + stroke, a label inside) · arrow · pen (highlighter is
 *     a pen flag, DDR-090) · image · link · mediaref · section. Sections are containers (members move with them);
 *     arrows store their BINDS, never endpoints — but they bind to BOARD elements only (shapes, cards, text,
 *     sections; annotations-bindings.ts). A pointer end aimed at the design is a fixed point (`--pin`).
 *   · annotations-model.ts — STICKY_PALETTE 10 papers (yellow default) · STROKE_PALETTE 9 inks (ink/black default,
 *     theme-following) · HIGHLIGHTER_PALETTE 4 hues × 3 widths · dashed strokes + arrows · bullet / number lists.
 *     Drawn here: 5 most used up front + "+N" opening the full set (an-sticky, an-marker, an-today).
 *   · apps/studio/annotations-context-toolbar.tsx — arrow line types Straight · Curved · Elbow, heads None · Line ·
 *     Triangle · Triangle (outline) · Circle · Diamond, fill/stroke, bold/italic, align/distribute, group (⌘G /
 *     ⇧⌘G), font sizes Small · Medium · Large · Extra large · Huge (an-arrow-kinds, an-today).
 *   · cf6e70c8 + DDR-246 — Lock / Unlock in the context toolbar, the right-click menu and ⇧⌘L; a locked item can be
 *     selected but not moved, resized, retexted or erased; copies start unlocked; the lock is a UX guard, not a
 *     permission; AI's `annotate` refuses to change a locked item (an-layers).
 *   · read-annotations / annotate / canvas-rects — AI reads the layer with artboard AND element context ("this note is
 *     about the Continue button") and writes stickies + arrows + whole templates, stamped author: ai (an-ai-*).
 *     `--board` templates: retro · kanban · content calendar · roadmap · brainstorm · checklist · flow (an-templates).
 *   · StickerPicker.jsx — 4 bundled packs, keyword search, pack author + source link (Figma Community licence).
 *   · /design:board --from-figjam — a FigJam board arrives as annotations, authors marked imported (an-figjam).
 *   · 9eff034b — export: annotations are opt-in (`includeAnnotations`), never by default (an-print, = 09 Export).
 *   · Comments are a separate layer (pins + threads, skill design § Comments) — an-vs draws the difference.
 *
 * PROPOSED — not in today's model, tagged "Proposed" on every artboard that draws them:
 *   · arrows bound to an artboard's edge or to an element INSIDE an artboard (needs a stable element id that survives
 *     AI rewriting the JSX — an-rebind draws both outcomes) · annotations that move with the artboard they sit on
 *   · stamps as their own element type (counting, one per person per kind) and a vote session (an-stamps, an-vote)
 *   · sticky ↔ comment conversion (an-convert) · stickies pinned to a video time (an-video) · folding a section
 *
 * DECISIONS DRAWN HERE (proposed — questions for Michal in the report):
 *   · Annotations show in BOTH modes. In Edit they are quiet — the paper fades, the words stay readable (≥ 4.5:1),
 *     clicks pass through to the design; ⇧P hides them in any mode. Comment pins show in Edit and Preview, never in
 *     Present (04 wins).
 *   · "Resolve" is one word for comments AND stickies: struck through with a tick, kept in place. "Move resolved
 *     stickies to the trash" (⌘K) clears them — moved, never deleted (an-ai-apply, an-visibility).
 *   · AI writes on paper with a spark edge and draws spark arrows — not an extra sticky colour (an-sticky, an-ai-write).
 *   · Can comment = Hand + Comment only; stickers (vote stamps included) are annotations, so they need Can edit (an-viewer).
 *   · Stickers (E) is ONE gallery — vote stamps on top, Recent, then the four bundled packs (apps/studio/stickers) with
 *     keyword search and their credits; a pick follows the pointer and lands at 160 px (today it lands mid-view,
 *     STICKER_DROP_SIZE); AI marks what it resolved with Project status stickers (an-stk-*, an-stamps, an-ai-stickers).
 *
 * Convention: app artboards are a kit Stage (1440 × 900 window + note strip, artboard 1440 × 980); close-ups carry
 * their note at the foot. Preview artboards use the kit ShareCluster mode="preview" + Toolbar mode="annotate"; Edit
 * moments use the Edit toolbar. Local pieces use the `an-` prefix.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./15 Annotations.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, Artboard, Avatar, Canvas, CanvasesPanel, CommentPin, Cursor, GatorMock, Icon, Kbd, Menu, ModeGlyph, Note,
  PanelIcon, ProjectPill, SearchPalette, ShareCluster, Spark, Stage, TABS, Toast, Toolbar, Tooltip, V2, Veil,
  VideoFrameMock, Window, ZoomUndo, AnnotateIcon,
} from "./_kit";
import type { CanvasItem, Tone, Who } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];
const PETRA = { name: "Petra", ini: "P", tone: "lilac" as Tone }; // lilac, as in 10 Share and Collaboration
/** Sticky papers — the shipped STICKY_PALETTE keeps all ten (annotations-model.ts); five sit up front, "+5" opens the rest. */
type Sw = "yellow" | "coral" | "green" | "sky" | "lilac" | "white" | "grey" | "peach" | "aqua" | "pink";
const PAPER_FRONT: Sw[] = ["yellow", "coral", "green", "sky", "lilac"];
const PAPER_MORE: Sw[] = ["white", "grey", "peach", "aqua", "pink"];
/** Marker inks — the shipped STROKE_PALETTE keeps all nine; Ink (black, theme-following) is the default and comes first. */
type InkId = "ink" | "red" | "amber" | "green" | "blue" | "orange" | "purple" | "pink" | "grey";
const INK_FRONT: InkId[] = ["ink", "red", "amber", "green", "blue"];
const INK_MORE: InkId[] = ["orange", "purple", "pink", "grey"];
/** Highlighter — four hues × three widths (HIGHLIGHTER_PALETTE / HIGHLIGHTER_WIDTHS). */
const HL: Sw[] = ["yellow", "green", "pink", "sky"];
type P = [number, number];
type Box = [number, number, number, number];

/* ═══ Geometry (all in window-body px) ═══════════════════════════════════════════════════════ */

/** A placed artboard: top-left + scale of its design. */
type AB = { x: number; y: number; s: number };
/** An element's design box → canvas box. */
const R = (ab: AB, el: Box): Box => [ab.x + el[0] * ab.s, ab.y + el[1] * ab.s, el[2] * ab.s, el[3] * ab.s];

/** A filled arrowhead at `tip`, pointing away from `from`. */
function head(tip: P, from: P, s = 10): string {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const l: P = [tip[0] - s * Math.cos(a - 0.42), tip[1] - s * Math.sin(a - 0.42)];
  const r: P = [tip[0] - s * Math.cos(a + 0.42), tip[1] - s * Math.sin(a + 0.42)];
  return `M${tip[0]} ${tip[1]} L${l[0].toFixed(1)} ${l[1].toFixed(1)} L${r[0].toFixed(1)} ${r[1].toFixed(1)} Z`;
}
/** An elbow route with rounded corners (the A* router's output, drawn). */
function elbow(pts: P[], r = 12): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const d1 = Math.hypot(cx - px, cy - py);
    const d2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const ax = cx + ((px - cx) / d1) * rr;
    const ay = cy + ((py - cy) / d1) * rr;
    const bx = cx + ((nx - cx) / d2) * rr;
    const by = cy + ((ny - cy) / d2) * rr;
    d += ` L${ax.toFixed(1)} ${ay.toFixed(1)} Q${cx} ${cy} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]} ${l[1]}`;
}

/** One arrow on the annotation layer: an elbow `pts` route, or a free `d` with its `tip` and the control point before it. */
function Arr({ pts, d, tip, tail, cls = "", nohead = false, start = false }: { pts?: P[]; d?: string; tip?: P; tail?: P; cls?: string; nohead?: boolean; start?: boolean }) {
  const path = d ?? elbow(pts ?? []);
  const t = tip ?? (pts ? pts[pts.length - 1] : [0, 0] as P);
  const f = tail ?? (pts ? pts[pts.length - 2] : [0, 0] as P);
  const s0 = pts ? pts[0] : undefined;
  return (
    <g className={`an-arr ${cls}`}>
      <path className="an-arr-l" d={path} />
      {nohead ? null : <path className="an-arr-h" d={head(t, f)} />}
      {start && s0 ? <circle className="an-arr-dot" cx={s0[0]} cy={s0[1]} r={4} /> : null}
    </g>
  );
}

/** The annotation layer's ink: arrows, marker and highlighter, drawn over the artboards. */
function Ink({ children, w = 1440, h = 860, style, className = "" }: { children: ReactNode; w?: number; h?: number; style?: CSSProperties; className?: string }) {
  return <svg className={`an-ink ${className}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={style} aria-hidden="true">{children}</svg>;
}
/** A hand-drawn loop around a box (marker). */
function loop(cx: number, cy: number, rx: number, ry: number, k = 0): string {
  const j = (n: number) => n + Math.sin(n * 0.7 + k) * 3;
  return `M${cx - rx * 0.2} ${cy - ry} C ${j(cx + rx * 0.6)} ${cy - ry * 1.12}, ${cx + rx * 1.05} ${j(cy - ry * 0.5)}, ${cx + rx} ${cy + ry * 0.05} `
    + `S ${cx + rx * 0.4} ${cy + ry * 1.1}, ${cx - rx * 0.2} ${cy + ry} S ${cx - rx * 1.06} ${cy + ry * 0.3}, ${cx - rx * 0.98} ${cy - ry * 0.2} `
    + `S ${cx - rx * 0.4} ${cy - ry * 1.16}, ${cx + rx * 0.25} ${cy - ry * 1.04}`;
}

/* ═══ Annotation pieces ═════════════════════════════════════════════════════════════════════ */

/** A sticky on the annotation layer. Auto-sizes to its words; `who` shows the author line (hover / selected). */
function St({
  c = "yellow", x, y, r = 0, w = 140, who, when, ai = false, done = false, lock = false, sel = false, time, caret = false,
  quiet = false, ghost = false, big = false, children, style, after,
}: {
  c?: Sw; x: number; y: number; r?: number; w?: number; who?: Who; when?: string; ai?: boolean; done?: boolean; lock?: boolean;
  sel?: boolean; time?: string; caret?: boolean; quiet?: boolean; ghost?: boolean; big?: boolean; children: ReactNode; style?: CSSProperties; after?: ReactNode;
}) {
  const name = typeof who === "string" ? (who === "you" ? "You" : who[0].toUpperCase() + who.slice(1)) : who?.name;
  const cls = `sticky ${ai ? "an-st--ai" : `sticky--${c} an-st--${c}`} an-st${done ? " an-st--done" : ""}${sel ? " an-st--sel" : ""}${quiet ? " an-quiet" : ""}${ghost ? " an-st--ghost" : ""}${big ? " an-st--big" : ""}`;
  return (
    <div className={cls} style={{ left: x, top: y, width: w, rotate: `${quiet ? 0 : r}deg`, ...style }}>
      {ai ? <span className="an-st-spark"><Spark size={11} /></span> : null}
      <span className="an-st-t">{children}{caret ? <i className="k-caretline an-caret" /> : null}</span>
      {who || ai ? <span className="an-st-who">{ai ? "AI" : name}{when ? ` · ${when}` : ""}</span> : null}
      {lock ? <span className="an-badge an-badge--lock" title="Locked"><Icon name="lock" size={11} /></span> : null}
      {done ? <span className="an-badge an-badge--done" title="Resolved"><Icon name="check" size={11} /></span> : null}
      {time ? <span className="an-st-time"><Icon name="clock" size={10} />{time}</span> : null}
      {after}
    </div>
  );
}

/** A section (container) on the annotation layer. */
function Sec({ x, y, w, h, title, tone = "grey", min = false, count, sel = false, chip, caret = false, quiet = false, children }: {
  x: number; y: number; w: number; h?: number; title: ReactNode; tone?: Sw | "grey"; min?: boolean; count?: string; sel?: boolean; chip?: ReactNode; caret?: boolean; quiet?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`an-sec an-sec--${tone}${min ? " an-sec--min" : ""}${sel ? " an-sec--sel" : ""}${quiet ? " an-quiet" : ""}`} style={{ left: x, top: y, width: w, height: min ? undefined : h }}>
      <span className="an-sec-t">{min ? <span className="an-sec-tw"><Icon name="submenu" size={12} /></span> : null}{title}{caret ? <i className="k-caretline an-caret" /> : null}{count ? <span className="an-sec-n">{count}</span> : null}{chip}</span>
      {children}
    </div>
  );
}

/** An element the arrow end has snapped to — azure ring + a tag naming it. */
function Snap({ b, label, at = "below", pad = 3 }: { b: Box; label?: ReactNode; at?: "below" | "above" | "right"; pad?: number }) {
  return (
    <span className="an-snap" style={{ left: b[0] - pad, top: b[1] - pad, width: b[2] + pad * 2, height: b[3] + pad * 2 }}>
      {label ? <span className={`an-snap-tag an-snap-tag--${at}`}>{label}</span> : null}
    </span>
  );
}
/** Other elements the end could snap to while you aim (faint). */
function Cand({ b }: { b: Box }) {
  return <span className="an-cand" style={{ left: b[0] - 2, top: b[1] - 2, width: b[2] + 4, height: b[3] + 4 }} />;
}

/** The selection's context toolbar, floating above it. */
function Ctx({ x, y, children, style }: { x: number; y: number; children: ReactNode; style?: CSSProperties }) {
  return <div className="island an-ctx" style={{ left: x, top: y, ...style }}>{children}</div>;
}
function Dots({ on, list = PAPER_FRONT, more }: { on?: string; list?: string[]; more?: number }) {
  return (
    <span className="an-dots">
      {list.map((c) => <i key={c} className={`an-dot an-dot--${c}`} aria-current={on === c ? "true" : undefined} />)}
      {more ? <span className="an-more" title="All colours">+{more}</span> : null}
    </span>
  );
}
/** A designer's tag for behaviour that isn't in today's model — never product chrome. */
function Prop({ children = "Proposed", style }: { children?: ReactNode; style?: CSSProperties }) {
  return <span className="an-prop" style={style}>{children}</span>;
}
const Div = () => <span className="divider-v an-div" />;

/* ─── Stamps — drawn in the glyph hand (16 grid, 1.5 stroke), never emoji fonts ─── */
type StampId = "yes" | "no" | "star" | "heart" | "ask" | "plus";
const STAMP: Record<StampId, { d: ReactNode; tone: Sw; name: string }> = {
  yes: { tone: "yellow", name: "Yes", d: <path d="M5.75 13.25V7.4L8.1 3c.85 0 1.5.75 1.32 1.6l-.42 2.15h2.9a1.35 1.35 0 0 1 1.33 1.6l-.75 3.8a1.35 1.35 0 0 1-1.33 1.1zM2.75 7.4h3v5.85h-3z" /> },
  no: { tone: "coral", name: "No", d: <path transform="rotate(180 8 8)" d="M5.75 13.25V7.4L8.1 3c.85 0 1.5.75 1.32 1.6l-.42 2.15h2.9a1.35 1.35 0 0 1 1.33 1.6l-.75 3.8a1.35 1.35 0 0 1-1.33 1.1zM2.75 7.4h3v5.85h-3z" /> },
  star: { tone: "yellow", name: "Star", d: <path d="M8 2.4l1.7 3.5 3.85.55-2.8 2.7.68 3.8L8 11.15 4.57 12.95l.68-3.8-2.8-2.7 3.85-.55z" /> },
  heart: { tone: "coral", name: "Love it", d: <path d="M8 13.1S2.6 9.95 2.6 6.15A2.75 2.75 0 0 1 8 4.9a2.75 2.75 0 0 1 5.4 1.25c0 3.8-5.4 6.95-5.4 6.95z" /> },
  ask: { tone: "sky", name: "Question", d: <path d="M6.2 6.1a1.85 1.85 0 0 1 3.6.6c0 1.35-1.8 1.55-1.8 2.75M8 11.55h.01" /> },
  plus: { tone: "green", name: "+1", d: <path d="M5 8h4M7 6v4M10.25 5.25L11.5 4.5v6.5" /> },
};
function StampGlyph({ id, size = 16 }: { id: StampId; size?: number }) {
  return <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{STAMP[id].d}</svg>;
}
function Stamp({ id, x, y, who, size = 32, style }: { id: StampId; x?: number; y?: number; who?: Who; size?: number; style?: CSSProperties }) {
  return (
    <span className={`an-stamp an-stamp--${STAMP[id].tone}${x === undefined ? " an-stamp--flow" : ""}`} style={{ left: x, top: y, width: size, height: size, ...style }}>
      <StampGlyph id={id} size={Math.round(size * 0.56)} />
      {who ? <span className="an-stamp-who"><Avatar who={who} size="sm" /></span> : null}
    </span>
  );
}

/* ─── Stickers — the real bundled packs (apps/studio/stickers/<pack>/manifest.json), each PNG imported into this
 *     project as assets/<sha8>.png so the canvas shows the actual art. A picked sticker is re-uploaded as a project
 *     asset and lands at STICKER_DROP_SIZE = 160 px (apps/studio/annotations-model.ts). Keywords are the manifest's. ─── */
type StkId =
  | "psFinished" | "psDone" | "psAlmost" | "psDone2" | "psFinished2" | "psAlmost2" | "psFlagged" | "psIdea" | "psFeedback" | "psAlert"
  | "fdYes" | "fdGood" | "fdQuestions" | "fdGoodCall" | "fdDeadline"
  | "lsBest" | "lsOk" | "lsStar" | "lsYouCan" | "lsYeah"
  | "otLove" | "otKilled" | "otIdea" | "otWip" | "otNotSure";
const STK: Record<StkId, { src: string; k: string[] }> = {
  psFinished: { src: "/assets/8012fe87.png", k: ["done", "finished", "complete"] }, // group-46
  psDone: { src: "/assets/a9022aaf.png", k: ["done", "thumbs-up", "approved"] }, // group-51
  psAlmost: { src: "/assets/f06c9aa3.png", k: ["almost-done", "nearly-finished", "hourglass"] }, // group-56
  psDone2: { src: "/assets/b9bfc76e.png", k: ["done", "thumbs-up", "approved"] }, // group-82
  psFinished2: { src: "/assets/68ba39ed.png", k: ["done", "finished", "complete"] }, // group-96
  psAlmost2: { src: "/assets/ce8c1a10.png", k: ["almost-done", "nearly-finished", "hourglass"] }, // group-99
  psFlagged: { src: "/assets/a905cbe6.png", k: ["flagged", "flag", "important"] }, // group-47
  psIdea: { src: "/assets/2b8f143c.png", k: ["great-idea", "idea", "lightbulb"] }, // group-121
  psFeedback: { src: "/assets/70c25ae9.png", k: ["feedback", "question"] }, // group-53
  psAlert: { src: "/assets/2c0e82e1.png", k: ["high-alert", "warning", "urgent"] }, // group-77
  fdYes: { src: "/assets/f7c3d09a.png", k: ["yes", "agree", "happy"] }, // slice1
  fdGood: { src: "/assets/2b514d38.png", k: ["good", "thumbs-up"] }, // slice12
  fdQuestions: { src: "/assets/7d1e18f9.png", k: ["questions", "ask", "confused"] }, // slice21
  fdGoodCall: { src: "/assets/4f574566.png", k: ["good-call"] }, // slice5
  fdDeadline: { src: "/assets/3942f1fb.png", k: ["deadline", "due-date", "urgent"] }, // slice13
  lsBest: { src: "/assets/a64f8d3b.png", k: ["best"] },
  lsOk: { src: "/assets/4ff249e4.png", k: ["ok"] },
  lsStar: { src: "/assets/74a0267e.png", k: ["star"] },
  lsYouCan: { src: "/assets/0327a8e5.png", k: ["you-can"] },
  lsYeah: { src: "/assets/5f809613.png", k: ["yeah"] },
  otLove: { src: "/assets/11445a7b.png", k: ["love-it"] },
  otKilled: { src: "/assets/a8af7e8e.png", k: ["killed-it"] },
  otIdea: { src: "/assets/b8c9194c.png", k: ["idea"] },
  otWip: { src: "/assets/56f078f4.png", k: ["wip"] },
  otNotSure: { src: "/assets/ada8b018.png", k: ["not-sure"] },
};
/** The four bundled packs, in the gallery's order (names and counts from the manifests). */
const PACKS: { name: string; n: number; by: string; show: StkId[] }[] = [
  { name: "Project status", n: 80, by: "Iconfinder", show: ["psDone", "psFinished", "psAlmost", "psFlagged", "psIdea"] },
  { name: "FigJam Doodle", n: 24, by: "CJ Xue", show: ["fdYes", "fdGood", "fdQuestions", "fdGoodCall", "fdDeadline"] },
  { name: "Life Style", n: 15, by: "Pelin Şenoğlu", show: ["lsBest", "lsOk", "lsStar", "lsYouCan", "lsYeah"] },
  { name: "Opposing Thoughts", n: 20, by: "Erik Leib", show: ["otLove", "otKilled", "otIdea", "otWip", "otNotSure"] },
];
const RECENT: StkId[] = ["psDone", "otLove", "fdYes", "psFlagged", "lsBest", "otIdea"];
const STAMP_ROW: StampId[] = ["yes", "no", "star", "heart", "ask", "plus"];

/** One sticker: the real PNG, pinned to its own light palette (it's the art, not the app). On the canvas pass x/y. */
function Sticker({ id, size = 56, x, y, r = 0, ai = false, style }: { id: StkId; size?: number; x?: number; y?: number; r?: number; ai?: boolean; style?: CSSProperties }) {
  return (
    <span className={`an-sk maude-v2 k-fixed${x === undefined ? " an-sk--flow" : ""}`} data-theme="light" style={{ left: x, top: y, width: size, height: size, rotate: r ? `${r}deg` : undefined, ...style }}>
      <img className="an-sk-img" src={STK[id].src} alt={STK[id].k[0]} width={size} height={size} draggable={false} />
      {ai ? <span className="an-sk-ai" title="Placed by AI"><Spark size={10} /></span> : null}
    </span>
  );
}

/** Flip — mirror left to right (glyph hand: 16 grid, 1.5 stroke). */
function FlipGlyph({ size = 12 }: { size?: number }) {
  return <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v11" strokeDasharray="1.5 2" /><path d="M5.5 4.5L2.5 11.5h3zM10.5 4.5l3 7h-3z" /></svg>;
}

/* Small glyphs this canvas needs that the kit doesn't have (glyph hand: 16 grid, 1.5 stroke) — kit candidates. */
function G({ size = 14, children }: { size?: number; children: ReactNode }) {
  return <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
const ListGlyph = ({ size = 14 }: { size?: number }) => <G size={size}><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" /><path d="M3 4.5h.01M3 8h.01M3 11.5h.01" strokeWidth={2} /></G>;
const GroupGlyph = ({ size = 14 }: { size?: number }) => <G size={size}><path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" /><rect x="5" y="5" width="4" height="4" rx="0.8" /><rect x="7.5" y="7.5" width="3.5" height="3.5" rx="0.8" /></G>;
const DistGlyph = ({ size = 14 }: { size?: number }) => <G size={size}><path d="M2.5 2.5v11M13.5 2.5v11" /><rect x="5.5" y="5" width="5" height="6" rx="1" /></G>;
const AlignTopGlyph = ({ size = 14 }: { size?: number }) => <G size={size}><path d="M2.5 2.5h11" /><rect x="4" y="5" width="3" height="8" rx="0.8" /><rect x="9" y="5" width="3" height="5" rx="0.8" /></G>;
const AudioGlyph = ({ size = 14 }: { size?: number }) => <G size={size}><path d="M6 12.25V3.5l7-1.25v8.5" /><circle cx="4.5" cy="12.25" r="1.75" /><circle cx="11.5" cy="10.75" r="1.75" /></G>;

/** The Stickers gallery (E) — vote stamps on top, Recent, then the bundled packs; or a search across all of them.
 *  Lifts the shipped StickerPicker (apps/studio/client/panels/StickerPicker.jsx) into Preview's popover. */
function Gallery({ q, inline = false, style }: { q?: string; inline?: boolean; style?: CSSProperties }) {
  const hits: [StkId, string][] = [["psFinished", "finished"], ["psDone", "done"], ["psDone2", "approved"], ["psFinished2", "complete"], ["psAlmost", "almost-done"], ["psAlmost2", "almost-done"]];
  return (
    <div className={`island an-gal${inline ? " an-gal--inline" : ""}`} style={style}>
      <p className="an-gal-h"><span>Stickers</span><span className="an-gal-hk"><Kbd>E</Kbd></span></p>
      <span className={`input an-gal-q${q ? " an-gal-q--on" : ""}`}>
        <Icon name="search" size={14} />
        {q ? <span className="an-gal-qv">{q}<i className="k-caretline an-caret" /></span> : <span className="an-gal-ph">Search stickers…</span>}
        {q ? <span className="an-gal-x"><Icon name="close" size={12} /></span> : null}
      </span>
      {q ? (
        <div className="an-gal-b">
          <div className="an-gal-chips">
            <span className="chip an-gal-chip" aria-pressed="true">All · 6</span>
            <span className="chip an-gal-chip">done · 4</span>
            <span className="chip an-gal-chip">almost-done · 2</span>
            <span className="chip an-gal-chip">finished · 2</span>
            <span className="chip an-gal-chip">approved · 2</span>
          </div>
          <div className="an-gal-pk">
            <p className="an-gal-ph2"><strong>Project status</strong><span>6 of 80</span></p>
            <div className="an-gal-g an-gal-g--3">
              {hits.map(([id, kw], i) => (
                <span key={id} className="an-gal-c an-gal-c--kw" data-on={i === 0 ? "true" : undefined}>
                  <Sticker id={id} size={76} />
                  <em>{kw}</em>
                </span>
              ))}
            </div>
          </div>
          <p className="an-gal-none">No “done” in FigJam Doodle, Life Style or Opposing Thoughts · no stamp either</p>
        </div>
      ) : (
        <div className="an-gal-b an-gal-b--fade">
          <div className="an-gal-pk">
            <p className="an-gal-ph2"><strong>Stamps</strong><span>vote · one each · they count</span><Prop style={{ marginLeft: "auto" }} /></p>
            <div className="an-gal-stamps">
              {STAMP_ROW.map((s) => <span key={s} className="an-gal-stb" title={STAMP[s].name}><Stamp id={s} size={32} /></span>)}
            </div>
          </div>
          <div className="an-gal-pk">
            <p className="an-gal-ph2"><strong>Recent</strong><span>yours, last placed first</span></p>
            <div className="an-gal-g">
              {RECENT.map((id) => <span key={id} className="an-gal-c"><Sticker id={id} size={50} /></span>)}
            </div>
          </div>
          {PACKS.map((p) => (
            <div key={p.name} className="an-gal-pk">
              <p className="an-gal-ph2"><strong>{p.name}</strong><span>{p.n} · by {p.by}</span></p>
              <div className="an-gal-g">
                {p.show.map((id) => <span key={id} className="an-gal-c"><Sticker id={id} size={50} /></span>)}
                <span className="an-gal-c an-gal-more">+{p.n - p.show.length}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="an-gal-cr">Packs from the Figma Community: {PACKS.map((p, i) => <Fragment key={p.name}>{i ? " · " : ""}{p.name} — {p.by} (<span className="an-link">source</span>)</Fragment>)}</p>
    </div>
  );
}

/** Preview's own line, top centre (lifted from 04 · md-pbar). */
function PreviewBar({ name, hint = "to edit" }: { name: string; hint?: string }) {
  return (
    <div className="island an-pbar">
      <span className="an-pbar-ic"><ModeGlyph m="preview" size={16} /></span>
      <span className="an-pbar-t">Previewing <strong>{name}</strong></span>
      <span className="an-pbar-div" />
      <span className="an-pbar-esc"><Kbd>esc</Kbd>{hint}</span>
    </div>
  );
}

/** Preview chrome: folded pill + Canvases icon, Preview bar, Share cluster in Preview, undo/zoom, annotate toolbar, AI. */
function PvChrome({
  project = "Studio site", canvas = "Homepage", tool, sw, color, ink, zoom = 60, ai, left, people = ["tereza", "jonas"], toolbar, bar = true, only, canEdit = true, access,
}: {
  project?: string; canvas?: string; tool?: string; sw?: "sticky" | "marker"; color?: Sw; ink?: Sw; zoom?: number | string; ai?: ReactNode; left?: ReactNode;
  people?: Who[]; toolbar?: ReactNode; bar?: boolean; only?: string[]; canEdit?: boolean; access?: string;
}) {
  return (
    <>
      <ProjectPill project={project} canvas={canvas} folded />
      {left ?? <PanelIcon icon="panel-left" at="left" />}
      {bar ? <PreviewBar name={canvas} /> : null}
      <ShareCluster people={people} mode={canEdit ? "preview" : "viewing"} canEdit={canEdit} access={access} />
      <ZoomUndo zoom={zoom} />
      {toolbar ?? <Toolbar mode="annotate" tool={tool} swatches={sw} color={color} ink={ink} only={only} />}
      {ai ?? <PanelIcon icon="spark" at="ai" />}
    </>
  );
}

/* ═══ The designs under the layer (theme-fixed pictures, known geometry) ═══════════════════ */

/** Scales a design drawn at its real size into an artboard. */
function Sc({ s, w, h, children }: { s: number; w: number; h: number; children: ReactNode }) {
  return <div className="an-sc" style={{ width: w, height: h, transform: `scale(${s})` }}>{children}</div>;
}

/* Studio site · Homepage — 1440 × 900 (same page as 04 Modes). */
const HOME = {
  h1: [64, 168, 640, 151] as Box, sub: [64, 344, 540, 60] as Box, cta: [64, 436, 170, 52] as Box, cta2: [250, 436, 184, 52] as Box,
  art: [760, 136, 616, 400] as Box, artBig: [720, 88, 720, 500] as Box, sun: [1208, 192, 96, 96] as Box, book: [1226, 20, 150, 48] as Box,
  svc: [64, 600, 1312, 236] as Box, svc1: [64, 600, 421, 236] as Box,
  ctaBig: [64, 430, 236, 64] as Box, form: [64, 436, 440, 52] as Box,
};
/** cta: "see" today · "ours" = AI rewrote the same button (bigger, new words) · "form" = AI replaced it with a sign-up field. */
function AnHome({ big = false, noBook = false, cta = "see" }: { big?: boolean; noBook?: boolean; cta?: "see" | "ours" | "form" }) {
  return (
    <div className="an-sh">
      <div className="an-sh-nav">
        <span className="an-sh-logo"><b />Studio</span>
        <span>Work</span><span>Services</span><span>Pricing</span><span>About</span>
        {noBook ? <span className="an-sh-navgap" /> : <em>Book a call</em>}
      </div>
      <p className="an-sh-h1">Calm software, made in Brno.</p>
      <p className="an-sh-sub">A small studio for product and brand. Two designers, one developer, no rush.</p>
      {cta === "form" ? (
        <div className="an-sh-ctas"><span className="an-sh-form"><span>Your email</span><b>Get in touch</b></span></div>
      ) : (
        <div className={`an-sh-ctas${cta === "ours" ? " an-sh-ctas--big" : ""}`}><span className={`an-sh-btn an-sh-btn--ink${cta === "ours" ? " an-sh-btn--big" : ""}`}>{cta === "ours" ? "See our work" : "See the work"}</span><span className="an-sh-btn an-sh-btn--line">See pricing →</span></div>
      )}
      <div className={`an-sh-art${big ? " an-sh-art--big" : ""}`}><span className="an-sh-sun" /><span className="an-sh-hill" /><span className="an-sh-hill2" /></div>
      <div className={`an-sh-svc${big ? " an-sh-svc--low" : ""}`}>
        <span><b className="an-sh-dot an-sh-dot--coral" /><strong>Product design</strong>Apps and tools people enjoy using.</span>
        <span><b className="an-sh-dot an-sh-dot--green" /><strong>Brand systems</strong>Logos, type and colour that hold up.</span>
        <span><b className="an-sh-dot an-sh-dot--lilac" /><strong>Small apps</strong>From sketch to the App Store in weeks.</span>
      </div>
    </div>
  );
}
/* Studio site · Homepage on Mobile — 390 × 844. */
const MOB = { art: [20, 84, 350, 220] as Box, cta: [20, 520, 170, 48] as Box };
function AnMobile() {
  return (
    <div className="an-mb">
      <div className="an-mb-nav"><span className="an-sh-logo"><b />Studio</span><span className="an-mb-burger"><i /><i /></span></div>
      <div className="an-mb-art"><span className="an-sh-sun" /><span className="an-sh-hill" /></div>
      <p className="an-mb-h1">Calm software, made in Brno.</p>
      <p className="an-mb-sub">A small studio for product and brand.</p>
      <span className="an-sh-btn an-sh-btn--ink an-mb-btn">See the work</span>
      <div className="an-mb-cards"><span><b className="an-sh-dot an-sh-dot--coral" />Product design</span><span><b className="an-sh-dot an-sh-dot--green" />Brand systems</span></div>
    </div>
  );
}
/* Studio site · Pricing — 1440 × 900. */
const PRI = { title: [64, 64, 800, 80] as Box, toggle: [64, 168, 236, 44] as Box, b: [512, 256, 416, 580] as Box, teamPrice: [992, 340, 300, 56] as Box, days: [544, 436, 300, 24] as Box };
function AnPricing() {
  const plans: [string, string, string[], string][] = [
    ["Solo", "€390", ["One designer", "One day a week", "Email within a day"], "Start with Solo"],
    ["Studio", "€1,200", ["Two days a week", "Design and code", "A call every Monday"], "Start with Studio"],
    ["Team", "Let's talk", ["The whole studio", "Your roadmap, our hands", "A shared channel"], "Book a call"],
  ];
  return (
    <div className="an-pr">
      <p className="an-pr-t">Simple pricing</p>
      <span className="an-pr-tg"><b>Monthly</b><span>Yearly</span></span>
      <div className="an-pr-cards">
        {plans.map(([n, p, f, cta]) => (
          <span key={n} className="an-pr-card">
            <strong>{n}</strong>
            <em>{p}{p.startsWith("€") ? <small> / month</small> : null}</em>
            {f.map((x) => <span key={x} className="an-pr-f"><Icon name="check" size={18} />{x}</span>)}
            <b className="an-pr-btn">{cta}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
/* Alligators brand · Post 1:1 — 1080 × 1080. */
const POST = { head: [72, 600, 900, 150] as Box, date: [72, 780, 820, 56] as Box, cta: [72, 900, 300, 84] as Box, crest: [72, 72, 112, 112] as Box };
function AnPost({ head = "COMBINE 2026", date = "So 14. 3. · Brno, Kraví hora" }: { head?: string; date?: string }) {
  return (
    <div className="an-gp">
      <span className="an-gp-crest" /><span className="an-gp-player" /><span className="an-gp-ball" />
      <strong className="an-gp-h">{head}</strong>
      <span className="an-gp-d">{date}</span>
      <em className="an-gp-cta">ZAPIŠ SE</em>
    </div>
  );
}
/* Alligators brand · A-series print (A4 / A6 share the ratio) — 595 × 842. */
const A4 = { head: [40, 380, 515, 180] as Box, date: [40, 580, 515, 40] as Box, reg: [40, 630, 400, 30] as Box, qr: [455, 702, 100, 100] as Box };
function AnPrint({ back = false }: { back?: boolean }) {
  if (back) {
    return (
      <div className="an-a4 an-a4--back">
        <span className="an-gp-crest an-a4-crest" />
        <strong className="an-a4-bh">Jak na Combine</strong>
        {["40 yd sprint", "Vertikální výskok", "Shuttle 5-10-5", "Bench press 60 kg"].map((t, i) => <span key={t} className="an-a4-row"><b>{i + 1}</b>{t}</span>)}
        <span className="an-a4-qr" />
      </div>
    );
  }
  return (
    <div className="an-a4">
      <span className="an-gp-crest an-a4-crest" />
      <span className="an-a4-flag">FLAG</span>
      <strong className="an-a4-h">COMBINE<br />2026</strong>
      <span className="an-a4-d">So 14. 3. · Kraví hora</span>
      <span className="an-a4-r">Registrace do 10. 3.</span>
      <span className="an-a4-qr" />
    </div>
  );
}
/* Alligators brand · Story 9:16 — 1080 × 1920. */
const STORY = { head: [80, 980, 920, 200] as Box, cta: [80, 1560, 500, 120] as Box };
function AnStory() {
  return (
    <div className="an-sy">
      <span className="an-gp-crest an-sy-crest" /><span className="an-sy-player" />
      <strong className="an-sy-h">ZAPIŠ SE</strong>
      <span className="an-sy-d">do 10. 3. na Combine 2026</span>
      <em className="an-sy-cta">alligators.cz/combine</em>
    </div>
  );
}

/* ─── Placed boards ─── */
const DK: AB = { x: 170, y: 140, s: 0.42 }; // Homepage · Desktop
const MB: AB = { x: 990, y: 140, s: 0.5 }; // Homepage · Mobile
function HomeBoards({ d = DK, m = MB, big = false, noBook = false, mobile = true, sel = false, aiMade = false, dim = false }: { d?: AB; m?: AB | null; big?: boolean; noBook?: boolean; mobile?: boolean; sel?: boolean; aiMade?: boolean; dim?: boolean }) {
  return (
    <>
      <Artboard label="Desktop" kind="web" x={d.x} y={d.y} w={1440 * d.s} h={900 * d.s} selected={sel} size="1440 × 900" aiMade={aiMade} dim={dim}><Sc s={d.s} w={1440} h={900}><AnHome big={big} noBook={noBook} /></Sc></Artboard>
      {mobile && m ? <Artboard label="Mobile" kind="web" x={m.x} y={m.y} w={390 * m.s} h={844 * m.s} dim={dim}><Sc s={m.s} w={390} h={844}><AnMobile /></Sc></Artboard> : null}
    </>
  );
}

/* Alligators · Combine-kampan boards used across sections. */
function PostBoard({ ab, label = "Post 1:1 · Combine 2026", sel = false }: { ab: AB; label?: string; sel?: boolean }) {
  return <Artboard label={label} kind="digital" x={ab.x} y={ab.y} w={1080 * ab.s} h={1080 * ab.s} selected={sel} size="1080 × 1080"><Sc s={ab.s} w={1080} h={1080}><AnPost /></Sc></Artboard>;
}
function PrintBoard({ ab, label = "A4 · plakát", back = false }: { ab: AB; label?: string; back?: boolean }) {
  return <Artboard label={label} kind="print" x={ab.x} y={ab.y} w={595 * ab.s} h={842 * ab.s}><Sc s={ab.s} w={595} h={842}><AnPrint back={back} /></Sc></Artboard>;
}
function StoryBoard({ ab, label = "Story 9:16 · Zapiš se" }: { ab: AB; label?: string }) {
  return <Artboard label={label} kind="digital" x={ab.x} y={ab.y} w={1080 * ab.s} h={1920 * ab.s}><Sc s={ab.s} w={1080} h={1920}><AnStory /></Sc></Artboard>;
}

/** A whole window drawn small (storyboards). */
function Mini({ s, children, h = 900 }: { s: number; children: ReactNode; h?: number }) {
  return <div className="an-mini" style={{ width: 1440 * s, height: h * s }}><div className="an-mini-in" style={{ transform: `scale(${s})`, height: h }}>{children}</div></div>;
}

/* ═══ Close-up frame ════════════════════════════════════════════════════════════════════════ */
function Close({ title, lede, note, children, className = "" }: { title: ReactNode; lede?: ReactNode; note: ReactNode; children: ReactNode; className?: string }) {
  return (
    <V2 className={`an-close ${className}`}>
      <p className="an-close-h">{title}</p>
      {lede ? <p className="an-close-lede">{lede}</p> : null}
      <div className="an-close-b">{children}</div>
      <div className="an-close-note">{note}</div>
    </V2>
  );
}
function Cell({ n, title, children, cap, className = "" }: { n?: number; title: ReactNode; children: ReactNode; cap?: ReactNode; className?: string }) {
  return (
    <div className={`an-cell ${className}`}>
      <p className="an-cell-h">{n !== undefined ? <span className="an-cell-n">{n}</span> : null}{title}</p>
      <div className="an-cell-b">{children}</div>
      {cap ? <p className="an-cell-cap">{cap}</p> : null}
    </div>
  );
}

/* ═══ Studio site — the Homepage review scene, reused by the storyboards ═══════════════════ */
const STUDIO_ITEMS: CanvasItem[] = [
  { name: "Homepage", art: "home", people: ["tereza"] },
  { name: "Pricing", art: "price" },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
];
/** The Homepage review: three artboards' worth of feedback on the layer. `state` picks what the layer looks like. */
function ReviewStickies({ quiet = false, sel = false, only }: { quiet?: boolean; sel?: boolean; only?: "tereza" }) {
  const show = (who: string) => !only || only === who;
  return (
    <>
      {show("tereza") ? <St c="yellow" x={556} y={232} r={-2} w={128} quiet={quiet} sel={sel}>Photo feels small next to the headline</St> : null}
      {show("jonas") ? <St c="sky" x={824} y={250} r={1.5} w={136} quiet={quiet} sel={sel}>Mobile: button above the fold?</St> : null}
      {show("you") ? <St c="green" x={232} y={556} r={-1} w={148} quiet={quiet} sel={sel}>Tiles: one row of words is enough</St> : null}
      {show("tereza") ? <St c="coral" x={1220} y={250} r={2} w={124} quiet={quiet} sel={sel}>Warmer sun?</St> : null}
      <Ink className={quiet ? "an-quiet" : ""}>
        {show("jonas") ? <Arr pts={[[960, 292], [978, 292], [978, 412], [998, 412]]} cls={sel ? "an-arr--sel" : ""} /> : null}
        {show("tereza") ? <path className="an-mk" d={loop(DK.x + 1290 * DK.s, DK.y + 240 * DK.s, 34, 30, 1)} /> : null}
      </Ink>
    </>
  );
}
function ReviewScene({ mode, anno }: { mode: "preview" | "edit"; anno: "on" | "quiet" | "off" | "all" }) {
  return (
    <Window tabs={TABS2} activeTab={0}>
      <Canvas>
        <HomeBoards />
        {anno === "off" ? null : <ReviewStickies quiet={anno === "quiet"} sel={anno === "all"} />}
        {anno === "all" ? <span className="an-marq" style={{ left: 220, top: 220, width: 1140, height: 440 }} /> : null}
      </Canvas>
      {mode === "edit" ? (
        <>
          <ProjectPill project="Studio site" canvas="Homepage" />
          <CanvasesPanel project="Studio site" count={4} items={STUDIO_ITEMS} selected="Homepage" />
          <ShareCluster mode="edit" />
          <ZoomUndo zoom={60} />
          <Toolbar />
          <PanelIcon icon="spark" at="ai" />
        </>
      ) : (
        <PvChrome />
      )}
      {anno === "all" ? (
        <Ctx x={600} y={176}><span className="an-ctx-t"><b>5 annotations</b></span><Div /><span className="btn btn--ghost btn--sm"><Icon name="lock" size={12} />Lock all</span><span className="btn btn--ghost btn--sm"><Icon name="section" size={12} />Wrap in section</span><span className="btn btn--ghost btn--sm"><Icon name="trash" size={12} />Move to trash</span></Ctx>
      ) : null}
      {anno === "off" ? <Toast icon="eye-off" action="Show">Annotations hidden. Press ⇧P to bring them back.</Toast> : null}
    </Window>
  );
}

/* ═══ Alligators pieces ════════════════════════════════════════════════════════════════════ */

/** Kanban column with Czech stickies (the Combine campaign plan). */
type Card = [string, Sw, StampId[]?];
function Column({ x, y, w, h, title, tone, cards, count }: { x: number; y: number; w: number; h: number; title: string; tone: Sw | "grey"; cards: Card[]; count: string }) {
  return (
    <Sec x={x} y={y} w={w} h={h} title={title} tone={tone} count={count}>
      <div className="an-col">
        {cards.map(([t, c, st], i) => (
          <St key={t} c={c} x={0} y={0} r={[-1.2, 0.8, -0.4, 1.4, -0.8][i % 5]} w={w - 40} style={{ position: "relative", left: "auto", top: "auto" }} after={st?.length ? <span className="an-st-stamps">{st.map((s, k) => <Stamp key={k} id={s} size={22} />)}</span> : undefined}>{t}</St>
        ))}
      </div>
    </Sec>
  );
}

/* Mosaic of tiny sticky blocks for the zoomed-out board (deterministic). */
function Mosaic({ n, tones, cols }: { n: number; tones: Sw[]; cols: number }) {
  return <span className="an-mos" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{Array.from({ length: n }, (_, i) => <i key={i} className={`an-mos-${tones[(i * 7 + (i >> 2)) % tones.length]}`} />)}</span>;
}

/** The three jersey directions on Uniformy-2027 (an-stamps, an-vote). `win` rings the winner. */
function JerseyBoards({ win }: { win?: number }) {
  return (
    <>
      {([["Směr A: Tichá zeleň", 140], ["Směr B: Ramena", 540], ["Směr C: Pruh", 940]] as [string, number][]).map(([l, x], i) => (
        <Artboard key={l} label={l} kind="digital" x={x} y={190} w={360} h={203} selected={win === i}><GatorMock variant="jersey" headline={l.split(": ")[1]} /></Artboard>
      ))}
    </>
  );
}

/* ═══ The canvas ════════════════════════════════════════════════════════════════════════════ */
export default function Annotations() {
  /* Homepage element boxes in window-body px */
  const cta = R(DK, HOME.cta);
  const cta2 = R(DK, HOME.cta2);
  const h1 = R(DK, HOME.h1);
  const art = R(DK, HOME.art);
  const svc1 = R(DK, HOME.svc1);
  const book = R(DK, HOME.book);
  const mcta = R(MB, MOB.cta);

  /* AI scenes: Desktop larger, no Mobile */
  const AP: AB = { x: 120, y: 110, s: 0.55 }; // Preview (AI reads)
  const AE: AB = { x: 290, y: 110, s: 0.55 }; // Edit (AI applies)
  const aArt = R(AP, HOME.art);
  const pArt = R(AP, HOME.artBig); // AI-stickers scene: the hero after the change, in Preview
  const eArt = R(AE, HOME.artBig);

  /* Pricing (AI writes) */
  const PR: AB = { x: 150, y: 170, s: 0.5 };
  const pToggle = R(PR, PRI.toggle);
  const pTeam = R(PR, PRI.teamPrice);
  const pB = R(PR, PRI.b);
  const pDays = R(PR, PRI.days);

  /* Signature — the artboard moves, the arrow follows (local px inside .an-fl-stage) */
  /* Mobile sits squarely between Tereza's sticky and where Desktop ends up: the straight line would cross it. */
  const FS = 0.27;
  const P0: AB = { x: 40, y: 590, s: FS }; // 0 ms — you grab Desktop
  const P1: AB = { x: 440, y: 580, s: FS }; // 120 ms — under Mobile
  const P2: AB = { x: 680, y: 290, s: FS }; // let go — on Mobile's far side
  const MOBF: AB = { x: 410, y: 210, s: 0.4 };
  const fCta = (p: AB) => R(p, HOME.cta);
  const c0 = fCta(P0);
  const c1 = fCta(P1);
  const c2 = fCta(P2);
  const c2y = c2[1] + c2[3] / 2;
  const h2 = R(P2, HOME.h1);

  /* AI rewrites the bound button (an-rebind) — local px inside the cell demo */
  const RB: AB = { x: 140, y: 24, s: 0.33 };
  const rbBig = R(RB, HOME.ctaBig);
  const rbOld = R(RB, HOME.cta);

  /* Alligators boards */
  const PO: AB = { x: 180, y: 140, s: 0.32 };
  const A4B: AB = { x: 580, y: 140, s: 0.46 };
  const SYB: AB = { x: 910, y: 140, s: 0.2 };
  const poDate = R(PO, POST.date);
  const poHead = R(PO, POST.head);
  const a4Date = R(A4B, A4.date);
  const a4Qr = R(A4B, A4.qr);
  const syCta = R(SYB, STORY.cta);

  return (
    <DesignCanvas>
      {/* ── 1 · Entering annotate ────────────────────────────────────────────────────────────── */}
      <DCSection id="enter" title="Entering annotate — N in Edit, and the layer is yours" subtitle="Preview opens with Sticky in hand; the design stays live under the layer · stickies on and between artboards · a sticky up close">
        <DCArtboard id="an-enter" label="1 · N in Edit — Preview opens with Sticky in hand" width={W} height={1000} fixed>
          <Close
            title="Press N in Edit. Preview opens with Sticky in hand."
            lede="Annotation keys work from Edit: N Sticky · C Comment · M Marker · A Arrow · E Stickers · S Section. The mode switch moves to Preview, the toolbar trades its tools for annotation tools, and the stickies already on the canvas come up to full strength. Nothing else moves."
            note={<Note n={1} title="Quiet on purpose.">No banner, no toast: the toolbar, the switch and the stickies brightening are the whole signal (220 ms, --ease-out; the morph up close is 04 · 7). The design underneath keeps working — a click on See the work still follows its link; a drag pans. esc puts Sticky down for Hand; esc again goes back to Edit.</Note>}
          >
            <div className="an-en">
              <div className="an-en-f">
                <p className="an-fr-t"><span className="an-fr-n">1</span><strong>Edit</strong>the stickies sit quiet; you press <Kbd>N</Kbd></p>
                <Mini s={0.445}><ReviewScene mode="edit" anno="quiet" /></Mini>
              </div>
              <div className="an-en-key"><span className="an-en-cap">N</span><span className="an-en-ar"><Icon name="submenu" size={20} /></span><span className="an-en-ms">220 ms</span></div>
              <div className="an-en-f">
                <p className="an-fr-t"><span className="an-fr-n">2</span><strong>Preview · Sticky</strong>colours open above it; the next click places a sticky</p>
                <Mini s={0.445}>
                  <Window tabs={TABS2} activeTab={0}>
                    <Canvas>
                      <HomeBoards />
                      <ReviewStickies />
                      <St c="yellow" x={1180} y={420} r={-1} w={130} ghost>&nbsp;</St>
                      <Cursor x={1176} y={414} tag={false} />
                    </Canvas>
                    <PvChrome tool="sticky" sw="sticky" color="yellow" />
                  </Window>
                </Mini>
              </div>
            </div>
            <div className="an-en-rules">
              <div className="an-en-rule"><span className="an-en-tb"><Toolbar mode="annotate" tool="sticky" swatches="sticky" color="yellow" keys inline /></span></div>
              <div className="an-en-rule an-en-rule--txt">
                <p><strong>Same key, same tool, from anywhere.</strong> In Edit, Preview or Present, N is Sticky. In Present it first drops you back into Preview, where the layer lives.</p>
                <p><strong>The design stays live.</strong> Links, hovers, scrolling pages and video keep working under the layer; annotations never change an artboard.</p>
                <p><strong>Colours stay where you left them.</strong> The next sticky uses the colour you picked last — per person, so Tereza's stay sky while yours stay yellow.</p>
              </div>
            </div>
          </Close>
        </DCArtboard>

        <DCArtboard id="an-place" label="2 · Stickies on and between artboards" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Put it where the thought belongs." tag="Proposed: rides with its artboard">On an artboard (1) it moves with that artboard; between them (2) it stays put. Dropped on a sticky it stacks (3); typing grows it to five lines, then wider (4).</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards />
                <St c="yellow" x={556} y={232} r={-2} w={128} who="tereza" when="2 h ago">Photo feels small next to the headline</St>
                <St c="sky" x={824} y={250} r={1.5} w={136}>Mobile: button above the fold?</St>
                <St c="coral" x={212} y={560} r={-1.5} w={150}>Tiles: three words each</St>
                <St c="green" x={224} y={574} r={1} w={150}>Service names in bold</St>
                <St c="yellow" x={238} y={590} r={-0.5} w={150}>Tiles: one row of words is enough</St>
                <St c="yellow" x={1222} y={196} r={0} w={150} caret>Headline on one line? It wraps at 1440</St>
                <St c="lilac" x={1214} y={404} r={1} w={196}>Mobile hero crops the hill — show all of it, or pick another photo from the shoot</St>
                <Cursor x={1372} y={252} tag={false} />
                <Cursor name="Tereza" x={700} y={330} />
              </Canvas>
              <PvChrome tool="sticky" sw="sticky" color="yellow" />
              <span className="an-cl" style={{ left: 540, top: 220 }}>1</span>
              <span className="an-cl" style={{ left: 808, top: 238 }}>2</span>
              <span className="an-cl" style={{ left: 196, top: 548 }}>3</span>
              <span className="an-cl" style={{ left: 1206, top: 184 }}>4</span>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-sticky" label="3 · A sticky, up close" width={W} height={940} fixed>
          <Close
            title="A sticky, up close."
            lede="Square paper in ten colours, five up front, the words in Maude's rounded face. It looks placed by hand and behaves like an object: it grows with its words, tilts a little, stacks, and says who wrote it."
            note={<Note n={3} title="Paper, not a form.">No title, no fields, no due date — a sticky is words. Things that need a person (a question, a decision) are better as a comment (19), and things that need doing go on a plan (12).</Note>}
          >
            <div className="an-grid3">
              <Cell n={1} title="Grows with its words" cap="Square until the words need more: it grows to five lines, then wider, never a scrollbar. Text gets smaller only past 120 words.">
                <div className="an-demo">
                  <St c="yellow" x={0} y={30} w={96}>Yes</St>
                  <St c="yellow" x={110} y={30} w={128}>Headline on one line?</St>
                  <St c="yellow" x={252} y={30} w={170}>Mobile hero crops the hill — show all of it, or pick another photo from the shoot</St>
                  <span className="an-demo-l" style={{ left: 0, top: 6 }}>1 line</span>
                  <span className="an-demo-l" style={{ left: 110, top: 6 }}>3 lines</span>
                  <span className="an-demo-l" style={{ left: 252, top: 6 }}>5 lines, then wider</span>
                </div>
              </Cell>
              <Cell n={2} title="Tilts a little — the same on every screen" cap="Between −2° and +2°, set once from the sticky's id: never random per screen, and flat while you type in it.">
                <div className="an-demo">
                  {([-2, 1.2, -0.6, 1.8, -1.4] as number[]).map((r, i) => (
                    <St key={i} c={(["yellow", "coral", "green", "sky", "lilac"] as Sw[])[i]} x={i * 82} y={44} r={r} w={78} style={{ minHeight: 78 }}>{["Logo", "Datum", "Barva", "Font", "Foto"][i]}</St>
                  ))}
                  {["−2°", "+1.2°", "−0.6°", "+1.8°", "−1.4°"].map((t, i) => <span key={t} className="an-demo-l" style={{ left: i * 82, top: 6 }}>{t}</span>)}
                </div>
              </Cell>
              <Cell n={3} title="Stacks when dropped on another" cap="Dropped onto a sticky, it lands 12 px down and right, so the one under it still shows. Fan out (right-click) spreads a stack into a row.">
                <div className="an-demo">
                  <St c="coral" x={40} y={30} r={-1.5} w={128}>Tiles: three words each</St>
                  <St c="green" x={54} y={44} r={1} w={128}>Service names in bold</St>
                  <St c="yellow" x={68} y={58} r={-0.5} w={128} sel>One row of words is enough</St>
                  <Menu width={170} style={{ left: 226, top: 40 }} items={[{ label: "Fan out", highlight: true }, { label: "Bring to front" }, { label: "Send to back" }]} />
                </div>
              </Cell>
              <Cell n={4} title="Ten colours — five up front, +5 for the rest" cap="Yellow, coral, green, sky and lilac sit in the row; +5 opens white, grey, peach, aqua and pink. FigJam stickies keep their tint. AI writes on plain paper with a spark edge (23), not a colour of its own.">
                <div className="an-demo an-demo--sw">
                  <span className="island an-swrow"><Dots on="yellow" more={5} /></span>
                  <span className="island an-swrow an-swrow--all">
                    {[...PAPER_FRONT, ...PAPER_MORE].map((c) => (
                      <span key={c} className="an-swl"><i className={`an-dot an-dot--${c} an-dot--lg`} aria-current={c === "yellow" ? "true" : undefined} />{c[0].toUpperCase() + c.slice(1)}</span>
                    ))}
                  </span>
                </div>
              </Cell>
              <Cell n={5} title="Says who wrote it" cap="The author line shows on hover and when selected; their cursor colour edges the sticky while they're typing. Imported stickies say where they came from.">
                <div className="an-demo">
                  <St c="sky" x={0} y={30} r={1} w={150} who="jonas" when="2 h ago">Mobile: button above the fold?</St>
                  <St c="yellow" x={186} y={30} w={150} who="tereza" style={{ boxShadow: "0 0 0 2px var(--object-sky), 0 6px 12px oklch(0 0 0 / 0.12)" }} caret>Warmer sun, less</St>
                  <Cursor name="Tereza" x={300} y={112} />
                </div>
              </Cell>
              <Cell n={6} title="Selected: its own small toolbar" cap="Colour · text size (Small to Huge) · list · Lock (⇧⌘L) · Turn into a comment (proposed, 19) · more. ⌘D duplicates; ⌫ moves it to the trash, ⌘Z brings it back.">
                <div className="an-demo">
                  <Ctx x={0} y={0} style={{ position: "absolute" }}><Dots on="yellow" more={5} /><Div /><span className="select k-in-select an-ctx-sel">Medium<Icon name="chevron" size={10} /></span><span className="icon-btn k-icon-sm" title="List"><ListGlyph /></span><Div /><span className="icon-btn k-icon-sm" title="Lock"><Icon name="lock" size={14} /></span><span className="icon-btn k-icon-sm" title="Turn into a comment"><Icon name="comment" size={14} /></span><span className="icon-btn k-icon-sm"><Icon name="more" size={14} /></span></Ctx>
                  <St c="yellow" x={40} y={62} r={0} w={150} sel who="you" when="now">Headline on one line?</St>
                </div>
              </Cell>
            </div>
          </Close>
        </DCArtboard>

        <DCArtboard id="an-today" label="4 · Everything the annotation layer already does — kept" width={W} height={990} fixed>
          <Close
            title="Everything the annotation layer already does — kept."
            lede="Today's whiteboard loses nothing. Text and Shape sit in Preview's toolbar; pictures, links and clips arrive by paste or drop; the rest lives on the small toolbar above a selection, and ⌘K finds every one of them."
            note={<Note n={4} title="Nothing deleted, only hidden.">Each of these ships today. The rest of this canvas draws what's new; this board makes sure none of what's there goes missing.</Note>}
          >
            <div className="an-grid4">
              <Cell n={1} title={<>Text <Kbd>T</Kbd></>} cap="Words straight on the canvas, in five sizes up to Huge, or any size from 8 to 200. Bold, italic, left · centre · right.">
                <div className="an-demo an-demo--t">
                  <span className="an-tx an-tx--huge">Hej!</span>
                  <span className="an-tx an-tx--l">So 14. 3.</span>
                  <span className="an-tx an-tx--m">Kraví hora, Brno</span>
                  <span className="an-tx an-tx--s">Registrace do 10. 3.</span>
                  <Menu width={150} style={{ left: 150, top: 0 }} items={[{ label: "Small", keys: "12" }, { label: "Medium", keys: "16" }, { label: "Large", keys: "24" }, { label: "Extra large", keys: "36" }, { label: "Huge", keys: "64", highlight: true, checked: true }]} />
                </div>
              </Cell>
              <Cell n={2} title={<>Shape <Kbd>R</Kbd></>} cap="Rectangle, ellipse, diamond, triangle and triangle down. Fill and stroke are picked apart; double-click writes a label inside.">
                <div className="an-demo an-demo--t">
                  <svg className="an-shp" width="290" height="170" viewBox="0 0 290 170" aria-hidden="true">
                    <rect className="an-shp-f an-shp--sky" x="4" y="14" width="74" height="46" rx="6" />
                    <ellipse className="an-shp-f an-shp--green" cx="134" cy="37" rx="40" ry="23" />
                    <path className="an-shp-f an-shp--yellow" d="M232 8 L262 37 L232 66 L202 37 Z" />
                    <path className="an-shp-f an-shp--coral an-shp--dash" d="M40 92 L72 146 L8 146 Z" />
                    <path className="an-shp-f an-shp--lilac" d="M100 94 L164 94 L132 148 Z" />
                    <text className="an-shp-t" x="41" y="41" textAnchor="middle">Start</text>
                    <text className="an-shp-t" x="232" y="41" textAnchor="middle">Ano?</text>
                  </svg>
                  <span className="island an-mini-ctx" style={{ left: 176, top: 104 }}><span className="an-mini-l">Fill</span><i className="an-dot an-dot--coral" /><span className="an-mini-l">Stroke</span><i className="an-ik an-ik--red" /><span className="an-mini-l an-mini-dash">Dashed</span></span>
                </div>
              </Cell>
              <Cell n={3} title="Pictures and links — paste or drop" cap="A photo lands on the layer as a picture; a pasted address becomes a card with its site and title. Neither is part of the design.">
                <div className="an-demo an-demo--t">
                  <span className="an-pic"><span className="an-sh-sun" /><span className="an-sh-hill" /><em>trenink-03.jpg</em></span>
                  <span className="an-lcard"><span className="an-lcard-ic"><Icon name="link" size={16} /></span><span><em>alligators.cz</em><strong>Combine 2026 — registrace</strong></span></span>
                </div>
              </Cell>
              <Cell n={4} title="Video and sound — drop a file" cap="A clip or a song dropped on the empty canvas lands on the layer as a chip with its name and length — a pointer to the file, never part of the design.">
                <div className="an-demo an-demo--t an-demo--col">
                  <span className="an-chipm"><span className="an-chipm-ic"><Icon name="video" size={16} /></span><span><strong>touchdown.mov</strong><em>0:12</em></span><Icon name="play" size={14} /></span>
                  <span className="an-chipm"><span className="an-chipm-ic"><AudioGlyph size={16} /></span><span><strong>hymna-2026.mp3</strong><em>1:40</em></span><Icon name="play" size={14} /></span>
                </div>
              </Cell>
              <Cell n={5} title={<>Group <Kbd>⌘G</Kbd>, align, distribute</>} cap="With two or more selected, the small toolbar groups them (⇧⌘G ungroups), lines them up by any edge or centre, and spaces them evenly.">
                <div className="an-demo an-demo--t">
                  <span className="island an-mini-ctx" style={{ left: 0, top: 0 }}><span className="an-mini-b"><GroupGlyph />Group</span><span className="divider-v an-div" /><span className="an-mini-i"><Icon name="align-left" size={14} /></span><span className="an-mini-i"><AlignTopGlyph /></span><span className="an-mini-i"><DistGlyph /></span><span className="an-mini-i"><Icon name="more" size={14} /></span></span>
                  <span className="an-grp" style={{ left: 6, top: 62, width: 278, height: 108 }} />
                  {(["yellow", "sky", "green"] as Sw[]).map((c, i) => <St key={c} c={c} x={18 + i * 90} y={74} w={78} style={{ minHeight: 84 }}>{["Logo", "Datum", "QR"][i]}</St>)}
                </div>
              </Cell>
              <Cell n={6} title="Dashed lines and lists" cap="Any stroke, shape or arrow can be dashed. Stickies and text take bullet or numbered lists from the small toolbar.">
                <div className="an-demo an-demo--t">
                  <Ink w={300} h={190}><Arr d="M10 30 C 80 30, 100 80, 150 80" tip={[154, 80]} tail={[110, 80]} cls="an-arr--dash" /></Ink>
                  <St c="yellow" x={150} y={2} w={136} style={{ minHeight: 0 }}><span className="an-li">• Logo výš<br />• Datum tučně<br />• QR na zadní</span></St>
                  <St c="sky" x={10} y={100} w={136} style={{ minHeight: 0 }}><span className="an-li">1. Tisk do pátku<br />2. Web v neděli</span></St>
                </div>
              </Cell>
              <Cell n={7} title="Every colour, kept" cap="Sticky 10 papers, marker 9 inks with black first, highlighter 4 colours in 3 widths. Five sit up front; the rest is one click away.">
                <div className="an-demo an-demo--t an-pal">
                  <span className="an-pal-r"><em>Sticky</em>{[...PAPER_FRONT, ...PAPER_MORE].map((c) => <i key={c} className={`an-dot an-dot--${c}`} />)}</span>
                  <span className="an-pal-r"><em>Marker</em>{[...INK_FRONT, ...INK_MORE].map((c) => <i key={c} className={`an-ik an-ik--${c} an-ik--sm`} aria-current={c === "ink" ? "true" : undefined} />)}</span>
                  <span className="an-pal-r"><em>Highlighter</em>{HL.map((c) => <i key={c} className={`an-hlsw an-hlsw--${c}`} />)}<span className="an-thick an-thick--hl"><i /><i className="an-thick-on" /><i /></span></span>
                </div>
              </Cell>
              <Cell n={8} title="Where each one lives" cap="Nothing needs a menu hunt: the toolbar, a paste, the small toolbar over a selection — and ⌘K finds all of it by name.">
                <div className="an-demo an-demo--t an-where">
                  {([["R · T", "Shape and Text — Preview's toolbar"], ["⌘V", "Pictures, links, clips — paste or drop"], ["⌘G", "Group · ⇧⌘G ungroup"], ["Above it", "Align, distribute, dashed, lists, sizes, colours"], ["⌘K", "Finds every one by name"]] as [string, string][]).map(([k, d]) => (
                    <span key={k} className="an-where-r"><b>{k}</b><span>{d}</span></span>
                  ))}
                </div>
              </Cell>
            </div>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Arrows that stick ────────────────────────────────────────────────────────────── */}
      <DCSection id="arrows" title="Arrows that stick" subtitle="Proposed: an arrow bound to the exact button inside an artboard, following it when the artboard moves and when AI rewrites it · shipped: elbow vs curved, heads, labels">
        <DCArtboard id="an-arrow-bind" label="5 · An arrow to the button, not the artboard" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Aim at the thing you mean." tag="Proposed">The end snaps to the element under it — the button, not the artboard — and names it; over an artboard's edge, the whole artboard lights up. Today an end binds to board items only.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards />
                <Cand b={h1} /><Cand b={cta2} /><Cand b={art} /><Cand b={svc1} />
                <Snap b={cta} label={<><b>Button</b> · See the work</>} at="below" />
                <St c="yellow" x={40} y={592} r={-1.5} w={150} who="tereza">Make See the work bigger — it's the point of the page</St>
                <St c="sky" x={824} y={250} r={1.5} w={136}>Mobile: button above the fold?</St>
                <St c="coral" x={1226} y={616} r={1.5} w={150}>Mobile needs a footer with the address</St>
                <span className="an-edge" style={{ left: MB.x - 3, top: MB.y - 3, width: 390 * MB.s + 6, height: 844 * MB.s + 6 }} />
                <Ink>
                  <Arr d={`M118 592 C 118 470, ${cta[0] + cta[2] / 2} 450, ${cta[0] + cta[2] / 2} ${cta[1] + cta[3] + 6}`} tip={[cta[0] + cta[2] / 2, cta[1] + cta[3] + 6]} tail={[cta[0] + cta[2] / 2, 450]} cls="an-arr--draw" />
                  <Arr pts={[[960, 292], [978, 292], [978, mcta[1] + mcta[3] / 2], [mcta[0] - 4, mcta[1] + mcta[3] / 2]]} />
                  <Arr pts={[[1226, 650], [MB.x + 390 * MB.s / 2, 650], [MB.x + 390 * MB.s / 2, MB.y + 844 * MB.s + 6]]} />
                </Ink>
                <Cursor x={cta[0] + cta[2] / 2 - 3} y={cta[1] + cta[3] + 2} tag={false} />
              </Canvas>
              <PvChrome tool="arrow" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-follow" label="6 · Move the artboard — the arrow goes around Mobile, never through" width={W} height={1120} fixed>
          <V2 className="an-close an-fl">
            <p className="an-close-h">Move the artboard. The arrow follows it — around Mobile, never through. <Prop /></p>
            <p className="an-close-lede">You drag Desktop past Mobile. Tereza's arrow stays bound to See the work: straight down at the start, under Mobile mid-drag, over it once Desktop is on the far side. Her marker loop and the sun sticky ride on the artboard; the note on the empty canvas stays put.</p>
            <div className="an-fl-row">
              <div className="an-fl-stage">
                <span className="an-loose" style={{ left: 40, top: 40 }}>Homepage review · 6 Oct — stays where it is</span>
                {/* the obstacle */}
                <Artboard label="Mobile" kind="web" x={MOBF.x} y={MOBF.y} w={390 * MOBF.s} h={844 * MOBF.s}><Sc s={MOBF.s} w={390} h={844}><AnMobile /></Sc></Artboard>
                {/* where Desktop was — outlines only, each with the route it had then */}
                {([[P0, c0, "0 ms · you grab Desktop"], [P1, c1, "120 ms · the route follows live"]] as [AB, Box, string][]).map(([p, c, t]) => (
                  <Fragment key={t}>
                    <span className="an-was" style={{ left: p.x, top: p.y, width: 1440 * p.s, height: 900 * p.s }}><span className="an-was-t">{t}</span></span>
                    <span className="an-was-cta" style={{ left: c[0], top: c[1], width: c[2], height: c[3] }} />
                  </Fragment>
                ))}
                <Ink w={1100} h={830} className="an-ink--was">
                  <Arr pts={[[100, 438], [100, c0[1] - 5]]} />
                  <Arr pts={[[150, 438], [150, 566], [c1[0] + c1[2] / 2, 566], [c1[0] + c1[2] / 2, c1[1] - 5]]} />
                  <path className="an-straight" d={`M190 340 L ${c2[0] - 5} ${c2y}`} />
                </Ink>
                {/* where it is now */}
                <Artboard label="Desktop" kind="web" x={P2.x} y={P2.y} w={1440 * P2.s} h={900 * P2.s} selected size="1440 × 900"><Sc s={P2.s} w={1440} h={900}><AnHome /></Sc></Artboard>
                <St c="coral" x={P2.x + 296} y={P2.y + 14} r={2} w={92}>Warmer sun?</St>
                <Snap b={c2} pad={2} label={<><b>Button</b> · See the work</>} at="below" />
                <Ink w={1100} h={830}>
                  <path className="an-mk" d={loop(h2[0] + h2[2] * 0.5, h2[1] + h2[3] * 0.32, h2[2] * 0.56, h2[3] * 0.6, 2)} />
                  <Arr pts={[[190, 340], [300, 340], [300, 160], [630, 160], [630, c2y], [c2[0] - 5, c2y]]} cls="an-arr--hot" start />
                </Ink>
                <span className="an-route-tag" style={{ left: 322, top: 128 }}>Let go — the shortest clean path, over Mobile · 160 ms</span>
                <span className="an-cross" style={{ left: 432, top: 392 }}><Icon name="close" size={10} />the straight line would cross Mobile</span>
                <St c="yellow" x={40} y={300} r={-1.5} w={150} who="tereza">Make See the work bigger — it's the point of the page</St>
                <Cursor x={P2.x + 150} y={P2.y - 16} tag={false} />
              </div>
              <div className="an-fl-rules">
                {([
                  ["link", "Bound ends follow.", "An arrow that ends on an element or an artboard keeps pointing at it, wherever it goes."],
                  ["arrow", "Around, never through.", "Elbow arrows route around other artboards live while you drag, and settle on the shortest clean path when you let go."],
                  ["marker", "Drawn on it, moves with it.", "Stickies, stickers, marker and text over an artboard belong to it. Things on the empty canvas stay where they are."],
                  ["section", "Sections carry their members.", "Move a section and everything inside goes too — this one is shipped today."],
                  ["lock", "Locked still follows.", "A locked sticky can't be dragged by itself, but it rides along with its artboard."],
                ] as [string, string, string][]).map(([ic, t, d]) => (
                  <p key={t} className="an-rule"><span className="an-rule-ic"><Icon name={ic} size={16} /></span><span><strong>{t}</strong> {d}</span></p>
                ))}
                <p className="an-rule-tok"><span className="chip">live while dragging</span><span className="chip">settles on --dur-soft · 160 ms</span><span className="an-rule-rm">Reduce motion: the route jumps, nothing eases.</span></p>
              </div>
            </div>
            <div className="an-close-note"><Note n={6} title="The arrow is a promise." tag="Proposed">An arrow from feedback to a button has to keep meaning that button. Ends are stored as links to things, never as points, so moving the design can't break what a note was about (7).</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="an-rebind" label="7 · AI rewrites the button the arrow points at" width={W} height={800} fixed>
          <Close
            title={<>AI rewrites the button. The arrow still knows what it meant. <Prop /></>}
            lede="Tereza's sticky asks for a bigger See the work, and her arrow points at it. When AI changes that button, the arrow stays bound to the new version. When AI replaces it with something else, the arrow keeps its end and says what it pointed at."
            note={<Note n={7} title="One link, two honest outcomes." tag="Proposed">Needs every element inside an artboard to keep its id through AI's rewrites. A changed element keeps the arrow; a replaced one hands it back to you.</Note>}
          >
            <div className="an-grid2">
              <Cell n={1} title="The same button, rewritten — the arrow moves with it" cap="AI made it bigger and changed its words. It's still the page's main button, so the link holds: the end slides to the new edge and the ring names it with its new words.">
                <div className="an-demo an-demo--rb">
                  <Artboard label="Desktop" kind="web" x={RB.x} y={RB.y} w={1440 * RB.s} h={900 * RB.s} aiMade><Sc s={RB.s} w={1440} h={900}><AnHome cta="ours" /></Sc></Artboard>
                  <Snap b={rbBig} pad={2} label={<><b>Button</b> · See our work · rewritten by AI</>} at="below" />
                  <St c="yellow" x={0} y={250} r={-1.5} w={112} who="tereza">Make See the work bigger</St>
                  <Ink w={640} h={390}><Arr d={`M112 286 C 150 286, ${rbBig[0] + rbBig[2] / 2} 300, ${rbBig[0] + rbBig[2] / 2} ${rbBig[1] + rbBig[3] + 5}`} tip={[rbBig[0] + rbBig[2] / 2, rbBig[1] + rbBig[3] + 5]} tail={[rbBig[0] + rbBig[2] / 2, 300]} cls="an-arr--hot" /></Ink>
                </div>
              </Cell>
              <Cell n={2} title="A different thing in its place — the arrow says so" cap="AI swapped the buttons for a sign-up field. That's a new element, so the arrow keeps its end where the button was, dashed. Point to… re-aims it in one click; ⌘Z brings the button back and re-attaches it.">
                <div className="an-demo an-demo--rb">
                  <Artboard label="Desktop" kind="web" x={RB.x} y={RB.y} w={1440 * RB.s} h={900 * RB.s} aiMade><Sc s={RB.s} w={1440} h={900}><AnHome cta="form" /></Sc></Artboard>
                  <span className="an-gone" style={{ left: rbOld[0], top: rbOld[1], width: rbOld[2], height: rbOld[3] }} />
                  <St c="yellow" x={0} y={250} r={-1.5} w={112} who="tereza">Make See the work bigger</St>
                  <Ink w={640} h={390}>
                    <Arr d={`M112 286 C 150 286, ${rbOld[0] + rbOld[2] / 2} 300, ${rbOld[0] + rbOld[2] / 2} ${rbOld[1] + rbOld[3] + 5}`} tip={[0, 0]} tail={[0, 0]} cls="an-arr--dangle an-arr--sel" nohead />
                    <circle className="an-open" cx={rbOld[0] + rbOld[2] / 2} cy={rbOld[1] + rbOld[3] + 5} r={5} />
                  </Ink>
                  <div className="an-dg" style={{ left: 300, top: 238 }}>
                    <p><Icon name="link" size={13} />Pointed at the old <strong>“See the work”</strong> — replaced by AI</p>
                    <span className="btn btn--sm btn--primary">Point to…</span>
                  </div>
                </div>
              </Cell>
            </div>
          </Close>
        </DCArtboard>

        <DCArtboard id="an-arrow-kinds" label="8 · Edges, elbows, curves and labels" width={W} height={1000} fixed>
          <Close
            title="Edges, elbows, curves and labels."
            lede="Every arrow can change its line and its ends from the small toolbar above it. Each kind keeps its binding — only the drawing changes."
            note={<Note n={8} title="Defaults that read well.">A new arrow is curved with a filled head; Elbow is one click for diagrams; labels move with the line. Lines, heads and labels exist today; binding to an artboard's edge (1) is proposed.</Note>}
          >
            <div className="an-grid2">
              <Cell n={1} title={<>To an artboard's edge <Prop /></>} cap="Over an artboard's edge the whole artboard lights up; the end sticks to the nearest side and slides along it as things move.">
                <div className="an-demo an-demo--k">
                  <Artboard label="Mobile" kind="web" x={300} y={18} w={101} h={219}><Sc s={0.26} w={390} h={844}><AnMobile /></Sc></Artboard>
                  <span className="an-edge" style={{ left: 297, top: 15, width: 107, height: 225 }} />
                  <St c="coral" x={20} y={70} r={-1} w={140}>Mobile needs a footer</St>
                  <Ink w={560} h={240}><Arr d="M160 112 C 220 112, 240 128, 292 128" tip={[296, 128]} tail={[240, 128]} /><circle className="an-edgept" cx={300} cy={128} r={5} /></Ink>
                  <span className="an-demo-l" style={{ left: 420, top: 120 }}>slides along the edge</span>
                </div>
              </Cell>
              <Cell n={2} title="Straight · Curved · Elbow" cap="The same two ends, three lines. Elbow routes around artboards; Curved bends gently past them; Straight is a straight line.">
                <div className="an-demo an-demo--k">
                  <Ctx x={130} y={0} style={{ position: "absolute" }}><span className="seg k-seg"><span className="k-seg-b">Straight</span><span className="k-seg-b">Curved</span><span className="k-seg-b" aria-pressed="true">Elbow</span></span><Div /><span className="an-hd"><Icon name="arrow" size={14} /><Icon name="chevron" size={10} /></span><Div /><Dots on="ink" list={["ink", "coral", "green", "sky"]} more={5} /><Div /><span className="icon-btn k-icon-sm"><Icon name="lock" size={14} /></span></Ctx>
                  {[0, 1, 2].map((i) => (
                    <Fragment key={i}>
                      <span className="an-knode" style={{ left: 30 + i * 180, top: 70 }} />
                      <span className="an-knode an-knode--b" style={{ left: 120 + i * 180, top: 170 }} />
                    </Fragment>
                  ))}
                  <Ink w={560} h={220}>
                    <Arr d="M82 112 L 140 166" tip={[140, 166]} tail={[82, 112]} />
                    <Arr d="M272 90 C 316 90, 330 120, 330 164" tip={[330, 166]} tail={[330, 120]} />
                    <Arr pts={[[452, 90], [466, 90], [466, 190], [476, 190]]} cls="an-arr--sel" start />
                  </Ink>
                  {["Straight", "Curved", "Elbow"].map((t, i) => <span key={t} className="an-demo-l" style={{ left: 30 + i * 180, top: 204 }}>{t}</span>)}
                </div>
              </Cell>
              <Cell n={3} title="A label on the line" cap="Double-click an arrow to write on it. The label sits on the line, follows it when it re-routes, and AI reads it as part of the arrow.">
                <div className="an-demo an-demo--k">
                  <span className="an-node" style={{ left: 20, top: 80 }}>Story 9:16</span>
                  <span className="an-node" style={{ left: 250, top: 80 }}>Web · ZAPIŠ SE</span>
                  <span className="an-node an-node--d" style={{ left: 440, top: 150 }}>Registrace</span>
                  <Ink w={560} h={220}>
                    <Arr d="M106 98 L 246 98" tip={[246, 98]} tail={[106, 98]} />
                    <Arr pts={[[372, 112], [372, 168], [436, 168]]} />
                  </Ink>
                  <span className="an-alabel" style={{ left: 154, top: 88 }}>swipe up</span>
                  <span className="an-alabel an-alabel--edit" style={{ left: 344, top: 158 }}>then here<i className="k-caretline an-caret" /></span>
                </div>
              </Cell>
              <Cell n={4} title="Ends and heads" cap="None · Line · Triangle · Triangle (outline) · Circle · Diamond, on either end. Two heads make a two-way arrow.">
                <div className="an-demo an-demo--k an-heads">
                  {([["None", "none"], ["Line", "line"], ["Triangle", "tri"], ["Triangle (outline)", "tro"], ["Circle", "cir"], ["Diamond", "dia"]] as [string, string][]).map(([t, k], i) => (
                    <span key={k} className="an-headrow" style={{ top: 10 + i * 32 }}>
                      <svg width="120" height="20" viewBox="0 0 120 20" aria-hidden="true" className="an-ink an-ink--static">
                        <path className="an-arr-l" d="M6 10 H 100" />
                        {k === "line" ? <path className="an-arr-l" d="M92 4 L 102 10 L 92 16" /> : null}
                        {k === "tri" ? <path className="an-arr-h" d="M104 10 L 92 4 L 92 16 Z" /> : null}
                        {k === "tro" ? <path className="an-arr-l an-arr-o" d="M104 10 L 92 4 L 92 16 Z" /> : null}
                        {k === "cir" ? <circle className="an-arr-h" cx={100} cy={10} r={5} /> : null}
                        {k === "dia" ? <path className="an-arr-h" d="M108 10 L 101 4 L 94 10 L 101 16 Z" /> : null}
                      </svg>
                      <span>{t}</span>
                    </span>
                  ))}
                  <span className="an-headrow an-headrow--two" style={{ top: 10, left: 290 }}>
                    <svg width="160" height="20" viewBox="0 0 160 20" aria-hidden="true" className="an-ink an-ink--static"><path className="an-arr-l" d="M14 10 H 146" /><path className="an-arr-h" d="M152 10 L 140 4 L 140 16 Z" /><path className="an-arr-h" d="M8 10 L 20 4 L 20 16 Z" /></svg>
                    <span>Two-way</span>
                  </span>
                </div>
              </Cell>
            </div>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Marker + highlighter ────────────────────────────────────────────────────────── */}
      <DCSection id="marker" title="Marker and highlighter" subtitle="Circle the problem, highlight the words, erase with the third tip · strokes belong to the artboard they're drawn over">
        <DCArtboard id="an-marker" label="9 · Circle it, highlight it, rub it out" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="One tool, three tips." tag="Proposed: strokes ride with the artboard">Marker, Highlighter and Eraser. Nine inks, black first; +4 opens the rest. Eraser rubs out strokes only, never stickies. Hover shows the artboard a stroke belongs to.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <PostBoard ab={PO} />
                <PrintBoard ab={A4B} />
                <StoryBoard ab={SYB} />
                <span className="an-belong" style={{ left: PO.x - 4, top: PO.y - 4, width: 1080 * PO.s + 8, height: 1080 * PO.s + 8 }}><span className="an-belong-t">On Post 1:1 · moves with it</span></span>
                <Ink>
                  <path className="an-hl" d={`M${a4Date[0] - 4} ${a4Date[1] + a4Date[3] / 2 + 1} L ${a4Date[0] + a4Date[2] * 0.82} ${a4Date[1] + a4Date[3] / 2 - 1}`} />
                  <path className="an-mk an-mk--hover" d={loop(poDate[0] + poDate[2] * 0.52, poDate[1] + poDate[3] / 2, poDate[2] * 0.58, 20, 0.4)} />
                  <path className="an-mk an-mk--sky" d={`M${syCta[0]} ${syCta[1] + syCta[3] + 8} q 12 -7 24 0 t 24 0 t 24 0 t 24 0`} />
                  <path className="an-mk an-mk--green" d={`M${a4Qr[0] - 44} ${a4Qr[1] + 22} c 10 -16 26 -18 34 -6`} />
                  <path className="an-mk an-mk--green" d={`M${a4Qr[0] + 30} ${a4Qr[1] + 22} c 8 -4 14 -10 18 -18`} />
                </Ink>
                <St c="coral" x={190} y={520} r={-1.5} w={160} who="jonas">Datum víc vidět — z tribuny ho nepřečteš</St>
                <St c="green" x={596} y={566} r={1} w={150}>Termín registrace zvýraznit</St>
                <St c="sky" x={1150} y={430} r={1.5} w={140}>Odkaz podtrhnout, ať je klikací</St>
                <Cursor name="Jonas" x={poDate[0] + poDate[2] * 0.7} y={poDate[1] - 30} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" people={["tereza", "jonas"]} zoom={36} tool="marker" ink="green" />
              <div className="island an-mkpop">
                <span className="seg k-seg"><span className="k-seg-b" aria-pressed="true">Marker</span><span className="k-seg-b">Highlighter</span><span className="k-seg-b"><Icon name="eraser" size={13} />Eraser</span></span>
                <Div />
                {INK_FRONT.map((c) => <i key={c} className={`an-ik an-ik--${c}`} title={c === "ink" ? "Ink — the default" : c} aria-current={c === "green" ? "true" : undefined} />)}
                <span className="an-more" title="All inks">+{INK_MORE.length}</span>
                <Div />
                <span className="an-thick an-thick--2"><i /><i className="an-thick-on" /></span>
              </div>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Sections + templates ────────────────────────────────────────────────────────── */}
      <DCSection id="sections" title="Sections and templates" subtitle="Wrap stickies into a section, colour it, fold it · start from a template (Section tool or ⌘K) · the Combine 2026 campaign plan, made in a minute">
        <DCArtboard id="an-section" label="10 · Tereza's feedback, wrapped in a section" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="A section is a named place." tag="Proposed: Fold">Wrap in section, or press S and draw one. Name it and colour it; its members move with it, and AI can be asked about just this section. Folding it to one line is new.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Sec x={130} y={120} w={520} h={330} title="Zpětná vazba Tereza" tone="lilac" sel caret>
                  <St c="yellow" x={26} y={40} r={-1.5} w={140} style={{ position: "absolute" }}>Logo na postu o kousek výš</St>
                  <St c="yellow" x={192} y={36} r={1} w={140}>Na story méně textu</St>
                  <St c="yellow" x={358} y={44} r={-0.6} w={136} lock>Datum tučně — 14. 3.</St>
                  <St c="yellow" x={30} y={180} r={0.8} w={160}>Zelená je na tisk moc tmavá?</St>
                  <St c="yellow" x={214} y={186} r={-1.2} w={150}>Hráč na postu — jiná fotka z tréninku</St>
                </Sec>
                <Ctx x={244} y={64}><Dots on="lilac" list={["grey", "yellow", "coral", "green", "sky", "lilac"]} /><Div /><span className="btn btn--ghost btn--sm"><Icon name="chevron" size={12} />Fold</span><span className="btn btn--ghost btn--sm"><Spark size={11} />Ask AI about it</span><span className="icon-btn k-icon-sm"><Icon name="lock" size={14} /></span><span className="icon-btn k-icon-sm"><Icon name="more" size={14} /></span></Ctx>
                <Sec x={130} y={500} w={360} title="Nápady na story" tone="sky" min count="6 stickies · 2 people" />
                <Sec x={130} y={566} w={360} title="Tisk — korektury" tone="coral" min count="3 stickies" />
                <PostBoard ab={{ x: 760, y: 130, s: 0.3 }} />
                <StoryBoard ab={{ x: 1110, y: 130, s: 0.17 }} />
                <Ink><Arr d="M410 158 C 560 110, 700 150, 756 190" tip={[756, 190]} tail={[700, 150]} /></Ink>
                <Cursor name="Tereza" x={590} y={420} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={42} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-templates" label="11 · Start from a template" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Templates are sections, filled in.">With Section (S), templates open above the toolbar; ⌘K finds them too. The pick follows the pointer until you click — or describe it, and AI builds it with your items.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <PostBoard ab={{ x: 1060, y: 120, s: 0.24 }} />
                <PrintBoard ab={{ x: 1060, y: 410, s: 0.3 }} label="Leták A6 · přední" />
                <div className="an-ghostboard" style={{ left: 170, top: 110 }}>
                  {["To do", "Doing", "Done"].map((t, i) => <span key={t} className="an-gb-col" style={{ left: i * 236 }}><b>{t}</b><i /><i /></span>)}
                </div>
                <Cursor x={410} y={170} tag={false} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={42} tool="section" />
              <div className="island an-tpl">
                <p className="an-tpl-h"><span>Templates</span><span className="an-tpl-k">or drag on the canvas for a blank one</span></p>
                <div className="an-tpl-g">
                  {([["Kanban", "kanban", "To do · Doing · Done"], ["Retro", "retro", "Went well · To improve · Actions"], ["Flowchart", "flow", "Steps and decisions"], ["Content calendar", "cal", "One column a day"], ["Roadmap", "road", "One column a month"], ["Brainstorm", "brain", "A topic and ideas round it"], ["Checklist", "check", "One section, ticks"], ["Blank section", "blank", "Draw it, name it"]] as [string, string, string][]).map(([t, k, d]) => (
                    <span key={k} className="an-tpl-c" data-on={k === "kanban" ? "true" : undefined}>
                      <span className={`an-tpl-th an-tpl-th--${k}`}><i /><i /><i /><i /><i /><i /></span>
                      <strong>{t}</strong><em>{d}</em>
                    </span>
                  ))}
                </div>
                <div className="ask an-tpl-ask"><span className="k-ask-in">Kanban pro Combine 2026 — co chystáme na Instagram, do tisku a na web<i className="k-caretline" /></span><span className="send"><Spark size={12} color="var(--spark-fg)" /></span></div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-plan" label="12 · The Combine 2026 plan, next to the work" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="The plan sits next to the work.">A kanban from the template, in the prompt's language, colour-coded by channel; stamps are the quick votes (16). Done cards point at the artboards they became.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Column x={96} y={104} w={260} h={560} title="Nápady" tone="grey" count="4" cards={[["Reel: 40 yd sprint ve zpomaleném záběru", "lilac", ["yes", "yes", "star"]], ["Story: odpočet 7 dní do Combine", "sky"], ["Plakát do škol v Brně a Blansku", "coral", ["ask"]], ["Rozhovor s trenérem O-line", "lilac"]]} />
                <Column x={380} y={104} w={260} h={560} title="Rozpracované" tone="yellow" count="3" cards={[["Leták A6 — registrace s QR kódem", "coral"], ["Web: stránka STAŇ SE GATOREM", "green"], ["Post 1:1 — datum tučně", "sky", ["yes"]]]} />
                <Column x={664} y={104} w={260} h={560} title="Hotovo" tone="green" count="2" cards={[["Pozvánka pro partnery", "green"], ["Combine v číslech 2025", "sky", ["heart"]]]} />
                <div className="an-legend" style={{ left: 96, top: 688 }}>
                  <span><i className="an-dot an-dot--sky" />Instagram</span><span><i className="an-dot an-dot--coral" />Tisk</span><span><i className="an-dot an-dot--green" />Web</span><span><i className="an-dot an-dot--lilac" />Video</span>
                </div>
                <Artboard label="Combine-invite · partneři" kind="digital" x={1010} y={120} w={250} h={250}><GatorMock variant="invite" headline="Pozvánka pro partnery" /></Artboard>
                <Artboard label="Combine-cisla · 2025" kind="digital" x={1010} y={420} w={250} h={250}><GatorMock variant="numbers" headline="Combine v číslech 2025" /></Artboard>
                <Ink>
                  <Arr d="M902 172 C 950 172, 960 200, 1004 200" tip={[1006, 200]} tail={[960, 200]} />
                  <Arr d="M902 262 C 960 262, 950 500, 1004 500" tip={[1006, 500]} tail={[950, 500]} />
                </Ink>
                <Cursor name="Tereza" x={560} y={612} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={38} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Stickers ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="stickers" title="Stickers — the gallery, a quick yes, and status at a glance" subtitle="E opens the gallery: vote stamps on top, Recent, then four bundled packs with keyword search and credits · a Project status sticker at 160 px · three jersey directions voted with stamps, then a proper vote (proposed)">
        <DCArtboard id="an-stk-gallery" label="13 · E opens the Stickers gallery" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Every sticker, one key away." tag="Proposed: stamps">E opens the gallery above the toolbar: vote stamps, your recent ones, then the four packs that ship with Maude, each credited. Pick one; it follows the pointer until you click.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <PostBoard ab={{ x: 96, y: 150, s: 0.34 }} />
                <StoryBoard ab={{ x: 1040, y: 140, s: 0.22 }} />
                <Sticker id="psDone" size={54} x={96 + 0.34 * 900} y={150 + 0.34 * 70} r={-6} />
                <Sticker id="otLove" size={54} x={1040 + 0.22 * 700} y={140 + 0.22 * 1380} r={5} />
                <St c="sky" x={110} y={560} r={-1.5} w={170} who="jonas">Datum víc vidět — z tribuny ho nepřečteš</St>
                <Cursor x={924} y={248} tag={false} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={34} tool="stamp" />
              <Gallery style={{ position: "absolute", left: "50%", bottom: "calc(var(--space-4) + 64px + var(--space-3))", translate: "calc(-50% + 30px) 0" }} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-stk-search" label="14 · Search “done” across every pack" width={W} height={780} fixed>
          <Close
            title="Type what you mean. Every pack answers."
            lede="Each sticker carries a few words from its pack — done, finished, idea, yes. The search reads those words, not file names, across all four packs and the stamps at once; the words that matched become chips."
            note={<Note n={14} title="Words, not pictures to scroll.">139 stickers is too many to browse. Search narrows them to the few that say what you mean; chips narrow further. Recent keeps the ones you use every review at the top.</Note>}
          >
            <div className="an-sk-row">
              <Gallery q="done" inline />
              <div className="an-fl-rules an-sk-rules">
                {([
                  ["search", "It reads the keywords.", "“done” finds Finished, Done! and Almost done in Project status — six stickers out of 139. Nothing else says done, so the other packs and the stamps step aside."],
                  ["check", "Chips narrow it.", "The words that matched — done, almost-done, finished, approved — become chips with counts. Pick one to see only those; All goes back."],
                  ["history", "Recent first.", "The last stickers you placed open the gallery, per person — the Done sticker you use every review is always one click away."],
                  ["stamp", "Stamps are searchable too.", "“yes”, “star” or “+1” find the vote stamps, so voting never needs the mouse."],
                ] as [string, string, string][]).map(([ic, t, d]) => (
                  <p key={t} className="an-rule"><span className="an-rule-ic"><Icon name={ic} size={16} /></span><span><strong>{t}</strong> {d}</span></p>
                ))}
                <div className="island an-gal an-gal--inline an-gal--empty">
                  <span className="input an-gal-q an-gal-q--on"><Icon name="search" size={14} /><span className="an-gal-qv">hotovo<i className="k-caretline an-caret" /></span><span className="an-gal-x"><Icon name="close" size={12} /></span></span>
                  <p className="an-gal-nil"><strong>No stickers match “hotovo”</strong>Sticker words are English — try <span className="chip">done</span><span className="chip">finished</span><span className="chip">approved</span></p>
                </div>
              </div>
            </div>
          </Close>
        </DCArtboard>

        <DCArtboard id="an-stk-drop" label="15 · Done — a Project status sticker on the post, at 160 px" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="A sticker is a picture on the layer.">It lands at 160 px, selected. Corners resize it, square; Flip mirrors it; Replace… swaps it in place, same spot and size; ⇧⌘L locks it. It is never part of the design.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <PostBoard ab={{ x: 150, y: 110, s: 0.6 }} label="Post 1:1 · Combine 2026 — schváleno" />
                <StoryBoard ab={{ x: 900, y: 110, s: 0.3 }} />
                <Sticker id="psFinished" size={96} x={666} y={150} r={-4} />
                <span className="an-sk-sel" style={{ left: 662, top: 146, width: 104, height: 104 }}><i /><i /><i /><i /><span className="an-sk-size">160 × 160</span></span>
                <St c="green" x={1250} y={190} r={1.5} w={150} who="tereza">Trenér schválil — post můžeme publikovat</St>
                <Cursor x={760} y={244} tag={false} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={60} tool="stamp" />
              <Ctx x={538} y={92}>
                <span className="btn btn--ghost btn--sm"><Icon name="stamp" size={12} />Replace…</span>
                <span className="btn btn--ghost btn--sm"><FlipGlyph />Flip</span>
                <Div />
                <span className="icon-btn k-icon-sm" title="Lock · ⇧⌘L"><Icon name="lock" size={14} /></span>
                <span className="icon-btn k-icon-sm" title="Duplicate · ⌘D"><Icon name="duplicate" size={14} /></span>
                <span className="icon-btn k-icon-sm"><Icon name="more" size={14} /></span>
              </Ctx>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-stamps" label="16 · Three jersey directions, voted with stamps" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Faster than a sticky, kinder than a poll." tag="Proposed">Six stamps, each with a face. After one stamp the gallery folds to this row to keep voting; several on one spot gather into a count, one per person per kind.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {([["Směr A: Tichá zeleň", 140], ["Směr B: Ramena", 540], ["Směr C: Pruh", 940]] as [string, number][]).map(([l, x]) => (
                  <Artboard key={l} label={l} kind="digital" x={x} y={190} w={360} h={203}><GatorMock variant="jersey" headline={l.split(": ")[1]} /></Artboard>
                ))}
                <span className="an-scl" style={{ left: 432, top: 352 }}><Stamp id="yes" who="tereza" /><Stamp id="yes" who="jonas" /></span>
                <span className="an-scl an-scl--n" style={{ left: 796, top: 352 }}><Stamp id="yes" who="you" /><Stamp id="star" who="tereza" /><span className="an-scl-n">5</span></span>
                <span className="an-scl" style={{ left: 1232, top: 352 }}><Stamp id="ask" who={PETRA} /></span>
                <div className="an-who" style={{ left: 760, top: 410 }}>
                  <p className="an-who-h"><b>5 stamps</b> on Směr B</p>
                  {([["yes", "you"], ["yes", "jonas"], ["yes", PETRA], ["star", "tereza"], ["heart", "tereza"]] as [StampId, Who][]).map(([s, w], i) => (
                    <span key={i} className="an-who-r"><Stamp id={s} size={20} /><Avatar who={w} size="sm" /><span>{typeof w === "string" ? (w === "you" ? "You" : w[0].toUpperCase() + w.slice(1)) : w.name}</span><em>{STAMP[s].name}</em></span>
                  ))}
                </div>
                <St c="sky" x={150} y={460} r={-1} w={170} who="jonas">B je nejčitelnější z tribuny</St>
                <Cursor x={820} y={372} tag={false} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Uniformy-2027" zoom={32} tool="stamp" />
              <div className="island an-stpop">
                <span className="an-stpop-l">Stamps</span>
                {STAMP_ROW.map((s) => (
                  <span key={s} className="an-stpop-b" data-on={s === "yes" ? "true" : undefined} title={STAMP[s].name}><Stamp id={s} size={30} /></span>
                ))}
                <span className="an-stpop-more" title="All stickers"><Icon name="chevron" size={14} /></span>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-vote" label="17 · Start a vote — three directions, three votes each" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Stamps are a quick yes; a vote is a decision." tag="Proposed">Three votes each, two minutes, nobody sees the others' until the end. Then every count shows at once and the result stays as a section AI can read.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <JerseyBoards />
                <span className="an-vdots" style={{ left: 540 + 360 - 70, top: 404 }}><Avatar who="you" size="sm" /><Avatar who="you" size="sm" /><span className="an-vdots-n">yours</span></span>
                <span className="an-vdots" style={{ left: 140 + 360 - 70, top: 404 }}><Avatar who="you" size="sm" /><span className="an-vdots-n">yours</span></span>
                <Sec x={140} y={500} w={460} h={150} title="Hlasování · Helmy · 1 Oct" tone="green">
                  <div className="an-vres">
                    {([["Helma: matná zelená", 9], ["Helma: lesklá", 4], ["Helma: se pruhem", 2]] as [string, number][]).map(([t, n]) => (
                      <span key={t} className="an-vres-r"><span>{t}</span><i style={{ width: n * 16 }} /><b>{n}</b></span>
                    ))}
                    <em>Last week's vote · 5 people · 3 votes each · 2 min</em>
                  </div>
                </Sec>
                <St c="sky" x={700} y={520} r={-1} w={170} who="jonas">B je nejčitelnější z tribuny</St>
                <Cursor x={760} y={300} tag={false} />
                <Cursor name="Tereza" x={1180} y={460} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Uniformy-2027" zoom={32} bar={false} people={["tereza", "jonas", PETRA]} />
              <div className="island an-vbar">
                <span className="an-vbar-t"><b>Vote</b>3 directions</span>
                <span className="an-pbar-div" />
                <span><b>0 left</b> of your 3</span>
                <span className="an-pbar-div" />
                <span className="an-vbar-time"><Icon name="clock" size={14} />1:42</span>
                <span className="an-pbar-div" />
                <span className="an-vbar-who"><Avatar who="tereza" size="sm" /><Avatar who="jonas" size="sm" /><Avatar who={PETRA} size="sm" />4 of 5 done</span>
                <span className="btn btn--sm">End vote</span>
              </div>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Comments vs annotations ─────────────────────────────────────────────────────── */}
      <DCSection id="vs" title="Comments and annotations" subtitle="A comment is a conversation pinned to a spot; an annotation is a mark on the canvas · and one turns into the other">
        <DCArtboard id="an-vs" label="18 · People talk, people draw" width={W} height={940} fixed>
          <Close
            title="A comment is people talking. An annotation is people drawing."
            lede="Both sit on the work, so both come up in review — but they answer different needs. Comments wait for an answer; annotations show the thought."
            note={<Note n={18} title="Two layers, one canvas.">They never mix: ⇧P hides annotations but not comment pins; ⇧⌘M opens comments but not stickies. Who can do what follows the role — Can comment has comments only (30).</Note>}
          >
            <div className="an-vs">
              <div className="an-vs-col">
                <p className="an-vs-h"><span className="an-vs-ic"><Icon name="comment" size={18} /></span>Comment<em>people talk</em></p>
                <div className="an-vs-pic">
                  <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={30} y={34} w={216} h={216}><Sc s={0.2} w={1080} h={1080}><AnPost /></Sc></Artboard>
                  <CommentPin who="jonas" x={150} y={180} />
                  <div className="an-th" style={{ left: 270, top: 90 }}>
                    <div className="an-th-msg"><Avatar who="jonas" size="sm" /><span><strong>Jonas</strong><em>2 h ago</em><br />Datum je moc malé — z tribuny ho nepřečteš.</span></div>
                    <div className="an-th-msg"><Avatar who="tereza" size="sm" /><span><strong>Tereza</strong><em>1 h ago</em><br />Zvětším ho po korektuře. @Jonas OK?</span></div>
                    <span className="an-th-acts"><span className="btn btn--ghost btn--sm"><Icon name="check" size={12} />Resolve</span><span className="an-th-r">Reply…</span></span>
                  </div>
                </div>
              </div>
              <div className="an-vs-col">
                <p className="an-vs-h"><span className="an-vs-ic"><AnnotateIcon id="sticky" size={18} /></span>Annotation<em>people draw</em></p>
                <div className="an-vs-pic">
                  <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={30} y={34} w={216} h={216}><Sc s={0.2} w={1080} h={1080}><AnPost /></Sc></Artboard>
                  <Ink w={620} h={290}>
                    <path className="an-mk" d={loop(30 + 0.2 * 482, 34 + 0.2 * 808, 100, 15, 0.4)} />
                    <Arr d="M300 150 C 250 150, 236 190, 212 194" tip={[208, 196]} tail={[236, 190]} />
                  </Ink>
                  <St c="coral" x={300} y={110} r={-1.5} w={150}>Datum víc vidět</St>
                  <span className="an-vs-stamps"><Stamp id="yes" who="tereza" size={26} /><Stamp id="yes" who="jonas" size={26} /></span>
                </div>
              </div>
            </div>
            <div className="an-tbl">
              {([
                ["Lives", "On one spot of an artboard or element", "On the layer above the artboards"],
                ["Made with", "C — Comment", "N · M · A · R · T · E · S"],
                ["Who can", "Can comment and up", "Can edit"],
                ["Talking", "Replies, @mentions, notifications", "No replies — a sticker or a stamp for a quick yes"],
                ["When it's done", "Resolve: moves to Resolved, kept", "Resolve: struck through in place, kept"],
                ["Show and hide", "Comments ⇧⌘M · pins in Edit and Preview, never in Present", "Annotations ⇧P · quiet in Edit, never in Present"],
                ["AI", "Reads a thread you point it at", "Reads the whole layer; writes notes and arrows"],
                ["Export", "Never", "Only with Include annotations"],
              ] as [string, string, string][]).map(([k, a, b]) => (
                <div key={k} className="an-tbl-r"><span className="an-tbl-k">{k}</span><span>{a}</span><span>{b}</span></div>
              ))}
            </div>
          </Close>
        </DCArtboard>

        <DCArtboard id="an-convert" label="19 · A sticky becomes a comment" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="When a note needs an answer, make it a comment." tag="Proposed">Its words become a thread where its arrow pointed (or where it sat), signed by its author; the sticky goes to the trash. A thread's ⋯ turns it back.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards />
                <St c="yellow" x={556} y={232} r={-2} w={128} sel>Photo feels small next to the headline</St>
                <Menu width={236} style={{ left: 690, top: 252 }} items={[
                  { label: "Turn into a comment", icon: "comment", highlight: true },
                  { label: "Resolve", icon: "check" },
                  { label: "Lock", icon: "lock", keys: "⇧⌘L" },
                  "sep",
                  { label: "Copy", keys: "⌘C" }, { label: "Duplicate", keys: "⌘D" }, { label: "Bring to front" },
                  { label: "Ask AI about this sticky", icon: "spark", keys: "⌘/" },
                  "sep",
                  { label: "Move to trash", icon: "trash", keys: "⌫" },
                ]} />
                <CommentPin who="jonas" x={mcta[0] + mcta[2] - 10} y={mcta[1] - 30} />
                <div className="an-th an-th--canvas" style={{ left: 1196, top: 300 }}>
                  <p className="an-th-from"><AnnotateIcon id="sticky" size={14} /><span>From Jonas's sticky · turned into a comment by You · <span className="an-link">Undo</span></span></p>
                  <div className="an-th-msg"><Avatar who="jonas" size="sm" /><span><strong>Jonas</strong><em>yesterday</em><br />Mobile: button above the fold?</span></div>
                  <div className="an-th-msg"><Avatar who="you" size="sm" /><span><strong>You</strong><em>now</em><br />Yes — moving it up on Mobile.</span></div>
                  <span className="an-th-acts"><span className="btn btn--ghost btn--sm"><Icon name="check" size={12} />Resolve</span><span className="icon-btn k-icon-sm"><Icon name="more" size={14} /></span></span>
                </div>
              </Canvas>
              <PvChrome />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · AI with annotations ─────────────────────────────────────────────────────────── */}
      <DCSection id="ai" title="AI with annotations" subtitle="AI reads the layer and offers the change · applies it in Edit and resolves the stickies it answered — kept, not deleted · writes a review as notes with arrows, in its spark colour">
        <DCArtboard id="an-ai-read" label="20 · AI reads three stickies" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="These stickies, as the scope.">Selected stickies become the Ask AI chip. AI outlines what they point at, says it back in one line, then offers one button — nothing has changed yet.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AP.x} y={AP.y} w={1440 * AP.s} h={900 * AP.s}><Sc s={AP.s} w={1440} h={900}><AnHome /></Sc></Artboard>
                <span className="an-aiseen" style={{ left: aArt[0] - 6, top: aArt[1] - 6, width: aArt[2] + 12, height: aArt[3] + 12 }}><span className="an-aiseen-t"><Spark size={10} color="var(--spark-fg)" />The hero picture</span></span>
                <St c="yellow" x={548} y={196} r={-2} w={112} sel who="tereza">Photo bigger?</St>
                <St c="yellow" x={678} y={196} r={1.5} w={150} sel who="jonas">Hero feels small next to the headline</St>
                <St c="yellow" x={556} y={306} r={-1} w={150} sel who="you">Let it fill the right half</St>
                <St c="coral" x={880} y={150} r={2} w={110}>Warmer sun?</St>
                <St c="green" x={300} y={524} r={-1} w={150}>Shorter text on the tiles</St>
                <span className="an-marq" style={{ left: 538, top: 184, width: 300, height: 220 }}><span className="an-marq-t">3 stickies</span></span>
              </Canvas>
              <PvChrome ai={
                <AIPanel chat="Homepage review" scope="3 stickies" messages={[
                  { from: "you", text: "What do these ask for?" },
                  { from: "ai", text: "All three ask for a bigger hero picture — Tereza, Jonas and you. Two say how: let it fill the right half of the page." },
                ]} question={{ text: <>Hero picture: from 616 to 720 wide, to the right edge; the headline keeps its two lines. Tereza's “Warmer sun?” isn't included.</>, primary: "Make these changes", secondary: "Not now" }} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-ai-apply" label="21 · AI makes the change in Edit — the stickies stay, resolved" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="Done — and the review still reads.">AI changed Desktop in Edit; the stickies it answered are resolved — ticked, struck through, kept. The layer is quiet in Edit. ⌘Z undoes both.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AE.x} y={AE.y} w={1440 * AE.s} h={900 * AE.s} selected size="1440 × 900" aiMade><Sc s={AE.s} w={1440} h={900}><AnHome big /></Sc></Artboard>
                <St c="yellow" x={eArt[0] + 18} y={eArt[1] + 30} r={-2} w={122} done quiet>Photo bigger?</St>
                <St c="yellow" x={eArt[0] + 160} y={eArt[1] + 58} r={1.5} w={150} done quiet>Hero picture feels small next to the headline</St>
                <St c="yellow" x={eArt[0] + 58} y={eArt[1] + 160} r={-1} w={150} done quiet>Let it fill the right half</St>
                <St c="coral" x={eArt[0] + 250} y={eArt[1] + 200} r={2} w={110} quiet>Warmer sun?</St>
                <St c="green" x={470} y={526} r={-1} w={150} quiet>Shorter text on the tiles</St>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <CanvasesPanel project="Studio site" count={4} items={STUDIO_ITEMS} selected="Homepage" />
              <ShareCluster mode="edit" />
              <ZoomUndo zoom={55} />
              <Toolbar />
              <AIPanel chat="Homepage review" messages={[
                { from: "you", text: "Make these changes" },
                { from: "ai", text: "Done — the hero picture fills the right half of Desktop. The 3 stickies that asked for it are resolved and stay where they were." },
              ]} chips={["Do “Warmer sun?” too", "Show what changed"]} />
              <span className="an-cl an-cl--wide" style={{ left: 300, top: 622 }}>Quiet in Edit — faded paper, readable words</span>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-ai-stickers" label="22 · AI marks what it resolved with a status sticker" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="Status you can read from across the room.">AI resolves what it answered, puts Done! on it and Flagged on the one that needs your call, each with a spark. Exports leave stickers out unless you include them (29).</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={AP.x} y={AP.y} w={1440 * AP.s} h={900 * AP.s} size="1440 × 900" aiMade><Sc s={AP.s} w={1440} h={900}><AnHome big /></Sc></Artboard>
                <St c="yellow" x={pArt[0] + 18} y={pArt[1] + 30} r={-2} w={122} done>Photo bigger?</St>
                <St c="yellow" x={pArt[0] + 160} y={pArt[1] + 58} r={1.5} w={150} done>Hero picture feels small next to the headline</St>
                <St c="yellow" x={pArt[0] + 58} y={pArt[1] + 160} r={-1} w={150} done>Let it fill the right half</St>
                <Sticker id="psDone" size={88} x={pArt[0] + 132} y={pArt[1] - 6} r={-7} ai />
                <St c="coral" x={pArt[0] + 246} y={pArt[1] + 186} r={2} w={112}>Warmer sun?</St>
                <Sticker id="psFlagged" size={88} x={pArt[0] + 318} y={pArt[1] + 140} r={6} ai />
                <Cursor agent x={pArt[0] + 392} y={pArt[1] + 236} />
              </Canvas>
              <PvChrome canvas="Homepage" zoom={55} ai={
                <AIPanel chat="Homepage review" messages={[
                  { from: "you", text: "Make these changes and mark what's done" },
                  { from: "ai", text: "Done — the hero fills the right half. The 3 stickies it answered are resolved, with a Done! sticker on them. “Warmer sun?” is flagged — that one is your call." },
                ]} chips={["Do “Warmer sun?” too", "Remove the stickers"]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-ai-write" label="23 · AI writes a review as notes with arrows" width={W} height={H} fixed>
          <Stage note={<Note n={23} title="AI marks up; you decide." tag="Proposed: bound ends">Asked to review, AI writes on the layer, never in the design: notes with a spark edge, each with a spark arrow to what it means. Today those ends are fixed points.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={PR.x} y={PR.y} w={1440 * PR.s} h={900 * PR.s}><Sc s={PR.s} w={1440} h={900}><AnPricing /></Sc></Artboard>
                <St ai x={84} y={64} w={210}>Yearly is easy to miss — make it the default?</St>
                <St ai x={900} y={170} w={176}>No price on Team reads as expensive — say “from €2,400”</St>
                <St ai x={900} y={318} w={176}>Three plans look alike — let Studio stand out</St>
                <St ai x={900} y={470} w={176}>“Two days a week” — say “16 hours a week”</St>
                <Ink>
                  <Arr d={`M150 152 C 150 230, 160 ${pToggle[1] + pToggle[3] / 2}, ${pToggle[0] - 5} ${pToggle[1] + pToggle[3] / 2}`} tip={[pToggle[0] - 5, pToggle[1] + pToggle[3] / 2]} tail={[160, pToggle[1] + pToggle[3] / 2]} cls="an-arr--ai" />
                  <Arr d={`M900 214 C 850 214, 840 ${pTeam[1] + pTeam[3] / 2}, ${pTeam[0] + pTeam[2] + 5} ${pTeam[1] + pTeam[3] / 2}`} tip={[pTeam[0] + pTeam[2] + 5, pTeam[1] + pTeam[3] / 2]} tail={[840, pTeam[1] + pTeam[3] / 2]} cls="an-arr--ai" />
                  <Arr pts={[[900, 372], [870, 372], [870, 650], [pB[0] + pB[2] / 2, 650], [pB[0] + pB[2] / 2, pB[1] + pB[3] + 5]]} cls="an-arr--ai" />
                  <Arr d={`M900 506 C 760 506, 700 ${pDays[1] + 6}, ${pDays[0] + pDays[2] + 5} ${pDays[1] + 6}`} tip={[pDays[0] + pDays[2] + 5, pDays[1] + 6]} tail={[700, pDays[1] + 6]} cls="an-arr--ai" />
                </Ink>
                <Cursor agent x={990} y={596} />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Pricing" folded />
              <PanelIcon icon="panel-left" at="left" />
              <PreviewBar name="Pricing" />
              <ShareCluster mode="preview" />
              <ZoomUndo zoom={50} />
              <Toolbar mode="annotate" />
              <AIPanel chat="Pricing review" scope="Pricing" messages={[
                { from: "you", text: "Review Pricing like someone seeing it for the first time" },
                { from: "ai", text: "Done — 4 notes on Pricing, each pointing at what it means. The design didn't change." },
              ]} chips={["Make these changes", "Put them in a section"]} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 8 · Managing the layer ──────────────────────────────────────────────────────────── */}
      <DCSection id="manage" title="Managing the layer" subtitle="Show only Tereza's · lock a sticky so nobody drags it by accident · ⇧P hide, ⇧⌘A select all, quiet in Edit · move resolved stickies to the trash">
        <DCArtboard id="an-layers" label="24 · Only Tereza's, and a locked sticky" width={W} height={H} fixed>
          <Stage note={<Note n={24} title="Filter by person; lock what's settled.">Layers in Preview lists the annotation layer by section; the filter hides the rest, nothing is removed. A locked sticky can be read, not dragged (⇧⌘L).</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Sec x={330} y={110} w={430} h={300} title="Zpětná vazba Tereza" tone="lilac">
                  <St c="yellow" x={22} y={36} r={-1.5} w={130}>Logo na postu o kousek výš</St>
                  <St c="yellow" x={160} y={40} r={1} w={120}>Na story méně textu</St>
                  <St c="yellow" x={290} y={34} r={-0.6} w={120} lock sel>Datum tučně — 14. 3.</St>
                  <St c="yellow" x={30} y={170} r={0.8} w={150}>Zelená je na tisk moc tmavá?</St>
                </Sec>
                <PostBoard ab={{ x: 830, y: 140, s: 0.28 }} />
                <StoryBoard ab={{ x: 1170, y: 140, s: 0.16 }} />
                <Ink>
                  <Arr d="M742 186 C 800 186, 800 330, 846 352" tip={[848, 353]} tail={[800, 330]} />
                  <path className="an-mk" d={loop(830 + 0.28 * 482, 140 + 0.28 * 808, 120, 14, 0.4)} />
                </Ink>
                <Ctx x={540} y={86}><span className="an-ctx-t"><Icon name="lock" size={12} />Locked</span><Div /><span className="btn btn--ghost btn--sm">Unlock<Kbd>⇧⌘L</Kbd></span></Ctx>
                <Tooltip text={<>Locked — unlock to move it</>} x={600} y={236} />
                <Cursor x={680} y={186} tag={false} />
                <Cursor name="Tereza" x={420} y={460} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={40} left={
                <div className="island k-cp an-lp">
                  <div className="k-cp-hd"><span className="seg k-seg"><span className="k-seg-b">Canvases</span><span className="k-seg-b" aria-pressed="true">Layers</span><span className="k-seg-b">Assets</span></span><span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span></div>
                  <p className="island-title k-cp-t">Annotations<span className="k-cp-tc">24</span></p>
                  <span className="an-lp-f">
                    {(["Everyone", "Tereza", "Jonas", "You", "AI"]).map((p) => <span key={p} className="chip an-lp-chip" data-on={p === "Tereza" ? "true" : undefined}>{p === "AI" ? <Spark size={10} /> : p === "Everyone" ? null : <Avatar who={p.toLowerCase()} size="sm" />}{p}</span>)}
                  </span>
                  <div className="k-cp-list">
                    <span className="row-item an-lp-row"><span className="k-cp-tw an-lp-tw"><Icon name="submenu" size={12} /></span><Icon name="section" size={14} /><span className="k-cp-name">Zpětná vazba Tereza</span><span className="k-cp-meta">4</span></span>
                    {([["Logo na postu o kousek výš"], ["Na story méně textu"], ["Datum tučně — 14. 3.", true], ["Zelená je na tisk moc tmavá?"]] as [string, boolean?][]).map(([t, l]) => (
                      <span key={t} className="row-item an-lp-row an-lp-row--in" aria-current={l ? "true" : undefined}><i className="an-lp-sw an-dot--yellow" /><span className="k-cp-name">{t}</span>{l ? <span className="an-lp-st"><Icon name="lock" size={12} /></span> : null}</span>
                    ))}
                    <span className="row-item an-lp-row"><Icon name="arrow" size={14} /><span className="k-cp-name">Arrow to Post 1:1</span></span>
                    <span className="row-item an-lp-row"><Icon name="marker" size={14} /><span className="k-cp-name">Marker on Post 1:1</span></span>
                  </div>
                  <p className="k-cp-foot">Hidden by the filter: Jonas 9 · You 4 · AI 5</p>
                </div>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-visibility" label="25 · Quiet in Edit, hidden with ⇧P, all with ⇧⌘A, cleared with ⌘K" width={W} height={1430} fixed>
          <Close
            title="See it, quiet it, hide it, select it, clear it."
            lede="The layer is always there and never in the way. Four keys and one search cover everything you do to it as a whole."
            note={<Note n={25} title="Decided: Edit keeps the layer in view, quietly.">Hiding feedback while you act on it loses the thread, so Edit shows them quiet — faded paper, readable words — and clicks pass through. ⇧P hides them in any mode.</Note>}
          >
            <div className="an-vg">
              <div className="an-vg-f"><p className="an-fr-t"><span className="an-fr-n">1</span><strong>Preview</strong>full strength, everything clickable</p><Mini s={0.43}><ReviewScene mode="preview" anno="on" /></Mini></div>
              <div className="an-vg-f"><p className="an-fr-t"><span className="an-fr-n">2</span><strong>Edit</strong>faded paper, readable words; a click selects the design under a sticky</p><Mini s={0.43}><ReviewScene mode="edit" anno="quiet" /></Mini></div>
              <div className="an-vg-f"><p className="an-fr-t"><span className="an-fr-n">3</span><strong>⇧P</strong>hidden in any mode; one line says how to bring them back</p><Mini s={0.43}><ReviewScene mode="preview" anno="off" /></Mini></div>
              <div className="an-vg-f"><p className="an-fr-t"><span className="an-fr-n">4</span><strong>⇧⌘A</strong>Edit › Select all annotations — lock, wrap or move them at once</p><Mini s={0.43}><ReviewScene mode="preview" anno="all" /></Mini></div>
            </div>
            <div className="an-vg-k">
              <div className="an-vg-pal">
                <SearchPalette query="resolved" style={{ position: "relative", left: "auto", top: "auto", translate: "none", width: 560 }} groups={[
                  { title: "Actions", rows: [
                    { label: "Move resolved stickies to the trash", icon: "trash", meta: "6 on this canvas", selected: true },
                    { label: "Show resolved stickies", icon: "view" },
                    { label: "Select resolved stickies", icon: "select" },
                  ] },
                ]} />
              </div>
              <div className="an-vg-txt">
                <p className="an-rule"><span className="an-rule-ic"><Icon name="trash" size={16} /></span><span><strong>Clearing up is a search away.</strong> ⌘K “resolved” → Move resolved stickies to the trash. They leave the canvas; the Trash keeps them until it's cleared out, and ⌘Z brings them back now.</span></p>
                <p className="an-rule"><span className="an-rule-ic"><Icon name="view" size={16} /></span><span><strong>Menu › View › Annotations ⇧P</strong> — the same switch, with a tick. Comment pins are a separate layer: shown in Edit and Preview, never in Present.</span></p>
                <p className="an-rule"><span className="an-rule-ic"><Icon name="select" size={16} /></span><span><strong>Menu › Edit › Select all annotations ⇧⌘A</strong> — in Edit it switches to Preview first, because annotations are Preview's to change.</span></p>
                <Toast icon="trash" action="Undo" at="free" style={{ position: "relative", left: "auto", translate: "none", alignSelf: "flex-start" }}>6 stickies moved to the trash</Toast>
              </div>
            </div>
          </Close>
        </DCArtboard>
      </DCSection>

      {/* ── 9 · Edge cases ──────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When annotations meet the real world" subtitle="An arrow whose button is gone · 200 stickies · a sticky on a video · a print artboard and export · someone who may only comment · a FigJam board arriving">
        <DCArtboard id="an-dangling" label="26 · The button it pointed at is in the trash" width={W} height={H} fixed>
          <Stage note={<Note n={26} title="The arrow keeps its end and says why." tag="Proposed: bound to a button">Book a call went to the trash; the arrow ends where it was, dashed, naming what it meant. Point to… re-aims it; restoring the button re-attaches it.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <HomeBoards noBook />
                <span className="an-gone" style={{ left: book[0], top: book[1], width: book[2], height: book[3] }} />
                <St c="coral" x={820} y={330} r={1.5} w={140} who="tereza">Book a call in orange, please</St>
                <Ink>
                  <Arr d={`M822 350 C 760 330, ${book[0] + book[2] / 2} 260, ${book[0] + book[2] / 2} ${book[1] + book[3] + 6}`} tip={[book[0] + book[2] / 2, book[1] + book[3] + 6]} tail={[book[0] + book[2] / 2, 260]} cls="an-arr--dangle an-arr--sel" nohead />
                  <circle className="an-open" cx={book[0] + book[2] / 2} cy={book[1] + book[3] + 6} r={5} />
                </Ink>
                <div className="an-dg" style={{ left: 770, top: 146 }}>
                  <p><Icon name="link" size={13} />Pointed at <strong>“Book a call”</strong> — moved to the trash by Jonas</p>
                  <span className="btn btn--sm btn--primary">Point to…</span>
                </div>
                <Cursor name="Tereza" x={930} y={430} />
              </Canvas>
              <PvChrome />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-crowd" label="27 · 200 stickies, zoomed out" width={W} height={H} fixed>
          <Stage note={<Note n={27} title="Colour first, words when legible.">Below 25 % zoom, stickies draw as colour blocks and sections show counts — the shape of the conversation at a glance. Hover for who; click to zoom in.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {([["Nápady", 120, 130, 330, 250, 84, ["yellow", "lilac", "sky"], 14], ["Partneři", 480, 130, 230, 180, 37, ["green", "yellow"], 10], ["Video", 740, 130, 250, 210, 41, ["lilac", "coral"], 11], ["Tisk", 480, 360, 230, 130, 22, ["coral", "yellow"], 10], ["Ostatní", 120, 410, 330, 110, 16, ["sky", "grey" as Sw], 16]] as [string, number, number, number, number, number, Sw[], number][]).map(([t, x, y, w, h, n, tones, cols]) => (
                  <Sec key={t} x={x} y={y} w={w} h={h} title={t} tone="grey" count={`${n}`} sel={t === "Nápady"}>
                    <Mosaic n={n} tones={tones} cols={cols} />
                  </Sec>
                ))}
                {Array.from({ length: 15 }, (_, i) => <span key={i} className="an-tiny" style={{ left: 1030 + (i % 5) * 62, top: 140 + Math.floor(i / 5) * 70 }} />)}
                <span className="an-tiny-l" style={{ left: 1030, top: 118 }}>Combine-kampan · 15 artboards</span>
                <div className="an-who an-who--sec" style={{ left: 250, top: 250 }}>
                  <p className="an-who-h"><b>Nápady</b> · 84 stickies</p>
                  <span className="an-who-faces"><Avatar who="tereza" size="sm" /><Avatar who="jonas" size="sm" /><Avatar who="you" size="sm" /><Avatar who={PETRA} size="sm" /><span>+ 8 people</span></span>
                  <span className="an-who-k">Click to zoom to it</span>
                </div>
                <Cursor x={232} y={232} tag={false} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={9} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-video" label="28 · A sticky on a video, pinned to 0:12" width={W} height={H} fixed>
          <Stage note={<Note n={28} title="On video, a note has a time." tag="Proposed">Placed on a playing video, a sticky is pinned to that moment (0:12–0:15) and fades at other times. The timeline marks every note; a click jumps there.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Reels 9:16 · nábor" kind="video" x={330} y={80} w={260} h={462} selected size="1080 × 1920"><VideoFrameMock vertical caption="Touchdown!" time="0:12 / 0:30" /></Artboard>
                <Artboard label="16:9 · nábor" kind="video" x={700} y={80} w={448} h={252}><VideoFrameMock caption="Touchdown!" time="0:12 / 0:30" /></Artboard>
                <St c="coral" x={460} y={176} r={-1.5} w={150} time="0:12" who="jonas">Logo naskočí moc brzo</St>
                <St c="yellow" x={346} y={380} r={1} w={140} time="0:21" style={{ opacity: 0.32 }}>Tady hudba vypadne?</St>
                <St c="sky" x={760} y={360} r={-1} w={150}>16:9 až po schválení 9:16</St>
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-video-AI" zoom={30} />
              <div className="island an-tl">
                <div className="an-tl-hd"><span className="icon-btn k-icon-sm"><Icon name="play" size={14} /></span><span className="an-tl-time">0:12 <span>/ 0:30</span></span><span className="an-tl-name"><Icon name="video" size={12} />Reels 9:16 · nábor</span><span className="an-tl-sp" /><span className="an-tl-cnt"><AnnotateIcon id="sticky" size={12} />2 notes · <Icon name="comment" size={12} />1 comment</span></div>
                <div className="an-tl-area">
                  <div className="an-tl-marks">
                    <span className="an-tl-mk an-tl-mk--st" data-on="true" style={{ left: "40%", width: "10%" }}><i className="an-dot an-dot--coral" /></span>
                    <span className="an-tl-mk an-tl-mk--st" style={{ left: "70%", width: "8%" }}><i className="an-dot an-dot--yellow" /></span>
                    <span className="an-tl-mk an-tl-mk--cm" style={{ left: "83%" }}><span className="k-cpin-dot k-av--sky">T</span></span>
                  </div>
                  <div className="an-tl-ruler">{[0, 5, 10, 15, 20, 25, 30].map((s) => <span key={s} style={{ left: `${(s / 30) * 100}%` }}>{s}s</span>)}</div>
                  <div className="an-tl-clips">{([[0, 6, "40 yd sprint"], [6, 11, "Lavička"], [11, 19, "Touchdown"], [19, 24, "Tribuna"], [24, 30, "Logo"]] as [number, number, string][]).map(([a, b, l]) => <span key={l} style={{ left: `calc(${(a / 30) * 100}% + 1px)`, width: `calc(${((b - a) / 30) * 100}% - 2px)` }}>{l}</span>)}</div>
                  <span className="an-tl-head" style={{ left: "40%" }} />
                </div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-print" label="29 · Print artboards — notes stay outside, exports leave them out" width={W} height={H} fixed>
          <Stage note={<Note n={29} title="Never printed, never exported by accident.">A note over a print area says so. Export leaves the layer out unless Include annotations is on — for a review copy, never for print files.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                {([[250, "A · přední FLAG", false], [560, "B · zadní", true]] as [number, string, boolean][]).map(([x, l, back]) => (
                  <Fragment key={l}>
                    <span className="an-bleed" style={{ left: x - 8, top: 132, width: 252 + 16, height: 356 + 16 }} />
                    <PrintBoard ab={{ x, y: 140, s: 252 / 595 }} label={l} back={back} />
                    {[[x - 18, 140], [x + 252 + 6, 140], [x - 18, 496], [x + 252 + 6, 496]].map(([cx, cy], i) => <span key={i} className="an-crop" style={{ left: cx, top: cy }} />)}
                  </Fragment>
                ))}
                <St c="yellow" x={60} y={180} r={-1.5} w={150} who="tereza">Ořez 3 mm — text dál od kraje</St>
                <St c="coral" x={300} y={300} r={1} w={150} style={{ opacity: 0.88 }}>QR vede na registraci?</St>
                <span className="an-noprint" style={{ left: 312, top: 384 }}><Icon name="print" size={12} />Not printed</span>
                <St c="green" x={600} y={560} r={-1} w={150}>Zadní strana — doplnit adresu hřiště</St>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="LetakA6" folded />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster mode="preview" />
              <ZoomUndo zoom={42} />
              <Toolbar mode="annotate" />
              <Veil />
              <div className="k-dialog an-ex">
                <p className="k-dialog-t">Export</p>
                <div className="an-ex-r"><span>Scope</span><span className="seg k-seg"><span className="k-seg-b">Selection</span><span className="k-seg-b" aria-pressed="true">This canvas</span><span className="k-seg-b">Folder</span><span className="k-seg-b">Whole project</span></span></div>
                <div className="an-ex-r"><span>Format</span><span className="select k-in-select">PDF for print · A6, 3 mm bleed<Icon name="chevron" size={12} /></span></div>
                <div className="an-ex-r"><span>Colour</span><span className="an-ex-q">RGB — the print shop converts to CMYK</span></div>
                <div className="an-ex-r an-ex-r--sw"><span>Annotations</span><span className="an-ex-sw an-ex-sw--off"><span className="an-ex-box" aria-disabled="true" /><span><strong>Include annotations</strong><em>Stickies, arrows and stickers stay out unless you include them.</em><em className="an-ex-why">Print files never carry them — pick PDF for a review copy.</em></span></span></div>
                <p className="an-ex-est">2 artboards · 2 pages · about 4 s</p>
                <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Export</span></div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-viewer" label="30 · Can comment — Hand and Comment only" width={W} height={H} fixed>
          <Stage note={<Note n={30} title="Comment, yes; draw, no.">Can comment gets Hand and Comment; everyone's annotations show, read-only. N, M, A or E answer with one line and Ask to edit. Stickers and vote stamps count as drawing.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <PostBoard ab={{ x: 260, y: 120, s: 0.34 }} />
                <StoryBoard ab={{ x: 700, y: 120, s: 0.2 }} />
                <Sec x={980} y={110} w={330} h={260} title="Zpětná vazba Tereza" tone="lilac">
                  <St c="yellow" x={20} y={36} r={-1.5} w={130}>Logo o kousek výš</St>
                  <St c="yellow" x={170} y={40} r={1} w={130}>Na story méně textu</St>
                  <St c="yellow" x={30} y={150} r={0.8} w={150}>Datum tučně — 14. 3.</St>
                </Sec>
                <Ink><path className="an-mk" d={loop(260 + 0.34 * 482, 120 + 0.34 * 808, 146, 18, 0.4)} /></Ink>
                <CommentPin who="you" x={480} y={300} />
                <span className="an-scl" style={{ left: 1210, top: 330 }}><Stamp id="yes" who="tereza" size={26} /><Stamp id="yes" who="jonas" size={26} /></span>
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={36} canEdit={false} access="Can comment" only={["hand", "comment"]} tool="comment" bar={false} ai={<Fragment />} />
              <div className="island an-deny"><span className="an-deny-k"><Kbd>N</Kbd></span><span>Stickies need Can edit.</span><span className="btn btn--sm btn--primary">Ask to edit</span></div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="an-figjam" label="31 · A FigJam board arrives as annotations" width={W} height={H} fixed>
          <Stage note={<Note n={31} title="Their board, still editable.">Import from Figma… takes a FigJam link too: stickies, shapes, connectors and text arrive editable, in one section, authors kept. Widgets, like Figma frames, arrive as pictures.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Sec x={110} y={110} w={880} h={520} title="Combine brainstorm 2025" tone="grey" chip={<span className="chip an-imp"><Icon name="file" size={11} />From FigJam</span>}>
                  <span className="an-shape an-shape--ell" style={{ left: 40, top: 60 }}>Combine 2026</span>
                  <span className="an-shape an-shape--dia" style={{ left: 330, top: 50 }}><span>Partneři?</span></span>
                  <span className="an-shape" style={{ left: 600, top: 64 }}>Rozpočet 40 000 Kč</span>
                  <St c="yellow" x={40} y={200} r={-1} w={140} who="Klára">Hráči z U19 jako tváře kampaně</St>
                  <St c="yellow" x={200} y={210} r={1} w={140}>Reels z loňského Combine</St>
                  <St c="sky" x={360} y={200} r={-0.5} w={140}>Pozvat Kraví horu jako partnera</St>
                  <St c="green" x={520} y={214} r={1.2} w={140}>Leták do škol</St>
                  <St c="coral" x={680} y={200} r={-1.4} w={150}>Termín: březen, ne duben</St>
                  <span className="an-ftext" style={{ left: 40, top: 380 }}>Kdo co dělá</span>
                  <St c="lilac" x={40} y={420} r={0.6} w={160}>Tereza — vizuály, web</St>
                  <St c="lilac" x={220} y={414} r={-0.8} w={160}>Jonas — video a sociální sítě</St>
                  <span className="an-img" style={{ left: 600, top: 380 }}><Icon name="image" size={18} />Widget “Voting” — as a picture</span>
                  <Ink w={880} h={520}>
                    <Arr d="M190 92 L 326 92" tip={[326, 92]} tail={[190, 92]} />
                    <Arr d="M470 92 L 596 92" tip={[596, 92]} tail={[470, 92]} />
                    <Arr pts={[[115, 120], [115, 196]]} />
                  </Ink>
                </Sec>
                <PostBoard ab={{ x: 1080, y: 120, s: 0.24 }} />
              </Canvas>
              <PvChrome project="Alligators brand" canvas="Combine-kampan" zoom={40} />
              <Toast icon="done" action="Undo">46 items from FigJam arrived as annotations</Toast>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
