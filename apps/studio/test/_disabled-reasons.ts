// p8-lock-reasons — the rendered-panel half of "every disabled control says why" (the source half is
// _dead-controls.ts). Walk a mounted panel and list each disabled control that carries no reason, by the rule
// the dead-control crawl reads (scripts/v2-verify/dead-controls/page-probe.mjs `reasonOf`): its own `title` /
// `aria-description` / `data-reason` / `aria-describedby`, or — for a control a disabled fieldset turns off
// (the inspector's view-mode switch) — that fieldset's own `title` / `aria-description`.

const CONTROLS =
  'button, input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=tab]';

const said = (el: Element | null): string => {
  if (!el) return '';
  for (const a of ['title', 'aria-description', 'data-reason']) {
    const t = el.getAttribute(a)?.trim();
    if (t) return t;
  }
  for (const id of (el.getAttribute('aria-describedby') || '').split(/\s+/)) {
    const t = id ? el.ownerDocument.getElementById(id)?.textContent?.trim() : '';
    if (t) return t;
  }
  return '';
};

/** Is this control off — its own `disabled` / `aria-disabled`, or a disabled fieldset around it? */
export function isOff(el: Element): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    !!el.closest('fieldset[disabled]')
  );
}

/** Why it is off, in the words a person is shown ('' = nothing). */
export function reasonOf(el: Element): string {
  return said(el) || said(el.closest('fieldset[disabled]'));
}

/** Each disabled control under `root` with no reason, as a short label (`[]` = every one says why). */
export function silentDisabled(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(CONTROLS))
    .filter((el) => isOff(el) && !reasonOf(el))
    .map(
      (el) =>
        el.getAttribute('data-testid') ||
        el.getAttribute('aria-label') ||
        el.textContent?.trim().slice(0, 40) ||
        el.tagName.toLowerCase()
    );
}
