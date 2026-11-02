// usage-tour.js — the evergreen "how the Maude UI works" walkthrough, written for the v2 shell
// (V2-7.3). Reached from Menu › Help › Take the tour.
//
// Every spotlight is a stable hook from client/testids.json — a project-pill testid, a panel's own
// testid, or a data-tour anchor that survived the redesign — never a styling class.
// test/tour-targets.test.ts pins each one to the contract AND to a literal in the client source, so a
// renamed testid fails CI instead of quietly turning a spotlight into a centred card.
//
// A step whose target can be absent (a role or shell state without that element) carries
// `optional: true`: the overlay skips it instead of showing it pointing at nothing. The toolbars live
// inside the canvas frame, which the shell cannot reach (cross-origin, DDR-054), so they are described
// on the mode switch step rather than spotlit. Copy follows the maude-v2 CONTRACT: Menu, Search,
// canvas / artboard, panel, AI chat panel, Version history; no "we", no "I", no exclamation marks.

export const USAGE_TOUR = [
  {
    target: "[data-testid='project-pill']",
    title: 'The project menu',
    body: 'One menu holds the whole project: File, Edit, View, Help, Version history, Share, Export and Settings. The mark and the project name open it.',
    placement: 'bottom',
  },
  {
    // Centred: Search has no button of its own, only the key.
    title: 'Search finds anything',
    body: 'Press ⌘K and type. Search reaches canvases, actions, AI and every tool that is not on the toolbar.',
  },
  {
    target: "[data-testid='panel-head-left']",
    optional: true,
    title: 'Canvases, Layers, Assets',
    body: 'Canvases lists every canvas in the project: click one to open it. Layers shows what is on the open canvas as a tree, and Assets holds the project’s pictures and media. ⌘\\ hides every panel.',
    placement: 'right',
  },
  {
    target: "[data-tour='viewport']",
    canvas: true,
    title: 'The canvas',
    body: 'Every artboard of a canvas sits on one infinite surface. Hold Space to drag it around, ⌘+ and ⌘− to zoom, ⌘0 to fit everything.',
  },
  {
    target: "[data-testid='share-cluster-mode']",
    title: 'Edit, Preview, Present',
    body: 'Edit changes the design. Preview keeps it live and swaps the toolbar for annotation tools: Sticky, Comment, Marker, Arrow, Stickers and Section. Present shows the canvas to an audience.',
    placement: 'bottom',
  },
  {
    target: "[data-testid='inspector-panel']",
    inspector: true,
    optional: true,
    title: 'The Inspector',
    body: 'Select something in Edit and the Inspector names it and lists its settings. Changes write straight to the source, with no AI round-trip. Advanced at the foot holds the CSS. ⇧⌘I opens it.',
    placement: 'left',
  },
  {
    // the AI chat panel itself while it shows, else the spark icon that brings it back
    target: "[data-testid='ai-chat-island'], [data-testid='panel-icon-assistant']",
    optional: true,
    title: 'AI chat panel',
    body: 'Ask AI for a draft or a change. Press ⌘/ and the selection goes with it. AI works on the canvas while you watch, and ⌘Z undoes its changes like your own.',
    placement: 'left',
  },
  {
    // Centred: What's new and Help are rows of the Help submenu, not buttons of their own.
    title: 'Help is one key away',
    body: 'Press ? for every shortcut and F1 for guides. Menu › Help replays this tour, shows What’s new and explains how sharing works.',
  },
];
