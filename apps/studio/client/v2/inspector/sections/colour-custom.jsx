// client/v2/inspector/sections/colour-custom.jsx — r4 #4 (Michal: "color picker bych udelal jak ma Figma"): the Custom
// half of the colour popover — what each paint kind needs to be drawn and edited.
//
//   SolidEditor     the saturation × brightness area, a hue rail, an alpha rail, an eyedropper (only where the browser has
//                   one), Hex · RGB · HSL fields and an alpha %
//   GradientEditor  Linear · Radial · Angular, a stops bar (click to add, drag to move, Delete to remove), each stop with
//                   its position, colour and alpha, and the picker for the selected stop
//   ImageEditor     Upload from computer, or a file in the project / an https:// address
//   PageColours     "On this page": the colours this canvas's own code uses
//
// Every control here writes through the host's callbacks: `onLive` while a drag is in flight (the canvas follows, nothing
// is written, no undo entry) and `onCommit` once on release, Enter or blur (one write, one undo step).

import { ArrowLeftRight, Minus, Pipette, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssets } from '../../assets/use-assets.js';
import { uploadAsset } from '../../../../asset-upload.ts';
import { imageUrlOk } from '../../../../edit-ops/words-paint.ts';
import { fetchCanvasSource } from '../../code/use-canvas-source.js';
import {
  GRADIENT_TYPES,
  GRADIENT_WORDS,
  addStop,
  coloursInSource,
  gradientCss,
  hexDigits,
  hslToRgb,
  hsvToRgb,
  parseGradient,
  parseHexInput,
  parseRgba,
  removeStop,
  reverseStops,
  rgbToHsl,
  rgbToHsv,
  rgbaCss,
  widestGap,
} from './colour-model.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const BAD_COLOUR = 'That isn’t one colour. Try a hex like #1E6BFF.';

/* ── On this page ───────────────────────────────────────────────────────────────────────────────────────────── */

/** The colours this canvas's own code uses (read once per canvas; a view-only session is refused and shows none). */
export function usePageColours(canvasFile, fetchImpl) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!canvasFile) return undefined;
    let live = true;
    fetchCanvasSource(canvasFile, fetchImpl ? { fetchImpl } : undefined)
      .then((r) => live && r?.status === 'ok' && setList(coloursInSource(r.source)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canvasFile, fetchImpl]);
  return list;
}

/* ── solid ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const hasEyedropper = () => typeof window !== 'undefined' && 'EyeDropper' in window;
const pct = (n) => Math.round(clamp(n, 0, 1) * 100);

function NumberBox({ value, onCommit, label, min = 0, max = 255, testid, suffix }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const go = (typed = txt) => {
    const n = Number.parseFloat(typed);
    if (!Number.isFinite(n)) return setTxt(String(value));
    const v = clamp(Math.round(n), min, max);
    setTxt(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <span className="insp-pk-num">
      <input
        className="insp-num-in"
        type="text"
        inputMode="numeric"
        aria-label={label}
        data-testid={testid}
        value={txt}
        onChange={(e) => setTxt(e.currentTarget.value)}
        onBlur={(e) => go(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && go(e.currentTarget.value)}
      />
      {suffix ? <i aria-hidden="true">{suffix}</i> : null}
    </span>
  );
}

/**
 * @param {{ name: string, rgba: {r:number,g:number,b:number,a:number}|null, onLive?: (c: object) => void,
 *   onCommit: (c: object) => void, onRaw?: (css: string) => boolean, compact?: boolean, alpha?: boolean }} props
 *   `onRaw(css)` takes any other CSS colour the Hex field was given (oklch(), a name…) and says whether it was one.
 */
