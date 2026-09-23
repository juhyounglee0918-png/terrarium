/** Dead organic matter bookkeeping shared by all organisms. */
import type { SimState, SoilLayerState } from '../types';
import { cellAt } from './surface';

/**
 * Split a litter input between metabolic and structural pools. N goes preferentially to the
 * metabolic pool (proteins), as in CENTURY-style models.
 */
function split(c: number, n: number, metFrac: number): [number, number, number, number] {
  const mc = c * metFrac;
  const nFrac = Math.min(1, metFrac * 1.5);
  const mn = n * nFrac;
  return [mc, mn, c - mc, n - mn];
}

export function addToSurfaceLitter(state: SimState, c: number, n: number, metFrac: number, x?: number, z?: number): void {
  if (c <= 0 && n <= 0) return;
  const [mc, mn, sc, sn] = split(c, n, metFrac);
  const L = state.litter;
  L.metC += mc;
  L.metN += mn;
  L.strC += sc;
  L.strN += sn;
  if (x !== undefined && z !== undefined) {
    const s = state.surface;
    const i = cellAt(s, state.config.radius, x, z);
    s.litterWeight[i] += c * 1e5;
  }
}

export function addToSoilLitter(layer: SoilLayerState, c: number, n: number, metFrac: number): void {
  if (c <= 0 && n <= 0) return;
  const [mc, mn, sc, sn] = split(c, n, metFrac);
  layer.metC += mc;
  layer.metN += mn;
  layer.strC += sc;
  layer.strN += sn;
}

export function surfaceLitterC(state: SimState): number {
  return state.litter.metC + state.litter.strC;
}
