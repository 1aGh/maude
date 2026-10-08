/**
 * @canvas      05 Empty States — every place that starts with nothing, drawn inside the real window
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   es-home-cloud | es-home-local | es-home-shared | es-project-new | es-canvas-ai | es-landing |
 *              es-canvas-three | es-artboard-new |
 *              es-panels-canvas | es-panels-make | es-timeline |
 *              es-search-k | es-search-more | es-search-panel | es-filter |
 *              es-viewer | es-arriving | es-offline-uncached | es-all-trashed | es-edge-panels
 * @brief       "empty states" — an empty state says what's missing, why it's fine, and ONE next step (often an AI
 *              chip + one action); spot art + SF Rounded for playful moments; no "Oops", no exclamation marks;
 *              "nothing is deleted" means Trash and Version history always exist.
 *
 * Convention (same as 01 Create Flow): every app artboard is a <Stage> — a 1440 × 900 window with its note
 * strip underneath (artboard 1440 × 980). Panel close-ups are sized to content and carry their own title + note.
 * All chrome comes from ./_kit; the local pieces (spot art, empty block, panel shells, mini windows, timeline,
 * viewer toolbar, skeletons) use the `es-` prefix. Assets is the left panel's third tab (kit CanvasesPanel tab="assets").
 *
 * CONTRACT §7 (cross-canvas rules) applied here: offline keeps Ask AI enabled and queues the prompt ("Queued —
 * sends when this Mac is online."); AI-not-connected looks the same until the first send opens the one
 * "Connect your Claude account" sheet; Home always offers "Start with an empty canvas ⌘N" (kit default);
 * things are "moved to the trash", never deleted; every Share cluster carries the kit mode switch (Can comment / Can view people: Viewing + the access word + Ask to edit).
 *
 * Spot art: the three draw-engine spots from system/maude-v2/assets/organic/ (spot-empty-canvas, spot-no-results,
 * spot-ai-ready), lifted shape for shape with token fills only — so they follow the app theme when inlined.
 * Three panel-sized spots (comment, image, done) are composed from the same parts (dot field, sticky, page,
 * the CONTRACT comment glyph) — kit/DS candidates for draw-agent to redraw properly.
 *
 * Play (DS textures + motion specimens): the empty-canvas spot's stickies land on --dur-spring · --ease-spring
 * (live on es-canvas-ai, as a static filmstrip on es-landing); the sticky-confetti tile (patterns.svg,
 * mv2-pattern-confetti) appears once, behind the one celebratory empty state — Comments "All done.".
 *
 * Trash retention: the app never empties Trash by itself (apps/studio/sync/trash.ts — pruning is user-triggered,
 * "Remove copies older than 30 days…" in Menu › Diagnostics). So the copy says "until you clear them out".
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./05 Empty States.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, Canvas, CanvasesPanel, GatorMock, HeroMock, Home, Icon, InFill, InSelect, InSize, InSwitch,
  Inspector, Kbd, Mark, Note, PanelIcon, PhoneMock, ProjectPill, ShareCluster, Spark, Stage, TABS, Thumb,
  Toolbar, V2, Veil, VideoFrameMock, Window, ZoomUndo, ConnectSheet, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT,
} from "./_kit";
import type { Art, CanvasItem, Folder, Kind, Tab } from "./_kit";
import { VIcon } from "./_video";

const W = 1440;
const H = 980;
/** The kit's left panel lifted out of the window into a close-up column. */
const CP_CLOSEUP: CSSProperties = { position: "relative", left: "auto", top: "auto", width: "100%", height: 430, maxHeight: "none" };

/* ═══ The drop of spring — --ease-spring's linear() stops, sampled for the static filmstrip ═══ */

/* Mirrors colors_and_type.css: --dur-spring 420ms · --ease-spring linear(0, 0.24 8%, 0.62 19%, 0.93 32%,
   1.045 45%, 1.03 57%, 0.997 74%, 1). Live CSS uses the tokens; these numbers only freeze frames. */
const SPRING_STOPS: [number, number][] = [[0, 0], [0.08, 0.24], [0.19, 0.62], [0.32, 0.93], [0.45, 1.045], [0.57, 1.03], [0.74, 0.997], [1, 1]];
const DUR_SPRING = 420;
const STAGGER = 48; /* = --dur-flip × 0.4, the CSS delay step */
function springAt(p: number) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  for (let i = 1; i < SPRING_STOPS.length; i++) {
    const [p1, v1] = SPRING_STOPS[i];
    if (p <= p1) { const [p0, v0] = SPRING_STOPS[i - 1]; return v0 + ((v1 - v0) * (p - p0)) / (p1 - p0); }
  }
  return 1;
}
/** A sticky's pose `ms` after the canvas opens: drops 34 px, untilts 8°, grows from 86 %, with a 104.5 % overshoot. */
function pose(ms: number, i: number): CSSProperties {
  const v = springAt((ms - i * STAGGER) / DUR_SPRING);
  return {
    opacity: Math.min(1, v * 1.6),
    transform: `translateY(${((1 - v) * -34).toFixed(1)}px) scale(${(0.86 + 0.14 * v).toFixed(3)}) rotate(${((1 - v) * -8).toFixed(1)}deg)`,
  };
}

/* ═══ Spot art — lifted from assets/organic/*.jsx (240 × 160), token fills only ═══════════════ */

/* The shared dot field: three rings of the canvas grid fading out (opacity 1 · 0.6 · 0.3). */
const DOT_RINGS: [string, number][] = [
  ["88,40 104,40 120,40 136,40 152,40 56,56 72,56 88,56 104,56 120,56 136,56 152,56 168,56 184,56 56,72 72,72 88,72 104,72 120,72 136,72 152,72 168,72 184,72 56,88 72,88 88,88 104,88 120,88 136,88 152,88 168,88 184,88 56,104 72,104 88,104 104,104 120,104 136,104 152,104 168,104 184,104 88,120 104,120 120,120 136,120 152,120", 1],
  ["72,24 88,24 104,24 120,24 136,24 152,24 168,24 40,40 56,40 72,40 168,40 184,40 200,40 40,56 200,56 24,72 40,72 200,72 216,72 24,88 40,88 200,88 216,88 40,104 200,104 40,120 56,120 72,120 168,120 184,120 200,120 72,136 88,136 104,136 120,136 136,136 152,136 168,136", 0.6],
  ["72,8 88,8 104,8 120,8 136,8 152,8 168,8 40,24 56,24 184,24 200,24 24,40 216,40 8,56 24,56 216,56 232,56 8,72 232,72 8,88 232,88 8,104 24,104 216,104 232,104 24,120 216,120 40,136 56,136 184,136 200,136 72,152 88,152 104,152 120,152 136,152 152,152 168,152", 0.3],
];

const LINE = { stroke: "var(--fg-2)", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
/* The CONTRACT comment glyph (16 grid) — one square corner, cut from the mark. */
const COMMENT_D = "M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z";

/** A rotated sticky from spot-empty-canvas / spot-ai-ready: shadow, fill, outline, two text strokes. */
function SpotSticky({ x, y, s, rot, fill, lines = 2, spark = false }: { x: number; y: number; s: number; rot: number; fill: string; lines?: number; spark?: boolean }) {
  const p = s * 0.2;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})`}>
      <rect x="0" y="2" width={s} height={s} rx="4" fill="var(--object-ink)" opacity="0.08" />
      <rect x="0" y="0" width={s} height={s} rx="4" fill={fill} {...LINE} />
      {spark ? (
        <line x1={p} y1={7.2} x2={p} y2={19.2} stroke="var(--spark)" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <>
          <line x1={p} y1={p} x2={s - p} y2={p} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
          {lines > 1 ? <line x1={p} y1={p + 6} x2={p + (s - 2 * p) * 0.6} y2={p + 6} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" /> : null}
        </>
      )}
    </g>
  );
}

/** A comment bubble from the glyph path, scaled; `dashed` = the one that isn't there yet. */
function Bubble({ x, y, k, fill, dashed = false, children }: { x: number; y: number; k: number; fill: string; dashed?: boolean; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      {dashed ? null : <path d={COMMENT_D} transform="translate(0 0.6)" fill="var(--object-ink)" opacity="0.08" />}
      <path d={COMMENT_D} fill={fill} stroke="var(--fg-2)" strokeWidth={1.5 / k} strokeLinejoin="round" strokeDasharray={dashed ? `${3 / k} ${3 / k}` : undefined} />
      {children}
    </g>
  );
}

/** A photo card for the image spot: shadow, fill, outline, a sun and a ridge. */
function Photo({ x, y, rot, fill }: { x: number; y: number; rot: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} 40 30)`}>
      <rect x="0" y="2" width="80" height="60" rx="6" fill="var(--object-ink)" opacity="0.08" />
      <rect x="0" y="0" width="80" height="60" rx="6" fill={fill} {...LINE} />
      <circle cx="58" cy="18" r="6" fill="var(--object-yellow)" stroke="var(--object-ink)" strokeWidth="1.5" strokeOpacity="0.35" />
      <polyline points="8,50 26,32 38,42 50,30 72,50" fill="none" stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </g>
  );
}

