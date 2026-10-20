// The canvas shell's per-system fallback block (V2-1.13 §5.5, patch requests P-1/P-2): the
// roles and classes the canvas's system never declares, inside `@layer maude.fallback`,
// injected inline before the tokens stylesheet. Cached by the digest of the system's tokens
// and components files plus its config entry (rootClass is in the scope selector), so an edit
// to any of them refreshes it on the next shell load.
//
// S10.4b: the same slot carries a switched canvas's `dsPairing` aliases (ds/pairing-css.ts) after the
// layered block — unlayered, so they beat a fallback for the same name. And the system is found for
// a revision stylesheet too (`<ds>/revisions/<id>.tokens.css`, what a converted system's canvases
// load), not only for the working tokens.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredBy, renderFallbacks } from './fallbacks.ts';
import { pairingCssFor, systemForTokens } from './pairing-css.ts';
import { loadRegistry } from './registry.ts';
import { diskFs, loadSystem } from './system.ts';

export const FALLBACKS_SLOT = '<style id="canvas-fallbacks" data-canvas-css="fallbacks"></style>';

const cache = new Map<string, { digest: string; css: string }>();

function digestOf(designRoot: string, rels: string[]): string {
  const h = createHash('sha256');
  for (const rel of rels) {
    try {
      h.update(readFileSync(join(designRoot, rel)));
    } catch {
      h.update('\0absent\0');
    }
    h.update('\0');
  }
  return h.digest('hex');
}

/** The fallback CSS for the system whose tokens stylesheet is `tokensRel`, or '' when none. */
export function fallbacksFor(
  designRoot: string,
  config: Record<string, unknown>,
  tokensRel: string | null
): string {
  const sys = systemForTokens(config, tokensRel);
  if (!sys) return '';
  const rels = [sys.tokensCssRel, `${sys.path}/preview/_components.css`];
  const digest = `${digestOf(designRoot, rels)}:${JSON.stringify(sys)}`;
  const hit = cache.get(sys.name);
  if (hit?.digest === digest) return hit.css;
  const css = renderFallbacks(loadRegistry(), declaredBy(loadSystem(diskFs(designRoot), sys)));
  cache.set(sys.name, { digest, css });
  return css;
}

/**
 * Fill the shell's empty fallback slot (a no-op when the template has none). `metaText` is a past
 * version's meta lane (`?sha=`), so its own pairing applies.
 */
export function injectFallbacks(
  html: string,
  designRoot: string,
  config: Record<string, unknown>,
  query: URLSearchParams | null | undefined,
  metaText?: string | null
): string {
  if (!html.includes(FALLBACKS_SLOT)) return html;
  let css = '';
  try {
    css = fallbacksFor(designRoot, config, query?.get('tokens') ?? null);
  } catch {
    css = ''; // a broken system file must never take the canvas down
  }
  try {
    const aliases = pairingCssFor(designRoot, config, query, metaText);
    if (aliases) css = css ? `${css.replace(/\n?$/, '\n')}${aliases}` : aliases;
  } catch {
    // a broken meta must never take the canvas down either
  }
  if (!css) return html;
  // registry-generated CSS; the only system-derived input is which names to OMIT
  return html.replace(
    FALLBACKS_SLOT,
    FALLBACKS_SLOT.replace('></style>', `>\n${css.replace(/<\//g, '<\\/')}</style>`)
  );
}
