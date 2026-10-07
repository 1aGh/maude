/**
 * SPECIMEN — components-list · maude-v2
 *
 * DEMONSTRATES: lists that live inside islands — the canvas list (real thumbnails, pinned,
 *   current, comments, who's here, the AI at work), the layers list (nesting with indent
 *   guides, disclosure, type icons; hide and lock appear on hover and stay pinned once set)
 *   and recents (grouped by when, across projects). Rows are short (30–36 px), airy inside.
 * COMPOSITION: hero = two islands over a slice of the canvas, wired to the artboard — pick a
 *   layer and the canvas outlines it; hide one and it leaves the artboard. The layers island
 *   carries its own "Advanced" fold (element id, class) — Advanced is a layer inside the
 *   panel, never a mode. Then the canvas-row states with a list/grid switch, the layers
 *   anatomy, recents, and a right/wrong pair.
 * COPY VOICE: the user's canvases and layers by name, people by first name ("You", Tereza, Jonas),
 *   times per CONTRACT.md §4 — relative first, then "2 Oct, 11:20".
 * NOTES: selection = --accent-muted on the one current row (the canvas you are on, the layer
 *   you picked). Thumbnails and avatars carry the object colours; chrome stays neutral.
 *   No paths, no change badges, no counts of artboards in the default view.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./components-list.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — maude-v2 family, 16 grid, 1.5 rounded stroke ──────────────── */
const G: Record<string, ReactNode> = {
  search: (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>),
  chev: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 2-1.5 2.75 2.25" /></>),
  sticky: (<><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>),
  eye: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  eyeoff: (<><path d="M3.25 5.25C2.25 6.4 1.75 8 1.75 8S4 12.25 8 12.25c1.1 0 2.1-.3 2.9-.8M6 3.95A6 6 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8s-.5 1-1.4 2" /><path d="M2.5 2.5l11 11" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.75" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></>),
  unlock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.75" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 4.9-.7" /></>),
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2v1.25H4.5V8.5l2-2zM8 9.75v3.75" />,
  more: (<><circle cx="3.5" cy="8" r="0.6" /><circle cx="8" cy="8" r="0.6" /><circle cx="12.5" cy="8" r="0.6" /></>),
  list: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  grid: (<><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>),
};
function Ic({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="ls-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {G[id]}
    </svg>
  );
}

/** A thumbnail: the canvas colour plus a sketch of its first artboard. */
function Thumb({ c, big }: { c: string; big?: boolean }) {
  return <span className={`ls-thumb ls-th-${c}${big ? " ls-thumb--big" : ""}`} aria-hidden="true"><span /><span /></span>;
}

function Avatar({ who }: { who: "Tereza" | "Jonas" | "You" }) {
  const cls = { Tereza: "sky", Jonas: "green", You: "lilac" }[who];
  return <span className={`ls-av ls-av-${cls}`} role="img" aria-label={who}><span aria-hidden="true">{who[0]}</span></span>;
}

/* ─── Layers model ───────────────────────────────────────────────────────── */
type Layer = { id: string; name: string; kind: string; depth: number; parent?: string; kids?: boolean; tag: string; cls: string };
const LAYERS: Layer[] = [
  { id: "board", name: "Homepage", kind: "frame", depth: 0, kids: true, tag: "main", cls: "homepage" },
  { id: "nav", name: "Navigation", kind: "frame", depth: 1, parent: "board", kids: true, tag: "nav", cls: "nav" },
  { id: "logo", name: "Logo", kind: "shape", depth: 2, parent: "nav", tag: "svg", cls: "nav-logo" },
  { id: "links", name: "Links", kind: "text", depth: 2, parent: "nav", tag: "ul", cls: "nav-links" },
  { id: "hero", name: "Hero", kind: "frame", depth: 1, parent: "board", kids: true, tag: "section", cls: "hero" },
  { id: "headline", name: "Headline", kind: "text", depth: 2, parent: "hero", tag: "h1", cls: "hero-title" },
  { id: "photo", name: "Photo", kind: "image", depth: 2, parent: "hero", tag: "img", cls: "hero-photo" },
  { id: "cta", name: "Button", kind: "shape", depth: 2, parent: "hero", tag: "a", cls: "hero-cta" },
  { id: "plans", name: "Plans", kind: "frame", depth: 1, parent: "board", tag: "section", cls: "plans" },
  { id: "footer", name: "Footer", kind: "frame", depth: 1, parent: "board", tag: "footer", cls: "footer" },
];
const PARENT = Object.fromEntries(LAYERS.map((l) => [l.id, l.parent]));

