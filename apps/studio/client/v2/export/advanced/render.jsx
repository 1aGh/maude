// client/v2/export/advanced/render.jsx — S8.3: Advanced › Where it renders.
//
// The video lane (suggest each time · always the cloud · always this Mac) and the render service's
// state. A workspace without the render service always owes this answer here too (nothing-deleted
// A-render-service-note): the same note the sheet shows under Scope, with what it means for the export.

import { readLanePref, writeLanePref } from '../../../export-lane.js';
import { LANE_NONE_NOTE } from '../export-copy.js';
import { Row } from '../parts.jsx';
import {
  RENDER_NOTE_IMAGES,
  RENDER_NOTE_VIDEO,
  RENDER_SERVICE,
  RENDER_SERVICE_NAME,
  RENDER_STATUS,
  RENDER_TITLE,
  RENDER_VIDEO,
} from './advanced-copy.js';
import { Note, Select } from './fields.jsx';
import { LANES, renderStatus } from './model.js';

export function RenderPart({ spec, exportLane, video, setAdv }) {
  const status = renderStatus(exportLane);
  return (
    <section className="ex-advp" data-testid="export-adv-render" aria-label={RENDER_TITLE}>
      {video ? (
        <>
          <Row k={RENDER_VIDEO}>
            <Select
              label={RENDER_VIDEO}
              testid="export-adv-lane"
              value={spec.options?.lane ?? readLanePref()}
              options={LANES}
              onChange={(lane) => {
                // S8.5 — "Suggest each time · always the cloud · always this Mac" is a standing choice
                writeLanePref(lane);
                setAdv({ lane });
              }}
            />
          </Row>
          <Note>{RENDER_NOTE_VIDEO}</Note>
        </>
      ) : null}
      <Note>{RENDER_NOTE_IMAGES}</Note>
      <span className="ex-kv">
        <span>{RENDER_SERVICE}</span>
        <span className="ex-mono" data-testid="export-adv-render-service">
          {RENDER_SERVICE_NAME}
        </span>
      </span>
      <span className="ex-kv">
        <span>{RENDER_STATUS}</span>
        <span
          className={`ex-state ex-state--${status.ok ? 'ok' : 'off'}`}
          data-testid="export-adv-render-status"
        >
          {status.word}
        </span>
      </span>
      {exportLane === 'none' ? <Note testid="export-adv-lane-note">{LANE_NONE_NOTE}</Note> : null}
    </section>
  );
}
