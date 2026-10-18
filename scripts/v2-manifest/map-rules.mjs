// The data half of the nothing-deleted mapper (Phase 4 gate, contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md). The engine is map-entries.mjs.
//
// A v1-manifest entry resolves to ONE target:
//   <row id>           a §A row (06 Advanced ITEMS) or a §B row (G0-D D1–D20) of nothing-deleted.json
//   action:<id>        a registry action (actions/index.ts) — kept, reachable through ⌘K / the menu
//   testid:<hook>      a testids.json hook re-emitted on the v2 element (plan rule 5) — kept in place
// Targets are checked by the engine: a row id must exist, an action id must be registered, a hook
// must be in testids.json. Precedence (first wins): HAND → continuation of a renamed v1 entry →
// historical/stable testid → registry label (menu, palette, native menu) → RULES → unmapped.

/** Late entries (in code, not in the frozen manifest) that are v2 code, not v1 features. */
export const V2_CODE_PATHS = [
  /\/client\/v2\//,
  /\/client\/home\//, // Home window (V2-1.1 / V2-3.x)
  /\/client\/panels\/chat-header\.jsx$/, // AI chat header (V2-4.4b)
  /\/toolbars\//, // in-canvas toolbars (V2-4.5)
  /(^|\/)apps\/studio\/editing\//, // the S2 editing layer (S2.1 mount)
];
/** Late entries in a shared v1 file that are v2 features (named one by one, never by file). */
export const V2_CODE_IDS = new Set([
  'button:studio/client/shell/banners.jsx#FormatGateBanner/format-gate-update', // V2-1.12 file formats
  'keydown:studio/client/hooks/use-action-keys.jsx#useActionKeys/listener', // V2-2.4 registry keys
]);

/** Entries that are infrastructure, not features (lead decision, V2-4.gate-b): id → reason. Excluded
 *  by name, never by pattern — a new entry of the same shape stays an open gap until someone signs it. */
const NO_BROWSER_MENU = "infrastructure: suppresses the browser's own context menu; not a feature";
export const INFRA_IDS = Object.freeze({
  'contextmenu:studio/client/app.jsx#App/div': NO_BROWSER_MENU,
  'contextmenu:studio/client/app.jsx#ShellTree/div': NO_BROWSER_MENU, // the same handler, renamed
});

/** Menu / palette / native-menu files whose rows are matched to registry actions by label. */
export const LABEL_FILES = [
  /client\/menus\/menubar\.jsx$/,
  /client\/hooks\/use-palette-and-panels\.jsx$/,
  /src-tauri\/src\/menu\.rs$/,
];

/** Exact entry id → target. Used where a label is ambiguous inside one component. */
export const HAND = {
  'button:studio/client/app.jsx#App/reload': 'A-repo-state-changed-reload',
  'button:studio/client/app.jsx#App/dismiss': 'A-repo-state-changed-reload',
  'button:studio/client/app.jsx#App/dismiss~2': 'D13', // usage-tour nudge
  'button:studio/client/app.jsx#App/dismiss~3': 'D13', // collab-tour nudge
  'button:studio/client/app.jsx#App/start': 'D13',
  'button:studio/client/app.jsx#App/start~2': 'D13',
  'button:studio/client/app.jsx#App/exit-presentation-mode': 'action:present.canvas',
  // the shell prompt dialog is the timeline's text prompt (use-photo-and-timeline shellPromptState)
  'button:studio/client/app.jsx#App/cancel': 'D15',
  'button:studio/client/app.jsx#App/shell-prompt-ok': 'D15',
  'keydown:studio/client/app.jsx#App/shell-prompt-input': 'D15',
  // `contextmenu:studio/client/app.jsx#App/div` is left open on purpose: it suppresses the browser's
  // own menu over the chrome — infrastructure, no feature (gap list in the contract note).
  'item:studio/client/hooks/use-palette-and-panels.jsx#usePaletteAndPanels.paletteActions/toggle-light-dark-theme':
    'D17',
  'item:studio/client/hooks/use-palette-and-panels.jsx#usePaletteAndPanels.paletteActions/new-video':
    'D17',
  'item:studio/client/menus/menubar.jsx#Menubar.panels/project-tree': 'D4',
  // S1.2 — the row's Delete is now the row menu's Move to trash (registry canvas.trash, its 8
  // reachability rows); the v1 aria-label is gone from the tree.
  'testid:studio/client/app.jsx#sidebar/tree/aria-label-delete-canvas-name': 'action:canvas.trash',
};