type SpotName = "canvas" | "none" | "ai" | "comment" | "image" | "done";
/** One of the DS spots. `quiet` drops it to half strength (offline). `land` plays the spring once; `frame` freezes it at that ms. */
function Spot({ name, w = 240, quiet = false, land = false, frame, className = "" }: { name: SpotName; w?: number; quiet?: boolean; land?: boolean; frame?: number; className?: string }) {
  /* Each sticky is wrapped so the landing transform never fights the placement transform. */
  const St = ({ i, children }: { i: number; children: ReactNode }) => (
    <g className="es-st" style={frame !== undefined ? pose(frame, i) : ({ ["--i" as string]: i } as CSSProperties)}>{children}</g>
  );
  return (
    <svg className={`es-spot${quiet ? " es-spot--quiet" : ""}${land && frame === undefined ? " es-spot--land" : ""} ${className}`} width={w} height={(w * 2) / 3} viewBox="0 0 240 160" fill="none" aria-hidden="true">
      {DOT_RINGS.map(([pts, o]) => (
        <g key={o} fill="var(--canvas-dot)" opacity={o}>
          {pts.split(" ").map((pt) => { const [cx, cy] = pt.split(","); return <circle key={pt} cx={cx} cy={cy} r="1" />; })}
        </g>
      ))}
      {name === "canvas" ? (
        <>
          <g transform="translate(116 20)">
            <rect x="0" y="2" width="96" height="72" rx="8" fill="var(--object-ink)" opacity="0.08" />
            <rect x="0" y="0" width="96" height="72" rx="8" fill="var(--bg-1)" {...LINE} />
            <line x1="4" y1="-8" x2="28" y2="-8" {...LINE} opacity="0.55" />
          </g>
          <St i={0}><SpotSticky x={36} y={96} s={40} rot={-6} fill="var(--object-yellow)" /></St>
          <St i={1}><SpotSticky x={100} y={76} s={36} rot={5} fill="var(--object-lilac)" /></St>
          <St i={2}><SpotSticky x={184} y={116} s={28} rot={-3} fill="var(--object-green)" lines={1} /></St>
        </>
      ) : null}
      {name === "none" ? (
        <>
          <g transform="translate(120 80) rotate(-6 48 32)">
            <rect x="0" y="0" width="96" height="64" rx="10" fill="var(--object-sky)" fillOpacity="0.55" {...LINE} strokeDasharray="4 4" />
          </g>
          <g transform="translate(20 28)">
            <rect x="0" y="2" width="128" height="32" rx="16" fill="var(--object-ink)" opacity="0.08" />
            <rect x="0" y="0" width="128" height="32" rx="16" fill="var(--bg-1)" {...LINE} />
            <circle cx="18" cy="16" r="5" {...LINE} />
            <line x1="21.54" y1="19.54" x2="24.36" y2="22.36" {...LINE} />
            <line x1="36" y1="16" x2="76" y2="16" {...LINE} />
            <line x1="82" y1="10" x2="82" y2="22" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </>
      ) : null}
      {name === "ai" ? (
        <>
          <St i={0}><SpotSticky x={136} y={56} s={56} rot={4} fill="var(--object-yellow)" spark /></St>
          <polygon points="84,43 92.4,67.6 117,76 92.4,84.4 84,109 75.6,84.4 51,76 75.6,67.6" fill="var(--spark)" />
          <polygon points="128,26.1 130.52,33.48 137.9,36 130.52,38.52 128,45.9 125.48,38.52 118.1,36 125.48,33.48" fill="var(--spark)" />
        </>
      ) : null}
      {name === "comment" ? (
        <>
          <g transform="translate(52 26)">
            <rect x="0" y="2" width="112" height="84" rx="8" fill="var(--object-ink)" opacity="0.08" />
            <rect x="0" y="0" width="112" height="84" rx="8" fill="var(--bg-1)" {...LINE} />
            <line x1="12" y1="16" x2="60" y2="16" {...LINE} opacity="0.55" />
            <line x1="12" y1="26" x2="44" y2="26" {...LINE} opacity="0.55" />
            <rect x="12" y="38" width="88" height="34" rx="4" fill="var(--object-sky)" fillOpacity="0.45" />
          </g>
          <Bubble x={140} y={62} k={3} fill="var(--object-yellow)">
            <g fill="var(--object-ink)" opacity="0.45"><circle cx="5.5" cy="8" r="0.6" /><circle cx="8" cy="8" r="0.6" /><circle cx="10.5" cy="8" r="0.6" /></g>
          </Bubble>
          <Bubble x={22} y={88} k={2.25} fill="none" dashed />
        </>
      ) : null}
      {name === "image" ? (
        <>
          <g transform="translate(40 40)">
            <rect x="0" y="0" width="160" height="104" rx="12" fill="var(--object-sky)" fillOpacity="0.22" {...LINE} strokeDasharray="4 4" />
          </g>
          <Photo x={58} y={56} rot={-7} fill="var(--object-green)" />
          <Photo x={104} y={66} rot={6} fill="var(--object-coral)" />
          <g {...LINE}><line x1="120" y1="10" x2="120" y2="34" /><polyline points="112,27 120,35 128,27" /></g>
        </>
      ) : null}
      {name === "done" ? (
        <>
          <Bubble x={40} y={58} k={2.5} fill="var(--object-lilac)" />
          <Bubble x={160} y={40} k={2.25} fill="var(--object-sky)" />
          <St i={0}>
            <Bubble x={84} y={24} k={4.5} fill="var(--object-green)">
              <path d="M5.5 8.1l1.7 1.7 3.3-3.6" fill="none" stroke="var(--object-ink)" strokeWidth={1.5 / 4.5} strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
            </Bubble>
          </St>
        </>
      ) : null}
    </svg>
  );
}

/* The sticky-confetti tile from assets/organic/patterns.svg (mv2-pattern-confetti-*), token fills only.
   DS rule: confetti belongs to empty states and celebrations — never behind a canvas you're working on. */
