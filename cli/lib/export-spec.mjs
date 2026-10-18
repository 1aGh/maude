// export-spec.mjs — what `maude design export` sends: a v1 body or an ExportSpec v2 (S8.1c).
//
// Contract client/v2/contracts/S8-export-spec.md §5.7. The server owns validation
// (`validateSpecV2`, apps/studio/exporters/spec-v2.ts): this module only parses flags into the
// spec's shape and refuses what a flag can get wrong BEFORE a request (a region that is not four
// numbers, a v1 scope next to a v2-only flag). Everything else — an unknown option key, a bad
// folder path, a field the engine cannot run yet — comes back from the server as `bad-spec` /
// `not-available` with the sentence to print.
//
// Two spellings of one scope are live: `--scope selection|canvas|folder|project` is v2;
// `--scope artboard|canvas-as-separate|canvas-whole|selection-bounds|project-raw` is v1 and sends
// the v1 body unchanged. `selection` is in both — alone it stays the v1 "live selection" body, and
// the moment a v2-only flag names what to export (`--artboard`, `--region`, …) it is v2.

import { parseArgs } from './argv.mjs';

export const V1_SCOPES = [
  'selection',
  'artboard',
  'canvas-as-separate',
  'canvas-whole',
  'selection-bounds',
  'project-raw',
];
export const V2_SCOPES = ['selection', 'canvas', 'folder', 'project'];
export const V1_FORMATS = [
  'png',
  'pdf',
  'svg',
  'html',
  'pptx',
  'canva',
  'zip',
  'mp4',
  'webm',
  'gif',
];
/** Formats only the v2 engine knows. */
export const V2_ONLY_FORMATS = ['jpg', 'audio'];
const ALL_FORMATS = new Set([...V1_FORMATS, ...V2_ONLY_FORMATS]);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'gif']);

/** Flags that only mean something in a v2 spec (the value-taking ones; `--estimate` is a boolean). */
const V2_FLAGS = ['folder', 'canvas', 'region', 'unit', 'at', 'name', 'wait'];

/** `true`/`false` → booleans; a string that IS a plain number (round-trips) → number; else as typed. */
export function coerceOptionValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  // `String(n) === value` keeps "007", "1e3", "0x10", "2.50", "" and "000000" (a hex colour) as the
  // strings they were typed as; isFinite drops "NaN" / "Infinity".
  return Number.isFinite(n) && String(n) === value ? n : value;
}

/** Short `--option` names → the spec's dotted path. Anything else is read as a dotted path itself. */
const OPTION_ALIASES = {
  scale: 'size.scale',
  dpi: 'size.dpi',
  quality: 'jpgQuality',
  bleed: 'print.bleed',
  marks: 'print.marks',
  back: 'print.back',
  fps: 'video.fps',
  videoQuality: 'video.quality',
  captions: 'video.captions',
  linked: 'video.linked',
  allowLonger: 'video.allowLonger',
  codec: 'audio.codec',
};

/**
 * Repeated `--option k=v` → the spec's nested `options`, or `{ error }`. The key is a short alias
 * (`scale`, `dpi`, `bleed`, `fps`, `codec` …) or the spec's own dotted path (`video.fps`,
 * `print.marks`); the server's validator rejects a key the spec does not have, naming it.
 */
export function parseSpecOptions(items) {
  const options = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq < 1) return { error: `invalid --option "${item}" (expected key=value)` };
    const path = (OPTION_ALIASES[item.slice(0, eq)] ?? item.slice(0, eq)).split('.');
    if (
      path.some(
        (seg) => !seg || seg === '__proto__' || seg === 'constructor' || seg === 'prototype'
      )
    )
      return { error: `invalid --option key "${item.slice(0, eq)}"` };
    let at = options;
    for (const seg of path.slice(0, -1)) {
      if (typeof at[seg] !== 'object' || at[seg] === null) at[seg] = {};
      at = at[seg];
    }
    at[path[path.length - 1]] = coerceOptionValue(item.slice(eq + 1));
  }
  return { options };
}

/**
 * Repeated `--kind <kind>=<format>[:k=v,k=v]` → the spec's `byKind` (S8.3: "each kind keeps its own
 * format"), or `{ error }`. The options after the colon are `--option` items for that kind alone, so
 * `--kind print=pdf:bleed=true,marks=crop` is `byKind.print = { format: 'pdf', options: { print: … } }`.
 */
