/**
 * SPECIMEN — components-resize-panels · maude-v2
 *
 * DEMONSTRATES: how v2 panels behave. The default is FLOATING: each panel is an .island over the
 *   canvas that folds into its own icon (per panel, or all at once with ⌘\ — "Hide panels") and
 *   unfolds from the same spot — transform + opacity on --dur-panel · --ease-out. The ADVANCED
 *   option is DOCKED (Menu › View › Advanced › "Pin panels to the side", CONTRACT.md §1): flush side
 *   panels with drag handles (the reference template's split-pane resizer) — and that is the only
 *   place resize handles exist. Handle = 1 px hairline in an 8 px hit area, --accent on
 *   hover / drag / focus, min and max per panel, double-click resets, arrow keys move 8 (⇧ 32),
 *   Home / End jump to min / max, widths remembered.
 * COMPOSITION: hero = a live floating stage — fold any island, ⌘\ folds all, a dashed ghost shows
 *   where a folded island will come back · four folded states side by side · the Advanced
 *   "Panel layout" setting driving a live docked layout with working handles · the handle up close
 *   (rest / hover / dragging) with its limits and keys · right / wrong.
 * COPY VOICE: the user's panels and canvases — "Canvases", "Inspector", "Homepage". UI words from
 *   CONTRACT.md: panel, toolbar, Hide panels / Show panels, AI chat panel. No pixel jargon outside the
 *   handle's own readout. Static mini stages are inert (no tab stops); the live hero stays reachable.
 * WHEN SCAFFOLDED: platform-desktop. Reference: platform-desktop/components-resize-panels.html —
 *   its always-docked 3-pane layout is demoted to an opt-in Advanced mode; floating is the default.
 * NOTES: ANIMATION SAFETY — fold/unfold are transform + opacity only; docked resizing is direct
 *   manipulation (width follows the pointer, nothing animates layout); every stage clips
 *   (overflow: hidden); reduced motion collapses --dur-* to 1 ms. RELATIVE-URL SAFETY — no assets,
 *   all icons inline. Widths persist in localStorage, wrapped in try/catch, so the page works without it.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import "./_layout.css";
import "./components-resize-panels.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — maude-v2 family, 16 grid, 1.5 rounded stroke ──────────────── */
const G: Record<string, ReactNode> = {
  "panel-left": (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M6 3v10" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M10 3v10" />
    </>
  ),
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  pen: (
    <>
      <path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" />
      <path d="M8.75 4.75l2.5 2.5" />
    </>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12.5" cy="8" r="1.15" />
    </g>
  ),
  sticky: (
    <>
      <path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" />
      <path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" />
    </>
  ),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  shape: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" />
      <circle cx="10.25" cy="10.25" r="3.5" />
    </>
  ),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  "chevron-r": <path d="M6.25 4.5L9.75 8l-3.5 3.5" />,
};
function Ic({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg
      className="rp-ic"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {G[id]}
    </svg>
  );
}

/* ─── The Edit toolbar — order + keys from CONTRACT.md §2 (lifted from the desktop showcase) ── */
const TOOLS = [
  { id: "select", label: "Select", key: "V" },
  { id: "hand", label: "Hand", key: "H" },
  { id: "frame", label: "Frame", key: "F" },
  { id: "shape", label: "Shape", key: "R" },
  { id: "pen", label: "Pen", key: "P" },
  { id: "text", label: "Text", key: "T" },
  { id: "image", label: "Image", key: "I" },
  { id: "component", label: "Component", key: "Shift+I" },
];

function Toolbar({ className }: { className: string }) {
  return (
    <div className={`island dock ${className}`} role="toolbar" aria-label="Toolbar">
      {TOOLS.map((t, i) => (
        <button key={t.id} className="icon-btn" type="button" aria-pressed={i === 0} aria-label={t.label} aria-keyshortcuts={t.key}>
          <Ic id={t.id} size={18} />
        </button>
      ))}
      <span className="divider-v" />
      <button className="icon-btn" type="button" aria-label="More tools: Line, Ellipse, Polygon, Crop, Export area">
        <Ic id="more" size={18} />
      </button>
    </div>
  );
}

const HIDDEN_NOTE = "Panels hidden. Press ⌘\\ to bring them back.";

