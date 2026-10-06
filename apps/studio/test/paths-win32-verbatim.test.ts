// #141 — Tauri hands the sidecar a verbatim `\\?\C:\…` MAUDE_DEV_SERVER_ROOT on
// Windows; through DEV_SERVER_ROOT it became the ACP adapter's entry path, and
// `node \\?\C:\…\index.js` cannot start (nodejs/node#62446). Mirrors the Rust
// `strip_verbatim` tests in apps/desktop/src-tauri/src/win_process.rs.
import { describe, expect, test } from 'bun:test';
import { stripWin32Verbatim } from '../paths.ts';

describe('stripWin32Verbatim', () => {
  test('drops the drive verbatim prefix', () => {
    expect(stripWin32Verbatim('\\\\?\\C:\\Program Files\\Maude\\resources\\apps\\studio')).toBe(
      'C:\\Program Files\\Maude\\resources\\apps\\studio'
    );
  });

  test('turns a verbatim UNC path into an ordinary UNC path', () => {
    expect(stripWin32Verbatim('\\\\?\\UNC\\srv\\share\\Maude')).toBe('\\\\srv\\share\\Maude');
  });

  test('leaves ordinary, POSIX, volume-GUID and empty paths alone', () => {
    for (const p of [
      'C:\\Program Files\\Maude',
      '/Applications/Maude.app/Contents/Resources/apps/studio',
      '\\\\?\\Volume{1234}\\Maude',
      '\\\\srv\\share',
      '',
    ]) {
      expect(stripWin32Verbatim(p)).toBe(p);
    }
  });
});
