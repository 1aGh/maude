// `maude migrate v2` — the steps (V2-1.12 §5.10, + V2-1.10 §5.10's transcripts).
//
// Each step is PURE over the bytes it is handed (+ a few reads through ctx):
// it returns the writes it wants, never performs them. The engine plans,
// snapshots, stages, applies all-or-nothing and reverses (engine.ts).
//
// Never touched (I6): canvas `.tsx`, DS CSS / `_components.css` / `preview/**`,
// media under `assets/**`, `_comments/`, `_trash/`, `_canvas-state/`, `.git`.
// The one `assets/` exception is V2-1.10's amendment: `transcripts.import`
// creates `assets/<sha8>.transcript.json` and trashes the bare whisper dump
// `assets/<sha8>.json` beside it — sidecars, never media.

import { createHash } from 'node:crypto';

import { migrateSvg } from '../annotations/migrate-v1.ts';
import { isKnownType, specOf } from '../annotations/registry.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { asFormat } from '../format.ts';
import { DS_EMITTER_PENDING, type DsSystemEntry, type DsTokensEmitter } from './ds-registry.ts';

export interface StepCtx {
  designRoot: string;
  now: Date;
  direction: 'forward' | 'reverse';
  /** the parsed `config.json` */
  config: Record<string, unknown>;
  /** design-root-relative files matching `glob` (see engine `matchGlob`) */
  list(glob: string): string[];
  /** read one file (recorded into the tree hash); null when absent */
  read(rel: string): Uint8Array | null;
  /** whole lines from the START of a file, bounded (recorded) */
  readHead(rel: string, maxBytes?: number): string[];
  ds: DsTokensEmitter | null;
}

export interface StepResult {
  /** only paths whose bytes change; null = move to `_trash/migrate-v2/` */
  writes: Map<string, Uint8Array | null>;
  refusals: Array<{ path: string; reason: string }>;
  lost: Array<{ path: string; field: string; count: number }>;
  notes: string[];
  /** files a PREREQUISITE writes outside the staged set (DDR-242 legacy boards) */
  prerequisite?: Array<{ path: string; action: 'create' | 'remove'; note: string }>;
  /** the step cannot run in this build — why */
  skip?: string;
}

