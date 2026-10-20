// client/v2/assets/details.jsx — an asset's details, per kind (S8.21; 12 · ia-asset-details). ⌘I / "Show details" opens it IN
// PLACE OF the list; "‹ Assets" goes back. Replaces the plain details card (S8.12).
//
//   photo       size · added · what was changed · Place · where it is used
//   Made by AI  the prompt, who made it and when, the one licence line (plainly, once) · Place · where it is used
//   footage     what AI saw and the good moments, read from the clip's `.footage.json` (never written here)
//   sound       length · size · and, when AI made it, its prompt
//
// "Used in" lists each canvas and the artboard that shows the asset; a row opens that artboard. Advanced (details-advanced.jsx)
// holds the stored name, the Original on this Mac, the edit files, the cut-out, how a canvas refers to it, and the command.
// A read only: it works for every role (Place is the one write, and it is hidden for a viewer — the studio refuses it anyway).

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { DetailsAdvanced } from './details-advanced.jsx';
import {
  addedText,
  detailsKind,
  editsLine,
  fallbackDetails,
  kindNoun,
  madeWith,
  momentText,
  placeText,
  sizeRow,
  titleOf,
  useRows,
  usedTitle,
} from './details-model.js';
import { useAssetDetails } from './use-asset-details.js';

function Row({ k, testid, children }) {
  return (
    <div className="lp-dt-row" data-testid={testid}>
      <span className="lp-dt-k">{k}</span>
      <span className="lp-dt-v">{children}</span>
    </div>
  );
}

function Hero({ d, url, onMedia }) {
  if (d.kind === 'video')
    return (
      // biome-ignore lint/a11y/useMediaCaption: a still look at the clip, no speech is played here
      <video
        className="lp-dt-pic"
        data-testid="assets-details-pic"
        src={url}
        controls
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) =>
          onMedia({
            width: e.currentTarget.videoWidth,
            height: e.currentTarget.videoHeight,
            duration: e.currentTarget.duration,
          })
        }
      />
    );
  if (d.kind === 'audio')
    return (
      <span className="lp-dt-snd">
        {/* biome-ignore lint/a11y/useMediaCaption: a sound has no picture to caption */}
        <audio
          data-testid="assets-details-pic"
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => onMedia({ duration: e.currentTarget.duration })}
        />
      </span>
    );
  return (
    <img
      className="lp-dt-pic"
      data-testid="assets-details-pic"
      src={url}
      alt=""
      draggable={false}
      onLoad={(e) =>
        onMedia({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
      }
    />
  );
}

export function AssetDetails({
  asset,
  url,
  placeLabel = null,
  canPlace = false,
  onPlace,
  onBack,
  onOpenBoard,
  fetchImpl,
  now,
}) {
  const got = useAssetDetails(asset.path, { fetchImpl });
  const d = got.details ?? fallbackDetails(asset);
  const [media, setMedia] = useState({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: another asset starts from nothing measured
  useEffect(() => setMedia({}), [asset.path]);
  const kind = detailsKind(d);
  const made = d.madeByAi;
  const size = sizeRow(d, media);
  const edits = editsLine(d);
  const rows = useRows(d);
  const used = usedTitle(asset, d);
  const showPlace = canPlace && d.kind === 'image';
  return (
    <section
      className="lp-dt"
      data-testid="assets-details"
      data-kind={kind}
      data-state={got.state}
      aria-label={`Details of ${d.name}`}
    >
      <div className="lp-dt-hd">
        <button
          type="button"
          className="lp-dt-back"
          data-testid="assets-details-close"
          onClick={onBack}
        >
          <StIcon name="chevron" size={12} />
          Assets
        </button>
      </div>
      <div className="lp-dt-heroed">
        <Hero d={d} url={url} onMedia={setMedia} />
        {made ? (
          <span className="lp-dt-made" data-testid="assets-details-made">
            <StIcon name="sparkle" size={9} />
            Made by AI
          </span>
        ) : null}
      </div>
      <p className="lp-dt-name" data-testid="assets-details-name" title={d.name}>
        {titleOf(d)}
      </p>

      {made ? (
        <>
          <Row k="Prompt" testid="assets-details-prompt">
            <span className="lp-dt-quote">{made.prompt}</span>
          </Row>
          <Row k="Made with" testid="assets-details-madewith">
            {madeWith(made)}
          </Row>
          {made.by ? <Row k="Asked by">{made.by}</Row> : null}
        </>
      ) : null}
      <Row k={size.k} testid="assets-details-size">
        {size.v}
      </Row>
      {!made && addedText(d.mtimeMs, now) ? (
        <Row k="Added" testid="assets-details-added">
          {addedText(d.mtimeMs, now)}
        </Row>
      ) : null}
      {edits ? (
        <Row k="Edits" testid="assets-details-edits">
          {edits}
        </Row>
      ) : null}
      {d.footage ? (
        <>
          {d.footage.summary ? (
            <Row k="AI saw" testid="assets-details-saw">
              <span className="lp-dt-quote">{d.footage.summary}</span>
            </Row>
          ) : null}
          {d.footage.tags.length ? (
            <Row k="Tags" testid="assets-details-tags">
              <span className="lp-dt-chips">
                {d.footage.tags.map((t) => (
                  <span key={t} className="lp-dt-chip">
                    {t}
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
          {d.footage.moments.length ? (
            <Row k="Good moments" testid="assets-details-moments">
              <span className="lp-dt-chips">
                {d.footage.moments.map((m) => (
                  <span key={`${m.start}-${m.end}`} className="lp-dt-chip">
                    {momentText(m)}
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
          {d.footage.speech ? <Row k="Said">{d.footage.speech}</Row> : null}
        </>
      ) : null}
      {made?.licence ? (
        <p className="lp-dt-fine" data-testid="assets-details-licence">
          {made.licence}
        </p>
      ) : null}

      {showPlace ? (
        <button
          type="button"
          className="lp-dt-place"
          data-testid="assets-details-place"
          onClick={() => onPlace?.(asset.path)}
        >
          {placeText(placeLabel)}
          <kbd className="lp-dt-kbd">↵</kbd>
        </button>
      ) : null}

      <p className="lp-dt-sec" data-testid="assets-details-used-title">
        {used ?? kindNoun(d)}
      </p>
      {rows.length ? (
        <div className="lp-dt-uses">
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className="lp-dt-use"
              data-testid="assets-details-use"
              data-canvas={r.canvas}
              data-board={r.boardId ?? undefined}
              aria-label={r.board ? `Open ${r.board} in ${r.name}` : `Open ${r.name}`}
              onClick={() => onOpenBoard?.(r.canvas, r.boardId)}
            >
              <span className="lp-dt-use-t">
                <span>{r.name}</span>
                {r.board ? <span className="lp-dt-use-b">{r.board}</span> : null}
              </span>
              <StIcon name="chevron" size={11} />
            </button>
          ))}
        </div>
      ) : null}

      <DetailsAdvanced details={d} />
    </section>
  );
}
