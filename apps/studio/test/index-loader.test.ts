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
  const loader = setup(() => (++calls === 1 ? first.promise : second.promise));
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
