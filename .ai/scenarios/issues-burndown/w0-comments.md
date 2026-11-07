# W0 issue-hygiene comments — DRAFT, not posted (needs Michal's direct OK)

Each block: issue → ticks to make in the body, then the comment text.

## #163
Tick: "Project port across rest/relaunch".
> Done on main: the bound port is stored per project and reused on rest/relaunch (`apps/desktop/src-tauri/src/app_state.rs` `preferred_port` / `record_port`, commit 90e6976f5). Remaining items are tracked in the Nov 2026 burndown plan `.ai/plans/feature-issues-burndown-2026-11.md` (W2 T2.5).

## #128
> Status check against main (2.0.8):
> - §9 `GET /_api/export-jobs?id=` — done (filters by id, 404 when unknown), shipped in 2.0.0.
> - Cloud comment item 1 (shim env) — fixed in 2d3b5dc80 with `test/export-shim-env.test.ts`; ships in the next release.
> - Everything else is in the burndown plan `.ai/plans/feature-issues-burndown-2026-11.md` (W1 T1.1–T1.4, W3).

## #164
Tick: the `curl-local` create item; the `trash move` item.
> Done on main (2.0.0): loopback creates through `curl-local` are claimed by the open run; AI-driven `trash move` is claimed before the file leaves. Synced `history diff` works through the project changes route and rows read "<person> · AI" — the "version before by position" part stays open. Remaining: burndown plan W5 T5.1.

## #168
Tick: the `routes/edit.ts` early-note item.
> Done on main (2.0.0): the early note is withdrawn when the write throws. Remaining: burndown plan W1 T1.8 / W5 T5.4.

## #170
Tick: the `cli.mdx` port wording item; the `plugins/design/README.md` post-edit gate item.
> Done on main: `cli.mdx` port fallback wording and the README post-edit gate sentence. The migration docs carry the Update project notices but still miss the save-mode line — kept open. Remaining: burndown plan W2 T2.4.

## #171
Tick: the `local-cell.mjs` `v2Config` item (code). Lane rerun to be confirmed in W8.
> `scripts/dev/local-cell.mjs` now wraps its config in `v2Config(...)` (2.0.0). The desktop lanes that use it get rerun in the burndown plan W8 T8.2.

## #156
> §5 done (a837fe97e: the flow plugin description is short and no longer lists commands). §1–§4 in the burndown plan W4 T4.2–T4.4, including the opt-in `design-video` plugin split.

## All other open issues (212 208 206 172 169 167 165 158 155 151 150 127 122 113)
> Tracked in the Nov 2026 burndown plan `.ai/plans/feature-issues-burndown-2026-11.md` (<wave/task>). Each item closes with a comment naming the commit, the test or run that proves it, and the release that carries it.
