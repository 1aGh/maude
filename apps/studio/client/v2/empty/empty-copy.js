// client/v2/empty/empty-copy.js — S11.1: every line of 05 Empty States, verbatim, in one table.
//
// Ids are `<artboard>.<part>` (`es-panels-canvas.comments-none`). A block holds the parts of one empty
// state, all plain strings: `title` (the situation) · `next` (what to do) · `action` (the one button's
// label) · `keys` · `chips` (an array) · `foot` · and, where the canvas prints more, a few named extras.
// `{name}` marks the words that change (the canvas, the project, what was typed); `[[C]]` marks a key cap.
// Everything else is the canvas's own text — `test/v2-empty-kit.test.tsx` parses
// `.design/ui/v2/05 Empty States.tsx` and fails if a string here is not in it (and if a canvas title is not
// here). Edit the canvas first, then this table, never the other way round.
//
// CONTRACT §3–§4 win where they differ from 05; there are no such lines today. Three lines say "folder":
// `es-project-new.panel-none` ("Folders appear when you make one."), `es-home-local.projects-none`
// ("Already have a folder of work? Any folder opens.") and the folder blocks. §3 keeps "folder" for a
// project's own concept in the project pill; a canvas FOLDER and a folder on disk are real things in 05 and
// stay as drawn (flagged in the hand-back for the copy-critic).
//
// NOT here, on purpose: the numbered design notes under each artboard (`<Note>`) and the filmstrip
// captions of es-landing — they explain the canvas to a designer, they are not product copy.

