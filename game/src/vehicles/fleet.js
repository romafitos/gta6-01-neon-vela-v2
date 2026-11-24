// Smooth low-poly cars drawn as one fleet. Every car is built from the same handful of shared
// geometries — a bevelled wedge body, a raked glasshouse, a painted roof panel, tyres with alloy
// rims, head/tail lamps, a dark grille, police door bands and light bars — each part one instanced
// mesh shared by every car, so the whole city's traffic stays at a dozen draw calls.
// Each car is a handle with an Object3D `root` transform.
import * as THREE from 'three';
import { carBodyGeo, cabinGeo, softBox, wheelGeos } from '../core/shapes.js';

const bodyGeo = carBodyGeo();
const glassGeo = cabinGeo();
const soft = softBox(0.2);
const { tyre: tyreGeo, rim: rimGeo } = wheelGeos();

// body [width, height, length], cabin [width, height, length], cabin offset along the car
export const CAR_VARIANTS = [
  { name: 'Sabre Coupe', body: [2.0, 0.78, 4.4], cabin: [1.66, 0.56, 2.1], cabinZ: -0.35 },
  { name: 'Vela Taxi', body: [2.0, 0.86, 4.6], cabin: [1.74, 0.62, 2.5], cabinZ: -0.15, taxi: true },
  { name: 'Dune Pickup', body: [2.1, 0.95, 4.8], cabin: [1.86, 0.7, 1.7], cabinZ: 0.55 },
  { name: 'Neon GT', body: [2.04, 0.64, 4.4], cabin: [1.56, 0.46, 1.9], cabinZ: -0.45 },
  { name: 'VCPD Interceptor', body: [2.05, 0.8, 4.7], cabin: [1.72, 0.58, 2.2], cabinZ: -0.25, police: true },
];
export const POLICE_VARIANT = 4;
const CLEAR = 0.26; // ground clearance under the body

