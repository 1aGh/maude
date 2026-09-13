---
name: kgai-migrate
type: skill
description: "Import existing project decisions and review records into kgai while preserving history and archive safety."
keywords: [kgai, migrate, import, ddr, decisions, cross-ref, scope, idempotent, archive]
---

# kgai-migrate

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Use the store resolved by the engine, preserve full decision bodies and provenance, reconstruct typed links and scope all repo-local anchors. Preview a migration before writing; archive only after successful verified ingestion. Respect pending human trust and local-only stores. Read the safety and graph-shape contracts before any import; consult the matching inventory and archive branch for the requested migration.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: Where the import lands — the store `kg config` resolves | [Where the import lands — the store `kg config` resolves](./_guide-01-where-the-import-lands-the-store-kg-config-resolves.md) |
| When performing this stage: The graph shape (few stable elements, many decisions) | [The graph shape (few stable elements, many decisions)](./_guide-02-the-graph-shape-few-stable-elements-many-decisions.md) |
| When performing this stage: Edge reconstruction — typed markers FIRST, then dedupe bare mentions | [Edge reconstruction — typed markers FIRST, then dedupe bare mentions](./_guide-03-edge-reconstruction-typed-markers-first-then-dedupe-bar.md) |
| Before using data from this trust boundary | [Safety invariants](./_guide-04-safety-invariants.md) |
| When performing this stage: Full-body ingest — the graph must stand on its own | [Full-body ingest — the graph must stand on its own](./_guide-05-full-body-ingest-the-graph-must-stand-on-its-own.md) |
| When performing this stage: Incremental refresh — `--only` | [Incremental refresh — `--only`](./_guide-06-incremental-refresh-only.md) |
| When diagnosing the corresponding failure | [Two traps worth knowing](./_guide-07-two-traps-worth-knowing.md) |
| When performing this stage: What in `.ai/` migrates, what is noise, what stays — the full sweep | [What in `.ai/` migrates, what is noise, what stays — the full sweep](./_guide-08-what-in-ai-migrates-what-is-noise-what-stays-the-full-s.md) |
| Only for a requested archive/cleanup operation | [`--archive` — the cleanup half of a migration](./_guide-09-archive-the-cleanup-half-of-a-migration.md) |
| When checking known limitations; not implemented behavior | [Follow-ups (not yet in the importer)](./_guide-10-follow-ups-not-yet-in-the-importer.md) |
