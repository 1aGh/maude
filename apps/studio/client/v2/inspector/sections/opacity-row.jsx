// client/v2/inspector/sections/opacity-row.jsx — S2.4: the Opacity row (14 Editing: "Opacity 100 %").
// Under Effects for one object, under Fill for several (the Mixed inspector draws it there). Shared by both.

import { opacityFromCss, opacityToCss, reduceMixed } from '../../../../edit-ops/words-paint.ts';
import { NumberField } from '../../../inspector-controls.jsx';
import { Row } from './row.jsx';

/** @param {{ cssAll: Array<Record<string,string>>, editable: boolean, write: (patch: Record<string, string|null>) => void }} props */
export function OpacityRow({ cssAll, editable, write }) {
  const r = reduceMixed(cssAll.map(opacityFromCss));
  const value = r.mixed ? 100 : r.value;
  return (
    <Row k="Opacity" name="opacity">
      <span className="insp-pair">
        {r.mixed ? (
          <span className="insp-mixed" data-testid="insp-mixed-opacity">
            Mixed
          </span>
        ) : null}
        <span data-testid="insp-num-opacity" data-quiet={r.mixed ? 'true' : undefined}>
          <NumberField
            value={value}
            min={0}
            max={100}
            steppers={false}
            scrub={false}
            className="insp-nf"
            ariaLabel="Opacity"
            format={(n) => `${n} %`}
            onCommit={(n) => editable && (r.mixed || n !== value) && write(opacityToCss(n))}
          />
        </span>
      </span>
    </Row>
  );
}
