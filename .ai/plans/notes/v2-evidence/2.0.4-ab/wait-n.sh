#!/bin/bash
# wait-n.sh <file> <n> [pattern] — block until <file> holds n lines matching pattern (default ^exit), print them
P=${3:-^exit}
until [ "$(grep -c "$P" "$1")" -ge "$2" ]; do sleep 10; done
grep "$P" "$1" | cut -c1-700
