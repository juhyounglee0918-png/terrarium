/**
 * Soil hydraulics: van Genuchten (1980) retention + Mualem (1976) conductivity.
 * Heads are in metres of water (negative = suction).
 */

export interface SoilMaterial {
  id: string;
  name: string;
  thetaS: number; // saturated volumetric water content
  thetaR: number; // residual water content
  alpha: number; // 1/m
  n: number;
  ks: number; // saturated hydraulic conductivity, m/s
  bulkDensity: number; // dry, kg/m³
  cpSolid: number; // J/(kg·K)
  kDry: number; // thermal conductivity dry, W/(m·K)
  kSat: number; // thermal conductivity saturated, W/(m·K)
  albedo: number;
  /** Initial carbon pools (kg C per m³ of layer). */
  labileC: number;
  humusC: number;
  color: string;
}

const SE_MIN = 1e-12;

export function effectiveSaturation(m: SoilMaterial, theta: number): number {
  const se = (theta - m.thetaR) / (m.thetaS - m.thetaR);
  return Math.min(1, Math.max(SE_MIN, se));
}

export function thetaFromHead(m: SoilMaterial, h: number): number {
  if (h >= 0) return m.thetaS;
  const mm = 1 - 1 / m.n;
  const se = Math.pow(1 + Math.pow(m.alpha * -h, m.n), -mm);
  return m.thetaR + (m.thetaS - m.thetaR) * se;
}

export function headFromTheta(m: SoilMaterial, theta: number): number {
  const se = effectiveSaturation(m, theta);
  if (se >= 1) return 0;
  const mm = 1 - 1 / m.n;
  return -Math.pow(Math.pow(se, -1 / mm) - 1, 1 / m.n) / m.alpha;
}

export function conductivityFromSe(m: SoilMaterial, se: number): number {
  const mm = 1 - 1 / m.n;
  const s = Math.min(1, Math.max(SE_MIN, se));
  const inner = 1 - Math.pow(1 - Math.pow(s, 1 / mm), mm);
  return m.ks * Math.sqrt(s) * inner * inner;
}

/** Unsaturated conductivity of material `m` when its matric head is `h`. */
export function conductivityAtHead(m: SoilMaterial, h: number): number {
  if (h >= 0) return m.ks;
  const mm = 1 - 1 / m.n;
  const se = Math.pow(1 + Math.pow(m.alpha * -h, m.n), -mm);
  return conductivityFromSe(m, se);
}

/** Thermal conductivity, linear in saturation (simplified Johansen). */
export function thermalConductivity(m: SoilMaterial, theta: number): number {
  const s = Math.min(1, Math.max(0, theta / m.thetaS));
  return m.kDry + (m.kSat - m.kDry) * Math.sqrt(s);
}