/* ─── A slice of canvas — what the panels float over ─────────────────────── */
function Board() {
  return (
    <>
      <div className="rp-board" aria-hidden="true">
        <span className="rp-board-name">Homepage</span>
        <span className="rp-board-hero">
          <i />
        </span>
        <span className="rp-board-line" />
        <span className="rp-board-line rp-board-line--s" />
        <span className="rp-board-cta" />
      </div>
      <div className="sticky sticky--yellow rp-st1" aria-hidden="true">
        Bigger photo in the hero?
      </div>
      <div className="sticky sticky--green rp-st2" aria-hidden="true">
        Move the CTA up
      </div>
    </>
  );
}

const CANVASES = [
  { n: "Homepage", c: "coral", cur: true },
  { n: "Pricing", c: "green" },
  { n: "Onboarding", c: "yellow" },
  { n: "Mobile — detail", c: "lilac" },
];

type Folds = { left: boolean; right: boolean; ai: boolean };
const NONE: Folds = { left: false, right: false, ai: false };
const ALL: Folds = { left: true, right: true, ai: true };

/** The floating stage. Static (inert, a picture) when no handlers are passed. */
function FloatStage({ f, ghost = false, on }: { f: Folds; ghost?: boolean; on?: { left?: () => void; right?: () => void; ai?: () => void } }) {
  const zen = f.left && f.right && f.ai;
  const live = !!on;
  return (
    <div className="stage rp-stage" inert={!live} aria-hidden={live ? undefined : true}>
      <Board />

      {/* Each island sits in a slot of its own size; a dashed ghost marks where a folded island comes back. */}
      <div className="rp-slot rp-slot--left">
        {ghost && f.left ? <span className="rp-ghost" aria-hidden="true" /> : null}
        <div className="island island--pad rp-left rp-fold rp-fold--tl" data-folded={f.left ? "true" : undefined} aria-hidden={f.left}>
          <div className="rp-hd">
            <span>Canvases</span>
            <button className="icon-btn rp-ib" type="button" aria-label="Hide Canvases" onClick={on?.left}>
              <Ic id="panel-left" />
            </button>
          </div>
          {CANVASES.map((c) => (
            <div className="row-item" key={c.n} aria-current={c.cur ? "true" : undefined}>
              <span className={`thumb rp-th-${c.c}`} />
              {c.n}
            </div>
          ))}
        </div>
        <div className="island rp-icon rp-icon--tl rp-unfold" data-shown={f.left ? "true" : undefined} aria-hidden={!f.left}>
          <button className="icon-btn" type="button" aria-label="Show Canvases" onClick={on?.left}>
            <Ic id="panel-left" />
          </button>
        </div>
      </div>

      <div className="rp-slot rp-slot--right">
        {ghost && f.right ? <span className="rp-ghost" aria-hidden="true" /> : null}
        <div className="island island--pad rp-right rp-fold rp-fold--tr" data-folded={f.right ? "true" : undefined} aria-hidden={f.right}>
          <div className="rp-hd">
            <span>
              Homepage <span className="rp-hd-sub">Artboard</span>
            </span>
            <button className="icon-btn rp-ib" type="button" aria-label="Hide the inspector" onClick={on?.right}>
              <Ic id="panel-right" />
            </button>
          </div>
          <div className="rp-row">
            <span>Size</span>
            <span className="rp-val">1440 × 1600</span>
          </div>
          <div className="rp-row">
            <span>Fill</span>
            <span className="rp-val">
              <i className="rp-sw" />
              White
            </span>
          </div>
          <div className="rp-row">
            <span>Corners</span>
            <span className="rp-val">0</span>
          </div>
          <div className="rp-adv">
            <Ic id="chevron-r" size={12} />
            Advanced<span className="rp-adv-n">6 properties</span>
          </div>
        </div>
        <div className="island rp-icon rp-icon--tr rp-unfold" data-shown={f.right ? "true" : undefined} aria-hidden={!f.right}>
          <button className="icon-btn" type="button" aria-label="Show the inspector" onClick={on?.right}>
            <Ic id="panel-right" />
          </button>
        </div>
      </div>

      <div className="rp-slot rp-slot--ai">
        {ghost && f.ai ? <span className="rp-ghost" aria-hidden="true" /> : null}
        <div className="island island--pad rp-ai rp-fold rp-fold--br" data-folded={f.ai ? "true" : undefined} aria-hidden={f.ai}>
          <div className="rp-hd">
            <span className="rp-ai-name">
              <Spark size={13} color="var(--spark)" /> AI
            </span>
            <button className="icon-btn rp-ib" type="button" aria-label="Hide the AI chat panel" onClick={on?.ai}>
              <Ic id="chevron" size={14} />
            </button>
          </div>
          <div className="ask">
            <span className="chip chip--accent">
              <span aria-hidden="true">◆ </span>Homepage
            </span>
            <input aria-label="Ask AI" placeholder="Ask AI…" />
            <span className="send" aria-hidden="true">
              <Spark size={12} color="var(--spark-fg)" />
            </span>
          </div>
        </div>
        <div className="island rp-icon rp-icon--br rp-unfold" data-shown={f.ai ? "true" : undefined} aria-hidden={!f.ai}>
          <button className="icon-btn" type="button" aria-label="Show the AI chat panel" onClick={on?.ai}>
            <Spark size={16} color="var(--spark)" />
          </button>
        </div>
      </div>

      <Toolbar className="rp-dock" />

      {zen ? (
        <div className="island rp-note" role="status">
          {HIDDEN_NOTE}
        </div>
      ) : null}
    </div>
  );
}

