#!/usr/bin/env bash
# Maude v2 remote lane — run a command on the Mac mini hub instead of this machine.
#
#   scripts/remote-lane.sh [--rev <rev>] [--slot 1|2|3|auto] [--max <s>] [--fetch <path>]… -- <command…>
#
# The mini (ssh host `hub`, Apple M4 · 10 cores · 16 GB) is mostly idle, while this Mac also runs
# Blender and the agent sessions. Use it for CPU-heavy, display-free work: the full studio suite,
# hub tests, headless screenshot chains (agent-browser / playwright), `bun build.ts --release`.
# NOT for: desktop e2e (WebKit needs an unlocked, visible screen), the Tauri `.app` build, editing.
#
# How it works
#   1. Pushes <rev> (default: HEAD of the current checkout or worktree; the tree must be committed)
#      to the mini's bare repo /Volumes/D/maude-runner/repo.git as refs/runner/<sha>.
#   2. Takes a free slot (/Volumes/D/maude-runner/slot{1,2,3} — full clones with deps installed;
#      an atomic mkdir lock per slot), checks out <sha> detached, and re-installs deps only when
#      pnpm-lock.yaml or apps/studio/bun.lock changed since the slot's last install.
#   3. Runs the command from the slot root under `nice -n 10` (the mini also serves the hub), with
#      bun 1.4.2 + Node 24.13 on PATH (/Volumes/D/maude-runner/tools) and NO_OPEN=1,
#      MAUDE_NO_AUTOBUILD=1. Output streams back; a copy lands in /Volumes/D/maude-runner/runs/<id>.log.
#      The run is cut at --max seconds (default 3600) with its process group.
#   4. Copies each --fetch path (relative to the repo root, file or directory) out of the slot into
#      runs/<id>.out/ before releasing it, then rsyncs it into the SAME relative path of the current
#      checkout, e.g. a screenshot folder.
#   5. Exits with the command's exit code (124 = --max hit, 75 = no free slot). ssh to the mini
#      always reports 0, so the code is read back from runs/<id>.rc — gate on this script's exit.
#
# Capacity rule (16 GB RAM): at most ONE full suite and two screenshot chains at a time — i.e. use
# --slot 1 for suites; `auto` takes only slots 2/3 (never 1) and waits for one of them. Each slot
# runs one command at a time.
#
# Examples
#   scripts/remote-lane.sh --slot 1 -- bash -c 'cd apps/studio && bun test'
#   scripts/remote-lane.sh -- bash -c 'cd apps/hub && pnpm test'
#   scripts/remote-lane.sh --fetch .ai/plans/notes/v2-evidence/phase8-fidelity/14 -- node .scr/shoot-14.mjs
set -uo pipefail

HOST="${MAUDE_REMOTE_HOST:-hub}"
R=/Volumes/D/maude-runner
REV=HEAD
SLOT=auto
MAX=3600
FETCH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rev) REV="$2"; shift 2 ;;
    --slot) SLOT="$2"; shift 2 ;;
    --max) MAX="$2"; shift 2 ;;
    --fetch) FETCH+=("$2"); shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/remote-lane.sh [--rev <rev>] [--slot 1|2|3|auto] [--max <s>] [--fetch <path>]… -- <command…>" >&2
  exit 2
fi

TOP="$(git rev-parse --show-toplevel)" || exit 2
SHA="$(git -C "$TOP" rev-parse --verify "$REV^{commit}")" || exit 2
if [[ "$REV" == HEAD ]] && [[ -n "$(git -C "$TOP" status --porcelain --untracked-files=no)" ]]; then
  echo "remote-lane: uncommitted changes in $TOP are NOT sent — only $SHA is. Commit first if the run needs them." >&2
fi

git -C "$TOP" push -q --force "$HOST:$R/repo.git" "$SHA:refs/runner/$SHA" || { echo "remote-lane: push to $HOST failed" >&2; exit 2; }

# The command travels as one shell-quoted string.
CMD="$(printf '%q ' "$@")"
ID="$(date +%Y%m%d-%H%M%S)-${SHA:0:9}-$$"

# ssh joins its argv into ONE string the remote shell re-parses, so every argument is quoted again.
ARGS="$(printf '%q ' "$SHA" "$SLOT" "$MAX" "$ID" "$CMD" ${FETCH[@]+"${FETCH[@]}"})"
ssh -o BatchMode=yes "$HOST" "bash -s -- $ARGS" <<'REMOTE'
set -uo pipefail
SHA="$1"; SLOT="$2"; MAX="$3"; ID="$4"; CMD="$5"; shift 5
R=/Volumes/D/maude-runner
export PATH="$R/tools/bin:$R/tools/node24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
# A clean git identity/config for the run: the mini owner's global config must not leak into
# tests (e.g. the url.insteadOf security probe).
export GIT_CONFIG_GLOBAL="$R/tools/gitconfig"
# The mini's login env carries the owner's Claude credentials; a test or a spawned studio must
# never inherit them (the suite stubs claude, and a real token would let a stray child sign in).
unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CONFIG_DIR
mkdir -p "$R/locks" "$R/runs"
# ssh to this host (Tailscale) reports 0 whatever the remote exit is, so the real code goes to a file.
got=""
trap 'rc=$?; echo "$rc" >"$R/runs/$ID.rc"; [[ -n "$got" ]] && rm -rf "$R/locks/slot$got"' EXIT

