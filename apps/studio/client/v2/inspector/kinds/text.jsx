// client/v2/inspector/kinds/text.jsx — S2.12: a text object's Type section (14 Editing, ed-text-edit · ed-text-style).
//
//   Style      "Aa Plakát ⌄" — the type roles of the design system (`components.json` `typeRoles`), by the
//              system's own names. Changing one thing makes the row wear a dot ("Changed here"); the line
//              under it says what differs and offers Reset. Detach keeps the look and stops following.
//   Resizing   Width · Height · Fixed
//   Case       As typed · AA
//   Language   Čeština writes `lang`, ties one-letter words to the next word and turns „quotes“ Czech
//
// Every change is ONE edit-op, asked of the canvas through `run-action` (`ctx.onRunAction`): the canvas
// measures what only it can (the style's own values for Detach) and the studio writes plain TSX — a
// `t-<role>` class, a `lang` attribute, inline declarations — that a v1 peer reads as it is.

import { useEffect, useRef, useState } from 'react';
import { ACTIONS_BY_ID } from '../../../../actions/index.ts';
import {
  CZECH_LINE,
  caseFromCss,
  differsLine,
  LANGUAGES,
  languageOf,
  ROLE_CLASS_RE,
  resizingFromCss,
  resizingToCss,
  roleName,
} from '../../../../edit-ops/text-style.ts';
import { reduceMixed } from '../../../../edit-ops/words-paint.ts';
import { Segmented, Select } from '../../../inspector-controls.jsx';
import { activeDsNameFor } from '../../../inspector/ds-tokens.js';
import { StIcon } from '../../../shell/icons.jsx';
import { useCssWrite } from '../css-write.js';
import { Quiet, Row, worldSize } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { useDismiss } from '../token-chip.jsx';
import { isAllText } from './multi.jsx';

const listOf = (selection) => (Array.isArray(selection) ? selection : selection ? [selection] : []);
const refOf = (el) => (Array.isArray(el?.refs) ? el.refs[0] : null);

/** The refs of what a section acts on: the several selected objects, or the one. */
function targetsOf({ el, selection, kind }) {
  const list = kind === 'multi' ? listOf(selection) : [el];
  return list.map(refOf).filter(Boolean);
}

/** Ask the canvas to run a text action over `targets`. true = asked. */
function ask(ctx, id, targets, params = {}) {
  if (!ctx?.onRunAction || targets.length === 0) return false;
  ctx.onRunAction({ dgn: 'run-action', v: 1, id, params: { targets, ...params } });
  return true;
}

// ── the system's type roles ─────────────────────────────────────────────────────────────

/** @type {Map<string, Array<{ role: string, cls: string, label: string }>>} */
const rolesByUrl = new Map();
/** Tests only. */
export const clearTypeRoles = () => rolesByUrl.clear();

function rolesUrl(ctx) {
  const cfg = ctx?.cfg;
  const designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const name = activeDsNameFor(ctx?.canvasFile, cfg);
  const ds = (cfg?.designSystems || []).find((d) => d.name === name) || cfg?.designSystems?.[0];
  if (!ds?.tokensCssRel) return '';
  return `/${designRel}/${ds.tokensCssRel.replace(/[^/]*$/, '')}components.json`;
}