export interface MigrationStep {
  id: string;
  /** design-root-relative globs (`**` never enters a `_`/`.` directory) */
  scope: readonly string[];
  forward(files: ReadonlyMap<string, Uint8Array>, ctx: StepCtx): StepResult;
  reverse(files: ReadonlyMap<string, Uint8Array>, ctx: StepCtx, o: { strip: boolean }): StepResult;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (b: Uint8Array) => dec.decode(b);
const bytes = (s: string) => enc.encode(s);
export const sha256 = (b: Uint8Array | string) =>
  `sha256:${createHash('sha256')
    .update(typeof b === 'string' ? b : Buffer.from(b))
    .digest('hex')}`;

const result = (): StepResult => ({ writes: new Map(), refusals: [], lost: [], notes: [] });

function parseObject(b: Uint8Array | undefined | null): Record<string, unknown> | null {
  if (!b) return null;
  try {
    const v = JSON.parse(text(b)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Re-serialize an object the way its file was formatted (indent + final newline). */
function restringify(original: string, obj: unknown): string {
  const m = original.match(/^\{\s*\n([ \t]+)"/);
  const indent = m ? (m[1] as string) : original.includes('\n') ? 2 : 0;
  const body = JSON.stringify(obj, null, indent || undefined);
  return original.endsWith('\n') ? `${body}\n` : body;
}

function countLost(lost: StepResult['lost'], path: string, field: string): void {
  const row = lost.find((l) => l.path === path && l.field === field);
  if (row) row.count += 1;
  else lost.push({ path, field, count: 1 });
}

// ─── project.marker ──────────────────────────────────────────────────────────

/** Insert / set `"formatVersion": 2` touching one line of the file. */
export function withFormatMarker(src: string): string {
  const obj = JSON.parse(src) as Record<string, unknown>;
  let out: string;
  if (Object.hasOwn(obj, 'formatVersion')) {
    out = src.replace(/("formatVersion"\s*:\s*)[^,}\n\r]+/, '$12');
  } else {
    const m = src.match(/^(\s*)\{([ \t]*\r?\n?)([ \t]*)/);
    const lead = m?.[1] ?? '';
    const nl = m?.[2] ?? '';
    const indent = m?.[3] ?? '';
    const rest = src.slice(m?.[0].length ?? 0);
    if (rest.trimStart().startsWith('}')) out = `${lead}{"formatVersion": 2${rest.trimStart()}`;
    else if (nl.includes('\n'))
      out = `${lead}{${nl}${indent}"formatVersion": 2,${nl}${indent}${rest}`;
    else out = `${lead}{"formatVersion": 2, ${indent}${rest}`;
  }
  try {
    if ((JSON.parse(out) as { formatVersion?: unknown }).formatVersion === 2) return out;
  } catch {
    /* fall back below */
  }
  return restringify(src, { formatVersion: 2, ...obj });
}

/** Remove the marker touching only its own line. */
export function withoutFormatMarker(src: string): string {
  const obj = JSON.parse(src) as Record<string, unknown>;
  if (!Object.hasOwn(obj, 'formatVersion')) return src;
  const candidates = [
    src.replace(/\r?\n[ \t]*"formatVersion"\s*:\s*[^,}\n\r]+,/, ''),
    src.replace(/"formatVersion"\s*:\s*[^,}\n\r]+,\s*/, ''),
    src.replace(/,\s*"formatVersion"\s*:\s*[^,}\n\r]+/, ''),
  ];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as Record<string, unknown>;
      if (!Object.hasOwn(v, 'formatVersion')) return c;
    } catch {
      /* next */
    }
  }
  const { formatVersion: _drop, ...rest } = obj;
  return restringify(src, rest);
}

const marker: MigrationStep = {
  id: 'project.marker',
  scope: ['config.json'],
  forward(files) {
    const r = result();
    const cfg = files.get('config.json');
    if (!cfg) return r;
    const src = text(cfg);
    const obj = parseObject(cfg);
    if (!obj) return r; // the engine refuses an unreadable config before steps run
    if (asFormat(obj.formatVersion) === 2) return r;
    r.writes.set('config.json', bytes(withFormatMarker(src)));
    return r;
  },
  reverse(files) {
    const r = result();
    const cfg = files.get('config.json');
    const obj = parseObject(cfg);
    if (!cfg || !obj || !Object.hasOwn(obj, 'formatVersion')) return r;
    r.writes.set('config.json', bytes(withoutFormatMarker(text(cfg))));
    return r;
  },
};

// ─── annotations.check ───────────────────────────────────────────────────────

/** Element types only v2 writes (V2-1.12 §5.3: vote stamps are a new type).
 *  An unknown type that is NOT here came from somewhere else and is never
 *  ours to strip — 1.x keeps unknown types verbatim (probe C). */
export const V2_ONLY_TYPES: ReadonlySet<string> = new Set(['vote-stamp']);

function stripBoard(
  rel: string,
  elements: readonly AnnotationElement[],
  lost: StepResult['lost']
): AnnotationElement[] | null {
  let changed = false;
  const out: AnnotationElement[] = [];
  for (const el of elements) {
    if (V2_ONLY_TYPES.has(el.type)) {
      countLost(lost, rel, `type:${el.type}`);
      changed = true;
      continue;
    }
    const spec = isKnownType(el.type) ? specOf(el.type) : null;
    if (!spec) {
      out.push(el);
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (Object.hasOwn(spec, k)) kept[k] = v;
      else {
        countLost(lost, rel, k);
        changed = true;
      }
    }
    out.push(kept as AnnotationElement);
  }
  return changed ? out : null;
}

const annotations: MigrationStep = {
  id: 'annotations.check',
  scope: ['**/*.annotations.json', '*.annotations.svg'],
  forward(files) {
    const r = result();
    const boards = new Set([...files.keys()].filter((p) => p.endsWith('.annotations.json')));
    for (const [rel, b] of files) {
      if (rel.endsWith('.annotations.svg')) {
        // DDR-242 prerequisite (not reversed): the boot migration's own rules.
        const slug = rel.slice(0, -'.annotations.svg'.length);
        if (rel.includes('/')) continue; // the legacy board is flat at the design root
        if (boards.has(`${slug}.annotations.json`)) {
          r.prerequisite = [
            ...(r.prerequisite ?? []),
            {
              path: rel,
              action: 'remove',
              note: 'stale legacy board — quarantined to _trash/annotations-v1/ (DDR-242)',
            },
          ];
          continue;
        }
        const { elements, report } = migrateSvg(text(b));
        const parsed = parseBoard(serializeBoard(elements));
        if (parsed.dropped.length) {
          r.refusals.push({
            path: rel,
            reason: `the converted board drops ${parsed.dropped.length} element(s)`,
          });
          continue;
        }
        r.prerequisite = [
          ...(r.prerequisite ?? []),
          {
            path: `${slug}.annotations.json`,
            action: 'create',
            note: `converted from the legacy ${rel} first (DDR-242${report.length ? `; ${report.length} stroke(s) not carried over, kept in _history/` : ''})`,
          },
        ];
        continue;
      }
      const parsed = parseBoard(text(b));
      if (parsed.dropped.length) {
        const why = parsed.dropped
          .slice(0, 3)
          .map((d) => (d.id ? `${d.id}: ${d.reason}` : d.reason))
          .join('; ');
        r.refusals.push({
          path: rel,
          reason: `${parsed.dropped.length} element(s) would be dropped — ${why}`,
        });
      }
    }
    return r;
  },
  reverse(files, _ctx, { strip }) {
    const r = result();
    if (!strip) return r;
    for (const [rel, b] of files) {
      if (!rel.endsWith('.annotations.json')) continue;
      const parsed = parseBoard(text(b));
      if (parsed.dropped.length) continue; // never rewrite what we cannot read whole
      const stripped = stripBoard(rel, parsed.elements, r.lost);
      if (stripped) r.writes.set(rel, bytes(serializeBoard(stripped)));
    }
    return r;
  },
};

// ─── meta.check ──────────────────────────────────────────────────────────────

/** V2-1.12 §5.1 reserved top-level keys (+ V2-1.6 / V2-1.13's additions). */
export const RESERVED_META_KEYS = [
  'present',
  'artboardMeta',
  'links',
  'dsRev',
  'dsPins',
  'dsPending',
  'dsPinned',
  'dsPairing',
  'video',
] as const;

const meta: MigrationStep = {
  id: 'meta.check',
  scope: ['**/*.meta.json'],
  forward(files) {
    const r = result();
    for (const [rel, b] of files) {
      if (!parseObject(b)) r.refusals.push({ path: rel, reason: 'not a JSON object' });
    }
    return r;
  },
  reverse(files, _ctx, { strip }) {
    const r = result();
    if (!strip) return r;
    for (const [rel, b] of files) {
      const obj = parseObject(b);
      if (!obj) continue;
      let changed = false;
      for (const k of RESERVED_META_KEYS) {
        if (Object.hasOwn(obj, k)) {
          delete obj[k];
          countLost(r.lost, rel, k);
          changed = true;
        }
      }
      if (changed) r.writes.set(rel, bytes(restringify(text(b), obj)));
    }
    return r;
  },
};

// ─── comps.tracks ────────────────────────────────────────────────────────────

const comps: MigrationStep = {
  id: 'comps.tracks',
  scope: [],
  forward: () => ({
    ...result(),
    notes: ['tracks are derived from the comp source (C35) — no bytes change'],
  }),
  reverse: () => ({
    ...result(),
    notes: ['tracks are derived from the comp source (C35) — no bytes change'],
  }),
};

// ─── chats.canvas (per Mac) ──────────────────────────────────────────────────

const CONTEXT_RE = /\[maude-context canvas="([^"\n]{1,200})"/;

