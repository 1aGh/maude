/**
 * SPECIMEN — motion · maude-v2
 *
 * DEMONSTRATES: --dur-flip · --dur-soft · --dur-panel · --dur-route · --dur-spring ·
 *               --ease-out · --ease-in-out · --ease-spring · the reduced-motion contract ·
 *               the <MotionDemo role> 8-role vocabulary · <MotionTrack> · <TokenPlayback>
 * COMPOSITION:  hero = the signature motion (an island folds into its icon and unfolds
 *               from the same spot, --dur-panel · --ease-out) with a synced step strip ·
 *               8 role tiles looping on first paint · a live duration ladder · the
 *               "drop of spring" on its two playful moments (AI finished, a sticky lands)
 *               next to a right/wrong menu · curves drawn from the live tokens ·
 *               reduced-motion note. Token playback sits inside an Advanced disclosure.
 * COPY VOICE:   quiet pro — talks about the user's panels, stickies and canvases.
 *
 * TOOLING (DDR-049): every role demo is <MotionDemo role> from @maude/canvas-lib; the
 * hero and the spring moments drive canvas-lib's `motion` export with durations and
 * eases read from the live tokens. No hand-rolled keyframe rules anywhere in this file or
 * in motion.css.
 *
 * ANIMATION SAFETY (SUB-AGENT-PROMPTS.md):
 *   Bounded — every <MotionDemo> root clips itself; every stage and tile here clips again
 *   (overflow: hidden, see motion.css). The presence pulse runs on a 32 px chip only
 *   (small). Compositor-only — transform + opacity, never layout. Loops are visible on
 *   first paint. The spring is NOT a default: it appears only on playful moments.
 *
 * REDUCED MOTION: the <ReducedMotionToggle> (from ./_specimen-controls) flips
 *   data-reduced-motion="true" on <html>. motion.css answers it with the ONE allowed set
 *   of !important overrides (every --dur-* → 1ms); the JS demos stop looping, and every
 *   role tile renders its payload STATICALLY in its resting, visible state (a 1 ms
 *   round-trip remount would freeze on its last keyframe — invisible or offset). The OS
 *   setting is honoured twice — the token collapse in colors_and_type.css and motion's
 *   useReducedMotion(). Spring never touches chrome, not even as a counter-example.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./motion.css";
import { MotionDemo, MotionTrack, TokenPlayback, useMotionTokens, useReducedMotion, motion } from "@maude/canvas-lib";
import { Mark, Spark, SpecimenHeader, ReducedMotionToggle } from "./_specimen-controls";

/* ─── Token readers ──────────────────────────────────────────────────────── */

type Bezier = [number, number, number, number];
type Stop = { v: number; p: number };

const FALLBACK_OUT: Bezier = [0.25, 0.8, 0.25, 1];
const FALLBACK_IN_OUT: Bezier = [0.45, 0, 0.2, 1];
const FALLBACK_SPRING = "linear(0, 0.24 8%, 0.62 19%, 0.93 32%, 1.045 45%, 1.03 57%, 0.997 74%, 1)";

function bezierOf(raw: string | undefined, fallback: Bezier): Bezier {
  const m = /cubic-bezier\(([^)]+)\)/.exec(raw ?? "");
  if (!m) return fallback;
  const n = m[1].split(",").map((s) => Number.parseFloat(s.trim()));
  return n.length === 4 && n.every(Number.isFinite) ? (n as Bezier) : fallback;
}

/** Parses a CSS linear() easing into stops (missing percentages spread evenly, per spec). */
function stopsOf(raw: string): Stop[] {
  const m = /linear\((.*)\)/s.exec(raw);
  if (!m) return stopsOf(FALLBACK_SPRING);
  const pts = m[1].split(",").map((chunk) => {
    const [v, p] = chunk.trim().split(/\s+/);
    return { v: Number.parseFloat(v), p: p ? Number.parseFloat(p) / 100 : Number.NaN };
  });
  if (pts.length < 2 || pts.some((s) => !Number.isFinite(s.v))) return stopsOf(FALLBACK_SPRING);
  if (!Number.isFinite(pts[0].p)) pts[0].p = 0;
  if (!Number.isFinite(pts[pts.length - 1].p)) pts[pts.length - 1].p = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    if (Number.isFinite(pts[i].p)) continue;
    let j = i;
    while (!Number.isFinite(pts[j].p)) j++;
    const a = pts[i - 1].p;
    const b = pts[j].p;
    for (let k = i; k < j; k++) pts[k].p = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return pts;
}

