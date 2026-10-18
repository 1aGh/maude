// DDR-006 (superseded) regression guard.
//
// Claude Code now prepends the `<plugin>:` namespace to every plugin
// command/agent/skill itself (fixed upstream in Claude Code 2.1.216 — see
// changelog "Fixed plugin skills with a `name` frontmatter field losing
// their plugin prefix in slash-command autocomplete" — and Claude Code
// 2.1.218 explicitly reserves `:` in agent names for that namespacing).
// Baking the prefix into our own `name:` frontmatter, which DDR-006
// (2026-05-13) required as a workaround for the OLD (opposite) bug, now
// produces a doubled prefix — `/design:design:new`, `flow:flow:a11y-auditor`.
//
// Two invariants this guards:
//   1. `name:` frontmatter in plugins/{design,flow}/{commands,agents,skills}/
//      must be the BARE slug — no `design:`/`flow:` prefix.
//   2. `subagent_type:` references to our OWN plugin agents must carry
//      exactly ONE `<plugin>:` prefix (the form the runtime's own namespace
//      + our bare `name:` resolves to) — never zero (broken lookup against
//      a namespaced registry) and never two (stale pre-fix leftover).

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function grep(pattern, extraArgs = '') {
  const out = execSync(
    `grep -rn ${extraArgs} '${pattern}' plugins/design plugins/flow --include='*.md' || true`,
    { encoding: 'utf8' }
  );
  return out.trim().split('\n').filter(Boolean);
}

test('no plugin name: frontmatter carries a redundant design:/flow: prefix', () => {
  const offenders = grep('^name: \\(design\\|flow\\):');
  assert.deepEqual(
    offenders,
    [],
    `These files declare name: with the plugin prefix baked in — Claude Code adds the plugin namespace itself now, so this doubles into e.g. /design:design:new (DDR-006 superseded):\n  ${offenders.join('\n  ')}`
  );
});

test('no doubled design:design: / flow:flow: namespace anywhere in plugin markdown', () => {
  const offenders = grep('design:design:\\|flow:flow:');
  assert.deepEqual(
    offenders,
    [],
    `Doubled plugin namespace found — strip one level (DDR-006 superseded):\n  ${offenders.join('\n  ')}`
  );
});

test('subagent_type references to our own plugin agents carry exactly one <plugin>: prefix', () => {
  // Bare `subagent_type: <slug>` where <slug> looks like one of our
  // agent-style names (-critic/-agent/-auditor/-hacker/-keeper/-director/
  // -analyst suffix) but has no plugin prefix — excludes Claude Code
  // built-ins (e.g. code-simplifier, which is not one of our plugin agents)
  // and the `"<critic-name>"` template placeholder.
  const bareOffenders = grep(
    'subagent_type:.*"\\?[a-z][a-z0-9-]*\\(-critic\\|-agent\\|-auditor\\|-hacker\\|-keeper\\|-director\\|-analyst\\)"\\?'
  ).filter((line) => !/design:|flow:|<critic-name>|code-simplifier/.test(line));
  assert.deepEqual(
    bareOffenders,
    [],
    `These subagent_type references to a plugin-owned agent are missing the <plugin>: prefix and will fail to resolve against the namespaced registry:\n  ${bareOffenders.join('\n  ')}`
  );

  const doubledOffenders = grep('subagent_type:.*\\(design:design:\\|flow:flow:\\)');
  assert.deepEqual(
    doubledOffenders,
    [],
    `These subagent_type references are double-prefixed (DDR-006 superseded):\n  ${doubledOffenders.join('\n  ')}`
  );
});

// ── Agent hygiene (S12.1 · V2-1.18 §7, S12-slices D2) ──────────────────────────
//
// Structural rules for plugins/design/agents/. Some are red today on purpose: each known
// offender sits in a known-list with the slice that fixes it. The test fails when a NEW
// offender appears, and also when a listed offender is already fixed (delete the entry —
// the lists only shrink).

const AGENTS_DIR = join(ROOT, 'plugins', 'design', 'agents');

function loadAgents() {
  const out = [];
  for (const file of readdirSync(AGENTS_DIR).sort()) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fm) {
      out.push({
        file,
        name: file.replace(/\.md$/, ''),
        tools: [],
        description: '',
        body: text,
        frontmatter: false,
      });
      continue;
    }
    const field = (key) => fm[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim() ?? '';
    let description = field('description');
    if (description.startsWith('"')) {
      try {
        description = JSON.parse(description);
      } catch {
        // keep the raw text
      }
    }
    out.push({
      file,
      name: field('name') || file.replace(/\.md$/, ''),
      tools: field('tools')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description,
      body: fm[2],
      frontmatter: true,
    });
  }
  return out;
}

/** Fail on offenders not in `known`, and on `known` entries that no longer offend. */
function assertWithKnown(label, offenders, known) {
  const fresh = offenders.filter((o) => !(o in known));
  assert.deepEqual(fresh, [], `${label}:\n  ${fresh.join('\n  ')}`);
  const stale = Object.keys(known).filter((k) => !offenders.includes(k));
  assert.deepEqual(
    stale,
    [],
    `${label} — these are fixed now, remove them from the known list (it only shrinks):\n  ${stale.join('\n  ')}`
  );
}

