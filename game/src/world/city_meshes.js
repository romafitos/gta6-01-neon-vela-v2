// Turns the city layout into a few large instanced meshes (cheap on a weak GPU): asphalt, sidewalks,
// lane paint, window-textured towers with emissive lit windows, rooftop neon outlines, parks,
// streetlights, palms, the beach and the sea. All textures are drawn procedurally on canvases.
import * as THREE from 'three';
import { CITY, PALETTE } from '../core/config.js';

export function createCityMeshes(scene, layout, random) {
  const group = new THREE.Group();
  scene.add(group);
  const { roadX, roadZ, bounds } = layout;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const dummy = new THREE.Object3D();

  // ---- ground: asphalt under the whole city ----
  const cityW = bounds.maxX - bounds.minX;
  const cityD = bounds.beachStart - bounds.minZ;
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(cityW + 200, cityD + 200),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.92 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set((bounds.minX + bounds.maxX) / 2, 0, bounds.minZ + cityD / 2 - 100);
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // ---- sidewalks: one raised slab per block ----
  const walks = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.85 }), layout.blocks.length);
  layout.blocks.forEach((b, i) => {
    dummy.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    dummy.scale.set(b.maxX - b.minX, 0.14, b.maxZ - b.minZ);
    dummy.updateMatrix();
    walks.setMatrixAt(i, dummy.matrix);
  });
  walks.receiveShadow = true;
  group.add(walks);

  // ---- park lawns + fountains ----
  const grass = new THREE.MeshStandardMaterial({ color: 0x5f8f3e, roughness: 1 });
  for (const p of layout.parks) {
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX - 8, p.maxZ - p.minZ - 8), grass);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set((p.minX + p.maxX) / 2, 0.16, (p.minZ + p.maxZ) / 2);
    lawn.receiveShadow = true;
    group.add(lawn);
    const f = p.fountain;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.9, 20), new THREE.MeshStandardMaterial({ color: 0xd8cbb8 }));
    basin.position.set((f.minX + f.maxX) / 2, 0.45, (f.minZ + f.maxZ) / 2);
    group.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x47c4d8, emissive: 0x1a6070, roughness: 0.2 }));
    water.position.set(basin.position.x, 0.86, basin.position.z);
    group.add(water);
  }

  // ---- lane paint: dashed centre lines ----
  const dashes = [];
  for (const x of roadX) for (let z = roadZ[0]; z < roadZ[roadZ.length - 1]; z += 8) dashes.push([x, z + 2, 0.25, 3.5]);
  for (const z of roadZ) for (let x = roadX[0]; x < roadX[roadX.length - 1]; x += 8) dashes.push([x + 2, z, 3.5, 0.25]);
  const paint = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xf2d16b, roughness: 0.6, emissive: 0x3a2a00 }), dashes.length);
  dashes.forEach(([x, z, w, d], i) => {
    dummy.position.set(x, 0.01, z);
    dummy.scale.set(w, 0.02, d);
    dummy.updateMatrix();
    paint.setMatrixAt(i, dummy.matrix);
  });
  group.add(paint);

  // ---- buildings: three height classes, each with its own window tiling ----
  const classes = [
    { max: 20, floorsPerTex: 4 },
    { max: 45, floorsPerTex: 8 },
    { max: Infinity, floorsPerTex: 16 },
  ];
  const tex = makeWindowTextures(random);
  for (const cls of classes) {
    const list = layout.buildings.filter((b, idx) => {
      const prevMax = classes[classes.indexOf(cls) - 1]?.max ?? 0;
      return b.height > prevMax && b.height <= cls.max && idx >= 0;
    });
    if (!list.length) continue;
    const color = tex.color.clone();
    const glow = tex.glow.clone();
    for (const t of [color, glow]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, cls.floorsPerTex / 8);
      t.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({ map: color, emissiveMap: glow, emissive: 0xffc27a, emissiveIntensity: 1.25, roughness: 0.7, metalness: 0.1 });
    const mesh = new THREE.InstancedMesh(box, mat, list.length);
    const c = new THREE.Color();
    list.forEach((b, i) => {
      dummy.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      dummy.scale.set(b.maxX - b.minX, b.height, b.maxZ - b.minZ);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, c.setHex(PALETTE.buildingColors[b.colorIndex]));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- rooftop neon outlines + street-facing neon signs ----
  const bars = [];
  for (const b of layout.buildings) {
    if (!b.neon) continue;
    const y = b.height;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    bars.push([cx, y, b.minZ, w + 0.3, 0.35, 0.35, b.neonColor]);
    bars.push([cx, y, b.maxZ, w + 0.3, 0.35, 0.35, b.neonColor]);
    bars.push([b.minX, y, cz, 0.35, 0.35, d + 0.3, b.neonColor]);
    bars.push([b.maxX, y, cz, 0.35, 0.35, d + 0.3, b.neonColor]);
    // vertical sign on the south face, its base 4 m above the sidewalk
    const signH = Math.min(10, b.height * 0.45);
    bars.push([cx + w * 0.3, 4, b.maxZ + 0.25, 1.4, signH, 0.3, (b.neonColor + 1) % 5]);
  }
  const neon = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), bars.length);
  const nc = new THREE.Color();
  bars.forEach(([x, y, z, w, h, d, ci], i) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    neon.setMatrixAt(i, dummy.matrix);
    neon.setColorAt(i, nc.setHex(PALETTE.neon[ci]).multiplyScalar(1.4));
  });
  group.add(neon);

  // ---- streetlights at intersections ----
  const poles = layout.nodes.length;
  const poleMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x3b3646 }), poles);
  const lampMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffe1a0 }), poles);
  layout.nodes.forEach((n, i) => {
    const x = n.x + CITY.road / 2 + 1.2;
    const z = n.z + CITY.road / 2 + 1.2;
    dummy.position.set(x, 0, z); dummy.scale.set(0.25, 7, 0.25); dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x - 0.6, 6.8, z - 0.6); dummy.scale.set(1.2, 0.3, 1.2); dummy.updateMatrix();
    lampMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(poleMesh, lampMesh);

  // ---- beach, sea, palms ----
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(cityW + 400, CITY.beachDepth + 30),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((bounds.minX + bounds.maxX) / 2, 0.02, bounds.beachStart + CITY.beachDepth / 2 - 5);
  sand.receiveShadow = true;
  group.add(sand);

  const seaMat = new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 0.18, metalness: 0.55, emissive: 0x0b2a3a });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, CITY.seaDepth * 2), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.15, bounds.beachEnd + CITY.seaDepth);
  group.add(sea);

  const surf = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3), new THREE.MeshBasicMaterial({ color: 0xfff1dc, transparent: true, opacity: 0.7 }));
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(0, 0.04, bounds.beachEnd);
  group.add(surf);

  const trunkMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 1 }), layout.palms.length);
  const leafGeo = new THREE.ConeGeometry(3.2, 1.6, 7);
  const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.9 }), layout.palms.length);
  layout.palms.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, 0, p.lean * 0.4); dummy.scale.set(0.45, p.h, 0.45); dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x - Math.sin(p.lean * 0.4) * p.h, p.h, p.z); dummy.rotation.set(Math.PI, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    leafMesh.setMatrixAt(i, dummy.matrix);
  });
  trunkMesh.castShadow = true;
  leafMesh.castShadow = true;
  group.add(trunkMesh, leafMesh);
  dummy.rotation.set(0, 0, 0);

  let t = 0;
  function update(dt) {
    t += dt;
    surf.material.opacity = 0.45 + Math.sin(t * 1.3) * 0.25;
    surf.position.z = bounds.beachEnd + Math.sin(t * 0.65) * 1.6;
  }

  return { group, update };
}

/** Window atlas: wall colour map (tinted per instance) + glow map with warm lit windows. */
function makeWindowTextures(random) {
  const w = 64;
  const h = 128;
  const make = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cc = make();
  const gc = make();
  const cx = cc.getContext('2d');
  const gx = gc.getContext('2d');
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, w, h);
  gx.fillStyle = '#000000';
  gx.fillRect(0, 0, w, h);
  const cols = 4;
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * 16 + 3;
      const y = r * 16 + 4;
      cx.fillStyle = '#3d4a66';
      cx.fillRect(x, y, 10, 9);
      cx.fillStyle = '#7f93b8';
      cx.fillRect(x, y, 10, 2);
      if (random() < 0.38) {
        gx.fillStyle = random() < 0.8 ? '#ffd18a' : '#8af3ff';
        gx.fillRect(x, y, 10, 9);
      }
    }
  }
  const color = new THREE.CanvasTexture(cc);
  color.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.CanvasTexture(gc);
  glow.colorSpace = THREE.SRGBColorSpace;
  for (const t of [color, glow]) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; }
  return { color, glow };
}
