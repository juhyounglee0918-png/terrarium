/**
 * Vascular plants.
 *
 * Fast (every physics step): light interception, photosynthesis (non-rectangular hyperbola ×
 * CO₂ × temperature × water × nitrogen), Medlyn stomatal conductance, respiration and the plant
 * water balance (roots refill a tissue water store, transpiration drains it).
 * Slow (biology step): nitrogen uptake, growth and allocation (etiolation, root:shoot), leaf and
 * root turnover, stress damage, offsets, death.
 */
import { C_MOLAR } from '../constants';
import { MATERIALS } from '../config';
import { satVaporDensity } from '../physics/psychro';
import { headFromTheta } from '../physics/soil';
import type { Plant, SimState, SoilLayerState } from '../types';
import { plantParams, SPECIES, type PlantParams } from './params';
import { cellAt, crownRadius, laiAbove, usableCells } from './surface';
import { nextRandom } from '../rng';
import { addToSurfaceLitter, addToSoilLitter } from './litter';

const QUANTUM_YIELD = 0.05; // mol CO₂ per mol photons (absorbed, effective)
const CURVATURE = 0.8;
const GAMMA_STAR = 40; // ppm CO₂ compensation point
const K_CO2 = 300; // ppm
const F_CO2_REF = (400 - GAMMA_STAR) / (400 + K_CO2);
const KR = 2e-3; // kg water per kg root C per s at full soil water
const UPTAKE_MAX = 0.03; // kg N per kg root C per day
const KM_N = 0.005; // kg N per m³ soil water-volume, half-saturation
const RGR_MAX = 0.08; // per day
const GROWTH_RESP = 0.25;
const EXUDATION = 0.03;
const MYCO_COST = 0.05;
const MYCO_BOOST = 1.4;
export const MAX_PLANTS = 24;

export const lmaOf = (sp: string) => plantParams(sp).lma;

export function leafArea(p: Plant): number {
  return p.leafC / plantParams(p.species).lma;
}

export function tissueCapacity(p: Plant): number {
  const pp = plantParams(p.species);
  return leafArea(p) * (0.05 + pp.waterStore) + 1e-6;
}

export function optimalN(p: Plant): number {
  const pp = plantParams(p.species);
  return p.leafC / pp.cn[0] + p.stemC / pp.cn[1] + p.rootC / pp.cn[2];
}

export function createPlant(state: SimState, species: string, x: number, z: number, scale = 1): Plant {
  const pp = plantParams(species);
  const p: Plant = {
    id: state.nextId++,
    species,
    x,
    z,
    leafC: pp.init.leafC * scale,
    stemC: pp.init.stemC * scale,
    rootC: pp.init.rootC * scale,
    nsc: (pp.init.leafC + pp.init.stemC + pp.init.rootC) * 0.1 * scale,
    N: 0,
    height: 0,
    stemLength: 0,
    water: 1,
    tissueWater: 0,
    acid: 0,
    health: 1,
    rootDamage: 0,
    age: 0,
    lightAvg: pp.lightMin * 3,
    heatDamage: 0,
    alive: true,
    deadDays: 0,
    A: 0,
    E: 0,
    wilt: 0,
    chlorosis: 0,
    etiolation: 0,
  };
  p.N = optimalN(p);
  p.tissueWater = tissueCapacity(p);
  updateShape(p, pp);
  return p;
}

export function plantCarbon(p: Plant): number {
  return p.leafC + p.stemC + p.rootC + p.nsc + p.acid;
}

/** Soil layers the roots explore (organic layers from the top), with weights. */
function rootLayers(state: SimState): { layer: SoilLayerState; w: number }[] {
  const out: { layer: SoilLayerState; w: number }[] = [];
  let w = 0.7;
  for (let j = state.soil.length - 1; j >= 0; j--) {
    const l = state.soil[j];
    const m = MATERIALS[l.material];
    if (!m.rootable) break;
    out.push({ layer: l, w });
    w *= 0.4;
  }
  if (out.length === 0) out.push({ layer: state.soil[state.soil.length - 1], w: 1 });
  const sum = out.reduce((s, o) => s + o.w, 0);
  out.forEach((o) => (o.w /= sum));
  return out;
}