const CONFETTI: [number, number, number, number, string][] = [
  [204.8, 153.6, 24, 8, "var(--object-coral)"], [80, 60, -16, 6, "var(--object-sky)"], [0, 180, 34, 6, "var(--object-green)"],
  [320, 180, 34, 6, "var(--object-green)"], [160, 0, -10, 4, "var(--object-lilac)"], [160, 240, -10, 4, "var(--object-lilac)"],
  [240, 80, -28, 4, "var(--object-yellow)"],
];
function Confetti({ id, shift = [0, 0] }: { id: string; shift?: [number, number] }) {
  return (
    <svg className="es-confetti" aria-hidden="true">
      <defs>
        <pattern id={id} width="320" height="240" patternUnits="userSpaceOnUse" patternTransform={`translate(${shift[0]} ${shift[1]})`}>
          {CONFETTI.map(([x, y, r, s, fill]) => (
            <rect key={`${x}-${y}`} x={-s / 2} y={-s / 2} width={s} height={s} rx="1" fill={fill} transform={`translate(${x} ${y}) rotate(${r})`} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ═══ The empty block — what's missing · why it's fine · one next step ════════════════════════ */

function Empty({ spot, spotW, land, glyph, title, children, chips, action, size = "panel", align = "center", quiet = false, className = "", style }: {
  spot?: SpotName; spotW?: number; land?: boolean; glyph?: string; title: ReactNode; children?: ReactNode; chips?: ReactNode; action?: ReactNode;
  size?: "panel" | "canvas"; align?: "center" | "left"; quiet?: boolean; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={`es-e es-e--${size} es-e--${align} ${className}`} style={style}>
      {spot ? <Spot name={spot} w={spotW ?? (size === "canvas" ? 240 : 176)} quiet={quiet} land={land} /> : null}
      {!spot && glyph ? <span className={`es-glyph${glyph === "spark" ? " es-glyph--spark" : ""}`}>{glyph === "spark" ? <Spark size={16} /> : <Icon name={glyph} size={18} />}</span> : null}
      <p className="es-sit">{title}</p>
      {children ? <p className="es-next">{children}</p> : null}
      {chips ? <div className="es-chips">{chips}</div> : null}
      {action ? <div className="es-acts">{action}</div> : null}
    </div>
  );
}

/** The AI's next step as a spark button (the spark = AI is the one doing it). */
function AskBtn({ children, keys }: { children: ReactNode; keys?: string }) {
  return <span className="btn btn--spark btn--sm es-ask"><Spark size={10} color="var(--spark-fg)" />{children}{keys ? <span className="es-keys">{keys}</span> : null}</span>;
}
/** A suggestion the AI would run — written as something you'd say. */
function Sugg({ children }: { children: ReactNode }) {
  return <span className="chip es-sugg">{children}</span>;
}
/** A music note in the family's 16 grid / 1.5 stroke (the kit has no audio glyph — kit candidate). */
function MusicGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 12V3.75l7-1.5V10.5" /><circle cx="4.25" cy="12" r="1.75" /><circle cx="11.25" cy="10.5" r="1.75" />
    </svg>
  );
}

/* ═══ Local panel shells (kit candidates) ═════════════════════════════════════════════════════ */

/** Canvases · Layers · Assets panel shell — kit classes, any body (the kit panel has no empty slot outside search). */
function PanelShell({ tab = "canvases", find, children, foot, className = "", style }: { tab?: "canvases" | "layers" | "assets"; find?: string | false; children: ReactNode; foot?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`island k-cp ${className}`} style={style}>
      <div className="k-cp-hd">
        <span className="seg k-seg">
          <span className="k-seg-b" aria-pressed={tab === "canvases"}>Canvases</span>
          <span className="k-seg-b" aria-pressed={tab === "layers"}>Layers</span>
          <span className="k-seg-b" aria-pressed={tab === "assets"}>Assets</span>
        </span>
        <span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span>
      </div>
      {find !== false && tab === "canvases" ? (
        <span className="k-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">{find ?? "Search"}</span><Kbd>⌘K</Kbd></span>
      ) : null}
      <div className="k-cp-list">{children}</div>
      {foot ? <p className="k-cp-foot">{foot}</p> : null}
    </div>
  );
}

/** A titled side panel (Comments, Version history, Exports, Trash, Chats). Assets is the left panel's third tab. */
function SidePanel({ title, chip, back = false, children, className = "", style, foot }: { title: string; chip?: string; back?: boolean; children: ReactNode; className?: string; style?: CSSProperties; foot?: ReactNode }) {
  return (
    <div className={`island es-sp ${className}`} style={style}>
      <div className="es-sp-hd">
        {back ? <span className="es-sp-back"><Icon name="chevron" size={12} /></span> : null}
        <strong>{title}</strong>
        {chip ? <span className="chip es-sp-chip">{chip}</span> : null}
        <span className="icon-btn k-icon-sm es-sp-x"><Icon name="close" size={14} /></span>
      </div>
      <div className="es-sp-body">{children}</div>
      {foot ? <p className="es-sp-foot">{foot}</p> : null}
    </div>
  );
}

function FolderRow({ name, count, open = false, depth = 0, current = false }: { name: string; count?: number; open?: boolean; depth?: number; current?: boolean }) {
  return (
    <span className="row-item k-cp-folder" data-open={open ? "true" : undefined} aria-current={current ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-1) + ${depth} * var(--space-4))` }}>
      <span className="k-cp-tw"><Icon name="submenu" size={12} /></span>
      <span className="k-cp-fic"><Icon name="folder" size={14} /></span>
      <span className="k-cp-name">{name}</span>
      {count !== undefined ? <span className="k-cp-count">{count}</span> : null}
    </span>
  );
}
function CanvasRowLocal({ name, art = "blank", depth = 0, current = false, meta, dim = false, kinds }: { name: string; art?: Art; depth?: number; current?: boolean; meta?: ReactNode; dim?: boolean; kinds?: Kind[] }) {
  return (
    <span className={`row-item k-cp-row${dim ? " k-cp-row--dim es-row-off" : ""}`} aria-current={current ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))` }}>
      <Thumb art={art} className="k-thumb--row" />
      <span className="k-cp-name">{name}</span>
      <span className="k-cp-badges">{kinds?.map((k) => <span key={k} className="k-kind"><Icon name={k} size={11} /></span>)}{meta ? <span className="k-cp-meta">{meta}</span> : null}</span>
    </span>
  );
}

/** es-arriving: what has already come down to the new Mac. es-offline-uncached: what never came down. */
const ARRIVED = ["Combine-kampan", "Combine-letak-registrace"];
const NOT_ON_THIS_MAC = ["Combine-cisla", "Combine-video-AI"];

/** The kit's one Alligators tree (ALLIGATORS_FOLDERS / ALLIGATORS_ROOT) with this canvas's row pieces, so every count
 *  matches the other v2 canvases. `item` draws one canvas row (default: a plain row); `folder` can swap a folder row. */
function GatorTree({ item, folder }: { item?: (it: CanvasItem, depth: number) => ReactNode; folder?: (f: Folder, depth: number) => ReactNode }) {
  const out: ReactNode[] = [];
  const walk = (fs: Folder[], depth: number) => fs.forEach((f) => {
    out.push(<Fragment key={`${f.name}-${depth}`}>{folder?.(f, depth) ?? <FolderRow name={f.name} count={f.count} open={f.open} depth={depth} />}</Fragment>);
    if (!f.open) return;
    if (f.folders) walk(f.folders, depth + 1);
    (f.items ?? []).forEach((it) => out.push(<Fragment key={it.name}>{item ? item(it, depth + 1) : <CanvasRowLocal name={it.name} art={it.art} depth={depth + 1} kinds={it.kinds} />}</Fragment>));
  });
  walk(ALLIGATORS_FOLDERS, 0);
  ALLIGATORS_ROOT.forEach((it) => out.push(<Fragment key={`root-${it.name}`}>{item ? item(it, 0) : <CanvasRowLocal name={it.name} art={it.art} />}</Fragment>));
  return <>{out}</>;
}

/** Kind filter chips (lifted from 08 Artboard Kinds' KindChips, es- prefix). */
function KindChips({ counts, on }: { counts: Record<"all" | Kind, number>; on: "all" | Kind }) {
  const order: ("all" | Kind)[] = ["all", "digital", "web", "print", "video"];
  return (
    <span className="es-kchips">
      {order.map((k) => (
        <span key={k} className="chip es-kchip" data-on={on === k ? "true" : undefined}>
          {k === "all" ? <span>All</span> : <Icon name={k} size={12} />}
          <span className="es-kchip-n">{counts[k]}</span>
          {on === k && k !== "all" ? <span className="es-kchip-x"><Icon name="close" size={9} /></span> : null}
        </span>
      ))}
    </span>
  );
}

/** A small Edit toolbar for a card-sized canvas crop (CONTRACT §2: Edit's tools, in order, then More). */
const MINI_TOOLS = ["select", "hand", "frame", "shape", "pen", "text", "image", "component"];
function MiniDock() {
  return (
    <span className="island dock es-minidock">
      {MINI_TOOLS.map((t, i) => <span key={t} className={`icon-btn${i === 0 ? " k-pressed" : ""}`}><Icon name={t} size={15} /></span>)}
      <span className="divider-v" />
      <span className="icon-btn"><Icon name="more" size={15} /></span>
    </span>
  );
}

/** Close-up frame: title, the panels, the note. */
function Closeup({ title, note, children, theme = "light", className = "" }: { title: ReactNode; note: ReactNode; children: ReactNode; theme?: "light" | "dark"; className?: string }) {
  return (
    <V2 theme={theme} className={`es-cu ${className}`}>
      <p className="es-cu-h">{title}</p>
      <div className="es-cu-body">{children}</div>
      <div className="es-cu-note">{note}</div>
    </V2>
  );
}
/** One labelled column inside a close-up. */
function Col({ label, children, w }: { label: string; children: ReactNode; w?: number }) {
  return (
    <figure className="es-col" style={w ? { width: w } : undefined}>
      <figcaption className="es-col-l">{label}</figcaption>
      {children}
    </figure>
  );
}

/* ═══ Projects ════════════════════════════════════════════════════════════════════════════════ */

const PORTFOLIO: Tab = { name: "Portfolio 2026", initial: "P", color: "coral", account: "You", local: true };
const STUDIO: CanvasItem[] = [
  { name: "Homepage", art: "home", people: ["tereza"] },
  { name: "Pricing", art: "price" },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
];
const STUDIO_TABS = [TABS.studio, TABS.alligators];
const GATOR_TABS = [TABS.studio, TABS.alligators];

/** Homepage's two artboards (behind panels, veils and the new empty artboard). */
function HomepageBoards({ dx = 0 }: { dx?: number }) {
  return (
    <>
      <Artboard label="Desktop" kind="web" x={330 + dx} y={110} w={480} h={300}><HeroMock /></Artboard>
      <Artboard label="Mobile" kind="web" x={850 + dx} y={110} w={142} h={307}><PhoneMock title="Calm software" tone="sky" /></Artboard>
    </>
  );
}

/** A few Combine-kampan artboards (the busy project behind a panel). */
function KampanBits({ dx = 0, dim = false }: { dx?: number; dim?: boolean }) {
  return (
    <>
      <Artboard label="Web · STAŇ SE GATOREM" kind="web" x={330 + dx} y={110} w={460} h={288} dim={dim}><GatorMock variant="web" /></Artboard>
      <Artboard label="Post 1:1 · Combine 2026" kind="digital" x={830 + dx} y={110} w={230} h={230} dim={dim}><GatorMock variant="social" headline="COMBINE 2026" sub="So 14. 3. · Kraví hora" /></Artboard>
      <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={1100 + dx} y={110} w={130} h={230} dim={dim}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
      <Artboard label="A4 · plakát" kind="print" x={830 + dx} y={400} w={200} h={283} dim={dim}><GatorMock variant="poster" /></Artboard>
      <Artboard label="16:9 · teaser" kind="video" x={330 + dx} y={450} w={320} h={180} dim={dim}><VideoFrameMock caption="Combine 2026" time="0:12 / 0:30" /></Artboard>
    </>
  );
}