/* ─── 1 · live hero ──────────────────────────────────────────────────────── */
function FloatHero() {
  const [f, setF] = useState<Folds>(NONE);
  const [ghost, setGhost] = useState(true);
  const zen = f.left && f.right && f.ai;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setF((cur) => (cur.left && cur.right && cur.ai ? NONE : ALL));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flip = (k: keyof Folds) => () => setF((cur) => ({ ...cur, [k]: !cur[k] }));
  const word = (k: keyof Folds) => (f[k] ? "hidden" : "shown");

  return (
    <>
      <div className="rp-controls" role="group" aria-label="Hide a panel">
        <button type="button" className={`btn btn--sm ${f.left ? "" : "btn--ghost"}`} aria-pressed={f.left} onClick={flip("left")}>
          Canvases
        </button>
        <button type="button" className={`btn btn--sm ${f.right ? "" : "btn--ghost"}`} aria-pressed={f.right} onClick={flip("right")}>
          Inspector
        </button>
        <button type="button" className={`btn btn--sm ${f.ai ? "" : "btn--ghost"}`} aria-pressed={f.ai} onClick={flip("ai")}>
          AI chat panel
        </button>
        <button type="button" className={`btn btn--sm ${zen ? "" : "btn--ghost"}`} aria-pressed={zen} onClick={() => setF(zen ? NONE : ALL)}>
          Hide panels <span className="kbd">⌘\</span>
        </button>
        <span className="rp-sp" />
        <label className="rp-toggle">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={ghost}
            aria-label="Show where it comes back"
            onClick={() => setGhost((g) => !g)}
          />
          Show where it comes back
        </label>
      </div>
      <FloatStage f={f} ghost={ghost} on={{ left: flip("left"), right: flip("right"), ai: flip("ai") }} />
      <p className="rp-state" role="status">
        Canvases {word("left")} · inspector {word("right")} · AI chat panel {word("ai")}
      </p>
    </>
  );
}

/* ─── 2 · four folded states ─────────────────────────────────────────────── */
const STATES: { f: Folds; t: string; d: string }[] = [
  { f: { ...NONE, left: true }, t: "Canvases hidden", d: "Its icon stays top-left. Click it, or press ⌘\\ twice." },
  { f: { ...NONE, right: true }, t: "Inspector hidden", d: "It comes back by itself the next time you select something." },
  { f: { ...NONE, ai: true }, t: "AI chat panel hidden", d: "The spark stays. A dot on it means AI is still working." },
  { f: ALL, t: "All panels hidden", d: "⌘\\ — the canvas alone. The note shows once, then fades." },
];

