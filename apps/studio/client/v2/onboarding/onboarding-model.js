// client/v2/onboarding/onboarding-model.js — the words and the small pure rules of the five Advanced sheets
// (02 Onboarding ob-adv-sheets, S6.9). Words are the canvas's, exactly; each title asks with the verb of its
// main button ("Connect to your own hub" → Connect). Advanced language (addresses, commands, keys) is allowed
// here and only here (the canvas's note 15).

export const HUB_WORDS = {
  title: 'Connect to your own hub',
  verb: 'Connect',
  busy: 'Connecting…',
  addressLabel: 'Hub address',
  test: 'Test connection',
  testing: 'Testing…',
  reachable: (version) => (version ? `Reachable — hub ${version}` : 'Reachable'),
  modePassword: 'Email and password',
  modeInvite: 'Invite link or key',
  fine: 'Projects on this hub open like cloud ones. cloud.maude.sh stays signed in too.',
  unreachable: "Couldn't reach that hub. Check the address, or whether it's online.",
};

export const FOLDER_WORDS = {
  title: 'Open a folder or a GitHub project',
  verb: 'Open',
  tabFolder: 'A folder on this Mac',
  tabGithub: 'From GitHub',
  folderLine: "You'll choose the folder next.",
  paste: 'Or paste a GitHub link',
  newGithub: 'New project on GitHub — private by default',
};

export const AI_WORDS = {
  title: 'Connect AI',
  verb: 'Connect',
  claude: 'Claude Pro or Max',
  claudeSub: 'Sign in through your browser. Claude Code is set up for you.',
  key: 'API key',
  keySub: 'Pay as you go, from your Anthropic console.',
  keyHint: 'sk-ant-…',
  off: 'Not connected yet — or connect at your first prompt',
  on: 'Connected',
};

export const CLI_WORDS = {
  title: 'Install the maude command',
  verb: 'Install',
  busy: 'Installing…',
  cmd: 'maude command',
  cmdSub: 'Start, serve and script projects from the terminal.',
  plugin: 'Claude Code plugin',
  pluginSub: 'The design and flow commands, inside Claude Code.',
  terminal: 'Or in Terminal',
  npm: 'npm i -g @1agh/maude',
  marketplace: '/plugin marketplace add 1aGh/maude',
  copy: 'Copy',
  copied: 'Copied',
};

export const FIGMA_WORDS = {
  title: 'Import from Figma',
  verb: 'Import',
  fine: (project) =>
    `Each frame arrives as an artboard on a new canvas in ${project} — Figma's exact picture of it. Make editable turns one artboard into layers; it needs Figma Dev Mode, on a paid seat.`,
  inNewProject: 'a new project',
  linkLabel: 'Figma link',
  linkPlaceholder: 'figma.com/design/…',
  badLink: "That doesn't look like a Figma link.",
  tokenFold: 'Access token',
  tokenLine:
    'Maude asks for the Figma access token in the project window, once, and keeps it on this Mac — this page never holds it.',
};

/** The rows of the maude-command sheet from `/_home/cli/status`: [{ id, state, word }]. */
export function cliRows(status) {
  const s = status && typeof status === 'object' ? status : {};
  const cmd =
    s.state === 'installed'
      ? { state: 'ok', word: 'Installed' }
      : s.state === 'other-link' || s.state === 'not-a-link' || s.state === 'unavailable'
        ? { state: 'bad', word: 'Not installed' }
        : { state: 'off', word: 'Not installed' };
  const p = s.plugin && typeof s.plugin === 'object' ? s.plugin : { phase: 'idle' };
  const plugin =
    p.phase === 'running'
      ? { state: 'busy', word: 'Installing…' }
      : p.phase === 'done' && p.ok
        ? { state: 'ok', word: 'Installed' }
        : p.phase === 'done'
          ? { state: 'bad', word: "Couldn't install" }
          : { state: 'off', word: 'Not installed' };
  return [
    { id: 'cmd', ...cmd },
    { id: 'plugin', ...plugin },
  ];
}

/** Nothing left for Install to do: the link is there and the plugin step has landed (or cannot run). */
export function cliDone(status) {
  const s = status && typeof status === 'object' ? status : {};
  if (s.state !== 'installed') return false;
  const p = s.plugin?.phase;
  return p === 'running' || (p === 'done' && s.plugin.ok === true) || s.claude === false;
}

/** The project the Figma line speaks of: the target's name ("a new project" for the new-project target). */
export function figmaProjectName(target) {
  return typeof target?.name === 'string' && target.name ? target.name : FIGMA_WORDS.inNewProject;
}
