#!/bin/bash
# C6 bugs4: every re-shoot, both themes, sequentially
cd "$(dirname "$0")" || exit 1
for th in dark light; do
  bash go.sh s10m $th
  bash go.sh t08c $th
  bash go.sh t09c $th
  bash go.sh s13 $th G=c
done
echo CHAIN-C6-DONE
