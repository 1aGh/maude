#!/usr/bin/env node
// S07 on a deployed backend: an AI edit that touches two canvases is ONE
// action. Interrupted (the agent fails, then the app is killed), nothing of it
// is published — not half, not later by a cold start; published by the
// person's decision, it lands as a single action with both effects; asking to
// publish again adds nothing.
//
//   node s07-desktop.mjs --work <selfhost dir> --scratch <dir> --out <dir>
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasSource, loadBackend } from './backend.mjs';
import { startDesktop, startProxy, until } from './desktop.mjs';

const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const scratch = arg('scratch');
const out = arg('out');
mkdirSync(scratch, { recursive: true });
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const tag = randomBytes(3).toString('hex');
const B = await loadBackend('selfhost', { work });
const mk = async (base) => {
  const name = `${base}${tag}`;
  const src = canvasSource(name, `${base} title`);
  const doc = `ui-${name.toLowerCase()}`;
  assert.equal((await B.propose('b', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }])).status, 200);
  return { name, doc, rel: `ui/${name}.tsx`, src };
};
const P = await mk('F3AiPage');
const Q = await mk('F3AiPanel');
const port = fx.port;
const proxy = await startProxy({ listen: port + 110, target: port, control: port + 111 });
const A = await startDesktop({
  root: join(scratch, `desktop-ai-${tag}`),
  port: port + 120,
  hubUrl: `http://127.0.0.1:${port + 110}`,
  token: fx.sessions.a.token,
  role: fx.sessions.a.role,
  name: 'desktop-ai',
});
const local = (route, body) =>
  fetch(`${A.url}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const projectHead = async () => (await B.bootstrap('owner')).revision;
const accepted = async (c) => (await B.doc(c.doc, 'owner')).source;
const result = { tag };
try {
  for (const c of [P, Q]) await until(() => A.read(c.rel) === c.src, `pulled ${c.rel}`, 90000);
  const headBefore = await projectHead();
  // The agent's turn: one action across two files, written tool call by call.
  assert.equal((await local('/_api/ai/start', { file: P.rel, author: 'Claude' })).status, 200);
  const pAfter = P.src.replaceAll('F3AiPage title', 'Agent page');
  const qAfter = Q.src.replace('color: "red"', 'color: "navy"');
  A.write(P.rel, pAfter);
  await new Promise((r) => setTimeout(r, 1200));
  const midHead = await projectHead(); // half way: nothing may be published
  A.write(Q.rel, qAfter);
  await new Promise((r) => setTimeout(r, 1200));
  const failed = await local('/_api/ai/end', { file: P.rel, outcome: 'failed' });
  await new Promise((r) => setTimeout(r, 2000));
  const heldStatus = await A.status();
  // …and the app dies with the stage held. A cold start must not publish it.
  await A.kill();
  await A.restart();
  await new Promise((r) => setTimeout(r, 6000));
  const afterRestart = {
    head: await projectHead(),
    pUnchanged: (await accepted(P)) === P.src,
    qUnchanged: (await accepted(Q)) === Q.src,
    candidateKeptOnDisk: A.read(P.rel) === pAfter && A.read(Q.rel) === qAfter,
    stageHeld: JSON.stringify((await A.status()) ?? {}).includes('held'),
  };
  // The person publishes it.
  const publish = await local('/_api/project/ai-action', { choice: 'publish' });
  await until(async () => (await accepted(P)) === pAfter && (await accepted(Q)) === qAfter, 'published', 60000);
  const headPublished = await projectHead();
  const hist = (await B.history('owner', 30)).filter((h) => h.effects?.some((e) => [P.doc, Q.doc].includes(e.doc)));
  const publishedActions = hist.filter((h) => h.revision > headBefore);
  const again = await local('/_api/project/ai-action', { choice: 'publish' });
  await new Promise((r) => setTimeout(r, 3000));
  result.checks = {
    nothingPublishedMidway: midHead === headBefore,
    failedEndHeld: failed.status === 200 && failed.body?.action?.status !== 'accepted',
    heldStatusShown: JSON.stringify(heldStatus ?? {}).includes('held'),
    coldStartDidNotPublish: afterRestart.head === headBefore && afterRestart.pUnchanged && afterRestart.qUnchanged,
    candidateKeptOnDisk: afterRestart.candidateKeptOnDisk,
    publishOk: publish.status === 200 && publish.body?.ok === true,
    oneAction: publishedActions.length === 1,
    oneRevision: headPublished === headBefore + 1,
    bothEffectsInThatAction:
      publishedActions.length === 1 &&
      [P.doc, Q.doc].every((d) => publishedActions[0].effects.some((e) => e.doc === d)),
    actor: publishedActions[0]?.actor ?? null,
    secondPublishAddsNothing: again.status === 409 && (await projectHead()) === headPublished,
  };
  result.detail = { headBefore, midHead, afterRestart, headPublished, publish: publish.body, again: again.status };
} finally {
  writeFileSync(join(out, 'desktop.log'), A.log.replace(/mau_[0-9a-f]+/g, 'mau_<redacted>'));
  await A.stop();
  proxy.stop();
}
const c = result.checks ?? {};
result.status =
  c.nothingPublishedMidway &&
  c.failedEndHeld &&
  c.coldStartDidNotPublish &&
  c.candidateKeptOnDisk &&
  c.publishOk &&
  c.oneAction &&
  c.oneRevision &&
  c.bothEffectsInThatAction &&
  c.actor === fx.users.a.email &&
  c.secondPublishAddsNothing
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's07-desktop.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
void sha;
