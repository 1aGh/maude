/**
 * @canvas      00 Index — the overview of the Maude v2 "canvases in practice" set: what was asked, which
 *              canvas answers it, the rules every canvas follows, the open questions, and what's shared
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ix-map | ix-rules | ix-questions | ix-kit
 * @brief       The first thing Michal opens to review the whole set. Content comes from
 *              .ai/plans/notes/v2-canvases-brief.md (request verbatim), v2-open-questions.md,
 *              CONTRACT.md §6–§7 and every canvas's .meta.json (01–13).
 *
 * Convention: four reading boards, 1600 wide, HUG height (no `fixed`) — a fixed artboard counts its
 * ~24 px label strip inside its height and clips the foot (known issue, listed on ix-kit). All
 * chrome pieces come from ./_kit; local pieces use the `ix-` prefix. Tokens only. The user's work
 * (Thumb) stays pinned light via the kit's .k-fixed scope.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./00 Index.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { ReactNode } from "react";
import { ART_NAMES, Avatar, GLYPH_NAMES, Icon, Kbd, KindGlyph, Mark, Spark, StatusWord, Thumb, V2 } from "./_kit";
import type { Art, Kind } from "./_kit";

const W = 1600;
/* Height floors (hug artboards grow past them). The page fills at least the floor, so no band shows. */
const H = { map: 3370, rules: 1960, questions: 2020, kit: 1820 };

/* ═══ Data — the thirteen canvases (from each .meta.json) ═════════════════════════════════════ */

type Pic = { art: Art; w: number; h: number };
type CanvasCard = {
  n: string;
  title: string;
  file: string;
  q: string;
  boards: number;
  sections: number;
  pics: Pic[];
  badge: ReactNode;
  look: [string, string][]; // [artboard label, id]
};

const P = (art: Art, w = 84, h = 58): Pic => ({ art, w, h });
const PORTRAIT = (art: Art): Pic => ({ art, w: 46, h: 68 });

const CANVASES: CanvasCard[] = [
  {
    n: "01", title: "Create Flow", file: "01 Create Flow", boards: 20, sections: 4,
    q: "How do I start a canvas and keep working on it — from one sentence on Home to 93 canvases?",
    pics: [P("home"), P("price"), PORTRAIT("gator-social")], badge: <Icon name="frame" size={14} />,
    look: [["1 · Home — one sentence", "cf-home-prompt"], ["13 · 93 canvases in folders", "cf-big-tree"], ["17 · Tereza, Jonas, AI and you", "cf-busy"]],
  },
  {
    n: "02", title: "Onboarding", file: "02 Onboarding", boards: 22, sections: 5,
    q: "How do I get in — cloud.maude.sh first, a local project one step aside, the rest under Advanced?",
    pics: [P("onb"), P("home"), P("brand")], badge: <Icon name="cloud" size={14} />,
    look: [["1 · First launch is Home", "ob-first-launch"], ["8 · Landed on her comment", "ob-invite-landed"], ["14 · Advanced options, opened", "ob-adv-open"]],
  },
  {
    n: "03", title: "AI Chat", file: "03 AI Chat", boards: 29, sections: 7,
    q: "How do I ask AI — and what happens when several chats run at once?",
    pics: [PORTRAIT("gator-poster"), P("gator-social", 68, 68), PORTRAIT("gator-reel")], badge: <Spark size={14} />,
    look: [["1 · Two AIs, two artboards", "ai-hero"], ["15 · The rule, drawn once", "ai-queue-rule"], ["21 · Needs you — panel hidden, another canvas", "ai-needs-hidden"]],
  },
  {
    n: "04", title: "Modes", file: "04 Modes", boards: 26, sections: 8,
    q: "How do I switch between Edit, Preview and Present — and what stays on screen?",
    pics: [P("home"), P("price"), PORTRAIT("gator-reel")], badge: <Icon name="view" size={14} />,
    look: [["1 · The mode switch, and what each mode shows", "md-model"], ["13 · Full screen — 3 of 14", "md-present-full"], ["21 · Inspect “Book a call”", "md-inspect"]],
  },
  {
    n: "05", title: "Empty States", file: "05 Empty States", boards: 20, sections: 4,
    q: "What do I see when there's nothing there yet — or when it only looks empty?",
    pics: [P("blank"), P("blank"), P("home")], badge: <Icon name="insert" size={14} />,
    look: [["7 · New canvas — AI ready · offline · AI not connected yet", "es-canvas-three"], ["12 · ⌘K — nothing called “pricng”", "es-search-k"], ["19 · Every artboard moved to the trash", "es-all-trashed"]],
  },
  {
    n: "06", title: "Advanced", file: "06 Advanced", boards: 25, sections: 6,
    q: "Where did every advanced control go? Nothing deleted — one fold away, and ⌘K finds it.",
    pics: [P("admin"), P("flow"), P("board")], badge: <Icon name="settings" size={14} />,
    look: [["1 · The map — 124 things, each with its home", "ad-map"], ["2 · Why there's no Advanced mode switch", "ad-why"], ["13 · Menu › Diagnostics, Advanced open", "ad-diag"]],
  },
  {
    n: "07", title: "Video Editing", file: "07 Video Editing", boards: 26, sections: 8,
    q: "How do I cut a video on a video artboard — by hand, or by asking AI?",
    pics: [PORTRAIT("gator-reel"), P("video", 96, 54), PORTRAIT("gator-reel")], badge: <Icon name="video" size={14} />,
    look: [["2 · Select it — the timeline slides out of it", "ve-select"], ["11 · 12 clips in, a 0:30 cut out", "ve-ai-cut"], ["16 · Three formats, one edit", "ve-formats"]],
  },
  {
    n: "08", title: "Artboard Kinds", file: "08 Artboard Kinds", boards: 19, sections: 7,
    q: "What changes between a fixed-size, web page, print and video artboard?",
    pics: [P("gator-web", 78, 58), P("gator-social", 58, 58), PORTRAIT("gator-print"), PORTRAIT("gator-reel")], badge: <Icon name="print" size={14} />,
    look: [["1 · F — pick what you're making", "ak-picker"], ["7 · A6 flyer — the inspector speaks mm", "ak-print-letak"], ["14 · After — the post stays, the A6 copy beside it", "ak-convert-after"]],
  },
  {
    n: "09", title: "Export", file: "09 Export", boards: 21, sections: 7,
    q: "How do I get files out — one artboard, a folder, or the whole project?",
    pics: [PORTRAIT("gator-print"), P("gator-social", 58, 58), P("video", 96, 54)], badge: <Icon name="export" size={14} />,
    look: [["2 · A print artboard → Print PDF, on paper", "ex-print"], ["7 · ⇧⌘E with nothing selected → this canvas", "ex-canvas"], ["11 · Cloud or this Mac, done, partly done", "ex-states"]],
  },
  {
    n: "10", title: "Share and Collaboration", file: "10 Share and Collaboration", boards: 20, sections: 7,
    q: "How do people and AI work on one canvas together — and stay in sync?",
    pics: [PORTRAIT("gator-poster"), P("gator-social", 62, 62), PORTRAIT("gator-print")], badge: <Icon name="people" size={14} />,
    look: [["1 · Share — Invite is the first thing", "co-share-sheet"], ["6 · Bring everyone here", "co-bring"], ["14 · You and Jonas changed the same sticky", "co-conflict"]],
  },
  {
    n: "11", title: "Projects and Navigation", file: "11 Projects and Navigation", boards: 23, sections: 6,
    q: "How do I always find the right project, canvas and artboard?",
    pics: [P("moodboard"), P("gator-numbers"), P("gator-jersey")], badge: <Icon name="search" size={14} />,
    look: [["5 · A or B — the trade-offs, and a pick", "pn-ab"], ["17 · Artboards by name, accents and typos", "pn-k-close"], ["18 · Versions with pictures", "pn-history"]],
  },
  {
    n: "12", title: "Import and Assets", file: "12 Import and Assets", boards: 22, sections: 8,
    q: "How do photos, footage, sound, Figma files and a brand get into a project?",
    pics: [P("moodboard"), P("brand"), PORTRAIT("gator-poster")], badge: <Icon name="image" size={14} />,
    look: [["4 · Assets — drag a photo onto an artboard", "ia-assets-panel"], ["10 · Select a photo — the photo inspector", "ia-photo-inspector"], ["18 · Import a brand — use it as the project's style", "ia-brand"]],
  },
  {
    n: "13", title: "Design System", file: "13 Design System", boards: 25, sections: 8,
    q: "Where does the design system live — and how is one made, edited and shared? On one board.",
    pics: [P("brand"), P("gator-web", 78, 58), P("gator-social", 58, 58)], badge: <Icon name="layers" size={14} />,
    look: [["3 · The Design system canvas — Studio site", "ds-board-studio"], ["8 · Update canvases — tick who follows", "ds-edit-review"], ["13 · Make a design system — three quick inputs", "ds-make-inputs"]],
  },
];
const BY_N = Object.fromEntries(CANVASES.map((c) => [c.n, c]));
const TOTAL_BOARDS = CANVASES.reduce((s, c) => s + c.boards, 0);

