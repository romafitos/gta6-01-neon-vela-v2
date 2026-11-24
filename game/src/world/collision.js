// Static collision: every building, wall and prop is an axis-aligned box on the ground plane
// (minX, maxX, minZ, maxZ). A uniform spatial hash finds the few boxes near a point, and
// circles (people, the two circles of a car) are pushed out of boxes along the shortest
// separating direction, so movers slide along walls instead of sticking in them.

const CELL = 16;

export function createCollision() {
  const boxes = [];
  const grid = new Map();
  let stamp = 1;
  let seenGrow = new Uint32Array(1 << 12);

  const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);

  function addBox(minX, maxX, minZ, maxZ, tag = 'building') {
    const index = boxes.length;
    boxes.push({ minX, maxX, minZ, maxZ, tag });
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(index);
      }
    }
    if (boxes.length >= seenGrow.length) seenGrow = new Uint32Array(seenGrow.length * 2);
    return index;
  }

  /** Calls visit(box) once for every box overlapping the square around (x, z) of half-size r. */
  function forNear(x, z, r, visit) {
    stamp++;
    if (stamp === 0xffffffff) { seenGrow.fill(0); stamp = 1; }
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = grid.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (seenGrow[i] === stamp) continue;
          seenGrow[i] = stamp;
          visit(boxes[i]);
        }
      }
    }
  }

  /**
   * Pushes the circle at pos out of every overlapping box. Returns the summed push normal
   * (zero vector when nothing was hit). pos is mutated in place: { x, z }.
   */
  function resolveCircle(pos, radius) {
    let nx = 0;
    let nz = 0;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      forNear(pos.x, pos.z, radius + 1, (b) => {
        const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
        const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
          nx += dx / d;
          nz += dz / d;
        } else {
          // Centre inside the box: leave by the nearest face.
          const left = pos.x - b.minX;
          const right = b.maxX - pos.x;
          const top = pos.z - b.minZ;
          const bottom = b.maxZ - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) { pos.x = b.minX - radius; nx -= 1; }
          else if (m === right) { pos.x = b.maxX + radius; nx += 1; }
          else if (m === top) { pos.z = b.minZ - radius; nz -= 1; }
          else { pos.z = b.maxZ + radius; nz += 1; }
        }
        moved = true;
      });
      if (!moved) break;
    }
    const len = Math.hypot(nx, nz);
    return len > 0 ? { x: nx / len, z: nz / len, hit: true } : { x: 0, z: 0, hit: false };
  }

  /** True when a circle at (x, z) overlaps any box. */
  function overlaps(x, z, radius) {
    let hit = false;
    forNear(x, z, radius + 1, (b) => {
      if (hit) return;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) hit = true;
    });
    return hit;
  }

  /** Line of sight on the ground plane, sampled every metre (used by cameras and later AI). */
  function clearLine(ax, az, bx, bz, radius = 0.2) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (overlaps(ax + (bx - ax) * t, az + (bz - az) * t, radius)) return false;
    }
    return true;
  }

  return { boxes, addBox, forNear, resolveCircle, overlaps, clearLine };
}
