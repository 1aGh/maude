#!/bin/bash
# lists spec pngs with no impl png (and impl extras) per canvas
cd "$(dirname "$0")"
for d in 13-design-system 14-editing 15-annotations; do
  ls impl/$d | grep -v 'crop\|board' > got.txt
  ls spec/$d > want.txt
  echo "--- $d missing:"
  comm -13 got.txt want.txt | tr '\n' ' '
  echo
  echo "--- $d extra:"
  comm -23 got.txt want.txt | tr '\n' ' '
  echo
done