export const COPY = Object.freeze({
  /* ── 1 · First moments ─────────────────────────────────────────────────────────────────────── */
  'es-home-cloud.placeholder': { text: 'A landing page for a small café, warm and simple' },
  'es-home-cloud.starter-1': { title: 'A pricing page', next: 'with a yearly toggle' },
  'es-home-cloud.starter-2': { title: 'Three logo ideas', next: 'for a new brand' },
  'es-home-cloud.starter-3': { title: 'A matchday poster', next: 'A4, ready to print' },
  'es-home-cloud.shelf': { title: 'Your projects', foot: 'cloud.maude.sh' },
  'es-home-cloud.projects-none': {
    title: 'No projects yet.',
    next: 'Your first canvas starts one — and everyone you invite sees it here.',
  },

  'es-home-local.placeholder': { text: 'A one-page portfolio, six projects, calm and light' },
  'es-home-local.starter-1': { title: 'A portfolio page', next: 'six projects, calm' },
  'es-home-local.starter-2': { title: 'Three logo ideas', next: 'for a new brand' },
  'es-home-local.starter-3': { title: 'A moodboard', next: 'photos and swatches' },
  'es-home-local.sign-in': { text: 'Sign in to cloud.maude.sh' },
  'es-home-local.shelf': { title: 'Your projects', foot: 'On this Mac' },
  'es-home-local.projects-none': {
    title: 'No projects on this Mac yet.',
    next: 'Your first canvas starts one. Already have a folder of work? Any folder opens.',
    action: 'Open project…',
    keys: '⌘O',
  },

  'es-home-shared.starter-1': { title: 'A pricing page', next: 'with a yearly toggle' },
  'es-home-shared.starter-2': { title: 'An onboarding flow', next: 'three calm steps' },
  'es-home-shared.starter-3': { title: 'A mobile detail', next: 'for the Homepage' },
  'es-home-shared.shelf': { title: 'Shared with you' },
  'es-home-shared.shared-none': {
    title: 'Nothing shared with you yet.',
    next: 'When Tereza or Jonas share a project with you, it shows up here.',
  },

  'es-project-new.project-none': {
    title: '{project} has no canvases yet.',
    next: 'Describe the first one and AI drafts it — or start blank.',
    action: 'Start with an empty canvas',
    keys: '⌘N',
    placeholder: 'A one-page portfolio with six projects, calm and light',
  },
  'es-project-new.panel-none': {
    title: 'No canvases yet.',
    next: 'Each canvas holds as many artboards as you like.',
    action: 'New canvas',
    foot: 'Folders appear when you make one.',
  },

  'es-canvas-ai.canvas-ready': {
    title: 'Your canvas is ready.',
    next: 'Ask AI for a first draft, or start drawing.',
    action: 'Ask AI',
    keys: '⌘/',
  },

  // S11.2 (W7, "no door"): the way in that is not the AI — the canvas gained this button with the row.
  'es-canvas-ai.door': { action: 'New artboard' },

  'es-landing.frame': { title: 'Your canvas is ready.', action: 'Ask AI' },

  'es-canvas-three.offline': {
    title: 'Your canvas is ready.',
    next: 'Ask AI for a first draft, or start drawing.',
    action: 'Ask AI',
    keys: '⌘/',
    offline: 'AI is back when this Mac is online.',
  },
  'es-canvas-three.queued': { text: 'Queued — sends when this Mac is online.' },
  'es-canvas-three.drafting': { text: 'Drafting {canvas}…' },

  'es-artboard-new.artboard-empty': {
    title: 'Empty artboard.',
    next: 'Draw a frame with [[F]], place an image [[I]] or a component [[⇧I]], or let AI start it from {from}.',
    action: 'Ask AI to fill {artboard}',
    keys: '⌘/',
  },
  'es-artboard-new.layers-none': {
    title: 'No layers on {artboard} yet.',
    next: 'Anything you draw or drop on it shows up here, in order.',
  },

  /* ── 2 · Panels ────────────────────────────────────────────────────────────────────────────── */
  'es-panels-canvas.folder-none': {
    title: 'Nothing in {folder} yet.',
    next: 'Drag canvases in, or start one here.',
    action: 'New canvas in {folder}',
  },
  'es-panels-canvas.comments-none': {
    title: 'No comments on {canvas} yet.',
    next: 'Press [[C]], then click anywhere on the canvas to leave one.',
    action: 'Share for feedback',
  },
  'es-panels-canvas.comments-done': {
    title: 'All done.',
    next: 'Every comment on {canvas} is resolved. They stay under Resolved, with their replies.',
  },
  'es-panels-canvas.vh-before-first': {
    title: 'Versions appear here as you work.',
    next: "Every change is kept on its own. There's nothing to save.",
  },

  'es-panels-make.ai-none': {
    title: 'Ask about {canvas}.',
    next: "AI sees what you've selected, so “make this calmer” just works.",
    chips: ['Add a yearly toggle', 'Write three FAQ answers', 'Make a dark version'],
    placeholder: 'Ask AI about {canvas}…',
  },
  'es-panels-make.assets-none': {
    title: 'No images or footage yet.',
    next: 'Drop photos, logos, video or music here — or anywhere on the canvas.',
    action: 'Generate an image',
  },
  'es-panels-make.exports-none': {
    title: 'No exports yet.',
    next: 'Every export of {project} lands here, ready to save again.',
    action: 'Export…',
    keys: '⇧⌘E',
  },
  'es-panels-make.trash-empty': {
    title: 'Trash is empty.',
    next: 'Canvases and artboards you move to the trash wait here until you clear them out.',
  },

  'es-timeline.timeline-none': {
    title: 'No clips on {artboard} yet.',
    next: 'Drag footage here from Assets or Finder. {count} clips from {source} are ready in Assets.',
    action: 'Cut 15 s from those clips',
  },

  /* ── 3 · Search that finds nothing ─────────────────────────────────────────────────────────── */
  'es-search-k.search-none': {
    title: 'Nothing called “{q}”.',
    next: 'Try another word, or ask AI to find it.',
    didYouMean: 'Did you mean',
    action: 'Ask AI to find “{q}”',
    actionMeta: ' — it looks inside canvases too',
    foot: '0 results · 1 close match',
  },
  'es-search-more.recents-none': {
    title: 'Nothing opened yet.',
    next: 'Canvases you open show up here, newest first.',
    placeholder: 'Search canvases, actions, or ask AI…',
    recent: 'Recent',
    startHere: 'Start here',
    rows: ['New canvas', 'Open project…', 'Import from Figma…', 'Keyboard shortcuts'],
    action: 'Ask AI',
    actionMeta: ' — type what to make, or what to find',
    foot: 'Every tool is here — type its name',
  },
  'es-search-more.assets-search-none': {
    title: 'Nothing called “{q}”.',
    next: 'Try another word — search reads names and tags.',
    action: 'Let AI describe your pictures',
    fine: "So search finds what's in them. Once for {project}, on your Claude account.",
    foot: 'Searched {count} assets — names and tags',
  },
  'es-search-panel.panel-search-none': {
    title: 'Nothing called “{q}”.',
    next: 'Try another word, or ask AI to find it.',
    action: 'Ask AI to find it',
    foot: 'Searched {count} canvases and their artboards',
  },
  'es-filter.filter-none': {
    title: 'No {kind} artboards in {canvas}.',
    next: 'The {Kind} filter is still on from {from}. All {count} artboards here are {others}.',
    action: 'Clear filter',
  },

  /* ── 4 · When it's not really empty ────────────────────────────────────────────────────────── */
  'es-viewer.viewer-comments-none': {
    title: 'No comments on {canvas} yet.',
    next: 'Press [[C]], then click anywhere on the canvas to leave one. {names} see it right away.',
  },
  'es-arriving.arriving': {
    tag: '{count} artboards on their way',
    foot: 'Getting {project} · {done} of {total} canvases',
  },
  'es-offline-uncached.not-local': {
    title: "{canvas} isn't on this Mac yet.",
    next: 'It opens by itself when this Mac is back online. Nothing in it is lost — the cloud copy is safe.',
    action: 'Show canvases on this Mac',
  },
  'es-all-trashed.all-trashed': {
    title: '{canvas} has no artboards left.',
    next: '{who} moved all {countWord} to the trash {ago}. Restore puts them back where they were; every earlier version is in Version history too.',
    action: 'Restore {count} artboards',
  },
  'es-edge-panels.chat-search-none': {
    title: 'No chat mentions “{q}”.',
    next: 'Searched {count} chats in {project} — titles and every message.',
    action: 'Start a chat about it',
    foot: '{count} chats · kept with the project',
  },
  'es-edge-panels.share-alone': {
    title: 'Only you on {project} so far.',
    next: 'People you invite see {project} right away and can edit, comment and download, or look only.',
  },
});

