/**
 * Moss mats (poikilohydric). Each surface cell holds cover, biomass, tissue water and N.
 * Moss water equilibrates with the air (sorption-like activity curve) and wicks from the
 * substrate; photosynthesis follows a bell-shaped response to tissue water content: nothing when
 * dry, optimum at moderate water, depressed when waterlogged (CO₂ diffusion blocked by water films).
 */
import { C_MOLAR } from '../constants';
import { MATERIALS } from '../config';
import { satVaporDensity } from '../physics/psychro';
import { effectiveSaturation } from '../physics/soil';
import type { SimState } from '../types';
import { addToSurfaceLitter } from './litter';
import { mossParams, type MossParams } from './params';
import { co2Response, lmaOf, type TranspiringSurface } from './plants';
import { cellCenter, laiAbove } from './surface';
import { nextRandom } from '../rng';

const DRY_PER_C = 1 / 0.45;
const WICK_TIME = 3 * 3600; // s, capillary equilibration with the substrate

/** Water activity of moss tissue at water content W (g/g). */
export function mossActivity(w: number): number {
  return 1 - Math.exp(-Math.max(w, 0) / 0.9);
}

export function waterFactor(w: number, p: MossParams): number {
  if (w <= 0.4) return 0;
  if (w < p.wOpt[0]) return (w - 0.4) / (p.wOpt[0] - 0.4);
  if (w <= p.wOpt[1]) return 1;
  return Math.max(0.35, 1 - (0.65 * (w - p.wOpt[1])) / (p.wMax - p.wOpt[1]));
}

function lightFactor(par: number, p: MossParams): number {
  // Saturates around the optimum; the response is steep because bryophytes are shade-adapted.
  return 1 - Math.exp(-par / (p.ppfdOpt * 0.55));
}

export function mossGasExchange(
  state: SimState,
  dt: number,
  env: { par: number; co2ppm: number; T: number; hm: number },
): { uptake: number; respired: number; surfaces: TranspiringSurface[] } {
  const s = state.surface;
  const m = s.moss;
  const top = state.soil[state.soil.length - 1];
  const tm = MATERIALS[top.material];
  const area = Math.PI * state.config.radius ** 2;
  const cellA = s.cellSize * s.cellSize;
  const seTop = effectiveSaturation(tm, top.theta);
  const fCO2 = co2Response(env.co2ppm);
  const q10 = Math.pow(2, (env.T - 20) / 10);
  const rhoSat = satVaporDensity(top.T);
  let uptake = 0;
  let respired = 0;
  const surfaces: TranspiringSurface[] = [];
  for (let i = 0; i < m.cover.length; i++) {
    if (!m.species[i] || m.biomass[i] <= 0) continue;
    const p = mossParams(m.species[i]);
    const dry = m.biomass[i] * DRY_PER_C;
    const w = m.water[i] / dry;
    const a = cellA * m.cover[i];
    const par = env.par * s.shade[i];
    const cn = m.biomass[i] / Math.max(m.N[i], 1e-15);
    const fN = Math.min(1, Math.max(0, (75 - cn) / 35));
    const fT = Math.exp(-Math.pow((env.T - 20) / 11, 2));
    const gross = p.amax * lightFactor(par, p) * waterFactor(w, p) * fT * fCO2 * fN * m.health[i] * a; // µmol/s
    const resp = 0.12 * p.amax * q10 * a * (w > 0.4 ? 1 : 0.1);
    const gain = gross * dt * 1e-6 * C_MOLAR;
    const loss = Math.min(resp * dt * 1e-6 * C_MOLAR, m.biomass[i] + gain);
    m.biomass[i] += gain - loss;
    uptake += gross * dt * 1e-6;
    respired += loss / C_MOLAR;

    // Capillary exchange with the substrate.
    const wEq = p.wMax * Math.pow(seTop, 1.5);
    let move = ((wEq - w) * dry * dt) / WICK_TIME; // kg into moss (+) or back to soil (−)
    const soilAvail = Math.max(0, (top.theta - tm.thetaR - 0.02) * top.thickness * area * 1000);
    move = Math.max(-m.water[i] * 0.5, Math.min(move, soilAvail * 0.01));
    m.water[i] += move;
    top.theta -= move / 1000 / (top.thickness * area);

    const idx = i;
    surfaces.push({
      g: env.hm * a,
      rhoS: rhoSat * mossActivity(m.water[i] / dry),
      avail: m.water[i],
      apply: (kg: number) => {
        // Evaporation (+) or dew/absorption from humid air (−).
        m.water[idx] = Math.max(0, m.water[idx] - kg);
      },
    });
  }
  return { uptake, respired, surfaces };
}

