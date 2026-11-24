// The city as data, no graphics: road grid, blocks, building lots, parks, beach, the lane graph
// traffic drives on, the sidewalk loops pedestrians walk, district lookup and safe spawn points.
// Meshes (city_meshes.js), collision, the minimap and later the mission system all read this.
import { CITY, DISTRICTS } from '../core/config.js';

export function createLayout(random, collision) {
  const { cols, rows, cell, road, sidewalk, originX, originZ } = CITY;
  const half = road / 2;
  const roadX = [];
  const roadZ = [];
  for (let i = 0; i <= cols; i++) roadX.push(originX + i * cell);
  for (let j = 0; j <= rows; j++) roadZ.push(originZ + j * cell);

  const bounds = {
    minX: roadX[0] - half - 6,
    maxX: roadX[cols] + half + 6,
    minZ: roadZ[0] - half - 6,
    beachStart: roadZ[rows] + half,
    beachEnd: roadZ[rows] + half + CITY.beachDepth,
  };
  bounds.maxZ = bounds.beachEnd + 12; // shallow water you can wade into, then the sea wall

  const districtAt = (x, z) => {
    const col = Math.max(0, Math.min(cols - 1, Math.floor((x - originX) / cell)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((z - originZ) / cell)));
    return DISTRICTS.find((d) => col >= d.minCol && col <= d.maxCol && row >= d.minRow && row <= d.maxRow) ?? DISTRICTS[0];
  };

  // ---- blocks and building lots ----
  const blocks = [];
  const buildings = [];
  const parks = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const minX = roadX[c] + half;
      const maxX = roadX[c + 1] - half;
      const minZ = roadZ[r] + half;
      const maxZ = roadZ[r + 1] - half;
      const district = districtAt((minX + maxX) / 2, (minZ + maxZ) / 2).name;
      const block = { c, r, minX, maxX, minZ, maxZ, district, park: false };
      blocks.push(block);
      const isSpawnBlock = c === 5 && r === rows - 1;
      if (!isSpawnBlock && random.chance(0.13)) {
        block.park = true;
        parks.push(block);
        continue;
      }
      const inner = { minX: minX + sidewalk, maxX: maxX - sidewalk, minZ: minZ + sidewalk, maxZ: maxZ - sidewalk };
      const split = random.pick([1, 2, 2, 4, 4, 4]);
      const lots = splitLot(inner, split, random);
      for (const lot of lots) {
        const m = 1.5;
        const b = { minX: lot.minX + m, maxX: lot.maxX - m, minZ: lot.minZ + m, maxZ: lot.maxZ - m };
        b.height = buildingHeight(district, random);
        b.district = district;
        b.colorIndex = random.int(0, 7);
        b.neon = random.chance(district === 'NEON MILE' ? 0.9 : 0.45);
        b.neonColor = random.int(0, 4);
        buildings.push(b);
        collision.addBox(b.minX, b.maxX, b.minZ, b.maxZ, 'building');
      }
    }
  }

  // Park props: a fountain box in the middle, collidable.
  for (const p of parks) {
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    p.fountain = { minX: cx - 3, maxX: cx + 3, minZ: cz - 3, maxZ: cz + 3 };
    collision.addBox(p.fountain.minX, p.fountain.maxX, p.fountain.minZ, p.fountain.maxZ, 'prop');
  }

  // World edge walls (the sea wall sits in shallow water south of the beach).
  collision.addBox(bounds.minX - 40, bounds.minX, bounds.minZ - 40, bounds.maxZ + 40, 'edge');
  collision.addBox(bounds.maxX, bounds.maxX + 40, bounds.minZ - 40, bounds.maxZ + 40, 'edge');
  collision.addBox(bounds.minX - 40, bounds.maxX + 40, bounds.minZ - 40, bounds.minZ, 'edge');
  collision.addBox(bounds.minX - 40, bounds.maxX + 40, bounds.maxZ, bounds.maxZ + 40, 'edge');

  // Beach palms (collidable trunks) along the sand.
  const palms = [];
  for (let x = bounds.minX + 20; x < bounds.maxX - 10; x += random.range(18, 30)) {
    const z = bounds.beachStart + random.range(12, CITY.beachDepth - 18);
    palms.push({ x, z, h: random.range(7, 11), lean: random.range(-0.25, 0.25) });
    collision.addBox(x - 0.35, x + 0.35, z - 0.35, z + 0.35, 'palm');
  }

  // ---- lane graph: intersections are nodes, road segments are edges ----
  const nodes = [];
  const nodeAt = (i, j) => nodes[i * (rows + 1) + j];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) nodes.push({ i, j, x: roadX[i], z: roadZ[j], links: [] });
  for (const n of nodes) {
    if (n.i > 0) n.links.push(nodeAt(n.i - 1, n.j));
    if (n.i < cols) n.links.push(nodeAt(n.i + 1, n.j));
    if (n.j > 0) n.links.push(nodeAt(n.i, n.j - 1));
    if (n.j < rows) n.links.push(nodeAt(n.i, n.j + 1));
  }

  // ---- sidewalk loops for pedestrians (2 m inside each block edge) ----
  const sidewalkLoops = blocks.map((b) => {
    const s = 2;
    return [
      { x: b.minX + s, z: b.minZ + s },
      { x: b.maxX - s, z: b.minZ + s },
      { x: b.maxX - s, z: b.maxZ - s },
      { x: b.minX + s, z: b.maxZ - s },
    ];
  });

  /** Nearest point on any road centre line: used to unstick players and drop cars. */
  function nearestRoadPoint(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const rx of roadX) {
      const cz = Math.max(roadZ[0], Math.min(roadZ[rows], z));
      const d = (x - rx) ** 2 + (z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x: rx, z: cz }; }
    }
    for (const rz of roadZ) {
      const cx = Math.max(roadX[0], Math.min(roadX[cols], x));
      const d = (x - cx) ** 2 + (z - rz) ** 2;
      if (d < bestD) { bestD = d; best = { x: cx, z: rz }; }
    }
    return best;
  }

  /** A safe spot near (x, z) for a circle of the given radius: spirals out until clear. */
  function findClear(x, z, radius) {
    if (!collision.overlaps(x, z, radius)) return { x, z };
    for (let ring = 1; ring < 60; ring++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * ring;
        const pz = z + Math.sin(a) * ring;
        if (!collision.overlaps(px, pz, radius)) return { x: px, z: pz };
      }
    }
    return nearestRoadPoint(x, z);
  }

  // Spawn on the beach-road sidewalk in Vela Beach, facing the city.
  const spawnRaw = { x: roadX[5] + half + 6, z: roadZ[rows] - half - 2 };
  const spawn = findClear(spawnRaw.x, spawnRaw.z, 0.6);

  return { roadX, roadZ, bounds, blocks, buildings, parks, palms, nodes, nodeAt, sidewalkLoops, districtAt, nearestRoadPoint, findClear, spawn };
}

function splitLot(r, n, random) {
  if (n === 1) return [r];
  const mx = (r.minX + r.maxX) / 2 + random.range(-6, 6);
  const mz = (r.minZ + r.maxZ) / 2 + random.range(-6, 6);
  if (n === 2) {
    return random.chance(0.5)
      ? [{ ...r, maxX: mx }, { ...r, minX: mx }]
      : [{ ...r, maxZ: mz }, { ...r, minZ: mz }];
  }
  return [
    { minX: r.minX, maxX: mx, minZ: r.minZ, maxZ: mz },
    { minX: mx, maxX: r.maxX, minZ: r.minZ, maxZ: mz },
    { minX: r.minX, maxX: mx, minZ: mz, maxZ: r.maxZ },
    { minX: mx, maxX: r.maxX, minZ: mz, maxZ: r.maxZ },
  ];
}

function buildingHeight(district, random) {
  switch (district) {
    case 'NEON MILE': return random.chance(0.3) ? random.range(55, 90) : random.range(24, 50);
    case 'PALMA HEIGHTS': return random.range(12, 32);
    case 'OLD HARBOR': return random.range(7, 16);
    default: return random.range(14, 38);
  }
}
