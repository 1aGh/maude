#!/bin/bash
cd /private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
for v in 203 204; do
  M=app-$v/Maude.app/Contents/MacOS
  echo "v$v: $(ls $M | tr '\n' ' ')"
  echo " server MAUDE_CANVAS_MODULE_CACHE_MB hits: $(grep -c MAUDE_CANVAS_MODULE_CACHE_MB $M/maude-server)"
  echo " shell 'unused for' hits: $(grep -c 'unused for' $M/maude-desktop)"
  echo " $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' -c 'Print :CFBundleShortVersionString' app-$v/Maude.app/Contents/Info.plist | tr '\n' ' ')"
  shasum $M/maude-server | cut -c1-12
done