const agents = loadAgents();

test('agents/ holds no _*.md (rule files are not agents)', () => {
  const offenders = readdirSync(AGENTS_DIR).filter((f) => f.startsWith('_') && f.endsWith('.md'));
  assertWithKnown('Underscore rule files registered as agents', offenders, {
    '_draw-design-rules.md': 'S12.7 moves it to references/draw/design-rules.md (D3)',
    '_draw-motion-rules.md': 'S12.7 moves it to references/draw/motion-rules.md (D3)',
  });
});

// The reshaped critics (V2-1.18 §5.5): Write stays in frontmatter (D2), so the BODY must
// name the hand-off protocol and the check that validates the output. draw-critic and
// reconstruct-critic are "unchanged" in the inventory.
const UNCHANGED_CRITICS = new Set(['draw-critic', 'reconstruct-critic']);

test('critics with Write name the hand-off protocol and `maude design check`', () => {
  const critics = agents.filter(
    (a) =>
      a.frontmatter &&
      /-critic$/.test(a.name) &&
      a.tools.includes('Write') &&
      !UNCHANGED_CRITICS.has(a.name)
  );
  assert.ok(critics.length >= 10, `expected the 10 Write-holding critics, found ${critics.length}`);
  const offenders = critics
    .filter((a) => !(/hand-?off/i.test(a.body) && /maude design check/.test(a.body)))
    .map((a) => a.name);
  assertWithKnown(
    'Critics with Write that do not name the hand-off protocol + `maude design check <output>`',
    offenders,
    {
      'design-critic': 'S12.5',
      'signature-moment-critic': 'S12.5',
      'a11y-critic': 'S12.6',
      'brand-critic': 'S12.6',
      'copy-critic': 'S12.6',
      'frontend-critic': 'S12.6',
      'graphic-design-critic': 'S12.6',
      'info-architecture-critic': 'S12.6',
      'motion-critic': 'S12.6',
      'typography-critic': 'S12.6',
    }
  );
});

// Readers of untrusted content (a video, an image, an asset) must have no egress: no
// shell and no web tools (DDR-174, DDR-183 F2). asset-describer arrives with S12.13.
test('readers of untrusted content have no Bash or Web* tools', () => {
  const readers = agents.filter(
    (a) =>
      a.name === 'footage-analyst' ||
      a.name === 'asset-describer' ||
      a.name.startsWith('reconstruct-')
  );
  for (const must of ['footage-analyst', 'reconstruct-agent', 'reconstruct-critic']) {
    assert.ok(
      readers.some((a) => a.name === must),
      `${must} should exist (it reads untrusted content)`
    );
  }
  const offenders = readers
    .filter((a) => a.tools.length === 0 || a.tools.some((t) => /^(Bash|Web)/.test(t)))
    .map((a) => `${a.name}: tools = ${a.tools.join(', ') || '(none declared)'}`);
  assert.deepEqual(
    offenders,
    [],
    `Untrusted-content readers must be egress-free:\n  ${offenders.join('\n  ')}`
  );
});

// Writers are bounded (new files only) and only ever spawned by a command or the main
// agent, never picked by the model on its own. ds-migrator arrives with S12.12.
test('bounded-writer descriptions say they are never auto-delegated', () => {
  const writers = agents.filter((a) =>
    ['draw-agent', 'footage-director', 'reconstruct-agent', 'ds-migrator'].includes(a.name)
  );
  for (const must of ['draw-agent', 'footage-director', 'reconstruct-agent']) {
    assert.ok(
      writers.some((a) => a.name === must),
      `${must} should exist`
    );
  }
  const offenders = writers
    .filter((a) => !/never auto-delegated/i.test(a.description))
    .map((a) => a.name);
  assertWithKnown('Writer descriptions without "never auto-delegated"', offenders, {
    'draw-agent': 'S12.7',
    'footage-director': 'S12.7',
    'reconstruct-agent': 'S12.7',
  });
});

// Every agent description sits in the main agent's context on every turn. Budget: today's
// total + 10 %. New agents (asset-describer, ds-migrator) must pay for themselves by
// shortening others; raise AGENT_DESCRIPTION_TOKENS_TODAY only with a recorded reason.
const AGENT_DESCRIPTION_TOKENS_TODAY = 2858; // 2026-10-18, 20 agents, chars/4

test('total design-agent description tokens stay within today + 10 %', () => {
  const tokens = agents.reduce((sum, a) => sum + Math.ceil(a.description.length / 4), 0);
  const budget = Math.floor(AGENT_DESCRIPTION_TOKENS_TODAY * 1.1);
  assert.ok(
    tokens <= budget,
    `Agent descriptions total ~${tokens} tokens (chars/4); budget is ${budget} (today ${AGENT_DESCRIPTION_TOKENS_TODAY} + 10 %). Shorten descriptions.`
  );
});
