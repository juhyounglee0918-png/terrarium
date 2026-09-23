/**
 * Soil and surface fauna.
 *
 * Cohorts (springtails, dwarf isopods, predatory mites, fungus gnats, shore flies) are tracked
 * as stage pools (count + carbon) with degree-day development, temperature-dependent fecundity
 * and lifespan, humidity and crowding mortality, and a type-II functional response to food.
 * Agents (woodlice, millipedes, snails, earthworms) are individuals that move, avoid light,
 * forage, grow, brood and die. Metabolism follows the metabolic theory of ecology (see params.ts).
 * Every bite, breath, dropping and carcass is booked in C and N.
 */
import { MATERIALS } from '../config';
import { effectiveSaturation } from '../physics/soil';
import { nextRandom } from '../rng';
import type { Agent, Cohort, SimState } from '../types';
import type { FaunaSpec } from '../config';
import { grazeAlgae } from './algae';
import { addToSurfaceLitter } from './litter';
import {
  agentParams,
  cohortParams,
  interp,
  metabolicC,
  SPECIES,
  thermalPerformance,
  type AgentParams,
  type CohortParams,
  type DietItem,
} from './params';
import { CN as MICROBE_CN, fragmentLitter } from './soilbio';
import { cellAt, cellCenter, usableCells } from './surface';

const K_FOOD = 5e-4; // kg C per m² of surface: half-saturation for microbial/litter foods
const K_PREY = 2000; // prey individuals per m²
export const MAX_AGENTS_PER_SPECIES = 60;

// ---------------------------------------------------------------- setup

export function seedFauna(state: SimState, specs: FaunaSpec[], imported: boolean): void {
  for (const f of specs) {
    const kind = SPECIES[f.species]?.sim?.kind;
    let c = 0;
    if (kind === 'cohort') {
      const p = cohortParams(f.species);
      let co = state.cohorts.find((x) => x.species === f.species);
      if (!co) {
        co = { species: f.species, stages: p.stages.map(() => ({ n: 0, c: 0 })) };
        state.cohorts.push(co);
      }
      const adult = co.stages[co.stages.length - 1];
      adult.n += f.count;
      adult.c += f.count * p.stages[p.stages.length - 1].bodyC;
      c = f.count * p.stages[p.stages.length - 1].bodyC;
      if (imported) {
        state.ledger.carbonImported += c;
        state.ledger.nitrogenImported += c / p.cn;
      }
    } else if (kind === 'agent') {
      const p = agentParams(f.species);
      const cells = usableCells(state.surface);
      for (let k = 0; k < f.count; k++) {
        const i = cells[Math.floor(nextRandom(state.rng) * cells.length)];
        const [x, z] = cellCenter(state.surface, state.config.radius, i);
        const a: Agent = {
          id: state.nextId++,
          species: f.species,
          x,
          z,
          heading: nextRandom(state.rng) * Math.PI * 2,
          bodyC: p.adultC,
          broodC: 0,
          age: p.maturityDays + nextRandom(state.rng) * p.lifespanDays * 0.3,
          adult: true,
          brood: 0,
          broodSize: 0,
          hydration: 1,
          alive: true,
        };
        state.agents.push(a);
        if (imported) {
          state.ledger.carbonImported += p.adultC;
          state.ledger.nitrogenImported += p.adultC / p.cn;
        }
      }
    }
  }
}

export function faunaCarbon(state: SimState): number {
  let c = 0;
  for (const co of state.cohorts) for (const s of co.stages) c += s.c;
  for (const a of state.agents) c += a.bodyC + a.broodC;
  return c;
}

export function faunaNitrogen(state: SimState): number {
  let n = 0;
  for (const co of state.cohorts) {
    const cn = cohortParams(co.species).cn;
    for (const s of co.stages) n += s.c / cn;
  }
  for (const a of state.agents) n += (a.bodyC + a.broodC) / agentParams(a.species).cn;
  return n;
}

export function population(state: SimState, species: string): number {
  const co = state.cohorts.find((c) => c.species === species);
  if (co) return co.stages.reduce((s, x) => s + x.n, 0);
  return state.agents.filter((a) => a.species === species).length;
}

