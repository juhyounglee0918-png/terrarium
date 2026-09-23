import { defaultConfig, MATERIALS, type LidType } from './sim/config';
import type { Placement } from './sim/physics/light';
import { createView } from './render/scene';
import { Chart } from './ui/chart';
import type { Action, FrameData, FromWorker, HistorySample, ToWorker } from './worker/protocol';
import SimWorker from './worker/sim.worker?worker';

const cfg = defaultConfig();
const worker = new SimWorker();
const send = (m: ToWorker) => worker.postMessage(m);
const act = (action: Action) => send({ type: 'action', action });

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = createView(canvas, { radius: cfg.radius, height: cfg.height, layers: cfg.layers }, cfg.glassBands, cfg.glassSectors);
window.addEventListener('resize', () => view.resize());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- charts
let history: HistorySample[] = [];
const charts = [
  new Chart($('chart-temp'), {
    title: '온도',
    unit: '°C',
    series: [
      { key: 'airT', label: '공기', color: '#f2a65a' },
      { key: 'glassT', label: '유리', color: '#8fc6e8' },
      { key: 'roomT', label: '실내', color: '#9aa3ad' },
    ],
  }, cfg.startHour),
  new Chart($('chart-hum'), {
    title: '수분',
    unit: '%',
    min: 0,
    max: 100,
    digits: 0,
    series: [
      { key: 'rh', label: '상대습도', color: '#7fd1a8' },
      { key: 'theta', label: '흙 포화도', color: '#6aa7d8' },
    ],
  }, cfg.startHour),
  new Chart($('chart-co2'), {
    title: 'CO₂',
    unit: ' ppm',
    digits: 0,
    series: [{ key: 'co2', label: '병 속', color: '#c9a0f0' }],
  }, cfg.startHour),
];

// ---------------------------------------------------------------- sensors
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const soilBox = $('s-soil');

