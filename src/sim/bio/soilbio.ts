/**
 * Soil food web and nutrient cycling, per substrate layer (biology step).
 *
 *  litter (metabolic / structural) ──► bacteria, fungi ──► CO₂ (+ CH₄ when methanogenic)
 *        ▲                                  │  N mineralised or immobilised by C:N stoichiometry
 *  humus ┘ (very slow first-order)          ▼
 *                           protists, bacterivorous & fungivorous nematodes (microbial loop → NH₄⁺)
 *  NH₄⁺ ──nitrification (aerobic)──► NO₃⁻ ──denitrification (anoxic)──► N₂ (lost)
 *
 * Aeration comes from air-filled porosity; prolonged anoxia climbs the redox ladder
 * (NO₃⁻ → Mn/Fe → SO₄²⁻ → CH₄). Pythium thrives in anoxic root zones and rots roots.
 * Rates are per day at 20 °C; references in docs/RESEARCH.md §5.
 */
import { C_MOLAR, N_MOLAR } from '../constants';
import { MATERIALS } from '../config';
import type { SimState, SoilLayerState } from '../types';
import { addToSoilLitter } from './litter';
import { plantParams } from './params';

export const CN = { bact: 5, fung: 12, protist: 7, nem: 8, slime: 8, pythium: 10 } as const;

const BACT = { vMet: 2.5, kMet: 0.6, vStr: 0.25, kStr: 8, cue: 0.35, death: 0.06, cap: 1.5 };
const FUNG = { vMet: 1.0, kMet: 3, vStr: 1.2, kStr: 5, cue: 0.45, death: 0.03, cap: 2.0 };
const K_SOM = 3e-5; // 1/day humus turnover (half-life ≈ 60 y)
const PROTIST = { g: 5, k: 1.0, cue: 0.4, death: 0.15 };
const NEM_B = { g: 1.5, k: 1.0, cue: 0.35, death: 0.05 };
const NEM_F = { g: 1.2, k: 1.0, cue: 0.35, death: 0.05 };
const SLIME = { g: 3, k: 0.6, cue: 0.4, death: 0.05, access: 0.3 };
const K_NIT = 0.25;
const K_DEN = 2.0;
const SURFACE_ACCESS = 0.35; // share of top-layer decomposers working the surface litter
/** Visible surface mould (aerial hyphae on litter), grazed by springtails. */
const MOULD = { vMet: 1.2, vStr: 0.7, death: 0.05, crowd: 0.004 };
const FRAGMENTATION = 0.004; // 1/day surface litter mixed into soil without fauna

export interface SoilBioResult {
  co2: number; // mol
  o2: number; // mol consumed
  ch4: number; // mol
  nLost: number; // kg N as N₂/N₂O
  netMin: number; // kg N net mineralised
}

export function aerobicFraction(l: SoilLayerState, o2frac: number, above: number): number {
  const m = MATERIALS[l.material];
  const eps = Math.max(0, m.thetaS - l.theta);
  const own = Math.pow(Math.min(1, Math.max(0, (eps - 0.03) / 0.12)), 0.8);
  return own * (0.5 + 0.5 * above) * (o2frac / (o2frac + 0.02));
}

function tempFactor(t: number): number {
  const f = Math.pow(2.2, (t - 20) / 10);
  return t > 38 ? f * Math.max(0, 1 - (t - 38) / 12) : f;
}

function moistureFactor(theta: number, thetaS: number): number {
  const wfps = Math.min(1, theta / thetaS);
  if (wfps <= 0.6) return Math.pow(wfps / 0.6, 1.5);
  return Math.max(0.3, 1 - ((wfps - 0.6) / 0.4) * 0.7);
}

function nitrifTemp(t: number): number {
  if (t <= 5 || t >= 50) return 0;
  if (t <= 30) return Math.pow(2, (t - 20) / 10) * Math.min(1, (t - 5) / 5);
  return 2 * (1 - (t - 30) / 20);
}