export function SolidEditor({
  name,
  rgba,
  onLive,
  onCommit,
  onRaw,
  compact = false,
  alpha = true,
}) {
  const start = rgba ?? { r: 128, g: 128, b: 128, a: 1 };
  const [hsv, setHsv] = useState(() => rgbToHsv(start));
  const [a, setA] = useState(start.a);
  const [model, setModel] = useState('hex');
  const [bad, setBad] = useState(false);
  const key = rgbaCss(start);
  const mine = useRef(key);
  // a colour that changed from outside (a swatch, Recent, the stop picked) replaces what is drawn here; the hue of a grey stays
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the colour
  useEffect(() => {
    if (key === mine.current) return;
    mine.current = key;
    const n = rgbToHsv(start);
    setHsv((p) => ({ h: n.s === 0 || n.v === 0 ? p.h : n.h, s: n.s, v: n.v }));
    setA(start.a);
    setBad(false);
  }, [key]);

  const rgb = hsvToRgb(hsv);
  const say = (next, nextA, commit) => {
    const c = { ...hsvToRgb(next), a: nextA };
    mine.current = rgbaCss(c);
    setHsv(next);
    setA(nextA);
    setBad(false);
    if (commit) onCommit(c);
    else onLive?.(c);
  };
  const dirty = useRef(false);
  const live = (next, nextA) => {
    dirty.current = true;
    say(next, nextA, false);
  };
  const release = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit({ ...hsvToRgb(hsv), a });
  };
  const setRgb = (c, commit = true) => {
    const h = rgbToHsv(c);
    say({ h: h.s === 0 || h.v === 0 ? hsv.h : h.h, s: h.s, v: h.v }, c.a ?? a, commit);
  };

  // the area: pointer drag + arrow keys
  const areaRef = useRef(null);
  const drag = useRef(false);
  const fromPointer = (e) => {
    const r = areaRef.current?.getBoundingClientRect?.();
    if (!r?.width || !r?.height) return null;
    return {
      s: clamp((e.clientX - r.left) / r.width, 0, 1),
      v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };
  const areaDown = (e) => {
    const p = fromPointer(e);
    if (!p) return;
    drag.current = true;
    areaRef.current?.setPointerCapture?.(e.pointerId);
    live({ ...hsv, ...p }, a);
  };
  const areaMove = (e) => {
    if (!drag.current) return;
    const p = fromPointer(e);
    if (p) live({ ...hsv, ...p }, a);
  };
  const areaUp = () => {
    drag.current = false;
    release();
  };
  const areaKey = (e) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const m = {
      ArrowRight: [d, 0],
      ArrowLeft: [-d, 0],
      ArrowUp: [0, d],
      ArrowDown: [0, -d],
    }[e.key];
    if (!m) return;
    e.preventDefault();
    live({ ...hsv, s: clamp(hsv.s + m[0], 0, 1), v: clamp(hsv.v + m[1], 0, 1) }, a);
  };

  const pick = () => {
    try {
      new window.EyeDropper()
        .open()
        .then((r) => {
          const c = parseHexInput(r?.sRGBHex);
          if (c) setRgb({ ...c, a }, true);
        })
        .catch(() => {}); // the person pressed Esc
    } catch {
      /* no eyedropper after all */
    }
  };

  const hex = hexDigits(rgb);
  const [hexTxt, setHexTxt] = useState(hex);
  useEffect(() => setHexTxt(hex), [hex]);
  const commitHex = (typed = hexTxt) => {
    const t = String(typed).trim();
    if (!t || t.toLowerCase() === hex.toLowerCase()) return setHexTxt(hex);
    const c = parseHexInput(t);
    if (c) return setRgb({ ...c, a: c.a ?? a });
    if (onRaw?.(t) === true) return setBad(false);
    setBad(true);
  };
  const hsl = rgbToHsl(rgb);

  return (
    <div className="insp-pk-solid" data-testid={`insp-solid-${name}`}>
      <div
        ref={areaRef}
        className="insp-sv"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${pct(hsv.s)} %, brightness ${pct(hsv.v)} %`}
        aria-valuenow={pct(hsv.s)}
        data-testid={`insp-solid-area-${name}`}
        style={{
          background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${Math.round(hsv.h)} 100% 50%))`,
        }}
        onPointerDown={areaDown}
        onPointerMove={areaMove}
        onPointerUp={areaUp}
        onPointerCancel={areaUp}
        onKeyDown={areaKey}
        onKeyUp={release}
      >
        <i
          className="insp-sv-dot"
          aria-hidden="true"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: rgbaCss({ ...rgb, a: 1 }),
          }}
        />
      </div>
      <div className="insp-pk-rails">
        {hasEyedropper() ? (
          <button
            type="button"
            className="insp-pk-icon"
            aria-label="Pick a colour from anywhere you can see"
            title="Pick a colour from anywhere you can see"
            data-testid={`insp-solid-eyedropper-${name}`}
            onClick={pick}
          >
            <Pipette size={14} />
          </button>
        ) : null}
        <div className="insp-pk-rail-col">
          <input
            className="insp-rail insp-rail--hue"
            type="range"
            min={0}
            max={360}
            step={1}
            aria-label="Hue"
            data-testid={`insp-solid-hue-${name}`}
            value={Math.round(hsv.h)}
            onChange={(e) => live({ ...hsv, h: Number(e.currentTarget.value) }, a)}
            onPointerUp={release}
            onKeyUp={release}
            onBlur={release}
          />
          {alpha ? (
            <input
              className="insp-rail insp-rail--alpha"
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="Opacity"
              data-testid={`insp-solid-alpharail-${name}`}
              style={{ '--rail-to': rgbaCss({ ...rgb, a: 1 }) }}
              value={Math.round(a * 100)}
              onChange={(e) => live(hsv, Number(e.currentTarget.value) / 100)}
              onPointerUp={release}
              onKeyUp={release}
              onBlur={release}
            />
          ) : null}
        </div>
      </div>
      {compact ? null : (
        <div className="insp-pk-fields">
          <select
            className="insp-pk-select"
            aria-label="Colour model"
            data-testid={`insp-solid-model-${name}`}
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
          >
            <option value="hex">Hex</option>
            <option value="rgb">RGB</option>
            <option value="hsl">HSL</option>
          </select>
          {model === 'hex' ? (
            <span className="insp-num insp-pk-hex">
              <input
                className="insp-num-in insp-color-in"
                type="text"
                aria-label="Hex colour"
                aria-invalid={bad || undefined}
                data-testid={`insp-colorin-${name}`}
                placeholder="1E6BFF"
                value={hexTxt}
                onChange={(e) => {
                  setHexTxt(e.currentTarget.value);
                  setBad(false);
                }}
                onBlur={(e) => commitHex(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitHex(e.currentTarget.value)}
              />
            </span>
          ) : model === 'rgb' ? (
            ['r', 'g', 'b'].map((k) => (
              <NumberBox
                key={k}
                label={k.toUpperCase()}
                testid={`insp-solid-${k}-${name}`}
                value={rgb[k]}
                onCommit={(v) => setRgb({ ...rgb, [k]: v, a })}
              />
            ))
          ) : (
            ['h', 's', 'l'].map((k) => (
              <NumberBox
                key={k}
                label={{ h: 'Hue', s: 'Saturation', l: 'Lightness' }[k]}
                testid={`insp-solid-${k}-${name}`}
                max={k === 'h' ? 360 : 100}
                value={Math.round(hsl[k])}
                onCommit={(v) => setRgb({ ...hslToRgb({ ...hsl, [k]: v }), a })}
              />
            ))
          )}
          {alpha ? (
            <NumberBox
              label="Opacity"
              testid={`insp-solid-alpha-${name}`}
              max={100}
              suffix="%"
              value={Math.round(a * 100)}
              onCommit={(v) => say(hsv, v / 100, true)}
            />
          ) : null}
        </div>
      )}
      {bad ? (
        <p className="insp-pop-bad" role="alert" data-testid={`insp-pop-bad-${name}`}>
          {BAD_COLOUR}
        </p>
      ) : null}
    </div>
  );
}

