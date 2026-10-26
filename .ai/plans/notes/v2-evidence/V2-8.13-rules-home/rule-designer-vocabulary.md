# Designer vocabulary — rule `00/rule/designer-vocabulary` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§3).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-words-lint.test.ts` — "no banned word in anything a person can read, outside the allowlist" (board · screen · sidebar · Pro · Debug · Delete over every string under client/v2) · "every allowlist entry still matches something"
- `apps/studio/test/v2-empty-kit.test.tsx` — "voice (CONTRACT §3–§4): no we / I / Oops / !, none of the banned nouns"
- `apps/studio/test/v2-rules-home-pins.test.tsx` — NEW (red-first): the Share sheet, Share cluster, access layer and export sheet never say "publish" (CONTRACT §3: Share replaces publish)

## Fidelity pairs
- none: the board points at "every canvas"

## Note
The board names "every canvas". Note: Version history's Advanced keeps the git verb "Publish" (git-model.js, sync-details) — that is the git push in the Advanced fold (06 ad-history), not the Share action CONTRACT §3 renames; see the hand-back.
