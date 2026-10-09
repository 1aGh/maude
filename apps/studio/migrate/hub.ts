// The migrator's view of a linked hub — V2-1.12 §5.5. The hub side (H1–H5:
// `store_meta.formatVersion`, the fence term, `POST /api/project-format`, the
// `/health` field + `format-v2` capability) is NOT on this branch yet; until it
// is, every linked project refuses with "the team server needs an update",
// which is the contract's own answer for a hub without `format-v2`.

export interface HubHealth {
  ok: true;
  /** `null` while the hub has not read its store yet */
  formatVersion: number | null;
  capabilities: string[];
  epoch?: number;
}

export interface HubFormatClient {
  health(): Promise<HubHealth | { ok: false }>;
  /** `POST /api/project-format` — owner bearer; the `setMode` barrier. */
  setFormat(
    formatVersion: 1 | 2,
    expectEpoch?: number
  ): Promise<{ ok: true; epoch: number } | { ok: false; status: number; code?: string }>;
}

export function createHubFormatClient(
  hub: { url: string; token: string },
  fetchImpl: typeof fetch = fetch
): HubFormatClient {
  const base = hub.url.replace(/\/+$/, '');
  return {
    async health() {
      try {
        const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false };
        const j = (await res.json()) as {
          formatVersion?: unknown;
          capabilities?: unknown;
          epoch?: unknown;
        };
        return {
          ok: true,
          formatVersion: typeof j.formatVersion === 'number' ? j.formatVersion : null,
          capabilities: Array.isArray(j.capabilities)
            ? j.capabilities.filter((c): c is string => typeof c === 'string')
            : [],
          ...(typeof j.epoch === 'number' ? { epoch: j.epoch } : {}),
        };
      } catch {
        return { ok: false };
      }
    },
    async setFormat(formatVersion, expectEpoch) {
      try {
        const res = await fetchImpl(`${base}/api/project-format`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${hub.token}`,
            // this build is a format-2 writer (V2-1.12 §5.4 declaration)
            'x-maude-format': '2',
          },
          body: JSON.stringify({
            formatVersion,
            ...(expectEpoch !== undefined ? { expectEpoch } : {}),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const j = (await res.json().catch(() => null)) as {
          epoch?: unknown;
          code?: unknown;
        } | null;
        if (res.status === 200 && typeof j?.epoch === 'number') return { ok: true, epoch: j.epoch };
        return {
          ok: false,
          status: res.status,
          ...(typeof j?.code === 'string' ? { code: j.code } : {}),
        };
      } catch {
        return { ok: false, status: 0, code: 'unreachable' };
      }
    },
  };
}
