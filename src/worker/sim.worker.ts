/// <reference lib="webworker" />
import * as A from '../sim/actions';
import { advise } from '../sim/advisor';
import { challengeStatus } from '../sim/challenges';
import { MATERIALS } from '../sim/config';
import { readout } from '../sim/diagnostics';
import { population } from '../sim/bio/fauna';
import { balance } from '../sim/ledger';
import { createState, step, type SimState } from '../sim/model';
import { presetConfig } from '../sim/presets';
import { sceneView } from '../sim/snapshot';
import type { Action, FrameData, FromWorker, HistorySample, ToWorker } from './protocol';

const HISTORY_INTERVAL = 600; // s of sim time between chart samples
const TICK_MS = 16;
const BUDGET_MS = 11;
const SAVE_VERSION = 2;

let preset = 'tropical';
let state: SimState = createState(presetConfig(preset));
let speed = 60; // sim seconds per real second
let debt = 0; // sim seconds owed
let lastTick = performance.now();
let nextSample = 0;
let pending: HistorySample[] = [];
let eventCursor = 0;
let stepsThisSecond = 0;
let stepsPerSecond = 0;
let secondMark = performance.now();
let slowTick = 0;
let cachedAdvice: FrameData['advice'] = [];
let cachedChallenges: FrameData['challenges'] = [];

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function sample(): void {
  const r = readout(state);
  const sub = state.soil[state.soil.length - 1];
  pending.push({
    t: state.time,
    values: {
      airT: r.airT,
      roomT: r.roomT,
      glassT: state.glassT.reduce((a, b) => a + b, 0) / state.glassT.length,
      rh: r.rh * 100,
      co2: r.co2ppm,
      par: r.par,
      theta: (sub.theta / MATERIALS[sub.material].thetaS) * 100,
      springtails: population(state, 'folsomia'),
      mould: r.mouldCover * 100,
    },
  });
}

function reset(): void {
  nextSample = 0;
  pending = [];
  eventCursor = state.events.length;
}

function apply(a: Action): void {
  const r = state.config.radius;
  switch (a.kind) {
    case 'mist':
      return A.mist(state, a.kg);
    case 'water':
      return A.pourWater(state, a.kg);
    case 'lid':
      return A.setLid(state, a.lid);
    case 'placement':
      return A.setPlacement(state, a.placement);
    case 'roomTemp':
      return A.setRoomTemp(state, a.celsius);
    case 'addPlant':
      A.addPlant(state, a.species, Math.max(-r, Math.min(r, a.x)), Math.max(-r, Math.min(r, a.z)));
      return;
    case 'prune':
      return A.prunePlant(state, a.id);
    case 'removePlant':
      return A.removePlant(state, a.id);
    case 'addFauna':
      return A.addFauna(state, a.species, a.count);
    case 'addMoss':
      return A.addMoss(state, a.species, 0.1);
    case 'addLitter':
      return A.addLeafLitter(state, 0.0008);
    case 'removeMould':
      return A.removeMould(state);
    case 'fertilize':
      return A.fertilize(state, 0.02);
    case 'calcium':
      return A.addCalcium(state);
    case 'wipeGlass':
      return A.wipeGlass(state);
    case 'newGame':
      preset = a.preset;
      state = createState(presetConfig(preset));
      reset();
      return;
  }
}

function frame(): FrameData {
  const light = state.env.light;
  const b = balance(state);
  const r = readout(state);
  if (slowTick++ % 15 === 0) {
    cachedAdvice = advise(state, r);
    cachedChallenges = challengeStatus(state);
  }
  const out: FrameData = {
    readout: r,
    scene: sceneView(state),
    lid: state.config.lid,
    placement: state.config.lighting.placement,
    preset,
    sun: { elevation: light.sun.elevation, azimuth: light.sun.azimuth, direct: light.directSW, diffuse: light.diffuseSW, led: light.ledSW },
    newHistory: pending,
    newEvents: state.events.slice(Math.min(eventCursor, state.events.length)),
    advice: cachedAdvice,
    challenges: cachedChallenges,
    stepsPerSecond,
    balanceError: { water: b.water.error, carbon: b.carbon.error, nitrogen: b.nitrogen.error },
    startHour: state.config.startHour,
  };
  eventCursor = state.events.length;
  pending = [];
  return out;
}

function advance(seconds: number): void {
  const n = Math.round(seconds / state.config.dt);
  for (let i = 0; i < n; i++) {
    step(state);
    if (state.time >= nextSample) {
      sample();
      nextSample = state.time + HISTORY_INTERVAL;
    }
  }
}

function tick(): void {
  const now = performance.now();
  const elapsed = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  const dt = state.config.dt;
  debt += elapsed * speed;
  debt = Math.min(debt, speed * 0.5 + dt);
  const start = performance.now();
  try {
    while (debt >= dt && performance.now() - start < BUDGET_MS) {
      step(state);
      debt -= dt;
      stepsThisSecond++;
      if (state.time >= nextSample) {
        sample();
        nextSample = state.time + HISTORY_INTERVAL;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String(e) });
    speed = 0;
  }
  if (now - secondMark > 1000) {
    stepsPerSecond = stepsThisSecond;
    stepsThisSecond = 0;
    secondMark = now;
  }
  post({ type: 'frame', frame: frame() });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'speed') speed = m.simSecondsPerSecond;
  else if (m.type === 'action') apply(m.action);
  else if (m.type === 'advance') advance(m.seconds);
  else if (m.type === 'save') post({ type: 'saved', json: JSON.stringify({ version: SAVE_VERSION, preset, state }) });
  else if (m.type === 'load') {
    try {
      const data = JSON.parse(m.json);
      if (data.version !== SAVE_VERSION) throw new Error('저장 파일 버전이 다릅니다');
      state = data.state as SimState;
      preset = data.preset ?? 'tropical';
      reset();
    } catch (err) {
      post({ type: 'error', message: String(err) });
    }
  }
};

sample();
nextSample = HISTORY_INTERVAL;
setInterval(tick, TICK_MS);
