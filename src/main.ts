import { MATERIALS, type LidType } from './sim/config';
import { SPECIES } from './sim/bio/params';
import type { Placement } from './sim/physics/light';
import { PRESETS } from './sim/presets';
import { createView } from './render/scene';
import { Chart } from './ui/chart';
import type { Action, FrameData, FromWorker, HistorySample, ToWorker } from './worker/protocol';
import SimWorker from './worker/sim.worker?worker&inline';

const worker = new SimWorker();
const send = (m: ToWorker) => worker.postMessage(m);
const act = (action: Action) => send({ type: 'action', action });

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = createView(canvas);
window.addEventListener('resize', () => view.resize());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------- charts
let history: HistorySample[] = [];
let startHour = 6;
const hourOf = () => startHour;
const charts = [
  new Chart($('chart-temp'), {
    title: '온도',
    unit: '°C',
    series: [
      { key: 'airT', label: '공기', color: '#f2a65a' },
      { key: 'glassT', label: '유리', color: '#8fc6e8' },
      { key: 'roomT', label: '실내', color: '#9aa3ad' },
    ],
  }, hourOf),
  new Chart($('chart-hum'), {
    title: '수분',
    unit: '%',
    min: 0,
    max: 100,
    digits: 0,
    series: [
      { key: 'rh', label: '습도', color: '#7fd1a8' },
      { key: 'theta', label: '흙', color: '#6aa7d8' },
    ],
  }, hourOf),
  new Chart($('chart-co2'), { title: 'CO₂', unit: ' ppm', digits: 0, series: [{ key: 'co2', label: '병 속', color: '#c9a0f0' }] }, hourOf),
  new Chart($('chart-life'), {
    title: '생물',
    unit: '',
    digits: 0,
    series: [
      { key: 'springtails', label: '톡토기', color: '#e8e4d8' },
      { key: 'mould', label: '곰팡이%×50', color: '#9fd0c0', scale: 50 },
    ],
  }, hourOf),
];

// ---------------------------------------------------------------- tabs
let tab = 'sensors';
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    const side = $('side');
    if (b.dataset.tab === tab && narrow()) {
      side.classList.toggle('closed');
      return;
    }
    side.classList.remove('closed');
    tab = b.dataset.tab!;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('.tab-body').forEach((el) => (el.hidden = el.dataset.body !== tab));
  }),
);
if (narrow()) $('side').classList.add('closed');