function renderSensors(f: FrameData): void {
  const r = f.readout;
  const day = r.day + 1;
  const hh = Math.floor(r.hour);
  const mm = Math.floor((r.hour - hh) * 60);
  $('clock-day').textContent = `${day}일차`;
  $('clock-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const sky = r.sunElevation <= 0 ? '밤' : r.cloud > 0.7 ? '흐림' : r.cloud > 0.35 ? '구름 조금' : '맑음';
  $('weather').textContent = `· ${sky}`;

  $('s-airT').textContent = `${fmt(r.airT)} °C`;
  $('s-rh').textContent = `${fmt(r.rh * 100, 0)} %`;
  $('s-dew').textContent = `${fmt(r.dewPoint)} °C`;
  $('s-vpd').textContent = `${fmt(r.vpd, 2)} kPa`;
  $('s-abs').textContent = `${fmt(r.absHumidity)} g/m³`;
  $('s-co2').textContent = `${fmt(r.co2ppm, 0)} ppm`;
  $('s-o2').textContent = `${fmt(r.o2pct, 2)} %`;
  $('s-glass').textContent = r.glassMaxT - r.glassMinT > 0.2 ? `${fmt(r.glassMinT)}–${fmt(r.glassMaxT)} °C` : `${fmt(r.glassMinT)} °C`;
  $('s-fog').textContent = `${fmt(r.fogCoverage * 100, 0)} %`;
  $('s-par').textContent = `${fmt(r.par, 0)} µmol/m²/s`;
  $('s-sun').textContent = `${fmt(r.sunElevation, 0)}°`;
  $('s-room').textContent = `${fmt(r.roomT)} °C`;
  $('s-evap').textContent = `${fmt(r.evaporation, 2)} g/h`;
  $('s-cond').textContent = `${fmt(r.condensation, 2)} g/h`;
  $('s-resp').textContent = `${fmt(r.respiration, 2)} mg C/h`;
  $('s-lw').textContent = `${f.balanceError.water.toExponential(1)} kg`;
  $('s-lc').textContent = `${f.balanceError.carbon.toExponential(1)} kg C`;
  $('s-sps').textContent = `${f.stepsPerSecond} 스텝/초`;

  syncSelect('sel-lid', f.lid);
  syncSelect('sel-place', f.placement);

  const rows = [...r.soil].reverse();
  if (soilBox.childElementCount !== rows.length) {
    soilBox.innerHTML = rows
      .map(() => `<div class="soil-row"><span class="name"></span><span class="bar"><i></i></span><span class="val"></span></div>`)
      .join('');
  }
  rows.forEach((l, i) => {
    const row = soilBox.children[i] as HTMLElement;
    const m = MATERIALS[l.material];
    const sat = Math.max(0, Math.min(1, (l.theta - m.thetaR) / (m.thetaS - m.thetaR)));
    (row.querySelector('.name') as HTMLElement).textContent = l.name.replace(' 배수층', '').replace('피트/코이어 ', '');
    (row.querySelector('.bar i') as HTMLElement).style.width = `${(sat * 100).toFixed(1)}%`;
    const kPa = l.head * 9.80665;
    (row.querySelector('.val') as HTMLElement).textContent = `${fmt(l.theta * 100, 0)}% · ${kPa > -0.05 ? '0' : fmt(kPa, kPa < -10 ? 0 : 1)} kPa`;
    row.title = `체적함수율 ${fmt(l.theta * 100, 1)}%, 수분퍼텐셜 ${fmt(kPa, 2)} kPa, 온도 ${fmt(l.T)} °C`;
  });
}

function syncSelect(id: string, value: string): void {
  const el = $<HTMLSelectElement>(id);
  if (document.activeElement !== el && el.value !== value) el.value = value;
}

// ---------------------------------------------------------------- controls
document.querySelectorAll<HTMLButtonElement>('.speed button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.speed button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    send({ type: 'speed', simSecondsPerSecond: Number(b.dataset.speed) });
  });
});
$('act-mist').addEventListener('click', () => act({ kind: 'mist', kg: 0.01 }));
$('act-water').addEventListener('click', () => act({ kind: 'water', kg: 0.1 }));
$<HTMLSelectElement>('sel-lid').addEventListener('change', (e) => act({ kind: 'lid', lid: (e.target as HTMLSelectElement).value as LidType }));
$<HTMLSelectElement>('sel-place').addEventListener('change', (e) =>
  act({ kind: 'placement', placement: (e.target as HTMLSelectElement).value as Placement }),
);
const roomInput = $<HTMLInputElement>('room-temp');
roomInput.addEventListener('input', () => {
  $('room-out').textContent = `${roomInput.value} °C`;
  act({ kind: 'roomTemp', celsius: Number(roomInput.value) });
});
$('act-reset').addEventListener('click', () => {
  history = [];
  act({ kind: 'newGame', preset: 'tropical' });
});
$('toggle-sensors').addEventListener('click', () => $('sensors').classList.toggle('closed'));
if (window.matchMedia('(max-width: 760px)').matches) $('sensors').classList.add('closed');

// ---------------------------------------------------------------- loop
let latest: FrameData | null = null;
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  if (e.data.type !== 'frame') return;
  latest = e.data.frame;
  if (latest.newHistory.length) {
    if (history.length && latest.newHistory[0].t < history[history.length - 1].t) history = [];
    history.push(...latest.newHistory);
    const cutoff = history[history.length - 1].t - 3 * 86400 - 3600;
    if (history[0].t < cutoff) history = history.filter((s) => s.t >= cutoff);
  }
};

let lastUi = 0;
function loop(now: number): void {
  if (latest) {
    view.update(latest);
    if (now - lastUi > 100) {
      renderSensors(latest);
      charts.forEach((c) => c.draw(history));
      lastUi = now;
    }
  }
  view.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Exposed for debugging and automated screenshots.
(window as unknown as { terrarium: unknown }).terrarium = { send, act };
