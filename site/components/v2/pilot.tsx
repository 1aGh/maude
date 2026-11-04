// The private-pilot copy and the Cloud call to action live HERE and nowhere else. Task B2 (live
// payments) removes the pilot in one edit: empty PILOT_ON, point CLOUD_START at the checkout.
import { Icon } from './kit/glyphs';

/** True while Maude Cloud takes no live payments. */
export const PILOT_ON = true;

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
