import { SECONDS_PER_DAY } from './constants';
import type { SimState } from './types';

export function clock(state: SimState): { day: number; hour: number; dayOfYear: number } {
  const t = state.time + state.config.startHour * 3600;
  const day = Math.floor(t / SECONDS_PER_DAY);
  const hour = (t - day * SECONDS_PER_DAY) / 3600;
  return { day, hour, dayOfYear: ((state.config.startDayOfYear - 1 + day) % 365) + 1 };
}
