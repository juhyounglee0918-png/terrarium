import * as THREE from 'three';

/**
 * Condensation on the inner glass surface.
 *
 * The simulation supplies a film load (0..1 of run-off threshold) per glass node. The shader
 * turns that into: a fine haze of micro-droplets at low load, discrete droplets that grow with
 * load (from a precomputed droplet atlas), and clear run-off tracks once droplets coalesce and
 * slide down — the tracks sweep the haze away, as on real glass.
 */
const vertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uDrops;
  uniform sampler2D uFilm;
  uniform vec2 uRepeat;
  uniform float uBase;
  uniform float uAirHeight;
  uniform float uRadius;
  uniform int uMode;          // 0 = wall, 1 = lid
  uniform float uLidFilm;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;

  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

  void main() {
    float film;
    vec2 duv;
    vec3 T, B, Nsurf;
    float u = 0.0;
    if (uMode == 0) {
      float az = atan(vLocal.x, -vLocal.z);
      if (az < 0.0) az += 6.28318530718;
      u = az / 6.28318530718;
      float v = clamp((vLocal.y - uBase) / uAirHeight, 0.0, 1.0);
      film = texture2D(uFilm, vec2(u, v)).r;
      duv = vec2(u * uRepeat.x, v * uRepeat.y);
      Nsurf = normalize(vec3(-vLocal.x, 0.0, -vLocal.z));
      T = normalize(vec3(cos(az), 0.0, sin(az)));
      B = vec3(0.0, 1.0, 0.0);
    } else {
      film = uLidFilm;
      duv = (vLocal.xy / (2.0 * uRadius) + 0.5) * uRepeat.x * 0.4;
      Nsurf = vec3(0.0, -1.0, 0.0);
      T = vec3(1.0, 0.0, 0.0);
      B = vec3(0.0, 0.0, 1.0);
    }

    // film is the load relative to run-off (≈300 g/m²). Micro-droplet haze appears at a few g/m²;
    // droplets then grow roughly with the square root of the load.
    vec4 d = texture2D(uDrops, duv);
    float growth = sqrt(film);
    float vis = smoothstep(d.b - 0.04, d.b + 0.01, growth) * smoothstep(0.02, 0.2, d.a);
    float haze = smoothstep(0.002, 0.03, film);

    // Run-off tracks (wall only): coalesced drops slide down and wipe the haze.
    float track = 0.0;
    if (uMode == 0) {
      float col = floor(u * 180.0);
      float h = hash(col + 17.0);
      float fx = fract(u * 180.0);
      float lane = smoothstep(0.5, 0.15, abs(fx - 0.5)) * step(0.72, h);
      float wet = smoothstep(0.85, 1.0, film);
      float along = 0.5 + 0.5 * sin(vLocal.y * (60.0 + 90.0 * hash(col)) + h * 20.0);
      track = lane * wet * (0.65 + 0.35 * along);
    }

    vec2 nxy = (d.rg - 0.5) * 2.0;
    vec3 N = normalize(Nsurf * max(d.a, 0.15) + (T * nxy.x + B * nxy.y) * vis);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);
    vec3 R = reflect(-L, N);
    float spec = pow(max(dot(R, V), 0.0), 48.0) * vis;
    // Droplets are lenses: mostly clear, a thin dark rim where light is totally internally
    // reflected, a bright focused spot near the bottom, and a specular glint.
    float rim = vis * (1.0 - smoothstep(0.0, 0.3, d.a));
    float focus = vis * pow(d.a, 6.0) * smoothstep(0.0, -0.6, nxy.y);
    float lum = dot(uAmbient, vec3(0.333)) + dot(uSunColor, vec3(0.333)) * 0.5;

    vec3 hazeCol = vec3(0.95, 0.97, 1.0) * (uAmbient * 1.35 + uSunColor * 0.45);
    float hazeA = haze * 0.42 * (1.0 - vis * 0.92) * (1.0 - track * 0.9);
    vec3 dropCol = vec3(0.9, 0.94, 0.97) * (uAmbient * 1.2 + uSunColor * 0.4) + uSunColor * (spec * 3.0 + focus * 0.8);
    float dropA = vis * 0.04 + rim * 0.28 * clamp(lum, 0.25, 1.0) + spec * 0.85 + focus * 0.25 + track * 0.05;

    float a = clamp(hazeA + dropA, 0.0, 0.92);
    vec3 col = (hazeCol * hazeA + dropCol * dropA) / max(a, 1e-4);
    col = mix(col, col * 0.45, rim * 0.7);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface CondensationUniforms {
  [key: string]: THREE.IUniform;
  uDrops: THREE.IUniform<THREE.Texture>;
  uFilm: THREE.IUniform<THREE.Texture>;
  uRepeat: THREE.IUniform<THREE.Vector2>;
  uBase: THREE.IUniform<number>;
  uAirHeight: THREE.IUniform<number>;
  uRadius: THREE.IUniform<number>;
  uMode: THREE.IUniform<number>;
  uLidFilm: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uAmbient: THREE.IUniform<THREE.Color>;
}

export function condensationMaterial(uniforms: CondensationUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Film load texture: one texel per glass node (sectors × bands), R channel = load. */
export function filmTexture(sectors: number, bands: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(sectors * bands * 4), sectors, bands, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function writeFilm(t: THREE.DataTexture, film: ArrayLike<number>): void {
  const data = t.image.data as Uint8Array;
  for (let i = 0; i < film.length; i++) data[i * 4] = Math.round(Math.min(1, Math.max(0, film[i])) * 255);
  t.needsUpdate = true;
}
