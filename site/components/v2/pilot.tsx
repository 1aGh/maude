// The private-pilot copy and the Cloud call to action live HERE and nowhere else. Task B2 (live
// payments) removes the pilot in one edit: empty PILOT_ON, point CLOUD_START at the checkout.
import { Icon } from './kit/glyphs';

/** True while Maude Cloud takes no live payments. */
export const PILOT_ON = true;

/** Every price and pricing link on the site (nav, footer, Home's Cloud band, the hero line, /cloud,
 *  the docs pricing page). Off until Cloud opens with its final prices: /cloud and
 *  /docs/cloud/pricing redirect away (next.config.mjs) and the docs sidebar drops the page
 *  (content/docs/cloud/meta.json). Turning it on means flipping this AND those two files back.
 *  The legal pages keep their prices: they are the contract text Stripe links to. */
export const PRICING_ON = false;

/** Every "Get Maude Cloud" / "Try Maude Cloud" / plan button on the site. Off until Cloud opens for
 *  sign-up (live Stripe catalog, checkout change, B3 purchase): the pricing stays visible, the
 *  buttons don't render, and the plan cards say "Opening soon". One edit turns them back on. */
export const CLOUD_CTA_ON = false;

/** Shown where a plan button would be while CLOUD_CTA_ON is off. */
export function OpeningSoon() {
  return <span className="ps-small ps-soon">Opening soon</span>;
}

/** Where "Get Maude Cloud" leads. Until payments are live it is the page that explains the pilot. */
export const CLOUD_START = '/docs/cloud/pricing';

/** The short form, for a fine-print line. */
export const PILOT_FINE = PILOT_ON ? 'Private pilot. ' : '';

/** The badge above the Cloud page headline. */
export function PilotBadge() {
  if (!PILOT_ON) return null;
  return (
    <span className="ps-pilot">
      <Icon name="cloud" size={14} /> Private pilot · these are the intended prices
    </span>
  );
}
