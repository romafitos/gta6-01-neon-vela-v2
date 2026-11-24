// Progression: district standing and what each Respect Rank unlocks.
//   - Each of the four districts has a control meter, 0–100 %. It goes up when you win there
//     (missions, races, gang kills by you or your crew, turf waves) and down when you lose there
//     (Wasted, Busted, a crew member going down). The HUD shows the current district's control,
//     and the big map (M) tints every district from red (rival-held) to green (yours).
//   - Respect Ranks (named in mission_data.js) unlock higher-tier weapons and crew slots.
//     At the start you own Fists, Bat, Pistol and SMG; the Breaker 12 and Marlin Carbine and
//     the 2nd and 3rd crew slots open at higher ranks. Every unlock is announced and emitted.
import { CITY, DISTRICTS } from '../core/config.js';
import { RANKS, rankFor } from '../missions/mission_data.js';

/** What each rank opens. Rank names come from RANKS; `at` is the respect needed. */
export const RANK_UNLOCKS = [
  { rank: 'Nobody', crewSlots: 1, weapons: [] },
  { rank: 'Street Runner', crewSlots: 2, weapons: [] },
  { rank: 'Hustler', crewSlots: 3, weapons: ['shotgun'] },
  { rank: 'Enforcer', crewSlots: 3, weapons: ['rifle'] },
];
/** Weapons not owned at the start. */
export const LOCKED_AT_START = ['shotgun', 'rifle'];

/** Control change per event, in percentage points of the district's meter. */
export const STANDING = { gangKill: 3, mission: 18, raceWin: 10, racePodium: 5, race: 2, wasted: -6, busted: -4, crewDown: -3, turfWave: 4 };

export function createProgression(game) {
  const { player, hud, world } = game;
  const p = player.state;
  p.respect = p.respect ?? 0;
  const districts = DISTRICTS.map((d) => ({
    name: d.name,
    control: d.name === 'VELA BEACH' ? 20 : 5,
    minX: CITY.originX + d.minCol * CITY.cell,
    maxX: CITY.originX + (d.maxCol + 1) * CITY.cell,
    minZ: CITY.originZ + d.minRow * CITY.cell,
    maxZ: CITY.originZ + (d.maxRow + 1) * CITY.cell + (d.maxRow === CITY.rows - 1 ? CITY.beachDepth + 30 : 0),
  }));
  const byName = (n) => districts.find((d) => d.name === n);
  const state = { rank: rankFor(p.respect).name, unlocked: [], log: [], crewSlots: 1 };
  const stats = { standingChanges: 0, rankUps: 0, unlocks: 0 };

  // nothing above the starting tier is in your hands yet
  for (const id of LOCKED_AT_START) {
    const slot = game.weapons.arsenal.find((s) => s.def.id === id);
    if (slot) slot.owned = false;
  }

  function districtAt(x, z) { return byName(world.layout.districtAt(x, z).name); }

  /** Moves one district's meter; returns the new control %. */
  function adjust(name, delta, why) {
    const d = byName(name);
    if (!d) return 0;
    const before = d.control;
    d.control = Math.max(0, Math.min(100, d.control + delta));
    if (d.control !== before) {
      stats.standingChanges++;
      state.log.push({ district: name, delta: d.control - before, why, t: game.time });
      if (state.log.length > 40) state.log.shift();
      // crossing a quarter line is worth telling
      const q = (v) => Math.floor(v / 25);
      if (q(d.control) !== q(before)) hud.notify(`${name}: control ${Math.round(d.control)}%${d.control > before ? ' — your crew\'s colours go up' : ' — the street is slipping'}`, 3);
      game.emit('standing', { district: name, control: d.control, delta: d.control - before, why });
    }
    return d.control;
  }

  function addRespect(n, why = '') {
    p.respect = Math.max(0, p.respect + n);
    checkRank(why);
  }

  /** Applies every unlock up to the current rank (idempotent; runs on any respect change). */
  function checkRank() {
    const r = rankFor(p.respect);
    const ri = RANKS.indexOf(r);
    let slots = 1;
    for (const u of RANK_UNLOCKS) {
      const ui = RANKS.findIndex((k) => k.name === u.rank);
      if (ui < 0 || ui > ri) continue;
      slots = Math.max(slots, u.crewSlots);
      for (const id of u.weapons) {
        if (state.unlocked.includes(id)) continue;
        const slot = game.weapons.arsenal.find((s) => s.def.id === id);
        if (!slot) continue;
        slot.owned = true;
        game.weapons.refill(game.weapons.arsenal.indexOf(slot));
        state.unlocked.push(id);
        stats.unlocks++;
        hud.notify(`UNLOCKED: ${slot.def.name} (rank ${u.rank})`, 4);
        game.emit('unlock', { kind: 'weapon', id, rank: u.rank });
      }
    }
    if (slots > state.crewSlots) {
      state.crewSlots = slots;
      stats.unlocks++;
      hud.notify(`UNLOCKED: crew slot ${slots} — recruit another hand`, 4);
      game.emit('unlock', { kind: 'crewSlot', slots, rank: r.name });
    }
    if (r.name !== state.rank) {
      state.rank = r.name;
      stats.rankUps++;
      game.emit('rankUp', { rank: r.name, respect: p.respect });
    }
  }

  function onEvent(name, data) {
    if (name === 'gangKill' && (data.src === 'player' || data.src === 'blast-player' || data.src?.isCrew)) {
      adjust(districtAt(data.member.x, data.member.z).name, STANDING.gangKill, 'gang kill');
    } else if (name === 'missionComplete') {
      const def = game.missions.MISSIONS.find((m) => m.id === data.id);
      if (def) adjust(def.district, STANDING.mission, `mission ${def.name}`);
    } else if (name === 'raceFinish') {
      adjust(data.district, data.position === 1 ? STANDING.raceWin : data.position <= 3 ? STANDING.racePodium : STANDING.race, `race ${data.name}`);
    } else if (name === 'wasted') {
      adjust(districtAt(p.x, p.z).name, STANDING.wasted, 'wasted');
    } else if (name === 'busted') {
      adjust(districtAt(p.x, p.z).name, STANDING.busted, 'busted');
    } else if (name === 'crewDown') {
      adjust(districtAt(data.x, data.z).name, STANDING.crewDown, 'crew member down');
    }
  }

  let checkTimer = 0;
  function step(dt) {
    checkTimer -= dt;
    if (checkTimer <= 0) { checkTimer = 0.25; checkRank(); }
  }

  /** Map tints: red (rival) → amber → green (yours), by control. */
  function tints() {
    return districts.map((d) => {
      const t = d.control / 100;
      const r = Math.round(255 * (1 - t) + 40 * t);
      const g = Math.round(70 * (1 - t) + 220 * t);
      return { minX: d.minX, maxX: d.maxX, minZ: d.minZ, maxZ: d.maxZ, color: `rgba(${r},${g},90,0.28)`, label: `${d.name} ${Math.round(d.control)}%` };
    });
  }

  game.minimap.setTints?.(tints);
  return { districts, state, stats, adjust, addRespect, checkRank, districtAt, onEvent, step, tints, RANK_UNLOCKS };
}