// ---------------------------------------------------------------- sensors
const soilBox = $('s-soil');
function renderSensors(f: FrameData): void {
  const r = f.readout;
  const hh = Math.floor(r.hour);
  const mm = Math.floor((r.hour - hh) * 60);
  $('clock-day').textContent = `${r.day + 1}일차`;
  $('clock-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const sky = r.sunElevation <= 0 ? '밤' : r.cloud > 0.7 ? '흐림' : r.cloud > 0.35 ? '구름 조금' : '맑음';
  $('weather').textContent = `· ${sky}`;
  $('preset-name').textContent = PRESETS.find((p) => p.id === f.preset)?.name ?? '';
  if (tab !== 'sensors') return;
  $('s-airT').textContent = `${fmt(r.airT)} °C`;
  $('s-rh').textContent = `${fmt(r.rh * 100, 0)} %`;
  $('s-dew').textContent = `${fmt(r.dewPoint)} °C`;
  $('s-vpd').textContent = `${fmt(r.vpd, 2)} kPa`;
  $('s-co2').textContent = `${fmt(r.co2ppm, 0)} ppm`;
  $('s-o2').textContent = `${fmt(r.o2pct, 2)} %`;
  $('s-ch4').textContent = `${fmt(r.ch4ppm, 1)} ppm`;
  $('s-glass').textContent = r.glassMaxT - r.glassMinT > 0.2 ? `${fmt(r.glassMinT)}–${fmt(r.glassMaxT)} °C` : `${fmt(r.glassMinT)} °C`;
  $('s-fog').textContent = `${fmt(r.fogCoverage * 100, 0)} %`;
  $('s-par').textContent = `${fmt(r.par, 0)} µmol/m²/s`;
  $('s-room').textContent = `${fmt(r.roomT)} °C`;
  $('s-n').textContent = `${fmt(r.nh4, 1)} / ${fmt(r.no3, 1)} mg/L`;
  $('s-microbes').textContent = `${fmt(r.bacteria, 2)} / ${fmt(r.fungi, 2)} g C`;
  $('s-photo').textContent = `${fmt(r.photosynthesis, 2)} mg C/h`;
  $('s-resp').textContent = `${fmt(r.respiration, 2)} mg C/h`;
  $('s-evap').textContent = `${fmt(r.evaporation, 2)} / ${fmt(r.transpiration, 2)} g/h`;
  $('s-cond').textContent = `${fmt(r.condensation, 2)} g/h`;
  const b = f.balanceError;
  $('s-ledger').textContent = `${b.water.toExponential(0)} · ${b.carbon.toExponential(0)} · ${b.nitrogen.toExponential(0)} kg`;
  $('s-sps').textContent = `${f.stepsPerSecond} 스텝/초`;

  const rows = [...r.soil].reverse();
  if (soilBox.childElementCount !== rows.length) {
    soilBox.innerHTML = rows.map(() => `<div class="soil-row"><span class="name"></span><span class="bar"><i></i></span><span class="val"></span></div>`).join('');
  }
  const redox = [...f.scene.soil].reverse();
  rows.forEach((l, i) => {
    const row = soilBox.children[i] as HTMLElement;
    const m = MATERIALS[l.material];
    const sat = Math.max(0, Math.min(1, (l.theta - m.thetaR) / (m.thetaS - m.thetaR)));
    const smell = redox[i].redox >= 3 ? ' · H₂S' : redox[i].redox >= 1 ? ' · 무산소' : '';
    (row.querySelector('.name') as HTMLElement).textContent = l.name.replace(' 배수층', '').replace('피트/코이어 ', '').replace(' (건조형)', '');
    (row.querySelector('.bar i') as HTMLElement).style.width = `${(sat * 100).toFixed(1)}%`;
    const kPa = l.head * 9.80665;
    (row.querySelector('.val') as HTMLElement).textContent = `${fmt(l.theta * 100, 0)}% · ${kPa > -0.05 ? '0' : fmt(kPa, kPa < -10 ? 0 : 1)} kPa${smell}`;
  });
}

// ---------------------------------------------------------------- life tab
const meter = (v: number) => {
  const cls = v < 0.3 ? 'bad' : v < 0.6 ? 'warn' : '';
  return `<span class="meter ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></span>`;
};
function renderLife(f: FrameData): void {
  if (tab !== 'life') return;
  const v = f.scene;
  $('life-plants').innerHTML = v.plants.length
    ? v.plants
        .map(
          (p) => `<div class="row"><span class="title">${esc(p.name)}</span><span><button class="mini" data-prune="${p.id}" title="잎·줄기 40% 잘라내기">✂</button> <button class="mini" data-remove="${p.id}" title="뽑기">✕</button></span>
      <span class="sub">잎 ${fmt(p.leafArea * 1e4, 0)} cm² · 키 ${fmt(p.height * 100, 1)} cm · 빛 ${fmt(p.parLeaf, 0)} µmol${p.rootDamage > 0.05 ? ` · 뿌리썩음 ${fmt(p.rootDamage * 100, 0)}%` : ''}</span>
      <span class="bars" title="건강 · 수분 · 질소">${meter(p.health)}${meter(p.water)}${meter(1 - p.chlorosis)}</span></div>`,
        )
        .join('')
    : '<p class="muted">살아 있는 식물이 없습니다.</p>';
  const fauna: string[] = [];
  for (const c of v.cohorts) {
    if (c.total < 0.5) continue;
    fauna.push(`<div class="row"><span class="title">${esc(c.name)}</span><span>${Math.round(c.total).toLocaleString()}</span><span class="sub">${c.stages.map((s) => `${s.name} ${Math.round(s.n).toLocaleString()}`).join(' · ')}</span></div>`);
  }
  const counts = new Map<string, number>();
  for (const a of v.agents) counts.set(a.species, (counts.get(a.species) ?? 0) + 1);
  for (const [sp, n] of counts) fauna.push(`<div class="row"><span class="title">${esc(SPECIES[sp]?.name ?? sp)}</span><span>${n}</span></div>`);
  $('life-fauna').innerHTML = fauna.join('') || '<p class="muted">동물이 없습니다.</p>';
  $('life-moss').textContent = `${fmt(f.readout.mossCover * 100, 0)} %`;
  $('life-mould').textContent = `${fmt(f.readout.mouldCover * 100, 0)} %`;
  $('life-litter').textContent = `${fmt(f.readout.litter, 2)} g C`;
}
$('life-plants').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.prune) act({ kind: 'prune', id: Number(t.dataset.prune) });
  if (t.dataset.remove) act({ kind: 'removePlant', id: Number(t.dataset.remove) });
});

