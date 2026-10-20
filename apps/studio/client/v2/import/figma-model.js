// client/v2/import/figma-model.js — S8.17: the Import from Figma sheet's words and its pure rules
// (canvas 12 · ia-figma-sheets, ia-figma-arrived, ia-figjam; CONTRACT §3 Figma [C23, C24], §4 Figma import).
//
// The words never say text stays editable on import (CONTRACT §4): a frame arrives as Figma's exact picture,
// and "Make editable" converts ONE artboard later — it needs Figma Dev Mode on a paid seat.
//
// Everything the server answers is counts, sizes, node ids and code-owned reason codes (DDR-216 D7/D10), so a
// summary row is built from numbers here — never from a word the Figma file said.

/** Which door a link opens: a design file's frames, a FigJam file, or neither. Shape only — the server judges. */
export function figmaLinkKind(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'none';
  let u;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return 'bad';
  }
  if (u.protocol !== 'https:') return 'bad';
  if (!/^(www\.)?figma\.com$/i.test(u.hostname)) return 'bad';
  const first = u.pathname.split('/').filter(Boolean)[0];
  if (first === 'board') return 'figjam';
  if (first === 'design' || first === 'file' || first === 'proto') return 'design';
  return 'bad';
}

/** The link as the server wants it (the person may paste without `https://`). */
export function normalizeLink(raw) {
  const s = String(raw ?? '').trim();
  return /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
}

export const FIGMA_WORDS = Object.freeze({
  title: 'Import from Figma',
  linkLabel: 'Figma link',
  notConnected: "Figma isn't connected yet.",
  notConnectedRest: 'Connect once to read this file.',
  connect: 'Connect…',
  boardWorks: 'A board from FigJam works too — it comes in as annotations.',
  connectTitle: 'Connect Figma',
  connectSteps: [
    ['In Figma, open ', 'Settings › Security', '.'],
    ['Create a personal access token with ', 'File content: read', '.'],
    ['Paste it here.', '', ''],
  ],
  tokenLabel: 'Access token',
  tokenFine:
    "Kept in this Mac's keychain. Used only to read files you import; Settings › Connections removes it.",
  putIn: 'Put them in',
  newCanvas: 'New canvas',
  optComments: 'Comments, as stickies',
  optStyles: "Colours and text styles, into the project's style",
  pictures:
    "Each frame arrives as Figma's exact picture. Make editable turns one artboard into layers later — it needs Figma Dev Mode on a paid seat.",
  reading: 'Reading the file…',
  importing: 'Importing…',
  cancel: 'Cancel',
  import: 'Import',
  boardTitle: 'Import from FigJam',
  boardFine:
    'It comes in as annotations on this canvas: stickies, sections and connectors stay themselves. A widget that can’t come across is named.',
  boardNeedsCanvas: 'Open the canvas it should go on, then import it.',
  // the inspector (ia-figma-arrived)
  exactTitle: "Figma's exact picture.",
  exactRest: " Its text and shapes can't be changed until it's made editable.",
  makeEditable: 'Make editable',
  makeEditableFine:
    'Turns this one artboard into layers. Needs the Figma desktop app open on this file, in Dev Mode — a paid Dev or Full seat.',
});

/** "Import 6 frames" — the title verb with the count (one verb per dialog). */
export function importVerb(n) {
  if (!n) return FIGMA_WORDS.import;
  return `Import ${n} ${n === 1 ? 'frame' : 'frames'}`;
}

/** A fixed reason → words. Unknown reasons read as the generic line; no upstream text ever shows. */
export function figmaFailureWords(reason) {
  switch (reason) {
    case 'not-connected':
      return `${FIGMA_WORDS.notConnected} ${FIGMA_WORDS.notConnectedRest}`;
    case 'bad-url':
    case 'bad-request':
      return "That isn't a Figma link Maude can read. Copy it from Figma's Share › Copy link.";
    case 'forbidden':
      return 'Your role on this project can’t import. Ask the owner for Can edit.';
    case 'not_found':
      return "Figma doesn't have that file, or this token can't read it.";
    case 'unauthorized':
    case 'forbidden_scope':
      return 'Figma refused the token. Replace it in Settings › Connections.';
    case 'rate_limited':
      return 'Figma asked Maude to slow down. Try again in a minute.';
    case 'not-on-page':
      return 'The file changed while you were picking. Paste the link again.';
    default:
      return "Couldn't read the file from Figma. Try again.";
  }
}

