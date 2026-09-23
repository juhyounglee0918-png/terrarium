/**
 * Physical environment of the jar: geometry, weather, radiation, heat network, condensation
 * run-off and soil-water redistribution. Heat is solved with backward Euler (Gauss–Seidel), soil
 * water with adaptive explicit substeps.
 */
import { CP_WATER, GLASS, KELVIN, PAR_FRACTION_OF_SHORTWAVE, PAR_UMOL_PER_J_LED, PAR_UMOL_PER_J_SUN, RHO_WATER, SECONDS_PER_DAY, STEFAN_BOLTZMANN } from '../constants';
import { MATERIALS, type TerrariumConfig } from '../config';
import type { IndoorLight } from './light';
import { airDensity } from './psychro';
import { conductivityAtHead, headFromTheta, thermalConductivity, type SoilMaterial } from './soil';
import { nextGaussian } from '../rng';
import type { SimState } from '../types';

export const H_IN = 3.0; // W/m²K, natural convection inside the jar
const H_OUT = 8.5; // W/m²K, outer surface convection + long-wave
const U_TABLE = 3.0; // W/m²K, jar base to table
const EMISSIVITY = 0.93;
/**
 * Water a surface holds as droplets before they coalesce and run off (kg/m²). Sliding starts at
 * droplet radii of ~2–3 mm; at ~55 % coverage and cap-shaped drops that is a few hundred g/m².
 */
export const FILM_HOLD_WALL = 0.3;
export const FILM_HOLD_LID = 0.15;

// ---------------------------------------------------------------- geometry

export interface Geometry {
  soilDepth: number;
  airHeight: number;
  airVolume: number;
  areaTop: number;
  nodeArea: number; // per glass wall node
  bandHeight: number;
  sectorWidth: number;
  sectorAzimuth: number[];
}

export function geometry(cfg: TerrariumConfig): Geometry {
  const soilDepth = cfg.layers.reduce((s, l) => s + l.thickness, 0);
  const airHeight = cfg.height - soilDepth;
  const areaTop = Math.PI * cfg.radius * cfg.radius;
  const circumference = 2 * Math.PI * cfg.radius;
  const bandHeight = airHeight / cfg.glassBands;
  const sectorWidth = circumference / cfg.glassSectors;
  return {
    soilDepth,
    airHeight,
    airVolume: areaTop * airHeight,
    areaTop,
    nodeArea: bandHeight * sectorWidth,
    bandHeight,
    sectorWidth,
    sectorAzimuth: Array.from({ length: cfg.glassSectors }, (_, s) => ((s + 0.5) * 2 * Math.PI) / cfg.glassSectors),
  };
}


export function updateWeather(state: SimState, dt: number): void {
  // Ornstein–Uhlenbeck process on cloudiness, correlation time ≈ 1 day.
  const tau = SECONDS_PER_DAY;
  const mean = 0.45;
  const sigma = 0.35;
  const a = Math.exp(-dt / tau);
  state.cloud = mean + (state.cloud - mean) * a + sigma * Math.sqrt(1 - a * a) * nextGaussian(state.rng);
  state.cloud = Math.min(1, Math.max(0, state.cloud));
}

// ---------------------------------------------------------------- radiation

export interface RadiationSources {
  glass: Float64Array; // W per glass node
  lid: number;
  soil: Float64Array; // W per soil layer (top gets transmitted light)
}

