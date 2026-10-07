/**
 * SPECIMEN — components-keyboard · maude-v2
 *
 * DEMONSTRATES: the key cap (`.kbd`) — anatomy, three sizes, combos as caps sitting 2px
 *   apart (the gap is the plus), Mac glyphs (⌘ ⇧ ⌥ ⌃) vs spelled-out words on Windows with
 *   an identical visual style — and the core shortcut set of Maude v2:
 *   CONTRACT §2, exactly: V select · H hand · F frame · R shape · P pen · T text · N sticky ·
 *   C comment · ⌘K Search · ⌘\ hide / show panels · ⌘/ Ask AI · ? every shortcut · ⌘N new
 *   canvas · ⇧⌘N new project · ⌥⌘H version history · ⌘0 zoom to fit. Modifiers in macOS
 *   order (⌥⇧⌘), Return as ↵.
 * COMPOSITION: hero = a keyboard map where only the keys that do something are lit; hover,
 *   click or press a real key to see what it does. Then the cap anatomy, three places a
 *   shortcut appears (menu · tooltip · teaching), the core set as a quiet reference, "one key,
 *   one job" (the old T / H / N collisions, resolved — nothing removed), and keys in a sentence.
 * COPY VOICE: literal key names, everyday action names ("Sticky", not "Create note object").
 * NOTES: caps use the body face, never mono. Selection on the map is azure (it is a selection);
 *   "has a shortcut" is carried by contrast, not colour. A platform switch re-labels every cap
 *   on the page.
 */
import { useEffect, useState } from "react";
import "./_layout.css";
import "./components-keyboard.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

type Platform = "mac" | "win";
const WORDS: Record<string, string> = { "⌘": "Ctrl", "⇧": "Shift", "⌥": "Alt", "⌃": "Ctrl", "↵": "Enter", "⌫": "Backspace" };
const label = (k: string, p: Platform) => (p === "win" && WORDS[k] ? WORDS[k] : k);

function Combo({ keys, p, size }: { keys: string[]; p: Platform; size?: "sm" | "lg" }) {
  return (
    <span className={`kb-combo${size ? ` kb-combo--${size}` : ""}`}>
      {keys.map((k, i) => <span className={`kbd${size ? ` kb-${size}` : ""}`} key={i}>{label(k, p)}</span>)}
    </span>
  );
}

/* ─── The core set ───────────────────────────────────────────────────────── */
type Shortcut = { id: string; keys: string[]; name: string; what: string; group: "Tools" | "Everywhere" | "Canvas" };
const SET: Shortcut[] = [
  { id: "select", keys: ["V"], name: "Select", what: "Pick, move and resize things on the canvas.", group: "Tools" },
  { id: "hand", keys: ["H"], name: "Hand", what: "Pan around. Or hold Space with any tool.", group: "Tools" },
  { id: "frame", keys: ["F"], name: "Frame", what: "Draw an artboard, or a frame inside one.", group: "Tools" },
  { id: "shape", keys: ["R"], name: "Shape", what: "Rectangles, ellipses and lines. Hold ⇧ to keep it even.", group: "Tools" },
  { id: "pen", keys: ["P"], name: "Pen", what: "Draw a path, point by point.", group: "Tools" },
  { id: "text", keys: ["T"], name: "Text", what: "Click to type. Drag to set a width.", group: "Tools" },
  { id: "sticky", keys: ["N"], name: "Sticky", what: "Drop a sticky. Press again to change its colour.", group: "Tools" },
  { id: "comment", keys: ["C"], name: "Comment", what: "Pin a comment to anything on the canvas.", group: "Tools" },
  { id: "palette", keys: ["⌘", "K"], name: "Search", what: "Canvases, actions, AI, and every hidden tool.", group: "Everywhere" },
  { id: "panels", keys: ["⌘", "\\"], name: "Hide / show panels", what: "Hide every panel, and bring them back.", group: "Everywhere" },
  { id: "ask", keys: ["⌘", "/"], name: "Ask AI", what: "Open the AI chat panel with your selection attached.", group: "Everywhere" },
  { id: "help", keys: ["?"], name: "All shortcuts", what: "The full sheet, searchable.", group: "Everywhere" },
  { id: "esc", keys: ["esc"], name: "Step back", what: "Deselect, close a menu, leave a tool.", group: "Everywhere" },
  { id: "newcanvas", keys: ["⌘", "N"], name: "New canvas", what: "A blank canvas in this project.", group: "Everywhere" },
  { id: "newproject", keys: ["⇧", "⌘", "N"], name: "New project", what: "A new project, in a new project tab.", group: "Everywhere" },
  { id: "history", keys: ["⌥", "⌘", "H"], name: "Version history", what: "Every saved version, with Restore.", group: "Everywhere" },
  { id: "pan", keys: ["Space"], name: "Pan while held", what: "Hold and drag, let go to return to your tool.", group: "Canvas" },
  { id: "undo", keys: ["⌘", "Z"], name: "Undo", what: "Every change, including the AI's.", group: "Canvas" },
  { id: "redo", keys: ["⇧", "⌘", "Z"], name: "Redo", what: "Bring it back.", group: "Canvas" },
  { id: "fit", keys: ["⌘", "0"], name: "Zoom to fit", what: "Everything on the canvas, in view.", group: "Canvas" },
  { id: "actual", keys: ["⌘", "1"], name: "Actual size", what: "100 %, centred on your selection.", group: "Canvas" },
];
const SC = Object.fromEntries(SET.map((s) => [s.id, s]));

