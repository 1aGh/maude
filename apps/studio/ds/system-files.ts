// ds/system-files.ts — S10.19: what Design system › Advanced shows (13 · ds-advanced).
//
// "Today's folder, one fold down": the tokens file as CSS or JSON (read-only, shortened the way the drawing
// does it — a few names a block, then "… N more"), the `system/<ds>/` folder as a short list, and the
// system's own version history from `revisions/head.json`'s `log`. Everything is read from the files as they
// are; nothing here writes. `GET /_api/ds/system-files?ds=` serves it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { type By, type LogEntry, readHead } from './head.ts';
import type { SystemConfig } from './system.ts';

export const FILES_FORMAT = 'maude.ds-system-files';
export const FILES_V = 1;
/** declarations kept a block before "… N more" */
export const PER_BLOCK = 6;
/** lines kept of a long file */
export const MAX_LINES = 48;
export const HISTORY_SHOWN = 6;

export interface FileRow {
  kind: 'folder' | 'file';
  /** the names on this row: `colors_and_type.css · tokens.json` is two */
  names: string[];
  /** a quiet word after them: "voice, rules" · "38 specimen pages" */
  note?: string;
  /** 0 = the system folder itself, 1 = inside it */
  depth: 0 | 1;
}

export interface HistoryRow {
  rev: string;
  action: string;
  /** whose hand it was */
  who: string;
  kind: 'person' | 'ai' | 'file';
  /** what it did, in words (the entry's own summary when it has one) */
  text: string;
  at: string | null;
}

export interface SystemFiles {
  format: typeof FILES_FORMAT;
  v: typeof FILES_V;
  ds: string;
  /** `system/<ds>/` */
  folder: string;
  css: { file: string; text: string; present: boolean };
  json: { file: string; text: string; present: boolean };
  files: FileRow[];
  history: HistoryRow[];
  converted: boolean;
}

/** A tokens file, shortened: each block keeps its first names, then one "… N more" line. Pure. */
export function abbreviateCss(css: string, perBlock = PER_BLOCK, maxLines = MAX_LINES): string {
  const out: string[] = [];
  let depth = 0;
  let kept = 0;
  let skipped = 0;
  let inComment = false;
  // a long file header (a block comment of more than a few lines at the top level) is one line here: the view is
  // for the tokens, which is where the board's drawing starts (P8 c7)
  let head: string[] = [];
  const flushHead = () => {
    if (head.length > 3) {
      const first = head.map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').trim()).find(Boolean) ?? '';
      out.push(`/* ${first} … */`);
    } else out.push(...head);
    head = [];
  };
  for (const line of css.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (inComment || t.startsWith('/*')) {
      inComment = !(t.includes('*/') && (inComment || t.indexOf('/*') <= t.indexOf('*/')));
      if (depth === 0) {
        if (inComment || head.length) head.push(line);
        else out.push(line);
        if (!inComment && head.length) flushHead();
      }
      continue;
    }
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;
    const decl = depth === 1 && opens === 0 && closes === 0 && /^--[\w-]+\s*:/.test(t);
    if (decl) {
      if (kept < perBlock) {
        out.push(line);
        kept++;
      } else skipped++;
      continue;
    }
    if (closes > opens && depth === 1 && skipped > 0) out.push(`  …  /* ${skipped} more */`);
    if (opens > closes && depth === 0) {
      kept = 0;
      skipped = 0;
    }
    depth = Math.max(0, depth + opens - closes);
    if (depth === 0 && closes > 0) {
      kept = 0;
      skipped = 0;
    }
    if (t === '' && out.at(-1) === '') continue;
    out.push(line);
  }
  while (out.at(-1) === '') out.pop();
  if (out.length <= maxLines) return out.join('\n');
  return `${out.slice(0, maxLines).join('\n')}\n…  /* ${out.length - maxLines} more lines */`;
}

