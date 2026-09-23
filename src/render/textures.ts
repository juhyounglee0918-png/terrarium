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

// ---------------------------------------------------------------- leaves

export interface LeafStyle {
  base: string; // blade colour
  edge?: string;
  vein: string;
  veinWidth: number;
  network: number; // 0 = pinnate only, 1 = dense reticulate (Fittonia)
  shape: 'ovate' | 'round' | 'lance' | 'heart' | 'pinna' | 'scale' | 'succulent';
  stripes?: string; // longitudinal stripes (Tradescantia) or bands (Haworthia)
  speckle?: string;
}

/** Leaf blade with alpha outline and veins. Texture v runs from petiole (0) to tip (1). */
export function leafTexture(style: LeafStyle, seed = 1): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = makeRandom(seed);
  const outline = new Path2D();
  const cx = W / 2;
  const widthAt = (t: number): number => {
    switch (style.shape) {
      case 'round':
        return Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.95 + 0.05;
      case 'lance':
        return Math.pow(Math.sin(Math.PI * t), 0.9) * 0.55 * (1 - t * 0.3);
      case 'heart':
        return (Math.sin(Math.PI * t) * 0.8 + (t < 0.25 ? 0.25 * (1 - t / 0.25) : 0)) * (1 - t * 0.2);
      case 'pinna':
        return Math.min(1, t * 6) * (1 - Math.pow(t, 3)) * 0.35;
      case 'scale':
        return Math.sin(Math.PI * t) * 0.6;
      case 'succulent':
        return (1 - t) * 0.9 + 0.05;
      default:
        return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8) * 0.78;
    }
  };
  outline.moveTo(cx, H - 2);
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    outline.lineTo(cx + widthAt(t) * (W / 2 - 4), H - 2 - t * (H - 6));
  }
  for (let i = 60; i >= 0; i--) {
    const t = i / 60;
    outline.lineTo(cx - widthAt(t) * (W / 2 - 4), H - 2 - t * (H - 6));
  }
  outline.closePath();
  g.save();
  g.clip(outline);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, style.edge ?? style.base);
  grad.addColorStop(0.5, style.base);
  grad.addColorStop(1, style.edge ?? style.base);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Subtle mottling.
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.03})`;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, 2 + rnd() * 8, 0, Math.PI * 2);
    g.fill();
  }
  if (style.stripes) {
    g.strokeStyle = style.stripes;
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      g.lineWidth = 10 + rnd() * 10;
      g.globalAlpha = 0.55;
      g.beginPath();
      if (style.shape === 'succulent') {
        // Haworthia: transverse white tubercle bands.
        for (let y = 20; y < H; y += 26 + rnd() * 10) {
          g.lineWidth = 5;
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(W, y + 6);
          g.stroke();
        }
        break;
      }
      g.moveTo(cx + k * 22, H);
      g.quadraticCurveTo(cx + k * 30, H / 2, cx + k * 6, 0);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (style.speckle) {
    g.fillStyle = style.speckle;
    for (let i = 0; i < 90; i++) {
      g.beginPath();
      g.arc(rnd() * W, rnd() * H, 2 + rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Veins: midrib, secondary veins, optional reticulate network.
  g.strokeStyle = style.vein;
  g.lineCap = 'round';
  if (style.shape !== 'succulent') {
    g.lineWidth = style.veinWidth * 1.8;
    g.beginPath();
    g.moveTo(cx, H);
    g.lineTo(cx, 8);
    g.stroke();
    const pairs = style.shape === 'pinna' ? 14 : 7;
    for (let i = 1; i <= pairs; i++) {
      const t = i / (pairs + 1);
      const y = H - t * H;
      const w = widthAt(t) * (W / 2 - 8);
      for (const side of [-1, 1]) {
        g.lineWidth = style.veinWidth;
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo(cx + side * w * 0.5, y - 20, cx + side * w * 0.95, y - 55 * (1 - t * 0.5));
        g.stroke();
      }
    }
    if (style.network > 0) {
      g.lineWidth = style.veinWidth * 0.55;
      for (let i = 0; i < 260 * style.network; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const a = rnd() * Math.PI;
        const l = 10 + rnd() * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Fibrous bump map for moss cushions. */
export function mossBumpTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const rnd = makeRandom(31);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const a = rnd() * Math.PI * 2;
    const l = 3 + rnd() * 7;
    const v = rnd() > 0.5 ? 220 : 40;
    g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    g.lineWidth = 0.8 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = toTexture(c, 3, false);
  return t;
}

/** Soft radial puff for mould hyphae and haze sprites. */
export function puffTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128);
  const rnd = makeRandom(17);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = rnd() * 20;
    const r1 = 30 + rnd() * 30;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0);
    g.lineTo(64 + Math.cos(a + (rnd() - 0.5) * 0.4) * r1, 64 + Math.sin(a + (rnd() - 0.5) * 0.4) * r1);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Weathered granite-like stone with lichen specks. */
export function stoneTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const rnd = makeRandom(61);
  g.fillStyle = '#7b7771';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = 70 + rnd() * 110;
    g.fillStyle = `rgba(${v},${v - 4},${v - 8},${0.25 + rnd() * 0.4})`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? '150,160,120' : '200,195,170'},${0.15 + rnd() * 0.2})`;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, 3 + rnd() * 14, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(40,38,35,0.35)';
  for (let i = 0; i < 25; i++) {
    g.lineWidth = 0.5 + rnd();
    g.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 60;
      y += (rnd() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c, 1, true);
}
