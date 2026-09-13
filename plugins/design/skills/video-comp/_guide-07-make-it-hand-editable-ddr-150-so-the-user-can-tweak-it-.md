## Make it hand-editable (DDR-150 — so the user can tweak it on the Timeline)

The Timeline lets the user move / trim / remove / replace / insert clips by
hand after you generate the comp. Author it so those direct edits land cleanly:

- **Explicit `from` + `durationInFrames`** on every `<Sequence>` — a literal
  number or a top-level `const A = 60;` (a derived `const TOTAL = A + B - XF;`
  is fine; both resolve). Avoid computing timing inline from a prop/expression
  the user can't grab (`durationInFrames={a > b ? x : y}` is opaque to the
  Timeline). A cursor-implicit clip still works — moving it just inserts a `from`.
- **Name your clips** with `<Sequence name="intro">` / `<Sequence name="logo">`.
  The name becomes the clip's durable identity in the Timeline (it survives
  reordering + Prettier), so an edit always lands on the right clip even on a
  multi-comp canvas. Without a name the Timeline falls back to a comp-scoped
  index, which is still safe but less legible.
- **One `<Video>`/`<Audio>`/`<Img src>` per clip** for a replaceable media slot
  (the ⇄ button swaps its `src`). A `src` built from a prop isn't replaceable.
- Prefer **standalone `<Sequence>`** clips when the user will likely add/remove
  beats — splitting or inserting inside a `<TransitionSeries>` is deferred
  (the transition-overlap math), so those ops refuse there for now.
- **Never build `<Sequence>`/`<TransitionSeries.Sequence>` blocks with
  `.map()`/`.flatMap()` over an array** — even though it's valid React and
  renders correctly, the Timeline reads the file as **text**, not as executed
  code (see `timeline-parse.js`'s header). A loop produces exactly ONE literal
  `<TransitionSeries.Sequence>` occurrence in the source (the JSX written once
  inside the callback), with an unresolvable `durationInFrames={clip.dur}` —
  the panel collapses N real clips into one generic fallback row. **Write one
  literal block per beat**, even for many clips — see the worked example below.
