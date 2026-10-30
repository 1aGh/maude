// ai/write-claim-scope.ts — the request-scoped claimant of studio source writes (p8-a1-claims), on its own.
//
// Split out of write-claim.ts so code that only ASKS "who is this write for?" (ai/save-hold.ts, reached from
// canvas-edit.ts and so from the standalone `maude design` helpers) doesn't load write-claim.ts's sync codec —
// that pulls yjs/y-protocols/lib0 into every helper's npm closure (cli/lib/helper-deps.test.mjs).

import { AsyncLocalStorage } from 'node:async_hooks';

/** The live run a request's writes belong to. */
export interface WriteClaimRun {
  runId: string;
  chatId: string;
  label: string;
}

/**
 * p8-sec2-attrib A2 — "no claimant here", stored explicitly. AsyncLocalStorage carries a store into every
 * continuation of the code that ran under it (setTimeout included), so a scope that merely did not SET a
 * claim inherited the outer one: a held person's save landed from a timer a claimed request had set, or
 * inside a flush POST that carried `X-Maude-Chat`, was claimed for the AI run. A sentinel store leaves it.
 */
const NONE = Symbol('no write claim');
const scope = new AsyncLocalStorage<WriteClaimRun | typeof NONE>();

/** Run `fn` with `run` as the claimant of every studio source write it makes (null: no claimant at all). */
export function withWriteClaim<T>(run: WriteClaimRun | null, fn: () => T): T {
  return scope.run(run ?? NONE, fn);
}

/** Run `fn` — and everything it schedules — with no claimant, whatever claim the caller is inside. */
export function noWriteClaim<T>(fn: () => T): T {
  return scope.run(NONE, fn);
}

/** The run the current request writes for, or null (a person's request, or none at all). */
export function currentWriteClaim(): WriteClaimRun | null {
  const s = scope.getStore();
  return s === undefined || s === NONE ? null : s;
}
