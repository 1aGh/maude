Stage D4 harness, G4 canvas 10 (Share and Collaboration) only. = _d3-harness-g4 on top of _d2-harness-g4, plus s10m from _c6-bugs4-harness (round-6 thread / offline frames). lib.mjs REPO is repointed to the shooting worktree.
Needs node_modules symlinks (root + apps/studio) into the main checkout, then `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`; copy the stage-A spec PNGs into .scr/spec/10-share-and-collaboration.
chain.sh order: s10 s10cm s10c s10d s10e s10m (later scripts overwrite co-comment-*, co-sync-offline, co-share-advanced-tall), then `node mkpairs.mjs 10-share-and-collaboration`.
Gotcha: s10c writes to process.cwd()/.scr/impl, so with chain.sh (cwd = .scr) the co-access-ends frames land in .scr/.scr/impl/...; move them into .scr/impl/... afterwards.
Default Playwright Chromium (no SHOT_CHANNEL). 36 impl frames; pairs via mkpairs (co-ask-edit uses co-ask-edit-tip, co-share-advanced uses co-share-advanced-tall).
