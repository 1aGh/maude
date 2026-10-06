#!/usr/bin/env node
// S12 on a deployed backend: a large file through the resumable upload door.
// The hub is SIGKILLed half way; the session resumes from the parts it had
// verified; a corrupted part is refused; completion is sent twice (a lost
// answer) and lands one object; a declared hash the bytes do not match, and a
// size over the project's ceiling, land nothing. The object is then read back
// through the hub and found in the tenant's object storage.
//
//   node s12-uploads.mjs --work <selfhost dir> --out <dir> --kill "<cmd>" --start "<cmd>"
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const out = arg('out');
mkdirSync(out, { recursive: true });
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
let token = fx.sessions.a.token;
const cloud = fx.backend === 'cloud';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tag = randomBytes(3).toString('hex');
const call = async (method, route, body, headers = {}) => {
  const r = await fetch(`${fx.url}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const size = 120 * 1024 * 1024;
const bytes = randomBytes(size);
const whole = sha(bytes);
const path = `assets/f3-large-${tag}.mp4`;
const result = { path, size, sha256: whole };

const session = await call('POST', '/api/file-uploads', { path, size, sha256: whole });
assert.ok([200, 201].includes(session.status), `session ${session.status} ${JSON.stringify(session.body)}`);
let { id } = session.body;
const { partBytes, parts } = session.body;
const part = (n) => bytes.subarray(n * partBytes, Math.min(size, (n + 1) * partBytes));
const put = (n, data = part(n), claimed = sha(part(n))) =>
  call('PUT', `/api/file-uploads/${id}/${n}`, new Uint8Array(data), {
    'content-type': 'application/octet-stream',
    'x-maude-part-sha256': claimed,
  });
const half = Math.floor(parts / 2);
for (let n = 0; n < half; n++) assert.equal((await put(n)).status, 200, `part ${n}`);
// The hub dies with a part in flight.
const inflight = put(half).catch(() => null);
await new Promise((r) => setTimeout(r, 50));
execSync(arg('kill'), { stdio: 'ignore' });
await inflight;
execSync(arg('start'), { stdio: 'ignore' });
// A cloud cell's sessions live on its disposable disk: a restart signs everyone
// out, and a real desktop renews through the control plane. Do the same.
if (fx.backend === 'cloud') {
  const { loadBackend } = await import('./backend.mjs');
  token = (await loadBackend('cloud', { cache: null })).tokens.a.token;
}
const resumed = await call('GET', `/api/file-uploads/${id}`);
result.resume = {
  status: resumed.status,
  receivedAfterRestart: resumed.body?.received?.length ?? null,
  verifiedBeforeKill: half,
};
if (!Array.isArray(resumed.body?.received)) {
  // Recorded as the finding it is, then carried on the way the desktop does:
  // ask again (creation is idempotent) and send what the hub does not hold.
  result.resume.lostAcrossRestart = { status: resumed.status, error: resumed.body?.error ?? null };
  const again = await call('POST', '/api/file-uploads', { path, size, sha256: whole });
  assert.ok([200, 201].includes(again.status), `re-created session ${again.status}`);
  id = again.body.id;
  result.resume.recreated = { received: again.body.received?.length ?? 0 };
}
// A corrupted copy of a part the hub does not have yet is refused and not kept.
const missing = (await call('GET', `/api/file-uploads/${id}`)).body.received;
const target = [...Array(parts).keys()].find((n) => !missing.includes(n));
const bad = Buffer.from(part(target));
bad[0] ^= 0xff;
const refused = await put(target, bad, sha(part(target)));
result.corruptPart = {
  part: target,
  status: refused.status,
  keptAfter: (await call('GET', `/api/file-uploads/${id}`)).body.received.includes(target),
};
for (let n = 0; n < parts; n++)
  if (!(await call('GET', `/api/file-uploads/${id}`)).body.received.includes(n))
    assert.equal((await put(n)).status, 200, `resend part ${n}`);
const done1 = await call('POST', `/api/file-uploads/${id}/complete`);
const done2 = await call('POST', `/api/file-uploads/${id}/complete`); // the first answer "lost"
result.complete = { first: done1.status, second: done2.status, sameReceipt: JSON.stringify(done1.body) === JSON.stringify(done2.body) };
// Read back through the hub.
const back = await fetch(`${fx.url}/${path}`, { headers: { authorization: `Bearer ${token}` } });
result.readBack = { status: back.status, sha256Matches: sha(Buffer.from(await back.arrayBuffer())) === whole };
// The self-hosted hub's checkout is on this machine; the cloud cell's is not.
const checkoutDir = join(work, 'repo', '.design', 'assets');
result.checkout = cloud
  ? { notOnThisMachine: true }
  : {
      present: existsSync(join(checkoutDir, `f3-large-${tag}.mp4`)),
      strayTemps: readdirSync(checkoutDir).filter((n) => n.includes(`f3-large-${tag}`) && n !== `f3-large-${tag}.mp4`),
    };
// Object storage (the tenant's R2 prefix), through the hub's own S3 adapter.
const { listObjects } = await import(join(REPO, 'apps/hub/src/s3.mjs'));
const { hostS3Config } = await import('./s3-fixture.mjs');
const cfg = await hostS3Config();
const prefix = cloud ? `tenants/${fx.projectId}/assets/` : fx.assetPrefix ? `${fx.assetPrefix}/assets/` : 'assets/';
// A self-hosted hub keeps an UNSCOPED namespace (asset-key.mjs) and mirrors
// write-behind, so look for the object by name for a while.
let seen = [];
const end = Date.now() + 120000;
while (!seen.length && Date.now() < end) {
  seen = (await listObjects(cfg, prefix)).filter((o) => String(o.key).includes(`f3-large-${tag}`));
  if (!seen.length) await new Promise((r) => setTimeout(r, 3000));
}
result.objectStorage = {
  objects: seen.map((o) => ({ key: o.key, size: o.size })),
  sizeMatches: seen.some((o) => Number(o.size) === size),
};
// A declared hash the bytes do not match lands nothing.
const small = randomBytes(parts > 0 ? partBytes + 1024 : 1024);
const wrongPath = `assets/f3-wrong-hash-${tag}.mp4`;
const wrong = await call('POST', '/api/file-uploads', { path: wrongPath, size: small.length, sha256: sha(Buffer.from('not these bytes')) });
if ([200, 201].includes(wrong.status)) {
  const w = wrong.body;
  for (let n = 0; n < w.parts; n++) {
    const d = small.subarray(n * w.partBytes, Math.min(small.length, (n + 1) * w.partBytes));
    await call('PUT', `/api/file-uploads/${w.id}/${n}`, new Uint8Array(d), { 'content-type': 'application/octet-stream', 'x-maude-part-sha256': sha(d) });
  }
  const c = await call('POST', `/api/file-uploads/${w.id}/complete`);
  result.wrongWholeHash = { status: c.status, landed: cloud ? null : existsSync(join(checkoutDir, `f3-wrong-hash-${tag}.mp4`)) };
} else result.wrongWholeHash = { status: wrong.status, landed: false, refusedAtCreation: true };
await new Promise((r) => setTimeout(r, 10000)); // past one write-behind round
result.objectStorage.wrongHashObjectAbsent = !(await listObjects(cfg, prefix)).some((o) =>
  String(o.key).includes(`f3-wrong-hash-${tag}`)
);
// Over the project's ceiling is refused at the door.
const huge = await call('POST', '/api/file-uploads', { path: `assets/f3-huge-${tag}.mp4`, size: 3 * 1024 * 1024 * 1024, sha256: whole });
result.overCeiling = { status: huge.status, error: huge.body?.error ?? null };
result.status =
  !result.resume.lostAcrossRestart &&
  result.resume.receivedAfterRestart >= half &&
  result.corruptPart.status >= 400 &&
  result.corruptPart.keptAfter === false &&
  result.complete.first === 200 &&
  result.complete.second === 200 &&
  result.complete.sameReceipt &&
  result.readBack.status === 200 &&
  result.readBack.sha256Matches &&
  (cloud || (result.checkout.present && result.checkout.strayTemps.length === 0)) &&
  result.objectStorage.sizeMatches &&
  result.objectStorage.wrongHashObjectAbsent &&
  result.wrongWholeHash.status >= 400 &&
  !result.wrongWholeHash.landed &&
  result.overCeiling.status >= 400
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's12-uploads.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