/** The token's own curve as an easing function motion can run. */
function easeFromStops(stops: Stop[]) {
  return (t: number) => {
    if (t <= 0) return stops[0].v;
    if (t >= 1) return stops[stops.length - 1].v;
    for (let i = 1; i < stops.length; i++) {
      const b = stops[i];
      if (t <= b.p) {
        const a = stops[i - 1];
        const span = b.p - a.p;
        return span <= 0 ? b.v : a.v + ((b.v - a.v) * (t - a.p)) / span;
      }
    }
    return 1;
  };
}

function msOf(raw: string, fallback: number) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

/** --dur-spring + --ease-spring, re-read when the theme or the reduced-motion preview flips. */
function useSpringTokens() {
  const read = () => {
    if (typeof document === "undefined") return { ms: 420, stops: stopsOf(FALLBACK_SPRING) };
    const cs = getComputedStyle(document.documentElement);
    return {
      ms: msOf(cs.getPropertyValue("--dur-spring").trim(), 420),
      stops: stopsOf(cs.getPropertyValue("--ease-spring").trim() || FALLBACK_SPRING),
    };
  };
  const [snap, setSnap] = useState(read);
  useEffect(() => {
    setSnap(read());
    const obs = new MutationObserver(() => setSnap(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-reduced-motion"] });
    return () => obs.disconnect();
  }, []);
  return snap;
}

/** True when the OS asks for less motion OR the specimen toggle previews it. */
function useReducedPreview() {
  const os = useReducedMotion();
  const [attr, setAttr] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setAttr(el.dataset.reducedMotion === "true");
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["data-reduced-motion"] });
    return () => obs.disconnect();
  }, []);
  return Boolean(os) || attr;
}

/** A two-state loop: holds `on` for onMs, off for offMs. Stops when `run` is false. */
function useLoop(onMs: number, offMs: number, run: boolean, startOn = true) {
  const [on, setOn] = useState(startOn);
  useEffect(() => {
    if (!run) return;
    const id = window.setTimeout(() => setOn((v) => !v), on ? onMs : offMs);
    return () => window.clearTimeout(id);
  }, [on, run, onMs, offMs]);
  return [on, setOn] as const;
}

/* ─── Icons (1.5px rounded stroke) ───────────────────────────────────────── */

function PanelsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="2.2" />
      <line x1="10" y1="3" x2="10" y2="13" />
    </svg>
  );
}
function PointerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M4 3l9 4.5-4 1.2L8 13z" />
    </svg>
  );
}

/* The two toolbars, in CONTRACT §2 order — Edit (tools that make things inside artboards) and Preview
   (annotation only). Glyphs verbatim from iconography.tsx. The tool you're holding is muted azure
   (Share is the one solid azure). */
const GLYPH: Record<string, ReactNode> = {
  Select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  Hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  Frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  Shape: <><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>,
  Pen: <><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>,
  Text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  Image: <><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>,
  Component: <><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>,
  Sticky: <><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>,
  Comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  Marker: <><path d="M10.75 2.75l2.5 2.5-6 6-2.5-2.5z" /><path d="M4.75 8.75L3 13l4.25-1.75" /></>,
  Arrow: <path d="M3 13L13 3M7.5 3H13v5.5" />,
  Stickers: <><circle className="mo-stamp-disc" cx="8" cy="8" r="5.75" /><path d="M5.6 9.4a2.9 2.9 0 0 0 4.8 0" /><path d="M6.1 6.4h.01M9.9 6.4h.01" strokeWidth={2} /></>,
  Section: <><path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" /><path d="M5.5 6h5" /></>,
};
const EDIT_TOOLS = ["Select", "Hand", "Frame", "Shape", "Pen", "Text", "Image", "Component"];
const PREVIEW_TOOLS = ["Hand", "Sticky", "Comment", "Marker", "Arrow", "Shape", "Text", "Stickers", "Section"];

