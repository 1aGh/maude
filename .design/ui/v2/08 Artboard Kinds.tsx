/**
 * @canvas      08 Artboard Kinds — fixed-size (App, Social), web page, print and video artboards, told on Alligators brand
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ak-picker | ak-picker-full |
 *              ak-web-hug | ak-web-widths |
 *              ak-social | ak-safe-zones |
 *              ak-print-letak | ak-print-view |
 *              ak-video |
 *              ak-mixed-fit | ak-mixed-filter | ak-mixed-select | ak-convert | ak-convert-after | ak-warnings |
 *              ak-advanced | ak-real-about | ak-real-print | ak-real-web
 * @brief       "artboard kinds print/web/digital/video atd." — drawn as edge cases on Alligators brand
 *              (LetakA6: 4 print artboards front/back; Combine-kampan as it really is: 21 artboards,
 *              19 fixed size + 2 print sheets).
 *
 * Words: the picker groups by WHAT YOU'RE MAKING — App · Web page · Social · Print · Video — but the
 * product has four kinds. App and Social both make the `digital` kind, whose one designer word is
 * "Fixed size" (picker badge, legend, filter chip, inspector chip, notes). Never "Screen".
 *
 * Convention (same as 01): every app artboard is a <Stage> — a 1440 × 900 window with its note strip
 * underneath (artboard 1440 × 980). Close-ups are sized to content with the note at the foot. Section 7
 * puts REAL canvas-lib artboards (kind="print" with a `print` prop, kind="web" with hug height) next to
 * the mocks — sizes come from resolvePrintArtboard (A6 + 3 mm bleed = 419 × 581 px), never guessed.
 * The user's designs (flyer, matchday, club web page, score card, plan) pin themselves to the light
 * palette (.maude-v2.k-fixed) so they never re-colour with the app theme.
 * All chrome comes from ./_kit; local pieces use the `ak-` prefix.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./_video.css";
import "./08 Artboard Kinds.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Canvas, CommentPin, Dialog, GatorMock, Icon, InButton, InFill, InNum, InSeg, InSelect, InSize, InSwitch,
  Inspector, KindGlyph, Note, PanelIcon, ProjectMenu, ProjectPill, Selection, ShareCluster, Stage, TABS, Thumb,
  Toast, Toolbar, V2, Veil, VideoFrameMock, Window, ZoomUndo,
} from "./_kit";
import type { Art, Kind } from "./_kit";
import { HYPE, Still, Timeline, VideoInspector } from "./_video";

const W = 1440;
const H = 980;
const GATOR_TABS = [TABS.studio, TABS.alligators];

/** The one designer word per kind. `digital` = "Fixed size" everywhere (App and Social both make it). */
const KIND_WORD: Record<Kind, string> = { digital: "Fixed size", web: "Web page", print: "Print", video: "Video" };

/* Print geometry — from apps/studio/print/units.ts resolvePrintArtboard (96 px/in, rounded):
   A6 portrait + 3 mm bleed → artboard 419 × 581 px, trim 397 × 559 px, bleed 11 px, 5 mm margin 19 px.
   A4 landscape + 3 mm bleed → 1145 × 816 px (Alligators' Combine-kampan hand-typed 1144 — see ak-warnings). */
const A6 = { w: 419, h: 581, bleed: 11, margin: 19 };

/* ═══ Alligators content (the user's designs — object colours, Czech copy, theme-pinned) ═════ */

/** Every user-design root carries this: the design keeps its own light palette in a dark app. */
const FIXED = "maude-v2 k-fixed";

/** A tiny QR code drawn from squares. */
function Qr() {
  return <span className="ak-qr" aria-hidden="true"><i /><i /><i /><b /></span>;
}

/** Náborový leták A6 — front (FLAG/TACKLE) or back. Scales with its box (container units). */
function Flyer({ side = "a", variant = "flag", qrOut = false }: { side?: "a" | "b"; variant?: "flag" | "tackle"; qrOut?: boolean }) {
  if (side === "b") {
    return (
      <div className={`ak-fly ak-fly--b ${FIXED}`} data-theme="light">
        <span className="ak-fly-mark" />
        <strong className="ak-fly-h ak-fly-h--sm">{variant === "flag" ? "Hraj s námi flag" : "35 let zelené krve"}</strong>
        <span className="ak-fly-rows">
          <span><b>U11</b>9–11 let · ÚT 17:00</span>
          <span><b>U13</b>11–13 let · ČT 17:00</span>
          <span><b>U15</b>13–15 let · ÚT + ČT</span>
          <span><b>U18</b>15–18 let · PO + ST</span>
        </span>
        <span className="ak-fly-foot">alligators.cz/nabor · Kraví hora, Brno</span>
      </div>
    );
  }
  return (
    <div className={`ak-fly ak-fly--a ${FIXED}`} data-theme="light">
      <span className="ak-fly-band" />
      <span className="ak-fly-top"><span className="ak-fly-mark" />BRNO ALLIGATORS</span>
      <strong className="ak-fly-h">{variant === "flag" ? <>VYZKOUŠEJ<br />FLAG<br />FOOTBALL</> : <>STAŇ SE<br />GATOREM</>}</strong>
      <span className="ak-fly-sub">{variant === "flag" ? "Od 9 let · bez kontaktu · první trénink zdarma" : "Od 15 let · tackle · výstroj zapůjčíme"}</span>
      <span className={`ak-fly-qr${qrOut ? " ak-fly-qr--out" : ""}`}><Qr /><span>Tréninky ÚT a ČT 17:00<br />Kraví hora</span></span>
    </div>
  );
}

/** Matchday graphic — post (1:1) or story (9:16). Absolute-first: every piece placed freely. */
function Gameday({ format = "post" }: { format?: "post" | "story" }) {
  return (
    <div className={`ak-gd ak-gd--${format} ${FIXED}`} data-theme="light">
      <span className="ak-gd-field" />
      <span className="ak-gd-player" />
      <span className="ak-gd-tag">GAMEDAY</span>
      <strong className="ak-gd-h">ALLIGATORS<br />× LIONS</strong>
      <span className="ak-gd-date">So 4. 10. · 15:00 · Kraví hora</span>
      {format === "story" ? <span className="ak-gd-cta">Vstupenky na webu</span> : null}
    </div>
  );
}

/** Club web page — flow layout, container-responsive (reflows by its own width, not the window's). */
function ClubPage({ added = false, fresh = true, wide = false, warn = false, nav = true }: { added?: boolean; fresh?: boolean; wide?: boolean; warn?: boolean; nav?: boolean }) {
  return (
    <div className={`ak-web${wide ? " ak-web--wide" : ""} ${FIXED}`} data-theme="light">
      <div className="ak-web-in">
        {nav ? <div className="ak-web-nav"><span className="ak-fly-mark" /><b>BRNO ALLIGATORS</b><i /><i /><i /><em>ZAPIŠ SE</em></div> : null}
        <div className="ak-web-hero">
          <div className="ak-web-copy"><strong>35 let amerického fotbalu v Brně</strong><span>Nábor 2027 · flag od 9 let, tackle od 15</span><em>Přijď na trénink</em></div>
          <span className="ak-web-pic" />
        </div>
        <div className="ak-web-next"><span>Nejbližší zápas</span><strong>Alligators × Lions · So 15:00</strong></div>
        {added ? (
          <div className="ak-web-sched" data-new={fresh ? "true" : undefined}>
            <span className="ak-web-st">Rozpis zápasů</span>
            {["So 4. 10. · Lions", "So 18. 10. · Steelers", "So 1. 11. · Hippos"].map((r) => <span className="ak-web-row" key={r}>{r}<i /></span>)}
          </div>
        ) : null}
        <div className="ak-web-cards"><i /><i /><i /></div>
        <div className={`ak-web-partners${warn ? " ak-web-partners--warn" : ""}`}><span>Partneři</span><span className="ak-web-logos"><i /><i /><i /><i /><i /><i /></span></div>
        <div className="ak-web-foot" />
      </div>
    </div>
  );
}

