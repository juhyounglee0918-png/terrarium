import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FrameData } from '../worker/protocol';
import { condensationMaterial, filmTexture, writeFilm, type CondensationUniforms } from './condensation';
import {
  charcoalTexture,
  clayTexture,
  corkTexture,
  dropletTexture,
  makeRandom,
  substrateTexture,
  woodTexture,
} from './textures';

/**
 * World axes: +X east, +Y up, −Z north. The window faces south (+Z), behind the default camera.
 * Units are metres, matching the simulation.
 */
export interface TerrariumView {
  update(frame: FrameData): void;
  render(): void;
  resize(): void;
}

const SUBSTRATE_DRY = new THREE.Color('#b08a66');
const SUBSTRATE_WET = new THREE.Color('#5a3f2c');

export function sunVector(elevation: number, azimuth: number): THREE.Vector3 {
  const c = Math.cos(elevation);
  return new THREE.Vector3(Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c).normalize();
}

export function createView(canvas: HTMLCanvasElement, jar: { radius: number; height: number; layers: { material: string; thickness: number }[] }, bands: number, sectors: number): TerrariumView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
  camera.position.set(0.42, 0.3, 0.62);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.12, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.18;
  controls.maxDistance = 1.6;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.update();

  const R = jar.radius;
  const H = jar.height;
  const glassT = 0.004;
  const soilDepth = jar.layers.reduce((s, l) => s + l.thickness, 0);
  const airH = H - soilDepth;
  const innerR = R - 0.0006;

  // ---------------------------------------------------------------- room
  const wood = woodTexture();
  wood.repeat.set(2, 2);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -glassT;
  table.receiveShadow = true;
  scene.add(table);

  // Backdrop dome whose colour follows the daylight.
  const skyMat = new THREE.MeshBasicMaterial({ color: '#20242c', side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), skyMat));

  // ---------------------------------------------------------------- lights
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

  const led = new THREE.SpotLight('#f4f0ff', 0, 1.5, Math.PI / 5, 0.6, 1.2);
  led.position.set(0, H + 0.3, 0);
  led.target.position.set(0, 0, 0);
  led.castShadow = true;
  scene.add(led, led.target);
  const ledBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.012, 0.05),
    new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 }),
  );
  ledBar.position.set(0, H + 0.3, 0);
  scene.add(ledBar);

  // ---------------------------------------------------------------- substrate
  const jarGroup = new THREE.Group();
  scene.add(jarGroup);
  const soilMeshes: Record<string, THREE.Mesh> = {};
  const subTex = substrateTexture();
  const charTex = charcoalTexture();
  let y = 0;
  const lecaWater: THREE.Mesh[] = [];
  for (const layer of jar.layers) {
    const geo = new THREE.CylinderGeometry(innerR - 0.0004, innerR - 0.0004, layer.thickness, 96, 1, false);
    let mat: THREE.MeshStandardMaterial;
    if (layer.material === 'substrate') {
      const t = subTex.clone();
      t.repeat.set(6, 1.2);
      t.needsUpdate = true;
      mat = new THREE.MeshStandardMaterial({ map: t, color: SUBSTRATE_DRY, roughness: 0.95 });
    } else if (layer.material === 'charcoal') {
      const t = charTex.clone();
      t.repeat.set(10, 0.6);
      t.needsUpdate = true;
      mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0.05 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: '#7a3f22', roughness: 1 });
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y + layer.thickness / 2;
    m.receiveShadow = true;
    jarGroup.add(m);
    soilMeshes[layer.material] = m;

    if (layer.material === 'leca') {
      addLecaPebbles(jarGroup, innerR, y, layer.thickness);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(innerR - 0.0008, innerR - 0.0008, 1, 96, 1, false),
        new THREE.MeshPhysicalMaterial({ color: '#6f8f8a', transparent: true, opacity: 0.45, roughness: 0.1, transmission: 0 }),
      );
      water.userData.base = y;
      water.userData.thickness = layer.thickness;
      water.visible = false;
      jarGroup.add(water);
      lecaWater.push(water);
    }
    y += layer.thickness;
  }
  // Substrate top: a slightly mounded disc.
  const topGeo = new THREE.CircleGeometry(innerR - 0.0004, 96, 0, Math.PI * 2);
  const pos = topGeo.attributes.position as THREE.BufferAttribute;
  const rnd = makeRandom(9);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const rr = Math.hypot(px, py) / innerR;
    pos.setZ(i, (1 - rr * rr) * 0.008 + (rnd() - 0.5) * 0.0012 * (1 - rr));
  }
  topGeo.computeVertexNormals();
  const topTex = subTex.clone();
  topTex.repeat.set(1.6, 1.6);
  topTex.needsUpdate = true;
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, color: SUBSTRATE_DRY, roughness: 0.96 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = soilDepth;
  top.receiveShadow = true;
  jarGroup.add(top);

  addHardscape(jarGroup, soilDepth, innerR);

  // ---------------------------------------------------------------- glass
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    thickness: glassT * 2,
    ior: 1.5,
    attenuationColor: new THREE.Color('#dff5ea'),
    attenuationDistance: 0.25,
    specularIntensity: 1,
    envMapIntensity: 1,
  });
  // The condensation layer sits just inside the glass; don't let the glass occlude it.
  glassMat.depthWrite = false;
  const profile: THREE.Vector2[] = [];
  const rimR = 0.004;
  // Outer wall bottom → top, lip, inner wall top → bottom, inner floor.
  profile.push(new THREE.Vector2(0, -glassT));
  profile.push(new THREE.Vector2(R + glassT - 0.01, -glassT));
  for (let a = 0; a <= 8; a++) {
    const t = (a / 8) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R + glassT - 0.01 + Math.sin(t) * 0.01, -glassT + 0.01 - Math.cos(t) * 0.01));
  }
  profile.push(new THREE.Vector2(R + glassT, H - rimR));
  for (let a = 0; a <= 8; a++) {
    const t = (a / 8) * Math.PI;
    profile.push(new THREE.Vector2(R + glassT / 2 + Math.cos(t) * (glassT / 2), H - rimR + Math.sin(t) * rimR));
  }
  profile.push(new THREE.Vector2(R, 0.006));
  profile.push(new THREE.Vector2(R - 0.006, 0));
  profile.push(new THREE.Vector2(0, 0));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), glassMat);
  glass.castShadow = false;
  glass.renderOrder = 2;
  jarGroup.add(glass);

  // Contact shadow under the jar (glass transmits, so the real shadow is soft and light).
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(R * 1.25, 64),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -glassT + 0.0005;
  scene.add(contact);

  // ---------------------------------------------------------------- lid
  const lidGlass = new THREE.Mesh(new THREE.CylinderGeometry(R + glassT + 0.006, R + glassT + 0.006, glassT, 96), glassMat);
  lidGlass.position.y = H + glassT / 2;
  jarGroup.add(lidGlass);
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.002, R - 0.006, 0.03, 64),
    new THREE.MeshStandardMaterial({ map: corkTexture(), roughness: 0.9 }),
  );
  cork.position.y = H - 0.01;
  cork.castShadow = true;
  jarGroup.add(cork);

  // ---------------------------------------------------------------- condensation
  const drops = dropletTexture(1024);
  const film = filmTexture(sectors, bands);
  const circumference = 2 * Math.PI * R;
  const tile = 0.22; // metres of glass per droplet-atlas tile
  const wallUniforms: CondensationUniforms = {
    uDrops: { value: drops },
    uFilm: { value: film },
    uRepeat: { value: new THREE.Vector2(Math.round(circumference / tile), airH / tile) },
    uBase: { value: soilDepth },
    uAirHeight: { value: airH },
    uRadius: { value: R },
    uMode: { value: 0 },
    uLidFilm: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0, 0, 0) },
    uAmbient: { value: new THREE.Color(0.2, 0.2, 0.2) },
  };
  const wallFog = new THREE.Mesh(
    new THREE.CylinderGeometry(innerR, innerR, airH, 128, 1, true),
    condensationMaterial(wallUniforms),
  );
  wallFog.position.y = soilDepth + airH / 2;
  wallFog.renderOrder = 3;
  jarGroup.add(wallFog);
  // CylinderGeometry is centred on its origin: shift the shader's base accordingly.
  wallUniforms.uBase.value = -airH / 2;

  const lidUniforms: CondensationUniforms = { ...wallUniforms, uMode: { value: 1 }, uLidFilm: { value: 0 } };
  const lidFog = new THREE.Mesh(new THREE.CircleGeometry(innerR, 96), condensationMaterial(lidUniforms));
  lidFog.rotation.x = Math.PI / 2;
  lidFog.position.y = H - 0.0005;
  lidFog.renderOrder = 3;
  jarGroup.add(lidFog);

  // ---------------------------------------------------------------- update
  const skyNight = new THREE.Color('#0e1118');
  const skyDay = new THREE.Color('#c9d6e3');
  const tmp = new THREE.Color();

  function update(f: FrameData): void {
    writeFilm(film, f.scene.glassFilm);
    lidUniforms.uLidFilm.value = f.scene.lidFilm;

    // Substrate darkens as it wets.
    const sub = f.scene.soil.find((l) => l.material === 'substrate');
    if (sub) {
      const k = Math.pow(sub.saturation, 0.7);
      tmp.copy(SUBSTRATE_DRY).lerp(SUBSTRATE_WET, k);
      (soilMeshes.substrate.material as THREE.MeshStandardMaterial).color.copy(tmp);
      topMat.color.copy(tmp);
      topMat.roughness = 0.97 - 0.35 * k;
    }
    // Perched water table in the drainage layer.
    for (const w of lecaWater) {
      const leca = f.scene.soil.find((l) => l.material === 'leca');
      const level = leca ? Math.max(0, (leca.saturation - 0.15) / 0.85) : 0;
      w.visible = level > 0.02;
      const h = Math.max(0.001, level * w.userData.thickness);
      w.scale.y = h;
      w.position.y = w.userData.base + h / 2;
    }

    // Lid variant.
    lidGlass.visible = f.lid === 'glass' || f.lid === 'sealed';
    cork.visible = f.lid === 'cork';
    lidFog.visible = f.lid !== 'open' && f.lid !== 'cork';

    // Daylight.
    const dir = sunVector(Math.max(f.sun.elevation, -0.2), f.sun.azimuth);
    const dayness = THREE.MathUtils.clamp(f.sun.diffuse / 25, 0, 1);
    sun.position.copy(dir).multiplyScalar(2.5);
    sun.target.position.set(0, 0.1, 0);
    const warm = THREE.MathUtils.clamp(Math.sin(Math.max(f.sun.elevation, 0)) * 2.5, 0, 1);
    sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.44 * warm);
    // Direct beam only reaches the jar on the windowsill; otherwise light is soft skylight.
    sun.intensity = f.sun.direct > 0 ? 0.9 + f.sun.direct / 450 : dayness * 0.9;
    sun.shadow.radius = f.sun.direct > 0 ? 2 : 12;
    sky.intensity = 0.08 + dayness * 1.4;
    scene.environmentIntensity = 0.12 + dayness * 0.7;
    tmp.copy(skyNight).lerp(skyDay, dayness);
    skyMat.color.copy(tmp);

    // Room lamp in the evening/night so the jar stays visible.
    const hour = f.readout.hour;
    const evening = hour >= 17.5 || hour < 6.5;
    lamp.intensity = evening ? THREE.MathUtils.lerp(0.9, 0.0, dayness) : 0;

    const ledOn = f.sun.led > 0;
    led.intensity = ledOn ? 2.2 : 0;
    ledBar.visible = f.placement === 'ledShelf';
    (ledBar.material as THREE.MeshStandardMaterial).emissiveIntensity = ledOn ? 3 : 0;

    // Feed condensation shading with the dominant light.
    const key = ledOn ? new THREE.Vector3(0, 1, 0) : f.sun.direct > 0 || dayness > 0.05 ? dir : lamp.position.clone().normalize();
    wallUniforms.uSunDir.value.copy(key);
    const keyStrength = ledOn ? 0.9 : f.sun.direct > 0 ? 1.0 : dayness > 0.05 ? dayness * 0.6 : lamp.intensity * 0.5;
    wallUniforms.uSunColor.value.setRGB(keyStrength, keyStrength * 0.96, keyStrength * 0.9);
    const amb = 0.12 + dayness * 0.55 + (evening ? 0.15 : 0);
    wallUniforms.uAmbient.value.setRGB(amb, amb, amb * 1.05);
  }

  const baseDistance = camera.position.distanceTo(controls.target);
  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Keep the whole jar in frame on portrait screens.
    const fit = baseDistance * Math.max(1, 1.25 / camera.aspect);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, fit);
  }

  function render(): void {
    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  return { update, render, resize };
}

