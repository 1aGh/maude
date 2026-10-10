// bash-guard — the pre-bash rules (contract V2-1.11 §5.4, narrowed by V2-1.18 §9 Q5).
// Deny the three codes on what they name; never deny a read; fail open on what can't be followed.
//
// Run: node --test cli/lib/bash-guard.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
