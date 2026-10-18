// Patterns: real screens built from the system. A new system starts with none (V2-1.6 §5.2); the
// canvases that follow it are the patterns until a person pins one here.
import { Frame, type SectionProps } from './parts.tsx';

export function PatternsSection({ model, mode }: SectionProps) {
  const n = model.canvases;
  return (
    <Frame kind="patterns" model={model} mode={mode}>
      <div className="ds-pad ds-pats">
        <p className="ds-empty">
          <b>No patterns yet</b>
          <span>
            Screens built from {model.label} show up here.
            {n ? ` ${n} ${n === 1 ? 'canvas follows' : 'canvases follow'} it.` : ''}
          </span>
        </p>
      </div>
    </Frame>
  );
}
