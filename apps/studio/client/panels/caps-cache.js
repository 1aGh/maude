// 2.0.5 - the last capability set (`{modes, configOptions}`: model, effort, permissions...) the AI answered with,
// kept per project so the Advanced fold can draw its rows on a fresh load WITHOUT starting Claude (a panel that
// only opened must not spawn the adapter - ChatPanel sends no `warm` on mount). The first live `caps` frame
// replaces it and refreshes the cache; a cached set is only ever shown, never acted on (no reconcile, no send).

const PREFIX = 'maude-acp-caps';

/** @param {string} scope the project's name (or its design folder when the name is not known yet) */
export function capsKeyFor(scope) {
  return `${PREFIX}:${scope || ''}`;
}

/** @param {{modes?: any, configOptions?: any[]}|null|undefined} caps */
export function isEmptyCaps(caps) {
  const modes = caps?.modes?.availableModes;
  const opts = caps?.configOptions;
  return !(Array.isArray(modes) && modes.length) && !(Array.isArray(opts) && opts.length);
}

/** @returns {{modes: any, configOptions: any[]}|null} the cached set, or null (none, corrupt, or empty) */
export function loadCachedCaps(key, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const caps = {
      modes: parsed?.modes && typeof parsed.modes === 'object' ? parsed.modes : null,
      configOptions: Array.isArray(parsed?.configOptions) ? parsed.configOptions : [],
    };
    return isEmptyCaps(caps) ? null : caps;
  } catch {
    return null;
  }
}

export function saveCachedCaps(key, caps, storage = globalThis.localStorage) {
  if (isEmptyCaps(caps)) return;
  try {
    storage?.setItem(
      key,
      JSON.stringify({ modes: caps.modes ?? null, configOptions: caps.configOptions })
    );
  } catch {
    /* private mode / unavailable - non-fatal */
  }
}
