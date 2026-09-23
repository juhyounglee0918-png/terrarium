/** Surface grid over the jar floor: where moss grows, litter lies, rocks sit, and light falls. */
import type { Hardscape } from '../config';
import { mossParams } from './params';
import type { Plant, SimState, SurfaceGrid } from '../types';

export const GRID_N = 16;

export function createSurface(radius: number, hardscape: Hardscape[]): SurfaceGrid {
  const n = GRID_N;
  const cellSize = (2 * radius) / n;
  const inside: boolean[] = [];
  const rock: boolean[] = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -radius + (ix + 0.5) * cellSize;
      const z = -radius + (iz + 0.5) * cellSize;
      inside.push(Math.hypot(x, z) < radius - cellSize * 0.35);
      rock.push(hardscape.some((h) => Math.hypot(x - h.x, z - h.z) < h.size * 0.85));
    }
  }
  const zeros = () => new Array(n * n).fill(0);
  return {
    n,
    cellSize,
    inside,
    rock,
    moss: { species: new Array(n * n).fill(''), cover: zeros(), biomass: zeros(), water: zeros(), N: zeros(), health: zeros(), dryDays: zeros(), wetDays: zeros() },
    litterWeight: zeros(),
    shade: new Array(n * n).fill(1),
    mould: zeros(),
    slime: zeros(),
  };
}

export function cellCenter(s: SurfaceGrid, radius: number, i: number): [number, number] {
  const ix = i % s.n;
  const iz = Math.floor(i / s.n);
  return [-radius + (ix + 0.5) * s.cellSize, -radius + (iz + 0.5) * s.cellSize];
}

export function cellAt(s: SurfaceGrid, radius: number, x: number, z: number): number {
  const ix = Math.min(s.n - 1, Math.max(0, Math.floor((x + radius) / s.cellSize)));
  const iz = Math.min(s.n - 1, Math.max(0, Math.floor((z + radius) / s.cellSize)));
  return iz * s.n + ix;
}

export function usableCells(s: SurfaceGrid): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.inside.length; i++) if (s.inside[i] && !s.rock[i]) out.push(i);
  return out;
}

/** Seed a moss carpet over a fraction of free cells. Returns kg C and kg N added. */
export function seedMoss(state: SimState, species: string, fraction: number, cover = 0.8): { c: number; n: number } {
  const p = mossParams(species);
  const s = state.surface;
  const area = s.cellSize * s.cellSize;
  let c = 0;
  let n = 0;
  const cells = usableCells(s);
  // Deterministic, spatially coherent patch: cells sorted by distance from a corner of the jar.
  const r = state.config.radius;
  const origin = [r * 0.3, r * 0.35];
  cells.sort((a, b) => {
    const [ax, az] = cellCenter(s, r, a);
    const [bx, bz] = cellCenter(s, r, b);
    return Math.hypot(ax - origin[0], az - origin[1]) - Math.hypot(bx - origin[0], bz - origin[1]);
  });
  const take = Math.round(cells.length * fraction);
  for (let k = 0; k < take; k++) {
    const i = cells[k];
    if (s.moss.species[i] && s.moss.species[i] !== species) continue;
    s.moss.species[i] = species;
    const add = p.biomassMax * 0.6 * area * cover;
    s.moss.cover[i] = Math.min(1, s.moss.cover[i] + cover);
    s.moss.biomass[i] += add;
    s.moss.N[i] += add / p.cn;
    s.moss.water[i] += (add / 0.45) * p.wOpt[0]; // arrives moist
    s.moss.health[i] = 1;
    c += add;
    n += add / p.cn;
  }
  return { c, n };
}

/** Crown radius of a plant from its leaf area (crown LAI ≈ 1.5). */
export function crownRadius(p: Plant, lma: number): number {
  const la = p.leafC / lma;
  return Math.sqrt(la / 1.5 / Math.PI) + 0.005;
}

/** Leaf-area index above a point, from all plant crowns that cover it and stand taller than `height`. */
export function laiAbove(plants: Plant[], lmaOf: (sp: string) => number, x: number, z: number, height: number, skip?: Plant): number {
  let lai = 0;
  for (const p of plants) {
    if (!p.alive || p === skip || p.height <= height) continue;
    const lma = lmaOf(p.species);
    const rc = crownRadius(p, lma);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < rc) lai += 1.5 * (1 - (d / rc) * (d / rc)) * 1.3;
  }
  return lai;
}
