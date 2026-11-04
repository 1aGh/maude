import { afterEach, expect, test } from 'bun:test';
import { createIndexLoader } from '../client/index-loader.ts';

const loaders: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const loader of loaders.splice(0)) loader.dispose();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  const end = Date.now() + 1000;
  while (!check() && Date.now() < end) await Bun.sleep(2);
  expect(check()).toBe(true);
}
function setup(read: (signal: AbortSignal) => Promise<string>, options = {}) {
  const applied: string[] = [];
  const errors: unknown[] = [];
  const loader = createIndexLoader({
    read,
    apply: (value) => applied.push(value),
    onError: (error) => errors.push(error),
    retryDelayMs: 5,
    maxRetryDelayMs: 10,
    ...options,
  });
  loaders.push(loader);
  return { ...loader, applied, errors };
}
test('two transient errors recover without another caller', async () => {
  let calls = 0;
  const loader = setup(async () => {
    if (++calls <= 2) throw Object.assign(new Error('Unavailable'), { status: 502 });
    return 'current tree';
  });
  await loader.reload();
  await until(() => loader.applied.length === 1);
  expect(calls).toBe(3);
  expect(loader.errors).toHaveLength(2);
  expect(loader.applied).toEqual(['current tree']);
});
test('refresh during a request skips stale data and all callers await the fresh result', async () => {
  const first = deferred<string>(),
    second = deferred<string>();
  let calls = 0;
  let primed = false;
  const loader = setup(() =>
    !primed ? Promise.resolve('shown tree') : ++calls === 1 ? first.promise : second.promise
  );
  await loader.reload();
  // #204 — a tree is on screen, so a stale answer may wait for the fresh one
  primed = true;
  loader.applied.splice(0);
  const beforeMutation = loader.reload();
  const afterMutation = loader.reload();
  const repeated = loader.reload();
  expect(calls).toBe(1);
  first.resolve('stale tree');
  await until(() => calls === 2);
  expect(loader.applied).toEqual([]);
  second.resolve('fresh tree');
  await Promise.all([beforeMutation, afterMutation, repeated]);
  expect(loader.applied).toEqual(['fresh tree']);
  expect(calls).toBe(2);
});
// #204 (task L) — a ~311-canvas workspace: while the hub materialised the tree, every arriving
// file asked for a reload, so each answer was already "stale" when it landed and was thrown away —
// the browser drew nothing until the arrivals stopped. The FIRST tree is drawn even if a refresh
// is already queued behind it.
test('#204: a first answer is drawn even while refreshes keep arriving', async () => {
  const gates: Array<ReturnType<typeof deferred<string>>> = [];
  const loader = setup(() => {
    const d = deferred<string>();
    gates.push(d);
    return d.promise;
  });
  void loader.reload();
  for (let i = 0; i < 3; i++) {
    await until(() => gates.length === i + 1);
    void loader.reload(); // another file arrived while this read was in flight
    gates[i].resolve(`tree ${i}`);
  }
  await until(() => gates.length === 4);
  expect(loader.applied[0]).toBe('tree 0');
  gates[3].resolve('tree 3');
  await until(() => loader.applied.at(-1) === 'tree 3');
});

// #204 — a slow server (a large index on a small cell) answered after the fixed 10 s abort, so
// the client aborted and asked again forever (ERR_ABORTED again and again), each retry adding
// another full index build on the server. A timeout now doubles each time it fires in a row.
test('#204: a slow index gets longer each time it times out, instead of the same abort forever', async () => {
  const waited: number[] = [];
  let calls = 0;
  const loader = setup(
    (signal) => {
      if (++calls > 3) return Promise.resolve('finally');
      const t0 = Date.now();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            waited.push(Date.now() - t0);
            reject(new Error('Timeout'));
          },
          { once: true }
        )
      );
    },
    { timeoutMs: 20 }
  );
  await loader.reload();
  await until(() => loader.applied.length === 1);
  expect(waited).toHaveLength(3);
  expect(waited[1]).toBeGreaterThanOrEqual(38);
  expect(waited[2]).toBeGreaterThanOrEqual(78);
});

test('dispose cancels a scheduled recovery', async () => {
  let calls = 0;
  const loader = setup(async () => {
    calls++;
    throw new Error('Offline');
  });
  await loader.reload();
  loader.dispose();
  await Bun.sleep(30);
  expect(calls).toBe(1);
});
test('dispose aborts in-flight IO and rejects a late response without publishing it', async () => {
  const response = deferred<string>();
  let signal!: AbortSignal;
  const loader = setup((s) => {
    signal = s;
    return response.promise;
  });
  const request = loader.reload();
  loader.dispose();
  expect(signal.aborted).toBe(true);
  response.resolve('late tree');
  await request;
  expect(loader.applied).toEqual([]);
  await loader.reload();
  expect(loader.applied).toEqual([]);
});
test('hung abort-aware fetch times out and the next request recovers', async () => {
  let calls = 0;
  const loader = setup(
    (signal) => {
      if (++calls > 1) return Promise.resolve('ready');
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Timeout')), { once: true })
      );
    },
    { timeoutMs: 5 }
  );
  await loader.reload();
  await until(() => loader.applied.length === 1);
  expect(loader.applied).toEqual(['ready']);
  expect(calls).toBe(2);
});
test('authorization failures do not start a polling loop; explicit refresh still works', async () => {
  let calls = 0;
  const loader = setup(async () => {
    if (++calls === 1) throw Object.assign(new Error('Forbidden'), { status: 403 });
    return 'authorized';
  });
  await loader.reload();
  await Bun.sleep(30);
  expect(calls).toBe(1);
  await loader.reload();
  expect(loader.applied).toEqual(['authorized']);
});
test('application of malformed data is retried without discarding the previous tree', async () => {
  let calls = 0;
  const applied: string[] = ['last good'];
  const loader = createIndexLoader({
    read: async () => (++calls === 1 ? 'bad' : 'good'),
    apply: (value) => {
      if (value === 'bad') throw new Error('Invalid index');
      applied.push(value);
    },
    onError: () => {},
    retryDelayMs: 5,
  });
  loaders.push(loader);
  await loader.reload();
  expect(applied).toEqual(['last good']);
  await until(() => applied.length === 2);
  expect(applied).toEqual(['last good', 'good']);
});