export function radiationSources(state: SimState, g: Geometry, light: IndoorLight): RadiationSources {
  const cfg = state.config;
  const nG = cfg.glassBands * cfg.glassSectors;
  const glass = new Float64Array(nG);
  const soil = new Float64Array(state.soil.length);
  let lid = 0;
  const tau = GLASS.transmittance;
  const lidTrans = cfg.lid === 'cork' ? 0 : cfg.lid === 'open' ? 1 : tau;
  const sideAir = 2 * Math.PI * cfg.radius * g.airHeight;
  const top = state.soil.length - 1;
  const albedoTop = MATERIALS[state.soil[top].material].albedo;

  // Diffuse (sky through the window): top + ~¼ of the side area effective.
  const D = light.diffuseSW;
  let swIntoSoil = D * (g.areaTop * lidTrans + 0.25 * sideAir * tau);
  for (let i = 0; i < nG; i++) glass[i] += D * 0.5 * GLASS.absorptance * g.nodeArea;
  if (cfg.lid !== 'open') lid += D * g.areaTop * (cfg.lid === 'cork' ? 0.6 : GLASS.absorptance);

  // Direct beam from the window.
  const B = light.directSW;
  if (B > 0) {
    const cosEl = Math.cos(light.beamElevation);
    const sinEl = Math.max(0, Math.sin(light.beamElevation));
    for (let b = 0; b < cfg.glassBands; b++) {
      for (let s = 0; s < cfg.glassSectors; s++) {
        const c = Math.cos(g.sectorAzimuth[s] - light.beamAzimuth) * cosEl;
        const i = b * cfg.glassSectors + s;
        if (c > 0) glass[i] += B * c * g.nodeArea * GLASS.absorptance;
        // far wall absorbs a little of what passes through
        else glass[i] += B * -c * g.nodeArea * GLASS.absorptance * tau * 0.5;
      }
    }
    const projSide = 2 * cfg.radius * g.airHeight * cosEl;
    swIntoSoil += B * (projSide * tau * 0.85 + g.areaTop * sinEl * lidTrans);
    // Sun on the outside of the substrate section of the jar.
    const projSoilSide = 2 * cfg.radius * cosEl;
    state.soil.forEach((l, j) => {
      const alb = MATERIALS[l.material].albedo;
      soil[j] += B * projSoilSide * l.thickness * tau * (1 - alb);
    });
    if (cfg.lid !== 'open') lid += B * g.areaTop * sinEl * (cfg.lid === 'cork' ? 0.6 : GLASS.absorptance);
  }

  // Grow light from above; the fixture also warms the lid.
  const ledIn = light.ledSW * g.areaTop * (cfg.lid === 'cork' ? 0.1 : lidTrans);
  if (light.ledSW > 0 && cfg.lid !== 'open') lid += light.ledSW * g.areaTop * 0.5;

  soil[top] += (swIntoSoil + ledIn) * (1 - albedoTop);
  state.env.swSoil = (swIntoSoil + ledIn) / g.areaTop;
  const sunPar = (swIntoSoil / g.areaTop) * PAR_FRACTION_OF_SHORTWAVE * PAR_UMOL_PER_J_SUN;
  state.env.parSoil = sunPar + (ledIn / g.areaTop) * PAR_UMOL_PER_J_LED;
  return { glass, lid, soil };
}

// ---------------------------------------------------------------- heat

