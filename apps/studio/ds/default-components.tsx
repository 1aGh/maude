// `@maude/ds` defaults (V2-1.13 §5.11): the 14 core components + Logo / Icon / Text rendering
// the registry's class contract (§5.3.9), so a system with only CSS gets React components for
// free. A system overrides any of them in `system/<ds>/preview/_ds.tsx` (which may re-export
// these). Structure only — no value lives here; every look comes from the system's CSS or the
// shell's fallback layer (DDR-043).
//
// NOT wired yet: the per-canvas `@maude/ds` resolver (canvas-build.ts) and `<DSRoot>` in
// canvas-lib land in a separate, ordered commit (lane L1 owns canvas-lib).

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The 40-name icon vocabulary (registry `icons.vocabulary`); anything else is `ext`. */
export type IconName =
  | 'home'
  | 'search'
  | 'add'
  | 'close'
  | 'check'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'more'
  | 'settings'
  | 'user'
  | 'users'
  | 'bell'
  | 'share'
  | 'link'
  | 'trash'
  | 'edit'
  | 'copy'
  | 'download'
  | 'upload'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'success'
  | 'star'
  | 'heart'
  | 'calendar'
  | 'clock'
  | 'image'
  | 'file'
  | 'folder'
  | 'play'
  | 'pause'
  | 'external';

type Tone = `accent-${number}` | 'brand';

export function Button({
  variant,
  size,
  tone,
  pressed,
  busy,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'lg';
  tone?: Tone;
  pressed?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cx('btn', variant && `btn--${variant}`, size && `btn--${size}`, className)}
      data-tone={tone}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
    />
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: Parameters<typeof Button>[0] & { label: string }) {
  return (
    <Button {...rest} aria-label={label} className={cx('btn--icon', className)}>
      {children}
    </Button>
  );
}

export function Input({
  size,
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm'; invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={cx('input', size && 'input--sm', className)}
      aria-invalid={invalid || undefined}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="field" aria-invalid={error ? true : undefined}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
    />
  );
}

export function Checkbox({
  radio,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { radio?: boolean }) {
  return (
    <input
      type={radio ? 'radio' : 'checkbox'}
      {...rest}
      className={cx(radio ? 'radio' : 'checkbox', className)}
    />
  );
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size,
}: {
  items: { value: T; label: ReactNode }[];
  value: T;
  onChange?: (v: T) => void;
  size?: 'sm';
}) {
  return (
    <div className={cx('seg', size && 'seg--sm')}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className="seg__item"
          aria-pressed={it.value === value}
          onClick={() => onChange?.(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: ReactNode }[];
  value: T;
  onChange?: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={it.value === value}
          onClick={() => onChange?.(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  variant,
  tone,
  pressed,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: 'accent' | 'soft';
  tone?: Tone;
  pressed?: boolean;
}) {
  const cls = cx('chip', variant && `chip--${variant}`, className);
  // a toggleable tag is a button (aria-pressed); a static one is a span
  if (pressed !== undefined)
    return (
      <button
        type="button"
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
        className={cls}
        data-tone={tone}
        aria-pressed={pressed}
      />
    );
  return <span {...rest} className={cls} data-tone={tone} />;
}

export function Badge({
  variant,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: 'success' | 'warn' | 'error' | 'info' | 'accent';
}) {
  return <span {...rest} className={cx('badge', variant && `badge--${variant}`, className)} />;
}

export function Card({
  variant,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: 'raised' | 'interactive' | 'flat' }) {
  return <div {...rest} className={cx('card', variant && `card--${variant}`, className)} />;
}

export function Callout({
  variant,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: 'info' | 'success' | 'warn' | 'error' }) {
  return (
    <div
      role="note"
      {...rest}
      className={cx('callout', variant && `callout--${variant}`, className)}
    />
  );
}

export function Dialog({
  open = true,
  title,
  actions,
  children,
}: {
  open?: boolean;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="scrim" />
      <div className="dialog" role="dialog" aria-modal="true">
        <h2 className="dialog__title">{title}</h2>
        {children ? <div className="dialog__body">{children}</div> : null}
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </>
  );
}

export function Tooltip({
  side = 'top',
  children,
}: {
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  return (
    <span className="tooltip" role="tooltip" data-side={side}>
      {children}
    </span>
  );
}

/**
 * The default Icon draws NOTHING (no stroke, no fill — DDR-043): an empty 16 px box that keeps
 * the layout, marked `data-ds-missing` so critics and the keeper can find it. A system ships its
 * glyphs through `preview/_ds.tsx`; a name its components.json maps to `null` is a declared gap
 * and renders this box (decision v2-2.15-icon-null-declared-gap).
 */
export function Icon({ name, size = 16 }: { name: IconName | (string & {}); size?: number }) {
  return (
    <span
      aria-hidden="true"
      data-ds-missing={name}
      style={{ display: 'inline-block', width: size, height: size, flex: 'none' }}
    />
  );
}

/** The default Logo renders nothing: a system's mark is always its own `preview/logo.*` (DDR-141). */
export function Logo({
  variant = 'mark',
}: {
  variant?: 'mark' | 'wordmark' | 'lockup';
  tone?: 'auto' | 'mono';
}) {
  return <span aria-hidden="true" data-ds-missing={`logo:${variant}`} />;
}

export type TextRole =
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'body-sm'
  | 'caption'
  | 'label'
  | 'eyebrow'
  | 'code'
  | 'num'
  | `display-${number}`;

export function Text({
  role,
  as: Tag = 'span',
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  role: TextRole;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';
}) {
  return <Tag {...rest} className={cx(`t-${role}`, className)} />;
}

/** A system's own components (`ext.*`); the defaults ship none. */
export const ext: Record<string, unknown> = {};
