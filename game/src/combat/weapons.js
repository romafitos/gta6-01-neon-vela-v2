// Weapons: six original guns and melee options, each with its own fire rate, damage, spread,
// range, magazine and reserve ammo. Shots are hitscan rays on the ground plane (aimed down the
// camera's crosshair) that stop at the first building, person, cop or car they meet. Every shot
// shows a muzzle flash and a tracer, every hit sparks or bleeds, and gunfire scares pedestrians
// and is reported to the wanted system as a crime.

export const WEAPONS = [
  { id: 'fists', name: 'Fists', slot: 1, melee: true, damage: 12, rate: 2.6, range: 1.9, carDamage: 2, icon: 'FIST' },
  { id: 'bat', name: 'Boardwalk Bat', slot: 2, melee: true, damage: 34, rate: 1.6, range: 2.4, carDamage: 9, icon: 'BAT' },
  { id: 'pistol', name: 'Vela 9 Pistol', slot: 3, damage: 22, rate: 4, spread: 0.025, range: 65, pellets: 1, mag: 12, ammo: 72, carDamage: 6, auto: false, icon: '9MM' },
  { id: 'smg', name: 'Hornet SMG', slot: 4, damage: 13, rate: 13, spread: 0.07, range: 50, pellets: 1, mag: 30, ammo: 210, carDamage: 4, auto: true, icon: 'SMG' },
  { id: 'shotgun', name: 'Breaker 12 Shotgun', slot: 5, damage: 11, rate: 1.25, spread: 0.13, range: 26, pellets: 8, mag: 6, ammo: 36, carDamage: 5, auto: false, icon: '12G' },
  { id: 'rifle', name: 'Marlin Carbine', slot: 6, damage: 34, rate: 6.5, spread: 0.012, range: 115, pellets: 1, mag: 25, ammo: 150, carDamage: 9, auto: true, icon: 'AR' },
];

const EYE = 1.35;