/** Microbial consumption of one substrate pool with C:N stoichiometry. Returns respired C. */
function consume(
  l: SoilLayerState,
  pool: 'met' | 'str' | 'surfMet' | 'surfStr',
  who: 'bact' | 'fung' | 'mould',
  uptakeC: number,
  state: SimState,
): { resp: number; netMin: number } {
  const L = state.litter;
  const src =
    pool === 'met' ? [l.metC, l.metN] : pool === 'str' ? [l.strC, l.strN] : pool === 'surfMet' ? [L.metC, L.metN] : [L.strC, L.strN];
  const c = Math.min(uptakeC, src[0] * 0.5);
  if (c <= 0) return { resp: 0, netMin: 0 };
  const n = (c * src[1]) / Math.max(src[0], 1e-15);
  const cue = who === 'bact' ? BACT.cue : FUNG.cue;
  const cn = who === 'mould' ? CN.fung : CN[who];
  let growth = c * cue;
  const need = growth / cn;
  let net = n - need;
  if (net < 0) {
    // Immobilise mineral N; if it is not enough, respire the excess carbon (overflow metabolism).
    const avail = (l.nh4 + l.no3) * 0.5;
    const imm = Math.min(-net, avail);
    const fnh = l.nh4 + l.no3 > 0 ? l.nh4 / (l.nh4 + l.no3) : 1;
    l.nh4 -= imm * fnh;
    l.no3 -= imm * (1 - fnh);
    if (imm < -net) growth = (n + imm) * cn;
    net = -imm;
  } else {
    l.nh4 += net;
  }
  if (pool === 'met') {
    l.metC -= c;
    l.metN -= n;
  } else if (pool === 'str') {
    l.strC -= c;
    l.strN -= n;
  } else if (pool === 'surfMet') {
    L.metC -= c;
    L.metN -= n;
  } else {
    L.strC -= c;
    L.strN -= n;
  }
  if (who === 'mould') state.surfaceFungi += growth;
  else l[who] += growth;
  return { resp: c - growth, netMin: net };
}

/** Grazer eats prey pool (kg C); returns respired C. N surplus is excreted as NH₄⁺. */
function graze(l: SoilLayerState, predator: 'protist' | 'nemB' | 'nemF' | 'slime', prey: 'bact' | 'fung', eaten: number, cue: number): number {
  const c = Math.min(eaten, l[prey] * 0.5);
  if (c <= 0) return 0;
  const n = c / CN[prey];
  const cnPred = predator === 'protist' ? CN.protist : predator === 'slime' ? CN.slime : CN.nem;
  let growth = c * cue;
  let excess = n - growth / cnPred;
  if (excess < 0) {
    growth = n * cnPred;
    excess = 0;
  }
  l[prey] -= c;
  l[predator] += growth;
  l.nh4 += excess;
  return c - growth;
}

/** Deaths go to metabolic litter (necromass is N-rich). */
function die(l: SoilLayerState, who: 'bact' | 'fung' | 'protist' | 'slime' | 'pythium', rate: number, dtd: number): void {
  const c = l[who] * Math.min(0.9, rate * dtd);
  if (c <= 0) return;
  l[who] -= c;
  addToSoilLitter(l, c, c / CN[who], 0.9);
}

