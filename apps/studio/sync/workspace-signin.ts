// "Sign in to workspace" — Cloud Phase 3 Task 3.
//
// The Phase-2 hub can authenticate a PERSON (`POST /auth/login` → a scoped,
// expiring peer token). This is the client half: the flow that turns "my
// teammate sent me an address" into a working, synced project without the
// person ever seeing the word "token".
//
// The vocabulary rule is not cosmetic (DDR-193 §5). The persona this product
// lives or dies by is the invited teammate who has never used git. Every string
// on this path says "sign in", "workspace", "project" — never token, never
// repository, never OAuth. A flow that says "paste your bearer token" has
// already told that person the product is not for them.
//
// TOKEN CUSTODY (unchanged from DDR-054 / the phase-29 A2 finding, and the
// reason this file reuses hub-link.ts rather than writing its own storage):
//
//   • the health probe is TOKENLESS — a lookalike address must never receive a
//     credential;
//   • the password goes ONLY to the address the user typed, once, and is never
//     stored anywhere, in memory or on disk, after the request;
//   • what IS stored is the minted peer token, in `~/.config/maude/hubs.json`
//     at mode 0600, keyed by normalized URL — the same store `maude design
//     link` writes, so a project opened later just works.
//
// The token now EXPIRES (Phase 2), which changes one thing for the client: a
// sync failure can mean "your session ran out" rather than "something broke",
// and the honest response is to ask the person to sign in again rather than to
// silently retry forever.

import { saveHubCredential } from './hub-link.ts';
import { normalizeUrl } from './hubs-config.ts';

const PROBE_TIMEOUT_MS = 4000;
const LOGIN_TIMEOUT_MS = 15_000;

export interface SignInResult {
  status: number;
  json:
    | {
        ok: true;
        url: string;
        /** Plain-words identity for the UI header — never a token. */
        user: { email: string; role: string };
        /** ms-epoch. The UI surfaces "signed in until <date>", not a raw number. */
        expiresAt: number | null;
        version: string | null;
      }
    | { ok: false; error: string; reason?: SignInFailure };
}

export type SignInFailure =
  | 'bad-address'
  | 'unreachable'
  | 'not-a-maude-workspace'
  | 'bad-credentials'
  | 'cloud-identity'
  | 'rate-limited'
  | 'save-failed'
  | 'server-error';

export interface SignInInput {
  url?: unknown;
  email?: unknown;
  password?: unknown;
}

/** Injected in tests. */
export interface SignInDeps {
  fetchImpl?: typeof fetch;
  save?: (
    normUrl: string,
    token: string,
    role?: string,
    expiresAt?: number,
    /** the account the workspace vouched (`user.email`), for "Signed in as" */
    account?: string
  ) => void;
}

/**
 * Address → reachability → sign in → credential stored. One call, because the
 * person doing this is not debugging a network stack; they were sent a link.
 */