function ancestorsOpen(id: string, open: Set<string>): boolean {
  let p = PARENT[id];
  while (p) { if (!open.has(p)) return false; p = PARENT[p]; }
  return true;
}

function LayerRow({ l, sel, open, hidden, locked, onSel, onOpen, onHide, onLock }: {
  l: Layer; sel: boolean; open: boolean; hidden: boolean; locked: boolean;
  onSel: () => void; onOpen: () => void; onHide: () => void; onLock: () => void;
}) {
  return (
    <div
      className={`row-item ls-layer${hidden ? " is-hidden" : ""}${locked ? " is-locked" : ""}`}
      aria-current={sel}
      style={{ paddingLeft: `calc(var(--space-1) + ${l.depth} * var(--space-3))` }}
      onClick={onSel}
      role="treeitem"
      aria-level={l.depth + 1}
      aria-expanded={l.kids ? open : undefined}
      aria-selected={sel}
    >
      {Array.from({ length: l.depth }).map((_, i) => (
        <span key={i} className="ls-guide" style={{ left: `calc(var(--space-1) + ${i} * var(--space-3) + 7px)` }} aria-hidden="true" />
      ))}
      {l.kids ? (
        <button type="button" className={`ls-disc${open ? " is-open" : ""}`} aria-label={open ? `Collapse ${l.name}` : `Expand ${l.name}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          <Ic id="chev" size={12} />
        </button>
      ) : <span className="ls-disc-space" />}
      <span className="ls-type"><Ic id={l.kind} /></span>
      <span className="ls-name">{l.name}</span>
      <span className="ls-actions">
        <button type="button" className={`ls-act${locked ? " is-on" : ""}`} aria-label={locked ? `Unlock ${l.name}` : `Lock ${l.name}`} aria-pressed={locked} onClick={(e) => { e.stopPropagation(); onLock(); }}>
          <Ic id={locked ? "lock" : "unlock"} />
        </button>
        <button type="button" className={`ls-act${hidden ? " is-on" : ""}`} aria-label={hidden ? `Show ${l.name}` : `Hide ${l.name}`} aria-pressed={hidden} onClick={(e) => { e.stopPropagation(); onHide(); }}>
          <Ic id={hidden ? "eyeoff" : "eye"} />
        </button>
      </span>
    </div>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */
const CANVASES = [
  { name: "Homepage", c: "coral", pinned: true },
  { name: "Onboarding", c: "yellow", comments: 3 },
  { name: "Pricing", c: "green", who: "Tereza" as const },
  { name: "Mobile — detail", c: "lilac", ai: true },
  { name: "Checkout", c: "sky" },
];

function Hero() {
  const [sel, setSel] = useState("hero");
  const [open, setOpen] = useState<Set<string>>(new Set(["board", "hero"]));
  const [hidden, setHidden] = useState<Set<string>>(new Set(["plans"]));
  const [locked, setLocked] = useState<Set<string>>(new Set(["footer"]));
  const [adv, setAdv] = useState(false);
  const [canvas, setCanvas] = useState("Homepage");

  const flip = (s: Set<string>, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const isHidden = (id: string) => { let x: string | undefined = id; while (x) { if (hidden.has(x)) return true; x = PARENT[x]; } return false; };
  const cur = LAYERS.find((l) => l.id === sel) ?? LAYERS[0];
  const region = (id: string, extra = "") => `ls-r ls-r-${id}${sel === id ? " is-sel" : ""}${isHidden(id) ? " is-gone" : ""}${extra}`;

  return (
    <div className="stage ls-hero">
      {/* the artboard — each region is a layer */}
      <div className={region("board", " ls-board")} onClick={() => setSel("board")}>
        <span className="ls-board-label">Homepage</span>
        <div className={region("nav")} onClick={(e) => { e.stopPropagation(); setSel("nav"); }}>
          <span className={region("logo")} onClick={(e) => { e.stopPropagation(); setSel("logo"); }} />
          <span className={region("links")} onClick={(e) => { e.stopPropagation(); setSel("links"); }}>Work · About · Contact</span>
        </div>
        <div className={region("hero")} onClick={(e) => { e.stopPropagation(); setSel("hero"); }}>
          <span className={region("headline")} onClick={(e) => { e.stopPropagation(); setSel("headline"); }}>Small studio, big ideas.</span>
          <span className={region("cta")} onClick={(e) => { e.stopPropagation(); setSel("cta"); }}>See our work</span>
          <span className={region("photo")} onClick={(e) => { e.stopPropagation(); setSel("photo"); }} />
        </div>
        <div className={region("plans")} onClick={(e) => { e.stopPropagation(); setSel("plans"); }}><span /><span /><span /></div>
        <div className={region("footer")} onClick={(e) => { e.stopPropagation(); setSel("footer"); }} />
      </div>
      <div className="sticky sticky--yellow ls-sticky">Bigger photo in the hero?</div>

      <div className="ls-col">
        <div className="island island--pad ls-canvases">
          <div className="ls-isl-hd">
            <p className="island-title">Studio site</p>
            <span className="ls-hd-count">5 canvases</span>
          </div>
          <label className="ls-find"><Ic id="search" /><input className="input" placeholder="Search canvases" aria-label="Search canvases" /></label>
          <div role="list" aria-label="Canvases">
            {CANVASES.map((c) => (
              <div className="row-item ls-crow" role="listitem" aria-current={canvas === c.name} key={c.name} onClick={() => setCanvas(c.name)}>
                <Thumb c={c.c} />
                <span className="ls-name">{c.name}</span>
                {c.pinned ? <span className="ls-meta-ic"><Ic id="pin" size={14} /><span className="ls-sr">Pinned</span></span> : null}
                {c.comments ? <span className="ls-count"><Ic id="comment" size={12} />{c.comments}<span className="ls-sr"> comments</span></span> : null}
                {c.who ? <Avatar who={c.who} /> : null}
                {c.ai ? <span className="ls-ai"><Spark size={10} color="var(--spark)" /><span className="ls-sr">AI is editing</span></span> : null}
                <button type="button" className="ls-more" aria-label={`More for ${c.name}`} onClick={(e) => e.stopPropagation()}><Ic id="more" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="island island--pad ls-layers">
          <div className="ls-isl-hd"><p className="island-title">Layers</p></div>
          <div role="tree" aria-label="Layers of Homepage">
            {LAYERS.filter((l) => ancestorsOpen(l.id, open)).map((l) => (
              <LayerRow
                key={l.id}
                l={l}
                sel={sel === l.id}
                open={open.has(l.id)}
                hidden={hidden.has(l.id)}
                locked={locked.has(l.id)}
                onSel={() => setSel(l.id)}
                onOpen={() => setOpen((s) => flip(s, l.id))}
                onHide={() => setHidden((s) => flip(s, l.id))}
                onLock={() => setLocked((s) => flip(s, l.id))}
              />
            ))}
          </div>
          <div className="ls-adv">
            <button type="button" className="ls-adv-btn" aria-expanded={adv} onClick={() => setAdv((a) => !a)}>
              <span className={`ls-disc${adv ? " is-open" : ""}`}><Ic id="chev" size={12} /></span>Advanced
            </button>
            {adv ? (
              <dl className="ls-adv-body">
                <div><dt>Element</dt><dd className="mono">{cur.tag}</dd></div>
                <div><dt>Class</dt><dd className="mono">.{cur.cls}</dd></div>
                <div><dt>Id</dt><dd className="mono">{cur.id}-01</dd></div>
              </dl>
            ) : null}
          </div>
        </div>
      </div>

      <p className="ls-hero-note">Pick a layer — the canvas outlines it. Hover a row for hide and lock.</p>
    </div>
  );
}

/* ─── Canvas row states ──────────────────────────────────────────────────── */
function States() {
  const [mode, setMode] = useState<"list" | "grid">("list");
  return (
    <div className="ls-states">
      <div className="ls-states-bar">
        <span className="seg" role="group" aria-label="Canvas list view">
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}><Ic id="list" size={14} /> List</button>
          <button type="button" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}><Ic id="grid" size={14} /> Grid</button>
        </span>
        <span className="ls-states-hint">Same canvases, same order. Grid is for projects you browse by picture.</span>
      </div>
      {mode === "list" ? (
        <div className="island island--pad ls-states-list">
          {[
            { k: "Idle", row: <><Thumb c="yellow" /><span className="ls-name">Onboarding</span></> },
            { k: "Hover", cls: " is-hover", row: <><Thumb c="yellow" /><span className="ls-name">Onboarding</span><span className="ls-more is-shown"><Ic id="more" /></span></> },
            { k: "Current", cur: true, row: <><Thumb c="coral" /><span className="ls-name">Homepage</span><span className="ls-meta-ic"><Ic id="pin" size={14} /></span></> },
            { k: "Has comments", row: <><Thumb c="yellow" /><span className="ls-name">Onboarding</span><span className="ls-count"><Ic id="comment" size={12} />3</span></> },
            { k: "Someone's here", row: <><Thumb c="green" /><span className="ls-name">Pricing</span><Avatar who="Tereza" /><Avatar who="Jonas" /></> },
            { k: "AI at work", row: <><Thumb c="lilac" /><span className="ls-name">Mobile — detail</span><span className="ls-ai-word"><Spark size={10} color="var(--spark)" /> AI is editing</span></> },
            { k: "Renaming", row: <><Thumb c="sky" /><input className="input ls-rename" defaultValue="Checkout — v2" aria-label="Canvas name" /></> },
          ].map((s) => (
            <div className="ls-state" key={s.k}>
              <span className="ls-state-k">{s.k}</span>
              <div className={`row-item ls-crow${s.cls ?? ""}`} aria-current={s.cur ? true : undefined}>{s.row}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ls-grid">
          {CANVASES.map((c) => (
            <div className={`ls-card${c.name === "Homepage" ? " is-cur" : ""}`} key={c.name}>
              <Thumb c={c.c} big />
              <div className="ls-card-meta">
                <span className="ls-name">{c.name}</span>
                {c.comments ? <span className="ls-count"><Ic id="comment" size={12} />{c.comments}</span> : null}
                {c.who ? <Avatar who={c.who} /> : null}
                {c.ai ? <span className="ls-ai"><Spark size={10} color="var(--spark)" /></span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Recents ────────────────────────────────────────────────────────────── */
const RECENTS = [
  { when: "Today", items: [
    { name: "Homepage", project: "Studio site", c: "coral", by: "You", t: "2 min ago" },
    { name: "Pricing", project: "Studio site", c: "green", by: "Tereza", t: "1 hour ago" },
  ] },
  { when: "Yesterday", items: [
    { name: "Brand board", project: "Alligators brand", c: "sky", by: "Jonas", t: "16:40" },
    { name: "Onboarding", project: "Studio site", c: "yellow", by: "You", t: "10:15" },
  ] },
  { when: "Earlier", items: [
    { name: "Game-day poster", project: "Alligators brand", c: "lilac", by: "Jonas", t: "2 Oct, 11:20" },
  ] },
] as const;

export default function ComponentsList() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Lists"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Lists live in islands. Short rows, real pictures, tools on hover.</h1>
          <p className="lede">
            Your canvases with their thumbnails, the layers of what you picked, and what you opened lately.
            Rows stay short and quiet; the actions appear when you reach for them and stay put once you've
            used them.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Row</dt><dd>30 px · 36 px with a thumbnail</dd></div>
          <div><dt>Current</dt><dd>azure tint, one per list</dd></div>
          <div><dt>Nesting</dt><dd>one 12 px step per level + a guide</dd></div>
          <div><dt>Advanced</dt><dd>a disclosure inside the panel</dd></div>
        </dl>

        <h2 data-no>In the app<span className="h2-aside">the canvas list and layers, wired to the artboard</span></h2>
        <Hero />

        <h2 data-no>Canvas rows<span className="h2-aside">every state a row can be in</span></h2>
        <States />

        <h2 data-no>Layers, up close</h2>
        <div className="ls-anat">
          <div className="island island--pad ls-anat-isl">
            <div className="row-item ls-layer ls-anat-row" style={{ paddingLeft: "var(--space-1)" }}>
              <span className="ls-disc is-open"><Ic id="chev" size={12} /></span>
              <span className="ls-type"><Ic id="frame" /></span><span className="ls-name">Hero</span>
              <span className="ls-pin ls-pin-a">1</span>
            </div>
            <div className="row-item ls-layer" aria-current="true" style={{ paddingLeft: "calc(var(--space-1) + var(--space-3))" }}>
              <span className="ls-guide" style={{ left: "calc(var(--space-1) + 7px)" }} />
              <span className="ls-disc-space" /><span className="ls-type"><Ic id="text" /></span><span className="ls-name">Headline</span>
              <span className="ls-actions is-shown"><span className="ls-act"><Ic id="unlock" /></span><span className="ls-act"><Ic id="eye" /></span></span>
              <span className="ls-pin ls-pin-b">2</span>
            </div>
            <div className="row-item ls-layer is-hidden" style={{ paddingLeft: "calc(var(--space-1) + var(--space-3))" }}>
              <span className="ls-guide" style={{ left: "calc(var(--space-1) + 7px)" }} />
              <span className="ls-disc-space" /><span className="ls-type"><Ic id="image" /></span><span className="ls-name">Photo</span>
              <span className="ls-actions"><span className="ls-act" /><span className="ls-act is-on"><Ic id="eyeoff" /></span></span>
              <span className="ls-pin ls-pin-c">3</span>
            </div>
            <div className="row-item ls-layer is-locked" style={{ paddingLeft: "calc(var(--space-1) + var(--space-3))" }}>
              <span className="ls-guide" style={{ left: "calc(var(--space-1) + 7px)" }} />
              <span className="ls-disc-space" /><span className="ls-type"><Ic id="shape" /></span><span className="ls-name">Button</span>
              <span className="ls-actions"><span className="ls-act is-on"><Ic id="lock" /></span><span className="ls-act" /></span>
              <span className="ls-pin ls-pin-d">4</span>
            </div>
          </div>
          <ol className="ls-legend">
            <li><span className="ls-pin">1</span><span><strong>Disclosure + type</strong> A chevron for groups, then what the layer is: frame, text, shape, image, sticky.</span></li>
            <li><span className="ls-pin">2</span><span><strong>Picked</strong> Azure tint. Lock and hide show up on hover, at the far right.</span></li>
            <li><span className="ls-pin">3</span><span><strong>Hidden</strong> The name dims and the closed eye stays, so you can find it again.</span></li>
            <li><span className="ls-pin">4</span><span><strong>Locked</strong> The lock stays. The layer can't be picked on the canvas, only here.</span></li>
          </ol>
        </div>

        <h2 data-no>Recents<span className="h2-aside">across projects, grouped by when</span></h2>
        <div className="ls-recents">
          <div className="ls-jump">
            {RECENTS.flatMap((g) => g.items).slice(0, 3).map((r) => (
              <div className="ls-jump-card" key={r.name}>
                <Thumb c={r.c} big />
                <strong>{r.name}</strong>
                <span>{r.project}</span>
              </div>
            ))}
          </div>
          <div className="island island--pad ls-recent-list">
            {RECENTS.map((g) => (
              <div key={g.when} className="ls-recent-group">
                <p className="island-title">{g.when}</p>
                {g.items.map((r) => (
                  <div className="row-item ls-crow" key={r.name}>
                    <Thumb c={r.c} />
                    <span className="ls-name">{r.name}<span className="ls-proj">{r.project}</span></span>
                    <Avatar who={r.by} />
                    <span className="ls-when">{r.t}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="ls-keys">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
              <span><span className="kbd">↵</span> open</span>
              <span><span className="kbd">⌘K</span> Search</span>
            </div>
          </div>
        </div>

        <h2 data-no>Calm, not dense</h2>
        <div className="ls-compare">
          <figure className="ls-case">
            <div className="island island--pad ls-mini">
              <div className="row-item ls-crow" aria-current="true"><Thumb c="coral" /><span className="ls-name">Homepage</span></div>
              <div className="row-item ls-crow"><Thumb c="yellow" /><span className="ls-name">Onboarding</span><span className="ls-count"><Ic id="comment" size={12} />3</span></div>
              <div className="row-item ls-crow"><Thumb c="green" /><span className="ls-name">Pricing</span><Avatar who="Tereza" /></div>
            </div>
            <figcaption><strong className="ls-ok">Right</strong> Name and picture first. Only what changes your next move — comments, who's here.</figcaption>
          </figure>
          <figure className="ls-case">
            <div className="ls-mini ls-wrong">
              <div className="ls-w-hd"><span>FILE</span><span>STATUS</span><span>ARTBOARDS</span></div>
              <div className="ls-w-row"><span className="mono">ui/homepage.tsx</span><span className="mono">M</span><span className="mono">6</span></div>
              <div className="ls-w-row"><span className="mono">ui/onboarding.tsx</span><span className="mono">A</span><span className="mono">4</span></div>
              <div className="ls-w-row"><span className="mono">ui/pricing.meta.json</span><span className="mono">U</span><span className="mono">—</span></div>
            </div>
            <figcaption><strong className="ls-bad">Wrong</strong> File paths, change letters and counts in a hairline-boxed table. All of it still exists — under Advanced.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · lists</span>
        <span>Hidden files, change status and element ids live under each panel's Advanced</span>
      </footer>
    </>
  );
}
