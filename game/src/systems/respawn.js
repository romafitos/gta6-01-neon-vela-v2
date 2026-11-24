// Wasted and Busted. Dying sends the player to Coral Cross Hospital with a bill; getting caught
// (a foot officer within arm's reach while the player stands still, or boxed in a stopped car)
// sends them to the Vela City PD precinct with a fine and half their spare ammo confiscated.
// Either way the wanted level is cleared and every police unit stands down.
const SHOW = 3.2; // seconds the WASTED / BUSTED card stays up

export function createRespawn(game) {
  const { player, world } = game;
  const L = world.layout;
  const hospital = { name: 'Coral Cross Hospital', ...L.findClear(L.roadX[1] + 13, L.roadZ[1] + 13, 0.6) };
  const precinct = { name: 'Vela City PD, Lantern Precinct', ...L.findClear(L.roadX[6] + 13, L.roadZ[2] + 13, 0.6) };
  const state = { mode: null, timer: 0, bust: 0, wasted: 0, busted: 0, lastFee: 0, lastPlace: null };
  const card = document.getElementById('death-card');

  function begin(mode) {
    if (state.mode) return;
    state.mode = mode;
    state.timer = SHOW;
    game.respawning = true;
    if (mode === 'wasted') state.wasted++; else state.busted++;
    if (card) { card.textContent = mode === 'wasted' ? 'WASTED' : 'BUSTED'; card.className = mode; }
    game.hud.announce(mode === 'wasted' ? 'Wasted.' : 'Busted.');
    game.emit(mode, {});
  }

  function finish() {
    const wasted = state.mode === 'wasted';
    const p = player.state;
    if (p.car) game.forceExit(p.car);
    const place = wasted ? hospital : precinct;
    const fee = Math.min(p.cash, wasted ? 200 : 150 + game.wanted * 75);
    p.cash -= fee;
    if (!wasted) for (const s of game.weapons.arsenal) if (Number.isFinite(s.reserve)) s.reserve = Math.floor(s.reserve / 2);
    player.placeAt(place.x, place.z, Math.PI);
    p.health = 100;
    if (wasted) p.armor = 0;
    game.wanted && game.wantedSystem.clear();
    game.police.standDown();
    game.cam.snap({ x: p.x, z: p.z, heading: Math.PI, inCar: false });
    state.lastFee = fee;
    state.lastPlace = place.name;
    game.hud.notify(wasted ? `${place.name}: hospital bill $${fee}.` : `${place.name}: fine $${fee}, half your spare ammo confiscated.`, 4.5);
    if (card) card.className = 'hidden';
    state.mode = null;
    state.bust = 0;
    game.respawning = false;
    game.emit('respawn', { wasted, place: place.name, fee });
  }

  function step(dt) {
    if (state.mode) {
      state.timer -= dt / Math.max(0.05, game.timeScale);
      if (state.timer <= 0) finish();
      return;
    }
    const p = player.state;
    if (p.health <= 0) { begin('wasted'); return; }
    // busted: an officer close by while the suspect is (nearly) still
    if (game.wanted > 0) {
      const x = p.car ? p.car.x : p.x;
      const z = p.car ? p.car.z : p.z;
      const near = game.police.nearestCop(x, z);
      const still = p.car ? Math.abs(p.car.speed) < 1 : Math.hypot(p.vx, p.vz) < 2.2;
      const reach = p.car ? 3.6 : 2.4;
      if (near < reach && still) {
        state.bust += dt;
        if (state.bust > (p.car ? 2.4 : 1.4)) begin('busted');
      } else state.bust = Math.max(0, state.bust - dt * 2);
    } else state.bust = 0;
  }

  function onEvent(name) { if (name === 'wasted' && !state.mode) begin('wasted'); }

  return { state, hospital, precinct, step, onEvent, begin };
}