/** The canvas a chat was about: the first `[maude-context canvas="…"]` line
 *  of a USER turn in its transcript head. Untrusted text — accepted only as a
 *  plain relative path. */
export function derivedChatCanvas(lines: readonly string[]): string | null {
  for (const line of lines) {
    let entry: { role?: unknown; text?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.role !== 'user' || typeof entry.text !== 'string') continue;
    const m = entry.text.match(CONTEXT_RE);
    if (!m) continue;
    const p = m[1] as string;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
    if (p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) return null;
    if (p.split('/').some((s) => s === '..' || s === '')) return null;
    return p;
  }
  return null;
}

const chats: MigrationStep = {
  id: 'chats.canvas',
  scope: ['_chat/*.meta.json'],
  forward(files, ctx) {
    const r = result();
    for (const t of ctx.list('_chat/*.jsonl')) {
      const id = t.slice('_chat/'.length, -'.jsonl'.length);
      const canvas = derivedChatCanvas(ctx.readHead(t));
      if (!canvas) continue;
      const rel = `_chat/${id}.meta.json`;
      const cur = files.get(rel);
      const obj = cur ? parseObject(cur) : {};
      if (!obj) {
        r.notes.push(`${rel}: unreadable, left as it is`);
        continue;
      }
      if (typeof obj.canvas === 'string') continue;
      r.writes.set(rel, bytes(JSON.stringify({ ...obj, canvas })));
    }
    return r;
  },
  reverse(files, ctx) {
    const r = result();
    for (const [rel, b] of files) {
      const obj = parseObject(b);
      if (!obj || typeof obj.canvas !== 'string') continue;
      const id = rel.slice('_chat/'.length, -'.meta.json'.length);
      const derived = derivedChatCanvas(ctx.readHead(`_chat/${id}.jsonl`));
      if (derived !== obj.canvas) continue; // set by the chat itself — not ours
      const { canvas: _c, ...rest } = obj;
      r.writes.set(rel, bytes(JSON.stringify(rest)));
    }
    return r;
  },
};

