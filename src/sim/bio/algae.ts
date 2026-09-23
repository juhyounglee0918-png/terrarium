/**
 * Phototrophic biofilm (green algae + cyanobacteria) on the inside of the glass. It needs a wet
 * surface and light, so it shows up first on the bright, permanently fogged side. Nitrogen comes
 * from splash and run-off contact with the substrate's mineral pool.
 */
import { C_MOLAR, GLASS, PAR_FRACTION_OF_SHORTWAVE, PAR_UMOL_PER_J_LED, PAR_UMOL_PER_J_SUN } from '../constants';
import { FILM_HOLD_WALL, type Geometry } from '../physics/environment';
import type { SimState } from '../types';
import { addToSoilLitter } from './litter';
import { co2Response } from './plants';

export const ALGAE_CN = 8;
const AMAX = 3; // µmol m⁻² s⁻¹ for a dense biofilm
const K_B = 0.002; // kg C m⁻² half-saturation of film density
const DEATH = 0.02; // 1/day

/** PAR hitting each glass node from the room side (µmol/m²/s). */
export function glassPar(state: SimState, g: Geometry): number[] {
  const cfg = state.config;
  const light = state.env.light;
  const out: number[] = [];
  const conv = PAR_FRACTION_OF_SHORTWAVE * PAR_UMOL_PER_J_SUN;
  const cosEl = Math.cos(light.beamElevation);
  for (let b = 0; b < cfg.glassBands; b++) {
    for (let s = 0; s < cfg.glassSectors; s++) {
      let par = light.diffuseSW * 0.5 * conv * GLASS.transmittance;
      const c = Math.cos(g.sectorAzimuth[s] - light.beamAzimuth) * cosEl;
      if (light.directSW > 0 && c > 0) par += light.directSW * c * conv * GLASS.transmittance;
      // Grow lights reach the upper wall.
      par += light.ledSW * PAR_UMOL_PER_J_LED * 0.3 * (b / cfg.glassBands);
      out.push(par);
    }
  }
  return out;
}

export function algaeGasExchange(state: SimState, dt: number, g: Geometry, env: { co2ppm: number; T: number }): { uptake: number; respired: number } {
  const par = glassPar(state, g);
  const fCO2 = co2Response(env.co2ppm);
  const fT = Math.exp(-Math.pow((env.T - 25) / 12, 2));
  let uptake = 0;
  let respired = 0;
  for (let i = 0; i < state.glassAlgae.length; i++) {
    const B = state.glassAlgae[i];
    if (B <= 0) continue;
    const dens = B / g.nodeArea;
    const wet = Math.min(1, state.glassFilm[i] / (FILM_HOLD_WALL * g.nodeArea * 0.05));
    const cn = B / Math.max(state.glassAlgaeN[i], 1e-18);
    const fN = Math.min(1, Math.max(0, (20 - cn) / 10));
    const light = 1 - Math.exp(-par[i] / 80);
    const gross = AMAX * (dens / (dens + K_B)) * g.nodeArea * light * wet * fT * fCO2 * fN; // µmol/s
    const gain = gross * dt * 1e-6 * C_MOLAR;
    const resp = Math.min(B + gain, B * 0.05 * Math.pow(2, (env.T - 20) / 10) * (dt / 86400));
    state.glassAlgae[i] += gain - resp;
    uptake += gross * dt * 1e-6;
    respired += resp / C_MOLAR;
  }
  return { uptake, respired };
}

export function algaeBiology(state: SimState, dtd: number): void {
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  for (let i = 0; i < state.glassAlgae.length; i++) {
    const B = state.glassAlgae[i];
    // N uptake from splash contact with the substrate solution.
    const want = Math.max(0, B / ALGAE_CN - state.glassAlgaeN[i]) * Math.min(1, dtd);
    const tot = top.nh4 + top.no3;
    const take = Math.min(want, tot * 0.002 * (1 / state.glassAlgae.length) * (area / 0.045));
    if (take > 0 && tot > 0) {
      const f = top.nh4 / tot;
      top.nh4 -= take * f;
      top.no3 -= take * (1 - f);
      state.glassAlgaeN[i] += take;
    }
    // Sloughing: dead film washes down into the substrate.
    const d = B * Math.min(0.5, DEATH * dtd);
    if (d > 0) {
      const dn = state.glassAlgaeN[i] * (d / B);
      state.glassAlgae[i] -= d;
      state.glassAlgaeN[i] -= dn;
      addToSoilLitter(top, d, dn, 0.9);
    }
  }
}

/** Remove algae (grazing): returns [C, N] taken from nodes in the given bands. */
export function grazeAlgae(state: SimState, kgC: number, maxBand: number): [number, number] {
  const S = state.config.glassSectors;
  let avail = 0;
  for (let i = 0; i < Math.min(state.glassAlgae.length, maxBand * S); i++) avail += state.glassAlgae[i];
  if (avail <= 0 || kgC <= 0) return [0, 0];
  const f = Math.min(0.5, kgC / avail);
  let c = 0;
  let n = 0;
  for (let i = 0; i < Math.min(state.glassAlgae.length, maxBand * S); i++) {
    const dc = state.glassAlgae[i] * f;
    const dn = state.glassAlgaeN[i] * f;
    state.glassAlgae[i] -= dc;
    state.glassAlgaeN[i] -= dn;
    c += dc;
    n += dn;
  }
  return [c, n];
}

export function algaeCarbon(state: SimState): number {
  return state.glassAlgae.reduce((a, b) => a + b, 0);
}
export function algaeNitrogen(state: SimState): number {
  return state.glassAlgaeN.reduce((a, b) => a + b, 0);
}