/* ── gradient ──────────────────────────────────────────────────────────────────────────────────────────────── */

const byPos = (m) => ({ ...m, stops: [...m.stops].sort((a, b) => a.pos - b.pos) });

/**
 * The gradient the fill's top layer is, and every edit of it. `change(model, stop, commit)` keeps the stops in position
 * order and the selection on the same stop. Live while a drag is in flight, one write on release.
 */
export function useGradientFill(fillApi, vals) {
  const layer = fillApi?.fill?.layers?.[0];
  const css = layer?.kind === 'gradient' ? layer.css : null;
  const parsed = useMemo(() => (css ? parseGradient(css) : null), [css]);
  const [draft, setDraft] = useState(null);
  const [sel, setSel] = useState(0);
  const g = draft && draft.base === css ? draft.g : parsed ? byPos(parsed) : null;
  const nextFill = (m) => ({
    ...fillApi.fill,
    layers: [{ kind: 'gradient', css: gradientCss(m) }, ...fillApi.fill.layers.slice(1)],
  });
  const change = (m, stop, commit) => {
    const s = byPos(m);
    setSel(Math.max(0, s.stops.indexOf(stop)));
    setDraft(commit ? null : { base: css, g: s });
    if (commit) fillApi.set(nextFill(s));
    else fillApi.live(nextFill(s));
  };
  const at = Math.min(sel, (g?.stops.length ?? 1) - 1);
  return {
    g,
    sel: at,
    setSel,
    css,
    unreadable: !!css && !parsed,
    vals,
    change,
    /** Give stop `i` another colour (a CSS string); one write unless `commit` is false. */
    setColour: (i, c, commit = true) => {
      const stop = { ...g.stops[i], color: c };
      change({ ...g, stops: g.stops.map((x, k) => (k === i ? stop : x)) }, stop, commit);
    },
  };
}

