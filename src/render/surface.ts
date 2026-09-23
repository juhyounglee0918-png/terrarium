/**
 * The substrate surface: a canvas texture repainted from simulation data (fallen leaves, white
 * mould mats, yellow slime-mould networks) plus 3D details — fluffy mould puffs, curled dead
 * leaves and Leucocoprinus mushrooms that sprout, open and collapse.
 */
import * as THREE from 'three';
import type { SceneView, SurfaceView } from '../sim/snapshot';
import { makeRandom, puffTexture } from './textures';

const TEX = 512;

export class SurfaceLayer {
  readonly group = new THREE.Group();
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private puffs: THREE.InstancedMesh;
  private leaves: THREE.InstancedMesh;
  private shrooms = new Map<number, THREE.Group>();
  private lastSig = '';
  private rnd = makeRandom(555);
  private puffSlots: { x: number; z: number; s: number; rot: number; cell: number; k: number }[] = [];
  private leafSlots: { x: number; z: number; rot: number; tilt: number; s: number; cell: number; k: number }[] = [];

  constructor(private radius: number, private soilTop: number, private n: number, cellSize: number, substrate: THREE.Texture) {
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = TEX;
    const bg = this.base.getContext('2d')!;
    const img = substrate.image as HTMLCanvasElement;
    const tile = TEX / 1.6;
    for (let y = 0; y < TEX; y += tile) for (let x = 0; x < TEX; x += tile) bg.drawImage(img, x, y, tile, tile);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = TEX;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const puffMat = new THREE.MeshStandardMaterial({ map: puffTexture(), transparent: true, depthWrite: false, roughness: 1, color: '#f6f4ee', side: THREE.DoubleSide });
    this.puffs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, 700);
    this.puffs.count = 0;
    this.group.add(this.puffs);

