// DDR-174 regression guard (T15).
//
// The whole security architecture of `/design:import --reconstruct` rests on
// ONE fact: every agent turn that ever reads the untrusted source image —
// `reconstruct-agent` (authoring) AND `reconstruct-critic` (the reality-check
// comparator) — has `tools: Read, Write, Glob, Grep` and NEVER `Bash`,
// `WebSearch`, or `WebFetch`. DDR-174's own Consequences section calls for
// exactly this test: "a targeted grep-based test mirroring
// plugin-cli-reachability.test.mjs's pattern should assert BOTH the authoring
// agent's AND the comparator agent's frontmatter never gain
// Bash/WebSearch/WebFetch, not just this DDR's prose." A future maintainer
// "helpfully" widening either agent's toolset (e.g. "just give it Bash so it
// can screenshot itself") would silently reopen DDR-174's entire closure —
// this fails loudly instead.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const AGENTS = [
  'plugins/design/agents/reconstruct-agent.md',
  'plugins/design/agents/reconstruct-critic.md',
];

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function readFrontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const fm = FRONTMATTER_RE.exec(text);
  assert.ok(fm, `${path}: no frontmatter block found`);
  return fm[1];
}

function readToolsLine(path) {
  const fm = readFrontmatter(path);
  const toolsLine = fm.split('\n').find((l) => l.startsWith('tools:'));
  assert.ok(toolsLine, `${path}: frontmatter has no tools: line`);
  return toolsLine;
}

