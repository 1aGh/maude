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
