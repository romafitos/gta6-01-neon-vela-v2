// Wanted level: crimes add heat, heat becomes one to five stars. While any cop, cruiser or the
// air unit can see the player the stars stay solid and the cooldown resets; out of sight the
// stars flash and, after a cooldown that grows with the level, drop one at a time.
const RAISE = {
  shooting: { min: 1, add: 0.06 },
  assault: { min: 1, add: 0.35 },
  kill: { min: 1, add: 0.75 },
  carjack: { min: 1, add: 0.2, needsWitness: true },
  copAssault: { min: 1, add: 0.45 },
  copKill: { min: 2, add: 1.0 },
  explosion: { min: 1, add: 0.7 },
  hitAndRun: { min: 1, add: 0.4 },
};

export function createWanted(game) {
  const state = { heat: 0, stars: 0, seen: false, unseen: 0, lastSeen: null, knownFor: 0, peak: 0, drops: 0 };

  const cooldownFor = (stars) => 7 + stars * 2.5;

  function setStars(n) {
    const prev = state.stars;
    state.stars = Math.max(0, Math.min(5, n));
    if (state.stars > state.peak) state.peak = state.stars;
    game.wanted = state.stars;
    if (state.stars !== prev) game.emit('wanted', { stars: state.stars, prev });
  }

  function report(type, x, z) {
    const r = RAISE[type];
    if (!r || game.respawning) return;
    if (r.needsWitness && !policeNear(x, z, 45)) return;
    state.heat = Math.min(5.99, Math.max(state.heat, r.min) + r.add);
    state.knownFor = 3; // the police know where it happened
    state.lastSeen = { x, z };
    state.unseen = 0;
    const s = Math.floor(state.heat);
    if (s !== state.stars) setStars(s);
  }

  function policeNear(x, z, range) {
    for (const c of game.police?.cops ?? []) if (c.active && c.health > 0 && Math.hypot(c.x - x, c.z - z) < range) return true;
    for (const car of game.vehicles.cars) if (car.kind === 'police' && !car.disabled && !car.wrecked && Math.hypot(car.x - x, car.z - z) < range) return true;
    return false;
  }

  /** True when some unit has line of sight to the player. */
  function canSee() {
    const p = game.player.state;
    const col = game.world.collision;
    const heli = game.police?.heli;
    if (heli && heli.active && Math.hypot(heli.lightX - p.x, heli.lightZ - p.z) < 18) return true;
    for (const c of game.police?.cops ?? []) {
      if (!c.active || c.health <= 0) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 55 && col.clearLine(c.x, c.z, p.x, p.z, 0.2)) return true;
    }
    for (const car of game.vehicles.cars) {
      if (car.kind !== 'police' || car.disabled || car.wrecked || car.driver !== 'police') continue;
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < 70 && col.clearLine(car.x, car.z, p.x, p.z, 0.2)) return true;
    }
    return false;
  }

  let seeTimer = 0;
  function step(dt) {
    if (state.stars === 0) { state.seen = false; state.unseen = 0; game.wantedFlash = false; return; }
    state.knownFor = Math.max(0, state.knownFor - dt);
    seeTimer -= dt;
    if (seeTimer <= 0) { seeTimer = 0.25; state.seen = state.knownFor > 0 || canSee(); }
    const p = game.player.state;
    if (state.seen) { state.unseen = 0; state.lastSeen = { x: p.x, z: p.z }; }
    else {
      state.unseen += dt;
      if (state.unseen > cooldownFor(state.stars)) {
        state.unseen = 0;
        state.drops++;
        state.heat = state.stars - 1 + 0.5;
        if (state.stars - 1 <= 0) state.heat = 0;
        setStars(state.stars - 1);
        game.hud.notify(state.stars ? `Heat dropping: ${state.stars} star${state.stars > 1 ? 's' : ''}` : 'You lost the cops.', 2.5);
      }
    }
    game.wantedFlash = !state.seen;
  }

  function onEvent(name, data) {
    if (name === 'crime') report(data.type, data.x, data.z);
  }

  /** Test and mission hook: set the level directly (heat in the middle of that star). */
  function force(n) {
    state.heat = n > 0 ? n + 0.5 : 0;
    state.knownFor = n > 0 ? 3 : 0;
    state.unseen = 0;
    setStars(n);
  }

  function clear() { force(0); state.lastSeen = null; }

  return { state, step, onEvent, report, force, clear, canSee, cooldownFor };
}