/**
 * Empty states with nothing to do: they carry no button, whatever a caller passes (Phase 4 W7, "no door").
 * Version history before the first change, an empty Trash, and "Shared with you" before anyone shares.
 */
export const NO_DOOR = Object.freeze(
  new Set([
    'es-panels-canvas.vh-before-first',
    'es-panels-make.trash-empty',
    'es-home-shared.shared-none',
  ])
);

/** Every block id, in the canvas's own order. */
export function copyIds() {
  return Object.keys(COPY);
}

const SLOT = /\{([A-Za-z]+)\}/g;

function fill(text, vars, id) {
  return text.replace(SLOT, (_, name) => {
    if (vars == null || !(name in vars) || vars[name] == null) {
      throw new Error(`empty-copy: "${id}" needs {${name}}`);
    }
    return String(vars[name]);
  });
}

/**
 * The block for `id` with its `{vars}` filled in — a new object each call. A variable the line needs but
 * the caller did not give throws (a visible `{canvas}` in the UI is a bug, not a fallback).
 * @param {string} id  `<artboard>.<part>`
 * @param {Record<string, string|number>} [vars]
 * @returns {Record<string, string | string[]>}
 */
export function copy(id, vars) {
  const block = COPY[id];
  if (!block) throw new Error(`empty-copy: unknown id "${id}"`);
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    out[k] = Array.isArray(v) ? v.map((s) => fill(s, vars, id)) : fill(v, vars, id);
  }
  return out;
}