// ---------------------------------------------------------------- goals + log
const logItems: string[] = [];
function renderGoals(f: FrameData): void {
  for (const e of f.newEvents) {
    logItems.unshift(`${e.day + 1}일차 · ${e.text}`);
    toast(e.text);
  }
  if (logItems.length > 80) logItems.length = 80;
  if (tab !== 'goals') return;
  $('goals').innerHTML = f.challenges
    .map((c) => `<div class="row"><span class="title">${c.done ? '✅ ' : ''}${esc(c.title)}</span><span>${Math.round(c.progress * 100)}%</span><span class="sub">${esc(c.description)}</span><span class="bars" style="grid-template-columns:1fr">${meter(c.progress)}</span></div>`)
    .join('');
  $('log').innerHTML = logItems.map((t) => `<li>${esc(t)}</li>`).join('');
}

// ---------------------------------------------------------------- encyclopedia
$('dex').innerHTML = Object.values(SPECIES)
  .map(
    (s) => `<div class="dex-item"><b>${esc(s.name)}</b> <span class="chip ${s.confidence}">${s.confidence}</span><div class="latin">${esc(s.latin)}</div>
    <p>${esc(s.facts)}</p>${s.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join('<br>')}</div>`,
  )
  .join('');

// ---------------------------------------------------------------- advice + toasts
let lastAdvice = '';
function renderAdvice(f: FrameData): void {
  const key = f.advice.map((a) => a.title + a.why).join('|');
  if (key === lastAdvice) return;
  lastAdvice = key;
  const box = $('advice');
  box.classList.toggle('has', f.advice.length > 0);
  box.innerHTML = f.advice
    .slice(0, 3)
    .map((a) => `<div class="card ${a.level}"><b>${esc(a.title)}</b><span>${esc(a.why)}</span>${a.fix ? `<em>→ ${esc(a.fix)}</em>` : ''}</div>`)
    .join('');
}
function toast(text: string): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 5200);
  while (box.childElementCount > 3) box.firstElementChild!.remove();
}

// ---------------------------------------------------------------- controls
document.querySelectorAll<HTMLButtonElement>('.speed button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.speed button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    send({ type: 'speed', simSecondsPerSecond: Number(b.dataset.speed) });
  }),
);
$('act-mist').addEventListener('click', () => act({ kind: 'mist', kg: 0.01 }));
$('act-water').addEventListener('click', () => act({ kind: 'water', kg: 0.1 }));
$<HTMLSelectElement>('sel-lid').addEventListener('change', (e) => act({ kind: 'lid', lid: (e.target as HTMLSelectElement).value as LidType }));
$<HTMLSelectElement>('sel-place').addEventListener('change', (e) => act({ kind: 'placement', placement: (e.target as HTMLSelectElement).value as Placement }));
const roomInput = $<HTMLInputElement>('room-temp');
roomInput.addEventListener('input', () => {
  $('room-out').textContent = `${roomInput.value} °C`;
  act({ kind: 'roomTemp', celsius: Number(roomInput.value) });
});
function syncSelect(id: string, value: string): void {
  const el = $<HTMLSelectElement>(id);
  if (document.activeElement !== el && el.value !== value) el.value = value;
}

let macro = false;
$('act-macro').addEventListener('click', () => {
  macro = !macro;
  $('act-macro').classList.toggle('on', macro);
  view.setMacro(macro);
});

