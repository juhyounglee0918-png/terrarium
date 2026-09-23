/**
 * Terrarium model: state creation, conservation inventories and the time step.
 *
 * Every physics step (dt, 60 s): light, heat network, plant/moss gas exchange, implicit vapour
 * balance with all evaporating surfaces, condensation run-off, soil water, gas ventilation.
 * Every biology step (bioDt, 10 min): growth, soil food web and nutrients, fauna, events.
 *
 * All transfers of water, carbon and nitrogen are booked so `ledger.ts` can prove conservation.
 */
import { C_MOLAR, RHO_WATER, SECONDS_PER_DAY } from './constants';
import { LID_ACH, MATERIALS, type TerrariumConfig } from './config';
import { indoorLight } from './physics/light';
import {
  geometry,
  H_IN,
  radiationSources,
  redistributeSoilWater,
  runoff,
  solveHeat,
  updateWeather,
  type Geometry,
} from './physics/environment';
import { airMoles, latentHeat, massTransferCoeff, relativeHumidity, satVaporDensity, vpd, waterActivity } from './physics/psychro';
import { effectiveSaturation, headFromTheta, thetaFromHead } from './physics/soil';
import { algaeCarbon, algaeGasExchange, algaeNitrogen, algaeBiology } from './bio/algae';
import { faunaBiology, faunaCarbon, faunaNitrogen, seedFauna } from './bio/fauna';
import { mossBiology, mossCarbon, mossGasExchange, mossNitrogen, mossWater } from './bio/moss';
import { createPlant, plantBiology, plantCarbon, plantGasExchange, tissueCapacity, type TranspiringSurface } from './bio/plants';
import { CN, soilBiology } from './bio/soilbio';
import { cellAt, createSurface, seedMoss, usableCells } from './bio/surface';
import { nextRandom } from './rng';
import { runEvents } from './events';
import { clock } from './clock';
export { clock } from './clock';
export { mist, pourWater } from './actions';
import type { SimState, SoilLayerState } from './types';

export { geometry, FILM_HOLD_LID, FILM_HOLD_WALL } from './physics/environment';
export type { SimState, SoilLayerState } from './types';

const CH4_ROOM = 1.9e-6;

// ---------------------------------------------------------------- clock

export function roomTemperature(cfg: TerrariumConfig, hourOfDay: number, dayOfYear = cfg.startDayOfYear): number {
  // Daily cycle (minimum ~06:00) plus a mild seasonal swing of the heated/cooled room.
  const seasonal = -2.5 * Math.cos(((dayOfYear - 20) / 365) * 2 * Math.PI) * (cfg.room.seasonal ?? 1);
  return cfg.room.meanTemp + seasonal - cfg.room.dailyAmplitude * Math.cos(((hourOfDay - 6) / 24) * 2 * Math.PI);
}


// ---------------------------------------------------------------- creation