export async function signInToWorkspace(
  input: SignInInput,
  deps: SignInDeps = {}
): Promise<SignInResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const save =
    deps.save ??
    ((u: string, t: string, r?: string, e?: number, a?: string) =>
      saveHubCredential(u, t, r, e, undefined, a));

  if (typeof input.url !== 'string' || !input.url.trim()) {
    return fail(400, 'Enter the workspace address your team sent you.', 'bad-address');
  }
  if (typeof input.email !== 'string' || !input.email.trim()) {
    return fail(400, 'Enter your email address.', 'bad-credentials');
  }
  if (typeof input.password !== 'string' || input.password === '') {
    return fail(400, 'Enter your password.', 'bad-credentials');
  }

  let norm: string;
  try {
    norm = normalizeUrl(input.url.trim());
    const parsed = new URL(norm);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail(400, 'The workspace address must start with http:// or https://.', 'bad-address');
    }
  } catch {
    return fail(400, "That doesn't look like a workspace address.", 'bad-address');
  }

  // 1. TOKENLESS reachability probe. Also tells us it is a Maude workspace at
  //    all, so a typo'd address fails here with a sentence a person can act on
  //    instead of failing later as a mysterious auth error.
  const probe = await probe200(doFetch, `${norm}/health`, PROBE_TIMEOUT_MS);
  if (!probe.reached) {
    return fail(
      502,
      "Couldn't reach that workspace. Check the address, or ask whoever invited you whether it's online.",
      'unreachable'
    );
  }
  if (!probe.isMaude) {
    return fail(
      502,
      "That address answered, but it isn't a Maude workspace. Double-check the link you were sent.",
      'not-a-maude-workspace'
    );
  }

  // 2. Sign in. The password goes to this address once and is never retained.
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT_MS);
    try {
      res = await doFetch(`${norm}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email.trim(), password: input.password }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fail(502, "Couldn't reach that workspace to sign in.", 'unreachable');
  }

  if (res.status === 401) {
    // The hub deliberately cannot tell us WHICH part was wrong (it refuses to be
    // a user-existence oracle), so neither can we. Saying "wrong password" when
    // the account may not exist would be a guess presented as fact.
    return fail(401, 'That email and password combination was not accepted.', 'bad-credentials');
  }
  if (res.status === 429) {
    return fail(429, 'Too many attempts. Wait a minute and try again.', 'rate-limited');
  }
  if (res.status === 400) {
    // The ONE refusal that comes with directions (Phase 23 B3): a cloud
    // workspace saying "this door signs in through Maude Cloud" — or a viewer
    // being told what viewing needs. Swallowing it into "try again shortly"
    // turned the most actionable message on this path into a shrug.
    let message = 'The workspace refused the sign-in.';
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      /* keep the generic sentence */
    }
    return fail(400, message, 'cloud-identity');
  }
  if (!res.ok) {
    return fail(502, 'The workspace refused the sign-in. Try again shortly.', 'server-error');
  }

  let body: {
    token?: unknown;
    expiresAt?: unknown;
    user?: { email?: unknown; role?: unknown };
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return fail(502, 'The workspace sent an unexpected reply.', 'server-error');
  }
  if (typeof body.token !== 'string' || !body.token) {
    return fail(502, 'The workspace sent an unexpected reply.', 'server-error');
  }

  // 3. Persist ONLY the minted token, 0600, in the shared credential store —
  //    plus the role the workspace vouched for (Cloud Phase 25 C2), so a
  //    viewer is known to be one at BOOT. Learning it from the first refusal
  //    instead means showing somebody an editor and then taking it away.
  const vouchedRole = typeof body.user?.role === 'string' ? body.user.role : 'member';
  //    …and WHEN it dies. The expiry was already read (it is echoed to the UI
  //    below) — discarding it from the store is what left the sync runtime
  //    with no deadline to renew against.
  const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : undefined;
  try {
    const account = typeof body.user?.email === 'string' ? body.user.email : undefined;
    save(norm, body.token, vouchedRole, expiresAt, account);
  } catch {
    return fail(500, "Couldn't save the workspace connection on this computer.", 'save-failed');
  }

  return {
    status: 200,
    json: {
      ok: true,
      url: norm,
      user: {
        email: typeof body.user?.email === 'string' ? body.user.email : String(input.email).trim(),
        role: vouchedRole,
      },
      expiresAt: expiresAt ?? null,
      version: probe.version,
    },
  };
}

function fail(status: number, error: string, reason: SignInFailure): SignInResult {
  return { status, json: { ok: false, error, reason } };
}

async function probe200(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<{ reached: boolean; isMaude: boolean; version: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal });
    if (!res.ok) return { reached: true, isMaude: false, version: null };
    try {
      const j = (await res.json()) as { ok?: unknown; version?: unknown };
      // A Maude hub's /health always carries `ok`. Anything else answered on
      // that path is some other service.
      const isMaude = j?.ok === true;
      return {
        reached: true,
        isMaude,
        version: typeof j?.version === 'string' ? j.version : null,
      };
    } catch {
      return { reached: true, isMaude: false, version: null };
    }
  } catch {
    return { reached: false, isMaude: false, version: null };
  } finally {
    clearTimeout(timer);
  }
}

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