for (const path of AGENTS) {
  test(`${path}: tools: line never grants Bash`, () => {
    const line = readToolsLine(path);
    assert.ok(
      !/\bBash\b/.test(line),
      `${path} declares Bash — this reopens DDR-174's core closure (the agent reads an untrusted image and must never hold a shell). Line: ${line}`
    );
  });

  test(`${path}: tools: line never grants WebSearch or WebFetch`, () => {
    const line = readToolsLine(path);
    assert.ok(
      !/\bWebSearch\b/.test(line) && !/\bWebFetch\b/.test(line),
      `${path} declares WebSearch/WebFetch — DDR-174 requires these agents have no tool call that reaches the network. Line: ${line}`
    );
  });

  test(`${path}: tools: line is exactly Read, Write, Glob, Grep`, () => {
    const line = readToolsLine(path);
    const tools = line
      .replace(/^tools:\s*/, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    assert.deepEqual(
      [...tools].sort(),
      ['Glob', 'Grep', 'Read', 'Write'],
      `${path}: expected exactly Read/Write/Glob/Grep per DDR-174 Decision 1, got: ${line}`
    );
  });

  // DDR-174 Addendum (post-implementation adversarial review) — Write has no
  // path restriction (Claude Code has no per-subagent path-scoping mechanism,
  // verified authoritatively, not assumed) and the only real closure for a
  // non-bypassPermissions session is a human approval prompt on any write.
  // `permissionMode: default` is what makes that prompt happen instead of
  // silently inheriting the parent session's (possibly bypassPermissions)
  // mode. A future maintainer removing this line silently re-widens the
  // agent's effective write reach for every downstream consumer NOT running
  // bypassPermissions.
  test(`${path}: frontmatter declares permissionMode: default (DDR-174 Addendum)`, () => {
    const fm = readFrontmatter(path);
    const line = fm.split('\n').find((l) => l.startsWith('permissionMode:'));
    assert.ok(
      line,
      `${path}: missing permissionMode: default — without it this agent silently inherits the parent session's permission mode (e.g. bypassPermissions), losing the one real per-write approval gate available for its unrestricted Write tool (DDR-174 Addendum)`
    );
    assert.equal(
      line.replace(/^permissionMode:\s*/, '').trim(),
      'default',
      `${path}: permissionMode must be exactly "default" (prompts on every write), not a looser mode. Line: ${line}`
    );
  });
}

test('import.md diff-check is whole-repo scoped, not just $DESIGN_ROOT (DDR-174 Addendum)', () => {
  // The first implementation scoped `git status --porcelain -- "$DESIGN_ROOT"`,
  // which made a write to .claude/settings.json, CLAUDE.md, or plugins/**
  // structurally invisible to the check — an adversarial review built a full
  // exploit chain out of exactly that gap. Assert the pathspec was actually
  // widened, not just documented as widened in prose.
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  assert.ok(
    !/git -C "\$REPO" status --porcelain -- "\$DESIGN_ROOT"/.test(importMd),
    'import.md must NOT scope the diff-check to $DESIGN_ROOT only — this was the exact gap the DDR-174 Addendum closes (a write outside $DESIGN_ROOT, e.g. to .claude/settings.json, would be invisible to a $DESIGN_ROOT-scoped check)'
  );
  const wholeRepoOccurrences = (importMd.match(/git -C "\$REPO" status --porcelain\b/g) || [])
    .length;
  assert.ok(
    wholeRepoOccurrences >= 2,
    `import.md must run an UNSCOPED \`git -C "$REPO" status --porcelain\` for both the BEFORE (step 4) and AFTER (step 5b) snapshots — found ${wholeRepoOccurrences} occurrence(s)`
  );
});

test('import.md snapshots the two well-known global Claude Code config paths (DDR-174 Addendum)', () => {
  // A repo-scoped git diff can never see $HOME/.claude/** — these are the two
  // specific files an adversarial review named as attack targets (a planted
  // hook, or a poisoned global CLAUDE.md loaded into every future session).
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  assert.ok(
    importMd.includes('$HOME/.claude/settings.json') &&
      importMd.includes('$HOME/.claude/CLAUDE.md'),
    'import.md must snapshot $HOME/.claude/settings.json and $HOME/.claude/CLAUDE.md before/after each round and hard-fail on any change (DDR-174 Addendum) — these are outside any repo-scoped diff check'
  );
});

test('import.md stat calls are portable (GNU-first, BSD-fallback), not BSD-only (DDR-174 Addendum confirmation pass)', () => {
  // The first Addendum revision used BSD-only `stat -f` unconditionally — it
  // silently no-ops on Linux (a platform this project ships a .deb for),
  // because GNU `stat -f` means something else entirely and errors out,
  // swallowed by the trailing `2>/dev/null`. Both empty strings compare
  // equal, so the check trivially "passes" without ever having checked
  // anything. Assert every stat call tries GNU syntax (`stat -c`) first.
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  // Only scan actual shell inside fenced ```bash blocks — prose elsewhere
  // legitimately mentions `stat -f` by name when explaining the old bug.
  const codeBlocks = [...importMd.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  const bareStatF = codeBlocks.match(/(?<!\|\| )\bstat -f\b/g) || [];
  assert.deepEqual(
    bareStatF,
    [],
    `import.md has a \`stat -f\` call in executable shell with no \`stat -c\` GNU fallback tried first — this silently no-ops on Linux (DDR-174 Addendum confirmation-pass finding). Found ${bareStatF.length} bare occurrence(s).`
  );
  const statCOccurrences = (codeBlocks.match(/stat -c '/g) || []).length;
  assert.ok(
    statCOccurrences >= 4,
    `expected at least 4 GNU-first \`stat -c\` attempts (2 for the non-git repo-wide fallback, 2 for the global-config snapshot) — found ${statCOccurrences}`
  );
});

test('import.md non-git fallback excludes _runs/ (DDR-174 Addendum confirmation pass)', () => {
  // The reconstruct loop writes its own hand-offs, screenshots and verdict files under
  // the run folder (.design/_runs/<session>/) every round (S12.11; was _history/_reconstruct). A git-repo target gets this
  // excluded for free via .gitignore; the non-git `find`-based fallback has
  // no such filter and would false-positive-abort on its own round-1 output
  // the moment round 2's diff check runs, in a non-git target repo.
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  const findOccurrences = importMd.match(/find "\$REPO" -type f[^\n]*/g) || [];
  assert.ok(
    findOccurrences.length >= 2,
    'expected the non-git fallback find command in both step 4 and step 5b'
  );
  for (const line of findOccurrences) {
    assert.ok(
      line.includes("-not -path '*/_runs/*'"),
      `non-git fallback find command must exclude _runs/ (its own round-N artifacts) or every multi-round run in a non-git target repo false-positive-aborts: ${line}`
    );
  }
});

test('import.md uses no fixed /tmp filename and never rewrites _active.json (DDR-174 Addendum, S12.11)', () => {
  // The Addendum's finding was a predictable /tmp name for the jq patch of _active.json (a symlink
  // race on a shared machine). S12.11 removed the patch itself: the screenshot names its canvas with
  // --canvas, and every round file lives in the per-session run folder.
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  assert.ok(
    !/\/tmp\/active\.json\.tmp/.test(importMd),
    'import.md must not use a fixed, predictable /tmp filename — a symlink race target on a shared machine (DDR-174 Addendum adversarial finding)'
  );
  assert.ok(
    !/jq [^\n]*\.active\s*=/.test(importMd),
    'import.md must not rewrite the studio-owned _active.json'
  );
  assert.ok(
    /maude design screenshot --canvas "\$CANVAS_REL"/.test(importMd),
    'the reality-check screenshot names its canvas with --canvas'
  );
});

test('design-critic.md is never repurposed as the reconstruct comparator (DDR-174 Decision 1 Round-2)', () => {
  // The comparator must be reconstruct-critic (Bash-free), never the default
  // Bash-capable design-critic — assert import.md's orchestrator spawns the
  // dedicated agent, not design-critic, for the reality-check step.
  const importMd = readFileSync('plugins/design/commands/import.md', 'utf8');
  const reconstructSection = importMd.slice(importMd.indexOf('## `--reconstruct'));
  assert.ok(
    reconstructSection.includes('design:reconstruct-critic'),
    'import.md --reconstruct mode must spawn design:reconstruct-critic for the reality-check step'
  );
  assert.ok(
    !/subagent_type:\s*"design:design-critic"/.test(reconstructSection),
    'import.md --reconstruct mode must NOT spawn the default design-critic as its comparator (DDR-174 Decision 1 Round-2) — it is Bash-capable and reopens the trifecta this DDR closes'
  );
});
