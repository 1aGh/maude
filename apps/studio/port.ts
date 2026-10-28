// The studio's main-listener port (server.ts).
//
// --port arg > $PORT > $MDCC_DEV_PORT > the default ladder. When the port wasn't explicitly chosen and the default is
// busy (another project's dev-server is running on the same machine), server.ts walks up PORT_LADDER ports before
// giving up. Explicit ports stay fatal so users notice their own collisions.
//
// p8-e2e-isolation-r13 — an e2e studio (any MAUDE_E2E_* marker: the desktop lane's sidecars, the share-roles studios)
// starts its ladder at E2E_PORT_BASE, never the CLI's 4399: a desktop sidecar starts with only `--root`, so it used to
// take :4399 whenever the person's own `maude design serve` was briefly down, and their next start had to move.
// $MAUDE_PORT_BASE moves the ladder's start without making the port explicit: a harness studio that is not an e2e one
// (the agent evals and journeys — an e2e marker would also change the ACP lookup) stays out of 4399–4408 too.

import { isE2eEnv } from './acp/probe.ts';

export const CLI_DEFAULT_PORT = 4399;
export const PORT_LADDER = 10;
/** An e2e studio's ladder: 47399–47408, clear of the CLI's 4399–4408. */
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
  if (Number.isInteger(base) && base > 0 && base < 65536 - PORT_LADDER) return { port: base, explicit: false };
  return { port: isE2eEnv(env) ? E2E_PORT_BASE : CLI_DEFAULT_PORT, explicit: false };
}
