/**
 * SPECIMEN — components-command-palette · maude-v2
 *
 * DEMONSTRATES: ⌘K — called "Search" everywhere in the UI ("command palette" is the DS name
 *   only, CONTRACT §3). One field that finds canvases (with real thumbnails), runs actions,
 *   hands a sentence to the AI ("Ask AI: …", the one spark row), and reaches every tool that
 *   left the visible chrome (Sync, Server, Logs, Version history, Advanced settings…). Matched
 *   text is highlighted with --accent-tint; group titles are quiet; shortcuts sit in key caps.
 * A11Y: combobox input (aria-expanded, aria-controls, aria-activedescendant tracking the active
 *   row) → listbox → role="group" per section (aria-labelledby its title) → role="option" rows
 *   with ids. "N found" / "Opened …" are announced through a polite live region. Static
 *   copies of rows below the hero carry no option role.
 * COMPOSITION: hero = a live palette over a slice of the canvas — type, use ↑ ↓ ↵, or pick a
 *   suggested query; then an anchored anatomy plate, "old words still work" (developer
 *   synonyms land on the designer-named tool and show where it lives), the five row kinds,
 *   and a right/wrong pair.
 * COPY VOICE: everyday verbs and the user's own canvases — no paths, ports or slash commands
 *   in results. Developer words are accepted as search input, never shown as labels.
 * NOTES: nothing is deleted, only hidden — every hidden-tool row names its other home as a
 *   path chip (Menu › Diagnostics, Menu › Settings › Advanced…), so search doubles as a map.
 *   Popover plane: --bg-2 + --shadow-lg + the island edge, like every menu.
 */
