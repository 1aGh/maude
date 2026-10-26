// bash-guard — the pre-bash rules (contract V2-1.11 §5.4, narrowed by V2-1.18 §9 Q5).
// Deny the three codes on what they name; never deny a read; fail open on what can't be followed.
//
// Run: node --test cli/lib/bash-guard.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { classifyBash, designVerbOf, designWritesSince, parseBash } from './bash-guard.mjs';

const ROOT = '/p';
const DR = '/p/.design';
const code = (cmd, cwd = ROOT) => classifyBash(cmd, { cwd, designRoot: DR })?.code ?? null;

const DENIED = [
  ['rm .design/ui/C.tsx', 'use-trash'],
  ['rm -rf .design', 'use-trash'],
  ['rm -f /tmp/x .design/ui/C.meta.json', 'use-trash'],
  ['unlink /p/.design/ui/C.tsx', 'use-trash'],
  ['git rm .design/ui/C.tsx', 'use-trash'],
  ['find .design/ui -name "*.tsx" -delete', 'use-trash'],
  ['cd .design && rm ui/C.tsx', 'use-trash'],
  ['X=$(rm .design/ui/C.tsx)', 'use-trash'],
  ['mv .design/ui/C.tsx .design/ui/D.tsx', 'use-verb'],
  ['git -C /p mv .design/ui/C.tsx .design/ui/D.tsx', 'use-verb'],
  ["sed -i '' 's/a/b/' .design/ui/C.tsx", 'not-a-writer'],
  ["sed -i.bak -e 's/a/b/' .design/ui/C.tsx", 'not-a-writer'],
  ["perl -pi -e 's/a/b/' .design/ui/C.tsx", 'not-a-writer'],
  ['echo x > .design/ui/C.tsx', 'not-a-writer'],
  ['maude design read-annotations ui/C.tsx >> .design/ui/C.annotations.json', 'not-a-writer'],
  ["cat > .design/ui/N.tsx <<'EOF'\nexport default 1;\nEOF\necho ok", 'not-a-writer'],
  ['echo x | tee -a .design/notes.md', 'not-a-writer'],
  ['cp /tmp/x.tsx .design/ui/', 'not-a-writer'],
  ['rsync -a /tmp/kit/ .design/system/kit/', 'not-a-writer'],
  ["python3 -c \"open('.design/ui/C.tsx','w').write('x')\"", 'not-a-writer'],
  ["node -e \"require('fs').writeFileSync('.design/ui/C.tsx','x')\"", 'not-a-writer'],
  [
    "python3 - <<'PY'\nimport pathlib\npathlib.Path('.design/ui/C.tsx').write_text('x')\nPY",
    'not-a-writer',
  ],
];

// V2-1.18 found 6 pre-bash false positives on read pipelines; these must stay silent.
const ALLOWED = [
  'maude design read-annotations ui/C.tsx | python3 -c "import json,sys; print(json.load(sys.stdin))"',
  'cp .design/ui/C.tsx /tmp/',
  'PORT=$(maude design server-up) && maude design screenshot --canvas ui/C.tsx --out /tmp/x.png',
  'X=$(maude design prep --json) && echo "$X" | jq .config',
  'maude design annotate ui/C.tsx --ops /tmp/ops.json',
  'rm -rf .design/_runs/s1',
  'echo x > .design/_runs/x.txt',
  'cat .design/ui/C.tsx | grep foo > /tmp/o',
  'git diff .design/ui/C.tsx > /tmp/d.patch',
  'ls .design 2>/dev/null; echo done',
  '[[ -f .design/ui/C.tsx ]] && echo yes',
  `python3 -c "import json; json.load(open('.design/ui/C.meta.json'))"`,
  `node -e "require('fs').writeFileSync('/tmp/x', '1')"`,
  'echo "a > .design/ui/C.tsx"',
  '# rm .design/ui/C.tsx\nls .design',
  'for f in .design/ui/*.tsx; do echo "$f"; done',
  'rm -rf node_modules dist',
];

