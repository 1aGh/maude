#!/usr/bin/env bash
# Maude v2 — "done" is a script, not a judgement (plan V2-0.0, extended by V2-2.0b).
#
#   bash scripts/v2-done.sh          full check; writes .ai/state/v2-done.last.json
#   bash scripts/v2-done.sh --fast   cheap check for the Stop hook: ledger + a green full run at HEAD
#
# Exits 0 only when every check passes. It is RED BY DESIGN until the end of the run.
# V2-0.0 wired the ledger, nothing-deleted, packaged-app and PR checks; V2-2.0b added every
# Phase 8 gate (scripts/v2-gates.mjs), the kg reconciliation and the native-list / ledger /
# Progress-log equality (scripts/v2-reconcile.mjs).

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

STAMP=".ai/state/v2-done.last.json"
fails=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

check_ledger() {
  if out="$(node scripts/v2-ledger.mjs check 2>&1)"; then
    pass "ledger: every row verified, evidence hash-pinned"
  else
    fail "ledger: $(printf '%s' "$out" | head -1)"
  fi
}

if [[ $FAST -eq 1 ]]; then
  check_ledger
  head_sha="$(git rev-parse HEAD 2>/dev/null)"
  if [[ -f "$STAMP" ]] && node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.exit(s.exit === 0 && s.head === process.argv[2] ? 0 : 1);
  ' "$STAMP" "$head_sha"; then
    pass "full run green at HEAD ($head_sha)"
  else
    fail "no green full run of scripts/v2-done.sh at HEAD"
  fi
  [[ $fails -eq 0 ]] && exit 0 || exit 1
fi

# 1 · Branch — Phase 0 lives on main; the run finishes on feat/maude-v2.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [[ "$branch" == "feat/maude-v2" ]]; then pass "branch feat/maude-v2"; else fail "branch is '$branch', not feat/maude-v2"; fi

# 2 · Coverage ledger — zero open ids; artboard evidence hash-pinned to its canvas.
check_ledger

# 3 · Nothing-deleted audit — 100 % (V2-2.0c creates it red; first green at the Phase 4 gate).
if [[ -f scripts/check-v2-nothing-deleted.mjs ]]; then
  if node scripts/check-v2-nothing-deleted.mjs >/dev/null 2>&1; then pass "nothing-deleted 100 %"; else fail "nothing-deleted audit red"; fi
else
  fail "nothing-deleted audit not built yet (V2-2.0c)"
fi

# 4 · Phase 8 gates (V2-2.0b) — scripts/v2-gates.mjs: live checks run here; command gates
#     (quality, Rust, desktop e2e ×3) and agent/human gates (scenarios, fidelity, a11y, perf,
#     security, packaged app, docs, AI parity) count only with FRESH evidence under
#     .ai/scenarios/maude-v2/gates/ (`--record` / `--attest`; stale once product files change).
if gates_out="$(node scripts/v2-gates.mjs 2>&1)"; then
  pass "Phase 8 gates green"
else
  fail "$(printf '%s' "$gates_out" | tail -1)"
  printf '%s\n' "$gates_out" | grep '^FAIL' | sed 's/^/        /'
fi

# 5 · Packaged .app built from feat/maude-v2 and verified (V2-8.10 / V2-8.11).
if [[ -f .ai/scenarios/maude-v2/packaged-app.json ]] && node -e '
  const s = JSON.parse(require("fs").readFileSync(".ai/scenarios/maude-v2/packaged-app.json", "utf8"));
  process.exit(s.pass === true && s.branch === "feat/maude-v2" ? 0 : 1);
'; then
  pass "packaged .app verified"
else
  fail "packaged .app from feat/maude-v2 not verified (V2-8.10)"
fi

# 6 · PR description ready for Michal (V2-8.11; push + open = E5).
if [[ -s .ai/scenarios/maude-v2/PR.md ]]; then pass "PR description ready"; else fail "PR description missing (.ai/scenarios/maude-v2/PR.md)"; fi

# 7 · kg reconciliation + native-list / ledger / Progress-log equality (V2-2.0b) — every `kg:`
#     reference resolves, `maude kg doctor` is healthy, and the native task-list snapshot the lead
#     writes at each gate (.ai/scenarios/maude-v2/tasklist.json) agrees with the ledger.
if rec_out="$(node scripts/v2-reconcile.mjs --require-tasklist --doctor 2>&1)"; then
  pass "kg + task-list reconciliation"
else
  fail "kg / task-list reconciliation: $(printf '%s' "$rec_out" | head -1)"
  printf '%s\n' "$rec_out" | grep '^FAIL' | head -20 | sed 's/^/        /'
fi

exit_code=0
[[ $fails -gt 0 ]] && exit_code=1
mkdir -p .ai/state
printf '{"head":"%s","branch":"%s","exit":%d,"fails":%d,"ts":"%s"}\n' \
  "$(git rev-parse HEAD 2>/dev/null)" "$branch" "$exit_code" "$fails" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STAMP"
if [[ $exit_code -eq 0 ]]; then echo "v2 done: every check green"; else echo "v2 not done: $fails check(s) red"; fi
exit $exit_code
