// Pedestrians: they stroll the sidewalk loop around their block, flee when threatened (a carjack,
// later gunfire), and get knocked flat by a fast car. They collide with buildings like the player.
import { PEDS } from '../core/config.js';
import { angleDelta, damp } from '../core/math.js';

const SHIRTS = [0x2de2e6, 0xff3d8b, 0xf2f2f2, 0x7dffa1, 0xb44dff, 0xffd166, 0x118ab2, 0xef476f];
const SKINS = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x6b4226];

export function createPedestrians(crowd, world, random) {
  const peds = [];
  const { layout, collision } = world;

  function addPed(x, z, loopIndex = -1) {
    const mesh = crowd.add({ shirt: random.pick(SHIRTS), pants: random.pick([0x2b2d42, 0x3d405b, 0x5c4033, 0x22223b]), skin: random.pick(SKINS), hair: random.pick([0x1b1b1b, 0x4a2c17, 0xd9b26f]) });
    const ped = { x, z, vx: 0, vz: 0, heading: 0, loop: loopIndex, corner: 0, mode: 'walk', timer: 0, from: null, mesh, speed: PEDS.speed * random.range(0.8, 1.2) };
    peds.push(ped);
    return ped;
  }

  for (let i = 0; i < PEDS.count; i++) {
    const loopIndex = random.int(0, layout.sidewalkLoops.length - 1);
    const loop = layout.sidewalkLoops[loopIndex];
    const k = random.int(0, 3);
    const a = loop[k];
    const b = loop[(k + 1) % 4];
    const t = random();
    const ped = addPed(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, loopIndex);
    ped.corner = (k + 1) % 4;
  }

  /** Makes a pedestrian run away from (x, z) for a few seconds. */
  function scare(ped, x, z, seconds = 5) {
    if (ped.mode === 'down') return;
    ped.mode = 'flee';
    ped.timer = seconds;
    ped.from = { x, z };
  }

  /** A carjacked driver: appears beside the car and bolts. */
  function ejectDriver(car, byX, byZ) {
    const sx = car.x + Math.cos(car.heading) * 2.2;
    const sz = car.z - Math.sin(car.heading) * 2.2;
    const spot = layout.findClear(sx, sz, 0.5);
    const ped = addPed(spot.x, spot.z, -1);
    scare(ped, byX, byZ, 8);
    return ped;
  }

  function step(dt, player, cars) {
    for (const p of peds) {
      let tx = 0;
      let tz = 0;
      let speed = 0;
      if (p.mode === 'down') {
        p.timer -= dt;
        if (p.timer <= 0) { p.mode = p.loop >= 0 ? 'walk' : 'flee'; p.timer = 4; p.from = p.from ?? { x: p.x, z: p.z }; }
      } else if (p.mode === 'flee') {
        p.timer -= dt;
        const dx = p.x - p.from.x;
        const dz = p.z - p.from.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = dx / d; tz = dz / d; speed = 5.5;
        if (p.timer <= 0) p.mode = p.loop >= 0 ? 'walk' : 'idle';
      } else if (p.mode === 'walk' && p.loop >= 0) {
        const target = layout.sidewalkLoops[p.loop][p.corner];
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1) p.corner = (p.corner + 1) % 4;
        tx = dx / (d || 1); tz = dz / (d || 1); speed = p.speed;
      }
      const k = damp(8, dt);
      p.vx += (tx * speed - p.vx) * k;
      p.vz += (tz * speed - p.vz) * k;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      collision.resolveCircle(p, 0.4);

      // fast cars knock pedestrians down; slow ones just nudge them aside
      if (p.mode !== 'down') {
        for (const c of cars) {
          if (Math.abs(c.x - p.x) > 3 || Math.abs(c.z - p.z) > 3) continue;
          if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 4.4) {
            if (Math.abs(c.speed) > 7) { p.mode = 'down'; p.timer = 4; p.vx = c.vx * 0.5; p.vz = c.vz * 0.5; p.from = { x: c.x, z: c.z }; }
            else scare(p, c.x, c.z, 3);
          }
        }
        // the player on foot bumping a ped makes them step away
        if (!player.state.car && (player.state.x - p.x) ** 2 + (player.state.z - p.z) ** 2 < 0.8) {
          const dx = p.x - player.state.x;
          const dz = p.z - player.state.z;
          const d = Math.hypot(dx, dz) || 1;
          p.x += (dx / d) * 0.05; p.z += (dz / d) * 0.05;
        }
      }
      const ground = Math.hypot(p.vx, p.vz);
      if (ground > 0.2 && p.mode !== 'down') p.heading += angleDelta(p.heading, Math.atan2(p.vx, p.vz)) * damp(10, dt);
      p.mesh.animate(p.mode === 'down' ? 0 : ground, dt);
    }
  }

  function syncMeshes() {
    for (const p of peds) {
      p.mesh.root.position.set(p.x, p.mode === 'down' ? 0.3 : 0.12, p.z);
      p.mesh.root.rotation.set(p.mode === 'down' ? -Math.PI / 2 : 0, p.heading, 0, 'YXZ');
    }
  }

  return { peds, step, syncMeshes, scare, ejectDriver };
}
