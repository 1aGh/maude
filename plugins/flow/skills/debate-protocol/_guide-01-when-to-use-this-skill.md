## When to Use This Skill

A flow/design command convening a debate at a loop **bookend**:

- **DIVERGENT** (START — "what's BEST", no artifact yet): `/flow:plan`, `/flow:setup-prd`, `/design:setup-ds`.
- **ADVERSARIAL** (END — "is it actually safe/done/good", artifact exists): `/flow:validate-security`, `/design:critic`.
- **RESEARCH** ("what's TRUE", ends when evidence eliminates hypotheses): `/flow:bug-rca`, `ux-research`.

The middle of the loop (`execute`) stays **solo**. `/flow:quick` gets only the escalate-only tripwire (§Stakes-gate). Never auto-fire a debate on a per-iteration loop (`edit --perfect`, `quick`, `utils-verify`).