take() { mkdir "$R/locks/slot$1" 2>/dev/null && echo "$$ $ID" >"$R/locks/slot$1/owner"; }
stale() { local p; p="$(cut -d' ' -f1 "$R/locks/slot$1/owner" 2>/dev/null)"; [[ -n "$p" ]] && ! kill -0 "$p" 2>/dev/null; }
for _ in $(seq 1 180); do
  if [[ "$SLOT" == auto ]]; then cands="2 3"; else cands="$SLOT"; fi
  for s in $cands; do
    if stale "$s"; then rm -rf "$R/locks/slot$s"; fi
    if take "$s"; then got="$s"; break 2; fi
  done
  sleep 5
done
[[ -n "$got" ]] || { echo "remote-lane: no free slot after 15 min ($SLOT)" >&2; exit 75; }
D="$R/slot$got"
echo "remote-lane: slot$got · ${SHA:0:9} · log $R/runs/$ID.log" >&2

cd "$D" || exit 2
git fetch -q origin "refs/runner/$SHA" </dev/null && git checkout -q --force --detach "$SHA" </dev/null || { echo "remote-lane: checkout failed" >&2; exit 2; }
git clean -qfd -e node_modules -e .scr -e .runner-deps </dev/null >/dev/null 2>&1 || true
# pnpm 11 is a standalone binary that builds native addons for the mini's brew node (26, ABI 141),
# but the suite and the hub run on Node 24.13 (ABI 137): rebuild each better-sqlite3 copy with it.
native_for_node24() {
  local d
  for d in node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 apps/*/node_modules/better-sqlite3; do
    [[ -f "$d/package.json" ]] || continue
    (cd "$d" && rm -rf build && npm run install </dev/null >/dev/null 2>&1) || return 1
    node -e "require('./$d')" </dev/null >/dev/null 2>&1 || { echo "remote-lane: better-sqlite3 still fails under $(node -v) in $d" >&2; return 1; }
  done
}
# "deps-v2": bump to force every slot to reinstall after a change to the steps below.
h="$( (echo deps-v2; cat pnpm-lock.yaml apps/studio/bun.lock apps/hub/bun.lock 2>/dev/null) | shasum | cut -d' ' -f1)"
if [[ "$(cat .runner-deps 2>/dev/null)" != "$h" ]]; then
  echo "remote-lane: lockfiles changed — reinstalling deps in slot$got" >&2
  pnpm install --frozen-lockfile </dev/null >/dev/null 2>&1 && (cd apps/studio && bun install --frozen-lockfile </dev/null >/dev/null 2>&1) \
    && (cd apps/hub && bun install --frozen-lockfile </dev/null >/dev/null 2>&1) \
    && native_for_node24 && echo "$h" >.runner-deps
fi

# Run in its own process group (so --max can stop the whole tree), stdin closed: the remote
# script itself arrives on this shell's stdin and a child must not eat it.
: >"$R/runs/$ID.log"
tail -n +1 -f "$R/runs/$ID.log" >&2 &
tailer=$!
set -m
nice -n 10 bash -c "$CMD" </dev/null >"$R/runs/$ID.log" 2>&1 &
pid=$!
set +m
( sleep "$MAX"; kill -TERM -- -"$pid"; sleep 10; kill -KILL -- -"$pid" ) </dev/null >/dev/null 2>&1 &
watch=$!
wait "$pid"; rc=$?
pkill -P "$watch" 2>/dev/null; kill "$watch" 2>/dev/null
sleep 1; kill "$tailer" 2>/dev/null
[[ $rc -eq 143 || $rc -eq 137 ]] && { echo "remote-lane: stopped at --max ${MAX}s" >&2; rc=124; }
# Copy the --fetch paths out of the slot while we still hold it.
for p in "$@"; do
  [[ -e "$D/$p" ]] && { mkdir -p "$R/runs/$ID.out"; (cd "$D" && rsync -aR "./$p" "$R/runs/$ID.out/" </dev/null); }
done
exit $rc
REMOTE
rc="$(ssh -o BatchMode=yes "$HOST" cat "$R/runs/$ID.rc" 2>/dev/null)"
[[ "$rc" =~ ^[0-9]+$ ]] || { echo "remote-lane: no exit code from $HOST (connection lost?)" >&2; rc=2; }

if [[ ${#FETCH[@]} -gt 0 && $rc -ne 2 && $rc -ne 75 ]]; then
  if ssh -o BatchMode=yes "$HOST" test -d "$R/runs/$ID.out"; then
    rsync -a "$HOST:$R/runs/$ID.out/" "$TOP/"
  else
    echo "remote-lane: none of the --fetch paths existed after the run" >&2
  fi
fi
exit $rc
