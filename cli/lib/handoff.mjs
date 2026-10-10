// handoff.mjs — validate a `maude.agent-handoff/1` document (contract V2-1.18 §5.2; V2-2.4b).
//
//   validateHandoff(doc, { role?, runDir? }) → { ok, role, errors: [{ where, what, fix }] }   never throws
//   readHandoff(abs, { role?, root? })       → { ok, doc, role, runDir, errors }            never throws
//   ownsPath(doc, repoRel)           → boolean — is `repoRel` inside one of the doc's `owns` globs
//   isBoundedWriter(agent)           → boolean — may this agent own paths outside its run folder
//   criticVerdictToHandoff(verdict, { agent?, runId?, n? }) / handoffToCriticVerdict(out)
//
// The schema is cli/lib/handoff.schema.json (the shipped copy of the V2-1.18 prototype). One
// validator, two callers: `maude design check` (kind `handoff`) and the SubagentStop hook. Rules on
// top of the schema:
//   - role "in": every `owns` glob sits under the run folder the hand-off itself lives in (`runDir`,
//     repo-relative, e.g. `.design/_runs/<session>/` — the hooks key run folders by Claude Code's
//     session id, so the folder, not `runId`, is the anchor) unless the agent is a declared bounded
//     writer (V2-1.18 §5.5 — it writes a NEW file nobody else edits). No `runDir` → rule skipped;
//   - `result` ≤ 64 KB serialised;
//   - a `role` option pins the role (the file suffix `.in.json` / `.out.json`).
//
// Leaf module: node built-ins + json-schema-lite.mjs + pkg-root.mjs — the hooks import it in-process.

import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { compileSchema } from './json-schema-lite.mjs';
import { resolvePkgRoot } from './pkg-root.mjs';

export const HANDOFF_CONTRACT = 'maude.agent-handoff/1';
export const HANDOFF_SCHEMA_REL = 'cli/lib/handoff.schema.json';
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_ERRORS = 20;
const FIX = 'match maude.agent-handoff/1 (cli/lib/handoff.schema.json)';

/** V2-1.18 §5.5: writers of NEW files, spawned with a hand-off naming that file in `owns`. */
const BOUNDED_WRITERS = new Set([
  'design:draw-agent',
  'design:footage-director',
  'design:reconstruct-agent',
  'design:ds-migrator',
  'ds-migrator',
]);
export const isBoundedWriter = (agent) => typeof agent === 'string' && BOUNDED_WRITERS.has(agent);

let schemaCache = null;
export function handoffSchema() {
  schemaCache ??= JSON.parse(readFileSync(join(resolvePkgRoot(), HANDOFF_SCHEMA_REL), 'utf8'));
  return schemaCache;
}

let validators = null;
function compiled() {
  if (!validators) {
    const s = handoffSchema();
    validators = {
      in: compileSchema(s, { ref: '#/$defs/in' }),
      out: compileSchema(s, { ref: '#/$defs/out' }),
    };
  }
  return validators;
}

const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Glob → RegExp: `**` spans segments, `*` stays inside one, `?` is one character. */
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/** Is the repo-relative POSIX path `repoRel` (".design/…") inside one of `doc.owns`? */
export function ownsPath(doc, repoRel) {
  if (!isRec(doc) || !Array.isArray(doc.owns) || typeof repoRel !== 'string') return false;
  const rel = norm(repoRel);
  if (rel.startsWith('/') || rel.split('/').includes('..')) return false;
  return doc.owns.some((g) => typeof g === 'string' && globRe(norm(g)).test(rel));
}

/** Every concrete path a glob could match starts with this (up to its first wildcard). */
const staticPrefix = (g) => norm(g).split(/[*?]/)[0];

export function validateHandoff(doc, { role, runDir } = {}) {
  const errors = [];
  const add = (where, what, fix = FIX) => {
    if (errors.length < MAX_ERRORS) errors.push({ where, what, fix });
  };
  if (!isRec(doc)) {
    add('/', 'a hand-off is a JSON object', 'write an object');
    return { ok: false, role: null, errors };
  }
  if (doc.contract !== HANDOFF_CONTRACT) add('/contract', `must be "${HANDOFF_CONTRACT}"`);
  const declared = doc.role === 'in' || doc.role === 'out' ? doc.role : null;
  if (!declared) add('/role', 'must be "in" or "out"');
  if (role && declared && declared !== role)
    add('/role', `this is a .${role}.json file, so "role" is "${role}"`, `set "role": "${role}"`);
  const r = role ?? declared;
  if (errors.length || !r) return { ok: false, role: r ?? null, errors };

  let schemaErrors;
  try {
    schemaErrors = compiled()[r](doc);
  } catch (e) {
    add('/', `the hand-off schema could not be loaded: ${e?.message ?? e}`, 'reinstall maude');
    return { ok: false, role: r, errors };
  }
  const seen = new Set();
  for (const e of schemaErrors) {
    const line = `${e.path || '/'} ${e.message}`;
    if (seen.has(line)) continue;
    seen.add(line);
    add(e.path || '/', e.message);
  }
  if (
    r === 'in' &&
    Array.isArray(doc.owns) &&
    typeof runDir === 'string' &&
    !isBoundedWriter(doc.agent)
  ) {
    const run = `${norm(runDir).replace(/\/?$/, '')}/`;
    doc.owns.forEach((g, i) => {
      if (typeof g === 'string' && !staticPrefix(g).startsWith(run))
        add(
          `/owns/${i}`,
          `"${g}" is outside the run folder — ${doc.agent} may write only under ${run}`,
          `own paths under ${run} (only a declared bounded writer owns a new file elsewhere)`
        );
    });
  }
  if (doc.result !== undefined) {
    let size = 0;
    try {
      size = JSON.stringify(doc.result).length;
    } catch {
      size = Number.POSITIVE_INFINITY;
    }
    if (size > MAX_RESULT_BYTES)
      add('/result', 'exceeds 64 KB serialised', 'put large payloads in a file the hand-off names');
  }
  return { ok: errors.length === 0, role: r, errors };
}

