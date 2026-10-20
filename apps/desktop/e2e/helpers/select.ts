import { browser } from '@wdio/globals';

/**
 * Pick an option of a native `<select>` by its own `change`.
 *
 * The embedded WebDriver's option click (`selectByAttribute`) does not select in WKWebView, and the element it just found
 * can be re-rendered under it. This sets the value through the prototype's setter (so React's tracked value sees the
 * change) and raises `change`, in one in-page step. Returns false when the select or the option is not there.
 */
export function setSelect(testid: string, value: string): Promise<boolean> {
  return browser.execute(
    (id: string, want: string) => {
      const el = document.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`);
      if (!el || ![...el.options].some((o) => o.value === want)) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      set?.call(el, want);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    testid,
    value
  ) as Promise<boolean>;
}