    const leafGeo = new THREE.PlaneGeometry(1, 1.6, 2, 4);
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.12 * Math.pow(lp.getX(i) * 2, 2) - 0.08 * Math.pow(lp.getY(i) / 0.8, 2));
    leafGeo.computeVertexNormals();
    leafGeo.rotateX(-Math.PI / 2);
    this.leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ map: deadLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 }), 160);
    this.leaves.count = 0;
    this.leaves.receiveShadow = true;
    this.leaves.castShadow = true;
    this.group.add(this.leaves);

    for (let cell = 0; cell < n * n; cell++) {
      const ix = cell % n;
      const iz = Math.floor(cell / n);
      for (let k = 0; k < 3; k++) {
        this.puffSlots.push({ x: -radius + (ix + this.rnd()) * cellSize, z: -radius + (iz + this.rnd()) * cellSize, s: cellSize * (0.5 + this.rnd() * 0.7), rot: this.rnd() * 6.28, cell, k });
      }
      this.leafSlots.push({ x: -radius + (ix + this.rnd()) * cellSize, z: -radius + (iz + this.rnd()) * cellSize, rot: this.rnd() * 6.28, tilt: (this.rnd() - 0.5) * 0.5, s: 0.012 + this.rnd() * 0.01, cell, k: 0 });
    }
  }

  update(scene: SceneView): void {
    const s = scene.surface;
    const sig = s.mould.map((m, i) => `${Math.round(m * 8)}${Math.round(s.slime[i] * 5)}${Math.round(s.litter[i] * 4)}`).join('') + Math.round(scene.litterC * 1e5);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.paint(s);
      this.placePuffs(s);
      this.placeLeaves(s, scene.litterC);
    }
    this.updateMushrooms(scene.mushrooms);
  }

  private paint(s: SurfaceView): void {
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.base, 0, 0);
    const px = TEX / this.n;
    const rnd = makeRandom(11);
    // Decomposing litter stains the surface darker.
    for (let i = 0; i < s.litter.length; i++) {
      if (s.litter[i] <= 0.05) continue;
      const cx = ((i % this.n) + 0.5) * px;
      const cy = (Math.floor(i / this.n) + 0.5) * px;
      g.fillStyle = `rgba(40,25,12,${0.25 * s.litter[i]})`;
      g.beginPath();
      g.arc(cx, cy, px * 0.7, 0, Math.PI * 2);
      g.fill();
    }
    // White mould mats with radiating hyphae.
    for (let i = 0; i < s.mould.length; i++) {
      const m = s.mould[i];
      if (m < 0.04) continue;
      const cx = ((i % this.n) + 0.5) * px;
      const cy = (Math.floor(i / this.n) + 0.5) * px;
      const r = px * (0.35 + m * 0.9);
      const grad = g.createRadialGradient(cx, cy, 1, cx, cy, r);
      grad.addColorStop(0, `rgba(248,247,242,${0.75 * m})`);
      grad.addColorStop(1, 'rgba(248,247,242,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(250,250,245,${0.45 * m})`;
      g.lineWidth = 0.7;
      for (let k = 0; k < 30 * m; k++) {
        const a = rnd() * Math.PI * 2;
        const l = r * (0.6 + rnd() * 0.8);
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(cx + Math.cos(a + 0.4) * l * 0.5, cy + Math.sin(a + 0.4) * l * 0.5, cx + Math.cos(a) * l, cy + Math.sin(a) * l);
        g.stroke();
      }
    }
    // Slime mould: branching yellow veins.
    for (let i = 0; i < s.slime.length; i++) {
      const v = s.slime[i];
      if (v < 0.05) continue;
      const cx = ((i % this.n) + 0.5) * px;
      const cy = (Math.floor(i / this.n) + 0.5) * px;
      g.strokeStyle = `rgba(236,196,40,${0.85 * Math.min(1, v * 1.5)})`;
      const vein = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
        if (depth > 4 || len < 3) return;
        const x2 = x + Math.cos(a) * len;
        const y2 = y + Math.sin(a) * len;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.stroke();
        vein(x2, y2, a + 0.5 + rnd() * 0.3, len * 0.72, w * 0.7, depth + 1);
        vein(x2, y2, a - 0.5 - rnd() * 0.3, len * 0.72, w * 0.7, depth + 1);
      };
      for (let k = 0; k < 3; k++) vein(cx, cy, rnd() * Math.PI * 2, px * 0.5 * (0.5 + v), 3 * v + 1, 0);
    }
    this.texture.needsUpdate = true;
  }

  private placePuffs(s: SurfaceView): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (const slot of this.puffSlots) {
      const mould = s.mould[slot.cell];
      if (mould < 0.12 || slot.k >= Math.round(mould * 3)) continue;
      if (Math.hypot(slot.x, slot.z) > this.radius - 0.006) continue;
      q.setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.25, slot.rot, 0));
      const sc = slot.s * (0.5 + mould);
      m.compose(new THREE.Vector3(slot.x, this.soilTop + 0.0025 + mould * 0.002, slot.z), q, new THREE.Vector3(sc, sc, sc));
      this.puffs.setMatrixAt(n++, m);
      if (n >= 700) break;
    }
    this.puffs.count = n;
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  private placeLeaves(s: SurfaceView, litterC: number): void {
    // One visible leaf per ~20 mg C of surface litter, placed where the litter lies.
    const want = Math.min(160, Math.round(litterC / 2e-5));
    const ranked = this.leafSlots
      .filter((l) => Math.hypot(l.x, l.z) < this.radius - 0.01)
      .map((l) => ({ l, w: s.litter[l.cell] + ((l.cell * 7919) % 97) / 400 }))
      .sort((a, b) => b.w - a.w);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (const { l } of ranked.slice(0, want)) {
      q.setFromEuler(new THREE.Euler(l.tilt, l.rot, l.tilt * 0.5));
      m.compose(new THREE.Vector3(l.x, this.soilTop + 0.0035, l.z), q, new THREE.Vector3(l.s, l.s, l.s));
      this.leaves.setMatrixAt(n++, m);
    }
    this.leaves.count = n;
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  private updateMushrooms(list: SceneView['mushrooms']): void {
    const seen = new Set<number>();
    for (const mu of list) {
      seen.add(mu.id);
      let g = this.shrooms.get(mu.id);
      if (!g) {
        g = mushroomMesh();
        g.position.set(mu.x, this.soilTop, mu.z);
        g.rotation.y = (mu.id * 1.7) % 6.28;
        this.group.add(g);
        this.shrooms.set(mu.id, g);
      }
      // Sprout (day 0–1), open the cap (1–3), wilt and topple (3–4).
      const grow = Math.min(1, mu.age / 1);
      const open = Math.min(1, Math.max(0, (mu.age - 0.8) / 2));
      const collapse = Math.max(0, (mu.age - 3) / 1);
      g.scale.set(0.3 + 0.7 * grow, (0.3 + 0.7 * grow) * (1 - collapse * 0.6), 0.3 + 0.7 * grow);
      g.rotation.z = collapse * 0.9;
      const cap = g.getObjectByName('cap')!;
      cap.scale.set(0.7 + open * 0.6, 1 - open * 0.45, 0.7 + open * 0.6);
    }
    for (const [id, g] of this.shrooms) {
      if (!seen.has(id)) {
        this.group.remove(g);
        this.shrooms.delete(id);
      }
    }
  }
}

function mushroomMesh(): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: '#efd83c', roughness: 0.55 });
  const stipe = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.002, 0.035, 8), yellow);
  stipe.position.y = 0.0175;
  stipe.castShadow = true;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.009 * Math.sin((t * Math.PI) / 2), 0.012 * (1 - t * t)));
  }
  const cap = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ color: '#e9cf2c', roughness: 0.6, side: THREE.DoubleSide }));
  cap.position.y = 0.033;
  cap.name = 'cap';
  cap.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.0004, 4, 10), yellow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.026;
  g.add(stipe, cap, ring);
  return g;
}

function deadLeafTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 200;
  const g = c.getContext('2d')!;
  const rnd = makeRandom(8);
  g.beginPath();
  g.moveTo(64, 198);
  g.quadraticCurveTo(0, 110, 64, 2);
  g.quadraticCurveTo(128, 110, 64, 198);
  g.closePath();
  g.clip();
  g.fillStyle = '#7a5530';
  g.fillRect(0, 0, 128, 200);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '40,25,10' : '160,120,70'},${0.1 + rnd() * 0.2})`;
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 200, 1 + rnd() * 6, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(60,38,18,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(64, 200);
  g.lineTo(64, 4);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
