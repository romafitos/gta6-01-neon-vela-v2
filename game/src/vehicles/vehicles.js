// Every car in the city: ambient traffic that follows the lane graph and brakes for obstacles,
// parked cars along the kerbs, and whichever car the player is driving. Also owns carjacking:
// taking a traffic car ejects its driver onto the sidewalk.
import { CAR, CITY, PALETTE, PARKED, TRAFFIC } from '../core/config.js';
import { angleDelta, clamp } from '../core/math.js';
import { createFleet, POLICE_VARIANT } from './fleet.js';
import { createCarBody, resolveCarPair, stepCarBody } from './car_physics.js';

export function createVehicles(scene, world, random) {
  const cars = [];
  const { layout, collision } = world;
  const fleet = createFleet(scene, 64);

  function addCar(x, z, heading, kind, variantIndex = null) {
    const body = createCarBody(x, z, heading);
    const police = kind === 'police';
    const mesh = fleet.add(police ? 0xf4f4f4 : random.pick(PALETTE.carColors), police ? POLICE_VARIANT : (variantIndex ?? random.int(0, 3)));
    if (police) fleet.setColor(mesh, 0xf4f4f4, 0x15151c);
    const car = { ...body, kind, driver: kind === 'traffic' ? 'ai' : null, mesh, ai: null, id: cars.length };
    cars.push(car);
    return car;
  }

  // ---- traffic on the lane graph ----
  for (let i = 0; i < TRAFFIC.count; i++) {
    const from = random.pick(layout.nodes);
    const to = random.pick(from.links);
    const t = random.range(0.2, 0.7);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz);
    const rx = -dz / len;
    const rz = dx / len;
    const x = from.x + dx * t + rx * TRAFFIC.lane;
    const z = from.z + dz * t + rz * TRAFFIC.lane;
    if (collision.overlaps(x, z, 2.2) || cars.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 100)) continue;
    const car = addCar(x, z, heading, 'traffic');
    car.ai = { from, to, cruise: random.range(TRAFFIC.speedMin, TRAFFIC.speedMax) };
    car.vx = Math.sin(heading) * car.ai.cruise * 0.6;
    car.vz = Math.cos(heading) * car.ai.cruise * 0.6;
  }

  // ---- parked cars at the kerb (8.4 m from road centre) ----
  let placed = 0;
  let guard = 0;
  while (placed < PARKED.count && guard++ < 400) {
    const vertical = random.chance(0.5);
    const kerb = (CITY.road / 2 - 1.6) * (random.chance(0.5) ? 1 : -1);
    let x; let z; let heading;
    if (vertical) {
      x = random.pick(layout.roadX) + kerb;
      z = random.range(layout.roadZ[0] + 15, layout.roadZ[layout.roadZ.length - 1] - 15);
      heading = kerb > 0 ? Math.PI : 0;
    } else {
      z = random.pick(layout.roadZ) + kerb;
      x = random.range(layout.roadX[0] + 15, layout.roadX[layout.roadX.length - 1] - 15);
      heading = kerb > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    // keep clear of intersections
    const nearX = layout.roadX.some((rx) => Math.abs(rx - x) < 14) && layout.roadZ.some((rz) => Math.abs(rz - z) < 14);
    if (nearX || collision.overlaps(x, z, 2.4) || cars.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 64)) continue;
    addCar(x, z, heading, 'parked');
    placed++;
  }

  /** Places one parked car right next to a point (the player's spawn gets a ride). */
  function parkNear(x, z, heading, variantIndex = null) {
    const spot = layout.findClear(x, z, 2.4);
    return addCar(spot.x, spot.z, heading, 'parked', variantIndex);
  }

  function driveAI(car, player) {
    const ai = car.ai;
    const dx = ai.to.x - ai.from.x;
    const dz = ai.to.z - ai.from.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = -dz / len;
    const rz = dx / len;
    const tx = ai.to.x + rx * TRAFFIC.lane;
    const tz = ai.to.z + rz * TRAFFIC.lane;
    const dist = Math.hypot(tx - car.x, tz - car.z);
    if (dist < 7) {
      const options = ai.to.links.filter((n) => n !== ai.from);
      const next = options.length ? random.pick(options) : ai.from;
      ai.from = ai.to;
      ai.to = next;
    }
    // aim a little ahead along the lane for smooth cornering
    const want = Math.atan2(tx - car.x, tz - car.z);
    const steer = clamp(angleDelta(car.heading, want) * 2.2, -1, 1);

    // brake for anything in front: the player, the player's car, other cars
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let blocked = false;
    const check = (ox, oz, r) => {
      const ax = ox - car.x;
      const az = oz - car.z;
      const ahead = ax * fx + az * fz;
      const side = Math.abs(ax * -fz + az * fx);
      if (ahead > 0 && ahead < TRAFFIC.stopGap + r && side < 2.4 + r) blocked = true;
    };
    if (!player.state.car) check(player.state.x, player.state.z, 0.3);
    for (const o of cars) if (o !== car && Math.abs(o.x - car.x) < 14 && Math.abs(o.z - car.z) < 14) check(o.x, o.z, 0.8);

    car.controls.steer = steer;
    const target = blocked ? 0 : ai.cruise * (Math.abs(steer) > 0.6 ? 0.55 : 1);
    car.controls.throttle = car.speed < target - 0.5 ? 0.7 : car.speed > target + 0.5 ? -1 : 0;
    car.controls.handbrake = false;
  }

  function step(dt, player) {
    for (const car of cars) {
      if (car.disabled) continue;
      if (car.wrecked) { car.controls.throttle = 0; car.controls.steer = 0; car.controls.handbrake = true; }
      else if (car.driver === 'ai') driveAI(car, player);
      else if (car.driver === null) { car.controls.throttle = 0; car.controls.steer = 0; car.controls.handbrake = true; }
      stepCarBody(car, dt, collision);
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (a.disabled || b.disabled) continue;
        if (Math.abs(a.x - b.x) < 6 && Math.abs(a.z - b.z) < 6) resolveCarPair(a, b);
      }
    }
  }

  function nearest(x, z, range) {
    let best = null;
    let bestD = range * range;
    for (const c of cars) {
      if (c.disabled || c.wrecked) continue;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function syncMeshes(dt) {
    for (const c of cars) {
      c.mesh.root.position.set(c.x, c.disabled ? -50 : 0, c.z);
      c.mesh.root.scale.setScalar(c.disabled ? 0 : 1);
      c.mesh.root.rotation.y = c.heading;
      c.mesh.animate(c.speed, c.steerInput, dt);
    }
    fleet.sync(dt);
  }

  /** Repaints a car (garage respray, mission and race cars). */
  function paint(car, hex) {
    car.color = hex;
    fleet.setColor(car.mesh, hex);
    car.mesh.dark = false;
  }

  /** A burnt-out wreck: blackened paint, lights dead, never drivable again. */
  function markWreck(car) {
    fleet.setColor(car.mesh, 0x1c1714, 0x0d0b0a);
    car.mesh.dark = true;
  }

  /** A new car of the given kind ('police' gets the livery and light bar). Used by dispatch. */
  function spawn(x, z, heading, kind) {
    const car = addCar(x, z, heading, kind);
    if (kind === 'police') car.driver = 'police';
    return car;
  }

  /** Brings a disabled pooled car back at (x, z) as new. */
  function revive(car, x, z, heading) {
    Object.assign(car, { x, z, heading, vx: 0, vz: 0, speed: 0, health: 100, disabled: false, wrecked: false, onFire: false, burn: 0, impacts: 0, lastImpact: 0, lastHitByPlayer: null });
    car.controls.throttle = 0; car.controls.steer = 0; car.controls.handbrake = false;
    if (car.kind === 'police') { fleet.setColor(car.mesh, 0xf4f4f4, 0x15151c); car.mesh.dark = false; }
    return car;
  }

  return { cars, step, nearest, syncMeshes, parkNear, spawn, revive, markWreck, paint, maxSpeed: CAR.maxSpeed };
}
