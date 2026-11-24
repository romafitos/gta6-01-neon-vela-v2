// Autosave. One versioned record in localStorage under SAVE_KEY. It holds everything that is
// earned: cash, respect + rank, unlocks, weapons owned with their ammo, story progress, district
// control, the crew you hired, race best times, your ride's garage upgrades and paint, and where
// you were standing. It is written after a mission or race is won, after any garage purchase and
// every 60 s of play. Reading never trusts the record: broken JSON, a different version or a
// wrong shape all fall back to a fresh game with a notice, and storage errors (private mode, full
// quota) are caught and reported, never thrown.
export const SAVE_VERSION = 1;
export const SAVE_KEY = `neon-vela-save-v${SAVE_VERSION}`;
const AUTOSAVE_EVERY = 60;

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function createSaves(game) {
  const state = { lastSave: null, saves: 0, loads: 0, failures: 0, timer: 0, notice: '', fallback: null, rideId: null };
  let store = null;
  try { store = window.localStorage; } catch { store = null; }

  function ride() {
    const p = game.player.state;
    return p.car && !p.car.wrecked && p.car.driver === 'player' ? p.car : game.lastRide && !game.lastRide.wrecked ? game.lastRide : null;
  }

  function collect() {
    const g = game;
    const p = g.player.state;
    const car = ride();
    const pos = p.car ? { x: p.car.x, z: p.car.z } : { x: p.x, z: p.z };
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      cash: p.cash,
      respect: p.respect ?? 0,
      rank: g.progression.state.rank,
      unlocked: g.progression.state.unlocked.slice(),
      crewSlots: g.progression.state.crewSlots,
      weapons: g.weapons.arsenal.map((s) => ({ id: s.def.id, owned: !!s.owned, clip: Number.isFinite(s.clip) ? s.clip : null, reserve: Number.isFinite(s.reserve) ? s.reserve : null })),
      weaponIndex: g.weapons.state.index,
      missions: g.missions.state.done.slice(),
      districts: g.progression.districts.map((d) => ({ name: d.name, control: Math.round(d.control * 10) / 10 })),
      crew: g.crew.members.filter((m) => m.recruited).map((m) => m.name),
      raceBest: { ...g.races.best },
      ride: car ? { mods: { engine: car.mods?.engine ?? 0, handling: car.mods?.handling ?? 0, armor: car.mods?.armor ?? 0 }, color: car.color ?? null, health: Math.round(car.health) } : null,
      position: { x: Math.round(pos.x * 10) / 10, z: Math.round(pos.z * 10) / 10 },
      armor: p.armor ?? 0,
    };
  }

  function save(reason = 'auto') {
    if (!store) { state.failures++; return false; }
    let text;
    try { text = JSON.stringify(collect()); } catch (e) { state.failures++; return false; }
    try {
      store.setItem(SAVE_KEY, text);
      state.saves++;
      state.lastSave = { reason, t: game.time, bytes: text.length };
      state.timer = 0;
      game.emit('saved', { reason });
      return true;
    } catch (e) {
      state.failures++;
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      game.hud.notify(quota ? 'Autosave failed: browser storage is full' : 'Autosave failed: storage unavailable', 3);
      return false;
    }
  }

  /** Reads and validates the record. Returns { data } or { error } — never throws. */
  function read() {
    if (!store) return { error: 'storage unavailable' };
    let text = null;
    try { text = store.getItem(SAVE_KEY); } catch { return { error: 'storage unavailable' }; }
    // a save written by an older or newer build sits under another key: tell, don't load
    if (text == null) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith('neon-vela-save-v') && k !== SAVE_KEY) return { error: `save from another version (${k.slice(15)})`, foreign: k };
        }
      } catch { /* ignore */ }
      return { none: true };
    }
    let data;
    try { data = JSON.parse(text); } catch { return { error: 'save data is corrupted' }; }
    if (!data || typeof data !== 'object') return { error: 'save data is corrupted' };
    if (data.version !== SAVE_VERSION) return { error: `save from another version (${String(data.version).slice(0, 12)})` };
    if (!Array.isArray(data.weapons) || !Array.isArray(data.missions) || !Array.isArray(data.districts) || typeof data.cash !== 'number') return { error: 'save data is incomplete' };
    return { data };
  }

  function hasSave() { return !!read().data; }

  function clear() { try { store?.removeItem(SAVE_KEY); } catch { /* ignore */ } }

  /** Applies a validated record to the running (fresh) game. */
  function apply(d) {
    const g = game;
    const p = g.player.state;
    p.cash = Math.max(0, num(d.cash, p.cash));
    p.armor = Math.max(0, Math.min(100, num(d.armor, p.armor)));
    p.respect = Math.max(0, num(d.respect, 0));
    const ps = g.progression.state;
    ps.unlocked = Array.isArray(d.unlocked) ? d.unlocked.filter((x) => typeof x === 'string') : [];
    g.progression.checkRank();
    for (const w of d.weapons) {
      const s = g.weapons.arsenal.find((a) => a.def.id === w.id);
      if (!s) continue;
      s.owned = !!w.owned || s.def.id === 'fists';
      if (w.clip != null) s.clip = Math.max(0, Math.min(s.def.mag ?? Infinity, num(w.clip, s.clip)));
      if (w.reserve != null) s.reserve = Math.max(0, num(w.reserve, s.reserve));
    }
    const wi = num(d.weaponIndex, g.weapons.state.index);
    if (g.weapons.arsenal[wi]?.owned) g.weapons.state.index = wi;
    const ids = new Set(g.missions.MISSIONS.map((m) => m.id));
    g.missions.state.done.length = 0;
    for (const id of d.missions) if (ids.has(id) && !g.missions.state.done.includes(id)) g.missions.state.done.push(id);
    for (const sd of d.districts) {
      const dist = g.progression.districts.find((x) => x.name === sd.name);
      if (dist) dist.control = Math.max(0, Math.min(100, num(sd.control, dist.control)));
    }
    // position first, so hired crew appear next to you
    if (d.position && Number.isFinite(d.position.x) && Number.isFinite(d.position.z)) {
      const s = g.world.layout.findClear(d.position.x, d.position.z, 0.6);
      g.player.placeAt(s.x, s.z, p.heading);
    }
    const hired = Array.isArray(d.crew) ? d.crew : [];
    for (const m of g.crew.members) {
      if (!hired.includes(m.name) || m.recruited) continue;
      if (g.crew.crew().length >= ps.crewSlots) break;
      m.recruited = true;
      const s = g.world.layout.findClear(p.x + 1.5 + m.id, p.z + 1.2, 0.5);
      m.x = s.x; m.z = s.z;
    }
    for (const [k, v] of Object.entries(d.raceBest ?? {})) if (Number.isFinite(v)) g.races.best[k] = v;
    // your ride waits at the kerb with its upgrades and paint
    const car = g.spawnCar;
    if (d.ride && car) {
      if (car.wrecked || car.disabled) g.vehicles.revive(car, car.x, car.z, car.heading);
      const m = g.garages.modsOf(car);
      for (const k of ['engine', 'handling', 'armor']) m[k] = Math.max(0, Math.min(3, Math.round(num(d.ride.mods?.[k], 0))));
      g.garages.applyPerf(car);
      if (Number.isFinite(d.ride.color)) g.vehicles.paint(car, d.ride.color);
      car.health = Math.max(20, Math.min(100, num(d.ride.health, 100)));
      const s = g.world.layout.findClear(p.x + 4, p.z - 4, 2.4);
      car.x = s.x; car.z = s.z; car.vx = car.vz = 0; car.speed = 0;
      g.lastRide = car;
    }
    state.loads++;
    game.emit('loaded', { cash: p.cash });
    return true;
  }

  /** Boot-time look at storage: what the title screen should offer. */
  function inspect() {
    const r = read();
    if (r.error) { state.fallback = r.error; state.notice = `Your save could not be loaded (${r.error}) — starting a fresh game.`; }
    return r;
  }

  /** Continue: load the record into the fresh game. On any failure, a fresh game with a notice. */
  function continueGame() {
    const r = read();
    if (!r.data) { state.fallback = r.error ?? 'no save'; state.notice = `Your save could not be loaded (${state.fallback}) — starting a fresh game.`; return false; }
    try { return apply(r.data); } catch (e) {
      state.fallback = 'save data is damaged';
      state.notice = 'Your save could not be loaded (save data is damaged) — starting a fresh game.';
      return false;
    }
  }

  function onEvent(name, data) {
    if (name === 'enterCar') game.lastRide = data;
    if (name === 'missionComplete') save('mission');
    else if (name === 'raceFinish') save('race');
    else if (name === 'garage' && data && data.cost > 0) save('garage');
  }

  function step(dt) {
    state.timer += dt;
    if (state.timer >= AUTOSAVE_EVERY && !game.respawning) save('timer');
  }

  return { state, SAVE_KEY, SAVE_VERSION, collect, save, read, hasSave, clear, apply, inspect, continueGame, onEvent, step };
}
