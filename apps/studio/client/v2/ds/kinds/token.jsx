// client/v2/ds/kinds/token.jsx — S10.7: a token of the Design system canvas, edited in place (13 · ds-edit-colour).
//
// Select a swatch on the Design system canvas and the inspector says what it is — Accent, Colour — and lets the
// person change it right there:
//
//   Editing  [Light | Dark]          which mode the picker and the box below change
//   Light    ■ Deeper azure          the value in each mode, with the colour's own name
//   Dark     ■ Follows Light
//   [ picker ]  [ oklch(0.50 0.190 255) ]  [ name ]
//   Dark follows automatically  ◯    on: Dark moves with Light, keeping the pair's relation; off: Dark is yours
//   ✓ Light 5.6:1 · Dark 4.8:1        contrast, both modes, live while the picker is dragged
//   Used in 5 canvases · was Azure
//
// Nothing here writes a token file and nothing opens a dialog: a finished drag becomes ONE waiting edit
// (`POST /_api/ds/pending`, token-write.js) and "1 change waiting" shows in the Design system bar. It reaches
// canvases only through "Update N canvases". A locked brand colour is shown and refused (the engine says so too).
// The panel is hidden from nobody and refused by the server: Can view reads, Can edit writes.
//
// The kind is "bare": the ten object sections and the raw code fold mean nothing for a token, so the frame draws
// only this block (kinds/index.js `bare`).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { followDark, formatLike, resolveColour } from '../../../../ds/contrast.ts';
import { usedWords } from '../../../../ds/board/types.ts';
import { toHex } from '../../../../draw/palette.ts';
import { Segmented, Toggle } from '../../../inspector-controls.jsx';
import { StIcon } from '../../../shell/icons.jsx';
import { registerBlock } from '../../inspector/blocks.js';
import { registerKind, singleOf } from '../../inspector/kinds/index.js';
import { Quiet, Row } from '../../inspector/sections/row.jsx';
import { contrastLine } from '../contrast.js';
import { systemOfCanvas, useDsBoard } from '../use-ds-model.js';
import {
  cleanValue,
  currentValue,
  darkFollowsOf,
  TOKEN_WORDS,
  writeToken,
} from '../token-write.js';

/** After the last movement of a drag the edit is written even if the picker never says "change". */
export const COMMIT_IDLE_MS = 700;

