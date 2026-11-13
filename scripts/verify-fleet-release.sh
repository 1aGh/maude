#!/usr/bin/env bash
# Poll a live cell's /health until it answers with the release that was just
# deployed AND the client bytes this release built.
#
# Called by the `cells` lane of 1aGh/maude-deploy (deploy.yml) after `wrangler deploy` on a
# release tag. WHY it asserts both — and why neither one subsumes the other —
# is written where a maintainer reading the pipeline will find it: the workflow
# step's comment, and the header of apps/hub/src/bundle-identity.mjs. This file
# is the mechanism, extracted only so that it can be tested against a stubbed
# responder instead of proving itself on a real release.
#
# Usage:
#   scripts/verify-fleet-release.sh <health-url> <expected-version> <expected-client-hash>
#
# Env:
#   FLEET_VERIFY_ATTEMPTS  (default 60)   poll count
#   FLEET_VERIFY_SLEEP     (default 20)   seconds between polls
#   FLEET_VERIFY_TIMEOUT   (default 20)   per-request timeout
#
# Exit 0 = the fleet is running this release. Exit 1 = it never did, and the
# last observed payload is in the message (a gate that fails without saying
# WHAT it saw sends the operator back to hand-probing production, which is the
# thing this replaces).
set -uo pipefail

URL="${1:?usage: verify-fleet-release.sh <health-url> <version> <client-hash>}"
WANT_VER="${2:?missing expected version}"
WANT_CLIENT="${3:?missing expected client hash}"

# A leading `v` is how the git tag spells it; `/health` reports bare semver.
WANT_VER="${WANT_VER#v}"

ATTEMPTS="${FLEET_VERIFY_ATTEMPTS:-60}"
SLEEP="${FLEET_VERIFY_SLEEP:-20}"
TIMEOUT="${FLEET_VERIFY_TIMEOUT:-20}"

echo "expecting releaseVersion=$WANT_VER client=$WANT_CLIENT at $URL"

LAST="<no response>"
for i in $(seq 1 "$ATTEMPTS"); do
  BODY=$(curl -fsS --max-time "$TIMEOUT" "$URL" || true)
  if [ -n "$BODY" ]; then
    LAST="$BODY"
    # `// "absent"` rather than an empty string: a field that is MISSING (an
    # older image that predates it) must not read as a value that merely
    # differs, or the log says "mismatch" about a cell that never reported.
    GOT_VER=$(printf '%s' "$BODY" | jq -r '.releaseVersion // "absent"' 2>/dev/null || echo 'unparseable')
    # `.client`, TOP-LEVEL — not `.studio.client`. The payload builder spreads
    # `{ client: identity }` as a sibling of `studio`, not inside it. The first
    # cut of this script read `.studio.client…`, which is always absent, so the
    # gate could only ever time out. It shipped green because the unit test's
    # fixture was hand-written to the same wrong shape — a test that asserts the
    # author's assumption instead of the server's output. `health.test.mjs` now
    # pins the real shape at the producer so the two cannot drift apart again.
    GOT_CLIENT=$(printf '%s' "$BODY" | jq -r '.client.artifacts["dist/client.bundle.js"] // "absent"' 2>/dev/null || echo 'unparseable')
    echo "attempt $i: releaseVersion=$GOT_VER client=$GOT_CLIENT"
    if [ "$GOT_VER" = "$WANT_VER" ] && [ "$GOT_CLIENT" = "$WANT_CLIENT" ]; then
      echo "the fleet is running $WANT_VER, serving the bytes this run built"
      exit 0
    fi
  else
    # The first request after a roll pays a cold start — rehydrate from R2,
    # which the release guide warns is MINUTES on a GB-scale project. Silence
    # early on is expected, not a failure.
    echo "attempt $i: no response (cold start?)"
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep "$SLEEP"
done

echo "::error::the fleet never came up on $WANT_VER / $WANT_CLIENT. Last /health: $LAST"
echo "::error::a VERSION mismatch means the image derived from the wrong layer (the v0.57.0 failure); a HASH mismatch means the tag carries different bytes than this run built."
exit 1
