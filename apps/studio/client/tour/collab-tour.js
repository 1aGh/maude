// collab-tour.js — "How sharing works" (Menu › Help › How sharing works), rewritten for the v2 shell
// (V2-7.3). The version-control "rychlý kurz" of Phase 29, kept on the EXISTING tour engine
// (overlay.jsx) — never a fork.
//
// The teaching model is unchanged: two layers, told honestly. Being together (faces, cursors, comments)
// is automatic; below it the work moves in three steps — save a version, publish it, get the latest.
// What changed is where those live: the faces, the status word, Comments and Share are the Share
// cluster (top right), and the three steps are Version history (Menu › Version history, ⌥⌘H, with the
// git words under its Advanced fold). Version history and its dialogs are not on screen until opened,
// so the tour points at the project pill for them and names the buttons in the copy.
//
// Spotlights are stable testids from client/testids.json (test/tour-targets.test.ts pins them). The
// cluster changes shape — Preview folds the faces and the status word away, a person who can only look
// has no Share button — so those steps carry `optional: true` and are skipped when their target is not
// on screen. Copy follows the maude-v2 CONTRACT (Share, Invite, Version history, the save-status words);
// the shipped button words are Save a version · Publish · Get latest.

import CollabModelInfographic from '../panels/CollabModelInfographic.jsx';

export const COLLAB_TOUR = [
  {
    // Centred, no target — the engine renders target-less steps centred, and the `render` field draws
    // the infographic above the copy.
    render: CollabModelInfographic,
    title: 'Working together, in one picture',
    body: 'There are two layers. Up top, being together just happens. Below, your work moves through three simple steps. Here is where each one lives.',
  },
  {
    target: "[data-testid='share-cluster-faces']",
    optional: true,
    title: 'Who is here',
    body: 'Everyone in this canvas shows as a face, and their cursor moves on the canvas live. Pick a face to follow that person. AI appears here too while it edits.',
    placement: 'bottom',
  },
  {
    target: "[data-testid='share-cluster-status']",
    optional: true,
    title: 'Where your work stands',
    body: 'One word next to the faces: Saved, Syncing…, Offline — kept on this Mac, or Local project. Someone who can only look sees Can view or Can comment here, with Ask to edit.',
    placement: 'bottom',
  },
  {
    target: "[data-testid='share-cluster-comments']",
    title: 'Talk on the canvas',
    body: 'Open Comments (⇧⌘M) to read every thread, or choose Comment (C) in Preview to leave one right where you are pointing.',
    placement: 'bottom',
  },
  {
    target: "[data-testid='share-cluster-share']",
    optional: true,
    title: 'Share',
    body: 'Share opens one sheet. Invite people by name or email and pick what each can do. Copy link sits in the same sheet where the project has links.',
    placement: 'bottom',
  },
  {
    target: "[data-testid='project-pill']",
    title: 'Version history',
    body: 'Menu › Version history (⌥⌘H) lists saved versions, each with Restore. Under Advanced: Save a version with a note…, Publish to send your saved versions to the team, and Get latest to bring theirs onto this Mac.',
    placement: 'bottom',
  },
  {
    // Centred — the one honest hard thing.
    title: 'The one thing worth knowing',
    body: 'When you are here together, publishing already covers your teammate: they have seen it live, so Publish is just dropping a bookmark. Only when you work apart can two versions drift. If that happens, both are shown and you pick — keep mine, keep theirs, or keep both. Never a confusing merge.',
  },
];
