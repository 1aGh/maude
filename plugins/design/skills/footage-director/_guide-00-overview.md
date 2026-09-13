

# footage-director — from analyzed footage to a real cut

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

This skill is the layer that turns **understood footage** into a **composition**.
It sits on top of two things and owns the seam between them:

- **Below it:** the `footage-analyst` agent (per-clip `FootageAnalysis` sidecars)
  and the `footage-director` agent (the `Edl` decision). See those agent docs.
- **Above it:** skill **`video-comp`** — the Remotion iron rules, bundled-imports
  constraint, `<VideoComp>` meta, and the **Timeline-parseable literal-block**
  discipline. **Everything in `video-comp` applies here** — this skill only adds
  the EDL→TSX mapping. Load `video-comp` alongside this.

The end-to-end flow is orchestrated by `/design:reel`:
`ingest-footage → footage-analyst (per clip) → footage-director (EDL) → THIS codegen → critics`.
