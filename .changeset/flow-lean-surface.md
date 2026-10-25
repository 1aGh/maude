---
"@1agh/maude": minor
---

Flow: ten commands instead of 31. `plan` (`--prd`), `execute` (`--quick`), `validate` (`--fast`, `--security`, `--a11y`, `--visual`, `--review`, `--scenario`), `done` (now writes the implementation report and retro itself), `bug-rca`, `bug-fix`, `release` (`--changelog`), `record-ddr`, `init` (`--context`, `--map`, `--kgai`) and `run` (`--status`, `--pause`, `--resume`). The old commands still work for one release: each forwards to its new form and says so. `/flow:help` gives way to Claude Code's own `/help`; the `maintain-*` commands are retired. The a11y, responsive and motion rule skills are merged into one `ui-rules` skill. See the migration page: https://maude.sh/docs/flow-migration
