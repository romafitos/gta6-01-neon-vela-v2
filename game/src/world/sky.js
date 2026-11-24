// Golden-hour sky: a gradient dome with a low sun over the sea, matching fog, a warm key light
// that casts shadows around the player, and a cool hemisphere fill for the neon side of dusk.
import * as THREE from 'three';
import { PALETTE } from '../core/config.js';

export function createSky(scene) {
  const sunDir = new THREE.Vector3(-0.55, 0.16, 0.82).normalize(); // low, over the sea to the south-west

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
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          col = mix(col, top, smoothstep(0.16, 0.65, h));
          col = mix(col, horizon * 0.8, smoothstep(0.0, -0.2, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          // a hard sun disc, its halo, then a broad amber bloom that sits low along the sea line
          float disc = pow(s, 1100.0) * 3.4;
          float halo = pow(s, 30.0) * 0.8 + pow(s, 5.0) * 0.2;
          float seaLine = 1.0 - smoothstep(-0.02, 0.22, h);
          col += sunColor * (disc + halo);
          col += vec3(1.0, 0.5, 0.22) * pow(s, 2.5) * seaLine * 0.42;
          // thin streaky clouds catching the light
          float band = sin(vDir.x * 9.0 + vDir.z * 3.0) * sin(vDir.z * 13.0 - vDir.x * 2.0);
          float cloud = smoothstep(0.55, 0.95, band) * smoothstep(0.04, 0.12, h) * (1.0 - smoothstep(0.18, 0.35, h));
          col = mix(col, vec3(1.0, 0.62, 0.55), cloud * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.fog = new THREE.Fog(PALETTE.fog, 90, 520);
  scene.background = new THREE.Color(PALETTE.horizon);

  // Dusk fill. Sky side: violet-blue from the open sky. Ground side: orange bounce off sand and
  // stucco. A low peach ambient on top lifts the streets in tower shadow without washing out
  // the sunlit sand.
  const hemi = new THREE.HemisphereLight(0xb9b0ff, 0xa36a4a, 1.65);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffd0b0, 0.4);
  scene.add(ambient);

  // the key light: low orange sun, a touch under the old strength so sand stays golden, not white
  const sun = new THREE.DirectionalLight(0xff9f5e, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
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
