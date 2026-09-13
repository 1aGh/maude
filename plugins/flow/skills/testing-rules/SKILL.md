---
name: testing-rules
description: "Apply test quality rules during implementation and review: meaningful assertions, isolation and coverage."
user-invocable: false
---

# Testing Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for test file quality. These are non-negotiable.

This skill reads `boundaries` from `.ai/workflows.config.json` — every service / system listed under `boundaries.realtime`, `boundaries.video`, `boundaries.api`, `boundaries.db`, `boundaries.auth`, `boundaries.telemetry`, `boundaries.payments` is treated as a **no-mock zone**. Skip the skill with `skills.testingRules.enabled: false`.

## Iron Law — TDD process

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

**Core principle:** If you didn't watch the test fail, you don't know it tests the right thing.

### Red → Green → Refactor

1. **RED — Write failing test.** One behavior, clear name, real code (no mocks unless unavoidable). State what *should* happen, not what *does*.
2. **Verify RED — Watch it fail.** Mandatory. Run the test. Confirm it fails for the *expected reason* (feature missing), not typos. Test passes immediately? You're testing existing behavior. Fix or delete the test.
3. **GREEN — Minimal code.** Simplest implementation to pass. No "while I'm here" features, no premature abstraction. YAGNI.
4. **Verify GREEN — Watch it pass.** Mandatory. Test passes, other tests still pass, output pristine.
5. **REFACTOR — Clean up.** Remove duplication, improve names, extract helpers. Keep tests green. Don't add behavior.

### When to apply

- ✅ New features, bug fixes, refactoring, behavior changes
- ⚠️ Exceptions (ask first): throwaway prototypes, generated code, config files
- ❌ "Skip TDD just this once" = rationalization. Stop.

### Bug fix integration

Bug found? **Write failing test reproducing it.** Then fix. Test proves fix and prevents regression. Never fix bugs without a test. This applies to the `/flow:bug-fix` flow — the RCA document identifies root cause, but the fix starts with a failing test.

### Red flags — STOP and start over

- Code written before test
- Test added "later"
- Test passes immediately (didn't see it fail)
- "Keep it as reference, write tests first" (you'll adapt it)
- "Already spent X hours, deleting is wasteful" (sunk cost)
- "Tests after achieve same goals" (no — tests-after answer "what does this do?", tests-first answer "what should this do?")

### Why order matters

Tests written *after* code pass immediately. Passing immediately proves nothing — might test the wrong thing, test implementation instead of behavior, miss edge cases. Test-first forces you to see the test fail, proving it actually tests something. Tests-after are biased by your implementation; tests-first force edge case discovery before implementing.

### Pre-checkpoint checklist

Before marking task done in `/flow:execute`:

- [ ] Every new function has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for the expected reason
- [ ] Wrote minimal code to pass
- [ ] All tests pass; output pristine
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.

## Rules

1. **No `any` type in test files.** All test variables, mocks, and parameters must have explicit types. Using `any` defeats type-safe testing.

2. **No `.skip()` without a linked issue.** Every skipped test must include a comment linking to an issue with the reason and re-enable condition:

   ```typescript
   // TODO: re-enable after fixing #123
   it.skip('should handle edge case', () => { ... });
   ```

3. **No snapshot tests without justification.** Snapshot tests are fragile and often mask real changes. If used, include a comment explaining why snapshot was chosen over explicit assertions.

4. **Colocate test files.** Either next to source (`module.ts` → `module.test.ts`) or in a `__tests__/` directory under the source dir. Never in a separate top-level `tests/` directory disconnected from source.

5. **One assertion concept per test.** Each test verifies one behavior. Multiple assertions OK if they verify the same concept (e.g. checking multiple properties of one return value). Unrelated behaviors must be split.

6. **No mocking of declared boundaries.** Every service in `boundaries.*` is a no-mock zone:
   - `boundaries.realtime` — sync engines (Yjs, Liveblocks, Partykit, Y-WebSocket, Automerge…). Use in-memory providers or a real test instance. Mocks mask migration and conflict-resolution regressions.
   - `boundaries.db` — schemas, migrations, RLS policies. Use a real test database (Docker, tmpfs Postgres, SQLite-in-memory). ORM mocks hide schema drift.
   - `boundaries.api` — internal RPC layers (tRPC, gRPC, GraphQL gateway). Test the procedure, not a stub of it.
   - `boundaries.auth` — session token storage, JWT claims, RLS context. Mocks here hide privilege escalation bugs.
   - `boundaries.video`, `boundaries.payments`, `boundaries.telemetry` — use sandbox / test mode of the real provider when feasible. Mock only when the provider has no sandbox.

7. **Cross-platform shared logic lives in shared packages.** Tests for shared logic (hooks, state, types) run on the shared package, never duplicated per app. Duplicated tests in `apps/web/`, `apps/mobile/`, etc. drift; the shared package is the single source of truth. `scenario-runner` subagent verifies rendered behavior across platforms — unit tests verify logic.

## Rationale

- **No `any`** → Tests catch type regressions, which they can't with `any`.
- **No unlinked `.skip()`** → Skipped tests accumulate silently. Linking to issues creates accountability.
- **No unjustified snapshots** → Snapshots breaking on every change train developers to blindly update them, losing their value.
- **Colocation** → Tests near source are easier to find, update, maintain.
- **One concept per test** → When a test fails, the failure message should tell you exactly what's wrong.
- **No boundary mocking** → Real boundary behavior is the only test that catches integration regressions.
- **Cross-platform shared logic** → Duplication leads to drift; shared package is the source of truth.
