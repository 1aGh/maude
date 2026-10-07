/**
 * @canvas      07 Video Editing — the timeline that comes with a video artboard, told on Alligators brand
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ve-none | ve-select | ve-deselect |
 *              ve-drop | ve-trim-split | ve-move-transition | ve-transition | ve-text | ve-captions | ve-music |
 *              ve-ai-cut | ve-ai-watch | ve-ai-scrub | ve-ai-proposal | ve-ai-adjust |
 *              ve-formats | ve-reframe |
 *              ve-play | ve-fullscreen |
 *              ve-export | ve-render |
 *              ve-footage | ve-together | ve-long | ve-fit-fill |
 *              ve-advanced
 * @brief       "video editing" — triage decision (Michal): "Timeline only when a video artboard is selected".
 *              Drawn on Alligators brand's real video canvases (social/video-hype, video-nabor, video-recap,
 *              video-touchdown) with its real footage names (caaftv-td-run-7s.mp4, dron-sweep-lajny-8s.mp4 …)
 *              and its real photos (.design/assets) as the footage.
 *
 * Convention (same as 01 / 08): every app artboard is a <Stage> — a 1440 × 900 window with its note strip
 * underneath (artboard 1440 × 980). Close-ups (ve-deselect, ve-ai-cut, ve-render) are sized to content,
 * note at the foot.
 *
 * THE TIMELINE lives in ./_video.tsx (shared with 08 · ak-video — 07 is its source of truth). An island,
 * never a docked bar:
 *   · Compact — slides out of the selected video artboard's bottom edge; a notch points at that artboard.
 *     Four tracks, top to bottom = what covers what: Text · Graphics · Video · Music.
 *   · Full — the Expand button in its header (no key): edge to edge above the toolbar, track names, zoom,
 *     a grip to make it taller, Advanced at its foot (frame numbers, codec, keyframes, EDL, code — mono only there).
 *   · Select anything that isn't a video artboard (or esc) and it slides back into the artboard — compact or full.
 *   · ⇧⌘T shows / hides the timeline: shown that way it stays open whatever you select
 *     (Menu › View › Advanced › Keep timeline open ⇧⌘T — CONTRACT §1).
 *   · Space: hold (+ drag) = Hand, always (CONTRACT §2). A quick tap with a video artboard selected = play / pause.
 *
 * Grounded in today's app (apps/studio/client/panels/TimelinePanel.jsx, /design:reel, apps/render, export-center):
 * transitions = Cut · Fade · Slide · Wipe · Flip · Clock wipe; split = ⌘B today → S here (⌘B kept);
 * export = MP4 / GIF (+ WebM under Advanced), cloud render or this Mac. NEW here (not in today's app):
 * word-by-word captions + editing by transcript, beat markers + "Snap to the beat", lowering music under speech,
 * poster frame, linked formats with per-format framing, audio-only export.
 *
 * Export progress = 09's model: a ring on the Exports icon in the Share cluster, the Exports panel top-right.
 * A partial failure reads "Exported N of M — …" with one Retry (CONTRACT §7). "Formats" names the linked
 * Reels / 16:9 / 1:1 versions everywhere (07 · 09).
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./_video.css";
import "./07 Video Editing.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { ReactNode } from "react";
import {
  Artboard, Avatar, Canvas, Cursor, Dialog, GatorMock, Icon, InButton, InFill, InNum, InSeg, InSelect, InSwitch,
  Inspector, Kbd, Menu, ModeSwitch, Note, PanelIcon, ProjectPill, Selection, ShareCluster, Spark, Stage, TABS, Toast, Toolbar,
  V2, Veil, Window, ZoomUndo,
} from "./_kit";
import {
  ClipPic, FULL, HYPE, HYPE_CLIPS, HYPE_GFX, HYPE_MUSIC, HYPE_TEXT, PHOTO, SOURCE_CLIPS, Slider, Still, Timeline, VIcon,
  VideoInspector, wave,
} from "./_video";
import type { Clip, Music, Pic, TItem } from "./_video";

const W = 1440;
const H = 980;
const GTABS = [TABS.studio, TABS.alligators];

/* artboard centres on the canvases below (window-body px) — the compact timeline slides out under them */
const CX_HYPE_REELS = 539;
const CX_HYPE_WIDE = 911;
const CX_RECAP = 449;
const CX_FORMATS = 229;

/* ═══ Real projects ══════════════════════════════════════════════════════════════════════════════════════ */

/* social/video-nabor — "Nábor trailer", 16:9, 0:30, with Kilián's interview (speech → captions) */
const NABOR_CLIPS: Clip[] = [
  { n: "Kabina", s: 0, d: 2.5, pic: "crowd" },
  { n: "Rozhovor · Kilián", s: 2.5, d: 8.5, pic: "night" },
  { n: "Trénink v hale", s: 11, d: 4, pic: "qb" },
  { n: "Huddle", s: 15, d: 4, pic: "crowd" },
  { n: "Touchdown", s: 19, d: 5, pic: "field" },
  { n: "Výběh s vlajkou", s: 24, d: 4, pic: "sky" },
  { n: "Logo", s: 28, d: 2, pic: "logo" },
];
const WORDS: [string, number, number][] = [
  ["Přišel", 3.0, 0.4], ["jsem", 3.4, 0.3], ["bez", 3.7, 0.3], ["zkušenosti.", 4.0, 0.9], ["Ehm…", 4.95, 0.4],
  ["Za", 5.4, 0.25], ["měsíc", 5.65, 0.4], ["jsem", 6.05, 0.3], ["hrál", 6.35, 0.35], ["první", 6.7, 0.4], ["zápas.", 7.1, 0.6],
  ["Dneska", 8.4, 0.5], ["bych", 8.9, 0.3], ["to", 9.2, 0.25], ["nevyměnil.", 9.45, 0.95],
];
const words = (opts: { hl?: string; edit?: [string, ReactNode]; peer?: string; cut?: string } = {}): TItem[] =>
  WORDS.map(([w, s, d], i) => ({
    key: "w" + i, n: opts.edit && opts.edit[0] === w ? opts.edit[1] : w, s, d, kind: "word", lane: 1,
    hl: opts.hl === w, edit: !!(opts.edit && opts.edit[0] === w), peer: opts.peer === w, cut: opts.cut === w,
  }));
const NABOR_TITLES: TItem[] = [
  { n: "PROČ ALLIGATORS", s: 0.3, d: 2.2, lane: 0 },
  { n: "NAUČÍME TĚ HRÁT", s: 11, d: 4, lane: 0 },
  { n: "STAŇ SE ALLIGATOREM", s: 24, d: 6, lane: 0 },
];
const NABOR_GFX: TItem[] = [{ n: "Kilián · obránce, 2. sezóna", s: 3, d: 4 }, { n: "alligators.cz/nabor", s: 24.5, d: 5.5 }];
const NABOR_MUSIC: Music = { n: "Hype instrumental · 120 BPM", s: 0, d: 30, bpm: 120, duck: [[2.6, 10.6]], duckLabel: "Lower under speech" };

/* social/video-recap — 14 shots cut by AI from 9 of 12 clips, 0:30. `src` = index into SOURCE_CLIPS. */
const RECAP: (Clip & { src?: number })[] = [
  { n: "Tunel", s: 0, d: 1.5, pic: "night", src: 10 }, { n: "Výběh s vlajkou", s: 1.5, d: 2, pic: "sky", src: 0 },
  { n: "Dron nad lajnou", s: 3.5, d: 2, pic: "sky", src: 8 }, { n: "Tackle", s: 5.5, d: 1.5, pic: "crowd", src: 1 },
  { n: "Touchdown", s: 7, d: 2.5, pic: "field", src: 2 }, { n: "Huddle", s: 9.5, d: 2, pic: "crowd", src: 4 },
  { n: "Tackle 2", s: 11.5, d: 1.5, pic: "crowd", src: 1 }, { n: "Mix zóna", s: 13, d: 2.5, pic: "night", src: 5 },
  { n: "Touchdown 2", s: 15.5, d: 2.5, pic: "field", src: 2 }, { n: "Oslava", s: 18, d: 2.5, pic: "qb", src: 3 },
  { n: "Archiv 2008", s: 20.5, d: 2, pic: "field", src: 7 }, { n: "Dron nad lajnou 2", s: 22.5, d: 3, pic: "sky", src: 8 },
  { n: "Oslava 2", s: 25.5, d: 2.5, pic: "qb", src: 3 }, { n: "Logo", s: 28, d: 2, pic: "logo" },
];
const RECAP_SHOTS: Clip[] = RECAP.map(({ src: _src, ...c }) => c);
const RECAP_TEXT: TItem[] = [
  { n: "SEZÓNA 2026", s: 0.3, d: 3.2 }, { n: "DŘINA", s: 5.5, d: 1.5 }, { n: "RYCHLOST", s: 7, d: 2.5 }, { n: "SRDCE", s: 18, d: 2.5 }, { n: "STAŇ SE ALLIGATOREM", s: 28, d: 2 },
];
const RECAP_GFX: TItem[] = [{ n: "Logo v rohu", s: 0, d: 28 }];
const RECAP_MUSIC: Music = { n: "Hype instrumental · 120 BPM", s: 0, d: 30, bpm: 120 };
const LEFT_OUT = "archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky";

/* video-zapas-lions — a whole match, 40 clips, 4:12 */
const LONG_CLIPS: Clip[] = (() => {
  const lens = [5, 7, 4, 8, 6, 9, 5, 6];
  const pics: Pic[] = ["field", "crowd", "sky", "field", "qb", "night", "field", "crowd"];
  const k = 252 / 250;
  let s = 0;
  return Array.from({ length: 40 }, (_, i) => {
    const d = lens[i % 8] * k;
    const c: Clip = { n: `Akce ${i + 1}`, s, d, pic: pics[i % 8], lab: false, sel: i === 21 };
    s += d;
    return c;
  });
})();

/* ═══ Canvases ═══════════════════════════════════════════════════════════════════════════════════════════ */

