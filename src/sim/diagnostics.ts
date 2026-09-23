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
  condensation: number; // g/h onto glass
  respiration: number; // mg C / h
}

export function readout(state: SimState): Readout {
  const g = geometry(state.config);
  const c = clock(state);
  const T = state.air.T;
  const rho = state.air.vapor / g.airVolume;
  const e = vaporPressureFromDensity(rho, T);
  const hold = 0.02 * g.nodeArea;
  let fogged = 0;
  for (const f of state.glassFilm) if (f > hold * 0.05) fogged++;
  return {
    time: state.time,
    day: c.day,
    hour: c.hour,
    airT: T,
    rh: Math.min(1, relativeHumidity(rho, T)),
    dewPoint: dewPoint(e),
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
    condensation: state.fluxes.glassCondensation * 3.6e6,
    respiration: state.fluxes.respirationCO2 * 0.012011 * 3.6e9,
  };
}
