#!/usr/bin/env bash
# Cloud Phase 25 — the Acceptance list, run against production.
#
# Every check states what it asserts and prints PASS/FAIL, so the output is
# readable as evidence rather than as a log.

Z=cloud.maude.sh
P=alligators
pass=0; fail=0

chk() { # chk "<claim>" "<expected>" "<actual>"
  if [ "$2" = "$3" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1));
  else printf '  FAIL  %s\n        expected %s, got %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$@"; }
body() { curl -s --max-time 25 "$@"; }

echo "── the platform is up ─────────────────────────────────────────────"
chk "the control plane answers"            "200" "$(code https://$Z/health)"
chk "the project's cell answers"           "200" "$(code https://$P.$Z/health)"

echo
echo "── A-1: the fleet-wide R2 key is not what cells use ───────────────"
POSTURE=$(body "https://$Z/health?cb=$RANDOM" -H 'cache-control: no-cache' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("r2Creds"))')
chk "storage posture is per-tenant"        "per-tenant" "$POSTURE"

echo
echo "── C5: the read-only gallery is gone, address and all ─────────────"
GAL=$(code "https://view-$P.$Z/" 2>/dev/null)
chk "view-<project> no longer serves"      "000" "$GAL"

echo
echo "── A4: the canvas origin is its own origin ────────────────────────"
chk "canvas origin with no project refuses" "404" "$(code https://canvas.$Z/)"
# A capability token is required; a bad one must not render.
chk "a bad render token is refused"        "401" "$(code "https://canvas.$Z/$P/_canvas/module?c=ui/Home.tsx&t=not-a-token")"

echo
echo "── B1/B2: signed out lands on the Maude sign-in, never in the project ──"
# What B2 actually promises: a signed-out visitor is sent to the ACCOUNT's
# sign-in, at the customer-facing address, and never sees the project. The
# earlier version of this check looked for sign-in words in the FIRST
# response — but that response is a 302, so it asserted nothing. Follow it.
# As a BROWSER navigation: the hub redirects an HTML navigation (Accept: text/html) to the sign-in
# and answers an API call (any other Accept) with a 401 JSON (hub server.mjs). A bare curl is the
# API caller, so without this header the check asserted the API branch and failed.
NAV=(-H 'Accept: text/html,application/xhtml+xml')
FINAL=$(curl -s -o /dev/null -w '%{url_effective}' -L --max-time 45 "${NAV[@]}" "https://$P.$Z/studio")
CODE=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 45 "${NAV[@]}" "https://$P.$Z/studio")
chk "signed out ends at the control plane sign-in" "1" "$(printf '%s' "$FINAL" | grep -qE "^https://$Z/login" && echo 1 || echo 0)"
chk "the sign-in page actually renders"            "200" "$CODE"
chk "no internal tunnel hostname leaks to the user" "1" "$(printf '%s' "$FINAL" | grep -q 't-alligators' && echo 0 || echo 1)"
echo "        (landed on: $FINAL)"

echo
echo "───────────────────────────────────────────────────────────────────"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