/* the Hype canvas at 22 % — feed post 4:5 238 × 297, Reels 238 × 422, 16:9 422 × 238 */
function HypeCanvas({ sel, reels, post, wide, drop }: { sel?: "reels" | "post" | "wide"; reels?: ReactNode; post?: ReactNode; wide?: ReactNode; drop?: boolean }) {
  return (
    <Canvas>
      <Artboard label="Náhled do feedu · 4:5" kind="digital" x={130} y={110} w={238} h={297} selected={sel === "post"} size="1080 × 1350">
        {post ?? <GatorMock variant="social" headline="NOVÝ TRAILER" sub="Nábor 2027 · odkaz v biu" />}
      </Artboard>
      <Artboard label="Hype trailer · Reels · 0:15" kind="video" x={420} y={110} w={238} h={422} selected={sel === "reels"} size="1080 × 1920">
        {reels ?? <Still pic="field" title="RYCHLOST" titleAt="bottom" play />}
        {drop ? <span className="ve-dropzone"><span className="ve-dropzone-chip"><VIcon name="plus" size={12} />Or drop here — adds at the end</span></span> : null}
      </Artboard>
      <Artboard label="Hype trailer · 16:9 · 0:30" kind="video" x={700} y={110} w={422} h={238} selected={sel === "wide"} size="1920 × 1080">
        {wide ?? <Still pic="field" pos={40} title="STAŇ SE ALLIGATOREM" titleAt="bottom" play />}
      </Artboard>
    </Canvas>
  );
}

/* video-recap at 22 % — Reels 238 × 422, 16:9 422 × 238, 1:1 140 × 140, and the unlinked 0:15 copy (ve-formats) */
function RecapCanvas({ sel = false }: { sel?: boolean }) {
  return (
    <Canvas>
      <Artboard label="Recap · Reels · 0:30" kind="video" x={300} y={96} w={238} h={422} selected={sel} size="1080 × 1920"><Still pic="field" title="RYCHLOST" titleAt="bottom" play /></Artboard>
      <Artboard label="Recap · 16:9 · 0:30" kind="video" x={580} y={96} w={422} h={238}><Still pic="field" title="RYCHLOST" titleAt="bottom" play /></Artboard>
      <Artboard label="Recap · 1:1 · 0:30" kind="video" x={580} y={378} w={140} h={140}><Still pic="field" title="RYCHLOST" titleAt="bottom" /></Artboard>
      <Artboard label="Recap · 16:9 · copy · 0:15" kind="video" x={760} y={378} w={242} h={136}><Still pic="sky" title="SEZÓNA 2026" titleAt="bottom" /></Artboard>
    </Canvas>
  );
}

/* the Nábor canvas at 34 % — 16:9 653 × 367 */
function NaborCanvas({ children, still, label = "Nábor trailer · 16:9 · 0:30", sel = true, ai, made, x = 330 }: { children?: ReactNode; still?: ReactNode; label?: string; sel?: boolean; ai?: string; made?: boolean; x?: number }) {
  return (
    <Canvas>
      <Artboard label={label} kind="video" x={x} y={96} w={653} h={367} selected={sel} size="1920 × 1080" aiWorking={ai} aiMade={made}>
        {still ?? <Still pic="night" cap={<><b>Za</b> měsíc jsem hrál</>} />}
        {children}
      </Artboard>
    </Canvas>
  );
}

/* ═══ Chrome (Alligators brand) ════════════════════════════════════════════════════════════════════════ */
function Chrome({ canvas, insp, ai = "icon", tl, toast, people = ["tereza", "jonas"], status = "saved", zoom = 22, tool = "select", left = "folded", children }: {
  canvas: string; insp?: ReactNode; ai?: "icon" | "dot" | ReactNode; tl?: ReactNode; toast?: ReactNode; people?: string[];
  status?: "saved" | "syncing" | "offline"; zoom?: number | string; tool?: string; left?: ReactNode | "folded"; children?: ReactNode;
}) {
  return (
    <>
      <ProjectPill project="Alligators brand" canvas={canvas} />
      {left === "folded" ? <PanelIcon icon="panel-left" at="left" /> : left}
      <ShareCluster mode="edit" people={people as ("tereza" | "jonas")[]} status={status} />
      {insp}
      {tl}
      <ZoomUndo zoom={zoom} />
      <Toolbar tool={tool} />
      {ai === "icon" ? <PanelIcon icon="spark" at="ai" /> : ai === "dot" ? <PanelIcon icon="spark" at="ai" dot /> : ai}
      {children}
      {toast}
    </>
  );
}

/* inspector for a clip (selected inside the video) */
function ClipInspector({ name, length, framing = "All formats", extra, adv }: { name: string; length: string; framing?: string; extra?: [string, ReactNode][]; adv?: [string, string][] }) {
  return (
    <Inspector title={name} kind="Clip" rows={[
      ["Length", <InNum value={length} icon="clock" />],
      ["Speed", <InSelect value="1×" />],
      ["Volume", <Slider pct={70} label="70 %" />],
      ["Framing", <InSelect value={framing} />],
      ...(extra ?? []),
    ]} advanced={adv ?? [["in", "0:01.2"], ["out", "0:03.6"]]} />
  );
}