export function rootZoneHead(state: SimState): number {
  let h = 0;
  for (const { layer, w } of rootLayers(state)) h += w * headFromTheta(MATERIALS[layer.material], layer.theta);
  return h;
}

function lightResponse(par: number, amax: number): number {
  const a = QUANTUM_YIELD * par;
  const s = a + amax;
  return (s - Math.sqrt(Math.max(0, s * s - 4 * CURVATURE * a * amax))) / (2 * CURVATURE);
}

function tempResponse(t: number, pp: PlantParams): number {
  const f = Math.exp(-Math.pow((t - pp.tOpt) / pp.tWidth, 2));
  return t >= pp.tMax + 5 ? 0 : f;
}

export function co2Response(ppm: number): number {
  return Math.max(0, (ppm - GAMMA_STAR) / (ppm + K_CO2)) / F_CO2_REF;
}

export interface TranspiringSurface {
  g: number; // m³/s
  rhoS: number; // kg/m³
  avail: number; // kg
  apply: (kg: number) => void; // evaporated mass this step (negative = condensation)
  flux?: number; // set by the solver
}

/**
 * Photosynthesis, respiration and stomata for one physics step. Mutates plant carbon and
 * returns CO₂ exchanged (mol, + = uptake) and the transpiring surfaces for the vapour solve.
 */
export function plantGasExchange(
  state: SimState,
  dt: number,
  env: { par: number; co2ppm: number; T: number; vpd: number; hm: number; isDay: boolean },
): { uptake: number; respired: number; surfaces: TranspiringSurface[] } {
  let uptake = 0;
  let respired = 0;
  const surfaces: TranspiringSurface[] = [];
  const psiSoil = rootZoneHead(state);
  const fCO2 = co2Response(env.co2ppm);
  const q10 = Math.pow(2, (env.T - 25) / 10);
  const D = Math.max(env.vpd, 0.05);
  const gToMs = (8.314 * (env.T + 273.15)) / 101325;

  for (const p of state.plants) {
    if (!p.alive) continue;
    const pp = plantParams(p.species);
    const la = leafArea(p);
    const lai = laiAbove(state.plants, lmaOf, p.x, p.z, p.height * 0.6, p);
    const selfShade = (1 - Math.exp(-0.7 * Math.max(la / (Math.PI * crownRadius(p, pp.lma) ** 2), 0.1))) / 0.7;
    const parLeaf = env.par * Math.exp(-0.7 * lai);
    p.parLeaf = parLeaf;
    const nRatio = Math.min(1.2, p.N / Math.max(optimalN(p), 1e-12));
    const fN = Math.min(1, 0.3 + 0.7 * nRatio);
    const fPsi = clamp01((psiSoil - pp.psiClose) / (-3 - pp.psiClose));
    const fW = Math.min(fPsi, clamp01((p.water - 0.25) / 0.5));
    const amax = pp.amax25 * tempResponse(env.T, pp) * fN * p.health * Math.max(fCO2, 0);
    const rd = 0.08 * pp.amax25 * q10 * la; // µmol/s, leaf dark respiration

    let aGross = 0; // µmol/s whole plant
    let gs: number; // mol/m²/s
    if (pp.cam) {
      const acidMax = la * pp.amax25 * 8 * 3600 * 1e-6 * C_MOLAR;
      if (!env.isDay) {
        // Night: stomata open, CO₂ fixed into malic acid.
        const rate = pp.amax25 * 0.6 * fW * fCO2 * la; // µmol/s
        const room = Math.max(0, acidMax - p.acid) / (C_MOLAR * 1e-6) / dt;
        const r = Math.min(rate, room);
        p.acid += r * dt * 1e-6 * C_MOLAR;
        uptake += r * dt * 1e-6;
        gs = pp.g0 + 0.05 * fW;
      } else {
        // Day: stomata shut, acid decarboxylated and refixed with light.
        const cap = lightResponse(parLeaf, pp.amax25 * p.health) * la * selfShade * 0.5;
        const use = Math.min(p.acid / (C_MOLAR * 1e-6) / dt, cap);
        p.acid -= use * dt * 1e-6 * C_MOLAR;
        p.nsc += use * dt * 1e-6 * C_MOLAR;
        gs = pp.g0 * 0.2;
      }
    } else {
      aGross = lightResponse(parLeaf, amax) * la * selfShade * fW;
      const aLeaf = la > 0 ? (aGross - rd) / la : 0;
      gs = pp.g0 + 1.6 * (1 + pp.g1 / Math.sqrt(D)) * Math.max(aLeaf, 0) / Math.max(env.co2ppm, 1);
      gs *= Math.max(0.05, fW);
    }

    // Maintenance respiration of stem and root (per day at 20 °C → per step).
    const q20 = Math.pow(2, (env.T - 20) / 10);
    const rMaint = (0.004 * p.stemC + 0.01 * p.rootC) * q20 * (dt / 86400); // kg C
    const rLeaf = rd * dt * 1e-6 * C_MOLAR;
    const gain = aGross * dt * 1e-6 * C_MOLAR;
    p.nsc += gain - rLeaf - rMaint;
    uptake += aGross * dt * 1e-6;
    respired += (rLeaf + rMaint) / C_MOLAR;
    if (p.nsc < 0) {
      // Carbon starvation: burn leaf tissue.
      const deficit = -p.nsc;
      const take = Math.min(deficit, p.leafC * 0.5);
      p.leafC -= take;
      p.nsc += take;
      if (p.nsc < 0) {
        p.stemC = Math.max(0, p.stemC + p.nsc);
        p.nsc = 0;
      }
      p.health = Math.max(0, p.health - 0.2 * (dt / 86400));
    }
    p.A = aGross - rd;

    // Water: roots refill tissue store from the soil.
    const cap = tissueCapacity(p);
    const supplyMax = KR * p.rootC * (1 - p.rootDamage) * clamp01((psiSoil - pp.psiWilt) / -pp.psiWilt) * dt;
    const refill = Math.min(supplyMax, Math.max(0, cap - p.tissueWater));
    const got = drawRootWater(state, refill);
    p.tissueWater += got;
    p.water = clamp01(p.tissueWater / cap);

    const g = 1 / (1 / Math.max(gs * gToMs * la, 1e-12) + 1 / (env.hm * Math.max(la, 1e-6)));
    surfaces.push({
      g,
      rhoS: satVaporDensity(env.T),
      avail: p.tissueWater,
      apply: (kg: number) => {
        if (kg > 0) {
          p.tissueWater = Math.max(0, p.tissueWater - kg);
          p.E = kg / dt;
        } else p.E = 0;
      },
    });
  }
  return { uptake, respired, surfaces };
}

