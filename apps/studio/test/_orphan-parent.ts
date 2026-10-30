// p8-orphan-sidecars — a stand-in for Maude.app in the parent-death tests. It spawns ONE child the
// way the Tauri shell plugin spawns a sidecar (stdin, stdout and stderr all piped, drained by the
// parent), prints `child <pid>` on its own stdout, and then waits to be SIGKILLed — a force-quit or
// a crash of the app, where none of the shell's own cleanup (sidecar.rs `kill_server`) runs.
//
// The spec comes in through MAUDE_TEST_CHILD_SPEC as JSON: { cmd: string[], cwd: string, env }.
import { spawn } from 'node:child_process';

const spec = JSON.parse(process.env.MAUDE_TEST_CHILD_SPEC ?? '{}') as {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
};
const [bin, ...args] = spec.cmd;
const child = spawn(bin as string, args, {
  cwd: spec.cwd,
  env: spec.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout?.on('data', () => {});
child.stderr?.on('data', () => {});
process.stdout.write(`child ${child.pid}\n`);
setInterval(() => {}, 60_000);
