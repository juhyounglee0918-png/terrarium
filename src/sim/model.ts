/**
 * Terrarium environment model (milestone M1: physics + basal soil respiration).
 *
 * Layout
 *   - Air: one well-mixed zone above the substrate.
 *   - Glass wall above the substrate: glassBands × glassSectors nodes, each with a
 *     temperature and a condensed-water film. Sector s faces azimuth (s + ½)·2π/S from north.
 *   - Lid: one node (glass or cork), or absent when open.
 *   - Substrate: stacked layers (bottom → top) with water content, temperature, carbon.
 *
 * Numerics
 *   Heat is a node network solved with backward Euler (Gauss–Seidel), vapour with an
 *   implicit scalar balance, soil water with adaptive explicit substeps. Every water and
 *   carbon transfer is booked so the ledger in `ledger.ts` can prove conservation.
 */
import { CP_WATER, GLASS, KELVIN, PAR_FRACTION_OF_SHORTWAVE, PAR_UMOL_PER_J_LED, PAR_UMOL_PER_J_SUN, RHO_WATER, SECONDS_PER_DAY, STEFAN_BOLTZMANN } from './constants';
import { LID_ACH, MATERIALS, type TerrariumConfig } from './config';
import { indoorLight, type IndoorLight } from './physics/light';
import {
  airDensity,
  airMoles,
  latentHeat,
  massTransferCoeff,
  satVaporDensity,
  waterActivity,
} from './physics/psychro';
import {
  conductivityAtHead,
  effectiveSaturation,
  headFromTheta,
  thermalConductivity,
  thetaFromHead,
  type SoilMaterial,
} from './physics/soil';
import { nextGaussian } from './rng';

const H_IN = 3.0; // W/m²K, natural convection inside the jar
const H_OUT = 8.5; // W/m²K, outer surface convection + long-wave
const U_TABLE = 3.0; // W/m²K, jar base to table
const EMISSIVITY = 0.93;
/**
 * Water a surface holds as droplets before they coalesce and run off (kg/m²). Sliding starts at
 * droplet radii of ~2–3 mm; at ~55 % coverage and cap-shaped drops that is a few hundred g/m².
 */
export const FILM_HOLD_WALL = 0.3;
export const FILM_HOLD_LID = 0.15;
const C_MOLAR = 0.012011; // kg C / mol
const K_LABILE = 0.03 / SECONDS_PER_DAY; // 1/s at 20 °C
const K_HUMUS = 3e-5 / SECONDS_PER_DAY; // 1/s at 20 °C, peat humus (half-life ≈ 60 y)
const Q10_RESP = 2.0;

export interface SoilLayerState {
  material: string;
  thickness: number;
  zCenter: number; // height of layer centre above jar floor, m
  theta: number;
  T: number;
  labileC: number; // kg C
  humusC: number; // kg C
}

export interface Ledger {
  waterInitial: number; // kg
  waterAdded: number;
  waterVentedNet: number; // kg lost to the room (negative = gained)
  carbonInitial: number; // kg C
  carbonVentedNet: number;
}

export interface StepFluxes {
  soilEvaporation: number; // kg/s (negative = condensation onto soil)
  glassCondensation: number; // kg/s onto glass + lid (negative = evaporation)
  ventWater: number; // kg/s to room
  respirationCO2: number; // mol/s
  runoff: number; // kg/s from glass into soil
}

export interface SimState {
  config: TerrariumConfig;
  time: number; // s since start
  rng: { seed: number };
  cloud: number;
  air: { T: number; vapor: number; co2: number; o2: number; moles: number };
  glassT: number[];
  glassFilm: number[]; // kg per node
  glassAlgae: number[]; // reserved for M4 (phototrophic biofilm)
  lid: { T: number; film: number };
  soil: SoilLayerState[];
  latent: { glass: number[]; lid: number; soil: number };
  env: { roomT: number; roomRH: number; light: IndoorLight; parSoil: number; swSoil: number };
  fluxes: StepFluxes;
  ledger: Ledger;
}

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

// ---------------------------------------------------------------- creation

export function roomTemperature(cfg: TerrariumConfig, hourOfDay: number): number {
  // Minimum around 06:00, maximum around 18:00 (indoor lag).
  return cfg.room.meanTemp - cfg.room.dailyAmplitude * Math.cos(((hourOfDay - 6) / 24) * 2 * Math.PI);
}