// Things the reader can't see never produce a decision.
const UNSEEN = [
  'rm $F',
  'rm "unterminated .design/ui/C.tsx',
  'cd $HOME && rm ui/C.tsx',
  'rm $(cat list)',
];

test('the three codes, on what they name', () => {
  for (const [cmd, want] of DENIED) assert.equal(code(cmd), want, cmd);
});

test('reads are never denied (the V2-1.18 pilot false positives)', () => {
  for (const cmd of ALLOWED) assert.equal(code(cmd), null, cmd);
});

test('fail-open: a word or command it cannot follow gives no decision', () => {
  for (const cmd of UNSEEN) assert.equal(code(cmd), null, cmd);
  assert.equal(parseBash('echo "open'), null);
  assert.equal(parseBash('X=$(echo a'), null);
});

// Phase 2 gate round 3: a command name is judged as the binary that runs — the parsed word
// (quotes and backslashes removed), basename'd and case-folded (APFS finds `RM` as `rm`).
const NAMED = [
  ['RM .design/ui/X.tsx', 'use-trash'],
  ["r''m .design/ui/X.tsx", 'use-trash'],
  ['r\\m .design/ui/X.tsx', 'use-trash'],
  ['"rm" .design/ui/X.tsx', 'use-trash'],
  ['/BIN/RM .design/ui/X.tsx', 'use-trash'],
  ['SUDO RM .design/ui/X.tsx', 'use-trash'],
  ['UNLINK .design/ui/X.tsx', 'use-trash'],
  ['MV .design/ui/X.tsx .design/ui/Y.tsx', 'use-verb'],
  ["m''v .design/ui/X.tsx .design/ui/Y.tsx", 'use-verb'],
  ['CP /tmp/x.tsx .design/ui/X.tsx', 'not-a-writer'],
  ['TEE .design/ui/X.tsx', 'not-a-writer'],
  ["SED -i '' s/a/b/ .design/ui/X.tsx", 'not-a-writer'],
  ["sed -I '' s/a/b/ .design/ui/X.tsx", 'not-a-writer'],
  ["PERL -pi -e 's/a/b/' .design/ui/X.tsx", 'not-a-writer'],
  ["NODE -e \"require('fs').writeFileSync('.design/ui/X.tsx','x')\"", 'not-a-writer'],
  ["Python3 -c \"open('.design/ui/X.tsx','w')\"", 'not-a-writer'],
  ['GIT RM .design/ui/X.tsx', 'use-trash'],
  ['g\\it r\\m .design/ui/X.tsx', 'use-trash'],
  ['GIT -C . checkout -- .design/x.tsx', 'not-a-writer'],
  ['git checkout HEAD~1 -- .design/ui/X.tsx', 'not-a-writer'],
  ['git restore .design/ui/X.tsx', 'not-a-writer'],
  ['git restore --source=HEAD~2 --worktree .design/ui/X.tsx', 'not-a-writer'],
  ['FIND .design/ui -delete', 'use-trash'],
  ['find .design/ui -exec RM {} +', 'use-trash'],
  ['LN -f /tmp/x .design/ui/X.tsx', 'not-a-writer'],
  ['ln /tmp/x .design/ui/X.tsx', 'not-a-writer'],
  ['ln .design/ui/X.tsx /tmp/x', 'not-a-writer'],
  ['ln -t .design/ui /tmp/x', 'not-a-writer'],
  ['INSTALL /tmp/x .design/ui/X.tsx', 'not-a-writer'],
];

const NAMED_ALLOWED = [
  'git checkout main',
  'git checkout -b feature/x',
  'git restore --staged .design/ui/X.tsx',
  'GIT status .design',
  'ln -s .design/ui/X.tsx /tmp/x',
  'LS .design/ui',
];

test("command names are the parsed, case-folded binary (RM, r''m, r\\m, GIT, LN)", () => {
  for (const [cmd, want] of NAMED) assert.equal(code(cmd), want, cmd);
  for (const cmd of NAMED_ALLOWED) assert.equal(code(cmd), null, cmd);
});