/** Make editable's refusal reasons (DDR-219 `CodegenError.kind`) → words. */
export function makeEditableWords(reason) {
  switch (reason) {
    case 'unavailable':
    case 'handshake':
    case 'tool_surface':
      return 'Open the Figma desktop app on this file, in Dev Mode, then try again.';
    case 'node_unavailable':
      return 'Figma has another file open. Open this one in Dev Mode, then try again.';
    default:
      return "Figma couldn't make this artboard editable. Nothing was changed.";
  }
}

/** The folders a new canvas can go in, from the project index (any `.tsx` path, designRoot-relative). */
export function foldersOf(index, designRel = '.design') {
  const root = `${String(designRel || '.design').replace(/\/+$/, '')}/`;
  const out = new Set();
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || depth > 8 || seen.has(v)) return;
    if (typeof v === 'string') {
      if (!v.endsWith('.tsx')) return;
      const rel = v.startsWith(root) ? v.slice(root.length) : v;
      if (rel.startsWith('/') || rel.includes('..')) return;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const top = dir.split('/')[0];
      if (top.startsWith('_') || top === 'system' || top === 'assets') return;
      out.add(dir);
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  walk(index, 0);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** "2026/dresy › New canvas" (the root reads as the project). */
export function destLabel(folder) {
  return `${folder || 'Project'} › ${FIGMA_WORDS.newCanvas}`;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The summary card (ia-figma-arrived): one row per thing that came across, and one per compromise.
 * @returns {Array<{ tone: 'ok'|'warn'|'skip', text: string }>}
 */
export function frameSummaryRows(r) {
  if (!r) return [];
  const by = new Map();
  for (const d of r.dispositions ?? []) by.set(d.disposition, (by.get(d.disposition) ?? 0) + 1);
  const rows = [
    {
      tone: 'ok',
      text: `${count(r.artboards ?? 0, 'artboard', 'artboards')}, at ${r.artboards === 1 ? 'its' : 'their'} Figma ${r.artboards === 1 ? 'size' : 'sizes'}, as ${r.artboards === 1 ? 'a picture' : 'pictures'}`,
    },
  ];
  const c = r.comments ?? {};
  if (c.placed > 0)
    rows.push({
      tone: 'ok',
      text: `${count(c.placed, 'comment', 'comments')} came across as stickies${c.resolved ? ` (${c.resolved} resolved)` : ''}`,
    });
  if (c.elsewhere > 0)
    rows.push({
      tone: 'skip',
      text: `${count(c.elsewhere, 'comment', 'comments')} on frames you didn't pick, or that are gone, left out`,
    });
  const pending = (r.assets?.pending ?? 0) - (r.assets?.resolved ?? 0);
  if (pending > 0)
    rows.push({
      tone: 'warn',
      text: `${count(pending, 'frame', 'frames')} Figma couldn't draw — ${pending === 1 ? 'its' : 'their'} artboard shows a gap`,
    });
  if (by.get('asset-degraded'))
    rows.push({
      tone: 'warn',
      text: `${count(by.get('asset-degraded'), 'picture', 'pictures')} kept as a still image`,
    });
  if (by.get('hidden-node-skipped'))
    rows.push({
      tone: 'skip',
      text: `${count(by.get('hidden-node-skipped'), 'hidden layer', 'hidden layers')} left out`,
    });
  if (r.tokens) {
    rows.push(
      r.tokens.failed
        ? {
            tone: 'warn',
            text: "Colours and text styles couldn't be read — the frames came in anyway",
          }
        : {
            tone: 'ok',
            text: `${count(r.tokens.count ?? 0, 'colour or text style', 'colours and text styles')} saved for the project's style`,
          }
    );
  }
  return rows;
}

/** The FigJam summary (ia-figjam), from the S4.16 answer `{ items, comments, widgets }`. */
export function boardSummaryRows(r) {
  if (!r) return [];
  const rows = [
    {
      tone: 'ok',
      text: `${count(r.items ?? 0, 'item', 'items')} on the annotation layer, in one section`,
    },
  ];
  if (r.comments)
    rows.push({ tone: 'ok', text: `${count(r.comments, 'comment', 'comments')} → stickies` });
  if (r.widgets)
    rows.push({
      tone: 'warn',
      text: `${count(r.widgets, "widget can't", "widgets can't")} come across — ${r.widgets === 1 ? 'it arrives' : 'they arrive'} as a picture`,
    });
  return rows;
}

/** Advanced: node ids · reason codes, one line per non-plain disposition (code-owned strings only). */
export function reasonLines(dispositions, limit = 40) {
  const lines = [];
  for (const d of dispositions ?? []) {
    if (d.disposition === 'imported') continue;
    if (lines.length >= limit) break;
    lines.push(`${String(d.nodeId ?? '')} · ${String(d.disposition ?? '')}`);
  }
  return lines;
}