/** Take water from the root zone (kg); returns what was available. */
function drawRootWater(state: SimState, kg: number): number {
  if (kg <= 0) return 0;
  const area = Math.PI * state.config.radius ** 2;
  let got = 0;
  for (const { layer, w } of rootLayers(state)) {
    const m = MATERIALS[layer.material];
    const availKg = Math.max(0, (layer.theta - m.thetaR - 0.02) * layer.thickness * area * 1000);
    const take = Math.min(kg * w, availKg);
    layer.theta -= take / 1000 / (layer.thickness * area);
    got += take;
  }
  return got;
}

/** Slow processes, called every biology step (dtd days). */
export function plantBiology(state: SimState, dtd: number, env: { T: number; rh: number; par: number }): void {
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  const newborn: Plant[] = [];
  for (const p of state.plants) {
    if (!p.alive) continue;
    const pp = plantParams(p.species);
    p.age += dtd;
    const par = p.parLeaf ?? env.par;
    p.lightAvg += (par - p.lightAvg) * Math.min(1, dtd / 3);

    // --- nitrogen uptake
    const nOpt = optimalN(p);
    let want = Math.max(0, 1.2 * nOpt - p.N);
    if (want > 0) {
      const myco = pp.mycorrhizal ? MYCO_BOOST : 1;
      const fT = Math.pow(2, (env.T - 20) / 10);
      for (const { layer, w } of rootLayers(state)) {
        const vol = layer.thickness * area * Math.max(layer.theta, 0.05);
        const conc = (layer.nh4 + layer.no3) / vol;
        const u = Math.min(want, UPTAKE_MAX * p.rootC * w * (1 - p.rootDamage) * (conc / (conc + KM_N)) * fT * myco * dtd);
        const tot = layer.nh4 + layer.no3;
        if (tot <= 0 || u <= 0) continue;
        const take = Math.min(u, tot * 0.5);
        const fnh = layer.nh4 / tot;
        layer.nh4 -= take * fnh;
        layer.no3 -= take * (1 - fnh);
        p.N += take;
        want -= take;
      }
    }
    const nRatio = p.N / Math.max(nOpt, 1e-12);
    p.chlorosis = clamp01((0.85 - nRatio) / 0.45);

    // --- stresses
    let stress = 0;
    if (env.T > pp.tMax) {
      p.heatDamage += (env.T - pp.tMax) * 0.15 * dtd;
      stress = Math.max(stress, clamp01((env.T - pp.tMax) / 5));
    }
    if (env.rh < pp.rhMin) stress = Math.max(stress, clamp01((pp.rhMin - env.rh) / 0.2) * 0.7);
    if (p.lightAvg > pp.lightMax * 1.3) stress = Math.max(stress, clamp01((p.lightAvg / pp.lightMax - 1.3) / 1.5));
    if (p.water < 0.3) stress = Math.max(stress, clamp01((0.3 - p.water) / 0.3));
    p.wilt = clamp01((0.75 - p.water) / 0.55);
    const damage = (p.water < 0.15 ? 0.35 : 0) + (env.T > pp.tMax + 3 ? 0.3 : 0) + (p.lightAvg > pp.lightMax * 2 ? 0.05 : 0) + p.rootDamage * 0.1;
    p.health = clamp01(p.health - damage * dtd + (stress < 0.1 && damage === 0 ? 0.05 * dtd : 0));

    // --- growth and allocation
    const S = p.leafC + p.stemC + p.rootC;
    const reserve = 0.1 * S;
    const la = leafArea(p);
    if (p.nsc > reserve && p.health > 0.2) {
      const fT = Math.exp(-Math.pow((env.T - pp.tOpt) / (pp.tWidth * 1.3), 2));
      const fN = clamp01((nRatio - 0.55) / 0.45);
      let grow = Math.min(p.nsc - reserve, RGR_MAX * S * fT * fN * p.health * dtd);
      if (grow > 0) {
        let [aL, aS, aR] = pp.alloc;
        const dark = clamp01(1 - p.lightAvg / (2.5 * pp.lightMin));
        p.etiolation += (dark - p.etiolation) * Math.min(1, dtd / 10);
        aS += aL * 0.35 * dark;
        aL *= 1 - 0.35 * dark;
        if (nRatio < 0.8 || p.water < 0.5) {
          aR += aL * 0.25;
          aL *= 0.75;
        }
        if (la >= pp.maxLeafArea) {
          aS += aL * 0.3;
          aR += aL * 0.2;
          aL *= 0.5;
          if (p.height >= pp.maxHeight * 0.95) grow *= 0.3;
        }
        const sum = aL + aS + aR;
        const respC = grow * GROWTH_RESP;
        const exud = grow * (EXUDATION + (pp.mycorrhizal ? MYCO_COST : 0));
        const build = grow - respC - exud;
        p.nsc -= grow;
        p.leafC += (build * aL) / sum;
        p.stemC += (build * aS) / sum;
        p.rootC += (build * aR) / sum;
        state.air.co2 += respC / C_MOLAR;
        state.air.o2 -= respC / C_MOLAR;
        // Root exudates and mycorrhizal carbon feed rhizosphere microbes.
        top.metC += exud;
      }
    }

    // --- turnover
    const kLeaf = (1 / pp.leafLife) * (1 + 4 * stress + (p.health < 0.5 ? 2 : 0));
    const lostLeaf = p.leafC * Math.min(0.5, kLeaf * dtd);
    if (lostLeaf > 0) {
      const leafN = (lostLeaf / pp.cn[0]) * Math.min(1, nRatio) * 0.5; // half resorbed
      p.leafC -= lostLeaf;
      p.N -= leafN;
      addToSurfaceLitter(state, lostLeaf, leafN, 0.6, p.x, p.z);
    }
    const lostRoot = p.rootC * Math.min(0.5, (1 / 365 + p.rootDamage * 0.05) * dtd);
    if (lostRoot > 0) {
      const rootN = Math.min(p.N * 0.5, (lostRoot / pp.cn[2]) * Math.min(1, nRatio));
      p.rootC -= lostRoot;
      p.N -= rootN;
      addToSoilLitter(top, lostRoot, rootN, 0.5);
    }
    updateShape(p, pp);

    // --- vegetative spread (runners rooting at nodes, spores for ferns)
    if (
      state.plants.length + newborn.length < MAX_PLANTS &&
      pp.form !== 'succulent' &&
      la > pp.maxLeafArea * 0.85 &&
      p.nsc > 0.15 * S &&
      p.health > 0.7 &&
      nextRandom(state.rng) < dtd / 12
    ) {
      const baby = offset(state, p, pp);
      if (baby) newborn.push(baby);
    }

    // --- death
    if (p.health <= 0 || p.leafC < pp.init.leafC * 0.05) killPlant(state, p);
  }
  state.plants.push(...newborn);
  state.plants = state.plants.filter((p) => p.alive);
}