const r = (file, m, to) => ({ file, ...m, to });
const ANY = {};

/**
 * Ordered rules: the first whose every present field matches wins.
 *   file  regex on the repo path      s  regex on the scope (component[.var] or testid region)
 *   k     regex on the id's key       l  regex on the label        t  regex on the testid/hook
 *   kind  regex on the entry kind
 */
export const RULES = [
  // ── shell regions (testid entries carry their region as scope) ──────────────────────────
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^assistant-toggle$/ }, 'action:ai.chat'),
  r(
    /client\/app\.jsx$/,
    { s: /^menubar$/, t: /^(brand|cloud-project-name|\.st-mb-proj)$/ },
    'testid:project-pill'
  ),
  r(
    /client\/app\.jsx$/,
    { s: /^menubar$/, t: /cloud-account|cloud-signout|cloudwho/ },
    'A-cloud-account-email-and-sign-out'
  ),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^cloud-back$/ }, 'A-browser-dashboard-link'),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^report-bug-toggle$/ }, 'A-report-a-bug-icon'),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^share-btn$/ }, 'action:share.open'),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^whatsnew$/ }, 'A-what-s-new-megaphone'),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^status$/ }, 'testid:share-cluster'),
  r(/client\/app\.jsx$/, { s: /^menubar$/, t: /^view-only-stamp$/ }, 'testid:share-cluster-status'),
  r(/client\/app\.jsx$/, { s: /^menubar$/ }, 'A-six-menus-file-edit-view-selection-tools-help'),
  r(
    /client\/app\.jsx$/,
    { s: /^status bar$/, t: /selection|Selected element|st-sb-sel/ },
    'A-selected-element-s-selector'
  ),
  r(/client\/app\.jsx$/, { s: /^status bar$/, t: /theme/ }, 'A-light-dark-toggle'),
  r(/client\/app\.jsx$/, { s: /^status bar$/, t: /^open-changes$/ }, 'A-changes-chip-n-unsaved'),
  r(/client\/app\.jsx$/, { s: /^status bar$/, t: /sync/ }, 'A-hub-sync-chip'),
  r(/client\/app\.jsx$/, { s: /^status bar$/ }, 'A-app-version'),
  r(/client\/app\.jsx$/, { s: /^banners$/ }, 'D12'),
  r(/client\/app\.jsx$/, { s: /^comments panel$/ }, 'D8'),
  r(/client\/app\.jsx$/, { s: /^export dialog$/, t: /pdf/ }, 'A-pdf-quality-and-text-outlines'),
  r(/client\/app\.jsx$/, { s: /^export dialog$/, t: /long-comp/ }, 'A-long-comp-badge'),
  r(/client\/app\.jsx$/, { s: /^export dialog$/ }, 'D3'),
  r(
    /client\/app\.jsx$/,
    { s: /^inspector$/, t: /^cp-mode$/ },
    'A-inspector-vocabulary-advanced-designer'
  ),
  r(/client\/app\.jsx$/, { s: /^inspector$/, t: /^css-panel$/ }, 'A-css-tab-raw-properties'),
  r(/client\/app\.jsx$/, { s: /^inspector$/, t: /^inspector-section-/ }, 'D18'),
  r(/client\/app\.jsx$/, { s: /^inspector$/, t: /^layers-panel$/ }, 'A-layers-as-a-separate-panel'),
  r(/client\/app\.jsx$/, { s: /^inspector$/, t: /idtag/ }, 'A-tag-and-class'),
  r(/client\/app\.jsx$/, { s: /^inspector$/, t: /st-scope/ }, 'A-edit-scope-local-shared-detach'),
  r(/client\/app\.jsx$/, { s: /^inspector$/ }, 'action:view.inspector'),
  r(
    /client\/app\.jsx$/,
    { s: /^other$/, t: /dock-?tab|st-docktab/ },
    'A-dock-resize-grips-and-tab-strips'
  ),
  r(/client\/app\.jsx$/, { s: /^sidebar\/tree$/ }, 'D5'),
  r(/client\/app\.jsx$/, { s: /^viewport$/, t: /quick-setup/ }, 'D13'),
  r(/client\/app\.jsx$/, { s: /^viewport$/ }, 'testid:canvas-frame'),
  r(/client\/app\.jsx$/, { s: /palette/ }, 'action:search.open'),

  // ── canvas iframe ─────────────────────────────────────────────────────────────────────
  r(/annotations-layer\.tsx$/, ANY, 'D2'),
  r(/canvas-shell\.tsx$/, { s: /^MultiArtboardToolbar$/ }, 'D7'),
  r(/canvas-shell\.tsx|context-menu\.tsx$/, { l: /^Copy CSS$/ }, 'A-copy-css'),
  r(/canvas-shell\.tsx|context-menu\.tsx$/, { l: /^Copy data-cd-id$/ }, 'A-copy-data-cd-id'),
  r(
    /canvas-shell\.tsx|context-menu\.tsx$/,
    { l: /^(Copy|Paste) style$/ },
    'A-copy-style-paste-style'
  ),
  r(/canvas-shell\.tsx$/, { l: /^Convert / }, 'A-convert-layout-to-absolute'),
  r(
    /canvas-shell\.tsx|context-menu\.tsx$/,
    { l: /^(Fit just this artboard|Reset position)$/ },
    'A-reset-position-fit-just-this-artboard'
  ),
  r(/canvas-shell\.tsx$/, { s: /themeItem/ }, 'A-artboard-theme-ds-default-follow-chrome'),
  r(/canvas-shell\.tsx$/, { kind: /^item$/ }, 'D6'),
  r(/canvas-shell\.tsx$/, { kind: /^keydown$/ }, 'testid:toolbar-<mode>'),
  r(/canvas-shell\.tsx$/, { t: /data-active-tool/ }, 'testid:toolbar-slot-<toolId>'),
  r(/context-menu\.tsx$/, ANY, 'D6'),
  r(/comments-overlay\.tsx$/, { l: /Reopen|^Delete$/ }, 'D8'),
  r(/comments-overlay\.tsx$/, ANY, 'testid:.cm-layer / .cm-pin / [data-comment-pin]'),
  r(/participants-chrome\.tsx$/, ANY, 'testid:share-cluster-faces'),
  r(/tool-palette\.tsx$/, { l: /^Export/ }, 'D3'),
  r(/tool-palette\.tsx$/, { k: /edit-mode|palette-mode-edit/ }, 'testid:palette-mode-edit'),
  r(
    /tool-palette\.tsx$/,
    { k: /preview-mode|palette-mode-preview/ },
    'testid:palette-mode-preview'
  ),
  r(
    /tool-palette\.tsx$/,
    { k: /presentation-mode|palette-mode-present/ },
    'testid:palette-mode-present'
  ),
  r(/tool-palette\.tsx$/, { s: /renderShapeButton/ }, 'action:tool.shape'),
  r(/tool-palette\.tsx$/, ANY, 'testid:toolbar-slot-<toolId>'),

  // ── dialogs ───────────────────────────────────────────────────────────────────────────
  r(/dialogs\/asset-picker\.jsx$/, ANY, 'A-asset-picker-upload-thumbnails-insert'),
  r(/dialogs\/command-palette\.jsx$/, ANY, 'action:search.open'),
  r(
    /dialogs\/export-dialog\.jsx$/,
    { l: /^(Canva|HTML|PPTX)$/ },
    'A-html-powerpoint-canva-formats'
  ),
  r(/dialogs\/export-dialog\.jsx$/, { l: /^AI handoff$/ }, 'A-ai-handoff-copies-design-handoff'),
  r(/dialogs\/export-dialog\.jsx$/, { l: /^ZIP$/ }, 'A-export-project-zip-canvas-as-separate'),
  r(/dialogs\/export-dialog\.jsx$/, { s: /^PNG_RESOLUTIONS$/ }, 'A-png-at-150-300-600-dpi'),
  r(/dialogs\/export-dialog\.jsx$/, { s: /^PDF_/ }, 'A-pdf-quality-and-text-outlines'),
  r(/dialogs\/export-dialog\.jsx$/, { l: /^Marks$/ }, 'A-crop-and-registration-marks'),
  r(/dialogs\/export-dialog\.jsx$/, { l: /^Export again$/ }, 'action:export.rerun-last'),
  r(/dialogs\/export-dialog\.jsx$/, ANY, 'action:export.open'),
  r(/dialogs\/help-modal\.jsx$/, { l: /tour/ }, 'action:help.tour'),
  r(/dialogs\/help-modal\.jsx$/, ANY, 'action:help.guides'),
  r(/dialogs\/shortcuts-overlay\.jsx$/, ANY, 'action:help.shortcuts'),
  r(/client\/export-center\.jsx$/, ANY, 'A-export-jobs-badge'),
  r(/client\/generate-dialog\.jsx$/, ANY, 'A-generate-with-ai-provider-model-aspect'),
  r(/client\/report-bug\.jsx$/, ANY, 'D13'),
  r(/client\/share-dialog\.jsx$/, { t: /local/ }, 'A-local-link-this-mac-only'),
  r(/client\/share-dialog\.jsx$/, { t: /open-app/ }, 'A-open-in-maude-app-link'),
  r(/client\/share-dialog\.jsx$/, ANY, 'action:share.open'),
  r(/client\/whats-new\.jsx$/, ANY, 'A-what-s-new-megaphone'),
  r(/client\/tour\/overlay\.jsx$/, ANY, 'D13'),
  r(/client\/embed-view\.jsx$/, ANY, 'testid:embed-view'),

  // ── inspector ─────────────────────────────────────────────────────────────────────────
  r(
    /inspector\/css-knobs\.jsx$/,
    { l: /^(Advanced|Designer) — / },
    'A-inspector-vocabulary-advanced-designer'
  ),
  r(/inspector\/css-knobs\.jsx$/, { s: /^AttrKnob$/ }, 'A-html-attribute-rows'),
  r(/inspector\/css-knobs\.jsx$/, { s: /^RawKnob$/ }, 'A-custom-css-property-rows'),
  r(/inspector\/css-knobs\.jsx$/, ANY, 'D18'),
  r(/inspector\/grid-tracks-editor\.jsx$/, ANY, 'A-grid-tracks-editor'),
  r(/inspector\/inspector-panel\.jsx$/, { l: /^Detach$/ }, 'A-edit-scope-local-shared-detach'),
  r(
    /inspector\/(inspector-panel|color-picker|artboard-knobs)\.jsx$|inspector-controls\.jsx$/,
    ANY,
    'action:view.inspector'
  ),
  r(/inspector\/layers\.jsx$/, ANY, 'action:view.layers'),
  r(/inspector\/token-popover\.jsx$/, ANY, 'A-token-popover-per-design-system'),
  r(/client\/photo-knobs\.jsx$/, ANY, 'D16'),

  // ── panels ────────────────────────────────────────────────────────────────────────────
  r(
    /panels\/BrandUploadPanel\.jsx$/,
    { t: /copy-command/, l: /Copy command/ },
    'A-brand-upload-copy-command'
  ),
  r(/panels\/BrandUploadPanel\.jsx$/, { k: /copy-command/ }, 'A-brand-upload-copy-command'),
  r(/panels\/BrandUploadPanel\.jsx$/, ANY, 'action:import.brand'),
  r(/panels\/CapabilityBar\.jsx$/, { t: /mode-picker/ }, 'A-permission-mode'),
  r(/panels\/CapabilityBar\.jsx$/, ANY, 'A-model-effort-fast-mode'),
  r(/panels\/ChatPanel\.jsx$/, { t: /^chat-cmd-/ }, 'A-slash-command-quick-actions'),
  r(/panels\/ChatPanel\.jsx$/, { t: /^chat-tool-row$/ }, 'A-tool-call-cards-in-the-feed'),
  r(
    /panels\/ChatPanel\.jsx$/,
    { t: /^chat-transcript-menu$/ },
    'A-transcript-view-thinking-verbose'
  ),
  r(/panels\/ChatPanel\.jsx$/, { s: /^ChatFootInfo$/ }, 'A-context-and-token-counts'),
  r(/panels\/ChatPanel\.jsx$/, { t: /^chat-foot-/ }, 'A-context-and-token-counts'),
  r(/panels\/ChatPanel\.jsx$/, { s: /^(ModeBanner|RateLimitBanner|ErrorCard)$/ }, 'D9'),
  r(
    /panels\/ChatPanel\.jsx$/,
    { l: /^(Archive|Delete|Rename|Copy transcript|More options)$/ },
    'D9'
  ),
  r(
    /panels\/ChatPanel\.jsx$/,
    { t: /mode-banner|usage-banner|error-card|chat-qa-|overflow-menu|msg-actions/ },
    'D9'
  ),
  r(/panels\/ChatPanel\.jsx$/, ANY, 'action:ai.chat'),
  r(/panels\/(ElicitationPrompt|PermissionPrompt)\.jsx$/, ANY, 'D9'),
  r(/panels\/ToolGroup\.jsx$/, ANY, 'A-tool-call-cards-in-the-feed'),
  r(/panels\/ClipInspector\.jsx$/, ANY, 'D15'),
  r(/panels\/TimelinePanel\.jsx$/, { t: /^timeline-readout$/ }, 'A-frame-readout'),
  r(/panels\/TimelinePanel\.jsx$/, { t: /^timeline-long-badge$/ }, 'A-long-comp-badge'),
  r(/panels\/TimelinePanel\.jsx$/, { t: /^timeline-kf-/ }, 'A-keyframe-markers'),
  r(/panels\/TimelinePanel\.jsx$/, ANY, 'D15'),
  r(
    /panels\/CloudBar\.jsx$/,
    { t: /^settings-hub-address$/ },
    'A-team-hub-address-and-access-token'
  ),
  r(/panels\/CloudBar\.jsx$/, { l: /^Open the dashboard$/ }, 'A-open-the-cloud-dashboard'),
  r(
    /panels\/CloudBar\.jsx$/,
    { t: /^(cloud-account|cloud-sign-out|cloud-host)$/ },
    'A-cloud-account-email-and-sign-out'
  ),
  r(
    /panels\/CloudBar\.jsx$/,
    { s: /^CloudBar$/, l: /^Sign out$/ },
    'A-cloud-account-email-and-sign-out'
  ),
  r(/panels\/CloudBar\.jsx$/, ANY, 'D11'),
  r(/panels\/file-deep-link-dialog\.jsx$/, ANY, 'D11'),
  r(/panels\/file-preview\.jsx$/, ANY, 'A-preview-of-non-canvas-files-md-fonts-audio'),
  r(/panels\/CollabModelInfographic\.jsx$/, ANY, 'action:help.sharing'),
  r(/panels\/CreateProject\.jsx$/, { s: /^GetView$/ }, 'A-pull-a-local-copy'),
  r(/panels\/CreateProject\.jsx$/, { s: /^ShareView$/ }, 'action:share.open'),
  r(/panels\/CreateProject\.jsx$/, ANY, 'A-new-github-project-visibility-description'),
  r(/panels\/DiffView\.jsx$/, ANY, 'D10'),
  r(/panels\/FigmaImportPanel\.jsx$/, ANY, 'action:import.figma'),
  r(/panels\/GitPanel\.jsx$/, { t: /publish/, l: /Publish/ }, 'A-publish-changes'),
  r(/panels\/GitPanel\.jsx$/, { t: /publish/ }, 'A-publish-changes'),
  r(/panels\/GitPanel\.jsx$/, { t: /get-latest|^pull$/ }, 'A-get-latest'),
  r(/panels\/GitPanel\.jsx$/, { l: /^Get latest$/ }, 'A-get-latest'),
  r(
    /panels\/GitPanel\.jsx$/,
    { t: /commit-message|^save-local$/ },
    'A-save-version-with-a-message'
  ),
  r(/panels\/GitPanel\.jsx$/, { l: /^Save version$/ }, 'A-save-version-with-a-message'),
  r(/panels\/GitPanel\.jsx$/, { l: /^Discard changes/ }, 'A-discard-a-file-s-changes'),
  r(/panels\/GitPanel\.jsx$/, ANY, 'D10'),
  r(/panels\/IdentityBar\.jsx$/, { l: /^Pull a local copy$/ }, 'A-pull-a-local-copy'),
  r(/panels\/IdentityBar\.jsx$/, { l: /^Share this project$/ }, 'action:share.open'),
  r(/panels\/IdentityBar\.jsx$/, { l: /^New project$/ }, 'action:project.new'),
  r(/panels\/IdentityBar\.jsx$/, { l: /^@$/ }, 'A-invite-by-github-username'),
  r(/panels\/IdentityBar\.jsx$/, ANY, 'A-sign-in-with-github'),
  r(/panels\/IntroVideoDialog\.jsx$/, ANY, 'action:help.intro'),
  r(/panels\/OnboardingWizard\.jsx$/, { t: /intro/, l: /intro/ }, 'action:help.intro'),
  r(/panels\/OnboardingWizard\.jsx$/, { k: /intro/ }, 'action:help.intro'),
  r(/panels\/OnboardingWizard\.jsx$/, { t: /ob-door-local|ob-local-/ }, 'action:project.open'),
  r(/panels\/OnboardingWizard\.jsx$/, { s: /^LocalDoor$/ }, 'action:project.open'),
  r(/panels\/OnboardingWizard\.jsx$/, { t: /ob-github-create/ }, 'action:project.new'),
  r(
    /panels\/OnboardingWizard\.jsx$/,
    { s: /^(GitHubDoor|CreateInline)$/ },
    'A-new-github-project-visibility-description'
  ),
  r(
    /panels\/OnboardingWizard\.jsx$/,
    { t: /ob-door-hub/ },
    'A-your-team-s-own-server-email-password'
  ),
  r(
    /panels\/OnboardingWizard\.jsx$/,
    { s: /^HubDoor$/ },
    'A-your-team-s-own-server-email-password'
  ),
  r(
    /panels\/OnboardingWizard\.jsx$/,
    { t: /ob-door-team/ },
    'A-open-another-folder-or-team-project'
  ),
  r(/panels\/OnboardingWizard\.jsx$/, { t: /ob-door-github|ob-device/ }, 'A-sign-in-with-github'),
  r(
    /panels\/OnboardingWizard\.jsx$/,
    { s: /^(DeviceCodeModal|Welcome)$/ },
    'A-sign-in-with-github'
  ),
  r(/panels\/OnboardingWizard\.jsx$/, ANY, 'D13'), // the first-run surface itself → Home first-run line
  r(
    /panels\/ReadinessList\.jsx$/,
    { s: /^InstallCommand$/ },
    'A-install-claude-code-automatically'
  ),
  r(
    /panels\/ReadinessList\.jsx$/,
    { t: /^acp-setup-install$/ },
    'A-install-claude-code-automatically'
  ),
  r(/panels\/ReadinessList\.jsx$/, ANY, 'A-readiness-list-claude-code'),
  r(
    /panels\/RepoBranchSwitcher\.jsx$/,
    { t: /open-team/, l: /Open another folder|team project/ },
    'A-open-another-folder-or-team-project'
  ),
  r(
    /panels\/RepoBranchSwitcher\.jsx$/,
    { l: /Open another folder|Open a team project/ },
    'A-open-another-folder-or-team-project'
  ),
  r(
    /panels\/RepoBranchSwitcher\.jsx$/,
    { t: /open-team/ },
    'A-open-another-folder-or-team-project'
  ),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /fetch/ }, 'A-fetch-remote-branches'),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /merge|switcher-pr-/ }, 'A-add-to-shared-opens-a-pr'),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /new-branch/ }, 'A-branch-names-and-new-branch'),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /get-latest/ }, 'A-get-latest'),
  r(
    /panels\/RepoBranchSwitcher\.jsx$/,
    { t: /resume/, l: /^Continue on/ },
    'A-continue-on-draft-chip'
  ),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { l: /^Continue on/ }, 'A-continue-on-draft-chip'),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /resume/ }, 'A-continue-on-draft-chip'),
  r(/panels\/RepoBranchSwitcher\.jsx$/, { t: /chat-guard/ }, 'D10'),
  r(
    /panels\/RepoBranchSwitcher\.jsx$/,
    { s: /\.project/ },
    'A-open-another-folder-or-team-project'
  ),
  r(/panels\/RepoBranchSwitcher\.jsx$/, ANY, 'A-branch-switcher'),
  r(/panels\/SettingsPanel\.jsx$/, { t: /^figma-test$/, l: /^Test connection$/ }, 'D14'),
  r(/panels\/SettingsPanel\.jsx$/, { k: /test-connection|figma-test/ }, 'D14'),
  r(/panels\/SettingsPanel\.jsx$/, { t: /^figma-test$/ }, 'D14'),
  r(
    /panels\/SettingsPanel\.jsx$/,
    { s: /^FigmaConnectCard$|^settings$/, t: /figma/ },
    'A-figma-token'
  ),
  r(/panels\/SettingsPanel\.jsx$/, { s: /^FigmaConnectCard$/ }, 'A-figma-token'),
  r(/panels\/SettingsPanel\.jsx$/, { s: /KEYFRAME|Gemma/ }, 'A-keyframe-engine-and-gemma-model'),
  r(/panels\/SettingsPanel\.jsx$/, { t: /keyframe/ }, 'A-keyframe-engine-and-gemma-model'),
  r(
    /panels\/SettingsPanel\.jsx$/,
    { s: /TRANSCRIPTION|Whisper/ },
    'A-transcription-engine-and-whisper-model'
  ),
  r(
    /panels\/SettingsPanel\.jsx$/,
    { t: /transcription/ },
    'A-transcription-engine-and-whisper-model'
  ),
  r(/panels\/SettingsPanel\.jsx$/, { s: /^ProviderCard$/ }, 'A-ai-provider-keys'),
  r(
    /panels\/SettingsPanel\.jsx$/,
    { s: /^CP_MODE_OPTIONS$/ },
    'A-inspector-vocabulary-advanced-designer'
  ),
  r(/panels\/SettingsPanel\.jsx$/, { t: /vocabulary/ }, 'A-inspector-vocabulary-advanced-designer'),
  r(/panels\/SettingsPanel\.jsx$/, { s: /^LAYERS_MODE_OPTIONS$/ }, 'A-layers-as-a-separate-panel'),
  r(
    /panels\/SettingsPanel\.jsx$/,
    { s: /^(LAYOUT_PANELS|SideToggle)$/ },
    'A-panel-positions-left-right'
  ),
  r(/panels\/SettingsPanel\.jsx$/, { t: /^panel-side-/ }, 'A-panel-positions-left-right'),
  r(/panels\/SettingsPanel\.jsx$/, { s: /^THEME_OPTIONS$/ }, 'A-light-dark-toggle'),
  r(/panels\/SettingsPanel\.jsx$/, { t: /^settings-theme$/ }, 'A-light-dark-toggle'),
  r(/panels\/SettingsPanel\.jsx$/, ANY, 'action:settings.open'),
  r(/panels\/SetupChecklist\.jsx$/, ANY, 'D13'),
  r(/panels\/SourceConflictPanel\.jsx$/, ANY, 'A-conflict-keep-mine-use-theirs-keep-both'),
  r(/panels\/StickerPicker\.jsx$/, ANY, 'testid:toolbar-slot-<toolId>'),
  r(/panels\/SyncConsentDialog\.jsx$/, ANY, 'D12'),
  r(/panels\/SyncPanel\.jsx$/, { t: /sync-ai-|ai-held/ }, 'A-unfinished-ai-edit-publish-discard'),
  r(/panels\/SyncPanel\.jsx$/, { t: /sync-assets/ }, 'A-asset-transfers-with-cancel'),
  r(/panels\/SyncPanel\.jsx$/, { t: /sync-notice|delivery-attention|delivery-fine/ }, 'D12'),
  r(/panels\/SyncPanel\.jsx$/, { t: /^sync-offline$/ }, 'A-download-all'),
  r(/panels\/SyncPanel\.jsx$/, { t: /sync-ownership/ }, 'A-hand-design-to-the-workspace'),
  r(
    /panels\/SyncPanel\.jsx$/,
    { t: /sync-resolve|conflicts/ },
    'A-conflict-keep-mine-use-theirs-keep-both'
  ),
  r(/panels\/SyncPanel\.jsx$/, { t: /^sync-resync$/ }, 'A-resync'),
  r(/panels\/SyncPanel\.jsx$/, { t: /signin-again/ }, 'A-sign-in-again-when-sync-stops'),
  r(/panels\/SyncPanel\.jsx$/, { t: /sync-trash/ }, 'A-trash-clear-out-old-files'),
  r(/panels\/SyncPanel\.jsx$/, { t: /firstAnchor/ }, 'A-first-link-conflicts-rule'),
  r(
    /panels\/SyncPanel\.jsx$/,
    { t: /syncFiles|propagateDeletes|sync-settings/ },
    'A-sync-project-files-propagate-deletions'
  ),
  r(
    /panels\/SyncPanel\.jsx$/,
    { kind: /^button$/, l: /^Cancel$/ },
    'A-asset-transfers-with-cancel'
  ),
  r(/panels\/SyncPanel\.jsx$/, ANY, 'A-held-rate-limited-failed-lists'),
  r(/panels\/TeamProjects\.jsx$/, { t: /team-hub-/ }, 'A-your-team-s-own-server-email-password'),
  r(/panels\/TeamProjects\.jsx$/, ANY, 'A-open-another-folder-or-team-project'),

  // ── shell chrome ──────────────────────────────────────────────────────────────────────
  r(/shell\/banners\.jsx$/, { s: /^UpdateBanner$/ }, 'A-update-banner-restart-now-later'),
  r(/shell\/banners\.jsx$/, ANY, 'D12'),
  r(/shell\/collapsed-rail\.jsx$/, { l: /^Search$/ }, 'action:canvases.search'),
  r(/shell\/collapsed-rail\.jsx$/, ANY, 'D4'),
  r(/shell\/comments-panel\.jsx$/, { l: /^(All|Reopen|Delete)/ }, 'D8'),
  r(/shell\/comments-panel\.jsx$/, ANY, 'action:view.comments'),
  r(/shell\/dock\.jsx$/, ANY, 'A-dock-resize-grips-and-tab-strips'),
  r(/shell\/status-bar\.jsx$/, { l: /selection/ }, 'A-selected-element-s-selector'),
  r(/shell\/status-bar\.jsx$/, { l: /Changes/ }, 'A-changes-chip-n-unsaved'),
  r(/shell\/status-bar\.jsx$/, { l: /Sync/ }, 'A-hub-sync-chip'),
  r(/shell\/status-bar\.jsx$/, { l: /theme/ }, 'A-light-dark-toggle'),
  r(/shell\/viewport\.jsx$/, { l: /^Reload canvas$/ }, 'A-reload-canvas-r'),
  r(/shell\/viewport\.jsx$/, ANY, 'D13'),
  r(/shell\/util\.js$/, ANY, 'D12'), // the first-run mode-hint toast
  r(/client\/tree-row-menu\.jsx$|client\/file-tree\.jsx$/, ANY, 'D5'),
  r(/client\/tree\/tree\.jsx$/, { l: /^Refresh files$/ }, 'A-refresh-tree-r'),
  r(
    /client\/tree\/tree\.jsx$/,
    { l: /^exp fig$/ },
    'A-imported-from-figma-and-experimental-badges'
  ),
  r(/client\/tree\/tree\.jsx$/, { s: /^DsFolderRow$/ }, 'A-design-system-view-s-key-picker'),
  r(/client\/tree\/tree\.jsx$/, { t: /canvases-ds-files/ }, 'A-raw-system-folder-and-maude-dsn-01'),
  r(/client\/tree\/tree\.jsx$/, { l: /^(Collapse sidebar)$/ }, 'D4'),
  // S6.1: ⌘N / New canvas is a blank canvas now; the tree's brief-board composer is its own action.
  r(/client\/tree\/tree\.jsx$/, { l: /^New blank brief board$/ }, 'action:canvas.new-brief'),
  r(/client\/tree\/tree\.jsx$/, { l: /^Share…$/ }, 'action:share.open'),
  r(/client\/tree\/tree\.jsx$/, { l: /^Rename…$/ }, 'action:canvas.rename'),
  r(/client\/tree\/tree\.jsx$/, { l: /^Duplicate$/ }, 'action:canvas.duplicate'),
  r(/client\/tree\/tree\.jsx$/, { l: /^Move to…$/ }, 'action:canvas.move'),
  r(/client\/tree\/tree\.jsx$/, { t: /^canvas-search$/ }, 'action:canvases.search'),
  r(/client\/tree\/tree\.jsx$/, ANY, 'D5'),
  r(/hooks\/use-canvas-bridge\.jsx$/, ANY, 'action:object.nudge'),
  r(/hooks\/use-(keyboard-shortcuts|photo-and-timeline)\.jsx$/, ANY, 'action:help.shortcuts'),
  r(/hooks\/use-palette-and-panels\.jsx$/, { l: /^Refresh tree$/ }, 'A-refresh-tree-r'),
  r(/hooks\/use-palette-and-panels\.jsx$/, { l: /^Trash$/ }, 'action:view.trash'),
  r(/client\/menus\/menubar\.jsx$/, { t: /report-bug/ }, 'A-report-a-bug-icon'),
  r(/client\/menus\/menubar\.jsx$/, { l: /^What's new/ }, 'A-what-s-new-megaphone'),
  r(/client\/menus\/menubar\.jsx$/, { t: /share-btn/ }, 'action:share.open'),
  r(/client\/menus\/menubar\.jsx$/, { t: /assistant-toggle/ }, 'action:ai.chat'),
  r(/client\/menus\/menubar\.jsx$/, { l: /^Assistant/ }, 'action:ai.chat'),
  r(/client\/menus\/menubar\.jsx$/, ANY, 'A-six-menus-file-edit-view-selection-tools-help'),
  r(/src-tauri\/src\/menu\.rs$/, ANY, 'D19'),
  r(/studio\/ui-prefs\.ts$/, { k: /assistant/ }, 'action:ai.chat'),
  r(/studio\/ui-prefs\.ts$/, { k: /changes/ }, 'action:history.open'),
  r(/studio\/ui-prefs\.ts$/, { k: /comments/ }, 'action:view.comments'),
  r(/studio\/ui-prefs\.ts$/, { k: /inspector/ }, 'action:view.inspector'),
  r(/studio\/ui-prefs\.ts$/, { k: /layers/ }, 'action:view.layers'),
  r(/studio\/ui-prefs\.ts$/, { k: /tree/ }, 'testid:canvas-list'),
];
