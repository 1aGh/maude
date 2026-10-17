// usage-tour.js — the evergreen "how the Maude UI works" walkthrough.
//
// Targets stable [data-tour] anchors (redesign-proof — styling classes get
// renamed, these don't) on elements that exist at first load: the sidebar, the
// viewport, the project menu and the Inspector. The
// Inspector step carries `inspector: true` so the engine opens the panel before
// spotlighting it. Steps whose target is missing are shown centered by the
// overlay, so this stays resilient to chrome changes. Reached from Help →
// "Take the tour" and offered once on first run.

export const USAGE_TOUR = [
  {
    target: "[data-tour='sidebar']",
    title: 'Your canvases live here',
    body: 'Every mock in the project shows up in this tree. Click one to open it in a tab — or use “+ board” to spin up a blank brief-board, no command needed.',
    placement: 'right',
  },
  {
    target: "[data-tour='viewport']",
    title: 'The canvas',
    body: 'Open a canvas, then ⌘-hover to preview the element under your cursor and ⌘-click to select it. Right-click for Copy CSS / Fit / Reset.',
  },
  {
    target: "[data-tour='menus']",
    title: 'The project menu',
    body: 'Everything that used to live in the menu bar is in this one menu: File, Edit, View, Help, version history and Settings. Tools sit on the toolbar over the canvas. Press ⌘K to find any of it by name.',
    placement: 'bottom',
  },
  {
    target: "[data-tour='inspector']",
    inspector: true,
    title: 'The Inspector',
    body: 'Opened from View → Inspector (or press I). Inspect · Layers · CSS — ⌘-click any element and edit its CSS against your design tokens, right here. No AI round-trip.',
    placement: 'left',
  },
  {
    // Centered: What's new and Help are rows of the project menu (Menu › Help), not a button of their own.
    title: 'What’s new, and Help',
    body: 'New features land under Menu › Help › What’s new — some entries come with a guided tour like this one. Press ? for the full keyboard cheat-sheet, and restart this tour from the Help menu whenever you like.',
  },
];
