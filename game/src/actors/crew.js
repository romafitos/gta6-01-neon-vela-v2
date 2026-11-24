// Your crew: up to three hired guns. Each waits at a recruit spot (purple jacket, "C" icon on the
// minimap); walk up and press C to hire them, as long as your Respect Rank gives you a free slot
// (1 slot at Nobody, 2 at Street Runner, 3 at Hustler). Press C anywhere else to call the crew to
// your side.
//   - On foot they follow in formation, sprint to catch up and regroup if left far behind.
//   - When you get in a car, everyone within 25 m piles in (passenger seats, up to 3) and gets
//     out with you. From the car they keep shooting out of the windows.
//   - They shoot at rival gang members, and at the police while you're wanted.
//   - G: SHOCK GRENADE. A crew member throws a grenade at the nearest threat: a blast that hurts
//     gang members and cops within 7 m and an EMP pulse that kills the engines of every police
//     (and any other AI) car within 16 m for 6 s. 18 s cooldown.
import { angleDelta, damp } from '../core/math.js';
import { WEAPONS } from '../combat/weapons.js';

const FAR = 6000;
const PISTOL = WEAPONS.find((w) => w.id === 'pistol');
const SMG = WEAPONS.find((w) => w.id === 'smg');
export const ABILITY = { name: 'Shock Grenade', cooldown: 18, blast: 7, damage: 70, emp: 16, empSeconds: 6, range: 40 };
export const RECRUITS = [
  { name: 'Lia "Static" Santos', weapon: 'smg', at: [5, 6, 26, -8], shirt: 0x8338ec },
  { name: 'Bo "Anchor" Kekoa', weapon: 'pistol', at: [2, 4, 12, 12], shirt: 0x6a2bd6 },
  { name: 'Dax "Wrench" Moreno', weapon: 'smg', at: [6, 2, -12, 12], shirt: 0x9b5de5 },
];
const FORMATION = [[-2.2, -2.4], [2.2, -2.4], [0, -4.4]];

