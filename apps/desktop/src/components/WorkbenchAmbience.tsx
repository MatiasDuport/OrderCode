import { memo } from 'react';

/** Decorative light only; the application remains usable without animation. */
export const WorkbenchAmbience = memo(function WorkbenchAmbience() {
  return <div className="workbench-ambience" aria-hidden="true">
    <div className="ambient-lights">
      <span className="ambient-light ambient-light--blue" />
      <span className="ambient-light ambient-light--violet" />
      <span className="ambient-light ambient-light--silver" />
    </div>
  </div>;
});