const GROUPS: { title: string; range: string; line: string; ns: string[]; span: number }[] = [
  { title: "Core flows", range: "01–04", line: "The everyday loop — make a canvas, get in, ask AI, look at the work.", ns: ["01", "02", "03", "04"], span: 3 },
  { title: "States and depth", range: "05–06", line: "What nothing looks like, and where everything advanced went.", ns: ["05", "06"], span: 6 },
  { title: "Media and output", range: "07–09", line: "Video, the four artboard kinds, and getting files out.", ns: ["07", "08", "09"], span: 4 },
  { title: "Extras", range: "10–13", line: "Answers to “...co te jeste napadne” — people, finding things, bringing things in — and the design system, on a board.", ns: ["10", "11", "12", "13"], span: 3 },
];

/* Michal's request, verbatim (Czech, as typed), each bullet → the canvases that answer it. */
const REQUEST_INTRO = "nejaky zakladni design system mame, pojdme ho rozkreslit v praxi design:new. Udelej novou slozku v canvases a chci videt hlavne";
const REQUEST: { q: string; to: string[]; extra?: string }[] = [
  { q: "zakladni user flow tvorby a praci s canvasem", to: ["01"] },
  { q: "nejaky onboarding ale ne tak slozity jako ted, vse smerujeme predevsim na to aby uzivatele pouzivali cloud.maude.sh vse ostatni je advanced ale rozkresli to a nebo chci jen vytvorit lokalni projekt", to: ["02", "06"] },
  { q: "Jak pouzivat AI chat a edge cases kdy pojede nekolik sessions zaraz", to: ["03"] },
  { q: "Ruzne mody edit/preview/present atd.", to: ["04"] },
  { q: "empty states", to: ["05"] },
  { q: "advanced mode", to: ["06"] },
  { q: "video editing", to: ["07"] },
  { q: "artboard kinds print/web/digital/video atd.", to: ["08"] },
  { q: "export", to: ["09"] },
  { q: "...co te jeste napadne", to: ["10", "11", "12"] },
];
const REQUEST_OUTRO = "Vse rozkresli jako edge cases napriklad Maude/alligators ktery uz ma docela komplikovanou strukturu i spoustu ruznych artboards a typu";
/* The follow-up, 8 Oct 2026 (verbatim) → 13, with 11 · pn-ds drawing where the board sits. */
const REQUEST_DS = "ukaz mi jeste jeden canvas kde uvidim jak bude vypadat tvorba a zobrazeni design systemu";

/* ═══ Data — rules (CONTRACT §3, §4, §6 settled · §7 proposed) ══════════════════════════════ */

