import { describe, expect, it } from 'vitest';
import { bareConfig, type TerrariumConfig } from '../src/sim/config';
import { readout } from '../src/sim/diagnostics';
import { balance } from '../src/sim/ledger';
import { createState, pourWater, step, type SimState } from '../src/sim/model';

function run(state: SimState, hours: number, each?: (s: SimState) => void): void {
  const n = Math.round((hours * 3600) / state.config.dt);
  for (let i = 0; i < n; i++) {
    step(state);
    each?.(state);
  }
}

function make(patch: Partial<TerrariumConfig> = {}): SimState {
  return createState({ ...bareConfig(), ...patch });
}

describe('closed jar (glass lid, near window)', () => {
  const s = make();
  const rhs: number[] = [];
  const fogAtDawn: number[] = [];
  run(s, 24 * 5, (st) => {
    const r = readout(st);
    rhs.push(r.rh);
    if (Math.abs(r.hour - 7) < 0.01) fogAtDawn.push(r.fogCoverage);
  });
  const r = readout(s);

  it('stays numerically sane', () => {
    expect(Number.isFinite(r.airT)).toBe(true);
    expect(r.airT).toBeGreaterThan(10);
    expect(r.airT).toBeLessThan(40);
    for (const l of r.soil) expect(l.theta).toBeGreaterThan(0);
  });

  it('humidity climbs above 90 % RH (closed terrarium signature)', () => {
    const lastDay = rhs.slice(-1440);
    expect(Math.max(...lastDay)).toBeGreaterThan(0.9);
    expect(lastDay.reduce((a, b) => a + b, 0) / lastDay.length).toBeGreaterThan(0.85);
  });

  it('glass fogs in the cool morning', () => {
    expect(Math.max(...fogAtDawn)).toBeGreaterThan(0.1);
  });

  it('conserves water, carbon and nitrogen', () => {
    const b = balance(s);
    expect(Math.abs(b.water.error)).toBeLessThan(1e-9 + b.water.stored * 1e-9);
    expect(Math.abs(b.carbon.error)).toBeLessThan(1e-9 + b.carbon.stored * 1e-9);
    expect(Math.abs(b.nitrogen.error)).toBeLessThan(1e-9 + b.nitrogen.stored * 1e-9);
  });

  it('CO₂ accumulates above room level without plants (soil respiration)', () => {
    expect(r.co2ppm).toBeGreaterThan(s.config.room.co2ppm + 200);
    expect(r.o2pct).toBeLessThan(20.95);
  });
});

describe('open jar', () => {
  it('relative humidity stays much lower than in a closed jar', () => {
    const open = make({ lid: 'open' });
    const closed = make();
    run(open, 48);
    run(closed, 48);
    expect(readout(open).rh).toBeLessThan(readout(closed).rh - 0.15);
  });

  it('substrate dries out over a couple of weeks', () => {
    const s = make({ lid: 'open' });
    const before = s.soil[2].theta;
    run(s, 24 * 14);
    expect(s.soil[2].theta).toBeLessThan(before - 0.05);
  });
});

describe('windowsill sun', () => {
  it('direct sun heats a closed jar well above the room', () => {
    const s = make({ startDayOfYear: 60 });
    s.config.lighting.placement = 'windowsill';
    let maxExcess = 0;
    run(s, 72, (st) => {
      const r = readout(st);
      maxExcess = Math.max(maxExcess, r.airT - r.roomT);
    });
    expect(maxExcess).toBeGreaterThan(5);
  });
});

describe('drainage layer', () => {
  it('overwatering fills the LECA reservoir; normal moisture does not', () => {
    const s = make();
    run(s, 24);
    const lecaDry = s.soil[0].theta;
    expect(lecaDry).toBeLessThan(0.15);
    pourWater(s, 0.8);
    run(s, 24);
    expect(s.soil[0].theta).toBeGreaterThan(lecaDry + 0.1);
    const b = balance(s);
    expect(Math.abs(b.water.error)).toBeLessThan(1e-8);
  });
});

describe('long run stability', () => {
  it('runs 120 days without NaN and with conservation', () => {
    const s = make();
    run(s, 24 * 120);
    const r = readout(s);
    expect(Number.isFinite(r.co2ppm)).toBe(true);
    expect(Math.abs(balance(s).water.error)).toBeLessThan(1e-8);
  });
});
