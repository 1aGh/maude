---
name: validate-security
category: validate
type: command
description: "Run security and adversarial reviews, consolidate findings and apply the configured severity gate."
keywords: [security, owasp, prompt-injection, mcp, threat-model, audit, hacker, llm-top-10]
argument-hint: "[--since <ref>] [--include-ai | --no-ai]"
---

# /flow:validate-security — security review

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Run a focused security pass over the diff. Defender (`security-auditor`) catches OWASP-class findings against changed files; attacker (`ethical-hacker`) threat-models the change, hunts chained exploits, and covers AI/MCP attack surface (prompt injection, MCP tool poisoning, confused-deputy, the trifecta). Both run **in parallel**; outputs aggregate to a single report.

This is the standalone sibling of `/flow:validate-a11y` and `/flow:validate-visual`. The full `/flow:validate` runs this as step 6.5.

## When to run

- Touching auth, authZ, payments, file uploads, parsers, deserialisation, shell calls, query builders.
- Adding or upgrading a dependency.
- Adding, modifying, or removing an MCP server.
- Touching model prompts, tool definitions, agent loops, function calls.
- Before `/flow:done` on any change with an external trust boundary.

## Pre-flight

1. Read `.ai/workflows.config.json`:
   - `skills.securityRules.enabled` (default `true`) — if `false`, exit early with a notice.
   - `security.severityFloor` (default `medium`) — gate threshold.
   - `security.scope` (default `["classic", "ai", "supply-chain"]`) — narrow rule families.
   - `security.includeAi` (default `true`) — when `false` or when `--no-ai` arg passed, attacker's AI/MCP section becomes `N/A — disabled by config`.
2. Determine diff scope:
   ```bash
   BASE="$(git merge-base main HEAD 2>/dev/null || git merge-base origin/main HEAD 2>/dev/null || echo HEAD~1)"
   # honor --since <ref> arg if provided
   git diff --name-only "$BASE"...HEAD
   git diff --name-only                    # uncommitted too
   ```
   If diff is empty → print `"No changes to review."` and exit.
3. **Reuse a fresh review (Phase C / DDR-061 — `security/<head-sha>` cache).** Don't re-audit a tree that was just audited. This is the single source of truth for the "don't re-audit the same HEAD within 1 h" window — `done.md` and `validate.md` call the SAME layer, so the three commands can no longer drift.
   Access the cache via the `maude` CLI (declared dep, on PATH — `cli/lib` is NOT beside the plugin in a marketplace install; DDR-061). `maude cache get` prints the cached value on a fresh hit and is silent on miss/stale, so a non-empty capture means "reuse":
   ```bash
   HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo nohead)
   REUSE=$(maude cache get security "$HEAD_SHA" --ttl-ms 3600000)   # 1 h window
   ```
   If `$REUSE` is non-empty (a report fresh within 1 h for this exact HEAD), print `"Reusing security review <reportPath> (HEAD <head-sha>)."`, surface its verdict, and **skip spawning `security-auditor` + `ethical-hacker`**. Otherwise run the protocol below, then record the result in Aggregate.

## Adversarial debate (optional — `orchestration.mode`)

Read `orchestration.*` from `.ai/workflows.config.json` (DDR-130; **opt-out** — absent → treat as `auto`, the relay debate is ON by default when native agent-teams are available; `mode:off` restores today's plain parallel pass). This is an **END / adversarial** bookend, so it is eligible for the debate layer:

- **`relay` tier** — when `orchestration.mode` is `auto` AND `orchestration.bookends.adversarial.enabled` is not `false` AND the native agent-teams capability (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) is detected: load the **`flow:debate-protocol`** skill and run a 2-seat adversarial debate instead of the plain parallel spawn. The seats are the SAME agents — `ethical-hacker` = ATTACKER, `security-auditor` = DEFENDER — but they **relay**: ATTACKER proposes the chained exploit → DEFENDER rebuts with the mitigating control → ATTACKER rebuts whether the chain *survives* that control. The protocol's stakes-gate + blind-opening + short-circuit apply (a clean diff short-circuits to today's verdict at ≈ one reduce-pass). "Does the chain survive the control?" — stance revision — is the net-new value over the parallel panel. The reconciled findings feed the SAME **Aggregate** step below.
- **`reduce` tier / `mode:off` / no capability / `bookends.adversarial.enabled:false`** — skip this section and run **Run protocol** exactly as today (parallel spawn + aggregate). **This is the default for every user without the experimental flag — behavior is unchanged.**

Per `flow:debate-protocol`, the debate NEVER prompts the user and NEVER hand-rolls message relay in markdown (the native runtime carries the turns; if teams are unavailable, fall through to the parallel `reduce` path). `security.severityFloor`/`scope`/`includeAi` are read and applied exactly as in Pre-flight regardless of tier. Cap is 2 seats (a precision duel, not an ensemble).

## Run protocol

