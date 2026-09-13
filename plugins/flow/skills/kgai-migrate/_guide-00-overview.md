

# kgai migration contract

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

How an existing repo's file-based decision store becomes a knowledge graph, once. The importer is `cli/lib/ddr-to-kgai.mjs`, reached via `maude kg import` (DDR-062). This skill is the contract it implements; `/flow:migrate-kgai` is the guided flow.