const swatchOf = (css, vals) => {
  const c = parseRgba(css, vals);
  return c ? rgbaCss(c) : css;
};

function StopsBar({ name, gf, vals }) {
  const { g, sel } = gf;
  const bar = useRef(null);
  // the stop in the hand: its index in the sorted stops (it changes when it passes another one)
  const held = useRef(null);
  const posFrom = (e) => {
    const r = bar.current?.getBoundingClientRect?.();
    if (!r?.width) return null;
    return clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
  };
  const move = (i, pos, commit) => {
    const stop = { ...g.stops[i], pos: Math.round(pos * 10) / 10 };
    const stops = g.stops.map((s, k) => (k === i ? stop : s));
    gf.change({ ...g, stops }, stop, commit);
    // the same order `gf.change` sorts into, so a held ball keeps following its stop after passing another
    return [...stops].sort((a, b) => a.pos - b.pos).indexOf(stop);
  };
  const barDown = (e) => {
    if (e.target !== bar.current) return;
    const p = posFrom(e);
    if (p == null) return;
    const { g: next, index } = addStop(g, p, vals);
    gf.change(next, next.stops[index], true);
  };
  // r5-5: the ball is grabbed on the BAR (pointer capture), so every move and the release arrive at the bar — not at the
  // ball, which never heard them (Michal: "nejde tahat s temi kulickami")
  const barMove = (e) => {
    if (held.current == null) return;
    const p = posFrom(e);
    if (p != null) held.current = move(held.current, p, false);
  };
  const barUp = (e) => {
    const i = held.current;
    if (i == null) return;
    held.current = null;
    try {
      bar.current?.releasePointerCapture?.(e.pointerId);
    } catch {}
    if (e.type === 'pointercancel') return;
    const p = posFrom(e);
    if (p != null) move(i, p, true);
  };
  return (
    <div
      ref={bar}
      className="insp-gbar"
      data-testid={`insp-gbar-${name}`}
      style={{ background: gradientCss({ ...g, type: 'linear', angle: 90 }) }}
      onPointerDown={barDown}
      onPointerMove={barMove}
      onPointerUp={barUp}
      onPointerCancel={barUp}
    >
      {g.stops.map((s, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional, sorted
          key={i}
          type="button"
          role="slider"
          className="insp-gstop"
          aria-label={`Stop ${i + 1} of ${g.stops.length}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(s.pos)}
          aria-valuetext={`${Math.round(s.pos)} %`}
          aria-current={i === sel ? 'true' : undefined}
          data-testid={`insp-gstop-${name}-${i}`}
          style={{ left: `${s.pos}%`, '--stop': swatchOf(s.color, vals) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault(); // no text selection / native drag while the ball moves
            gf.setSel(i);
            held.current = i;
            bar.current?.setPointerCapture?.(e.pointerId);
          }}
          onKeyDown={(e) => {
            const d = e.shiftKey ? 10 : 1;
            if (e.key === 'ArrowRight') move(i, s.pos + d, true);
            else if (e.key === 'ArrowLeft') move(i, s.pos - d, true);
            else if (e.key === 'Delete' || e.key === 'Backspace') {
              if (g.stops.length > 2)
                gf.change(removeStop(g, i), g.stops[Math.max(0, i - 1)], true);
            } else return;
            e.preventDefault();
          }}
        />
      ))}
    </div>
  );
}

function StopRow({ name, gf, i, vals }) {
  const { g, sel } = gf;
  const s = g.stops[i];
  const c = parseRgba(s.color, vals);
  const hexNow = c ? hexDigits(c) : '';
  const [hexTxt, setHexTxt] = useState(hexNow);
  useEffect(() => setHexTxt(hexNow), [hexNow]);
  const setColour = (css) => gf.setColour(i, css);
  const hexGo = (typed = hexTxt) => {
    const p = parseHexInput(typed);
    if (!p) return setHexTxt(hexNow);
    setColour(rgbaCss({ ...p, a: p.a ?? c?.a ?? 1 }));
  };
  return (
    <div
      className={`insp-grow${i === sel ? ' insp-grow--on' : ''}`}
      data-testid={`insp-grow-${name}-${i}`}
      aria-current={i === sel ? 'true' : undefined}
    >
      <NumberBox
        label={`Stop ${i + 1} position`}
        testid={`insp-gpos-${name}-${i}`}
        max={100}
        suffix="%"
        value={Math.round(s.pos)}
        onCommit={(v) => {
          const stop = { ...s, pos: v };
          gf.change({ ...g, stops: g.stops.map((x, k) => (k === i ? stop : x)) }, stop, true);
        }}
      />
      <button
        type="button"
        className="insp-gsw"
        aria-label={`Edit stop ${i + 1}`}
        aria-pressed={i === sel}
        data-testid={`insp-gsw-${name}-${i}`}
        style={{ '--stop': swatchOf(s.color, vals) }}
        onClick={() => gf.setSel(i)}
      />
      <span className="insp-num insp-pk-hex">
        <input
          className="insp-num-in"
          type="text"
          aria-label={`Stop ${i + 1} colour`}
          data-testid={`insp-ghex-${name}-${i}`}
          value={hexTxt}
          onFocus={() => gf.setSel(i)}
          onChange={(e) => setHexTxt(e.currentTarget.value)}
          onBlur={(e) => hexGo(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && hexGo(e.currentTarget.value)}
        />
      </span>
      <NumberBox
        label={`Stop ${i + 1} opacity`}
        testid={`insp-galpha-${name}-${i}`}
        max={100}
        suffix="%"
        value={Math.round((c?.a ?? 1) * 100)}
        onCommit={(v) => c && setColour(rgbaCss({ ...c, a: v / 100 }))}
      />
      <button
        type="button"
        className="insp-pk-icon"
        aria-label={`Remove stop ${i + 1}`}
        title={g.stops.length <= 2 ? 'A gradient needs two stops' : `Remove stop ${i + 1}`}
        disabled={g.stops.length <= 2}
        data-testid={`insp-gremove-${name}-${i}`}
        onClick={() => gf.change(removeStop(g, i), g.stops[Math.max(0, i - 1)], true)}
      >
        <Minus size={14} />
      </button>
    </div>
  );
}

/** @param {{ name: string, gf: ReturnType<typeof useGradientFill>, vals: Record<string,string>, showPicker?: boolean }} props */
export function GradientEditor({ name, gf, vals }) {
  const { g } = gf;
  if (!g) {
    return (
      <p className="insp-pop-empty" data-testid={`insp-gunreadable-${name}`}>
        This gradient is written in a way the picker doesn’t edit. Pick Linear, Radial or Angular to
        replace it.
      </p>
    );
  }
  const stop = g.stops[gf.sel];
  const sc = parseRgba(stop.color, vals);
  const setType = (type) =>
    gf.change({ ...g, type, angle: type === 'linear' ? 180 : 0, shape: 'circle' }, stop, true);
  return (
    <div className="insp-pk-grad" data-testid={`insp-gradient-${name}`}>
      <div className="insp-pk-fields">
        <select
          className="insp-pk-select insp-pk-grow1"
          aria-label="Gradient type"
          data-testid={`insp-gtype-${name}`}
          value={g.type}
          onChange={(e) => setType(e.currentTarget.value)}
        >
          {GRADIENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {GRADIENT_WORDS[t]}
            </option>
          ))}
        </select>
        {g.type !== 'radial' ? (
          <NumberBox
            label="Angle"
            testid={`insp-gangle-${name}`}
            min={0}
            max={360}
            suffix="°"
            value={Math.round(g.angle)}
            onCommit={(v) => gf.change({ ...g, angle: v }, stop, true)}
          />
        ) : null}
        <button
          type="button"
          className="insp-pk-icon"
          aria-label="Reverse the stops"
          title="Reverse the stops"
          data-testid={`insp-greverse-${name}`}
          onClick={() => gf.change(reverseStops(g), stop, true)}
        >
          <ArrowLeftRight size={14} />
        </button>
      </div>
      <StopsBar name={name} gf={gf} vals={vals} />
      <div className="insp-pk-head">
        <span className="insp-pop-gt">Stops</span>
        <button
          type="button"
          className="insp-pk-icon"
          aria-label="Add a stop"
          title="Add a stop"
          data-testid={`insp-gadd-${name}`}
          onClick={() => {
            const { g: next, index } = addStop(g, widestGap(g), vals);
            gf.change(next, next.stops[index], true);
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {g.stops.map((_s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional, sorted
        <StopRow key={i} name={name} gf={gf} i={i} vals={vals} />
      ))}
      {sc ? (
        <SolidEditor
          name={`${name}-stop`}
          rgba={sc}
          compact
          onLive={(c) => gf.setColour(gf.sel, rgbaCss(c), false)}
          onCommit={(c) => gf.setColour(gf.sel, rgbaCss(c))}
        />
      ) : null}
    </div>
  );
}

/* ── image ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const SAYS = {
  none: 'No picture yet.',
  adding: 'Adding the picture…',
  failed: 'That picture couldn’t be added, so the fill didn’t change.',
  url: 'Use a file in the project or an https:// address.',
};

/** @param {{ name: string, fillApi: object }} props */
export function ImageEditor({ name, fillApi, designRel = '.design' }) {
  const { assets } = useAssets();
  const pictures = (assets ?? []).filter((a) => a.kind === 'image');
  const layer = fillApi.fill.layers[0];
  const current = layer?.kind === 'image' ? layer.url : null;
  const [url, setUrl] = useState('');
  const [state, setState] = useState(null); // 'adding' | 'failed' | 'url'
  const fileRef = useRef(null);
  const use = (u) => {
    fillApi.set({ color: null, layers: [{ kind: 'image', url: u }] });
  };
  const pickFile = async (file) => {
    if (!file) return;
    setState('adding');
    try {
      const r = await (fillApi.upload ?? ((f) => uploadAsset(f, { name: f.name })))(file);
      if (r && typeof r.path === 'string' && imageUrlOk(r.path)) {
        setState(null);
        use(r.path);
      } else setState('failed');
    } catch {
      setState('failed');
    }
  };
  const addUrl = (typed = url) => {
    const u = String(typed).trim();
    if (!u) return;
    if (!imageUrlOk(u)) return setState('url');
    setState(null);
    setUrl('');
    use(u);
  };
  return (
    <div className="insp-pk-image" data-testid={`insp-image-${name}`}>
      <p className="insp-pk-file" data-testid={`insp-image-name-${name}`}>
        {current ? current.split('/').pop() : SAYS.none}
      </p>
      <input
        ref={fileRef}
        className="insp-pk-file-in"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={`insp-image-input-${name}`}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          void pickFile(f);
        }}
      />
      <button
        type="button"
        className="btn btn--primary"
        data-testid={`insp-image-upload-${name}`}
        disabled={state === 'adding'}
        title={state === 'adding' ? 'Adding the picture — one moment' : undefined}
        onClick={() => fileRef.current?.click()}
      >
        {current ? 'Choose another picture' : 'Upload from computer'}
      </button>
      <span className="insp-num">
        <input
          className="insp-num-in insp-url-in"
          type="text"
          aria-label="A picture — a file in the project or an https:// address"
          aria-invalid={state === 'url' || undefined}
          data-testid={`insp-image-url-${name}`}
          placeholder="Or a file in the project, or https://…"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUrl(e.currentTarget.value)}
        />
      </span>
      <div className="insp-pop-g" data-testid={`insp-image-assets-${name}`}>
        <p className="insp-pop-gt">From your assets</p>
        {assets && !pictures.length ? (
          <p className="insp-pop-empty" data-testid={`insp-image-assets-empty-${name}`}>
            No pictures in Assets yet. Upload one, or add pictures in the Assets tab.
          </p>
        ) : (
          <div className="insp-pk-assets">
            {pictures.map((a, i) => (
              <button
                key={a.path}
                type="button"
                className="insp-pk-asset"
                data-cell="true"
                data-g={-3}
                data-i={i}
                data-asset={a.path}
                aria-pressed={current === a.path}
                aria-label={a.name}
                title={a.name}
                data-testid={`insp-image-asset-${name}-${i}`}
                onClick={() => {
                  setState(null);
                  use(a.path);
                }}
              >
                <img src={`/${designRel}/${a.path}`} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
      {state ? (
        <p
          className="insp-pop-bad"
          role={state === 'adding' ? 'status' : 'alert'}
          data-testid={`insp-image-say-${name}`}
        >
          {SAYS[state]}
        </p>
      ) : null}
    </div>
  );
}

/** A swatch row: "On this page". `onPick(css)`; cells join the popover's arrow-key walk (`data-cell`). */
export function PageColours({ name, colours, group = -2, onPick }) {
  if (!colours.length) return null;
  return (
    <div className="insp-pop-g" data-testid={`insp-pop-page-${name}`}>
      <p className="insp-pop-gt">On this page</p>
      <div className="insp-pop-grid">
        {colours.map((css, i) => (
          <button
            key={css}
            type="button"
            className="insp-pop-cell"
            data-cell="true"
            data-g={group}
            data-i={i}
            aria-label={css}
            title={css}
            data-testid={`insp-page-${name}-${i}`}
            onClick={() => onPick(css)}
          >
            <i className="insp-pop-sw" aria-hidden="true" style={{ '--sw-l': css }} />
          </button>
        ))}
      </div>
    </div>
  );
}