// Pointer modes: planting a species or pruning by clicking in the jar.
type Mode = { kind: 'plant'; species: string } | { kind: 'prune' } | null;
let mode: Mode = null;
function setMode(m: Mode): void {
  mode = m;
  const hint = $('mode-hint');
  hint.hidden = !m;
  if (m?.kind === 'plant') hint.textContent = `${SPECIES[m.species].name}: 흙 위를 클릭해 심기 (Esc 취소)`;
  if (m?.kind === 'prune') hint.textContent = '가지치기: 식물을 클릭 (Esc 취소)';
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setMode(null);
    closePopover();
  }
});
let downAt = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!mode || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const hit = view.pick(e.clientX, e.clientY);
  if (!hit) return;
  if (mode.kind === 'plant') {
    act({ kind: 'addPlant', species: mode.species, x: hit.x, z: hit.z });
    setMode(null);
  } else if (mode.kind === 'prune' && hit.plantId !== undefined) {
    act({ kind: 'prune', id: hit.plantId });
  }
});

// Popovers.
const pop = $('popover');
function openPopover(html: string, onClick: (el: HTMLElement) => void): void {
  pop.innerHTML = html;
  pop.hidden = false;
  pop.onclick = (e) => {
    const el = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (el) onClick(el);
  };
}
function closePopover(): void {
  pop.hidden = true;
}
const speciesButtons = (kind: string, extra: (id: string) => string = () => '') =>
  Object.values(SPECIES)
    .filter((s) => s.sim?.kind === kind)
    .map((s) => `<button data-${kind}="${s.id}">${esc(s.name)}<small>${esc(s.latin)}${extra(s.id)}</small></button>`)
    .join('');
const COHORT_COUNT: Record<string, number> = { folsomia: 200, trichorhina: 20, stratiolaelaps: 50, bradysia: 10, scatella: 10 };

$('menu-add').addEventListener('click', () => {
  if (!pop.hidden) return closePopover();
  openPopover(
    `<h4>식물 심기</h4><div class="grid">${speciesButtons('vascular')}</div>
     <h4>동물 넣기</h4><div class="grid">${speciesButtons('cohort', (id) => ` · ${COHORT_COUNT[id] ?? 20}마리`)}${speciesButtons('agent', () => ' · 2마리')}</div>
     <h4>이끼·재료</h4><div class="grid">${speciesButtons('moss')}
       <button data-item="litter">낙엽 한 줌<small>분해·질소 순환의 연료</small></button>
       <button data-item="fertilize">묽은 비료<small>질소 20 mg</small></button>
       <button data-item="calcium">갑오징어뼈<small>달팽이·노래기 칼슘</small></button></div>`,
    (el) => {
      if (el.dataset.vascular) setMode({ kind: 'plant', species: el.dataset.vascular });
      else if (el.dataset.cohort) act({ kind: 'addFauna', species: el.dataset.cohort, count: COHORT_COUNT[el.dataset.cohort] ?? 20 });
      else if (el.dataset.agent) act({ kind: 'addFauna', species: el.dataset.agent, count: 2 });
      else if (el.dataset.moss) act({ kind: 'addMoss', species: el.dataset.moss });
      else if (el.dataset.item === 'litter') act({ kind: 'addLitter' });
      else if (el.dataset.item === 'fertilize') act({ kind: 'fertilize' });
      else if (el.dataset.item === 'calcium') act({ kind: 'calcium' });
      closePopover();
    },
  );
});

let highQuality = true;
$('menu-care').addEventListener('click', () => {
  if (!pop.hidden) return closePopover();
  openPopover(
    `<h4>관리</h4><div class="grid">
      <button data-care="prune">✂ 가지치기<small>식물을 클릭해 40% 잘라내기</small></button>
      <button data-care="mould">곰팡이 걷어내기<small>면봉으로 표면 균사 제거</small></button>
      <button data-care="wipe">유리 닦기<small>물방울·녹조를 흙으로</small></button>
      <button data-care="quality">고화질 전환<small>블룸·비네트 켜기/끄기</small></button></div>`,
    (el) => {
      const c = el.dataset.care;
      if (c === 'prune') setMode({ kind: 'prune' });
      if (c === 'mould') act({ kind: 'removeMould' });
      if (c === 'wipe') act({ kind: 'wipeGlass' });
      if (c === 'quality') {
        highQuality = !highQuality;
        view.setQuality(highQuality);
        toast(highQuality ? '고화질 켜짐' : '고화질 꺼짐');
      }
      closePopover();
    },
  );
});