export function createState(cfg: TerrariumConfig): SimState {
  const g = geometry(cfg);
  const roomT = roomTemperature(cfg, cfg.startHour);
  const nG = cfg.glassBands * cfg.glassSectors;

  let z = 0;
  const soil: SoilLayerState[] = cfg.layers.map((l, j) => {
    const m = MATERIALS[l.material];
    if (!m) throw new Error(`Unknown material ${l.material}`);
    const vol = g.areaTop * l.thickness;
    const isTop = j === cfg.layers.length - 1;
    const layer: SoilLayerState = {
      material: l.material,
      thickness: l.thickness,
      zCenter: z + l.thickness / 2,
      theta: thetaFromHead(m, l.initialHead),
      T: roomT,
      metC: m.metC * vol,
      metN: (m.metC * vol) / 15,
      strC: m.strC * vol,
      strN: (m.strC * vol) / 80,
      somC: m.somC * vol,
      somN: (m.somC * vol) / m.somCN,
      bact: m.bact * vol,
      fung: m.fung * vol,
      protist: m.bact * vol * 0.05,
      nemB: m.bact * vol * 0.01,
      nemF: m.fung * vol * 0.02,
      slime: isTop && m.rootable ? 2e-5 * vol : 0,
      pythium: m.rootable ? 2e-4 * vol : 0,
      nh4: m.nh4 * vol,
      no3: m.no3 * vol,
      aerobic: 1,
      anoxicDays: 0,
      redox: 0,
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
      ch4: moles * CH4_ROOM,
      moles,
    },
    glassT: new Array(nG).fill(roomT),
    glassFilm: new Array(nG).fill(0),
    glassAlgae: new Array(nG).fill(2e-9),
    glassAlgaeN: new Array(nG).fill(2e-9 / 8),
    lid: { T: roomT, film: 0 },
    soil,
    litter: { metC: 0, metN: 0, strC: 0, strN: 0 },
    surfaceFungi: 2e-7,
    surface: createSurface(cfg.radius, cfg.hardscape),
    plants: [],
    cohorts: [],
    agents: [],
    mushrooms: [],
    calcium: cfg.hardscape.some((h) => h.limestone) ? 1e9 : 0,
    nextId: 1,
    bioClock: 0,
    latent: { glass: new Array(nG).fill(0), lid: 0, soil: 0 },
    env: {
      roomT,
      roomRH: cfg.room.rh,
      light: indoorLight(cfg.lighting, cfg.startDayOfYear, cfg.startHour, 0.3),
      parSoil: 0,
      swSoil: 0,
      rh: cfg.room.rh,
      heatwave: 0,
      heatwaveDays: 0,
      outage: 0,
    },
    fluxes: {
      soilEvaporation: 0,
      transpiration: 0,
      glassCondensation: 0,
      ventWater: 0,
      respirationCO2: 0,
      photosynthesisCO2: 0,
      plantRespirationCO2: 0,
      runoff: 0,
      nMineralization: 0,
      denitrification: 0,
    },
    ledger: {
      waterInitial: 0,
      waterAdded: 0,
      waterVentedNet: 0,
      carbonInitial: 0,
      carbonImported: 0,
      carbonExported: 0,
      carbonVentedNet: 0,
      nitrogenInitial: 0,
      nitrogenImported: 0,
      nitrogenExported: 0,
      nitrogenLostGas: 0,
    },
    events: [],
    stats: { closedSinceDay: cfg.lid === 'open' ? -1 : 0, mouldySinceDay: -1, maxAirT: roomT, plantDeaths: 0, lastLid: cfg.lid, completed: [] },
  };

  // Organisms and fresh litter that come with the build.
  const free = usableCells(state.surface);
  for (const ps of cfg.plants) {
    const c = cellAt(state.surface, cfg.radius, ps.x, ps.z);
    if (!free.includes(c) && !state.surface.inside[c]) continue;
    const p = createPlant(state, ps.species, ps.x, ps.z);
    // Transplants hydrate from the substrate; in dry soil they start partly dehydrated.
    const top = state.soil[state.soil.length - 1];
    const tm = MATERIALS[top.material];
    const spare = Math.max(0, (top.theta - tm.thetaR - 0.02) * top.thickness * g.areaTop * RHO_WATER * 0.5);
    p.tissueWater = Math.min(p.tissueWater, spare);
    p.water = p.tissueWater / tissueCapacity(p);
    top.theta -= p.tissueWater / RHO_WATER / (top.thickness * g.areaTop);
    state.plants.push(p);
  }
  for (const ms of cfg.moss) {
    const { c } = seedMoss(state, ms.species, ms.fraction);
    void c;
  }
  // Moss arrives moist: that water comes from the substrate budget too (as much as it can spare).
  const top = state.soil[state.soil.length - 1];
  const spareW = Math.max(0, (top.theta - MATERIALS[top.material].thetaR - 0.02) * top.thickness * g.areaTop * RHO_WATER * 0.5);
  const mw = mossWater(state);
  if (mw > spareW) state.surface.moss.water = state.surface.moss.water.map((w) => (w * spareW) / mw);
  top.theta -= Math.min(mw, spareW) / RHO_WATER / (top.thickness * g.areaTop);
  if (cfg.initialLitterC > 0) {
    const c = cfg.initialLitterC;
    state.litter.metC += c * 0.4;
    state.litter.metN += (c * 0.4) / 20;
    state.litter.strC += c * 0.6;
    state.litter.strN += (c * 0.6) / 70;
    for (const i of free) if (nextRandom(state.rng) < 0.25) state.surface.litterWeight[i] = 1;
  }
  seedFauna(state, cfg.fauna, false);

  state.ledger.waterInitial = totalWater(state);
  state.ledger.carbonInitial = totalCarbon(state);
  state.ledger.nitrogenInitial = totalNitrogen(state);
  return state;
}

// ---------------------------------------------------------------- inventories

export function soilWater(state: SimState): number {
  const a = geometry(state.config).areaTop;
  return state.soil.reduce((s, l) => s + l.theta * l.thickness * a * RHO_WATER, 0);
}

export function totalWater(state: SimState): number {
  return (
    state.air.vapor +
    state.glassFilm.reduce((s, f) => s + f, 0) +
    state.lid.film +
    soilWater(state) +
    mossWater(state) +
    state.plants.reduce((s, p) => s + p.tissueWater, 0)
  );
}

function soilCarbon(l: SoilLayerState): number {
  return l.metC + l.strC + l.somC + l.bact + l.fung + l.protist + l.nemB + l.nemF + l.slime + l.pythium;
}

function soilNitrogen(l: SoilLayerState): number {
  return (
    l.metN + l.strN + l.somN + l.nh4 + l.no3 +
    l.bact / CN.bact + l.fung / CN.fung + l.protist / CN.protist + (l.nemB + l.nemF) / CN.nem + l.slime / CN.slime + l.pythium / CN.pythium
  );
}

export function totalCarbon(state: SimState): number {
  return (
    state.soil.reduce((s, l) => s + soilCarbon(l), 0) +
    state.litter.metC + state.litter.strC + state.surfaceFungi +
    state.plants.reduce((s, p) => s + plantCarbon(p), 0) +
    mossCarbon(state) +
    algaeCarbon(state) +
    faunaCarbon(state) +
    state.mushrooms.reduce((s, m) => s + m.c, 0) +
    (state.air.co2 + state.air.ch4) * C_MOLAR
  );
}

export function totalNitrogen(state: SimState): number {
  return (
    state.soil.reduce((s, l) => s + soilNitrogen(l), 0) +
    state.litter.metN + state.litter.strN + state.surfaceFungi / CN.fung +
    state.plants.reduce((s, p) => s + p.N, 0) +
    mossNitrogen(state) +
    algaeNitrogen(state) +
    faunaNitrogen(state) +
    state.mushrooms.reduce((s, m) => s + m.N, 0)
  );
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
  if (state.env.outage > 0) light.ledSW = 0;
  state.env.light = light;
  state.env.roomT = roomTemperature(cfg, hour, dayOfYear) + state.env.heatwave;
  state.env.roomRH = cfg.room.rh;
  const roomT = state.env.roomT;

  // --- radiation and heat
  const src = radiationSources(state, g, light);
  solveHeat(state, g, src, dt);

  // --- photosynthesis, respiration, stomata
  const Tair = state.air.T;
  const V = g.airVolume;
  const hm = massTransferCoeff(H_IN, Tair);
  const rho0 = state.air.vapor / V;
  const co2ppm = (state.air.co2 / state.air.moles) * 1e6;
  const isDay = light.sun.elevation > 0.02 || light.ledSW > 0;
  const bioEnv = { par: state.env.parSoil, co2ppm, T: Tair, vpd: vpd(rho0, Tair), hm, isDay };
  const pg = plantGasExchange(state, dt, bioEnv);
  const mg = mossGasExchange(state, dt, bioEnv);
  const ag = algaeGasExchange(state, dt, g, bioEnv);
  const uptake = pg.uptake + mg.uptake + ag.uptake;
  const respired = pg.respired + mg.respired + ag.respired;
  state.air.co2 += respired - uptake;
  state.air.o2 += uptake - respired;
  state.fluxes.photosynthesisCO2 = uptake / dt;
  state.fluxes.plantRespirationCO2 = respired / dt;

  // --- vapour exchange (implicit): glass, lid, bare soil, leaves, moss, ventilation
  const ach = LID_ACH[cfg.lid];
  const Q = (ach * V) / 3600;
  const rhoRoom = state.env.roomRH * satVaporDensity(roomT);
  const top = state.soil[state.soil.length - 1];
  const topMat = MATERIALS[top.material];
  const hTop = headFromTheta(topMat, top.theta);
  const seTop = effectiveSaturation(topMat, top.theta);
  const mossCover = mossCoverOverSoil(state);
  const soilSurfaceFactor = Math.min(1, Math.pow(seTop / 0.5, 2)) * (1 - 0.8 * mossCover);

  const surfaces: TranspiringSurface[] = [];
  for (let i = 0; i < nG; i++) {
    surfaces.push({
      g: hm * g.nodeArea,
      rhoS: satVaporDensity(state.glassT[i]),
      avail: state.glassFilm[i],
      apply: (kg) => {
        state.glassFilm[i] = Math.max(0, state.glassFilm[i] - kg);
        state.latent.glass[i] = (-kg / dt) * L;
      },
    });
  }
  surfaces.push({
    g: cfg.lid === 'open' ? 0 : hm * g.areaTop,
    rhoS: satVaporDensity(state.lid.T),
    avail: state.lid.film,
    apply: (kg) => {
      state.lid.film = Math.max(0, state.lid.film - kg);
      state.latent.lid = (-kg / dt) * L;
    },
  });
  let soilEvap = 0;
  surfaces.push({
    g: hm * g.areaTop * soilSurfaceFactor,
    rhoS: satVaporDensity(top.T) * waterActivity(hTop, top.T),
    avail: Math.max(0, (top.theta - topMat.thetaR) * top.thickness * g.areaTop * RHO_WATER),
    apply: (kg) => {
      top.theta -= kg / RHO_WATER / (top.thickness * g.areaTop);
      soilEvap = kg;
    },
  });
  const nPhys = surfaces.length;
  let transpired = 0;
  for (const s of [...pg.surfaces, ...mg.surfaces]) {
    const inner = s.apply;
    surfaces.push({ ...s, apply: (kg) => { inner(kg); transpired += kg; } });
  }
  const oneWay = new Uint8Array(surfaces.length);
  for (let i = nPhys; i < nPhys + pg.surfaces.length; i++) oneWay[i] = 1; // leaves don't absorb vapour

  const L = latentHeat(Tair);
  const rhoNew = solveVapour(state, surfaces, oneWay, V, Q, rhoRoom, dt);
  state.latent.soil = (-(soilEvap + transpired) / dt) * L;
  const vent = Q * (rhoNew - rhoRoom);
  state.air.vapor = rhoNew * V;
  state.env.rh = Math.min(1, relativeHumidity(rhoNew, Tair));
  state.ledger.waterVentedNet += vent * dt;
  state.fluxes.soilEvaporation = soilEvap / dt;
  state.fluxes.transpiration = transpired / dt;
  state.fluxes.glassCondensation = -surfaces.slice(0, nG + 1).reduce((s, x) => s + (x.flux ?? 0), 0) / dt;
  state.fluxes.ventWater = vent;

  // --- droplets run down the glass / drip from the lid; soil water moves
  state.fluxes.runoff = runoff(state, g, dt);
  redistributeSoilWater(state, dt);

  // --- slow biology
  state.bioClock += dt;
  if (state.bioClock >= cfg.bioDt) {
    bioStep(state, state.bioClock / SECONDS_PER_DAY);
    state.bioClock = 0;
  }

  // --- gas exchange with the room
  exchangeGases(state, g, dt, ach);
  state.stats.maxAirT = Math.max(state.stats.maxAirT, state.air.T);
}

/** Backward-Euler vapour balance; surfaces that would over-draw their water become fixed fluxes. */
function solveVapour(state: SimState, surfaces: TranspiringSurface[], oneWay: Uint8Array, V: number, Q: number, rhoRoom: number, dt: number): number {
  const n = surfaces.length;
  const fixed = new Float64Array(n);
  const isFixed = new Uint8Array(n);
  let rhoNew = state.air.vapor / V;
  for (let iter = 0; iter < 6; iter++) {
    let num = state.air.vapor + dt * Q * rhoRoom;
    let den = V + dt * Q;
    for (let i = 0; i < n; i++) {
      if (isFixed[i]) num += dt * fixed[i];
      else {
        num += dt * surfaces[i].g * surfaces[i].rhoS;
        den += dt * surfaces[i].g;
      }
    }
    rhoNew = num / den;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (isFixed[i]) continue;
      const f = surfaces[i].g * (surfaces[i].rhoS - rhoNew);
      if (f > 0 && f * dt > surfaces[i].avail) {
        isFixed[i] = 1;
        fixed[i] = surfaces[i].avail / dt;
        changed = true;
      } else if (f < 0 && oneWay[i]) {
        isFixed[i] = 1;
        fixed[i] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) {
    const f = isFixed[i] ? fixed[i] : surfaces[i].g * (surfaces[i].rhoS - rhoNew);
    surfaces[i].flux = f * dt;
    surfaces[i].apply(f * dt);
  }
  return rhoNew;
}

function mossCoverOverSoil(state: SimState): number {
  const s = state.surface;
  let c = 0;
  let n = 0;
  for (let i = 0; i < s.inside.length; i++) {
    if (!s.inside[i]) continue;
    n++;
    c += s.moss.cover[i];
  }
  return n ? c / n : 0;
}

function bioStep(state: SimState, dtd: number): void {
  const T = state.air.T;
  const rh = state.env.rh;
  const o2frac = state.air.o2 / state.air.moles;
  const par = state.env.parSoil;
  plantBiology(state, dtd, { T, rh, par });
  mossBiology(state, dtd, { par });
  const sb = soilBiology(state, dtd, { rh, o2frac });
  const fr = faunaBiology(state, dtd, { T, rh });
  algaeBiology(state, dtd);
  const co2 = sb.co2 + fr.co2;
  state.air.co2 += co2;
  state.air.o2 = Math.max(0, state.air.o2 - sb.o2 - fr.co2);
  state.air.ch4 += sb.ch4;
  state.ledger.nitrogenLostGas += sb.nLost;
  state.fluxes.respirationCO2 = co2 / (dtd * SECONDS_PER_DAY);
  state.fluxes.nMineralization = sb.netMin / (dtd * SECONDS_PER_DAY);
  state.fluxes.denitrification = sb.nLost / (dtd * SECONDS_PER_DAY);
  runEvents(state, dtd);
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
    state.ledger.carbonVentedNet += (air.co2 + air.ch4) * f * C_MOLAR;
    air.co2 *= 1 - f;
    air.ch4 *= 1 - f;
    air.o2 *= 1 - f;
  } else {
    air.co2 += dn * xCO2Room;
    air.ch4 += dn * CH4_ROOM;
    air.o2 += dn * xO2Room;
    state.ledger.carbonVentedNet -= dn * (xCO2Room + CH4_ROOM) * C_MOLAR;
  }
  air.moles = nNew;

  // Ventilation relaxes mixing ratios toward the room.
  const decay = Math.exp((-ach * dt) / 3600);
  const relax = (moles: number, xRoom: number) => (xRoom + (moles / air.moles - xRoom) * decay) * air.moles;
  const newCO2 = relax(air.co2, xCO2Room);
  const newCH4 = relax(air.ch4, CH4_ROOM);
  state.ledger.carbonVentedNet += (air.co2 - newCO2 + air.ch4 - newCH4) * C_MOLAR;
  air.co2 = newCO2;
  air.ch4 = newCH4;
  air.o2 = relax(air.o2, xO2Room);
}
