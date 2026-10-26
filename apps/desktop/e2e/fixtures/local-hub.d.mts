export function findNode24(env?: Record<string, string | undefined>): string;

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
  transactions?: boolean;
  users?: boolean;
  /** Run in cloud-identity mode with this project-token key (the way a cell runs). */
  cloudKey?: string;
  node?: string;
}): Promise<LocalHub>;

export function mintProjectToken(
  key: string,
  opts: { email: string; role: string; project?: string; ttlMs?: number }
): Promise<string>;
