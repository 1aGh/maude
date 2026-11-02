// client/v2/inspector/advanced-rows-default.jsx — S11.8: the rows Inspector › Advanced ships with, registered
// through advanced-rows.js exactly the way S2.8, S7 and S8 register theirs.
//
//   element   Tag · Classes · Selector · Element id (+ copy) · where it is and how big
//   used-in   "Edits apply to: Shared · 4 places" + Detach
//   tokens    the design tokens it uses, by the property that binds them
//   css       the declarations · Edit as text · Property · Attribute · the v1 raw editor (nothing deleted)
//   in-code   Copy style · Paste style · Copy CSS · Copy code
//
// Closed, the fold says "Code, tokens, CSS". Can comment sees the CSS read-only and Copy CSS (and the code,
// which the server also gives that role); Can view sees the CSS and Copy CSS, never the code.

import { useEffect, useRef, useState } from 'react';
import { CssKnobs } from '../../inspector/css-knobs.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { InspectComputed } from '../../inspector/inspect-computed.jsx';
import { tokenLabel } from '../../../edit-ops/words-css.ts';
import { systemName } from '../../../edit-ops/words-paint.ts';
import { registerAdvancedRow } from './advanced-rows.js';
import { applyAttr, applyCssPatch, currentDecls, patchFromText } from './css-text.js';
import { readElementCode } from './element-code.js';
import {
  COMPUTED_ID_RE,
  cssTextOf,
  hasUsableId,
  takenIds,
  tokensUsed,
  validateElementId,
} from './model.js';
import { useDsFamilies } from './token-chip.jsx';

/** Copy to the clipboard; resolves true when it worked (a browser tab without the permission says no). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A button that runs `produce()` (text, or a promise of `{ok, code|message}`), copies, and says so. */
function CopyButton({
  testid,
  label,
  text,
  done = 'Copied',
  primary = false,
  icon = false,
  onNote,
}) {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={
        icon ? 'icon-btn k-icon-sm' : `btn btn--sm insp-btn${primary ? ' btn--primary' : ''}`
      }
      data-testid={testid}
      // 06 ad-inspector: the board's Element id row ends in the quiet copy glyph, not a "Copy id" button
      {...(icon ? { 'aria-label': label, title: state === 'done' ? done : label } : {})}
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        onNote?.('');
        let ok = false;
        const made = typeof text === 'function' ? await text() : text;
        if (made && typeof made === 'object') {
          if (made.ok) ok = await copyText(made.code);
          else onNote?.(made.message);
        } else {
          ok = await copyText(made);
        }
        setState(ok ? 'done' : 'failed');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1600);
      }}
    >
      {icon ? (
        <StIcon name={state === 'done' ? 'done' : 'duplicate'} size={14} />
      ) : state === 'done' ? (
        done
      ) : state === 'failed' ? (
        'Not copied'
      ) : (
        label
      )}
    </button>
  );
}

/** One labelled row. `mono` is the code voice. */
export function Row({ k, mono = false, testid, title, children }) {
  return (
    <div className="insp-arow" data-testid={testid} title={title}>
      <span className="insp-ak">{k}</span>
      <span className={`insp-av${mono ? ' insp-mono' : ''}`}>{children}</span>
    </div>
  );
}

/** What the old Inspect tab showed: where it is, how big, and the resolved fill / text / radius. */
export function InspectFacts({ el }) {
  const b = el?.bounds || null;
  const row = (label, fields) => (
    <div className="sh-insp-row">
      <span className="sh-insp-label">{label}</span>
      <div className="sh-insp-fields">{fields}</div>
    </div>
  );
  const mini = (tag, value, aria) => (
    <span className="insp-fmini">
      <span className="insp-mtag">{tag}</span>
      <input value={b ? Math.round(value) : '—'} readOnly aria-label={aria} />
    </span>
  );
  return (
    <div className="insp-facts" data-testid="inspector-facts">
      {row(
        'Pos',
        <>
          {mini('X', b?.x, 'x position')}
          {mini('Y', b?.y, 'y position')}
        </>
      )}
      {row(
        'Size',
        <>
          {mini('W', b?.w, 'width')}
          {mini('H', b?.h, 'height')}
        </>
      )}
      <InspectComputed el={el} />
    </div>
  );
}

