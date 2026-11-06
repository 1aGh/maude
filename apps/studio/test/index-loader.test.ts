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

// #204 → #207 — a slow server answered after the client's abort, so the client aborted and asked
// again (each retry another full build on the server; #204 only doubled the patience). StudyFi's
// 13 s index met a 10 s timeout on a desktop whose files are all local: "taking a while — trying
// again…". A pending request is now never aborted or asked again; only a real error is retried.
test('#207: a slow index is waited for — never aborted, never asked again while pending', async () => {
  let calls = 0;
  let aborted = false;
  const answer = deferred<string>();
  const loader = setup(
    (signal) => {
      calls++;
      signal.addEventListener('abort', () => (aborted = true), { once: true });
      return answer.promise;
    },
    // what the pre-#207 loader read as "abort after 20 ms" (#204's test value)
    { timeoutMs: 20 }
  );
  const request = loader.reload();
  await Bun.sleep(150);
  expect(calls).toBe(1);
  expect(aborted).toBe(false);
  expect(loader.errors).toEqual([]);
  answer.resolve('slow but whole');
  await request;
  expect(loader.applied).toEqual(['slow but whole']);
  expect(calls).toBe(1);
});

// #207 — a previous run's copy is drawn at once, then asked for again with `fresh`.
test("#207: a previous run's copy is drawn, then the fresh index replaces it", async () => {
  const asked: boolean[] = [];
  const answers = ['copy', 'copy', 'real'];
  const applied: string[] = [];
  const loader = createIndexLoader<string>({
    read: async (_signal, { fresh }) => {
      asked.push(fresh);
      return answers.shift() ?? 'real';
    },
    apply: (v) => applied.push(v),
    onError: () => {},
    isStale: (v) => v === 'copy',
    staleRetryMs: 5,
    maxStaleRetryMs: 10,
  });
  loaders.push(loader);
  await loader.reload();
  await until(() => applied.includes('real'));
  // the copy is drawn at once; a server that ignores `fresh` (the route before its patch) answers
  // the copy again until its build is done; then the real one lands, and later asks are plain
  expect(applied).toEqual(['copy', 'copy', 'real']);
  expect(asked.slice(0, 3)).toEqual([false, true, true]);
  await loader.reload();
  expect(asked[asked.length - 1]).toBe(false);
});

test('#207: a copy never replaces a real index already drawn', async () => {
  const answers = ['real', 'copy'];
  const applied: string[] = [];
  const loader = createIndexLoader<string>({
    read: async () => answers.shift() ?? 'real',
    apply: (v) => applied.push(v),
    onError: () => {},
    isStale: (v) => v === 'copy',
    staleRetryMs: 5,
  });
  loaders.push(loader);
  await loader.reload();
  await loader.reload();
  await until(() => applied.length >= 2);
  expect(applied).toEqual(['real', 'real']);
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
// #207 — a dropped connection (the server closed a request it held too long) is a real error:
// it is retried, and the retry joins the server's one build.
test('a dropped connection is retried and the next request recovers', async () => {
  let calls = 0;
  const loader = setup(async () => {
    if (++calls > 1) return 'ready';
    throw new TypeError('Load failed');
  });
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