function addLecaPebbles(group: THREE.Group, innerR: number, base: number, thickness: number): void {
  const rnd = makeRandom(21);
  const geo = smoothSphere(1);
  // Squash vertices slightly for irregular pebbles.
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const s = 1 + (Math.sin(p.getX(i) * 7) * Math.cos(p.getY(i) * 5) * 0.06);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.92, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: clayTexture(), roughness: 0.92 });
  const count = 2200;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Bias toward the wall where pebbles are visible.
    const rr = innerR * (0.55 + 0.42 * Math.sqrt(rnd()));
    const a = rnd() * Math.PI * 2;
    const r = 0.005 + rnd() * 0.0045;
    const yy = base + r * 0.8 + rnd() * Math.max(0, thickness - r * 1.6);
    v.set(Math.cos(a) * Math.min(rr, innerR - r * 0.9), yy, Math.sin(a) * Math.min(rr, innerR - r * 0.9));
    e.set(rnd() * 6, rnd() * 6, rnd() * 6);
    q.setFromEuler(e);
    s.setScalar(r);
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
}

function addHardscape(group: THREE.Group, soilTop: number, innerR: number): void {
  const rnd = makeRandom(77);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#6c6a66', roughness: 0.9 });
  const stones: [number, number, number, number][] = [
    [-0.045, 0.03, 0.038, 0],
    [0.05, -0.035, 0.024, 1.3],
    [0.015, 0.06, 0.016, 2.1],
  ];
  for (const [x, z, size, rot] of stones) {
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
    mesh.scale.setScalar(size);
    mesh.rotation.y = rot;
    const d = Math.hypot(x, z);
    const k = d > innerR - size ? (innerR - size) / d : 1;
    mesh.position.set(x * k, soilTop + size * 0.25, z * k);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}
const v3 = new THREE.Vector3();

/** Indexed icosphere (shared vertices) so displaced shapes get smooth normals. */
function smoothSphere(detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const merged = mergeVertices(g);
  // Spherical UVs for textured variants.
  const p = merged.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 0.5 + Math.atan2(p.getZ(i), p.getX(i)) / (2 * Math.PI);
    uv[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, p.getY(i)))) / Math.PI;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}
