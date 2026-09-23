import { describe, expect, it } from 'vitest';
import species from '../src/data/species.json';

describe('species data', () => {
  it('every organism has id, name, model, milestone, confidence and unique id', () => {
    const ids = new Set<string>();
    for (const o of species.organisms) {
      expect(o.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(o.id)).toBe(false);
      ids.add(o.id);
      expect(o.name.length).toBeGreaterThan(0);
      expect(['mat', 'individual', 'agent', 'cohort', 'pool', 'surface']).toContain(o.model);
      expect(o.milestone).toMatch(/^M\d$/);
      expect(['high', 'medium', 'low']).toContain(o.confidence);
      if (o.confidence !== 'low') expect(o.sources.length).toBeGreaterThan(0);
    }
  });
});
