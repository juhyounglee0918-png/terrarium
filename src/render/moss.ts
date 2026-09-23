/**
 * Moss carpet: many flattened, fibrous cushions per surface cell. Colour follows species, tissue
 * water (bright when hydrated, dull olive when dry) and health (browning); dry moss shrinks.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SurfaceView } from '../sim/snapshot';
import { makeRandom, mossBumpTexture } from './textures';

const PER_CELL = 12;

const WET = [new THREE.Color('#000000'), new THREE.Color('#4f8a2a'), new THREE.Color('#8fb88a')];
const DRY = [new THREE.Color('#000000'), new THREE.Color('#8a8a48'), new THREE.Color('#c8cdb4')];
const DEAD = new THREE.Color('#6a5234');

export class MossLayer {
  readonly mesh: THREE.InstancedMesh;
  private slots: { cell: number; x: number; z: number; r: number; rot: number; k: number }[] = [];
  private lastSig = '';

  constructor(private radius: number, private soilTop: number, n: number, cellSize: number) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const geo = mergeVertices(g);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const bump = 1 + 0.12 * Math.sin(x * 9) * Math.cos(z * 8) + 0.06 * Math.sin((x + z) * 23);
      p.setXYZ(i, x * bump, Math.max(y, -0.15) * bump, z * bump);
      uv[i * 2] = x * 0.5 + 0.5;
      uv[i * 2 + 1] = z * 0.5 + 0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const bump = mossBumpTexture();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, bumpMap: bump, bumpScale: 1.2, color: '#ffffff' });
    this.mesh = new THREE.InstancedMesh(geo, mat, n * n * PER_CELL);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    const rnd = makeRandom(4242);
    for (let cell = 0; cell < n * n; cell++) {
      const ix = cell % n;
      const iz = Math.floor(cell / n);
      for (let k = 0; k < PER_CELL; k++) {
        const x = -radius + (ix + rnd()) * cellSize;
        const z = -radius + (iz + rnd()) * cellSize;
        this.slots.push({ cell, x, z, r: cellSize * (0.28 + rnd() * 0.22), rot: rnd() * Math.PI * 2, k });
      }
    }
  }

  update(s: SurfaceView): void {
    const sig = s.mossCover.map((c, i) => `${Math.round(c * 12)}${Math.round(s.mossHealth[i] * 6)}${Math.round(s.mossWet[i] * 6)}`).join('');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (const slot of this.slots) {
      const sp = s.mossSpecies[slot.cell];
      if (!sp) continue;
      if (Math.hypot(slot.x, slot.z) > this.radius - slot.r * 0.6) continue;
      const cover = s.mossCover[slot.cell];
      if (slot.k >= Math.round(cover * PER_CELL)) continue;
      const wet = s.mossWet[slot.cell];
      const health = s.mossHealth[slot.cell];
      const cushion = sp === 2;
      const shrink = 0.8 + 0.2 * Math.min(1, wet * 1.5);
      const h = (cushion ? 0.75 : 0.32) * shrink;
      pos.set(slot.x, this.soilTop + slot.r * h * 0.25, slot.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.rot);
      scl.set(slot.r * shrink, slot.r * h, slot.r * shrink);
      m.compose(pos, q, scl);
      this.mesh.setMatrixAt(n, m);
      col.copy(DRY[sp]).lerp(WET[sp], Math.min(1, wet * 1.6)).lerp(DEAD, 1 - health);
      col.offsetHSL(0, 0, ((slot.k * 37) % 10) / 180 - 0.02);
      this.mesh.setColorAt(n, col);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
