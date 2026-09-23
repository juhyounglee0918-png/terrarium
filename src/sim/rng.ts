/** Deterministic PRNG (mulberry32). State is a single uint32 so it serialises trivially. */
export function nextRandom(state: { seed: number }): number {
  let t = (state.seed = (state.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal via Box–Muller. */
export function nextGaussian(state: { seed: number }): number {
  const u = Math.max(nextRandom(state), 1e-12);
  const v = nextRandom(state);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
