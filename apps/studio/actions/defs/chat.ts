// actions/defs/chat.ts — the AI chat's own commands (S5.7; contract S5-slices.md rows S5.7 / S5.12).
// The chat list row's ⋯ menu, the header's New chat, and Advanced's Open in terminal. All are
// row- or panel-level: none has a key, none belongs in ⌘K without a chat in hand (`hidden`), and
// none is a menu-bar item.
//
// The chat runs Claude Code on THIS Mac, so every one is the desktop app's (`ai.chat`'s rule).
// The three that change a chat's sidecar (`chat.rename`, `chat.archive`, `chat.trash`) are
// hidden below Can edit — the server refuses the same writes in a read-only session
// (routes/chat.ts, `readOnly: 'refused'`; rule 12: hidden ≠ refused).
//
// `chat.open-in-terminal` is native: the Tauri command `chat_open_in_terminal` runs
// `claude --resume <session>` in Terminal (decision v2-S5-open-in-terminal-native). No studio
// HTTP route spawns anything, and a browser tab has no such command — the row is absent there
// (`visible`) and `client/v2/ai/chat-store-api.js` refuses the call by the same predicate.

import type { ActionDef, Pred } from '../types.ts';

const DESKTOP: Pred = { shell: ['desktop'] };
const DESKTOP_EDIT: Pred = { shell: ['desktop'], minRole: 'edit' };
const ROW = { hidden: true } as const;
const ADVANCED_WHERE = 'AI chat panel › Advanced';

function advanced(id: string, label: string, keywords: string[]): ActionDef {
  return {
    id: `chat.advanced.${id}`,
    label,
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP,
    search: { keywords, where: ADVANCED_WHERE },
  };
}

export const CHAT_ACTIONS: ActionDef[] = [
  {
    id: 'chat.new',
    label: 'New chat',
    kind: 'command',
    icon: 'plus',
    exec: 'shell',
    visible: DESKTOP,
    search: ROW,
  },
  {
    id: 'chat.rename',
    label: 'Rename…',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'chat.archive',
    label: 'Archive',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    // CONTRACT §4: the dialog asks with the verb the button carries —
    // Move "Three reel covers" to the trash? · **Move to trash**
    id: 'chat.trash',
    label: 'Move to trash',
    kind: 'command',
    icon: 'trash',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    // S5.5b (V2-1.5 §5.3) — the chat row ⋯ menu and Version history's AI row: every action this
    // person's AI made in the chat, undone as ONE new version (POST /_api/project/undo {chatId}).
    // An old team server answers `needs-hub-update` and the row is disabled with its line.
    id: 'chat.undo',
    label: 'Undo this chat',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'chat.copy-transcript',
    label: 'Copy transcript',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP,
    search: ROW,
  },
  {
    id: 'chat.open-in-terminal',
    label: 'Open in terminal',
    kind: 'command',
    exec: 'native',
    // 'native' = the Tauri shell (ctx.ts adds the fact for desktop windows only).
    visible: { shell: ['desktop'], facts: ['native'] },
    // ⌘K finds it from the Advanced fold (S5.12); a chat is always in hand there.
    search: { keywords: ['terminal', 'resume', 'claude'], where: ADVANCED_WHERE },
  },
  // S5.12 — the rows of the AI chat panel's Advanced fold, findable by name in ⌘K ("AI chat panel ›
  // Advanced"). Picking one opens the panel and the fold and takes that row (client/v2/ai/advanced-handlers.js).
  // They change nothing by themselves — each is "go to that setting" — so none has a key or a menu home.
  advanced('ask-before', 'Ask before', [
    'mode',
    'permission',
    'plan',
    'suggest only',
    'bypass',
    'auto',
  ]),
  advanced('model', 'Model', ['opus', 'sonnet', 'haiku', 'claude']),
  advanced('effort', 'Effort', ['thinking', 'think harder', 'low', 'high']),
  advanced('fast-mode', 'Fast mode', ['fast', 'speed']),
  advanced('show-in-chat', 'Show in chat', ['verbose', 'thinking', 'transcript', 'detail', 'view']),
  advanced('suggestions', 'Suggestions', ['chips', 'suggest', 'quick']),
  advanced('raw-log', 'Raw log', ['tool log', 'tools', 'calls', 'debug', 'log']),
  // ── S5.10: the paperclip's four ways in (03 `ai-attach-menu`). Row-level, in the prompt. ──
  // Each writes (Assets, or this Mac's `_chat/` / `_state/`), so below Can edit they are hidden
  // and routes/chat-attach.ts refuses them (`readOnly: 'refused'`).
  {
    id: 'ai.attach-files',
    label: 'Attach files…',
    kind: 'command',
    icon: 'file',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    // The folder picker is the desktop app's (a browser hands over no folder path): absent in a
    // browser tab, and the server refuses a path it can't resolve to a real folder anyway.
    id: 'ai.attach-folder',
    label: 'Choose a folder…',
    kind: 'command',
    icon: 'folder',
    exec: 'shell',
    visible: { shell: ['desktop'], minRole: 'edit', facts: ['native'] },
    search: ROW,
  },
  {
    id: 'ai.attach-assets',
    label: 'From Assets',
    kind: 'command',
    icon: 'image',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
  {
    id: 'ai.attach-screenshot',
    label: 'Paste a screenshot',
    kind: 'command',
    exec: 'shell',
    visible: DESKTOP_EDIT,
    search: ROW,
  },
];
