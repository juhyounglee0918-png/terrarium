/** Ready-made terrarium builds. */
import { defaultConfig, type TerrariumConfig } from './config';

export interface Preset {
  id: string;
  name: string;
  description: string;
  build: () => TerrariumConfig;
}

export const PRESETS: Preset[] = [
  {
    id: 'tropical',
    name: '열대 밀폐형',
    description: '이끼·양치·피토니아에 톡토기와 꼬마흰쥐며느리. 유리 뚜껑, 창가.',
    build: defaultConfig,
  },
  {
    id: 'bioactive',
    name: '바이오액티브 대형',
    description: '큰 병에 쥐며느리·노래기·달팽이까지 넣은 청소부 생태계. 석회석이 칼슘을 공급.',
    build: () => {
      const c = defaultConfig();
      c.radius = 0.15;
      c.height = 0.36;
      c.layers = [
        { material: 'leca', thickness: 0.04, initialHead: -0.2 },
        { material: 'charcoal', thickness: 0.008, initialHead: -0.2 },
        { material: 'substrate', thickness: 0.08, initialHead: -0.3 },
      ];
      c.hardscape = [
        { x: -0.06, z: 0.04, size: 0.045, limestone: true },
        { x: 0.07, z: -0.05, size: 0.03 },
        { x: 0.02, z: 0.08, size: 0.02 },
      ];
      c.plants = [
        { species: 'pteris', x: 0.06, z: 0.05 },
        { species: 'fittonia', x: -0.03, z: -0.06 },
        { species: 'ficus', x: -0.1, z: -0.04 },
        { species: 'tradescantia', x: 0.03, z: -0.01 },
        { species: 'selaginella', x: -0.08, z: 0.09 },
      ];
      c.moss = [
        { species: 'hypnum', fraction: 0.35 },
        { species: 'leucobryum', fraction: 0.06 },
      ];
      c.fauna = [
        { species: 'folsomia', count: 500 },
        { species: 'trichorhina', count: 40 },
        { species: 'porcellio', count: 6 },
        { species: 'oxidus', count: 3 },
        { species: 'subulina', count: 3 },
      ];
      c.initialLitterC = 0.0015;
      return c;
    },
  },
  {
    id: 'latimer',
    name: '라티머의 병 정원',
    description: '1960년 David Latimer처럼: 큰 병에 퇴비와 스파이더워트 한 포기, 완전 밀봉, 창에서 떨어진 곳.',
    build: () => {
      const c = defaultConfig();
      c.radius = 0.17;
      c.height = 0.42;
      c.layers = [{ material: 'substrate', thickness: 0.1, initialHead: -0.35 }];
      c.hardscape = [];
      c.plants = [{ species: 'tradescantia', x: 0, z: 0 }];
      c.moss = [];
      c.fauna = [];
      c.lid = 'sealed';
      c.lighting.placement = 'nearWindow';
      c.initialLitterC = 0.001;
      return c;
    },
  },
  {
    id: 'arid',
    name: '건조형 (다육)',
    description: '모래 혼합토에 하월시아. 뚜껑 없이 창턱에서. 습식 테라리움과 반대의 균형.',
    build: () => {
      const c = defaultConfig();
      c.layers = [
        { material: 'leca', thickness: 0.02, initialHead: -1 },
        { material: 'sand', thickness: 0.07, initialHead: -0.15 },
      ];
      c.lid = 'open';
      c.lighting.placement = 'windowsill';
      c.plants = [
        { species: 'haworthia', x: -0.03, z: -0.03 },
        { species: 'haworthia', x: 0.05, z: 0.0 },
        { species: 'haworthia', x: -0.01, z: 0.06 },
      ];
      c.moss = [];
      c.fauna = [{ species: 'porcellio', count: 3 }];
      c.initialLitterC = 0.0003;
      c.room.rh = 0.4;
      return c;
    },
  },
  {
    id: 'empty',
    name: '빈 병 (물리만)',
    description: '생물 없이 흙과 물만. 김서림과 열·습도 물리를 관찰.',
    build: () => {
      const c = defaultConfig();
      return { ...c, plants: [], moss: [], fauna: [], initialLitterC: 0 };
    },
  },
];

export function presetConfig(id: string): TerrariumConfig {
  return (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).build();
}
