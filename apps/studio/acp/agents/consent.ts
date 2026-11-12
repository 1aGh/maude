// Per-project consent to run an 'unrestricted' agent (universal ACP, plan Decision 2, DDR-252).
//
// An agent Maude cannot confine (policy 'unrestricted': no launch policy that passed the
// conformance probe) only starts in a project after the person said yes to it there. The answer
// is this machine's, about this project: it lives OUTSIDE the project, next to the project's
// folder grants (`ai/attach-grants.ts` `grantsFileFor`) in the app's own index folder
// (`~/.maude/index/v1/projects/<pid>/agent-consent.json`), so a cloned or synced project can
// never ship a yes. A file that would resolve inside the project is ignored (reads say no,
// writes throw).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { pidOf, projectDir } from '../../index/snapshot.ts';
import { isInsideRoot, resolveRealPath } from '../write-scope.ts';
import type { AgentId } from './descriptor.ts';

interface ConsentFile {
  v: 1;
  agents: Record<string, { grantedAt: number }>;
}

/** This machine's consent file for one project: outside the project tree. */
export function agentConsentFileFor(projectRoot: string): string {
  return join(projectDir(pidOf(projectRoot)), 'agent-consent.json');
}

function misplaced(file: string, projectRoot: string): boolean {
  const f = resolveRealPath(file, sep);
  const root = resolveRealPath(projectRoot, sep);
  return f === root || isInsideRoot(f, root);
}

function read(file: string): ConsentFile {
  const empty: ConsentFile = { v: 1, agents: {} };
  if (!existsSync(file)) return empty;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ConsentFile> | null;
    if (raw?.v !== 1 || !raw.agents || typeof raw.agents !== 'object') return empty;
    const agents: ConsentFile['agents'] = {};
    for (const [id, v] of Object.entries(raw.agents)) {
      const at = (v as { grantedAt?: unknown } | null)?.grantedAt;
      if (typeof at === 'number' && Number.isFinite(at)) agents[id] = { grantedAt: at };
    }
    return { v: 1, agents };
  } catch {
    return empty;
  }
}

export interface ConsentPlace {
  projectRoot: string;
  /** Tests only — default `agentConsentFileFor(projectRoot)`. */
  file?: string;
}

export function hasAgentConsent(place: ConsentPlace, id: AgentId): boolean {
  const file = place.file ?? agentConsentFileFor(place.projectRoot);
  if (misplaced(file, place.projectRoot)) return false;
  return Object.hasOwn(read(file).agents, id);
}

export function recordAgentConsent(place: ConsentPlace, id: AgentId, now = Date.now()): void {
  const file = place.file ?? agentConsentFileFor(place.projectRoot);
  if (misplaced(file, place.projectRoot))
    throw new Error('agent consent store is inside the project');
  const next = read(file);
  next.agents[id] = { grantedAt: now };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function revokeAgentConsent(place: ConsentPlace, id: AgentId): void {
  const file = place.file ?? agentConsentFileFor(place.projectRoot);
  if (misplaced(file, place.projectRoot)) return;
  const next = read(file);
  if (!Object.hasOwn(next.agents, id)) return;
  delete next.agents[id];
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
