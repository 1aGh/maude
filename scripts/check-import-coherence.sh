#!/usr/bin/env bash
# Pre-tag guard: every relative import in a tracked source file must have a
# tracked target. See kgai `pre-tag-import-coherence-guard` — twice in the
# v0.51.0 release a `git add` of a shared file carried a parallel session's
# in-flight import into main while the module itself stayed untracked, which
# is green locally and fatal in CI.
#
# `../` COUNTS. The original pattern matched only `from './X.ts'` — a
# same-directory import — so a parent-directory one was invisible to it. That is
# not a corner: `client/app.jsx` importing `../sync/presentation.ts` is the
# ordinary shape here, and the guard reported OK while exactly the break it
# exists for was sitting in main. Any run of `./` or `../` segments now matches,
# and the target is normalised before the tracked-file lookup.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
missing=0

# Textual path normalisation — resolves `.` and `..` without touching the
# filesystem. Deliberately not `realpath`: BSD/macOS realpath has no `-m` or
# `--relative-to`, so the GNU spelling silently fails there, and the point of
# this guard is that it must behave identically on a maintainer's Mac and in CI.
normpath() {
  local IFS='/' seg out=()
  for seg in $1; do
    case "$seg" in
      '' | '.') ;;
      '..') [ ${#out[@]} -gt 0 ] && unset "out[$((${#out[@]} - 1))]" && out=("${out[@]}") ;;
      *) out+=("$seg") ;;
    esac
  done
  printf '%s' "${out[*]}"
}

while IFS= read -r f; do
  d=$(dirname "$f")
  while IFS= read -r imp; do
    [ -z "$imp" ] && continue
    target=$(normpath "$d/$imp")
    # The failure mode is an UNTRACKED, un-ignored module. A target the tree
    # deliberately ignores is a generated build output (a dev spike's `dist/`)
    # or an installed package, and was never meant to be tracked.
    case "$target" in */node_modules/*) continue ;; esac
    git check-ignore -q --no-index "$target" 2>/dev/null && continue
    if ! git ls-files --error-unmatch "$target" >/dev/null 2>&1; then
      echo "MISSING $f -> $imp"
      missing=1
    fi
    # Statement lines only. Widening the path pattern to allow `/` also started
    # matching PROSE — a comment quoting `from './draw/index.ts'` as an example
    # is not an import, and a guard that cries wolf on documentation is a guard
    # people learn to skip. `}` leads the closing line of a multi-line import.
  done < <(grep -aE "^[[:space:]]*(import|export|\})" "$f" 2>/dev/null |
    grep -a -oE "from '(\.\.?/)+[A-Za-z0-9_./-]+\.(ts|tsx|mjs|jsx)'" |
    sed "s|^from '||;s|'$||")
done < <(git ls-files '*.ts' '*.tsx' '*.mjs' '*.jsx' | grep -v node_modules | grep -v '/test/')
[ "$missing" = 0 ] && echo "import coherence: OK"
exit $missing
