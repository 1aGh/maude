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

import type { ActionDefAI, ActionId, AgentPath, HumanReason } from './types.ts';

const file = (
  format: Extract<AgentPath, { path: 'file' }>['format'],
  skill: Extract<AgentPath, { path: 'file' }>['skill'],
  how: string
): AgentPath => ({ path: 'file', format, skill, how });
const cli = (verb: string): AgentPath => ({ path: 'cli', verb });
const human = (because: HumanReason, note?: string): AgentPath =>
  note ? { path: 'human', because, note } : { path: 'human', because };
const pending = (pkg: string, want: AgentPath): ActionDefAI['agent'] => ({
  path: 'pending',
  package: pkg,
  want,
});

const NAV = (note: string): ActionDefAI => ({
  effect: 'none',
  agent: pending('V2-2.4b open', { path: 'cli', verb: `maude design open ${note}` }),
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
const HISTORY: ActionDefAI = {
  effect: 'none',
  agent: pending('S1', cli('maude design history')),
};
const COMMENTS: ActionDefAI = {
  effect: 'none',
  agent: pending('S9', cli('maude design comments')),
};
const HELP: ActionDefAI = { effect: 'none', agent: human('onboarding') };

export const AGENT_PATHS: Readonly<Record<ActionId, ActionDefAI>> = {
  // ── search ──
  'search.open': { effect: 'none', agent: cli('maude design index') },
  'canvases.search': { effect: 'none', agent: cli('maude design index') },
  'canvases.find': { effect: 'none', agent: cli('maude design index') },
  'canvases.refresh': { effect: 'none', agent: cli('maude design index') },
  // ── canvas ──
  'canvas.new': TSX('Write a new .tsx under the design root with a DCArtboard per screen'),
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
  'edit.undo': HISTORY,
  'edit.redo': HISTORY,
  'edit.copy': PREF('the clipboard is the user’s; read the source instead'),
  'select.all': NAV('<canvas>'),
  'select.none': NAV('<canvas>'),
  'select.all-annotations': NAV('<canvas>'),
  'object.duplicate': TSX('Copy the element’s JSX next to it; give the copy a new element id'),
  'edit.copy-properties': PREF('the clipboard is the user’s; read the source instead'),
  'edit.paste-properties': TSX('Copy the style props from one element’s JSX to another'),
  'object.select-child': NAV('<canvas>@<element>'),
  'object.select-parent': NAV('<canvas>@<element>'),
  'object.select-next': NAV('<canvas>@<element>'),
  'object.remove': TSX('Delete the element’s JSX (a removed DCArtboard is parked in the trash)'),
  'object.nudge': TSX('Change the element’s position props'),
  // ── view ──
  'view.panels': PREF(),
  'view.hidden-files': PREF(),
  'view.design-system': PREF('read system/<ds>/ for the design system itself'),
  'view.comments': COMMENTS,
  'history.open': HISTORY,
  'view.inspector': PREF('read the element’s JSX for its properties'),
  'view.timeline-keep-open': PREF(),
  'view.annotations': PREF(),
  'view.layers': PREF('read the canvas source for its structure'),
  'view.inspector-on-select': PREF(),
  'view.minimap': PREF(),
  'view.zoom-controls': PREF(),
  'view.print-guides': PREF(),
  'present.canvas': NAV('<canvas> --mode present'),
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
  'tool.comment': COMMENTS,
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
  // ── ui / timeline ──
  'ui.step-back': PREF('the user’s navigation history'),
  'timeline.play': PREF('playback'),
  'timeline.step': PREF('playback'),
  'timeline.to-start': PREF('playback'),
  'timeline.to-end': PREF('playback'),
  'timeline.prev-keyframe': PREF('playback'),
  'timeline.next-keyframe': PREF('playback'),
  'timeline.undo': HISTORY,
  'timeline.redo': HISTORY,
  'timeline.split': TSX('Split the clip into two sequences at the frame', 'design:video-comp'),
  'timeline.zoom-in': PREF(),
  'timeline.zoom-out': PREF(),
  'timeline.zoom-fit': PREF(),
  'timeline.comment-mode': COMMENTS,
  // ── export / share ──
  'export.open': { effect: 'none', agent: cli('maude design export') },
  'handoff.open': { effect: 'none', agent: cli('maude design handoff') },
  'export.canvas-dialog': { effect: 'none', agent: cli('maude design export') },
  'export.rerun-last': {
    effect: 'project',
    agent: pending('S8', cli('maude design exports again')),
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
  'project.new': { effect: 'none', agent: human('native-window') },
  'project.open': { effect: 'none', agent: human('native-window') },
  'app.check-updates': { effect: 'none', agent: human('native-window') },
};
