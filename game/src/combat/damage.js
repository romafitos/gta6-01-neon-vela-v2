// Damage rules for everyone: the player's health and armour, pedestrians who are hurt, flee or
// die, and cars that go from dented to smoking to burning to a fireball. An exploding car leaves
// a blackened wreck that keeps burning for a while, and the blast hurts every person, cop and car
// nearby (so one explosion can chain into the next). Crimes are reported to the wanted system.
import { PLAYER } from '../core/config.js';

export const CAR_SMOKE = 45;   // health below this: grey smoke
export const CAR_FIRE = 18;    // below this: the engine catches fire and burns down
const BURN_RATE = 7;           // health lost per second while on fire
const BLAST_RADIUS = 9;

export function createCombat(game) {
  const { fx, player, vehicles, peds } = game;
  const stats = { pedKills: 0, explosions: 0, wrecks: 0, playerDamage: 0 };
  const wrecks = [];

  function hurtPlayer(amount, src) {
    const p = player.state;
    if (p.health <= 0 || game.respawning) return;
    const absorbed = Math.min(p.armor, amount * 0.66);
    p.armor -= absorbed;
    p.health = Math.max(0, p.health - (amount - absorbed));
    stats.playerDamage += amount;
    game.hud.flashDamage?.();
    if (p.health <= 0) game.emit('wasted', { src });
  }

  /** Returns true when the hit killed the pedestrian. */
  function hurtPed(ped, amount, src) {
    if (ped.mode === 'dead') return false;
    ped.health = (ped.health ?? 30) - amount;
    const fromPlayer = !src || src === 'player' || src === 'blast-player';
    if (ped.health <= 0) {
      ped.mode = 'dead';
      ped.vx = ped.vz = 0;
      stats.pedKills++;
      if (fromPlayer) game.emit('crime', { type: 'kill', x: ped.x, z: ped.z });
      return true;
    }
    peds.scare(ped, player.state.x, player.state.z, 7);
    if (fromPlayer) game.emit('crime', { type: 'assault', x: ped.x, z: ped.z });
    return false;
  }

  function hurtCar(car, amount, src) {
    if (car.disabled || car.wrecked) return;
    if (car.perf) amount *= car.perf.armor; // garage armour plating
    car.health = Math.max(0, car.health - amount);
    if (car.driver === 'ai' && car.health < 70) {
      // a shot-up driver bails out and runs
      peds.ejectDriver(car, player.state.x, player.state.z);
      car.driver = null;
      car.ai = null;
    }
    if (src === 'player' || src == null) car.lastHitByPlayer = game.time;
  }

  /** Blows a car up: fireball, wreck, blast damage around it. */
  function explodeCar(car) {
    if (car.wrecked) return;
    car.wrecked = true;
    car.health = 0;
    car.burn = 22; // the wreck keeps burning this long
    car.vx *= 0.3; car.vz *= 0.3;
    car.vy = 0;
    stats.wrecks++;
    wrecks.push(car);
    vehicles.markWreck(car);
    const playerInside = player.state.car === car;
    if (car.driver === 'ai' || car.driver === 'police') car.driver = null;
    const byPlayer = car.lastHitByPlayer != null && game.time - car.lastHitByPlayer < 20;
    blast(car.x, car.z, byPlayer || playerInside ? 'blast-player' : 'blast');
    if (playerInside) {
      game.forceExit?.(car);
      hurtPlayer(55, 'blast');
    }
    game.emit('explosion', { car, x: car.x, z: car.z, byPlayer });
  }

  function blast(x, z, src) {
    stats.explosions++;
    fx.explosion(x, z);
    const fromPlayer = src === 'blast-player';
    if (fromPlayer) game.emit('crime', { type: 'explosion', x, z });
    for (const p of peds.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < BLAST_RADIUS) hurtPed(p, 90 * (1 - d / BLAST_RADIUS) + 15, fromPlayer ? 'blast-player' : 'blast');
      else if (d < 35) peds.scare(p, x, z, 6);
    }
    for (const c of game.police?.cops ?? []) {
      if (!c.active) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < BLAST_RADIUS) game.police.hurtCop(c, 90 * (1 - d / BLAST_RADIUS) + 15, fromPlayer ? 'player' : 'blast');
    }
    const ps = player.state;
    if (!ps.car) {
      const d = Math.hypot(ps.x - x, ps.z - z);
      if (d < BLAST_RADIUS) hurtPlayer(70 * (1 - d / BLAST_RADIUS) + 8, 'blast');
    }
    for (const car of vehicles.cars) {
      if (car.disabled || car.wrecked) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < BLAST_RADIUS * 0.8) {
        hurtCar(car, 75 * (1 - d / (BLAST_RADIUS * 0.8)) + 10, fromPlayer ? 'player' : 'blast');
        const k = (1 - d / BLAST_RADIUS) * 9 / (d || 1);
        car.vx += (car.x - x) * k; car.vz += (car.z - z) * k;
      }
    }
  }

  let fxTimer = 0;
  function step(dt) {
    fxTimer += dt;
    const puff = fxTimer > 0.09;
    if (puff) fxTimer = 0;
    for (const car of vehicles.cars) {
      if (car.disabled) continue;
      if (car.wrecked) {
        if (car.burn > 0) {
          car.burn -= dt;
          if (puff) { fx.flame(car.x, 1.0, car.z, 1.3); if (Math.random() < 0.5) fx.smokePuff(car.x, 2.2, car.z, true); }
        } else if (puff && Math.random() < 0.2) fx.smokePuff(car.x, 1.2, car.z, true);
        continue;
      }
      if (car.health <= CAR_FIRE) {
        car.onFire = true;
        car.health -= BURN_RATE * dt;
        const fx0 = Math.sin(car.heading) * 1.6;
        const fz0 = Math.cos(car.heading) * 1.6;
        if (puff) { fx.flame(car.x + fx0, 1.2, car.z + fz0, 0.8); fx.smokePuff(car.x + fx0, 1.8, car.z + fz0, true); }
        if (car.health <= 0) explodeCar(car);
      } else if (car.health <= CAR_SMOKE && puff && Math.random() < 0.6) {
        fx.smokePuff(car.x + Math.sin(car.heading) * 1.6, 1.3, car.z + Math.cos(car.heading) * 1.6, car.health < 30);
      }
    }
    const p = player.state;
    if (p.health > 0 && p.health < PLAYER.maxHealth * 0.35 && !game.respawning) p.health = Math.min(PLAYER.maxHealth * 0.35, p.health + dt * 0.8);
  }

  return { stats, wrecks, hurtPlayer, hurtPed, hurtCar, explodeCar, blast, step };
}
