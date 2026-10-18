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
// What each kind checks (the §5.2 formats; schemas under apps/studio/schema/):
//   canvas-tsx   parse (oxc); DCArtboard ids present + unique; V2-1.4 ids against the snapshot
//                (V2-2.19 checkIds — ./ids.ts adapter)
//   annotations  strict: validateBoard (annotations/validate-board.ts) — every lenient-loader drop,
//                unknown field / unrepairable value (the generated annotations.v2 schema), unknown
//                type, author change, a new element not authored by AI, a locked element changed or
//                removed; lenient: the loader's drops as warnings (unchanged)
//   canvas-meta  JSON object; no `viewport` (DDR-115); strict: the canvas-meta.v2 schema on the keys
//                the write changed + `dsRev` unchanged (./meta.ts)
//   edl/footage  strict: validateEdl / validateFootageAnalysis (footage/schema.ts — the runtime source
//                the edl.v1 schema mirrors); lenient: parse
//   gen          strict: validateGen (generation/gen-sidecar.ts — lenient on unknown keys; the gen.v1
//                schema mirrors it); lenient: parse
//   transcript/beats  strict: validateTranscript / validateBeats in writer mode (video/schema.ts, S7.1 —
//                preserving: an unknown key is never a finding); lenient: parse
//   handoff      maude.agent-handoff/1 of the role the file name declares (cli/lib/handoff.mjs)
//   json kinds   parse
//   runtime `_*` (other than hand-offs), files outside the design root, everything else: skipped
//
// Text that came out of the checked file (an artboard id, a .meta.json key, a board element id,
// a hand-off field) reaches the model in the hook's block reason, so it is quoted and capped where
// the finding is built (cli/lib/finding-text.mjs `fileText`), an artboard id that is not an id is
// named by its line only, and every finding is cleaned once more on the way out (`cleanFinding`).
//
// Bun only (oxc-parser). No fs: callers read the bytes, so the hook can check exactly what was
// written and the studio's warm validator can check a body it was sent.

import { parseSync } from 'oxc-parser';

import { cleanFinding, cleanText, fileText, findingLine } from '../../../cli/lib/finding-text.mjs';
import { validateHandoff } from '../../../cli/lib/handoff.mjs';
import { jsonEq } from '../annotations/fields.ts';
import { validateBoard } from '../annotations/validate-board.ts';
import { isValidElementId } from '../element-ids.ts';
import { validateEdl, validateFootageAnalysis } from '../footage/schema.ts';
import { validateGen } from '../generation/gen-sidecar.ts';
import { presentIdIssues } from '../present/meta-schema.ts';
import { validateBeats, validateTranscript } from '../video/schema.ts';
import { checkIdsAdapter } from './ids.ts';
import { validateMeta } from './meta.ts';

export type CheckKind =
  | 'canvas-tsx'
  | 'annotations'
  | 'canvas-meta'
  | 'edl'
  | 'footage'
  | 'transcript'
  | 'beats'
  | 'photo-edit'
  | 'gen'
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
  /** S3.10a: another canvas's artboard ids (null = not in the project) — judges `link-dangling` */
  canvasArtboards?: (canvas: string) => readonly string[] | null;
  /** S3.5 — a `.meta.json`'s canvas artboards (`artboardIdsOfSource` of the sibling `.tsx`), for the
   *  Present id rule; absent = only the duplicate half runs. */
  artboards?: { ids: readonly string[]; complete: boolean } | null;
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
  if (rel.endsWith('.transcript.json')) return 'transcript';
  if (rel.endsWith('.beats.json')) return 'beats';
  if (rel.endsWith('.photo.json')) return 'photo-edit';
  if (rel.endsWith('.gen.json')) return 'gen';
  if (rel.endsWith('.tsx') && segs[0] !== 'system') return 'canvas-tsx';
  if (rel.endsWith('.json')) return 'json';
  return 'skip';
}

/** The studio's artboard-id rule (routes/agent.ts AGENT_ID_RE — a test holds them equal). */
export const ARTBOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

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

/** S3.5 — the artboard ids a canvas source declares, for a sibling `.meta.json`'s Present rule.
 *  `complete: false` when an artboard's id is not a literal (a parse cannot list it). Null = no parse. */