export const tokenCssOf = (el) => {
  const v = el?.attrs?.['data-ds-token'];
  return typeof v === 'string' && /^--[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
};

export const isDsToken = (selection) => {
  const el = singleOf(selection);
  return !!el && tokenCssOf(el) !== null;
};

const swatchHex = (value) => {
  const rgb = resolveColour(value, () => undefined);
  return rgb ? toHex(rgb) : '#000000';
};

/** The colour the person sees for a value that may be a var() — resolved against the model's own tokens. */
function resolveIn(model, theme, value) {
  const look = (name) => {
    const t = model.tokens.find((x) => x.css === name);
    if (!t) return undefined;
    const pend = t.pending && !t.pending.trashTo ? t.pending.values?.[theme] : undefined;
    return pend ?? t.values?.[theme] ?? t.values?.[model.themes.default];
  };
  return resolveColour(value, look);
}

function Chip({ model, theme, value }) {
  const rgb = resolveIn(model, theme, value);
  return (
    <i
      className="insp-sw ds-tk-sw"
      aria-hidden="true"
      style={{ background: rgb ? toHex(rgb) : 'transparent' }}
    />
  );
}

/** The panel for ONE token of one system. Exported for tests with an injected model and writer. */
export function TokenPanel({ css, ds, model, onWrite, onRefresh, onAdopt }) {
  const token = model?.tokens.find((t) => t.css === css) ?? null;
  const themes = model?.themes;
  const hasDark =
    !!themes?.dark && (token?.kind === 'color' || token?.values?.[themes.dark] !== undefined);
  const isColour = token?.kind === 'color';
  const [editing, setEditing] = useState(null); // a theme name
  const [live, setLive] = useState(null); // { [theme]: value } while the picker is being dragged
  const [typed, setTyped] = useState(null); // the box's text while it is being typed
  const [note, setNote] = useState(null);
  const timer = useRef(null);
  const liveRef = useRef(null);
  const [colourEl, setColourEl] = useState(null);

  // a new token (or a model that moved under us) starts from what is saved
  // biome-ignore lint/correctness/useExhaustiveDependencies: css is the trigger
  useEffect(() => {
    setEditing(null);
    setLive(null);
    setTyped(null);
    setNote(null);
  }, [css]);
  const theme = editing && themes?.all.includes(editing) ? editing : themes?.light;

  const commit = useCallback(
    async (edit) => {
      clearTimeout(timer.current);
      liveRef.current = null;
      setNote(null);
      const r = await onWrite({ ds, css, edit, model });
      setLive(null);
      setTyped(null);
      if (r.ok) {
        await onRefresh();
        return;
      }
      if (r.model) onAdopt(r.model);
      setNote(r.message);
    },
    [ds, css, model, onWrite, onRefresh, onAdopt]
  );

  // flush a drag that was never closed when the selection moves on
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount flush
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const pending = liveRef.current;
      if (pending) onWrite({ ds, css, edit: pending.edit, model });
    },
    [css]
  );

  // the picker's own `change` is the end of a drag (React's onChange is every step of it)
  useEffect(() => {
    const el = colourEl;
    if (!el) return undefined;
    const done = () => {
      const p = liveRef.current;
      if (p) commit(p.edit);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [colourEl, commit]);

  if (!model || !token || !themes) return null;

  const follows = darkFollowsOf(token);
  const valueIn = (t) => live?.[t] ?? currentValue(token, themes, t);
  const lightV = valueIn(themes.light);
  const darkV = hasDark ? valueIn(themes.dark) : null;
  const waiting = !!token.pending;
  const valueName = (t) => token.pending?.valueNames?.[t] ?? token.valueNames?.[t] ?? '';
  const was = waiting ? (token.valueNames?.[themes.light] ?? null) : null;
  const used = usedWords(token.used);
  const line = isColour ? contrastLine(model, css, live ?? {}) : null;

  const drag = (hex) => {
    const next = formatLike(
      resolveColour(hex, () => undefined) ?? { r: 0, g: 0, b: 0 },
      currentValue(token, themes, theme)
    );
    const edited = { [theme]: next };
    if (hasDark && theme === themes.light && follows) {
      const d = followDark(
        {
          light: currentValue(token, themes, themes.light),
          dark: currentValue(token, themes, themes.dark),
        },
        next
      );
      if (d) edited[themes.dark] = d;
    }
    setLive(edited);
    liveRef.current = { edit: { theme, value: next } };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = liveRef.current;
      if (p) commit(p.edit);
    }, COMMIT_IDLE_MS);
  };

  const submitText = () => {
    if (typed === null) return;
    const v = cleanValue(typed);
    if (v === null) {
      setNote(TOKEN_WORDS.invalid);
      setTyped(null);
      return;
    }
    if (v === currentValue(token, themes, theme)) return setTyped(null);
    commit({ theme, value: v });
  };

  const locked = token.locked;
  const shown = typed ?? valueIn(theme);

  return (
    <section
      className="insp-sec ds-tk"
      data-testid="insp-sec-ds-token"
      data-token={css}
      data-locked={locked ? 'true' : undefined}
      aria-label={token.label}
    >
      <p className="insp-sec-t">
        <span className="insp-sec-name">{token.label}</span>
        {locked ? (
          <span className="insp-sec-a" data-testid="ds-token-locked">
            <StIcon name="lock" size={12} /> Locked
          </span>
        ) : null}
      </p>
      {hasDark ? (
        <Row k="Editing" name="ds-editing">
          <Segmented
            ariaLabel="Editing"
            value={theme}
            options={[
              { value: themes.light, label: 'Light' },
              { value: themes.dark, label: 'Dark' },
            ]}
            onChange={(t) => {
              setEditing(t);
              setTyped(null);
            }}
          />
        </Row>
      ) : null}
      <Row k="Light" name="ds-light">
        {isColour ? <Chip model={model} theme={themes.light} value={lightV} /> : null}
        <span className="ds-tk-name" data-testid="ds-token-light">
          {valueName(themes.light) || lightV}
        </span>
      </Row>
      {hasDark ? (
        <Row k="Dark" name="ds-dark">
          {isColour ? <Chip model={model} theme={themes.dark} value={darkV} /> : null}
          <span className="ds-tk-name" data-testid="ds-token-dark">
            {follows && isColour ? 'Follows Light' : valueName(themes.dark) || darkV}
          </span>
        </Row>
      ) : null}
      {locked ? (
        <Quiet testid="ds-token-locked-line">{TOKEN_WORDS.locked}</Quiet>
      ) : (
        <Row
          k={hasDark ? (theme === themes.dark ? 'Dark value' : 'Light value') : 'Value'}
          name="ds-value"
        >
          {isColour ? (
            <input
              ref={setColourEl}
              type="color"
              className="ds-tk-picker"
              data-testid="ds-token-picker"
              aria-label={`${token.label} — pick a colour`}
              value={swatchHex(valueIn(theme))}
              onChange={(e) => drag(e.target.value)}
            />
          ) : null}
          <input
            type="text"
            className="ds-tk-text"
            data-testid="ds-token-value"
            aria-label={`${token.label} — value`}
            spellCheck={false}
            value={shown}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={submitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setTyped(null);
            }}
          />
        </Row>
      )}
      {!locked && isColour ? (
        <Row k="Name" name="ds-name">
          <input
            type="text"
            className="ds-tk-text"
            data-testid="ds-token-name"
            aria-label={`${token.label} — name of this colour`}
            placeholder="Name this colour"
            defaultValue={valueName(theme)}
            key={`${css}:${theme}:${valueName(theme)}`}
            maxLength={64}
            onBlur={(e) => {
              if (e.target.value.trim() !== valueName(theme))
                commit({ theme, name: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Row>
      ) : null}
      {hasDark && isColour ? (
        <Row k="Dark follows automatically" name="ds-follows">
          <Toggle
            checked={follows}
            ariaLabel="Dark follows automatically"
            onChange={(on) => !locked && commit({ follows: on })}
          />
        </Row>
      ) : null}
      {line ? (
        <p
          className="insp-quiet ds-tk-line"
          data-testid="ds-token-contrast"
          data-tone={line.ok ? 'ok' : 'warn'}
        >
          <StIcon name={line.ok ? 'check' : 'problem'} size={12} /> {line.line}
        </p>
      ) : null}
      {used ? (
        <Quiet testid="ds-token-used">
          <StIcon name="layers" size={12} /> {used}
          {was ? ` · was ${was}` : ''}
        </Quiet>
      ) : null}
      {note ? (
        <p
          className="insp-quiet ds-tk-note"
          role="status"
          data-testid="ds-token-note"
          data-tone="warn"
        >
          {note}
        </p>
      ) : null}
      <details className="ds-tk-adv" data-testid="ds-token-advanced">
        <summary>
          Advanced <span>{isColour ? 'OKLCH' : 'CSS'}</span>
        </summary>
        <Row k="Light" name="ds-adv-light">
          <code>{token.values?.[themes.light] ?? '—'}</code>
        </Row>
        {hasDark ? (
          <Row k="Dark" name="ds-adv-dark">
            <code>{token.values?.[themes.dark] ?? '—'}</code>
          </Row>
        ) : null}
        <Row k="Token" name="ds-adv-token">
          <code>{css}</code>
        </Row>
      </details>
    </section>
  );
}

function TokenBody({ el, ctx }) {
  const css = tokenCssOf(el);
  const ds = useMemo(() => systemOfCanvas(ctx?.canvasFile, ctx?.cfg), [ctx?.canvasFile, ctx?.cfg]);
  const { model, loading, refresh, adopt } = useDsBoard(ds, css ?? '');
  if (!css) return null;
  if (!ds) return <Quiet testid="ds-token-nosystem">This isn’t part of a design system.</Quiet>;
  if (!model)
    return (
      <Quiet testid="ds-token-loading">
        {loading ? 'Reading the system…' : 'The system isn’t available.'}
      </Quiet>
    );
  return (
    <TokenPanel
      css={css}
      ds={ds}
      model={model}
      onWrite={writeToken}
      onRefresh={refresh}
      onAdopt={adopt}
    />
  );
}

let offs = [];

/** Register the kind and its block (idempotent; tests that unregistered call it again). */
export function registerDsTokenKind() {
  if (offs.length) return;
  offs = [
    registerKind({
      id: 'ds-token',
      order: 4,
      bare: true,
      label: (s) => (singleOf(s)?.attrs?.['data-ds-kind'] === 'color' ? 'Colour' : 'Token'),
      match: isDsToken,
    }),
    registerBlock({
      id: 'ds.token',
      kinds: ['ds-token'],
      at: 'top',
      order: 10,
      Body: TokenBody,
    }),
  ];
}

export const offDsToken = () => {
  for (const off of offs) off();
  offs = [];
};

registerDsTokenKind();