/* ─── 3 · docked (Advanced) ──────────────────────────────────────────────── */
type Lim = { min: number; def: number; max: number };
const LEFT: Lim = { min: 200, def: 240, max: 340 };
const RIGHT: Lim = { min: 240, def: 280, max: 380 };
const KEY = "maude-v2:design:resize-panels";
const clamp = (v: number, l: Lim) => Math.max(l.min, Math.min(l.max, Math.round(v)));

function readWidths(): [number, number] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (raw) {
      const [a, b] = JSON.parse(raw) as [number, number];
      return [clamp(a, LEFT), clamp(b, RIGHT)];
    }
  } catch {
    /* storage unavailable — defaults */
  }
  return [LEFT.def, RIGHT.def];
}

function Handle({ label, value, lim, dir, onChange }: { label: string; value: number; lim: Lim; dir: 1 | -1; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [drag, setDrag] = useState(false);

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: value };
    setDrag(true);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    onChange(clamp(start.current.w + dir * (e.clientX - start.current.x), lim));
  }
  function up() {
    start.current = null;
    setDrag(false);
  }
  function key(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp(value - dir * step, lim));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp(value + dir * step, lim));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(lim.min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(lim.max);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onChange(lim.def);
    }
  }

  return (
    <div
      className="rp-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={lim.min}
      aria-valuemax={lim.max}
      aria-valuenow={value}
      tabIndex={0}
      data-drag={drag ? "true" : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onChange(lim.def)}
      onKeyDown={key}
      title="Drag to resize · double-click to reset"
    >
      <span className="rp-handle-line" />
      {drag ? (
        <span className="rp-handle-tip">
          {value}
          {value === lim.min ? " · min" : value === lim.max ? " · max" : ""}
        </span>
      ) : null}
    </div>
  );
}

const LAYERS: { n: string; icon: string; depth: number; cur?: boolean }[] = [
  { n: "Homepage", icon: "frame", depth: 0 },
  { n: "Hero", icon: "frame", depth: 1, cur: true },
  { n: "Headline", icon: "text", depth: 2 },
  { n: "Photo", icon: "shape", depth: 2 },
  { n: "Book a call", icon: "shape", depth: 2 },
  { n: "Footer", icon: "frame", depth: 1 },
  { n: "Bigger photo in the hero?", icon: "sticky", depth: 0 },
];

function Docked() {
  const [[l, r], setW] = useState<[number, number]>(() => readWidths());
  useEffect(() => {
    try {
      window.localStorage?.setItem(KEY, JSON.stringify([l, r]));
    } catch {
      /* storage unavailable — widths just won't be remembered */
    }
  }, [l, r]);

  return (
    <>
      <div className="rp-docked" style={{ gridTemplateColumns: `${l}px 8px minmax(0, 1fr) 8px ${r}px` }}>
        <aside className="rp-pane" aria-label="Layers">
          <div className="rp-pane-hd">
            Layers <span className="chip">Advanced</span>
          </div>
          {LAYERS.map((x) => (
            <div className="row-item rp-layer" key={x.n} aria-current={x.cur ? "true" : undefined} style={{ paddingLeft: `${8 + x.depth * 14}px` }}>
              <span className="rp-layer-ic">
                <Ic id={x.icon} size={14} />
              </span>
              {x.n}
            </div>
          ))}
        </aside>
        <Handle label="Resize the Layers panel" value={l} lim={LEFT} dir={1} onChange={(v) => setW(([, b]) => [v, b])} />
        <section className="rp-dcanvas" aria-label="Canvas">
          <div className="rp-dboard" aria-hidden="true">
            <span className="rp-board-hero">
              <i />
            </span>
            <span className="rp-board-line" />
            <span className="rp-board-line rp-board-line--s" />
            <span className="rp-dsel" />
          </div>
          <Toolbar className="rp-ddock" />
        </section>
        <Handle label="Resize the Inspector" value={r} lim={RIGHT} dir={-1} onChange={(v) => setW(([a]) => [a, v])} />
        <aside className="rp-pane" aria-label="Inspector">
          <div className="rp-pane-hd">
            Hero <span className="rp-hd-sub">Frame</span>
          </div>
          <div className="rp-row">
            <span>Size</span>
            <span className="rp-val">1440 × 720</span>
          </div>
          <div className="rp-row">
            <span>Layout</span>
            <span className="rp-val">Column · 24</span>
          </div>
          <div className="rp-row">
            <span>Fill</span>
            <span className="rp-val">
              <i className="rp-sw rp-sw--sky" />
              Sky
            </span>
          </div>
          <div className="rp-row">
            <span>Clip content</span>
            <span className="rp-val">On</span>
          </div>
        </aside>
      </div>
      <div className="rp-readout">
        <span className="chip">Layers {l}</span>
        <span className="chip">Inspector {r}</span>
        <span className="rp-readout-hint">Drag a handle · double-click resets · focus it and use ← → (⇧ for bigger steps) · remembered for this project</span>
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setW([LEFT.def, RIGHT.def])}>
          Reset both
        </button>
      </div>
    </>
  );
}

