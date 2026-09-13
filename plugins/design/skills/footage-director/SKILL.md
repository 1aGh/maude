---
name: footage-director
description: "Turn analyzed footage into a directed edit: EDL, transitions, audio, captions and editable Remotion code."
---

# footage-director

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Direct from analyzed picture and sound, retain stable clip identities and author a real editable EDL. Preserve the EDL-to-Remotion codegen contract, transition timing, audio/caption tracks and verification. Load the codegen sections when materializing or editing a cut; analysis alone does not need the full implementation recipe.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: The two artifacts (schema: `apps/studio/footage/schema.ts`) | [The two artifacts (schema: `apps/studio/footage/schema.ts`)](./_guide-01-the-two-artifacts-schema-apps-studio-footage-schema-ts.md) |
| When performing this stage: Transitions — Remotion already has the library, and Maude ships it | [Transitions — Remotion already has the library, and Maude ships it](./_guide-02-transitions-remotion-already-has-the-library-and-maude-.md) |
| When performing this stage: EDL → `<TransitionSeries>` codegen contract (the load-bearing part) | [EDL → `<TransitionSeries>` codegen contract (the load-bearing part)](./_guide-03-edl-transitionseries-codegen-contract-the-load-bearing-.md) |
| Before reporting results or handing off | [Verify + hand off](./_guide-04-verify-hand-off.md) |
