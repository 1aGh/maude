#!/bin/bash
# js.sh <session> <file.js>  — run a JS file in the page (expression value is printed)
agent-browser --session "$1" eval "$(cat "$2")"
