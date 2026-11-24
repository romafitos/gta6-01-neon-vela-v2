// Street races: three replayable circuits in three districts, each with a chequered start marker
// ("R" on the minimap). Drive onto the start in any car and the race sets up: three AI racers
// line up beside you, a 3-2-1 countdown holds everyone, then it's checkpoints and laps. The next
// checkpoint is a glowing ring in the world, a minimap marker and a GPS line along the roads.
// The HUD shows lap, checkpoint, race clock, split and your live position. Finishing pays cash
// and respect by position and saves your best time. Leave the car for 6 s, wreck it or fall more
// than 250 m off the route and the race is lost (drive onto the start again to retry).
import * as THREE from 'three';
import { angleDelta, clamp } from '../core/math.js';

// checkpoints are road intersections [i, j]; the route between them follows the lane graph
export const RACES = [
  { id: 'r1', name: 'Sundown Sprint', district: 'VELA BEACH', laps: 2, start: [4, 6], cps: [[6, 6], [6, 5], [8, 5], [8, 6], [5, 6], [4, 6]], prize: [2000, 1000, 500, 200], respect: [12, 6, 3, 1], racerSpeed: 23 },
  { id: 'r2', name: 'Neon Loop', district: 'NEON MILE', laps: 2, start: [5, 0], cps: [[7, 0], [7, 2], [5, 2], [5, 1], [5, 0]], prize: [2500, 1200, 600, 250], respect: [15, 8, 4, 1], racerSpeed: 24 },
  { id: 'r3', name: 'Harbor Rush', district: 'OLD HARBOR', laps: 1, start: [0, 3], cps: [[2, 3], [3, 4], [3, 5], [1, 5], [0, 4], [0, 3]], prize: [3000, 1500, 700, 300], respect: [18, 9, 4, 1], racerSpeed: 24 },
];
const RACER_COLORS = [0xffbe0b, 0x3a86ff, 0x7dffa1];
const RACER_NAMES = ['Kai "Redline" Okafor', 'Mira Vex', 'Toro Banks'];
const CP_R = 13;