/** `<root>/…/_runs/<key>/handoff/<file>` → `…/_runs/<key>/` relative to root (POSIX), else null. */
export function runDirOf(abs, root) {
  if (typeof abs !== 'string' || typeof root !== 'string') return null;
  const rel = relative(root, abs).split(sep).join('/');
  const m = /^((?:[^/]+\/)*_runs\/[^/]+\/)handoff\/[^/]+$/.exec(rel);
  return m && !rel.startsWith('..') ? m[1] : null;
}

export function readHandoff(abs, { role, root } = {}) {
  const runDir = runDirOf(abs, root);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return {
      ok: false,
      doc: null,
      role: role ?? null,
      runDir,
      errors: [
        {
          where: abs,
          what: 'the hand-off file does not exist',
          fix: 'write it to the `output` path of your hand-off',
        },
      ],
    };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      doc: null,
      role: role ?? null,
      runDir,
      errors: [{ where: abs, what: `not valid JSON: ${e?.message ?? e}`, fix: 'write valid JSON' }],
    };
  }
  return { ...validateHandoff(doc, { role, runDir: runDir ?? undefined }), doc, runDir };
}

// ── critics (V2-1.18 §5.5, S12): today's JSON verdict ↔ HandoffOut.findings[] ────────────────

/** A critic's `{agent, blockers, warnings, top_blockers[], passed, …}` verdict as a HandoffOut. */
export function criticVerdictToHandoff(verdict, { agent, runId, n } = {}) {
  const v = isRec(verdict) ? verdict : {};
  const name =
    agent ??
    (typeof v.agent === 'string'
      ? v.agent.includes(':')
        ? v.agent
        : `design:${v.agent}`
      : 'design:design-critic');
  const findings = (Array.isArray(v.top_blockers) ? v.top_blockers : []).filter(isRec).map((b) => ({
    severity: 'blocker',
    ...(b.category !== undefined || b.line !== undefined
      ? { where: `${b.category ?? ''}${b.line !== undefined ? `:${b.line}` : ''}` }
      : {}),
    what: String(b.summary ?? ''),
    ...(b.fix !== undefined ? { fix: String(b.fix) } : {}),
  }));
  const blockers = Number.isInteger(v.blockers) ? v.blockers : findings.length;
  const warnings = Number.isInteger(v.warnings) ? v.warnings : 0;
  const passed = typeof v.passed === 'boolean' ? v.passed : blockers === 0;
  return {
    contract: HANDOFF_CONTRACT,
    role: 'out',
    ...(runId ? { runId } : {}),
    agent: name,
    ...(n !== undefined ? { n } : {}),
    status: 'done',
    summary: `${blockers} blocker${blockers === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} — ${passed ? 'passed' : 'not passed'}`,
    changed: [],
    decisions: [],
    findings,
    open_questions: [],
    result: {
      verdict: { blockers, warnings, passed, ...(v.iter !== undefined ? { iter: v.iter } : {}) },
    },
  };
}

/** The inverse: the verdict fields the auto-fix loop reads, back from a HandoffOut. */
export function handoffToCriticVerdict(out) {
  const o = isRec(out) ? out : {};
  const meta = isRec(o.result) && isRec(o.result.verdict) ? o.result.verdict : {};
  const top = (Array.isArray(o.findings) ? o.findings : [])
    .filter((f) => isRec(f) && f.severity === 'blocker')
    .map((f) => {
      const [category, line] =
        typeof f.where === 'string' ? f.where.split(':') : [undefined, undefined];
      return {
        ...(category ? { category } : {}),
        ...(line !== undefined && line !== '' && Number.isFinite(Number(line))
          ? { line: Number(line) }
          : {}),
        summary: f.what,
        ...(f.fix !== undefined ? { fix: f.fix } : {}),
      };
    });
  return {
    agent: typeof o.agent === 'string' ? o.agent.replace(/^design:/, '') : 'design-critic',
    ...(meta.iter !== undefined ? { iter: meta.iter } : {}),
    blockers: Number.isInteger(meta.blockers) ? meta.blockers : top.length,
    warnings: Number.isInteger(meta.warnings) ? meta.warnings : 0,
    top_blockers: top,
    passed: typeof meta.passed === 'boolean' ? meta.passed : top.length === 0,
  };
}
