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
// S9.7b — the comment TOOL's agent path is the write verb: an agent leaves a comment by posting it
// (`POST /_api/comments/op`, as the session, AI-written). The action itself only picks a tool
// (fromCanvas ⇒ effect none); the verb's own tier is shared → prompt (verbs.ts).
const COMMENT_ADD: ActionDefAI = {
  effect: 'none',
  agent: cli('maude design comments add --as-ai'),
};
const HELP: ActionDefAI = { effect: 'none', agent: human('onboarding') };

export const AGENT_PATHS: Readonly<Record<ActionId, ActionDefAI>> = {
  // ── diagnostics (V2-4.7b) ──
  'diag.sync': { effect: 'none', agent: cli('maude design status') },
  'diag.server': { effect: 'none', agent: cli('maude design status') },
  'diag.ai': { effect: 'none', agent: cli('maude doctor') },
  'diag.ai-recheck': { effect: 'none', agent: cli('maude doctor') },
  'diag.logs': {
    effect: 'none',
    agent: human('view-pref', 'opens the log sheet; the files sit in ~/.maude/logs'),
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
  'sync.resync': {
    effect: 'shared',
    agent: human('hub-link', 'restarts the sync link; read its state with `maude design status`'),
  },
  'sync.download-all': {
    effect: 'none',
    agent: human('hub-link', 'pulls every file of a linked project onto this Mac'),
  },
  // ── search ──
  'search.open': { effect: 'none', agent: cli('maude design index') },
  'canvases.search': { effect: 'none', agent: cli('maude design index') },
  'canvases.find': { effect: 'none', agent: cli('maude design index') },
  'canvases.refresh': { effect: 'none', agent: cli('maude design index') },
  // ── canvas ──
  'canvas.new': TSX('Write a new .tsx under the design root with a DCArtboard per screen'),
  'canvas.duplicate': TSX('Copy the .tsx and its .meta.json under a new name in the same folder'),
  'canvas.rename': TSX('Rename the .tsx and its .meta.json together'),
  'canvas.move': TSX('Move the .tsx and its .meta.json to another folder under the design root'),
  // S1.2 — the row menu's other rows. The link is the canvas's address (`maude design open <canvas>` moves
  // the person's view to it). Trash: until S1.17's `maude design trash`, an agent parks the files the way
  // `DELETE /_api/canvas` does, and the Trash lists them from the manifest.
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
  'import.figma': { effect: 'external', agent: cli('maude design import-figma') },
  'import.brand': { effect: 'project', agent: cli('maude design import-brand') },
  'view.advanced-open-all': PREF('opens every panel’s Advanced fold; a UI preference'),
  'view.advanced-close-all': PREF('folds every panel’s Advanced section; a UI preference'),
  'canvas.reload': PREF('reloads the user’s view; the studio reloads on every file change'),
  'canvas.new-video': TSX('Write a new video-comp .tsx canvas', 'design:video-comp'),
  'canvas.close': PREF('closes the user’s tab'),
  'video.assemble': {
    effect: 'project',
    agent: file('edl', 'design:footage-director', 'Write the <slug>.edl.json cut, then the comp'),
  },
  'artboard.new-desktop': TSX('Add a DCArtboard sized 1440×1024'),
  'artboard.new-laptop': TSX('Add a DCArtboard sized 1280×800'),
  'artboard.new-tablet': TSX('Add a DCArtboard sized 834×1194'),
  'artboard.new-mobile': TSX('Add a DCArtboard sized 390×844'),
  'artboard.new-a4': TSX('Add a DCArtboard kind="print" sized A4'),
  'artboard.new-letter': TSX('Add a DCArtboard kind="print" sized Letter'),
  // ── edit / select / object ──
  'edit.undo': UNDO_KEYS,
  'edit.redo': UNDO_KEYS,
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
  'element.set-id': TSX(
    'Change the data-cd-id literal on the element and every place that refers to it; ids stay unique and kebab-case'
  ),
  'edit.copy-properties': PREF('the clipboard is the user’s; read the source instead'),
  'edit.paste-properties': TSX('Copy the style props from one element’s JSX to another'),
  'object.enter': NAV('<canvas>@<element>'),
  'object.step-out': NAV('<canvas>@<element>'),
  'object.select-child': NAV('<canvas>@<element>'),
  'object.select-parent': NAV('<canvas>@<element>'),
  'object.select-next': NAV('<canvas>@<element>'),
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
  // ── view ──
  'view.panels': PREF(),
  'view.pin-panels': PREF(),
  'view.hidden-files': PREF(),
  'view.design-system': PREF('read system/<ds>/ for the design system itself'),
  'view.comments': COMMENTS,
  'history.open': { effect: 'none', agent: cli('maude design history list') },
  'view.exports': { effect: 'none', agent: cli('maude design exports list') },
  // V2-4.4a — the left panel's tabs and its Trash row are views; the data is files (assets/, _trash/).
  // `asset-sweep` reports what is in <designRoot>/assets/ and where each file is used — what the tab lists.
  'view.assets': { effect: 'none', agent: cli('maude design asset-sweep') },
  'view.layers-panel': PREF('puts Layers in the left panel or in the Inspector'),
  'view.trash': PREF('shows the Trash list; the parked files are under <designRoot>/_trash/'),
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
  'view.inspector': PREF('read the element’s JSX for its properties'),
  'view.timeline-keep-open': PREF(),
  'view.annotations': PREF(),
  'view.layers': PREF('read the canvas source for its structure'),
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
  'settings.theme': PREF(),
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
  'tool.ellipse': BOARD('Add an ellipse shape element to the canvas’s .annotations.json'),
  // V2-4.5b — the toolbar slots derived from MODE_TOOLS (defs/tool.ts)
  'tool.frame': TSX('Add a frame (a <div>) to the artboard in the canvas .tsx'),
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
  'timeline.play': PREF('playback'),
  'timeline.step': PREF('playback'),
  'timeline.to-start': PREF('playback'),
  'timeline.to-end': PREF('playback'),
  'timeline.prev-keyframe': PREF('playback'),
  'timeline.next-keyframe': PREF('playback'),
  'timeline.undo': UNDO_KEYS,
  'timeline.redo': UNDO_KEYS,
  'timeline.split': TSX('Split the clip into two sequences at the frame', 'design:video-comp'),
  'timeline.zoom-in': PREF(),
  'timeline.zoom-out': PREF(),
  'timeline.zoom-fit': PREF(),
  'timeline.comment-mode': COMMENT_ADD,
  // ── export / share ──
  'export.open': { effect: 'none', agent: cli('maude design export') },
  'handoff.open': { effect: 'none', agent: cli('maude design handoff') },
  'export.canvas-dialog': { effect: 'none', agent: cli('maude design export') },
  'export.rerun-last': {
    effect: 'project',
    agent: cli('maude design exports again <id>'),
  },
  'share.open': { effect: 'shared', agent: human('links') },
  'share.copy-link': { effect: 'none', agent: human('links') },
  // ── app / help / ai ──
  'settings.open': PREF('settings are the user’s'),
  'ai.chat': { effect: 'none', agent: human('summon') },
  'help.shortcuts': HELP,
  'help.guides': HELP,
  'ai.generate': { effect: 'external', agent: cli('maude design generate') },
  'ai.draw-mark': { effect: 'external', agent: cli('maude design draw-build') },
  // ── AI runs (S5.3, V2-1.15 §5.10). S5.4 built `maude design runs list|stop`: a terminal
  // Claude sees the busy artboards before it plans, and stops only its person's own runs. Keep
  // going / cancel are human by Q5. Run on a copy is a file edit — the `artboard-busy` deny names
  // it. No `server` field yet: rule 7 wants a per-role refusal row a role suite runs (S9's
  // access-local-gate); the routes are routes/ai.ts. ──
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
  'help.whats-new': HELP,
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
  'annotation.copy': PREF('the clipboard is the user’s; read the board file instead'),
  'annotation.cut': BOARD('Remove the elements (the clipboard half is the user’s)'),
  'annotation.chain': BOARD('Add the next element bound to the selected one'),
  'annotation.edit-text': BOARD('Change the element’s text field'),
  'annotation.nudge': BOARD('Change the elements’ x / y'),
  'annotation.remove': BOARD('Remove the elements from the board file'),
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
};
