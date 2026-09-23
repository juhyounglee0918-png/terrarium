/**
 * Player actions. Anything that brings matter in or takes it out goes through the ledger.
 */
import { RHO_WATER } from './constants';
import { type LidType } from './config';
import type { Placement } from './physics/light';
import { geometry } from './physics/environment';
import { seedFauna } from './bio/fauna';
import { addToSurfaceLitter } from './bio/litter';
import { createPlant, MAX_PLANTS, plantCarbon } from './bio/plants';
import { cellAt, seedMoss } from './bio/surface';
import { CN } from './bio/soilbio';
import { MATERIALS } from './config';
import type { SimState } from './types';

/** Spray water: part lands on the glass, part is caught by moss, the rest wets the substrate. */
export function mist(state: SimState, kg: number): void {
  const nG = state.glassFilm.length;
  const onGlass = kg * 0.4;
  for (let i = 0; i < nG; i++) state.glassFilm[i] += onGlass / nG;
  let rest = kg - onGlass;
  const m = state.surface.moss;
  const cells = m.cover.map((c, i) => (m.species[i] ? c : 0));
  const coverSum = cells.reduce((a, b) => a + b, 0);
  const inside = state.surface.inside.filter(Boolean).length;
  if (coverSum > 0) {
    const toMoss = rest * Math.min(1, coverSum / inside);
    cells.forEach((c, i) => {
      if (c > 0) m.water[i] += (toMoss * c) / coverSum;
    });
    rest -= toMoss;
  }
  addSoilWater(state, rest);
  state.ledger.waterAdded += kg;
}

export function pourWater(state: SimState, kg: number): void {
  addSoilWater(state, kg);
  state.ledger.waterAdded += kg;
}

/** Adds water to the top layer; anything beyond saturation cascades downward. */
export function addSoilWater(state: SimState, kg: number): void {
  const a = geometry(state.config).areaTop;
  let vol = kg / RHO_WATER;
  for (let j = state.soil.length - 1; j >= 0 && vol > 0; j--) {
    const l = state.soil[j];
    const mat = MATERIALS[l.material];
    const room = (mat.thetaS - l.theta) * l.thickness * a;
    const take = Math.min(Math.max(room, 0), vol);
    l.theta += take / (l.thickness * a);
    vol -= take;
  }
  if (vol > 0) {
    const top = state.soil[state.soil.length - 1];
    top.theta += vol / (top.thickness * a);
  }
}

export function setLid(state: SimState, lid: LidType): void {
  state.config.lid = lid;
}

export function setPlacement(state: SimState, placement: Placement): void {
  state.config.lighting.placement = placement;
}

export function addPlant(state: SimState, species: string, x: number, z: number): boolean {
  if (state.plants.length >= MAX_PLANTS) return false;
  const s = state.surface;
  const c = cellAt(s, state.config.radius, x, z);
  if (!s.inside[c] || s.rock[c]) return false;
  const p = createPlant(state, species, x, z);
  state.plants.push(p);
  state.ledger.carbonImported += plantCarbon(p);
  state.ledger.nitrogenImported += p.N;
  state.ledger.waterAdded += p.tissueWater;
  return true;
}

/** Cut back a plant; clippings are taken out of the jar. */
export function prunePlant(state: SimState, id: number, fraction = 0.4): void {
  const p = state.plants.find((q) => q.id === id && q.alive);
  if (!p) return;
  const f = Math.min(0.9, Math.max(0, fraction));
  const c = (p.leafC + p.stemC) * f;
  const n = p.N * (c / Math.max(plantCarbon(p), 1e-15));
  p.leafC *= 1 - f;
  p.stemC *= 1 - f;
  p.N -= n;
  const w = p.tissueWater * f * 0.8;
  p.tissueWater -= w;
  state.ledger.carbonExported += c;
  state.ledger.nitrogenExported += n;
  state.ledger.waterAdded -= w;
}

export function removePlant(state: SimState, id: number): void {
  const p = state.plants.find((q) => q.id === id && q.alive);
  if (!p) return;
  state.ledger.carbonExported += plantCarbon(p);
  state.ledger.nitrogenExported += p.N;
  state.ledger.waterAdded -= p.tissueWater;
  p.leafC = p.stemC = p.rootC = p.nsc = p.acid = p.N = p.tissueWater = 0;
  p.alive = false;
  state.plants = state.plants.filter((q) => q.alive);
}

export function addMoss(state: SimState, species: string, fraction: number): void {
  const w0 = state.surface.moss.water.reduce((a, b) => a + b, 0);
  const { c, n } = seedMoss(state, species, fraction);
  state.ledger.carbonImported += c;
  state.ledger.nitrogenImported += n;
  // New moss arrives damp: its water is added too.
  state.ledger.waterAdded += state.surface.moss.water.reduce((a, b) => a + b, 0) - w0;
}

export function addFauna(state: SimState, species: string, count: number): void {
  seedFauna(state, [{ species, count }], true);
}

/** Drop a handful of dry leaf litter (oak/magnolia leaves, C:N ≈ 50). */
export function addLeafLitter(state: SimState, kgC: number): void {
  const r = state.config.radius;
  const n = kgC / 50;
  addToSurfaceLitter(state, kgC, n, 0.25, r * 0.2, -r * 0.3);
  addToSurfaceLitter(state, 0, 0, 0.25, -r * 0.3, r * 0.1);
  state.ledger.carbonImported += kgC;
  state.ledger.nitrogenImported += n;
}

/** Wipe visible mould off the surface with a cotton bud (removes surface fungi). */
export function removeMould(state: SimState): void {
  const c = state.surfaceFungi * 0.8;
  state.surfaceFungi -= c;
  state.ledger.carbonExported += c;
  state.ledger.nitrogenExported += c / CN.fung;
  let mc = 0;
  let mn = 0;
  for (const m of state.mushrooms) {
    mc += m.c;
    mn += m.N;
  }
  state.mushrooms = [];
  state.ledger.carbonExported += mc;
  state.ledger.nitrogenExported += mn;
  for (let i = 0; i < state.surface.mould.length; i++) state.surface.mould[i] *= 0.4;
}

/** Diluted liquid fertiliser (NH₄NO₃), grams of N. */
export function fertilize(state: SimState, gN: number): void {
  const top = state.soil[state.soil.length - 1];
  const kg = gN / 1000;
  top.nh4 += kg / 2;
  top.no3 += kg / 2;
  state.ledger.nitrogenImported += kg;
}

/** A piece of cuttlebone: calcium for snails, millipedes and isopods (~4 months). */
export function addCalcium(state: SimState): void {
  state.calcium = Math.max(state.calcium, 0) + 120;
}

/** Room temperature set point. */
export function setRoomTemp(state: SimState, celsius: number): void {
  state.config.room.meanTemp = celsius;
}

export function wipeGlass(state: SimState): void {
  // Wiping moves condensate and algae film down into the substrate.
  const top = state.soil[state.soil.length - 1];
  const a = geometry(state.config).areaTop;
  let w = 0;
  let ac = 0;
  let an = 0;
  for (let i = 0; i < state.glassFilm.length; i++) {
    w += state.glassFilm[i];
    ac += state.glassAlgae[i] * 0.9;
    an += state.glassAlgaeN[i] * 0.9;
    state.glassFilm[i] = 0;
    state.glassAlgae[i] *= 0.1;
    state.glassAlgaeN[i] *= 0.1;
  }
  top.theta += w / RHO_WATER / (top.thickness * a);
  top.metC += ac;
  top.metN += an;
}