// Phase 2 gate (final verify) — bash decodes ANSI-C `$'…'` escapes before it runs a word, so
// the guard must judge the decoded text: `$'\x72m'` is `rm`, `$'\x2edesign'` is `.design`.
test("ANSI-C $'…' words are judged decoded (\\xHH, \\NNN octal, \\uHHHH)", () => {
  for (const cmd of [
    "$'\\x72m' -f .design/ui/X.tsx",
    "$'\\162m' .design/ui/X.tsx",
    "$'\\u0072m' .design/ui/X.tsx",
    "rm $'\\x2edesign/ui/X.tsx'",
    "$'m\\x76' .design/ui/X.tsx .design/ui/Y.tsx",
  ])
    assert.notEqual(code(cmd), null, cmd);
  // a decoded word that is not a guarded write stays allowed
  assert.equal(code("echo $'\\x72m .design/ui/X.tsx'"), null);
  assert.equal(code("cat $'\\x2edesign/ui/X.tsx'"), null);
});

test('a hard link from a guarded runtime file is judged (ln source and destination)', () => {
  const guard = (rel) =>
    rel.startsWith('_runs/') ? { code: 'out-of-scope', reason: `out-of-scope: ${rel}` } : null;
  const g = (cmd) => classifyBash(cmd, { cwd: ROOT, designRoot: DR, guard })?.code ?? null;
  assert.equal(g('ln -f .design/ui/Draft.tsx .design/_runs/s/agents.json'), 'out-of-scope');
  assert.equal(g('ln .design/_runs/s/agents.json /tmp/owned.json'), 'out-of-scope');
  assert.equal(g('ln -s /tmp/x /tmp/y'), null);
});

test('the pre-bash budget: the whole fixture set classifies in a few ms per command', () => {
  const all = [...DENIED, ...NAMED].map(([c]) => c).concat(ALLOWED, NAMED_ALLOWED, UNSEEN);
  for (const c of all) code(c); // warm up
  const runs = 20;
  const t0 = performance.now();
  for (let k = 0; k < runs; k++) for (const c of all) code(c);
  const per = (performance.now() - t0) / (runs * all.length);
  console.log(`pre-bash classify: ${per.toFixed(3)} ms / command over ${all.length} fixtures`);
  assert.ok(per < 2, `${per} ms per command`);
});

test('relative paths follow the hook cwd', () => {
  assert.equal(code('rm C.tsx', '/p/.design/ui'), 'use-trash');
  assert.equal(code('rm C.tsx', '/p'), null);
});

test('every reason names the next step and never says ask/allow', () => {
  for (const [cmd] of DENIED) {
    const r = classifyBash(cmd, { cwd: ROOT, designRoot: DR });
    assert.match(r.reason, /^(use-trash|use-verb|not-a-writer): /);
    assert.doesNotMatch(r.reason, /"(ask|allow)"/);
  }
});

// §9 Q3: a `maude` command's redirected output may land only in the project or the temp dir.
// `Bash(maude:*)` would otherwise approve `maude design … > ~/.zshenv`, which confineOut() never sees.
const outCode = (cmd, cwd = ROOT) =>
  classifyBash(cmd, { cwd, designRoot: DR, root: ROOT })?.code ?? null;

const OUT_DENIED = [
  'maude design slug x > ~/.maude-poc',
  'maude design slug x >> /etc/maude-probe',
  'maude design slug x &> $HOME/.zshenv',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  'maude design slug x &>> ${HOME}/.zshenv',
  'maude design slug x 2> /etc/maude-err.log',
  'maude design slug x >| /etc/maude-probe',
  'maude design slug x >& /etc/maude-probe',
  'maude design slug x 2>&1 > /etc/maude-probe',
  'maude design slug x > /tmp/../etc/maude-probe',
  'maude design slug x > ../elsewhere.txt',
  'maude design slug x | tee /etc/maude-probe',
  'maude design slug x 2>&1 |& tee -a ~/.bashrc',
  'maude design slug x | grep . | tee /etc/maude-probe',
  'cd /etc && maude design slug x > maude-probe',
  'npx @1agh/maude design slug x > /etc/maude-probe',
  'node /x/cli/bin/maude.mjs design slug x > /etc/maude-probe',
  'mdcc design slug x > /etc/maude-probe',
  'X=$(maude design slug x > /etc/maude-probe)',
  'ls; maude design prep --json > "/etc/maude probe"',
];

