// Copy presentation link — S3.7b (S3-present-session §5, md-present-link).
//
// The link is `<cloud origin>/present/<rel without .tsx>`, each segment encoded — the hub's
// `GET /present/<canvas>` (apps/hub/src/routes-v2/present.mjs) turns it into the follower root
// for a signed-in person with Can view on that canvas. The cloud origin is the share link's
// public web origin (`buildShareLinks().web`, client/share-link.js): the linked hub on a desktop,
// the tab's own origin in a cloud tab, and nothing for a project that is not cloud-linked (a
// loopback hub is never a public link). The CLI twin is `presentationLinkFor` in
// cli/lib/design-open.mjs (`maude design open <canvas> --mode present`); a test holds them equal.
//
// Offline it WAITS (S3.8, 04 md-edge-offline note 25: "Copy presentation link waits for a connection"):
// nothing is copied and the row says why. A link handed out while the hub cannot be reached would point at a
// presentation nobody can follow yet; S3-present-session §5's earlier "offline it still copies" gave way to the
// drawn canvas, which outranks it.

/** Shown greyed in ⌘K outside a cloud-linked project (V2-4.9 decision 2 pattern). */
export const COPY_PRESENTATION_LINK_NOTE = 'in a cloud project';

/** …and while the network is off (S3.8). */
export const COPY_PRESENTATION_LINK_WAITS = 'waits for a connection';

/**
 * Can the row run now, and if not, why (the reason is the row's note). A project with no cloud link is the
 * more basic answer, so it outranks offline.
 */
export function copyAvailability({ webLink, online = true }) {
  if (typeof webLink !== 'string' || !webLink)
    return { enabled: false, reason: COPY_PRESENTATION_LINK_NOTE };
  if (online === false) return { enabled: false, reason: COPY_PRESENTATION_LINK_WAITS };
  return { enabled: true };
}

/** The presentation link for a design-root-relative canvas, or null. Pure. */
export function presentationLinkFor(rel, webLink) {
  if (typeof rel !== 'string' || !rel.endsWith('.tsx') || rel.length <= 4) return null;
  if (typeof webLink !== 'string' || !webLink) return null;
  let origin;
  try {
    const url = new URL(webLink);
    if (!/^https?:$/.test(url.protocol)) return null;
    origin = url.origin;
  } catch {
    return null;
  }
  const path = rel.slice(0, -4).split('/').map(encodeURIComponent).join('/');
  return `${origin}/present/${path}`;
}

/**
 * Copy it, and say so. `{ rel, webLink, online, writeText, notify }` → true when copied. Offline: nothing
 * is copied (see the header) and the toast names the wait.
 */
export async function copyPresentationLink({ rel, webLink, online, writeText, notify }) {
  const link = presentationLinkFor(rel, webLink);
  const avail = copyAvailability({ webLink: link ? webLink : null, online });
  if (!avail.enabled) {
    notify({ title: `Copy presentation link — ${avail.reason}`, kind: 'error' });
    return false;
  }
  try {
    await writeText(link);
  } catch {
    notify({ title: 'Could not copy the presentation link', kind: 'error' });
    return false;
  }
  notify({ title: 'Presentation link copied', kind: 'success' });
  return true;
}
