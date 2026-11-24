// Low-poly cars drawn as one fleet: painted body + roof, glass cabin, head and tail lights, a taxi
// sign and four wheels per car, each part one instanced mesh shared by every car (a handful of
// draw calls for the whole city). Each car is a handle with an Object3D `root` transform.
import * as THREE from 'three';

const box = new THREE.BoxGeometry(1, 1, 1);
const c0 = new THREE.Color();
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
wheelGeo.rotateZ(Math.PI / 2);

export const CAR_VARIANTS = [
  { name: 'Sabre Coupe', body: [2.0, 0.7, 4.4], cabin: [1.7, 0.55, 2.0], cabinZ: -0.3 },
  { name: 'Vela Taxi', body: [2.0, 0.8, 4.6], cabin: [1.8, 0.6, 2.4], cabinZ: -0.1, taxi: true },
  { name: 'Dune Pickup', body: [2.1, 0.9, 4.8], cabin: [1.9, 0.7, 1.6], cabinZ: 0.6 },
  { name: 'Neon GT', body: [2.0, 0.55, 4.3], cabin: [1.6, 0.45, 1.7], cabinZ: -0.4 },
  { name: 'VCPD Interceptor', body: [2.05, 0.72, 4.7], cabin: [1.75, 0.55, 2.1], cabinZ: -0.2, police: true },
];
export const POLICE_VARIANT = 4;

export function createFleet(scene, capacity = 64) {
  const mk = (material, cap = capacity, shadow = true) => {
    const m = new THREE.InstancedMesh(box, material, cap);
    m.count = 0; m.castShadow = shadow; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    return m;
  };
  const body = mk(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }));
  const roof = mk(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }), capacity, false);
  const cabin = mk(new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.15, metalness: 0.6 }));
  const heads = mk(new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), capacity * 2, false);
  const tails = mk(new THREE.MeshBasicMaterial({ color: 0xff2040 }), capacity * 2, false);
  const signs = mk(new THREE.MeshBasicMaterial({ color: 0xffe066 }), capacity, false);
  // police light bars: a red and a blue block per car, blinking in turn
  const bars = mk(new THREE.MeshBasicMaterial({ toneMapped: false }), capacity * 2, false);
  bars.setColorAt(0, c0.setHex(0xff2030));
  const wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }), capacity * 4);
  wheels.count = 0; wheels.frustumCulled = false; wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(wheels);

  const cars = [];
  const c = new THREE.Color();
  const local = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  function add(color, variantIndex = 0) {
    const index = cars.length;
    const variant = CAR_VARIANTS[variantIndex % CAR_VARIANTS.length];
    body.setColorAt(index, c.setHex(color));
    roof.setColorAt(index, c.setHex(color));
    body.instanceColor.needsUpdate = roof.instanceColor.needsUpdate = true;
    body.count = roof.count = cabin.count = signs.count = index + 1;
    bars.count = (index + 1) * 2;
    bars.setColorAt(index * 2, c.setHex(0xff2030));
    bars.setColorAt(index * 2 + 1, c.setHex(0x2a6bff));
    bars.instanceColor.needsUpdate = true;
    heads.count = tails.count = (index + 1) * 2;
    wheels.count = (index + 1) * 4;
    const handle = { root: new THREE.Object3D(), index, variant, spin: 0, steer: 0 };
    handle.animate = (speed, steer, dt) => { handle.spin += (speed * dt) / 0.38; handle.steer = steer * 0.45; };
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
      put(body, i, R, 0, 0.35 + bh / 2, 0, bw, bh, bl);
      put(cabin, i, R, 0, 0.35 + bh + ch / 2, cz, cw, ch, cl);
      put(roof, i, R, 0, 0.35 + bh + ch + 0.04, cz, cw * 0.98, 0.08, cl * 0.9);
      put(heads, i * 2, R, -bw * 0.32, 0.35 + bh * 0.6, bl / 2 + 0.01, 0.4, 0.16, 0.05);
      put(heads, i * 2 + 1, R, bw * 0.32, 0.35 + bh * 0.6, bl / 2 + 0.01, 0.4, 0.16, 0.05);
      put(tails, i * 2, R, -bw * 0.32, 0.35 + bh * 0.65, -bl / 2 - 0.01, 0.45, 0.14, 0.05);
      put(tails, i * 2 + 1, R, bw * 0.32, 0.35 + bh * 0.65, -bl / 2 - 0.01, 0.45, 0.14, 0.05);
      if (h.variant.taxi) put(signs, i, R, 0, 0.35 + bh + ch + 0.17, cz, 0.7, 0.18, 0.35);
      else signs.setMatrixAt(i, zero);
      if (h.variant.police && !h.dark) {
        const blink = Math.floor(clock * 6) % 2;
        const big = 1.25;
        put(bars, i * 2, R, -0.4, 0.35 + bh + ch + 0.14, cz, 0.62, blink ? 0.2 * big : 0.14, 0.32);
        put(bars, i * 2 + 1, R, 0.4, 0.35 + bh + ch + 0.14, cz, 0.62, blink ? 0.14 : 0.2 * big, 0.32);
      } else { bars.setMatrixAt(i * 2, zero); bars.setMatrixAt(i * 2 + 1, zero); }
      let w = 0;
      for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        e.set(h.spin, z > 0 ? h.steer : 0, 0, 'YXZ');
        q.setFromEuler(e);
        local.compose(v.set(x * (bw / 2 - 0.05), 0.38, z * (bl / 2 - 0.85)), q, s.set(1, 1, 1));
        out.multiplyMatrices(R, local);
        wheels.setMatrixAt(i * 4 + w++, out);
      }
    }
    for (const m of [body, roof, cabin, heads, tails, signs, bars, wheels]) m.instanceMatrix.needsUpdate = true;
  }

  return { add, sync, setColor, cars };
}
