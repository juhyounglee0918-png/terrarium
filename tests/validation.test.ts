import { describe, expect, it } from 'vitest';
import { challengeStatus } from '../src/sim/challenges';
import { advise } from '../src/sim/advisor';
import { readout } from '../src/sim/diagnostics';
import { balance } from '../src/sim/ledger';
import { createState, roomTemperature, step, type SimState } from '../src/sim/model';
import { PRESETS, presetConfig } from '../src/sim/presets';

function run(s: SimState, days: number): void {
  for (let i = 0; i < days * 1440; i++) step(s);
}

function quiet(id: string) {
  const c = presetConfig(id);
  c.events = false;
  return c;
}

describe('every preset', () => {
  for (const p of PRESETS) {
    it(`${p.id}: runs 30 days, stays finite and conserves water, carbon and nitrogen`, () => {
      const s = createState(quiet(p.id));
      run(s, 30);
      const r = readout(s);
      expect(Number.isFinite(r.co2ppm)).toBe(true);
      for (const l of s.soil) expect(l.theta).toBeGreaterThan(0);
      const b = balance(s);
      expect(Math.abs(b.water.error)).toBeLessThan(1e-9);
      expect(Math.abs(b.carbon.error)).toBeLessThan(1e-10);
      expect(Math.abs(b.nitrogen.error)).toBeLessThan(1e-11);
      expect(() => advise(s, r)).not.toThrow();
      expect(challengeStatus(s).length).toBeGreaterThan(0);
    });
  }
});

describe('succulents in the arid build', () => {
  it('Haworthia survives 40 days without watering', () => {
    const s = createState(quiet('arid'));
    run(s, 40);
    expect(s.plants.filter((p) => p.alive).length).toBe(3);
  });
});

describe("Latimer's sealed bottle", () => {
  it('the spiderwort lives on for two months without any exchange', () => {
    const s = createState(quiet('latimer'));
    run(s, 60);
    expect(s.plants.some((p) => p.alive && p.species === 'tradescantia' && p.health > 0.8)).toBe(true);
  });
});

describe('determinism and save games', () => {
  it('a state restored from JSON evolves exactly like the original', () => {
    const a = createState(quiet('bioactive'));
    run(a, 3);
    const b = JSON.parse(JSON.stringify(a)) as SimState;
    run(a, 2);
    run(b, 2);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('seasons', () => {
  it('the room is cooler in winter than in summer', () => {
    const c = quiet('tropical');
    expect(roomTemperature(c, 14, 15)).toBeLessThan(roomTemperature(c, 14, 200) - 3);
  });
});
