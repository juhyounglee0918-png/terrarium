/** Goals the player can pursue; progress is computed from the simulation state. */
import { clock } from './clock';
import { population } from './bio/fauna';
import type { SimState } from './types';

export interface ChallengeStatus {
  id: string;
  title: string;
  description: string;
  progress: number; // 0..1
  done: boolean;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  progress: (s: SimState, day: number) => number;
}

const alivePlants = (s: SimState) => s.plants.filter((p) => p.alive).length;

const CHALLENGES: Challenge[] = [
  {
    id: 'sealed-year',
    title: '밀폐 1년',
    description: '뚜껑을 한 번도 열지 않고 365일 동안 식물을 살려 두기.',
    progress: (s, day) => (s.stats.closedSinceDay < 0 || alivePlants(s) === 0 ? 0 : (day - s.stats.closedSinceDay) / 365),
  },
  {
    id: 'mould-free',
    title: '곰팡이 없는 90일',
    description: '2주 차 이후로 눈에 띄는 곰팡이 없이 90일 연속 유지하기.',
    progress: (s, day) => (day < 14 ? 0 : (day - Math.max(s.stats.mouldySinceDay, 14)) / 90),
  },
  {
    id: 'springtail-boom',
    title: '톡토기 왕국',
    description: '톡토기를 5,000마리 이상으로 늘리기.',
    progress: (s) => population(s, 'folsomia') / 5000,
  },
  {
    id: 'no-deaths-60',
    title: '60일 무사고',
    description: '식물이 한 포기도 죽지 않고 60일 지나기.',
    progress: (s, day) => (s.stats.plantDeaths > 0 ? 0 : day / 60),
  },
  {
    id: 'cool-sill',
    title: '창턱의 여름',
    description: '창턱에 둔 채 병 속 공기가 36 °C를 넘지 않게 30일 버티기.',
    progress: (s, day) => (s.config.lighting.placement !== 'windowsill' || s.stats.maxAirT > 36 ? 0 : day / 30),
  },
];

export function challengeStatus(state: SimState): ChallengeStatus[] {
  const day = clock(state).day;
  const done = new Set(state.stats.completed);
  return CHALLENGES.map((c) => {
    const p = Math.max(0, Math.min(1, c.progress(state, day)));
    if (p >= 1 && !done.has(c.id)) {
      state.stats.completed.push(c.id);
      state.events.push({ day, kind: 'challenge', text: `도전 과제 달성: ${c.title}` });
      done.add(c.id);
    }
    return { id: c.id, title: c.title, description: c.description, progress: done.has(c.id) ? 1 : p, done: done.has(c.id) };
  });
}