// ---------------------------------------------------------------- food web plumbing

interface Food {
  avail: number; // kg C accessible
  take: (c: number) => [number, number]; // removes up to c kg C, returns [C, N] removed
}

function foodSource(state: SimState, food: string, eater: string): Food {
  const top = state.soil[state.soil.length - 1];
  const L = state.litter;
  const fromPool = (key: 'fung' | 'bact', share: number, cn: number): Food => ({
    avail: top[key] * share,
    take: (c) => {
      const t = Math.min(c, top[key] * share * 0.5);
      top[key] -= t;
      return [t, t / cn];
    },
  });
  switch (food) {
    case 'fungi': {
      // Surface mould first (grazed freely), then hyphae in the top centimetre of soil.
      const soilShare = 0.1;
      return {
        avail: state.surfaceFungi + top.fung * soilShare,
        take: (c) => {
          const a = state.surfaceFungi + top.fung * soilShare;
          if (a <= 0) return [0, 0];
          const f = Math.min(0.5, c / a);
          const m = state.surfaceFungi * f;
          const sf = top.fung * soilShare * f;
          state.surfaceFungi -= m;
          top.fung -= sf;
          return [m + sf, (m + sf) / MICROBE_CN.fung];
        },
      };
    }
    case 'bacteria':
      return fromPool('bact', 0.3, MICROBE_CN.bact);
    case 'litter':
      return {
        avail: L.metC + L.strC * 0.4,
        take: (c) => {
          const tot = L.metC + L.strC * 0.4;
          if (tot <= 0) return [0, 0];
          const f = Math.min(0.5, c / tot);
          const mc = L.metC * f;
          const sc = L.strC * 0.4 * f;
          const mn = L.metN * (mc / Math.max(L.metC, 1e-18));
          const sn = L.strN * (sc / Math.max(L.strC, 1e-18));
          L.metC -= mc;
          L.metN -= mn;
          L.strC -= sc;
          L.strN -= sn;
          return [mc + sc, mn + sn];
        },
      };
    case 'soilorganic':
      return {
        avail: top.metC + top.strC,
        take: (c) => {
          const tot = top.metC + top.strC;
          if (tot <= 0) return [0, 0];
          const f = Math.min(0.3, c / tot);
          const mc = top.metC * f;
          const sc = top.strC * f;
          const mn = top.metN * f;
          const sn = top.strN * f;
          top.metC -= mc;
          top.metN -= mn;
          top.strC -= sc;
          top.strN -= sn;
          return [mc + sc, mn + sn];
        },
      };
    case 'algae': {
      const bands = eater === 'subulina' ? state.config.glassBands : 2;
      let avail = 0;
      for (let i = 0; i < bands * state.config.glassSectors; i++) avail += state.glassAlgae[i];
      return { avail, take: (c) => grazeAlgae(state, c, bands) };
    }
    case 'roots': {
      const roots = state.plants.filter((p) => p.alive);
      const avail = roots.reduce((s, p) => s + p.rootC * 0.1, 0);
      return {
        avail,
        take: (c) => {
          let tc = 0;
          let tn = 0;
          for (const p of roots) {
            const share = avail > 0 ? (p.rootC * 0.1) / avail : 0;
            const t = Math.min(p.rootC * 0.2, c * share);
            const n = p.N * (t / Math.max(p.leafC + p.stemC + p.rootC, 1e-15));
            p.rootC -= t;
            p.N -= n;
            p.rootDamage = Math.min(1, p.rootDamage + t / Math.max(p.rootC + t, 1e-12));
            tc += t;
            tn += n;
          }
          return [tc, tn];
        },
      };
    }
    default: {
      if (food.startsWith('prey:')) {
        const prey = state.cohorts.find((c) => c.species === food.slice(5));
        if (!prey) return { avail: 0, take: () => [0, 0] };
        const pp = cohortParams(prey.species);
        const vuln = pp.stages.map((s, i) => (s.feeds || i === pp.stages.length - 1 ? 1 : 0.3));
        const avail = prey.stages.reduce((s, st, i) => s + st.c * vuln[i], 0);
        return {
          avail,
          take: (c) => {
            if (avail <= 0) return [0, 0];
            const f = Math.min(0.5, c / avail);
            let tc = 0;
            prey.stages.forEach((st, i) => {
              const dn = st.n * f * vuln[i];
              const dc = st.c * f * vuln[i];
              st.n -= dn;
              st.c -= dc;
              tc += dc;
            });
            return [tc, tc / pp.cn];
          },
        };
      }
      return { avail: 0, take: () => [0, 0] };
    }
  }
}

