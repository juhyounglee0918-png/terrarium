import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../src/sim/config';
import { sunPosition } from '../src/sim/physics/light';
import {
  dewPoint,
  relativeHumidity,
  satVaporDensity,
  satVaporPressure,
  vaporPressureFromDensity,
  waterActivity,
} from '../src/sim/physics/psychro';
import { conductivityAtHead, headFromTheta, thetaFromHead } from '../src/sim/physics/soil';

describe('psychrometrics', () => {
  it('matches tabulated saturation vapour pressure', () => {
    expect(satVaporPressure(0)).toBeCloseTo(610.8, 1);
    expect(satVaporPressure(20) / 1000).toBeCloseTo(2.338, 2);
    expect(satVaporPressure(30) / 1000).toBeCloseTo(4.243, 2);
  });

  it('saturated air at 20 °C holds ≈17.3 g/m³', () => {
    expect(satVaporDensity(20) * 1000).toBeCloseTo(17.3, 0);
  });

  it('dew point inverts Magnus', () => {
    for (const t of [-5, 5, 15, 25, 35]) expect(dewPoint(satVaporPressure(t))).toBeCloseTo(t, 6);
  });

  it('RH round-trips through vapour density', () => {
    const rho = 0.6 * satVaporDensity(24);
    expect(relativeHumidity(rho, 24)).toBeCloseTo(0.6, 9);
    expect(vaporPressureFromDensity(rho, 24)).toBeCloseTo(0.6 * satVaporPressure(24), 6);
  });

  it('Kelvin water activity: −1.5 MPa (wilting point) ≈ 0.989', () => {
    expect(waterActivity(-153, 20)).toBeCloseTo(0.989, 3);
    expect(waterActivity(0, 20)).toBe(1);
  });
});

describe('van Genuchten soil hydraulics', () => {
  for (const m of Object.values(MATERIALS)) {
    it(`${m.id}: retention is monotone and invertible`, () => {
      expect(thetaFromHead(m, 0)).toBeCloseTo(m.thetaS, 12);
      let prev = Infinity;
      for (const h of [-0.001, -0.01, -0.1, -1, -10, -100]) {
        const th = thetaFromHead(m, h);
        expect(th).toBeLessThan(prev);
        expect(th).toBeGreaterThan(m.thetaR);
        expect(headFromTheta(m, th)).toBeCloseTo(h, 6);
        prev = th;
      }
      expect(conductivityAtHead(m, 0)).toBeCloseTo(m.ks, 15);
      expect(conductivityAtHead(m, -1)).toBeLessThan(m.ks);
    });
  }

  it('LECA is nearly impermeable at the suction of moist potting mix (capillary barrier)', () => {
    const leca = MATERIALS.leca;
    const sub = MATERIALS.substrate;
    expect(conductivityAtHead(leca, -0.3)).toBeLessThan(conductivityAtHead(sub, -0.3) * 0.01);
  });
});

describe('sun position', () => {
  it('solar noon elevation at 37.5°N on the June solstice ≈ 76°', () => {
    const s = sunPosition(37.5, 172, 12);
    expect((s.elevation * 180) / Math.PI).toBeCloseTo(90 - 37.5 + 23.44, 0);
    expect((s.azimuth * 180) / Math.PI).toBeCloseTo(180, 0);
  });

  it('sun is below the horizon at midnight', () => {
    expect(sunPosition(37.5, 100, 0).elevation).toBeLessThan(0);
  });
});
