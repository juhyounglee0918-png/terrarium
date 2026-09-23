import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneView } from '../sim/snapshot';
import type { FrameData } from '../worker/protocol';
import { condensationMaterial, filmTexture, writeFilm, type CondensationUniforms } from './condensation';
import { FaunaLayer } from './fauna';
import { MossLayer } from './moss';
import { buildPlant, plantSignature, tintPlant } from './plants';
import { SurfaceLayer } from './surface';
import { charcoalTexture, clayTexture, corkTexture, dropletTexture, makeRandom, stoneTexture, substrateTexture, woodTexture } from './textures';

/**
 * World axes: +X east, +Y up, −Z north. The window faces south (+Z), behind the default camera.
 * Units are metres, matching the simulation.
 */
export interface TerrariumView {
  update(frame: FrameData): void;
  render(dt: number): void;
  resize(): void;
  setQuality(high: boolean): void;
  setMacro(on: boolean): void;
  pick(clientX: number, clientY: number): { x: number; z: number; plantId?: number } | null;
}

const SUBSTRATE_DRY = new THREE.Color('#b08a66');
const SUBSTRATE_WET = new THREE.Color('#5a3f2c');
const GLASS_T = 0.004;

export function sunVector(elevation: number, azimuth: number): THREE.Vector3 {
  const c = Math.cos(elevation);
  return new THREE.Vector3(Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c).normalize();
}

/** Everything that depends on the jar's size and build; rebuilt when a new game starts. */
class Terrarium {
  readonly group = new THREE.Group();
  readonly soilTop: number;
  private topMat: THREE.MeshStandardMaterial;
  private subMat?: THREE.MeshStandardMaterial;
  private lecaMat?: THREE.MeshStandardMaterial;
  private lecaWater?: THREE.Mesh;
  private lecaBase = 0;
  private lecaThick = 0;
  private lidGlass: THREE.Mesh;
  private cork: THREE.Mesh;
  private lidFog: THREE.Mesh;
  private film: THREE.DataTexture;
  readonly wallUniforms: CondensationUniforms;
  private lidUniforms: CondensationUniforms;
  private plants = new Map<number, { group: THREE.Group; sig: string }>();
  private plantGroup = new THREE.Group();
  readonly moss: MossLayer;
  readonly surface: SurfaceLayer;
  readonly fauna: FaunaLayer;
  readonly topMesh: THREE.Mesh;