/** Feed a consumer: returns assimilated C and N and books egestion as frass. */
function feed(state: SimState, eater: string, diet: DietItem[], demand: number, assim: number, x?: number, z?: number): { c: number; n: number; sat: number } {
  if (demand <= 0) return { c: 0, n: 0, sat: 1 };
  const area = Math.PI * state.config.radius ** 2;
  const sources = diet.map((d) => ({ d, f: foodSource(state, d.food, eater) }));
  let wsum = 0;
  const w = sources.map(({ d, f }) => {
    const k = d.food.startsWith('prey:') ? preyHalfSat(state, d.food, area) : K_FOOD * area;
    const s = d.pref * (f.avail / (f.avail + k));
    wsum += s;
    return s;
  });
  const sat = Math.min(1, wsum);
  let ic = 0;
  let inn = 0;
  sources.forEach(({ f }, i) => {
    if (w[i] <= 0) return;
    const [c, n] = f.take((demand * sat * w[i]) / wsum);
    ic += c;
    inn += n;
  });
  const ac = ic * assim;
  const an = inn * Math.min(1, assim * 1.6);
  addToSurfaceLitter(state, ic - ac, inn - an, 0.7, x, z); // frass
  return { c: ac, n: an, sat };
}

function preyHalfSat(state: SimState, food: string, area: number): number {
  const prey = state.cohorts.find((c) => c.species === food.slice(5));
  if (!prey) return 1;
  const n = prey.stages.reduce((s, x) => s + x.n, 0);
  const c = prey.stages.reduce((s, x) => s + x.c, 0);
  return K_PREY * area * (n > 0 ? c / n : 1e-9);
}

/** Put assimilated C/N into a body with fixed C:N; returns the C actually retained. */
function metabolise(state: SimState, assimC: number, assimN: number, respC: number, cn: number): { net: number; co2: number } {
  const top = state.soil[state.soil.length - 1];
  let net = assimC - respC;
  let co2 = respC;
  if (net > 0) {
    const need = net / cn;
    if (assimN < need) {
      const keep = assimN * cn;
      co2 += net - keep;
      net = keep;
    } else top.nh4 += assimN - need;
  } else {
    // Starving: burned body C releases its N as ammonium.
    top.nh4 += assimN + -net / cn;
  }
  return { net, co2: co2 / 0.012011 };
}

function carcass(state: SimState, c: number, cn: number, x?: number, z?: number): void {
  if (c > 0) addToSurfaceLitter(state, c, c / cn, 0.8, x, z);
}

// ---------------------------------------------------------------- cohorts

