# The timeline comes with a video artboard — rule `00/rule/the-timeline-comes-with-a-video-artboard` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/timeline-summon.test.ts` — "a video artboard summons it, compact, over that video" · "anything that is not a video sends it back" · "esc (selection cleared) slides it back" · "esc does not hide a kept-open island" (Keep timeline open)
- `apps/studio/test/actions-keys.test.ts` — the registry chord ⇧⌘T for view.timeline-keep-open (apps/studio/actions/keymap.gen.ts)

## Fidelity pairs
- `07/ve-deselect` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/07-video-editing/ve-deselect-light.jpg