export function soilBiology(state: SimState, dtd: number, env: { rh: number; o2frac: number }): SoilBioResult {
  const res: SoilBioResult = { co2: 0, o2: 0, ch4: 0, nLost: 0, netMin: 0 };
  const area = Math.PI * state.config.radius ** 2;
  const nL = state.soil.length;
  const fRH = Math.min(1, Math.max(0.05, (env.rh - 0.75) / 0.2));
  let above = 1;

  for (let j = nL - 1; j >= 0; j--) {
    const l = state.soil[j];
    const m = MATERIALS[l.material];
    const vol = l.thickness * area;
    const isTop = j === nL - 1;
    const fAer = aerobicFraction(l, env.o2frac, above);
    above = fAer;
    l.aerobic = fAer;
    if (fAer < 0.3) l.anoxicDays += dtd;
    else l.anoxicDays = Math.max(0, l.anoxicDays - 2 * dtd);
    l.redox = fAer > 0.5 ? 0 : l.no3 / vol > 0.002 ? 1 : l.anoxicDays < 3 ? 2 : l.anoxicDays < 10 ? 3 : 4;

    const fT = tempFactor(l.T);
    const fW = moistureFactor(l.theta, m.thetaS);
    const env0 = fT * fW;
    let resp = 0;
    let respAnaer = 0;

    // Humus slowly dissolves into the metabolic pool (DOC for bacteria).
    if (l.somC > 0) {
      const d = l.somC * K_SOM * env0 * dtd;
      const dn = (d * l.somN) / l.somC;
      l.somC -= d;
      l.somN -= dn;
      l.metC += d;
      l.metN += dn;
    }

    // Bacteria (can ferment when anoxic) and fungi (strictly aerobic).
    const bAct = env0 * (fAer + 0.3 * (1 - fAer));
    const fAct = env0 * fAer;
    const metConc = l.metC / vol;
    const strConc = l.strC / vol;
    const bUp = BACT.vMet * l.bact * (metConc / (BACT.kMet + metConc)) * bAct * dtd;
    const bUpS = BACT.vStr * l.bact * (strConc / (BACT.kStr + strConc)) * bAct * dtd;
    const fUp = FUNG.vMet * l.fung * (metConc / (FUNG.kMet + metConc)) * fAct * dtd;
    const fUpS = FUNG.vStr * l.fung * (strConc / (FUNG.kStr + strConc)) * fAct * dtd;
    for (const [pool, who, up] of [
      ['met', 'bact', bUp],
      ['str', 'bact', bUpS],
      ['met', 'fung', fUp],
      ['str', 'fung', fUpS],
    ] as const) {
      const r = consume(l, pool, who, up, state);
      if (who === 'bact') {
        resp += r.resp * fAer;
        respAnaer += r.resp * (1 - fAer);
      } else resp += r.resp;
      res.netMin += r.netMin;
    }

    // Surface litter: bacteria from the top layer, and a surface mould mat that only grows in humid air.
    if (isTop) {
      const L = state.litter;
      const lmc = L.metC / (area * 0.01);
      const lsc = L.strC / (area * 0.01);
      const sb = SURFACE_ACCESS * l.bact * fT * dtd;
      const sf = state.surfaceFungi * fT * fRH * dtd;
      const ups: [('surfMet' | 'surfStr'), 'bact' | 'mould', number][] = [
        ['surfMet', 'bact', BACT.vMet * sb * (lmc / (BACT.kMet + lmc))],
        ['surfStr', 'bact', BACT.vStr * sb * (lsc / (BACT.kStr + lsc))],
        ['surfMet', 'mould', MOULD.vMet * sf * (lmc / (FUNG.kMet + lmc))],
        ['surfStr', 'mould', MOULD.vStr * sf * (lsc / (FUNG.kStr + lsc))],
      ];
      for (const [pool, who, up] of ups) {
        const r = consume(l, pool, who, up, state);
        resp += r.resp;
        res.netMin += r.netMin;
      }
      // Mould dies back in dry air and with density; dead hyphae join the surface litter.
      const mDens = state.surfaceFungi / area; // kg/m²
      const md = state.surfaceFungi * Math.min(0.9, (MOULD.death + (1 - fRH) * 0.3 + mDens / MOULD.crowd) * dtd);
      state.surfaceFungi -= md;
      state.litter.metC += md * 0.8;
      state.litter.metN += (md * 0.8) / CN.fung;
      state.litter.strC += md * 0.2;
      state.litter.strN += (md * 0.2) / CN.fung;
      // Slow physical mixing of surface litter into the soil.
      const f = Math.min(0.5, FRAGMENTATION * dtd);
      moveSurfaceToSoil(state, l, f);
    }

    // Microbial loop: protists and nematodes graze microbes and release NH₄⁺.
    const bConc = l.bact / vol;
    const fConc = l.fung / vol;
    const wet = Math.min(1, l.theta / (m.thetaS * 0.35));
    resp += graze(l, 'protist', 'bact', PROTIST.g * l.protist * (bConc / (PROTIST.k + bConc)) * fT * wet * dtd, PROTIST.cue);
    resp += graze(l, 'nemB', 'bact', NEM_B.g * l.nemB * (bConc / (NEM_B.k + bConc)) * fT * wet * dtd, NEM_B.cue);
    resp += graze(l, 'nemF', 'fung', NEM_F.g * l.nemF * (fConc / (NEM_F.k + fConc)) * fT * wet * dtd, NEM_F.cue);
    if (isTop) {
      // Slime mould forages on bacteria only when the surface is very humid; otherwise dormant.
      const active = env.rh > 0.9 && l.T > 16 && l.T < 30 ? Math.min(1, (env.rh - 0.9) / 0.06) : 0;
      resp += graze(l, 'slime', 'bact', SLIME.g * SLIME.access * l.slime * (bConc / (SLIME.k + bConc)) * fT * active * dtd, SLIME.cue);
      die(l, 'slime', active > 0 ? SLIME.death * (1 + l.slime / vol / 0.01) : 0.01, dtd);
    }

    // Mortality rises with density; sparse populations go dormant instead of dying out.
    const dd = (b: number, k: number) => 0.08 + b / (b + k) + b / k * 0.5;
    die(l, 'bact', BACT.death * dd(bConc, BACT.cap * 0.2), dtd);
    die(l, 'fung', FUNG.death * dd(fConc, FUNG.cap * 0.2), dtd);
    die(l, 'protist', PROTIST.death * dd(l.protist / vol, 0.01), dtd);
    diePair(l, 'nemB', NEM_B.death * dd(l.nemB / vol, 0.004), dtd);
    diePair(l, 'nemF', NEM_F.death * dd(l.nemF / vol, 0.004), dtd);

    // Nitrification (aerobic) and denitrification (anoxic, needs carbon).
    const nit = l.nh4 * Math.min(0.9, K_NIT * nitrifTemp(l.T) * fAer * fW * dtd);
    l.nh4 -= nit;
    l.no3 += nit;
    const cAvail = metConc / (metConc + 1);
    const den = l.no3 * Math.min(0.9, K_DEN * (1 - fAer) * fT * cAvail * dtd);
    if (den > 0) {
      const cUse = Math.min(l.metC * 0.5, (den / N_MOLAR) * 1.25 * C_MOLAR);
      l.no3 -= den;
      l.metC -= cUse;
      // Keep metabolic N consistent with the carbon removed (its N is mineralised).
      respAnaer += cUse;
      res.nLost += den;
    }

    // Root rot.
    if (m.rootable) resp += pythium(state, l, fAer, fT, dtd);
    else die(l, 'pythium', 0.3, dtd);

    // Respiration products.
    const methane = l.redox === 4 ? 0.5 : 0;
    res.co2 += (resp + respAnaer * (1 - methane)) / C_MOLAR;
    res.ch4 += (respAnaer * methane) / C_MOLAR;
    res.o2 += resp / C_MOLAR;
  }
  updateSurfaceMould(state, env.rh);
  return res;
}