export function artboardIdsOfSource(
  rel: string,
  text: string
): { ids: string[]; complete: boolean } | null {
  try {
    const parsed = parseSync(rel, text, { sourceType: 'module', lang: 'tsx' });
    if (parsed.errors.length) return null;
    const abs = artboardsOf(parsed.program);
    return {
      ids: abs.flatMap((a) => (a.id ? [a.id] : [])),
      complete: abs.every((a) => a.id !== null),
    };
  } catch {
    return null;
  }
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
        `the file does not parse: ${cleanText(e.message ?? 'syntax error', 160)}`,
        'fix the syntax error this edit introduced',
        line
      )
    );
    return;
  }
  const seen = new Map<string, number>();
  let before: Set<string> | null = null; // the snapshot's artboard ids, parsed only when needed
  const hadBefore = (id: string) => {
    if (before === null) {
      before = new Set();
      if (typeof opts.against === 'string') {
        const p = parseSync(rel, opts.against, { sourceType: 'module', lang: 'tsx' });
        if (!p.errors.length) for (const a of artboardsOf(p.program)) if (a.id) before.add(a.id);
      }
    }
    return before.has(id);
  };
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
    if (!ARTBOARD_ID_RE.test(ab.id)) {
      // never echo it: the id is file text, and this one is not an id. One the snapshot already
      // had (a peer's, a clone's) is a warning — the model never sees warnings in a block reason.
      (hadBefore(ab.id) ? r.warnings : r.errors).push(
        finding(
          'artboard-id-format',
          `${rel}:${line}`,
          `the DCArtboard id on line ${line} is not a valid id`,
          'write id="kebab-name" (letters, digits, - _ . : — at most 128) on the DCArtboard',
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
          `${rel}:${line} #${cleanText(ab.id, 60)}`,
          `two artboards have id=${fileText(ab.id)} (the first is on line ${first})`,
          'give this artboard its own id',
          line
        )
      );
    else seen.set(ab.id, line);
  }
  const ids = checkIdsAdapter(text, {
    against: opts.against ?? undefined,
    path: rel,
    canvasArtboards: opts.canvasArtboards,
  });
  for (const f of ids.findings) {
    // an element id that is not an id is file text: drop it, the line names the element
    const raw = typeof f.id === 'string' && !isValidElementId(f.id) ? f.id : null;
    const strip = (s: string) => (raw ? s.split(raw).join('(an invalid id)') : s);
    const out: Finding = {
      code: f.code,
      where: strip(f.where),
      what: strip(f.what),
      fix: f.fix,
      line: f.line,
    };
    if (f.element) out.element = f.element;
    (f.severity === 'error' ? r.errors : f.severity === 'warning' ? r.warnings : r.infos).push(out);
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
  const v = validateBoard(text, { strict: opts.strict === true, against: opts.against });
  for (const [list, into] of [
    [v.errors, r.errors],
    [v.warnings, r.warnings],
  ] as const)
    for (const i of list) {
      const where = `${rel}${i.id ? ` › ${fileText(i.id)}` : ''}${i.field && i.field !== '/' ? ` ${fileText(i.field)}` : ''}`;
      into.push(finding(i.code, where, i.what, i.fix));
    }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function checkMeta(rel: string, text: string, opts: CheckOptions, r: CheckResult) {
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
  checkPresentIds(rel, doc as Record<string, unknown>, opts, r);
  if (!opts.strict) return;
  let before: unknown = null;
  try {
    before = typeof opts.against === 'string' ? JSON.parse(opts.against) : null;
  } catch {
    before = null;
  }
  for (const i of validateMeta(doc as Record<string, unknown>, isObj(before) ? before : null))
    r.errors.push(finding(i.code, `${rel} › ${fileText(i.field.slice(1) || '/')}`, i.what, i.fix));
}

/** S3.5 (V2-1.12 R6, S3-present-session §7) — Present ids: a duplicate in `present.order` /
 *  `present.skip`, and an id (there or carrying a note) that is not an artboard of the canvas. A
 *  dangling id is legal on disk (the artboard was deleted; Present drops it), so it is a warning —
 *  an error only for a strict (AI) write that changed that key. A strict duplicate is the schema's
 *  `uniqueItems` error, so it is not reported twice. */
function checkPresentIds(
  rel: string,
  doc: Record<string, unknown>,
  opts: CheckOptions,
  r: CheckResult
) {
  const ab = opts.artboards;
  const issues = presentIdIssues(doc, ab?.complete ? new Set(ab.ids) : null);
  let before: Record<string, unknown> | null = null;
  try {
    const b = typeof opts.against === 'string' ? JSON.parse(opts.against) : null;
    before = isObj(b) ? b : null;
  } catch {
    before = null;
  }
  const changed = (key: string) => !before || !jsonEq(before[key], doc[key]);
  if (!opts.strict)
    for (const d of issues.duplicates)
      r.warnings.push(
        finding(
          'present-duplicate',
          `${rel} › present.${d.list}`,
          `${fileText(d.id)} is listed twice`,
          'list each artboard once'
        )
      );
  for (const u of issues.unknown) {
    const f = finding(
      'present-unknown-artboard',
      `${rel} › ${fileText(u.where)}`,
      `${fileText(u.id)} is not an artboard of this canvas`,
      'use the id of a <DCArtboard> in the .tsx, or remove it (skill design:design _guide-17)'
    );
    const key = u.where.startsWith('present.') ? 'present' : 'artboardMeta';
    (opts.strict && changed(key) ? r.errors : r.warnings).push(f);
  }
}

function checkHandoff(rel: string, text: string, r: CheckResult) {
  const doc = parseJson(rel, text, r);
  if (doc === undefined) return;
  const role = rel.endsWith('.in.json') ? 'in' : 'out';
  // `rel` is designRoot-relative; `owns` are repo-relative, and the design root is `.design/` (the
  // same convention bin/_check.mjs resolves the project by).
  const runDir = `.design/${rel.replace(/handoff\/[^/]+$/, '')}`;
  const v = validateHandoff(doc, { role, runDir }) as {
    errors: { where: string; what: string; fix: string }[];
  };
  for (const e of v.errors)
    r.errors.push(
      finding(
        'handoff',
        `${rel} › ${fileText(e.where.replace(/^\//, '') || '/')}`,
        cleanText(e.what, 200),
        cleanText(e.fix, 200)
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
    else if (kind === 'canvas-meta') checkMeta(rel, text, opts, r);
    else if (kind === 'handoff') checkHandoff(rel, text, r);
    else if ((kind === 'edl' || kind === 'footage') && opts.strict) {
      const doc = parseJson(rel, text, r);
      if (doc !== undefined)
        for (const e of (kind === 'edl' ? validateEdl : validateFootageAnalysis)(doc).errors)
          r.errors.push(
            finding(
              kind,
              `${rel} › ${fileText(e.split(':')[0])}`,
              cleanText(e, 200),
              kind === 'edl'
                ? 'write the EDL in the documented shape (apps/studio/schema/edl.v1.schema.json, skill design:footage-director)'
                : 'write the analysis in the documented shape (skill design:footage-director)'
            )
          );
    } else if (kind === 'gen' && opts.strict) {
      const doc = parseJson(rel, text, r);
      if (doc !== undefined)
        for (const e of validateGen(doc).errors)
          r.errors.push(
            finding(
              'gen',
              `${rel} › ${fileText(e.split(':')[0])}`,
              cleanText(e, 200),
              'write the provenance in the documented shape (apps/studio/schema/gen.v1.schema.json, skill design:ai-generation)'
            )
          );
    } else if ((kind === 'transcript' || kind === 'beats') && opts.strict) {
      const doc = parseJson(rel, text, r);
      const validate = kind === 'transcript' ? validateTranscript : validateBeats;
      if (doc !== undefined)
        for (const e of validate(doc, { strict: true, rel }).errors)
          r.errors.push(
            finding(
              kind,
              `${rel} › ${fileText(e.split(':')[0])}`,
              cleanText(e, 200),
              `write the ${kind} in the documented shape (apps/studio/schema/${kind}.v1.schema.json, skill design:video-comp)`
            )
          );
    } else if (kind === 'ds-managed')
      r.errors.push(
        finding(
          'ds-managed',
          rel,
          'design-system revisions and head.json are written by the DS engine, never by hand',
          'change the system with `maude design ds` (pending --set, publish, keep, undo, pick) or the DS review'
        )
      );
    else if (rel.endsWith('.json') && kind !== 'skip') parseJson(rel, text, r);
  } catch (e) {
    r.warnings.push(
      finding('internal', rel, `the check itself failed: ${(e as Error).message}`, 'report a bug')
    );
  }
  r.errors = r.errors.map(cleanFinding);
  r.warnings = r.warnings.map(cleanFinding);
  r.infos = r.infos.map(cleanFinding);
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
      for (const f of list) lines.push(findingLine(f, label));
  return lines.join('\n');
}