/** Výsledková karta — A4 landscape sheet folded to A5. */
function Karta({ arch = 1 }: { arch?: 1 | 2 }) {
  return (
    <div className={`ak-karta ${FIXED}`} data-theme="light">
      {arch === 1 ? (
        <>
          <span className="ak-karta-half ak-karta-half--ink"><span className="ak-fly-mark" /></span>
          <span className="ak-karta-half"><i /><i /><i /></span>
        </>
      ) : (
        <>
          <span className="ak-karta-half ak-karta-grid"><i /><i /><i /><i /></span>
          <span className="ak-karta-half ak-karta-grid"><i /><i /><i /><i /></span>
        </>
      )}
    </div>
  );
}

/** Release plan — a planning sheet kept as an artboard. */
function Plan() {
  return <div className={`ak-plan ${FIXED}`} data-theme="light"><strong>Release plan</strong><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>;
}

/** The 4:5 post scaled into an A6 sheet: the art keeps its width, the extra height is the Ink fill. */
function A6Copy() {
  return (
    <div className={`ak-a6 ${FIXED}`} data-theme="light">
      <div className="ak-a6-art"><GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT · 9:00" /></div>
      <span className="ak-a6-seam" />
    </div>
  );
}

/* ═══ Overlays drawn on artboards ═════════════════════════════════════════════════════════════ */

/** Bleed (tint outside the trim), trim (solid) and safe margin (dashed) — positioned in % of the
 *  artboard so it works at any zoom. Geometry from resolvePrintArtboard (A6 by default). */
function PrintGuides({ w = A6.w, h = A6.h, bleed = A6.bleed, margin = A6.margin, cols }: { w?: number; h?: number; bleed?: number; margin?: number; cols?: number }) {
  const t = { x: (bleed / w) * 100, y: (bleed / h) * 100 };
  const m = { x: ((bleed + margin) / w) * 100, y: ((bleed + margin) / h) * 100 };
  return (
    <span className="ak-pg" aria-hidden="true">
      {cols ? (
        <span className="ak-pg-cols" style={{ inset: `${m.y}% ${m.x}%` }}>{Array.from({ length: cols }, (_, i) => <i key={i} />)}</span>
      ) : null}
      <span className="ak-pg-trim" style={{ inset: `${t.y}% ${t.x}%` }} />
      <span className="ak-pg-margin" style={{ inset: `${m.y}% ${m.x}%` }} />
    </span>
  );
}

/** Where Instagram's own UI covers a 9:16 artboard. Bands in % of 1080 × 1920. */
function SafeZones({ kind = "story", labels = true }: { kind?: "story" | "reels"; labels?: boolean }) {
  const z = kind === "story" ? { top: 13, bottom: 17.7, right: 0 } : { top: 11.5, bottom: 21.9, right: 13 };
  return (
    <span className="ak-sz" aria-hidden="true">
      <span className="ak-sz-band ak-sz-band--top" style={{ height: `${z.top}%` }}>{labels ? <span>Profile and progress bar</span> : null}</span>
      <span className="ak-sz-band ak-sz-band--bottom" style={{ height: `${z.bottom}%` }}>{labels ? <span>{kind === "story" ? "Reply bar" : "Caption and audio"}</span> : null}</span>
      {z.right ? <span className="ak-sz-band ak-sz-band--right" style={{ top: `${z.top}%`, bottom: `${z.bottom}%`, width: `${z.right}%` }}>{labels ? <span>Buttons</span> : null}</span> : null}
    </span>
  );
}

/** Where a freshly picked preset will land — dashed, labelled, not yet an artboard. */
function Ghost({ label, kind, size, x, y, w, h }: { label: string; kind: Kind; size: string; x: number; y: number; w: number; h: number }) {
  return (
    <div className="ak-ghost" style={{ left: x, top: y, width: w, height: h }}>
      <span className="ak-ghost-name"><Icon name={kind} size={11} />{label}<span className="ak-ghost-size">{size}</span></span>
    </div>
  );
}

/** A warning mark beside an artboard's label (same canvas coords as the artboard). */
function LabelWarn({ x, y, title }: { x: number; y: number; title: string }) {
  return <span className="ak-lw" style={{ left: x, top: y }} title={title}><Icon name="problem" size={11} /></span>;
}

/* ═══ The size picker (kit candidate) ═════════════════════════════════════════════════════════ */

type GroupId = "app" | "web" | "social" | "print" | "video";
type Preset = { name: string; size: string; ar: [number, number]; top?: boolean };
type Group = { id: GroupId; kind: Kind; title: string; icon: string; badge: string; presets: Preset[] };
const GROUPS: Group[] = [
  {
    id: "app", kind: "digital", title: "App", icon: "laptop", badge: "Fixed size",
    presets: [
      { name: "Desktop", size: "1440 × 1024", ar: [1440, 1024], top: true },
      { name: "Laptop", size: "1280 × 800", ar: [1280, 800], top: true },
      { name: "Mobile", size: "390 × 844", ar: [390, 844], top: true },
      { name: "Tablet", size: "834 × 1194", ar: [834, 1194] },
    ],
  },
  {
    id: "web", kind: "web", title: "Web page", icon: "web", badge: "Grows as you add",
    presets: [
      { name: "Desktop", size: "1440 wide", ar: [1440, 0], top: true },
      { name: "Tablet", size: "834 wide", ar: [834, 0], top: true },
      { name: "Mobile", size: "390 wide", ar: [390, 0], top: true },
      { name: "Laptop", size: "1280 wide", ar: [1280, 0] },
    ],
  },
  {
    id: "social", kind: "digital", title: "Social", icon: "image", badge: "Fixed size",
    presets: [
      { name: "Post 4:5", size: "1080 × 1350", ar: [4, 5], top: true },
      { name: "Story 9:16 (still)", size: "1080 × 1920", ar: [9, 16], top: true },
      { name: "FB event cover", size: "1920 × 1005", ar: [1920, 1005], top: true },
      { name: "Post 1:1", size: "1080 × 1080", ar: [1, 1] },
      { name: "Link preview", size: "1200 × 630", ar: [1200, 630] },
      { name: "YouTube thumbnail", size: "1280 × 720", ar: [16, 9] },
    ],
  },
  {
    id: "print", kind: "print", title: "Print", icon: "print", badge: "mm, with bleed",
    presets: [
      { name: "A4", size: "210 × 297 mm", ar: [210, 297], top: true },
      { name: "A5", size: "148 × 210 mm", ar: [148, 210], top: true },
      { name: "A6", size: "105 × 148 mm", ar: [105, 148], top: true },
      { name: "Letter", size: "8.5 × 11 in", ar: [85, 110] },
      { name: "A3", size: "297 × 420 mm", ar: [297, 420] },
      { name: "A2", size: "420 × 594 mm", ar: [420, 594] },
      { name: "Business card", size: "85 × 55 mm", ar: [85, 55] },
    ],
  },
  {
    id: "video", kind: "video", title: "Video", icon: "video", badge: "Has a timeline",
    presets: [
      { name: "Reels 9:16 (moving)", size: "1080 × 1920", ar: [9, 16], top: true },
      { name: "Landscape 16:9", size: "1920 × 1080", ar: [16, 9], top: true },
      { name: "Square 1:1", size: "1080 × 1080", ar: [1, 1], top: true },
    ],
  },
];
const RECENT: [string, Kind][] = [["FB event cover", "digital"], ["Post 4:5", "digital"], ["A6", "print"]];

/** The size drawn as a tiny picture: closed box = fixed size; open, fading box = grows; dashed inner
 *  line = bleed; play mark = has a timeline. */
