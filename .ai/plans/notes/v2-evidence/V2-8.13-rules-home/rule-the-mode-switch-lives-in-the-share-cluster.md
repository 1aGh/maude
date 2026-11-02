# The mode switch lives in the Share cluster — rule `00/rule/the-mode-switch-lives-in-the-share-cluster` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/share-cluster.test.tsx` — "the mode switch's slot sits after Comments (the host fills it with ModeSwitch — mode-toggle.test)"
- `apps/studio/test/mode-toggle.test.tsx` — boot posture + mode⇄tool invariant (15 tests): read-only boots Preview, setMode arms the resting tool
- `apps/studio/test/tool-keys.test.ts` — "Viewing: H inspects, C comments; every editing key reaches the denial line"
- `apps/studio/test/v2-rule-access-in-words.test.tsx` — a read-only person sees Viewing where Edit would be (preview-bar hint "esc for Viewing")

## Fidelity pairs
- `04/md-model` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/04-modes/md-model-light.jpg
- `04/md-comment-only` is built in the ledger, so no fidelity pair is claimed for it
