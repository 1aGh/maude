# Round 9 (p8-c9-bugs) - five small product bugs the D6 critics found

Branch `p8-c9-bugs`, no re-shoot (the lead re-shoots on the merged tip). Each fix has a test that was red first
(the export one also reverted once to prove it).

| Canvas / id | Root cause | Fix | Test |
| --- | --- | --- | --- |
| 08 `ak-video` Sound row "None yet" | `loadSound` read only `clips[]` of `/_api/comp-clips`. A bare `<Audio>` in the comp body (outside every Sequence) is not a clip - the enumerator lists it under `media`. The Timeline's Music lane reads the same loose bed from the source. | `video-facts.js` falls back to `media[]` (`tag === 'Audio'`). | `kind-inspector-rows` "a music bed that sits loose in the comp body..." |
| 03 `ai-question` Undo / Keep going / Same on Web on a no-change answer | A ⌘/ ask on a picked element opens the run with `objects = scope.elements` (S2.19 "AI's from the moment it exists"). `changedSomething` counted any `objects`, so the answered flag (`useAnswered`) never engaged. | `changedSomething` counts only objects beyond the held scope elements; touched artboards still count. | `v2-ai-run-model` "a ⌘/ ask on a picked element holds it..." |
| 03 `ai-question` Ask card hint grey on a dark artboard | The hint sat as bare `--fg-2` text over the artboard (AA fail in light). | `.as-hint` is the board's `.ed-hint` pill (`--bg-2`, `--fg-1`, 26 px, shadow + edge), on one line beside the bubble, wrapping below when there is no room. | `v2-ask-selection` CSS pin |
| 03 `ai-history` selected AI row loses "Undo this chat" in compare | `compareActs` (Stop comparing / Restore only / Restore this version) had no `ChatUndoButton`. | `ChatUndoButton` for the held row `aRow`, just before Restore this version. | `v2-compare-view` "your AI row keeps Undo this chat beside Restore while comparing" |
| 06 `ad-settings` Reset all settings... neutral | `.v2s-warn { color }` lived in `@layer shell`; `.btn` sets its ink in `@layer components` (later layer wins) so it never showed. | `.btn.v2s-warn` (+ `:hover`) in the components layer on `--status-error-text` (the board's `.btn.ad-btn-warn`). | `v2-settings` CSS pin |
| 09 `ex-offline` default tick | `renderChoice` ticked the cloud when the estimate suggested it, online or not. | Offline, "Suggest each time" ticks On this Mac (the footer follows the ticked card); a standing choice or a click still wins; online unchanged. | `export-lane-choice` "ex-offline: with no connection..." |

Open: the Ask card staying open over the A4 in the ai-question shot is the harness (the lane's grace), not the product.
The loose `<Video>` bed does not feed the poster picture (`posterPicOf` reads clips only) - 08 polish, not done.
