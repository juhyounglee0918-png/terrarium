/**
 * Psychrometrics (moist air). Magnus–Tetens form as in Campbell & Norman (1998).
 * Temperatures in °C, pressures in Pa, densities in kg/m³.
 */
import { CP_AIR, KELVIN, LEWIS_AIR, M_AIR, M_WATER, P_ATM, R_GAS } from '../constants';

export function satVaporPressure(tC: number): number {
  return 610.8 * Math.exp((17.27 * tC) / (tC + 237.3));
}

export function vaporDensityFromPressure(ePa: number, tC: number): number {
  return (ePa * M_WATER) / (R_GAS * (tC + KELVIN));
}

export function vaporPressureFromDensity(rho: number, tC: number): number {
  return (rho * R_GAS * (tC + KELVIN)) / M_WATER;
}

export function satVaporDensity(tC: number): number {
  return vaporDensityFromPressure(satVaporPressure(tC), tC);
}

/** Relative humidity 0..1 (may exceed 1 transiently when supersaturated). */
export function relativeHumidity(rhoV: number, tC: number): number {
  return vaporPressureFromDensity(rhoV, tC) / satVaporPressure(tC);
}

/** Dew point (°C) for a given vapour pressure (Pa). Inverse of Magnus. */
export function dewPoint(ePa: number): number {
  const a = Math.log(Math.max(ePa, 1e-3) / 610.8);
  return (237.3 * a) / (17.27 - a);
}

/** Vapour pressure deficit (kPa). */
export function vpd(rhoV: number, tC: number): number {
  return Math.max(0, satVaporPressure(tC) - vaporPressureFromDensity(rhoV, tC)) / 1000;
}

/** Latent heat of vaporisation (J/kg). */
export function latentHeat(tC: number): number {
  return (2.501 - 0.00237 * tC) * 1e6;
}

export function airDensity(tC: number): number {
  return (P_ATM * M_AIR) / (R_GAS * (tC + KELVIN));
}

/** Total moles of gas in a volume at ambient pressure. */
export function airMoles(volume: number, tC: number): number {
  return (P_ATM * volume) / (R_GAS * (tC + KELVIN));
}

/** Mass-transfer coefficient (m/s) from a heat-transfer coefficient via Chilton–Colburn. */
export function massTransferCoeff(hHeat: number, tC: number): number {
  return hHeat / (airDensity(tC) * CP_AIR * Math.pow(LEWIS_AIR, 2 / 3));
}

/** Water activity of a surface at matric head h (m, ≤ 0), Kelvin equation. */
export function waterActivity(headM: number, tC: number): number {
  return Math.exp((Math.min(headM, 0) * 9.80665 * M_WATER) / (R_GAS * (tC + KELVIN)));
}
