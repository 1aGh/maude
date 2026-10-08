/**
 * @canvas      12 Import and Assets — getting pictures, footage, sound, Figma files and a brand into a project
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ia-drop-photos | ia-placed | ia-more-ways |
 *              ia-assets-panel | ia-assets-keys | ia-assets-browse | ia-assets-find | ia-assets-tidy | ia-asset-details |
 *              ia-photo-inspector | ia-photo-steps |
 *              ia-gen-ask | ia-gen-placed |
 *              ia-figma-sheets | ia-figma-arrived | ia-figjam |
 *              ia-brand-steps | ia-brand |
 *              ia-missing | ia-missing-gone | ia-edges |
 *              ia-advanced
 * @brief       "…co tě ještě napadne" — Import & Assets: drag photos in, the asset library (247 assets, footage,
 *              music), import from Figma, import a brand (logo → palette), light photo editing (background
 *              removal), AI-generated images, broken or missing assets. Drawn on Alligators brand (Czech) and
 *              Studio site.
 *
 * Convention (same as 01): every app artboard is a <Stage> — a 1440 × 900 window + the note strip
 * (artboard 1440 × 980). Close-ups are 1440 wide, a heading on top and the note at the foot. Chrome comes
 * from ./_kit — including the Assets tab: kit CanvasesPanel tab="assets" + the `assets` body slot
 * (CONTRACT §7). The local pieces use the `ia-` prefix: photo art (Pic — the user's pictures, pinned light
 * like every *Mock), the Assets tab body, asset tiles, the browse view, the asset details view, the photo
 * inspector, the generate chat, Figma sheets, the import summary, the waiting / missing placeholders.
 *
 * CONTRACT §7 rules drawn here: Assets = the left panel's third tab (Menu › View › Assets, ⌘K); every tile
 * places by keyboard (↵ on a selected tile → the selected artboard; Place in the tile menu); search covers
 * names + tags, and what's IN pictures only after a once-per-project opt-in (names only when AI isn't
 * connected); Figma frames arrive as Figma's exact picture, Make editable needs Figma Dev Mode on a paid
 * seat; a file on someone's device that hasn't synced = "Waiting for Jonas's Mac" (quiet), only a file no
 * device has = Missing + Relink…; photo edits apply to one use, "Apply to every use" is explicit.
 *
 * Ground truth (apps/studio + plugins/design): files are stored content-addressed as assets/<sha8>.<ext>
 * (same bytes = one file, so a duplicate drop reuses); photo edits are a non-destructive <sha8>.photo.json
 * sidecar (background removal runs on this Mac, the cut-out is its own PNG); footage gets
 * <sha8>.footage.json (what AI saw), generated music <sha8>.audio.json (prompt + provider). Figma pages
 * import render-first; `--explode` (Make editable) needs the Figma desktop app in Dev Mode on a Dev/Full
 * seat. NOTE: per-use photo edits (CONTRACT §7) mean the sidecar is keyed by use — drawn in Advanced as a
 * proposal; today's photo-adjust.sh writes one set of edits per asset.
 * Storage words shared with 06 Advanced: every file is named by its fingerprint, originals too — combine-40yd.mov
 * (412 MB) is assets/7c40e2b1.mov; footage/ keeps only the light copies the video cut plays (assets/footage/7c40e2b1.mp4).
 * (06 ad-sync-wait still lists "assets/footage/combine-40yd.mov · 412 MB" — it should read "assets/7c40e2b1.mov · 412 MB".)
 * Photos: IMG_2231.jpg is the night touchdown shot (drop, library, details, duplicate drop); the #27 Kilián portrait
 * in MVP zápasu is IMG_2247.jpg (keyboard place, photo inspector, per-use edits, Advanced).
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./12 Import and Assets.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, Canvas, CanvasesPanel, CommentPin, GatorMock, HeroMock, Icon, InSeg, InSwitch, Kbd, Menu, Note, PanelIcon,
  ProjectMenu, ProjectPill, Selection, ShareCluster, Spark, Stage, StatusWord, Sticky, TABS, Thumb, Toast, Toolbar, V2, Veil,
  VideoFrameMock, Window, ZoomUndo,
} from "./_kit";
import type { CanvasItem, Folder } from "./_kit";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];

/* ═══ The user's pictures — drawn in canvas colours, pinned light (like every kit *Mock) ═════════════ */

type PicV =
  | "td" | "huddle" | "tackle" | "dron" | "crowd" | "portrait" | "kick" | "night" | "cutout" | "shot"
  | "g1" | "g2" | "g3" | "g4";

