// Turns the city layout into a few large instanced meshes (cheap on a weak GPU): asphalt, sidewalks,
// lane paint, window-textured towers with emissive lit windows, rooftop neon outlines, parks,
// streetlights, palms, the beach and the sea. All textures are drawn procedurally on canvases.
import * as THREE from 'three';
import { CITY, PALETTE } from '../core/config.js';
import { palmGeo, umbrellaGeo, softBox } from '../core/shapes.js';

export function createCityMeshes(scene, layout, random) {
  const group = new THREE.Group();
  // decoration has its own seeded generator so props never shift the city's gameplay randomness
  let seed = 0x5eed1234;
  const deco = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, map: asphaltTexture(deco, (cityW + 200) / 12, (cityD + 200) / 12), roughness: 0.9 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set((bounds.minX + bounds.maxX) / 2, 0, bounds.minZ + cityD / 2 - 100);
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // ---- sidewalks: one raised slab per block ----
  const walkTex = tileTexture();
  const walks = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, map: walkTex, roughness: 0.85 }), layout.blocks.length);
  layout.blocks.forEach((b, i) => {
    dummy.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    dummy.scale.set(b.maxX - b.minX, 0.14, b.maxZ - b.minZ);
    dummy.updateMatrix();
    walks.setMatrixAt(i, dummy.matrix);
  });
  walks.receiveShadow = true;
  group.add(walks);

  // ---- kerbs: a pale bevelled stone edge around every block ----
  const kerbGeo = new THREE.BoxGeometry(1, 1, 1);
  kerbGeo.translate(0, 0.5, 0);
  const kerbs = new THREE.InstancedMesh(kerbGeo, new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.7 }), layout.blocks.length * 4);
  let k = 0;
  for (const b of layout.blocks) {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (const [x, z, sx, sz] of [[cx, b.minZ, w, 0.4], [cx, b.maxZ, w, 0.4], [b.minX, cz, 0.4, d], [b.maxX, cz, 0.4, d]]) {
      dummy.position.set(x, 0, z); dummy.scale.set(sx, 0.2, sz); dummy.updateMatrix();
      kerbs.setMatrixAt(k++, dummy.matrix);
    }
  }
  kerbs.receiveShadow = true;
  group.add(kerbs);

  // ---- beach promenade: a paved strip with a kerb between the beach road and the sand ----
  const promTex = walkTex.clone();
  promTex.repeat.set((cityW + 400) / 4, 1);
  promTex.needsUpdate = true;
  const prom = new THREE.Mesh(new THREE.BoxGeometry(cityW + 400, 0.14, 4), new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, map: promTex, roughness: 0.85 }));
  prom.position.set((bounds.minX + bounds.maxX) / 2, 0.07, bounds.beachStart + 2);
  prom.receiveShadow = true;
  const promKerb = new THREE.Mesh(new THREE.BoxGeometry(cityW + 400, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.7 }));
  promKerb.position.set(prom.position.x, 0.1, bounds.beachStart + 0.2);
  group.add(prom, promKerb);

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

  // ---- lane paint: double yellow centre lines, solid white edge lines and zebra crossings,
  //      broken at every intersection like a real street ----
  const half = CITY.road / 2;
  const yellow = [];
  const white = [];
  for (let i = 0; i < roadX.length; i++) {
    for (let j = 0; j + 1 < roadZ.length; j++) {
      const z0 = roadZ[j] + half + 3;
      const z1 = roadZ[j + 1] - half - 3;
      const zc = (z0 + z1) / 2;
      const len = z1 - z0;
      yellow.push([roadX[i] - 0.2, zc, 0.16, len], [roadX[i] + 0.2, zc, 0.16, len]);
      white.push([roadX[i] - half + 1.1, zc, 0.18, len], [roadX[i] + half - 1.1, zc, 0.18, len]);
    }
  }
  for (let j = 0; j < roadZ.length; j++) {
    for (let i = 0; i + 1 < roadX.length; i++) {
      const x0 = roadX[i] + half + 3;
      const x1 = roadX[i + 1] - half - 3;
      const xc = (x0 + x1) / 2;
      const len = x1 - x0;
      yellow.push([xc, roadZ[j] - 0.2, len, 0.16], [xc, roadZ[j] + 0.2, len, 0.16]);
      white.push([xc, roadZ[j] - half + 1.1, len, 0.18], [xc, roadZ[j] + half - 1.1, len, 0.18]);
    }
  }
  // zebra crossings on all four arms of every intersection
  for (const x of roadX) {
    for (const z of roadZ) {
      for (let n = -4; n <= 4; n++) {
        const o = n * 1.9;
        white.push([x + o, z - half - 1.6, 0.9, 2.6], [x + o, z + half + 1.6, 0.9, 2.6]);
        white.push([x - half - 1.6, z + o, 2.6, 0.9], [x + half + 1.6, z + o, 2.6, 0.9]);
      }
    }
  }
  const stripes = (list, color) => {
    const m = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), list.length);
    list.forEach(([x, z, w, d], i) => {
      dummy.position.set(x, 0.012, z); dummy.scale.set(w, 0.012, d); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.receiveShadow = true;
    group.add(m);
  };
  stripes(yellow, 0xf2c230);
  stripes(white, 0xf4f4f0);

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

  // ---- building detail: balconies on the south face, roof caps, rooftop AC units, awnings ----
  const balconies = [];
  const rails = [];
  const caps = [];
  const acs = [];
  const awnings = [];
  for (const b of layout.buildings) {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    caps.push([cx, b.height + 0.12, cz, w + 0.5, 0.35, d + 0.5, PALETTE.buildingColors[b.colorIndex]]);
    if (b.height > 20) {
      acs.push([cx - w * 0.22, b.height + 0.47, cz - d * 0.2, 1.5, 0.9, 1.5]);
      acs.push([cx + w * 0.25, b.height + 0.47, cz + d * 0.22, 1.2, 0.8, 1.2]);
    }
    if (b.height > 12) {
      const floors = Math.floor(b.height / 3.4);
      const n = 1 + Math.floor(deco() * 2.5);
      for (let k = 0; k < n; k++) {
        const fl = 1 + Math.floor(deco() * Math.max(1, floors - 1));
        const bx = b.minX + 3 + deco() * Math.max(1, w - 6);
        balconies.push([bx, fl * 3.4, b.maxZ + 0.6, 3.2, 0.22, 1.2]);
        rails.push([bx, fl * 3.4 + 0.55, b.maxZ + 1.15, 3.2, 0.5, 0.08]);
      }
    }
    if (b.height < 45 && deco() < 0.3) {
      awnings.push([b.minX + 2.5 + deco() * Math.max(1, w - 5), 3.3, b.maxZ + 0.8, 4, 0.18, 1.6]);
    }
  }
  const detailMesh = (list, color, opts = {}) => {
    const m = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }), list.length);
    list.forEach(([x, y, z, w, h, d], i) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(w, h, d); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  detailMesh(balconies, 0xe8e2d6);
  detailMesh(rails, 0x4a4552);
  const capMesh = detailMesh(caps.map(([x, y, z, w, h, d]) => [x, y, z, w, h, d]), 0xffffff);
  caps.forEach(([, , , , , , hex], i) => capMesh.setColorAt(i, new THREE.Color(hex).multiplyScalar(0.72)));
  capMesh.instanceColor.needsUpdate = true;
  detailMesh(acs, 0x9a9aa0, { metalness: 0.3 });
  const awnTex = awningTexture();
  const awnMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: awnTex, roughness: 0.7, side: THREE.DoubleSide }), awnings.length);
  awnings.forEach(([x, y, z, w, h, d], i) => {
    dummy.position.set(x, y, z); dummy.rotation.set(-0.32, 0, 0); dummy.scale.set(w, h, d); dummy.updateMatrix();
    awnMesh.setMatrixAt(i, dummy.matrix);
  });
  awnMesh.receiveShadow = true;
  group.add(awnMesh);
  dummy.rotation.set(0, 0, 0);

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
    new THREE.PlaneGeometry(cityW + 400, CITY.beachDepth + 14),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((bounds.minX + bounds.maxX) / 2, 0.02, bounds.beachStart + 4 + (CITY.beachDepth + 14) / 2);
  sand.receiveShadow = true;
  group.add(sand);

  const seaMat = new THREE.MeshStandardMaterial({ color: 0x2fa8c4, roughness: 0.32, metalness: 0.12, emissive: 0x1a5566, emissiveIntensity: 0.7 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, CITY.seaDepth * 2), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.15, bounds.beachEnd + CITY.seaDepth);
  group.add(sea);

  const surf = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3), new THREE.MeshBasicMaterial({ color: 0xfff1dc, transparent: true, opacity: 0.7 }));
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(0, 0.04, bounds.beachEnd);
  group.add(surf);

  // palms: one merged, vertex-tinted geometry (curved ringed trunk + eleven drooping fronds),
  // instanced along the sand and down the beach-road sidewalk, each turned and sized at random
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const streetPalms = [];
  const lastZ = roadZ[roadZ.length - 1];
  for (let x = roadX[0] + 18; x < roadX[roadX.length - 1]; x += 22) {
    if (roadX.some((rx) => Math.abs(rx - x) < 16)) continue;
    streetPalms.push({ x, z: lastZ - CITY.road / 2 - 1.6, h: 8 + deco() * 2.5 });
    streetPalms.push({ x: x + 9, z: lastZ + CITY.road / 2 + 1.8, h: 8.5 + deco() * 3 });
  }
  const allPalms = [...layout.palms, ...streetPalms];
  const palms = new THREE.InstancedMesh(palmGeo(deco), palmMat, allPalms.length);
  allPalms.forEach((p, i) => {
    const sc = p.h / 9;
    dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, deco() * Math.PI * 2, 0); dummy.scale.set(sc, sc, sc); dummy.updateMatrix();
    palms.setMatrixAt(i, dummy.matrix);
  });
  palms.castShadow = true;
  group.add(palms);
  dummy.rotation.set(0, 0, 0);

  // beach life: striped umbrellas with towels under them, scattered along the sand
  const umbrellas = [];
  for (let i = 0; i < 46; i++) {
    const x = bounds.minX + 20 + deco() * (cityW - 40);
    const z = bounds.beachStart + 22 + deco() * (CITY.beachDepth - 34);
    if (layout.palms.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 9)) continue;
    umbrellas.push([x, z]);
  }
  const umbrella = new THREE.InstancedMesh(umbrellaGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), umbrellas.length);
  const towel = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), umbrellas.length);
  const uc = new THREE.Color();
  const shades = [0xff5a5f, 0x2ec4b6, 0xffbe0b, 0x3a86ff, 0xff7aa2, 0x8ac926];
  umbrellas.forEach(([x, z], i) => {
    dummy.position.set(x, 0, z); dummy.rotation.set(0.12, deco() * 6.3, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    umbrella.setMatrixAt(i, dummy.matrix);
    umbrella.setColorAt(i, uc.setHex(shades[i % shades.length]));
    dummy.position.set(x + 1.2, 0.03, z + 0.6); dummy.rotation.set(0, deco() * 6.3, 0); dummy.scale.set(1.0, 0.03, 1.9); dummy.updateMatrix();
    towel.setMatrixAt(i, dummy.matrix);
    towel.setColorAt(i, uc.setHex(shades[(i + 3) % shades.length]));
  });
  umbrella.castShadow = true;
  group.add(umbrella, towel);
  // beach loungers: a low slatted bed beside each umbrella
  const lounger = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xd8cbb8, roughness: 0.85 }), umbrellas.length);
  umbrellas.forEach(([x, z], i) => {
    dummy.position.set(x + 1.9, 0.03, z + 1.1); dummy.rotation.set(0, deco() * 6.3, 0); dummy.scale.set(0.85, 0.28, 2.1); dummy.updateMatrix();
    lounger.setMatrixAt(i, dummy.matrix);
  });
  lounger.castShadow = true;
  group.add(lounger);
  dummy.rotation.set(0, 0, 0);

  let t = 0;
  function update(dt) {
    t += dt;
    surf.material.opacity = 0.45 + Math.sin(t * 1.3) * 0.25;
    surf.position.z = bounds.beachEnd + Math.sin(t * 0.65) * 1.6;
  }

  return { group, update };
}

/** Asphalt: grey with fine aggregate speckle and faint tyre-worn streaks, tiled across the city. */
function asphaltTexture(random, rx, ry) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ababab';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 140 + Math.floor(random() * 70);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(random() * 128, random() * 128, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  g.globalAlpha = 0.08;
  g.fillStyle = '#000';
  for (let i = 0; i < 6; i++) g.fillRect(0, random() * 128, 128, 4 + random() * 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

/** Awning stripes: alternating teal and white bands, repeated along the awning. */
function awningTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f4f0e8' : '#12b5a5';
    g.fillRect(i * 16, 0, 16, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Sidewalk paving: square slabs with thin joints, repeated across each block. */
function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d9d4cc';
  g.fillRect(0, 31, 64, 2);
  g.fillRect(31, 0, 2, 64);
  g.fillStyle = '#efebe4';
  g.fillRect(4, 4, 24, 24);
  g.fillRect(36, 36, 24, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  return t;
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