Unless the adversarial debate above handled this run, **spawn `security-auditor` and `ethical-hacker` in parallel.** Use a single message with two Task tool calls so they run concurrently. Both consume the same diff scope.

```
Task tool → subagent_type: flow:security-auditor
prompt: "Audit the diff against `security-rules` §A.
         Diff base: <BASE>. Severity floor: <floor>.
         Write report to .ai/logs/security-reviews/<branch>-<ts>-defender.md.
         Return JSON output block."

Task tool → subagent_type: flow:ethical-hacker
prompt: "Adversarial threat model for the diff.
         Diff base: <BASE>. Severity floor: <floor>. includeAi: <bool>.
         Defender report (if present): <path>.
         Write report to .ai/logs/security-reviews/<branch>-<ts>-attacker.md.
         Return JSON output block. Mandatory AI/MCP section."
```

Both agents must complete even if one finds blockers — the attacker's chain-finding pass sometimes promotes a defender medium into a chained critical.

## Aggregate

Write `.ai/logs/security-reviews/<branch>-<YYYYMMDD-HHMM>.md`:

```markdown
# Security review — <branch> @ <commit>

## TL;DR
| Lane | Blockers | Warnings | Headline |
| ---- | -------- | -------- | -------- |
| Defender | <N> | <M> | <highest-severity finding or "clean"> |
| Attacker | <N> | <M> | <strongest chain or creativity finding> |
| Combined | <N> | <M> | <gate decision> |

- Severity floor: `<floor>`
- AI/MCP lens: <on / off>
- Exploit chains constructed: <K>
- AI/MCP surface touched: <yes / no>

## Defender findings — OWASP-class
<defender report content or link>

## Attacker findings — adversarial threat model
<attacker report content or link>

## Exploit chains
<list, each with steps and promoted severity>

## AI / MCP attack surface
<attacker's mandatory section>

## Combined gate decision
- Blockers at severity >= <floor>: <N>
- Verdict: **PASS** / **PASS WITH WARNINGS** / **FAIL**

## Next step
<if FAIL: which specific finding to fix first; if PASS WITH WARNINGS: should-fix list; if PASS: continue to /flow:review-code or /flow:done>
```

**Record the result in the `security/<head-sha>` cache** so `/flow:done` and `/flow:validate` on the same HEAD within the hour reuse it instead of re-spawning:

```bash
printf '{"reportPath":"%s","verdict":"%s","blockers":%s}' \
  "$REPORT_PATH" "$VERDICT" "${BLOCKERS:-0}" \
  | maude cache put security "$HEAD_SHA"
```

## Gate

- `combined.blockers > 0 && severity >= severityFloor` → **FAIL**. Print the top finding inline and exit non-zero.
- `ethical-hacker.exploit_chains > 0` is informational by itself; a chain that promotes a defender-medium into a chained high → counts as a blocker.
- Otherwise → **PASS** (with or without warnings).

## Output to the user

```
## /flow:validate-security — <YYYY-MM-DD HH:MM>
Defender: <N> blockers, <M> warnings — .ai/logs/security-reviews/<branch>-<ts>-defender.md
Attacker: <N> blockers, <M> warnings, <K> chains — .ai/logs/security-reviews/<branch>-<ts>-attacker.md
AI/MCP: <on/off> — surface touched: <yes/no>
Aggregate: .ai/logs/security-reviews/<branch>-<ts>.md
Verdict: PASS / PASS WITH WARNINGS / FAIL
```

If FAIL: prompt _"Found <N> blockers. Should I open the report and propose fixes?"_

## What /flow:validate-security does NOT do

- Run exploits. The attacker thinks on paper.
- Edit code. Both agents are read-only by contract.
- Re-scan history. Diff scope is the active change (or `--since <ref>` if supplied).
- Block on warnings alone. The floor is the floor.

## Record it in the graph (kgai — when active)

`.ai/logs/**` is **gitignored** — so a security verdict, the artifact most worth inheriting, is the one that travels least. When the graph is active, record the merged report right after writing it:

```bash
maude kg record-log --file ".ai/logs/security-reviews/<branch>-<YYYYMMDD-HHMM>.md"
```

The verb gates itself and is a **silent no-op when the graph is inactive** — run it unconditionally; the classic `.ai/` path is unchanged. It lands a `security-review:<slug>` node with the full body and `EVIDENCE_FOR` edges to every cited `DDR-NNN`, so a later "has this attack surface been reviewed before?" is one `maude kg search` away. Record the **merged** report only — the per-agent defender/attacker drafts are inputs, not verdicts. Contract: **`flow:kgai-backend`**.

## Reusing a fresh report

If `.ai/logs/security-reviews/<branch>-*.md` exists for the current HEAD SHA (within the last hour and HEAD unchanged), reuse it instead of re-running. `/flow:review-code` and `/flow:validate` step 6.5 honor the same reuse window.