/** One photo or video still. Six generic layers; each variant places them (see .ia-pic--* in the CSS). */
function Pic({ v, className = "", style, children }: { v: PicV; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const gen = v[0] === "g" && v.length === 2;
  return (
    <span className={`ia-pic ia-pic--${v}${gen ? " ia-pic--gen" : ""} maude-v2 k-fixed ${className}`} data-theme="light" style={style} aria-hidden="true">
      <i className="ia-pa" /><i className="ia-pb" /><i className="ia-pc" /><i className="ia-pd" /><i className="ia-pe" /><i className="ia-pf" />
      {v === "portrait" || v === "cutout" ? <b className="ia-pnum">27</b> : null}
      {children}
    </span>
  );
}

type LogoV = "roundel" | "head" | "qr" | "word" | "studio";
/** A logo or icon on the transparency checker. */
function Logo({ v, className = "" }: { v: LogoV; className?: string }) {
  return (
    <span className={`ia-logo ia-logo--${v} maude-v2 k-fixed ${className}`} data-theme="light" aria-hidden="true">
      {v === "word" ? <b>ALLIGATORS</b> : v === "studio" ? <><i /><b>studio brno</b></> : <><i /><i /></>}
    </span>
  );
}

/** A sound as a waveform — bar heights in %, never a file name first. */
const WAVE_A = [30, 52, 40, 70, 88, 64, 46, 80, 96, 72, 58, 84, 62, 40, 66, 90, 74, 50, 36, 60, 82, 68, 44, 30];
function Wave({ bars = WAVE_A }: { bars?: number[] }) {
  return <span className="ia-wave" aria-hidden="true">{bars.map((b, i) => <i key={i} style={{ height: `${b}%` }} />)}</span>;
}

/* ═══ Alligators brand — the matchday canvas (social › matchday, 7 artboards) ═════════════════════════ */

/** "Fotky ze zápasu" — a 4:5 photo post: the score on top, six photo frames below. */
function MatchPost({ photos, uploading = [], drop = false }: { photos?: PicV[]; uploading?: number[]; drop?: boolean }) {
  const cells: (PicV | null)[] = photos ?? [null, null, null, null, null, null];
  return (
    <div className="ia-post ia-post--match">
      <div className="ia-post-band"><span>ZÁPAS · 27. 9.</span><strong>34 : 21</strong><span>vs. Prague Black Panthers</span></div>
      <div className="ia-post-grid" data-drop={drop ? "true" : undefined}>
        {cells.map((p, i) => (
          <span key={i} className={`ia-post-cell${p ? "" : " ia-post-cell--empty"}`}>
            {p ? <Pic v={p} className="ia-fill" /> : <Icon name="image" size={14} />}
            {uploading.includes(i) ? <span className="ia-up"><b style={{ width: i % 2 ? "38%" : "64%" }} /></span> : null}
          </span>
        ))}
      </div>
      <span className="ia-post-foot">BRNO ALLIGATORS</span>
    </div>
  );
}

/** "MVP zápasu" — one big photo of #27, a green band. `photo` = the picture in the frame (or empty). */
function MvpPost({ photo = "portrait", label = "MVP ZÁPASU", name = "#27 Kilián", bare = false }: { photo?: PicV | null; label?: string; name?: string; bare?: boolean }) {
  return (
    <div className={`ia-post ia-post--mvp${bare ? " ia-post--bare" : ""}`}>
      <div className="ia-post-photo">{photo ? <Pic v={photo} className="ia-fill" /> : <span className="ia-post-ph"><Icon name="image" size={18} /><span>Photo</span></span>}</div>
      <div className="ia-post-mvp"><strong>{label}</strong><span>{name}</span></div>
    </div>
  );
}

/** "Výsledek" — the score card. */
function ScorePost() {
  return (
    <div className="ia-post ia-post--score">
      <span className="ia-post-kicker">VÝHRA</span>
      <strong>34:21</strong>
      <span className="ia-post-vs">Alligators · Panthers</span>
      <span className="ia-post-badge" />
    </div>
  );
}

type Ab = { label: string; kind: "digital" | "video"; x: number; y: number; w: number; h: number; body: ReactNode; sel?: boolean; size?: string; dim?: boolean; aiMade?: boolean; aiWorking?: string };

/** matchday at 20 %: 4:5 1080 × 1350 → 216 × 270 · 1:1 → 216 × 216 · 9:16 → 216 × 384. `dx` pans the camera. */
function matchday(dx = 0, over: Partial<Record<string, Partial<Ab>>> = {}): Ab[] {
  const base: Ab[] = [
    { label: "Post 4:5 · Fotky ze zápasu", kind: "digital", x: 312, y: 112, w: 216, h: 270, body: <MatchPost /> },
    { label: "Post 4:5 · MVP zápasu", kind: "digital", x: 568, y: 112, w: 216, h: 270, body: <MvpPost /> },
    { label: "Post 1:1 · Výsledek", kind: "digital", x: 824, y: 112, w: 216, h: 216, body: <ScorePost /> },
    { label: "Story 9:16 · Gameday", kind: "digital", x: 1080, y: 112, w: 216, h: 384, body: <GatorMock variant="reel" headline="GAMEDAY" sub="So 15:00 · Kraví hora" /> },
    { label: "Post 4:5 · Gameweek 5", kind: "digital", x: 312, y: 438, w: 216, h: 270, body: <MvpPost photo={null} label="GAMEWEEK 5" name="So 4. 10. · 15:00" /> },
    { label: "Post 1:1 · Partneři", kind: "digital", x: 568, y: 438, w: 216, h: 216, body: <GatorMock variant="social" headline="DÍKY PARTNERŮM" sub="Sezóna 2026" /> },
    { label: "Reels 9:16 · Highlights", kind: "video", x: 824, y: 372, w: 216, h: 384, body: <VideoFrameMock vertical caption="TOUCHDOWN #27" time="0:04 / 0:20" /> },
  ];
  return base.map((a) => ({ ...a, x: a.x + dx, ...(over[a.label] ?? {}) }));
}
function Boards({ list }: { list: Ab[] }) {
  return (
    <>
      {list.map((a) => (
        <Artboard key={a.label} label={a.label} kind={a.kind} x={a.x} y={a.y} w={a.w} h={a.h} selected={a.sel} size={a.size} dim={a.dim} aiMade={a.aiMade} aiWorking={a.aiWorking} aiAt="below" aiCursor={false}>{a.body}</Artboard>
      ))}
    </>
  );
}

const SOCIAL: CanvasItem[] = [
  { name: "matchday", art: "gator-social", kinds: ["digital", "video"], people: ["tereza"] },
  { name: "score-mvp", art: "gator-numbers", kinds: ["digital"] },
  { name: "sponsors", art: "gator-poster", kinds: ["digital"] },
  { name: "gameweek-schedule", art: "gator-social", kinds: ["digital"] },
  { name: "video-hype", art: "gator-reel", kinds: ["video"] },
  { name: "video-recap", art: "video", kinds: ["video"] },
  { name: "video-touchdown", art: "video", kinds: ["video"] },
];
const GATOR_TREE: Folder[] = [
  { name: "2026", count: 16 },
  { name: "club-web", count: 9 },
  { name: "print", count: 6 },
  { name: "social", open: true, count: 31, items: SOCIAL },
  { name: "legacy", count: 27 },
];

/** Preview's annotation tools — a chrome given one of these is in Preview. */
const ANNOTATING = ["sticky", "comment", "marker", "arrow", "stamp", "section"];

/** The Alligators window chrome. `left`: the Canvases tab, the Assets tab (kit slot, body in `assets`), or folded.
    `extra` = an overlay that is NOT a panel slot (an import summary) — the folded spark (Ask AI) stays put.
    `tool`: an Edit tool (select, image …) keeps Edit; an annotation tool (sticky, comment …) puts the window in Preview —
    the cluster reads Preview and the toolbar is Preview's annotation toolbar (CONTRACT §2). */
function GatorChrome({ canvas = "matchday", left = "canvases", assets, assetsFoot = "247 assets · 1.4 GB", leftStyle, ai, insp, extra, tool = "select", zoom = 20, status = "saved", people = ["tereza", "jonas"] }: {
  canvas?: string; left?: "canvases" | "assets" | "folded"; assets?: ReactNode; assetsFoot?: ReactNode; leftStyle?: CSSProperties;
  ai?: ReactNode; insp?: ReactNode; extra?: ReactNode; tool?: string; zoom?: number | string;
  status?: "saved" | "syncing" | "offline" | "local"; people?: string[];
}) {
  return (
    <>
      <ProjectPill project="Alligators brand" canvas={canvas} />
      {left === "canvases" ? <CanvasesPanel project="Alligators brand" count={93} selected={canvas} folders={GATOR_TREE} />
        : left === "assets" ? <CanvasesPanel project="Alligators brand" tab="assets" assets={assets} foot={assetsFoot} style={leftStyle} />
        : <PanelIcon icon="panel-left" at="left" />}
      <ShareCluster people={people} status={status} mode={ANNOTATING.includes(tool) ? "preview" : "edit"} />
      {insp}
      <ZoomUndo zoom={zoom} />
      <Toolbar tool={tool} mode={ANNOTATING.includes(tool) ? "annotate" : "edit"} />
      {ai ?? <PanelIcon icon="spark" at="ai" />}
      {extra}
    </>
  );
}

/* ═══ Local pieces (kit candidates) ═══════════════════════════════════════════════════════════════════ */

/** Files dragged in from Finder — a small fanned stack and a count. Lives above the canvas, app scale. */
function DragStack({ x, y, pics, count, name }: { x: number; y: number; pics: PicV[]; count: number; name?: string }) {
  return (
    <span className="ia-drag" style={{ left: x, top: y }}>
      <span className="ia-drag-stack">
        {pics.slice(0, 3).reverse().map((p, i) => <Pic key={p + i} v={p} className={`ia-drag-card ia-drag-card--${i}`} />)}
        <span className="ia-drag-n">{count}</span>
      </span>
      {name ? <span className="ia-drag-name">{name}</span> : null}
      <svg className="ia-drag-cur" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill="var(--fg-0)" stroke="var(--bg-2)" strokeWidth="1" strokeLinejoin="round" /></svg>
      <span className="ia-drag-plus"><Icon name="plus" size={10} /></span>
    </span>
  );
}

/** The drop target: an azure outline over an artboard (or a frame) and a plain-words pill. */
function DropTarget({ x, y, w, h, children, frame = false }: { x: number; y: number; w: number; h: number; children: ReactNode; frame?: boolean }) {
  return (
    <span className={`ia-dropt${frame ? " ia-dropt--frame" : ""}`} style={{ left: x, top: y, width: w, height: h }}>
      <span className="ia-dropt-pill">{children}</span>
    </span>
  );
}

/** One asset tile: the picture first. The name shows on hover AND on keyboard focus (`focus`). */
type TileP = {
  v?: PicV; logo?: LogoV; dur?: string; ai?: boolean; hover?: ReactNode; focus?: ReactNode; dragging?: boolean; sel?: boolean; picked?: boolean;
  state?: "prep" | "local" | "up"; pct?: number; match?: string; seen?: { l: string; t: string; w: string; h: string }; className?: string;
};
function Tile({ v, logo, dur, ai, hover, focus, dragging, sel, picked, state, pct, match, seen, className = "" }: TileP) {
  return (
    <span className={`ia-tile${logo ? " ia-tile--logo" : ""}${dur ? " ia-tile--clip" : ""}${dragging ? " ia-tile--drag" : ""}${state ? ` ia-tile--${state}` : ""} ${className}`} data-sel={sel ? "true" : undefined} data-focus={focus ? "true" : undefined} data-picked={picked ? "true" : undefined}>
      {logo ? <Logo v={logo} className="ia-fill" /> : v ? <Pic v={v} className="ia-fill" /> : null}
      {seen ? <span className="ia-seen" style={{ left: seen.l, top: seen.t, width: seen.w, height: seen.h }} /> : null}
      {dur ? <span className="ia-tile-dur maude-v2 k-fixed" data-theme="light"><Icon name="play" size={8} />{dur}</span> : null}
      {ai ? <span className="ia-tile-ai" title="Made by AI"><Spark size={9} /></span> : null}
      {picked !== undefined ? <span className="ia-tile-pick">{picked ? <Icon name="check" size={10} /> : null}</span> : null}
      {state === "prep" ? <span className="ia-tile-st"><Icon name="sync" size={10} />{pct !== undefined ? `${pct} %` : "Preparing…"}</span> : null}
      {state === "local" ? <span className="ia-tile-st ia-tile-st--local"><Icon name="laptop" size={10} />On this Mac</span> : null}
      {state === "up" ? <span className="ia-up ia-up--tile"><b style={{ width: `${pct ?? 50}%` }} /></span> : null}
      {match ? <span className="ia-tile-match maude-v2 k-fixed" data-theme="light">{match}</span> : null}
      {hover ? <span className="ia-tile-tip">{hover}</span> : null}
      {focus ? <span className="ia-tile-tip ia-tile-tip--focus">{focus}</span> : null}
    </span>
  );
}

function SoundRow({ name, meta, ai, bars }: { name: string; meta: string; ai?: boolean; bars?: number[] }) {
  return (
    <span className="row-item ia-snd">
      <span className="ia-snd-play"><Icon name="play" size={10} /></span>
      <span className="ia-snd-txt"><span className="ia-snd-n">{name}</span><span className="ia-snd-m">{ai ? <><Spark size={9} />Made by AI · </> : null}{meta}</span></span>
      <Wave bars={bars} />
    </span>
  );
}

function GroupHead({ title, count, more = true }: { title: string; count: number | string; more?: boolean }) {
  return <p className="island-title ia-gh"><span>{title}</span><span className="ia-gh-n">{count}{more ? <Icon name="submenu" size={11} /> : null}</span></p>;
}

/** The body of the kit Assets tab (CanvasesPanel tab="assets"): search, kind + Not used filters, Generate and
    Add files…, then the grouped list. Search covers names and tags; "what's in pictures" is opt-in (CONTRACT §7). */
function AssetsBody({ query, kindsLabel = "All kinds", unused = false, children }: { query?: string; kindsLabel?: string; unused?: boolean; children: ReactNode }) {
  return (
    <>
      <span className={`k-find${query ? " k-find--on" : ""}`}>
        <Icon name="search" size={14} />
        {query ? <span className="k-find-q">{query}<i className="k-caretline" /></span> : <span className="k-find-q k-find-ph">Search assets</span>}
        {query ? <span className="k-find-x"><Icon name="close" size={10} /></span> : null}
      </span>
      <div className="ia-ap-bar">
        <span className="chip ia-ap-kinds">{kindsLabel}<Icon name="chevron" size={11} /></span>
        <span className={`chip${unused ? " chip--accent" : ""}`}>{unused ? <Icon name="check" size={11} /> : null}Not used</span>
        <span className="ia-ap-icons">
          <span className="icon-btn k-icon-sm ia-ap-gen" title="Generate an image"><Spark size={13} /></span>
          <span className="icon-btn k-icon-sm" title="Add files…"><Icon name="plus" size={14} /></span>
        </span>
      </div>
      <div className="ia-ap-list">{children}</div>
    </>
  );
}

/** The full library, grouped by kind — real Alligators counts (sidecars and captions are not assets). */
function Library({ dragging = false, hover = false, focus, selected = false }: { dragging?: boolean; hover?: boolean; focus?: ReactNode; /** the portrait tile selected, no focus tag (its menu is the one overlay) */ selected?: boolean }) {
  return (
    <>
      <GroupHead title="Photos" count={120} />
      <div className="ia-grid ia-grid--3">
        <Tile v="td" hover={hover ? <><strong>IMG_2231.jpg</strong>Used in 4 canvases</> : undefined} sel={hover} />
        <Tile v="portrait" dragging={dragging} focus={focus} sel={!!focus || selected} />
        <Tile v="huddle" />
        <Tile v="tackle" />
        <Tile v="crowd" />
        <Tile v="kick" />
      </div>
      <GroupHead title="Video" count={34} />
      <div className="ia-grid ia-grid--2">
        <Tile v="dron" dur="0:08" />
        <Tile v="night" dur="0:07" />
      </div>
      <GroupHead title="Sound" count={9} />
      <SoundRow name="Hype beat · 120 BPM" meta="0:15" ai />
      <GroupHead title="Logos & icons" count={66} />
      <div className="ia-grid ia-grid--3">
        <Tile logo="roundel" /><Tile logo="head" /><Tile logo="word" />
      </div>
      <GroupHead title="Generated" count={18} />
      <div className="ia-grid ia-grid--3">
        <Tile v="g1" ai /><Tile v="g2" ai /><Tile v="g3" ai />
      </div>
    </>
  );
}

/** A close-up copy of the kit Assets tab, sized to its column. */
const COL_PANEL: CSSProperties = { position: "relative", left: "auto", top: "auto", width: "100%", height: 660, maxHeight: "none" };

/** A toggle-less checkbox (static). */
function Check({ on = true }: { on?: boolean }) {
  return <span className="ia-cb" data-on={on ? "true" : undefined}>{on ? <Icon name="check" size={11} /> : null}</span>;
}

/** A sheet drawn in a close-up (static), or over a window (centred by the kit). */
function IaSheet({ title, children, actions, width = 420, flow = false, className = "", style }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; width?: number | string; flow?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={`k-dialog ia-sheet${flow ? " ia-flow" : ""} ${className}`} style={{ width, ...style }}>
      <p className="k-dialog-t">{title}</p>
      {children ? <div className="k-dialog-b ia-sheet-b">{children}</div> : null}
      {actions ? <div className="k-dialog-a">{actions}</div> : null}
    </div>
  );
}

/** The Advanced disclosure (kit look), open or closed, with a short hint of what's inside. */
function Adv({ hint, open = false, children }: { hint: string; open?: boolean; children?: ReactNode }) {
  return (
    <div className="k-adv ia-adv" data-open={open ? "true" : undefined}>
      <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{hint}</span></span>
      {open ? <div className="k-adv-body ia-adv-body">{children}</div> : null}
    </div>
  );
}
function ARow({ k, children, copy = false }: { k: string; children: ReactNode; copy?: boolean }) {
  return <span className="ia-arow"><span className="ia-arow-k">{k}</span><span className="ia-arow-v k-mono">{children}</span>{copy ? <span className="chip ia-copy">Copy</span> : null}</span>;
}

/** A labelled field inside a details view. */
function DRow({ k, children }: { k: string; children: ReactNode }) {
  return <span className="ia-drow"><span className="ia-drow-k">{k}</span><span className="ia-drow-v">{children}</span></span>;
}
function UsedRow({ art, canvas, board }: { art: "gator-social" | "gator-numbers" | "gator-web" | "video" | "gator-poster" | "gator-reel"; canvas: string; board?: string }) {
  return (
    <span className="row-item ia-used">
      <Thumb art={art} className="k-thumb--row" />
      <span className="ia-used-t"><span>{canvas}</span>{board ? <span className="ia-used-b">{board}</span> : null}</span>
      <Icon name="submenu" size={11} />
    </span>
  );
}

/** The details of one asset — opens in place of the list (back to Assets). */
function Details({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`island ia-dt ${className}`} style={style}>
      <div className="ia-dt-hd"><span className="ia-dt-back"><Icon name="chevron" size={12} />Assets</span><span className="icon-btn k-icon-sm"><Icon name="more" size={14} /></span></div>
      {children}
    </div>
  );
}

