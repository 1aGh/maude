// client/v2/export/export-copy.js — S8.2: every word the Export sheet says (CONTRACT §3–§4).
//
// Plain data and pure functions, so a test reads the copy without mounting anything and a later
// section (S8.3 batch, S8.6 video, S8.7 print) appends its own block here instead of editing a
// component. The estimate sentence is built HERE from the server's numbers (contract §5.5: the
// server sends numbers only); `estimateWords` mirrors cli/lib/export-spec.mjs `estimateWords` and a
// test holds the two equal.

/** The four scopes, in the order the Scope bar draws them (09 Export `ScopeBar`). */
export const SCOPES = [
  ['selection', 'Selection'],
  ['canvas', 'This canvas'],
  ['folder', 'Folder'],
  ['project', 'Whole project'],
];
export const SCOPE_IDS = SCOPES.map(([id]) => id);
export const SCOPE_LABEL = Object.fromEntries(SCOPES);

/** A count that cannot be exported reads "—" (an empty scope is never "0"). */
export const EMPTY_COUNT = '—';

export const countWord = (n) =>
  typeof n === 'number' && n > 0 ? n.toLocaleString('en-GB').replace(/,/g, ' ') : EMPTY_COUNT;

export const artboardsWord = (n) => `${n} ${n === 1 ? 'artboard' : 'artboards'}`;

/** Why a scope is off, as the tooltip on its disabled segment. */
export const SCOPE_OFF = {
  selection: 'Nothing is selected.',
  canvas: 'There is no canvas open.',
  folder: 'This canvas is not in a folder.',
  project: 'Nothing in this project can be exported.',
  'canvas-only': 'Only the canvases shared with you can be exported.',
};

// ── title, sub line and the one button (CONTRACT §4: the title asks with the button's verb) ──────
export const VERB = 'Export';
export const HANDOFF_VERB = 'Copy';

const quoted = (s) => `“${s}”`;

const canvasesWord = (n) => `${n} ${n === 1 ? 'canvas' : 'canvases'}`;

/**
 * The folder as a person reads it. The design root's own `ui/` folder is where canvases live, not a name:
 * "2026/combine", never "ui/2026/combine"; the root itself has no name of its own ('' — the project is the name).
 */
