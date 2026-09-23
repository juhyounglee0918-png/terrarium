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
  /** Scale of the seasonal indoor temperature swing (0 = none, 1 ≈ ±2.5 °C). */
  seasonal?: number;
}

export interface Hardscape {
  x: number; // m from jar centre (east)
  z: number; // m from jar centre (south)
  size: number; // m, rough radius
  limestone?: boolean; // releases calcium for snails and millipedes
}

export interface PlantSpec {
  species: string;
  x: number;
  z: number;
}

export interface MossSpec {
  species: string;
  fraction: number; // share of free surface covered at start
}

export interface FaunaSpec {
  species: string;
  count: number;
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
  /** Biology step (s); slow processes (growth, populations, decomposition). */
  bioDt: number;
  hardscape: Hardscape[];
  plants: PlantSpec[];
  moss: MossSpec[];
  fauna: FaunaSpec[];
  /** Fresh leaf litter placed on the surface at setup (kg C). */
  initialLitterC: number;
  /** Random events (heatwaves, power cuts, gnats flying in). */
  events: boolean;
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
    bioDt: 600,
    hardscape: [
      { x: -0.045, z: 0.03, size: 0.038 },
      { x: 0.05, z: -0.035, size: 0.024 },
      { x: 0.015, z: 0.06, size: 0.016 },
    ],
    plants: [
      { species: 'fittonia', x: -0.02, z: -0.045 },
      { species: 'pteris', x: 0.055, z: 0.04 },
      { species: 'selaginella', x: -0.07, z: -0.02 },
      { species: 'pilea', x: 0.02, z: 0.0 },
    ],
    moss: [
      { species: 'hypnum', fraction: 0.35 },
      { species: 'leucobryum', fraction: 0.08 },
    ],
    fauna: [
      { species: 'folsomia', count: 300 },
      { species: 'trichorhina', count: 25 },
    ],
    initialLitterC: 0.0008,
    events: true,
  };
}

/** Physics-only jar: no organisms, no fresh litter (used by M1 tests). */
export function bareConfig(): TerrariumConfig {
  const c = defaultConfig();
  return { ...c, plants: [], moss: [], fauna: [], initialLitterC: 0, events: false, room: { ...c.room, seasonal: 0 } };
}