const Glyph = ({ t }: { t: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPH[t]}</svg>
);

/** Preview's tools are the playful exception (kit Toolbar mode="annotate"): a size bigger, and each may wear the
 *  object colour of what it makes — the sticky's note, the marker's ink, the Stickers yellow disc. */
function AnnotateIcon({ t }: { t: string }) {
  if (t === "Sticky") return <span className="mo-ad-note" />;
  if (t === "Marker") return <span className="mo-ad-mk"><Glyph t={t} /><i className="mo-ad-ink" /></span>;
  return <span className={t === "Stickers" ? "mo-ad-stamp" : "mo-ad-ic"}><Glyph t={t} /></span>;
}

function Toolbar({ className, active = "Select", only, mode = "edit" }: { className: string; active?: string; only?: string[]; mode?: "edit" | "preview" }) {
  const set = mode === "preview" ? PREVIEW_TOOLS : EDIT_TOOLS;
  const tools = only ? set.filter((t) => only.includes(t)) : set;
  const preview = mode === "preview";
  return (
    <div className={`island dock mo-toolbar${preview ? " mo-adock" : ""} ${className}`} role="toolbar" aria-label={preview ? "Preview toolbar" : "Toolbar"}>
      {tools.map((t, i) => (
        <span className="mo-slot" key={t}>
          <button className={`icon-btn${preview ? " mo-ad-b" : ""}`} type="button" aria-pressed={t === active} aria-label={t}>
            {preview ? <AnnotateIcon t={t} /> : <Glyph t={t} />}
          </button>
          {preview && i === 0 && t === "Hand" ? <span className="divider-v" /> : null}
        </span>
      ))}
    </div>
  );
}

/* ─── Hero — the island folds into its icon ──────────────────────────────── */

const LAYERS = ["Hero", "Headline", "Photo", "Pricing", "Footer"];
const STEPS = [
  { t: "You press ⌘\\", d: "or the panels icon" },
  { t: "The panel folds into its icon", d: "--dur-panel · --ease-out" },
  { t: "A quiet note says how to get it back", d: "--dur-soft, after the fold" },
  { t: "Press again — it unfolds from the same spot", d: "same path, played back" },
];

