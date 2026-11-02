// The owner's desktop tells its cloud workspace what the project is called and
// where its design systems live (`PUT /api/project-config`, hub
// project-config-door.mjs).
//
// A cell reads `config.json` from its checkout, and a project that reached its
// cell by syncing from a desktop has none there — the file plane never carries
// `config.json` (file-membership: `never`). The cell then ran on defaults: no
// design systems and a tokens path that did not exist, so canvases relying on
// the shell's tokens stylesheet lost their brand fonts (2026-10-02, alligators).
//
// OWNER ONLY — and note WHOSE word that is (security review F3): the gate is
// `storedRecord.role`, which is copied from the hub's sign-in response, i.e.
// the hub's own claim about us. That is acceptable ONLY because what is sent
// is a sanitized subset the hub can already see (names and contained relative
// paths — P-5 adds per-system `schema: 1`, `rootClass`, `themes`, `themeDefault`, all names in
// the class charset) and the hub enforces the owner bar itself. If this subset ever grows
// past that, gate it on a recorded local consent the way `codeModulesAllowed`
// is. `linkedHub`, tokens and everything else in config.json stay here.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type SystemSchemaFields, sanitizeSchemaFields } from '../context.ts';

const isContainedRel = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length > 0 &&
  p.length <= 256 &&
  !p.startsWith('/') &&
  !/(^|\/)\.\.(\/|$)/.test(p) &&
  !/[\\\0]/.test(p);

const isLabel = (s: unknown, max = 64): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\0\r\n]/.test(s);

export interface ProjectConfigSubset {
  name?: string;
  projectLabel?: string;
  tokensCssRel?: string;
  componentsCssRel?: string | null;
  canvasGroups?: { label: string; path: string }[];
  designSystems?: ({ name: string; path: string; tokensCssRel?: string } & SystemSchemaFields)[];
  defaultDesignSystem?: string;
}

/** The part of a config that may travel to the hub — mirrors the hub's own filter. */
export function projectConfigSubset(raw: unknown): ProjectConfigSubset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ProjectConfigSubset = {};
  if (isLabel(r.name)) out.name = r.name;
  if (isLabel(r.projectLabel, 120)) out.projectLabel = r.projectLabel;
  if (isContainedRel(r.tokensCssRel)) out.tokensCssRel = r.tokensCssRel;
  if (r.componentsCssRel === null || isContainedRel(r.componentsCssRel)) {
    out.componentsCssRel = r.componentsCssRel as string | null;
  }
  if (Array.isArray(r.canvasGroups)) {
    const groups = r.canvasGroups
      .filter(
        (g): g is { label: string; path: string } =>
          !!g && typeof g === 'object' && isLabel(g.label) && isContainedRel(g.path)
      )
      .slice(0, 32)
      .map((g) => ({ label: g.label, path: g.path.replace(/\/+$/, '') }));
    if (groups.length) out.canvasGroups = groups;
  }
  if (Array.isArray(r.designSystems)) {
    out.designSystems = r.designSystems
      .filter(
        (d): d is { name: string; path: string; tokensCssRel?: string } =>
          !!d &&
          typeof d === 'object' &&
          typeof d.name === 'string' &&
          /^[\w .-]{1,64}$/.test(d.name) &&
          isContainedRel(d.path) &&
          (d.tokensCssRel == null || isContainedRel(d.tokensCssRel))
      )
      .slice(0, 16)
      .map((d) => ({
        name: d.name,
        path: d.path.replace(/\/+$/, ''),
        ...(typeof d.tokensCssRel === 'string' ? { tokensCssRel: d.tokensCssRel } : {}),
        ...sanitizeSchemaFields(d),
      }));
  }
  if (
    typeof r.defaultDesignSystem === 'string' &&
    (out.designSystems ?? []).some((d) => d.name === r.defaultDesignSystem)
  ) {
    out.defaultDesignSystem = r.defaultDesignSystem;
  }
  return Object.keys(out).length ? out : null;
}

export interface ProjectConfigPusher {
  /** Send the current subset if it changed since the last accepted send. */
  push(): Promise<'sent' | 'unchanged' | 'refused' | 'failed' | 'nothing'>;
}

export function createProjectConfigPusher({
  designRoot,
  hubUrl,
  token,
  fetchImpl = fetch,
  log = console,
}: {
  designRoot: string;
  hubUrl: string;
  token: () => string;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'log' | 'warn'>;
}): ProjectConfigPusher {
  let lastAccepted: string | null = null;
  let inflight: Promise<'sent' | 'unchanged' | 'refused' | 'failed' | 'nothing'> | null = null;
  const run = async () => {
    let subset: ProjectConfigSubset | null = null;
    try {
      subset = projectConfigSubset(
        JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'))
      );
    } catch {
      subset = null;
    }
    if (!subset) return 'nothing' as const;
    const body = JSON.stringify(subset);
    if (body === lastAccepted) return 'unchanged' as const;
    let res: Response;
    try {
      // `${base}/api/...` like the file plane — `new URL('/api/…', hubUrl)`
      // would drop a hub's path prefix and send the owner's token to whatever
      // answers at the host root (review F4).
      res = await fetchImpl(`${hubUrl.replace(/\/+$/, '')}/api/project-config`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return 'failed' as const;
    }
    // An older hub has no such door — nothing to do, and nothing to retry.
    if (res.status === 404 || res.status === 405) {
      lastAccepted = body;
      return 'refused' as const;
    }
    if (res.status === 401 || res.status === 403) {
      lastAccepted = body;
      log.warn(`[sync] the workspace did not take this project's config (${res.status}).`);
      return 'refused' as const;
    }
    if (!res.ok) return 'failed' as const;
    lastAccepted = body;
    const answer = (await res.json().catch(() => null)) as { changed?: boolean } | null;
    if (answer?.changed) {
      log.log("[sync] sent the project's name and design systems to the workspace.");
    }
    return 'sent' as const;
  };
  return {
    push() {
      if (!inflight) inflight = run().finally(() => (inflight = null));
      return inflight;
    },
  };
}