function diePair(l: SoilLayerState, key: 'nemB' | 'nemF', rate: number, dtd: number): void {
  const c = l[key] * Math.min(0.9, rate * dtd);
  if (c <= 0) return;
  l[key] -= c;
  addToSoilLitter(l, c, c / CN.nem, 0.9);
}

function moveSurfaceToSoil(state: SimState, l: SoilLayerState, f: number): void {
  const L = state.litter;
  const mc = L.metC * f;
  const mn = L.metN * f;
  const sc = L.strC * f;
  const sn = L.strN * f;
  L.metC -= mc;
  L.metN -= mn;
  L.strC -= sc;
  L.strN -= sn;
  l.metC += mc;
  l.metN += mn;
  l.strC += sc;
  l.strN += sn;
}

/** Faunal fragmentation (isopods, millipedes, worms) calls this with the fraction processed. */
export function fragmentLitter(state: SimState, f: number): void {
  moveSurfaceToSoil(state, state.soil[state.soil.length - 1], Math.min(0.5, f));
}

function pythium(state: SimState, l: SoilLayerState, fAer: number, fT: number, dtd: number): number {
  // Pythium zoospores need waterlogged, oxygen-poor pores.
  const anox = Math.pow(Math.max(0, (0.5 - fAer) / 0.5), 1.2);
  const roots = state.plants.filter((p) => p.alive && p.rootC > 0);
  const rootC = roots.reduce((s, p) => s + p.rootC * plantParams(p.species).rotSusceptibility, 0);
  let resp = 0;
  if (rootC > 0 && anox > 0.05 && l.pythium > 0) {
    const eat = Math.min(rootC * 0.3, 1.5 * l.pythium * anox * fT * dtd * (rootC / (rootC + 2e-5)) * 20);
    for (const p of roots) {
      const w = (p.rootC * plantParams(p.species).rotSusceptibility) / rootC;
      const c = Math.min(p.rootC * 0.3, eat * w);
      const nRoot = p.N * (c / (p.leafC + p.stemC + p.rootC + 1e-15));
      p.rootC -= c;
      p.N -= nRoot;
      p.rootDamage = Math.min(1, p.rootDamage + (c / Math.max(p.rootC + c, 1e-12)) * 2);
      const growth = c * 0.4;
      l.pythium += growth;
      resp += c - growth;
      // Excess N from rotting roots is released.
      l.nh4 += Math.max(0, nRoot - growth / CN.pythium);
      if (nRoot < growth / CN.pythium) {
        // Not enough N for that much growth: respire the rest.
        const g2 = nRoot * CN.pythium;
        l.pythium -= growth - g2;
        resp += growth - g2;
      }
    }
  }
  // Recovery of root function in aerated soil.
  for (const p of roots) if (fAer > 0.5) p.rootDamage = Math.max(0, p.rootDamage - 0.05 * dtd);
  die(l, 'pythium', 0.02 + 0.3 * fAer, dtd);
  return resp;
}

