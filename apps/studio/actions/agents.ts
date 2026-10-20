// agents.ts — every action's AI path (contract V2-1.11 §5.1; V2-2.4b).
//
// One entry per registered action with kind !== 'place': its effect and exactly ONE agent path —
//   file    a documented format plus the skill section that teaches it,
//   cli     a `maude` verb (its tier is in verbs.ts),
//   human   a reason from the closed HumanReason list,
//   pending allowed only under the §5.7 ratchet; names the package that builds the path and the
//           path it will become.
// scripts/gen-actions.mjs folds these into apps/studio/actions.manifest.json;
// test/ai-parity-coverage.test.ts fails on a missing entry, a stale one, or a pending count above
// actions.parity.json's pendingMax. A new action lands with its entry in the same change (rule 14).
//
// Kept beside the registry (keyed by id) rather than on each ActionDef: 115 definitions across 12
// files, three of them factories. The manifest is the merged view either way.

import { TEMPLATES } from '../annotations/templates.ts';
import type { ActionDefAI, ActionId, AgentPath, HumanReason } from './types.ts';

const file = (
  format: Extract<AgentPath, { path: 'file' }>['format'],
  skill: Extract<AgentPath, { path: 'file' }>['skill'],
  how: string
): AgentPath => ({ path: 'file', format, skill, how });
const cli = (verb: string): AgentPath => ({ path: 'cli', verb });
const human = (because: HumanReason, note?: string): AgentPath =>
  note ? { path: 'human', because, note } : { path: 'human', because };
// No `pending` helper: pendingMax reached 0 at the V2-2.4b gate and stays 0 (§5.7 rule 2).

// `maude design open` moves the user's view through the same registry actions (client/ui-open.js).
const NAV = (note: string): ActionDefAI => ({
  effect: 'none',
  agent: cli(`maude design open ${note}`),
});
const PREF = (note?: string): ActionDefAI => ({ effect: 'none', agent: human('view-pref', note) });
const TSX = (how: string, skill: `design:${string}` = 'design:design'): ActionDefAI => ({
  effect: 'project',
  agent: file('canvas-tsx', skill, how),
});
const BOARD = (how: string): ActionDefAI => ({
  effect: 'project',
  agent: file('annotations', 'design:whiteboard', how),
});
// V2-2.4b — the last pending paths (§5.7 rule 2: pendingMax 0). `maude design open` moves the view
// but opens no panel, so the panels' paths are the read verbs (V2-1.9 §5.11: history.open →
// `history list`). Undo/redo keys are human (V2-1.5 §5.3 "human (keys)"): they walk the person's
// own stack, and an agent has no "newest step" there — it undoes ONE accepted action by id, as a new
// version, which is V2-1.5's separate `history.undo-action` / `chat.undo` path
// (decision:maude/v2-2.4b-undo-keys-human).
const UNDO_KEYS: ActionDefAI = {
  effect: 'none',
  agent: human(
    'keys',
    'the person’s own undo stack; an agent undoes one action by id: `maude design history undo --action <id>`'
  ),
};
const COMMENTS: ActionDefAI = { effect: 'none', agent: cli('maude design comments list') };
const RESTORE = (verb: string): ActionDefAI => ({
  effect: 'destructive',
  minRole: 'edit',
  undo: 'step',
  server: { route: '/_api/project/restore', method: 'POST' },
  agent: cli(verb),
});
// S11.10 — Version history › Advanced's git buttons: the person's working tree or remote (human 'git').
const GIT = (route: string, git: string, write = true): ActionDefAI => ({
  effect: 'shared',
  ...(write ? { minRole: 'edit' as const } : {}),
  server: { route, method: 'POST' },
  agent: human('git', `an agent runs git itself in the project folder: ${git}`),
});
// S9.7b — the comment TOOL's agent path is the write verb: an agent leaves a comment by posting it
// (`POST /_api/comments/op`, as the session, AI-written). The action itself only picks a tool
// (fromCanvas ⇒ effect none); the verb's own tier is shared → prompt (verbs.ts).
const COMMENT_ADD: ActionDefAI = {
  effect: 'none',
  agent: cli('maude design comments add --as-ai'),
};
const HELP: ActionDefAI = { effect: 'none', agent: human('onboarding') };
// S7.6c — a video tool whose UI write is one edit op: one undo step, refused below Can edit.
const VIDEO_OP = (agent: AgentPath): ActionDefAI => ({
  effect: 'project',
  minRole: 'edit',
  undo: 'step',
  server: { route: '/_api/edit-op', method: 'POST' },
  agent,
});

const CLIP_MENU_TSX = (how: string): ActionDefAI =>
  VIDEO_OP(file('canvas-tsx', 'design:video-comp', how));

