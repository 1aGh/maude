// check/index.ts — `maude design check` (contract V2-1.11 §5.2/§5.3, V2-1.18 §5.3): validate the
// files Claude writes, by kind, in one place. The PostToolUse hook runs the fast tier on every
// write (budget ≤ 1.5 s p95 incl. spawn) and restores the file on an error; Stop runs the stop tier.
//
//   checkFile(rel, text, { against?, tier?, strict? }) → CheckResult
//   CheckResult = { file, kind, ok, ms, errors, warnings, infos }   (V2-1.18 §5.3 `--json` row)
//   Finding     = { code, where, what, fix, line?, element? }
//
// `errors` block (the hook rolls the write back); `warnings` go back to the model and never block;
// `infos` land in the run result. One parse per file per call.
//
// What each kind checks today (V2-2.4b step 1); the strict formats (§5.2 schemas, validateBoard
// strict, canvas-meta v2) land in step 3 and slot into the same dispatch:
//   canvas-tsx   parse (oxc); DCArtboard ids present + unique; V2-1.4 ids against the snapshot
//                (V2-2.19 checkIds — ./ids.ts adapter, a stub until it lands on feat)
//   annotations  every lenient-loader drop is an error (strict) / a warning (lenient)
//   canvas-meta  JSON object; no `viewport` (DDR-115: the camera is runtime state)
//   handoff      JSON object with the `maude.agent-handoff/1` contract + role (schema in step 4)
//   json kinds   parse
//   runtime `_*` (other than hand-offs), files outside the design root, everything else: skipped
//
// Bun only (oxc-parser). No fs: callers read the bytes, so the hook can check exactly what was
// written and the studio's warm validator can check a body it was sent.

import { parseSync } from 'oxc-parser';

import { parseBoard } from '../annotations/schema.ts';
import { checkIdsAdapter } from './ids.ts';

export type CheckKind =
  | 'canvas-tsx'
  | 'annotations'
  | 'canvas-meta'
  | 'edl'
  | 'footage'
  | 'photo-edit'
  | 'ds'
  | 'ds-managed'
  | 'design-config'
  | 'handoff'
  | 'json'
  | 'skip';

export interface Finding {
  code: string;
  where: string;
  what: string;
  fix: string;
  line?: number;
  element?: { tag: string; label: string; artboard: string | null };
}

export interface CheckResult {
  file: string;
  kind: CheckKind;
  ok: boolean;
  ms: number;
  errors: Finding[];
  warnings: Finding[];
  infos: Finding[];
}

export interface CheckOptions {
  /** the bytes before the edit (snapshot / run base); null or absent = a new file */
  against?: string | null;
  tier?: 'fast' | 'stop';
  /** AI writes are strict: a lenient-loader drop is an error, not a warning */
  strict?: boolean;
}

/** The check kind of a designRoot-relative POSIX path (V2-1.18 §5.3 "Kind (by path)"). Pure. */
export function kindOf(rel: string): CheckKind {
  if (/^_runs\/(?:[^/]+\/)+handoff\/[^/]+\.(?:in|out)\.json$/.test(rel)) return 'handoff';
  const segs = rel.split('/');
  if (segs.some((s) => s.startsWith('_')) || segs.some((s) => s === '..' || s === ''))
    return 'skip';
  if (rel === 'config.json') return 'design-config';
  if (segs[0] === 'system' && segs.length >= 3) {
    if (segs[2] === 'revisions' || segs[segs.length - 1] === 'head.json') return 'ds-managed';
    if (rel.endsWith('.json') || rel.endsWith('.css')) return 'ds';
  }
  if (rel.endsWith('.annotations.json')) return 'annotations';
  if (rel.endsWith('.meta.json')) return 'canvas-meta';
  if (rel.endsWith('.edl.json')) return 'edl';
  if (rel.endsWith('.footage.json')) return 'footage';
  if (rel.endsWith('.photo.json')) return 'photo-edit';
  if (rel.endsWith('.tsx') && segs[0] !== 'system') return 'canvas-tsx';
  if (rel.endsWith('.json')) return 'json';
  return 'skip';
}

const finding = (code: string, where: string, what: string, fix: string, line?: number): Finding =>
  line === undefined ? { code, where, what, fix } : { code, where, what, fix, line };

