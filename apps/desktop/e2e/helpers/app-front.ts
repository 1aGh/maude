import { execFile, execFileSync, spawn } from 'node:child_process';

/** wdio.conf.ts `E2E_BUNDLE_ID` (not imported: a worker re-evaluating the config has side effects). */
const E2E_BUNDLE_ID = 'com.maude.app.e2e';

/**
 * The arguments every e2e app launch carries. `-ApplePersistenceIgnoreState YES` is an NSArgumentDomain default
 * (this process only, nothing written): without it, one crashed app leaves macOS's modal "quit unexpectedly while
 * reopening windows" dialog in front of the next launch — on the person's screen, and in the way of every later spec.
 */
export const E2E_APP_ARGS = Object.freeze(['-ApplePersistenceIgnoreState', 'YES']);

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

let awake: ReturnType<typeof spawn> | null = null;

/**
 * Keep the display on for as long as this lane's launcher lives: `caffeinate -d -w <launcher pid>`, a power
 * assertion of this process tree only (no setting changes, it ends with the launcher). With the Mac's display sleep
 * after 5 idle minutes, a lane nobody touches went dark and WebKit hid every webview (`document.hidden` everywhere):
 * 2026-10-27 diag pass, 8 of 9 reds inside the 19:05–19:29 dark window ("no visible tab after 30 s"). macOS only;
 * best effort, called from wdio.conf.ts `onPrepare` (the launcher, not a worker).
 */
export function holdDisplayAwake(): void {
  if (process.platform !== 'darwin' || awake) return;
  try {
    awake = spawn('caffeinate', ['-d', '-i', '-w', String(process.pid)], { stdio: 'ignore', detached: false });
    awake.on('error', () => {
      awake = null;
    });
    awake.unref();
  } catch {
    awake = null;
  }
}

let keeper: ReturnType<typeof setInterval> | null = null;

/**
 * MAUDE_E2E_KEEP_FRONT=1 (opt-in; the screen-owning gate run sets it): keep the e2e app the ACTIVE app for the
 * whole spec, not only at each test's start. `beforeTest` was not enough on a shared desktop — another app took
 * the focus for minutes in the middle of a spec (r7fix/a3: the probe saw Claude active while the Maude window was
 * on screen), and a window blur is product behaviour, not noise: it closes the project menu and ends an editor.
 * Through NSRunningApplication by bundle id (JXA, no Apple Event — so no automation prompt), which can only raise a
 * process that is already running — never LaunchServices' `activate`, which would launch a quitting app without
 * the harness's env. Asynchronous and unref'd: a worker exits as if it were not there.
 */
export function keepAppInFront(): void {
  if (keeper || process.platform !== 'darwin' || process.env.MAUDE_E2E_KEEP_FRONT !== '1') return;
  const script = `ObjC.import('AppKit'); const a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('${E2E_BUNDLE_ID}'); if (a.count > 0 && !a.objectAtIndex(0).active) a.objectAtIndex(0).activateWithOptions($.NSApplicationActivateIgnoringOtherApps);`;
  keeper = setInterval(() => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 3000 }, () => {
      /* not running (between launches) or no access: nothing to raise */
    });
  }, 1500);
  keeper.unref();
}
