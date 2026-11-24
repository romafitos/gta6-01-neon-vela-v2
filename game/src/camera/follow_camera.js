// Third-person chase camera. Mouse turns yaw/pitch; on foot the camera orbits the player, in a car
// it swings back behind the bonnet when the mouse is idle. A ground-plane line-of-sight check pulls
// the camera in so walls never hide the player.
import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../core/math.js';

export function createFollowCamera(world, aspect) {
  const camera = new THREE.PerspectiveCamera(62, aspect, 0.2, 2200);
  const state = { yaw: Math.PI, pitch: 0.18, dist: 6, idle: 0 };
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();

  function addLook(dx, dy) {
    state.yaw -= dx * 0.0032;
    state.pitch = clamp(state.pitch + dy * 0.0024, -0.25, 0.9);
    if (dx || dy) state.idle = 0;
  }

  /** target = {x, z, heading, inCar, speed}. */
  function update(dt, target) {
    state.idle += dt;
    const wantDist = target.inCar ? 9.5 + Math.min(4, Math.abs(target.speed) * 0.08) : 5.2;
    state.dist += (wantDist - state.dist) * damp(4, dt);
    if (target.inCar && state.idle > 0.9 && Math.abs(target.speed) > 2) {
      const behind = target.speed >= 0 ? target.heading : target.heading + Math.PI;
      state.yaw += angleDelta(state.yaw, behind) * damp(3, dt);
      state.pitch += (0.2 - state.pitch) * damp(2, dt);
    }
    const height = target.inCar ? 1.4 : 1.6;
    const fx = Math.sin(state.yaw);
    const fz = Math.cos(state.yaw);
    let d = state.dist * Math.cos(state.pitch);
    // pull in when a building sits between the player and the camera
    for (let tries = 0; tries < 6; tries++) {
      if (world.collision.clearLine(target.x, target.z, target.x - fx * d, target.z - fz * d, 0.3)) break;
      d *= 0.7;
    }
    const cx = target.x - fx * d;
    const cz = target.z - fz * d;
    const cy = height + 0.6 + state.dist * Math.sin(state.pitch);
    pos.set(cx, Math.max(0.6, cy), cz);
    camera.position.lerp(pos, damp(target.inCar ? 10 : 18, dt));
    look.set(target.x + fx * 2, height, target.z + fz * 2);
    camera.lookAt(look);
  }

  function snap(target) {
    state.yaw = target.heading;
    state.dist = target.inCar ? 9.5 : 5.2;
    camera.position.set(target.x - Math.sin(state.yaw) * state.dist, 3, target.z - Math.cos(state.yaw) * state.dist);
    camera.lookAt(target.x, 1.6, target.z);
  }

  return { camera, state, addLook, update, snap };
}