/** A JSON file, shortened to its first lines. Pure. */
export function abbreviateJson(text: string, maxLines = MAX_LINES): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n…  /* ${lines.length - maxLines} more lines */`;
}

const read = (abs: string): string | null => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

const dirNames = (abs: string): string[] => {
  try {
    return readdirSync(abs).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
};

const isDir = (abs: string) => {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The folder as a short list: each row is what a designer would point at. */
export function filesOf(designRootAbs: string, sys: SystemConfig): FileRow[] {
  const abs = path.join(designRootAbs, sys.path);
  const rows: FileRow[] = [
    { kind: 'folder', names: [`${sys.path.replace(/\/+$/, '')}/`], depth: 0 },
  ];
  const tokenFiles = [
    path.basename(sys.tokensCssRel),
    'tokens.json',
    ...(existsSync(path.join(abs, 'components.json')) ? ['components.json'] : []),
  ].filter((n) => existsSync(path.join(abs, n)));
  if (tokenFiles.length) rows.push({ kind: 'file', names: tokenFiles, depth: 1 });
  const docs = ['README.md', 'SKILL.md', 'CONTRACT.md'].filter((n) =>
    existsSync(path.join(abs, n))
  );
  if (docs.length) rows.push({ kind: 'file', names: docs, note: 'voice, rules', depth: 1 });
  const preview = dirNames(path.join(abs, 'preview')).filter(
    (n) => !n.startsWith('_') && /\.(tsx|html)$/.test(n)
  );
  if (isDir(path.join(abs, 'preview')))
    rows.push({
      kind: 'folder',
      names: ['preview/'],
      note: plural(preview.length, 'specimen page', 'specimen pages'),
      depth: 1,
    });
  const assets = dirNames(path.join(abs, 'assets'))
    .filter((n) => isDir(path.join(abs, 'assets', n)))
    .sort();
  if (isDir(path.join(abs, 'assets')))
    rows.push({
      kind: 'folder',
      names: ['assets/'],
      ...(assets.length ? { note: assets.join(', ') } : {}),
      depth: 1,
    });
  return rows;
}

const ACTION_WORDS: Readonly<Record<string, string>> = {
  publish: 'Published a version',
  keep: 'Kept a change made in the files',
  pick: 'Picked between two versions',
  convert: 'Turned the folder into a Design system canvas',
  make: 'Made the Design system',
  library: 'Took an update from the library',
  upgrade: 'Brought it up to the schema',
  restore: 'Put an earlier version back',
};

const whoOf = (by: By | undefined): string => {
  if (!by) return 'Someone';
  if (by.kind === 'ai') return 'AI';
  if (by.kind === 'agent') return by.name || 'Claude Code';
  if (by.kind === 'import') return 'Import';
  return by.name || (by.kind === 'peer' ? 'A teammate' : 'You');
};

/** The log, newest first, as the rows Version history draws. Pure. */
export function historyOf(log: readonly LogEntry[], shown = HISTORY_SHOWN): HistoryRow[] {
  return [...log]
    .reverse()
    .slice(0, shown)
    .map((e) => {
      const words = typeof e.summary === 'string' && e.summary ? e.summary : ACTION_WORDS[e.action];
      const n = typeof e.updated === 'number' && e.updated > 0 ? e.updated : 0;
      const text =
        typeof e.summary === 'string' && e.summary && n
          ? `${e.summary} · ${plural(n, 'canvas', 'canvases')} updated`
          : (words ?? e.action);
      return {
        rev: e.rev,
        action: e.action,
        who: whoOf(e.by),
        kind: e.by?.kind === 'ai' ? 'ai' : e.action === 'keep' ? 'file' : 'person',
        text,
        at: typeof e.at === 'string' ? e.at : null,
      };
    });
}

/** Everything Advanced draws for one system. */
export function readSystemFiles(designRootAbs: string, sys: SystemConfig): SystemFiles {
  const abs = path.join(designRootAbs, sys.path);
  const cssRaw = read(path.join(designRootAbs, sys.tokensCssRel));
  const jsonRaw = read(path.join(abs, 'tokens.json'));
  const head = readHead(abs);
  return {
    format: FILES_FORMAT,
    v: FILES_V,
    ds: sys.name,
    folder: `${sys.path.replace(/\/+$/, '')}/`,
    css: {
      file: path.basename(sys.tokensCssRel),
      text: cssRaw === null ? '' : abbreviateCss(cssRaw),
      present: cssRaw !== null,
    },
    json: {
      file: 'tokens.json',
      text: jsonRaw === null ? '' : abbreviateJson(jsonRaw),
      present: jsonRaw !== null,
    },
    files: filesOf(designRootAbs, sys),
    history: head.state === 'ok' ? historyOf(head.doc.log) : [],
    converted: head.state === 'ok',
  };
}