export function parseKindFormats(items) {
  const byKind = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    const colon = item.indexOf(':');
    const head = colon < 0 ? item : item.slice(0, colon);
    const kind = head.slice(0, head.indexOf('='));
    const format = eq < 1 ? '' : head.slice(eq + 1);
    if (!kind || !ALL_FORMATS.has(format))
      return { error: `invalid --kind "${item}" (expected kind=format, e.g. print=pdf)` };
    const entry = { format };
    if (colon >= 0) {
      const parsed = parseSpecOptions(
        item
          .slice(colon + 1)
          .split(',')
          .filter(Boolean)
      );
      if (parsed.error) return { error: parsed.error };
      if (Object.keys(parsed.options).length) entry.options = parsed.options;
    }
    byKind[kind] = entry;
  }
  return { byKind };
}

/** `x,y,w,h` → `{ x, y, w, h }` (world units, w and h > 0), or `{ error }`. */
export function parseRegion(text) {
  const parts = String(text ?? '')
    .split(',')
    .map((p) => p.trim());
  const [x, y, w, h] = parts.map((p) => (p === '' ? Number.NaN : Number(p)));
  if (parts.length !== 4 || ![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0))
    return {
      error: `invalid --region "${text}" (expected x,y,w,h in canvas units, w and h above 0)`,
    };
  return { rect: { x, y, w, h } };
}

/**
 * Flags → the request to send.
 *
 * @param {string} format
 * @param {Record<string, unknown>} flags     parsed `--flag value` pairs
 * @param {{ option?: string[], artboard?: string[], element?: string[], kind?: string[] }} repeated  repeatable flags
 * @returns {{ mode: 'v1', body: object }
 *          | { mode: 'v2', spec: object }
 *          | { error: string }}
 */
export function planExportRequest(format, flags, repeated = {}) {
  const artboards = repeated.artboard ?? [];
  const elements = repeated.element ?? [];
  const kinds = repeated.kind ?? [];
  const v2Flags = [
    ...V2_FLAGS.filter((k) => flags[k] !== undefined).map((k) => `--${k}`),
    ...(artboards.length ? ['--artboard'] : []),
    ...(elements.length ? ['--element'] : []),
    ...(kinds.length ? ['--kind'] : []),
  ];
  const wantsV2 = v2Flags.length > 0 || flags.estimate === true || V2_ONLY_FORMATS.includes(format);

  const optionItems = repeated.option ?? [];
  const scope = flags.scope;
  let v2;
  if (scope === undefined) v2 = wantsV2;
  else if (scope === 'selection') v2 = wantsV2;
  else if (V2_SCOPES.includes(scope)) v2 = true;
  else if (V1_SCOPES.includes(scope)) {
    if (wantsV2) {
      const why = v2Flags.length
        ? v2Flags.join(' ')
        : flags.estimate === true
          ? '--estimate'
          : `${format} export`;
      return {
        error: `${why} needs a v2 scope: --scope selection|canvas|folder|project (not "${scope}")`,
      };
    }
    v2 = false;
  } else return { error: `unknown --scope "${scope}"` };

  if (!v2) return { mode: 'v1', scope: scope ?? null };

  const spec = {
    v: 2,
    scope: scope ?? (artboards.length || elements.length ? 'selection' : 'canvas'),
  };
  if (flags.canvas !== undefined) spec.canvas = flags.canvas;
  if (flags.folder !== undefined) spec.folder = flags.folder;
  if (artboards.length || elements.length) {
    spec.selection = {
      ...(artboards.length ? { artboards } : {}),
      ...(elements.length ? { elements } : {}),
    };
  }
  if (flags.region !== undefined) {
    const r = parseRegion(flags.region);
    if (r.error) return { error: r.error };
    spec.region = { rect: r.rect };
  }
  if (flags.unit !== undefined) {
    if (flags.unit !== 'each' && flags.unit !== 'one')
      return { error: `invalid --unit "${flags.unit}" (expected each or one)` };
    spec.unit = flags.unit;
  }
  spec.format = format;
  if (kinds.length) {
    const k = parseKindFormats(kinds);
    if (k.error) return { error: k.error };
    spec.byKind = k.byKind;
  }
  const parsed = parseSpecOptions(optionItems);
  if (parsed.error) return { error: parsed.error };
  const options = parsed.options;
  if (flags.name !== undefined) options.nameTemplate = String(flags.name);
  if (Object.keys(options).length) spec.options = options;
  if (flags.at !== undefined) spec.at = { sha: String(flags.at) };
  if (flags.wait !== undefined) spec.wait = flags.wait;
  return { mode: 'v2', spec };
}

