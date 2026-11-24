// Arcade car physics shared by the player and AI drivers: throttle/brake/reverse along the
// heading, speed-sensitive steering, lateral grip (looser on the handbrake for slides), and
// two body circles that slide along buildings instead of sticking.
import { CAR } from '../core/config.js';
import { clamp } from '../core/math.js';

export function createCarBody(x, z, heading) {
  return {
    x, z, heading,
    vx: 0, vz: 0,
    speed: 0,          // signed forward speed, m/s
    steerInput: 0,
    controls: { throttle: 0, steer: 0, handbrake: false },
    health: 100,
    lastImpact: 0,
    impacts: 0,
  };
}

/** Advances one car one fixed step and resolves it against the static world. */
export function stepCarBody(car, dt, collision) {
  const c = car.controls;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = -fz;
  const rz = fx;
  let fwd = car.vx * fx + car.vz * fz;
  let lat = car.vx * rx + car.vz * rz;

  if (c.throttle > 0) fwd += (fwd < -0.5 ? CAR.brake : CAR.accel) * c.throttle * dt;
  else if (c.throttle < 0) fwd += (fwd > 0.5 ? -CAR.brake : -CAR.accel * 0.6) * -c.throttle * dt;
  else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), CAR.rolling * dt);
  fwd -= fwd * Math.abs(fwd) * CAR.drag * 0.01 * dt * 10;
  fwd = clamp(fwd, -CAR.maxReverse, CAR.maxSpeed);
  if (c.handbrake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 9 * dt);

  car.steerInput += (c.steer - car.steerInput) * Math.min(1, dt * 8);
  const speedFactor = clamp(fwd / 6, -1, 1) * (1 - 0.55 * Math.min(1, Math.abs(fwd) / CAR.maxSpeed));
  car.heading += car.steerInput * CAR.steer * speedFactor * dt * (c.handbrake ? 1.5 : 1);

  lat *= Math.exp(-(c.handbrake ? CAR.handbrakeGrip : CAR.grip) * dt);
  const nfx = Math.sin(car.heading);
  const nfz = Math.cos(car.heading);
  car.vx = nfx * fwd + -nfz * lat;
  car.vz = nfz * fwd + nfx * lat;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = fwd;

  resolveCarStatic(car, collision);
}

function resolveCarStatic(car, collision) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let pushX = 0;
  let pushZ = 0;
  let nx = 0;
  let nz = 0;
  for (const s of [1, -1]) {
    const p = { x: car.x + fx * CAR.circleOffset * s, z: car.z + fz * CAR.circleOffset * s };
    const ox = p.x;
    const oz = p.z;
    const n = collision.resolveCircle(p, CAR.circleRadius);
    if (n.hit) { pushX += p.x - ox; pushZ += p.z - oz; nx += n.x; nz += n.z; }
  }
  // centre circle catches thin poles between the two end circles
  const mid = { x: car.x, z: car.z };
  const nm = collision.resolveCircle(mid, CAR.circleRadius);
  if (nm.hit) { pushX += mid.x - car.x; pushZ += mid.z - car.z; nx += nm.x; nz += nm.z; }
  if (nx === 0 && nz === 0) return;
  car.x += pushX;
  car.z += pushZ;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  const into = car.vx * nx + car.vz * nz;
  if (into < 0) {
    car.vx -= into * nx * 1.25; // a little bounce
    car.vz -= into * nz * 1.25;
    car.vx *= 0.82;
    car.vz *= 0.82;
    const impact = -into;
    car.lastImpact = impact;
    if (impact > 4) { car.impacts++; car.health = Math.max(0, car.health - impact * 0.8); }
    const fwd = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
    car.speed = fwd;
  }
}

/** Pushes two overlapping cars apart and trades momentum along the contact normal. */
export function resolveCarPair(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  const min = CAR.circleRadius * 2 + 0.9;
  if (d2 >= min * min || d2 < 1e-6) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const overlap = (min - d) / 2;
  a.x -= nx * overlap; a.z -= nz * overlap;
  b.x += nx * overlap; b.z += nz * overlap;
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel < 0) {
    const j = -rel * 0.6;
    a.vx -= nx * j; a.vz -= nz * j;
    b.vx += nx * j; b.vz += nz * j;
  }
  return true;
}
