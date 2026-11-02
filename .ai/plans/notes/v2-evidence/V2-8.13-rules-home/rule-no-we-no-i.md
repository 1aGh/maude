# No “we”, no “I” — rule `00/rule/no-we-no-i` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§4).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-words-lint.test.ts` — "banned words in a string, a template and JSX text are hits" · "\"I\" the key and \"!\" in code are not the pronoun" · the whole-tree run with a short, justified allowlist that must keep matching
- `apps/studio/test/v2-empty-kit.test.tsx` — "voice (CONTRACT §3–§4): no we / I / Oops / !"

## Fidelity pairs
- `02/ob-first-launch` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/02-onboarding/ob-first-launch-light.jpg