/* ─── The keyboard map ──────────────────────────────────────────────────── */
type Key = { cap: string; w?: number; sc?: string[]; mod?: boolean };
const ROWS: Key[][] = [
  [{ cap: "esc", w: 1.3, sc: ["esc"] }, { cap: "Q" }, { cap: "W" }, { cap: "E" }, { cap: "R", sc: ["shape"] }, { cap: "T", sc: ["text"] }, ..."YUIO".split("").map((c) => ({ cap: c })), { cap: "P", sc: ["pen"] }, { cap: "[" }, { cap: "]" }, { cap: "\\", w: 1.3, sc: ["panels"] }],
  [{ cap: "⇪", w: 1.6 }, { cap: "A" }, { cap: "S" }, { cap: "D" }, { cap: "F", sc: ["frame"] }, { cap: "G" }, { cap: "H", sc: ["hand", "history"] }, { cap: "J" }, { cap: "K", sc: ["palette"] }, { cap: "L" }, { cap: ";" }, { cap: "'" }, { cap: "↵", w: 1.6 }],
  [{ cap: "⇧", w: 2.1, mod: true }, { cap: "Z", sc: ["undo", "redo"] }, { cap: "X" }, { cap: "C", sc: ["comment"] }, { cap: "V", sc: ["select"] }, { cap: "B" }, { cap: "N", sc: ["sticky", "newcanvas", "newproject"] }, { cap: "M" }, { cap: "," }, { cap: "." }, { cap: "/", sc: ["ask", "help"] }, { cap: "⇧", w: 2.1, mod: true }],
  [{ cap: "fn" }, { cap: "⌃", mod: true }, { cap: "⌥", mod: true }, { cap: "⌘", w: 1.3, mod: true }, { cap: "Space", w: 5.6, sc: ["pan"] }, { cap: "⌘", w: 1.3, mod: true }, { cap: "⌥", mod: true }],
];
const CAPTION: Record<string, string> = {
  select: "Select", hand: "Hand", frame: "Frame", shape: "Shape", pen: "Pen", text: "Text", sticky: "Sticky", comment: "Comment",
  palette: "Search", panels: "⌘ Panels", ask: "⌘ Ask AI", undo: "⌘ Undo", pan: "Hold to pan", esc: "Back",
};

