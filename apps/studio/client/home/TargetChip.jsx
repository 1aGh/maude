// client/home/TargetChip.jsx — "Starts a new canvas in <project>" (S6.4, 01 cf-home-prompt).
//
// The chip under Home's question says which project the sentence lands in; its menu lists the projects
// on this Mac and in the cloud (greyed "not on this Mac yet" when offline) and "a new project". The
// choices come from home-model.js `targetChoices`; this file only draws them. `variant="bar"` is the
// same chip in the condensed ask bar that stays on top once the question has scrolled away
// ("in <project>", 11 pn-home).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { HIcon } from './home-icons.jsx';

/**
 * @param {{ choices: Array<{key:string,name:string,hint:string|null,disabled:boolean,kind:string}>,
 *           value: string, onChange: (key: string) => void, variant?: 'full'|'bar',
 *           disabled?: boolean }} props
 */
export function TargetChip({ choices, value, onChange, variant = 'full', disabled = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = choices.find((c) => c.key === value) ?? choices.at(-1);
  const bar = variant === 'bar';
  const id = bar ? 'home-askbar-target' : 'home-target-chip';

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // r1 (img 7): the menu stays inside the window — it opens below the chip and is no taller than the room
  // there; when below has less than a short list's room and above has more, it opens above instead.
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const chip = wrap.current?.getBoundingClientRect?.();
    if (!chip || typeof window === 'undefined') return;
    setPlace(menuPlace(chip, window.innerHeight));
  }, [open]);

  // opening puts the focus on the chosen item, so the arrows work at once
  useEffect(() => {
    if (!open) return;
    const items = [
      ...(wrap.current?.querySelectorAll('[role="menuitemradio"]:not([aria-disabled="true"])') ??
        []),
    ];
    const on = items.find((el) => el.getAttribute('aria-checked') === 'true');
    (on ?? items[0])?.focus?.();
  }, [open]);

  // the menu's arrows: up/down walk the enabled items
  const walk = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [
      ...(wrap.current?.querySelectorAll('[role="menuitemradio"]:not([aria-disabled="true"])') ??
        []),
    ];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    items[(next + items.length) % items.length].focus();
  };

  return (
    <span className="home-target" ref={wrap}>
      <button
        type="button"
        className={`chip home-target-chip${bar ? ' home-target-chip--bar' : ''}`}
        data-testid={id}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {bar ? 'in ' : 'Starts a new canvas in '}
        <strong>{current?.name}</strong>
        <HIcon name="chevron" size={12} />
      </button>
      {open ? (
        <div
          className="island home-target-menu"
          role="menu"
          aria-label="Start the canvas in"
          data-testid="home-target-menu"
          data-up={place?.up ? 'true' : undefined}
          style={place ? { maxHeight: place.maxHeight } : undefined}
          onKeyDown={walk}
        >
          {choices.map((c, i) => (
            <span key={c.key} className="home-target-li" role="none">
              {c.kind === 'new' && i > 0 ? (
                <span className="home-target-sep" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={c.key === current?.key}
                aria-disabled={c.disabled || undefined}
                className="row-item home-target-item"
                data-testid={`home-target-item-${c.key}`}
                onClick={() => {
                  if (c.disabled) return;
                  onChange(c.key);
                  setOpen(false);
                }}
              >
                <span className="home-target-name">{c.name}</span>
                {c.hint ? <span className="home-target-hint">{c.hint}</span> : null}
                {c.key === current?.key ? (
                  <span className="home-target-tick" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** Room the menu keeps from the window's edge, and the least it may shrink to before it flips. */
const EDGE = 8;
const MIN_ROOM = 160;
const MAX_H = 320;

/** Where the target menu opens for a chip at `chip` in a window `vh` tall: `{up, maxHeight}`. */
export function menuPlace(chip, vh) {
  const below = vh - chip.bottom - EDGE - 4;
  const above = chip.top - EDGE - 4;
  const up = below < MIN_ROOM && above > below;
  return { up, maxHeight: Math.max(0, Math.min(MAX_H, up ? above : below)) };
}
