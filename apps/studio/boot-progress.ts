// apps/studio/boot-progress.ts — #204: the boot tells its supervisor it is still moving.
//
// A cell's hub supervises this process (apps/hub/src/studio-child.mjs) and used to SIGKILL it when
// `/_health` had not answered within a fixed 60 s. A large workspace on a small cell boots slower
// than that, so the child was killed mid-boot and started over — twice — before it came up. The
// supervisor now kills only a child that has gone QUIET: each `[boot] <step>` line here moves its
// deadline (BOOT_PROGRESS_RE there), and a hard ceiling still ends one that never gets there.
//
// Printed only where something reads it: a workspace cell, or an explicit MAUDE_BOOT_PROGRESS=1.
// One line per boot step (a handful), none after the server listens.

const enabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.MAUDE_WORKSPACE_MODE === '1' || env.MAUDE_BOOT_PROGRESS === '1';

let finished = false;

/** One boot step done. `label` is a fixed word from server.ts — never a path or tenant text. */
export function bootStep(label: string, out: (line: string) => void = console.log): void {
  if (finished || !enabled()) return;
  out(`[boot] ${label} +${Math.round(performance.now())}ms`);
}

/** The server listens: from here `/_health` is the signal, and nothing more is printed. */
export function bootFinished(out: (line: string) => void = console.log): void {
  bootStep('listening', out);
  finished = true;
}

// The first line, printed as this module is evaluated — the import graph has loaded by now, which
// on a cold cell is the longest single step of the boot.
bootStep('modules');
