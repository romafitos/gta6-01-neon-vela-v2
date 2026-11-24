// Combat effects drawn from fixed pools so gunfights never allocate or add draw calls:
// glowing particles (muzzle flashes, sparks, fire, explosion cores) in one additive instanced
// mesh, smoke in one soft instanced mesh, bullet tracers in one line buffer, plus two lights
// that always exist (a flash light and an explosion light) so the shader set never changes.
import * as THREE from 'three';

const GLOW_CAP = 420;
const SMOKE_CAP = 260;
const TRACER_CAP = 48;

export function createEffects(scene) {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const glowMesh = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), GLOW_CAP);
  // smoke puffs are soft round blobs (low-poly spheres, flat-shaded off) so plumes read as billowing, not boxes
  const puff = new THREE.IcosahedronGeometry(0.62, 1);
  const smokeMesh = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false }), SMOKE_CAP);
  for (const m of [glowMesh, smokeMesh]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    scene.add(m);
  }
  // seed instanceColor so the attribute exists before the first frame
  glowMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  smokeMesh.setColorAt(0, new THREE.Color(0.2, 0.2, 0.2));

  const tracerPos = new Float32Array(TRACER_CAP * 6);
  const tracerCol = new Float32Array(TRACER_CAP * 6);
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
  tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
  const tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);

  const flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
  const boomLight = new THREE.PointLight(0xff7a2a, 0, 40, 2);
  scene.add(flashLight, boomLight);

  const glow = [];
  const smoke = [];
  const tracers = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  let seed = 99173;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stats = { flashes: 0, explosions: 0, sparks: 0, tracers: 0 };

  function emit(list, cap, p) {
    if (list.length >= cap) list.shift();
    list.push(p);
  }

  function particle(list, cap, x, y, z, vx, vy, vz, life, size, hex, grow = 0, rise = 0) {
    emit(list, cap, { x, y, z, vx, vy, vz, life, max: life, size, hex, grow, rise, spin: rnd() * 3 });
  }

  /** Bright cone at a gun barrel, plus the flash light for a frame or two. */
  function muzzle(x, y, z, dx, dz) {
    stats.flashes++;
    for (let i = 0; i < 5; i++) {
      const sp = 3 + rnd() * 6;
      particle(glow, GLOW_CAP, x, y, z, dx * sp + (rnd() - 0.5) * 1.5, (rnd() - 0.3) * 1.2, dz * sp + (rnd() - 0.5) * 1.5, 0.06 + rnd() * 0.05, 0.16 + rnd() * 0.12, 0xffd27a);
    }
    flashLight.position.set(x, y, z);
    flashLight.intensity = 18;
  }

  function tracer(ax, ay, az, bx, by, bz, hex = 0xffe9a8) {
    stats.tracers++;
    if (tracers.length >= TRACER_CAP) tracers.shift();
    tracers.push({ ax, ay, az, bx, by, bz, life: 0.09, max: 0.09, hex });
  }

  function sparks(x, y, z, n = 6, hex = 0xffc65a) {
    stats.sparks++;
    for (let i = 0; i < n; i++) {
      particle(glow, GLOW_CAP, x, y, z, (rnd() - 0.5) * 8, rnd() * 5, (rnd() - 0.5) * 8, 0.2 + rnd() * 0.25, 0.07 + rnd() * 0.05, hex);
    }
  }

  function blood(x, y, z) {
    for (let i = 0; i < 6; i++) particle(smoke, SMOKE_CAP, x, y, z, (rnd() - 0.5) * 3, rnd() * 2, (rnd() - 0.5) * 3, 0.4, 0.12, 0x8a0f1e, 0, -6);
  }

  /** Grey smoke from a damaged car; dark when it is about to catch fire. */
  function smokePuff(x, y, z, dark = false) {
    particle(smoke, SMOKE_CAP, x + (rnd() - 0.5) * 0.6, y, z + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, 1.4 + rnd(), (rnd() - 0.5) * 0.6, 1.6 + rnd(), 0.5 + rnd() * 0.3, dark ? 0x232026 : 0x8d8a92, 0.9);
  }

  function flame(x, y, z, scale = 1) {
    const hex = rnd() < 0.5 ? 0xff7b1c : rnd() < 0.5 ? 0xffc83d : 0xff3d12;
    particle(glow, GLOW_CAP, x + (rnd() - 0.5) * 1.4 * scale, y, z + (rnd() - 0.5) * 1.4 * scale, (rnd() - 0.5) * 0.5, 2 + rnd() * 2, (rnd() - 0.5) * 0.5, 0.35 + rnd() * 0.3, (0.4 + rnd() * 0.4) * scale, hex, -0.6);
  }

  function explosion(x, z) {
    stats.explosions++;
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 4 + rnd() * 12;
      particle(glow, GLOW_CAP, x, 1 + rnd(), z, Math.cos(a) * sp, 2 + rnd() * 9, Math.sin(a) * sp, 0.45 + rnd() * 0.5, 0.5 + rnd() * 0.9, rnd() < 0.5 ? 0xffb02e : 0xff5a14, -0.4, -9);
    }
    for (let i = 0; i < 22; i++) {
      particle(smoke, SMOKE_CAP, x + (rnd() - 0.5) * 3, 1.5 + rnd() * 2, z + (rnd() - 0.5) * 3, (rnd() - 0.5) * 4, 2 + rnd() * 3, (rnd() - 0.5) * 4, 2.2 + rnd() * 1.5, 1.2 + rnd(), 0x2a2328, 1.2);
    }
    sparks(x, 1.2, z, 18, 0xfff0a0);
    boomLight.position.set(x, 3, z);
    boomLight.intensity = 260;
  }

  function stepList(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy += p.rise * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
      p.size = Math.max(0.02, p.size + p.grow * dt);
    }
  }

  function step(dt) {
    stepList(glow, dt);
    stepList(smoke, dt);
    for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].life -= dt; if (tracers[i].life <= 0) tracers.splice(i, 1); }
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);
    boomLight.intensity = Math.max(0, boomLight.intensity - dt * 420);
  }

  function writeList(mesh, list, fade) {
    let n = 0;
    for (const p of list) {
      const k = p.life / p.max;
      const sz = p.size * (fade ? 0.4 + k * 0.6 : 1);
      e.set(p.spin, p.spin * 0.7, 0);
      q.setFromEuler(e);
      m4.compose(v.set(p.x, p.y, p.z), q, s.set(sz, sz, sz));
      mesh.setMatrixAt(n, m4);
      col.setHex(p.hex);
      if (fade) col.multiplyScalar(0.35 + k * 0.9);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function sync() {
    writeList(glowMesh, glow, true);
    writeList(smokeMesh, smoke, false);
    let n = 0;
    for (const t of tracers) {
      const k = t.life / t.max;
      col.setHex(t.hex).multiplyScalar(k);
      tracerPos.set([t.ax, t.ay, t.az, t.bx, t.by, t.bz], n * 6);
      tracerCol.set([col.r, col.g, col.b, col.r * 0.4, col.g * 0.4, col.b * 0.4], n * 6);
      n++;
    }
    tracerGeo.setDrawRange(0, n * 2);
    tracerGeo.attributes.position.needsUpdate = true;
    tracerGeo.attributes.color.needsUpdate = true;
  }

  return { muzzle, tracer, sparks, blood, smokePuff, flame, explosion, step, sync, stats, counts: () => ({ glow: glow.length, smoke: smoke.length, tracers: tracers.length }) };
}