function KeyboardMap({ p }: { p: Platform }) {
  const [sel, setSel] = useState<string>("V");
  const [pressed, setPressed] = useState<string | null>(null);

  const keyFor = (cap: string) => ROWS.flat().find((k) => k.cap === cap);
  const selected = keyFor(sel);
  const shortcuts = (selected?.sc ?? []).map((id) => SC[id]);

  // Press a real key: it lights up and explains itself.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      let cap = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.key === "?") cap = "/";
      if (e.key === " ") cap = "Space";
      if (e.key === "Escape") cap = "esc";
      if (!keyFor(cap)) return;
      setSel(cap);
      setPressed(cap);
      window.setTimeout(() => setPressed((c) => (c === cap ? null : c)), 180);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stage kb-hero">
      <div className="kb-board" role="group" aria-label="Keyboard map — keys with a shortcut are lit">
        {ROWS.map((row, r) => (
          <div className="kb-row" key={r}>
            {row.map((k, i) => {
              const lit = !!k.sc;
              const id = k.sc?.[0];
              return (
                <button
                  type="button"
                  key={`${k.cap}-${i}`}
                  className={`kb-key${lit ? " is-lit" : ""}${k.mod ? " is-mod" : ""}${pressed === k.cap ? " is-pressed" : ""}`}
                  style={{ flexGrow: k.w ?? 1 }}
                  aria-pressed={sel === k.cap}
                  onClick={() => setSel(k.cap)}
                  onMouseEnter={() => lit && setSel(k.cap)}
                  onFocus={() => setSel(k.cap)}
                >
                  <span className="kb-cap">{label(k.cap, p)}</span>
                  {lit && id ? <span className="kb-cap-note">{CAPTION[id]}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="island island--pad kb-detail" aria-live="polite">
        {shortcuts.length ? (
          shortcuts.map((s) => (
            <div className="kb-detail-item" key={s.id}>
              <Combo keys={s.keys} p={p} size="lg" />
              <strong>{s.id === "ask" ? <><Spark size={12} color="var(--spark)" /> {s.name}</> : s.name}</strong>
              <span>{s.what}</span>
            </div>
          ))
        ) : selected?.mod ? (
          <div className="kb-detail-item">
            <Combo keys={[selected.cap]} p={p} size="lg" />
            <strong>A modifier</strong>
            <span>On its own it does nothing. Try ⌘ with K, \ or /.</span>
          </div>
        ) : (
          <div className="kb-detail-item">
            <Combo keys={[selected?.cap ?? sel]} p={p} size="lg" />
            <strong>Free</strong>
            <span>No shortcut here — fewer keys to learn.</span>
          </div>
        )}
        <p className="kb-detail-hint">Press any key on your keyboard.</p>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
const COLLISIONS = [
  { key: "T", before: ["Project tree", "Text tool"], now: "Text", moved: "Panels → ⌘\\" },
  { key: "H", before: ["Show hidden files", "Hand tool"], now: "Hand", moved: "Hidden files → Menu › View › Advanced" },
  { key: "N", before: ["New canvas", "Sticky"], now: "Sticky", moved: "New canvas → ⌘N · Menu › File" },
];

export default function ComponentsKeyboard() {
  const [p, setP] = useState<Platform>("mac");

  return (
    <>
      <SpecimenHeader crumbs={["Components", "Keyboard"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>A handful of keys, each with one job.</h1>
          <p className="lede">
            Eight letters pick a tool, a few combinations reach everything else. Caps look like the keys on
            your keyboard — same face as the rest of the app, glyphs on a Mac in macOS order, words on Windows.
          </p>
        </section>

        <div className="kb-meta-row">
          <dl className="specimen-meta">
            <div><dt>Tools</dt><dd>V · H · F · R · P · T · N · C</dd></div>
            <div><dt>Everywhere</dt><dd>⌘K · ⌘\ · ⌘/ · ? · ⌥⌘H</dd></div>
            <div><dt>Order</dt><dd>⌥ ⇧ ⌘ · Return is ↵</dd></div>
            <div><dt>Cap</dt><dd>body face · 4 px radius · a lip, not a border</dd></div>
          </dl>
          <span className="seg" role="group" aria-label="Platform">
            <button type="button" aria-pressed={p === "mac"} onClick={() => setP("mac")}>macOS</button>
            <button type="button" aria-pressed={p === "win"} onClick={() => setP("win")}>Windows</button>
          </span>
        </div>

        <h2 data-no>The map<span className="h2-aside">only the keys that do something are lit</span></h2>
        <KeyboardMap p={p} />

        <h2 data-no>Anatomy of a cap</h2>
        <div className="kb-anatomy">
          <div className="kb-big-wrap">
            <span className="kb-big" aria-hidden="true">
              {label("⌘", p)}
              <span className="kb-pin kb-pin-r">1</span>
              <span className="kb-pin kb-pin-f">2</span>
              <span className="kb-pin kb-pin-l">3</span>
              <span className="kb-pin kb-pin-b">4</span>
            </span>
            <ol className="kb-legend">
              <li><span className="kb-pin">1</span><span><strong>Corner</strong> <code>--radius-xs</code> — the smallest step of the concentric ladder.</span></li>
              <li><span className="kb-pin">2</span><span><strong>Face</strong> the body font at <code>--type-xs</code>, never mono.</span></li>
              <li><span className="kb-pin">3</span><span><strong>Lip</strong> an inset line of <code>--border-default</code> along the bottom, so it reads as a key.</span></li>
              <li><span className="kb-pin">4</span><span><strong>Fill</strong> <code>--bg-2</code> with a 0.5 px edge — it sits on any island.</span></li>
            </ol>
          </div>
          <div className="kb-sizes">
            <div className="kb-size">
              <Combo keys={["⇧", "⌘", "E"]} p={p} size="sm" />
              <div><strong>Small · 16</strong><span>Inside dense rows — the palette, the layers list.</span></div>
            </div>
            <div className="kb-size">
              <Combo keys={["⇧", "⌘", "E"]} p={p} />
              <div><strong>Base · 20</strong><span>The default <code>.kbd</code>: tooltips, toasts, copy.</span></div>
            </div>
            <div className="kb-size">
              <Combo keys={["⇧", "⌘", "E"]} p={p} size="lg" />
              <div><strong>Large · 28</strong><span>Teaching moments — the shortcut sheet, first-run hints.</span></div>
            </div>
            <p className="kb-note">Caps sit 2 px apart. The gap is the plus — no “+” between them.</p>
          </div>
        </div>

        <h2 data-no>Three places a shortcut shows up<span className="h2-aside">louder only when it is teaching</span></h2>
        <div className="kb-places">
          <figure className="kb-place">
            <div className="stage kb-place-stage">
              <div className="kb-menu">
                <div className="row-item">Undo<span className="kb-glyphs">{p === "mac" ? "⌘Z" : "Ctrl Z"}</span></div>
                <div className="row-item">Redo<span className="kb-glyphs">{p === "mac" ? "⇧⌘Z" : "Ctrl Shift Z"}</span></div>
                <div className="row-item" aria-current="true">Version history<span className="kb-glyphs">{p === "mac" ? "⌥⌘H" : "Ctrl Alt H"}</span></div>
              </div>
            </div>
            <figcaption><strong>In a menu</strong> Plain glyphs in the right column, in macOS order (⌥⇧⌘). No caps — the list stays calm.</figcaption>
          </figure>
          <figure className="kb-place">
            <div className="stage kb-place-stage">
              <div className="island dock kb-place-dock" aria-hidden="true">
                {/* the right end of the toolbar, in order: Text · Sticky · Comment (glyphs from iconography.tsx) */}
                <span className="icon-btn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" /></svg></span>
                <span className="icon-btn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></svg></span>
                <span className="icon-btn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" /></svg></span>
              </div>
              <div className="kb-tip" role="tooltip">Comment <Combo keys={["C"]} p={p} /></div>
            </div>
            <figcaption><strong>In a tooltip</strong> The tool's name and one base cap. Shown after a short hover, never on the button itself.</figcaption>
          </figure>
          <figure className="kb-place">
            <div className="stage kb-place-stage">
              <div className="island island--pad kb-teach">
                <span className="kb-teach-t">Panels hidden.</span>
                <span>Press <Combo keys={["⌘", "\\"]} p={p} size="lg" /> to bring them back.</span>
              </div>
            </div>
            <figcaption><strong>Teaching</strong> Large caps, once, right after you did the thing. The rounded face is for the canvas; hints stay in the body face.</figcaption>
          </figure>
        </div>

        <h2 data-no>The core set</h2>
        <div className="kb-set">
          {(["Tools", "Everywhere", "Canvas"] as const).map((g) => (
            <section className="kb-set-col" key={g}>
              <p className="island-title">{g}</p>
              <dl>
                {SET.filter((s) => s.group === g).map((s) => (
                  <div className="kb-set-row" key={s.id}>
                    <dt>{s.name}</dt>
                    <dd><Combo keys={s.keys} p={p} /></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <h2 data-no>One key, one job<span className="h2-aside">old collisions, resolved — nothing removed</span></h2>
        <div className="kb-coll">
          {COLLISIONS.map((c) => (
            <div className="kb-coll-card" key={c.key}>
              <span className="kbd kb-lg">{c.key}</span>
              <div className="kb-coll-before">
                <span className="kb-coll-label">Before</span>
                {c.before.map((b) => <span className="chip" key={b}>{b}</span>)}
              </div>
              <div className="kb-coll-now">
                <span className="kb-coll-label">Now</span>
                <span className="chip chip--accent">{c.now}</span>
              </div>
              <p className="kb-coll-moved">{c.moved}</p>
            </div>
          ))}
        </div>

        <h2 data-no>In a sentence</h2>
        <div className="kb-prose">
          <p>
            Press <Combo keys={["⌘", "K"]} p={p} /> anywhere to search for a canvas or a tool. <Combo keys={["N"]} p={p} /> drops a
            sticky; press it again to change the colour. Hold <Combo keys={["Space"]} p={p} /> to pan, and <Combo keys={["esc"]} p={p} /> to
            step back out of anything.
          </p>
          <p className="kb-prose-small">Caps keep the line height — base caps are 20 px high, the same as a line of small text.</p>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · keyboard</span>
        <span>The full sheet opens with ? — see Shortcuts overlay</span>
      </footer>
    </>
  );
}
