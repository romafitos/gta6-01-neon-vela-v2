// Low-poly people with rounded proportions: capsule legs with shoes, hips, a tapered torso,
// sleeves over skin-tone arms with hands, a neck, an oval head and a hair cap, all with a walk
// cycle. Every person in the city shares one instanced mesh per body part (a dozen draw calls for
// the whole crowd). Each character is a handle with a plain Object3D `root` for its transform;
// the crowd writes the per-part instance matrices once per frame in sync(). A character whose
// root is tipped over (dead, knocked down) is drawn sprawled: arms out, legs apart.
import * as THREE from 'three';

function unitCapsule() {
  const g = new THREE.CapsuleGeometry(0.5, 1, 1, 6);
  g.scale(1, 0.5, 1); // height 1 overall, rounded ends
  return g;
}
const capsule = unitCapsule();
const sphere = new THREE.SphereGeometry(0.5, 10, 7);
const tiny = new THREE.SphereGeometry(0.5, 5, 4);
const cap = new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
const shoe = new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);

const PARTS = [
  // name, geometry, pivot (x, y), size (x, y, z), offset from pivot, colour key, walk swing, sprawl (x, z)
  { name: 'legL', geo: capsule, pivot: [-0.12, 0.95], size: [0.2, 0.92, 0.22], off: [0, -0.45, 0], color: 'pants', swing: 1, sprawl: [0, -0.35] },
  { name: 'legR', geo: capsule, pivot: [0.12, 0.95], size: [0.2, 0.92, 0.22], off: [0, -0.45, 0], color: 'pants', swing: -1, sprawl: [0, 0.35] },
  { name: 'shoeL', geo: shoe, pivot: [-0.12, 0.95], size: [0.2, 0.16, 0.32], off: [0, -0.93, 0.05], color: 'shoe', swing: 1, sprawl: [0, -0.35] },
  { name: 'shoeR', geo: shoe, pivot: [0.12, 0.95], size: [0.2, 0.16, 0.32], off: [0, -0.93, 0.05], color: 'shoe', swing: -1, sprawl: [0, 0.35] },
  { name: 'hips', geo: capsule, pivot: [0, 1.0], size: [0.44, 0.26, 0.26], off: [0, 0, 0], color: 'pants', swing: 0 },
  { name: 'torso', geo: capsule, pivot: [0, 1.3], size: [0.5, 0.64, 0.28], off: [0, 0, 0], color: 'shirt', swing: 0 },
  { name: 'armL', geo: capsule, pivot: [-0.31, 1.52], size: [0.13, 0.62, 0.13], off: [0, -0.3, 0], color: 'skin', swing: -0.8, sprawl: [0, -1.3] },
  { name: 'armR', geo: capsule, pivot: [0.31, 1.52], size: [0.13, 0.62, 0.13], off: [0, -0.3, 0], color: 'skin', swing: 0.8, sprawl: [0, 1.3] },
  { name: 'sleeveL', geo: capsule, pivot: [-0.31, 1.52], size: [0.17, 0.3, 0.17], off: [0, -0.1, 0], color: 'shirt', swing: -0.8, sprawl: [0, -1.3] },
  { name: 'sleeveR', geo: capsule, pivot: [0.31, 1.52], size: [0.17, 0.3, 0.17], off: [0, -0.1, 0], color: 'shirt', swing: 0.8, sprawl: [0, 1.3] },
  { name: 'handL', geo: tiny, pivot: [-0.31, 1.52], size: [0.11, 0.12, 0.11], off: [0, -0.63, 0], color: 'skin', swing: -0.8, sprawl: [0, -1.3] },
  { name: 'handR', geo: tiny, pivot: [0.31, 1.52], size: [0.11, 0.12, 0.11], off: [0, -0.63, 0], color: 'skin', swing: 0.8, sprawl: [0, 1.3] },
  { name: 'neck', geo: cylinder, pivot: [0, 1.62], size: [0.11, 0.12, 0.11], off: [0, 0, 0], color: 'skin', swing: 0 },
  { name: 'head', geo: sphere, pivot: [0, 1.79], size: [0.27, 0.31, 0.29], off: [0, 0, 0], color: 'skin', swing: 0 },
  { name: 'hair', geo: cap, pivot: [0, 1.81], size: [0.295, 0.3, 0.31], off: [0, 0, -0.012], color: 'hair', swing: 0 },
];

export function createCrowd(scene, capacity = 96) {
  const meshes = PARTS.map((part) => {
    const m = new THREE.InstancedMesh(part.geo, new THREE.MeshStandardMaterial({ roughness: 0.75 }), capacity);
    m.count = 0;
    m.castShadow = part.name === 'torso' || part.name.startsWith('leg') || part.name === 'head';
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    return m;
  });
  const members = [];
  const mRoot = new THREE.Matrix4();
  const mPivot = new THREE.Matrix4();
  const mPart = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const color = new THREE.Color();

  function add({ shirt = 0xff3d8b, pants = 0x2b2d42, skin = 0xc68b59, hair = 0x1b1b1b, shoe: shoeHex } = {}) {
    const index = members.length;
    if (index >= capacity) throw new Error('crowd capacity reached');
    const colors = { shirt, pants, skin, hair, shoe: shoeHex ?? [0x2a2a2e, 0xf0f0f0, 0x6b4a2e][index % 3] };
    PARTS.forEach((part, i) => {
      meshes[i].setColorAt(index, color.setHex(colors[part.color]));
      meshes[i].count = index + 1;
      meshes[i].instanceColor.needsUpdate = true;
    });
    const root = new THREE.Object3D();
    let phase = index * 0.7;
    let amp = 0;
    const handle = {
      root,
      index,
      animate(speed, dt) {
        phase += dt * (3 + speed * 1.4);
        amp = Math.min(0.9, speed * 0.12);
      },
      swing: () => Math.sin(phase) * amp,
      bob: () => Math.abs(Math.cos(phase)) * amp * 0.05,
    };
    members.push(handle);
    return handle;
  }

  /** Writes every member's part matrices from its root transform and limb swing. */
  function sync() {
    for (const h of members) {
      if (!h.root.visible) {
        for (const m of meshes) m.setMatrixAt(h.index, hidden);
        continue;
      }
      h.root.updateMatrix();
      mRoot.copy(h.root.matrix);
      const down = Math.abs(h.root.rotation.x) > 1 || Math.abs(h.root.rotation.z) > 1;
      const sw = down ? 0 : h.swing();
      const bob = down ? 0 : h.bob();
      PARTS.forEach((part, i) => {
        const sp = down && part.sprawl ? part.sprawl : null;
        e.set(sp ? sp[0] : sw * part.swing, 0, sp ? sp[1] : 0);
        q.setFromEuler(e);
        mPivot.compose(v.set(part.pivot[0], part.pivot[1] + bob, 0), q, s.set(1, 1, 1));
        mPart.compose(v.set(part.off[0], part.off[1], part.off[2]), q.identity(), s.set(part.size[0], part.size[1], part.size[2]));
        mPivot.multiply(mPart).premultiply(mRoot);
        meshes[i].setMatrixAt(h.index, mPivot);
      });
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** Repaints one member's clothes (pooled slots reused by another gang). */
  function paint(handle, colors) {
    PARTS.forEach((part, i) => {
      const hex = colors[part.color];
      if (hex == null) return;
      meshes[i].setColorAt(handle.index, color.setHex(hex));
      meshes[i].instanceColor.needsUpdate = true;
    });
  }

  return { add, sync, paint, members };
}
