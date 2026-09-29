/**
 * Scientific-integrity metadata attached to every model.
 * `kind` distinguishes values that are actually calculated from an equation
 * from purely illustrative visual effects.
 */
export type ModelKind = 'calculated' | 'illustrative';

export interface ModelMeta {
  id: string;
  title: string;
  equations: string[];
  units: string[];
  assumptions: string[];
  validity: string;
  limitations: string[];
  reference: string;
  kind: ModelKind;
}