  constructor(readonly view: SceneView) {
    const { radius: R, height: H, layers } = view.jar;
    const innerR = R - 0.0006;
    const soilDepth = layers.reduce((s, l) => s + l.thickness, 0);
    this.soilTop = soilDepth;
    const airH = H - soilDepth;
    const subTex = substrateTexture();

    // Substrate layers.
    let y = 0;
    for (const layer of layers) {
      const geo = new THREE.CylinderGeometry(innerR - 0.0004, innerR - 0.0004, layer.thickness, 96, 1, false);
      let mat: THREE.MeshStandardMaterial;
      if (layer.material === 'substrate' || layer.material === 'sand') {
        const t = subTex.clone();
        t.repeat.set(6, 1.2);
        t.needsUpdate = true;
        mat = new THREE.MeshStandardMaterial({ map: t, color: layer.material === 'sand' ? '#d8c49a' : SUBSTRATE_DRY, roughness: 0.95 });
        this.subMat = mat;
      } else if (layer.material === 'charcoal') {
        const t = charcoalTexture();
        t.repeat.set(10, 0.6);
        mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0.05 });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: '#7a3f22', roughness: 1 });
        this.lecaMat = mat;
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y + layer.thickness / 2;
      m.receiveShadow = true;
      this.group.add(m);
      if (layer.material === 'leca') {
        this.group.add(lecaPebbles(innerR, y, layer.thickness));
        this.lecaWater = new THREE.Mesh(
          new THREE.CylinderGeometry(innerR - 0.0008, innerR - 0.0008, 1, 96, 1, false),
          new THREE.MeshPhysicalMaterial({ color: '#6f8f8a', transparent: true, opacity: 0.45, roughness: 0.1 }),
        );
        this.lecaBase = y;
        this.lecaThick = layer.thickness;
        this.lecaWater.visible = false;
        this.group.add(this.lecaWater);
      }
      y += layer.thickness;
    }

    // Surface layer with painted mould/slime/litter.
    const s = view.surface;
    this.surface = new SurfaceLayer(R, soilDepth, s.n, s.cellSize, subTex);
    const topGeo = new THREE.CircleGeometry(innerR - 0.0004, 96);
    const pos = topGeo.attributes.position as THREE.BufferAttribute;
    const uv = topGeo.attributes.uv as THREE.BufferAttribute;
    const rnd = makeRandom(9);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const rr = Math.hypot(px, py) / innerR;
      // Nearly flat so moss, litter and animals placed at the soil level sit on it.
      pos.setZ(i, (rnd() - 0.5) * 0.0005 * (1 - rr));
      // After rotating −90° about X, local y maps to world −z. Texture: u = world x, v = world z.
      uv.setXY(i, (px + R) / (2 * R), 1 - (-py + R) / (2 * R));
    }
    topGeo.computeVertexNormals();
    this.topMat = new THREE.MeshStandardMaterial({ map: this.surface.texture, color: SUBSTRATE_DRY, roughness: 0.96 });
    this.topMesh = new THREE.Mesh(topGeo, this.topMat);
    this.topMesh.rotation.x = -Math.PI / 2;
    this.topMesh.position.y = soilDepth;
    this.topMesh.receiveShadow = true;
    this.group.add(this.topMesh, this.surface.group);

    this.group.add(hardscape(view.hardscape, soilDepth));
    this.moss = new MossLayer(R, soilDepth, s.n, s.cellSize);
    this.group.add(this.moss.mesh, this.plantGroup);
    this.fauna = new FaunaLayer(R, soilDepth, H, view.hardscape);
    this.group.add(this.fauna.group);

    // Glass.
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.03,
      transmission: 1,
      thickness: GLASS_T * 2,
      ior: 1.5,
      attenuationColor: new THREE.Color('#dff5ea'),
      attenuationDistance: 0.25,
      specularIntensity: 1,
    });
    glassMat.depthWrite = false; // the condensation layer sits just inside the glass
    const glass = new THREE.Mesh(new THREE.LatheGeometry(jarProfile(R, H), 128), glassMat);
    glass.renderOrder = 2;
    this.group.add(glass);

    this.lidGlass = new THREE.Mesh(new THREE.CylinderGeometry(R + GLASS_T + 0.006, R + GLASS_T + 0.006, GLASS_T, 96), glassMat);
    this.lidGlass.position.y = H + GLASS_T / 2;
    this.cork = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.002, R - 0.006, 0.03, 64), new THREE.MeshStandardMaterial({ map: corkTexture(), roughness: 0.9 }));
    this.cork.position.y = H - 0.01;
    this.cork.castShadow = true;
    this.group.add(this.lidGlass, this.cork);

    // Condensation (+ algae) on the wall and under the lid.
    this.film = filmTexture(view.sectors, view.bands);
    const tile = 0.22;
    this.wallUniforms = {
      uDrops: { value: dropletTexture(1024) },
      uFilm: { value: this.film },
      uRepeat: { value: new THREE.Vector2(Math.round((2 * Math.PI * R) / tile), airH / tile) },
      uBase: { value: -airH / 2 },
      uAirHeight: { value: airH },
      uRadius: { value: R },
      uMode: { value: 0 },
      uLidFilm: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0, 0, 0) },
      uAmbient: { value: new THREE.Color(0.2, 0.2, 0.2) },
    };
    const wallFog = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, airH, 128, 1, true), condensationMaterial(this.wallUniforms));
    wallFog.position.y = soilDepth + airH / 2;
    wallFog.renderOrder = 3;
    this.lidUniforms = { ...this.wallUniforms, uMode: { value: 1 }, uLidFilm: { value: 0 } };
    this.lidFog = new THREE.Mesh(new THREE.CircleGeometry(innerR, 96), condensationMaterial(this.lidUniforms));
    this.lidFog.rotation.x = Math.PI / 2;
    this.lidFog.position.y = H - 0.0005;
    this.lidFog.renderOrder = 3;
    this.group.add(wallFog, this.lidFog);

    const contact = new THREE.Mesh(new THREE.CircleGeometry(R * 1.25, 64), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -GLASS_T + 0.0005;
    this.group.add(contact);
  }

  update(f: FrameData): void {
    const v = f.scene;
    writeFilm(this.film, v.glassFilm, v.glassAlgae);
    this.lidUniforms.uLidFilm.value = v.lidFilm;

    const sub = v.soil.find((l) => l.material === 'substrate' || l.material === 'sand');
    if (sub && this.subMat) {
      const k = Math.pow(sub.saturation, 0.7);
      const dry = sub.material === 'sand' ? new THREE.Color('#d8c49a') : SUBSTRATE_DRY;
      const wet = sub.material === 'sand' ? new THREE.Color('#8f7a58') : SUBSTRATE_WET;
      const c = dry.clone().lerp(wet, k);
      this.subMat.color.copy(c);
      this.topMat.color.copy(c.clone().lerp(new THREE.Color('#ffffff'), 0.25));
      this.topMat.roughness = 0.97 - 0.35 * k;
    }
    const leca = v.soil.find((l) => l.material === 'leca');
    if (leca && this.lecaWater && this.lecaMat) {
      const level = Math.max(0, (leca.saturation - 0.15) / 0.85);
      this.lecaWater.visible = level > 0.02;
      const h = Math.max(0.001, level * this.lecaThick);
      this.lecaWater.scale.y = h;
      this.lecaWater.position.y = this.lecaBase + h / 2;
      // Sulphide blackening when the drainage layer goes septic.
      const black = Math.min(1, Math.max(0, leca.redox - 2) / 2);
      this.lecaMat.color.set('#7a3f22').lerp(new THREE.Color('#1e1a18'), black);
      (this.lecaWater.material as THREE.MeshPhysicalMaterial).color.set('#6f8f8a').lerp(new THREE.Color('#2a2a22'), black);
    }

    this.lidGlass.visible = f.lid === 'glass' || f.lid === 'sealed';
    this.cork.visible = f.lid === 'cork';
    this.lidFog.visible = f.lid === 'glass' || f.lid === 'sealed';

    // Plants: rebuild geometry only when growth or turgor changed noticeably.
    const seen = new Set<number>();
    for (const p of v.plants) {
      seen.add(p.id);
      const sig = plantSignature(p);
      let entry = this.plants.get(p.id);
      if (!entry || entry.sig !== sig) {
        if (entry) this.plantGroup.remove(entry.group);
        const g = buildPlant(p);
        g.position.set(p.x, this.soilTop, p.z);
        this.plantGroup.add(g);
        entry = { group: g, sig };
        this.plants.set(p.id, entry);
      }
      entry.group.userData.plantId = p.id;
      tintPlant(entry.group, p);
    }
    for (const [id, e] of this.plants) {
      if (!seen.has(id)) {
        this.plantGroup.remove(e.group);
        this.plants.delete(id);
      }
    }

    this.moss.update(v.surface);
    this.surface.update(v);
    this.fauna.update(v.agents, v.cohorts);
  }

  plantAt(obj: THREE.Object3D): number | undefined {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData.plantId !== undefined) return o.userData.plantId;
      o = o.parent;
    }
    return undefined;
  }

  pickTargets(): THREE.Object3D[] {
    return [this.plantGroup, this.topMesh];
  }
}

