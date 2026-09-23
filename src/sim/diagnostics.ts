import { MATERIALS } from './config';
import { clock, geometry, type SimState } from './model';
import { dewPoint, relativeHumidity, vaporPressureFromDensity, vpd } from './physics/psychro';
import { headFromTheta } from './physics/soil';

/** Human-facing readouts derived from the raw state. */
export interface Readout {
  time: number;
  day: number;
  hour: number;
  airT: number;
  rh: number; // 0..1
  dewPoint: number;
  vpd: number; // kPa
  absHumidity: number; // g/m³
  co2ppm: number;
  o2pct: number;
  roomT: number;
  glassMinT: number;
  glassMaxT: number;
  fogCoverage: number; // 0..1 fraction of wall with a visible film
  lidT: number;
  par: number; // µmol/m²/s at substrate
  sunElevation: number; // deg
  cloud: number;
  soil: { material: string; name: string; theta: number; thetaS: number; head: number; T: number }[];
  evaporation: number; // g/h from substrate
  transpiration: number; // g/h from leaves and moss
  condensation: number; // g/h onto glass
  respiration: number; // mg C / h (soil + fauna)
  photosynthesis: number; // mg C / h gross
  ch4ppm: number;
  nh4: number; // mg N per litre of soil water, top layer
  no3: number;
  mouldCover: number; // 0..1 of surface
  mossCover: number;
  litter: number; // g C on the surface
  bacteria: number; // g C in top layer
  fungi: number; // g C in top layer + surface mould
  redoxMax: number;
  plantsAlive: number;
}

export function readout(state: SimState): Readout {
  const g = geometry(state.config);
  const c = clock(state);
  const T = state.air.T;
  const rho = state.air.vapor / g.airVolume;
  const e = vaporPressureFromDensity(rho, T);
  const top = state.soil[state.soil.length - 1];
  const topWater = Math.max(1e-6, top.theta * top.thickness * g.areaTop * 1000); // litres
  // Micro-droplet fog is visible from roughly 1 g/m² of condensate.
  const visible = 0.001 * g.nodeArea;
  let fogged = 0;
  for (const f of state.glassFilm) if (f > visible) fogged++;
  return {
    time: state.time,
    day: c.day,
    hour: c.hour,
    airT: T,
    rh: Math.min(1, relativeHumidity(rho, T)),
    // Air can be momentarily supersaturated next to warm wet soil; report at most the air temperature.
    dewPoint: Math.min(dewPoint(e), T),
    vpd: vpd(rho, T),
    absHumidity: rho * 1000,
    co2ppm: (state.air.co2 / state.air.moles) * 1e6,
    o2pct: (state.air.o2 / state.air.moles) * 100,
    roomT: state.env.roomT,
    glassMinT: Math.min(...state.glassT),
    glassMaxT: Math.max(...state.glassT),
    fogCoverage: fogged / state.glassFilm.length,
    lidT: state.lid.T,
    par: state.env.parSoil,
    sunElevation: (state.env.light.sun.elevation * 180) / Math.PI,
    cloud: state.cloud,
    soil: state.soil.map((l) => {
      const m = MATERIALS[l.material];
      return { material: l.material, name: m.name, theta: l.theta, thetaS: m.thetaS, head: headFromTheta(m, l.theta), T: l.T };
    }),
    evaporation: state.fluxes.soilEvaporation * 3.6e6,
    transpiration: state.fluxes.transpiration * 3.6e6,
    condensation: state.fluxes.glassCondensation * 3.6e6,
    respiration: state.fluxes.respirationCO2 * 0.012011 * 3.6e9,
    photosynthesis: state.fluxes.photosynthesisCO2 * 0.012011 * 3.6e9,
    ch4ppm: (state.air.ch4 / state.air.moles) * 1e6,
    nh4: (top.nh4 / topWater) * 1e6,
    no3: (top.no3 / topWater) * 1e6,
    mouldCover: insideMean(state, state.surface.mould),
    mossCover: insideMean(state, state.surface.moss.cover),
    litter: (state.litter.metC + state.litter.strC) * 1000,
    bacteria: top.bact * 1000,
    fungi: (top.fung + state.surfaceFungi) * 1000,
    redoxMax: Math.max(...state.soil.map((l) => l.redox)),
    plantsAlive: state.plants.filter((p) => p.alive).length,
  };
}

function insideMean(state: SimState, arr: number[]): number {
  let s = 0;
  let n = 0;
  state.surface.inside.forEach((inside, i) => {
    if (!inside) return;
    s += arr[i];
    n++;
  });
  return n ? s / n : 0;
}
