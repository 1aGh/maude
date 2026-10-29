# V2-8 dead controls — static sweep (p8-sweep-static)

Checker: `apps/studio/test/dead-controls.test.ts` (scanner `test/_dead-controls.ts`, TypeScript compiler API;
exceptions `test/dead-controls.allow.json`). Runs in `studio-suite` with the rest of `apps/studio/test`.

- Registry: 510 actions checked (340 shell · 148 canvas · 22 native) + 21 native menu rows (menu.actions.json → menu.rs `HANDLED_MENU_IDS`).
  52 had nothing that ran them: 6 fixed (canvas ⌘K rows), 43 bound to the surface control that implements them
  (the registry row is the agent/“?” vocabulary; ⌘K hides a row it cannot run — `menuRunner.canRun`), 1 agent-only, 2 needs-design.
- Client: 1159 clickable elements in 578 files. 0 without a handler, 0 noop, 2 disabled for good (allowlisted with reason),
  96 disabled without a visible reason (ratcheted per file — a new one is red; see “open”).

Rules: missing-handler · noop-handler (empty / only preventDefault, stopPropagation or console) · href-hash · disabled-for-good ·
disabled-no-reason (no `title` / aria description / tooltip, and the reason is not already on screen — in flight, an empty field,
a pass-through `disabled` prop).

