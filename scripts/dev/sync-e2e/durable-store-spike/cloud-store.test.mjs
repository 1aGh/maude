import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const evidenceDir =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-do-proof-'));
mkdirSync(evidenceDir, { recursive: true });
const kills = [];
after(() => {
  const require = createRequire(process.env.MAUDE_MINIFLARE_ENTRY);
  const files = ['cloud-worker.mjs', 'cloud-process.mjs', 'cloud-store.test.mjs'];
  writeFileSync(
    join(evidenceDir, 'evidence.json'),
    JSON.stringify(
      {
        node: process.version,
        miniflare: require('../../package.json').version,
        workerd: require('workerd/package.json').version,
        runtime: 'local workerd; not deployed Cloudflare',
        kills,
        files: files.map((path) => ({
          path,
          sha256: createHash('sha256')
            .update(readFileSync(new URL(path, import.meta.url)))
            .digest('hex'),
        })),
      },
      null,
      2
    )
  );
  console.log('Evidence: ' + evidenceDir);
});

async function start(root) {
  const child = fork(new URL('./cloud-process.mjs', import.meta.url), [root], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (b) => {
    stderr += b;
  });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`runtime startup timeout: ${stderr}`)),
      15000
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`runtime exited ${code}: ${stderr}`));
    });
    child.on('message', (m) => {
      if (m.type === 'ready') {
        clearTimeout(timeout);
        resolve(m);
      }
    });
  }).catch((error) => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    throw error;
  });
  return {
    child,
    async call(path, body, project = 'test') {
      const separator = path.includes('?') ? '&' : '?';
      const response = await fetch(
        `${ready.url.replace(/\/$/, '')}${path}${separator}project=${project}`,
        {
          method: body ? 'POST' : 'GET',
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10000),
        }
      );
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    },
    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const group = execFileSync('ps', ['-eo', 'pid,pgid,comm'], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().split(/\s+/, 3))
        .filter(([, pgid]) => Number(pgid) === child.pid);
      const workerdPids = group
        .filter(([, , command]) => command?.includes('workerd'))
        .map(([pid]) => Number(pid));
      const exited = once(child, 'exit');
      process.kill(-child.pid, 'SIGKILL');
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL');
      assert.ok(
        workerdPids.length > 0,
        'the killed private process group contained actual workerd'
      );
      kills.push({ wrapperPid: child.pid, workerdPids, signal });
    },
  };
}
const proposal = (id, body, base = 0, epoch = 1) => ({ actor: 'designer', id, body, base, epoch });

test('SQLite DO transaction rolls back each partial write; same-ID retry and tenant isolation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-do-atomic-'));
  const runtime = await start(root);
  try {
    const initial = await runtime.call('/state');
    for (const fault of ['after-action', 'after-head', 'after-result']) {
      const p = proposal(fault, fault);
      assert.equal((await runtime.call(`/append?fault=${fault}`, p)).status, 'retryable');
      assert.deepEqual(await runtime.call('/state'), initial);
    }
    const p = proposal('valid', 'EDIT');
    const accepted = await runtime.call('/append', p);
    assert.equal(accepted.status, 'accepted');
    assert.deepEqual(await runtime.call('/append', p), accepted);
    assert.equal(
      (await runtime.call('/append', { ...p, body: 'CHANGED' })).code,
      'transaction-id-reused'
    );
    assert.equal((await runtime.call('/state')).actions.length, 1);
    assert.deepEqual(await runtime.call('/state', null, 'other-project'), initial);
  } finally {
    await runtime.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent base claims serialize and persisted epoch fences old coordinator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-do-fence-'));
  const runtime = await start(root);
  try {
    const results = await Promise.all([
      runtime.call('/append', proposal('A', 'A')),
      runtime.call('/append', proposal('B', 'B')),
    ]);
    assert.equal(results.filter((r) => r.status === 'accepted').length, 1);
    assert.equal(results.filter((r) => r.code === 'base-conflict').length, 1);
    assert.equal((await runtime.call('/epoch')).epoch, 2);
    assert.equal(
      (await runtime.call('/append', proposal('stale', 'BAD', 1, 1))).code,
      'epoch-stale'
    );
    assert.equal((await runtime.call('/append', proposal('current', 'GOOD', 1, 2))).revision, 2);
  } finally {
    await runtime.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('SIGKILL after durable commit but before ACK restores result and empty renderer checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-do-crash-'));
  let runtime = await start(join(root, 'durable'));
  try {
    const checkpoint = new Promise((resolve) =>
      runtime.child.on('message', (m) => {
        if (m.type === 'committed') resolve();
      })
    );
    const p = proposal('unknown-outcome', 'SURVIVES');
    const request = runtime.call('/append?fault=lost-ack', p).catch(() => null);
    await Promise.race([
      checkpoint,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('checkpoint timeout')), 10000);
        t.unref();
      }),
    ]);
    await runtime.kill();
    await request;
    runtime = await start(join(root, 'durable'));
    const restored = await runtime.call('/state');
    assert.equal(restored.head.body, 'SURVIVES');
    assert.equal(restored.head.revision, 1);
    assert.equal(restored.actions.length, 1);
    assert.equal(restored.results.length, 1);
    assert.equal((await runtime.call('/append', p)).revision, 1);
    const emptyCheckout = join(root, 'fresh-renderer');
    mkdirSync(emptyCheckout);
    writeFileSync(join(emptyCheckout, 'canvas.tsx'), restored.actions.at(-1).body);
    assert.equal(readFileSync(join(emptyCheckout, 'canvas.tsx'), 'utf8'), 'SURVIVES');
    await runtime.kill();
    runtime = await start(join(root, 'durable'));
    assert.deepEqual(await runtime.call('/state'), restored);
  } finally {
    await runtime.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
