import { totalCarbon, totalNitrogen, totalWater, type SimState } from './model';

export interface Balance {
  water: { stored: number; expected: number; error: number };
  carbon: { stored: number; expected: number; error: number };
  nitrogen: { stored: number; expected: number; error: number };
}

/** Conservation check: stored = initial + imported − exported − vented/lost, for water, C and N. */
export function balance(state: SimState): Balance {
  const l = state.ledger;
  const w = totalWater(state);
  const wExp = l.waterInitial + l.waterAdded - l.waterVentedNet;
  const c = totalCarbon(state);
  const cExp = l.carbonInitial + l.carbonImported - l.carbonExported - l.carbonVentedNet;
  const n = totalNitrogen(state);
  const nExp = l.nitrogenInitial + l.nitrogenImported - l.nitrogenExported - l.nitrogenLostGas;
  return {
    water: { stored: w, expected: wExp, error: w - wExp },
    carbon: { stored: c, expected: cExp, error: c - cExp },
    nitrogen: { stored: n, expected: nExp, error: n - nExp },
  };
}
