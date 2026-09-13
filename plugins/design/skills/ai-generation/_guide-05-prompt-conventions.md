## Prompt conventions

- **Give the subject, not the imperative.** The provider wants "a minimal ceramic mug on a linen surface, morning light", not "generate a mug". Strip the "generate a …" scaffolding before passing `--prompt`.
- **Aspect follows placement.** Hero → `16:9`; avatar/tile/icon-photo → `1:1`; story/mobile-full → `9:16`; card → `4:5`/`4:3`. Pass `--aspect`.
- **Editing** (`--source`): describe *the change*, not the whole scene — "remove the background", "make it winter", "add soft rim light". Nano Banana keeps the rest.
- **Pass the user's wording verbatim** where possible; don't inject brand names or "vibe references" the user didn't give (the same bias rule the design brief flow follows).
