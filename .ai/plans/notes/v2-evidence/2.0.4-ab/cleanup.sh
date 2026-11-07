#!/bin/bash
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
cd $S
rm -rf target app-203 app-204 probehub appfixture fakehome
# keep result.json / studio.log / stdout; drop fixtures and homes
for d in sync/*/ rss/*/ appruns/*/ tabs/*/; do
  rm -rf "$d"hub-checkout "$d"project "$d"home "$d"hub
done
du -sh $S
df -h / | tail -1