const OUT_ALLOWED = [
  'maude design slug x > /dev/null',
  'maude design slug x 2>/dev/null',
  'maude design slug x > /dev/stderr',
  'maude design slug x > /dev/stdout 2>&1',
  'maude design slug x >&2',
  'maude design slug x > out.txt',
  'maude design slug x > /p/notes/x.txt',
  'maude design slug x > /tmp/x.json',
  'maude design slug x > $TMPDIR/x.json',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  'maude design slug x > ${TMPDIR}/x.json',
  `maude design slug x > ${tmpdir()}/x.json`,
  'maude design slug x | tee /tmp/x.json',
  'maude design slug x | tee out.txt',
  // a non-maude writer is Claude Code's own permission business, not this guard's
  'echo x > /etc/foo',
  'echo x | tee /etc/foo',
  // the V2-1.18 compound shapes: the maude output is captured, the writer is someone else
  'X=$(maude design prep --json) && echo "$X" > /etc/out',
  'X=$(maude design prep --json); echo "$X" | tee /etc/out',
  // not fed by maude in the same pipeline segment
  'maude design slug x; echo y | tee /etc/out',
  'maude design slug x && cat /dev/null > /etc/out',
  // quoted `>` is text, not a redirection
  'echo "maude design slug x > /etc/foo"',
  'maude design annotate ui/C.tsx --text "a > /etc/b" --text \'c >> ~/.zshenv\'',
  // a heredoc body is data
  "cat <<'EOF' > /tmp/x.md\nmaude design slug x > /etc/foo\nEOF",
  'maude design read-annotations ui/C.tsx <<EOF\n> /etc/foo\nEOF',
  // an input redirection is a read
  'maude design annotate ui/C.tsx --ops - < /etc/hosts',
];

// What the reader can't resolve fails OPEN, like the rest of the guard.
const OUT_UNSEEN = [
  'maude design slug x > $OUT',
  'maude design slug x > "$DIR/x.json"',
  'maude design slug x > $(mktemp)',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  'maude design slug x > ${HOME:-/etc}/x',
  'maude design slug x > $HOME$SUB/x',
  'maude design slug x | tee $F',
  'cd $X && maude design slug x > out.txt',
  'maude design slug x > "/etc/unterminated',
];

test('out-of-project: a maude command redirected outside the project or temp dir is denied', () => {
  for (const cmd of OUT_DENIED) assert.equal(outCode(cmd), 'out-of-project', cmd);
});

test('out-of-project: /dev/*, in-project, temp-dir and non-maude writers pass', () => {
  for (const cmd of OUT_ALLOWED) assert.equal(outCode(cmd), null, cmd);
});

test('out-of-project: an unresolvable target fails open', () => {
  for (const cmd of OUT_UNSEEN) assert.equal(outCode(cmd), null, cmd);
});

