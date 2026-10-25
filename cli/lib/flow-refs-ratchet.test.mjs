// Flow refactor guardrail 1 — deprecate before deleting, and never leave a dangling reference.
// Every `flow:<name>` reference in shipped text (plugins, CLI, the init skeleton, site docs,
// README, CLAUDE.md) must resolve to a command, a skill folder or an agent of the flow plugin.
// A retired command stays as a stub until a later release removes it AND its references.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const FLOW = 'plugins/flow';
const names = (dir, ext) =>
  readdirSync(join(FLOW, dir))
    .filter((f) => (ext ? f.endsWith(ext) : statSync(join(FLOW, dir, f)).isDirectory()))
    .map((f) => (ext ? f.slice(0, -ext.length) : f));
const COMMANDS = new Set(names('commands', '.md'));
const SKILLS = new Set(names('skills'));
const AGENTS = new Set(names('agents', '.md'));
// Placeholders used in prose ("`flow:role` agent", "`$flow:skill-name`").
// `flow:flow` is the doubled-namespace example in the naming test's prose; `source-command-verb`
// is the Codex mirror pattern.
const PLACEHOLDERS = new Set([
  'role',
  'verb',
  'skill-name',
  'name',
  'x',
  'cmd',
  'new',
  'old',
  'flow',
  'source-command-verb',
]);

const ROOTS = ['plugins', 'cli', 'site/content', 'README.md', 'CLAUDE.md', 'apps/studio/actions'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'archive']);
const EXT = /\.(md|mdx|mjs|js|ts|tsx|json|ya?ml|sh)$/;

function* files(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) {
    // Tests carry synthetic fixtures (other plugins' `flow:review` agents etc.), changelogs are history.
    if (EXT.test(p) && !/CHANGELOG\.md$/.test(p) && !/\.test\.[mc]?[jt]sx?$/.test(p)) yield p;
    return;
  }
  for (const e of readdirSync(p)) if (!SKIP_DIR.has(e)) yield* files(join(p, e));
}

/** Dangling `flow:<name>` references in a text: `path:line name`. */
export function dangling(path, text) {
  const out = [];
  let history = false; // a `## … history` section lists names that no longer resolve, on purpose
  text.split('\n').forEach((line, i) => {
    if (/^##\s/.test(line)) history = /history/i.test(line);
    if (history) return;
    for (const m of line.matchAll(/(?<![A-Za-z0-9_.-])\$?\/?flow:([a-z][a-z0-9-]*)/g)) {
      const n = m[1];
      if (
        n.endsWith('-') ||
        PLACEHOLDERS.has(n) ||
        COMMANDS.has(n) ||
        SKILLS.has(n) ||
        AGENTS.has(n)
      )
        continue;
      out.push(`${path}:${i + 1} flow:${n}`);
    }
  });
  return out;
}

test('every flow:<name> reference resolves to a command, skill or agent', () => {
  const bad = [];
  for (const r of ROOTS)
    for (const f of files(r)) bad.push(...dangling(f, readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('the ratchet catches a planted dangling reference', () => {
  assert.deepEqual(dangling('x.md', 'run /flow:execute then /flow:no-such-thing'), [
    'x.md:1 flow:no-such-thing',
  ]);
  assert.deepEqual(dangling('x.md', 'subagent_type: flow:worker; $flow:source-command-plan'), []);
  assert.deepEqual(dangling('x.md', '## Rename history\n/flow:gone\n## Next\n/flow:gone'), [
    'x.md:4 flow:gone',
  ]);
});

test('every command has its Codex mirror and every mirror its command', () => {
  const mirrors = [...SKILLS]
    .filter((s) => s.startsWith('source-command-'))
    .map((s) => s.slice(15));
  assert.deepEqual(
    [...COMMANDS].filter((c) => !mirrors.includes(c)),
    [],
    'commands without a mirror'
  );
  assert.deepEqual(
    mirrors.filter((m) => !COMMANDS.has(m)),
    [],
    'mirrors without a command'
  );
  for (const c of COMMANDS) {
    const desc = (f) =>
      readFileSync(f, 'utf8')
        .match(/^description:\s*(.+)$/m)?.[1]
        ?.trim()
        .replace(/^"(.*)"$/, '$1');
    const mf = join(FLOW, 'skills', `source-command-${c}`, 'SKILL.md');
    const want = desc(join(FLOW, 'commands', `${c}.md`));
    if (want) assert.equal(desc(mf), want, `${mf} description drifted from commands/${c}.md`);
  }
});

const isRetired = (text) => /^description:\s*"?Retired\b/m.test(text);
const LIMITS = { init: 250, plan: 300 };

test('kept commands stay within their size limit; retired ones are short stubs', () => {
  const over = [];
  for (const c of COMMANDS) {
    const text = readFileSync(join(FLOW, 'commands', `${c}.md`), 'utf8');
    const lines = text.trimEnd().split('\n').length;
    if (isRetired(text)) {
      const body = text.split(/^---$/m).slice(2).join('---').trim().split('\n').length;
      if (body > 8) over.push(`${c}: stub body ${body} lines > 8`);
    } else if (lines > (LIMITS[c] ?? 200)) over.push(`${c}: ${lines} lines > ${LIMITS[c] ?? 200}`);
  }
  assert.deepEqual(over, []);
});