export function folderLabel(folder) {
  const f = String(folder ?? '').replace(/^\/+|\/+$/g, '');
  if (f === 'ui') return '';
  return f.replace(/^ui\//, '');
}

/**
 * `{ scope, label, canvas, folder, count, canvases, project }` → "Export “Combine-kampan” — 21 artboards".
 * A folder counts CANVASES ("Export “social” — 31 canvases", 09 ex-batch) and is named by its own last segment;
 * the whole project is "Export everything in Alligators brand" (09 ex-huge). `canvases` = the estimate's
 * `canvasCounts` ({ folder, project }); `project` = the project's name.
 */
export function sheetTitle({
  scope,
  label,
  canvas,
  folder,
  count,
  canvases,
  project,
  withBack = false,
}) {
  const n = typeof count === 'number' && count > 0 ? count : null;
  if (scope === 'selection') {
    // 09 ex-print: a print PDF that carries the back says so in the title — `Export "A · přední (FLAG)" + its back`
    if (n === 1 || n === null)
      return label
        ? `${VERB} ${quoted(label)}${withBack ? ' + its back' : ''}`
        : `${VERB} 1 artboard`;
    return `${VERB} ${artboardsWord(n)}`;
  }
  if (scope === 'canvas')
    return n ? `${VERB} ${quoted(canvas)} — ${artboardsWord(n)}` : `${VERB} ${quoted(canvas)}`;
  if (scope === 'folder') {
    const shown = folderLabel(folder);
    const name = shown ? shown.slice(shown.lastIndexOf('/') + 1) : project || 'this folder';
    const c = canvases?.folder;
    if (typeof c === 'number' && c > 0) return `${VERB} ${quoted(name)} — ${canvasesWord(c)}`;
    return n ? `${VERB} ${quoted(name)} — ${artboardsWord(n)}` : `${VERB} ${quoted(name)}`;
  }
  if (project) return `${VERB} everything in ${project}`;
  return n ? `${VERB} the whole project — ${artboardsWord(n)}` : `${VERB} the whole project`;
}

/** The primary button: the same verb; a count when the sheet makes several files. */
export function primaryLabel({ count, busy }) {
  if (busy) return 'Exporting…';
  return typeof count === 'number' && count > 1 ? `${VERB} ${artboardsWord(count)}` : VERB;
}

/**
 * The line under the title (09: "LetakA6 · print", "Homepage · Studio site", "2026/combine · nothing was selected",
 * "93 canvases in 5 folders, plus 4 at the top level"). `where` = what the canvas sits in — its folder, else the
 * project's name; `kind` = the one kind a print / video sheet names. `canvases` = the estimate's `canvasCounts`.
 */
export function sheetSub({ scope, canvas, folder, nothingSelected, where, kind, canvases }) {
  if (scope === 'project' && canvases?.project > 0) {
    const f = canvases.folders;
    const loose = canvases.loose;
    return [
      `${canvasesWord(canvases.project - loose)} in ${f} ${f === 1 ? 'folder' : 'folders'}`,
      loose > 0 ? `plus ${loose} at the top level` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
  const parts = [];
  if (folder) parts.push(folderLabel(folder) || folder);
  else if (canvas && scope !== 'canvas') parts.push(canvas);
  if (scope === 'canvas' && where) parts.push(where);
  else if (scope === 'selection' && (where || kind)) parts.push(kind || where);
  if (nothingSelected) parts.push('nothing was selected');
  return parts.join(' · ');
}

// ── the estimate sentence (§5.5 rounding) ─────────────────────────────────────────────────────────
function bytesWords(bytes) {
  if (bytes < 1000) return `${Math.round(bytes)} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = -1;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u += 1;
  }
  return `${Number(v.toPrecision(2))} ${units[u]}`;
}

function secondsWords(seconds) {
  if (seconds < 2) return 'a second';
  if (seconds < 10) return 'a few seconds';
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `about ${Math.round(seconds / 60)} min`;
}

/** "21 files · about 140 MB · about 20 seconds on this Mac". */
export function estimateWords({ files, bytes, seconds, lane }, { pdfPages = null } = {}) {
  const where = lane === 'cloud' ? 'in the cloud' : 'on this Mac';
  return [
    // 09 ex-print: one print PDF says its pages — "1 PDF · 2 pages", not "1 file"
    pdfPages && files === 1
      ? `1 PDF · ${pdfPages} ${pdfPages === 1 ? 'page' : 'pages'}`
      : `${files} ${files === 1 ? 'file' : 'files'}`,
    `about ${bytesWords(bytes)}`,
    `${secondsWords(seconds)} ${where}`,
  ].join(' · ');
}

/** The summary line under the rows; null until the server has answered with something to say. */
export const summaryWords = (est, opts) =>
  est && typeof est.files === 'number' && est.files > 0 ? estimateWords(est, opts) : null;

// ── image section (09 ex-social) ──────────────────────────────────────────────────────────────────
export const IMAGE_FORMATS = [
  ['png', 'PNG'],
  ['jpg', 'JPG'],
];
export const IMAGE_SIZES = [
  [1, '1×'],
  [2, '2×'],
];
export const SOCIAL_SIZE_NOTE = 'Instagram resizes anything larger.';

// ── web section (09 ex-web) ───────────────────────────────────────────────────────────────────────
export const WEB_FORMATS = [
  ['image', 'Image'],
  ['pdf', 'PDF'],
];
/** Size choices for a web page as (label, format, scale). */
export const WEB_SIZES = [
  ['PNG 1×', 'png', 1],
  ['PNG 2×', 'png', 2],
  ['JPG 2×', 'jpg', 2],
];
export const WEB_AREA_NOTE = 'Image takes the full page, not just the visible area.';
export const WEB_SIZE_NOTE = '2× stays sharp on Retina screens.';
export const WEB_CODE_LINE = 'Code for a developer?';
export const WEB_CODE_ACTION = 'Handoff to production…';

export const ANNOTATIONS_LABEL = 'Include annotations';
export const ANNOTATIONS_SUB = 'Stickies, arrows and stickers stay out unless you include them';
export const PRINT_NEVER_NOTE = 'Print files never carry them — pick PDF for a review copy.';

// ── Other… (09 ex-formats): every format, the ones that do not fit say why ────────────────────────
export const OTHER_LABEL = 'Other…';
export const OTHER_SEARCH = 'Search formats';
export const OTHER_NONE = 'No format called that.';

/**
 * The list under Other…. `format` is the ExportSpec v2 format the row picks; `testid` re-emits the v1
 * `export-format-<id>` hooks (png pdf svg html pptx mp4 gif canva zip shadcn) and adds jpg, webm, audio.
 * `needs` is the condition the row waits for (resolved by `otherFormats`); `reason` is the line shown
 * when it is not met.
 */
export const OTHER_GROUPS = [
  {
    group: 'Image',
    items: [
      { id: 'png', format: 'png', label: 'PNG', note: 'Transparent where empty' },
      { id: 'jpg', format: 'jpg', label: 'JPG', note: 'Smaller, no transparency' },
      { id: 'svg', format: 'svg', label: 'SVG', note: 'Shapes and text stay sharp' },
    ],
  },
  {
    group: 'Document',
    items: [
      { id: 'pdf', format: 'pdf', label: 'PDF', note: 'One page per artboard' },
      {
        id: 'print-pdf',
        format: 'pdf',
        label: 'Print PDF',
        note: 'Needs a print artboard',
        needs: 'print',
      },
      { id: 'pptx', format: 'pptx', label: 'PowerPoint', note: 'Whole canvas, a slide each' },
    ],
  },
  {
    group: 'Video',
    items: [
      { id: 'mp4', format: 'mp4', label: 'MP4', note: 'Needs a video artboard', needs: 'video' },
      { id: 'gif', format: 'gif', label: 'GIF', note: 'Needs a video artboard', needs: 'video' },
      { id: 'webm', format: 'webm', label: 'WebM', note: 'Needs a video artboard', needs: 'video' },
      {
        id: 'audio',
        format: 'audio',
        label: 'Sound only',
        note: 'Needs a video artboard',
        needs: 'video',
      },
    ],
  },
  {
    group: 'For other tools',
    items: [
      { id: 'canva', format: 'canva', label: 'Canva', note: 'A deck Canva opens' },
      { id: 'html', format: 'html', label: 'Web page (HTML)', note: 'Opens in any browser' },
      {
        id: 'shadcn',
        format: null,
        label: 'Code…',
        keys: '⇧⌘H',
        note: 'Handoff to production',
        handoff: true,
      },
    ],
  },
  {
    group: 'Whole project',
    items: [
      { id: 'zip', format: 'zip', label: 'Project ZIP', note: 'Canvases, assets, design system' },
    ],
  },
];

export const NEEDS_RENDER_SERVICE = 'Needs the render service — not configured on this workspace';
export const NEEDS_DESKTOP = 'Needs the desktop app';

/**
 * The rows under Other…, with `disabled` and the `reason` that explains it. Pure.
 * ctx: { kinds: Set<string>, exportLane, laneBlocked(format), canHandoff }
 */
export function otherFormats(ctx) {
  const kinds = ctx.kinds ?? new Set();
  return OTHER_GROUPS.map(({ group, items }) => ({
    group,
    items: items.map((it) => {
      let reason = null;
      if (it.needs === 'print' && !kinds.has('print')) reason = it.note;
      else if (it.needs === 'video' && !kinds.has('video')) reason = it.note;
      else if (it.handoff && ctx.canHandoff === false) reason = 'Needs Can edit';
      else if (it.format && ctx.laneBlocked?.(it.format))
        reason = it.format === 'canva' ? NEEDS_DESKTOP : NEEDS_RENDER_SERVICE;
      return { ...it, disabled: reason !== null, reason, note: reason ?? it.note };
    }),
  }));
}

/** Search finds every row: the label, the note, the group and the format id all match. */
export function matchOther(groups, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return groups;
  return groups
    .map(({ group, items }) => ({
      group,
      items: items.filter((it) =>
        [it.label, it.note, it.reason ?? '', group, it.id, it.format ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      ),
    }))
    .filter((g) => g.items.length > 0);
}

// ── Share vs Export (09 ex-share-vs): one quiet line, once ───────────────────────────────────────
export function peopleWords(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}
export function shareHint(names) {
  const who = peopleWords(names);
  const are = names.filter(Boolean).length > 1 ? 'are' : 'is';
  return `${who} ${are} in this project. A link shows them the latest, with comments.`;
}
export const SHARE_HINT_ACTION = 'Copy link';

// ── Recent (kept until S8.4 moves Export again onto the Exports panel) ───────────────────────────
export const RECENT_LABEL = 'Recent';
export const AGAIN_LABEL = 'Export again';

// ── lane notes and errors ─────────────────────────────────────────────────────────────────────────
export const LANE_NONE_NOTE =
  'PNG and SVG of the active artboard — and the PowerPoint deck — export right here in your browser; ZIP and handoff work too. PDF, video and other multi-artboard exports need the render service, which this workspace doesn’t have configured — use the desktop app, or ask your admin to add maude-render.';
export const REFUSED_NO_RENDER =
  'This format needs the render service, which this workspace doesn’t have configured.';
export const REFUSED_BROWSER_ONLY =
  'Without the render service this workspace exports PNG and SVG of one artboard only — pick Selection, or ask your admin to add maude-render.';

// ── handoff (S8.10 replaces this view) ───────────────────────────────────────────────────────────
export const HANDOFF_TITLE = 'Copy the handoff command';
export const HANDOFF_BODY =
  'Hands this canvas off to production. Run the command in Claude Code to get a component next to the canvas.';
export const HANDOFF_BUTTON = 'Copy command';