/** Visible mould on the surface: fungal density in the top layer where there is litter and humid air. */
function updateSurfaceMould(state: SimState, rh: number): void {
  const s = state.surface;
  const top = state.soil[state.soil.length - 1];
  const area = Math.PI * state.config.radius ** 2;
  const mDens = state.surfaceFungi / area; // kg C/m²; a visible fuzzy mat is ~0.5 g C/m²
  const litterDensity = (state.litter.metC + state.litter.strC) / area; // kg/m²
  const base = Math.min(1.5, mDens / 0.0008) * Math.min(1, Math.max(0.3, (rh - 0.75) / 0.15));
  let total = 0;
  for (let i = 0; i < s.inside.length; i++) total += s.litterWeight[i];
  for (let i = 0; i < s.mould.length; i++) {
    if (!s.inside[i]) {
      s.mould[i] = 0;
      continue;
    }
    const lw = total > 0 ? (s.litterWeight[i] / total) * s.inside.length * 0.25 : 0;
    const local = Math.min(1, lw) * Math.min(1, litterDensity / 0.01) * 0.7 + 0.3;
    const target = Math.min(1, base * local * (1 - s.moss.cover[i] * 0.6));
    s.mould[i] += (target - s.mould[i]) * 0.2;
    s.slime[i] += ((top.slime / (top.thickness * area) > 0.02 && rh > 0.9 ? Math.min(1, top.slime / (top.thickness * area) / 0.2) * (s.moss.cover[i] > 0.2 ? 0.2 : 1) : 0) - s.slime[i]) * 0.2;
  }
  // Litter positions slowly diffuse away (litter weight is only a visual/feeding hint).
  for (let i = 0; i < s.litterWeight.length; i++) s.litterWeight[i] *= 0.999;
}
