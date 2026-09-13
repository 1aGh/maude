---
name: review-code
category: review
type: command
description: "Review uncommitted code changes before commit."
keywords: [review, code-review, diff, quality, pre-commit, audit]
---

# Code Review (Self)

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Perform a thorough self-review of all uncommitted changes before committing.

## Review Philosophy

- Simplicity is the ultimate sophistication — every line should justify its existence
- Code is read far more often than it's written — optimize for readability
- The best code is often the code you don't write

## Repository Auto-Detection

```bash
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||')"
```

## 1. Gather Changes

```bash
git diff --stat
git diff --staged --stat
git diff --name-only HEAD
```

## 2. Review Each Changed File

For every modified file, read it and check:

### Correctness

- Logic errors or edge cases missed
- Off-by-one errors
- Null/undefined handling
- Race conditions

### Code Quality

- Clear naming
- Single responsibility
- No code duplication
- Functions focused and small
- No commented-out code left behind

### Security

**Spawn `security-auditor` and `ethical-hacker` subagents in parallel.** The defender runs an OWASP-class pass over the diff (injection, secrets, authN/Z, crypto, SSRF, XSS, deserialization, path traversal, supply chain). The attacker threat-models for chained exploits and **AI/MCP attack surface** — prompt injection in tool outputs, MCP tool poisoning, confused-deputy across MCPs, the trifecta (private data + untrusted content + outbound channel in one agent loop). Reports aggregate to `.ai/logs/security-reviews/<branch>-<ts>.md`.

If a fresh report already exists for the current HEAD (e.g. the user just ran `/flow:validate-security` or `/flow:validate`), **reuse it** instead of re-spawning — the file mtime is the cache key.

**Gate the commit when any finding lands at severity ≥ `security.severityFloor`** (default `medium`). Below the floor → warnings carried into the review summary, not a hard block.

Quick manual cross-checks (defender catches these already, listed for the reviewer's eye):
- No hardcoded secrets, tokens, or API keys
- Input validation where needed
- No SQL injection vectors
- Proper error handling (no silent failures)

### Testing

- New code has appropriate test coverage
- Tests cover edge cases
- Tests are focused and independent

### Project Conventions

- Follows existing patterns in codebase
- Consistent formatting
- Import ordering matches project style
- File placement follows project structure

## 3. Load Project Instructions

If the project has instruction files (e.g., `instructions/*.instructions.md`), read them and verify compliance:

- Coding standards met
- Naming conventions followed
- Architecture patterns respected

## 4. Verify Issues Are Real

- Run specific tests for issues found
- Confirm type errors are legitimate
- Validate security concerns with context

## 5. Generate Review

Save to `.ai/logs/code-reviews/<branch-name>.md`:

```markdown
# Code Review: <branch-name>

## Summary

<brief description of changes>

## Files Reviewed

- [file path] — [change description]

## Findings

### 🔴 CRITICAL (must fix)

- [finding with file:line reference]

### 🟡 IMPORTANT (should fix)

- [finding with file:line reference]

### 🟢 SUGGESTION (nice to have)

- [finding with file:line reference]

## Verdict

PASS / PASS WITH SUGGESTIONS / NEEDS FIXES
```

## 6. Apply stylistic fixes (`code-simplifier` pass)

If the review verdict is **PASS** or **PASS WITH SUGGESTIONS** (no CRITICAL findings), spawn `code-simplifier` to auto-apply stylistic improvements:

```
Task tool → subagent_type: code-simplifier
prompt: "Refactor uncommitted files (git diff --name-only HEAD)
         for clarity. Honor CLAUDE.md and any project rule
         skills (testing-rules, a11y-rules, responsive-rules).
         Preserve all behavior. Skip tests, scenarios, and
         hot-path files explicitly DDR-flagged for perf."
```

**Skip simplifier pass when:**

- Verdict is **NEEDS FIXES** — fix CRITICAL findings first; simplifier is for polish, not correctness.
- Diff is < ~30 lines total (overhead > value).
- Changes are pure config/infra (lockfiles, CI yml, env templates).

## 7. Recheck after simplifier

After simplifier pass:

1. Re-run static checks: `pnpm turbo run typecheck --filter='<affected>'` + `pnpm turbo run lint --filter='<affected>'`.
2. Re-run any tests that touch the simplified files.
3. **If anything broke** — `git checkout -- <files>` to revert simplifier, log the failure in the review report under `## Simplifier outcome`, and proceed with pre-simplifier code.
4. **If clean** — append `## Simplifier outcome` section to the review file: list of files touched, lines added/removed, brief note ("inlined helper used 1×", "flattened guard clauses", etc.).

Re-read the simplified diff (`git diff`) and check for any new findings the simplifier introduced (rare with opus-backed simplifier, but possible). Update the review report verdict if needed.

## 7.5. Record the verdicts in the graph (kgai — when active)

`.ai/logs/**` is **gitignored**, so the review and the two security reports exist only on this machine — while the branch they judged goes to everyone. When the graph is active, record each file that was actually written:

```bash
maude kg record-log --file ".ai/logs/code-reviews/<branch-name>.md"
maude kg record-log --file ".ai/logs/security-reviews/<branch>-<ts>.md"   # if step 4 wrote one
```

The verb gates itself and is a **silent no-op when the graph is inactive** — run it unconditionally; the classic `.ai/` path is unchanged. They land as `code-review:<slug>` / `security-review:<slug>` with the full body and `EVIDENCE_FOR` edges to every cited `DDR-NNN`. Run it **after** the simplifier recheck (step 7) so the recorded verdict is the final one, not the pre-simplifier draft. Contract: **`flow:kgai-backend`**.

## 8. Post-Review

- **PASS**: Ask "Ready to commit?"
- **NEEDS FIXES**: Ask "Should I fix these issues?" → if yes, apply the fixes inline.