export function createView(canvas: HTMLCanvasElement): TerrariumView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 20);
  camera.position.set(0.42, 0.3, 0.62);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.12, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.08;
  controls.maxDistance = 1.8;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.update();

  // Room.
  const wood = woodTexture();
  wood.repeat.set(2, 2);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = -GLASS_T;
  table.receiveShadow = true;
  scene.add(table);
  const skyMat = new THREE.MeshBasicMaterial({ color: '#20242c', side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), skyMat));

  // Lights.
  const sun = new THREE.DirectionalLight('#fff4e0', 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -0.5;
  sc.right = sc.top = 0.5;
  sc.near = 0.1;
  sc.far = 5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight('#bcd4ff', '#5a4632', 0.2);
  scene.add(sky);
  const lamp = new THREE.PointLight('#ffc98a', 0, 3, 1.6);
  lamp.position.set(-0.6, 0.9, 0.3);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  scene.add(lamp);
  const led = new THREE.SpotLight('#f4f0ff', 0, 1.8, Math.PI / 5, 0.6, 1.2);
  led.castShadow = true;
  scene.add(led, led.target);
  const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 }));
  scene.add(ledBar);

  // Post-processing: gentle bloom on wet highlights + vignette.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.5, 0.88));
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.35 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5)); c.rgb *= 1.0 - uStrength * smoothstep(0.35, 0.85, d); gl_FragColor = c; }',
    }),
  );
  composer.addPass(new OutputPass());
  let highQuality = true;

  let terr: Terrarium | null = null;
  let jarKey = '';
  const skyNight = new THREE.Color('#0e1118');
  const skyDay = new THREE.Color('#c9d6e3');
  const tmp = new THREE.Color();
  const raycaster = new THREE.Raycaster();
  let baseDistance = camera.position.distanceTo(controls.target);

  function update(f: FrameData): void {
    const key = JSON.stringify([f.scene.jar, f.scene.hardscape]);
    if (key !== jarKey) {
      if (terr) scene.remove(terr.group);
      terr = new Terrarium(f.scene);
      scene.add(terr.group);
      jarKey = key;
      const H = f.scene.jar.height;
      led.position.set(0, H + 0.3, 0);
      led.target.position.set(0, 0, 0);
      ledBar.position.set(0, H + 0.3, 0);
      controls.target.set(0, H * 0.4, 0);
      const k = Math.max(H / 0.3, f.scene.jar.radius / 0.12);
      camera.position.set(0.42 * k, 0.3 * k, 0.62 * k);
      baseDistance = camera.position.distanceTo(controls.target);
      resize();
    }
    terr!.update(f);

    const dir = sunVector(Math.max(f.sun.elevation, -0.2), f.sun.azimuth);
    const dayness = THREE.MathUtils.clamp(f.sun.diffuse / 25, 0, 1);
    sun.position.copy(dir).multiplyScalar(2.5);
    sun.target.position.set(0, 0.1, 0);
    const warm = THREE.MathUtils.clamp(Math.sin(Math.max(f.sun.elevation, 0)) * 2.5, 0, 1);
    sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.44 * warm);
    sun.intensity = f.sun.direct > 0 ? 0.9 + f.sun.direct / 450 : dayness * 0.9;
    sky.intensity = 0.08 + dayness * 1.4;
    scene.environmentIntensity = 0.12 + dayness * 0.7;
    tmp.copy(skyNight).lerp(skyDay, dayness);
    skyMat.color.copy(tmp);
    const hour = f.readout.hour;
    const evening = hour >= 17.5 || hour < 6.5;
    lamp.intensity = evening ? THREE.MathUtils.lerp(0.9, 0.0, dayness) : 0;
    const ledOn = f.sun.led > 0;
    led.intensity = ledOn ? 2.2 : 0;
    ledBar.visible = f.placement === 'ledShelf';
    (ledBar.material as THREE.MeshStandardMaterial).emissiveIntensity = ledOn ? 3 : 0;

    const u = terr!.wallUniforms;
    const keyDir = ledOn ? new THREE.Vector3(0, 1, 0) : f.sun.direct > 0 || dayness > 0.05 ? dir : lamp.position.clone().normalize();
    u.uSunDir.value.copy(keyDir);
    const ks = ledOn ? 0.9 : f.sun.direct > 0 ? 1.0 : dayness > 0.05 ? dayness * 0.6 : lamp.intensity * 0.5;
    u.uSunColor.value.setRGB(ks, ks * 0.96, ks * 0.9);
    const amb = 0.12 + dayness * 0.55 + (evening ? 0.15 : 0);
    u.uAmbient.value.setRGB(amb, amb, amb * 1.05);
  }

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const fit = baseDistance * Math.max(1, 1.25 / camera.aspect);
    const d = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(d, fit);
  }

  function render(dt: number): void {
    controls.update();
    terr?.fauna.animate(dt);
    if (highQuality) composer.render();
    else renderer.render(scene, camera);
  }

  function setMacro(on: boolean): void {
    if (!terr) return;
    const top = terr.soilTop;
    if (on) {
      controls.target.set(0, top + 0.02, 0);
      camera.position.set(0.13, top + 0.1, 0.27);
    } else {
      const H = terr.view.jar.height;
      const k = Math.max(H / 0.3, terr.view.jar.radius / 0.12);
      controls.target.set(0, H * 0.4, 0);
      camera.position.set(0.42 * k, 0.3 * k, 0.62 * k);
      resize();
    }
  }

  function pick(clientX: number, clientY: number): { x: number; z: number; plantId?: number } | null {
    if (!terr) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(terr.pickTargets(), true);
    if (!hits.length) return null;
    const h = hits[0];
    return { x: h.point.x, z: h.point.z, plantId: terr.plantAt(h.object) };
  }

  resize();
  return { update, render, resize, setQuality: (hq) => (highQuality = hq), setMacro, pick };
}

