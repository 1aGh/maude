/**
 * @canvas      09 Export — one Export sheet that adapts to what's selected and always says its scope; a live paper
 *              preview for print, a filmstrip for video; batch, progress, history, link vs file, handoff to production,
 *              the edge cases and the Advanced fold. Told on Alligators brand, Studio site and Portfolio 2026 (local).
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ex-social | ex-print | ex-web | ex-video | ex-inspector | ex-formats |
 *              ex-canvas | ex-batch-pick | ex-batch |
 *              ex-progress | ex-states | ex-history |
 *              ex-share-vs |
 *              ex-handoff | ex-handoff-ready | ex-handoff-edges |
 *              ex-offline | ex-huge | ex-print-warn | ex-edges |
 *              ex-advanced
 * @brief       "export" — every export path that exists today stays reachable (PNG · PDF · SVG · HTML · PowerPoint ·
 *              MP4 · GIF · WebM · Canva · Project ZIP · AI handoff, print PDF with bleed + crop marks, cloud render,
 *              the Exports history, /design:handoff · to-rn · to-lottie), redrawn for designers.
 *
 * Convention (same as 01): every app artboard is a <Stage> — a 1440 × 900 window with its note strip underneath
 * (artboard 1440 × 980). Close-ups are sized to content with the note at the foot. All chrome comes from ./_kit
 * (+ ./_video for the Hype trailer footage and data, the same source 07 and 08 use); local pieces use the `ex-` prefix:
 * the Export sheet (ExSheet + Scope/Row/Seg/Check/Option/Hint), the print-PDF paper (crop marks that draw in, bleed
 * tint, safe margin, page stack + pager), the video filmstrip, the LetakA6 flyer, a long web page, kind groups for
 * batch, the Exports panel + a Share cluster with its Exports slot, the handoff result, the format list.
 * The user's designs are pinned light (.k-fixed) like the kit's.
 *
 * Settled in the fix pass (main agent, 2026-10-06):
 *   · A finished export's one action is Show in Finder — the file is on this Mac either way (= 07 ve-render).
 *     A link is Share's job (Copy link).
 *   · Partial failure is drawn as such: "Exported 114 of 115 …" + Retry Recap. Never "Exported 115" next to a failure.
 *   · Print colour line everywhere: "RGB — the print shop converts to CMYK." (= 08).
 *   · ⇧⌘E with nothing selected exports THIS CANVAS. Every sheet carries Scope (Selection · This canvas · Folder ·
 *     Whole project); Whole project is a deliberate choice there.
 *   · Studio site is a cloud project (01 · 09 web · 11); the local example is Portfolio 2026 (02 Onboarding).
 *   · Handoff's "Copy command" points at the project's cloud address so it runs on any developer's machine; the
 *     file:// form lives only under Advanced, labelled "This Mac only". Handoff writes into the project → Can edit.
 *   · Final pass: the app never names itself ("Keep this window open", = 07); a file still on Jonas's Mac is
 *     "waiting for … Jonas's Mac", never "missing" (CONTRACT §7); the kind word is "Fixed size" (= 08), Social is
 *     only a preset group; Combine-kampan is the real 21 artboards (19 fixed size + 2 print, = 08) — video stories
 *     use social/video-hype; Reels / 16:9 / 1:1 are "Formats" (= 07); the Share cluster carries the mode switch.
 *
 * Ground truth (apps/studio exporters + client/export-center.jsx + export-dialog.tsx, apps/render, plugins/design):
 *   formats png · jpg(NEW) · svg · pdf · html · pptx · canva · zip · mp4 · webm · gif · sound only(NEW, = 07)
 *   PNG 1×/2×/3× or 150/300/600 dpi · PDF image quality, text keep/embed/outline, bleed 3 mm, crop + registration marks
 *   (RGB only — no CMYK today) · video fps from the comp, H.264 / VP9, audio on · job words Queued · Rendering… ·
 *   Ready · Ready · no sound · Failed · history = last 20 · ⇧⌘E Export, ⇧⌘H Handoff · viewers may export today.
 *   NEW here (questions for Michal): JPG, the Scope row, file-name tokens, Export again / Show in Finder in history,
 *   a cloud-vs-this-Mac choice per export, colour profile, a font-licence check, "export the version from 14:05",
 *   inspector export presets + Copy as PNG ⇧⌘C, a hosted registry URL for handoff.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./_video.css";
import "./09 Export.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  Artboard, Avatar, CanvasesPanel, Canvas, GatorMock, Icon, InSelect, InSize, InSwitch, Kbd, Menu, ModeSwitch, Note,
  PanelIcon, PhoneMock, PricingMock, ProjectPill, ShareCluster, Spark, Stage, TABS, Thumb, Toast, Toolbar,
  V2, Veil, Window, ZoomUndo,
} from "./_kit";
import type { Art, CanvasItem, Folder, Kind, Who } from "./_kit";
import { ClipPic, HYPE_CLIPS, HYPE_MUSIC, HYPE_TEXT, Still, VIcon } from "./_video";

const W = 1440;
const H = 980;
const TABS2 = [TABS.studio, TABS.alligators];

/* ═══ Sheet parts ═══════════════════════════════════════════════════════════════════════════ */

type ScopeKey = "sel" | "canvas" | "folder" | "project";
/** n = artboards in [Selection, This canvas, Folder, Whole project]; null = not available here.
 *  compact = the narrow-sheet form (a select row) — the value reads e.g. "Selection · 3 artboards". */
type Scope = { on: ScopeKey; n?: (number | null)[]; compact?: string };
const SCOPES: [ScopeKey, string][] = [["sel", "Selection"], ["canvas", "This canvas"], ["folder", "Folder"], ["project", "Whole project"]];

function ScopeBar({ s }: { s: Scope }) {
  const n = s.n ?? [];
  return (
    <div className="ex-scope">
      <span className="ex-scope-k">Scope</span>
      <span className="seg ex-seg ex-scope-seg">
        {SCOPES.map(([k, l], i) => (
          <span key={k} className="k-seg-b" aria-pressed={k === s.on} aria-disabled={n[i] == null ? true : undefined}>
            {l}<small>{n[i] == null ? "—" : n[i]!.toLocaleString("en-GB").replace(",", " ")}</small>
          </span>
        ))}
      </span>
      <span className="ex-scope-u">artboards</span>
    </div>
  );
}

/** The Export sheet — a k-dialog: title, Scope, preview column + rows, an Advanced fold, Cancel + the verb (↵). */
function ExSheet({
  title, sub, scope, preview, prevW, children, summary, primary = "Export", adv = "Scale, colour, file names", width = 640, rel = false, style, extra, lead,
}: {
  title: ReactNode; sub?: ReactNode; scope?: Scope; preview?: ReactNode; prevW?: number; children?: ReactNode; summary?: ReactNode; primary?: string;
  adv?: string | null; width?: number; rel?: boolean; style?: CSSProperties; extra?: ReactNode; lead?: ReactNode;
}) {
  const compact = scope?.compact;
  return (
    <div className={`k-dialog ex-sheet${rel ? " ex-rel" : ""}`} style={{ width, ...style }}>
      <div className="ex-sheet-hd">
        <p className="k-dialog-t">{title}</p>
        {sub ? <p className="ex-sheet-sub">{sub}</p> : null}
      </div>
      {scope && !compact ? <ScopeBar s={scope} /> : null}
      {lead}
      <div className="ex-sheet-body">
        {preview ? <div className="ex-prev" style={prevW ? { width: prevW } : undefined}>{preview}</div> : null}
        <div className="ex-rows">
          {compact ? <Row k="Scope"><InSelect value={compact} /></Row> : null}
          {children}
        </div>
      </div>
      {extra}
      {summary ? <p className="ex-sum">{summary}</p> : null}
      <div className="ex-sheet-a">
        {adv ? <span className="k-adv-btn ex-adv"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="ex-adv-hint">{adv}</span></span> : <span />}
        <span className="ex-btns"><span className="btn">Cancel</span><Go>{primary}</Go></span>
      </div>
    </div>
  );
}

/** The default button: the verb plus a quiet ↵ — return runs it, as in every macOS sheet. */
function Go({ children }: { children: ReactNode }) {
  return <span className="btn btn--primary ex-go">{children}<span className="ex-ret" aria-hidden="true">↵</span></span>;
}

function Row({ k, children, note, top = false }: { k: ReactNode; children?: ReactNode; note?: ReactNode; top?: boolean }) {
  return (
    <div className={`ex-row${top ? " ex-row--top" : ""}${note ? " ex-row--note" : ""}`}>
      <span className="ex-row-k">{k}</span>
      <div className="ex-row-v">{children}{note ? <span className="ex-row-n">{note}</span> : null}</div>
    </div>
  );
}

/** Segmented choice with an optional quiet second word (e.g. the pixel size). */
function Seg({ options, value }: { options: (string | [string, string])[]; value: string }) {
  return (
    <span className="seg ex-seg">
      {options.map((o) => {
        const [l, s] = typeof o === "string" ? [o, ""] : o;
        return <span key={l} className="k-seg-b" aria-pressed={l === value}>{l}{s ? <small>{s}</small> : null}</span>;
      })}
    </span>
  );
}

function Check({ on = true, children, sub, off = false }: { on?: boolean; children: ReactNode; sub?: ReactNode; off?: boolean }) {
  return (
    <span className={`ex-check${off ? " ex-check--off" : ""}`}>
      <span className="ex-box" data-on={on ? "true" : undefined}>{on ? <Icon name="check" size={10} /> : null}</span>
      <span>{children}{sub ? <small>{sub}</small> : null}</span>
    </span>
  );
}

/** Annotations are opt-in (9eff034b `includeAnnotations`) — off by default; print files never carry them (= 15 Annotations · 29). */
function AnnoRow({ print = false }: { print?: boolean }) {
  return (
    <Row k="Annotations" note={print ? "Print files never carry them — pick PDF for a review copy." : undefined}>
      <Check on={false} off={print} sub="Stickies, arrows and stickers stay out unless you include them">Include annotations</Check>
    </Row>
  );
}

/** A choice tile (render place, version, handoff target). */
function Option({ on = false, icon, title, sub, off = false, badge }: { on?: boolean; icon?: ReactNode; title: ReactNode; sub?: ReactNode; off?: boolean; badge?: ReactNode }) {
  return (
    <span className={`ex-opt${off ? " ex-opt--off" : ""}`} data-on={on ? "true" : undefined}>
      <span className="ex-radio" data-on={on ? "true" : undefined} />
      {icon ? <span className="ex-opt-ic">{icon}</span> : null}
      <span className="ex-opt-t"><strong>{title}{badge}</strong>{sub ? <small>{sub}</small> : null}</span>
    </span>
  );
}

