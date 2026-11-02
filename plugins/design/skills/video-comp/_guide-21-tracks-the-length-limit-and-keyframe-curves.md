## Extra tracks, the length limit, and a keyframe's curve (Maude 2)

Three things live under the Timeline's **Advanced** (the fold at its foot). None of them is a new kind of
file: each is a reading of, or one small write into, what the video already says.

### "+ track": Video 2 and Music 2

A comp's tracks are **derived**, never stored: Text · Graphics · Video · Music always, **Video 2** when a
standalone video or image sits over the storyline, **Music 2** when a second song overlaps the first. So
there is nothing to write to add one. "+ track" only asks the Timeline to *draw* an empty lane for the
person (in their browser, not in the file). To put something on Video 2, write a standalone `<Video>` /
`<Img>` (not a `<TransitionSeries.Sequence>` beat); to put a second song on Music 2, add an `<Audio>` whose
span overlaps the first. The lane appears on its own, and the person's "+ track" for it becomes a no-op.

### How long one export may be (C22)

A video past **3 600 frames** (2:00 at 30 fps) warns, everywhere: the Timeline's badge, the Export sheet
and the server say the same sentence — "Recap is 2:40 long — one export goes up to 2:00 (3,600 frames at
30 fps)." — and the server refuses a longer export unless it is allowed.

| What the person does | What an agent writes |
| --- | --- |
| **Allow longer** in Advanced › Long videos | `artboardMeta.<artboardId>.maxFrames` in the canvas `.meta.json`: an integer up to **18000** (10:00 at 30 fps). The studio writes it through `PATCH /_api/present-meta { file, maxFrames: { "<artboardId>": 18000 } }` (Can edit and up) — `null` takes it off |
| **Back to the limit** | `maxFrames` removed |

`maxFrames` is the artboard's **ceiling**, not a switch: an export still has to ask for "Allow longer"
(`options.video.allowLonger`: the Export sheet's own toggle, or `--option allowLonger=true` on `maude design export`),
and then it may go as far as the artboard's number (18000 when there is none). Never raise it past 18000,
and do not write it into a comp that is meant for a short social cut — the warning is a feature.

### A keyframe's curve

An animation in a comp is an `interpolate(frame, [from, to], [a, b])` inside a named component. Advanced
shows each of them as a marker on its clip, and the selected one as a curve with two handles. The curve is
the call's own options:

```tsx
const y = interpolate(frame, [10, 30], [48, 0], { easing: Easing.bezier(0.22, 1, 0.36, 1) });
```

The designer reads `Easing.bezier(a, b, c, d)` as `cubic-bezier(a, b, c, d)` — the same four numbers. Rules:

- Four numbers; the first and third are between 0 and 1 (the curve stays a function of time), the others
  between -2 and 3. `cubic-bezier(0.22, 1, 0.36, 1)` is the ease-out the Timeline offers.
- `Easing` comes from `remotion` (it is bundled). The studio adds it to the existing `remotion` import.
- Other options on the call (`extrapolateRight: 'clamp'`) stay. A curve spelled another way
  (`Easing.out(Easing.cubic)`) is shown as written and left alone until a handle is dragged.
- The studio writes it with the `video.easing.set` edit op (`POST /_api/edit-op`, params `{ artboard,
  component, index, bezier }` — `index` is the call's order among the `interpolate(frame, …)` calls of that
  component's body; `bezier: null` takes the curve off). An agent writing the TSX by hand does the same edit
  and nothing else.
