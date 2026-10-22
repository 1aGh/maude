// client/v2/ds/uses-link.jsx — S10.13: the inspector's "Uses <design system>" line, a door (11 · pn-ds, 13 ·
// ds-where-studio ②). Select anything and the inspector names the system its canvas follows; one click opens
// that system's Design system canvas (`ds.go-to`). Without a shell to run the action (a read-only embed) it is
// the plain line it always was.

import { StIcon } from '../../shell/icons.jsx';

/** The system's name for people: its configured label, else its name. */
export function systemLabel(cfg, name) {
  const entry = (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).find(
    (d) => d?.name === name
  );
  return String(entry?.label || name || '');
}

/**
 * Is `name` a design system this project actually has? A project with none still resolves a default NAME
 * ("project"), and "Uses project ↗" then pointed at a system that does not exist (P8-B2).
 */
export function isConfiguredSystem(cfg, name) {
  return (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).some(
    (d) => d?.name && d.name === name
  );
}

/**
 * @param {{ ds: string, cfg?: any, onShellAction?: (id: string, params: object) => void }} p
 */
export function UsesLink({ ds, cfg, onShellAction }) {
  const label = systemLabel(cfg, ds);
  if (!ds) return null;
  if (typeof onShellAction !== 'function')
    return (
      <p className="insp-uses" data-testid="inspector-uses">
        Uses {label}
      </p>
    );
  return (
    <p className="insp-uses" data-testid="inspector-uses">
      <button
        type="button"
        className="insp-uses-link"
        data-testid="inspector-uses-link"
        data-ds={ds}
        title={`Open ${label}`}
        onClick={() => onShellAction('ds.go-to', { ds })}
      >
        <span className="insp-uses-ic" aria-hidden="true">
          <StIcon name="layers" size={12} />
        </span>
        <span className="insp-uses-t">
          Uses <strong>{label}</strong>
        </span>
        <StIcon name="chevron-right" size={12} />
      </button>
    </p>
  );
}
