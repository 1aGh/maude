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

const scope = new AsyncLocalStorage<WriteClaimRun>();

/** Run `fn` with `run` as the claimant of every studio source write it makes (null: no claimant). */
export function withWriteClaim<T>(run: WriteClaimRun | null, fn: () => T): T {
  return run ? scope.run(run, fn) : fn();
}

/** The run the current request writes for, or null (a person's request, or none at all). */
export function currentWriteClaim(): WriteClaimRun | null {
  return scope.getStore() ?? null;
}