/* ─── Home with an empty shelf ─── */
function GhostCards({ n = 3 }: { n?: number }) {
  return <span className="es-ghosts">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>;
}
/** One Home shelf: a header (+ where it lives) and a row. Same words as 02 Onboarding's EmptyShelf. */
function Shelf({ title, where, children }: { title: string; where?: ReactNode; children: ReactNode }) {
  return (
    <div className="es-shelf-sec">
      <p className="es-shelf-h"><span>{title}</span>{where ? <span className="es-shelf-where">{where}</span> : null}</p>
      {children}
    </div>
  );
}

/* ─── New canvas, three ways (mini windows) ─── */
function MiniCanvas({ status, children }: { status: "saved" | "offline"; children: ReactNode }) {
  return (
    <div className="es-mini">
      <span className="island es-mini-pill"><Mark size={20} /><strong>Studio site</strong><span className="es-mini-sep">/</span><span>About us</span></span>
      <span className={`island es-mini-st${status === "offline" ? " es-mini-st--off" : ""}`}><Icon name={status === "offline" ? "offline" : "cloud"} size={14} />{status === "offline" ? "Offline — kept on this Mac" : "Saved"}</span>
      {children}
      <MiniDock />
    </div>
  );
}
/** What the first Ask AI does next — a slice of the AI chat panel. */
const ABOUT_PROMPT = "An About us page: three team portraits and a short story";
function AiSlice({ children }: { children: ReactNode }) {
  return (
    <div className="island island--pad es-slice">
      <div className="k-ai-hd"><Spark size={14} /><span className="k-ai-name">AI</span><span className="chip es-slice-scope">About us</span></div>
      <p className="k-ai-msg k-ai-msg--you">{ABOUT_PROMPT}</p>
      {children}
    </div>
  );
}

/* ─── Timeline with no clips ─── */
function EmptyTimeline() {
  return (
    <div className="island es-tl">
      <div className="es-tl-hd">
        <span className="icon-btn k-icon-sm es-tl-off"><Icon name="play" size={14} /></span>
        <span className="es-tl-time">0:00 <span>/ 0:00</span></span>
        <span className="es-tl-name"><Icon name="video" size={12} />Reels · nábor 2027</span>
        <span className="btn btn--ghost btn--sm es-tl-exp" title="Expand the timeline"><VIcon name="expand" size={12} />Expand</span>
      </div>
      <div className="es-tl-ruler">{["0:00", "0:05", "0:10", "0:15", "0:20", "0:25", "0:30"].map((t) => <i key={t}>{t}</i>)}</div>
      <div className="es-tl-drop">
        <span className="es-tl-drop-ic"><Icon name="video" size={18} /></span>
        <span className="es-tl-drop-txt">
          <strong className="es-sit">No clips on Reels · nábor 2027 yet.</strong>
          <span className="es-next">Drag footage here from Assets or Finder. 38 clips from Combine 2026 are ready in Assets.</span>
        </span>
        <AskBtn>Cut 15 s from those clips</AskBtn>
      </div>
      <div className="es-tl-lane"><Icon name="type" size={12} />Captions</div>
      <div className="es-tl-lane"><MusicGlyph />Music</div>
    </div>
  );
}

/* ─── Search with no results — the palette with spot art (kit k-pal classes) ─── */
function NoResultsPalette() {
  return (
    <div className="k-pal es-pal">
      <span className="k-pal-field"><Icon name="search" size={18} /><span className="k-pal-typed">pricng<i className="k-caretline k-caretline--lg" /></span><Kbd>esc</Kbd></span>
      <div className="es-pal-none">
        <Spot name="none" w={150} />
        <span className="es-pal-txt">
          <strong className="es-sit">Nothing called “pricng”.</strong>
          <span className="es-next">Try another word, or ask AI to find it.</span>
        </span>
      </div>
      <div className="k-pal-res">
        <p className="island-title k-pal-gt">Did you mean</p>
        <span className="k-pal-row" data-sel="true">
          <Thumb art="price" className="k-thumb--pal" />
          <span className="k-pal-label"><span className="k-pal-ltxt">Pricing</span></span>
          <span className="k-pal-meta">Studio site · Tereza, 2 h ago</span>
        </span>
        <div className="k-pal-ask">
          <span className="k-pal-row">
            <span className="k-pal-ic k-pal-ic--spark"><Spark size={12} color="var(--spark-fg)" /></span>
            <span className="k-pal-label">Ask AI to find “pricng”<span className="k-pal-meta"> — it looks inside canvases too</span></span>
            <span className="k-keys"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          </span>
        </div>
      </div>
      <div className="k-pal-foot">
        <span className="k-pal-hints"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span></span>
        <span>0 results · 1 close match</span>
      </div>
    </div>
  );
}

/* ─── ⌘K on a brand-new Mac: no recents yet, so Search shows where to start ─── */
function PalRow({ icon, label, keys, sel = false }: { icon: string; label: string; keys?: string[]; sel?: boolean }) {
  return (
    <span className="k-pal-row" data-sel={sel ? "true" : undefined}>
      <span className="k-pal-ic"><Icon name={icon} size={14} /></span>
      <span className="k-pal-label"><span className="k-pal-ltxt">{label}</span></span>
      {keys ? <span className="k-keys">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span> : null}
    </span>
  );
}
function NoRecentsPalette() {
  return (
    <div className="k-pal es-rel es-pal-new">
      <span className="k-pal-field"><Icon name="search" size={18} /><span className="k-pal-typed"><span className="k-pal-ph">Search canvases, actions, or ask AI…</span></span><Kbd>esc</Kbd></span>
      <div className="k-pal-res">
        <p className="island-title k-pal-gt">Recent</p>
        <p className="es-pal-recent"><span className="es-sit">Nothing opened yet.</span><span className="es-next">Canvases you open show up here, newest first.</span></p>
        <p className="island-title k-pal-gt">Start here</p>
        <PalRow icon="plus" label="New canvas" keys={["⌘", "N"]} sel />
        <PalRow icon="folder" label="Open project…" keys={["⌘", "O"]} />
        <PalRow icon="insert" label="Import from Figma…" />
        <PalRow icon="help" label="Keyboard shortcuts" keys={["?"]} />
        <div className="k-pal-ask">
          <span className="k-pal-row">
            <span className="k-pal-ic k-pal-ic--spark"><Spark size={12} color="var(--spark-fg)" /></span>
            <span className="k-pal-label">Ask AI<span className="k-pal-meta"> — type what to make, or what to find</span></span>
            <span className="k-keys"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          </span>
        </div>
      </div>
      <div className="k-pal-foot">
        <span className="k-pal-hints"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> run</span></span>
        <span>Every tool is here — type its name</span>
      </div>
    </div>
  );
}

/* ─── Can comment: the toolbar is 04 · md-comment-only's — Preview's toolbar cut to Hand · Comment, nothing else.
   It rests on Hand here (nothing written yet; the empty Comments panel says press C). ─── */

/* ─── Uniformy-2027 as it really is: 1920 × 1080 boards, fixed-size digital. Same piece and labels as 04 · md-comment-only. ─── */
type UniItem = { dir: "a" | "b" | "c"; away?: boolean; helmet?: boolean };
const UNI: { label: string; eyebrow: string; title: string; items: UniItem[] }[] = [
  { label: "01 · Přehled", eyebrow: "Dresy 2027", title: "Tři směry", items: [{ dir: "a" }, { dir: "b" }, { dir: "c" }] },
  { label: "02 · Směr A: Tichá zeleň", eyebrow: "Směr A", title: "Tichá zeleň", items: [{ dir: "a" }, { dir: "a", away: true }] },
  { label: "03 · Směr B: Ramena", eyebrow: "Směr B", title: "Ramena", items: [{ dir: "b" }, { dir: "b", away: true }] },
  { label: "04 · Směr C: Tón v tónu", eyebrow: "Směr C", title: "Tón v tónu", items: [{ dir: "c" }, { dir: "c", away: true }] },
  { label: "05 · Konfigurátor", eyebrow: "Konfigurátor", title: "Doma · venku", items: [{ dir: "b" }, { dir: "b", away: true }, { dir: "b", helmet: true }] },
  { label: "10 · Detaily B", eyebrow: "Detaily B", title: "Helma z boku", items: [{ dir: "b", helmet: true }, { dir: "b" }] },
];
function UniBoard({ eyebrow, title, items }: { eyebrow: string; title: string; items: UniItem[] }) {
  return (
    <div className="k-mk es-uni">
      <div className="es-uni-t"><span>{eyebrow}</span><strong>{title}</strong></div>
      <div className="es-uni-row">
        {items.map((it, i) => it.helmet
          ? <span key={i} className="es-uni-helm"><i /></span>
          : <span key={i} className={`es-uni-shirt es-uni-shirt--${it.dir}`} data-away={it.away ? "true" : undefined}><b>27</b></span>)}
      </div>
    </div>
  );
}

