// Plan T34 / writer registry H09 — the checkout of a project that saves through
// accepted revisions (DDR-241) is a PROJECTION of the shared history, not a
// second author.
//
// A Git operation that rewrites the checkout's files — switching or adding a
// draft, discarding, getting latest, resolving a merge — would change files
// under the sync runtime, and its watcher would propose the result as this
// person's edit: a local Git graph silently overriding what the team accepted.
// In that mode these routes refuse, and say where the same intent lives:
// History (restore an earlier version as a new action). Commit, branch, push
// and fetch stay — they touch the Git graph, not the files (H10).

/** The `/_api/git/*` routes that rewrite checkout files. */
export const CHECKOUT_REWRITING_GIT_ROUTES = [
  '/_api/git/checkout',
  '/_api/git/fold',
  '/_api/git/discard',
  '/_api/git/pull',
  '/_api/git/resolve',
] as const;

export const ACCEPTED_GIT_REFUSAL = {
  ok: false,
  code: 'accepted-project',
  error:
    'This project saves through its shared history, so its files cannot be rewritten from Git here. To go back to an earlier version, restore it from History — it becomes a new change everyone sees.',
} as const;

/** A refusal when the linked project is in accepted-revisions mode, else null. */
export function refuseCheckoutRewrite(acceptedMode: (() => boolean) | undefined): Response | null {
  if (acceptedMode?.() !== true) return null;
  return Response.json(ACCEPTED_GIT_REFUSAL, {
    status: 409,
    headers: { 'Cache-Control': 'no-store' },
  });
}