/** Growth, spread, N uptake and stress (every biology step). */
export function mossBiology(state: SimState, dtd: number, env: { par: number }): void {
  const s = state.surface;
  const m = s.moss;
  const r = state.config.radius;
  const top = state.soil[state.soil.length - 1];
  const cellA = s.cellSize * s.cellSize;

  // Canopy shade on each cell (plants over moss).
  for (let i = 0; i < s.shade.length; i++) {
    if (!s.inside[i]) continue;
    const [x, z] = cellCenter(s, r, i);
    s.shade[i] = Math.exp(-0.7 * laiAbove(state.plants, lmaOf, x, z, 0.005));
  }

  for (let i = 0; i < m.cover.length; i++) {
    if (!m.species[i]) continue;
    const p = mossParams(m.species[i]);
    const dry = m.biomass[i] * DRY_PER_C;
    const w = dry > 0 ? m.water[i] / dry : 0;

    // Water beyond what the shoots can hold drips into the substrate.
    const hold = dry * p.wMax;
    if (m.water[i] > hold) {
      const area = Math.PI * r * r;
      top.theta += (m.water[i] - hold) / 1000 / (top.thickness * area);
      m.water[i] = hold;
    }

    // N uptake toward C:N target from the top layer's mineral pool.
    const target = m.biomass[i] / p.cn;
    if (m.N[i] < target) {
      const want = (target - m.N[i]) * Math.min(1, 0.2 * dtd);
      const avail = (top.nh4 + top.no3) * 0.02 * (m.cover[i] * cellA) / (Math.PI * r * r);
      const take = Math.min(want, avail);
      if (take > 0) {
        const fnh = top.nh4 / (top.nh4 + top.no3);
        top.nh4 -= take * fnh;
        top.no3 -= take * (1 - fnh);
        m.N[i] += take;
      }
    }

    // Stress bookkeeping.
    if (w < 0.4) m.dryDays[i] += dtd;
    else m.dryDays[i] = Math.max(0, m.dryDays[i] - dtd * 3);
    if (w > p.wMax * 0.92) m.wetDays[i] += dtd;
    else m.wetDays[i] = Math.max(0, m.wetDays[i] - dtd * 2);
    const par = env.par * s.shade[i];
    let dmg = 0;
    if (m.dryDays[i] > p.desiccationDays) dmg += 0.08;
    if (m.wetDays[i] > 20 && p.wMax < 11) dmg += 0.05; // cushion mosses rot when soaked
    if (par > p.ppfdMax * 2.2 && w > 0.4) dmg += 0.25 * Math.min(1, (par / p.ppfdMax - 2.2) / 3);
    if (dmg > 0) m.health[i] = Math.max(0, m.health[i] - dmg * dtd);
    else if (w > 0.4) m.health[i] = Math.min(1, m.health[i] + 0.03 * dtd);

    // Senescence of old or damaged tissue → litter.
    const k = 0.002 + (1 - m.health[i]) * 0.03;
    const lost = m.biomass[i] * Math.min(0.5, k * dtd);
    if (lost > 0) {
      const nLost = m.N[i] * (lost / m.biomass[i]);
      m.biomass[i] -= lost;
      m.N[i] -= nLost;
      const [x, z] = cellCenter(s, r, i);
      addToSurfaceLitter(state, lost, nLost, 0.3, x, z);
    }

    // Cover dynamics.
    const density = m.cover[i] > 0 ? m.biomass[i] / (cellA * m.cover[i]) : 0;
    if (density > 0.85 * p.biomassMax && m.health[i] > 0.6) {
      if (m.cover[i] < 1) m.cover[i] = Math.min(1, m.cover[i] + (p.spread / s.cellSize) * dtd);
      else spread(state, i, p, dtd);
    } else if (density < 0.15 * p.biomassMax) {
      m.cover[i] = Math.max(0, m.cover[i] - 0.03 * dtd);
    }
    if (m.cover[i] <= 0.01 || m.biomass[i] <= 1e-9) clearCell(state, i);
  }
}

function spread(state: SimState, i: number, p: MossParams, dtd: number): void {
  const s = state.surface;
  const m = s.moss;
  const n = s.n;
  const ix = i % n;
  const iz = Math.floor(i / n);
  const prob = (p.spread / s.cellSize) * dtd;
  const nb = [i - 1, i + 1, i - n, i + n];
  const ok = [ix > 0, ix < n - 1, iz > 0, iz < n - 1];
  for (let k = 0; k < 4; k++) {
    if (!ok[k]) continue;
    const j = nb[k];
    if (!s.inside[j] || s.rock[j] || m.species[j]) continue;
    if (nextRandom(state.rng) > prob) continue;
    const share = m.biomass[i] * 0.05;
    const nShare = m.N[i] * 0.05;
    const wShare = m.water[i] * 0.05;
    m.biomass[i] -= share;
    m.N[i] -= nShare;
    m.water[i] -= wShare;
    m.species[j] = m.species[i];
    m.cover[j] = 0.05;
    m.biomass[j] = share;
    m.N[j] = nShare;
    m.water[j] = wShare;
    m.health[j] = m.health[i];
  }
}

function clearCell(state: SimState, i: number): void {
  const s = state.surface;
  const m = s.moss;
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  const [x, z] = cellCenter(s, state.config.radius, i);
  addToSurfaceLitter(state, m.biomass[i], m.N[i], 0.3, x, z);
  top.theta += m.water[i] / 1000 / (top.thickness * area);
  m.species[i] = '';
  m.cover[i] = 0;
  m.biomass[i] = 0;
  m.N[i] = 0;
  m.water[i] = 0;
  m.health[i] = 0;
  m.dryDays[i] = 0;
  m.wetDays[i] = 0;
}

export function mossCarbon(state: SimState): number {
  return state.surface.moss.biomass.reduce((a, b) => a + b, 0);
}
export function mossNitrogen(state: SimState): number {
  return state.surface.moss.N.reduce((a, b) => a + b, 0);
}
export function mossWater(state: SimState): number {
  return state.surface.moss.water.reduce((a, b) => a + b, 0);
}
export function mossCoverFraction(state: SimState): number {
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