export function clock(state: SimState): { day: number; hour: number; dayOfYear: number } {
  const t = state.time + state.config.startHour * 3600;
  const day = Math.floor(t / SECONDS_PER_DAY);
  const hour = (t - day * SECONDS_PER_DAY) / 3600;
  return { day, hour, dayOfYear: ((state.config.startDayOfYear - 1 + day) % 365) + 1 };
}

export function createState(cfg: TerrariumConfig): SimState {
  const g = geometry(cfg);
  const roomT = roomTemperature(cfg, cfg.startHour);
  const nG = cfg.glassBands * cfg.glassSectors;

  let z = 0;
  const soil: SoilLayerState[] = cfg.layers.map((l) => {
    const m = MATERIALS[l.material];
    if (!m) throw new Error(`Unknown material ${l.material}`);
    const vol = g.areaTop * l.thickness;
    const layer: SoilLayerState = {
      material: l.material,
      thickness: l.thickness,
      zCenter: z + l.thickness / 2,
      theta: thetaFromHead(m, l.initialHead),
      T: roomT,
      labileC: m.labileC * vol,
      humusC: m.humusC * vol,
    };
    z += l.thickness;
    return layer;
  });

  const rhoRoom = cfg.room.rh * satVaporDensity(roomT);
  const moles = airMoles(g.airVolume, roomT);
  const state: SimState = {
    config: cfg,
    time: 0,
    rng: { seed: cfg.seed >>> 0 },
    cloud: 0.3,
    air: {
      T: roomT,
      vapor: rhoRoom * g.airVolume,
      co2: moles * cfg.room.co2ppm * 1e-6,
      o2: moles * 0.2095,
      moles,
    },
    glassT: new Array(nG).fill(roomT),
    glassFilm: new Array(nG).fill(0),
    glassAlgae: new Array(nG).fill(0),
    lid: { T: roomT, film: 0 },
    soil,
    latent: { glass: new Array(nG).fill(0), lid: 0, soil: 0 },
    env: {
      roomT,
      roomRH: cfg.room.rh,
      light: indoorLight(cfg.lighting, cfg.startDayOfYear, cfg.startHour, 0.3),
      parSoil: 0,
      swSoil: 0,
    },
    fluxes: { soilEvaporation: 0, glassCondensation: 0, ventWater: 0, respirationCO2: 0, runoff: 0 },
    ledger: { waterInitial: 0, waterAdded: 0, waterVentedNet: 0, carbonInitial: 0, carbonVentedNet: 0 },
  };
  state.ledger.waterInitial = totalWater(state);
  state.ledger.carbonInitial = totalCarbon(state);
  return state;
}

// ---------------------------------------------------------------- inventories

export function soilWater(state: SimState): number {
  const a = geometry(state.config).areaTop;
  return state.soil.reduce((s, l) => s + l.theta * l.thickness * a * RHO_WATER, 0);
}

export function totalWater(state: SimState): number {
  return state.air.vapor + state.glassFilm.reduce((s, f) => s + f, 0) + state.lid.film + soilWater(state);
}

export function totalCarbon(state: SimState): number {
  return state.soil.reduce((s, l) => s + l.labileC + l.humusC, 0) + state.air.co2 * C_MOLAR;
}

// ---------------------------------------------------------------- actions

/** Spray water: roughly half lands on the glass, half on the substrate. */
export function mist(state: SimState, kg: number): void {
  const nG = state.glassFilm.length;
  const onGlass = kg * 0.5;
  for (let i = 0; i < nG; i++) state.glassFilm[i] += onGlass / nG;
  addSoilWater(state, kg - onGlass);
  state.ledger.waterAdded += kg;
}

export function pourWater(state: SimState, kg: number): void {
  addSoilWater(state, kg);
  state.ledger.waterAdded += kg;
}

/** Adds water to the top layer; anything beyond saturation cascades downward. */
function addSoilWater(state: SimState, kg: number): void {
  const a = geometry(state.config).areaTop;
  let vol = kg / RHO_WATER;
  for (let j = state.soil.length - 1; j >= 0 && vol > 0; j--) {
    const l = state.soil[j];
    const m = MATERIALS[l.material];
    const room = (m.thetaS - l.theta) * l.thickness * a;
    const take = Math.min(room, vol);
    l.theta += take / (l.thickness * a);
    vol -= take;
  }
  if (vol > 0) {
    // Substrate is fully saturated: pond on top layer (kept as super-saturation).
    const top = state.soil[state.soil.length - 1];
    top.theta += vol / (top.thickness * a);
  }
}

