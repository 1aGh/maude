#!/bin/bash
# per impl png: new size/dims vs stage A; flags big dim changes or tiny files
cd "$(dirname "$0")"
A=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a55262287b808e562/.scr/impl
for d in 13-design-system 14-editing 15-annotations; do
  for f in impl/$d/*.png; do
    b=$(basename "$f")
    n=$(magick identify -format '%wx%h' "$f")
    s=$(stat -f %z "$f")
    if [ -f "$A/$d/$b" ]; then o=$(magick identify -format '%wx%h' "$A/$d/$b"); os=$(stat -f %z "$A/$d/$b"); else o=-; os=0; fi
    echo "$d/$b new=$n ${s}B old=$o ${os}B"
  done
done
