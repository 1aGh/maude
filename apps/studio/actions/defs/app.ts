// actions/defs/app.ts — settings, the AI chat panel and help (V2-2.4: v1 bindings under their
// v2 ids).

import type { ActionDef } from '../types.ts';
import { kb, mods, SHELL_FOCI, SHELL_NOT_TYPING } from './_v1.ts';

export const APP_ACTIONS: ActionDef[] = [
  {
    id: 'settings.open',
    label: 'Settings…',
    kind: 'command',
    icon: 'sliders',
    exec: 'shell',
    // v1: shell only (never forwarded); a viewer's ⌘, is swallowed and does nothing.
    keys: [kb('⌘,', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
    legacy: { palette: 'Settings…', menu: 'Settings…' },
  },
  {
    // V2-4.2 / V2-3.8: this project signs in as someone else. The shell moves the project onto a
    // profile of its own (`cloud_sign_in_prepare`) and reloads signed out; the person then signs in
    // from the Share panel as usual. V2-4.8a: a CLOUD tab has it too — there it ends the browser session
    // (the v1 menubar's account chip + "Sign out", Cloud Phase 27 C4: who you are, and how to stop
    // being them) and the hub asks for a sign-in again; the row shows the account's email.
    id: 'account.switch',
    label: 'Sign in as another account…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'cloud'] },
  },
  {
    id: 'ai.chat',
    label: 'AI chat',
    kind: 'toggle',
    icon: 'sparkle',
    exec: 'shell',
    // CONTRACT §2: ⌘/ is Ask AI (the AI chat panel, selection attached). v1's ⇧⌘A Assistant moved
    // here with V2-4.5b (rule 13; v2's ⇧⌘A is Select all annotations). Desktop only, as v1.
    keys: [kb('⌘/', 'global', { inText: true, when: { focus: SHELL_FOCI, facts: ['native'] } })],
    legacy: { menu: 'Assistant' },
  },
  {
    id: 'help.shortcuts',
    label: 'Keyboard shortcuts',
    kind: 'toggle',
    icon: 'help',
    exec: 'shell',
    // v1 `e.key === '?'` — ⇧⌘/ produces '?' too.
    keys: [
      kb('?', 'global', { inText: false, when: SHELL_NOT_TYPING }),
      kb('⌘?', 'global', { inText: false, alias: true, when: SHELL_NOT_TYPING }),
    ],
    legacy: {
      palette: 'Keyboard shortcuts',
      menu: 'Keyboard shortcuts',
      sheet: 'This cheat sheet · help',
    },
  },
  {
    id: 'help.guides',
    label: 'Help and guides',
    kind: 'command',
    icon: 'help',
    exec: 'shell',
    // v1 `e.key === 'F1'` with any modifier.
    keys: mods('F1', '⌥⇧⌘', 'global', { inText: false, when: SHELL_NOT_TYPING }),
    legacy: {
      palette: 'Help · commands & flows',
      menu: 'Help · commands & flows',
      sheet: 'This cheat sheet · help',
    },
  },
  // ── no key in v1: ⌘K / menu entries ──
  {
    id: 'ai.generate',
    label: 'Generate with AI…',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    legacy: { palette: 'Generate with AI…', menu: 'Generate with AI…' },
  },
  {
    id: 'ai.draw-mark',
    label: 'Draw a mark',
    kind: 'command',
    icon: 'pen',
    exec: 'shell',
    legacy: { palette: 'Draw a mark with the SVG agent' },
  },
  {
    id: 'help.whats-new',
    label: "What's new",
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    legacy: { palette: "What's new in maude", menu: "What's new" },
  },
  {
    id: 'help.tour',
    label: 'Take the tour',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Take the tour' },
  },
  {
    id: 'help.intro',
    label: 'Watch the intro',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Watch the intro' },
  },
  {
    id: 'help.sharing',
    label: 'How sharing works',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'How sharing works' },
  },
  {
    id: 'help.setup',
    label: 'Set up Maude…',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Quick setup' },
  },
  {
    id: 'help.ai-readiness',
    label: 'Check AI setup again',
    kind: 'command',
    exec: 'shell',
    legacy: { menu: 'Check AI editing readiness…' },
  },
  {
    id: 'help.report-bug',
    label: 'Report a bug…',
    kind: 'command',
    icon: 'help',
    exec: 'shell',
    // Also the desktop app's Help ▸ Report a Bug… (native-menu.ts; the menu sends
    // `menu://action {id:'help.report-bug'}` and the webview runs the palette's row — V2-3.4).
    native: { menu: 'Help', order: 1 },
    legacy: { palette: 'Report a bug…', menu: 'Report a bug…' },
  },
];