// ─── transcripts.import (V2-1.10 §5.10) ──────────────────────────────────────

const MEDIA_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg'];
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface Word {
  id: string;
  t0: number;
  t1: number;
  text: string;
}

function srtCues(src: string): Array<{ t0: number; t1: number; text: string }> {
  const ts = (s: string) => {
    const m = s.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    return m
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]?.padEnd(3, '0')) / 1000
      : null;
  };
  const out: Array<{ t0: number; t1: number; text: string }> = [];
  for (const block of src.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = (lines[at] as string).split('-->');
    const t0 = ts(a ?? '');
    const t1 = ts(b ?? '');
    if (t0 === null || t1 === null || !(t1 > t0)) continue;
    out.push({
      t0,
      t1,
      text: lines
        .slice(at + 1)
        .join(' ')
        .trim(),
    });
  }
  return out;
}

function mergeRegions(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Build a `maude.transcript/1` sidecar from an old SRT (+ the bare whisper
 *  JSON when it exists — segment timing beats cue spreading). */
export function transcriptFromLegacy(
  asset: string,
  srt: string,
  whisperJson: string | null,
  createdAt: string
): { json: string; engine: 'whisper.cpp' | 'srt-import' } | null {
  let words: Word[] = [];
  let engine: 'whisper.cpp' | 'srt-import' = 'srt-import';
  const spans: Array<[number, number]> = [];
  if (whisperJson) {
    try {
      const doc = JSON.parse(whisperJson) as { transcription?: unknown };
      if (Array.isArray(doc.transcription)) {
        for (const s of doc.transcription as Array<{
          text?: unknown;
          offsets?: { from?: unknown; to?: unknown };
        }>) {
          const t = typeof s?.text === 'string' ? s.text.trim() : '';
          const from = Number(s?.offsets?.from);
          const to = Number(s?.offsets?.to);
          if (!t || !Number.isFinite(from) || !Number.isFinite(to)) continue;
          const t0 = round3(from / 1000);
          const t1 = Math.max(round3(to / 1000), round3(t0 + 0.001));
          words.push({ id: `w${words.length}`, t0, t1, text: t.slice(0, 64) });
          spans.push([t0, t1]);
        }
        engine = 'whisper.cpp';
      }
    } catch {
      words = [];
    }
  }
  if (engine === 'srt-import') {
    for (const cue of srtCues(srt)) {
      const parts = cue.text.split(/\s+/).filter(Boolean);
      if (!parts.length) continue;
      const d = (cue.t1 - cue.t0) / parts.length;
      parts.forEach((p, i) => {
        const t0 = round3(cue.t0 + i * d);
        const t1 = Math.max(round3(cue.t0 + (i + 1) * d), round3(t0 + 0.001));
        words.push({ id: `w${words.length}`, t0, t1, text: p.slice(0, 64) });
      });
      spans.push([round3(cue.t0), round3(cue.t1)]);
    }
  }
  if (!words.length) return null;
  words.sort((a, b) => a.t0 - b.t0);
  const transcript = {
    format: 'maude.transcript',
    v: 1,
    asset,
    engine:
      engine === 'whisper.cpp'
        ? { id: 'whisper.cpp', timing: 'segment' }
        : { id: 'srt-import', timing: 'cue' },
    words,
    speech: { source: 'words', regions: mergeRegions(spans) },
    createdAt,
  };
  return { json: `${JSON.stringify(transcript, null, 2)}\n`, engine };
}

const transcripts: MigrationStep = {
  id: 'transcripts.import',
  scope: ['assets/*.srt', 'assets/*.json'],
  forward(files, ctx) {
    const r = result();
    const media = new Set(ctx.list('assets/*'));
    for (const [rel, b] of files) {
      const m = rel.match(/^assets\/([A-Za-z0-9_-]+)\.srt$/);
      if (!m) continue;
      const base = m[1] as string;
      const out = `assets/${base}.transcript.json`;
      if (files.has(out)) continue;
      const source = MEDIA_EXTS.map((e) => `assets/${base}.${e}`).find((p) => media.has(p));
      if (!source) {
        r.notes.push(`${rel}: no source media beside it — no transcript written`);
        continue;
      }
      const bareRel = `assets/${base}.json`;
      const bare = files.get(bareRel);
      const t = transcriptFromLegacy(
        source,
        text(b),
        bare ? text(bare) : null,
        ctx.now.toISOString()
      );
      if (!t) {
        r.notes.push(`${rel}: no words in it — no transcript written`);
        continue;
      }
      r.writes.set(out, bytes(t.json));
      if (bare && t.engine === 'whisper.cpp') r.writes.set(bareRel, null); // → _trash/migrate-v2/
    }
    return r;
  },
  // Exact reverse comes from the forward run's record (engine): it deletes the
  // transcripts it wrote and puts the bare dumps back. Without that record
  // there is nothing to tell a migrated transcript from a real one.
  reverse: () => result(),
};

// ─── ds.tokens ───────────────────────────────────────────────────────────────

function designSystems(config: Record<string, unknown>): DsSystemEntry[] {
  const list = Array.isArray(config.designSystems) ? config.designSystems : [];
  const out: DsSystemEntry[] = [];
  for (const d of list as Array<Record<string, unknown>>) {
    if (typeof d?.name !== 'string' || typeof d.path !== 'string') continue;
    const p = d.path.replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((s) => s === '..' || s === '')) continue;
    out.push({
      name: d.name,
      path: p,
      tokensCssRel:
        typeof d.tokensCssRel === 'string' ? d.tokensCssRel : `${p}/colors_and_type.css`,
    });
  }
  return out;
}