/** A slider row in the photo inspector. */
function Slider({ label, pct, value }: { label: string; pct: number; value: string }) {
  return (
    <span className="ia-sl-row">
      <span className="ia-sl-l">{label}</span>
      <span className="ia-sl"><i style={{ width: `${pct}%` }} /><b style={{ left: `${pct}%` }} /></span>
      <span className="ia-sl-v">{value}</span>
    </span>
  );
}

const LOOKS: [string, string][] = [["Original", ""], ["Brighter", "bright"], ["Warmer", "warm"], ["Cooler", "cool"], ["Punchy", "punch"], ["Mono", "bw"], ["Club green", "duo"], ["Night", "dark"]];

/** The photo part of the inspector — appears when a photo is selected. Edits apply to THIS use (CONTRACT §7);
    "Apply to every use…" is the explicit choice. Looks in words; AI cut-out; Original kept. */
function PhotoInsp({ look = "Punchy", bg = false, style }: { look?: string; bg?: boolean; style?: CSSProperties }) {
  return (
    <div className="island island--pad k-insp ia-pi" style={style}>
      <div className="k-insp-hd"><strong>IMG_2247.jpg</strong><span className="chip">Photo</span></div>
      <div className="k-insp-row"><span>Placement</span><InSeg options={["Fill", "Fit", "Crop"]} value="Fill" /></div>
      <p className="ia-pi-l">Look</p>
      <div className="ia-looks">
        {LOOKS.map(([n, c]) => (
          <span key={n} className="ia-look" data-on={n === look ? "true" : undefined}>
            <Pic v="portrait" className={`ia-look-pic${c ? ` ia-tone--${c}` : ""}`} />
            <span>{n}</span>
          </span>
        ))}
      </div>
      <Slider label="Light" pct={58} value="+12" />
      <Slider label="Colour" pct={66} value="+24" />
      {bg ? (
        <div className="k-insp-row ia-pi-bg"><span><Spark size={11} />Background removed</span><InSwitch on /></div>
      ) : (
        <span className="btn btn--sm ia-pi-ai"><Spark size={12} color="var(--spark)" />Remove background</span>
      )}
      <span className="ia-pi-acts"><span className="btn btn--sm"><Icon name="image" size={12} />Replace…</span><span className="btn btn--ghost btn--sm">Reset</span></span>
      <div className="ia-scope">
        <p className="ia-scope-h"><Icon name="check" size={12} />Only this use changes</p>
        <p className="ia-scope-t">IMG_2247.jpg is in 3 more canvases — they keep the original. Reset brings this one back too.</p>
        <span className="btn btn--sm ia-wide">Apply to every use…</span>
      </div>
      <Adv hint="sliders · grain · mask" />
    </div>
  );
}

/** A close-up: heading, body, note at the foot. */
function Closeup({ title, sub, note, children, theme = "light", className = "" }: { title: ReactNode; sub?: ReactNode; note: ReactNode; children: ReactNode; theme?: "light" | "dark"; className?: string }) {
  return (
    <V2 theme={theme} className={`ia-cu ${className}`}>
      <div className="ia-cu-top"><p className="ia-cu-h">{title}</p>{sub ? <p className="ia-cu-sub">{sub}</p> : null}</div>
      <div className="ia-cu-body">{children}</div>
      <div className="ia-cu-note">{note}</div>
    </V2>
  );
}
function Col({ label, where, children, w, className = "" }: { label: string; where?: string; children: ReactNode; w?: number; className?: string }) {
  return (
    <figure className={`ia-col ${className}`} style={w ? { width: w } : undefined}>
      <figcaption className="ia-col-l"><span>{label}</span>{where ? <span className="chip ia-where">{where}</span> : null}</figcaption>
      {children}
    </figure>
  );
}
/** A cropped piece of the canvas inside a close-up (dotted, rounded). */
function Crop({ children, h = 360, className = "" }: { children: ReactNode; h?: number; className?: string }) {
  return <div className={`ia-crop ${className}`} style={{ height: h }}>{children}</div>;
}

/** A picture that is still on someone's device (`waiting`, quiet) or that no device has (`missing`, Relink…).
    Sits over the artboard, app theme. CONTRACT §7 "not here yet vs missing". */
function AbsentPic({ x, y, w, h, name, state }: { x: number; y: number; w: number; h: number; name: string; state: "waiting" | "missing" }) {
  return (
    <span className={`ia-absent ia-absent--${state}`} style={{ left: x, top: y, width: w, height: h }}>
      <span className="ia-absent-in">
        <Icon name={state === "waiting" ? "clock" : "problem"} size={18} />
        <span className="ia-absent-n">{name}</span>
        <span className="ia-absent-d">{state === "waiting" ? "Waiting for Jonas's Mac" : "Missing — no device has it"}</span>
        {state === "missing" ? <span className="btn btn--sm btn--primary ia-absent-btn">Relink…</span> : null}
      </span>
    </span>
  );
}

/** Import summary — what came across, in plain words, one line each (Advanced holds the node ids). */
function Summary({ title, rows, adv, style, className = "" }: { title: ReactNode; rows: [ "ok" | "warn" | "skip", ReactNode][]; adv?: string; style?: CSSProperties; className?: string }) {
  return (
    <div className={`island island--pad ia-sum ${className}`} style={style}>
      <p className="ia-sum-t">{title}</p>
      {rows.map(([s, t], i) => (
        <span className={`ia-sum-r ia-sum-r--${s}`} key={i}>
          <span className="ia-sum-ic"><Icon name={s === "ok" ? "check" : s === "warn" ? "problem" : "eye-off"} size={12} /></span>
          <span>{t}</span>
        </span>
      ))}
      {adv ? <Adv hint={adv} /> : null}
    </div>
  );
}

/** The AI chat panel with the Generate mode (local, richer than kit AIPanel — same anatomy as 03's Chat). */
function GenChat({ children, prompt, mode, opts, hint, fine, height = 560, style }: {
  children?: ReactNode; prompt?: string; mode?: "image" | "clip"; opts?: ReactNode; hint?: ReactNode; fine?: ReactNode; height?: number; style?: CSSProperties;
}) {
  return (
    <div className="island island--pad k-ai ia-chat" style={{ height, ...style }}>
      <div className="k-ai-hd">
        <Spark size={14} />
        <span className="k-ai-name ia-chat-t">Gameweek 5 photo<Icon name="chevron" size={12} /></span>
        <span className="icon-btn k-icon-sm"><Icon name="plus" size={14} /></span>
        <span className="icon-btn k-icon-sm"><Icon name="chevron" size={14} /></span>
      </div>
      <div className="ia-chat-body">{children}</div>
      <div className="ia-chat-foot">
        {mode ? (
          <div className="ia-gen-mode">
            <span className={`chip${mode === "image" ? " chip--spark" : ""}`}><Icon name="image" size={11} />Generate an image</span>
            <span className={`chip${mode === "clip" ? " chip--spark" : ""}`}><Icon name="video" size={11} />Generate a clip</span>
          </div>
        ) : null}
        {opts ? <div className="ia-gen-opts">{opts}</div> : null}
        <div className="ask k-ask">
          <span className="chip chip--accent k-selchip">◆ Post 4:5 · Gameweek 5</span>
          <span className={`k-ask-in${prompt ? "" : " k-ask-ph"}`}>{prompt ?? "Ask AI…"}{prompt ? <i className="k-caretline" /> : null}</span>
          <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
        </div>
        {hint ? <p className="ia-gen-hint">{hint}</p> : null}
        {fine ? <p className="ia-gen-fine">{fine}</p> : null}
      </div>
    </div>
  );
}

/** A small edge-case card in a close-up: a label, a little scene, one line of what the app says. */
function Case({ n, title, children, say, className = "" }: { n: string; title: string; children: ReactNode; say?: ReactNode; className?: string }) {
  return (
    <figure className={`ia-case ${className}`}>
      <figcaption className="ia-case-l"><span className="ia-case-n">{n}</span>{title}</figcaption>
      <div className="ia-case-scene">{children}</div>
      {say ? <p className="ia-case-say">{say}</p> : null}
    </figure>
  );
}

/* ═══ Browse view — "Photos 120 ›" widens the Assets tab over the canvas ═══════════════════════════════ */
const BROWSE: [PicV, string, boolean?][] = [
  ["td", "IMG_2231.jpg", true], ["huddle", "IMG_2232.jpg", true], ["tackle", "IMG_2236.jpg", true], ["crowd", "IMG_2240.jpg", true],
  ["kick", "IMG_2241.jpg", true], ["night", "IMG_2244.jpg", true], ["portrait", "IMG_2247.jpg"],
  ["huddle", "IMG_2251.jpg"], ["dron", "dron-hriste-01.jpg"], ["crowd", "tribuna-sever.jpg"], ["tackle", "IMG_2255.jpg"],
  ["td", "IMG_2258.jpg"], ["kick", "IMG_2260.jpg"], ["night", "IMG_2263.jpg"],
  ["portrait", "kilian-27.jpg"], ["huddle", "trenink-12.jpg"], ["dron", "dron-hriste-02.jpg"], ["tackle", "IMG_2101.jpg"],
];
const BROWSE2: [PicV, string][] = [
  ["huddle", "trenink-01.jpg"], ["kick", "trenink-04.jpg"], ["tackle", "trenink-07.jpg"], ["portrait", "trenink-portret.jpg"],
  ["crowd", "IMG_2102.jpg"], ["dron", "dron-hriste-03.jpg"], ["night", "IMG_2110.jpg"],
];

/* ═══ Studio site — for Import a brand ════════════════════════════════════════════════════════════════ */
const STUDIO: CanvasItem[] = [
  { name: "Homepage", art: "home", people: ["tereza"] },
  { name: "Pricing", art: "price" },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
];
function StudioChrome() {
  return (
    <>
      <ProjectPill project="Studio site" canvas="Homepage" />
      <CanvasesPanel project="Studio site" count={4} selected="Homepage" items={STUDIO} />
      <ShareCluster people={["tereza"]} mode="edit" />
      <ZoomUndo zoom={28} />
      <Toolbar />
      <PanelIcon icon="spark" at="ai" />
    </>
  );
}

/* sticky at canvas scale (Figma comments that came across) — the kit Sticky, made small */