let pendingSave: 'local' | 'file' | null = null;
$('menu-game').addEventListener('click', () => {
  if (!pop.hidden) return closePopover();
  openPopover(
    `<h4>새 테라리움</h4>${PRESETS.map((p) => `<button class="preset" data-preset="${p.id}">${esc(p.name)}<small>${esc(p.description)}</small></button>`).join('')}
     <h4>저장</h4><div class="grid">
      <button data-io="save">브라우저에 저장</button><button data-io="load">불러오기</button>
      <button data-io="export">파일로 내보내기</button><button data-io="import">파일 불러오기</button></div>`,
    (el) => {
      if (el.dataset.preset) {
        history = [];
        logItems.length = 0;
        act({ kind: 'newGame', preset: el.dataset.preset });
      }
      if (el.dataset.io === 'save' || el.dataset.io === 'export') {
        pendingSave = el.dataset.io === 'save' ? 'local' : 'file';
        send({ type: 'save' });
      }
      if (el.dataset.io === 'load') {
        try {
          const json = localStorage.getItem('terrarium-save');
          if (json) {
            history = [];
            send({ type: 'load', json });
            toast('불러왔습니다');
          } else toast('저장된 게임이 없습니다');
        } catch {
          toast('브라우저 저장소를 쓸 수 없습니다');
        }
      }
      if (el.dataset.io === 'import') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          history = [];
          send({ type: 'load', json: await file.text() });
        };
        input.click();
      }
      closePopover();
    },
  );
});

// Timelapse recording of the canvas.
let recorder: MediaRecorder | null = null;
$('act-rec').addEventListener('click', () => {
  if (recorder) {
    recorder.stop();
    return;
  }
  if (!('MediaRecorder' in window)) return toast('이 브라우저는 녹화를 지원하지 않습니다');
  const chunks: Blob[] = [];
  const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    download(new Blob(chunks, { type: 'video/webm' }), 'terrarium-timelapse.webm');
    recorder = null;
    $('act-rec').classList.remove('on');
    $('act-rec').textContent = '⏺ 녹화';
  };
  recorder.start();
  $('act-rec').classList.add('on');
  $('act-rec').textContent = '⏹ 정지';
  toast('타임랩스 녹화 중: 속도를 올려 보세요');
});

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- loop
let latest: FrameData | null = null;
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  if (m.type === 'error') {
    toast(`오류: ${m.message}`);
    return;
  }
  if (m.type === 'saved') {
    if (pendingSave === 'local') {
      try {
        localStorage.setItem('terrarium-save', m.json);
        toast('저장했습니다');
      } catch {
        toast('브라우저 저장소를 쓸 수 없어 파일로 내보냅니다');
        download(new Blob([m.json], { type: 'application/json' }), 'terrarium-save.json');
      }
    } else download(new Blob([m.json], { type: 'application/json' }), 'terrarium-save.json');
    pendingSave = null;
    return;
  }
  latest = m.frame;
  startHour = latest.startHour;
  if (latest.newHistory.length) {
    if (history.length && latest.newHistory[0].t < history[history.length - 1].t) history = [];
    history.push(...latest.newHistory);
    const cutoff = history[history.length - 1].t - 3 * 86400 - 3600;
    if (history[0].t < cutoff) history = history.filter((s) => s.t >= cutoff);
  }
  renderGoals(latest);
};

let lastUi = 0;
let lastT = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (latest) {
    view.update(latest);
    if (now - lastUi > 150) {
      renderSensors(latest);
      renderLife(latest);
      renderAdvice(latest);
      syncSelect('sel-lid', latest.lid);
      syncSelect('sel-place', latest.placement);
      charts.forEach((c) => c.draw(history));
      lastUi = now;
    }
  }
  view.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Exposed for debugging and automated screenshots.
(window as unknown as { terrarium: unknown }).terrarium = {
  send,
  act,
  view,
  setTab: (t: string) => (document.querySelector(`.tabs button[data-tab="${t}"]`) as HTMLButtonElement | null)?.click(),
};
