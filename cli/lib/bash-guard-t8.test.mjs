// 2.1.1 T8 — a team-server sign-in (start, and its address check) and saving a team-server credential
// are the person's acts in the Maude window, like the Maude Cloud sign-in: the AI session's bash guard
// names them human-only before the command runs. Reading is fine; Link your server keeps its own row.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyBash } from './bash-guard.mjs';

const ROOT = '/p';
const DR = '/p/.design';
const code = (cmd) => classifyBash(cmd, { cwd: ROOT, designRoot: DR })?.code ?? null;
const B = 'http://127.0.0.1:4399/_api';

test('T8: a write to hub-signin/start|check or hub/link is human-only', () => {
  const DENY = [
    `maude design curl-local --method POST ${B}/hub-signin/start --data '{"url":"https://h.example"}'`,
    `curl -X POST ${B}/hub-signin/check -d '{"url":"https://h.example"}'`,
    `curl -d '{"url":"https://h.example","token":"t"}' ${B}/hub/link`,
    `node -e "fetch('${B}/hub/link',{method:'POST'})"`,
  ];
  for (const cmd of DENY) assert.equal(code(cmd), 'human-only', cmd);
  assert.match(classifyBash(DENY[0], { cwd: ROOT, designRoot: DR }).reason, /^human-only: /);
  for (const cmd of [
    `curl -s ${B}/hub-signin/poll`,
    "rg -n 'hub-signin/start' apps/studio",
    "grep -rn '_api/hub/link' apps/studio/routes",
  ])
    assert.equal(code(cmd), null, cmd);
  // Link your server is still its own row
  assert.match(
    classifyBash(`curl -X POST ${B}/hub/link-folder`, { cwd: ROOT, designRoot: DR }).reason,
    /Link your server/
  );
});
