import type { LidType } from '../sim/config';
import type { Readout } from '../sim/diagnostics';
import type { Placement } from '../sim/physics/light';

export type Action =
  | { kind: 'mist'; kg: number }
  | { kind: 'water'; kg: number }
  | { kind: 'lid'; lid: LidType }
  | { kind: 'placement'; placement: Placement }
  | { kind: 'roomTemp'; celsius: number }
  | { kind: 'reset' };

export type ToWorker =
  | { type: 'speed'; simSecondsPerSecond: number }
  | { type: 'action'; action: Action }
  /** Run the simulation forward synchronously (debugging, screenshots). */
  | { type: 'advance'; seconds: number };

export const HISTORY_SERIES = ['airT', 'roomT', 'glassT', 'rh', 'co2', 'par', 'theta'] as const;
export type HistorySeries = (typeof HISTORY_SERIES)[number];

export interface HistorySample {
  t: number;
  values: Record<HistorySeries, number>;
}

export interface FrameData {
  readout: Readout;
  lid: LidType;
  placement: Placement;
  bands: number;
  sectors: number;
  /** Film load per glass node, 0..1 of the run-off threshold. */
  glassFilm: Float32Array;
  glassT: Float32Array;
  lidFilm: number;
  sun: { elevation: number; azimuth: number; direct: number; diffuse: number; led: number };
  soilDepths: { material: string; thickness: number; saturation: number }[];
  jar: { radius: number; height: number };
  newHistory: HistorySample[];
  stepsPerSecond: number;
  balanceError: { water: number; carbon: number };
}

export type FromWorker = { type: 'frame'; frame: FrameData };