/** Every occurrence of a repeatable `--flag value` / `--flag=value` in an argv. */
export function collectRepeatedFlag(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1] !== undefined) {
      out.push(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith(`${name}=`)) {
      out.push(argv[i].slice(name.length + 1));
    }
  }
  return out;
}

/**
 * The words after `maude design export` → the format and the request to send. The ONE path both the
 * CLI and the Export sheet's command-line test take, so a printed command line cannot drift from the
 * parser. @returns {{ format: string|undefined, flags: object, optionItems: string[], plan: object }}
 */
export function planExportArgv(subArgs) {
  const { positional, flags } = parseArgs(subArgs, { booleans: ['help', 'estimate'] });
  const format = positional[0];
  const optionItems = collectRepeatedFlag(subArgs, '--option');
  const plan = planExportRequest(format, flags, {
    option: optionItems,
    artboard: collectRepeatedFlag(subArgs, '--artboard'),
    element: collectRepeatedFlag(subArgs, '--element'),
    kind: collectRepeatedFlag(subArgs, '--kind'),
  });
  return { format, flags, optionItems, plan };
}

/** The v1 default scope per format (unchanged since V2-2.8). */
export function defaultV1Scope(format) {
  if (VIDEO_FORMATS.has(format)) return 'artboard';
  return format === 'zip' ? 'project-raw' : 'canvas-as-separate';
}

/**
 * The file name a `Content-Disposition` header names: RFC 6266 `filename*=UTF-8''…` (percent-
 * decoded) wins over the plain `filename="…"` ASCII fallback; null when it names neither.
 * The result is a header value, so the caller keeps only its basename.
 */
export function filenameFromDisposition(disposition) {
  const star = /filename\*\s*=\s*([^;]+)/i.exec(disposition ?? '');
  if (star) {
    // `charset'lang'value` — the charset is UTF-8 by contract; the language tag is ignored
    const value = star[1].trim().replace(/^[^']*'[^']*'/, '');
    try {
      const decoded = decodeURIComponent(value);
      if (decoded) return decoded;
    } catch {
      /* a broken escape: fall back to the plain name */
    }
  }
  return /filename\s*=\s*"([^"]+)"/i.exec(disposition ?? '')?.[1] ?? null;
}

/** 2 significant figures in KB / MB / GB (1000-based, like the file manager's words). */
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

/** "a second" (<2), "a few seconds" (<10), "about N seconds" (<60, to 5), "about N min". */
function secondsWords(seconds) {
  if (seconds < 2) return 'a second';
  if (seconds < 10) return 'a few seconds';
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `about ${Math.round(seconds / 60)} min`;
}

/** Contract §5.5: "21 files · about 140 MB · about 20 seconds on this Mac". */
export function estimateWords({ files, bytes, seconds, lane }) {
  const where = lane === 'cloud' ? 'in the cloud' : 'on this Mac';
  return [
    `${files} ${files === 1 ? 'file' : 'files'}`,
    `about ${bytesWords(bytes)}`,
    `${secondsWords(seconds)} ${where}`,
  ].join(' · ');
}

const SKIP_WORDS = {
  'shared-part': 'a shared part, exported with the canvas that owns it',
  'format-unit': 'this format cannot take that unit',
  'not-in-scope': 'not one you can export',
};

/** The lines `--estimate` prints (no trailing newline). */
export function estimateLines(est) {
  const lines = [estimateWords(est)];
  const counts = [
    ['Selection', est.counts?.selection],
    ['This canvas', est.counts?.canvas],
    ['Folder', est.counts?.folder],
    ['Whole project', est.counts?.project],
  ].filter(([, n]) => typeof n === 'number');
  if (counts.length)
    lines.push(
      counts.map(([label, n]) => `${label} ${n} ${n === 1 ? 'artboard' : 'artboards'}`).join(' · ')
    );
  for (const [kind, k] of Object.entries(est.byKind ?? {}))
    lines.push(
      `  ${kind}: ${k.artboards} ${k.artboards === 1 ? 'artboard' : 'artboards'} → ${k.files} ${k.files === 1 ? 'file' : 'files'} (${k.format})`
    );
  for (const s of est.skipped ?? [])
    lines.push(`  skipped ${s.name}: ${SKIP_WORDS[s.reason] ?? s.reason}`);
  return lines;
}

/** A failed response → the sentence to print: the server's own `message` when it sent one. */
export function refusalText(status, text) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.message === 'string' && j.message) {
      return `${j.message}${typeof j.field === 'string' && j.field ? ` (${j.field})` : ''}`;
    }
  } catch {
    /* plain text body */
  }
  return `server returned ${status}: ${text}`;
}
