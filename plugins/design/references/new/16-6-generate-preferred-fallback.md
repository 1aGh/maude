### 6. Generate — preferred + fallback

Try in order, document which path is used:

1. **Preferred:** `Skill(skill: "frontend-design:frontend-design", args: <envelope>)` — creative-design specialist. **Always attempt this first** — even when you predict "same model executes, won't help". Predicting the outcome before observing is the violation; trying and falling back transparently is the contract. See SKILL.md "Why call the Skill even when the executing model is the same".
2. **Fallback:** If the Skill is unavailable / errors out (typically "Skill type not found" or "Agent type 'frontend-design:frontend-design' not found"), generate directly via Read + Write with the envelope as the prompt. **Mark the report as "orchestrator-direct fallback (quality may be 1 generation lower)"**.
3. **Never silently fall back.** The final print MUST contain a `Generation: <path>` line stating which path generated. After generation, update `<DESIGN_ROOT>/_history/<slug>/000-envelope.md` "Generation path:" line with the actual path taken.

See SKILL.md "Cross-skill calls → Generation invocation".