export function createCrew(game) {
  const { crowd, world, player, hud } = game;
  const { collision, layout } = world;
  const L = layout;
  const stats = { recruited: 0, shots: 0, hits: 0, kills: 0, boarded: 0, exited: 0, abilities: 0, empCars: 0, calls: 0 };
  let seed = 7331;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const ability = { cooldown: 0, last: null };

  const members = RECRUITS.map((r, i) => {
    const pos = L.findClear(L.roadX[r.at[0]] + r.at[2], L.roadZ[r.at[1]] + r.at[3], 0.5);
    const mesh = crowd.add({ shirt: r.shirt, pants: 0x1b1530, skin: [0xc68642, 0x8d5524, 0xe0ac69][i], hair: 0x111111 });
    return {
      id: i, isCrew: true, name: r.name, def: r.weapon === 'smg' ? SMG : PISTOL, home: { ...pos },
      recruited: false, x: pos.x, z: pos.z, vx: 0, vz: 0, heading: 0, health: 100, mesh, seat: null,
      fireCd: 1 + rnd(), target: null, shotsHit: 0,
    };
  });

  const crew = () => members.filter((m) => m.recruited);
  const slots = () => game.progression?.state.crewSlots ?? 1;
  const ppos = () => { const p = player.state; return p.car ? { x: p.car.x, z: p.car.z } : { x: p.x, z: p.z }; };

  /** Hires the recruit within reach (or the given one); respects the rank's slot cap. */
  function recruit(m) {
    const p = ppos();
    m = m ?? members.find((r) => !r.recruited && Math.hypot(r.x - p.x, r.z - p.z) < 4.5);
    if (!m) return false;
    if (crew().length >= slots()) { hud.notify(`Crew full (${slots()} slot${slots() > 1 ? 's' : ''} at your rank) — earn respect for more`, 2.5); return false; }
    m.recruited = true;
    stats.recruited++;
    hud.notify(`${m.name} joined your crew (${crew().length}/${slots()})`, 3);
    game.emit('crewJoin', { name: m.name, count: crew().length });
    return true;
  }

  /** C away from a recruit: everyone regroups at your side. */
  function call() {
    const p = ppos();
    stats.calls++;
    for (const m of crew()) {
      if (m.seat != null) continue;
      if (Math.hypot(m.x - p.x, m.z - p.z) > 30) place(m, p.x - 3 + rnd() * 6, p.z - 3 + rnd() * 6);
    }
    if (crew().length) hud.notify('Crew: "On our way, boss."', 1.6);
  }

  function place(m, x, z) {
    const s = L.findClear(x, z, 0.5);
    m.x = s.x; m.z = s.z; m.vx = m.vz = 0;
  }

  function board(car) {
    let seat = 0;
    for (const m of crew()) {
      if (seat >= 3) break;
      if (Math.hypot(m.x - car.x, m.z - car.z) > 25) continue;
      m.seat = seat++;
      stats.boarded++;
    }
    if (seat) hud.notify(`${seat} crew climb in`, 1.4);
  }

  function unboard(car) {
    for (const m of crew()) {
      if (m.seat == null) continue;
      const side = m.seat % 2 === 0 ? -1 : 1;
      const rx = Math.cos(car.heading) * side * 2.4;
      const rz = -Math.sin(car.heading) * side * 2.4;
      const back = m.seat === 2 ? -2.6 : 0;
      place(m, car.x + rx + Math.sin(car.heading) * back, car.z + rz + Math.cos(car.heading) * back);
      m.seat = null;
      stats.exited++;
    }
  }

  /** Nearest thing worth shooting from (x, z): rival gang, or cops while you're wanted. */
  function pickTarget(x, z, range, needLine = true) {
    let best = null;
    let bestD = range;
    for (const g of game.gang.members) {
      if (!g.active || g.health <= 0) continue;
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < bestD && (!needLine || collision.clearLine(x, z, g.x, g.z, 0.2))) { best = { kind: 'gang', ref: g }; bestD = d; }
    }
    if (game.wanted > 0) {
      for (const c of game.police.cops) {
        if (!c.active || c.health <= 0) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bestD && (!needLine || collision.clearLine(x, z, c.x, c.z, 0.2))) { best = { kind: 'cop', ref: c }; bestD = d; }
      }
    }
    return best;
  }

  /** G: a crew member lobs a shock grenade at the nearest threat (or ahead of you). */
  function useAbility() {
    const team = crew();
    if (!team.length) { hud.notify('No crew to throw it — recruit someone first (C)', 2); return false; }
    if (ability.cooldown > 0) { hud.notify(`Shock grenade recharging: ${Math.ceil(ability.cooldown)} s`, 1.2); return false; }
    const p = ppos();
    const thrower = team[0];
    const ox = thrower.seat != null ? p.x : thrower.x;
    const oz = thrower.seat != null ? p.z : thrower.z;
    let tx; let tz;
    const t = pickTarget(ox, oz, ABILITY.range, false);
    let threatCar = null;
    if (game.wanted > 0) {
      let bd = ABILITY.range;
      for (const c of game.vehicles.cars) {
        if (c.kind !== 'police' || c.disabled || c.wrecked) continue;
        const d = Math.hypot(c.x - ox, c.z - oz);
        if (d < bd) { bd = d; threatCar = c; }
      }
    }
    if (t && (!threatCar || Math.hypot(t.ref.x - ox, t.ref.z - oz) < Math.hypot(threatCar.x - ox, threatCar.z - oz))) { tx = t.ref.x; tz = t.ref.z; }
    else if (threatCar) { tx = threatCar.x; tz = threatCar.z; }
    else { const yaw = game.cam.state.yaw; tx = p.x + Math.sin(yaw) * 14; tz = p.z + Math.cos(yaw) * 14; }
    // the blast
    game.fx.explosion(tx, tz);
    game.fx.sparks(tx, 1.0, tz, 24, 0x7df9ff);
    let hurt = 0;
    for (const g of game.gang.members) {
      if (!g.active || g.health <= 0) continue;
      if (Math.hypot(g.x - tx, g.z - tz) < ABILITY.blast) { if (game.gang.hurt(g, ABILITY.damage, thrower)) stats.kills++; hurt++; }
    }
    for (const c of game.police.cops) {
      if (!c.active || c.health <= 0) continue;
      if (Math.hypot(c.x - tx, c.z - tz) < ABILITY.blast) { game.police.hurtCop(c, ABILITY.damage, thrower); hurt++; }
    }
    // the EMP: engines die
    let emp = 0;
    for (const c of game.vehicles.cars) {
      if (c.disabled || c.wrecked || c === player.state.car) continue;
      if (c.driver !== 'police' && c.driver !== 'ai' && c.driver !== 'racer' && c.driver !== 'mission') continue;
      if (Math.hypot(c.x - tx, c.z - tz) < ABILITY.emp) { c.emp = ABILITY.empSeconds; emp++; }
    }
    stats.empCars += emp;
    stats.abilities++;
    ability.cooldown = ABILITY.cooldown;
    ability.last = { x: tx, z: tz, hurt, emp, by: thrower.name, t: game.time };
    hud.notify(`${thrower.name.split(' ')[0]}: SHOCK GRENADE! ${hurt ? hurt + ' hit' : ''}${hurt && emp ? ' · ' : ''}${emp ? emp + ' engine' + (emp > 1 ? 's' : '') + ' dead' : ''}`, 2.5);
    game.emit('crewAbility', ability.last);
    return true;
  }

  function onEvent(name, data) {
    if (name === 'enterCar') board(data);
    else if (name === 'exitCar') unboard(data);
    else if (name === 'respawn') { for (const m of crew()) { m.seat = null; const p = player.state; place(m, p.x + 2, p.z + 2); } }
  }

  function step(dt) {
    const p = player.state;
    ability.cooldown = Math.max(0, ability.cooldown - dt);
    // EMP'd engines stay dead, whoever drives them
    for (const c of game.vehicles.cars) {
      if (!(c.emp > 0)) continue;
      c.emp -= dt;
      c.controls.throttle = 0; c.controls.steer = 0; c.controls.handbrake = true;
      if (Math.random() < dt * 6) game.fx.sparks(c.x, 1.0, c.z, 2, 0x7df9ff);
    }
    if (game.input.take('crew') && !game.respawning) { if (!recruit()) call(); }
    if (game.input.take('ability') && !game.respawning) useAbility();
    const pp = ppos();
    const yaw = p.car ? p.car.heading : p.heading;
    for (const m of members) {
      if (!m.recruited) {
        // waiting at the recruit spot, facing the street
        m.vx = m.vz = 0;
        m.mesh.animate(0, dt);
        continue;
      }
      if (m.seat != null && p.car) {
        m.x = p.car.x; m.z = p.car.z;
      } else {
        if (m.seat != null) m.seat = null;
        const slot = FORMATION[m.id % 3];
        const fx = Math.sin(yaw); const fz = Math.cos(yaw);
        const tx = pp.x + fx * slot[1] + fz * slot[0];
        const tz = pp.z + fz * slot[1] - fx * slot[0];
        const d = Math.hypot(tx - m.x, tz - m.z);
        if (Math.hypot(pp.x - m.x, pp.z - m.z) > 70) place(m, pp.x - fx * 4, pp.z - fz * 4);
        const speed = d > 12 ? 9 : d > 3 ? 5.4 : d > 0.8 ? 2 : 0;
        const k = damp(8, dt);
        const nx = d > 0.01 ? (tx - m.x) / d : 0; const nz = d > 0.01 ? (tz - m.z) / d : 0;
        m.vx += (nx * speed - m.vx) * k;
        m.vz += (nz * speed - m.vz) * k;
        m.x += m.vx * dt; m.z += m.vz * dt;
        collision.resolveCircle(m, 0.42);
      }
      // shooting
      m.fireCd -= dt;
      const t = pickTarget(m.x, m.z, 34);
      m.target = t;
      if (t && !game.respawning) {
        const want = Math.atan2(t.ref.x - m.x, t.ref.z - m.z);
        if (m.seat == null) m.heading += angleDelta(m.heading, want) * damp(12, dt);
        if (m.fireCd <= 0) {
          m.fireCd = (m.def === SMG ? 0.32 : 0.7) + rnd() * 0.4;
          const before = t.ref.health;
          game.weapons.fireFrom(m.def, m.x, m.z, want + (rnd() - 0.5) * 0.12, m, 0.7);
          stats.shots++;
          if (t.ref.health < before) { stats.hits++; m.shotsHit++; }
          if (t.ref.health <= 0 && before > 0) stats.kills++;
        }
      } else if (m.seat == null && Math.hypot(m.vx, m.vz) > 0.3) {
        m.heading += angleDelta(m.heading, Math.atan2(m.vx, m.vz)) * damp(10, dt);
      }
      m.mesh.animate(m.seat != null ? 0 : Math.hypot(m.vx, m.vz), dt);
    }
  }

  function frame() {
    for (const m of members) {
      const hidden = m.seat != null && player.state.car;
      m.mesh.root.visible = !hidden;
      m.mesh.root.position.set(hidden ? FAR : m.x, 0, hidden ? FAR : m.z);
      m.mesh.root.rotation.y = m.heading;
    }
  }

  game.hudIcons = game.hudIcons ?? [];
  for (const m of members) game.hudIcons.push({ get x() { return m.recruited ? FAR : m.home.x; }, get z() { return m.recruited ? FAR : m.home.z; }, glyph: 'C', color: '#b98cff' });
  hud.addHelp('C', 'Recruit / call crew');
  hud.addHelp('G', 'Crew shock grenade');

  return { members, stats, ability, crew, slots, recruit, call, useAbility, board, unboard, pickTarget, onEvent, step, frame, ABILITY, RECRUITS };
}