test('out-of-project: symlinks are resolved (a link inside the project out of it is denied)', () => {
  // the project sits in the temp dir (allowed); its `link` points at /etc (not allowed)
  const base = mkdtempSync(join(tmpdir(), 'maude-bg-'));
  try {
    const project = join(base, 'proj');
    mkdirSync(join(project, '.design'), { recursive: true });
    symlinkSync('/etc', join(project, 'link'));
    const c = (cmd) =>
      classifyBash(cmd, { cwd: project, designRoot: join(project, '.design'), root: project })
        ?.code ?? null;
    assert.equal(c('maude design slug x > link/maude-probe'), 'out-of-project');
    assert.equal(c('maude design slug x > inside.txt'), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('out-of-project: `..` after a symlink and a dangling link resolve as the kernel does', () => {
  // `link/..` is the PARENT OF THE TARGET (/usr), not the project; a dangling link creates its
  // target. A lexical resolve() before realpath said "inside" to both.
  const base = mkdtempSync(join(tmpdir(), 'maude-bg-'));
  try {
    const project = join(base, 'proj');
    mkdirSync(join(project, '.design', 'ui'), { recursive: true });
    symlinkSync('/usr/bin', join(project, 'link'));
    symlinkSync(`/etc/maude-dangling-${process.pid}`, join(project, 'dang'));
    const c = (cmd) =>
      classifyBash(cmd, { cwd: project, designRoot: join(project, '.design'), root: project })
        ?.code ?? null;
    assert.equal(c('maude design slug x > link/../maude-probe'), 'out-of-project');
    assert.equal(c(`maude design slug x > ${project}/link/../../maude-probe`), 'out-of-project');
    assert.equal(c('maude design slug x > dang'), 'out-of-project');
    assert.equal(c('maude design slug x | tee link/../maude-probe'), 'out-of-project');
    // `..` inside the project stays inside
    assert.equal(c('maude design slug x > .design/../out.txt'), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a guard judges runtime paths in write positions (reads and unguarded paths pass)', () => {
  const guard = (rel) =>
    rel.startsWith('_runs/') ? { code: 'out-of-scope', reason: `out-of-scope: ${rel}` } : null;
  const g = (cmd) => classifyBash(cmd, { cwd: ROOT, designRoot: DR, guard })?.code ?? null;
  assert.equal(g('rm .design/_runs/s/agents.json'), 'out-of-scope');
  assert.equal(g('echo x > .design/_runs/s/handoff/a.in.json'), 'out-of-scope');
  assert.equal(g('cp /tmp/x .design/_runs/s/agents.json'), 'out-of-scope');
  assert.equal(g(`python3 -c "open('.design/_runs/s/agents.json','w')"`), 'out-of-scope');
  assert.equal(g('cat .design/_runs/s/agents.json'), null);
  assert.equal(g('rm .design/_history/x'), null);
  assert.equal(code('rm .design/_runs/s/agents.json'), null); // no guard: today's rules
});

test('out-of-project: the reason names the fix and never says ask/allow', () => {
  const r = classifyBash('maude design slug x > /etc/maude-probe', {
    cwd: ROOT,
    designRoot: DR,
    root: ROOT,
  });
  assert.match(
    r.reason,
    /^out-of-project: .*\/etc\/maude-probe.*Write inside the project or the temp dir/
  );
  assert.doesNotMatch(r.reason, /"(ask|allow)"/);
  // no root → no judgement (fail-open)
  assert.equal(code('maude design slug x > /etc/maude-probe'), null);
});

test('designVerbOf reads the verb (and a sub-verb row) from the manifest table', () => {
  const verbs = [
    { verb: 'design annotate', effect: 'project' },
    { verb: 'design ds-upgrade analyse', effect: 'none' },
    { verb: 'design ds-upgrade', effect: 'destructive' },
  ];
  const one = (s) => designVerbOf(parseBash(s)[0], verbs);
  assert.deepEqual(one('maude design annotate ui/C.tsx --ops x'), {
    verb: 'annotate',
    effect: 'project',
  });
  assert.deepEqual(one('maude design ds-upgrade analyse x'), {
    verb: 'ds-upgrade',
    effect: 'none',
  });
  assert.deepEqual(one('node /x/cli/bin/maude.mjs design ds-upgrade apply'), {
    verb: 'ds-upgrade',
    effect: 'destructive',
  });
  assert.equal(one('ls'), null);
});

test('designWritesSince finds versioned files changed in the window, never runtime ones', () => {
  const dr = mkdtempSync(join(tmpdir(), 'maude-bg-'));
  try {
    mkdirSync(join(dr, 'ui'), { recursive: true });
    mkdirSync(join(dr, '_runs'), { recursive: true });
    const old = Date.now() / 1000 - 60;
    for (const f of ['ui/A.tsx', 'ui/B.tsx', '_runs/x.json']) writeFileSync(join(dr, f), 'x');
    utimesSync(join(dr, 'ui', 'A.tsx'), old, old);
    assert.deepEqual(designWritesSince(dr, Date.now() - 5000), ['ui/B.tsx']);
  } finally {
    rmSync(dr, { recursive: true, force: true });
  }
});

// S6.0c (decision maude/v2-lead-cloud-move-window-only): moving a project to the cloud uploads it
// to a billed account — the person's act in the Maude window. The studio refuses a POST without
// the window's Sec-Fetch-Site; this second net names why before the command even runs.
const MOVE = 'http://127.0.0.1:4399/_api/cloud/move';
const MOVE_DENIED = [
  `maude design curl-local --method POST ${MOVE}`,
  `maude design curl-local --method post --data '{}' ${MOVE}`,
  `maude design curl-local --data '{"name":"x"}' ${MOVE}`,
  `curl -X POST ${MOVE}`,
  `curl -XPOST ${MOVE}`,
  `curl --request=POST ${MOVE}`,
  `curl -d '{}' ${MOVE}`,
  `curl --json '{}' ${MOVE}`,
  `curl -H 'Sec-Fetch-Site: same-origin' -X POST "http://127.0.0.1:\${PORT}/_api/cloud/move"`,
  'curl -X POST http://127.0.0.1:4399/_api/cl""oud/move',
  `wget --post-data='{}' ${MOVE}`,
  `node -e "fetch('${MOVE}',{method:'POST'})"`,
  `bun -e "await fetch('${MOVE}', { method: 'POST' })"`,
  `python3 -c "import urllib.request as u; u.urlopen(u.Request('${MOVE}', data=b'{}'))"`,
  `env FOO=1 curl -sS -X POST ${MOVE} | jq .`,
  `X=$(curl -s -X POST ${MOVE})`,
];
const MOVE_ALLOWED = [
  `maude design curl-local ${MOVE}`,
  `maude design curl-local --method GET ${MOVE}`,
  `curl -s ${MOVE}`,
  `curl -sS -X GET ${MOVE} | jq .state`,
  'curl -X POST http://127.0.0.1:4399/_api/cloud/connect',
  "rg -n '_api/cloud/move' apps/studio",
  'grep -rn cloud/move apps/studio/routes',
];

test('S6.0c: a write to /_api/cloud/move is denied (human-only); a status read is not', () => {
  for (const cmd of MOVE_DENIED) assert.equal(code(cmd), 'human-only', cmd);
  for (const cmd of MOVE_ALLOWED) assert.equal(code(cmd), null, cmd);
  const r = classifyBash(MOVE_DENIED[0], { cwd: ROOT, designRoot: DR });
  assert.match(r.reason, /^human-only: /);
  assert.match(r.reason, /Move to cloud/);
  assert.doesNotMatch(r.reason, /"(ask|allow)"/);
});

// V2-8.9 defender M1 (decision maude/v2-8.9-sync-link-confirm-needs-fetch-metadata): Connect sends
// this Mac's hub credential to the folder's hub — the person's consent in the Maude window, like
// Move to cloud. The studio refuses a POST without the window's Sec-Fetch-Site; this net names it.
const LINK = 'http://127.0.0.1:4399/_api/sync/link/confirm';
test('V2-8.9 M1: a write to /_api/sync/link/confirm is denied (human-only); a read of the link is not', () => {
  for (const cmd of [
    `maude design curl-local --method POST ${LINK}`,
    `curl -X POST ${LINK}`,
    `curl -H 'Sec-Fetch-Site: same-origin' -d '{}' ${LINK}`,
    `node -e "fetch('${LINK}',{method:'POST'})"`,
  ])
    assert.equal(code(cmd), 'human-only', cmd);
  for (const cmd of [
    'maude design curl-local http://127.0.0.1:4399/_api/sync/link',
    'curl -s http://127.0.0.1:4399/_api/sync/link',
    'curl -X POST http://127.0.0.1:4399/_api/sync/linked',
    "rg -n 'sync/link/confirm' apps/studio",
  ])
    assert.equal(code(cmd), null, cmd);
  const r = classifyBash(`curl -X POST ${LINK}`, { cwd: ROOT, designRoot: DR });
  assert.match(r.reason, /Connect to the hub/);
});

// gate-b-sec2 finding 1 — defence in depth behind the dispatcher: a maude verb's --root /
// --design-root / cwd names the session's project, and a call never steers the session env.
test('other project: --root, --design-root, cd and the session env are denied; the project passes', () => {
  const base = mkdtempSync(join(tmpdir(), 'maude-bg-'));
  try {
    const mk = (n) => {
      const p = join(base, n);
      mkdirSync(join(p, '.design', 'ui'), { recursive: true });
      writeFileSync(join(p, '.design', 'config.json'), '{}');
      return p;
    };
    const a = mk('a');
    const b = mk('b');
    symlinkSync(a, join(base, 'a-link'));
    const c = (cmd, extra = {}) =>
      classifyBash(cmd, { cwd: a, designRoot: join(a, '.design'), root: a, ...extra })?.code ??
      null;
    const DENY = [
      `maude design read-annotations ui/C.tsx --root ${b}`,
      `maude design annotate ui/C.tsx --root=${b} --pin x --text hi`,
      'maude design reel-place cut --next --root ../b',
      `maude design trash restore ui/C.tsx --root ${b}`,
      `maude design import-asset p.png --root ${a} --design-root ../b/.design`,
      `cd ${b} && maude design read-annotations ui/C.tsx`,
      `MAUDE_SESSION_ROOT=${b} maude design read-annotations ui/C.tsx --root ${b}`,
      'env MAUDE_AGENT_ACTOR=x maude design read-annotations ui/C.tsx',
      'env -u MAUDE_HOOK_SESSION maude design read-annotations ui/C.tsx',
      'env -i maude design read-annotations ui/C.tsx',
      `export CLAUDE_PROJECT_DIR=${b}; maude design read-annotations ui/C.tsx`,
      'unset MAUDE_CHAT_ID; maude design assets',
      // V2-8.9 H2 — the chat's read boundary is the bridge's to set, never the command's.
      'MAUDE_READ_ROOTS=/ maude design import-asset /etc/hosts',
      'env -u MAUDE_READ_ROOTS maude design ingest-footage ~/maude-p8-probe',
      'export MAUDE_GRANTS_FILE=/tmp/g.json; maude design import-asset ~/x.png',
    ];
    for (const cmd of DENY) assert.equal(c(cmd), 'out-of-project', cmd);
    const PASS = [
      `maude design read-annotations ui/C.tsx --root ${a}`,
      `maude design read-annotations ui/C.tsx --root ${join(base, 'a-link')}`,
      'maude design read-annotations ui/C.tsx --root .',
      'maude design read-annotations ui/C.tsx',
      `cd ${a}/.design && maude design assets`,
      'cd /tmp && maude design slug x',
      // a word the reader can't see fails open (the dispatcher holds it)
      'maude design read-annotations ui/C.tsx --root "$ROOT"',
      'FOO=1 maude design assets',
      `cd ${b} && ls`, // not a maude call
      `export CLAUDE_PROJECT_DIR=${b}`, // no maude verb in the call
    ];
    for (const cmd of PASS) assert.equal(c(cmd), null, cmd);
    // the hook's session root wins over a cwd the agent cd'd into earlier
    assert.equal(
      c('maude design read-annotations ui/C.tsx', { cwd: b, root: b, sessionRoot: a }),
      'out-of-project'
    );
    const r = classifyBash(`maude design assets --root ${b}`, {
      cwd: a,
      designRoot: join(a, '.design'),
      root: a,
    });
    assert.match(r.reason, /names a different project/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// S12.16 live: both refusals sent the agent to a verb that does not exist (`maude design canvas move`,
// `maude design trash move`: "unknown subcommand"), and the agent burned 15+ calls finding the real route.
test('the use-verb / use-trash messages name a route that exists', () => {
  const msg = (cmd) => classifyBash(cmd, { cwd: ROOT, designRoot: DR })?.reason ?? '';
  const mv = msg('mv .design/ui/C.tsx .design/ui/D.tsx');
  const rm = msg('rm .design/ui/C.tsx');
  assert.match(mv, /curl-local .*\/_api\/fs-move/);
  assert.match(rm, /curl-local .*\/_api\/canvas\?file=/);
  for (const m of [mv, rm]) assert.doesNotMatch(m, /design (canvas move|trash move)/);
});
