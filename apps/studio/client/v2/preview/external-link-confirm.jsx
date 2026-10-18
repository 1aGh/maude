// client/v2/preview/external-link-confirm.jsx — S3.10b: a canvas link to a website (S3-links-format §6).
//
// The canvas never names a destination. It posts `link-follow {elementId, artboardId}` (input-router,
// Preview), the shell reads the target from the versioned TSX (`GET /_api/links`, link-follow.js) and,
// for an external target, comes HERE with the URL it read. This module:
//
//   1. re-checks the URL itself with the link grammar (`parseLinkTarget`, http/https only, no userinfo, no
//      loopback / link-local host) — a forged `/_api/links` body or a stale entry cannot widen it;
//   2. draws the trusted confirmation sheet ("Open a website?", the host in bold, `externalDisplay` beneath)
//      once per host per window session;
//   3. opens only from a human click: the sheet's **Open** click, or — for a host this window already
//      confirmed — a follow that arrives while the window holds a real user activation (the person's click
//      on the link, which the browser propagates from the canvas frame to the shell). A follow with no
//      activation (a planted canvas posting on its own) shows the sheet again instead of opening;
//   4. browser: `window.open(url, '_blank', 'noopener,noreferrer')` inside that click;
//      desktop: the `open_link_external` command (Rust re-checks everything, external_link.rs). When the
//      command refuses or is missing (an older build), the sheet shows the named fallback: the full URL as
//      selectable text, **Copy link**, "Paste it in your browser." — it opens nothing.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { externalDisplay, parseLinkTarget } from '../../../bridge/link-target.ts';
import { useModalFocus } from '../shell/modal-focus.js';

export const EXTERNAL_TITLE = 'Open a website?';
export const EXTERNAL_PASTE = 'Paste it in your browser.';
export const OPEN_FEATURES = 'noopener,noreferrer';

/** `{ url, host, display }` for a URL the link grammar accepts as a website, else null. Pure. */
export function checkExternal(url) {
  const t = parseLinkTarget(url);
  if (t?.kind !== 'external') return null;
  return { url: t.url, host: t.host, display: externalDisplay(t.url) };
}

/** Does this window hold a real user activation right now? (Fail closed when the browser can't say.) */
export function hasUserActivation(nav = typeof navigator === 'undefined' ? null : navigator) {
  return nav?.userActivation?.isActive === true;
}

