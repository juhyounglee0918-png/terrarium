import materialsData from '../data/materials.json';
import type { LightingConfig } from './physics/light';
import type { SoilMaterial } from './physics/soil';

export type LidType = 'sealed' | 'glass' | 'cork' | 'open';

/** Air changes per hour through / around the lid (leakage + buoyant exchange). */
export const LID_ACH: Record<LidType, number> = {
  sealed: 0.003, // gasket / wax seal
  glass: 0.15, // loose glass lid resting on the rim
  cork: 0.05, // push-fit cork
  open: 25, // buoyant exchange through the full opening
};

export interface LayerSpec {
  material: string;
  thickness: number; // m
  /** Initial matric head (m); 0 = saturated, −0.3 ≈ well-drained potting mix. */
  initialHead: number;
}

export interface RoomClimate {
  meanTemp: number; // °C
  dailyAmplitude: number; // °C, half peak-to-peak; minimum at ~06:00
  rh: number; // 0..1
  co2ppm: number;
}

export interface TerrariumConfig {
  radius: number; // inner radius, m
  height: number; // inner height, m
  glassThickness: number; // m
  layers: LayerSpec[]; // bottom → top
  lid: LidType;
  lighting: LightingConfig;
  room: RoomClimate;
  startDayOfYear: number;
  startHour: number;
  seed: number;
  /** Glass wall discretisation (above the substrate). */
  glassBands: number;
  glassSectors: number;
  /** Simulation step (s). */
  dt: number;
}

export const MATERIALS: Record<string, SoilMaterial> = Object.fromEntries(
  (materialsData.materials as SoilMaterial[]).map((m) => [m.id, m]),
);

export function defaultConfig(): TerrariumConfig {
  return {
    radius: 0.12,
    height: 0.3,
    glassThickness: 0.004,
    layers: [
      { material: 'leca', thickness: 0.035, initialHead: -0.2 },
      { material: 'charcoal', thickness: 0.008, initialHead: -0.2 },
      { material: 'substrate', thickness: 0.06, initialHead: -0.25 },
    ],
    lid: 'glass',
    lighting: {
      placement: 'nearWindow',
      latitude: 37.5,
      windowAzimuth: Math.PI, // south-facing
      ledPPFD: 120,
      ledOnHour: 7,
      ledOffHour: 21,
    },
    room: { meanTemp: 22, dailyAmplitude: 2.5, rh: 0.5, co2ppm: 600 },
    startDayOfYear: 110, // late April
    startHour: 6,
    seed: 20260923,
    glassBands: 8,
    glassSectors: 12,
    dt: 60,
  };
}
