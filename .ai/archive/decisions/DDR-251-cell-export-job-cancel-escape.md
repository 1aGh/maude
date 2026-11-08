# DDR-251: `/_api/export-jobs/cancel` escapes the forbidden export prefix in a cell

- **Date:** 2026-11-08
- **Status:** Accepted
- **Tags:** cloud, cell, containment, export, ddr-193, ddr-230
- **Related:** DDR-193 (containment invariant), DDR-230 (maude-render export service), decision `maude/v2-p8-containment-v2-export-routes`, `maude/burndown-t3-7b-cloud-followups` (#128 T3.7b)

## Context

A cloud cell refuses every route under the forbidden export prefix except a fixed list (`except:` in the workspace-mode module, pinned by `scripts/check-containment.sh`). #128 T3.7b added a Cancel for a running cloud export: `POST /_api/export-jobs/cancel {id}`. In a cell it must work, because the cloud export it stops runs in that cell's job lane.

## Decision

Add `/_api/export-jobs/cancel` to the except-list. It only aborts a job the calling session owns (`jobs.cancel` fires that job's own abort signal; a foreign or missing id answers the same 404), carries no job body and no secret, writes no project byte, and never reaches a renderer from the cell — the abort already cancels the job on the render service through the T3.7 render-id path.

## Alternatives rejected

- Keeping Cancel desktop-only: the cloud lane is exactly where long video renders wait, so a member could not stop their own job.
- A new route outside the export prefix: it would dodge the gate instead of being reviewed by it.
