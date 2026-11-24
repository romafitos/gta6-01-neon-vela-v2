// The on-foot player: camera-relative WASD movement with acceleration, Shift sprint, collision
// that slides along walls, and an unstuck guard that returns the player to the last safe spot
// (or the nearest road) if they ever end up inside geometry.
import { PLAYER } from '../core/config.js';
import { angleDelta, damp } from '../core/math.js';

export function createPlayer(crowd, world) {
  const mesh = crowd.add({ shirt: 0xffb347, pants: 0x23395b, skin: 0xb5764a, hair: 0x2a1a10 });

  const state = {
    x: world.layout.spawn.x,
    z: world.layout.spawn.z,
    vx: 0,
    vz: 0,
    heading: -Math.PI / 2, // facing west along the beach-road sidewalk
    health: PLAYER.maxHealth,
    cash: 0,
    car: null,
    stuckRescues: 0,
    distanceWalked: 0,
  };
  let safe = { x: state.x, z: state.z };
  let safeTimer = 0;

  /** One fixed step on foot. axes = {x,y}, camYaw = camera heading (radians). */
  function step(dt, axes, sprint, camYaw) {
    if (state.car) return;
    let ix = axes.x;
    let iy = axes.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    // camera forward is (sin yaw, cos yaw) in our convention: yaw 0 looks toward +z
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const rx = -fz;
    const rz = fx;
    const speed = sprint ? PLAYER.sprint : PLAYER.walk;
    const tx = (fx * iy + rx * ix) * speed;
    const tz = (fz * iy + rz * ix) * speed;
    const k = damp(len > 0 ? 12 : 16, dt);
    state.vx += (tx - state.vx) * k;
    state.vz += (tz - state.vz) * k;

    const px = state.x;
    const pz = state.z;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    const n = world.collision.resolveCircle(state, PLAYER.radius);
    if (n.hit) {
      // remove the velocity component pushing into the wall: slide along it
      const into = state.vx * n.x + state.vz * n.z;
      if (into < 0) { state.vx -= into * n.x; state.vz -= into * n.z; }
    }
    state.distanceWalked += Math.hypot(state.x - px, state.z - pz);

    const ground = Math.hypot(state.vx, state.vz);
    if (ground > 0.3) state.heading += angleDelta(state.heading, Math.atan2(state.vx, state.vz)) * damp(14, dt);
    unstuckGuard(dt);
    mesh.animate(ground, dt);
  }

  function unstuckGuard(dt) {
    if (world.collision.overlaps(state.x, state.z, PLAYER.radius * 0.6)) {
      const spot = world.layout.findClear(safe.x, safe.z, PLAYER.radius + 0.1);
      state.x = spot.x;
      state.z = spot.z;
      state.vx = state.vz = 0;
      state.stuckRescues++;
      return;
    }
    safeTimer += dt;
    if (safeTimer > 0.5) { safeTimer = 0; safe = { x: state.x, z: state.z }; }
  }

  function placeAt(x, z, heading = state.heading) {
    const spot = world.layout.findClear(x, z, PLAYER.radius + 0.15);
    state.x = spot.x;
    state.z = spot.z;
    state.vx = state.vz = 0;
    state.heading = heading;
    safe = { x: state.x, z: state.z };
  }

  function syncMesh() {
    mesh.root.visible = !state.car;
    mesh.root.position.set(state.x, 0.12, state.z);
    mesh.root.rotation.y = state.heading;
  }

  return { state, mesh, step, placeAt, syncMesh };
}