function cohortStep(state: SimState, co: Cohort, dtd: number, env: { T: number; rh: number; seTop: number }): number {
  const p: CohortParams = cohortParams(co.species);
  const area = Math.PI * state.config.radius ** 2;
  const T = env.T;
  const perf = thermalPerformance(T, p.tMin, (p.tMin + p.tMax) / 2 + 2, p.tMax);
  const last = co.stages.length - 1;
  let co2 = 0;

  // Feeding and metabolism, stage by stage.
  let adultSat = 0;
  const sats: number[] = co.stages.map(() => 1);
  for (let s = 0; s <= last; s++) {
    const st = co.stages[s];
    if (st.n <= 1e-6) continue;
    const sp = p.stages[s];
    const mass = st.c / st.n;
    const resp = st.n * metabolicC(mass, T) * dtd;
    let assimC = 0;
    let assimN = 0;
    if (sp.feeds) {
      const growthNeed = st.n * Math.max(0, sp.bodyC - mass) * 0.15 * perf * dtd;
      const reproNeed = s === last ? st.n * interp(p.fecundity, T) * p.eggC * dtd * 1.5 : 0;
      const demand = (resp + growthNeed + reproNeed) / p.assim;
      const r = feed(state, co.species, p.diet, demand * perf + resp / p.assim * (1 - perf), p.assim);
      assimC = r.c;
      assimN = r.n;
      sats[s] = r.sat;
      if (s === last) adultSat = r.sat;
    }
    const m = metabolise(state, assimC, assimN, Math.min(resp, st.c + assimC), p.cn);
    st.c = Math.max(0, st.c + m.net);
    co2 += m.co2;
  }

  // Development (degree-days, distributed delay).
  for (let s = last - 1; s >= 0; s--) {
    const sp = p.stages[s];
    const st = co.stages[s];
    if (st.n <= 0 || sp.dd <= 0) continue;
    const ready = sp.feeds ? Math.min(1, st.c / st.n / (sp.bodyC * 0.8)) : 1;
    const f = Math.min(0.5, (Math.max(0, T - sp.tBase) / sp.dd) * dtd * ready);
    const dn = st.n * f;
    const dc = st.c * f;
    st.n -= dn;
    st.c -= dc;
    co.stages[s + 1].n += dn;
    co.stages[s + 1].c += dc;
  }

  // Reproduction from adult reserves.
  const ad = co.stages[last];
  if (ad.n > 0.5) {
    const humid = env.rh >= p.rhMin ? 1 : Math.max(0, 1 - (p.rhMin - env.rh) / 0.1);
    const food = p.stages[last].feeds ? adultSat : 1;
    let eggs = ad.n * interp(p.fecundity, T) * food * humid * dtd;
    const spare = Math.max(0, ad.c - ad.n * p.stages[last].bodyC * 0.7);
    eggs = Math.min(eggs, spare / p.eggC);
    if (eggs > 0) {
      ad.c -= eggs * p.eggC;
      co.stages[0].n += eggs;
      co.stages[0].c += eggs * p.eggC;
    }
  }

  // Mortality.
  const total = co.stages.reduce((s, x) => s + x.n, 0);
  const crowd = total / area / p.crowding;
  const dryAir = env.rh < p.rhMin ? (p.rhMin - env.rh) * 5 : 0;
  const drySoil = p.wetSoil && env.seTop < 0.35 ? (0.35 - env.seTop) * 3 : 0;
  const hot = T > p.tMax ? (T - p.tMax) * 0.5 : T < p.tMin ? 0.05 : 0;
  for (let s = 0; s <= last; s++) {
    const st = co.stages[s];
    if (st.n <= 0) continue;
    const sp = p.stages[s];
    let mort = s === last ? 1 / interp(p.lifespan, T) : 0.01;
    mort += 0.05 * crowd * crowd + dryAir + hot + (s < last ? drySoil : 0);
    if (sp.feeds) mort += 0.6 * Math.max(0, 0.4 - sats[s]);
    if (s === last && st.c / st.n < sp.bodyC * 0.4) mort += 0.4;
    const f = Math.min(0.9, mort * dtd);
    const dc = st.c * f;
    st.n -= st.n * f;
    st.c -= dc;
    carcass(state, dc, p.cn);
    if (st.n < 1e-3) {
      carcass(state, st.c, p.cn);
      st.n = 0;
      st.c = 0;
    }
  }
  return co2;
}

// ---------------------------------------------------------------- agents

