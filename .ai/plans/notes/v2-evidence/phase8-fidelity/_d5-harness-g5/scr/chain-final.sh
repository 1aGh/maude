#!/bin/bash
cd "$(dirname "$0")/.."
rm -f .scr/chain-final.done
bash .scr/chain-all.sh > .scr/chain-all.log 2>&1
bash .scr/chain2.sh > .scr/chain2.log 2>&1
echo FINAL-CHAIN-DONE > .scr/chain-final.done
