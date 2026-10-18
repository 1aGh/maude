// client/v2/export/advanced/command.js — S8.3: the sheet's spec as the same export from a terminal
// (09 ex-advanced "The same export from a terminal").
//
//   maude design export png --scope folder --folder social --kind digital=png:scale=1 …
//   /design:export png --scope folder …
//
// PURE. The flags are the ones `cli/lib/export-spec.mjs` `planExportRequest` reads (contract
// S8-export-spec §5.7), and a test feeds every printed line back through `planExportArgv` — the CLI's
// own parser — and holds the result equal to the spec the sheet would send, so a command line cannot
// say something the sheet does not export.

/** The spec's dotted option path → the short `--option` name the CLI knows (the reverse of its aliases). */
const ALIAS = {
  'size.scale': 'scale',
  'size.dpi': 'dpi',
  jpgQuality: 'quality',
  'print.bleed': 'bleed',
  'print.marks': 'marks',
  'print.back': 'back',
  'video.fps': 'fps',
  'video.quality': 'videoQuality',
  'video.captions': 'captions',
  'video.linked': 'linked',
  'video.allowLonger': 'allowLonger',
  'audio.codec': 'codec',
};

/** `{ size: { scale: 2 }, print: { bleed: true } }` → [['size.scale', 2], ['print.bleed', true]]. */
function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, path));
    else if (v !== undefined) out.push([path, v]);
  }
  return out;
}

const optionItem = ([path, value]) => `${ALIAS[path] ?? path}=${value}`;

/** One word of a shell command line: bare when it is safe, else single-quoted. */
export function shellQuote(word) {
  const w = String(word);
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`;
}

/** The argument words (after `export`) for a spec — unquoted, in the order a person reads them. */
export function specArgs(spec) {
  const args = [spec.format, '--scope', spec.scope];
  if (spec.canvas) args.push('--canvas', spec.canvas);
  if (spec.folder) args.push('--folder', spec.folder);
  for (const id of spec.selection?.artboards ?? []) args.push('--artboard', id);
  for (const id of spec.selection?.elements ?? []) args.push('--element', id);
  const rect = spec.region?.rect;
  if (rect) args.push('--region', [rect.x, rect.y, rect.w, rect.h].join(','));
  if (spec.unit) args.push('--unit', spec.unit);
  for (const [kind, entry] of Object.entries(spec.byKind ?? {})) {
    const opts = flatten(entry.options).map(optionItem).join(',');
    args.push('--kind', `${kind}=${entry.format}${opts ? `:${opts}` : ''}`);
  }
  const { nameTemplate, ...rest } = spec.options ?? {};
  for (const item of flatten(rest)) args.push('--option', optionItem(item));
  if (nameTemplate !== undefined) args.push('--name', nameTemplate);
  if (spec.at?.sha) args.push('--at', spec.at.sha);
  if (spec.wait) args.push('--wait', spec.wait);
  return args;
}

export const CLI_PREFIX = 'maude design export';
export const CLAUDE_PREFIX = '/design:export';

/** The two lines the Advanced fold prints: a terminal, and Claude Code. */
export function commandLines(spec) {
  const words = specArgs(spec).map(shellQuote).join(' ');
  return [
    { id: 'cli', label: 'Terminal', text: `${CLI_PREFIX} ${words}` },
    { id: 'claude', label: 'Claude Code', text: `${CLAUDE_PREFIX} ${words}` },
  ];
}

/**
 * A printed line back into the words `planExportArgv` takes (a small POSIX single-quote reader — the
 * only quoting `shellQuote` ever writes). Used by the round-trip test.
 */
export function splitCommand(line) {
  const words = [];
  let cur = '';
  let started = false;
  let quoted = false;
  const chars = [...line];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (quoted) {
      if (ch === `'`) quoted = false;
      else cur += ch;
    } else if (ch === `'`) {
      quoted = true;
      started = true;
    } else if (ch === '\\' && i + 1 < chars.length) {
      // `'\''` closes the quote, writes an escaped quote and reopens it
      i += 1;
      cur += chars[i];
      started = true;
    } else if (ch === ' ') {
      if (started || cur) words.push(cur);
      cur = '';
      started = false;
    } else cur += ch;
  }
  if (started || cur) words.push(cur);
  return words;
}
