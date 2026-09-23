/**
 * Render/UI-friendly view of the state: what the renderer draws and the HUD shows. Plain arrays
 * so it can be posted from the worker cheaply.
 */
import { MATERIALS } from './config';
import { FILM_HOLD_LID, FILM_HOLD_WALL, geometry } from './physics/environment';
import { mossCoverFraction } from './bio/moss';
import { agentParams, cohortParams, plantParams, SPECIES } from './bio/params';
import { leafArea } from './bio/plants';
import { crownRadius } from './bio/surface';
import { population } from './bio/fauna';
import type { SimState } from './types';

export interface PlantView {
  id: number;
  species: string;
  name: string;
  form: string;
  x: number;
  z: number;
  height: number;
  stemLength: number;
  leafArea: number; // m²
  crown: number; // m
  wilt: number;
  chlorosis: number;
  etiolation: number;
  health: number;
  rootDamage: number;
  water: number;
  parLeaf: number;
  age: number;
}

export interface AgentView {
  id: number;
  species: string;
  x: number;
  z: number;
  heading: number;
  size: number; // body C relative to adult
  brooding: boolean;
}

export interface CohortView {
  species: string;
  name: string;
  stages: { name: string; n: number }[];
  total: number;
  active: number; // individuals out and about (feeding stages + adults)
}

export interface SurfaceView {
  n: number;
  cellSize: number;
  mossSpecies: number[]; // 0 none, 1 hypnum, 2 leucobryum …
  mossCover: number[];
  mossHealth: number[];
  mossWet: number[]; // 0 dry … 1 saturated
  mould: number[];
  slime: number[];
  litter: number[];
}

export interface SceneView {
  jar: { radius: number; height: number; layers: { material: string; thickness: number }[] };
  bands: number;
  sectors: number;
  glassFilm: number[];
  glassAlgae: number[]; // 0..1 visual density
  lidFilm: number;
  soil: { material: string; thickness: number; saturation: number; redox: number }[];
  surface: SurfaceView;
  plants: PlantView[];
  agents: AgentView[];
  cohorts: CohortView[];
  mushrooms: { id: number; x: number; z: number; age: number }[];
  litterC: number; // kg
  hardscape: { x: number; z: number; size: number }[];
}

export const MOSS_INDEX: Record<string, number> = { hypnum: 1, leucobryum: 2 };

export function sceneView(state: SimState): SceneView {
  const cfg = state.config;
  const g = geometry(cfg);
  const s = state.surface;
  const hold = FILM_HOLD_WALL * g.nodeArea;
  return {
    jar: { radius: cfg.radius, height: cfg.height, layers: cfg.layers.map((l) => ({ material: l.material, thickness: l.thickness })) },
    bands: cfg.glassBands,
    sectors: cfg.glassSectors,
    glassFilm: state.glassFilm.map((f) => Math.min(1, f / hold)),
    glassAlgae: state.glassAlgae.map((a) => Math.min(1, a / g.nodeArea / 0.004)),
    lidFilm: Math.min(1, state.lid.film / (FILM_HOLD_LID * g.areaTop)),
    soil: state.soil.map((l) => {
      const m = MATERIALS[l.material];
      return {
        material: l.material,
        thickness: l.thickness,
        saturation: Math.min(1, Math.max(0, (l.theta - m.thetaR) / (m.thetaS - m.thetaR))),
        redox: l.redox,
      };
    }),
    surface: {
      n: s.n,
      cellSize: s.cellSize,
      mossSpecies: s.moss.species.map((sp) => MOSS_INDEX[sp] ?? 0),
      mossCover: s.moss.cover.slice(),
      mossHealth: s.moss.health.slice(),
      mossWet: s.moss.species.map((sp, i) => {
        if (!sp || s.moss.biomass[i] <= 0) return 0;
        const dry = s.moss.biomass[i] / 0.45;
        return Math.min(1, s.moss.water[i] / dry / 6);
      }),
      mould: s.mould.slice(),
      slime: s.slime.slice(),
      litter: s.litterWeight.map((w) => Math.min(1, w)),
    },
    plants: state.plants
      .filter((p) => p.alive)
      .map((p) => {
        const pp = plantParams(p.species);
        return {
          id: p.id,
          species: p.species,
          name: SPECIES[p.species]?.name ?? p.species,
          form: pp.form,
          x: p.x,
          z: p.z,
          height: p.height,
          stemLength: p.stemLength,
          leafArea: leafArea(p),
          crown: crownRadius(p, pp.lma),
          wilt: p.wilt,
          chlorosis: p.chlorosis,
          etiolation: p.etiolation,
          health: p.health,
          rootDamage: p.rootDamage,
          water: p.water,
          parLeaf: p.parLeaf ?? 0,
          age: p.age,
        };
      }),
    agents: state.agents.map((a) => ({
      id: a.id,
      species: a.species,
      x: a.x,
      z: a.z,
      heading: a.heading,
      size: Math.min(1.2, Math.max(0.15, Math.pow(a.bodyC / agentParams(a.species).adultC, 1 / 3))),
      brooding: a.brood > 0,
    })),
    cohorts: state.cohorts.map((c) => {
      const p = cohortParams(c.species);
      const active = c.stages.reduce((sum, st, i) => sum + (p.stages[i].feeds || i === c.stages.length - 1 ? st.n : 0), 0);
      return {
        species: c.species,
        name: SPECIES[c.species]?.name ?? c.species,
        stages: c.stages.map((st, i) => ({ name: p.stages[i].name, n: st.n })),
        total: population(state, c.species),
        active,
      };
    }),
    mushrooms: state.mushrooms.map((m) => ({ id: m.id, x: m.x, z: m.z, age: m.age })),
    litterC: state.litter.metC + state.litter.strC,
    hardscape: cfg.hardscape.map((h) => ({ x: h.x, z: h.z, size: h.size })),
  };
}

export { mossCoverFraction };
