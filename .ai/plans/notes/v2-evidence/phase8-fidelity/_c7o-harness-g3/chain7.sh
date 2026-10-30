#!/bin/bash
# 07 full re-shoot, both themes (wipes impl/07 first)
cd "$(dirname "$0")" || exit 1
rm -rf impl/07
for th in light dark; do
  echo "=== t07 $th"
  TAIL=40 bash go7.sh t07 $th
  echo "=== t07c $th"
  TAIL=20 bash go7.sh t07c $th
done
echo CHAIN7-DONE
