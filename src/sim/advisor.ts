/**
 * "Why is this happening?" — rule-based explanations that trace visible problems back to the
 * simulated causes, with the realistic remedy.
 */
import { MATERIALS } from './config';
import type { Readout } from './diagnostics';
import { population } from './bio/fauna';
import { plantParams, SPECIES } from './bio/params';
import { rootZoneHead } from './bio/plants';
import type { SimState } from './types';

export interface Advice {
  level: 'info' | 'warn' | 'bad';
  title: string;
  why: string;
  fix?: string;
}

export function advise(state: SimState, r: Readout): Advice[] {
  const out: Advice[] = [];
  const top = state.soil[state.soil.length - 1];
  const psi = rootZoneHead(state) * 9.80665; // kPa
  const springtails = population(state, 'folsomia');
  const gnats = population(state, 'bradysia');

  if (r.mouldCover > 0.15) {
    out.push({
      level: 'warn',
      title: '곰팡이가 번지고 있어요',
      why: `습도 ${(r.rh * 100).toFixed(0)}%, 표면 낙엽 ${r.litter.toFixed(1)} g C, 톡토기 ${Math.round(springtails)}마리. 표면 곰팡이는 습한 공기(80% 이상)에서 신선한 유기물을 먹고 자랍니다.`,
      fix: springtails < 1000 ? '톡토기를 넣으면 균사를 뜯어먹어 억제합니다. 뚜껑을 잠시 열어 습도를 낮춰도 됩니다.' : '톡토기가 늘어나는 중이니 며칠 지켜보거나 면봉으로 걷어내세요.',
    });
  }
  if (r.co2ppm < 150 && r.par > 30) {
    out.push({
      level: 'info',
      title: 'CO₂가 바닥났어요',
      why: `병 속 CO₂ ${r.co2ppm.toFixed(0)} ppm. 광합성이 CO₂ 보상점(약 40 ppm) 근처까지 끌어내려 성장이 제한됩니다. 밀폐 병에서 한낮에 흔한 현상입니다.`,
      fix: '밤사이 흙 호흡이 다시 채웁니다. 성장을 원하면 하루 몇 분 뚜껑을 열어 환기하세요.',
    });
  }
  if (r.redoxMax >= 3) {
    out.push({
      level: 'bad',
      title: '배수층이 썩고 있어요 (H₂S)',
      why: `공기가 통하지 않는 물 고인 층에서 산소 → 질산 → 철 → 황산염 순으로 소모되어 황산염환원균이 황화수소를 만듭니다.${r.redoxMax >= 4 ? ' 메탄 생성까지 진행됐습니다.' : ''}`,
      fix: '물 주기를 멈추고 뚜껑을 열어 말리세요. 심하면 배수층 물을 빼야 합니다.',
    });
  }
  const wilting = state.plants.filter((p) => p.alive && p.wilt > 0.4);
  if (wilting.length) {
    const p = wilting[0];
    const pp = plantParams(p.species);
    out.push({
      level: 'warn',
      title: `${SPECIES[p.species].name}가 시들어요`,
      why:
        p.rootDamage > 0.3
          ? `뿌리의 ${(p.rootDamage * 100).toFixed(0)}%가 썩어(Pythium) 물을 빨아올리지 못합니다. 흙은 젖어 있어도 식물은 목마릅니다.`
          : `뿌리 주변 수분퍼텐셜 ${psi.toFixed(0)} kPa. 기공이 닫히는 한계는 약 ${(pp.psiClose * 9.8).toFixed(0)} kPa입니다.`,
      fix: p.rootDamage > 0.3 ? '과습을 해소하세요. 물을 더 주면 악화됩니다.' : '물을 주세요. 피토니아처럼 예민한 종은 몇 시간 만에 회복합니다.',
    });
  }
  const yellow = state.plants.filter((p) => p.alive && p.chlorosis > 0.4);
  if (yellow.length) {
    out.push({
      level: 'warn',
      title: '잎이 노래져요 (질소 결핍)',
      why: `흙 용액의 질소 NH₄⁺ ${r.nh4.toFixed(1)} · NO₃⁻ ${r.no3.toFixed(1)} mg/L. 닫힌 병에서는 질소가 식물체와 부식에 묶여 순환이 느려집니다.`,
      fix: '낙엽을 조금 넣어 분해 순환을 돌리거나 아주 묽은 비료를 주세요.',
    });
  }
  const leggy = state.plants.filter((p) => p.alive && p.etiolation > 0.4);
  if (leggy.length) {
    out.push({
      level: 'info',
      title: '웃자라고 있어요',
      why: `잎에 닿는 빛 ${Math.round(leggy[0].parLeaf ?? 0)} µmol/m²/s. 빛이 부족하면 줄기에 탄소를 더 배분해 빛을 찾아 늘어납니다.`,
      fix: '창가로 옮기거나 LED 선반을 쓰세요.',
    });
  }
  if (r.airT > 32) {
    out.push({
      level: 'bad',
      title: '병 속이 너무 뜨거워요',
      why: `공기 ${r.airT.toFixed(1)} °C (실내 ${r.roomT.toFixed(1)} °C). 유리는 햇빛을 통과시키지만 흙이 내는 적외선은 가둡니다(온실효과).`,
      fix: '직사광선을 피하세요. 뚜껑을 열면 열이 빠집니다.',
    });
  }
  if (gnats > 200) {
    out.push({
      level: 'warn',
      title: '버섯파리가 폭증했어요',
      why: `유충 포함 ${Math.round(gnats)}마리. 젖은 흙과 곰팡이가 유충의 먹이이자 서식지입니다.`,
      fix: '흙 표면을 말리거나 포식 응애(Stratiolaelaps)를 투입하세요.',
    });
  }
  const m = MATERIALS[top.material];
  if (r.rh < 0.6 && state.surface.moss.species.some(Boolean)) {
    out.push({
      level: 'info',
      title: '이끼가 휴면 중이에요',
      why: `습도 ${(r.rh * 100).toFixed(0)}%. 이끼는 뿌리가 없어 몸의 물이 공기와 평형을 이룹니다. 마르면 광합성을 멈추고 휴면합니다.`,
      fix: '분무하면 몇 분 안에 다시 광합성을 시작합니다.',
    });
  }
  if (top.theta > m.thetaS * 0.95) {
    out.push({ level: 'warn', title: '흙이 물에 잠겼어요', why: '공극이 물로 차면 뿌리와 미생물이 쓸 산소가 막힙니다.', fix: '물 주기를 멈추세요.' });
  }
  if (state.agents.some((a) => ['subulina', 'oxidus'].includes(a.species)) && state.calcium <= 0) {
    out.push({ level: 'info', title: '칼슘이 없어요', why: '달팽이 껍데기와 노래기 외골격에는 탄산칼슘이 필요합니다. 없으면 번식이 크게 줄어듭니다.', fix: '갑오징어뼈를 넣어 주세요.' });
  }
  return out;
}