// ---------------------------------------------------------------- step

export function step(state: SimState): void {
  const cfg = state.config;
  const dt = cfg.dt;
  const g = geometry(cfg);
  const nG = cfg.glassBands * cfg.glassSectors;

  // --- environment
  state.time += dt;
  const { hour, dayOfYear } = clock(state);
  updateWeather(state, dt);
  const light = indoorLight(cfg.lighting, dayOfYear, hour, state.cloud);
  state.env.light = light;
  state.env.roomT = roomTemperature(cfg, hour);
  state.env.roomRH = cfg.room.rh;
  const roomT = state.env.roomT;

  // --- radiation sources
  const src = radiationSources(state, g, light);

  // --- heat
  solveHeat(state, g, src, dt);

  // --- vapour exchange (implicit)
  const Tair = state.air.T;
  const V = g.airVolume;
  const hm = massTransferCoeff(H_IN, Tair);
  const ach = LID_ACH[cfg.lid];
  const Q = (ach * V) / 3600; // m³/s
  const rhoRoom = state.env.roomRH * satVaporDensity(roomT);
  const top = state.soil[state.soil.length - 1];
  const topMat = MATERIALS[top.material];
  const hTop = headFromTheta(topMat, top.theta);
  const seTop = effectiveSaturation(topMat, top.theta);
  const soilSurfaceFactor = Math.min(1, Math.pow(seTop / 0.5, 2));

  // surfaces: glass nodes, lid, soil
  const nS = nG + 2;
  const gS = new Float64Array(nS);
  const rhoS = new Float64Array(nS);
  const avail = new Float64Array(nS); // kg available for evaporation
  for (let i = 0; i < nG; i++) {
    gS[i] = hm * g.nodeArea;
    rhoS[i] = satVaporDensity(state.glassT[i]);
    avail[i] = state.glassFilm[i];
  }
  const lidOpen = cfg.lid === 'open';
  gS[nG] = lidOpen ? 0 : hm * g.areaTop;
  rhoS[nG] = satVaporDensity(state.lid.T);
  avail[nG] = state.lid.film;
  gS[nG + 1] = hm * g.areaTop * soilSurfaceFactor;
  rhoS[nG + 1] = satVaporDensity(top.T) * waterActivity(hTop, top.T);
  avail[nG + 1] = Math.max(0, (top.theta - topMat.thetaR) * top.thickness * g.areaTop * RHO_WATER);

  const fixed = new Float64Array(nS); // fixed flux (kg/s) for evaporation-limited surfaces
  const isFixed = new Uint8Array(nS);
  let rhoNew = state.air.vapor / V;
  for (let iter = 0; iter < 4; iter++) {
    let num = state.air.vapor + dt * Q * rhoRoom;
    let den = V + dt * Q;
    for (let i = 0; i < nS; i++) {
      if (isFixed[i]) num += dt * fixed[i];
      else {
        num += dt * gS[i] * rhoS[i];
        den += dt * gS[i];
      }
    }
    rhoNew = num / den;
    let changed = false;
    for (let i = 0; i < nS; i++) {
      if (isFixed[i]) continue;
      const f = gS[i] * (rhoS[i] - rhoNew);
      if (f > 0 && f * dt > avail[i]) {
        isFixed[i] = 1;
        fixed[i] = avail[i] / dt;
        changed = true;
      }
    }
    if (!changed) break;
  }

  let condGlass = 0;
  const L = latentHeat(Tair);
  for (let i = 0; i < nS; i++) {
    const f = isFixed[i] ? fixed[i] : gS[i] * (rhoS[i] - rhoNew); // + = evaporation into air
    const m = f * dt;
    if (i < nG) {
      state.glassFilm[i] = Math.max(0, state.glassFilm[i] - m);
      state.latent.glass[i] = -f * L;
      condGlass -= f;
    } else if (i === nG) {
      state.lid.film = Math.max(0, state.lid.film - m);
      state.latent.lid = -f * L;
      condGlass -= f;
    } else {
      top.theta -= m / RHO_WATER / (top.thickness * g.areaTop);
      state.latent.soil = -f * L;
      state.fluxes.soilEvaporation = f;
    }
  }
  const vent = Q * (rhoNew - rhoRoom); // kg/s leaving
  state.air.vapor = rhoNew * V;
  state.ledger.waterVentedNet += vent * dt;
  state.fluxes.glassCondensation = condGlass;
  state.fluxes.ventWater = vent;

  // --- droplets run down the glass / drip from the lid
  state.fluxes.runoff = runoff(state, g, dt);

  // --- soil water redistribution
  redistributeSoilWater(state, dt);

  // --- basal soil respiration (placeholder for the full M3 decomposer model)
  const resp = soilRespiration(state, dt);
  state.fluxes.respirationCO2 = resp / dt;

  // --- gas exchange: thermal expansion + ventilation
  exchangeGases(state, g, dt, ach);
}