const dsTokens: MigrationStep = {
  id: 'ds.tokens',
  scope: [],
  forward(_files, ctx) {
    const r = result();
    if (!ctx.ds) return { ...r, skip: DS_EMITTER_PENDING };
    for (const sys of designSystems(ctx.config)) {
      const rel = `${sys.path}/tokens.json`;
      if (ctx.read(rel)) continue;
      const e = ctx.ds.emitTokens({
        designRoot: ctx.designRoot,
        system: sys,
        read: (p) => ctx.read(p),
      });
      if ('refused' in e) r.notes.push(`${sys.name}: ${e.refused}`);
      else r.writes.set(rel, e.bytes);
    }
    return r;
  },
  reverse(_files, ctx) {
    const r = result();
    if (!ctx.ds) return r;
    for (const sys of designSystems(ctx.config)) {
      const rel = `${sys.path}/tokens.json`;
      const cur = ctx.read(rel);
      if (!cur) continue;
      const e = ctx.ds.emitTokens({
        designRoot: ctx.designRoot,
        system: sys,
        read: (p) => ctx.read(p),
      });
      if ('bytes' in e && sha256(e.bytes) === sha256(cur)) r.writes.set(rel, null);
    }
    return r;
  },
};

/** Format 1 → 2, in order. */
export const STEPS: readonly MigrationStep[] = [
  marker,
  annotations,
  meta,
  comps,
  chats,
  transcripts,
  dsTokens,
];