import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import "./_layout.css";
import "./components-command-palette.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — the maude-v2 family, 16-unit grid, 1.5 rounded stroke ───────── */
const GLYPH: Record<string, ReactNode> = {
  search: (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>),
  plus: <path d="M8 3v10M3 8h10" />,
  share: (<><path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" /><path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" /></>),
  export: (<><path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" /><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>),
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  sticky: (<><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>),
  panels: (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></>),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  sync: <path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3" />,
  server: (<><rect x="2.5" y="2.75" width="11" height="4.25" rx="1.5" /><rect x="2.5" y="9" width="11" height="4.25" rx="1.5" /><path d="M5 4.9h.01M5 11.1h.01" /></>),
  logs: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M6 8h4M6 10.5h4" /></>),
  settings: (<><path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" /><circle cx="8.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></>),
  bug: <path d="M5.5 6.75a2.5 2.5 0 0 1 5 0v3a2.5 2.5 0 0 1-5 0zM8 6.75v5.5M2.75 8.5h2.75M10.5 8.5h2.75M3.5 4.75l2 1.25M12.5 4.75l-2 1.25M3.5 12.5l2-1.25M12.5 12.5l-2-1.25" />,
  branch: (<><circle cx="4.5" cy="3.75" r="1.25" /><circle cx="4.5" cy="12.25" r="1.25" /><circle cx="11.5" cy="5.75" r="1.25" /><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-7 4" /></>),
  eye: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  print: (<><path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" /><path d="M4.5 9.5h7v4h-7z" /></>),
  keys: (<><rect x="1.75" y="4" width="12.5" height="8" rx="2" /><path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5.25 9.5h5.5" /></>),
  /* toolbar glyphs — verbatim from iconography.tsx GLYPHS */
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
  more: (<g className="cp-dots"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>),
  file: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M9 2.5v3h3" /></>),
};
/** Edit toolbar, left → right (CONTRACT §2). */
const TOOLBAR = ["select", "hand", "frame", "shape", "pen", "text", "image", "component", "more"];

function Ic({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="cp-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPH[id]}
    </svg>
  );
}

/** Key caps for a shortcut string — each glyph its own cap ("⇧⌘E" → ⇧ ⌘ E). */
function Keys({ k }: { k: string }) {
  const caps = k.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [];
  return (
    <span className="cp-keys">
      {caps.map((c, i) => <span className="kbd" key={i}>{c}</span>)}
    </span>
  );
}

/* ─── The index the palette searches ─────────────────────────────────────── */
type Kind = "canvas" | "action" | "tucked";
type Item = {
  id: string;
  kind: Kind;
  label: string;
  icon?: string;
  thumb?: string;
  meta?: string;
  keys?: string;
  where?: string;
  words: string[];
};

const INDEX: Item[] = [
  { id: "c-home", kind: "canvas", label: "Homepage", thumb: "coral", meta: "Studio site · edited 2 min ago", words: ["home", "landing"] },
  { id: "c-onb", kind: "canvas", label: "Onboarding", thumb: "yellow", meta: "Studio site · yesterday", words: ["welcome", "signup"] },
  { id: "c-pri", kind: "canvas", label: "Pricing", thumb: "green", meta: "Studio site · Tereza is here", words: ["plans", "price"] },
  { id: "c-mob", kind: "canvas", label: "Mobile — detail", thumb: "lilac", meta: "Studio site · last week", words: ["phone", "ios"] },
  { id: "c-brand", kind: "canvas", label: "Brand board", thumb: "sky", meta: "Alligators brand · Jonas", words: ["logo", "colours"] },

  { id: "a-new", kind: "action", label: "New canvas", icon: "plus", keys: "⌘N", words: ["create", "add", "blank"] },
  { id: "a-proj", kind: "action", label: "New project…", icon: "file", keys: "⇧⌘N", words: ["create", "repo", "folder", "workspace"] },
  { id: "a-share", kind: "action", label: "Share…", icon: "share", words: ["invite", "link", "send"] },
  { id: "a-export", kind: "action", label: "Export…", icon: "export", keys: "⇧⌘E", words: ["png", "pdf", "download", "handoff"] },
  { id: "a-comment", kind: "action", label: "Add a comment", icon: "comment", keys: "C", words: ["feedback", "note"] },
  { id: "a-sticky", kind: "action", label: "New sticky", icon: "sticky", keys: "N", words: ["note", "post-it"] },
  { id: "a-panels", kind: "action", label: "Hide panels", icon: "panels", keys: "⌘\\", words: ["sidebar", "toggle", "tree", "show panels", "fold"] },
  { id: "a-present", kind: "action", label: "Presentation mode", icon: "panels", words: ["slideshow", "fullscreen", "present"] },
  { id: "a-keys", kind: "action", label: "Keyboard shortcuts", icon: "keys", keys: "?", words: ["shortcut", "hotkey", "help"] },

  { id: "t-history", kind: "tucked", label: "Version history", icon: "history", keys: "⌥⌘H", where: "Menu › Version history", words: ["commit", "git", "restore", "changes", "save", "undo"] },
  { id: "t-sync", kind: "tucked", label: "Sync", icon: "sync", where: "Menu › Diagnostics", words: ["cloud", "hub", "resync", "download all", "offline"] },
  { id: "t-server", kind: "tucked", label: "Server", icon: "server", where: "Menu › Diagnostics", words: ["port", "localhost", "pid", "restart", "reconnect"] },
  { id: "t-logs", kind: "tucked", label: "Logs", icon: "logs", where: "Menu › Diagnostics", words: ["console", "errors", "debug"] },
  { id: "t-bug", kind: "tucked", label: "Report a bug…", icon: "bug", where: "Menu › Help", words: ["issue", "problem", "feedback"] },
  { id: "t-branch", kind: "tucked", label: "Branches", icon: "branch", where: "Menu › Version history › Advanced", words: ["branch", "git", "pr", "pull request", "sha", "fetch"] },
  { id: "t-adv", kind: "tucked", label: "Advanced settings", icon: "settings", where: "Menu › Settings › Advanced", words: ["model", "effort", "api key", "provider", "token", "figma token"] },
  { id: "t-print", kind: "tucked", label: "Print guides", icon: "print", where: "Menu › View › Advanced", words: ["bleed", "margins", "a4"] },
  { id: "t-hidden", kind: "tucked", label: "Hidden files", icon: "eye", where: "Menu › View › Advanced", words: ["dotfiles", "sidecar", "meta", "show hidden files"] },
];

const BY_ID = Object.fromEntries(INDEX.map((i) => [i.id, i]));
const SUGGESTED = ["a-new", "a-share", "a-export"];
const RECENT = ["c-home", "c-pri", "c-onb", "c-mob"];
const GROUPS: { kind: Kind; title: string; aside?: string }[] = [
  { kind: "canvas", title: "Canvases" },
  { kind: "action", title: "Actions" },
  { kind: "tucked", title: "Hidden tools", aside: "found by search" },
];
const TRY = ["pr", "sync", "commit", "port", "pricng", "make the hero warmer"];

type Hit = { item: Item; at: number; via?: string };

function search(q: string): Hit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: Hit[] = [];
  for (const item of INDEX) {
    const at = item.label.toLowerCase().indexOf(needle);
    if (at >= 0) { hits.push({ item, at }); continue; }
    const via = item.words.find((w) => w.includes(needle));
    if (via) hits.push({ item, at: -1, via });
  }
  return hits;
}

/** Label with the matched run marked. */
function Match({ text, at, len }: { text: string; at: number; len: number }) {
  if (at < 0 || len === 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="cp-mark">{text.slice(at, at + len)}</mark>
      {text.slice(at + len)}
    </>
  );
}

/** One result row. `optionId` set = a live listbox option; omitted = a static picture of a row. */
function Row({ hit, q, active = false, optionId, onHover, onPick }: { hit: Hit; q: string; active?: boolean; optionId?: string; onHover?: () => void; onPick?: () => void }) {
  const { item } = hit;
  const live = optionId !== undefined;
  return (
    <div
      className={`cp-row${active ? " is-active" : ""}`}
      id={optionId}
      role={live ? "option" : undefined}
      aria-selected={live ? active : undefined}
      onMouseEnter={onHover}
      onMouseDown={live ? (e) => { e.preventDefault(); onPick?.(); } : undefined}
    >
      {item.thumb ? <span className={`cp-thumb cp-th-${item.thumb}`} aria-hidden="true" /> : <span className="cp-row-ic"><Ic id={item.icon ?? "search"} /></span>}
      <span className="cp-row-label">
        <span className="cp-label-text"><Match text={item.label} at={hit.at} len={q.trim().length} /></span>
        {hit.via ? <span className="cp-via">matches “{hit.via}”</span> : null}
      </span>
      {item.meta ? <span className="cp-row-meta">{item.meta}</span> : null}
      {item.where ? <span className="chip cp-where">{item.where}</span> : null}
      {item.keys ? <Keys k={item.keys} /> : null}
    </div>
  );
}

function AskRow({ q, active = false, optionId, onHover, onPick }: { q: string; active?: boolean; optionId?: string; onHover?: () => void; onPick?: () => void }) {
  const live = optionId !== undefined;
  return (
    <div
      className={`cp-row cp-ask${active ? " is-active" : ""}`}
      id={optionId}
      role={live ? "option" : undefined}
      aria-selected={live ? active : undefined}
      onMouseEnter={onHover}
      onMouseDown={live ? (e) => { e.preventDefault(); onPick?.(); } : undefined}
    >
      <span className="cp-ask-ic" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span>
      <span className="cp-row-label">
        Ask AI{q.trim() ? <>: <span className="cp-ask-q">“{q.trim()}”</span></> : <span className="cp-row-meta"> — describe what you want on the canvas</span>}
      </span>
      <Keys k="⌘↵" />
    </div>
  );
}

/** The one no-results line — CONTRACT §4, word for word. */
function NoResults({ q, className = "" }: { q: string; className?: string }) {
  return <p className={`cp-none ${className}`}>Nothing called “{q}”. Try another word, or ask AI to find it.</p>;
}

/* ─── Hero: the live palette ─────────────────────────────────────────────── */
function LivePalette() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listId = `cp-results-${uid}`;
  const optId = (n: number) => `cp-opt-${uid}-${n}`;
  const [q, setQ] = useState("pr");
  const [active, setActive] = useState(0);
  const [ran, setRan] = useState<string | null>(null);
  const hits = useMemo(() => search(q), [q]);
  const empty = !q.trim();

  // Flat order = what ↑ ↓ walk through; the Ask-AI row is always last.
  const flat: (Hit | "ask")[] = empty
    ? [...SUGGESTED.map((id) => ({ item: BY_ID[id], at: -1 })), "ask"]
    : [...GROUPS.flatMap((g) => hits.filter((h) => h.item.kind === g.kind)), "ask"];
  const clamp = Math.min(active, flat.length - 1);

  function run(entry: Hit | "ask") {
    if (entry === "ask") setRan(q.trim() ? `Sent to AI: “${q.trim()}”` : "Ask AI is open");
    else setRan(`Opened ${entry.item.label}`);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(flat[clamp]); }
    else if (e.key === "Escape") { setQ(""); setActive(0); setRan(null); }
  }

  function pick(next: string) { setQ(next); setActive(0); setRan(null); }

  let idx = -1;
  const next = () => { idx += 1; return idx; };
  const announce = ran ?? (empty ? "Recent" : `${hits.length} found`);

  return (
    <>
      <div className="stage cp-hero">
        <div className="cp-bg" aria-hidden="true">
          <div className="cp-bg-board cp-bg-b1"><span className="cp-bg-img cp-th-coral" /><span className="cp-bg-line" /></div>
          <div className="cp-bg-board cp-bg-b2"><span className="cp-bg-img cp-th-green" /><span className="cp-bg-line" /></div>
          <div className="sticky sticky--yellow cp-bg-st">Bigger photo in the hero?</div>
          <div className="island dock cp-bg-dock">
            {TOOLBAR.map((g) => <span className="icon-btn" key={g}><Ic id={g} size={18} /></span>)}
          </div>
        </div>

        <div className="cp-palette" role="dialog" aria-label="Search">
          <div className="cp-field">
            <Ic id="search" size={18} />
            <input
              value={q}
              onChange={(e) => pick(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search canvases, actions, or ask AI…"
              aria-label="Search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={optId(clamp)}
            />
            <span className="kbd" aria-hidden="true">esc</span>
          </div>

          {empty ? (
            <div className="cp-recent-wrap" role="group" aria-labelledby={`cp-recent-${uid}`}>
              <p className="island-title cp-gt" id={`cp-recent-${uid}`}>Recent canvases</p>
              <div className="cp-recent">
                {RECENT.map((id) => (
                  <button type="button" className="cp-card" key={id} onClick={() => setRan(`Opened ${BY_ID[id].label}`)}>
                    <span className={`cp-card-img cp-th-${BY_ID[id].thumb}`} aria-hidden="true" />
                    <span>{BY_ID[id].label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cp-results" id={listId} role="listbox" aria-label="Results">
            {empty ? (
              <div className="cp-group" role="group" aria-labelledby={`cp-g-sug-${uid}`}>
                <div className="island-title cp-gt" id={`cp-g-sug-${uid}`} role="presentation">Suggested</div>
                {SUGGESTED.map((id) => {
                  const n = next();
                  return <Row key={id} hit={{ item: BY_ID[id], at: -1 }} q="" active={n === clamp} optionId={optId(n)} onHover={() => setActive(n)} onPick={() => run(flat[n])} />;
                })}
              </div>
            ) : (
              GROUPS.map((g) => {
                const rows = hits.filter((h) => h.item.kind === g.kind);
                if (!rows.length) return null;
                const gid = `cp-g-${g.kind}-${uid}`;
                return (
                  <div key={g.kind} className="cp-group" role="group" aria-labelledby={gid}>
                    <div className="island-title cp-gt" id={gid} role="presentation">{g.title}{g.aside ? <span className="cp-gt-aside">{g.aside}</span> : null}</div>
                    {rows.map((h) => {
                      const n = next();
                      return <Row key={h.item.id} hit={h} q={q} active={n === clamp} optionId={optId(n)} onHover={() => setActive(n)} onPick={() => run(flat[n])} />;
                    })}
                  </div>
                );
              })
            )}
            <div className="cp-ask-wrap" role="group" aria-label="AI">
              {(() => { const n = next(); return <AskRow q={q} active={n === clamp} optionId={optId(n)} onHover={() => setActive(n)} onPick={() => run("ask")} />; })()}
            </div>
          </div>
          {!empty && hits.length === 0 ? <NoResults q={q.trim()} /> : null}

          <div className="cp-foot">
            <span className="cp-hints" aria-hidden="true">
              <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
              <span><span className="kbd">↵</span> open</span>
              <span><Keys k="⌘↵" /> ask AI</span>
            </span>
            <span className={`cp-count${ran ? " cp-ran" : ""}`} role="status" aria-live="polite">{announce}</span>
          </div>
        </div>
      </div>

      <div className="cp-try" role="group" aria-label="Try a search">
        <span className="cp-try-label" aria-hidden="true">Try</span>
        {TRY.map((t) => (
          <button type="button" key={t} className={`btn btn--sm ${q === t ? "" : "btn--ghost"}`} aria-pressed={q === t} onClick={() => pick(t)}>{t}</button>
        ))}
        <button type="button" className="btn btn--sm btn--ghost" aria-pressed={empty} onClick={() => pick("")}>empty field</button>
      </div>
    </>
  );
}

/* ─── Anatomy pins — anchored to the element they describe ──────────────── */
function Pin({ n, side = "right" }: { n: number; side?: "left" | "right" }) {
  return <span className={`cp-pin cp-pin--${side}`} aria-hidden="true">{n}</span>;
}

const ANATOMY = [
  ["Field", "One input, always focused. The placeholder says the three things it does."],
  ["Group title", "Quiet, sentence case. Groups appear only when they have results."],
  ["Canvas row", "A real thumbnail and where it lives. Your work reads before any tool."],
  ["Active row", "Azure tint — the one selection on the sheet. ↑ ↓ moves it."],
  ["Hidden-tool row", "Names its other home as a Menu › path, so search teaches the menu."],
  ["Ask AI", "Always last, always there. The only spark in the palette."],
];

const SYNONYMS = [
  { typed: "commit", id: "t-history", path: ["Menu", "Version history"] },
  { typed: "port", id: "t-server", path: ["Menu", "Diagnostics", "Server"] },
  { typed: "resync", id: "t-sync", path: ["Menu", "Diagnostics", "Sync"] },
  { typed: "branch", id: "t-branch", path: ["Menu", "Version history", "Advanced", "Branches"] },
  { typed: "api key", id: "t-adv", path: ["Menu", "Settings", "Advanced"] },
  { typed: "console", id: "t-logs", path: ["Menu", "Diagnostics", "Logs"] },
];

export default function ComponentsCommandPalette() {
  return (
    <>
      <SpecimenHeader crumbs={["Components", "Command palette"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>⌘K finds everything — even the tools out of sight.</h1>
          <p className="lede">
            In the app it is simply Search: one field for your canvases, every action, and the AI. The
            tools that left the chrome — sync, the server, logs, version history, advanced settings — are
            one search away, and each result shows where it lives. Nothing was deleted.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Opens with</dt><dd>⌘K, anywhere</dd></div>
          <div><dt>Called</dt><dd>Search (DS name: command palette)</dd></div>
          <div><dt>Searches</dt><dd>canvases · actions · hidden tools</dd></div>
          <div><dt>Always last</dt><dd>Ask AI with what you typed</dd></div>
          <div><dt>Plane</dt><dd>popover — opaque, largest shadow</dd></div>
        </dl>

        <h2 data-no>Try it<span className="h2-aside">type, use ↑ ↓ ↵, or pick a search below</span></h2>
        <LivePalette />

        <h2 data-no>Anatomy<span className="h2-aside">each pin sits on the part it names</span></h2>
        <div className="cp-anatomy">
          <div className="cp-palette cp-static" role="img" aria-label="Search, taken apart: the field with “pri” typed, the Canvases title, the active Pricing row, a hidden-tool row for Print guides, and the Ask AI row last.">
            <div className="cp-field cp-rel"><Ic id="search" size={18} /><span className="cp-typed">pri</span><span className="kbd">esc</span><Pin n={1} /></div>
            <div className="cp-results">
              <p className="island-title cp-gt cp-rel">Canvases<Pin n={2} /></p>
              <div className="cp-rel"><Row hit={{ item: BY_ID["c-pri"], at: 0 }} q="pri" active={true} /><Pin n={3} side="left" /><Pin n={4} /></div>
              <p className="island-title cp-gt">Hidden tools<span className="cp-gt-aside">found by search</span></p>
              <div className="cp-rel"><Row hit={{ item: BY_ID["t-print"], at: 0 }} q="pri" /><Pin n={5} /></div>
              <div className="cp-ask-wrap cp-rel"><AskRow q="pricing with a yearly toggle" /><Pin n={6} /></div>
            </div>
          </div>
          <ol className="cp-legend">
            {ANATOMY.map(([t, d], i) => (
              <li key={t}><span className="cp-pin cp-pin--inline">{i + 1}</span><div><strong>{t}</strong><span>{d}</span></div></li>
            ))}
          </ol>
        </div>

        <h2 data-no>Old words still work<span className="h2-aside">type the developer word, get the designer tool</span></h2>
        <p>
          People who knew Maude before will reach for <em>commit</em>, <em>port</em> or <em>branch</em>. Search
          accepts those words as input and answers with the tool's everyday name — plus the path to it, so
          next time they can go straight there.
        </p>
        <div className="cp-syn">
          {SYNONYMS.map((s) => {
            const item = BY_ID[s.id];
            return (
              <div className="cp-syn-card" key={s.typed}>
                <div className="cp-syn-q"><Ic id="search" /><span>{s.typed}</span></div>
                <div className="cp-syn-hit">
                  <span className="cp-row-ic"><Ic id={item.icon ?? "search"} /></span>
                  <strong>{item.label}</strong>
                </div>
                <div className="cp-syn-path">
                  {s.path.map((p, i) => <span key={p}>{i ? <span className="cp-syn-sep">› </span> : null}{p}</span>)}
                </div>
              </div>
            );
          })}
        </div>

        <h2 data-no>Row kinds</h2>
        <div className="cp-kinds">
          <div className="cp-kind">
            <span className="cp-kind-name">Canvas</span>
            <Row hit={{ item: BY_ID["c-home"], at: -1 }} q="" />
          </div>
          <div className="cp-kind">
            <span className="cp-kind-name">Action</span>
            <Row hit={{ item: BY_ID["a-export"], at: -1 }} q="" />
          </div>
          <div className="cp-kind">
            <span className="cp-kind-name">Hidden tool</span>
            <Row hit={{ item: BY_ID["t-sync"], at: -1 }} q="" />
          </div>
          <div className="cp-kind">
            <span className="cp-kind-name">Ask AI</span>
            <AskRow q="three hero variants, warmer" />
          </div>
          <div className="cp-kind">
            <span className="cp-kind-name">No match</span>
            <NoResults q="pricng" className="cp-none--row" />
          </div>
        </div>

        <h2 data-no>One job per row</h2>
        <div className="cp-compare">
          <figure className="cp-case">
            <div className="cp-palette cp-mini" role="img" aria-label="Right: searching “logs” finds Logs, with its path Menu › Diagnostics, then the Ask AI row.">
              <div className="cp-field"><Ic id="search" /><span className="cp-typed">logs</span></div>
              <div className="cp-results">
                <Row hit={{ item: BY_ID["t-logs"], at: 0 }} q="logs" active={true} />
                <div className="cp-ask-wrap"><AskRow q="logs" /></div>
              </div>
            </div>
            <figcaption><strong className="cp-ok">Right</strong> Everyday name, where it lives, azure on the one active row. The spark only on the AI row.</figcaption>
          </figure>
          <figure className="cp-case">
            <div className="cp-palette cp-mini cp-wrong" role="img" aria-label="Wrong: rows labelled with a slash command, a file path and a port, each with a spark.">
              <div className="cp-field"><Ic id="search" /><span className="cp-typed">logs</span></div>
              <div className="cp-results">
                <div className="cp-row cp-w-row"><Spark size={12} color="var(--spark)" /><span className="cp-row-label mono">/design:smoke --logs</span></div>
                <div className="cp-row cp-w-row"><Spark size={12} color="var(--spark)" /><span className="cp-row-label mono">.design/_server.json</span></div>
                <div className="cp-row cp-w-row"><Spark size={12} color="var(--spark)" /><span className="cp-row-label mono">localhost:4402 · pid 29598</span></div>
              </div>
            </div>
            <figcaption><strong className="cp-bad">Wrong</strong> Slash commands, file paths and ports as labels, and a spark on rows the AI has nothing to do with.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · command palette</span>
        <span>Nothing deleted, only hidden — ⌘K reaches every hidden tool</span>
      </footer>
    </>
  );
}
