/**
 * SPECIMEN — components-shortcuts-overlay · maude-v2
 *
 * DEMONSTRATES: the ? sheet — every shortcut on one large, calm surface that opens over the
 *   canvas: grouped by what you're doing (Tools · Edit · Tools · Preview · Canvas · Panels & AI ·
 *   Search · Edit · File — the two tool groups are CONTRACT §2's two toolbars),
 *   searchable as you type, with an Advanced switch for the shortcuts of panels kept under
 *   Advanced (Inspector, Timeline…). Keys are CONTRACT §2 exactly, modifiers in macOS order
 *   (⌥⇧⌘). A soft veil quiets the canvas behind; it never lets the work peek through.
 *   Closing it (esc, ×, a click on the veil) returns focus to the "Show" button that brings
 *   it back; opening it puts focus in its search field.
 * COMPOSITION: hero = the live sheet over a slice of the app — search, flip Advanced, press
 *   esc (or the close button) and it folds away with a one-line hint; press ? to bring it
 *   back. Then an anchored reading guide, how the sheet reflows at three window widths, the
 *   hand-off to ⌘K when a search finds no shortcut, and "keep or kill" label copy.
 * COPY VOICE: short verbs that never repeat the key ("Sticky", not "Press N for sticky").
 * NOTES: popover plane (--bg-2, --shadow-lg, island edge) at the sheet radius (--radius-xl).
 *   Open/close animates transform + opacity on --dur-panel; reduced motion collapses it.
 *   Advanced is a fold inside the sheet, not a second sheet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "./_layout.css";
import "./components-shortcuts-overlay.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

type Row = { label: string; keys: string[]; hold?: boolean };
type Group = { title: string; rows: Row[]; advanced?: boolean; note?: string };

const GROUPS: Group[] = [
  { title: "Tools · Edit", rows: [
    { label: "Select", keys: ["V"] }, { label: "Hand", keys: ["H"] }, { label: "Frame", keys: ["F"] },
    { label: "Shape", keys: ["R"] }, { label: "Pen", keys: ["P"] }, { label: "Text", keys: ["T"] },
    { label: "Image", keys: ["I"] }, { label: "Component", keys: ["⇧", "I"] },
  ] },
  { title: "Tools · Preview", note: "pressed in Edit, they switch to Preview", rows: [
    { label: "Sticky", keys: ["N"] }, { label: "Comment", keys: ["C"] }, { label: "Marker", keys: ["M"] },
    { label: "Arrow", keys: ["A"] }, { label: "Stickers", keys: ["E"] }, { label: "Section", keys: ["S"] },
  ] },
  { title: "Canvas", rows: [
    { label: "Pan", keys: ["Space"], hold: true }, { label: "Zoom in", keys: ["⌘", "+"] }, { label: "Zoom out", keys: ["⌘", "−"] },
    { label: "Zoom to fit", keys: ["⌘", "0"] }, { label: "Actual size", keys: ["⌘", "1"] },
  ] },
  { title: "Panels & AI", rows: [
    { label: "Hide / show panels", keys: ["⌘", "\\"] }, { label: "Ask AI", keys: ["⌘", "/"] }, { label: "Comments", keys: ["⇧", "⌘", "M"] },
  ] },
  { title: "Search", rows: [
    { label: "Search", keys: ["⌘", "K"] }, { label: "All shortcuts", keys: ["?"] }, { label: "Step back", keys: ["esc"] },
  ] },
  { title: "Edit", rows: [
    { label: "Undo", keys: ["⌘", "Z"] }, { label: "Redo", keys: ["⇧", "⌘", "Z"] }, { label: "Duplicate", keys: ["⌘", "D"] },
    { label: "Delete", keys: ["⌫"] }, { label: "Select all", keys: ["⌘", "A"] },
  ] },
  { title: "File", rows: [
    { label: "New canvas", keys: ["⌘", "N"] }, { label: "New project…", keys: ["⇧", "⌘", "N"] }, { label: "Open project…", keys: ["⌘", "O"] },
    { label: "Version history", keys: ["⌥", "⌘", "H"] }, { label: "Export…", keys: ["⇧", "⌘", "E"] },
  ] },
  { title: "Advanced", advanced: true, rows: [
    { label: "Inspector", keys: ["⇧", "⌘", "I"] }, { label: "Timeline", keys: ["⇧", "⌘", "T"] },
    { label: "Annotations", keys: ["⇧", "P"] }, { label: "Select all annotations", keys: ["⇧", "⌘", "A"] },
    { label: "Handoff to production", keys: ["⇧", "⌘", "H"] }, { label: "Reload canvas", keys: ["⌘", "R"] },
    { label: "Settings…", keys: ["⌘", ","] },
  ] },
];

/** Edit toolbar glyphs, left → right (CONTRACT §2) — copied verbatim from iconography.tsx GLYPHS. */
const TOOLBAR = [
  <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  <><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>,
  <><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>,
  <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  <><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>,
  <><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>,
  <g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>,
];

