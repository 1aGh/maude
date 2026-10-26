// client/v2/settings/parts.jsx — V2-4.7a: the few pieces every Settings section draws with.
// A group is a titled block; a row is a label + its control (06 ad-settings' SGroup / ARow).

/** A titled block of rows. `testid` is optional — only a group a scenario must find by name has one.
 *  The landmark's NAME says where it is ("Layout settings"): Settings open over the inspector would otherwise
 *  carry two sections both named "Layout" (axe landmark-unique). The visible title stays the title. */
export function Group({ title, children, testid }) {
  return (
    <section className="v2s-group" aria-label={`${title} settings`} data-testid={testid}>
      <h3 className="v2s-group-t">{title}</h3>
      {children}
    </section>
  );
}

/** One labelled switch: the label and its one-line meaning on the left, the control on the right. */
export function SwitchRow({ testid, label, note, checked, disabled, onChange }) {
  return (
    <label className="v2s-row v2s-row--switch" data-testid={testid}>
      <span className="v2s-row-t">
        <span className="v2s-row-k">{label}</span>
        {note && <span className="v2s-hint">{note}</span>}
      </span>
      <input
        type="checkbox"
        className="st-switch"
        role="switch"
        aria-checked={!!checked}
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** label left, control right. `mono` sets the value in the mono face (an address, a version). */
export function Row({ label, hint, mono, children, testid }) {
  return (
    <div className="v2s-row" data-testid={testid}>
      <span className="v2s-row-t">
        <span className="v2s-row-k">{label}</span>
        {hint && <span className="v2s-hint">{hint}</span>}
      </span>
      <span className={mono ? 'v2s-val v2s-val--mono' : 'v2s-val'}>{children}</span>
    </div>
  );
}