/** The element id (V2-1.4 §5.5): rename it, and the writer rewrites every durable reference to it. */
function ElementId({ el, layersTree, canvasFile, onRename }) {
  const usable = hasUsableId(el);
  const shown = usable ? el.id : '';
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // a different element (or the same one after a rename landed): start from what the file says
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on a fresh id only.
  useEffect(() => {
    setDraft(shown);
    setError('');
  }, [el.id, el.index]);

  const commit = async () => {
    if (!onRename || busy) return;
    const verdict = validateElementId(draft, usable ? el.id : '', takenIds(layersTree, el.id));
    if (!verdict.ok) {
      if (verdict.code === 'same') {
        setError('');
        return;
      }
      setError(verdict.message);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const r = await onRename({
        from: el.id,
        to: verdict.id,
        index: el.index,
        artboardId: el.artboardId ?? layersTree?.artboardId,
        canvas: canvasFile,
      });
      if (r && r.ok === false) setError(r.message || 'The id was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="insp-adv-block">
      <div className="insp-id">
        <input
          className="input insp-mono insp-id-input"
          data-testid="inspector-element-id"
          aria-label="Element id"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'inspector-id-error' : undefined}
          value={draft}
          placeholder={usable ? undefined : el.id}
          readOnly={!onRename}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(shown);
              setError('');
            }
          }}
        />
        {usable ? (
          <CopyButton testid="inspector-copy-id" label="Copy id" text={el.id} icon />
        ) : null}
      </div>
      {error ? (
        <p
          id="inspector-id-error"
          className="insp-err"
          role="alert"
          data-testid="inspector-id-error"
        >
          {error}
        </p>
      ) : null}
      {!usable && COMPUTED_ID_RE.test(el.id || '') ? (
        <p className="insp-note">Not named yet. Type a name and it becomes this element’s id.</p>
      ) : null}
    </div>
  );
}