function Keys({ keys, hold }: { keys: string[]; hold?: boolean }) {
  return (
    <span className="so-keys">
      {hold ? <span className="so-hold">hold</span> : null}
      {keys.map((k, i) => <span className="kbd" key={i}>{k}</span>)}
    </span>
  );
}

function Hi({ text, q }: { text: string; q: string }) {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="so-mark">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

/* ─── Hero: the live sheet ───────────────────────────────────────────────── */
function Sheet() {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [adv, setAdv] = useState(false);
  const showRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const [moveFocus, setMoveFocus] = useState<"show" | "search" | null>(null);

  // Focus follows the sheet: closing hands it to "Show", opening hands it to the search field.
  useEffect(() => {
    if (moveFocus === "show") showRef.current?.focus();
    if (moveFocus === "search") searchRef.current?.focus();
    if (moveFocus) setMoveFocus(null);
  }, [moveFocus, open]);

  function close() {
    const hadFocus = !!sheetRef.current?.contains(document.activeElement);
    setOpen(false);
    if (hadFocus) setMoveFocus("show");
  }
  function show() { setOpen(true); setMoveFocus("search"); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape" && sheetRef.current?.contains(t)) { close(); return; }
      if (!typing && e.key === "?") show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => GROUPS
    .filter((g) => !g.advanced || adv || needle)
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !needle || r.label.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)) }))
    .filter((g) => g.rows.length), [adv, needle]);
  const count = visible.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="stage so-hero">
      <div className="so-bg" aria-hidden="true">
        <div className="so-board"><span className="so-board-img" /><strong>Onboarding</strong><span>Three steps, one screen each.</span></div>
        <div className="sticky sticky--green so-st1">Fewer steps?</div>
        <div className="sticky sticky--sky so-st2">Use Tereza's photos</div>
        <div className="island so-pill"><span className="so-pill-dot" />Onboarding</div>
        <div className="island dock so-dock">
          {/* toolbar order (CONTRACT §2) — glyphs verbatim from iconography.tsx */}
          {TOOLBAR.map((d, i) => (
            <span className={`icon-btn${i === 0 ? " so-dock-on" : ""}`} key={i}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{d}</svg></span>
          ))}
        </div>
      </div>

      <div className={`so-veil${open ? " is-open" : ""}`} aria-hidden="true" onClick={close} />

      <section ref={sheetRef} className={`so-sheet${open ? " is-open" : ""}`} role="dialog" aria-modal="false" aria-label="Keyboard shortcuts" aria-hidden={!open}>
        <header className="so-hd">
          <h3 className="so-title">Keyboard shortcuts</h3>
          <label className="so-search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></svg>
            <input ref={searchRef} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" tabIndex={open ? 0 : -1} />
          </label>
          <label className="so-adv">
            <span>Advanced</span>
            <button type="button" className="switch" role="switch" aria-checked={adv} aria-label="Show Advanced shortcuts" onClick={() => setAdv((a) => !a)} tabIndex={open ? 0 : -1} />
          </label>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        {count ? (
          <div className="so-cols">
            {visible.map((g) => (
              <div className={`so-group${g.advanced ? " is-adv" : ""}`} key={g.title}>
                <p className="island-title so-gt">{g.title}{g.advanced ? <span className="so-gt-note">for panels under Advanced</span> : g.note ? <span className="so-gt-note">{g.note}</span> : null}</p>
                <dl>
                  {g.rows.map((r) => (
                    <div className="so-row" key={r.label}>
                      <dt><Hi text={r.label} q={q.trim()} /></dt>
                      <dd><Keys keys={r.keys} hold={r.hold} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <div className="so-empty">
            <p><strong>No shortcut for “{q.trim()}”.</strong> It may still be one search away.</p>
            <button type="button" className="btn" tabIndex={open ? 0 : -1}>Search for “{q.trim()}” with <span className="kbd">⌘</span><span className="kbd">K</span></button>
          </div>
        )}

        <footer className="so-ft">
          <span>Press <span className="kbd">?</span> anywhere to open this, <span className="kbd">esc</span> to close.</span>
          <span className="so-count" role="status">{count} {count === 1 ? "shortcut" : "shortcuts"}{!adv && !needle ? " · more under Advanced" : ""}</span>
        </footer>
      </section>

      <div className={`island so-hint${open ? "" : " is-shown"}`} role="status" aria-hidden={open}>
        <span>Shortcuts hidden. Press <span className="kbd">?</span> to see them again.</span>
        <button type="button" ref={showRef} className="btn btn--sm" onClick={show} tabIndex={open ? -1 : 0}>Show</button>
      </div>
    </div>
  );
}

/* ─── Reading guide pins ─────────────────────────────────────────────────── */
function Pin({ n }: { n: number }) {
  return <span className="so-pin" aria-hidden="true">{n}</span>;
}

const KEEP_KILL = [
  { keep: "Sticky", kill: "Create a new sticky note object (N)" },
  { keep: "Pan", kill: "Hold the space bar to temporarily activate the Hand tool" },
  { keep: "Hide / show panels", kill: "Toggle sidebar visibility state" },
  { keep: "Version history", kill: "Open the Git changes panel" },
];

export default function ComponentsShortcutsOverlay() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Shortcuts sheet"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Press ? and every shortcut is there. Press it again, it's gone.</h1>
          <p className="lede">
            No cheat sheet pinned to the side of your canvas. The sheet opens over your work when you ask,
            sorted by what you're doing, and searchable as you type. The shortcuts for panels kept under
            Advanced wait behind its switch.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Opens with</dt><dd>? — anywhere but a text field</dd></div>
          <div><dt>Closes with</dt><dd>esc, ?, or a click on the canvas</dd></div>
          <div><dt>Groups</dt><dd>Tools · Edit · Tools · Preview · Canvas · Panels & AI · Search · Edit · File</dd></div>
          <div><dt>Advanced</dt><dd>a switch inside the sheet</dd></div>
        </dl>

        <h2 data-no>The sheet<span className="h2-aside">search it, flip Advanced, press esc — then ?</span></h2>
        <Sheet />

        <h2 data-no>How it reads</h2>
        <div className="so-guide">
          <div className="so-guide-sheet">
            <p className="island-title so-gt so-rel">Panels & AI<Pin n={1} /></p>
            <dl>
              <div className="so-row so-rel"><dt>Hide / show panels</dt><dd><Keys keys={["⌘", "\\"]} /></dd><Pin n={2} /></div>
              <div className="so-row so-row--hover so-rel"><dt><span className="so-ai"><Spark size={10} color="var(--spark)" /></span>Ask AI</dt><dd><Keys keys={["⌘", "/"]} /></dd><Pin n={3} /></div>
              <div className="so-row"><dt>Comments</dt><dd><Keys keys={["⇧", "⌘", "M"]} /></dd></div>
            </dl>
            <p className="island-title so-gt so-rel">Advanced<span className="so-gt-note">for panels under Advanced</span><Pin n={4} /></p>
            <dl>
              <div className="so-row"><dt>Inspector</dt><dd><Keys keys={["⇧", "⌘", "I"]} /></dd></div>
              <div className="so-row"><dt>Timeline</dt><dd><Keys keys={["⇧", "⌘", "T"]} /></dd></div>
            </dl>
          </div>
          <ol className="so-legend">
            <li><span className="so-pin">1</span><span><strong>Group title</strong> Named after what you're doing, not after a menu. Seven groups, always in the same order.</span></li>
            <li><span className="so-pin">2</span><span><strong>Label, then keys</strong> A short verb on the left, caps on the right edge, so your eye runs down one column of keys.</span></li>
            <li><span className="so-pin">3</span><span><strong>Hover</strong> The row lifts to <code>--bg-3</code>. The spark marks the one AI row, nothing else.</span></li>
            <li><span className="so-pin">4</span><span><strong>Advanced</strong> Off by default; on when you switch it or when your search matches it.</span></li>
          </ol>
        </div>

        <h2 data-no>Any window size<span className="h2-aside">the groups reflow; the order never changes</span></h2>
        <div className="so-sizes">
          {[
            { name: "Wide", cols: 3, w: "so-sz-wide" },
            { name: "Laptop", cols: 2, w: "so-sz-mid" },
            { name: "Narrow", cols: 1, w: "so-sz-narrow" },
          ].map((s) => (
            <figure className="so-size" key={s.name}>
              <div className={`stage so-sz ${s.w}`}>
                <div className="so-sz-sheet" style={{ columns: s.cols }}>
                  {["Tools · Edit", "Tools · Preview", "Canvas", "Panels & AI", "Search", "Edit", "File"].slice(0, s.cols === 1 ? 3 : 7).map((g, i) => (
                    <div className="so-sz-g" key={g}>
                      <span className="so-sz-t">{g}</span>
                      {Array.from({ length: [5, 4, 3, 3, 3, 4, 4][i] }).map((_, j) => <span className="so-sz-r" key={j}><i /><b /></span>)}
                    </div>
                  ))}
                </div>
              </div>
              <figcaption><strong>{s.name}</strong> {s.cols} {s.cols === 1 ? "column" : "columns"}{s.cols === 1 ? " — the sheet scrolls, search stays on top" : ""}</figcaption>
            </figure>
          ))}
        </div>

        <h2 data-no>No shortcut? Hand it to Search, ⌘K</h2>
        <div className="so-hand">
          <div className="so-hand-sheet">
            <div className="so-hand-field"><span>export layers</span></div>
            <p className="so-hand-msg"><strong>No shortcut for “export layers”.</strong></p>
            <span className="btn btn--sm">Search with <span className="kbd">⌘</span><span className="kbd">K</span></span>
          </div>
          <svg className="so-hand-arrow" width="64" height="24" viewBox="0 0 64 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h52M48 5l8 7-8 7" /></svg>
          <div className="so-hand-pal">
            <div className="so-hand-field"><span>export layers</span></div>
            <div className="so-hand-row" aria-current="true"><span className="so-hand-ic" />Export…<span className="so-hand-keys"><span className="kbd">⇧</span><span className="kbd">⌘</span><span className="kbd">E</span></span></div>
            <div className="so-hand-row"><span className="so-hand-ai"><Spark size={10} color="var(--spark-fg)" /></span>Ask AI: “export layers”</div>
          </div>
          <p className="so-hand-note">The sheet only knows keys. Search knows everything — so the sheet never dead-ends.</p>
        </div>

        <h2 data-no>Keep or kill<span className="h2-aside">labels on the sheet</span></h2>
        <div className="so-kk">
          <div className="so-kk-hd"><span className="so-ok">Keep</span><span className="so-bad">Kill</span></div>
          {KEEP_KILL.map((r) => (
            <div className="so-kk-row" key={r.keep}>
              <span className="so-kk-keep">{r.keep}</span>
              <span className="so-kk-kill">{r.kill}</span>
            </div>
          ))}
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · shortcuts sheet</span>
        <span>Key caps: see Keyboard · searching beyond keys: see Command palette</span>
      </footer>
    </>
  );
}
