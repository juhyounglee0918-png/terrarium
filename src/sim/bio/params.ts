/** Typed views of the simulation blocks in src/data/species.json. */
import speciesData from '../../data/species.json';

export interface PlantParams {
  kind: 'vascular';
  form: 'rosette' | 'trailing' | 'fern' | 'upright' | 'spikemoss' | 'climber' | 'succulent';
  amax25: number; // µmol CO₂ m⁻² leaf s⁻¹ at 25 °C, light- and CO₂-saturated reference
  tOpt: number;
  tWidth: number;
  tMax: number; // heat damage above this
  g1: number; // Medlyn slope, kPa^0.5
  g0: number; // mol m⁻² s⁻¹
  lma: number; // kg C per m² leaf
  alloc: [number, number, number]; // leaf, stem, root
  cn: [number, number, number];
  psiClose: number; // m of head (−) where stomata are shut
  psiWilt: number; // m of head (−) where tissue dies
  leafLife: number; // days
  maxHeight: number; // m
  maxLeafArea: number; // m²
  lightMin: number; // µmol/m²/s below which the plant starves slowly
  lightMax: number; // above which leaves bleach
  rhMin: number; // below which leaf tips scorch
  init: { leafC: number; stemC: number; rootC: number };
  mycorrhizal: boolean;
  waterStore: number; // kg of water stored per m² of leaf beyond a thin-leaf baseline (succulence)
  rotSusceptibility: number;
  cam: boolean;
}

export interface MossParams {
  kind: 'moss';
  amax: number; // µmol CO₂ m⁻² ground s⁻¹ at full cover
  ppfdMin: number;
  ppfdOpt: number;
  ppfdMax: number;
  wOpt: [number, number]; // g water / g dry, photosynthetic optimum
  wMax: number; // g/g at full saturation
  biomassMax: number; // kg C per m² at full cover
  spread: number; // m/day lateral spread of a healthy mat edge
  desiccationDays: number; // days of full desiccation survived
  cn: number;
}

export interface StageParams {
  name: string;
  tBase: number;
  dd: number; // degree-days to leave this stage (0 = terminal)
  bodyC: number; // kg C per individual when full grown for this stage
  feeds: boolean;
}

export interface DietItem {
  food: string; // fungi | bacteria | litter | algae | roots | soilorganic | prey:<id>
  pref: number;
}

export interface CohortParams {
  kind: 'cohort';
  stages: StageParams[];
  diet: DietItem[];
  assim: number;
  cn: number;
  fecundity: [number, number][]; // (°C, eggs per adult per day)
  lifespan: [number, number][]; // (°C, adult lifespan days)
  tMin: number;
  tMax: number;
  rhMin: number;
  crowding: number; // individuals per m² where crowding mortality equals background
  eggC: number;
  wetSoil: boolean; // eggs/larvae need wet substrate
  maxPrey?: number; // prey per predator per day
}

export interface AgentParams {
  kind: 'agent';
  adultC: number;
  hatchC: number;
  maturityDays: number;
  lifespanDays: number;
  broodSize: number;
  broodInterval: number;
  broodDays: number;
  tOpt: number;
  tMax: number;
  rhMin: number;
  assim: number;
  cn: number;
  diet: DietItem[];
  speed: number; // m per minute
  photophobic: boolean;
  calcium: number; // 0..1 how strongly reproduction depends on a calcium source
  burrows?: boolean;
}

export type SimParams = PlantParams | MossParams | CohortParams | AgentParams;

export interface SpeciesInfo {
  id: string;
  name: string;
  latin: string;
  group: string;
  model: string;
  milestone: string;
  facts: string;
  sources: string[];
  confidence: string;
  sim?: SimParams;
}

export const SPECIES: Record<string, SpeciesInfo> = Object.fromEntries(
  (speciesData.organisms as unknown as SpeciesInfo[]).map((o) => [o.id, o]),
);

function get<T extends SimParams>(id: string, kind: T['kind']): T {
  const s = SPECIES[id]?.sim;
  if (!s || s.kind !== kind) throw new Error(`Species ${id} has no ${kind} parameters`);
  return s as T;
}

export const plantParams = (id: string) => get<PlantParams>(id, 'vascular');
export const mossParams = (id: string) => get<MossParams>(id, 'moss');
export const cohortParams = (id: string) => get<CohortParams>(id, 'cohort');
export const agentParams = (id: string) => get<AgentParams>(id, 'agent');

export const speciesOfKind = (kind: SimParams['kind']) =>
  Object.values(SPECIES).filter((s) => s.sim?.kind === kind).map((s) => s.id);

/** Piecewise-linear interpolation over (x, y) pairs, clamped at the ends. */
export function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------- shared physiology

const BOLTZMANN_EV = 8.617e-5;
const MTE_E = 0.65; // eV, Brown et al. 2004
/**
 * MTE normalisation calibrated so a 60 mg woodlouse respires ≈200 µl O₂ g⁻¹ h⁻¹ at 20 °C,
 * inside the 148–772 µl g⁻¹ h⁻¹ range measured for terrestrial isopods (15–35 °C).
 */
const MTE_B0 = 1.45e10; // W kg^-3/4
const J_PER_KG_C = 3.9e7; // energy released per kg C of carbohydrate respired

/** Standard metabolic rate of an invertebrate as kg C respired per day. */
export function metabolicC(bodyC: number, tC: number): number {
  const fresh = Math.max(bodyC, 1e-15) / 0.1; // fresh mass ≈ 10× carbon
  const tk = Math.min(tC, 38) + 273.15;
  const w = MTE_B0 * Math.pow(fresh, 0.75) * Math.exp(-MTE_E / (BOLTZMANN_EV * tk));
  return (w * 86400) / J_PER_KG_C;
}

/** Thermal performance: 1 at tOpt, falls off toward tMin/tMax. */
export function thermalPerformance(t: number, tMin: number, tOpt: number, tMax: number): number {
  if (t <= tMin || t >= tMax) return 0;
  if (t <= tOpt) return Math.pow((t - tMin) / (tOpt - tMin), 1.2);
  return Math.pow((tMax - t) / (tMax - tOpt), 0.8);
}