function jarProfile(R: number, H: number): THREE.Vector2[] {
  const profile: THREE.Vector2[] = [];
  const rimR = 0.004;
  profile.push(new THREE.Vector2(0, -GLASS_T));
  profile.push(new THREE.Vector2(R + GLASS_T - 0.01, -GLASS_T));
  for (let a = 0; a <= 8; a++) {
    const t = (a / 8) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R + GLASS_T - 0.01 + Math.sin(t) * 0.01, -GLASS_T + 0.01 - Math.cos(t) * 0.01));
  }
  profile.push(new THREE.Vector2(R + GLASS_T, H - rimR));
  for (let a = 0; a <= 8; a++) {
    const t = (a / 8) * Math.PI;
    profile.push(new THREE.Vector2(R + GLASS_T / 2 + Math.cos(t) * (GLASS_T / 2), H - rimR + Math.sin(t) * rimR));
  }
  profile.push(new THREE.Vector2(R, 0.006));
  profile.push(new THREE.Vector2(R - 0.006, 0));
  profile.push(new THREE.Vector2(0, 0));
  return profile;
}

function lecaPebbles(innerR: number, base: number, thickness: number): THREE.InstancedMesh {
  const rnd = makeRandom(21);
  const geo = smoothSphere(1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const s = 1 + Math.sin(p.getX(i) * 7) * Math.cos(p.getY(i) * 5) * 0.06;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.92, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  const count = Math.round(2200 * (innerR / 0.12) ** 2 * (thickness / 0.035));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: clayTexture(), roughness: 0.92 }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const rr = innerR * (0.55 + 0.42 * Math.sqrt(rnd()));
    const a = rnd() * Math.PI * 2;
    const r = 0.005 + rnd() * 0.0045;
    const yy = base + r * 0.8 + rnd() * Math.max(0, thickness - r * 1.6);
    v.set(Math.cos(a) * Math.min(rr, innerR - r * 0.9), yy, Math.sin(a) * Math.min(rr, innerR - r * 0.9));
    q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
    s.setScalar(r);
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function hardscape(stones: { x: number; z: number; size: number }[], soilTop: number): THREE.Group {
  const group = new THREE.Group();
  const rnd = makeRandom(77);
  const stoneTex = stoneTexture();
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, bumpMap: stoneTex, bumpScale: 2, roughness: 0.88 });
  const v3 = new THREE.Vector3();
  for (const st of stones) {
    const geo = smoothSphere(5);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const seed = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      v3.set(p.getX(i), p.getY(i), p.getZ(i));
      const n =
        0.18 * Math.sin(v3.x * 3.1 + seed) * Math.cos(v3.z * 2.7 + seed) +
        0.08 * Math.sin(v3.y * 7.3 + seed * 2) +
        0.04 * Math.sin((v3.x + v3.z) * 13 + seed) +
        0.012 * Math.sin(v3.x * 41 + seed) * Math.sin(v3.z * 37 - seed);
      v3.multiplyScalar(1 + n);
      v3.y *= 0.62;
      p.setXYZ(i, v3.x, v3.y, v3.z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, stoneMat);
    mesh.scale.setScalar(st.size);
    mesh.rotation.y = seed;
    mesh.position.set(st.x, soilTop + st.size * 0.25, st.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function smoothSphere(detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const merged = mergeVertices(g);
  const p = merged.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 0.5 + Math.atan2(p.getZ(i), p.getX(i)) / (2 * Math.PI);
    uv[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, p.getY(i)))) / Math.PI;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}
