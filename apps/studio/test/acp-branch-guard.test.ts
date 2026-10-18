// feature-acp-write-path-scope Addendum, Task 9 — the branch-switch warning.
//
// Version history › Advanced (`branch-actions.js`, S11.10 — moved from the project dock) has THREE
// `reload()` call sites (`switchDraft`, `createDraft`, and the local-merge fold in `foldDraft`). All
// three move the worktree, so all three need the gate; covering one and missing
// two is the easy mistake, which is why the source-shape assertion below exists
// alongside the copy tests.
//
// Why the wording matters enough to test: this is a safety prompt, and Task 8
// changed what is TRUE about it. Before, the reload killed the running turn, so
// "this will stop it" was accurate. Now the bridge outlives its socket, so the
// turn keeps going — into a worktree that has moved under it. "Will stop it"
// would now be false in the reassuring direction.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chatGuardCopy } from '../client/v2/history/git-model.js';

describe('chatGuardCopy', () => {
  const one = chatGuardCopy({ count: 1, branch: 'draft-a', verb: 'switch to “main”' });

  test('names the branch, the action, and the real consequence', () => {
    expect(one.title).toBe('A chat is working right now');
    expect(one.body).toContain('draft-a');
    expect(one.body).toContain('switch to “main”');
    expect(one.body).toContain('wrong branch');
  });

  test('does NOT claim the switch stops the chat (it no longer does — Task 8)', () => {
    const all = `${one.title} ${one.body} ${one.meta}`.toLowerCase();
    expect(all).not.toContain('will stop it');
    // …and it does say the thing that IS true: the agent is actively editing.
    expect(one.body).toContain('editing files on');
  });

  test('is honest that History cannot undo this', () => {
    // The `_history/` snapshot stack is per-canvas-slug with NO branch
    // awareness, so the "it's reversible" reassurance this whole feature leans
    // on genuinely does not hold across a checkout. Promising rollback here
    // would be the one lie that makes the confirm worse than no confirm.
    expect(one.body).toContain("History can't undo");
  });

  test('pluralizes when several chats are running', () => {
    expect(chatGuardCopy({ count: 3, branch: 'x', verb: 'y' }).title).toBe(
      '3 chats are working right now'
    );
  });

  test('the confirm is not the safe default', () => {
    // "Wait" is the cancel; "Do it anyway" is the deliberate, phrased-as-a-risk
    // confirm. A neutral "OK/Cancel" pair would read as routine.
    expect(one.cancel).toBe('Wait');
    expect(one.confirm).toBe('Do it anyway');
  });
});

describe('all THREE reload call sites are gated', () => {
  const src = readFileSync(
    join(import.meta.dir, '..', 'client', 'v2', 'history', 'branch-actions.js'),
    'utf8'
  );

  test('every reload lives in a `do*` action reached only through guardedByChat', () => {
    // Source-shape guard rather than a render test: the failure mode is a
    // FOURTH reload being added later without a gate, which no render test of
    // the existing three would catch.
    const guarded = src.match(/guardedByChat\(/g) ?? [];
    // One definition + three call sites.
    expect(guarded.length).toBeGreaterThanOrEqual(4);
    for (const fn of ['doSwitchDraft', 'doCreateDraft', 'doFoldDraft']) {
      expect(src).toContain(`function ${fn}`);
    }
  });

  test('the gate asks the SERVER, not local chat state', () => {
    // A bridge can be running DETACHED (post-reload, pre-re-attach) with no
    // client that knows about it — precisely the case the warning is for. Local
    // busy state would answer "nothing is running" exactly when it matters.
    expect(src).toContain('/_api/acp/running');
  });

  test('a failed probe never BLOCKS a switch', () => {
    // A switch the user asked for must not be hostage to an unrelated fetch
    // error. The catch returns 0 (⇒ proceed), not a thrown error.
    expect(src).toMatch(/catch\s*{[\s\S]*?return 0;/);
  });
});

// SECURITY (security-auditor A6) — cross-PROJECT loopback adjacency.
//
// Before the sidecar pool (Addendum Task 10) at most one dev-server ran at a
// time, so "another Maude instance on another loopback port" was not a state the
// product produced. The pool makes concurrency DESIGNED-IN: projects A and B now
// routinely run side by side on different ports, and A's canvas iframe is
// untrusted content (DDR-054). So the question "can A's canvas reach B's
// privileged main origin?" went from hypothetical to worth an explicit test.
//
// The defence is `sameOriginWrite`'s host+port compare — different instance,
// different port, different `host`, rejected. Asserting it here so the property
// is pinned to the pool's introduction rather than left as an inference.
describe('cross-project origin adjacency (A6)', () => {
  test('a request from ANOTHER instance’s origin is not same-origin', async () => {
    const { sameOriginWrite } = await import('../http.ts');
    const projectB = new Request('http://localhost:4400/_api/acp/running', {
      method: 'POST',
      // Project A's canvas/main origin, aimed at project B's server.
      headers: { origin: 'http://localhost:4399' },
    });
    expect(sameOriginWrite(projectB)).toBe(false);
  });

  test('a request from the SAME instance is allowed (the pool must not break normal use)', async () => {
    const { sameOriginWrite } = await import('../http.ts');
    const own = new Request('http://localhost:4400/_api/acp/running', {
      method: 'POST',
      headers: { origin: 'http://localhost:4400' },
    });
    expect(sameOriginWrite(own)).toBe(true);
  });
});
