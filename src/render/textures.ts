import * as THREE from 'three';

/** Small deterministic PRNG so textures look the same every load. */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Peat/coir potting mix: dark crumbs, fibres and bits of bark. Greyscale so it can be tinted by moisture. */
export function substrateTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const rnd = makeRandom(7);
  g.fillStyle = '#9c9c9c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 70 + rnd() * 170;
    g.fillStyle = `rgb(${v},${v},${v})`;
    const r = 0.6 + rnd() * rnd() * 5;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, r, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < 500; i++) {
    const v = 120 + rnd() * 110;
    g.strokeStyle = `rgba(${v},${v * 0.95},${v * 0.85},0.8)`;
    g.lineWidth = 0.6 + rnd() * 1.2;
    const x = rnd() * 512;
    const y = rnd() * 512;
    const a = rnd() * Math.PI * 2;
    const l = 4 + rnd() * 14;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return toTexture(c, 1, true);
}

/** Crushed activated charcoal. */
export function charcoalTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const rnd = makeRandom(11);
  g.fillStyle = '#121214';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 15 + rnd() * 55;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    const s = 1 + rnd() * 5;
    g.save();
    g.translate(rnd() * 256, rnd() * 256);
    g.rotate(rnd() * Math.PI);
    g.fillRect(-s / 2, -s / 3, s, s * 0.66);
    g.restore();
  }
  return toTexture(c, 1, true);
}

/** Clay pebble surface: pitted terracotta. */
export function clayTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const rnd = makeRandom(3);
  g.fillStyle = '#a65a33';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? `rgba(200,120,80,${0.2 + rnd() * 0.3})` : `rgba(70,30,15,${0.2 + rnd() * 0.4})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 0.5 + rnd() * 2, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, 1, true);
}

/** Warm oak table top. */
export function woodTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024);
  const rnd = makeRandom(5);
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#6d4a2f');
  grad.addColorStop(0.5, '#7d5738');
  grad.addColorStop(1, '#6a462c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) {
    const y0 = rnd() * 1024;
    const amp = 2 + rnd() * 10;
    const freq = 0.002 + rnd() * 0.006;
    const ph = rnd() * 10;
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '40,24,12' : '150,110,75'},${0.08 + rnd() * 0.18})`;
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c, 1, true);
}

/** Cork: speckled tan. */
export function corkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const rnd = makeRandom(13);
  g.fillStyle = '#b98b5a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    const d = rnd();
    g.fillStyle = d > 0.6 ? `rgba(90,55,25,${0.3 + rnd() * 0.5})` : `rgba(220,180,130,${0.2 + rnd() * 0.3})`;
    g.beginPath();
    g.arc(rnd() * 256, rnd() * 256, 0.4 + rnd() * 1.8, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, 1, true);
}

/**
 * Condensation droplet atlas, RGBA8:
 *   R,G  droplet surface normal (xy, 0.5-centred)
 *   B    film level at which the droplet becomes visible (small droplets appear first)
 *   A    droplet thickness (0 outside droplets)
 */
export function dropletTexture(size = 1024): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 0;
  }
  const rnd = makeRandom(42);
  const drops: { x: number; y: number; r: number; th: number; sx: number }[] = [];
  const count = 5200;
  for (let i = 0; i < count; i++) {
    const th = Math.pow(rnd(), 1.4); // appearance threshold
    // Droplet size grows with the film level at which it appears (coalescence).
    const r = size * (0.0022 + 0.02 * Math.pow(th, 2.2) * (0.6 + rnd() * 0.8));
    drops.push({ x: rnd() * size, y: rnd() * size, r, th: 0.02 + th * 0.93, sx: 0.85 + rnd() * 0.3 });
  }
  drops.sort((a, b) => a.th - b.th);
  for (const d of drops) {
    const ry = d.r * (1.05 + (d.r / size) * 8); // big drops sag downward
    const x0 = Math.floor(d.x - d.r * d.sx - 1);
    const x1 = Math.ceil(d.x + d.r * d.sx + 1);
    const y0 = Math.floor(d.y - ry - 1);
    const y1 = Math.ceil(d.y + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x - d.x) / (d.r * d.sx);
        const ny = (y - d.y) / ry;
        const q = nx * nx + ny * ny;
        if (q >= 1) continue;
        const px = ((x % size) + size) % size;
        const py = ((y % size) + size) % size;
        const k = (py * size + px) * 4;
        const h = Math.sqrt(1 - q);
        data[k] = Math.round((nx * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round((-ny * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round(d.th * 255);
        data[k + 3] = Math.round(h * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
