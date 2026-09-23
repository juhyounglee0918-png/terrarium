/**
 * Animals. Individual agents (woodlice, millipedes, snails, worms) are smoothed between
 * simulation updates; cohort populations are shown as particle swarms whose size follows the
 * simulated counts (springtails hop, fungus gnats and shore flies fly inside the jar).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AgentView, CohortView } from '../sim/snapshot';
import { makeRandom } from './textures';

function ni(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function isopodGeometry(len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const w = Math.sin(Math.PI * (0.15 + 0.75 * t)) * len * 0.3 + len * 0.05;
    const s = new THREE.SphereGeometry(1, 10, 6);
    s.scale(w, len * 0.11, len * 0.075);
    s.translate(0, len * 0.06, (t - 0.5) * len * 0.9);
    parts.push(ni(s));
  }
  for (const side of [-1, 1]) {
    const a = new THREE.CylinderGeometry(len * 0.012, len * 0.008, len * 0.45, 4);
    a.rotateX(Math.PI / 2 - 0.3);
    a.rotateY(side * 0.5);
    a.translate(side * len * 0.12, len * 0.07, len * 0.62);
    parts.push(ni(a));
    const u = new THREE.ConeGeometry(len * 0.03, len * 0.16, 4);
    u.rotateX(-Math.PI / 2);
    u.translate(side * len * 0.08, len * 0.03, -len * 0.52);
    parts.push(ni(u));
  }
  return mergeGeometries(parts);
}

function millipedeGeometry(len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 22;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const s = new THREE.SphereGeometry(len * 0.045, 8, 6);
    s.scale(1, 0.85, 1.4);
    s.translate(Math.sin(t * Math.PI * 2) * len * 0.05, len * 0.04, (t - 0.5) * len);
    parts.push(ni(s));
  }
  return mergeGeometries(parts);
}

function snailGeometry(len: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = len * 0.17 * (1 - t) * (0.75 + 0.25 * Math.abs(Math.sin(t * Math.PI * 7)));
    pts.push(new THREE.Vector2(Math.max(r, 0.0002), t * len * 0.9));
  }
  const shell = new THREE.LatheGeometry(pts, 12);
  shell.rotateX(-Math.PI / 2.4);
  shell.translate(0, len * 0.14, -len * 0.1);
  const body = new THREE.SphereGeometry(1, 10, 6);
  body.scale(len * 0.09, len * 0.05, len * 0.42);
  body.translate(0, len * 0.04, len * 0.12);
  return mergeGeometries([ni(shell), ni(body)]);
}

function wormGeometry(len: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector3(Math.sin(t * 5) * len * 0.08, len * 0.02 * Math.sin(t * Math.PI), (t - 0.5) * len));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, len * 0.035, 8, false);
}

interface AgentLook {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

const AGENT_LOOKS: Record<string, () => AgentLook> = {
  porcellio: () => ({ geo: isopodGeometry(0.014), mat: new THREE.MeshStandardMaterial({ color: '#6f6862', roughness: 0.45 }) }),
  oxidus: () => ({ geo: millipedeGeometry(0.022), mat: new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.35, metalness: 0.05 }) }),
  subulina: () => ({ geo: snailGeometry(0.016), mat: new THREE.MeshPhysicalMaterial({ color: '#d9c7a0', roughness: 0.3, clearcoat: 0.6 }) }),
  dendrobaena: () => ({ geo: wormGeometry(0.07), mat: new THREE.MeshPhysicalMaterial({ color: '#b56d6a', roughness: 0.25, clearcoat: 0.8 }) }),
};

interface Tracked {
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  th: number;
  size: number;
  species: string;
  seen: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  hop: number;
}

interface SwarmLook {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  fly: boolean;
  max: number;
  per: number; // simulated individuals per visible particle
  speed: number; // m/s wandering speed
  hops?: boolean; // springtails flick their furcula
}

export class FaunaLayer {
  readonly group = new THREE.Group();
  private agentMeshes = new Map<string, THREE.InstancedMesh>();
  private tracked = new Map<number, Tracked>();
  private swarms = new Map<string, { mesh: THREE.InstancedMesh; parts: Particle[]; look: SwarmLook }>();
  private rnd = makeRandom(99);
  private frame = 0;

  constructor(private radius: number, private soilTop: number, private height: number, private rocks: { x: number; z: number; size: number }[]) {}

  private swarmLook(species: string): SwarmLook | null {
    const cap = (l: number, r: number) => {
      const g = new THREE.CapsuleGeometry(r, l, 2, 5);
      g.rotateX(Math.PI / 2);
      return g;
    };
    switch (species) {
      case 'folsomia':
        return { geo: cap(0.0016, 0.00035), mat: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }), fly: false, max: 450, per: 5, speed: 0.004, hops: true };
      case 'trichorhina':
        return { geo: isopodGeometry(0.0035), mat: new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.5 }), fly: false, max: 160, per: 1, speed: 0.002 };
      case 'stratiolaelaps':
        return { geo: new THREE.SphereGeometry(0.00045, 6, 4), mat: new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.5 }), fly: false, max: 150, per: 3, speed: 0.006 };
      case 'bradysia':
        return { geo: flyGeometry(0.0028), mat: new THREE.MeshStandardMaterial({ color: '#1d1c1e', roughness: 0.4 }), fly: true, max: 70, per: 1, speed: 0.03 };
      case 'scatella':
        return { geo: flyGeometry(0.0032), mat: new THREE.MeshStandardMaterial({ color: '#2c2a24', roughness: 0.4 }), fly: true, max: 50, per: 1, speed: 0.025 };
      default:
        return null;
    }
  }

  update(agents: AgentView[], cohorts: CohortView[]): void {
    this.frame++;
    for (const a of agents) {
      let t = this.tracked.get(a.id);
      if (!t) {
        t = { x: a.x, z: a.z, heading: a.heading, tx: a.x, tz: a.z, th: a.heading, size: a.size, species: a.species, seen: this.frame };
        this.tracked.set(a.id, t);
      }
      const moved = Math.hypot(a.x - t.tx, a.z - t.tz);
      if (moved > 1e-5) t.th = Math.atan2(a.x - t.tx, a.z - t.tz);
      t.tx = a.x;
      t.tz = a.z;
      t.size = a.size;
      t.seen = this.frame;
    }
    for (const [id, t] of this.tracked) if (t.seen !== this.frame) this.tracked.delete(id);

    for (const c of cohorts) {
      let sw = this.swarms.get(c.species);
      if (!sw) {
        const look = this.swarmLook(c.species);
        if (!look) continue;
        const mesh = new THREE.InstancedMesh(look.geo, look.mat, look.max);
        mesh.count = 0;
        mesh.castShadow = false;
        this.group.add(mesh);
        sw = { mesh, parts: [], look };
        this.swarms.set(c.species, sw);
      }
      const visibleStage = sw.look.fly ? c.stages[c.stages.length - 1].n : c.active;
      const want = Math.min(sw.look.max, Math.round(visibleStage / sw.look.per));
      while (sw.parts.length < want) sw.parts.push(this.spawn(sw.look.fly));
      if (sw.parts.length > want) sw.parts.length = want;
    }
  }

  private spawn(fly: boolean): Particle {
    for (let i = 0; i < 20; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * (this.radius - 0.006);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.onRock(x, z)) continue;
      const y = fly ? this.soilTop + 0.01 + this.rnd() * (this.height - this.soilTop - 0.03) : this.soilTop + 0.0015;
      return { x, y, z, vx: 0, vy: 0, vz: 0, heading: this.rnd() * 6.28, hop: 0 };
    }
    return { x: 0, y: this.soilTop, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, hop: 0 };
  }

  private onRock(x: number, z: number): boolean {
    return this.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.size * 0.8);
  }

  /** Per render frame animation. dt in seconds of real time. */
  animate(dt: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    // Agents.
    const bySpecies = new Map<string, Tracked[]>();
    for (const t of this.tracked.values()) {
      const k = Math.min(1, dt * 2.5);
      t.x += (t.tx - t.x) * k;
      t.z += (t.tz - t.z) * k;
      let dh = t.th - t.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      t.heading += dh * Math.min(1, dt * 4);
      (bySpecies.get(t.species) ?? bySpecies.set(t.species, []).get(t.species)!).push(t);
    }
    for (const [sp, list] of bySpecies) {
      let mesh = this.agentMeshes.get(sp);
      if (!mesh) {
        const make = AGENT_LOOKS[sp];
        if (!make) continue;
        const look = make();
        mesh = new THREE.InstancedMesh(look.geo, look.mat, 96);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.agentMeshes.set(sp, mesh);
      }
      let n = 0;
      for (const t of list.slice(0, 96)) {
        const burrow = sp === 'dendrobaena' ? -0.004 : 0;
        p.set(t.x, this.soilTop + burrow + (this.onRock(t.x, t.z) ? 0.008 : 0), t.z);
        q.setFromAxisAngle(up, t.heading);
        s.setScalar(t.size);
        m.compose(p, q, s);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [sp, mesh] of this.agentMeshes) if (!bySpecies.has(sp)) mesh.count = 0;

    // Swarms.
    for (const sw of this.swarms.values()) {
      const look = sw.look;
      let n = 0;
      for (const part of sw.parts) {
        if (look.fly) {
          part.vx += (this.rnd() - 0.5) * 0.08 * dt;
          part.vy += (this.rnd() - 0.5) * 0.08 * dt;
          part.vz += (this.rnd() - 0.5) * 0.08 * dt;
          const sp = Math.hypot(part.vx, part.vy, part.vz);
          if (sp > look.speed) {
            part.vx *= look.speed / sp;
            part.vy *= look.speed / sp;
            part.vz *= look.speed / sp;
          }
          part.x += part.vx * dt;
          part.y += part.vy * dt;
          part.z += part.vz * dt;
          const r = Math.hypot(part.x, part.z);
          if (r > this.radius - 0.004) {
            part.x *= (this.radius - 0.004) / r;
            part.z *= (this.radius - 0.004) / r;
            part.vx *= -0.5;
            part.vz *= -0.5;
          }
          part.y = Math.min(this.height - 0.005, Math.max(this.soilTop + 0.002, part.y));
          part.heading = Math.atan2(part.vx, part.vz);
        } else {
          if (part.hop > 0) {
            part.hop -= dt;
            part.vy -= 9.8 * dt * 0.2;
            part.y += part.vy * dt;
            part.x += part.vx * dt;
            part.z += part.vz * dt;
            if (part.y <= this.soilTop + 0.0015) {
              part.y = this.soilTop + 0.0015;
              part.hop = 0;
            }
          } else {
            part.heading += (this.rnd() - 0.5) * 3 * dt;
            const v = look.speed * (0.3 + this.rnd());
            part.x += Math.sin(part.heading) * v * dt;
            part.z += Math.cos(part.heading) * v * dt;
            // Springtails flick their furcula now and then.
            if (look.hops && this.rnd() < dt * 0.15) {
              part.hop = 0.4;
              part.vy = 0.12;
              part.vx = (this.rnd() - 0.5) * 0.08;
              part.vz = (this.rnd() - 0.5) * 0.08;
            }
          }
          const r = Math.hypot(part.x, part.z);
          if (r > this.radius - 0.003 || this.onRock(part.x, part.z)) {
            part.heading += Math.PI;
            part.x *= 0.98;
            part.z *= 0.98;
          }
        }
        p.set(part.x, part.y, part.z);
        q.setFromAxisAngle(up, part.heading);
        s.setScalar(1);
        m.compose(p, q, s);
        sw.mesh.setMatrixAt(n++, m);
      }
      sw.mesh.count = n;
      sw.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function flyGeometry(len: number): THREE.BufferGeometry {
  const body = new THREE.CapsuleGeometry(len * 0.13, len * 0.6, 2, 5);
  body.rotateX(Math.PI / 2);
  const wing = new THREE.PlaneGeometry(len * 0.35, len * 0.7);
  wing.rotateX(-Math.PI / 2);
  const w1 = wing.clone();
  w1.rotateY(0.4);
  w1.translate(len * 0.2, len * 0.12, -len * 0.1);
  const w2 = wing.clone();
  w2.rotateY(-0.4);
  w2.translate(-len * 0.2, len * 0.12, -len * 0.1);
  const legs = new THREE.CylinderGeometry(len * 0.02, len * 0.02, len * 0.9, 3);
  legs.rotateZ(Math.PI / 2);
  legs.translate(0, -len * 0.1, 0);
  return mergeGeometries([ni(body), ni(w1), ni(w2), ni(legs)]);
}
