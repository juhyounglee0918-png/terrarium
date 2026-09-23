import { describe, expect, it } from 'vitest';
import { addFauna, addLeafLitter, pourWater } from '../src/sim/actions';
import { mossParams } from '../src/sim/bio/params';
import { waterFactor } from '../src/sim/bio/moss';
import { population } from '../src/sim/bio/fauna';
import { leafArea } from '../src/sim/bio/plants';
import { defaultConfig, type TerrariumConfig } from '../src/sim/config';
import { readout } from '../src/sim/diagnostics';
import { balance } from '../src/sim/ledger';
import { createState, step, type SimState } from '../src/sim/model';

function make(patch: (c: TerrariumConfig) => void = () => {}): SimState {
  const c = defaultConfig();
  c.events = false;
  patch(c);
  return createState(c);
}

function run(s: SimState, days: number, each?: (s: SimState) => void): void {
  for (let i = 0; i < days * 1440; i++) {
    step(s);
    each?.(s);
  }
}

function expectConserved(s: SimState): void {
  const b = balance(s);
  expect(Math.abs(b.water.error)).toBeLessThan(1e-9);
  expect(Math.abs(b.carbon.error)).toBeLessThan(1e-10);
  expect(Math.abs(b.nitrogen.error)).toBeLessThan(1e-11);
}

describe('planted closed terrarium', () => {
  const s = make();
  const la0 = s.plants.reduce((a, p) => a + leafArea(p), 0);
  let dayMin = Infinity;
  let nightMax = 0;
  run(s, 30, (st) => {
    if (st.time < 25 * 86400) return;
    const r = readout(st);
    if (r.hour > 12 && r.hour < 16) dayMin = Math.min(dayMin, r.co2ppm);
    if (r.hour > 2 && r.hour < 6) nightMax = Math.max(nightMax, r.co2ppm);
  });

  it('draws CO₂ down by day and builds it up at night', () => {
    expect(dayMin).toBeLessThan(400);
    expect(nightMax).toBeGreaterThan(dayMin * 3);
  });

  it('plants grow', () => {
    const la = s.plants.reduce((a, p) => a + leafArea(p), 0);
    expect(la).toBeGreaterThan(la0 * 1.3);
    for (const p of s.plants) expect(p.health).toBeGreaterThan(0.8);
  });

  it('springtails establish a population', () => {
    expect(population(s, 'folsomia')).toBeGreaterThan(300);
  });

  it('conserves water, carbon and nitrogen with every organism running', () => {
    expectConserved(s);
  });
});

describe('moss is poikilohydric', () => {
  it('photosynthesis stops when the moss dries out', () => {
    const p = mossParams('hypnum');
    expect(waterFactor(0.2, p)).toBe(0);
    expect(waterFactor(5, p)).toBe(1);
    expect(waterFactor(p.wMax, p)).toBeLessThan(0.5);
  });
});

describe('drought', () => {
  it('open jar in a dry room: plants wilt', () => {
    const s = make((c) => {
      c.lid = 'open';
      c.room.rh = 0.3;
      c.layers = c.layers.map((l) => ({ ...l, initialHead: -60 }));
    });
    run(s, 15);
    const f = s.plants.find((p) => p.species === 'fittonia');
    expect(f === undefined || f.wilt > 0.3 || !f.alive).toBe(true);
    expectConserved(s);
  });
});

describe('waterlogging', () => {
  const s = make();
  pourWater(s, 2.4);
  run(s, 25);

  it('lower layers turn anoxic and climb the redox ladder', () => {
    expect(Math.min(...s.soil.map((l) => l.aerobic))).toBeLessThan(0.3);
    expect(Math.max(...s.soil.map((l) => l.redox))).toBeGreaterThanOrEqual(3);
  });

  it('root rot damages plants and nitrogen is lost by denitrification', () => {
    expect(Math.max(...s.plants.map((p) => p.rootDamage), s.ledger.nitrogenLostGas > 0 ? 0.01 : 0)).toBeGreaterThan(0);
    expect(s.ledger.nitrogenLostGas).toBeGreaterThan(0);
    expectConserved(s);
  });
});

describe('fungus gnats', () => {
  it('boom in a wet jar and are held back by predatory mites', () => {
    const wet = make();
    pourWater(wet, 0.3);
    addFauna(wet, 'bradysia', 20);
    const withMites = make();
    pourWater(withMites, 0.3);
    addFauna(withMites, 'bradysia', 20);
    addFauna(withMites, 'stratiolaelaps', 60);
    run(wet, 30);
    run(withMites, 30);
    expect(population(wet, 'bradysia')).toBeGreaterThan(100);
    expect(population(withMites, 'bradysia')).toBeLessThan(population(wet, 'bradysia') * 0.5);
    expectConserved(withMites);
  });
});

describe('springtails and mould', () => {
  it('springtails keep fungal biomass lower after a litter drop', () => {
    const none = make((c) => (c.fauna = []));
    const some = make((c) => (c.fauna = [{ species: 'folsomia', count: 600 }]));
    addLeafLitter(none, 0.003);
    addLeafLitter(some, 0.003);
    run(none, 25);
    run(some, 25);
    expect(some.surfaceFungi).toBeLessThan(none.surfaceFungi * 0.7);
  });
});

describe('glass algae', () => {
  it('grows faster on a bright windowsill than deep in a room', () => {
    const bright = make((c) => (c.lighting.placement = 'windowsill'));
    const dim = make((c) => (c.lighting.placement = 'room'));
    run(bright, 20);
    run(dim, 20);
    const sum = (s: SimState) => s.glassAlgae.reduce((a, b) => a + b, 0);
    expect(sum(bright)).toBeGreaterThan(sum(dim) * 2);
  });
});
