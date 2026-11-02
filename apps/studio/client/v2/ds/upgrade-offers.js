// client/v2/ds/upgrade-offers.js — p8-v1-drop: which design systems are offered "Bring it up to the schema" right
// now, so ⌘K can offer it as well as the system's own row (⋯ and the amber dot). The Canvases panel publishes
// the systems below Conformant it draws (pinned-rows.js `dsAmber`, from `GET /_api/ds/state`); ⌘K reads them
// (the `dsUpgradeOffered` fact and the `ds.upgrade` row with no system named — menu-runner.js). Closing the
// sheet never removes an offer: only a system that reaches Conformant leaves the list.

let offers = [];
const subs = new Set();

/** @param {string[]} names the systems that are below Conformant (in the panel's order) */
export function setUpgradeOffers(names) {
  const next = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n) : [];
  if (next.length === offers.length && next.every((n, i) => n === offers[i])) return;
  offers = next;
  for (const fn of [...subs]) fn(offers);
}

/** The systems offered now (a copy). */
export function upgradeOffers() {
  return [...offers];
}

export function onUpgradeOffers(fn) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Test seam. */
export function resetUpgradeOffers() {
  offers = [];
  subs.clear();
}
