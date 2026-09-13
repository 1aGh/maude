

# Debugging Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for systematic debugging. These are non-negotiable.

This skill reads `boundaries` from `.ai/workflows.config.json`. Each entry is a place to instrument before guessing — every system in `boundaries.realtime`, `boundaries.video`, `boundaries.api`, `boundaries.db`, `boundaries.auth`, `boundaries.telemetry`, `boundaries.payments` is a potential failure seam. Skip the skill with `skills.debuggingRules.enabled: false`.
