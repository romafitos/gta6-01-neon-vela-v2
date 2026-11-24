// Rival gangs: a small pool of armed street soldiers the mission system spawns for turf fights,
// bodyguard details and ambushes. Two crews with their own colours so they read at a glance:
//   Saltjaw Crew  (sea-green jackets, Old Harbor and the docks)
//   Ember Kings   (flame-orange jackets, Neon Mile and Palma Heights)
// Members hold their post until the player comes close or opens fire, then close in, keep a
// shooting distance, strafe and fire back with the same hitscan weapons the player uses.
// Pooled crowd slots (no allocation during play); every member is a target for player bullets.
import { angleDelta, damp } from '../core/math.js';
import { WEAPONS } from '../combat/weapons.js';

export const CREWS = {
  saltjaw: { name: 'Saltjaw Crew', shirt: 0x17b890, pants: 0x0f2a2a, hair: 0x1a1a1a, map: '#2de2a6' },
  ember: { name: 'Ember Kings', shirt: 0xff6a1a, pants: 0x2a1410, hair: 0x2b1408, map: '#ff7a2a' },
};
const POOL = 10;
const FAR = 6000;
const PISTOL = WEAPONS.find((w) => w.id === 'pistol');
const SMG = WEAPONS.find((w) => w.id === 'smg');

