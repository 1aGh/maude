/**
 * Waits that RE-QUERY on every poll, for the long ones (a minute and more: first boot, a sync round, a sign-in).
 *
 * `await $(sel)` followed by `handle.waitForDisplayed({ timeout: 120_000 })` polls ONE element for the whole
 * budget. A node the app remounts after the find (the project pill, a canvas row, a card re-keyed by a sync
 * round) is a dead handle, and the vendored macOS WebDriver used to report that as WebKit's opaque "A JavaScript
 * exception occurred" instead of `stale element reference`, so webdriverio never refetched and the step failed
 * while the element was on screen (the V2-8.3 tabs red, 2026-10-28). The driver now maps it
 * (`describe_ns_error`, vendor/tauri-plugin-wdio-webdriver/VENDORED.md), but a wait that holds no handle does not
 * depend on that: it asks the page again each round.
 */

export interface PollOptions {
  /** Wait for the element to be gone (not displayed / not in the DOM) instead of present. */
  reverse?: boolean;
  /** Test presence in the DOM rather than visibility. */
  exist?: boolean;
  timeoutMsg?: string;
}

/** Wait, for up to `timeout` ms, until `selector` is displayed (or, with `exist`, in the DOM). */
export async function waitShown(
  selector: string,
  timeout: number,
  { reverse = false, exist = false, timeoutMsg }: PollOptions = {}
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const here = await (exist ? $(selector).isExisting() : $(selector).isDisplayed()).catch(
        () => false
      );
      return reverse ? !here : here;
    },
    {
      timeout,
      interval: 250,
      timeoutMsg:
        timeoutMsg ??
        `${selector} was not ${reverse ? 'gone' : exist ? 'in the DOM' : 'displayed'} within ${timeout} ms`,
    }
  );
}