export function createFleet(scene, capacity = 64) {
  const mk = (geo, material, cap = capacity, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, material, cap);
    m.count = 0; m.castShadow = shadow; m.receiveShadow = false; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    return m;
  };
  const paintMat = () => new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.25 });
  const body = mk(bodyGeo, paintMat());
  const roof = mk(soft, paintMat(), capacity, false);
  const cabin = mk(glassGeo, new THREE.MeshStandardMaterial({ color: 0x223146, roughness: 0.08, metalness: 0.85, emissive: 0x0d1724 }));
  const grille = mk(soft, new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 }), capacity * 2, false);
  const band = mk(soft, new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.35, metalness: 0.2 }), capacity, false);
  const heads = mk(soft, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), capacity * 2, false);
  const tails = mk(soft, new THREE.MeshBasicMaterial({ color: 0xff2a3c }), capacity * 2, false);
  const signs = mk(soft, new THREE.MeshBasicMaterial({ color: 0xffe066 }), capacity, false);
  // police light bars: a red and a blue lamp per car on a dark base, blinking in turn
  const bars = mk(soft, new THREE.MeshBasicMaterial({ toneMapped: false }), capacity * 2, false);
  const barBase = mk(soft, new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.5 }), capacity, false);
  const tyres = mk(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.92 }), capacity * 4, false);
  const rims = mk(rimGeo, new THREE.MeshStandardMaterial({ color: 0xd6d9e0, roughness: 0.25, metalness: 0.9 }), capacity * 4, false);

  const cars = [];
  const c = new THREE.Color();
  const local = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const all = [body, roof, cabin, grille, band, heads, tails, signs, bars, barBase, tyres, rims];

  function add(color, variantIndex = 0) {
    const index = cars.length;
    const variant = CAR_VARIANTS[variantIndex % CAR_VARIANTS.length];
    body.setColorAt(index, c.setHex(color));
    roof.setColorAt(index, c.setHex(color));
    body.instanceColor.needsUpdate = roof.instanceColor.needsUpdate = true;
    body.count = roof.count = cabin.count = signs.count = band.count = barBase.count = index + 1;
    bars.count = grille.count = heads.count = tails.count = (index + 1) * 2;
    bars.setColorAt(index * 2, c.setHex(0xff2030));
    bars.setColorAt(index * 2 + 1, c.setHex(0x2a6bff));
    bars.instanceColor.needsUpdate = true;
    tyres.count = rims.count = (index + 1) * 4;
    const handle = { root: new THREE.Object3D(), index, variant, spin: 0, steer: 0 };
    handle.animate = (speed, steer, dt) => { handle.spin += (speed * dt) / 0.39; handle.steer = steer * 0.45; };
    cars.push(handle);
    return handle;
  }

  const put = (mesh, i, root, x, y, z, sx, sy, sz) => {
    local.compose(v.set(x, y, z), q.identity(), s.set(sx, sy, sz));
    out.multiplyMatrices(root, local);
    mesh.setMatrixAt(i, out);
  };

  let clock = 0;
  /** Repaints one car (garage resprays, police livery, burnt wrecks). */
  function setColor(h, hex, roofHex = hex) {
    body.setColorAt(h.index, c.setHex(hex));
    roof.setColorAt(h.index, c.setHex(roofHex));
    body.instanceColor.needsUpdate = roof.instanceColor.needsUpdate = true;
  }

  function sync(dt = 1 / 60) {
    clock += dt;
    for (const h of cars) {
      const i = h.index;
      h.root.updateMatrix();
      const R = h.root.matrix;
      const [bw, bh, bl] = h.variant.body;
      const [cw, ch, cl] = h.variant.cabin;
      const cz = h.variant.cabinZ;
      const top = CLEAR + bh * 0.9; // where the glasshouse sits
      put(body, i, R, 0, CLEAR, 0, bw, bh, bl);
      put(cabin, i, R, 0, top, cz, cw, ch, cl);
      put(roof, i, R, 0, top + ch * 0.985, cz - cl * 0.09, cw * 0.86, 0.07, cl * 0.4);
      // lamps sit on the nose and tail faces
      const ly = CLEAR + bh * 0.5;
      put(heads, i * 2, R, -bw * 0.33, ly, bl / 2 - 0.02, 0.42, 0.13, 0.1);
      put(heads, i * 2 + 1, R, bw * 0.33, ly, bl / 2 - 0.02, 0.42, 0.13, 0.1);
      put(tails, i * 2, R, -bw * 0.32, CLEAR + bh * 0.62, -bl / 2 - 0.01, 0.5, 0.12, 0.1);
      put(tails, i * 2 + 1, R, bw * 0.32, CLEAR + bh * 0.62, -bl / 2 - 0.01, 0.5, 0.12, 0.1);
      put(grille, i * 2, R, 0, CLEAR + bh * 0.2, bl / 2 + 0.02, bw * 0.62, bh * 0.2, 0.1);
      put(grille, i * 2 + 1, R, 0, CLEAR + bh * 0.2, -bl / 2 - 0.02, bw * 0.7, bh * 0.18, 0.1);
      if (h.variant.taxi) put(signs, i, R, 0, top + ch + 0.17, cz, 0.7, 0.2, 0.32);
      else signs.setMatrixAt(i, zero);
      if (h.variant.police && !h.dark) {
        put(band, i, R, 0, CLEAR + bh * 0.42, -0.1, bw * 1.012, bh * 0.36, bl * 0.5);
        const blink = Math.floor(clock * 6) % 2;
        const by = top + ch + 0.13;
        put(barBase, i, R, 0, by - 0.06, cz - 0.05, 1.3, 0.08, 0.34);
        put(bars, i * 2, R, -0.34, by, cz - 0.05, 0.6, blink ? 0.22 : 0.15, 0.3);
        put(bars, i * 2 + 1, R, 0.34, by, cz - 0.05, 0.6, blink ? 0.15 : 0.22, 0.3);
      } else {
        band.setMatrixAt(i, zero); barBase.setMatrixAt(i, zero);
        bars.setMatrixAt(i * 2, zero); bars.setMatrixAt(i * 2 + 1, zero);
      }
      let w = 0;
      for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        e.set(h.spin, z > 0 ? h.steer : 0, 0, 'YXZ');
        q.setFromEuler(e);
        local.compose(v.set(x * (bw / 2 - 0.16), 0.39, z * (bl / 2 - 0.86)), q, s.set(1, 1, 1));
        out.multiplyMatrices(R, local);
        tyres.setMatrixAt(i * 4 + w, out);
        rims.setMatrixAt(i * 4 + w, out);
        w++;
      }
    }
    for (const m of all) m.instanceMatrix.needsUpdate = true;
  }

  return { add, sync, setColor, cars };
}
