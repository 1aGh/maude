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
const token = fx.sessions.a.token;
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
const { id, partBytes, parts } = session.body;
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
const resumed = await call('GET', `/api/file-uploads/${id}`);
result.resume = {
  status: resumed.status,
  receivedAfterRestart: resumed.body?.received?.length ?? null,
  verifiedBeforeKill: half,
};
assert.ok(resumed.body.received.length >= half, 'verified parts survived the restart');
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
const checkoutDir = join(work, 'repo', '.design', 'assets');
result.checkout = {
  present: existsSync(join(checkoutDir, `f3-large-${tag}.mp4`)),
  strayTemps: readdirSync(checkoutDir).filter((n) => n.includes(`f3-large-${tag}`) && n !== `f3-large-${tag}.mp4`),
};
// Object storage (the tenant's R2 prefix), through the hub's own S3 adapter.
const { listObjects, s3ConfigFromEnv } = await import(join(REPO, 'apps/hub/src/s3.mjs'));
const envFile = Object.fromEntries(
  readFileSync('/tmp/maude-r2-test.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const cfg = s3ConfigFromEnv({
  MAUDE_S3_ENDPOINT: 'https://b5b596efe65abb732777c7171dc18145.r2.cloudflarestorage.com',
  MAUDE_S3_BUCKET: 'maude-multiplayer-test-20260922',
  ...envFile,
});
// A self-hosted hub keeps an UNSCOPED namespace (asset-key.mjs) and mirrors
// write-behind, so look for the object by name for a while.
let seen = [];
const end = Date.now() + 120000;
while (!seen.length && Date.now() < end) {
  seen = (await listObjects(cfg, 'assets/')).filter((o) => String(o.key).includes(`f3-large-${tag}`));
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
  result.wrongWholeHash = { status: c.status, landed: existsSync(join(checkoutDir, `f3-wrong-hash-${tag}.mp4`)) };
} else result.wrongWholeHash = { status: wrong.status, landed: false, refusedAtCreation: true };
await new Promise((r) => setTimeout(r, 10000)); // past one write-behind round
result.objectStorage.wrongHashObjectAbsent = !(await listObjects(cfg, 'assets/')).some((o) =>
  String(o.key).includes(`f3-wrong-hash-${tag}`)
);
// Over the project's ceiling is refused at the door.
const huge = await call('POST', '/api/file-uploads', { path: `assets/f3-huge-${tag}.mp4`, size: 3 * 1024 * 1024 * 1024, sha256: whole });
result.overCeiling = { status: huge.status, error: huge.body?.error ?? null };
result.status =
  result.resume.receivedAfterRestart >= half &&
  result.corruptPart.status >= 400 &&
  result.corruptPart.keptAfter === false &&
  result.complete.first === 200 &&
  result.complete.second === 200 &&
  result.complete.sameReceipt &&
  result.readBack.status === 200 &&
  result.readBack.sha256Matches &&
  result.checkout.present &&
  result.checkout.strayTemps.length === 0 &&
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
