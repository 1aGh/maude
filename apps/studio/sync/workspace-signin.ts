// What the operator of a team server can see — the disclosure shown where the person is.
//
// This file used to hold "Sign in to workspace" too: an address, an email and a password, posted to
// the hub's `/auth/login`. Issue #204 retired it — the desktop owns no login method for a team
// server. A team server is signed in to on its OWN page (`routes/hub-signin.ts`,
// `sync/hub-browser-signin.ts`: a one-time code comes back, the token is stored), and the one
// fallback is a pasted access token (`/_api/hub/link`). Only the disclosure stays here.

// ---------------------------------------------------------------- disclosure

/**
 * What the operator of a workspace can see and do — DDR-054's trust model, made
 * visible to the person it concerns.
 *
 * DDR-079 disclosed TSX-sync via a terminal banner. In a workspace the affected
 * human may never open a terminal: invitees run Maude Desktop and nothing else.
 * So the disclosure moves to where they are. The banner stays for terminal
 * users; it is no longer the only disclosure (DDR-192 §6).
 *
 * Written as data rather than JSX so the same sentences appear in the desktop
 * panel, the web onboarding, and the docs without three drifting copies — and
 * so a test can assert the honest ones are still present.
 */
export interface DisclosureItem {
  /** Short label for the row. */
  title: string;
  /** One plain sentence. No jargon, no hedging. */
  detail: string;
  /** `sees` = the operator can read it · `cannot` = they can't · `you` = you control it. */
  kind: 'sees' | 'cannot' | 'you';
}

export function workspaceDisclosure({
  operator,
  aiAvailable,
}: {
  /** Who runs this workspace, in words: "your team", "Maude Cloud", a hostname. */
  operator: string;
  /** Whether this machine has a Claude subscription wired up (DDR-123). */
  aiAvailable: boolean;
}): DisclosureItem[] {
  return [
    {
      kind: 'sees',
      title: 'Your designs',
      detail: `${operator} stores every canvas in this project, including its full edit history.`,
    },
    {
      kind: 'sees',
      title: 'Who is working, and when',
      detail: `${operator} can see which files you open and when you are editing.`,
    },
    {
      kind: 'sees',
      title: 'Comments and annotations',
      detail:
        'Anything you write on a canvas is stored in the workspace, not just on your machine.',
    },
    {
      kind: 'cannot',
      title: 'Nothing else on this computer',
      detail:
        'Only this project folder syncs. Other files, other projects, and the rest of your disk are never read.',
    },
    {
      kind: 'cannot',
      title: 'Your designs are never run on their servers',
      detail:
        'Canvases render here, on your machine. The workspace stores and syncs them — it never executes them.',
    },
    {
      kind: aiAvailable ? 'you' : 'cannot',
      title: 'AI runs on your own subscription',
      detail: aiAvailable
        ? 'Claude runs locally under your own subscription. Your prompts do not pass through the workspace.'
        : 'AI is off because this computer has no Claude subscription connected. Everything else works normally.',
    },
    {
      kind: 'you',
      title: 'You can leave with everything',
      detail:
        'One click exports the whole project — designs and media — in a form that opens without Maude.',
    },
  ];
}