export function createGang(game) {
  const { crowd, world, player } = game;
  const { collision, layout } = world;
  const stats = { spawned: 0, killed: 0, shots: 0 };
  let seed = 9001;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

  const members = [];
  for (let i = 0; i < POOL; i++) {
    // alternate crews across the pool so either crew can field five at once
    const crew = i % 2 === 0 ? 'saltjaw' : 'ember';
    const c = CREWS[crew];
    const mesh = crowd.add({ shirt: c.shirt, pants: c.pants, skin: [0x8d5524, 0xc68642, 0xe0ac69, 0x6b4226, 0xf1c27d][i % 5], hair: c.hair });
    mesh.root.visible = false;
    members.push({ paintedCrew: crew, id: i, isGang: true, crew, active: false, x: FAR, z: FAR, vx: 0, vz: 0, heading: 0, health: 0, maxHealth: 70, mesh, fireCd: 1, dead: 0, alert: false, post: null, boss: false, tag: null, strafe: 1 });
  }

  /** Spawns one member of `crew` near (x, z). Returns the member or null when the pool is full. */
  function spawn(crew, x, z, opts = {}) {
    const m = members.find((g) => !g.active && g.crew === crew) ?? members.find((g) => !g.active);
    if (!m) return null;
    const s = layout.findClear(x, z, 0.5);
    Object.assign(m, {
      active: true, crew, x: s.x, z: s.z, vx: 0, vz: 0, heading: rnd() * 6.28,
      health: opts.health ?? 70, maxHealth: opts.health ?? 70, fireCd: 0.8 + rnd() * 1.2, dead: 0,
      alert: !!opts.alert, post: { x: s.x, z: s.z }, boss: !!opts.boss, tag: opts.tag ?? null, strafe: rnd() < 0.5 ? 1 : -1,
      smg: !!opts.smg,
    });
    const c = CREWS[crew];
    recolor(m, c);
    m.mesh.root.visible = true;
    stats.spawned++;
    return m;
  }

  // pooled slots keep the colour they were created with; a slot borrowed by the other crew is
  // repainted through the crowd's instance colours
  function recolor(m, c) {
    if (m.paintedCrew === m.crew) return;
    m.paintedCrew = m.crew;
    crowd.paint?.(m.mesh, { shirt: c.shirt, pants: c.pants, hair: c.hair });
  }

  function despawn(m) {
    m.active = false;
    m.mesh.root.visible = false;
    m.x = m.z = FAR;
    m.tag = null;
  }

  function clear(tag) { for (const m of members) if (m.active && (tag == null || m.tag === tag)) despawn(m); }

  /** Damage from any source. Returns true when it killed the member. */
  function hurt(m, amount, src) {
    if (!m.active || m.health <= 0) return false;
    m.health -= amount;
    // shots from anywhere put the whole squad on alert
    for (const o of members) if (o.active && o.tag === m.tag) o.alert = true;
    if (m.health <= 0) {
      m.health = 0;
      m.vx = m.vz = 0;
      stats.killed++;
      game.emit('gangKill', { member: m, src });
      return true;
    }
    return false;
  }

  function alive(tag) { return members.filter((m) => m.active && m.health > 0 && (tag == null || m.tag === tag)); }

  function step(dt) {
    const p = player.state;
    const px = p.car ? p.car.x : p.x;
    const pz = p.car ? p.car.z : p.z;
    for (const m of members) {
      if (!m.active) continue;
      if (m.health <= 0) {
        m.dead += dt;
        m.mesh.root.rotation.z = Math.min(Math.PI / 2, m.dead * 6); // falls over
        if (m.dead > 14) despawn(m);
        continue;
      }
      m.mesh.root.rotation.z = 0;
      const d = Math.hypot(px - m.x, pz - m.z);
      const see = d < 48 && collision.clearLine(m.x, m.z, px, pz, 0.2);
      if (!m.alert && (d < 22 || (see && d < 30))) m.alert = true;
      let tx = m.post.x; let tz = m.post.z; let speed = 2.2;
      if (m.alert && !game.respawning) {
        if (!see) { tx = px; tz = pz; speed = 5.6; }
        else if (d > 16) { tx = px; tz = pz; speed = 5.2; }
        else {
          // in range: strafe sideways around the player
          const ax = (px - m.x) / (d || 1); const az = (pz - m.z) / (d || 1);
          tx = m.x - az * m.strafe * 4; tz = m.z + ax * m.strafe * 4; speed = 2.4;
          if (rnd() < dt * 0.4) m.strafe = -m.strafe;
        }
      } else if (Math.hypot(tx - m.x, tz - m.z) < 1.2) speed = 0;
      const dx = tx - m.x; const dz = tz - m.z;
      const dl = Math.hypot(dx, dz) || 1;
      const k = damp(8, dt);
      m.vx += ((dx / dl) * speed - m.vx) * k;
      m.vz += ((dz / dl) * speed - m.vz) * k;
      m.x += m.vx * dt; m.z += m.vz * dt;
      collision.resolveCircle(m, 0.42);
      for (const c of game.vehicles.cars) {
        if (c.disabled) continue;
        const ox = m.x - c.x; const oz = m.z - c.z;
        const o2 = ox * ox + oz * oz;
        if (o2 < 5.3 && o2 > 1e-6) {
          // a fast car hits them like any pedestrian
          if (c === p.car && Math.abs(c.speed) > 8) hurt(m, Math.abs(c.speed) * 3, 'player');
          const o = Math.sqrt(o2); m.x = c.x + (ox / o) * 2.3; m.z = c.z + (oz / o) * 2.3;
        }
      }
      const want = see && m.alert ? Math.atan2(px - m.x, pz - m.z) : Math.atan2(m.vx, m.vz);
      if ((see && m.alert) || Math.hypot(m.vx, m.vz) > 0.3) m.heading += angleDelta(m.heading, want) * damp(10, dt);
      m.mesh.animate(Math.hypot(m.vx, m.vz), dt);
      m.fireCd -= dt;
      if (m.alert && see && d < 36 && m.fireCd <= 0 && !game.respawning) {
        const def = m.smg || m.boss ? SMG : PISTOL;
        m.fireCd = (def === SMG ? 0.45 : 1.0) + rnd() * 0.9;
        const yaw = Math.atan2(px - m.x, pz - m.z) + (rnd() - 0.5) * 0.35;
        game.weapons.fireFrom(def, m.x, m.z, yaw, m, 0.32);
        stats.shots++;
      }
    }
  }

  /** Per frame: crowd transforms follow the simulation. */
  function frame() {
    for (const m of members) {
      if (!m.active) continue;
      m.mesh.root.position.set(m.x, 0, m.z);
      m.mesh.root.rotation.y = m.heading;
    }
  }

  return { members, stats, spawn, despawn, clear, hurt, alive, step, frame, CREWS };
}
