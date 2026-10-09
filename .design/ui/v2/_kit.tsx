/**
 * @file     _kit.tsx — the maude-v2 app chrome as reusable, prop-driven pieces
 * @ds       maude-v2 (CONTRACT.md wins over everything here)
 * @lifted   preview/ui_kits-desktop-showcase.tsx (+ .css) — window, project tabs, project pill,
 *           Canvases panel, toolbar, Share cluster, undo/zoom, AI chat panel, inspector, the one
 *           menu, Search, Home, thumbnails · preview/iconography.tsx — the glyph family ·
 *           preview/_specimen-controls.tsx — Mark + Spark (verbatim paths, never redrawn).
 *
 * Underscore file ⇒ hidden from the canvas tree. Canvas agents NEVER edit this file — build a
 * local piece in your canvas and list it as a "kit candidate" instead.
 *
 * ─── Gate 0 (signed by Michal 2026-10-08; CONTRACT.md carries the full set) ─────────────────
 * What the run builds where this kit draws more, or differently:
 *   · Project tabs are NATIVE macOS window tabs [A1]. The tab avatar / initial / status glyphs and
 *     the custom tab right-click menu (`Window tabMenu`) are NOT built — that state lives in the
 *     project pill and the Share cluster; right-click is the native tab menu; "Sign in as another
 *     account…" is in the project pill menu. Treat `Tab.initial/account/unsaved/syncing` as mock-only.
 *   · The tool is "Stickers (E)" [C12]; "stamp" means a vote stamp only. Packs: FigJam Doodle ·
 *     Life Style · Opposing Thoughts · Project status [C13].
 *   · Marker tips Marker · Highlighter · Eraser; inks Ink · red · amber · green · blue + more [C14].
 *   · Comments float on the RIGHT, like the AI chat panel [C8]; filters Open · Mine · Resolved · All [C7].
 *   · Save status has a fifth word "Not saved" (+ Retry) only while true [C2].
 *   · One Share sheet everywhere (10's), incl. a local project's "Move to cloud…" [C11].
 *   · The AI chat panel header is 03's canonical one [C28]; no AI chat for Can view / Can comment [C30].
 *
 * Every canvas imports, in this order:
 *   import "../../system/maude-v2/colors_and_type.css";
 *   import "../../system/maude-v2/preview/_components.css";
 *   import "./_kit.css";
 *
 * STATIC MOCKS. Nothing here is a real <button>/<input>: chrome is spans + divs styled with the DS
 * classes (.island .btn .icon-btn .chip .kbd .row-item .seg .switch .ask .sticky), so a screen
 * adds zero tab stops and Maude's own Cmd+Click inspector still reaches every element (no
 * `inert`, which would also block pointer events). A <Window> is one role="img" picture with an
 * aria-label; everything inside it is presentational.
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────────────────────
 * Layout + scope
 *   V2({ theme?: "light"|"dark", children, className?, style? })   .maude-v2[data-theme] scope, fills its parent.
 *   Stage({ theme?, note?, children, noteWidth? })                 V2 + a 1440×900 window slot + a note strip under it
 *                                                                    (use an artboard of 1440 × 980). `note` = a <Note>.
 *   Window({ tabs, activeTab?, children, height?, label? })        macOS window: lights + native project tabs + "+".
 *                                                                    tabs: Tab[]; activeTab: index | tab name | "home".
 *                                                                    height = whole window incl. 40px title bar (default 900).
 *                                                                    tabMenu = tab index whose right-click menu is open (CONTRACT §6).
 *     type Tab = { name, initial?, color?: Tone, account?, unsaved?, syncing?, local?, home? }
 *     initial = the PROJECT initial (S = Studio site, A = Alligators brand) — CONTRACT §6.
 *   TABS.studio · TABS.alligators · TABS.home — ready-made tabs.
 *   Canvas({ children, dots? = true, dim? })                      the dotted canvas filling the window body (relative;
 *                                                                    children absolutely positioned in body px).
 *   Veil()                                                         dims the canvas under a sheet / Search.
 * Glyphs + people
 *   Icon({ name, size? = 16, className? })                         GLYPH_NAMES lists every name. DS family + kit additions.
 *   Mark({ size?, tile?, star? }) · Spark({ size?, color? })       logo mark + the AI spark (verbatim).
 *   Avatar({ who | ini, tone?, size?: "sm"|"md"|"lg" })            PEOPLE: you (M, yellow) · tereza (T, sky) · jonas (J, green).
 *   Kbd({ children })
 *   Thumb({ art, w?, h?, className? })                             tiny artboard picture from object colours. ART_NAMES.
 *   KindGlyph({ kind })                                            web | digital | print | video.
 *   StatusWord({ state: "ok"|"warn"|"error"|"busy"|"off", children })
 * Panels (positioned like the showcase inside the window body; pass style to move one)
 *   ProjectPill({ project, canvas?, folded?, open?, home? })
 *   ProjectMenu({ open?: "file"|"edit"|"view"|"help"|"diagnostics"|null, highlight?, advanced?, diag?, checked?: string[] })
 *       CONTRACT §1 tree exactly. highlight = a row label to mark (main or submenu). advanced = expand the
 *       open submenu's Advanced group. diag = { sync?, server?, ai?: [word, state] } status words.
 *   CanvasesPanel(system?: {name,meta,selected,ai} (pinned Design system row), { project, count?, folders?, items?, recents?, selected?, tab?: "canvases"|"layers",
 *                   search?, folded?, layers?, empty?, tooltip?, foot?, advanced? })
 *       advanced = the quiet Advanced row at the panel's foot (off by default).
 *       CanvasItem = { name, art?, people?: Who[], ai?: string|boolean, kinds?: Kind[], meta?, dim?, local?, sub? }
 *       sub = a second line under the name (folder path, "matches …") — the name keeps the full width.
 *       With `search`, top-level item names mark the match (accent-insensitive). foot = a line inside the panel's foot.
 *       Folder     = { name, open?, count?, items?: CanvasItem[], folders?: Folder[] }
 *       LayerRow   = { name, icon, depth?, selected?, hidden?, locked? }
 *       tooltip    = { text, row: name } — shows the full label of a truncated row.
 *   Toolbar({ mode? = "edit", tool?, more?, folded?, tip?, swatches?, color?, ink?, keys?, only?, inline? })
 *       CONTRACT §2 — TWO toolbars, one per mode:
 *       mode "edit"     (default) TOOLS: Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I
 *                       · More (MORE_TOOLS: Line · Ellipse · Polygon · Crop · Export area). Tools that make things inside
 *                       artboards. tool defaults to "select"; `more` opens the More popover.
 *       mode "annotate" Preview's toolbar, ANNOTATE_TOOLS: Hand H | Sticky N · Comment C · Marker M · Arrow A · Shape R ·
 *                       Text T · Stamp E · Section S — FigJam-style, 48px buttons (a size bigger). tool defaults to "hand".
 *                       swatches: "sticky" | "marker" opens the colour row above that tool (Marker adds Marker · Highlighter);
 *                       color = Sticky's colour, ink = Marker's ink (Swatch: yellow coral green sky lilac).
 *       A `tool` that only exists in Preview (sticky comment marker arrow stamp section) with no `mode` renders the
 *       annotate toolbar — the key switches to Preview with that tool (CONTRACT §2).
 *       tip = tool id whose tooltip (label + key) shows · keys = key letters in each button's corner ·
 *       only = tool ids to show (Can comment: mode="annotate" only={["hand","comment"]}; add "more" to keep More in Edit) ·
 *       inline = static in a close-up instead of pinned bottom-centre.
 *   ToolbarMorph({ t, inline? })    Edit → annotate morph frame at t ms on --dur-panel 220 (0 = Edit, ≥ 220 = Preview).
 *   AnnotateIcon({ id, color?, ink?, size? = 22 })   one annotation tool drawn the FigJam way (key charts, legends).
 *   easeOut(x)                      --ease-out progress at time fraction x (for filmstrips).
 *   ShareCluster({ people?, status?: "saved"|"syncing"|"offline"|"local"|"error", statusText?,  mode?: "edit"|"preview"|"present"|"viewing" (shows ModeSwitch), canEdit?, access?,    (words per CONTRACT §6)
 *                  panelsButton? = true, zen?, comments? })
 *   ZoomUndo({ zoom? = 100, folded? })
 *   AIPanel({ folded?, messages?, chips?, working?, step?, sessions?, prompt?, placeholder?, scope?, question?, title?,
 *            chat?, count?, runs?, advanced?, children?, attach?, banner?, above?, drop?, free?, dim?, className? })
 *       messages: { from: "you"|"ai", text }[] · working: string — the SAME words as the artboard's tag; step = detail line
 *       sessions: number | { list: Session[], open?: boolean }  Session = { title, state: "working"|"done"|"waiting"|"idle", where?, current? }
 *       question: { text, primary, secondary? }   (an AI permission / choice, inline — never a modal)
 *       CANONICAL (03 AI Chat) — pass `chat` = the chat title: header becomes title ⌄ (opens the chat list) + a compact
 *       "✦ N" count of YOUR running chats (count, or derived from runs.yours) and the panel is 340 wide.
 *       runs = { yours: AIRun[], canvas?: AIRun[], open?, all? = 41 | false } — the list under the count: "Yours", then
 *       "On this canvas" (other people's AI on THIS canvas, always View only — never counted as yours), then All chats.
 *       AIRun = { title, where, state: "working"|"waiting"|"needs"|"done", who?, current? }.  Also exported: AIRunList, AIRunIcon.
 *       advanced: true = the quiet Advanced row at the foot · ReactNode = the opened Advanced (draw its own header).
 *       children = rich conversation content; attach/banner/above sit over the field; free = static in a close-up.
 *       Every new prop is optional — with none of them the panel renders exactly as before.
 *   Inspector({ title, kind?, rows, advancedOpen?, advanced?: [k, v][], style? })
 *       rows: [label, ReactNode][] — use the In* helpers for values:
 *       InSelect({ value }) · InSize({ w, h }) · InFill({ name, tone?, pct? }) · InNum({ value, icon? })
 *       InSwitch({ on }) · InButton({ children, icon? }) · InSeg({ options, value })
 *   PanelIcon({ icon, at: "left"|"ai"|"dock"|"insp", dot? })      a panel folded into its icon (⌘\).
 * On the canvas
 *   Artboard({ label, w, h, x, y, selected?, size?, aiWorking?, aiAt?, aiCursor?, aiMade?, kind?, children, dim?, page? })
 *       a mock artboard: label above (+ kind glyph), selection ring + azure size tag, AI dashed spark outline.
 *       aiAt: "corner" (tag in the label row, right — default when it fits) | "below" (under the artboard,
 *       right — default when it doesn't) | "art" (old look, cursor + tag on the art). aiCursor: {x, y} in px
 *       or % — park the AI cursor on the fill it changes (default 84 % / 74 %), false = none.
 *       aiMade: a quiet "Made by AI" mark in the label row once AI has finished.
 *       The page (children) is pinned to the light palette (.maude-v2.k-fixed[data-theme=light]) — the
 *       user's design never re-colours with the app theme. Same for every *Mock and Thumb.
 *   Selection({ x, y, w, h, label?, editing? })                    a selected frame/text inside an artboard.
 *   Sticky({ color, children, x, y, rotate?, w? })
 *   Cursor({ name, color?: Tone, x, y, agent?, label?, tag? = true })  agent = the spark-coloured AI cursor.
 *                                                                    tag={false} = your own pointer (never labelled).
 *   CommentPin({ who, x, y, text?, count? })
 *   HeroMock · PricingMock · PosterMock · PhoneMock · VideoFrameMock · GatorMock({ variant })
 *       picture content in --object-* colours that fills its artboard. Theme-fixed (light scope, class
 *       k-fixed) — a capture script that flips [data-theme] must skip .k-fixed. GatorMock variants:
 *       "web" | "poster" | "social" | "reel" | "print" | "jersey" | "invite" | "numbers".
 * Overlays
 *   Toast({ children, action?, icon?, at?: "dock"|"top" })        one action at most (CONTRACT §4).
 *   Dialog({ title, children, primary, secondary? = "Cancel", danger?, width? })  (alias: Sheet)
 *   ConnectSheet({ width? = 440, style?, inline? })   CONTRACT §7 "Connect your Claude account?" — the one layout
 *       (account option + Advanced · Use an API key instead). Window sheet over <Veil strong />; inline in close-ups.
 *   Menu({ items, style?, width? })   MenuItem = { label, keys?, icon?, sub?, checked?, highlight?, disabled?, note? } | "sep" | { group }
 *   SearchPalette({ query, groups, footer?, empty? })
 *       group = { title, aside?, rows: { label, art?, icon?, meta?, where?, via?, selected? }[] }
 *   Tooltip({ text, x, y, below? })
 *   Home({ prompt?, placeholder?, target?, recents?, projects?, starters?, sending? })   "What shall we make?"
 * Explainers (outside the window)
 *   Note({ n?, title, children })    caption, ≤ 60ch.
 *   Callout({ n, x?, y?, style?, outline? })   numbered ink dot; absolute when x/y given. outline = the in-window marker
 *                                    look (open ring) so it never reads as a Note badge.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";

/* ═══ Glyphs ═══════════════════════════════════════════════════════════════════════════════ */

