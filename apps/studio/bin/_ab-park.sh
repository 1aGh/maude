# _ab-park.sh — SOURCED (never run) by every `maude design` helper that opens a page in agent-browser:
# screenshot.sh, canvas-rects.sh, smoke.sh, perf.sh (its node probe does the same in _perf-probe.mjs).
# p8-e2e-fix-r10 (decision maude/v2-p8-e2e-fix-r10-captures-close-their-page).
#
# An agent-browser session is a DAEMON: it outlives the helper, the studio and the app. A canvas page left
# open in it is a live collab peer — it keeps reconnecting to whatever server answers on that port next, and
# pushes its own copy of the canvas document into that server's room. A Print canvas a capture left open on
# :4400 at 03:36 merged one more copy of its source into every later e2e run's room (22 copies by 05:38)
# until the sync refused the body as invalid. So a capture never outlives itself: on exit it parks the page
# on about:blank and closes the session.
#
#   ab_park_arm [session]   call in the helper's MAIN shell right before its first `"$AB" open` (a call made
#                           inside `$( … )` cannot arm it). [session] = the --session the helper uses, if any;
#                           without it the session is AGENT_BROWSER_SESSION's, as for every other call.
#   AB                      the agent-browser binary the helper uses (default: agent-browser on PATH).
#
# Nothing happens when the helper never armed it (the static/playwright lanes, an early argument error), so
# exiting never STARTS a browser just to close it.

AB_PARK_ARMED=""
AB_PARK_SESSION=""

ab_park_arm() {
  AB_PARK_ARMED=1
  AB_PARK_SESSION="${1:-}"
}

ab_park() {
  [ -n "$AB_PARK_ARMED" ] || return 0
  AB_PARK_ARMED=""
  local ab="${AB:-agent-browser}"
  if [ -n "$AB_PARK_SESSION" ]; then
    "$ab" --session "$AB_PARK_SESSION" open about:blank >/dev/null 2>&1 || true
    "$ab" --session "$AB_PARK_SESSION" close >/dev/null 2>&1 || true
  else
    "$ab" open about:blank >/dev/null 2>&1 || true
    "$ab" close >/dev/null 2>&1 || true
  fi
}

trap ab_park EXIT