/** A tiny store for the one open sheet (`null` when none). */
function createSheetStore() {
  let sheet = null;
  const subs = new Set();
  return {
    get: () => sheet,
    set(next) {
      sheet = next;
      for (const f of subs) f();
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

/**
 * The controller, one per shell window. deps:
 *   native()                      the desktop app (window.__TAURI__)
 *   invoke(cmd, args)             Tauri invoke (desktop)
 *   windowOpen(url, name, feats)  window.open (browser)
 *   activation()                  hasUserActivation()
 *   copy(text)                    → Promise (clipboard)
 */
export function createExternalLinks(deps) {
  const sheet = createSheetStore();
  /** Hosts this window session already confirmed. */
  const confirmed = new Set();

  const show = (link, fallback) => sheet.set({ ...link, fallback: !!fallback, copied: false });

  /** Open `link` now. Browser: synchronous (inside the click). Resolves true when it opened. */
  function launch(link) {
    if (!checkExternal(link.url)) return Promise.resolve(false);
    if (deps.native()) {
      return Promise.resolve()
        .then(() => deps.invoke('open_link_external', { url: link.url }))
        .then(
          () => true,
          () => false
        );
    }
    const w = deps.windowOpen(link.url, '_blank', OPEN_FEATURES);
    // `noopener` makes window.open return null even when it opened; a blocked popup throws or is
    // indistinguishable, so treat "no exception" as opened.
    void w;
    return Promise.resolve(true);
  }

  return {
    sheet,
    confirmed,
    /** A follow reached an external target. Returns what it did: 'open' | 'sheet' | null (dropped). */
    request(url) {
      const link = checkExternal(url);
      if (!link) return null;
      if (sheet.get()) return null; // one sheet at a time; the open one wins
      if (confirmed.has(link.host) && deps.activation()) {
        void launch(link).then((opened) => {
          if (!opened) show(link, deps.native());
        });
        return 'open';
      }
      show(link, false);
      return 'sheet';
    },
    /** The sheet's **Open** click — call it from the click handler itself. */
    confirm() {
      const cur = sheet.get();
      if (!cur || cur.fallback) return Promise.resolve(false);
      const link = checkExternal(cur.url);
      if (!link) {
        sheet.set(null);
        return Promise.resolve(false);
      }
      confirmed.add(link.host);
      return launch(link).then((opened) => {
        if (sheet.get()?.url !== link.url) return opened;
        if (opened) sheet.set(null);
        else show(link, true);
        return opened;
      });
    },
    copy() {
      const cur = sheet.get();
      if (!cur) return Promise.resolve(false);
      return Promise.resolve()
        .then(() => deps.copy(cur.url))
        .then(
          () => {
            if (sheet.get()?.url === cur.url) sheet.set({ ...sheet.get(), copied: true });
            return true;
          },
          () => false
        );
    },
    cancel() {
      sheet.set(null);
    },
  };
}

const defaultDeps = {
  native: () => typeof window !== 'undefined' && !!window.__TAURI__,
  invoke: (cmd, args) => window.__TAURI__.core.invoke(cmd, args),
  windowOpen: (url, name, feats) => window.open(url, name, feats),
  activation: () => hasUserActivation(),
  copy: (text) => navigator.clipboard.writeText(text),
};

/** The shell window's one controller. */
export const externalLinks = createExternalLinks(defaultDeps);

/**
 * The sheet. Pure render: `sheet` = `{ url, host, display, fallback, copied }`, plus the three actions.
 * `fallback` (desktop, no opener): no Open button, the full URL as selectable text, Copy link primary.
 */
export function ExternalLinkConfirm({ sheet, onOpen, onCopy, onCancel }) {
  const openRef = useRef(null);
  const copyRef = useRef(null);
  const ref = useModalFocus({ onClose: onCancel, initialRef: sheet.fallback ? copyRef : openRef });
  return (
    <div className="st-xlink-scrim" data-testid="ext-link-scrim">
      <div
        ref={ref}
        className="st-xlink island"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-xlink-t"
        aria-describedby="st-xlink-b"
        tabIndex={-1}
        data-testid="ext-link-confirm"
        data-fallback={sheet.fallback ? 'true' : undefined}
      >
        <h2 id="st-xlink-t" className="st-xlink-t">
          {EXTERNAL_TITLE}
        </h2>
        <div id="st-xlink-b" className="st-xlink-b">
          <strong className="st-xlink-host" data-testid="ext-link-host">
            {sheet.host}
          </strong>
          {sheet.fallback ? (
            <>
              <code className="st-xlink-url" data-testid="ext-link-url">
                {sheet.url}
              </code>
              <span className="st-xlink-hint">{EXTERNAL_PASTE}</span>
            </>
          ) : (
            <span className="st-xlink-display" data-testid="ext-link-display">
              {sheet.display}
            </span>
          )}
        </div>
        <div className="st-xlink-acts">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-testid="ext-link-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={copyRef}
            type="button"
            className={sheet.fallback ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
            data-testid="ext-link-copy"
            onClick={onCopy}
          >
            {sheet.copied ? 'Copied' : 'Copy link'}
          </button>
          {sheet.fallback ? null : (
            <button
              ref={openRef}
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="ext-link-open"
              onClick={onOpen}
            >
              Open
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The shell's mount: renders the controller's sheet; `active` false (left Preview) cancels it. */
export function ExternalLinkConfirmHost({ links = externalLinks, active = true }) {
  const sheet = useSyncExternalStore(links.sheet.subscribe, links.sheet.get, links.sheet.get);
  useEffect(() => {
    if (!active && links.sheet.get()) links.cancel();
  }, [active, links]);
  if (!sheet || !active) return null;
  return (
    <ExternalLinkConfirm
      sheet={sheet}
      onOpen={() => void links.confirm()}
      onCopy={() => void links.copy()}
      onCancel={() => links.cancel()}
    />
  );
}