export function solveHeat(state: SimState, g: Geometry, src: RadiationSources, dt: number): void {
  const cfg = state.config;
  const B = cfg.glassBands;
  const S = cfg.glassSectors;
  const nG = B * S;
  const nL = state.soil.length;
  const AIR = 0;
  const G0 = 1;
  const LID = nG + 1;
  const SOIL0 = nG + 2;
  const N = SOIL0 + nL;
  const roomT = state.env.roomT;

  const T = new Float64Array(N);
  const C = new Float64Array(N);
  const Sx = new Float64Array(N);
  const gRoom = new Float64Array(N);
  const ei: number[] = [];
  const ej: number[] = [];
  const eg: number[] = [];
  const edge = (i: number, j: number, c: number) => {
    ei.push(i);
    ej.push(j);
    eg.push(c);
  };

  // air
  T[AIR] = state.air.T;
  C[AIR] = airDensity(state.air.T) * g.airVolume * 1005 + state.air.vapor * 1860;

  // glass wall
  const glassNodeC = GLASS.density * GLASS.cp * cfg.glassThickness * g.nodeArea;
  const gVert = (GLASS.k * cfg.glassThickness * g.sectorWidth) / g.bandHeight;
  const gHorz = (GLASS.k * cfg.glassThickness * g.bandHeight) / g.sectorWidth;
  const wallOut = 1 / (1 / (H_OUT * g.nodeArea) + cfg.glassThickness / (GLASS.k * g.nodeArea));
  for (let b = 0; b < B; b++) {
    for (let s = 0; s < S; s++) {
      const k = b * S + s;
      const n = G0 + k;
      T[n] = state.glassT[k];
      C[n] = glassNodeC + state.glassFilm[k] * CP_WATER;
      Sx[n] = src.glass[k] + state.latent.glass[k];
      gRoom[n] = wallOut;
      edge(n, AIR, H_IN * g.nodeArea);
      if (b + 1 < B) edge(n, G0 + (b + 1) * S + s, gVert);
      edge(n, G0 + b * S + ((s + 1) % S), gHorz);
    }
  }

  // lid
  T[LID] = state.lid.T;
  if (cfg.lid === 'open') {
    C[LID] = 1;
    gRoom[LID] = 1;
  } else {
    const cork = cfg.lid === 'cork';
    C[LID] = cork ? 200 * 1800 * 0.02 * g.areaTop : GLASS.density * GLASS.cp * cfg.glassThickness * g.areaTop;
    C[LID] += state.lid.film * CP_WATER;
    gRoom[LID] = cork ? 1 / (1 / (H_OUT * g.areaTop) + 0.02 / (0.04 * g.areaTop)) : H_OUT * g.areaTop;
    edge(LID, AIR, H_IN * g.areaTop);
    Sx[LID] = src.lid + state.latent.lid;
  }

  // soil
  const hRad = 4 * EMISSIVITY * STEFAN_BOLTZMANN * Math.pow(state.air.T + KELVIN, 3);
  const glassTotalArea = nG * g.nodeArea + (cfg.lid === 'open' ? 0 : g.areaTop);
  const kS: number[] = [];
  for (let j = 0; j < nL; j++) {
    const l = state.soil[j];
    const m = MATERIALS[l.material];
    const vol = l.thickness * g.areaTop;
    const n = SOIL0 + j;
    T[n] = l.T;
    C[n] = vol * (m.bulkDensity * m.cpSolid + Math.min(l.theta, 1) * RHO_WATER * CP_WATER);
    Sx[n] = src.soil[j];
    const k = thermalConductivity(m, l.theta);
    kS.push(k);
    const aWall = 2 * Math.PI * cfg.radius * l.thickness;
    gRoom[n] = 1 / (1 / (H_OUT * aWall) + cfg.radius / 2 / (k * aWall) + cfg.glassThickness / (GLASS.k * aWall));
    if (j === 0) gRoom[n] += 1 / (1 / (U_TABLE * g.areaTop) + l.thickness / 2 / (k * g.areaTop));
    if (j > 0) {
      const lower = state.soil[j - 1];
      edge(n, n - 1, g.areaTop / (l.thickness / (2 * k) + lower.thickness / (2 * kS[j - 1])));
    }
  }
  const topN = SOIL0 + nL - 1;
  edge(topN, AIR, H_IN * g.areaTop);
  Sx[topN] += state.latent.soil;
  // Long-wave exchange between substrate surface and the (opaque to IR) glass.
  for (let k = 0; k < nG; k++) edge(topN, G0 + k, (hRad * g.areaTop * g.nodeArea) / glassTotalArea);
  if (cfg.lid !== 'open') edge(topN, LID, (hRad * g.areaTop * g.areaTop) / glassTotalArea);

  // adjacency
  const adjStart = new Int32Array(N + 1);
  for (let e = 0; e < ei.length; e++) {
    adjStart[ei[e] + 1]++;
    adjStart[ej[e] + 1]++;
  }
  for (let i = 0; i < N; i++) adjStart[i + 1] += adjStart[i];
  const fill = adjStart.slice(0, N);
  const adjN = new Int32Array(adjStart[N]);
  const adjG = new Float64Array(adjStart[N]);
  const diag = new Float64Array(N);
  for (let e = 0; e < ei.length; e++) {
    const a = ei[e];
    const b = ej[e];
    adjN[fill[a]] = b;
    adjG[fill[a]++] = eg[e];
    adjN[fill[b]] = a;
    adjG[fill[b]++] = eg[e];
    diag[a] += eg[e];
    diag[b] += eg[e];
  }
  const rhs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    diag[i] += C[i] / dt + gRoom[i];
    rhs[i] = (C[i] / dt) * T[i] + Sx[i] + gRoom[i] * roomT;
  }
  const X = Float64Array.from(T);
  for (let it = 0; it < 200; it++) {
    let maxD = 0;
    for (let i = 0; i < N; i++) {
      let s = rhs[i];
      for (let p = adjStart[i]; p < adjStart[i + 1]; p++) s += adjG[p] * X[adjN[p]];
      const v = s / diag[i];
      const d = Math.abs(v - X[i]);
      if (d > maxD) maxD = d;
      X[i] = v;
    }
    if (maxD < 1e-7) break;
  }

  state.air.T = X[AIR];
  for (let k = 0; k < nG; k++) state.glassT[k] = X[G0 + k];
  state.lid.T = cfg.lid === 'open' ? roomT : X[LID];
  for (let j = 0; j < nL; j++) state.soil[j].T = X[SOIL0 + j];
}

