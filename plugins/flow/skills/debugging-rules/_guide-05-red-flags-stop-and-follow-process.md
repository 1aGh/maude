## Red flags — STOP and follow process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt"** (when already tried 2+)
- **Each fix reveals a new problem in a different place**

**All of these mean: STOP. Return to Phase 1.**

If 3+ fixes failed → question architecture (Phase 4 step 5).
