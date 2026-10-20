## Title motion, a join's transition, and how a vertical clip sits (Maude 2)

The Timeline's inspector and its join picker write these. An agent writes the same bytes.

### Title motion — `<TitleMotion>`

A title's entrance is one component around the title's content, inside its `<Sequence>` (so the
frame it reads is the frame since the title began). Literal props only:

```tsx
import { TitleMotion } from '@maude/canvas-lib';

<Sequence name="title" from={20} durationInFrames={66}>
  <TitleMotion preset="slide-up" frames={12}>
    <div style={{ color: 'white' }}>{"PROČ ALLIGATORS"}</div>
  </TitleMotion>
</Sequence>
```

| `preset` | What it does |
| --- | --- |
| `none` | Nothing — and no wrapper (the plain title). |
| `fade` | Opacity 0 → 1 over `frames`. |
| `slide-up` | Rises 48 px with the fade, ease-out. |
| `pop` | Scales 0.8 → 1.06 → 1 with the fade. |
| `type-on` | Reveals the title's characters one after another (text only; anything else fades). |
| `per-word` | Each word fades and rises, a few frames after the last (text only; anything else fades). |

`frames` is a whole number, 1–90 (12 when absent). When the title also sits in a `<Place>`, the
motion goes **inside** it (`<Place><TitleMotion>…`): a transform on an outer wrapper would become
the containing block of Place's absolutely positioned box. `maude design check` refuses a preset it
does not know (`video-title-motion`).

Edit it with the `video.title.motion` op (`{ stableId, preset, frames? }`); `none` unwraps.

### A title's font and colour

A title's look is the `style` object literal of the element that holds its words (the parent of the
clip's first `{"…"}` string): `fontFamily` is a design-system font token written `"var(--font-display)"`,
`color` is a token (`"var(--accent)"`) or one plain CSS colour (`"#2fbf71"`, `"oklch(0.7 0.1 150)"`).
Never a family name typed in. Put them there yourself, or use the `video.title.style` op
(`{ stableId, font?, color? }`; `null` takes one off, and the last one off takes the empty `style` off
too). A `style` that is not an object literal is left alone.

### A join's transition

A join is the `<TransitionSeries.Transition>` between two scenes. The picker's six tiles are today's
six presentations: **Cut** is `none()`, **Fade** `fade()`, **Slide** `slide()`, **Wipe** `wipe()`,
**Flip** `flip()`, **Clock wipe** `clockWipe({ width, height })`; its Length slider is the timing's
`durationInFrames`. The `video.transition.set` op (`{ stableId, presentation?, durationInFrames? }`,
the transition's own `stableId`) changes either and fixes the imports.

### A vertical clip on a wide video

The first time a vertical clip (taller than wide) lands in a 16:9 video, the Timeline asks how it
should sit: **Fill** crops it to the player, **Fit** shows the whole picture with bars, **Blur behind**
fills the sides with a blurred copy. The answer is the `fit` of the clip's `<Reframe>` — the
`video.fit` op (`{ stableId, fit: "fill" | "fit" | "blur" }`). "Same for every vertical clip" is the
person's own setting in the browser, never a file.
