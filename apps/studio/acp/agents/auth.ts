// Per-agent sign-in (universal ACP, plan B5 auth half), generalising acp/login-state.ts (Claude's
// own flow, which stays exactly as it is) to any descriptor: the vendor's OWN CLI does the sign-in
// (`<realBin> <auth.loginArgs>` opens its browser flow), Maude only starts it, watches the vendor's
// own status command and can cancel. Maude never renders a login form, never sees a token, never
// touches the vendor's credential store.
//
//   agentAuthStatus   `<realBin> <auth.statusArgs>` under a 5 s kill, scrubbed env, nothing kept but
//                     an enum:  'signed-in' | 'signed-out' | 'not-needed' | 'unknown'
//   startAgentSignin  one sign-in child per agent; poll `agentSigninState`, `cancelAgentSignin`
//
// How a status command answers (observed, not guessed):
//   codex 0.154   `codex login status` → "Logged in using ChatGPT" exit 0 · "Not logged in" exit 1
//                 (run against a scratch CODEX_HOME, 2026-11-12). Exit 1 is therefore "signed out";
//                 a timeout, a spawn failure or any OTHER exit code is `unknown`, never a claim.
//   claude        `auth status --json` always exits 0 and says `{"loggedIn":false}`: a JSON
//                 document with a boolean `loggedIn` outranks the exit code.

import { scrubAgentEnv } from '../env.ts';
import type { AgentDescriptor } from './descriptor.ts';

export type AgentAuthState = 'signed-in' | 'signed-out' | 'not-needed' | 'unknown';

export const AUTH_STATUS_TIMEOUT_MS = 5000;
const MAX_STATUS_BYTES = 16 * 1024;

async function readCapped(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (total < MAX_STATUS_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    /* a killed child closes its pipes abruptly */
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `{"loggedIn": true|false}` somewhere in the output, else null. Strict booleans only. */
function jsonLoggedIn(text: string): boolean | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const doc = JSON.parse(text.slice(start, end + 1)) as { loggedIn?: unknown };
    return typeof doc.loggedIn === 'boolean' ? doc.loggedIn : null;
  } catch {
    return null;
  }
}

export interface AuthStatusOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** Where the person stands with this agent's own account. Never throws; never returns vendor text. */
export async function agentAuthStatus(
  d: AgentDescriptor,
  realBin: string,
  opts: AuthStatusOptions = {}
): Promise<AgentAuthState> {
  if (d.auth.gate === 'none') return 'not-needed';
  if (!d.auth.statusArgs) return 'unknown';
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    proc = Bun.spawn([realBin, ...d.auth.statusArgs], {
      env: scrubAgentEnv(opts.env ?? process.env, d.envAllow),
      windowsHide: true,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const child = proc;
    const limit = opts.timeoutMs ?? AUTH_STATUS_TIMEOUT_MS;
    let timedOut = false;
    // one deadline: it kills the child AND releases the read, so a wrapper whose descendants hold
    // the pipe open cannot hold this promise open too
    const deadline = new Promise<string>((res) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          /* already exited */
        }
        res('');
      }, limit);
    });
    const stdout = await Promise.race([
      readCapped(child.stdout as ReadableStream<Uint8Array>),
      deadline,
    ]);
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const code = await Promise.race([
      child.exited,
      new Promise<number>((res) => {
        exitTimer = setTimeout(() => res(-1), 500);
      }),
    ]);
    clearTimeout(exitTimer);
    if (timedOut) return 'unknown';
    const flag = jsonLoggedIn(stdout);
    if (flag !== null) return flag ? 'signed-in' : 'signed-out';
    if (code === 0) return 'signed-in';
    if (code === 1) return 'signed-out';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    if (timer) clearTimeout(timer);
    try {
      proc?.kill();
    } catch {
      /* already exited */
    }
  }
}

// ---------------------------------------------------------------- sign-in children

interface Signin {
  child: ReturnType<typeof Bun.spawn>;
  startedAt: number;
  exitCode: number | null;
  done: boolean;
}

/** One per agent id. A finished entry is kept (for `lastExit`) until the next start. */
const signins = new Map<string, Signin>();

export interface SigninState {
  inFlight: boolean;
  startedAt: number | null;
  /** Exit code of the last finished sign-in child (null while running / never run / cancelled). */
  lastExit: number | null;
}

export function agentSigninState(id: string): SigninState {
  const s = signins.get(id);
  if (!s) return { inFlight: false, startedAt: null, lastExit: null };
  return { inFlight: !s.done, startedAt: s.startedAt, lastExit: s.done ? s.exitCode : null };
}

export interface SigninOptions {
  env?: Record<string, string | undefined>;
}

export type StartSignin =
  | { ok: true }
  | { ok: false; reason: 'no-signin' | 'in-progress' | 'spawn-failed' };

/** Start the vendor's own sign-in (browser flow). One at a time per agent; fire-and-forget. */
export function startAgentSignin(
  d: AgentDescriptor,
  realBin: string,
  opts: SigninOptions = {}
): StartSignin {
  if (!d.auth.loginArgs) return { ok: false, reason: 'no-signin' };
  const running = signins.get(d.id);
  if (running && !running.done) return { ok: false, reason: 'in-progress' };
  try {
    const child = Bun.spawn([realBin, ...d.auth.loginArgs], {
      env: scrubAgentEnv(opts.env ?? process.env, d.envAllow),
      windowsHide: true,
      stdin: 'ignore',
      // the vendor's progress text is not Maude's to read or keep
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const entry: Signin = { child, startedAt: Date.now(), exitCode: null, done: false };
    signins.set(d.id, entry);
    child.exited.then(
      (code) => {
        entry.done = true;
        entry.exitCode = code;
      },
      () => {
        entry.done = true;
      }
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: 'spawn-failed' };
  }
}

/** Kill the in-flight sign-in child of one agent, if any (cancel button + app quit). */
export function cancelAgentSignin(id: string): void {
  const s = signins.get(id);
  if (!s || s.done) return;
  s.done = true;
  s.exitCode = null;
  try {
    s.child.kill();
  } catch {
    /* already exited */
  }
}

export function cancelAllAgentSignins(): void {
  for (const id of [...signins.keys()]) cancelAgentSignin(id);
}

/** For tests. */
export function resetAgentSignins(): void {
  cancelAllAgentSignins();
  signins.clear();
}