| file:line | control | finding | status |
| --- | --- | --- | --- |
| apps/studio/canvas-replay-keys.ts | object.duplicate “Duplicate” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — replays ⌘D (use-keyboard-discipline) |
| apps/studio/canvas-replay-keys.ts | object.remove “Remove” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — replays ⌫ (use-keyboard-discipline) |
| apps/studio/canvas-replay-keys.ts | object.select-parent “Select parent” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — replays ⇧↵ (use-keyboard-discipline) |
| apps/studio/canvas-replay-keys.ts | view.jump-artboard “Go to artboard” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — replays ⌥⌘1 (canvas-lib viewport keydown) |
| apps/studio/editing/index.tsx | object.select-child “Select first child” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — runs goInside(), the ↵ step |
| apps/studio/editing/index.tsx | object.select-matching “Select matching” (⌘K) | no-handler: the shell posted run-action, no canvas listener answered | fixed — runs the object menu’s selectMatching on the selection |
| apps/studio/client/v2/import/figma-artboard.jsx | figma.make-editable | no registry handler | bound to its surface control `figma-make-editable` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/inspector/kinds/artboard-web.jsx | artboard.add-width | no registry handler | bound to its surface control `insp-ab-add-width` (pinned: the hook must stay in the file) |
| apps/studio/editing/artboard-menu.tsx | artboard.ask-ai | no registry handler | bound to its surface control `ask-ai` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/left-panel/assets-panel.jsx | assets.add | no registry handler | bound to its surface control `assets-add` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.zoom-in | no registry handler | bound to its surface control `Zoom in` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.zoom-out | no registry handler | bound to its surface control `Zoom out` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.zoom-fit | no registry handler | bound to its surface control `timeline-zoom-fit` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.comment-mode | no registry handler | bound to its surface control `timeline-comment-tool` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.trim | no registry handler | bound to its surface control `startTrimIn` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.move-clip | no registry handler | bound to its surface control `startMove` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/timeline/Timeline.jsx | timeline.add-clips | no registry handler | bound to its surface control `timeline-add-image` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ai/RunList.jsx | ai.runs.list | no registry handler | bound to its surface control `ai-runs-list` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ai/Working.jsx | ai.stop | no registry handler | bound to its surface control `ai-stop` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ai/WaitingCard.jsx | ai.cancel-waiting | no registry handler | bound to its surface control `ai-waiting-cancel` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ai/WaitingCard.jsx | ai.run-on-copy | no registry handler | bound to its surface control `ai-waiting-copy` (pinned: the hook must stay in the file) |
| apps/studio/client/home/home-app.jsx | home.search | no registry handler | bound to its surface control `home-search` (pinned: the hook must stay in the file) |
| apps/studio/client/home/home-app.jsx | cloud.open-remote | no registry handler | bound to its surface control `home-cloud-open-` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/signin/SignInCard.jsx | home.signin | no registry handler | bound to its surface control `signin-cloud` (pinned: the hook must stay in the file) |
| apps/studio/client/home/Shelves.jsx | invite.join | no registry handler | bound to its surface control `home-invite-join-` (pinned: the hook must stay in the file) |
| apps/studio/client/home/Shelves.jsx | invite.leave | no registry handler | bound to its surface control `home-invite-leave-` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/onboarding/HubSheet.jsx | hub.connect | no registry handler | bound to its surface control `AdvSheet` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/onboarding/FolderGithubSheet.jsx | project.open-github | no registry handler | bound to its surface control `AdvSheet` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/onboarding/CliSheet.jsx | cli.install | no registry handler | bound to its surface control `AdvSheet` (pinned: the hook must stay in the file) |
| apps/studio/../desktop/src/strip.js | tab.rename | no registry handler | bound to its surface control `tab-rename-input` (pinned: the hook must stay in the file) |
| apps/studio/client/panels/chat-header.jsx | chat.new | no registry handler | bound to its surface control `ai-chat-new` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/history-panel.jsx | history.filter | no registry handler | bound to its surface control `vh-filter-` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/history-panel.jsx | history.view-version | no registry handler | bound to its surface control `vh-row-` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/history-panel.jsx | history.compare | no registry handler | bound to its surface control `vh-compare` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/git-advanced.jsx | history.compare-pictures | no registry handler | bound to its surface control `vh-compare-pictures` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/history-panel.jsx | history.restore-artboard | no registry handler | bound to its surface control `vh-restore-only` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/object-view.jsx | history.restore-object | no registry handler | bound to its surface control `vh-obj-restore-` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/code/canvas-error-card.jsx | history.go-back | no registry handler | bound to its surface control `canvas-error-go-back` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/history/git-advanced.jsx | sync.get-latest | no registry handler | bound to its surface control `git-get-latest` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/outside-banner.jsx | ds.keep-outside | no registry handler | bound to its surface control `ds-outside-keep` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/outside-banner.jsx | ds.undo-outside | no registry handler | bound to its surface control `ds-outside-undo` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/conflict-pick.jsx | ds.pick | no registry handler | bound to its surface control `ds-twice-use` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/trash-token-sheet.jsx | ds.trash-token | no registry handler | bound to its surface control `ds-trash-go` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/direction-bar.jsx | ds.use-direction | no registry handler | bound to its surface control `ds-dir-use` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/direction-bar.jsx | ds.mix | no registry handler | bound to its surface control `ds-dir-mix` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/make-host.jsx | ds.make-done | no registry handler | bound to its surface control `ds-make-use` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/contrast-warning.jsx | ds.fix-contrast | no registry handler | bound to its surface control `ds-contrast-fix` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/ds/off-system.jsx | ds.add-colour | no registry handler | bound to its surface control `ds-off-system-add` (pinned: the hook must stay in the file) |
| apps/studio/client/v2/inspector/sections/warnings.jsx | warning.fix | no registry handler | bound to its surface control `insp-warning-fix-` (pinned: the hook must stay in the file) |
| apps/studio/actions/defs | ds.draft | no-handler | allowlisted — the AI writes a direction (`maude design ds draft`); ⌘K hides it (search.hidden) and no person control is drawn for it |
| apps/studio/actions/defs | history.object | no-handler | needs-design — no object menu / sticky menu row calls openHistory() (client/v2/history/object-filter.js); the filtered panel exists (S1.16) but has no entry point |
| apps/studio/actions/defs | ds.canvas-leave | no-handler | needs-design — “Keep this version” has no control — /_api/ds/canvas is only ever called with action 'update' (door-write.js); update-available.jsx draws no Keep row |
| apps/studio/client/v2/import/brand-sheet.jsx | “Import” | disabled-for-good | allowlisted — in-flight stand-in: drawn only on the Reading step, where each row says “Reading…”; replaced by Continue / the result when reading ends |
| apps/studio/client/v2/inspector/kinds/artboard-print-advanced.jsx | “Edit tracks…” #insp-pr-grid-tracks-edit | disabled-for-good | allowlisted — a signpost with its reason in `title`: tracks are edited on the page frame (“Select the page frame to edit its tracks” / “Set the body layout to Grid first”) |
| apps/studio/client/dialogs/asset-picker.jsx:341 | “Add to artboard” | disabled-no-reason `artboardDisabled` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/generate-dialog.jsx:341 | (unnamed) | disabled-no-reason `busy \|\| !prompt.trim() \|\| !provider` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/HomeAsk.jsx:100 | aria “Send” | disabled-no-reason `!canSend` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/HomeAsk.jsx:163 | “Start with an empty canvas” #home-empty-canvas | disabled-no-reason `!native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/HomeAsk.jsx:203 | “Start with an empty canvas” #home-askbar-empty | disabled-no-reason `!native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/Shelves.jsx:59 | “Open project…” #home-open-folder | disabled-no-reason `!native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/Shelves.jsx:106 | “Join” | disabled-no-reason `!canJoin \|\| busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/Shelves.jsx:159 | #{`home-shared-row-${r.projectId}-${r.canvasPath ?  | disabled-no-reason `!canOpen` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:972 | #{`home-pinned-row-${r.pid}-${r.slug}`} | disabled-no-reason `!data.native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:1041 | #{`home-recent-row-${r.pid}-${r.slug}`} | disabled-no-reason `!data.native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:1161 | “Open project…” #home-open-folder | disabled-no-reason `!data.native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:1386 | “Open” | disabled-no-reason `!canOpen` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:1406 | “Find the folder…” | disabled-no-reason `!canOpen` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/home/home-app.jsx:1417 | #{`home-project-row-${r.pid}`} | disabled-no-reason `!canOpen` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/inspector/css-knobs.jsx:1444 | “+ Auto layout (flex)” | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/inspector/css-knobs.jsx:1661 | “+ Auto layout (flex)” | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/inspector/grid-tracks-editor.jsx:36 | “+ Track” | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/inspector/grid-tracks-editor.jsx:82 | “×” | disabled-no-reason `!editable \|\| tracks.length <= 1` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/ElicitationPrompt.jsx:388 | “Submit” #chat-elicit-submit | disabled-no-reason `!canSubmit` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/ElicitationPrompt.jsx:398 | “Next” #chat-elicit-next | disabled-no-reason `!canAdvance` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/SettingsPanel.jsx:452 | (unnamed) | disabled-no-reason `!!(dl && !dl.error)` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/SettingsPanel.jsx:842 | (unnamed) | disabled-no-reason `!runtimeReady \|\| !!(dl && !dl.error)` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/SourceConflictPanel.jsx:216 | #source-conflict-keep-mine | disabled-no-reason `!sides \|\| !!busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/SourceConflictPanel.jsx:225 | #source-conflict-use-theirs | disabled-no-reason `!sides \|\| !!busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/panels/TeamProjects.jsx:542 | #team-hub-open | disabled-no-reason `!canHub \|\| !!busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/photo-knobs.jsx:593 | #photo-remove-bg | disabled-no-reason `bgBusy \|\| !onRemoveBackground` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/report-bug.jsx:493 | “Review &amp; attach” #report-bug-preview | disabled-no-reason `!canPreview` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ai/RawLog.jsx:30 | (unnamed) | disabled-no-reason `!log.total` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/annotations/templates-panel.jsx:223 | aria “Ask AI to build it” #templates-ask-send | disabled-no-reason `!canAsk \|\| !ask.trim()` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/annotations/vote-sheet.jsx:186 | #vote-sheet-start | disabled-no-reason `off \|\| busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/assets/generate-ask.jsx:361 | #generate-ask-go | disabled-no-reason `!quote \|\| !prompt.trim() \|\| making > 0` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/assets/takes-overlay.jsx:31 | aria “Previous take” #takes-prev | disabled-no-reason `!canStep` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/assets/takes-overlay.jsx:44 | aria “Next take” #takes-next | disabled-no-reason `!canStep` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/create/empty-project.jsx:54 | aria “Send” #empty-project-send | disabled-no-reason `busy \|\| !hasText` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/convert-dialog.jsx:106 | #ds-convert-go | disabled-no-reason `busy \|\| !model.canConvert` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/direction-bar.jsx:165 | #ds-dir-use | disabled-no-reason `!editable \|\| busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/library-card.jsx:366 | #ds-library-link-go | disabled-no-reason `busy \|\| !ready` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/make-sheet.jsx:250 | #ds-make-go | disabled-no-reason `!ready` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/outside-banner.jsx:140 | #ds-outside-keep | disabled-no-reason `busy \|\| held` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/switch-sheet.jsx:350 | #ds-switch-go | disabled-no-reason `busy \|\| n === 0 \|\| !!refused` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/upgrade-sheet.jsx:199 | #ds-upgrade-go | disabled-no-reason `busy \|\| !view.canAsk` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/ds/upgrade-sheet.jsx:210 | #ds-upgrade-go | disabled-no-reason `!canApply` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/handoff/handoff-sheet.jsx:436 | #export-submit | disabled-no-reason `!target \|\| !!target.off` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/git-advanced.jsx:379 | #vh-git-save | disabled-no-reason `!units.length \|\| !!busy` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/git-advanced.jsx:545 | #vh-compare-pictures | disabled-no-reason `!canvas \|\| !canView` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/git-parts.jsx:467 | (unnamed) | disabled-no-reason `!canSave` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/git-parts.jsx:612 | #switcher-merge-confirm | disabled-no-reason `!!folding` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/history-panel.jsx:471 | #vh-name | disabled-no-reason `!now.nameButton.enabled` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/history/name-dialog.jsx:92 | #vh-name-save | disabled-no-reason `busy \|\| !verdict.ok` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/import/brand-sheet.jsx:392 | “Import” #brand-import | disabled-no-reason `!logoFile && !wantsSite` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/import/figma-artboard.jsx:75 | #figma-make-editable | disabled-no-reason `state.busy \|\| ctx?.editable === false` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/import/figma-sheet.jsx:494 | #figma-import-run | disabled-no-reason `busy \|\| !boardCanvas` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/import/figma-sheet.jsx:504 | #figma-import-preview | disabled-no-reason `busy \|\| kind === 'none'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/artboard-print-advanced.jsx:185 | “Convert to absolute…” #insp-pr-layout-convert-btn | disabled-no-reason `ctx?.canEdit === false` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/frame.jsx:67 | “Convert layout to absolute” #insp-layout-convert | disabled-no-reason `ctx?.editable === false \|\| ctx?.canEdit === false` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/image.jsx:151 | “Replace…” #insp-image-replace | disabled-no-reason `!editable \|\| !ctx?.onReplaceMedia` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/image.jsx:212 | “Adjust…” #insp-image-adjust | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/image.jsx:223 | “Remove background” #insp-image-remove-bg | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/instance.jsx:243 | “Reset” #insp-instance-reset | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/instance.jsx:318 | “Detach” #insp-instance-detach | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/music.jsx:230 | #insp-music-half | disabled-no-reason `hd.half == null` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/music.jsx:239 | #insp-music-double | disabled-no-reason `hd.double == null` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/text.jsx:140 | aria “Text style” #insp-style | disabled-no-reason `!editable \|\| (roles.length === 0 && !name)` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/text.jsx:194 | “Reset” #insp-style-reset | disabled-no-reason `!editable` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/kinds/text.jsx:228 | “Use a style” #insp-style-use | disabled-no-reason `!editable \|\| roles.length === 0` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/inspector/sections/warnings.jsx:75 | #{`insp-warning-fix-${w.code}`} | disabled-no-reason `busy === w.id` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/onboarding/AdvSheet.jsx:102 | #{`onb-${id}-go`} | disabled-no-reason `!canSubmit \|\| busy \|\| !onSubmit` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/onboarding/FolderGithubSheet.jsx:49 | #onb-folder-tab-github | disabled-no-reason `github ? undefined : 'true'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/onboarding/GithubSegment.jsx:125 | #onb-github-signin | disabled-no-reason `list.phase === 'signing-in'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/onboarding/HubSheet.jsx:174 | #onb-hub-mode-invite | disabled-no-reason `onJoin ? undefined : 'true'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/photo/apply-every-use-sheet.jsx:180 | #photo-every-use-apply | disabled-no-reason `busy \|\| !!refused \|\| done` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/photo/photo-section.jsx:519 | #photo-ai-remove-bg | disabled-no-reason `bgBusy \|\| !onRemoveBackground` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/photo/photo-section.jsx:544 | #photo-replace | disabled-no-reason `!onReplaceMedia` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/photo/photo-section.jsx:579 | #photo-every-use-open | disabled-no-reason `!everyUse` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/present/order-notes-sheet.jsx:202 | #{`present-order-skip-${r.id}`} | disabled-no-reason `!r.storable \|\| phase === 'saving'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/present/presenter-view.jsx:148 | “Skip” #presenter-clip-skip | disabled-no-reason `!canStep(position, 'next')` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/present/presenter-view.jsx:161 | “Previous” #presenter-prev | disabled-no-reason `!canStep(position, 'prev')` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/present/presenter-view.jsx:173 | “Next” #presenter-next | disabled-no-reason `!canStep(position, 'next')` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/share/invite-row.jsx:58 | “Invite” #share-invite-submit | disabled-no-reason `!ready` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/shell/mode-switch.jsx:244 | aria “Present options” #mode-present-menu | disabled-no-reason `!canPresent` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/shell/mode-switch.jsx:292 | #{row.testid} | disabled-no-reason `presenterView ? undefined : 'true'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/shell/mode-switch.jsx:316 | #{row.testid} | disabled-no-reason `copyLink?.enabled ? undefined : 'true'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/CreateLocalSheet.jsx:96 | “Choose another folder…” #home-create-choose-folder | disabled-no-reason `!onChooseFolder` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/SignInCard.jsx:84 | #signin-cloud | disabled-no-reason `offline \|\| !native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/SignInCard.jsx:96 | #signin-local | disabled-no-reason `!native` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/SignInCard.jsx:132 | #signin-reopen | disabled-no-reason `!userCode` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/SignInCard.jsx:193 | #signin-use-code | disabled-no-reason `!userCode \|\| showCode` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/signin/SignInCard.jsx:230 | #{`signin-adv-${r.id}`} | disabled-no-reason `live ? undefined : 'true'` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/sync-states/conflict-card.jsx:129 | #{testid} | disabled-no-reason `busy \|\| !canEdit` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/sync-states/conflict-card.jsx:199 | “Restore” | disabled-no-reason `busy \|\| !canEdit` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/timeline/advanced/cut-as-code.jsx:113 | #timeline-open-in-code | disabled-no-reason `!canvas \|\| !canRead` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/timeline/advanced/render-settings.jsx:45 | #{`timeline-add-track-${id}`} | disabled-no-reason `there` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/timeline/joins/transition-picker.jsx:187 | #{`timeline-transition-${key}`} | disabled-no-reason `!canEdit` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/timeline/other-takes.jsx:129 | #other-takes-take | disabled-no-reason `busy \|\| !canEdit \|\| t.current` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/timeline/reframe-island.jsx:327 | “Reset” #reframe-reset | disabled-no-reason `!canEdit \|\| !framed` | open — ratcheted, needs a reason line (copy) |
| apps/studio/client/v2/undo/undo-history.jsx:136 | #{`undo-history-row-${i}`} | disabled-no-reason `off ? 'true' : undefined` | open — ratcheted, needs a reason line (copy) |
