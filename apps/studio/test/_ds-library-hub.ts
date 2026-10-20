// S10.18b test fixture: a FAKE library hub (never a real one) — `/health`, the projected head and the revisions
// of one system, behind a bearer grant — plus a linking project (the S10.2 fixture) and its library.
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createDsLibrary, type DsLibrary, memoryGrantStore } from '../ds/library.ts';
import { type BuiltRevision, buildRevision } from '../ds/revision.ts';
import { makeProject, PERSON, type Project } from './_ds-engine-fixture.ts';

export const HUB = 'https://alligators.cloud.test';
export const PROJECT = 'p_gator';
export const LIB = 'gator';
export const GRANT = 'grant-abc123456789';
export const URL_ = `${HUB}/api/projects/${PROJECT}/v1/ds/${LIB}`;

export const gatorCss = (accent: string, accentDark: string) => `/* gator */
:root,
.gator[data-theme="light"] {
  --accent: ${accent};
  --fg-0: #101010;
}

.gator[data-theme="dark"] {
  --accent: ${accentDark};
  --fg-0: #f0f0f0;
}
`;
export const GATOR_COMP = '.btn {\n  border-radius: 2px;\n}\n';

export const rev = (files: Record<string, string>, system = LIB): BuiltRevision =>
  buildRevision(system, files);
export const V1 = rev({
  'colors_and_type.css': gatorCss('#0a7d3b', '#3fbf6f'),
  'preview/_components.css': GATOR_COMP,
});
export const V2 = rev({
  'colors_and_type.css': gatorCss('#0b5fff', '#6f9bff'),
  'preview/_components.css': '.btn {\n  border-radius: 6px;\n}\n',
});

export interface FakeHub {
  fetch: typeof fetch;
  calls: { url: string; auth: string | null; redirect: string | undefined }[];
  /** what `head` answers */
  head: string | null;
  /** id → the bytes `revisions/<id>` answers (plant anything) */
  revisions: Map<string, string>;
  capabilities: string[] | null;
  /** a status to answer for every request (redirects, outages) */
  status: number | null;
}

export function fakeHub(o: { head?: string | null; capabilities?: string[] | null } = {}): FakeHub {
  const hub: FakeHub = {
    calls: [],
    head: o.head === undefined ? V1.id : o.head,
    revisions: new Map([
      [V1.id, V1.bytes],
      [V2.id, V2.bytes],
    ]),
    capabilities: o.capabilities === undefined ? ['ledger', 'ds-library'] : o.capabilities,
    status: null,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const h = new Headers(init?.headers);
      hub.calls.push({ url, auth: h.get('authorization'), redirect: init?.redirect });
      if (hub.status !== null)
        return new Response('', {
          status: hub.status,
          headers: { location: 'https://evil.test/x' },
        });
      const u = new URL(url);
      if (u.origin !== HUB) return new Response('{}', { status: 599 });
      if (u.pathname === '/health')
        return Response.json(
          hub.capabilities ? { ok: true, capabilities: hub.capabilities } : { ok: true }
        );
      if (h.get('authorization') !== `Bearer ${GRANT}`)
        return Response.json({ code: 'unauthenticated' }, { status: 401 });
      const base = `/api/projects/${PROJECT}/v1/ds/${LIB}`;
      if (u.pathname === `${base}/head`)
        return Response.json({
          head: hub.head,
          log: hub.head
            ? [
                {
                  rev: hub.head,
                  parent: null,
                  action: 'publish',
                  at: '2026-10-19T10:00:00Z',
                  by: { kind: 'person', name: 'Tereza‮' },
                  summary: 'Corners 2 → 6',
                },
              ]
            : [],
        });
      const m = new RegExp(`^${base}/revisions/([0-9a-f]{64})$`).exec(u.pathname);
      const bytes = m ? hub.revisions.get(m[1]) : undefined;
      if (bytes === undefined) return Response.json({ code: 'not-found' }, { status: 404 });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return hub;
}

export interface Linking {
  p: Project;
  hub: FakeHub;
  lib: DsLibrary;
  grants: ReturnType<typeof memoryGrantStore>;
  clock: { t: number };
  gatorAbs: string;
}

/** The S10.2 fixture project + a library over the fake hub (nothing linked yet). */
export async function linkingProject(o: { hub?: FakeHub } = {}): Promise<Linking> {
  const p = await makeProject();
  const hub = o.hub ?? fakeHub();
  const grants = memoryGrantStore();
  const clock = { t: Date.parse('2026-10-20T08:00:00Z') };
  const lib = createDsLibrary(p.engine, { fetchImpl: hub.fetch, grants, now: () => clock.t });
  return { p, hub, lib, grants, clock, gatorAbs: path.join(p.designRoot, 'system', LIB) };
}

/** …with `gator` linked and two canvases using it (Home, Landing). */
export async function linked(o: { hub?: FakeHub } = {}): Promise<Linking> {
  const L = await linkingProject(o);
  await L.lib.link({ url: URL_, grant: GRANT, by: PERSON });
  // the local home observes the edit, as it would a person's (the kernel proposes on what it knows)
  for (const c of ['Home', 'Landing'])
    await L.p.outside(
      `ui/${c}.meta.json`,
      `${JSON.stringify({ title: c, designSystem: LIB }, null, 2)}\n`
    );
  return L;
}

export const nothingLinked = (L: Linking) =>
  !existsSync(L.gatorAbs) && !String(L.p.read('config.json')).includes(`"${LIB}"`);