/* ═══ The canvas ══════════════════════════════════════════════════════════════════════════════════════ */
export default function ImportAndAssets() {
  return (
    <DesignCanvas>
      {/* ── 1 · Getting things in ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="getting-in" title="Getting things in" subtitle="Drag photos from Finder onto an artboard — then paste, a video file, a logo; everything also lands in Assets">
        <DCArtboard id="ia-drop-photos" label="1 · Drag 6 photos from Finder onto an artboard" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Drop on an artboard and the photos go inside it.">The artboard under the pointer lights up and says what will happen: empty frames fill in order, or a tidy grid. On bare canvas they stay loose. Image (I) does the same without a drag.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(0, { "Post 4:5 · Fotky ze zápasu": { body: <MatchPost drop /> } })} />
                <DropTarget x={312} y={112} w={216} h={270}>Drop to place 6 photos in Fotky ze zápasu</DropTarget>
                <DragStack x={402} y={236} pics={["td", "huddle", "crowd"]} count={6} name="IMG_2231.jpg + 5 more" />
              </Canvas>
              <GatorChrome left="assets" tool="image" assets={<AssetsBody><Library /></AssetsBody>} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-placed" label="2 · Placed 6 photos — still going up to the cloud" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Placed at once; the cloud catches up.">The photos are on the artboard and selected, so you can move or ask AI about them right away. They're also first in Assets › Just added; thin bars and Syncing… say what is still uploading.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(0, { "Post 4:5 · Fotky ze zápasu": { body: <MatchPost photos={["td", "huddle", "tackle", "crowd", "kick", "night"]} uploading={[4, 5]} /> } })} />
                <span className="ia-groupsel" style={{ left: 319, top: 190, width: 202, height: 164 }}><span className="ia-groupsel-tag">6 photos</span></span>
              </Canvas>
              <GatorChrome status="syncing" left="assets" tool="image" assetsFoot="253 assets · 1.4 GB" assets={
                <AssetsBody>
                  <GroupHead title="Just added" count={6} more={false} />
                  <div className="ia-grid ia-grid--3">
                    <Tile v="td" /><Tile v="huddle" /><Tile v="tackle" /><Tile v="crowd" />
                    <Tile v="kick" state="up" pct={64} /><Tile v="night" state="up" pct={38} />
                  </div>
                  <GroupHead title="Photos" count={126} />
                  <div className="ia-grid ia-grid--3"><Tile v="portrait" /><Tile v="dron" /><Tile v="huddle" /></div>
                  <GroupHead title="Video" count={34} />
                  <div className="ia-grid ia-grid--2"><Tile v="dron" dur="0:08" /><Tile v="night" dur="0:07" /></div>
                </AssetsBody>
              } />
              <Toast icon="done" action="Undo">Placed 6 photos in Fotky ze zápasu. They're in Assets too.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-more-ways" label="3 · Paste, a video file, a logo" width={W} height={H} fixed>
          <Closeup title="Three more ways in — each one quiet." sub="Same rule every time: it lands where you dropped it, and a copy goes to Assets."
            note={<Note n={3} title="Video prepares itself; logos are made safe without asking.">⌘V puts a screenshot under the pointer. A 4K .mov is on the canvas at once and plays when ready. A logo loses anything that isn't drawing; one line says so.</Note>}>
            <div className="ia-row3">
              <Col label="⌘V — paste a screenshot" where="Menu › Edit › Paste ⌘V">
                <Crop h={420}>
                  <Artboard label="Story 9:16 · Gameday" kind="digital" x={110} y={34} w={200} h={356}><GatorMock variant="reel" headline="GAMEDAY" sub="So 15:00 · Kraví hora" /></Artboard>
                  <span className="ia-pasted" style={{ left: 134, top: 92 }}>
                    <Pic v="shot" className="ia-fill" />
                    <span className="ia-pasted-sel" />
                  </span>
                  <span className="ia-capt" style={{ left: 134, top: 210 }}>Snímek obrazovky 2026-10-06 v 14.05.png</span>
                </Crop>
                <p className="ia-col-say">Pasted into Story 9:16 · Gameday, where the pointer was. Paste it again and the same picture is reused, not copied.</p>
              </Col>
              <Col label="Drop .mov files — they prepare in place" where="Menu › File › Assemble clips into a video">
                <Crop h={420}>
                  <span className="ia-clipcard" style={{ left: 24, top: 40 }}>
                    <Pic v="dron" className="ia-fill" />
                    <span className="ia-prep"><span className="ia-prep-w"><Icon name="sync" size={11} />Preparing… 62 %</span><span className="ia-prog"><b style={{ width: "62%" }} /></span></span>
                    <span className="ia-capt ia-capt--in maude-v2 k-fixed" data-theme="light">IMG_4471.mov · 4K · 0:42</span>
                  </span>
                  <span className="ia-clipcard" style={{ left: 214, top: 40 }}>
                    <Pic v="tackle" className="ia-fill" />
                    <span className="ia-prep"><span className="ia-prep-w"><Icon name="sync" size={11} />Preparing… 18 %</span><span className="ia-prog"><b style={{ width: "18%" }} /></span></span>
                    <span className="ia-capt ia-capt--in maude-v2 k-fixed" data-theme="light">IMG_4472.mov · 4K · 0:31</span>
                  </span>
                  <span className="ia-clipcard" style={{ left: 24, top: 160 }}>
                    <Pic v="huddle" className="ia-fill" />
                    <span className="ia-prep"><span className="ia-prep-w"><Icon name="sync" size={11} />Preparing…</span><span className="ia-prog"><b style={{ width: "2%" }} /></span></span>
                    <span className="ia-capt ia-capt--in maude-v2 k-fixed" data-theme="light">IMG_4473.mov · 4K · 0:12</span>
                  </span>
                  <span className="island ia-offer" style={{ left: 24, top: 300 }}>
                    <span>3 clips</span>
                    <span className="btn btn--sm btn--primary"><Icon name="video" size={12} />Assemble into a video</span>
                  </span>
                </Crop>
                <p className="ia-col-say">Loose clips wait on the canvas, playable once prepared. One button puts all three on a new video artboard, in order — the cut works while they prepare.</p>
              </Col>
              <Col label="Drop a logo — SVG or PDF" where="Logos & icons in Assets">
                <Crop h={420}>
                  <Artboard label="Post 1:1 · Partneři" kind="digital" x={50} y={34} w={316} h={316}><GatorMock variant="social" headline="DÍKY PARTNERŮM" sub="Sezóna 2026" /></Artboard>
                  <span className="ia-logo-placed" style={{ left: 262, top: 54 }}><Logo v="roundel" className="ia-fill" /></span>
                  <span className="ia-quiet" style={{ left: 50, top: 366 }}><Icon name="check" size={12} />Logo cleaned up for the canvas<span className="ia-quiet-more">Details</span></span>
                </Crop>
                <p className="ia-col-say">gator_badge_roundel.svg kept its shapes and colours; two links to other sites and a script were left out. A PDF logo comes in as a picture of its first page.</p>
              </Col>
            </div>
            <div className="island island--pad ia-just">
              <p className="island-title ia-just-t">Assets · Just added<span className="ia-gh-n">5</span></p>
              <div className="ia-just-row">
                <span className="ia-just-i"><Tile v="shot" /><span>Screenshot · now</span></span>
                <span className="ia-just-i ia-just-i--clip"><Tile v="dron" dur="0:42" state="prep" pct={62} /><span>IMG_4471.mov</span></span>
                <span className="ia-just-i ia-just-i--clip"><Tile v="tackle" dur="0:31" state="prep" pct={18} /><span>IMG_4472.mov</span></span>
                <span className="ia-just-i ia-just-i--clip"><Tile v="huddle" dur="0:12" state="prep" /><span>IMG_4473.mov</span></span>
                <span className="ia-just-i"><Tile logo="roundel" /><span>gator_badge_roundel.svg</span></span>
              </div>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Assets panel ──────────────────────────────────────────────────────────────────────── */}
      <DCSection id="assets" title="Assets — 247 things, the third tab of the left panel" subtitle="Grouped by kind, pictures first; drag or press ↵ to place; widen it to browse; search names and tags — and, once you say yes, what's in the pictures">
        <DCArtboard id="ia-assets-panel" label="4 · Assets — drag a photo onto an artboard" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Assets is the left panel's third tab.">Menu › View › Assets or ⌘K opens it. Hover shows a photo's name and where it's used; drag one onto MVP zápasu to replace its photo.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(60)} />
                <DropTarget x={628} y={112} w={216} h={195} frame>Drop to replace the photo</DropTarget>
                <span className="ia-dragtile" style={{ left: 694, top: 184 }}><Pic v="portrait" className="ia-fill" /></span>
              </Canvas>
              <GatorChrome left="assets" tool="image" assets={<AssetsBody><Library dragging hover /></AssetsBody>} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-assets-keys" label="5 · Place without dragging — select a tile, ↵" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Every tile places by keyboard.">Select an artboard, then a tile: ↵ places it there. Right-click shows the same as Place in the tile's menu; ⌘I opens its details, + adds files from Finder.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(60, { "Post 4:5 · MVP zápasu": { sel: true, size: "1080 × 1350", body: <MvpPost photo={null} /> } })} />
              </Canvas>
              <GatorChrome left="assets" tool="image" assets={<AssetsBody><Library selected /></AssetsBody>} />
              <Menu width={244} style={{ position: "absolute", left: 272, top: 196, zIndex: 30 }} items={[
                { label: "Place in MVP zápasu", keys: "↵", highlight: true },
                { label: "Show details", keys: "⌘I" },
                { label: "Rename…" },
                { label: "Copy", keys: "⌘C" },
                "sep",
                { label: "Move to trash" },
              ]} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-assets-browse" label="6 · Photos 120 › — a wide view to browse and pick many" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="A group heading widens Assets into a browse view.">Big pictures with names, sort and size, select many with ⇧ or ⌘. Six picked, Fotky ze zápasu selected: ↵ fills its six frames in order — or drag the six.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(568, { "Post 4:5 · Fotky ze zápasu": { sel: true, size: "1080 × 1350" } })} />
              </Canvas>
              <GatorChrome left="assets" leftStyle={{ width: 820, height: "calc(100% - 68px - 72px)" }} assetsFoot={null} assets={
                <div className="ia-br">
                  <div className="ia-br-hd">
                    <span className="ia-dt-back"><Icon name="chevron" size={12} />Assets</span>
                    <strong className="ia-br-t">Photos <span className="ia-gh-n">120</span></strong>
                    <span className="k-find ia-br-find"><Icon name="search" size={14} /><span className="k-find-q k-find-ph">Search photos</span></span>
                    <span className="chip ia-ap-kinds">Newest first<Icon name="chevron" size={11} /></span>
                    <span className="seg k-seg ia-br-size"><span className="k-seg-b" aria-pressed="true">Large</span><span className="k-seg-b" aria-pressed="false">Small</span></span>
                  </div>
                  <p className="island-title ia-br-day">Zápas vs. Panthers · 27 Sep</p>
                  <div className="ia-br-grid">
                    {BROWSE.map(([v, n, on], i) => (
                      <span key={n + i} className="ia-br-i">
                        <Tile v={v} picked={!!on} sel={!!on} />
                        <span className="ia-br-n">{n}</span>
                      </span>
                    ))}
                  </div>
                  <p className="island-title ia-br-day">Trénink · 24 Sep</p>
                  <div className="ia-br-grid ia-br-grid--fade">
                    {BROWSE2.map(([v, n], i) => (
                      <span key={n + i} className="ia-br-i">
                        <Tile v={v} picked={false} />
                        <span className="ia-br-n">{n}</span>
                      </span>
                    ))}
                  </div>
                  <div className="ia-br-bar">
                    <span className="ia-br-sel"><strong>6 selected</strong> · 18.4 MB</span>
                    <span className="btn btn--ghost btn--sm">Clear</span>
                    <span className="ia-br-or">or drag them onto an artboard</span>
                    <span className="btn btn--primary btn--sm">Place 6 in Fotky ze zápasu <Kbd>↵</Kbd></span>
                  </div>
                </div>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-assets-find" label="7 · Search what's in the pictures — asked once per project" width={W} height={H} fixed>
          <Closeup title="Search finds names and tags. What's in the pictures, once you say yes." sub="The first search offers it; one sheet asks for Alligators brand only. Without AI connected, search stays on names — and says so."
            note={<Note n={7} title="Asked once per project, never assumed.">Describing pictures uses your Claude account, so it waits for a yes. After that, “touchdown” finds the night photo and marks where it was seen. Studio site still searches names until someone says yes there.</Note>}>
            <div className="ia-row4">
              <Col label="1 · First search — names and tags">
                <CanvasesPanel project="Alligators brand" tab="assets" style={COL_PANEL} foot="Searched 247 assets — names and tags" assets={
                  <AssetsBody query="touchdown">
                    <GroupHead title="In the name or tags" count={2} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="tackle" dur="0:07" match="caaftv-td-run-7s" />
                      <Tile v="td" match="touchdown-2025.jpg" />
                    </div>
                    <div className="ia-offer2">
                      <p><strong>Search what's in the pictures too?</strong> AI can describe every picture and clip once, so a word finds IMG_2231.jpg as well.</p>
                      <span className="btn btn--sm">Turn on…</span>
                    </div>
                  </AssetsBody>
                } />
              </Col>
              <Col label="2 · Asked once, for this project">
                <IaSheet flow title="Describe the pictures in Alligators brand?" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Describe pictures</span></>}>
                  <p>Let AI describe your pictures so search can find what's in them.</p>
                  <ul className="ia-bul">
                    <li>Uses your Claude account — one short look at each of 238 pictures and clips.</li>
                    <li>New pictures are described when they arrive.</li>
                    <li>The words stay next to each file, so search works offline.</li>
                    <li>Only for Alligators brand. Turn it off in Settings › General.</li>
                  </ul>
                </IaSheet>
              </Col>
              <Col label="3 · Then — what's in them">
                <CanvasesPanel project="Alligators brand" tab="assets" style={COL_PANEL} foot="5 results · 35 pictures still being described" assets={
                  <AssetsBody query="touchdown">
                    <GroupHead title="Seen in the picture" count={3} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="td" match="touchdown · noc" seen={{ l: "32%", t: "14%", w: "30%", h: "58%" }} />
                      <Tile v="night" dur="0:07" match="0:03 skóruje #27" seen={{ l: "26%", t: "30%", w: "48%", h: "50%" }} />
                      <Tile v="g2" ai match="touchdown · mlha" />
                    </div>
                    <GroupHead title="In the name or tags" count={2} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="tackle" dur="0:07" match="caaftv-td-run-7s" />
                      <Tile v="td" match="touchdown-2025.jpg" />
                    </div>
                  </AssetsBody>
                } />
              </Col>
              <Col label="AI not connected — names only">
                <CanvasesPanel project="Alligators brand" tab="assets" style={COL_PANEL} foot="Searched 247 assets — names only" assets={
                  <AssetsBody query="touchdown">
                    <GroupHead title="In the name or tags" count={2} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="tackle" dur="0:07" match="caaftv-td-run-7s" />
                      <Tile v="td" match="touchdown-2025.jpg" />
                    </div>
                    <div className="ia-offer2">
                      <p>Connect your Claude account to search what's in pictures, too.</p>
                      <span className="btn btn--sm">Connect…</span>
                    </div>
                  </AssetsBody>
                } />
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ia-assets-tidy" label="8 · By name · Not used · where the words come from" width={W} height={H} fixed>
          <Closeup title="Names still work, nothing unused hides, and every word has a source." sub="“dron” finds clips by name and photos from above; Not used lists what no canvas needs; a clip's details say what AI saw, and when."
            note={<Note n={8} title="Tidy up without losing history.">Not used counts only what no canvas uses today. Pictures kept by older versions and today's AI takes are left out, so Move to the trash can't break Version history.</Note>}>
            <div className="ia-row3 ia-row3--tidy">
              <Col label="“dron” — by name and by what's in it">
                <CanvasesPanel project="Alligators brand" tab="assets" style={COL_PANEL} foot="6 results in 247 assets" assets={
                  <AssetsBody query="dron">
                    <GroupHead title="In the name" count={4} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="dron" dur="0:09" match="dron-areal-klesani" />
                      <Tile v="dron" dur="0:08" match="dron-sweep-lajny" className="ia-tile--alt" />
                      <Tile v="dron" dur="0:07" match="dron-topdown-lajny" />
                      <Tile v="crowd" dur="0:08" match="dron-roh-zazemi" />
                    </div>
                    <GroupHead title="Seen in the picture" count={2} more={false} />
                    <div className="ia-grid ia-grid--2">
                      <Tile v="dron" match="z výšky · hřiště" className="ia-tile--alt" />
                      <Tile v="crowd" match="z výšky · tribuna" />
                    </div>
                  </AssetsBody>
                } />
              </Col>
              <Col label="Not used anywhere">
                <CanvasesPanel project="Alligators brand" tab="assets" style={COL_PANEL} foot={<span className="ia-foot-act"><span>31 assets · 212 MB</span><span className="btn btn--sm">Move 31 to the trash…</span></span>} assets={
                  <AssetsBody unused>
                    <p className="ia-notcounted"><Icon name="history" size={12} />Not counted: 12 kept only by older versions, 3 AI takes from today.</p>
                    <GroupHead title="Photos" count={14} more={false} />
                    <div className="ia-grid ia-grid--3">
                      <Tile v="crowd" /><Tile v="huddle" /><Tile v="kick" /><Tile v="tackle" /><Tile v="night" /><Tile v="portrait" />
                    </div>
                    <GroupHead title="Video" count={9} more={false} />
                    <div className="ia-grid ia-grid--2"><Tile v="crowd" dur="0:06" /><Tile v="huddle" dur="0:05" /></div>
                    <GroupHead title="Generated" count={8} more={false} />
                    <div className="ia-grid ia-grid--3"><Tile v="g1" ai /><Tile v="g3" ai /><Tile v="g4" ai /></div>
                  </AssetsBody>
                } />
              </Col>
              <Col label="Where the words come from">
                <div className="island island--pad ia-why">
                  <span className="ia-why-pic">
                    <Pic v="tackle" className="ia-fill" />
                    <span className="ia-seen" style={{ left: "30%", top: "22%", width: "36%", height: "60%" }}><span className="ia-seen-t">touchdown</span></span>
                    <span className="ia-scrub maude-v2 k-fixed" data-theme="light"><Icon name="play" size={10} /><i><b /><em style={{ left: "43%" }} /></i><span>0:03 / 0:07</span></span>
                  </span>
                  <p className="ia-why-n">caaftv-td-run-7s.mp4</p>
                  <p className="ia-why-l">AI saw</p>
                  <p className="ia-quote ia-why-q">Běžec prorazí zákrok a skóruje, tribuna vstává. Denní světlo, bez mluveného slova.</p>
                  <span className="ia-tags"><span className="chip">touchdown</span><span className="chip">#27</span><span className="chip">běh</span><span className="chip">tribuna</span></span>
                  <p className="ia-fine">Described on 6 Oct with your Claude account, in the project's language. Picking a hit jumps the clip to the moment — here, 0:03.</p>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ia-asset-details" label="9 · An asset's details — photo, made by AI, footage, sound" width={W} height={H} fixed>
          <Closeup title="Click an asset: where it's used, who added it, what AI saw." sub="The details replace the list; ← Assets goes back. Same view for every kind, each with Place: a picture goes on the selected artboard, a clip or a sound on a video artboard."
            note={<Note n={9} title="Made by AI is said once, plainly.">A generated image keeps its prompt and the provider, with the one licensing line. Footage shows what AI saw, so search and the video cut can use it. “Used in” opens the artboard.</Note>}>
            <div className="ia-row4">
              <Col label="A photo">
                <Details className="ia-rel ia-h620">
                  <span className="ia-dt-pic ia-dt-pic--short"><Pic v="td" className="ia-fill" /></span>
                  <p className="ia-dt-name">IMG_2231.jpg</p>
                  <DRow k="Size">4032 × 3024 · 3.1 MB · JPG</DRow>
                  <DRow k="Added"><span className="ia-who"><Avatar who="jonas" size="sm" />Jonas · 27 Sep, 21:40</span></DRow>
                  <DRow k="AI saw"><span className="ia-tags"><span className="chip">touchdown</span><span className="chip">#27</span><span className="chip">noc</span><span className="chip">reflektory</span></span></DRow>
                  <span className="btn btn--sm btn--primary ia-dt-place">Place in MVP zápasu <Kbd>↵</Kbd></span>
                  <p className="ia-dt-sec">Used in 4 canvases</p>
                  <UsedRow art="gator-social" canvas="matchday" board="Post 4:5 · Fotky ze zápasu" />
                  <UsedRow art="gator-web" canvas="club-web/website" board="Desktop · Novinky" />
                  <UsedRow art="gator-social" canvas="Super-Bowl-Watch-Party" board="Post 1:1" />
                  <UsedRow art="video" canvas="video-touchdown" board="16:9 · at 0:02" />
                  <Adv hint="file name · original path" />
                </Details>
              </Col>
              <Col label="Made by AI">
                <Details className="ia-rel ia-h620">
                  <span className="ia-dt-pic ia-dt-pic--45"><Pic v="g3" className="ia-fill" /><span className="chip chip--spark ia-dt-made"><Spark size={9} />Made by AI</span></span>
                  <p className="ia-dt-name">Hráč slaví touchdown, noční stadion</p>
                  <DRow k="Prompt"><span className="ia-quote">Hráč Alligators v zeleném dresu slaví touchdown, noční stadion, mlha, reflektory</span></DRow>
                  <DRow k="Made with">Google · Nano Banana Pro · 5 Oct</DRow>
                  <DRow k="Size">1080 × 1350 · 1.8 MB</DRow>
                  <p className="ia-fine">May carry an invisible SynthID watermark. Check Google's terms before commercial use.</p>
                  <span className="btn btn--sm btn--primary ia-dt-place">Place in MVP zápasu <Kbd>↵</Kbd></span>
                  <p className="ia-dt-sec">Used in 1 canvas</p>
                  <UsedRow art="gator-social" canvas="matchday" board="Post 4:5 · Gameweek 5" />
                  <span className="btn btn--sm ia-dt-act"><Spark size={11} color="var(--spark)" />Generate more like this</span>
                </Details>
              </Col>
              <Col label="A clip">
                <Details className="ia-rel ia-h620">
                  <span className="ia-dt-pic ia-dt-pic--169"><Pic v="tackle" className="ia-fill" /><span className="ia-scrub maude-v2 k-fixed" data-theme="light"><Icon name="play" size={10} /><i><b /></i><span>0:03 / 0:07</span></span></span>
                  <p className="ia-dt-name">caaftv-td-run-7s.mp4</p>
                  <DRow k="Size">1280 × 720 · 0:07 · 3.4 MB</DRow>
                  <DRow k="AI saw"><span className="ia-quote">Běžec prorazí zákrok a skóruje, tribuna vstává. Denní světlo, bez mluveného slova.</span></DRow>
                  <DRow k="Good moments"><span className="ia-moments"><span className="chip">0:01–0:04 běh</span><span className="chip">0:05 oslava</span></span></DRow>
                  <span className="btn btn--sm btn--primary ia-dt-place">Place in Reels 9:16 <Kbd>↵</Kbd></span>
                  <p className="ia-dt-sec">Used in 2 canvases</p>
                  <UsedRow art="gator-reel" canvas="video-hype" board="Reels 9:16" />
                  <UsedRow art="video" canvas="video-touchdown" board="16:9 · teaser" />
                  <Adv hint="file name · what AI saw, as data" />
                </Details>
              </Col>
              <Col label="Sound made by AI">
                <Details className="ia-rel ia-h620">
                  <span className="ia-dt-snd"><span className="ia-snd-play ia-snd-play--lg"><Icon name="play" size={14} /></span><Wave /></span>
                  <p className="ia-dt-name">Hype beat · 120 BPM</p>
                  <DRow k="Prompt"><span className="ia-quote">Energetic sports hype instrumental, 120 BPM, no vocals, a big drop after 5 s</span></DRow>
                  <DRow k="Made with">ElevenLabs Music · 28 Sep</DRow>
                  <DRow k="Length">0:15 · 240 KB · MP3</DRow>
                  <p className="ia-fine">Commercial use depends on your ElevenLabs plan.</p>
                  <span className="btn btn--sm btn--primary ia-dt-place">Place in Reels 9:16 <Kbd>↵</Kbd></span>
                  <p className="ia-dt-sec">Used in 1 canvas</p>
                  <UsedRow art="gator-reel" canvas="video-hype" board="Reels 9:16 · music" />
                  <Adv hint="file name · prompt, as data" />
                </Details>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Photo editing, light ──────────────────────────────────────────────────────────────── */}
      <DCSection id="photo" title="Photo editing — light, per use, and nothing lost" subtitle="Select a photo: placement, a look in words, light and colour, remove the background with AI — on this one use; Apply to every use is a choice">
        <DCArtboard id="ia-photo-inspector" label="10 · Select a photo — the photo inspector" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Edits stay with this one use.">Punchy changes MVP zápasu only; the 3 other canvases with IMG_2247.jpg keep the original until you pick Apply to every use. Remove background is AI's job, so it wears the spark.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 4:5 · MVP zápasu" kind="digital" x={300} y={96} w={518} h={648}>
                  <MvpPost photo="portrait" />
                  <Selection x={0} y={0} w={518} h={492} label="Photo · 1080 × 1026" />
                </Artboard>
                <Artboard label="Post 1:1 · Výsledek" kind="digital" x={858} y={96} w={518} h={518}><ScorePost /></Artboard>
              </Canvas>
              <GatorChrome left="folded" zoom={48} insp={<PhotoInsp />} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-photo-steps" label="11 · Crop · Remove background · Done · Apply to every use" width={W} height={860} fixed>
          <Closeup title="Crop the frame, cut out the player, keep the original — here, or everywhere." sub="Four moments on the same photo in MVP zápasu."
            note={<Note n={11} title="The cut-out happens on this Mac.">Remove background runs locally — the photo never leaves it — and the result is a mask on top, not a new photo. Apply to every use is a sheet that names each canvas it would change.</Note>}>
            <div className="ia-row4">
              <Col label="Crop — drag the edges">
                <Crop h={520}>
                  <span className="ia-cropstage">
                    <Pic v="portrait" className="ia-fill" />
                    <span className="ia-cropbox" style={{ left: "14%", top: "8%", width: "72%", height: "74%" }}><i /><i /><i /><i /><span className="ia-cropbox-t">4:5 · from the artboard</span></span>
                  </span>
                  <span className="ia-mini-insp"><InSeg options={["Fill", "Fit", "Crop"]} value="Crop" /><span className="ia-mini-l">The whole photo stays — only the frame moves.</span></span>
                </Crop>
              </Col>
              <Col label="Remove background — AI at work">
                <Crop h={520}>
                  <Artboard label="Post 4:5 · MVP zápasu" kind="digital" x={20} y={40} w={278} h={348} aiWorking="AI is removing the background" aiAt="below" aiCursor={{ x: "62%", y: "40%" }}>
                    <MvpPost photo="portrait" />
                  </Artboard>
                </Crop>
              </Col>
              <Col label="Done — the original is kept">
                <Crop h={520}>
                  <Artboard label="Post 4:5 · MVP zápasu" kind="digital" x={20} y={40} w={278} h={348}>
                    <MvpPost photo="cutout" />
                    <Selection x={0} y={0} w={278} h={250} />
                  </Artboard>
                  <span className="ia-made" style={{ left: 28, top: 48 }}><Spark size={10} />Background removed by AI</span>
                  <span className="island island--pad ia-mini-sw" style={{ left: 20, top: 412 }}>
                    <span className="ia-mini-swr"><Spark size={11} /><span>Background removed</span><InSwitch on /></span>
                    <span className="ia-mini-l">Off shows the original photo. This use only.</span>
                  </span>
                </Crop>
              </Col>
              <Col label="Apply to every use — a choice">
                <IaSheet flow title="Apply Punchy and the cut-out to every use?" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Apply to every use</span></>}>
                  <p>IMG_2247.jpg is in 3 more canvases. They change too:</p>
                  <span className="ia-uselist">
                    <UsedRow art="gator-numbers" canvas="score-mvp" board="Post 4:5 · MVP" />
                    <UsedRow art="gator-web" canvas="club-web/website" board="Desktop · Hráči" />
                    <UsedRow art="video" canvas="video-recap" board="16:9 · at 0:12" />
                  </span>
                  <p className="ia-fine">Each use can still be changed on its own afterwards. Undo works as anywhere.</p>
                </IaSheet>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Generate ──────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="generate" title="Generate an image (or a clip)" subtitle="From the AI chat panel or Assets › Generate — the artboard sets the shape, the best of four lands in the frame, ← → tries the others right there">
        <DCArtboard id="ia-gen-ask" label="12 · Generate an image — the ask" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Say the picture; the artboard decides the shape.">Gameweek 5 is 4:5, so the images are 4:5. Before anything is sent, one line says how long and whose account pays; one line covers the licence.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(-40, { "Post 4:5 · Gameweek 5": { sel: true, size: "1080 × 1350" }, "Story 9:16 · Gameday": { dim: true } })} />
              </Canvas>
              <GatorChrome left="folded" ai={
                <GenChat mode="image" height={400}
                  prompt="Hráč Alligators v zeleném dresu slaví touchdown, noční stadion, mlha, reflektory"
                  opts={<><span className="chip">4:5 · from Gameweek 5<Icon name="chevron" size={11} /></span><span className="chip">4 variants<Icon name="chevron" size={11} /></span></>}
                  hint={<><Icon name="clock" size={11} />About 30 s · billed to your Google key</>}
                  fine="Images may carry an invisible SynthID watermark. Check Google's terms for commercial use.">
                  <p className="ia-chat-hint">Describe what should be in the picture. AI makes four takes in the artboard's shape and puts the best one in the frame; the others are one key away.</p>
                  <span className="ia-chat-sugg"><span className="chip k-sugg">Use our photos as a style</span><span className="chip k-sugg">Daylight instead</span></span>
                </GenChat>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-gen-placed" label="13 · Four takes — the best one in the frame, ← → for the others" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="The choice happens in the frame.">The best take lands in Gameweek 5, selected; ← → swaps in the other three right on the canvas, or pick one in the chat. The picture — not the artboard — carries Made by AI.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Boards list={matchday(-40, { "Post 4:5 · Gameweek 5": { body: <><MvpPost photo="g3" label="GAMEWEEK 5" name="So 4. 10. · 15:00" /><Selection x={0} y={0} w={216} h={195} /></> }, "Story 9:16 · Gameday": { dim: true } })} />
                <span className="ia-made" style={{ left: 278, top: 444 }}><Spark size={10} />Picture made by AI</span>
                <span className="ia-takes" style={{ left: 272, top: 740 }}>
                  <span className="icon-btn k-icon-sm ia-takes-b"><Icon name="chevron" size={12} /></span>
                  <span className="ia-takes-t">Take 3 of 4</span>
                  <span className="icon-btn k-icon-sm ia-takes-b ia-takes-b--next"><Icon name="chevron" size={12} /></span>
                  <span className="ia-takes-k"><Kbd>←</Kbd><Kbd>→</Kbd></span>
                </span>
              </Canvas>
              <GatorChrome left="folded" ai={
                <GenChat height={660}>
                  <p className="k-ai-msg k-ai-msg--you">Generate an image: hráč Alligators v zeleném dresu slaví touchdown, noční stadion, mlha, reflektory</p>
                  <p className="k-ai-msg k-ai-msg--ai">Done — four takes in 4:5. The third is in Gameweek 5; ← → on the canvas tries the others.</p>
                  <div className="ia-vars">
                    {(["g1", "g2", "g3", "g4"] as PicV[]).map((g) => (
                      <span key={g} className="ia-var" data-on={g === "g3" ? "true" : undefined}>
                        <Pic v={g} className="ia-fill" />
                        {g === "g3" ? <span className="ia-var-on"><Icon name="check" size={11} />In the frame</span> : null}
                        {g === "g2" ? <span className="ia-var-hover">Place instead</span> : null}
                      </span>
                    ))}
                  </div>
                  <p className="ia-gen-meta">24 s · 4 images · Google · Nano Banana Pro</p>
                </GenChat>
              } />
              <Toast icon="spark" action="Undo">Placed take 3 in Gameweek 5. The other three are in Assets › Generated.</Toast>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Import from Figma ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="figma" title="Import from Figma" subtitle="Menu › File › Import from Figma… — paste a link, connect once, pick frames and where they go; frames arrive as Figma's exact picture; a FigJam board becomes annotations">
        <DCArtboard id="ia-figma-sheets" label="14 · Paste a link · Connect once · Pick frames and where they go" width={W} height={H} fixed>
          <Closeup title="A link, a one-time connection, then the frames you want — and where they land." sub="Menu › File › Import from Figma… — the same sheet walks through all three."
            note={<Note n={14} title="Connecting is a step, not a detour.">The first time, the sheet says Figma isn't connected and offers Connect… in place. The sheet says up front that frames come in as pictures — editing comes later, one artboard at a time.</Note>}>
            <div className="ia-fig">
              <Col label="Menu › File" className="ia-fig-menu">
                <Crop h={530}>
                  <ProjectPill project="Alligators brand" canvas="matchday" open />
                  <ProjectMenu open="file" highlight="Import from Figma…" />
                </Crop>
              </Col>
              <div className="ia-fig-stack">
              <Col label="1 · Paste a link">
                <IaSheet flow title="Import from Figma" width={372} actions={<><span className="btn">Cancel</span><span className="btn btn--primary ia-off">Import</span></>}>
                  <span className="field"><span className="field-label">Figma link</span><span className="input ia-mono">figma.com/design/k8Fq2…/Uniformy-2027<i className="k-caretline" /></span></span>
                  <span className="ia-callout"><Icon name="lock" size={14} /><span><strong>Figma isn't connected yet.</strong> Connect once to read this file.</span><span className="btn btn--sm">Connect…</span></span>
                  <p className="ia-fine">A board from FigJam works too — it comes in as annotations.</p>
                </IaSheet>
              </Col>
              <Col label="2 · Connect once" where="Settings › Connections">
                <IaSheet flow title="Connect Figma" width={372} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Connect</span></>}>
                  <ol className="ia-steps">
                    <li>In Figma, open <strong>Settings › Security</strong>.</li>
                    <li>Create a personal access token with <strong>File content: read</strong>.</li>
                    <li>Paste it here.</li>
                  </ol>
                  <span className="field"><span className="field-label">Access token</span><span className="input ia-mono">figd_••••••••••••••••W3kQ</span></span>
                  <p className="ia-fine">Kept in this Mac's keychain. Used only to read files you import; Settings › Connections removes it.</p>
                </IaSheet>
              </Col>
              </div>
              <Col label="3 · Pick frames and where they go">
                <IaSheet flow title="Import from Figma" width={372} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Import 6 frames</span></>}>
                  <span className="ia-file"><span className="ia-file-ic"><Icon name="file" size={14} /></span><span><strong>Uniformy-2027</strong><span>Jonas · page Dresy 2027</span></span><StatusWord state="ok">Connected</StatusWord></span>
                  <div className="ia-frames">
                    {([["Helma z boku", true], ["Dres domácí — přední", true], ["Dres domácí — zadní", true], ["Dres venkovní — přední", true], ["Kalhoty doma", true], ["Kalhoty venku", true], ["Ponožky", false], ["Archiv 2025", false]] as [string, boolean][]).map(([n, on]) => (
                      <span key={n} className="ia-frame" data-on={on ? "true" : undefined}>
                        <Thumb art="gator-jersey" className="ia-frame-th" />
                        <span className="ia-frame-n"><Check on={on} /><span>{n}</span></span>
                      </span>
                    ))}
                  </div>
                  <span className="ia-dest">
                    <span className="ia-dest-k">Put them in</span>
                    <span className="input ia-dest-v"><Icon name="folder" size={12} />2026/dresy › New canvas<Icon name="chevron" size={11} /></span>
                  </span>
                  <p className="ia-fine ia-dest-n">Uniformy-2027 is already in 2026/dresy, so this one is called <strong>Uniformy-2027 (Figma)</strong>. Pick it in the list to add to it instead.</p>
                  <span className="ia-opt"><Check on /><span>Comments, as stickies</span></span>
                  <span className="ia-opt"><Check on={false} /><span>Colours and text styles, into the project's style</span></span>
                  <p className="ia-fine">Each frame arrives as Figma's exact picture. Make editable turns one artboard into layers later — it needs Figma Dev Mode on a paid seat.</p>
                </IaSheet>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ia-figma-arrived" label="15 · Artboards arrive — exact pictures, editable on request" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="Exact first, editable on request.">Six frames are six artboards at their Figma sizes, each Figma's own picture. Make editable turns one into layers when Figma Dev Mode is on. The summary names every compromise.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <span className="ia-banner" style={{ left: 300, top: 62 }}><Icon name="file" size={12} />From Figma — Uniformy-2027 by Jonas · imported 6 Oct, 14:05</span>
                {([["Helma z boku", "Helma z boku", 300, 112], ["Dres domácí — přední", "Domácí dres 2027", 532, 112], ["Dres domácí — zadní", "Domácí · záda", 764, 112], ["Dres venkovní — přední", "Venkovní dres 2027", 300, 446], ["Kalhoty doma", "Kalhoty doma", 532, 446], ["Kalhoty venku", "Kalhoty venku", 764, 446]] as [string, string, number, number][]).map(([l, h, x, y]) => (
                  <Artboard key={l} label={l} kind="print" x={x} y={y} w={198} h={282} selected={l === "Dres domácí — přední"}><GatorMock variant="jersey" headline={h} /></Artboard>
                ))}
                {/* Figma's comments arrive as comment pins — pins show in Edit; stickies live in Preview only (CONTRACT §2, 04) */}
                <CommentPin who="jonas" x={690} y={176} />
                <CommentPin who="tereza" x={470} y={530} />
              </Canvas>
              <GatorChrome canvas="Uniformy-2027 (Figma)" left="folded" zoom={22} insp={
                <div className="island island--pad k-insp ia-figinsp">
                  <div className="k-insp-hd"><strong>Dres domácí — přední</strong><span className="chip">Artboard</span></div>
                  <div className="k-insp-row"><span>Size</span><span className="ia-num">900 × 1280</span></div>
                  <span className="ia-callout ia-callout--soft"><Icon name="image" size={14} /><span><strong>Figma's exact picture.</strong> Its text and shapes can't be changed until it's made editable.</span></span>
                  <span className="btn btn--sm ia-wide">Make editable</span>
                  <p className="ia-fine">Turns this one artboard into layers. Needs the Figma desktop app open on this file, in Dev Mode — a paid Dev or Full seat.</p>
                </div>
              } extra={
                <Summary style={{ right: 16, bottom: 76 }} title={<>Imported 6 frames from Uniformy-2027</>} adv="node ids · reason codes" rows={[
                  ["ok", "6 artboards, at their Figma sizes, as pictures"],
                  ["ok", "3 comments came across as comments (1 resolved)"],
                  ["warn", "2 fonts not on this Mac — Druk Wide shows as Inter Tight, Gotham as Inter, once made editable"],
                  ["warn", "1 video fill kept as a still"],
                  ["skip", "4 hidden layers left out"],
                ]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-figjam" label="16 · A FigJam board becomes the whiteboard" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="FigJam boards land as stickies, not pictures.">A FigJam link opens in Preview, on the annotation layer: stickies, sections and connectors stay themselves. A widget that can't come across is named; its connector ends at the box.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <span className="ia-banner" style={{ left: 96, top: 62 }}><Icon name="file" size={12} />From FigJam — Nábor 2027 — retro by Tereza</span>
                <span className="ia-wsec" style={{ left: 96, top: 100, width: 360, height: 460 }}><span className="ia-wsec-t">Co fungovalo</span></span>
                <span className="ia-wsec" style={{ left: 486, top: 100, width: 360, height: 460 }}><span className="ia-wsec-t">Co ne</span></span>
                <span className="ia-wsec" style={{ left: 876, top: 100, width: 360, height: 460 }}><span className="ia-wsec-t">Zkusit příště</span></span>
                <svg className="ia-wires" width="1440" height="860" viewBox="0 0 1440 860" aria-hidden="true">
                  <path d="M194 258 L 198 340" />
                  <path d="M586 262 C 600 330, 940 330, 966 262" />
                  <path d="M670 400 C 900 400, 1135 360, 1135 284" />
                  <path className="ia-wire-deg" d="M760 282 C 770 470, 820 500, 896 500" />
                </svg>
                <Sticky color="green" x={116} y={150} rotate={-1.5} w={150}>Plakáty na školách fungovaly</Sticky>
                <Sticky color="green" x={286} y={170} rotate={2} w={150}>Combine: víc trenérů na stanovištích</Sticky>
                <Sticky color="green" x={124} y={340} rotate={1} w={150}>Registrace přes QR — 60 % lidí</Sticky>
                <Sticky color="coral" x={506} y={150} rotate={-1} w={150}>Málo holek na náboru</Sticky>
                <Sticky color="coral" x={680} y={170} rotate={1.5} w={150}>Leták A6 nikdo nečetl</Sticky>
                <Sticky color="coral" x={520} y={340} rotate={-2} w={150}>Pozdě na IG</Sticky>
                <Sticky color="sky" x={896} y={150} rotate={1} w={150}>Ženský tým na Combine</Sticky>
                <Sticky color="sky" x={1060} y={170} rotate={-1.5} w={150}>IG stories místo plakátů</Sticky>
                <span className="ia-widget" style={{ left: 896, top: 476 }}><Icon name="problem" size={14} /><span><strong>Hlasování</strong> — a FigJam widget; it can't come across</span></span>
              </Canvas>
              <GatorChrome canvas="Nábor 2027 — retro" left="folded" zoom={62} tool="sticky" extra={
                <Summary style={{ right: 16, bottom: 76, width: 340 }} title="Imported Nábor 2027 — retro as annotations" adv="node ids · reason codes" rows={[
                  ["ok", "24 stickies, 3 sections, 2 pictures"],
                  ["ok", "8 connectors, still attached"],
                  ["warn", "1 voting widget can't come across — its connector ends at the box"],
                  ["ok", "5 comments → stickies"],
                ]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Import a brand ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="brand" title="Import a brand" subtitle="Menu › File › Import a brand… — drop a logo or type a website; it reads, says what failed, then shows colours with their roles, fonts and a preview">
        <DCArtboard id="ia-brand-steps" label="17 · Drop a logo or type a website · Reading · Couldn't read the site" width={W} height={640} fixed>
          <Closeup title="Give it a logo, a website, or both — it says what it read." sub="Menu › File › Import a brand… — one sheet, from the drop to the result."
            note={<Note n={17} title="A failed website doesn't lose the logo.">Reading takes a few seconds and says which source it's on. When the site doesn't answer, the colours from the logo stay; Try again is the one action.</Note>}>
            <div className="ia-row3">
              <Col label="1 · Drop a logo or type a website">
                <IaSheet flow title="Import a brand" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Import</span></>}>
                  <span className="ia-drop">
                    <span className="ia-src-logo ia-drop-logo"><Logo v="studio" className="ia-fill" /></span>
                    <span><strong>studio-brno-logo.svg</strong><span>Logo · or drop another — SVG, PNG or PDF</span></span>
                  </span>
                  <span className="field"><span className="field-label">Website (optional)</span><span className="input">studio-brno.cz<i className="k-caretline" /></span></span>
                  <p className="ia-fine">Colours come from the logo; fonts and more colours from the website. Nothing changes until you choose.</p>
                </IaSheet>
              </Col>
              <Col label="2 · Reading">
                <IaSheet flow title="Import a brand" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary ia-off">Import</span></>}>
                  <span className="ia-readrow"><StatusWord state="ok">Read</StatusWord><span><strong>studio-brno-logo.svg</strong> — 4 colours</span></span>
                  <span className="ia-readrow"><StatusWord state="busy">Reading…</StatusWord><span><strong>studio-brno.cz</strong> — fonts and colours</span></span>
                  <span className="ia-prog ia-prog--wide"><b style={{ width: "46%" }} /></span>
                  <p className="ia-fine">Usually under 10 seconds. The site is read once; nothing is sent to it.</p>
                </IaSheet>
              </Col>
              <Col label="Edge — the site doesn't answer">
                <IaSheet flow title="Import a brand" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Continue with the logo</span></>}>
                  <span className="ia-readrow"><StatusWord state="ok">Read</StatusWord><span><strong>studio-brno-logo.svg</strong> — 4 colours</span></span>
                  <span className="ia-callout"><Icon name="problem" size={14} /><span><strong>Couldn't read studio-brno.cz.</strong> It didn't answer in 20 s. The logo's colours are kept.</span><span className="btn btn--sm">Try again</span></span>
                  <p className="ia-fine">Without the site, fonts stay as they are — pick one on the next step.</p>
                </IaSheet>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ia-brand" label="18 · Import a brand — use it as the project's style" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="What was found, which role it gets, and a preview.">Four colours from the logo, each with its role — Coral becomes the accent. One font from the website; the logo's lettering is shapes, so the sheet says so.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={300} y={120} w={403} h={252}><HeroMock /></Artboard>
                <Artboard label="Pricing" kind="web" x={743} y={120} w={403} h={252}><HeroMock headline="Simple pricing" sub="Monthly or yearly." cta="Start" /></Artboard>
              </Canvas>
              <StudioChrome />
              <Veil />
              <IaSheet title="Use this brand as Studio site's style?" width={760} actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Use as the project's style</span></>}>
                <div className="ia-brand">
                  <div className="ia-brand-l">
                    <p className="ia-bl">From</p>
                    <span className="ia-src"><span className="ia-src-logo"><Logo v="studio" className="ia-fill" /></span><span><strong>studio-brno-logo.svg</strong><span>Logo · dropped</span></span></span>
                    <span className="ia-src"><span className="ia-src-ic"><Icon name="link" size={14} /></span><span><strong>studio-brno.cz</strong><span>Website · read once</span></span></span>
                    <p className="ia-bl">Colours <span className="ia-bl-n">4 found · click a role to change it</span></p>
                    <span className="ia-swatches maude-v2 k-fixed" data-theme="light">
                      {([["Coral", "coral", "Accent"], ["Ink", "ink", "Text"], ["Paper", "paper", "Background"], ["Sky", "sky", "Second colour"]] as [string, string, string][]).map(([n, c, r]) => (
                        <span key={n} className="ia-swatch"><i className={`ia-sw--${c}`} /><span className="ia-sw-n">{n}</span><span className="ia-sw-r">{r}<Icon name="chevron" size={10} /></span></span>
                      ))}
                    </span>
                    <p className="ia-bl">Fonts</p>
                    <span className="ia-font"><StatusWord state="ok">Found</StatusWord><span><strong>Inter</strong> — headings and text, from the website</span></span>
                    <span className="ia-font"><StatusWord state="warn">Not found</StatusWord><span>The logo's lettering is drawn as shapes, so its font can't be read.</span><span className="btn btn--ghost btn--sm">Pick a font…</span></span>
                  </div>
                  <div className="ia-brand-r">
                    <p className="ia-bl">Preview — Homepage</p>
                    <span className="ia-preview maude-v2 k-fixed" data-theme="light"><HeroMock headline="Calm software, made in Brno." sub="A small studio for product and brand." cta="See the work" /></span>
                    <p className="ia-fine">Your canvases keep their content; colours and type follow the style. Version history keeps the old one.</p>
                  </div>
                </div>
              </IaSheet>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Edge cases ────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When a file is waiting, missing, huge, twice, foreign, offline or someone else's" subtitle="Waiting for Jonas's Mac is quiet; Missing + Relink only when no device has it · a 4K file · a .psd · no internet · Tereza's photo · a Figma file you can't open · no Google key">
        <DCArtboard id="ia-missing" label="19 · Not here yet — Waiting for Jonas's Mac" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Not here yet is quiet, not an error.">acko-hero2.png was added on Jonas's Mac and hasn't synced. The frame keeps its place and name and fills in by itself; Relink… is there only if you have a copy.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 4:5 · MVP" kind="digital" x={300} y={96} w={480} h={600}><MvpPost photo={null} bare /></Artboard>
                <AbsentPic x={300} y={96} w={480} h={432} name="acko-hero2.png" state="waiting" />
                <Artboard label="Story 9:16 · MVP" kind="digital" x={820} y={96} w={338} h={600}><MvpPost photo="portrait" /></Artboard>
              </Canvas>
              <GatorChrome canvas="score-mvp" left="folded" zoom={44} insp={
                <div className="island island--pad k-insp ia-missinsp">
                  <div className="k-insp-hd"><strong>acko-hero2.png</strong><span className="chip">Photo</span></div>
                  <span className="ia-missbox"><StatusWord state="warn">Waiting for Jonas's Mac</StatusWord><span>Added on Jonas's Mac, 2 Oct, 18:12, and not synced yet. Your design is safe — the picture fills in by itself.</span></span>
                  <span className="ia-havecopy"><span>Have it here?</span><span className="btn btn--sm">Relink…</span></span>
                  <Adv hint="assets/7f3e21c4.png" />
                </div>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-missing-gone" label="20 · Missing — no device has it" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="Missing means nobody has it — then Relink is the fix.">partneri-2025.png was removed from Tereza's Mac before it synced, so no device in Alligators brand has it. The frame keeps its place and name; Relink… points at a copy.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Post 4:5 · Partneři" kind="digital" x={300} y={96} w={480} h={600}><MvpPost photo={null} bare label="PARTNEŘI 2026" name="Děkujeme za sezónu" /></Artboard>
                <AbsentPic x={300} y={96} w={480} h={432} name="partneri-2025.png" state="missing" />
                <Artboard label="Post 1:1 · Partneři" kind="digital" x={820} y={96} w={300} h={300}><GatorMock variant="social" headline="DÍKY PARTNERŮM" sub="Sezóna 2026" /></Artboard>
              </Canvas>
              <GatorChrome canvas="sponsors" left="folded" zoom={44} insp={
                <div className="island island--pad k-insp ia-missinsp">
                  <div className="k-insp-hd"><strong>partneri-2025.png</strong><span className="chip">Photo</span></div>
                  <span className="ia-missbox ia-missbox--gone"><StatusWord state="error">Missing</StatusWord><span>Added by Tereza on 1 Oct and removed from her Mac before it synced. No device has it now; the rest of the design is safe.</span></span>
                  <span className="ia-pi-acts"><span className="btn btn--sm btn--primary">Relink…</span><span className="btn btn--sm">Replace…</span></span>
                  <Adv hint="assets/c1658844.png" />
                </div>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ia-edges" label="21 · Huge · twice · .psd · offline · Tereza's · a link · Figma access · no Google key · HEIC" width={W} height={1340} fixed>
          <Closeup title="Nine awkward arrivals, each answered in one line." sub="What happened · what is safe · one verb at most."
            note={<Note n={21} title="Nothing blocks the canvas.">A huge file prepares while you work; a second copy is reused; an odd file type comes in as the picture it holds. Offline imports wait on this Mac. Shared assets say whose they are; a missing key is asked for once.</Note>}>
            <div className="ia-cases">
              <Case n="A" title="A 500 MB 4K clip" say={<>Preparing <strong>stadion-dron-4K.mov</strong> — keeps working in the background. About 4 min.</>}>
                <span className="ia-clipcard ia-clipcard--lg">
                  <Pic v="dron" className="ia-fill" />
                  <span className="ia-prep"><span className="ia-prep-w"><Icon name="sync" size={11} />Preparing… 38 %</span><span className="ia-prog"><b style={{ width: "38%" }} /></span></span>
                  <span className="ia-capt ia-capt--in maude-v2 k-fixed" data-theme="light">stadion-dron-4K.mov · 512 MB</span>
                </span>
              </Case>
              <Case n="B" title="The same photo, dropped again" say={<>IMG_2231.jpg is already in Assets — placed the same one, not a copy.</>}>
                <span className="ia-dup">
                  <span className="ia-dup-a"><Pic v="td" className="ia-fill" /></span>
                  <span className="ia-dup-eq"><Icon name="link" size={14} /></span>
                  <span className="ia-dup-b"><Pic v="td" className="ia-fill" /><span className="ia-dup-tag">Used in 5 canvases now</span></span>
                </span>
              </Case>
              <Case n="C" title="A Photoshop file" say={<>Its flat picture is placed; the layers stay in Photoshop. A .psd without one asks for a PNG or JPG.</>}>
                <span className="ia-psdrow">
                  <span className="ia-psd"><Icon name="file" size={22} /><span>dres-2027-final.psd</span></span>
                  <Icon name="submenu" size={14} />
                  <span className="ia-psd-pic"><Pic v="portrait" className="ia-fill" /></span>
                </span>
                <span className="island ia-casetoast"><Icon name="done" size={16} /><span>Placed the flat picture from dres-2027-final.psd. Its layers stay in Photoshop.</span></span>
              </Case>
              <Case n="D" title="Dropped while offline" say={<>Kept on this Mac — goes up by itself once it's online.</>}>
                <span className="ia-offrow">
                  <Tile v="huddle" state="local" /><Tile v="crowd" state="local" /><Tile v="kick" state="local" />
                </span>
                <span className="ia-offst"><ShareCluster people={[]} status="offline" panelsButton={false} mode="edit" style={{ position: "relative", right: "auto", top: "auto" }} /></span>
              </Case>
              <Case n="E" title="Tereza's photo in a shared project">
                <span className="island ia-whose">
                  <span className="ia-whose-pic"><Pic v="crowd" className="ia-fill" /></span>
                  <span className="ia-whose-t">
                    <span className="ia-who"><Avatar who="tereza" size="sm" /><strong>Added by Tereza</strong></span>
                    <span>Yesterday, 18:20 · from her Mac</span>
                    <span>Used in 2 canvases · yours and hers</span>
                    <span className="ia-fine">A look you set changes only your use. Hers stays as she left it.</span>
                  </span>
                </span>
              </Case>
              <Case n="F" title="A link instead of a file" say={<>Saved a copy from the link — the page can change, your copy won't.</>}>
                <span className="ia-linkdrop">
                  <span className="input ia-mono">alligators.cz/foto/combine-2025-12.jpg</span>
                  <Icon name="chevron" size={14} />
                  <span className="ia-linkdrop-pic"><Pic v="huddle" className="ia-fill" /></span>
                </span>
              </Case>
              <Case n="G" title="A Figma file you can't open" say={<>Nothing is imported until it opens; the link stays in the sheet.</>}>
                <IaSheet flow title="Import from Figma" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary ia-off">Import</span></>}>
                  <span className="input ia-mono ia-oneline">figma.com/design/Zt71q…/Dresy-archiv</span>
                  <span className="ia-callout"><Icon name="lock" size={14} /><span><strong>Your Figma account can't open this file.</strong> Ask its owner to share it with you, then paste the link again.</span></span>
                </IaSheet>
              </Case>
              <Case n="H" title="Generate, with no Google key yet" say={<>After Connect, the waiting prompt runs — nothing to type again.</>}>
                <IaSheet flow title="Connect a Google key?" width="100%" actions={<><span className="btn">Cancel</span><span className="btn btn--primary">Connect</span></>}>
                  <p>Connect a Google AI key to make this image. Images are billed to your own key; the cloud plan doesn't include them.</p>
                </IaSheet>
              </Case>
              <Case n="I" title="An iPhone HEIC photo" say={<>IMG_5012.HEIC came in as a JPG the canvas can show. The original stays under Advanced.</>}>
                <span className="ia-psdrow">
                  <span className="ia-psd"><Icon name="image" size={22} /><span>IMG_5012.HEIC</span></span>
                  <Icon name="submenu" size={14} />
                  <span className="ia-psd-pic"><Pic v="huddle" className="ia-fill" /></span>
                </span>
              </Case>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 8 · Advanced ──────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced — file names, sidecars, the command" subtitle="One disclosure away in an asset's details: the fingerprint name, the original path, the per-use edits as a sidecar file, the maude command">
        <DCArtboard id="ia-advanced" label="22 · Under Advanced — how assets are stored" width={W} height={H} fixed>
          <Closeup title="Under Advanced: one file per picture, named by a fingerprint of the file." sub="Same bytes, same name — that's how a second drop is reused. Edits are kept per use, next to the file; the original is never touched."
            note={<Note n={22} title="Mono, paths and commands live only here.">The details' Advanced shows the stored name, where the photo came from, and the sidecar files beside it. The command imports the same way from a terminal or from Claude Code.</Note>}>
            <div className="ia-advrow">
              <Col label="Asset details › Advanced">
                <Details className="ia-rel ia-dt--wide">
                  <span className="ia-dt-pic ia-dt-pic--short"><Pic v="cutout" className="ia-fill ia-pic--ongreen" /></span>
                  <p className="ia-dt-name">IMG_2247.jpg</p>
                  <DRow k="Edits">MVP zápasu — Punchy, background removed · 3 other uses untouched</DRow>
                  <Adv hint="" open>
                    <ARow k="Stored as" copy>assets/d34bb59d.jpg</ARow>
                    <ARow k="Original">~/Pictures/Alligators/2026-09-27 Panthers/IMG_2247.jpg</ARow>
                    <ARow k="Edits">assets/d34bb59d.photo.json</ARow>
                    <ARow k="Cut-out">assets/0a293589.png</ARow>
                    <ARow k="In canvases">{`<img src="assets/d34bb59d.jpg">`}</ARow>
                    <span className="ia-cmd"><span className="ia-cmd-h">Import the same way from Terminal</span><span className="ia-cmd-l"><span className="k-mono">maude design import-asset ~/Pictures/…/IMG_2247.jpg --kind raster</span><span className="chip">Copy</span></span></span>
                  </Adv>
                </Details>
              </Col>
              <Col label=".design/assets — what's on disk" className="ia-col--grow">
                <div className="island island--pad ia-files">
                  <p className="ia-files-h"><Icon name="folder" size={14} /><span className="k-mono">.design/assets/</span><span className="ia-files-n">247 assets · 31 sidecars · 14 caption files</span></p>
                  {([
                    ["image", "d34bb59d.jpg", "Photo · IMG_2247.jpg", "2.8 MB"],
                    ["file", "d34bb59d.photo.json", "Your edits, per use — placement, look, background", "1 KB"],
                    ["image", "0a293589.png", "The cut-out mask from Remove background", "420 KB"],
                    ["video", "11abf029.mp4", "Clip · Made by AI (Google)", "6.2 MB"],
                    ["file", "11abf029.footage.json", "What AI saw — shots, good moments, tags", "2 KB"],
                    ["file", "1eaa4c44.srt", "Captions for a clip", "1 KB"],
                    ["play", "2a886bcf.mp3", "Hype beat · Made by AI (ElevenLabs)", "240 KB"],
                    ["file", "2a886bcf.audio.json", "Its prompt, provider and date", "1 KB"],
                    ["image", "5557daf0.svg", "Logo · gator_badge_roundel.svg, cleaned for the canvas", "8 KB"],
                    ["video", "7c40e2b1.mov", "Clip · combine-40yd.mov — the original, full size", "412 MB"],
                    ["folder", "footage/", "Light copies the video cut plays — footage/7c40e2b1.mp4 is combine-40yd's", "96 MB"],
                  ] as [string, string, string, string][]).map(([ic, n, d, s]) => (
                    <span key={n} className={`ia-file-row${n.endsWith(".json") || n.endsWith(".srt") ? " ia-file-row--side" : ""}`}>
                      <Icon name={ic} size={13} />
                      <span className="k-mono ia-file-n">{n}</span>
                      <span className="ia-file-d">{d}</span>
                      <span className="ia-file-s">{s}</span>
                    </span>
                  ))}
                  <p className="ia-fine ia-files-foot">Every file is named by its fingerprint, originals too: combine-40yd.mov is <span className="k-mono">assets/7c40e2b1.mov</span>. Only footage/ is a folder — it keeps the light copies the video cut plays (<span className="k-mono">assets/footage/7c40e2b1.mp4</span>). Sidecars travel with their file. Other verbs: <span className="k-mono">fetch-asset · photo-adjust · photo-bg-remove · generate · ingest-footage · transcribe · import-figma · import-brand</span>.</p>
                </div>
                <div className="island island--pad ia-json">
                  <p className="ia-json-h"><Icon name="file" size={14} /><span className="k-mono">d34bb59d.photo.json</span><span className="ia-files-n">edits per use, as data — the photo itself is untouched</span></p>
                  <pre>{`{
  "version": 2,
  "source": "assets/d34bb59d.jpg",
  "uses": {
    "social/matchday#post-mvp-zapasu": {
      "placement": "fill", "look": "punchy",
      "backgroundRemoved": { "maskAsset": "assets/0a293589.png" }
    }
  },
  "everyUse": null
}`}</pre>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
