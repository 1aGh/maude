// actions/defs/app.ts — settings, the AI chat panel and help (V2-2.4: v1 bindings under their
// v2 ids).

import type { ActionDef } from '../types.ts';
import { kb, mods, SHELL_FOCI, SHELL_NOT_TYPING } from './_v1.ts';

/** `?` with the focus on the chrome, the timeline or the canvas — never in a text field or a range slider. */
const SHELL_AND_CANVAS_NOT_TYPING = {
  focus: ['chrome', 'timeline', 'canvas'],
  notFacts: ['rangeFocused'],
} as typeof SHELL_NOT_TYPING;

export const APP_ACTIONS: ActionDef[] = [
  {
    id: 'settings.open',
    label: 'Settings…',
    kind: 'command',
    icon: 'sliders',
    exec: 'shell',
    // P8-B2: ⌘, answers from the canvas too — most of a session is spent with the canvas holding the focus,
    // and a global key that goes quiet there reads as a dead key (the canvas forwards it, like ⌘K).
    fromCanvas: true,
    // Decision v2-A6c-can-view-menu-minrole: an app-level row — every role keeps it (Canvas 04's Can view
    // list governs project rows only).
    // v1: shell only (never forwarded). V2-4.9: a read-only session opens Settings too — General only.
    keys: [kb('⌘,', 'global', { inText: true, when: { focus: [...SHELL_FOCI, 'canvas'] } })],
    legacy: { palette: 'Settings…', menu: 'Settings…' },
  },
  // S11.13 — Settings › Advanced (06 ad-settings). The sections are the desktop server's (a cloud tab
  // and a read-only link have none), so these four are too: absent there, not greyed.
  {
    // Opens Settings › Advanced, where the layout is reset — the row says what it does before it does.
    id: 'settings.reset-panel-layout',
    label: 'Reset panel layout',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['panels', 'sides', 'dock', 'layout', 'left', 'right'] },
  },
  {
    // A confirm dialog titled with its verb; keys and sign-ins are not touched.
    id: 'settings.reset-all',
    label: 'Reset all settings…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['defaults', 'preferences', 'fresh'] },
  },
  {
    // prefs.json `ownPluginCopy` — `MAUDE_NO_PLUGIN_BOOTSTRAP`, read when the AI chat next starts.
    id: 'settings.use-own-plugin-copy',
    label: 'Use my own plugin copy',
    kind: 'toggle',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['plugins', 'claude code', 'bundled', 'marketplace'] },
  },
  {
    // prefs.json `experimentalTeams` — agent teams on at the next AI session (debate relay tier).
    id: 'settings.experimental-teams',
    label: 'AI reviews argue it out (teams)',
    kind: 'toggle',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['teams', 'debate', 'review', 'experimental'] },
  },
  // S11.14 — Settings › Connections (06 ad-edge-hub). The sections are the desktop server's, so these are
  // too. From ⌘K each opens the row it belongs to: a credential is typed, a link changed, where the row's
  // words are — never from a search box.
  {
    // A new access token for the team server this folder syncs with, through `POST /_api/hub/link`.
    id: 'connections.replace-hub-token',
    label: 'Replace the team server’s access token…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'] },
    search: { keywords: ['hub', 'token', 'team server', 'self-hosted', 'credential', 'access'] },
  },
  {
    // D14 — spends the stored Figma token on one call (`POST /_api/figma/probe`) and says who it is.
    id: 'connections.figma-test',
    label: 'Test the Figma connection',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['figma', 'token', 'import', 'check'] },
  },
  {
    // D11 — attach this folder to one of the account's cloud projects (`POST /_api/cloud/attach`).
    id: 'connections.cloud-project-connect',
    label: 'Connect this folder to a cloud project…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: { keywords: ['cloud', 'link', 'attach', 'sync', 'workspace'] },
  },
  {
    // D11 — drop the link and its stored sign-in (`POST /_api/cloud/detach`, the in-app `unlink`).
    id: 'connections.cloud-project-disconnect',
    label: 'Disconnect this folder from its server…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'] },
    search: { keywords: ['cloud', 'unlink', 'detach', 'stop syncing', 'sign out'] },
  },
  {
    // V2-4.2 / V2-3.8: this project signs in as someone else. The shell moves the project onto a
    // profile of its own (`cloud_sign_in_prepare`) and reloads signed out; the person then signs in
    // from the Share panel as usual. V2-4.8a: a CLOUD tab has it too — there it ends the browser session
    // (the v1 menubar's account chip + "Sign out", Cloud Phase 27 C4: who you are, and how to stop
    // being them) and the hub asks for a sign-in again; the row shows the account's email.
    // 2.1.1 T4 (canvas 17 · ac-switch): on the desktop it opens the avatar menu's Switch account list —
    // the accounts already on this Mac and "No account — this Mac only" (`project_use_account`, a
    // confirm sheet first). It never moves a project to a fresh, empty account any more.
    id: 'account.switch',
    label: 'Switch account…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'cloud'] },
    search: { keywords: ['account', 'sign in', 'profile', 'no account', 'this mac only'] },
  },
  {
    // 2.1.1 T4 — the Switch account list's foot: a Maude Cloud account this Mac does not hold yet. The
    // V2-3.8 path: `cloud_sign_in_prepare` (a profile already signed in to Maude Cloud is never
    // re-signed — the project moves to a fresh profile of its own, and the page reloads), then the cloud
    // sign-in in Settings › Connections.
    id: 'account.add-cloud',
    label: 'Add a Maude Cloud account…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop'] },
    search: { keywords: ['cloud', 'sign in', 'account', 'login'] },
  },
  {
    // 2.1.1 T3/T4/T5 — "Link your server…" / "Sign in with custom server…": the one team-server dialog
    // (B2 wires it: it hears the `maude:link-server` event and prevents its default). Until it is there
    // the row opens Settings › Connections, where today's team-server dialog lives.
    id: 'account.link-server',
    label: 'Link your server…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'] },
    search: { keywords: ['team server', 'hub', 'self-hosted', 'custom server', 'sign in', 'link'] },
  },
  {
    // 2.0.5 W4: GitHub sign-in from anywhere — the avatar's card, ⌘K and every "Sign in with GitHub to
    // publish" line. The shell's own device flow (`github_sign_in`, oauth.rs): it stores on THIS project's
    // profile and, for another account on a shared profile, binds a new one (v2-3.8-bind-on-sign-in). The
    // mounted host (github-signin-host.jsx) runs it and shows the code; a browser tab has no keychain.
    id: 'account.github-signin',
    label: 'Sign in with GitHub…',
    kind: 'command',
    exec: 'shell',
    visible: { shell: ['desktop'] },
    search: { keywords: ['github', 'sign in', 'login', 'publish', 'connect'] },
  },
  {
    id: 'ai.chat',
    label: 'AI chat',
    kind: 'toggle',
    icon: 'sparkle',
    exec: 'shell',
    // The chat runs Claude Code on this Mac — the desktop app only (V2-4 gate probe). A cloud tab SAYS so
    // (V2-4.9, the shell parity contract): the row is there, greyed, and ⌘K names where it lives —
    // absence with a notice, never a silent hole. A browser tab on the desktop server and a read-only
    // link have no cloud story to tell, so for them the row is absent.
    visible: { shell: ['desktop', 'cloud'] },
    enabled: { shell: ['desktop'] },
    search: { note: 'in the desktop app' },
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
    // P8-B2: "?" opens the cheat sheet from the canvas too (CONTRACT §2 lists it as a global key); the canvas
    // forwards it when no text field holds the focus (inspect.ts › the forwarder's editable guard).
    fromCanvas: true,
    // v1 `e.key === '?'` — ⇧⌘/ produces '?' too.
    keys: [
      kb('?', 'global', { inText: false, when: SHELL_AND_CANVAS_NOT_TYPING }),
      kb('⌘?', 'global', { inText: false, alias: true, when: SHELL_AND_CANVAS_NOT_TYPING }),
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
  // S6.15 (Q10) — a new project starts empty; Help and guides adds the two guide canvases on request. The Help
  // dialog's button and this ⌘K row are one function (client/v2/help/add-guides.js → POST /_api/help/add-guides).
  {
    id: 'help.add-guides',
    label: 'Add the guide canvases to this project',
    kind: 'command',
    icon: 'help',
    exec: 'shell',
    visible: { shell: ['desktop', 'browser'], minRole: 'edit' },
    search: {
      keywords: ['guides', 'how to use maude', 'how to make video', 'tutorial', 'examples'],
      where: 'Help and guides',
    },
  },
  // S11.2 — the empty-artboard hint's button, and its ⌘K twin: opens the AI chat with "Fill <artboard> starting
  // from <another board>." in the field. It never sends — the person presses ↵. Desktop only (the chat is native).
  {
    id: 'ai.ask-fill-artboard',
    label: 'Ask AI to fill this artboard',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    visible: { shell: ['desktop'], minRole: 'edit' },
    search: {
      keywords: ['fill', 'empty artboard', 'draft', 'ask ai'],
      where: 'Empty artboard › Ask AI',
    },
  },
  // ── no key in v1: ⌘K / menu entries ──
  {
    id: 'ai.generate',
    label: 'Ask AI to generate…',
    kind: 'command',
    icon: 'sparkle',
    exec: 'shell',
    legacy: { palette: 'Ask AI to generate…', menu: 'Ask AI to generate…' },
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