function offset(state: SimState, parent: Plant, pp: PlantParams): Plant | null {
  const r = state.config.radius;
  const s = state.surface;
  const free = usableCells(s);
  const dist = crownRadius(parent, pp.lma) * 1.3 + 0.01;
  for (let tries = 0; tries < 6; tries++) {
    const a = nextRandom(state.rng) * Math.PI * 2;
    const x = parent.x + Math.cos(a) * dist;
    const z = parent.z + Math.sin(a) * dist;
    const c = cellAt(s, r, x, z);
    if (!free.includes(c) || Math.hypot(x, z) > r * 0.88) continue;
    const scale = 0.5;
    const need = (pp.init.leafC + pp.init.stemC + pp.init.rootC) * scale * 1.1;
    if (parent.nsc < need) return null;
    const baby = createPlant(state, parent.species, x, z, scale);
    const babyC = plantCarbon(baby);
    const nShare = Math.min(parent.N * 0.3, baby.N);
    parent.nsc -= babyC;
    parent.N -= nShare;
    baby.N = nShare;
    // Tissue water comes from the parent's store.
    const w = Math.min(parent.tissueWater, baby.tissueWater);
    parent.tissueWater -= w;
    baby.tissueWater = w;
    baby.water = clamp01(w / tissueCapacity(baby));
    return baby;
  }
  return null;
}