/* The DS family — copied verbatim from preview/iconography.tsx GLYPHS (16 grid, 1.5 stroke),
   plus the extra shell glyphs the showcase already uses (print, server, folder, corner, cloud,
   sync, plus, close, undo, redo). */
const FAMILY: Record<string, ReactNode> = {
  select: <path d="M3.5 2.5l9 4.5-4 1.3-1.5 4.2z" />,
  hand: <path d="M5.5 9V4.5a1 1 0 0 1 2 0V8M7.5 7.5V3.5a1 1 0 0 1 2 0V8M9.5 8V4.5a1 1 0 0 1 2 0v5c0 2.5-1.7 4-4 4h-.6c-1.3 0-2.3-.6-3-1.6L2.4 9.3a1 1 0 0 1 1.6-1.2l1.5 1.7" />,
  frame: <path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11" />,
  shape: (<><rect x="2.5" y="2.5" width="7" height="7" rx="1.5" /><circle cx="10.25" cy="10.25" r="3.5" /></>),
  pen: (<><path d="M10.25 3.25l2.5 2.5L6 12.5l-3.25.75.75-3.25z" /><path d="M8.75 4.75l2.5 2.5" /></>),
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
  sticky: (<><path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5L9 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z" /><path d="M13.5 9h-3A1.5 1.5 0 0 0 9 10.5v3" /></>),
  comment: <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />,
  more: (<g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g>),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  home: <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />,
  file: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M9 2.5v3h3" /></>),
  edit: (<><path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z" /><path d="M3 13.5h10" /></>),
  view: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  help: (<><circle cx="8" cy="8" r="5.75" /><path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" /></>),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  share: (<><path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" /><path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" /></>),
  export: (<><path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" /><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>),
  pulse: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" />,
  settings: (<><path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" /><circle cx="8.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></>),
  search: (<><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25l3.25 3.25" /></>),
  "panel-left": (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M6 3v10" /></>),
  "panel-right": (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M10 3v10" /></>),
  collapse: <path d="M2.5 9.5h4v4M13.5 6.5h-4v-4M6.5 9.5l-4 4M9.5 6.5l4-4" />,
  layers: <path d="M8 2.5l5.5 3.25L8 9 2.5 5.75zM2.5 9.25L8 12.5l5.5-3.25" />,
  tab: <path d="M1.5 13.5h2v-7A2.5 2.5 0 0 1 6 4h4a2.5 2.5 0 0 1 2.5 2.5v7h2" />,
  menu: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  done: (<><circle cx="8" cy="8" r="5.75" /><path d="M5.5 8.25l1.75 1.75 3.25-3.75" /></>),
  problem: (<><path d="M8 2.75l5.75 10H2.25z" /><path d="M8 6.75v2.5M8 11h.01" /></>),
  /* showcase shell extras */
  print: (<><path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1" /><path d="M4.5 9.5h7v4h-7z" /></>),
  server: (<><rect x="2.5" y="2.75" width="11" height="4.25" rx="1.5" /><rect x="2.5" y="9" width="11" height="4.25" rx="1.5" /><path d="M5 4.9h.01M5 11.1h.01" /></>),
  folder: <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5L8 4.5h4A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z" />,
  corner: <path d="M3.5 12.5V8a4.5 4.5 0 0 1 4.5-4.5h4.5" />,
  cloud: <path d="M4.75 12.5a2.75 2.75 0 0 1-.4-5.47A3.75 3.75 0 0 1 11.6 6a3.25 3.25 0 0 1 .15 6.5zM6.25 9.5l1.25 1.25 2.25-2.5" />,
  sync: <path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3" />,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  undo: <path d="M6 3.5L3 6.5l3 3M3 6.5h6.25a3.75 3.75 0 0 1 0 7.5H7.5" />,
  redo: <path d="M10 3.5l3 3-3 3M13 6.5H6.75a3.75 3.75 0 0 0 0 7.5H8.5" />,
};

/* KIT ADDITIONS — not yet in the DS family; drawn in the same hand (16 grid, live area 2–14,
   1.5 round stroke) for the four artboard kinds, the More tools and a few states.
   Promote into preview/iconography.tsx GLYPHS when the DS next moves. */
const KIT_GLYPHS: Record<string, ReactNode> = {
  component: (<><path d="M8 1.75l2.25 2.25L8 6.25 5.75 4z" /><path d="M8 9.75l2.25 2.25L8 14.25 5.75 12z" /><path d="M4 5.75l2.25 2.25L4 10.25 1.75 8z" /><path d="M12 5.75l2.25 2.25L12 10.25 9.75 8z" /></>),
  line: <path d="M3 13L13 3" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  polygon: <path d="M8 2.25l5.5 4-2.1 6.5H4.6l-2.1-6.5z" />,
  crop: <path d="M4.5 1.75v9.75h9.75M1.75 4.5h9.75v9.75" />,
  slice: (<><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2 2" /><path d="M5.5 10.5l5-5" /></>),
  system: (<><rect x="2.5" y="2.5" width="4.75" height="4.75" rx="1.25" /><rect x="8.75" y="2.5" width="4.75" height="4.75" rx="1.25" /><rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1.25" /><circle cx="11.125" cy="11.125" r="2.375" /></>),
  terminal: (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M5 6.5l2 1.5-2 1.5M8.75 10h2.5" /></>),
  web: (<><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M2 6.25h12M4.5 4.65h.01M6.25 4.65h.01" /></>),
  digital: (<><rect x="4.5" y="2" width="7" height="12" rx="2" /><path d="M7.25 11.75h1.5" /></>),
  video: (<><rect x="2" y="3.5" width="12" height="9" rx="2.5" /><path d="M6.75 6.1v3.8L9.9 8z" /></>),
  image: (<><rect x="2.5" y="3" width="11" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.25" /><path d="M2.75 11.5l3.25-3 2.5 2.25 1.75-1.5 3 2.5" /></>),
  arrow: <path d="M3 13L13 3M7.5 3H13v5.5" />,
  highlighter: (<><path d="M9.5 2.75l3.75 3.75-5.5 5.5H4v-3.75z" /><path d="M2.5 13.5h5" /></>),
  marker: (<><path d="M10.75 2.75l2.5 2.5-6 6-2.5-2.5z" /><path d="M4.75 8.75L3 13l4.25-1.75" /></>),
  stamp: (<><circle className="k-stamp-disc" cx="8" cy="8" r="5.75" /><path d="M5.6 9.4a2.9 2.9 0 0 0 4.8 0" /><path d="M6.1 6.4h.01M9.9 6.4h.01" strokeWidth={2} /></>),
  section: (<><path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" /><path d="M5.5 6h5" /></>),
  eraser: <path d="M6.5 13.5h7M3.1 9.4l5.5-5.5a1.5 1.5 0 0 1 2.1 0l2.4 2.4a1.5 1.5 0 0 1 0 2.1l-5.1 5.1H6.2z" />,
  insert: (<><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M8 5.5v5M5.5 8h5" /></>),
  offline: (<><path d="M4.75 12.5a2.75 2.75 0 0 1-.4-5.47A3.75 3.75 0 0 1 11.6 6a3.25 3.25 0 0 1 .15 6.5z" /><path d="M2.5 2.5l11 11" /></>),
  laptop: (<><rect x="3.5" y="3.5" width="9" height="6.5" rx="1.25" /><path d="M1.75 12.5h12.5" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.75" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></>),
  clock: (<><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3l2 1.25" /></>),
  duplicate: (<><rect x="5.5" y="5.5" width="8" height="8" rx="1.75" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></>),
  pin: <path d="M6 2.5h4l-.5 4 2.5 2.5H4l2.5-2.5zM8 9v4.5" />,
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" />,
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />,
  "eye-off": (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><path d="M2.5 2.5l11 11" /></>),
  people: (<><circle cx="6" cy="5.5" r="2.25" /><path d="M2 13a4 4 0 0 1 8 0M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25A4 4 0 0 1 14 13" /></>),
  fit: <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />,
  "align-left": <path d="M2.5 2.5v11M5 5h7M5 8h4.5M5 11h6" />,
  type: <path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5" />,
};

const GLYPHS: Record<string, ReactNode> = { ...FAMILY, ...KIT_GLYPHS, "chevron-r": FAMILY.submenu, x: FAMILY.close };
export const GLYPH_NAMES = Object.keys(GLYPHS).concat("spark");

/** One icon by name. "spark" is the logo's star (filled) — the AI's glyph. */
export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  if (name === "spark") return <Spark size={size} color="currentColor" />;
  return (
    <svg className={`k-ic ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name] ?? GLYPHS.file}
    </svg>
  );
}

/** The maude mark — lifted verbatim from _specimen-controls.tsx (assets/logos/mark.svg). */
export function Mark({ size = 22, tile = "var(--accent)", star = "var(--accent-fg)" }: { size?: number; tile?: string; star?: string }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill={tile} />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill={star} />
    </svg>
  );
}

/** The AI spark — the mark's star scaled 26/22 (assets/logos/spark.svg). The AI only. */
export function Spark({ size = 14, color = "var(--spark)" }: { size?: number; color?: string }) {
  return (
    <svg className="k-ic" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 3L19.309 12.691L29 16L19.309 19.309L16 29L12.691 19.309L3 16L12.691 12.691Z" fill={color} />
    </svg>
  );
}

/* ═══ People ═══════════════════════════════════════════════════════════════════════════════ */

export type Tone = "yellow" | "green" | "lilac" | "coral" | "sky" | "grey";
type Person = { name: string; ini: string; tone: Tone };
export const PEOPLE: Record<string, Person> = {
  you: { name: "You", ini: "M", tone: "yellow" },
  tereza: { name: "Tereza", ini: "T", tone: "sky" },
  jonas: { name: "Jonas", ini: "J", tone: "green" },
};
export type Who = string | Person;
function person(w: Who): Person {
  if (typeof w !== "string") return w;
  return PEOPLE[w.toLowerCase()] ?? { name: w, ini: w.slice(0, 1).toUpperCase(), tone: "grey" };
}

/** A person's or an account's initial — people wear the canvas palette (colors-presence). */
export function Avatar({ who, ini, tone, size = "md" }: { who?: Who; ini?: string; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const p = who ? person(who) : { name: ini ?? "", ini: ini ?? "", tone: tone ?? "grey" };
  return <span className={`k-av k-av--${tone ?? p.tone} k-av--${size}`} title={p.name}>{p.ini}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** Status shown in words, with a dot (never hue alone). */
export function StatusWord({ state = "ok", children }: { state?: "ok" | "warn" | "error" | "busy" | "off"; children: ReactNode }) {
  return <span className={`k-sw k-sw--${state}`}><i />{children}</span>;
}

/* ═══ Thumbnails — what's on a canvas, drawn small (lifted from components-cards) ══════════ */

export type Art =
  | "home" | "price" | "onb" | "mobile" | "brand" | "board"
  | "gator-web" | "gator-poster" | "gator-social" | "gator-reel" | "gator-print" | "gator-jersey" | "gator-numbers"
  | "video" | "moodboard" | "flow" | "admin" | "blank";
export const ART_NAMES: Art[] = ["home", "price", "onb", "mobile", "brand", "board", "gator-web", "gator-poster", "gator-social", "gator-reel", "gator-print", "gator-jersey", "gator-numbers", "video", "moodboard", "flow", "admin", "blank"];

export function Thumb({ art = "blank", w, h, className = "" }: { art?: Art; w?: number; h?: number; className?: string }) {
  return (
    <span className={`k-thumb k-art--${art} maude-v2 k-fixed ${className}`} data-theme="light" style={w ? { width: w, height: h } : undefined} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export type Kind = "web" | "digital" | "print" | "video";
export function KindGlyph({ kind, size = 12 }: { kind: Kind; size?: number }) {
  return <span className={`k-kind k-kind--${kind}`} title={kind === "digital" ? "Digital" : kind[0].toUpperCase() + kind.slice(1)}><Icon name={kind} size={size} /></span>;
}

/* ═══ Scope, stage, window, canvas ═════════════════════════════════════════════════════════ */

export function V2({ theme = "light", children, className = "", style }: { theme?: "light" | "dark"; children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`maude-v2 k-v2 ${className}`} data-theme={theme} style={style}>{children}</div>;
}

/** An app-window artboard: V2 scope, the window on top, the note strip under it. Use 1440 × 980. */
export function Stage({ theme = "light", note, children }: { theme?: "light" | "dark"; note?: ReactNode; children: ReactNode }) {
  return (
    <V2 theme={theme} className="k-stage">
      <div className="k-stage-win">{children}</div>
      {note ? <div className="k-stage-note">{note}</div> : null}
    </V2>
  );
}

export type Tab = { name: string; initial?: string; color?: Tone; account?: string; unsaved?: boolean; syncing?: boolean; local?: boolean; home?: boolean };
export const TABS = {
  studio: { name: "Studio site", initial: "S", color: "yellow", account: "You" } as Tab,
  alligators: { name: "Alligators brand", initial: "A", color: "lilac", account: "Alligators" } as Tab,
  home: { name: "Home", home: true } as Tab,
};

export function Window({ tabs = [TABS.studio, TABS.alligators], activeTab = 0, height = 900, label, tabMenu, tabMenuHighlight, children }: { tabs?: Tab[]; activeTab?: number | string; height?: number; label?: string; tabMenu?: number; tabMenuHighlight?: string; children?: ReactNode }) {
  const activeIdx = typeof activeTab === "number" ? activeTab : Math.max(0, tabs.findIndex((t) => t.name === activeTab || (activeTab === "home" && t.home)));
  const act = tabs[activeIdx];
  return (
    <div className="k-window" role="img" aria-label={label ?? `Maude — ${act?.name ?? "Home"}`} style={{ height }}>
      <div className="k-titlebar">
        <span className="k-lights"><i /><i /><i /></span>
        <span className="k-tabs">
          {tabs.map((t, i) => {
            const on = i === activeIdx;
            return (
              <span key={t.name + i} className="k-tab" data-on={on ? "true" : undefined} data-menu={tabMenu === i ? "true" : undefined} title={t.account ? `${t.name} — works as ${t.account}` : t.name}>
                {on ? <span className="k-tab-x">{t.unsaved ? <i className="k-tab-dot" /> : <Icon name="close" size={10} />}</span> : t.unsaved ? <span className="k-tab-x"><i className="k-tab-dot" /></span> : null}
                {t.home ? <span className="k-tab-home"><Icon name="home" size={13} /></span> : <Avatar ini={t.initial ?? t.name.slice(0, 1)} tone={t.color ?? "sky"} size="sm" />}
                <span className="k-tab-name">{t.name}</span>
                {t.syncing ? <span className="k-tab-st" title="Syncing…"><Icon name="sync" size={11} /></span> : null}
                {t.local ? <span className="k-tab-st" title="Local project"><Icon name="laptop" size={11} /></span> : null}
                {tabMenu === i ? (
                  <span className="k-menu k-tabmenu">
                    <MenuRows items={[{ label: "Rename…" }, { label: "Move to a new window" }, { label: "Sign in as another account…" }, "sep", { label: "Close tab" }]} highlight={tabMenuHighlight} />
                  </span>
                ) : null}
              </span>
            );
          })}
        </span>
        <span className="k-tab-add"><Icon name="plus" size={13} /></span>
      </div>
      <div className="k-body">{children}</div>
    </div>
  );
}

export function Canvas({ children, dots = true, dim = false }: { children?: ReactNode; dots?: boolean; dim?: boolean }) {
  return <div className={`k-canvas${dots ? " k-canvas--dots" : ""}${dim ? " k-canvas--dim" : ""}`}>{children}</div>;
}

export function Veil({ strong = false }: { strong?: boolean }) {
  return <div className={`k-veil${strong ? " k-veil--strong" : ""}`} />;
}

/* ═══ Panels ════════════════════════════════════════════════════════════════════════════════ */

export function ProjectPill({ project, canvas, folded = false, open = false, home = false, style }: { project: string; canvas?: string; folded?: boolean; open?: boolean; home?: boolean; style?: CSSProperties }) {
  return (
    <span className="island k-pill" data-folded={folded ? "true" : undefined} data-open={open ? "true" : undefined} style={style} title="Project menu">
      <span className="k-pill-mark"><Mark size={22} /></span>
      {folded ? null : (
        <span className="k-pill-txt">
          <span className="k-pill-name">{home ? "Home" : project}</span>
          {canvas && !home ? (<><span className="k-pill-sep">/</span><span className="k-pill-canvas">{canvas}</span></>) : null}
          <span className="k-caret"><Icon name="chevron" size={14} /></span>
        </span>
      )}
    </span>
  );
}

/* ─── Generic menu ─── */
export type MenuItem =
  | "sep"
  | { group: string }
  | { label: string; keys?: string; icon?: string; sub?: boolean; checked?: boolean; highlight?: boolean; disabled?: boolean; note?: ReactNode; danger?: boolean; dot?: boolean; indent?: boolean };

function MenuRows({ items, highlight }: { items: MenuItem[]; highlight?: string }) {
  const anyIcon = items.some((r) => typeof r === "object" && "label" in r && r.icon);
  return (
    <>
      {items.map((r, i) => {
        if (r === "sep") return <span className="k-msep" key={i} />;
        if ("group" in r) return <span className="k-mgroup" key={i}>{r.group}</span>;
        const hl = r.highlight || (highlight && r.label === highlight);
        return (
          <span className={`row-item k-mi${r.disabled ? " k-mi--off" : ""}${r.danger ? " k-mi--danger" : ""}${r.indent ? " k-mi--indent" : ""}`} data-hl={hl ? "true" : undefined} key={r.label + i}>
            {anyIcon ? <span className="k-mi-ic">{r.checked ? <Icon name="check" size={14} /> : r.icon ? <Icon name={r.icon} size={14} /> : null}</span> : r.checked !== undefined ? <span className="k-mi-ic">{r.checked ? <Icon name="check" size={14} /> : null}</span> : null}
            <span className="k-mi-lab">{r.label}{r.dot ? <i className="k-mi-dot" title="What's new" /> : null}</span>
            {r.note ? <span className="k-mi-note">{r.note}</span> : null}
            {r.keys ? <span className="k-mi-keys">{r.keys}</span> : null}
            {r.sub ? <span className="k-mi-ch"><Icon name="submenu" size={12} /></span> : null}
          </span>
        );
      })}
    </>
  );
}

export function Menu({ items, style, width = 240, highlight }: { items: MenuItem[]; style?: CSSProperties; width?: number; highlight?: string }) {
  return <div className="k-menu" style={{ width, ...style }}><MenuRows items={items} highlight={highlight} /></div>;
}

/* ─── The one menu (CONTRACT §1) ─── */
type Sub = "file" | "edit" | "view" | "help" | "diagnostics";
const MAIN: (MenuItem & object | "sep")[] = [
  { label: "Back to Home", icon: "home" }, "sep",
  { label: "File", icon: "file", sub: true }, { label: "Edit", icon: "edit", sub: true },
  { label: "View", icon: "view", sub: true }, { label: "Help", icon: "help", sub: true, dot: true }, "sep",
  { label: "Version history", icon: "history", keys: "⌥⌘H" }, { label: "Share…", icon: "share" }, { label: "Export…", icon: "export", keys: "⇧⌘E" }, "sep",
  { label: "Diagnostics", icon: "pulse", sub: true }, { label: "Settings…", icon: "settings", keys: "⌘," },
];
const SUBS: Record<Sub, { items: MenuItem[]; adv?: MenuItem[]; advLabel?: string; anchor: "top" | "bottom"; row: number }> = {
  file: {
    anchor: "top", row: 2,
    items: [
      { label: "New canvas", keys: "⌘N" }, { label: "New project…", keys: "⇧⌘N" }, { label: "Open project…", keys: "⌘O" }, "sep",
      { label: "Duplicate canvas" }, { label: "Rename canvas" }, { label: "Move to…" }, "sep",
      { label: "Import from Figma…" }, { label: "Import a brand…" }, { label: "Assemble clips into a video" }, "sep",
      { label: "Export…", keys: "⇧⌘E" }, { label: "Handoff to production", keys: "⇧⌘H" }, { label: "Close canvas" },
    ],
  },
  edit: {
    anchor: "top", row: 3,
    items: [
      { label: "Undo", keys: "⌘Z" }, { label: "Redo", keys: "⇧⌘Z" }, "sep",
      { label: "Cut", keys: "⌘X" }, { label: "Copy", keys: "⌘C" }, { label: "Paste", keys: "⌘V" }, "sep",
      { label: "Select all", keys: "⌘A" }, { label: "Deselect all", keys: "esc" }, { label: "Select all annotations", keys: "⇧⌘A" },
    ],
    advLabel: "New artboard",
    adv: [{ label: "Desktop", indent: true }, { label: "Laptop", indent: true }, { label: "Tablet", indent: true }, { label: "Mobile", indent: true }, { label: "A4", indent: true }, { label: "Letter", indent: true }],
  },
  view: {
    anchor: "top", row: 4,
    items: [
      { label: "Hide panels", keys: "⌘\\" }, { label: "Comments", keys: "⇧⌘M" }, { label: "Assets" }, { label: "Annotations", keys: "⇧P" }, { label: "Present the canvas" }, "sep",
      { label: "Zoom in", keys: "⌘+" }, { label: "Zoom out", keys: "⌘−" }, { label: "Zoom to fit", keys: "⌘0" }, { label: "Actual size", keys: "⌘1" },
    ],
    adv: [
      { label: "Layers as a panel", indent: true }, { label: "Inspector", keys: "⇧⌘I", indent: true }, { label: "Open inspector on select", indent: true, checked: true },
      { label: "Keep timeline open", keys: "⇧⌘T", indent: true }, { label: "Minimap", indent: true }, { label: "Zoom controls", indent: true }, { label: "Print guides", indent: true },
      { label: "Hidden files", indent: true }, { label: "Pin panels to the side", indent: true },
    ],
  },
  help: {
    anchor: "top", row: 5,
    items: [
      { label: "Keyboard shortcuts", keys: "?" }, { label: "Help and guides", keys: "F1" }, { label: "What's new", dot: true }, { label: "Take the tour" },
      { label: "Watch the intro" }, { label: "How sharing works" }, "sep", { label: "Report a bug…" },
    ],
  },
  diagnostics: { anchor: "bottom", row: 11, items: [] },
};

type Diag = { sync?: [string, "ok" | "warn" | "error" | "busy" | "off"]; server?: [string, "ok" | "warn" | "error" | "busy" | "off"]; ai?: [string, "ok" | "warn" | "error" | "busy" | "off"]; address?: string; process?: string; folder?: string };

function AdvGroup({ label, open, children }: { label: string; open: boolean; children?: ReactNode }) {
  return (
    <div className="k-madv" data-open={open ? "true" : undefined}>
      <span className="k-madv-hd"><span className="k-madv-ch"><Icon name="submenu" size={12} /></span>Advanced{label ? <span className="k-madv-sub">{label}</span> : null}</span>
      {open ? <div className="k-madv-body">{children}</div> : null}
    </div>
  );
}

export function ProjectMenu({ open = null, highlight, advanced = false, diag = {}, style, checked }: { open?: Sub | null; highlight?: string; advanced?: boolean; diag?: Diag; style?: CSSProperties; checked?: string[] }) {
  const sub = open ? SUBS[open] : null;
  /* checked = submenu row labels to show ticked (a toggle that is on, e.g. "Print guides"). Additive. */
  const tick = (items: MenuItem[]): MenuItem[] => (checked?.length ? items.map((r) => (typeof r === "object" && "label" in r && checked.includes(r.label) ? { ...r, checked: true } : r)) : items);
  const subLabel = open ? open[0].toUpperCase() + open.slice(1) : "";
  const d: Required<Pick<Diag, "sync" | "server" | "ai">> = { sync: diag.sync ?? ["Up to date", "ok"], server: diag.server ?? ["Running", "ok"], ai: diag.ai ?? ["Ready", "ok"] };
  return (
    <div className="k-menu k-menu--main" style={style}>
      <span className="k-menu-search"><Icon name="search" size={14} /><span>Search</span><Kbd>⌘K</Kbd></span>
      {MAIN.map((r, i) => {
        if (r === "sep") return <span className="k-msep" key={i} />;
        if (!("label" in r)) return null;
        const isOpen = !!open && r.label.toLowerCase() === open;
        const hl = isOpen || r.label === highlight;
        return (
          <span className="row-item k-mi" data-hl={hl ? "true" : undefined} key={r.label}>
            <span className="k-mi-ic"><Icon name={r.icon ?? "file"} size={14} /></span>
            <span className="k-mi-lab">{r.label}{r.dot ? <i className="k-mi-dot" title="What's new" /> : null}</span>
            {r.keys ? <span className="k-mi-keys">{r.keys}</span> : null}
            {r.sub ? <span className="k-mi-ch"><Icon name="submenu" size={12} /></span> : null}
            {isOpen && sub ? (
              <span className={`k-menu k-submenu k-submenu--${sub.anchor}`} aria-label={subLabel}>
                {open === "diagnostics" ? (
                  <>
                    <span className="row-item k-mi" data-hl={highlight === "Sync" ? "true" : undefined}><span className="k-mi-lab">Sync</span><StatusWord state={d.sync[1]}>{d.sync[0]}</StatusWord></span>
                    <span className="row-item k-mi" data-hl={highlight === "Server" ? "true" : undefined}><span className="k-mi-lab">Server</span><StatusWord state={d.server[1]}>{d.server[0]}</StatusWord></span>
                    <span className="row-item k-mi" data-hl={highlight === "AI setup" ? "true" : undefined}><span className="k-mi-lab">AI setup</span><StatusWord state={d.ai[1]}>{d.ai[0]}</StatusWord></span>
                    <span className="k-msep" />
                    <MenuRows items={[{ label: "Logs" }, { label: "Reload canvas", keys: "⌘R" }, { label: "Check AI setup again" }]} highlight={highlight} />
                    <span className="k-msep" />
                    <AdvGroup label="" open={advanced}>
                      <span className="k-madv-row"><span>Address</span><span className="k-mono">{diag.address ?? "localhost:4402"}</span></span>
                      <span className="k-madv-row"><span>Process</span><span className="k-mono">{diag.process ?? "41207"}</span></span>
                      <span className="k-madv-row"><span>Project folder</span><span className="k-mono">{diag.folder ?? "~/Studio site"}</span></span>
                      <span className="k-madv-acts"><span className="chip">Resync now</span><span className="chip">Download all</span></span>
                    </AdvGroup>
                  </>
                ) : (
                  <>
                    <MenuRows items={tick(sub.items)} highlight={highlight} />
                    {sub.adv ? (<><span className="k-msep" /><AdvGroup label={sub.advLabel ?? ""} open={advanced}><MenuRows items={tick(sub.adv)} highlight={highlight} /></AdvGroup></>) : null}
                  </>
                )}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/* ─── Canvases panel ─── */
export type CanvasItem = { name: string; art?: Art; people?: Who[]; ai?: string | boolean; kinds?: Kind[]; meta?: string; dim?: boolean; count?: number; local?: boolean; sub?: ReactNode };

/** Accent-insensitive match highlight ("letak" marks "leták"). Plain text when nothing matches. */
function markMatch(text: string, q?: string): ReactNode {
  if (!q) return text;
  const fold = (t: string) => Array.from(t).map((c) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().slice(0, 1) || c).join("");
  const at = fold(text).indexOf(fold(q.trim()));
  if (at < 0) return text;
  const n = q.trim().length;
  return <>{text.slice(0, at)}<mark className="k-mark">{text.slice(at, at + n)}</mark>{text.slice(at + n)}</>;
}
export type Folder = { name: string; open?: boolean; count?: number; items?: CanvasItem[]; folders?: Folder[] };
export type LayerRow = { name: string; icon: string; depth?: number; selected?: boolean; hidden?: boolean; locked?: boolean; ai?: boolean };

function CanvasRow({ it, depth, selected, tip, q }: { it: CanvasItem; depth: number; selected?: string; tip?: { text: string; row: string }; q?: string }) {
  return (
    <span className={`row-item k-cp-row${it.dim ? " k-cp-row--dim" : ""}${it.sub ? " k-cp-row--two" : ""}`} aria-current={selected === it.name ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))` }} title={it.name}>
      <Thumb art={it.art ?? "blank"} className="k-thumb--row" />
      {it.sub ? (
        <span className="k-cp-two"><span className="k-cp-name">{markMatch(it.name, q)}</span><span className="k-cp-sub">{it.sub}</span></span>
      ) : <span className="k-cp-name">{markMatch(it.name, q)}</span>}
      <span className="k-cp-badges">
        {it.ai ? <span className="k-cp-ai motion-soft" title={typeof it.ai === "string" ? it.ai : "AI is working"}><Spark size={11} /></span> : null}
        {it.people?.length ? <span className="k-faces k-faces--sm">{it.people.map((p) => <Avatar key={person(p).name} who={p} size="sm" />)}</span> : null}
        {it.kinds?.map((k) => <KindGlyph key={k} kind={k} size={11} />)}
        {it.local ? <span className="k-cp-local" title="On this Mac — syncs when online"><Icon name="laptop" size={12} /></span> : null}
        {it.meta ? <span className="k-cp-meta">{it.meta}</span> : null}
      </span>
      {tip && tip.row === it.name ? <span className="k-tip k-tip--row">{tip.text}</span> : null}
    </span>
  );
}

function FolderRows({ f, depth, selected, tip }: { f: Folder; depth: number; selected?: string; tip?: { text: string; row: string } }) {
  return (
    <>
      <span className="row-item k-cp-folder" data-open={f.open ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-1) + ${depth} * var(--space-4))` }}>
        <span className="k-cp-tw"><Icon name="submenu" size={12} /></span>
        <span className="k-cp-fic"><Icon name="folder" size={14} /></span>
        <span className="k-cp-name">{f.name}</span>
        {f.count !== undefined ? <span className="k-cp-count">{f.count}</span> : null}
      </span>
      {f.open ? (
        <>
          {f.folders?.map((sf) => <FolderRows key={sf.name} f={sf} depth={depth + 1} selected={selected} tip={tip} />)}
          {f.items?.map((it) => <CanvasRow key={it.name} it={it} depth={depth + 1} selected={selected} tip={tip} />)}
        </>
      ) : null}
    </>
  );
}

export function CanvasesPanel({
  project, count, folders = [], items = [], recents, selected, tab = "canvases", search, folded = false, layers, assets, system, empty, tooltip, foot, advanced = false, style,
}: {
  project: string; count?: number; folders?: Folder[]; items?: CanvasItem[]; recents?: CanvasItem[]; selected?: string; tab?: "canvases" | "layers" | "assets";
  /** Body of the Assets tab (CONTRACT §7: Assets is the left panel's third tab). */ assets?: ReactNode;
  /** The project's design system, pinned above every canvas (13 Design System). */ system?: { name?: string; meta?: string; selected?: boolean; ai?: boolean };
  search?: string; folded?: boolean; layers?: LayerRow[]; empty?: ReactNode; tooltip?: { text: string; row: string };
  /** A quiet line at the panel's foot, inside the island (e.g. "4 results · ⌘K searches every project"). */
  foot?: ReactNode;
  /** The quiet Advanced row at the panel's foot (showcase: "one quiet row at the foot of each panel"). Off by default. */ advanced?: boolean;
  style?: CSSProperties;
}) {
  if (folded) return <PanelIcon icon="panel-left" at="left" />;
  return (
    <div className="island k-cp" style={style}>
      <div className="k-cp-hd">
        <span className="seg k-seg">
          <span className="k-seg-b" aria-pressed={tab === "canvases"}>Canvases</span>
          <span className="k-seg-b" aria-pressed={tab === "layers"}>Layers</span>
          <span className="k-seg-b" aria-pressed={tab === "assets"}>Assets</span>
        </span>
        <span className="icon-btn k-icon-sm"><Icon name="panel-left" /></span>
      </div>
      {tab === "canvases" ? (
        <>
          <span className={`k-find${search ? " k-find--on" : ""}`}>
            <Icon name="search" size={14} />
            {search ? <span className="k-find-q">{search}<i className="k-caretline" /></span> : <span className="k-find-q k-find-ph">Search</span>}
            {search ? <span className="k-find-x"><Icon name="close" size={10} /></span> : <Kbd>⌘K</Kbd>}
          </span>
          <div className="k-cp-list">
            {system && !search ? (
              <span className="row-item k-cp-ds" aria-current={system.selected ? "true" : undefined}>
                <span className="k-cp-dsic"><Icon name="system" size={14} /></span>
                <span className="k-cp-name">{system.name ?? "Design system"}</span>
                {system.ai ? <span className="k-cp-ai"><Spark size={11} /></span> : null}
                {system.meta ? <span className="k-cp-meta">{system.meta}</span> : null}
              </span>
            ) : null}
            {recents?.length ? (
              <>
                <p className="island-title k-cp-t">Recent</p>
                {recents.map((it) => <CanvasRow key={"r" + it.name} it={it} depth={0} selected={selected} tip={tooltip} />)}
              </>
            ) : null}
            {!search ? <p className="island-title k-cp-t">{project}{count !== undefined ? <span className="k-cp-tc">{count} {count === 1 ? "canvas" : "canvases"}</span> : null}</p> : null}
            {search && !folders.length && !items.length ? <p className="k-cp-empty">{empty ?? <>Nothing called “{search}”. Try another word, or ask AI to find it.</>}</p> : null}
            {folders.map((f) => <FolderRows key={f.name} f={f} depth={0} selected={selected} tip={tooltip} />)}
            {items.map((it) => <CanvasRow key={it.name} it={it} depth={0} selected={selected} tip={tooltip} q={search} />)}
            {!search ? <span className="row-item k-cp-new"><span className="k-cp-plus"><Icon name="plus" size={14} /></span>New canvas</span> : null}
          </div>
        </>
      ) : tab === "assets" ? (
        <div className="k-cp-list">{assets ?? <p className="k-cp-empty">Drop photos, video or sound here.</p>}</div>
      ) : (
        <div className="k-cp-list">
          <p className="island-title k-cp-t">{selected ?? project}</p>
          {(layers ?? []).map((l, i) => (
            <span key={l.name + i} className={`row-item k-ly${l.hidden ? " k-ly--hidden" : ""}`} aria-current={l.selected ? "true" : undefined} style={{ paddingLeft: `calc(var(--space-2) + ${l.depth ?? 0} * var(--space-4))` }}>
              <span className="k-ly-ic"><Icon name={l.icon} size={14} /></span>
              <span className="k-cp-name">{l.name}</span>
              {l.ai ? <span className="k-cp-ai"><Spark size={11} /></span> : null}
              {l.locked ? <span className="k-ly-st"><Icon name="lock" size={12} /></span> : null}
              {l.hidden ? <span className="k-ly-st"><Icon name="eye-off" size={12} /></span> : null}
            </span>
          ))}
        </div>
      )}
      {foot ? <p className="k-cp-foot">{foot}</p> : null}
      {advanced ? <span className="k-adv-btn k-cp-adv"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced</span> : null}
    </div>
  );
}

/** A panel folded into its icon (⌘\). */
export function PanelIcon({ icon, at, dot = false, style }: { icon: string; at: "left" | "ai" | "dock" | "insp" | "tr"; dot?: boolean; style?: CSSProperties }) {
  return (
    <span className={`island k-iconbtn k-iconbtn--${at}`} style={style}>
      <span className={`icon-btn${at === "dock" ? " k-pressed" : ""}`}>
        {icon === "spark" ? <Spark size={16} /> : <Icon name={icon} />}
        {dot ? <i className="k-ai-dot" /> : null}
      </span>
    </span>
  );
}

/* ─── Toolbar (CONTRACT §2) — two toolbars, one per mode ─── */
/* Edit = tools that make things INSIDE artboards (CONTRACT §2, Michal 2026-10-08). Annotation tools (Sticky, Comment,
   Marker, Arrow, Stamp, Section) live in Preview's toolbar; their keys (N C M A E S) switch to Preview with that tool. */
export const TOOLS: [string, string, string][] = [
  ["select", "Select", "V"], ["hand", "Hand", "H"], ["frame", "Frame", "F"], ["shape", "Shape", "R"],
  ["pen", "Pen", "P"], ["text", "Text", "T"], ["image", "Image", "I"], ["component", "Component", "⇧I"],
];
export const MORE_TOOLS: [string, string][] = [["line", "Line"], ["ellipse", "Ellipse"], ["polygon", "Polygon"], ["crop", "Crop"], ["slice", "Export area"]];
/* Preview = annotation tools only, FigJam-style (lifted from 04 Modes · AnnotateDock). R and T draw on the annotation
   layer here, never in the design. */
export const ANNOTATE_TOOLS: [string, string, string][] = [
  ["hand", "Hand", "H"], ["sticky", "Sticky", "N"], ["comment", "Comment", "C"], ["marker", "Marker", "M"], ["arrow", "Arrow", "A"],
  ["shape", "Shape", "R"], ["text", "Text", "T"], ["stamp", "Stickers", "E"], ["section", "Section", "S"],
];
/** Annotation-only tool ids — a `tool` from this list on an Edit toolbar renders the Preview toolbar (CONTRACT §2: the key switches mode). */
const ANNOTATE_ONLY = ["sticky", "comment", "marker", "arrow", "stamp", "section"];
export const SWATCHES = ["yellow", "coral", "green", "sky", "lilac"] as const;
export type Swatch = (typeof SWATCHES)[number];
export type ToolbarMode = "edit" | "annotate";

/** One annotation tool, drawn the FigJam way: Sticky is a coloured note, Marker shows its ink, Stamp a filled disc. */
export function AnnotateIcon({ id, color = "yellow", ink = "coral", size = 22 }: { id: string; color?: Swatch; ink?: Swatch; size?: number }) {
  if (id === "sticky") return <span className={`k-ad-note k-ad-note--${color}`} style={{ width: size, height: size }} />;
  if (id === "marker") return <span className="k-ad-mk"><Icon name="marker" size={size} /><i className={`k-ad-ink k-ad-ink--${ink}`} /></span>;
  return <Icon name={id} size={size} className={id === "stamp" ? "k-ad-stamp" : ""} />;
}

function SwatchPop({ of, color, ink }: { of: "sticky" | "marker"; color: Swatch; ink: Swatch }) {
  return (
    <span className="island k-ad-pop">
      {of === "marker" ? <span className="seg k-seg k-ad-seg"><span className="k-seg-b" aria-pressed="true">Marker</span><span className="k-seg-b">Highlighter</span></span> : null}
      {SWATCHES.map((c) => <i key={c} className={`k-ad-sw k-ad-sw--${c}`} aria-current={(of === "sticky" ? color : ink) === c ? "true" : undefined} />)}
    </span>
  );
}

export function Toolbar({ mode, tool, more = false, folded = false, tip, swatches, color = "yellow", ink = "coral", keys = false, only, inline = false, style }: {
  /** "edit" (default) = the Edit toolbar · "annotate" = Preview's annotation toolbar, a size bigger. */
  mode?: ToolbarMode;
  /** pressed tool id. Default: "select" in Edit, "hand" in annotate. An annotation-only id (sticky, comment, marker,
   *  arrow, stamp, section) with no `mode` renders the annotate toolbar — the key switches to Preview (CONTRACT §2). */
  tool?: string;
  /** Edit only — opens the More popover (Line · Ellipse · Polygon · Crop · Export area). */
  more?: boolean;
  folded?: boolean;
  /** tool id whose tooltip (label + key) shows above it. */
  tip?: string;
  /** annotate only — opens the colour row above Sticky ("sticky") or Marker ("marker", with Marker · Highlighter). */
  swatches?: "sticky" | "marker";
  /** Sticky's current colour · Marker's ink. */
  color?: Swatch;
  ink?: Swatch;
  /** small key letters in each button's corner (close-ups, key charts). */
  keys?: boolean;
  /** show only these tool ids (e.g. Can comment: ["hand", "comment"]); More hides when it isn't listed. */
  only?: string[];
  /** static in a close-up instead of pinned to the window's bottom centre. */
  inline?: boolean;
  style?: CSSProperties;
}) {
  const m: ToolbarMode = mode ?? (tool && ANNOTATE_ONLY.includes(tool) ? "annotate" : "edit");
  const t = tool ?? (m === "annotate" ? "hand" : "select");
  if (folded) return <PanelIcon icon={t} at="dock" />;
  const pin = inline ? " k-dock--inline" : "";
  if (m === "annotate") {
    const list = only ? ANNOTATE_TOOLS.filter(([id]) => only.includes(id)) : ANNOTATE_TOOLS;
    return (
      <div className={`island dock k-dock k-adock${pin}`} style={style}>
        {list.map(([id, label, key], i) => (
          <Fragment key={id}>
            <span className={`icon-btn k-ad-b${t === id ? " k-pressed" : ""}`} title={`${label} · ${key}`}>
              <AnnotateIcon id={id} color={color} ink={ink} />
              {keys ? <span className="k-ad-key">{key}</span> : null}
              {tip === id ? <span className="k-tip k-tip--up">{label}<Kbd>{key}</Kbd></span> : null}
              {swatches === id ? <SwatchPop of={swatches} color={color} ink={ink} /> : null}
            </span>
            {i === 0 && id === "hand" && list.length > 1 ? <span className="divider-v" /> : null}
          </Fragment>
        ))}
      </div>
    );
  }
  const list = only ? TOOLS.filter(([id]) => only.includes(id)) : TOOLS;
  const showMore = !only || only.includes("more");
  return (
    <div className={`island dock k-dock${pin}`} style={style}>
      {list.map(([id, label, key]) => (
        <span key={id} className={`icon-btn${t === id ? " k-pressed" : ""}`} title={`${label} · ${key}`}>
          <Icon name={id} size={18} />
          {keys ? <span className="k-ad-key">{key}</span> : null}
          {tip === id ? <span className="k-tip k-tip--up">{label}<Kbd>{key}</Kbd></span> : null}
        </span>
      ))}
      {showMore ? (
        <>
          <span className="divider-v" />
          <span className={`icon-btn${more || MORE_TOOLS.some(([x]) => x === t) ? " k-pressed" : ""}`} title="More tools"><Icon name="more" size={18} /></span>
        </>
      ) : null}
      {more ? (
        <span className="k-menu k-more">
          {MORE_TOOLS.map(([id, label]) => (
            <span key={id} className="row-item k-mi" data-hl={t === id ? "true" : undefined}><span className="k-mi-ic"><Icon name={id} size={14} /></span><span className="k-mi-lab">{label}</span></span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/* ─── Toolbar morph (lifted from 04 Modes · MorphToolbar) ───────────────────────────────────
   Edit → Preview on --dur-panel 220 ms: the Edit tools sink out over 0–100 ms, the annotation tools rise in over
   80–220 ms; movement rides --ease-out, opacity is linear (so mid frames show both rows); the island widens and grows
   a little taller. `t` = ms since the press (0 = Edit toolbar, ≥ 220 = annotate toolbar). Back to Edit = reversed. */
const TB_EDIT_W = 421;
const TB_ANNO_W = 493;
/** --ease-out = cubic-bezier(0.25, 0.8, 0.25, 1): progress at time fraction x. */
export function easeOut(x: number) {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 32; k++) {
    const s = (lo + hi) / 2;
    const v = 0.75 * s * (1 - s) + s * s * s;
    if (v < x) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return 2.4 * s * (1 - s) * (1 - s) + 3 * s * s * (1 - s) + s * s * s;
}
export function ToolbarMorph({ t, inline = false, style }: { t: number; inline?: boolean; style?: CSSProperties }) {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  const out = easeOut(c(t / 100));
  const outO = c(t / 100);
  const inn = easeOut(c((t - 80) / 140));
  const innO = c((t - 80) / 140);
  const grow = easeOut(c(t / 220));
  const lerp = (a: number, b: number) => a + (b - a) * grow;
  return (
    <div className={`island dock k-dock k-morph${inline ? " k-dock--inline" : ""}`} style={{ width: lerp(TB_EDIT_W, TB_ANNO_W), height: lerp(56, 64), ...style }}>
      <span className="k-morph-row" style={{ opacity: 1 - outO, transform: `translate(-50%, calc(-50% + ${out * 18}px))` }}>
        {TOOLS.map(([id, label], i) => <span key={id} className={`icon-btn${i === 0 ? " k-pressed" : ""}`} title={label}><Icon name={id} size={18} /></span>)}
        <span className="divider-v" />
        <span className="icon-btn"><Icon name="more" size={18} /></span>
      </span>
      <span className="k-morph-row" style={{ opacity: innO, transform: `translate(-50%, calc(-50% + ${(1 - inn) * 18}px))` }}>
        {ANNOTATE_TOOLS.map(([id, label], i) => (
          <Fragment key={id}>
            <span className={`icon-btn k-ad-b${i === 0 ? " k-pressed" : ""}`} title={label}><AnnotateIcon id={id} /></span>
            {i === 0 ? <span className="divider-v" /> : null}
          </Fragment>
        ))}
      </span>
    </div>
  );
}

/* ─── Share cluster ─── */
const STATUS: Record<string, { icon: string; word: string; tone: string }> = {
  saved: { icon: "cloud", word: "Saved", tone: "" },
  syncing: { icon: "sync", word: "Syncing…", tone: "" },
  offline: { icon: "offline", word: "Offline — kept on this Mac", tone: "warn" },
  local: { icon: "laptop", word: "Local project", tone: "" },
  error: { icon: "problem", word: "Not saved", tone: "error" },
};


/* ─── Mode switch (lifted from 04 Modes · CONTRACT §7) ───────────────────────────────────────
   Edit · Preview · Present in the Share cluster; people without edit rights see Viewing first.
   Mode glyphs are the modes' own — never a tool's or a menu row's (DDR-223 addendum 2). */
export type Mode = "edit" | "preview" | "present" | "viewing";
export const MODE_WORD: Record<Mode, string> = { edit: "Edit", preview: "Preview", present: "Present", viewing: "Viewing" };
const MODE_PATHS: Record<Mode, ReactNode> = {
  /* pencil-ruler — making */
  edit: (
    <>
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
      <path d="M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
      <path d="m15 5 4 4" />
    </>
  ),
  /* an eye in a frame — the design, looked at live (the bare eye stays Menu › View's) */
  preview: (
    <>
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="4.5" />
      <path d="M6 12s2.2-3.75 6-3.75S18 12 18 12s-2.2 3.75-6 3.75S6 12 6 12z" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  /* an easel — showing */
  present: (
    <>
      <path d="M2 3.5h20" />
      <path d="M20.5 3.5v10a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-10" />
      <path d="m7.5 21 4.5-5 4.5 5" />
    </>
  ),
  /* reading glasses — looking, without changing */
  viewing: (
    <>
      <circle cx="6" cy="15.5" r="3.75" />
      <circle cx="18" cy="15.5" r="3.75" />
      <path d="M14.25 15.5a2.25 2.25 0 0 0-4.5 0" />
      <path d="M2.4 14 5 7.5c.6-1.3 1.4-2 2.75-2" />
      <path d="M21.6 14 19 7.5c-.6-1.3-1.4-2-2.75-2" />
    </>
  ),
};
export function ModeGlyph({ m, size = 15 }: { m: Mode; size?: number }) {
  return (
    <svg className="k-ic k-mg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {MODE_PATHS[m]}
    </svg>
  );
}

/** The mode switch. Editors get Edit · Preview · Present; Can view / Can comment get Viewing · Preview · Present. */
export function ModeSwitch({ mode = "edit", canEdit = true, menu = false }: { mode?: Mode; canEdit?: boolean; menu?: boolean }) {
  const segs: Mode[] = [canEdit ? "edit" : "viewing", "preview", "present"];
  return (
    <span className="k-modes" title="Mode">
      {segs.map((id) => (
        <span key={id} className={`k-mode-b${id === "present" ? " k-mode-b--menu" : ""}`} aria-pressed={mode === id ? "true" : undefined} data-open={id === "present" && menu ? "true" : undefined} title={MODE_WORD[id]}>
          <ModeGlyph m={id} />
          {id === "present" ? <span className="k-mode-ch"><Icon name="chevron" size={10} /></span> : null}
        </span>
      ))}
    </span>
  );
}

export function ShareCluster({ people = ["tereza", "jonas"], status = "saved", statusText, panelsButton = true, zen = false, comments = false, mode, canEdit = true, access, style }: { people?: Who[]; status?: keyof typeof STATUS; statusText?: string; panelsButton?: boolean; zen?: boolean; comments?: boolean; /** CONTRACT §7 — shows the Edit · Preview · Present switch. */ mode?: Mode; /** false → Viewing slot + "Ask to edit" instead of Share. */ canEdit?: boolean; /** CONTRACT §6 access word ("Can view" / "Can comment") in place of the save status. */ access?: string; style?: CSSProperties }) {
  const st = STATUS[status];
  return (
    <div className="island k-tr" style={style}>
      {zen ? null : (
        <>
          {people.length ? <span className="k-faces">{people.map((p) => <Avatar key={person(p).name} who={p} />)}</span> : null}
          {access ? <span className="k-saved">{access}</span> : <span className={`k-saved${st.tone ? ` k-saved--${st.tone}` : ""}`}><Icon name={st.icon} size={16} />{statusText ?? st.word}</span>}
          {comments ? <span className="icon-btn"><Icon name="comment" /></span> : null}
          {mode ? <ModeSwitch mode={mode} canEdit={canEdit} /> : null}
        </>
      )}
      {panelsButton ? <span className="icon-btn" title={zen ? "Show panels ⌘\\" : "Hide panels ⌘\\"}><Icon name="panel-right" /></span> : null}
      {zen ? null : canEdit ? <span className="btn btn--primary"><Icon name="share" size={14} />Share</span> : <span className="btn btn--primary">Ask to edit</span>}
    </div>
  );
}

export function ZoomUndo({ zoom = 100, folded = false, style }: { zoom?: number | string; folded?: boolean; style?: CSSProperties }) {
  if (folded) return null;
  return (
    <div className="island k-uz" style={style}>
      <span className="icon-btn" title="Undo ⌘Z"><Icon name="undo" /></span>
      <span className="icon-btn" title="Redo ⇧⌘Z"><Icon name="redo" /></span>
      <span className="k-uz-div" />
      <span className="btn btn--ghost btn--sm k-zoom">{typeof zoom === "number" ? `${zoom}%` : zoom}</span>
    </div>
  );
}

/* ─── AI chat panel ───
   Two headers. Default (legacy, unchanged): spark · "AI" · "● N running" · New chat · Hide.
   Canonical (pass `chat`, from 03 AI Chat): spark · chat title ⌄ (opens the chat list) · compact "✦ N" count of
   YOUR running chats · New chat · Hide — 340 wide. Other people's AI never counts as yours: it appears only under
   "On this canvas", View only (runs.canvas). */
export type Session = { title: string; state: "working" | "done" | "waiting" | "idle"; where?: string; current?: boolean };
const SESSION_WORD: Record<Session["state"], string> = { working: "Working", done: "Done", waiting: "Needs you", idle: "Idle" };

/** One row in the running list that drops from the "✦ N" count. waiting = in line behind another ask on the same
 *  artboard; needs = a question for you. `who` = whose AI (only for runs.canvas rows). */
export type AIRun = { title: string; where: string; state: "working" | "waiting" | "needs" | "done"; who?: Who; current?: boolean };
const RUN_WORD: Record<AIRun["state"], string> = { working: "Working", waiting: "Waiting", needs: "Needs you", done: "Done" };
export function AIRunIcon({ state }: { state: AIRun["state"] | "stopped" | "idle" }) {
  return (
    <span className={`k-ai-sst k-ai-rst--${state}${state === "working" ? " motion-soft" : ""}`}>
      {state === "working" ? <Spark size={11} /> : state === "waiting" ? <Icon name="clock" size={12} /> : state === "needs" ? <Icon name="help" size={12} /> : state === "done" ? <Icon name="check" size={12} /> : <Spark size={10} color="var(--fg-2)" />}
    </span>
  );
}
/** The running list: "Yours", then "On this canvas" (other people's AI, View only), then All chats. */
export function AIRunList({ yours, canvas, all = 41, style }: { yours: AIRun[]; canvas?: AIRun[]; all?: number | false; style?: CSSProperties }) {
  const Row = ({ r, view }: { r: AIRun; view?: boolean }) => (
    <span className="row-item k-ai-run" aria-current={r.current ? "true" : undefined}>
      <AIRunIcon state={r.state} />
      <span className="k-ai-stxt"><span className="k-ai-st">{r.title}</span><span className="k-ai-sw">{r.where}</span></span>
      {r.who ? <Avatar who={r.who} size="sm" /> : null}
      <span className={`k-ai-rw k-ai-rw--${view ? "view" : r.state}`}>{view ? "View only" : RUN_WORD[r.state]}</span>
    </span>
  );
  return (
    <span className="k-menu k-ai-list k-ai-runs" style={style}>
      {canvas?.length ? <span className="k-mgroup">Yours</span> : null}
      {yours.map((r) => <Row key={"y" + r.title + r.where} r={r} />)}
      {canvas?.length ? (
        <><span className="k-msep" /><span className="k-mgroup">On this canvas</span>{canvas.map((r) => <Row key={"c" + r.title + r.where} r={r} view />)}</>
      ) : null}
      {all !== false ? (<><span className="k-msep" /><span className="row-item k-mi"><span className="k-mi-ic"><Icon name="comment" size={14} /></span><span className="k-mi-lab">All chats</span><span className="k-mi-keys">{all}</span></span></>) : null}
    </span>
  );
}

export function AIPanel({
  folded = false, messages = [], chips = [], working, step, sessions, prompt, placeholder = "Ask AI…", scope = "Whole canvas", question, title = "AI", style,
  chat, count, runs, advanced, children, attach, banner, above, drop, free = false, dim = false, className = "",
}: {
  folded?: boolean; messages?: { from: "you" | "ai"; text: ReactNode }[]; chips?: string[];
  /** One line: the SAME words as the artboard's tag ("AI is making it greener"). */ working?: string;
  /** Detail under the working line ("Background done · badge next"). */ step?: string;
  sessions?: number | { list: Session[]; open?: boolean };
  prompt?: string; placeholder?: string; scope?: string; question?: { text: ReactNode; primary: string; secondary?: string }; title?: string; style?: CSSProperties;
  /** Canonical header: the chat's title ⌄ (opens the chat list) instead of "AI". Panel is 340 wide. */ chat?: string;
  /** Compact "✦ N" — YOUR running chats only. Defaults to the count of runs.yours still running. */ count?: number;
  /** The running list under the count. canvas = other people's AI on this canvas (View only). */
  runs?: { yours: AIRun[]; canvas?: AIRun[]; open?: boolean; all?: number | false };
  /** The Advanced row at the foot: true = the closed row · ReactNode = what it opens to (draw its own header). */
  advanced?: boolean | ReactNode;
  /** Rich conversation content (cards, results) after `messages`. */ children?: ReactNode;
  /** Above the field: attachments, a mode banner, a slash menu / allowance line (in that order: above, attach, banner). */
  attach?: ReactNode; banner?: ReactNode; above?: ReactNode;
  /** Overlay over the whole panel (e.g. "Drop to attach"). */ drop?: ReactNode;
  /** Static (in a close-up, not pinned to the window corner). */ free?: boolean; dim?: boolean; className?: string;
}) {
  if (folded) return <PanelIcon icon="spark" at="ai" dot={!!working} />;
  const list = typeof sessions === "object" ? sessions.list : undefined;
  const running = typeof sessions === "number" ? sessions : list ? list.filter((s) => s.state === "working" || s.state === "waiting").length : 0;
  const sessOpen = typeof sessions === "object" && sessions.open;
  const mine = count ?? (runs ? runs.yours.filter((r) => r.state !== "done").length : 0);
  const runsOpen = !!(runs && runs.open);
  const runList = runsOpen && runs ? <AIRunList yours={runs.yours} canvas={runs.canvas} all={runs.all} /> : null;
  const cls = `island island--pad k-ai${chat !== undefined ? " k-ai--chat" : ""}${free ? " k-ai--free" : ""}${dim ? " k-ai--dim" : ""}${className ? " " + className : ""}`;
  const workLine = working ? (
    <p className={`k-ai-working${step ? " k-ai-working--two" : ""}`}><span className="motion-soft k-ai-wspark"><Spark size={14} /></span><span className="k-ai-wtxt">{working}{step ? <span className="k-ai-step">{step}</span> : null}</span><span className="btn btn--ghost btn--sm"><Icon name="stop" size={12} />Stop</span></p>
  ) : null;
  const ask = (
    <div className="ask k-ask">
      <span className="chip chip--accent k-selchip">◆ {scope}</span>
      <span className={`k-ask-in${prompt ? "" : " k-ask-ph"}`}>{prompt ?? placeholder}{prompt ? <i className="k-caretline" /> : null}</span>
      <span className="send"><Spark size={12} color="var(--spark-fg)" /></span>
    </div>
  );
  return (
    <div className={cls} style={style}>
      {chat !== undefined ? (
        <div className="k-ai-hd k-ai-hd--chat">
          <Spark size={14} />
          <span className="k-ai-title"><span className="k-ai-title-t">{chat}</span><Icon name="chevron" size={12} /></span>
          {mine > 0 ? <span className="chip k-ai-sess k-ai-count" data-open={runsOpen ? "true" : undefined} title={`${mine} ${mine === 1 ? "chat" : "chats"} running`}><Spark size={10} /><b>{mine}</b><Icon name="chevron" size={12} /></span> : null}
          <span className="icon-btn k-icon-sm" title="New chat"><Icon name="plus" size={14} /></span>
          <span className="icon-btn k-icon-sm" title="Hide the AI chat panel"><Icon name="chevron" size={14} /></span>
          {runList}
        </div>
      ) : (
        <div className="k-ai-hd">
          <Spark size={14} />
          <span className="k-ai-name">{title}</span>
          {running > 1 || list ? (
            <span className="chip k-ai-sess" data-open={sessOpen ? "true" : undefined}>
              {running > 0 ? <i className="k-ai-sess-dot motion-soft" /> : null}
              {running > 0 ? `${running} running` : `${list?.length ?? 0} chats`}
              <Icon name="chevron" size={12} />
            </span>
          ) : null}
          <span className="icon-btn k-icon-sm"><Icon name="plus" size={14} /></span>
          <span className="icon-btn k-icon-sm"><Icon name="chevron" size={14} /></span>
          {sessOpen && list ? (
            <span className="k-menu k-ai-list">
              {list.map((s) => (
                <span key={s.title} className="row-item k-ai-srow" aria-current={s.current ? "true" : undefined}>
                  <span className={`k-ai-sst k-ai-sst--${s.state}${s.state === "working" ? " motion-soft" : ""}`}>{s.state === "working" ? <Spark size={11} /> : s.state === "done" ? <Icon name="check" size={12} /> : s.state === "waiting" ? <Icon name="help" size={12} /> : <Icon name="comment" size={12} />}</span>
                  <span className="k-ai-stxt"><span className="k-ai-st">{s.title}</span>{s.where ? <span className="k-ai-sw">{s.where}</span> : null}</span>
                  <span className="k-ai-sword">{SESSION_WORD[s.state]}</span>
                </span>
              ))}
              <span className="k-msep" />
              <span className="row-item k-mi"><span className="k-mi-ic"><Icon name="plus" size={14} /></span><span className="k-mi-lab">New chat</span></span>
            </span>
          ) : null}
          {runList}
        </div>
      )}
      <div className={`k-ai-msgs${chat !== undefined ? " k-ai-msgs--end" : ""}`}>
        {messages.map((m, i) => <p key={i} className={`k-ai-msg k-ai-msg--${m.from}`}>{m.text}</p>)}
        {children}
        {question ? (
          <div className="k-ai-q">
            <p className="k-ai-qt">{question.text}</p>
            <span className="k-ai-qa">{question.secondary ? <span className="btn btn--sm">{question.secondary}</span> : null}<span className="btn btn--sm btn--primary">{question.primary}</span></span>
          </div>
        ) : null}
        {workLine}
      </div>
      {chips.length ? <div className="k-ai-sugg">{chips.map((c) => <span key={c} className="chip k-sugg">{c}</span>)}</div> : null}
      {above || attach || banner ? (
        <div className="k-ai-askwrap">
          {above}
          {attach ? <div className="k-ai-attach">{attach}</div> : null}
          {banner}
          {ask}
        </div>
      ) : ask}
      {advanced === true ? (
        <span className="k-adv-btn k-ai-adv"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced</span>
      ) : advanced ? <div className="k-ai-adv-open">{advanced}</div> : null}
      {drop}
    </div>
  );
}

/* ─── Inspector ─── */
export function InSelect({ value }: { value: string }) {
  return <span className="select k-in-select">{value}<Icon name="chevron" size={12} /></span>;
}
export function InSize({ w, h }: { w: number | string; h: number | string }) {
  return <span className="k-wh"><span className="k-num"><b>W</b><span className="input">{w}</span></span><span className="k-num"><b>H</b><span className="input">{h}</span></span></span>;
}
export function InNum({ value, icon, label }: { value: number | string; icon?: string; label?: string }) {
  return <span className="k-num k-num--one"><b>{icon ? <Icon name={icon} size={12} /> : label}</b><span className="input">{value}</span></span>;
}
export function InFill({ name, tone, pct = "100%" }: { name: string; tone?: Tone | "white" | "ink"; pct?: string }) {
  return <span className="k-fill"><span className={`k-fill-sw k-fill-sw--${tone ?? "white"}`} />{name}<span className="k-fill-pct">{pct}</span></span>;
}
export function InSwitch({ on = true }: { on?: boolean }) {
  return <span className="switch k-switch" aria-checked={on ? "true" : "false"} />;
}
export function InButton({ children, icon }: { children: ReactNode; icon?: string }) {
  return <span className="btn btn--sm">{icon ? <Icon name={icon} size={12} /> : null}{children}</span>;
}
export function InSeg({ options, value }: { options: string[]; value: string }) {
  return <span className="seg k-in-seg">{options.map((o) => <span key={o} className="k-seg-b" aria-pressed={o === value}>{o}</span>)}</span>;
}

const DEFAULT_ADV: [string, string][] = [["width", "1440px"], ["height", "1600px"], ["background", "var(--bg-2)"], ["border-radius", "0"], ["overflow", "hidden"], ["display", "flex"]];

export function Inspector({ title, kind = "Artboard", rows, advancedOpen = false, advanced = DEFAULT_ADV, style }: { title: string; kind?: string; rows: [string, ReactNode][]; advancedOpen?: boolean; advanced?: [string, string][]; style?: CSSProperties }) {
  return (
    <div className="island island--pad k-insp" style={style}>
      <div className="k-insp-hd"><strong>{title}</strong>{kind ? <span className="chip">{kind}</span> : null}</div>
      {rows.map(([k, v]) => <div className="k-insp-row" key={k}><span>{k}</span>{v}</div>)}
      <div className="k-adv" data-open={advancedOpen ? "true" : undefined}>
        <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{advancedOpen ? "CSS" : `${advanced.length} ${advanced.length === 1 ? "property" : "properties"}`}</span></span>
        {advancedOpen ? <div className="k-adv-body">{advanced.map(([k, v]) => <div className="k-css" key={k}><span className="k-mono k-css-k">{k}</span><span className="k-mono k-css-v">{v}</span></div>)}</div> : null}
      </div>
    </div>
  );
}

/* ═══ On the canvas ════════════════════════════════════════════════════════════════════════ */

function Corners() {
  return <><i /><i /><i /><i /></>;
}

/** Where the AI's "AI is …" tag sits on a working artboard.
 *  corner = the label row, right-aligned (top-right corner, outside the art) — the default when it fits;
 *  below  = under the artboard, right-aligned (bottom-right corner, outside the art) — the default when the
 *           label row is too narrow for name + tag;
 *  art    = the pre-2026-10-06 look: cursor + tag together on the art (42 % / 38 %). */
export type AiAt = "corner" | "below" | "art";
type Pt = { x: number | string; y: number | string };
const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);

/** Rough label-row width check (11px UI type, ~6.2px / char) — picks corner vs below. */
function aiTagFits(label: string, tag: string, w: number, sizeTag?: string) {
  const name = 18 + label.length * 6.2 + (sizeTag ? 14 + sizeTag.length * 5.8 : 0);
  const pill = 34 + tag.length * 6.4;
  return name + pill + 12 <= w;
}

export function Artboard({
  label, w, h, x, y, selected = false, size, aiWorking, aiAt, aiCursor, aiMade = false, kind, children, dim = false, page = true, style,
}: {
  label: string; w: number; h: number; x: number; y: number; selected?: boolean; size?: string; aiWorking?: string | boolean; kind?: Kind;
  /** Tag placement; default picks "corner" when name + tag fit the label row, else "below". */
  aiAt?: AiAt;
  /** The AI cursor, parked on the fill it is changing (px or % of the artboard). Default: lower-right of the art
   *  (84 % / 74 %), clear of headlines in every kit mock. `false` = no cursor, tag only. Ignored for aiAt="art". */
  aiCursor?: Pt | false;
  /** A quiet "Made by AI" mark at the right end of the label row (after AI finished; never while working). */
  aiMade?: boolean | string;
  children?: ReactNode; dim?: boolean; page?: boolean; style?: CSSProperties;
}) {
  const tagText = typeof aiWorking === "string" ? aiWorking : "AI is working";
  const at: AiAt = aiAt ?? (aiTagFits(label, tagText, w, selected ? size : undefined) ? "corner" : "below");
  const cur: Pt | false = aiCursor === undefined ? { x: "84%", y: "74%" } : aiCursor;
  return (
    <div className={`k-ab${dim ? " k-ab--dim" : ""}${page ? "" : " k-ab--bare"}`} data-selected={selected ? "true" : undefined} data-ai={aiWorking ? "true" : undefined} data-ai-at={aiWorking ? at : undefined} style={{ left: x, top: y, width: w, height: h, ...style }}>
      <span className="k-ab-name" title={label}>
        {kind ? <Icon name={kind} size={11} /> : null}
        <span className="k-ab-label">{label}</span>
        {selected && size ? <span className="k-ab-size">{size}</span> : null}
      </span>
      {/* The page is the user's design: pinned to its own light palette so the app theme never re-colours it. */}
      <div className="k-ab-page maude-v2 k-fixed" data-theme="light">{children}</div>
      {selected ? <span className="k-sel"><Corners /></span> : null}
      {aiMade && !aiWorking ? (
        <span className="k-ab-made" title={typeof aiMade === "string" ? aiMade : "Made by AI"}><Spark size={9} />{w >= 150 ? (typeof aiMade === "string" ? aiMade : "Made by AI") : null}</span>
      ) : null}
      {aiWorking ? (
        <>
          <span className="k-ab-ai" />
          {at === "art" ? (
            <span className="k-cur k-cur--onab" style={aiCursor ? { left: px(aiCursor.x), top: px(aiCursor.y) } : undefined}>
              <CursorArrow agent />
              <span className="k-cur-tag k-cur-tag--ai motion-soft"><Spark size={10} color="var(--spark-fg)" />{tagText}</span>
            </span>
          ) : (
            <>
              <span className={`k-ab-aitag k-ab-aitag--${at}`}>
                <span className="k-cur-tag k-cur-tag--ai motion-soft"><Spark size={10} color="var(--spark-fg)" />{tagText}</span>
              </span>
              {cur ? <span className="k-cur k-ab-aicur" style={{ left: px(cur.x), top: px(cur.y) }}><CursorArrow agent /></span> : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

/** A selected frame / text / shape inside an artboard (absolute, in the artboard's px). */
export function Selection({ x, y, w, h, label, editing = false }: { x: number; y: number; w: number; h: number; label?: string; editing?: boolean }) {
  return (
    <span className={`k-sel k-sel--inner${editing ? " k-sel--edit" : ""}`} style={{ left: x, top: y, width: w, height: h }}>
      {editing ? null : <Corners />}
      {label ? <span className="k-sel-tag">{label}</span> : null}
    </span>
  );
}

export function Sticky({ color = "yellow", children, x, y, rotate = 0, w, style }: { color?: Exclude<Tone, "grey">; children: ReactNode; x: number; y: number; rotate?: number; w?: number; style?: CSSProperties }) {
  return <div className={`sticky sticky--${color} k-sticky`} style={{ left: x, top: y, rotate: `${rotate}deg`, width: w, ...style }}>{children}</div>;
}

function CursorArrow({ agent = false, tone = "sky" }: { agent?: boolean; tone?: Tone }) {
  const fill = agent ? "var(--presence-agent)" : `var(--object-${tone})`;
  const edge = agent ? "var(--bg-2)" : "var(--object-ink)";
  return (
    <svg className="k-ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={fill} stroke={edge} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export function Cursor({ name, color, x, y, agent = false, label, tag = true, style }: { name?: string; color?: Tone; x: number; y: number; agent?: boolean; label?: string; /** false = no name tag — your OWN pointer is never labelled */ tag?: boolean; style?: CSSProperties }) {
  const p = name ? person(name) : undefined;
  const tone = color ?? p?.tone ?? "sky";
  return (
    <span className="k-cur" style={{ left: x, top: y, ...style }}>
      <CursorArrow agent={agent} tone={tone} />
      {tag ? <span className={`k-cur-tag ${agent ? "k-cur-tag--ai motion-soft" : `k-cur-tag--${tone}`}`}>{agent ? <Spark size={10} color="var(--spark-fg)" /> : null}{label ?? (agent ? "AI" : p?.name)}</span> : null}
    </span>
  );
}

export function CommentPin({ who = "tereza", x, y, text, count, style }: { who?: Who; x: number; y: number; text?: ReactNode; count?: number; style?: CSSProperties }) {
  const p = person(who);
  return (
    <span className="k-cpin" style={{ left: x, top: y, ...style }}>
      <span className={`k-cpin-dot k-av--${p.tone}`}>{p.ini}</span>
      {text ? (
        <span className="k-cpin-card">
          <span className="k-cpin-who"><strong>{p.name}</strong><span>now</span></span>
          <span className="k-cpin-txt">{text}</span>
          {count ? <span className="k-cpin-more">{count} {count === 1 ? "reply" : "replies"}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/* ─── Picture content (the user's designs, in canvas colours) ─── */
export function HeroMock({ headline = "Calm software, made in Brno.", sub = "A small studio for product and brand.", cta = "See the work" }: { headline?: string; sub?: string; cta?: string }) {
  return (
    <div className="k-mk k-hp maude-v2 k-fixed" data-theme="light">
      <div className="k-hp-nav"><b /><i /><i /><i /></div>
      <div className="k-hp-hero"><span className="k-hp-sun" /><span className="k-hp-hill" /></div>
      <div className="k-hp-copy"><strong>{headline}</strong><span>{sub}</span><em>{cta}</em></div>
      <div className="k-hp-tiles"><i /><i /><i /></div>
    </div>
  );
}

export function PricingMock({ title = "Simple pricing", plans = ["Solo", "Studio", "Team"] }: { title?: string; plans?: string[] }) {
  return (
    <div className="k-mk k-pr maude-v2 k-fixed" data-theme="light">
      <div className="k-pr-head"><strong>{title}</strong><span>Monthly · Yearly</span></div>
      <div className="k-pr-plans">
        {plans.map((p, i) => <span key={p} className={`k-pr-plan k-pr-plan--${["a", "b", "c"][i % 3]}`}><b>{p}</b><i /><i /></span>)}
      </div>
    </div>
  );
}

export function PosterMock({ title = "Open studio", sub = "Thursday 18:00", tone = "coral" }: { title?: string; sub?: string; tone?: Exclude<Tone, "grey"> }) {
  return (
    <div className={`k-mk k-po k-po--${tone} maude-v2 k-fixed`} data-theme="light">
      <span className="k-po-sun" />
      <strong>{title}</strong>
      <span>{sub}</span>
    </div>
  );
}

export function PhoneMock({ title = "Your plan", tone = "lilac" }: { title?: string; tone?: Exclude<Tone, "grey"> }) {
  return (
    <div className={`k-mk k-ph k-ph--${tone} maude-v2 k-fixed`} data-theme="light">
      <span className="k-ph-notch" />
      <span className="k-ph-img" />
      <strong>{title}</strong>
      <i /><i />
      <em>Continue</em>
    </div>
  );
}

export function VideoFrameMock({ caption = "Touchdown!", time = "0:12 / 0:30", vertical = false }: { caption?: string; time?: string; vertical?: boolean }) {
  return (
    <div className={`k-mk k-vf${vertical ? " k-vf--v" : ""} maude-v2 k-fixed`} data-theme="light">
      <span className="k-vf-field" /><span className="k-vf-player" />
      <span className="k-vf-cap">{caption}</span>
      <span className="k-vf-bar"><Icon name="play" size={10} /><i><b /></i><span>{time}</span></span>
    </div>
  );
}

/** Alligators brand content — club green (--object-green) on ink, Czech copy. */
export function GatorMock({ variant = "poster", headline, sub }: { variant?: "web" | "poster" | "social" | "reel" | "print" | "jersey" | "invite" | "numbers"; headline?: string; sub?: string }) {
  if (variant === "web") {
    return (
      <div className="k-mk k-gt k-gt--web maude-v2 k-fixed" data-theme="light">
        <div className="k-gt-nav"><span className="k-gt-logo" /><i /><i /><i /><em>ZAPIŠ SE</em></div>
        <div className="k-gt-hero"><span className="k-gt-player" /><div><strong>{headline ?? "STAŇ SE GATOREM"}</strong><span>{sub ?? "Combine 2026 · nábor pro sezónu 2027"}</span><em>ZAPIŠ SE</em></div></div>
        <div className="k-gt-row"><i /><i /><i /></div>
      </div>
    );
  }
  if (variant === "jersey") {
    return (
      <div className="k-mk k-gt k-gt--jersey maude-v2 k-fixed" data-theme="light">
        <span className="k-gt-shirt"><b>27</b></span>
        <span className="k-gt-cap">{headline ?? "Domácí dres 2027"}</span>
      </div>
    );
  }
  if (variant === "numbers") {
    return (
      <div className="k-mk k-gt k-gt--numbers maude-v2 k-fixed" data-theme="light">
        <strong>{headline ?? "Combine v číslech"}</strong>
        <div className="k-gt-stats"><span><b>4,62</b>40 yd</span><span><b>86</b>hráčů</span><span><b>11</b>trenérů</span></div>
      </div>
    );
  }
  if (variant === "invite") {
    return (
      <div className="k-mk k-gt k-gt--invite maude-v2 k-fixed" data-theme="light">
        <span className="k-gt-logo k-gt-logo--lg" />
        <strong>{headline ?? "Pozvánka na Combine 2026"}</strong>
        <span>{sub ?? "So 14. 3. · Brno, Kraví hora"}</span>
      </div>
    );
  }
  return (
    <div className={`k-mk k-gt k-gt--${variant} maude-v2 k-fixed`} data-theme="light">
      <span className="k-gt-logo" />
      <span className="k-gt-player" />
      <strong>{headline ?? (variant === "print" ? "COMBINE 2026" : "STAŇ SE GATOREM")}</strong>
      <span className="k-gt-sub">{sub ?? (variant === "social" ? "Gameweek 4 · So 15:00" : "So 14. 3. · Kraví hora")}</span>
      <em>ZAPIŠ SE</em>
    </div>
  );
}

/* ═══ Overlays ═════════════════════════════════════════════════════════════════════════════ */

export function Toast({ children, action, icon, at = "dock", style }: { children: ReactNode; action?: string; icon?: string; at?: "dock" | "top" | "free"; style?: CSSProperties }) {
  return (
    <div className={`island k-toast k-toast--${at}`} style={style}>
      {icon ? <span className={`k-toast-ic k-toast-ic--${icon}`}>{icon === "spark" ? <Spark size={14} /> : <Icon name={icon} size={16} />}</span> : null}
      <span className="k-toast-txt">{children}</span>
      {action ? <span className="btn btn--ghost btn--sm k-toast-act">{action}</span> : null}
    </div>
  );
}

export function Dialog({ title, children, primary, secondary = "Cancel", danger = false, width = 420, style }: { title: ReactNode; children?: ReactNode; primary: string; secondary?: string | null; danger?: boolean; width?: number; style?: CSSProperties }) {
  return (
    <div className="k-dialog" style={{ width, ...style }}>
      <p className="k-dialog-t">{title}</p>
      {children ? <div className="k-dialog-b">{children}</div> : null}
      <div className="k-dialog-a">
        {secondary ? <span className="btn">{secondary}</span> : null}
        <span className={`btn ${danger ? "k-btn-danger" : "btn--primary"}`}>{primary}</span>
      </div>
    </div>
  );
}
export const Sheet = Dialog;

/** CONTRACT §7 — the ONE "Connect your Claude account?" sheet (first use of AI when no Claude account is connected).
 *  A window sheet (put a <Veil strong /> under it) with the account option and the API-key way under Advanced.
 *  `inline` = drawn in flow (a close-up), not centred in the window. */
export function ConnectSheet({ width = 440, style, inline = false }: { width?: number; style?: CSSProperties; inline?: boolean }) {
  return (
    <div className={`k-dialog k-conn${inline ? " k-conn--inline" : ""}`} style={{ width, ...style }}>
      <p className="k-dialog-t">Connect your Claude account?</p>
      <div className="k-dialog-b k-conn-b">
        <p>Connect your Claude account to let AI draft this.</p>
        <span className="k-conn-opt">
          <span className="k-conn-ic"><Spark size={14} /></span>
          <span className="k-conn-txt"><strong>Claude Pro or Max</strong><span>Sign in through your browser. Claude Code is set up for you.</span></span>
        </span>
        <div className="k-adv k-conn-adv"><span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">Use an API key instead</span></span></div>
        <p className="k-conn-fine">Your prompt waits here and runs as soon as it's connected.</p>
      </div>
      <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Connect</span></div>
    </div>
  );
}

export type PaletteRow = { label: string; art?: Art; icon?: string; meta?: string; where?: string; via?: string; selected?: boolean; hl?: [number, number] };
export function SearchPalette({ query, groups, footer, empty, style }: { query: string; groups: { title: string; aside?: string; rows: PaletteRow[] }[]; footer?: string; empty?: boolean; style?: CSSProperties }) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const q = query.trim().toLowerCase();
  const hl = (text: string) => {
    const at = q ? text.toLowerCase().indexOf(q) : -1;
    if (at < 0) return text;
    return <>{text.slice(0, at)}<mark className="k-mark">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
  };
  return (
    <div className="k-pal" style={style}>
      <span className="k-pal-field"><Icon name="search" size={18} /><span className="k-pal-typed">{query || <span className="k-pal-ph">Search canvases, actions, or ask AI…</span>}{query ? <i className="k-caretline k-caretline--lg" /> : null}</span><Kbd>esc</Kbd></span>
      <div className="k-pal-res">
        {empty || (q && !total) ? <p className="k-pal-none">Nothing called “{query.trim()}”. Try another word, or ask AI to find it.</p> : null}
        {groups.map((g) => (
          <div key={g.title}>
            <p className="island-title k-pal-gt">{g.title}{g.aside ? <span className="k-pal-aside">{g.aside}</span> : null}</p>
            {g.rows.map((r) => (
              <span className="k-pal-row" data-sel={r.selected ? "true" : undefined} key={r.label + (r.meta ?? "")}>
                {r.art ? <Thumb art={r.art} className="k-thumb--pal" /> : <span className="k-pal-ic"><Icon name={r.icon ?? "search"} /></span>}
                <span className="k-pal-label"><span className="k-pal-ltxt">{hl(r.label)}</span>{r.via ? <span className="k-pal-via">matches “{r.via}”</span> : null}</span>
                {r.meta ? <span className="k-pal-meta">{r.meta}</span> : null}
                {r.where ? <span className="chip">{r.where}</span> : null}
              </span>
            ))}
          </div>
        ))}
        <div className="k-pal-ask">
          <span className="k-pal-row">
            <span className="k-pal-ic k-pal-ic--spark"><Spark size={12} color="var(--spark-fg)" /></span>
            <span className="k-pal-label">Ask AI<span className="k-pal-meta"> — describe what you want on the canvas</span></span>
            <span className="k-keys"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          </span>
        </div>
      </div>
      <div className="k-pal-foot">
        <span className="k-pal-hints"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span></span>
        <span>{footer ?? (q ? `${total} ${total === 1 ? "result" : "results"}` : "Type to search")}</span>
      </div>
    </div>
  );
}

export function Tooltip({ text, x, y, below = false }: { text: ReactNode; x: number; y: number; below?: boolean }) {
  return <span className={`k-tip k-tip--free${below ? " k-tip--below" : ""}`} style={{ left: x, top: y }}>{text}</span>;
}

/* ─── Home ─── */
type HomeCard = { name: string; art: Art; meta: string; ai?: boolean; who?: Who[] };
const HOME_RECENT: HomeCard[] = [
  { name: "Homepage", art: "home", meta: "Studio site · 2 min ago", who: ["tereza"] },
  { name: "Pricing", art: "price", meta: "Studio site · Tereza is here", who: ["tereza", "jonas"] },
  { name: "Combine-kampan", art: "gator-poster", meta: "Alligators brand · yesterday", ai: true },
  { name: "Mobile — detail", art: "mobile", meta: "Studio site · Monday" },
];
const HOME_STARTERS: { t: string; l: string; art: Art }[] = [
  { t: "A pricing page", l: "with a yearly toggle", art: "price" },
  { t: "Three logo ideas", l: "for Alligators brand", art: "brand" },
  { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
];
type HomeProject = { name: string; arts: [Art, Art, Art]; meta: string; ini: string; tone: Tone; local?: boolean };
const HOME_PROJECTS: HomeProject[] = [
  { name: "Studio site", arts: ["home", "price", "onb"], meta: "5 canvases", ini: "S", tone: "yellow" },
  { name: "Alligators brand", arts: ["gator-poster", "gator-web", "gator-reel"], meta: "93 canvases", ini: "A", tone: "lilac" },
];

export function Home({ prompt, placeholder = "A calm landing page for Studio site, light and airy", target = "Studio site", recents = HOME_RECENT, projects = HOME_PROJECTS, starters = HOME_STARTERS, sending = false, compact = false, emptyStart = true }: { prompt?: string; /** the field's grey example when nothing is typed */ placeholder?: string; target?: string; recents?: HomeCard[]; projects?: HomeProject[]; starters?: { t: string; l: string; art: Art }[]; sending?: boolean; compact?: boolean; /** CONTRACT §6 — Home always offers a way in without AI. */ emptyStart?: boolean }) {
  return (
    <div className="k-home-bg">
      <ProjectPill project="Home" home />
      <div className="island k-home-tr"><span className="icon-btn"><Icon name="search" /></span><Kbd>⌘K</Kbd></div>
      <div className="k-home">
        <span className={`k-home-spark${sending ? " motion-soft" : ""}`}><Spark size={48} /></span>
        <p className="k-home-title">What shall we make?</p>
        <p className="k-home-sub">Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there.</p>
        <div className="island island--pad k-home-ask">
          <div className="ask k-ask-lg">
            <span className={`k-ask-in${prompt ? "" : " k-ask-ph"}`}>{prompt ?? placeholder}{prompt && !sending ? <i className="k-caretline" /> : null}</span>
            <span className="send">{sending ? <span className="motion-soft"><Spark size={14} color="var(--spark-fg)" /></span> : <Spark size={14} color="var(--spark-fg)" />}</span>
          </div>
          <div className="k-home-askfoot">
            <span className="chip">Starts a new canvas in <strong>{target}</strong><Icon name="chevron" size={12} /></span>
            <span className="k-home-hint"><Kbd>↵</Kbd> to send</span>
          </div>
        </div>
        <div className="k-starters">
          {starters.map((s) => (
            <span className="k-starter" key={s.t}><Thumb art={s.art} className="k-thumb--starter" /><span><strong>{s.t}</strong><span>{s.l}</span></span></span>
          ))}
        </div>
        {emptyStart ? <span className="btn btn--ghost btn--sm k-home-empty">Start with an empty canvas <Kbd>⌘N</Kbd></span> : null}
        {compact ? null : (
          <>
            <div className="k-home-sec">
              <p className="k-home-h">Recent canvases<span className="btn btn--ghost btn--sm">See all</span></p>
              <div className="k-cards">
                {recents.map((c) => (
                  <span className="k-card" key={c.name}>
                    <span className="k-card-pic">
                      <Thumb art={c.art} className="k-thumb--card" />
                      {c.ai ? <span className="chip chip--spark k-card-ai"><Spark size={9} />Made by AI</span> : null}
                    </span>
                    <strong>{c.name}</strong>
                    <span className="k-card-meta">{c.meta}</span>
                    {c.who ? <span className="k-card-faces">{c.who.map((w) => <Avatar key={person(w).name} who={w} size="sm" />)}</span> : null}
                  </span>
                ))}
              </div>
            </div>
            <div className="k-home-sec">
              <p className="k-home-h">Recent projects</p>
              <div className="k-projects">
                {projects.map((p) => (
                  <span className="k-project" key={p.name}>
                    <span className="k-stack">{p.arts.map((a, i) => <Thumb key={i} art={a} />)}</span>
                    <span className="k-project-txt"><strong>{p.name}</strong><span>{p.meta}</span></span>
                    {p.local ? <span className="k-project-st"><Icon name="laptop" size={14} /></span> : null}
                    <Avatar ini={p.ini} tone={p.tone} size="sm" />
                  </span>
                ))}
                <span className="k-project k-project--open">
                  <span className="k-project-plus"><Icon name="folder" size={18} /></span>
                  <span className="k-project-txt"><strong>Open project…</strong><span>Any folder works</span></span>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══ Explainers ═══════════════════════════════════════════════════════════════════════════ */

export function Note({ n, title, children, tag }: { n?: number; title: ReactNode; children?: ReactNode; tag?: string }) {
  return (
    <div className="k-note">
      {n !== undefined ? <Callout n={n} /> : null}
      <p className="k-note-p"><strong>{title}</strong>{children ? <> {children}</> : null}</p>
      {tag ? <span className="chip k-note-tag">{tag}</span> : null}
    </div>
  );
}

export function Callout({ n, x, y, style, outline = false }: { n: number | string; x?: number; y?: number; style?: CSSProperties; /** in-window marker look (open ring) — never confused with a Note badge */ outline?: boolean }) {
  const abs = x !== undefined && y !== undefined;
  return <span className={`k-callout${abs ? " k-callout--abs" : ""}${outline ? " k-callout--outline" : ""}`} style={abs ? { left: x, top: y, ...style } : style}>{n}</span>;
}

/* ─── Alligators brand — the ONE canonical project tree (from 01 Create Flow) ─────────────────
   93 canvases: 2026 (combine 6 + dresy 4 + social 6 = 16) + club-web 9 + print 6 + social 31 + legacy 27
   + 4 at the root (test, Test2, ahoj, ahoj2). Every v2 canvas that draws the Alligators tree uses these,
   so counts never drift between canvases. Open/closed state: spread and override (`{ ...f, open: true }`). */
export const ALLIGATORS_COMBINE: CanvasItem[] = [
  { name: "Combine-kampan", art: "gator-poster", people: ["tereza"] },
  { name: "Combine-kampan — varianta pro partnery a sponzory", art: "gator-web", kinds: ["web"] },
  { name: "Combine-letak-registrace", art: "gator-print", kinds: ["print"] },
  { name: "Combine-invite", art: "gator-social", kinds: ["digital"] },
  { name: "Combine-cisla", art: "gator-numbers", kinds: ["digital"] },
  { name: "Combine-video-AI", art: "video", kinds: ["video"] },
];
export const ALLIGATORS_FOLDERS: Folder[] = [
  {
    name: "2026", open: true, count: 16,
    folders: [
      { name: "combine", open: true, count: 6, items: ALLIGATORS_COMBINE },
      { name: "dresy", count: 4 },
      { name: "social", count: 6 },
    ],
  },
  { name: "club-web", count: 9 },
  { name: "print", count: 6 },
  { name: "social", count: 31 },
  { name: "legacy", count: 27 },
];
export const ALLIGATORS_ROOT: CanvasItem[] = [
  { name: "test", art: "blank" },
  { name: "Test2", art: "blank" },
  { name: "ahoj", art: "blank" },
  { name: "ahoj2", art: "board" },
];
export const ALLIGATORS_COUNT = 93;
