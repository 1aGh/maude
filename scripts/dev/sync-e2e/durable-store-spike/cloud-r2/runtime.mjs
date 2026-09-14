import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

export async function start(
  directory,
  kills,
  { disposable = false, noR2 = false, inlineLimitBytes = 33554432 } = {}
) {
  const token = randomUUID();
  const prefix = disposable ? `maude-sync-conformance/${randomUUID()}` : 'probe';
  const child = fork(new URL('./process.mjs', import.meta.url), [directory], {
    detached: true,
    env: {
      ...process.env,
      MAUDE_PROBE_TOKEN: token,
      MAUDE_PROBE_PREFIX: prefix,
      MAUDE_DISPOSABLE_ONLY: String(disposable),
      MAUDE_NO_R2: String(noR2),
      MAUDE_INLINE_LIMIT: String(inlineLimitBytes),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stderr.on('data', (bytes) => {
    output = (output + bytes).slice(-4000);
  });
  child.stdout.on('data', () => {});
  const events = [],
    waiters = [];
  child.on('message', (event) => {
    const index = waiters.findIndex((item) => item.match(event));
    if (index >= 0) {
      const [item] = waiters.splice(index, 1);
      item.resolve(event);
    } else events.push(event);
  });
  function message(match) {
    const index = events.findIndex(match);
    if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = {
        match,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(item);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`runtime event deadline: ${output}`));
      }, 15000);
      waiters.push(item);
    });
  }
  let ready;
  try {
    ready = await message((m) => m.type === 'ready');
  } catch (error) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    throw error;
  }
  return {
    child,
    prefix,
    stage: (stage) => message((m) => m.type === 'checkpoint' && m.stage === stage),
    resume: (checkpoint) => child.send({ kind: 'resume', checkpoint }),
    async r2(operation, fields = {}) {
      const id = randomUUID();
      const response = message((m) => m.type === 'control' && m.id === id);
      child.send({ kind: 'r2', id, operation, ...fields });
      const value = await response;
      if (value.error) throw new Error(value.error);
      return value.value;
    },
    async call(command, { authenticated = true } = {}) {
      const response = await fetch(ready.url, {
        method: 'POST',
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ actor: 'actor', project: 'test', ownerEpoch: 1, ...command }),
        signal: AbortSignal.timeout(20000),
      });
      if (!authenticated) return { status: response.status };
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    },
    async kill(reason = 'cleanup') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const group = execFileSync('ps', ['-eo', 'pid,pgid,comm'], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().split(/\s+/, 3))
        .filter(([, pgid]) => Number(pgid) === child.pid);
      const workerdPids = group
        .filter(([, , comm]) => comm?.includes('workerd'))
        .map(([pid]) => Number(pid));
      assert.ok(workerdPids.length, 'actual workerd must be in the private process group');
      const done = once(child, 'exit');
      process.kill(-child.pid, 'SIGKILL');
      assert.equal((await done)[1], 'SIGKILL');
      kills.push({ reason, wrapperPid: child.pid, workerdPids, signal: 'SIGKILL' });
    },
  };
}