export const AGENT_PATHS: Readonly<Record<ActionId, ActionDefAI>> = {
  // ── diagnostics (V2-4.7b) ──
  'diag.sync': { effect: 'none', agent: cli('maude design sync status') },
  'diag.server': { effect: 'none', agent: cli('maude design status') },
  'diag.ai': { effect: 'none', agent: cli('maude doctor') },
  'diag.ai-recheck': { effect: 'none', agent: cli('maude doctor') },
  // S11.11 — `maude design logs` prints the same redacted lines the sheet shows (the files sit in
  // ~/.maude/logs); copying and revealing the folder are the person's clipboard and Finder.
  'diag.logs': { effect: 'none', agent: cli('maude design logs') },
  'diag.copy-logs': { effect: 'none', agent: cli('maude design logs') },
  'diag.logs-show-in-finder': {
    effect: 'none',
    agent: human(
      'native-window',
      'reveals ~/.maude/logs in Finder; the agent reads `maude design logs`'
    ),
  },
  'diag.address': {
    effect: 'none',
    agent: human('view-pref', 'copies a value the agent already has from `maude design status`'),
  },
  'diag.process': {
    effect: 'none',
    agent: human('view-pref', 'copies a value the agent already has from `maude design status`'),
  },
  'diag.project-folder': {
    effect: 'none',
    agent: human('view-pref', 'copies the project path the agent already works in'),
  },
  // S11.11 — `maude design sync resync` waits for the trace and prints the result sentence (a
  // shared effect: it prompts). The route refuses a read-only session and a cloud member.
  'sync.resync': {
    effect: 'shared',
    agent: cli('maude design sync resync'),
    minRole: 'edit',
    server: { route: '/_api/sync/resync', method: 'POST' },
  },
  // S11.17 — lands the canvas writes a full disk held (they also land by themselves once there is room).
  // An agent's own writes go straight to the files; it frees space and may press Retry the same way.
  'save.retry-held': {
    effect: 'project',
    agent: cli(
      'maude design curl-local -X POST http://127.0.0.1:<port>/_api/diagnostics/disk-retry'
    ),
    minRole: 'edit',
    server: { route: '/_api/diagnostics/disk-retry', method: 'POST' },
  },
  'sync.download-all': {
    effect: 'none',
    agent: human('hub-link', 'pulls every file of a linked project onto this Mac'),
  },
  // S11.12 — Sync details (06 ad-syncd). A held SOURCE conflict's three picks; the slug is the
  // `source-conflict-<slug>` notice id `maude design sync status` lists. Keep both writes this Mac's
  // version as a new canvas "<name> this Mac" (ONE doc.create — one undo step) + a history aside.
  ...Object.fromEntries(
    (
      [
        ['keep-mine', 'mine'],
        ['use-theirs', 'theirs'],
        ['keep-both', 'keep-both'],
      ] as const
    ).map(([k, choice]) => [
      `sync.${k}`,
      {
        effect: 'shared',
        minRole: 'edit',
        undo: 'step',
        server: { route: '/_api/project/conflict', method: 'POST' },
        agent: cli(
          `maude design curl-local -X POST http://127.0.0.1:<port>/_api/project/conflict -d '{"file":"<slug>","choice":"${choice}"}'`
        ),
      } satisfies ActionDefAI,
    ])
  ),
  ...Object.fromEntries(
    (['publish', 'discard'] as const).map((choice) => [
      `sync.${choice}-ai-edit`,
      {
        effect: 'shared',
        minRole: 'edit',
        server: { route: '/_api/project/ai-action', method: 'POST' },
        agent: cli(
          `maude design curl-local -X POST http://127.0.0.1:<port>/_api/project/ai-action -d '{"choice":"${choice}"}'`
        ),
      } satisfies ActionDefAI,
    ])
  ),
  'sync.cancel-transfer': {
    effect: 'none',
    minRole: 'edit',
    server: { route: '/_api/sync/cancel-assets', method: 'POST' },
    agent: cli('maude design curl-local -X POST http://127.0.0.1:<port>/_api/sync/cancel-assets'),
  },
  'sync.get-latest': GIT('/_api/git/pull', 'git pull'),
  'sync.sign-in-again': {
    effect: 'none',
    agent: human('hub-link', 'signing in to the cloud is the person’s own credential'),
  },
  // ── search ──
  'search.open': { effect: 'none', agent: cli('maude design index') },
  'canvases.search': { effect: 'none', agent: cli('maude design index') },
  'canvases.find': { effect: 'none', agent: cli('maude design index') },
  'canvases.refresh': { effect: 'none', agent: cli('maude design index') },
  // ── canvas ──
  'canvas.new': TSX('Write a new .tsx under the design root with a DCArtboard per screen'),
  'canvas.new-brief': TSX(
    'Write a brief .tsx from plugins/design/templates/brief-board.tsx.template under the design root'
  ),
  // S6.3 — a canvas from one sentence: the agent writes the new .tsx itself (V2-1.1 §5.9: `file:'canvas-tsx'`).
  'home.ask': TSX(
    'Write a new canvas .tsx under newCanvasDir: add every artboard empty with kind and size first, then fill big before small, words last (SKILL.md § A first draft from Home)'
  ),
  'canvas.duplicate': TSX('Copy the .tsx and its .meta.json under a new name in the same folder'),
  'canvas.rename': TSX('Rename the .tsx and its .meta.json together'),
  'canvas.move': TSX('Move the .tsx and its .meta.json to another folder under the design root'),
  // S11.7 — the code view and the broken-canvas card. The agent reads the same two routes through verbs
  // (S11.6): `canvas-source` is the code (or one artboard's lines), `canvas-errors` the structured errors.
  'canvas.view-code': { effect: 'none', agent: cli('maude design canvas-source') },
  'canvas.copy-error': { effect: 'none', agent: cli('maude design canvas-errors') },
  // "Ask AI to fix it" only PRE-FILLS the composer; the agent's own way to the same place is to read the
  // structured error (file, line, column) and edit the .tsx — so the path is the read verb, not a human gate.
  'canvas.ask-ai-fix': { effect: 'none', agent: cli('maude design canvas-errors') },
  'canvas.last-good': RESTORE('maude design history restore <canvas> @last-good'),
  // S1.2 — the row menu's other rows. The link is the canvas's address (`maude design open <canvas>` moves
  // the person's view to it). Trash: until S1.17's `maude design trash`, an agent parks the files the way
  // `DELETE /_api/canvas` does, and the Trash lists them from the manifest.
  // S11.9 — the row menu's Advanced group. The two native doors open Finder / the editor on the PERSON's Mac:
  // an agent already holds the file (the project path is in `maude design index`), so they are the person's.
  'canvas.reveal-in-finder': {
    effect: 'none',
    agent: human(
      'native-window',
      'opens Finder on the person’s Mac; an agent already holds the file'
    ),
  },
  'canvas.open-in-editor': {
    effect: 'none',
    agent: human(
      'native-window',
      'opens the person’s editor on the file; an agent edits the .tsx itself'
    ),
  },
  'canvas.copy-file-path': { effect: 'none', agent: cli('maude design index') },
  'canvas.rename-file': TSX('Rename the .tsx and its .meta.json together'),
  'canvas.copy-link': {
    effect: 'none',
    agent: human('view-pref', 'copies to the clipboard; an agent shares the canvas path instead'),
  },
  'canvas.trash': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    agent: file(
      'canvas-tsx',
      'design:design',
      'Move the .tsx and its sidecars to <designRoot>/_trash/<stamp>__<slug>/ and write _trash-manifest.json {canvas, slug, trashed[]} beside them; Trash restores from it'
    ),
  },
  // S1.2 — pins are the person's (`/_api/pins`); the sort order is a per-project view preference.
  'canvases.pin': PREF(
    'a per-person pin; an agent reads the canvas list with `maude design index`'
  ),
  'canvases.unpin': PREF(
    'a per-person pin; an agent reads the canvas list with `maude design index`'
  ),
  'canvases.sort': PREF(
    'the order the Canvases panel lists in; `maude design index` lists them all'
  ),
  // S7.24 — the kind chips narrow the Canvases list in the person's window; `maude design index` reads each
  // canvas's artboard kinds (the same index the counts come from).
  'canvases.filter-kind': PREF(
    'narrows the Canvases list in the person’s window; `maude design index` lists every canvas with its artboard kinds'
  ),
  'import.figma': { effect: 'external', agent: cli('maude design import-figma') },
  // S8.18 — a website read is third-party network (the fetch-asset gate); a logo alone writes assets/logos/
  'import.brand': { effect: 'external', agent: cli('maude design import-brand') },
  'view.advanced-open-all': PREF('opens every panel’s Advanced fold; a UI preference'),
  'view.advanced-close-all': PREF('folds every panel’s Advanced section; a UI preference'),
  'canvas.reload': PREF('reloads the user’s view; the studio reloads on every file change'),
  'canvas.new-video': TSX('Write a new video-comp .tsx canvas', 'design:video-comp'),
  'canvas.close': PREF('closes the user’s tab'),
  'video.assemble': {
    effect: 'project',
    agent: file('edl', 'design:footage-director', 'Write the <slug>.edl.json cut, then the comp'),
  },
  // ── video tools (S7.6c, V2-1.10 §5.7): the UI's writes are edit ops (`POST /_api/edit-op`, minRole
  // edit — the server refuses below it); an agent runs the verb that ends in the same op, or writes
  // the same literal props itself.
  'video.captions.add': VIDEO_OP(cli('maude design captions add')),
  'video.captions.style': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Set words / position / font / highlight / maxChars on the comp’s one <Captions>'
    )
  ),
  'video.captions.fix-word': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Add { src, at, text } to <Captions fixes> as a JSON literal (text null hides the word)'
    )
  ),
  'video.captions.export': {
    effect: 'project',
    minRole: 'comment',
    agent: cli('maude design captions export'),
  },
  'video.transcript.cut': VIDEO_OP(cli('maude design cut-words')),
  'video.transcript.find-speech': {
    effect: 'project',
    minRole: 'edit',
    agent: cli('maude design transcribe-local'),
  },
  'video.music.beats': { effect: 'project', minRole: 'edit', agent: cli('maude design beats') },
  'video.music.duck': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Wrap the one music <Audio> in <Duck db attackMs releaseMs>; unwrap to turn it off'
    )
  ),
  'video.cut-to-beat': VIDEO_OP(cli('maude design cut-to-beat')),
  'video.snap': {
    effect: 'project',
    minRole: 'edit',
    agent: file(
      'canvas-meta',
      'design:video-comp',
      'artboardMeta.<id>.snap: "beat" | "off" in the canvas .meta.json'
    ),
  },
  'video.reframe': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Wrap the clip’s media in <Reframe focus zoom formats> (source-second keyframes, sorted)'
    )
  ),
  'video.poster.set': {
    effect: 'project',
    minRole: 'edit',
    agent: file(
      'canvas-meta',
      'design:video-comp',
      'artboardMeta.<id>.poster: a comp frame, in the canvas .meta.json'
    ),
  },
  'video.format.add': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Copy the video DCArtboard with a new id and size; its <VideoComp> keeps component={X} (linked)'
    )
  ),
  'video.format.unlink': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Copy the comp under a new name and point this artboard’s <VideoComp component> at it'
    )
  ),
  'video.take.swap': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Set the clip media’s trimBefore (output frames) to the other take; keep durationInFrames'
    )
  ),
  'video.fit': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Set fit="fit" | "blur" on the clip’s <Reframe> (fill is the default)'
    )
  ),
  'video.place': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Wrap the title’s content in <Place at={[x, y]} formats={{ "16:9": [x, y] }}> (centre anchor, fractions of the output frame)'
    )
  ),
  'artboard.new-desktop': TSX('Add a DCArtboard sized 1440×1024'),
  'artboard.new-laptop': TSX('Add a DCArtboard sized 1280×800'),
  'artboard.new-tablet': TSX('Add a DCArtboard sized 834×1194'),
  'artboard.new-mobile': TSX('Add a DCArtboard sized 390×844'),
  'artboard.new-a4': TSX('Add a DCArtboard kind="print" sized A4'),
  'artboard.new-letter': TSX('Add a DCArtboard kind="print" sized Letter'),
  // S7.20 — the F size picker. The kind travels with the pick: one DCArtboard of the preset's kind.
  'artboard.new-video': TSX(
    'Add <DCArtboard kind="video" width={1920} height={1080}> with a <VideoComp component={…} durationInFrames={150} fps={30} width={1920} height={1080} /> inside and the comp function — see canvas-tsx.md § Add an artboard of a kind'
  ),
  'artboard.insert-preset': TSX(
    'Add <DCArtboard id label kind width height> of the preset’s kind: kind="digital" fixed for App and Social sizes, kind="web" (width, height is the floor) for a Web page, kind="print" print={{ paper, orientation }} with px = trim + 2 × bleed for Print, kind="video" with a <VideoComp> for Video; a custom print size is print={{ paper: <nearest larger preset>, orientation, sizeMm: [w, h], bleedMm }} and never paper "custom"; its x / y in layout.artboards[] of the .meta.json — see canvas-tsx.md § Add an artboard of a kind'
  ),
  // ── edit / select / object ──
  'edit.undo': UNDO_KEYS,
  'edit.redo': UNDO_KEYS,
  'edit.undo-history': {
    effect: 'none',
    agent: human(
      'keys',
      'the person’s own undo stack, shown; an agent reads history with `maude design history list`'
    ),
  },
  'edit.cut': PREF('the clipboard is the user’s; remove the content from the source instead'),
  'edit.paste': PREF('the clipboard is the user’s; write the content into the source instead'),
  'edit.copy': PREF('the clipboard is the user’s; read the source instead'),
  'select.all': NAV('<canvas> --select all'),
  'select.none': NAV('<canvas> --select none'),
  'select.all-annotations': NAV('<canvas> --select annotations'),
  'object.duplicate': TSX('Copy the element’s JSX next to it; give the copy a new element id'),
  // S2.2 — Inspector › Advanced. The copies read what is already in the file; the id is the
  // `data-cd-id` literal (V2-1.4 §5.5), renamed together with every reference to it.
  'inspector.copy-css': {
    effect: 'none',
    agent: file('canvas-tsx', 'design:design', 'Read the element’s style={{…}} in the .tsx'),
  },
  'element.copy-id': {
    effect: 'none',
    agent: file('canvas-tsx', 'design:design', 'Read the element’s data-cd-id in the .tsx'),
  },
  // S8.19c — one edit-op; an agent edits the same string literals by hand.
  'asset.relink': TSX(
    'Replace every string literal that names the missing file with the copy’s assets/<sha8>.<ext> path (import it first with the asset import); keep each reference’s leading / or ./'
  ),
  // S2.8 — an artboard's size is its JSX width/height (+ the bare `fixed` prop); its place is the meta layout.
  'artboard.resize': TSX(
    'Set the DCArtboard’s width and height props (64–8192); add the bare `fixed` prop to make the height exact. Its position is layout.artboards[] in the .meta.json, not a prop'
  ),
  'artboard.add-width': TSX(
    'Copy the DCArtboard’s JSX beside it with a new id, a label that names the width, and that width prop; add its layout.artboards[] position in the .meta.json'
  ),
  // S2.9 — Tidy up: positions only, the layout lane of the .meta.json.
  'artboard.tidy': TSX(
    'Sort the selected artboards left to right by x; give them all the largest y; keep the first x and set each next x = previous x + width + gap (gap = the mean of today’s edge-to-edge gaps, 80 when boards overlap), in layout.artboards[] of the .meta.json — see canvas-tsx.md § Tidy up artboards'
  ),
  // S2.10 — the artboard menu. A copy is a splice of the DCArtboard's JSX; its place is layout.artboards[].
  'artboard.duplicate': TSX(
    'Copy the DCArtboard’s JSX right after it with a new id (desktop → desktop-2), a new label (Desktop → Desktop 2) and no data-cd-id or data-cd-locked inside; put it at the source’s right edge + the row’s gap in layout.artboards[] of the .meta.json — see canvas-tsx.md § Duplicate an artboard'
  ),
  'artboard.duplicate-at-width': TSX(
    'Copy the DCArtboard’s JSX right after it with a new id (desktop-390), the label “<label> (390px)”, that width prop and no data-cd-id or data-cd-locked inside; add its layout.artboards[] position beside the source — see canvas-tsx.md § Duplicate an artboard'
  ),
  // S7.22 — safe zones: a plain string prop; the bands are drawn on the canvas only and no exporter paints them.
  'artboard.set-safe-zones': TSX(
    'Set the DCArtboard’s safeZones prop to one preset id — instagram-story, instagram-reels, instagram-grid, tiktok, youtube-shorts or facebook-event-cover — or remove the prop for none; whether the bands are drawn is the person’s own view state, not the file — see canvas-tsx.md § Artboard props that Maude 2 adds'
  ),
  'artboard.rename': TSX('Set the DCArtboard’s label prop (up to 80 characters; accents are kept)'),
  'artboard.reset-position': TSX(
    'Remove the artboard’s entry from layout.artboards[] in the .meta.json; it returns to its default-grid slot'
  ),
  'artboard.ask-ai': { effect: 'none', agent: human('ai-chat') },
  // S2.19 — ⌘/ on a selection: the person's way into the AI chat with a scope; an agent IS the chat
  'ai.ask-selection': { effect: 'none', agent: human('ai-chat'), minRole: 'edit' },
  // A5 lead (S2.2b): an agent does not rename ids — the references live in lanes it never writes
  // (_comments/, the board's hosts); `maude design check` reports the old id as id-lost.
  'element.set-id': {
    effect: 'project',
    agent: human(
      'keys',
      'ask the person to use Element id; an agent never rewrites the comments file'
    ),
  },
  // S4.11 — the stamp is the write: an agent that creates or rewrites an element gives it a readable id itself.
  'element.stamp': {
    effect: 'project',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/edit-op', method: 'POST' },
    agent: file(
      'canvas-tsx',
      'design:design',
      'Give the element a readable data-cd-id (kebab-case, unique on the canvas) so an arrow can point at it'
    ),
  },
  // S3.10a — `data-cd-link` is the one data-cd-* an agent may write (S3-links-format §8; checked by link-format ·
  // link-no-id · link-dangling). The studio writes it through POST /_api/edit-op (edit-ops/{set,clear}-link.ts).
  'element.set-link': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/edit-op', method: 'POST' },
    agent: file(
      'canvas-tsx',
      'design:design',
      'Add data-cd-link="#<artboard>" | "<canvas>.tsx#<artboard>" | "https://…" to the element, next to its data-cd-id (add an id if it has none)'
    ),
  },
  'element.clear-link': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/edit-op', method: 'POST' },
    agent: file('canvas-tsx', 'design:design', 'Remove the element’s data-cd-link attribute'),
  },
  'preview.back': NAV('<canvas> --mode preview'), // an agent opens the canvas it wants
  // S2.10c — the same result by hand: the board's JSX, its layout entry and its annotations go together.
  'artboard.trash': TSX(
    'Remove the <DCArtboard id="…"> element (canvas-tsx.md § Remove an artboard), its layout.artboards[] entry in the .meta.json and, in the .annotations.json, the annotations whose parentArtboard is it with what sits in its sections; the canvas keeps at least one artboard'
  ),
  // S11.8 — Inspector › Advanced, the code half. Copy code is the element's JSX read from the .tsx; Edit CSS as
  // text is the style props; Detach is `/_api/detach-component` (clone the definition, repoint ONE usage).
  'inspector.copy-code': {
    effect: 'none',
    agent: file(
      'canvas-tsx',
      'design:design',
      'Read the element’s JSX in the .tsx (find its data-cd-id)'
    ),
  },
  'inspector.edit-css-as-text': TSX(
    'Edit the element’s style={{…}} props in the .tsx, one declaration per property'
  ),
  'element.detach': TSX(
    'Copy the component definition under a new name and point this one instance at the copy; the other places keep the original'
  ),
  // S3.11 — the Inspect panel: Copy code is the clipboard (read the JSX from the .tsx instead); Edit ↵ is a view change.
  'inspect.copy-code': {
    effect: 'none',
    agent: file(
      'canvas-tsx',
      'design:design',
      'Read the element’s JSX in the .tsx (find its data-cd-id)'
    ),
  },
  'inspect.edit': NAV('<canvas>@<element> --mode edit'),
  'edit.copy-properties': PREF('the clipboard is the user’s; read the source instead'),
  'edit.paste-properties': TSX('Copy the style props from one element’s JSX to another'),
  'object.enter': NAV('<canvas>@<element>'),
  'object.step-out': NAV('<canvas>@<element>'),
  'object.select-child': NAV('<canvas>@<element>'),
  'object.select-parent': NAV('<canvas>@<element>'),
  'object.select-next': NAV('<canvas>@<element>'),
  'object.select-prev': NAV('<canvas>@<element>'),
  'object.remove': TSX('Delete the element’s JSX (a removed DCArtboard is parked in the trash)'),
  'object.nudge': TSX('Change the element’s position props'),
  // S2.6 — the object menu. Each is one edit-op on the canvas file; an agent edits the same JSX by hand.
  'object.frame': TSX(
    'Wrap the elements in a <div data-cd-id="frame" style={{display:"flex",flexDirection:"column"}}> at the first one; every element keeps its data-cd-id'
  ),
  'object.unframe': TSX(
    'Replace the frame with its children, in order; the frame’s own attributes go'
  ),
  'object.bring-front': TSX(
    'Move the element’s JSX after its last sibling (later siblings paint on top)'
  ),
  'object.bring-forward': TSX('Move the element’s JSX after the next sibling'),
  'object.send-backward': TSX('Move the element’s JSX before the previous sibling'),
  'object.send-back': TSX('Move the element’s JSX before its first sibling'),
  'object.lock': TSX(
    'Add or remove the data-cd-locked attribute on the element (shared by everyone)'
  ),
  'object.hide': TSX(
    'Set style.display to "none" and add data-cd-hidden="<previous display>"; Show restores it and drops the marker'
  ),
  'object.select-matching': PREF(
    'a selection in the person’s window; an agent greps the canvas for the same className and style'
  ),
  // S2.7 — the align bar and the rotate handle. Objects: set left / top on the element's inline style
  // (the same result by hand); artboards: set x / y in the canvas's .meta.json layout.
  'align.left': TSX(
    'Give every selected element the same left (the leftmost one’s); for artboards set the same x in .meta.json layout.artboards'
  ),
  'align.hcentre': TSX(
    'Centre every selected element on the middle of the selection’s horizontal extent (left = middle − width/2); artboards: x in .meta.json'
  ),
  'align.right': TSX(
    'Give every selected element the same right edge (left = rightmost edge − width); artboards: x in .meta.json'
  ),
  'align.top': TSX(
    'Give every selected element the same top (the highest one’s); artboards: y in .meta.json layout.artboards'
  ),
  'align.vmiddle': TSX(
    'Centre every selected element on the middle of the selection’s vertical extent (top = middle − height/2); artboards: y in .meta.json'
  ),
  'align.bottom': TSX(
    'Give every selected element the same bottom edge (top = lowest edge − height); artboards: y in .meta.json'
  ),
  'distribute.h': TSX(
    'Keep the leftmost and rightmost element; set left on those between so the gaps are equal; artboards: x in .meta.json'
  ),
  'distribute.v': TSX(
    'Keep the top and bottom element; set top on those between so the gaps are equal; artboards: y in .meta.json'
  ),
  'object.rotate': TSX(
    'Set rotate(<deg>) in the element’s style.transform, keeping any other transform functions'
  ),
  // S2.11 — layout. Place freely / constraints are inline CSS on the element; reordering is moving the
  // element's JSX among its siblings (their order IS the layout order).
  'object.place-freely': TSX(
    'Give the element style position: "absolute" with left, top, width and height (px) as it sits now; if its parent is static, give the parent position: "relative"'
  ),
  'object.reorder-earlier': TSX(
    'Move the element’s JSX one place earlier among its siblings (in an auto layout the order in the code is the order on the canvas)'
  ),
  'object.reorder-later': TSX(
    'Move the element’s JSX one place later among its siblings (in an auto layout the order in the code is the order on the canvas)'
  ),
  'object.reorder-to': TSX(
    'Move the element’s JSX before, after or inside another element; for a copy, duplicate it first (a copy keeps no data-cd-id)'
  ),
  'object.constrain': TSX(
    'On an element placed freely, keep the pinned edges: right/bottom instead of left/top (distance to the frame edge), both edges instead of a width; centre is calc(50% ± Npx); scale is percentages'
  ),
  'layout.set-gap': TSX(
    'Set style.gap on each frame to the same value: var(--space-N) when the system names that stop, else px; one edit for all the frames. Over HTTP: POST /_api/edit-op {file, op: "layout.set-gap", targets: [{artboard, element}…], params: {gap: {token: "--space-N"} | {px: n}}} — one write, one undo step, a locked or non-layout target refuses the whole request'
  ),
  'layout.convert-to-absolute': TSX(
    'Give each child position: "absolute" with left/top/width/height as rendered, and a static parent position: "relative" with its own width/height fixed if it would collapse; the children then no longer take part in the layout'
  ),
  // S2.12 — text in place, styles and the Czech ties
  'text.set': TSX(
    'Replace the element’s text child with the new copy (escape { } < > &). In a Czech element (lang="cs" on it or an ancestor) set the copy as Czech sets it: a no-break space (U+00A0) after every one-letter word (v k s z o u i a …) and „quotes“ — never inside a URL or `code`. Over HTTP: POST /_api/edit-op {file, op: "text.set", targets: [{artboard, element}], params: {text, before?, lang?}}'
  ),
  'text.set-language': TSX(
    'Set lang="<tag>" on the element (cs, en, sk, de, pl). For cs also set the copy as Czech sets it: U+00A0 after every one-letter word, „quotes“; other languages leave the copy alone. Over HTTP: POST /_api/edit-op {file, op: "text.set-language", targets, params: {lang}}'
  ),
  'text.set-case': TSX(
    'AA is style.textTransform "uppercase"; As typed removes it (write "none" when the element’s style sets a case). Over HTTP: POST /_api/edit-op {op: "text.set-case", params: {case: "upper"|"typed", explicit?}}'
  ),
  'text.use-style': TSX(
    'Give the element the style’s class from system/<ds>/components.json typeRoles (heading → t-heading), replacing any other t-* class, and take out its inline fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform and fontStyle so the style shows. Over HTTP: POST /_api/edit-op {op: "text.use-style", params: {role: "t-heading"}}'
  ),
  'text.reset-style': TSX(
    'Delete the inline fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform and fontStyle from the element’s style so its t-* class shows (params.props names fewer). Over HTTP: POST /_api/edit-op {op: "text.reset-style", params: {props?}}'
  ),
  'component.insert': TSX(
    'Add the component to the artboard (or the frame) as a linked instance: put its name in the file’s `import { … } from "@maude/ds"` once and write `<Button variant="primary">…</Button>` as the last child, with a data-cd-id. On a canvas whose meta has dsRev (left out of the system’s current revision) add data-ds-rev="head" to it. Names and variants: GET /_api/ds/components or system/<ds>/components.json. Over HTTP: POST /_api/edit-op {op: "component.insert", targets: [frame?], params: {component, variant?, text?, artboard?, at?: {x: number|"centre", y}}}'
  ),
  // S2.15 — pictures: plain `<img>` edits; the recipes are canvas-tsx.md § Place, replace and crop an image.
  'image.place': TSX(
    'Add <img src="assets/<sha8>.<ext>" alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> as the last child of the frame (import the file first with the asset import; src is always a flat assets/ name). On a frame or picture that already holds one picture, change only its src. On an artboard use position: "absolute", left: "0", top: "0" and put it first. Over HTTP: POST /_api/edit-op {op: "image.place", targets: [frame?], params: {asset | assets, mode: "fill" | "loose" | "fill-in-order" | "grid", artboard?, natural?: {w, h}, alt?}}'
  ),
  'image.crop': TSX(
    'Fill is objectFit: "cover"; Fit is objectFit: "contain"; Crop is "cover" + objectPosition: "X% Y%" + data-image-fit="crop", and past 100 % transform: "scale(Z)" with transformOrigin: "X% Y%" and overflow: "hidden" on the frame; Tile is a <div role="img" data-image-tile="assets/…" style={{ backgroundImage: "url(\\"assets/…\\")", backgroundRepeat: "repeat" }}>. Over HTTP: POST /_api/edit-op {op: "image.crop", targets: [picture], params: {fit?, zoom?, x?, y?}}'
  ),
  'image.replace': TSX(
    'Change the <img>’s src to the new assets/<sha8>.<ext> and remove its data-photo-edit (a per-use edit belongs to the old picture); keep the box, the fit and the alt. Over HTTP: POST /_api/edit-op {op: "image.replace", targets: [picture], params: {asset}}'
  ),
  // Registered, visible to no shell until S8.17 (Figma import) lands; its verb is S8's.
  'figma.make-editable': { effect: 'external', agent: cli('maude design import-figma') },
  // S8.12 — the Assets tab's ↵ on a picked tile: the same write as `image.place`, started from the tab. The agent edits the TSX.
  'assets.place': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/edit-op', method: 'POST' },
    agent: file(
      'canvas-tsx',
      'design:design',
      'Same as image.place: add <img src="assets/<sha8>.<ext>" alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /> to the selected frame, or first inside the selected artboard (position: "absolute", left: "0", top: "0"). Which files exist and where they are used: `maude design assets`. Over HTTP: POST /_api/edit-op {op: "image.place", targets: [frame?], params: {asset, mode: "fill" | "loose", artboard?}}'
    ),
  },
  'assets.details': {
    effect: 'none',
    agent: cli('maude design assets --usage <asset>'),
  },
  // S8.13 — Move to trash on an asset: the picture and its sidecars go to `_trash/` together (the manifest says where each
  // lives, so Trash and Undo bring them all back). Never a picture a canvas uses or an older version still shows.
  'assets.trash': {
    effect: 'project',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/assets/trash', method: 'POST' },
    agent: file(
      'canvas-tsx',
      'design:design',
      'Move assets/<name> and the sidecars that share its stem (<name>.photo.json, <stem>.<edit8>.photo.json, <name>.gen.json, transcripts) into <designRoot>/_trash/<stamp>__asset-<name>/ and write _trash-manifest.json {kind: "asset", asset, slug, trashed[]} beside them — only a picture no canvas uses and no older version shows (`maude design assets --not-used` lists them; nothing is listed until older versions are checked). Over HTTP: POST /_api/assets/trash {assets: ["assets/<name>"]} answers per item: moved, or used | kept-by-versions | checking'
    ),
  },
  'tool.create-default': TSX(
    'Add the element’s JSX at its default size: a frame or rectangle is 100 × 100 (see object.insert-shape), a text is a <p> with the words “Text”'
  ),
  'tool.crop': TSX('Crop a picture: see image.crop (objectPosition and transform on the <img>)'),
  'tool.components': TSX(
    'Place a component from the design system: see component.insert (write `<Name>` with `import { Name } from "@maude/ds"`)'
  ),
  // S2.17 — an instance: the same result by hand is in canvas-tsx.md § Instances of a design-system component
  'component.swap-variant': TSX(
    'Change `variant="…"` on the component (add or delete the attribute); a variant must be one system/<ds>/components.json lists for it. To change the component, rename the tag (open and close), import the new name from "@maude/ds" once and drop the old import when nothing else uses it — only between components that hold words (Button · Chip · Badge · Card · Callout). The words and style stay. Over HTTP: POST /_api/edit-op {op: "component.swap-variant", targets: [instance], params: {variant?: string|null, component?}}'
  ),
  'component.reset': TSX(
    'Set the instance’s words back to the master’s (the component name) and delete its inline style declarations that are not placement (position, left, right, top, bottom, inset, zIndex, transform, translate, rotate, margin) — delete the style attribute when none is left. variant, data-cd-id and placement stay. Over HTTP: POST /_api/edit-op {op: "component.reset", targets: [instance], params: {props?}}'
  ),
  'component.detach': TSX(
    'Replace the instance with the plain markup it renders to: the same tags, className, style (token references stay var(--…)) and words, the same data-cd-id, no @maude/ds component and no data-ds-rev; delete an import nothing uses any more. A local component’s usage: copy the definition under a new name and point that one usage at the copy (see element.detach). Over HTTP: POST /_api/edit-op {op: "component.detach", targets: [instance], params: {tree}} — tree is the rendered subtree {tag, attrs, kids}'
  ),
  'component.go-to-main': NAV('<design-system canvas>@<component>'),
  'text.detach-style': TSX(
    'Write the style’s values as inline style (fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform, fontStyle — keep any the element already sets) and delete its t-* class; the text looks the same and stops following the style. Over HTTP: POST /_api/edit-op {op: "text.detach-style", params: {values: {"font-size": "var(--type-xl)", …}}} — the values as the design system wrote them (tokens), not px'
  ),
  // ── view ──
  'view.panels': PREF(),
  'view.pin-panels': PREF(),
  'view.hidden-files': PREF(),
  // S11.9 — the left panel's Advanced switches: what this person SEES (kept on this Mac), and a selection
  // in their window. An agent addresses elements by id in the .tsx (`maude design canvas-rects`).
  'canvases.show-file-names': PREF('a second line under each canvas, in the person’s own view'),
  'layers.show-tags': PREF('tag and id after each layer’s name, in the person’s own view'),
  'layers.select-by-selector': PREF(
    'a selection in the person’s window; an agent finds elements with `maude design canvas-rects`'
  ),
  'view.design-system': { effect: 'none', agent: cli('maude design open --panel design-system') },
  'view.comments': COMMENTS,
  // S9.22 — the panel's filters are the verb's flags; an agent reads the same list the person sees.
  'comments.filter-open': { effect: 'none', agent: cli('maude design comments list --open') },
  'comments.filter-mine': { effect: 'none', agent: cli('maude design comments list --mine') },
  'comments.filter-resolved': {
    effect: 'none',
    agent: cli('maude design comments list --resolved'),
  },
  'comments.filter-all': { effect: 'none', agent: cli('maude design comments list --all') },
  'comments.open-thread': { effect: 'none', agent: cli('maude design comments list') },
  'history.open': { effect: 'none', agent: cli('maude design history list') },
  // S1.12b (V2-1.9 §5.11). Filtering is the person's own panel (human view-pref, as the contract
  // has it); an agent reads one version with `history show` (§5.11's `open --at` is not built),
  // Compare's words with `history diff`, and names with `history name` (shared — it prompts).
  'history.filter': PREF(
    'All · Named · Made by AI · People; the rows themselves: maude design history list'
  ),
  'history.view-version': { effect: 'none', agent: cli('maude design history show') },
  'history.compare': { effect: 'none', agent: cli('maude design history diff') },
  // S1.16 (V2-1.9 §5.9): one object's versions — the sticky / object menu's "Version history".
  'history.object': {
    effect: 'none',
    agent: cli('maude design history object <canvas> <artboard>/<id>'),
  },
  // S1.15: the picture compare (DiffView, before / after as ?sha= panes) is for looking — an agent reads the
  // same two versions as words with `history diff`.
  'history.compare-pictures': PREF('the same two versions as words: maude design history diff'),
  'history.name': {
    effect: 'shared',
    minRole: 'edit',
    agent: cli('maude design history name <canvas> <ref> "<name>"'),
  },
  // S1.13 (V2-1.9 §5.8 / §5.11): every restore is a new version over Now — destructive (it prompts),
  // one undo step, refused below edit by POST /_api/project/restore.
  'history.restore': RESTORE('maude design history restore <canvas> <ref>'),
  'history.restore-artboard': RESTORE(
    'maude design history restore <canvas> <ref> --artboard <id>'
  ),
  'history.restore-object': RESTORE(
    'maude design history restore <canvas> <ref> --element <artboard>/<id>'
  ),
  'history.go-back': RESTORE('maude design history restore <canvas> @last-good'),
  // S11.10 — the git half of Version history › Advanced. Each is the person's working tree or remote: an agent
  // runs git itself in the project folder, so these are human 'git' (decision:maude/v2-S11.10-git-actions-human).
  // `server` pins the route the button calls; the server refuses Can comment / Can view on every write.
  'history.branch-switch': GIT('/_api/git/checkout', 'git switch <branch>'),
  'history.new-branch': GIT('/_api/git/branch', 'git switch -c <branch>'),
  // a fetch moves remote refs only: the role matrix allows it for a viewer, so the fold hides it by role alone
  'history.fetch': GIT('/_api/git/fetch', 'git fetch', false),
  'history.publish': GIT('/_api/git/push', 'git push'),
  'history.save-with-note': GIT('/_api/git/commit', 'git commit -m "<note>"'),
  'history.open-pr': GIT('/_api/git/fold', 'gh pr create (or git merge locally)'),
  'history.discard-file': GIT('/_api/git/discard', 'git restore <file>'),
  'history.continue-draft': GIT('/_api/git/checkout', 'git switch <draft>'),
  // V2-1.5 §5.3: undo one accepted action by id, as a new version; a teammate's later edits are kept.
  'history.undo-action': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/project/undo', method: 'POST' },
    agent: cli('maude design history undo --action <id>'),
  },
  'view.exports': { effect: 'none', agent: cli('maude design exports list') },
  // V2-4.4a — the left panel's tabs and its Trash row are views; the data is files (assets/, _trash/).
  // `asset-sweep` reports what is in <designRoot>/assets/ and where each file is used — what the tab lists.
  'view.assets': { effect: 'none', agent: cli('maude design asset-sweep') },
  'view.layers-panel': { effect: 'none', agent: cli('maude design open --panel layers-panel') },
  // S1.17 — the Trash list is `trash list` (GET /_api/trash, the route the Trash view reads); restoring
  // one item is `trash restore <id>` (POST /_api/trash/restore, the Restore button's route and body).
  'view.trash': { effect: 'none', agent: cli('maude design trash list') },
  'trash.restore': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/trash/restore', method: 'POST' },
    agent: cli('maude design trash restore <id>'),
  },
  // S1.7b — clearing out deletes for good what the whole team could still restore: the OWNER
  // confirms it, never an agent (decision:maude/v2-lead-trash-clear-human-only). The server
  // refuses every role below owner (test/_role-refusals.ts).
  'trash.clear': {
    effect: 'project',
    minRole: 'owner',
    undo: 'none',
    server: { route: '/_api/trash/clear', method: 'POST' },
    agent: human(
      'clear-trash',
      'only the project owner, in the Trash view; nothing an agent may do'
    ),
  },
  'view.inspector': { effect: 'none', agent: cli('maude design open --panel inspector') },
  'view.timeline-keep-open': PREF(),
  'view.annotations': PREF(),
  'annotations.hide-resolved': PREF(
    'per-person view preference (C29); never written to the annotations'
  ),
  'view.layers': { effect: 'none', agent: cli('maude design open --panel layers') },
  'view.inspector-on-select': PREF(),
  'view.minimap': PREF(),
  'view.zoom-controls': PREF(),
  'view.print-guides': PREF(),
  'present.canvas': NAV('<canvas> --mode present'),
  'present.from-selection': NAV('<canvas> --mode present'),
  'present.from-start': NAV('<canvas> --mode present'),
  // S3.2b — an agent steps by opening the canvas in Present at the artboard it wants (`#<artboard>`);
  // the Pointer is a mouse gesture, human below.
  'present.next': NAV('<canvas>#<artboard> --mode present'),
  'present.prev': NAV('<canvas>#<artboard> --mode present'),
  // S3.5 — the agent writes the same keys the sheet does, in the canvas's .meta.json (V2-1.12 R6);
  // the studio's own writes go through PATCH /_api/present-meta, which refuses every role below edit.
  'present.order-notes': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/present-meta', method: 'PATCH' },
    agent: file(
      'canvas-meta',
      'design:design',
      'present.order / present.skip and artboardMeta.<id>.notes in the canvas .meta.json'
    ),
  },
  // S3.6b — needs a person and a second display; an agent can't open a window on one.
  'present.presenter-view': {
    effect: 'none',
    agent: human('native-window', 'needs a person and a second display'),
  },
  // S3.7b — in a cloud-linked project `maude design open <canvas> --mode present` also prints the link.
  'present.copy-link': { ...NAV('<canvas> --mode present'), minRole: 'edit' },
  'settings.theme': PREF(),
  // S11.13 — Settings › Advanced: this Mac's own preferences (prefs.json), not project state.
  'settings.reset-panel-layout': PREF('puts the panels back where they started; a UI preference'),
  'settings.reset-all': PREF(
    'puts this Mac’s Maude preferences back to a fresh Mac’s; keys and sign-ins stay'
  ),
  // S11.14 — Settings › Connections. A credential or a link is the person's: an agent never types a
  // token or picks an account. The routes are the existing ones; their classes are access/request.ts's
  // (`/_api/hub/link` + `/_api/cloud/detach` are session writes, attach + probe are `edit`).
  'connections.replace-hub-token': {
    effect: 'external',
    server: { route: '/_api/hub/link', method: 'POST' },
    agent: human('hub-link', 'the person pastes the new token; it is never handed to an agent'),
  },
  'connections.figma-test': {
    effect: 'external',
    minRole: 'edit',
    server: { route: '/_api/figma/probe', method: 'POST' },
    agent: human(
      'accounts',
      'spends the person’s Figma token; an agent imports with `maude design import-figma`'
    ),
  },
  'connections.cloud-project-connect': {
    effect: 'shared',
    minRole: 'edit',
    server: { route: '/_api/cloud/attach', method: 'POST' },
    agent: human('hub-link', 'links this folder to a cloud project under the person’s account'),
  },
  'connections.cloud-project-disconnect': {
    effect: 'shared',
    server: { route: '/_api/cloud/detach', method: 'POST' },
    agent: human('hub-link', 'unlinks this folder and forgets its stored sign-in'),
  },
  'settings.use-own-plugin-copy': PREF(
    'prefs.json ownPluginCopy: the AI chat loads your own plugin copy'
  ),
  'settings.experimental-teams': PREF(
    'prefs.json experimentalTeams: agent teams at the next AI session'
  ),
  'view.zoom-in': PREF(),
  'view.zoom-out': PREF(),
  'view.zoom-fit': PREF(),
  'view.zoom-actual': PREF(),
  'view.zoom-to-artboard': NAV('<canvas>#<artboard>'),
  'view.jump-artboard': NAV('<canvas>#<artboard>'),
  // ── tools ──
  'tool.select': PREF('a pointer mode'),
  'tool.hand': PREF('a pointer mode'),
  'tool.hand-hold': PREF('a pointer mode'),
  'tool.comment': COMMENT_ADD,
  'tool.pen': BOARD('Add a pen element to the canvas’s .annotations.json'),
  'tool.highlighter': BOARD('Add a highlighter element to the canvas’s .annotations.json'),
  'tool.shape': BOARD('Add a shape element to the canvas’s .annotations.json'),
  'tool.arrow': BOARD('Add an arrow element (with binds) to the .annotations.json'),
  'tool.sticky': BOARD('Add a sticky element to the canvas’s .annotations.json'),
  'tool.text': BOARD('Add a text element to the canvas’s .annotations.json'),
  'tool.section': BOARD('Add a section element to the canvas’s .annotations.json'),
  'tool.eraser': BOARD('Remove the elements from the canvas’s .annotations.json'),
  'tool.browse': PREF('a pointer mode'),
  'tool.rect': BOARD('Add a rect shape element to the canvas’s .annotations.json'),
  // S2.13 — Edit's Ellipse (More) draws a design shape in the TSX; Preview's Shape (`tool.shape`) stays the board's.
  'tool.ellipse': TSX(
    'Add a <div data-shape="ellipse"> with position: "absolute", left / top / width / height in px, borderRadius: "50%" and background: "var(--accent)" — see canvas-tsx.md § Draw a frame or a shape'
  ),
  // V2-4.5b — the toolbar slots derived from MODE_TOOLS (defs/tool.ts)
  'tool.frame': TSX(
    'Add a frame (a <div> with position: "absolute", left / top / width / height in px, background: "var(--bg-1)") to the artboard or the frame in the canvas .tsx; on empty canvas add a <DCArtboard kind="digital" fixed> with its place in layout.artboards[] — see canvas-tsx.md § Draw a frame or a shape'
  ),
  'tool.el-shape': TSX(
    'Add a <div data-shape="rectangle"> with position: "absolute", left / top / width / height in px and background: "var(--accent)" — see canvas-tsx.md § Draw a frame or a shape'
  ),
  'tool.line': TSX(
    'Add a <div data-shape="line"> with position: "absolute", left / top at the first point, width = the length, height: 0, borderTop: "2px solid var(--fg-0)", transform: rotate(<deg>) and transformOrigin: "0 0" — see canvas-tsx.md § Draw a frame or a shape'
  ),
  'tool.polygon': TSX(
    'Add a <div data-shape="polygon"> with position: "absolute", left / top / width / height in px, background: "var(--accent)" and clipPath: "polygon(…%)" — see canvas-tsx.md § Draw a frame or a shape'
  ),
  // Export area writes nothing to the file; an agent exports a region with the export verb.
  'tool.slice': { effect: 'none', agent: cli('maude design export') },
  'object.insert-shape': TSX(
    'Add a <div> (data-shape="rectangle|ellipse|line|polygon" for a shape) as the last child of the frame or artboard, position: "absolute" with left / top / width / height in px; give a static parent position: "relative" — see canvas-tsx.md § Draw a frame or a shape'
  ),
  'artboard.draw': TSX(
    'Add <DCArtboard id="artboard-N" label="Artboard N" kind="digital" width={w} height={h} fixed> and its x / y in layout.artboards[] of the .meta.json — see canvas-tsx.md § Draw a frame or a shape'
  ),
  'object.set-corner-radius': TSX(
    'Set style.borderRadius on the element: one value while the four corners are equal, four in CSS order (↖ ↗ ↘ ↙) when they differ; a --radius-* token as var(--radius-md); remove the border-*-radius longhands — see canvas-tsx.md § Corner radius'
  ),
  // S2.14 — the Pen: a path is a plain <svg>; Combine composes shapes inside one <svg> (non-destructive, Q6)
  'tool.el-pen': TSX(
    'Add <svg data-cd-id="path" data-shape="path" width viewBox style={{ position: "absolute", left, top, overflow: "visible", fill: "none", stroke: "var(--accent)", strokeWidth: "4px", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M…C…" /></svg> to the artboard or frame; the svg box is the path bounds and d is relative to it — see canvas-tsx.md § Draw a path'
  ),
  'object.insert-path': TSX(
    'Add the same <svg data-shape="path"> as the Pen tool writes (d in the box\'s own px, left / top its place in the frame) — see canvas-tsx.md § Draw a path'
  ),
  'path.edit': TSX(
    "Rewrite the d of the svg's <path>, then width, height, viewBox and style left / top to the new bounds so every point keeps its place — see canvas-tsx.md § Draw a path"
  ),
  'shape.combine.union': TSX(
    'Replace the shapes with one <svg data-shape="path" data-combine="union"> holding ONE <path d> of every outline (each wound clockwise), fillRule="nonzero" — see canvas-tsx.md § Combine shapes'
  ),
  'shape.combine.exclude': TSX(
    'Replace the shapes with one <svg data-shape="path" data-combine="exclude"> holding ONE <path d> of every outline, fillRule="evenodd" — see canvas-tsx.md § Combine shapes'
  ),
  'shape.combine.subtract': TSX(
    'Replace the shapes with one <svg data-shape="path" data-combine="subtract">: the bottom shape\'s <path mask="url(#id-mask)"> first, then <defs><mask> holding a white <rect> and the other shapes in black — see canvas-tsx.md § Combine shapes'
  ),
  'shape.combine.intersect': TSX(
    'Replace the shapes with one <svg data-shape="path" data-combine="intersect">: the bottom shape\'s <path clipPath="url(#id-clip-1)"> first, then <defs> with a <clipPath> per other shape (more than one nest <g clipPath>) — see canvas-tsx.md § Combine shapes'
  ),
  'tool.el-text': TSX('Add a text element to the artboard in the canvas .tsx'),
  'tool.image': TSX('Add an <img> (a project asset) to the artboard in the canvas .tsx'),
  'tool.inspect': PREF('a pointer mode'),
  'tool.pointer': {
    effect: 'none',
    agent: human('keys', 'the presenter’s own pointer; an agent has no mouse to show'),
  },
  'tool.stickers': BOARD('Add a sticker element to the canvas’s .annotations.json'),
  // S4.4: a template is a --board spec; the verb is the agent's door to the same expansion
  ...Object.fromEntries(
    TEMPLATES.map((t) => [
      `annotation.template-${t.id}`,
      {
        effect: 'project',
        agent: cli(`maude design annotate <canvas> --board ${t.id}`),
      } satisfies ActionDefAI,
    ])
  ),
  'mode.preview': NAV('<canvas> --mode preview'),
  // ── ui / timeline ──
  'ui.step-back': PREF('the user’s navigation history'),
  'ui.cycle-region': PREF('where the keyboard is in the window'),
  'timeline.play': PREF('playback'),
  'timeline.step': PREF('playback'),
  'timeline.to-start': PREF('playback'),
  'timeline.to-end': PREF('playback'),
  'timeline.prev-keyframe': PREF('playback'),
  'timeline.next-keyframe': PREF('playback'),
  // S7.9 — the timeline's edit gestures (one `clip.*` op each) and the 17-row clip menu. An agent writes the
  // same literal props in the canvas .tsx; `comment` and `generate` have a verb of their own.
  'timeline.trim': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Set the clip’s durationInFrames (later beats close up; the comp’s total follows the last clip)'
    )
  ),
  'timeline.move-clip': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Move a series beat before or after another (with its transition), or set a layer’s from'
    )
  ),
  'timeline.add-clips': VIDEO_OP(
    file(
      'canvas-tsx',
      'design:video-comp',
      'Add a <Sequence> with the media at the end (or between two beats); the total grows by its length'
    )
  ),
  'timeline.clip-menu.comment': {
    effect: 'none',
    minRole: 'comment',
    agent: cli('maude design comments add --as-ai'),
  },
  'timeline.clip-menu.generate': {
    effect: 'project',
    minRole: 'edit',
    agent: cli('maude design generate'),
  },
  'timeline.clip-menu.adjust': CLIP_MENU_TSX(
    'Set the clip’s playbackRate, volume, crop (<Reframe>) or filter props directly'
  ),
  'timeline.clip-menu.hide': CLIP_MENU_TSX(
    'Gate the clip’s body behind {false && …}; the tag and its time slot stay'
  ),
  'timeline.clip-menu.show': CLIP_MENU_TSX('Remove the {false && …} gate from the clip’s body'),
  'timeline.clip-menu.remove': CLIP_MENU_TSX(
    'Delete the clip’s <Sequence>; a series beat also shortens the comp’s total'
  ),
  'timeline.clip-menu.replace': CLIP_MENU_TSX(
    'Change the clip’s media src to a contained asset path'
  ),
  'timeline.clip-menu.mute': CLIP_MENU_TSX('Add muted to the clip’s <Video>'),
  'timeline.clip-menu.unmute': CLIP_MENU_TSX(
    'Remove muted (and volume={0}) from the clip’s <Video>'
  ),
  'timeline.clip-menu.detach-audio': CLIP_MENU_TSX(
    'Mute the <Video> and add an <Audio> Sequence with the same src and timing'
  ),
  'timeline.clip-menu.to-overlay': CLIP_MENU_TSX(
    'Move the beat out of the series into a standalone <Sequence from> at the same frames'
  ),
  'timeline.clip-menu.to-storyline': CLIP_MENU_TSX(
    'Move the standalone <Sequence> into the series as a beat'
  ),
  'timeline.clip-menu.layer-up': CLIP_MENU_TSX(
    'Reorder the standalone <Sequence>s: document order is the stacking order'
  ),
  'timeline.clip-menu.layer-down': CLIP_MENU_TSX(
    'Reorder the standalone <Sequence>s: document order is the stacking order'
  ),
  'timeline.clip-menu.earlier': CLIP_MENU_TSX(
    'Swap the beat with the one before it (with its transition); a layer moves up the stack'
  ),
  'timeline.clip-menu.later': CLIP_MENU_TSX(
    'Swap the beat with the one after it (with its transition); a layer moves down the stack'
  ),
  'timeline.clip-menu.replace-layer': CLIP_MENU_TSX('Change that layer’s media src'),
  'timeline.split': TSX('Split the clip into two sequences at the frame', 'design:video-comp'),
  'timeline.zoom-in': PREF(),
  'timeline.zoom-out': PREF(),
  'timeline.zoom-fit': PREF(),
  'timeline.loop-in': PREF('the loop range is playback state, never written to the file'),
  'timeline.loop-out': PREF('the loop range is playback state, never written to the file'),
  'timeline.loop-clear': PREF('the loop range is playback state, never written to the file'),
  'timeline.expand': PREF('the timeline island’s size; a per-person view preference'),
  'timeline.compact': PREF('the timeline island’s size; a per-person view preference'),
  'timeline.comment-mode': COMMENT_ADD,
  // ── export / share ──
  // S8.1c — the sheet's params are the CLI's flags: {scope, format, canvas, folder, region, at} ↔
  // `<format> --scope --canvas --folder --region x,y,w,h --at <sha>` (ExportSpec v2, S8-export-spec §5.7).
  'export.open': {
    effect: 'none',
    agent: cli(
      'maude design export <format> --scope selection|canvas|folder|project [--canvas <rel>] [--folder <rel>] [--region x,y,w,h] [--at <sha>]'
    ),
  },
  // S8.8 — the clipboard is the person's; an agent exports the same PNG to a file (`export png`) and reads it.
  'export.copy-png': {
    effect: 'none',
    agent: cli('maude design export png'),
  },
  'handoff.open': { effect: 'none', agent: cli('maude design handoff') },
  'export.rerun-last': {
    effect: 'project',
    agent: cli('maude design exports again <id>'),
  },
  // S8.4 — Retry <name>: only the items of one export that did not make it. The terminal path is the
  // panel's own route, and a job that is not yours is a missing one (V2-1.16 U1).
  'export.retry': {
    effect: 'project',
    minRole: 'comment',
    server: { route: '/_api/export-jobs/retry', method: 'POST' },
    agent: cli('maude design exports retry <id> [--item <id,…>]'),
  },
  'share.open': { effect: 'shared', agent: human('links') },
  // S9.20: where the hub has links, the owner's Copy link makes the project's link (POST); everyone
  // else copies the location, which grants nothing. Making a link is the owner's, refused there.
  'share.copy-link': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/links', method: 'POST' },
    agent: human('links'),
  },
  'share.link-settings': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/links/:id', method: 'PATCH' },
    agent: human('links'),
  },
  // S6.0c: uploads the whole project to the person's billed cloud account — the window only; the
  // studio refuses a POST without its Sec-Fetch-Site and the design hook denies one (human-only).
  'share.move-to-cloud': {
    effect: 'external',
    agent: human('billing', 'moves the project to the person’s billed Maude Cloud account'),
  },
  // S9.19 — owner-only, decided by the hub; routes/share.ts refuses a session without `invite` first.
  'share.invite': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/invites', method: 'POST' },
    agent: human('invite'),
  },
  'share.set-role': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/people/:id', method: 'PATCH' },
    agent: human('roles'),
  },
  'share.remove': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/people/:id/remove', method: 'POST' },
    agent: human('roles'),
  },
  'share.resend': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/invites/:id/resend', method: 'POST' },
    agent: human('invite'),
  },
  // S9.21 — asking for more access and granting it are a person's (an agent never asks on someone's
  // behalf, never answers for an owner). Ask is any role's (the hub answers an editor 409); the answer is
  // the owner's, refused below owner by routes/share.ts first and by the hub (`invite`) always.
  'share.ask-to-edit': {
    effect: 'shared',
    minRole: 'view',
    server: { route: '/_api/share/requests', method: 'POST' },
    agent: human('roles'),
  },
  'share.request-approve': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/requests/:id/approve', method: 'POST' },
    agent: human('roles'),
  },
  'share.request-decline': {
    effect: 'shared',
    minRole: 'owner',
    server: { route: '/_api/share/requests/:id/decline', method: 'POST' },
    agent: human('roles'),
  },
  // ── presence (S9.23) ──
  // Where people are is awareness, not a file: an agent reads the room through the studio, never writes
  // it. Go to is the view move `maude design open` already does; Bring everyone here is a person's
  // gesture to other people (the `summon` capability), so it is human.
  'presence.follow': {
    effect: 'none',
    agent: human('summon', 'a person watching another person’s camera'),
  },
  'presence.go-to': NAV('<canvas>#<artboard>'),
  'presence.bring-everyone': {
    effect: 'none',
    minRole: 'edit',
    agent: human(
      'summon',
      'moves other people’s cameras; the hub strips `summon` without the capability'
    ),
  },
  'presence.stop': { effect: 'none', agent: human('summon', 'ends a Follow or the spotlight') },
  // ── app / help / ai ──
  'settings.open': { effect: 'none', agent: cli('maude design open --panel settings') },
  'ai.chat': { effect: 'none', agent: human('summon') },
  // S11.2: opens the chat with words in the field; the agent writes the artboard itself, no verb needed
  'ai.ask-fill-artboard': { effect: 'none', agent: human('summon') },
  'help.shortcuts': { effect: 'none', agent: cli('maude design open --panel shortcuts') },
  'help.guides': HELP,
  // S6.15 (Q10): adds the two guide canvases on request — the person's own question to Help; an agent that wants the
  // guides' words reads the plugin docs, and an agent that wants a canvas makes one. Refused below edit by the route.
  'help.add-guides': {
    effect: 'project',
    minRole: 'edit',
    server: { route: '/_api/help/add-guides', method: 'POST' },
    agent: human(
      'onboarding',
      'Help › Help and guides adds the guide canvases to a project on request'
    ),
  },
  'ai.generate': { effect: 'external', agent: cli('maude design generate') },
  'ai.draw-mark': { effect: 'external', agent: cli('maude design draw-build') },
  // ── AI runs (S5.3, V2-1.15 §5.10). S5.4 built `maude design runs list|stop`: a terminal
  // Claude sees the busy artboards before it plans, and stops only its person's own runs. Keep
  // going / cancel are human by Q5. Run on a copy is a file edit — the `artboard-busy` deny names
  // it. No `server` field yet: rule 7 wants a per-role refusal row a role suite runs (S9's
  // access-local-gate); the routes are routes/ai.ts. ──
  // S9.24 — a conflict pick. The record is this Mac's `_state/conflicts/<slug>.json` (the held element,
  // `mine` = this Mac's version, `theirs` = the head's); the pick is an ordinary board edit an agent
  // makes in the board file, then drops the entry. The route refuses every role below edit.
  ...Object.fromEntries(
    (
      [
        [
          'keep-mine',
          'replace the element (same id) in <slug>.annotations.json with the record’s `mine`',
        ],
        ['keep-theirs', 'leave <slug>.annotations.json as it is'],
        [
          'keep-both',
          'add the record’s `mine` to <slug>.annotations.json under a NEW id, to the right of the element',
        ],
      ] as const
    ).map(([k, how]) => [
      `sync.conflict.${k}`,
      {
        effect: 'project',
        minRole: 'edit',
        undo: 'step',
        server: { route: '/_api/sync/conflicts/resolve', method: 'POST' },
        agent: file(
          'annotations',
          'design:whiteboard',
          `${how}; then remove that conflict from <designRoot>/_state/conflicts/<slug>.json`
        ),
      } satisfies ActionDefAI,
    ])
  ),
  'ai.runs.list': {
    effect: 'none',
    minRole: 'edit',
    agent: cli('maude design runs list'),
  },
  'ai.stop': {
    effect: 'project',
    minRole: 'edit',
    agent: cli('maude design runs stop <run>'),
  },
  'ai.run-on-copy': {
    effect: 'project',
    minRole: 'edit',
    agent: file(
      'canvas-tsx',
      'design:design',
      'Duplicate the busy DCArtboard beside it with a new id and edit the copy (skill section "AI runs and busy artboards")'
    ),
  },
  'ai.cancel-waiting': {
    effect: 'none',
    minRole: 'edit',
    agent: human('ai-chat'),
  },
  'ai.keep-going': {
    effect: 'project',
    minRole: 'edit',
    agent: human('ai-chat'),
  },
  'help.whats-new': { effect: 'none', agent: cli('maude design open --panel whats-new') },
  'help.tour': HELP,
  'help.intro': HELP,
  'help.sharing': HELP,
  'help.setup': HELP,
  'help.ai-readiness': HELP,
  'help.report-bug': { effect: 'shared', agent: human('report-bug') },
  // ── annotations (selection-scoped edits of the board file) ──
  'annotation.group': BOARD('Set a shared group id on the elements'),
  'annotation.ungroup': BOARD('Clear the elements’ group id'),
  'annotation.lock': BOARD('Toggle the elements’ locked field'),
  'annotation.duplicate': BOARD('Copy the elements with new ids, offset'),
  'annotation.to-front': BOARD('Move the elements to the end of the element order'),
  'annotation.forward': BOARD('Move the elements one step later in the element order'),
  'annotation.to-back': BOARD('Move the elements to the start of the element order'),
  'annotation.backward': BOARD('Move the elements one step earlier in the element order'),
  'annotation.copy': PREF('the clipboard is the user’s; read the annotations file instead'),
  'annotation.cut': BOARD('Remove the elements (the clipboard half is the user’s)'),
  'annotation.chain': BOARD('Add the next element bound to the selected one'),
  'annotation.edit-text': BOARD('Change the element’s text field'),
  'annotation.nudge': BOARD('Change the elements’ x / y'),
  'annotation.remove': BOARD('Remove the elements from the annotations file'),
  'annotation.resolve': BOARD(
    'Set the sticky’s resolved to { by, at } (the person’s name, an ISO UTC time); remove it to reopen'
  ),
  'annotation.fan-out': BOARD('Change the stacked stickies’ x / y so they sit in a row'),
  'annotation.to-comment': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    // The studio's route (POST /_api/annotations/to-comment, S4.7) is the person's door and the one place
    // minRole is enforced; its refusal row is in test/_role-refusals.ts (S4.13).
    server: { route: '/_api/annotations/to-comment', method: 'POST' },
    agent: file(
      'comments',
      'design:whiteboard',
      'Write the thread into the comments file with from { kind: sticky, … } set, and remove the sticky from the annotations file'
    ),
  },
  'annotation.fold': BOARD('Set the section’s folded to true; remove it to unfold'),
  // The agent IS the AI: what a person asks it about a selection, it reads from the board.
  'annotation.ask-ai': { effect: 'none', agent: cli('maude design read-annotations') },
  'annotations.trash-resolved': BOARD(
    'Remove the stickies whose resolved is set from the annotations file'
  ),
  'annotations.select-resolved': { effect: 'none', agent: cli('maude design read-annotations') },
  // S4.14 — people vote; the agent reads the result section. The doors are /_api/votes/start|end (edit).
  'annotations.start-vote': {
    effect: 'shared',
    minRole: 'edit',
    server: { route: '/_api/votes/start', method: 'POST' },
    agent: human(
      'vote',
      'the result section is in the annotations when it ends: `maude design read-annotations`'
    ),
  },
  'annotations.end-vote': {
    effect: 'shared',
    minRole: 'edit',
    server: { route: '/_api/votes/end', method: 'POST' },
    agent: human('vote', 'the counts and the result section: `maude design read-annotations`'),
  },
  'annotation.point-to': BOARD(
    'Set the arrow’s startHost / endHost to the new ab:<artboard> or el:<artboard>/<id> ref (with the name it is shown under) and move its start / end cache to where the host is'
  ),
  // ── native ──
  // V2-1.1 §5.9
  'project.new': { effect: 'project', agent: human('onboarding') },
  'project.pull-copy': {
    effect: 'project',
    agent: human(
      'accounts',
      'clones a GitHub project the signed-in person can read; an agent uses git itself'
    ),
  },
  'project.share-github': {
    effect: 'shared',
    agent: human(
      'accounts',
      'invites a GitHub user to the project repository under the person’s account'
    ),
  },
  'project.open': { effect: 'none', agent: human('native-window') },
  'home.open': { effect: 'none', agent: human('native-window') },
  // S6.4 — Home's own rows. Search across projects is navigation (V2-1.11 §5.1: the agent moves the person's
  // view with `maude design open`; it reads one project through `maude design index`, never the cross-project
  // index). Opening a cloud project that is not on this Mac is the person's hub link.
  'home.search': { effect: 'none', agent: cli('maude design open') },
  'cloud.open-remote': {
    effect: 'external',
    agent: human(
      'hub-link',
      'makes the person’s own copy of a cloud project on this Mac, then opens it'
    ),
  },
  // S6.8 — the person signs in to their own cloud account in their own browser; an agent never holds one.
  'home.signin': {
    effect: 'external',
    agent: human(
      'accounts',
      'opens the person’s browser on cloud.maude.sh; the credential reaches the Home server, never a page or an agent'
    ),
  },
  // S6.9 — the Advanced sheets on Home. A credential is typed (or approved in the browser) by the person; an
  // agent never holds one, and it already runs inside `maude` and Claude Code, so installing them is theirs.
  'hub.connect': {
    effect: 'external',
    agent: human(
      'hub-link',
      'signs the person in to a self-hosted team server (the password goes to the Home server once); an agent links a folder with `maude design link`'
    ),
  },
  'project.open-github': {
    effect: 'external',
    agent: human(
      'accounts',
      'opens a folder or a GitHub project as a tab; the GitHub token stays in Rust. An agent works inside the project it was started in'
    ),
  },
  'ai.connect': {
    effect: 'external',
    agent: human(
      'accounts',
      'the person’s own Claude sign-in in their browser; an agent is already running on one'
    ),
  },
  'cli.install': {
    effect: 'external',
    agent: human(
      'onboarding',
      'links the bundled maude into ~/.local/bin and adds the Claude Code plugin; an agent is already running through both'
    ),
  },
  'nav.home': { effect: 'none', agent: human('native-window') },
  // V2-4.2: a person's sign-in; an agent never picks an account.
  'account.switch': {
    effect: 'none',
    agent: human('native-window', 'the desktop app’s profiles; an agent never picks an account'),
  },
  // V2-3.9: the shell's tab bar — a person's window, never an agent's.
  'tab.close': { effect: 'none', agent: human('native-window') },
  'tab.next': { effect: 'none', agent: human('native-window') },
  'tab.prev': { effect: 'none', agent: human('native-window') },
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [
      `tab.select-${n}`,
      { effect: 'none', agent: human('native-window') },
    ])
  ),
  'tab.select-last': { effect: 'none', agent: human('native-window') },
  // S1.22b: the strip's tab overview and the tab menu's Rename… (a machine-local display name).
  'tab.overview': { effect: 'none', agent: human('native-window') },
  'tab.rename': {
    effect: 'none',
    agent: human(
      'native-window',
      'the name this Mac shows for a tab; the project files never change'
    ),
  },
  'app.check-updates': { effect: 'none', agent: human('native-window') },
  // ── AI chat (S5.7) ──
  // The chat is Claude Code on this Mac; an agent is already the AI, so these rows are the
  // person's way to drive the conversation list. `_chat/` is per-Mac runtime state (DDR-115),
  // never versioned and never synced, hence effect 'none'.
  'chat.new': { effect: 'none', agent: human('ai-chat') },
  'chat.rename': { effect: 'none', agent: human('ai-chat'), minRole: 'edit' },
  'chat.archive': { effect: 'none', agent: human('ai-chat'), minRole: 'edit' },
  'chat.trash': { effect: 'none', agent: human('ai-chat'), minRole: 'edit' },
  'chat.copy-transcript': { effect: 'none', agent: human('ai-chat') },
  // S5.12: the Advanced fold's rows. A row only takes the person to a setting (the settings themselves are the
  // chat session's config, per Mac and per chat); an agent sets them through its own session — human `ai-chat`.
  ...Object.fromEntries(
    ['ask-before', 'model', 'effort', 'fast-mode', 'show-in-chat', 'suggestions', 'raw-log'].map(
      (r) => [`chat.advanced.${r}`, { effect: 'none', agent: human('ai-chat') }]
    )
  ),
  // S5.5b — undoes accepted actions for everyone on a synced project: the `history undo` verb's
  // permission card (tier shared).
  'chat.undo': {
    effect: 'shared',
    minRole: 'edit',
    agent: cli('maude design history undo --chat <id>'),
  },
  // S5.10 — attaching is how a PERSON hands the AI a file or a folder; an agent already reads files
  // itself (and a folder grant is consent only the person can give).
  'ai.attach-files': { effect: 'project', minRole: 'edit', agent: human('ai-chat') },
  'ai.attach-folder': { effect: 'none', minRole: 'edit', agent: human('ai-chat') },
  'ai.attach-assets': { effect: 'none', minRole: 'edit', agent: human('ai-chat') },
  'ai.attach-screenshot': { effect: 'project', minRole: 'edit', agent: human('ai-chat') },
  // decision v2-S5-open-in-terminal-native: the Tauri command spawns Terminal; an agent already
  // runs in a shell and resumes a session with `claude --resume` itself.
  'chat.open-in-terminal': {
    effect: 'none',
    agent: human(
      'native-window',
      'opens the person’s Terminal; an agent runs `claude --resume <session>` in its own shell'
    ),
  },
  // ── design system (S10.2 engine, V2-1.6 §5.11). The verbs are S10.3's `maude design ds …`
  // (S10 §2.4); the routes are routes/ds.ts (S10.3), whose Q15 gates test/_role-refusals.ts
  // rows hold (S10.3b). ──
  'ds.publish': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/publish', method: 'POST' },
    agent: cli('maude design ds publish <ds> [--leave-out <canvas>…]'),
  },
  'ds.cancel-pending': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pending', method: 'POST' },
    agent: cli('maude design ds pending <ds> --cancel'),
  },
  // S10.7 — a token edited in place. One waiting edit in the system's pending changes (`tokens[<css>]`:
  // `<theme>: <value>`, `valueNames`, `darkFollows`; `expect[<css>]` = the entry's `at` you read, null when none),
  // then the same `ds publish` as any other change. A locked token answers `ds-token-locked`.
  'ds.set-token': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pending', method: 'POST' },
    agent: cli('maude design ds pending <ds> --set <file.json>'),
  },
  'ds.set-dark-follows': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pending', method: 'POST' },
    agent: cli('maude design ds pending <ds> --set <file.json>'),
  },
  // S10.10 — a component master edited in place: Corners · Fill · Text · Height are declaration patches in the
  // master's class rule (`components[<Master>][.<class>][<prop>]: {value}`), waiting like a token until the same
  // `ds publish`. An agent merges them with the same file; `from` instead pushes an element's own overrides.
  'ds.set-master': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pending', method: 'POST' },
    agent: cli('maude design ds pending <ds> --set <file.json>'),
  },
  // S10.16a — making a system (ds/make.ts; one route, an `action` in the body). A new system starts as an outline with
  // no published revision (head null); the AI writes each direction with `draft` (`{label?, tokens: {"--name": "v" |
  // {light, dark}}}`), the person picks one (`use`) or takes whole groups from others (`mix --take colour=c`), the
  // sections fill through the working files, and `done` publishes the first revision (a `make` log entry) and makes
  // it the project default. Nothing here reaches a canvas: a system being made has no followers.
  'ds.make': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/ds/make', method: 'POST' },
    agent: cli('maude design ds make <ds> [--label <name>]'),
  },
  'ds.draft': {
    effect: 'project',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/ds/make', method: 'POST' },
    agent: cli('maude design ds draft <ds> --direction <x> --tokens <file.json>'),
  },
  'ds.use-direction': {
    effect: 'project',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/ds/make', method: 'POST' },
    agent: cli('maude design ds use <ds> <x>'),
  },
  'ds.mix': {
    effect: 'project',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/ds/make', method: 'POST' },
    agent: cli('maude design ds mix <ds> <x> --take <group>=<y>…'),
  },
  'ds.make-done': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/ds/make', method: 'POST' },
    agent: cli('maude design ds done <ds> [--no-default]'),
  },
  'ds.keep-outside': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/ds/outside', method: 'POST' },
    agent: cli('maude design ds keep <ds>'),
  },
  'ds.undo-outside': {
    effect: 'destructive',
    minRole: 'edit',
    undo: 'none',
    server: { route: '/_api/ds/outside', method: 'POST' },
    agent: cli('maude design ds undo <ds>'),
  },
  'ds.pick': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pick', method: 'POST' },
    agent: cli('maude design ds pick <ds> <css> --use canvas|file'),
  },
  'ds.canvas-update': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/canvas', method: 'POST' },
    agent: cli('maude design ds canvas update <canvas>'),
  },
  'ds.canvas-leave': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/canvas', method: 'POST' },
    agent: cli('maude design ds canvas leave <canvas>'),
  },
  'ds.trash-token': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/trash', method: 'POST' },
    agent: cli('maude design ds trash <ds> <css> --replacement <css>'),
  },
  'ds.restore-token': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/restore', method: 'POST' },
    agent: cli('maude design ds restore <ds> <css>'),
  },
  'ds.clear-token': {
    effect: 'destructive',
    minRole: 'owner',
    undo: 'version',
    server: { route: '/_api/ds/clear', method: 'POST' },
    agent: cli('maude design ds clear <ds> <css>'),
  },
  // S10.6 — the Design system canvas: opening it is navigation (`maude design open` moves the
  // person's view). Light | Dark is the canvas's own viewing preference and writes nothing; an
  // agent sees the other mode by capturing the canvas URL with `&dsMode=dark`.
  'ds.open': NAV('<ds.path>/design-system.tsx'),
  // S10.8 — the entries into the review. Push an override: merge it into the system's pending changes,
  // then the same publish as any other change. Go to: navigation. Instance update: one edit on the
  // instance (data-ds-rev="head"), one ⌘Z.
  'ds.review-update': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/pending', method: 'POST' },
    agent: cli('maude design ds pending <ds> --set <file.json> then maude design ds publish <ds>'),
  },
  'ds.go-to': NAV('<ds.path>/design-system.tsx@<--token|Component>'),
  'ds.instance-update': {
    ...TSX(
      'Add data-ds-rev="head" to the instance’s element (right after its data-cd-id; overwrite the attribute if it has one); the rest of the canvas keeps its version. Over HTTP: POST /_api/edit-op {op: "ds.instance-update", targets: [instance]} — refused on a canvas that follows the system already'
    ),
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/edit-op', method: 'POST' },
  },
  // S10.13 — the project's default system (config.json), and the empty row's door: the sheet is the person's
  // three inputs; an agent makes a system with the verb (S10.16a builds the sub-verb).
  'ds.set-default': {
    effect: 'project',
    minRole: 'edit',
    undo: 'version',
    server: { route: '/_api/ds/default', method: 'POST' },
    agent: cli('maude design ds default <ds>'),
  },
  // S10.14 — the switch is one review and one kernel action (ds/switch.ts); the preview is a session-only URL
  // override of the canvas URL's `tokens=` / `components=` (canvas-url.js `dsPreview`), so an agent looks at another
  // system by screenshotting the canvas URL with that system's files.
  'ds.switch': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/switch', method: 'POST' },
    agent: cli('maude design ds switch <canvas|folder|--all> --to <ds> [--dry-run]'),
  },
  'ds.preview': {
    effect: 'none',
    agent: human(
      'view-pref',
      'a person looking at the project in another system (session-only, nothing stored); an agent screenshots the canvas URL with that system’s files: `&tokens=<ds.path>/colors_and_type.css&components=<ds.path>/preview/_components.css`'
    ),
  },
  'ds.set-theme-preview': {
    effect: 'none',
    agent: cli('maude design screenshot --url "<canvas-url>&dsMode=dark" --full --out <png>'),
  },
  // S10.17 — the edges. The contrast fix and a new colour are waiting edits (`maude design ds pending` is the general
  // door; these two verbs are the one-step forms the buttons are); the substitution is an edit on the canvas.
  // `maude design ds nearest` / `off-system` are the questions behind the trash sheet and the quiet question.
  'ds.fix-contrast': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/fix-contrast', method: 'POST' },
    agent: cli('maude design ds fix-contrast <ds> <css> [--theme <t>] [--dry-run]'),
  },
  'ds.add-colour': {
    effect: 'project',
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/ds/add-colour', method: 'POST' },
    agent: cli('maude design ds add-colour <ds> <colour> [--label <name>] [--css <--x-name>]'),
  },
  'ds.use-nearest': {
    ...TSX(
      'Replace the hand-picked colour literal with var(--token) at the place `maude design ds off-system <canvas>` names (line, col). Over HTTP: POST /_api/edit-op {op: "ds.use-nearest", targets: [element], params: {literal, css, line, col}} — refused when the colour is no longer at that place'
    ),
    minRole: 'edit',
    undo: 'step',
    server: { route: '/_api/edit-op', method: 'POST' },
  },
  // S10.9 — the rings are a picture; the places behind them are the usage index, which the verb reads
  // (`--json` carries the canvases, artboards and element ids the view rings).
  'ds.show-reach': {
    effect: 'none',
    agent: cli('maude design ds usage <ds> --css <--token> --json'),
  },
};
