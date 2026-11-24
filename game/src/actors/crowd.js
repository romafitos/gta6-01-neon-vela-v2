// Low-poly people built from boxes (legs, torso, arms, head, hair) with a walk cycle. Every
// person in the city shares six instanced meshes, so a crowd of forty costs six draw calls.
// Each character is a handle with a plain Object3D `root` for its transform; the crowd writes
// the per-part instance matrices once per frame in sync().
import * as THREE from 'three';

const geo = new THREE.BoxGeometry(1, 1, 1);
const PARTS = [
  // name, pivot (x, y), size (x, y, z), offset from pivot
  { name: 'legL', pivot: [-0.14, 0.95], size: [0.22, 0.9, 0.24], off: [0, -0.45, 0], color: 'pants', swing: 1 },
  { name: 'legR', pivot: [0.14, 0.95], size: [0.22, 0.9, 0.24], off: [0, -0.45, 0], color: 'pants', swing: -1 },
  { name: 'torso', pivot: [0, 1.27], size: [0.56, 0.62, 0.32], off: [0, 0, 0], color: 'shirt', swing: 0 },
  { name: 'armL', pivot: [-0.36, 1.52], size: [0.15, 0.62, 0.17], off: [0, -0.3, 0], color: 'skin', swing: -0.8 },
  { name: 'armR', pivot: [0.36, 1.52], size: [0.15, 0.62, 0.17], off: [0, -0.3, 0], color: 'skin', swing: 0.8 },
  { name: 'head', pivot: [0, 1.75], size: [0.3, 0.3, 0.3], off: [0, 0, 0], color: 'skin', swing: 0 },
  { name: 'hair', pivot: [0, 1.93], size: [0.32, 0.1, 0.32], off: [0, 0, 0], color: 'hair', swing: 0 },
];

export function createCrowd(scene, capacity = 96) {
  const meshes = PARTS.map((part) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), capacity);
    m.count = 0;
    m.castShadow = true;
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

  function add({ shirt = 0xff3d8b, pants = 0x2b2d42, skin = 0xc68b59, hair = 0x1b1b1b } = {}) {
    const index = members.length;
    if (index >= capacity) throw new Error('crowd capacity reached');
    const colors = { shirt, pants, skin, hair };
    PARTS.forEach((part, i) => {
      meshes[i].setColorAt(index, color.setHex(colors[part.color]));
      meshes[i].count = index + 1;
      meshes[i].instanceColor.needsUpdate = true;
    });
    const root = new THREE.Object3D();
    let phase = 0;
    let amp = 0;
    const handle = {
      root,
      index,
      animate(speed, dt) {
        phase += dt * (3 + speed * 1.4);
        amp = Math.min(0.9, speed * 0.12);
      },
      swing: () => Math.sin(phase) * amp,
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
      const sw = h.swing();
      PARTS.forEach((part, i) => {
        e.set(sw * part.swing, 0, 0);
        q.setFromEuler(e);
        mPivot.compose(v.set(part.pivot[0], part.pivot[1], 0), q, s.set(1, 1, 1));
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
