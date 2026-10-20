// client/v2/export/preflight/paper.jsx — S8.7: the page the print shop gets, drawn from the artboard's own
// numbers (09 Export › ex-print, `Paper`). The preview IS the PDF's geometry: the art runs `bleed` past the
// cut (tinted), crop marks stand outside the bleed, registration marks sit on the side centres, the safe
// margin is dashed, and a violation is ringed. Untick Bleed and the paper shrinks to the trim — the same
// MediaBox the engine writes (exporters/pdf.ts applyPrintBoxesAndMarks). Millimetres × one scale.

const MAX_SCALE = 1.7; // px per mm, as drawn
const MARK_LEN_MM = 3.5;
const MARK_GAP_MM = 3;

/**
 * @param paper  { trimMm: [w, h], bleedMm, marginMm: [t, r, b, l] }
 * @param opts   { bleed, marks, registration, maxW, maxH }
 * @returns px geometry of the paper box and where everything sits inside it
 */
export function paperGeometry(
  paper,
  { bleed = true, marks = true, registration = false, maxW = 240, maxH = 260 } = {}
) {
  const [tw, th] = paper.trimMm;
  const b = bleed ? paper.bleedMm : 0;
  // marks (and registration) stand outside the bleed, so they widen the paper box
  const slugMm = marks || registration ? paper.bleedMm + MARK_GAP_MM + MARK_LEN_MM + 1 : 1;
  const s = Math.min(MAX_SCALE, maxW / (tw + 2 * slugMm), maxH / (th + 2 * slugMm));
  const pad = slugMm * s;
  return {
    s,
    pad,
    width: (tw + 2 * slugMm) * s,
    height: (th + 2 * slugMm) * s,
    // the art box (trim + bleed) and the trim box, in px from the paper's top-left
    art: { x: pad - b * s, y: pad - b * s, w: (tw + 2 * b) * s, h: (th + 2 * b) * s },
    trim: { x: pad, y: pad, w: tw * s, h: th * s },
    bleedPx: b * s,
    margin: paper.marginMm.map((m) => m * s),
    bleedMm: paper.bleedMm,
  };
}

/** The eight crop-mark strokes: a short horizontal and vertical at each trim corner, outside the bleed. */
export function cropStrokes(g) {
  const gap = (g.bleedMm + MARK_GAP_MM) * g.s;
  const len = MARK_LEN_MM * g.s;
  const { x, y, w, h } = g.trim;
  const out = [];
  for (const [cx, cy, dx, dy] of [
    [x, y, -1, -1],
    [x + w, y, 1, -1],
    [x, y + h, -1, 1],
    [x + w, y + h, 1, 1],
  ]) {
    out.push({ x: dx < 0 ? cx - gap - len : cx + gap, y: cy, w: len, h: 0 });
    out.push({ x: cx, y: dy < 0 ? cy - gap - len : cy + gap, w: 0, h: len });
  }
  return out;
}

/** Registration targets: the middle of each side, outside the bleed. */
export function registrationSpots(g) {
  const gap = (g.bleedMm + MARK_GAP_MM + MARK_LEN_MM / 2) * g.s;
  const { x, y, w, h } = g.trim;
  return [
    { x: x + w / 2, y: y - gap },
    { x: x + w / 2, y: y + h + gap },
    { x: x - gap, y: y + h / 2 },
    { x: x + w + gap, y: y + h / 2 },
  ];
}

const px = (n) => `${Math.round(n * 10) / 10}px`;

/**
 * @param paper     PaperInfo from the preflight reply
 * @param findings  safe-margin findings to ring (only the ones on this page)
 */
export function Paper({ paper, bleed, marks, registration, findings = [], stack = false }) {
  const g = paperGeometry(paper, { bleed, marks, registration });
  const rings = findings.map((f) => ({
    key: `${f.artboard}:${f.element ?? f.label}`,
    x: g.trim.x + f.box.x * g.s - 3,
    y: g.trim.y + f.box.y * g.s - 3,
    w: f.box.w * g.s + 6,
    h: f.box.h * g.s + 6,
  }));
  return (
    <span
      className="ex-paper-wrap"
      data-testid="export-paper"
      data-bleed={bleed ? 'true' : 'false'}
      data-marks={marks ? 'true' : 'false'}
      data-registration={registration ? 'true' : 'false'}
      style={{ width: px(g.width + (stack ? 8 : 0)), height: px(g.height + (stack ? 8 : 0)) }}
    >
      {stack ? (
        <span
          className="ex-paper ex-paper--under"
          style={{ width: px(g.width), height: px(g.height) }}
        />
      ) : null}
      <span className="ex-paper" style={{ width: px(g.width), height: px(g.height) }}>
        <span
          className="ex-paper-art"
          data-testid="export-paper-art"
          style={{ left: px(g.art.x), top: px(g.art.y), width: px(g.art.w), height: px(g.art.h) }}
        >
          {bleed && g.bleedPx > 0 ? (
            <span
              className="ex-tint"
              data-testid="export-paper-tint"
              style={{ borderWidth: px(g.bleedPx) }}
            />
          ) : null}
        </span>
        {marks
          ? cropStrokes(g).map((c) => (
              <i
                key={`${c.x}:${c.y}:${c.w}`}
                className="ex-crop"
                data-testid="export-paper-crop"
                style={{ left: px(c.x), top: px(c.y), width: px(c.w || 1), height: px(c.h || 1) }}
              />
            ))
          : null}
        {registration
          ? registrationSpots(g).map((r) => (
              <i
                key={`${r.x}:${r.y}`}
                className="ex-reg"
                data-testid="export-paper-registration"
                style={{ left: px(r.x - 5), top: px(r.y - 5) }}
              />
            ))
          : null}
        <span
          className="ex-margin"
          data-testid="export-paper-margin"
          style={{
            left: px(g.trim.x + g.margin[3]),
            top: px(g.trim.y + g.margin[0]),
            width: px(g.trim.w - g.margin[1] - g.margin[3]),
            height: px(g.trim.h - g.margin[0] - g.margin[2]),
          }}
        />
        {rings.map((r) => (
          <span
            key={r.key}
            className="ex-flag"
            data-testid="export-paper-flag"
            style={{ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) }}
          />
        ))}
      </span>
    </span>
  );
}
