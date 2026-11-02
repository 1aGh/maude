// p8-orphan-sidecars — a server the desktop shell spawned ends when the shell is gone.
//
// When Maude.app is force-quit, crashes or is SIGKILLed, the shell's own cleanup (sidecar.rs
// `kill_server`, SIGTERM-first) never runs. Before this, every project sidecar and the Home server
// were reparented to launchd and kept running — with their thumbnail shim and ACP adapter children —
// for as long as the Mac stayed up (found 2026-10-30: orphans alive 5–13 h).
//
// Detection: the parent pid recorded when this module is first imported (server.ts imports it
// before anything else runs) is compared with `process.ppid` every ~2 s on an unref'd timer. A
// reparent changes it — on macOS to 1 (launchd). Bun's `process.ppid` is read live (getppid), not
// cached at startup; measured on Bun 1.4. Nothing in Bun exposes kqueue's NOTE_EXIT, and the
// sidecar's stdin is not ours to read (the Tauri shell plugin pipes it, a harness may not), so
// polling ppid is the one signal that holds for every spawn path.
//
// WHO it applies to — only a server something asked to die with its parent:
//   • the desktop shell's spawns. Every project spawn carries MAUDE_SHELL_SIDECAR=1 (sidecar.rs
//     APP_SIDECAR_ENV) and the shell probe (MAUDE_SHELL_TOKEN + MAUDE_SHELL_INFO_FILE); Home carries
//     MAUDE_HOME_TOKEN + MAUDE_SHELL_INFO_FILE (home.rs). All of them sit in the MAUDE_SHELL_* /
//     MAUDE_HOME_* namespaces scrubAgentEnv (acp/env.ts) keeps from the agent, so an agent's own
//     `maude design serve` never inherits them.
//   • a harness that sets MAUDE_EXIT_WITH_PARENT=1 (MAUDE_EXIT_WITH_PARENT=0 turns it off even for a
//     shell spawn). The var is removed from this process's env when read, so nothing the server
//     spawns — the ACP agent and the `maude design serve` it may run — inherits it.
// NOT to a server started from a terminal: `maude design serve`, `npm run start` and server-up.sh's
// nohup/background respawn are meant to outlive the shell that started them. They carry none of
// the above, so they are unaffected.

export const EXIT_WITH_PARENT_ENV = 'MAUDE_EXIT_WITH_PARENT';
export const PARENT_WATCH_INTERVAL_MS = 2000;

/** Whether `env` asks this server to end with its parent (see the header for who that is). */
export function wantsExitWithParent(env: Record<string, string | undefined>): boolean {
  const optIn = env[EXIT_WITH_PARENT_ENV];
  if (optIn === '0') return false;
  if (optIn === '1') return true;
  return (
    env.MAUDE_SHELL_SIDECAR === '1' ||
    !!env.MAUDE_SHELL_TOKEN ||
    !!env.MAUDE_HOME_TOKEN ||
    !!env.MAUDE_SHELL_INFO_FILE
  );
}

// Read once, at first import: the parent as it was at spawn, and the ask — before any code of the
// server's own can spawn a child that would inherit the opt-in.
const BOOT_PPID = process.ppid;
const WANTED = wantsExitWithParent(process.env);
delete process.env[EXIT_WITH_PARENT_ENV];

export interface ParentWatchOptions {
  bootPpid?: number;
  intervalMs?: number;
  getPpid?: () => number;
}

/**
 * Call `onGone` once, when the parent this process started under is gone. Returns a stop
 * function. A parent already gone when the watch starts (ppid is 1, or changed during boot) fires
 * on the first tick.
 */
export function watchParent(onGone: () => void, o: ParentWatchOptions = {}): () => void {
  const boot = o.bootPpid ?? BOOT_PPID;
  const getPpid = o.getPpid ?? (() => process.ppid);
  let done = false;
  const timer = setInterval(() => {
    if (done) return;
    const now = getPpid();
    if (now === boot && now !== 1) return;
    done = true;
    clearInterval(timer);
    onGone();
  }, o.intervalMs ?? PARENT_WATCH_INTERVAL_MS);
  // never what keeps the process alive
  timer.unref?.();
  return () => {
    done = true;
    clearInterval(timer);
  };
}

/**
 * server.ts / home/main.ts: when the spawn asked for it, run `shutdown` (the same path SIGTERM
 * takes) once the parent is gone. Returns whether the watch is armed.
 */
export function exitWithParent(shutdown: () => void, label = 'server'): boolean {
  if (!WANTED) return false;
  watchParent(() => {
    try {
      // the parent held our stderr pipe; a write to it must not be what stops the shutdown
      console.error(`  [${label}] the app that started this ${label} is gone — stopping.`);
    } catch {
      /* no reader left */
    }
    shutdown();
  });
  return true;
}
