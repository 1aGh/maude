// One generated Cloud price or storage figure inside docs MDX, so docs and the /cloud page can't
// drift from apps/cloud/pricing.json: <CloudPrice of="project" />, <CloudPrice of="projectCz" />.
import { PRICE } from './price';

type Key =
  | 'project'
  | 'projectYear'
  | 'yearFree'
  | 'projectGb'
  | 'dedicated'
  | 'dedicatedGb'
  | 'projectCz'
  | 'trialDays';

export function CloudPrice({ of }: { of: Key }) {
  const v = PRICE[of];
  return <>{of.endsWith('Gb') ? `${v} GB` : String(v)}</>;
}
