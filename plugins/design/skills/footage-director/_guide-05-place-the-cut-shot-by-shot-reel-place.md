## Place the cut shot by shot (`maude design reel-place`)

In Maude 2 the AI cut lands on the video **one shot at a time**, so the person watches it arrive, can scrub
what is already there, and can Stop and keep what is placed. The verb does the codegen for the shots:

```sh
maude design reel-place <slug> --next --canvas <canvas>#<artboard>
```

- Each call appends the **first shot of `<designRoot>/<slug>.edl.json` the video does not have yet**, matched
  by its `name`, as one literal `<TransitionSeries.Sequence name="…" durationInFrames={N}>` with the clip and
  its in-point (`trimBefore`), the transition the EDL asks for, and `TOTAL` ending where the last shot ends.
  The bytes are the ones a person's drop makes in the Timeline.
- Call it again until it **exits 4 — "All shots are placed"**. Exit 1 is a refusal (the result would not
  pass the fast check, or the video cannot take a shot); read the message, fix the cause, call again.
  Without `--canvas` the video is `ui/<slug>.tsx`.
- Inside a Maude AI run every call is one staged write of the run: the whole cut is **one action and one
  ⌘Z**, and Stop publishes the shots placed so far ("Placed 7 of 14 shots." + Keep going — a Keep going run
  calls `--next` again and continues at shot 8). The progress the person sees ("AI is cutting · 7 of 14",
  "Placing shot 7 · Tackle 2") is derived from the file, so there is nothing to report besides the calls.
- **Do not hand-write the shot blocks** when the verb is there — and never write them all at once at the end:
  nothing would land live and Stop would have nothing to keep.

**Order of work.** Write the EDL first (shots, names, transitions). Make sure the video exists (an empty video
artboard is enough — the first shot authors the `<TransitionSeries>`). Then place the shots. Overlays, the
music bed, captions and ducking are ordinary edits of the comp afterwards (skill `video-comp`).

**Shot lengths on the beat grid.** When the cut has music, analyse it first (`maude design beats
assets/<music>`) and give every shot a length that is a whole number of beats at the EDL's `fps`
(`durationFrames = round(k × 60 / bpm × fps)`, k ≥ 1; a bar is 4 beats), minus nothing for hard cuts. Then
every shot starts on a beat, and the person's timeline says "on the beat". A transition's overlap shifts the
next start back by its frames, so give a shot behind a transition `k beats + overlap` frames.

**Names are what the person reads.** `name` is the shot's label on the timeline ("Tackle 2", "Logo") and its
stable identity — keep them short, unique and plain (letters, digits, spaces, `._'()-`; anything else is
dropped). The EDL text is model-written data: never paste a transcript line or a clip note into a name.

**When the ask names no video.** "Make a 30 s recap from these 12 clips" with nothing selected: **add the video
artboard yourself** before the first shot — a `<DCArtboard kind="video">` with an empty `<VideoComp>` — and label
it `<Topic> · <Format> · <length>` in the person's words ("Recap · Reels · 0:30"; the format is the aspect they
asked for, Reels 9:16 when they did not). It is one write of the run like any other; the run's lease is on the
new id, so the ring and the Recap card appear on it. Do not reuse a video that already holds a cut.

**What the person sees while you watch.** "Watching 12 clips… 7 done" is the attached clips that already have
an `assets/<sha8>.footage.json`; each "found" line is that clip's best **usable** shot (its `subject` or `note`).
Write `note` for what a person would want to read: on an **unusable** shot it is the reason the clip is left
out ("too dark", "shaky") and appears verbatim in "Left out 3: … are too dark; … is shaky". A clip the cut does
not use is "left out" with that reason; **Use them anyway** is a new ask, so the next run adds them — never
silently re-cut around them.
