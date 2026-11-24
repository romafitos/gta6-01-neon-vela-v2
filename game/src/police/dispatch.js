// Police dispatch: the response grows with the wanted level.
//   1★ foot officers and a patrol cruiser that chase and shoot
//   2★ more units, cruisers authorised to RAM the player's car
//   3★ PIT manoeuvres on the player's rear quarter, roadblocks set on the road ahead
//   4★ the air unit "Kestrel 7": a helicopter whose searchlight tracks the player
//   5★ everything at once, faster fire
// Units are pooled (fixed crowd slots and cruisers that are parked out of the world when idle),
// so a long chase never grows memory. Every escalation is announced on the HUD police radio.
import * as THREE from 'three';
import { CITY } from '../core/config.js';
import { angleDelta, clamp, damp } from '../core/math.js';
import { WEAPONS } from '../combat/weapons.js';

const FOOT_TARGET = [0, 2, 3, 4, 5, 6];
const FOOT_TARGET_DRIVING = [0, 1, 1, 2, 2, 3];
const CAR_TARGET = [0, 1, 2, 3, 4, 5];
const COP_POOL = 8;
const CAR_POOL = 7;
const FAR = 5000;
const AVENUES = ['Coral Ave', 'Sunset Ave', 'Marlin Ave', 'Palm Ave', 'Harbor Ave', 'Lantern Ave', 'Dune Ave', 'Vista Ave', 'Shell Ave'];
const STREETS = ['Ridge St', 'Orchid St', 'Mango St', 'Pier St', 'Tide St', 'Breakwater St', 'Ocean Drive'];
const PISTOL = WEAPONS.find((w) => w.id === 'pistol');
const SMG = WEAPONS.find((w) => w.id === 'smg');

