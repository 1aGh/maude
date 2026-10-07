/**
 * @file     _video.tsx — the video artboard's shared pieces: footage stills, the timeline island, the
 *           Hype trailer data and the video inspector. Underscore ⇒ hidden from the canvas tree.
 * @ds       maude-v2 (CONTRACT.md wins)
 * @source   07 Video Editing is the source of truth for the timeline; 08 Artboard Kinds (`ak-video`)
 *           imports it from here so the two canvases can never draw it two ways again.
 *           Promoted out of 07 in the 07 fix pass (critic B4) — a kit candidate the main agent can
 *           fold into _kit later. Class prefix stays `ve-`; styles live in ./_video.css.
 *
 * Every canvas that imports this also imports "./_video.css" (after "./_kit.css").
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────────────────────
 *   VIcon({ name, size? })         video glyphs in the kit's hand (16 grid, 1.5 round stroke); falls back to kit Icon.
 *   PHOTO · Pic                    the user's real footage stills (Alligators photos in .design/assets).
 *   ClipPic({ pic, i?, strip? })   a footage picture that fills its parent (strip = a filmstrip of frames).
 *   Still({ pic, … })              a frame of the video on the artboard: titles, captions, safe zones, scrub, offline.
 *   Timeline(TL)                   the timeline island — compact (slides out of the artboard, notch points at it)
 *                                  or full (edge to edge, track names, zoom, Advanced at its foot).
 *   under(cx, w?)                  compact geometry: centred under an artboard whose centre is `cx` (window-body px).
 *   HYPE · HYPE_* · SOURCE_CLIPS   real Alligators content (social/video-hype, the recap's 12 source clips).
 *   VideoInspector({ title, … })   the one video-artboard inspector row set: Size · Length · Poster frame · Sound · Export.
 *   Poster · Slider                inspector values.
 *   mss(s)                         seconds → m:ss.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, InButton, InFill, InNum, InSelect, Inspector } from "./_kit";

/* ═══ Glyphs ═════════════════════════════════════════════════════════════════════════════════ */
const VE_GLYPHS: Record<string, ReactNode> = {
  scissors: (<><circle cx="4.5" cy="11.5" r="2" /><circle cx="11.5" cy="11.5" r="2" /><path d="M6 10L11.5 2.5M10 10L4.5 2.5" /></>),
  music: (<><path d="M6 11.5V3.5l7-1.5v8" /><circle cx="4.25" cy="11.75" r="1.75" /><circle cx="11.25" cy="10" r="1.75" /></>),
  volume: (<><path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5z" /><path d="M10.5 6a2.75 2.75 0 0 1 0 4M12.25 4.25a5.25 5.25 0 0 1 0 7.5" /></>),
  mute: (<><path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5z" /><path d="M10.5 6.25l3 3.5M13.5 6.25l-3 3.5" /></>),
  captions: (<><rect x="2" y="3.5" width="12" height="9" rx="2.5" /><path d="M4.75 7.25h3M9.25 7.25h2M4.75 9.75h1.5M7.75 9.75h3.5" /></>),
  loop: <path d="M2.75 8.5v-1a3 3 0 0 1 3-3h7M11 2.75l1.75 1.75L11 6.25M13.25 7.5v1a3 3 0 0 1-3 3h-7M5 13.25L3.25 11.5 5 9.75" />,
  "step-fwd": (<><path d="M3.5 3.5v9l6-4.5z" /><path d="M12.5 3.5v9" /></>),
  "step-back": (<><path d="M12.5 3.5v9l-6-4.5z" /><path d="M3.5 3.5v9" /></>),
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  transition: <path d="M2.5 3.5L8 8l-5.5 4.5zM13.5 3.5L8 8l5.5 4.5z" />,
  keyframe: <path d="M8 2.5L13.5 8 8 13.5 2.5 8z" />,
  reframe: <path d="M4.5 1.75v9.75h9.75M1.75 4.5h9.75v9.75" />,
  wave: <path d="M2 8h.01M4.5 5.5v5M7 3v10M9.5 5v6M12 6.5v3M14 8h.01" />,
  beat: <path d="M4 12.5V9.5M8 12.5V3.5M12 12.5V7" />,
  up: <path d="M5 9.5l3-3 3 3" />,
  down: <path d="M5 6.5l3 3 3-3" />,
  subject: (<><circle cx="8" cy="8" r="5.25" /><circle cx="8" cy="8" r="1.5" /></>),
  minus: <path d="M3.5 8h9" />,
  expand: <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />,
  compact: <path d="M13 7H9V3M9 7l4.5-4.5M3 9h4v4M7 9l-4.5 4.5" />,
  "link-off": <path d="M6.5 9.5l-1.25 1.25a2.12 2.12 0 0 1-3-3L3.5 6.5M9.5 6.5l1.25-1.25a2.12 2.12 0 0 1 3 3L12.5 9.5M2.5 2.5l11 11" />,
  marker: <path d="M4.5 13.5v-11h7l-2 3 2 3h-7" />,
  strike: <path d="M2.5 8h11M5 4.5c.5-1 1.6-1.5 3-1.5 1.8 0 3 .8 3 2M5 11c.4 1.2 1.6 2 3.2 2 1.8 0 2.8-.9 2.8-2" />,
};
export function VIcon({ name, size = 16 }: { name: string; size?: number }) {
  if (!VE_GLYPHS[name]) return <Icon name={name} size={size} />;
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {VE_GLYPHS[name]}
    </svg>
  );
}

/* ═══ The user's footage — real Alligators photos from .design/assets ═══════════════════════════
   field = a run down the sideline (#1, 0fce52c7) · sky = the chain crew's down marker (df75f549)
   crowd = the bench and coaches (f366481a) · night = #6 with the ball on the studio black (431f956e)
   qb = the flag quarterback, shot vertical on a phone (edee3283) · logo = the club tile (drawn). */
export type Pic = "field" | "sky" | "night" | "crowd" | "qb" | "logo";
export const PHOTO: Record<Exclude<Pic, "logo">, { src: string; x: number; y: number; alt: string }> = {
  field: { src: "/assets/0fce52c7.jpg", x: 36, y: 45, alt: "Alligators #1 running the ball down the sideline" },
  sky: { src: "/assets/df75f549.jpg", x: 42, y: 40, alt: "The chain crew's down marker showing 2" },
  crowd: { src: "/assets/f366481a.jpg", x: 52, y: 40, alt: "Coaches on the bench, mid-game" },
  night: { src: "/assets/431f956e.jpg", x: 50, y: 32, alt: "Alligators #6 holding the ball, studio portrait" },
  qb: { src: "/assets/edee3283.jpg", x: 50, y: 40, alt: "Flag quarterback mid-throw, vertical phone footage" },
};
/** A footage picture filling its parent. `i` shifts the crop so neighbouring clips read as different frames;
 *  `strip` repeats it sideways like a filmstrip (CapCut / Framer timeline thumbnails). */
export function ClipPic({ pic = "field", i = 0, strip = false, className = "" }: { pic?: Pic; i?: number; strip?: boolean; className?: string }) {
  if (pic === "logo") return <span className={`ve-pic ve-pic--logo ${className}`}><i /></span>;
  const p = PHOTO[pic];
  const x = Math.max(0, Math.min(100, p.x + ((i * 23) % 40) - 18));
  const style: CSSProperties = strip
    ? { backgroundImage: `url(${p.src})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x", backgroundPosition: `${-((i * 37) % 60)}px ${p.y}%` }
    : { backgroundImage: `url(${p.src})`, backgroundSize: "cover", backgroundPosition: `${x}% ${p.y}%` };
  return <span className={`ve-pic${strip ? " ve-pic--strip" : ""} ${className}`} style={style} />;
}

/* ═══ A frame of the video, on the artboard ═══════════════════════════════════════════════════ */
export function Still({ pic = "field", pos, title, sub, titleAt = "bottom", cap, play = false, scrub, safe = false, offline, players }: {
  pic?: Pic; pos?: number; title?: ReactNode; sub?: ReactNode; titleAt?: "top" | "bottom" | "mid"; cap?: ReactNode; play?: boolean;
  scrub?: { at: number; time: string; playing?: boolean }; safe?: boolean; offline?: ReactNode; players?: number[];
}) {
  const x = pos ?? players?.[0];
  return (
    <div className={`ve-still ve-still--${pic}`}>
      {pic === "logo" ? <span className="ve-still-logo"><span>ALLIGATORS</span></span> : (
        <span className="ve-still-photo" role="img" aria-label={PHOTO[pic].alt}
          style={{ backgroundImage: `url(${PHOTO[pic].src})`, backgroundPosition: `${x ?? PHOTO[pic].x}% ${PHOTO[pic].y}%` }} />
      )}
      {title ? <div className={`ve-title-on ve-title-on--${titleAt}`}><strong>{title}</strong>{sub ? <small>{sub}</small> : null}</div> : null}
      {cap ? <span className="ve-cap" style={{ bottom: safe ? "26%" : "13%" }}>{cap}</span> : null}
      {safe ? (
        <>
          <span className="ve-safe-band" style={{ top: 0, height: "11%" }}>Profile row</span>
          <span className="ve-safe-band" style={{ bottom: 0, height: "20%" }}>Caption and sound</span>
          <span className="ve-safe-side" style={{ top: "40%", bottom: "20%" }} />
        </>
      ) : null}
      {offline ? <span className="ve-still-off"><span className="ve-still-off-w"><VIcon name="clock" size={14} />{offline}</span></span> : null}
      {play ? <span className="ve-playbtn"><VIcon name="play" size={16} /></span> : null}
      {scrub ? (
        <span className="ve-scrub"><VIcon name={scrub.playing ? "pause" : "play"} size={10} /><i><b style={{ width: `${scrub.at}%` }} /></i><span>{scrub.time}</span></span>
      ) : null}
    </div>
  );
}

/* ═══ The timeline island ════════════════════════════════════════════════════════════════════ */
export type Clip = {
  n: string; s: number; d: number; pic?: Pic; sel?: boolean; trim?: "l" | "r"; lab?: boolean;
  st?: "off" | "prep" | "ghost" | "lift" | "gap" | "dim" | "land"; pct?: number; ai?: boolean; mute?: boolean; dur?: string;
  join?: "fade" | "slide" | "wipe" | "flip" | "clock"; joinSel?: boolean; shift?: number;
};
export type TItem = { n: ReactNode; s: number; d: number; kind?: "title" | "word" | "cue" | "gfx"; lane?: 0 | 1; sel?: boolean; hl?: boolean; edit?: boolean; ai?: boolean; peer?: boolean; lock?: boolean; cut?: boolean; key?: string };
export type Music = { n: string; s: number; d: number; sel?: boolean; bpm?: number; duck?: [number, number][]; duckLabel?: string; ai?: boolean; lab?: boolean };
export type TL = {
  name: string; len: number; t: number; time?: string; total?: string; playing?: boolean; full?: boolean; style?: CSSProperties; className?: string;
  clips: Clip[]; text?: TItem[]; gfx?: TItem[]; music?: Music | null; musicEmpty?: ReactNode; videoEmpty?: ReactNode; textEmpty?: ReactNode;
  textLanes?: 1 | 2; step?: number; view?: [number, number]; loop?: [number, number]; poster?: number; frames?: boolean;
  tools?: ReactNode; status?: ReactNode; aiHead?: { t: number; tag: string }; peerHead?: { t: number }; fold?: { text?: string; gfx?: string };
  /** drawn inside the lanes (clipped sideways with them) */ over?: ReactNode;
  /** drawn over the lanes, never clipped — popovers anchored to a clip or a join (left in % of the lanes) */ pop?: ReactNode;
  foot?: ReactNode; adv?: boolean; keyframes?: number[]; loopOn?: boolean; zoom?: number; noHead?: boolean;
  /** compact: centre of the artboard it belongs to, in window-body px — sets left/width/bottom and the notch */ under?: number;
  /** a drawn tooltip on the play button */ playTip?: ReactNode;
  markers?: { t: number; label: string }[];
};

export const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** deterministic waveform heights (0..1) */
export function wave(n: number, seed = 1) {
  return Array.from({ length: n }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.61 * seed + 1.3) * Math.cos(i * 0.17 + seed)));
}

/** Compact timeline: 900 wide, centred under the artboard (clamped to the window), above the toolbar. */
export const BODY_W = 1440;
export function under(cx: number, w = 900): { style: CSSProperties; notch: number } {
  const left = Math.max(16, Math.min(BODY_W - 16 - w, Math.round(cx - w / 2)));
  return { style: { left, width: w, bottom: 80 }, notch: cx - left };
}
export const FULL: CSSProperties = { bottom: 80 };

export function Timeline(p: TL) {
  const [v0, v1] = p.view ?? [0, p.len];
  const span = v1 - v0;
  const X = (s: number) => ((s - v0) / span) * 100;
  const Wd = (d: number) => (d / span) * 100;
  const step = p.step ?? (span <= 12 ? 1 : span <= 16 ? 3 : span <= 32 ? 5 : span <= 70 ? 10 : 30);
  const ticks: number[] = [];
  for (let s = Math.ceil(v0 / step) * step; s <= v1 + 0.001; s += step) ticks.push(s);
  const lanes = p.textLanes ?? 1;
  const textH = lanes === 2 ? 48 : 24;
  const full = !!p.full;
  const geo = p.under !== undefined && !full ? under(p.under) : null;
  const rows: { id: string; label: string; icon: string; h: number; fold?: string; btn?: string }[] = [
    { id: "text", label: "Text", icon: "type", h: p.fold?.text ? 10 : textH, fold: p.fold?.text, btn: "view" },
    { id: "gfx", label: "Graphics", icon: "image", h: p.fold?.gfx ? 10 : 24, fold: p.fold?.gfx, btn: "view" },
    { id: "video", label: "Video", icon: "video", h: full ? 52 : 46, btn: "volume" },
    { id: "music", label: "Music", icon: "music", h: 30, btn: "volume" },
  ];
  const itemStyle = (it: TItem): CSSProperties => ({
    left: `calc(${X(it.s)}% + 1px)`, width: `calc(${Wd(it.d)}% - 2px)`,
    ...(lanes === 2 && !p.fold?.text && it.kind !== "gfx" ? { top: it.lane ? 25 : 0, height: 23, bottom: "auto" } : {}),
  });
  const renderItem = (it: TItem, i: number) => (
    <span key={it.key ?? i} className={`ve-item ve-item--${it.kind ?? "title"}${it.ai ? " ve-item--ai" : ""}${it.peer ? " ve-item--peer" : ""}${it.lock ? " ve-item--lock" : ""}${it.cut ? " ve-item--cut" : ""}`}
      data-sel={it.sel ? "true" : undefined} data-hl={it.hl ? "true" : undefined} data-edit={it.edit ? "true" : undefined} style={itemStyle(it)}>
      {it.kind === "title" || !it.kind ? <VIcon name="type" size={11} /> : it.kind === "gfx" ? <VIcon name="image" size={11} /> : it.kind === "cue" ? <VIcon name="captions" size={11} /> : null}
      <span>{it.n}</span>
    </span>
  );
  const m = p.music;
  const beats: number[] = [];
  if (m?.bpm) for (let b = m.s; b <= m.s + m.d + 0.001; b += 60 / m.bpm) if (b >= v0 && b <= v1) beats.push(b);
  const relM = (s: number) => (m ? ((s - m.s) / m.d) * 100 : 0);

  return (
    <div className={`island ve-tl${full ? " ve-tl--full" : " ve-tl--compact"} ${p.className ?? ""}`} style={{ ...(geo?.style ?? {}), ...p.style }}>
      {geo ? <span className="ve-tl-notch" style={{ left: geo.notch }} aria-hidden="true" /> : null}
      {full ? <span className="ve-tl-grip" title="Drag to make the timeline taller" aria-hidden="true" /> : null}
      {p.noHead ? null : (
        <div className="ve-tl-hd">
          <span className={`icon-btn k-icon-sm ve-tl-play${p.playing ? " k-pressed" : ""}`} title={p.playing ? "Pause — tap space" : "Play — tap space"}>
            <VIcon name={p.playing ? "pause" : "play"} size={14} />
            {p.playTip ? <span className="ve-tip ve-tip--up">{p.playTip}</span> : null}
          </span>
          <span className={`icon-btn k-icon-sm${p.loopOn ? " k-pressed" : ""}`} title="Loop"><VIcon name="loop" size={14} /></span>
          <span className="ve-tl-time">{p.time ?? mss(p.t)} <span>/ {p.total ?? mss(p.len)}</span></span>
          <span className="ve-tl-name"><VIcon name="video" size={12} />{p.name}</span>
          {p.status}
          <span className="ve-tl-sp" />
          {p.tools ?? (
            <span className="ve-tl-tools">
              <span className="icon-btn k-icon-sm" title="Split at the playhead · S"><VIcon name="scissors" size={14} /></span>
              <span className="icon-btn k-icon-sm" title="Add text"><VIcon name="type" size={14} /></span>
              <span className="icon-btn k-icon-sm" title="Captions from speech"><VIcon name="captions" size={14} /></span>
              <span className="icon-btn k-icon-sm" title="Add music"><VIcon name="music" size={14} /></span>
            </span>
          )}
          <span className="ve-tl-div" />
          {full ? (
            <>
              <span className="ve-zoom" title="Zoom the timeline"><VIcon name="minus" size={12} /><span className="ve-zoom-bar"><b style={{ left: `${p.zoom ?? 40}%` }} /></span><VIcon name="plus" size={12} /></span>
              <span className="btn btn--ghost btn--sm">Fit</span>
              <span className="btn btn--ghost btn--sm ve-tl-size" title="Make the timeline compact"><VIcon name="compact" size={12} />Compact</span>
            </>
          ) : (
            <span className="btn btn--ghost btn--sm ve-tl-size" title="Expand the timeline"><VIcon name="expand" size={12} />Expand</span>
          )}
        </div>
      )}
      <div className="ve-tl-body">
        <div className="ve-tl-labs">
          <span className="ve-row ve-row--ruler" />
          {rows.map((r) => (
            <span key={r.id} className={`ve-row ve-lab ve-lab--${r.id}`} style={{ height: r.h }} title={r.label}>
              {r.fold ? (
                <><span className="ve-lab-tw"><VIcon name="submenu" size={10} /></span>{full ? <span className="ve-lab-n">{r.fold}</span> : null}</>
              ) : (
                <>
                  <span className="ve-lab-ic"><VIcon name={r.icon} size={12} /></span>
                  {full ? <><span className="ve-lab-n">{r.label}</span><span className="ve-lab-b">{r.btn === "volume" && r.id === "video" && p.clips.length && p.clips.every((c) => c.mute) ? <VIcon name="mute" size={12} /> : <VIcon name={r.btn ?? "view"} size={12} />}</span></> : null}
                </>
              )}
            </span>
          ))}
        </div>
        <div className="ve-tl-areawrap">
          <div className="ve-tl-area">
            {p.loop ? <span className="ve-loop-lane" style={{ left: `${X(p.loop[0])}%`, width: `${Wd(p.loop[1] - p.loop[0])}%` }} /> : null}
            <span className="ve-row ve-row--ruler">
              {p.loop ? <span className="ve-loop" style={{ left: `${X(p.loop[0])}%`, width: `${Wd(p.loop[1] - p.loop[0])}%` }} /> : null}
              {ticks.map((s, i) => (
                <span key={s} className={`ve-tick${p.frames ? " ve-tick--mono" : ""}${i === 0 && s <= v0 + 0.001 ? " ve-tick--start" : ""}${i === ticks.length - 1 && s >= v1 - 0.001 ? " ve-tick--end" : ""}`} style={{ left: `${X(s)}%` }}>
                  {p.frames ? Math.round(s * 30) : mss(s)}
                </span>
              ))}
              {p.poster !== undefined ? <span className="ve-poster-flag" style={{ left: `${X(p.poster)}%` }}><VIcon name="image" size={10} />Poster</span> : null}
              {p.markers?.map((mk) => <span key={mk.label} className="ve-marker" style={{ left: `${X(mk.t)}%` }}><VIcon name="marker" size={10} />{mk.label}</span>)}
            </span>
            {/* Text */}
            <span className={`ve-row${p.fold?.text ? " ve-row--fold" : ""}`} style={{ height: rows[0].h }}>
              {p.fold?.text ? <span className="ve-fold-bar" /> : (p.text?.length ? p.text.map(renderItem) : p.textEmpty ? <span className="ve-row-hint">{p.textEmpty}</span> : null)}
            </span>
            {/* Graphics */}
            <span className={`ve-row${p.fold?.gfx ? " ve-row--fold" : ""}`} style={{ height: rows[1].h }}>
              {p.fold?.gfx ? <span className="ve-fold-bar" /> : p.gfx?.map((g, i) => renderItem({ ...g, kind: "gfx" }, i))}
            </span>
            {/* Video */}
            <span className={`ve-row ve-row--video${!p.clips.length ? " ve-row--empty" : ""}`} style={{ height: rows[2].h }}>
              {!p.clips.length && p.videoEmpty ? <span className="ve-row-hint">{p.videoEmpty}</span> : null}
              {p.clips.map((c, i) => (
                <span key={c.n + i} className={`ve-clip${c.st ? ` ve-clip--${c.st}` : ""}${c.ai ? " ve-clip--ai" : ""}`} data-sel={c.sel ? "true" : undefined}
                  style={{ left: `calc(${X(c.s)}% + 1px)`, width: `calc(${Wd(c.d)}% - 2px)`, ...(c.shift ? { translate: `${c.shift}px -10px` } : {}) }} title={c.n}>
                  {c.st === "off" || c.st === "prep" || c.st === "ghost" || c.st === "gap" ? null : <ClipPic pic={c.pic} i={i} strip className="maude-v2 k-fixed" />}
                  {c.lab === false ? null : <span className="ve-clip-lab maude-v2 k-fixed" data-theme="light">{c.st === "off" ? <VIcon name="clock" size={11} /> : null}<span>{c.n}</span></span>}
                  {c.dur ? <span className="ve-clip-dur maude-v2 k-fixed" data-theme="light">{c.dur}</span> : null}
                  {c.mute ? <span className="ve-clip-mute maude-v2 k-fixed" data-theme="light" title="No sound"><VIcon name="mute" size={10} /></span> : null}
                  {c.pct !== undefined ? <span className="ve-prog"><b style={{ width: `${c.pct}%` }} /></span> : null}
                  {c.trim ? <span className={`ve-trim ve-trim--${c.trim}`} /> : null}
                </span>
              ))}
              {p.clips.map((c, i) => (c.join ? (
                <span key={"j" + i} className="ve-join" data-sel={c.joinSel ? "true" : undefined} style={{ left: `${X(c.s)}%` }} title={`${c.join} into ${c.n}`}><VIcon name="transition" size={11} /></span>
              ) : null))}
            </span>
            {/* Music */}
            <span className={`ve-row ve-row--music${!m ? " ve-row--empty" : ""}`}>
              {!m && p.musicEmpty ? <span className="ve-row-hint">{p.musicEmpty}</span> : null}
              {m ? (
                <span className={`ve-music${m.ai ? " ve-music--ai" : ""}`} data-sel={m.sel ? "true" : undefined} style={{ left: `calc(${X(m.s)}% + 1px)`, width: `calc(${Wd(m.d)}% - 2px)` }}>
                  <span className="ve-wave">{wave(Math.round(Wd(m.d) * 1.1), 1).map((h, i) => <i key={i} style={{ height: `${Math.round(h * 100)}%` }} />)}</span>
                  {m.duck?.length ? (
                    <svg className="ve-vol" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                      <path d={(() => {
                        let d = "M0 5";
                        m.duck!.forEach(([a, b]) => { d += ` L${relM(a) - 0.8} 5 L${relM(a)} 15 L${relM(b)} 15 L${relM(b) + 0.8} 5`; });
                        return d + " L100 5";
                      })()} />
                    </svg>
                  ) : null}
                  {m.lab === false ? null : <span className="ve-music-lab"><VIcon name="music" size={10} />{m.n}</span>}
                  {m.duck?.length && m.duckLabel ? <span className="ve-duck" style={{ left: `${(relM(m.duck[0][0]) + relM(m.duck[0][1])) / 2}%` }}>{m.duckLabel}</span> : null}
                </span>
              ) : null}
              {beats.map((b, i) => <span key={i} className={`ve-beat${i % 4 === 0 ? " ve-beat--strong" : ""}`} style={{ left: `${X(b)}%` }} />)}
            </span>
            {p.keyframes?.map((k, i) => <span key={i} className="ve-kf" data-sel={i === 1 ? "true" : undefined} style={{ left: `${X(k)}%`, top: 31 }} />)}
            {p.peerHead ? <span className="ve-peer-head" style={{ left: `${X(p.peerHead.t)}%` }} /> : null}
            {p.aiHead ? <span className="ve-head ve-head--ai" style={{ left: `${X(p.aiHead.t)}%` }}><span className="ve-head-tag">{p.aiHead.tag}</span></span> : null}
            {p.t >= v0 && p.t <= v1 ? <span className="ve-head" style={{ left: `${X(p.t)}%` }} /> : null}
            {p.over}
          </div>
          {p.pop ? <div className="ve-tl-float">{p.pop}</div> : null}
        </div>
      </div>
      {full && (p.adv !== undefined || p.foot) ? (
        <div className="ve-tl-foot">
          <span className="k-adv-btn" data-open={p.adv ? "true" : undefined}><span className="k-adv-ch" style={p.adv ? { transform: "rotate(90deg)" } : undefined}><VIcon name="submenu" size={12} /></span>Advanced</span>
          {p.foot ?? <span className="ve-tl-foot-hint">Frame numbers, codec, keyframes, the cut as code</span>}
        </div>
      ) : null}
    </div>
  );
}

/* ═══ Real content — social/video-hype ("Hype trailer"), Reels 9:16, 0:15, Hype instrumental at 120 BPM ═══ */
export const HYPE_CLIPS: Clip[] = [
  { n: "Tunel", s: 0, d: 1.5, pic: "night" },
  { n: "Tackle", s: 1.5, d: 2, pic: "crowd" },
  { n: "Touchdown", s: 3.5, d: 3, pic: "field" },
  { n: "Dron nad lajnou", s: 6.5, d: 2.5, pic: "sky" },
  { n: "Oslava", s: 9, d: 3, pic: "qb" },
  { n: "Logo", s: 12, d: 3, pic: "logo" },
];
export const HYPE_TEXT: TItem[] = [
  { n: "DŘINA", s: 1.5, d: 2 }, { n: "RYCHLOST", s: 3.5, d: 3 }, { n: "SRDCE", s: 9, d: 3 }, { n: "STAŇ SE ALLIGATOREM", s: 12, d: 3 },
];
export const HYPE_GFX: TItem[] = [{ n: "Logo v rohu", s: 0, d: 12 }, { n: "alligators.cz/nabor", s: 12.3, d: 2.7 }];
export const HYPE_MUSIC: Music = { n: "Hype instrumental · 120 BPM", s: 0, d: 15, bpm: 120 };
export const HYPE_NAME = "Hype trailer · Reels";
export const HYPE = { name: HYPE_NAME, len: 15, clips: HYPE_CLIPS, text: HYPE_TEXT, gfx: HYPE_GFX, music: HYPE_MUSIC };

/** The recap's 12 source clips — real file names from Assets › footage. [file, pic, length, left out?] */
export const SOURCE_CLIPS: [string, Pic, string, string?][] = [
  ["promo-runout-vlajka-8s.mp4", "sky", "0:08"], ["caaftv-tackle-6s.mp4", "crowd", "0:06"], ["caaftv-td-run-7s.mp4", "field", "0:07"],
  ["caaftv-celebrace-7s.mp4", "qb", "0:07"], ["caaftv-huddle-6s.mp4", "crowd", "0:06"], ["caaftv-mixzone-8s.mp4", "night", "0:08"],
  ["dron-areal-klesani-9s.mp4", "sky", "0:09", "Shaky"], ["archiv08-akce-1-6s.mp4", "field", "0:06"], ["dron-sweep-lajny-8s.mp4", "sky", "0:08"],
  ["archiv-orange-nastup-6s.mp4", "night", "0:06", "Too dark"], ["promo-tunel-4s.mp4", "night", "0:04"], ["promo-kabina-5s.mp4", "night", "0:05", "Too dark"],
];

/* ═══ Inspector ══════════════════════════════════════════════════════════════════════════════ */
export function Slider({ pct, label }: { pct: number; label: string }) {
  return <span className="ve-in-slider"><i><b style={{ width: `${pct}%` }} /><em style={{ left: `${pct}%` }} /></i>{label}</span>;
}
export function Poster({ t = "0:04", pic = "field" }: { t?: string; pic?: Pic }) {
  return (
    <span className="ve-in-poster">
      <span className="ve-in-poster-pic"><ClipPic pic={pic} className="maude-v2 k-fixed" /></span>
      {t}<span className="btn btn--ghost btn--sm">Change</span>
    </span>
  );
}
/** The one video-artboard row set (settled in the 07 fix pass; 08 lifts it): Size · Length · Poster frame ·
 *  Sound · Export. Frame rate lives under Advanced. Length follows the clips (see 07 · 5). */
export function VideoInspector({ title = HYPE_NAME, size = "Reels 9:16", length = "0:15", poster = "0:04", sound = "Hype instrumental", extra, style }: {
  title?: string; size?: string; length?: string; poster?: string; sound?: string | null; extra?: [string, ReactNode][]; style?: CSSProperties;
}) {
  return (
    <Inspector title={title} kind="Video" style={style} rows={[
      ["Size", <InSelect value={size} />],
      ["Length", <InNum value={length} icon="clock" />],
      ["Poster frame", <Poster t={poster} />],
      ["Sound", sound ? <InFill name={sound} tone="green" pct="80 %" /> : <span className="ve-in-note">None yet</span>],
      ["Export", <InButton icon="export">MP4</InButton>],
      ...(extra ?? []),
    ]} advanced={[["kind", "video"], ["fps", "30"], ["durationInFrames", "450"], ["codec", "h264"], ["poster", "frame 120"]]} />
  );
}