// ---------------------------------------------------------------- water on glass

export function runoff(state: SimState, g: Geometry, dt: number): number {
  const cfg = state.config;
  const S = cfg.glassSectors;
  const hold = FILM_HOLD_WALL * g.nodeArea;
  let toSoil = 0;
  // Lid drips onto the substrate.
  const lidHold = FILM_HOLD_LID * g.areaTop;
  if (state.lid.film > lidHold) {
    toSoil += state.lid.film - lidHold;
    state.lid.film = lidHold;
  }
  // Excess slides down each sector column, top band first.
  for (let s = 0; s < S; s++) {
    let carry = 0;
    for (let b = cfg.glassBands - 1; b >= 0; b--) {
      const k = b * S + s;
      state.glassFilm[k] += carry;
      carry = 0;
      if (state.glassFilm[k] > hold) {
        carry = state.glassFilm[k] - hold;
        state.glassFilm[k] = hold;
      }
    }
    toSoil += carry;
  }
  if (toSoil > 0) {
    const top = state.soil[state.soil.length - 1];
    top.theta += toSoil / RHO_WATER / (top.thickness * g.areaTop);
  }
  return toSoil / dt;
}

// ---------------------------------------------------------------- soil water

export function redistributeSoilWater(state: SimState, dt: number): void {
  const layers = state.soil;
  const nL = layers.length;
  if (nL < 2) return;
  const mats: SoilMaterial[] = layers.map((l) => MATERIALS[l.material]);
  const q = new Float64Array(nL - 1); // m/s, positive = upward from j to j+1
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 400) {
    const h = layers.map((l, j) => headFromTheta(mats[j], l.theta));
    // Ponded water above saturation behaves as positive pressure head.
    layers.forEach((l, j) => {
      if (l.theta > mats[j].thetaS) h[j] = ((l.theta - mats[j].thetaS) * l.thickness) / mats[j].thetaS;
    });
    let dtSub = remaining;
    for (let j = 0; j < nL - 1; j++) {
      const lo = layers[j];
      const up = layers[j + 1];
      const Hlo = h[j] + lo.zCenter;
      const Hup = h[j + 1] + up.zCenter;
      const dz = up.zCenter - lo.zCenter;
      // Evaluate conductivity of both materials at the upstream head (capillary-barrier aware).
      const hUp = Hlo > Hup ? h[j] : h[j + 1];
      const k = Math.sqrt(conductivityAtHead(mats[j], hUp) * conductivityAtHead(mats[j + 1], hUp));
      q[j] = (-k * (Hup - Hlo)) / dz;
    }
    for (let j = 0; j < nL; j++) {
      const inflow = (j > 0 ? q[j - 1] : 0) - (j < nL - 1 ? q[j] : 0);
      const rate = Math.abs(inflow) / layers[j].thickness;
      if (rate > 0) dtSub = Math.min(dtSub, 0.01 / rate);
    }
    dtSub = Math.max(dtSub, Math.min(remaining, dt / 400));
    for (let j = 0; j < nL - 1; j++) {
      let move = q[j] * dtSub; // m of water column moving upward from j to j+1
      const lo = layers[j];
      const up = layers[j + 1];
      if (move > 0) move = Math.min(move, Math.max(0, (lo.theta - mats[j].thetaR) * lo.thickness) * 0.5);
      else move = -Math.min(-move, Math.max(0, (up.theta - mats[j + 1].thetaR) * up.thickness) * 0.5);
      lo.theta -= move / lo.thickness;
      up.theta += move / up.thickness;
    }
    remaining -= dtSub;
  }
}