export function createDispatch(game, scene) {
  const { world, vehicles, player, crowd, hud } = game;
  const { layout, collision } = world;
  const stats = { copsSpawned: 0, carsSpawned: 0, rams: 0, pits: 0, roadblocks: 0, heliSpawns: 0, copShots: 0, copKills: 0 };
  let seed = 777;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

  // ---------- foot officers (fixed crowd slots) ----------
  const cops = [];
  for (let i = 0; i < COP_POOL; i++) {
    const mesh = crowd.add({ shirt: 0x1f3266, pants: 0x121a33, skin: [0x8d5524, 0xc68642, 0xe0ac69, 0x6b4226][i % 4], hair: 0x111111 });
    mesh.root.visible = false;
    cops.push({ id: i, isCop: true, active: false, x: FAR, z: FAR, vx: 0, vz: 0, heading: 0, health: 60, mesh, fireCd: 1, dead: 0, mode: 'chase' });
  }

  // ---------- cruisers ----------
  const cruisers = [];
  function takeCruiser() {
    let car = cruisers.find((c) => c.disabled);
    if (!car && cruisers.length < CAR_POOL) {
      car = vehicles.spawn(FAR + cruisers.length * 10, FAR, 0, 'police');
      car.unit = cruisers.length + 1;
      cruisers.push(car);
      car.disabled = true;
    }
    return car;
  }
  function parkCruiser(car) {
    car.disabled = true;
    car.x = FAR + car.unit * 10; car.z = FAR; car.vx = car.vz = 0; car.speed = 0;
    car.role = null; car.block = null;
    if (game.player.state.car === car) return;
    car.driver = 'police';
  }

  // ---------- roadblocks ----------
  const roadblocks = [];
  const barrierGeo = new THREE.BoxGeometry(2.4, 1.0, 0.35);
  const barrierMesh = new THREE.InstancedMesh(barrierGeo, new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.6, emissive: 0x401800 }), 24);
  barrierMesh.count = 0;
  barrierMesh.frustumCulled = false;
  barrierMesh.castShadow = true;
  scene.add(barrierMesh);

  // ---------- helicopter "Kestrel 7" ----------
  const heliGroup = new THREE.Group();
  const heliMat = new THREE.MeshStandardMaterial({ color: 0x1b2340, roughness: 0.45, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 5.2), heliMat);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.1, metalness: 0.7 }));
  glass.position.set(0, 0.2, 2.6);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5.5), heliMat);
  boom.position.set(0, 0.4, -5);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.9), new THREE.MeshStandardMaterial({ color: 0xf4f4f4 }));
  fin.position.set(0, 1.1, -7.4);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0x0c0c0c }));
  rotor.position.set(0, 1.25, 0);
  const rotor2 = rotor.clone();
  rotor2.rotation.y = Math.PI / 2;
  const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 4.4), heliMat);
  skidL.position.set(-1.1, -1.2, 0);
  const skidR = skidL.clone();
  skidR.position.x = 1.1;
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }));
  beacon.position.set(0, -0.9, 1.8);
  heliGroup.add(body, glass, boom, fin, rotor, rotor2, skidL, skidR, beacon);
  heliGroup.visible = false;
  scene.add(heliGroup);
  // searchlight: a soft additive cone from the nose to the ground plus a bright pool on the street
  const coneGeo = new THREE.CylinderGeometry(0.35, 1, 1, 24, 1, true);
  coneGeo.translate(0, -0.5, 0);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  cone.visible = false;
  cone.frustumCulled = false;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.visible = false;
  const spot = new THREE.SpotLight(0xfff1c8, 0, 90, 0.22, 0.45, 1.2);
  spot.target.position.set(0, 0, 0);
  scene.add(cone, pool, spot, spot.target);
  const heli = { active: false, leaving: false, x: FAR, y: 34, z: FAR, heading: 0, orbit: 0, lightX: FAR, lightZ: FAR, poolRadius: 6.5, timer: 0 };

  // ---------- helpers ----------
  const streetName = (x, z) => {
    let bi = 0; let bd = Infinity;
    layout.roadX.forEach((rx, i) => { const d = Math.abs(rx - x); if (d < bd) { bd = d; bi = i; } });
    let bj = 0; let bdz = Infinity;
    layout.roadZ.forEach((rz, j) => { const d = Math.abs(rz - z); if (d < bdz) { bdz = d; bj = j; } });
    return bd < bdz ? AVENUES[bi] : STREETS[bj];
  };
  const where = (x, z) => `${streetName(x, z)}, ${layout.districtAt(x, z).name}`;
  const radio = (text) => hud.radio ? hud.radio(text) : hud.notify(text, 3);
  const pp = () => { const p = player.state; return p.car ? { x: p.car.x, z: p.car.z, car: p.car } : { x: p.x, z: p.z, car: null }; };
  /** Where the police think the suspect is: the real position while seen, else the last sighting. */
  const known = () => {
    const ws = game.wantedSystem?.state;
    const real = pp();
    if (!ws || ws.seen || !ws.lastSeen) return real;
    return { x: ws.lastSeen.x, z: ws.lastSeen.z, car: null, searching: true };
  };

  /** A road point roughly `dist` metres from (x, z), away from buildings and the player. */
  function roadPointNear(x, z, dist, minGap = 30) {
    for (let tries = 0; tries < 24; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = layout.nearestRoadPoint(x + Math.cos(a) * dist, z + Math.sin(a) * dist);
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < minGap || d > dist * 1.6) continue;
      if (collision.overlaps(r.x, r.z, 2.6)) continue;
      if (vehicles.cars.some((c) => !c.disabled && Math.abs(c.x - r.x) < 6 && Math.abs(c.z - r.z) < 6)) continue;
      return r;
    }
    return null;
  }

  // ---------- spawning ----------
  function spawnCop(near) {
    const cop = cops.find((c) => !c.active);
    if (!cop) return null;
    const p = near ?? known();
    const r = near ? layout.findClear(near.x, near.z, 0.5) : roadPointNear(p.x, p.z, 38, 22);
    if (!r) return null;
    Object.assign(cop, { active: true, x: r.x + (near ? 0 : (rnd() - 0.5) * 4), z: r.z + (near ? 0 : (rnd() - 0.5) * 4), vx: 0, vz: 0, health: 60, fireCd: 1 + rnd(), dead: 0, mode: 'chase' });
    const s = layout.findClear(cop.x, cop.z, 0.5);
    cop.x = s.x; cop.z = s.z;
    cop.mesh.root.visible = true;
    stats.copsSpawned++;
    return cop;
  }

  function spawnCruiser(role) {
    const p = known();
    const r = roadPointNear(p.x, p.z, 70, 45);
    if (!r) return null;
    const car = takeCruiser();
    if (!car) return null;
    const heading = Math.atan2(p.x - r.x, p.z - r.z);
    vehicles.revive(car, r.x, r.z, heading);
    car.driver = 'police';
    car.role = role;
    car.route = null; car.routeTimer = 0; car.stuck = 0; car.reverse = 0; car.contactCd = 0; car.fireCd = 2;
    stats.carsSpawned++;
    return car;
  }

  /** Two cruisers parked across the road ahead of the player, barriers between them. */
  function setRoadblock() {
    const p = pp();
    const ps = player.state;
    let dx; let dz;
    if (p.car && Math.abs(p.car.speed) > 3) { dx = Math.sin(p.car.heading); dz = Math.cos(p.car.heading); }
    else { const h = p.car ? p.car.heading : ps.heading; dx = Math.sin(h); dz = Math.cos(h); }
    let best = null;
    let bestScore = -Infinity;
    for (const n of layout.nodes) {
      const rx = n.x - p.x;
      const rz = n.z - p.z;
      const d = Math.hypot(rx, rz);
      if (d < 45 || d > 170) continue;
      const dot = (rx * dx + rz * dz) / d;
      const score = dot * 2 - Math.abs(d - 90) / 60;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (!best) return null;
    // the road from the player's side into that junction: block it 14 m before the junction
    const ax = Math.abs(best.x - p.x) > Math.abs(best.z - p.z); // travelling along x?
    const sgn = ax ? Math.sign(best.x - p.x) : Math.sign(best.z - p.z);
    const cx = ax ? best.x - sgn * 14 : best.x;
    const cz = ax ? best.z : best.z - sgn * 14;
    const across = ax ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const carHeading = ax ? 0 : Math.PI / 2; // parked across the lanes
    const block = { x: cx, z: cz, alongX: ax, ttl: 45, cars: [], barriers: [], street: where(cx, cz) };
    for (const off of [-5.2, 5.2]) {
      const car = takeCruiser();
      if (!car) break;
      vehicles.revive(car, cx + across.x * off, cz + across.z * off, carHeading);
      car.driver = 'police_static';
      car.role = 'roadblock';
      car.block = block;
      car.controls.handbrake = true;
      block.cars.push(car);
    }
    for (const off of [-8.6, 0, 8.6]) block.barriers.push({ x: cx + across.x * off, z: cz + across.z * off, rot: carHeading + Math.PI / 2 });
    roadblocks.push(block);
    stats.roadblocks++;
    radio(`Dispatch: roadblock set on ${block.street}.`);
    return block;
  }

  function startHeli() {
    const p = pp();
    Object.assign(heli, { active: true, leaving: false, x: p.x + 160, z: p.z - 160, y: 36, orbit: rnd() * 6.28, timer: 0 });
    heli.lightX = heli.x; heli.lightZ = heli.z;
    heliGroup.visible = cone.visible = pool.visible = true;
    stats.heliSpawns++;
    radio('Dispatch: Air unit Kestrel 7 en route, searchlight up.');
  }

  // ---------- behaviour ----------
  function stepCop(cop, dt, stars) {
    if (!cop.active) return;
    if (cop.health <= 0) {
      cop.dead += dt;
      if (cop.dead > 10) despawnCop(cop);
      return;
    }
    const real = pp();
    const p = known();
    const d = Math.hypot(p.x - cop.x, p.z - cop.z);
    const dReal = Math.hypot(real.x - cop.x, real.z - cop.z);
    if (dReal > 160 || stars === 0) { if (stars === 0 && d < 40) { cop.mode = 'leave'; } else { despawnCop(cop); return; } }
    const see = !p.searching && d < 45 && collision.clearLine(cop.x, cop.z, p.x, p.z, 0.2);
    let tx = p.x; let tz = p.z;
    let speed = cop.mode === 'leave' ? 3 : 6.4;
    if (cop.mode === 'leave') { tx = cop.x + (cop.x - p.x); tz = cop.z + (cop.z - p.z); if (d > 60) { despawnCop(cop); return; } }
    else if (!see) {
      // no line of sight: get onto the road, then run along it toward the player
      const r = layout.nearestRoadPoint(cop.x, cop.z);
      if (Math.hypot(r.x - cop.x, r.z - cop.z) > 3) { tx = r.x; tz = r.z; }
    } else if (d < (player.state.car ? 7 : 2.0)) speed = 0;
    if (p.searching && d < 4) speed = 0; // reached the last sighting: look around
    else if (d < 12 && stars >= 2) speed = 1.5;
    const dx = tx - cop.x; const dz = tz - cop.z;
    const dl = Math.hypot(dx, dz) || 1;
    const k = damp(8, dt);
    cop.vx += ((dx / dl) * speed - cop.vx) * k;
    cop.vz += ((dz / dl) * speed - cop.vz) * k;
    cop.x += cop.vx * dt; cop.z += cop.vz * dt;
    collision.resolveCircle(cop, 0.42);
    // shove out of car bodies
    for (const c of vehicles.cars) {
      if (c.disabled) continue;
      const ox = cop.x - c.x; const oz = cop.z - c.z;
      const o2 = ox * ox + oz * oz;
      if (o2 < 5.3 && o2 > 1e-6) { const o = Math.sqrt(o2); cop.x = c.x + (ox / o) * 2.3; cop.z = c.z + (oz / o) * 2.3; }
    }
    const want = see ? Math.atan2(p.x - cop.x, p.z - cop.z) : Math.atan2(cop.vx, cop.vz);
    if (see || Math.hypot(cop.vx, cop.vz) > 0.3) cop.heading += angleDelta(cop.heading, want) * damp(10, dt);
    cop.mesh.animate(Math.hypot(cop.vx, cop.vz), dt);
    // open fire: from 1★ when the player is armed or driving at them, always from 2★
    cop.fireCd -= dt;
    if (see && d < 38 && cop.fireCd <= 0 && cop.mode !== 'leave' && !game.respawning) {
      const def = stars >= 4 ? SMG : PISTOL;
      const acc = 0.35 + stars * 0.07;
      cop.fireCd = (stars >= 4 ? 0.35 : 1.1) + rnd() * (stars >= 3 ? 0.6 : 1.1);
      const yaw = Math.atan2(p.x - cop.x, p.z - cop.z) + (rnd() - 0.5) * (0.5 - stars * 0.06);
      game.weapons.fireFrom(def, cop.x, cop.z, yaw, cop, acc);
      stats.copShots++;
    }
  }

  function despawnCop(cop) {
    cop.active = false;
    cop.mesh.root.visible = false;
    cop.x = cop.z = FAR;
  }

  function routeTarget(car, aim) {
    if (collision.clearLine(car.x, car.z, aim.x, aim.z, 1.1)) return aim;
    car.routeTimer -= 1;
    if (!car.route || car.routeTimer <= 0 || Math.hypot(car.route.x - car.x, car.route.z - car.z) < 8) {
      car.routeTimer = 20;
      let best = null; let bestS = Infinity;
      for (const n of layout.nodes) {
        const dc = Math.hypot(n.x - car.x, n.z - car.z);
        if (dc < 9 || dc > 160) continue;
        if (!collision.clearLine(car.x, car.z, n.x, n.z, 1.1)) continue;
        const s = Math.hypot(n.x - aim.x, n.z - aim.z) + dc * 0.35;
        if (s < bestS) { bestS = s; best = n; }
      }
      car.route = best ?? aim;
    }
    return car.route;
  }

  function stepCruiser(car, dt, stars) {
    if (car.disabled || car.driver !== 'police' || car.wrecked) return;
    const real = pp();
    const k0 = known();
    const p = k0.searching ? k0 : real;
    const d = Math.hypot(p.x - car.x, p.z - car.z);
    if (stars === 0) {
      car.leave = (car.leave ?? 0) + dt;
      car.controls.throttle = 0.5; car.controls.steer = 0;
      if (car.leave > 4 || d > 90) { car.leave = 0; parkCruiser(car); }
      return;
    }
    if (Math.hypot(real.x - car.x, real.z - car.z) > 280) { parkCruiser(car); return; }
    car.contactCd = Math.max(0, car.contactCd - dt);
    // pick the manoeuvre
    let role = 'chase';
    if (k0.searching) role = 'search';
    else if (p.car && stars >= 2) role = stars >= 3 && car.unit % 2 === 0 ? 'pit' : 'ram';
    car.role = role;
    let aim = { x: p.x, z: p.z };
    if (p.car) {
      const pc = p.car;
      const fx = Math.sin(pc.heading); const fz = Math.cos(pc.heading);
      if (role === 'pit' && d < 30) {
        // line up with the rear quarter on whichever side we are already on
        const side = Math.sign((car.x - pc.x) * -fz + (car.z - pc.z) * fx) || 1;
        aim = { x: pc.x - fx * 1.6 - fz * side * 1.4 + pc.vx * 0.25, z: pc.z - fz * 1.6 + fx * side * 1.4 + pc.vz * 0.25 };
      } else aim = { x: pc.x + pc.vx * 0.35, z: pc.z + pc.vz * 0.35 };
    }
    const t = routeTarget(car, aim);
    const want = Math.atan2(t.x - car.x, t.z - car.z);
    let steer = clamp(angleDelta(car.heading, want) * 2.6, -1, 1);
    let throttle = 1;
    if ((role === 'chase' && !p.car && d < 14) || (role === 'search' && d < 12)) throttle = car.speed > 1 ? -1 : 0; // pull up beside a suspect on foot
    if (Math.abs(angleDelta(car.heading, want)) > 1.9 && d < 25) throttle = -0.8;
    // unstick: reverse out with the wheel turned the other way
    if (car.reverse > 0) { car.reverse -= dt; throttle = -1; steer = -steer; }
    else if (Math.abs(car.speed) < 1.2 && throttle > 0) { car.stuck += dt; if (car.stuck > 1.4) { car.stuck = 0; car.reverse = 1.1; } }
    else car.stuck = 0;
    car.controls.throttle = throttle;
    car.controls.steer = steer;
    car.controls.handbrake = false;
    // from 3★ the passenger leans out and fires at a suspect in range
    car.fireCd -= dt;
    if (stars >= 3 && !k0.searching && d < 24 && car.fireCd <= 0 && collision.clearLine(car.x, car.z, p.x, p.z, 0.2)) {
      car.fireCd = 1.4 + rnd();
      game.weapons.fireFrom(PISTOL, car.x, car.z, Math.atan2(p.x - car.x, p.z - car.z) + (rnd() - 0.5) * 0.3, { isCop: true, car }, 0.5);
      stats.copShots++;
    }
  }

  /** After the physics step: detect RAM and PIT contacts with the player's car. */
  function contacts() {
    const pc = player.state.car;
    if (!pc) return;
    for (const car of cruisers) {
      if (car.disabled || car.driver !== 'police' || car.contactCd > 0) continue;
      const dx = pc.x - car.x; const dz = pc.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.6) continue;
      const closing = Math.hypot(car.vx - pc.vx, car.vz - pc.vz);
      if (closing < 2.5 && Math.abs(car.speed) < 4) continue;
      car.contactCd = 2;
      const fx = Math.sin(pc.heading); const fz = Math.cos(pc.heading);
      const behind = -(dx * fx + dz * fz) / (d || 1); // >0: contact on the player's rear half
      if (car.role === 'pit' && behind > 0.15) {
        // PIT: shove the rear quarter sideways so the car spins out
        const side = Math.sign((car.x - pc.x) * -fz + (car.z - pc.z) * fx) || 1;
        pc.heading += side * 0.9;
        pc.vx += -fz * -side * 6; pc.vz += fx * -side * 6;
        pc.speed *= 0.4;
        game.combat.hurtCar(pc, 8, 'police');
        stats.pits++;
        radio(`Unit ${car.unit}: PIT executed on ${streetName(pc.x, pc.z)}!`);
      } else {
        const k = 5 / (d || 1);
        pc.vx += dx * k; pc.vz += dz * k;
        game.combat.hurtCar(pc, 7 + closing * 0.5, 'police');
        stats.rams++;
        if (stats.rams % 3 === 1) radio(`Unit ${car.unit}: ramming the suspect vehicle.`);
      }
      game.emit('policeContact', { car, kind: car.role });
    }
  }

  function stepRoadblocks(dt) {
    const p = pp();
    for (let i = roadblocks.length - 1; i >= 0; i--) {
      const b = roadblocks[i];
      b.ttl -= dt;
      const far = Math.hypot(b.x - p.x, b.z - p.z) > 240;
      if (b.ttl <= 0 || far || game.wanted === 0) {
        for (const car of b.cars) if (car.role === 'roadblock' && player.state.car !== car && !car.wrecked) parkCruiser(car);
        roadblocks.splice(i, 1);
        continue;
      }
      // barriers stop people and cars (a solid post you can shove only by losing all speed)
      for (const br of b.barriers) {
        const movers = [];
        if (player.state.car) movers.push([player.state.car, 2.0]);
        else movers.push([player.state, 0.9]);
        for (const [m, r] of movers) {
          const ox = m.x - br.x; const oz = m.z - br.z;
          const o = Math.hypot(ox, oz);
          if (o < r + 1.1 && o > 1e-4) {
            const push = r + 1.1 - o;
            m.x += (ox / o) * push; m.z += (oz / o) * push;
            if (m.vx !== undefined) { m.vx *= 0.5; m.vz *= 0.5; }
            if (m === player.state.car && Math.abs(m.speed) > 6) game.combat.hurtCar(m, 6, 'police');
          }
        }
      }
      // a roadblock's officers get out once the player is near
      if (!b.deployed && Math.hypot(b.x - p.x, b.z - p.z) < 70) {
        b.deployed = true;
        for (const car of b.cars) spawnCop({ x: car.x + (b.alongX ? -3 : 0), z: car.z + (b.alongX ? 0 : -3) });
      }
    }
    // draw barriers
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const b of roadblocks) for (const br of b.barriers) {
      if (n >= 24) break;
      q.setFromAxisAngle(up, br.rot);
      m.compose(v.set(br.x, 0.5, br.z), q, s);
      barrierMesh.setMatrixAt(n++, m);
    }
    barrierMesh.count = n;
    barrierMesh.instanceMatrix.needsUpdate = true;
  }

  function stepHeli(dt, stars) {
    if (!heli.active) return;
    const p = known();
    heli.timer += dt;
    if (stars < 4 && !heli.leaving) { heli.leaving = true; heli.timer = 0; radio('Kestrel 7: returning to base.'); }
    let tx; let tz; let ty = 34;
    if (heli.leaving) { tx = heli.x + 200; tz = heli.z - 200; ty = 60; if (heli.timer > 6) { heli.active = false; heliGroup.visible = cone.visible = pool.visible = false; spot.intensity = 0; return; } }
    else {
      heli.orbit += dt * 0.22;
      tx = p.x + Math.cos(heli.orbit) * 26;
      tz = p.z + Math.sin(heli.orbit) * 26;
    }
    // fly: speed-limited approach
    const dx = tx - heli.x; const dz = tz - heli.z;
    const dl = Math.hypot(dx, dz);
    const step = Math.min(dl, 34 * dt);
    if (dl > 1e-3) { heli.x += (dx / dl) * step; heli.z += (dz / dl) * step; heli.heading += angleDelta(heli.heading, Math.atan2(dx, dz)) * damp(2, dt); }
    heli.y += (ty - heli.y) * damp(1.5, dt);
    // the searchlight chases the player at its own limited speed (a fast car can outrun it)
    if (!heli.leaving) {
      const lx = p.x - heli.lightX; const lz = p.z - heli.lightZ;
      const ll = Math.hypot(lx, lz);
      const ls = Math.min(ll, (ll > 20 ? 40 : 26) * dt);
      if (ll > 1e-3) { heli.lightX += (lx / ll) * ls; heli.lightZ += (lz / ll) * ls; }
    }
    const r = pp();
    heli.lightError = Math.hypot(r.x - heli.lightX, r.z - heli.lightZ);
    // searching: sweep the light around the last sighting
    if (p.searching && !heli.leaving) { heli.lightX += Math.cos(heli.timer * 0.9) * 6 * dt; heli.lightZ += Math.sin(heli.timer * 0.9) * 6 * dt; }
  }

  function syncHeli(dt) {
    if (!heli.active) return;
    heliGroup.position.set(heli.x, heli.y, heli.z);
    heliGroup.rotation.set(0.08, heli.heading, 0);
    rotor.rotation.y += dt * 38; rotor2.rotation.y = rotor.rotation.y + Math.PI / 2;
    beacon.visible = Math.floor(heli.timer * 2.5) % 2 === 0;
    // cone from the nose down to the light pool
    const sx = heli.x + Math.sin(heli.heading) * 2.4; const sy = heli.y - 1; const sz = heli.z + Math.cos(heli.heading) * 2.4;
    const ex = heli.lightX; const ez = heli.lightZ;
    const len = Math.hypot(ex - sx, sy, ez - sz);
    cone.position.set(sx, sy, sz);
    cone.scale.set(heli.poolRadius, len, heli.poolRadius);
    const dir = new THREE.Vector3(ex - sx, -sy, ez - sz).normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    pool.position.set(ex, 0.07, ez);
    pool.scale.setScalar(heli.poolRadius);
    spot.position.set(sx, sy, sz);
    spot.target.position.set(ex, 0, ez);
    spot.intensity = heli.leaving ? 0 : 900;
  }

  // ---------- director ----------
  let director = 0;
  let roadblockTimer = 5;
  function step(dt) {
    const stars = game.wanted;
    const p = pp();
    for (const c of cops) stepCop(c, dt, stars);
    for (const car of cruisers) stepCruiser(car, dt, stars);
    stepRoadblocks(dt);
    stepHeli(dt, stars);
    if (game.respawning) return;
    director -= dt;
    if (director <= 0 && stars > 0) {
      director = 1.2;
      const foot = cops.filter((c) => c.active && c.health > 0).length;
      const wantFoot = (player.state.car ? FOOT_TARGET_DRIVING : FOOT_TARGET)[stars];
      if (foot < wantFoot) spawnCop();
      const chasing = cruisers.filter((c) => !c.disabled && c.driver === 'police' && !c.wrecked).length;
      if (chasing < CAR_TARGET[stars]) spawnCruiser('chase');
      if (stars >= 4 && !heli.active) startHeli();
    }
    if (stars >= 3) {
      roadblockTimer -= dt;
      if (roadblockTimer <= 0 && roadblocks.length < 2) { roadblockTimer = 16; setRoadblock(); }
    } else roadblockTimer = 4;
    void p;
  }

  function frame(dt) {
    for (const c of cops) {
      if (!c.active) continue;
      const down = c.health <= 0;
      c.mesh.root.position.set(c.x, down ? 0.3 : 0.12, c.z);
      c.mesh.root.rotation.set(down ? -Math.PI / 2 : 0, c.heading, 0, 'YXZ');
    }
    syncHeli(dt);
  }

  /** Returns true when the hit killed the officer. */
  function hurtCop(cop, amount, src) {
    if (!cop.active || cop.health <= 0) return false;
    cop.health -= amount;
    const byPlayer = !src || src === 'player' || src === 'blast-player';
    if (cop.health <= 0) {
      stats.copKills++;
      if (byPlayer) game.emit('crime', { type: 'copKill', x: cop.x, z: cop.z });
      return true;
    }
    if (byPlayer) game.emit('crime', { type: 'copAssault', x: cop.x, z: cop.z });
    return false;
  }

  function onEvent(name, data) {
    if (name === 'wanted') {
      const { stars, prev } = data;
      if (stars > prev) {
        const at = where(player.state.x, player.state.z);
        const lines = [
          '',
          `Dispatch: units responding to ${at}.`,
          'Dispatch: shots fired — cruisers cleared to RAM the suspect.',
          'Dispatch: PIT manoeuvres approved, roadblocks going up.',
          'Dispatch: requesting air support over ' + layout.districtAt(player.state.x, player.state.z).name + '.',
          'Dispatch: all units, suspect is armed and extremely dangerous.',
        ];
        radio(lines[stars]);
      } else if (stars === 0) radio('Dispatch: suspect lost. All units resume patrol.');
    }
  }

  /** Clears every unit at once (respawn after Wasted/Busted, mission resets). */
  function standDown() {
    for (const c of cops) despawnCop(c);
    for (const car of cruisers) if (player.state.car !== car) parkCruiser(car);
    for (const b of roadblocks) b.ttl = 0;
    stepRoadblocks(0);
    heli.active = false;
    heliGroup.visible = cone.visible = pool.visible = false;
    spot.intensity = 0;
  }

  function nearestCop(x, z) {
    let best = Infinity;
    for (const c of cops) if (c.active && c.health > 0) best = Math.min(best, Math.hypot(c.x - x, c.z - z));
    return best;
  }

  return { cops, cruisers, roadblocks, heli, stats, step, contacts, frame, hurtCop, onEvent, standDown, nearestCop, setRoadblock, startHeli, spawnCruiser, spawnCop, streetName, cityCell: CITY.cell };
}
