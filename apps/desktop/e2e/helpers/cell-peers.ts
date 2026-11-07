import { readFileSync } from 'node:fs';
import { browser } from '@wdio/globals';

/**
 * Two people on one cell (#172 T2.6c): the designer's copy is bob's Mac (the app under test); alice's studio is a
 * second headless studio the launcher already started (wdio.team-cell.conf.ts `setUp`), driven here through its OWN
 * HTTP door as alice. Shared by the lanes that need a second person with a real identity — an-vote,
 * co-mention-notify, ve-footage.
 *
 * Only meaningful under a conf that imports wdio.team-cell.conf.ts (it sets MAUDE_E2E_TEAM_CELL).
 */

export type Cell = {
  hub: string;
  hubPid: number;
  hubDir: string;
  hubPort: number;
  cellRepo: string;
  teammate: string;
  teammatePort: number;
  teammatePid: number;
  designer: string;
};

/** The cell this lane stood up, or null outside a cell lane (the spec then skips itself). */
export function cellOrNull(): Cell | null {
  const raw = process.env.MAUDE_E2E_TEAM_CELL;
  return raw ? (JSON.parse(raw) as Cell) : null;
}

export function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export async function eventually(
  what: string,
  fn: () => boolean | Promise<boolean>,
  timeout = 60_000
): Promise<void> {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

export type Answer = { status: number; body: any };

/** A request to bob's own studio, from the shell (same origin — what the app's own buttons do). */
export async function bob(method: 'GET' | 'POST', route: string, body?: unknown): Promise<Answer> {
  return (await browser.execute(
    (m: string, r: string, b: unknown) =>
      fetch(r, {
        method: m,
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: m === 'POST' ? JSON.stringify(b ?? {}) : undefined,
      }).then(async (res) => {
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep the text */
        }
        return { status: res.status, body: parsed };
      }),
    method,
    route,
    body
  )) as Answer;
}

/**
 * A request to alice's studio (a plain local studio on the teammate's folder, signed in to the cell as alice). A
 * write needs the same-origin `Origin` of a loopback page — the one the studio's own shell sends.
 */
export async function alice(
  c: Cell,
  method: 'GET' | 'POST',
  route: string,
  body?: unknown
): Promise<Answer> {
  const base = `http://127.0.0.1:${c.teammatePort}`;
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', origin: base },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the text */
  }
  return { status: res.status, body: parsed };
}

/** A `DCArtboard` canvas with the given artboard ids, each a plain card with its own words. */
export function canvasWithArtboards(title: string, ids: string[]): string {
  const boards = ids
    .map(
      (id) =>
        `        <DCArtboard id="${id}" label="${id.toUpperCase()}" width={320} height={200}>
          <h2 style={{ padding: 24, fontFamily: "system-ui", color: "#111" }}>${title} ${id}</h2>
        </DCArtboard>`
    )
    .join('\n');
  return `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="${title}">
${boards}
      </DCSection>
    </DesignCanvas>
  );
}
`;
}