function FoldHero() {
  const tokens = useMotionTokens();
  const reduced = useReducedPreview();
  const [open, setOpen] = useLoop(2800, 2000, !reduced);
  // Less motion: stop on the open state, so the panel rests visible; the button still toggles it.
  useEffect(() => {
    if (reduced) setOpen(true);
  }, [reduced, setOpen]);
  const panelS = (tokens.durations["--dur-panel"] ?? 220) / 1000;
  const softS = (tokens.durations["--dur-soft"] ?? 160) / 1000;
  const easeOut = bezierOf(tokens.easings["--ease-out"], FALLBACK_OUT);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const active = open ? [3] : [0, 1, 2];

  return (
    <>
      <div className="stage mo-hero">
        <div className="mo-board">
          <div className="mo-board-img" />
          <div className="mo-board-body"><strong>We design calm software.</strong><span>A small studio in Brno.</span></div>
        </div>
        <div className="sticky sticky--yellow mo-hst1">Bigger photo in the hero?</div>
        <div className="sticky sticky--green mo-hst2">Move the CTA up</div>

        <div className="island mo-pill"><Mark size={22} /><span>Studio site</span></div>

        <div className="island mo-tr">
          <button
            className="icon-btn"
            type="button"
            aria-pressed={open}
            aria-label={open ? "Hide panels" : "Show panels"}
            aria-keyshortcuts="Meta+Backslash"
            onClick={() => setOpen((v) => !v)}
          >
            <PanelsIcon />
          </button>
          <button className="btn btn--primary" type="button">Share</button>
        </div>

        <motion.div
          className="island island--pad mo-panel"
          aria-hidden={!open}
          style={{ transformOrigin: "calc(100% - 84px) -28px" }}
          initial={false}
          animate={{ scale: open ? 1 : 0.12, opacity: open ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : panelS, ease: easeOut }}
        >
          <p className="island-title">Layers</p>
          {LAYERS.map((l, i) => (
            <div className="row-item" key={l} aria-current={i === 0 ? "true" : undefined}>
              <span className={`thumb mo-th-${i % 4}`} />
              {l}
            </div>
          ))}
        </motion.div>

        <motion.div
          className="island mo-note"
          role="status"
          initial={false}
          animate={{ opacity: open ? 0 : 1, y: open ? 6 : 0 }}
          transition={{ duration: reduced ? 0 : softS, ease: easeOut, delay: open || reduced ? 0 : panelS }}
        >
          Panels hidden. Press <span className="kbd">⌘</span><span className="kbd">\</span> to bring them back.
        </motion.div>

        <Toolbar className="mo-dock" />
      </div>

      <ol className="mo-steps" aria-label="What happens">
        {STEPS.map((s, i) => (
          <li key={s.t} data-active={active.includes(i) ? "true" : undefined}>
            <strong>{s.t}</strong>
            <span>{s.d}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ─── The role bench ─────────────────────────────────────────────────────── */

type Role = "flip" | "soft" | "panel" | "route" | "presence" | "drag" | "scroll" | "spring";

const ROLES: { role: Role; name: string; dur: string; ease: string; use: string; playful?: boolean }[] = [
  { role: "flip", name: "Flip", dur: "--dur-flip", ease: "--ease-out", use: "Hover, press, a switch flipping. Under the eye's radar." },
  { role: "soft", name: "Soft", dur: "--dur-soft", ease: "--ease-out", use: "Tooltips and the “Panels hidden” note. A fade, nothing more." },
  { role: "panel", name: "Panel", dur: "--dur-panel", ease: "--ease-in-out", use: "Panels and menus opening. The fold itself runs on --ease-out." },
  { role: "route", name: "Route", dur: "--dur-route", ease: "--ease-out", use: "Switching canvas or project tab. Fade plus a hair of scale." },
  { role: "presence", name: "Presence", dur: "--dur-soft", ease: "--ease-out", use: "The AI arriving on the canvas. A small dot, never a panel." },
  { role: "drag", name: "Drag", dur: "--dur-flip", ease: "--ease-out", use: "Picking up a sticky — a touch of tilt, square on release." },
  { role: "scroll", name: "Scroll", dur: "--dur-soft", ease: "--ease-in-out", use: "The canvas drifting as you pan under a frame." },
  {
    role: "spring",
    name: "Spring",
    dur: "canvas-lib spring",
    ease: "on --dur-panel",
    use: "Playful moments only. This tile is canvas-lib's own physics spring; the real token curve plays below.",
    playful: true,
  },
];

function RolePayload({ role }: { role: Role }) {
  switch (role) {
    case "flip":
      return <span className="mo-pl-icon"><PointerIcon /></span>;
    case "soft":
      return <span className="mo-pl-tip">Share with Tereza</span>;
    case "panel":
      return (
        <span className="island mo-pl-island">
          <span className="mo-pl-line" /><span className="mo-pl-line mo-pl-line--short" />
        </span>
      );
    case "route":
      return <span className="mo-pl-board"><span /></span>;
    case "presence":
      return <span className="mo-pl-agent"><Spark size={14} color="var(--spark-fg)" /></span>;
    case "drag":
    case "spring":
      return <span className={`mo-pl-sticky ${role === "spring" ? "mo-pl-sticky--lilac" : ""}`}>{role === "spring" ? "Done" : "Idea"}</span>;
    default:
      return <span className="mo-pl-frame" />;
  }
}

function RoleBench() {
  const reduced = useReducedPreview();
  return (
    <div className="mo-grid">
      {ROLES.map((r) => (
        <div className="mo-tile" key={r.role} data-playful={r.playful ? "true" : undefined}>
          <div className="mo-tile-hd">
            <strong>{r.name}</strong>
            {r.playful ? <span className="chip chip--spark">playful only</span> : <code>{r.dur}</code>}
          </div>
          <div className="mo-tile-stage">
            {reduced ? (
              /* Less motion: the payload at rest — visible, unscaled, unmoved. No remount, no last-keyframe freeze. */
              <div className="motion-demo mo-static" data-role={r.role} data-small={r.role === "presence" ? "true" : undefined}>
                <div className="motion-demo__target"><RolePayload role={r.role} /></div>
              </div>
            ) : (
              <MotionDemo role={r.role} loop="always" small={r.role === "presence"}>
                <RolePayload role={r.role} />
              </MotionDemo>
            )}
          </div>
          <p className="mo-tile-use">{r.use}</p>
          <code className="mo-tile-tok">{r.dur} · {r.ease}</code>
        </div>
      ))}
    </div>
  );
}

/* ─── Duration ladder ────────────────────────────────────────────────────── */

function DurationLadder() {
  const tokens = useMotionTokens();
  const spring = useSpringTokens();
  const rows = [
    { tok: "--dur-flip", ms: tokens.durations["--dur-flip"] ?? 120, use: "hover, press, toggle" },
    { tok: "--dur-soft", ms: tokens.durations["--dur-soft"] ?? 160, use: "fades, tooltips" },
    { tok: "--dur-panel", ms: tokens.durations["--dur-panel"] ?? 220, use: "panel ↔ icon, menu open" },
    { tok: "--dur-route", ms: tokens.durations["--dur-route"] ?? 280, use: "canvas switch, project tab" },
    { tok: "--dur-spring", ms: spring.ms, use: "AI finished, a sticky lands", playful: true },
  ];
  const max = Math.max(...rows.map((r) => r.ms), 1);
  return (
    <div className="mo-ladder">
      {rows.map((r) => (
        <div className="mo-rung" key={r.tok} data-playful={r.playful ? "true" : undefined}>
          <code className="mo-rung-tok">{r.tok}</code>
          <span className="mo-rung-ms">{Math.round(r.ms)} ms</span>
          <span className="mo-rung-track"><span className="mo-rung-bar" style={{ width: `${(r.ms / max) * 100}%` }} /></span>
          <span className="mo-rung-use">{r.use}</span>
        </div>
      ))}
      <p className="mo-ladder-foot">Feedback starts at once, and chrome motion ends within 280 ms. Only the playful spring takes longer.</p>
    </div>
  );
}

/* ─── A drop of spring ───────────────────────────────────────────────────── */

function AiFinished() {
  const spring = useSpringTokens();
  const reduced = useReducedPreview();
  const [landed] = useLoop(2900, 600, !reduced, false);
  const ease = easeFromStops(spring.stops);
  const show = landed || reduced;
  return (
    <figure className="mo-moment">
      <div className="stage mo-mstage">
        {["coral", "sky", "yellow"].map((c, i) => (
          <motion.div
            key={c}
            className={`mo-variant mo-v-${c}`}
            initial={false}
            animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.86, y: show ? 0 : 10 }}
            transition={show && !reduced ? { duration: spring.ms / 1000, ease, delay: i * 0.05 } : { duration: 0 }}
          >
            <span className="mo-variant-img" />
            <span className="mo-variant-cap">Hero {i + 1}</span>
          </motion.div>
        ))}
        <div className="island island--pad mo-ai">
          <span className="mo-ai-hd"><Spark size={12} color="var(--spark)" /> AI</span>
          <span>Done — three hero variants are on the canvas. Pick one.</span>
        </div>
      </div>
      <figcaption><strong>AI finished.</strong> The variants land with a small overshoot — the one moment the app is allowed to look pleased.</figcaption>
    </figure>
  );
}

function StickyLands() {
  const spring = useSpringTokens();
  const reduced = useReducedPreview();
  const [landed] = useLoop(2600, 600, !reduced, false);
  const ease = easeFromStops(spring.stops);
  const show = landed || reduced;
  return (
    <figure className="mo-moment">
      <div className="stage mo-mstage">
        <motion.div
          className="sticky sticky--yellow mo-drop"
          initial={false}
          animate={{ opacity: show ? 1 : 0, y: show ? 0 : -34, rotate: show ? -2 : -9, scale: show ? 1 : 1.06 }}
          transition={show && !reduced ? { duration: spring.ms / 1000, ease } : { duration: 0 }}
        >
          Ask Jonas about the footer
        </motion.div>
        <Toolbar className="mo-mdock" mode="preview" active="Sticky" only={["Hand", "Sticky", "Comment", "Marker", "Arrow", "Text"]} />
      </div>
      <figcaption><strong>A sticky lands.</strong> Paper-light: it drops, settles with a tilt, done. Shapes and frames don't do this.</figcaption>
    </figure>
  );
}

/* Chrome motion, right and wrong. The wrong case is SLOW and FAR, never springy — spring
   stays off chrome everywhere, counter-examples included. */
function MenuCompare() {
  const tokens = useMotionTokens();
  const reduced = useReducedPreview();
  const [open] = useLoop(2400, 900, !reduced);
  const show = open || reduced;
  const panelS = (tokens.durations["--dur-panel"] ?? 220) / 1000;
  const easeOut = bezierOf(tokens.easings["--ease-out"], FALLBACK_OUT);
  const easeInOut = bezierOf(tokens.easings["--ease-in-out"], FALLBACK_IN_OUT);
  const cases = [
    { ok: true, t: { duration: reduced ? 0 : panelS, ease: easeOut }, from: { scale: 0.94, y: -4 } },
    { ok: false, t: { duration: reduced ? 0 : panelS * 3, ease: easeInOut }, from: { scale: 0.6, y: 48 } },
  ];
  const items = ["Back to Home", "File", "Version history", "Share…"];
  return (
    <div className="mo-compare">
      {cases.map(({ ok, t, from }) => (
        <figure className="mo-case" key={String(ok)}>
          <div className="stage mo-cstage">
            <div className="island mo-ctrigger"><Mark size={18} /><span>Studio site</span></div>
            <motion.div
              className="island mo-menu"
              style={{ transformOrigin: "top left" }}
              initial={false}
              animate={{ opacity: show ? 1 : 0, scale: show ? 1 : from.scale, y: show ? 0 : from.y }}
              transition={t}
            >
              {items.map((it) => <div className="row-item" key={it}>{it}</div>)}
            </motion.div>
          </div>
          <figcaption>
            <strong className={ok ? "mo-ok" : "mo-bad"}>{ok ? "Right" : "Wrong"}</strong>
            {ok
              ? " The menu opens on --dur-panel · --ease-out. Short, close, and out of mind at once."
              : " Three times as long, from far below. Chrome that travels makes every open cost a beat."}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ─── Curves drawn from the live tokens ──────────────────────────────────── */

function Curve({ label, note, d, overshoot }: { label: string; note: string; d: string; overshoot?: boolean }) {
  return (
    <figure className="mo-curve">
      <svg viewBox="-6 -18 112 126" aria-hidden="true">
        <rect x="0" y="0" width="100" height="100" rx="4" className="mo-curve-bg" />
        <path d="M0 0H100" className="mo-curve-one" />
        <path d="M0 100L100 0" className="mo-curve-diag" />
        <path d={d} className={overshoot ? "mo-curve-path mo-curve-path--spring" : "mo-curve-path"} />
      </svg>
      <figcaption><code>{label}</code><span>{note}</span></figcaption>
    </figure>
  );
}

function Curves() {
  const tokens = useMotionTokens();
  const spring = useSpringTokens();
  const cubic = (b: Bezier) => `M0 100C${b[0] * 100} ${100 - b[1] * 100} ${b[2] * 100} ${100 - b[3] * 100} 100 0`;
  const out = bezierOf(tokens.easings["--ease-out"], FALLBACK_OUT);
  const inOut = bezierOf(tokens.easings["--ease-in-out"], FALLBACK_IN_OUT);
  const springD = spring.stops.map((s, i) => `${i === 0 ? "M" : "L"}${(s.p * 100).toFixed(1)} ${(100 - s.v * 100).toFixed(1)}`).join(" ");
  const peak = Math.max(...spring.stops.map((s) => s.v));
  return (
    <div className="mo-curves">
      <Curve label="--ease-out" note={`${out.join(", ")} — almost everything`} d={cubic(out)} />
      <Curve label="--ease-in-out" note={`${inOut.join(", ")} — moves that start and end on screen`} d={cubic(inOut)} />
      <Curve label="--ease-spring" note={`peaks at ${peak.toFixed(3)}, settles by the last stop — the drop of spring`} d={springD} overshoot />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function Motion() {
  return (
    <>
      <SpecimenHeader crumbs={["Foundations", "Motion"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Gentle by default. A drop of spring when something lands.</h1>
          <p className="lede">
            Motion here mostly says “this went over there”. Panels fold into their icon, menus open,
            canvases swap — all quick and quiet. The spring is kept for two moments that deserve a
            smile: the AI finishing, and a sticky landing on the canvas.
          </p>
        </section>

        <div className="mo-controls">
          <dl className="specimen-meta mo-meta">
            <div><dt>Durations</dt><dd>120 · 160 · 220 · 280 · 420 ms</dd></div>
            <div><dt>Eases</dt><dd>out · in-out · spring</dd></div>
            <div><dt>Spring</dt><dd>playful moments only</dd></div>
            <div><dt>Reduced motion</dt><dd>every duration → 1 ms</dd></div>
          </dl>
          <div className="island mo-rm">
            <span>Preview</span>
            <ReducedMotionToggle />
          </div>
        </div>

        <h2 data-no>Fold into an icon<span className="h2-aside">the signature move · --dur-panel · --ease-out</span></h2>
        <p>
          Any panel can fold into the one icon that brings it back. It shrinks toward that icon, so you
          always know where it went — and it unfolds from the same spot. Try the panels icon, or press{" "}
          <span className="kbd">⌘</span> <span className="kbd">\</span> anywhere on this page.
        </p>
        <FoldHero />

        <h2 data-no>Eight roles<span className="h2-aside">every animation maps to one · looping on first paint</span></h2>
        <RoleBench />

        <h2 data-no>Durations<span className="h2-aside">read live from the tokens</span></h2>
        <DurationLadder />
        <details className="mo-adv">
          <summary>Advanced — replay one token</summary>
          <p>Each chip fires its token once, at the value the page is using right now.</p>
          <MotionTrack staggerMs={40}>
            <TokenPlayback duration="--dur-flip" easing="--ease-out" label="--dur-flip" />
            <TokenPlayback duration="--dur-soft" easing="--ease-out" label="--dur-soft" />
            <TokenPlayback duration="--dur-panel" easing="--ease-out" label="--dur-panel" />
            <TokenPlayback duration="--dur-route" easing="--ease-out" label="--dur-route" />
          </MotionTrack>
          <p className="mo-adv-note"><code>--dur-spring</code> runs on <code>--ease-spring</code>, so it plays in the moments below rather than as a chip.</p>
        </details>

        <h2 data-no>A drop of spring<span className="h2-aside">--dur-spring · --ease-spring · playful moments only</span></h2>
        <p>
          The spring overshoots by a few percent and settles. That is only right when something
          arrives on the canvas and it's worth a small smile. Panels, menus, tooltips, switches and
          canvas changes never get it.
        </p>
        <div className="mo-moments">
          <AiFinished />
          <StickyLands />
        </div>
        <MenuCompare />

        <h2 data-no>Curves<span className="h2-aside">drawn from the live token values</span></h2>
        <Curves />

        <h2 data-no>Less motion<span className="h2-aside">when the Mac asks for it</span></h2>
        <div className="mo-rm-grid">
          <div className="mo-rm-card"><strong>Durations collapse</strong><span>Every <code>--dur-*</code> becomes 1 ms, so panels still fold and menus still open — instantly.</span></div>
          <div className="mo-rm-card"><strong>Loops stop</strong><span>Nothing repeats. AI still says it's done; the variants are simply there, at rest.</span></div>
          <div className="mo-rm-card"><strong>Nothing is lost</strong><span>Every state change still happens and still reads. Motion explains; it never carries meaning alone.</span></div>
        </div>
        <p className="mo-rm-foot">Use the Preview switch at the top to see this page with less motion, without changing your Mac's settings.</p>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · motion</span>
        <span>Tooling: MotionDemo · MotionTrack · TokenPlayback from @maude/canvas-lib</span>
      </footer>
    </>
  );
}