export function killPlant(state: SimState, p: Plant): void {
  if (!p.alive) return;
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  const above = p.leafC + p.stemC + p.nsc + p.acid;
  const total = above + p.rootC;
  const nAbove = total > 0 ? (p.N * above) / total : 0;
  addToSurfaceLitter(state, above, nAbove, 0.45, p.x, p.z);
  addToSoilLitter(top, p.rootC, p.N - nAbove, 0.4);
  top.theta += p.tissueWater / 1000 / (top.thickness * area);
  p.leafC = p.stemC = p.rootC = p.nsc = p.acid = p.N = p.tissueWater = 0;
  p.alive = false;
  state.stats.plantDeaths++;
  state.events.push({ day: Math.floor(state.time / 86400), kind: 'death', text: `${speciesName(p.species)}가(이) 죽었습니다` });
}

function speciesName(id: string): string {
  return SPECIES[id]?.name ?? id;
}

function updateShape(p: Plant, pp: PlantParams): void {
  const stretch = 1 + 0.6 * p.etiolation;
  const grown = 1 - Math.exp(-p.stemC / (pp.init.stemC * 6));
  const trailing = pp.form === 'trailing' || pp.form === 'spikemoss';
  p.height = Math.min(pp.maxHeight * 1.4, pp.maxHeight * (0.25 + 0.75 * grown) * stretch * (trailing ? 0.5 : 1));
  p.stemLength = p.height * (trailing ? 2.5 : 1) * stretch;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
