/**
 * Sun position and indoor light climate.
 *
 * Outdoor clear-sky irradiance is a simple elevation power law; clouds use the
 * Kasten–Czeplak attenuation. Indoors the terrarium sees a fraction of the sky
 * (diffuse) and, on a windowsill, the direct beam when the sun is inside the
 * window's field of view.
 */
import { PAR_FRACTION_OF_SHORTWAVE, PAR_UMOL_PER_J_LED, PAR_UMOL_PER_J_SUN } from '../constants';

const DEG = Math.PI / 180;

export interface SunPosition {
  /** Elevation above horizon, radians. */
  elevation: number;
  /** Azimuth clockwise from north, radians. */
  azimuth: number;
}

export function sunPosition(latitudeDeg: number, dayOfYear: number, solarHour: number): SunPosition {
  const phi = latitudeDeg * DEG;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const omega = (solarHour - 12) * 15 * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(omega);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azFromSouth = Math.atan2(
    Math.sin(omega),
    Math.cos(omega) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi),
  );
  return { elevation, azimuth: azFromSouth + Math.PI };
}

/** Outdoor global horizontal shortwave (W/m²). */
export function outdoorGlobal(elevation: number, cloud: number): number {
  if (elevation <= 0) return 0;
  const clear = 1000 * Math.pow(Math.sin(elevation), 1.15);
  return clear * (1 - 0.75 * Math.pow(cloud, 3.4));
}

/** Outdoor direct-normal irradiance (W/m²). */
export function outdoorDirectNormal(elevation: number, cloud: number): number {
  if (elevation <= 0.02) return 0;
  return 900 * Math.pow(Math.sin(elevation), 0.3) * Math.pow(1 - cloud, 2);
}

export type Placement = 'windowsill' | 'nearWindow' | 'room' | 'ledShelf';

export interface LightingConfig {
  placement: Placement;
  latitude: number;
  /** Azimuth the window faces (radians from north), 180° = south. */
  windowAzimuth: number;
  /** LED photosynthetic photon flux density at the terrarium (µmol/m²/s). */
  ledPPFD: number;
  ledOnHour: number;
  ledOffHour: number;
}

export const PLACEMENT_DIFFUSE_FRACTION: Record<Placement, number> = {
  windowsill: 0.2,
  nearWindow: 0.07,
  room: 0.015,
  ledShelf: 0.01,
};

export interface IndoorLight {
  sun: SunPosition;
  /** Diffuse shortwave on a horizontal surface at the terrarium (W/m²). */
  diffuseSW: number;
  /** Direct beam shortwave, normal to the beam (W/m²). Zero when no sun reaches the jar. */
  directSW: number;
  /** Direction the direct beam comes from (azimuth, radians). */
  beamAzimuth: number;
  beamElevation: number;
  /** Radiant shortwave from grow lights, from above (W/m²). */
  ledSW: number;
  /** PAR reaching the top of the substrate inside the jar (µmol/m²/s) before glass loss. */
  parOutside: number;
}

export function indoorLight(
  cfg: LightingConfig,
  dayOfYear: number,
  hourOfDay: number,
  cloud: number,
): IndoorLight {
  const sun = sunPosition(cfg.latitude, dayOfYear, hourOfDay);
  const global = outdoorGlobal(sun.elevation, cloud);
  const diffuseSW = global * PLACEMENT_DIFFUSE_FRACTION[cfg.placement];

  let directSW = 0;
  if (cfg.placement === 'windowsill') {
    const dAz = Math.abs(wrapAngle(sun.azimuth - cfg.windowAzimuth));
    // Window aperture: ±70° horizontally, up to 65° elevation (lintel).
    if (dAz < 70 * (Math.PI / 180) && sun.elevation < 65 * (Math.PI / 180)) {
      const incidence = Math.cos(dAz) * Math.cos(sun.elevation);
      directSW = outdoorDirectNormal(sun.elevation, cloud) * 0.8 * Math.max(0, incidence) ** 0.3;
    }
  }

  let ledSW = 0;
  if (cfg.placement === 'ledShelf' && inPhotoperiod(hourOfDay, cfg.ledOnHour, cfg.ledOffHour)) {
    ledSW = cfg.ledPPFD / PAR_UMOL_PER_J_LED;
  }

  const sunPar = (diffuseSW + directSW * Math.max(Math.sin(sun.elevation), 0.3)) * PAR_FRACTION_OF_SHORTWAVE * PAR_UMOL_PER_J_SUN;
  return {
    sun,
    diffuseSW,
    directSW,
    beamAzimuth: sun.azimuth,
    beamElevation: sun.elevation,
    ledSW,
    parOutside: sunPar + ledSW * PAR_UMOL_PER_J_LED,
  };
}

function inPhotoperiod(h: number, on: number, off: number): boolean {
  return on <= off ? h >= on && h < off : h >= on || h < off;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
