/**
 * Procedural plants. Geometry is regenerated from the simulated state: leaf count follows leaf
 * area, leaf droop follows turgor (wilt), internode length follows etiolation, leaf colour follows
 * nitrogen status and health.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlantView } from '../sim/snapshot';
import { leafTexture, makeRandom, type LeafStyle } from './textures';

interface SpeciesLook {
  style: LeafStyle;
  leafLen: number; // m
  leafWid: number; // m
  stem: string;
}

const LOOKS: Record<string, SpeciesLook> = {
  fittonia: { style: { base: '#2f6b3a', edge: '#23512c', vein: '#f3f0ea', veinWidth: 3.2, network: 1, shape: 'ovate' }, leafLen: 0.042, leafWid: 0.032, stem: '#6d8a4e' },
  pilea: { style: { base: '#8fb0a8', edge: '#6f918b', vein: '#b9cfca', veinWidth: 1.5, network: 0, shape: 'round', speckle: 'rgba(230,240,238,0.4)' }, leafLen: 0.009, leafWid: 0.008, stem: '#8a4a42' },
  selaginella: { style: { base: '#5f9e3b', edge: '#4b8430', vein: '#7dbb55', veinWidth: 1.2, network: 0, shape: 'pinna' }, leafLen: 0.05, leafWid: 0.024, stem: '#6b9a44' },
  pteris: { style: { base: '#44803a', edge: '#356b2c', vein: '#9cc07e', veinWidth: 2, network: 0, shape: 'lance', stripes: 'rgba(200,220,170,0.35)' }, leafLen: 0.06, leafWid: 0.011, stem: '#4a5e2c' },
  tradescantia: { style: { base: '#4f7d46', edge: '#6d3b64', vein: '#8fb07e', veinWidth: 1.6, network: 0, shape: 'lance', stripes: 'rgba(220,230,220,0.55)' }, leafLen: 0.045, leafWid: 0.018, stem: '#7a5068' },
  ficus: { style: { base: '#3f7a35', edge: '#2f6128', vein: '#a9c98c', veinWidth: 2, network: 0.4, shape: 'heart' }, leafLen: 0.022, leafWid: 0.017, stem: '#5d6b3a' },
  peperomia: { style: { base: '#3c6a3f', edge: '#2b4f2d', vein: '#9bc08f', veinWidth: 2, network: 0.5, shape: 'round', speckle: 'rgba(200,220,180,0.35)' }, leafLen: 0.009, leafWid: 0.009, stem: '#7d4a52' },
  haworthia: { style: { base: '#2f5a37', edge: '#274c2e', vein: '#2f5a37', veinWidth: 1, network: 0, shape: 'succulent', stripes: 'rgba(245,245,240,0.9)' }, leafLen: 0.045, leafWid: 0.012, stem: '#2f5a37' },
};

const leafMaterials = new Map<string, THREE.MeshStandardMaterial>();
const stemMaterials = new Map<string, THREE.MeshStandardMaterial>();

function leafMaterial(species: string): THREE.MeshStandardMaterial {
  let m = leafMaterials.get(species);
  if (!m) {
    const look = LOOKS[species] ?? LOOKS.fittonia;
    m = new THREE.MeshStandardMaterial({
      map: leafTexture(look.style, species.length * 13),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: species === 'haworthia' ? 0.55 : 0.62,
      metalness: 0,
    });
    // Cheap translucency: leaves glow a little when lit from behind.
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.08;',
      );
    };
    leafMaterials.set(species, m);
  }
  return m;
}

function stemMaterial(species: string): THREE.MeshStandardMaterial {
  let m = stemMaterials.get(species);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: (LOOKS[species] ?? LOOKS.fittonia).stem, roughness: 0.7 });
    stemMaterials.set(species, m);
  }
  return m;
}

/** A leaf blade from the petiole at the origin, extending along +Y, arched and cupped. */
function leafGeometry(len: number, wid: number, arch: number, cup: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(wid, len, 3, 8);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) / len;
    p.setZ(i, -arch * len * y * y + cup * Math.pow(x / (wid / 2), 2) * wid * 0.25);
  }
  g.computeVertexNormals();
  return g;
}

/** Thick triangular succulent leaf (Haworthia). */
function succulentLeaf(len: number, wid: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(wid / 2, len, 3, 4, false);
  g.translate(0, len / 2, 0);
  g.scale(1, 1, 0.55);
  return g;
}

