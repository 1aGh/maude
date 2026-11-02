// V2-8.9 round 2 — the AI session's bash guard (the design plugin's pre-bash hook; every call it sees
// is an AI session, and the hook's own env — not the command's — is the trusted signal):
//   R2-M2  a write to the desktop's /_api/share/* is the person's act in the Maude window (human-only);
//   R2-L1  `maude design link|adopt` is refused outright, and a call that runs a maude verb never
//          sets/unsets MAUDE_NO_EGRESS or any AGENT_BROWSER_* (the web switch's carriers), nor uses
//          `env -u` / `env -i` at all.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { classifyBash } from './bash-guard.mjs';

const ROOT = '/p';
const DR = '/p/.design';
const code = (cmd) => classifyBash(cmd, { cwd: ROOT, designRoot: DR })?.code ?? null;
const S = 'http://127.0.0.1:4399/_api/share';

test('R2-M2: a share write is human-only; a share read is not', () => {
  const DENY = [
    `maude design curl-local ${S}/invites --method POST --data '{"email":"x@evil","role":"member"}'`,
    `maude design curl-local ${S}/links --method POST --data '{}'`,
    `maude design curl-local ${S}/links/l1 --method PATCH --data '{"role":"commenter"}'`,
    `maude design curl-local ${S}/requests/r1/approve --method POST`,
    `curl -X PATCH ${S}/people/p1 -d '{"role":"owner"}'`,
    `curl --request POST ${S}/people/p1/remove`,
    `curl -d '{}' ${S}/invites/i1/resend`,
  ];
  for (const cmd of DENY) assert.equal(code(cmd), 'human-only', cmd);
  const r = classifyBash(DENY[0], { cwd: ROOT, designRoot: DR });
  assert.match(r.reason, /Share sheet/);
  for (const cmd of [
    `maude design curl-local ${S}/people`,
    `curl ${S}/requests`,
    "rg -n '_api/share/invites' apps/studio",
  ])
    assert.equal(code(cmd), null, cmd);
});

test('R2-L1: link / adopt and the web switch’s env never ride a maude call', () => {
  const base = mkdtempSync(join(tmpdir(), 'maude-bg-r2-'));
  try {
    const a = join(base, 'a');
    mkdirSync(join(a, '.design', 'ui'), { recursive: true });
    writeFileSync(join(a, '.design', 'config.json'), '{}');
    const c = (cmd) =>
      classifyBash(cmd, { cwd: a, designRoot: join(a, '.design'), root: a })?.code ?? null;
    for (const cmd of [
      'maude design link https://hub.example --token abc',
      'maude design adopt https://hub.example --token abc',
      'maude design link https://hub.example --token abc --adopt',
      'cd /tmp && maude design adopt https://x --token y',
    ])
      assert.equal(c(cmd), 'human-only', cmd);
    for (const cmd of [
      'MAUDE_NO_EGRESS= maude design screenshot ui/C.tsx',
      'MAUDE_NO_EGRESS=0 maude design smoke',
      'env -u MAUDE_NO_EGRESS maude design screenshot ui/C.tsx',
      'AGENT_BROWSER_PROXY= maude design screenshot ui/C.tsx',
      'export AGENT_BROWSER_ARGS=--no-proxy-server; maude design canvas-rects ui/C.tsx',
      'unset MAUDE_NO_EGRESS; maude design perf ui/C.tsx',
      'env -u HOME maude design assets',
    ])
      assert.equal(c(cmd), 'out-of-project', cmd);
    for (const cmd of [
      'FOO=1 maude design assets',
      'maude design unlink --help',
      'maude design screenshot ui/C.tsx',
      'export AGENT_BROWSER_SESSION=x', // no maude verb in the call
    ])
      assert.equal(c(cmd), null, cmd);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