function Shape({ g, ar }: { g: Group; ar: [number, number] }) {
  const MW = 64;
  const MH = 34;
  let w: number;
  let h: number;
  if (g.kind === "web") {
    w = Math.max(10, Math.round((ar[0] / 1440) * MW));
    h = 26;
  } else {
    const r = ar[0] / ar[1];
    if (r >= MW / MH) { w = MW; h = Math.max(8, Math.round(MW / r)); } else { h = MH; w = Math.max(8, Math.round(MH * r)); }
  }
  return (
    <>
      <span className="ak-shape" data-k={g.kind} style={{ width: w, height: h }}>
        {g.kind === "video" ? <Icon name="play" size={10} /> : null}
      </span>
      {g.kind === "web" ? <span className="ak-shape-more"><Icon name="chevron" size={11} /></span> : null}
    </>
  );
}

function Tile({ p, g, hl }: { p: Preset; g: Group; hl?: boolean }) {
  return (
    <span className="ak-tile" data-hl={hl ? "true" : undefined} data-k={g.kind}>
      <span className="ak-tile-pic"><Shape g={g} ar={p.ar} /></span>
      <span className="ak-tile-name">{p.name}</span>
      <span className="ak-tile-size">{p.size}</span>
    </span>
  );
}

function Badge({ g }: { g: Group }) {
  const tone = g.kind === "web" ? "grow" : g.kind === "digital" ? "fixed" : "plain";
  return (
    <span className="ak-badge" data-tone={tone}>
      {tone === "fixed" ? <Icon name="lock" size={10} /> : tone === "grow" ? <Icon name="chevron" size={10} /> : null}
      {g.badge}
    </span>
  );
}

/** The new-artboard picker: F over empty canvas. Tiles grouped by what you're making; three common
 *  sizes up front, "All N" opens the rest. Picking a tile sets the artboard's kind. */
