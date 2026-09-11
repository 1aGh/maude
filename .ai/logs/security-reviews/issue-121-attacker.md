# Security attacker review — issue #121

Date: 2026-09-11
Verdict: PASS — no introduced security finding at or above the default medium severity floor.
Scope: uncommitted source-sync fix against `55e228e60c10657e85c65f06a875d70efb3c984a`, including the new source-validation, source-recovery, seed-repair and regression-test files. Unrelated `.claude/settings.json` excluded.
Intent: `.ai/logs/rca/issue-121.md` and `.ai/logs/execution-reports/issue-121.md`; the file-based STATE has no active plan for this bug. Security config uses defaults: classic, AI and supply chain; medium floor.
Method: static adversarial tracing, inspection of production dependency implementation and regression tests, and primary-source advisory research. No exploit execution, live service requests, or production edits.

## Trust boundaries and attempted abuse

- **Remote CRDT body → local canvas file.** I would alternate malformed JSX and a doubled third version, reconnect, then flood rejected variants to destroy the usable recovery point. Projection validates before writing and checkpointing, rejects without projecting coupled CSS, and keeps recovery in fixed slots outside rolling history. Rejected bytes cannot evict the retained valid slot while local source remains valid. Migration retains a valid pre-migration backup and quarantines unrecognized invalid hub content instead of stamping it as synchronized.
- **Concurrent local save → remote document → disk.** I would deliver a remote update before the local watch callback to overwrite an unseen repair, or make a merge exceed its diff budget. The writer compares disk with its observed baseline. Overlapping file imports preserve both sides; the diff is calculated before any Y.Text mutation and refuses an exhausted budget. The synchronous-peer-update regression also prevents a corrupted merged document being mistaken for bytes already projected.
- **Recovery content → filesystem.** I would try to turn incoming source into a recovery filename or cause retries to write more widely after a snapshot failure. Slot names are a fixed union; only the existing canvas extension is appended, and body contents never become path components. The history root comes from the existing canvas path mapping. Atomic writes use the existing exclusive random temporary-file path and owner-only mode. Failed preservation blocks replacement rather than expanding the target scope.
- **Remote input → CPU, memory and disk.** New recovery slots have a 4 MiB body cap; the history fallback examines at most 300 same-extension files, bounded by size. Replacements use `maxEditLength: 4096` and a 50 ms library budget; unchanged prefix/suffix and pure insertion/deletion use the existing linear fast paths. Duplicate rejection notifications are hash-deduplicated and status conflict history is capped. The diff timeout is cooperative, not an end-to-end latency guarantee: tokenization, parsing and a single internal iteration are synchronous. No introduced unbounded loop or remotely extensible recovery filename set was found.
- **Seed provenance → corrective CRDT deletion.** A repair requires locally remembered seed bytes, the original ten-second window, election to this doc's client ID, and an exact integer repeat. A peer cannot select arbitrary deletion content through the seed marker alone. Divergent bytes are retained for conflict recovery.

## Findings and exploit chains

No actionable introduced security findings. The recovery-flood chain was the main adversarial-creativity target: keeping rejected updates outside rolling history blocks the attempted eviction of good source.

The paired `.ai/logs/security-reviews/issue-121-defender.md` reports zero blockers and zero warnings. No viable chain across defender findings; no independent medium findings remain to compose.

## AI / MCP attack surface

N/A — this change adds or modifies no model prompt, tool definition, MCP server, or agent capability. Authored source may originate from an agent, but the new path parses it without resolving imports or executing it. Recovery contents remain untrusted project data. The change does not promote recovered text to model instructions or create an outbound tool channel.

Syntax validation is an integrity boundary, not a sandbox or malicious-code filter. A syntactically valid hostile canvas can still contain JavaScript or instruction-like comments under the existing rendering/agent trust model. No newly introduced trifecta, confused-deputy path or excessive-agency tool was found. This distinction follows the [OWASP indirect prompt-injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): external file content can carry instructions if a later model consumer treats it as authoritative.

## Dependency verification

`diff` is pinned to 8.0.4 and was already represented transitively in the pnpm lockfile. The installed manifest has no install lifecycle script. The maintainer's [GHSA-73rr-hh4g-fpgx advisory](https://github.com/kpdecker/jsdiff/security/advisories/GHSA-73rr-hh4g-fpgx) describes denial of service in patch parsing, patched in 8.0.3; other methods are unaffected. This change calls `diffChars`, so both the selected version and the API exclude that advisory. This is an applicability check, not a claim that all future vulnerabilities are excluded.

## Limits and follow-up

No security follow-up required for this diff. Arbitrary overlapping valid edits are not guaranteed to preserve intended program semantics, valid source is not guaranteed safe to execute, and existing hub CRDT history is not reset by this fix. These are acknowledged boundaries of the containment fix, not newly introduced vulnerabilities.