export function createWeapons(game) {
  const { world, player, fx } = game;
  const arsenal = WEAPONS.map((w) => ({ def: w, owned: true, clip: w.mag ?? Infinity, reserve: w.ammo ?? Infinity }));
  const state = { index: 2, cooldown: 0, reload: 0, triggerHeld: false, aimYaw: 0 };
  const stats = { shots: 0, hits: 0, kills: 0, byWeapon: {} };
  for (const w of WEAPONS) stats.byWeapon[w.id] = { shots: 0, hits: 0, damage: 0 };
  let seed = 4242;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

  const current = () => arsenal[state.index];

  function select(index) {
    if (index < 0 || index >= arsenal.length || !arsenal[index].owned) return false;
    if (index !== state.index) {
      state.index = index;
      state.cooldown = 0.25;
      state.reload = 0;
      game.hud.notify(arsenal[index].def.name, 1.2);
      game.emit('weapon', arsenal[index].def);
    }
    return true;
  }

  function cycle(dir) {
    for (let k = 1; k <= arsenal.length; k++) {
      const i = (state.index + dir * k + arsenal.length * 4) % arsenal.length;
      if (arsenal[i].owned) return select(i);
    }
    return false;
  }

  /** Distance along the ray to the first building (or range when the way is clear). */
  function wallDistance(ox, oz, dx, dz, range) {
    for (let t = 0.75; t < range; t += 0.75) {
      if (world.collision.overlaps(ox + dx * t, oz + dz * t, 0.05)) return t;
    }
    return range;
  }

  /** Everything a bullet can hit right now: people, cops, cars (not the shooter's own). */
  function targets(shooter) {
    const out = [];
    for (const p of game.peds.peds) if (p.mode !== 'dead') out.push({ kind: 'ped', ref: p, x: p.x, z: p.z, r: 0.5 });
    for (const c of game.police?.cops ?? []) if (c.active && c.health > 0 && c !== shooter) out.push({ kind: 'cop', ref: c, x: c.x, z: c.z, r: 0.5 });
    for (const car of game.vehicles.cars) {
      if (car.disabled || car === player.state.car || car === shooter) continue;
      out.push({ kind: 'car', ref: car, x: car.x, z: car.z, r: 2.0 });
    }
    if (shooter !== 'player-target' && shooter && shooter.isCop) {
      // a cop's bullets can hit the player
      out.length = 0;
      const p = player.state;
      out.push({ kind: 'player', ref: p, x: p.car ? p.car.x : p.x, z: p.car ? p.car.z : p.z, r: p.car ? 2.0 : 0.55 });
      for (const car of game.vehicles.cars) if (!car.disabled && car !== p.car && car.kind !== 'police') out.push({ kind: 'car', ref: car, x: car.x, z: car.z, r: 2.0 });
    }
    return out;
  }

  /** Casts one ray; returns the hit {kind, ref, t, x, z} or a wall/air end point. */
  function cast(ox, oz, dx, dz, range, shooter) {
    const wall = wallDistance(ox, oz, dx, dz, range);
    let best = null;
    let bestT = wall;
    for (const tg of targets(shooter)) {
      const rx = tg.x - ox;
      const rz = tg.z - oz;
      const t = rx * dx + rz * dz;
      if (t < 0.2 || t > bestT) continue;
      const px = ox + dx * t - tg.x;
      const pz = oz + dz * t - tg.z;
      if (px * px + pz * pz < tg.r * tg.r) { bestT = t; best = tg; }
    }
    return { hit: best, t: bestT, x: ox + dx * bestT, z: oz + dz * bestT, wall: !best && wall < range };
  }

  function applyHit(hit, def, amount, src) {
    const st = stats.byWeapon[def.id];
    st.hits++;
    st.damage += amount;
    stats.hits++;
    const { kind, ref } = hit;
    if (kind === 'ped') {
      fx.blood(ref.x, 1.2, ref.z);
      if (game.combat.hurtPed(ref, amount, src)) stats.kills++;
    } else if (kind === 'cop') {
      fx.blood(ref.x, 1.2, ref.z);
      if (game.police.hurtCop(ref, amount, src)) stats.kills++;
    } else if (kind === 'car') {
      fx.sparks(hit.x ?? ref.x, 0.9, hit.z ?? ref.z, 4);
      game.combat.hurtCar(ref, def.carDamage ?? amount * 0.3, src);
    } else if (kind === 'player') {
      if (player.state.car) game.combat.hurtCar(player.state.car, def.carDamage ?? 3, src);
      else { fx.blood(ref.x, 1.2, ref.z); game.combat.hurtPlayer(amount, src); }
    }
  }

  /**
   * Fires one trigger pull of `def` from (ox, oz) along yaw. Used by the player and by cops.
   * Returns the number of targets hit.
   */
  function fireFrom(def, ox, oz, yaw, shooter, accuracy = 1) {
    let hits = 0;
    const fx0 = Math.sin(yaw);
    const fz0 = Math.cos(yaw);
    if (def.melee) {
      const tg = targets(shooter);
      let best = null;
      let bestD = def.range + 0.5;
      for (const t of tg) {
        const rx = t.x - ox;
        const rz = t.z - oz;
        const ahead = rx * fx0 + rz * fz0;
        const d = Math.hypot(rx, rz) - t.r;
        if (ahead > -0.2 && d < bestD && Math.abs(rx * -fz0 + rz * fx0) < 1.2 + t.r) { best = t; bestD = d; }
      }
      if (best) { applyHit({ ...best, x: best.x, z: best.z }, def, def.damage, shooter); hits++; }
      return hits;
    }
    const spread = def.spread / Math.max(0.25, accuracy);
    const sx = ox + fx0 * 0.7;
    const sz = oz + fz0 * 0.7;
    fx.muzzle(sx, EYE, sz, fx0, fz0);
    for (let i = 0; i < def.pellets; i++) {
      const a = yaw + (rnd() - 0.5) * 2 * spread;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const r = cast(sx, sz, dx, dz, def.range, shooter);
      fx.tracer(sx, EYE, sz, r.x, r.hit ? 1.1 : EYE - 0.15, r.z, shooter && shooter.isCop ? 0xa8d8ff : 0xffe9a8);
      if (r.hit) { applyHit(r.hit, def, def.damage, shooter); hits++; }
      else if (r.wall) fx.sparks(r.x, EYE - 0.1, r.z, 3, 0xe8e0d0);
    }
    game.emit('gunfire', { x: ox, z: oz, shooter });
    return hits;
  }

  /** Player weapon logic for one step: trigger, fire rate, magazines and reloads. */
  function step(dt, firing, aimYaw) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    const slot = current();
    const def = slot.def;
    if (state.reload > 0) {
      state.reload -= dt;
      if (state.reload <= 0) {
        const take = Math.min(def.mag - slot.clip, slot.reserve);
        slot.clip += take;
        slot.reserve -= take;
      }
    }
    const p = player.state;
    if (p.car || game.blockFire) { state.triggerHeld = firing; return; }
    const pull = firing && (def.auto || def.melee || !state.triggerHeld);
    state.triggerHeld = firing;
    if (!firing) return;
    p.heading = aimYaw; // the player turns to face where they shoot
    if (!pull || state.cooldown > 0 || state.reload > 0) return;
    if (!def.melee && slot.clip <= 0) {
      if (slot.reserve > 0) { state.reload = 1.1; game.hud.notify('Reloading…', 1); }
      else { game.hud.notify(`${def.name}: out of ammo`, 1.2); state.cooldown = 0.4; }
      return;
    }
    state.cooldown = 1 / def.rate;
    stats.shots++;
    stats.byWeapon[def.id].shots++;
    if (!def.melee) {
      slot.clip--;
      if (slot.clip === 0 && slot.reserve > 0) state.reload = 1.1;
    }
    fireFrom(def, p.x, p.z, aimYaw, null, 1);
    if (!def.melee) game.emit('crime', { type: 'shooting', x: p.x, z: p.z });
  }

  function hudText() {
    const s = current();
    if (s.def.melee) return s.def.name;
    return `${s.def.name}  ${s.clip} / ${s.reserve}${state.reload > 0 ? '  (reloading)' : ''}`;
  }

  function refill(index) {
    const s = arsenal[index];
    if (s.def.mag) { s.clip = s.def.mag; s.reserve = s.def.ammo; }
  }

  return { arsenal, state, stats, select, cycle, current, step, fireFrom, cast, hudText, refill };
}