/** Menu › View, Advanced open — "Pin panels to the side" is the switch (CONTRACT.md §1). */
const VIEW_ADV = ["Layers as a panel", "Inspector", "Timeline", "Minimap"];
const VIEW_KEYS: Record<string, string> = { Inspector: "⇧⌘I", Timeline: "⇧⌘T" };

function LayoutSetting() {
  const [docked, setDocked] = useState(true);
  const labelId = useId();
  return (
    <>
      <div className="rp-setting-row">
        <div className="rp-setting rp-menu" role="group" aria-label="Menu › View">
          <p className="rp-menu-path">
            <span className="chip">Menu › View</span>
          </p>
          <div className="row-item rp-mrow">
            <span>Hide panels</span>
            <span className="rp-mkeys">⌘\</span>
          </div>
          <div className="row-item rp-mrow">
            <span>Comments</span>
            <span className="rp-mkeys">⇧⌘M</span>
          </div>
          <span className="rp-msep" />
          <div className="rp-adv rp-adv--open">
            <Ic id="chevron" size={12} />
            Advanced
          </div>
          <div className="rp-adv-body">
            {VIEW_ADV.map((x) => (
              <div className="row-item rp-mrow rp-mrow--quiet" key={x}>
                <span>{x}</span>
                {VIEW_KEYS[x] ? <span className="rp-mkeys">{VIEW_KEYS[x]}</span> : null}
              </div>
            ))}
            <div className="row-item rp-mrow rp-mrow--on">
              <span id={labelId}>Pin panels to the side</span>
              <button type="button" role="switch" className="switch" aria-checked={docked} aria-labelledby={labelId} onClick={() => setDocked((d) => !d)} />
            </div>
            <p className="rp-setting-hint">Off by default. Panels stay fixed to the sides, and you can drag their width.</p>
          </div>
        </div>
        <p className="rp-setting-note">
          Some people want the room fixed — a layers tree that never moves, an inspector at a set width. That's an Advanced choice under Menu › View, remembered
          per project, and it's the only layout with resize handles. Try the switch.
        </p>
      </div>
      {docked ? (
        <Docked />
      ) : (
        <div className="rp-floating-note">
          <FloatStage f={NONE} />
          <p className="rp-state">Floating — no handles. Panels keep their own size; hide them instead.</p>
        </div>
      )}
    </>
  );
}

/* ─── 4 · the handle up close ───────────────────────────────────────────── */
const KEYS: [string, string][] = [
  ["Drag", "width follows the pointer, no easing"],
  ["Double-click", "back to the default width"],
  ["← →", "8 at a time · with ⇧, 32"],
  ["Home · End", "jump to the narrowest · widest"],
  ["↵", "back to the default width"],
];

