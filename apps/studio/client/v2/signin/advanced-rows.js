// client/v2/signin/advanced-rows.js — the five rows of "Advanced options" on the sign-in card (02 ob-adv-open,
// S6.8). One row = one sheet (S6.9: hub / folder-or-GitHub / connect AI / the maude command / Figma). The
// ids are the contract between this flyout and those sheets: S6.9 mounts a sheet per id, and Settings ›
// Connections / Advanced (S11.14) lists the same rows. Words are the canvas's, exactly.

export const ADVANCED_ROWS = [
  {
    id: 'hub',
    icon: 'server',
    title: 'Use a self-hosted hub',
    desc: "Your team's own server — its address and your sign-in.",
  },
  {
    id: 'folder-github',
    icon: 'folder',
    title: 'Open a folder or a GitHub project',
    desc: 'Any folder on this Mac, or a project on GitHub.',
  },
  {
    id: 'ai',
    icon: 'spark',
    title: 'Connect AI now',
    desc: 'Your Claude account or an API key. Otherwise at the first prompt.',
  },
  {
    id: 'cli',
    icon: 'terminal',
    title: 'Install the maude command',
    desc: 'Plus the Claude Code plugin, for the terminal.',
  },
  {
    id: 'figma',
    icon: 'insert',
    title: 'Import from Figma',
    desc: 'Frames arrive as exact pictures; Make editable, one at a time.',
  },
];

export const ADVANCED_FOOT =
  'Each row opens one sheet. Later they live in Settings › Connections and Settings › Advanced, and Search ⌘K finds them.';
