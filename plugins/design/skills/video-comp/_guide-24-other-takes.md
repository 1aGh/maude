## Other takes: swapping a clip's moment (Maude 2)

A clip is a window onto a longer source. When AI has watched that source, `assets/<sha8>.footage.json` lists the good
moments it found (`shots[]`, seconds in the SOURCE, `quality` 0..1, `usable`). **Other takes** offers the other
moments of the *same* source for a clip, at the *same length*, so the cut keeps its length and every cut stays on
its beat.

| What the person does | What an agent does |
| --- | --- |
| Clip inspector › Other takes…, or ⌘K › Swap a take, then click a take | Read the shots: `GET /_api/footage?asset=assets/<sha8>.<ext>` (`{}` when AI has not watched the clip; run `/design:video-analyze` first). Then `video.take.swap` through `POST /_api/edit-op` with `{ stableId, srcStart, sourceSeconds }`; it sets the clip media's `trimBefore` (output frames) and keeps `durationInFrames`, so nothing after it moves. |

What counts as a take: a **usable** shot that is at least as long as the clip's source window
(`durationInFrames × playbackRate ÷ fps` seconds), and whose start leaves that much source after it
(`sourceSeconds` = the analysis' `durationSec`). The window starts at the shot's `start`. A take the op would
refuse ("That take is shorter than the clip.") is never offered; do not try to stretch the clip to fit one.

"AI's pick" is the strongest usable shot (`quality`, the earliest on a tie) — the one the director would choose.
Swapping is a person's ordinary edit: one undo step, and ⌘Z steps back through the person's edits first, then AI's.
Never swap a take silently inside an AI run that the person did not ask to change.