/** The roles the active system declares, in its order: `[{ role: 'heading', cls: 't-heading', label: 'Heading' }]`. */
export function useTypeRoles(ctx) {
  const url = rolesUrl(ctx);
  const [roles, setRoles] = useState(() => rolesByUrl.get(url) ?? []);
  useEffect(() => {
    if (!url) return undefined;
    const cached = rolesByUrl.get(url);
    if (cached) {
      setRoles(cached);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(url);
        const j = r.ok ? await r.json() : null;
        const map = j && typeof j.typeRoles === 'object' && j.typeRoles ? j.typeRoles : {};
        const list = Object.entries(map)
          .filter(([, cls]) => typeof cls === 'string' && ROLE_CLASS_RE.test(cls))
          .map(([role, cls]) => ({ role, cls, label: roleName(cls) }));
        rolesByUrl.set(url, list);
        if (!cancelled) setRoles(list);
      } catch {
        if (!cancelled) setRoles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return roles;
}

// ── Style ───────────────────────────────────────────────────────────────────────────────

function StyleBody({ el, selection, kind, ctx }) {
  const roles = useTypeRoles(ctx);
  const info = el?.textInfo ?? null;
  const targets = targetsOf({ el, selection, kind });
  const editable = targets.length > 0 && ctx?.editable !== false && !!ctx?.onRunAction;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(null); // the style this text was just detached from
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);
  const elKey = `${el?.id ?? ''}#${el?.index ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different object forgets the last detach
  useEffect(() => setFrom(null), [elKey]);

  const known = roles.find((r) => r.cls === info?.role);
  const name = known?.label ?? (info?.role ? roleName(info.role) : null);
  const differs = info?.differs ?? [];
  const changed = !!name && differs.length > 0;
  // "Update <Heading> for every canvas…" is S10's entry (S10-ds-review-entry.md): hidden until it is registered
  const canUpdate = changed && ACTIONS_BY_ID.has('ds.review-update');

  const use = (cls) => {
    setOpen(false);
    setFrom(null);
    ask(ctx, 'text.use-style', targets, { role: cls });
  };
  const detach = () => {
    setOpen(false);
    setFrom(name);
    ask(ctx, 'text.detach-style', targets);
  };

  return (
    <>
      <Row k="Style" name="style" mod={changed}>
        <span className="insp-len" ref={ref}>
          <button
            type="button"
            className={`insp-style${name ? '' : ' insp-style--none'}`}
            data-testid="insp-style"
            aria-label="Text style"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={!editable || (roles.length === 0 && !name)}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="insp-style-ic" aria-hidden="true">
              Aa
            </span>
            {name ? (changed ? `${name} · changed` : name) : 'No style'}
            <StIcon name="chevron-down" size={10} />
          </button>
          {open ? (
            <div
              className="insp-menu"
              role="menu"
              aria-label="Text style"
              data-testid="insp-menu-style"
            >
              {roles.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r.cls === info?.role}
                  className="insp-menu-i"
                  data-testid={`insp-style-${r.role}`}
                  onClick={() => use(r.cls)}
                >
                  <span>{r.label}</span>
                </button>
              ))}
              {name ? (
                <button
                  type="button"
                  role="menuitem"
                  className="insp-menu-i insp-menu-i--sep"
                  data-testid="insp-style-detach"
                  onClick={detach}
                >
                  Detach style
                </button>
              ) : null}
            </div>
          ) : null}
        </span>
      </Row>
      {changed ? (
        <div className="insp-line" data-testid="insp-style-differs">
          <span>{differsLine(name, differs)}</span>
          <button
            type="button"
            className="insp-line-act"
            data-testid="insp-style-reset"
            disabled={!editable}
            onClick={() => ask(ctx, 'text.reset-style', targets)}
          >
            Reset
          </button>
        </div>
      ) : null}
      {canUpdate ? (
        <button
          type="button"
          className="insp-quietlink"
          data-testid="insp-style-update"
          onClick={() =>
            ctx?.onShellAction?.('ds.review-update', {
              canvas: ctx?.canvasFile,
              elementId: el?.id,
              target: { kind: 'typeRole', role: info?.role?.replace(/^t-/, '') },
            })
          }
        >
          {`Update ${name} for every canvas…`}
        </button>
      ) : null}
      {!name && info && (from || roles.length > 0) ? (
        <div className="insp-line" data-testid="insp-style-none">
          <span>
            {from
              ? `Keeps its look; stops following ${from}. Nothing else changes.`
              : 'This text follows no style.'}
          </span>
          <button
            type="button"
            className="insp-line-act"
            data-testid="insp-style-use"
            disabled={!editable || roles.length === 0}
            onClick={() => setOpen(true)}
          >
            Use a style
          </button>
        </div>
      ) : null}
      {name && !changed ? (
        <Quiet testid="insp-style-follows">{`Change ${name} in the Design system and this follows.`}</Quiet>
      ) : null}
    </>
  );
}

// ── Resizing · Case · Language ──────────────────────────────────────────────────────────

const RESIZING = [
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'fixed', label: 'Fixed' },
];
const CASES = [
  { value: 'typed', label: 'As typed' },
  { value: 'upper', label: 'AA' },
];

function TextBody({ el, selection, kind, ctx }) {
  const { cssAll, editable: cssEditable, write } = useCssWrite(el, ctx);
  const list = kind === 'multi' ? listOf(selection) : [el];
  const targets = targetsOf({ el, selection, kind });
  const editable = targets.length > 0 && ctx?.editable !== false && !!ctx?.onRunAction;

  const resizing = resizingFromCss(cssAll[0] ?? {});
  const cases = reduceMixed(
    list.map((e) =>
      e?.textInfo
        ? e.textInfo.upper
          ? 'upper'
          : 'typed'
        : caseFromCss(e?.computed?.['text-transform'])
    )
  );
  const langs = reduceMixed(list.map((e) => languageOf(e?.textInfo?.lang)?.tag ?? ''));
  const langValue = langs.mixed ? 'mixed' : langs.value;
  const options = [
    ...(langs.mixed ? [{ value: 'mixed', label: 'Mixed' }] : []),
    ...(!langs.mixed && !langs.value ? [{ value: '', label: 'Not set' }] : []),
    ...LANGUAGES.map((l) => ({ value: l.tag, label: l.label })),
  ];
  const czech = !langs.mixed && langs.value === 'cs';

  return (
    <>
      {kind === 'multi' ? null : (
        <Row k="Resizing" name="resizing">
          <span data-testid="insp-ctl-resizing">
            <Segmented
              value={resizing}
              ariaLabel="Text resizing"
              options={RESIZING}
              onChange={(mode) =>
                cssEditable && mode !== resizing && write(resizingToCss(mode, boxOf(el)))
              }
            />
          </span>
        </Row>
      )}
      <Row k="Case" name="case">
        <span data-testid="insp-ctl-case">
          <Segmented
            value={cases.mixed ? '' : cases.value}
            ariaLabel="Text case"
            options={CASES}
            onChange={(c) =>
              editable &&
              (cases.mixed || c !== cases.value) &&
              ask(ctx, 'text.set-case', targets, { case: c })
            }
          />
        </span>
      </Row>
      <Row k="Language" name="language">
        <Select
          value={langValue}
          options={options}
          ariaLabel="Language"
          testId="insp-language"
          onChange={(tag) =>
            editable &&
            tag &&
            tag !== 'mixed' &&
            ask(ctx, 'text.set-language', targets, { lang: tag })
          }
        />
      </Row>
      {czech ? (
        <div className="insp-line" data-testid="insp-language-note">
          <span>{CZECH_LINE}</span>
        </div>
      ) : null}
    </>
  );
}

const boxOf = (el) => {
  const s = worldSize(el);
  return { w: s.width, h: s.height };
};

export const offTextStyle = registerSlot('type', {
  id: 'type.style',
  order: 5,
  kinds: ['text'],
  Body: StyleBody,
});

export const offTextBody = registerSlot('type', {
  id: 'type.text',
  order: 20,
  kinds: ['text', 'multi'],
  when: ({ selection, kind }) => kind !== 'multi' || isAllText(selection),
  Body: TextBody,
});
