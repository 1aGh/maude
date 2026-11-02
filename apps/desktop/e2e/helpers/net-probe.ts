import { browser } from '@wdio/globals';
import { capture } from './evidence';

/**
 * A diagnostic for a step whose write "never reached the file": wrap the shell's `fetch` so every `/_api/*` answer
 * (method, url, status, the first bytes of the body) is kept on `window.__netProbe`. `netProbeLog()` reads it back.
 * A spec that fails on a missing write calls `installNetProbe()` before the gesture and `console.error`s
 * `await netProbeLog()` in the failure message — the answer the studio gave is then in the run log, not guessed.
 */
export async function installNetProbe(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as {
      __netProbe?: { m: string; u: string; s: number; b: string; q?: string }[];
      __netProbeOn?: boolean;
    };
    if (w.__netProbeOn) return;
    w.__netProbeOn = true;
    w.__netProbe = [];
    // the shell's fetch, and the canvas frame's (same-origin in the lane): a drop or an edit the CANVAS posts is seen too
    const wrap = (win: Window & typeof globalThis, tag: string) => {
      const orig = win.fetch.bind(win);
      win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await orig(input, init);
        try {
          const u =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (u.includes('/_api/')) {
            const b = await res
              .clone()
              .text()
              .catch(() => '');
            w.__netProbe?.push({
              m: `${tag}${(init?.method ?? 'GET').toUpperCase()}`,
              u: u.slice(0, 160),
              s: res.status,
              b: b.slice(0, 400),
              // what was ASKED, for a write the studio refused (the params, e.g. a split's frame)
              ...(typeof init?.body === 'string' ? { q: init.body.slice(0, 300) } : {}),
            });
          }
        } catch {
          /* diagnostics only */
        }
        return res;
      };
    };
    wrap(window, '');
    try {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
      if (frame?.contentWindow) wrap(frame.contentWindow as Window & typeof globalThis, 'canvas ');
    } catch {
      /* cross-origin frame: shell only */
    }
  });
}

/** Run a step; when it throws, the error carries the writes the studio answered meanwhile. */
export async function withNetProbe<T>(step: () => Promise<T>, writesOnly = true): Promise<T> {
  await installNetProbe();
  try {
    return await step();
  } catch (e) {
    const shot = await capture('step-failed').catch(() => '(no screenshot)');
    const log = await netProbeLog(writesOnly).catch(() => '(probe unreadable)');
    const panel = (await browser
      .execute(() => {
        const el = document.querySelector('[data-testid="inspector-frame"]') as HTMLElement | null;
        return el
          ? `${el.getAttribute('data-kind')}: ${(el.innerText || '').replace(/\s+/g, ' ').slice(0, 400)}`
          : '(no inspector-frame)';
      })
      .catch(() => '(unreadable)')) as string;
    throw new Error(
      `${(e as Error).message}\n--- /_api calls seen ---\n${log || '(none)'}\n--- inspector ---\n${panel}\n--- screenshot ---\n${shot}`
    );
  }
}

/** The writes (non-GET) the probe saw, newest last. */
export async function netProbeLog(writesOnly = true): Promise<string> {
  const rows = (await browser.execute(
    () => (window as unknown as { __netProbe?: unknown[] }).__netProbe ?? []
  )) as { m: string; u: string; s: number; b: string; q?: string }[];
  return rows
    .filter((r) => !writesOnly || !r.m.endsWith('GET'))
    .map((r) => `${r.m} ${r.u}${r.q ? ` <- ${r.q}` : ''} -> ${r.s} ${r.b}`)
    .join('\n');
}

/** The lines that differ between two texts, for a "put the file back exactly" failure message. */
export function lineDiff(before: string, after: string, max = 12): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < max; i++)
    if (a[i] !== b[i]) out.push(`@${i + 1}\n  - ${a[i] ?? '(none)'}\n  + ${b[i] ?? '(none)'}`);
  return out.length ? out.join('\n') : '(identical)';
}
