import { execFileSync } from 'node:child_process';

/** wdio.conf.ts `E2E_BUNDLE_ID` (not imported: a worker re-evaluating the config has side effects). */
const E2E_BUNDLE_ID = 'com.maude.app.e2e';

/**
 * Make the e2e app the active app, so its window is on top and is the key window.
 *
 * A covered WKWebView is throttled (timers, rAF, layout — memory maude-webkit-locked-screen-invalid) and a window
 * that is not key has `document.hasFocus() === false`, which the shell's canvas ⌘Z gate requires. The app does not
 * reliably come to the front at launch (another app — the person's chat — keeps it), and whatever the person clicks
 * during a long lane takes it away again, so the harness asks before every test (wdio.conf.ts `beforeTest`), not
 * only once. Only the e2e bundle id is named: the person's own Maude is never touched. NEVER a bare `activate`:
 * for an app that is not running (a relaunch lane between launches) that would LAUNCH it through LaunchServices,
 * without the harness's env — so without its throwaway config home. macOS only; best effort — the spec's own
 * waits name the failure when the app still is not in front.
 */
export function bringAppToFront(): void {
  if (process.platform !== 'darwin') return;
  const script = `if application id "${E2E_BUNDLE_ID}" is running then tell application id "${E2E_BUNDLE_ID}" to activate`;
  try {
    execFileSync('osascript', ['-e', script], {
      timeout: 5000,
      stdio: 'ignore',
    });
  } catch {
    /* best effort */
  }
}