/* The AI chat panel, video flavour (03's geometry: one fixed height across a story, bottom-right). */
function VeAI({ title, scope, prompt, chips = [], children }: { title: string; scope: string; prompt?: string; chips?: string[]; children: ReactNode }) {
  return (
    <div className="island island--pad k-ai ve-ai">
      <div className="k-ai-hd">
        <Spark size={14} />
        <span className="k-ai-name">{title}</span>
        <span className="icon-btn k-icon-sm" title="New chat"><Icon name="plus" size={14} /></span>
        <span className="icon-btn k-icon-sm" title="Hide the AI chat panel"><Icon name="chevron" size={14} /></span>
      </div>
      <div className="ve-ai-body">{children}</div>
      {chips.length ? <div className="k-ai-sugg">{chips.map((c) => <span key={c} className="chip k-sugg">{c}</span>)}</div> : null}
      <div className="ask k-ask">
        <span className="chip chip--accent k-selchip">◆ {scope}</span>
        <span className={`k-ask-in${prompt ? "" : " k-ask-ph"}`}>{prompt ?? "Ask AI…"}</span>
        <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
      </div>
    </div>
  );
}
function Working({ children }: { children: ReactNode }) {
  return <p className="k-ai-working"><span className="motion-soft k-ai-wspark"><Spark size={14} /></span><span className="k-ai-wtxt">{children}</span><span className="btn btn--ghost btn--sm"><Icon name="stop" size={12} />Stop</span></p>;
}
/** The Share cluster with its Exports slot, as 09 draws it: one icon, a ring while anything renders. */
function ExportsCluster({ ring }: { ring?: number }) {
  return (
    <div className="island k-tr ve-excl">
      <span className="k-faces"><Avatar who="tereza" /><Avatar who="jonas" /></span>
      <span className="k-saved"><Icon name="cloud" size={16} />Saved</span>
      <ModeSwitch mode="edit" />
      <span className="icon-btn ve-ringed ve-on" title={ring !== undefined ? `Exports — ${ring} % done` : "Exports"}>
        <Icon name="export" />
        {ring !== undefined ? <svg className="ve-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="ve-ring-v" strokeDasharray={`${(ring * 0.942).toFixed(1)} 100`} /></svg> : null}
      </span>
      <span className="icon-btn" title="Hide panels ⌘\"><Icon name="panel-right" /></span>
      <span className="btn btn--primary"><Icon name="share" size={14} />Share</span>
    </div>
  );
}
function ClipsAttached({ n = 12, dur = "1:20" }: { n?: number; dur?: string }) {
  return (
    <span className="ve-att">
      <span className="ve-att-stack">{SOURCE_CLIPS.slice(0, 3).map(([f, pic], i) => <span key={f}><ClipPic pic={pic} i={i} className="maude-v2 k-fixed" /></span>)}</span>
      <span><b>{n} clips</b> <span className="ve-att-m">· {dur} of footage · from Assets › footage</span></span>
    </span>
  );
}
/** A result in 03's shape: what changed, then Undo first, then the way on. */
function Result({ children, actions = ["Undo", "Keep going"] }: { children: ReactNode; actions?: string[] }) {
  return (
    <div className="ve-ai-card">
      <p className="ve-ai-big">{children}</p>
      <span className="ve-ai-acts">{actions.map((a) => <span key={a} className="btn btn--sm">{a === "Undo" ? <Icon name="undo" size={12} /> : null}{a}</span>)}</span>
    </div>
  );
}

function MotionGrid({ on }: { on: string }) {
  const opts: [string, string][] = [["None", "none"], ["Fade", "fade"], ["Slide up", "up"], ["Pop", "pop"], ["Type on", "type"], ["Per word", "word"]];
  return (
    <span className="ve-motion">
      {opts.map(([l, k]) => <span key={l} className="ve-motion-o" data-on={on === l ? "true" : undefined}><span className={`ve-motion-pic ve-motion-pic--${k}`}><i />{k === "up" || k === "word" ? <i /> : null}</span>{l}</span>)}
    </span>
  );
}

/** A motion cue drawn on the canvas (in window-body px): a dashed accent path with an arrowhead. */
function Motion({ d, label, lx, ly, w = 3 }: { d: string; label?: string; lx?: number; ly?: number; w?: number }) {
  return (
    <>
      <svg className="ve-motion-cue" viewBox="0 0 1440 860" aria-hidden="true">
        <defs><marker id="ve-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L8 5L1 9" /></marker></defs>
        <path d={d} style={{ strokeWidth: w }} markerEnd="url(#ve-arrow)" />
      </svg>
      {label ? <span className="ve-motion-lab" style={{ left: lx, top: ly }}>{label}</span> : null}
    </>
  );
}

/** A miniature of the whole window (for storyboard strips). */
function Mini({ children, k = 0.225 }: { children: ReactNode; k?: number }) {
  return (
    <div className="ve-mini" style={{ width: 1440 * k, height: 900 * k }}>
      <div className="ve-mini-in" style={{ transform: `scale(${k})` }}>{children}</div>
    </div>
  );
}

/* the transition previews — two real shots meeting at the join */
const TRANS: [string, string][] = [["Cut", "cut"], ["Fade", "fade"], ["Slide", "slide"], ["Wipe", "wipe"], ["Flip", "flip"], ["Clock wipe", "clock"]];
function TransPick({ k, on, label }: { k: string; on?: boolean; label: string }) {
  return (
    <span className="ve-pick" data-on={on ? "true" : undefined}>
      <span className={`ve-pick-pic ve-pick-pic--${k} maude-v2 k-fixed`} data-theme="light">
        <i style={{ backgroundImage: `url(${PHOTO.qb.src})` }} />
        <i className="ve-pick-b" />
      </span>
      {label}
    </span>
  );
}

/* the AI-cut hero geometry */
const HX0 = 54;
const HW = 1332;
const HX = (s: number) => HX0 + (s / 30) * HW;
const TILE = (i: number) => HX0 + i * 112;

/* ═══ The canvas ═════════════════════════════════════════════════════════════════════════════════════════ */
export default function VideoEditing() {
  const hypeSel = <Still pic="field" title="RYCHLOST" titleAt="bottom" />;
  return (
    <DesignCanvas>
      {/* ── 1 · Summoning the timeline ───────────────────────────────────────────────────────────── */}
      <DCSection id="summon" title="The timeline comes with a video artboard" subtitle="Nothing selected — no timeline; select a video artboard — it slides out of it; select anything else — it slides back in">
        <DCArtboard id="ve-none" label="1 · Nothing selected — no timeline" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="A video artboard looks like any other until you pick it.">Its length rides on the label and its poster frame is the picture; the play button plays it in place. No timeline is open, and nothing hints that one is missing.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <HypeCanvas />
              <Chrome canvas="video-hype" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-select" label="2 · Select it — the timeline slides out of it" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Select it, and the timeline slides out of its bottom edge.">The notch points at the video it edits. Four tracks, top covers bottom: text, graphics, video, music. Expand, at the right of its header, makes it full width.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <HypeCanvas sel="reels" reels={hypeSel} />
              <Chrome canvas="video-hype" insp={<VideoInspector />} tl={<Timeline {...HYPE} t={4} poster={4} under={CX_HYPE_REELS} />}>
                <Motion d="M539 536 L539 560" w={2.5} />
              </Chrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-deselect" label="3 · Switch, deselect, keep it open — the timeline's rules" width={W} height={700} fixed>
          <V2 className="ve-closeup">
            <p className="ve-closeup-h">Where the timeline goes when the selection changes</p>
            <div className="ve-strip">
              {([
                ["1", "Select Reels", "It slides out of Reels' bottom edge, compact. The notch points at Reels.", "reels"],
                ["2", "Select the 16:9 video", "It slides over to 16:9. Each video keeps its own playhead — Reels stays at 0:04.", "wide"],
                ["3", "Select the feed post, or esc", "It slides back into Reels. Compact or full, the same — nothing else on the canvas moves.", "post"],
                ["4", "Keep it open with ⇧⌘T", "Now it stays whatever you select, showing the last video. ⇧⌘T again hides it.", "pinned"],
              ] as [string, string, string, string][]).map(([n, t, d, st]) => (
                <div key={n} className="ve-strip-step">
                  <Mini>
                    <Window tabs={GTABS} activeTab={1}>
                      <HypeCanvas sel={st === "reels" ? "reels" : st === "wide" ? "wide" : "post"} reels={st === "reels" ? hypeSel : undefined} wide={st === "wide" ? <Still pic="field" pos={40} title="RYCHLOST" titleAt="bottom" /> : undefined} />
                      <Chrome canvas="video-hype"
                        tl={st === "reels" ? <Timeline {...HYPE} t={4} under={CX_HYPE_REELS} />
                          : st === "wide" ? <Timeline name="Hype trailer · 16:9" len={30} t={8} under={CX_HYPE_WIDE} clips={HYPE_CLIPS.map((c) => ({ ...c, s: c.s * 2, d: c.d * 2 }))} text={HYPE_TEXT.map((x) => ({ ...x, s: x.s * 2, d: x.d * 2 }))} gfx={HYPE_GFX.map((x) => ({ ...x, s: x.s * 2, d: x.d * 2 }))} music={{ ...HYPE_MUSIC, d: 30 }} />
                            : st === "pinned" ? <Timeline {...HYPE} t={4} under={CX_HYPE_REELS} status={<span className="ve-tl-status ve-kept"><Icon name="pin" size={12} />Kept open</span>} />
                              : null}>
                        {st === "reels" ? <Motion d="M539 536 L539 566" w={9} /> : null}
                        {st === "wide" ? <Motion d="M560 600 C 700 560, 800 560, 900 590" w={9} /> : null}
                        {st === "post" ? <Motion d="M539 720 L539 560" w={9} /> : null}
                      </Chrome>
                    </Window>
                  </Mini>
                  <p className="ve-strip-t"><span className="ve-strip-n">{n}</span>{t}</p>
                  <p className="ve-strip-d">{d}</p>
                </div>
              ))}
            </div>
            <div className="ve-rules-row">
              <div className="ve-rules">
                <p className="ve-rules-h">The timeline, in five rules</p>
                <span><b>Select a video artboard</b><em>The timeline slides out of it. Another video takes it over.</em></span>
                <span><b>Select anything else · <Kbd>esc</Kbd></b><em>It slides back in — compact or full.</em></span>
                <span><b><Kbd>⇧⌘T</Kbd></b><em>Shows or hides the timeline. Shown this way, it stays open.</em></span>
                <span><b>Expand · Compact</b><em>The button at the right of its header. No key.</em></span>
                <span><b><Kbd>⌘\</Kbd></b><em>Hides it with the other panels, like any panel.</em></span>
              </div>
              <div className="ve-rules-menu">
                <p className="ve-rules-cap">Menu › View › Advanced</p>
                <Menu width={280} highlight="Keep timeline open" items={[
                  { label: "Layers as a panel", checked: false }, { label: "Inspector", keys: "⇧⌘I", checked: false }, { label: "Open inspector on select", checked: true },
                  { label: "Keep timeline open", keys: "⇧⌘T", checked: true }, { label: "Minimap", checked: false },
                ]} />
              </div>
            </div>
            <div className="ve-closeup-note"><Note n={3} title="One key, one meaning.">The timeline follows the selection; ⇧⌘T is the only way to keep it when you look elsewhere. Size is a button, not a key.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Basic edits ──────────────────────────────────────────────────────────────────────── */}
      <DCSection id="edits" title="Basic edits" subtitle="Drop footage, trim, split, move, a transition, a title with motion, captions you edit as text, a music bed that steps aside for speech">
        <DCArtboard id="ve-drop" label="4 · Drop footage — on the artboard or the timeline" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Drag clips in from Finder or Assets.">Over the timeline, a line shows exactly where they land; over the artboard, they go to the end. The video grows by what you drop — here 0:20, after Dron nad lajnou.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <HypeCanvas sel="reels" drop reels={hypeSel} />
              <Chrome canvas="video-hype" insp={<VideoInspector />} tl={
                <Timeline {...HYPE} t={4} under={CX_HYPE_REELS}
                  over={<><span className="ve-insert" style={{ left: "60%", top: 72, height: 54 }} /><span className="ve-tip" style={{ left: "61%", top: -3 }}>Drop 3 clips at 0:09<span className="ve-tip-dim">the video grows by 0:20</span></span></>}
                />
              }>
                <span className="ve-drag" style={{ left: 652, top: 690 }}>
                  <span className="ve-drag-stack">{(["night", "crowd", "field"] as Pic[]).map((pc, i) => <span key={i}><ClipPic pic={pc} i={i} className="maude-v2 k-fixed" /></span>)}</span>
                  <span className="ve-drag-n">3</span>
                  <span className="ve-drag-name">caaftv-mixzone-8s.mp4 and 2 more</span>
                </span>
              </Chrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-trim-split" label="5 · Trim an edge; S splits at the playhead" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="The video is as long as its clips.">Trim Touchdown by 0.6 s, the rest closes up, and the video is 0:14. S splits at the playhead (⌘B still works). A fixed Length in the inspector trims the end instead.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Hype trailer · Reels · 0:14" kind="video" x={560} y={92} w={194} h={345} selected size="1080 × 1920"><Still pic="qb" title="SRDCE" titleAt="bottom" /></Artboard>
              </Canvas>
              <Chrome canvas="video-hype" zoom={18} insp={<VideoInspector length="0:14" />}
                toast={<Toast at="top" action="Undo">Split Oslava at 0:10.</Toast>}
                tl={
                  <Timeline {...HYPE} len={14.4} full adv={false} t={10} time="0:10" total="0:14" style={FULL}
                    clips={[
                      HYPE_CLIPS[0], HYPE_CLIPS[1], { ...HYPE_CLIPS[2], d: 2.4, sel: true, trim: "r", dur: "2.4 s" },
                      { ...HYPE_CLIPS[3], s: 5.9 }, { n: "Oslava", s: 8.4, d: 1.6, pic: "qb" }, { n: "Oslava 2", s: 10, d: 1.4, pic: "qb" }, { ...HYPE_CLIPS[5], s: 11.4 },
                    ]}
                    text={[HYPE_TEXT[0], { ...HYPE_TEXT[1], d: 2.4 }, { ...HYPE_TEXT[2], s: 8.4 }, { ...HYPE_TEXT[3], s: 11.4 }]}
                    gfx={[{ ...HYPE_GFX[0], d: 11.4 }, { ...HYPE_GFX[1], s: 11.7 }]} music={{ ...HYPE_MUSIC, d: 14.4 }}
                    over={<><span className="ve-tip" style={{ left: "41%", top: 46 }}>Touchdown · 2.4 s<span className="ve-tip-dim">−0.6 s · video 0:14</span></span><span className="ve-cut" style={{ left: "69.4%", top: 20, height: 150 }} /></>}
                  />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-move-transition" label="6 · Drag a clip to move it" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="Move a clip by dragging it.">Dron nad lajnou lifts, and a line shows where it lands — before Touchdown. Its old place closes up when you let go; the length stays 0:15.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Hype trailer · Reels · 0:15" kind="video" x={560} y={92} w={194} h={345} selected size="1080 × 1920"><Still pic="sky" /></Artboard>
              </Canvas>
              <Chrome canvas="video-hype" zoom={18} insp={<ClipInspector name="Dron nad lajnou" length="2.5 s" adv={[["src", "dron-sweep-lajny-8s.mp4"], ["in", "0:02.0"], ["out", "0:04.5"]]} />} tl={
                <Timeline {...HYPE} full adv={false} t={7} style={FULL}
                  clips={[
                    HYPE_CLIPS[0], HYPE_CLIPS[1], { ...HYPE_CLIPS[3], st: "lift", sel: true, shift: -200 }, { ...HYPE_CLIPS[2] },
                    HYPE_CLIPS[4], HYPE_CLIPS[5],
                  ]}
                  over={<><span className="ve-insert" style={{ left: "23.33%", top: 72, height: 60 }} /><span className="ve-tip" style={{ left: "24%", top: -3 }}>Drop before Touchdown</span></>}
                />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-transition" label="7 · Click a join for a transition" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Each join between two clips takes a transition.">Click the dot between Oslava and Logo; the picker opens right there. Hover a tile and it plays; Fade over 0.5 s is chosen. Six transitions, all of today's.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Hype trailer · Reels · 0:15" kind="video" x={560} y={92} w={194} h={345} selected size="1080 × 1920"><Still pic="qb" title="SRDCE" titleAt="bottom" /></Artboard>
              </Canvas>
              <Chrome canvas="video-hype" zoom={18} insp={<VideoInspector />} tl={
                <Timeline {...HYPE} full adv={false} t={11.8} style={FULL}
                  clips={[...HYPE_CLIPS.slice(0, 5), { ...HYPE_CLIPS[5], join: "fade", joinSel: true }]}
                  pop={
                    <div className="ve-pop ve-pop--anchored" style={{ left: "80%", bottom: "calc(100% - 112px)", width: 288 }}>
                      <p className="ve-pop-t">Oslava → Logo</p>
                      <div className="ve-pop-grid">{TRANS.map(([l, k]) => <TransPick key={k} k={k} label={l} on={l === "Fade"} />)}</div>
                      <div className="ve-pop-row"><span>Length</span><Slider pct={25} label="0.5 s" /></div>
                      <p className="ve-pop-foot">Hover a tile to play it.</p>
                    </div>
                  }
                />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-text" label="8 · A title with motion; captions from speech" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Titles get a motion preset; speech becomes captions.">“PROČ ALLIGATORS” slides up. Captions from speech wrote Kilián's words one by one under it; the word being said lights up as it plays.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Nábor trailer · 16:9 · 0:30" kind="video" x={170} y={92} w={700} h={394} size="1920 × 1080">
                  <Still pic="crowd" title="PROČ ALLIGATORS" sub="Nábor 2027 · Brno" titleAt="top" />
                  <Selection x={44} y={30} w={290} h={64} label="Title · Slide up" />
                </Artboard>
              </Canvas>
              <Chrome canvas="video-nabor" zoom={36}
                toast={<Toast at="top" action="Undo">Captions added — 15 words from the interview.</Toast>}
                insp={
                  <Inspector title="PROČ ALLIGATORS" kind="Title" rows={[
                    ["Font", <InSelect value="Club Display" />],
                    ["Colour", <InFill name="Club green" tone="green" />],
                    ["Motion", <MotionGrid on="Slide up" />],
                    ["Length", <InNum value="2.2 s" icon="clock" />],
                  ]} advanced={[["enter", "slide-up 12f"], ["easing", "ease-out"], ["exit", "fade 8f"]]} />
                }
                tl={
                  <Timeline name="Nábor trailer · 16:9" len={30} t={1.6} time="0:01" full adv={false} view={[0, 12]} textLanes={2} style={FULL}
                    clips={NABOR_CLIPS} gfx={NABOR_GFX}
                    text={[{ ...NABOR_TITLES[0], sel: true }, NABOR_TITLES[1], ...words()]} music={NABOR_MUSIC} />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-captions" label="9 · Edit the talk as text; style the captions" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Strike a word, and the clip cuts there.">Kilián's “Ehm…” is struck in the transcript; 0.4 s leaves the interview and the captions follow. Captions get a style in the inspector: font, highlight, position, words at a time.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <NaborCanvas x={340} label="Nábor trailer · 16:9 · 0:29" still={<Still pic="night" pos={58} cap={<>Přišel jsem bez <u>zkušenosti.</u></>} />} />
              <Chrome canvas="video-nabor" zoom={34}
                left={
                  <div className="island island--pad ve-transcript">
                    <p className="ve-panel-h"><VIcon name="captions" size={14} />Transcript<span className="ve-transcript-src">Rozhovor · Kilián</span></p>
                    <p className="ve-tx-p"><span className="ve-tx-t">0:03</span>Přišel jsem bez <span className="ve-tx-hl">zkušenosti.</span> <span className="ve-tx-cut">Ehm…</span> Za měsíc jsem hrál první zápas.</p>
                    <p className="ve-tx-p"><span className="ve-tx-t">0:08</span>Dneska bych to nevyměnil.</p>
                    <span className="ve-tx-tip"><VIcon name="strike" size={12} />Struck “Ehm…” — cut 0.4 s from the interview</span>
                    <p className="ve-tx-foot">Select words and press delete to cut them. Fix a misheard word by typing over it.</p>
                  </div>
                }
                insp={
                  <Inspector title="Captions" kind="Captions" rows={[
                    ["Font", <InSelect value="Club Display" />],
                    ["Highlight", <InFill name="Club yellow" tone="yellow" />],
                    ["Position", <InSeg options={["Top", "Middle", "Bottom"]} value="Bottom" />],
                    ["Words at a time", <InSeg options={["1", "3", "Line"]} value="Line" />],
                    ["Also as a file", <InSwitch on />],
                  ]} advanced={[["srt", "video-nabor.srt"], ["lang", "cs"], ["maxChars", "32"]]} />
                }
                tl={
                  <Timeline name="Nábor trailer · 16:9" len={29.6} total="0:29" t={4.2} time="0:04" full adv={false} view={[2, 12]} textLanes={2} style={FULL}
                    clips={NABOR_CLIPS.map((c) => (c.n.startsWith("Rozhovor") ? { ...c, sel: true } : c))} gfx={NABOR_GFX}
                    text={[...words({ hl: "zkušenosti.", cut: "Ehm…" })]} music={NABOR_MUSIC}
                    over={<span className="ve-cut" style={{ left: "29.5%", top: 20, height: 150 }} />} />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-music" label="10 · A music bed: beats, lower under speech, volume" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Music knows its beat and steps aside for speech.">Beat marks come from the song — a tall one every bar; Snap to the beat makes edits land on them. While Kilián talks, the music drops by itself; the line shows how far.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <NaborCanvas sel={false} still={<Still pic="night" cap={<>Přišel jsem bez <u>zkušenosti.</u></>} />} />
              <Chrome canvas="video-nabor" zoom={34}
                insp={
                  <Inspector title="Hype instrumental" kind="Music" rows={[
                    ["Volume", <Slider pct={80} label="80 %" />],
                    ["Lower under speech", <InSwitch on />],
                    ["Snap to the beat", <InSwitch on />],
                    ["Fade in · out", <span className="ve-in-note">0.5 s · 1.5 s</span>],
                    ["Song", <InButton icon="music">Change…</InButton>],
                  ]} advanced={[["bpm", "120 (detected)"], ["duck", "−12 dB · 200 ms"], ["gainDb", "−2"]]} />
                }
                tl={<Timeline name="Nábor trailer · 16:9" len={30} t={4.2} full adv={false} poster={19.5} style={FULL}
                  clips={NABOR_CLIPS} text={[...NABOR_TITLES.map((t) => ({ ...t, lane: undefined }))]} gfx={NABOR_GFX} music={{ ...NABOR_MUSIC, sel: true }} />}
              />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · AI cut ───────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="ai-cut" title="Ask AI for a cut" subtitle="“Make a 30 s recap from these 12 clips” — AI watches the footage, places shots while you scrub, and the cut lands on the artboard; change it by asking or by hand">
        <DCArtboard id="ve-ai-cut" label="11 · 12 clips in, a 0:30 cut out — on the beat" width={W} height={840} fixed>
          <V2 className="ve-closeup ve-hero ve-tlx">
            <p className="ve-closeup-h">12 clips in. A 0:30 cut out, on the beat.</p>
            <p className="ve-hero-sub">Recap · Reels — what AI did between “Make a 30 s recap from these 12 clips” and Done.</p>

            <p className="ve-hero-lab" style={{ left: HX0, top: 120 }}><b>Your footage</b> · 12 clips · 1:20 · in the order you dropped them</p>
            <span className="ve-hero-left" style={{ right: 54, top: 116 }}><span className="ve-hero-left-n">Left out 3 — two too dark, one shaky</span><span className="btn btn--sm">Use them anyway</span></span>
            {SOURCE_CLIPS.map(([f, pic, len, why], i) => (
              <span key={f} className={`ve-hero-tile${why ? " ve-hero-tile--out" : ""}`} style={{ left: TILE(i), top: 150 }}>
                <span className="ve-hero-pic"><ClipPic pic={pic} i={i * 3} className="maude-v2 k-fixed" /><span className="ve-hero-len maude-v2 k-fixed" data-theme="light">{len}</span>{why ? <span className="ve-hero-why">{why}</span> : null}</span>
                <span className="ve-hero-fn">{f.replace(/-\d+s\.mp4$/, "")}</span>
              </span>
            ))}

            <svg className="ve-hero-paths" viewBox={`0 0 ${W} 840`} aria-hidden="true">
              {RECAP.map((c, j) => (c.src === undefined ? null : (() => {
                const x1 = TILE(c.src) + 50;
                const landing = c.n === "Mix zóna";
                const x2 = HX(c.s + c.d / 2);
                const y2 = landing ? 470 : 494;
                return <path key={j} className={landing ? "ve-hero-path ve-hero-path--now" : "ve-hero-path"} d={`M${x1} 236 C ${x1} 360, ${x2} 360, ${x2} ${y2}`} />;
              })()))}
            </svg>

            <p className="ve-hero-lab" style={{ left: HX0, top: 432 }}><b>AI's cut</b> · 14 shots from 9 clips · Hype instrumental, 120 BPM</p>
            <div className="ve-hero-beats" style={{ left: HX0, width: HW, top: 460 }}>
              {Array.from({ length: 61 }, (_, b) => <i key={b} className={b % 4 === 0 ? "ve-hb ve-hb--bar" : "ve-hb"} style={{ left: `${(b / 60) * 100}%` }} />)}
              {[0, 5, 10, 15, 20, 25, 30].map((s) => <span key={s} className="ve-hb-t" style={{ left: `${(s / 30) * 100}%` }}>{`0:${String(s).padStart(2, "0")}`}</span>)}
            </div>
            {RECAP_SHOTS.map((c, j) => {
              const landing = c.n === "Mix zóna";
              return (
                <span key={c.n} style={{ left: HX(c.s) + 1, width: (c.d / 30) * HW - 2, top: 494 }} className={`ve-hero-shot${landing ? " ve-hero-shot--slot" : ""}`}>
                  {landing ? null : <><ClipPic pic={c.pic} i={j} strip className="maude-v2 k-fixed" /><span className="ve-clip-lab maude-v2 k-fixed" data-theme="light"><span>{c.n}</span></span></>}
                  <i className="ve-hero-snap" />
                </span>
              );
            })}
            <span className="ve-hero-shot ve-hero-shot--landing" style={{ left: HX(13) + 1, width: (2.5 / 30) * HW - 2, top: 470 }}>
              <ClipPic pic="night" i={7} strip className="maude-v2 k-fixed" /><span className="ve-clip-lab maude-v2 k-fixed" data-theme="light"><span>Mix zóna</span></span>
            </span>
            <span className="ve-hero-now" style={{ left: HX(15.5) + 8, top: 434 }}><Spark size={11} />Placing shot 8 — lands on the beat at 0:13</span>
            {RECAP_TEXT.map((t) => <span key={String(t.n)} className="ve-item ve-item--title ve-hero-text" style={{ left: HX(t.s) + 1, width: (t.d / 30) * HW - 2, top: 566 }}><VIcon name="type" size={11} /><span>{t.n}</span></span>)}
            <span className="ve-music ve-hero-music" style={{ left: HX0 + 1, width: HW - 2, top: 596 }}>
              <span className="ve-wave">{wave(150, 1).map((h, i) => <i key={i} style={{ height: `${Math.round(h * 100)}%` }} />)}</span>
              <span className="ve-music-lab"><VIcon name="music" size={10} />Hype instrumental · 120 BPM</span>
            </span>

            <div className="ve-hero-why-row">
              <p><b>Every cut on a beat.</b> Sixty beats in 0:30; the big moments land on the tall ones, every bar.</p>
              <p><b>The best seconds of each clip.</b> Two runs of Touchdown, two of Tackle and Oslava — each a different second.</p>
              <p><b>Left out, with a reason.</b> Too dark, too shaky — named, never hidden. Use them anyway brings them back.</p>
            </div>
            <div className="ve-closeup-note"><Note n={11} title="The AI cut, in one picture.">Before: the 12 clips as you dropped them. After: 14 shots on Hype instrumental's beat. Each line is one shot finding its slot; frames 12–15 show the same thing as it happens.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="ve-ai-watch" label="12 · AI watches 12 clips" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="AI says what it's watching, in words.">“7 done” and the shots it liked so far, with the clip and the second. The new Recap artboard waits; its timeline says where shots will land.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={330} y={96} w={238} h={422} selected size="1080 × 1920" aiWorking="AI is watching footage" aiAt="below" aiCursor={false}>
                  <div className="ve-still ve-still--empty" />
                </Artboard>
              </Canvas>
              <Chrome canvas="video-recap" ai={
                <VeAI title="Recap from 12 clips" scope="Recap · Reels">
                  <p className="k-ai-msg k-ai-msg--you">Make a 30 s recap from these 12 clips</p>
                  <ClipsAttached />
                  <div className="ve-ai-card">
                    <p className="ve-ai-card-t"><Spark size={14} />Watching 12 clips… 7 done</p>
                    <div className="ve-watch">
                      {SOURCE_CLIPS.map(([f, pic], i) => (
                        <span key={f} className={`ve-watch-c${i > 7 ? " ve-watch-c--wait" : ""}`} title={f}>
                          <ClipPic pic={pic} i={i * 3} className="maude-v2 k-fixed" />
                          {i < 7 ? <span className="ve-watch-st"><Icon name="check" size={10} /></span> : i === 7 ? <span className="ve-watch-st ve-watch-st--now"><Spark size={9} /></span> : null}
                        </span>
                      ))}
                    </div>
                    <div className="ve-watch-found">
                      <span><b>0:03</b>Touchdown run — caaftv-td-run</span>
                      <span><b>0:02</b>The hardest hit — caaftv-tackle</span>
                      <span><b>0:05</b>Flag run-out — promo-runout-vlajka</span>
                    </div>
                  </div>
                  <Working>Watching archiv08-akce-1 — 8 of 12</Working>
                </VeAI>
              } tl={
                <Timeline name="Recap · Reels" len={30} t={0} under={CX_RECAP} clips={[]} music={null}
                  videoEmpty={<><Spark size={11} />Shots land here as AI places them.</>} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-ai-scrub" label="13 · Scrub while AI is still cutting" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Shots land one by one; scrub what's already there.">Tackle 2 is landing on the beat at 0:11.5. Your playhead (azure) is yours; AI's edge (spark) moves on past it and never moves yours. Stop keeps what's placed.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={330} y={96} w={238} h={422} selected size="1080 × 1920" aiWorking="AI is cutting · 7 of 14" aiAt="below" aiCursor={false}>
                  <Still pic="field" title="RYCHLOST" titleAt="bottom" scrub={{ at: 26, time: "0:07 / 0:30" }} />
                </Artboard>
                <div className="island ve-landing" style={{ left: 596, top: 330 }}>
                  <span className="ve-landing-pic"><ClipPic pic="crowd" i={6} className="maude-v2 k-fixed" /></span>
                  <span><b><Spark size={11} />Placing shot 7 · Tackle 2</b><small>caaftv-tackle, 0:03–0:04.5 · on the beat at 0:11.5</small></span>
                </div>
              </Canvas>
              <Chrome canvas="video-recap" ai={
                <VeAI title="Recap from 12 clips" scope="Recap · Reels" chips={["Use them anyway"]}>
                  <p className="k-ai-msg k-ai-msg--you">Make a 30 s recap from these 12 clips</p>
                  <ClipsAttached />
                  <p className="k-ai-msg k-ai-msg--ai">Watched all 12. Left out 3: {LEFT_OUT}.</p>
                  <Working>Placing shots on the beat — 7 of 14</Working>
                </VeAI>
              } tl={
                <Timeline name="Recap · Reels" len={30} t={7.8} time="0:07" under={CX_RECAP} className="ve-tl--proposal"
                  status={<span className="ve-proposal-chip"><Spark size={10} />AI is cutting</span>}
                  clips={[...RECAP_SHOTS.slice(0, 6).map((c) => ({ ...c, lab: c.d > 1.6 })), { ...RECAP_SHOTS[6], st: "land" as const, lab: false }, { n: "", s: 13, d: 17, st: "gap" as const, lab: false }]}
                  text={RECAP_TEXT.slice(0, 3)} gfx={[{ n: "Logo v rohu", s: 0, d: 13 }]}
                  music={RECAP_MUSIC} aiHead={{ t: 13, tag: "AI" }} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-ai-proposal" label="14 · Done — the cut is on the artboard" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="The cut is already on Recap · Reels — nothing to accept.">Undo takes all of it back. Ask for a change with the chips, or edit by hand. The three clips left out are named, with a way back.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={330} y={96} w={238} h={422} selected size="1080 × 1920">
                  <Still pic="qb" title="SRDCE" titleAt="bottom" scrub={{ at: 63, time: "0:19 / 0:30" }} />
                </Artboard>
              </Canvas>
              <Chrome canvas="video-recap" ai={
                <VeAI title="Recap from 12 clips" scope="Recap · Reels" chips={["Use another song", "Shorter", "More touchdowns"]}>
                  <p className="k-ai-msg k-ai-msg--you">Make a 30 s recap from these 12 clips</p>
                  <ClipsAttached />
                  <Result>Done — Recap · Reels is a 0:30 cut: 14 shots from 9 of your 12 clips, on the beat of Hype instrumental.</Result>
                  <p className="ve-ai-left"><span>Left out: {LEFT_OUT}.</span><span className="ve-link">Use them anyway</span></p>
                </VeAI>
              } tl={
                <Timeline name="Recap · Reels" len={30} t={19} under={CX_RECAP} className="ve-tl--proposal"
                  status={<span className="ve-proposal-chip"><Spark size={10} />Made by AI · 14 shots</span>}
                  clips={RECAP_SHOTS.map((c) => ({ ...c, lab: c.d > 1.6 }))}
                  text={RECAP_TEXT} gfx={RECAP_GFX} music={RECAP_MUSIC} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-ai-adjust" label="15 · Change a shot by hand — swap a take" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="A hand edit is just an edit.">Touchdown 2 offers its other takes from caaftv-td-run; AI's pick is marked. Swapping keeps the length and the beat. ⌘Z steps back through your edits first, then AI's.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={330} y={96} w={238} h={422} selected size="1080 × 1920">
                  <Still pic="field" pos={30} scrub={{ at: 54, time: "0:16 / 0:30" }} />
                </Artboard>
              </Canvas>
              <Chrome canvas="video-recap" ai={
                <VeAI title="Recap from 12 clips" scope="Recap · Reels" chips={["Use another song", "Shorter", "More touchdowns"]}>
                  <p className="k-ai-msg k-ai-msg--you">Make a 30 s recap from these 12 clips</p>
                  <ClipsAttached />
                  <Result>Done — Recap · Reels is a 0:30 cut: 14 shots from 9 of your 12 clips, on the beat of Hype instrumental.</Result>
                  <p className="ve-ai-left"><span>Left out: {LEFT_OUT}.</span><span className="ve-link">Use them anyway</span></p>
                </VeAI>
              } tl={
                <Timeline name="Recap · Reels" len={30} t={16.2} under={CX_RECAP}
                  clips={RECAP_SHOTS.map((c) => (c.n === "Touchdown 2" ? { ...c, sel: true } : { ...c, lab: c.d > 1.6 }))}
                  text={RECAP_TEXT} gfx={RECAP_GFX} music={RECAP_MUSIC}
                  pop={
                    <div className="ve-pop ve-pop--anchored ve-takes" style={{ left: "55.8%", bottom: "calc(100% - 96px)", width: 300 }}>
                      <p className="ve-pop-t">Other takes · caaftv-td-run</p>
                      <div className="ve-takes-row">
                        {([["0:01–0:03.5", 10, false], ["0:03–0:05.5", 34, true], ["0:04.5–0:07", 60, false]] as [string, number, boolean][]).map(([t, x, on]) => (
                          <span key={t} className="ve-take" data-on={on ? "true" : undefined}>
                            <span className="ve-take-pic maude-v2 k-fixed" data-theme="light" style={{ backgroundImage: `url(${PHOTO.field.src})`, backgroundPosition: `${x}% 45%` }} />
                            <span>{t}</span>{on ? <small><Spark size={9} />AI's pick</small> : <small>2.5 s</small>}
                          </span>
                        ))}
                      </div>
                      <p className="ve-pop-foot">Click a take to swap it in. Same length, same beat.</p>
                    </div>
                  } />
              } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · One video, many formats ──────────────────────────────────────────────────────────── */}
      <DCSection id="formats" title="One video, many formats" subtitle="Reels 9:16, 16:9 and 1:1 from one edit — linked, each with its own framing; safe zones on 9:16; an unlinked copy; re-framing a clip per format">
        <DCArtboard id="ve-formats" label="16 · Three formats, one edit" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Linked: one cut, three framings.">Trim or retitle once and all three follow; each keeps its own framing and text position. Make an unlinked copy when one needs its own cut — like the 0:15 16:9. Reels shows Instagram's safe zones.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={110} y={96} w={238} h={422} selected size="1080 × 1920">
                  <Still pic="field" title="RYCHLOST" titleAt="mid" cap={<>Touchdown <b>Alligators</b></>} safe />
                </Artboard>
                <Artboard label="Recap · 16:9 · 0:30" kind="video" x={392} y={96} w={422} h={238}><Still pic="field" pos={45} title="RYCHLOST" titleAt="bottom" /></Artboard>
                <Artboard label="Recap · 1:1 · 0:30" kind="video" x={392} y={378} w={140} h={140}><Still pic="field" title="RYCHLOST" titleAt="bottom" /></Artboard>
                <Artboard label="Recap · 16:9 · copy · 0:15" kind="video" x={572} y={378} w={242} h={136}><Still pic="sky" title="SEZÓNA 2026" titleAt="bottom" /></Artboard>
                <span className="ve-linkline" style={{ left: 352, top: 205, width: 36 }}><VIcon name="link" size={12} /></span>
                <span className="ve-linkline" style={{ left: 352, top: 438, width: 36 }}><VIcon name="link" size={12} /></span>
                <span className="ve-unlinked" style={{ left: 572, top: 520 }}><VIcon name="link-off" size={12} />Unlinked copy — its own cut</span>
              </Canvas>
              <Chrome canvas="video-recap" insp={
                <Inspector title="Recap · Reels" kind="Video" rows={[
                  ["Size", <InSelect value="Reels 9:16" />],
                  ["Formats", <span className="ve-fmts">
                    <span className="ve-fmt-row" data-on="true"><VIcon name="link" size={12} />Reels 9:16<span>this one</span></span>
                    <span className="ve-fmt-row"><VIcon name="link" size={12} />16:9<span>1920 × 1080</span></span>
                    <span className="ve-fmt-row"><VIcon name="link" size={12} />1:1<span>1080 × 1080</span></span>
                    <span className="ve-fmt-row ve-fmt-row--add"><Icon name="plus" size={12} />Add a format</span>
                  </span>],
                  ["Safe zones", <InSelect value="Instagram Reels" />],
                  ["", <InButton icon="duplicate">Make an unlinked copy</InButton>],
                ]} advanced={[["linkedTo", "recap.edit"], ["framing", "per format"]]} />
              } tl={
                <Timeline name="Recap · Reels" len={30} t={7.6} time="0:07" under={CX_FORMATS}
                  status={<span className="ve-tl-status"><VIcon name="link" size={12} />Shared by 3 formats</span>}
                  clips={RECAP_SHOTS} text={RECAP_TEXT} gfx={RECAP_GFX} music={RECAP_MUSIC} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-reframe" label="17 · Re-frame a clip for 9:16 — follow the player" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Each format frames each clip its own way.">Touchdown was shot wide; for Reels the 9:16 window follows #1 down the sideline. Drag the window to frame by hand; the other formats keep theirs.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Recap · Reels · 0:30" kind="video" x={110} y={96} w={238} h={422} selected size="1080 × 1920"><Still pic="field" pos={40} title="RYCHLOST" titleAt="mid" /></Artboard>
              </Canvas>
              <Chrome canvas="video-recap"
                insp={<ClipInspector name="Touchdown" length="2.5 s" framing="Follows #1" adv={[["src", "caaftv-td-run-7s.mp4"], ["track", "subject #1 · 98 %"]]} />}
                tl={<Timeline name="Recap · Reels" len={30} t={8} under={CX_FORMATS} clips={RECAP_SHOTS.map((c) => (c.n === "Touchdown" ? { ...c, sel: true } : c))} text={RECAP_TEXT} gfx={RECAP_GFX} music={RECAP_MUSIC} />}>
                <div className="island island--pad ve-reframe" style={{ left: 400, top: 72 }}>
                  <div className="ve-panel-h"><VIcon name="reframe" size={14} />Frame “Touchdown” for<InSeg options={["Reels 9:16", "16:9", "1:1"]} value="Reels 9:16" /></div>
                  <div className="ve-src ve-src--big maude-v2 k-fixed" data-theme="light" style={{ backgroundImage: `url(${PHOTO.field.src})` }}>
                    <svg className="ve-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M8 62 C 18 60, 28 58, 40 56" /></svg>
                    <span className="ve-track-box" style={{ left: "24%", top: "12%", width: "34%", height: "78%" }}><span>#1 · followed</span></span>
                    <span className="ve-crop" style={{ left: "24.5%", width: "31.6%" }}><span className="ve-crop-tag">Reels 9:16</span></span>
                  </div>
                  <div className="ve-reframe-foot">
                    <span className="ve-reframe-opt"><VIcon name="subject" size={14} />Follow a subject<InSwitch on /></span>
                    <span className="chip">#1<Icon name="chevron" size={12} /></span>
                    <span className="ve-tl-sp" />
                    <span className="btn btn--ghost btn--sm">Reset</span>
                    <span className="btn btn--sm btn--primary">Done</span>
                  </div>
                </div>
              </Chrome>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Playback & preview ───────────────────────────────────────────────────────────────── */}
      <DCSection id="play" title="Play it" subtitle="Tap space to play in place with sound, scrub with audio, step frame by frame, loop a range — or watch it full screen">
        <DCArtboard id="ve-play" label="18 · Play in place, loop a range, step frames" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Tap space to play; hold space to pan, as always.">It plays right on the canvas, with sound. I and O loop Touchdown and the drone; ← → step one frame, ⇧ one second — the time shows the frame while you step.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <HypeCanvas sel="reels" reels={<Still pic="sky" pos={44} scrub={{ at: 47, time: "0:07 / 0:15", playing: true }} />} />
              <Chrome canvas="video-hype" insp={<VideoInspector />} tl={
                <Timeline {...HYPE} t={7.08} time="0:07 + 2 frames" playing loopOn loop={[3.5, 9]} step={5} under={CX_HYPE_REELS}
                  playTip={<>Pause — tap <Kbd>space</Kbd><span className="ve-tip-dim">hold space and drag to pan</span></>}
                  status={<span className="ve-tl-status"><span className="ve-meter"><i style={{ height: 6 }} /><i style={{ height: 11 }} /><i style={{ height: 8 }} /></span>Sound on</span>}
                  over={<><span className="ve-inout" style={{ left: "23.33%", top: -1 }}>I</span><span className="ve-inout" style={{ left: "60%", top: -1 }}>O</span></>} />
              }>
                <span className="ve-tip" style={{ left: 700, top: 534 }}>Step <Kbd>←</Kbd><Kbd>→</Kbd> one frame · <Kbd>⇧</Kbd> one second</span>
              </Chrome>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-fullscreen" label="19 · Full-screen preview" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="Full screen hides everything but the video.">Present, in the Share cluster's mode switch, plays the selected video here; switch format without leaving, the loop comes along. esc goes back.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <div className="ve-full">
                <span className="ve-full-fmt"><InSeg options={["Reels 9:16", "16:9", "1:1"]} value="Reels 9:16" /></span>
                <span className="ve-full-esc"><Kbd>esc</Kbd>Back to the canvas</span>
                <div className="ve-full-video maude-v2 k-fixed" data-theme="light" style={{ width: 360, height: 640 }}>
                  <Still pic="qb" title="SRDCE" titleAt="mid" />
                </div>
                <div className="ve-full-bar">
                  <span className="icon-btn k-icon-sm k-pressed"><VIcon name="pause" size={14} /></span>
                  <span className="icon-btn k-icon-sm"><VIcon name="loop" size={14} /></span>
                  <span className="ve-full-time">0:10 / 0:15</span>
                  <span className="ve-full-scrub"><b style={{ width: "66%" }} /><em style={{ left: "66%" }} /><span style={{ left: "20%" }} /><span style={{ left: "60%" }} /></span>
                  <span className="icon-btn k-icon-sm"><VIcon name="volume" size={14} /></span>
                  <span className="icon-btn k-icon-sm"><VIcon name="captions" size={14} /></span>
                </div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Export ───────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="export" title="Export" subtitle="MP4 in 1080p or 4K, GIF, sound only; render in the cloud or on this Mac; progress in Exports; done, or partly done with one Retry">
        <DCArtboard id="ve-export" label="20 · Export — every format at once" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="One sheet for all three formats.">Nothing is selected, so Scope is this canvas — 4 artboards, as in 09; tick the formats to export. The cloud keeps going if this Mac sleeps; this Mac needs the window open.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <RecapCanvas />
              <Chrome canvas="video-recap" />
              <Veil />
              <Dialog title="Export “Recap”" primary="Export 3 videos" width={560}>
                <div className="ve-sheet">
                  <div className="ve-sheet-row"><span>Scope</span><InSelect value="This canvas · 4 artboards" /></div>
                  <div className="ve-sheet-sep" />
                  <div className="ve-sheet-row"><span>Formats</span><span className="ve-sheet-n">3 of 4 ticked</span></div>
                  <div className="ve-fmt">
                    {([["Reels 9:16", "1080 × 1920", 14, 24, true], ["16:9", "1920 × 1080", 28, 16, true], ["1:1", "1080 × 1080", 20, 20, true], ["16:9 copy · 0:15", "1920 × 1080", 28, 16, false]] as [string, string, number, number, boolean][]).map(([l, s, w, h, on]) => (
                      <span key={l} className="ve-fmt-o" data-on={on ? "true" : undefined}><span className="ve-box" data-on={on ? "true" : undefined}>{on ? <Icon name="check" size={10} /> : null}</span><span className="ve-fmt-pic maude-v2 k-fixed" data-theme="light" style={{ width: w, height: h, backgroundImage: `url(${on ? PHOTO.field.src : PHOTO.sky.src})` }} /><span>{l}<small>{s}</small></span></span>
                    ))}
                  </div>
                  <div className="ve-sheet-sep" />
                  <div className="ve-sheet-row"><span>Format</span><InSeg options={["MP4", "GIF", "Sound only"]} value="MP4" /></div>
                  <p className="ve-sheet-hint">Sound only makes one file — the formats share their sound.</p>
                  <div className="ve-sheet-row"><span>Quality</span><InSeg options={["1080p", "4K"]} value="1080p" /></div>
                  <div className="ve-sheet-row"><span>Captions</span><InSeg options={["Burned in", "As a file", "Both", "Off"]} value="Both" /></div>
                  <div className="ve-sheet-sep" />
                  <div className="ve-where">
                    <span className="ve-where-o" data-on="true"><span className="ve-radio" data-on="true" /><span><strong>In the cloud</strong><small>About 2 min. Keeps going if this Mac sleeps.</small></span></span>
                    <span className="ve-where-o"><span className="ve-radio" /><span><strong>On this Mac</strong><small>About 6 min. Keep this window open until it's done.</small></span></span>
                  </div>
                  <div className="ve-sheet-row"><span className="k-adv-btn ve-sheet-adv"><span className="k-adv-ch"><VIcon name="submenu" size={12} /></span>Advanced</span><span className="ve-sum">3 videos + 1 caption file · about 48 MB</span></div>
                </div>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-render" label="21 · Rendering, done, partly done" width={W} height={560} fixed>
          <V2 className="ve-closeup">
            <p className="ve-closeup-h">Rendering, done, partly done — each says it in one line</p>
            <div className="ve-closeup-row">
              <div className="ve-closeup-col ve-render-col">
                <ExportsCluster ring={55} />
                <div className="island ve-render">
                  <p className="ve-render-h"><Icon name="export" size={14} /><span className="ve-render-hn">Exports</span><span className="icon-btn k-icon-sm" title="Open the Downloads folder" aria-label="Open the Downloads folder"><Icon name="folder" size={14} /></span><span className="icon-btn k-icon-sm" title="Fold into the Exports icon" aria-label="Fold into the Exports icon"><Icon name="chevron" size={14} /></span></p>
                  <span className="ve-render-row"><span className="ve-render-st ve-render-st--done"><Icon name="check" size={11} /></span><span>Recap · Reels</span><em>Ready</em></span>
                  <span className="ve-render-row"><span className="ve-render-st"><VIcon name="video" size={11} /></span><span>Recap · 16:9</span><em>Rendering… 64 % · about 1 min</em></span>
                  <span className="ve-render-bar"><b style={{ width: "64%" }} /></span>
                  <span className="ve-render-row"><span className="ve-render-st"><Icon name="clock" size={11} /></span><span>Recap · 1:1</span><em>Queued</em></span>
                  <p className="ve-render-foot"><Icon name="cloud" size={11} />In the cloud — keeps going if this Mac sleeps or the window closes.</p>
                </div>
                <p className="ve-closeup-cap"><strong>Progress lives in Exports, as in 09.</strong> The Exports icon in the Share cluster carries a ring while anything renders; click it and the Exports panel opens under it, top-right. ⌘\ hides it with the panels.</p>
              </div>
              <div className="ve-closeup-col">
                <Toast icon="done" action="Show in Finder" at="free" style={{ position: "relative", left: "auto", translate: "none" }}>3 videos are ready.</Toast>
                <p className="ve-closeup-cap"><strong>Done — one toast for the whole export, one action.</strong> Cloud or this Mac, the files land on this Mac, so the action is always Show in Finder. A link to share is the Share sheet's job (Copy link lives there).</p>
              </div>
              <div className="ve-closeup-col">
                <Toast icon="problem" action="Retry" at="free" style={{ position: "relative", left: "auto", translate: "none", whiteSpace: "normal", maxWidth: 400 }}>Exported 2 of 3 — Recap · 16:9 didn't render. The connection dropped at 0:21; your edit is safe.</Toast>
                <p className="ve-closeup-cap"><strong>Partly done — how many made it, and one Retry.</strong> Retry renders only Recap · 16:9; Reels and 1:1 are already in Downloads. The full render log stays in Menu › Diagnostics › Logs.</p>
              </div>
            </div>
            <div className="ve-closeup-note"><Note n={21} title="Render states.">Three moments of one export, in 09's words — Queued, Rendering…, Ready, and “Exported N of M” when one didn't make it.</Note></div>
          </V2>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Edge cases ───────────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="Edge cases" subtitle="Footage still on someone's Mac or still preparing · Tereza on captions while you trim · a 40-clip match video · vertical footage on 16:9 · no sound at all">
        <DCArtboard id="ve-footage" label="22 · Footage not here yet; 4K clips still preparing" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="Footage that isn't here yet says whose it is and waits.">Dron klesá hasn't synced from Jonas's Mac — quiet, not an error. Missing and Relink… appear only if no device has it. Three 4K .mov files are still preparing.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Touchdown klip · Reels · 0:12" kind="video" x={560} y={92} w={194} h={345} selected size="1080 × 1920">
                  <Still pic="sky" offline="Waiting for Jonas's Mac" />
                </Artboard>
              </Canvas>
              <Chrome canvas="video-touchdown" zoom={18} insp={
                <Inspector title="Dron klesá" kind="Clip" rows={[
                  ["File", <span className="ve-in-note">dron-areal-klesani-9s.mov</span>],
                  ["Status", <span className="ve-in-note">Waiting for Jonas's Mac</span>],
                  ["", <span className="ve-in-note">Your edit is safe. It plays once the file arrives.</span>],
                ]} advanced={[["src", "assets/9f3a2c1e.mov"], ["status", "waiting · on Jonas's Mac"]]} />
              } tl={
                <Timeline name="Touchdown klip · Reels" len={12} t={1.2} full adv={false} style={FULL}
                  status={<span className="ve-tl-status"><VIcon name="sync" size={12} />3 clips still preparing</span>}
                  clips={[
                    { n: "Dron klesá · waiting for Jonas's Mac", s: 0, d: 3, st: "off", sel: true },
                    { n: "Touchdown", s: 3, d: 4, pic: "field" },
                    { n: "IMG_4471.mov · 4K", s: 7, d: 2, st: "prep", pct: 62 },
                    { n: "IMG_4472.mov · 4K", s: 9, d: 2, st: "prep", pct: 18 },
                    { n: "IMG_4473.mov", s: 11, d: 1, st: "prep", pct: 0 },
                  ]}
                  text={[{ n: "TOUCHDOWN!", s: 3.5, d: 3 }]} gfx={[{ n: "Skóre 21 : 14", s: 7, d: 5 }]} music={{ n: "Dark half-time trap · 126 BPM", s: 0, d: 12, bpm: 126 }} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-together" label="23 · Tereza fixes a caption while you trim" width={W} height={H} fixed>
          <Stage note={<Note n={23} title="Two people, one video, no waiting.">You trim Huddle; Tereza fixes a word captions misheard — “zábas” to “zápas”. Her playhead is a thin sky line; the word she's in is hers until she leaves it.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <NaborCanvas x={250} sel label="Nábor trailer · 16:9 · 0:29" still={<Still pic="qb" title="NAUČÍME TĚ HRÁT" titleAt="top" />} />
              <Chrome canvas="video-nabor" zoom={34} people={["tereza"]} insp={<ClipInspector name="Huddle" length="3.6 s" adv={[["src", "caaftv-huddle-6s.mp4"], ["in", "0:00.4"], ["out", "0:04.0"]]} />}
                tl={
                  <Timeline name="Nábor trailer · 16:9" len={29.6} total="0:29" t={13} time="0:13" full adv={false} view={[2, 16]} textLanes={2} style={FULL}
                    clips={NABOR_CLIPS.map((c) => (c.n === "Huddle" ? { ...c, sel: true, trim: "l" as const } : c))} gfx={NABOR_GFX}
                    text={[NABOR_TITLES[1], ...words({ peer: "zápas.", cut: "Ehm…", edit: ["zápas.", <>zá<span className="ve-caret">p</span>as.</>] })]}
                    music={NABOR_MUSIC} peerHead={{ t: 7.4 }}
                    over={<><span className="ve-peer-tag" style={{ left: "38.6%", top: -1 }}><Avatar who="tereza" size="sm" />Tereza is fixing a caption</span><span className="ve-tip" style={{ left: "82%", top: 72 }}>Huddle · 3.6 s</span><Cursor name="tereza" x={462} y={52} /></>} />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-long" label="24 · 40 clips — zoom out, fold tracks, jump by marker" width={W} height={H} fixed>
          <Stage note={<Note n={24} title="A whole match: zoom out, fold what you don't need.">40 clips, 4:12, names hidden until hover. Markers jump to the big moments; ⌘K finds a clip by name. Over the timeline ⌘+ and ⌘− zoom it; the grip on top makes it taller.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Zápas · Prague Lions · sestřih · 4:12" kind="video" x={300} y={92} w={500} h={281} selected size="1920 × 1080"><Still pic="night" pos={42} title="BRNO 34 : 21 PRAGUE" titleAt="top" /></Artboard>
              </Canvas>
              <Chrome canvas="video-zapas-lions" zoom={26} insp={<VideoInspector title="Zápas · Prague Lions · sestřih" size="16:9 · 1080p" length="4:12" poster="0:48" />} tl={
                <Timeline name="Zápas · Prague Lions" len={252} t={133} time="2:13" full adv={false} zoom={6} style={FULL} fold={{ text: "Text · 18", gfx: "Graphics · 6" }}
                  step={60} markers={[{ t: 14, label: "Výkop" }, { t: 44, label: "TD 1" }, { t: 98, label: "Poločas" }, { t: 202, label: "TD 2" }]}
                  clips={LONG_CLIPS}
                  music={{ n: "Hype instrumental · 120 BPM", s: 0, d: 252, lab: true }}
                  over={<span className="ve-tip" style={{ left: "50%", top: 32 }}>Akce 22 · caaftv-td-run · 0:09</span>} />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ve-fit-fill" label="25 · A vertical clip on 16:9; a video with no sound" width={W} height={H} fixed>
          <Stage note={<Note n={25} title="Vertical footage asks once how to sit; silence says so.">A phone clip on 16:9: Fill crops and follows the player, Fit adds bars, Blur behind fills the sides. No clip has sound, so the music track offers some.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="POV · 16:9 · 0:20" kind="video" x={300} y={84} w={560} h={315} selected size="1920 × 1080">
                  <div className="ve-still"><span className="ve-blurbg" style={{ backgroundImage: `url(${PHOTO.qb.src})` }} /><span className="ve-vert" style={{ backgroundImage: `url(${PHOTO.qb.src})` }} /><span className="ve-cap" style={{ bottom: "10%" }}>POV: poprvé na tréninku</span></div>
                </Artboard>
              </Canvas>
              <Chrome canvas="video-pov" zoom={34} insp={<VideoInspector title="POV · 16:9" size="16:9 · 1080p" length="0:20" poster="0:02" sound={null} />} tl={
                <Timeline name="POV · 16:9" len={20} t={3} full adv={false} style={FULL}
                  clips={[{ n: "IMG_5120.mov · vertical", s: 0, d: 8, pic: "qb", sel: true, mute: true }, { n: "Kabina", s: 8, d: 6, pic: "crowd", mute: true }, { n: "Trénink v hale", s: 14, d: 6, pic: "night", mute: true }]}
                  text={[{ n: "POV: poprvé na tréninku", s: 0.5, d: 7 }]} gfx={[]} music={null}
                  musicEmpty={<><VIcon name="mute" size={12} />No sound in this video.<span className="ve-link">Add music</span><span className="ve-row-or">or ask AI for a track</span></>}
                  pop={
                    <div className="ve-pop ve-pop--anchored ve-fit" style={{ left: "20%", bottom: "calc(100% - 76px)" }}>
                      <p className="ve-pop-t">IMG_5120 is vertical — how should it sit?</p>
                      <span className="ve-fit-o"><span className="ve-fit-pic ve-fit-pic--fill maude-v2 k-fixed" data-theme="light" style={{ backgroundImage: `url(${PHOTO.qb.src})` }} /><span className="ve-fit-src"><i /></span><span><strong>Fill</strong><small>Crops to the player, follows the player</small></span></span>
                      <span className="ve-fit-o"><span className="ve-fit-pic ve-fit-pic--fit maude-v2 k-fixed" data-theme="light"><i style={{ backgroundImage: `url(${PHOTO.qb.src})` }} /></span><span><strong>Fit</strong><small>Whole picture, dark bars</small></span></span>
                      <span className="ve-fit-o" data-on="true"><span className="ve-fit-pic ve-fit-pic--blur maude-v2 k-fixed" data-theme="light" style={{ backgroundImage: `url(${PHOTO.qb.src})` }}><i style={{ backgroundImage: `url(${PHOTO.qb.src})` }} /></span><span><strong>Blur behind</strong><small>Whole picture, soft sides</small></span></span>
                      <span className="ve-pop-foot"><span className="ve-box" data-on="true"><Icon name="check" size={10} /></span>Same for every vertical clip</span>
                    </div>
                  } />
              } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 8 · Advanced ─────────────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced" subtitle="Frame numbers, fps, codec, bitrate, keyframes with an easing curve, the EDL and the Remotion code — at the foot of the timeline, in mono">
        <DCArtboard id="ve-advanced" label="26 · Advanced — frames, curves, the cut as code" width={W} height={H} fixed>
          <Stage note={<Note n={26} title="Everything the old timeline had, one disclosure down.">Advanced at the timeline's foot turns the ruler to frames and shows keyframes; the curve, the export settings, the EDL and the code open beside it. Nothing was deleted.</Note>}>
            <Window tabs={GTABS} activeTab={1}>
              <Canvas>
                <Artboard label="Nábor trailer · 16:9 · 0:30" kind="video" x={80} y={92} w={372} h={209} selected size="1920 × 1080"><Still pic="qb" title="NAUČÍME TĚ HRÁT" titleAt="top" /></Artboard>
              </Canvas>
              <Chrome canvas="video-nabor" zoom={21} tl={
                <Timeline name="Nábor trailer · 16:9" len={30} t={11.8} time="00:00:11:24" total="00:00:30:00" full adv frames view={[8, 20]} step={2} textLanes={1} style={FULL}
                  clips={NABOR_CLIPS} text={[{ ...NABOR_TITLES[1], sel: true }]} gfx={NABOR_GFX} music={NABOR_MUSIC} keyframes={[11, 11.4, 14.4, 15]}
                  foot={<span className="ve-adv-foot"><span className="k-mono">30 fps · frame 354 of 900 · 00:00:11:24</span><InSeg options={["Timecode", "Frames"]} value="Frames" /></span>} />
              }>
                <div className="island island--pad ve-panel" style={{ left: 480, top: 68, width: 380 }}>
                  <p className="ve-panel-h"><VIcon name="keyframe" size={14} />Easing · NAUČÍME TĚ HRÁT<span className="chip">y · opacity</span></p>
                  <div className="ve-curve">
                    <svg viewBox="0 0 340 150" preserveAspectRatio="none" aria-hidden="true">
                      <path className="ve-curve-grid" d="M0 37.5H340M0 75H340M0 112.5H340M85 0V150M170 0V150M255 0V150" />
                      <path className="ve-curve-arm" d="M16 134L91 22M324 16L200 16" />
                      <path className="ve-curve-line" d="M16 134C91 22 200 16 324 16" />
                      <circle className="ve-curve-h" cx="91" cy="22" r="5" /><circle className="ve-curve-h" cx="200" cy="16" r="5" />
                    </svg>
                    <span className="ve-curve-lab" style={{ left: 8, bottom: 4 }}>frame 330</span>
                    <span className="ve-curve-lab" style={{ right: 8, bottom: 4 }}>frame 342</span>
                  </div>
                  <div className="ve-adv-row"><span className="k-mono">easing</span><span className="k-mono">cubic-bezier(0.22, 1, 0.36, 1)</span></div>
                  <div className="ve-adv-row"><span className="k-mono">y</span><span className="k-mono">48px → 0px</span></div>
                </div>
                <div className="island island--pad ve-panel" style={{ right: 16, top: 68, width: 340 }}>
                  <p className="ve-panel-h"><VIcon name="export" size={14} />Render settings</p>
                  <div className="ve-adv-row"><span className="k-mono">fps</span><span className="k-mono">30</span></div>
                  <div className="ve-adv-row"><span className="k-mono">durationInFrames</span><span className="k-mono">900</span></div>
                  <div className="ve-adv-row"><span className="k-mono">codec</span><span className="k-mono">h264 · webm · gif</span></div>
                  <div className="ve-adv-row"><span className="k-mono">bitrate</span><span className="k-mono">12 Mb/s (auto)</span></div>
                  <div className="ve-adv-row"><span className="k-mono">colour</span><span className="k-mono">Rec. 709</span></div>
                  <p className="ve-panel-h ve-panel-h--2"><VIcon name="file" size={14} />The cut as code<InSeg options={["EDL", "Code"]} value="EDL" /></p>
                  <pre className="ve-code">{`{ `}<b>"clip"</b>{`: `}<i>"314d43a3.mp4"</i>{`,
  `}<b>"name"</b>{`: `}<i>"trenink-v-hale"</i>{`,
  `}<b>"startSec"</b>{`: 2.1,
  `}<b>"durationFrames"</b>{`: 120,
  `}<b>"transition"</b>{`: `}<i>"fade"</i>{`,
  `}<b>"overlay"</b>{`: { `}<b>"kind"</b>{`: `}<i>"title"</i>{`,
    `}<b>"text"</b>{`: `}<i>"NAUČÍME TĚ HRÁT"</i>{` } }`}</pre>
                  <p className="ve-sum">video-nabor.edl.json · <span className="ve-link">Open in code view</span></p>
                </div>
              </Chrome>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

