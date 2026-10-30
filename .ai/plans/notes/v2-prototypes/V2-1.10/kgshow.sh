#!/bin/bash
# usage: kgshow.sh "<search text>" [hit-index]  (run from the worktree)
idx="${2:-0}"
id=$(kg search "$1" | jq -r ".hits[$idx].id")
echo "## id=$id"
kg query "MATCH (d:Decision) WHERE d.id = '$id' RETURN d.rationale AS r" | jq -r '.rows[0].r'
