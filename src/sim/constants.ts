/** Physical constants (SI). */
export const R_GAS = 8.314462618; // J/(mol·K)
export const M_WATER = 0.018015; // kg/mol
export const M_AIR = 0.028965; // kg/mol
export const P_ATM = 101325; // Pa
export const RHO_WATER = 1000; // kg/m³
export const CP_AIR = 1005; // J/(kg·K)
export const CP_WATER = 4186; // J/(kg·K)
export const GRAVITY = 9.80665; // m/s²
export const STEFAN_BOLTZMANN = 5.670374e-8; // W/(m²·K⁴)
export const KELVIN = 273.15;
export const LEWIS_AIR = 0.85;

/** Glass (soda-lime). */
export const GLASS = {
  density: 2500, // kg/m³
  cp: 840, // J/(kg·K)
  k: 1.0, // W/(m·K)
  transmittance: 0.87,
  absorptance: 0.04,
} as const;

/** Energy content of light, McCree (1972). */
export const PAR_UMOL_PER_J_SUN = 4.57;
export const PAR_FRACTION_OF_SHORTWAVE = 0.45;
export const PAR_UMOL_PER_J_LED = 4.6;

export const SECONDS_PER_DAY = 86400;

export const C_MOLAR = 0.012011; // kg C per mol
export const N_MOLAR = 0.014007; // kg N per mol
