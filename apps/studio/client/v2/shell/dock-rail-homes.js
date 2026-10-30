// client/v2/shell/dock-rail-homes.js — V2-4.4b: where every capability of the old dock tab strip and the
// CollapsedRail lives now (nothing-deleted rows `A-dock-resize-grips-and-tab-strips`,
// `A-panel-positions-left-right`, `A-auto-open-inspector-on-select`, `A-layers-as-a-separate-panel`).
//
// `file` is the source that produces the control, `testid` / `actionId` / `label` what a test can find there.
// test/v2-right-islands.test.tsx checks each against the source and the registry, so a capability cannot be
// dropped silently — the same shape as left-panel-model.js CAPABILITY_HOMES.

export const DOCK_RAIL_HOMES = [
  // ── the CollapsedRail (pinned layout, left slot empty) ──
  {
    was: 'Rail › Expand sidebar',
    home: 'The Canvases corner icon, in every layout (also ⌘\\ Show panels)',
    file: 'client/v2/shell/corner-icons.jsx',
    testid: 'panel-icon-<which>',
    actionId: 'view.panels',
  },
  {
    was: 'Rail › Search (/)',
    home: '/ and ⌘F open the Canvases panel on its search; the Search field heads the list',
    file: 'client/hooks/use-palette-and-panels.jsx',
    actionId: 'canvases.search',
  },
  {
    was: 'Rail › Files',
    home: 'The Canvases corner icon',
    file: 'client/v2/shell/corner-icons.jsx',
    testid: 'panel-icon-<which>',
  },
  // ── the dock tab strip ──
  {
    was: 'Tab › Canvases · Layers · Assets',
    home: "The left panel's own header: the segmented strip Canvases · Layers · Assets",
    file: 'client/shell/dock.jsx',
    testid: 'panel-tab-<id>',
  },
  {
    was: 'Tab › Hide (fold the left panel)',
    home: "The left panel's header Hide icon; it folds to its corner icon",
    file: 'client/shell/dock.jsx',
    testid: 'panel-fold-<side>',
  },
  {
    was: 'Tab › Inspector',
    home: 'Its own island: ⇧⌘I / View › Inspector, appears on a selection, its corner icon when folded',
    file: 'client/v2/shell/menu-runner.js',
    actionId: 'view.inspector',
  },
  {
    was: 'Tab › Inspector (auto-open)',
    home: 'View › Advanced › Open inspector on select — on, the Inspector appears with a selection and leaves on deselect',
    file: 'client/v2/shell/inspector-follow.js',
    actionId: 'view.inspector-on-select',
  },
  {
    was: 'Tab › Comments',
    home: "A right island: the Share cluster's Comments button and View › Comments",
    file: 'client/v2/shell/share-cluster.jsx',
    testid: 'share-cluster-<action>',
    actionId: 'view.comments',
  },
  {
    was: 'Tab › Changes',
    home: 'Version history (View › Version history)',
    file: 'client/v2/shell/menu-runner.js',
    actionId: 'history.open',
  },
  {
    was: 'Tab › Sync',
    home: "Menu › Diagnostics › Sync opens the Sync panel whole (a sync callout's Details does the same); the Share cluster's word says the state",
    file: 'client/v2/diagnostics/diagnostics-handlers.js',
    actionId: 'diag.sync',
  },
  {
    was: 'Tab › Assistant',
    home: 'Its own island: the AI chat action (menu / key) and the spark corner icon; Hide in its header folds it to that icon',
    file: 'client/panels/chat-header.jsx',
    testid: 'ai-chat-hide',
    actionId: 'ai.chat',
  },
  // ── the rest of the dock ──
  {
    was: 'Layers as its own panel or a tab of the Inspector',
    home: 'View › Advanced › Layers as a panel',
    file: 'client/v2/shell/menu-runner.js',
    actionId: 'view.layers-panel',
  },
  {
    was: 'Docked columns instead of floating panels',
    home: 'View › Advanced › Pin panels to the side',
    file: 'client/v2/shell/menu-runner.js',
    actionId: 'view.pin-panels',
  },
  {
    was: 'Resize grips',
    home: 'The grip on the inner edge of the left and right panels (drag, arrows, double-click resets)',
    file: 'client/shell/dock.jsx',
    testid: 'panel-grip-<side>',
  },
  {
    was: 'Panel positions left / right (panelSides)',
    home: 'Settings › Layout › Panel positions',
    file: 'client/panels/SettingsPanel.jsx',
    testid: 'panel-side-<id>',
  },
];