function agentStep(state: SimState, a: Agent, dtd: number, env: { T: number; rh: number; seTop: number; isDay: boolean }, crowd: number): number {
  const p: AgentParams = agentParams(a.species);
  const s = state.surface;
  const r = state.config.radius;
  const T = env.T;
  const perf = thermalPerformance(T, 4, p.tOpt, p.tMax + 2);
  a.age += dtd;

  // Movement: light-shy animals seek shade and moisture by day, forage at night.
  const minutes = dtd * 1440;
  const cell = cellAt(s, r, a.x, a.z);
  const exposed = p.photophobic && env.isDay && s.shade[cell] > 0.6 && !nearRock(state, a.x, a.z);
  const activity = perf * (p.photophobic && env.isDay && !exposed ? 0.15 : 1);
  a.heading += (nextRandom(state.rng) - 0.5) * (exposed ? 2.5 : 1.2);
  if (exposed) {
    const target = shelterTarget(state, a);
    if (target) a.heading = Math.atan2(target[1] - a.z, target[0] - a.x) + (nextRandom(state.rng) - 0.5) * 0.6;
  }
  const dist = Math.min(0.03, p.speed * minutes * activity * (0.3 + 0.7 * nextRandom(state.rng)) * 0.2);
  let nx = a.x + Math.cos(a.heading) * dist;
  let nz = a.z + Math.sin(a.heading) * dist;
  const lim = r - 0.008;
  if (Math.hypot(nx, nz) > lim) {
    a.heading += Math.PI * (0.6 + 0.8 * nextRandom(state.rng));
    const k = lim / Math.hypot(nx, nz);
    nx *= k;
    nz *= k;
  }
  a.x = nx;
  a.z = nz;

  // Water balance: moist refuges rehydrate, dry air desiccates.
  const moistSpot = env.seTop > 0.3 || s.moss.cover[cellAt(s, r, a.x, a.z)] > 0.3;
  const dry = Math.max(0, p.rhMin - env.rh) * 4 + (moistSpot ? 0 : 0.2);
  a.hydration = Math.min(1, Math.max(0, a.hydration + (moistSpot && env.rh > p.rhMin - 0.1 ? 1.5 : 0) * dtd - dry * dtd));

  // Feeding and metabolism.
  const resp = metabolicC(a.bodyC, T) * dtd;
  const growth = Math.max(0, p.adultC - a.bodyC) * 0.02 * perf * dtd;
  const local = 0.6 + Math.min(0.8, s.litterWeight[cellAt(s, r, a.x, a.z)] * 0.3);
  const demand = ((resp + growth) / p.assim) * activity * local * 1.3;
  const fed = feed(state, a.species, p.diet, demand, p.assim, a.x, a.z);
  const m = metabolise(state, fed.c, fed.n, Math.min(resp, a.bodyC * 0.5 + fed.c), p.cn);
  a.bodyC = Math.max(0, a.bodyC + m.net);
  // Shredders fragment several times what they eat, feeding soil microbes.
  if (p.diet.some((d) => d.food === 'litter')) {
    const L = state.litter.metC + state.litter.strC;
    if (L > 0) fragmentLitter(state, (fed.c / p.assim) * 1.5 / L);
  }

  if (!a.adult && a.bodyC >= p.adultC * 0.75 && a.age >= p.maturityDays * Math.max(0.6, 20 / Math.max(T, 10))) a.adult = true;

  // Reproduction.
  const calcium = state.calcium > 0 ? 1 : 1 - p.calcium * 0.85;
  if (a.brood > 0) {
    a.brood -= dtd * Math.max(0.2, perf);
    if (a.brood <= 0) {
      const kids = Math.max(1, Math.round(a.broodSize));
      for (let k = 0; k < kids; k++) {
        const baby: Agent = {
          id: state.nextId++,
          species: a.species,
          x: a.x + (nextRandom(state.rng) - 0.5) * 0.01,
          z: a.z + (nextRandom(state.rng) - 0.5) * 0.01,
          heading: nextRandom(state.rng) * Math.PI * 2,
          bodyC: a.broodC / kids,
          broodC: 0,
          age: 0,
          adult: false,
          brood: 0,
          broodSize: 0,
          hydration: 1,
          alive: true,
        };
        state.agents.push(baby);
      }
      a.brood = 0;
      a.broodSize = 0;
      a.broodC = 0;
    }
  } else if (a.adult && a.bodyC > p.adultC * 0.9) {
    const female = a.species === 'subulina' ? 1 : 0.5;
    const prob = (dtd / p.broodInterval) * perf * fed.sat * calcium * female * Math.max(0, 1 - crowd);
    if (nextRandom(state.rng) < prob) {
      const affordable = Math.floor((a.bodyC - p.adultC * 0.75) / p.hatchC);
      const size = Math.min(p.broodSize, affordable);
      if (size >= 1) {
        // Eggs/embryos are carried by the parent (marsupium, clutch, cocoon) until release.
        a.broodSize = size;
        a.brood = p.broodDays;
        a.bodyC -= size * p.hatchC;
        a.broodC += size * p.hatchC;
      }
    }
  }

  // Death.
  let dieNow = false;
  if (a.age > p.lifespanDays * (0.85 + 0.3 * ((a.id * 7919) % 100) / 100)) dieNow = true;
  if (T > p.tMax + 2 && nextRandom(state.rng) < (T - p.tMax - 2) * 0.2 * dtd) dieNow = true;
  if (a.bodyC < (a.adult ? p.adultC : p.hatchC) * 0.4) dieNow = true;
  if (a.hydration < 0.08 && p.rhMin > 0) dieNow = true;
  if (dieNow) {
    a.alive = false;
    carcass(state, a.bodyC + a.broodC, p.cn, a.x, a.z);
    a.bodyC = 0;
    a.broodC = 0;
  }
  return m.co2;
}