type Rule = { t: string; d: ReactNode; see: string[]; src: "§2" | "§3" | "§4" | "§6" | "§7" | "Q" };
const RULES: { title: string; icon: ReactNode; rules: Rule[] }[] = [
  {
    title: "AI", icon: <Spark size={15} />,
    rules: [
      { t: "AI offline", src: "§7", d: <>Ask AI stays on. A prompt sent offline waits — <q>Queued — sends when this Mac is online.</q> The empty canvas adds <q>AI is back when this Mac is online.</q></>, see: ["01 · cf-offline-create", "03 · ai-not-ready"] },
      { t: "AI not connected yet", src: "§7", d: <>Ask AI looks the same. The first use opens one sheet — <q>Connect your Claude account to let AI draft this.</q> Cloud doesn't include AI; people bring their own Claude account.</>, see: ["02 · ob-ai-connect"] },
      { t: "One AI per artboard", src: "§7", d: <>A second ask on a busy artboard waits in line, or runs on a copy. Different artboards run side by side; a whole-canvas ask takes free artboards first.</>, see: ["03 · ai-queue-rule"] },
      { t: "A way in without AI", src: "§7", d: <>Home always offers <q>Start with an empty canvas ⌘N</q> under the starters.</>, see: ["05 · es-home-cloud"] },
      { t: "Send and Ask AI are azure", src: "§7", d: <>An AI action is still an action — azure with a white spark. Vermilion fills only AI's presence: its cursor, the working tag, progress.</>, see: ["03 · ai-open", "CONTRACT §7"] },
      { t: "AI describes the result", src: "§4", d: <>Never itself: <q>Done — three hero variants are on the canvas. Pick one.</q> ⌘Z undoes AI's changes too.</>, see: ["01 · cf-undo-ai"] },
    ],
  },
  {
    title: "Sharing and roles", icon: <Icon name="people" size={15} />,
    rules: [
      { t: "Share opens on Invite", src: "§6", d: <>The primary button is <b>Invite</b>; Copy link is a secondary button in the link row.</>, see: ["10 · co-share-sheet"] },
      { t: "Access in words", src: "§6", d: <><b>Can view</b> (look only) · <b>Can comment</b> (look + comment), with <b>Ask to edit</b> as the one action.</>, see: ["10 · co-ask-edit"] },
      { t: "Save status, shown not operated", src: "§6", d: <>One word by the faces: Saved · Syncing… · Offline — kept on this Mac · Local project. No dot on the project pill.</>, see: ["01 · cf-status-words"] },
      { t: "Moved to the trash", src: "§7", d: <>Never “deleted”. Trash keeps things until you clear it out; editors move to the trash, owners empty it.</>, see: ["10 · co-share-roles", "11 · pn-trash"] },
    ],
  },
  {
    title: "Video", icon: <Icon name="video" size={15} />,
    rules: [
      { t: "The timeline comes with a video artboard", src: "§7", d: <>⇧⌘T shows or hides it; it folds away on deselect unless Keep timeline open is on.</>, see: ["07 · ve-deselect"] },
      { t: "Space", src: "§7", d: <>Tap Space plays or pauses a selected video artboard; hold Space is always Hand.</>, see: ["07 · ve-play"] },
    ],
  },
  {
    title: "Modes", icon: <Icon name="view" size={15} />,
    rules: [
      { t: "The mode switch lives in the Share cluster", src: "§7", d: <>Edit · Preview · Present. Read-only people see <b>Viewing</b> there instead of Edit.</>, see: ["04 · md-model", "04 · md-comment-only"] },
      { t: "AI holds still under your pointer", src: "Q", d: <>While you preview, AI's change to the artboard you're clicking through lands when you move off it.</>, see: ["04 · md-edge-ai"] },
      { t: "Two toolbars, one per mode", src: "§2", d: <><b>Edit</b> makes things inside artboards — Select · Hand · Frame · Shape · Pen · Text · <b>Image</b> · <b>Component</b> · More. <b>Preview</b> only marks up, FigJam-style — Hand · Sticky · Comment · Marker · Arrow · Shape · Text · Stickers · Section; the design stays live. N C M A E S in Edit switch to Preview with that tool; esc returns to Edit.</>, see: ["04 · md-annotate", "04 · md-edit-image", "04 · md-edit-component"] },
      { t: "Keys for the modes", src: "Q", d: <>⌥⌘P Preview · ⌥⌘↵ Present from the selection · ⇧⌥⌘↵ from the start · L for a ringed pointer while presenting.</>, see: ["04 · md-keys"] },
    ],
  },
  {
    title: "Design system", icon: <Icon name="layers" size={15} />,
    rules: [
      { t: "The design system lives on a board", src: "§7", d: <>Michal's idea: one <b>Design system</b> board per project, pinned above every canvas — Brand · Colour · Type · Space & shape · Motion · Components · Patterns. ⌘K and the inspector's <q>Uses …</q> link find it; the files are its Advanced.</>, see: ["13 · ds-where-studio", "11 · pn-ds"] },
      { t: "System changes arrive as a review", src: "§7", d: <>Tokens and components are edited in place on the board; canvases change only after <q>Update 5 canvases</q>. A canvas that stayed out shows a quiet dot.</>, see: ["13 · ds-edit-review", "13 · ds-edit-instance"] },
      { t: "Lower elevation", src: "§7", d: <>Islands float on a soft shadow, not a drop shadow — the elevation tokens were lowered in Michal's review.</>, see: ["every canvas"] },
    ],
  },
  {
    title: "Export", icon: <Icon name="export" size={15} />,
    rules: [
      { t: "Scope is always visible", src: "§7", d: <>⇧⌘E with nothing selected exports this canvas. The sheet shows Selection · This canvas · Folder · Whole project, with a size and time estimate.</>, see: ["09 · ex-canvas"] },
      { t: "Done means Show in Finder", src: "§7", d: <>The done toast's one action. A partial failure says <q>Exported 114 of 115</q> and offers one Retry. Links live in Share.</>, see: ["09 · ex-states"] },
      { t: "Print colour, in one line", src: "§7", d: <><q>RGB — the print shop converts to CMYK</q>. No CMYK option in v2.</>, see: ["08 · ak-print-letak", "09 · ex-print"] },
    ],
  },
  {
    title: "Assets", icon: <Icon name="image" size={15} />,
    rules: [
      { t: "Assets is the left panel's third tab", src: "§7", d: <>Canvases · Layers · Assets — also Menu › View › Assets and ⌘K. Select a tile, ↵ places it on the selected artboard.</>, see: ["12 · ia-assets-keys"] },
      { t: "Search in pictures is opt-in", src: "§7", d: <>Names and tags always; what's <i>in</i> pictures once per project, with your Claude account. Falls back to names.</>, see: ["12 · ia-assets-find"] },
      { t: "Not here yet vs Missing", src: "§7", d: <><q>Waiting for Jonas's Mac</q> is quiet. Only a file no device has is <b>Missing</b>, with Relink….</>, see: ["12 · ia-missing", "07 · ve-footage"] },
      { t: "Figma arrives as an exact picture", src: "§7", d: <>Make editable converts one artboard (Figma Dev Mode, paid seat). Never claim text stays editable.</>, see: ["12 · ia-figma-arrived"] },
      { t: "Photo edits apply to one use", src: "§7", d: <>Crop, look, background removal stay with that use; Apply to every use is an explicit choice.</>, see: ["12 · ia-photo-inspector"] },
    ],
  },
  {
    title: "Words", icon: <Icon name="type" size={15} />,
    rules: [
      { t: "Designer vocabulary", src: "§3", d: <>canvas · artboard · frame · panel · toolbar · Search · Version history · Hide panels · Advanced · Diagnostics — never board, screen, sidebar, publish, Pro, Debug.</>, see: ["every canvas"] },
      { t: "No “we”, no “I”", src: "§4", d: <>The app never speaks as itself. The one exception is Home's <q>What shall we make?</q> (you + AI).</>, see: ["02 · ob-first-launch"] },
      { t: "One verb per dialog, one action per toast", src: "§4", d: <>The title asks with the primary button's verb (<q>Move “Pricing” to the trash?</q> → Move to trash); the other button is Cancel.</>, see: ["11 · pn-trash"] },
      { t: "The empty canvas line", src: "§6", d: <><q>Your canvas is ready. Ask AI for a first draft, or start drawing.</q></>, see: ["05 · es-canvas-ai"] },
      { t: "Nothing found", src: "§4", d: <><q>Nothing called “pricng”. Try another word, or ask AI to find it.</q> Counts read “N results”.</>, see: ["05 · es-search-k"] },
      { t: "Project tabs", src: "§6", d: <>Tab avatar = the project's initial (S, A). Right-click: Rename… · Move to a new window · Sign in as another account… · Close tab.</>, see: ["11 · pn-tab-menu"] },
    ],
  },
];

/* ═══ Data — open questions (v2-open-questions.md) ═════════════════════════════════════════ */

const BIG: { t: string; d: ReactNode; pick?: string; see: string[] }[] = [
  { t: "Project tabs — A or B?", d: <>A = native macOS window tabs (the plan). B = a Figma-style strip with richer state — needs plan amendments and a DDR-109 security review.</>, pick: "Recommended: A for v2.0", see: ["11 · pn-ab"] },
  { t: "AI = bring your own Claude account?", d: <>Cloud doesn't include AI. People connect their own Claude subscription or API key on the first Ask AI — one sheet.</>, see: ["02 · ob-ai-connect", "CONTRACT §7"] },
  { t: "Cloud trial", d: <>14 days, no card, starts silently at the first sign-in. What happens when it ends?</>, see: ["02 · ob-home-new"] },
  { t: "One AI per artboard?", d: <>A second ask waits or runs on a copy; whole-canvas asks start on free artboards. Or a true “Run anyway” — last write wins?</>, see: ["03 · ai-queue-rule"] },
  { t: "Quitting while AI runs", d: <>AI runs on this Mac and stops; Continue on next launch. Should cloud projects keep AI running server-side?</>, see: ["03 · ai-quit"] },
  { t: "Roles", d: <>Can view = look only · Can comment = look + comment · Ask to edit goes to the owner. Editors move to trash, only owners empty it. The hub today: owner / member / viewer (viewer can comment).</>, see: ["10 · co-share-roles", "CONTRACT §6"] },
  { t: "Mode switch in the Share cluster", d: <>Edit · Preview · Present there, not in the toolbar. Proposed keys ⌥⌘P · ⌥⌘↵ · ⇧⌥⌘↵, and L for the pointer.</>, see: ["04 · md-model", "04 · md-keys"] },
  { t: "AI never changes what you're pointing at", d: <>While you preview, AI's change to the artboard under your pointer lands when you move off it.</>, see: ["04 · md-edge-ai"] },
];

/* The latest round — 13 Design System, plus two AI details from 03. Numbered on after BIG. */
const NEW_Q: { t: string; d: ReactNode; see: string[] }[] = [
  { t: "System changes — push or pull?", d: <>Drawn as push with a review: <q>Update 5 canvases</q> before anything changes, a quiet dot on a canvas that stayed out. Or does each canvas pull an update when it's opened?</>, see: ["13 · ds-edit-review", "13 · ds-edit-instance"] },
  { t: "Frozen brand colours — lock, or only warn?", d: <>Alligators' 2023 brand colours carry a lock: used, never changed. Or a warning that still lets an editor change them?</>, see: ["13 · ds-board-gator"] },
  { t: "“Make a design system” — instead of setup-ds?", d: <>A sentence, things to learn from, three directions. Does it replace today's long <code className="k-mono">/design:setup-ds</code> interview, or does the interview stay under Advanced?</>, see: ["13 · ds-make-inputs"] },
  { t: "What a shared system is called", d: <>Drawn as a <b>team library</b> on cloud.maude.sh, updates arriving as a review. Library, shared system, brand kit — which word?</>, see: ["13 · ds-many-library"] },
  { t: "How far does a folder's “read” reach?", d: <>A folder asks once — <q>Let AI read “Combine 2026 fotky” (48 files)?</q> Once per folder, per project or per chat — and do new files in it count?</>, see: ["03 · ai-attach-menu"] },
  { t: "Is sharing the done signal?", d: <>After a share the lead suggestion says <q>Because you just shared this canvas</q> and offers a review or a print check. Is a share the right sign that work is ready?</>, see: ["03 · ai-suggest"] },
];

const SCOPE: { f: string; see: string }[] = [
  { f: "Links between artboards (On click → Go to Pricing), presenter view, presentation links, per-artboard notes", see: "04" },
  { f: "Follow · Bring everyone here · mention e-mails from cloud.maude.sh", see: "10" },
  { f: "Word-by-word captions, beat detection + Cut to the beat, music ducking, poster frame, per-format reframing, Sound-only export, 4K preset, .srt", see: "07" },
  { f: "Linked video formats — one cut, per-format framing; Edit separately unlinks", see: "07" },
  { f: "JPG, folder batch export, file-name tokens, cloud vs this-Mac render, colour profile, font-licence check, “Export the version from 14:05”", see: "09" },
  { f: "300 dpi default for print PDF (today 96)", see: "08" },
  { f: "Search inside pictures — opt-in AI descriptions per project", see: "12" },
  { f: "Brand import from a website (today only from an SVG logo)", see: "12" },
  { f: "Prompt queue offline, drag-and-drop attachments, Open in terminal hand-off, chats grouped per canvas", see: "03" },
];

const SMALL: { t: string; see: string }[] = [
  { t: "“Fixed size” as the word for the digital kind; picker groups App · Web page · Social · Print · Video", see: "08" },
  { t: "Print guides: View › Advanced only, or also a switch in the print inspector?", see: "08" },
  { t: "Split key S (⌘B still works); tap Space plays a selected video, hold Space = Hand", see: "07" },
  { t: "⇧⌘C Copy as PNG — a new key", see: "09" },
  { t: "Account lives in Settings › General — no Account tab", see: "02" },
  { t: "The status word for “sync stuck but safe” (drawn as Syncing…)", see: "06" },
  { t: "First project named from the first sentence; “Untitled project” for a blank start", see: "02" },
  { t: "Viewers may export (the server allows it today); Handoff needs Can edit", see: "09" },
  { t: "Trash keeps things until you clear them out — no auto-retention", see: "05" },
  { t: "Assets as the left panel's third tab", see: "12" },
  { t: "Photo edits apply to one use; “Apply to every use” is explicit", see: "12" },
];

/* ═══ Data — the kit ════════════════════════════════════════════════════════════════════════ */

const KIT_GROUPS: { title: string; items: string[] }[] = [
  { title: "Layout and scope", items: ["V2", "Stage", "Window", "TABS", "Canvas", "Veil"] },
  { title: "Glyphs and people", items: ["Icon", "Mark", "Spark", "Avatar", "Kbd", "Thumb", "KindGlyph", "StatusWord"] },
  { title: "Panels", items: ["ProjectPill", "ProjectMenu", "CanvasesPanel", "Toolbar · edit + annotate", "ToolbarMorph", "AnnotateIcon", "ShareCluster", "ModeSwitch", "ZoomUndo", "AIPanel", "Inspector + In*", "PanelIcon"] },
  { title: "On the canvas", items: ["Artboard", "Selection", "Sticky", "Cursor", "CommentPin", "HeroMock", "PricingMock", "PosterMock", "PhoneMock", "VideoFrameMock", "GatorMock"] },
  { title: "Overlays", items: ["Toast", "Dialog · Sheet", "Menu", "SearchPalette", "Tooltip", "Home"] },
  { title: "Explainers", items: ["Note", "Callout"] },
];

const VIDEO_EXPORTS: [string, string][] = [
  ["Timeline", "the timeline island — compact (slides out of the artboard) or full width, Advanced at its foot"],
  ["VideoInspector", "the one video-artboard row set: Size · Length · Poster frame · Sound · Export"],
  ["Still · ClipPic · PHOTO", "the real Alligators footage stills, titles, captions and safe zones"],
  ["HYPE · SOURCE_CLIPS", "Hype trailer · Reels and the recap's 12 source clips"],
  ["VIcon · Poster · Slider · under() · mss()", "video glyphs, inspector values, timeline geometry, m:ss"],
];

const PREFIXES: [string, string, string][] = [
  ["00", "ix", "Index"], ["01", "cf", "Create Flow"], ["02", "ob", "Onboarding"], ["03", "ai", "AI Chat"],
  ["04", "md", "Modes"], ["05", "es", "Empty States"], ["06", "ad", "Advanced"], ["07", "ve", "Video Editing"],
  ["08", "ak", "Artboard Kinds"], ["09", "ex", "Export"], ["10", "co", "Share and Collaboration"],
  ["11", "pn", "Projects and Navigation"], ["12", "ia", "Import and Assets"], ["13", "ds", "Design System"],
];

/* ═══ Local pieces (ix-) ═══════════════════════════════════════════════════════════════════ */

function Head({ eyebrow, title, children, aside }: { eyebrow: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="ix-hd">
      <div className="ix-hd-main">
        <p className="ix-eyebrow"><Mark size={18} />{eyebrow}</p>
        <h1 className="ix-h1">{title}</h1>
        {children ? <p className="ix-lede">{children}</p> : null}
      </div>
      {aside ? <div className="ix-hd-aside">{aside}</div> : null}
    </header>
  );
}

/** "03 · ai-queue-rule" → a quiet reference: canvas number in a tile, then the artboard id. */
function See({ to }: { to: string }) {
  const [n, id] = to.split(" · ");
  if (!id) return <span className="ix-see"><span className="ix-see-id">{to}</span></span>;
  return <span className="ix-see"><span className="ix-see-n">{n}</span><span className="ix-see-id">{id}</span></span>;
}

function Proposed({ src }: { src: Rule["src"] }) {
  if (src === "§7" || src === "Q") return <span className="ix-tag ix-tag--prop"><i />Proposed — Michal to confirm</span>;
  return <span className="ix-tag ix-tag--set"><i />Settled · CONTRACT {src}</span>;
}

function CanvasChip({ n }: { n: string }) {
  const c = BY_N[n];
  return <span className="ix-cchip"><span className="ix-cchip-n">{n}</span>{c.title}</span>;
}

function Card({ c }: { c: CanvasCard }) {
  return (
    <article className="ix-card">
      <div className="ix-pic" aria-hidden="true">
        <span className="ix-pic-row">
          {c.pics.map((p, i) => <Thumb key={i} art={p.art} w={p.w} h={p.h} className="ix-pic-thumb" />)}
        </span>
        <span className="ix-pic-badge">{c.badge}</span>
      </div>
      <div className="ix-card-body">
        <div className="ix-card-main">
          <p className="ix-card-t"><span className="ix-card-n">{c.n}</span>{c.title}</p>
          <p className="ix-card-q">{c.q}</p>
          <p className="ix-card-meta"><span className="chip">{c.boards} artboards</span><span className="chip">{c.sections} sections</span></p>
        </div>
        <div className="ix-card-look">
          <p className="ix-card-lh">Start with</p>
          <ul className="ix-look">
            {c.look.map(([label, id]) => (
              <li key={id}><span className="ix-look-l">{label}</span><span className="ix-look-id">{id}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <p className="ix-card-file"><Icon name="file" size={13} />ui/v2/{c.file}.tsx</p>
    </article>
  );
}

/* ═══ Artboards ════════════════════════════════════════════════════════════════════════════ */

function MapBoard() {
  return (
    <V2 className="ix-page" style={{ minHeight: H.map }}>
      <Head
        eyebrow="maude-v2 · canvases in practice · 6 Oct 2026"
        title="Maude v2 — in practice"
        aside={
          <dl className="ix-stats">
            <div><dt>Canvases</dt><dd>{CANVASES.length}</dd></div>
            <div><dt>Artboards</dt><dd>{TOTAL_BOARDS}</dd></div>
            <div><dt>Projects</dt><dd>2</dd></div>
            <div><dt>People</dt><dd className="ix-stats-faces"><Avatar who="you" size="md" /><Avatar who="tereza" size="md" /><Avatar who="jonas" size="md" /><span className="ix-stats-ai"><Spark size={12} /></span></dd></div>
          </dl>
        }
      >
        The maude-v2 design system, drawn in practice: thirteen canvases that answer one request and its
        follow-up, each told happy path first, then its edge cases — on Studio site (four canvases) and Alligators brand
        (93 canvases, 247 assets, three people and their AI).
      </Head>

      <section className="ix-req">
        <div className="ix-req-hd">
          <p className="ix-h2">The request, and where it's answered</p>
          <p className="ix-req-who">Michal, 6 and 8 Oct 2026 — verbatim</p>
        </div>
        <p className="ix-req-intro"><q>{REQUEST_INTRO}</q></p>
        <ul className="ix-req-list">
          <li className="ix-req-row">
            <span className="ix-req-check"><Icon name="check" size={12} /></span>
            <span className="ix-req-q"><q>Udelej novou slozku v canvases</q></span>
            <span className="ix-req-to"><span className="ix-cchip ix-cchip--path"><Icon name="folder" size={12} />.design/ui/v2/ — 00 to 13</span></span>
          </li>
          {REQUEST.map((r) => (
            <li className="ix-req-row" key={r.q}>
              <span className="ix-req-check"><Icon name="check" size={12} /></span>
              <span className="ix-req-q"><q>{r.q}</q></span>
              <span className="ix-req-to">{r.to.map((n) => <CanvasChip key={n} n={n} />)}</span>
            </li>
          ))}
          <li className="ix-req-row ix-req-row--all">
            <span className="ix-req-check"><Icon name="check" size={12} /></span>
            <span className="ix-req-q"><q>{REQUEST_OUTRO}</q></span>
            <span className="ix-req-to"><span className="ix-cchip ix-cchip--path">Every canvas — edge cases close each section; Alligators brand in all thirteen</span></span>
          </li>
          <li className="ix-req-row ix-req-row--new">
            <span className="ix-req-check"><Icon name="check" size={12} /></span>
            <span className="ix-req-q"><span className="ix-req-when">8 Oct</span><q>{REQUEST_DS}</q></span>
            <span className="ix-req-to"><CanvasChip n="13" /><span className="ix-cchip"><span className="ix-cchip-n">11</span>pn-ds — where the board sits</span></span>
          </li>
        </ul>
      </section>

      {GROUPS.map((g) => (
        <section className="ix-band" key={g.title}>
          <div className="ix-band-hd">
            <p className="ix-band-range">{g.range}</p>
            <p className="ix-h2">{g.title}</p>
            <p className="ix-band-line">{g.line}</p>
          </div>
          <div className={`ix-grid ix-grid--${g.span}`}>
            {g.ns.map((n) => <Card key={n} c={BY_N[n]} />)}
          </div>
        </section>
      ))}

      <p className="ix-foot">
        <Icon name="help" size={14} />
        Read in this order: the rules (next board) hold across all thirteen; the open questions after that are the
        decisions only Michal can make — each points at the artboard that draws it.
      </p>
    </V2>
  );
}

function RulesBoard() {
  const total = RULES.reduce((s, g) => s + g.rules.length, 0);
  const proposed = RULES.reduce((s, g) => s + g.rules.filter((r) => r.src === "§7" || r.src === "Q").length, 0);
  return (
    <V2 className="ix-page" style={{ minHeight: H.rules }}>
      <Head
        eyebrow="Rules every canvas follows"
        title="One behaviour, drawn the same way thirteen times"
        aside={
          <div className="ix-legend">
            <Proposed src="§7" />
            <span className="ix-tag ix-tag--set"><i />Settled · in CONTRACT</span>
            <p className="ix-legend-p">{total} rules · {proposed} proposed · {total - proposed} settled</p>
          </div>
        }
      >
        From CONTRACT §6–§7, with the two toolbars of §2, the words and voice of §3–§4 and two mode details from the open questions. Settled details are copied as they are;
        the cross-canvas rules of §7 are proposals the whole set already follows — confirming one changes nothing,
        rejecting one changes the canvases listed under it.
      </Head>
      <div className="ix-rules">
        {RULES.map((g) => (
          <section className="ix-rgroup" key={g.title}>
            <p className="ix-rgroup-h"><span className="ix-rgroup-ic">{g.icon}</span>{g.title}<span className="ix-rgroup-c">{g.rules.length}</span></p>
            <ul className="ix-rlist">
              {g.rules.map((r) => (
                <li className="ix-rule" key={r.t}>
                  <p className="ix-rule-t">{r.t}</p>
                  <p className="ix-rule-d">{r.d}</p>
                  <p className="ix-rule-foot"><Proposed src={r.src} />{r.see.map((s) => <See key={s} to={s} />)}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </V2>
  );
}

function QuestionsBoard() {
  return (
    <V2 className="ix-page" style={{ minHeight: H.questions }}>
      <Head
        eyebrow="Open questions for Michal"
        title="Eight decisions shape the product, six more came with 13"
        aside={<p className="ix-legend-p ix-legend-p--wide">Every answer is already drawn as a sensible default marked <b>Proposed</b>. Answering one changes a canvas, not the whole set.</p>}
      />

      <section className="ix-big">
        <p className="ix-h2">Product model — the biggest eight</p>
        <ol className="ix-big-grid">
          {BIG.map((b, i) => (
            <li className="ix-bigq" key={b.t}>
              <span className="ix-bigq-n">{i + 1}</span>
              <p className="ix-bigq-t">{b.t}</p>
              <p className="ix-bigq-d">{b.d}</p>
              {b.pick ? <p className="ix-bigq-pick"><Icon name="check" size={12} />{b.pick}</p> : null}
              <p className="ix-bigq-see">{b.see.map((s) => <See key={s} to={s} />)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ix-big">
        <p className="ix-h2">New this round — 13 Design System, and two AI details from 03</p>
        <ol className="ix-big-grid ix-big-grid--3">
          {NEW_Q.map((b, i) => (
            <li className="ix-bigq ix-bigq--new" key={b.t}>
              <span className="ix-bigq-n">{BIG.length + i + 1}</span>
              <p className="ix-bigq-t">{b.t}</p>
              <p className="ix-bigq-d">{b.d}</p>
              <p className="ix-bigq-see">{b.see.map((s) => <See key={s} to={s} />)}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="ix-qcols">
        <section className="ix-qcol">
          <p className="ix-h2">Drawn as if it exists — keep in scope for v2.0?</p>
          <p className="ix-qcol-sub">None of these ship today. Tick what stays in v2.0; the rest becomes “later” on its canvas.</p>
          <ul className="ix-scope">
            {SCOPE.map((s) => (
              <li className="ix-scope-row" key={s.f}>
                <span className="ix-box" aria-hidden="true" />
                <span className="ix-scope-f">{s.f}</span>
                <CanvasChip n={s.see} />
              </li>
            ))}
          </ul>
        </section>
        <section className="ix-qcol">
          <p className="ix-h2">Words, keys, placement</p>
          <p className="ix-qcol-sub">Smaller calls, each drawn one way on the canvas named beside it.</p>
          <ul className="ix-small">
            {SMALL.map((s) => (
              <li className="ix-small-row" key={s.t}>
                <span className="ix-small-t">{s.t}</span>
                <CanvasChip n={s.see} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </V2>
  );
}

function KitBoard() {
  const kinds: Kind[] = ["web", "digital", "print", "video"];
  const kindWord: Record<Kind, string> = { web: "Web page", digital: "Fixed size", print: "Print", video: "Video" };
  return (
    <V2 className="ix-page" style={{ minHeight: H.kit }}>
      <Head eyebrow="What's shared" title="One kit, one video file, a handful of conventions">
        Every canvas imports the same chrome from <b>_kit.tsx</b> and never edits it; the video canvases share
        <b> _video.tsx</b>. Underscore files stay hidden from the canvas tree.
      </Head>

      <section className="ix-kit">
        <div className="ix-kit-hd">
          <p className="ix-h2"><Icon name="layers" size={16} />_kit.tsx — the maude-v2 app chrome</p>
          <p className="ix-kit-sub">Lifted from the desktop showcase, the iconography and the logo specimens. Static mocks: no real buttons, so a screen adds no tab stops.</p>
        </div>
        <div className="ix-kit-body">
          <div className="ix-kit-list">
            {KIT_GROUPS.map((g) => (
              <div className="ix-kgroup" key={g.title}>
                <p className="ix-kgroup-h">{g.title}<span>{g.items.length}</span></p>
                <p className="ix-kgroup-items">{g.items.map((it) => <span className="chip" key={it}>{it}</span>)}</p>
              </div>
            ))}
          </div>
          <div className="ix-spec">
            <div className="ix-spec-block">
              <p className="ix-spec-h">Glyphs <span>{GLYPH_NAMES.length} — the DS family plus kit additions</span></p>
              <div className="ix-glyphs">{GLYPH_NAMES.map((g) => <span key={g} title={g}><Icon name={g} size={16} /></span>)}</div>
            </div>
            <div className="ix-spec-block">
              <p className="ix-spec-h">Thumbnails <span>{ART_NAMES.length} pictures of work, pinned light</span></p>
              <div className="ix-thumbs">{ART_NAMES.map((a) => <Thumb key={a} art={a} w={56} h={40} />)}</div>
            </div>
            <div className="ix-spec-row">
              <div className="ix-spec-block">
                <p className="ix-spec-h">Kinds</p>
                <div className="ix-kinds">{kinds.map((k) => <span key={k}><KindGlyph kind={k} size={14} />{kindWord[k]}</span>)}</div>
              </div>
              <div className="ix-spec-block">
                <p className="ix-spec-h">Status in words</p>
                <div className="ix-sws">
                  <StatusWord state="ok">Saved</StatusWord>
                  <StatusWord state="busy">Syncing…</StatusWord>
                  <StatusWord state="off">Offline — kept on this Mac</StatusWord>
                  <StatusWord state="warn">Needs you</StatusWord>
                </div>
              </div>
              <div className="ix-spec-block">
                <p className="ix-spec-h">Keys</p>
                <div className="ix-keys"><Kbd>⌘K</Kbd><Kbd>⌘\</Kbd><Kbd>⌘/</Kbd><Kbd>⇧⌘E</Kbd><Kbd>⇧⌘T</Kbd><Kbd>⌥⌘H</Kbd></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="ix-kit-cols">
        <section className="ix-kit ix-kit--video">
          <p className="ix-h2"><Icon name="video" size={16} />_video.tsx — the video artboard's pieces</p>
          <p className="ix-kit-sub">07 Video Editing is the source of truth; 05, 08 and 09 import it so the timeline is never drawn two ways. Styles in _video.css, prefix ve-.</p>
          <ul className="ix-vlist">
            {VIDEO_EXPORTS.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}
          </ul>
        </section>

        <section className="ix-kit">
          <p className="ix-h2"><Icon name="frame" size={16} />Conventions</p>
          <div className="ix-conv">
            <div className="ix-conv-item">
              <div className="ix-stage-fig" aria-hidden="true">
                <span className="ix-stage-win"><i /><i /><i /><b>1440 × 900 window</b></span>
                <span className="ix-stage-note"><b>note strip · 80</b></span>
              </div>
              <p className="ix-conv-p"><b>An app artboard is 1440 × 980</b> — the window plus a note strip saying what you see and why. Close-ups are sized to content.</p>
            </div>
            <div className="ix-conv-item">
              <div className="ix-fixed-fig"><Thumb art="gator-poster" w={52} h={72} /><Thumb art="home" w={84} h={58} /></div>
              <p className="ix-conv-p"><b>The work stays light.</b> Artwork inside a mock wears <code className="k-mono">.k-fixed</code> — the user's design never re-colours with the app theme.</p>
            </div>
            <div className="ix-conv-item">
              <div className="ix-shapes">
                <span className="k-proj"><Avatar ini="S" tone="yellow" size="lg" /></span>
                <span className="k-proj"><Avatar ini="A" tone="lilac" size="lg" /></span>
                <span className="ix-shapes-sep" />
                <Avatar who="you" size="lg" /><Avatar who="tereza" size="lg" /><Avatar who="jonas" size="lg" />
              </div>
              <p className="ix-conv-p"><b>A project is a rounded square, a person is a circle.</b> Tabs carry the project's initial (S, A), never the person's.</p>
            </div>
          </div>
          <div className="ix-prefix">
            <p className="ix-spec-h">Artboard id prefixes</p>
            <div className="ix-prefix-grid">
              {PREFIXES.map(([n, p, t]) => <span key={p}><span className="ix-see-n">{n}</span><b>{p}-</b>{t}</span>)}
            </div>
          </div>
          <p className="ix-conv-more">Tokens only, no hex · weights stop at 600 · mono only inside Advanced · happy path first, then edge cases · real content, never Lorem · a <code className="k-mono">.meta.json</code> carries no layout or viewport.</p>
        </section>
      </div>

      <section className="ix-kit ix-issues">
        <p className="ix-h2"><Icon name="problem" size={16} />Known issues</p>
        <ul className="ix-issue-list">
          <li className="ix-issue">
            <p className="ix-issue-t">A fixed artboard loses ~24 px to its label</p>
            <p className="ix-issue-d">canvas-lib counts the label strip inside a <code className="k-mono">fixed</code> artboard's height, so its foot clips. This index uses hug height; 08's real artboards drop <code className="k-mono">fixed</code>.</p>
            <span className="ix-task"><Icon name="arrow" size={12} />Spun off as a task</span>
          </li>
          <li className="ix-issue">
            <p className="ix-issue-t">Export bugs found while drawing 09</p>
            <p className="ix-issue-d">The command ignores print-PDF options; a ZIP export without a scope is rejected; ⇧⌘E means two things today.</p>
            <span className="ix-task"><Icon name="arrow" size={12} />Spun off as a task</span>
          </li>
          <li className="ix-issue">
            <p className="ix-issue-t">Errors and Recovery wasn't drawn on its own</p>
            <p className="ix-issue-d">Its cases live where they happen. Crash recovery and a full disk aren't drawn yet.</p>
            <p className="ix-issue-see"><See to="01 · cf-render-error" /><See to="01 · cf-offline-create" /><See to="03 · ai-choice-fail" /><See to="06 · ad-edge-sync" /><See to="06 · ad-edge-syntax" /><See to="10 · co-conflict" /></p>
          </li>
          <li className="ix-issue">
            <p className="ix-issue-t">Kit candidates waiting to move up</p>
            <p className="ix-issue-d">The kit's extra glyphs (kinds, offline, lock, trash…) belong in the DS iconography; <b>_video.tsx</b> can fold into the kit.</p>
          </li>
        </ul>
      </section>
    </V2>
  );
}

/* ═══ Canvas ═══════════════════════════════════════════════════════════════════════════════ */

export default function Index() {
  return (
    <DesignCanvas>
      <DCSection id="overview" title="Maude v2 — in practice" subtitle="The whole set on four boards: the map, the rules, the open questions, what's shared">
        <DCArtboard id="ix-map" label="1 · The map — request, thirteen canvases" width={W} height={H.map}>
          <MapBoard />
        </DCArtboard>
        <DCArtboard id="ix-rules" label="2 · The rules every canvas follows" width={W} height={H.rules}>
          <RulesBoard />
        </DCArtboard>
        <DCArtboard id="ix-questions" label="3 · Open questions for Michal" width={W} height={H.questions}>
          <QuestionsBoard />
        </DCArtboard>
        <DCArtboard id="ix-kit" label="4 · What's shared — kit, video, conventions" width={W} height={H.kit}>
          <KitBoard />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
