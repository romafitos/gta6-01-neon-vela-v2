// Automated audit for Neon Vela (run outside the game; not shipped in game/).
//   node tools/audit.mjs            serves game/ on a free localhost port and drives headless Chromium
// Env: PW_PATH = path to the playwright package (default /tmp/pw/node_modules/playwright),
//      PLAY_SECONDS = length of the scripted free-play soak (default 30).
// Asserts: no request leaves localhost, zero console errors, Play works on the first click,
// movement / sprint / look / enter / drive / steer / exit / pause / map all change state, and a
// wall-and-corner bot (on foot and in a car) never ends up inside geometry or stuck.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../game', import.meta.url)));
const PW = process.env.PW_PATH ?? '/tmp/pw/node_modules/playwright/index.js';
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 30);
const pwModule = await import(PW.endsWith('.js') ? PW : join(PW, 'index.js'));
const chromium = pwModule.chromium ?? pwModule.default.chromium;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, normalize(p)));
  if (!file.startsWith(root + sep) && file !== root) return res.writeHead(403).end();
  try { statSync(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const external = [];
const errors = [];
await page.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
  external.push(u.href);
  return route.abort();
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/?audit=1`);
await page.waitForFunction(() => window.__game && window.__game.screen === 'title', null, { timeout: 30000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const pstate = () => G(() => { const p = window.__game.game.player.state; const c = p.car; return { x: c ? c.x : p.x, z: c ? c.z : p.z, inCar: !!p.car, speed: p.car ? p.car.speed : Math.hypot(p.vx, p.vz), heading: p.heading, rescues: p.stuckRescues }; });
const insideGeometry = () => G(() => { const g = window.__game.game; const p = g.player.state; return g.world.collision.overlaps(p.x, p.z, 0.3); });

// 1. Play responds to the first click
check('title screen shown on load', await page.isVisible('#play-btn'));
check('spawn is clear of geometry', !(await insideGeometry()));
await page.click('#play-btn');
await page.waitForTimeout(150);
check('Play starts gameplay on the FIRST click', (await G(() => window.__game.screen)) === 'play');
check('HUD visible in play', await page.isVisible('#hud'));
// software GL compiles shaders on the first play frames: let the simulation get going first
await page.waitForFunction(() => window.__game.game.stats.steps > 30, null, { timeout: 30000 });
const waitFor = (fn, ms = 4000, arg = null) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);

// 2. on-foot controls
let a = await pstate();
await page.keyboard.down('KeyW');
const tW = Date.now();
const movedW = await waitFor((s) => { const p = window.__game.game.player.state; return Math.hypot(p.x - s.x, p.z - s.z) > 3; }, 6000, a);
await page.keyboard.up('KeyW');
let b = await pstate();
check('W moves the player', movedW, `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m in ${((Date.now() - tW) / 1000).toFixed(1)} s`);
a = await pstate();
await hold(['ArrowLeft'], 800);
b = await pstate();
check('Arrow keys move the player', Math.hypot(b.x - a.x, b.z - a.z) > 1);
await page.keyboard.down('KeyW');
await page.waitForTimeout(400);
const walkSpeed = (await pstate()).speed;
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(600);
const sprintSpeed = (await pstate()).speed;
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
check('Shift sprint is faster than walking', sprintSpeed > walkSpeed + 2, `walk ${walkSpeed.toFixed(1)} vs sprint ${sprintSpeed.toFixed(1)} m/s`);
const yaw0 = await G(() => window.__game.game.cam.state.yaw);
await page.mouse.move(640, 360);
await page.mouse.move(840, 360, { steps: 8 });
await page.waitForTimeout(100);
const yaw1 = await G(() => window.__game.game.cam.state.yaw);
check('mouse turns the camera', Math.abs(yaw1 - yaw0) > 0.2, `yaw Δ ${(yaw1 - yaw0).toFixed(2)} rad`);

// 3. enter / drive / steer / exit
await G(() => { const g = window.__game.game; const c = g.spawnCar; g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4); });
await page.waitForTimeout(100);
await page.keyboard.press('KeyE');
check('E enters a nearby car', await waitFor(() => !!window.__game.game.player.state.car));
// point the car down an open road before driving
await G(() => { const g = window.__game.game; const c = g.player.state.car; const L = g.world.layout; c.x = L.roadX[2]; c.z = L.roadZ[3] + 4.5; c.heading = Math.PI / 2; c.vx = c.vz = 0; });
a = await pstate();
await page.keyboard.down('KeyW');
await waitFor((s) => { const c = window.__game.game.player.state.car; return c.speed > 8 && Math.hypot(c.x - s.x, c.z - s.z) > 10; }, 8000, a);
await page.keyboard.up('KeyW');
b = await pstate();
check('W accelerates the car', b.speed > 8 && Math.hypot(b.x - a.x, b.z - a.z) > 10, `${(b.speed * 3.6).toFixed(0)} km/h, ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} m`);
const h0 = b.heading;
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
await waitFor((h) => Math.abs(window.__game.game.player.state.car.heading - h) > 0.3, 6000, h0);
await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
const h1 = (await pstate()).heading;
check('A/D steer the car', Math.abs(h1 - h0) > 0.3, `heading Δ ${(h1 - h0).toFixed(2)} rad`);
await hold(['KeyS'], 2500);
await page.keyboard.press('KeyF');
await waitFor(() => !window.__game.game.player.state.car);
const out = await pstate();
check('F exits the car', !out.inCar, `speed before exit ${Math.abs(b.speed).toFixed(1)}`);
check('exit position is clear of geometry', !(await insideGeometry()));

// carjack a traffic car
const jacked = await G(() => {
  const g = window.__game.game;
  const c = g.vehicles.cars.find((x) => x.driver === 'ai');
  if (!c) return null;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4);
  c.vx = c.vz = 0;
  const before = g.stats.carjacks;
  g.input.clear();
  return before;
});
await page.keyboard.press('KeyE');
await waitFor(() => !!window.__game.game.player.state.car);
const afterJack = await G(() => window.__game.game.stats.carjacks);
check('E carjacks a traffic car (driver ejected)', jacked !== null && afterJack === jacked + 1 && (await pstate()).inCar);
await hold(['KeyS'], 800);

// 4. pause and map
await page.keyboard.press('Escape');
check('Esc pauses', (await waitFor(() => window.__game.screen === 'paused')) && (await page.isVisible('#pause')));
await page.keyboard.press('Escape');
check('Esc resumes', await waitFor(() => window.__game.screen === 'play'));
await page.keyboard.press('KeyM');
const big = await waitFor(() => window.__game.game.minimap.isBig());
await page.keyboard.press('KeyM');
check('M toggles the big map', big && (await waitFor(() => !window.__game.game.minimap.isBig())));

// 5. wall + corner bot on foot: 12 building corners, push diagonally into each, then walk away
const corners = await G(() => {
  const L = window.__game.game.world.layout;
  return L.buildings.filter((_, i) => i % Math.max(1, Math.floor(L.buildings.length / 12)) === 0).slice(0, 12)
    .map((bd) => ({ x: bd.maxX + 1.2, z: bd.maxZ + 1.2 }));
});
let footInside = 0;
let footStuck = 0;
for (const c of corners) {
  await G((c) => { const g = window.__game.game; g.player.placeAt(c.x, c.z); g.cam.state.yaw = Math.PI * 1.25; }, c);
  // camera yaw 1.25π looks toward -x,-z: W drives the player into the corner, A/D scrape the walls
  for (const keys of [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'ShiftLeft']]) {
    await hold(keys, 350);
    if (await insideGeometry()) footInside++;
  }
  const before = await pstate();
  await page.keyboard.down('KeyS');
  const freed = await waitFor((b) => { const p = window.__game.game.player.state; return Math.hypot(p.x - b.x, p.z - b.z) > 1.5; }, 4000, before);
  await page.keyboard.up('KeyS');
  if (!freed) footStuck++;
}
check('corner bot (foot): never inside geometry', footInside === 0, `${corners.length} corners × 4 pushes, ${footInside} inside`);
check('corner bot (foot): always walks free', footStuck === 0, `${footStuck} stuck`);

// 6. car into walls: ram 6 buildings, then reverse away
let carInside = 0;
let carStuck = 0;
const rams = corners.slice(0, 6);
// make sure we start on foot (a queued exit can fail while the jacked car is still rolling)
await G(() => { const g = window.__game.game; const c = g.player.state.car; if (c) { c.vx = c.vz = 0; c.speed = 0; g.exitCar(); } g.input.clear(); });
await G(() => { const g = window.__game.game; const c = g.spawnCar; g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4); });
await page.keyboard.press('KeyE');
check('ram bot boards its car', await waitFor(() => !!window.__game.game.player.state.car));
for (const c of rams) {
  await G((c) => { const g = window.__game.game; const car = g.player.state.car; const spot = g.world.layout.findClear(c.x + 8, c.z + 8, 2.6); car.x = spot.x; car.z = spot.z; car.heading = Math.PI * 1.25; car.vx = car.vz = 0; }, c);
  await page.keyboard.down('KeyW');
  await waitFor(() => window.__game.game.player.state.car.impacts > 0 || window.__game.game.player.state.car.lastImpact > 2, 5000);
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await G(() => { window.__game.game.player.state.car.impacts = 0; window.__game.game.player.state.car.lastImpact = 0; });
  const inside = await G(() => {
    const g = window.__game.game; const car = g.player.state.car; const col = g.world.collision;
    const fx = Math.sin(car.heading); const fz = Math.cos(car.heading);
    return [1, 0, -1].some((s) => col.overlaps(car.x + fx * 1.25 * s, car.z + fz * 1.25 * s, 0.7)) ? `car@${car.x.toFixed(1)},${car.z.toFixed(1)} h${car.heading.toFixed(2)}` : '';
  });
  if (inside) { carInside++; console.log('  inside:', inside); }
  const before = await pstate();
  await page.keyboard.down('KeyS');
  const freed = await waitFor((b) => { const c = window.__game.game.player.state.car; return Math.hypot(c.x - b.x, c.z - b.z) > 1.5; }, 5000, before);
  await page.keyboard.up('KeyS');
  if (!freed) carStuck++;
}
check('car ram bot: body never inside a building', carInside === 0, `${rams.length} rams, ${carInside} inside`);
check('car ram bot: always reverses free', carStuck === 0, `${carStuck} stuck`);
await hold(['KeyS'], 600);
await page.keyboard.press('KeyE');

// 7. scripted free play soak: random held keys and mouse sweeps
await G(() => { window.__game.perf.frameMs.length = 0; });
const errorsBefore = errors.length;
const keysPool = [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'ShiftLeft'], ['KeyS'], ['KeyE'], ['KeyW', 'Space']];
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const t0 = Date.now();
let maxInside = 0;
while (Date.now() - t0 < PLAY_SECONDS * 1000) {
  const keys = keysPool[Math.floor(rnd() * keysPool.length)];
  if (keys[0] === 'KeyE') await page.keyboard.press('KeyE');
  else await hold(keys, 400 + rnd() * 900);
  await page.mouse.move(400 + rnd() * 480, 300 + rnd() * 120, { steps: 4 });
  const st = await pstate();
  if (!st.inCar && (await insideGeometry())) maxInside++;
}
const perf = await G(() => {
  const a = [...window.__game.perf.frameMs].sort((x, y) => x - y);
  return { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)], info: window.__game.renderInfo() };
});
check(`free-play soak ${PLAY_SECONDS}s: zero new console errors`, errors.length === errorsBefore);
check('free-play soak: never inside geometry', maxInside === 0);
console.log(`PERF frames=${perf.n} median=${perf.median?.toFixed(1)}ms p95=${perf.p95?.toFixed(1)}ms drawCalls=${perf.info.calls} tris=${perf.info.triangles}`);


// 8. combat and police (checkpoint 2). Every check reads simulation state, not the HUD.
const reset = () => G(() => {
  const g = window.__game.game;
  const c = g.player.state.car; if (c) { c.vx = c.vz = 0; c.speed = 0; g.forceExit(c); }
  g.wantedSystem.clear(); g.police.standDown(); g.input.clear();
  g.player.state.health = 100;
  g.weapons.arsenal.forEach((_, i) => g.weapons.refill(i));
  if (g.wheel.state.open) g.wheel.close();
});
// an open stretch of beach: no traffic, a clear line of fire toward +x
const beach = await G(() => {
  const g = window.__game.game; const L = g.world.layout; const col = g.world.collision;
  for (let x = L.roadX[1]; x < L.roadX[7]; x += 7) {
    const z = L.bounds.beachStart + 34;
    if (!col.overlaps(x, z, 1) && col.clearLine(x, z, x + 16, z, 0.8)) return { x, z };
  }
  return { x: L.roadX[3], z: L.bounds.beachStart + 34 };
});
await reset();
const setupTarget = (dist) => G(({ beach, dist }) => {
  const g = window.__game.game;
  g.player.placeAt(beach.x, beach.z, Math.PI / 2);
  g.player.state.x = beach.x; g.player.state.z = beach.z;
  g.cam.state.yaw = Math.PI / 2; // looking toward +x
  const ped = g.peds.peds[0];
  Object.assign(ped, { x: beach.x + dist, z: beach.z, vx: 0, vz: 0, mode: 'down', timer: 999, health: 1000, loop: -1 });
  return ped.health;
}, { beach, dist });
const WEAPON_IDS = await G(() => window.__game.game.weapons.arsenal.map((s) => s.def.id));
for (let i = 0; i < WEAPON_IDS.length; i++) {
  await reset();
  const melee = i < 2;
  const before = await setupTarget(melee ? 1.3 : 7);
  await page.keyboard.press(`Digit${i + 1}`);
  await waitFor((i) => window.__game.game.weapons.state.index === i, 2000, i);
  await page.waitForTimeout(300); // weapon swap delay
  // a last round of the previous weapon can land during the swap: measure from here
  await G(() => { window.__game.game.peds.peds[0].health = 1000; });
  const shots0 = await G((id) => window.__game.game.weapons.stats.byWeapon[id].shots, WEAPON_IDS[i]);
  await G(({ beach, d }) => { const g = window.__game.game; const ped = g.peds.peds[0]; ped.x = beach.x + d; ped.z = beach.z; g.cam.state.yaw = Math.PI / 2; }, { beach, d: melee ? 1.3 : 7 });
  await page.mouse.move(480, 270);
  await page.mouse.down();
  const hit = await waitFor(({ before, beach, d }) => { const g = window.__game.game; const ped = g.peds.peds[0]; ped.x = beach.x + d; ped.z = beach.z; g.cam.state.yaw = Math.PI / 2; return ped.health < before; }, 4000, { before, beach, d: melee ? 1.3 : 7 });
  await page.mouse.up();
  const r = await G((id) => { const g = window.__game.game; return { hp: g.peds.peds[0].health, shots: g.weapons.stats.byWeapon[id].shots, name: g.weapons.current().def.name }; }, WEAPON_IDS[i]);
  check(`weapon ${i + 1} (${r.name}) fires and damages a target`, hit && r.shots > shots0, `target hp ${before} → ${r.hp.toFixed(0)}, ${r.shots - shots0} shots`);
}
// distinct weapon stats
const distinct = await G(() => new Set(window.__game.game.weapons.arsenal.map((s) => `${s.def.damage}/${s.def.rate}/${s.def.spread ?? 0}`)).size);
check('weapons have distinct damage / rate / spread', distinct === WEAPON_IDS.length, `${distinct} distinct profiles`);

// weapon wheel: hold Q, steer with the mouse, release to equip
await reset();
await page.keyboard.press('Digit1');
await waitFor(() => window.__game.game.weapons.state.index === 0, 2000);
await page.keyboard.down('KeyQ');
const wheelOpen = await waitFor(() => window.__game.game.wheel.state.open && window.__game.game.timeScale < 0.5, 8000);
const slowed = await G(() => window.__game.game.timeScale);
// slice 3 (index 3) sits down-right of centre: push the mouse that way
await page.mouse.move(480, 270);
await page.mouse.move(480 + 90, 270 + 60, { steps: 6 });
await page.waitForTimeout(150);
await page.keyboard.up('KeyQ');
await waitFor(() => !window.__game.game.wheel.state.open, 8000);
const afterQ = await G(() => ({ open: window.__game.game.wheel.state.open, index: window.__game.game.weapons.state.index, ts: window.__game.game.timeScale }));
check('Q opens the weapon wheel and slows time', wheelOpen, `timeScale ${slowed}`);
check('releasing Q equips the selected weapon', !afterQ.open && afterQ.index !== 0 && afterQ.ts === 1, `now weapon ${afterQ.index + 1}`);
await page.keyboard.press('Tab');
const tabOpen = await waitFor(() => window.__game.game.wheel.state.open, 8000);
await page.click('.wheel-slice:nth-of-type(5)'); // fifth slice button = Shotgun
await waitFor(() => !window.__game.game.wheel.state.open, 8000);
const tabPick = await G(() => ({ open: window.__game.game.wheel.state.open, index: window.__game.game.weapons.state.index }));
check('Tab toggles the wheel; clicking a slice equips it', tabOpen && !tabPick.open && tabPick.index === 4, `weapon ${tabPick.index + 1}`);
await page.keyboard.press('Digit3');
const d3 = await waitFor(() => window.__game.game.weapons.state.index === 2, 6000);
await page.mouse.wheel(0, 120);
const wheeled = await waitFor(() => window.__game.game.weapons.state.index === 3, 6000);
check('number keys and mouse wheel switch weapons', d3 && wheeled);

// wanted: crime raises stars, hiding lets them decay
await reset();
await setupTarget(7);
await page.keyboard.press('Digit3');
await page.waitForTimeout(350);
await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
const starsShot = await waitFor(() => window.__game.game.wanted >= 1, 8000);
const s1 = await G(() => window.__game.game.wanted);
await G(() => { const ped = window.__game.game.peds.peds[0]; ped.health = 5; });
// the pistol is semi-automatic: one pull per click, keep the panicking bystander in the line of fire
let killed = false;
for (let k = 0; k < 12 && !killed; k++) {
  await G((beach) => { const g = window.__game.game; const ped = g.peds.peds[0]; if (ped.mode !== 'dead') { ped.x = beach.x + 7; ped.z = beach.z; ped.vx = ped.vz = 0; } g.player.placeAt(beach.x, beach.z, Math.PI / 2); g.cam.state.yaw = Math.PI / 2; }, beach);
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  killed = await waitFor(() => window.__game.game.peds.peds[0].mode === 'dead', 600);
}
await page.waitForTimeout(200);
const heat = await G(() => ({ heat: window.__game.game.wantedSystem.state.heat, stars: window.__game.game.wanted, dead: window.__game.game.peds.peds[0].mode }));
check('gunfire raises the wanted level', starsShot, `${s1}★`);
check('killing a bystander raises the heat further', heat.dead === 'dead' && heat.heat > s1 + 0.5, `heat ${heat.heat.toFixed(2)}, ${heat.stars}★`);
// escape: teleport far from every unit and the last sighting, then wait out the cooldown
await G(() => { const g = window.__game.game; g.police.standDown(); g.wantedSystem.force(1); g.wantedSystem.state.knownFor = 0; g.wantedSystem.state.lastSeen = { x: g.player.state.x, z: g.player.state.z }; const L = g.world.layout; g.player.placeAt(L.roadX[0] + 13, L.roadZ[0] + 13); });
// units dispatched for the forced star may still have eyes on the player for a while: watch the
// whole hiding period for the flashing (unseen) state, then for the decay
const flashing = await waitFor(() => { const g = window.__game.game; if (g.wantedFlash && g.wanted > 0) window.__sawFlash = true; return !!window.__sawFlash; }, 25000);
const decayed = await waitFor(() => window.__game.game.wanted === 0, 25000);
check('stars flash while the player is unseen', flashing);
check('stars decay to zero after hiding', decayed, `cooldown ${await G(() => window.__game.game.wantedSystem.cooldownFor(1))} s at 1★`);

// forced 3 stars in a car: a roadblock on a road ahead, and a RAM/PIT contact
await reset();
await G(() => {
  const g = window.__game.game; const L = g.world.layout; const c = g.spawnCar;
  if (c.wrecked) { c.wrecked = false; c.health = 100; }
  c.x = L.roadX[4]; c.z = L.roadZ[2] + 4.5; c.heading = Math.PI / 2; c.vx = c.vz = 0; c.health = 100;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4);
  g.input.clear();
});
await G(() => window.__game.game.enterNearestCar());
await G(() => { const g = window.__game.game; const c = g.player.state.car; const L = g.world.layout; c.x = L.roadX[4]; c.z = L.roadZ[2] + 4.5; c.heading = Math.PI / 2; g.wantedSystem.force(3); });
const rb = await waitFor(() => window.__game.game.police.roadblocks.length > 0, 15000);
const rbInfo = await G(() => {
  const g = window.__game.game; const b = g.police.roadblocks[0]; if (!b) return null; const L = g.world.layout; const p = g.player.state.car;
  const r = L.nearestRoadPoint(b.x, b.z);
  return { onRoad: Math.hypot(r.x - b.x, r.z - b.z) < 8, dist: Math.hypot(b.x - p.x, b.z - p.z), cars: b.cars.length, barriers: b.barriers.length, street: b.street };
});
check('3★: a roadblock is set on a road near the player', rb && rbInfo && rbInfo.onRoad && rbInfo.dist < 200 && rbInfo.cars >= 1, rbInfo ? `${rbInfo.street}, ${rbInfo.dist.toFixed(0)} m, ${rbInfo.cars} cruisers + ${rbInfo.barriers} barriers` : 'none');
const contact = await waitFor(() => { const g = window.__game.game; const c = g.player.state.car; if (c) { c.health = Math.max(c.health, 60); } g.player.state.health = 100; if (g.wanted < 3) g.wantedSystem.force(3); return g.police.stats.rams + g.police.stats.pits > 0; }, 40000);
const cst = await G(() => window.__game.game.police.stats);
check('3★: a cruiser makes RAM/PIT contact with the player car', contact, `rams ${cst.rams}, PITs ${cst.pits}, cruisers spawned ${cst.carsSpawned}`);

// PIT on purpose: the player drives straight down an avenue at speed, an even-numbered (PIT)
// cruiser comes up on the rear quarter; the manoeuvre must register and spin the car
const pitBase = await G(() => window.__game.game.police.stats.pits);
await G(() => {
  const g = window.__game.game; const L = g.world.layout; const c = g.player.state.car;
  g.police.standDown(); g.wantedSystem.force(3);
  // the open avenue along roadZ[1], heading +x
  c.x = L.roadX[0] + 20; c.z = L.roadZ[1] + 4.5; c.heading = Math.PI / 2; c.vx = 16; c.vz = 0; c.speed = 16; c.health = 100;
});
await page.keyboard.down('KeyW');
let pitHeading = null;
const pitDone = await waitFor((base) => {
  const g = window.__game.game; const c = g.player.state.car; if (!c) return false;
  g.player.state.health = 100; c.health = Math.max(c.health, 60); if (g.wanted < 3) g.wantedSystem.force(3);
  // keep the run straight and on the avenue until contact
  if (g.police.stats.pits === base) { c.heading = Math.PI / 2; c.z = g.world.layout.roadZ[1] + 4.5; c.vz = 0; if (c.x > g.world.layout.roadX[7]) { c.x = g.world.layout.roadX[0] + 20; } }
  // bring a PIT unit up behind on the left rear quarter
  let u = g.police.cruisers.find((k) => k.unit % 2 === 0);
  for (let n = 0; n < 4 && !u; n++) { g.police.spawnCruiser('pit'); u = g.police.cruisers.find((k) => k.unit % 2 === 0); }
  if (u && (u.disabled || u.wrecked || u.driver !== 'police')) {
    g.vehicles.revive(u, c.x - 9, c.z - 1.6, Math.PI / 2);
    Object.assign(u, { driver: 'police', role: 'pit', route: null, routeTimer: 0, stuck: 0, reverse: 0, contactCd: 0, fireCd: 3 });
  }
  if (u && g.police.stats.pits === base && Math.hypot(u.x - c.x, u.z - c.z) > 14) {
    u.x = c.x - 9; u.z = c.z - 1.6; u.heading = Math.PI / 2; u.vx = c.vx + 3; u.vz = 0; u.speed = Math.hypot(u.vx, u.vz); u.contactCd = 0;
  }
  return g.police.stats.pits > base;
}, 40000, pitBase);
await page.keyboard.up('KeyW');
const pitInfo = await G(() => { const g = window.__game.game; return { pits: g.police.stats.pits, heading: g.player.state.car?.heading }; });
pitHeading = pitInfo.heading;
check('3★: a cruiser performs a PIT manoeuvre on the speeding player car', pitDone, `PITs ${pitInfo.pits - pitBase}, car heading after ${pitHeading?.toFixed(2)} rad (was 1.57)`);

// forced 4 stars: the air unit arrives and its searchlight tracks the player
await G(() => window.__game.game.wantedSystem.force(4));
const heliUp = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); return g.police.heli.active; }, 15000);
const locked = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); if (g.wanted < 4) g.wantedSystem.force(4); return g.police.heli.lightError < 6; }, 30000);
let maxErr = 0;
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(250);
  const e = await G(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); if (g.wanted < 4) g.wantedSystem.force(4); return g.police.heli.lightError; });
  maxErr = Math.max(maxErr, e);
}
check('4★: the police helicopter is deployed', heliUp);
check('4★: its searchlight stays on the player for 5 s', locked && maxErr < 8, `max error ${maxErr.toFixed(1)} m (pool radius 6.5 m)`);

// a car shot to pieces burns, explodes, leaves a wreck and the blast hurts bystanders
await reset();
const victim = await G(({ beach }) => {
  const g = window.__game.game;
  const car = g.vehicles.cars.find((c) => c.kind === 'parked' && !c.wrecked && c !== g.spawnCar);
  car.x = beach.x + 13; car.z = beach.z; car.heading = 0; car.vx = car.vz = 0; car.health = 100;
  const ped = g.peds.peds[1];
  Object.assign(ped, { x: beach.x + 13, z: beach.z + 4, mode: 'down', timer: 999, health: 1000, loop: -1, vx: 0, vz: 0 });
  g.player.placeAt(beach.x, beach.z, Math.PI / 2);
  g.cam.state.yaw = Math.PI / 2;
  return { id: car.id, booms: g.fx.stats.explosions };
}, { beach });
await page.keyboard.press('Digit6');
await page.waitForTimeout(350);
await page.mouse.down();
const smoked = await waitFor((id) => { const g = window.__game.game; g.cam.state.yaw = Math.PI / 2; g.player.state.health = 100; return g.vehicles.cars[id].health < 45; }, 6000, victim.id);
// keep firing: below 18 hp the engine catches fire and burns down to the explosion
const exploded = await waitFor((id) => { const g = window.__game.game; g.cam.state.yaw = Math.PI / 2; g.player.state.health = 100; return g.vehicles.cars[id].wrecked; }, 15000, victim.id);
await page.mouse.up();
const boom = await G((v) => { const g = window.__game.game; const car = g.vehicles.cars[v.id]; return { wrecked: car.wrecked, burn: car.burn, booms: g.fx.stats.explosions - v.booms, pedHp: g.peds.peds[1].health, enter: g.vehicles.nearest(car.x, car.z, 3) === car }; }, victim);
check('gunfire damages a car to smoking', smoked);
check('a burning car explodes into a lingering wreck', exploded && boom.wrecked && boom.burn > 0 && boom.booms >= 1 && !boom.enter, `burn ${boom.burn?.toFixed(1)} s left, wreck not enterable`);
check('the explosion damages nearby people', boom.pedHp < 1000, `bystander hp 1000 → ${boom.pedHp.toFixed(0)}`);

// Wasted → hospital, Busted → precinct, wanted cleared both times
await reset();
await G(() => { const g = window.__game.game; g.player.state.cash = 1000; g.wantedSystem.force(2); g.combat.hurtPlayer(999, 'test'); });
const wastedCard = await waitFor(() => window.__game.game.respawn.state.mode === 'wasted' && document.getElementById('death-card').textContent === 'WASTED', 2000);
const wastedDone = await waitFor(() => { const g = window.__game.game; return !g.respawning && g.respawn.state.wasted > 0; }, 8000);
const w = await G(() => { const g = window.__game.game; const h = g.respawn.hospital; const p = g.player.state; return { d: Math.hypot(p.x - h.x, p.z - h.z), hp: p.health, wanted: g.wanted, cash: p.cash }; });
check('Wasted: respawn at the hospital with full health, wanted cleared, bill paid', wastedCard && wastedDone && w.d < 3 && w.hp === 100 && w.wanted === 0 && w.cash < 1000, `bill $${1000 - w.cash}`);
const bustBase = await G(() => window.__game.game.respawn.state.busted);
await G(() => { const g = window.__game.game; g.wantedSystem.force(1); const p = g.player.state; g.police.spawnCop({ x: p.x + 1.2, z: p.z }); g.input.clear(); });
const bustedDone = await waitFor((b0) => { const g = window.__game.game; g.player.state.health = 100; return g.respawn.state.busted > b0 && !g.respawning; }, 30000, bustBase);
const bz = await G(() => { const g = window.__game.game; const h = g.respawn.precinct; const p = g.player.state; return { d: Math.hypot(p.x - h.x, p.z - h.z), wanted: g.wanted, cops: g.police.cops.filter((c) => c.active).length }; });
check('Busted: an officer arrests a still suspect, respawn at the precinct, wanted cleared', bustedDone && bz.d < 3 && bz.wanted === 0 && bz.cops === 0, `${bz.d.toFixed(1)} m from precinct`);
const fxCounts = await G(() => window.__game.game.fx.stats);
check('combat effects fired (muzzle flashes, tracers, sparks)', fxCounts.flashes > 5 && fxCounts.tracers > 5 && fxCounts.sparks > 0, JSON.stringify(fxCounts));

// 9. story missions (checkpoint 3): every mission starts from its giver beacon, every stage has a
// minimap marker and a GPS route, stages advance on world state, rewards and unlocks land.
await reset();
const missionRows = [];
const nMissions = await G(() => window.__game.game.missions.MISSIONS.length);
check('10 story missions are defined', nMissions === 10, `${nMissions} missions`);
const types = await G(() => [...new Set(window.__game.game.missions.MISSIONS.flatMap((m) => m.stages.map((s) => s.type)))]);
check('missions use varied stage types', ['goto', 'grab', 'kill', 'waves', 'chase', 'tail', 'convoy', 'evade'].every((t) => types.includes(t)), types.join(', '));
let allStagesMarked = true; let allRoutes = true; let allAdvanced = true; let allRewards = true; let allUnlocks = true;
for (let k = 0; k < nMissions; k++) {
  await G(() => { const g = window.__game.game; g.wantedSystem.clear(); g.police.standDown(); g.player.state.health = 100; g.input.clear(); });
  await waitFor(() => window.__game.game.minimap.markers.has('giver'), 4000);
  const info = await G(() => { const g = window.__game.game; const m = g.missions.nextMission(); g.missions.debugGoToGiver(); const p = g.player.state; return { id: m.id, name: m.name, district: m.district, type: m.type, stages: m.stages.length, cash: p.cash, respect: p.respect, giverMarker: g.minimap.markers.has('giver') }; });
  // the real trigger: standing in the giver's beacon starts the mission
  const started = await waitFor((id) => window.__game.game.missions.state.active?.def.id === id, 8000, info.id);
  let stagesOk = 0;
  for (let s = 0; s < info.stages && started; s++) {
    const seen = await waitFor((s) => { const g = window.__game.game; g.player.state.health = 100; const a = g.missions.state.active; return !a || a.si > s || (a.si === s && g.minimap.markers.has('mission') && (g.minimap.getRoute()?.length ?? 0) >= 2); }, 6000, s);
    const already = await G((s) => { const a = window.__game.game.missions.state.active; return !a || a.si > s; }, s);
    if (already) { stagesOk++; continue; }
    const mk = await G(() => { const g = window.__game.game; return { marker: g.minimap.markers.has('mission'), route: g.minimap.getRoute()?.length ?? 0, beacon: g.missions.beacons.objective.visible, obj: document.getElementById('objective').textContent }; });
    if (!mk.marker || !mk.beacon) allStagesMarked = false;
    if (mk.route < 2) allRoutes = false;
    // solve through world state; waves need one solve per wave
    let advanced = false;
    for (let tries = 0; tries < 6 && !advanced; tries++) {
      await G(() => window.__game.game.missions.debugSolve());
      advanced = await waitFor(({ s, id }) => { const g = window.__game.game; g.player.state.health = 100; if (g.player.state.car) g.player.state.car.health = Math.max(g.player.state.car.health, 80); const a = g.missions.state.active; return !a ? g.missions.state.done.includes(id) : a.si > s; }, 5000, { s, id: info.id });
    }
    if (advanced && seen) stagesOk++;
    else { allAdvanced = false; console.log(`  ${info.id} stage ${s + 1} stuck: ${mk.obj} failed=${JSON.stringify(await G(() => window.__game.game.missions.state.failed))}`); break; }
  }
  const after = await G((id) => { const g = window.__game.game; const p = g.player.state; const nm = g.missions.nextMission(); return { done: g.missions.state.done.includes(id), cash: p.cash, respect: p.respect, next: nm ? nm.id : null }; }, info.id);
  if (!(after.cash > info.cash && after.respect > info.respect)) allRewards = false;
  if (k < nMissions - 1 && after.next === info.id) allUnlocks = false;
  missionRows.push(`${info.id} ${info.name} [${info.district}, ${info.type}] stages ${stagesOk}/${info.stages} cash +${after.cash - info.cash} respect +${after.respect - info.respect} next ${after.next}`);
  check(`mission ${k + 1} "${info.name}": starts at its giver, all ${info.stages} stages advance, reward paid`, started && info.giverMarker && stagesOk === info.stages && after.done && after.cash > info.cash && after.respect > info.respect, `+$${after.cash - info.cash}, +${after.respect - info.respect} respect, next ${after.next ?? 'none (story complete)'}`);
}
check('every mission stage shows a minimap marker and a world beacon', allStagesMarked);
check('every mission stage draws a GPS route along the roads', allRoutes);
check('every stage advances through world state (moves, kills, wrecks, wanted)', allAdvanced);
check('each completion pays cash + respect and unlocks the next mission', allRewards && allUnlocks);
const rankNow = await G(() => document.getElementById('respect').textContent);
check('respect rank shown on the HUD', /RESPECT \d+ · /.test(rankNow), rankNow);
// fail + retry: replay mission 6 (timed delivery) and let the clock run out
await G(() => { const g = window.__game.game; g.wantedSystem.clear(); g.police.standDown(); g.missions.startMission(g.missions.MISSIONS[5]); });
await G(() => window.__game.game.missions.debugSolve()); // board a car
await waitFor(() => window.__game.game.missions.state.active?.si === 1, 5000);
await G(() => { window.__game.game.missions.state.active.stage.timer = 0.05; });
const timedOut = await waitFor(() => window.__game.game.missions.state.failed?.reason === 'out of time', 5000);
await page.keyboard.press('Enter');
const retried = await waitFor(() => window.__game.game.missions.state.active?.def.id === 'm6' && window.__game.game.missions.state.active.si <= 1, 5000);
check('a mission fails when its timer runs out and Enter retries it', timedOut && retried);
await G(() => { const g = window.__game.game; if (g.missions.state.active) g.missions.fail('test over'); g.missions.state.failed = null; g.wantedSystem.clear(); g.police.standDown(); });
// gang members shoot back
await reset();
const gangFight = await G(({ beach }) => { const g = window.__game.game; g.player.placeAt(beach.x, beach.z, 0); const m = g.gang.spawn('ember', beach.x + 12, beach.z, { tag: 'audit', alert: true }); return { shots: g.gang.stats.shots, hp: g.player.state.health + g.player.state.armor, ok: !!m }; }, { beach });
const shotBack = await waitFor((s) => window.__game.game.gang.stats.shots > s, 10000, gangFight.shots);
await G(() => { const g = window.__game.game; g.gang.clear('audit'); g.player.state.health = 100; });
check('rival gang members open fire on the player', gangFight.ok && shotBack);
await page.keyboard.press('KeyJ');
const logOpen = await waitFor(() => window.__game.game.missions.isLogOpen() && document.getElementById('mission-log').textContent.includes('10/10'), 4000);
await page.keyboard.press('KeyJ');
check('J opens the mission log with progress', logOpen && (await waitFor(() => !window.__game.game.missions.isLogOpen(), 3000)));
for (const r of missionRows) console.log('  MISSION ' + r);

check('no request left localhost', external.length === 0, external.slice(0, 3).join(', '));
check('zero console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
