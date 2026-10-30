export function findNode24(env?: Record<string, string | undefined>): string;

/** A hub child's env: the allowlisted basics of `base` (PATH, HOME, TMPDIR, locale…) plus `extra`. */
export function hubEnv(
  extra?: Record<string, string>,
  base?: Record<string, string | undefined>
): Record<string, string>;

export interface LocalHub {
  /** `http://127.0.0.1:<port>` */
  http: string;
  ws: string;
  /** owner / alice / bob / viewer peer tokens minted into the hub's data dir */
  tokens: Record<string, string>;
  pid: number;
  stop(): void;
}

export function startLocalHub(opts: {
  dir: string;
  /** Listen on this port (default 0 = any): restart the same hub on the same port after stopping it. */
  port?: number;
  /** Extra serve-hub flags, e.g. `['--asset-write-rate-limit', '1']`. */
  extraArgs?: string[];
  transactions?: boolean;
  users?: boolean;
  /** Run in cloud-identity mode with this project-token key (the way a cell runs). */
  cloudKey?: string;
  /** P8 G1b-3: run in workspace mode with this checkout (a cell-shaped hub: file door + journal). */
  workspace?: string;
  node?: string;
  /** Test seam: the spawn the hub is started with (defaults to node:child_process spawn). */
  spawn?: typeof import('node:child_process').spawn;
}): Promise<LocalHub>;

/** p8-fix-e (F9): the cloud lane's cell — cloud identity + its own checkout seeded with `projectConfig`. */
export function startCloudLaneCell(opts: {
  dir: string;
  cloudKey: string;
  projectConfig: Record<string, unknown> & { designRoot?: string };
  node?: string;
}): Promise<LocalHub & { checkout: string }>;

export function mintProjectToken(
  key: string,
  opts: { email: string; role: string; project?: string; ttlMs?: number }
): Promise<string>;
