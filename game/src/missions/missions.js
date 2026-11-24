// Mission runner: turns the data in mission_data.js into play. One mission at a time.
//   - The next story mission shows its giver as a yellow minimap marker and a tall light beacon
//     in the world; walking (or driving slowly) into the beacon starts it.
//   - Each stage sets the HUD objective, a minimap marker and a GPS route line that follows the
//     road lane graph (breadth-first search over the intersections), plus a world beacon.
//   - Stages finish on real game state: positions, car health, gang members killed, cars
//     wrecked, wanted level. Wasted, Busted, a timer running out, a target escaping or the player
//     leaving the turf fail the mission; Enter retries from the first stage.
//   - Completion pays cash and respect (named ranks), applies the unlock and opens the next one.
// J opens the mission log. ?audit=1 tests drive it through debugSolve(), which changes the world
// the way a player would (moves the player, kills the gang, wrecks the van), never the stage index.
import * as THREE from 'three';
import { MISSIONS, rankFor } from './mission_data.js';
import { angleDelta, clamp } from '../core/math.js';

const TAG = 'mission';
const BEACON_H = 46;

export function createMissions(game, scene) {
  const { world, player, hud, minimap, vehicles } = game;
  const L = world.layout;
  player.state.respect = player.state.respect ?? 0;
  const state = {
    done: [], active: null, failed: null, cooldown: 0, stats: { started: 0, completed: 0, failed: 0, retries: 0 },
    route: [], routeTimer: 0, lastReward: null,
  };
  let seed = 31337;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

  const resolve = (pt) => {
    if (!pt) return null;
    const [i, j, dx = 0, dz = 0] = pt;
    return L.findClear(L.roadX[i] + dx, L.roadZ[j] + dz, 0.6);
  };
  const ppos = () => { const p = player.state; return p.car ? { x: p.car.x, z: p.car.z } : { x: p.x, z: p.z }; };
  const byId = (id) => MISSIONS.find((m) => m.id === id);
  const nextMission = () => MISSIONS.find((m) => !state.done.includes(m.id)) ?? null;

  // ---------- world beacons: the giver and the current objective ----------
  function makeBeacon(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, BEACON_H, 16, 1, true), mat);
    col.position.y = BEACON_H / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.2, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    g.add(col, ring);
    g.visible = false;
    scene.add(g);
    return g;
  }
  const giverBeacon = makeBeacon(0xffd23f);
  const objBeacon = makeBeacon(0x3cf0ff);

  // ---------- respect readout beside the cash ----------
  const cashEl = document.getElementById('cash');
  const respectEl = document.createElement('div');
  respectEl.id = 'respect';
  respectEl.style.cssText = 'font:600 13px system-ui,sans-serif;color:#ffd6a0;text-shadow:0 1px 2px #000;margin-top:2px;text-align:right';
  cashEl?.insertAdjacentElement('afterend', respectEl);
  let lastRespectText = '';

  // ---------- mission log (J) ----------
  const logEl = document.createElement('div');
  logEl.id = 'mission-log';
  logEl.className = 'hidden';
  logEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:80vh;overflow:auto;box-sizing:border-box;padding:18px 22px;background:rgba(18,10,32,0.92);border:1px solid #ff3d8b;border-radius:10px;color:#f3e9ff;font:14px system-ui,sans-serif;z-index:30;display:none';
  document.body.appendChild(logEl);
  let logOpen = false;
  function renderLog() {
    const p = player.state;
    const rank = rankFor(p.respect);
    const rows = MISSIONS.map((m, k) => {
      const done = state.done.includes(m.id);
      const act = state.active?.def === m;
      const locked = !done && !act && nextMission() !== m;
      const tag = done ? '<b style="color:#7dffa1">DONE</b>' : act ? '<b style="color:#3cf0ff">ACTIVE</b>' : locked ? '<span style="color:#8a7d99">LOCKED</span>' : '<b style="color:#ffd23f">AVAILABLE</b>';
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.08)"><span>${k + 1}. <b>${m.name}</b> <span style="color:#b9a9cc">· ${m.district} · ${m.type}</span><br><span style="color:#b9a9cc;font-size:12px">$${m.reward.cash.toLocaleString('en-US')} + ${m.reward.respect} respect · unlocks: ${m.unlock.text}</span></span><span>${tag}</span></div>`;
    }).join('');
    logEl.innerHTML = `<div style="font:700 18px system-ui;color:#ff3d8b;letter-spacing:.08em">MISSION LOG</div><div style="margin:4px 0 10px;color:#ffd6a0">${state.done.length}/10 complete · Respect ${p.respect} · ${rank.name}</div>${rows}<div style="margin-top:10px;color:#b9a9cc;font-size:12px">J close · Enter retry a failed mission</div>`;
  }
  function toggleLog(force) {
    logOpen = typeof force === 'boolean' ? force : !logOpen;
    logEl.style.display = logOpen ? 'block' : 'none';
    logEl.classList.toggle('hidden', !logOpen);
    if (logOpen) renderLog();
    return logOpen;
  }
  hud.addHelp('J', 'Mission log');

  // ---------- GPS: breadth-first search over the road intersections ----------
  function nearestNode(x, z) {
    let best = null; let bd = Infinity;
    for (const n of L.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }
  function gpsRoute(from, to) {
    const a = nearestNode(from.x, from.z);
    const b = nearestNode(to.x, to.z);
    const prev = new Map([[a, null]]);
    const queue = [a];
    while (queue.length) {
      const n = queue.shift();
      if (n === b) break;
      for (const m of n.links) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
    }
    const path = [];
    for (let n = b; n; n = prev.get(n)) path.unshift({ x: n.x, z: n.z });
    return [{ x: from.x, z: from.z }, ...path, { x: to.x, z: to.z }];
  }

  // ---------- mission cars (pooled, driven along the lane graph) ----------
  const carPool = [];
  function missionCar(x, z, heading, color) {
    let car = carPool.find((c) => c.disabled);
    if (!car) {
      if (carPool.length >= 4) return null;
      car = vehicles.spawn(x, z, heading, 'mission');
      carPool.push(car);
    }
    vehicles.revive(car, x, z, heading);
    car.kind = 'mission';
    car.driver = 'mission';
    if (color != null) game.vehicles.paint?.(car, color);
    const n = nearestNode(x, z);
    const ahead = n.links.reduce((best, m) => {
      const s = Math.sin(heading) * (m.x - n.x) + Math.cos(heading) * (m.z - n.z);
      return !best || s > best.s ? { m, s } : best;
    }, null);
    car.lane = { from: n, to: ahead.m };
    car.mesh.dark = false;
    return car;
  }
  function parkMissionCars() {
    for (const c of carPool) {
      if (player.state.car === c) continue; // the player keeps a car they took
      c.disabled = true; c.x = 7000 + c.id * 10; c.z = 7000; c.vx = c.vz = 0; c.speed = 0; c.driver = 'mission';
    }
  }
  /** Lane following for a mission car. flee: prefer roads away from the player. */
  function driveLane(car, cruise, flee) {
    if (car.wrecked || car.disabled || car.driver !== 'mission') return;
    const ln = car.lane;
    const dx = ln.to.x - ln.from.x; const dz = ln.to.z - ln.from.z;
    const len = Math.hypot(dx, dz) || 1;
    const lane = 4.5;
    const tx = ln.to.x + (-dz / len) * lane; const tz = ln.to.z + (dx / len) * lane;
    if (Math.hypot(tx - car.x, tz - car.z) < 8) {
      const opts = ln.to.links.filter((n) => n !== ln.from);
      let next = opts[Math.floor(rnd() * opts.length)] ?? ln.from;
      if (flee) {
        const p = ppos();
        next = opts.reduce((best, n) => (!best || Math.hypot(n.x - p.x, n.z - p.z) > Math.hypot(best.x - p.x, best.z - p.z) ? n : best), null) ?? ln.from;
      }
      car.lane = { from: ln.to, to: next };
    }
    const want = Math.atan2(tx - car.x, tz - car.z);
    const steer = clamp(angleDelta(car.heading, want) * 2.2, -1, 1);
    car.controls.steer = steer;
    const target = cruise * (Math.abs(steer) > 0.6 ? 0.55 : 1);
    car.controls.throttle = car.speed < target - 0.5 ? 1 : car.speed > target + 0.5 ? -0.6 : 0.2;
    car.controls.handbrake = false;
    // unstick
    if (Math.abs(car.speed) < 1 && car.controls.throttle > 0) { car.stuckT = (car.stuckT ?? 0) + game.STEP; if (car.stuckT > 1.5) { car.reverseT = 1; car.stuckT = 0; } }
    if (car.reverseT > 0) { car.reverseT -= game.STEP; car.controls.throttle = -1; car.controls.steer = -steer; }
  }

  // ---------- stages ----------
  function startMission(def) {
    cleanup();
    state.failed = null;
    state.active = { def, si: -1, stage: null };
    state.stats.started++;
    hud.notify(`${def.name.toUpperCase()} — ${def.intro}`, 6);
    game.emit('missionStart', { id: def.id });
    nextStage();
  }

  function nextStage() {
    const a = state.active;
    cleanupStage();
    a.si++;
    if (a.si >= a.def.stages.length) { complete(); return; }
    const sd = a.def.stages[a.si];
    const st = { def: sd, t: 0, hold: 0, timer: sd.timer ?? null, target: null, cars: [], wave: 0, waveDelay: 0, bad: 0, at: resolve(sd.at ?? sd.to) };
    a.stage = st;
    if (sd.stars && game.wanted < sd.stars && sd.type !== 'grab') game.wantedSystem.force(sd.stars);
    if (sd.type === 'kill') spawnSquad(st, sd.count, 4);
    if (sd.type === 'waves') spawnWave(st);
    if (sd.type === 'chase' || sd.type === 'tail') {
      const s = resolve(sd.from);
      const r = L.nearestRoadPoint(s.x, s.z);
      st.target = missionCar(r.x + 4.5, r.z, Math.PI, null);
      st.cars.push(st.target);
    }
    if (sd.type === 'convoy') {
      const s = resolve(sd.from);
      const r = L.nearestRoadPoint(s.x, s.z);
      for (let k = 0; k < sd.count; k++) {
        const car = missionCar(r.x - 4.5, r.z - k * 11, 0, null);
        if (!car) break;
        car.health = sd.health;
        car.armored = true;
        st.cars.push(car);
      }
    }
    game.emit('missionStage', { id: a.def.id, stage: a.si, type: sd.type });
  }

  function spawnSquad(st, count, spread) {
    const sd = st.def;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2;
      game.gang.spawn(sd.crew, st.at.x + Math.cos(ang) * spread, st.at.z + Math.sin(ang) * spread, { tag: TAG, smg: sd.smg });
    }
    if (sd.boss) game.gang.spawn(sd.crew, st.at.x, st.at.z, { tag: TAG, boss: true, health: sd.boss.health });
  }
  function spawnWave(st) {
    const sd = st.def;
    const n = sd.waves[st.wave];
    for (let k = 0; k < n; k++) {
      const ang = rnd() * Math.PI * 2;
      game.gang.spawn(sd.crew, st.at.x + Math.cos(ang) * 26, st.at.z + Math.sin(ang) * 26, { tag: TAG, alert: true, smg: st.wave === sd.waves.length - 1 });
    }
    hud.radio(`${game.gang.CREWS[sd.crew].name}: wave ${st.wave + 1}/${sd.waves.length} incoming!`);
  }

  function cleanupStage() { game.gang.clear(TAG); parkMissionCars(); objBeacon.visible = false; minimap.setMarker('mission', null); minimap.setRoute?.(null); state.route = []; }
  function cleanup() { cleanupStage(); }

  function fail(reason) {
    const a = state.active;
    if (!a) return;
    state.failed = { id: a.def.id, reason, stage: a.si };
    state.active = null;
    state.stats.failed++;
    state.cooldown = 2;
    cleanup();
    hud.notify(`MISSION FAILED — ${reason}. Press Enter to retry.`, 6);
    hud.setObjective(`Mission failed: ${reason}. Enter = retry · J = log`);
    game.emit('missionFail', { id: a.def.id, reason });
  }

  function complete() {
    const def = state.active.def;
    const p = player.state;
    const before = rankFor(p.respect).name;
    p.cash += def.reward.cash;
    p.respect += def.reward.respect;
    const u = def.unlock;
    if (u.armor) p.armor = Math.max(p.armor, u.armor);
    if (u.ammo) game.weapons.arsenal.forEach((_, i) => game.weapons.refill(i));
    if (!state.done.includes(def.id)) state.done.push(def.id);
    state.active = null;
    state.stats.completed++;
    state.cooldown = 3;
    state.lastReward = { id: def.id, ...def.reward };
    cleanup();
    const after = rankFor(p.respect).name;
    const nm = nextMission();
    hud.notify(`MISSION PASSED: ${def.name} · +$${def.reward.cash.toLocaleString('en-US')} · +${def.reward.respect} respect${after !== before ? ` · rank: ${after}` : ''} · unlocked: ${u.text}${nm ? ` · next: ${nm.name}` : ''}`, 6);
    hud.setObjective(nm ? `Next: ${nm.name} (${nm.district}) — follow the yellow marker` : 'Story complete. Vela City is yours.');
    game.emit('missionComplete', { id: def.id, reward: def.reward });
  }

  /** Where the current stage wants the player: a point, or a live target. */
  function objectivePoint(st) {
    const sd = st.def;
    if (sd.type === 'goto' && sd.anyCar) {
      const c = vehicles.nearest(ppos().x, ppos().z, 200);
      return c ? { x: c.x, z: c.z } : st.at;
    }
    if (sd.type === 'chase' || sd.type === 'tail') return st.target ? { x: st.target.x, z: st.target.z } : null;
    if (sd.type === 'convoy') { const c = st.cars.find((x) => !x.wrecked && !x.disabled); return c ? { x: c.x, z: c.z } : null; }
    if (sd.type === 'kill' || sd.type === 'waves') { const g = game.gang.alive(TAG)[0]; return g ? { x: g.x, z: g.z } : st.at; }
    if (sd.type === 'evade') return resolve(state.active.def.start);
    return st.at;
  }

  function stepStage(dt) {
    const a = state.active;
    const st = a.stage;
    const sd = st.def;
    const p = player.state;
    const pos = ppos();
    st.t += dt;
    if (st.timer != null) {
      st.timer -= dt;
      if (st.timer <= 0) { fail('out of time'); return; }
    }
    let text = sd.label;
    let done = false;
    switch (sd.type) {
      case 'goto': {
        if (sd.anyCar && !st.at) { done = !!p.car && !p.car.wrecked; if (!p.car) text = `${sd.label} (E to get in)`; break; }
        const d = Math.hypot(pos.x - st.at.x, pos.z - st.at.z);
        if (sd.inCar && !p.car) text = `${sd.label} — get a car first`;
        if (sd.onFoot && p.car) text = `${sd.label} — leave the car`;
        if (d < (sd.radius ?? 6) && (!sd.inCar || p.car) && (!sd.onFoot || !p.car)) {
          if (sd.carHealth && p.car && p.car.health < sd.carHealth) { fail('the cargo was wrecked'); return; }
          done = true;
        }
        if (sd.carHealth && p.car && (p.car.wrecked || p.car.health < sd.carHealth * 0.5)) { fail('the cargo was wrecked'); return; }
        break;
      }
      case 'grab': {
        const d = Math.hypot(pos.x - st.at.x, pos.z - st.at.z);
        if (d < (sd.radius ?? 5) && !p.car) st.hold += dt; else st.hold = Math.max(0, st.hold - dt * 0.5);
        text = `${sd.label} ${Math.min(100, Math.round((st.hold / sd.seconds) * 100))}%`;
        if (st.hold >= sd.seconds) { if (sd.stars) game.wantedSystem.force(Math.max(game.wanted, sd.stars)); done = true; }
        break;
      }
      case 'kill': {
        const left = game.gang.alive(TAG).length;
        text = `${sd.label} (${left} left)`;
        done = left === 0;
        break;
      }
      case 'waves': {
        const left = game.gang.alive(TAG).length;
        const d = Math.hypot(pos.x - st.at.x, pos.z - st.at.z);
        if (d > sd.radius) { st.bad += dt; if (st.bad > 8) { fail('you abandoned the turf'); return; } text = 'Get back to the turf!'; } else st.bad = 0;
        if (left === 0) {
          if (st.wave >= sd.waves.length - 1) { done = true; break; }
          st.waveDelay += dt;
          if (st.waveDelay > 2.5) { st.wave++; st.waveDelay = 0; spawnWave(st); }
        }
        if (st.bad === 0) text = `${sd.label} — wave ${st.wave + 1}/${sd.waves.length}, ${left} left`;
        break;
      }
      case 'chase': {
        const c = st.target;
        driveLane(c, sd.cruise, true);
        const d = Math.hypot(pos.x - c.x, pos.z - c.z);
        if (c.wrecked || c.driver === 'player') { done = true; break; }
        if (c.health < 40 && !c.wrecked) c.controls.throttle *= 0.5; // smoking engine
        if (d > sd.escape) { fail('the target got away'); return; }
        text = `${sd.label} — ${Math.round(d)} m, damage ${100 - Math.round(c.health)}%`;
        break;
      }
      case 'tail': {
        const c = st.target;
        driveLane(c, sd.cruise, false);
        const d = Math.hypot(pos.x - c.x, pos.z - c.z);
        if (c.wrecked) { fail('you were meant to follow him, not kill him'); return; }
        if (d < sd.min) { st.bad += dt; if (st.bad > 3) { fail('the courier spotted you'); return; } text = 'Too close — back off!'; }
        else if (d > sd.max) { st.bad += dt; if (st.bad > 7) { fail('you lost the courier'); return; } text = 'Losing him — close in!'; }
        else { st.bad = 0; st.hold += dt; text = `${sd.label} — ${Math.round(d)} m, ${Math.max(0, Math.ceil(sd.seconds - st.hold))} s`; }
        if (st.hold >= sd.seconds) done = true;
        break;
      }
      case 'convoy': {
        let wrecked = 0; let near = 0;
        for (const c of st.cars) {
          driveLane(c, sd.cruise, false);
          if (c.wrecked || c.driver === 'player') wrecked++;
          else if (Math.hypot(c.x - pos.x, c.z - pos.z) < 320) near++;
        }
        text = `${sd.label} — ${wrecked}/${sd.need} wrecked`;
        if (wrecked >= sd.need) { if (game.wanted < 3) game.wantedSystem.force(3); done = true; break; }
        if (near === 0 && st.t > 5) { fail('the convoy got away'); return; }
        break;
      }
      case 'evade': {
        text = `${sd.label} (${game.wanted}★)`;
        done = game.wanted === 0 && st.t > 0.5;
        break;
      }
      default: done = true;
    }
    if (st.timer != null) text += ` · ${Math.ceil(st.timer)} s`;
    hud.setObjective(`${a.def.name} ${a.si + 1}/${a.def.stages.length}: ${text}`);
    // marker, beacon and GPS route
    const op = objectivePoint(st);
    if (op) {
      minimap.setMarker('mission', { x: op.x, z: op.z, color: sd.type === 'kill' || sd.type === 'waves' || sd.type === 'chase' || sd.type === 'convoy' ? '#ff3d5a' : '#3cf0ff' });
      objBeacon.visible = true;
      objBeacon.position.set(op.x, 0, op.z);
      state.routeTimer -= dt;
      if (state.routeTimer <= 0) { state.routeTimer = 0.5; state.route = gpsRoute(pos, op); minimap.setRoute?.(state.route); }
    }
    if (done) { hud.radio(`${a.def.name}: ${sd.label} — done.`); nextStage(); }
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (game.input.take('log')) toggleLog();
    if (logOpen && Math.floor(game.time * 2) !== Math.floor((game.time - dt) * 2)) renderLog();
    const p = player.state;
    const rt = `RESPECT ${p.respect} · ${rankFor(p.respect).name}`;
    if (rt !== lastRespectText) { lastRespectText = rt; respectEl.textContent = rt; }
    if (state.active) { if (!game.respawning) stepStage(dt); giverBeacon.visible = false; minimap.setMarker('giver', null); return; }
    if (state.failed && game.input.take('confirm')) { state.stats.retries++; startMission(byId(state.failed.id)); return; }
    const nm = nextMission();
    if (!nm) { giverBeacon.visible = false; minimap.setMarker('giver', null); return; }
    const g = resolve(nm.start);
    giverBeacon.visible = true;
    giverBeacon.position.set(g.x, 0, g.z);
    minimap.setMarker('giver', { x: g.x, z: g.z, color: '#ffd23f' });
    if (!state.failed && !state.done.length && !game.respawning) hud.setObjective(`Meet ${nm.giver} — follow the yellow marker`);
    const pos = ppos();
    const d = Math.hypot(pos.x - g.x, pos.z - g.z);
    const slow = !p.car || Math.abs(p.car.speed) < 4;
    if (state.cooldown <= 0 && !game.respawning && slow && d < (p.car ? 6 : 3.5)) startMission(nm);
  }

  function onEvent(name) {
    if (!state.active) return;
    if (name === 'wasted') fail('you were wasted');
    if (name === 'busted') fail('you were busted');
  }

  // ---------- test hooks (?audit=1) ----------
  /** Puts the player at the next mission's giver so the real trigger starts it. */
  function debugGoToGiver(id) {
    const def = id ? byId(id) : nextMission();
    const g = resolve(def.start);
    const c = player.state.car;
    if (c) { c.vx = c.vz = 0; c.speed = 0; game.forceExit(c); }
    player.placeAt(g.x, g.z, 0);
    state.cooldown = 0;
    return g;
  }
  /** Solves the current stage by changing the world, then lets the runner notice. */
  function debugSolve() {
    const a = state.active;
    if (!a) return 'none';
    const st = a.stage; const sd = st.def; const p = player.state;
    const boardCar = () => {
      if (p.car) return p.car;
      const c = game.spawnCar;
      if (c.wrecked || c.disabled) vehicles.revive(c, p.x + 3, p.z, 0);
      const s = L.findClear(p.x + 3, p.z, 2.4);
      c.x = s.x; c.z = s.z; c.vx = c.vz = 0; c.health = 100;
      player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4);
      game.enterNearestCar();
      return p.car;
    };
    const moveTo = (pt) => {
      if (p.car) { const s = L.findClear(pt.x, pt.z, 2.4); p.car.x = s.x; p.car.z = s.z; p.car.vx = p.car.vz = 0; p.car.speed = 0; p.car.health = Math.max(p.car.health, 90); }
      else player.placeAt(pt.x, pt.z, 0);
    };
    switch (sd.type) {
      case 'goto':
        if (sd.inCar) boardCar();
        if (sd.onFoot && p.car) { p.car.vx = p.car.vz = 0; p.car.speed = 0; game.exitCar(); }
        if (st.at && !(sd.anyCar && !sd.to)) moveTo(st.at);
        return 'moved';
      case 'grab': if (p.car) { p.car.speed = 0; p.car.vx = p.car.vz = 0; game.forceExit(p.car); } player.placeAt(st.at.x, st.at.z, 0); st.hold = Math.max(st.hold, sd.seconds - 0.3); return 'holding';
      case 'kill': case 'waves': moveTo(st.at); for (const m of game.gang.alive(TAG)) game.gang.hurt(m, 9999, 'player'); return 'killed';
      case 'chase': game.combat.hurtCar(st.target, 100, 'player'); game.combat.explodeCar(st.target); return 'wrecked';
      case 'convoy': for (const c of st.cars.slice(0, sd.need)) { game.combat.hurtCar(c, 999, 'player'); game.combat.explodeCar(c); } return 'wrecked';
      case 'tail': { const c = st.target; boardCar(); const s = L.findClear(c.x - Math.sin(c.heading) * 20, c.z - Math.cos(c.heading) * 20, 2.4); p.car.x = s.x; p.car.z = s.z; p.car.vx = p.car.vz = 0; st.hold = Math.max(st.hold, sd.seconds - 0.2); st.bad = 0; return 'tailing'; }
      case 'evade': game.wantedSystem.clear(); game.police.standDown(); return 'cleared';
      default: return 'n/a';
    }
  }

  return {
    state, MISSIONS, step, onEvent, startMission, nextMission, toggleLog, gpsRoute, resolve,
    isLogOpen: () => logOpen, beacons: { giver: giverBeacon, objective: objBeacon }, carPool,
    debugGoToGiver, debugSolve, fail,
  };
}
