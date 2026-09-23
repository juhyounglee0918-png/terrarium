/// <reference lib="webworker" />
import { defaultConfig, MATERIALS } from '../sim/config';
import { readout } from '../sim/diagnostics';
import { balance } from '../sim/ledger';
import { createState, FILM_HOLD_LID, FILM_HOLD_WALL, geometry, mist, pourWater, step, type SimState } from '../sim/model';
import type { Action, FrameData, FromWorker, HistorySample, ToWorker } from './protocol';

const HISTORY_INTERVAL = 600; // s of sim time between chart samples
const TICK_MS = 16;
const BUDGET_MS = 11;

let state: SimState = createState(defaultConfig());
let speed = 60; // sim seconds per real second
let debt = 0; // sim seconds owed
let lastTick = performance.now();
let nextSample = 0;
let pending: HistorySample[] = [];
let stepsThisSecond = 0;
let stepsPerSecond = 0;
let secondMark = performance.now();

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
    },
  });
}

function apply(a: Action): void {
  switch (a.kind) {
    case 'mist':
      mist(state, a.kg);
      break;
    case 'water':
      pourWater(state, a.kg);
      break;
    case 'lid':
      state.config.lid = a.lid;
      break;
    case 'placement':
      state.config.lighting.placement = a.placement;
      break;
    case 'roomTemp':
      state.config.room.meanTemp = a.celsius;
      break;
    case 'reset': {
      const cfg = state.config;
      state = createState({ ...defaultConfig(), lid: cfg.lid, lighting: { ...cfg.lighting }, room: { ...cfg.room } });
      nextSample = 0;
      pending = [];
      break;
    }
  }
}

function frame(): FrameData {
  const g = geometry(state.config);
  const hold = FILM_HOLD_WALL * g.nodeArea;
  const n = state.glassFilm.length;
  const film = new Float32Array(n);
  const gt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    film[i] = Math.min(1, state.glassFilm[i] / hold);
    gt[i] = state.glassT[i];
  }
  const light = state.env.light;
  const b = balance(state);
  const out: FrameData = {
    readout: readout(state),
    lid: state.config.lid,
    placement: state.config.lighting.placement,
    bands: state.config.glassBands,
    sectors: state.config.glassSectors,
    glassFilm: film,
    glassT: gt,
    lidFilm: Math.min(1, state.lid.film / (FILM_HOLD_LID * g.areaTop)),
    sun: {
      elevation: light.sun.elevation,
      azimuth: light.sun.azimuth,
      direct: light.directSW,
      diffuse: light.diffuseSW,
      led: light.ledSW,
    },
    soilDepths: state.soil.map((l) => {
      const m = MATERIALS[l.material];
      return { material: l.material, thickness: l.thickness, saturation: Math.min(1, (l.theta - m.thetaR) / (m.thetaS - m.thetaR)) };
    }),
    jar: { radius: state.config.radius, height: state.config.height },
    newHistory: pending,
    stepsPerSecond,
    balanceError: { water: b.water.error, carbon: b.carbon.error },
  };
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
  // Never let debt grow unbounded when the CPU can't keep up.
  debt = Math.min(debt, speed * 0.5 + dt);
  const start = performance.now();
  while (debt >= dt && performance.now() - start < BUDGET_MS) {
    step(state);
    debt -= dt;
    stepsThisSecond++;
    if (state.time >= nextSample) {
      sample();
      nextSample = state.time + HISTORY_INTERVAL;
    }
  }
  if (now - secondMark > 1000) {
    stepsPerSecond = stepsThisSecond;
    stepsThisSecond = 0;
    secondMark = now;
  }
  const f = frame();
  const msg: FromWorker = { type: 'frame', frame: f };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [f.glassFilm.buffer, f.glassT.buffer]);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'speed') speed = m.simSecondsPerSecond;
  else if (m.type === 'action') apply(m.action);
  else if (m.type === 'advance') advance(m.seconds);
};

sample();
nextSample = HISTORY_INTERVAL;
setInterval(tick, TICK_MS);
