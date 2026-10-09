#!/bin/bash
# Copy the V2-1.10 prototype scripts (no media, no outputs) into the worktree, uncommitted.
S="$(cd "$(dirname "$0")" && pwd)"
DST=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a85623f2dd1a018ec/.ai/plans/notes/v2-prototypes/V2-1.10
mkdir -p "$DST"
cp "$S"/*.mjs "$S"/*.sh "$DST"/
ls "$DST"
