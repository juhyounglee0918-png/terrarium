import type { Advice } from '../sim/advisor';
import type { ChallengeStatus } from '../sim/challenges';
import type { LidType } from '../sim/config';
import type { Readout } from '../sim/diagnostics';
import type { Placement } from '../sim/physics/light';
import type { SceneView } from '../sim/snapshot';
import type { GameEvent } from '../sim/types';

export type Action =
  | { kind: 'mist'; kg: number }
  | { kind: 'water'; kg: number }
  | { kind: 'lid'; lid: LidType }
  | { kind: 'placement'; placement: Placement }
  | { kind: 'roomTemp'; celsius: number }
  | { kind: 'addPlant'; species: string; x: number; z: number }
  | { kind: 'prune'; id: number }
  | { kind: 'removePlant'; id: number }
  | { kind: 'addFauna'; species: string; count: number }
  | { kind: 'addMoss'; species: string }
  | { kind: 'addLitter' }
  | { kind: 'removeMould' }
  | { kind: 'fertilize' }
  | { kind: 'calcium' }
  | { kind: 'wipeGlass' }
  | { kind: 'newGame'; preset: string };

export type ToWorker =
  | { type: 'speed'; simSecondsPerSecond: number }
  | { type: 'action'; action: Action }
  /** Run the simulation forward synchronously (debugging, screenshots). */
  | { type: 'advance'; seconds: number }
  | { type: 'save' }
  | { type: 'load'; json: string };

export const HISTORY_SERIES = ['airT', 'roomT', 'glassT', 'rh', 'co2', 'par', 'theta', 'springtails', 'mould'] as const;
export type HistorySeries = (typeof HISTORY_SERIES)[number];

export interface HistorySample {
  t: number;
  values: Record<HistorySeries, number>;
}

export interface FrameData {
  readout: Readout;
  scene: SceneView;
  lid: LidType;
  placement: Placement;
  preset: string;
  sun: { elevation: number; azimuth: number; direct: number; diffuse: number; led: number };
  newHistory: HistorySample[];
  newEvents: GameEvent[];
  advice: Advice[];
  challenges: ChallengeStatus[];
  stepsPerSecond: number;
  balanceError: { water: number; carbon: number; nitrogen: number };
  startHour: number;
}

export type FromWorker = { type: 'frame'; frame: FrameData } | { type: 'saved'; json: string } | { type: 'error'; message: string };
