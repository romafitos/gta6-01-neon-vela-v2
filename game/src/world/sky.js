// Golden-hour sky: a gradient dome with a low sun over the sea, matching fog, a warm key light
// that casts shadows around the player, and a cool hemisphere fill for the neon side of dusk.
import * as THREE from 'three';
import { PALETTE } from '../core/config.js';

export function createSky(scene) {
  const sunDir = new THREE.Vector3(-0.5, 0.3, 0.81).normalize(); // low, over the sea to the south-west

  const uniforms = {
    top: { value: new THREE.Color(PALETTE.skyTop) },
    mid: { value: new THREE.Color(PALETTE.skyMid) },
    horizon: { value: new THREE.Color(PALETTE.horizon) },
    sunColor: { value: new THREE.Color(PALETTE.sun) },
    sunDir: { value: sunDir.clone() },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, top, smoothstep(0.2, 0.75, h));
          col = mix(col, horizon * 0.85, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, sunDir), 0.0);
          // sun disc, a warm halo, and a soft glow sitting on the sea line
          col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.12);
          col += vec3(1.0, 0.62, 0.32) * pow(s, 3.0) * (1.0 - smoothstep(-0.02, 0.25, h)) * 0.3;
          // puffy cumulus: fbm projected on a dome, lit warm on the sun side, grey-blue beneath
          vec2 uv = d.xz / (d.y + 0.18) * 1.6;
          float n = fbm(uv + vec2(3.1, 7.7));
          float cloud = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.14, h);
          float lit = clamp(fbm(uv * 1.3 + sunDir.xz * 0.6) * 1.4, 0.0, 1.0);
          vec3 cc = mix(vec3(0.72, 0.76, 0.86), vec3(1.0, 0.95, 0.88), lit) + sunColor * pow(s, 6.0) * 0.4;
          col = mix(col, cc, cloud * 0.9);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.fog = new THREE.Fog(PALETTE.fog, 180, 980);
  scene.background = new THREE.Color(PALETTE.horizon);

  // Dusk fill. Sky side: violet-blue from the open sky. Ground side: orange bounce off sand and
  // stucco. A low peach ambient on top lifts the streets in tower shadow without washing out
  // the sunlit sand.
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x9c8470, 1.55);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xfff0e0, 0.3);
  scene.add(ambient);

  // the key light: low orange sun, a touch under the old strength so sand stays golden, not white
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 10; s.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  /** Keeps the dome and the shadow frustum centred on the focus point (the player). */
  function follow(x, z) {
    dome.position.set(x, 0, z);
    sun.target.position.set(x, 0, z);
    sun.position.set(x + sunDir.x * 200, sunDir.y * 200 + 40, z + sunDir.z * 200);
  }

  return { dome, sun, hemi, ambient, sunDir, follow };
}