function place(geo: THREE.BufferGeometry, pos: THREE.Vector3, yaw: number, pitch: number, roll = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return geo.clone().applyMatrix4(m);
}

function tube(points: THREE.Vector3[], r: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(4, points.length * 3), r, 5, false);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function plantSignature(p: PlantView): string {
  const look = LOOKS[p.species] ?? LOOKS.fittonia;
  const leaves = Math.round(p.leafArea / (look.leafLen * look.leafWid * 0.7));
  return `${p.species}|${leaves}|${Math.round(p.height * 300)}|${Math.round(p.wilt * 8)}|${Math.round(p.etiolation * 4)}`;
}

export function buildPlant(p: PlantView): THREE.Group {
  const look = LOOKS[p.species] ?? LOOKS.fittonia;
  const rnd = makeRandom(p.id * 7919 + 13);
  const group = new THREE.Group();
  const leaves: THREE.BufferGeometry[] = [];
  const stems: THREE.BufferGeometry[] = [];
  const perLeaf = look.leafLen * look.leafWid * 0.7;
  const count = Math.max(2, Math.min(260, Math.round(p.leafArea / perLeaf)));
  const droop = p.wilt; // 0 turgid … 1 collapsed
  const stretch = 1 + p.etiolation * 0.8;
  const towardLight = new THREE.Vector3(0, 0, 1); // window side (+Z)

  switch (p.form) {
    case 'rosette':
    case 'succulent': {
      const succ = p.species === 'haworthia';
      const base = succ ? succulentLeaf(look.leafLen, look.leafWid) : null;
      const stemH = p.height * 0.35 * stretch;
      if (!succ) stems.push(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.002, stemH * 0.6, 0), new THREE.Vector3(0, stemH, 0.002)], 0.0025));
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const yaw = i * GOLDEN;
        const y = succ ? 0.002 : stemH * (0.25 + 0.75 * (1 - t));
        const size = succ ? 0.6 + 0.6 * (1 - t) : 0.7 + 0.5 * (1 - t) + rnd() * 0.15;
        const up = succ ? 0.35 + 0.6 * t : 0.25 + 0.8 * t; // inner leaves stand up
        const pitch = -(Math.PI / 2 - up * 1.2) + droop * 1.1;
        const g = succ
          ? base!.clone().scale(size, size, size)
          : leafGeometry(look.leafLen * size * (1 + p.etiolation * 0.2), look.leafWid * size * (1 - p.etiolation * 0.25), 0.25 + droop * 0.9, 0.3 + droop * 0.4);
        leaves.push(place(g, new THREE.Vector3(0, y, 0), yaw, succ ? -up * 0.9 : pitch, (rnd() - 0.5) * 0.3));
      }
      break;
    }
    case 'trailing':
    case 'climber': {
      const runners = Math.max(2, Math.min(7, Math.round(Math.sqrt(count) / 1.6)));
      const perRunner = Math.ceil(count / runners);
      const reach = Math.max(0.03, p.crown * 1.4) * stretch;
      for (let r = 0; r < runners; r++) {
        const yaw0 = (r / runners) * Math.PI * 2 + rnd() * 0.5;
        const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
        const climb = p.form === 'climber';
        const lift = climb ? p.height * (0.6 + rnd() * 0.6) : p.height * (0.4 + rnd() * 0.4);
        const segs = 6;
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const wob = (rnd() - 0.5) * 0.01;
          const dir = new THREE.Vector3(Math.cos(yaw0), 0, Math.sin(yaw0)).lerp(towardLight, 0.15 * p.etiolation);
          pts.push(new THREE.Vector3(dir.x * reach * t + wob, Math.sin(t * Math.PI * (climb ? 0.5 : 0.8)) * lift * (1 - droop * 0.6), dir.z * reach * t - wob));
        }
        stems.push(tube(pts, p.species === 'tradescantia' ? 0.0018 : p.species === 'ficus' ? 0.0009 : 0.0005));
        const curve = new THREE.CatmullRomCurve3(pts);
        for (let i = 0; i < perRunner; i++) {
          const t = 0.08 + (0.92 * i) / perRunner;
          const at = curve.getPoint(t);
          const tan = curve.getTangent(t);
          const yaw = Math.atan2(tan.x, tan.z) + (i % 2 ? 1 : -1) * (Math.PI / 2.3);
          const s = (0.6 + 0.5 * (1 - t)) * (0.85 + rnd() * 0.3);
          const g = leafGeometry(look.leafLen * s, look.leafWid * s, 0.2 + droop * 0.9, 0.25);
          const pitch = -Math.PI / 2 + 0.55 + droop * 1.0 - rnd() * 0.2;
          leaves.push(place(g, at, yaw, pitch, (rnd() - 0.5) * 0.4));
        }
      }
      break;
    }
    case 'fern': {
      const fronds = Math.max(2, Math.round(count / 4.5));
      const perFrond = Math.max(4, Math.round((count / fronds) * 2));
      for (let f = 0; f < fronds; f++) {
        const yaw = f * GOLDEN + rnd() * 0.3;
        const len = p.height * (0.8 + rnd() * 0.5) * stretch;
        const arch = 0.35 + droop * 0.6 + rnd() * 0.15;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const out = Math.sin(t * 0.9) * len * (0.45 + arch * 0.4);
          const up = (t - arch * t * t * 1.2) * len;
          pts.push(new THREE.Vector3(Math.cos(yaw) * out, Math.max(0.004, up), Math.sin(yaw) * out));
        }
        stems.push(tube(pts, 0.0012));
        const curve = new THREE.CatmullRomCurve3(pts);
        for (let i = 0; i < perFrond; i++) {
          const t = 0.2 + (0.78 * i) / perFrond;
          const at = curve.getPoint(t);
          const tan = curve.getTangent(t);
          const side = i % 2 ? 1 : -1;
          const yawL = Math.atan2(tan.x, tan.z) + side * (Math.PI / 2 - 0.3);
          const s = (1 - t * 0.6) * (0.9 + rnd() * 0.2);
          const g = leafGeometry(look.leafLen * s * 0.7, look.leafWid * s, 0.15 + droop * 0.6, 0.15);
          leaves.push(place(g, at, yawL, -Math.PI / 2 + 0.25 + droop * 0.9, side * 0.3));
        }
      }
      break;
    }
    case 'spikemoss':
    default: {
      const sprays = Math.max(3, count);
      for (let i = 0; i < sprays; i++) {
        const yaw = i * GOLDEN;
        const dist = Math.sqrt((i + 0.5) / sprays) * p.crown * 0.8;
        const at = new THREE.Vector3(Math.cos(yaw) * dist, 0.003 + rnd() * p.height * 0.4, Math.sin(yaw) * dist);
        const s = 0.8 + rnd() * 0.4;
        const g = leafGeometry(look.leafLen * s, look.leafWid * s, 0.3 + droop * 0.8, -0.2);
        leaves.push(place(g, at, yaw + Math.PI / 2 + (rnd() - 0.5) * 0.6, -Math.PI / 2 + 0.25 + droop * 0.7, (rnd() - 0.5) * 0.5));
      }
      break;
    }
  }

  if (leaves.length) {
    const merged = mergeGeometries(leaves.map((g) => g.index ? g.toNonIndexed() : g), false);
    const mat = leafMaterial(p.species).clone();
    mat.onBeforeCompile = leafMaterial(p.species).onBeforeCompile;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'leaves';
    group.add(mesh);
  }
  if (stems.length) {
    const mesh = new THREE.Mesh(mergeGeometries(stems.map((g) => g.index ? g.toNonIndexed() : g), false), stemMaterial(p.species));
    mesh.castShadow = true;
    group.add(mesh);
  }
  leaves.forEach((g) => g.dispose());
  stems.forEach((g) => g.dispose());
  return group;
}

/** Tint leaves for N deficiency (yellow), poor health (brown) and wilting (dull). */
export function tintPlant(group: THREE.Group, p: PlantView): void {
  const mesh = group.getObjectByName('leaves') as THREE.Mesh | undefined;
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const c = new THREE.Color(1, 1, 1);
  c.lerp(new THREE.Color(1.25, 1.12, 0.35), p.chlorosis * 0.8);
  c.lerp(new THREE.Color(0.62, 0.45, 0.25), (1 - p.health) * 0.9);
  c.multiplyScalar(1 - p.wilt * 0.15);
  mat.color.copy(c);
}
