/**
 * Random world events and long-running statistics. Events are drawn from the seeded RNG so a
 * save game replays identically.
 */
import { clock } from './clock';
import { nextRandom } from './rng';
import { seedFauna } from './bio/fauna';
import type { SimState } from './types';

function log(state: SimState, kind: string, text: string): void {
  state.events.push({ day: clock(state).day, kind, text });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}

export function runEvents(state: SimState, dtd: number): void {
  const cfg = state.config;
  const env = state.env;
  const day = clock(state).day;

  // Timers.
  if (env.heatwaveDays > 0) {
    env.heatwaveDays -= dtd;
    if (env.heatwaveDays <= 0) {
      env.heatwave = 0;
      log(state, 'heatwave-end', '폭염이 끝났습니다');
    }
  }
  if (env.outage > 0) {
    env.outage = Math.max(0, env.outage - dtd);
    if (env.outage === 0) log(state, 'outage-end', '전기가 다시 들어왔습니다');
  }

  // Lid bookkeeping for challenges.
  if (cfg.lid !== state.stats.lastLid) {
    if (cfg.lid === 'open') state.stats.closedSinceDay = -1;
    else if (state.stats.lastLid === 'open') state.stats.closedSinceDay = day;
    state.stats.lastLid = cfg.lid;
  }
  const mouldy = state.surface.mould.some((m) => m > 0.35);
  if (mouldy) state.stats.mouldySinceDay = day;

  if (!cfg.events) return;
  const r = () => nextRandom(state.rng);

  // Summer heatwave: the room warms by several degrees for a few days.
  const doy = clock(state).dayOfYear;
  const summer = doy > 160 && doy < 250 ? 1 : 0.15;
  if (env.heatwaveDays <= 0 && r() < (dtd / 90) * summer) {
    env.heatwave = 4 + r() * 4;
    env.heatwaveDays = 2 + r() * 4;
    log(state, 'heatwave', `폭염: 실내 온도가 ${env.heatwave.toFixed(1)} °C 올라갑니다`);
  }
  // Power cut (only matters under grow lights).
  if (cfg.lighting.placement === 'ledShelf' && env.outage <= 0 && r() < dtd / 150) {
    env.outage = 0.5 + r() * 2;
    log(state, 'outage', '정전: LED가 꺼졌습니다');
  }
  // With the lid off, fungus gnats from houseplants can fly in; spores drift in too.
  if (cfg.lid === 'open') {
    if (r() < dtd * 0.04) {
      seedFauna(state, [{ species: 'bradysia', count: 2 + Math.floor(r() * 4) }], true);
      log(state, 'gnats', '뚜껑이 열린 틈에 버섯파리가 날아 들어왔습니다');
    }
    const top = state.soil[state.soil.length - 1];
    const spores = 2e-8 * dtd;
    top.fung += spores;
    top.slime += spores * 0.1;
    state.ledger.carbonImported += spores * 1.1;
    state.ledger.nitrogenImported += spores / 12 + (spores * 0.1) / 8;
  }
}