export default function ComponentsResizePanels() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Panels"]} />
      <main className="specimen rp-page">
        <section className="specimen-title">
          <h1>Panels float. Hide them, or dock them to the side if you want the room fixed.</h1>
          <p className="lede">
            By default every panel floats over your canvas. You don't size it — it folds into its icon and comes back from the same spot. Docking panels to the
            side is an Advanced choice, and only docked panels get a handle to drag.
          </p>
        </section>

        <dl className="specimen-meta">
          <div>
            <dt>Default</dt>
            <dd>floating panels</dd>
          </div>
          <div>
            <dt>Hide</dt>
            <dd>per panel · all with ⌘\</dd>
          </div>
          <div>
            <dt>Docked</dt>
            <dd>Menu › View › Advanced · off by default</dd>
          </div>
          <div>
            <dt>Resize handles</dt>
            <dd>docked only</dd>
          </div>
        </dl>

        <h2 data-no>
          Float and fold<span className="h2-aside">live — hide any panel, or press ⌘\</span>
        </h2>
        <FloatHero />

        <h2 data-no>
          Hide one, keep the rest<span className="h2-aside">each panel remembers its own state</span>
        </h2>
        <div className="rp-states">
          {STATES.map((s) => (
            <figure className="rp-case" key={s.t}>
              <div className="rp-mini">
                <div className="rp-mini-in">
                  <FloatStage f={s.f} ghost />
                </div>
              </div>
              <figcaption>
                <strong>{s.t}</strong>
                {s.d}
              </figcaption>
            </figure>
          ))}
        </div>

        <h2 data-no>
          Docked panels<span className="h2-aside">an Advanced option, off by default — the only place panels resize</span>
        </h2>
        <LayoutSetting />

        <h2 data-no>
          The handle, up close<span className="h2-aside">1 px you see, 8 px you can grab</span>
        </h2>
        <div className="rp-anat">
          <div className="rp-anat-states">
            {[
              { k: "Rest", s: "rest", d: "A hairline — the seam between panel and canvas." },
              { k: "Hover", s: "hover", d: "Turns azure and 2 px; the pointer becomes ↔." },
              { k: "Dragging", s: "drag", d: "Stays azure; a small tag shows the width and the limit." },
            ].map((x) => (
              <figure className="rp-anat-case" key={x.k}>
                <div className="rp-anat-stage" aria-hidden="true">
                  <span className="rp-anat-pane" />
                  <span className={`rp-handle rp-handle--demo rp-handle--${x.s}`}>
                    <span className="rp-handle-line" />
                    <span className="rp-hit" />
                    {x.s === "drag" ? <span className="rp-handle-tip">340 · max</span> : null}
                  </span>
                  <span className="rp-anat-canvas" />
                </div>
                <figcaption>
                  <strong>{x.k}</strong>
                  {x.d}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="rp-anat-side">
            <table className="rp-limits">
              <caption>Limits</caption>
              <thead>
                <tr>
                  <th scope="col">Panel</th>
                  <th scope="col">Min</th>
                  <th scope="col">Default</th>
                  <th scope="col">Max</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Layers</th>
                  <td>{LEFT.min}</td>
                  <td>{LEFT.def}</td>
                  <td>{LEFT.max}</td>
                </tr>
                <tr>
                  <th scope="row">Inspector</th>
                  <td>{RIGHT.min}</td>
                  <td>{RIGHT.def}</td>
                  <td>{RIGHT.max}</td>
                </tr>
                <tr>
                  <th scope="row">Canvas</th>
                  <td colSpan={3}>whatever is left — never under 320</td>
                </tr>
              </tbody>
            </table>
            <dl className="rp-keys">
              {KEYS.map(([k, d]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <h2 data-no>Right and wrong</h2>
        <div className="rp-compare">
          <figure className="rp-case">
            <div className="rp-mini">
              <div className="rp-mini-in">
                <FloatStage f={{ ...NONE, right: true }} />
              </div>
            </div>
            <figcaption>
              <strong className="rp-ok">Right</strong> Floating panels with no grips. A panel that's in the way folds into its icon.
            </figcaption>
          </figure>
          <figure className="rp-case">
            <div className="rp-wrong" aria-hidden="true">
              <span className="rp-w-bar" />
              <span className="rp-w-side">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="rp-w-grip rp-w-grip--l" />
              <span className="rp-w-canvas">
                <span className="rp-w-board" />
              </span>
              <span className="rp-w-grip rp-w-grip--r" />
              <span className="rp-w-side">
                <i />
                <i />
                <i />
              </span>
              <span className="rp-w-status" />
            </div>
            <figcaption>
              <strong className="rp-bad">Wrong</strong> Docked bars and grips as the default — the canvas boxed in on four sides before you've drawn anything.
            </figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · panels — float, fold, dock</span>
        <span>Resize handles exist only with Menu › View › Advanced › Pin panels to the side</span>
      </footer>
    </>
  );
}