export function createRaces(game, scene) {
  const { player, hud, world, vehicles } = game;
  const L = world.layout;
  const node = (ij) => L.nodeAt(ij[0], ij[1]);
  const stats = { started: 0, finished: 0, lost: 0, checkpoints: 0, payouts: 0 };
  const best = {};
  const results = [];
  let active = null;
  let cooldown = 0;
  let needLeave = false; // after a race you must roll off the start before it can trigger again

  // ---- world pieces: start pads and one checkpoint ring that moves ----
  function chequer() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }
  const chequerTex = chequer();
  const starts = RACES.map((r) => {
    const n = node(r.start);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: chequerTex, transparent: true, opacity: 0.85, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(n.x, 0.06, n.z);
    scene.add(pad);
    return { race: r, x: n.x, z: n.z, pad };
  });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(CP_R * 0.62, 0.45, 8, 40), ringMat);
  ring.visible = false;
  scene.add(ring);

  // ---- route: intersections along the lane graph between consecutive checkpoints ----
  function bfs(a, b) {
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const n = q.shift();
      if (n === b) break;
      for (const m of n.links) if (!prev.has(m)) { prev.set(m, n); q.push(m); }
    }
    const path = [];
    for (let n = b; n; n = prev.get(n)) path.unshift(n);
    return path;
  }
  /** One lap as a list of road nodes (start → cp1 → … → last cp), checkpoint indices marked. */
  function lapPath(r) {
    const pts = [node(r.start)];
    const cpAt = [];
    let from = node(r.start);
    for (const cp of r.cps) {
      const to = node(cp);
      const seg = bfs(from, to).slice(1);
      pts.push(...seg);
      cpAt.push(pts.length - 1);
      from = to;
    }
    return { pts, cpAt };
  }

  // ---- racers ----
  const racerPool = [];
  function racerCar(i, x, z, heading) {
    let car = racerPool[i];
    if (!car) { car = vehicles.spawn(x, z, heading, 'racer'); racerPool[i] = car; }
    vehicles.revive(car, x, z, heading);
    car.kind = 'racer';
    car.driver = 'racer';
    car.emp = 0;
    vehicles.paint(car, RACER_COLORS[i]);
    return car;
  }
  function parkRacers() {
    for (const car of racerPool) {
      if (!car) continue;
      car.driver = null; car.kind = 'parked-racer';
      car.disabled = true; car.x = car.z = 6000;
    }
  }

  function start(r) {
    const p = player.state;
    const car = p.car;
    if (!car || car.wrecked) { hud.notify('Races need a car', 1.5); return false; }
    if (game.missions?.state.active) { hud.notify('Finish your mission first', 1.5); return false; }
    const { pts, cpAt } = lapPath(r);
    const n0 = pts[0];
    const n1 = pts[1];
    const heading = Math.atan2(n1.x - n0.x, n1.z - n0.z);
    const fx = Math.sin(heading); const fz = Math.cos(heading);
    const rx = fz; const rz = -fx;
    // grid: player at the front-left, racers beside and behind
    const place = (c, side, back) => {
      const s = L.findClear(n0.x + rx * side * 3.2 - fx * back, n0.z + rz * side * 3.2 - fz * back, 2.3);
      c.x = s.x; c.z = s.z; c.heading = heading; c.vx = c.vz = 0; c.speed = 0;
    };
    place(car, -1, 0);
    const racers = [];
    const grid = [[1, 0], [-1, 8], [1, 8]];
    for (let i = 0; i < 3; i++) {
      const rc = racerCar(i, n0.x, n0.z, heading);
      place(rc, grid[i][0], grid[i][1]);
      racers.push({ car: rc, name: RACER_NAMES[i], idx: 1, lap: 1, cp: 0, done: false, time: 0, skill: 0.93 + i * 0.03 });
    }
    // clear stray traffic off the grid
    for (const c of vehicles.cars) if (c.driver === 'ai' && Math.hypot(c.x - n0.x, c.z - n0.z) < 30) { c.x += 60; }
    active = { race: r, pts, cpAt, lap: 1, cp: 0, countdown: 3.2, clock: 0, lapStart: 0, laps: [], racers, finishers: [], offCar: 0, splits: [] };
    stats.started++;
    hud.notify(`${r.name.toUpperCase()} — ${r.laps} lap${r.laps > 1 ? 's' : ''}, ${r.cps.length} checkpoints. Get ready…`, 3);
    game.emit('raceStart', { id: r.id });
    showCheckpoint();
    return true;
  }

  function cpPoint(a, cpIndex) { return a.pts[a.cpAt[cpIndex]]; }

  function showCheckpoint() {
    const a = active;
    if (!a) { ring.visible = false; game.minimap.setMarker('race', null); return; }
    const c = cpPoint(a, a.cp);
    ring.visible = true;
    ring.position.set(c.x, CP_R * 0.62, c.z);
    const finalCp = a.lap === a.race.laps && a.cp === a.race.cps.length - 1;
    ringMat.color.setHex(finalCp ? 0xff3d8b : 0xffd23f);
    game.minimap.setMarker('race', { x: c.x, z: c.z, color: finalCp ? '#ff3d8b' : '#ffd23f' });
    const pp = player.state.car ?? player.state;
    const route = [{ x: pp.x, z: pp.z }];
    const pathFrom = bfs(L.nodeAt(...nearestIJ(pp.x, pp.z)), c);
    for (const n of pathFrom) route.push({ x: n.x, z: n.z });
    game.minimap.setRoute(route);
  }
  function nearestIJ(x, z) {
    let bi = 0; let bj = 0; let bd = Infinity;
    for (const n of L.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; bi = n.i; bj = n.j; } }
    return [bi, bj];
  }

  /** Total progress (for positions): laps, then route index, then distance to the next node. */
  function progress(lap, idx, x, z, a) {
    const n = a.pts[idx % a.pts.length];
    return lap * 10000 + idx * 100 - Math.min(99, Math.hypot(n.x - x, n.z - z) / 3);
  }
  function playerIdx(a) {
    // the route node just after the last checkpoint passed
    return a.cp === 0 ? 1 : a.cpAt[a.cp - 1] + 1;
  }

  function driveRacer(rc, dt, a) {
    const car = rc.car;
    if (rc.done) { car.controls.throttle = 0; car.controls.handbrake = true; return; }
    if (car.wrecked || car.disabled) return;
    if (a.countdown > 0) { car.controls.throttle = 0; car.controls.handbrake = true; return; }
    const target = a.pts[rc.idx];
    const d = Math.hypot(target.x - car.x, target.z - car.z);
    if (d < 11) {
      if (a.cpAt.includes(rc.idx)) rc.cp++;
      rc.idx++;
      if (rc.idx >= a.pts.length) {
        if (rc.lap >= a.race.laps) { rc.done = true; rc.time = a.clock; a.finishers.push({ name: rc.name, time: a.clock, ai: true }); return; }
        rc.lap++; rc.idx = 1; rc.cp = 0;
      }
    }
    const t2 = a.pts[rc.idx];
    const want = Math.atan2(t2.x - car.x, t2.z - car.z);
    const err = angleDelta(car.heading, want);
    car.controls.steer = clamp(err * 2.4, -1, 1);
    // slow for the turn ahead, flat out on straights; a little rubber band keeps it a race
    const turn = Math.abs(err);
    const pPos = progress(a.lap, playerIdx(a), player.state.x, player.state.z, a);
    const myPos = progress(rc.lap, rc.idx, car.x, car.z, a);
    const band = clamp((pPos - myPos) / 800, -0.12, 0.12);
    const cruise = a.race.racerSpeed * rc.skill * (1 + band) * (turn > 0.9 ? 0.42 : turn > 0.45 ? 0.62 : d < 22 && turn > 0.2 ? 0.75 : 1);
    car.controls.throttle = car.speed < cruise - 0.6 ? 1 : car.speed > cruise + 1.2 ? -0.6 : 0.15;
    car.controls.handbrake = false;
    // unstick: reverse briefly if pinned against something
    if (Math.abs(car.speed) < 1.5) rc.stuck = (rc.stuck ?? 0) + dt; else rc.stuck = 0;
    if (rc.stuck > 2.5) { const s = L.findClear(t2.x, t2.z, 2.4); car.x = (car.x + s.x) / 2; car.z = (car.z + s.z) / 2; rc.stuck = 0; }
  }

  function finish() {
    const a = active;
    const r = a.race;
    const position = a.finishers.length + 1;
    a.finishers.push({ name: 'You', time: a.clock });
    const cash = r.prize[Math.min(position - 1, 3)];
    const respect = r.respect[Math.min(position - 1, 3)];
    const p = player.state;
    p.cash += cash;
    if (game.progression) game.progression.addRespect(respect, `race ${r.name}`); else p.respect = (p.respect ?? 0) + respect;
    const isBest = best[r.id] == null || a.clock < best[r.id];
    if (isBest) best[r.id] = a.clock;
    stats.finished++;
    stats.payouts += cash;
    const res = { id: r.id, name: r.name, district: r.district, position, time: a.clock, cash, respect, best: best[r.id], laps: a.laps.slice() };
    results.push(res);
    const ord = ['1st', '2nd', '3rd', '4th'][position - 1];
    hud.notify(`${r.name}: ${ord} in ${fmt(a.clock)}${isBest ? ' (best!)' : ''} · +$${cash.toLocaleString('en-US')} · +${respect} respect`, 6);
    hud.setObjective('');
    game.emit('raceFinish', res);
    end();
  }

  function lose(reason) {
    if (!active) return;
    stats.lost++;
    hud.notify(`RACE LOST — ${reason}. Drive onto the start to try again.`, 4);
    game.emit('raceLost', { id: active.race.id, reason });
    hud.setObjective('');
    end();
  }

  function end() {
    active = null;
    cooldown = 4;
    needLeave = true;
    parkRacers();
    showCheckpoint();
    game.minimap.setRoute(null);
  }

  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  function position() {
    const a = active;
    if (!a) return 0;
    const me = progress(a.lap, playerIdx(a), player.state.x, player.state.z, a);
    let ahead = a.finishers.length;
    for (const rc of a.racers) if (!rc.done && progress(rc.lap, rc.idx, rc.car.x, rc.car.z, a) > me) ahead++;
    return ahead + 1;
  }

  function step(dt) {
    const p = player.state;
    cooldown = Math.max(0, cooldown - dt);
    ring.rotation.y += dt * 1.2;
    if (!active) {
      if (!p.car || game.respawning || game.menuOpen) return;
      if (needLeave) { if (starts.every((s) => Math.hypot(p.car.x - s.x, p.car.z - s.z) > 20)) needLeave = false; return; }
      if (cooldown > 0) return;
      for (const s of starts) {
        if (Math.hypot(p.car.x - s.x, p.car.z - s.z) < 7 && Math.abs(p.car.speed) < 6) { start(s.race); break; }
      }
      return;
    }
    const a = active;
    for (const rc of a.racers) driveRacer(rc, dt, a);
    if (a.countdown > 0) {
      const before = Math.ceil(a.countdown);
      a.countdown -= dt;
      if (p.car) { p.car.controls.throttle = 0; p.car.vx *= 0.8; p.car.vz *= 0.8; }
      const now = Math.ceil(a.countdown);
      if (now !== before) hud.notify(now > 0 ? `${now}` : 'GO!', 0.9);
      hud.setObjective(`${a.race.name}: get ready…`);
      return;
    }
    a.clock += dt;
    // fail conditions
    if (!p.car || p.car.wrecked) { a.offCar += dt; if (p.car?.wrecked || a.offCar > 6) { lose(p.car?.wrecked ? 'your car is wrecked' : 'you left your car'); return; } } else a.offCar = 0;
    if (game.respawning) { lose('you went down'); return; }
    const c = cpPoint(a, a.cp);
    const px = p.car ? p.car.x : p.x; const pz = p.car ? p.car.z : p.z;
    let off = Infinity;
    for (const n of a.pts) off = Math.min(off, Math.hypot(n.x - px, n.z - pz));
    if (off > 250) { lose('you left the route'); return; }
    if (p.car && Math.hypot(c.x - px, c.z - pz) < CP_R) {
      stats.checkpoints++;
      a.splits.push(a.clock);
      game.emit('raceCheckpoint', { id: a.race.id, lap: a.lap, cp: a.cp, t: a.clock });
      a.cp++;
      if (a.cp >= a.race.cps.length) {
        a.laps.push(a.clock - a.lapStart);
        a.lapStart = a.clock;
        if (a.lap >= a.race.laps) { finish(); return; }
        a.lap++; a.cp = 0;
        hud.notify(`LAP ${a.lap}/${a.race.laps} · last lap ${fmt(a.laps[a.laps.length - 1])}`, 2);
      } else hud.notify(`Checkpoint ${a.cp}/${a.race.cps.length} · ${fmt(a.clock)}`, 1);
      showCheckpoint();
    } else if (Math.floor(a.clock * 2) !== Math.floor((a.clock - dt) * 2)) showCheckpoint();
    hud.setObjective(`${a.race.name} · LAP ${a.lap}/${a.race.laps} · CP ${a.cp}/${a.race.cps.length} · ${fmt(a.clock)} · POS ${position()}/4${best[a.race.id] != null ? ` · best ${fmt(best[a.race.id])}` : ''}`);
  }

  game.hudIcons = game.hudIcons ?? [];
  for (const s of starts) game.hudIcons.push({ x: s.x, z: s.z, glyph: 'R', color: '#ffd23f' });

  /** Test hook (?audit=1): puts the player's car on checkpoint `cp` of the running race. */
  function debugReachCheckpoint() {
    const a = active;
    if (!a || !player.state.car) return false;
    const c = cpPoint(a, a.cp);
    const car = player.state.car;
    car.x = c.x; car.z = c.z; car.vx = car.vz = 0; car.speed = 0;
    return true;
  }

  return { RACES, starts, stats, best, results, start, lose, step, position, debugReachCheckpoint, get active() { return active; }, lapPath, ring };
}