function lineAt(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

type Node = { type?: string; start?: number; [k: string]: unknown };

/** Every `<DCArtboard …>` opening element with its literal `id` (or why it has none). */
function artboardsOf(program: unknown): { id: string | null; start: number; dynamic: boolean }[] {
  const out: { id: string | null; start: number; dynamic: boolean }[] = [];
  const stack: unknown[] = [program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    const node = n as Node;
    if (node.type === 'JSXOpeningElement') {
      const name = node.name as Node & { name?: string };
      if (name?.type === 'JSXIdentifier' && name.name === 'DCArtboard') {
        const attrs = (node.attributes as Node[] | undefined) ?? [];
        const idAttr = attrs.find(
          (a) => a.type === 'JSXAttribute' && (a.name as Node & { name?: string })?.name === 'id'
        );
        const value = idAttr?.value as (Node & { value?: unknown }) | undefined;
        if (!idAttr) out.push({ id: null, start: node.start ?? 0, dynamic: false });
        else if (value?.type === 'Literal' && typeof value.value === 'string')
          out.push({ id: value.value, start: node.start ?? 0, dynamic: false });
        else out.push({ id: null, start: node.start ?? 0, dynamic: true });
      }
    }
    for (const k in node) {
      if (k === 'parent') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function checkCanvasTsx(rel: string, text: string, opts: CheckOptions, r: CheckResult) {
  const parsed = parseSync(rel, text, { sourceType: 'module', lang: 'tsx' });
  if (parsed.errors.length) {
    const e = parsed.errors[0] as { message?: string; labels?: { start?: number }[] };
    const line = lineAt(text, e.labels?.[0]?.start ?? 0);
    r.errors.push(
      finding(
        'parse',
        `${rel}:${line}`,
        `the file does not parse: ${e.message ?? 'syntax error'}`,
        'fix the syntax error this edit introduced',
        line
      )
    );
    return;
  }
  const seen = new Map<string, number>();
  for (const ab of artboardsOf(parsed.program)) {
    const line = lineAt(text, ab.start);
    if (ab.id === null) {
      r.errors.push(
        finding(
          ab.dynamic ? 'artboard-id-expression' : 'artboard-id-missing',
          `${rel}:${line}`,
          ab.dynamic ? 'a DCArtboard id must be a plain string' : 'a DCArtboard has no id',
          'write id="kebab-name" on the DCArtboard',
          line
        )
      );
      continue;
    }
    const first = seen.get(ab.id);
    if (first !== undefined)
      r.errors.push(
        finding(
          'artboard-duplicate',
          `${rel}:${line} #${ab.id}`,
          `two artboards have id="${ab.id}" (the first is on line ${first})`,
          'give this artboard its own id',
          line
        )
      );
    else seen.set(ab.id, line);
  }
  const ids = checkIdsAdapter(text, { against: opts.against ?? undefined, path: rel });
  for (const f of ids.findings) {
    const out: Finding = { code: f.code, where: f.where, what: f.what, fix: f.fix, line: f.line };
    if (f.element) out.element = f.element;
    (f.severity === 'error' ? r.errors : r.infos).push(out);
  }
}

function parseJson(rel: string, text: string, r: CheckResult): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    r.errors.push(
      finding('json', rel, `not valid JSON: ${(e as Error).message}`, 'write valid JSON')
    );
    return undefined;
  }
}

function checkAnnotations(rel: string, text: string, opts: CheckOptions, r: CheckResult) {
  const board = parseBoard(text);
  for (const d of board.dropped) {
    const where = d.id ? `${rel} › ${d.id}` : rel;
    const f = finding(
      'board-drop',
      where,
      `the board loader drops this: ${d.reason}`,
      'write the element in the documented shape (skill design:whiteboard)'
    );
    (opts.strict ? r.errors : r.warnings).push(f);
  }
}

function checkMeta(rel: string, text: string, r: CheckResult) {
  const doc = parseJson(rel, text, r);
  if (doc === undefined) return;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    r.errors.push(finding('meta-shape', rel, 'a .meta.json is a JSON object', 'write an object'));
    return;
  }
  if ('viewport' in (doc as Record<string, unknown>))
    r.errors.push(
      finding(
        'meta-viewport',
        `${rel} › viewport`,
        'the camera is per-person runtime state, never in the versioned .meta.json (DDR-115)',
        'remove `viewport`'
      )
    );
}

function checkHandoff(rel: string, text: string, r: CheckResult) {
  const doc = parseJson(rel, text, r) as Record<string, unknown> | undefined;
  if (doc === undefined) return;
  const role = rel.endsWith('.in.json') ? 'in' : 'out';
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    r.errors.push(finding('handoff-shape', rel, 'a hand-off is a JSON object', 'write an object'));
  else if (doc.contract !== 'maude.agent-handoff/1' || doc.role !== role)
    r.errors.push(
      finding(
        'handoff-contract',
        rel,
        `a .${role}.json hand-off declares contract "maude.agent-handoff/1" and role "${role}"`,
        `set "contract": "maude.agent-handoff/1", "role": "${role}"`
      )
    );
}

/** Check one file's bytes. Never throws: an internal failure is an `internal` warning. */
export function checkFile(rel: string, text: string, opts: CheckOptions = {}): CheckResult {
  const t0 = performance.now();
  const kind = kindOf(rel);
  const r: CheckResult = { file: rel, kind, ok: true, ms: 0, errors: [], warnings: [], infos: [] };
  try {
    if (kind === 'canvas-tsx') checkCanvasTsx(rel, text, opts, r);
    else if (kind === 'annotations') checkAnnotations(rel, text, opts, r);
    else if (kind === 'canvas-meta') checkMeta(rel, text, r);
    else if (kind === 'handoff') checkHandoff(rel, text, r);
    else if (kind === 'ds-managed')
      r.errors.push(
        finding(
          'ds-managed',
          rel,
          'design-system revisions are written by the review verbs, never by hand',
          'change the system through `maude design ds-upgrade` or the DS review'
        )
      );
    else if (rel.endsWith('.json') && kind !== 'skip') parseJson(rel, text, r);
  } catch (e) {
    r.warnings.push(
      finding('internal', rel, `the check itself failed: ${(e as Error).message}`, 'report a bug')
    );
  }
  r.ok = r.errors.length === 0;
  r.ms = Math.round((performance.now() - t0) * 10) / 10;
  return r;
}

/** `[code] where · what · fix` lines — what the hook's block reason and the CLI print. */
export function formatFindings(results: readonly CheckResult[]): string {
  const lines: string[] = [];
  for (const r of results)
    for (const [label, list] of [
      ['error', r.errors],
      ['warning', r.warnings],
    ] as const)
      for (const f of list) lines.push(`${label} [${f.code}] ${f.where} · ${f.what} · ${f.fix}`);
  return lines.join('\n');
}
