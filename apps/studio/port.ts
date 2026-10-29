// The studio's main-listener port (server.ts).
//
// --port arg > $PORT > $MDCC_DEV_PORT > $MAUDE_PORT_BASE > the ladder for who started it. When the port wasn't
// explicitly chosen and the base is busy (another project's server is running on the same machine), server.ts walks
// up PORT_LADDER ports before giving up. Explicit ports stay fatal so users notice their own collisions.
//
// Four ladders, never overlapping (test/server-port-app-range.test.ts pins it):
//   4399–4408    CLI_DEFAULT_PORT — a person's own `maude design serve`.
//   46399–46408  APP_PORT_BASE — the desktop app's project servers (decision maude/v2-michal-desktop-own-port-range).
//                The Rust spawn (sidecar.rs spawn_for) sets APP_SIDECAR_ENV=1; before that the app's sidecars started
//                with only `--root`, took :4399 and collided with the person's own server.
//   47399–47408  E2E_PORT_BASE — any MAUDE_E2E_* marker (p8-e2e-isolation-r13): the desktop lane's sidecars, the
//                share-roles studios. It wins over the app marker, so a test run never takes a port in the person's
//                own app range.
//   48399–48408  $MAUDE_PORT_BASE — the agent evals and journeys harness: it moves the ladder's start without making
//                the port explicit (an e2e marker would also change the ACP lookup).
//
// A restart keeps its port by the ladder: a crashed sidecar's respawn walks the same ladder and finds its dead
// predecessor's port free again. The Home server (home/main.ts) takes none of these — it binds any free port and
// the app remembers it (app_state home_port). The canvas and capture origins listen on port 0.

import { isE2eEnv } from './acp/probe.ts';

export const CLI_DEFAULT_PORT = 4399;
export const PORT_LADDER = 10;
/** The desktop app's project-server ladder: 46399–46408. */
export const APP_PORT_BASE = 46399;
/**
 * Set to "1" by the desktop app on every project-server spawn. It sits in the shell's MAUDE_SHELL_* namespace,
 * which scrubAgentEnv (acp/env.ts) keeps from the agent — so an agent's own `maude design serve` stays on the CLI
 * ladder and never takes a port in the app's range.
 */
export const APP_SIDECAR_ENV = 'MAUDE_SHELL_SIDECAR';
/** An e2e studio's ladder: 47399–47408, clear of the CLI's 4399–4408 and the app's 46399–46408. */
export const E2E_PORT_BASE = 47399;

export function resolvePort(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env
): { port: number; explicit: boolean } {
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1]) return { port: Number(argv[i + 1]), explicit: true };
  const fromEnv = env.PORT ?? env.MDCC_DEV_PORT;
  if (fromEnv) return { port: Number(fromEnv), explicit: true };
  const base = Number(env.MAUDE_PORT_BASE);
  if (Number.isInteger(base) && base > 0 && base < 65536 - PORT_LADDER)
    return { port: base, explicit: false };
  if (isE2eEnv(env)) return { port: E2E_PORT_BASE, explicit: false };
  if (env[APP_SIDECAR_ENV] === '1') return { port: APP_PORT_BASE, explicit: false };
  return { port: CLI_DEFAULT_PORT, explicit: false };
}