function SelectionLine({ el }) {
  const path = Array.isArray(el.dom_path) ? el.dom_path.join(' > ') : el.selector;
  return (
    <p className="insp-code" data-testid="inspector-selection" title={path || undefined}>
      {el.selector || el.tag || 'element'}
      {el.text ? (
        <span className="insp-code-text" data-testid="inspector-selection-text">
          {' '}
          — “{String(el.text).slice(0, 60)}”
        </span>
      ) : null}
    </p>
  );
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────────

/** The designer's word for the property a token is bound to (06 · ad-inspector: Fill · Text colour · Corners). */
const PROPERTY_WORDS = Object.freeze({
  background: 'Fill',
  'background-color': 'Fill',
  color: 'Text colour',
  'border-radius': 'Corners',
  border: 'Border',
  'border-color': 'Border',
  'border-width': 'Border',
  outline: 'Outline',
  gap: 'Gap',
  padding: 'Padding',
  margin: 'Margin',
  'font-family': 'Font',
  'font-size': 'Text size',
  'font-weight': 'Weight',
  'line-height': 'Line height',
  'box-shadow': 'Shadow',
  opacity: 'Opacity',
  width: 'Width',
  height: 'Height',
});

export function propertyWord(prop) {
  if (PROPERTY_WORDS[prop]) return PROPERTY_WORDS[prop];
  const words = String(prop).replace(/^--/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `[{ property, word, token }]` — one per (property, token) the element's declarations bind. */
export function boundTokens(el) {
  const out = [];
  const seen = new Set();
  for (const map of [el?.authored, el?.customStyles]) {
    for (const [prop, value] of Object.entries(map || {})) {
      if (prop.startsWith('data-cd-')) continue;
      for (const m of String(value).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const key = `${prop}|${m[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ property: prop, word: propertyWord(prop), token: m[1] });
      }
    }
  }
  return out;
}

/** A token's length in px when the system gives one (`--space-5` = 24px → "Space 24"). */
function tokenPx(value) {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return (m[2] || 'px').toLowerCase() === 'rem' ? n * 16 : n;
}

/** The system's own name for a token: Space 24 · Round · Resting; anything else reads by its name. */
function chipWord(name, raw) {
  if (/^--radius-/.test(name)) return systemName(name, 'radius');
  if (/^--shadow-/.test(name)) return systemName(name, 'shadow');
  return tokenLabel(name, tokenPx(raw));
}

/**
 * 14 Editing (ed-inspector): "Tokens it uses" are chips, each said the way the system names it — Space 24, Round,
 * Resting; a colour carries its swatch. Once per token, in the order the element first uses them.
 */
function TokensBound({ el, ctx }) {
  const fam = useDsFamilies(ctx);
  const used = tokensUsed(el);
  if (!used.length) return null;
  return (
    <ul className="insp-toks insp-toks--chips" data-testid="inspector-tokens-used">
      {used.map((t) => {
        const raw = fam.vals?.[t.name];
        const isColor = fam.color.includes(t.name) && !!raw;
        return (
          <li key={t.name} className="insp-tokchip" title={t.name}>
            {isColor ? (
              <i className="insp-tokchip-sw" style={{ background: raw }} aria-hidden="true" />
            ) : (
              <i className="insp-tokchip-dot" aria-hidden="true" />
            )}
            <b>{chipWord(t.name, raw)}</b>
          </li>
        );
      })}
    </ul>
  );
}

// ── css ──────────────────────────────────────────────────────────────────────────────────────────────────

const HIDDEN_ATTRS = /^(?:data-cd-|class$|style$)/;

function CssList({ el }) {
  const decls = Object.entries(currentDecls(el));
  const attrs = Object.entries(el?.attrs || {}).filter(([k]) => !HIDDEN_ATTRS.test(k));
  if (!decls.length && !attrs.length)
    return <p className="insp-note">No inline CSS on this element yet.</p>;
  return (
    <div className="insp-csslist" data-testid="adv-css-list">
      {decls.map(([k, v]) => (
        <div className="insp-css" key={`p:${k}`}>
          <span className="insp-css-k">{k}</span>
          <span className="insp-css-v">{v}</span>
        </div>
      ))}
      {attrs.map(([k, v]) => (
        <div className="insp-css insp-css--attr" key={`a:${k}`}>
          <span className="insp-css-k">{k}</span>
          <span className="insp-css-v">“{v}”</span>
        </div>
      ))}
    </div>
  );
}

function badLinesNote(bad) {
  const first = bad[0];
  return `Line ${first} needs a property and a value, like color: red;`;
}

function CssAsText({ el, ctx }) {
  const [draft, setDraft] = useState(() => cssTextOf(el));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    const { patch, bad } = patchFromText(el, draft);
    if (bad.length) {
      setError(badLinesNote(bad));
      return;
    }
    if (!Object.keys(patch).length) {
      ctx.cssText.close();
      return;
    }
    setBusy(true);
    const r = await applyCssPatch(el, patch, ctx.edit);
    setBusy(false);
    if (!r.ok) {
      setError('Some lines were not saved. The file keeps what it had. Try Apply again.');
      return;
    }
    ctx.cssText.close();
  };
  return (
    <div className="insp-adv-block">
      <textarea
        className="input insp-mono insp-csstext"
        data-testid="adv-css-text"
        aria-label="CSS as text"
        value={draft}
        spellCheck={false}
        rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
        onChange={(e) => {
          setDraft(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ctx.cssText.close();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          }
        }}
      />
      {error ? (
        <p className="insp-err" role="alert" data-testid="adv-css-text-error">
          {error}
        </p>
      ) : null}
      <div className="insp-adv-acts">
        <button
          type="button"
          className="btn btn--sm btn--primary insp-btn"
          data-testid="adv-css-text-apply"
          disabled={busy}
          onClick={apply}
        >
          Apply
        </button>
        <button
          type="button"
          className="btn btn--sm insp-btn"
          data-testid="adv-css-text-cancel"
          onClick={() => ctx.cssText.close()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddPair({ kind, el, ctx, onDone }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const isProp = kind === 'property';
  const submit = async () => {
    const n = name.trim();
    const v = value.trim();
    if (!n || !v) {
      setError(isProp ? 'Give it a property and a value.' : 'Give it an attribute and a value.');
      return;
    }
    const r = isProp
      ? await applyCssPatch(el, { [n.startsWith('--') ? n : n.toLowerCase()]: v }, ctx.edit)
      : await applyAttr(el, n, v, ctx.edit);
    if (!r.ok) {
      setError('Not saved. The file keeps what it had. Try again.');
      return;
    }
    onDone();
  };
  return (
    <div className="insp-pair" data-testid={`adv-add-${kind}-form`}>
      <input
        className="input insp-mono"
        aria-label={isProp ? 'property name' : 'attribute name'}
        placeholder={isProp ? 'property' : 'data-…'}
        value={name}
        spellCheck={false}
        onChange={(e) => {
          setName(e.target.value);
          setError('');
        }}
      />
      <input
        className="input insp-mono"
        aria-label={isProp ? 'property value' : 'attribute value'}
        placeholder="value"
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <button
        type="button"
        className="btn btn--sm insp-btn"
        data-testid={`adv-add-${kind}-apply`}
        onClick={submit}
      >
        Add
      </button>
      {error ? (
        <p className="insp-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CssAdd({ el, ctx }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="insp-adv-acts">
        <button
          type="button"
          className="btn btn--sm insp-btn"
          data-testid="adv-add-property"
          aria-expanded={open === 'property'}
          onClick={() => setOpen(open === 'property' ? null : 'property')}
        >
          + Property
        </button>
        <button
          type="button"
          className="btn btn--sm insp-btn"
          data-testid="adv-add-attribute"
          aria-expanded={open === 'attribute'}
          onClick={() => setOpen(open === 'attribute' ? null : 'attribute')}
        >
          + Attribute
        </button>
      </div>
      {open ? (
        <AddPair key={open} kind={open} el={el} ctx={ctx} onDone={() => setOpen(null)} />
      ) : null}
    </>
  );
}

// ── in code ──────────────────────────────────────────────────────────────────────────────────────────────

function CopyCodeButton({ el, ctx }) {
  const [note, setNote] = useState('');
  return (
    <>
      <CopyButton
        testid="adv-copy-code"
        label="Copy code"
        primary
        onNote={setNote}
        text={() =>
          readElementCode({
            canvasFile: ctx.canvasFile,
            id: el.id,
            index: el.index ?? 0,
            fetchImpl: ctx.fetchImpl,
          })
        }
      />
      {note ? (
        <p className="insp-err insp-err--wide" role="alert" data-testid="adv-copy-code-note">
          {note}
        </p>
      ) : null}
    </>
  );
}

function ActionButton({ testid, label, onClick }) {
  return (
    <button type="button" className="btn btn--sm insp-btn" data-testid={testid} onClick={onClick}>
      {label}
    </button>
  );
}

// ── registration ─────────────────────────────────────────────────────────────────────────────────────────

const ELEMENT = ['element'];

registerAdvancedRow('element', {
  id: 'element.tag',
  order: 10,
  kinds: ELEMENT,
  when: ({ el }) => !!el?.tag,
  Body: ({ el }) => (
    <Row k="Tag" mono testid="adv-tag">
      {el.tag}
    </Row>
  ),
});
registerAdvancedRow('element', {
  id: 'element.classes',
  order: 20,
  kinds: ELEMENT,
  when: ({ el }) => !!el?.classes,
  Body: ({ el }) => (
    <Row k="Classes" mono testid="adv-classes">
      {el.classes}
    </Row>
  ),
});
registerAdvancedRow('element', {
  id: 'element.selector',
  order: 30,
  kinds: ELEMENT,
  Body: ({ el }) => (
    <Row k="Selector" mono>
      <SelectionLine el={el} />
    </Row>
  ),
});
registerAdvancedRow('element', {
  id: 'element.id',
  order: 40,
  kinds: ELEMENT,
  Body: ({ el, ctx }) => {
    const field = (
      <ElementId
        el={el}
        layersTree={ctx.layersTree}
        canvasFile={ctx.canvasFile}
        onRename={ctx.canEdit ? ctx.onRenameElementId : undefined}
      />
    );
    // 14 draws the id as its own block under its own small title, not as a label / value row
    return ctx.idBlock ? (
      field
    ) : (
      <Row k="Element id" mono>
        {field}
      </Row>
    );
  },
});
registerAdvancedRow('element', {
  id: 'element.facts',
  order: 90,
  kinds: ELEMENT,
  Body: ({ el }) => <InspectFacts el={el} />,
});

registerAdvancedRow('used-in', {
  id: 'used-in.scope',
  order: 10,
  kinds: ELEMENT,
  when: ({ el, ctx }) => !!el?.id && !!ctx?.editScope,
  Body: ({ el, ctx }) => {
    const s = ctx.editScope;
    const shared = s.scope === 'shared';
    const n = s.affects ?? 0;
    return (
      <Row k="Edits apply to" testid="adv-used-in">
        <span className="insp-inline">
          <span
            className="insp-val"
            title={shared && s.componentName ? `Component ${s.componentName}` : undefined}
          >
            {shared ? `Shared · ${n} ${n === 1 ? 'place' : 'places'}` : 'Only this element'}
          </span>
          {shared && ctx.canEdit && ctx.onDetachInstance ? (
            <button
              type="button"
              className="btn btn--sm insp-btn"
              data-testid="adv-detach"
              title="Clone this component for this instance only. Edits stop reaching the other places."
              onClick={() => ctx.onDetachInstance(el.id, el.index)}
            >
              Detach
            </button>
          ) : null}
        </span>
      </Row>
    );
  },
});

registerAdvancedRow('tokens', {
  id: 'tokens.bound',
  order: 10,
  kinds: ELEMENT,
  when: ({ el }) => tokensUsed(el).length > 0,
  Body: ({ el, ctx }) => <TokensBound el={el} ctx={ctx} />,
});

registerAdvancedRow('css', {
  id: 'css.declarations',
  order: 10,
  kinds: ELEMENT,
  aside: ({ ctx }) =>
    ctx.canEdit ? (
      <button
        type="button"
        className="insp-link"
        data-testid="adv-edit-css-text"
        aria-pressed={ctx.cssText.on}
        onClick={() => ctx.cssText.toggle()}
      >
        Edit as text
      </button>
    ) : null,
  Body: ({ el, ctx }) =>
    ctx.canEdit && ctx.cssText.on ? <CssAsText el={el} ctx={ctx} /> : <CssList el={el} />,
});
registerAdvancedRow('css', {
  id: 'css.add',
  order: 20,
  kinds: ELEMENT,
  when: ({ ctx }) => ctx.canEdit && !ctx.cssText.on && !!ctx.canvasFile,
  Body: ({ el, ctx }) => <CssAdd el={el} ctx={ctx} />,
});
registerAdvancedRow('css', {
  // the unchanged v1 raw editor, exactly as it was: nothing deleted. Writers only.
  id: 'css.raw-editor',
  order: 90,
  kinds: ELEMENT,
  when: ({ ctx }) => ctx.canEdit,
  Body: ({ el, ctx }) => <CssKnobs el={el} cfg={ctx.cfg} mode="advanced" {...ctx.edit} />,
});

// The four actions, each its own row so a package can slot one in between. Writers get all four; Can comment
// keeps Copy CSS and Copy code; Can view keeps Copy CSS (the server refuses it the source, so it is not offered).
registerAdvancedRow('in-code', {
  id: 'code.copy-style',
  order: 20,
  kinds: ELEMENT,
  when: ({ ctx }) => ctx.canEdit,
  Body: ({ ctx }) => (
    <ActionButton
      testid="adv-copy-style"
      label="Copy style"
      onClick={() => ctx.runAction?.('edit.copy-properties')}
    />
  ),
});
registerAdvancedRow('in-code', {
  id: 'code.paste-style',
  order: 30,
  kinds: ELEMENT,
  when: ({ ctx }) => ctx.canEdit,
  Body: ({ ctx }) => (
    <ActionButton
      testid="adv-paste-style"
      label="Paste style"
      onClick={() => ctx.runAction?.('edit.paste-properties')}
    />
  ),
});
registerAdvancedRow('in-code', {
  id: 'code.copy-css',
  order: 10,
  kinds: ELEMENT,
  Body: ({ el }) => (
    <CopyButton testid="inspector-copy-css" label="Copy CSS" text={() => cssTextOf(el)} />
  ),
});
registerAdvancedRow('in-code', {
  id: 'code.copy-code',
  order: 40,
  kinds: ELEMENT,
  when: ({ el, ctx }) => ctx.canCode && !!el?.id && !!ctx.canvasFile,
  Body: ({ el, ctx }) => <CopyCodeButton el={el} ctx={ctx} />,
});
