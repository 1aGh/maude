## Transitions — Remotion already has the library, and Maude ships it

The user's "is there a transitions library" question: **yes.** `@remotion/transitions`
is bundled in `RUNTIME_PACKAGES` (DDR-148). The director may use **exactly these
six** presentations (each a separate import) — nothing else resolves on an
end-user install:

| Presentation | Import | Use it for |
| --- | --- | --- |
| `none` (hard cut) | — (omit the `<Transition>`) | the punchy default; most beats |
| `fade` | `@remotion/transitions/fade` | calm / elegant / a breath between moods |
| `slide` | `@remotion/transitions/slide` | a deliberate directional push (`{ direction }`) |
| `wipe` | `@remotion/transitions/wipe` | a graphic reveal |
| `flip` | `@remotion/transitions/flip` | a playful hard beat change |
| `clock-wipe` | `@remotion/transitions/clock-wipe` | a radial reveal (logo stings) |

Exotic presentations (`dreamy-zoom`, etc.) are **NOT bundled in v1** — do not
import them. (Widening the set is a gated follow-up: add the bundle to
`RUNTIME_PACKAGES` + `.min-sizes.json` floor + `check-runtime-bundles.sh`, per
DDR-148 "whatever is committed is what ships" — bytes on every canvas, so only
when a real cut needs it.)
