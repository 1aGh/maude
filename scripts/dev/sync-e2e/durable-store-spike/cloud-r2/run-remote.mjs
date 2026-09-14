// Explicitly invoked only for the freshly prepared disposable Worker and bucket.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REMOTE_PROJECTS, remoteCases } from './remote-cases.mjs';

const [flag, directory, target] = process.argv.slice(2);
assert.ok(['--disposable-run', '--resume-empty'].includes(flag));
const resume = flag === '--resume-empty';
const root = resolve(directory),
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
const url = new URL(target);
assert.equal(url.protocol, 'https:');
assert.ok(url.hostname.startsWith(manifest.name + '.') && url.hostname.endsWith('.workers.dev'));
assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
assert.equal(
  createHash('sha256')
    .update(readFileSync(join(root, 'worker.mjs')))
    .digest('hex'),
  manifest.bundleHash
);
const reportFile = join(root, resume ? 'remote-evidence-resume.json' : 'remote-evidence.json');
if (resume) {
  const prior = JSON.parse(readFileSync(join(root, 'remote-evidence.json')));
  assert.equal(prior.status, 'failed');
  assert.equal(prior.samples.length, 0);
  assert.equal(prior.manifest.bundleHash, manifest.bundleHash);
  assert.equal(prior.url, String(url));
}
assert.equal(existsSync(reportFile), false, 'do not restart an observed/uncertain remote run');
const report = {
  status: 'preparing',
  manifest,
  url: String(url),
  started: new Date().toISOString(),
  samples: [],
  cases: [],
  cleanup: [],
  limits:
    'Synthetic source/storage checks. Local host HTTP ACK and server coordinator timing, not peer UI or managed-host crash proof.',
};
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
save();
const privateFile = join(root, 'probe-token-private');
const token = resume ? readFileSync(privateFile, 'utf8').trim() : randomBytes(32).toString('hex');
assert.match(token, /^[a-f0-9]{64}$/);
if (!resume) writeFileSync(privateFile, token, { mode: 0o600, flag: 'wx' });
let requestsStarted = false;
async function call(command) {
  const start = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ actor: 'actor', ownerEpoch: 1, ...command }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text();
  const diagnostic = {
    status: response.status,
    contentType: response.headers.get('content-type'),
    prefix: body.replaceAll(token, '[redacted]').slice(0, 256),
  };
  if (response.status !== 200) {
    report.httpFailure = diagnostic;
    throw new Error('Unexpected diagnostic HTTP status');
  }
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    report.httpFailure = diagnostic;
    throw new Error('Invalid diagnostic JSON response');
  }
  if (command.kind === 'append')
    report.samples.push({
      project: command.project,
      transactionId: JSON.parse(command.raw).transactionId,
      status: result.status,
      code: result.code,
      clientAckMs: performance.now() - start,
      coordinatorMs: Number(response.headers.get('server-timing')?.match(/dur=([\d.]+)/)?.[1]),
      edgeColo: response.headers.get('cf-ray')?.split('-').at(-1) || null,
    });
  return result;
}
try {
  if (!resume)
    execFileSync(
      'wrangler',
      ['secret', 'put', 'PROBE_TOKEN', '--config', join(root, 'wrangler.json')],
      {
        cwd: root,
        input: token + '\n',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      }
    );
  const unauthorized = await fetch(url, {
    method: 'POST',
    body: '{}',
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(unauthorized.status, 403);
  if (resume) {
    report.readiness = [];
    for (const project of REMOTE_PROJECTS) {
      const inventory = await call({ kind: 'inventory', project });
      report.readiness.push({ project, inventory });
      save();
      assert.equal(inventory.head?.revision, 0);
      assert.equal(inventory.head?.epoch, 1);
      assert.deepEqual(inventory.counts, { actions: 0, results: 0, documents: 0 });
      assert.deepEqual(inventory.payloads, { count: 0, bytes: 0 });
    }
  }
  requestsStarted = true;
  report.status = 'running';
  save();
  report.cases = await remoteCases(call);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // Child-process exceptions can contain stdout; retain only a safe classification.
  report.failure = { type: error.name, code: error.code || null };
  process.exitCode = 1;
} finally {
  if (requestsStarted) {
    for (const project of REMOTE_PROJECTS) {
      try {
        const result = await call({ kind: 'cleanup', project });
        assert.equal(result.status, 'cleaned');
        assert.equal(result.remaining, 0);
        report.cleanup.push({ project, ...result });
      } catch {
        report.cleanup.push({ project, status: 'pending' });
        process.exitCode = 1;
      }
    }
  }
  if (
    report.cleanup.length === REMOTE_PROJECTS.length &&
    report.cleanup.every((c) => c.status === 'cleaned')
  )
    unlinkSync(privateFile);
  else report.privateRecoveryTokenRetained = true;
  report.finished = new Date().toISOString();
  report.latency = {};
  for (const size of [1024, 65536]) {
    const seen = new Set();
    const rows = report.samples.filter((row) => {
      if (
        row.project !== `remote-${size}` ||
        row.status !== 'accepted' ||
        !/^tx-\d+$/.test(row.transactionId) ||
        seen.has(row.transactionId)
      )
        return false;
      seen.add(row.transactionId);
      return true;
    });
    const summary = { samples: rows.length };
    for (const metric of ['coordinatorMs', 'clientAckMs']) {
      const values = rows.map((row) => row[metric]).sort((a, b) => a - b);
      if (!values.length || values.some((value) => !Number.isFinite(value))) continue;
      summary[metric] = {
        min: values[0],
        max: values.at(-1),
        median:
          (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2,
        sampleP95: values[Math.ceil(values.length * 0.95) - 1],
      };
    }
    report.latency[size] = summary;
  }
  save();
  console.log(
    JSON.stringify({
      status: report.status,
      cases: report.cases.length,
      cleanup: report.cleanup,
      evidence: reportFile,
      infrastructureRemoval: 'Worker and empty bucket still require explicit teardown',
    })
  );
}
