// client/v2/cloud/cloud-name.js — P5 / TD8 (UX audit F36, decision v2-p5-maude-cloud-noun): the ONE noun for
// the hosted service. Before: "cloud.maude.sh" (Home, Settings), "Maude Cloud" (format lines), "the cloud",
// "in a cloud project". Now: "Maude Cloud" everywhere. The address `cloud.maude.sh` is for the one place a
// person types or reads an ADDRESS (the activation URL, a project's host line) — never the name of the service.
// A self-hosted hub is not Maude Cloud: it shows its own name (the host it answers on).
//
// Pure (no DOM, no React) so Home, Settings, Share and the sheets read one thing.

/** The service, as a noun. CONTRACT §3. */
export const CLOUD_NAME = 'Maude Cloud';

/** The zone Maude Cloud's projects live under (the compiled-in one, browser-door.js `CELL_ZONE`). */
const ZONE = 'cloud.maude.sh';

/** The host of an address, or '' when it is not one. */
export function hostOf(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

/** True for Maude Cloud itself — the zone or a project's name under it. */
export function isMaudeCloud(url) {
  const h = hostOf(url);
  return h === ZONE || h.endsWith(`.${ZONE}`);
}

/**
 * What a hub is called in words: "Maude Cloud" for ours, the host for a self-hosted one
 * ("hub.example.org"), '' when the address says nothing.
 */
export function hubName(url) {
  if (isMaudeCloud(url)) return CLOUD_NAME;
  return hostOf(url);
}