function nearRock(state: SimState, x: number, z: number): boolean {
  return state.config.hardscape.some((h) => Math.hypot(x - h.x, z - h.z) < h.size * 1.2);
}

function shelterTarget(state: SimState, a: Agent): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const h of state.config.hardscape) {
    const d = Math.hypot(h.x - a.x, h.z - a.z);
    if (d < bd) {
      bd = d;
      best = [h.x + Math.cos(a.id) * h.size, h.z + Math.sin(a.id) * h.size];
    }
  }
  for (const p of state.plants) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - a.x, p.z - a.z) * 1.3;
    if (d < bd) {
      bd = d;
      best = [p.x, p.z];
    }
  }
  return best;
}

// ---------------------------------------------------------------- mushrooms

function mushrooms(state: SimState, dtd: number, env: { T: number; rh: number }): void {
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  const fConc = top.fung / (top.thickness * area);
  if (env.T > 24 && env.rh > 0.9 && fConc > 0.5 && state.mushrooms.length < 6) {
    if (nextRandom(state.rng) < 0.25 * dtd * Math.min(2, fConc)) {
      const cells = usableCells(state.surface);
      const i = cells[Math.floor(nextRandom(state.rng) * cells.length)];
      const [x, z] = cellCenter(state.surface, state.config.radius, i);
      const c = Math.min(top.fung * 0.05, 3e-4);
      top.fung -= c;
      state.mushrooms.push({ id: state.nextId++, x, z, c, N: c / MICROBE_CN.fung, age: 0 });
      state.events.push({ day: Math.floor(state.time / 86400), kind: 'mushroom', text: '노란 버섯(Leucocoprinus)이 돋아났습니다' });
    }
  }
  for (const m of state.mushrooms) {
    m.age += dtd;
    if (m.age > 4) {
      addToSurfaceLitter(state, m.c, m.N, 0.8, m.x, m.z);
      m.c = 0;
      m.N = 0;
    }
  }
  state.mushrooms = state.mushrooms.filter((m) => m.c > 0);
}

// ---------------------------------------------------------------- entry

export function faunaBiology(state: SimState, dtd: number, env: { T: number; rh: number }): { co2: number } {
  const top = state.soil[state.soil.length - 1];
  const seTop = effectiveSaturation(MATERIALS[top.material], top.theta);
  const isDay = state.env.light.sun.elevation > 0.05 || state.env.light.ledSW > 0;
  const soilT = top.T;
  let co2 = 0;
  for (const co of state.cohorts) co2 += cohortStep(state, co, dtd, { T: soilT, rh: env.rh, seTop });

  const counts: Record<string, number> = {};
  for (const a of state.agents) counts[a.species] = (counts[a.species] ?? 0) + 1;
  for (const a of [...state.agents]) {
    if (!a.alive) continue;
    const crowd = (counts[a.species] ?? 0) / MAX_AGENTS_PER_SPECIES;
    co2 += agentStep(state, a, dtd, { T: soilT, rh: env.rh, seTop, isDay }, crowd);
  }
  state.agents = state.agents.filter((a) => a.alive);
  if (state.calcium > 0 && state.calcium < 1e8) state.calcium = Math.max(0, state.calcium - dtd);

  mushrooms(state, dtd, env);
  return { co2 };
}