/** A quiet line inside the sheet — warn / info / ai. One action at most. */
function Hint({ tone = "info", icon, children, action }: { tone?: "info" | "warn" | "ai"; icon?: string; children: ReactNode; action?: string }) {
  return (
    <div className={`ex-hint ex-hint--${tone}`}>
      <span className="ex-hint-ic">{icon === "spark" ? <Spark size={13} /> : <Icon name={icon ?? (tone === "warn" ? "problem" : "help")} size={14} />}</span>
      <span className="ex-hint-t">{children}</span>
      {action ? <span className="btn btn--ghost btn--sm ex-hint-a">{action}</span> : null}
    </div>
  );
}

function Field({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <span className={`input ex-field${wide ? " ex-field--wide" : ""}`}>{children}</span>;
}

/* ═══ The user's designs (pinned light) ═══════════════════════════════════════════════════════ */

function Qr() {
  return <span className="ex-qr" aria-hidden="true"><i /><i /><i /><b /></span>;
}

/** LetakA6 — the náborový leták, front (FLAG / TACKLE) or back. Scales with its box (the box = trim + 3 mm bleed).
 *  qrOut = the TACKLE front's mistake: the QR sits 2 mm inside the cut, across the 5 mm safe margin. */
function Flyer({ side = "a", variant = "flag", qrOut = false }: { side?: "a" | "b"; variant?: "flag" | "tackle"; qrOut?: boolean }) {
  if (side === "b") {
    return (
      <div className="ex-fly ex-fly--b">
        <span className="ex-fly-mark" />
        <strong className="ex-fly-hb">{variant === "flag" ? "Hraj s námi flag" : "35 let zelené krve"}</strong>
        <span className="ex-fly-rows"><span><b>U11</b>ÚT 17:00</span><span><b>U13</b>ČT 17:00</span><span><b>U15</b>ÚT + ČT</span></span>
        <span className="ex-fly-foot">alligators.cz/nabor</span>
      </div>
    );
  }
  return (
    <div className="ex-fly ex-fly--a">
      <span className="ex-fly-band" />
      <span className="ex-fly-top"><span className="ex-fly-mark" />BRNO ALLIGATORS</span>
      <strong className="ex-fly-h">{variant === "flag" ? <>VYZKOUŠEJ<br />FLAG<br />FOOTBALL</> : <>STAŇ SE<br />GATOREM</>}</strong>
      <span className="ex-fly-sub">{variant === "flag" ? "Od 9 let · první trénink zdarma" : "Od 15 let · výstroj zapůjčíme"}</span>
      <span className={`ex-fly-qr${qrOut ? " ex-fly-qr--out" : ""}`}><Qr /><span>Kraví hora<br />ÚT a ČT 17:00</span></span>
    </div>
  );
}

/** Print-PDF preview — the page the print shop gets. A6 in millimetres × `s` px/mm: the art runs 3 mm past the cut
 *  (tinted, as 08's PrintGuides), crop marks sit outside the bleed and draw in from the corners, the safe margin is
 *  dashed. `stack` = a second page under this one. `flag` rings the QR that crosses the safe margin. */
const A6MM = { w: 105, h: 148, bleed: 3, margin: 5 };
function Paper({ s = 1.7, variant = "flag", side = "a", qrOut = false, margin = false, marks = true, bleed = true, stack = false, flag = false }: {
  s?: number; variant?: "flag" | "tackle"; side?: "a" | "b"; qrOut?: boolean; margin?: boolean; marks?: boolean; bleed?: boolean; stack?: boolean; flag?: boolean;
}) {
  const tw = Math.round(A6MM.w * s); const th = Math.round(A6MM.h * s); const b = bleed ? Math.round(A6MM.bleed * s) : 0;
  const gap = Math.round(A6MM.bleed * s) + 3; const len = 12; const pad = gap + len + 6;
  const pw = tw + pad * 2; const ph = th + pad * 2;
  const corners: [number, number, number, number][] = [[pad, pad, -1, -1], [pad + tw, pad, 1, -1], [pad, pad + th, -1, 1], [pad + tw, pad + th, 1, 1]];
  const m = Math.round(A6MM.margin * s);
  const q = 0.22 * (tw + 2 * b); const qr = pad + tw - 2 * s; const qb = pad + th - 2 * s;
  return (
    <span className="ex-paper-wrap" style={{ width: pw + (stack ? 8 : 0), height: ph + (stack ? 8 : 0) }}>
      {stack ? <span className="ex-paper ex-paper--under maude-v2 k-fixed" data-theme="light" style={{ width: pw, height: ph }} /> : null}
      <span className="ex-paper maude-v2 k-fixed" data-theme="light" style={{ width: pw, height: ph }}>
        <span className="ex-paper-art" style={{ left: pad - b, top: pad - b, width: tw + 2 * b, height: th + 2 * b }}>
          <Flyer side={side} variant={variant} qrOut={qrOut} />
          {b ? <span className="ex-tint" style={{ inset: b }} /> : null}
        </span>
        {marks ? corners.map(([x, y, dx, dy], i) => (
          <span key={i}>
            <i className="ex-crop ex-crop--h" style={{ left: dx < 0 ? x - gap - len : x + gap, top: y, width: len, transformOrigin: dx < 0 ? "right" : "left", ["--i" as string]: i } as CSSProperties} />
            <i className="ex-crop ex-crop--v" style={{ left: x, top: dy < 0 ? y - gap - len : y + gap, height: len, transformOrigin: dy < 0 ? "bottom" : "top", ["--i" as string]: i } as CSSProperties} />
          </span>
        )) : null}
        {margin ? <span className="ex-margin" style={{ left: pad + m, top: pad + m, width: tw - 2 * m, height: th - 2 * m }} /> : null}
        {flag ? (
          <>
            <span className="ex-flag" style={{ left: qr - q - 3, top: qb - q - 3, width: q + 6, height: q + 6 }} />
            <span className="ex-flag-tag" style={{ left: qr - q - 3, top: qb - q - 22 }}>2 mm to the cut</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Pages of a print PDF — a thumbnail per page, the current one ringed. */
function Pages({ pages, at = 0 }: { pages: [("a" | "b"), ("flag" | "tackle")][]; at?: number }) {
  return (
    <span className="ex-pages">
      <span className="icon-btn k-icon-sm ex-pages-nav" title="Previous page"><Icon name="submenu" size={12} /></span>
      {pages.map(([sd, v], i) => (
        <span key={i} className="ex-pg-th maude-v2 k-fixed" data-theme="light" data-on={i === at ? "true" : undefined}><Flyer side={sd} variant={v} /></span>
      ))}
      <span className="icon-btn k-icon-sm" title="Next page"><Icon name="submenu" size={12} /></span>
    </span>
  );
}

/** What the marks on the paper mean. */
function Legend({ margin = false }: { margin?: boolean }) {
  return (
    <span className="ex-legend">
      <span><i className="ex-lg ex-lg--tint" />Bleed 3 mm</span>
      <span><i className="ex-lg ex-lg--cut" />Cut</span>
      {margin ? <span><i className="ex-lg ex-lg--safe" />Safe 5 mm</span> : null}
    </span>
  );
}

/** A web page drawn at full length (Homepage · Desktop, 1440 × 3120). */
function LongPage({ fold = false }: { fold?: boolean }) {
  return (
    <div className="ex-long maude-v2 k-fixed" data-theme="light">
      <div className="ex-long-hero"><span className="ex-long-nav"><b /><i /><i /><i /></span><span className="ex-long-sun" /><span className="ex-long-hill" /><span className="ex-long-h1" /><span className="ex-long-h2" /></div>
      <div className="ex-long-svc"><i /><i /><i /></div>
      <div className="ex-long-quote"><b /><i /></div>
      <div className="ex-long-work"><i /><i /></div>
      <div className="ex-long-price"><i /><i /><i /></div>
      <div className="ex-long-foot"><b /><i /></div>
      {fold ? <span className="ex-long-fold" /> : null}
    </div>
  );
}

/** A preview picture with its size line underneath. */
function Pic({ w, h, cap, children }: { w: number; h: number; cap: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className="ex-pic" style={{ width: w, height: h }}>{children}</span>
      <span className="ex-prev-cap">{cap}</span>
    </>
  );
}

/** Hype trailer, the filmstrip under the video sheet: its titles, its six shots, its music — scrub to pick the
 *  preview frame. Same data as 07's timeline (./_video HYPE_*). */
function Film({ at = 4 }: { at?: number }) {
  const len = 15;
  const pct = (v: number) => `${(v / len) * 100}%`;
  return (
    <div className="ex-film" aria-label="Hype trailer filmstrip, 0:15">
      <div className="ex-film-lanes">
        <div className="ex-film-lane ex-film-lane--t">
          {HYPE_TEXT.map((t) => <span key={String(t.n)} className="ex-film-ti" style={{ left: pct(t.s), width: pct(t.d) }}>{t.n}</span>)}
        </div>
        <div className="ex-film-lane ex-film-lane--v maude-v2 k-fixed" data-theme="light">
          {HYPE_CLIPS.map((c, i) => (
            <span key={c.n} className="ex-film-clip" style={{ left: pct(c.s), width: pct(c.d) }}>
              <ClipPic pic={c.pic} i={i} strip />
              <em>{c.n}</em>
            </span>
          ))}
        </div>
        <div className="ex-film-lane ex-film-lane--m"><VIcon name="music" size={11} />{HYPE_MUSIC.n}</div>
        <span className="ex-film-head" style={{ left: pct(at) }}><b>0:0{at}</b></span>
      </div>
      <div className="ex-film-ticks">{[0, 5, 10, 15].map((t) => <span key={t} style={{ left: pct(t) }}>{t === 15 ? "0:15" : `0:${String(t).padStart(2, "0")}`}</span>)}</div>
    </div>
  );
}

/** The two formats of Hype trailer — tick to export more than one (= 07's linked formats). */
function Formats() {
  return (
    <span className="ex-shapes">
      {([["Reels 9:16", "1080 × 1920", 12, 21], ["16:9", "1920 × 1080", 26, 15]] as [string, string, number, number][]).map(([l, sz, w, h]) => (
        <span key={l} className="ex-shape" data-on="true">
          <span className="ex-box" data-on="true"><Icon name="check" size={10} /></span>
          <span className="ex-shape-pic maude-v2 k-fixed" data-theme="light" style={{ width: w, height: h }}><ClipPic pic="field" /></span>
          <span className="ex-shape-t">{l}<small>{sz}</small></span>
        </span>
      ))}
    </span>
  );
}

/* ═══ Canvases behind the sheets ════════════════════════════════════════════════════════════ */

function Chrome({ project = "Alligators brand", canvas, status = "saved", people = ["tereza", "jonas"], zoom = 20, panel, tool = "select", ai = <PanelIcon icon="spark" at="ai" />, cluster }: { project?: string; canvas?: string; status?: "saved" | "syncing" | "offline" | "local"; people?: Who[]; zoom?: number; panel?: ReactNode; tool?: string; ai?: ReactNode; cluster?: ReactNode }) {
  return (
    <>
      <ProjectPill project={project} canvas={canvas} />
      {panel ?? <PanelIcon icon="panel-left" at="left" />}
      {cluster ?? <ShareCluster mode="edit" people={people} status={status} />}
      <ZoomUndo zoom={zoom} />
      <Toolbar tool={tool} />
      {ai}
    </>
  );
}

/** The kit's Share cluster (lifted markup) with its Exports slot: one icon, a ring while anything runs.
 *  Kit candidate: ShareCluster `exports={{ ring?, open? }}`. */
function ExCluster({ ring, open = false, style }: { ring?: number; open?: boolean; style?: CSSProperties }) {
  return (
    <div className="island k-tr" style={style}>
      <span className="k-faces"><Avatar who="tereza" /><Avatar who="jonas" /></span>
      <span className="k-saved"><Icon name="cloud" size={16} />Saved</span>
      <ModeSwitch mode="edit" />
      <span className={`icon-btn ex-ringed${open ? " ex-on" : ""}`} title={ring !== undefined ? `Exports — ${ring} % done` : "Exports"}>
        <Icon name="export" />
        {ring !== undefined ? <svg className="ex-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="ex-ring-v" strokeDasharray={`${(ring * 0.942).toFixed(1)} 100`} /></svg> : null}
      </span>
      <span className="icon-btn" title="Hide panels ⌘\"><Icon name="panel-right" /></span>
      <span className="btn btn--primary"><Icon name="share" size={14} />Share</span>
    </div>
  );
}

/** social/matchday at 20 % — post 4:5 1080 × 1350 → 216 × 270, story → 216 × 384, FB cover 1920 × 1005 → 384 × 201. */
function Matchday({ sel = true }: { sel?: boolean }) {
  return (
    <>
      <Artboard label="DOMA · Post 4:5 — feed matchday" kind="digital" x={330} y={110} w={216} h={270} selected={sel} size="1080 × 1350"><GatorMock variant="social" headline="DOMA" sub="Gameweek 4 · So 15:00" /></Artboard>
      <Artboard label="DOMA · Story 9:16 — story matchday" kind="digital" x={640} y={110} w={216} h={384}><GatorMock variant="reel" headline="DOMA" sub="So 15:00 · Kraví hora" /></Artboard>
      <Artboard label="DOMA · FB event cover" kind="digital" x={896} y={110} w={384} h={201}><GatorMock variant="web" headline="MATCHDAY · DOMA" sub="Alligators vs. Ostrava Steelers" /></Artboard>
      <Artboard label="VENKU · Post 4:5 — feed matchday" kind="digital" x={330} y={430} w={216} h={270}><GatorMock variant="social" headline="VENKU" sub="Gameweek 5 · Ne 14:00" /></Artboard>
    </>
  );
}

/** print/LetakA6 at 40 % — A6 + 3 mm bleed (419 × 581) → 168 × 232. */
function Letak({ sel = "A · přední (FLAG)" }: { sel?: string }) {
  const abs: [string, "a" | "b", "flag" | "tackle", number][] = [
    ["A · přední (FLAG)", "a", "flag", 290], ["B · zadní (FLAG)", "b", "flag", 528], ["A · přední (TACKLE)", "a", "tackle", 766], ["B · zadní (TACKLE)", "b", "tackle", 1004],
  ];
  return (
    <>
      {abs.map(([l, s, v, x]) => (
        <Artboard key={l} label={l} kind="print" x={x} y={120} w={168} h={232} selected={l === sel} size="105 × 148 mm"><Flyer side={s} variant={v} qrOut={v === "tackle" && s === "a"} /></Artboard>
      ))}
    </>
  );
}

/** Studio site / Homepage at 14 % — Desktop 1440 × 3120 → 202 × 437, Tablet 834 × 3600 → 117 × 504, Mobile 390 × 4200 → 55 × 588. */
function Homepage() {
  return (
    <>
      <Artboard label="Desktop" kind="web" x={360} y={100} w={202} h={437} selected size="1440 × 3120"><LongPage /></Artboard>
      <Artboard label="Tablet" kind="web" x={602} y={100} w={117} h={504}><LongPage /></Artboard>
      <Artboard label="Mobile" kind="web" x={759} y={100} w={55} h={588}><LongPage /></Artboard>
    </>
  );
}

/** social/video-hype at 20 % — the same canvas 07 edits: the feed post 4:5 and the two video formats (3 artboards, = 08). */
function Hype() {
  return (
    <>
      <Artboard label="Náhled do feedu · 4:5" kind="digital" x={164} y={110} w={216} h={270} size="1080 × 1350"><GatorMock variant="social" headline="NOVÝ TRAILER" sub="Nábor 2027 · odkaz v biu" /></Artboard>
      <Artboard label="Hype trailer · Reels 9:16" kind="video" x={420} y={110} w={216} h={384} selected size="1080 × 1920"><Still pic="field" title="RYCHLOST" titleAt="bottom" /></Artboard>
      <Artboard label="Hype trailer · 16:9" kind="video" x={676} y={110} w={384} h={216}><Still pic="field" pos={40} title="STAŇ SE ALLIGATOREM" titleAt="bottom" /></Artboard>
    </>
  );
}

/** 2026/combine/Combine-kampan at 12 % — as it really is (= 08 Artboard Kinds): 21 artboards, 19 fixed size + 2 print,
 *  no web, no video (its video lives in Combine-video-AI). Rows follow the real file: event covers + IG announcement ·
 *  disciplines carousel · posts and stories · the score card. The release plan sits above the view. Labels as in 08. */
const KS = 0.12;
const ks = (n: number) => Math.round(n * KS);
const KP = { w: ks(1080), h: ks(1350) };
const KST = { w: ks(1080), h: ks(1920) };
const KEV = { w: ks(1920), h: ks(1005) };
const KSLIDES = ["40 YARD DASH", "BENCH PRESS", "VERTICAL JUMP", "BROAD JUMP", "3-CONE DRILL", "20-YARD SHUTTLE", "POSITION DRILLS"];
type KA = { id: string; label: string; kind: Kind; x: number; y: number; w: number; h: number; body: ReactNode };
function kampan(): KA[] {
  const x0 = 300; const g = 10; const y1 = 92; const y2 = y1 + KP.h + 30; const y3 = y2 + KP.h + 30;
  return [
    { id: "fbA", label: "FB event cover · FB Event · 1.91:1", kind: "digital", x: x0, y: y1, w: KEV.w, h: KEV.h, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
    { id: "fbB", label: "FB event cover · varianta B, datum vpředu", kind: "digital", x: x0 + (KEV.w + g), y: y1, w: KEV.w, h: KEV.h, body: <GatorMock variant="web" headline="ST 1. 10. · 9:00" sub="" /> },
    { id: "fbC", label: "FB event cover · varianta C, žlutá", kind: "digital", x: x0 + 2 * (KEV.w + g), y: y1, w: KEV.w, h: KEV.h, body: <GatorMock variant="invite" headline="COMBINE 2026" sub="" /> },
    { id: "fbSafe", label: "FB event cover · kontrola safe zóny (nenahrávat)", kind: "digital", x: x0 + 3 * (KEV.w + g), y: y1, w: KEV.w, h: KEV.h, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
    { id: "ig", label: "Oznámení události · Instagram · IG Post · 4:5", kind: "digital", x: x0 + 4 * (KEV.w + g), y: y1, w: KP.w, h: KP.h, body: <GatorMock variant="social" headline="COMBINE" sub="1. 10." /> },
    { id: "disc0", label: "Carousel cover · sedm disciplín · IG Post · 4:5", kind: "digital", x: x0, y: y2, w: KP.w, h: KP.h, body: <GatorMock variant="poster" headline="7 DISCIPLÍN" sub="" /> },
    ...KSLIDES.map((d, i): KA => ({ id: `disc${i + 1}`, label: `Slide 0${i + 1} · ${d} · IG Post · 4:5`, kind: "digital", x: x0 + (i + 1) * (KP.w + g), y: y2, w: KP.w, h: KP.h, body: <GatorMock variant="numbers" headline={`0${i + 1}`} /> })),
    { id: "post", label: "Pozvánka na combine · IG Post · 4:5", kind: "digital", x: x0, y: y3, w: KP.w, h: KP.h, body: <GatorMock variant="social" headline="COMBINE" sub="1. 10." /> },
    { id: "reelHost", label: "Obálka videosérie · pozvánka od hosta · IG Story · 9:16", kind: "digital", x: x0 + (KP.w + g), y: y3, w: KST.w, h: KST.h, body: <GatorMock variant="reel" headline="HOST" sub="díl 1 ze 6" /> },
    { id: "story1", label: "Pozvánka · story · IG Story · 9:16", kind: "digital", x: x0 + 2 * (KP.w + g), y: y3, w: KST.w, h: KST.h, body: <GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 9." /> },
    { id: "story2", label: "Zítra se měří · countdown story · IG Story · 9:16", kind: "digital", x: x0 + 3 * (KP.w + g), y: y3, w: KST.w, h: KST.h, body: <GatorMock variant="reel" headline="ZÍTRA" sub="9:00" /> },
    { id: "karta1", label: "Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm", kind: "print", x: x0 + 4 * (KP.w + g), y: y3, w: ks(1144), h: ks(816), body: <GatorMock variant="print" headline="Výsledky" sub="Combine 2026" /> },
    { id: "karta2", label: "Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm", kind: "print", x: x0 + 4 * (KP.w + g) + ks(1144) + g, y: y3, w: ks(1144), h: ks(816), body: <GatorMock variant="print" headline="Disciplíny" sub="40 yd · bench · skok" /> },
  ];
}
function Kampan({ sel = [] }: { sel?: string[] }) {
  return <>{kampan().map((a) => <Artboard key={a.id} label={a.label} kind={a.kind} x={a.x} y={a.y} w={a.w} h={a.h} selected={sel.includes(a.id)}><span className="ex-tiny">{a.body}</span></Artboard>)}</>;
}
const KAMPAN_PICK = ["disc0", "disc6", "disc7", "post", "karta2"];

/** 2026/dresy/Uniformy-2027 at 20 % — where you keep working while exports run. */
function Uniformy() {
  return (
    <>
      <Artboard label="Domácí dres 2027" kind="digital" x={300} y={120} w={216} h={270} selected size="1080 × 1350"><GatorMock variant="jersey" headline="Domácí dres 2027" /></Artboard>
      <Artboard label="Venkovní dres 2027" kind="digital" x={556} y={120} w={216} h={270}><GatorMock variant="jersey" headline="Venkovní dres 2027" /></Artboard>
      <Artboard label="Helma z boku" kind="digital" x={300} y={440} w={216} h={270}><GatorMock variant="jersey" headline="Helma z boku" /></Artboard>
      <Artboard label="Kalhoty doma / venku" kind="digital" x={556} y={440} w={216} h={270}><GatorMock variant="jersey" headline="Kalhoty doma / venku" /></Artboard>
    </>
  );
}

/** Studio site / Pricing at 28 %. */
function Pricing() {
  return (
    <>
      <Artboard label="Desktop" kind="web" x={296} y={120} w={403} h={252}><PricingMock /></Artboard>
      <Artboard label="Tablet" kind="web" x={727} y={120} w={234} h={334}><PricingMock plans={["Solo", "Studio"]} /></Artboard>
      <Artboard label="Mobile" kind="web" x={989} y={120} w={109} h={236}><PhoneMock title="Simple pricing" tone="sky" /></Artboard>
    </>
  );
}

/* 93 canvases: 2026 16 + club-web 9 + print 6 + social 31 + legacy 27 + 4 at the root (as in 01). */
const SOCIAL_ITEMS: CanvasItem[] = [
  { name: "matchday", art: "gator-social", kinds: ["digital"] },
  { name: "matchday-variants", art: "gator-social", kinds: ["digital"] },
  { name: "score-mvp", art: "gator-numbers", kinds: ["digital"] },
  { name: "sponsors", art: "gator-poster", kinds: ["digital"] },
  { name: "gameweek-schedule", art: "gator-social", kinds: ["digital"] },
  { name: "video-hype", art: "gator-reel", kinds: ["digital", "video"] },
  { name: "video-recap", art: "video", kinds: ["video"] },
  { name: "video-touchdown", art: "video", kinds: ["video"] },
];
const GATOR_FOLDERS: Folder[] = [
  { name: "2026", count: 16 },
  { name: "club-web", count: 9 },
  { name: "print", count: 6 },
  { name: "social", open: true, count: 31, items: SOCIAL_ITEMS },
  { name: "legacy", count: 27 },
];

/* ═══ Batch groups ══════════════════════════════════════════════════════════════════════════ */

function Group({ kind, title, sub, arts, value, note }: { kind: Kind | "image"; title: ReactNode; sub: ReactNode; arts: Art[]; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="ex-grp">
      <span className="ex-grp-ic"><Icon name={kind} size={16} /></span>
      <span className="ex-grp-t"><strong>{title}</strong><small>{sub}</small></span>
      <span className="ex-grp-arts">{arts.map((a, i) => <Thumb key={i} art={a} className="ex-thumb" />)}</span>
      <span className="ex-grp-v">{value}{note ? <small>{note}</small> : null}</span>
    </div>
  );
}

/* ═══ Progress / Exports panel ═══════════════════════════════════════════════════════════════ */

type Job = { name: ReactNode; meta?: ReactNode; st: "done" | "busy" | "queued" | "fail" | "warn"; word: ReactNode; pct?: number; art?: Art; acts?: ReactNode };
function JobRow({ j, hover = false }: { j: Job; hover?: boolean }) {
  return (
    <div className={`ex-job${hover ? " ex-job--hover" : ""}${j.st === "warn" || j.st === "fail" ? " ex-job--warn" : ""}`}>
      {j.art ? <Thumb art={j.art} className="ex-job-thumb" /> : null}
      <span className="ex-job-t">
        <span className="ex-job-n">{j.name}</span>
        {j.meta ? <span className="ex-job-m">{j.meta}</span> : null}
        {j.pct !== undefined ? <span className="ex-bar"><b style={{ width: `${j.pct}%` }} /></span> : null}
      </span>
      {j.acts ?? <span className={`ex-job-w ex-job-w--${j.st}`}>{j.st === "done" ? <Icon name="check" size={12} /> : j.st === "fail" || j.st === "warn" ? <Icon name="problem" size={12} /> : j.st === "queued" ? <Icon name="clock" size={12} /> : <Icon name="sync" size={12} />}{j.word}</span>}
    </div>
  );
}

function ExportsPanel({ title = "Exports", children, foot, style, width = 360 }: { title?: ReactNode; children: ReactNode; foot?: ReactNode; style?: CSSProperties; width?: number }) {
  return (
    <div className="island island--pad ex-panel" style={{ width, ...style }}>
      <div className="ex-panel-hd"><Icon name="export" size={14} /><span>{title}</span><span className="icon-btn k-icon-sm" title="Open the Downloads folder" aria-label="Open the Downloads folder"><Icon name="folder" size={14} /></span><span className="icon-btn k-icon-sm" title="Fold into the Exports icon" aria-label="Fold into the Exports icon"><Icon name="chevron" size={14} /></span></div>
      {children}
      {foot ? <p className="ex-panel-foot">{foot}</p> : null}
    </div>
  );
}

/* ═══ Close-up frame ════════════════════════════════════════════════════════════════════════ */

function Closeup({ title, sub, note, children, theme = "light" }: { title: ReactNode; sub?: ReactNode; note: ReactNode; children: ReactNode; theme?: "light" | "dark" }) {
  return (
    <V2 theme={theme} className="ex-closeup">
      <div className="ex-closeup-hd"><p className="ex-closeup-h">{title}</p>{sub ? <p className="ex-closeup-sub">{sub}</p> : null}</div>
      {children}
      <div className="ex-closeup-note">{note}</div>
    </V2>
  );
}
function Col({ label, children, w, style }: { label: ReactNode; children: ReactNode; w?: number; style?: CSSProperties }) {
  return (
    <div className="ex-col" style={{ width: w, ...style }}>
      <p className="ex-col-l">{label}</p>
      {children}
    </div>
  );
}
function Cmd({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <span className="ex-cmd">
      <span className="k-mono ex-cmd-t">{children}</span>
      {note ? <span className="ex-cmd-n">{note}</span> : null}
      <span className="icon-btn k-icon-sm" title="Copy" aria-label="Copy"><Icon name="duplicate" size={13} /></span>
    </span>
  );
}

/* ═══ The video sheet — one row set, online or offline ═══════════════════════════════════════ */

function VideoSheet({ offline = false }: { offline?: boolean }) {
  return (
    <ExSheet
      title="Export “Hype trailer”"
      sub="video-hype · 0:15 · Reels 9:16 selected"
      scope={{ on: "sel", n: [1, 3, 115, 524] }}
      prevW={168}
      preview={<Pic w={120} h={213} cap={<>Frame at 0:04<br />scrub the strip below</>}><span className="maude-v2 k-fixed ex-fill" data-theme="light"><Still pic="field" title="RYCHLOST" titleAt="bottom" scrub={{ at: 27, time: "0:04" }} /></span></Pic>}
      summary={offline ? "2 videos · about 76 MB · starts now on this Mac, about 3 min" : "2 videos · about 280 MB · about 2 min in the cloud"}
      primary="Export 2 videos"
      width={720}
      adv="Frame rate, codec, bitrate, file names"
      extra={<Film at={4} />}
    >
      <Row k="Formats" note="Its linked 16:9 is ticked too — 1 artboard selected, 2 videos."><Formats /></Row>
      <Row k="Format"><Seg options={["MP4", "GIF", "Sound only"]} value="MP4" /><span className="btn btn--ghost btn--sm">Other…</span></Row>
      <Row k="Quality"><Seg options={[["1080p", "1080 × 1920"], ["4K", "2160 × 3840"]]} value={offline ? "1080p" : "4K"} /></Row>
      <Row k="Sound"><InSwitch on /><span className="ex-row-n ex-row-n--in">Music, mixed as on the timeline</span></Row>
      <Row k="Captions"><Seg options={["Burned in", "As a file", "Both", "Off"]} value="Off" /><span className="ex-row-n ex-row-n--in">No speech to caption</span></Row>
      <Row k="Render" top>
        <span className="ex-opts">
          {offline ? (
            <>
              <Option icon={<Icon name="offline" size={16} />} title="In the cloud" sub="Waits for a connection, then starts by itself." />
              <Option on icon={<Icon name="laptop" size={16} />} title="On this Mac" sub="Starts now. About 3 min — keep this window open until it's done." />
            </>
          ) : (
            <>
              <Option on icon={<Icon name="cloud" size={16} />} title="In the cloud" sub="About 2 min. Keeps going if this Mac sleeps." />
              <Option icon={<Icon name="laptop" size={16} />} title="On this Mac" sub="About 9 min. Keep this window open until it's done." />
            </>
          )}
        </span>
      </Row>
      <Row k="File names"><Field>Hype trailer · Reels 9-16{offline ? "" : " — 4K"}.mp4<span className="ex-more">and 1 more</span></Field></Row>
      <Row k="Save to"><InSelect value="Downloads" /></Row>
    </ExSheet>
  );
}

/* ═══ The canvas ════════════════════════════════════════════════════════════════════════════ */

export default function Export() {
  return (
    <DesignCanvas>
      {/* ── 1 · One sheet that adapts ─────────────────────────────────────────────────────────── */}
      <DCSection id="adapts" title="One Export sheet that fits what's selected" subtitle="⇧⌘E, Menu › Export…, or right-click an artboard › Export… — a social post, a print flyer, a web page, a video · Scope is always on top">
        <DCArtboard id="ex-social" label="1 · A social post → PNG or JPG" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Two formats, two sizes, done.">A post exports at Instagram's own size — 1×, PNG. Scope sits on top with every count, so widening to the whole canvas is one click, never a surprise.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Matchday /></Canvas>
              <Chrome canvas="matchday" />
              <Veil />
              <ExSheet
                title="Export “DOMA · Post 4:5 — feed matchday”"
                scope={{ on: "sel", n: [1, 7, 115, 524] }}
                preview={<Pic w={136} h={170} cap="1080 × 1350 · Post 4:5"><GatorMock variant="social" headline="DOMA" sub="Gameweek 4 · So 15:00" /></Pic>}
                summary="1 file · about 1.4 MB · a second"
                width={660}
              >
                <Row k="Format"><Seg options={["PNG", "JPG"]} value="PNG" /><span className="btn btn--ghost btn--sm">Other…</span></Row>
                <Row k="Size" note="Instagram resizes anything larger."><Seg options={[["1×", "1080 × 1350"], ["2×", "2160 × 2700"]]} value="1×" /></Row>
                <AnnoRow />
                <Row k="File name"><Field>DOMA · Post 4-5 — feed matchday.png</Field></Row>
                <Row k="Save to"><InSelect value="Downloads" /></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-print" label="2 · A print artboard → Print PDF, on paper" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="The preview is the PDF the print shop gets.">Crop marks draw in at the corners, the bleed past the cut is tinted, and the back sits under the front as page 2. Untick Bleed and the paper changes with it.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Letak /></Canvas>
              <Chrome canvas="LetakA6" zoom={40} />
              <Veil />
              <ExSheet
                title="Export “A · přední (FLAG)” + its back"
                sub="LetakA6 · print"
                scope={{ on: "sel", n: [1, 4, 14, 524] }}
                prevW={300}
                width={780}
                preview={
                  <>
                    <span className="ex-pic ex-pic--paper"><Paper stack /></span>
                    <Pages pages={[["a", "flag"], ["b", "flag"]]} />
                    <span className="ex-prev-cap">Page 1 of 2 · A6 · 105 × 148 mm</span>
                    <Legend />
                  </>
                }
                summary="1 PDF · 2 pages · about 3 MB · a few seconds"
              >
                <Row k="Format"><Seg options={["Print PDF", "PDF", "PNG"]} value="Print PDF" /><span className="btn btn--ghost btn--sm">Other…</span></Row>
                <Row k="Print" top>
                  <span className="ex-checks">
                    <Check sub="colour runs 3 mm past the cut">Bleed</Check>
                    <Check sub="where to cut — outside the bleed">Crop marks</Check>
                    <Check sub="page 2 — the back of this leták">Add “B · zadní (FLAG)”</Check>
                  </span>
                </Row>
                <Row k="Colour"><span className="ex-val">RGB — the print shop converts to CMYK.</span></Row>
                <AnnoRow print />
                <Row k="File name"><Field>LetakA6 — FLAG.pdf</Field></Row>
                <Row k="Save to"><InSelect value="Downloads" /></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-web" label="3 · A web artboard → full page, or PDF" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="A web page exports whole.">Image takes the full page — all 3 120 px, not just the visible area. Code isn't a file format: the link at the foot opens Handoff to production.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Homepage /></Canvas>
              <Chrome project="Studio site" canvas="Homepage" people={["tereza"]} zoom={14} />
              <Veil />
              <ExSheet
                title="Export “Desktop”"
                sub="Homepage · Studio site"
                scope={{ on: "sel", n: [1, 3, null, 11] }}
                preview={<Pic w={92} h={200} cap={<>1440 × 3120<br />dashed: visible area</>}><LongPage fold /></Pic>}
                summary="1 file · about 4.8 MB · a second"
                width={680}
              >
                <Row k="Format"><Seg options={["Image", "PDF"]} value="Image" /><span className="btn btn--ghost btn--sm">Other…</span></Row>
                <Row k="Area"><Seg options={[["Full page", "1440 × 3120"], ["Visible area", "1440 × 900"]]} value="Full page" /></Row>
                <Row k="Size" note="2× stays sharp on Retina screens."><Seg options={["PNG 1×", "PNG 2×", "JPG 2×"]} value="PNG 2×" /></Row>
                <AnnoRow />
                <Row k="File name"><Field>Homepage — Desktop@2x.png</Field></Row>
                <Row k="Save to"><InSelect value="Downloads" /></Row>
                <span className="ex-code"><Icon name="corner" size={14} />Code for a developer?<span className="ex-code-a">Handoff to production…</span><Kbd>⇧⌘H</Kbd></span>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-video" label="4 · A video artboard → MP4, GIF or sound, with a filmstrip" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Video: which formats, how sharp, where it renders.">The filmstrip shows the whole edit — scrub it to check any frame. Its 16:9 sibling is ticked too; 4K suggests the cloud, which keeps going if this Mac sleeps.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Hype /></Canvas>
              <Chrome canvas="video-hype" />
              <Veil />
              <VideoSheet />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-inspector" label="5 · No sheet at all — the inspector's export row, Copy as PNG" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="The quickest export skips the sheet.">The inspector keeps this artboard's own export sizes — set once, one click from then on. ⇧⌘C copies it as a PNG to paste into a chat or a post.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Matchday /></Canvas>
              <Chrome canvas="matchday" />
              <div className="island island--pad k-insp ex-insp">
                <div className="k-insp-hd"><strong>DOMA · Post 4:5 — feed matchday</strong><span className="chip">Fixed size</span></div>
                <div className="k-insp-row"><span>Size</span><InSize w={1080} h={1350} /></div>
                <div className="k-insp-row"><span>Preset</span><InSelect value="Instagram post 4:5" /></div>
                <div className="ex-insp-sec">
                  <div className="ex-insp-h"><span>Export</span><span className="icon-btn k-icon-sm" title="Add a size" aria-label="Add a size"><Icon name="plus" size={14} /></span></div>
                  <div className="ex-insp-pre"><InSelect value="1×" /><InSelect value="PNG" /><span className="icon-btn k-icon-sm" title="Remove this size" aria-label="Remove this size"><VIcon name="minus" size={14} /></span></div>
                  <div className="ex-insp-pre"><InSelect value="2×" /><InSelect value="JPG" /><span className="icon-btn k-icon-sm" title="Remove this size" aria-label="Remove this size"><VIcon name="minus" size={14} /></span></div>
                  <span className="btn ex-insp-btn"><Icon name="export" size={14} />Export 2 files</span>
                  <span className="ex-insp-n"><span>Copy as PNG</span><Kbd>⇧⌘C</Kbd></span>
                  <span className="ex-insp-n"><span>Export… — every option</span><Kbd>⇧⌘E</Kbd></span>
                </div>
              </div>
              <Toast icon="done" at="dock">Copied “DOMA · Post 4:5” as a PNG — paste it anywhere.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-formats" label="6 · Other… — every format, one list away" width={W} height={860} fixed>
          <Closeup
            title="Other… lists every format there is — the ones that don't fit say why"
            sub="Selected: Post 4:5 — a fixed-size artboard from the Social presets. Nothing from today's Export dialog was dropped; JPG and Sound only are new."
            note={<Note n={6} title="What fits the kind up front; every other format one click down.">Other… groups the rest by what you're making, each with a one-line reason when it can't apply. Search finds every one of them too.</Note>}
          >
            <div className="ex-cols">
              <Col label="Other… — open from a social post">
                <Menu width={380} items={[
                  { group: "Image" },
                  { label: "PNG", checked: true, note: "Transparent where empty" },
                  { label: "JPG", note: "Smaller, no transparency · new" },
                  { label: "SVG", note: "Shapes and text stay sharp" },
                  "sep", { group: "Document" },
                  { label: "PDF", note: "One page per artboard" },
                  { label: "Print PDF", note: "Needs a print artboard", disabled: true },
                  { label: "PowerPoint", note: "Whole canvas, a slide each" },
                  "sep", { group: "Video" },
                  { label: "MP4 · GIF · WebM", note: "Needs a video artboard", disabled: true },
                  { label: "Sound only", note: "Needs a video artboard · new", disabled: true },
                  "sep", { group: "For other tools" },
                  { label: "Canva", note: "A deck Canva opens" },
                  { label: "Web page (HTML)", note: "Opens in any browser" },
                  { label: "Code…", keys: "⇧⌘H", note: "Handoff to production" },
                  "sep", { group: "Whole project" },
                  { label: "Project ZIP", note: "Canvases, assets, design system" },
                ]} />
              </Col>
              <Col label="What each kind offers first" style={{ flex: 1 }}>
                <div className="ex-kinds">
                  {([
                    ["digital", "Fixed size (social, app)", "PNG · JPG", "1× — the preset's own size", "SVG · PDF · Canva"],
                    ["print", "Print", "Print PDF · PDF · PNG", "Bleed + crop marks on, back as page 2", "SVG · PowerPoint · Canva"],
                    ["web", "Web page", "Image · PDF", "Full page, PNG 2×; Code → Handoff ⇧⌘H", "HTML · SVG · PowerPoint"],
                    ["video", "Video", "MP4 · GIF · Sound only", "1080p; the cloud suggested for 4K", "WebM · a still as PNG"],
                  ] as [Kind, string, string, string, string][]).map(([k, n, a, d, o]) => (
                    <div className="ex-kind" key={k}>
                      <span className="ex-kind-h"><Icon name={k} size={14} />{n}</span>
                      <span className="ex-kind-r"><small>Up front</small>{a}</span>
                      <span className="ex-kind-r"><small>Defaults</small>{d}</span>
                      <span className="ex-kind-r"><small>Under Other…</small>{o}</span>
                    </div>
                  ))}
                </div>
                <div className="ex-ways">
                  <p className="ex-col-l">Ways in</p>
                  <span className="ex-way"><Kbd>⇧⌘E</Kbd>the selection — or this canvas when nothing is selected</span>
                  <span className="ex-way"><span className="chip">Menu › Export…</span>or Menu › File › Export…</span>
                  <span className="ex-way"><span className="chip">Right-click an artboard › Export…</span><span className="chip">Right-click a folder › Export folder…</span></span>
                  <span className="ex-way"><span className="chip">Inspector › Export</span>the artboard's own sizes, no sheet · <Kbd>⇧⌘C</Kbd> Copy as PNG</span>
                  <span className="ex-way"><Kbd>⌘K</Kbd>“export”, “pdf”, “mp4”, “canva” — each format is a result</span>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Many at once ──────────────────────────────────────────────────────────────────── */}
      <DCSection id="batch" title="Many artboards at once — Scope decides" subtitle="Nothing selected exports this canvas · five artboards of two kinds · a whole folder, Alligators social, 31 canvases">
        <DCArtboard id="ex-canvas" label="7 · ⇧⌘E with nothing selected → this canvas" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Nothing selected means this canvas — not the project.">Combine-kampan's 21 artboards, sorted by kind — 19 fixed size, 2 print sheets. Folder and Whole project are one click away in Scope, with their counts showing before you pick.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan /></Canvas>
              <Chrome canvas="Combine-kampan" zoom={12} />
              <Veil />
              <ExSheet
                title="Export “Combine-kampan” — 21 artboards"
                sub="2026/combine · nothing was selected"
                scope={{ on: "canvas", n: [null, 21, 38, 524] }}
                width={700}
                summary="21 files · about 140 MB · about 20 seconds on this Mac"
                primary="Export 21 artboards"
                adv="File names, colour, per-artboard choices"
              >
                <Group kind="digital" title="Fixed size · 19" sub="Release plan, 4 FB event covers, the carousel, posts and stories…" arts={["gator-web", "gator-numbers", "gator-social", "gator-reel"]} value={<InSelect value="PNG · 2×" />} />
                <Group kind="print" title="Print · 2" sub="Arch 1 · vnějšek, Arch 2 · vnitřek — the score card" arts={["gator-print", "gator-print"]} value={<InSelect value="Print PDF" />} note="Bleed + crop marks" />
                <Row k="Folders"><InSelect value="One folder" /><span className="ex-row-n ex-row-n--in">Combine-kampan/Arch 1 · vnějšek.pdf</span></Row>
                <Row k="Save to"><InSelect value="Downloads" /></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-batch-pick" label="8 · Five artboards, two kinds" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Mixed kinds, one sheet, one button.">Five artboards picked on Combine-kampan: the carousel cover, two slides, the invitation post and a score-card sheet. Each group keeps its kind's default — change one and the other stays.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Kampan sel={KAMPAN_PICK} /></Canvas>
              <Chrome canvas="Combine-kampan" zoom={12} />
              <Veil />
              <ExSheet
                title="Export 5 artboards"
                sub="Combine-kampan · 2026/combine"
                scope={{ on: "sel", n: [5, 21, 38, 524] }}
                width={700}
                summary="5 files · about 34 MB · a few seconds on this Mac"
                primary="Export 5 artboards"
                adv="File names, colour, scale"
              >
                <Group kind="digital" title="Fixed size · 4" sub="Carousel cover, Slide 06, Slide 07, Pozvánka na combine" arts={["gator-poster", "gator-numbers", "gator-numbers", "gator-social"]} value={<InSelect value="PNG · 2×" />} />
                <Group kind="print" title="Print · 1" sub="Arch 2 · vnitřek (str. 2 + str. 3)" arts={["gator-print"]} value={<InSelect value="Print PDF" />} note="Bleed + crop marks" />
                <Row k="File names"><InSelect value="Canvas — artboard" /><span className="ex-row-n ex-row-n--in">Combine-kampan — Arch 2 · vnitřek.pdf</span></Row>
                <Row k="Save to"><InSelect value="Downloads" /></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-batch" label="9 · Export a folder — grouped by kind" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="A folder sorts itself by kind.">Right-click social › Export folder… opens Scope on Folder. Fixed size and video each get their own default; three shared-parts files aren't artboards and are left out, by name.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Matchday sel={false} /></Canvas>
              <Chrome canvas="matchday" panel={<CanvasesPanel project="Alligators brand" count={93} selected="matchday" folders={GATOR_FOLDERS} />} />
              <Veil />
              <ExSheet
                title="Export “social” — 31 canvases"
                scope={{ on: "folder", n: [null, 7, 115, 524] }}
                width={700}
                summary="115 files in 28 folders · about 1.6 GB · images about 1 min on this Mac · videos about 6 min in the cloud"
                primary="Export 115 artboards"
                adv="File names, colour, per-canvas choices"
              >
                <Group kind="digital" title="Fixed size · 100 artboards" sub="from 22 canvases — matchday, score-mvp, sponsors…" arts={["gator-social", "gator-numbers", "gator-poster", "gator-reel"]} value={<InSelect value="PNG · 1×" />} />
                <Group kind="video" title="Video · 15 artboards" sub="from 7 canvases — video-hype, video-recap, video-nabor…" arts={["gator-reel", "video", "video"]} value={<InSelect value="MP4 · 1080p" />} note="In the cloud" />
                <Hint icon="eye-off">_broadcast, _social and _video hold shared parts, not artboards — left out.</Hint>
                <Row k="Folders"><InSelect value="One per canvas" /><span className="ex-row-n ex-row-n--in">social/matchday/DOMA · Post 4-5 — feed matchday.png</span></Row>
                <Row k="Save to"><InSelect value="Downloads › social" /></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Progress and history ───────────────────────────────────────────────────────────── */}
      <DCSection id="progress" title="Progress, done, partly done — and the Exports panel" subtitle="Videos in the cloud while you keep working on the dresy · one action per toast · 114 of 115 made it; Recap waits for its music from Jonas's Mac">
        <DCArtboard id="ex-progress" label="10 · Rendering in the cloud — keep working" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Exports run in the background, in words.">The Exports icon in the Share cluster carries a ring while anything runs; open it for the list. Each row says where it runs — the cloud ones carry on if this Mac sleeps.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Uniformy /></Canvas>
              <Chrome canvas="Uniformy-2027" cluster={<ExCluster ring={68} open />} />
              <ExportsPanel style={{ position: "absolute", right: 16, top: 68 }} foot="Cloud renders keep going if this Mac sleeps or the window closes. Exports on this Mac need the window open — images and PDFs take seconds.">
                <JobRow j={{ name: "Hype trailer · 2 videos · 4K", meta: <><Icon name="cloud" size={11} />In the cloud · 64 % · about 1 min left</>, st: "busy", word: "", pct: 64, art: "gator-reel", acts: <span /> }} />
                <JobRow j={{ name: "social · 115 artboards", meta: <><Icon name="cloud" size={11} />100 PNGs ready · videos 9 of 15 · about 4 min</>, st: "busy", word: "", pct: 92, art: "gator-social", acts: <span /> }} />
                <JobRow j={{ name: "Uniformy-2027 · PowerPoint", meta: <><Icon name="laptop" size={11} />On this Mac · 12 slides · a few seconds</>, st: "busy", word: "", pct: 40, art: "gator-jersey", acts: <span /> }} />
                <JobRow j={{ name: "LetakA6 — FLAG.pdf", meta: <><Icon name="laptop" size={11} />On this Mac · Print PDF · 2 pages</>, st: "done", word: "Ready", art: "gator-print" }} />
              </ExportsPanel>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-states" label="11 · Cloud or this Mac, done, partly done" width={W} height={600} fixed>
          <Closeup
            title="Every moment of an export says itself in one line"
            sub="Same words as today's Exports panel: Queued · Rendering… · Ready · Failed — plus where it renders, and how many made it."
            note={<Note n={11} title="One action per moment.">Cloud or this Mac, the file lands on this Mac — so a finished export's one action is Show in Finder; a link is Share's job. A partial export says how many made it and retries only the one that didn't.</Note>}
          >
            <div className="ex-cols ex-cols--4">
              <Col label="In the cloud" w={236}>
                <ExportsPanel width={236}>
                  <JobRow j={{ name: "Hype trailer · 4K", meta: <><Icon name="cloud" size={11} />Rendering… 64 % · 1 min left</>, st: "busy", word: "", pct: 64, acts: <span /> }} />
                </ExportsPanel>
                <p className="ex-cap"><strong>Close the lid.</strong> The cloud keeps rendering; the file downloads to this Mac when it's back online.</p>
              </Col>
              <Col label="On this Mac" w={236}>
                <ExportsPanel width={236}>
                  <JobRow j={{ name: "Hype trailer · 4K", meta: <><Icon name="laptop" size={11} />Rendering… 21 % · 7 min left</>, st: "busy", word: "", pct: 21, acts: <span /> }} />
                </ExportsPanel>
                <p className="ex-cap"><strong>Keep this window open.</strong> Free, works offline; the Mac may feel busy until it's done.</p>
              </Col>
              <Col label="Folded into the Share cluster" w={400}>
                <ExCluster ring={64} style={{ position: "relative", right: "auto", top: "auto", alignSelf: "flex-start" }} />
                <p className="ex-cap"><strong>One icon, a ring.</strong> The ring is the progress; it clears when everything is Ready.</p>
              </Col>
              <Col label="Done · partly done · ready with a problem" w={420}>
                <Toast icon="done" action="Show in Finder" at="free" style={{ position: "relative", left: "auto", translate: "none", whiteSpace: "normal", maxWidth: 420 }}>Exported 21 artboards to Downloads › Combine-kampan.</Toast>
                <Toast icon="clock" action="Retry Recap" at="free" style={{ position: "relative", left: "auto", translate: "none", whiteSpace: "normal", maxWidth: 420 }}>Exported 114 of 115. Recap is waiting for its music from Jonas's Mac.</Toast>
                <Toast icon="done" action="Show in Finder" at="free" style={{ position: "relative", left: "auto", translate: "none", whiteSpace: "normal", maxWidth: 420 }}>Exported “Nábor trailer” — without sound.</Toast>
                <p className="ex-cap"><strong>Retry Recap</strong> waits for the music to sync from Jonas's Mac, then renders by itself. The other 114 are already in Downloads › social.</p>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ex-history" label="12 · Exports panel — again, open folder, retry the one that failed" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="The last 20 exports, ready to do again.">The social export says 114 of 115 and retries only Recap. Every row opens its folder or exports again with the same settings.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Uniformy /></Canvas>
              <Chrome canvas="Uniformy-2027" cluster={<ExCluster open />} />
              <ExportsPanel width={400} style={{ position: "absolute", right: 16, top: 68 }} foot="The last 20 exports stay here. Also in Search: “Exports”.">
                <p className="island-title ex-panel-t">Today</p>
                <JobRow j={{ name: "social · 114 of 115", meta: "Recap — waiting for Jonas's Mac", st: "queued", word: "", art: "gator-social", acts: <span className="btn btn--sm ex-retry">Retry Recap</span> }} />
                <JobRow j={{ name: "Nábor trailer · 16:9", meta: "MP4 · 1080p · 20 min ago", st: "warn", word: "Ready · no sound", art: "video" }} />
                <JobRow hover j={{ name: "Hype trailer · 2 videos", meta: "MP4 · 4K · cloud · 1 h ago", st: "done", word: "Ready", art: "gator-reel", acts: <span className="ex-job-acts"><span className="icon-btn k-icon-sm" title="Show in Finder" aria-label="Show in Finder"><Icon name="folder" size={14} /></span><span className="icon-btn k-icon-sm" title="Export again" aria-label="Export again"><Icon name="sync" size={14} /></span><span className="icon-btn k-icon-sm ex-on" title="More" aria-label="More"><Icon name="more" size={14} /></span></span> }} />
                <p className="island-title ex-panel-t">Yesterday</p>
                <JobRow j={{ name: "LetakA6 — FLAG.pdf", meta: "Print PDF · 2 pages", st: "done", word: "Ready", art: "gator-print" }} />
                <JobRow j={{ name: "Combine-kampan · 21 artboards", meta: "PNG · Print PDF", st: "done", word: "Ready", art: "gator-poster" }} />
                <JobRow j={{ name: "Uniformy-2027", meta: "PowerPoint · 12 slides", st: "done", word: "Ready", art: "gator-jersey" }} />
              </ExportsPanel>
              <Menu style={{ right: 424, top: 250 }} width={260} items={[
                { label: "Show in Finder", icon: "folder" },
                { label: "Export again", icon: "sync", highlight: true },
                { label: "Export again with other settings…", icon: "export" },
                "sep",
                { label: "Copy file names" },
                { label: "Remove from list" },
              ]} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · A link or a file ─────────────────────────────────────────────────────────────── */}
      <DCSection id="link" title="Send a link, or export a file" subtitle="People who'll look and comment get a link that stays current; a print shop, Instagram or a client without an account gets a file">
        <DCArtboard id="ex-share-vs" label="13 · Share link vs Export" width={W} height={720} fixed>
          <Closeup
            title="A link stays up to date. A file is a moment, frozen."
            sub="Combine-kampan in Alligators brand (cloud) · Portfolio 2026 (a local project) — same question, two answers."
            note={<Note n={13} title="Export points at Share when a link would do.">When the people are already in the project, the sheet offers a link instead — once, one action. The Share sheet is 10's, unchanged: Invite first, Copy link in the link row.</Note>}
          >
            <div className="ex-cols">
              <Col label="Export sheet — a hint, once">
                <ExSheet rel width={440} adv={null}
                  title="Export 3 artboards"
                  sub="Combine-kampan · for Tereza and Jonas"
                  scope={{ on: "sel", compact: "Selection · 3 artboards" }}
                  summary="3 files · about 9 MB"
                  extra={<Hint icon="link" action="Copy link">Tereza and Jonas are in this project. A link shows them the latest, with comments.</Hint>}
                >
                  <Row k="Format"><Seg options={["PNG", "JPG"]} value="PNG" /></Row>
                  <Row k="Size"><Seg options={["1×", "2×"]} value="2×" /></Row>
                </ExSheet>
              </Col>
              <Col label="Share sheet — as in 10 Share and Collaboration">
                <div className="ex-sh" style={{ width: 400 }}>
                  <p className="ex-sh-t">Share “Combine-kampan”</p>
                  <span className="seg ex-sh-scope"><span className="k-seg-b" aria-pressed="true">This canvas</span><span className="k-seg-b" aria-pressed="false">Whole project</span></span>
                  <div className="ex-sh-inv"><span className="input ex-sh-in"><span className="ex-sh-ph">Name or email</span></span><InSelect value="Can edit" /><span className="btn btn--primary">Invite</span></div>
                  <div className="ex-sh-ppl">
                    {([["you", "Owner", true], ["tereza", "Can edit", false], ["jonas", "Can comment", false]] as [Who, string, boolean][]).map(([w, r, o]) => (
                      <span className="ex-sh-pp" key={String(w)}><Avatar who={w} /><span className="ex-sh-n">{w === "you" ? "You" : String(w)[0].toUpperCase() + String(w).slice(1)}</span><span className={`ex-sh-role${o ? " ex-sh-role--quiet" : ""}`}>{r}{o ? null : <Icon name="chevron" size={12} />}</span></span>
                    ))}
                  </div>
                  <div className="ex-sh-link">
                    <span className="ex-sh-link-ic"><Icon name="link" size={14} /></span>
                    <span className="ex-sh-link-t">Anyone in Alligators with the link<span>Can view</span></span>
                    <span className="btn btn--sm">Copy link</span>
                  </div>
                  <div className="k-adv"><span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">Hub, link rules, GitHub invite</span></span></div>
                </div>
              </Col>
              <Col label="Which one?" w={330}>
                <div className="ex-which">
                  <p><span className="ex-which-h"><Icon name="link" size={14} />Link</span>Tereza, Jonas, the coach — anyone who'll look, comment, or come back tomorrow. Always the latest version.</p>
                  <p><span className="ex-which-h"><Icon name="export" size={14} />File</span>The print shop, Instagram, a sponsor without an account, an archive. Exactly what it looked like at 14:05.</p>
                </div>
                <div className="island island--pad ex-local">
                  <p className="ex-local-t"><span className="ex-local-av">P</span>Portfolio 2026 is a local project</p>
                  <p className="ex-local-d">A link needs the cloud. Move the project to cloud.maude.sh, or export a file — nothing leaves this Mac.</p>
                  <span className="ex-local-a"><span className="btn btn--sm btn--primary">Move to cloud…</span></span>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Handoff to production ──────────────────────────────────────────────────────────── */}
      <DCSection id="handoff" title="Handoff to production — for a developer" subtitle="Menu › File › Handoff to production ⇧⌘H · needs Can edit · a command that runs on any developer's machine · AI not connected, offline, a review with blockers">
        <DCArtboard id="ex-handoff" label="14 · ⇧⌘H — pick where the code goes" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Code goes where the developer works.">The targets come from the project's settings. AI writes the code from Pricing and its design system; the last review found no blockers, so nothing holds it back.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Pricing /></Canvas>
              <Chrome project="Studio site" canvas="Pricing" people={["tereza"]} zoom={28} />
              <Veil />
              <div className="k-dialog ex-sheet" style={{ width: 600 }}>
                <div className="ex-sheet-hd"><p className="k-dialog-t">Hand off “Pricing” to production</p><p className="ex-sheet-sub">Desktop, Tablet, Mobile · Studio design system</p></div>
                <div className="ex-targets">
                  <Option on icon={<Icon name="web" size={16} />} title="Studio web" sub="Web components for the Next.js site — a shadcn registry item on studio.cloud.maude.sh" badge={<span className="chip ex-chip">Last used</span>} />
                  <Option icon={<Icon name="digital" size={16} />} title="Studio app" sub="A React Native component for the iPhone app" />
                  <Option icon={<Icon name="play" size={16} />} title="Lottie animation" sub="For motion — needs an animated frame; Pricing has none" off />
                </div>
                <Check on sub="colours, type and spacing come from Studio's tokens">Use the design system</Check>
                <Hint tone="info" icon="done">Last review: no blockers. AI takes about a minute — keep working.</Hint>
                <div className="ex-sheet-a">
                  <span className="k-adv-btn ex-adv"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="ex-adv-hint">Targets, the command, the registry file</span></span>
                  <span className="ex-btns"><span className="btn">Cancel</span><Go>Hand off</Go></span>
                </div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-handoff-ready" label="15 · Ready — one thing to copy; Advanced shows the rest" width={W} height={800} fixed>
          <Closeup
            title="Ready means one thing to copy — and it works on the developer's machine"
            sub="Three targets, three results. The web command fetches Pricing from Studio site's cloud address; file paths and mono live only under Advanced."
            note={<Note n={15} title="What a developer needs, and nothing a designer has to read.">The web result is one command that runs anywhere for people in Studio site; the app and the animation give code. Advanced keeps the file on this Mac, the Claude Code command and the terminal verb — today's /design:handoff, /design:to-rn and /design:to-lottie, unchanged.</Note>}
          >
            <div className="ex-cols">
              <Col label="Studio web · shadcn registry" w={580}>
                <div className="island island--pad ex-ready">
                  <p className="ex-ready-t"><Icon name="done" size={16} />Pricing is ready for developers</p>
                  <p className="ex-ready-d">One command adds it to the site, on any machine. Tereza and Jonas can run it as is; a developer outside Studio site needs Can view first.</p>
                  <span className="ex-ready-a"><span className="btn btn--sm btn--primary">Copy command</span></span>
                  <div className="k-adv ex-ready-adv" data-open="true">
                    <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">registry · commands</span></span>
                    <Cmd note="Any machine">bunx shadcn add https://studio.cloud.maude.sh/r/pricing.json</Cmd>
                    <pre className="k-mono ex-json">{`{
  "name": "pricing",
  "type": "registry:block",
  "dependencies": ["lucide-react"],
  "registryDependencies": ["button", "card", "switch"],
  "files": [{ "path": "blocks/pricing/page.tsx", … }],
  "cssVars": { "light": { "accent": "…" } }
}`}</pre>
                    <Cmd note="This Mac only">bunx shadcn add file://~/Maude/Studio site/.design/ui/Pricing.registry.json</Cmd>
                    <Cmd note="Claude Code">/design:handoff ui/Pricing.tsx</Cmd>
                    <Cmd note="Terminal">maude design handoff ui/Pricing.tsx .design</Cmd>
                  </div>
                </div>
              </Col>
              <Col label="Studio app · React Native" w={320}>
                <div className="island island--pad ex-ready">
                  <p className="ex-ready-t"><Icon name="done" size={16} />Pricing is ready as an app component</p>
                  <p className="ex-ready-d">One component, styled from Studio's tokens.</p>
                  <span className="ex-ready-a"><span className="btn btn--sm btn--primary">Copy code</span></span>
                  <div className="k-adv ex-ready-adv" data-open="true">
                    <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">file · command</span></span>
                    <span className="ex-kv"><span>Writes</span><span className="k-mono">src/components/Pricing.tsx</span></span>
                    <Cmd note="Claude Code">/design:to-rn "ui/Pricing.tsx" --out src/components/Pricing.tsx</Cmd>
                  </div>
                </div>
              </Col>
              <Col label="Lottie · Onboarding welcome loop" w={330}>
                <div className="island island--pad ex-ready">
                  <p className="ex-ready-t"><Icon name="done" size={16} />Welcome loop is ready as an animation</p>
                  <p className="ex-ready-d">Plays the same on the web and in the app, 3 s on a loop.</p>
                  <span className="ex-ready-a"><span className="btn btn--sm btn--primary">Copy code</span></span>
                  <div className="k-adv ex-ready-adv" data-open="true">
                    <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">file · snippet · command</span></span>
                    <span className="ex-kv"><span>Writes</span><span className="k-mono">.design/assets/welcome-loop.json</span></span>
                    <pre className="k-mono ex-json">{`<LottieView
  source={require("./welcome-loop.json")}
  autoPlay loop />`}</pre>
                    <Cmd note="Claude Code">/design:to-lottie "ui/Onboarding.tsx" --verify</Cmd>
                  </div>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ex-handoff-edges" label="16 · Handoff without AI, offline, or with review blockers" width={W} height={640} fixed>
          <Closeup
            title="Handoff when something's in the way — it waits, it never loses the request"
            sub="Handoff needs AI and Can edit (it writes code into the project). Studio site · Pricing."
            note={<Note n={16} title="Say what's in the way, keep the one verb.">Not connected: one sheet, then the waiting handoff runs. Offline: it queues and starts by itself. Blockers inform — they travel with the code as notes for the developer.</Note>}
          >
            <div className="ex-cols">
              <Col label="AI isn't connected yet — first use" w={400}>
                <div className="k-dialog ex-rel ex-sheet" style={{ width: 400 }}>
                  <p className="k-dialog-t">Connect your Claude account to let AI draft this.</p>
                  <p className="ex-sheet-sub">Handoff to production has AI write the code. Cloud doesn't include AI — use your own Claude subscription or API key.</p>
                  <div className="ex-sheet-a"><span /><span className="ex-btns"><span className="btn">Cancel</span><Go>Connect</Go></span></div>
                </div>
                <p className="ex-cap"><strong>After connecting,</strong> the handoff you asked for runs — no need to start again.</p>
              </Col>
              <Col label="Offline" w={340}>
                <ExportsPanel width={340}>
                  <JobRow j={{ name: "Hand off “Pricing” · Studio web", meta: <><Icon name="offline" size={11} />Queued — starts when this Mac is online</>, st: "queued", word: "", art: "price", acts: <span /> }} />
                </ExportsPanel>
                <p className="ex-cap"><strong>Queued,</strong> like an AI prompt sent offline. It lands in Exports when it's done.</p>
              </Col>
              <Col label="The last review found blockers" w={440}>
                <div className="k-dialog ex-rel ex-sheet" style={{ width: 440 }}>
                  <p className="k-dialog-t">Hand off “Pricing” to production</p>
                  <Hint tone="warn" action="Show on canvas">The last review found 2 blockers: Tablet price text is 3.9 : 1 (needs 4.5 : 1); Mobile's Start button is 38 px tall.</Hint>
                  <p className="ex-sheet-sub">Both go to the developer as notes with the code. Fix them first, or hand off now.</p>
                  <div className="ex-sheet-a"><span /><span className="ex-btns"><span className="btn">Cancel</span><Go>Hand off</Go></span></div>
                </div>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Edge cases ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="Edge cases" subtitle="Offline · the whole project, on purpose · a QR code past the safe margin and a font that won't embed · a viewer exporting · AI still changing the artboard">
        <DCArtboard id="ex-offline" label="17 · Offline — this Mac renders, the cloud waits" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Offline, nothing is blocked.">Images and PDFs export as always. Video keeps every row it has online; it renders on this Mac now, or waits for the cloud and starts by itself once this Mac is online.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Hype /></Canvas>
              <Chrome canvas="video-hype" status="offline" />
              <Veil />
              <VideoSheet offline />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-huge" label="18 · Whole project, chosen in Scope — 93 canvases" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="A big export says it's big, then gets out of the way.">Whole project is picked on purpose, in Scope: 524 artboards by kind. This Mac's part takes about 6 min; after that the window can close and the cloud finishes the videos.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas dim><Kampan /></Canvas>
              <Chrome canvas="Combine-kampan" zoom={12} />
              <Veil />
              <ExSheet
                title="Export everything in Alligators brand"
                sub="93 canvases in 5 folders, plus 4 at the top level"
                scope={{ on: "project", n: [null, 21, 38, 524] }}
                width={720}
                summary="524 files · about 5.9 GB · images and PDFs about 6 min on this Mac · videos about 12 min in the cloud"
                primary="Export 524 artboards"
                adv="Per-folder choices, file names, colour"
                extra={<Hint icon="folder" action="Project ZIP instead">Moving or backing up the project? A ZIP of canvases, assets and the design system is about 2.1 GB.</Hint>}
              >
                <Group kind="digital" title="Fixed size · 424" sub="social, 2026, legacy… · on this Mac" arts={["gator-social", "gator-numbers", "gator-reel", "moodboard"]} value={<InSelect value="PNG · 1×" />} />
                <Group kind="web" title="Web page · 30" sub="club-web · full pages · on this Mac" arts={["gator-web"]} value={<InSelect value="PNG · 2×" />} />
                <Group kind="print" title="Print · 46 pages" sub="print, 2026/combine · on this Mac" arts={["gator-print", "gator-poster"]} value={<InSelect value="Print PDF" />} note="Bleed + crop marks" />
                <Group kind="video" title="Video · 24" sub="12 canvases in social, 2026 · in the cloud" arts={["gator-reel", "video"]} value={<InSelect value="MP4 · 1080p" />} note="In the cloud" />
                <Row k="Include"><span className="ex-checks ex-checks--row"><Check>All 5 folders</Check><Check>test, Test2, ahoj, ahoj2</Check></span></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-print-warn" label="19 · Past the safe margin; a font that won't embed" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Warnings inform; Export still exports.">The QR code sits 2 mm inside the cut — across the 5 mm safe margin — ringed on the paper. The headline's .otf won't embed, so it prints as shapes. Neither stops the export.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Letak sel="A · přední (TACKLE)" /></Canvas>
              <Chrome canvas="LetakA6" zoom={40} />
              <Veil />
              <ExSheet
                title="Export “A · přední (TACKLE)”"
                sub="LetakA6 · print"
                scope={{ on: "sel", n: [1, 4, 14, 524] }}
                width={780}
                prevW={300}
                preview={<><span className="ex-pic ex-pic--paper"><Paper variant="tackle" qrOut margin flag /></span><span className="ex-prev-cap">Page 1 of 1 · A6 · 105 × 148 mm</span><Legend margin /></>}
                summary="1 PDF · 1 page · about 2 MB · a few seconds"
              >
                <Row k="Format"><Seg options={["Print PDF", "PDF", "PNG"]} value="Print PDF" /><span className="btn btn--ghost btn--sm">Other…</span></Row>
                <Row k="Print"><span className="ex-checks ex-checks--row"><Check>Bleed</Check><Check>Crop marks</Check><Check on={false}>Add the back</Check></span></Row>
                <Hint tone="warn" action="Show on canvas">The QR code is 2 mm from the cut — past the 5 mm safe margin. The trim may clip it.</Hint>
                <Hint tone="warn" icon="type">Avenir Next Condensed Heavy can't be embedded — the headline prints as shapes (same look). The alligators .ttf embeds.</Hint>
                <Row k="Colour"><span className="ex-val">RGB — the print shop converts to CMYK.</span></Row>
                <Row k="File name"><Field>LetakA6 — TACKLE.pdf</Field></Row>
              </ExSheet>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ex-edges" label="20 · A viewer exports; AI is still changing it" width={W} height={680} fixed>
          <Closeup
            title="Two quiet cases: someone who can only view, and an artboard AI hasn't finished"
            sub="Decided: viewing includes exporting — an export is a copy and changes nothing (today's app allows it too)."
            note={<Note n={20} title="Say what's true, keep the one verb.">A viewer sees the same sheet with one line on top. While AI is mid-change, the sheet asks which version — the one from 14:05 or the one AI is finishing — and Export still means export.</Note>}
          >
            <div className="ex-cols">
              <Col label="You can view Alligators brand">
                <ExSheet rel width={460} adv={null}
                  title="Export “score-mvp — MVP zápasu”"
                  scope={{ on: "sel", compact: "Selection · 1 artboard" }}
                  summary="1 file · about 1.1 MB"
                  lead={<Hint icon="view">You can view this project. Exporting is fine — it makes a copy and changes nothing.</Hint>}
                >
                  <Row k="Format"><Seg options={["PNG", "JPG"]} value="PNG" /></Row>
                  <Row k="Size"><Seg options={[["1×", "1080 × 1350"], ["2×", "2160 × 2700"]]} value="1×" /></Row>
                </ExSheet>
                <p className="ex-cap"><strong>Also open to viewers:</strong> Copy link. Handoff to production writes code into the project, so it needs Can edit.</p>
              </Col>
              <Col label="AI is changing the artboard">
                <ExSheet rel width={560} adv={null}
                  title="Export “Pozvánka · story”"
                  scope={{ on: "sel", compact: "Selection · 1 artboard" }}
                  summary="1 file · the version from 6 Oct, 14:05"
                  lead={<Hint tone="ai" icon="spark">AI is changing this artboard right now — “Make the date bigger”.</Hint>}
                >
                  <Row k="Version" top>
                    <span className="ex-opts">
                      <Option on icon={<Icon name="clock" size={16} />} title="From 14:05" sub="The last finished version. Exports now." />
                      <Option icon={<Spark size={14} />} title="Wait for AI" sub="Exports by itself when AI is done." />
                    </span>
                  </Row>
                  <Row k="Format"><Seg options={["PNG", "JPG"]} value="PNG" /></Row>
                </ExSheet>
              </Col>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Advanced ─────────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced, inside the sheet" subtitle="Exact scale or dpi, colour profile, print and video settings, where it renders, file-name tokens, and the same export as a command">
        <DCArtboard id="ex-advanced" label="21 · Export › Advanced, per kind" width={W} height={920} fixed>
          <Closeup
            title="Advanced opens under the sheet — only the part for what's selected"
            sub="Shown here side by side for an image, a print PDF and a video. Mono appears only in this fold."
            note={<Note n={21} title="Every knob today's dialog has, plus the ones it hid.">dpi, PDF text handling, registration marks, frame rate and codec move here; colour profile, JPG quality, bitrate and file-name tokens are new. The commands at the foot repeat the exact export for a terminal or a script.</Note>}
          >
            <div className="ex-cols">
              <Col label="Image — PNG · JPG · SVG" w={330}>
                <div className="island island--pad ex-advp">
                  <Row k="Size by"><Seg options={["Scale", "dpi"]} value="Scale" /></Row>
                  <Row k="Exact scale"><Field>2.5×</Field></Row>
                  <p className="ex-advp-n">Pick dpi for a print size (150 · 300 · 600); the one you pick here wins over the sheet's 1× / 2×.</p>
                  <Row k="Colour profile"><Seg options={["sRGB", "Display P3"]} value="sRGB" /></Row>
                  <p className="ex-advp-n">sRGB for Instagram and browsers; Display P3 keeps the brighter greens on Apple screens.</p>
                  <Row k="JPG quality"><Field>85 %</Field></Row>
                  <Row k="Background"><InSelect value="As on the artboard" /></Row>
                </div>
              </Col>
              <Col label="Print PDF" w={330}>
                <div className="island island--pad ex-advp">
                  <Row k="Images inside"><InSelect value="300 dpi" /></Row>
                  <Row k="Text"><InSelect value="Keep as text" /></Row>
                  <p className="ex-advp-n">Or: check the fonts are embedded · turn text into shapes (print-safe).</p>
                  <Row k="Bleed"><Field>3 mm</Field></Row>
                  <Row k="Crop marks"><InSwitch on /></Row>
                  <Row k="Registration marks"><InSwitch on={false} /></Row>
                  <Row k="Paper"><InSelect value="Same as artboard" /></Row>
                  <p className="ex-advp-n">RGB — the print shop converts to CMYK. If they ask for a profile, use theirs (e.g. FOGRA39 or FOGRA51).</p>
                </div>
              </Col>
              <Col label="Video — MP4 · GIF · WebM" w={330}>
                <div className="island island--pad ex-advp">
                  <Row k="Frame rate"><InSelect value="30 fps — as made" /></Row>
                  <Row k="Codec"><InSelect value="H.264 (MP4)" /></Row>
                  <Row k="Bitrate"><InSelect value="High" /></Row>
                  <Row k="GIF colours"><Field>256</Field></Row>
                  <Row k="Long videos"><span className="ex-val">Up to 3 600 frames</span></Row>
                  <p className="ex-advp-n">Size is the sheet's Quality (1080p · 4K). WebM uses VP9. Frames past the limit need a higher cap, set per export.</p>
                </div>
              </Col>
              <Col label="Where it renders" w={280}>
                <div className="island island--pad ex-advp">
                  <Row k="Video"><InSelect value="Suggest each time" /></Row>
                  <p className="ex-advp-n">The sheet suggests the cloud for 4K and long videos; you choose. Or: always the cloud · always this Mac.</p>
                  <p className="ex-advp-n">Images and PDFs always export on this Mac, in seconds.</p>
                  <span className="ex-kv"><span>Render service</span><span className="k-mono">maude-render</span></span>
                  <StatusLine />
                </div>
              </Col>
            </div>
            <div className="ex-adv-foot">
              <div className="island island--pad ex-names">
                <p className="island-title">File names</p>
                <span className="input ex-field ex-field--wide k-mono">{"{canvas} — {artboard}@{scale}"}</span>
                <span className="ex-tokens">{["{project}", "{folder}", "{canvas}", "{artboard}", "{kind}", "{size}", "{scale}", "{date}"].map((t) => <span className="chip k-mono" key={t}>{t}</span>)}</span>
                <span className="ex-files k-mono"><span>Combine-kampan — Slide 01 · 40 YARD DASH@2x.png</span><span>Combine-kampan — Arch 1 · vnějšek@1x.pdf</span><span>video-hype — Hype trailer · Reels 9-16@1x.mp4</span></span>
              </div>
              <div className="island island--pad ex-names">
                <p className="island-title">The same export from a terminal</p>
                <Cmd>maude design export png --scope artboard --option scale=2</Cmd>
                <Cmd>maude design export pdf --scope artboard --option includeBleed=true --option marks=crop</Cmd>
                <Cmd>maude design export mp4 --scope artboard --option fps=30 --out ~/Downloads</Cmd>
                <Cmd note="Claude Code">/design:export png --scope artboard --option scale=2</Cmd>
              </div>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

function StatusLine() {
  return <span className="ex-kv"><span>Status</span><span className="k-sw k-sw--ok"><i />Ready</span></span>;
}
