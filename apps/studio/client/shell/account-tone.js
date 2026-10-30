// client/shell/account-tone.js — ONE tone per account, on every surface (P8-C8, CONTRACT "One form
// everywhere"; canvas 11 · ACCT). Home's account face, the Share cluster's chip + card and the desktop
// tab strip's badge (`apps/desktop/src-tauri/src/tabs.rs` `account_tone` — the Rust twin, same table, same
// hash) all call this, so Work is the same sky on all of them and Personal the same yellow.
//
// Board: Work = sky, Personal = yellow. Any other account hashes into the object palette and keeps its
// tone for good. `default` IS the legacy install, which the product words as "Personal".

export const ACCOUNT_TONES = ['lilac', 'yellow', 'sky', 'green', 'coral'];

const NAMED = { work: 'sky', personal: 'yellow', default: 'yellow' };

/**
 * @param {string} id     the profile id
 * @param {string} [label] the profile's label ("Work") — a named account wears its named tone
 * @returns {'lilac'|'yellow'|'sky'|'green'|'coral'}
 */
export function accountTone(id, label = '') {
  const key = String(id ?? '').toLowerCase();
  if (NAMED[key]) return NAMED[key];
  const word = String(label ?? '')
    .trim()
    .toLowerCase();
  if (word === 'work' || word === 'personal') return NAMED[word];
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCOUNT_TONES[h % ACCOUNT_TONES.length];
}