/* ─── Cloud copy still arriving: named, dimmed rows — never nameless bars ─── */
function ArrivingRow({ name, depth = 0, folder = false, count, kinds }: { name: string; depth?: number; folder?: boolean; count?: number; kinds?: Kind[] }) {
  return folder ? (
    <span className="row-item k-cp-folder es-arr" style={{ paddingLeft: `calc(var(--space-1) + ${depth} * var(--space-4))` }}>
      <span className="k-cp-tw"><Icon name="submenu" size={12} /></span>
      <span className="k-cp-fic es-pulse"><Icon name="folder" size={14} /></span>
      <span className="k-cp-name">{name}</span>
      {count !== undefined ? <span className="k-cp-count">{count}</span> : null}
    </span>
  ) : (
    <span className="row-item k-cp-row es-arr" style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))` }}>
      <i className="es-sk es-sk--thumb es-pulse" />
      <span className="k-cp-name">{name}</span>
      {kinds ? <span className="k-cp-badges">{kinds.map((k) => <span key={k} className="k-kind"><Icon name={k} size={11} /></span>)}</span> : null}
    </span>
  );
}
function SkelBoard({ label, kind, x, y, w, h }: { label: string; kind: Kind; x: number; y: number; w: number; h: number }) {
  return (
    <div className="es-skab" style={{ left: x, top: y, width: w, height: h }}>
      <span className="es-skab-name"><Icon name={kind} size={11} />{label}</span>
      <span className="es-skab-page es-pulse"><i /><i /><i /></span>
    </div>
  );
}

/* ─── All artboards in the trash: their outlines stay where they were ─── */
function GhostBoard({ label, x, y, w, h }: { label: string; x: number; y: number; w: number; h: number }) {
  return (
    <div className="es-ghab" style={{ left: x, top: y, width: w, height: h }}>
      <span className="es-ghab-name"><Icon name="print" size={11} />{label}</span>
    </div>
  );
}
/** The dashed bracket that ties the Restore card to the four places it fills. */
function RestoreBracket({ xs, top, bar, card }: { xs: number[]; top: number; bar: number; card: { x: number; y: number } }) {
  return (
    <svg className="es-bracket" aria-hidden="true">
      {xs.map((x) => <path key={x} d={`M${x} ${top}V${bar}`} />)}
      <path d={`M${xs[0]} ${bar}H${xs[xs.length - 1]}`} />
      <path d={`M${card.x} ${bar}V${card.y}`} />
      {xs.map((x) => <circle key={`d${x}`} cx={x} cy={top} r="3" />)}
    </svg>
  );
}

/* ─── The landing filmstrip ─── */
const FRAMES: { ms: number; t: string; d: string }[] = [
  { ms: 0, t: "0 ms", d: "The line is already there. Words never wait for the art." },
  { ms: 90, t: "90 ms", d: "The stickies drop in, one after another, 48 ms apart." },
  { ms: 200, t: "200 ms", d: "The first one overshoots — 104.5 %, a few pixels — and settles." },
  { ms: 520, t: "520 ms", d: "Settled. Nothing moves again until you do." },
];
function SpringCurve() {
  const pt = (p: number, v: number) => `${(8 + p * 184).toFixed(1)} ${(112 - v * 88).toFixed(1)}`;
  const d = SPRING_STOPS.map(([p, v], i) => `${i ? "L" : "M"}${pt(p, v)}`).join(" ");
  return (
    <svg className="es-curve" viewBox="0 0 200 124" aria-hidden="true">
      <path className="es-curve-base" d={`M${pt(0, 1)}H192`} />
      <path className="es-curve-base" d={`M${pt(0, 0)}H192`} />
      <path className="es-curve-path" d={d} />
      {FRAMES.map((f) => { const p = Math.min(1, f.ms / DUR_SPRING); return <circle key={f.ms} className="es-curve-dot" cx={8 + p * 184} cy={112 - springAt(p) * 88} r="3.5" />; })}
    </svg>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════════ */
export default function EmptyStates() {
  return (
    <DesignCanvas>
      {/* ── 1 · First moments ─────────────────────────────────────────────────────────────── */}
      <DCSection id="first" title="First moments" subtitle="A brand-new Home, project, canvas and artboard — the prompt comes first, and an empty canvas is always one key away">
        <DCArtboard id="es-home-cloud" label="1 · Home — signed in, no projects yet" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Signed in, nothing made yet.">The question and the prompt do the work; “Start with an empty canvas ⌘N” is the way in without AI. Below, ghost cards show the shelf's shape — your first canvas starts the first project.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas>
                <Home compact target="a new project" placeholder="A landing page for a small café, warm and simple" starters={[
                  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                  { t: "Three logo ideas", l: "for a new brand", art: "brand" },
                  { t: "A matchday poster", l: "A4, ready to print", art: "gator-poster" },
                ]} />
                <div className="es-shelf">
                  <Shelf title="Your projects" where={<><Icon name="cloud" size={13} />cloud.maude.sh</>}>
                    <div className="es-shelf-row">
                      <GhostCards n={3} />
                      <Empty align="left" title="No projects yet.">
                        Your first canvas starts one — and everyone you invite sees it here.
                      </Empty>
                    </div>
                  </Shelf>
                </div>
              </Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-home-local" label="2 · Home — a local project, not signed in" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Local is just as ready.">Same question, same prompt, same ⌘N — the chip says the canvas stays on this Mac. The shelf offers the one thing a local person does: open a folder they already have. Sign-in waits, quietly, top right.</Note>}>
            <Window tabs={[TABS.home]} activeTab="home">
              <Canvas>
                <Home compact target="a project on this Mac" placeholder="A one-page portfolio, six projects, calm and light" starters={[
                  { t: "A portfolio page", l: "six projects, calm", art: "home" },
                  { t: "Three logo ideas", l: "for a new brand", art: "brand" },
                  { t: "A moodboard", l: "photos and swatches", art: "moodboard" },
                ]} />
                <span className="island es-signin"><span className="btn btn--ghost btn--sm"><Icon name="cloud" size={14} />Sign in to cloud.maude.sh</span></span>
                <div className="es-shelf">
                  <Shelf title="Your projects" where={<><Icon name="laptop" size={13} />On this Mac</>}>
                    <div className="es-shelf-row">
                      <GhostCards n={3} />
                      <Empty align="left" title="No projects on this Mac yet." action={<span className="btn btn--ghost btn--sm"><Icon name="folder" size={14} />Open project…<span className="es-keys">⌘O</span></span>}>
                        Your first canvas starts one. Already have a folder of work? Any folder opens.
                      </Empty>
                    </div>
                  </Shelf>
                </div>
              </Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-home-shared" label="3 · Home — nothing shared with you yet" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Shared with you, before anyone shares.">Your own project sits on its shelf; “Shared with you” keeps its place in ghost cards and names who fills it. Nothing to do here, so there's no button.</Note>}>
            <Window tabs={[TABS.home, TABS.studio]} activeTab="home">
              <Canvas>
                <Home compact target="Studio site" starters={[
                  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                  { t: "An onboarding flow", l: "three calm steps", art: "onb" },
                  { t: "A mobile detail", l: "for the Homepage", art: "mobile" },
                ]} />
                <div className="es-shelf es-shelves">
                  <Shelf title="Your projects" where={<><Icon name="cloud" size={13} />cloud.maude.sh</>}>
                    <div className="es-projrow">
                      <span className="k-project es-proj">
                        <span className="k-stack"><Thumb art="home" /><Thumb art="price" /><Thumb art="onb" /></span>
                        <span className="k-project-txt"><strong>Studio site</strong><span>4 canvases · Tereza, 2 min ago</span></span>
                        <Avatar ini="S" tone="yellow" size="sm" />
                      </span>
                    </div>
                  </Shelf>
                  <Shelf title="Shared with you">
                    <div className="es-shelf-row">
                      <GhostCards n={3} />
                      <Empty align="left" title="Nothing shared with you yet.">
                        When Tereza or Jonas share a project with you, it shows up here.
                      </Empty>
                    </div>
                  </Shelf>
                </div>
              </Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-project-new" label="4 · A new project with no canvases" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="An empty project asks for its first canvas.">The panel says what's missing in its own words; the canvas offers the prompt and the plain way out — an empty canvas, ⌘N. No toolbar yet: there's nothing to draw on.</Note>}>
            <Window tabs={[TABS.studio, PORTFOLIO]} activeTab={1}>
              <Canvas>
                <Empty size="canvas" spot="ai" land className="es-center es-center--panel" title="Portfolio 2026 has no canvases yet."
                  action={<span className="btn btn--ghost btn--sm">Start with an empty canvas<span className="es-keys">⌘N</span></span>}
                  chips={
                    <span className="island island--pad es-askbox">
                      <span className="ask k-ask-lg"><span className="k-ask-in k-ask-ph">A one-page portfolio with six projects, calm and light</span><span className="send"><Spark size={14} color="var(--spark-fg)" /></span></span>
                    </span>
                  }>
                  Describe the first one and AI drafts it — or start blank.
                </Empty>
              </Canvas>
              <ProjectPill project="Portfolio 2026" />
              <PanelShell find={false} foot="Folders appear when you make one.">
                <p className="island-title k-cp-t">Portfolio 2026<span className="k-cp-tc">0 canvases</span></p>
                <Empty glyph="file" title="No canvases yet." className="es-e--inpanel">Each canvas holds as many artboards as you like.</Empty>
                <span className="row-item k-cp-new"><span className="k-cp-plus"><Icon name="plus" size={14} /></span>New canvas</span>
              </PanelShell>
              <ShareCluster mode="edit" people={[]} status="local" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-canvas-ai" label="5 · A new canvas — online, AI ready" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="The CONTRACT line, with a drop of spring.">Spot art and the rounded face say this is a beginning, not a gap; the stickies land once on the DS spring (frames in 6). Ask AI is the one spark button; drawing is the toolbar right under it.</Note>}>
            <Window tabs={STUDIO_TABS} activeTab={0}>
              <Canvas>
                <Empty size="canvas" spot="canvas" land className="es-center es-center--panel" title="Your canvas is ready."
                  action={<AskBtn keys="⌘/">Ask AI</AskBtn>}>
                  Ask AI for a first draft, or start drawing.
                </Empty>
              </Canvas>
              <ProjectPill project="Studio site" canvas="About us" />
              <CanvasesPanel project="Studio site" count={5} selected="About us" items={[...STUDIO, { name: "About us", art: "blank", meta: "now" }]} />
              <ShareCluster mode="edit" people={["tereza"]} />
              <ZoomUndo zoom={100} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-landing" label="6 · How the empty canvas arrives — one drop of spring" width={W} height={540} fixed>
          <Closeup title="The one playful beat: the stickies land, the words don't." note={<Note n={6} title="Spring is for playful moments only.">--dur-spring · --ease-spring on the spot's stickies, nothing else — the page frame, the words and Ask AI are there from the first frame. With reduced motion every duration is 1 ms, so frame 4 shows at once.</Note>}>
            <div className="es-film">
              {FRAMES.map((f, i) => (
                <figure key={f.ms} className="es-fr">
                  <div className="es-fr-stage">
                    <Spot name="canvas" w={216} frame={f.ms} />
                    <p className="es-sit">Your canvas is ready.</p>
                    <span className="btn btn--spark btn--sm es-ask es-fr-ask"><Spark size={10} color="var(--spark-fg)" />Ask AI</span>
                  </div>
                  <figcaption className="es-fr-c"><span className="es-fr-n">{i + 1}</span><span><strong>{f.t}</strong> {f.d}</span></figcaption>
                </figure>
              ))}
              <figure className="es-fr es-fr--curve">
                <div className="es-fr-stage es-fr-stage--curve">
                  <SpringCurve />
                  <span className="es-curve-l"><span>--ease-spring</span><span>420 ms</span></span>
                </div>
                <figcaption className="es-fr-c"><span className="es-fr-n es-fr-n--dot" /><span><strong>The curve.</strong> Dots mark the first sticky at each frame — one small overshoot, then rest.</span></figcaption>
              </figure>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="es-canvas-three" label="7 · New canvas — AI ready · offline · AI not connected yet" width={W} height={900} fixed>
          <Closeup title="One empty canvas, three situations. The line and Ask AI stay the same — only what happens next moves." note={<Note n={7} title="Ask AI always works.">Offline, the prompt waits in line and the canvas says when AI is back. Not connected yet, the first send asks once to connect a Claude account, then the waiting prompt runs.</Note>}>
            <div className="es-trio">
              <Col label="Online, AI ready">
                <MiniCanvas status="saved">
                  <Empty size="canvas" spot="canvas" spotW={200} className="es-mini-e" title="Your canvas is ready." action={<AskBtn keys="⌘/">Ask AI</AskBtn>}>
                    Ask AI for a first draft, or start drawing.
                  </Empty>
                </MiniCanvas>
                <p className="es-then">Then, after you send</p>
                <AiSlice>
                  <div className="k-ai-working"><span className="k-ai-wspark motion-soft"><Spark size={12} /></span><span className="k-ai-wtxt">Drafting About us…</span></div>
                </AiSlice>
              </Col>
              <Col label="Offline">
                <MiniCanvas status="offline">
                  <Empty size="canvas" spot="canvas" spotW={200} quiet className="es-mini-e" title="Your canvas is ready." action={<AskBtn keys="⌘/">Ask AI</AskBtn>}>
                    Ask AI for a first draft, or start drawing.<br /><span className="es-off-line"><Icon name="offline" size={13} />AI is back when this Mac is online.</span>
                  </Empty>
                </MiniCanvas>
                <p className="es-then">Then, after you send</p>
                <AiSlice>
                  <span className="es-queued"><Icon name="clock" size={12} />Queued — sends when this Mac is online.</span>
                </AiSlice>
              </Col>
              <Col label="AI not connected yet">
                <MiniCanvas status="saved">
                  <Empty size="canvas" spot="canvas" spotW={200} className="es-mini-e" title="Your canvas is ready." action={<AskBtn keys="⌘/">Ask AI</AskBtn>}>
                    Ask AI for a first draft, or start drawing.
                  </Empty>
                </MiniCanvas>
                <p className="es-then">Then, the first time you send — once</p>
                <ConnectSheet inline style={{ width: "100%" }} />
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="es-artboard-new" label="8 · Empty artboard after “New artboard”" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="A fresh artboard, and its empty Layers.">The hint sits on the artboard itself and leaves the moment you draw. Layers says what will appear there. The inspector came with the selection, as always.</Note>}>
            <Window tabs={STUDIO_TABS} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={320} y={100} w={420} h={262}><HeroMock /></Artboard>
                <Artboard label="Tablet" kind="web" x={780} y={100} w={262} h={375} selected size="834 × 1194" page={false}>
                  <div className="es-newab" />
                </Artboard>
                <Artboard label="Mobile" kind="web" x={320} y={420} w={130} h={281}><PhoneMock title="Calm software" tone="sky" /></Artboard>
                <Empty className="es-abhint" title="Empty artboard." chips={<AskBtn keys="⌘/">Ask AI to fill Tablet</AskBtn>}>
                  Draw a frame with <Kbd>F</Kbd>, place an image <Kbd>I</Kbd> or a component <Kbd>⇧I</Kbd>, or let AI start it from Desktop.
                </Empty>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelShell tab="layers">
                <p className="island-title k-cp-t">Tablet</p>
                <Empty glyph="layers" title="No layers on Tablet yet." className="es-e--inpanel">Anything you draw or drop on it shows up here, in order.</Empty>
              </PanelShell>
              <ShareCluster mode="edit" people={["tereza"]} />
              <Inspector title="Tablet" rows={[
                ["Preset", <InSelect value="Tablet" />],
                ["Size", <InSize w={834} h={1194} />],
                ["Fill", <InFill name="White" />],
                ["Clip content", <InSwitch on />],
              ]} />
              <ZoomUndo zoom={31} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Panels ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="panels" title="Panels with nothing in them yet" subtitle="Each panel at its real size — same three parts, sat in the upper third; no button when there's nothing to do">
        <DCArtboard id="es-panels-canvas" label="9 · Canvases folder · Comments · all resolved · Version history" width={W} height={700} fixed>
          <Closeup title="Organising and reviewing — before there's anything to organise or review." note={<Note n={9} title="Reassure where nothing is needed.">An empty folder offers to fill itself; Comments teaches the C key in the sentence; “All done.” is the one place that celebrates — and the Resolved tab already holds the threads; Version history has nothing to do, so it has no button.</Note>}>
            <div className="es-row4">
              <Col label="Canvases — an empty folder" w={248}>
                <PanelShell className="es-rel es-h500">
                  <p className="island-title k-cp-t">Alligators brand<span className="k-cp-tc">{ALLIGATORS_COUNT} canvases</span></p>
                  <FolderRow name="2026" count={ALLIGATORS_FOLDERS[0].count} />
                  <FolderRow name="2027" count={0} open current />
                  <Empty title="Nothing in 2027 yet." className="es-e--fold" action={<span className="row-item es-inrow"><span className="k-cp-plus"><Icon name="plus" size={14} /></span>New canvas in 2027</span>}>
                    Drag canvases in, or start one here.
                  </Empty>
                  {ALLIGATORS_FOLDERS.slice(1).map((f) => <FolderRow key={f.name} name={f.name} count={f.count} />)}
                </PanelShell>
              </Col>
              <Col label="Comments — none yet" w={280}>
                <SidePanel title="Comments" className="es-rel es-h500">
                  <Empty spot="comment" spotW={168} title="No comments on Homepage yet." action={<span className="btn btn--ghost btn--sm"><Icon name="share" size={14} />Share for feedback</span>}>
                    Press <Kbd>C</Kbd>, then click anywhere on the canvas to leave one.
                  </Empty>
                </SidePanel>
              </Col>
              <Col label="Comments — all resolved" w={280}>
                <SidePanel title="Comments" className="es-rel es-h500 es-sp--party">
                  <span className="seg k-seg es-sp-seg"><span className="k-seg-b" aria-pressed="true">Open 0</span><span className="k-seg-b">Mine 0</span><span className="k-seg-b">Resolved 4</span></span>
                  <Confetti id="es-confetti-done" shift={[60, 100]} />
                  <Empty spot="done" spotW={168} land className="es-e--done" title="All done.">
                    Every comment on Pricing is resolved. They stay under Resolved, with their replies.
                  </Empty>
                </SidePanel>
              </Col>
              <Col label="Version history — before the first change" w={280}>
                <SidePanel title="Version history" className="es-rel es-h500">
                  <span className="row-item es-vh-now"><span className="es-vh-dot" /><span className="es-vh-txt"><strong>Now</strong><span>About us · made by You, 1 min ago</span></span></span>
                  <Empty glyph="history" title="Versions appear here as you work.">
                    Every change is kept on its own. There's nothing to save.
                  </Empty>
                </SidePanel>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="es-panels-make" label="10 · AI chat · Assets · Exports · Trash" width={W} height={700} fixed>
          <Closeup title="Making and keeping — before the first chat, image, export or move to the trash." note={<Note n={10} title="Suggestions fit the canvas; Trash has nothing to ask.">AI's chips are written for Pricing, as things you'd say. Assets — the left panel's third tab — is a drop zone with one AI chip. Exports and Trash say what will land there — Trash keeps things until you clear them out.</Note>}>
            <div className="es-row4">
              <Col label="AI chat panel — no chats yet" w={320}>
                <div className="island island--pad k-ai es-rel es-h500 es-ai">
                  <div className="k-ai-hd">
                    <Spark size={14} />
                    <span className="k-ai-name">AI</span>
                    <span className="icon-btn k-icon-sm"><Icon name="plus" size={14} /></span>
                    <span className="icon-btn k-icon-sm"><Icon name="chevron" size={14} /></span>
                  </div>
                  <Empty spot="ai" spotW={168} title="Ask about Pricing." chips={<><Sugg>Add a yearly toggle</Sugg><Sugg>Write three FAQ answers</Sugg><Sugg>Make a dark version</Sugg></>}>
                    AI sees what you've selected, so “make this calmer” just works.
                  </Empty>
                  <div className="ask k-ask">
                    <span className="chip chip--accent k-selchip">◆ Whole canvas</span>
                    <span className="k-ask-in k-ask-ph">Ask AI about Pricing…</span>
                    <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
                  </div>
                </div>
              </Col>
              <Col label="Left panel › Assets — nothing imported" w={280}>
                <CanvasesPanel project="Studio site" tab="assets" style={CP_CLOSEUP} assets={
                  <div className="es-drop">
                    <Empty spot="image" spotW={168} title="No images or footage yet." chips={<AskBtn>Generate an image</AskBtn>}>
                      Drop photos, logos, video or music here — or anywhere on the canvas.
                    </Empty>
                  </div>
                } />
              </Col>
              <Col label="Exports — none yet" w={280}>
                <SidePanel title="Exports" className="es-rel es-h500">
                  <Empty glyph="export" title="No exports yet." action={<span className="btn btn--ghost btn--sm"><Icon name="export" size={14} />Export…<span className="es-keys">⇧⌘E</span></span>}>
                    Every export of Studio site lands here, ready to save again.
                  </Empty>
                </SidePanel>
              </Col>
              <Col label="Trash — empty" w={280}>
                <SidePanel title="Trash" back chip="Studio site" className="es-rel es-h500">
                  <Empty glyph="trash" title="Trash is empty.">
                    Canvases and artboards you move to the trash wait here until you clear them out.
                  </Empty>
                </SidePanel>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="es-timeline" label="11 · Timeline on a video artboard with no clips" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="The timeline arrives with the video artboard — empty, but pointed.">Selecting a video artboard summons it. The track itself is the drop zone; the one AI chip offers to cut from footage the project already has.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Story 9:16 · Zapiš se" kind="digital" x={380} y={84} w={150} h={267}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
                <Artboard label="Reels · nábor 2027" kind="video" x={580} y={84} w={250} h={444} selected size="1080 × 1920" page={false}>
                  <div className="es-newab es-newab--video"><span><Icon name="video" size={22} />9:16 · 0:00</span></div>
                </Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="video-nabor" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster mode="edit" people={["tereza", "jonas"]} />
              <Inspector title="Reels · nábor 2027" kind="Video" rows={[
                ["Preset", <InSelect value="Reels 9:16" />],
                ["Size", <InSize w={1080} h={1920} />],
                ["Length", <span className="es-ro">Set by its clips</span>],
                ["Frame rate", <InSelect value="30 fps" />],
              ]} />
              <EmptyTimeline />
              <ZoomUndo zoom={23} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Search ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="search" title="Search that finds nothing" subtitle="A typo in ⌘K, Search with nothing recent, 247 assets with no match, a word the big project doesn't use, a filter that hides every artboard">
        <DCArtboard id="es-search-k" label="12 · ⌘K — nothing called “pricng”" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="The CONTRACT line, then the closest match.">“pricng” finds nothing, so Search says so word for word, offers Pricing as the likely meaning (↵ opens it) and keeps Ask AI one row below.</Note>}>
            <Window tabs={STUDIO_TABS} activeTab={0}>
              <Canvas><HomepageBoards dx={-40} /></Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster mode="edit" people={["tereza"]} />
              <ZoomUndo zoom={33} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Veil />
              <NoResultsPalette />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-search-more" label="13 · ⌘K with nothing recent · Assets search with no hits" width={W} height={720} fixed>
          <Closeup title="Two more misses: Search on day one, and 247 assets without the one you typed." note={<Note n={13} title="An empty list still points somewhere.">On a new Mac, Search has no recents, so it says so in one line and lists where to start — every hidden tool is a word away. In Assets, search reads names and tags; finding what's in the pictures is an opt-in, once per project, on your Claude account.</Note>}>
            <div className="es-duo">
              <Col label="Search (⌘K) — nothing opened yet" w={580}>
                <NoRecentsPalette />
              </Col>
              <Col label="Left panel › Assets — a search with no hits" w={300}>
                <CanvasesPanel project="Alligators brand" tab="assets" style={{ ...CP_CLOSEUP, height: 460 }} foot="Searched 247 assets — names and tags" assets={
                  <>
                    <span className="k-find k-find--on"><Icon name="search" size={14} /><span className="k-find-q">logo bílé<i className="k-caretline" /></span><span className="k-find-x"><Icon name="close" size={10} /></span></span>
                    <Empty spot="none" spotW={150} className="es-e--assets" title={<>Nothing called <span className="es-q">“logo bílé”</span>.</>}
                      chips={<AskBtn>Let AI describe your pictures</AskBtn>}
                      action={<span className="es-fine es-fine--c">So search finds what's in them. Once for Alligators brand, on your Claude account.</span>}>
                      Try another word — search reads names and tags.
                    </Empty>
                  </>
                } />
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="es-search-panel" label={`14 · Panel search — ${ALLIGATORS_COUNT} canvases, none match`} width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Words differ; AI can bridge them.">The project calls it “sponsors”, you typed “sponzoři”. Name search can't know that — so the one next step is AI, which looks inside canvases. The foot says how much was searched.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><KampanBits /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel project="Alligators brand" search="sponzoři 2024" foot={`Searched ${ALLIGATORS_COUNT} canvases and their artboards`} empty={
                <span className="es-pe">
                  <Spot name="none" w={176} />
                  <span className="es-sit">Nothing called <span className="es-q">“sponzoři 2024”</span>.</span>
                  <span className="es-next">Try another word, or ask AI to find it.</span>
                  <span className="es-acts"><AskBtn>Ask AI to find it</AskBtn></span>
                </span>
              } />
              <ShareCluster mode="edit" people={["tereza", "jonas"]} />
              <ZoomUndo zoom={26} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-filter" label="15 · A filter that hides every artboard" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="Say which filter, and undo it in one click.">The Print filter came along from Combine-kampan. Combine-invite has no print artboards, so the list says exactly that; the artboards stay on the canvas, only dimmed.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Pozvánka · post 4:5" kind="digital" x={340} y={110} w={232} h={290} dim><GatorMock variant="invite" /></Artboard>
                <Artboard label="Pozvánka · story 9:16" kind="digital" x={612} y={110} w={163} h={290} dim><GatorMock variant="reel" headline="COMBINE" sub="So 14. 3." /></Artboard>
                <Artboard label="Pozvánka · FB event 1.91:1" kind="digital" x={815} y={110} w={382} h={200} dim><GatorMock variant="web" headline="COMBINE 14. 3." sub="Kraví hora · 9:00" /></Artboard>
                <Artboard label="Pozvánka · WhatsApp 1:1" kind="digital" x={815} y={360} w={200} h={200} dim><GatorMock variant="social" headline="ZAPIŠ SE" sub="do 10. 3." /></Artboard>
                <Artboard label="E-mail · pozvánka pro rodiče hráčů" kind="web" x={340} y={450} w={435} h={272} dim><GatorMock variant="web" headline="Pozvánka pro rodiče" sub="Combine 2026 · So 14. 3." /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-invite" />
              <PanelShell tab="layers" className="es-filterpanel">
                <KindChips counts={{ all: 5, digital: 4, web: 1, print: 0, video: 0 }} on="print" />
                <p className="island-title k-cp-t">Combine-invite</p>
                <Empty glyph="print" title="No print artboards in Combine-invite." action={<span className="btn btn--ghost btn--sm"><Icon name="close" size={12} />Clear filter</span>}>
                  The Print filter is still on from Combine-kampan. All 5 artboards here are digital or web.
                </Empty>
              </PanelShell>
              <ShareCluster mode="edit" people={["tereza", "jonas"]} />
              <ZoomUndo zoom={30} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Edge cases ────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When it's not really empty" subtitle="View-only, still arriving, offline and never downloaded, everything in the trash, a chat search, a team of one">
        <DCArtboard id="es-viewer" label="16 · A shared canvas you can comment on, not edit" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Can comment: Hand and Comment.">Preview's toolbar, cut to what they may do — no other annotation tools, no editing tools, no AI chat panel, as in 04. Ask to edit goes to the owner.</Note>}>
            <Window tabs={[TABS.studio, { ...TABS.alligators, account: "Alligators — can comment" }]} activeTab={1}>
              <Canvas>
                {UNI.map((u, i) => (
                  <Artboard key={u.label} label={u.label} kind="digital" x={110 + (i % 3) * 328} y={130 + Math.floor(i / 3) * 229} w={300} h={169}><UniBoard {...u} /></Artboard>
                ))}
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Uniformy-2027" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="viewing" canEdit={false} access="Can comment" />
              <SidePanel title="Comments" className="es-vcm">
                <Empty spot="comment" spotW={150} title="No comments on Uniformy-2027 yet.">
                  Press <Kbd>C</Kbd>, then click anywhere on the canvas to leave one. Jonas and Tereza see it right away.
                </Empty>
              </SidePanel>
              <div className="island k-uz"><span className="btn btn--ghost btn--sm k-zoom">24%</span></div>
              <Toolbar mode="annotate" only={["hand", "comment"]} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-arriving" label="17 · The cloud copy hasn't arrived yet" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Arriving is not empty.">On a new Mac, Alligators brand comes down in the order you'll need it. Names and sizes are known first, so the panel lists every canvas by name and the canvas shows its shape — never an “empty project”.</Note>}>
            <Window tabs={[TABS.studio, { ...TABS.alligators, syncing: true }]} activeTab={1}>
              <Canvas>
                <Artboard label="Web · STAŇ SE GATOREM" kind="web" x={330} y={110} w={460} h={288}><GatorMock variant="web" /></Artboard>
                <SkelBoard label="Post 1:1 · Combine 2026" kind="digital" x={830} y={110} w={230} h={230} />
                <SkelBoard label="Story 9:16 · Zapiš se" kind="digital" x={1100} y={110} w={130} h={230} />
                <SkelBoard label="A4 · plakát" kind="print" x={830} y={400} w={200} h={283} />
                <SkelBoard label="16:9 · teaser" kind="video" x={330} y={450} w={320} h={180} />
                <span className="es-arrive-tag"><Icon name="sync" size={12} />4 artboards on their way</span>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelShell foot={<span className="es-progress"><span>Getting Alligators brand · 41 of {ALLIGATORS_COUNT} canvases</span><span className="es-bar"><i style={{ width: "44%" }} /></span></span>}>
                <p className="island-title k-cp-t">Alligators brand<span className="k-cp-tc">{ALLIGATORS_COUNT} canvases</span></p>
                <GatorTree
                  item={(it, d) => ARRIVED.includes(it.name)
                    ? <CanvasRowLocal name={it.name} art={it.art} depth={d} current={it.name === "Combine-kampan"} kinds={it.name === "Combine-kampan" ? ["print", "video"] : it.kinds} />
                    : <ArrivingRow name={it.name} depth={d} kinds={it.kinds} />}
                  folder={(f, d) => d === 0 && f.name !== "2026" ? <ArrivingRow key={f.name} name={f.name} folder count={f.count} /> : undefined}
                />
              </PanelShell>
              <ShareCluster mode="edit" people={["tereza", "jonas"]} status="syncing" />
              <ZoomUndo zoom={26} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-offline-uncached" label="18 · Offline, and this canvas was never downloaded" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Plain words, what's safe, what works now.">The canvas isn't broken and nothing is lost — it just isn't on this Mac yet, so there's no toolbar. Canvases that are here stay bright in the panel; one button narrows the list to them.</Note>}>
            <Window tabs={[TABS.studio, TABS.alligators]} activeTab={1}>
              <Canvas>
                <Empty size="canvas" glyph="offline" className="es-center es-center--panel es-e--plain" title="Combine-video-AI isn't on this Mac yet."
                  action={<span className="btn btn--sm">Show canvases on this Mac</span>}>
                  It opens by itself when this Mac is back online. Nothing in it is lost — the cloud copy is safe.
                </Empty>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-video-AI" />
              <PanelShell>
                <p className="island-title k-cp-t">Alligators brand<span className="k-cp-tc">{ALLIGATORS_COUNT} canvases</span></p>
                <GatorTree item={(it, d) => {
                  const away = NOT_ON_THIS_MAC.includes(it.name);
                  return <CanvasRowLocal name={it.name} art={it.art} depth={d} dim={away} current={it.name === "Combine-video-AI"} kinds={it.name === "Combine-kampan" ? ["print", "video"] : it.kinds} meta={away ? <Icon name="cloud" size={12} /> : undefined} />;
                }} />
              </PanelShell>
              <ShareCluster mode="edit" people={[]} status="offline" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-all-trashed" label="19 · Every artboard moved to the trash" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Nothing is deleted — the outlines stay.">LetakA6 keeps the places its four artboards held; the bracket shows where Restore puts them back. Trash and Version history keep them either way.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <GhostBoard label="A · přední FLAG" x={330} y={120} w={180} h={254} />
                <GhostBoard label="B · zadní FLAG" x={540} y={120} w={180} h={254} />
                <GhostBoard label="C · přední TACKLE" x={750} y={120} w={180} h={254} />
                <GhostBoard label="D · zadní TACKLE" x={960} y={120} w={180} h={254} />
                <RestoreBracket xs={[420, 630, 840, 1050]} top={374} bar={404} card={{ x: 735, y: 432 }} />
                <Empty size="canvas" glyph="trash" className="es-trashcard" title="LetakA6 has no artboards left."
                  action={<span className="btn btn--primary btn--sm">Restore 4 artboards</span>}>
                  Jonas moved all four to the trash 10 min ago. Restore puts them back where they were; every earlier version is in Version history too.
                </Empty>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="LetakA6" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster mode="edit" people={["jonas"]} />
              <ZoomUndo zoom={28} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="es-edge-panels" label="20 · Chat search with no hits · a team of one" width={W} height={720} fixed>
          <Closeup title="Two quiet corners: a chat search that misses, and a project that is still just you." note={<Note n={20} title="Same three parts, even here.">The chat search says what it searched and offers a new chat about it. The Share sheet turns an empty people list into the reason to invite — Invite is the primary, Copy link stays in the link row.</Note>}>
            <div className="es-duo">
              <Col label="AI chat panel › Chats — search, no hits" w={340}>
                <div className="island es-chats es-rel">
                  <div className="es-sp-hd">
                    <span className="es-sp-back"><Icon name="chevron" size={12} /></span>
                    <strong>Chats</strong>
                    <span className="chip es-sp-chip">Alligators brand</span>
                    <span className="icon-btn k-icon-sm es-sp-x"><Icon name="plus" size={14} /></span>
                  </div>
                  <span className="k-find k-find--on"><Icon name="search" size={14} /><span className="k-find-q">tabulka výsledků<i className="k-caretline" /></span><span className="k-find-x"><Icon name="close" size={10} /></span></span>
                  <Empty glyph="spark" title={<>No chat mentions <span className="es-q">“tabulka výsledků”</span>.</>} chips={<AskBtn>Start a chat about it</AskBtn>}>
                    Searched 41 chats in Alligators brand — titles and every message.
                  </Empty>
                  <p className="es-sp-foot">41 chats · kept with the project</p>
                </div>
              </Col>
              <Col label="Share sheet — only you on the project" w={460}>
                <div className="k-dialog es-share es-rel">
                  <p className="k-dialog-t">Invite people to Studio site</p>
                  <div className="es-share-in">
                    <span className="input es-share-field">Email, comma-separated</span>
                    <span className="select es-share-role">Can edit<Icon name="chevron" size={12} /></span>
                  </div>
                  <div className="es-share-people">
                    <span className="es-share-row"><Avatar who="you" /><span className="es-share-who"><strong>You</strong></span><span className="es-share-r">Owner</span></span>
                    <Empty glyph="people" align="left" className="es-e--share" title="Only you on Studio site so far.">
                      People you invite see Studio site right away and can edit, comment and download, or look only.
                    </Empty>
                  </div>
                  <div className="es-share-link">
                    <span className="es-share-lic"><Icon name="link" size={14} /></span>
                    <span className="es-share-lt"><strong>Anyone with the link</strong><span>Can view — look only</span></span>
                    <span className="btn btn--sm">Copy link</span>
                  </div>
                  <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Invite</span></div>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