function SizePicker({ hl, open, custom = false, style, wide = false }: { hl?: string; open?: GroupId; custom?: boolean; style?: CSSProperties; wide?: boolean }) {
  return (
    <div className={`k-menu ak-sp${wide ? " ak-sp--static" : ""}`} style={style}>
      <span className="k-find ak-sp-find">
        <Icon name="search" size={14} />
        <span className="k-find-q k-find-ph">Search sizes — “A5”, “story”, “1920”</span>
      </span>
      <div className="ak-sp-recent">
        <span className="ak-sp-rl">Recent</span>
        {RECENT.map(([n, k]) => <span className="ak-rc" key={n} title={`${n} · ${KIND_WORD[k]}`}><Icon name={k} size={11} />{n}</span>)}
      </div>
      {GROUPS.map((g) => {
        const expanded = open === g.id;
        const tops = g.presets.filter((p) => p.top);
        const shown = expanded ? g.presets : tops;
        const more = g.presets.length - tops.length;
        return (
          <div className="ak-sp-g" key={g.id} data-open={expanded ? "true" : undefined}>
            <span className="ak-sp-h">
              <span className="ak-sp-ic"><Icon name={g.icon} size={13} /></span>
              <span className="ak-sp-t">{g.title}</span>
              <Badge g={g} />
              {more ? <span className="ak-sp-all">{expanded ? "Fewer" : `All ${g.presets.length}`}<Icon name={expanded ? "chevron" : "submenu"} size={11} /></span> : null}
            </span>
            <div className="ak-sp-tiles">
              {shown.map((p) => <Tile key={p.name} p={p} g={g} hl={hl === `${g.id}:${p.name}`} />)}
              {g.id === "print" && expanded ? (
                <span className="ak-tile ak-tile--custom" data-hl={custom ? "true" : undefined}>
                  <span className="ak-tile-pic"><span className="ak-shape ak-shape--custom"><Icon name="plus" size={12} /></span></span>
                  <span className="ak-tile-name">Custom size…</span>
                  <span className="ak-tile-size">mm, any bleed</span>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      <span className="ak-sp-foot">Or press F and drag to draw any size.</span>
    </div>
  );
}

/* ═══ Kind filter (kit candidate) ═════════════════════════════════════════════════════════════ */

/** Kind filter — chips with counts, shared by Layers and Canvases. The active chip shows its word. */
function KindChips({ counts, on = "all" }: { counts: Record<"all" | Kind, number>; on?: "all" | Kind }) {
  const order: ("all" | Kind)[] = ["all", "digital", "web", "print", "video"];
  return (
    <span className="ak-chips">
      {order.map((k) => {
        const word = k === "all" ? "All" : KIND_WORD[k];
        return (
          <span key={k} className="chip ak-chip" data-on={on === k ? "true" : undefined} data-zero={counts[k] === 0 ? "true" : undefined} title={`${word} · ${counts[k]}`} aria-label={`${word}, ${counts[k]}`}>
            {k === "all" ? null : <Icon name={k} size={12} />}
            {k === "all" || on === k ? <span className="ak-chip-w">{word}</span> : null}
            <span className="ak-chip-n">{counts[k]}</span>
          </span>
        );
      })}
    </span>
  );
}

/** A Canvases/Layers panel with the kind filter under the switch (local — kit CanvasesPanel has no filter). */
function FilterPanel({ tab, on, counts, children, foot, style }: { tab: "canvases" | "layers"; on: "all" | Kind; counts: Record<"all" | Kind, number>; children: ReactNode; foot?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="island k-cp ak-fp" style={style}>
      <div className="k-cp-hd">
        <span className="seg k-seg">
          <span className="k-seg-b" aria-pressed={tab === "canvases"}>Canvases</span>
          <span className="k-seg-b" aria-pressed={tab === "layers"}>Layers</span>
        </span>
        <span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span>
      </div>
      <KindChips counts={counts} on={on} />
      <div className="k-cp-list">{children}</div>
      {foot ? <p className="ak-fp-foot">{foot}</p> : null}
    </div>
  );
}
function LayerRow({ name, kind, current, dim }: { name: string; kind: Kind; current?: boolean; dim?: boolean }) {
  return (
    <span className={`row-item k-ly ak-lrow${dim ? " ak-lrow--dim" : ""}`} aria-current={current ? "true" : undefined}>
      <span className="k-ly-ic"><Icon name={kind} size={14} /></span>
      <span className="k-cp-name">{name}</span>
    </span>
  );
}
function CanvasHit({ name, path, art, kinds, count }: { name: string; path: string; art: Art; kinds: Kind[]; count: string }) {
  return (
    <span className="row-item k-cp-row ak-hit">
      <Thumb art={art} className="k-thumb--row" />
      <span className="ak-hit-txt"><span className="k-cp-name">{name}</span><span className="ak-hit-path">{path}</span></span>
      <span className="k-cp-badges">{kinds.map((k) => <KindGlyph key={k} kind={k} size={11} />)}<span className="k-cp-meta">{count}</span></span>
    </span>
  );
}

/* ═══ Warnings — one home: a row at the top of the artboard's inspector + a mark on its label ══ */

/** An inspector row that warns: what and where, one verb. Never a modal. */
function InWarn({ children, action }: { children: ReactNode; action?: string }) {
  return (
    <span className="ak-iw">
      <span className="ak-iw-ic"><Icon name="problem" size={14} /></span>
      <span className="ak-iw-t">{children}</span>
      {action ? <span className="btn btn--ghost btn--sm ak-iw-a">{action}</span> : null}
    </span>
  );
}

/** A plain line inside the convert dialog's "Check after" list (the same text later lands in the inspector). */
function CheckLine({ children }: { children: ReactNode }) {
  return <p className="ak-check"><span className="ak-iw-ic"><Icon name="problem" size={14} /></span><span>{children}</span></p>;
}

/** Inspector value: a short plain-words note on the right of a row. */
function InNote({ children }: { children: ReactNode }) {
  return <span className="ak-in-note">{children}</span>;
}

/* ═══ Video ═══════════════════════════════════════════════════════════════════════════════════
   The video artboard's timeline is 07 Video Editing's compact timeline, imported from ./_video
   (07 is its source of truth). Same canvas geometry as 07 · 2: Reels centre at x 539. */
const AK_VIDEO_CX = 539;

/* ═══ Combine-kampan as it really is — 21 artboards (19 fixed size, 2 print), at fit ≈ 7 % ═════
   Rows follow the real file's sections: plan · event (3 FB covers, the hand-made safe-zone check,
   the IG announcement) · disciplines carousel (cover + 7 slides + overview) · posts and stories ·
   the score card (two A4-landscape print sheets). Sizes = real px × 0.065. */

type KA = { id: string; label: string; kind: Kind; x: number; y: number; w: number; h: number; body: ReactNode };
const S = 0.065;
const sc = (n: number) => Math.round(n * S);
const P = { w: sc(1080), h: sc(1350) };
const ST = { w: sc(1080), h: sc(1920) };
const EV = { w: sc(1920), h: sc(1005) };
const SLIDES = ["40 YARD DASH", "BENCH PRESS", "VERTICAL JUMP", "BROAD JUMP", "3-CONE DRILL", "20-YARD SHUTTLE", "POSITION DRILLS"];
const KAMPAN_COUNTS = { all: 21, digital: 19, web: 0, print: 2, video: 0 } as const;

function kampan(dx = 0, dy = 0): KA[] {
  const x0 = 330;
  const gap = 10;
  const y1 = 96;
  const y2 = y1 + sc(2760) + 34;
  const y3 = y2 + P.h + 34;
  const y4 = y3 + P.h + 34;
  const y5 = y4 + ST.h + 34;
  const list: KA[] = [
    { id: "plan", label: "Release plan · Combine 2026 (4 týdny)", kind: "digital", x: x0, y: y1, w: sc(1920), h: sc(2760), body: <Plan /> },
    { id: "fbA", label: "FB event cover · FB Event · 1.91:1", kind: "digital", x: x0, y: y2, w: EV.w, h: EV.h, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
    { id: "fbB", label: "FB event cover · varianta B, datum vpředu", kind: "digital", x: x0 + (EV.w + gap), y: y2, w: EV.w, h: EV.h, body: <GatorMock variant="web" headline="ST 1. 10. · 9:00" sub="" /> },
    { id: "fbC", label: "FB event cover · varianta C, žlutá", kind: "digital", x: x0 + 2 * (EV.w + gap), y: y2, w: EV.w, h: EV.h, body: <GatorMock variant="invite" headline="COMBINE 2026" sub="" /> },
    { id: "fbSafe", label: "FB event cover · kontrola safe zóny (nenahrávat)", kind: "digital", x: x0 + 3 * (EV.w + gap), y: y2, w: EV.w, h: EV.h, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
    { id: "ig", label: "Oznámení události · Instagram · IG Post · 4:5", kind: "digital", x: x0 + 4 * (EV.w + gap), y: y2, w: P.w, h: P.h, body: <GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT" /> },
    { id: "disc0", label: "Carousel cover · sedm disciplín · IG Post · 4:5", kind: "digital", x: x0, y: y3, w: P.w, h: P.h, body: <GatorMock variant="poster" headline="SEDM DISCIPLÍN" sub="" /> },
    ...SLIDES.map((d, i): KA => ({ id: `disc${i + 1}`, label: `Slide 0${i + 1} · ${d} · IG Post · 4:5`, kind: "digital", x: x0 + (i + 1) * (P.w + gap), y: y3, w: P.w, h: P.h, body: <GatorMock variant="numbers" headline={d} /> })),
    { id: "disc8", label: "Přehled všech sedmi · IG Post · 4:5", kind: "digital", x: x0 + 8 * (P.w + gap), y: y3, w: P.w, h: P.h, body: <GatorMock variant="numbers" headline="PŘEHLED" /> },
    { id: "post", label: "Pozvánka na combine · IG Post · 4:5", kind: "digital", x: x0, y: y4, w: P.w, h: P.h, body: <GatorMock variant="social" headline="COMBINE 2026" sub="1. 10." /> },
    { id: "reelHost", label: "Obálka videosérie · pozvánka od hosta · IG Story · 9:16", kind: "digital", x: x0 + (P.w + gap), y: y4, w: ST.w, h: ST.h, body: <GatorMock variant="reel" headline="HOST ZE ZÁMOŘÍ" sub="díl 1 ze 6" /> },
    { id: "story1", label: "Pozvánka · story · IG Story · 9:16", kind: "digital", x: x0 + 2 * (P.w + gap), y: y4, w: ST.w, h: ST.h, body: <GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 9." /> },
    { id: "story2", label: "Zítra se měří · countdown story · IG Story · 9:16", kind: "digital", x: x0 + 3 * (P.w + gap), y: y4, w: ST.w, h: ST.h, body: <GatorMock variant="reel" headline="ZÍTRA" sub="9:00" /> },
    { id: "karta1", label: "Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm", kind: "print", x: x0, y: y5, w: sc(1144), h: sc(816), body: <Karta arch={1} /> },
    { id: "karta2", label: "Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm", kind: "print", x: x0 + sc(1144) + gap, y: y5, w: sc(1144), h: sc(816), body: <Karta arch={2} /> },
  ];
  return list.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy }));
}

/* Bodies are drawn at 4× and scaled to 25 % (.ak-tiny), so the user's own type keeps its proportions at 7 % — nothing
   spills past an artboard's edge in the overview. */
function Kampan({ dx = 0, dy = 0, only, selected = [] }: { dx?: number; dy?: number; only?: Kind; selected?: string[] }) {
  return (
    <>
      {kampan(dx, dy).map((a) => (
        <Artboard key={a.id} label={a.label} kind={a.kind} x={a.x} y={a.y} w={a.w} h={a.h} dim={!!only && a.kind !== only} selected={selected.includes(a.id)}>
          <span className="ak-tiny">{a.body}</span>
        </Artboard>
      ))}
    </>
  );
}

/* ═══ Shared chrome for an Alligators window ═══════════════════════════════════════════════════ */
function GatorChrome({ canvas, left = "folded", insp, tool = "select", zoom = 25, ai = true, dock = true, pillOpen = false }: { canvas: string; left?: ReactNode | "folded"; insp?: ReactNode; tool?: string; zoom?: number | string; ai?: boolean; dock?: boolean; pillOpen?: boolean }) {
  return (
    <>
      <ProjectPill project="Alligators brand" canvas={canvas} open={pillOpen} />
      {left === "folded" ? <PanelIcon icon="panel-left" at="left" /> : left}
      <ShareCluster mode="edit" people={["tereza", "jonas"]} status="saved" />
      {insp}
      <ZoomUndo zoom={zoom} />
      {dock ? <Toolbar tool={tool} /> : null}
      {ai ? <PanelIcon icon="spark" at="ai" /> : null}
    </>
  );
}

/** Kit Inspector placed inside a close-up card instead of over a window. */
const INSP_INLINE: CSSProperties = { position: "relative", right: "auto", top: "auto", width: "100%" };

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════════ */
export default function ArtboardKinds() {
  return (
    <DesignCanvas>
      {/* ── 1 · New artboard ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="new" title="A new artboard — pick what you're making" subtitle="F over empty canvas opens the size picker: App, Web page, Social, Print, Video. The tile you pick sets the kind.">
        <DCArtboard id="ak-picker" label="1 · F — pick what you're making" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="F over empty canvas opens the size picker.">Pick a tile and the artboard lands on the dashed outline. With an artboard selected, F draws a frame inside it instead; F and drag skips the picker.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Pozvánka na combine · IG Post · 4:5" kind="digital" x={90} y={130} w={194} h={243}><GatorMock variant="social" headline="COMBINE 2026" sub="St 1. 10. · CESA VUT" /></Artboard>
                <Artboard label="Pozvánka · story · IG Story · 9:16" kind="digital" x={304} y={130} w={194} h={346}><GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 9." /></Artboard>
                <Ghost label="FB event cover" kind="digital" size="1920 × 1005" x={1000} y={150} w={346} h={181} />
              </Canvas>
              <GatorChrome canvas="Combine-kampan" tool="frame" zoom={18} />
              <SizePicker hl="social:FB event cover" style={{ left: 518, bottom: 84 }} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-picker-full" label="2 · All sizes, the four kinds, a custom print size" width={1100} height={1200} fixed>
          <V2 className="ak-closeup">
            <p className="ak-closeup-h">Tiles grouped by what you're making. Four kinds underneath.</p>
            <div className="ak-pf">
              <SizePicker open="print" custom wide style={{ position: "relative", left: 0, top: 0 }} />
              <div className="ak-pf-side">
                <div className="ak-legend">
                  <p className="ak-legend-h">The kind travels on the label</p>
                  <p className="ak-legend-sub">App and Social are both <strong>Fixed size</strong> — the same kind, different preset sizes.</p>
                  {([
                    ["digital", "FB event cover · 1.91:1", "Exact px. Place things anywhere. From App or Social."],
                    ["web", "Domů · Desktop", "Content flows top to bottom; the height grows. Other widths sit beside it."],
                    ["print", "A · přední (FLAG)", "Paper in mm, with bleed and a safe margin. Exports a print PDF."],
                    ["video", "Hype · Reels · 0:15", "Has a length. Selecting it brings the timeline."],
                  ] as [Kind, string, string][]).map(([k, l, d]) => (
                    <div className="ak-leg" key={k}>
                      <span className="ak-leg-k"><span className="ak-leg-kw">{KIND_WORD[k]}</span><span className="ak-leg-lab"><Icon name={k} size={11} />{l}</span></span>
                      <span className="ak-leg-d">{d}</span>
                    </div>
                  ))}
                </div>
                <div className="island island--pad ak-custom" style={{ marginTop: 128 }}>
                  <p className="ak-custom-t"><Icon name="print" size={14} />Custom print size</p>
                  <div className="ak-custom-r"><span>Width</span><span className="input ak-mm">99<em>mm</em></span></div>
                  <div className="ak-custom-r"><span>Height</span><span className="input ak-mm">210<em>mm</em></span></div>
                  <div className="ak-custom-r"><span>Orientation</span><InSeg options={["Portrait", "Landscape"]} value="Portrait" /></div>
                  <div className="ak-custom-r"><span>Bleed</span><span className="input ak-mm">3<em>mm</em></span></div>
                  <div className="ak-custom-r"><span>Safe margin</span><span className="input ak-mm">5<em>mm</em></span></div>
                  <p className="ak-custom-n">DL leaflet size. The artboard is drawn 3 mm larger on every side so colour can run past the cut.</p>
                  <span className="ak-custom-a"><span className="btn">Cancel</span><span className="btn btn--primary">Add artboard</span></span>
                </div>
              </div>
            </div>
            <div className="ak-closeup-note"><Note n={2} title="Three common sizes up front, the rest one click away.">“All 7” opens every print size, and Custom size… takes mm and bleed. Each group's badge says what you get: Fixed size, grows as you add, mm with bleed, or a timeline.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Web ──────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="web" title="Web page — grows as you add" subtitle="Flow layout, height that fits content, the same page at 1440, 834 and 390 side by side">
        <DCArtboard id="ak-web-hug" label="3 · A web page grows with its content" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Add a section; the page gets longer.">A web page stacks its content top to bottom, so its height follows what's in it, like a browser. Switch Height to Fixed when the page must stop at an exact height.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Domů · Desktop" kind="web" x={330} y={110} w={432} h={472} selected size="1440 × 1573">
                  <ClubPage added wide />
                  <Selection x={0} y={205} w={432} h={112} label="Rozpis zápasů · new section" />
                </Artboard>
                <span className="ak-grow" style={{ left: 774, top: 315, height: 112 }}><span>+ 373 px</span></span>
              </Canvas>
              <GatorChrome canvas="Domů" zoom={30} insp={
                <Inspector title="Domů · Desktop" kind="Web page" rows={[
                  ["Width", <InSelect value="Desktop · 1440" />],
                  ["Height", <InSeg options={["Fits content", "Fixed"]} value="Fits content" />],
                  ["", <InNote>1573 now — grows as you add.</InNote>],
                  ["Layout", <InSelect value="Top to bottom" />],
                  ["Fill", <InFill name="White" />],
                  ["Other widths", <InButton icon="duplicate">Add a width</InButton>],
                ]} advanced={[["kind", "web"], ["width", "1440px"], ["height", "auto · min 900px"], ["display", "flex · column"]]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-web-widths" label="4 · Duplicate at another width" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Same page, three widths, side by side.">Duplicate at another width adds Tablet and Mobile; each reflows, so Mobile runs longest. What can't fit gets a label mark and an inspector line.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Domů · Desktop · 1440" kind="web" x={150} y={100} w={403} h={442}><ClubPage added wide /></Artboard>
                <Artboard label="Domů · Tablet · 834" kind="web" x={593} y={100} w={234} h={560}><ClubPage added /></Artboard>
                <Artboard label="Domů · Mobile · 390" kind="web" x={867} y={100} w={109} h={612} selected size="390 × 2185"><ClubPage added warn /></Artboard>
                <LabelWarn x={1078} y={80} title="1 thing to check" />
              </Canvas>
              <GatorChrome canvas="Domů" zoom={28} insp={
                <Inspector title="Domů · Mobile · 390" kind="Web page" rows={[
                  [" ", <InWarn action="Fit to width">Partneři is 960 px wide — wider than Mobile.</InWarn>],
                  ["Width", <InSelect value="Mobile · 390" />],
                  ["Height", <InSeg options={["Fits content", "Fixed"]} value="Fits content" />],
                  ["", <InNote>2185 now — the longest of the three.</InNote>],
                  ["Fill", <InFill name="White" />],
                ]} advanced={[["kind", "web"], ["width", "390px"], ["height", "auto · min 844px"]]} />
              } />
              <Toast icon="duplicate" action="Undo">Tablet and Mobile are beside Desktop. Their layout reflowed to fit.</Toast>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Fixed size / social ──────────────────────────────────────────────────────────── */}
      <DCSection id="social" title="Fixed size — exact px, placed freely" subtitle="Alligators matchday post 1:1 and story 9:16 (still); Instagram's own UI shown as safe zones">
        <DCArtboard id="ak-social" label="5 · Matchday post and story" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Fixed size; put things anywhere.">Social and App artboards keep their exact size and let you place text and pictures freely. On a story, safe zones show where Instagram's own bars will sit, so the date never hides under them.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Gameday · post · 1:1" kind="digital" x={300} y={140} w={302} h={302}>
                  <Gameday format="post" />
                  <Selection x={30} y={244} w={180} h={20} label="Datum · text" />
                </Artboard>
                <Artboard label="Gameday · story · 9:16" kind="digital" x={650} y={140} w={302} h={538} selected size="1080 × 1920">
                  <Gameday format="story" />
                  <SafeZones kind="story" />
                </Artboard>
              </Canvas>
              <GatorChrome canvas="matchday" zoom={28} insp={
                <Inspector title="Gameday · story" kind="Fixed size" rows={[
                  ["Size", <InSelect value="Story 9:16 (still)" />],
                  ["", <InSize w={1080} h={1920} />],
                  ["Fill", <InFill name="Ink" tone="ink" />],
                  ["Safe zones", <InSelect value="Instagram story" />],
                  ["Show on canvas", <InSwitch on />],
                  ["Export", <InButton icon="export">PNG · 1×</InButton>],
                ]} advanced={[["kind", "digital"], ["width", "1080px"], ["height", "1920px · fixed"], ["position", "absolute children"]]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-safe-zones" label="6 · Safe zones, close up" width={W} height={840} fixed>
          <V2 className="ak-closeup">
            <p className="ak-closeup-h">Safe zones show where the app covers your design.</p>
            <div className="ak-sz-row">
              <div className="ak-szf">
                <div className="ak-szf-pic"><Gameday format="story" /><SafeZones kind="story" /></div>
                <p className="ak-szf-c"><strong>Instagram story</strong> Profile and progress bar on top, reply bar below.</p>
              </div>
              <div className="ak-szf">
                <div className="ak-szf-pic"><Gameday format="story" /><SafeZones kind="reels" /><span className="ak-under">Under the caption</span></div>
                <p className="ak-szf-c"><strong>Instagram Reels</strong> Caption and audio take more of the bottom; buttons run down the right. “Vstupenky na webu” sits under the caption.</p>
              </div>
              <div className="ak-szf">
                <div className="ak-szf-pic ak-szf-pic--sq"><Gameday format="post" /><span className="ak-crop" /></div>
                <p className="ak-szf-c"><strong>Instagram profile grid</strong> A 1:1 post shows as 3:4 in the grid — the pale sides are cut off there.</p>
              </div>
              <div className="k-menu ak-szmenu">
                <span className="k-mgroup">Safe zones</span>
                {["None", "Instagram story", "Instagram Reels", "Instagram profile grid", "TikTok", "YouTube Shorts", "Facebook event cover"].map((o) => (
                  <span key={o} className="row-item k-mi" data-hl={o === "Instagram Reels" ? "true" : undefined}><span className="k-mi-ic">{o === "Instagram Reels" ? <Icon name="check" size={14} /> : null}</span><span className="k-mi-lab">{o}</span></span>
                ))}
                <span className="k-msep" />
                <span className="ak-szmenu-n">Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026.</span>
              </div>
            </div>
            <div className="ak-closeup-note"><Note n={6} title="One overlay instead of a check artboard.">Alligators keep a copy of their event cover called “kontrola safe zóny (nenahrávat)” just to see the crop. Picking a safe zone in the inspector draws it on the artboard and never exports it; the zones move when the apps change, so the list carries a date.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Print ────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="print" title="Print — paper, millimetres, bleed" subtitle="Alligators A6 flyer, front and back; guides from View; the flyer next to its web page">
        <DCArtboard id="ak-print-letak" label="7 · A6 flyer — the inspector speaks mm" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Paper first, millimetres throughout.">Select a print artboard and the inspector talks paper: size in mm, orientation, bleed and safe margin. The colour line says it plainly: designed in RGB, the print shop converts to CMYK.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <span className="ak-sec" style={{ left: 300, top: 92 }}>Náborový leták A6 · FLAG</span>
                <span className="ak-sec" style={{ left: 740, top: 92 }}>Náborový leták A6 · TACKLE</span>
                <Artboard label="A · přední (FLAG)" kind="print" x={300} y={140} w={189} h={261} selected size="105 × 148 mm">
                  <Flyer side="a" variant="flag" /><PrintGuides />
                </Artboard>
                <Artboard label="B · zadní (FLAG)" kind="print" x={509} y={140} w={189} h={261}><Flyer side="b" variant="flag" /></Artboard>
                <Artboard label="A · přední (TACKLE)" kind="print" x={740} y={140} w={189} h={261}><Flyer side="a" variant="tackle" /></Artboard>
                <Artboard label="B · zadní (TACKLE)" kind="print" x={949} y={140} w={189} h={261}><Flyer side="b" variant="tackle" /></Artboard>
                <CommentPin who="tereza" x={720} y={500} text="QR vede na alligators.cz/nabor — ověřeno." />
              </Canvas>
              <GatorChrome canvas="LetakA6" zoom={45} insp={
                <Inspector title="A · přední (FLAG)" kind="Print" rows={[
                  ["Paper", <InSelect value="A6" />],
                  ["Size in mm", <InSize w={105} h={148} />],
                  ["Orientation", <InSeg options={["Portrait", "Landscape"]} value="Portrait" />],
                  ["Bleed", <InNum value="3 mm" />],
                  ["Safe margin", <InNum value="5 mm" />],
                  ["Print guides", <InSwitch on />],
                  ["Colour", <InNote>RGB — the print shop converts to CMYK.</InNote>],
                  ["Export", <InButton icon="export">Print PDF</InButton>],
                ]} advanced={[["kind", "print"], ["paper", "a6 · portrait"], ["size", "419 × 581 px"], ["bleed", "11 px"]]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-print-view" label="8 · Print guides from View, next to the web page" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Guides for the whole canvas live in View.">Menu › View › Advanced › Print guides (checked) shows bleed, trim and safe margin on every print artboard. Below, the flyer's web page sits beside it — same words, its own kind and rules.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                {[["A · přední (FLAG)", "a", "flag", 580], ["B · zadní (FLAG)", "b", "flag", 764], ["A · přední (TACKLE)", "a", "tackle", 968], ["B · zadní (TACKLE)", "b", "tackle", 1152]].map(([l, s, v, x]) => (
                  <Artboard key={l as string} label={l as string} kind="print" x={x as number} y={150} w={168} h={232}>
                    <Flyer side={s as "a" | "b"} variant={v as "flag" | "tackle"} /><PrintGuides />
                  </Artboard>
                ))}
                <Artboard label="Nábor FLAG · web · 1440" kind="web" x={580} y={450} w={576} h={475}><ClubPage wide /></Artboard>
                <span className="ak-pair" style={{ left: 1176, top: 470 }}><Icon name="link" size={12} />Same text as the flyer · edited separately</span>
              </Canvas>
              <GatorChrome canvas="LetakA6" zoom={40} pillOpen />
              <ProjectMenu open="view" advanced highlight="Print guides" checked={["Print guides"]} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Video ────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="video" title="Video — select it, the timeline comes" subtitle="Duration on the label, a poster frame, and a hint of the timeline (full editing: 07 Video Editing)">
        <DCArtboard id="ak-video" label="9 · A video artboard summons the timeline" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Only a video artboard brings a timeline.">Select “Hype trailer · Reels” and the timeline slides out of it; select anything else and it slides back in. Length on the label, poster frame as the picture. Full editing: 07.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Hype trailer · Reels · 0:15" kind="video" x={420} y={110} w={238} h={422} selected size="1080 × 1920">
                  <Still pic="field" title="RYCHLOST" titleAt="bottom" />
                </Artboard>
                <Artboard label="Hype trailer · 16:9 · 0:30" kind="video" x={700} y={110} w={422} h={238}><Still pic="field" pos={40} title="STAŇ SE ALLIGATOREM" titleAt="bottom" play /></Artboard>
              </Canvas>
              <GatorChrome canvas="video-hype" zoom={22} insp={<VideoInspector />} />
              <Timeline {...HYPE} t={4} poster={4} under={AK_VIDEO_CX} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Mixed canvas ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="mixed" title="A canvas with mixed kinds" subtitle="Combine-kampan as it is: 21 artboards, 19 fixed size + 2 print — fit, filter, select across kinds, change a kind, warnings">
        <DCArtboard id="ak-mixed-fit" label="10 · ⌘0 fits all 21; Layers filters by kind" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Twenty-one artboards, two kinds.">⌘0 fits the whole campaign: 19 fixed size, 2 print sheets. Every label keeps its kind glyph when the name is cut, and the Print chip in Layers dims everything else.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><Kampan only="print" /></Canvas>
              <GatorChrome canvas="Combine-kampan" zoom="7%" left={
                <FilterPanel tab="layers" on="print" counts={KAMPAN_COUNTS} foot={<>19 other artboards are dimmed. <span className="ak-link">Show all</span></>}>
                  <p className="island-title k-cp-t">Výsledková karta</p>
                  <LayerRow name="Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm" kind="print" current />
                  <LayerRow name="Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm" kind="print" />
                </FilterPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-mixed-filter" label="11 · Canvases filtered by kind, across 93" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Find every video in the project.">The same chips in the Canvases panel filter all 93 canvases. Each hit shows its folder and how many of its artboards match; a canvas with several kinds counts under each.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><Kampan dx={24} /></Canvas>
              <GatorChrome canvas="Combine-kampan" zoom="7%" left={
                <FilterPanel tab="canvases" on="video" counts={{ all: 93, digital: 61, web: 9, print: 8, video: 12 }} style={{ width: 300 }} foot="12 of 93 canvases have video — 3 more below. A canvas counts once under each kind it has.">
                  <CanvasHit name="video-hype" path="social" art="gator-reel" kinds={["digital", "video"]} count="2 of 3" />
                  <CanvasHit name="video-recap" path="social" art="video" kinds={["video"]} count="4 of 4" />
                  <CanvasHit name="video-touchdown" path="social" art="video" kinds={["video"]} count="2 of 2" />
                  <CanvasHit name="video-nabor" path="social" art="gator-reel" kinds={["video"]} count="3 of 3" />
                  <CanvasHit name="video-gameweek" path="social" art="video" kinds={["video"]} count="2 of 2" />
                  <CanvasHit name="video-zapas-lions" path="social" art="video" kinds={["video"]} count="1 of 1" />
                  <CanvasHit name="video-pov" path="social" art="video" kinds={["video"]} count="1 of 1" />
                  <CanvasHit name="Combine-video-AI" path="2026 › combine" art="video" kinds={["video"]} count="2 of 2" />
                  <CanvasHit name="Krpole-v-pohybu" path="2026 › social" art="gator-social" kinds={["digital", "video"]} count="1 of 6" />
                </FilterPanel>
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-mixed-select" label="12 · Two kinds selected" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Several kinds: only what they share.">With the IG announcement and a print sheet selected, the inspector keeps what both understand — fill, alignment, export. Size and paper wait until you pick one.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><div className="ak-tight" style={{ display: "contents" }}><Kampan dx={-150} selected={["ig", "karta1"]} /></div></Canvas>
              <GatorChrome canvas="Combine-kampan" zoom="7%" insp={
                <Inspector title="2 artboards" kind="2 kinds" rows={[
                  ["Kinds", <span className="ak-kinds"><span><KindGlyph kind="digital" />Fixed size</span><span><KindGlyph kind="print" />Print</span></span>],
                  ["Fill", <InFill name="Mixed" tone="grey" pct="" />],
                  ["Horizontal", <InSeg options={["Left", "Centre", "Right"]} value="Left" />],
                  ["Vertical", <InSeg options={["Top", "Middle", "Bottom"]} value="Top" />],
                  ["", <InNote>Size and paper differ. Select one to change it.</InNote>],
                  ["Export", <InButton icon="export">2 files…</InButton>],
                ]} advanced={[["kind", "digital · print"], ["selected", "2 artboards"]]} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-convert" label="13 · Post 4:5 → A6 print" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Changing kind says what changes.">Picking A6 for an Instagram post asks first: what converts, where the extra height goes, what to check. The post stays as it was — the A6 is made from a copy.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Oznámení události · Instagram · IG Post · 4:5" kind="digital" x={150} y={110} w={432} h={540} selected size="1080 × 1350"><GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT · 9:00" /></Artboard>
              </Canvas>
              <GatorChrome canvas="Combine-kampan" zoom={40} insp={
                <Inspector title="Oznámení události" kind="Fixed size" rows={[
                  ["Size", <span className="ak-open"><InSelect value="A6 · 105 × 148 mm" /></span>],
                  ["", <InSize w={1080} h={1350} />],
                  ["Fill", <InFill name="Ink" tone="ink" />],
                ]} />
              } />
              <Veil />
              <Dialog title={<>Make “Oznámení události” an A6 print?</>} primary="Make A6 print" width={520}>
                <p className="ak-dl-p">Size becomes 105 × 148 mm with 3 mm bleed. The design scales to the A6 width; the extra 13 % of height is filled with its background colour, Ink. Text stays text.</p>
                <p className="ak-dl-h">Check after</p>
                <CheckLine>Fotka týmu is 640 px wide — at A6 it may print a little soft.</CheckLine>
                <CheckLine>Two layers sit where the paper is cut.</CheckLine>
                <p className="ak-dl-i"><Icon name="check" size={14} />Instagram safe zones turn off — print has its own safe margin.</p>
                <span className="ak-dl-sw"><InSwitch on /><span>Keep the post; make the A6 from a copy</span></span>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-convert-after" label="14 · After — the post stays, the A6 copy sits beside it" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="The kind changed; nothing was lost.">The A6 copy lands beside the untouched post, both to scale — an A6 is about 40 % of the post's width. Same design, Ink fill below, guides on; two things to check top its inspector.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="Oznámení události · Instagram · IG Post · 4:5" kind="digital" x={150} y={110} w={432} h={540}><GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT · 9:00" /></Artboard>
                <span className="ak-pair ak-pair--under" style={{ left: 150, top: 666 }}><Icon name="check" size={12} />Unchanged</span>
                <span className="ak-arrow" style={{ left: 604, top: 302 }}><Icon name="submenu" size={16} /></span>
                <Artboard label="Oznámení události · A6" kind="print" x={666} y={200} w={168} h={232} selected size="105 × 148 mm">
                  <A6Copy /><PrintGuides />
                </Artboard>
                <LabelWarn x={912} y={180} title="2 things to check" />
                <span className="ak-grow ak-grow--fill" style={{ left: 836, top: 403, height: 25 }}><span>+ 13 % height · Ink fill</span></span>
                <span className="ak-bleedtag" style={{ left: 666, top: 444 }}>Bleed 3 mm · trim · safe margin 5 mm</span>
              </Canvas>
              <GatorChrome canvas="Combine-kampan" zoom={40} insp={
                <Inspector title="Oznámení události · A6" kind="Print" rows={[
                  [" ", <InWarn action="Replace…">Fotka týmu is 640 px wide — at A6 it may print a little soft.</InWarn>],
                  ["  ", <InWarn action="Show">Two layers sit where the paper is cut.</InWarn>],
                  ["Paper", <InSelect value="A6" />],
                  ["Bleed", <InNum value="3 mm" />],
                  ["Made from", <InNote>Oznámení události · 4:5</InNote>],
                  ["Export", <InButton icon="export">Print PDF</InButton>],
                ]} advanced={[["kind", "print"], ["paper", "a6 · portrait"], ["size", "419 × 581 px"]]} />
              } />
              <Toast icon="duplicate" action="Undo">The A6 copy is beside the post. The post is unchanged.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-warnings" label="15 · Warnings — one place, one verb" width={W} height={900} fixed>
          <V2 className="ak-closeup">
            <p className="ak-closeup-h">Warnings stay quiet: a mark on the label, one line in the inspector, one fix.</p>
            <div className="ak-wrow">
              <div className="ak-wc">
                <p className="ak-wc-t"><Icon name="print" size={14} />Crosses the cut</p>
                <div className="ak-wc-scene">
                  <Artboard label="A · přední (FLAG)" kind="print" x={52} y={36} w={293} h={406} selected size="105 × 148 mm">
                    <Flyer side="a" variant="flag" qrOut /><PrintGuides />
                    <span className="ak-out" style={{ left: 223, top: 334, width: 70, height: 72 }}><span>Crosses the cut</span></span>
                  </Artboard>
                  <LabelWarn x={262} y={16} title="1 thing to check" />
                </div>
                <Inspector title="A · přední (FLAG)" kind="Print" style={INSP_INLINE} rows={[
                  [" ", <InWarn action="Move inside">The QR code crosses the cut — its corner would be trimmed.</InWarn>],
                  ["Safe margin", <InNum value="5 mm" />],
                ]} advanced={[["kind", "print"], ["paper", "a6 · portrait"]]} />
              </div>
              <div className="ak-wc">
                <p className="ak-wc-t"><Icon name="video" size={14} />Longer than one export</p>
                <div className="ak-wc-scene">
                  <Artboard label="Sezóna 2026 · recap · 16:9 · 2:40" kind="video" x={28} y={140} w={344} h={194} selected size="1920 × 1080"><VideoFrameMock caption="SEZÓNA 2026" time="0:00 / 2:40" /></Artboard>
                  <LabelWarn x={316} y={120} title="1 thing to check" />
                </div>
                <Inspector title="Sezóna 2026 · recap" kind="Video" style={INSP_INLINE} rows={[
                  [" ", <InWarn action="Allow longer">2:40 long — one export goes up to 2 min (3600 frames at 30 fps).</InWarn>],
                  ["Length", <InNum value="2:40" icon="clock" />],
                ]} advanced={[["kind", "video"], ["durationInFrames", "4800"]]} />
              </div>
              <div className="ak-wc">
                <p className="ak-wc-t"><Icon name="corner" size={14} />Not quite the paper size</p>
                <div className="ak-wc-scene">
                  <Artboard label="Arch 1 · vnějšek · A4 landscape" kind="print" x={28} y={120} w={344} h={245} selected size="1144 × 816"><Karta arch={1} /></Artboard>
                  <LabelWarn x={299} y={100} title="1 thing to check" />
                </div>
                <Inspector title="Arch 1 · vnějšek" kind="Print" style={INSP_INLINE} rows={[
                  [" ", <InWarn action="Fix size">1 px narrower than A4 landscape with bleed (1145 × 816).</InWarn>],
                  ["Paper", <InSelect value="A4 · Landscape" />],
                ]} advanced={[["kind", "print"], ["width", "1144px"]]} />
              </div>
            </div>
            <div className="ak-closeup-note"><Note n={15} title="Shown, never blocking — always in the same place.">A warning is a mark beside the artboard's label and a row at the top of its inspector, with one verb. The third is real: Combine-kampan's score card was typed as 1144 px by hand.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Advanced + the real thing ────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced, and the real thing" subtitle="Exact px and mm, resolution, colour, guide definitions, the kind in code — then real kind= artboards from canvas-lib">
        <DCArtboard id="ak-advanced" label="16 · Advanced — exact values and the code" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Every number, under Advanced.">The plain inspector says A6 and 3 mm; Advanced adds exact pixels, resolution, colour, guides, look and layout (as 06) and the code. Print PDF at 300 dpi is new in v2 — today it's 96 dpi unless set.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <Artboard label="A · přední (FLAG)" kind="print" x={340} y={130} w={419} h={581} selected size="105 × 148 mm">
                  <Flyer side="a" variant="flag" /><PrintGuides cols={2} />
                </Artboard>
              </Canvas>
              <GatorChrome canvas="LetakA6" zoom={100} />
              <div className="island island--pad k-insp ak-advinsp">
                <div className="k-insp-hd"><strong>A · přední (FLAG)</strong><span className="chip">Print</span></div>
                <div className="k-insp-row"><span>Paper</span><InSelect value="A6 · Portrait" /></div>
                <div className="k-insp-row"><span>Bleed · margin</span><span className="ak-pair2"><InNum value="3 mm" /><InNum value="5 mm" /></span></div>
                <div className="k-adv" data-open="true">
                  <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced</span>
                  <div className="ak-adv">
                    <p className="ak-adv-h">Exact size</p>
                    <div className="k-css"><span className="k-mono k-css-k">artboard</span><span className="k-mono k-css-v">419 × 581 px</span></div>
                    <div className="k-css"><span className="k-mono k-css-k">trim</span><span className="k-mono k-css-v">397 × 559 px · 105 × 148 mm</span></div>
                    <div className="k-css"><span className="k-mono k-css-k">bleed · margin</span><span className="k-mono k-css-v">11 px · 19 px</span></div>
                    <p className="ak-adv-h">Resolution</p>
                    <div className="k-css"><span className="k-mono k-css-k">canvas</span><span className="k-mono k-css-v">96 px per inch</span></div>
                    <div className="k-css"><span className="k-mono k-css-k">print PDF</span><span className="k-mono k-css-v">300 dpi · vector text</span></div>
                    <p className="ak-adv-h">Colour</p>
                    <p className="ak-adv-p">Designed in sRGB. RGB — the print shop converts to CMYK; if they ask for a profile, use theirs.</p>
                    <p className="ak-adv-h">Guides<span className="btn btn--ghost btn--sm ak-adv-add"><Icon name="plus" size={12} />Add</span></p>
                    <div className="k-css"><span className="k-mono k-css-k">columns</span><span className="k-mono k-css-v">2 · gutter 16 · margin 30</span></div>
                    <div className="k-css"><span className="k-mono k-css-k">rows · grid</span><span className="k-mono k-css-v">off</span></div>
                    <p className="ak-adv-h">Look and layout</p>
                    <div className="k-insp-row ak-adv-row"><span>Theme</span><InSelect value="DS default" /></div>
                    <div className="k-insp-row ak-adv-row"><span>Body layout</span><InSelect value="Column" /></div>
                    <div className="k-insp-row ak-adv-row"><span>Grid tracks</span><span className="btn btn--ghost btn--sm">Edit tracks…</span></div>
                    <div className="k-insp-row ak-adv-row"><span>Layout</span><span className="btn btn--ghost btn--sm">Convert to absolute…</span></div>
                    <p className="ak-adv-h">In code</p>
                    <pre className="ak-code">{`<DCArtboard kind="print"
  print={{ paper: "a6", bleedMm: 3 }}
  width={419} height={581} fixed
  guides={{ columns: { count: 2,
    gutter: 16, margin: 30 } }}>`}</pre>
                  </div>
                </div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ak-real-about" label="17 · About the next two" width={360} height={581} fixed>
          <V2 className="ak-closeup ak-about">
            <p className="ak-closeup-h">The real thing.</p>
            <p className="ak-about-p">The two artboards to the right are not drawings — they are real canvas artboards.</p>
            <p className="ak-about-p"><strong>A6 flyer.</strong> <code className="k-mono">kind="print"</code> with <code className="k-mono">print=&#123;&#123; paper: "a6", bleedMm: 3 &#125;&#125;</code>. Its size, 419 × 581, is what resolvePrintArtboard gives — trim plus 3 mm on each side. It is drawn without <code className="k-mono">fixed</code>: today a fixed artboard counts its 24 px label inside the height, so the page would lose its bottom 24 px.</p>
            <p className="ak-about-p"><strong>Its web page.</strong> <code className="k-mono">kind="web"</code> at 834 with no <code className="k-mono">fixed</code>: the height is a floor and the artboard grows with the page.</p>
            <div className="ak-closeup-note"><Note n={17} title="Mock beside real.">Turn on Menu › View › Advanced › Print guides in today's app to see the real bleed, trim and margin on the flyer.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="ak-real-print" label="18 · A · přední (FLAG) — real print artboard" width={A6.w} height={A6.h} padding={0} kind="print" print={{ paper: "a6", orientation: "portrait", bleedMm: 3 }}>
          <div className="ak-real" style={{ height: A6.h }}><Flyer side="a" variant="flag" /></div>
        </DCArtboard>

        <DCArtboard id="ak-real-web" label="19 · Nábor FLAG — real web artboard (hug)" width={834} height={581} padding={0} kind="web">
          <div className="ak-real ak-real--web"><ClubPage added fresh={false} /></div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
