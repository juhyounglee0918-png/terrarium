import { totalCarbon, totalWater, type SimState } from './model';

export interface Balance {
  water: { stored: number; expected: number; error: number };
  carbon: { stored: number; expected: number; error: number };
}

/** Conservation check: stored = initial + added − vented, for water (kg) and carbon (kg C). */
export function balance(state: SimState): Balance {
  const l = state.ledger;
  const w = totalWater(state);
  const wExp = l.waterInitial + l.waterAdded - l.waterVentedNet;
  const c = totalCarbon(state);
  const cExp = l.carbonInitial - l.carbonVentedNet;
  return {
    water: { stored: w, expected: wExp, error: w - wExp },
    carbon: { stored: c, expected: cExp, error: c - cExp },
  };
}
