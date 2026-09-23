/**
 * Simulation state. Everything here is plain data (numbers, arrays, objects) so it can be
 * cloned, posted to a worker, and serialised to JSON for save games.
 */
import type { LidType, TerrariumConfig } from './config';
import type { IndoorLight } from './physics/light';

export interface SoilLayerState {
  material: string;
  thickness: number;
  zCenter: number; // height of layer centre above jar floor, m
  theta: number;
  T: number;
  // --- organic matter (kg C / kg N per layer)
  metC: number; // metabolic litter (sugars, proteins): fast
  metN: number;
  strC: number; // structural litter (cellulose, lignin): slow
  strN: number;
  somC: number; // humus: very slow
  somN: number;
  // --- living pools (kg C, fixed C:N per group)
  bact: number;
  fung: number;
  protist: number;
  nemB: number; // bacterivorous nematodes
  nemF: number; // fungivorous nematodes
  slime: number; // plasmodial slime mould (surface layer)
  pythium: number; // root-rot oomycete
  // --- mineral nitrogen (kg N)
  nh4: number;
  no3: number;
  // --- redox diagnostics
  aerobic: number; // 0..1 fraction of pore space with O2
  anoxicDays: number; // accumulated time without oxygen, drives the redox ladder
  redox: number; // 0 O2, 1 NO3⁻, 2 Mn/Fe, 3 SO4²⁻ (H2S), 4 CH4
}

export interface SurfaceLitter {
  metC: number;
  metN: number;
  strC: number;
  strN: number;
}

export interface Plant {
  id: number;
  species: string;
  x: number;
  z: number;
  leafC: number; // kg C
  stemC: number;
  rootC: number;
  nsc: number; // non-structural carbohydrate reserve, kg C
  acid: number; // CAM malic-acid store, kg C
  N: number; // kg N in all tissues
  tissueWater: number; // kg water held in tissues
  height: number; // m
  stemLength: number; // m (can exceed height when etiolated/trailing)
  water: number; // 0..1 relative turgor
  health: number; // 0..1
  rootDamage: number; // 0..1 fraction of root function lost to rot
  age: number; // days
  lightAvg: number; // µmol/m²/s, 3-day running mean seen by the plant
  heatDamage: number;
  alive: boolean;
  deadDays: number;
  // diagnostics (last physics step)
  A: number; // net assimilation µmol/s whole plant
  E: number; // transpiration kg/s
  parLeaf?: number;
  // visual state
  wilt: number; // 0..1
  chlorosis: number; // 0..1 yellowing from N shortage
  etiolation: number; // 0..1 stretching from low light
}

export interface MossGrid {
  species: string[]; // per cell ('' = none)
  cover: number[]; // 0..1
  biomass: number[]; // kg C per cell
  water: number[]; // kg water held per cell
  N: number[]; // kg N per cell
  health: number[]; // 0..1 (browning)
  dryDays: number[]; // consecutive days desiccated
  wetDays: number[]; // consecutive days waterlogged
}

export interface SurfaceGrid {
  n: number; // n × n cells over the jar floor
  cellSize: number; // m
  inside: boolean[];
  rock: boolean[];
  moss: MossGrid;
  litterWeight: number[]; // where surface litter lies (for feeding and visuals)
  shade: number[]; // light transmitted through plant canopy to each cell (0..1)
  mould: number[]; // visible mould coverage 0..1 (derived)
  slime: number[]; // visible slime mould 0..1 (derived)
}

export interface CohortStage {
  n: number; // individuals
  c: number; // kg C in this stage
}

export interface Cohort {
  species: string;
  stages: CohortStage[]; // egg, juvenile(s)/larva, (pupa), adult
}

export interface Agent {
  id: number;
  species: string;
  x: number;
  z: number;
  heading: number;
  bodyC: number;
  broodC: number; // kg C of eggs/embryos carried
  age: number; // days
  adult: boolean;
  brood: number; // days until release (0 = not brooding)
  broodSize: number;
  hydration: number; // 0..1
  alive: boolean;
}

export interface Mushroom {
  id: number;
  x: number;
  z: number;
  c: number; // kg C
  N: number;
  age: number; // days
}

export interface Ledger {
  waterInitial: number;
  waterAdded: number;
  waterVentedNet: number;
  carbonInitial: number;
  carbonImported: number;
  carbonExported: number;
  carbonVentedNet: number;
  nitrogenInitial: number;
  nitrogenImported: number;
  nitrogenExported: number;
  nitrogenLostGas: number;
}

export interface StepFluxes {
  soilEvaporation: number; // kg/s
  transpiration: number; // kg/s (plants + moss)
  glassCondensation: number; // kg/s
  ventWater: number; // kg/s
  respirationCO2: number; // mol/s (soil heterotrophs + fauna)
  photosynthesisCO2: number; // mol/s gross uptake by plants, moss, algae
  plantRespirationCO2: number; // mol/s
  runoff: number;
  nMineralization: number; // kg N/s net
  denitrification: number; // kg N/s
}

export interface GameEvent {
  day: number;
  kind: string;
  text: string;
}

export interface SimState {
  config: TerrariumConfig;
  time: number;
  rng: { seed: number };
  cloud: number;
  air: { T: number; vapor: number; co2: number; o2: number; ch4: number; moles: number };
  glassT: number[];
  glassFilm: number[];
  glassAlgae: number[]; // kg C per glass node
  glassAlgaeN: number[]; // kg N per glass node
  lid: { T: number; film: number };
  soil: SoilLayerState[];
  litter: SurfaceLitter;
  surfaceFungi: number; // kg C of saprotrophic mould growing on the surface litter (visible)
  surface: SurfaceGrid;
  plants: Plant[];
  cohorts: Cohort[];
  agents: Agent[];
  mushrooms: Mushroom[];
  calcium: number; // days of calcium supply remaining (cuttlebone / limestone)
  nextId: number;
  bioClock: number; // s accumulated toward the next biology step
  latent: { glass: number[]; lid: number; soil: number };
  env: {
    roomT: number;
    roomRH: number;
    light: IndoorLight;
    parSoil: number;
    swSoil: number;
    rh: number;
    heatwave: number; // °C added to room temperature by events
    heatwaveDays: number;
    outage: number; // days of power cut remaining (LED off)
  };
  fluxes: StepFluxes;
  ledger: Ledger;
  events: GameEvent[];
  stats: {
    closedSinceDay: number; // day the lid was last closed (−1 = open)
    mouldySinceDay: number; // last day with visible mould
    maxAirT: number;
    plantDeaths: number;
    lastLid: LidType;
    completed: string[]; // challenge ids
  };
}