function updateWeather(state: SimState, dt: number): void {
  // Ornstein–Uhlenbeck process on cloudiness, correlation time ≈ 1 day.
  const tau = SECONDS_PER_DAY;
  const mean = 0.45;
  const sigma = 0.35;
  const a = Math.exp(-dt / tau);
  state.cloud = mean + (state.cloud - mean) * a + sigma * Math.sqrt(1 - a * a) * nextGaussian(state.rng);
  state.cloud = Math.min(1, Math.max(0, state.cloud));
}

// ---------------------------------------------------------------- radiation

interface RadiationSources {
  glass: Float64Array; // W per glass node
  lid: number;
  soil: Float64Array; // W per soil layer (top gets transmitted light)
}

function radiationSources(state: SimState, g: Geometry, light: IndoorLight): RadiationSources {
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

function solveHeat(state: SimState, g: Geometry, src: RadiationSources, dt: number): void {
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

function runoff(state: SimState, g: Geometry, dt: number): number {
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

function redistributeSoilWater(state: SimState, dt: number): void {
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

// ---------------------------------------------------------------- respiration

function moistureFactor(theta: number, thetaS: number): number {
  const wfps = Math.min(1, theta / thetaS);
  if (wfps <= 0.6) return Math.pow(wfps / 0.6, 1.5);
  return Math.max(0.2, 1 - ((wfps - 0.6) / 0.4) * 0.8);
}

/** Returns mol CO₂ released this step. */
function soilRespiration(state: SimState, dt: number): number {
  const o2frac = state.air.o2 / state.air.moles;
  const fO2 = o2frac / (o2frac + 0.02);
  let molCO2 = 0;
  for (const l of state.soil) {
    if (l.labileC <= 0 && l.humusC <= 0) continue;
    const m = MATERIALS[l.material];
    const f = Math.pow(Q10_RESP, (l.T - 20) / 10) * moistureFactor(l.theta, m.thetaS) * fO2;
    const dL = l.labileC * (1 - Math.exp(-K_LABILE * f * dt));
    const dH = l.humusC * (1 - Math.exp(-K_HUMUS * f * dt));
    l.labileC -= dL;
    l.humusC -= dH;
    molCO2 += (dL + dH) / C_MOLAR;
  }
  const o2Use = Math.min(molCO2, state.air.o2); // RQ ≈ 1
  state.air.co2 += molCO2;
  state.air.o2 -= o2Use;
  return molCO2;
}

// ---------------------------------------------------------------- gases

function exchangeGases(state: SimState, g: Geometry, dt: number, ach: number): void {
  const cfg = state.config;
  const air = state.air;
  const xCO2Room = cfg.room.co2ppm * 1e-6;
  const xO2Room = 0.2095;

  // Thermal expansion/contraction pushes air through the lid gap.
  const nNew = airMoles(g.airVolume, air.T);
  const dn = nNew - air.moles;
  if (dn < 0) {
    const f = -dn / air.moles;
    state.ledger.carbonVentedNet += air.co2 * f * C_MOLAR;
    air.co2 *= 1 - f;
    air.o2 *= 1 - f;
  } else {
    air.co2 += dn * xCO2Room;
    air.o2 += dn * xO2Room;
    state.ledger.carbonVentedNet -= dn * xCO2Room * C_MOLAR;
  }
  air.moles = nNew;

  // Ventilation relaxes mixing ratios toward the room.
  const decay = Math.exp((-ach * dt) / 3600);
  const xCO2 = air.co2 / air.moles;
  const xO2 = air.o2 / air.moles;
  const newCO2 = (xCO2Room + (xCO2 - xCO2Room) * decay) * air.moles;
  state.ledger.carbonVentedNet += (air.co2 - newCO2) * C_MOLAR;
  air.co2 = newCO2;
  air.o2 = (xO2Room + (xO2 - xO2Room) * decay) * air.moles;
}
