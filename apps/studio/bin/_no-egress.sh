# _no-egress.sh — SOURCED (never run) by every `maude design` helper that starts agent-browser:
# screenshot.sh, canvas-rects.sh, perf.sh, photo-bg-remove.sh. V2-8.9 M1 (decision
# maude/v2-8.9-lead-m1-canvas-navigation-gate).
#
# While the AI chat's "AI may › Search the web" is off, the ACP bridge starts the agent's session with
# MAUDE_NO_EGRESS=1 (acp/may-scope.ts `mayEnv`), and every helper the agent runs inherits it. A canvas
# the agent wrote can then still render on loopback, but it cannot carry data to a website by
# navigating, fetching or opening a peer connection from the headless browser:
#
#   AGENT_BROWSER_PROXY   a dead loopback proxy — Chromium sends every non-loopback request there (it
#                         never resolves the host itself, so no DNS lookup carries data either) and
#                         bypasses loopback implicitly, so localhost / 127.0.0.1 / [::1] still load.
#                         agent-browser splits AGENT_BROWSER_ARGS on commas, so the comma-separated
#                         `--host-resolver-rules` the Playwright lane uses (_pw-launch.mjs) cannot ride
#                         here; the proxy is agent-browser's equivalent.
#   AGENT_BROWSER_ARGS    + WebRTC limited to proxied (= no) UDP — a STUN server at an IP literal
#                         would otherwise bypass both the proxy and any resolver rule.
#   AGENT_BROWSER_SESSION a session of its own: launch options apply only when a browser STARTS, and
#                         an agent-browser session that was started with the web on keeps running.
#
# The person's own bypass lists are dropped for this helper process only. Anything else unchanged.

if [ "${MAUDE_NO_EGRESS:-}" = "1" ]; then
  export AGENT_BROWSER_PROXY="http://127.0.0.1:9"
  unset AGENT_BROWSER_PROXY_BYPASS NO_PROXY no_proxy
  case ",${AGENT_BROWSER_ARGS:-}," in
    *,--force-webrtc-ip-handling-policy=disable_non_proxied_udp,*) ;;
    *)
      export AGENT_BROWSER_ARGS="${AGENT_BROWSER_ARGS:+$AGENT_BROWSER_ARGS,}--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
      ;;
  esac
  case "${AGENT_BROWSER_SESSION:-default}" in
    *-noegress) ;;
    *) export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-default}-noegress" ;;
  esac
fi
