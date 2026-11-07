/**
 * The in-process hub's pid — never 0. Against a container hub the conf sets `hubPid: 0`, and
 * `process.kill(0, 'SIGSTOP')` stops this whole process GROUP (wdio, the Docker gate, the test lane),
 * so the SIGCONT after it never runs and the lane hangs. Every signal to the hub goes through here
 * (`scripts/test/desktop-e2e-hub-signals.test.mjs` holds the scenarios to it).
 */
export function hubProcess(t: { hubPid: number }): number {
  if (!Number.isInteger(t.hubPid) || t.hubPid <= 0)
    throw new Error(`no in-process hub to signal (hubPid ${t.hubPid}) — use hubAway/hubBack`);
  return t.hubPid;
}
