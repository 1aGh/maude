---
name: whats-new-entry
description: Append a user-facing "What's New" entry to the Maude UI feed (apps/studio/whats-new.json) when closing out a feature. Use during /flow:done for any user-visible design / dev-server change, or when the user asks to "add a what's new entry", "announce this in the UI", or "update the changelog feed". Writes a pending entry (version null — stamped at release); can attach spotlight tour steps for a new UI affordance.
---

# whats-new-entry — append to the Maude UI "What's New" feed

Repo-internal skill (Maude-specific; lives in `.claude/skills/`, not shipped via the marketplace or npm). It owns the authoring + append logic that `/flow:done` delegates to via `integrations.whatsNew.skill` in `.ai/workflows.config.json`. Keeps the **generic** flow plugin free of Maude paths (DDR-D).

## What the feed is

`apps/studio/whats-new.json` is the single source of truth (DDR-A) for the notices the Maude UI surfaces — the Home "What's new" line (`client/v2/signin/WhatsNewLine.jsx`), the first-run toast, Menu › Help › What's new (the project menu's Help row, which carries the unseen count), and the panel it opens (`GET /_api/whats-new`). It ships with the dev-server and describes **Maude's own product** updates. Schema: `apps/studio/whats-new.schema.json`. Background: `.ai/plans/feature-in-app-whats-new-tour.md`.

## When to run

Invoked during `/flow:done` (step 4d) for a **user-visible** change to the design plugin / dev-server / Maude UI. Skip for internal refactors, infra, docs-only, or flow-plugin-only work — same judgment call as the changelog reminder. Also usable ad-hoc: "announce X in the UI".

## How to author an entry

1. **Decide if it's user-visible.** If not → tell the user, do nothing.

2. **Draft the entry** from the plan + commit. Shape (validate against the schema):
   - `id` — kebab slug, usually derived from the plan slug (e.g. `phase-23-canvas-images` → `canvas-images-link-unfurl`). Must be unique in the feed.
   - `version` — **`null`** (pending). The release flow (`scripts/bump-version.sh` → `scripts/stamp-whats-new.mjs`) stamps it with the shipped version + date. Do NOT guess a version.
   - `date` — `null` (stamped at release).
   - `kind` — `feature` | `improvement` | `usage` | `fix`.
   - `title` — short, benefit-first (≤ ~48 chars). No version numbers in the title.
   - `summary` — 1–2 sentences, plain language, what the user can now do. No internal jargon (DDR refs, file paths, task numbers).
   - `learnMore` — optional docs URL (omit if none).
   - `surface` — `design-ui` for canvas-browser features.
   - `tour` — **optional** spotlight steps, only if the feature added a visible UI affordance. Each: `{ target, title, body, placement?, optional? }`. The target is a `[data-testid="…"]` or `[data-tour="…"]` hook that exists in `client/testids.json` (never a styling class; the toolbars are inside the canvas frame and cannot be spotlit); `optional: true` skips the step when the element is absent for a role or shell. `test/tour-targets.test.ts` pins every replayable target to a current hook, so add the hook to `testids.json` / `TESTIDS.md` first. When a later redesign removes the chrome a tour points at, set the entry's `replayable: false` (the panel then offers no "Take tour"); never leave a dead target on a replayable entry.

3. **Idempotency.** If an entry with the same `id` already exists, update it in place instead of appending a duplicate.

4. **Append** to the top of `entries` (newest first) and write the file back with 2-space indent + trailing newline.

5. **Validate.** `cd apps/studio && bun test test/whats-new.test.ts` (the loader + shape tests run against the committed feed) — must stay green. The feed must also satisfy `whats-new.schema.json`.

6. **Mirror to the site** (only once Phase 2 of the plan has landed `gen:whatsnew`): `pnpm --filter @maude/site gen:whatsnew` and stage the resulting `site/lib/whats-new.json`. If the script doesn't exist yet, skip silently.

7. **Stage** `apps/studio/whats-new.json` (and the site feed if regenerated) so it rides in the feature commit.

## Notes

- No client rebuild is needed for a feed-only change — the client fetches the JSON at runtime. (A rebuild is only needed when you touch `client/whats-new*.{jsx,js}` / `app.jsx` / CSS — and then rebuild **release**: `MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`, never a bare source boot, which self-heals to unminified dev bundles.)
- Keep entries honest and curated — this is the user's first impression of a release. One entry per shipped feature, not per commit.
