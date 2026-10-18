import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * Exports panel — the native half (S8.23, apps/desktop/src-tauri/src/export_save.rs).
 *
 * S8.4 owns the panel UI (rows, done toast, Retry) and adds its legs here; this file
 * starts with what only the shell can do and a browser can't fake:
 *
 *   - Save to: `save_export` writes the finished job's bytes (Rust fetches them from
 *     this project's own server by job id) and returns the path. The first save asks
 *     (the debug build's MAUDE_E2E_SAVE_PATH stands in for the panel — set in
 *     wdio.conf.ts); its folder becomes the project's remembered folder, so
 *     `saveTo:'remembered'` writes straight in, numbered, never replacing a file.
 *   - Show in Finder: `reveal_export` takes only a path `save_export` returned this
 *     run (MAUDE_E2E_NO_REVEAL stops short of popping Finder); anything else gets the
 *     one refusal.
 *   - Copy as PNG: `clipboard_write_png` puts a whole PNG on the general pasteboard
 *     (read back with `osascript -e 'clipboard info'`) and refuses anything else.
 *
 * DOM-driven only (no computer-use). A WebKit window must be on screen (memory: a
 * locked screen freezes WebKit and the run is invalid).
 */

const REFUSED = "Maude didn't save that file.";

/** Invoke a command and hand back `{ ok, value }` or `{ ok:false, why }` — never `error`
 * (a WebDriver result carrying an `error` key reads as a protocol error). */
async function call(
  cmd: string,
  args: unknown
): Promise<{ ok: boolean; value?: unknown; why?: string }> {
  return browser.execute(
    async (c: string, a: unknown, raw: boolean) => {
      // biome-ignore lint/suspicious/noExplicitAny: __TAURI__ is an injected global
      const tauri = (window as any).__TAURI__;
      try {
        const body = raw ? new Uint8Array(a as number[]) : a;
        return { ok: true, value: await tauri.core.invoke(c, body) };
      } catch (e) {
        return { ok: false, why: typeof e === 'string' ? e : String((e as Error)?.message ?? e) };
      }
    },
    cmd,
    args instanceof Uint8Array ? Array.from(args) : args,
    args instanceof Uint8Array
  );
}

async function exportPng(): Promise<string> {
  const before: string[] = await browser.execute(async () => {
    const r = await fetch('/_api/export-history');
    return ((await r.json()) as { history: Array<{ id: string }> }).history.map((h) => h.id);
  });
  await browser.execute(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'E', metaKey: true, shiftKey: true, bubbles: true })
    );
  });
  await (await $('[data-testid="export-submit"]')).waitForDisplayed({ timeout: 20_000 });
  await (await $('[data-testid="export-format-png"]')).click();
  await (await $('[data-testid="export-submit"]')).click();
  let job: { id?: string; status?: string; reason?: string } = {};
  await browser.waitUntil(
    async () => {
      job = await browser.execute(async (seen: string[]) => {
        const r = await fetch('/_api/export-history');
        const { history } = (await r.json()) as {
          history: Array<{ id: string; format: string; status: string; error?: string }>;
        };
        const row = history.find((h) => h.format === 'png' && !seen.includes(h.id));
        return row ? { id: row.id, status: row.status, reason: row.error } : {};
      }, before);
      return job.status === 'done' || job.status === 'failed';
    },
    { timeout: 240_000, interval: 1000, timeoutMsg: 'no new PNG export finished' }
  );
  expect(`png: ${job.status} ${job.reason ?? ''}`.trim()).toBe('png: done');
  return job.id as string;
}

const isPng = (p: string) =>
  readFileSync(p)
    .subarray(0, 4)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

describe('exports-panel (native-desktop)', () => {
  let jobId = '';
  const savePath = process.env.MAUDE_E2E_SAVE_PATH ?? '';

  before(async function () {
    this.timeout(300_000);
    startReport('exports-panel (native-desktop)');
    expect(await isNativeShell()).toBe(true);
    expect(savePath).not.toBe('');
    mkdirSync(dirname(savePath), { recursive: true });
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-export');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    jobId = await exportPng();
    await capture('export-png-done');
  });

  it('Save to asks once, then writes into the remembered folder without replacing a file', async () => {
    const first = await call('save_export', { jobId, filename: 'Panel Hero.png' });
    expect(first.ok).toBe(true);
    const folder = realpathSync(dirname(savePath));
    expect(first.value).toBe(join(folder, 'native-save.png'));
    expect(isPng(first.value as string)).toBe(true);

    const second = await call('save_export', {
      jobId,
      filename: 'Panel Hero.png',
      saveTo: 'remembered',
    });
    const third = await call('save_export', {
      jobId,
      filename: 'Panel Hero.png',
      saveTo: 'remembered',
    });
    expect(second.value).toBe(join(folder, 'Panel Hero.png'));
    expect(third.value).toBe(join(folder, 'Panel Hero (2).png'));
    expect(isPng(third.value as string)).toBe(true);
    // A name cannot leave the folder.
    const sneaky = await call('save_export', {
      jobId,
      filename: '../../escape.png',
      saveTo: 'remembered',
    });
    expect(sneaky.value).toBe(join(folder, 'escape.png'));
    // The folder is remembered on this Mac, never in the project.
    const config = join(process.env.MAUDE_PROJECT_ROOT ?? '', '.design', 'config.json');
    if (existsSync(config)) expect(readFileSync(config, 'utf8')).not.toContain(folder);
    // A job id that is not one, and a place that is not one, are refused.
    expect((await call('save_export', { jobId: '../x', filename: 'a.png' })).ok).toBe(false);
    expect((await call('save_export', { jobId, filename: 'a.png', saveTo: '/etc' })).ok).toBe(
      false
    );
  });

  it('Show in Finder reveals only a file this session saved', async () => {
    const saved = (
      await call('save_export', { jobId, filename: 'Reveal me.png', saveTo: 'remembered' })
    ).value as string;
    expect(await call('reveal_export', { path: saved })).toEqual({ ok: true, value: null });
    for (const path of [
      '/etc/hosts',
      join(dirname(saved), 'never-written.png'),
      join(dirname(saved), 'sub', '..', 'Reveal me.png'),
      'Reveal me.png',
    ]) {
      expect(await call('reveal_export', { path })).toEqual({ ok: false, why: REFUSED });
    }
  });

  it('Copy as PNG puts a whole PNG on the pasteboard and refuses anything else', async function () {
    if (process.platform !== 'darwin') this.skip();
    const bytes: number[] = await browser.execute(async (id: string) => {
      const r = await fetch(`/_api/export-jobs/download?id=${id}`);
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, jobId);
    const ok = await call('clipboard_write_png', new Uint8Array(bytes));
    expect(ok).toEqual({ ok: true, value: null });
    expect(execFileSync('osascript', ['-e', 'clipboard info'], { encoding: 'utf8' })).toContain(
      'PNGf'
    );
    const jpeg = await call(
      'clipboard_write_png',
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
    );
    expect(jpeg).toEqual({ ok: false, why: "That isn't a PNG image." });
    // A JSON body (not the raw bytes) is refused too.
    expect((await call('clipboard_write_png', { bytes })).ok).toBe(false);
    await capture('clipboard-png');
  });
});
